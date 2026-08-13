/**
 * Wiring: menu to match, clicks to orders, model back out to the board.
 *
 * Everything with an opinion lives elsewhere — the rules in model.js, the
 * opponent in ai.js, the geometry under view/. What is left here is the state
 * machine for what a click means given what is currently selected, and the turn
 * loop that hands play back and forth.
 */

import * as Cesium from 'cesium';
import { createAudio } from './audio.js';
import { centreMeters, neighboursOf } from './hex.js';
import { takeAiTurn } from './ai.js';
import {
  assaultCastle,
  attack,
  breachWall,
  buildWall,
  castleOwnerAt,
  createGame,
  endTurn,
  forecastAttack,
  moveStack,
  moveTargets,
  reachableFrom,
  recruit,
  spawnOfficer,
  splitStack,
  stackAt,
  summarise,
} from './model.js';
import { wallBlocks } from './supply.js';
import { DEFAULT_THEATRE } from './theatres.js';
import { createBoard, createCastles, createWalls } from './view/board.js';
import { createFrame } from './view/geo.js';
import { createOrderLine, createUnits } from './view/units.js';
import { highlightsFor } from './view/overlay.js';
import { cageCamera, createViewer, frameBoard, lookAt, setShadows } from './view/viewer.js';
import { createHud } from './ui/hud.js';
import {
  createMenu,
  openRules,
  openSettings,
  renderSettings,
  showOutcome,
  wireModals,
} from './ui/screens.js';

const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = 'marchward:settings';

// --------------------------------------------------------------------------
// Persistent settings
// --------------------------------------------------------------------------

const settings = {
  shadows: true,
  confirmAttacks: true,
  followAi: true,
  theatre: DEFAULT_THEATRE,
  difficulty: 'marshal',
  audio: {},
  ...loadSettings(),
};

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, audio: audio.settings }));
  } catch {
    // Private browsing, or storage full. Losing the volume slider is survivable.
  }
}

const audio = createAudio(settings.audio);

// --------------------------------------------------------------------------
// Session state
// --------------------------------------------------------------------------

/** Everything belonging to the match currently on the board. */
let session = null;

const ui = {
  selectedId: null,
  hoveredHex: null,
  mode: 'select',
  split: { officers: 1, troops: 0 },
  pendingAttack: null,
  busy: false,
};

// --------------------------------------------------------------------------
// Boot
// --------------------------------------------------------------------------

const hud = createHud({ audio, actions: { order, raiseOfficer, recruit: doRecruit, armSplit } });

wireModals(audio);

const menu = createMenu({
  audio,
  initial: { theatre: settings.theatre, difficulty: settings.difficulty },
  onBegin: begin,
  onOpenRules: openRules,
  onOpenSettings: () => {
    renderSettings({ audio, settings, onChange: onSettingsChanged });
    openSettings();
  },
});

$('hud-rules').addEventListener('click', openRules);
$('hud-settings').addEventListener('click', () => {
  renderSettings({ audio, settings, onChange: onSettingsChanged });
  openSettings();
});
$('hud-menu').addEventListener('click', toMenu);
$('end-turn').addEventListener('click', onEndTurn);

$('small-anyway').addEventListener('click', () => {
  $('small-screen').hidden = true;
});

function onSettingsChanged() {
  if (session) setShadows(session.viewer, settings.shadows);
  saveSettings();
}

// The board needs room for a hex grid plus two side panels; below that it is
// not a hard failure, just a bad time, so the notice is dismissible.
if (Math.min(window.innerWidth, window.innerHeight) < 520 || window.innerWidth < 760) {
  $('small-screen').hidden = false;
}

$('loading').classList.add('fading');
setTimeout(() => {
  $('loading').hidden = true;
  $('menu').hidden = false;
}, 400);

// --------------------------------------------------------------------------
// Starting and ending a match
// --------------------------------------------------------------------------

