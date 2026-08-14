/**
 * The game itself: state, and every legal action on it.
 *
 * This module knows nothing about Cesium, the DOM, or how anything is drawn.
 * That is deliberate — the rules are the part worth being able to reason about
 * and test, and keeping the renderer on the other side of this boundary means a
 * balance question can be answered by running ten thousand matches in Node
 * rather than by playing them.
 *
 * Every action follows the same shape: it validates, mutates, and returns
 * `{ ok, reason?, events }`. Actions never throw on an illegal move — the UI
 * greys most of them out, but the AI probes for legality and a thrown exception
 * would make that expensive.
 */

import { AP, ARMY, COMBAT, DIFFICULTIES, MATCH, MOVEMENT, SIEGE, TERRAIN, WALLS } from './config.js';
import { generateMap } from './mapgen.js';
import { THEATRES, SIDE_COLOURS } from './theatres.js';
import { makeRng, randomSeedWord } from './rng.js';
import { directionTowards, distance, edgeKey, neighboursOf, pathTo, reachable } from './hex.js';
import {
  apIncome,
  applySupplyEffects,
  computeSupply,
  otherSide,
  removeStack,
  wallBlocks,
  zoneOfControl,
} from './supply.js';

export const PLAYER_SIDE = 'crown';
export const AI_SIDE = 'marcher';

// --------------------------------------------------------------------------
// Setup
// --------------------------------------------------------------------------

export function createGame({ theatreKey = 'marches', seed = randomSeedWord(), difficulty = 'marshal' } = {}) {
  const theatre = THEATRES[theatreKey] ?? THEATRES.marches;
  const map = generateMap(theatre, seed);
  const [westCastle, eastCastle] = map.castles;

  const state = {
    theatre,
    map,
    seed,
    difficulty: DIFFICULTIES[difficulty] ?? DIFFICULTIES.marshal,
    /** Combat rolls come from here so a match replays identically from its seed. */
    rng: makeRng(`${seed}:combat`),
    turn: 1,
    activeSide: PLAYER_SIDE,
    status: 'playing',
    outcome: null,
    stacks: new Map(),
    occupancy: new Map(),
    walls: new Map(),
    nextStackId: 1,
    log: [],
    sides: {
      [PLAYER_SIDE]: makeSide(PLAYER_SIDE, westCastle, false),
      [AI_SIDE]: makeSide(AI_SIDE, eastCastle, true),
    },
  };

  deployStartingForces(state, PLAYER_SIDE, eastCastle);
  deployStartingForces(state, AI_SIDE, westCastle);

  // The opening turn goes through the same path as every other one, so nothing
  // about turn 1 is a special case.
  beginTurn(state, PLAYER_SIDE);
  return state;
}

function makeSide(key, castle, isAI) {
  return {
    key,
    name: SIDE_COLOURS[key].name,
    colours: SIDE_COLOURS[key],
    isAI,
    castle,
    garrison: SIEGE.garrisonStart,
    wallRating: SIEGE.wallRatingStart,
    ap: 0,
    apIncome: 0,
    supplied: new Set(),
    wallsBuilt: 0,
  };
}

/**
 * Two columns each, deployed on the castle's own hex and beside it, facing the
 * enemy. Four of the eight available officers and 14,000 of a possible 48,000
 * troops — enough to fight with immediately, with most of the army still to be
 * raised out of AP income.
 */
function deployStartingForces(state, sideKey, enemyCastle) {
  const side = state.sides[sideKey];
  const facing = directionTowards(side.castle, enemyCastle);
  const spots = [side.castle, ...openNeighbours(state, side.castle)];

  for (let i = 0; i < 2 && i < spots.length; i += 1) {
    createStack(state, { side: sideKey, hex: spots[i], officers: 2, troops: 7000, facing });
  }
}

const openNeighbours = (state, hex) =>
  neighboursOf(hex).filter(
    (n) => TERRAIN[state.map.terrain[n]].passable && !state.occupancy.has(n) && !isCastleHex(state, n),
  );

// --------------------------------------------------------------------------
// Stacks
// --------------------------------------------------------------------------

