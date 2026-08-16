/**
 * The board itself: terrain, castles and walls, as extruded geometry.
 *
 * Every hex is a hexagonal prism built by hand rather than by PolygonGeometry.
 * That is not premature optimisation — PolygonGeometry triangulates, projects
 * and re-projects each polygon, and 880 of them cost several seconds on load
 * for a shape whose thirty vertices are known in closed form. Writing them out
 * directly puts board construction under a tenth of a second.
 *
 * All 880 prisms go into a single Primitive with per-instance colour, so the
 * whole board is a handful of draw calls and any individual hex can still be
 * picked and re-tinted through its instance attributes.
 */

import * as Cesium from 'cesium';
import { RELIEF, SIEGE, TERRAIN } from '../config.js';
import { CORNER_OFFSETS, HEX_CIRCUMRADIUS, HEX_COUNT, centreMeters, edgeEndpointsMeters } from '../hex.js';
import { BASE_HEIGHT, colourFromHex, hexCentre, hexCorners, hexHeight } from './geo.js';

const WALL_HEIGHT = 620;
const WALL_THICKNESS = 260;

// --------------------------------------------------------------------------
// Terrain
// --------------------------------------------------------------------------

export function createBoard(scene, frame, map, theatre, { alpha = RELIEF.tileAlpha } = {}) {
  const up = localDirection(frame, 0, 0, 1);
  // Every hex is the same shape, so the six outward face normals are computed
  // once for the whole board rather than per prism.
  const sideNormals = CORNER_OFFSETS.map((_, i) => {
    const angle = (Math.PI / 180) * 60 * i;
    return localDirection(frame, Math.cos(angle), Math.sin(angle), 0);
  });

  const baseColours = new Array(HEX_COUNT);
  const instances = new Array(HEX_COUNT);
  const pickIds = new Array(HEX_COUNT);

  for (let i = 0; i < HEX_COUNT; i += 1) {
    const colour = terrainColour(map, theatre, i, alpha);
    baseColours[i] = colour;
    pickIds[i] = { kind: 'hex', index: i };
    instances[i] = new Cesium.GeometryInstance({
      geometry: hexPrism(frame, i, hexHeight(map, i), up, sideNormals),
      attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(colour) },
      id: pickIds[i],
    });
  }

  const outlines = impassableOutlines(scene, frame, map);

  const primitive = scene.primitives.add(
    new Cesium.Primitive({
      geometryInstances: instances,
      // `closed` stays true with translucency on: culling the back faces means
      // a tile blends over the imagery beneath it rather than over the inside
      // of its own far walls, which is what keeps it reading as ground rather
      // than as a glass box.
      appearance: new Cesium.PerInstanceColorAppearance({ flat: false, translucent: true, closed: true }),
      asynchronous: false,
      // Required so instance attributes stay addressable for re-tinting.
      releaseGeometryInstances: false,
      // A translucent tile still casts a solid shadow, which is the right call:
      // the relief is only legible because the sun is low and the ridges throw
      // long shadows across the board.
      shadows: Cesium.ShadowMode.ENABLED,
    }),
  );

  /** Tint a hex, or pass null to put it back to its terrain colour. */
  const tint = (index, colour) => {
    const attributes = primitive.getGeometryInstanceAttributes(pickIds[index]);
    if (!attributes) return;
    attributes.color = Cesium.ColorGeometryInstanceAttribute.toValue(colour ?? baseColours[index]);
  };

  let tinted = [];
  const setTinted = (entries) => {
    for (const index of tinted) tint(index, null);
    tinted = entries.map(({ index, colour }) => {
      tint(index, colour);
      return index;
    });
    scene.requestRender();
  };

  return {
    primitive,
    pickIds,
    tint,
    setTinted,
    clearTint: () => setTinted([]),
    /** The terrain colour a hex returns to, so overlays can blend into it. */
    baseColourAt: (index) => baseColours[index],
    /**
     * Change how much of the real ground shows through, live.
     *
     * How this reads depends entirely on the imagery underneath, which varies
     * by theatre and by how built-up the ground happens to be, so it is a
     * setting rather than a constant. Clears every tint on the way through —
     * the caller refreshes afterwards and the highlights are recomputed against
     * the new base colours.
     */
    setAlpha: (next) => {
      for (let i = 0; i < HEX_COUNT; i += 1) {
        baseColours[i] = terrainColour(map, theatre, i, next);
        tint(i, null);
      }
      tinted = [];
      scene.requestRender();
    },
    destroy: () => {
      scene.primitives.remove(primitive);
      outlines.destroy();
    },
  };
}

