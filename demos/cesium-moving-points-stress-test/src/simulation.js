/**
 * The mover population.
 *
 * Everything is structure-of-arrays over preallocated typed arrays, sized once
 * for the hard ceiling (200k movers). No per-frame allocation, no per-mover
 * objects: at 200k points a plain array of `{lat, lon, ...}` would spend more
 * time in the garbage collector than in the renderer, and the whole point of
 * this demo is to measure the renderer.
 *
 * Slots are handed out by a free list, so a slot index is stable for as long as
 * a mover lives and can be used directly as the index into the renderer's pool.
 * Because slots get recycled, every allocation bumps a generation counter —
 * anything holding on to a slot (the selection, say) pairs it with the
 * generation it saw and can tell "still alive" from "someone else lives here
 * now".
 *
 * Movement uses a local tangent-plane step rather than a proper rhumb-line
 * formula. Over one frame the difference is far below a pixel, and it buys us a
 * per-mover cost of one cosine instead of half a dozen transcendentals — which
 * at 200k movers is the difference between a smooth demo and a slideshow.
 */

import {
  GROUND,
  KINDS,
  MAX_PER_KIND,
  MAX_TOTAL,
  PLANE,
  SATELLITE,
  SHIP,
  SURFACE_RENDER_OFFSET_M,
  TERRAIN_SAMPLES_PER_FRAME,
} from './config.js';

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const DEG = 180 / Math.PI;

// WGS84, matching Cesium's default ellipsoid.
const RADIUS_X = 6378137.0;
const RADIUS_Z = 6356752.314245179;
const RSQ_X = RADIUS_X * RADIUS_X;
const RSQ_Z = RADIUS_Z * RADIUS_Z;
const MEAN_RADIUS = 6371000;

const GM = 3.986004418e14; // Earth's gravitational parameter, for orbital rates

/** Beyond this the 1/cos(lat) longitude step gets silly, so movers retire instead. */
const MAX_LAT = 82 / DEG;

export class Simulation {
  constructor(landMask) {
    this.landMask = landMask;

    const n = MAX_TOTAL;

    // --- shared state -----------------------------------------------------
    this.kind = new Uint8Array(n);
    this.gen = new Uint32Array(n);
    this.seed = new Uint32Array(n);
    this.bornAt = new Float64Array(n);
    this.legTotal = new Float32Array(n); // metres
    this.legDone = new Float32Array(n);

    // --- surface and airborne movers -------------------------------------
    this.lon = new Float64Array(n); // radians
    this.lat = new Float64Array(n);
    this.alt = new Float32Array(n); // metres; terrain height for ground vehicles
    this.heading = new Float32Array(n); // radians clockwise from north
    this.speed = new Float32Array(n); // m/s, the honest number
    this.vNorth = new Float32Array(n); // rad of latitude per second
    this.vEast = new Float32Array(n); // rad of longitude per second, before 1/cos(lat)
    this.originLon = new Float64Array(n);
    this.originLat = new Float64Array(n);

    // --- satellites -------------------------------------------------------
    // Orbits are evaluated in Earth-fixed coordinates without a rotating frame:
    // the ground tracks are wrong in the way a real analyst would notice and
    // nobody else would, and it halves the per-satellite trig.
    this.orbitRadius = new Float32Array(n); // metres from the centre
    this.inclination = new Float32Array(n);
    this.raan = new Float32Array(n);
    this.phase = new Float32Array(n);
    this.meanMotion = new Float32Array(n); // rad/s, already scaled by the kind's factor
    this.cosRaan = new Float32Array(n);
    this.sinRaan = new Float32Array(n);
    this.cosInc = new Float32Array(n);
    this.sinInc = new Float32Array(n);

    // --- world-space output, read by whichever renderer is active ---------
    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
    this.pz = new Float64Array(n);

    // --- slot allocation --------------------------------------------------
    this.freeList = new Int32Array(n);
    this.freeCount = 0;
    this.highWater = 0;

    // --- per-kind dense active lists --------------------------------------
    // One list per kind keeps each update loop monomorphic: no branching on
    // kind inside the hot loop, which matters more than it looks like it should.
    this.groups = KINDS.map(() => ({
      slots: new Int32Array(MAX_PER_KIND),
      count: 0,
      cursor: 0, // round-robin position for throttled terrain sampling
    }));
    this.slotPos = new Int32Array(n); // slot -> its index inside its group's list

    this.targets = KINDS.map((k) => k.count.value);
    this.speeds = KINDS.map((k) => k.speed.value);
    this.legs = KINDS.map((k) => k.leg.value * 1000); // km -> m

    this.time = 0; // simulated seconds since start
    this.spawned = 0; // lifetime totals, the HUD differences them per second
    this.despawned = 0;

    /** @type {(slot: number) => void} */
    this.onSpawn = () => {};
    /** @type {(slot: number) => void} */
    this.onDespawn = () => {};
  }