export function createStack(state, { side, hex, officers, troops, facing = 0 }) {
  const stack = {
    id: state.nextStackId,
    side,
    hex,
    officers,
    troops,
    facing,
    mp: 0,
    attacked: false,
    supplied: true,
  };
  state.nextStackId += 1;
  state.stacks.set(stack.id, stack);
  state.occupancy.set(hex, stack.id);
  stack.mp = movementAllowance(stack);
  return stack;
}

export const stackAt = (state, hex) => {
  const id = state.occupancy.get(hex);
  return id === undefined ? null : state.stacks.get(id);
};

export const stacksOf = (state, sideKey) => [...state.stacks.values()].filter((s) => s.side === sideKey);

export const officerCount = (state, sideKey) =>
  stacksOf(state, sideKey).reduce((total, stack) => total + stack.officers, 0);

export const troopCount = (state, sideKey) =>
  stacksOf(state, sideKey).reduce((total, stack) => total + stack.troops, 0);

export const stackCapacity = (stack) => stack.officers * ARMY.maxTroopsPerOfficer;

/**
 * How far a stack can march this turn. Every 5,000 troops costs a movement
 * point, floored at two — so a 20,000-strong host covers 4 km of plains in a
 * turn where a 4,000-strong column covers 10 km. That gap is the entire
 * argument for detaching officers, and it is why splitting is worth an AP.
 */
export function movementAllowance(stack) {
  const penalty = Math.floor(stack.troops / MOVEMENT.troopsPerPenalty);
  return Math.max(MOVEMENT.minAllowance, MOVEMENT.baseAllowance - penalty);
}

export const isCastleHex = (state, hex) =>
  state.sides.crown.castle === hex || state.sides.marcher.castle === hex;

export const castleOwnerAt = (state, hex) => {
  if (state.sides.crown.castle === hex) return 'crown';
  if (state.sides.marcher.castle === hex) return 'marcher';
  return null;
};

// --------------------------------------------------------------------------
// Movement
// --------------------------------------------------------------------------

/**
 * Cost of entering a hex for `sideKey`. Impassable terrain, enemy stacks and
 * the enemy castle are all Infinity: you take those by attacking, not by
 * walking onto them.
 */
export function moveCostFor(state, sideKey) {
  return (hex) => {
    const terrain = TERRAIN[state.map.terrain[hex]];
    if (!terrain.passable) return Infinity;
    const occupant = stackAt(state, hex);
    if (occupant && occupant.side !== sideKey) return Infinity;
    const castleOwner = castleOwnerAt(state, hex);
    if (castleOwner && castleOwner !== sideKey) return Infinity;
    return terrain.move;
  };
}

/**
 * Where a stack can get to this turn.
 *
 * Two things make this more than a flood fill. Enemy walls block the step
 * across an edge, and stepping *into* a hex adjacent to an enemy ends the
 * march there — modelled by refusing to path onward out of any hex under enemy
 * control. That is what lets a screening force actually screen: it does not
 * have to beat the army coming at it, only stand where it has to be walked
 * past.
 */
export function reachableFrom(state, stack) {
  const zoc = zoneOfControl(state, otherSide(stack.side));
  return reachable(
    stack.hex,
    stack.mp,
    moveCostFor(state, stack.side),
    (from, to) =>
      wallBlocks(state, from, to, stack.side) || (from !== stack.hex && zoc.has(from)),
  );
}

/**
 * Destinations a stack may actually finish on: reachable, and either empty or a
 * friendly stack it can merge into. Callers that also want the path can pass in
 * a field they already have rather than paying for a second search.
 */
export function moveTargets(state, stack, field = reachableFrom(state, stack)) {
  const out = new Map();
  for (const [hex, entry] of field) {
    if (hex === stack.hex) continue;
    const occupant = stackAt(state, hex);
    if (occupant) {
      if (occupant.side !== stack.side) continue;
      if (!canMerge(occupant, stack)) continue;
      out.set(hex, { ...entry, merge: occupant.id });
      continue;
    }
    out.set(hex, entry);
  }
  return out;
}

/**
 * Friendly columns this one can reach and join this turn.
 *
 * Joining is a march like any other — moveStack already folds one column into
 * another when it arrives on it — so this is just the subset of destinations
 * that happen to be occupied by a friend with room.
 */
