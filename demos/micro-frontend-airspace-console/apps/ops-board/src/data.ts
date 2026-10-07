/**
 * Team Airspace Ops' data layer. Private to this app.
 *
 * Note what is *not* shared: no types from here appear in the contract, and no
 * other team can import this module. That is deliberate. A shared data layer is
 * the most common way micro frontends quietly re-couple — one schema change and
 * three teams have to ship together again. Each remote talks to its own
 * backend, with its own client, on its own release train.
 *
 * The "backend" here is a seeded simulation so the demo is deterministic and
 * needs no server.
 */
import type { SectorId, Severity } from '@airspace/contract';

export interface Flight {
  id: string;
  callsign: string;
  type: string;
  origin: string;
  destination: string;
  altitudeFt: number;
  groundSpeedKt: number;
  headingDeg: number;
  sector: SectorId;
  /** How far the flight is from its cleared profile, 0–1. Drives severity. */
  conformance: number;
  severity: Severity;
  squawk: string;
  /** Only computed by releases that know about it — see __RELEASE__ below. */
  wakeCategory?: 'light' | 'medium' | 'heavy' | 'super';
}

const CARRIERS = ['DAL', 'AAL', 'UAL', 'SWA', 'JBU', 'FDX', 'UPS', 'NKS', 'ASA', 'RPA'];
const TYPES = ['B738', 'A320', 'A21N', 'B39M', 'CRJ9', 'E75L', 'B763', 'A339', 'MD11', 'B77L'];
const PORTS = ['KATL', 'KJFK', 'KORD', 'KDFW', 'KDEN', 'KLAX', 'KSEA', 'KBOS', 'KMIA', 'KPHX'];

/** Deterministic PRNG so every reload tells the same story. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seedFor = (sector: SectorId): number =>
  [...sector].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) | 0, 17);

const severityFor = (conformance: number): Severity =>
  conformance > 0.72 ? 'critical' : conformance > 0.5 ? 'warning' : conformance > 0.28 ? 'advisory' : 'info';

/**
 * `__RELEASE__` is replaced at build time. It exists so this repo can build the
 * same source twice and get two genuinely different bundles, which is what the
 * shell's deploy-skew control switches between. In a real project you would
 * simply have two commits; the flag is the compression of that into one repo.
 */
declare const __RELEASE__: string;
export const RELEASE: string = typeof __RELEASE__ === 'string' ? __RELEASE__ : 'dev';

/** Wake-category ranking shipped in 2026.8.0. The 2026.7.0 build has no idea it exists. */
export const HAS_WAKE_CATEGORY = RELEASE >= '2026.8.0';

function build(sector: SectorId, tick: number): Flight[] {
  const random = mulberry32(seedFor(sector));
  const count = 9 + Math.floor(random() * 5);

  return Array.from({ length: count }, (_, index) => {
    const carrier = CARRIERS[Math.floor(random() * CARRIERS.length)]!;
    const number = 100 + Math.floor(random() * 899);
    // Conformance drifts with the tick so the board is alive, but stays a pure
    // function of (sector, tick) so it never depends on when you opened it.
    const drift = (Math.sin((tick + index * 37) / 9) + 1) / 2;
    const conformance = Math.min(0.98, Math.max(0.02, random() * 0.45 + drift * 0.5));

    return {
      id: `${sector}-${carrier}${number}`,
      callsign: `${carrier}${number}`,
      type: TYPES[Math.floor(random() * TYPES.length)]!,
      origin: PORTS[Math.floor(random() * PORTS.length)]!,
      destination: PORTS[Math.floor(random() * PORTS.length)]!,
      altitudeFt: (180 + Math.floor(random() * 24) * 10) * 100,
      groundSpeedKt: 380 + Math.floor(random() * 180),
      headingDeg: Math.floor(random() * 360),
      sector,
      conformance,
      severity: severityFor(conformance),
      squawk: String(1000 + Math.floor(random() * 6777)).padStart(4, '0'),
      ...(HAS_WAKE_CATEGORY
        ? { wakeCategory: (['light', 'medium', 'heavy', 'super'] as const)[Math.floor(random() * 4)]! }
        : {}),
    };
  });
}

export interface FetchOptions {
  sector: SectorId;
  tick: number;
  /** Proves the token round-trip; the mock backend ignores it. */
  token: string;
  signal?: AbortSignal;
}

/** Stands in for `GET /api/v3/flights?sector=…` against Team Airspace Ops' own service. */
export function fetchFlights({ sector, tick, signal }: FetchOptions): Promise<Flight[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(build(sector, tick)), 120 + Math.random() * 180);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    });
  });
}
