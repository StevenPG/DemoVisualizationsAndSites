import { REMOTES, releasePath } from './layout.mjs';

/**
 * Builds the registry document the shell fetches on boot.
 *
 * Shared by the production build and the dev server so the two cannot drift —
 * a dev environment that describes a different world from production is how you
 * discover integration problems in staging instead of on your laptop.
 *
 * `sizes` is optional: the build knows how big each release turned out, the dev
 * server does not and says so.
 */
export function buildRegistry({ base, sizes = {} }) {
  return {
    $comment:
      'Written at build time here; a registry service in production. The shell reads only this — ' +
      'no remote URL, version or nav entry is compiled into the shell bundle.',
    generatedAt: new Date().toISOString(),
    remotes: REMOTES.map((remote) => ({
      name: remote.name,
      scope: remote.scope,
      module: remote.module,
      title: remote.title,
      team: remote.team,
      runtime: remote.runtime,
      nav: remote.nav,
      current: remote.current,
      releases: remote.releases.map((release) => ({
        version: release.version,
        channel: release.channel,
        deployedAt: release.deployedAt,
        entry: base + releasePath(remote, release.version) + 'remoteEntry.js',
        ...(sizes[`${remote.name}@${release.version}`]
          ? { bytes: sizes[`${remote.name}@${release.version}`] }
          : {}),
      })),
    })),
  };
}
