/* Shelf Shift — platform adapter unit tests (node tests/platform.test.js).
 * Loads js/platform.js over the shipped StarHermit SDK with a stubbed fetch
 * and launch fragment: token read/strip, profile nickname, cloud-save
 * round-trip on game:<slug>, settings KV merge + patch, control bindings,
 * sign-out, and zero network calls standalone.
 */
'use strict';
const assert = require('assert');
const SDK = require('../starhermit-sdk.js');
const Platform = require('../js/platform.js');
const Store = require('../js/store.js');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok  - ' + name); }
  catch (e) { console.error('FAIL - ' + name); console.error(e); process.exitCode = 1; }
}

const USER = '2712e04e-461b-4d23-81ae-e40b429128a8';
const SLUG = 'shelf-shift-test';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = b64u({ alg: 'none' }) + '.' + b64u({ sub: USER, game_scope: SLUG, exp: Math.floor(Date.now() / 1000) + 3600 }) + '.sig';

function res(status, body) {
  const bytes = body instanceof Uint8Array ? body : null;
  const text = bytes || body == null ? '' : JSON.stringify(body);
  return {
    status, ok: status >= 200 && status < 300, statusText: String(status),
    text: async () => text, json: async () => JSON.parse(text),
    arrayBuffer: async () => (bytes || Buffer.from(text)).slice().buffer
  };
}
function fakePlatform() {
  const calls = [];
  const state = { save: null, settings: { music: 0.2, theme: 'mint' } };
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url, method, auth: init.headers.Authorization, body: init.body, keepalive: init.keepalive });
    const path = url.split('?')[0];
    if (path === `/api/v1/users/${USER}/profile`) return res(200, { username: 'mira_x', nickname: 'Mira' });
    if (path === '/api/v1/me/cloud-saves/' + encodeURIComponent('game:' + SLUG)) {
      if (method === 'PUT') { state.save = Buffer.from(JSON.parse(init.body).dataBase64, 'base64'); return res(204); }
      return state.save ? res(200, new Uint8Array(state.save)) : res(404);
    }
    if (path === `/api/v1/games/${SLUG}/settings`) {
      if (method === 'PATCH') Object.assign(state.settings, JSON.parse(init.body).settings);
      return res(200, { settings: state.settings });
    }
    if (path === `/api/v1/games/${SLUG}/controls`) return res(200, { actions: [{ action: 'hint', codes: ['KeyJ'] }] });
    return res(404);
  };
  return { fetch, calls, state };
}
function makeWindow(hash) {
  return {
    location: { hash, search: '', pathname: '/index.html', hostname: 'localhost', href: 'http://localhost/index.html' + hash },
    history: { state: null, replaceState(_s, _t, url) { this.last = url; } }
  };
}
const tick = () => new Promise(r => setTimeout(r, 0));

test('hosted: token, nickname, cloud save game:<slug>, settings, controls, sign-out', async () => {
  const fake = fakePlatform();
  const win = makeWindow('#game_token=' + TOKEN + '&session_id=s1');
  const sh = SDK.create({ window: win, fetch: fake.fetch, setTimeout: () => 0, clearTimeout() {} });
  sh.init();
  assert.strictEqual(win.history.last, '/index.html', 'token stripped from fragment');
  let signedOut = 0;
  const p = Platform.create({ sh, onSignedOut: () => signedOut++ });
  p.start();
  assert.strictEqual(p.hosted(), true);
  await tick(); await tick();
  assert.strictEqual(p.displayName(), 'Mira', 'nickname, never the username');
  assert.ok(fake.calls.every(c => c.auth === 'Bearer ' + TOKEN), 'Bearer on every call');
  assert.ok(!fake.calls.some(c => c.url === '/api/v1/me'), 'never /api/v1/me');

  // cloud save round-trip (the checksummed wrapped string)
  assert.strictEqual(await p.loadCloudSave(), null, 'no remote save yet');
  const doc = Store.fresh();
  doc.progress.endlessBest = 4321;
  const wrapped = Store.wrap(doc);
  p.queueCloudSave(wrapped);
  await p.flushCloudSave();
  const put = fake.calls.find(c => c.method === 'PUT');
  assert.ok(put.url.endsWith('/cloud-saves/game%3A' + SLUG), 'slot game:<slug>');
  assert.strictEqual(put.keepalive, true, 'pagehide flush uses keepalive');
  const back = await p.loadCloudSave();
  assert.strictEqual(back, wrapped);
  assert.strictEqual(Store.unwrap(back).progress.endlessBest, 4321);

  // settings: platform wins, local-only keys pushed, later changes patched
  const settings = Store.fresh().settings;
  assert.strictEqual(await p.syncSettings(settings), true);
  assert.strictEqual(settings.music, 0.2);
  assert.strictEqual(settings.theme, 'mint');
  assert.strictEqual(fake.state.settings.effects, settings.effects, 'local-only keys pushed');
  const before = fake.calls.filter(c => c.method === 'PATCH').length;
  settings.largeText = true;
  p.pushSettings(settings);
  await tick();
  const patches = fake.calls.filter(c => c.method === 'PATCH');
  assert.strictEqual(patches.length, before + 1);
  assert.deepStrictEqual(JSON.parse(patches[patches.length - 1].body).settings, { largeText: true });

  // controls
  await p.loadControls();
  assert.strictEqual(p.actionFor('KeyJ'), 'hint', 'platform override');
  assert.strictEqual(p.actionFor('KeyH'), null);
  assert.strictEqual(p.actionFor('KeyU'), 'undo', 'default kept');
  assert.strictEqual(p.keyLabel('confirm'), 'Enter/Space/NumpadEnter');

  assert.ok(p.inviteLink().endsWith(`/game-invite/${USER}/${SLUG}`));
  assert.strictEqual(p.canSignIn(), false);
  sh.signOut('expired');
  assert.strictEqual(signedOut, 1);
  assert.strictEqual(p.hosted(), false);
  assert.strictEqual(p.inviteLink(), null);
});

test('standalone: inert, no network', async () => {
  const calls = [];
  const sh = SDK.create({ window: makeWindow(''), fetch: async (u) => { calls.push(u); return res(500); } });
  sh.init();
  const p = Platform.create({ sh });
  p.start();
  assert.strictEqual(p.hosted(), false);
  assert.strictEqual(p.displayName(), null);
  assert.strictEqual(await p.loadCloudSave(), null);
  p.queueCloudSave(Store.wrap(Store.fresh()));
  await p.flushCloudSave();
  assert.strictEqual(await p.syncSettings(Store.fresh().settings), false);
  p.pushSettings({ music: 1 });
  await p.loadControls();
  assert.strictEqual(await p.fetchPlatformLeaderboard(10), null);
  assert.strictEqual(p.actionFor('ArrowLeft'), 'left');
  assert.strictEqual(p.canSignIn(), false, 'no sign-in button off-platform');
  assert.strictEqual(calls.length, 0);
});

test('sign-in offered on <id>.starhermit.com without a token', async () => {
  const win = makeWindow('');
  win.location.hostname = 'shelf-shift.starhermit.com';
  const sh = SDK.create({ window: win, fetch: async () => res(500) });
  sh.init();
  assert.strictEqual(Platform.create({ sh }).canSignIn(), true);
});

process.on('beforeExit', () => { if (!process.exitCode) console.log(`platform: ${passed} passed`); });
