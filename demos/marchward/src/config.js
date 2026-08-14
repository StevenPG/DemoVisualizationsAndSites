/**
 * Every tunable number in Marchward, in one place.
 *
 * The rules module reads these and nothing else, so balancing the game means
 * editing this file rather than hunting through the logic. The values are
 * chosen against one target: a match should reach the enemy castle around turn
 * 8-12 and end somewhere between turn 25 and 35.
 */

/**
 * The board. 2 km flat-to-flat hexes over a 34 x 26 grid works out at roughly
 * 69 x 45 km of real ground — a theatre an army crosses in about eight turns,
 * which is long enough that committing to a flank is a real decision.
 */
export const BOARD = {
  cols: 34,
  rows: 26,
  /** Distance between the centres of two neighbouring hexes, in metres. */
  hexSpacingMeters: 2000,
};

/**
 * Height of each terrain type above the base plate, in metres, before
 * exaggeration. These are roughly true to life for 2 km hexes; the
 * exaggeration below is what makes relief readable from a near-top-down
 * camera, where honest heights read as flat.
 */
export const RELIEF = {
  exaggeration: 3.2,
  base: 40,
  /**
   * Opacity of the terrain tiles.
   *
   * Slightly translucent so the satellite imagery of the real ground shows
   * through the generated board — the point of anchoring the theatre to a
   * genuine rectangle of the world is rather lost if the board hides it. At
   * 0.76 the ground underneath was still hard to make out, so this sits a good
   * deal lower; it is a setting rather than a constant because how it reads
   * depends entirely on the imagery beneath, which varies by theatre.
   */
  tileAlpha: 0.55,
  heights: {
    river: 4,
    ford: 14,
    plains: 40,
    rough: 78,
    forest: 92,
    hills: 190,
    mountain: 430,
  },
};

/**
 * Terrain. `move` is the movement points it costs to enter, `defense` scales
 * the troops of whoever is standing there when they are attacked.
 *
 * Mountains and rivers are impassable rather than merely expensive, on purpose:
 * a board where everything is walkable has no geography, and the whole siege
 * game depends on there being lines worth cutting. Fords are the exception that
 * makes rivers interesting — cheap to hold, and bad ground to be caught on.
 */
export const TERRAIN = {
  plains: { key: 'plains', label: 'Plains', move: 1, defense: 1.0, passable: true },
  rough: { key: 'rough', label: 'Rough ground', move: 2, defense: 1.15, passable: true },
  forest: { key: 'forest', label: 'Forest', move: 2, defense: 1.2, passable: true },
  hills: { key: 'hills', label: 'Hills', move: 3, defense: 1.35, passable: true },
  ford: { key: 'ford', label: 'Ford', move: 3, defense: 0.9, passable: true },
  river: { key: 'river', label: 'River', move: Infinity, defense: 1.0, passable: false },
  mountain: { key: 'mountain', label: 'Mountain', move: Infinity, defense: 1.0, passable: false },
};

/**
 * Action points. Movement is deliberately *not* paid for in AP — it comes out
 * of a per-stack allowance that shrinks as the stack grows, so AP stays the
 * currency of decisions (who to raise, what to attack, where to wall) rather
 * than a second movement budget.
 */
export const AP = {
  /**
   * The floor, which keeps a side that has lost everything still able to act.
   *
   * The scale here is set against contested territory rather than reachable
   * territory: the board holds roughly 830 passable hexes, so an even front
   * line gives each side about 415 and an income of 13, a side pushed back to
   * its own castle drops to 5 or 6, and a side that has taken most of the map
   * reaches the ceiling. That spread is what makes cutting a supply line worth
   * doing.
   */
  baseIncome: 4,
  /** One extra AP per this many supplied hexes; this is what map control buys. */
  hexesPerBonusAp: 45,
  maxIncome: 18,
  spawnOfficer: 4,
  recruitPerThousand: 1,
  attack: 2,
  assault: 3,
  buildWall: 3,
  breachWall: 2,
  split: 1,
};

/**
 * Army composition. The cap per officer is the reason splitting matters: 24,000
 * troops cannot exist without four officers to lead them, and four officers in
 * one stack move at a crawl.
 */
export const ARMY = {
  /**
   * How far away a column may be and still be joined.
   *
   * Adjacent only. Joining is a march onto the other column, so without this it
   * reached as far as the mover could march — five hexes on good ground — and
   * two columns on opposite sides of a valley could fuse in a turn. Requiring
   * them to already be side by side keeps concentrating an army something you
   * have to spend turns arranging.
   */
  joinRange: 1,
  maxTroopsPerOfficer: 6000,
  maxOfficersPerStack: 4,
  maxOfficersPerSide: 8,
  recruitStep: 1000,
};