/**
 * A dark rim around every hex an army cannot enter.
 *
 * Colour alone was carrying this, and it could not: a mountain is a brown tile
 * among brown tiles and a river is a blue one, and neither says "you may not
 * go here" from a camera 40 km up. An outline does, and it does it without
 * spending any of the palette, which the terrain types already use up.
 */
function impassableOutlines(scene, frame, map) {
  const collection = scene.primitives.add(new Cesium.PolylineCollection());
  const ink = Cesium.Color.fromCssColorString('#0d1013').withAlpha(0.9);

  for (let i = 0; i < HEX_COUNT; i += 1) {
    if (TERRAIN[map.terrain[i]].passable) continue;
    // Lifted clear of the tile top so it does not fight with it for depth.
    const ring = hexCorners(frame, i, hexHeight(map, i) + 22);
    collection.add({
      positions: [...ring, ring[0]],
      width: 2.5,
      material: Cesium.Material.fromType('Color', { color: ink }),
    });
  }

  return { destroy: () => scene.primitives.remove(collection) };
}

/**
 * Terrain colour, varied per hex. Flat fills read as a spreadsheet from above;
 * modulating lightness by the same elevation field that chose the terrain gives
 * the board grain, and makes higher ground read as higher even where two
 * neighbours share a type.
 */
function terrainColour(map, theatre, index, alpha) {
  const base = Cesium.Color.fromCssColorString(theatre.palette[map.terrain[index]]);
  const variation = (map.elevation[index] - 0.5) * 0.22;
  const shade = 1 + variation;
  return new Cesium.Color(
    Math.min(1, base.red * shade),
    Math.min(1, base.green * shade),
    Math.min(1, base.blue * shade),
    alpha,
  );
}

/**
 * A hexagonal prism: six top vertices and six side quads, with flat normals so
 * the top face and each wall shade independently. Vertices are not shared
 * between faces — thirty of them is nothing, and sharing would average the
 * normals and round off the silhouette the whole look depends on.
 */
function hexPrism(frame, index, topHeight, up, sideNormals) {
  const centre = centreMeters(index);
  const top = CORNER_OFFSETS.map((offset) =>
    frame.toCartesian(centre.x + offset.x, centre.y + offset.y, topHeight),
  );
  const bottom = CORNER_OFFSETS.map((offset) =>
    frame.toCartesian(centre.x + offset.x, centre.y + offset.y, BASE_HEIGHT),
  );

  const positions = new Float64Array(30 * 3);
  const normals = new Float32Array(30 * 3);
  const indices = new Uint16Array(16 * 3);

  const writeVertex = (slot, point, normal) => {
    positions[slot * 3] = point.x;
    positions[slot * 3 + 1] = point.y;
    positions[slot * 3 + 2] = point.z;
    normals[slot * 3] = normal.x;
    normals[slot * 3 + 1] = normal.y;
    normals[slot * 3 + 2] = normal.z;
  };

  for (let i = 0; i < 6; i += 1) writeVertex(i, top[i], up);

  // Top face as a fan. The corner offsets run anticlockwise seen from above,
  // which is the winding Cesium treats as front-facing.
  let at = 0;
  for (let i = 1; i < 5; i += 1) {
    indices[at++] = 0;
    indices[at++] = i;
    indices[at++] = i + 1;
  }

  for (let i = 0; i < 6; i += 1) {
    const next = (i + 1) % 6;
    const slot = 6 + i * 4;
    const normal = sideNormals[i];
    writeVertex(slot, top[i], normal);
    writeVertex(slot + 1, top[next], normal);
    writeVertex(slot + 2, bottom[next], normal);
    writeVertex(slot + 3, bottom[i], normal);

    // Wound (a, c, b) / (a, d, c): taking the corners in order and dropping
    // down the face produces an inward normal, so the two triangles are
    // reversed to face out.
    indices[at++] = slot;
    indices[at++] = slot + 2;
    indices[at++] = slot + 1;
    indices[at++] = slot;
    indices[at++] = slot + 3;
    indices[at++] = slot + 2;
  }

  return new Cesium.Geometry({
    attributes: {
      position: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.DOUBLE,
        componentsPerAttribute: 3,
        values: positions,
      }),
      normal: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 3,
        values: normals,
      }),
    },
    indices,
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: Cesium.BoundingSphere.fromPoints([...top, ...bottom]),
  });
}

