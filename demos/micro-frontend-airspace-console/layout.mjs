/**
 * The deployment layout: which apps exist, where each one is published, and
 * which releases of each are available.
 *
 * In a real setup this file does not exist. Each team's own CI decides where it
 * publishes and writes its entry into a registry service; nothing in Team A's
 * repo knows Team B's URL. Here one repo builds all four apps, so the layout
 * has to be written down somewhere — but it is written down *once*, as data,
 * and it never leaks into an application's source. The shell reads the same
 * facts at runtime out of `registry.json`, exactly as it would from a service.
 */

export const SLUG = 'micro-frontend-airspace-console';

/** The shell. Published at the demo root because it is the page the user opens. */
export const SHELL = {
  app: 'shell',
  team: 'Platform Experience',
};

/**
 * Every remote, with its released versions.
 *
 * `releases` having more than one entry is the point of the deploy-skew
 * simulator: both were built from this source with a different `__RELEASE__`,
 * which stands in for "two different commits, built weeks apart". The shell
 * picks between them at runtime and never rebuilds.
 */
export const REMOTES = [
  {
    app: 'ops-board',
    /** Registry id and URL segment. */
    name: 'ops-board',
    /** Module Federation scope name — a JS identifier, so it is not the slug. */
    scope: 'opsBoard',
    /** The key under `exposes` in the remote's federation config. */
    module: './mfe',
    title: 'Operations Board',
    team: 'Airspace Ops',
    runtime: 'react',
    nav: { label: 'Operations', path: '/ops', order: 10 },
    releases: [
      { version: '2026.7.0', channel: 'previous', deployedAt: '2026-07-09T14:02:00Z' },
      { version: '2026.8.0', channel: 'stable', deployedAt: '2026-08-04T09:41:00Z' },
    ],
    current: '2026.8.0',
  },
  {
    app: 'analytics',
    name: 'analytics',
    scope: 'analytics',
    module: './mfe',
    title: 'Airspace Analytics',
    team: 'Airspace Ops',
    runtime: 'react',
    nav: { label: 'Analytics', path: '/analytics', order: 20 },
    releases: [{ version: '2026.8.1', channel: 'stable', deployedAt: '2026-08-06T16:18:00Z' }],
    current: '2026.8.1',
  },
  {
    app: 'notam-ticker',
    name: 'notam-ticker',
    scope: 'notamTicker',
    module: './mfe',
    title: 'NOTAM & Weather',
    team: 'Weather Services',
    runtime: 'svelte',
    nav: { label: 'NOTAMs', path: '/notams', order: 30 },
    releases: [{ version: '2026.6.2', channel: 'stable', deployedAt: '2026-06-22T11:07:00Z' }],
    current: '2026.6.2',
  },
];

/** Where a given release of a remote is published, relative to the shell. */
export const releasePath = (remote, version) => `remotes/${remote.name}/${version}/`;