  get liveCount() {
    let total = 0;
    for (const g of this.groups) total += g.count;
    return total;
  }

  countOf(kind) {
    return this.groups[kind].count;
  }

  isAlive(slot, generation) {
    return this.gen[slot] === generation;
  }

  // ------------------------------------------------------------------ spawn

  /**
   * Moves the live population one step toward the sliders. Called at 1 Hz, so
   * raising a slider streams movers in over a few seconds instead of stalling
   * the frame that the drag ended on.
   *
   * Removals are immediate — dropping a slider should feel instant — while
   * additions are capped per tick. The cap scales with the shortfall so going
   * from 2k to 50k still converges in a handful of seconds.
   */
  reconcile() {
    for (const kindConfig of KINDS) {
      const k = kindConfig.index;
      const group = this.groups[k];
      const diff = this.targets[k] - group.count;

      if (diff < 0) {
        for (let i = 0; i < -diff; i++) this.#despawnAt(k, group.count - 1);
        continue;
      }

      const batch = Math.min(diff, Math.max(500, Math.ceil(diff * 0.5)));
      for (let i = 0; i < batch; i++) {
        if (this.#spawn(k) < 0) break; // out of slots
      }
    }
  }

  #spawn(kind) {
    const slot = this.freeCount > 0 ? this.freeList[--this.freeCount] : this.highWater < MAX_TOTAL ? this.highWater++ : -1;
    if (slot < 0) return -1;

    this.gen[slot] = (this.gen[slot] + 1) >>> 0;
    this.kind[slot] = kind;
    this.seed[slot] = (Math.random() * 0xffffffff) >>> 0;
    this.bornAt[slot] = this.time;
    this.legDone[slot] = 0;
    this.legTotal[slot] = this.legs[kind];

    if (kind === SATELLITE) this.#initSatellite(slot);
    else this.#initSurface(slot, kind);

    const group = this.groups[kind];
    this.slotPos[slot] = group.count;
    group.slots[group.count++] = slot;
    this.spawned++;
    this.onSpawn(slot);
    return slot;
  }

  #initSurface(slot, kind) {
    const config = KINDS[kind];
    const start = this.landMask.sample(config.domain, Math.random, MAX_LAT);
    this.lon[slot] = start.lon;
    this.lat[slot] = start.lat;
    this.originLon[slot] = start.lon;
    this.originLat[slot] = start.lat;

    // A random but thereafter constant heading, which is what makes the scene
    // read as traffic rather than as noise.
    const heading = Math.random() * TWO_PI;
    // ±20% so a fleet does not move as one rigid block.
    const speed = this.speeds[kind] * (0.8 + Math.random() * 0.4);
    this.heading[slot] = heading;
    this.speed[slot] = speed;
    this.vNorth[slot] = (speed * Math.cos(heading)) / MEAN_RADIUS;
    this.vEast[slot] = (speed * Math.sin(heading)) / MEAN_RADIUS;

