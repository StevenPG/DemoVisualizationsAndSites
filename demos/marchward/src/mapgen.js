/**
 * Procedural terrain.
 *
 * Two noise fields (elevation and moisture) classify every hex, then rivers are
 * carved by walking downhill, then the result is *repaired* — because a
 * beautiful map that cannot be played is worthless. The repair pass guarantees
 * three things no amount of noise tuning can:
 *
 *   1. Both castles have six passable ring hexes, or they could never be
 *      fully encircled and the siege rules would be dead code.
 *   2. There are at least two distinct routes between the castles, so a flank
 *      is always available and the game is never a single corridor.
 *   3. Every river has fords, and they are spread out rather than adjacent.
 *
 * Everything is driven from the seed, so the same seed and theatre always
 * produce the same board.
 */

import { BOARD, TERRAIN } from './config.js';
import { makeNoise, makeRng } from './rng.js';
import {
  HEX_COUNT,
  colOf,
  costField,
  indexOf,
  neighboursOf,
  pathTo,
  reachable,
  rowOf,
} from './hex.js';

/** Ridged noise turns blobby fbm into ridge lines, which is what makes mountains look like ranges. */
const ridged = (n) => 1 - Math.abs(2 * n - 1);

export function generateMap(theatre, seed) {
  const rng = makeRng(`${theatre.key}:${seed}`);
  const elevationNoise = makeNoise(`${theatre.key}:${seed}:elevation`);
  const moistureNoise = makeNoise(`${theatre.key}:${seed}:moisture`);
  const gen = theatre.gen;

  const terrain = new Array(HEX_COUNT);
  const elevation = new Float32Array(HEX_COUNT);
  const moisture = new Float32Array(HEX_COUNT);

  // --- Fields -------------------------------------------------------------
  for (let i = 0; i < HEX_COUNT; i += 1) {
    const u = colOf(i) / BOARD.cols;
    const v = rowOf(i) / BOARD.rows;
    const smooth = elevationNoise(u * gen.frequency, v * gen.frequency, 4);
    const ridge = ridged(elevationNoise(u * gen.frequency * 0.6 + 11.3, v * gen.frequency * 0.6 + 7.1, 3));
    elevation[i] = clamp01(smooth * (1 - gen.ridgeWeight) + ridge * gen.ridgeWeight + gen.elevationBias);
    moisture[i] = moistureNoise(u * gen.frequency * 1.3 + 31.7, v * gen.frequency * 1.3 + 19.4, 3);
  }

  classify(terrain, elevation, moisture, gen.mix);

  // --- Rivers -------------------------------------------------------------
  const rivers = [];
  if (gen.trunkRiver) rivers.push(carveTrunkRiver(terrain, elevation, rng));
  for (let n = 0; n < gen.rivers; n += 1) {
    const river = carveRiver(terrain, elevation, rng);
    if (river.length > 4) rivers.push(river);
  }

  // --- Castles ------------------------------------------------------------
  const castles = placeCastles(terrain, rng);

  // --- Repair -------------------------------------------------------------
  for (const castle of castles) clearAround(terrain, castle, rng);
  const fords = placeFords(terrain, rivers, rng);
  const routes = ensureRoutes(terrain, castles, fords);

  return {
    theatreKey: theatre.key,
    seed,
    terrain,
    /** Kept for the renderer: a few metres of per-hex jitter stops plains looking like a table. */
    elevation,
    castles,
    fords,
    routes,
  };
}

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Turn the two noise fields into terrain by *quantile* rather than by absolute
 * threshold.
 *
 * This matters more than it looks. Fractal noise averaged over octaves piles up
 * around its midpoint, and the pile moves whenever the elevation bias or the
 * ridge weight changes — so a fixed threshold that gives a pleasant 20% hills
 * on one theatre silently gives 71% on another, and the board stops being
 * playable. Sorting the field and cutting it at the fraction we actually want
 * makes the terrain mix a property of the theatre rather than an emergent
 * accident, while the noise still decides *where* each type goes.
 *
 * `mix` gives the share of the board for each type; plains take the remainder.
 */
function classify(terrain, elevation, moisture, mix) {
  const highGround = mix.mountain + mix.hills;
  const mountainAt = quantile(elevation, mix.mountain);
  const hillAt = quantile(elevation, highGround);

  // Forest and rough are chosen among the lowlands only, by moisture: the wet
  // end is wooded, the dry end is broken stony ground, the middle is farmland.
  const lowland = [];
  for (let i = 0; i < HEX_COUNT; i += 1) {
    if (elevation[i] >= hillAt) continue;
    lowland.push(moisture[i]);
  }
  const lowlandShare = lowland.length / HEX_COUNT || 1;
  const forestAt = quantile(lowland, mix.forest / lowlandShare);
  const roughAt = quantile(lowland, 1 - mix.rough / lowlandShare);

  for (let i = 0; i < HEX_COUNT; i += 1) {
    const e = elevation[i];
    const m = moisture[i];
    if (e >= mountainAt) terrain[i] = 'mountain';
    else if (e >= hillAt) terrain[i] = 'hills';
    else if (m >= forestAt) terrain[i] = 'forest';
    else if (m <= roughAt) terrain[i] = 'rough';
    else terrain[i] = 'plains';
  }
}

