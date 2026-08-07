/**
 * Loading a micro frontend, and everything that can go wrong while doing it.
 *
 * This is the only file in the shell that knows Module Federation exists. That
 * is on purpose: the rest of the shell deals in `MicroFrontendModule`, so
 * swapping federation for import maps, or adding a second loading mechanism for
 * a legacy app, is a change to one module rather than to the console.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { loadRemote, registerRemotes } from '@module-federation/runtime';
import { checkCompatibility, type CompatibilityResult, type MicroFrontendModule } from '@airspace/contract';
import type { RegistryEntry, RemoteRelease } from './registry';

/**
 * Faults the console can inject. Every one of them is applied on the *shell*
 * side, without the remote's cooperation — which is the point. The failures a
 * host has to survive are the ones a remote is in no position to report:
 * a bundle that 404s after a bad deploy, a CDN edge that hangs, an entry that
 * loads but blows up on mount.
 */
export type Fault = 'none' | 'missing' | 'slow' | 'mount-throws';

export interface LoadRecord {
  remote: string;
  team: string;
  runtime: string;
  version: string;
  entry: string;
  startedAt: number;
  ms: number;
  status: 'ok' | 'failed';
  bytes?: number;
  contractVersion?: string;
  compatibility?: CompatibilityResult;
  /** Per-dependency verdict: is the remote using the shell's copy, or its own? */
  sharing: SharingReport;
  reactVersion?: string;
  fault?: Fault;
  error?: string;
}

export interface LoadResult {
  module: MicroFrontendModule;
  record: LoadRecord;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface SharingVerdict {
  dependency: string;
  verdict: 'shared' | 'duplicated';
}

export type SharingReport = SharingVerdict[];

/**
 * The shell's own copies of the exports each remote probes, by the same keys.
 *
 * Comparing exports rather than namespace objects is deliberate — see the note
 * on `RemoteDiagnostics` in the contract. Getting this wrong is the reason a
 * lot of teams believe their federation setup is deduplicating when it is not,
 * and the reason others rip out a working setup that only *looked* broken.
 */
const SHELL_PROBES: Record<string, unknown> = {
  react: useState,
  'react-dom/client': createRoot,
};

function compareProbes(probes: Readonly<Record<string, unknown>> | undefined): SharingReport {
  if (!probes) return [];
  return Object.entries(probes)
    .filter(([dependency]) => dependency in SHELL_PROBES)
    .map(([dependency, probe]) => ({
      dependency,
      verdict: probe === SHELL_PROBES[dependency] ? ('shared' as const) : ('duplicated' as const),
    }));
}

/**
 * Shape-check what came back over the wire.
 *
 * A remote is a URL owned by another team, fetched at runtime. It can be an
 * older build, a half-finished deploy, or an HTML error page with a .js
 * extension. Validating here turns all of those into one clear message at the
 * boundary instead of a `mount is not a function` three frames deep.
 */
function assertMicroFrontend(candidate: unknown, remote: string): asserts candidate is MicroFrontendModule {
  const module = candidate as Partial<MicroFrontendModule> | null;
  if (!module || typeof module.mount !== 'function') {
    throw new Error(`"${remote}" loaded but does not export a mount() — it is not a micro frontend module.`);
  }
  if (typeof module.contractVersion !== 'string' || !module.meta?.name) {
    throw new Error(`"${remote}" is missing contract metadata. Was it built against @airspace/contract?`);
  }
}

export async function loadMicroFrontend(
  entry: RegistryEntry,
  release: RemoteRelease,
  fault: Fault = 'none',
): Promise<LoadResult> {
  const startedAt = performance.now();
  const url =
    fault === 'missing'
      ? release.entry.replace(/[^/]+\.js$/, 'remoteEntry.deleted-by-a-bad-deploy.js')
      : release.entry;

  const record: LoadRecord = {
    remote: entry.name,
    team: entry.team,
    runtime: entry.runtime,
    version: release.version,
    entry: url,
    startedAt,
    ms: 0,
    status: 'failed',
    bytes: release.bytes,
    sharing: [],
    fault: fault === 'none' ? undefined : fault,
  };

  try {
    if (fault === 'slow') await sleep(9000);

    // `force` matters for the version switcher: re-registering the same scope
    // with a different entry is how a rollback happens without a reload. The
    // runtime drops its cached container for that scope and fetches the new one
    // — while every *shared* dependency stays exactly as it was, which is why
    // React does not reinitialise underneath the page.
    registerRemotes([{ name: entry.scope, entry: url, type: 'module' }], { force: true });

    const exposed = await loadRemote<{ default: unknown }>(`${entry.scope}/${entry.module.replace(/^\.\//, '')}`);
    const module = exposed?.default;
    assertMicroFrontend(module, entry.name);

    const compatibility = checkCompatibility(module.contractVersion);
    if (!compatibility.ok) throw new Error(compatibility.message);

    record.contractVersion = module.contractVersion;
    record.compatibility = compatibility;
    record.reactVersion = module.diagnostics?.versions?.['react'];
    record.sharing = compareProbes(module.diagnostics?.probes);
    record.ms = Math.round(performance.now() - startedAt);
    record.status = 'ok';

    return { module: fault === 'mount-throws' ? withThrowingMount(module) : module, record };
  } catch (error) {
    record.ms = Math.round(performance.now() - startedAt);
    record.error = error instanceof Error ? error.message : String(error);
    throw Object.assign(error instanceof Error ? error : new Error(record.error), { record });
  }
}

/**
 * A remote that loads cleanly and then throws the moment it is asked to render.
 * Rare, and the most instructive of the three: the network was fine, the
 * contract was fine, and the console still has to keep the other three apps up.
 */
function withThrowingMount(module: MicroFrontendModule): MicroFrontendModule {
  return {
    ...module,
    mount() {
      throw new Error('Injected fault: this remote threw inside mount().');
    },
  };
}