    this.alt[slot] = kind === PLANE ? 3000 + Math.random() * 9000 : 0;
  }

  #initSatellite(slot) {
    const altitude = 400_000 + Math.random() * 800_000;
    const radius = MEAN_RADIUS + altitude;
    const inclination = Math.acos(1 - 2 * Math.random()); // uniform over the sphere of orbit planes
    const raan = Math.random() * TWO_PI;

    this.orbitRadius[slot] = radius;
    this.alt[slot] = altitude;
    this.inclination[slot] = inclination;
    this.raan[slot] = raan;
    this.phase[slot] = Math.random() * TWO_PI;
    this.meanMotion[slot] = Math.sqrt(GM / (radius * radius * radius)) * this.speeds[SATELLITE];
    this.speed[slot] = this.meanMotion[slot] * radius;
    this.cosRaan[slot] = Math.cos(raan);
    this.sinRaan[slot] = Math.sin(raan);
    this.cosInc[slot] = Math.cos(inclination);
    this.sinInc[slot] = Math.sin(inclination);
    this.originLon[slot] = 0;
    this.originLat[slot] = 0;
  }

  #despawnAt(kind, position) {
    const group = this.groups[kind];
    const slot = group.slots[position];

    const last = group.slots[--group.count];
    group.slots[position] = last;
    this.slotPos[last] = position;

    this.gen[slot] = (this.gen[slot] + 1) >>> 0; // anything holding this slot now sees it as dead
    this.freeList[this.freeCount++] = slot;
    this.despawned++;
    this.onDespawn(slot);
  }

  // ------------------------------------------------------------------- step

  /**
   * @param {number} dt Simulated seconds elapsed (wall clock × the time scale).
   * @param {object} ctx
   * @param {(lonRad: number, latRad: number) => number|undefined} ctx.sampleGroundHeight
   * @param {boolean} ctx.terrainEnabled
   */
  step(dt, ctx) {
    this.time += dt;
    this.#stepSurface(SHIP, dt, ctx);
    this.#stepSurface(PLANE, dt, ctx);
    this.#stepSurface(GROUND, dt, ctx);
    this.#stepSatellites(dt);
  }

  #stepSurface(kind, dt, ctx) {
    const group = this.groups[kind];
    const slots = group.slots;
    const lon = this.lon;
    const lat = this.lat;
    const alt = this.alt;
    const vNorth = this.vNorth;
    const vEast = this.vEast;
    const legDone = this.legDone;
    const legTotal = this.legTotal;
    const speed = this.speed;
    const px = this.px;
    const py = this.py;
    const pz = this.pz;

    const mask = this.landMask;
    const checkDomain = mask.available && (kind === SHIP || kind === GROUND);
    const wantOcean = kind === SHIP;
    const renderOffset = kind === PLANE ? 0 : SURFACE_RENDER_OFFSET_M;

    // Terrain lookups walk the loaded tile tree, so only a slice of the ground
    // fleet re-samples on any given frame; everything else coasts on the height
    // it last saw, which at 20 m/s is indistinguishable. Done as its own pass
    // because the movement loop below mutates the list it is walking.
    if (kind === GROUND && ctx.terrainEnabled && group.count > 0) {
      const budget = Math.min(TERRAIN_SAMPLES_PER_FRAME, group.count);
      for (let s = 0; s < budget; s++) {
        const i = slots[(group.cursor + s) % group.count];
        const h = ctx.sampleGroundHeight(lon[i], lat[i]);
        if (h !== undefined) alt[i] = h;
      }
      group.cursor = (group.cursor + budget) % group.count;
    }

    // Backwards, because retiring a mover swaps the last entry into the hole —
    // and the last entry is one we have already visited.
    for (let a = group.count - 1; a >= 0; a--) {
      const i = slots[a];

      const cosLat = Math.cos(lat[i]);
      let nextLat = lat[i] + vNorth[i] * dt;
      let nextLon = lon[i] + (vEast[i] * dt) / (cosLat > 1e-6 ? cosLat : 1e-6);

      if (nextLon > Math.PI) nextLon -= TWO_PI;
      else if (nextLon < -Math.PI) nextLon += TWO_PI;

      const travelled = legDone[i] + speed[i] * dt;

      // Retire: leg finished, wandered into the polar cap, or — for ships and
      // ground vehicles — crossed the coastline.
      if (
        travelled >= legTotal[i] ||
        nextLat > MAX_LAT ||
        nextLat < -MAX_LAT ||
        (checkDomain && mask.isOcean(nextLon, nextLat) !== wantOcean)
      ) {
        this.#despawnAt(kind, a);
        continue;
      }

      lat[i] = nextLat;
      lon[i] = nextLon;
      legDone[i] = travelled;

      // Inlined WGS84 cartographic -> cartesian. Cartesian3.fromRadians does
      // the same arithmetic behind a scratch object; at this call volume the
      // indirection shows up in the profile.
      const nextCosLat = Math.cos(nextLat);
      const nx = nextCosLat * Math.cos(nextLon);
      const ny = nextCosLat * Math.sin(nextLon);
      const nz = Math.sin(nextLat);
      let kx = RSQ_X * nx;
      let ky = RSQ_X * ny;
      let kz = RSQ_Z * nz;
      const gamma = Math.sqrt(nx * kx + ny * ky + nz * kz);
      kx /= gamma;
      ky /= gamma;
      kz /= gamma;
      const height = alt[i] + renderOffset;
      px[i] = kx + nx * height;
      py[i] = ky + ny * height;
      pz[i] = kz + nz * height;
    }
  }

  #stepSatellites(dt) {
    const group = this.groups[SATELLITE];
    const slots = group.slots;
    const phase = this.phase;
    const meanMotion = this.meanMotion;
    const orbitRadius = this.orbitRadius;
    const cosRaan = this.cosRaan;
    const sinRaan = this.sinRaan;
    const cosInc = this.cosInc;
    const sinInc = this.sinInc;
    const legDone = this.legDone;
    const legTotal = this.legTotal;
    const speed = this.speed;
    const px = this.px;
    const py = this.py;
    const pz = this.pz;

    for (let a = group.count - 1; a >= 0; a--) {
      const i = slots[a];

      const travelled = legDone[i] + speed[i] * dt;
      if (travelled >= legTotal[i]) {
        this.#despawnAt(SATELLITE, a);
        continue;
      }
      legDone[i] = travelled;

      let u = phase[i] + meanMotion[i] * dt;
      if (u > TWO_PI) u -= TWO_PI;
      phase[i] = u;

      const cu = Math.cos(u);
      const su = Math.sin(u);
      const r = orbitRadius[i];
      px[i] = r * (cosRaan[i] * cu - sinRaan[i] * su * cosInc[i]);
      py[i] = r * (sinRaan[i] * cu + cosRaan[i] * su * cosInc[i]);
      pz[i] = r * (su * sinInc[i]);
    }
  }

  // ------------------------------------------------------------ live edits

  setTarget(kind, value) {
    this.targets[kind] = Math.max(0, Math.min(MAX_PER_KIND, Math.round(value)));
  }

  /**
   * Speed and leg-length changes apply to movers spawned from now on. Rewriting
   * 200k derived velocity vectors mid-drag would stall the frame, and the churn
   * turns the whole population over within a leg anyway.
   */
  setSpeed(kind, value) {
    this.speeds[kind] = value;
  }

  setLegKm(kind, km) {
    this.legs[kind] = km * 1000;
  }

  // -------------------------------------------------------------- reporting

  /** Everything the info box shows for one mover. Called for a single selection, never in bulk. */
  describe(slot) {
    const kind = this.kind[slot];
    const config = KINDS[kind];
    const isSatellite = kind === SATELLITE;

    let lonDeg;
    let latDeg;
    let altitudeM;
    if (isSatellite) {
      // Orbits are integrated in cartesian, so geodetic position is derived
      // here rather than stored.
      const [lon, lat] = cartesianToGeodetic(this.px[slot], this.py[slot], this.pz[slot]);
      lonDeg = lon * DEG;
      latDeg = lat * DEG;
      altitudeM = this.alt[slot];
    } else {
      lonDeg = this.lon[slot] * DEG;
      latDeg = this.lat[slot] * DEG;
      altitudeM = this.alt[slot];
    }

    return {
      slot,
      generation: this.gen[slot],
      kind,
      kindId: config.id,
      kindLabel: config.singular,
      color: config.color,
      callsign: callsign(kind, this.seed[slot]),
      longitude: lonDeg,
      latitude: latDeg,
      altitudeM,
      speedMs: this.speed[slot],
      headingDeg: isSatellite ? null : (this.heading[slot] * DEG + 360) % 360,
      inclinationDeg: isSatellite ? this.inclination[slot] * DEG : null,
      raanDeg: isSatellite ? this.raan[slot] * DEG : null,
      periodMin: isSatellite ? TWO_PI / this.meanMotion[slot] / 60 : null,
      legTotalM: this.legTotal[slot],
      legDoneM: this.legDone[slot],
      ageS: this.time - this.bornAt[slot],
    };
  }

  /**
   * Samples the mover's remaining leg as world positions, for the track line
   * drawn next to a selection.
   *
   * @returns {number[][]} triples of [x, y, z]
   */
  trackAhead(slot, segments = 48) {
    const kind = this.kind[slot];
    if (kind === SATELLITE) return this.orbitPath(slot, 128);

    const remaining = Math.max(0, this.legTotal[slot] - this.legDone[slot]);
    const out = [];
    let lon = this.lon[slot];
    let lat = this.lat[slot];
    const stepDistance = remaining / segments;
    const dLat = (stepDistance * Math.cos(this.heading[slot])) / MEAN_RADIUS;
    const dLon = (stepDistance * Math.sin(this.heading[slot])) / MEAN_RADIUS;
    const height = this.alt[slot] + (kind === PLANE ? 0 : SURFACE_RENDER_OFFSET_M);

    for (let s = 0; s <= segments; s++) {
      out.push(geodeticToCartesian(lon, lat, height));
      lat += dLat;
      const cosLat = Math.cos(lat);
      lon += dLon / (Math.abs(cosLat) > 1e-6 ? cosLat : 1e-6);
      if (lat > HALF_PI || lat < -HALF_PI) break;
    }
    return out;
  }

  /** The satellite's full circular orbit, which is static in this Earth-fixed model. */
  orbitPath(slot, segments = 128) {
    const out = [];
    const r = this.orbitRadius[slot];
    const cr = this.cosRaan[slot];
    const sr = this.sinRaan[slot];
    const ci = this.cosInc[slot];
    const si = this.sinInc[slot];
    for (let s = 0; s <= segments; s++) {
      const u = (s / segments) * TWO_PI;
      const cu = Math.cos(u);
      const su = Math.sin(u);
      out.push([r * (cr * cu - sr * su * ci), r * (sr * cu + cr * su * ci), r * (su * si)]);
    }
    return out;
  }
}

