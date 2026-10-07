/**
 * @airspace/contract/harness — a mock shell, shipped with the contract.
 *
 * The single most expensive failure mode in a micro frontend programme is a
 * team that cannot run its own app without running everybody else's. It starts
 * as "just clone the shell too", becomes "and the other three remotes", and
 * ends with a shared dev environment, a shared branch and no independent
 * deploys left.
 *
 * So the contract ships the shell's *behaviour* alongside its types. Team B
 * runs `npm run dev` in their folder and gets a real page with real filters,
 * real toasts and a real bus, without Team A's code on their machine. The
 * harness is also the natural place to write integration tests against.
 *
 * It deliberately does not look like the production shell. Anything that
 * matters — spacing, colour, chrome — is the shell's, and a harness that
 * imitates it teaches teams to build against pixels they do not own.
 */
import {
  CONTRACT_VERSION,
  createEventBus,
  type MicroFrontendModule,
  type MountContext,
  type NotificationInput,
  type OpsFilters,
  type SessionUser,
  type SharedState,
  type ShellServices,
  type Theme,
} from './index';

export interface MockShellOptions {
  filters?: Partial<OpsFilters>;
  session?: Partial<SessionUser>;
  theme?: Theme;
  route?: string;
}

const DEFAULT_SESSION: SessionUser = {
  id: 'u-4471',
  name: 'Dana Whitfield',
  role: 'supervisor',
  scopes: ['flights:read', 'flights:clear', 'analytics:read'],
};

const DEFAULT_FILTERS: OpsFilters = {
  sector: 'ZTL-38',
  window: '1h',
  severities: ['advisory', 'warning', 'critical'],
};

/**
 * Mounts a micro frontend into `document.body` with a working stand-in shell.
 *
 *   import mfe from './mfe';
 *   mountInMockShell(mfe);
 */
export function mountInMockShell(module: MicroFrontendModule, options: MockShellOptions = {}): void {
  const page = document.createElement('div');
  page.className = 'mock-shell';
  page.innerHTML = `
    <header class="mock-shell__bar">
      <strong>mock shell</strong>
      <span class="mock-shell__meta"></span>
      <label>sector <select data-field="sector">
        <option>ZTL-38</option><option>ZTL-42</option><option>ZJX-17</option><option>ZDC-09</option>
      </select></label>
      <label>window <select data-field="window">
        <option>15m</option><option selected>1h</option><option>6h</option><option>24h</option>
      </select></label>
      <label>theme <select data-field="theme">
        <option>dark</option><option>light</option>
      </select></label>
    </header>
    <main class="mock-shell__slot"></main>
    <aside class="mock-shell__log" aria-label="shell activity"></aside>`;
  document.body.append(page);
  injectHarnessStyles();

  const log = page.querySelector<HTMLElement>('.mock-shell__log')!;
  const container = page.querySelector<HTMLElement>('.mock-shell__slot')!;
  const write = (kind: string, text: string) => {
    const line = document.createElement('div');
    line.className = `mock-shell__line mock-shell__line--${kind}`;
    line.textContent = `${new Date().toLocaleTimeString()} ${text}`;
    log.prepend(line);
    while (log.childElementCount > 60) log.lastElementChild?.remove();
  };

  const bus = createEventBus();
  bus.observe((message) => write('bus', `${message.source} → ${message.type} ${JSON.stringify(message.payload)}`));

  const services: ShellServices = {
    notify: (input: NotificationInput) => write('notify', `[${input.severity}] ${input.title}`),
    navigate: (to, opts) => {
      state = { ...state, route: to.startsWith('/') ? to : `/${to}` };
      write('nav', `navigate("${to}")${opts?.replace ? ' (replace)' : ''}`);
      handle.update(state);
    },
    getAccessToken: async (scope) => {
      write('auth', `token for "${scope}"`);
      return `mock-token.${scope}`;
    },
    track: (event, properties) => write('track', `${event} ${properties ? JSON.stringify(properties) : ''}`),
  };

  let state: SharedState = {
    filters: { ...DEFAULT_FILTERS, ...options.filters },
    theme: options.theme ?? 'dark',
    session: { ...DEFAULT_SESSION, ...options.session },
    route: options.route ?? '/',
  };

  const context: MountContext = {
    container,
    state,
    services,
    bus: bus.forSource(module.meta.name),
    onError: (error) => {
      write('error', `unhandled: ${error instanceof Error ? error.message : String(error)}`);
      container.innerHTML =
        '<p style="color:#f85149">This remote reported an unrecoverable error. ' +
        'The real shell would show its fallback with a retry here.</p>';
    },
  };
  const handle = module.mount(context);

  page.querySelector('.mock-shell__meta')!.textContent =
    `${module.meta.name}@${module.meta.version} · ${module.meta.runtime} · contract ${module.contractVersion} ` +
    `(harness ${CONTRACT_VERSION})`;

  page.querySelectorAll<HTMLSelectElement>('[data-field]').forEach((select) => {
    select.addEventListener('change', () => {
      const field = select.dataset.field!;
      state =
        field === 'theme'
          ? { ...state, theme: select.value as Theme }
          : { ...state, filters: { ...state.filters, [field]: select.value } as OpsFilters };
      document.documentElement.dataset.theme = state.theme;
      write('state', `${field} = ${select.value}`);
      handle.update(state);
    });
  });

  document.documentElement.dataset.theme = state.theme;
  write('state', 'mounted');
}

function injectHarnessStyles(): void {
  const style = document.createElement('style');
  style.textContent = `
    :root { color-scheme: dark; }
    body { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; background: #0d1117; color: #e6edf3; }
    .mock-shell { display: grid; grid-template-columns: 1fr 22rem; grid-template-rows: auto 1fr; min-height: 100vh; }
    .mock-shell__bar { grid-column: 1 / -1; display: flex; gap: 1rem; align-items: center;
      padding: .6rem 1rem; background: #161b22; border-bottom: 1px dashed #30363d; flex-wrap: wrap; }
    .mock-shell__meta { color: #8b949e; font: 12px ui-monospace, monospace; }
    .mock-shell__bar label { color: #8b949e; font-size: 12px; }
    .mock-shell__slot { padding: 1rem; min-width: 0; }
    .mock-shell__log { border-left: 1px dashed #30363d; padding: .75rem; overflow: auto; max-height: calc(100vh - 3.2rem);
      font: 11px/1.6 ui-monospace, monospace; }
    .mock-shell__line { color: #8b949e; word-break: break-word; }
    .mock-shell__line--bus { color: #79c0ff; }
    .mock-shell__line--notify { color: #f0883e; }
    .mock-shell__line--nav { color: #d2a8ff; }`;
  document.head.append(style);
}
