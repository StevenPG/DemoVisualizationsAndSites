/**
 * The Marcher Lords.
 *
 * The AI plays the same game you do through the same functions — it has no
 * private information, no extra actions, and on Marshal no extra income. What
 * it has instead is the willingness to actually evaluate the thing the game is
 * about: it scores candidate destinations by *recomputing your supply as if it
 * had already moved there*, so it will find the two-hex gap that severs your
 * army from your castle without being told where the roads are.
 *
 * A turn runs in four phases, in this order for a reason:
 *
 *   1. Raise    — spend on officers and levies, holding back AP for fighting.
 *   2. Manoeuvre— move every column that is ready to march.
 *   3. Attack   — take the fights that moving has just made available.
 *   4. Fortify  — spend whatever is left on a wall, if a wall would cut you off.
 */

import { AP, ARMY, SIEGE, TERRAIN, WALLS } from './config.js';
import { costField, distance, neighboursOf } from './hex.js';
import {
  AI_SIDE,
  assaultCastle,
  attack,
  breachWall,
  buildWall,
  forecastAttack,
  moveCostFor,
  moveStack,
  moveTargets,
  recruit,
  recruitCapacity,
  spawnOfficer,
  stackAt,
  stackCapacity,
  stacksOf,
  troopCount,
  wallTargets,
} from './model.js';
import { computeSupply, otherSide, wallBlocks } from './supply.js';

/**
 * The opponent's turn, one action at a time.
 *
 * A generator rather than a function that just does everything, because a turn
 * that resolves in a single frame reads as the board teleporting: five columns
 * move, three battles happen, and all the player sees is the after state.
 * Yielding each action lets the interface play them out at a human pace and
 * point the camera at each one, so you can watch what was done to you and why.
 *
 * Each step carries the hex worth looking at and how long it deserves — a levy
 * raised at the castle is not worth the same pause as an assault.
 */
export function* aiTurnSteps(state, sideKey = AI_SIDE) {
  if (state.status !== 'playing' || state.activeSide !== sideKey) return;

  const plan = assess(state, sideKey);
  yield* raiseForces(state, plan);
  yield* manoeuvre(state, plan);
  yield* prosecuteAttacks(state, plan);
  yield* fortify(state, plan);
}

/** Runs a whole turn at once. Used by the headless harness, and when the player turns playback off. */
export function takeAiTurn(state, sideKey = AI_SIDE) {
  const events = [];
  for (const step of aiTurnSteps(state, sideKey)) events.push(...step.events);
  return events;
}

// --------------------------------------------------------------------------
// Assessment
// --------------------------------------------------------------------------

/**
 * One pass over the board producing everything the phases need, so each phase
 * is a decision rather than another survey. The two cost fields are the
 * expensive part and they are computed exactly once per turn.
 */
function assess(state, sideKey) {
  const enemyKey = otherSide(sideKey);
  const me = state.sides[sideKey];
  const enemy = state.sides[enemyKey];
  const aggression = state.difficulty.aggression;

  const cost = moveCostFor(state, sideKey);
  const blocked = (from, to) => wallBlocks(state, from, to, sideKey);

  const targetRing = neighboursOf(enemy.castle).filter((hex) => TERRAIN[state.map.terrain[hex]].passable);
  const heldRing = targetRing.filter((hex) => {
    const occupant = stackAt(state, hex);
    return occupant?.side === sideKey && occupant.troops > 0;
  });

  const threats = stacksOf(state, enemyKey).filter(
    (s) => s.troops > 0 && distance(s.hex, me.castle) <= 3,
  );
  const myRingUnderThreat = neighboursOf(me.castle).filter((hex) => {
    const occupant = stackAt(state, hex);
    return occupant?.side === enemyKey && occupant.troops > 0;
  });

  const enemySupplied = computeSupply(state, enemyKey);

  return {
    sideKey,
    enemyKey,
    me,
    enemy,
    aggression,
    /** Steps to the enemy castle from anywhere, over terrain the AI can actually cross. */
    toEnemyCastle: costField([enemy.castle], cost, blocked),
    toOwnCastle: costField([me.castle], cost, blocked),
    /** Ring hexes still to be taken, nearest first once a stack is chosen. */
    targetRing,
    ringWanted: targetRing.filter((hex) => {
      const occupant = stackAt(state, hex);
      return !occupant || occupant.side !== sideKey;
    }),
    heldRingCount: heldRing.length,
    threats,
    defending: myRingUnderThreat.length > 0 || threats.length > 0,
    /**
     * The enemy's supply as it stands, kept whole rather than counted. A hex
     * outside it cannot possibly sever anything by being occupied, which lets
     * the manoeuvre phase skip the expensive check for most candidates.
     */
    enemySupplied,
    enemySupplyBefore: enemySupplied.size,
    /** Reserve for fighting, so the whole budget is not spent on levies. */
    attackReserve:
      threats.length || nearContact(state, sideKey, enemyKey)
        ? Math.round(me.ap * (0.35 + 0.25 * aggression))
        : 0,
  };
}

