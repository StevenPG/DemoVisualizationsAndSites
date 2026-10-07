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
   * line gives each side about 415 and an income of 24, a side pushed back to
   * its own castle drops to 9 or 10, and a side that has taken most of the map
   * reaches the ceiling. That spread is what makes cutting a supply line worth
   * doing.
   *
   * These are roughly double what the game first shipped with. At the old
   * income a side could afford about four officers over a whole match and spent
   * every point it had doing it, which left the board — sixty-nine kilometres
   * of it — carrying two or three columns a side. Doubling the income is what
   * pays for the larger army below.
   */
  baseIncome: 8,
  /** One extra AP per this many supplied hexes; this is what map control buys. */
  hexesPerBonusAp: 26,
  maxIncome: 34,
  spawnOfficer: 4,
  recruitPerThousand: 1,
  attack: 2,
  assault: 3,
  buildWall: 2,
  breachWall: 2,
  split: 1,
};

/**
 * Army composition. The cap per officer is the reason splitting matters: 36,000
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
  maxTroopsPerOfficer: 9000,
  /**
   * Five to a column, sixteen to a side.
   *
   * The two caps do different jobs and were both raised for the same reason.
   * Sixteen officers is what fills the board: self-play showed the fraction of
   * hexes a match touches tracks the *number of columns* on it and barely moves
   * with how big each one is, so eight officers meant a permanently empty map
   * however many men they led. Five to a column keeps concentrating an army
   * expensive — a 45,000-strong host still needs every officer a column can
   * hold, and crawls at the movement floor once it has them.
   */
  maxOfficersPerStack: 5,
  maxOfficersPerSide: 16,
  recruitStep: 1000,
  /** What each side deploys on turn one, before any AP is spent. */
  startingColumns: 3,
  startingOfficers: 2,
  startingTroops: 10000,
};

/**
 * Movement allowance in movement points, before terrain costs. A lone officer
 * with a light escort covers six plains hexes (12 km); a 36,000-strong host
 * manages three. That gap is the whole argument for detaching.
 */
export const MOVEMENT = {
  baseAllowance: 6,
  troopsPerPenalty: 8000,
  /**
   * Three, so that the largest host on the board can still enter hills, which
   * cost three. A floor below the most expensive passable terrain does not slow
   * big armies down, it walls them out of whole regions — at the old floor of
   * two, anything over 15,000 men was shut out of every hill on the map.
   */
  minAllowance: 3,
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
 * Starting garrison times wall rating is ~57,600 effective defenders, which no
 * single field army can carry — the largest column the officer caps allow holds
 * 45,000 and attacks as 51,750. Storming it means first starving it: every hex
 * of its ring you hold drains the garrison, and the drain climbs steeply as the
 * ring closes. That is the intended path — surround, whittle, then assault.
 */
export const SIEGE = {
  /**
   * Big enough that one column cannot carry it.
   *
   * That invariant is the whole reason the siege rules exist, and it is
   * relative to how big a column can get. A full column now holds 45,000, which
   * against the old 12,000 garrison behind 1.8 walls removed the lot in a
   * single assault — the castle fell to one army walking up to it, and the
   * encirclement game never happened. At 32,000 the first assault takes about
   * 18,000 and leaves the attacker too weak to finish, so the garrison still
   * has to be starved first.
   */
  garrisonStart: 32000,
  garrisonMax: 34000,
  wallRatingStart: 1.8,
  wallRatingMin: 1.0,
  /** Garrison recovered per turn when no enemy stands on the ring. */
  regenPerTurn: 800,
  /**
   * Starvation per turn for each ring hex the besieger holds.
   *
   * This number decides whether the game has an ending. At 250 a partial siege
   * of two or three hexes took twenty-odd turns to matter, which is longer than
   * the match — so every game ran to the turn limit and was settled on points,
   * and the siege rules may as well not have existed. It has to scale with the
   * garrison, and the garrison went up by a factor of nearly three: against
   * 32,000 defenders a three-hex investment starves them in about two turns and
   * a pair of ring hexes in four, which keeps encircling worth the columns it
   * ties up now that there are more columns to tie up.
   */
  drainPerRingHex: 3400,
  /**
   * How much each further hex of the ring is worth on top of its own drain.
   *
   * The curve is superlinear because a flat rate gets the incentives exactly
   * backwards: a token one-hex investment ought to be nearly worthless and a
   * real four-column encirclement ought to be decisive, but multiplying a flat
   * rate by the hex count makes the first hex as valuable as the fourth. At
   * 0.35 per extra hex the drain runs 3,400 / 9,180 / 17,340 / 27,880 / 40,800
   * / 56,100, so one column tightening the ring is worth more than the one
   * before it — which is what makes committing to a siege a decision rather than a
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
  maxSegmentsPerSide: 18,
  integrity: 2,
  /**
   * How far from the column raising it a wall may be built.
   *
   * Zero was the old rule: a column had to be standing on one of the two hexes
   * the edge divides, so closing a line meant marching somebody to every
   * segment of it in turn — several turns of movement spent on what is meant to
   * be an engineering decision, and the reason walls were hardly ever built. A
   * radius lets a column wall the ground around itself, which is what a column
   * with picks and timber could actually do. The ground still has to be inside
   * your own supply, so this never reaches into territory you do not hold.
   */
  buildRange: 2,
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
export const MATCH = { turnLimit: 52 };

/**
 * How the opponent weighs things that are not difficulty-specific.
 */
export const AI = {
  /**
   * How strongly a column avoids standing near another of its own.
   *
   * Without it every column takes the same road, because the same cost field
   * says the same thing to all of them — which is why raising the officer cap
   * on its own did nothing for how much of the board a match used. A mild
   * aversion to crowding spreads the advance onto a broad front, and in
   * self-play it lifted board usage from nine percent to thirteen at the same
   * column count. It is better play as well as a better picture: an army strung
   * across the map covers more approaches and is far harder to cut off in one
   * place.
   */
  spread: 110,
};

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
