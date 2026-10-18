// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics,
// starts Practice on its largest board and keeps playing the move the Hint engine suggests by tapping
// the cells on the 3D canvas (located through the renderer's own projection, like a player) — items
// lift, slide and drop, triples clear with bursts, deliveries arrive, dust drifts and candles flicker.
// A finished round goes again with Retry.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

export async function setPreset(page, preset) {
  await page.waitForSelector('.screen[data-name="title"].active', { timeout: 30000 });
  if (!(await page.$eval('#webgl-fallback', (el) => el.classList.contains('hidden')))) await page.click('#webgl-continue');
  await page.click('#btn-settings');
  await page.waitForSelector('#gfx-preset');
  await page.selectOption('#gfx-preset', preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset);
  await page.click('.screen[data-name="settings"] button.btn.primary.back');
  await page.waitForSelector('.screen[data-name="title"].active');
}

const nextMove = (page) => page.evaluate(() => {
  const s = window.__ss.session.state;
  if (!s) return null;
  if (s.terminal) return { terminal: true };
  const h = window.SSRules.hint(s);
  if (!h) return { terminal: true };
  return { a: window.__ss.screenPos(h.from), b: window.__ss.screenPos(h.to) };
});

async function tap(page, p, mobile) {
  if (!p) return;
  if (mobile) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
}

async function step(page, mobile) {
  if (await page.locator('.screen[data-name="results"].active').count()) {
    await page.click('#btn-results-retry', { timeout: 3000 });
    return;
  }
  const m = await nextMove(page);
  if (!m || m.terminal) return;
  await tap(page, m.a, mobile);
  await page.waitForTimeout(150);
  await tap(page, m.b, mobile);
}

export async function start(page, { mobile } = {}) {
  await page.click('#btn-play');
  await page.waitForSelector('.screen[data-name="modes"].active');
  await page.click('#mode-list .mode-card[data-mode="practice"]');
  await page.waitForSelector('.screen[data-name="setup"].active');
  const last = await page.$eval('#practice-diff', (s) => s.options[s.options.length - 1].value);
  await page.selectOption('#practice-diff', last);
  await page.fill('#practice-seed', 'bench');
  await page.click('#btn-start-round');
  await page.waitForFunction(() => window.__ss.session.state && !window.__ss.session.state.terminal, null, { timeout: 15000 });
  let open = true;
  page.once('close', () => { open = false; });
  (async () => {
    while (open) {
      try { await step(page, mobile); } catch (e) { if (!open) return; if (process.env.BENCH_DEBUG) console.error(e.message); }
      await page.waitForTimeout(400).catch(() => {});
    }
  })();
  await page.waitForTimeout(1500);
}
