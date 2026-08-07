/**
 * Map pins for the selected mover, as inline SVG data URIs.
 *
 * Data URIs rather than files so the billboard is available the instant a point
 * is clicked — a network round trip here would show up as a blank frame between
 * the click and the marker appearing.
 */

import { GROUND, KINDS, PLANE, SATELLITE, SHIP } from './config.js';

const PIN = 'M22 1.5C11.2 1.5 2.5 10.2 2.5 21c0 13.9 19.5 34.5 19.5 34.5S41.5 34.9 41.5 21C41.5 10.2 32.8 1.5 22 1.5z';

const GLYPHS = {
  [SHIP]:
    '<path d="M12.5 24.8h19l-3.2 5.9H15.7z"/>' +
    '<rect x="18.6" y="15.6" width="6.8" height="7.6" rx="1.1"/>' +
    '<rect x="21.1" y="10.4" width="1.8" height="5.4" rx="0.9"/>',
  [PLANE]:
    '<path d="M22 9.2c1.25 0 2.05 1.7 2.05 4.2v3.5l7.75 4.75v2.4l-7.75-2.1v5.05l2.7 2v2l-4.75-1.15-4.75 1.15v-2l2.7-2V21.9l-7.75 2.1v-2.4l7.75-4.75v-3.5c0-2.5.8-4.2 2.05-4.2z"/>',
  [GROUND]:
    '<path d="M10.6 15.9h11.6v9.4H10.6z"/>' +
    '<path d="M22.2 18.9h4.9l3.4 3.6v2.8h-8.3z"/>' +
    '<circle cx="15" cy="27" r="2.4"/>' +
    '<circle cx="26.6" cy="27" r="2.4"/>',
  [SATELLITE]:
    '<rect x="18.7" y="17.6" width="6.6" height="8.4" rx="1.1"/>' +
    '<path d="M7.6 19.2h9.6v5.2H7.6z"/>' +
    '<path d="M26.8 19.2h9.6v5.2h-9.6z"/>' +
    '<path d="M21.2 11.6h1.6v6h-1.6z"/>' +
    '<circle cx="22" cy="10.4" r="2.1"/>',
};

function pin(color, glyph) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="58" viewBox="0 0 44 58">` +
    `<path d="${PIN}" fill="${color}" stroke="#0b1220" stroke-width="2.2"/>` +
    `<circle cx="22" cy="21" r="14.2" fill="#0b1220" opacity="0.92"/>` +
    `<g fill="${color}">${glyph}</g>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** kind index -> data URI. Built once at module load; there are four of them. */
export const PIN_ICONS = KINDS.map((kind) => pin(kind.color, GLYPHS[kind.index]));

/** Same glyphs at badge size, for the control panel legend. */
export function legendSvg(kind) {
  return (
    `<svg viewBox="4 6 36 28" aria-hidden="true"><g fill="${kind.color}">${GLYPHS[kind.index]}</g></svg>`
  );
}
