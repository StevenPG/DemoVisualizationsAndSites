/**
 * Viewer bootstrap and the camera cage.
 *
 * Two things make a globe engine usable as a game board. The first is that the
 * camera cannot leave: it is clamped to the theatre rectangle with a margin, to
 * a zoom band that keeps the board legible, and to a pitch range that never
 * lets the view go so flat that hexes occlude each other. The second is that
 * the globe's own terrain is switched off — the board is a diorama of extruded
 * prisms sitting on the ellipsoid, and real elevation underneath it would poke
 * through the pieces.
 *
 * Imagery is keyless ESRI, same as the other Cesium demos in this repo, so
 * there is no Ion token to configure and anyone can clone and run it.
 */

import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { BOARD_EXTENT } from './geo.js';

const ESRI_IMAGERY = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';

/**
 * The imagery provider is built by fetching a service description, and Cesium
 * retries before giving up. On a network that black-holes that host rather than
 * refusing outright the await never settles, so failure is bounded and the game
 * starts on a plain-coloured globe instead of hanging on the loading screen.
 */
const PROVIDER_TIMEOUT_MS = 9000;

export const CAMERA = {
  minimumZoom: 3200,
  /** Far enough to see the whole theatre, and no further — there is nothing out there. */
  maximumZoom: 62000,
  /** Straight down is -90°; anything flatter than -32° and the prisms hide each other. */
  minPitch: Cesium.Math.toRadians(-89),
  maxPitch: Cesium.Math.toRadians(-32),
  /**
   * How far past the board edge you may look, as a fraction of the board.
   *
   * Applied to the ground point in view rather than to the camera, so it means
   * the same thing in every direction. It stays small because the bound is on
   * the centre of the screen: everything below the centre is nearer the camera
   * and therefore further past the edge again, so the margin you actually see
   * is roughly double this.
   */
  marginFraction: 0.08,
};

export async function createViewer(containerId, theatre, { shadows = true } = {}) {
  const notes = [];

  let baseLayer;
  try {
    baseLayer = new Cesium.ImageryLayer(
      await withTimeout(Cesium.ArcGisMapServerImageryProvider.fromUrl(ESRI_IMAGERY), 'ESRI imagery'),
    );
  } catch (error) {
    console.warn('[marchward] ESRI imagery unavailable:', error);
    // Cesium's own static assets already contain the Natural Earth II base
    // layer as a TMS pyramid, so a blocked network falls back to real ground
    // rather than to a flat colour — and needs no request off this origin.
    try {
      baseLayer = new Cesium.ImageryLayer(
        await Cesium.TileMapServiceImageryProvider.fromUrl(
          Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII'),
        ),
      );
      notes.push('Satellite imagery was unreachable — falling back to the offline base map.');
    } catch (fallbackError) {
      console.warn('[marchward] offline imagery unavailable too:', fallbackError);
      notes.push('Imagery was unreachable — the ground beyond the board is plain.');
      baseLayer = false;
    }
  }

  const viewer = new Cesium.Viewer(containerId, {
    baseLayer,
    // Flat ellipsoid on purpose: the board is the terrain here.
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    animation: false,
    timeline: false,
    geocoder: false,
    baseLayerPicker: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    homeButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    // A turn-based game is static between actions, so rendering on demand costs
    // nothing and saves a laptop's battery for the length of a match.
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
  });

  const scene = viewer.scene;
  scene.globe.baseColor = Cesium.Color.fromCssColorString(theatre.palette.basePlate);
  scene.globe.depthTestAgainstTerrain = true;
  scene.globe.showGroundAtmosphere = true;
  scene.globe.enableLighting = false;
  scene.skyAtmosphere.show = true;
  scene.fog.enabled = true;
  scene.fog.density = 0.00008;
  scene.highDynamicRange = false;

  // The sun is parked at a low morning angle for the theatre's own longitude.
  // A low sun is what gives the extruded terrain long shadows and readable
  // relief; leaving the clock running would drift the board into darkness
  // halfway through a match.
  viewer.clock.shouldAnimate = false;
  viewer.clock.currentTime = sunTimeFor(theatre);
  scene.light = new Cesium.SunLight();
  setShadows(viewer, shadows);

  const controller = scene.screenSpaceCameraController;
  controller.minimumZoomDistance = CAMERA.minimumZoom;
  controller.maximumZoomDistance = CAMERA.maximumZoom;
  controller.enableCollisionDetection = true;
  // Free look would let the player point the camera at the horizon and lose the
  // board entirely, and there is nothing out there to see.
  controller.enableLook = false;
  controller.enableTilt = true;

  return { viewer, scene, notes };
}

export function setShadows(viewer, enabled) {
  viewer.shadows = enabled;
  viewer.shadowMap.enabled = enabled;
  if (enabled) {
    viewer.shadowMap.size = 4096;
    // Soft shadows and a long cascade both cost depth precision, and on 880
    // flat prism tops that shows up as fine diagonal self-shadowing stripes
    // across the whole board. A tight cascade around the theatre and hard edges
    // trade a little softness for terrain that is not visibly hatched.
    viewer.shadowMap.softShadows = false;
    viewer.shadowMap.darkness = 0.45;
    viewer.shadowMap.normalOffset = true;
    viewer.shadowMap.maximumDistance = 55000;
  }
  viewer.scene.requestRender();
}

