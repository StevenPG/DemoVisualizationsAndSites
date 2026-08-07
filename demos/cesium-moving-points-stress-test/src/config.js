/**
 * Tunables and presentation for the four kinds of mover.
 *
 * Physics lives in simulation.js — this file is only "what does the user see
 * and what can they drag". Every slider on the panel is generated from here.
 */

export const SHIP = 0;
export const PLANE = 1;
export const GROUND = 2;
export const SATELLITE = 3;

/** Hard ceiling per kind. The typed arrays in the simulation are sized for 4x this. */
export const MAX_PER_KIND = 50_000;
export const MAX_TOTAL = MAX_PER_KIND * 4;

/**
 * Above this many live movers, switching to Entity rendering is likely to lock
 * the tab up for a long time, so the panel asks before doing it.
 */
export const ENTITY_MODE_WARN_AT = 20_000;

/**
 * What the page loads with, per kind.
 *
 * Deliberately tiny. This is a stress test, so the temptation is to open under
 * load — but the first frame has to land on a phone, on integrated graphics and
 * on a software rasteriser, and someone whose tab janks on arrival never gets as
 * far as the sliders. 100 each is sparse but legible, and costs so little that
 * nothing you can measure is attributable to it; turning it up is the entire
 * point of the panel.
 */
const DEFAULT_COUNT = 100;

export const KINDS = [
  {
    id: 'ship',
    index: SHIP,
    label: 'Ships',
    singular: 'Ship',
    blurb: 'Surface vessels. Spawn in open water and get retired if they run into a coastline.',
    domain: 'ocean',
    color: '#33b1ff',
    count: { min: 0, max: MAX_PER_KIND, value: DEFAULT_COUNT },
    // Real-world-ish speeds. The global time multiplier is what makes them
    // visible at globe scale; the numbers reported in the info box are the
    // honest m/s, not the exaggerated ones.
    speed: { min: 1, max: 60, value: 12, step: 1, unit: 'm/s', hint: 'knots' },
    leg: { min: 50, max: 8000, value: 900, step: 50, unit: 'km' },
  },
  {
    id: 'plane',
    index: PLANE,
    label: 'Aircraft',
    singular: 'Aircraft',
    blurb: 'Cruising traffic between 3 and 12 km. Free to fly over anything.',
    domain: 'any',
    color: '#ffd166',
    count: { min: 0, max: MAX_PER_KIND, value: DEFAULT_COUNT },
    speed: { min: 20, max: 600, value: 240, step: 10, unit: 'm/s', hint: 'cruise' },
    leg: { min: 100, max: 15000, value: 2200, step: 100, unit: 'km' },
  },
  {
    id: 'ground',
    index: GROUND,
    label: 'Ground vehicles',
    singular: 'Ground vehicle',
    blurb: 'Ride the sampled terrain surface. Spawn inland and get retired at the water.',
    domain: 'land',
    color: '#06d6a0',
    count: { min: 0, max: MAX_PER_KIND, value: DEFAULT_COUNT },
    speed: { min: 1, max: 120, value: 20, step: 1, unit: 'm/s', hint: 'road speed' },
    leg: { min: 10, max: 3000, value: 220, step: 10, unit: 'km' },
  },
  {
    id: 'satellite',
    index: SATELLITE,
    label: 'Satellites',
    singular: 'Satellite',
    blurb: 'Circular orbits, 400–1200 km, random inclination and right ascension.',
    domain: 'orbit',
    color: '#ef476f',
    count: { min: 0, max: MAX_PER_KIND, value: DEFAULT_COUNT },
    // Orbital velocity is a consequence of altitude, so the "speed" slider here
    // is a frank fudge factor on the mean motion. Labelled as such in the panel.
    speed: { min: 0.1, max: 20, value: 1, step: 0.1, unit: '×', hint: 'orbital rate' },
    leg: { min: 5000, max: 400_000, value: 90_000, step: 5000, unit: 'km' },
  },
];

export const GLOBAL_DEFAULTS = {
  // Ships at 12 m/s are invisible on a globe. This is the honest cheat that
  // makes the scene look alive; every reported speed stays in real units.
  timeScale: 25,
  pointSize: 4,
  // Off on arrival. Elevation tile streaming is by a wide margin the most
  // expensive thing this page can do on first load — far more than the movers —
  // and it competes for the same frames the HUD is trying to measure. The
  // checkbox turns it on in one click, which is the point of having it.
  terrain: false,
  renderMode: 'primitives', // 'primitives' | 'entities'
  rampFpsFloor: 30,
};

export const TIME_SCALE_RANGE = { min: 1, max: 2000 };

/** Metres the surface kinds are lifted so the terrain depth test does not eat them. */
export const SURFACE_RENDER_OFFSET_M = 150;

/** Terrain height lookups are throttled to this many movers per frame, round-robin. */
export const TERRAIN_SAMPLES_PER_FRAME = 400;
