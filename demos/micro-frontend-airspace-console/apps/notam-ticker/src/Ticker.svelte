<script lang="ts">
  import type { EventBus, SectorId, ShellServices } from '@airspace/contract';
  import { makeNotice, seedNotices, type Notice } from './data';

  interface Props {
    box: { readonly value: import('@airspace/contract').SharedState };
    services: ShellServices;
    bus: EventBus;
    release: string;
  }

  const { box, services, bus, release }: Props = $props();

  let notices = $state<Notice[]>(seedNotices(9));
  let onlyThisSector = $state(true);
  let focused = $state<{ callsign: string; sector: SectorId } | null>(null);

  // Shell-owned state, read through the box. Nothing subscribes; the compiler
  // wired it up when it saw `box.value` inside a derived.
  const filters = $derived(box.value.filters);

  const visible = $derived(
    notices
      .filter((notice) => (onlyThisSector ? notice.sector === filters.sector : true))
      .filter((notice) => filters.severities.includes(notice.severity)),
  );

  // Timers and subscriptions live in an effect so Svelte owns their teardown.
  // Getting this wrong is the classic micro frontend leak: the user navigates
  // away, the remote is unmounted, and its interval keeps publishing into a bus
  // nobody is reading. `unmount()` has to be complete, and the easiest way to
  // make it complete is to never hand-roll the cleanup.
  //
  // Reads inside the callbacks below are not tracked — they happen long after
  // the effect ran — so a filter change does not restart the timer.
  $effect(() => {
    const timer = setInterval(() => {
      const notice = makeNotice();
      notices = [notice, ...notices].slice(0, 40);
      // A SIGMET is worth interrupting someone for. The shell turns
      // `alert:raised` into a toast; this app does not know what a toast is.
      if (notice.kind === 'SIGMET' && notice.sector === filters.sector) {
        bus.publish('alert:raised', {
          id: notice.id,
          severity: notice.severity,
          message: `SIGMET ${notice.sector}: ${notice.text}`,
        });
      }
    }, 9000);

    // Cross-app reaction, with no import of whoever published it.
    const off = bus.subscribe(
      'flight:selected',
      (payload) => {
        focused = { callsign: payload.callsign, sector: payload.sector };
      },
      // Replayed on mount, for the same reason the React panels ask for it.
      { replayLast: true },
    );

    return () => {
      clearInterval(timer);
      off();
    };
  });

  const relative = (iso: string): string => {
    const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
    return seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`;
  };
</script>

<div class="root">
  <header class="head">
    <div>
      <h2 class="title">NOTAM &amp; Weather</h2>
      <p class="subtitle">
        Team Weather Services · built with Svelte {release} · no React in this bundle
      </p>
    </div>
    <label class="toggle">
      <input type="checkbox" bind:checked={onlyThisSector} />
      only {filters.sector}
    </label>
  </header>

  {#if focused}
    <p class="focus">
      Console focus: <strong>{focused.callsign}</strong> in {focused.sector}. This app subscribed to the
      same bus event the React panels use — one contract, three frameworks' worth of listeners.
    </p>
  {/if}

  <ul class="list">
    {#each visible as notice (notice.id)}
      <li class="item {notice.severity}">
        <span class="kind">{notice.kind}</span>
        <span class="sector">{notice.sector}</span>
        <span class="text">{notice.text}</span>
        <span class="age">{relative(notice.issued)}</span>
        <button
          class="raise"
          onclick={() =>
            services.notify({
              severity: notice.severity,
              title: `${notice.kind} ${notice.sector}`,
              detail: notice.text,
              timeoutMs: 6000,
            })}
        >
          Pin
        </button>
      </li>
    {:else}
      <li class="empty">Nothing matches the shell&rsquo;s current filters.</li>
    {/each}
  </ul>
</div>

<style>
  /*
   * Svelte scopes these styles per component at compile time — the same
   * isolation guarantee the React apps get from CSS Modules, by a different
   * mechanism. Neither team had to agree with the other about how to do it,
   * which is the test of whether a boundary is real.
   *
   * The colours are the shell's tokens, exactly as in the React remotes.
   */
  .root {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    font-family: var(--ax-font, ui-sans-serif, system-ui, sans-serif);
    color: var(--ax-text, #e6edf3);
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .title {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 650;
  }

  .subtitle {
    margin: 0.15rem 0 0;
    color: var(--ax-muted, #8b949e);
    font-size: 0.8rem;
  }

  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.75rem;
    color: var(--ax-muted, #8b949e);
  }

  .focus {
    margin: 0;
    border: 1px solid color-mix(in oklab, var(--ax-accent, #58a6ff) 45%, var(--ax-border, #30363d));
    background: color-mix(in oklab, var(--ax-accent, #58a6ff) 8%, var(--ax-surface, #161b22));
    border-radius: var(--ax-radius, 10px);
    padding: 0.6rem 0.9rem;
    font-size: 0.8rem;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .item {
    display: grid;
    grid-template-columns: 4.4rem 4.6rem 1fr auto auto;
    align-items: center;
    gap: 0.7rem;
    padding: 0.45rem 0.75rem;
    border: 1px solid var(--ax-border, #30363d);
    border-left-width: 3px;
    border-radius: var(--ax-radius-sm, 7px);
    background: var(--ax-surface, #161b22);
    font-size: 0.8rem;
  }

  .item.info {
    border-left-color: var(--ax-info, #58a6ff);
  }
  .item.advisory {
    border-left-color: var(--ax-advisory, #d29922);
  }
  .item.warning {
    border-left-color: var(--ax-warning, #f0883e);
  }
  .item.critical {
    border-left-color: var(--ax-critical, #f85149);
  }

  .kind,
  .sector,
  .age {
    font-family: var(--ax-mono, ui-monospace, monospace);
    font-size: 0.68rem;
    color: var(--ax-muted, #8b949e);
  }

  .kind {
    font-weight: 700;
    color: var(--ax-text, #e6edf3);
  }

  .text {
    font-family: var(--ax-mono, ui-monospace, monospace);
    font-size: 0.76rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .raise {
    appearance: none;
    border: 1px solid var(--ax-border, #30363d);
    background: var(--ax-surface-2, #1c2129);
    color: inherit;
    font: inherit;
    font-size: 0.7rem;
    padding: 0.1rem 0.55rem;
    border-radius: 999px;
    cursor: pointer;
  }

  .raise:hover {
    border-color: var(--ax-accent, #58a6ff);
  }

  .empty {
    padding: 1.5rem;
    text-align: center;
    color: var(--ax-muted, #8b949e);
    font-size: 0.8rem;
  }
</style>