export function mergeTargets(state, stack) {
  const out = new Map();
  for (const [hex, entry] of moveTargets(state, stack)) {
    if (entry.merge !== undefined) out.set(hex, entry);
  }
  return out;
}

const canMerge = (into, from) =>
  into.officers + from.officers <= ARMY.maxOfficersPerStack &&
  into.troops + from.troops <= (into.officers + from.officers) * ARMY.maxTroopsPerOfficer;

export function moveStack(state, stackId, target) {
  const stack = state.stacks.get(stackId);
  if (!stack) return fail('No such column.');
  if (stack.side !== state.activeSide) return fail('It is not that side’s turn.');
  if (stack.mp <= 0) return fail('That column has no movement left this turn.');

  const field = reachableFrom(state, stack);
  const entry = moveTargets(state, stack, field).get(target);
  if (!entry) return fail('That column cannot reach there this turn.');

  const path = pathTo(field, target);
  const events = [];

  state.occupancy.delete(stack.hex);
  const previous = path.length > 1 ? path[path.length - 2] : stack.hex;
  stack.facing = directionTowards(previous, target);
  stack.hex = target;
  stack.mp -= entry.cost;

  if (entry.merge !== undefined) {
    const into = state.stacks.get(entry.merge);
    into.officers += stack.officers;
    into.troops += stack.troops;
    into.facing = stack.facing;
    // The combined force marches at the slower of the two, and never further
    // than the allowance its new size permits.
    into.mp = Math.min(into.mp, stack.mp, movementAllowance(into));
    state.stacks.delete(stack.id);
    state.occupancy.set(target, into.id);
    events.push({
      kind: 'merge',
      side: stack.side,
      hex: target,
      text: `Columns joined: ${into.officers} officers, ${into.troops.toLocaleString()} troops.`,
    });
  } else {
    state.occupancy.set(target, stack.id);
  }

  return succeed(state, events);
}

// --------------------------------------------------------------------------
// Raising and dividing forces
// --------------------------------------------------------------------------

export function spawnOfficer(state, sideKey) {
  const side = state.sides[sideKey];
  if (side.ap < AP.spawnOfficer) return fail(`Raising an officer costs ${AP.spawnOfficer} AP.`);
  if (officerCount(state, sideKey) >= ARMY.maxOfficersPerSide) {
    return fail(`You may not field more than ${ARMY.maxOfficersPerSide} officers.`);
  }

  // Prefer to muster into the castle garrison hex, then beside it. A castle
  // whose surroundings are entirely occupied cannot raise anyone.
  const existing = stackAt(state, side.castle);
  if (existing && existing.side === sideKey && existing.officers < ARMY.maxOfficersPerStack) {
    side.ap -= AP.spawnOfficer;
    existing.officers += 1;
    existing.mp = Math.min(existing.mp, movementAllowance(existing));
    return succeed(state, [
      { kind: 'officer', side: sideKey, hex: side.castle, text: 'An officer joined the column at the castle.' },
    ]);
  }

  const spot = !existing ? side.castle : openNeighbours(state, side.castle)[0];
  if (spot === undefined) return fail('There is no room at the castle to muster another officer.');

  side.ap -= AP.spawnOfficer;
  const enemyCastle = state.sides[otherSide(sideKey)].castle;
  createStack(state, {
    side: sideKey,
    hex: spot,
    officers: 1,
    troops: 0,
    facing: directionTowards(spot, enemyCastle),
  });
  return succeed(state, [
    { kind: 'officer', side: sideKey, hex: spot, text: 'An officer mustered at the castle, awaiting troops.' },
  ]);
}

export function recruitCapacity(state, stack) {
  return Math.max(0, stackCapacity(stack) - stack.troops);
}

