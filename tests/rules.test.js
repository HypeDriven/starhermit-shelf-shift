/* Shelf Shift — rules engine unit + property + fuzz tests (node tests/rules.test.js) */
'use strict';
const assert = require('assert');
const Rules = require('../js/rules.js');
const RNG = require('../js/rng.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok  - ' + name); }
  catch (e) { console.error('FAIL - ' + name); console.error(e); process.exitCode = 1; }
}

function baseCfg(over) {
  return Object.assign({
    id: 'test', version: 1, kind: 'practice', seed: 1234,
    board: { shelves: 3, cols: 3, counter: 4 },
    types: ['teapot', 'candle', 'book'],
    stock: { teapot: 3, candle: 3, book: 3 },
    orders: { teapot: 3, candle: 3, book: 3 },
    counterStart: 0,
    delivery: null,
    moveLimit: 0, timeLimitSec: 0,
    par: { moves: 9, timeSec: 120 },
    mechanics: { undo: true, hint: true },
    endless: false
  }, over || {});
}

function findItem(state, item) {
  for (let r = 0; r < state.shelves.length; r++)
    for (let c = 0; c < state.shelves[r].length; c++)
      if (state.shelves[r][c] === item) return { area: 'shelf', r, c };
  return null;
}
function findEmptyOnShelf(state, r) {
  for (let c = 0; c < state.shelves[r].length; c++)
    if (!state.shelves[r][c]) return { area: 'shelf', r, c };
  return null;
}

// Force a controlled board for deterministic rule tests.
function controlledState() {
  const cfg = baseCfg({ stock: {}, counterStart: 0 });
  const s = Rules.createGame(cfg);
  s.shelves = [
    ['teapot', 'teapot', null],
    ['candle', null, null],
    [null, null, null]
  ];
  s.counter = ['teapot', null, null, null];
  s.orders = { teapot: 0, candle: 0 };
  s.cfg.orders = { teapot: 3, candle: 3 };
  return s;
}

test('creation is deterministic for same seed', () => {
  const a = Rules.createGame(baseCfg({ seed: 42 }));
  const b = Rules.createGame(baseCfg({ seed: 42 }));
  assert.strictEqual(Rules.hashState(a), Rules.hashState(b));
  const c = Rules.createGame(baseCfg({ seed: 43 }));
  assert.notStrictEqual(Rules.hashState(a), Rules.hashState(c));
});

test('initial board never contains a starting triple', () => {
  for (let seed = 0; seed < 200; seed++) {
    const s = Rules.createGame(baseCfg({ seed }));
    for (const row of s.shelves) {
      const counts = {};
      for (const it of row) if (it) { counts[it] = (counts[it] || 0) + 1; assert.ok(counts[it] < 3, 'triple at seed ' + seed); }
    }
  }
});

test('legal move applies and bumps tick monotonically', () => {
  const s = controlledState();
  const res = Rules.applyCommand(s, { type: 'move', id: 'm1', from: { area: 'counter', i: 0 }, to: { area: 'shelf', r: 2, c: 0 }, atMs: 500 });
  assert.ok(res.ok);
  assert.strictEqual(res.state.tick, s.tick + 1);
  assert.strictEqual(res.state.shelves[2][0], 'teapot');
  assert.strictEqual(res.state.counter[0], null);
  assert.strictEqual(res.state.elapsedMs, 500);
});

test('invalid moves carry explicit reasons', () => {
  const s = controlledState();
  let r = Rules.applyCommand(s, { type: 'move', from: { area: 'shelf', r: 2, c: 0 }, to: { area: 'shelf', r: 2, c: 1 } });
  assert.strictEqual(r.reason, Rules.INVALID.EMPTY_SOURCE);
  r = Rules.applyCommand(s, { type: 'move', from: { area: 'shelf', r: 0, c: 0 }, to: { area: 'shelf', r: 0, c: 1 } });
  assert.strictEqual(r.reason, Rules.INVALID.OCCUPIED);
  r = Rules.applyCommand(s, { type: 'move', from: { area: 'shelf', r: 0, c: 0 }, to: { area: 'shelf', r: 0, c: 0 } });
  assert.strictEqual(r.reason, Rules.INVALID.SAME_CELL);
  r = Rules.applyCommand(s, { type: 'move', from: { area: 'shelf', r: 9, c: 0 }, to: { area: 'shelf', r: 2, c: 1 } });
  assert.strictEqual(r.reason, Rules.INVALID.BAD_LOC);
  r = Rules.applyCommand(s, { type: 'teleport' });
  assert.strictEqual(r.reason, Rules.INVALID.BAD_CMD);
  r = Rules.applyCommand(s, null);
  assert.strictEqual(r.reason, Rules.INVALID.BAD_SHAPE);
});