async function begin({ theatre, difficulty, seed }) {
  settings.theatre = theatre;
  settings.difficulty = difficulty;
  saveSettings();

  menu.hide();
  $('loading').hidden = false;
  $('loading').classList.remove('fading');
  $('loading-note').textContent = 'Surveying the ground…';

  // One frame for the loading screen to paint before the synchronous board
  // build blocks the main thread.
  await nextFrame();

  if (session) teardown();

  const state = createGame({ theatreKey: theatre, seed, difficulty });
  $('loading-note').textContent = 'Raising the castles…';
  await nextFrame();

  const { viewer, scene, notes } = await createViewer('cesiumContainer', state.theatre, {
    shadows: settings.shadows,
  });
  const frame = createFrame(state.theatre);

  const board = createBoard(scene, frame, state.map, state.theatre);
  const castles = createCastles(scene, frame, state.map, state);
  const walls = createWalls(scene, frame, state.map, state);
  const units = createUnits(scene, frame, state.map, state);
  const orderLine = createOrderLine(scene, frame, state.map);
  const uncage = cageCamera(viewer, frame);

  session = { state, viewer, scene, frame, board, castles, walls, units, orderLine, uncage, handler: null };

  wireInput();
  frameBoard(viewer, frame);

  ui.selectedId = null;
  ui.mode = 'select';
  ui.hoveredHex = null;
  ui.pendingAttack = null;
  ui.busy = false;

  refresh();
  hud.show();
  if (!audio.settings.muted) audio.startMusic();

  if (notes.length) hud.toast(notes[0]);

  $('loading').classList.add('fading');
  setTimeout(() => {
    $('loading').hidden = true;
  }, 500);
}

function teardown() {
  session.handler?.destroy();
  session.uncage();
  session.orderLine.destroy();
  session.units.destroy();
  session.walls.destroy();
  session.castles.destroy();
  session.board.destroy();
  session.viewer.destroy();
  session = null;
}

function toMenu() {
  audio.play('click');
  hud.hide();
  menu.show();
}

// --------------------------------------------------------------------------
// Rendering the current state
// --------------------------------------------------------------------------

function refresh() {
  if (!session) return;
  const { state, board, castles, walls, units } = session;

  castles.rebuild();
  walls.rebuild();
  units.sync({ selectedId: ui.selectedId });
  board.setTinted(highlightsFor(state, board, { selectedId: ui.selectedId, mode: ui.mode }));
  hud.paint(state, ui);
}

/** Applies a batch of rules events: sounds, then a redraw. */
function playEvents(events) {
  for (const event of events) audio.playEvent(event);
}

// --------------------------------------------------------------------------
// Input
// --------------------------------------------------------------------------