export function recruit(state, stackId, troops) {
  const stack = state.stacks.get(stackId);
  if (!stack) return fail('No such column.');
  const side = state.sides[stack.side];
  if (stack.hex !== side.castle) return fail('Troops can only be raised at your own castle.');
  if (!side.supplied.has(side.castle)) return fail('Your castle is cut off — no levies can reach it.');

  const wanted = Math.round(troops / ARMY.recruitStep) * ARMY.recruitStep;
  const room = recruitCapacity(state, stack);
  if (wanted <= 0) return fail('Nothing to raise.');
  if (wanted > room) {
    return fail(
      `That column can hold ${room.toLocaleString()} more — one officer leads at most ${ARMY.maxTroopsPerOfficer.toLocaleString()}.`,
    );
  }

  const cost = (wanted / 1000) * AP.recruitPerThousand;
  if (side.ap < cost) return fail(`That levy costs ${cost} AP.`);

  side.ap -= cost;
  stack.troops += wanted;
  stack.mp = Math.min(stack.mp, movementAllowance(stack));
  return succeed(state, [
    {
      kind: 'recruit',
      side: stack.side,
      hex: stack.hex,
      text: `${wanted.toLocaleString()} troops raised at the castle.`,
    },
  ]);
}

/**
 * Detach part of a column onto an adjacent hex.
 *
 * The detachment gets a full movement allowance rather than the parent's
 * remainder, which is what makes splitting worth doing on the turn you need the
 * speed: 14,000 troops under two officers move three hexes, but split into two
 * columns of 7,000 they move four each, in different directions.
 */
export function splitStack(state, stackId, { officers, troops, target }) {
  const stack = state.stacks.get(stackId);
  if (!stack) return fail('No such column.');
  if (stack.side !== state.activeSide) return fail('It is not that side’s turn.');

  const side = state.sides[stack.side];
  if (side.ap < AP.split) return fail(`Dividing a column costs ${AP.split} AP.`);
  if (stack.officers < 2) return fail('A column needs at least two officers to divide.');
  if (officers < 1 || officers >= stack.officers) return fail('Each column must keep at least one officer.');
  if (troops < 0 || troops > stack.troops) return fail('That is more troops than the column has.');

  const detachedCapacity = officers * ARMY.maxTroopsPerOfficer;
  const remainingCapacity = (stack.officers - officers) * ARMY.maxTroopsPerOfficer;
  if (troops > detachedCapacity) return fail('The detachment has too few officers for that many troops.');
  if (stack.troops - troops > remainingCapacity) {
    return fail('The remaining column would have too few officers for its troops.');
  }

  if (!neighboursOf(stack.hex).includes(target)) return fail('A detachment must form on an adjacent hex.');
  if (!TERRAIN[state.map.terrain[target]].passable) return fail('A detachment cannot form on impassable ground.');
  if (state.occupancy.has(target)) return fail('That hex is already occupied.');
  if (isCastleHex(state, target) && castleOwnerAt(state, target) !== stack.side) {
    return fail('A detachment cannot form on an enemy castle.');
  }
  if (wallBlocks(state, stack.hex, target, stack.side)) return fail('A wall stands in the way.');

  side.ap -= AP.split;
  stack.officers -= officers;
  stack.troops -= troops;
  stack.mp = Math.min(stack.mp, movementAllowance(stack));

  const detached = createStack(state, {
    side: stack.side,
    hex: target,
    officers,
    troops,
    facing: directionTowards(stack.hex, target),
  });

  return succeed(state, [
    {
      kind: 'split',
      side: stack.side,
      hex: target,
      text: `Column divided: ${officers} officer${officers === 1 ? '' : 's'} with ${troops.toLocaleString()} troops detached.`,
      stackId: detached.id,
    },
  ]);
}

// --------------------------------------------------------------------------
// Fighting
// --------------------------------------------------------------------------

/**
 * The exchange. Both sides remove a share of the other proportional to the
 * other's effective strength, and that is the whole of it — you can work out
 * the likely result in your head before committing, which is the point of a
 * game about deciding *whether* to attack.
 */
function exchange(state, attackerTroops, defenderTroops, defenceMultiplier) {
  const roll = () => 1 + (state.rng() * 2 - 1) * COMBAT.variance;
  const effectiveAttack = attackerTroops * COMBAT.attackerBonus * roll();
  const effectiveDefence = defenderTroops * defenceMultiplier * roll();
  return {
    attackerLosses: Math.min(attackerTroops, Math.round(effectiveDefence * COMBAT.exchange)),
    defenderLosses: Math.min(defenderTroops, Math.round(effectiveAttack * COMBAT.exchange)),
  };
}

