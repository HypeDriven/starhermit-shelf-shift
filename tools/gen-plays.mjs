// Writes the native play scripts (tests/native/*.play) from the rules: a
// greedy solver (tools/validate.js's policy, seeded the same way) plays each
// round in node and the script repeats its moves through the real UI —
// by clicks or finger touches on the cells' named targets ("shelf 2 cell 3:",
// "counter cell 1:"), or by the focus ring's arrows and Enter. The rules are
// deterministic given the moves (deliveries come from the round's seed), so
// the scripts end exactly where the solver did. `npm run plays` rewrites
// them; tests/native.mjs writes today's Daily (.daily.play) at test time.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Rules = require('../js/rules.js');
const Content = require('../js/content.js');
const RNG = require('../js/rng.js');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- the solver (tools/validate.js solveOnce, from any state) ----------
function pickMove(state, rng) {
  const moves = Rules.legalMoves(state);
  if (!moves.length) return null;
  const need = {};
  for (const t in state.cfg.orders) if ((state.orders[t] || 0) < state.cfg.orders[t]) need[t] = true;
  const rows = state.shelves.map((row) => { const c = {}; row.forEach((it) => { if (it) c[it] = (c[it] || 0) + 1; }); return c; });
  const counterFilled = state.counter.filter(Boolean).length;
  const per = (state.cfg.delivery && state.cfg.delivery.per) || 1;
  const urgent = state.cfg.delivery && counterFilled > state.counter.length - per;
  let bestScore = -Infinity;
  const scored = [];
  for (const m of moves) {
    let sc = 0;
    const fromRow = m.from.area === 'shelf' ? rows[m.from.r] : null;
    const toCount = m.to.area === 'shelf' && (m.from.area !== 'shelf' || m.from.r !== m.to.r) ? (rows[m.to.r][m.item] || 0) : -1;
    if (toCount === 2) sc = need[m.item] ? 100 : 70;
    else if (toCount === 1) sc = need[m.item] ? 40 : 25;
    else if (m.from.area === 'counter' && m.to.area === 'shelf') sc = 8;
    else if (m.from.area === 'shelf' && m.to.area === 'counter') sc = 2;
    if (m.from.area === 'counter' && sc > 2) sc += 12;
    if (fromRow && fromRow[m.item] > 1 && (m.to.area !== 'shelf' || m.to.r !== m.from.r)) sc -= 15;
    if (urgent && m.from.area === 'counter') sc += 60;
    scored.push([sc, m]);
    if (sc > bestScore) bestScore = sc;
  }
  const pool = scored.filter(([sc]) => sc >= bestScore - 6);
  return pool[rng.int(pool.length)][1];
}
/** Moves that reach `done(state, events)` from `start` (seeded restarts as validate.js solve), or null. */
export function solveFrom(start, done, maxMoves = 400, attempts = 60) {
  let best = null;
  for (let a = 0; a < attempts; a++) {
    const rng = RNG.derive((start.seed ^ (a * 7919)) >>> 0, RNG.STREAM_DECOR);
    let state = Rules.clone(start);
    const moves = [];
    const seen = [];
    let ok = false;
    for (let i = 0; i < maxMoves && !state.terminal; i++) {
      const m = pickMove(state, rng);
      if (!m) break;
      const res = Rules.applyCommand(state, { type: 'move', from: m.from, to: m.to, atMs: 0 });
      if (!res.ok) break;
      state = res.state;
      moves.push({ from: m.from, to: m.to, item: m.item });
      seen.push(...res.events);
      if (done(state, seen)) { ok = true; break; }
    }
    if (ok && (!best || moves.length < best.moves.length)) best = { moves, state };
    if (best && a > 8) break;
  }
  return best;
}
const won = (s) => !!(s.terminal && s.terminal.won);
export function solveCfg(cfg) {
  const r = solveFrom(Rules.createGame(cfg), won);
  if (!r) throw new Error(`no solution for ${cfg.id}`);
  return r;
}
/** main.js startLesson's fixtures. */
export function lessonState(lesson) {
  const s = Rules.createGame(lesson.cfg);
  if (lesson.force && lesson.force.counterTypes) lesson.force.counterTypes.forEach((t, k) => { s.counter[k] = t; });
  if (lesson.force && lesson.force.counter0) s.counter[0] = lesson.force.counter0;
  if (lesson.force && lesson.force.shelves) lesson.force.shelves.forEach((row, r) => row.forEach((t, c) => { s.shelves[r][c] = t; }));
  return s;
}

