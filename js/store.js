/* Shelf Shift — persistence: versioned, checksummed local save document.
 * Never stores credentials or tokens. Browser global: window.SSStore.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SSStore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SAVE_VERSION = 1;
  var KEY = 'shelfshift.save.v1';
  var LB_KEY = 'shelfshift.leaderboards.v1';

  var DEFAULT_SETTINGS = {
    music: 0.6, effects: 0.9, ambience: 0.5, voice: 0.8,
    muted: false, captions: false,
    // Graphics (see js/gfx.js): preset auto|low|balanced|high|ultra, render
    // scale, adaptive resolution, fps readout, plus optional per-category
    // overrides (<category>: tier; absent = from preset).
    gfx: { preset: 'auto', render_scale: 1, adaptive: true, show_fps: false },
    theme: 'ember',
    reducedMotion: false,
    highContrast: false,
    colorPalette: 'standard',   // standard | high-visibility
    largeText: false,
    leftHanded: false,
    holdToDrag: 'tap',          // tap | hold — tap-to-place vs hold-drag emphasis
    haptics: true,
    boardMirror: false,         // always-visible DOM board
    confirmMoves: false         // timing assistance: tap target again to confirm
  };

  function defaultProgress() {
    return {
      tutorialDone: {},        // lessonId -> true
      journeyStars: {},        // levelId -> 0..3
      journeyBest: {},         // levelId -> score
      challengeBest: {},       // challengeId -> score
      dailiesDone: {},         // dateStr -> score
      endlessBest: 0,
      achievements: {},        // key -> unlockedAtMs
      stats: { rounds: 0, wins: 0, clears: 0, itemsCleared: 0, bestStreak: 0, playMs: 0 },
      cosmetics: { theme: 'ember' }
    };
  }

  function checksum(str) { // FNV-1a, decimal string
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }

  function migrate(doc) {
    // v1 is current; older shapes are upgraded field-by-field here.
    if (!doc || typeof doc !== 'object') return null;
    if (doc.v > SAVE_VERSION) return null; // future format: don't clobber
    doc.v = SAVE_VERSION;
    var old = doc.settings || {};
    doc.settings = Object.assign({}, DEFAULT_SETTINGS, old);
    // Graphics moved from a single tier to the gfx object; carry the old tier over.
    if (!old.gfx || typeof old.gfx !== 'object') {
      var legacy = { low: 'low', medium: 'balanced', high: 'high' }[old.graphicsTier];
      doc.settings.gfx = Object.assign({}, DEFAULT_SETTINGS.gfx, legacy ? { preset: legacy } : {});
    } else {
      doc.settings.gfx = Object.assign({}, DEFAULT_SETTINGS.gfx, old.gfx);
    }
    delete doc.settings.graphicsTier;
    doc.progress = Object.assign(defaultProgress(), doc.progress || {});
    return doc;
  }

  function fresh() {
    var settings = Object.assign({}, DEFAULT_SETTINGS);
    settings.gfx = Object.assign({}, DEFAULT_SETTINGS.gfx);
    return { v: SAVE_VERSION, settings: settings, progress: defaultProgress() };
  }

  var memoryFallback = null; // used when localStorage is unavailable

  function wrap(doc) { // the exact checksummed string persisted (and cloud-mirrored)
    doc.v = SAVE_VERSION;
    var payload = JSON.stringify(doc);
    return JSON.stringify({ sum: checksum(payload), payload: payload });
  }
  function unwrap(raw) { // validate + migrate a wrapped string; null when corrupt
    try {
      var box = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!box || box.sum !== checksum(box.payload)) return null;
      return migrate(JSON.parse(box.payload)) || null;
    } catch (e) { return null; }
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
    if (raw == null && memoryFallback) raw = memoryFallback;
    if (raw == null) return fresh();
    var migrated = unwrap(raw);
    return migrated || fresh(); // corrupt → clean slate
  }

  function save(doc) {
    var wrapped = wrap(doc);
    memoryFallback = wrapped;
    try { localStorage.setItem(KEY, wrapped); } catch (e) { /* memory fallback keeps session */ }
    return wrapped;
  }

  // ---------- leaderboards (local; host adapter may sync) ----------
  function loadBoards() {
    try {
      var raw = localStorage.getItem(LB_KEY);
      return raw ? JSON.parse(raw) : { entries: [] };
    } catch (e) { return { entries: [] }; }
  }
  function saveBoards(b) {
    try { localStorage.setItem(LB_KEY, JSON.stringify(b)); } catch (e) {}
  }

  // Ties: higher score, then primary-objective completion (spec §2), then
  // fewer invalid actions, then lower elapsed, then stable session id.
  // Legacy entries have no recorded completion; use one consistent key for
  // all pairs so mixed old/new records have a transitive ordering.
  function sortEntries(entries) {
    return entries.slice().sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if ((a.won === true) !== (b.won === true)) return a.won === true ? -1 : 1;
      if ((a.invalid || 0) !== (b.invalid || 0)) return (a.invalid || 0) - (b.invalid || 0);
      if ((a.durationMs || 0) !== (b.durationMs || 0)) return (a.durationMs || 0) - (b.durationMs || 0);
      return String(a.sessionId).localeCompare(String(b.sessionId));
    });
  }

  return {
    SAVE_VERSION: SAVE_VERSION,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    load: load, save: save, fresh: fresh, migrate: migrate,
    checksum: checksum, wrap: wrap, unwrap: unwrap,
    loadBoards: loadBoards, saveBoards: saveBoards, sortEntries: sortEntries
  };
});
