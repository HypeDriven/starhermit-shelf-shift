// Sound, as the browser build's js/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per game event on the effects bus,
// the quiet room tone (two seconds of brown noise through a 320 Hz low-pass
// at gain 0.35, looped on the old ambience bus) and the slow generative pad
// (a chord walk A – G – F – D, a new chord every 5.2 s, three voices an
// octave down — a triangle and two sines through a 700 Hz low-pass — each
// rising to 0.05 over 1.8 s and fading out by 6.4 s, on the music bus). The
// room tone and the pad are rendered once into clips (the pad's four chords
// make one 20.8-second loop with the tails wrapped round, so it loops
// without a seam; a slice a frame) and looped on the music bus — the runtime
// has no ambience bus — the room tone at the old ambience-to-music ratio
// (0.5 / 0.6). The synthesized transients audio.js played while a clip
// decoded are not ported (a live synthesis graph makes clip loads fail on
// the web runtime): a clip still loading is silent. The runtime's Options
// own the volumes and the mute. Clips load once the mixer runs (natively at
// once, in a browser after the first press), one at a time.
import { context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";

/** audio.js SAMPLES. */
const SAMPLES = {
  ui: "ui-tick", select: "item-pickup", deselect: "item-putback", place: "shelf-thud", invalid: "move-denied",
  delivery: "parcel-drop", clear: "triple-chime", order: "order-bell", win: "round-fanfare", lose: "round-deflate",
  undo: "undo-swoosh", hint: "hint-sparkle", star: "star-glint",
} as const;
export type Sfx = keyof typeof SAMPLES;
const clips = new Map<string, AudioClip>();
const queue: string[] = [];
let loading = false;
let wantClips = false;
let suspended = false;

/** Asks for the clips; they load once the mixer runs (see update). */
export function loadSfx(): void { wantClips = true; }

export function play(ev: Sfx): void {
  if (suspended) return;
  const name = SAMPLES[ev];
  const clip = clips.get(name);
  if (!clip) return;
  try { playClip(clip, { bus: "effects" }); } catch { clips.delete(name); if (!queue.includes(name)) queue.push(name); }
}

// -- the room tone and the pad ------------------------------------------------------------------
const RATE = 11025; // the bed is low-passed at 320 / 700 Hz: 11 kHz holds it
const SINE = new Float32Array(4096);
for (let i = 0; i < SINE.length; i++) SINE[i] = Math.sin((2 * Math.PI * i) / SINE.length);
const sine = (ph: number): number => SINE[Math.floor((ph - Math.floor(ph)) * 4096) & 4095]!;
const tri = (ph: number): number => { const p = ph - Math.floor(ph); return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4; };

/** WebAudio's default low-pass biquad (Q 1 dB) as RBJ coefficients. */
function lowpass(cutoff: number): { b0: number; b1: number; b2: number; a1: number; a2: number } {
  const w = (2 * Math.PI * cutoff) / RATE, q = Math.pow(10, 1 / 20);
  const alpha = Math.sin(w) / (2 * q), cos = Math.cos(w), a0 = 1 + alpha;
  return { b0: (1 - cos) / 2 / a0, b1: (1 - cos) / a0, b2: (1 - cos) / 2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}
/** A low-pass run twice round a loop (so the state at the start is the end's: no click at the seam), in slices. */
class LoopFilter {
  private f: ReturnType<typeof lowpass>;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  private i = 0; private pass = 0;
  private readonly out: Float32Array;
  constructor(private readonly buf: Float32Array, cutoff: number) { this.f = lowpass(cutoff); this.out = new Float32Array(buf.length); }
  /** Filters up to `count` samples; true when done (the buffer then holds the result). */
  run(count: number): boolean {
    const { f, buf, out } = this;
    while (count-- > 0 && this.pass < 2) {
      const x = buf[this.i]!;
      const y = f.b0 * x + f.b1 * this.x1 + f.b2 * this.x2 - f.a1 * this.y1 - f.a2 * this.y2;
      this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
      out[this.i] = y;
      if (++this.i >= buf.length) { this.i = 0; this.pass++; }
    }
    if (this.pass < 2) return false;
    buf.set(out);
    return true;
  }
}

/** audio.js startAmbience: brown-ish noise (a fixed seed instead of Math.random). */
function renderRoomTone(): Float32Array {
  const n = RATE * 2, d = new Float32Array(n);
  let s = 0x2545f491, last = 0;
  for (let i = 0; i < n; i++) {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const w = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    d[i] = last * 3.5;
  }
  // a loop of two seconds: blend the ends so the noise floor doesn't step at the seam
  const fade = 2000;
  for (let i = 0; i < fade; i++) { const k = i / fade; d[i] = d[i]! * k + d[n - fade + i]! * (1 - k); }
  const out = d.slice(0, n - fade);
  new LoopFilter(out, 320).run(out.length * 2);
  for (let i = 0; i < out.length; i++) out[i] = out[i]! * 0.35;
  return out;
}

const CHORDS = [[220.0, 277.18, 329.63], [196.0, 246.94, 293.66], [174.61, 220.0, 261.63], [146.83, 220.0, 293.66]];
const STEP = 5.2, PAD_N = Math.round(RATE * STEP * CHORDS.length);
const pad = new Float32Array(PAD_N);
let padChord = 0, padPos = 0;
let padFilter: LoopFilter | null = null;
/** One slice of audio.js schedulePad: chord k starts 0.1 s after its beat; its tail wraps round the loop. */
function renderPad(count: number): boolean {
  const len = Math.round(RATE * 6.6);
  while (count > 0 && padChord < CHORDS.length) {
    const start = Math.round(RATE * (padChord * STEP + 0.1));
    const chord = CHORDS[padChord]!;
    const end = Math.min(len, padPos + count);
    for (let i = padPos; i < end; i++) {
      const t = i / RATE;
      const env = t < 1.8 ? (t / 1.8) * 0.05 : t < 6.4 ? 0.05 + (0.0001 - 0.05) * ((t - 1.8) / 4.6) : 0;
      if (env <= 0) continue;
      let v = 0;
      for (let k = 0; k < 3; k++) {
        const ph = chord[k]! * 0.5 * t;
        v += k === 0 ? tri(ph) : sine(ph);
      }
      const j = (start + i) % PAD_N;
      pad[j] = pad[j]! + v * env;
    }
    count -= end - padPos;
    padPos = end;
    if (padPos >= len) { padChord++; padPos = 0; }
  }
  if (padChord < CHORDS.length) return false;
  padFilter ??= new LoopFilter(pad, 700);
  return padFilter.run(count + 6000);
}

const TONE_GAIN = 0.5 / 0.6;
let toneClip: AudioClip | null = null, padClip: AudioClip | null = null;
let toneVoice: Sound | null = null, padVoice: Sound | null = null;
let bedWanted = false, padReady = false;
/** audio.js start (the old build began the bed on the first press). */
export function startBed(): void { bedWanted = true; }
/** A hidden window and the pause panel silence everything (audio.js suspend). */
export function setSuspended(on: boolean): void {
  if (on === suspended) return;
  suspended = on;
  try { toneVoice?.fade(on ? 0 : TONE_GAIN, 0.2); } catch { /* gone */ }
  try { padVoice?.fade(on ? 0 : 1, 0.2); } catch { /* gone */ }
}

/** Each frame: the clips once the mixer runs (one at a time), then the bed. */
export function update(): void {
  if (context.state !== "running") return;
  if (wantClips) {
    wantClips = false;
    for (const n of Object.values(SAMPLES)) if (!queue.includes(n)) queue.push(n);
  }
  if (!loading && queue.length) {
    const name = queue.shift()!;
    if (!clips.has(name)) {
      loading = true;
      loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); loading = false; }, (e: unknown) => {
        console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`);
        loading = false;
      });
    }
    return;
  }
  if (loading || !bedWanted) return;
  if (!toneClip) {
    try { toneClip = createClip([renderRoomTone()], RATE); } catch (e) { console.warn(`audio: ${String(e)}`); bedWanted = false; }
    return;
  }
  if (!toneVoice) {
    try { toneVoice = playClip(toneClip, { bus: "music", gain: suspended ? 0 : TONE_GAIN, loop: true }); } catch { toneVoice = null; }
    return;
  }
  if (!padReady) { padReady = renderPad(6000); return; }
  if (!padClip) {
    try { padClip = createClip([pad], RATE); } catch (e) { console.warn(`audio: ${String(e)}`); bedWanted = false; }
    return;
  }
  if (!padVoice) {
    try { padVoice = playClip(padClip, { bus: "music", gain: suspended ? 0 : 1, loop: true }); } catch { padVoice = null; }
  }
}
