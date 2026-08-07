/**
 * Viewer bootstrap.
 *
 * Deliberately no Cesium Ion token: imagery is ESRI World Imagery and elevation
 * is ESRI World Elevation, both keyless. That keeps the demo runnable by anyone
 * who clones the repo, and it keeps the benchmark honest — everyone is looking
 * at the same globe.
 */

import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

const ESRI_IMAGERY = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
const ESRI_ELEVATION =
  'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer';

/**
 * Both providers are built by fetching a service description first, and Cesium
 * retries before it gives up. On a network that black-holes these hosts rather
 * than refusing outright, that await never settles and the page sits on the
 * loading screen forever. A demo whose whole subject is frame budget should not
 * be capable of showing you nothing at all, so failure here is bounded.
 */
const PROVIDER_TIMEOUT_MS = 12_000;

function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error(`${label} did not respond within ${PROVIDER_TIMEOUT_MS} ms`)), PROVIDER_TIMEOUT_MS),
    ),
  ]);
}

export async function createViewer(containerId, { terrain }) {
  const notes = [];

  let baseLayer;
  try {
    baseLayer = new Cesium.ImageryLayer(
      await withTimeout(Cesium.ArcGisMapServerImageryProvider.fromUrl(ESRI_IMAGERY), 'ESRI imagery'),
    );
  } catch (error) {
    console.warn('[viewer] ESRI imagery unavailable, falling back to OpenStreetMap:', error);
    notes.push('ESRI imagery was unreachable — falling back to OpenStreetMap tiles.');
    baseLayer = new Cesium.ImageryLayer(
      new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' }),
    );
  }

  const ellipsoidTerrain = new Cesium.EllipsoidTerrainProvider();

  const viewer = new Cesium.Viewer(containerId, {
    baseLayer,
    terrainProvider: ellipsoidTerrain,
    animation: false,
    timeline: false,
    geocoder: false,
    baseLayerPicker: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    homeButton: false,
    fullscreenButton: false,
    // The two the demo actually needs: clicking a point promotes it to an
    // entity, and this is what shows its properties.
    infoBox: true,
    selectionIndicator: true,
    // Everything moves every frame, so render-on-demand would request a render
    // every frame anyway — with the bookkeeping on top.
    requestRenderMode: false,
  });

  const scene = viewer.scene;
  scene.globe.depthTestAgainstTerrain = true;
  scene.globe.showGroundAtmosphere = true;
  viewer.clock.shouldAnimate = true;
  // Nothing in the scene casts or receives a meaningful shadow, and it is not
  // free.
  scene.shadows = false;
  scene.globe.enableLighting = false;

  let realTerrain = null;
  let terrainFailed = false;

  async function setTerrain(enabled) {
    if (!enabled) {
      scene.terrainProvider = ellipsoidTerrain;
      return false;
    }
    if (terrainFailed) return false;
    if (!realTerrain) {
      try {
        realTerrain = await withTimeout(
          Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(ESRI_ELEVATION),
          'ESRI world elevation',
        );
      } catch (error) {
        console.warn('[viewer] ESRI elevation unavailable:', error);
        terrainFailed = true;
        return false;
      }
    }
    scene.terrainProvider = realTerrain;
    return true;
  }

  const terrainOn = terrain ? await setTerrain(true) : false;
  if (terrain && !terrainOn) notes.push('ESRI world elevation was unreachable — running on a flat ellipsoid.');

  // Reused across every terrain lookup: the ground fleet asks hundreds of times
  // a frame and a fresh Cartographic each time would be pure garbage.
  const scratchCarto = new Cesium.Cartographic();

  /**
   * Terrain height at a position, or undefined where no tile covering it has
   * loaded yet. Synchronous and cheap-ish — it walks the loaded tile tree
   * rather than issuing a request — which is why callers still throttle it.
   */
  function sampleGroundHeight(lonRad, latRad) {
    scratchCarto.longitude = lonRad;
    scratchCarto.latitude = latRad;
    scratchCarto.height = 0;
    return scene.globe.getHeight(scratchCarto);
  }

  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-25, 22, 24_000_000),
  });

  return { viewer, setTerrain, sampleGroundHeight, terrainOn, notes };
}
