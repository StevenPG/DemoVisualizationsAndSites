/**
 * The in-game interface: the stat strip, the orders panel, the chronicle, and
 * the prompt that tells you what the game is waiting for.
 *
 * Everything here reads from the model and calls back into main.js to act. The
 * panel deliberately shows the *forecast* for an attack rather than only its
 * cost, because the combat model is simple enough to be predicted and hiding it
 * would make a legible game feel like a gamble.
 */

import { AP, ARMY, MATCH, SIEGE, TERRAIN, WALLS } from '../config.js';
import {
  castleOwnerAt,
  forecastAttack,
  movementAllowance,
  recruitCapacity,
  stackAt,
  stackCapacity,
  summarise,
} from '../model.js';
import { neighboursOf } from '../hex.js';
import { columnIcon } from '../view/icons.js';

const $ = (id) => document.getElementById(id);

export function createHud({ actions, audio }) {
  let toastTimer = null;

  // ------------------------------------------------------------------
  // Top strip
  // ------------------------------------------------------------------

  function paintTop(state) {
    const side = state.sides[state.activeSide];
    $('turn-number').textContent = `Turn ${state.turn} / ${MATCH.turnLimit}`;
    const label = $('turn-side');
    label.textContent = side.isAI ? `${side.name} are moving` : `${side.name} — your move`;
    label.className = `turn-side ${state.activeSide}`;

    const you = summarise(state, 'crown');
    const them = summarise(state, 'marcher');

    const stats = [
      { label: 'Action points', value: `${you.ap}`, hint: `+${you.apIncome}/turn`, good: you.ap > 0 },
      { label: 'Officers', value: `${you.officers}/${you.officerCap}` },
      { label: 'Your troops', value: you.troops.toLocaleString() },
      { label: 'Supplied', value: `${you.supplied} hexes` },
      { label: 'Cut off', value: `${you.cutOff}`, warn: you.cutOff > 0 },
      { label: 'Walls', value: `${you.walls}/${you.wallCap}` },
      { label: 'Their garrison', value: Math.round(them.garrison).toLocaleString(), good: them.garrison < SIEGE.garrisonStart * 0.5 },
      { label: 'Their walls', value: them.wallRating.toFixed(2) },
      { label: 'Your garrison', value: Math.round(you.garrison).toLocaleString(), warn: you.garrison < SIEGE.garrisonStart * 0.4 },
    ];

    $('stat-strip').innerHTML = stats
      .map(
        (stat) => `
          <div class="stat ${stat.warn ? 'warn' : stat.good ? 'good' : ''}">
            <span class="stat-value">${stat.value}${stat.hint ? `<span style="color:var(--ink-faint);font-size:0.72em"> ${stat.hint}</span>` : ''}</span>
            <span class="stat-label">${stat.label}</span>
          </div>`,
      )
      .join('');
  }

  // ------------------------------------------------------------------
  // Orders panel
  // ------------------------------------------------------------------

  function paintOrders(state, ui) {
    const body = $('orders-body');
    const stack = ui.selectedId === null ? null : state.stacks.get(ui.selectedId);

    if (state.status !== 'playing') {
      body.innerHTML = `<h3>Orders</h3><p class="empty-note">The campaign is over.</p>`;
      return;
    }

    if (!stack) {
      const yours = [...state.stacks.values()].filter((s) => s.side === 'crown');
      body.innerHTML = `
        <h3>Orders</h3>
        <p class="empty-note">
          ${
            yours.length
              ? '<b>Click</b> one of your columns to give it orders. Press <b>Tab</b> to look through the ones that still have moves left.'
              : 'You have no columns in the field. Raise an officer at your castle to begin.'
          }
        </p>
        ${raiseBlock(state)}
      `;
      wireRaise(state);
      return;
    }

    const yours = stack.side === 'crown';
    const side = state.sides[stack.side];
    const capacity = stackCapacity(stack);
    const enemyCastle = state.sides[yours ? 'marcher' : 'crown'].castle;
    const onRing = neighboursOf(enemyCastle).includes(stack.hex);

    body.innerHTML = `
      <h3>${yours ? 'Your column' : 'Enemy column'}</h3>
      <div class="column-head">
        <img src="${columnIcon(stack, side.colours, {}).toDataURL()}" alt="" />
        <div>
          <div class="column-title">${stack.officers} officer${stack.officers === 1 ? '' : 's'}</div>
          <div class="column-sub">${stack.troops.toLocaleString()} troops${onRing ? ' · on the ring' : ''}</div>
        </div>
      </div>

      <div class="meter"><i style="width:${capacity ? Math.min(100, (stack.troops / capacity) * 100) : 0}%"></i></div>

      <dl class="readout">
        <dt>Capacity</dt><dd>${stack.troops.toLocaleString()} / ${capacity.toLocaleString()}</dd>
        <dt>Movement left</dt><dd>${yours ? `${stack.mp} / ${movementAllowance(stack)}` : movementAllowance(stack)}</dd>
        <dt>Ground</dt><dd>${TERRAIN[state.map.terrain[stack.hex]].label}</dd>
        <dt>Supply</dt><dd class="${stack.supplied ? '' : 'warn'}">${stack.supplied ? 'traced' : 'CUT OFF'}</dd>
        ${stack.attacked ? '<dt>Fought</dt><dd>this turn</dd>' : ''}
      </dl>

      ${yours && !ui.armed && state.activeSide === 'crown' ? notArmedNote() : ''}
      ${yours ? orderButtons(state, stack, ui) : enemyNote(state, stack)}
      ${ui.mode === 'split' ? splitForm(stack) : ''}
      ${ui.mode === 'recruit' ? recruitForm(state, stack) : ''}
      ${ui.mode === 'wall' ? '<p class="empty-note" style="margin-top:0.7rem">Click a hex beside this column to raise a wall along that edge.</p>' : ''}
      ${forecastBlock(state, stack, ui)}
      ${yours ? '' : raiseBlock(state)}
    `;

    if (yours) wireOrders(state, stack, ui);
    else wireRaise(state);
  }

  /** The buttons that spend AP, each one greyed with the reason it cannot be used. */
  function orderButtons(state, stack, ui) {
    const side = state.sides.crown;
    const yourTurn = state.activeSide === 'crown';
    const atCastle = stack.hex === side.castle;
    const room = recruitCapacity(state, stack);

    const button = (id, label, cost, enabled, title) =>
      `<button type="button" data-order="${id}" ${enabled ? '' : 'disabled'} title="${title ?? ''}">
        <span>${label}</span><span class="cost">${cost}</span>
      </button>`;

    const canSplit = stack.officers >= 2 && side.ap >= AP.split && yourTurn;
    const canWall =
      side.ap >= AP.buildWall && side.wallsBuilt < WALLS.maxSegmentsPerSide && yourTurn;
    const canRecruit = atCastle && room > 0 && side.ap >= AP.recruitPerThousand && side.supplied.has(side.castle) && yourTurn;

    return `
      <div class="order-buttons">
        ${button('recruit', 'Levy troops', `${AP.recruitPerThousand} AP / 1,000`, canRecruit,
          atCastle ? (room ? '' : 'This column is full — it needs another officer.') : 'Only at your castle.')}
        ${button('split', 'Divide the column', `${AP.split} AP`, canSplit,
          stack.officers < 2 ? 'A column needs two officers to divide.' : '')}
        ${button('wall', 'Raise a wall', `${AP.buildWall} AP`, canWall,
          side.wallsBuilt >= WALLS.maxSegmentsPerSide ? 'You are holding the maximum number of segments.' : '')}
        ${ui.mode !== 'select' ? '<button type="button" data-order="cancel"><span>Cancel</span></button>' : ''}
      </div>
    `;
  }

  /**
   * Shown for a column that is selected but not armed — reached by Tab rather
   * than by clicking it. The panel orders below still work; only orders given
   * by clicking the board are held back.
   */
  function notArmedNote() {
    return `<p class="empty-note" style="margin-bottom:0.7rem">
      Looking at this column. <b>Click it on the map</b> to give it marching orders.
    </p>`;
  }

  function enemyNote(state, stack) {
    return `<p class="empty-note">
      A Marcher column. ${stack.supplied ? 'It is still in supply.' : 'It is cut off and losing men every turn.'}
    </p>`;
  }

  /** Raising officers is done from the castle rather than from a column, so it lives on its own. */
  function raiseBlock(state) {
    const side = state.sides.crown;
    const officers = [...state.stacks.values()]
      .filter((s) => s.side === 'crown')
      .reduce((n, s) => n + s.officers, 0);
    const can =
      state.activeSide === 'crown' && side.ap >= AP.spawnOfficer && officers < ARMY.maxOfficersPerSide;

    return `
      <div class="order-buttons" style="margin-top:0.8rem">
        <button type="button" data-raise="officer" ${can ? '' : 'disabled'}
          title="${officers >= ARMY.maxOfficersPerSide ? 'You are already fielding eight officers.' : ''}">
          <span>Raise an officer</span><span class="cost">${AP.spawnOfficer} AP</span>
        </button>
      </div>
    `;
  }

  function splitForm(stack) {
    const maxOfficers = stack.officers - 1;
    const officers = Math.max(1, Math.floor(stack.officers / 2));
    const troops = Math.min(stack.troops, officers * ARMY.maxTroopsPerOfficer, Math.round(stack.troops / 2 / 1000) * 1000);
    return `
      <div class="sub-form" data-form="split">
        <h4>Divide the column</h4>
        <div class="field">
          <label>Officers to detach <b data-out="officers">${officers}</b></label>
          <input type="range" name="officers" min="1" max="${maxOfficers}" value="${officers}" />
        </div>
        <div class="field">
          <label>Troops to detach <b data-out="troops">${troops.toLocaleString()}</b></label>
          <input type="range" name="troops" min="0" max="${stack.troops}" step="${ARMY.recruitStep}" value="${troops}" />
        </div>
        <p class="empty-note" data-note></p>
        <div class="sub-actions">
          <button type="button" data-order="cancel">Cancel</button>
          <button type="button" class="primary" data-split-confirm>Choose a hex</button>
        </div>
      </div>
    `;
  }

  function recruitForm(state, stack) {
    const room = recruitCapacity(state, stack);
    const affordable = Math.floor(state.sides.crown.ap / AP.recruitPerThousand) * 1000;
    const max = Math.min(room, affordable);
    return `
      <div class="sub-form" data-form="recruit">
        <h4>Levy troops</h4>
        <div class="field">
          <label>Troops <b data-out="troops">${max.toLocaleString()}</b></label>
          <input type="range" name="troops" min="${ARMY.recruitStep}" max="${Math.max(ARMY.recruitStep, max)}"
                 step="${ARMY.recruitStep}" value="${max}" />
        </div>
        <p class="empty-note" data-note>Costs <b data-out="cost">${(max / 1000) * AP.recruitPerThousand}</b> AP.</p>
        <div class="sub-actions">
          <button type="button" data-order="cancel">Cancel</button>
          <button type="button" class="primary" data-recruit-confirm>Raise them</button>
        </div>
      </div>
    `;
  }

  /**
   * The attack forecast. Shown for whichever adjacent enemy the pointer is over,
   * or for the only one available if there is exactly one — the numbers are the
   * same ones the rules engine and the AI use, so nothing here is a guess.
   */
  function forecastBlock(state, stack, ui) {
    if (stack.side !== 'crown' || stack.attacked || stack.troops <= 0) return '';
    if (!ui.armed) return '';

    const target = ui.hoveredHex !== null && neighboursOf(stack.hex).includes(ui.hoveredHex) ? ui.hoveredHex : null;
    if (target === null) return '';

    const forecast = forecastAttack(state, stack, target);
    if (!forecast) return '';

    const castle = castleOwnerAt(state, target);
    const defender = castle ? state.sides[castle].garrison : stackAt(state, target)?.troops ?? 0;
    const wins = forecast.defenderLosses >= defender;
    const cost = castle ? AP.assault : AP.attack;

    return `
      <div class="forecast">
        <h4>${castle ? 'Storming the castle' : 'Attack forecast'}</h4>
        <div class="line"><span>You lose</span><span>~${forecast.attackerLosses.toLocaleString()}</span></div>
        <div class="line"><span>They lose</span><span>~${forecast.defenderLosses.toLocaleString()}</span></div>
        <div class="line"><span>Their defence</span><span>×${forecast.defenceMultiplier.toFixed(2)}</span></div>
        <div class="line"><span>Cost</span><span>${cost} AP</span></div>
        <p class="verdict">${verdict(forecast, wins, castle)}</p>
      </div>
    `;
  }

  function verdict(forecast, wins, castle) {
    if (castle && forecast.ratio < 0.7) {
      return 'The walls are far too strong for this. Starve the garrison from the ring first.';
    }
    if (wins) return 'This should break them outright and take the ground.';
    if (forecast.ratio > 1.3) return 'A clearly favourable exchange.';
    if (forecast.ratio > 1) return 'A fair exchange, slightly in your favour.';
    return 'You would come off worse. Better ground or more troops would change that.';
  }

  // ------------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------------

  function wireRaise(state) {
    const button = $('orders-body').querySelector('[data-raise="officer"]');
    button?.addEventListener('click', () => actions.raiseOfficer());
  }

  function wireOrders(state, stack, ui) {
    const body = $('orders-body');

    for (const button of body.querySelectorAll('[data-order]')) {
      button.addEventListener('click', () => actions.order(button.dataset.order, stack));
    }
    wireRaise(state);

    const splitForm = body.querySelector('[data-form="split"]');
    if (splitForm) {
      const officers = splitForm.querySelector('[name="officers"]');
      const troops = splitForm.querySelector('[name="troops"]');
      const note = splitForm.querySelector('[data-note]');

      const update = () => {
        const detachedOfficers = Number(officers.value);
        // Both halves have to be able to lead what they are carrying, so the
        // slider's own limits move as the officer split changes.
        const detachedCap = detachedOfficers * ARMY.maxTroopsPerOfficer;
        const remainingCap = (stack.officers - detachedOfficers) * ARMY.maxTroopsPerOfficer;
        const min = Math.max(0, stack.troops - remainingCap);
        const max = Math.min(stack.troops, detachedCap);
        troops.min = Math.ceil(min / ARMY.recruitStep) * ARMY.recruitStep;
        troops.max = Math.floor(max / ARMY.recruitStep) * ARMY.recruitStep;
        troops.value = Math.min(Math.max(Number(troops.value), Number(troops.min)), Number(troops.max));

        const detachedTroops = Number(troops.value);
        splitForm.querySelector('[data-out="officers"]').textContent = detachedOfficers;
        splitForm.querySelector('[data-out="troops"]').textContent = detachedTroops.toLocaleString();

        const remaining = { officers: stack.officers - detachedOfficers, troops: stack.troops - detachedTroops };
        note.innerHTML =
          `Detachment moves ${movementAllowance({ troops: detachedTroops })}, ` +
          `parent keeps ${remaining.officers} officer${remaining.officers === 1 ? '' : 's'} with ` +
          `${remaining.troops.toLocaleString()} and moves ${movementAllowance(remaining)}.`;
        ui.split = { officers: detachedOfficers, troops: detachedTroops };
      };

      officers.addEventListener('input', update);
      troops.addEventListener('input', update);
      update();

      splitForm.querySelector('[data-split-confirm]').addEventListener('click', () => actions.armSplit());
    }

    const recruitForm = body.querySelector('[data-form="recruit"]');
    if (recruitForm) {
      const troops = recruitForm.querySelector('[name="troops"]');
      const update = () => {
        recruitForm.querySelector('[data-out="troops"]').textContent = Number(troops.value).toLocaleString();
        recruitForm.querySelector('[data-out="cost"]').textContent = (Number(troops.value) / 1000) * AP.recruitPerThousand;
      };
      troops.addEventListener('input', update);
      recruitForm.querySelector('[data-recruit-confirm]').addEventListener('click', () =>
        actions.recruit(Number(troops.value)),
      );
    }
  }

  // ------------------------------------------------------------------
  // Chronicle, prompt, toast
  // ------------------------------------------------------------------

  function paintChronicle(state) {
    const list = $('chronicle-list');
    list.innerHTML = state.log
      .slice(-40)
      .reverse()
      .map((line) => `<li class="${line.side ?? ''}"><b>T${line.turn}</b>${line.text}</li>`)
      .join('');
  }

  function paintPrompt(state, ui) {
    const prompt = $('prompt');
    const endTurn = $('end-turn');

    if (state.status !== 'playing') {
      prompt.textContent = '';
      endTurn.textContent = 'New campaign';
      endTurn.classList.remove('thinking');
      return;
    }

    if (state.activeSide !== 'crown') {
      prompt.textContent = 'The Marcher Lords are moving…';
      endTurn.textContent = 'Waiting';
      endTurn.classList.add('thinking');
      return;
    }

    endTurn.classList.remove('thinking');
    endTurn.textContent = 'End turn';

    if (ui.mode === 'wall') prompt.textContent = 'Click a hex beside the selected column to wall that edge.';
    else if (ui.selectedId !== null && !ui.armed) {
      prompt.textContent = 'Click that column on the map to give it orders.';
    }
    else if (ui.mode === 'split-place') prompt.textContent = 'Click an empty adjacent hex for the detachment.';
    else if (ui.pendingAttack !== null) prompt.textContent = 'Click again to commit to the attack.';
    else {
      const side = state.sides.crown;
      prompt.textContent = `${side.ap} AP to spend. ${
        side.ap === 0 ? 'Nothing left to spend — end the turn.' : 'Unspent points do not carry over.'
      }`;
    }
  }

  function toast(message) {
    const element = $('toast');
    element.textContent = message;
    element.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      element.hidden = true;
    }, 2600);
    audio.play('denied');
  }

  return {
    show: () => {
      $('hud').hidden = false;
    },
    hide: () => {
      $('hud').hidden = true;
    },
    paint(state, ui) {
      paintTop(state);
      paintOrders(state, ui);
      paintChronicle(state);
      paintPrompt(state, ui);
    },
    toast,
  };
}
