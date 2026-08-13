/**
 * The four theatres.
 *
 * Each one anchors the board to a real rectangle of ground, which is what makes
 * the distances honest: a hex is 2 km because the board really is ~69 km wide
 * where it sits. The terrain itself is generated, not sampled — real elevation
 * would put the mountains wherever they actually are, and a strategy game needs
 * a board that varies between matches. What the location gives us is the
 * horizon beyond the board edge, the sun angle for the latitude, and a palette
 * and generator bias that make each theatre play and read differently.
 */

export const THEATRES = {
  marches: {
    key: 'marches',
    name: 'The Welsh Marches',
    subtitle: 'Ludlow — Shrewsbury, 52°N',
    blurb:
      'The contested Anglo-Welsh border the word marchward comes from, and the most heavily castled ground in Britain. Rolling country with wooded valleys — good going almost everywhere, so the fight is decided by manoeuvre rather than by terrain.',
    centre: { longitude: -2.8, latitude: 52.45 },
    /** Rough month-of-year the light is set for; drives sun angle and warmth. */
    lightHour: 9.5,
    palette: {
      plains: '#86a04e',
      rough: '#9a9161',
      forest: '#3d5f37',
      hills: '#7d7550',
      mountain: '#7c7468',
      river: '#35657f',
      ford: '#5f8496',
      basePlate: '#4a4433',
      fogColour: '#b9c6cd',
    },
    gen: {
      frequency: 3.4,
      elevationBias: -0.04,
      ridgeWeight: 0.35,
      // Rolling and largely open: good going nearly everywhere, so the fight is
      // decided by manoeuvre rather than by the ground.
      mix: { mountain: 0.04, hills: 0.16, forest: 0.22, rough: 0.16 },
      rivers: 2,
      trunkRiver: false,
    },
  },

  rhine: {
    key: 'rhine',
    name: 'The Rhine Gorge',
    subtitle: 'Bingen — Koblenz, 50°N',
    blurb:
      'A deep river valley with vineyard slopes rising sharply on both banks. One trunk river runs the length of the board, so the whole campaign turns on which fords you hold — and on whether you can afford to be caught on the wrong bank.',
    centre: { longitude: 7.65, latitude: 50.15 },
    lightHour: 10.5,
    palette: {
      plains: '#8f9a56',
      rough: '#9c8d67',
      forest: '#35512f',
      hills: '#85714f',
      mountain: '#6d6257',
      river: '#2d5f7d',
      ford: '#5a7f93',
      basePlate: '#443a2c',
      fogColour: '#aebac4',
    },
    gen: {
      frequency: 3.9,
      elevationBias: 0.06,
      ridgeWeight: 0.55,
      // Steep valley walls either side of the trunk river. The high ground is
      // real, but there is still enough lowland to march an army along.
      mix: { mountain: 0.1, hills: 0.26, forest: 0.14, rough: 0.14 },
      rivers: 1,
      trunkRiver: true,
    },
  },

  loire: {
    key: 'loire',
    name: 'The Loire Valley',
    subtitle: 'Blois — Amboise, 47°N',
    blurb:
      'Broad chalk plains either side of a slow river, dense with real chateaux. The most open board of the four: armies move fast and there is very little cover, so a mistake in the centre is visible from ten hexes away and punished immediately.',
    centre: { longitude: 1.2, latitude: 47.45 },
    lightHour: 11,
    palette: {
      plains: '#a8b063',
      rough: '#b3a878',
      forest: '#4a6b3c',
      hills: '#9a8f66',
      mountain: '#8a8377',
      river: '#3b7091',
      ford: '#6c8fa0',
      basePlate: '#544a35',
      fogColour: '#cdd3d0',
    },
    gen: {
      frequency: 2.8,
      elevationBias: -0.14,
      ridgeWeight: 0.2,
      // Two thirds plains. The most open board of the four by a wide margin.
      mix: { mountain: 0.01, hills: 0.06, forest: 0.12, rough: 0.13 },
      rivers: 1,
      trunkRiver: true,
    },
  },

  cheviots: {
    key: 'cheviots',
    name: 'The Anglo-Scottish Border',
    subtitle: 'The Cheviots, Berwick — Carlisle, 55°N',
    blurb:
      'Bleak heather upland cut by steep burns, and the hardest going of the four. Almost half the board is hill or rough ground, movement allowances go nowhere, and a small force holding a saddle can stop an army four times its size.',
    centre: { longitude: -2.2, latitude: 55.45 },
    lightHour: 8.5,
    palette: {
      plains: '#6f7a4e',
      rough: '#7d7256',
      forest: '#35482f',
      hills: '#6a5b55',
      mountain: '#5d5751',
      river: '#34606f',
      ford: '#587c8a',
      basePlate: '#3b3629',
      fogColour: '#a4aeb4',
    },
    gen: {
      frequency: 4.4,
      elevationBias: 0.12,
      ridgeWeight: 0.5,
      // A third of the board is hill and a quarter is rough: the hardest going
      // of the four, where a small force on a saddle stops a much larger one.
      mix: { mountain: 0.09, hills: 0.34, forest: 0.06, rough: 0.24 },
      rivers: 3,
      trunkRiver: false,
    },
  },
};

export const THEATRE_LIST = Object.values(THEATRES);
export const DEFAULT_THEATRE = 'marches';

/** Colours for the two sides, shared across every theatre so they stay learnable. */
export const SIDE_COLOURS = {
  crown: { key: 'crown', name: 'The Crown', primary: '#4d7fbe', dark: '#25436b', light: '#a9c8ec' },
  marcher: { key: 'marcher', name: 'The Marcher Lords', primary: '#c1523f', dark: '#6d2418', light: '#efab99' },
};
