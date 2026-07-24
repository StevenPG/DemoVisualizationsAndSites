import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const demosDir = path.join(repoRoot, 'demos');
export const landingDir = path.join(repoRoot, 'landing');
export const distDir = path.join(repoRoot, 'dist');
export const manifestPath = path.join(repoRoot, 'demos.json');

/** Public URL a demo is served from, relative to the site root. */
export const demoBase = (slug) => `/demos/${slug}/`;
