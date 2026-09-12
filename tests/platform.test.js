/* Shelf Shift — platform adapter unit tests (node tests/platform.test.js).
 * Covers the stored-zip helper, fragment token read/strip/decode, Bearer on
 * every call, the launch-token refresh swap, nickname resolution (never
 * /api/v1/me, never usernames), and the debounced zip+base64 cloud save.
 */
'use strict';
const assert = require('assert');
const Platform = require('../js/platform.js');
const Store = require('../js/store.js');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok  - ' + name); }
  catch (e) { console.error('FAIL - ' + name); console.error(e); process.exitCode = 1; }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function poll(fn, ms = 2000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(15);
  }
  return null;
}

const USER = '2712e04e-461b-4d23-81ae-e40b429128a8';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload) => b64u({ alg: 'none' }) + '.' + b64u(payload) + '.sig';
const TOKEN = jwt({ sub: USER, game_scope: 'shelf-shift' });
const TOKEN2 = jwt({ sub: USER, game_scope: 'shelf-shift', iat: 2 });

function jsonRes(body, status = 200) {
  return {
    ok: status >= 200 && status < 300, status,
    json: async () => body,
    arrayBuffer: async () => new Uint8Array().buffer
  };
}
function zipRes(text) {
  const bytes = Platform.zipStore('save.json', new TextEncoder().encode(text));
  return { ok: true, status: 200, json: async () => { throw new Error('zip'); }, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}
function mockFetch(handler) {
  const calls = [];
  const fn = async (url, options = {}) => {
    const rec = { url, method: options.method || 'GET', auth: options.headers && options.headers.authorization, body: options.body };
    calls.push(rec);
    return handler(rec, calls.length);
  };
  fn.calls = calls;
  return fn;
}
function locWith(hash, search = '') {
  const loc = { hash, search, _stripped: false };
  loc.strip = () => { loc._stripped = true; loc.hash = ''; };
  return loc;
}

// ---------- stored zip ----------
test('zip round-trips a stored entry with valid structure', () => {
  const text = Store.wrap({ settings: { music: 0.5 }, progress: Store.fresh().progress });
  const bytes = Platform.zipStore('save.json', new TextEncoder().encode(text));
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.strictEqual(dv.getUint32(0, true), 0x04034b50, 'local header sig');
  const eocdOff = bytes.length - 22;
  assert.strictEqual(dv.getUint32(eocdOff, true), 0x06054b50, 'EOCD sig');
  assert.strictEqual(dv.getUint16(eocdOff + 8, true), 1, 'one central-dir entry');
  // central directory record must sit at the offset the EOCD advertises
  const cdOff = dv.getUint32(eocdOff + 16, true);
  assert.strictEqual(dv.getUint32(cdOff, true), 0x02014b50, 'central dir at advertised offset');
  assert.strictEqual(dv.getUint32(cdOff + 42, true), 0, 'local-header offset 0');
  const out = new TextDecoder().decode(Platform.unzipFirstEntry(bytes));
  assert.strictEqual(out, text);
});

// ---------- launch token ----------
test('fragment token is read once and stripped', () => {
  const loc = locWith('#game_token=' + TOKEN + '&session_id=x');
  const t = Platform.readLaunchToken(loc);
  assert.strictEqual(t, TOKEN);
  assert.ok(loc._stripped, 'fragment stripped after read');
  assert.strictEqual(loc.hash, '');
});

test('query-param fallback works without a fragment and does not strip', () => {
  const loc = locWith('', '?token=' + TOKEN);
  assert.strictEqual(Platform.readLaunchToken(loc), TOKEN);
  assert.ok(!loc._stripped, 'no fragment → nothing to strip');
});

test('JWT payload decodes sub and game_scope (no hard-coded slug)', () => {
  const p = Platform.decodeJwtPayload(jwt({ sub: 'abc-123', game_scope: 'odd-slug' }));
  assert.strictEqual(p.sub, 'abc-123');
  assert.strictEqual(p.game_scope, 'odd-slug');
});

test('malformed token stays local; no fetch is attempted', async () => {
  const f = mockFetch(() => jsonRes({}));
  const p = Platform.create({ loc: locWith('#game_token=not-a-jwt'), fetchImpl: f });
  p.start();
  assert.ok(!p.hosted());
  assert.strictEqual(f.calls.length, 0);
  assert.strictEqual(await p.loadCloudSave(), null);
  p.queueCloudSave('x');
  assert.strictEqual(p.syncLabel(), null, 'no sync badge in local play');
});

// ---------- auth + identity ----------
test('Bearer on profile/refresh/cloud/leaderboard; never /api/v1/me', async () => {
  const f = mockFetch((rec) => {
    if (rec.url === '/api/v1/games/shelf-shift/launch-token') return jsonRes({ token: TOKEN2 });
    if (rec.url === `/api/v1/users/${USER}/profile`) return jsonRes({ id: USER, username: 'mira_x', nickname: 'Mira' });
    if (rec.url === '/api/v1/me/cloud-saves/shelf-shift') return jsonRes({ error: 'none' }, 404);
    if (rec.url === '/api/v1/games/shelf-shift') return jsonRes({ leaderboardId: 'lb-1' });
    if (rec.url.startsWith('/api/v1/leaderboards/lb-1/entries')) return jsonRes({ entries: [{ userId: USER, score: 900 }] });
    return jsonRes({}, 404);
  });
  const p = Platform.create({ loc: locWith('#game_token=' + TOKEN), fetchImpl: f, refreshMs: 60000, saveDebounceMs: 20 });
  p.start();
  assert.ok(p.hosted());
  assert.ok(await poll(() => p.displayName() === 'Mira'), 'nickname resolves');
  assert.strictEqual(p.displayName(), 'Mira');
  const urls = f.calls.map(c => c.url);
  assert.ok(!urls.some(u => u === '/api/v1/me'), 'never calls /api/v1/me');
  const prof = f.calls.find(c => c.url === `/api/v1/users/${USER}/profile`);
  assert.strictEqual(prof.auth, 'Bearer ' + TOKEN);
  const refr = f.calls.find(c => c.url === '/api/v1/games/shelf-shift/launch-token');
  assert.strictEqual(refr.method, 'POST');
  assert.strictEqual(refr.auth, 'Bearer ' + TOKEN);
  // cloud GET carried Bearer (token may already be the re-minted one), 404 →
  // null, and sync settles to "synced"
  assert.strictEqual(await p.loadCloudSave(), null);
  const get = f.calls.find(c => c.url === '/api/v1/me/cloud-saves/shelf-shift' && c.method === 'GET');
  assert.ok(get.auth && get.auth.indexOf('Bearer ') === 0, 'cloud GET authenticated');
  assert.strictEqual(p.syncLabel(), 'Cloud save synced');
  // leaderboard read-only with nickname resolution
  const board = await p.fetchPlatformLeaderboard(10);
  assert.deepStrictEqual(board, [{ name: 'Mira', score: 900 }]);
  const ents = f.calls.find(c => c.url.startsWith('/api/v1/leaderboards/lb-1/entries'));
  assert.ok(ents.auth && ents.auth.indexOf('Bearer ') === 0, 'entries read authenticated');
  // after the re-mint, later calls carry the new token
  await p.loadCloudSave();
  const lastGet = f.calls.filter(c => c.url === '/api/v1/me/cloud-saves/shelf-shift' && c.method === 'GET').pop();
  assert.strictEqual(lastGet.auth, 'Bearer ' + TOKEN2, 'token swapped after refresh');
});

test('nickname falls back to Player+id8 and never shows the username', async () => {
  const f = mockFetch((rec) => {
    if (rec.url === `/api/v1/users/${USER}/profile`) return jsonRes({ error: 'none' }, 404);
    if (rec.url === '/api/v1/games/shelf-shift/launch-token') return jsonRes({ token: TOKEN });
    return jsonRes({}, 404);
  });
  const p = Platform.create({ loc: locWith('#game_token=' + TOKEN), fetchImpl: f, retryMs: 60000 });
  p.start();
  assert.ok(await poll(() => p.displayName() === 'Player ' + USER.slice(0, 8)), 'fallback name');
  assert.ok(!/mira/.test(p.displayName()), 'username never displayed');
});

// ---------- cloud save ----------
test('cloud load returns the remote doc; tampered docs are rejected', async () => {
  const wrapped = Store.wrap({ settings: Store.fresh().settings, progress: { journeyStars: { a: 3 } } });
  const f = mockFetch((rec) => {
    if (rec.url === '/api/v1/me/cloud-saves/shelf-shift') return zipRes(wrapped);
    if (rec.url === '/api/v1/games/shelf-shift/launch-token') return jsonRes({ token: TOKEN });
    return jsonRes({}, 404);
  });
  const p = Platform.create({ loc: locWith('#game_token=' + TOKEN), fetchImpl: f });
  p.start();
  const remote = await p.loadCloudSave();
  assert.strictEqual(remote, wrapped);
  const doc = Store.unwrap(remote);
  assert.strictEqual(doc.progress.journeyStars.a, 3);
  // tamper: flip a payload byte inside the zip data region (past the
  // 30-byte local header + 9-byte 'save.json' name)
  const bytes = Platform.zipStore('save.json', new TextEncoder().encode(wrapped));
  bytes[45] ^= 0xff;
  const tampered = new TextDecoder().decode(Platform.unzipFirstEntry(bytes));
  assert.strictEqual(Store.unwrap(tampered), null, 'checksum rejects tampered doc');
});

test('queued cloud save debounces into a zip+base64 PUT; flush is immediate', async () => {
  let putBody = null;
  const f = mockFetch((rec) => {
    if (rec.url === '/api/v1/me/cloud-saves/shelf-shift' && rec.method === 'PUT') { putBody = JSON.parse(rec.body); return jsonRes({ ok: true }); }
    if (rec.url === '/api/v1/games/shelf-shift/launch-token') return jsonRes({ token: TOKEN });
    return jsonRes({}, 404);
  });
  const p = Platform.create({ loc: locWith('#game_token=' + TOKEN), fetchImpl: f, saveDebounceMs: 30 });
  p.start();
  const wrapped = Store.wrap(Store.fresh());
  p.queueCloudSave(wrapped);
  assert.strictEqual(p.syncLabel(), 'Cloud saving…');
  assert.ok(await poll(() => putBody !== null, 3000), 'debounced PUT fired');
  assert.strictEqual(p.syncLabel(), 'Cloud save synced');
  const bytes = new Uint8Array(Buffer.from(putBody.dataBase64, 'base64'));
  const text = new TextDecoder().decode(Platform.unzipFirstEntry(bytes));
  assert.strictEqual(text, wrapped, 'PUT body round-trips to the wrapped save');
  // immediate flush (pagehide path)
  let putBody2 = null;
  f.handlerTrack = true;
  const f2calls = f.calls.length;
  p.queueCloudSave(wrapped);
  p.flushCloudSave();
  assert.ok(await poll(() => f.calls.length > f2calls && f.calls[f.calls.length - 1].method === 'PUT', 3000), 'flush PUT fired immediately');
  assert.strictEqual(JSON.parse(f.calls[f.calls.length - 1].body).dataBase64, putBody.dataBase64);
});

// ---------- no platform board → local only ----------
test('missing leaderboardId yields null (local records only)', async () => {
  const f = mockFetch((rec) => {
    if (rec.url === '/api/v1/games/shelf-shift/launch-token') return jsonRes({ token: TOKEN });
    return jsonRes({}, 404);
  });
  const p = Platform.create({ loc: locWith('#game_token=' + TOKEN), fetchImpl: f });
  p.start();
  assert.strictEqual(await p.fetchPlatformLeaderboard(10), null);
});

process.on('exit', () => console.log(`\n${passed} platform tests passed${process.exitCode ? ' (with failures)' : ''}`));
