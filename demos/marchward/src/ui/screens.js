/**
 * The screens either side of a match: the setup menu, settings, the rules
 * reference and the result card.
 *
 * The rules panel is generated from the same config the rules engine reads, so
 * the movement costs and AP prices a player is shown cannot drift away from the
 * ones the game actually charges — a reference table maintained by hand is a
 * reference table that is wrong two commits later.
 */

import { AP, ARMY, COMBAT, DIFFICULTIES, MATCH, MOVEMENT, SIEGE, SUPPLY, TERRAIN, WALLS } from '../config.js';
import { THEATRE_LIST, SIDE_COLOURS } from '../theatres.js';
import { randomSeedWord } from '../rng.js';
import { legendIcon } from '../view/icons.js';

const $ = (id) => document.getElementById(id);

// --------------------------------------------------------------------------
// Setup menu
// --------------------------------------------------------------------------

export function createMenu({ onBegin, onOpenRules, onOpenSettings, audio, initial }) {
  const choice = { theatre: initial.theatre, difficulty: initial.difficulty, seed: randomSeedWord() };

  const theatreList = $('theatre-list');
  const difficultyList = $('difficulty-list');
  const seedInput = $('seed');
  seedInput.value = choice.seed;

  for (const theatre of THEATRE_LIST) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theatre';
    button.dataset.key = theatre.key;
    button.innerHTML = `
      <span class="theatre-name">${theatre.name}</span>
      <span class="theatre-where">${theatre.subtitle}</span>
      <span class="theatre-blurb">${theatre.blurb}</span>
      <span class="theatre-mix">${mixBar(theatre)}</span>
    `;
    button.addEventListener('click', () => {
      choice.theatre = theatre.key;
      audio.play('click');
      paint();
    });
    theatreList.append(button);
  }

  for (const difficulty of Object.values(DIFFICULTIES)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option';
    button.dataset.key = difficulty.key;
    button.innerHTML = `<strong>${difficulty.label}</strong><span>${difficulty.blurb}</span>`;
    button.addEventListener('click', () => {
      choice.difficulty = difficulty.key;
      audio.play('click');
      paint();
    });
    difficultyList.append(button);
  }

  function paint() {
    for (const button of theatreList.children) {
      button.setAttribute('aria-pressed', String(button.dataset.key === choice.theatre));
    }
    for (const button of difficultyList.children) {
      button.setAttribute('aria-pressed', String(button.dataset.key === choice.difficulty));
    }
  }

  $('reseed').addEventListener('click', () => {
    choice.seed = randomSeedWord();
    seedInput.value = choice.seed;
    audio.play('click');
  });

  seedInput.addEventListener('input', () => {
    choice.seed = seedInput.value.trim() || randomSeedWord();
  });

  $('begin').addEventListener('click', () => {
    // The first real click is what lets an AudioContext exist at all.
    audio.unlock();
    audio.play('turn');
    onBegin({ ...choice, seed: seedInput.value.trim() || choice.seed });
  });

  $('menu-rules').addEventListener('click', onOpenRules);
  $('menu-settings').addEventListener('click', onOpenSettings);

  paint();

  return {
    show: () => {
      $('menu').hidden = false;
    },
    hide: () => {
      $('menu').hidden = true;
    },
    choice,
  };
}

/** A little stacked bar showing a theatre's terrain mix, straight from its gen config. */
function mixBar(theatre) {
  const { mix } = theatre.gen;
  const plains = Math.max(0, 1 - mix.mountain - mix.hills - mix.forest - mix.rough);
  const parts = [
    ['plains', plains],
    ['forest', mix.forest],
    ['rough', mix.rough],
    ['hills', mix.hills],
    ['mountain', mix.mountain],
  ];
  return parts
    .map(([key, share]) => `<span style="width:${(share * 100).toFixed(1)}%;background:${theatre.palette[key]}"></span>`)
    .join('');
}

// --------------------------------------------------------------------------
// Modals
// --------------------------------------------------------------------------

