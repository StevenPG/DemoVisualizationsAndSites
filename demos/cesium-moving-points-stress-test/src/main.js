/**
 * How many independently moving points can CesiumJS keep in the air?
 *
 * Four populations — ships on the water, aircraft in the sky, vehicles on the
 * terrain, satellites in orbit — each with a count, a speed and a leg length you
 * can drag. Movers spawn in batches once a second, run their leg on a fixed
 * heading, and retire; the population turns itself over continuously so the
 * scene is never a static scatter.
 *
 * The demo is really about three numbers, all of them in the HUD: how long the
 * simulation takes, how long handing the positions to the renderer takes, and
 * how much of the frame is left for Cesium. The renderer switch is there to make
 * the point concrete — the same population through the Entity API instead of a
 * point primitive collection.
 */

import * as Cesium from 'cesium';
import { ENTITY_MODE_WARN_AT, GLOBAL_DEFAULTS, KINDS, MAX_PER_KIND } from './config.js';
import { Hud } from './hud.js';
import { loadLandMask } from './landmask.js';
import { buildPanel } from './panel.js';
import { attachAll, EntityRenderer, PointRenderer } from './renderers.js';
import { Selection } from './selection.js';
import { Simulation } from './simulation.js';
import { createViewer } from './viewer.js';

/** Real seconds allowed to pass in one frame, before the time scale is applied. */
const MAX_FRAME_DT = 0.1;
const RECONCILE_INTERVAL_S = 1;

