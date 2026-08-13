/**
 * Headless balance harness.
 *
 * Plays whole matches with the AI on both sides and reports the distribution of
 * outcomes. This is the reason the rules live behind a renderer-agnostic
 * boundary: a balance question ("does the attacker's bonus make attacking
 * correct?", "can a castle actually be taken inside the turn limit?") is
 * answered by running a thousand matches in a couple of seconds rather than by
 * playing them.
 *
 *   node scripts/selfplay.mjs [matches] [theatre] [difficulty]
 */

import { AI_SIDE, PLAYER_SIDE, createGame, endTurn, stacksOf, summarise } from '../src/model.js';
import { takeAiTurn } from '../src/ai.js';
import { validateMap } from '../src/mapgen.js';
import { MATCH } from '../src/config.js';
import { THEATRES } from '../src/theatres.js';

const matches = Number(process.argv[2] ?? 200);
const theatreArg = process.argv[3] ?? 'all';
const difficulty = process.argv[4] ?? 'marshal';
const theatres = theatreArg === 'all' ? Object.keys(THEATRES) : [theatreArg];

for (const theatreKey of theatres) {
  const tally = { 'crown-wins': 0, 'marcher-wins': 0, draw: 0, playing: 0 };
  const turns = [];
  const peakTroops = [];
  const sieges = [];
  const captures = [];
  let mapProblems = 0;
  let errors = 0;
  const started = Date.now();

  for (let i = 0; i < matches; i += 1) {
    const state = createGame({ theatreKey, seed: `bench-${i}`, difficulty });
    mapProblems += validateMap(state.map).length;

    let peak = 0;
    let sawSiege = false;

    try {
      // Two safety margins: the rules' own turn limit, and a hard cap on
      // half-turns in case a rule bug ever stops the clock advancing.
      for (let step = 0; step < MATCH.turnLimit * 2 + 8 && state.status === 'playing'; step += 1) {
        takeAiTurn(state, state.activeSide);
        peak = Math.max(peak, summarise(state, PLAYER_SIDE).troops, summarise(state, AI_SIDE).troops);
        if (state.log.some((line) => line.kind === 'siege')) sawSiege = true;
        endTurn(state);
      }
    } catch (error) {
      errors += 1;
      if (errors <= 3) console.error(`  ${theatreKey} seed bench-${i}:`, error.message);
      continue;
    }

    tally[state.status === 'playing' ? 'playing' : state.status] += 1;
    if (state.outcome?.reason === 'capture') captures.push(state.turn);
    turns.push(state.turn);
    peakTroops.push(peak);
    if (sawSiege) sieges.push(1);
  }

  const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
  const decisive = tally['crown-wins'] + tally['marcher-wins'];
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log(
    `${theatreKey.padEnd(9)} ` +
      `west ${pct(tally['crown-wins'], matches)}  east ${pct(tally['marcher-wins'], matches)}  ` +
      `draw ${pct(tally.draw, matches)}  unfinished ${pct(tally.playing, matches)}  |  ` +
      `mean ${mean(turns).toFixed(1)} turns  peak force ${Math.round(mean(peakTroops)).toLocaleString()}  ` +
      `sieges ${pct(sieges.length, matches)}  castle taken ${pct(captures.length, matches)}` +
      `${captures.length ? ` (mean turn ${mean(captures).toFixed(0)})` : ''}  |  ${elapsed}s` +
      (mapProblems ? `  BAD MAPS: ${mapProblems}` : '') +
      (errors ? `  ERRORS: ${errors}` : ''),
  );
}

function pct(n, total) {
  return `${((100 * n) / total).toFixed(0).padStart(3)}%`;
}
