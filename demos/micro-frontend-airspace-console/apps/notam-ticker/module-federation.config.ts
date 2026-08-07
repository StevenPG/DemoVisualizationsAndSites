import { fileURLToPath } from 'node:url';
import { createModuleFederationConfig } from '@module-federation/vite';

const from = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

/**
 * Team Weather Services publishes exactly the same shape as the React teams:
 * one module, exporting one `MicroFrontendModule`. The shell cannot tell from
 * the outside that this one is Svelte, and does not have a branch for it.
 *
 * Note the empty `shared` block. Sharing is for dependencies *more than one*
 * app uses — its whole benefit is loading React once instead of three times.
 * Svelte is used here and nowhere else, so declaring it shared would add
 * negotiation cost at load for a bundle that would be downloaded exactly once
 * anyway. Svelte's runtime is a few kilobytes and rides along inside this
 * remote, which is the correct trade and also the reason a team can adopt a
 * different framework without asking anyone's permission.
 */
export default createModuleFederationConfig({
  name: 'notamTicker',
  filename: 'remoteEntry.js',
  exposes: {
    './mfe': from('./src/mfe.ts'),
  },
  bundleAllCSS: true,
  dts: false,
  shared: {},
});
