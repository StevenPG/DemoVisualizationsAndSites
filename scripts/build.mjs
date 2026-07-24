import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';
import { loadManifest } from './manifest.mjs';
import { demoBase, demosDir, distDir, landingDir } from './paths.mjs';

/**
 * Builds the whole deployable:
 *
 *   dist/index.html          landing page
 *   dist/demos.json          the manifest, so other sites can list the demos
 *   dist/demos/<slug>/       each demo, built as its own standalone site
 *
 * Everything is static — point Cloudflare Pages at `dist` and it just works.
 */
let demos;
try {
  demos = loadManifest();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

fs.rmSync(distDir, { recursive: true, force: true });

console.log('→ landing');
await build({ root: landingDir, logLevel: 'warn' });

for (const demo of demos) {
  console.log(`→ demos/${demo.slug}${demo.status === 'draft' ? ' (draft — built but unlisted)' : ''}`);
  await build({ root: path.join(demosDir, demo.slug), logLevel: 'warn' });

  const html = path.join(distDir, 'demos', demo.slug, 'index.html');
  if (!fs.existsSync(html)) {
    throw new Error(
      `demos/${demo.slug} built without an index.html at ${html}. ` +
        `Its vite.config.js should use defineDemoConfig('${demo.slug}') so the output lands in the right place.`,
    );
  }
}

fs.writeFileSync(
  path.join(distDir, 'demos.json'),
  `${JSON.stringify(
    {
      demos: demos
        .filter((demo) => demo.status !== 'draft')
        .map(({ slug, title, description, tags, published, article }) => ({
          slug,
          title,
          description,
          tags,
          published: published ?? null,
          article,
          url: demoBase(slug),
        })),
    },
    null,
    2,
  )}\n`,
);

console.log(`\nBuilt ${demos.length} demo${demos.length === 1 ? '' : 's'} + landing page into dist/`);
