/**
 * Shelf Shift — end-to-end playthrough test (dev only, not shipped).
 *
 * Drives the real visible UI in headless Chrome via playwright-core:
 *   title → Settings (turn on the visible DOM board controls) → Play →
 *   Practice (Casual, fixed seed "abc") → Start → the round is played to a
 *   real win by clicking the on-screen board-mirror cells → results
 *   ("Orders complete!") with a score breakdown, and the win is persisted.
 *   Along the way the desktop pass also exercises pause/resume, the Hint
 *   button, the Undo button and shows the round is finished for real.
 *   A second pass runs the load → settings → practice → a-few-taps flow
 *   on a mobile touch viewport.
 *
 * How moves are chosen: the game exports `window.SSRules` (its own rules
 * engine), `window.SSContent`, and a debug handle `window.__ss` that
 * exposes the live `session.state`. The test reads those ONLY to observe
 * the current board and to ask the game's own `Rules.hint()` which legal
 * move to play next (the same legality surface the player uses). It NEVER
 * calls the game's move API and never mutates state: every action is a
 * real click/tap on a visible board-mirror button (whose click handler
 * main.js routes through the normal selectCell/tapCell → commitMove path).
 * No game source is modified.
 *
 * Serving: the repo ships `server.js` (the StarHermit authoritative script
 * declared by starhermit.txt) but, per the game's own spec (§6 / §packaging),
 * "ordinary practice can run locally and offline after initial load". When
 * `/api/v1/time` is unavailable the client degrades to its documented
 * offline path (`hosted=false`) with zero console noise. So, mirroring the
 * sibling titles (picture-logic/blockstead/balance-spire), this test embeds
 * a minimal node:http static server on an ephemeral port and answers /api/*
 * probes with 200 `{}` so the platform adapter degrades cleanly. If the UI
 * ever requires the real backend this block can be swapped for spawning
 * `server.js`; today it is not needed (the win is a local practice round).
 *
 * Input mode: the game's primary playfield is a Three.js canvas, but the DOM
 * board-mirror (`#board-mirror`, "Visible board controls (DOM)") is a
 * first-class, always-visible accessible playfield whose buttons route through
 * the game's own selectCell/tapCell → commitMove path (main.js buildMirror
 * wires `btn.addEventListener('click', () => tapCell(loc))`). When a WebGL
 * context cannot be created the game automatically sets `boardMirror=true`
 * and shows a "3D view unavailable … Continue with text board" dialog — i.e.
 * the DOM board is the intended text-board playfield. So that real pointer
 * clicks/taps reach the visible board cells (an active WebGL canvas overlays
 * them), this test launches Chrome with `--disable-webgl`, dismisses that
 * fallback dialog via its real "Continue with text board" button, and drives
 * the round with genuine clicks/taps on the DOM board cells + HUD buttons.
 * This exercises the developer-supplied accessible-controls playthrough.
 *
 * Run: npm run test:e2e  (or: node tests/e2e.mjs)
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT = (stage, vp) => `/tmp/shelf-shift-e2e-${stage}-${vp}.png`;
const SEED_TEXT = 'abc'; // deterministic practice board (verified solvable to a win)

// benign GPU/swiftshader noise (mirrors tools/production_game_audit.mjs)
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    // No StarHermit backend here: answer API probes with empty JSON (200) so
    // the platform adapter degrades to offline mode without console noise.
    if (p.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const ok = (name) => console.log(`ok - ${name}`);

// ---------- read-only observation of the game's own rules handle ----------
// window.SSRules is the game's rules engine; window.__ss.session.state is the
// live round. We only read them and ask Rules.hint() which legal move to play
// next — we never invoke the game's move API.
const cmdInfo = () => {
  const s = window.__ss && window.__ss.session && window.__ss.session.state;
  if (!s) return { ready: false };
  if (s.terminal) {
    return { ready: true, terminal: true, won: !!s.terminal.won, reason: s.terminal.reason, moves: s.moves, total: s.score.total };
  }
  const h = window.SSRules.hint(s);
  if (!h) return { ready: true, terminal: true, won: false, reason: 'no-hint', moves: s.moves };
  return { ready: true, terminal: false, from: h.from, to: h.to, item: h.item, moves: s.moves };
};

const getMoves = (page) => page.evaluate(() => window.__ss.session.state.moves);

// A board-mirror cell button is identified uniquely by its fixed position in
// its `pos` prefix (`shelf 2 cell 3` / `counter cell 1`); the item text in the
// aria-label varies with contents and a " — place here" suffix is appended to
// empty cells while an item is selected, so match on the stable pos prefix.
const cellButton = (page, loc) => {
  let prefix;
  if (loc.area === 'counter') prefix = `counter cell ${loc.i + 1}`;
  else prefix = `shelf ${loc.r + 1} cell ${loc.c + 1}`;
  return page.locator(`#board-mirror .cell-btn[aria-label^="${prefix}"]`);
};

const pageState = (page) => page.evaluate(cmdInfo);

// Select `from`, then place at `to`, through the real visible buttons, and
// wait for the engine to accept the relocation (moves increment by one).
async function playMove(page, from, to) {
  const before = await getMoves(page);
  const fromBtn = cellButton(page, from);
  await fromBtn.scrollIntoViewIfNeeded();
  await fromBtn.click();
  const toBtn = cellButton(page, to);
  await toBtn.scrollIntoViewIfNeeded();
  await toBtn.click();
  try {
    await page.waitForFunction((n) => window.__ss.session.state.moves === n, before + 1, { timeout: 4000 });
  } catch {
    throw new Error(`move ${JSON.stringify(from)} -> ${JSON.stringify(to)} did not register (moves stayed ${await getMoves(page)})`);
  }
}

async function tapMove(page, from, to) {
  const before = await getMoves(page);
  const fromBtn = cellButton(page, from);
  await fromBtn.scrollIntoViewIfNeeded();
  const fbb = await fromBtn.boundingBox();
  if (!fbb || fbb.width < 1 || fbb.height < 1) throw new Error(`from cell ${JSON.stringify(from)} too small/tap target missing`);
  await page.touchscreen.tap(fbb.x + fbb.width / 2, fbb.y + fbb.height / 2);
  const toBtn = cellButton(page, to);
  await toBtn.scrollIntoViewIfNeeded();
  const tbb = await toBtn.boundingBox();
  if (!tbb || tbb.width < 1 || tbb.height < 1) throw new Error(`to cell ${JSON.stringify(to)} too small/tap target missing`);
  await page.touchscreen.tap(tbb.x + tbb.width / 2, tbb.y + tbb.height / 2);
  await page.waitForFunction((n) => window.__ss.session.state.moves === n, before + 1, { timeout: 4000 });
}

async function startPractice(page, name) {
  // title
  await page.waitForSelector('.screen[data-name="title"].active', { timeout: 15000 });
  await page.screenshot({ path: SHOT('title', name) });
  ok(`${name}: title screen visible`);

  // dismiss the WebGL fallback dialog if it ever appeared (renderer is on via
  // swiftshader normally, but the text board is our playfield regardless)
  const fbHidden = await page.$eval('#webgl-fallback', (el) => el.classList.contains('hidden'));
  if (!fbHidden) {
    await page.click('#webgl-continue');
    await page.waitForFunction(() => document.getElementById('webgl-fallback').classList.contains('hidden'));
  }

  // Settings → turn on the visible DOM board controls (the accessible playfield)
  await page.click('#btn-settings');
  await page.waitForSelector('.screen[data-name="settings"].active');
  const cb = page.locator('#settings-form label:has-text("Visible board controls (DOM)") input[type="checkbox"]');
  if (!(await cb.isChecked())) await cb.check();
  ok(`${name}: board controls (DOM) enabled in Settings`);
  await page.screenshot({ path: SHOT('settings', name) });
  await page.click('.screen[data-name="settings"] button.btn.primary.back');
  await page.waitForSelector('.screen[data-name="title"].active');

  // Play → Practice → Cas
  await page.click('#btn-play');
  await page.waitForSelector('.screen[data-name="modes"].active');
  await page.locator('#mode-list .mode-card', { hasText: 'Practice' }).click();
  await page.waitForSelector('.screen[data-name="setup"].active');
  await page.fill('#practice-seed', SEED_TEXT);
  await page.click('#btn-start-round');

  const st = await page.evaluate(() => window.__ss && window.__ss.session && window.__ss.session.state);
  if (!st) throw new Error('round state did not come up');
  await page.waitForFunction(() => !document.getElementById('board-mirror').classList.contains('hidden'));
  const cells = await page.locator('#board-mirror .cell-btn').count();
  const shelves = await page.locator('#mirror-shelves .cell-btn').count();
  const counter = await page.locator('#mirror-counter .cell-btn').count();
  ok(`${name}: practice round active (${shelves} shelf cells + ${counter} counter cells = ${cells}, moves ${st.moves})`);
  await page.screenshot({ path: SHOT('play', name) });
  return st;
}

// ---------- one full pass ----------
async function runPass(browser, name, ctxOpts, { full }) {
  const errors = [];
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' || browserNoise.test(m.text())) return;
    const url = m.location()?.url || '';
    if (/Failed to load resource/.test(m.text()) && /\/api\/|\/favicon/.test(url)) return;
    errors.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    const p = r.url();
    if (r.status() >= 400 && !/\/api\/|\/favicon/.test(p)) errors.push(`http ${r.status()}: ${p}`);
  });

  try {
    await page.goto(BASE, { waitUntil: 'load' });
    await startPractice(page, name);

    if (full) {
      // exercise pause / resume through the visible HUD buttons
      const hudTopVisible = await page.$eval('#hud-top', (el) => !el.classList.contains('hidden'));
      if (!hudTopVisible) throw new Error('in-game HUD not visible during round');
      await page.click('#btn-pause');
      await page.waitForSelector('.screen[data-name="pause"].active');
      await page.screenshot({ path: SHOT('pause', name) });
      await page.click('#btn-resume');
      await page.waitForFunction(() => !document.querySelector('.screen[data-name="pause"]').classList.contains('active'));
      ok(`${name}: pause (⏸) and resume work`);

      // exercise the Hint button (practice allows hints; it sets the assists
      // flag but the round is not ranked, so it never blocks the win)
      await page.click('#btn-hint');
      await page.waitForTimeout(200);
      await page.screenshot({ path: SHOT('hint', name) });
      ok(`${name}: hint button fires (assist used)`);

      // exercise Undo: play the first hint move, then undo it and confirm the
      // engine returns to the pre-move board so solving continues cleanly.
      {
        const m0 = await pageState(page);
        if (m0.terminal) throw new Error('round terminal before undo exercise');
        await playMove(page, m0.from, m0.to);
        const afterMove = await getMoves(page);
        if (afterMove !== m0.moves + 1) throw new Error('undo exercise move did not land');
        const undoDisabled = await page.$eval('#btn-undo', (el) => el.disabled);
        if (undoDisabled) throw new Error('Undo button should be enabled after a move');
        await page.click('#btn-undo');
        await page.waitForFunction((n) => window.__ss.session.state.moves === n, m0.moves, { timeout: 3000 });
        ok(`${name}: play a move then Undo restores the previous board (moves ${m0.moves + 1} -> ${await getMoves(page)})`);
        // the replay of the just-undone move would be caught by the game's
        // 250ms double-tap guard (same from→to signature), so let it lapse.
        await page.waitForTimeout(400);
      }

      // solve the round for real on the visible board (following the game's
      // own hint(): the legality surface the player uses)
      let guard = 0;
      while (guard++ < 128) {
        const st = await pageState(page);
        if (st.terminal) {
          if (!st.won) throw new Error(`round ended without a win: ${st.reason} (moves ${st.moves})`);
          break;
        }
        await playMove(page, st.from, st.to);
      }
      if (guard > 128) throw new Error('solving loop did not reach a terminal state');
      const done = await pageState(page);
      if (!done.won) throw new Error('round not won: ' + JSON.stringify(done));

      // results screen
      await page.waitForSelector('#app[data-screen="results"]', { timeout: 8000 });
      const headline = (await page.textContent('#results-headline')) || '';
      if (!/Orders complete!/i.test(headline)) throw new Error(`unexpected results headline: "${headline}"`);
      const totalRow = await page.locator('#results-table tbody tr.total td').last().textContent();
      const total = Number(totalRow.trim());
      if (!(total > 0)) throw new Error(`expected a positive score total, got "${totalRow}"`);
      const clears = await page.locator('#results-table tbody tr:has-text("Triples cleared")').count();
      if (clears < 1) throw new Error('score breakdown missing the triples-cleared row');
      await page.screenshot({ path: SHOT('results', name) });
      ok(`${name}: round solved on the visible board — results shown ("${headline}", total ${total})`);

      // persistence: the practice win is recorded in the local save doc
      const stats = await page.evaluate(() => window.__ss.save.progress.stats);
      if (!stats || !(stats.wins > 0) || !(stats.rounds > 0)) {
        throw new Error('practice win not persisted in progress stats: ' + JSON.stringify(stats));
      }
      ok(`${name}: win persisted (rounds ${stats.rounds}, wins ${stats.wins}, clears ${stats.clears})`);
    } else {
      // mobile: make a few real moves via touchscreen.tap, verify progress
      let tapped = 0;
      for (let i = 0; i < 4; i++) {
        const st = await pageState(page);
        if (st.terminal) break;
        await tapMove(page, st.from, st.to);
        tapped++;
      }
      const moves = await getMoves(page);
      if (tapped < 3 || moves < 3) throw new Error(`expected >=3 taps/moves, got tapped=${tapped} moves=${moves}`);
      await page.screenshot({ path: SHOT('mobile-play', name) });
      ok(`${name}: moved ${tapped} pieces via touchscreen.tap (moves ${moves})`);
    }
  } finally {
    await context.close();
  }

  if (errors.length) throw new Error(`${name} pass had page errors:\n  ${errors.join('\n  ')}`);
  console.log(`ok - ${name}: no page errors`);
}

// ---------- main ----------
let browser = null;
try {
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    // --disable-webgl: run in the game's documented text-board (accessible
    // controls) playfield, so the visible DOM board cells are real pointer
    // targets rather than being overlaid by the Three.js canvas.
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-webgl', '--mute-audio'],
  });
  console.log(`serving ${ROOT} at ${BASE}`);
  await runPass(browser, 'desktop', { viewport: { width: 1280, height: 800 } }, { full: true });
  await runPass(browser, 'mobile',
    { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, { full: false });
  console.log('\nE2E PASS — shelf-shift, desktop + mobile, no page errors');
} catch (e) {
  failures++;
  console.error('\nE2E FAIL:', e.message || e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
}
if (failures) process.exit(1);