/**
 * What an attack is expected to cost and achieve, without the random band.
 * The UI shows this before you commit and the AI ranks targets with it — both
 * from the same function, so what you are shown is what the AI believes too.
 */
export function forecastAttack(state, stack, targetHex) {
  const defender = stackAt(state, targetHex);
  const castleOwner = castleOwnerAt(state, targetHex);

  if (castleOwner && castleOwner !== stack.side) {
    const side = state.sides[castleOwner];
    return preview(stack.troops, side.garrison, side.wallRating, 'castle');
  }
  if (!defender || defender.side === stack.side) return null;
  return preview(stack.troops, defender.troops, TERRAIN[state.map.terrain[targetHex]].defense, 'field');
}

function preview(attackerTroops, defenderTroops, defenceMultiplier, kind) {
  const effectiveAttack = attackerTroops * COMBAT.attackerBonus;
  const effectiveDefence = defenderTroops * defenceMultiplier;
  return {
    kind,
    defenceMultiplier,
    attackerLosses: Math.min(attackerTroops, Math.round(effectiveDefence * COMBAT.exchange)),
    defenderLosses: Math.min(defenderTroops, Math.round(effectiveAttack * COMBAT.exchange)),
    /** Above 1 the attacker comes out ahead on the exchange. */
    ratio: effectiveDefence === 0 ? Infinity : effectiveAttack / effectiveDefence,
  };
}

export function attack(state, stackId, targetHex) {
  const stack = state.stacks.get(stackId);
  if (!stack) return fail('No such column.');
  if (stack.side !== state.activeSide) return fail('It is not that side’s turn.');
  if (stack.attacked) return fail('That column has already fought this turn.');
  if (stack.troops <= 0) return fail('An officer with no troops cannot attack.');
  if (!neighboursOf(stack.hex).includes(targetHex)) return fail('You can only attack an adjacent hex.');
  if (wallBlocks(state, stack.hex, targetHex, stack.side)) {
    return fail('A wall stands in the way — breach it first.');
  }

  const castleOwner = castleOwnerAt(state, targetHex);
  if (castleOwner && castleOwner !== stack.side) return assaultCastle(state, stackId);

  const defender = stackAt(state, targetHex);
  if (!defender || defender.side === stack.side) return fail('There is nothing there to attack.');

  const side = state.sides[stack.side];
  if (side.ap < AP.attack) return fail(`An attack costs ${AP.attack} AP.`);

  side.ap -= AP.attack;
  stack.attacked = true;
  stack.mp = 0;
  stack.facing = directionTowards(stack.hex, targetHex);

  const terrain = TERRAIN[state.map.terrain[targetHex]];
  const result = exchange(state, stack.troops, defender.troops, terrain.defense);
  stack.troops -= result.attackerLosses;
  defender.troops -= result.defenderLosses;

  const events = [
    {
      kind: 'battle',
      side: stack.side,
      hex: targetHex,
      text:
        `Battle on ${terrain.label.toLowerCase()}: attacker lost ${result.attackerLosses.toLocaleString()}, ` +
        `defender lost ${result.defenderLosses.toLocaleString()}.`,
      result,
    },
  ];

  if (defender.troops <= 0) {
    events.push({
      kind: 'destroyed',
      side: defender.side,
      hex: targetHex,
      text: `A column of ${defender.officers} officer${defender.officers === 1 ? '' : 's'} was broken and its officers taken.`,
    });
    removeStack(state, defender.id);

    // The ground is taken, not merely cleared — an attacker that wins and
    // survives occupies the hex.
    if (stack.troops > 0) {
      state.occupancy.delete(stack.hex);
      stack.hex = targetHex;
      state.occupancy.set(targetHex, stack.id);
    }
  }

  if (stack.troops <= 0) {
    events.push({
      kind: 'destroyed',
      side: stack.side,
      hex: stack.hex,
      text: 'The attacking column was destroyed in the assault.',
    });
    removeStack(state, stack.id);
  }

  return succeed(state, events);
}

/**
 * Storming a castle. The garrison fights at its wall rating, which is why a
 * fresh castle cannot be taken by force: 12,000 defenders behind walls rated
 * 1.8 are worth 21,600, and no single column may exceed 24,000. Each assault
 * knocks a fraction off the walls, so repeated storming does eventually work —
 * it just costs far more than starving the place first.
 */
