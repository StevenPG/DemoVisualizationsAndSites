import fs from 'node:fs';
import path from 'node:path';
import { demosDir, manifestPath } from './paths.mjs';

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A demo that is more than one Vite app — a micro frontend console, say —
 * cannot be described by a single index.html at its root, so it may ship a
 * `build.mjs` and take over. Its build still has to leave an index.html at
 * dist/demos/<slug>/index.html, which scripts/build.mjs checks either way.
 *
 * See demos/micro-frontend-airspace-console/build.mjs for the shape.
 */
export const ownsItsBuild = (slug) => fs.existsSync(path.join(demosDir, slug, 'build.mjs'));

/**
 * Reads demos.json and checks it against what is actually on disk. Throws with
 * every problem it found rather than just the first one, so a bad edit gets
 * fixed in one pass instead of one build at a time.
 */
export function loadManifest() {
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const demos = raw.demos;
  const errors = [];

  if (!Array.isArray(demos)) {
    throw new Error('demos.json: expected a top-level "demos" array.');
  }

  const seen = new Set();
  for (const [i, demo] of demos.entries()) {
    const where = `demos[${i}]${demo?.slug ? ` (${demo.slug})` : ''}`;

    if (!demo?.slug || !SLUG_RE.test(demo.slug)) {
      errors.push(`${where}: "slug" must be lowercase-kebab-case, e.g. "sse-vs-websockets".`);
      continue;
    }
    if (seen.has(demo.slug)) errors.push(`${where}: duplicate slug.`);
    seen.add(demo.slug);

    if (!demo.title) errors.push(`${where}: missing "title".`);
    if (!demo.description) errors.push(`${where}: missing "description".`);
    if (demo.published && !DATE_RE.test(demo.published)) {
      errors.push(`${where}: "published" must be YYYY-MM-DD.`);
    }
    if (demo.status && !['live', 'draft'].includes(demo.status)) {
      errors.push(`${where}: "status" must be "live" or "draft".`);
    }

    const dir = path.join(demosDir, demo.slug);
    if (!fs.existsSync(path.join(dir, 'package.json'))) {
      errors.push(`${where}: no demos/${demo.slug}/package.json. Scaffold it with \`npm run new ${demo.slug}\`.`);
    } else if (!ownsItsBuild(demo.slug) && !fs.existsSync(path.join(dir, 'index.html'))) {
      errors.push(`${where}: demos/${demo.slug}/index.html is missing — Vite needs it as the entry point.`);
    }
  }

  // A folder nobody listed would build but never be linked to. Mark it "draft"
  // in the manifest if it is not ready yet.
  const onDisk = fs.existsSync(demosDir)
    ? fs.readdirSync(demosDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : [];
  for (const dir of onDisk) {
    if (!seen.has(dir)) errors.push(`demos/${dir}/ exists but is not listed in demos.json.`);
  }

  if (errors.length) {
    throw new Error(`demos.json is invalid:\n  - ${errors.join('\n  - ')}`);
  }

  return demos.map((demo) => ({
    tags: [],
    article: null,
    status: 'live',
    ...demo,
  }));
}
