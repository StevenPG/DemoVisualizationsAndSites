/**
 * The shell owns history. All of it.
 *
 * There is exactly one router on the page, and it lives here. Remotes receive
 * the slice of the path below their mount point as a plain string, and change
 * it by calling `services.navigate()`. They never touch `history`, never
 * install a listener, and never need to agree with each other about a routing
 * library.
 *
 * The alternative — every remote nesting its own router under a `basename` —
 * works, and is what most Module Federation examples show, but it means each
 * team ships a router, they all race to write the same URL, and the console's
 * back button behaves differently depending on which app is mounted. Handing
 * down a string costs one prop and cannot fight with itself.
 *
 * ## Why the hash
 *
 * This console is deployed as static files under /demos/<slug>/ with no server
 * rewrite rules, so a real path like /demos/<slug>/ops/flights/DAL231 would
 * 404 on reload. The hash keeps deep links working with no server involved. On
 * infrastructure you control, drop the '#' and add a catch-all rewrite to
 * index.html — everything else in this file, and the whole contract, is
 * unchanged.
 *
 * ## Why not react-router
 *
 * Because the shell's job here is to turn a URL into "which remote, and what is
 * its sub-path", and that is these forty lines. Swap in react-router or TanStack
 * Router if the shell's own pages grow to need them: the only thing that must
 * survive is that `SharedState.route` keeps being a string the shell computes.
 */
import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let snapshot = readPath();

function readPath(): string {
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function publish(): void {
  const next = readPath();
  if (next === snapshot) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') window.addEventListener('hashchange', publish);

/** The console's current path, e.g. '/ops/flights/DAL231'. */
export function usePath(): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot,
  );
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const target = `#${to.startsWith('/') ? to : `/${to}`}`;
  if (options.replace) {
    history.replaceState(null, '', target);
    publish();
  } else {
    location.hash = target;
  }
}

/**
 * Resolves a remote's navigation request against the path it is mounted at.
 *
 * Absolute ('/analytics/trends') addresses the whole console — a remote linking
 * to another area, which is legitimate and only depends on the registry's nav
 * paths, not on the other team's code. Relative ('flights/DAL231', or '' for
 * the remote's own root) stays inside the caller.
 */
export function resolveFrom(mountPath: string, to: string): string {
  if (to.startsWith('/')) return to;
  const trimmed = to.replace(/^\.?\/*/, '');
  return trimmed ? `${mountPath}/${trimmed}` : mountPath;
}

/** The part of `path` below `mountPath`, always starting with '/'. */
export function subRoute(mountPath: string, path: string): string {
  if (!path.startsWith(mountPath)) return '/';
  const rest = path.slice(mountPath.length);
  if (!rest) return '/';
  return rest.startsWith('/') ? rest : `/${rest}`;
}