/** The value with `fraction` of the data above it. */
function quantile(values, fraction) {
  if (!values.length) return Infinity;
  if (fraction <= 0) return Infinity;
  if (fraction >= 1) return -Infinity;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const at = Math.floor((1 - fraction) * (sorted.length - 1));
  return sorted[Math.max(0, Math.min(sorted.length - 1, at))];
}

/**
 * A river walks downhill from a high starting hex until it leaves the board or
 * runs out of downhill. Marking the trail as impassable water is what turns a
 * smooth elevation field into a board with lines on it worth defending.
 */
function carveRiver(terrain, elevation, rng, start = null) {
  const from = start ?? highStart(elevation, rng);
  const trail = [];
  const visited = new Set();
  let at = from;

  for (let step = 0; step < BOARD.cols + BOARD.rows; step += 1) {
    if (visited.has(at)) break;
    visited.add(at);
    if (terrain[at] !== 'mountain') trail.push(at);

    // Downhill, with a small random tiebreak so rivers meander instead of
    // running dead straight down the gradient.
    let next = -1;
    let lowest = elevation[at];
    for (const n of rng.shuffle(neighboursOf(at))) {
      if (visited.has(n)) continue;
      const height = elevation[n] - rng() * 0.02;
      if (height < lowest) {
        lowest = height;
        next = n;
      }
    }
    if (next === -1) break;
    at = next;
    if (onEdge(at)) {
      trail.push(at);
      break;
    }
  }

  for (const i of trail) terrain[i] = 'river';
  return trail;
}

/**
 * The trunk river crosses the whole board north to south, which puts it square
 * across the line between the two castles. On the Rhine and Loire boards that
 * single feature is the campaign: everything is about the crossings.
 */
function carveTrunkRiver(terrain, elevation, rng) {
  const trail = [];
  let col = Math.floor(BOARD.cols * rng.range(0.4, 0.6));

  for (let row = 0; row < BOARD.rows; row += 1) {
    col += rng.chance(0.42) ? (rng.chance(0.5) ? -1 : 1) : 0;
    col = Math.max(3, Math.min(BOARD.cols - 4, col));
    const i = indexOf(col, row);
    trail.push(i);
    terrain[i] = 'river';

    // Widen it occasionally so it reads as a real river rather than a ditch,
    // but never two hexes wide for more than a stretch at a time.
    if (rng.chance(0.28)) {
      const side = indexOf(Math.max(3, Math.min(BOARD.cols - 4, col + (rng.chance(0.5) ? -1 : 1))), row);
      if (side !== i) {
        trail.push(side);
        terrain[side] = 'river';
      }
    }
  }

  return trail;
}

function highStart(elevation, rng) {
  let best = -1;
  let bestHeight = -Infinity;
  // Best of a handful of random samples: high enough to flow a long way,
  // random enough that the sources move between seeds.
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const i = rng.int(HEX_COUNT);
    if (onEdge(i)) continue;
    if (elevation[i] > bestHeight) {
      bestHeight = elevation[i];
      best = i;
    }
  }
  return best === -1 ? rng.int(HEX_COUNT) : best;
}

const onEdge = (i) =>
  colOf(i) === 0 || rowOf(i) === 0 || colOf(i) === BOARD.cols - 1 || rowOf(i) === BOARD.rows - 1;

/**
 * Castles go on opposite sides, a few hexes in from the edge and roughly level
 * with each other, with enough vertical jitter that the approach is never the
 * same twice.
 */
function placeCastles(terrain, rng) {
  const inset = 3;
  const midRow = Math.floor(BOARD.rows / 2);
  const jitter = () => Math.round(rng.range(-BOARD.rows * 0.22, BOARD.rows * 0.22));

  const west = indexOf(inset + rng.int(2), clampRow(midRow + jitter()));
  const east = indexOf(BOARD.cols - 1 - inset - rng.int(2), clampRow(midRow + jitter()));

  for (const i of [west, east]) terrain[i] = 'plains';
  return [west, east];
}

const clampRow = (row) => Math.max(2, Math.min(BOARD.rows - 3, row));