/**
 * Keeps the camera over the board.
 *
 * What gets clamped is the point on the ground the camera is *looking at*, not
 * the camera's own position. Clamping the position looks equivalent and is not:
 * a camera tilted to -56 degrees sits a long way south of whatever it has in
 * frame, so bounding the position lets you sail past the north edge (the camera
 * is still well inside while looking well outside) and stops you well short of
 * the south edge (reaching it needs the camera further south than the bound
 * allows). The board ends up with a generous top margin and an unreachable
 * bottom, which is exactly backwards.
 *
 * Solving for where the view ray crosses the ground plane and bounding that
 * makes the cage symmetrical, and means the margin is expressed in the thing
 * the player actually perceives.
 *
 * Runs after the controller has had its say each frame and only corrects when
 * something is genuinely out of range, so ordinary panning feels untouched.
 */
export function cageCamera(viewer, frame) {
  const camera = viewer.camera;
  const marginX = BOARD_EXTENT.widthMeters * CAMERA.marginFraction;
  const marginY = BOARD_EXTENT.heightMeters * CAMERA.marginFraction;
  const limits = {
    minX: BOARD_EXTENT.minX - marginX,
    maxX: BOARD_EXTENT.maxX + marginX,
    minY: BOARD_EXTENT.minY - marginY,
    maxY: BOARD_EXTENT.maxY + marginY,
  };

  const apply = () => {
    const local = frame.toBoard(camera.positionWC);
    const direction = frame.toBoardVector(camera.directionWC);
    const pitch = clamp(camera.pitch, CAMERA.minPitch, CAMERA.maxPitch);
    const tilted = Math.abs(pitch - camera.pitch) > 1e-4;

    // Where the view ray meets the ground. A camera pointing at or above the
    // horizon has no such point, in which case fall back to its own position.
    const looking =
      direction.z < -1e-6
        ? { x: local.x + direction.x * (-local.z / direction.z), y: local.y + direction.y * (-local.z / direction.z) }
        : { x: local.x, y: local.y };

    const shiftX = clamp(looking.x, limits.minX, limits.maxX) - looking.x;
    const shiftY = clamp(looking.y, limits.minY, limits.maxY) - looking.y;
    if (Math.abs(shiftX) < 1 && Math.abs(shiftY) < 1 && !tilted) return;

    // Move the camera by whatever the target had to move, so the correction is
    // a slide rather than a jump to somewhere else entirely.
    camera.setView({
      destination: frame.toCartesian(local.x + shiftX, local.y + shiftY, local.z),
      orientation: { heading: camera.heading, pitch, roll: 0 },
    });
  };

  viewer.scene.preRender.addEventListener(apply);
  return () => viewer.scene.preRender.removeEventListener(apply);
}

/**
 * Frames the whole board, looking north from above at a readable tilt.
 *
 * The height is chosen so the board fills the view rather than sitting in the
 * middle of it: at the extra 35% this started with, the whole theatre was
 * visible but a column was a speck four pixels across, which is not a game you
 * can play. Filling the frame is worth more than seeing the margins.
 */
export function frameBoard(viewer, frame, { duration = 0 } = {}) {
  const height = BOARD_EXTENT.heightMeters * 0.92;
  viewer.camera.flyTo({
    destination: frame.toCartesian(BOARD_EXTENT.centreX, BOARD_EXTENT.minY - height * 0.36, height),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-56), roll: 0 },
    duration,
  });
}

/**
 * True when a world position is comfortably inside the viewport.
 *
 * Used to decide whether an enemy action needs the camera moved at all. Flying
 * to every single one would leave the board lurching about for a whole turn;
 * most of what happens is already on screen, and only the parts that are not
 * are worth a pan.
 */
export function isOnScreen(viewer, position, insetFraction = 0.18) {
  const window = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, position);
  if (!window) return false;
  const { clientWidth: width, clientHeight: height } = viewer.scene.canvas;
  const insetX = width * insetFraction;
  const insetY = height * insetFraction;
  return (
    window.x > insetX && window.x < width - insetX && window.y > insetY && window.y < height - insetY
  );
}

/** Moves the camera to look at one hex without changing the viewing angle. */
export function lookAt(viewer, frame, x, y, { duration = 0.7 } = {}) {
  const camera = viewer.camera;
  const local = frame.toBoard(camera.positionWC);
  // Keep the current height and pitch; only slide across the board. Working out
  // the ground point the camera is currently looking at lets the target hex land
  // in the middle of the screen rather than under the camera itself.
  const offsetY = local.z / Math.tan(-camera.pitch);
  camera.flyTo({
    destination: frame.toCartesian(x, y - offsetY, local.z),
    orientation: { heading: camera.heading, pitch: camera.pitch, roll: 0 },
    duration,
  });
}

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);

/**
 * A fixed date in early summer, at the theatre's own local morning. Longitude
 * gives the offset from UTC closely enough for a sun angle.
 */
function sunTimeFor(theatre) {
  const utcHour = theatre.lightHour - theatre.centre.longitude / 15;
  const date = new Date(Date.UTC(2024, 5, 21, 0, 0, 0));
  date.setUTCMinutes(Math.round(utcHour * 60));
  return Cesium.JulianDate.fromDate(date);
}

function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error(`${label} did not respond within ${PROVIDER_TIMEOUT_MS} ms`)), PROVIDER_TIMEOUT_MS),
    ),
  ]);
}
