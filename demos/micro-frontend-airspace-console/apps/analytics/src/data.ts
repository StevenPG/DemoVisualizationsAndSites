/**
 * Team Airspace Ops' analytics data layer.
 *
 * Same team as the Operations Board, different application, and — importantly —
 * a separate data layer with no shared module between them. Two apps owned by
 * one team is not a reason to couple them: the point of splitting them was that
 * they can ship on different days.
 */
import type { OpsFilters, SectorId, TimeWindow } from '@airspace/contract';

export interface LoadPoint {
  /** Minutes before now. 0 is the newest sample. */
  minutesAgo: number;
  arrivals: number;
  departures: number;
}

export interface DelayCause {
  cause: string;
  minutes: number;
}

declare const __RELEASE__: string;
export const RELEASE: string = typeof __RELEASE__ === 'string' ? __RELEASE__ : 'dev';

const WINDOW_MINUTES: Record<TimeWindow, number> = { '15m': 15, '1h': 60, '6h': 360, '24h': 1440 };

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
  [...sector].reduce((hash, character) => (hash * 37 + character.charCodeAt(0)) | 0, 91);

export interface Report {
  load: LoadPoint[];
  causes: DelayCause[];
  peakArrivals: number;
  onTimeRate: number;
}

const CAUSES = ['Weather — convective', 'Traffic volume', 'Runway config', 'Crew legality', 'Equipment', 'Airspace flow'];

/** Stands in for `GET /api/analytics/v2/report?sector=…&window=…`. */
export function fetchReport(filters: OpsFilters, signal?: AbortSignal): Promise<Report> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const random = mulberry32(seedFor(filters.sector) + WINDOW_MINUTES[filters.window]);
      const span = WINDOW_MINUTES[filters.window];
      const samples = 24;

      const load: LoadPoint[] = Array.from({ length: samples }, (_, index) => {
        const minutesAgo = Math.round(((samples - 1 - index) / (samples - 1)) * span);
        const phase = (index / samples) * Math.PI * 2;
        return {
          minutesAgo,
          arrivals: Math.round(28 + Math.sin(phase) * 11 + random() * 7),
          departures: Math.round(24 + Math.cos(phase * 1.3) * 9 + random() * 6),
        };
      }).reverse();

      const causes = CAUSES.map((cause) => ({ cause, minutes: Math.round(random() * 180 + 15) })).sort(
        (a, b) => b.minutes - a.minutes,
      );

      resolve({
        load,
        causes,
        peakArrivals: Math.max(...load.map((point) => point.arrivals)),
        onTimeRate: 0.71 + random() * 0.22,
      });
    }, 160 + Math.random() * 220);

    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    });
  });
}
