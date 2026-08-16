/**
 * Parameter sweep over the balance harness.
 *
 * `selfplay.mjs` answers "is the game the current numbers describe any good?".
 * This answers the question behind it: "which numbers should they be?". It
 * plays the same batch of matches under several candidate configurations and
 * prints them side by side, so a change to the army size is a measurement
 * rather than a guess.
 *
 * The mechanism is blunt on purpose. The config module exports plain objects,
 * ES module bindings are live, and nothing caches the values at import time, so
 * a variant is applied by mutating those objects in place before the batch and
 * restoring them afterwards. That beats threading a config parameter through
 * every function in the rules for the sake of a script.
 *
 * The metric that matters most here is `board`: the fraction of passable hexes
 * that any column stood on at some point in the match. That is the number that
 * says whether a sixty-nine kilometre theatre is actually being used, and it is
 * the reason this script exists.
 *
 *   node scripts/sweep.mjs [matches-per-variant] [theatre]
 */

import { AI_SIDE, PLAYER_SIDE, createGame, endTurn, summarise } from '../src/model.js';
import { takeAiTurn } from '../src/ai.js';
import { AI, AP, ARMY, MATCH, MOVEMENT, SIEGE, TERRAIN, WALLS } from '../src/config.js';

const matches = Number(process.argv[2] ?? 24);
const theatreKey = process.argv[3] ?? 'marches';

/** The live config objects, by the name a variant uses to address them. */
const LIVE = { AI, AP, ARMY, MATCH, MOVEMENT, SIEGE, WALLS };
const BASE = structuredClone(LIVE);

/**
 * The scale the game shipped with before the campaign was ramped up, kept as a
 * variant so the change stays measurable rather than becoming folklore. Every
 * other variant below is a delta on the *current* config.
 */
const OLD_SCALE = {
  AI: { spread: 0 },
  AP: { baseIncome: 4, hexesPerBonusAp: 45, maxIncome: 18, buildWall: 3 },
  ARMY: {
    maxTroopsPerOfficer: 6000,
    maxOfficersPerStack: 4,
    maxOfficersPerSide: 8,
    startingColumns: 2,
    startingTroops: 7000,
  },
  MATCH: { turnLimit: 40 },
  MOVEMENT: { baseAllowance: 5, troopsPerPenalty: 5000, minAllowance: 2 },
  SIEGE: { garrisonStart: 12000, garrisonMax: 13000, drainPerRingHex: 600, regenPerTurn: 300 },
  WALLS: { maxSegmentsPerSide: 8, buildRange: 0 },
};

/**
 * Each variant is a sparse overlay on the shipped config, written as a delta so
 * that what a variant is *testing* is the only thing you have to read.
 *
 * The comments record what each round found, because the findings are the
 * reason the shipped numbers are what they are and they are not recoverable
 * from the numbers alone.
 */
const VARIANTS = {
  /** The configuration as it stands, for a baseline to read the rest against. */
  shipped: {},

  /** Where it started. Board usage here is the number the ramp-up was aimed at. */
  oldScale: OLD_SCALE,

  // --- Round one: what actually fills the board? -------------------------
  // Usage tracks the *number* of columns and barely moves with how big they
  // are: from the old scale, raising troops per officer alone left usage
  // unchanged, while raising the officer cap moved it. Hence sixteen officers.
  oldScaleBigArmies: {
    ...OLD_SCALE,
    ARMY: { ...OLD_SCALE.ARMY, maxTroopsPerOfficer: 9000 },
    MOVEMENT: { ...OLD_SCALE.MOVEMENT, troopsPerPenalty: 8000, minAllowance: 3 },
  },
  oldScaleMoreOfficers: {
    ...OLD_SCALE,
    ARMY: { ...OLD_SCALE.ARMY, maxOfficersPerSide: 16 },
    AP: { ...OLD_SCALE.AP, baseIncome: 8, hexesPerBonusAp: 26, maxIncome: 34 },
  },

  // --- Round two: a bigger army makes the siege optional -----------------
  // At sixteen officers a full column can empty a small garrison in one
  // assault, so castles stopped being besieged and started being walked into.
  // 32,000 is the point where the first assault leaves the attacker too weak
  // to finish; these bracket it.
  siegeSofter: { SIEGE: { garrisonStart: 24000, garrisonMax: 26000, drainPerRingHex: 2400, regenPerTurn: 600 } },
  siegeHarder: { SIEGE: { garrisonStart: 40000, garrisonMax: 42000, drainPerRingHex: 4200, regenPerTurn: 1000 } },

  // --- Round three: columns that avoid each other ------------------------
  // Sixteen officers all read the same cost field and take the same road, so
  // without a crowding term the extra columns arrive in a clot and usage stays
  // where it was. This is what actually spread the advance.
  noSpread: { AI: { spread: 0 } },
  spreadHarder: { AI: { spread: 200 } },

  // --- Walls -------------------------------------------------------------
  // The build radius is what made walls worth the AP; zero is the old rule of
  // having to stand on the segment.
  wallsNoReach: { WALLS: { buildRange: 0 } },
  wallsFarReach: { WALLS: { buildRange: 3 } },
};

