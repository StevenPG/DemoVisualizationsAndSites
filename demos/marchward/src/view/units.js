/**
 * Columns on the board, as billboards carrying the icons from icons.js.
 *
 * There are never more than sixteen of them, so the whole collection is rebuilt
 * whenever anything changes rather than diffed — sixteen billboards is far
 * below the point where that costs anything, and it removes a whole category of
 * bug where the board and the model quietly disagree about what is where.
 */

import * as Cesium from 'cesium';
import { hexCentre, hexHeight } from './geo.js';
import { columnIcon } from './icons.js';

/** How far above its hex an icon floats, in metres. */
const HOVER = 260;

export function createUnits(scene, frame, map, state) {
  const billboards = scene.primitives.add(new Cesium.BillboardCollection({ scene }));

  const sync = ({ selectedId = null } = {}) => {
    billboards.removeAll();

    for (const stack of state.stacks.values()) {
      const colours = state.sides[stack.side].colours;
      const spent = stack.side === state.activeSide && stack.mp <= 0 && stack.attacked;

      billboards.add({
        position: hexCentre(frame, stack.hex, hexHeight(map, stack.hex) + HOVER),
        image: columnIcon(stack, colours, { selected: stack.id === selectedId, spent }),
        id: { kind: 'unit', stackId: stack.id, hex: stack.hex },
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        // Columns are the thing you are actually playing with, so they are never
        // hidden behind a mountain the camera happens to be looking through.
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        // Tuned so an icon stays a little wider than the hex under it across
        // the whole zoom band. Slightly oversized is correct here: the troop
        // count has to stay readable, and a column you cannot read is a column
        // you cannot make a decision about.
        scaleByDistance: new Cesium.NearFarScalar(12000, 1.15, 58000, 0.42),
      });
    }

    scene.requestRender();
  };

  sync();
  return { sync, destroy: () => scene.primitives.remove(billboards) };
}

/**
 * A thin line from a selected column to the hex it is being ordered to, drawn
 * while a move is being previewed. Cheap to rebuild, so it is simply replaced
 * whenever the pointer moves to a new hex.
 */
export function createOrderLine(scene, frame, map) {
  const collection = scene.primitives.add(new Cesium.PolylineCollection());

  const show = (path, colour) => {
    collection.removeAll();
    if (path && path.length > 1) {
      collection.add({
        positions: path.map((hex) => hexCentre(frame, hex, hexHeight(map, hex) + HOVER * 0.7)),
        width: 5,
        material: Cesium.Material.fromType('PolylineArrow', {
          color: Cesium.Color.fromCssColorString(colour),
        }),
      });
    }
    scene.requestRender();
  };

  return { show, clear: () => show(null), destroy: () => scene.primitives.remove(collection) };
}
