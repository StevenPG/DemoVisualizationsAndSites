# DemoVisualizationsAndSites

One Cloudflare Pages deployment that hosts any number of standalone demo sites,
plus a landing page that links to them. Backend code for the articles lives in
`demoarticlesandcontent`; anything that renders in a browser lives here.

```
/                       landing page — the index of demos
/demos/<slug>/          one demo, built as its own self-contained site
/demos.json             machine-readable list of demos (fetchable from the blog)
```

## Adding a demo

```bash
npm run new sse-vs-websockets -- "SSE vs WebSockets"
npm install            # links the new workspace
npm run dev sse-vs-websockets
```

That scaffolds `demos/sse-vs-websockets/` and adds a **draft** entry to
`demos.json`. Write the demo, fill in the `description` / `tags` / `article`
fields, then flip `"status"` to `"live"` to publish it on the landing page.
Draft demos are still built and reachable by URL — handy for sharing a preview
link before the article goes out.

Adding one by hand works too: create `demos/<slug>/` with a `package.json`,
`index.html` and a `vite.config.js` that calls `defineDemoConfig('<slug>')`,
then add the manifest entry. The build fails loudly if a folder and the manifest
disagree.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server for the landing page, with every demo mounted at `/demos/<slug>/` |
| `npm run dev <slug>` | Dev server for one demo, served at `/` |
| `npm run build` | Builds everything into `dist/` |
| `npm run preview` | Builds, then serves `dist/` so you can click through the real routes |
| `npm run new <slug> -- "Title"` | Scaffolds a demo and registers it |

`npm run dev` mirrors the production routes: the landing cards link to
`/demos/<slug>/`, and each demo runs as its own Vite server behind that prefix
with its own plugins and HMR. Use `npm run dev <slug>` when you only care about
one demo and want it at the root.

## How a demo is wired

Each demo is an independent npm workspace with its own `package.json`, so it can
pull in React, D3, three.js or nothing at all without affecting the others. Two
rules keep it deployable as part of the bundle:

1. `vite.config.js` calls `defineDemoConfig('<slug>')`, which sets
   `base: '/demos/<slug>/'` (so asset URLs resolve after deployment) and points
   `outDir` at `dist/demos/<slug>/`. Pass a second argument to add plugins or
   any other Vite options.
2. Links back to the index use the absolute path `/`.

Demos share no CSS or components on purpose — each one should be free to look
however its article needs. Copy between them if that stops being true.

### CesiumJS demos

Use the npm package rather than the CDN, so the demo has no third-party runtime
dependency — same as `elden-ring-3d-map`:

```js
import cesium from 'vite-plugin-cesium';
import { fixCesiumSubpath } from '../../scripts/vite-cesium.mjs';
import { defineDemoConfig } from '../../scripts/vite-demo-config.mjs';

export default defineDemoConfig('my-slug', { plugins: [cesium(), fixCesiumSubpath()] });
```

`fixCesiumSubpath()` is required here and not in a single-site repo:
vite-plugin-cesium builds one string from `base` and uses it both as the URL it
injects into the HTML and as the copy destination for Cesium's static assets, so
under `/demos/<slug>/` the assets land one directory tree too deep. The plugin
moves them where the page looks. Cesium adds ~14 MB of static assets to that
demo's output — well inside Cloudflare Pages' 25 MiB-per-file and 20,000-file
limits, but worth knowing before adding many Cesium demos.

Set `VITE_CESIUM_ION_TOKEN` (in `.env.local`, or as a build-time environment
variable in Cloudflare Pages) to use Cesium World Terrain and Bing imagery.
Without it the viewer falls back to free, key-less ESRI World Elevation and
World Imagery. The token is baked into the built bundle, so use a scoped,
read-only Ion token.

## Deploying to Cloudflare Pages

Connect the repo and use:

- **Build command:** `npm run build`
- **Build output directory:** `dist`

Node is pinned by the committed `.node-version` (22), which Pages reads — Vite 7
requires `^20.19 || >=22.12`, and Pages' default Node version depends on when the
project was created, so leaving it implicit can fail the build on an older project.

Everything is static — no Functions, no runtime config. Caching headers live in
`landing/public/_headers`; that whole folder is copied to the root of `dist/`.

## Linking from the blog

Link straight to `https://<your-pages-domain>/demos/<slug>/`, or fetch
`/demos.json` to render the list of demos on your site — it is written at build
time and each entry carries a ready-to-use `url`.

## Layout

```
demos.json               the manifest: what exists, and what shows on the index
demos.schema.json        JSON Schema for the manifest (editor autocomplete)
landing/                 the index page (plain HTML/CSS/JS, built by Vite)
  site.config.js         your title, tagline and blog/repo links — edit this
  public/_headers        Cloudflare Pages headers, copied to dist/
demos/<slug>/            one demo per folder
scripts/
  build.mjs              builds landing + every demo into dist/
  dev.mjs                dev server for one site
  new-demo.mjs           scaffolder
  manifest.mjs           manifest loading + validation
  vite-demo-config.mjs   shared Vite config for a demo
  vite-cesium.mjs        sub-path fix for vite-plugin-cesium
  template/              what `npm run new` copies
```

