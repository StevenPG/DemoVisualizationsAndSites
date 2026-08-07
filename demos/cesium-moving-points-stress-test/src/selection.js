/**
 * Clicking a point promotes it to a real Entity.
 *
 * The population is deliberately not made of entities — that is the thing being
 * measured — so a picked mover has no identity beyond an integer slot. This
 * builds one Entity on demand for the mover under the cursor: a pin billboard,
 * a label, its track, and a description table that Cesium's info box renders.
 * The underlying point is hidden for as long as the selection lasts and comes
 * back when it is dismissed.
 *
 * The one genuinely fiddly part is lifetime. Slots are recycled, so a selection
 * that outlived its mover would silently start reporting a different vehicle
 * that happens to have moved into the same slot. Every selection therefore
 * records the generation counter it saw, and is dropped the moment that stops
 * matching.
 */

import * as Cesium from 'cesium';
import { KINDS, SATELLITE } from './config.js';
import { PIN_ICONS } from './icons.js';

/** Rebuilding the description string every frame would rewrite the info box iframe every frame. */
const DESCRIPTION_INTERVAL_MS = 250;
const TRACK_INTERVAL_MS = 400;

export class Selection {
  /**
   * @param {Cesium.Viewer} viewer
   * @param {import('./simulation.js').Simulation} sim
   * @param {() => {attach: Function, detach: Function}} getRenderer Active renderer, which changes under us.
   */
  constructor(viewer, sim, getRenderer) {
    this.viewer = viewer;
    this.sim = sim;
    this.getRenderer = getRenderer;

    this.slot = -1;
    this.generation = -1;
    this.entity = null;
    /** @type {(message: string|null) => void} */
    this.onChange = () => {};

    this.suppressChangeHandler = false;
    this.scratch = new Cesium.Cartesian3();

    // Replace the viewer's own left-click handler rather than adding a second
    // one. Cesium's default picks the scene, finds an integer id where it wants
    // an Entity, and clears the selection — so leaving it in place would mean
    // two full pick passes per click and a visible flicker as it deselected
    // whatever we had just selected.
    viewer.screenSpaceEventHandler.setInputAction(
      (click) => this.#onClick(click),
      Cesium.ScreenSpaceEventType.LEFT_CLICK,
    );

    // Dismissing via the info box's X, or by clicking empty space, comes through
    // here rather than through our own click handler.
    viewer.selectedEntityChanged.addEventListener((entity) => {
      if (this.suppressChangeHandler) return;
      if (entity !== this.entity) this.clear();
    });
  }

  get active() {
    return this.slot >= 0;
  }

  #onClick(click) {
    const picked = this.viewer.scene.pick(click.position);

    // The pin, its label and its track all pick as the selection's own entity.
    // Clicking them should not dismiss what they are pointing at.
    if (picked && picked.id === this.entity) return;

    const slot = resolveSlot(picked);
    if (slot === null) {
      this.clear();
      return;
    }
    if (slot === this.slot && this.#stillAlive()) return;
    this.select(slot);
  }

  select(slot) {
    this.clear();

    const sim = this.sim;
    this.slot = slot;
    this.generation = sim.gen[slot];

    const kind = sim.kind[slot];
    const config = KINDS[kind];
    const color = Cesium.Color.fromCssColorString(config.color);

    // Hide the primitive the pin is standing in for, so the two do not overlap.
    this.getRenderer().detach(slot);

    let descriptionAt = 0;
    let descriptionCache = '';
    let trackAt = 0;
    let trackCache = [];

    this.entity = this.viewer.entities.add({
      name: sim.describe(slot).callsign,
      position: new Cesium.CallbackProperty(() => {
        if (!this.#stillAlive()) return undefined;
        this.scratch.x = sim.px[slot];
        this.scratch.y = sim.py[slot];
        this.scratch.z = sim.pz[slot];
        return this.scratch;
      }, false),
      billboard: {
        image: PIN_ICONS[kind],
        width: 33,
        height: 43.5,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        // A nudge toward the camera, so a pin on a ground vehicle is not half
        // swallowed by the hill it is standing on.
        eyeOffset: new Cesium.Cartesian3(0, 0, -2500),
      },
      label: {
        text: sim.describe(slot).callsign,
        font: '600 13px ui-monospace, SFMono-Regular, Menlo, monospace',
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('rgba(6, 12, 24, 0.82)'),
        backgroundPadding: new Cesium.Cartesian2(7, 5),
        verticalOrigin: Cesium.VerticalOrigin.TOP,
        pixelOffset: new Cesium.Cartesian2(0, 8),
        eyeOffset: new Cesium.Cartesian3(0, 0, -2500),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          if (!this.#stillAlive()) return trackCache;
          const now = performance.now();
          if (now - trackAt > TRACK_INTERVAL_MS) {
            trackAt = now;
            trackCache = sim.trackAhead(slot).map(([x, y, z]) => new Cesium.Cartesian3(x, y, z));
          }
          return trackCache;
        }, false),
        width: 2,
        // The positions are already a dense cartesian polyline; letting Cesium
        // re-interpolate them as geodesics would bend a satellite's orbit down
        // onto the surface.
        arcType: Cesium.ArcType.NONE,
        material:
          kind === SATELLITE
            ? new Cesium.PolylineDashMaterialProperty({ color, dashLength: 12 })
            : new Cesium.ColorMaterialProperty(color.withAlpha(0.85)),
      },
      description: new Cesium.CallbackProperty(() => {
        const now = performance.now();
        if (now - descriptionAt > DESCRIPTION_INTERVAL_MS) {
          descriptionAt = now;
          descriptionCache = this.#stillAlive()
            ? describeHtml(sim.describe(slot))
            : '<p>This mover finished its leg and was retired.</p>';
        }
        return descriptionCache;
      }, false),
    });

    this.suppressChangeHandler = true;
    this.viewer.selectedEntity = this.entity;
    this.suppressChangeHandler = false;

    this.onChange(`${sim.describe(slot).callsign} · ${config.singular.toLowerCase()} · slot ${slot}`);
  }

