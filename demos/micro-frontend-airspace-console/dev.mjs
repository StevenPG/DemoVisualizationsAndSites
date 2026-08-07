import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REMOTES, SHELL, releasePath } from './layout.mjs';
import { buildRegistry } from './registry.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Describes this demo's dev servers to the repo's dev harness.
 *
 * A micro frontend console is several applications, so it is several dev
 * servers: one per app, each with its own plugins, its own transforms and its
 * own HMR — a change to the Operations Board hot-reloads the Operations Board
 * and nothing else, exactly as it would if the two teams were on two laptops.
 *
 * Every release is served too, so the deploy-skew switch works in development
 * without a production build. In real life those are two deploys of one repo;
 * here they are two dev servers of one source tree with a different
 * `__RELEASE__` compiled in.
 *
 * The one thing dev does differently from production: all of it is same-origin,
 * because the harness mounts these under one port. Point the shell at a
 * genuinely remote registry with `?registry=https://…` to check that assumption
 * before you rely on it — the URLs in the registry are absolute, so nothing
 * else has to change.
 */
export function devApps({ base }) {
  const apps = [];

  for (const remote of REMOTES) {
    for (const release of remote.releases) {
      apps.push({
        name: `${remote.name}@${release.version}`,
        base: base + releasePath(remote, release.version),
        root: path.join(here, 'apps', remote.app),
        define: {
          __RELEASE__: JSON.stringify(release.version),
          __CHANNEL__: JSON.stringify(release.channel),
        },
      });
    }
  }

  apps.push({ name: 'shell', base, root: path.join(here, 'apps', SHELL.app) });

  return {
    apps,
    // The registry is a service in production and a build artifact in the
    // bundle; in dev it is this. Same document, same shape, three sources.
    files: {
      [`${base}registry.json`]: () => JSON.stringify(buildRegistry({ base }), null, 2),
    },
  };
}