test('triple clears, fills order, scores with streak', () => {
  let s = controlledState();
  let res = Rules.applyCommand(s, { type: 'move', from: { area: 'counter', i: 0 }, to: { area: 'shelf', r: 0, c: 2 }, atMs: 1000 });
  assert.ok(res.ok);
  s = res.state;
  assert.deepStrictEqual(s.shelves[0], [null, null, null]);
  assert.strictEqual(s.orders.teapot, 3);
  assert.strictEqual(s.score.clearPoints, 100);
  assert.strictEqual(s.score.orderBonus, 250);
  assert.strictEqual(s.streak, 1);
  assert.ok(res.events.some(e => e.type === 'clear'));
  assert.ok(res.events.some(e => e.type === 'order-complete'));
});

test('win: orders-complete terminal with capacity + move bonus', () => {
  let s = controlledState();
  s.shelves[1] = ['candle', 'candle', null];
  let res = Rules.applyCommand(s, { type: 'move', from: { area: 'counter', i: 0 }, to: { area: 'shelf', r: 0, c: 2 }, atMs: 2000 });
  s = res.state;
  // candle: need one more triple; place a candle via direct setup move
  s.shelves[2][0] = 'candle';
  res = Rules.applyCommand(s, { type: 'move', from: { area: 'shelf', r: 2, c: 0 }, to: { area: 'shelf', r: 1, c: 2 }, atMs: 4000 });
  s = res.state;
  assert.ok(s.terminal && s.terminal.won);
  assert.strictEqual(s.terminal.reason, Rules.TERMINAL.ORDERS);
  assert.ok(s.score.capacityBonus > 0);
  assert.strictEqual(s.score.moveBonus, (s.cfg.par.moves - s.moves) * 20);
  assert.strictEqual(s.score.total, s.score.clearPoints + s.score.orderBonus + s.score.capacityBonus + s.score.moveBonus + s.score.timeBonus);
  const after = Rules.applyCommand(s, { type: 'move', from: { area: 'counter', i: 1 }, to: { area: 'shelf', r: 0, c: 0 } });
  assert.strictEqual(after.reason, Rules.INVALID.ENDED);
});

test('lose: staging overflow on delivery', () => {
  const cfg = baseCfg({ board: { shelves: 3, cols: 4, counter: 4 }, delivery: { every: 1, per: 2 }, counterStart: 4 });
  let s = Rules.createGame(cfg);
  assert.strictEqual(s.counter.filter(Boolean).length, 4); // already full
  const moves = Rules.legalMoves(s);
  assert.ok(moves.length > 0);
  // shuffle shelf→shelf (counter untouched); the delivery then finds zero staging openings
  const mv = moves.find(m => m.from.area === 'shelf' && m.to.area === 'shelf');
  const res = Rules.applyCommand(s, { type: 'move', from: mv.from, to: mv.to, atMs: 100 });
  assert.ok(res.ok);
  assert.ok(res.state.terminal && !res.state.terminal.won);
  assert.strictEqual(res.state.terminal.reason, Rules.TERMINAL.OVERFLOW);
});

test('partial delivery does not lose while a staging cell remains', () => {
  const cfg = baseCfg({ board: { shelves: 3, cols: 4, counter: 4 }, delivery: { every: 1, per: 2 }, counterStart: 3 });
  let s = Rules.createGame(cfg);
  const moves = Rules.legalMoves(s);
  const mv = moves.find(m => m.from.area === 'shelf' && m.to.area === 'shelf');
  const res = Rules.applyCommand(s, { type: 'move', from: mv.from, to: mv.to, atMs: 100 });
  assert.ok(res.ok);
  assert.strictEqual(res.state.terminal, null); // 1 slot free → delivery partially fits, game continues
  assert.strictEqual(res.state.counter.filter(Boolean).length, 4);
});

