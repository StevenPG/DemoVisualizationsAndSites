import path from 'node:path';
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
 */
const slug = process.argv[2];
const demos = loadManifest();

if (slug) {
  const known = demos.map((d) => d.slug);
  if (!known.includes(slug)) {
    console.error(`Unknown demo "${slug}". Available: ${known.join(', ') || '(none yet)'}`);
    process.exit(1);
  }

  const server = await createServer({ root: path.join(demosDir, slug), base: '/' });
  await server.listen();
  server.printUrls();
} else {
  const server = await createServer({
    root: landingDir,
    base: '/',
    plugins: [mountDemos(demos)],
  });
  await server.listen();
  server.printUrls();
  console.log(`  ${'➜'}  Demos:   ${demos.map((d) => demoBase(d.slug)).join('  ')}\n`);
}

/**
 * Mounts each demo as a child dev server under the landing one.
 *
 * `configureServer` runs before Vite installs its own middlewares, which is the
 * whole point: the landing page's SPA fallback would otherwise answer every
 * /demos/<slug>/ request with the landing index.html — the URL changes, the same
 * page renders, and the link looks broken.
 */
function mountDemos(demos) {
  const children = [];

  return {
    name: 'mount-demos',

    async configureServer(server) {
      for (const [i, demo] of demos.entries()) {
        const base = demoBase(demo.slug);

        // Each child needs its own HMR port: they share the parent's HTTP
        // server, so they cannot also share its websocket.
        const child = await createServer({
          root: path.join(demosDir, demo.slug),
          base,
          server: { middlewareMode: true, hmr: { port: 24700 + i } },
          appType: 'spa',
        });
        children.push(child);

        server.middlewares.use((req, res, next) => {
          const url = req.url ?? '/';
          // /demos/<slug> without the trailing slash would resolve the demo's
          // relative asset URLs against /demos/ instead of the demo itself.
          if (url === base.slice(0, -1)) {
            res.writeHead(301, { Location: base });
            return res.end();
          }
          if (!url.startsWith(base)) return next();
          return child.middlewares(req, res, next);
        });
      }
    },

    async closeBundle() {
      await Promise.all(children.map((child) => child.close()));
    },
  };
}
