import { federation } from '@module-federation/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import federationConfig from './module-federation.config';

/**
 * A completely ordinary Vite config plus one plugin. Nothing in it refers to
 * the shell, and nothing refers to where this gets deployed: `base` and
 * `build.outDir` are supplied by whoever runs the build (this repo's
 * build.mjs; a deploy pipeline in real life), so the defaults below are the
 * ones that make `npm run dev` in this folder work on its own.
 */
export default defineConfig({
  plugins: [react(), federation(federationConfig)],
  build: {
    // Module Federation needs top-level await and dynamic import to resolve
    // shared modules before the entry runs.
    target: 'chrome89',
  },
});
