/**
 * Two charts, drawn as inline SVG.
 *
 * Every colour here is a shell token. That is the whole reason the console
 * looks like one product: the categorical slots were validated once, published
 * as `--ax-series-*`, and this team spends none of its time choosing chart
 * colours or re-deriving them for dark mode. Changing the palette is a shell
 * deploy, and it reaches this chart without this team shipping anything.
 */
import { useId, useState } from 'react';
import type { DelayCause, LoadPoint } from './data';
import styles from './analytics.module.css';

const PLOT = { width: 720, height: 220, left: 38, right: 12, top: 12, bottom: 24 };

interface Hover {
  index: number;
  x: number;
}

export function SectorLoadChart({ points }: { points: LoadPoint[] }): React.ReactElement {
  const [hover, setHover] = useState<Hover | null>(null);
  const gradientId = useId();

  const inner = {
    width: PLOT.width - PLOT.left - PLOT.right,
    height: PLOT.height - PLOT.top - PLOT.bottom,
  };
  const max = Math.max(...points.flatMap((point) => [point.arrivals, point.departures])) * 1.12;
  const x = (index: number) => PLOT.left + (index / (points.length - 1)) * inner.width;
  const y = (value: number) => PLOT.top + inner.height - (value / max) * inner.height;

  const line = (key: 'arrivals' | 'departures') =>
    points.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join('');

  const area = `${line('arrivals')}L${x(points.length - 1).toFixed(1)},${(PLOT.top + inner.height).toFixed(1)}L${PLOT.left},${(PLOT.top + inner.height).toFixed(1)}Z`;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(max * fraction));
  const active = hover ? points[hover.index] : null;

  return (
    <figure className={styles.figure}>
      <figcaption className={styles.figcaption}>
        <span className={styles.figTitle}>Movements per 5 minutes</span>
        {/* Two series, so a legend is always present — identity is never left
            to colour alone. Both are also labelled directly at their last
            point, which is what people actually read. */}
        <span className={styles.legend}>
          <span className={styles.legendItem}>
            <span className={styles.swatch} style={{ background: 'var(--ax-series-1)' }} />
            Arrivals
          </span>
          <span className={styles.legendItem}>
            <span className={styles.swatch} style={{ background: 'var(--ax-series-2)' }} />
            Departures
          </span>
        </span>
      </figcaption>

      <svg
        className={styles.svg}
        viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
        role="img"
        aria-label="Arrivals and departures per five minutes across the selected window"
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const local = ((event.clientX - rect.left) / rect.width) * PLOT.width;
          const index = Math.round(((local - PLOT.left) / inner.width) * (points.length - 1));
          if (index >= 0 && index < points.length) setHover({ index, x: x(index) });
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ax-series-1)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--ax-series-1)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PLOT.left}
              x2={PLOT.width - PLOT.right}
              y1={y(tick)}
              y2={y(tick)}
              className={styles.grid}
            />
            <text x={PLOT.left - 8} y={y(tick) + 4} className={styles.axisLabel} textAnchor="end">
              {tick}
            </text>
          </g>
        ))}

        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line('arrivals')} className={styles.series} stroke="var(--ax-series-1)" />
        <path d={line('departures')} className={styles.series} stroke="var(--ax-series-2)" />

        {hover && active ? (
          <g>
            <line x1={hover.x} x2={hover.x} y1={PLOT.top} y2={PLOT.top + inner.height} className={styles.crosshair} />
            {/* A 2px surface ring keeps the marker legible wherever it lands. */}
            <circle cx={hover.x} cy={y(active.arrivals)} r="4.5" className={styles.marker} fill="var(--ax-series-1)" />
            <circle
              cx={hover.x}
              cy={y(active.departures)}
              r="4.5"
              className={styles.marker}
              fill="var(--ax-series-2)"
            />
          </g>
        ) : null}

        <text x={PLOT.left} y={PLOT.height - 6} className={styles.axisLabel}>
          −{points[0]?.minutesAgo ?? 0}m
        </text>
        <text x={PLOT.width - PLOT.right} y={PLOT.height - 6} className={styles.axisLabel} textAnchor="end">
          now
        </text>
      </svg>

      <div className={styles.readout} aria-live="polite">
        {active ? (
          <>
            <strong>−{active.minutesAgo}m</strong>
            <span style={{ color: 'var(--ax-text)' }}>{active.arrivals} arrivals</span>
            <span style={{ color: 'var(--ax-text)' }}>{active.departures} departures</span>
          </>
        ) : (
          <span>Hover the plot for a reading.</span>
        )}
      </div>
    </figure>
  );
}

export function DelayCauseChart({
  causes,
  onSelect,
}: {
  causes: DelayCause[];
  onSelect?: (cause: DelayCause) => void;
}): React.ReactElement {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(...causes.map((cause) => cause.minutes));

  return (
    <figure className={styles.figure}>
      {/* One series, so no legend — the title names what is plotted. */}
      <figcaption className={styles.figcaption}>
        <span className={styles.figTitle}>Delay minutes by cause</span>
        <span className={styles.figNote}>selected window</span>
      </figcaption>

      <div className={styles.bars}>
        {causes.map((cause) => (
          <button
            key={cause.cause}
            type="button"
            className={styles.barRow}
            onPointerEnter={() => setHover(cause.cause)}
            onPointerLeave={() => setHover(null)}
            onClick={() => onSelect?.(cause)}
            aria-label={`${cause.cause}: ${cause.minutes} minutes`}
          >
            <span className={styles.barLabel}>{cause.cause}</span>
            <span className={styles.barTrack}>
              <span
                className={styles.barFill}
                style={{
                  width: `${(cause.minutes / max) * 100}%`,
                  background: 'var(--ax-series-1)',
                  opacity: hover && hover !== cause.cause ? 0.55 : 1,
                }}
              />
            </span>
            {/* Direct value labels on every bar: six of them, all readable,
                and it removes the need to trace back to an axis. */}
            <span className={styles.barValue}>{cause.minutes}m</span>
          </button>
        ))}
      </div>
    </figure>
  );
}