test('lose: move limit', () => {
  const cfg = baseCfg({ moveLimit: 1 });
  let s = Rules.createGame(cfg);
  const mv = Rules.legalMoves(s)[0];
  const res = Rules.applyCommand(s, { type: 'move', from: mv.from, to: mv.to, atMs: 100 });
  assert.strictEqual(res.state.terminal.reason, Rules.TERMINAL.MOVES);
  assert.strictEqual(res.state.terminal.won, false);
});

test('lose: time limit uses quantized command time', () => {
  const cfg = baseCfg({ timeLimitSec: 10 });
  let s = Rules.createGame(cfg);
  const mv = Rules.legalMoves(s)[0];
  const res = Rules.applyCommand(s, { type: 'move', from: mv.from, to: mv.to, atMs: 10001 });
  assert.strictEqual(res.state.elapsedMs, 10000);
  assert.strictEqual(res.state.terminal.reason, Rules.TERMINAL.TIME);
});

test('resign terminates with reason', () => {
  const s = Rules.createGame(baseCfg());
  const res = Rules.applyCommand(s, { type: 'resign', id: 'r1' });
  assert.strictEqual(res.state.terminal.reason, Rules.TERMINAL.RESIGN);
  assert.strictEqual(res.state.terminal.won, false);
});

test('serialization round-trips and hashes match', () => {
  let s = Rules.createGame(baseCfg({ seed: 7, delivery: { every: 2, per: 1 } }));
  for (let i = 0; i < 5 && !s.terminal; i++) {
    const moves = Rules.legalMoves(s);
    if (!moves.length) break;
    const mv = moves[i % moves.length];
    const res = Rules.applyCommand(s, { type: 'move', from: mv.from, to: mv.to, atMs: i * 500 });
    if (res.ok) s = res.state;
  }
  const restored = Rules.deserialize(Rules.serialize(s));
  assert.strictEqual(Rules.hashState(restored), Rules.hashState(s));
});

test('property: identical seed + commands → identical hashes (replay)', () => {
  function play(seed) {
    let s = Rules.createGame(baseCfg({ seed, delivery: { every: 2, per: 2 } }));
    const hashes = [Rules.hashState(s)];
    const rng = RNG.derive(seed, RNG.STREAM_AV);
    for (let i = 0; i < 40 && !s.terminal; i++) {
      const moves = Rules.legalMoves(s);
      if (!moves.length) break;
      const mv = moves[rng.int(moves.length)];
      const res = Rules.applyCommand(s, { type: 'move', id: 'c' + i, from: mv.from, to: mv.to, atMs: i * 700 });
      if (res.ok) { s = res.state; hashes.push(Rules.hashState(s)); }
    }
    return hashes;
  }
  for (const seed of [1, 999, 31337]) {
    assert.deepStrictEqual(play(seed), play(seed), 'replay mismatch at seed ' + seed);
  }
});

test('endless mode issues new order waves instead of ending', () => {
  const cfg = baseCfg({ endless: true, stock: { teapot: 6 }, orders: { teapot: 3 }, counterStart: 0 });
  let s = Rules.createGame(cfg);
  s.shelves = [['teapot', 'teapot', null], [null, null, null], [null, null, null]];
  s.counter[0] = 'teapot';
  const res = Rules.applyCommand(s, { type: 'move', from: { area: 'counter', i: 0 }, to: { area: 'shelf', r: 0, c: 2 }, atMs: 100 });
  assert.ok(res.ok);
  assert.strictEqual(res.state.terminal, null);
  assert.strictEqual(res.state.endlessRound, 2);
  assert.ok(res.events.some(e => e.type === 'orders-new'));
});

