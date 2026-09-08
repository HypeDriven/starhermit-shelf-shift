/* Shelf Shift — pure deterministic rules engine.
 * No rendering, no DOM, no Date.now(): every transition derives from
 * (state, command) only. Usable from browser (window.SSRules) and Node.
 *
 * Core loop: move one visible object between the counter (staging) and
 * shelf openings; three identical items on one shelf row clear; cleared
 * items fill orders; deliveries keep arriving on the counter; you lose
 * only when a delivery cannot fit (staging fills).
 */
(function (root, factory) {
  var RNG = (typeof module === 'object' && module.exports) ? require('./rng.js') : root.SSRNG;
  var api = factory(RNG);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SSRules = api;
})(typeof self !== 'undefined' ? self : this, function (RNG) {
  'use strict';

  var STATE_VERSION = 1;
  var CLEAR_BASE = 100;      // points per triple
  var CLEAR_STREAK = 15;     // extra per current streak length
  var CAPACITY_PT = 25;      // win bonus per empty cell
  var ORDER_COMPLETE_PT = 250;
  var PAR_MOVE_PT = 20;      // win bonus per move under par
  var TIME_PT_PER_SEC = 5;   // challenge bonus per second under target

  var TERMINAL = {
    ORDERS: 'orders-complete',
    OVERFLOW: 'staging-overflow',
    MOVES: 'move-limit',
    TIME: 'time-up',
    RESIGN: 'resigned'
  };

  var INVALID = {
    EMPTY_SOURCE: 'empty-source',
    OCCUPIED: 'occupied-target',
    SAME_CELL: 'same-cell',
    ENDED: 'game-ended',
    BAD_CMD: 'unknown-command',
    BAD_LOC: 'bad-location',
    BAD_SHAPE: 'malformed-command',
    PHASE: 'wrong-phase'
  };

  // ---------- helpers ----------

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // Stable stringify: object keys sorted recursively → canonical hashing.
  function stableStringify(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) {
      var out = '[';
      for (var i = 0; i < v.length; i++) out += (i ? ',' : '') + stableStringify(v[i]);
      return out + ']';
    }
    var keys = Object.keys(v).sort(), s = '{';
    for (var k = 0; k < keys.length; k++) {
      s += (k ? ',' : '') + JSON.stringify(keys[k]) + ':' + stableStringify(v[keys[k]]);
    }
    return s + '}';
  }

  function hashState(state) {
    var copy = clone(state);
    delete copy.events;
    return RNG.hashString(stableStringify(copy));
  }

  function locEq(a, b) {
    if (!a || !b || a.area !== b.area) return false;
    if (a.area === 'counter') return a.i === b.i;
    return a.r === b.r && a.c === b.c;
  }

  function inBounds(cfg, loc) {
    if (!loc || typeof loc !== 'object') return false;
    if (loc.area === 'counter') return Number.isInteger(loc.i) && loc.i >= 0 && loc.i < cfg.board.counter;
    if (loc.area === 'shelf') {
      return Number.isInteger(loc.r) && Number.isInteger(loc.c) &&
        loc.r >= 0 && loc.r < cfg.board.shelves && loc.c >= 0 && loc.c < cfg.board.cols;
    }
    return false;
  }

  function getCell(state, loc) {
    return loc.area === 'counter' ? state.counter[loc.i] : state.shelves[loc.r][loc.c];
  }
  function setCell(state, loc, v) {
    if (loc.area === 'counter') state.counter[loc.i] = v; else state.shelves[loc.r][loc.c] = v;
  }

  function emptyCellCount(state) {
    var n = 0, r, c;
    for (r = 0; r < state.shelves.length; r++)
      for (c = 0; c < state.shelves[r].length; c++) if (!state.shelves[r][c]) n++;
    for (var i = 0; i < state.counter.length; i++) if (!state.counter[i]) n++;
    return n;
  }

  function ordersComplete(state) {
    var need = state.cfg.orders;
    for (var t in need) if ((state.orders[t] || 0) < need[t]) return false;
    return true;
  }

  // ---------- game creation ----------

  // cfg: { id, version, kind, seed, board:{shelves,cols,counter}, types:[],
  //        stock:{type:count}, orders:{type:count}, counterStart,
  //        delivery:{every,per} | null, moveLimit, timeLimitSec,
  //        par:{moves,timeSec}, mechanics:{undo,hint}, endless }
  function createGame(cfg) {
    var seed = cfg.seed >>> 0;
    var rng = RNG.derive(seed, RNG.STREAM_RULES);
    var shelves = [], r, c;
    for (r = 0; r < cfg.board.shelves; r++) {
      var row = [];
      for (c = 0; c < cfg.board.cols; c++) row.push(null);
      shelves.push(row);
    }
    var counter = [];
    for (var i = 0; i < cfg.board.counter; i++) counter.push(null);

    var state = {
      v: STATE_VERSION,
      cfg: clone(cfg),
      seed: seed,
      rngState: 0,
      tick: 0,
      shelves: shelves,
      counter: counter,
      orders: {},
      score: { clears: 0, clearPoints: 0, streakBest: 0, orderBonus: 0,
               capacityBonus: 0, moveBonus: 0, timeBonus: 0, rounds: 0, total: 0 },
      streak: 0,
      moves: 0,
      elapsedMs: 0,
      endlessRound: 1,
      terminal: null,
      events: []
    };
    for (var t in cfg.orders) state.orders[t] = 0;

    // Seeded initial placement: shuffle stock onto shelves, avoiding a
    // shelf row that already contains a triple.
    var pool = [];
    for (var ty in cfg.stock) for (var n = 0; n < cfg.stock[ty]; n++) pool.push(ty);
    var capacity = cfg.board.shelves * cfg.board.cols;
    if (pool.length > capacity) throw new Error('stock exceeds shelf capacity');
    var attempts = 0, placed = false;
    while (!placed && attempts < 64) {
      attempts++;
      var cells = [];
      for (r = 0; r < cfg.board.shelves; r++) for (c = 0; c < cfg.board.cols; c++) cells.push([r, c]);
      rng.shuffle(cells);
      var bag = pool.slice();
      rng.shuffle(bag);
      for (r = 0; r < cfg.board.shelves; r++) for (c = 0; c < cfg.board.cols; c++) shelves[r][c] = null;
      for (var k = 0; k < bag.length; k++) shelves[cells[k][0]][cells[k][1]] = bag[k];
      placed = true;
      for (r = 0; r < cfg.board.shelves && placed; r++) {
        var counts = {};
        for (c = 0; c < cfg.board.cols; c++) {
          var it = shelves[r][c];
          if (it) { counts[it] = (counts[it] || 0) + 1; if (counts[it] >= 3) placed = false; }
        }
      }
    }
    var start = Math.min(cfg.counterStart == null ? 3 : cfg.counterStart, cfg.board.counter);
    for (var s = 0; s < start; s++) counter[s] = drawDeliveryType(state, rng);

    state.rngState = rng.state;
    return state;
  }

  // Weighted delivery: order-needed types most likely, then types already
  // in play, then the rest. Fully driven by the rules stream.
  function drawDeliveryType(state, rng) {
    var weights = [], total = 0;
    var inPlay = {};
    state.shelves.forEach(function (row) {
      row.forEach(function (it) { if (it) inPlay[it] = true; });
    });
    state.counter.forEach(function (it) { if (it) inPlay[it] = true; });
    state.cfg.types.forEach(function (t) {
      var w = 1;
      if (inPlay[t]) w = 2;
      if (state.cfg.orders[t] != null && (state.orders[t] || 0) < state.cfg.orders[t]) w = 3;
      weights.push(w); total += w;
    });
    var roll = rng.next() * total;
    for (var i = 0; i < state.cfg.types.length; i++) {
      roll -= weights[i];
      if (roll < 0) return state.cfg.types[i];
    }
    return state.cfg.types[state.cfg.types.length - 1];
  }

  // ---------- legality ----------

  function checkMove(state, from, to) {
    if (state.terminal) return INVALID.ENDED;
    if (!inBounds(state.cfg, from) || !inBounds(state.cfg, to)) return INVALID.BAD_LOC;
    if (locEq(from, to)) return INVALID.SAME_CELL;
    if (!getCell(state, from)) return INVALID.EMPTY_SOURCE;
    if (getCell(state, to)) return INVALID.OCCUPIED;
    return null;
  }

  function legalMoves(state) {
    if (state.terminal) return [];
    var occupied = [], empty = [], r, c, i;
    for (r = 0; r < state.cfg.board.shelves; r++)
      for (c = 0; c < state.cfg.board.cols; c++) {
        var loc = { area: 'shelf', r: r, c: c };
        (state.shelves[r][c] ? occupied : empty).push(loc);
      }
    for (i = 0; i < state.cfg.board.counter; i++) {
      var cl = { area: 'counter', i: i };
      (state.counter[i] ? occupied : empty).push(cl);
    }
    var moves = [];
    for (var a = 0; a < occupied.length; a++)
      for (var b = 0; b < empty.length; b++)
        moves.push({ from: occupied[a], to: empty[b], item: getCell(state, occupied[a]) });
    return moves;
  }

  // ---------- resolution ----------

  function applyCommand(state, cmd) {
    if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') {
      return { ok: false, reason: INVALID.BAD_SHAPE, state: state, events: [] };
    }
    if (cmd.type === 'resign') {
      if (state.terminal) return { ok: false, reason: INVALID.ENDED, state: state, events: [] };
      var ns = clone(state);
      ns.tick++;
      ns.terminal = { reason: TERMINAL.RESIGN, won: false };
      ns.events = [{ type: 'lose', reason: TERMINAL.RESIGN }];
      finalizeScore(ns);
      return { ok: true, state: ns, events: ns.events };
    }
    if (cmd.type !== 'move') {
      return { ok: false, reason: INVALID.BAD_CMD, state: state, events: [] };
    }
    var reason = checkMove(state, cmd.from, cmd.to);
    if (reason) return { ok: false, reason: reason, state: state, events: [] };

    var s = clone(state);
    s.events = [];
    s.tick++;
    s.moves++;
    if (typeof cmd.atMs === 'number' && isFinite(cmd.atMs) && cmd.atMs >= 0) {
      s.elapsedMs = Math.floor(cmd.atMs / 100) * 100; // quantized, replay-safe
    }
    var rng = RNG.create(s.rngState);

    var item = getCell(s, cmd.from);
    setCell(s, cmd.from, null);
    setCell(s, cmd.to, item);
    s.events.push({ type: 'move', item: item, from: clone(cmd.from), to: clone(cmd.to) });

    // Triple resolution: any shelf row holding 3+ of a type clears three.
    var clearedThisMove = 0;
    for (var r = 0; r < s.shelves.length; r++) {
      var byType = {};
      for (var c = 0; c < s.shelves[r].length; c++) {
        var it = s.shelves[r][c];
        if (it) (byType[it] = byType[it] || []).push(c);
      }
      for (var t in byType) {
        if (byType[t].length >= 3) {
          var cells = byType[t].slice(0, 3);
          cells.forEach(function (cc) { s.shelves[r][cc] = null; });
          clearedThisMove++;
          s.streak++;
          s.score.streakBest = Math.max(s.score.streakBest, s.streak);
          var pts = CLEAR_BASE + CLEAR_STREAK * (s.streak - 1);
          s.score.clearPoints += pts;
          s.score.clears++;
          var need = s.cfg.orders[t];
          var have = s.orders[t] || 0;
          if (need != null) s.orders[t] = have + 3; // overstock still scores via clears
          s.events.push({ type: 'clear', item: t, shelf: r, cells: cells, points: pts, streak: s.streak });
          if (need != null && have < need && s.orders[t] >= need) {
            s.score.orderBonus += ORDER_COMPLETE_PT;
            s.events.push({ type: 'order-complete', item: t });
          }
        }
      }
    }
    if (!clearedThisMove) s.streak = 0;

    // Terminal: victory first, then limits.
    if (ordersComplete(s)) {
      if (s.cfg.endless) {
        s.score.rounds++;
        s.score.capacityBonus += CAPACITY_PT * emptyCellCount(s);
        s.endlessRound++;
        s.events.push({ type: 'round', round: s.endlessRound });
        // Fresh, seeded order wave for the next round.
        var types = s.cfg.types;
        var nOrders = Math.min(types.length, 2 + Math.floor(rng.next() * 2));
        var shuffled = types.slice(); rng.shuffle(shuffled);
        // The wave replaces the previous one: clearing the requirement table
        // as well as the tallies. Leaving stale requirements behind would make
        // every finished wave permanently re-required at its old count.
        s.orders = {};
        s.cfg.orders = {};
        for (var oi = 0; oi < nOrders; oi++) {
          var ot = shuffled[oi];
          s.orders[ot] = 0;
          s.cfg.orders[ot] = 3 * (1 + Math.floor(s.endlessRound / 2));
        }
        s.events.push({ type: 'orders-new', orders: clone(s.cfg.orders) });
      } else {
        s.terminal = { reason: TERMINAL.ORDERS, won: true };
        s.score.capacityBonus = CAPACITY_PT * emptyCellCount(s);
        if (s.cfg.par && s.cfg.par.moves && s.moves < s.cfg.par.moves) {
          s.score.moveBonus = (s.cfg.par.moves - s.moves) * PAR_MOVE_PT;
        }
        if (s.cfg.par && s.cfg.par.timeSec && s.elapsedMs > 0 && s.elapsedMs < s.cfg.par.timeSec * 1000) {
          s.score.timeBonus = Math.floor((s.cfg.par.timeSec * 1000 - s.elapsedMs) / 1000) * TIME_PT_PER_SEC;
        }
        s.events.push({ type: 'win', reason: TERMINAL.ORDERS });
      }
    }
    if (!s.terminal && s.cfg.moveLimit && s.moves >= s.cfg.moveLimit) {
      s.terminal = { reason: TERMINAL.MOVES, won: false };
      s.events.push({ type: 'lose', reason: TERMINAL.MOVES });
    }
    if (!s.terminal && s.cfg.timeLimitSec && s.elapsedMs >= s.cfg.timeLimitSec * 1000) {
      s.terminal = { reason: TERMINAL.TIME, won: false };
      s.events.push({ type: 'lose', reason: TERMINAL.TIME });
    }

    // Deliveries: staging pressure.
    if (!s.terminal && s.cfg.delivery && s.tick % s.cfg.delivery.every === 0) {
      var want = s.cfg.delivery.per;
      var slots = [];
      for (var ci = 0; ci < s.counter.length; ci++) if (!s.counter[ci]) slots.push(ci);
      var fit = Math.min(want, slots.length);
      for (var d = 0; d < fit; d++) {
        var dt = drawDeliveryType(s, rng);
        s.counter[slots[d]] = dt;
        s.events.push({ type: 'delivery', item: dt, cell: slots[d] });
      }
      // Lose only when the staging cells are full: a delivery that finds
      // no opening at all. Partial deliveries still place what fits.
      if (fit === 0) {
        s.terminal = { reason: TERMINAL.OVERFLOW, won: false };
        s.events.push({ type: 'lose', reason: TERMINAL.OVERFLOW });
      }
    }

    // No-openings guard: with zero empty cells anywhere, staging has
    // effectively failed. This also proves the absence of soft locks —
    // every non-terminal state with stock always has a legal move.
    if (!s.terminal && emptyCellCount(s) === 0) {
      s.terminal = { reason: TERMINAL.OVERFLOW, won: false };
      s.events.push({ type: 'lose', reason: TERMINAL.OVERFLOW });
    }

    // Empty-board guard: a clear may remove the last items in play (e.g.
    // in endless mode). Restock the counter deterministically so the
    // round can never deadlock with zero movable objects.
    if (!s.terminal) {
      var occupied = 0;
      for (var or = 0; or < s.shelves.length; or++)
        for (var oc = 0; oc < s.shelves[or].length; oc++) if (s.shelves[or][oc]) occupied++;
      for (var oi = 0; oi < s.counter.length; oi++) if (s.counter[oi]) occupied++;
      if (occupied === 0) {
        var restock = Math.min((s.cfg.delivery && s.cfg.delivery.per) || 2, s.counter.length);
        for (var ri = 0; ri < restock; ri++) {
          var rt = drawDeliveryType(s, rng);
          s.counter[ri] = rt;
          s.events.push({ type: 'delivery', item: rt, cell: ri, restock: true });
        }
      }
    }

    s.rngState = rng.state;
    if (s.terminal) finalizeScore(s);
    return { ok: true, state: s, events: s.events };
  }

  function finalizeScore(s) {
    s.score.total = s.score.clearPoints + s.score.orderBonus + s.score.capacityBonus +
      s.score.moveBonus + s.score.timeBonus;
  }

  // ---------- hints (same legality surface as play) ----------

  function hint(state) {
    var moves = legalMoves(state);
    if (!moves.length) return null;
    var r, c;
    // Count types per shelf row.
    var rowCounts = state.shelves.map(function (row) {
      var m = {};
      row.forEach(function (it) { if (it) m[it] = (m[it] || 0) + 1; });
      return m;
    });
    var rowEmpty = state.shelves.map(function (row) {
      return row.filter(function (x) { return !x; }).length;
    });
    function rowOf(loc) { return loc.area === 'shelf' ? loc.r : -1; }
    // 1) a move that completes a triple.
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i], tr = rowOf(m.to);
      if (tr >= 0 && rowOf(m.from) !== tr && (rowCounts[tr][m.item] || 0) === 2) {
        return { from: m.from, to: m.to, item: m.item, why: 'complete-triple' };
      }
    }
    // 2) a move that pairs two of a kind on one shelf.
    for (i = 0; i < moves.length; i++) {
      m = moves[i]; tr = rowOf(m.to);
      if (tr >= 0 && rowOf(m.from) !== tr && (rowCounts[tr][m.item] || 0) === 1) {
        return { from: m.from, to: m.to, item: m.item, why: 'build-pair' };
      }
    }
    // 3) relieve the counter if it is nearly full.
    var counterFilled = state.counter.filter(function (x) { return !!x; }).length;
    if (counterFilled >= state.counter.length - 1) {
      for (i = 0; i < moves.length; i++) {
        if (moves[i].from.area === 'counter' && moves[i].to.area === 'shelf') {
          return { from: moves[i].from, to: moves[i].to, item: moves[i].item, why: 'clear-counter' };
        }
      }
    }
    return { from: moves[0].from, to: moves[0].to, item: moves[0].item, why: 'any' };
  }

  // ---------- validation (network / replay boundary) ----------

  function validateCommandShape(cmd, maxLen) {
    if (!cmd || typeof cmd !== 'object') return INVALID.BAD_SHAPE;
    if (JSON.stringify(cmd).length > (maxLen || 512)) return INVALID.BAD_SHAPE;
    if (cmd.type !== 'move' && cmd.type !== 'resign') return INVALID.BAD_CMD;
    if (cmd.id != null && (typeof cmd.id !== 'string' || cmd.id.length > 64)) return INVALID.BAD_SHAPE;
    if (cmd.type === 'move') {
      if (!cmd.from || !cmd.to) return INVALID.BAD_SHAPE;
      if (typeof cmd.from !== 'object' || typeof cmd.to !== 'object') return INVALID.BAD_SHAPE;
    }
    return null;
  }

  // ---------- serialization ----------

  function serialize(state) { return JSON.stringify(state); }
  function deserialize(json) {
    var s = JSON.parse(json);
    if (s.v !== STATE_VERSION) throw new Error('unsupported state version ' + s.v);
    return s;
  }

  return {
    STATE_VERSION: STATE_VERSION,
    TERMINAL: TERMINAL,
    INVALID: INVALID,
    createGame: createGame,
    applyCommand: applyCommand,
    checkMove: checkMove,
    legalMoves: legalMoves,
    hint: hint,
    ordersComplete: ordersComplete,
    emptyCellCount: emptyCellCount,
    getCell: getCell,
    locEq: locEq,
    inBounds: inBounds,
    hashState: hashState,
    stableStringify: stableStringify,
    serialize: serialize,
    deserialize: deserialize,
    clone: clone,
    validateCommandShape: validateCommandShape
  };
});
