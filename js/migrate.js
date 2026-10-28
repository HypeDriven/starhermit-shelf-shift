/* Shelf Shift — what the browser build (starhermit-sdk.js) left in the
 * player's account, as the engine client takes it over (pure: no storage).
 *  - The cloud save (slot game:<slug>): js/store.js's checksummed
 *    { sum, payload } document. The engine shows it as a foreign save; its
 *    text unwraps with fromBrowserSave (Store.unwrap) and merges into this
 *    device's document (Store.mergeDocs), then replaces the slot once.
 *  - The per-player settings keys (platform.js pushSettings: every key of the
 *    document's settings): the game's own preferences carry over
 *    (legacyPreferences); volumes, mute, graphics, reduced motion, contrast,
 *    larger text, the gamepad mapping and the language are the runtime's
 *    Options now and are dropped (BROWSER_KEYS lists what is removed).
 * UMD: globalThis.SSMigrate (loadClassic) / Node (require).
 */
(function (root, factory) {
  var Store = (typeof module === 'object' && module.exports) ? require('./store.js') : root.SSStore;
  var api = factory(Store);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SSMigrate = api;
})(typeof self !== 'undefined' ? self : this, function (Store) {
  'use strict';

  /** Preferences the game still owns, with their valid values. */
  var GAME_KEYS = {
    captions: function (v) { return typeof v === 'boolean'; },
    theme: function (v) { return typeof v === 'string' && !!v; },
    colorPalette: function (v) { return v === 'standard' || v === 'high-visibility'; },
    leftHanded: function (v) { return typeof v === 'boolean'; },
    holdToDrag: function (v) { return v === 'tap' || v === 'hold'; },
    haptics: function (v) { return typeof v === 'boolean'; },
    boardMirror: function (v) { return typeof v === 'boolean'; },
    confirmMoves: function (v) { return typeof v === 'boolean'; }
  };
  /** Every key platform.js wrote to the account's settings (besides the shared ui.* language keys). */
  var BROWSER_KEYS = Object.keys(GAME_KEYS).concat(['music', 'effects', 'ambience', 'voice', 'muted', 'gfx', 'reducedMotion',
    'highContrast', 'largeText', 'pad_confirm', 'pad_cancel', 'pad_pause', 'pad_undo', 'graphicsTier']);

  /** The account's old settings (key → value) → the game's preferences. */
  function legacyPreferences(kv) {
    var out = {};
    var k = kv && typeof kv === 'object' ? kv : {};
    Object.keys(GAME_KEYS).forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(k, key) && GAME_KEYS[key](k[key])) out[key] = k[key];
    });
    return out;
  }
  /** Whether an account settings key is the browser build's (removed once migrated). */
  function isBrowserKey(key) { return BROWSER_KEYS.indexOf(key) >= 0 || String(key).indexOf('ui.') === 0; }

  /** The browser build's cloud save text: the save document, or null (a broken checksum is refused, as Store.unwrap did). */
  function fromBrowserSave(text) {
    if (typeof text !== 'string' || !text) return null;
    return Store.unwrap(text);
  }

  return { GAME_KEYS: GAME_KEYS, BROWSER_KEYS: BROWSER_KEYS, legacyPreferences: legacyPreferences, isBrowserKey: isBrowserKey, fromBrowserSave: fromBrowserSave };
});