/** True when either side is close enough that fighting is likely this turn. */
function nearContact(state, sideKey, enemyKey) {
  const mine = stacksOf(state, sideKey);
  const theirs = stacksOf(state, enemyKey);
  return mine.some((a) => theirs.some((b) => distance(a.hex, b.hex) <= 4));
}

// --------------------------------------------------------------------------
// Phase 1 — raising forces
// --------------------------------------------------------------------------

function* raiseForces(state, plan) {
  const me = plan.me;
  const spendable = () => me.ap - plan.attackReserve;

  // An officer with no troops is a wasted four AP, so raise one only when the
  // levies to fill him can be afforded too.
  const mustering = stackAt(state, me.castle);
  const canFill = (ARMY.maxTroopsPerOfficer / 1000) * AP.recruitPerThousand;

  if (
    (!mustering || (mustering.side === plan.sideKey && mustering.officers < ARMY.maxOfficersPerStack)) &&
    spendable() >= AP.spawnOfficer + Math.min(canFill, 3)
  ) {
    const result = spawnOfficer(state, plan.sideKey);
    if (result.ok) yield { events: result.events, focus: me.castle, pace: 'muster' };
  }

  const atCastle = stackAt(state, me.castle);
  if (atCastle?.side === plan.sideKey) {
    const room = recruitCapacity(state, atCastle);
    const affordable = Math.floor(spendable() / AP.recruitPerThousand) * 1000;
    const wanted = Math.min(room, affordable);
    if (wanted >= ARMY.recruitStep) {
      const result = recruit(state, atCastle.id, wanted);
      if (result.ok) yield { events: result.events, focus: me.castle, pace: 'muster' };
    }
  }
}

// --------------------------------------------------------------------------
// Phase 2 — manoeuvre
// --------------------------------------------------------------------------

function* manoeuvre(state, plan) {
  // Biggest columns move first: they are the slowest and the most constrained,
  // and letting a light detachment take the hex a host needed is how an AI ends
  // up shuffling in place.
  const marching = stacksOf(state, plan.sideKey)
    .filter((stack) => readyToMarch(state, plan, stack))
    .sort((a, b) => b.troops - a.troops);

  const defenders = assignDefenders(state, plan, marching);

  for (const stack of marching) {
    const role = defenders.has(stack.id) ? 'defend' : 'besiege';
    const destination = chooseDestination(state, plan, stack, role);
    if (destination === null || destination === stack.hex) continue;
    const from = stack.hex;
    const result = moveStack(state, stack.id, destination);
    if (result.ok) yield { events: result.events, focus: destination, from, pace: 'march' };
  }
}

/**
 * Which columns turn round and go home.
 *
 * Roles exist because summing "advance on them" and "defend us" into one score
 * makes the two pull against each other on every hex, and the advance term —
 * which has the whole width of the board to work with — always wins. Splitting
 * them means a column is either marching on the enemy castle or defending its
 * own, and is scored against that objective alone.
 *
 * The columns sent home are the ones already nearest to it, so the siege on the
 * far side of the board is not abandoned to answer a raid.
 */
function assignDefenders(state, plan, marching) {
  if (!plan.defending) return new Set();
  const wanted = Math.min(3, plan.threats.length + 1);
  return new Set(
    marching
      .slice()
      .sort((a, b) => (plan.toOwnCastle.get(a.hex) ?? 99) - (plan.toOwnCastle.get(b.hex) ?? 99))
      .slice(0, wanted)
      .map((stack) => stack.id),
  );
}

/**
 * A column sitting on the castle is still mustering. Marching it out at 1,000
 * troops feeds it to the enemy piecemeal, so it waits until it is worth
 * something — unless the castle itself is under threat, when everything fights.
 */
function readyToMarch(state, plan, stack) {
  if (stack.troops <= 0) return false;
  if (stack.mp <= 0) return false;
  if (stack.hex !== plan.me.castle) return true;
  if (plan.defending) return true;
  return stack.troops >= Math.min(stackCapacity(stack), ARMY.maxTroopsPerOfficer);
}