function wireInput() {
  const handler = new Cesium.ScreenSpaceEventHandler(session.scene.canvas);

  handler.setInputAction((movement) => {
    const hex = pickHex(movement.endPosition);
    if (hex === ui.hoveredHex) return;
    ui.hoveredHex = hex;
    previewPath();
    // Only the orders panel depends on the hover, so the board is left alone.
    hud.paint(session.state, ui);
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  handler.setInputAction((click) => {
    const hex = pickHex(click.position);
    if (hex !== null) onClickHex(hex);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  session.handler = handler;

  document.addEventListener('keydown', onKey);
}

/** Whatever was clicked, reduced to the hex it belongs to. */
function pickHex(position) {
  const picked = session.scene.pick(position);
  const id = picked?.id;
  if (!id || typeof id !== 'object') return null;
  if (id.kind === 'hex') return id.index;
  if (id.kind === 'unit' || id.kind === 'castle') return id.hex;
  return null;
}

function previewPath() {
  const { state, orderLine } = session;
  const stack = ui.selectedId === null ? null : state.stacks.get(ui.selectedId);

  if (!stack || stack.side !== 'crown' || ui.mode !== 'select' || ui.hoveredHex === null) {
    orderLine.clear();
    return;
  }

  const field = reachableFrom(state, stack);
  const targets = moveTargets(state, stack, field);
  if (!targets.has(ui.hoveredHex)) {
    orderLine.clear();
    return;
  }

  const path = [];
  for (let at = ui.hoveredHex; at !== -1 && at !== undefined; at = field.get(at)?.from ?? -1) path.unshift(at);
  orderLine.show(path, state.sides.crown.colours.light);
}

/**
 * What a click means, given the current mode and selection. Written as an
 * explicit ladder rather than as a set of handlers because the precedence
 * matters: a click on an enemy standing on a hex you could also march to is an
 * attack, not a move.
 */
function onClickHex(hex) {
  const { state } = session;
  if (state.status !== 'playing' || ui.busy) return;
  if (state.activeSide !== 'crown') return;

  const stack = ui.selectedId === null ? null : state.stacks.get(ui.selectedId);

  if (ui.mode === 'wall' && stack) {
    finishWall(stack, hex);
    return;
  }

  if (ui.mode === 'split-place' && stack) {
    finishSplit(stack, hex);
    return;
  }

  const occupant = stackAt(state, hex);

  // Selecting one of your own columns always wins — you can never be trapped
  // in a state where the column you want is unreachable because it is standing
  // somewhere the current selection could attack.
  if (occupant && occupant.side === 'crown') {
    select(occupant.id === ui.selectedId ? null : occupant.id);
    return;
  }

  if (stack && stack.side === 'crown') {
    if (tryAttackOrBreach(stack, hex)) return;
    if (tryMove(stack, hex)) return;
  }

  select(occupant ? occupant.id : null);
}

function select(id) {
  ui.selectedId = id;
  ui.mode = 'select';
  ui.pendingAttack = null;
  if (id !== null) audio.play('select');
  previewPath();
  refresh();
}

function tryAttackOrBreach(stack, hex) {
  const { state } = session;
  if (!neighboursOf(stack.hex).includes(hex)) return false;

  if (wallBlocks(state, stack.hex, hex, stack.side)) {
    apply(breachWall(state, stack.id, hex));
    return true;
  }

  const forecast = forecastAttack(state, stack, hex);
  if (!forecast) return false;

  // A confirmed attack takes two clicks on the same hex: the first arms it and
  // shows the forecast, the second commits.
  if (settings.confirmAttacks && ui.pendingAttack !== hex) {
    ui.pendingAttack = hex;
    hud.paint(state, ui);
    audio.play('select');
    return true;
  }

  ui.pendingAttack = null;
  const isCastle = castleOwnerAt(state, hex) !== null;
  apply(isCastle ? assaultCastle(state, stack.id) : attack(state, stack.id, hex));
  return true;
}

function tryMove(stack, hex) {
  const { state } = session;
  if (!moveTargets(state, stack).has(hex)) return false;
  const before = stack.id;
  const result = apply(moveStack(state, stack.id, hex));
  if (result.ok) {
    audio.play('march');
    // A column that merged into another has ceased to exist; follow the survivor.
    if (!state.stacks.has(before)) ui.selectedId = stackAt(state, hex)?.id ?? null;
  }
  return true;
}

// --------------------------------------------------------------------------
// Orders from the panel
// --------------------------------------------------------------------------

function order(kind, stack) {
  audio.play('click');
  if (kind === 'cancel') {
    ui.mode = 'select';
    ui.pendingAttack = null;
    refresh();
    return;
  }
  if (kind === 'split') ui.mode = 'split';
  if (kind === 'recruit') ui.mode = 'recruit';
  if (kind === 'wall') ui.mode = 'wall';
  refresh();
}

function armSplit() {
  ui.mode = 'split-place';
  refresh();
}

function finishSplit(stack, hex) {
  const result = apply(
    splitStack(session.state, stack.id, {
      officers: ui.split.officers,
      troops: ui.split.troops,
      target: hex,
    }),
  );
  if (result.ok) {
    ui.mode = 'select';
    audio.play('officer');
  }
}

function finishWall(stack, hex) {
  if (!neighboursOf(stack.hex).includes(hex)) {
    ui.mode = 'select';
    refresh();
    return;
  }
  const result = apply(buildWall(session.state, 'crown', stack.hex, hex));
  if (result.ok) ui.mode = 'select';
}

function doRecruit(troops) {
  const result = apply(recruit(session.state, ui.selectedId, troops));
  if (result.ok) ui.mode = 'select';
}

function raiseOfficer() {
  const result = apply(spawnOfficer(session.state, 'crown'));
  if (result.ok) audio.play('officer');
}

/** Runs a rules result: complains on failure, plays and redraws on success. */
function apply(result) {
  if (!result.ok) {
    hud.toast(result.reason);
    return result;
  }
  playEvents(result.events);
  refresh();
  checkFinished();
  return result;
}

// --------------------------------------------------------------------------
// Turn flow
// --------------------------------------------------------------------------

async function onEndTurn() {
  const { state } = session;
  if (state.status !== 'playing') {
    toMenu();
    return;
  }
  if (ui.busy || state.activeSide !== 'crown') return;

  ui.busy = true;
  ui.selectedId = null;
  ui.mode = 'select';
  ui.pendingAttack = null;
  session.orderLine.clear();
  audio.play('turn');

  // Hand over: this runs the opponent's start-of-turn supply, desertion and siege.
  playEvents(endTurn(state).events);
  refresh();

  if (state.status === 'playing') {
    await pause(600);
    const events = takeAiTurn(state);
    playEvents(events);
    refresh();
    await showAiHighlight(events);
  }

  if (state.status === 'playing') {
    await pause(350);
    playEvents(endTurn(state).events);
    refresh();
    audio.play('turn');
  }

  ui.busy = false;
  refresh();
  checkFinished();
}

/**
 * Points the camera at the most consequential thing the opponent just did, so a
 * turn that happened off-screen is not simply a change of numbers in the
 * chronicle.
 */
async function showAiHighlight(events) {
  if (!settings.followAi) return;
  const rank = { assault: 4, siege: 3, battle: 2, breach: 2, wall: 1 };
  const best = events
    .filter((event) => event.hex !== null && event.hex !== undefined && rank[event.kind])
    .sort((a, b) => rank[b.kind] - rank[a.kind])[0];
  if (!best) return;

  const { x, y } = centreMeters(best.hex);
  lookAt(session.viewer, session.frame, x, y, { duration: 0.8 });
  await pause(950);
}

function checkFinished() {
  const { state } = session;
  if (state.status === 'playing') return;

  audio.play(state.status === 'crown-wins' ? 'victory' : 'defeat');
  showOutcome(
    state,
    { crown: summarise(state, 'crown'), marcher: summarise(state, 'marcher') },
    { onAgain: toMenu, onLook: () => {} },
  );
}

// --------------------------------------------------------------------------
// Keyboard
// --------------------------------------------------------------------------

function onKey(event) {
  if (!session || $('menu').hidden === false) return;
  if (event.target instanceof HTMLInputElement) return;
  const { state } = session;

  if (event.key === 'Escape') {
    if (ui.mode !== 'select' || ui.selectedId !== null) {
      select(null);
      event.preventDefault();
    }
    return;
  }

  if (event.code === 'Space') {
    event.preventDefault();
    onEndTurn();
    return;
  }

  if (event.key === 'Tab') {
    event.preventDefault();
    cycleColumns();
    return;
  }
}

/** Tab through your columns that still have something they could do. */
function cycleColumns() {
  const { state } = session;
  if (state.activeSide !== 'crown') return;

  const yours = [...state.stacks.values()]
    .filter((stack) => stack.side === 'crown' && (stack.mp > 0 || !stack.attacked))
    .sort((a, b) => a.id - b.id);
  if (!yours.length) return;

  const at = yours.findIndex((stack) => stack.id === ui.selectedId);
  const next = yours[(at + 1) % yours.length];
  select(next.id);

  const { x, y } = centreMeters(next.hex);
  lookAt(session.viewer, session.frame, x, y, { duration: 0.5 });
}

// --------------------------------------------------------------------------

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

window.addEventListener('beforeunload', saveSettings);
