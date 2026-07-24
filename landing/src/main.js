// Published demos only, resolved from demos.json at build time — see the
// demoManifest() plugin in vite.config.js.
import demoList from 'virtual:demos';
import { site } from '../site.config.js';

const demos = demoList
  .slice()
  .sort((a, b) => (b.published ?? '').localeCompare(a.published ?? '') || a.title.localeCompare(b.title));

document.title = site.title;
document.querySelector('[data-title]').textContent = site.title;
document.querySelector('[data-tagline]').textContent = site.tagline;

document.querySelector('[data-eyebrow]').append(link(`← back to ${site.blogName}`, site.blogUrl));
document.querySelector('[data-repo]').href = site.repoUrl;

const grid = document.querySelector('[data-grid]');
grid.append(...demos.map(card));
document.querySelector('[data-empty]').hidden = demos.length > 0;

function card(demo) {
  const li = document.createElement('li');
  li.className = 'card';

  const title = document.createElement('h2');
  // The whole card is clickable, but the link stays a real <a> for keyboard
  // and middle-click; ::after in the CSS stretches its hit area over the card.
  title.append(link(demo.title, `/demos/${demo.slug}/`, 'card-link'));

  const description = document.createElement('p');
  description.textContent = demo.description;

  li.append(title, description, meta(demo));
  return li;
}

function meta(demo) {
  const footer = document.createElement('div');
  footer.className = 'card-meta';

  for (const tag of demo.tags ?? []) {
    const el = document.createElement('span');
    el.className = 'tag';
    el.textContent = tag;
    footer.append(el);
  }

  if (demo.published) {
    const time = document.createElement('time');
    time.dateTime = demo.published;
    time.textContent = new Date(`${demo.published}T00:00:00Z`).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
    footer.append(time);
  }

  if (demo.article) {
    footer.append(link('write-up ↗', demo.article, 'article-link'));
  }

  return footer;
}

function link(text, href, className) {
  const a = document.createElement('a');
  a.textContent = text;
  a.href = href;
  if (className) a.className = className;
  return a;
}