// ---------- script pieces ----------
const name = (loc) => (loc.area === 'counter' ? `counter cell ${loc.i + 1}:` : `shelf ${loc.r + 1} cell ${loc.c + 1}:`);
/** A move by two presses on the cells' targets (`click` with the mouse, `touch` with a finger). */
export function pressMoves(moves, verb = 'click') {
  const out = [];
  for (const m of moves) {
    out.push(`# ${m.item}: ${name(m.from)} → ${name(m.to)}`);
    out.push('frames 5', `${verb} ${name(m.from)}`, 'frames 5', `${verb} ${name(m.to)}`, 'frames 3');
  }
  return out;
}
/** main.js cursorGrid / moveCursor, simulated: arrows from the focus ring's cell to each cell, Enter on it. */
export function keyMoves(state0, moves) {
  const board = state0.cfg.board;
  const grid = [];
  for (let r = board.shelves - 1; r >= 0; r--) grid.push(Array.from({ length: board.cols }, (_, c) => ({ area: 'shelf', r, c })));
  grid.push(Array.from({ length: board.counter }, (_, i) => ({ area: 'counter', i })));
  const pos = (loc) => {
    const ri = grid.findIndex((row) => row.some((l) => Rules.locEq(l, loc)));
    return [ri, grid[ri].findIndex((l) => Rules.locEq(l, loc))];
  };
  let cur = null;
  const out = [];
  const go = (loc) => {
    if (!cur) { out.push('key ArrowLeft 1', 'frames 2'); cur = [grid.length - 1, 0]; }
    let [ri, ci] = cur;
    const [rt, ct] = pos(loc);
    while (ri !== rt) {
      const up = rt < ri;
      ri += up ? -1 : 1;
      ci = Math.min(ci, grid[ri].length - 1);
      out.push(`key ${up ? 'ArrowUp' : 'ArrowDown'} 1`, 'frames 2');
    }
    while (ci !== ct) {
      const left = ct < ci;
      ci += left ? -1 : 1;
      out.push(`key ${left ? 'ArrowLeft' : 'ArrowRight'} 1`, 'frames 2');
    }
    cur = [ri, ci];
    out.push('key Enter 1', 'frames 3');
  };
  for (const m of moves) {
    out.push(`# ${m.item}: ${name(m.from)} → ${name(m.to)}`);
    go(m.from);
    go(m.to);
  }
  return out;
}
const write = (file, lines) => writeFileSync(join(root, 'tests', 'native', file), lines.join('\n') + '\n');

