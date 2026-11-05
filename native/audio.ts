// Sound, as the browser build's js/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per game event on the effects bus,
// the quiet room tone (two seconds of brown noise through a 320 Hz low-pass
// at gain 0.35, looped on the old ambience bus) and the slow generative pad
// (a chord walk A – G – F – D, a new chord every 5.2 s, three voices an
// octave down — a triangle and two sines through a 700 Hz low-pass — each
// rising to 0.05 over 1.8 s and fading out by 6.4 s, on the music bus). The
// room tone and the pad are rendered natively into clips (OfflineAudioContext;
// the pad's four chords make one 20.8-second loop with the tails wrapped
// round, so it loops without a seam) and looped on the music bus — the runtime
// has no ambience bus — the room tone at the old ambience-to-music ratio
// (0.5 / 0.6). A clip still loading is silent. The runtime's Options own the
// volumes and the mute. Every clip loads at the start; the bed starts once the
// mixer runs and the player has pressed something.
import { context, createClip, loadClip, OfflineAudioContext, play as playClip, type AudioClip, type Sound } from "starhermit:audio";


/** audio.js SAMPLES. */
const SAMPLES = {
  ui: "ui-tick", select: "item-pickup", deselect: "item-putback", place: "shelf-thud", invalid: "move-denied",
  delivery: "parcel-drop", clear: "triple-chime", order: "order-bell", win: "round-fanfare", lose: "round-deflate",
  undo: "undo-swoosh", hint: "hint-sparkle", star: "star-glint",
} as const;
export type Sfx = keyof typeof SAMPLES;
const clips = new Map<string, AudioClip>();
let suspended = false;

/** Loads every clip and starts the bed's renders (onStart). */
export function loadSfx(): void {
  for (const name of Object.values(SAMPLES)) {
    loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); }, (e: unknown) => { console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`); });
  }
  const failed = (e: unknown): void => { console.warn(`audio render: ${String(e)}`); };
  renderRoomTone().then((c) => { toneClip = c; }, failed);
  renderPad().then((c) => { padClip = c; }, failed);
}

export function play(ev: Sfx): void {
  if (suspended) return;
  const name = SAMPLES[ev];
  const clip = clips.get(name);
  if (!clip) return;
  try { playClip(clip, { bus: "effects" }); } catch { /* the mixer is full this frame: skip it */ }
}

// -- the room tone and the pad ------------------------------------------------------------------
const RATE = 11025; // the bed is low-passed at 320 / 700 Hz: 11 kHz holds it

/** audio.js startAmbience: brown noise through a 320 Hz low-pass (a fixed seed instead of Math.random); filtered periodic noise is periodic once settled. */
const TONE_LEVEL = 0.35;
async function renderRoomTone(): Promise<AudioClip> {
  const n = 20050, settle = Math.round(0.25 * RATE);
  const off = new OfflineAudioContext(1, settle + n, RATE);
  const noise = off.createNoise({ color: "brown", seed: 0x2545f491, seconds: n / RATE });
  const lp = off.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 320;
  const g = off.createGain();
  g.gain.value = TONE_LEVEL;
  noise.connect(lp).connect(g).connect(off.destination);
  noise.start();
  const r = await off.startRendering();
  return createClip([r.getChannelData(0).slice(settle)], RATE);
}

const CHORDS = [[220.0, 277.18, 329.63], [196.0, 246.94, 293.66], [174.61, 220.0, 261.63], [146.83, 220.0, 293.66]];
const STEP = 5.2, PAD_N = Math.round(RATE * STEP * CHORDS.length);
/** audio.js schedulePad: chord k starts 0.1 s after its beat, three voices an octave down (a triangle, two sines) through a 700 Hz low-pass; the tails wrap round the loop. */
async function renderPad(): Promise<AudioClip> {
  const off = new OfflineAudioContext(1, PAD_N + Math.round(1.4 * RATE), RATE);
  const lp = off.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 700;
  lp.connect(off.destination);
  CHORDS.forEach((chord, c) => {
    const t = c * STEP + 0.1;
    const env = off.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.05, t + 1.8);
    env.gain.linearRampToValueAtTime(0.0001, t + 6.4);
    env.connect(lp);
    chord.forEach((f, k) => {
      const osc = off.createOscillator();
      osc.type = k === 0 ? "triangle" : "sine";
      osc.frequency.value = f * 0.5;
      osc.connect(env);
      osc.start(t);
      osc.stop(t + 6.4);
    });
  });
  const d = (await off.startRendering()).getChannelData(0), out = d.slice(0, PAD_N);
  for (let i = PAD_N; i < d.length; i++) out[i - PAD_N] = out[i - PAD_N]! + d[i]!;
  return createClip([out], RATE);
}

const TONE_GAIN = 0.5 / 0.6;
let toneClip: AudioClip | null = null, padClip: AudioClip | null = null;
let toneVoice: Sound | null = null, padVoice: Sound | null = null;
let bedWanted = false;
/** audio.js start (the old build began the bed on the first press). */
export function startBed(): void { bedWanted = true; }
/** A hidden window and the pause panel silence everything (audio.js suspend). */
export function setSuspended(on: boolean): void {
  if (on === suspended) return;
  suspended = on;
  try { toneVoice?.fade(on ? 0 : TONE_GAIN, 0.2); } catch { /* gone */ }
  try { padVoice?.fade(on ? 0 : 1, 0.2); } catch { /* gone */ }
}

/** Each frame: the bed, once the mixer runs and the player has pressed something. */
export function update(): void {
  if (context.state !== "running" || !bedWanted) return;
  if (toneClip && !toneVoice) {
    try { toneVoice = playClip(toneClip, { bus: "music", gain: suspended ? 0 : TONE_GAIN, loop: true }); } catch { toneVoice = null; }
  }
  if (padClip && !padVoice) {
    try { padVoice = playClip(padClip, { bus: "music", gain: suspended ? 0 : 1, loop: true }); } catch { padVoice = null; }
  }
}