/**
 * Movement allowance in movement points, before terrain costs. A lone officer
 * with a light escort covers five plains hexes (10 km); a 20,000-strong host
 * manages two. That gap is the whole argument for detaching.
 */
export const MOVEMENT = {
  baseAllowance: 5,
  troopsPerPenalty: 5000,
  minAllowance: 2,
};

/**
 * Combat is a straight exchange: each side removes a share of the other
 * proportional to the other's effective strength. No hit points, no rounds —
 * you can do the arithmetic in your head before committing, which is the point.
 *
 * The attacker's bonus is small on purpose. It is enough that attacking at
 * parity is correct and waiting is not, without making defence pointless.
 */
export const COMBAT = {
  attackerBonus: 1.15,
  /** Fraction of the opposing effective strength each side loses. */
  exchange: 0.35,
  /** Random band applied to each side's roll, +/- this fraction. */
  variance: 0.15,
};

/**
 * The castle, and the siege that takes it.
 *
 * Starting garrison times wall rating is ~21,600 effective defenders, which no
 * single field army can carry. Storming it means first starving it: every hex
 * of its ring you hold drains the garrison, and holding all six drains at
 * double rate. That is the intended path — surround, whittle, then assault.
 */
export const SIEGE = {
  garrisonStart: 12000,
  garrisonMax: 13000,
  wallRatingStart: 1.8,
  wallRatingMin: 1.0,
  /** Garrison recovered per turn when no enemy stands on the ring. */
  regenPerTurn: 300,
  /**
   * Starvation per turn for each ring hex the besieger holds.
   *
   * This number decides whether the game has an ending. At 250 a partial siege
   * of two or three hexes took twenty-odd turns to matter, which is longer than
   * the match — so every game ran to the turn limit and was settled on points,
   * and the siege rules may as well not have existed. At 600 a three-hex
   * investment starves the garrison in about seven turns and a full ring does it
   * in two, which makes encircling worth the columns it ties up.
   */
  drainPerRingHex: 600,
  /**
   * How much each further hex of the ring is worth on top of its own drain.
   *
   * The curve is superlinear because a flat rate gets the incentives exactly
   * backwards: a token one-hex investment ought to be nearly worthless and a
   * real four-column encirclement ought to be decisive, but multiplying a flat
   * rate by the hex count makes the first hex as valuable as the fourth. At
   * 0.35 per extra hex the drain runs 600 / 1,620 / 3,060 / 4,920 / 7,200 /
   * 9,900, so one column tightening the ring is worth more than the one before
   * it — which is what makes committing to a siege a decision rather than a
   * formality.
   */
  encirclementBonus: 0.35,
  /** Fraction of the remaining wall rating a successful assault knocks off. */
  assaultWallDamage: 0.15,
};

/**
 * Walls sit on the edge between two hexes and block movement and supply both
 * ways. Capping them per side keeps them a tool for closing one line rather
 * than a way to fence off half the board.
 */
export const WALLS = {
  maxSegmentsPerSide: 8,
  integrity: 2,
};

/**
 * Supply is traced from your castle each turn through hexes you can reach.
 * Enemy stacks exert a zone of control over their neighbours, so two officers
 * detached onto a road can cut an army off from home without ever fighting it —
 * which is the cheapest way to win and the one the AI looks for.
 */
export const SUPPLY = {
  /** Fraction of its troops a cut-off stack loses each turn to desertion. */
  desertionRate: 0.08,
  /** Below this many troops a cut-off stack disbands entirely. */
  disbandThreshold: 400,
};

/** Turn at which the match is called on points, so a stalemate cannot run forever. */
export const MATCH = { turnLimit: 40 };

export const DIFFICULTIES = {
  squire: {
    key: 'squire',
    label: 'Squire',
    blurb: 'The AI plays honestly and cautiously, and will not press an even fight.',
    apMultiplier: 0.85,
    aggression: 0.45,
    lookahead: 1,
  },
  marshal: {
    key: 'marshal',
    label: 'Marshal',
    blurb: 'An even match. Same AP income as you, and it will cut your supply if you let it.',
    apMultiplier: 1.0,
    aggression: 0.7,
    lookahead: 2,
  },
  warden: {
    key: 'warden',
    label: 'Warden',
    blurb: 'Extra AP income, and it screens, flanks and besieges without hesitating.',
    apMultiplier: 1.2,
    aggression: 0.9,
    lookahead: 2,
  },
};
