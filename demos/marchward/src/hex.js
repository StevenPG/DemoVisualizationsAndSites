/**
 * Hex grid maths.
 *
 * Storage is odd-r offset (rectangular rows, odd rows nudged half a hex right)
 * because the board is a rectangle and a rectangle of axial coordinates is a
 * rhombus. All the actual maths happens in axial/cube space, where distance and
 * neighbours are trivial, with conversions at the boundary. Mixing the two is
 * the classic way to get a hex grid subtly wrong, so nothing below takes an
 * offset coordinate except the two converters and the index helpers.
 *
 * Hexes are pointy-top: flat sides east and west, points north and south.
 */

import { BOARD } from './config.js';

/** Axial neighbour offsets, in clockwise order starting due east. */
export const DIRECTIONS = [
  { q: 1, r: 0 }, // east
  { q: 0, r: 1 }, // south-east
  { q: -1, r: 1 }, // south-west
  { q: -1, r: 0 }, // west
  { q: 0, r: -1 }, // north-west
  { q: 1, r: -1 }, // north-east
];

/** Compass labels for the six directions, used in orders and tooltips. */
export const DIRECTION_LABELS = ['E', 'SE', 'SW', 'W', 'NW', 'NE'];

export const colRowToAxial = (col, row) => ({ q: col - ((row - (row & 1)) >> 1), r: row });
export const axialToColRow = (q, r) => ({ col: q + ((r - (r & 1)) >> 1), row: r });

/** Every hex has a stable integer id: its index in row-major order. */
export const indexOf = (col, row) => row * BOARD.cols + col;
export const colOf = (index) => index % BOARD.cols;
export const rowOf = (index) => Math.floor(index / BOARD.cols);
export const HEX_COUNT = BOARD.cols * BOARD.rows;

export const inBounds = (col, row) => col >= 0 && col < BOARD.cols && row >= 0 && row < BOARD.rows;

/**
 * Neighbour indices of a hex, in the same clockwise order as DIRECTIONS, with
 * `-1` where the neighbour would be off the board. Keeping the array
 * fixed-length means direction 2 is always south-west, which is what the wall
 * code needs to identify an edge.
 */
export function neighbours(index) {
  const { q, r } = colRowToAxial(colOf(index), rowOf(index));
  const out = new Array(6);
  for (let d = 0; d < 6; d += 1) {
    const { col, row } = axialToColRow(q + DIRECTIONS[d].q, r + DIRECTIONS[d].r);
    out[d] = inBounds(col, row) ? indexOf(col, row) : -1;
  }
  return out;
}

/** Neighbour indices with the off-board entries dropped. */
export const neighboursOf = (index) => neighbours(index).filter((n) => n >= 0);

/** Hex distance in steps — the number of moves to get from a to b ignoring terrain. */
export function distance(a, b) {
  const p = colRowToAxial(colOf(a), rowOf(a));
  const s = colRowToAxial(colOf(b), rowOf(b));
  const dq = p.q - s.q;
  const dr = p.r - s.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

/** Which of the six DIRECTIONS points from `a` towards `b`; used to face unit icons. */
export function directionTowards(a, b) {
  const { x: ax, y: ay } = centreMeters(a);
  const { x: bx, y: by } = centreMeters(b);
  return Math.atan2(bx - ax, by - ay); // bearing in radians, 0 = north, clockwise
}

/** Every hex within `radius` steps of `index`, including `index` itself. */
export function withinRadius(index, radius) {
  const origin = colRowToAxial(colOf(index), rowOf(index));
  const out = [];
  for (let dq = -radius; dq <= radius; dq += 1) {
    const lo = Math.max(-radius, -dq - radius);
    const hi = Math.min(radius, -dq + radius);
    for (let dr = lo; dr <= hi; dr += 1) {
      const { col, row } = axialToColRow(origin.q + dq, origin.r + dr);
      if (inBounds(col, row)) out.push(indexOf(col, row));
    }
  }
  return out;
}

/**
 * Position of a hex centre in metres on the board's local tangent plane, with
 * +x east and +y north. The board is generated top-down (row 0 at the top), so
 * y is negated to put row 0 at the north edge.
 */
const SPACING = BOARD.hexSpacingMeters;
const CIRCUMRADIUS = SPACING / Math.sqrt(3);
export const HEX_CIRCUMRADIUS = CIRCUMRADIUS;

export function centreMeters(index) {
  const { q, r } = colRowToAxial(colOf(index), rowOf(index));
  return {
    x: SPACING * (q + r / 2),
    y: -1.5 * CIRCUMRADIUS * r,
  };
}

/** The six corners of a hex in metres, relative to its centre, pointy-top. */
export const CORNER_OFFSETS = Array.from({ length: 6 }, (_, i) => {
  const angle = (Math.PI / 180) * (60 * i - 30);
  return { x: CIRCUMRADIUS * Math.cos(angle), y: CIRCUMRADIUS * Math.sin(angle) };
});

/** Extent of the whole board in metres, used to size and centre the camera bounds. */
export function boardExtentMeters() {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < HEX_COUNT; i += 1) {
    const { x, y } = centreMeters(i);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    minX: minX - CIRCUMRADIUS,
    maxX: maxX + CIRCUMRADIUS,
    minY: minY - CIRCUMRADIUS,
    maxY: maxY + CIRCUMRADIUS,
    centreX: (minX + maxX) / 2,
    centreY: (minY + maxY) / 2,
    widthMeters: maxX - minX + SPACING,
    heightMeters: maxY - minY + 2 * CIRCUMRADIUS,
  };
}

