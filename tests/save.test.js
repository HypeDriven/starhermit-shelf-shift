// The engine client's save model (pure): js/store.js's document as the
// engine save, two devices' saves merged, the browser build's checksummed
// cloud slot read as a foreign save, and its settings-KV keys migrated
// (js/migrate.js). Signed-in paths can't run here; their logic is this.
const test = require('node:test');
const assert = require('node:assert');
const Store = require('../js/store.js');
const Migrate = require('../js/migrate.js');

function played(name) {
  const d = Store.fresh();
  d.profileName = name;
  return d;
}

test('a fresh document has the progress the client reads', () => {
  const d = Store.fresh();
  assert.strictEqual(d.v, Store.SAVE_VERSION);
  for (const k of ['tutorialDone', 'journeyStars', 'journeyBest', 'challengeBest', 'dailiesDone', 'achievements', 'stats']) assert.ok(k in d.progress, k);
  assert.strictEqual(d.settings.theme, 'ember');
});

test('two devices merge: best of each, nothing dropped, this device keeps its preferences', () => {
  const a = played('A'), b = played('B');
  a.progress.journeyStars = { j01: 3, j02: 1 };
  b.progress.journeyStars = { j02: 2, j03: 1 };
  a.progress.achievements = { 'first-clear': 500 };
  b.progress.achievements = { 'first-clear': 300, 'first-win': 400 };
  a.progress.stats.rounds = 4; b.progress.stats.rounds = 9;
  a.settings.colorPalette = 'high-visibility';
  b.settings.colorPalette = 'standard';
  const m = Store.mergeDocs(b, a);
  assert.deepStrictEqual(m.progress.journeyStars, { j01: 3, j02: 2, j03: 1 });
  assert.deepStrictEqual(m.progress.achievements, { 'first-clear': 300, 'first-win': 400 });
  assert.strictEqual(m.progress.stats.rounds, 9);
  assert.strictEqual(m.settings.colorPalette, 'high-visibility');
  assert.strictEqual(m.profileName, 'A');
});

test('the browser build\'s cloud slot ({ sum, payload }) reads as a document; a broken checksum is refused', () => {
  const old = played('Old');
  old.progress.journeyStars = { j01: 2 };
  old.settings.theme = 'verdant';
  const text = JSON.stringify(JSON.parse(Store.wrap(old))); // the SDK saved JSON.parse(wrapped)
  const doc = Migrate.fromBrowserSave(text);
  assert.deepStrictEqual(doc.progress.journeyStars, { j01: 2 });
  assert.strictEqual(doc.settings.theme, 'verdant');
  const box = JSON.parse(text);
  box.payload = box.payload.replace('"j01":2', '"j01":3');
  assert.strictEqual(Migrate.fromBrowserSave(JSON.stringify(box)), null);
  assert.strictEqual(Migrate.fromBrowserSave(''), null);
  assert.strictEqual(Migrate.fromBrowserSave('{not json'), null);
});

test('a foreign save merges into this device\'s progress', () => {
  const here = Store.fresh();
  here.progress.journeyStars = { j05: 1 };
  const old = Store.fresh();
  old.progress.journeyStars = { j01: 3 };
  old.progress.endlessBest = 1200;
  const m = Store.mergeDocs(Migrate.fromBrowserSave(Store.wrap(old)), here);
  assert.deepStrictEqual(m.progress.journeyStars, { j01: 3, j05: 1 });
  assert.strictEqual(m.progress.endlessBest, 1200);
});

test('the settings KV: the game\'s preferences carry over, the rest is the runtime\'s and removed', () => {
  const kv = {
    music: 0.3, muted: true, gfx: { preset: 'high' }, reducedMotion: true, pad_confirm: 3, 'ui.language': 'de-DE',
    captions: true, theme: 'rose', colorPalette: 'high-visibility', leftHanded: true, holdToDrag: 'hold', haptics: false,
    boardMirror: true, confirmMoves: true,
  };
  assert.deepStrictEqual(Migrate.legacyPreferences(kv), {
    captions: true, theme: 'rose', colorPalette: 'high-visibility', leftHanded: true, holdToDrag: 'hold', haptics: false, boardMirror: true, confirmMoves: true,
  });
  assert.deepStrictEqual(Migrate.legacyPreferences({ colorPalette: 'neon', holdToDrag: 1, captions: 'yes' }), {});
  for (const k of Object.keys(kv)) assert.ok(Migrate.isBrowserKey(k), k);
  assert.ok(!Migrate.isBrowserKey('somethingElse'));
});

test('local score boards sort by score, then completion, invalid actions, duration', () => {
  const e = (o) => Object.assign({ board: 'endless', name: 'Guest', score: 100, won: false, invalid: 0, durationMs: 1000, sessionId: 'x' }, o);
  const sorted = Store.sortEntries([e({ sessionId: 'a', score: 50 }), e({ sessionId: 'b', won: true }), e({ sessionId: 'c' }), e({ sessionId: 'd', invalid: 2, won: true })]);
  assert.deepStrictEqual(sorted.map((x) => x.sessionId), ['b', 'd', 'c', 'a']);
});