/**
 * A castle that cannot be surrounded cannot be besieged, and the siege is the
 * game — so its six ring hexes are forced passable whatever the noise said.
 * Mountains become hills and water becomes a ford, which keeps the ring
 * expensive to stand on without making it impossible.
 */
function clearAround(terrain, castle, rng) {
  for (const n of neighboursOf(castle)) {
    if (terrain[n] === 'mountain') terrain[n] = 'hills';
    else if (terrain[n] === 'river') terrain[n] = 'ford';
  }
  // One ring further out, thin the mountains so an army can actually deploy
  // around the castle rather than arriving down a single lane.
  for (const n of neighboursOf(castle)) {
    for (const nn of neighboursOf(n)) {
      if (terrain[nn] === 'mountain' && rng.chance(0.6)) terrain[nn] = 'hills';
    }
  }
}

/**
 * Fords, spaced along each river. A crossing every few hexes gives both sides
 * something specific to race for; adjacent fords would just be a bridge.
 */
function placeFords(terrain, rivers, rng) {
  const fords = [];
  const spacing = 4;

  for (const river of rivers) {
    const water = river.filter((i) => terrain[i] === 'river');
    if (!water.length) continue;

    let since = spacing;
    for (const i of water) {
      since += 1;
      if (since < spacing) continue;
      // Never place a ford where it would sit next to another one.
      if (neighboursOf(i).some((n) => terrain[n] === 'ford')) continue;
      terrain[i] = 'ford';
      fords.push(i);
      since = 0;
    }

    // A river the generator managed to leave uncrossable would split the board
    // in two, so guarantee at least one crossing per river.
    if (!water.some((i) => terrain[i] === 'ford')) {
      const i = rng.pick(water);
      terrain[i] = 'ford';
      fords.push(i);
    }
  }

  return fords;
}

/**
 * Guarantee two distinct routes between the castles.
 *
 * Runs a shortest path with impassable terrain merely expensive rather than
 * forbidden, then converts whatever impassable hexes that path crossed. When
 * the board is already connected the path costs nothing to cross and this is a
 * no-op; when it is not, this is what carves the pass. Doing it twice via a
 * northern and a southern waypoint means there is always more than one way in,
 * so an encirclement is a choice rather than the only option.
 */
function ensureRoutes(terrain, castles, fords) {
  const [west, east] = castles;
  const waypoints = [
    indexOf(Math.floor(BOARD.cols / 2), Math.floor(BOARD.rows * 0.2)),
    indexOf(Math.floor(BOARD.cols / 2), Math.floor(BOARD.rows * 0.8)),
  ];

  const routes = [];
  for (const waypoint of waypoints) {
    const legs = [carve(terrain, west, waypoint), carve(terrain, waypoint, east)];
    if (legs.every(Boolean)) routes.push([...legs[0], ...legs[1].slice(1)]);
  }

  // Anything converted from river to ford is a crossing the fords list should
  // know about, or the AI would not weigh it when picking a line of advance.
  for (const route of routes) {
    for (const i of route) {
      if (terrain[i] === 'ford' && !fords.includes(i)) fords.push(i);
    }
  }

  return routes;
}

function carve(terrain, from, to) {
  // Impassable terrain is allowed but priced high, so the path prefers to go
  // around a range and only tunnels through when there is genuinely no way past.
  const costOf = (i) => {
    if (terrain[i] === 'mountain') return 26;
    if (terrain[i] === 'river') return 18;
    return TERRAIN[terrain[i]].move;
  };

  const best = reachable(from, Infinity, costOf);
  const path = pathTo(best, to);
  if (!path) return null;

  for (const i of path) {
    if (terrain[i] === 'mountain') terrain[i] = 'hills';
    else if (terrain[i] === 'river') terrain[i] = 'ford';
  }
  return path;
}

/**
 * Sanity check used by the dev build and the tests: every claim the repair pass
 * makes, verified against the finished board. Returns a list of problems, empty
 * when the map is sound.
 */
export function validateMap(map) {
  const problems = [];
  const passable = (i) => TERRAIN[map.terrain[i]].passable;

  for (const castle of map.castles) {
    const ring = neighboursOf(castle);
    if (ring.length < 6) problems.push(`castle ${castle} is against the board edge — only ${ring.length} ring hexes`);
    const blocked = ring.filter((i) => !passable(i));
    if (blocked.length) problems.push(`castle ${castle} has ${blocked.length} impassable ring hexes`);
  }

  const [west, east] = map.castles;
  const field = costField([west], (i) => (passable(i) ? TERRAIN[map.terrain[i]].move : Infinity));
  if (!field.has(east)) problems.push('the two castles are not connected by passable terrain');

  return problems;
}
