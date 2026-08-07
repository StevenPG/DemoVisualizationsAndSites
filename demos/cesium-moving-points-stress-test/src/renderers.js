/**
 * The two things being compared.
 *
 * Both expose the same tiny interface — attach(slot), detach(slot), sync(sim) —
 * so main.js can swap one for the other without knowing which is running, and
 * the HUD is measuring the same call in both cases.
 *
 *   PointRenderer   one PointPrimitiveCollection, one draw call for the whole
 *                   population, positions written straight into the collection.
 *
 *   EntityRenderer  one Entity per mover through the entity layer, moved via
 *                   ConstantPositionProperty.setValue(). Worth being precise
 *                   about: this is the *fast* way to move an entity. Assigning
 *                   `entity.position = cartesian` each frame — the way most
 *                   people first write it — allocates a fresh property object
 *                   per mover per frame and is dramatically worse again. What
 *                   this measures is the floor of the Entity API, not a
 *                   strawman.
 *
 * Neither renderer removes anything when a mover retires; it sets `show = false`
 * and keeps the slot's primitive for the next tenant. At the churn rates this
 * demo runs at, add/remove traffic would dominate the measurement.
 */

import * as Cesium from 'cesium';
import { KINDS } from './config.js';

const KIND_COLORS = KINDS.map((kind) => Cesium.Color.fromCssColorString(kind.color));
const scratch = new Cesium.Cartesian3();

export class PointRenderer {
  constructor(scene, pointSize) {
    this.name = 'primitives';
    this.scene = scene;
    this.pointSize = pointSize;
    // OPAQUE lets Cesium skip the depth sort and the translucent pass — the
    // single biggest free win available to a point collection this size.
    this.collection = scene.primitives.add(
      new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.OPAQUE }),
    );
    /** @type {Cesium.PointPrimitive[]} slot -> primitive */
    this.pool = [];
  }

  /** Real primitives held, not the pool array's length — slots leave holes in it. */
  get poolSize() {
    return this.collection.length;
  }

  set show(value) {
    this.collection.show = value;
  }

  attach(slot, kind) {
    let point = this.pool[slot];
    if (point === undefined) {
      point = this.collection.add({
        // The slot index is the pick id. A number, not an object, because
        // 200k little `{slot}` wrappers is 200k things to garbage collect.
        id: slot,
        position: Cesium.Cartesian3.ZERO,
        pixelSize: this.pointSize,
        color: KIND_COLORS[kind],
      });
      this.pool[slot] = point;
      return;
    }
    point.color = KIND_COLORS[kind];
    point.pixelSize = this.pointSize;
    point.show = true;
  }

  detach(slot) {
    const point = this.pool[slot];
    if (point) point.show = false;
  }

  sync(sim) {
    const { px, py, pz } = sim;
    const pool = this.pool;
    for (const group of sim.groups) {
      const slots = group.slots;
      for (let a = 0; a < group.count; a++) {
        const i = slots[a];
        const point = pool[i];
        if (point === undefined) continue;
        scratch.x = px[i];
        scratch.y = py[i];
        scratch.z = pz[i];
        point.position = scratch;
      }
    }
  }

  setPointSize(size) {
    this.pointSize = size;
    for (const point of this.pool) if (point) point.pixelSize = size;
  }

  /** Drops every primitive, so the collection stops paying for retired slots. */
  clear() {
    this.collection.removeAll();
    this.pool = [];
  }
}

export class EntityRenderer {
  constructor(viewer, pointSize) {
    this.name = 'entities';
    this.viewer = viewer;
    this.pointSize = pointSize;
    /** @type {{entity: Cesium.Entity, position: Cesium.ConstantPositionProperty}[]} */
    this.pool = [];
    // Counted rather than derived from pool.length: slots are recycled out of
    // order, so the pool array is sparse and its length is a high-water mark
    // rather than a population.
    this.created = 0;
  }

  get poolSize() {
    return this.created;
  }

  set show(value) {
    for (const held of this.pool) if (held) held.entity.show = value && held.live;
  }

  attach(slot, kind) {
    let held = this.pool[slot];
    if (held === undefined) {
      const position = new Cesium.ConstantPositionProperty(new Cesium.Cartesian3());
      const entity = this.viewer.entities.add({
        position,
        point: new Cesium.PointGraphics({
          pixelSize: this.pointSize,
          color: KIND_COLORS[kind],
        }),
      });
      // Picking hands back the Entity, so the way home to the simulation has to
      // live on the entity itself.
      entity.movingPointSlot = slot;
      held = { entity, position, live: true };
      this.pool[slot] = held;
      this.created++;
      return;
    }
    held.entity.point.color = KIND_COLORS[kind];
    held.entity.point.pixelSize = this.pointSize;
    held.entity.show = true;
    held.live = true;
  }

  detach(slot) {
    const held = this.pool[slot];
    if (held) {
      held.entity.show = false;
      held.live = false;
    }
  }

  sync(sim) {
    const { px, py, pz } = sim;
    const pool = this.pool;
    for (const group of sim.groups) {
      const slots = group.slots;
      for (let a = 0; a < group.count; a++) {
        const i = slots[a];
        const held = pool[i];
        if (held === undefined) continue;
        scratch.x = px[i];
        scratch.y = py[i];
        scratch.z = pz[i];
        held.position.setValue(scratch);
      }
    }
  }

  setPointSize(size) {
    this.pointSize = size;
    for (const held of this.pool) if (held) held.entity.point.pixelSize = size;
  }

  clear() {
    // One event per removal would be 200k notifications through the collection's
    // change machinery before anything else got a chance to run.
    this.viewer.entities.suspendEvents();
    for (const held of this.pool) if (held) this.viewer.entities.remove(held.entity);
    this.viewer.entities.resumeEvents();
    this.pool = [];
    this.created = 0;
  }
}

/**
 * Populates a renderer from the current live population — used when switching
 * modes, where every mover has to be handed to the new renderer at once.
 *
 * This is the expensive moment in Entity mode and it is meant to be: the pause
 * you feel here is the cost of constructing tens of thousands of entities, and
 * it is part of the answer to "can I just use entities for this".
 */
export function attachAll(renderer, sim) {
  const suspend = renderer instanceof EntityRenderer;
  if (suspend) renderer.viewer.entities.suspendEvents();
  for (const group of sim.groups) {
    for (let a = 0; a < group.count; a++) {
      const slot = group.slots[a];
      renderer.attach(slot, sim.kind[slot]);
    }
  }
  if (suspend) renderer.viewer.entities.resumeEvents();
}
