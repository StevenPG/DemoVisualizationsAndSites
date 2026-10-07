/**
 * The shell's own state, and the services it hands to remotes.
 *
 * Two things live here that are easy to get wrong:
 *
 *  1. **Services are minted per remote, not shared.** Each remote gets its own
 *     `ShellServices` object closed over its identity, so relative navigation
 *     resolves against the right mount point and every call can be attributed
 *     without asking the caller to identify itself. Attribution you have to ask
 *     for is attribution you do not have.
 *  2. **Shared state is one object, replaced whole.** Remotes receive an
 *     immutable `SharedState` and get a new one on every change. No remote can
 *     mutate what another remote reads, and `update()` is cheap to reason about
 *     because it is just "here is the new value".
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  createEventBus,
  type BusMessage,
  type NotificationInput,
  type OpsFilters,
  type SessionUser,
  type Severity,
  type SharedState,
  type ShellServices,
  type Theme,
} from '@airspace/contract';
import type { Fault, LoadRecord } from './federation';
import { navigate, resolveFrom } from './router';

export interface Toast extends NotificationInput {
  id: string;
  source: string;
  at: number;
}

/** A call a remote made into the shell, for the contract inspector. */
export interface ServiceCall {
  id: string;
  source: string;
  method: keyof ShellServices;
  detail: string;
  at: number;
}

const SESSION: SessionUser = {
  id: 'u-4471',
  name: 'Dana Whitfield',
  role: 'supervisor',
  scopes: ['flights:read', 'flights:clear', 'analytics:read', 'notams:read'],
};

interface ConsoleValue {
  filters: OpsFilters;
  setFilters: (next: Partial<OpsFilters>) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  session: SessionUser;

  toasts: Toast[];
  dismiss: (id: string) => void;

  /** Per-remote injected fault, keyed by remote name. */
  faults: Record<string, Fault>;
  setFault: (remote: string, fault: Fault) => void;
  /** Per-remote pinned release, keyed by remote name. Absent means "registry default". */
  pinned: Record<string, string>;
  pin: (remote: string, version: string) => void;

  loads: LoadRecord[];
  recordLoad: (record: LoadRecord) => void;

  busLog: BusMessage[];
  serviceLog: ServiceCall[];
  clearLogs: () => void;

  /** Bumping this forces every mounted remote to reload from scratch. */
  epoch: number;
  reloadAll: () => void;

  bus: ReturnType<typeof createEventBus>;
  servicesFor: (remote: string, mountPath: string) => ShellServices;
  sharedState: (route: string) => SharedState;
}

const ConsoleContext = createContext<ConsoleValue | null>(null);

export const useConsole = (): ConsoleValue => {
  const value = useContext(ConsoleContext);
  if (!value) throw new Error('useConsole outside of <ConsoleProvider>');
  return value;
};

const LOG_LIMIT = 120;
const trim = <T,>(items: T[], next: T): T[] => [next, ...items].slice(0, LOG_LIMIT);

