import { fileURLToPath } from 'node:url';
import { createModuleFederationConfig } from '@module-federation/vite';

/** Exposed paths are resolved against the process working directory, not the
 * Vite root, so they are spelled absolutely — the build for this app is run
 * from the repo root by an orchestrator, and from here by `npm run dev`. */
const from = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

/**
 * Team Airspace Ops' second app, published the same way. Everything not listed here is private
 * to this repo, and can be renamed, rewritten or deleted without telling anyone.
 *
 * One module is exposed, not five. A remote that exposes a component library
 * has re-invented a shared package with worse versioning: consumers start
 * importing pieces, the pieces become API, and independent deploys quietly stop
 * being safe. One entry point, one contract.
 */
export default createModuleFederationConfig({
  name: 'analytics',
  filename: 'remoteEntry.js',
  exposes: {
    './mfe': from('./src/mfe.tsx'),
  },
  /**
   * Attach this app's CSS to its exposed module.
   *
   * Off by default, and the default is a trap for anyone using a bundler-level
   * styling solution: in a normal build Vite emits a stylesheet and links it
   * from index.html, but a federated remote is loaded without its index.html.
   * With this on, the stylesheet is fetched as part of loading the module, so a
   * remote arrives fully dressed and unmounts without leaving styles behind.
   */
  bundleAllCSS: true,
  /**
   * No .d.ts generation, and no consuming types over the network.
   *
   * Module Federation can ship type declarations alongside a remote, and for a
   * remote that exposes arbitrary components it is genuinely useful. It is the
   * wrong tool here: the only types that cross the boundary are in
   * @airspace/contract, which both teams already depend on and which versions
   * explicitly. Types fetched from a running remote silently make your
   * typecheck depend on another team's deployment being up.
   */
  dts: false,
  /**
   * Shared, in the Module Federation sense: whoever loads first wins, and
   * everyone else uses that copy.
   *
   * `singleton` is not an optimisation here — it is a correctness requirement.
   * Two React copies on one page means two dispatchers, and hooks called
   * through the wrong one throw "invalid hook call". `strictVersion: false`
   * keeps a patch-level skew between teams from being a mount failure, while
   * `requiredVersion` still refuses a genuinely incompatible major.
   */
  shared: {
    react: { singleton: true, requiredVersion: '^19.0.0', strictVersion: false },
    'react-dom': { singleton: true, requiredVersion: '^19.0.0', strictVersion: false },
    'react-dom/client': { singleton: true, requiredVersion: '^19.0.0', strictVersion: false },
  },
});