export function wireModals(audio) {
  for (const button of document.querySelectorAll('[data-close]')) {
    button.addEventListener('click', () => {
      $(button.dataset.close).hidden = true;
      audio.play('click');
    });
  }

  // Escape closes whichever modal is on top; the game underneath keeps its state.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const id of ['settings', 'rules']) {
      if (!$(id).hidden) {
        $(id).hidden = true;
        return;
      }
    }
  });

  for (const id of ['rules', 'settings']) {
    $(id).addEventListener('click', (event) => {
      if (event.target === $(id)) $(id).hidden = true;
    });
  }
}

// --------------------------------------------------------------------------
// Settings
// --------------------------------------------------------------------------

export function renderSettings({ audio, settings, onChange }) {
  const body = $('settings-body');
  body.replaceChildren();

  const slider = (key, label, hint) => {
    const wrap = document.createElement('div');
    wrap.className = 'setting';
    wrap.innerHTML = `
      <label>${label}<b>${Math.round(audio.settings[key] * 100)}%</b></label>
      <input type="range" min="0" max="100" value="${Math.round(audio.settings[key] * 100)}" />
      ${hint ? `<small class="hint">${hint}</small>` : ''}
    `;
    const input = wrap.querySelector('input');
    const readout = wrap.querySelector('b');
    input.addEventListener('input', () => {
      const value = Number(input.value) / 100;
      readout.textContent = `${input.value}%`;
      audio.set(key, value);
      onChange();
    });
    body.append(wrap);
  };

  /** A slider over a plain settings value rather than an audio channel. */
  const valueSlider = (label, hint, get, set, { min = 0, max = 100, format = (v) => `${v}%` } = {}) => {
    const wrap = document.createElement('div');
    wrap.className = 'setting';
    const initial = Math.round(get() * 100);
    wrap.innerHTML = `
      <label>${label}<b>${format(initial)}</b></label>
      <input type="range" min="${min}" max="${max}" value="${initial}" />
      ${hint ? `<small class="hint">${hint}</small>` : ''}
    `;
    const input = wrap.querySelector('input');
    const readout = wrap.querySelector('b');
    input.addEventListener('input', () => {
      readout.textContent = format(Number(input.value));
      set(Number(input.value) / 100);
    });
    body.append(wrap);
  };

  const toggle = (label, hint, get, set) => {
    const row = document.createElement('div');
    row.className = 'toggle-row';
    row.innerHTML = `<span>${label}${hint ? `<small>${hint}</small>` : ''}</span>`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'switch';
    button.setAttribute('aria-pressed', String(get()));
    button.setAttribute('aria-label', label);
    button.addEventListener('click', () => {
      set(!get());
      button.setAttribute('aria-pressed', String(get()));
      audio.play('click');
      onChange();
    });
    row.append(button);
    body.append(row);
  };

  toggle(
    'Mute everything',
    'Silences effects and music without losing the levels below.',
    () => audio.settings.muted,
    (value) => audio.set('muted', value),
  );
  slider('master', 'Master volume');
  slider('sfx', 'Effects');
  slider('music', 'Music', 'A generative drone rather than a loop — it never repeats.');

  valueSlider(
    'Terrain opacity',
    'How solid the board sits over the satellite imagery of the real ground beneath it. Lower lets more of the actual place show through.',
    () => settings.tileAlpha,
    (value) => {
      settings.tileAlpha = value;
      onChange();
    },
    { min: 20, max: 100 },
  );

  toggle(
    'Shadows',
    'Long shadows off the terrain. The single most expensive thing on screen; turn it off on a laptop.',
    () => settings.shadows,
    (value) => {
      settings.shadows = value;
    },
  );

  toggle(
    'Confirm attacks',
    'Show the forecast and require a second click before committing a column to a fight.',
    () => settings.confirmAttacks,
    (value) => {
      settings.confirmAttacks = value;
    },
  );

  toggle(
    'Watch the enemy turn',
    'Play the Marcher Lords\u2019 turn out one order at a time, following the camera, instead of resolving it all at once.',
    () => settings.followAi,
    (value) => {
      settings.followAi = value;
    },
  );
}

