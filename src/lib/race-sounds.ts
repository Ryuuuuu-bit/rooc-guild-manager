"use client";

/**
 * Small synthesized sound-effect kit for the horse race mini-game, built
 * directly on the Web Audio API — no external audio files.
 *
 * Why synthesized rather than real recordings: every royalty-free sound
 * library we could reach (SoundBible, Pixabay, Freesound, Mixkit) lives
 * outside this app's build/deploy environment's network allowlist, so
 * there was no way to fetch actual recorded clips. These are hand-tuned
 * noise bursts and oscillator runs instead — arcade/retro in character,
 * not a substitute for a real gunshot or crowd, but built to read clearly
 * as "start", "gallop", "cheer", and "fanfare" over a laptop's speakers.
 *
 * Everything here is lazy — no AudioContext is created until the first
 * sound is actually triggered (and that first call must happen inside a
 * user gesture, e.g. a button's onClick, or the browser's autoplay policy
 * will silently block it).
 */

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
// Deliberately not persisted (e.g. via localStorage) across page loads —
// doing so would make the mute button's initial label depend on
// client-only state, mismatching the server-rendered HTML on first paint.
// Resetting to unmuted each visit is a fine trade-off for a mini-game.
let muted = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    ctx = new Ctor();
    masterGain = ctx.createGain();
    masterGain.gain.value = muted ? 0 : 1;
    masterGain.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function setMuted(next: boolean) {
  muted = next;
  if (masterGain) masterGain.gain.value = next ? 0 : 1;
}

export function isMuted() {
  return muted;
}

/** A short buffer of white noise, reused (sliced) by every noise-based effect. */
let sharedNoiseBuffer: AudioBuffer | null = null;
function noiseBuffer(c: AudioContext): AudioBuffer {
  if (sharedNoiseBuffer && sharedNoiseBuffer.sampleRate === c.sampleRate) return sharedNoiseBuffer;
  const seconds = 2;
  const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  sharedNoiseBuffer = buf;
  return buf;
}

function noiseSource(c: AudioContext, durationSec: number): AudioBufferSourceNode {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loopStart = 0;
  src.loopEnd = durationSec;
  return src;
}

/** Starting gun — a sharp filtered noise crack plus a low thump for body. */
export function playStartGun() {
  const c = getCtx();
  if (!c || !masterGain) return;
  const t0 = c.currentTime;

  const crack = noiseSource(c, 0.08);
  const crackFilter = c.createBiquadFilter();
  crackFilter.type = "bandpass";
  crackFilter.frequency.value = 1800;
  crackFilter.Q.value = 0.7;
  const crackGain = c.createGain();
  crackGain.gain.setValueAtTime(0.9, t0);
  crackGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
  crack.connect(crackFilter).connect(crackGain).connect(masterGain);
  crack.start(t0);
  crack.stop(t0 + 0.09);

  const thump = c.createOscillator();
  thump.type = "sine";
  thump.frequency.setValueAtTime(120, t0);
  thump.frequency.exponentialRampToValueAtTime(45, t0 + 0.12);
  const thumpGain = c.createGain();
  thumpGain.gain.setValueAtTime(0.7, t0);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
  thump.connect(thumpGain).connect(masterGain);
  thump.start(t0);
  thump.stop(t0 + 0.16);
}

/**
 * Looping hoofbeat gallop — a "da-da-DUM" triplet of filtered noise thumps,
 * scheduled a bit ahead of real time (classic Web Audio lookahead pattern)
 * so the rhythm stays tight regardless of setTimeout jitter. Returns a
 * stop() function; call it once when the race ends.
 */
