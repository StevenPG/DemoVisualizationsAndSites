import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Severity } from '@airspace/contract';
import { useBusEvent, useEventBus, useSharedState, useShellServices } from '@airspace/contract/react';
import { HAS_WAKE_CATEGORY, RELEASE, fetchFlights, type Flight } from './data';
import styles from './ops-board.module.css';

/**
 * The Operations Board.
 *
 * Everything it knows about the rest of the console arrives through hooks from
 * `@airspace/contract/react`: shell-owned state, shell services, the bus. It
 * imports nothing from the shell and nothing from another remote — try it and
 * the build fails, because those packages are not in this app's package.json.
 */
export default function OpsBoard(): React.ReactElement {
  const { filters, route, session } = useSharedState();
  const services = useShellServices();
  const bus = useEventBus();

  const [flights, setFlights] = useState<Flight[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);
  const [externallySelected, setExternallySelected] = useState<string | null>(null);
  const [crashed, setCrashed] = useState(false);

  // A deliberate bug, so the recovery path is demonstrable. Throwing during
  // render is caught by the boundary the React adapter wraps every remote in,
  // which reports it through `context.onError` — the shell then shows its
  // standard fallback. Nothing else on the page is affected, because a remote's
  // React root and the shell's are separate trees that cannot see each other's
  // errors even when they want to.
  if (crashed) throw new Error('ops-board: simulated render failure (this button is a demo affordance)');

  // The shell owns the URL; this remote owns the part of it below its mount
  // point. `/flights/DAL231` here is `/#/ops/flights/DAL231` in the address bar
  // and neither side has to know the other's half.
  const selectedCallsign = route.startsWith('/flights/') ? route.slice('/flights/'.length) : null;

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    // A token per request, from the shell. The shell owns the session, so it
    // owns refresh; this app never sees a credential or a login screen.
    services
      .getAccessToken('flights:read')
      .then((token) => fetchFlights({ sector: filters.sector, tick, token, signal: controller.signal }))
      .then((next) => {
        if (cancelled) return;
        setFlights(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled || (cause instanceof DOMException && cause.name === 'AbortError')) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [filters.sector, tick, services]);

  // Another remote can put a flight in focus. Reacting is optional — that is
  // what makes the bus safe to publish on without knowing who listens.
  // `replayLast` because this app may have mounted after the selection
  // happened — the user could have focused the flight in Analytics and come
  // here afterwards.
  useBusEvent(
    'flight:selected',
    useCallback((payload) => setExternallySelected(payload.callsign), []),
    { replayLast: true },
  );

  const visible = useMemo(
    () => (flights ?? []).filter((flight) => filters.severities.includes(flight.severity)),
    [flights, filters.severities],
  );

  const select = useCallback(
    (flight: Flight) => {
      services.track('ops_board.flight_opened', { callsign: flight.callsign, severity: flight.severity });
      // Relative: the shell resolves it against this remote's mount point.
      services.navigate(`flights/${flight.callsign}`);
      bus.publish('flight:selected', {
        flightId: flight.id,
        callsign: flight.callsign,
        sector: flight.sector,
      });
    },
    [bus, services],
  );

  const selected = visible.find((flight) => flight.callsign === selectedCallsign) ?? null;

  if (error) {
    // A remote's own failures are its own problem to explain. The shell's error
    // boundary is the net for the ones this app did not see coming — it should
    // not be the first line of defence for a failed fetch.
    return (
      <div className={styles.root}>
        <div className={styles.empty}>
          Ops feed unavailable — {error.message}.{' '}
          <button className={styles.button} onClick={() => setTick((value) => value + 1)}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>Operations Board</h2>
          <p className={styles.subtitle}>
            Sector {filters.sector} · last {filters.window} · signed in as {session.name}
          </p>
        </div>
        <Stats flights={visible} />
      </header>

      {selected ? (
        <FlightDetail flight={selected} onBack={() => services.navigate('')} />
      ) : (
        <FlightTable
          flights={visible}
          loading={flights === null}
          highlighted={externallySelected}
          onSelect={select}
        />
      )}

      <p className={styles.footnote}>
        ops-board@{RELEASE} · own data layer, own release train
        {HAS_WAKE_CATEGORY ? ' · wake categories enabled' : ''}
        {' · '}
        <button className={styles.linkButton} onClick={() => setCrashed(true)}>
          simulate a render crash
        </button>
      </p>
    </div>
  );
}

function Stats({ flights }: { flights: readonly Flight[] }): React.ReactElement {
  const critical = flights.filter((flight) => flight.severity === 'critical').length;
  const mean = flights.length
    ? Math.round((flights.reduce((sum, flight) => sum + flight.conformance, 0) / flights.length) * 100)
    : 0;

  return (
    <div className={styles.stats}>
      <div className={styles.stat}>
        <span className={styles.statValue}>{flights.length}</span>
        <span className={styles.statLabel}>tracked</span>
      </div>
      <div className={styles.stat}>
        <span className={`${styles.statValue} ${critical ? styles.critical : ''}`}>{critical}</span>
        <span className={styles.statLabel}>critical</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.statValue}>{mean}%</span>
        <span className={styles.statLabel}>mean deviation</span>
      </div>
    </div>
  );
}

interface TableProps {
  flights: readonly Flight[];
  loading: boolean;
  highlighted: string | null;
  onSelect: (flight: Flight) => void;
}

function FlightTable({ flights, loading, highlighted, onSelect }: TableProps): React.ReactElement {
  if (loading) {
    return (
      <div className={styles.tableWrap}>
        <div style={{ display: 'grid', gap: '0.6rem', padding: '0.9rem' }}>
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className={styles.skeleton} />
          ))}
        </div>
      </div>
    );
  }

  if (!flights.length) {
    return <div className={styles.empty}>No flights match the shell&rsquo;s current severity filter.</div>;
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Callsign</th>
            <th scope="col">Type</th>
            <th scope="col">Route</th>
            <th scope="col">FL</th>
            <th scope="col">GS</th>
            {HAS_WAKE_CATEGORY ? <th scope="col">Wake</th> : null}
            <th scope="col">Deviation</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {flights.map((flight) => (
            <tr
              key={flight.id}
              className={`${styles.row} ${highlighted === flight.callsign ? styles.rowSelected : ''}`}
              tabIndex={0}
              onClick={() => onSelect(flight)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(flight);
                }
              }}
            >
              <td className={styles.callsign}>{flight.callsign}</td>
              <td>{flight.type}</td>
              <td>
                {flight.origin} → {flight.destination}
              </td>
              <td>{Math.round(flight.altitudeFt / 100)}</td>
              <td>{flight.groundSpeedKt}</td>
              {HAS_WAKE_CATEGORY ? <td>{flight.wakeCategory ?? '—'}</td> : null}
              <td className={styles[flight.severity]}>
                <span className={styles.meter} title={`${Math.round(flight.conformance * 100)}%`}>
                  <span className={styles.meterFill} style={{ width: `${flight.conformance * 100}%` }} />
                </span>
              </td>
              <td>
                <SeverityPill severity={flight.severity} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SeverityPill = ({ severity }: { severity: Severity }): React.ReactElement => (
  <span className={`${styles.pill} ${styles[severity]}`}>{severity}</span>
);

function FlightDetail({ flight, onBack }: { flight: Flight; onBack: () => void }): React.ReactElement {
  const services = useShellServices();
  const bus = useEventBus();
  const { session } = useSharedState();
  const mountedAt = useRef(performance.now());

  useEffect(() => {
    const at = mountedAt.current;
    return () => {
      services.track('ops_board.flight_closed', { callsign: flight.callsign, msOpen: Math.round(performance.now() - at) });
    };
  }, [flight.callsign, services]);

  const mayClear = session.scopes.includes('flights:clear');

  return (
    <section className={styles.detail}>
      <div className={styles.head}>
        <div>
          <h2 className={styles.title}>
            <span className={styles.callsign}>{flight.callsign}</span> · {flight.type}
          </h2>
          <p className={styles.subtitle}>
            {flight.origin} → {flight.destination} · squawk {flight.squawk}
          </p>
        </div>
        <SeverityPill severity={flight.severity} />
      </div>

      <dl className={styles.grid}>
        <div>
          <dt>Flight level</dt>
          <dd>{Math.round(flight.altitudeFt / 100)}</dd>
        </div>
        <div>
          <dt>Ground speed</dt>
          <dd>{flight.groundSpeedKt} kt</dd>
        </div>
        <div>
          <dt>Heading</dt>
          <dd>{String(flight.headingDeg).padStart(3, '0')}°</dd>
        </div>
        <div>
          <dt>Deviation</dt>
          <dd className={styles[flight.severity]}>{Math.round(flight.conformance * 100)}%</dd>
        </div>
        {HAS_WAKE_CATEGORY ? (
          <div>
            <dt>Wake category</dt>
            <dd>{flight.wakeCategory ?? '—'}</dd>
          </div>
        ) : null}
      </dl>

      <div className={styles.actions}>
        <button className={styles.button} onClick={onBack}>
          ← Back to board
        </button>
        <button
          className={`${styles.button} ${styles.buttonPrimary}`}
          disabled={!mayClear}
          title={mayClear ? undefined : 'Requires the flights:clear scope'}
          onClick={() => {
            // Two different things, on purpose. `notify` is a request to the
            // shell — "show this to the user" — and only the shell can honour
            // it. `alert:raised` is an announcement to whoever cares, and works
            // exactly the same whether anyone is listening or not.
            services.notify({
              severity: 'info',
              title: `${flight.callsign} cleared to FL${Math.round(flight.altitudeFt / 100) + 20}`,
              detail: 'Clearance issued from the Operations Board.',
              timeoutMs: 6000,
            });
            bus.publish('alert:raised', {
              id: `clr-${flight.id}-${Date.now()}`,
              severity: 'info',
              message: `${flight.callsign} re-cleared by ${session.name}`,
            });
          }}
        >
          Issue clearance
        </button>
        <button
          className={styles.button}
          onClick={() => {
            bus.publish('flight:selected', {
              flightId: flight.id,
              callsign: flight.callsign,
              sector: flight.sector,
            });
            services.notify({
              severity: 'advisory',
              title: `Broadcast focus on ${flight.callsign}`,
              detail: 'Other micro frontends may pick this up from the bus.',
              timeoutMs: 4000,
            });
          }}
        >
          Broadcast focus
        </button>
      </div>
    </section>
  );
}