// ---------- the scripts ----------
/** Journey 1 by keys, then Journey 2 by mouse clicks on the cells, the results' Next, then the Menu. */
function journeyScript() {
  const j1 = Content.JOURNEY[0], j2 = Content.JOURNEY[1];
  const s1 = solveCfg(j1), s2 = solveCfg(j2);
  return [
    '# Generated by tools/gen-plays.mjs: Journey 1 by the focus ring (arrows + Enter), its results, Next, Journey 2 by mouse clicks on the cells, its results, the menu.',
    '# viewport 1280x800@1',
    'until 600 Daily challenge',
    'frames 30',
    'click =Journey',
    'until 300 Stage 1: First Shelf',
    'frames 10',
    'save journey-grid',
    'click Stage 1: First Shelf',
    'until 300 Orders',
    'frames 120',
    'save stage1',
    ...keyMoves(Rules.createGame(j1), s1.moves),
    'until 300 Orders complete!',
    'frames 30',
    'expect Triples cleared',
    'save results1',
    'click =Next',
    'until 300 Window Display',
    'frames 60',
    ...pressMoves(s2.moves, 'click'),
    'until 300 Orders complete!',
    'frames 20',
    'click =Menu',
    'until 300 Daily challenge',
    'frames 10',
    'expect 2/40',
  ];
}
/** The five lessons by finger on a DPR-3 phone (Undo by the tray in lesson 5). */
function learnScript() {
  const lessons = Content.tutorialLessons();
  const out = [
    '# Generated by tools/gen-plays.mjs: the five lessons by finger on a DPR-3 phone: moves, a triple, an order, two triples under deliveries, a move undone.',
    '# viewport 390x844@3',
    'until 600 Daily challenge',
    'frames 30',
    'touch =Play',
    'until 300 Choose a mode',
    'frames 10',
    'touch Interactive lessons',
    'until 300 Form a triple',
    'frames 10',
    'save learn-list',
    'touch 1. Move an object',
  ];
  lessons.forEach((l, i) => {
    out.push(`until 300 Lesson ${i + 1}: ${l.title}`, 'frames 90');
    if (i === 1) out.push('save lesson2-phone');
    const st = lessonState(l);
    if (l.goal.event === 'undo') {
      const m = solveFrom(st, () => true, 1, 1).moves;
      out.push(...pressMoves(m, 'touch'), 'frames 30', 'touch =Undo (U)', 'frames 5');
    } else {
      const goal = l.goal;
      const done = (s, evs) => (goal.event === 'win' ? won(s) : evs.filter((e) => e.type === goal.event).length >= goal.count);
      const r = solveFrom(st, done);
      if (!r) throw new Error(`no solution for lesson ${l.id}`);
      out.push(...pressMoves(r.moves, 'touch'));
    }
    out.push('until 300 Lesson complete!');
  });
  out.push('until 300 Tutorial finished', 'frames 20', 'until 300 Daily challenge', 'save learn-done');
  return out;
}
/** Practice on a short landscape phone: setup, a hint, moves, undo, the pause panel's settings and help, restart, leave. */
function practiceScript() {
  const p = Content.PRACTICE[0];
  const cfg = Object.assign({}, p, { seed: RNG.hashString('shelf'), theme: 'ember' });
  const r = solveCfg(cfg);
  const few = r.moves.slice(0, 3);
  return [
    '# Generated by tools/gen-plays.mjs: Practice (Casual, seed "shelf") on a short landscape phone by finger: the setup, a hint, three moves, an undo, pause → settings and help, restart, leave.',
    '# viewport 844x390@3',
    'until 600 Daily challenge',
    'frames 30',
    'touch =Play',
    'until 300 Choose a mode',
    'frames 10',
    'swipe 50% 65% 50% 15% 12',
    'frames 20',
    'touch Relaxed play with undo',
    'until 300 Seed (optional)',
    'frames 10',
    'touch random',
    'frames 10',
    'type shelf',
    'frames 5',
    'save practice-setup',
    'touch =Start',
    'until 300 Orders',
    'frames 60',
    'touch =Hint (H)',
    'frames 10',
    'expect 💡',
    'save practice-hint',
    ...pressMoves(few, 'touch'),
    'frames 30',
    'expect moves 3',
    'touch =Undo (U)',
    'frames 10',
    'expect Undone.',
    'expect moves 2',
    'save practice-land',
    'touch =Pause (P)',
    'until 300 Restart round',
    'frames 10',
    'touch =Settings',
    'until 300 Captions for audio cues',
    'frames 10',
    'save practice-settings',
    'touch =Done',
    'until 300 Restart round',
    'frames 10',
    'touch =Help',
    'until 300 The counter',
    'frames 10',
    'touch =Done',
    'until 300 Restart round',
    'frames 10',
    'touch =Restart round',
    'until 300 Orders',
    'frames 30',
    'expect moves 0',
    'key Escape 1',
    'until 300 Leave round',
    'frames 10',
    'touch =Leave round',
    'until 300 Daily challenge',
  ];
}
/** The menus on a desktop: How to play, Settings (palette, captions, left-handed, board controls), Profile, Scores; Challenge 1 won by the visible board controls; Score chase a few moves then left. */
function menusScript() {
  const c1 = Content.CHALLENGES[0];
  const r = solveCfg(c1);
  const sc = Object.assign({}, Content.SCORE_CHASE, { seed: RNG.hashString('chase') });
  const rs = solveFrom(Rules.createGame(sc), (s) => s.moves >= 6);
  return [
    '# Generated by tools/gen-plays.mjs: the menus on a desktop: How to play, Settings (high-visibility palette, captions, visible board controls), Profile, Scores; Challenge 1 (Tidy Sprint) won through the visible board controls, its local board rank; Score chase (seed "chase") six moves, paused and left; the scores tab.',
    '# viewport 1280x800@1',
    'until 600 Daily challenge',
    'frames 30',
    'click =How to play',
    'until 300 The counter',
    'frames 10',
    'save help',
    'click =Done',
    'until 300 Daily challenge',
    'frames 10',
    'click =Settings',
    'until 300 Left-handed controls',
    'frames 10',
    'click =Standard',
    'frames 10',
    'click =High visibility',
    'frames 10',
    'click =Captions for audio cues',
    'frames 5',
    'click =Visible board controls (DOM)',
    'frames 5',
    'save settings',
    'click =Done',
    'until 300 Daily challenge',
    'frames 10',
    'click =Profile',
    'until 300 Achievements',
    'frames 10',
    'save profile',
    'click =← Back',
    'until 300 Daily challenge',
    'frames 10',
    'click =Play',
    'until 300 Choose a mode',
    'frames 10',
    'click Move limits, speed targets',
    'until 300 Clear every order in 100 seconds',
    'frames 10',
    'click =Start',
    'until 300 Orders',
    'frames 60',
    'save challenge-mirror',
    ...pressMoves(r.moves, 'click'),
    'until 300 Orders complete!',
    'frames 20',
    'expect Local board rank #1',
    'save challenge-results',
    'click =Menu',
    'until 300 Daily challenge',
    'frames 10',
    'click =Play',
    'until 300 Choose a mode',
    'frames 10',
    'click Endless counter',
    'until 300 Seed (share to challenge others)',
    'frames 10',
    'click random',
    'frames 10',
    'type chase',
    'frames 5',
    'click =Start',
    'until 300 Orders',
    'frames 60',
    ...pressMoves(rs.moves, 'click'),
    'frames 20',
    'expect moves 6',
    'save score-chase',
    'key KeyP 1',
    'until 300 Leave round',
    'frames 10',
    'click =Leave round',
    'until 300 Daily challenge',
    'frames 10',
    'click =Scores',
    'until 300 Entries carry ruleset',
    'frames 10',
    'click =Challenges',
    'frames 10',
    'expect c1',
    'save scores',
  ];
}
/** Today's Daily by mouse clicks (tests/native.mjs writes it at test time: the round follows the UTC day). */
export function dailyScript(cfg) {
  const r = solveCfg(cfg);
  return [
    `# Generated at test time by tests/native.mjs (tools/gen-plays.mjs dailyScript): the Daily for ${cfg.date} by mouse clicks on the cells.`,
    '# viewport 1280x800@1',
    'until 600 Daily challenge',
    'frames 30',
    'click Daily challenge',
    'until 300 one shared seed for everyone today',
    'frames 10',
    'click =Start',
    'until 300 Orders',
    'frames 60',
    ...pressMoves(r.moves, 'click'),
    'until 300 Orders complete!',
    'frames 20',
    'expect Local board rank #1',
    'save daily-results',
  ].join('\n') + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  write('journey-keys.play', journeyScript());
  write('learn-phone.play', learnScript());
  write('practice-land.play', practiceScript());
  write('menus.play', menusScript());
  console.log('wrote tests/native/{journey-keys,learn-phone,practice-land,menus}.play');
}
