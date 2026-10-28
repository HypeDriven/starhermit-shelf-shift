// Plays the web package in Chrome on the machine's GPU (~/games/tools/
// gpu-chrome.mjs; GPU_ADAPTER=software for headless SwiftShader), the loader
// index.html that `npm run package` writes, at a desktop viewport, a phone
// (DPR 3) and a phone held sideways (DPR 3): on the desktop Journey stage 1
// is won by mouse clicks on the cells (a click lifts an object, a click on a
// glowing cell places it), with a pause by Escape, and stage 2 by mouse drags;
// on the phone the Learn lessons 1-2 are played by finger taps and lesson 3
// by finger drags; sideways today's Daily is won by finger taps. Moves come
// from the play scripts' solver (tools/gen-plays.mjs). Widgets and the cells'
// named targets are found through the page's accessibility mirror of the
// engine's UI. Screenshots of each step go to --shots. Fails on console
// errors or warnings, the runtime's error screen, or a view that does not
// finish.
//   node tools/browser-play.mjs [GAME_DIR] [--shots OUT_DIR]
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { lessonState, solveCfg, solveFrom } from './gen-plays.mjs';

const req = createRequire(import.meta.url);
const Content = req('../js/content.js');
const args = process.argv.slice(2);
const dir = resolve(args[0] && !args[0].startsWith('--') ? args[0] : '.');
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const shots = opt('--shots', null);

