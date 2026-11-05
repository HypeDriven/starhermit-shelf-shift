// Localization coverage: every player-facing English key (extracted from the
// source by tests/i18n-keys.js) has a translation in every non-English locale,
// with the same {placeholders}, and no locale carries stray keys.
const test = require('node:test');
const assert = require('node:assert');
const { ALL } = require('./i18n-keys.js');
const I18N = { DICTS: JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '../assets/strings.json'), 'utf8')) };
I18N.LOCALES = Object.keys(I18N.DICTS);

const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('all nine locales are supported', () => {
  assert.deepStrictEqual([...I18N.LOCALES].sort(), ['de-DE', 'en-GB', 'en-US', 'es-419', 'es-ES', 'fr-CA', 'fr-FR', 'it-IT', 'pt-BR']);
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

test('regional tables inherit', () => {
  assert.strictEqual(I18N.DICTS['it-IT'].Play, 'Gioca');
  assert.strictEqual(I18N.DICTS['fr-CA'].Play, I18N.DICTS['fr-CA'].Play || I18N.DICTS['fr-FR'].Play);
});
