import cesium from 'vite-plugin-cesium';
import { fixCesiumSubpath } from '../../scripts/vite-cesium.mjs';
import { defineDemoConfig } from '../../scripts/vite-demo-config.mjs';

// The slug has to match the folder name and the demos.json entry.
//
// Cesium comes from npm and its static assets are copied into this demo's own
// output, so nothing is fetched from a third-party CDN at runtime. That matters
// twice over here: the land/ocean mask is decoded from the Natural Earth II
// textures that ship inside those assets (see src/landmask.js).
export default defineDemoConfig('cesium-moving-points-stress-test', {
  plugins: [cesium(), fixCesiumSubpath()],
});
