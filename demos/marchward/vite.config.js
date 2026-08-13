import cesium from 'vite-plugin-cesium';
import { fixCesiumSubpath } from '../../scripts/vite-cesium.mjs';
import { defineDemoConfig } from '../../scripts/vite-demo-config.mjs';

// The slug has to match the folder name and the demos.json entry.
//
// Cesium comes from npm, so the game has no third-party runtime dependency and
// its ~14 MB of static assets are served from this demo's own output.
export default defineDemoConfig('marchward', {
  plugins: [cesium(), fixCesiumSubpath()],
});
