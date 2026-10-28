// The content the native play scripts rely on: every Journey stage,
// challenge and lesson is reachable by the scripts' solver
// (tools/gen-plays.mjs), the solver's moves replay to the same final state
// (the local boards' replay check), and today's Daily is solvable (the test
// writes its play script from it).
const test = require('node:test');
const assert = require('node:assert');
const Rules = require('../js/rules.js');
const Content = require('../js/content.js');

let gen;
test.before(async () => { gen = await import('../tools/gen-plays.mjs'); });

test('the Journey, challenges and practice presets are solvable by the scripts\' solver', () => {
  for (const cfg of [...Content.JOURNEY, ...Content.CHALLENGES]) {
    const r = gen.solveCfg(cfg);
    assert.ok(r.state.terminal && r.state.terminal.won, cfg.id);
  }
});

test('each lesson reaches its goal from its fixtures', () => {
  for (const l of Content.tutorialLessons()) {
    if (l.goal.event === 'undo') continue;
    const st = gen.lessonState(l);
    const r = gen.solveFrom(st, (s, evs) => (l.goal.event === 'win' ? !!(s.terminal && s.terminal.won) : evs.filter((e) => e.type === l.goal.event).length >= l.goal.count));
    assert.ok(r, l.id);
  }
});

test('a solved round replays to the same hash and total (main.ts verifyEntry)', () => {
  const cfg = Content.CHALLENGES[0];
  const r = gen.solveCfg(cfg);
  let s = Rules.createGame(cfg);
  for (const m of r.moves) s = Rules.applyCommand(s, { type: 'move', from: m.from, to: m.to, atMs: 0 }).state;
  assert.strictEqual(Rules.hashState(s), Rules.hashState(r.state));
  assert.strictEqual(s.score.total, r.state.score.total);
});

test('today\'s Daily has a play script', () => {
  const cfg = Content.dailyConfig(Content.utcDateString(Date.now()));
  assert.match(gen.dailyScript(cfg), /Orders complete!/);
});
