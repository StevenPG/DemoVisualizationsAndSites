/**
 * @airspace/contract — the integration surface between the shell and every
 * micro frontend.
 *
 * This package is the *whole* agreement between the teams. If something is not
 * in here, one team is depending on another team's implementation detail, and
 * the independent-deploy property is already gone.
 *
 * Three rules keep it useful:
 *
 *  1. **It is framework-neutral.** The shell hands a remote a DOM node and gets
 *     back a handle. React lives on one side of that line, Svelte on another,
 *     and neither team has to care. The React adapter in `./react` is a
 *     convenience built *on top of* the neutral contract, not a second contract.
 *  2. **It is versioned, and the version is checked at runtime.** Remotes are
 *     deployed independently, so at any moment a remote built against contract
 *     1.1 can be loaded by a shell on 1.2. `checkCompatibility` decides whether
 *     that is fine or fatal, at the boundary, with a readable message.
 *  3. **It carries no UI and no business logic.** Only types, a typed event bus
 *     and the version check. That is why it can be a hard dependency of every
 *     team without becoming a bottleneck.
 */

/**
 * Semver. The major is the breaking-change signal: a remote built against
 * major N is refused by a shell on major N+1 rather than mounted and left to
 * fail somewhere less obvious.
 *
 * Bump the minor when you add optional fields (as 1.1 → 1.2 added
 * `state.route`), and remotes that predate the field keep working.
 */
export const CONTRACT_VERSION = '1.2.0';

/* -------------------------------------------------------------------------- */
/* Shared domain types                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Deliberately minimal. Domain types in the contract are types that cross the
 * boundary — anything a remote uses only internally (flight plans, NOTAM
 * bodies, chart series) belongs to that remote and must not leak in here, or
 * every schema change becomes a cross-team release.
 */
export type SectorId = 'ZTL-38' | 'ZTL-42' | 'ZJX-17' | 'ZDC-09';

export interface Sector {
  id: SectorId;
  name: string;
  center: readonly [lat: number, lon: number];
}

export const SECTORS: readonly Sector[] = [
  { id: 'ZTL-38', name: 'Atlanta High — 38', center: [33.64, -84.43] },
  { id: 'ZTL-42', name: 'Atlanta Low — 42', center: [33.95, -83.99] },
  { id: 'ZJX-17', name: 'Jacksonville — 17', center: [30.49, -81.69] },
  { id: 'ZDC-09', name: 'Washington — 09', center: [38.94, -77.46] },
];

export type TimeWindow = '15m' | '1h' | '6h' | '24h';

export type Severity = 'info' | 'advisory' | 'warning' | 'critical';

export type Theme = 'dark' | 'light';

/** The global filter bar lives in the shell; every remote reads it, none owns it. */
export interface OpsFilters {
  sector: SectorId;
  window: TimeWindow;
  /** Empty means "no filter", not "nothing". */
  severities: readonly Severity[];
}

export interface SessionUser {
  id: string;
  name: string;
  role: 'controller' | 'supervisor' | 'analyst';
  /** Scopes the shell has, which a remote may check before showing an action. */
  scopes: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Shell → remote: state                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Everything the shell owns and the remote may read. Passed at mount and again
 * on every change via `handle.update()`.
 *
 * Read-only on purpose: a remote that wants to change shared state asks, via
 * `services`, rather than mutating an object the shell also holds. One writer.
 */
export interface SharedState {
  readonly filters: OpsFilters;
  readonly theme: Theme;
  readonly session: SessionUser;
  /**
   * The remote's own sub-route: the part of the URL below its mount point,
   * always starting with '/'. The shell owns history — there is exactly one
   * router on the page — and a remote navigates by calling
   * `services.navigate()`. The demo's README has the argument for why that beats
   * nesting a second router inside every remote.
   */
  readonly route: string;
}

/* -------------------------------------------------------------------------- */
/* Shell → remote: services                                                   */
/* -------------------------------------------------------------------------- */

export interface NotificationInput {
  severity: Severity;
  title: string;
  detail?: string;
  /** Auto-dismiss after this many ms; omit for sticky. */
  timeoutMs?: number;
}

/**
 * Capabilities the shell provides so remotes do not each grow their own copy.
 *
 * The test for "does this belong in services?" is: would two teams otherwise
 * implement it twice and get it visibly inconsistent? Toasts, auth tokens,
 * navigation and telemetry pass. Data fetching does not — each remote owns its
 * own API client, because sharing that couples the teams' release trains to
 * one schema.
 */
export interface ShellServices {
  /** Raise a toast in the shell's notification area. */
  notify(input: NotificationInput): void;

  /**
   * Navigate. Absolute paths ('/analytics/trends') address the whole console;
   * relative ones ('flights/DAL231') resolve inside the calling remote.
   */
  navigate(to: string, options?: { replace?: boolean }): void;

  /**
   * An access token for calling *your own* backend. The shell owns the session
   * so tokens refresh in one place; scopes are enforced server-side.
   */
  getAccessToken(scope: string): Promise<string>;

