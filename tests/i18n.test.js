// Localization coverage: every player-facing English key (extracted from the
// source by tests/i18n-keys.js) has a translation in every non-English locale,
// with the same {placeholders}, and no locale carries stray keys.
const test = require('node:test');
const assert = require('node:assert');
const { ALL } = require('./i18n-keys.js');
const I18N = require('../js/i18n.js');

const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('all nine locales are supported', () => {
  assert.deepStrictEqual(I18N.LOCALES, ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT']);
});

test('extraction finds the player-facing strings', () => {
  assert.ok(ALL.size > 300, `only ${ALL.size} keys extracted`);
  for (const k of ['Play', 'Settings', 'Teapot', 'Daily {date}', 'Star Boutique']) assert.ok(ALL.has(k), k);
});

for (const loc of I18N.LOCALES.filter((l) => !l.startsWith('en-'))) {
  test(`${loc} covers every key with matching placeholders`, () => {
    const d = I18N.DICTS[loc];
    const missing = [...ALL].filter((k) => !(k in d));
    assert.deepStrictEqual(missing, [], `${loc} missing ${missing.length}`);
    const bad = [...ALL].filter((k) => ph(d[k]) !== ph(k));
    assert.deepStrictEqual(bad, [], `${loc} placeholder mismatch`);
    const stray = Object.keys(d).filter((k) => !ALL.has(k));
    assert.deepStrictEqual(stray, [], `${loc} stray keys`);
  });
}

test('en-GB only overrides spelling of known keys', () => {
  for (const k of Object.keys(I18N.DICTS['en-GB'])) assert.ok(ALL.has(k), k);
  assert.strictEqual(I18N.DICTS['en-GB']['Color palette'], 'Colour palette');
});

test('T formats, falls back and switches live', () => {
  const seen = [];
  I18N.onLanguage((l) => seen.push(l));
  I18N.setLocale('it-IT');
  assert.strictEqual(I18N.T('Play'), 'Gioca');
  assert.strictEqual(I18N.T('Daily {date}', { date: '2026-10-17' }), 'Giornaliera 2026-10-17');
  assert.strictEqual(I18N.T('Some player name'), 'Some player name');
  I18N.setLocale('fr-CA');
  assert.strictEqual(I18N.getLang(), 'fr-CA');
  I18N.setLocale('xx-YY');
  assert.strictEqual(I18N.getLang(), 'en-US');
  assert.deepStrictEqual(seen, ['it-IT', 'fr-CA', 'en-US']);
});