/**
 * The shared edge between two adjacent hexes, as a stable key.
 *
 * Walls live on edges, and both hexes either side have to agree on which edge
 * that is, so the key is built from the sorted pair. `a|b` with a < b.
 */
export const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const edgeHexes = (key) => key.split('|').map(Number);

/**
 * The two corner points of the edge between adjacent hexes `a` and `b`, in
 * board metres. Used to draw a wall as a box sitting exactly on the boundary.
 */
export function edgeEndpointsMeters(a, b) {
  const ca = centreMeters(a);
  const cb = centreMeters(b);
  const mid = { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
  // The edge is perpendicular to the line joining the centres, and exactly one
  // hex side long (the inradius-to-circumradius relationship makes that
  // CIRCUMRADIUS, since a hex side equals its circumradius).
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const half = CIRCUMRADIUS / 2;
  return [
    { x: mid.x + px * half, y: mid.y + py * half },
    { x: mid.x - px * half, y: mid.y - py * half },
  ];
}

/**
 * A minimal binary min-heap over (index, cost) pairs.
 *
 * Both searches below run on every hover in the UI and a few dozen times per
 * AI turn, and an insertion-sorted array frontier makes them quadratic in the
 * frontier size — which is fine for a movement allowance of five and distinctly
 * not fine for the unbounded cost fields the AI builds across the whole board.
 */
export class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(index, cost) {
    const items = this.items;
    items.push({ index, cost });
    let at = items.length - 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (items[parent].cost <= items[at].cost) break;
      [items[parent], items[at]] = [items[at], items[parent]];
      at = parent;
    }
  }

  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      items[0] = last;
      let at = 0;
      for (;;) {
        const left = 2 * at + 1;
        const right = left + 1;
        let smallest = at;
        if (left < items.length && items[left].cost < items[smallest].cost) smallest = left;
        if (right < items.length && items[right].cost < items[smallest].cost) smallest = right;
        if (smallest === at) break;
        [items[smallest], items[at]] = [items[at], items[smallest]];
        at = smallest;
      }
    }
    return top;
  }
}

/**
 * Dijkstra over movement costs from `origin`, stopping once `budget` movement
 * points are spent.
 *
 * `costOf(index)` returns the cost to enter a hex or Infinity if it may not be
 * entered, and `blocked(from, to)` rejects an individual step (a wall, or a
 * hex held by the enemy). Returns a Map of hex index -> { cost, from }, which
 * is everything both the movement overlay and the AI's pathing need.
 */
export function reachable(origin, budget, costOf, blocked = () => false) {
  const best = new Map([[origin, { cost: 0, from: -1 }]]);
  const frontier = new MinHeap();
  frontier.push(origin, 0);

  while (frontier.size) {
    const current = frontier.pop();
    if (current.cost > (best.get(current.index)?.cost ?? Infinity)) continue;

    for (const next of neighboursOf(current.index)) {
      if (blocked(current.index, next)) continue;
      const step = costOf(next);
      if (!Number.isFinite(step)) continue;

      /**
       * A column may always advance one hex, even onto ground it cannot afford,
       * spending everything it has to do it.
       *
       * Without this rule the movement penalty for size interacts with terrain
       * cost to produce an absurdity: the minimum allowance is two, hills cost
       * three, so any army above 15,000 is not merely slowed by hills but
       * physically unable to enter them. On the upland boards that walls whole
       * hosts into the lowlands permanently.
       */
      const effective = current.index === origin ? Math.min(step, budget) : step;
      const cost = current.cost + effective;
      if (cost > budget) continue;
      if (cost >= (best.get(next)?.cost ?? Infinity)) continue;

      best.set(next, { cost, from: current.index });
      frontier.push(next, cost);
    }
  }

  return best;
}

/** Walks the `from` pointers of a `reachable` result back into a path. */
export function pathTo(best, target) {
  if (!best.has(target)) return null;
  const path = [];
  for (let at = target; at !== -1; at = best.get(at).from) path.unshift(at);
  return path;
}

/**
 * Unbounded Dijkstra used by the AI to ask "how far is that, really" across the
 * whole board. Same cost model, no budget, returns costs only.
 */
export function costField(origins, costOf, blocked = () => false) {
  const best = new Map();
  const frontier = new MinHeap();
  for (const origin of origins) {
    best.set(origin, 0);
    frontier.push(origin, 0);
  }

  while (frontier.size) {
    const current = frontier.pop();
    if (current.cost > (best.get(current.index) ?? Infinity)) continue;

    for (const next of neighboursOf(current.index)) {
      if (blocked(current.index, next)) continue;
      const step = costOf(next);
      if (!Number.isFinite(step)) continue;

      const cost = current.cost + step;
      if (cost >= (best.get(next) ?? Infinity)) continue;

      best.set(next, cost);
      frontier.push(next, cost);
    }
  }

  return best;
}
