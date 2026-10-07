/**
 * The bridge between board metres and the globe.
 *
 * The game thinks in metres east and north of the board's centre. Cesium thinks
 * in Earth-centred Cartesian coordinates. One local east-north-up frame at the
 * theatre's centre converts between them, and because the board is only ~69 km
 * across, treating that frame as flat is accurate to well under a metre —
 * far below anything the game or the eye cares about.
 *
 * This is also what makes the distances honest: a hex is 2 km because the frame
 * is metric and anchored to a real place, not because a number was picked.
 */

import * as Cesium from 'cesium';
import { RELIEF, TERRAIN } from '../config.js';
import { CORNER_OFFSETS, boardExtentMeters, centreMeters } from '../hex.js';

const extent = boardExtentMeters();
export const BOARD_EXTENT = extent;

export function createFrame(theatre) {
  const origin = Cesium.Cartesian3.fromDegrees(theatre.centre.longitude, theatre.centre.latitude, 0);
  const toFixed = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
  const toLocal = Cesium.Matrix4.inverseTransformation(toFixed, new Cesium.Matrix4());

  /** Board metres (x east, y north, z up) to a position on the globe. */
  const toCartesian = (x, y, z = 0, result = new Cesium.Cartesian3()) =>
    Cesium.Matrix4.multiplyByPoint(
      toFixed,
      new Cesium.Cartesian3(x - extent.centreX, y - extent.centreY, z),
      result,
    );

  /** The inverse, used to work out where the camera is over the board. */
  const toBoard = (cartesian) => {
    const local = Cesium.Matrix4.multiplyByPoint(toLocal, cartesian, new Cesium.Cartesian3());
    return { x: local.x + extent.centreX, y: local.y + extent.centreY, z: local.z };
  };

  /** A direction (not a position) from ECEF into board axes. */
  const toBoardVector = (vector) => {
    const local = Cesium.Matrix4.multiplyByPointAsVector(toLocal, vector, new Cesium.Cartesian3());
    return { x: local.x, y: local.y, z: local.z };
  };

  return { origin, toFixed, toLocal, toCartesian, toBoard, toBoardVector, theatre };
}

/**
 * Height of a hex's top surface, in metres. Terrain type sets the band and the
 * generator's elevation field adds a few metres of jitter inside it, so a plain
 * reads as gently undulating ground rather than as a sheet of glass.
 */
export function hexHeight(map, index) {
  const terrain = map.terrain[index];
  const jitter = (map.elevation[index] - 0.5) * 26;
  return (RELIEF.base + RELIEF.heights[terrain] + jitter) * RELIEF.exaggeration;
}

/** Height of the base plate every prism is extruded down to. */
export const BASE_HEIGHT = 0;

/** The six corners of a hex as globe positions, at a given height. */
export function hexCorners(frame, index, height) {
  const centre = centreMeters(index);
  return CORNER_OFFSETS.map((offset) =>
    frame.toCartesian(centre.x + offset.x, centre.y + offset.y, height),
  );
}

/** Centre of a hex as a globe position, at a given height. */
export function hexCentre(frame, index, height) {
  const centre = centreMeters(index);
  return frame.toCartesian(centre.x, centre.y, height);
}

export const isPassable = (map, index) => TERRAIN[map.terrain[index]].passable;

/** Parses '#rrggbb' into a Cesium Color, with an optional alpha. */
export function colourFromHex(hex, alpha = 1) {
  return Cesium.Color.fromCssColorString(hex).withAlpha(alpha);
}
