import path from 'node:path';
import { defineConfig, mergeConfig } from 'vite';
import { demoBase, demosDir, distDir } from './paths.mjs';

/**
 * Shared Vite config for a demo. Every demo is built as a standalone site that
 * happens to live under /demos/<slug>/ in the combined deployable, so its asset
 * URLs have to be prefixed with that base.
 *
 * Usage in demos/<slug>/vite.config.js:
 *   import { defineDemoConfig } from '../../scripts/vite-demo-config.mjs';
 *   export default defineDemoConfig('my-slug');
 *
 * Pass `overrides` for anything demo-specific (plugins, aliases, ...); it is
 * merged on top of these defaults.
 */
export function defineDemoConfig(slug, overrides = {}) {
  const base = defineConfig({
    base: demoBase(slug),
    build: {
      // Relative to the demo's own root on purpose: some plugins (vite-plugin-cesium
      // among them) do their own `path.join(root, outDir)` to find the output, which
      // silently produces a nonsense nested path if this is absolute.
      outDir: path.relative(path.join(demosDir, slug), path.join(distDir, 'demos', slug)),
      emptyOutDir: true,
    },
  });

  return mergeConfig(base, overrides);
}
