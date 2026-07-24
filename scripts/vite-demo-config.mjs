import path from 'node:path';
import { defineConfig, mergeConfig } from 'vite';
import { distDir, demoBase } from './paths.mjs';

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
      outDir: path.join(distDir, 'demos', slug),
      emptyOutDir: true,
    },
  });

  return mergeConfig(base, overrides);
}
