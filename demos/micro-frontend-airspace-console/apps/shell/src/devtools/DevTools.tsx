/**
 * The instrument panel.
 *
 * Module Federation's whole value is invisible when it works: a page that
 * assembles four independently deployed bundles looks exactly like a page that
 * imported four directories. These four tabs make the invisible part visible —
 * what loaded from where, whether the shared dependencies really are shared,
 * what crosses the boundary at runtime, and what happens when a remote fails.
 *
 * This is demo instrumentation, but only just. A real console benefits from
 * shipping something very close to the X-ray tab behind a flag: when a user
 * reports "the analytics panel is stale", the first question is always which
 * version of which remote they actually got, and the answer is otherwise a
 * network-tab archaeology exercise.
 */
import { useState } from 'react';
import { CONTRACT_VERSION } from '@airspace/contract';
import { useConsole } from '../console-store';
import type { Fault } from '../federation';
import type { Registry } from '../registry';
import styles from './devtools.module.css';

type Tab = 'xray' | 'faults' | 'contract' | 'releases';

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'xray', label: 'X-ray', hint: 'what loaded, from where' },
  { id: 'faults', label: 'Faults', hint: 'break a remote on purpose' },
  { id: 'contract', label: 'Contract', hint: 'everything crossing the boundary' },
  { id: 'releases', label: 'Releases', hint: 'swap versions without a rebuild' },
];

