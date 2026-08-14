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
   * The soundtrack.
   *
   * Written rather than randomised. The first version was two sawtooth drones
   * with single notes picked out of a scale at random every couple of seconds,
   * which is not music — it has no harmony to move through and no pulse, so it
   * reads as an error tone that will not stop.
   *
   * This is a bar-based piece in D aeolian over a fixed tonic pedal, which is
   * how a great deal of actual medieval music is built: a drone that never
   * moves, and everything above it moving against that fixed point. Four voices
   * — pedal, sustained organum, a plucked lute figure and a frame drum — run
   * over an eight-bar progression, with a recorder line entering on alternate
   * bars. Everything goes through a generated reverb, which is the single
   * biggest difference between synthesis that sounds like a game score and
   * synthesis that sounds like a test tone.
   *
   * Notes are scheduled a bar and a half ahead against the audio clock rather
   * than fired from a timer, so the pulse does not drift when the main thread
   * is busy rebuilding the board.
   */

  const BEATS_PER_BAR = 4;
  const SECONDS_PER_BEAT = 60 / 54;
  const BAR_SECONDS = BEATS_PER_BAR * SECONDS_PER_BEAT;

  /** D aeolian. Open fifths and octaves rather than thirds — the period sound. */
  const PROGRESSION = [
    { root: 146.83, voices: [146.83, 220.0, 293.66] }, // Dm
    { root: 146.83, voices: [146.83, 220.0, 293.66] }, // Dm
    { root: 116.54, voices: [116.54, 174.61, 233.08] }, // Bb
    { root: 130.81, voices: [130.81, 196.0, 261.63] }, // C
    { root: 146.83, voices: [146.83, 220.0, 293.66] }, // Dm
    { root: 174.61, voices: [174.61, 261.63, 349.23] }, // F
    { root: 130.81, voices: [130.81, 196.0, 261.63] }, // C
    { root: 146.83, voices: [146.83, 220.0, 293.66] }, // Dm
  ];

  /** The mode an octave up, for the melody line. */
  const MELODY = [293.66, 329.63, 349.23, 392.0, 440.0, 466.16, 523.25, 587.33];

  /**
   * A generated impulse response: white noise under an exponential decay. Not a
   * real room, but enough of one that the plucked notes ring instead of
   * stopping dead.
   */
  function makeReverb() {
    const length = Math.floor(ctx.sampleRate * 2.8);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2.6;
      }
    }
    const convolver = ctx.createConvolver();
    convolver.buffer = impulse;
    return convolver;
  }

  /** One enveloped voice on the music bus, dry and into the reverb send. */
  function voice({ freq, type, at, attack, hold, release, gain, filter, detune = 0 }, bus) {
    const osc = ctx.createOscillator();
    const envelope = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    osc.detune.setValueAtTime(detune, at);

    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.linearRampToValueAtTime(gain, at + attack);
    envelope.gain.setValueAtTime(gain, at + attack + hold);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + release);

    let tail = envelope;
    if (filter) {
      const low = ctx.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.setValueAtTime(filter, at);
      envelope.connect(low);
      tail = low;
    }

    osc.connect(envelope);
    tail.connect(bus);
    osc.start(at);
    osc.stop(at + attack + hold + release + 0.1);
  }

  /** A soft frame-drum thump: filtered noise with a short body. */
  function drum(at, level, bus) {
    const frames = Math.floor(ctx.sampleRate * 0.35);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 3;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.setValueAtTime(190, at);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(level, at);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.34);

    source.connect(low);
    low.connect(envelope);
    envelope.connect(bus);
    source.start(at);
    source.stop(at + 0.4);
  }

  function startMusic() {
    if (!ensure() || music) return;

    // Dry and reverberant paths, both under the music volume control.
    const dry = ctx.createGain();
    dry.gain.value = 0.82;
    dry.connect(musicGain);
    const wet = ctx.createGain();
    wet.gain.value = 0.45;
    const reverb = makeReverb();
    reverb.connect(wet);
    wet.connect(musicGain);

    const bus = ctx.createGain();
    bus.connect(dry);
    bus.connect(reverb);

    // The pedal: D and its fifth, held for the whole piece, never moving.
    const pedal = [73.42, 110.0].map((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const low = ctx.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = 340;
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = i * 4;
      gain.gain.value = 0.035;
      osc.connect(low);
      low.connect(gain);
      gain.connect(bus);
      osc.start();
      return { osc, gain };
    });

    // A very slow breath across the pedal so it is not a dead held tone.
    const breath = ctx.createOscillator();
    const breathGain = ctx.createGain();
    breath.frequency.value = 0.055;
    breathGain.gain.value = 0.014;
    breath.connect(breathGain);
    breathGain.connect(pedal[0].gain.gain);
    breath.start();

    let bar = 0;
    let nextBar = ctx.currentTime + 0.15;

    const scheduleBar = (at, index) => {
      const chord = PROGRESSION[index % PROGRESSION.length];

      // Organum: the chord held across the bar, quiet and behind everything.
      for (const [i, freq] of chord.voices.entries()) {
        voice(
          { freq, type: 'sawtooth', at, attack: 0.9, hold: BAR_SECONDS - 1.6, release: 1.4, gain: 0.022, filter: 700, detune: i * 3 },
          bus,
        );
      }

      // Lute: the chord picked out across the bar, with the top note varying so
      // successive bars are not identical.
      const pattern = [0, 1, 2, 1, 2, 1];
      for (const [step, degree] of pattern.entries()) {
        if (step % 2 === 1 && Math.random() > 0.72) continue;
        const freq = chord.voices[degree] * (step > 3 ? 2 : 1);
        voice(
          { freq, type: 'triangle', at: at + step * (BAR_SECONDS / pattern.length), attack: 0.006, hold: 0.02, release: 1.1, gain: 0.05 },
          bus,
        );
      }

      // Recorder: a slow line on alternate bars, resting the rest of the time.
      if (index % 2 === 1) {
        const notes = 1 + (Math.random() > 0.55 ? 1 : 0);
        for (let n = 0; n < notes; n += 1) {
          const freq = MELODY[Math.floor(Math.random() * MELODY.length)];
          voice(
            {
              freq,
              type: 'triangle',
              at: at + SECONDS_PER_BEAT * (n === 0 ? 0.5 : 2.5),
              attack: 0.16,
              hold: SECONDS_PER_BEAT * 0.9,
              release: 1.0,
              gain: 0.042,
              filter: 2200,
            },
            bus,
          );
        }
      }

      drum(at, 0.07, bus);
      drum(at + SECONDS_PER_BEAT * 2, 0.045, bus);
      if (Math.random() > 0.6) drum(at + SECONDS_PER_BEAT * 3.5, 0.03, bus);
    };

    // Lookahead against the audio clock, so a busy main thread cannot make the
    // pulse stumble.
    const timer = setInterval(() => {
      if (!ctx) return;
      while (nextBar < ctx.currentTime + BAR_SECONDS * 1.5) {
        scheduleBar(nextBar, bar);
        nextBar += BAR_SECONDS;
        bar += 1;
      }
    }, 320);

    scheduleBar(nextBar, bar);
    nextBar += BAR_SECONDS;
    bar += 1;

    music = { pedal, breath, timer, bus };
  }

  function stopMusic() {
    if (!music) return;
    clearInterval(music.timer);
    // Fade the bus rather than cutting it, so anything already scheduled and
    // the reverb tail behind it die away instead of clicking.
    const now = ctx.currentTime;
    music.bus.gain.setValueAtTime(music.bus.gain.value, now);
    music.bus.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    for (const held of music.pedal) held.osc.stop(now + 0.6);
    music.breath.stop(now + 0.6);
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