function findPlaywright() {
  const roots = [dir, resolve(dir, '..'), ...readdirSync(resolve(dir, '..')).map((d) => resolve(dir, '..', d))];
  for (const r of roots) {
    const p = join(r, 'node_modules', 'playwright-core');
    if (existsSync(p)) return createRequire(join(r, 'package.json'))('playwright-core');
  }
  throw new Error('playwright-core not found');
}
const { chromium } = findPlaywright();

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.ts': 'text/plain',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
  if (path === 'api/v1/time') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ serverTime: Date.now(), serverTimeIso: new Date().toISOString() })); return; }
  const parts = path.split('/');
  if (parts.some((p) => p.startsWith('.') || p === '..') || ['tests', 'tools', 'node_modules'].includes(parts[0])) { res.writeHead(404).end(); return; }
  const file = join(dir, path);
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const views = [
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  { name: 'landscape', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
];

const { launchChrome } = await import('/home/albert/games/tools/gpu-chrome.mjs');
const { browser, gpu, close } = await launchChrome(chromium);
console.log(`# chrome on ${gpu}`);
let failed = false;
for (const v of views) {
  const ctx = await browser.newContext({ viewport: v.viewport, isMobile: v.isMobile, hasTouch: v.hasTouch, deviceScaleFactor: v.deviceScaleFactor });
  const page = await ctx.newPage();
  const cdp = v.hasTouch ? await ctx.newCDPSession(page) : null;
  const problems = [];
  const environment = /^No available adapters\.$|GL Driver Message/;
  page.on('console', (m) => {
    const platformRoute = /\/api\//.test(m.location()?.url ?? '');
    if ((m.type() === 'error' || m.type() === 'warning') && !environment.test(m.text()) && !platformRoute) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400 && !/\/api\//.test(r.url())) problems.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  const started = await page.waitForFunction(() => ['running', 'error'].includes(document.documentElement.dataset.starhermit), null, { timeout: 90000 }).then(() => true, () => false);
  await page.waitForTimeout(4000);
  const shot = async (name) => { if (shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: join(shots, `${v.name}-${name}.png`) }); } };
  const find = (name) => page.getByRole('button', { name, exact: true }).or(page.getByRole('checkbox', { name, exact: true })).or(page.getByText(name, { exact: true })).first();
  /** A tap / click at window coordinates (CSS px). */
  const tapAt = async (x, y) => {
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await page.waitForTimeout(80);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else await page.mouse.click(x, y);
    await page.waitForTimeout(250);
  };
  /** A press on a widget (or a table target): the mouse on the desktop, a finger on the phones. */
  const press = async (name) => {
    const el = find(name);
    await el.waitFor({ timeout: 15000 });
    const b = await el.boundingBox();
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await page.waitForTimeout(80);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else await page.mouse.click(x, y);
    await page.waitForTimeout(250);
  };
  let reached = false;
  const cellName = (loc) => (loc.area === 'counter' ? `counter cell ${loc.i + 1}:` : `shelf ${loc.r + 1} cell ${loc.c + 1}:`);
  const cellBox = async (loc) => {
    const t = page.getByRole('button', { name: new RegExp(`^${cellName(loc)}`) }).first();
    await t.waitFor({ timeout: 15000 });
    const b = await t.boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  /** A drag from one cell to another: the mouse on the desktop, a finger on the phones. */
  const dragCells = async (from, to) => {
    const a = await cellBox(from), b = await cellBox(to);
    const steps = 10;
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
      for (let i = 1; i <= steps; i++) {
        await page.waitForTimeout(30);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps, id: 1 }] });
      }
      await page.waitForTimeout(60);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      for (let i = 1; i <= steps; i++) { await page.waitForTimeout(30); await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps); }
      await page.waitForTimeout(60);
      await page.mouse.up();
    }
    await page.waitForTimeout(450);
  };
  const results = async () => { await page.getByText('Orders complete!', { exact: true }).first().waitFor({ timeout: 60000 }); await page.waitForTimeout(800); };
  const started2 = async () => { await page.getByText('Orders', { exact: true }).first().waitFor({ timeout: 60000 }); await page.waitForTimeout(2500); };
  /** One round's moves: taps on the cells' targets (lift, then place) or drags. */
  const playMoves = async (moves, how) => {
    for (const m of moves) {
      if (how === 'drag') { await dragCells(m.from, m.to); continue; }
      for (const loc of [m.from, m.to]) { const p = await cellBox(loc); await tapAt(p.x, p.y); await page.waitForTimeout(150); }
      await page.waitForTimeout(300);
    }
  };
  const lessonMoves = (l) => solveFrom(lessonState(l), (s, evs) => (l.goal.event === 'win' ? !!(s.terminal && s.terminal.won) : evs.filter((e) => e.type === l.goal.event).length >= l.goal.count)).moves;
  try {
    await shot('title');
    if (v.name === 'desktop') {
      await press('Journey');
      await page.getByRole('button', { name: /^Stage 1: First Shelf/ }).first().click();
      await started2();
      await shot('journey-1');
      const s1 = solveCfg(Content.JOURNEY[0]).moves;
      const p = await cellBox(s1[0].from);
      await tapAt(p.x, p.y);
      await page.waitForTimeout(500);
      await shot('journey-1-selected');
      await tapAt(p.x, p.y); // a second tap on the lifted object puts it back
      await page.keyboard.press('Escape');
      await find('Resume').waitFor({ timeout: 15000 });
      await page.waitForTimeout(500);
      await shot('pause');
      await press('Resume');
      await page.waitForTimeout(500);
      await playMoves(s1, 'tap');
      await results();
      await shot('journey-1-results');
      await press('Next');
      await started2();
      await playMoves(solveCfg(Content.JOURNEY[1]).moves, 'drag');
      await results();
      await shot('journey-2-results');
    } else if (v.name === 'phone') {
      await press('Play');
      await page.getByRole('button', { name: 'Learn', exact: true }).first().waitFor({ timeout: 15000 });
      await press('Learn');
      await press('1. Move an object');
      const tut = Content.tutorialLessons();
      for (let i = 0; i < 3; i++) {
        await page.getByText(`Lesson ${i + 1}: ${tut[i].title}`, { exact: true }).first().waitFor({ timeout: 60000 });
        await page.waitForTimeout(2500);
        await shot(`lesson-${i + 1}`);
        await playMoves(lessonMoves(tut[i]), i === 2 ? 'drag' : 'tap');
        // the toast is drawn text (not in the accessibility mirror): wait for the next lesson's banner
        await page.getByText(`Lesson ${i + 2}: ${tut[i + 1].title}`, { exact: true }).first().waitFor({ timeout: 30000 });
      }
    } else {
      const daily = Content.dailyConfig(Content.utcDateString(Date.now()));
      await press('Daily challenge');
      await press('Start');
      await started2();
      await shot('daily');
      await playMoves(solveCfg(daily).moves, 'tap');
      await results();
      await shot('daily-results');
    }
    reached = true;
  } catch (e) { problems.push(`play: ${String(e.message || e).split('\n')[0]}`); await shot('failed'); }
  const state = await page.evaluate(() => document.documentElement.dataset.starhermit ?? '');
  const ok = started && state === 'running' && problems.length === 0 && reached;
  failed ||= !ok;
  console.log(`${ok ? 'ok' : 'not ok'} - ${v.name} played: started=${started} state=${state || '-'} played=${reached}`);
  for (const p of problems) console.log(`  ${p}`);
  await ctx.close();
}
await close();
server.close();
process.exit(failed ? 1 : 0);