export function DevTools({ registry }: { registry: Registry | null }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('xray');
  const { loads } = useConsole();
  const broken = loads.filter((record) => record.status === 'failed').length;

  if (!open) {
    return (
      <button className={styles.launcher} onClick={() => setOpen(true)}>
        <span className={styles.launcherDot} data-bad={broken > 0} />
        Federation inspector
      </button>
    );
  }

  return (
    <aside className={styles.dock} aria-label="Federation inspector">
      <header className={styles.dockHead}>
        <div className={styles.tabs} role="tablist">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              role="tab"
              aria-selected={tab === entry.id}
              title={entry.hint}
              className={`${styles.tab} ${tab === entry.id ? styles.tabActive : ''}`}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <button className={styles.close} onClick={() => setOpen(false)} aria-label="Close inspector">
          ×
        </button>
      </header>

      <div className={styles.body}>
        {tab === 'xray' ? <XRay /> : null}
        {tab === 'faults' ? <Faults registry={registry} /> : null}
        {tab === 'contract' ? <ContractLog /> : null}
        {tab === 'releases' ? <Releases registry={registry} /> : null}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ X-ray */

function XRay(): React.ReactElement {
  const { loads } = useConsole();
  const successful = loads.filter((record) => record.status === 'ok');
  const duplicated = successful.flatMap((record) => record.sharing).filter((entry) => entry.verdict === 'duplicated');

  if (!loads.length) {
    return <p className={styles.note}>Nothing loaded yet — open one of the micro frontends.</p>;
  }

  return (
    <>
      {/*
        The claim worth proving. Every React remote reports a reference to its
        own `useState`; if federation is sharing correctly, it is the identical
        function the shell holds. Version strings agreeing would prove nothing —
        two copies of 19.2.8 still means two hook dispatchers and an "invalid
        hook call" the first time a remote renders.
      */}
      <p className={`${styles.verdict} ${duplicated.length ? styles.verdictBad : styles.verdictGood}`}>
        {duplicated.length
          ? `${duplicated.length} shared dependency instance(s) duplicated — check the singleton config.`
          : `React and react-dom are one instance across ${successful.length + 1} independently built bundles ` +
            `(compared by export reference, not version string).`}
      </p>

      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Remote</th>
            <th scope="col">Version</th>
            <th scope="col">Runtime</th>
            <th scope="col">Load</th>
            <th scope="col" title="Everything that release published, including its standalone preview page">
              Deployed
            </th>
            <th scope="col">Contract</th>
            <th scope="col">Shared deps</th>
          </tr>
        </thead>
        <tbody>
          {loads.map((record) => (
            <tr key={`${record.remote}-${record.version}-${record.startedAt}`}>
              <td>
                <strong>{record.remote}</strong>
                <div className={styles.dim}>{record.team}</div>
              </td>
              <td>{record.version}</td>
              <td>{record.runtime}</td>
              <td className={record.status === 'failed' ? styles.bad : undefined}>
                {record.status === 'failed' ? 'failed' : `${record.ms}ms`}
              </td>
              <td>{record.bytes ? `${Math.round(record.bytes / 1024)}kB` : '—'}</td>
              <td>
                {record.contractVersion ?? '—'}
                {record.compatibility?.degraded ? <div className={styles.warn}>ahead of shell</div> : null}
              </td>
              <td>
                {record.sharing.length ? (
                  record.sharing.map((entry) => (
                    <div key={entry.dependency} className={entry.verdict === 'shared' ? styles.good : styles.bad}>
                      {entry.dependency}: {entry.verdict}
                    </div>
                  ))
                ) : (
                  // The Svelte remote lands here, and that is the answer, not a
                  // gap in the data: it never resolved React, so it has nothing
                  // to report about it.
                  <span className={styles.dim}>none declared</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className={styles.urls}>
        {loads.slice(0, 5).map((record) => (
          <li key={`${record.remote}-${record.startedAt}`}>
            <span className={styles.dim}>{record.remote} ←</span> {record.entry}
          </li>
        ))}
      </ul>
    </>
  );
}

/* ----------------------------------------------------------------- Faults */

const FAULTS: { id: Fault; label: string; blurb: string }[] = [
  { id: 'none', label: 'Healthy', blurb: 'normal load' },
  { id: 'missing', label: '404', blurb: 'the bundle is gone — a bad deploy or a purged CDN path' },
  { id: 'slow', label: 'Hang', blurb: 'a 9s stall — an edge that accepted the connection and stopped' },
  { id: 'mount-throws', label: 'Throws', blurb: 'loads fine, then explodes inside mount()' },
];

function Faults({ registry }: { registry: Registry | null }): React.ReactElement {
  const { faults, setFault, reloadAll } = useConsole();

  return (
    <>
      <p className={styles.note}>
        Injected on the <strong>shell</strong> side, with no cooperation from the remote — because the
        failures a host has to survive are exactly the ones a remote is in no position to report. Pick one,
        then open that section.
      </p>

      {(registry?.remotes ?? []).map((entry) => (
        <div key={entry.name} className={styles.faultRow}>
          <div>
            <strong>{entry.name}</strong>
            <div className={styles.dim}>{entry.team}</div>
          </div>
          <div className={styles.faultButtons}>
            {FAULTS.map((fault) => (
              <button
                key={fault.id}
                title={fault.blurb}
                aria-pressed={(faults[entry.name] ?? 'none') === fault.id}
                className={`${styles.chip} ${(faults[entry.name] ?? 'none') === fault.id ? styles.chipOn : ''}`}
                onClick={() => setFault(entry.name, fault.id)}
              >
                {fault.label}
              </button>
            ))}
          </div>
        </div>
      ))}

      <button className={styles.action} onClick={reloadAll}>
        Reload every remote
      </button>
      <p className={styles.note}>
        Whatever you break, the header, navigation, filters and the other micro frontends keep working. That
        containment is the property worth buying micro frontends for, and the one worth testing before you
        depend on it.
      </p>
    </>
  );
}

/* --------------------------------------------------------------- Contract */

function ContractLog(): React.ReactElement {
  const { busLog, serviceLog, clearLogs } = useConsole();

  const merged = [
    ...busLog.map((message) => ({
      at: message.at,
      kind: 'bus' as const,
      source: message.source,
      label: message.type,
      detail: JSON.stringify(message.payload),
    })),
    ...serviceLog.map((call) => ({
      at: call.at,
      kind: 'service' as const,
      source: call.source,
      label: `services.${call.method}`,
      detail: call.detail,
    })),
  ].sort((a, b) => b.at - a.at);

  return (
    <>
      <p className={styles.note}>
        Every crossing of the boundary, both directions. <strong>services.*</strong> is a remote asking the
        shell for something; <strong>bus</strong> is a remote announcing that something happened, to whoever
        is listening. Notice how short the list of distinct entries is — that is the integration surface, and
        keeping it short is what keeps the teams independent.
      </p>

      <button className={styles.action} onClick={clearLogs}>
        Clear
      </button>

      <ol className={styles.log}>
        {merged.slice(0, 60).map((entry, index) => (
          <li key={`${entry.at}-${index}`} className={styles.logLine}>
            <span className={entry.kind === 'bus' ? styles.tagBus : styles.tagService}>{entry.kind}</span>
            <span className={styles.dim}>{entry.source}</span>
            <span>{entry.label}</span>
            <span className={styles.dim}>{entry.detail}</span>
          </li>
        ))}
        {merged.length === 0 ? <li className={styles.note}>Nothing yet. Click around a micro frontend.</li> : null}
      </ol>
    </>
  );
}

/* --------------------------------------------------------------- Releases */

function Releases({ registry }: { registry: Registry | null }): React.ReactElement {
  const { pinned, pin } = useConsole();

  return (
    <>
      <p className={styles.note}>
        Each of these is a separate build, published to its own URL. Switching between them re-registers the
        remote and re-mounts it — <strong>with no shell rebuild, no page reload and no other remote
        touched</strong>. In production the same switch is a registry update, which is what makes a rollback
        a one-line change instead of a release.
      </p>

      {(registry?.remotes ?? []).map((entry) => (
        <div key={entry.name} className={styles.faultRow}>
          <div>
            <strong>{entry.name}</strong>
            <div className={styles.dim}>{entry.team}</div>
          </div>
          <div className={styles.faultButtons}>
            {entry.releases.map((release) => {
              const active = (pinned[entry.name] ?? entry.current) === release.version;
              return (
                <button
                  key={release.version}
                  aria-pressed={active}
                  title={`${release.channel} · deployed ${new Date(release.deployedAt).toLocaleDateString()}`}
                  className={`${styles.chip} ${active ? styles.chipOn : ''}`}
                  onClick={() => pin(entry.name, release.version)}
                >
                  {release.version}
                  {release.channel === 'stable' ? ' ✓' : ''}
                </button>
              );
            })}
            {entry.releases.length === 1 ? <span className={styles.dim}>one release published</span> : null}
          </div>
        </div>
      ))}

      <p className={styles.note}>
        The shell speaks contract {CONTRACT_VERSION}. A remote built against an older minor keeps working; a
        different major is refused at the boundary with a readable message rather than mounted and left to
        fail somewhere less obvious.
      </p>
    </>
  );
}