function chooseDestination(state, plan, stack, role) {
  const options = moveTargets(state, stack);
  if (!options.size) return null;

  const candidates = [...options.keys()].map((hex) => ({
    hex,
    score: cheapScore(state, plan, stack, hex, role),
  }));
  candidates.sort((a, b) => b.score - a.score);

  // Recomputing the enemy's supply is the expensive part, so it is asked twice
  // over: only the top candidates get it at all, and among those only the ones
  // standing on ground the enemy currently supplies — nowhere else can sever
  // anything by definition, so the check would always come back zero.
  const shortlist = candidates.slice(0, 12);
  for (const candidate of shortlist) {
    if (!plan.enemySupplied.has(candidate.hex)) continue;
    candidate.score += severanceBonus(state, plan, stack, candidate.hex);
  }
  shortlist.sort((a, b) => b.score - a.score);

  const staying = cheapScore(state, plan, stack, stack.hex, role);
  return shortlist[0].score > staying ? shortlist[0].hex : null;
}

/**
 * Positional value of a hex, before the supply calculation. The weights encode
 * the AI's whole strategy: get onto the enemy's castle ring, defend your own
 * when it is threatened, take good ground, and otherwise close the distance.
 */
function cheapScore(state, plan, stack, hex, role) {
  const terrain = TERRAIN[state.map.terrain[hex]];
  let score = 0;

  /**
   * Progress towards this column's objective, and by a wide margin the biggest
   * term in the score.
   *
   * It has to be. The cost field spans about sixty movement points end to end,
   * so at a weight of six the whole width of the board was worth less than one
   * good defensive hex — and two AI armies would build to their officer cap and
   * then sit fourteen hexes apart for twenty-five turns, each perfectly happy
   * with the ground it was standing on. At forty-five the pull towards the
   * objective dominates, and terrain, odds and severance become what they
   * should be: reasons to prefer one route over another, not reasons to stop.
   */
  const field = role === 'defend' ? plan.toOwnCastle : plan.toEnemyCastle;
  score -= (field.get(hex) ?? 70) * 45;

  if (role === 'defend') {
    // Get in the way of what is coming, rather than merely standing near home.
    for (const threat of plan.threats) {
      if (distance(hex, threat.hex) === 1) score += 420;
    }
  } else {
    // The ring is the objective, weighted heavily enough that a column will walk
    // past a tempting fight to take an open siege position.
    //
    // A ring hex this column is already standing on has to score as highly as an
    // empty one, or a besieger rates its own position below the next gap along
    // and steps off the siege it is maintaining — which turns the ring into
    // musical chairs and means the garrison is never actually starved.
    if (plan.targetRing.includes(hex)) {
      const occupant = stackAt(state, hex);
      const heldByAnother = occupant && occupant.side === plan.sideKey && occupant.id !== stack.id;
      score += heldByAnother ? 200 : 900;
    }
  }

  // Ground worth standing on, and ground worth not being caught on.
  score += (terrain.defense - 1) * 220;
  if (terrain.key === 'ford') score -= 60;

  // A fight it would win, adjacent and ready for next phase.
  for (const neighbour of neighboursOf(hex)) {
    const enemy = stackAt(state, neighbour);
    if (!enemy || enemy.side === plan.sideKey || enemy.troops <= 0) continue;
    const odds = (stack.troops * 1.15) / (enemy.troops * TERRAIN[state.map.terrain[neighbour]].defense || 1);
    score += odds > 1.1 ? 180 * plan.aggression : -140 * (1 - plan.aggression);
  }

  return score;
}

/**
 * How much of the enemy's supply this move would cut.
 *
 * This is the move that makes the AI feel like it is playing the same game as
 * you: it puts the column on the hex, asks how much territory the enemy can
 * still trace back to their castle, and puts it back. Thirty hexes severed is
 * an AP a turn taken off them and an army starting to starve, so it is worth
 * roughly as much as a siege position.
 */
function severanceBonus(state, plan, stack, hex) {
  if (stack.troops <= 0) return 0;

  const from = stack.hex;
  const displaced = state.occupancy.get(hex);
  state.occupancy.delete(from);
  state.occupancy.set(hex, stack.id);
  stack.hex = hex;

  const after = computeSupply(state, plan.enemyKey).size;

  stack.hex = from;
  state.occupancy.delete(hex);
  if (displaced !== undefined) state.occupancy.set(hex, displaced);
  state.occupancy.set(from, stack.id);

  const severed = plan.enemySupplyBefore - after;
  return severed > 0 ? severed * 22 : 0;
}

// --------------------------------------------------------------------------
// Phase 3 — attacks
// --------------------------------------------------------------------------

