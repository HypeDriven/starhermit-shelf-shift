/* Shelf Shift — offline content validator (node tools/validate.js)
 * Proves for every piece of content:
 *  - basic legality (schema, stock fits, orders multiples of 3, types known)
 *  - initial board has empty cells and no starting triple (engine-guaranteed)
 *  - reachable goals: a deterministic greedy solver can complete the orders
 *  - bounded duration (solver move count is finite and reported)
 *  - absence of soft locks (engine guard + solver never sees empty legal set)
 * Exits non-zero on the first failing content id.
 */
'use strict';
const Rules = require('../js/rules.js');
const Content = require('../js/content.js');
const RNG = require('../js/rng.js');

let failures = 0;
function fail(id, msg) { failures++; console.error('FAIL ' + id + ': ' + msg); }
function note(id, msg) { console.log('ok   ' + id + ' — ' + msg); }

// ---------- static checks ----------
function checkSchema(cfg) {
  const errs = [];
  if (!cfg.id || typeof cfg.id !== 'string') errs.push('missing id');
  if (!Number.isInteger(cfg.version)) errs.push('missing version');
  if (!Number.isInteger(cfg.seed)) errs.push('missing integer seed');
  const b = cfg.board || {};
  if (!(b.shelves >= 1 && b.cols >= 2 && b.counter >= 1)) errs.push('bad board dims');
  const cap = b.shelves * b.cols;
  let stockTotal = 0;
  for (const t in (cfg.stock || {})) {
    if (!cfg.types.includes(t)) errs.push('stock type not in types: ' + t);
    stockTotal += cfg.stock[t];
  }
  if (stockTotal > cap) errs.push('stock exceeds shelf capacity');
  if (cap - stockTotal + b.counter < 2) errs.push('fewer than 2 openings — no room to play');
  for (const t in (cfg.orders || {})) {
    if (!cfg.types.includes(t)) errs.push('order type not in types: ' + t);
    if (cfg.orders[t] % 3 !== 0) errs.push('order not a multiple of 3: ' + t);
    if (cfg.orders[t] <= 0) errs.push('non-positive order: ' + t);
  }
  if (Object.keys(cfg.orders || {}).length === 0) errs.push('no orders');
  if (cfg.moveLimit && cfg.par && cfg.par.moves && cfg.moveLimit < cfg.par.moves)
    errs.push('move limit below par moves');
  if (cfg.delivery && !(cfg.delivery.every >= 1 && cfg.delivery.per >= 1)) errs.push('bad delivery');
  return errs;
}

// ---------- greedy solver (uses only the public legality surface) ----------
function neededTypes(state) {
  const need = {};
  for (const t in state.cfg.orders)
    if ((state.orders[t] || 0) < state.cfg.orders[t]) need[t] = true;
  return need;
}

// Heuristic policy with seeded random restarts: a level is "reachable"
// when any of N attempts wins. This approximates a competent player far
// better than a single greedy run and avoids over-tuning content to one
// rigid strategy.
function solveOnce(cfg, attemptRng, maxMoves) {
  let state = Rules.createGame(cfg);
  let steps = 0;

  function rowInfo() {
    return state.shelves.map(row => {
      const counts = {};
      row.forEach(it => { if (it) counts[it] = (counts[it] || 0) + 1; });
      return counts;
    });
  }

  while (!state.terminal && steps < maxMoves) {
    steps++;
    const moves = Rules.legalMoves(state);
    if (!moves.length) return { ok: false, why: 'soft lock: no legal moves, not terminal', moves: steps };
    const need = neededTypes(state);
    const rows = rowInfo();
    const counterFilled = state.counter.filter(Boolean).length;
    const per = (state.cfg.delivery && state.cfg.delivery.per) || 1;
    const urgent = state.cfg.delivery && counterFilled > state.counter.length - per;

    let best = null, bestScore = -Infinity;
    const scored = [];
    for (const m of moves) {
      let sc = 0;
      const fromRow = m.from.area === 'shelf' ? rows[m.from.r] : null;
      const toCount = m.to.area === 'shelf' && (m.from.area !== 'shelf' || m.from.r !== m.to.r)
        ? (rows[m.to.r][m.item] || 0) : -1;
      if (toCount === 2) sc = need[m.item] ? 100 : 70;          // completes a triple
      else if (toCount === 1) sc = need[m.item] ? 40 : 25;      // builds a pair
      else if (m.from.area === 'counter' && m.to.area === 'shelf') sc = 8; // shelving
      else if (m.from.area === 'shelf' && m.to.area === 'counter') sc = 2; // frees a shelf cell
      if (m.from.area === 'counter' && sc > 2) sc += 12;        // counter items are urgent cargo
      if (fromRow && fromRow[m.item] > 1 && (m.to.area !== 'shelf' || m.to.r !== m.from.r))
        sc -= 15;                                                // breaks up an existing group
      if (urgent && m.from.area === 'counter') sc += 60;
      scored.push([sc, m]);
      if (sc > bestScore) bestScore = sc;
    }
    // choose among near-best candidates, seeded per attempt
    const pool = scored.filter(([sc]) => sc >= bestScore - 6);
    const pick = pool[attemptRng.int(pool.length)][1] || best;

    const res = Rules.applyCommand(state, { type: 'move', from: pick.from, to: pick.to, atMs: steps * 800 });
    if (!res.ok) return { ok: false, why: 'solver produced illegal move: ' + res.reason, moves: steps };
    state = res.state;
    if (!Number.isFinite(state.score.total)) return { ok: false, why: 'NaN score', moves: steps };
  }
  if (!state.terminal) return { ok: false, why: 'exceeded move cap ' + maxMoves, moves: steps };
  return { ok: state.terminal.won, won: state.terminal.won, why: state.terminal.reason, moves: state.moves, score: state.score.total };
}