// ---------------------------------------------------------------- helpers

function geodeticToCartesian(lon, lat, height) {
  const cosLat = Math.cos(lat);
  const nx = cosLat * Math.cos(lon);
  const ny = cosLat * Math.sin(lon);
  const nz = Math.sin(lat);
  let kx = RSQ_X * nx;
  let ky = RSQ_X * ny;
  let kz = RSQ_Z * nz;
  const gamma = Math.sqrt(nx * kx + ny * ky + nz * kz);
  return [kx / gamma + nx * height, ky / gamma + ny * height, kz / gamma + nz * height];
}

/** Spherical is close enough for the read-out on a satellite 700 km up. */
function cartesianToGeodetic(x, y, z) {
  return [Math.atan2(y, x), Math.atan2(z, Math.sqrt(x * x + y * y))];
}

const SHIP_NAMES = ['HORIZON', 'MERIDIAN', 'ALBATROSS', 'NORTHERN STAR', 'KESTREL', 'ARGO', 'TIDEWATER', 'CORMORANT'];
const AIRLINES = ['NDL', 'AKX', 'VRT', 'CPA', 'HLO', 'ZQR', 'MTA', 'FJT'];
const FLEETS = ['LOGI', 'HAUL', 'RELAY', 'DEPOT', 'CONVOY', 'RANGER'];
const SAT_SERIES = ['ORCA', 'VESTA', 'PALLAS', 'JUNO', 'LYRA', 'CIRRUS'];

/**
 * A stable, plausible-looking identifier derived from the mover's seed, so the
 * info box has something to call it without storing 200k strings.
 */
function callsign(kind, seed) {
  const pick = (list, shift) => list[(seed >>> shift) % list.length];
  const digits = (count, shift) => String(((seed >>> shift) % 10 ** count) + 10 ** count).slice(1);

  switch (kind) {
    case SHIP:
      return `MV ${pick(SHIP_NAMES, 3)} ${digits(3, 11)}`;
    case PLANE:
      return `${pick(AIRLINES, 3)}${digits(3, 11)}`;
    case GROUND:
      return `${pick(FLEETS, 3)}-${digits(4, 9)}`;
    default:
      return `${pick(SAT_SERIES, 3)}-${digits(3, 11)}`;
  }
}