## Demos

| Slug | Source |
| --- | --- |
| `marchward` | written here |
| `cesium-moving-points-stress-test` | written here |
| `postgis-airspace-tessellation` | `blog/postgis-airspace-tessellation/viewer` in [DemosAndArticleContent](https://github.com/StevenPG/DemosAndArticleContent) |
| `hello-world` | scaffold placeholder, kept as a draft |

The PostGIS viewer is a port, not a fork: the geometry, conflict-matrix and
picking logic are unchanged from the original. Only the data path, the Ion token
plumbing and the Cesium import differ. `public/data/cells.json` is a snapshot of
that repo's `viewer/data/cells.json` — regenerate it there (`run.sh`, then
`scripts/export_cells.py`) and copy it across to refresh the demo.

### `marchward`

A turn-based medieval siege game. Two castles sixty-nine kilometres apart on a
procedurally generated hex board, drawn as extruded prisms over a bounded
rectangle of real ground — the Welsh Marches, the Rhine Gorge, the Loire or the
Cheviots, chosen at setup. Officers lead armies of thousands, supply is traced
from your castle every turn, and you take the enemy keep by encircling and
starving it before you storm it. There is an AI opponent, three difficulties and
a rules panel; nothing is fetched from a third party and there is no Ion token.

Four things in it are worth knowing about before editing:

- **The rules are renderer-agnostic on purpose.** `src/model.js` and `src/ai.js`
  import nothing from `view/`, so `scripts/selfplay.mjs` plays whole matches
  headlessly in Node with the AI on both sides. Every balance number in
  `src/config.js` was set from its output rather than by feel, and three real
  design faults were found that way: matches that never ended because a partial
  siege took longer than the match, armies above 15,000 that could not enter
  hills at all because the minimum movement allowance was below the terrain
  cost, and an AI that walked off the siege it was maintaining because its own
  ring hex scored lower than the next gap along.
- **Supply is contested, not merely reachable.** Territory belongs to whichever
  side can push supply to it more cheaply, so the front line falls out of the
  flood fill. Crediting each side with everything it could *walk* to gave both
  players the whole map on turn one, pinned both at maximum AP for the entire
  game, and made the territory bonus — the thing the supply system exists to
  produce — never vary by a point. Fixing that took castles-taken from 24% of
  matches to 68%.
- **The hex prisms are built by hand.** `PolygonGeometry` triangulates and
  re-projects each polygon; 880 of them cost seconds on load for a shape whose
  thirty vertices are known in closed form. `src/view/board.js` writes the
  vertex and index buffers directly and the whole board is one batched
  `Primitive`, still individually pickable and re-tintable.
- **The camera is caged.** Clamped to the theatre rectangle with a margin, to a
  zoom band, and to a pitch range, with the globe's own terrain switched off —
  the board is a diorama sitting on the ellipsoid, and real elevation underneath
  would poke through the pieces.

```bash
npm run dev marchward                     # play it
node demos/marchward/scripts/selfplay.mjs 25 all marshal   # 100 headless matches
```

### `cesium-moving-points-stress-test`

Answers "how many independently moving points can CesiumJS hold" by putting up
to 200,000 of them on the globe at once — ships, aircraft, ground vehicles and
satellites, each with its own heading and a leg to finish before it retires and
is replaced. The HUD splits the frame into simulation, renderer sync and
everything Cesium does, so the answer comes with a reason attached, and a
renderer switch rebuilds the same population through the Entity API for the
comparison. Clicking any point promotes it to a real entity with a pin, a track
and a property table.

Two things in it are worth knowing about before editing:

- **The land/ocean mask is free.** Cesium's static assets already contain the
  Natural Earth II base layer as a TMS pyramid. `src/landmask.js` fetches the 32
  level-2 tiles, classifies each pixel by colour, and gets a 2048×1024 global
  mask at ~19 km resolution for no new dependency and no third-party request. It
  measures 28.3% land against Earth's real 29%. If the classification ever drifts
  it fails loudly rather than silently spawning ships in deserts.
- **The simulation is structure-of-arrays on purpose.** Slots are handed out by a
  free list and carry a generation counter, so a selection can tell "still alive"
  from "that slot was recycled". Movement uses a local tangent-plane step rather
  than a rhumb-line formula — below a pixel of error per frame, and a fraction of
  the transcendentals.

No Ion token: imagery is keyless ESRI World Imagery and elevation is keyless ESRI
World Elevation, both with bounded timeouts so a blocked endpoint degrades to a
flat ellipsoid instead of hanging on the loading screen.
