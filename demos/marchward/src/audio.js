/**
 * Sound, synthesised.
 *
 * Every effect and the whole soundtrack are generated with oscillators and
 * filtered noise at runtime, so the demo ships no audio files at all — which
 * matters when it is one of several sites inside a single Cloudflare Pages
 * deployment and a few megabytes of samples would be the largest thing in it.
 *
 * The context is created on the first user gesture, because browsers will not
 * start one before that. Everything before then is silently dropped rather than
 * queued: a horn that fires four seconds late because the tab was not focused
 * is worse than no horn.
 */

const DEFAULTS = { master: 0.7, sfx: 0.75, music: 0.3, muted: false };

export function createAudio(initial = {}) {
  const settings = { ...DEFAULTS, ...initial };

  let ctx = null;
  let masterGain = null;
  let sfxGain = null;
  let musicGain = null;
  let music = null;

  function ensure() {
    if (ctx) return true;
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) return false;

    ctx = new AudioContextClass();
    masterGain = ctx.createGain();
    sfxGain = ctx.createGain();
    musicGain = ctx.createGain();
    sfxGain.connect(masterGain);
    musicGain.connect(masterGain);
    masterGain.connect(ctx.destination);
    applyVolumes();
    return true;
  }

  function applyVolumes() {
    if (!ctx) return;
    const master = settings.muted ? 0 : settings.master;
    masterGain.gain.setTargetAtTime(master, ctx.currentTime, 0.02);
    sfxGain.gain.setTargetAtTime(settings.sfx, ctx.currentTime, 0.02);
    musicGain.gain.setTargetAtTime(settings.music, ctx.currentTime, 0.05);
  }

  // ----------------------------------------------------------------------
  // Voices
  // ----------------------------------------------------------------------

  /** A single enveloped oscillator. The workhorse behind most of the effects. */
  function tone({ freq, type = 'sine', at = 0, duration = 0.2, gain = 0.3, sweep = null, destination }) {
    const start = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const envelope = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweep), start + duration);

    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.02, duration / 4));
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(envelope);
    envelope.connect(destination ?? sfxGain);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  /** Filtered noise — hooves, the clash of a melee, stone on stone. */
  function noise({ at = 0, duration = 0.3, gain = 0.3, frequency = 900, q = 1, type = 'bandpass', sweep = null }) {
    const start = ctx.currentTime + at;
    const frames = Math.ceil(ctx.sampleRate * (duration + 0.05));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, start);
    filter.Q.value = q;
    if (sweep) filter.frequency.exponentialRampToValueAtTime(Math.max(40, sweep), start + duration);

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + 0.015);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(sfxGain);
    source.start(start);
    source.stop(start + duration + 0.05);
  }

  const EFFECTS = {
    click: () => tone({ freq: 660, type: 'triangle', duration: 0.05, gain: 0.12 }),
    denied: () => {
      tone({ freq: 180, type: 'square', duration: 0.09, gain: 0.13 });
      tone({ freq: 140, type: 'square', at: 0.08, duration: 0.11, gain: 0.11 });
    },
    select: () => tone({ freq: 880, type: 'triangle', duration: 0.07, gain: 0.13 }),

    /** Hooves and boots: three overlapping noise thuds. */
    march: () => {
      for (let i = 0; i < 3; i += 1) {
        noise({ at: i * 0.075, duration: 0.13, gain: 0.16, frequency: 420 - i * 60, q: 0.8, type: 'lowpass' });
      }
    },

    battle: () => {
      noise({ duration: 0.55, gain: 0.3, frequency: 1900, sweep: 500, q: 0.7 });
      tone({ freq: 90, type: 'sine', duration: 0.4, gain: 0.32, sweep: 45 });
      tone({ freq: 320, type: 'sawtooth', at: 0.05, duration: 0.22, gain: 0.1, sweep: 200 });
    },

    assault: () => {
      noise({ duration: 0.85, gain: 0.34, frequency: 2400, sweep: 320, q: 0.6 });
      tone({ freq: 70, type: 'sine', duration: 0.7, gain: 0.38, sweep: 38 });
      tone({ freq: 196, type: 'sawtooth', at: 0.12, duration: 0.4, gain: 0.12 });
    },

    wall: () => {
      tone({ freq: 120, type: 'square', duration: 0.22, gain: 0.22, sweep: 80 });
      noise({ at: 0.02, duration: 0.3, gain: 0.2, frequency: 300, q: 1.4, type: 'lowpass' });
    },

    breach: () => {
      noise({ duration: 0.6, gain: 0.3, frequency: 700, sweep: 120, q: 1.1, type: 'lowpass' });
      tone({ freq: 60, type: 'sine', duration: 0.5, gain: 0.3, sweep: 32 });
    },

    /** A horn call in fifths for raising troops. */
    recruit: () => {
      tone({ freq: 293.66, type: 'sawtooth', duration: 0.3, gain: 0.13 });
      tone({ freq: 440, type: 'sawtooth', at: 0.16, duration: 0.42, gain: 0.13 });
    },

    officer: () => {
      tone({ freq: 392, type: 'triangle', duration: 0.16, gain: 0.14 });
      tone({ freq: 587.33, type: 'triangle', at: 0.1, duration: 0.26, gain: 0.12 });
    },

    /** A soft bell to hand the turn over. */
    turn: () => {
      tone({ freq: 523.25, type: 'sine', duration: 0.9, gain: 0.16 });
      tone({ freq: 784, type: 'sine', at: 0.02, duration: 0.7, gain: 0.08 });
    },

    siege: () => {
      tone({ freq: 110, type: 'sawtooth', duration: 0.8, gain: 0.14, sweep: 82 });
      noise({ duration: 0.9, gain: 0.1, frequency: 260, q: 0.9, type: 'lowpass' });
    },

    victory: () => {
      [261.63, 329.63, 392, 523.25].forEach((freq, i) => {
        tone({ freq, type: 'triangle', at: i * 0.13, duration: 0.7, gain: 0.16 });
      });
    },

    defeat: () => {
      [349.23, 293.66, 261.63, 196].forEach((freq, i) => {
        tone({ freq, type: 'triangle', at: i * 0.19, duration: 0.9, gain: 0.15 });
      });
    },
  };

  // ----------------------------------------------------------------------
  // Music
  // ----------------------------------------------------------------------

  /**
   * A slow drone in D with notes wandering the Dorian mode above it. Generative
   * rather than looped so it never arrives at a seam, and sparse enough to sit
   * under a game you are meant to be thinking during.
   */
  function startMusic() {
    if (!ensure() || music) return;

    const drone = [73.42, 110].map((freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      gain.gain.value = 0.06;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(musicGain);
      osc.start();
      return { osc, gain };
    });

    // A very slow tremolo keeps the drone from sounding like a held synth pad.
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 0.022;
    lfo.connect(lfoGain);
    lfoGain.connect(drone[0].gain.gain);
    lfo.start();

    const SCALE = [293.66, 329.63, 349.23, 392, 440, 493.88, 523.25, 587.33];
    const timer = setInterval(() => {
      if (!ctx || settings.muted || settings.music <= 0.001) return;
      if (Math.random() > 0.62) return;
      const freq = SCALE[Math.floor(Math.random() * SCALE.length)];
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.09, now + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.6);
      osc.connect(gain);
      gain.connect(musicGain);
      osc.start(now);
      osc.stop(now + 2.7);
    }, 2400);

    music = { drone, lfo, timer };
  }

  function stopMusic() {
    if (!music) return;
    clearInterval(music.timer);
    for (const voice of music.drone) voice.osc.stop();
    music.lfo.stop();
    music = null;
  }

  return {
    settings,

    /** Called from the first real click, which is what lets audio start at all. */
    unlock() {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume();
    },

    play(name) {
      if (settings.muted || settings.sfx <= 0.001) return;
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume();
      EFFECTS[name]?.();
    },

    /** Maps a rules event straight onto a sound, so callers never name effects. */
    playEvent(event) {
      const map = {
        battle: 'battle',
        assault: 'assault',
        destroyed: 'battle',
        wall: 'wall',
        breach: 'breach',
        recruit: 'recruit',
        officer: 'officer',
        siege: 'siege',
        split: 'officer',
        merge: 'march',
      };
      const effect = map[event.kind];
      if (effect) this.play(effect);
    },

    set(key, value) {
      settings[key] = value;
      applyVolumes();
      if (key === 'music' || key === 'muted') {
        if (settings.muted || settings.music <= 0.001) stopMusic();
        else startMusic();
      }
    },

    startMusic,
    stopMusic,
  };
}
