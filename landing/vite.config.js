import path from 'node:path';
import { defineConfig } from 'vite';
import { loadManifest } from '../scripts/manifest.mjs';
import { distDir, landingDir, manifestPath } from '../scripts/paths.mjs';

const VIRTUAL_ID = 'virtual:demos';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/**
 * Exposes the *published* demos to the landing page as `virtual:demos`.
 *
 * Filtering here rather than in the browser keeps drafts — unreleased titles and
 * descriptions — out of the shipped bundle entirely. Draft demos are still built
 * and reachable at their URL, just not discoverable from the index.
 */
function demoManifest() {
  return {
    name: 'demo-manifest',
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : null),
    load(id) {
      if (id !== RESOLVED_ID) return null;
      const demos = loadManifest().filter((demo) => demo.status !== 'draft');
      return `export default ${JSON.stringify(demos)};`;
    },
    configureServer(server) {
      server.watcher.add(manifestPath);
      server.watcher.on('change', (file) => {
        if (file !== manifestPath) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      });
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [demoManifest()],
  build: {
    // Straight into dist/ — the demos are then built into dist/demos/<slug>/,
    // so emptyOutDir must stay off here to avoid wiping them. Relative to the
    // landing root for the same reason as the demos (see vite-demo-config.mjs).
    outDir: path.relative(landingDir, distDir),
    emptyOutDir: false,
  },
});