function* prosecuteAttacks(state, plan) {
  for (const stack of stacksOf(state, plan.sideKey)) {
    if (stack.attacked || stack.troops <= 0) continue;
    if (state.sides[plan.sideKey].ap < AP.attack) break;

    const best = bestTargetFor(state, plan, stack);
    if (!best) continue;

    const result =
      best.kind === 'castle'
        ? assaultCastle(state, stack.id)
        : best.kind === 'wall'
          ? breachWall(state, stack.id, best.hex)
          : attack(state, stack.id, best.hex);
    if (result.ok) yield { events: result.events, focus: best.hex, pace: 'fight' };
  }
}

function bestTargetFor(state, plan, stack) {
  const options = [];

  for (const hex of neighboursOf(stack.hex)) {
    if (wallBlocks(state, stack.hex, hex, plan.sideKey)) {
      // A wall in the way is itself a target, but only when it is the thing
      // standing between this column and the castle it is meant to be besieging.
      const beyond = plan.toEnemyCastle.get(hex) ?? 99;
      const here = plan.toEnemyCastle.get(stack.hex) ?? 99;
      if (beyond < here && state.sides[plan.sideKey].ap >= AP.breachWall) {
        options.push({ kind: 'wall', hex, value: 240 });
      }
      continue;
    }

    const forecast = forecastAttack(state, stack, hex);
    if (!forecast) continue;

    if (forecast.kind === 'castle') {
      // Storming is for finishing, not for starting. Below these thresholds the
      // walls have been stripped or the garrison starved enough to be worth it.
      const garrison = state.sides[plan.enemyKey].garrison;
      // Every assault takes a permanent bite out of the wall rating whatever
      // else it achieves, so a side with troops to spare and a siege that has
      // stalled is right to spend them levelling the walls for the next column.
      const surplus =
        troopCount(state, plan.sideKey) > troopCount(state, plan.enemyKey) * 1.4 && stack.troops > 9000;
      const worthIt =
        garrison <= 0 ||
        (forecast.ratio > 1.05 && garrison < stack.troops) ||
        (garrison < SIEGE.garrisonStart * 0.35 && forecast.ratio > 0.85) ||
        (surplus && forecast.ratio > 0.55);
      if (worthIt && state.sides[plan.sideKey].ap >= AP.assault) {
        options.push({ kind: 'castle', hex, value: 2000 + forecast.ratio * 100 });
      }
      continue;
    }

    const defender = stackAt(state, hex);
    const destroys = forecast.defenderLosses >= defender.troops;
    // Cautious play needs better than even odds; aggressive play accepts a
    // fair exchange, because the attacker's bonus makes it profitable over time.
    const threshold = 1.32 - 0.34 * plan.aggression;
    if (!destroys && forecast.ratio < threshold) continue;
    // Never trade the column away for a lesser one.
    if (forecast.attackerLosses >= stack.troops) continue;

    options.push({
      kind: 'field',
      hex,
      value: forecast.defenderLosses - forecast.attackerLosses + (destroys ? 600 : 0),
    });
  }

  options.sort((a, b) => b.value - a.value);
  return options[0] ?? null;
}

// --------------------------------------------------------------------------
// Phase 4 — walls
// --------------------------------------------------------------------------

/**
 * A wall is only ever built to cut something. The AI checks what each legal
 * segment would do to the enemy's supply and builds the best one if it is worth
 * the three AP — which in practice means walling the last gap of an
 * encirclement, or closing a ford behind a raiding column.
 */
function* fortify(state, plan) {
  const me = state.sides[plan.sideKey];
  if (me.ap < AP.buildWall || me.wallsBuilt >= WALLS.maxSegmentsPerSide) return;

  const before = plan.enemySupplied.size;
  let best = null;

  // Same filter as the manoeuvre phase: a wall can only cut a line the enemy is
  // actually using, so edges that do not touch their supply are not worth
  // simulating.
  const worthTrying = wallTargets(state, plan.sideKey).filter(
    (option) => plan.enemySupplied.has(option.to) || plan.enemySupplied.has(option.from),
  );

  for (const option of worthTrying) {
    state.walls.set(option.key, { side: plan.sideKey, integrity: WALLS.integrity, from: option.from, to: option.to });
    const after = computeSupply(state, plan.enemyKey).size;
    state.walls.delete(option.key);

    const severed = before - after;
    if (severed > 0 && (!best || severed > best.severed)) best = { ...option, severed };
  }

  if (!best || best.severed < 6) return;

  const result = buildWall(state, plan.sideKey, best.from, best.to);
  if (result.ok) yield { events: result.events, focus: best.from, pace: 'march' };
}