export function ConsoleProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [filters, setFiltersState] = useState<OpsFilters>({
    sector: 'ZTL-38',
    window: '1h',
    severities: ['info', 'advisory', 'warning', 'critical'],
  });
  const [theme, setThemeState] = useState<Theme>('dark');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [faults, setFaults] = useState<Record<string, Fault>>({});
  const [pinned, setPinned] = useState<Record<string, string>>({});
  const [loads, setLoads] = useState<LoadRecord[]>([]);
  const [busLog, setBusLog] = useState<BusMessage[]>([]);
  const [serviceLog, setServiceLog] = useState<ServiceCall[]>([]);
  const [epoch, setEpoch] = useState(0);
  const counter = useRef(0);
  const nextId = () => `${Date.now().toString(36)}-${counter.current++}`;

  // One bus for the whole page, created once. Remotes get views of it stamped
  // with their own name.
  const bus = useMemo(() => {
    const created = createEventBus();
    created.observe((message) => setBusLog((log) => trim(log, message)));
    return created;
  }, []);

  const dismiss = useCallback((id: string) => setToasts((all) => all.filter((toast) => toast.id !== id)), []);

  const push = useCallback(
    (source: string, input: NotificationInput) => {
      const toast: Toast = { ...input, id: nextId(), source, at: Date.now() };
      setToasts((all) => [toast, ...all].slice(0, 4));
      if (input.timeoutMs) setTimeout(() => dismiss(toast.id), input.timeoutMs);
    },
    [dismiss],
  );

  // Alerts from any remote become toasts. The shell decides how an alert looks;
  // remotes only decide that one happened. That is the split that keeps four
  // teams from shipping four notification designs.
  //
  // No `replayLast` here, deliberately: replaying an alert would re-raise a
  // toast the user already dismissed every time this effect re-ran.
  useEffect(
    () =>
      bus.subscribe('alert:raised', (payload, message) => {
        if (message.source === 'shell') return;
        push(message.source, { severity: payload.severity, title: payload.message, timeoutMs: 7000 });
      }),
    [bus, push],
  );

  const servicesFor = useCallback(
    (remote: string, mountPath: string): ShellServices => {
      const log = (method: keyof ShellServices, detail: string) =>
        setServiceLog((all) => trim(all, { id: nextId(), source: remote, method, detail, at: Date.now() }));

      return {
        notify: (input) => {
          log('notify', `${input.severity}: ${input.title}`);
          push(remote, input);
        },
        navigate: (to, options) => {
          const resolved = resolveFrom(mountPath, to);
          log('navigate', `${to} → ${resolved}`);
          navigate(resolved, options);
        },
        getAccessToken: async (scope) => {
          log('getAccessToken', scope);
          // The shell owns the session, so it owns refresh. A remote never sees
          // a credential, never renders a login screen, and cannot be the
          // reason a token leaks into a third-party bundle.
          if (!SESSION.scopes.includes(scope)) {
            throw new Error(`Session lacks the "${scope}" scope.`);
          }
          await new Promise((resolve) => setTimeout(resolve, 30));
          return `demo.${scope}.${SESSION.id}`;
        },
        track: (event, properties) => {
          log('track', properties ? `${event} ${JSON.stringify(properties)}` : event);
        },
      };
    },
    [push],
  );

  /**
   * Stable as long as the state a remote can see is stable.
   *
   * Identity matters more than it looks: `RemoteSlot` memoises on this and
   * hands the result to `handle.update()`. Rebuilding the object on every shell
   * render — and the shell renders whenever a toast appears or the inspector
   * logs a line — would push a "new" state into every mounted remote several
   * times a second, re-rendering three applications to say nothing changed.
   */
  const sharedState = useCallback(
    (route: string): SharedState => ({ filters, theme, session: SESSION, route }),
    [filters, theme],
  );

  const value: ConsoleValue = {
    filters,
    setFilters: (next) => setFiltersState((current) => ({ ...current, ...next })),
    theme,
    setTheme: (next) => {
      setThemeState(next);
      document.documentElement.dataset.theme = next;
    },
    session: SESSION,
    toasts,
    dismiss,
    faults,
    setFault: (remote, fault) => setFaults((all) => ({ ...all, [remote]: fault })),
    pinned,
    pin: (remote, version) => setPinned((all) => ({ ...all, [remote]: version })),
    loads,
    recordLoad: (record) => setLoads((all) => trim(all, record)),
    busLog,
    serviceLog,
    clearLogs: () => {
      setBusLog([]);
      setServiceLog([]);
    },
    epoch,
    reloadAll: () => setEpoch((value) => value + 1),
    bus,
    servicesFor,
    sharedState,
  };

  return <ConsoleContext.Provider value={value}>{children}</ConsoleContext.Provider>;
}

export const SEVERITIES: readonly Severity[] = ['info', 'advisory', 'warning', 'critical'];
