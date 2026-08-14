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
import { RELIEF } from './config.js';
import { centreMeters, neighboursOf } from './hex.js';
import { aiTurnSteps, takeAiTurn } from './ai.js';
import {
  assaultCastle,
  attack,
  breachWall,
  buildWall,
  castleOwnerAt,
  createGame,
  endTurn,
  forecastAttack,
  mergeTargets,
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
import { createFrame, hexCentre, hexHeight } from './view/geo.js';
import { createOrderLine, createUnits } from './view/units.js';
import { highlightsFor } from './view/overlay.js';
import { cageCamera, createViewer, frameBoard, isOnScreen, lookAt, setShadows } from './view/viewer.js';
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
  tileAlpha: RELIEF.tileAlpha,
  confirmMoves: true,
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
  /**
   * Whether the selected column will take orders from a click on the board.
   *
   * Only clicking the column itself arms it. Selecting one any other way —
   * Tab, which is also the browser's focus key — shows its readout without
   * lighting up the movement range, so a stray keypress followed by a stray
   * click can never march an army somewhere you did not intend.
   */
  armed: false,
  /** The hex whose details are showing. Set by any click on the board. */
  inspectHex: null,
  hoveredHex: null,
  mode: 'select',
  split: { officers: 1, troops: 0 },
  pendingAttack: null,
  /** A destination armed by a first click, waiting for the second to commit. */
  pendingMove: null,
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

$('inspector-close').addEventListener('click', () => {
  ui.inspectHex = null;
  audio.play('click');
  refresh();
});

function onSettingsChanged() {
  if (session) {
    setShadows(session.viewer, settings.shadows);
    session.board.setAlpha(settings.tileAlpha);
    refresh();
  }
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

  const board = createBoard(scene, frame, state.map, state.theatre, { alpha: settings.tileAlpha });
  const castles = createCastles(scene, frame, state.map, state);
  const walls = createWalls(scene, frame, state.map, state);
  const units = createUnits(scene, frame, state.map, state);
  const orderLine = createOrderLine(scene, frame, state.map);
  const uncage = cageCamera(viewer, frame);

  session = { state, viewer, scene, frame, board, castles, walls, units, orderLine, uncage, handler: null };

  wireInput();
  frameBoard(viewer, frame);

  ui.selectedId = null;
  ui.armed = false;
  ui.inspectHex = null;
  ui.mode = 'select';
  ui.hoveredHex = null;
  ui.pendingAttack = null;
  ui.pendingMove = null;
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
  previewPath();
  board.setTinted(
    highlightsFor(state, board, {
      selectedId: ui.selectedId,
      mode: ui.mode,
      armed: ui.armed,
      pendingMove: ui.pendingMove,
      pendingAttack: ui.pendingAttack,
    }),
  );
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

  if (!stack || !ui.armed || stack.side !== 'crown' || ui.mode !== 'select') {
    orderLine.clear();
    return;
  }
  if (ui.hoveredHex === null && ui.pendingMove === null) {
    orderLine.clear();
    return;
  }

  const field = reachableFrom(state, stack);
  const targets = moveTargets(state, stack, field);
  // Once a destination is armed the line stays on it, so the route you are
  // about to confirm does not follow the pointer away.
  const shown = ui.pendingMove !== null && targets.has(ui.pendingMove) ? ui.pendingMove : ui.hoveredHex;
  if (!targets.has(shown)) {
    orderLine.clear();
    return;
  }

  const path = [];
  for (let at = shown; at !== -1 && at !== undefined; at = field.get(at)?.from ?? -1) path.unshift(at);
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
  if (ui.busy) return;

  // Inspecting is free and always available — during the enemy's turn, after
  // the campaign has ended, and on ground you have no business being on. It is
  // how the player learns what any of this means.
  ui.inspectHex = hex;

  if (state.status !== 'playing' || state.activeSide !== 'crown') {
    refresh();
    return;
  }

  const stack = ui.selectedId === null ? null : state.stacks.get(ui.selectedId);

  if (ui.mode === 'wall' && stack) {
    finishWall(stack, hex);
    return;
  }

  if (ui.mode === 'split-place' && stack) {
    finishSplit(stack, hex);
    return;
  }

  // Joining has to be handled before the branch below, which selects any
  // friendly column that is clicked and returns. That branch is why merging was
  // unreachable: moveStack has always folded one column into another on
  // arrival, and moveTargets has always offered friendly hexes as
  // destinations, but a click on one only ever changed the selection.
  if (ui.mode === 'merge' && stack) {
    finishMerge(stack, hex);
    return;
  }

  const occupant = stackAt(state, hex);

  // Selecting one of your own columns always wins — you can never be trapped
  // in a state where the column you want is unreachable because it is standing
  // somewhere the current selection could attack.
  //
  // Clicking it is also the only thing that *arms* it. A column selected any
  // other way is being looked at, not commanded: clicking a column that is
  // merely selected arms it rather than deselecting it, and only a click on one
  // already armed puts it away.
  if (occupant && occupant.side === 'crown') {
    if (occupant.id === ui.selectedId && ui.armed) select(null);
    else select(occupant.id, { armed: true });
    return;
  }

  // Orders issued by clicking the board need the column armed. Without this,
  // Tab — which is also the browser's focus key — would arm an army by
  // accident, and the next click anywhere on the map would march it.
  if (stack && stack.side === 'crown' && ui.armed) {
    if (tryAttackOrBreach(stack, hex)) return;
    if (tryMove(stack, hex)) return;
  }

  select(occupant ? occupant.id : null);
}

function select(id, { armed = false } = {}) {
  ui.selectedId = id;
  ui.armed = id !== null && armed;
  ui.mode = 'select';
  ui.pendingAttack = null;
  ui.pendingMove = null;
  if (id !== null) audio.play('select');
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
    ui.pendingMove = null;
    refresh();
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

  // Same two-step as an attack: the first click arms the destination and shows
  // what the march would cost, the second commits it. Moving is the order you
  // give most often and the easiest to fire by accident, and there is no undo.
  if (settings.confirmMoves && ui.pendingMove !== hex) {
    ui.pendingMove = hex;
    ui.pendingAttack = null;
    refresh();
    audio.play('select');
    return true;
  }

  ui.pendingMove = null;
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
    ui.pendingMove = null;
    refresh();
    return;
  }
  if (kind === 'split') ui.mode = 'split';
  if (kind === 'recruit') ui.mode = 'recruit';
  if (kind === 'wall') {
    ui.mode = 'wall';
    ui.armed = true;
  }
  if (kind === 'merge') {
    ui.mode = 'merge';
    ui.armed = true;
  }
  refresh();
}