  clear() {
    if (this.slot < 0) return;

    const slot = this.slot;
    const wasAlive = this.#stillAlive();
    this.slot = -1;
    this.generation = -1;

    if (this.entity) {
      this.viewer.entities.remove(this.entity);
      this.entity = null;
    }
    this.suppressChangeHandler = true;
    this.viewer.selectedEntity = undefined;
    this.suppressChangeHandler = false;

    // Only hand the point back if the mover it belonged to is still there.
    if (wasAlive) this.getRenderer().attach(slot, this.sim.kind[slot]);
    this.onChange(null);
  }

  /** Called every frame: drops the selection when its mover retires. */
  update() {
    if (this.slot >= 0 && !this.#stillAlive()) {
      const lost = this.entity?.name ?? 'track';
      this.clear();
      this.onChange(`${lost} completed its leg — selection cleared`);
    }
  }

  /** Re-hides the selected point after a renderer swap, which reattaches everything. */
  reapplyTo(renderer) {
    if (this.slot >= 0) renderer.detach(this.slot);
  }

  #stillAlive() {
    return this.slot >= 0 && this.sim.gen[this.slot] === this.generation;
  }
}

/**
 * Turns whatever `scene.pick` returned into a slot index.
 *
 * Point mode hands back a PointPrimitive whose id is the slot integer; entity
 * mode hands back the Entity, which carries the slot as a property. Anything
 * else — terrain, the selected pin itself, a label — is not a mover.
 */
function resolveSlot(picked) {
  if (!picked) return null;
  if (typeof picked.id === 'number') return picked.id;
  if (picked.id?.movingPointSlot !== undefined) return picked.id.movingPointSlot;
  return null;
}

// ------------------------------------------------------------------- markup

const nf = (value, digits = 0) =>
  value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

function describeHtml(d) {
  const rows = [
    ['Type', d.kindLabel],
    ['Callsign', d.callsign],
    ['Latitude', `${nf(d.latitude, 4)}°`],
    ['Longitude', `${nf(d.longitude, 4)}°`],
  ];

  if (d.kind === SATELLITE) {
    rows.push(
      ['Orbit altitude', `${nf(d.altitudeM / 1000, 1)} km`],
      ['Orbital speed', `${nf(d.speedMs / 1000, 2)} km/s`],
      ['Inclination', `${nf(d.inclinationDeg, 1)}°`],
      ['RAAN', `${nf(d.raanDeg, 1)}°`],
      ['Period', `${nf(d.periodMin, 1)} min`],
    );
  } else {
    rows.push(
      ['Altitude', d.altitudeM >= 1000 ? `${nf(d.altitudeM / 1000, 2)} km` : `${nf(d.altitudeM, 0)} m`],
      ['Speed', `${nf(d.speedMs, 1)} m/s · ${nf(d.speedMs * 1.94384, 0)} kn`],
      ['Heading', `${nf(d.headingDeg, 0)}° ${compass(d.headingDeg)}`],
    );
  }

  const progress = d.legTotalM > 0 ? (d.legDoneM / d.legTotalM) * 100 : 0;
  rows.push(
    ['Leg', `${nf(d.legDoneM / 1000, 0)} / ${nf(d.legTotalM / 1000, 0)} km (${nf(progress, 0)}%)`],
    ['Remaining', `${nf(Math.max(0, d.legTotalM - d.legDoneM) / 1000, 0)} km`],
    ['Age', `${nf(d.ageS, 0)} s of simulated time`],
    ['Slot', `#${d.slot} · generation ${d.generation}`],
  );

  return (
    `<table class="cesium-infoBox-defaultTable"><tbody>` +
    rows.map(([label, value]) => `<tr><th>${label}</th><td>${value}</td></tr>`).join('') +
    `</tbody></table>` +
    `<p style="opacity:.7;margin-top:8px">Promoted from a point primitive on click. ` +
    `Slot and generation are the simulation's own identifiers — the generation changes when the slot is reused.</p>`
  );
}

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = (deg) => POINTS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