export function assaultCastle(state, stackId) {
  const stack = state.stacks.get(stackId);
  if (!stack) return fail('No such column.');
  if (stack.attacked) return fail('That column has already fought this turn.');

  const defenderKey = otherSide(stack.side);
  const defending = state.sides[defenderKey];
  if (!neighboursOf(stack.hex).includes(defending.castle)) return fail('You are not at the castle walls.');
  if (wallBlocks(state, stack.hex, defending.castle, stack.side)) return fail('A wall stands in the way.');

  const side = state.sides[stack.side];
  if (side.ap < AP.assault) return fail(`Storming the castle costs ${AP.assault} AP.`);
  if (stack.troops <= 0) return fail('An officer with no troops cannot storm a castle.');

  side.ap -= AP.assault;
  stack.attacked = true;
  stack.mp = 0;
  stack.facing = directionTowards(stack.hex, defending.castle);

  if (defending.garrison <= 0) {
    state.occupancy.delete(stack.hex);
    stack.hex = defending.castle;
    state.occupancy.set(defending.castle, stack.id);
    return finish(state, stack.side, `${side.name} stormed the empty walls and took the castle.`);
  }

  const result = exchange(state, stack.troops, defending.garrison, defending.wallRating);
  stack.troops -= result.attackerLosses;
  defending.garrison = Math.max(0, defending.garrison - result.defenderLosses);
  defending.wallRating = Math.max(SIEGE.wallRatingMin, defending.wallRating * (1 - SIEGE.assaultWallDamage));

  const events = [
    {
      kind: 'assault',
      side: stack.side,
      hex: defending.castle,
      text:
        `Assault on the castle: ${result.attackerLosses.toLocaleString()} lost storming, ` +
        `${result.defenderLosses.toLocaleString()} of the garrison cut down. Walls now rated ${defending.wallRating.toFixed(2)}.`,
      result,
    },
  ];

  if (stack.troops <= 0) {
    events.push({ kind: 'destroyed', side: stack.side, hex: stack.hex, text: 'The storming column was wiped out.' });
    removeStack(state, stack.id);
  }

  return succeed(state, events);
}

// --------------------------------------------------------------------------
// Walls
// --------------------------------------------------------------------------

/** Edges a side may wall this turn: between a hex it holds and an adjacent one. */
export function wallTargets(state, sideKey) {
  const side = state.sides[sideKey];
  if (side.wallsBuilt >= WALLS.maxSegmentsPerSide) return [];

  const held = stacksOf(state, sideKey).map((s) => s.hex);
  held.push(side.castle);

  const out = [];
  for (const from of held) {
    for (const to of neighboursOf(from)) {
      const key = edgeKey(from, to);
      if (state.walls.has(key)) continue;
      if (!TERRAIN[state.map.terrain[to]].passable) continue;
      if (!TERRAIN[state.map.terrain[from]].passable) continue;
      out.push({ key, from, to });
    }
  }
  return out;
}

export function buildWall(state, sideKey, from, to) {
  const side = state.sides[sideKey];
  if (sideKey !== state.activeSide) return fail('It is not that side’s turn.');
  if (side.ap < AP.buildWall) return fail(`A wall costs ${AP.buildWall} AP.`);
  if (side.wallsBuilt >= WALLS.maxSegmentsPerSide) {
    return fail(`You may not hold more than ${WALLS.maxSegmentsPerSide} wall segments.`);
  }

  const legal = wallTargets(state, sideKey).some((entry) => entry.key === edgeKey(from, to));
  if (!legal) return fail('You can only wall an edge of a hex you hold.');

  side.ap -= AP.buildWall;
  side.wallsBuilt += 1;
  state.walls.set(edgeKey(from, to), { side: sideKey, integrity: WALLS.integrity, from, to });

  return succeed(state, [
    { kind: 'wall', side: sideKey, hex: from, text: 'A wall was raised across the line.' },
  ]);
}

/**
 * Knocking a hole in a wall. Integrity 2 means it takes two turns of work to
 * open a line, which is the point: a wall does not stop an army, it costs the
 * army the time you needed.
 */