function armSplit() {
  ui.mode = 'split-place';
  ui.armed = true;
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

/**
 * Fold this column into a friendly one it can reach. The march itself does the
 * work — moveStack merges whatever it arrives on — so this only has to check
 * that the target is a legal one and report it when it is not.
 */
function finishMerge(stack, hex) {
  const { state } = session;
  if (!mergeTargets(state, stack).has(hex)) {
    hud.toast(
      'That column cannot be joined this turn. It has to be within marching reach, and the two together must fit under four officers.',
    );
    ui.mode = 'select';
    refresh();
    return;
  }

  const joining = stack.id;
  const result = apply(moveStack(state, stack.id, hex));
  if (!result.ok) return;

  ui.mode = 'select';
  audio.play('march');
  // The column that marched has ceased to exist; follow the combined one.
  if (!state.stacks.has(joining)) ui.selectedId = stackAt(state, hex)?.id ?? null;
  refresh();
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
  ui.armed = false;
  ui.mode = 'select';
  ui.pendingAttack = null;
  ui.pendingMove = null;
  session.orderLine.clear();
  audio.play('turn');

  // Hand over: this runs the opponent's start-of-turn supply, desertion and siege.
  playEvents(endTurn(state).events);
  refresh();

  if (state.status === 'playing') {
    await pause(500);
    await playEnemyTurn();
  }

  if (state.status === 'playing') {
    await pause(350);
    playEvents(endTurn(state).events);
    refresh();
    audio.play('turn');
    await returnToCapital();
  }

  ui.busy = false;
  refresh();
  checkFinished();
}

/**
 * The beats of an enemy action, in milliseconds.
 *
 * Split into travel, a pause before, and a pause after, because those are three
 * different jobs: the camera has to get there, the eye has to arrive before the
 * thing happens, and the result has to stay up long enough to be read. Fights
 * get the longest tail — a levy raised at a castle is not worth the same beat as
 * an assault on one.
 */
const PACING = {
  cameraFlight: 520,
  beforeAction: 240,
  after: { muster: 320, march: 560, fight: 1150 },
};

/**
 * Plays the opponent's turn out one action at a time, camera first.
 *
 * The order matters and it is the whole point: travel to the hex, let it
 * settle, *then* commit the action, then hold. Showing the result and panning
 * afterwards means every move is seen in hindsight — you arrive to find a
 * column already somewhere else and have to work backwards. Leading with the
 * camera means you are looking at the right patch of ground when it happens.
 *
 * The camera only travels when the action is not already comfortably in frame,
 * since flying to something already under the player's nose reads as a twitch.
 */
async function playEnemyTurn() {
  const { state, viewer, frame } = session;
  const map = state.map;

  if (!settings.followAi) {
    playEvents(takeAiTurn(state));
    refresh();
    return;
  }

  for (const step of aiTurnSteps(state)) {
    if (step.focus !== undefined && step.focus !== null) {
      const target = hexCentre(frame, step.focus, hexHeight(map, step.focus));
      // A column marching in from off-screen is worth following even when the
      // hex it arrives on is already in view.
      const cameFromOffScreen =
        step.from !== undefined && !isOnScreen(viewer, hexCentre(frame, step.from, hexHeight(map, step.from)));

      if (!isOnScreen(viewer, target, 0.26) || cameFromOffScreen) {
        const { x, y } = centreMeters(step.focus);
        lookAt(viewer, frame, x, y, { duration: 0.55 });
        await pause(PACING.cameraFlight);
      }
      await pause(PACING.beforeAction);
    }

    const result = step.commit();
    if (!result?.ok) continue;

    playEvents(result.events);
    refresh();
    const headline = result.events.find((event) => event.text)?.text;
    if (headline) $('prompt').textContent = headline;

    await pause(PACING.after[step.pace] ?? 620);
    if (state.status !== 'playing') return;
  }
}

/**
 * Bring the view home when the turn comes back to you.
 *
 * After watching the opponent, the camera is left wherever their last order
 * happened — which is a different place every turn and usually not one of
 * yours. Returning to your own castle gives every turn the same opening frame.
 * Skipped when playback is off, since then the camera never moved and hauling
 * it away from wherever you left it would be the annoyance rather than the fix.
 */
async function returnToCapital() {
  if (!settings.followAi || !session) return;
  const { state, viewer, frame } = session;
  const { x, y } = centreMeters(state.sides.crown.castle);
  lookAt(viewer, frame, x, y, { duration: 0.9 });
  await pause(560);
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
    if (ui.mode !== 'select' || ui.selectedId !== null || ui.inspectHex !== null) {
      ui.inspectHex = null;
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
  // Deliberately unarmed: Tab finds a column and looks at it, it does not
  // hand it its orders.
  select(next.id, { armed: false });
  ui.inspectHex = next.hex;
  refresh();

  const { x, y } = centreMeters(next.hex);
  lookAt(session.viewer, session.frame, x, y, { duration: 0.5 });
}

// --------------------------------------------------------------------------

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

window.addEventListener('beforeunload', saveSettings);