  /** Product analytics, funnelled through one pipeline with one schema. */
  track(event: string, properties?: Record<string, unknown>): void;
}

/* -------------------------------------------------------------------------- */
/* Remote ↔ remote: the event bus                                             */
/* -------------------------------------------------------------------------- */

/**
 * The only channel between remotes. Remotes never import each other: a
 * direct import is a build-time dependency, which is exactly the coupling
 * micro frontends exist to avoid.
 *
 * Events are facts about what happened, never commands. "flight:selected" can
 * be ignored by every listener without breaking the emitter; "openFlightPanel"
 * could not, and would quietly make the emitter depend on a listener existing.
 */
export interface AirspaceEventMap {
  /** A flight became the user's focus somewhere in the console. */
  'flight:selected': { flightId: string; callsign: string; sector: SectorId };
  /** Focus was released. */
  'flight:deselected': Record<string, never>;
  /** Something needs a human's attention; the shell turns these into toasts. */
  'alert:raised': { id: string; severity: Severity; message: string };
  /** A remote finished its first paint — used by the shell's load telemetry. */
  'remote:ready': { remote: string; mountMs: number };
}

export type AirspaceEvent = keyof AirspaceEventMap;

export interface BusMessage<K extends AirspaceEvent = AirspaceEvent> {
  type: K;
  payload: AirspaceEventMap[K];
  /** Which app published it. Set by the bus, not by the publisher. */
  source: string;
  at: number;
}

export type Unsubscribe = () => void;

export interface SubscribeOptions {
  /**
   * Deliver the most recent message of this type immediately on subscribe, if
   * there has been one.
   *
   * This exists because micro frontends mount at different times, and a bus
   * without it quietly loses the most useful case: the user selects a flight in
   * one app, opens another, and the second app has no idea — it subscribed a
   * second too late. Passing shared *state* through the shell instead would fix
   * that at the cost of putting every remote's concerns into the shell.
   *
   * Opt-in per subscription rather than always-on, because replay is wrong for
   * anything with a side effect: replaying `alert:raised` into the shell would
   * re-raise a toast the user already dismissed on every remount.
   */
  replayLast?: boolean;
}

export interface EventBus {
  publish<K extends AirspaceEvent>(type: K, payload: AirspaceEventMap[K]): void;
  subscribe<K extends AirspaceEvent>(
    type: K,
    handler: (payload: AirspaceEventMap[K], message: BusMessage<K>) => void,
    options?: SubscribeOptions,
  ): Unsubscribe;
  /** Every message, for the shell's inspector. Not for application logic. */
  observe(handler: (message: BusMessage) => void): Unsubscribe;
}

/* -------------------------------------------------------------------------- */
/* The mount contract                                                         */
/* -------------------------------------------------------------------------- */

export interface RemoteMeta {
  /** Stable id, matching the registry entry. */
  name: string;
  /** Human-readable, shown in the shell's chrome. */
  title: string;
  /** Who to page when it breaks. This is not decoration — it is the point. */
  team: string;
  /** The remote's own release version, independent of everyone else's. */
  version: string;
  /** What it was built with, so the console can prove the boundary is neutral. */
  runtime: 'react' | 'svelte' | 'vanilla' | (string & {});
}

export interface MountContext {
  /** The remote owns everything inside this node and nothing outside it. */
  container: HTMLElement;
  state: SharedState;
  services: ShellServices;
  bus: EventBus;
  /**
   * Report a failure the remote could not recover from; the shell swaps in its
   * standard fallback with a retry.
   *
   * This exists because separate framework roots mean the shell's own error
   * boundary can never see inside a remote — which is excellent for blast
   * radius and useless for reporting. So the remote catches its own errors (the
   * React adapter does it for you) and hands them over here. The alternative,
   * a remote that renders a blank div and says nothing, is the worst of both.
   */
  onError(error: unknown): void;
}

export interface MicroFrontendHandle {
  /** Shell-owned state changed. Called often; make it cheap. */
  update(state: SharedState): void;
  /** Release everything: listeners, timers, sockets, framework roots. */
  unmount(): void;
}

/**
 * Optional identity probes.
 *
 * Whether a shared dependency is *actually* shared is the one thing about
 * Module Federation you cannot tell by looking. Two React copies do not throw
 * on load — they throw later, somewhere else, as "invalid hook call". So each
 * remote can hand the shell the module objects it resolved, and the shell
 * compares them by reference against its own: same object, genuinely one copy.
 *
 * Diagnostics only. Nothing in the console changes behaviour based on them.
 */
export interface RemoteDiagnostics {
  /**
   * One stable *export* per shared dependency — `React.useState`, not `React`.
   *
   * The obvious version of this probe compares the module namespace objects and
   * reports a false duplicate every time. React ships as CommonJS, and the ESM
   * interop hands each consuming module graph its own namespace wrapper around
   * the same underlying instance, so `remoteReact === hostReact` is false even
   * when federation is sharing perfectly. A function off the exports object is
   * the same reference or a different one, with no wrapper in between.
   */
  probes?: Readonly<Record<string, unknown>>;
  /** e.g. `{ react: '19.2.8' }`. Necessary but nowhere near sufficient. */
  versions?: Readonly<Record<string, string>>;
}

/**
 * What a remote's federated module must export as `default`.
 *
 * That is the entire technical contract. Everything else in this file exists
 * to describe the arguments to `mount`.
 */
export interface MicroFrontendModule {
  contractVersion: string;
  meta: RemoteMeta;
  mount(context: MountContext): MicroFrontendHandle;
  diagnostics?: RemoteDiagnostics;
}

/* -------------------------------------------------------------------------- */
/* Version checking                                                           */
/* -------------------------------------------------------------------------- */

export interface CompatibilityResult {
  ok: boolean;
  /** True when it will work but the pair is not identical — worth logging. */
  degraded: boolean;
  message: string;
}

const parse = (version: string): [number, number, number] => {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map((part) => Number.parseInt(part, 10) || 0);
  return [major, minor, patch];
};

/**
 * Decides whether a shell on `host` may mount a remote built against `remote`.
 *
 * The interesting case is the middle one. A remote built against an *older*
 * minor is fine — it simply ignores fields it does not know about. A remote
 * built against a *newer* minor is also mounted, because refusing it would mean
 * the contract can never be rolled out remote-first; it is flagged instead, so
 * "the new field is undefined" shows up in the console rather than as a
 * mystery. Only a major mismatch is fatal.
 */
export function checkCompatibility(remote: string, host: string = CONTRACT_VERSION): CompatibilityResult {
  const [remoteMajor, remoteMinor] = parse(remote);
  const [hostMajor, hostMinor] = parse(host);

  if (remoteMajor !== hostMajor) {
    return {
      ok: false,
      degraded: false,
      message:
        `Contract major mismatch: remote was built against ${remote}, shell speaks ${host}. ` +
        `Refusing to mount — a major bump means a field this remote requires is gone.`,
    };
  }
  if (remoteMinor > hostMinor) {
    return {
      ok: true,
      degraded: true,
      message:
        `Remote is ahead of the shell (${remote} > ${host}). Mounting anyway: additive changes are ` +
        `backwards compatible, but anything added after ${host} will be undefined until the shell ships.`,
    };
  }
  if (remoteMinor < hostMinor) {
    return {
      ok: true,
      degraded: false,
      message: `Remote is behind the shell (${remote} < ${host}), which is expected and safe.`,
    };
  }
  return { ok: true, degraded: false, message: `Contract ${remote} on both sides.` };
}

/* -------------------------------------------------------------------------- */
/* Bus implementation                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Created once by the shell; each remote gets a view of it stamped with its own
 * name so the inspector — and anyone reading a log — can tell who published
 * what without asking the publisher to remember to say.
 */
export function createEventBus(): EventBus & { forSource(source: string): EventBus } {
  // Erased to the union internally: a Map cannot remember a different payload
  // type per key, and pretending otherwise just moves the cast somewhere less
  // obvious. `subscribe` and `publish` are still fully typed at the call site,
  // which is where it matters.
  type Listener = (payload: AirspaceEventMap[AirspaceEvent], message: BusMessage) => void;

  const handlers = new Map<AirspaceEvent, Set<Listener>>();
  const observers = new Set<(message: BusMessage) => void>();
  const lastByType = new Map<AirspaceEvent, BusMessage>();

  const publishAs = (source: string) => <K extends AirspaceEvent>(type: K, payload: AirspaceEventMap[K]) => {
    const message: BusMessage<K> = { type, payload, source, at: Date.now() };
    lastByType.set(type, message as BusMessage);
    for (const observer of observers) observer(message as BusMessage);
    for (const handler of handlers.get(type) ?? []) {
      // One misbehaving subscriber must not stop the others, and must not take
      // down the publisher: a remote that throws in a handler is that team's
      // bug, contained to that team.
      try {
        handler(payload, message as BusMessage);
      } catch (error) {
        console.error(`[bus] subscriber of "${type}" threw`, error);
      }
    }
  };

  const subscribe: EventBus['subscribe'] = (type, handler, options) => {
    const set = handlers.get(type) ?? new Set<Listener>();
    handlers.set(type, set);
    set.add(handler as Listener);

    const last = options?.replayLast ? lastByType.get(type) : undefined;
    if (last) {
      // Asynchronously, so subscribing never re-enters the caller mid-render —
      // a replayed message that synchronously calls setState from inside a
      // component's effect body is a warning at best and a loop at worst.
      queueMicrotask(() => {
        if (set.has(handler as Listener)) (handler as Listener)(last.payload, last);
      });
    }

    return () => set.delete(handler as Listener);
  };

  const observe: EventBus['observe'] = (handler) => {
    observers.add(handler);
    return () => observers.delete(handler);
  };

  return {
    publish: publishAs('shell'),
    subscribe,
    observe,
    forSource: (source) => ({ publish: publishAs(source), subscribe, observe }),
  };
}
