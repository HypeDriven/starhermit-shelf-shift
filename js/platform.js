/* Shelf Shift — StarHermit platform adapter (browser + Node).
 * Thin wrapper over window.StarHermit (starhermit-sdk.js, loaded first):
 * launch token + renewal, account nickname, sign-in / invite link, the
 * checksummed save document mirrored to the cloud-save slot game:<slug>
 * (debounced, flushed on pagehide), per-player settings KV, keyboard
 * bindings (control.* in starhermit.txt) and the read-only platform
 * leaderboard. Without a launch token every call is inert and makes no
 * network request; tokens are never persisted. Browser global: window.SSPlatform.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SSPlatform = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  // Keyboard actions; mirrors the control.* lines in starhermit.txt.
  const DEFAULT_CONTROLS = {
    left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'],
    confirm: ['Enter', 'Space', 'NumpadEnter'], cancel: ['Escape'],
    undo: ['KeyU'], hint: ['KeyH'], pause: ['KeyP'], skip: ['KeyS'], camera: ['KeyC']
  };
  function cloneControls(c) {
    const out = {};
    for (const k of Object.keys(c)) out[k] = c[k].slice();
    return out;
  }

  function create(opts) {
    opts = opts || {};
    const onSync = opts.onSync || (() => {});
    const onSignedOut = opts.onSignedOut || (() => {});
    const sh = opts.sh || root.StarHermit || null;
    let nickname = null;
    let sync = 'local'; // local | connecting | synced | saving | error
    let controls = cloneControls(DEFAULT_CONTROLS);
    let lastSettings = null; // JSON per key of the settings last pushed/applied

    function hosted() { return !!(sh && sh.signedIn); }
    function setSync(s) { sync = s; onSync(syncLabel()); }
    function syncLabel() {
      switch (sync) {
        case 'synced': return 'Cloud save synced';
        case 'saving': return 'Cloud saving…';
        case 'connecting': return 'Cloud connecting…';
        case 'error': return 'Cloud sync error — local copy safe';
        default: return null; // local play: no badge
      }
    }
    function displayName() {
      if (!hosted() || !sh.userId) return null;
      return nickname || ('Player ' + String(sh.userId).slice(0, 6));
    }

    async function loadProfile() {
      const p = await sh.profile().catch(() => null);
      nickname = p ? p.displayName : null;
      onSync(syncLabel()); // nickname arrived: re-render the name slots
    }

    // ---- cloud save: the exact checksummed string Store wrote ----
    async function loadCloudSave() {
      if (!hosted()) return null;
      const out = await sh.loadSave().catch(() => null);
      if (sync === 'connecting') setSync('synced');
      return out;
    }
    function queueCloudSave(wrapped) {
      if (!hosted()) return;
      setSync('saving');
      sh.saveJSON(JSON.parse(wrapped), 2000);
    }
    function flushCloudSave() { if (hosted()) return sh.flushSave(true); }

    // ---- settings KV (platform value wins on start) ----
    function snapshot(settings) {
      const out = {};
      for (const k of Object.keys(settings || {})) out[k] = JSON.stringify(settings[k]);
      return out;
    }
    // Merge the platform's values into `settings` (platform wins), then push
    // any local-only keys up. Returns true when local settings changed.
    async function syncSettings(settings) {
      if (!hosted()) return false;
      const remote = (await sh.getSettings().catch(() => null)) || {};
      let changed = false;
      for (const k of Object.keys(remote)) {
        if (k in settings && remote[k] != null && JSON.stringify(settings[k]) !== JSON.stringify(remote[k])) {
          settings[k] = remote[k]; changed = true;
        }
      }
      lastSettings = snapshot(remote);
      pushSettings(settings);
      return changed;
    }
    function pushSettings(settings) {
      if (!hosted() || !lastSettings) return; // not synced yet
      const now = snapshot(settings), patch = {};
      let n = 0;
      for (const k of Object.keys(now)) {
        if (lastSettings[k] !== now[k]) { patch[k] = settings[k]; n++; }
      }
      lastSettings = now;
      if (n) sh.patchSettings(patch);
    }

    // ---- keyboard bindings ----
    async function loadControls() {
      if (!hosted()) return controls;
      controls = await sh.loadBindings(DEFAULT_CONTROLS).catch(() => controls);
      return controls;
    }
    function actionFor(code) {
      for (const a in controls) if (controls[a].indexOf(code) !== -1) return a;
      return null;
    }
    function keyLabel(action) {
      return (controls[action] || []).map(c => c.replace(/^Key|^Digit|^Arrow/, '')).join('/');
    }

    // ---- platform leaderboard (read-only; resolve userIds to nicknames) ----
    async function fetchPlatformLeaderboard(pageSize) {
      if (!hosted()) return null;
      const r = await sh.leaderboard(null, { pageSize: pageSize || 10 }).catch(() => null);
      if (!r || !r.board) return null; // no platform board: local records only
      const out = [];
      for (const e of (r.items || []).slice(0, pageSize)) {
        const p = e.userId ? await sh.profile(e.userId).catch(() => null) : null;
        out.push({ name: p ? p.displayName : 'Player', score: e.score });
      }
      return out.length ? out : null;
    }

    function start() {
      if (!sh) return;
      if (!sh.token) sh.init();
      sh.on('saved', ok => setSync(ok ? 'synced' : 'error'));
      sh.on('auth', a => {
        if (!a.signedIn) { nickname = null; sync = 'local'; onSignedOut(); onSync(syncLabel()); }
      });
      if (!hosted()) return;
      setSync('connecting');
      void loadProfile();
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        window.addEventListener('pagehide', flushCloudSave);
        document.addEventListener('visibilitychange', () => { if (document.hidden) flushCloudSave(); });
      }
    }

    return {
      start, hosted, displayName, syncLabel,
      canSignIn: () => !!(sh && sh.canSignIn()),
      signIn: () => !!(sh && sh.signIn()),
      inviteLink: () => (hosted() ? sh.inviteLink() : null),
      loadCloudSave, queueCloudSave, flushCloudSave, fetchPlatformLeaderboard,
      syncSettings, pushSettings,
      loadControls, actionFor, keyLabel, get controls() { return controls; }
    };
  }

  return { create, DEFAULT_CONTROLS };
});
