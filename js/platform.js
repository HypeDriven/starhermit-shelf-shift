/* Shelf Shift — StarHermit platform adapter (browser + Node).
 * Reads the fragment launch token once and strips it, sends
 * `Authorization: Bearer` on every same-origin call, re-mints the token at
 * launch and on a 45-minute cadence, resolves the account nickname, mirrors
 * the checksummed save document to the platform cloud-save slot (stored zip
 * + base64, debounced, flushed on pagehide), and reads the platform
 * leaderboard (read-only). Every failure falls back to local play silently;
 * tokens are never persisted. Browser global: window.SSPlatform.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SSPlatform = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- minimal ZIP writer/reader (stored entries only, no compression) ----
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function zipStore(name, dataBytes) {
    const enc = new TextEncoder();
    const nameB = enc.encode(name);
    const crc = crc32(dataBytes);
    const out = [];
    const u16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff);
    const u32 = (v) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
    u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
    u32(crc); u32(dataBytes.length); u32(dataBytes.length);
    u16(nameB.length); u16(0);
    const head = new Uint8Array(out);
    const cd = [];
    const c16 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff);
    const c32 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
    c32(0x02014b50); c16(20); c16(20); c16(0); c16(0); c16(0); c16(0);
    c32(crc); c32(dataBytes.length); c32(dataBytes.length);
    c16(nameB.length); c16(0); c16(0); c16(0); c16(0); c32(0); c32(0); // attrs + local-header offset
    const cdHead = new Uint8Array(cd);
    const cdOff = head.length + nameB.length + dataBytes.length;
    const parts = [head, nameB, dataBytes, cdHead, nameB];
    const eocd = [];
    const e32 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
    const e16 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff);
    e32(0x06054b50); e16(0); e16(0); e16(1); e16(1);
    e32(cdHead.length + nameB.length); e32(cdOff); e16(0);
    parts.push(new Uint8Array(eocd));
    const total = parts.reduce((n, p) => n + p.length, 0);
    const buf = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { buf.set(p, o); o += p.length; }
    return buf;
  }
  function unzipFirstEntry(zipBytes) {
    // Stored single-entry reader: scan local headers for compression 0.
    const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
    let off = 0;
    while (off + 30 <= zipBytes.length && dv.getUint32(off, true) === 0x04034b50) {
      const method = dv.getUint16(off + 8, true);
      const size = dv.getUint32(off + 18, true);
      const nameLen = dv.getUint16(off + 26, true);
      const extraLen = dv.getUint16(off + 28, true);
      const dataOff = off + 30 + nameLen + extraLen;
      if (method !== 0) throw new Error('unsupported zip entry');
      return zipBytes.slice(dataOff, dataOff + size);
    }
    throw new Error('bad zip');
  }
  function bytesToBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // ---- launch token ----
  function defaultLoc() {
    if (typeof window === 'undefined' || !window.location) return null;
    return {
      hash: window.location.hash || '',
      search: window.location.search || '',
      strip() {
        try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) { /* history denied: keep the hash, token still honoured */ }
      }
    };
  }
  function readLaunchToken(loc) {
    if (!loc) return null;
    // Production: the token arrives in the URL fragment. Read once, strip it.
    try {
      const h = loc.hash || '';
      if (h.indexOf('game_token=') !== -1) {
        const token = new URLSearchParams(h.slice(1)).get('game_token');
        loc.strip();
        if (token) return token;
      }
    } catch (e) { /* malformed hash: fall through to query fallback */ }
    // Local dev only: query-param fallbacks against the repo's own server.js.
    try {
      const q = new URLSearchParams(loc.search || '');
      return q.get('game_token') || q.get('token') || q.get('launch') || q.get('launch_token');
    } catch (e) { return null; }
  }
  function decodeJwtPayload(token) {
    try {
      const parts = token.split('.');
      if (parts.length < 2) return null;
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')));
      return json && typeof json === 'object' ? json : null;
    } catch (e) { return null; }
  }

  function create(opts) {
    opts = opts || {};
    const onSync = opts.onSync || (() => {});
    const fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    const REFRESH_MS = opts.refreshMs || 45 * 60 * 1000;   // token lives 60 min
    const RETRY_MS = opts.retryMs || 60 * 1000;
    const SAVE_DEBOUNCE_MS = opts.saveDebounceMs || 2000;
    const enc = new TextEncoder();
    let token = null, userId = null, slug = null, nickname = null;
    let sync = 'local'; // local | connecting | synced | saving | error
    let refreshTimer = null, saveTimer = null, pushing = false, pendingWrapped = null;
    const profileCache = new Map();

    function hosted() { return !!token; }
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
      if (!hosted() || !userId) return null;
      return nickname || ('Player ' + String(userId).slice(0, 8));
    }

    // Same-origin authenticated fetch; resolves null on any failure (never throws).
    async function apiFetch(path, options) {
      if (!token || !fetchImpl) return null;
      try {
        return await fetchImpl(path, {
          ...(options || {}),
          headers: { authorization: 'Bearer ' + token, ...((options && options.headers) || {}) },
          signal: (options && options.signal) || (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined)
        });
      } catch (e) { return null; }
    }

    function later(fn, ms) {
      const t = setTimeout(fn, ms);
      if (t && typeof t.unref === 'function') t.unref(); // never hold the process (Node)
      return t;
    }

    // ---- token refresh: re-mint at launch, then every 45 min, retry ~60 s ----
    async function refreshToken() {
      const res = await apiFetch(`/api/v1/games/${encodeURIComponent(slug)}/launch-token`, { method: 'POST' });
      const body = res && res.ok ? await res.json().catch(() => null) : null;
      if (body && body.token) {
        token = body.token;
        const p = decodeJwtPayload(token);
        if (p) { userId = p.sub || userId; slug = p.game_scope || slug; }
        refreshTimer = later(() => { void refreshToken(); }, REFRESH_MS);
      } else {
        refreshTimer = later(() => { void refreshToken(); }, RETRY_MS);
      }
    }

    // ---- profile nickname (NEVER /api/v1/me, never usernames) ----
    async function fetchProfileName(uid) {
      if (profileCache.has(uid)) return profileCache.get(uid);
      let name = 'Player ' + String(uid).slice(0, 8);
      const res = await apiFetch(`/api/v1/users/${encodeURIComponent(uid)}/profile`);
      const body = res && res.ok ? await res.json().catch(() => null) : null;
      if (body && body.nickname) name = body.nickname;
      profileCache.set(uid, name);
      return name;
    }
    async function loadProfile() {
      const name = await fetchProfileName(userId);
      nickname = name === 'Player ' + String(userId).slice(0, 8) ? null : name;
      onSync(syncLabel()); // nickname arrived: re-render the name slots
    }

    // ---- cloud save (one slot, stored zip + base64; localStorage stays the offline cache) ----
    async function loadCloudSave() {
      let out = null;
      const res = await apiFetch(`/api/v1/me/cloud-saves/${encodeURIComponent(slug)}`);
      if (res && res.ok) {
        try {
          const bytes = new Uint8Array(await res.arrayBuffer());
          out = new TextDecoder().decode(unzipFirstEntry(bytes));
        } catch (e) { out = null; }
      }
      if (sync === 'connecting' && !pendingWrapped) setSync('synced');
      return out; // the checksummed save string Store wrote (or null: 404/none/offline)
    }
    async function pushPending() {
      if (!token || !pendingWrapped || pushing) return;
      pushing = true;
      try {
        const res = await apiFetch(`/api/v1/me/cloud-saves/${encodeURIComponent(slug)}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dataBase64: bytesToBase64(zipStore('save.json', enc.encode(pendingWrapped))) })
        });
        if (res && res.ok) { pendingWrapped = null; setSync('synced'); }
        else setSync('error');
      } finally { pushing = false; }
    }
    function queueCloudSave(wrapped) {
      if (!token) return;
      pendingWrapped = wrapped;
      setSync('saving');
      if (saveTimer) return;
      saveTimer = later(() => { saveTimer = null; void pushPending(); }, SAVE_DEBOUNCE_MS);
    }
    function flushCloudSave() {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      void pushPending();
    }

    // ---- platform leaderboard (read-only; resolve userIds to nicknames) ----
    async function fetchPlatformLeaderboard(pageSize) {
      const g = await apiFetch(`/api/v1/games/${encodeURIComponent(slug)}`);
      const info = g && g.ok ? await g.json().catch(() => null) : null;
      if (!info || !info.leaderboardId) return null; // no platform board: local records only
      const r = await apiFetch(`/api/v1/leaderboards/${encodeURIComponent(info.leaderboardId)}/entries?page=1&pageSize=${pageSize | 0 || 10}`);
      const body = r && r.ok ? await r.json().catch(() => null) : null;
      const list = body && Array.isArray(body.entries) ? body.entries : [];
      const out = [];
      for (const e of list.slice(0, pageSize)) {
        const uid = e.userId || e.user_id;
        out.push({ name: uid ? await fetchProfileName(uid) : 'Player', score: e.score });
      }
      return out.length ? out : null;
    }

    function start() {
      token = readLaunchToken(opts.loc || defaultLoc());
      const p = token && decodeJwtPayload(token);
      if (!p || !p.sub || !p.game_scope) { token = null; return; } // malformed: stay local
      userId = p.sub;
      slug = p.game_scope;
      setSync('connecting');
      void refreshToken(); // re-mint immediately (token may be near expiry)
      void loadProfile();
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        window.addEventListener('pagehide', flushCloudSave);
        document.addEventListener('visibilitychange', () => { if (document.hidden) flushCloudSave(); });
      }
    }

    return {
      start, hosted, displayName, syncLabel,
      authHeaders: () => (token ? { authorization: 'Bearer ' + token } : {}),
      loadCloudSave, queueCloudSave, flushCloudSave, fetchPlatformLeaderboard
    };
  }

  return { create, zipStore, unzipFirstEntry, decodeJwtPayload, readLaunchToken };
});