export function startGallopLoop(): () => void {
  const c = getCtx();
  if (!c || !masterGain) return () => {};
  const gain = masterGain;

  let stopped = false;
  const beatDuration = 0.24; // seconds per triplet
  let nextBeatTime = c.currentTime + 0.05;

  function scheduleThump(time: number, accent: boolean) {
    const src = noiseSource(c!, 0.05);
    const filter = c!.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = accent ? 260 : 180;
    const g = c!.createGain();
    const peak = accent ? 0.55 : 0.35;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(peak, time + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.07);
    src.connect(filter).connect(g).connect(gain);
    src.start(time);
    src.stop(time + 0.08);
  }

  function tick() {
    if (stopped || !c) return;
    while (nextBeatTime < c.currentTime + 0.15) {
      // Two quick beats then a rest — a rough canter/gallop cadence.
      scheduleThump(nextBeatTime, true);
      scheduleThump(nextBeatTime + beatDuration * 0.34, false);
      nextBeatTime += beatDuration;
    }
  }

  tick();
  const interval = setInterval(tick, 50);
  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

/** Crowd cheer — layered detuned noise swells through band-pass filters. */
export function playCheer() {
  const c = getCtx();
  if (!c || !masterGain) return;
  const t0 = c.currentTime;
  const bands = [500, 900, 1400, 2000];
  bands.forEach((freq, i) => {
    const src = noiseSource(c, 2.2);
    const filter = c.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    filter.Q.value = 0.6;
    const g = c.createGain();
    const delay = i * 0.05;
    g.gain.setValueAtTime(0.0001, t0 + delay);
    g.gain.exponentialRampToValueAtTime(0.22, t0 + delay + 0.35);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + delay + 2.0);
    src.connect(filter).connect(g).connect(masterGain!);
    src.start(t0 + delay);
    src.stop(t0 + delay + 2.1);
  });
}

/**
 * Soft tick — plays once per spin cycle in the classic ("โหมดปกติ") picker,
 * which cycles every ~70ms. Deliberately tiny and short (30ms) rather than
 * a full effect, since it repeats 15-25+ times in under two seconds — a
 * bigger sound here would blur into noise instead of reading as a spin.
 */
export function playTick() {
  const c = getCtx();
  if (!c || !masterGain) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  osc.type = "square";
  osc.frequency.value = 900;
  const g = c.createGain();
  g.gain.setValueAtTime(0.05, t0);
  g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.03);
  osc.connect(g).connect(masterGain);
  osc.start(t0);
  osc.stop(t0 + 0.03);
}

/**
 * Short two-note chime for the classic picker's reveal moment. Deliberately
 * lighter than playFanfare() below — that one plays alongside a multi-layer
 * crowd cheer after a several-second horse race and is meant to feel like a
 * big payoff; a classic draw resolves in under two seconds and admins often
 * fire off many in a row, so a quick "ding-ding" reads as a satisfying
 * confirmation without becoming fatiguing on repeat.
 */
export function playRevealChime() {
  const c = getCtx();
  if (!c || !masterGain) return;
  const t0 = c.currentTime;
  const notes: [number, number][] = [
    [783.99, 0], // G5
    [1046.5, 0.09], // C6
  ];
  notes.forEach(([freq, start]) => {
    const osc = c!.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const g = c!.createGain();
    g.gain.setValueAtTime(0.0001, t0 + start);
    g.gain.exponentialRampToValueAtTime(0.22, t0 + start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + start + 0.35);
    osc.connect(g).connect(masterGain!);
    osc.start(t0 + start);
    osc.stop(t0 + start + 0.37);
  });
}

/** Victory fanfare — a short ascending run into a held major chord. */
export function playFanfare() {
  const c = getCtx();
  if (!c || !masterGain) return;
  const t0 = c.currentTime;

  function note(freq: number, start: number, dur: number, type: OscillatorType, peak: number) {
    const osc = c!.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = c!.createGain();
    g.gain.setValueAtTime(0.0001, t0 + start);
    g.gain.exponentialRampToValueAtTime(peak, t0 + start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + start + dur);
    osc.connect(g).connect(masterGain!);
    osc.start(t0 + start);
    osc.stop(t0 + start + dur + 0.02);
  }

  // Quick ascending run (C5-E5-G5-C6) then a held C-E-G-C chord.
  const run: [number, number][] = [
    [523.25, 0],
    [659.25, 0.1],
    [783.99, 0.2],
    [1046.5, 0.3],
  ];
  run.forEach(([freq, start]) => note(freq, start, 0.18, "square", 0.16));

  const chord = [523.25, 659.25, 783.99, 1046.5];
  chord.forEach((freq) => note(freq, 0.32, 1.1, "triangle", 0.13));
}
