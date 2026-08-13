/**
 * What gets highlighted on the board, and why.
 *
 * Highlights re-tint the terrain rather than laying translucent panels over it.
 * A panel would flatten the relief the whole look depends on and would need its
 * own depth sorting against the prisms; blending the highlight *into* the
 * terrain colour keeps the ground readable underneath, so you can still see
 * that a reachable hex is a hill rather than merely that it is reachable.
 */

import * as Cesium from 'cesium';
import { TERRAIN } from '../config.js';
import { forecastAttack, moveTargets, reachableFrom, stackAt, castleOwnerAt } from '../model.js';
import { neighboursOf } from '../hex.js';
import { wallBlocks } from '../supply.js';

/**
 * Blend strengths are high on purpose. A subtle tint over green terrain is
 * invisible from a camera 40 km up — the first version used a pale yellow-green
 * at 0.42 and the movement range simply could not be seen against grass. These
 * are strong enough to read at any zoom while still letting the terrain colour
 * show through underneath.
 */
const HIGHLIGHTS = {
  reachable: { colour: '#f2f4d4', strength: 0.62 },
  attack: { colour: '#ff7f5e', strength: 0.72 },
  selected: { colour: '#ffe08a', strength: 0.72 },
  siege: { colour: '#f2c14e', strength: 0.6 },
  wall: { colour: '#cfbaee', strength: 0.62 },
};

/**
 * The full set of tints for the current selection, as
 * `{ index, colour }` entries ready for the board's setTinted.
 */
export function highlightsFor(state, board, { selectedId, mode }) {
  const entries = [];
  const stack = selectedId === null ? null : state.stacks.get(selectedId);
  if (!stack) return entries;

  const push = (index, kind) => {
    const spec = HIGHLIGHTS[kind];
    entries.push({ index, colour: blend(board.baseColourAt(index), spec.colour, spec.strength) });
  };

  if (mode === 'wall') {
    for (const edge of wallableEdgesFrom(state, stack)) push(edge, 'wall');
    push(stack.hex, 'selected');
    return entries;
  }

  if (stack.side === state.activeSide && stack.mp > 0) {
    for (const hex of moveTargets(state, stack, reachableFrom(state, stack)).keys()) push(hex, 'reachable');
  }

  if (!stack.attacked && stack.troops > 0) {
    for (const hex of neighboursOf(stack.hex)) {
      if (wallBlocks(state, stack.hex, hex, stack.side)) {
        if (state.walls.has(edgeKeyOf(stack.hex, hex))) push(hex, 'wall');
        continue;
      }
      if (forecastAttack(state, stack, hex)) push(hex, 'attack');
    }
  }

  // The ring of whichever castle this column is next to, so the siege it is
  // part of is visible as a shape rather than as six unrelated hexes.
  const enemyCastle = state.sides[stack.side === 'crown' ? 'marcher' : 'crown'].castle;
  if (neighboursOf(enemyCastle).includes(stack.hex)) {
    for (const hex of neighboursOf(enemyCastle)) {
      if (hex === stack.hex) continue;
      if (!TERRAIN[state.map.terrain[hex]].passable) continue;
      if (!entries.some((entry) => entry.index === hex)) push(hex, 'siege');
    }
  }

  push(stack.hex, 'selected');
  return entries;
}

/** Hexes across whose shared edge the selected column could raise a wall. */
export function wallableEdgesFrom(state, stack) {
  return neighboursOf(stack.hex).filter((hex) => {
    if (state.walls.has(edgeKeyOf(stack.hex, hex))) return false;
    if (!TERRAIN[state.map.terrain[hex]].passable) return false;
    return true;
  });
}

const edgeKeyOf = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Mixes a highlight colour into a terrain colour by `strength`. */
function blend(base, cssColour, strength) {
  const tint = Cesium.Color.fromCssColorString(cssColour);
  return new Cesium.Color(
    base.red + (tint.red - base.red) * strength,
    base.green + (tint.green - base.green) * strength,
    base.blue + (tint.blue - base.blue) * strength,
    1,
  );
}

/** A one-line description of what standing on a hex means, for the inspector. */
export function describeHex(state, index) {
  const terrain = TERRAIN[state.map.terrain[index]];
  const castle = castleOwnerAt(state, index);
  const occupant = stackAt(state, index);

  return {
    terrain,
    castle: castle ? state.sides[castle] : null,
    stack: occupant,
    movementCost: terrain.passable ? terrain.move : null,
    defenceBonus: Math.round((terrain.defense - 1) * 100),
  };
}
