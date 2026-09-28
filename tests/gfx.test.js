/* Shelf Shift — graphics quality model tests (node --test tests/gfx.test.js) */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const G = require('../js/gfx.js');
const Store = require('../js/store.js');

test('detectPreset maps GPU strings to tiers', () => {
  assert.strictEqual(G.detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.strictEqual(G.detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.strictEqual(G.detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'high');
  assert.strictEqual(G.detectPreset('Apple M2 Pro'), 'high');
  assert.strictEqual(G.detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'balanced');
  assert.strictEqual(G.detectPreset('Adreno (TM) 740'), 'balanced');
  assert.strictEqual(G.detectPreset(''), 'balanced');
  // touch devices are capped at balanced, software stays low
  assert.strictEqual(G.detectPreset('Apple M1', true), 'balanced');
  assert.strictEqual(G.detectPreset('SwiftShader', true), 'low');
});

test('resolve: auto uses the detected preset; explicit preset wins', () => {
  const a = G.resolve({ preset: 'auto' }, 'high');
  assert.strictEqual(a.preset, 'high');
  assert.strictEqual(a.auto, true);
  assert.strictEqual(a.shadows, G.presetTier('high', 'shadows'));
  const b = G.resolve({ preset: 'low' }, 'high');
  assert.strictEqual(b.preset, 'low');
  assert.strictEqual(b.auto, false);
  assert.strictEqual(b.post, false, 'Low renders without a composer');
  assert.strictEqual(b.cap, 1);
  assert.strictEqual(G.resolve({}, undefined).preset, 'balanced');
});

test('resolve: overrides replace preset tiers; invalid overrides are ignored', () => {
  const r = G.resolve({ preset: 'low', bloom: 'on', shadows: 'bogus', detail: 'detailed' }, 'low');
  assert.strictEqual(r.bloom, 'on');
  assert.strictEqual(r.post, true, 'bloom override turns the post chain on');
  assert.strictEqual(r.shadows, 'off');
  assert.strictEqual(r.detail, 'detailed');
  for (const cat of Object.keys(G.CATEGORIES)) assert.ok(G.CATEGORIES[cat].includes(r[cat]), cat);
});

test('resolve: render scale is clamped to 50–200% and multiplies the preset scale', () => {
  assert.strictEqual(G.resolve({ preset: 'high', render_scale: 5 }).scale, 2);
  assert.strictEqual(G.resolve({ preset: 'high', render_scale: 0.1 }).scale, 0.5);
  assert.strictEqual(G.resolve({ preset: 'ultra', render_scale: 1 }).scale, 1.25);
  assert.strictEqual(G.resolve({ preset: 'high', render_scale: 'x' }).scale, 1);
  const d = G.resolve({}, 'low');
  assert.strictEqual(d.adaptive, true);
  assert.strictEqual(d.showFps, false);
});

test('choosing a preset clears overrides but keeps scale/adaptive/fps', () => {
  const next = G.choosePreset({ preset: 'low', bloom: 'on', ao: 'high', render_scale: 1.5, adaptive: false, show_fps: true }, 'high');
  assert.deepStrictEqual(next, { preset: 'high', render_scale: 1.5, adaptive: false, show_fps: true });
  assert.strictEqual(G.resolve(next).ao, G.presetTier('high', 'ao'));
  assert.strictEqual(G.choosePreset({}, 'nope').preset, 'auto');
});

test('describe summarises cost and pixels', () => {
  const s = G.describe(G.resolve({ preset: 'high' }), [1280, 800]);
  assert.match(s, /2048² shadows/);
  assert.match(s, /SMAA/);
  assert.match(s, /1280×800 px/);
  assert.match(G.describe(G.resolve({ preset: 'low' })), /no shadows/);
});

test('every locale has every panel string', () => {
  const need = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
  const en = G.STRINGS['en-US'];
  const walk = (a, b, path) => {
    for (const k of Object.keys(a)) {
      assert.ok(b[k] !== undefined && b[k] !== '', path + k);
      if (typeof a[k] === 'object') walk(a[k], b[k], path + k + '.');
    }
  };
  for (const loc of need) walk(en, G.STRINGS[loc], loc + ':');
  for (const cat of Object.keys(G.CATEGORIES)) for (const tier of G.CATEGORIES[cat]) assert.ok(en.tiers[tier], tier);
  assert.strictEqual(G.pickLocale('fr-CA'), 'fr-CA');
  assert.strictEqual(G.pickLocale('es-MX'), 'es-419');
  assert.strictEqual(G.pickLocale('es-ES'), 'es-ES');
  assert.strictEqual(G.pickLocale('pt-PT'), 'pt-BR');
  assert.strictEqual(G.pickLocale('en-AU'), 'en-GB');
  assert.strictEqual(G.pickLocale('ja-JP'), 'en-US');
  assert.notStrictEqual(G.strings('de').legend, G.strings('en').legend);
});

test('save migration carries the legacy graphics tier into gfx', () => {
  const m = Store.migrate({ v: 1, settings: { graphicsTier: 'medium' }, progress: {} });
  assert.strictEqual(m.settings.gfx.preset, 'balanced');
  assert.strictEqual(m.settings.graphicsTier, undefined);
  const f1 = Store.fresh(), f2 = Store.fresh();
  f1.settings.gfx.preset = 'ultra';
  assert.strictEqual(f2.settings.gfx.preset, 'auto', 'fresh docs do not share the gfx object');
  assert.strictEqual(Store.DEFAULT_SETTINGS.gfx.preset, 'auto');
});
