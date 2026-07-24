// Viewer for the PostGIS terrain-following airspace tessellation demo.
// Ported from blog/postgis-airspace-tessellation/viewer in DemosAndArticleContent —
// the geometry logic is unchanged; only the data path and the Ion token plumbing
// differ so it can be built and deployed as part of this site.

// Cesium is bundled from npm; vite-plugin-cesium copies its static assets into
// the build and points CESIUM_BASE_URL at them, so nothing loads off a CDN.
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

// Optional: set VITE_CESIUM_ION_TOKEN (locally in .env.local, or as a build-time
// environment variable in Cloudflare Pages) to render Cesium World Terrain +
// Bing imagery. Without it the viewer falls back to free, key-less ESRI World
// Elevation + World Imagery — the mountain still renders. The token ends up in
// the built bundle, so use a scoped, read-only Ion token.
const ION_TOKEN = (import.meta.env.VITE_CESIUM_ION_TOKEN ?? '').trim();

const DATA_URL = `${import.meta.env.BASE_URL}data/cells.json`;
const CONFLICT_COLOR = '#e15554';

async function main() {
  const warn = document.getElementById('warn');
  const data = await (await fetch(DATA_URL)).json();

  // Terrain, best available first:
  //   1. Cesium World Terrain (needs an Ion token; ellipsoidal heights,
  //      which is what the exported data is in — no adjustment)
  //   2. ESRI World Elevation, free, no key — but it serves orthometric
  //      (MSL) heights that Cesium renders as-is, so the scene's ground
  //      sits ~|geoid offset| above the ellipsoidal datum here. Shift the
  //      volumes by the same amount so they stay glued to the ground.
  //   3. Flat ellipsoid.
  const hasToken = !!ION_TOKEN;
  let terrainProvider = null;
  let heightOffset = 0;

  if (hasToken) {
    Cesium.Ion.defaultAccessToken = ION_TOKEN;
    try {
      terrainProvider = await Cesium.createWorldTerrainAsync();
    } catch {
      warn.textContent = 'Ion token rejected — trying free ESRI terrain instead. ';
    }
  }
  if (!terrainProvider) {
    try {
      terrainProvider = await Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(
        'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer',
      );
      heightOffset = -(data.geoidOffsetM ?? 0); // orthometric scene: +30.7 m here
      warn.textContent +=
        'Using free ESRI World Elevation terrain ' +
        `(orthometric — volumes shifted ${heightOffset.toFixed(1)} m to match).`;
    } catch {
      terrainProvider = new Cesium.EllipsoidTerrainProvider();
      warn.textContent +=
        'No terrain reachable: rendering on a flat ellipsoid, ' +
        'so the volumes hover at their true heights without the mountain under them.';
    }
  }

  // Imagery: Ion world imagery with a token, otherwise free ESRI World
  // Imagery (satellite), otherwise OpenStreetMap.
  let baseLayer;
  if (hasToken && heightOffset === 0) {
    baseLayer = Cesium.ImageryLayer.fromWorldImagery();
  } else {
    try {
      baseLayer = new Cesium.ImageryLayer(
        await Cesium.ArcGisMapServerImageryProvider.fromUrl(
          'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
        ),
      );
    } catch {
      baseLayer = new Cesium.ImageryLayer(
        new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' }),
      );
    }
  }

  const viewer = new Cesium.Viewer('cesiumContainer', {
    terrainProvider,
    baseLayer,
    animation: false,
    timeline: false,
    geocoder: false,
    baseLayerPicker: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    homeButton: false,
    infoBox: false,
    selectionIndicator: false,
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
  });
  viewer.scene.globe.depthTestAgainstTerrain = true;

  document.getElementById('meta').textContent =
    `${data.cellSizeM} m cells · heights in ${data.heightsAre} · generated ${data.generated}`;

  // ----------------------------------------------------------------------
  // Rendering. A few batched Primitives per airspace — thousands of cells
  // collapse into a handful of draw calls. Geometry is built lazily the
  // first time an airspace is toggled on, and rebuilt when the conflict
  // selection changes (red cells are baked per selection).
  //
  // Two modes:
  //   surface — the union look: a terrain-following ceiling sheet and
  //             floor sheet (heights averaged at shared grid corners so
  //             adjacent cells join seamlessly), plus one continuous
  //             perimeter wall stitched from the cells' own outline
  //             edges — an edge is on the outline iff exactly one cell
  //             ring contains it, so wall vertices match sheet vertices
  //             by construction. No interior faces, no gaps.
  //   cells   — every prism drawn as its own translucent box, shaded
  //             darker toward the valley floor: what the solids in
  //             airspace_cells actually look like.
  // ----------------------------------------------------------------------
  const cellInfo = {}; // pick id -> info for the inspector
  const layers = {}; // airspace id -> {sig, prims: [...]}

  const cornerKey = (p) => `${p[0]},${p[1]}`;

  function buildCornerMap(cells) {
    // average floor/ceiling of every cell sharing each grid corner
    const m = new Map();
    for (const cell of cells) {
      for (const p of cell.ring.slice(0, -1)) {
        const k = cornerKey(p);
        const e = m.get(k) ?? { b: 0, t: 0, n: 0 };
        e.b += cell.bottom;
        e.t += cell.top;
        e.n++;
        m.set(k, e);
      }
    }
    return m;
  }

  function boundaryLoops(cells) {
    // Undirected edge census over all cell rings: an edge used by exactly
    // one ring lies on the airspace outline. Then stitch those edges into
    // closed loops by walking shared endpoints.
    const seen = new Map();
    for (const cell of cells) {
      const ring = cell.ring;
      for (let i = 0; i < ring.length - 1; i++) {
        const a = cornerKey(ring[i]);
        const b = cornerKey(ring[i + 1]);
        const k = a < b ? `${a}|${b}` : `${b}|${a}`;
        const e = seen.get(k);
        if (e) e.n++;
        else seen.set(k, { n: 1, seg: [ring[i], ring[i + 1]] });
      }
    }
    const pool = [...seen.values()].filter((e) => e.n === 1).map((e) => e.seg);
    const loops = [];
    while (pool.length) {
      const path = pool.pop().slice();
      let extended = true;
      while (extended) {
        extended = false;
        const endK = cornerKey(path[path.length - 1]);
        for (let i = 0; i < pool.length; i++) {
          const [s0, s1] = pool[i];
          if (cornerKey(s0) === endK) {
            path.push(s1);
            pool.splice(i, 1);
            extended = true;
            break;
          }
          if (cornerKey(s1) === endK) {
            path.push(s0);
            pool.splice(i, 1);
            extended = true;
            break;
          }
        }
      }
      loops.push(path);
    }
    return loops;
  }

  function addPrimitive(instances) {
    if (!instances.length) return null;
    return viewer.scene.primitives.add(
      new Cesium.Primitive({
        geometryInstances: instances,
        appearance: new Cesium.PerInstanceColorAppearance({ translucent: true, closed: false }),
      }),
    );
  }

  function buildLayer(asp, mode, redSet) {
    const ground = {
      min: Math.min(...asp.cells.map((c) => c.ground)),
      max: Math.max(...asp.cells.map((c) => c.ground)),
    };
    asp.cells.forEach((cell, idx) => {
      cellInfo[`${asp.id}:${idx}`] = { asp, cell };
    });
    const red = Cesium.Color.fromCssColorString(CONFLICT_COLOR).withAlpha(0.6);
    const flat = Cesium.Color.fromCssColorString(asp.color).withAlpha(0.5);
    const shaded = (cell) => {
      const t = (cell.ground - ground.min) / Math.max(1, ground.max - ground.min);
      return Cesium.Color.fromCssColorString(asp.color)
        .darken(0.25 * (1 - t), new Cesium.Color())
        .withAlpha(0.5);
    };
    const instance = (geometry, color, idx) =>
      new Cesium.GeometryInstance({
        geometry,
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color) },
        id: `${asp.id}:${idx}`,
      });

    if (mode === 'cells') {
      const boxes = asp.cells.map((cell, idx) =>
        instance(
          new Cesium.PolygonGeometry({
            polygonHierarchy: new Cesium.PolygonHierarchy(
              Cesium.Cartesian3.fromDegreesArray(cell.ring.flat()),
            ),
            height: cell.bottom + heightOffset,
            extrudedHeight: cell.top + heightOffset,
            vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
          }),
          redSet.has(idx) ? red : shaded(cell),
          idx,
        ),
      );
      return [addPrimitive(boxes)].filter(Boolean);
    }

    // surface mode
    const corners = buildCornerMap(asp.cells);
    const heightAt = (p, fld) => {
      const e = corners.get(cornerKey(p));
      return e[fld] / e.n + heightOffset;
    };
    const sheets = asp.cells.flatMap((cell, idx) =>
      ['b', 't'].map((fld) =>
        instance(
          new Cesium.PolygonGeometry({
            polygonHierarchy: new Cesium.PolygonHierarchy(
              Cesium.Cartesian3.fromDegreesArrayHeights(
                cell.ring.flatMap((p) => [p[0], p[1], heightAt(p, fld)]),
              ),
            ),
            perPositionHeight: true,
            vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
          }),
          redSet.has(idx) ? red : flat,
          idx,
        ),
      ),
    );
    const walls = boundaryLoops(asp.cells).map((loop) =>
      instance(
        new Cesium.WallGeometry({
          positions: Cesium.Cartesian3.fromDegreesArray(loop.flat()),
          minimumHeights: loop.map((p) => heightAt(p, 'b')),
          maximumHeights: loop.map((p) => heightAt(p, 't')),
          vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
        }),
        flat,
        'wall',
      ),
    );
    return [addPrimitive(sheets), addPrimitive(walls)].filter(Boolean);
  }

  // --- conflict selection & layer lifecycle -----------------------------
  let selected = 'ALL'; // "ALL" | null | [idA, idB]
  const currentMode = () => document.querySelector('input[name="mode"]:checked').value;
  const sig = () =>
    `${currentMode()}|${selected === null ? 'off' : selected === 'ALL' ? 'ALL' : selected.join('+')}`;

  function redSetFor(asp) {
    if (selected === null) return new Set();
    const match =
      selected === 'ALL'
        ? (c) => c.conflicts.length > 0
        : (c) => {
            const partner =
              asp.id === selected[0] ? selected[1] : asp.id === selected[1] ? selected[0] : null;
            return partner !== null && c.conflicts.includes(partner);
          };
    return new Set(asp.cells.flatMap((c, i) => (match(c) ? [i] : [])));
  }

  function ensureLayer(id) {
    const s = sig();
    if (layers[id]?.sig === s) return;
    if (layers[id]) for (const p of layers[id].prims) viewer.scene.primitives.remove(p);
    const asp = data.airspaces.find((a) => a.id === id);
    layers[id] = { sig: s, prims: buildLayer(asp, currentMode(), redSetFor(asp)) };
  }

  const visible = {};
  function refresh() {
    const s = sig();
    for (const asp of data.airspaces) {
      const L = layers[asp.id];
      if (!L) continue;
      const on = visible[asp.id] && L.sig === s;
      for (const p of L.prims) p.show = on;
    }
    viewer.scene.requestRender();
  }
  function apply() {
    for (const asp of data.airspaces) if (visible[asp.id]) ensureLayer(asp.id);
    refresh();
  }

  // --- UI ---------------------------------------------------------------
  const toggles = document.getElementById('toggles');
  for (const asp of data.airspaces) {
    visible[asp.id] = false; // everything off by default: instant load
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" data-id="${asp.id}" />
      <span class="swatch" style="background:${asp.color}"></span>
      ${asp.name}<span class="range">${asp.lower}–${asp.upper} m ${asp.ref}</span>`;
    toggles.appendChild(label);
  }
  toggles.addEventListener('change', (e) => {
    visible[e.target.dataset.id] = e.target.checked;
    apply();
  });
  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.addEventListener('change', apply);
  }

  // conflict matrix: every pairwise combination, straight from PostGIS
  const ids = data.airspaces.map((a) => a.id);
  const byPair = {};
  for (const m of data.matrix) byPair[m.pair.join('+')] = m;
  function renderMatrix() {
    const cellFor = (a, b) => {
      const m = byPair[[a, b].sort().join('+')];
      const key = [a, b].sort().join('+');
      const isSel = Array.isArray(selected) && selected.join('+') === key;
      if (!m) return "<td class='none'>—</td>";
      if (m.volumeM3 > 0) {
        return (
          `<td class="hit${isSel ? ' sel' : ''}" data-pair="${key}"
          title="${m.cellPairs} cell pairs · ${m.volumeM3.toLocaleString()} m³ shared · click to highlight">` +
          `${(m.volumeM3 / 1e6).toFixed(1)}M</td>`
        );
      }
      if (m.touchingPairs > 0) {
        return `<td class="touch" title="${m.touchingPairs} cell pairs share faces, zero shared volume">touch</td>`;
      }
      return "<td class='none'>—</td>";
    };
    let html =
      "<b>Conflict matrix</b> <span style='color:#9ab'>(shared volume, M m³)</span>" +
      `<span class="modebtn${selected === 'ALL' ? ' sel' : ''}" data-sel="ALL">highlight all</span>` +
      `<span class="modebtn${selected === null ? ' sel' : ''}" data-sel="off">highlight off</span>` +
      '<table><tr><th></th>' +
      ids
        .slice(1)
        .map((i) => `<th>${i[0]}</th>`)
        .join('') +
      '</tr>';
    for (let r = 0; r < ids.length - 1; r++) {
      html += `<tr><th>${ids[r]}</th>`;
      for (let c = 1; c < ids.length; c++) {
        html += c <= r ? "<td class='none'></td>" : cellFor(ids[r], ids[c]);
      }
      html += '</tr>';
    }
    document.getElementById('matrix').innerHTML = html + '</table>';
  }
  document.getElementById('matrix').addEventListener('click', (e) => {
    const pair = e.target.dataset?.pair;
    const selBtn = e.target.dataset?.sel;
    if (pair) selected = pair.split('+');
    else if (selBtn === 'ALL') selected = 'ALL';
    else if (selBtn === 'off') selected = null;
    else return;
    renderMatrix();
    apply();
  });
  renderMatrix();

  // Click a cell for its numbers (primitive picking, no entities).
  const info = document.getElementById('cellinfo');
  new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas).setInputAction((click) => {
    const picked = viewer.scene.pick(click.position);
    const hit = picked && cellInfo[picked.id];
    info.textContent = !hit
      ? ''
      : `${hit.asp.name} (${hit.asp.lower}–${hit.asp.upper} m ${hit.asp.ref})\n` +
        `ground ${hit.cell.ground} m · floor ${hit.cell.bottom} m · ceiling ${hit.cell.top} m\n` +
        `conflicts with: ${hit.cell.conflicts.join(', ') || '—'}`;
    viewer.scene.requestRender();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(-84.128, 33.777, 2600),
    orientation: {
      heading: Cesium.Math.toRadians(-35),
      pitch: Cesium.Math.toRadians(-24),
    },
    duration: 0,
  });
}

main().catch((e) => {
  document.getElementById('warn').textContent = 'Failed to start viewer: ' + e;
  console.error(e);
});
