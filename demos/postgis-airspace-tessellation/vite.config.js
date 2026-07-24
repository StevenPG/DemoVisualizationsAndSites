import cesium from 'vite-plugin-cesium';
import { fixCesiumSubpath } from '../../scripts/vite-cesium.mjs';
import { defineDemoConfig } from '../../scripts/vite-demo-config.mjs';

// The slug has to match the folder name and the demos.json entry.
//
// Cesium is bundled from npm and its static assets (workers, imagery, glTF
// pipeline) are copied into the demo's own output — same approach as the
// elden-ring-3d-map repo. Nothing is fetched from a third-party CDN at runtime.
export default defineDemoConfig('postgis-airspace-tessellation', {
  plugins: [cesium(), fixCesiumSubpath()],
});
