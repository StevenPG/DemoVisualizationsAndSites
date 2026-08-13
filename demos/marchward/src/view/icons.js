/**
 * The column icon, drawn to a canvas and used as a billboard texture.
 *
 * The shape is an upside-down T with the stem leading: the long stem points the
 * way the column is heading with the officer count in a disc at its head, and
 * the crossbar trails behind it as the base, carrying the troop count. Rotating
 * the whole icon to face the direction of march is what makes a board full of
 * columns readable at a glance — you can see which way an army is pointed
 * without selecting it.
 *
 * The shapes rotate; the text does not. Numbers that turned upside down with
 * the icon would be unreadable for half the compass, so the glyph positions are
 * rotated and the labels are then drawn upright at those points.
 */

import { ARMY } from '../config.js';

const SIZE = 160;
const CENTRE = SIZE / 2;

/** Icon geometry in the un-rotated frame, where forward is -y. */
const STEM = { tip: -56, tail: 16, halfWidth: 9 };
const DISC = { at: -50, radius: 18 };
const BAR = { halfWidth: 47, top: 16, bottom: 48 };

const cache = new Map();

/**
 * A column's icon. Cached on everything that changes its appearance, because a
 * board of sixteen columns re-rendered on every camera move would otherwise
 * redraw sixteen canvases a frame.
 */
export function columnIcon(stack, colours, { selected = false, spent = false } = {}) {
  const bearing = Math.round(stack.facing * 32) / 32;
  const key = [
    colours.primary,
    stack.officers,
    stack.troops,
    bearing,
    stack.supplied ? 1 : 0,
    selected ? 1 : 0,
    spent ? 1 : 0,
  ].join(':');

  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = draw(stack, colours, { bearing, selected, spent });
  // The board can only ever hold a few dozen distinct icons at once, but troop
  // counts change every battle, so the cache is bounded rather than unbounded.
  if (cache.size > 400) cache.clear();
  cache.set(key, canvas);
  return canvas;
}

function draw(stack, colours, { bearing, selected, spent }) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  const lone = stack.troops <= 0;
  const alpha = spent ? 0.62 : 1;
  ctx.globalAlpha = alpha;

  if (selected) {
    ctx.beginPath();
    ctx.arc(CENTRE, CENTRE, 72, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffe9a8';
    ctx.lineWidth = 6;
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(CENTRE, CENTRE);
  ctx.rotate(bearing);

  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = colours.primary;
  ctx.strokeStyle = colours.dark;
  ctx.lineWidth = 6;
  ctx.lineJoin = 'round';

  // The stem, leading.
  roundedRect(ctx, -STEM.halfWidth, STEM.tip, STEM.halfWidth * 2, STEM.tail - STEM.tip, 8);
  ctx.fill();
  ctx.stroke();

  // The crossbar, trailing. A lone officer has no troops to draw a base for.
  if (!lone) {
    roundedRect(ctx, -BAR.halfWidth, BAR.top, BAR.halfWidth * 2, BAR.bottom - BAR.top, 9);
    ctx.fill();
    ctx.stroke();
  }

  ctx.shadowColor = 'transparent';

  // The officer disc at the head of the stem.
  ctx.beginPath();
  ctx.arc(0, DISC.at, DISC.radius, 0, Math.PI * 2);
  ctx.fillStyle = colours.dark;
  ctx.fill();
  ctx.strokeStyle = atCapacity(stack) ? '#ffd97a' : colours.light;
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.restore();

  // Labels, upright wherever the icon is pointing.
  const rotate = (x, y) => ({
    x: CENTRE + x * Math.cos(bearing) - y * Math.sin(bearing),
    y: CENTRE + x * Math.sin(bearing) + y * Math.cos(bearing),
  });

  const discAt = rotate(0, DISC.at);
  label(ctx, String(stack.officers), discAt.x, discAt.y, 23, '#ffffff');

  if (!lone) {
    const barAt = rotate(0, (BAR.top + BAR.bottom) / 2);
    label(ctx, stack.troops.toLocaleString(), barAt.x, barAt.y, 24, '#ffffff');
  }

  // A column that cannot trace supply home is bleeding men every turn, which
  // matters more than anything else on the icon.
  if (!stack.supplied) {
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(CENTRE, CENTRE, 66, 0, Math.PI * 2);
    ctx.setLineDash([9, 8]);
    ctx.strokeStyle = '#ff6b57';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  return canvas;
}

const atCapacity = (stack) => stack.troops >= stack.officers * ARMY.maxTroopsPerOfficer;

function label(ctx, text, x, y, size, colour) {
  ctx.font = `700 ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.72)';
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

/**
 * The same shape at rest, pointing north, for the rules panel and the legend.
 * Returns a data URL so it can go straight into an <img>.
 */
export function legendIcon(colours, { officers = 2, troops = 9000 } = {}) {
  return draw(
    { officers, troops, facing: 0, supplied: true },
    colours,
    { bearing: 0, selected: false, spent: false },
  ).toDataURL();
}
