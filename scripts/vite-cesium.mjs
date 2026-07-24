import fs from 'node:fs';
import path from 'node:path';

/**
 * Companion to vite-plugin-cesium for demos served from a sub-path.
 *
 * That plugin derives one string from `base` and uses it for two things: the
 * URL it injects into index.html (which must include the base) and the copy
 * destination for Cesium's static assets (which must not). With base
 * `/demos/<slug>/` the assets therefore land in
 * `<outDir>/demos/<slug>/cesium/` while the page asks for `<outDir>/cesium/`.
 *
 * This moves them where the page actually looks. Add it after `cesium()`:
 *
 *   plugins: [cesium(), fixCesiumSubpath()]
 */
export function fixCesiumSubpath() {
  let outDir;
  let nestedRel;

  return {
    name: 'cesium-subpath-fix',
    apply: 'build',
    enforce: 'post',

    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
      // '/demos/<slug>/' -> 'demos/<slug>' — what the plugin prefixes onto its
      // copy destination. Empty when base is '/', where nothing needs moving.
      nestedRel = config.base.replace(/^\/+|\/+$/g, '');
    },

    closeBundle: {
      sequential: true,
      order: 'post',
      handler() {
        if (!nestedRel) return;
        const misplaced = path.join(outDir, nestedRel, 'cesium');
        const wanted = path.join(outDir, 'cesium');
        if (!fs.existsSync(misplaced)) return;

        fs.rmSync(wanted, { recursive: true, force: true });
        fs.renameSync(misplaced, wanted);

        // Drop the now-empty wrapper directories the copy left behind.
        for (let dir = path.join(outDir, nestedRel); dir !== outDir; dir = path.dirname(dir)) {
          if (fs.readdirSync(dir).length) break;
          fs.rmdirSync(dir);
        }
      },
    },
  };
}