/** A direction in the board's local frame, as an ECEF unit vector. */
function localDirection(frame, x, y, z) {
  const vector = Cesium.Matrix4.multiplyByPointAsVector(
    frame.toFixed,
    new Cesium.Cartesian3(x, y, z),
    new Cesium.Cartesian3(),
  );
  return Cesium.Cartesian3.normalize(vector, vector);
}

// --------------------------------------------------------------------------
// Castles
// --------------------------------------------------------------------------

/**
 * A castle is a circle on the board, as the brief asks: a round keep inside a
 * lower curtain wall, both in the owning side's colour. The keep's height
 * tracks the garrison, so a castle being starved visibly sinks — the siege is
 * legible from the board without reading a number.
 */
export function createCastles(scene, frame, map, state) {
  const primitives = new Cesium.PrimitiveCollection();
  scene.primitives.add(primitives);
  let current = null;
  let signature = null;

  const rebuild = () => {
    // The keep's height tracks the garrison, so that plus the owner is the
    // whole of what the geometry depends on.
    const next = ['crown', 'marcher']
      .map((key) => `${Math.round(state.sides[key].garrison)}:${state.sides[key].castle}`)
      .join('|');
    if (next === signature && current) return;
    signature = next;

    if (current) primitives.remove(current);
    const instances = [];

    for (const key of ['crown', 'marcher']) {
      const side = state.sides[key];
      const ground = hexHeight(map, side.castle);
      const colours = side.colours;
      const fraction = Math.max(0.12, side.garrison / SIEGE.garrisonMax);

      instances.push(
        cylinder(frame, side.castle, {
          radius: HEX_CIRCUMRADIUS * 0.82,
          base: ground,
          height: 150,
          colour: colourFromHex(colours.dark),
        }),
        cylinder(frame, side.castle, {
          radius: HEX_CIRCUMRADIUS * 0.5,
          base: ground + 150,
          height: 180 + 620 * fraction,
          colour: colourFromHex(colours.primary),
        }),
      );
    }

    current = primitives.add(
      new Cesium.Primitive({
        geometryInstances: instances,
        appearance: new Cesium.PerInstanceColorAppearance({ flat: false, translucent: false, closed: true }),
        asynchronous: false,
        shadows: Cesium.ShadowMode.ENABLED,
      }),
    );
    scene.requestRender();
  };

  rebuild();
  return { rebuild, destroy: () => scene.primitives.remove(primitives) };
}

function cylinder(frame, hex, { radius, base, height, colour }) {
  const centre = hexCentre(frame, hex, base + height / 2);
  return new Cesium.GeometryInstance({
    geometry: new Cesium.CylinderGeometry({
      length: height,
      topRadius: radius * 0.86,
      bottomRadius: radius,
      vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
    }),
    modelMatrix: Cesium.Transforms.eastNorthUpToFixedFrame(centre),
    attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(colour) },
    id: { kind: 'castle', hex },
  });
}

// --------------------------------------------------------------------------
// Walls
// --------------------------------------------------------------------------

/**
 * Walls sit on the edge between two hexes, so they are drawn as a thin box
 * straddling that boundary and rising from the lower of the two hexes. A
 * damaged wall is drawn shorter, which is the only cue needed to tell a segment
 * that will fall next turn from a fresh one.
 */