export function breachWall(state, stackId, throughHex) {
  const stack = state.stacks.get(stackId);
  if (!stack) return fail('No such column.');
  if (stack.side !== state.activeSide) return fail('It is not that side’s turn.');
  if (stack.attacked) return fail('That column has already fought this turn.');
  if (stack.troops <= 0) return fail('An officer with no troops cannot breach a wall.');
  if (!neighboursOf(stack.hex).includes(throughHex)) return fail('That wall is not adjacent.');

  const key = edgeKey(stack.hex, throughHex);
  const wall = state.walls.get(key);
  if (!wall) return fail('There is no wall there.');
  if (wall.side === stack.side) return fail('That is your own wall.');

  const side = state.sides[stack.side];
  if (side.ap < AP.breachWall) return fail(`Breaching costs ${AP.breachWall} AP.`);

  side.ap -= AP.breachWall;
  stack.attacked = true;
  stack.mp = 0;
  wall.integrity -= 1;

  if (wall.integrity > 0) {
    return succeed(state, [
      { kind: 'breach', side: stack.side, hex: stack.hex, text: 'The wall is damaged but still holds.' },
    ]);
  }

  state.walls.delete(key);
  state.sides[wall.side].wallsBuilt = Math.max(0, state.sides[wall.side].wallsBuilt - 1);
  return succeed(state, [
    { kind: 'breach', side: stack.side, hex: stack.hex, text: 'The wall is breached — the line is open.' },
  ]);
}

// --------------------------------------------------------------------------
// Turn structure
// --------------------------------------------------------------------------

/**
 * Everything that happens to a side at the start of its turn, in the order it
 * has to happen: work out what is still supplied, pay AP for it, starve
 * whatever is cut off, then resolve the siege of its castle.
 */
export function beginTurn(state, sideKey) {
  const side = state.sides[sideKey];
  const events = [];

  side.supplied = computeSupply(state, sideKey);
  const multiplier = side.isAI ? state.difficulty.apMultiplier : 1;
  side.apIncome = apIncome(side.supplied.size, multiplier);
  // AP does not carry over. A turn's income is a turn's worth of decisions, and
  // hoarding would only ever produce one enormous unanswerable turn.
  side.ap = side.apIncome;

  for (const stack of stacksOf(state, sideKey)) {
    stack.mp = movementAllowance(stack);
    stack.attacked = false;
  }

  events.push(...applySupplyEffects(state, sideKey, side.supplied));
  events.push(...resolveSiege(state, sideKey));

  logAll(state, sideKey, events);
  checkVictory(state);
  return events;
}

/**
 * The siege clock. Every ring hex an enemy holds starves the garrison; holding
 * all six doubles the rate. Left alone, the garrison recovers — so a siege that
 * is not maintained achieves nothing, and a besieger who is driven off the ring
 * for two turns has to start again.
 */
function resolveSiege(state, sideKey) {
  const side = state.sides[sideKey];
  const enemyKey = otherSide(sideKey);
  const ring = neighboursOf(side.castle);
  const besieged = ring.filter((hex) => {
    const occupant = stackAt(state, hex);
    return occupant && occupant.side === enemyKey && occupant.troops > 0;
  });

  if (besieged.length === 0) {
    if (side.garrison >= SIEGE.garrisonMax) return [];
    const recovered = Math.min(SIEGE.regenPerTurn, SIEGE.garrisonMax - side.garrison);
    side.garrison += recovered;
    return recovered > 0
      ? [
          {
            kind: 'garrison',
            side: sideKey,
            hex: side.castle,
            text: `The castle is unbesieged — the garrison recovered ${recovered.toLocaleString()}.`,
          },
        ]
      : [];
  }

  const fullRing = besieged.length === ring.length;
  const held = besieged.length;
  const drain = Math.round(held * SIEGE.drainPerRingHex * (1 + SIEGE.encirclementBonus * (held - 1)));
  side.garrison = Math.max(0, side.garrison - drain);

  return [
    {
      kind: 'siege',
      side: sideKey,
      hex: side.castle,
      text: fullRing
        ? `The castle is fully encircled — ${drain.toLocaleString()} of the garrison starved. ${side.garrison.toLocaleString()} remain.`
        : `Under siege on ${besieged.length} of 6 sides — ${drain.toLocaleString()} of the garrison starved. ${side.garrison.toLocaleString()} remain.`,
      besieged: besieged.length,
    },
  ];
}

