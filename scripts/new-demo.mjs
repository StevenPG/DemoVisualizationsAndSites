import fs from 'node:fs';
import path from 'node:path';
import { demosDir, manifestPath, repoRoot } from './paths.mjs';

/**
 * Scaffolds a demo: copies scripts/template/ into demos/<slug>/ and adds the
 * matching entry to demos.json.
 *
 *   npm run new my-slug -- "Optional Display Title"
 */
const [slug, ...titleParts] = process.argv.slice(2);
const templateDir = path.join(repoRoot, 'scripts', 'template');

if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
  console.error('Usage: npm run new <slug> -- "Title"\n  slug must be lowercase-kebab-case, e.g. "sse-vs-websockets"');
  process.exit(1);
}

const target = path.join(demosDir, slug);
if (fs.existsSync(target)) {
  console.error(`demos/${slug}/ already exists.`);
  process.exit(1);
}

const title =
  titleParts.join(' ') ||
  slug.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');

copyTemplate(templateDir, target);

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.demos.push({
  slug,
  title,
  description: 'TODO: one sentence on what this demo shows.',
  tags: [],
  published: new Date().toISOString().slice(0, 10),
  article: null,
  status: 'draft',
});
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Created demos/${slug}/ and added it to demos.json as a draft.

  npm install          # link the new workspace
  npm run dev ${slug}

Flip its "status" to "live" in demos.json when you want it on the landing page.`);

function copyTemplate(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyTemplate(src, dest);
    } else {
      const contents = fs.readFileSync(src, 'utf8').replaceAll('__SLUG__', slug).replaceAll('__TITLE__', title);
      fs.writeFileSync(dest, contents);
    }
  }
}
