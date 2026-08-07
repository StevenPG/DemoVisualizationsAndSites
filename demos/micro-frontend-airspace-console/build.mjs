import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { REMOTES, SHELL, releasePath } from './layout.mjs';
import { buildRegistry } from './registry.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds the console: one Vite build per app, plus one extra build per extra
 * release of a remote.
 *
 * The important property is that these builds share nothing. Each one has its
 * own Vite config, its own dependency graph and its own output directory; none
 * of them imports another's source. Delete any remote's output and the shell
 * still builds, deploys and runs — it just reports that remote as unavailable.
 * That is the whole promise of micro frontends, and it is worth checking that
 * a repo's build actually preserves it rather than assuming.
 *
 * In a real programme each of these builds happens in a different repository,
 * on a different schedule, and this file does not exist.
 *
 * Called by the repo's scripts/build.mjs with the demo's public base and output
 * directory, so nothing here needs to know it lives under /demos/<slug>/.
 */
export default async function buildDemo({ base, outDir }) {
  const sizes = {};

  for (const remote of REMOTES) {
    for (const release of remote.releases) {
      const rel = releasePath(remote, release.version);
      const target = path.join(outDir, rel);
      console.log(`   · ${remote.name}@${release.version} (${remote.team})`);

      await build({
        root: path.join(here, 'apps', remote.app),
        base: base + rel,
        logLevel: 'warn',
        define: {
          __RELEASE__: JSON.stringify(release.version),
          __CHANNEL__: JSON.stringify(release.channel),
        },
        build: { outDir: target, emptyOutDir: true },
      });

      sizes[`${remote.name}@${release.version}`] = directorySize(target);
    }
  }

  // The shell last, so a broken remote fails the build before the page that
  // would have to explain its absence.
  console.log(`   · shell (${SHELL.team})`);
  await build({
    root: path.join(here, 'apps', SHELL.app),
    base,
    logLevel: 'warn',
    build: { outDir, emptyOutDir: false },
  });

  fs.writeFileSync(
    path.join(outDir, 'registry.json'),
    `${JSON.stringify(buildRegistry({ base, sizes }), null, 2)}\n`,
  );
}

/**
 * Also runnable on its own — `node build.mjs` writes a standalone copy into
 * ./dist served from the site root, which is what the deploy of a real,
 * separately hosted console looks like.
 */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildDemo({ base: '/', outDir: path.join(here, 'dist') });
  console.log(`\nBuilt the console into ${path.join(here, 'dist')}`);
}

function directorySize(dir) {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .reduce((total, entry) => total + fs.statSync(path.join(entry.parentPath, entry.name)).size, 0);
}
