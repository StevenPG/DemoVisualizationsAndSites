/**
 * The console: chrome the shell owns, plus one slot the shell does not.
 *
 * Note how little of this file knows anything concrete. There is no import of
 * a remote, no list of remotes, no `if (route === '/ops')`. The registry
 * supplies the navigation and the mount paths; the shell supplies a header, a
 * sidebar, a footer, a router and a set of services. Adding a fourth micro
 * frontend does not touch this file.
 */
import { useEffect, useState } from 'react';
import type { OpsFilters, Severity } from '@airspace/contract';
import { CONTRACT_VERSION } from '@airspace/contract';
import { SEVERITIES, useConsole } from './console-store';
import { DevTools } from './devtools/DevTools';
import { RemoteSlot } from './RemoteSlot';
import { fetchRegistry, registryUrl, type Registry, type RegistryEntry } from './registry';
import { navigate, usePath } from './router';
import styles from './shell.module.css';

export default function App(): React.ReactElement {
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const path = usePath();

  useEffect(() => {
    const controller = new AbortController();
    fetchRegistry(controller.signal)
      .then(setRegistry)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setRegistryError(error instanceof Error ? error.message : String(error));
      });
    return () => controller.abort();
  }, []);

  if (registryError) {
    // The one dependency the shell genuinely cannot survive. Worth showing what
    // it costs: without the registry the console does not know what exists, so
    // it degrades to chrome with nothing in it — which is why in production this
    // response is cached hard and served from the edge.
    return (
      <div className={styles.fatal}>
        <h1>Console unavailable</h1>
        <p>{registryError}</p>
        <p className={styles.cardMeta}>Registry: {registryUrl()}</p>
      </div>
    );
  }

  const active = registry?.remotes.find(
    (entry) => path === entry.nav.path || path.startsWith(`${entry.nav.path}/`),
  );

  return (
    <div className={styles.app}>
      <Header />
      <Nav remotes={registry?.remotes ?? []} activePath={active?.nav.path ?? path} />

      <main className={styles.main}>
        {!registry ? (
          <p className={styles.cardMeta}>Reading the remote registry…</p>
        ) : active ? (
          <>
            <nav className={styles.crumbs} aria-label="Breadcrumb">
              <a href="#/">console</a>
              <span>/</span>
              <span>{active.nav.label.toLowerCase()}</span>
              <span>·</span>
              <span>owned by {active.team}</span>
            </nav>
            <section className={styles.boundary}>
              <span className={styles.boundaryLabel}>
                team boundary — {active.name} ({active.runtime})
              </span>
              {/* Keying on the remote's name guarantees a clean slate when the
                  user switches areas: no chance of one remote inheriting
                  another's mounted DOM node. */}
              <RemoteSlot key={active.name} entry={active} mountPath={active.nav.path} />
            </section>
          </>
        ) : (
          <Overview registry={registry} />
        )}
      </main>

      <Footer registry={registry} />
      <Toasts />
      <DevTools registry={registry} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Header(): React.ReactElement {
  const { filters, setFilters, theme, setTheme, session } = useConsole();

  const toggleSeverity = (severity: Severity) => {
    const next = filters.severities.includes(severity)
      ? filters.severities.filter((value) => value !== severity)
      : [...filters.severities, severity];
    setFilters({ severities: next });
  };

  return (
    <header className={styles.header}>
      <a className={styles.brand} href="#/">
        <span className={styles.brandMark}>AX</span>
        <span>Airspace Console</span>
        <span className={styles.brandTag}>shell 3.4.0 · contract {CONTRACT_VERSION}</span>
      </a>

      {/*
        The global filter bar. It belongs to the shell because it is the one
        piece of state every remote reads — if each team owned its own sector
        picker the console would have three of them, and they would disagree.
      */}
      <div className={styles.filters}>
        <label className={styles.field}>
          sector
          <select
            className={styles.select}
            value={filters.sector}
            onChange={(event) => setFilters({ sector: event.target.value as OpsFilters['sector'] })}
          >
            <option value="ZTL-38">ZTL-38</option>
            <option value="ZTL-42">ZTL-42</option>
            <option value="ZJX-17">ZJX-17</option>
            <option value="ZDC-09">ZDC-09</option>
          </select>
        </label>

        <label className={styles.field}>
          window
          <select
            className={styles.select}
            value={filters.window}
            onChange={(event) => setFilters({ window: event.target.value as OpsFilters['window'] })}
          >
            <option value="15m">15m</option>
            <option value="1h">1h</option>
            <option value="6h">6h</option>
            <option value="24h">24h</option>
          </select>
        </label>

        <div className={styles.severityGroup} role="group" aria-label="Severity filter">
          {SEVERITIES.map((severity) => (
            <button
              key={severity}
              type="button"
              aria-pressed={filters.severities.includes(severity)}
              className={`${styles.severityChip} ${
                filters.severities.includes(severity) ? styles.severityChipOn : ''
              }`}
              onClick={() => toggleSeverity(severity)}
            >
              {severity}
            </button>
          ))}
        </div>

        <button className={styles.ghost} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? '☾ dark' : '☀ light'}
        </button>

        <div className={styles.user}>
          <span className={styles.avatar} aria-hidden="true">
            {session.name
              .split(' ')
              .map((part) => part[0])
              .join('')}
          </span>
          <span>
            {session.name}
            <br />
            <span className={styles.userRole}>{session.role}</span>
          </span>
        </div>
      </div>
    </header>
  );
}