const mean = (xs) => (xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : 0);

const requested = process.env.VARIANTS?.split(',').map((s) => s.trim()).filter(Boolean);
const names = requested?.length ? requested : Object.keys(VARIANTS);

console.log(`${theatreKey}, ${matches} matches per variant`);
console.log('variant               west  east  |  turns  taken  |  board  cols  peak force  walls  |  time');

for (const name of names) {
  const overlay = VARIANTS[name];
  if (!overlay) {
    console.log(`${name.padEnd(21)} — no such variant`);
    continue;
  }
  apply(overlay);
  try {
    report(name, run());
  } finally {
    restore();
  }
}

// --------------------------------------------------------------------------

function apply(overlay) {
  for (const [group, values] of Object.entries(overlay)) Object.assign(LIVE[group], values);
}

function restore() {
  for (const [group, values] of Object.entries(BASE)) {
    for (const key of Object.keys(LIVE[group])) delete LIVE[group][key];
    Object.assign(LIVE[group], values);
  }
}

function run() {
  const started = Date.now();
  const tally = { west: 0, east: 0, draw: 0, unfinished: 0 };
  const turns = [];
  const usage = [];
  const peakColumns = [];
  const peakForce = [];
  const walls = [];
  const captures = [];

  for (let i = 0; i < matches; i += 1) {
    const state = createGame({ theatreKey, seed: `sweep-${i}`, difficulty: 'marshal' });
    const passable = state.map.terrain.filter((key) => TERRAIN[key].passable).length;
    const touched = new Set();
    let columns = 0;
    let force = 0;

    // Driven exactly as selfplay.mjs drives it: whoever is active moves, then
    // the turn ends, with a hard cap on half-turns in case a rule bug ever
    // stops the clock. Anything else and the two harnesses answer different
    // questions while appearing to answer the same one.
    for (let step = 0; step < MATCH.turnLimit * 2 + 8 && state.status === 'playing'; step += 1) {
      takeAiTurn(state, state.activeSide);
      for (const stack of state.stacks.values()) touched.add(stack.hex);
      columns = Math.max(columns, state.stacks.size);
      force = Math.max(force, summarise(state, PLAYER_SIDE).troops, summarise(state, AI_SIDE).troops);
      endTurn(state);
    }

    usage.push(touched.size / passable);
    peakColumns.push(columns);
    peakForce.push(force);
    walls.push(state.sides[PLAYER_SIDE].wallsBuilt + state.sides[AI_SIDE].wallsBuilt);
    turns.push(state.turn);

    if (state.status === 'playing') tally.unfinished += 1;
    else if (state.status === 'crown-wins') tally.west += 1;
    else if (state.status === 'marcher-wins') tally.east += 1;
    else tally.draw += 1;

    if (state.outcome?.reason === 'capture') captures.push(state.turn);
  }

  return { tally, turns, usage, peakColumns, peakForce, walls, captures, seconds: (Date.now() - started) / 1000 };
}

function report(name, r) {
  const pct = (n) => `${Math.round((n / matches) * 100)}%`.padStart(4);
  console.log(
    `${name.padEnd(21)} ${pct(r.tally.west)}  ${pct(r.tally.east)}  |  ` +
      `${mean(r.turns).toFixed(1).padStart(5)}  ${pct(r.captures.length)}  |  ` +
      `${`${Math.round(mean(r.usage) * 100)}%`.padStart(4)}  ${mean(r.peakColumns).toFixed(1).padStart(4)}  ` +
      `${Math.round(mean(r.peakForce)).toLocaleString().padStart(10)}  ${mean(r.walls).toFixed(1).padStart(5)}  |  ` +
      `${Math.round(r.seconds)}s`,
  );
}
