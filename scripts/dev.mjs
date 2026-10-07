import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { loadManifest } from './manifest.mjs';
import { demoBase, demosDir, landingDir } from './paths.mjs';

/**
 * Dev server:
 *   npm run dev              → the landing page, with every demo mounted at
 *                              /demos/<slug>/ so the index links actually work
 *   npm run dev hello-world  → just that demo, served at /
 *
 * The mounted demos are real Vite dev servers running in middleware mode, so
 * each one keeps its own plugins, transforms and HMR — the layout matches a
 * production build without having to `npm run preview` after every edit.
 *
 * A demo may be more than one application (see demos/<slug>/dev.mjs), in which
 * case it contributes several servers and, optionally, a few generated files.
 */
const slug = process.argv[2];
const demos = loadManifest();

if (slug) {
  const known = demos.map((d) => d.slug);
  if (!known.includes(slug)) {
    console.error(`Unknown demo "${slug}". Available: ${known.join(', ') || '(none yet)'}`);
    process.exit(1);
  }

  const mounts = await mountsFor(demos.find((demo) => demo.slug === slug), '/');
  const root = mounts.apps.find((app) => app.base === '/');

  if (mounts.apps.length === 1 && root) {
    const server = await createServer({ root: root.root, base: '/' });
    await server.listen();
    server.printUrls();
  } else {
    // Multi-app demo: serve it exactly as in production, minus the /demos/<slug>
    // prefix. The parent is a bare server whose only job is to hold the others.
    const server = await createServer({ root: root.root, base: '/', plugins: [mountAll([mounts])] });
    await server.listen();
    server.printUrls();
    console.log(`  ${'➜'}  Apps:    ${mounts.apps.map((app) => app.name).join('  ')}\n`);
  }
} else {
  const all = await Promise.all(demos.map((demo) => mountsFor(demo, demoBase(demo.slug))));
  const server = await createServer({
    root: landingDir,
    base: '/',
    plugins: [mountAll(all)],
  });
  await server.listen();
  server.printUrls();
  console.log(`  ${'➜'}  Demos:   ${demos.map((d) => demoBase(d.slug)).join('  ')}\n`);
}

/**
 * What a demo needs mounted. One Vite app for an ordinary demo; whatever its
 * dev.mjs says for a demo that is several applications.
 */
async function mountsFor(demo, base) {
  const devModule = path.join(demosDir, demo.slug, 'dev.mjs');
  if (fs.existsSync(devModule)) {
    const { devApps } = await import(pathToFileURL(devModule).href);
    return devApps({ base });
  }
  return { apps: [{ name: demo.slug, base, root: path.join(demosDir, demo.slug) }], files: {} };
}

/**
 * Mounts every app as a child dev server under the parent one.
 *
 * `configureServer` runs before Vite installs its own middlewares, which is the
 * whole point: the landing page's SPA fallback would otherwise answer every
 * /demos/<slug>/ request with the landing index.html — the URL changes, the same
 * page renders, and the link looks broken.
 *
 * Order matters. A remote at /demos/x/remotes/ops-board/1.0.0/ lives *inside*
 * the shell's base, so the longest prefix has to be tested first or the shell
 * answers for everybody.
 */
function mountAll(mountLists) {
  const children = [];

  return {
    name: 'mount-demos',

    async configureServer(server) {
      const files = Object.assign({}, ...mountLists.map((mount) => mount.files ?? {}));
      const apps = mountLists
        .flatMap((mount) => mount.apps)
        .sort((a, b) => b.base.length - a.base.length);

      // Generated files (a demo's runtime registry, say) before anything else,
      // since they sit at paths a child server would otherwise claim.
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '/').split('?')[0];
        const file = files[url];
        if (!file) return next();
        res.setHeader('Content-Type', 'application/json');
        return res.end(file());
      });

      for (const [i, app] of apps.entries()) {
        // Each child needs its own HMR port: they share the parent's HTTP
        // server, so they cannot also share its websocket.
        const child = await createServer({
          root: app.root,
          base: app.base,
          define: app.define,
          server: { middlewareMode: true, hmr: { port: 24700 + i } },
          appType: 'spa',
        });
        children.push(child);

        server.middlewares.use((req, res, next) => {
          const url = req.url ?? '/';
          // /demos/<slug> without the trailing slash would resolve the demo's
          // relative asset URLs against /demos/ instead of the demo itself.
          if (app.base !== '/' && url === app.base.slice(0, -1)) {
            res.writeHead(301, { Location: app.base });
            return res.end();
          }
          if (app.base !== '/' && !url.startsWith(app.base)) return next();
          return child.middlewares(req, res, next);
        });
      }
    },

    async closeBundle() {
      await Promise.all(children.map((child) => child.close()));
    },
  };
}
