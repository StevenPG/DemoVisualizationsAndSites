/**
 * One remote, mounted into one div.
 *
 * This component is the entire host-side integration. Everything about it is
 * shaped by one rule: **a remote's failure must cost the console nothing but
 * that remote's rectangle.** So the DOM node is created by the shell and handed
 * over; the remote's framework roots live inside it and never touch the shell's
 * tree; loading, contract-checking and mounting are wrapped so that a throw
 * anywhere becomes a fallback here rather than a white page.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MicroFrontendHandle, SharedState } from '@airspace/contract';
import { loadMicroFrontend, type Fault, type LoadRecord } from './federation';
import { releaseOf, type RegistryEntry } from './registry';
import { subRoute, usePath } from './router';
import { useConsole } from './console-store';
import styles from './remote-slot.module.css';

/** Keeps a value readable from an effect without making it a dependency. */
function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export function RemoteSlot({ entry, mountPath }: { entry: RegistryEntry; mountPath: string }): React.ReactElement {
  const console_ = useConsole();
  const path = usePath();
  const route = subRoute(mountPath, path);

  const version = console_.pinned[entry.name] ?? entry.current;
  const fault: Fault = console_.faults[entry.name] ?? 'none';

  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<MicroFrontendHandle | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [failure, setFailure] = useState<{ message: string; record?: LoadRecord } | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Memoised so its identity only changes when something a remote can observe
  // changes — see the note on `sharedState` in console-store.tsx.
  const sharedState = console_.sharedState;
  const state: SharedState = useMemo(() => sharedState(route), [sharedState, route]);
  const latest = useLatest({
    state,
    recordLoad: console_.recordLoad,
    services: console_.servicesFor(entry.name, mountPath),
    bus: console_.bus,
  });

  // Load and mount. Deliberately *not* re-run when shared state changes — that
  // flows through handle.update() below. A remote that remounts on every filter
  // change loses its scroll position, its in-flight requests and any trust the
  // user had in it.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    setStatus('loading');
    setFailure(null);

    const release = releaseOf(entry, version);
    if (!release) {
      setFailure({ message: `The registry has no release "${version}" for ${entry.name}.` });
      setStatus('failed');
      return;
    }

    loadMicroFrontend(entry, release, fault)
      .then(({ module, record }) => {
        if (cancelled) return;
        latest.current.recordLoad(record);

        // A fresh node per mount, never the ref'd node itself. React 19 roots
        // are torn down asynchronously (see the adapter's queueMicrotask), so
        // reusing one container means an outgoing root can clear the DOM out
        // from under the incoming one — which is exactly what StrictMode's
        // double-invoke does on the very first render in development.
        const host = document.createElement('div');
        host.className = styles.host ?? '';
        container.replaceChildren(host);

        const mountedAt = performance.now();
        handleRef.current = module.mount({
          container: host,
          state: latest.current.state,
          services: latest.current.services,
          bus: latest.current.bus.forSource(entry.name),
          onError: (error) => {
            // The remote caught something it could not recover from. Tear it
            // down rather than leave a half-rendered app on screen, and let the
            // user retry — most of these are transient.
            handleRef.current?.unmount();
            handleRef.current = null;
            host.remove();
            setFailure({ message: error instanceof Error ? error.message : String(error) });
            setStatus('failed');
          },
        });
        setStatus('ready');
        latest.current.bus.publish('remote:ready', {
          remote: entry.name,
          mountMs: Math.round(performance.now() - mountedAt),
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const record = (error as { record?: LoadRecord }).record;
        if (record) latest.current.recordLoad(record);
        setFailure({ message: error instanceof Error ? error.message : String(error), record });
        setStatus('failed');
      });

    return () => {
      cancelled = true;
      handleRef.current?.unmount();
      handleRef.current = null;
      // The remote's framework tears down its own tree; this catches anything
      // it appended outside of that, which is a real thing remotes do.
      container.replaceChildren();
    };
  }, [entry, version, fault, attempt, console_.epoch, latest]);

  // Shell-owned state changed: hand the remote a new snapshot. Cheap, and it
  // keeps the remote mounted.
  useEffect(() => {
    if (status === 'ready') handleRef.current?.update(state);
  }, [status, state]);

  return (
    <div className={styles.slot} data-remote={entry.name} data-status={status}>
      {status === 'loading' ? (
        <div className={styles.loading} role="status">
          <span className={styles.spinner} aria-hidden="true" />
          <div>
            <strong>{entry.title}</strong>
            <p>
              fetching {entry.name}@{version} from {entry.team}
              {fault === 'slow' ? ' · fault injected: slow edge' : ''}
            </p>
          </div>
        </div>
      ) : null}

      {status === 'failed' && failure ? (
        <div className={styles.failure} role="alert">
          <h2>{entry.title} is unavailable</h2>
          <p className={styles.failureMessage}>{failure.message}</p>
          <p className={styles.failureMeta}>
            Owned by <strong>{entry.team}</strong> · {entry.name}@{version}
            {failure.record ? ` · failed after ${failure.record.ms}ms` : ''}
          </p>
          <p className={styles.failureNote}>
            The rest of the console is unaffected — this is one remote's rectangle, not the page.
          </p>
          <button className={styles.retry} onClick={() => setAttempt((value) => value + 1)}>
            Retry
          </button>
        </div>
      ) : null}

      {/*
        The remote's territory. React renders no children into it, ever, so the
        remote's own framework is free to own every node inside.
      */}
      <div ref={containerRef} className={styles.mount} hidden={status !== 'ready'} />
    </div>
  );
}
