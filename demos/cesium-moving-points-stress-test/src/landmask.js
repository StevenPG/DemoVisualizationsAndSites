/**
 * A global land/ocean bitmap, built at startup from imagery that is already
 * sitting in the bundle.
 *
 * Cesium ships the Natural Earth II base layer inside its static assets
 * (Assets/Textures/NaturalEarthII, a TMS pyramid with levels 0–2). Level 2 is
 * 8x4 tiles of 256 px = a 2048x1024 grid at 0.17578125° per pixel, roughly
 * 19 km at the equator. That is plenty to keep ships off Kansas, and it costs
 * 32 local JPEG fetches and no new dependency — which is the whole reason for
 * doing it this way instead of shipping a coastline dataset.
 *
 * Classification is a colour test. The recoloured NE2 raster paints ocean a
 * flat, distinctly blue tone while land runs through greens, tans and the
 * near-white of ice, so "noticeably more blue than red" separates them
 * cleanly. Inland lakes come out as ocean, which is fine — a ship on Lake
 * Superior is a feature.
 */

const TILE = 256;
const LEVEL = 2;
const TILES_X = 2 << LEVEL; // 8
const TILES_Y = 1 << LEVEL; // 4
const WIDTH = TILES_X * TILE; // 2048
const HEIGHT = TILES_Y * TILE; // 1024

const OCEAN = 1 << 0;
/** Set when all four neighbours share this pixel's class — i.e. not a coastal pixel. */
const INTERIOR = 1 << 1;

const DEG = 180 / Math.PI;

export class LandMask {
  /**
   * @param {Uint8Array|null} cells One flag byte per pixel, row 0 = north pole.
   *   Null means classification failed and every query degrades to "anything
   *   goes", so the demo still runs — just with ships on land.
   */
  constructor(cells) {
    this.cells = cells;
    this.available = cells !== null;
    this.landFraction = 0;
    if (cells) {
      let land = 0;
      for (let i = 0; i < cells.length; i++) if (!(cells[i] & OCEAN)) land++;
      this.landFraction = land / cells.length;
    }
  }

