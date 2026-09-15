/**
 * The three things being compared.
 *
 * All three expose the same tiny interface — attach(slot), detach(slot),
 * sync(sim), slotFor(picked) — so main.js can swap one for another without
 * knowing which is running, and the HUD is measuring the same call in every
 * case.
 *
 *   PointRenderer   one PointPrimitiveCollection, one draw call for the whole
 *                   population, positions written straight into the collection.
 *
 *   BufferRenderer  one BufferPointCollection: the same single draw call, but
 *                   the points live in an ArrayBuffer the collection owns
 *                   rather than as one JavaScript object each, and are reached
 *                   through a flyweight BufferPoint rebound per access. That
 *                   is the whole difference, and it is a big one at this scale
 *                   — a PointPrimitiveCollection of 600k points is 600k live
 *                   objects for the garbage collector to walk.
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
import { KINDS, MAX_TOTAL } from './config.js';

const KIND_COLORS = KINDS.map((kind) => Cesium.Color.fromCssColorString(kind.color));
const scratch = new Cesium.Cartesian3();

export class PointRenderer {
  constructor(scene, pointSize) {
    this.name = 'primitives';
    this.label = 'PointPrimitiveCollection';
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

  slotFor(picked) {
    return typeof picked.id === 'number' ? picked.id : null;
  }
}

/**
 * Everything above the point of comparison is identical to PointRenderer — one
 * collection, one draw call, positions pushed in every frame. What changes is
 * where a point lives. A BufferPointCollection keeps its points packed in
 * ArrayBuffers it owns and hands out a BufferPoint "view" that you rebind to an
 * index to read or write one, so 600k points cost 600k slots in a buffer rather
 * than 600k JavaScript objects.
 *
 * Three consequences shape this class:
 *
 *   - The buffers cannot grow, so capacity is declared up front. MAX_TOTAL is
 *     the only honest number available: slots are handed out by the simulation
 *     and it will use every one of them if the sliders are maxed.
 *   - There is no remove(). Retiring a mover hides it, which is what the other
 *     two renderers do anyway, and clear() throws the whole collection away.
 *   - A material is copied into the buffer when you call setMaterial, not
 *     referenced, so changing the point size means walking the collection and
 *     setting every material again.
 */
export class BufferRenderer {
  constructor(scene, pointSize) {
    this.name = 'buffer';
    this.label = 'BufferPointCollection';
    this.scene = scene;
    this.pointSize = pointSize;
    this.materials = KINDS.map(
      (kind) => new Cesium.BufferPointMaterial({ color: KIND_COLORS[kind.index], size: pointSize }),
    );
    // Rebound per access rather than allocated per point — the entire reason
    // this collection type exists.
    this.view = new Cesium.BufferPoint();
    this.visible = true;
    this.collection = null;
    this.slotToIndex = null;
    this.indexToSlot = null;
    this.indexKind = null;
  }

  /**
   * Built on first use, not in the constructor. Capacity is fixed at
   * construction, so this is a MAX_TOTAL-sized allocation — tens of megabytes
   * of ArrayBuffer — and a visitor who never switches renderers should not pay
   * for it.
   */
  #ensure() {
    if (this.collection) return this.collection;
    this.collection = this.scene.primitives.add(
      new Cesium.BufferPointCollection({
        show: this.visible,
        primitiveCountMax: MAX_TOTAL,
        blendOption: Cesium.BlendOption.OPAQUE,
        // Picking is what makes click-to-inspect work, and it is not free here:
        // the collection builds one pick id per point the first time it renders
        // after the population grows.
        allowPicking: true,
        // Left unset, the collection recomputes its own bounding sphere every
        // time a position changes — which for this demo is every point, every
        // frame. One sphere big enough for the globe and everything in orbit
        // above it is both cheaper and never wrong.
        boundingVolume: new Cesium.BoundingSphere(Cesium.Cartesian3.ZERO, 8_000_000),
      }),
    );
    this.slotToIndex = new Int32Array(MAX_TOTAL).fill(-1);
    this.indexToSlot = new Int32Array(MAX_TOTAL).fill(-1);
    // Which kind sits at each index, so a point size change can rewrite every
    // material without going back to the simulation for the colour.
    this.indexKind = new Uint8Array(MAX_TOTAL);
    return this.collection;
  }

  get poolSize() {
    return this.collection ? this.collection.primitiveCount : 0;
  }

  // Deliberately not ensure()d: hiding a renderer that has been cleared is how
  // a switch away from this mode ends, and allocating the buffers again to set
  // a flag on them would be an odd way to spend forty megabytes.
  set show(value) {
    this.visible = value;
    if (this.collection) this.collection.show = value;
  }

  get show() {
    return this.visible;
  }

  attach(slot, kind) {
    const collection = this.#ensure();
    const index = this.slotToIndex[slot];
    if (index === -1) {
      collection.add({ position: Cesium.Cartesian3.ZERO, material: this.materials[kind] }, this.view);
      const added = collection.primitiveCount - 1;
      this.slotToIndex[slot] = added;
      this.indexToSlot[added] = slot;
      this.indexKind[added] = kind;
      return;
    }
    collection.get(index, this.view);
    this.view.setMaterial(this.materials[kind]);
    this.view.show = true;
    this.indexKind[index] = kind;
  }

  detach(slot) {
    if (!this.collection) return;
    const index = this.slotToIndex[slot];
    if (index === -1) return;
    this.collection.get(index, this.view);
    this.view.show = false;
  }

  sync(sim) {
    const collection = this.collection;
    if (!collection) return;
    const { px, py, pz } = sim;
    const slotToIndex = this.slotToIndex;
    const view = this.view;
    for (const group of sim.groups) {
      const slots = group.slots;
      for (let a = 0; a < group.count; a++) {
        const i = slots[a];
        const index = slotToIndex[i];
        if (index === -1) continue;
        scratch.x = px[i];
        scratch.y = py[i];
        scratch.z = pz[i];
        collection.get(index, view).setPosition(scratch);
      }
    }
  }

  setPointSize(size) {
    this.pointSize = size;
    for (const material of this.materials) material.size = size;
    const collection = this.collection;
    if (!collection) return;
    // setMaterial copies, so every point that was given a material before the
    // size changed is still holding the old one.
    for (let index = 0; index < collection.primitiveCount; index++) {
      collection.get(index, this.view).setMaterial(this.materials[this.indexKind[index]]);
    }
  }

  /**
   * There is no way to hand back the buffers, so "clear" means throwing the
   * collection away and letting the next attach build a fresh one.
   */
  clear() {
    if (this.collection) {
      this.scene.primitives.remove(this.collection); // destroys it and its GPU resources
      this.collection = null;
      this.slotToIndex = null;
      this.indexToSlot = null;
      this.indexKind = null;
    }
  }

  /**
   * A buffer point has no object of its own to pick, so Cesium hands back
   * `{collection, index}` and the slot comes from our own reverse map.
   */
  slotFor(picked) {
    if (!this.collection || picked.collection !== this.collection) return null;
    const slot = this.indexToSlot[picked.index];
    return slot === undefined || slot === -1 ? null : slot;
  }
}

export class EntityRenderer {
  constructor(viewer, pointSize) {
    this.name = 'entities';
    this.label = 'Entity + PointGraphics';
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

  slotFor(picked) {
    return picked.id?.movingPointSlot ?? null;
  }

  clear() {
    // One event per removal would be 600k notifications through the collection's
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