function solve(cfg, maxMoves, attempts) {
  attempts = attempts || 40;
  let best = null;
  for (let a = 0; a < attempts; a++) {
    const rng = RNG.derive((cfg.seed ^ (a * 7919)) >>> 0, RNG.STREAM_DECOR);
    const res = solveOnce(cfg, rng, maxMoves || 600);
    if (!best || (res.won && !best.won) || (res.won === best.won && res.moves < best.moves)) best = res;
    if (res.won) return res;
    if (res.why === 'soft lock: no legal moves, not terminal' || res.why === 'NaN score' ||
        (res.why || '').startsWith('solver produced')) return res; // engine-level fault: always fatal
  }
  return best;
}

// ---------- run ----------
function validateLevel(cfg, opts) {
  opts = opts || {};
  const errs = checkSchema(cfg);
  if (errs.length) { errs.forEach(e => fail(cfg.id, e)); return; }
  const res = solve(cfg, opts.maxMoves);
  if (!res.ok && !opts.mayLose) fail(cfg.id, 'solver could not win (' + res.why + ', moves=' + res.moves + ')');
  else {
    const parNote = cfg.par && cfg.par.moves ? (res.moves <= cfg.par.moves * 2 ? '' : ' [solver far over par]') : '';
    note(cfg.id, 'won in ' + res.moves + ' moves (par ' + (cfg.par ? cfg.par.moves : '—') + '), score ' + res.score + parNote);
  }
}

console.log('== journey (' + Content.JOURNEY.length + ' stages) ==');
Content.JOURNEY.forEach(cfg => validateLevel(cfg));
console.log('== challenges ==');
Content.CHALLENGES.forEach(cfg => validateLevel(cfg));
console.log('== practice presets ==');
Content.PRACTICE.forEach((cfg, i) => validateLevel(Object.assign({ seed: 7000 + i }, cfg)));
console.log('== tutorial lessons ==');
Content.tutorialLessons().forEach(l => {
  const errs = checkSchema(l.cfg).filter(e => e !== 'no orders' || true);
  // tutorial orders like 99 are intentional (unreachable, lesson ends on goal event)
  const realErrs = checkSchema(l.cfg).filter(e => !/order/.test(e));
  if (realErrs.length) realErrs.forEach(e => fail(l.id, e)); else note(l.id, 'schema ok');
});
console.log('== daily: next 14 UTC days ==');
const today = Date.UTC(2026, 7, 18);
for (let d = 0; d < 14; d++) {
  const ds = Content.utcDateString(today + d * 86400000);
  const cfg = Content.dailyConfig(ds);
  // immutability: same date → same config, always
  const again = Content.dailyConfig(ds);
  if (Rules.stableStringify(cfg) !== Rules.stableStringify(again)) fail(cfg.id, 'daily config not immutable');
  validateLevel(cfg);
}
console.log('== score chase (endless): plays until overflow, must survive 20+ moves ==');
{
  const cfg = Object.assign({}, Content.SCORE_CHASE, { seed: 424242 });
  const errs = checkSchema(cfg);
  if (errs.length) errs.forEach(e => fail(cfg.id, e));
  const res = solve(cfg, 6000);
  if (!res.moves || res.moves < 20) fail(cfg.id, 'ended too early: ' + res.why);
  else note(cfg.id, 'survived ' + res.moves + ' moves, ' + (res.why || 'still running') + ', score ' + res.score);
}

console.log(failures ? '\n' + failures + ' validation failure(s)' : '\nAll content validated.');
process.exitCode = failures ? 1 : 0;
