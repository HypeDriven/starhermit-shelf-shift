// The look per graphics level: the browser build's four presets and budgets
// (js/gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU
// its Auto gave it) keyed by the runtime's quality tier (frame().quality),
// with the dust motes and burst density scaled within the tier by the level
// (frame().levelIndex, at most 2×), as the browser build scaled them by its
// hardware level. The runtime owns the rest of what the old Graphics panel
// did: Auto and the level choice, render scale and the pixel-ratio cap,
// adaptive resolution, the frame-rate limit and readout. The old panel's
// per-effect overrides are not offered (the runtime's Options choose a level).
import type { QualityTier } from "starhermit:engine";
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
  bloomRes: number;
  aoRes: number;
}
export interface Look {
  preset: QualityTier;
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
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

/** gfx.js TABLE. */
const TABLE: Record<QualityTier, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "msaa", reflections: false, detailed: false, particles: "low", animated: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", reflections: true, detailed: true, particles: "high", animated: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", reflections: true, detailed: true, particles: "high", animated: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", reflections: true, detailed: true, particles: "high", animated: true },
};
/** gfx.js BUDGETS. */
const BUDGETS: Record<QualityTier, Budget> = {
  low: { texture: 0.5, material: "standard", dust: 40, burst: 0.6, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { texture: 0.5, material: "standard", dust: 60, burst: 0.8, bloomRes: 0.5, aoRes: 0.5 },
  high: { texture: 1, material: "physical", dust: 90, burst: 1, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { texture: 2, material: "physical", dust: 140, burst: 1, bloomRes: 1, aoRes: 1 },
};
/** The first level index of each tier. */
const TIER_FLOOR: Record<QualityTier, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };
export const DUST_MAX = 280;

/** The look for a quality tier at a level index (0 … 9). */
export function lookFor(preset: QualityTier, levelIndex: number): Look {
  const b = { ...BUDGETS[preset] };
  const k = Math.min(2, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.dust = Math.min(DUST_MAX, Math.round(b.dust * k));
  b.burst = Math.min(2, Math.round(b.burst * k * 100) / 100);
  return { preset, ...TABLE[preset], budget: b };
}
