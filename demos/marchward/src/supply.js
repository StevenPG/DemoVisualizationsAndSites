/**
 * Supply, zones of control, and the AP income they produce.
 *
 * This is the module that makes encirclement mean something away from the
 * castle. Supply is flooded out from your castle every turn; it will not pass
 * through a hex your enemy stands on, through one of their walls, or through a
 * hex *next to* one of their stacks unless you have a stack there yourself.
 *
 * That last clause is the whole design. It means two officers with a light
 * escort, parked on a road, sever everything behind them — so detaching a fast
 * column is not merely a way to move quicker, it is an attack in its own right.
 * Cut armies desert; cut territory stops paying AP.
 */

import { AP, SUPPLY, TERRAIN } from './config.js';
import { MinHeap, neighboursOf, edgeKey } from './hex.js';

/**
 * Hexes adjacent to any stack belonging to `sideKey`. Castles deliberately do
 * not project one: a besieging army has to be able to sustain itself on the
 * ring, or no siege could ever be held long enough to matter.
 */
export function zoneOfControl(state, sideKey) {
  const zoc = new Set();
  for (const stack of state.stacks.values()) {
    if (stack.side !== sideKey) continue;
    // An officer riding alone controls nothing. Without this, four AP buys a
    // bare officer who severs a supply line he could not survive contact with.
    if (stack.troops <= 0) continue;
    for (const n of neighboursOf(stack.hex)) zoc.add(n);
  }
  return zoc;
}

/** True when a wall on the edge between `from` and `to` stops `sideKey` crossing it. */
export function wallBlocks(state, from, to, sideKey) {
  const wall = state.walls.get(edgeKey(from, to));
  // Your own walls have gates in them; only the other side has to go around.
  return Boolean(wall) && wall.side !== sideKey;
}

/**
 * How far supply can be pushed out from a castle, as a Dijkstra field of
 * movement cost. Enemy columns, enemy walls and enemy zones of control all stop
 * it; terrain merely slows it, which is what makes a river a real supply
 * boundary rather than a decoration.
 */
function supplyReach(state, sideKey) {
  const side = state.sides[sideKey];
  const enemyKey = otherSide(sideKey);
  const enemyZoc = zoneOfControl(state, enemyKey);
  const enemyCastle = state.sides[enemyKey].castle;

  const cost = new Map([[side.castle, 0]]);
  const frontier = new MinHeap();
  frontier.push(side.castle, 0);

  while (frontier.size) {
    const at = frontier.pop();
    if (at.cost > (cost.get(at.index) ?? Infinity)) continue;

    for (const next of neighboursOf(at.index)) {
      const terrain = TERRAIN[state.map.terrain[next]];
      if (!terrain.passable) continue;
      if (next === enemyCastle) continue;
      if (wallBlocks(state, at.index, next, sideKey)) continue;

      const occupant = state.occupancy.get(next);
      if (occupant !== undefined && state.stacks.get(occupant).side !== sideKey) continue;
      // A hex under enemy observation only carries supply if we hold it.
      if (enemyZoc.has(next) && occupant === undefined) continue;

      const total = at.cost + terrain.move;
      if (total >= (cost.get(next) ?? Infinity)) continue;
      cost.set(next, total);
      frontier.push(next, total);
    }
  }

  return cost;
}

/**
 * Every hex `sideKey` currently supplies.
 *
 * Reachability alone is not enough, and getting this wrong quietly broke the
 * economy: on an open board at turn one, *both* sides can walk to almost every
 * hex, so both were crediting themselves with the whole map, both sat at
 * maximum AP from turn five onwards, and the territory bonus — the thing the
 * whole supply system exists to produce — never varied by a single point.
 *
 * So territory is contested rather than merely reachable. A hex belongs to
 * whichever side can push supply to it more cheaply; equal cost means it
 * belongs to neither, which draws the front line exactly where it should be.
 * A hex you have a column standing on is always yours, or a besieging army
 * parked on the far side of the board would starve itself and no siege could
 * ever be maintained.
 */
export function computeSupply(state, sideKey) {
  const mine = supplyReach(state, sideKey);
  const theirs = supplyReach(state, otherSide(sideKey));

  const supplied = new Set();
  for (const [hex, cost] of mine) {
    const rival = theirs.get(hex);
    if (rival === undefined || cost < rival) supplied.add(hex);
  }

  for (const stack of state.stacks.values()) {
    if (stack.side === sideKey && mine.has(stack.hex)) supplied.add(stack.hex);
  }

  supplied.add(state.sides[sideKey].castle);
  return supplied;
}

/**
 * AP for the coming turn. Base income keeps a losing side in the game; the
 * territory bonus is what map control actually buys, and what a successful
 * encirclement takes away.
 */
export function apIncome(suppliedCount, multiplier = 1) {
  const raw = AP.baseIncome + Math.floor(suppliedCount / AP.hexesPerBonusAp);
  return Math.max(1, Math.round(Math.min(raw, AP.maxIncome) * multiplier));
}

/**
 * Refresh `supplied` on every stack of a side and apply desertion to the ones
 * that are cut off. Returns the events worth telling the player about.
 */
export function applySupplyEffects(state, sideKey, supplied) {
  const events = [];

  for (const stack of [...state.stacks.values()]) {
    if (stack.side !== sideKey) continue;

    const wasSupplied = stack.supplied;
    stack.supplied = supplied.has(stack.hex);
    if (stack.supplied) continue;

    const lost = Math.max(1, Math.round(stack.troops * SUPPLY.desertionRate));
    stack.troops = Math.max(0, stack.troops - lost);

    if (stack.troops < SUPPLY.disbandThreshold) {
      events.push({
        kind: 'disbanded',
        side: sideKey,
        hex: stack.hex,
        text: `A cut-off column of ${stack.officers} officer${stack.officers === 1 ? '' : 's'} disbanded for want of supply.`,
      });
      removeStack(state, stack.id);
      continue;
    }

    events.push({
      kind: 'desertion',
      side: sideKey,
      hex: stack.hex,
      text: `${lost.toLocaleString()} troops deserted a cut-off column${wasSupplied ? ' — its supply line has just been severed' : ''}.`,
    });
  }

  return events;
}

export const otherSide = (sideKey) => (sideKey === 'crown' ? 'marcher' : 'crown');

/** Kept here so supply effects can disband a stack without importing the model. */
export function removeStack(state, stackId) {
  const stack = state.stacks.get(stackId);
  if (!stack) return;
  if (state.occupancy.get(stack.hex) === stackId) state.occupancy.delete(stack.hex);
  state.stacks.delete(stackId);
}
