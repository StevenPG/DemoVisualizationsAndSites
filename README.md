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
| `npm run dev` | Dev server for the landing page |
| `npm run dev <slug>` | Dev server for one demo |
| `npm run build` | Builds everything into `dist/` |
| `npm run preview` | Builds, then serves `dist/` so you can click through the real routes |
| `npm run new <slug> -- "Title"` | Scaffolds a demo and registers it |

In dev the landing page's cards link to `/demos/<slug>/`, which only exists in a
real build — use `npm run preview` to test the links.

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
| `postgis-airspace-tessellation` | `blog/postgis-airspace-tessellation/viewer` in [DemosAndArticleContent](https://github.com/StevenPG/DemosAndArticleContent) |
| `hello-world` | scaffold placeholder, kept as a draft |

The PostGIS viewer is a port, not a fork: the geometry, conflict-matrix and
picking logic are unchanged from the original. Only the data path, the Ion token
plumbing and the Cesium import differ. `public/data/cells.json` is a snapshot of
that repo's `viewer/data/cells.json` — regenerate it there (`run.sh`, then
`scripts/export_cells.py`) and copy it across to refresh the demo.
