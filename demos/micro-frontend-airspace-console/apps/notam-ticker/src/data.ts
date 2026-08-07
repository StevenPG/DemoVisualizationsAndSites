import type { SectorId, Severity } from '@airspace/contract';

/** Team Weather Services' own data layer. Nobody else's types appear in it. */
export interface Notice {
  id: string;
  kind: 'NOTAM' | 'SIGMET' | 'METAR' | 'PIREP';
  sector: SectorId;
  severity: Severity;
  text: string;
  issued: string;
}

const TEXTS: Record<Notice['kind'], string[]> = {
  NOTAM: [
    'RWY 09L/27R CLSD FOR MAINT',
    'ILS RWY 26 GP U/S',
    'TWY B BTN TWY C AND TWY G CLSD',
    'OBST TOWER LGT U/S 2.1NM SW',
  ],
  SIGMET: [
    'SEV TURB FL280-FL400 MOV E 25KT',
    'EMBD TS TOPS FL450 MOV NE 30KT',
    'SEV ICE FL100-FL220 STNR',
  ],
  METAR: ['24015G28KT 8SM -RA BKN012 OVC025', '18008KT 10SM SCT045 BKN120', '00000KT 1/2SM FG VV002'],
  PIREP: ['MOD TURB FL240 SMOOTH ABV FL300', 'LGT-MOD ICE CLIMB THRU FL150'],
};

const SEVERITY_BY_KIND: Record<Notice['kind'], Severity> = {
  NOTAM: 'advisory',
  SIGMET: 'critical',
  METAR: 'info',
  PIREP: 'warning',
};

const SECTORS: SectorId[] = ['ZTL-38', 'ZTL-42', 'ZJX-17', 'ZDC-09'];

let counter = 0;

export function makeNotice(seed = Math.random()): Notice {
  const kinds = Object.keys(TEXTS) as Notice['kind'][];
  const kind = kinds[Math.floor(seed * kinds.length) % kinds.length]!;
  const options = TEXTS[kind];
  return {
    id: `n-${(counter += 1)}`,
    kind,
    sector: SECTORS[Math.floor(Math.random() * SECTORS.length)]!,
    severity: SEVERITY_BY_KIND[kind],
    text: options[Math.floor(Math.random() * options.length)]!,
    issued: new Date().toISOString(),
  };
}

export const seedNotices = (count: number): Notice[] =>
  Array.from({ length: count }, (_, index) => makeNotice((index * 0.37) % 1));
