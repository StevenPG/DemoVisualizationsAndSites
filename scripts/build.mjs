import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { loadManifest, ownsItsBuild } from './manifest.mjs';
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
  const demoDir = path.join(demosDir, demo.slug);

  if (ownsItsBuild(demo.slug)) {
    // A demo that is several applications builds itself: it gets the public
    // base and the output directory, and is trusted with everything in between.
    // The index.html check below still applies, so "owns its build" does not
    // mean "escapes the contract".
    const { default: buildDemo } = await import(pathToFileURL(path.join(demoDir, 'build.mjs')).href);
    await buildDemo({ base: demoBase(demo.slug), outDir: path.join(distDir, 'demos', demo.slug) });
  } else {
    await build({ root: demoDir, logLevel: 'warn' });
  }

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
