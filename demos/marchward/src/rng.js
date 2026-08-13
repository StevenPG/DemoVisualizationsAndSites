/**
 * Seeded randomness.
 *
 * Map generation and combat both need to be reproducible: a seed printed on the
 * setup screen means a map you liked can be played again, and a deterministic
 * combat roll means a bug in the rules can be reproduced from a save rather
 * than chased. Nothing here calls Math.random.
 */

/** Turns an arbitrary string into a 32-bit seed. */
export function hashSeed(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * mulberry32 — small, fast, and good enough that terrain generated from
 * adjacent seeds looks unrelated. Returns a function producing [0, 1).
 */
export function makeRng(seed) {
  let a = (typeof seed === 'string' ? hashSeed(seed) : seed) >>> 0;

  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  next.int = (maxExclusive) => Math.floor(next() * maxExclusive);
  next.range = (min, max) => min + next() * (max - min);
  next.pick = (list) => list[Math.floor(next() * list.length)];
  next.chance = (p) => next() < p;
  /** Fisher-Yates, in place, so shuffles are reproducible too. */
  next.shuffle = (list) => {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  };

  return next;
}

/** A short, pronounceable seed for the setup screen. */
export function randomSeedWord() {
  const first = ['ash', 'bram', 'clyde', 'dun', 'ell', 'fen', 'gar', 'hal', 'ilk', 'kel', 'mor', 'ryn', 'tor', 'wen'];
  const second = ['bury', 'cairn', 'dale', 'ford', 'gate', 'holt', 'march', 'mere', 'stead', 'thorpe', 'wick', 'wold'];
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  return `${pick(first)}${pick(second)}-${Math.floor(Math.random() * 900 + 100)}`;
}

/**
 * Value noise with fractal octaves, seeded. Perlin/simplex would be smoother,
 * but at 34 x 26 samples the difference is invisible and this is a third of the
 * code with no gradient tables to get wrong.
 */
export function makeNoise(seed) {
  const rng = makeRng(seed);
  const size = 256;
  const table = new Float32Array(size * size);
  for (let i = 0; i < table.length; i += 1) table[i] = rng();

  const at = (x, y) => table[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  const smooth = (t) => t * t * (3 - 2 * t);

  const value = (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
    const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };

  /** Fractal Brownian motion: `octaves` layers, each half the amplitude and twice the frequency. */
  return (x, y, octaves = 4, frequency = 1) => {
    let total = 0;
    let amplitude = 1;
    let max = 0;
    let f = frequency;
    for (let i = 0; i < octaves; i += 1) {
      total += value(x * f, y * f) * amplitude;
      max += amplitude;
      amplitude *= 0.5;
      f *= 2;
    }
    return total / max;
  };
}