export function createWalls(scene, frame, map, state) {
  const primitives = new Cesium.PrimitiveCollection();
  scene.primitives.add(primitives);
  let current = null;
  let signature = null;

  const rebuild = () => {
    const next = [...state.walls]
      .map(([key, wall]) => `${key}:${wall.side}:${wall.integrity}`)
      .join('|');
    if (next === signature) return;
    signature = next;

    if (current) {
      primitives.remove(current);
      current = null;
    }
    if (!state.walls.size) {
      scene.requestRender();
      return;
    }

    const instances = [];
    for (const [key, wall] of state.walls) {
      const [a, b] = [wall.from, wall.to];
      const [p, q] = edgeEndpointsMeters(a, b);
      const ground = Math.min(hexHeight(map, a), hexHeight(map, b));
      const damaged = wall.integrity / 2;
      const height = WALL_HEIGHT * (0.55 + 0.45 * damaged);

      const corners = wallFootprint(p, q);

      instances.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolygonGeometry({
            polygonHierarchy: new Cesium.PolygonHierarchy(
              corners.map((corner) => frame.toCartesian(corner.x, corner.y, 0)),
            ),
            height: ground + height,
            extrudedHeight: ground - 60,
            vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
          }),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
              colourFromHex(state.sides[wall.side].colours.dark),
            ),
          },
          id: { kind: 'wall', key },
        }),
      );
    }

    current = primitives.add(
      new Cesium.Primitive({
        geometryInstances: instances,
        appearance: new Cesium.PerInstanceColorAppearance({ flat: false, translucent: false, closed: true }),
        asynchronous: false,
        shadows: Cesium.ShadowMode.ENABLED,
      }),
    );
    scene.requestRender();
  };

  rebuild();
  return { rebuild, destroy: () => scene.primitives.remove(primitives) };
}

/**
 * The plan of a wall segment: a thin box straddling the edge, widened slightly
 * past the hex corners so neighbouring walls meet without a gap at the joint.
 */
function wallFootprint(p, q, thickness = WALL_THICKNESS) {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy * (thickness / 2);
  const ny = ux * (thickness / 2);
  const overhang = 40;

  return [
    { x: p.x - ux * overhang + nx, y: p.y - uy * overhang + ny },
    { x: q.x + ux * overhang + nx, y: q.y + uy * overhang + ny },
    { x: q.x + ux * overhang - nx, y: q.y + uy * overhang - ny },
    { x: p.x - ux * overhang - nx, y: p.y - uy * overhang - ny },
  ];
}

/**
 * Translucent stand-ins for the lines a column could wall, drawn while the
 * player is choosing one and pickable so the choice is a click on the line
 * itself.
 *
 * Walls used to be placed by clicking the *hex* on the far side of the edge you
 * wanted, which was guesswork — the edge is not a thing you can point at. Now
 * that a column can wall anything within two hexes there are up to thirty
 * candidate lines at once, and picking one off a list of hexes stopped being
 * workable at all.
 */
export function createWallGhosts(scene, frame, map, colours) {
  const primitives = new Cesium.PrimitiveCollection();
  scene.primitives.add(primitives);
  let current = null;

  const clear = () => {
    if (!current) return;
    primitives.remove(current);
    current = null;
    scene.requestRender();
  };

  const show = (targets) => {
    clear();
    if (!targets.length) return;

    const instances = targets.map(({ from, to }) => {
      const [p, q] = edgeEndpointsMeters(from, to);
      const ground = Math.min(hexHeight(map, from), hexHeight(map, to));
      const corners = wallFootprint(p, q, WALL_THICKNESS * 0.8);

      return new Cesium.GeometryInstance({
        geometry: new Cesium.PolygonGeometry({
          polygonHierarchy: new Cesium.PolygonHierarchy(
            corners.map((corner) => frame.toCartesian(corner.x, corner.y, 0)),
          ),
          height: ground + WALL_HEIGHT * 0.55,
          extrudedHeight: ground,
          vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
        }),
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(
            colourFromHex(colours.light).withAlpha(0.5),
          ),
        },
        id: { kind: 'wallGhost', from, to },
      });
    });

    current = primitives.add(
      new Cesium.Primitive({
        geometryInstances: instances,
        appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true, closed: false }),
        asynchronous: false,
      }),
    );
    scene.requestRender();
  };

  return { show, clear, destroy: () => scene.primitives.remove(primitives) };
}

export { TERRAIN };
