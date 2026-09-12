/**
 * Shelf Shift — hosted-mode smoke test (dev only, not part of `npm test`).
 *
 * Serves the game together with a mock StarHermit platform (launch token in
 * the fragment, scoped refresh, profile, cloud saves, read-only leaderboard)
 * and drives headless Chrome through boot + settings change, asserting:
 *   - the fragment token is read once and stripped
 *   - Bearer auth on refresh / profile / cloud PUT (with the re-minted token)
 *   - the account nickname (never the username) in the title/profile UI
 *   - the cloud PUT body is a valid stored zip of the checksummed save doc
 *     (also written to /tmp/shelf-shift-cloud-save.zip for external checks)
 *   - the platform leaderboard renders read-only with resolved nicknames
 *   - NO /api/v1/time or /api/v1/telemetry calls (fabricated hosted routes
 *     must not be probed on-platform)
 *   - zero JS page errors
 * Run: node tests/hosted-smoke.mjs
 */
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg',
  '.opus': 'audio/ogg', '.md': 'text/plain; charset=utf-8'
};
const USER = '2712e04e-461b-4d23-81ae-e40b429128a8'; // starhermit.txt owner
const received = []; // {path, method, auth}
let putBody = null;

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = b64u({ alg: 'none' }) + '.' + b64u({ sub: USER, game_scope: 'shelf-shift' }) + '.sig';
const TOKEN2 = b64u({ alg: 'none' }) + '.' + b64u({ sub: USER, game_scope: 'shelf-shift', iat: 2 }) + '.sig';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    received.push({ path: url.pathname + url.search, method: req.method, auth: req.headers.authorization || null });
    const j = (code, body, type = 'application/json') => {
      res.writeHead(code, { 'content-type': type });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    if (url.pathname === '/api/v1/games/shelf-shift/launch-token' && req.method === 'POST')
      return j(200, { token: TOKEN2 }); // re-mint
    if (url.pathname === `/api/v1/users/${USER}/profile`)
      return j(200, { id: USER, username: 'mira_x', nickname: 'Mira' });
    if (url.pathname === '/api/v1/me/cloud-saves/shelf-shift') {
      if (req.method === 'PUT') {
        let b = '';
        for await (const c of req) b += c;
        putBody = JSON.parse(b);
        return j(200, { ok: true });
      }
      return j(404, { error: 'none' }); // no remote save yet
    }
    if (url.pathname === '/api/v1/games/shelf-shift') return j(200, { leaderboardId: 'lb-1' });
    if (url.pathname === '/api/v1/leaderboards/lb-1/entries')
      return j(200, { entries: [{ userId: USER, score: 2345 }] });
    return j(404, { error: 'nope' }); // incl. /api/v1/time, /api/v1/telemetry, /api/v1/leaderboard
  }
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  if (p === '/favicon.ico') return res.end('');
  const full = normalize(join(ROOT, p));
  if (!full.startsWith(ROOT)) { res.writeHead(403).end('no'); return; }
  try {
    const data = await readFile(full);
    res.writeHead(200, { 'content-type': MIME[extname(full).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('nf');
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function poll(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(25);
  }
  return null;
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => {
  // The expected 404 cloud-save probe logs a network line, not a JS error.
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text());
});
page.on('response', (r) => {
  if (r.status() >= 400 && !/\/api\//.test(r.url())) errors.push(`http ${r.status()}: ${r.url()}`);
});

const checks = [];
const check = (name, cond) => checks.push([name, !!cond]);

await page.goto(base + '/#game_token=' + TOKEN, { waitUntil: 'load' });
await page.waitForSelector('.screen[data-name="title"].active', { timeout: 15000 });

check('fragment stripped', await page.evaluate(() => location.hash) === '');
check('profile fetched with launch token',
  await poll(() => received.some(r => r.path === `/api/v1/users/${USER}/profile` && r.auth === 'Bearer ' + TOKEN)));
check('title shows account nickname',
  await poll(() => page.$eval('#platform-status', el => !el.hidden && /Playing as Mira/.test(el.textContent))));

// the immediate re-mint must land before the first cloud mirror PUT
check('refresh POST on scoped route with Bearer',
  await poll(() => received.some(r => r.path === '/api/v1/games/shelf-shift/launch-token' && r.method === 'POST' && r.auth === 'Bearer ' + TOKEN)));

// a settings change persists → debounced cloud PUT with the re-minted token
await page.click('#btn-settings');
await page.waitForSelector('.screen[data-name="settings"].active');
const mute = page.locator('#settings-form label:has-text("Mute all") input[type="checkbox"]');
if (!(await mute.isChecked())) await mute.check();
check('cloud PUT with re-minted token',
  await poll(() => putBody !== null && received.some(r => r.method === 'PUT' && r.auth === 'Bearer ' + TOKEN2), 10000));

let putOk = false;
if (putBody && putBody.dataBase64) {
  const bytes = new Uint8Array(Buffer.from(putBody.dataBase64, 'base64'));
  await writeFile('/tmp/shelf-shift-cloud-save.zip', Buffer.from(bytes)).catch(() => {});
  const Platform = (await import('../js/platform.js')).default;
  const Store = (await import('../js/store.js')).default;
  const wrapped = JSON.parse(new TextDecoder().decode(Platform.unzipFirstEntry(bytes)));
  putOk = wrapped && typeof wrapped.sum === 'string' &&
    wrapped.sum === Store.checksum(wrapped.payload) &&
    JSON.parse(wrapped.payload).v === 1;
}
check('cloud PUT body is a valid checksummed zip save doc', putOk);

check('no /api/v1/time probe on-platform', !received.some(r => r.path === '/api/v1/time'));
check('no /api/v1/telemetry call on-platform', !received.some(r => r.path === '/api/v1/telemetry'));
await page.click('.screen[data-name="settings"] button.btn.primary.back');
await page.waitForSelector('.screen[data-name="title"].active');

// scores screen: platform board rendered read-only with the nickname
await page.click('#btn-leaderboard');
await page.waitForSelector('.screen[data-name="leaderboard"].active');
check('platform rankings rendered read-only',
  await poll(() => page.$eval('#lb-body', el => /Platform rankings/.test(el.textContent) && /Mira/.test(el.textContent) && !/mira_x/.test(el.textContent))));
check('platform board read with Bearer',
  received.some(r => r.path.startsWith('/api/v1/leaderboards/lb-1/entries') && r.auth && r.auth.indexOf('Bearer ') === 0));

// profile screen: account identity + sync status, no free-text name field
await page.click('.screen[data-name="leaderboard"] button[data-back]');
await page.waitForSelector('.screen[data-name="title"].active');
await page.click('#btn-profile');
await page.waitForSelector('.screen[data-name="profile"].active');
const profileText = await page.$eval('#profile-body', el => el.textContent);
check('profile shows account + cloud status',
  /Mira/.test(profileText) && /Cloud save synced/.test(profileText) && !/mira_x/.test(profileText));
check('no local display-name field while hosted',
  (await page.$('#profile-body input[aria-label="Display name"]')) === null);

check('zero JS page errors', errors.length === 0);

let failed = 0;
for (const [name, okFlag] of checks) {
  console.log(`${okFlag ? 'ok  -' : 'FAIL -'} ${name}`);
  if (!okFlag) failed++;
}
if (errors.length) console.log('page errors:\n  ' + errors.join('\n  '));
await browser.close();
server.close();
console.log(failed ? `\nHOSTED SMOKE FAIL (${failed})` : '\nHOSTED SMOKE PASS');
if (putBody) console.log('cloud save zip written to /tmp/shelf-shift-cloud-save.zip');
process.exit(failed ? 1 : 0);