export const openSettings = () => {
  $('settings').hidden = false;
};

// --------------------------------------------------------------------------
// Rules
// --------------------------------------------------------------------------

export function renderRules() {
  const body = $('rules-body');
  if (body.dataset.rendered) return;
  body.dataset.rendered = '1';

  const terrainRows = Object.values(TERRAIN)
    .map(
      (terrain) => `
        <tr>
          <td><span class="swatch" style="background:${THEATRE_LIST[0].palette[terrain.key]}"></span>${terrain.label}</td>
          <td>${terrain.passable ? terrain.move : '—'}</td>
          <td>${terrain.passable ? `${terrain.defense >= 1 ? '+' : ''}${Math.round((terrain.defense - 1) * 100)}%` : 'impassable'}</td>
        </tr>`,
    )
    .join('');

  const apRows = [
    ['Raise an officer', AP.spawnOfficer, 'At your castle. You may field eight in total.'],
    ['Levy 1,000 troops', AP.recruitPerThousand, 'Into a column standing on your castle, if it is supplied.'],
    ['Attack an adjacent column', AP.attack, 'Ends that column’s movement for the turn.'],
    ['Storm the castle', AP.assault, 'Also knocks a permanent bite out of the walls.'],
    ['Divide a column', AP.split, 'The detachment forms on an adjacent hex with a full allowance.'],
    ['Join two columns', 'free', `At most ${ARMY.maxOfficersPerStack} officers in the combined column.`],
    ['Raise a wall', AP.buildWall, `On an edge of a hex you hold. ${WALLS.maxSegmentsPerSide} segments at most.`],
    ['Breach a wall', AP.breachWall, `Walls take ${WALLS.integrity} turns of work to open.`],
  ]
    .map(([what, cost, note]) => `<tr><td>${what}</td><td>${typeof cost === 'number' ? `${cost} AP` : cost}</td><td style="font-family:var(--sans);color:var(--ink-dim)">${note}</td></tr>`)
    .join('');

  body.innerHTML = `
    <h2>How Marchward is played</h2>
    <p>
      Two castles, sixty-nine kilometres apart, on a board of 2 km hexes. You are
      <strong style="color:${SIDE_COLOURS.crown.primary}">the Crown</strong> in the west; the
      <strong style="color:${SIDE_COLOURS.marcher.primary}">Marcher Lords</strong> hold the east.
      Take their castle before turn ${MATCH.turnLimit}, or hold the better position when the
      campaign season ends.
    </p>

    <h3>Columns</h3>
    <div class="icon-legend">
      <img src="${legendIcon(SIDE_COLOURS.crown, { officers: 2, troops: 9000 })}" alt="A column icon" />
      <div>
        The stem leads: it points the way the column is marching, and the disc at its head carries
        the <strong>number of officers</strong>. The crossbar trails behind as the base and carries
        the <strong>troops</strong>. Troops never move without an officer, and one officer leads at
        most ${ARMY.maxTroopsPerOfficer.toLocaleString()} — so
        ${(ARMY.maxTroopsPerOfficer * 4).toLocaleString()} men need four.
        A dashed red ring means the column is cut off and deserting.
      </div>
    </div>

    <h3>Raising forces</h3>
    <p>
      Everything you field is bought with AP at your castle. <strong>Raise an officer</strong> for
      ${AP.spawnOfficer} AP — he musters into whatever column is standing on the castle, or forms a
      new one if it is empty — then <strong>levy troops</strong> into that column at
      ${AP.recruitPerThousand} AP per thousand. You may field ${ARMY.maxOfficersPerSide} officers in
      total, no more than ${ARMY.maxOfficersPerStack} in one column, and one officer leads at most
      ${ARMY.maxTroopsPerOfficer.toLocaleString()} men. A castle that has been cut off from its own
      supply cannot raise anyone at all.
    </p>

    <h3>Marching</h3>
    <p>
      A column gets ${MOVEMENT.baseAllowance} movement points, less one for every
      ${MOVEMENT.troopsPerPenalty.toLocaleString()} troops it is carrying, never below
      ${MOVEMENT.minAllowance}. That is the whole argument for dividing: 14,000 troops under two
      officers crawl, but split into two columns of 7,000 they each move fast and in different
      directions. A column may always advance at least one hex, whatever the ground costs.
    </p>
    <p>
      Two of your columns can be <strong>joined</strong> back together: select one, choose
      <em>Join another column</em>, and click a friendly column it can reach. It marches onto the
      other and the two become one. Joining is free — only dividing costs an AP — but the combined
      column may hold no more than ${ARMY.maxOfficersPerStack} officers, and it moves at the pace
      its new size allows.
    </p>
    <p>
      Marching into a hex next to an enemy column <strong>ends the march there</strong>. A small
      screening force does not have to beat an army — it only has to stand where the army must walk
      past.
    </p>
    <table class="rules-table">
      <thead><tr><th>Ground</th><th>Cost</th><th>Defence</th></tr></thead>
      <tbody>${terrainRows}</tbody>
    </table>

    <h3>Fighting</h3>
    <p>
      Officers do not fight; troops do. Both sides remove a share of the other proportional to the
      other's strength, the attacker counting for ${Math.round((COMBAT.attackerBonus - 1) * 100)}%
      more than the defender. That small edge is deliberate: attacking at parity is correct, and
      waiting is not. Terrain multiplies the defender, so the same fight is a different proposition
      uphill. You are shown the forecast before you commit.
    </p>

    <h3>Supply</h3>
    <p>
      Every turn, supply is traced from your castle through the hexes you can reach. It will not
      pass through an enemy column, an enemy wall, or a hex <em>next to</em> an enemy column unless
      you have a column there yourself. Territory you supply is what pays your AP — one extra point
      per ${AP.hexesPerBonusAp} hexes, on top of ${AP.baseIncome} — and anything cut off loses
      ${Math.round(SUPPLY.desertionRate * 100)}% of its troops a turn to desertion and cannot be reinforced.
    </p>
    <p>
      This is the cheapest way to win. Two officers on the right hex sever an army from its castle
      without ever fighting it, and the AI is looking for exactly that move against you.
    </p>

    <h3>Walls</h3>
    <p>
      A wall is raised on the <em>edge</em> between two hexes, not on a hex: select a column, choose
      <em>Raise a wall</em>, and click one of the six hexes beside it. It costs ${AP.buildWall} AP
      and you may hold ${WALLS.maxSegmentsPerSide} segments at once, so walls are for closing one
      line rather than fencing off the map.
    </p>
    <p>
      Your own walls have gates and do not slow you down. The enemy's block both
      <strong>movement</strong> and <strong>supply</strong> across that edge, which is what makes
      them worth the AP: a segment across the right gap severs a supply line as surely as an army
      standing there, and it does not have to be fed. Breaching one costs ${AP.breachWall} AP and
      ends that column's turn, and a wall takes ${WALLS.integrity} turns of work to open — so a wall
      does not stop an army, it costs the army the time you needed.
    </p>

    <h3>The siege</h3>
    <p>
      A castle starts with ${SIEGE.garrisonStart.toLocaleString()} defenders behind walls rated
      ${SIEGE.wallRatingStart} — worth ${(SIEGE.garrisonStart * SIEGE.wallRatingStart).toLocaleString()}
      in a fight, which is more than any single column may contain. You cannot simply storm it.
    </p>
    <p>
      Instead, hold the six hexes around it. Each one you occupy starves the garrison, and each
      further hex is worth more than the last:
    </p>
    <table class="rules-table">
      <thead><tr><th>Ring hexes held</th><th>Garrison lost per turn</th></tr></thead>
      <tbody>
        ${[1, 2, 3, 4, 5, 6]
          .map(
            (n) =>
              `<tr><td>${n} of 6</td><td>${Math.round(
                n * SIEGE.drainPerRingHex * (1 + SIEGE.encirclementBonus * (n - 1)),
              ).toLocaleString()}</td></tr>`,
          )
          .join('')}
      </tbody>
    </table>
    <p>
      Leave the ring and the garrison recovers ${SIEGE.regenPerTurn} a turn, so a siege that is not
      maintained achieves nothing. Every assault permanently knocks
      ${Math.round(SIEGE.assaultWallDamage * 100)}% off the walls even when it fails, so storming
      repeatedly does work — it simply costs far more than starving them first.
    </p>

    <h3>If the season runs out</h3>
    <p>
      A campaign that reaches turn ${MATCH.turnLimit} undecided is called on the position: supplied
      territory counts most, then the damage each side has done to the other's garrison, then troops
      still in the field and the strength of your own castle. A besieger who has all but taken the
      keep wins that decision — otherwise the correct play would be to sit still, and a game where
      sitting still is correct is not worth playing.
    </p>

    <h3>Action points</h3>
    <p>
      AP does not carry over. A turn's income is a turn's worth of decisions.
    </p>
    <table class="rules-table">
      <thead><tr><th>Order</th><th>Cost</th><th>Notes</th></tr></thead>
      <tbody>${apRows}</tbody>
    </table>

    <h3>Controls</h3>
    <ul>
      <li><strong>Click</strong> one of your columns to take command of it, then click a highlighted hex to march there. Only clicking a column puts it under orders — until you do, clicking the map cannot move it.</li>
      <li><strong>Click an enemy</strong> on a red hex to attack it, or the castle to storm it.</li>
      <li><strong>Click any hex</strong> — yours, theirs or empty — to open its details: what the ground costs, what it is worth to defend, whose supply it lies in, how far it is from either castle, and whatever is standing on it.</li>
      <li><strong>Drag</strong> to pan, <strong>scroll</strong> to zoom, <strong>middle-drag</strong> to tilt.</li>
      <li><strong>Space</strong> ends your turn. <strong>Tab</strong> looks through the columns that still have moves left, without putting them under orders. <strong>Escape</strong> clears the selection.</li>
    </ul>
  `;
}

