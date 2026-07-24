import path from 'node:path';
import { createServer } from 'vite';
import { loadManifest } from './manifest.mjs';
import { demosDir, landingDir } from './paths.mjs';

/**
 * Dev server for one site at a time:
 *   npm run dev              → the landing page
 *   npm run dev hello-world  → that demo
 *
 * The landing page's demo links point at /demos/<slug>/, which only exists in a
 * real build — use `npm run preview` to click through the whole site.
 */
const slug = process.argv[2];
let root = landingDir;

if (slug) {
  const known = loadManifest().map((d) => d.slug);
  if (!known.includes(slug)) {
    console.error(`Unknown demo "${slug}". Available: ${known.join(', ') || '(none yet)'}`);
    process.exit(1);
  }
  root = path.join(demosDir, slug);
}

const server = await createServer({ root, base: '/' });
await server.listen();
server.printUrls();
