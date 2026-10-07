import { useCallback, useEffect, useState } from 'react';
import { useBusEvent, useSharedState, useShellServices } from '@airspace/contract/react';
import { DelayCauseChart, SectorLoadChart } from './charts';
import { RELEASE, fetchReport, type Report } from './data';
import styles from './analytics.module.css';

/**
 * Airspace Analytics.
 *
 * The interesting part of this app is what it does with things it did not
 * originate: it re-fetches when the *shell's* filters change, and it reacts
 * when the *Operations Board* puts a flight in focus — without importing either
 * of them, and while staying perfectly usable if neither is on the page.
 */
export default function Analytics(): React.ReactElement {
  const { filters, session } = useSharedState();
  const services = useShellServices();

  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asTable, setAsTable] = useState(false);
  const [focus, setFocus] = useState<{ callsign: string; sector: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    services
      .getAccessToken('analytics:read')
      .then(() => fetchReport(filters, controller.signal))
      .then(setReport)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [filters, services]);

  // Someone, somewhere in the console, focused a flight. This app has no idea
  // which app that was and cannot find out — the bus deliberately does not
  // offer a way to ask. Reacting is a courtesy, not a contract.
  useBusEvent(
    'flight:selected',
    useCallback((payload) => setFocus({ callsign: payload.callsign, sector: payload.sector }), []),
    // Replayed on mount: this panel is usually opened *after* a flight was
    // focused somewhere else, which is exactly the case a bus without replay
    // drops on the floor.
    { replayLast: true },
  );

  if (error) {
    return <p className={styles.footnote}>Analytics service unavailable — {error}</p>;
  }

  if (!report) {
    return (
      <div className={styles.root}>
        <div className={styles.skeleton} />
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>Airspace Analytics</h2>
          <p className={styles.subtitle}>
            {filters.sector} · trailing {filters.window} · {session.role} view
          </p>
        </div>
        <button className={styles.tableToggle} onClick={() => setAsTable((value) => !value)}>
          {asTable ? 'Show charts' : 'Show as table'}
        </button>
      </header>

      {focus ? (
        <p className={styles.focus}>
          <strong>{focus.callsign}</strong> was put in focus elsewhere in the console (sector {focus.sector}).
          This panel reacted to an event on the bus — it never learned which application published it.
        </p>
      ) : null}

      <div className={styles.tiles}>
        <div className={styles.tile}>
          <div className={styles.tileValue}>{report.peakArrivals}</div>
          <div className={styles.tileLabel}>peak arrivals / 5m</div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileValue}>{Math.round(report.onTimeRate * 100)}%</div>
          <div className={styles.tileLabel}>on time</div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileValue}>{report.causes.reduce((sum, cause) => sum + cause.minutes, 0)}</div>
          <div className={styles.tileLabel}>delay minutes</div>
        </div>
      </div>

      {asTable ? (
        // Every chart on this page has a table view. It is the accessibility
        // backstop, and it is also the thing analysts copy into a ticket.
        <div className={styles.figure}>
          <table className={styles.table}>
            <caption className={styles.figTitle}>Delay minutes by cause</caption>
            <thead>
              <tr>
                <th scope="col">Cause</th>
                <th scope="col">Minutes</th>
              </tr>
            </thead>
            <tbody>
              {report.causes.map((cause) => (
                <tr key={cause.cause}>
                  <td>{cause.cause}</td>
                  <td>{cause.minutes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.panels}>
          <SectorLoadChart points={report.load} />
          <DelayCauseChart
            causes={report.causes}
            onSelect={(cause) => {
              services.track('analytics.cause_selected', { cause: cause.cause, minutes: cause.minutes });
              services.notify({
                severity: cause.minutes > 150 ? 'warning' : 'info',
                title: `${cause.cause}: ${cause.minutes} delay minutes`,
                detail: `In ${filters.sector} over the trailing ${filters.window}.`,
                timeoutMs: 5000,
              });
            }}
          />
        </div>
      )}

      <p className={styles.footnote}>analytics@{RELEASE} · react · deployed separately from the board</p>
    </div>
  );
}
