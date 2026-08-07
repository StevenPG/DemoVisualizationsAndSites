/**
 * Builds the control panel from config.js.
 *
 * Every count/speed/leg control is generated from the KINDS table so adding a
 * fifth kind of mover is a config change, not a markup change. The panel owns no
 * state of its own: it reads initial values from the config, writes changes out
 * through the `on` callbacks, and gets told what to display through the handle
 * it returns.
 */

import {
  GLOBAL_DEFAULTS,
  KINDS,
  MAX_PER_KIND,
  TIME_SCALE_RANGE,
} from './config.js';
import { legendSvg } from './icons.js';

const SLIDER_STEPS = 1000;

/**
 * Counts run from 0 to 50,000 on one slider, which needs a curve — linear would
 * make everything below 5,000 a single pixel. This is exponential with a
 * hand-picked sharpness: the midpoint lands near 5k, which is where the
 * interesting range is.
 */
const COUNT_CURVE = 4.6;
const countToSlider = (value) =>
  Math.round((Math.log1p((value / MAX_PER_KIND) * Math.expm1(COUNT_CURVE)) / COUNT_CURVE) * SLIDER_STEPS);
const sliderToCount = (pos) =>
  Math.round((Math.expm1((pos / SLIDER_STEPS) * COUNT_CURVE) / Math.expm1(COUNT_CURVE)) * MAX_PER_KIND);

const logToSlider = (value, min, max) =>
  Math.round((Math.log(value / min) / Math.log(max / min)) * SLIDER_STEPS);
const sliderToLog = (pos, min, max) => min * (max / min) ** (pos / SLIDER_STEPS);

const PRESETS = [
  { label: 'Calm', counts: [500, 500, 500, 500] },
  { label: 'Busy', counts: [5000, 5000, 5000, 5000] },
  { label: 'Heavy', counts: [20_000, 20_000, 20_000, 20_000] },
  { label: 'Punishing', counts: [50_000, 50_000, 50_000, 50_000] },
];

export function buildPanel(root, on) {
  root.innerHTML = '';

  const liveReadouts = [];
  const countInputs = [];
  const countSliders = [];

  // ------------------------------------------------------------- movers
  for (const kind of KINDS) {
    const section = el('section', 'group');
    section.style.setProperty('--kind-color', kind.color);

    const heading = el('header', 'group-head');
    heading.innerHTML =
      `<span class="glyph">${legendSvg(kind)}</span>` +
      `<h3>${kind.label}</h3>` +
      `<span class="live" data-live>0</span>`;
    section.append(heading);

    const blurb = el('p', 'blurb');
    blurb.textContent = kind.blurb;
    section.append(blurb);

    liveReadouts[kind.index] = heading.querySelector('[data-live]');

    const { row, slider, number } = sliderRow({
      id: `${kind.id}-count`,
      label: 'Count',
      value: kind.count.value,
      min: 0,
      max: MAX_PER_KIND,
      step: 1,
      toSlider: countToSlider,
      fromSlider: sliderToCount,
      format: (v) => v.toLocaleString(),
      onInput: (value) => on.count(kind.index, value),
    });
    countInputs[kind.index] = number;
    countSliders[kind.index] = slider;
    section.append(row);

    section.append(
      sliderRow({
        id: `${kind.id}-speed`,
        label: 'Speed',
        suffix: kind.speed.unit,
        hint: kind.speed.hint,
        value: kind.speed.value,
        min: kind.speed.min,
        max: kind.speed.max,
        step: kind.speed.step,
        format: (v) => (kind.speed.step < 1 ? v.toFixed(1) : String(v)),
        onInput: (value) => on.speed(kind.index, value),
      }).row,
    );

    section.append(
      sliderRow({
        id: `${kind.id}-leg`,
        label: 'Leg length',
        suffix: 'km',
        hint: 'then retire and respawn',
        value: kind.leg.value,
        min: kind.leg.min,
        max: kind.leg.max,
        step: kind.leg.step,
        format: (v) => v.toLocaleString(),
        onInput: (value) => on.leg(kind.index, value),
      }).row,
    );

    root.append(section);
  }

  // ------------------------------------------------------------- presets
  const presets = el('section', 'group');
  presets.append(headingOnly('Presets'));
  const presetRow = el('div', 'button-row');
  for (const preset of PRESETS) {
    const button = el('button', 'chip');
    button.type = 'button';
    button.textContent = `${preset.label} · ${(preset.counts.reduce((a, b) => a + b, 0)).toLocaleString()}`;
    button.addEventListener('click', () => {
      preset.counts.forEach((value, index) => {
        setCount(index, value);
        on.count(index, value);
      });
    });
    presetRow.append(button);
  }
  presets.append(presetRow);
  root.append(presets);

  // -------------------------------------------------------------- scene
  const scene = el('section', 'group');
  scene.append(headingOnly('Scene'));

  scene.append(
    sliderRow({
      id: 'time-scale',
      label: 'Time scale',
      suffix: '×',
      hint: 'real speeds are still reported honestly',
      value: GLOBAL_DEFAULTS.timeScale,
      min: TIME_SCALE_RANGE.min,
      max: TIME_SCALE_RANGE.max,
      step: 1,
      toSlider: (v) => logToSlider(v, TIME_SCALE_RANGE.min, TIME_SCALE_RANGE.max),
      fromSlider: (p) => Math.round(sliderToLog(p, TIME_SCALE_RANGE.min, TIME_SCALE_RANGE.max)),
      format: (v) => v.toLocaleString(),
      onInput: on.timeScale,
    }).row,
  );

  scene.append(
    sliderRow({
      id: 'point-size',
      label: 'Point size',
      suffix: 'px',
      value: GLOBAL_DEFAULTS.pointSize,
      min: 1,
      max: 12,
      step: 1,
      format: String,
      onInput: on.pointSize,
    }).row,
  );

  const terrain = checkboxRow({
    id: 'terrain',
    label: 'ESRI world elevation',
    hint: 'ground vehicles ride real terrain; tile streaming competes for the frame',
    checked: GLOBAL_DEFAULTS.terrain,
    onChange: on.terrain,
  });
  scene.append(terrain.row);

  const pause = checkboxRow({
    id: 'paused',
    label: 'Pause simulation',
    hint: 'freezes movement, leaves the scene rendering',
    checked: false,
    onChange: on.pause,
  });
  scene.append(pause.row);
  root.append(scene);

  // ----------------------------------------------------------- renderer
  const renderer = el('section', 'group');
  renderer.append(headingOnly('Renderer'));

  const modeRow = el('div', 'radio-row');
  const modes = [
    ['primitives', 'Point primitives', 'One PointPrimitiveCollection, one draw call.'],
    ['entities', 'Entities', 'One Entity each, moved through the entity layer.'],
  ];
  const modeInputs = {};
  for (const [value, label, hint] of modes) {
    const wrapper = el('label', 'radio');
    wrapper.innerHTML =
      `<input type="radio" name="render-mode" value="${value}" ${
        value === GLOBAL_DEFAULTS.renderMode ? 'checked' : ''
      } />` + `<span><b>${label}</b><small>${hint}</small></span>`;
    const input = wrapper.querySelector('input');
    modeInputs[value] = input;
    input.addEventListener('change', () => {
      if (input.checked) on.renderMode(value);
    });
    modeRow.append(wrapper);
  }
  renderer.append(modeRow);

  const rampRow = el('div', 'button-row');
  const rampButton = el('button', 'chip primary');
  rampButton.type = 'button';
  rampButton.textContent = 'Ramp until it breaks';
  rampButton.addEventListener('click', () => on.ramp());
  const resetButton = el('button', 'chip');
  resetButton.type = 'button';
  resetButton.textContent = 'Reset';
  resetButton.addEventListener('click', () => on.reset());
  rampRow.append(rampButton, resetButton);
  renderer.append(rampRow);

  const rampNote = el('p', 'note');
  rampNote.textContent = `Adds movers a second at a time until the median frame rate falls below ${GLOBAL_DEFAULTS.rampFpsFloor} fps, then reports where it gave out.`;
  renderer.append(rampNote);
  root.append(renderer);

  // --------------------------------------------------------------- API
  function setCount(kindIndex, value) {
    countInputs[kindIndex].value = String(value);
    countSliders[kindIndex].value = String(countToSlider(value));
  }

  return {
    setCount,
    setLive(kindIndex, value) {
      liveReadouts[kindIndex].textContent = value.toLocaleString();
    },
    setRenderMode(mode) {
      modeInputs[mode].checked = true;
    },
    setRamping(active) {
      rampButton.textContent = active ? 'Stop ramping' : 'Ramp until it breaks';
      rampButton.classList.toggle('active', active);
    },
    setTerrain(enabled) {
      terrain.input.checked = enabled;
    },
  };
}