function Nav({ remotes, activePath }: { remotes: RegistryEntry[]; activePath: string }): React.ReactElement {
  return (
    <nav className={styles.nav} aria-label="Console sections">
      <span className={styles.navHeading}>Shell</span>
      <a className={`${styles.navLink} ${activePath === '/' ? styles.navLinkActive : ''}`} href="#/">
        Overview
        <span className={styles.navOwner}>platform experience</span>
      </a>

      <span className={styles.navHeading}>Micro frontends</span>
      {remotes.map((entry) => (
        <a
          key={entry.name}
          className={`${styles.navLink} ${activePath === entry.nav.path ? styles.navLinkActive : ''}`}
          href={`#${entry.nav.path}`}
        >
          {entry.nav.label}
          <span className={styles.navOwner}>
            {entry.team.toLowerCase()} · {entry.runtime}
          </span>
        </a>
      ))}

      <p className={styles.navNote}>
        This list is not in the shell&rsquo;s source. It is built from the registry the shell fetched at
        runtime, which is why a new team can appear in the navigation without a shell release.
      </p>
    </nav>
  );
}

function Overview({ registry }: { registry: Registry }): React.ReactElement {
  return (
    <div className={styles.overview}>
      <p className={styles.lede}>
        Everything below the header is loaded at runtime from <strong>separately built bundles</strong> owned
        by other teams. The shell has never imported them, does not know their URLs until it reads the
        registry, and keeps working when any of them fails. Open the panel in the bottom-right to watch it
        happen.
      </p>

      <div className={styles.cards}>
        {registry.remotes.map((entry) => (
          <a key={entry.name} className={styles.card} href={`#${entry.nav.path}`}>
            <span className={styles.badge}>{entry.runtime}</span>
            <span className={styles.cardTitle}>{entry.title}</span>
            <span className={styles.cardMeta}>
              {entry.name}@{entry.current}
            </span>
            <span className={styles.cardMeta}>{entry.team}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function Footer({ registry }: { registry: Registry | null }): React.ReactElement {
  const { loads } = useConsole();
  const failed = loads.filter((record) => record.status === 'failed').length;
  const duplicated = loads.some((record) => record.sharing.some((entry) => entry.verdict === 'duplicated'));

  return (
    <footer className={styles.footer}>
      <span>
        <span className={`${styles.dot} ${failed ? styles.dotBad : ''}`} />
        {registry ? `${registry.remotes.length} remotes registered` : 'registry loading'}
      </span>
      <span>contract {CONTRACT_VERSION}</span>
      <span>react: {duplicated ? 'DUPLICATED — check the shared config' : 'one instance, shared'}</span>
      <span className={styles.spacer}>
        <a href="#/" onClick={() => navigate('/')}>
          Airspace Console
        </a>{' '}
        · a micro frontend reference
      </span>
    </footer>
  );
}

function Toasts(): React.ReactElement {
  const { toasts, dismiss } = useConsole();
  const tone: Record<Severity, string> = {
    info: '',
    advisory: styles.toastAdvisory!,
    warning: styles.toastWarning!,
    critical: styles.toastCritical!,
  };

  return (
    <div className={styles.toasts} aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`${styles.toast} ${tone[toast.severity]}`}>
          <div className={styles.toastBody}>
            <div className={styles.toastTitle}>{toast.title}</div>
            {toast.detail ? <div className={styles.toastDetail}>{toast.detail}</div> : null}
            <div className={styles.toastSource}>via {toast.source}</div>
          </div>
          <button className={styles.toastClose} aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
