/**
 * @airspace/contract/react — the React adapter.
 *
 * The contract itself is a DOM node and a handle (see ./index.ts). That is what
 * makes a Svelte remote possible. But every React team would otherwise write
 * the same forty lines of createRoot/re-render/unmount plumbing and get the
 * subtle parts wrong, so the adapter ships once, here.
 *
 * Nothing in this file is privileged: `defineReactRemote` produces exactly the
 * same `MicroFrontendModule` a team could hand-roll, and the shell cannot tell
 * which remotes used it.
 */
import * as React from 'react';
import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import type { ComponentType, ReactNode } from 'react';
import * as ReactDOMClient from 'react-dom/client';
import { createRoot, type Root } from 'react-dom/client';
import {
  CONTRACT_VERSION,
  type AirspaceEvent,
  type AirspaceEventMap,
  type BusMessage,
  type EventBus,
  type MicroFrontendHandle,
  type MicroFrontendModule,
  type MountContext,
  type RemoteMeta,
  type SubscribeOptions,
  type SharedState,
  type ShellServices,
} from './index';

/**
 * Shell-owned state changes far more often than it is read, and a remote's
 * component tree is not the shell's to re-render wholesale. Holding state in a
 * tiny external store and reading it through `useSyncExternalStore` means an
 * `update()` only re-renders the components that actually subscribed.
 */
class SharedStateStore {
  private listeners = new Set<() => void>();

  constructor(private snapshot: SharedState) {}

  get = (): SharedState => this.snapshot;

  set = (next: SharedState): void => {
    if (next === this.snapshot) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

interface RemoteRuntime {
  store: SharedStateStore;
  services: ShellServices;
  bus: EventBus;
  meta: RemoteMeta;
}

const RuntimeContext = createContext<RemoteRuntime | null>(null);

const useRuntime = (): RemoteRuntime => {
  const runtime = useContext(RuntimeContext);
  if (!runtime) {
    throw new Error(
      'No shell runtime in context. This component is being rendered outside the tree that ' +
        'defineReactRemote() mounts — which usually means it was imported directly instead of ' +
        'loaded through the shell.',
    );
  }
  return runtime;
};

/** Shell-owned state: filters, theme, session, and this remote's sub-route. */
export const useSharedState = (): SharedState => {
  const { store } = useRuntime();
  return useSyncExternalStore(store.subscribe, store.get, store.get);
};

/** Toasts, navigation, tokens, telemetry. */
export const useShellServices = (): ShellServices => useRuntime().services;

/** Who this remote is, as the shell sees it. */
export const useRemoteMeta = (): RemoteMeta => useRuntime().meta;

/** Raw bus access, for the rare case the hook below does not fit. */
export const useEventBus = (): EventBus => useRuntime().bus;

/**
 * Subscribe for the lifetime of the component.
 *
 * The handler is stashed in a ref-free closure over `handler` on purpose: the
 * effect re-subscribes when the handler identity changes, which is the correct
 * behaviour for a demo (obvious, no stale closures) and cheap enough that the
 * usual `useEffectEvent` dance would be premature.
 */
export function useBusEvent<K extends AirspaceEvent>(
  type: K,
  handler: (payload: AirspaceEventMap[K], message: BusMessage<K>) => void,
  options?: SubscribeOptions,
): void {
  const bus = useEventBus();
  const replayLast = options?.replayLast ?? false;
  useEffect(() => bus.subscribe(type, handler, { replayLast }), [bus, type, handler, replayLast]);
}

/**
 * The remote's own boundary.
 *
 * It reports upward and renders nothing: the shell already has a fallback with
 * a retry button, and two competing error UIs on one page is how a console ends
 * up looking like four products. Teams that want their own in-place recovery
 * put a boundary lower in their tree, where they know what to say.
 */
class RemoteErrorBoundary extends React.Component<
  { children: ReactNode; onError: (error: unknown) => void },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError(error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export interface ReactRemoteProps {
  /** Convenience: the same value `useSharedState()` returns at mount time. */
  initialState: SharedState;
}

/**
 * Wrap a React component as a micro frontend.
 *
 *   export default defineReactRemote(
 *     { name: 'ops-board', title: 'Operations Board', team: 'Airspace Ops', version: '2026.8.0', runtime: 'react' },
 *     OpsBoard,
 *   );
 */
export function defineReactRemote(
  meta: RemoteMeta,
  Component: ComponentType<ReactRemoteProps>,
  options: { wrap?: (children: ReactNode) => ReactNode } = {},
): MicroFrontendModule {
  return {
    contractVersion: CONTRACT_VERSION,
    meta,

    // Exports *this bundle* resolved, for the shell to compare by reference.
    // If federation is sharing correctly these are the identical functions the
    // shell holds — which is a much stronger claim than "both say 19.2.8",
    // since two copies would happily report the same version while fighting
    // over the hook dispatcher.
    diagnostics: {
      probes: { react: React.useState, 'react-dom/client': ReactDOMClient.createRoot },
      versions: { react: React.version },
    },

    mount(context: MountContext): MicroFrontendHandle {
      const store = new SharedStateStore(context.state);
      const runtime: RemoteRuntime = { store, services: context.services, bus: context.bus, meta };

      let root: Root | null = createRoot(context.container, {
        // Errors that escape the remote's own boundaries still must not reach
        // the shell's React tree — separate roots already guarantee that, but
        // naming the remote in the log is the difference between a five-minute
        // and a fifty-minute page.
        onUncaughtError: (error) => console.error(`[${meta.name}] uncaught`, error),
      });

      const tree = (
        <RuntimeContext.Provider value={runtime}>
          <RemoteErrorBoundary onError={context.onError}>
            <Component initialState={context.state} />
          </RemoteErrorBoundary>
        </RuntimeContext.Provider>
      );
      root.render(options.wrap ? options.wrap(tree) : tree);

      return {
        update(state) {
          store.set(state);
        },
        unmount() {
          const pending = root;
          root = null;
          // Deferred, because the shell unmounts a remote from its own effect
          // cleanup — i.e. while React is committing. Tearing down a second
          // root synchronously inside that commit is the classic "attempted to
          // synchronously unmount a root while React was already rendering"
          // warning, and it leaves the DOM in a half-torn state.
          queueMicrotask(() => pending?.unmount());
        },
      };
    },
  };
}
