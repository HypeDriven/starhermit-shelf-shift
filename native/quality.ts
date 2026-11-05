// The look per graphics level. The engine owns its effects: shadows and their
// map size, ambient occlusion, bloom, the grade and anti-aliasing come from
// levelSettings(). The game keeps its art (js/gfx.js BUDGETS and the rest of
// its TABLE) keyed by the runtime's quality tier, with the dust motes and burst
// density scaled within the tier by the level's particle budget (at most 2×).
// The runtime owns the rest of what the old Graphics panel did: Auto and the
// level choice, render scale and the pixel-ratio cap, adaptive resolution, the
// frame-rate limit and readout. The old panel's per-effect overrides are not
// offered (the runtime's Options choose a level).
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export interface Budget {
  /** Procedural wood / floor / wallpaper canvas scale (Detail on). */
  texture: number;
  /** Item shading with Detail on: plain PBR (Balanced) or the glazed / clear-coated physical materials (High, Ultra). */
  material: "standard" | "physical";
  /** Drifting dust motes in the lamp light (Particles high). */
  dust: number;
  /** Particle-burst density multiplier. */
  burst: number;
}
export interface Look {
  preset: QualityTier;
  /** The level's shadow map size, 0 = off. */
  shadows: number;
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution, null = off. */
  bloom: number | null;
  grade: boolean;
  antialias: AntialiasMode;
  /** Image-based lighting (the room environment map). */
  reflections: boolean;
  /** Procedural wood / wallpaper / floor, lamp shades, wainscot, pictures, glazed pieces. */
  detailed: boolean;
  /** Burst density; "high" also drifts dust motes in the lamp light. */
  particles: "low" | "high";
  /** Candle and lantern flicker, lamp sway, dust drift. */
  animated: boolean;
  budget: Budget;
}

type Art = Pick<Look, "reflections" | "detailed" | "particles" | "animated">;
/** gfx.js TABLE: the game's art columns. */
const ART: Record<QualityTier, Art> = {
  low: { reflections: false, detailed: false, particles: "low", animated: false },
  balanced: { reflections: true, detailed: true, particles: "high", animated: true },
  high: { reflections: true, detailed: true, particles: "high", animated: true },
  ultra: { reflections: true, detailed: true, particles: "high", animated: true },
};
/** gfx.js BUDGETS. */
const BUDGETS: Record<QualityTier, Budget> = {
  low: { texture: 0.5, material: "standard", dust: 40, burst: 0.6 },
  balanced: { texture: 0.5, material: "standard", dust: 60, burst: 0.8 },
  high: { texture: 1, material: "physical", dust: 90, burst: 1 },
  ultra: { texture: 2, material: "physical", dust: 140, burst: 1 },
};
/** Each tier's anchor level: its budgets are at this level's particle count. */
const ANCHOR: Record<QualityTier, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };
export const DUST_MAX = 280;

/** The look for a graphics level's settings. */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const b = { ...BUDGETS[preset] };
  const k = Math.min(2, s.particles / levelSettings(ANCHOR[preset]).particles);
  b.dust = Math.min(DUST_MAX, Math.round(b.dust * k));
  b.burst = Math.min(2, Math.round(b.burst * k * 100) / 100);
  return {
    preset, ...ART[preset],
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
    budget: b,
  };
}