export const openRules = () => {
  renderRules();
  $('rules').hidden = false;
};

// --------------------------------------------------------------------------
// Result
// --------------------------------------------------------------------------

export function showOutcome(state, summary, { onAgain, onLook }) {
  const card = $('outcome');
  const winner = state.outcome?.winner;
  $('outcome-title').textContent =
    winner === 'crown' ? 'The Crown prevails' : winner === 'marcher' ? 'The Marcher Lords prevail' : 'A stalemate';
  $('outcome-title').style.color = winner ? SIDE_COLOURS[winner].primary : 'var(--ink)';
  $('outcome-text').textContent = state.outcome?.text ?? '';

  $('outcome-stats').innerHTML = [
    ['Turns', state.turn],
    ['Ended by', state.outcome?.reason === 'capture' ? 'storming' : 'points'],
    ['Your troops', summary.crown.troops.toLocaleString()],
    ['Their troops', summary.marcher.troops.toLocaleString()],
    ['Your garrison', Math.round(summary.crown.garrison).toLocaleString()],
    ['Their garrison', Math.round(summary.marcher.garrison).toLocaleString()],
    ['Your supply', `${summary.crown.supplied} hexes`],
    ['Their supply', `${summary.marcher.supplied} hexes`],
  ]
    .map(([label, value]) => `<div><span>${label}</span><span>${value}</span></div>`)
    .join('');

  card.hidden = false;
  $('outcome-again').onclick = () => {
    card.hidden = true;
    onAgain();
  };
  $('outcome-look').onclick = () => {
    card.hidden = true;
    onLook();
  };
}
