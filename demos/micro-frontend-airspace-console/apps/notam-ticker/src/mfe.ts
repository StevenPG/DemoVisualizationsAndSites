/**
 * Team Weather Services' micro frontend.
 *
 * This file is the whole point of the framework-neutral contract. It exports
 * the same `MicroFrontendModule` the React apps do — same `mount(context)`,
 * same handle, same diagnostics — implemented against Svelte's mount/unmount
 * instead of React's. The shell has no branch for it, no adapter for it, and no
 * way to tell.
 *
 * Compare it with `@airspace/contract/react`'s `defineReactRemote`: that is
 * this file, written once for the teams that use React. There is no privileged
 * framework, only one that happens to have a helper.
 */
import { mount, unmount } from 'svelte';
import { VERSION as SVELTE_VERSION } from 'svelte/compiler';
import type { MicroFrontendModule, MountContext, SharedState } from '@airspace/contract';
import { CONTRACT_VERSION } from '@airspace/contract';
import Ticker from './Ticker.svelte';
import { createSharedStateBox } from './shared-state.svelte';

declare const __RELEASE__: string;
const RELEASE: string = typeof __RELEASE__ === 'string' ? __RELEASE__ : 'dev';

const module: MicroFrontendModule = {
  contractVersion: CONTRACT_VERSION,

  meta: {
    name: 'notam-ticker',
    title: 'NOTAM & Weather',
    team: 'Weather Services',
    version: RELEASE,
    runtime: 'svelte',
  },

  // No `react` key: this bundle never resolves React, so it has nothing to
  // report about it — and the shell's X-ray shows exactly that, which is the
  // clearest possible evidence that the boundary is not React-shaped.
  diagnostics: {
    versions: { svelte: SVELTE_VERSION },
  },

  mount(context: MountContext) {
    // Svelte 5's reactivity is compiler-driven, so shell state has to arrive in
    // something the compiler knows is reactive. The box is a `$state` cell in a
    // .svelte.ts module; assigning to it re-renders exactly what read it —
    // the same job `SharedStateStore` does for the React adapter.
    const box = createSharedStateBox(context.state);

    let failed = false;
    const guard = <T,>(work: () => T): T | undefined => {
      try {
        return work();
      } catch (error) {
        // Svelte has no error boundary, so the contract's `onError` is the only
        // thing standing between a bug in here and a blank rectangle.
        if (!failed) {
          failed = true;
          context.onError(error);
        }
        return undefined;
      }
    };

    const app = guard(() =>
      mount(Ticker, {
        target: context.container,
        props: { box, services: context.services, bus: context.bus, release: RELEASE },
      }),
    );

    return {
      update(state: SharedState) {
        guard(() => box.set(state));
      },
      unmount() {
        if (app) unmount(app);
      },
    };
  },
};

export default module;
