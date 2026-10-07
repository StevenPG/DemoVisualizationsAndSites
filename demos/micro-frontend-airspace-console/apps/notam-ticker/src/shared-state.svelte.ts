import type { SharedState } from '@airspace/contract';

/**
 * A reactive cell for shell-owned state.
 *
 * `.svelte.ts` rather than `.ts` so the Svelte compiler processes the runes in
 * it. This is the Svelte-side equivalent of the React adapter's external store:
 * the shell calls `set()` from `handle.update()`, and only the markup that read
 * a given field re-renders.
 */
export function createSharedStateBox(initial: SharedState) {
  let current = $state(initial);
  return {
    get value(): SharedState {
      return current;
    },
    set(next: SharedState): void {
      current = next;
    },
  };
}
