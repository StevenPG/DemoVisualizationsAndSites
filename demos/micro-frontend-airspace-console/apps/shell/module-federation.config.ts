import { createModuleFederationConfig } from '@module-federation/vite';

/**
 * The shell is a pure consumer: it exposes nothing.
 *
 * Note what is *not* here — a `remotes` map. The usual Module Federation
 * tutorial hard-codes remote URLs at build time, which quietly undoes the point
 * of the exercise: adding a micro frontend, moving one to a different CDN or
 * rolling one back all become shell releases, and the teams are coupled again
 * through the host's build. Instead the shell registers remotes at runtime from
 * the registry it fetches on boot (see src/federation.ts).
 *
 * The shared block is the shell's half of the singleton agreement. It loads
 * first, so in practice it is the copy of React everybody ends up using.
 */
export default createModuleFederationConfig({
  name: 'shell',
  remotes: {},
  // Types come from @airspace/contract, not over the wire. See the note in any
  // remote's module-federation.config.ts.
  dts: false,
  shared: {
    react: { singleton: true, requiredVersion: '^19.0.0', strictVersion: false },
    'react-dom': { singleton: true, requiredVersion: '^19.0.0', strictVersion: false },
    'react-dom/client': { singleton: true, requiredVersion: '^19.0.0', strictVersion: false },
  },
});