export function endTurn(state) {
  if (state.status !== 'playing') return succeed(state, []);

  const next = otherSide(state.activeSide);
  if (next === PLAYER_SIDE) state.turn += 1;
  state.activeSide = next;

  if (state.turn > MATCH.turnLimit) return decideOnPoints(state);
  return succeed(state, beginTurn(state, next));
}

// --------------------------------------------------------------------------
// Victory
// --------------------------------------------------------------------------

function checkVictory(state) {
  if (state.status !== 'playing') return;
  for (const key of [PLAYER_SIDE, AI_SIDE]) {
    const holder = stackAt(state, state.sides[key].castle);
    if (holder && holder.side !== key) {
      finish(state, holder.side, `${state.sides[holder.side].name} hold the castle. The campaign is over.`);
      return;
    }
  }
}

/**
 * Points, if the turn limit runs out. Weighted so that a besieger who has all
 * but taken the castle wins the decision — a timed draw that ignored the state
 * of the garrison would reward turtling.
 */
function decideOnPoints(state) {
  const score = (key) => {
    const side = state.sides[key];
    const enemy = state.sides[otherSide(key)];
    return (
      side.supplied.size * 40 +
      troopCount(state, key) +
      side.garrison * 1.5 +
      (SIEGE.garrisonStart - enemy.garrison) * 2
    );
  };

  const crown = score(PLAYER_SIDE);
  const marcher = score(AI_SIDE);
  if (Math.abs(crown - marcher) < 500) {
    state.status = 'draw';
    state.outcome = {
      winner: null,
      reason: 'points',
      text: 'The campaign season ended with neither side able to force a decision.',
    };
  } else {
    const winner = crown > marcher ? PLAYER_SIDE : AI_SIDE;
    state.status = `${winner}-wins`;
    state.outcome = {
      winner,
      reason: 'points',
      text: `The campaign season ended. ${state.sides[winner].name} hold the stronger position and the war is called in their favour.`,
    };
  }
  logAll(state, state.activeSide, [{ kind: 'end', side: null, hex: null, text: state.outcome.text }]);
  return succeed(state, []);
}

function finish(state, winner, text) {
  state.status = `${winner}-wins`;
  state.outcome = { winner, reason: 'capture', text };
  logAll(state, winner, [{ kind: 'end', side: winner, hex: null, text }]);
  return succeed(state, [{ kind: 'end', side: winner, hex: null, text }]);
}

// --------------------------------------------------------------------------
// Plumbing
// --------------------------------------------------------------------------

const fail = (reason) => ({ ok: false, reason, events: [] });

function succeed(state, events) {
  logAll(state, state.activeSide, events);
  checkVictory(state);
  return { ok: true, events };
}

function logAll(state, sideKey, events) {
  for (const event of events) {
    if (!event.text) continue;
    // succeed() and beginTurn() both log, and beginTurn's events pass through
    // succeed on the endTurn path; the flag keeps each line out of the log twice.
    if (event.logged) continue;
    event.logged = true;
    state.log.push({ turn: state.turn, side: event.side ?? sideKey, kind: event.kind, text: event.text });
  }
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
}

/** A compact snapshot for the HUD, so the UI never walks the stack map itself. */
export function summarise(state, sideKey) {
  const side = state.sides[sideKey];
  const stacks = stacksOf(state, sideKey);
  return {
    ap: side.ap,
    apIncome: side.apIncome,
    officers: stacks.reduce((n, s) => n + s.officers, 0),
    officerCap: ARMY.maxOfficersPerSide,
    troops: stacks.reduce((n, s) => n + s.troops, 0),
    columns: stacks.length,
    supplied: side.supplied.size,
    garrison: side.garrison,
    wallRating: side.wallRating,
    walls: side.wallsBuilt,
    wallCap: WALLS.maxSegmentsPerSide,
    cutOff: stacks.filter((s) => !s.supplied).length,
  };
}

export { otherSide, distance };