async function main() {
  const statusEl = document.getElementById('status');

  // The mask decodes local JPEGs while the viewer waits on ESRI, so the two
  // slowest parts of startup overlap.
  const [{ viewer, setTerrain, sampleGroundHeight, terrainOn, notes }, landMask] = await Promise.all([
    createViewer('cesiumContainer', { terrain: GLOBAL_DEFAULTS.terrain }),
    loadLandMask(),
  ]);

  if (!landMask.available) {
    notes.push('The land/ocean mask could not be built — ships and vehicles will spawn anywhere.');
  }

  const state = {
    timeScale: GLOBAL_DEFAULTS.timeScale,
    terrain: terrainOn,
    paused: false,
    renderMode: GLOBAL_DEFAULTS.renderMode,
  };

  const sim = new Simulation(landMask);
  const pointRenderer = new PointRenderer(viewer.scene, GLOBAL_DEFAULTS.pointSize);
  const entityRenderer = new EntityRenderer(viewer, GLOBAL_DEFAULTS.pointSize);
  let renderer = pointRenderer;
  entityRenderer.show = false;

  sim.onSpawn = (slot) => renderer.attach(slot, sim.kind[slot]);
  sim.onDespawn = (slot) => renderer.detach(slot);

  const selection = new Selection(viewer, sim, () => renderer);
  const hud = new Hud(document.getElementById('hud'));

  let messageTimer = 0;
  function say(message, sticky = false) {
    window.clearTimeout(messageTimer);
    statusEl.hidden = !message;
    statusEl.textContent = message ?? '';
    if (message && !sticky) messageTimer = window.setTimeout(() => (statusEl.hidden = true), 6000);
  }
  selection.onChange = (message) => say(message);

  // ------------------------------------------------------------- auto ramp
  const ramp = { active: false, best: 0 };

  function stopRamp(message) {
    if (!ramp.active) return;
    ramp.active = false;
    panel.setRamping(false);
    if (message) say(message, true);
  }

  function stepRamp() {
    if (!ramp.active) return;

    // Wait for the spawner to catch up before judging the frame rate, or the
    // ramp races ahead of the population it is supposed to be measuring.
    const target = sim.targets.reduce((a, b) => a + b, 0);
    if (sim.liveCount < target * 0.98) return;

    const fps = hud.medianFps();
    if (fps < GLOBAL_DEFAULTS.rampFpsFloor) {
      stopRamp(
        ramp.best === 0
          ? `Ramp stopped before it started: already at ${fps.toFixed(0)} fps with ` +
              `${sim.liveCount.toLocaleString()} movers, below the ${GLOBAL_DEFAULTS.rampFpsFloor} fps floor. ` +
              'Turn the counts down, or the point size.'
          : `Ramp stopped at ${sim.liveCount.toLocaleString()} live movers and ${fps.toFixed(0)} fps ` +
              `(floor is ${GLOBAL_DEFAULTS.rampFpsFloor}). Last count that held the floor: ${ramp.best.toLocaleString()}.`,
      );
      return;
    }

    ramp.best = sim.liveCount;
    if (sim.targets.every((value) => value >= MAX_PER_KIND)) {
      stopRamp(
        `Ramp finished: every slider is maxed at ${sim.liveCount.toLocaleString()} live movers, ` +
          `still holding ${fps.toFixed(0)} fps. This machine wins.`,
      );
      return;
    }

    for (const kind of KINDS) {
      const next = Math.min(MAX_PER_KIND, sim.targets[kind.index] + Math.max(500, Math.ceil(sim.targets[kind.index] * 0.3)));
      sim.setTarget(kind.index, next);
      panel.setCount(kind.index, next);
    }
  }

  // -------------------------------------------------------- renderer swap
  function setRenderMode(mode) {
    if (mode === state.renderMode) return;

    if (mode === 'entities' && sim.liveCount > ENTITY_MODE_WARN_AT) {
      const proceed = window.confirm(
        `About to build ${sim.liveCount.toLocaleString()} entities.\n\n` +
          'That is the point of the comparison, but it will lock this tab up for a while and may ' +
          'run the tab out of memory.\n\nSwitch anyway?',
      );
      if (!proceed) {
        panel.setRenderMode(state.renderMode);
        return;
      }
    }

    stopRamp();
    selection.clear();

    renderer.clear();
    renderer.show = false;
    renderer = mode === 'entities' ? entityRenderer : pointRenderer;
    state.renderMode = mode;

    say(`Rebuilding ${sim.liveCount.toLocaleString()} movers as ${mode}…`, true);
    // Yield once so the message actually paints before the long rebuild.
    window.setTimeout(() => {
      const started = performance.now();
      attachAll(renderer, sim);
      // attachAll parks everything at the origin; this is the frame that puts
      // them where they actually are.
      renderer.sync(sim);
      renderer.show = true;
      selection.reapplyTo(renderer);
      say(
        `Rebuilt ${sim.liveCount.toLocaleString()} movers as ${mode} in ${(performance.now() - started).toFixed(0)} ms.`,
      );
    }, 0);
  }

  function reset() {
    stopRamp();
    selection.clear();
    for (const kind of KINDS) sim.setTarget(kind.index, 0);
    sim.reconcile(); // removals are immediate, so this empties the world now
    renderer.clear();
    for (const kind of KINDS) {
      sim.setTarget(kind.index, kind.count.value);
      sim.setSpeed(kind.index, kind.speed.value);
      sim.setLegKm(kind.index, kind.leg.value);
      panel.setCount(kind.index, kind.count.value);
    }
    say('Reset to defaults.');
  }

  // -------------------------------------------------------------- controls
  const panel = buildPanel(document.getElementById('controls'), {
    count: (kind, value) => {
      sim.setTarget(kind, value);
      stopRamp();
    },
    speed: (kind, value) => sim.setSpeed(kind, value),
    leg: (kind, value) => sim.setLegKm(kind, value),
    timeScale: (value) => (state.timeScale = value),
    pointSize: (value) => {
      pointRenderer.setPointSize(value);
      entityRenderer.setPointSize(value);
    },
    terrain: async (enabled) => {
      const applied = await setTerrain(enabled);
      state.terrain = applied;
      if (enabled && !applied) {
        panel.setTerrain(false);
        say('ESRI world elevation is unreachable from here — staying on the ellipsoid.');
      }
    },
    pause: (paused) => (state.paused = paused),
    renderMode: setRenderMode,
    ramp: () => {
      if (ramp.active) {
        stopRamp('Ramp stopped.');
        return;
      }
      ramp.active = true;
      // Zero until a step actually survives the fps floor, so the report can
      // tell "never got off the ground" from "held N and then broke".
      ramp.best = 0;
      panel.setRamping(true);
      say('Ramping — adding movers every second until the frame rate gives out.', true);
    },
    reset,
  });

  panel.setTerrain(state.terrain);
  if (notes.length) say(notes.join(' '), true);

  // ------------------------------------------------------------ main loop
  let lastFrameAt = performance.now();
  // Primed so the first batch spawns on the first frame rather than a second in.
  let sinceReconcile = RECONCILE_INTERVAL_S;

  viewer.scene.preUpdate.addEventListener(() => {
    const now = performance.now();
    const frameMs = now - lastFrameAt;
    lastFrameAt = now;

    // Clamped so that a tab returning from the background does not teleport
    // every mover halfway around the planet.
    const realDt = Math.min(frameMs / 1000, MAX_FRAME_DT);

    let simMs = 0;
    let syncMs = 0;

    if (!state.paused) {
      sinceReconcile += realDt;
      if (sinceReconcile >= RECONCILE_INTERVAL_S) {
        sinceReconcile = 0;
        sim.reconcile();
        stepRamp();
        for (const kind of KINDS) panel.setLive(kind.index, sim.countOf(kind.index));
      }

      const simStart = performance.now();
      sim.step(realDt * state.timeScale, { sampleGroundHeight, terrainEnabled: state.terrain });
      simMs = performance.now() - simStart;

      selection.update();

      // Only while running: pushing unchanged positions would dirty every
      // primitive again, and the paused frame time is a useful reading on its
      // own — it is what Cesium costs to draw this many points and nothing else.
      const syncStart = performance.now();
      renderer.sync(sim);
      syncMs = performance.now() - syncStart;
    }

    hud.sample({ frameMs, simMs, syncMs });
    hud.render(sim, renderer, state);
  });

  viewer.scene.postRender.addEventListener(() => {
    // Populated during render and not cleared until the next frame starts, so
    // this is genuinely the count of draw commands Cesium just issued.
    const commands = viewer.scene.frameState?.commandList?.length;
    hud.drawCommands = typeof commands === 'number' && commands > 0 ? commands : null;
    hud.tilesStreaming = !viewer.scene.globe.tilesLoaded;
  });

  // ------------------------------------------------------------------ chrome
  const panelEl = document.getElementById('panel');
  const toggle = document.getElementById('panel-toggle');
  toggle.addEventListener('click', () => {
    const collapsed = panelEl.classList.toggle('collapsed');
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.title = collapsed ? 'Show the panel' : 'Hide the panel';
    toggle.firstElementChild.textContent = collapsed ? '›' : '‹';
  });

  document.getElementById('loading').remove();

  // Cesium's own error banner is easy to miss behind the panel.
  viewer.scene.renderError.addEventListener((_scene, error) => {
    say(`Rendering stopped: ${error}`, true);
  });

  // Handy when reading the profile: everything is reachable from the console.
  window.stressTest = { viewer, sim, hud, get renderer() { return renderer; }, state, Cesium };
}

main().catch((error) => {
  console.error(error);
  const loading = document.getElementById('loading');
  if (loading) {
    loading.innerHTML = `<div class="loading-inner error">Failed to start: ${String(error)}</div>`;
  }
});
