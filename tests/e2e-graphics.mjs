/**
 * Shelf Shift — Graphics settings end-to-end test (dev only, not shipped).
 *
 * Runs with WebGL on (SwiftShader), so Auto resolves to Low. Through the real
 * visible UI, at desktop and mobile viewports: open Settings → Graphics,
 * switch preset Low → High, override one category, check the change is
 * applied (body[data-gfx-preset] + the summary line), reload and check it
 * persisted, then render a round at Ultra and at Low. Any console error or
 * warning fails the run.
 *
 * Run: node tests/e2e-graphics.mjs
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg' };

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    if (p.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const ok = (m) => console.log(`ok - ${m}`);
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

const preset = (page) => page.evaluate(() => document.body.dataset.gfxPreset);
const summary = (page) => page.textContent('#gfx-summary');

async function press(page, sel, touch) {
  const loc = page.locator(sel);
  await loc.scrollIntoViewIfNeeded();
  if (touch) await loc.tap(); else await loc.click();
}

async function openSettings(page, touch) {
  await page.waitForSelector('.screen[data-name="title"].active', { timeout: 15000 });
  await press(page, '#btn-settings', touch);
  await page.waitForSelector('.screen[data-name="settings"].active');
  await page.locator('#gfx-section').scrollIntoViewIfNeeded();
}

async function closeSettings(page, touch) {
  await press(page, '.screen[data-name="settings"] button.btn.primary.back', touch);
  await page.waitForSelector('.screen[data-name="title"].active');
}

async function inViewport(page, sel) {
  return page.$eval(sel, (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.left >= 0 && r.right <= window.innerWidth + 1;
  });
}

async function pass(browser, name, ctxOpts, touch) {
  const errors = [];
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !browserNoise.test(m.text())) errors.push(`console ${m.type()}: ${m.text()}`);
  });
  page.on('response', (r) => { if (r.status() >= 400 && !/\/api\/|favicon/.test(r.url())) errors.push(`http ${r.status()} ${r.url()}`); });
  try {
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => document.body.dataset.gfxPreset);
    expect(await preset(page) === 'low', `software GPU should auto-select Low, got ${await preset(page)}`);
    expect(await page.evaluate(() => document.body.dataset.gfxAuto) === 'true', 'Auto should be the default');
    ok(`${name}: Auto resolves to Low on the software GPU`);

    await openSettings(page, touch);
    const autoLabel = await page.$eval('#gfx-preset option[value="auto"]', (o) => o.textContent);
    expect(/Auto \(detected: Low\)/.test(autoLabel), `auto label: ${autoLabel}`);
    for (const id of ['#gfx-preset', '#gfx-scale', '#gfx-shadows', '#gfx-bloom', '#gfx-adaptive', '#gfx-fps', '#gfx-summary']) {
      expect(await inViewport(page, id), `${id} is cut off at ${name}`);
    }

    await page.selectOption('#gfx-preset', 'low');
    await page.waitForFunction(() => document.body.dataset.gfxPreset === 'low' && document.body.dataset.gfxAuto === 'false');
    await page.waitForFunction(() => /no shadows/.test(document.getElementById('gfx-summary').textContent));
    ok(`${name}: preset Low applied (${await summary(page)})`);

    await page.selectOption('#gfx-preset', 'high');
    await page.waitForFunction(() => document.body.dataset.gfxPreset === 'high');
    await page.waitForFunction(() => /2048² shadows/.test(document.getElementById('gfx-summary').textContent) && /bloom/.test(document.getElementById('gfx-summary').textContent));
    const shadowLabel = await page.$eval('#gfx-shadows option[value="preset"]', (o) => o.textContent);
    expect(shadowLabel === 'From preset (Medium)', `shadows preset label: ${shadowLabel}`);
    expect(await page.$eval('#gfx-shadows', (s) => s.value) === 'preset', 'choosing a preset should clear overrides');
    ok(`${name}: preset High applied (${await summary(page)})`);

    // override one category: bloom off
    await page.selectOption('#gfx-bloom', 'off');
    await page.waitForFunction(() => !/bloom/.test(document.getElementById('gfx-summary').textContent));
    // keyboard: toggle the frame-rate readout with Space
    await page.focus('#gfx-fps');
    await page.keyboard.press('Space');
    await page.waitForFunction(() => { const f = document.getElementById('fps-meter'); return f && !f.hidden; });
    ok(`${name}: bloom override and frame-rate toggle applied`);
    await closeSettings(page, touch);

    // persists across reload
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.body.dataset.gfxPreset === 'high');
    await openSettings(page, touch);
    expect(await page.$eval('#gfx-preset', (s) => s.value) === 'high', 'preset not persisted');
    expect(await page.$eval('#gfx-bloom', (s) => s.value) === 'off', 'override not persisted');
    expect(await page.$eval('#gfx-fps', (c) => c.checked), 'fps toggle not persisted');
    ok(`${name}: settings survive reload`);

    // Ultra renders a round without errors; then back to Low (overrides cleared)
    await page.selectOption('#gfx-preset', 'ultra');
    await page.waitForFunction(() => document.body.dataset.gfxPreset === 'ultra');
    expect(await page.$eval('#gfx-bloom', (s) => s.value) === 'preset', 'Ultra should clear the bloom override');
    await closeSettings(page, touch);
    await press(page, '#btn-play', touch);
    await page.waitForSelector('.screen[data-name="modes"].active');
    await page.locator('#mode-list .mode-card', { hasText: 'Practice' }).click();
    await page.fill('#practice-seed', 'abc');
    await press(page, '#btn-start-round', touch);
    await page.waitForSelector('#app[data-screen="game"]');
    await page.waitForTimeout(1500);
    ok(`${name}: round renders at Ultra`);
    await press(page, '#btn-pause', touch);
    await press(page, '#btn-pause-settings', touch);
    await page.waitForSelector('.screen[data-name="settings"].active');
    await page.selectOption('#gfx-preset', 'low');
    await page.waitForFunction(() => document.body.dataset.gfxPreset === 'low');
    await page.waitForTimeout(800);
    ok(`${name}: switched to Low in-game from the pause menu`);
  } finally {
    await context.close();
  }
  if (errors.length) throw new Error(`${name}: console/page errors:\n  ${errors.join('\n  ')}`);
  ok(`${name}: no console errors or warnings`);
}

let browser;
try {
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
  });
  await pass(browser, 'desktop', { viewport: { width: 1280, height: 800 } }, false);
  await pass(browser, 'mobile', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, true);
  console.log('\nGRAPHICS E2E PASS — desktop + mobile');
} catch (e) {
  console.error('\nGRAPHICS E2E FAIL:', e.message || e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
}
