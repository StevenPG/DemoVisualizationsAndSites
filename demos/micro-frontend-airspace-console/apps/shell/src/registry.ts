/**
 * The remote registry: the shell's only source of truth about what exists.
 *
 * Everything the shell knows about a micro frontend — that it exists at all,
 * where its bundle is, which version is current, what its nav entry says —
 * arrives here at runtime. Nothing about a remote is compiled into the shell.
 *
 * That single property is what makes the deploys independent:
 *
 *   Team B ships          → registry entry's `current` moves → users get it,
 *                            with no shell build, review or release.
 *   Team B breaks prod    → `current` moves back → rollback in one PATCH.
 *   A new team joins      → one new registry entry → the nav grows itself.
 *
 * Here it is a static JSON file written by the build. In production it is a
 * service, and the interesting parts (per-user rollout, canary percentages,
 * region pinning) are decisions that service makes when it answers.
 */

export interface RemoteRelease {
  version: string;
  channel: 'stable' | 'previous' | 'canary' | (string & {});
  deployedAt: string;
  /** Absolute-from-site-root URL of the remoteEntry. */
  entry: string;
  /** Total build output size, shown in the X-ray panel. */
  bytes?: number;
}

export interface RemoteNav {
  label: string;
  /** Top-level path the shell mounts this remote under, e.g. '/ops'. */
  path: string;
  order: number;
}

export interface RegistryEntry {
  name: string;
  /** Module Federation container name. */
  scope: string;
  /** Key under the remote's `exposes`, e.g. './mfe'. */
  module: string;
  title: string;
  team: string;
  runtime: string;
  nav: RemoteNav;
  current: string;
  releases: RemoteRelease[];
}

export interface Registry {
  generatedAt: string;
  remotes: RegistryEntry[];
}

/**
 * `?registry=` points the console at another environment's registry without a
 * rebuild — the same lever a team pulls to preview a canary registry, and the
 * reason the registry URL is configuration rather than a constant.
 */
export function registryUrl(): string {
  const override = new URLSearchParams(location.search).get('registry');
  return override ?? `${import.meta.env.BASE_URL}registry.json`;
}

export async function fetchRegistry(signal?: AbortSignal): Promise<Registry> {
  const response = await fetch(registryUrl(), { signal, cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`Registry unavailable (HTTP ${response.status}). The console cannot know what to load.`);
  }
  const registry = (await response.json()) as Registry;
  if (!Array.isArray(registry.remotes)) {
    throw new Error('Registry is malformed: expected a "remotes" array.');
  }
  return { ...registry, remotes: [...registry.remotes].sort((a, b) => a.nav.order - b.nav.order) };
}

export const releaseOf = (entry: RegistryEntry, version: string): RemoteRelease | undefined =>
  entry.releases.find((release) => release.version === version);
