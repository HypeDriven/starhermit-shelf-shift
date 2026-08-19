/* Shelf Shift — versioned content: items, themes, journey, challenges,
 * tutorial lessons, practice presets, daily ruleset generator.
 * Shared browser (window.SSContent) / Node. Content is data-only; all
 * randomness enters through the config seed.
 */
(function (root, factory) {
  var RNG = (typeof module === 'object' && module.exports) ? require('./rng.js') : root.SSRNG;
  var api = factory(RNG);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SSContent = api;
})(typeof self !== 'undefined' ? self : this, function (RNG) {
  'use strict';

  var CONTENT_VERSION = 1;

  // ---------- items ----------
  // Shape + icon + label reinforce color (color is never the only cue).
  var ITEM_ORDER = ['teapot', 'candle', 'book', 'plant', 'vase', 'clock', 'mug', 'lantern'];
  var ITEMS = {
    teapot:  { label: 'Teapot',  icon: '\u{1FAD6}', color: 0xd96f4e, colorHC: 0xe4572e, shape: 'pot' },
    candle:  { label: 'Candle',  icon: '\u{1F56F}', color: 0xe8c46a, colorHC: 0xf5d90a, shape: 'pillar' },
    book:    { label: 'Book',    icon: '\u{1F4D8}', color: 0x5b7fb8, colorHC: 0x2e6fe4, shape: 'box' },
    plant:   { label: 'Plant',   icon: '\u{1FAB4}', color: 0x5d9c59, colorHC: 0x17a398, shape: 'sprout' },
    vase:    { label: 'Vase',    icon: '\u{1F3FA}', color: 0x8e6fc0, colorHC: 0x8e24aa, shape: 'lathe' },
    clock:   { label: 'Clock',   icon: '\u{1F570}', color: 0xc9a05a, colorHC: 0xb7791f, shape: 'disc' },
    mug:     { label: 'Mug',     icon: '\u2615',    color: 0xb85450, colorHC: 0xc62828, shape: 'cup' },
    lantern: { label: 'Lantern', icon: '\u{1F3EE}', color: 0xe0873d, colorHC: 0xef6c00, shape: 'cage' }
  };

  // ---------- themes (cosmetic only: materials, light, ambience) ----------
  var THEMES = [
    { id: 'ember',    name: 'Ember Glow',   unlockStars: 0,
      palette: { wall: 0x3a2a24, floor: 0x4a352a, wood: 0x8a5a34, woodDark: 0x5d3a20, counter: 0x6e4526,
                 light: 0xffc98a, accent: 0xffb066, metal: 0xa08050, fog: 0x2a1d18 } },
    { id: 'verdant',  name: 'Verdant Shop', unlockStars: 12,
      palette: { wall: 0x24332a, floor: 0x31453a, wood: 0x7a6a3a, woodDark: 0x4f4526, counter: 0x5d5230,
                 light: 0xd8ffb0, accent: 0x9fe080, metal: 0x90a060, fog: 0x1c2620 } },
    { id: 'nocturne', name: 'Nocturne',     unlockStars: 30,
      palette: { wall: 0x232838, floor: 0x2e3648, wood: 0x6a5a48, woodDark: 0x453a2e, counter: 0x54483a,
                 light: 0x9fc8ff, accent: 0x7fb0ff, metal: 0x8090b0, fog: 0x181c28 } },
    { id: 'rose',     name: 'Rose Atelier', unlockStars: 55,
      palette: { wall: 0x3a2830, floor: 0x4a3440, wood: 0x8a5a44, woodDark: 0x5d3a2c, counter: 0x6e4638,
                 light: 0xffc0d0, accent: 0xff90b0, metal: 0xb08878, fog: 0x281c22 } },
    { id: 'ivory',    name: 'Ivory Hall',   unlockStars: 85,
      palette: { wall: 0x8a8078, floor: 0x9a8f85, wood: 0xa07850, woodDark: 0x6e5238, counter: 0x8a6a4a,
                 light: 0xfff2dd, accent: 0xffd9a0, metal: 0xb0a080, fog: 0x6a6058 } }
  ];

  // ---------- journey ----------
  // Compact authored rows:
  // [id, name, seed, [shelves,cols,counter], nTypes, stockPerType[], ordersPerType[],
  //  counterStart, [delEvery,delPer], moveLimit, timeLimitSec, parMoves, parTimeSec, themeIdx, intro]
  var J = [
    ['j01','First Shelf',      101,[3,3,5],3,[2,2,2],      [3,3,3],          2,[3,1], 0,  0, 14,120,0,'Move an object from the counter to a shelf. Three of a kind on one shelf clear.'],
    ['j02','Window Display',   102,[3,3,5],3,[3,2,2],      [3,3,3],          2,[3,1], 0,  0, 13,110,0,''],
    ['j03','Morning Rush',     103,[3,3,5],3,[2,2,2],      [3,3,3],          3,[2,1], 0,  0, 14,100,0,'Deliveries arrive faster now — keep the counter clear.'],
    ['j04','Greenery Arrives', 104,[3,4,5],4,[2,2,2,2],    [3,3,3,3],        2,[3,1], 0,  0, 18,140,0,'A new object: the Plant. More kinds mean more planning.'],
    ['j05','Steady Hands',     105,[3,4,4],4,[2,2,2,2],    [3,3,3,3],        2,[2,1], 0,  0, 18,130,0,''],
    ['j06','Tidy Rows',        106,[3,4,5],4,[2,2,2,2],    [3,3,3,3],        2,[3,1], 0,  0, 16,120,0,''],
    ['j07','First Big Order',  107,[3,4,5],4,[3,3,2,2],    [6,3,3,3],        2,[2,1], 0,  0, 24,160,0,'Some orders need two triples of the same kind.'],
    ['j08','Move Budget',      108,[3,4,5],4,[3,3,3,3],    [3,3,3,3],        2,[3,1],26,  0, 18,150,0,'New: a move limit. Every relocation must count.'],
    ['j09','Vase Collection',  109,[3,4,5],5,[2,2,2,2,1],  [3,3,3,3,3],      2,[3,1], 0,  0, 22,170,0,'A new object: the Vase.'],
    ['j10','Corner Shop',      110,[3,4,4],5,[2,2,2,2,2],  [3,3,3,3,3],      2,[2,1],30,  0, 22,150,1,'MASTERY: small counter, steady deliveries, limited moves.'],
    ['j11','Busy Morning',     111,[3,4,5],5,[2,2,2,2,2],  [3,3,3,6,3],      3,[2,1], 0,  0, 34,170,1,''],
    ['j12','Narrow Counter',   112,[3,4,4],5,[2,2,2,2,2],  [3,3,3,3,3],      3,[2,1], 0,  0, 22,150,1,''],
    ['j13','Double Delivery',  113,[3,4,6],5,[2,2,2,2,2],  [3,3,3,3,3],      2,[3,2], 0,  0, 24,170,1,'Two objects arrive at once. Shelve them promptly.'],
    ['j14','Clockwork',        114,[3,4,5],6,[2,2,2,2,1,1],[3,3,3,3,3,3],    2,[3,1], 0,  0, 30,190,1,'A new object: the Clock.'],
    ['j15','Against the Clock',115,[3,4,5],5,[2,2,2,2,2],  [3,3,3,3,3],      2,[3,1], 0,150, 22,140,2,'New: a time limit. Work briskly.'],
    ['j16','Back Room',        116,[4,4,5],6,[2,2,2,2,2,2],[3,3,3,3,3,3],    2,[3,1], 0,  0, 30,180,2,'A fourth shelf — more room, more clutter.'],
    ['j17','Heavy Footfall',   117,[4,4,4],6,[2,2,2,2,2,2],[3,3,3,3,3,3],    3,[2,1], 0,  0, 26,180,2,''],
    ['j18','Bulk Order',       118,[4,4,5],6,[2,2,2,2,2,2],[6,6,3,3,3,3],    2,[2,1], 0,  0, 34,220,2,''],
    ['j19','Mugs & More',      119,[4,4,5],7,[2,2,2,2,2,2,2],[3,3,3,3,3,3,3],2,[3,1], 0,  0, 32,220,2,'A new object: the Mug.'],
    ['j20','Grand Opening',    120,[4,4,5],7,[2,2,2,2,2,2,2],[3,3,3,3,3,3,3],2,[2,1],44,240,32,220,3,'MASTERY: everything so far, at once.'],
    ['j21','Evening Shift',    121,[4,4,4],7,[2,2,2,2,2,2,2],[3,3,3,3,3,3,3],3,[2,1], 0,  0, 30,220,3,''],
    ['j22','Tight Budget',     122,[4,4,5],7,[3,2,2,2,2,2,1],[6,3,3,3,3,3,3],2,[2,1],38,  0, 34,220,3,''],
    ['j23','Rush Hour',        123,[4,4,6],7,[2,2,2,2,2,2,2],[3,3,3,3,3,3,3],2,[1,1], 0,  0, 30,200,3,'A delivery after every single move.'],
    ['j24','Lantern Light',    124,[4,4,5],8,[2,2,2,2,2,2,1,1],[3,3,3,3,3,3,3,3],2,[3,1],0,0,34,240,3,'A new object: the Lantern. The full collection.'],
    ['j25','Full House',       125,[4,4,4],8,[2,2,2,2,2,2,1,1],[3,3,3,3,3,3,3,3],3,[2,1],0,0,34,240,4,''],
    ['j26','Express Lane',     126,[4,4,5],8,[2,2,2,2,2,2,1,1],[3,3,3,3,3,3,3,3],2,[3,2],0,0,34,240,4,''],
    ['j27','Precision Work',   127,[4,4,5],8,[2,2,2,2,2,1,1,1],[6,6,3,3,3,3,3,3],2,[2,1],50,0,40,280,4,''],
    ['j28','Closing Time',     128,[4,4,5],8,[2,2,2,2,2,2,2,1],[3,3,3,3,3,3,3,3],2,[3,1],0,0,36,240,4,'Shelves start nearly full. Make room before the counter backs up.'],
    ['j29','The Long Night',   129,[4,4,5],8,[2,2,2,2,2,2,1,0],[6,6,6,3,3,3,3,3],2,[2,1],0,0,48,300,4,''],
    ['j30','Flagship',         130,[4,4,4],8,[2,2,2,2,2,2,1,0],[3,3,3,3,3,3,3,3],3,[3,2],50,280,36,260,0,'MASTERY: double deliveries, tight counter, clock running.'],
    ['j31','Storm Deliveries', 131,[4,4,4],8,[2,2,2,2,2,2,1,1],[3,3,3,3,3,3,3,3],2,[2,1],0,0,36,260,0,'A small counter and a delivery every other move.'],
    ['j32','Minimalist',       132,[4,4,6],8,[2,2,2,2,2,2,2,2],[3,3,3,3,3,3,3,3],2,[3,1],36,0,30,240,0,''],
    ['j33','Speedrun Shelf',   133,[3,4,5],7,[2,2,2,2,1,1,0],[6,6,3,3,3,3,3],2,[2,1],0,180,34,170,0,''],
    ['j34','Collector\u2019s Edition',134,[4,4,5],8,[2,2,2,2,2,2,1,1],[6,6,6,3,3,3,3,3],2,[2,1],0,0,46,320,2,''],
    ['j35','One Counter Lane', 135,[4,4,3],8,[2,2,2,2,2,2,1,1],[3,3,3,3,3,3,3,3],1,[3,1],0,0,36,260,2,'Only three staging cells.'],
    ['j36','Grand Parade',     136,[4,4,4],8,[3,2,2,2,2,2,1,0],[6,3,3,3,3,3,3,3],2,[3,2],0,0,42,300,2,''],
    ['j37','No Vacancy',       137,[4,4,5],8,[2,2,2,2,2,2,2,2],[3,3,3,3,3,3,3,3],3,[3,1],0,0,34,260,2,''],
    ['j38','Master Budget',    138,[4,4,5],8,[2,2,2,2,2,1,1,0],[3,3,3,3,3,3,3],  2,[3,1],76,300,48,290,2,''],
    ['j39','Boutique Blitz',   139,[4,4,5],8,[2,2,2,2,2,2,1,1],[3,3,3,3,3,3,3,3],2,[2,1],0,240,36,230,3,''],
    ['j40','Star Boutique',    140,[4,4,4],8,[3,2,2,2,2,2,1,0],[6,6,3,3,3,3,3,3],3,[3,2],52,320,44,300,4,'MASTERY: the definitive shift. Good luck.']
  ];

  function expandLevel(row, idx) {
    var types = ITEM_ORDER.slice(0, row[4]);
    var stock = {}, orders = {};
    row[5].forEach(function (n, i) { stock[types[i]] = n; });
    row[6].forEach(function (n, i) { orders[types[i]] = n; });
    return {
      id: row[0], version: CONTENT_VERSION, kind: 'journey', index: idx,
      name: row[1], seed: row[2],
      board: { shelves: row[3][0], cols: row[3][1], counter: row[3][2] },
      types: types, stock: stock, orders: orders,
      counterStart: row[7],
      delivery: { every: row[8][0], per: row[8][1] },
      moveLimit: row[9] || 0, timeLimitSec: row[10] || 0,
      par: { moves: row[11], timeSec: row[12] },
      mechanics: { undo: true, hint: true },
      endless: false,
      theme: THEMES[row[13]].id,
      intro: row[14] || '',
      mastery: /MASTERY/.test(row[14] || '')
    };
  }

  var JOURNEY = J.map(expandLevel);

  // ---------- challenges ----------
  var CHALLENGES = [
    { id: 'c1', name: 'Tidy Sprint',      seed: 501, kind: 'challenge',
      board: { shelves: 3, cols: 4, counter: 5 }, types: ITEM_ORDER.slice(0, 4),
      stock: { teapot: 2, candle: 2, book: 2, plant: 2 }, orders: { teapot: 3, candle: 3, book: 3, plant: 3 },
      counterStart: 2, delivery: { every: 2, per: 1 }, moveLimit: 0, timeLimitSec: 100,
      par: { moves: 18, timeSec: 90 }, mechanics: { undo: false, hint: true }, endless: false, theme: 'ember',
      intro: 'Clear every order in 100 seconds. No undo.' },
    { id: 'c2', name: 'Minimal Moves',    seed: 502, kind: 'challenge',
      board: { shelves: 3, cols: 4, counter: 6 }, types: ITEM_ORDER.slice(0, 4),
      stock: { teapot: 3, candle: 3, book: 2, plant: 2 }, orders: { teapot: 3, candle: 3, book: 3, plant: 3 },
      counterStart: 2, delivery: { every: 3, per: 1 }, moveLimit: 16, timeLimitSec: 0,
      par: { moves: 13, timeSec: 120 }, mechanics: { undo: false, hint: true }, endless: false, theme: 'verdant',
      intro: 'Only 16 moves. Waste nothing.' },
    { id: 'c3', name: 'Narrow Counter',   seed: 503, kind: 'challenge',
      board: { shelves: 4, cols: 4, counter: 3 }, types: ITEM_ORDER.slice(0, 5),
      stock: { teapot: 2, candle: 2, book: 2, plant: 2, vase: 2 }, orders: { teapot: 3, candle: 3, book: 3, plant: 3, vase: 3 },
      counterStart: 1, delivery: { every: 2, per: 1 }, moveLimit: 0, timeLimitSec: 0,
      par: { moves: 24, timeSec: 200 }, mechanics: { undo: true, hint: true }, endless: false, theme: 'nocturne',
      intro: 'Three staging cells. Every delivery is urgent.' },
    { id: 'c4', name: 'Full Collection',  seed: 504, kind: 'challenge',
      board: { shelves: 4, cols: 4, counter: 4 }, types: ITEM_ORDER.slice(0, 8),
      stock: { teapot: 2, candle: 2, book: 2, plant: 2, vase: 2, clock: 1, mug: 1, lantern: 1 },
      orders: { teapot: 3, candle: 3, book: 3, plant: 3, vase: 3, clock: 3, mug: 3, lantern: 3 },
      counterStart: 2, delivery: { every: 2, per: 1 }, moveLimit: 0, timeLimitSec: 0,
      par: { moves: 36, timeSec: 280 }, mechanics: { undo: true, hint: true }, endless: false, theme: 'rose',
      intro: 'All eight kinds on four shelves.' },
    { id: 'c5', name: 'Rush Delivery',    seed: 505, kind: 'challenge',
      board: { shelves: 4, cols: 4, counter: 5 }, types: ITEM_ORDER.slice(0, 6),
      stock: { teapot: 2, candle: 2, book: 2, plant: 2, vase: 2, clock: 2 },
      orders: { teapot: 3, candle: 3, book: 3, plant: 3, vase: 3, clock: 3 },
      counterStart: 2, delivery: { every: 2, per: 2 }, moveLimit: 0, timeLimitSec: 0,
      par: { moves: 30, timeSec: 240 }, mechanics: { undo: false, hint: true }, endless: false, theme: 'ivory',
      intro: 'Two new objects every other move. No undo.' },
    { id: 'c6', name: 'Grand Constraint', seed: 506, kind: 'challenge',
      board: { shelves: 4, cols: 4, counter: 5 }, types: ITEM_ORDER.slice(0, 7),
      stock: { teapot: 3, candle: 3, book: 2, plant: 2, vase: 2, mug: 2, clock: 2 },
      orders: { teapot: 6, candle: 3, book: 3, plant: 3, vase: 3, mug: 3, clock: 3 },
      counterStart: 2, delivery: { every: 3, per: 2 }, moveLimit: 42, timeLimitSec: 260,
      par: { moves: 34, timeSec: 240 }, mechanics: { undo: false, hint: false }, endless: false, theme: 'nocturne',
      intro: 'Move limit, time limit, no assists. The full test.' }
  ].map(function (c) { c.version = CONTENT_VERSION; return c; });

  // ---------- practice presets ----------
  var PRACTICE = [
    { id: 'casual', name: 'Casual',
      board: { shelves: 3, cols: 3, counter: 6 }, types: ITEM_ORDER.slice(0, 3),
      stock: { teapot: 2, candle: 2, book: 2 }, orders: { teapot: 3, candle: 3, book: 3 },
      counterStart: 2, delivery: { every: 4, per: 1 }, moveLimit: 0, timeLimitSec: 0,
      par: { moves: 14, timeSec: 150 }, mechanics: { undo: true, hint: true }, endless: false },
    { id: 'apprentice', name: 'Apprentice',
      board: { shelves: 3, cols: 4, counter: 5 }, types: ITEM_ORDER.slice(0, 5),
      stock: { teapot: 2, candle: 2, book: 2, plant: 2, vase: 2 },
      orders: { teapot: 3, candle: 3, book: 3, plant: 3, vase: 3 },
      counterStart: 2, delivery: { every: 2, per: 1 }, moveLimit: 0, timeLimitSec: 0,
      par: { moves: 22, timeSec: 180 }, mechanics: { undo: true, hint: true }, endless: false },
    { id: 'expert', name: 'Expert',
      board: { shelves: 4, cols: 4, counter: 5 }, types: ITEM_ORDER.slice(0, 7),
      stock: { teapot: 2, candle: 2, book: 2, plant: 2, vase: 2, clock: 2, mug: 2 },
      orders: { teapot: 6, candle: 3, book: 3, plant: 3, vase: 3, clock: 3, mug: 3 },
      counterStart: 2, delivery: { every: 2, per: 1 }, moveLimit: 0, timeLimitSec: 0,
      par: { moves: 32, timeSec: 240 }, mechanics: { undo: true, hint: true }, endless: false }
  ].map(function (p) { p.version = CONTENT_VERSION; p.kind = 'practice'; return p; });

  // ---------- score chase ruleset (endless) ----------
  var SCORE_CHASE = {
    id: 'score-std', version: CONTENT_VERSION, kind: 'score', name: 'Endless Counter',
    board: { shelves: 4, cols: 4, counter: 5 }, types: ITEM_ORDER.slice(0, 6),
    stock: { teapot: 2, candle: 2, book: 2, plant: 2, vase: 2, clock: 2 },
    orders: { teapot: 3, candle: 3, book: 3, plant: 3 },
    counterStart: 3, delivery: { every: 2, per: 1 }, moveLimit: 0, timeLimitSec: 0,
    par: null, mechanics: { undo: false, hint: false }, endless: true, theme: 'ember',
    intro: 'Orders never stop. Play until the counter overflows.'
  };

  // ---------- daily ----------
  // One immutable ruleset per UTC day, derived purely from the date string.
  function dailyConfig(dateStr, serverNowMs) {
    var seed = RNG.hashString('shelfshift-daily-v' + CONTENT_VERSION + '-' + dateStr);
    var day = Math.floor(Date.parse(dateStr + 'T00:00:00Z') / 86400000);
    var rot = ((day % 7) + 7) % 7;
    var nTypes = 4 + (rot % 4); // 4..7
    var types = ITEM_ORDER.slice(0, nTypes);
    var stock = {}, orders = {};
    types.forEach(function (t, i) {
      stock[t] = 2;
      orders[t] = 3 * (1 + ((rot + i) % 2));
    });
    var per = rot >= 4 ? 2 : 1;
    return {
      id: 'daily-' + dateStr, version: CONTENT_VERSION, kind: 'daily',
      name: 'Daily ' + dateStr, seed: seed, date: dateStr,
      board: { shelves: 4, cols: 4, counter: 4 + (rot % 2) },
      types: types, stock: stock, orders: orders,
      counterStart: 2, delivery: { every: per === 2 ? 3 : 2, per: per },
      moveLimit: 0, timeLimitSec: rot === 6 ? 240 : 0,
      par: { moves: 20 + nTypes * 2, timeSec: 200 },
      mechanics: { undo: true, hint: true }, endless: false,
      theme: THEMES[rot % THEMES.length].id,
      intro: 'One shared seed for everyone, today only.'
    };
  }

  function utcDateString(nowMs) {
    var d = new Date(nowMs == null ? Date.now() : nowMs);
    return d.getUTCFullYear() + '-' +
      String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(d.getUTCDate()).padStart(2, '0');
  }

  // ---------- tutorial (Learn) ----------
  function tutorialLessons() {
    return [
      { id: 't1', title: 'Move an object',
        text: 'Objects arrive on the counter at the front. Move the teapot from the counter onto any empty shelf opening: tap it (or press Enter), then tap a glowing shelf cell.',
        goal: { event: 'move', count: 1 },
        cfg: { id: 't1', version: CONTENT_VERSION, kind: 'tutorial', seed: 9001,
          board: { shelves: 2, cols: 3, counter: 3 }, types: ['teapot'],
          stock: {}, orders: { teapot: 99 }, counterStart: 1, delivery: null,
          moveLimit: 0, timeLimitSec: 0, par: null, mechanics: { undo: false, hint: false }, endless: false } },
      { id: 't2', title: 'Form a triple',
        text: 'Three identical objects on the same shelf row clear away. Two teapots already sit on the top shelf — bring the third one up to clear them.',
        goal: { event: 'clear', count: 1 },
        cfg: { id: 't2', version: CONTENT_VERSION, kind: 'tutorial', seed: 9002,
          board: { shelves: 2, cols: 3, counter: 3 }, types: ['teapot'],
          stock: { teapot: 2 }, orders: { teapot: 3 }, counterStart: 1, delivery: null,
          moveLimit: 0, timeLimitSec: 0, par: null, mechanics: { undo: false, hint: true }, endless: false },
        force: { counter0: 'teapot' } },
      { id: 't3', title: 'Fill an order',
        text: 'The order list (left) asks for specific objects. Cleared triples fill it. Finish this order of teapots and candles to complete the stage.',
        goal: { event: 'win', count: 1 },
        cfg: { id: 't3', version: CONTENT_VERSION, kind: 'tutorial', seed: 9003,
          board: { shelves: 2, cols: 3, counter: 3 }, types: ['teapot', 'candle'],
          stock: { teapot: 2, candle: 2 }, orders: { teapot: 3, candle: 3 }, counterStart: 2, delivery: null,
          moveLimit: 0, timeLimitSec: 0, par: null, mechanics: { undo: false, hint: true }, endless: false },
        force: { counterTypes: ['teapot', 'candle'] } },
      { id: 't4', title: 'Mind the counter',
        text: 'Deliveries keep arriving. If a delivery cannot fit on the counter, the shop overflows and the round is lost. Clear two triples before that happens.',
        goal: { event: 'clear', count: 2 },
        cfg: { id: 't4', version: CONTENT_VERSION, kind: 'tutorial', seed: 9004,
          board: { shelves: 2, cols: 3, counter: 3 }, types: ['teapot', 'candle'],
          stock: { teapot: 2, candle: 2 }, orders: { teapot: 9, candle: 9 }, counterStart: 1, delivery: { every: 2, per: 1 },
          moveLimit: 0, timeLimitSec: 0, par: null, mechanics: { undo: false, hint: true }, endless: false } },
      { id: 't5', title: 'Second chances',
        text: 'In relaxed modes you can undo a move (U) or ask for a hint (H). Make any move, then undo it to finish the lesson.',
        goal: { event: 'undo', count: 1 },
        cfg: { id: 't5', version: CONTENT_VERSION, kind: 'tutorial', seed: 9005,
          board: { shelves: 2, cols: 3, counter: 3 }, types: ['teapot', 'candle'],
          stock: { teapot: 1, candle: 1 }, orders: { teapot: 9, candle: 9 }, counterStart: 2, delivery: null,
          moveLimit: 0, timeLimitSec: 0, par: null, mechanics: { undo: true, hint: true }, endless: false } }
    ];
  }

  // ---------- achievements (stable lowercase keys, idempotent) ----------
  var ACHIEVEMENTS = [
    { key: 'first-clear',    name: 'First Triple',     desc: 'Clear your first triple.' },
    { key: 'first-win',      name: 'Order Up',         desc: 'Complete all orders in a stage.' },
    { key: 'streak-5',       name: 'On a Roll',        desc: 'Reach a 5-clear streak.' },
    { key: 'clears-100',     name: 'Shelf Veteran',    desc: 'Clear 100 triples in total.' },
    { key: 'journey-half',   name: 'Half the Journey', desc: 'Finish 20 journey stages.' },
    { key: 'journey-done',   name: 'Star Curator',     desc: 'Finish all 40 journey stages.' },
    { key: 'daily-7',        name: 'Regular',          desc: 'Finish 7 daily challenges.' },
    { key: 'score-2000',     name: 'High Shelf',       desc: 'Score 2000+ in a single round.' },
    { key: 'items-500',      name: 'Curator',          desc: 'Clear 500 objects across all play.' }
  ];

  return {
    CONTENT_VERSION: CONTENT_VERSION,
    ITEMS: ITEMS,
    ITEM_ORDER: ITEM_ORDER,
    THEMES: THEMES,
    JOURNEY: JOURNEY,
    CHALLENGES: CHALLENGES,
    PRACTICE: PRACTICE,
    SCORE_CHASE: SCORE_CHASE,
    ACHIEVEMENTS: ACHIEVEMENTS,
    dailyConfig: dailyConfig,
    utcDateString: utcDateString,
    tutorialLessons: tutorialLessons
  };
});