  /** @returns {boolean} true if this position is water. Always true when unavailable. */
  isOcean(lonRad, latRad) {
    if (!this.cells) return true;
    return (this.cells[this.#index(lonRad, latRad)] & OCEAN) !== 0;
  }

  isLand(lonRad, latRad) {
    if (!this.cells) return true;
    return (this.cells[this.#index(lonRad, latRad)] & OCEAN) === 0;
  }

  /**
   * Rejection-samples a position of the requested domain, area-weighted so the
   * points spread evenly over the sphere rather than piling up at the poles.
   *
   * Spawns are held to INTERIOR pixels so nothing appears straddling a
   * coastline it would immediately be retired for crossing.
   *
   * @param {'ocean'|'land'|'any'} domain
   * @param {() => number} rand
   * @param {number} maxLatRad Keep clear of the poles, where the lon step blows up.
   * @returns {{lon: number, lat: number}} radians
   */
  sample(domain, rand, maxLatRad) {
    const sinCap = Math.sin(maxLatRad);
    const propose = () => ({
      lon: (rand() * 2 - 1) * Math.PI,
      lat: Math.asin((rand() * 2 - 1) * sinCap),
    });

    if (domain === 'any' || !this.cells) return propose();

    const want = domain === 'ocean' ? OCEAN : 0;
    // Ocean is ~70% of the sphere and land ~30%, so this lands in a handful of
    // tries either way. The cap stops a pathological mask from hanging spawn.
    for (let attempt = 0; attempt < 60; attempt++) {
      const p = propose();
      const cell = this.cells[this.#index(p.lon, p.lat)];
      if ((cell & OCEAN) === want && cell & INTERIOR) return p;
    }
    return propose();
  }

  #index(lonRad, latRad) {
    let x = Math.floor(((lonRad * DEG + 180) / 360) * WIDTH);
    let y = Math.floor(((90 - latRad * DEG) / 180) * HEIGHT);
    // Longitude wraps, latitude clamps.
    x = ((x % WIDTH) + WIDTH) % WIDTH;
    if (y < 0) y = 0;
    else if (y >= HEIGHT) y = HEIGHT - 1;
    return y * WIDTH + x;
  }
}

/**
 * Decodes the bundled Natural Earth II tiles into a mask. Never throws — on any
 * failure it resolves to an unavailable mask and the caller carries on.
 *
 * @returns {Promise<LandMask>}
 */
export async function loadLandMask() {
  try {
    const base = cesiumAssetBase();
    const cells = new Uint8Array(WIDTH * HEIGHT);

    const canvas = new OffscreenCanvas(TILE, TILE);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const tiles = [];
    for (let tx = 0; tx < TILES_X; tx++) {
      for (let ty = 0; ty < TILES_Y; ty++) tiles.push([tx, ty]);
    }

    await Promise.all(
      tiles.map(async ([tx, ty]) => {
        const response = await fetch(`${base}Assets/Textures/NaturalEarthII/${LEVEL}/${tx}/${ty}.jpg`);
        if (!response.ok) throw new Error(`tile ${LEVEL}/${tx}/${ty}: HTTP ${response.status}`);
        const bitmap = await createImageBitmap(await response.blob());
        ctx.drawImage(bitmap, 0, 0, TILE, TILE);
        bitmap.close();
        const { data } = ctx.getImageData(0, 0, TILE, TILE);

        // TMS numbers rows from the south (tilemapresource.xml: Origin y=-90),
        // while the mask and the tile image both run north-first — hence the
        // flip on ty but not on the row within the tile.
        const originX = tx * TILE;
        const originY = (TILES_Y - 1 - ty) * TILE;
        for (let row = 0; row < TILE; row++) {
          let out = (originY + row) * WIDTH + originX;
          let px = row * TILE * 4;
          for (let col = 0; col < TILE; col++, out++, px += 4) {
            const r = data[px];
            const g = data[px + 1];
            const b = data[px + 2];
            if (b > r + 18 && b > g + 6) cells[out] = OCEAN;
          }
        }
      }),
    );

    markInteriors(cells);

    const mask = new LandMask(cells);
    // Earth is 29% land. A mask well outside that band means the colour test
    // missed, and silently spawning ships in deserts is worse than not trying.
    if (mask.landFraction < 0.15 || mask.landFraction > 0.45) {
      console.warn(
        `[landmask] land fraction ${(mask.landFraction * 100).toFixed(1)}% is implausible — ` +
          'falling back to unrestricted spawning.',
      );
      return new LandMask(null);
    }
    return mask;
  } catch (error) {
    console.warn('[landmask] could not build the land/ocean mask:', error);
    return new LandMask(null);
  }
}

/** Flags every pixel whose four neighbours share its class, giving spawn a coast buffer. */
function markInteriors(cells) {
  const isOcean = (i) => cells[i] & OCEAN;
  for (let y = 0; y < HEIGHT; y++) {
    const up = y > 0 ? -WIDTH : 0;
    const down = y < HEIGHT - 1 ? WIDTH : 0;
    for (let x = 0; x < WIDTH; x++) {
      const i = y * WIDTH + x;
      const self = isOcean(i);
      const left = i - x + ((x - 1 + WIDTH) % WIDTH);
      const right = i - x + ((x + 1) % WIDTH);
      if (
        isOcean(left) === self &&
        isOcean(right) === self &&
        isOcean(i + up) === self &&
        isOcean(i + down) === self
      ) {
        cells[i] |= INTERIOR;
      }
    }
  }
}

/** Where vite-plugin-cesium put Cesium's static assets, with a trailing slash. */
function cesiumAssetBase() {
  const injected = typeof window !== 'undefined' ? window.CESIUM_BASE_URL : undefined;
  const base = injected || `${import.meta.env.BASE_URL}cesium/`;
  return base.endsWith('/') ? base : `${base}/`;
}