// ------------------------------------------------------------------ pieces

function sliderRow({
  id,
  label,
  suffix = '',
  hint = '',
  value,
  min,
  max,
  step,
  toSlider,
  fromSlider,
  format,
  onInput,
}) {
  const curved = typeof toSlider === 'function';
  const row = el('div', 'control');

  const head = el('div', 'control-head');
  head.innerHTML =
    `<label for="${id}">${label}</label>` + (hint ? `<small class="hint">${hint}</small>` : '');
  row.append(head);

  const body = el('div', 'control-body');
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.id = id;
  if (curved) {
    slider.min = '0';
    slider.max = String(SLIDER_STEPS);
    slider.step = '1';
    slider.value = String(toSlider(value));
  } else {
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(value);
  }

  // A number box alongside, because a curved slider cannot be dragged to
  // exactly 25,000 and "exactly 25,000" is precisely the sort of thing you want
  // when you are comparing two runs.
  const number = document.createElement('input');
  number.type = 'number';
  number.className = 'number';
  number.min = String(min);
  number.max = String(max);
  number.step = String(step);
  number.value = String(value);
  number.setAttribute('aria-label', `${label} value`);

  const unit = el('span', 'unit');
  unit.textContent = suffix;

  const commit = (raw, source) => {
    const clamped = Math.min(max, Math.max(min, raw));
    if (source !== 'number') number.value = format(clamped);
    if (source !== 'slider') slider.value = String(curved ? toSlider(clamped) : clamped);
    onInput(clamped);
  };

  slider.addEventListener('input', () => {
    const pos = Number(slider.value);
    commit(curved ? fromSlider(pos) : pos, 'slider');
  });
  number.addEventListener('change', () => {
    const parsed = Number(number.value);
    if (Number.isFinite(parsed)) commit(parsed, 'number');
    else number.value = format(value);
  });

  body.append(slider, number, unit);
  row.append(body);
  return { row, slider, number };
}

function checkboxRow({ id, label, hint, checked, onChange }) {
  const row = el('label', 'toggle');
  row.setAttribute('for', id);
  row.innerHTML =
    `<input type="checkbox" id="${id}" ${checked ? 'checked' : ''} />` +
    `<span><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span>`;
  const input = row.querySelector('input');
  input.addEventListener('change', () => onChange(input.checked));
  return { row, input };
}

function headingOnly(text) {
  const head = el('header', 'group-head');
  head.innerHTML = `<h3>${text}</h3>`;
  return head;
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