test('hint uses legal moves and prefers completing a triple', () => {
  const s = controlledState();
  const h = Rules.hint(s);
  assert.ok(h);
  assert.strictEqual(h.why, 'complete-triple');
  assert.strictEqual(h.item, 'teapot');
  assert.strictEqual(h.to.r, 0);
  // every hint must itself be legal
  assert.strictEqual(Rules.checkMove(s, h.from, h.to), null);
});

test('legalMoves is empty on terminal state', () => {
  const s = Rules.createGame(baseCfg());
  const res = Rules.applyCommand(s, { type: 'resign' });
  assert.deepStrictEqual(Rules.legalMoves(res.state), []);
  assert.strictEqual(Rules.hint(res.state), null);
});

test('fuzz: malformed commands never crash or mutate state', () => {
  const s0 = Rules.createGame(baseCfg({ seed: 5 }));
  const h0 = Rules.hashState(s0);
  const junk = [undefined, null, 0, '', 'move', [], {}, { type: 5 }, { type: 'move' },
    { type: 'move', from: 'x', to: [] },
    { type: 'move', from: { area: 'counter', i: -1 }, to: { area: 'shelf', r: 0, c: 0 } },
    { type: 'move', from: { area: 'shelf', r: 0.5, c: 0 }, to: { area: 'shelf', r: 0, c: 1 } },
    { type: 'move', from: { area: 'moon', r: 0, c: 0 }, to: { area: 'shelf', r: 0, c: 1 } },
    { type: 'move', from: { area: 'shelf', r: 0, c: 0 }, to: { area: 'shelf', r: 0, c: 1 }, atMs: NaN }];
  for (const cmd of junk) {
    const res = Rules.applyCommand(s0, cmd);
    if (!res.ok) assert.ok(res.reason);
    assert.strictEqual(Rules.hashState(s0), h0, 'state mutated by junk command');
  }
  const rng = RNG.create(123);
  for (let i = 0; i < 500; i++) {
    const cmd = { type: 'move', from: { area: rng.pick(['shelf', 'counter', 'x']), r: rng.range(-2, 9), c: rng.range(-2, 9), i: rng.range(-2, 9) },
                  to: { area: rng.pick(['shelf', 'counter']), r: rng.range(-2, 9), c: rng.range(-2, 9), i: rng.range(-2, 9) } };
    Rules.applyCommand(s0, cmd);
  }
  assert.strictEqual(Rules.hashState(s0), h0);
});

test('fuzz: long random games always terminate cleanly, no NaN, bounded ticks', () => {
  for (const seed of [11, 22, 33, 44]) {
    let s = Rules.createGame(baseCfg({ seed, delivery: { every: 1, per: 2 }, timeLimitSec: 300 }));
    const rng = RNG.derive(seed, RNG.STREAM_DECOR);
    let steps = 0;
    while (!s.terminal && steps < 5000) {
      steps++;
      const moves = Rules.legalMoves(s);
      assert.ok(moves.length > 0, 'no legal moves but not terminal');
      const mv = moves[rng.int(moves.length)];
      const res = Rules.applyCommand(s, { type: 'move', from: mv.from, to: mv.to, atMs: steps * 250 });
      assert.ok(res.ok);
      s = res.state;
      assert.ok(Number.isFinite(s.score.total));
    }
    assert.ok(steps < 5000, 'game did not terminate (unbounded loop)');
    assert.ok(s.terminal, 'terminal reason missing');
  }
});

test('command shape validation rejects oversized payloads', () => {
  assert.strictEqual(Rules.validateCommandShape({ type: 'move', from: { area: 'shelf', r: 0, c: 0 }, to: { area: 'shelf', r: 0, c: 1 } }), null);
  assert.strictEqual(Rules.validateCommandShape({ type: 'nope' }), Rules.INVALID.BAD_CMD);
  assert.strictEqual(Rules.validateCommandShape({ type: 'move', id: 'x'.repeat(100) }), Rules.INVALID.BAD_SHAPE);
  assert.strictEqual(Rules.validateCommandShape({ type: 'move', note: 'x'.repeat(1000) }, 512), Rules.INVALID.BAD_SHAPE);
});

console.log('\n' + passed + ' tests passed' + (process.exitCode ? ' (with failures)' : ''));
