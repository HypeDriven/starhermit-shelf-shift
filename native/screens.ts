// The browser build's DOM shell (index.html + js/ui.js + css/style.css) as
// starhermit:ui, built every frame over the boutique: the HUD (the top bar
// with Pause, the round's name and clock, score, streak and moves; the
// Orders rail; the action tray — Undo, Hint, Skip, View; the message pill;
// the lesson banner; the visible board controls when that setting is on),
// named targets over every cell (the old board mirror's buttons: screen
// readers and play scripts find them), the toast and caption, and every
// screen (title, modes, setup, journey, learn, pause, results, settings,
// help, profile, scores). The old media queries are layouts picked by the
// window's logical size: phone portrait (≤ 700 px wide, portrait: the tray a
// bottom bar, the orders under the top bar), short landscape (≤ 500 px tall:
// the orders bottom-left, the banner a left column) and desktop (compact
// under 1024 px). The rectangle the HUD leaves uncovered (render3d.js
// safeRect) goes to main.ts (view → render.ts).
import { frame, openMenu } from "starhermit:engine";
import { bindings, requestRebind } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { Content, Rules, type Cfg, type Loc } from "./classic.ts";
import { N, S, T } from "./i18n.ts";
import * as platform from "./platform.ts";
import * as render from "./render.ts";
import { token } from "./style.ts";
import {
  app, back, canUndo, cfgName, currentScore, dailyCfg, dailyCountdownText, doHint, doUndo, eraseAll, exitLesson, fmtTime, fresh,
  invite, later, leaveRound, legalTarget, menuFromResults, nextRound, openMode, pauseRound, playerName, restartRound,
  resetCamera, resumeRound, retryRound, selected, session, setCursorTo, setPlayerName, setSetting, settings, show, showLeaderboard,
  shownName, signIn, skipAnimations, sound, startLesson, startRound, startSetup, tapCell, totalStars, view, type Screen,
} from "./main.ts";

// ------------------------------------------------------------------ layout
interface Layout { lw: number; lh: number; sc: number; ts: number; phone: boolean; land: boolean; compact: boolean; ox: number; oy: number }
function layoutNow(): Layout {
  const f = frame();
  const p = ui.preferences();
  const sc = p.scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  const land = lw > lh && lh <= 500;
  const phone = !land && lw <= 700 && lh >= lw;
  return { lw, lh, sc, ts: p.textScale, phone, land, compact: lw < 1024, ox: sa.left, oy: sa.top };
}
const lastSize = new Map<string, ui.Rect>();
const sizeOf = (id: string, sc: number): { w: number; h: number } | null => {
  const r = lastSize.get(id);
  return r ? { w: r.width / sc, h: r.height / sc } : null;
};
function textWidth(text: string, style: string, kind?: "button" | "heading"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style: [style] }).width / ui.preferences().scale;
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls = "text", id?: string): void {
  if (!text) return;
  let u = ui.style(cls);
  if (id) u = u.id(id);
  if (textWidth(text, cls) <= width) u.label(text);
  else u.paragraph(text, Math.max(20, width));
}
interface Btn {
  id: string; text: string; style?: string; act: () => void; disabled?: boolean; name?: string; selected?: boolean;
  content?: () => void; width?: number; height?: number; quiet?: boolean;
}
const buttonWidth = (text: string, style: string): number => textWidth(text, style, "button") + 2;
function button(b: Btn): void {
  const style = b.style ?? "btn";
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  if (b.selected !== undefined) opts.selected = b.selected;
  if (b.content) opts.content = b.content;
  else if (b.width != null && buttonWidth(b.text, style) > b.width) {
    // a label wider than its button wraps (labels don't)
    const inner = b.width - 34;
    const ink = style === "btn-primary" || style === "btn-big";
    opts.content = () => { ui.style(ink ? "wrap-ink" : "wrap").paragraph(b.text, Math.max(20, inner)); };
  } else if (b.name && b.name !== b.text) opts.content = () => { ui.style(style === "btn-primary" || style === "btn-big" ? "wrap-ink" : "wrap").label(b.text); };
  const s: ui.Style = {};
  if (b.width != null) s.width = b.width;
  if (b.height != null) s.height = b.height;
  if (ui.style(style, s).id(b.id).button(b.name ?? b.text, opts) && fresh()) {
    later(() => { if (!b.quiet) sound("ui"); b.act(); });
  }
}
/** Buttons at their own widths in rows that wrap at `width` (flex-wrap). */
function flow(label: string, list: Btn[], width: number, gap = 8, justify: "start" | "center" = "start"): void {
  const rows: Btn[][] = [[]];
  let used = 0;
  const bw = (b: Btn): number => Math.min(width, b.width ?? buttonWidth(b.text, b.style ?? "btn"));
  for (const b of list) {
    const w = bw(b);
    if (rows[rows.length - 1]!.length && used + gap + w > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + w;
    rows[rows.length - 1]!.push(b);
  }
  ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => {
      for (const b of row) button({ ...b, width: bw(b) });
    }, { spacing: gap, width, justify, align: "center" }));
  }, { spacing: gap, width });
}
interface Box { x: number; y: number; w: number; h: number }
const toWindow = (L: Layout, b: Box): ui.Rect => ({ x: L.ox + b.x * L.sc, y: L.oy + b.y * L.sc, width: b.w * L.sc, height: b.h * L.sc });

/** Words wrapped to `maxPx` window pixels with draw.measureText (draw.text's own wrap breaks inside words). */
function wrapLines(text: string, maxPx: number, size: number, weight?: "bold" | "600"): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && draw.measureText(next, { size, font: "sans-serif", ...(weight ? { weight } : {}) }).width > maxPx) { lines.push(cur); cur = w; }
    else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}
/**
 * A pill that takes no pointer (#hud-message, #toast, #caption had pointer-events: none): a role-"none" widget in an
 * unstyled placed column, its box and text drawn by hand. `cx` is its centre, `bottom` its bottom edge (logical).
 */
function passivePill(id: string, L: Layout, text: string, cx: number, bottom: number, maxW: number, cls: string, color: string, size: number, padX: number, padY: number, weight?: "600"): void {
  const px = size * L.sc * L.ts;
  const maxPx = (maxW - 2 * padX) * L.sc;
  const lines = wrapLines(text, maxPx, px, weight);
  const widest = Math.max(...lines.map((l) => draw.measureText(l, { size: px, font: "sans-serif", ...(weight ? { weight } : {}) }).width));
  const lineH = px * 1.25;
  const w = Math.min(maxW, widest / L.sc + 2 * padX + 2), h = (lines.length * lineH) / L.sc + 2 * padY;
  ui.place(id, { anchor: "top-start", x: cx - w / 2, y: bottom - h }, () => {
    ui.widget("", {
      role: "none", size: { width: w, height: h },
      draw: (r) => {
        draw.box(r.x, r.y, r.width, r.height, cls);
        lines.forEach((ln, i) => draw.text(ln, r.x + r.width / 2, r.y + padY * L.sc + i * lineH, { size: px, color, align: "center", font: "sans-serif", ...(weight ? { weight } : {}) }));
      },
    });
  });
}

// ------------------------------------------------------------------ the frame
export function drawScreens(): void {
  const L = layoutNow();
  const f = frame();
  const hud = hudOn();
  if (hud) hudLayer(L);
  else Object.assign(view, { x: 0, y: 0, width: f.width, height: f.height });
  if (app.screen) screenLayer(L);
  toasts(L);
  if (app.focusNext) {
    const age = f.frame - app.openedFrame;
    if (age >= 1) ui.setFocus(app.focusNext);
    if (age >= 3) app.focusNext = null;
  }
}
/** main.js setHudVisible: shown from a round's start until its results (or the title). */
function hudOn(): boolean {
  if (!session.state) return false;
  const s = app.screen;
  if (s === null) return true;
  return s === "pause" || ((s === "settings" || s === "help") && app.stack.includes("pause"));
}

// ------------------------------------------------------------------ the HUD
const TOP_H = 60;
function hudLayer(L: Layout): void {
  const s = session.state!;
  const lefty = !!settings().leftHanded;
  // --- the boxes (from last frame's measured sizes) ---
  const top: Box = { x: 0, y: 0, w: L.lw, h: TOP_H };
  const bannerOn = !!session.lesson && app.screen === null;
  const bannerSz = sizeOf("banner", L.sc);
  let banner: Box | null = null;
  if (bannerOn) {
    const bw = L.phone ? L.lw - 16 : L.land ? 200 : Math.min(520, 0.92 * L.lw);
    const bh = bannerSz?.h ?? 120;
    banner = L.phone ? { x: 8, y: 56, w: bw, h: bh } : L.land ? { x: lefty ? L.lw - 10 - bw : 10, y: 44, w: bw, h: bh } : { x: (L.lw - bw) / 2, y: 60, w: bw, h: bh };
  }
  const ordSz = sizeOf("orders", L.sc);
  const ordW = L.phone ? Math.min(0.46 * L.lw, ordSz?.w ?? 160) : L.land ? 150 : L.compact ? 170 : 210;
  const ordH = ordSz?.h ?? 120;
  let orders: Box;
  if (L.phone) orders = { x: lefty ? L.lw - 8 - ordW : 8, y: 64 + (banner ? banner.h + 8 : 0), w: ordW, h: ordH };
  else if (L.land) orders = { x: lefty ? L.lw - 10 - ordW : 10, y: L.lh - 10 - ordH, w: ordW, h: ordH };
  else orders = { x: lefty ? L.lw - 10 - ordW : 10, y: (L.lh - ordH) / 2, w: ordW, h: ordH };
  const traySz = sizeOf("tray", L.sc);
  let tray: Box;
  if (L.phone) { const h = traySz?.h ?? 64; tray = { x: 0, y: L.lh - h, w: L.lw, h }; }
  else {
    const w = traySz?.w ?? 60, h = traySz?.h ?? 220;
    tray = { x: lefty ? 10 : L.lw - 10 - w, y: (L.lh - h) / 2, w, h };
  }
  // --- the uncovered rectangle (render3d.js safeRect) ---
  const W = L.lw, H = L.lh;
  let t = 0, b = H, l = 0, r = W;
  const carve = (q: Box): void => {
    const cx = q.x + q.w / 2, cy = q.y + q.h / 2;
    if (q.w > W * 0.6) { if (cy < H / 2) t = Math.max(t, q.y + q.h); else b = Math.min(b, q.y); return; }
    if (q.h > (b - t) * 0.5 || q.w < W * 0.35) { if (cx < W / 2) l = Math.max(l, q.x + q.w); else r = Math.min(r, q.x); return; }
    if (cy < H / 2) t = Math.max(t, q.y + q.h); else b = Math.min(b, q.y);
  };
  carve({ x: 0, y: 0, w: W, h: topBarH(L) });
  carve(orders);
  carve(tray);
  if (banner) {
    if (banner.w > W * 0.45) t = Math.max(t, banner.y + banner.h);
    else if (banner.x + banner.w / 2 < W / 2) l = Math.max(l, banner.x + banner.w);
    else r = Math.min(r, banner.x);
  }
  if (r - l < W * 0.4) { l = 0; r = W; }
  if (b - t < H * 0.4) { t = Math.min(t, H * 0.3); b = Math.max(b, H * 0.7); }
  Object.assign(view, toWindow(L, { x: l, y: t, w: r - l, h: b - t }));

  // --- the widgets ---
  if (L.phone) paintTrayBand(L, tray);
  cellTargets();
  topBar(L, top, s);
  ordersRail(L, orders, s);
  actionTray(L, tray);
  if (banner) lessonBanner(L, banner);
  if (settings().boardMirror && app.screen === null) boardMirror(L, tray);
  if (app.message && app.screen === null) {
    const bottom = L.phone ? L.lh - 76 : L.lh - 18;
    passivePill("hud-message", L, app.message.text, L.lw / 2, bottom, Math.min(L.lw - 24, 560), "message", token("ink"), 16, 16, 8);
  }
  if (app.caption && app.screen === null) passivePill("caption", L, app.caption.text, L.lw / 2, L.lh - 60, Math.min(L.lw - 24, 480), "caption", "#ffffff", 14.4, 13, 5);
}
function topBarH(_L: Layout): number { return TOP_H; }
function paintTrayBand(L: Layout, tray: Box): void {
  ui.place("tray-band", { anchor: "top-start", x: 0, y: tray.y }, () => {
    ui.style("tray-band").widget("", { role: "none", size: { width: L.lw, height: tray.h } });
  });
}
/** #hud-top: Pause, the round's name and clock; score, streak, moves. */
function topBar(L: Layout, top: Box, st: NonNullable<typeof session.state>): void {
  const cfg = st.cfg;
  ui.place("hud-top", { anchor: "top-start", x: 12, y: 8 }, () => {
    ui.row("hud-left", () => {
      button({ id: "btn-pause", text: "⏸", name: T("Pause (P)"), style: "btn-icon", act: () => pauseRound(), width: 44, height: 44,
        content: () => drawPauseGlyph() });
      ui.column("hud-objective", () => {
        ui.style("hud-name").id("hud-mode-name").label(cfgName(session.cfg, session.mode));
        let timer: string, low = false;
        if (cfg.timeLimitSec) {
          const left = cfg.timeLimitSec * 1000 - session.elapsedMs;
          timer = `⏱ ${fmtTime(left)}`;
          low = left < 20000;
        } else timer = fmtTime(session.elapsedMs);
        ui.style(low ? "hud-timer-low" : "hud-timer").id("hud-timer").label(timer);
      }, { spacing: 0 });
    }, { spacing: 10, align: "center" });
  });
  const statsW = sizeOf("hud-stats", L.sc)?.w ?? 160;
  ui.place("hud-stats", { anchor: "top-start", x: L.lw - 12 - statsW, y: 8 }, () => {
    lastSize.set("hud-stats", ui.row("hud-stats-row", () => {
      ui.style("hud-stat").id("hud-score").label(String(currentScore(st)));
      if (st.streak > 1) ui.style("streak").id("hud-streak").label(`🔥 ${st.streak}`);
      ui.style("hud-stat").id("hud-moves").label(cfg.moveLimit ? T("moves {n}/{limit}", { n: st.moves, limit: cfg.moveLimit }) : T("moves {n}", { n: st.moves }));
    }, { spacing: 16, align: "center" }));
  });
  void top;
}
/** ⏸ draws thin in fonts: two bars. */
function drawPauseGlyph(): void {
  ui.widget("", {
    role: "none", size: { width: 16, height: 16 },
    draw: (r, st) => {
      const s = st.scale, bw = 3.5 * s, bh = 13 * s, y = r.y + (r.height - bh) / 2, cx = r.x + r.width / 2;
      draw.roundRect(cx - bw - 1.5 * s, y, bw, bh, 1, st.colors.text);
      draw.roundRect(cx + 1.5 * s, y, bw, bh, 1, st.colors.text);
    },
  });
}
/** #hud-orders: each order's icon, name, progress and bar. */
function ordersRail(L: Layout, box: Box, st: NonNullable<typeof session.state>): void {
  const small = L.land;
  ui.place("hud-orders", { anchor: "top-start", x: box.x, y: box.y }, () => {
    const r = ui.column("orders", () => {
      ui.style("orders-h").id("orders-h").label(T("Orders"));
      for (const ty of Object.keys(st.cfg.orders)) {
        const need = st.cfg.orders[ty]!, have = Math.min(st.orders[ty] || 0, need);
        const done = have >= need;
        const text = `${T(Content.ITEMS[ty]!.label)} ${have}/${need}`;
        ui.row(`ord-${ty}`, () => {
          ui.style("ord-icon", small ? { text: { size: 16 } } : null).label(icon(ty));
          ui.style(done ? "ord-done" : "ord-text", small ? { text: { size: 13.6 } } : null).id(`ord-${ty}-t`).label(text);
          const bar = Math.max(12, box.w - 28 - 10 - 8 - 12 - textWidth(text, done ? "ord-done" : "ord-text") - 24);
          ui.widget("", {
            role: "none", size: { width: bar, height: 6 },
            draw: (rr) => {
              draw.box(rr.x, rr.y, rr.width, rr.height, "ord-bar");
              if (have > 0) draw.box(rr.x, rr.y, (rr.width * have) / need, rr.height, "ord-fill");
            },
          });
        }, { spacing: 8, align: "center" });
      }
    }, { style: "rail", spacing: small ? 4 : 6, ...(L.phone ? {} : { width: box.w }), padding: small ? { top: 6, bottom: 6, start: 10, end: 10 } : { top: 11, bottom: 11, start: 14, end: 14 } });
    lastSize.set("orders", r);
  });
}
/** #hud-actions: Undo, Hint, Skip, View (a column at the side; a bottom bar on portrait phones). */
function actionTray(L: Layout, box: Box): void {
  const st = session.state!;
  const items: [string, string, string, string, () => void, boolean][] = [
    ["btn-undo", "↩", N("Undo"), N("Undo (U)"), doUndo, !canUndo() || session.paused],
    ["btn-hint", "💡", N("Hint"), N("Hint (H)"), doHint, !st.cfg.mechanics.hint],
    ["btn-skip", "⏩", N("Skip"), N("Skip animations (S)"), skipAnimations, false],
    ["btn-camera", "📷", N("View"), N("Reset camera (C)"), resetCamera, false],
  ];
  const tile = (it: (typeof items)[number]): void => {
    const [id, glyph, sub, name, act, disabled] = it;
    button({
      id, text: T(name), name: T(name), style: "btn-icon", act, disabled, width: L.phone ? 56 : 50, quiet: true,
      content: () => ui.column(`${id}-face`, () => {
        ui.style("btn-glyph").label(glyph);
        ui.style("btn-sub").label(T(sub));
      }, { spacing: 2, align: "center" }),
    });
  };
  if (L.phone) {
    ui.place("hud-actions", { anchor: "top-start", x: 0, y: box.y }, () => {
      const r = ui.row("tray", () => { for (const it of items) tile(it); }, { spacing: 8, width: L.lw, justify: "center", padding: { top: 6, bottom: 8, start: 8, end: 8 } });
      lastSize.set("tray", r);
    });
  } else {
    ui.place("hud-actions", { anchor: "top-start", x: box.x, y: box.y }, () => {
      const r = ui.column("tray", () => { for (const it of items) tile(it); }, { spacing: L.land ? 5.6 : 8 });
      lastSize.set("tray", r);
    });
  }
}
/** #lesson-banner: the lesson's title and text, Hide / Show and Exit lesson. */
function lessonBanner(L: Layout, box: Box): void {
  const lesson = session.lesson!;
  const title = T("Lesson {n}: {title}", { n: session.lessonIdx + 1, title: T(lesson.title) });
  const small = L.land ? 13.6 : L.phone ? 14.7 : 16;
  const pad = L.phone ? { top: 10, bottom: 10, start: 13, end: 13 } : L.land ? { top: 8, bottom: 8, start: 11, end: 11 } : { top: 14, bottom: 14, start: 18, end: 18 };
  const iw = box.w - pad.start - pad.end - 2;
  ui.place("lesson-banner", { anchor: "top-start", x: box.x, y: box.y }, () => {
    const r = ui.column("banner", () => {
      if (app.bannerCollapsed) {
        ui.row("banner-row", () => {
          para(title, iw - buttonWidth(T("Show"), "btn-ghost") - 10, "lesson-title", "lesson-title");
          button({ id: "lesson-toggle", text: T("Show"), style: "btn-ghost", act: () => { app.bannerCollapsed = false; } });
        }, { spacing: 10, align: "center", width: iw });
        return;
      }
      ui.style("lesson-title", { text: { size: small } }).id("lesson-title").paragraph(title, iw);
      ui.style("text", { text: { size: small } }).id("lesson-text").paragraph(T(lesson.text), iw);
      flow("lesson-actions", [
        { id: "lesson-toggle", text: T("Hide"), style: "btn-ghost", act: () => { app.bannerCollapsed = true; } },
        { id: "lesson-quit", text: T("Exit lesson"), style: "btn-ghost", act: exitLesson },
      ], iw, 6);
    }, { style: "lesson", width: box.w, spacing: 6, padding: pad });
    lastSize.set("banner", r);
  });
}

// ------------------------------------------------------------------ the board's cells
/** content.js's item icon; 🪴 (U+1FAB4) is not in StarHermit Emoji yet (reported): the plant shows 🌿. */
function icon(type: string): string { const i = Content.ITEMS[type]!.icon; return i === "\u{1FAB4}" ? "\u{1F33F}" : i; }
const locKey = (loc: Loc): string => (loc.area === "counter" ? `c:${loc.i}` : `s:${loc.r}:${loc.c}`);
/** The old mirror button's name: "shelf 2 cell 3: Teapot", "counter cell 1: empty — place here". */
function cellName(loc: Loc, item: string | null): string {
  const label = item ? T(Content.ITEMS[item]!.label) : T("empty");
  const pos = loc.area === "counter" ? T("counter cell {n}", { n: (loc.i ?? 0) + 1 }) : T("shelf {r} cell {c}", { r: (loc.r ?? 0) + 1, c: (loc.c ?? 0) + 1 });
  return `${pos}: ${label}${selected && !item && !Rules.locEq(loc, selected) ? ` — ${T("place here")}` : ""}`;
}
function allCells(): Loc[] {
  const s = session.state!;
  const out: Loc[] = [];
  for (let r = s.shelves.length - 1; r >= 0; r--) for (let c = 0; c < s.shelves[r]!.length; c++) out.push({ area: "shelf", r, c });
  for (let i = 0; i < s.counter.length; i++) out.push({ area: "counter", i });
  return out;
}
/** Every cell as a named target over it (the board mirror's buttons for screen readers and play scripts). */
function cellTargets(): void {
  if (app.screen || settings().boardMirror) return;
  const s = session.state!;
  for (const loc of allCells()) {
    const r = render.cellScreenRect(loc);
    if (!r || r.width <= 0) continue;
    ui.id(`cell-${locKey(loc)}`).target(cellName(loc, Rules.getCell(s, loc)), r, { role: "button" });
  }
}
/** #board-mirror (Settings › Visible board controls): the board as buttons above the tray. */
function boardMirror(L: Layout, tray: Box): void {
  const s = session.state!;
  const rows: { label: string; cells: Loc[] }[] = [];
  for (let r = s.shelves.length - 1; r >= 0; r--) rows.push({ label: T("Shelf {n}", { n: r + 1 }), cells: s.shelves[r]!.map((_, c) => ({ area: "shelf", r, c } as Loc)) });
  rows.push({ label: T("Counter"), cells: s.counter.map((_, i) => ({ area: "counter", i } as Loc)) });
  // .visible-mode: in the page's flow at the top, centred (portrait phones: docked above the tray)
  const h = sizeOf("mirror", L.sc)?.h ?? 0, w = sizeOf("mirror", L.sc)?.w ?? 0;
  const y = L.phone ? tray.y - 8 - h : 16;
  ui.place("board-mirror", { anchor: "top-start", x: Math.max(8, (L.lw - w) / 2), y }, () => {
    const r = ui.column("mirror", () => {
      for (const row of rows) {
        ui.row(`mirror-${row.label}`, () => {
          ui.style("mirror-label", { width: 66 }).label(row.label);
          for (const loc of row.cells) {
            const item = Rules.getCell(s, loc);
            const sel = !!selected && Rules.locEq(loc, selected);
            const ok = !!selected && legalTarget(loc);
            const name = cellName(loc, item);
            const res = ui.style(ok ? "cell-ok" : "cell-btn").id(`mirror-${locKey(loc)}`).button(name, {
              selected: sel, content: () => ui.style("cell-text").label(item ? icon(item) : "·"),
            });
            if (res && fresh()) later(() => tapCell(loc));
            if (ui.focused() === name) later(() => setCursorTo(loc));
          }
        }, { spacing: 6, align: "center" });
      }
    }, { style: "mirror", spacing: 6, padding: 10 });
    lastSize.set("mirror", r);
  });
}

// ------------------------------------------------------------------ toasts
function toasts(L: Layout): void {
  const t = app.toasts[0];
  if (!t) return;
  passivePill("toast", L, t.text, L.lw / 2, L.lh - 90, Math.min(L.lw - 32, 520), "toast", token("primary-ink"), 16, 18, 8, "600");
}

// ------------------------------------------------------------------ screens
/** Panels: .panel (560), .panel.wide (760); overlays (pause, results, settings, help) dim the round behind them. */
const WIDE: Partial<Record<Screen, boolean>> = { journey: true, settings: true, help: true, profile: true, leaderboard: true };
const OVERLAY: Partial<Record<Screen, boolean>> = { pause: true, results: true, settings: true, help: true };
function screenLayer(L: Layout): void {
  const s = app.screen!;
  if (s === "title") { titleCard(L); return; }
  const w = Math.min(WIDE[s] ? 760 : 560, (WIDE[s] ? 0.94 : 0.92) * L.lw);
  const pad = L.land ? 14 : 20;
  const inner = w - 2 * pad - 2;
  const maxH = (L.phone ? 0.82 : 0.88) * L.lh - 2;
  const key = `panel-${s}`;
  const prev = lastSize.get(key);
  const scroll = !!prev && prev.height / L.sc + 2 * pad + 2 > maxH;
  const opening = frame().frame - app.openedFrame <= 6;
  const footer = footerOf(s);
  const footH = footer ? (sizeOf(`${key}-foot`, L.sc)?.h ?? 52) + 12 : 0;
  const isOpen = ui.style(OVERLAY[s] ? "" : "dialog-clear").dialog(panelLabel(s), "", true, () => {
    ui.column("panel", () => {
      const iw = inner - (scroll ? 14 : 0);
      const body = (): void => { lastSize.set(key, ui.column(`${key}-in`, () => buildPanel(s, iw, L), { spacing: 12, width: iw })); };
      if (scroll) ui.scrollArea(`${key}-scroll`, { width: inner + 2, height: maxH - 2 * pad - footH }, body, opening ? { scrollTo: { top: 0 } } : undefined);
      else body();
      if (footer) lastSize.set(`${key}-foot`, ui.column(`${key}-foot`, () => footer(inner), { width: inner, spacing: 8 }));
    }, { style: "panel", width: w, spacing: 12, padding: pad });
  });
  if (!isOpen && fresh()) {
    // Escape / the backdrop: back (pause resumes; the results stay)
    if (s === "pause") later(resumeRound);
    else if (s !== "results") later(back);
  }
}
function panelLabel(s: Screen): string {
  switch (s) {
    case "modes": return T("Choose a mode");
    case "setup": return cfgName(null, app.setupMode);
    case "journey": return T("Journey");
    case "pause": return T("Paused");
    case "results": return T("Round over");
    case "settings": return T("Settings");
    case "help": return T("How to play");
    case "profile": return T("Profile");
    case "leaderboard": return T("Scores");
    case "learn": return T("Learn");
    default: return "Shelf Shift";
  }
}
/** Buttons kept under a scrolling body (out-of-view widgets are out of reach). */
function footerOf(s: Screen): ((w: number) => void) | null {
  switch (s) {
    case "settings": case "help": return (w) => button({ id: "btn-back", text: T("Done"), style: "btn-primary", act: back, width: Math.min(w, buttonWidth(T("Done"), "btn-primary")) });
    case "modes": case "journey": case "profile": case "leaderboard": case "learn":
      return (w) => button({ id: "btn-back", text: T("← Back"), style: "btn-ghost", act: back, width: Math.min(w, buttonWidth(T("← Back"), "btn-ghost")) });
    case "setup": return (w) => flow("setup-foot", [
      { id: "btn-start-round", text: T("Start"), style: "btn-primary", act: startSetup },
      { id: "btn-back", text: T("← Back"), style: "btn-ghost", act: back },
    ], w, 10);
    case "results": return (w) => {
      const r = app.results!;
      const list: Btn[] = [];
      if (r.nextCfg) list.push({ id: "btn-results-next", text: T("Next"), style: "btn-primary", act: nextRound });
      list.push({ id: "btn-results-retry", text: T("Retry"), act: retryRound });
      list.push({ id: "btn-results-menu", text: T("Menu"), style: "btn-ghost", act: menuFromResults });
      flow("results-foot", list, w, 10);
    };
    default: return null;
  }
}
function buildPanel(s: Screen, w: number, L: Layout): void {
  switch (s) {
    case "modes": modesPanel(w); break;
    case "setup": setupPanel(w); break;
    case "journey": journeyPanel(w); break;
    case "learn": learnPanel(w); break;
    case "pause": pausePanel(w); break;
    case "results": resultsPanel(w); break;
    case "settings": settingsPanel(w); break;
    case "help": helpPanel(w); break;
    case "profile": profilePanel(w); break;
    case "leaderboard": leaderboardPanel(w, L); break;
    default: break;
  }
}

/** .title-card: the name, tagline, account line, Play, the mode shortcuts. */
function titleCard(L: Layout): void {
  const w = Math.min(L.lw - 24, 640);
  const syncText = syncLine();
  const player = platform.signedIn() ? T("Playing as {name}", { name: platform.displayName() || T("Player") }) : null;
  const status = [player, syncText].filter(Boolean).join(" · ");
  const done = Object.keys(platform.save().progress.journeyStars).length;
  const h = sizeOf("title-card", L.sc)?.h ?? 400;
  ui.place("title", { anchor: "top-start", x: (L.lw - w) / 2, y: Math.max(12, (L.lh - h) / 2) }, () => {
    const r = ui.column("title-card", () => {
      const size = Math.min(72, Math.max(38.4, 0.08 * L.lw));
      ui.style("h1", { text: { size } }).id("title-h").label("Shelf Shift");
      ui.style("tagline").id("tagline").paragraph(T("A cozy boutique sorting puzzle"), Math.min(w, 560));
      if (status) para(status, w, "mini", "platform-status");
      const acct: Btn[] = [];
      if (!platform.signedIn()) acct.push({ id: "btn-signin", text: S("signIn"), style: "btn-ghost", act: signIn });
      if (platform.inviteLink()) acct.push({ id: "btn-invite", text: S("invite"), style: "btn-ghost", act: invite });
      if (acct.length) flow("title-account", acct, w, 10, "center");
      button({ id: "btn-play", text: T("Play"), style: "btn-big", act: () => show("modes") });
      const sub = (id: string, main: string, mini: string, act: () => void): Btn => ({
        id, text: mini ? `${main} ${mini}` : main, name: main, act,
        content: () => ui.row(`${id}-face`, () => { ui.style("text").label(main); if (mini) ui.style("mini").label(mini); }, { spacing: 6, align: "center" }),
      });
      flow("title-secondary", [
        sub("btn-daily", T("Daily challenge"), dailyCountdownText(), () => openMode("daily")),
        sub("btn-journey", T("Journey"), done ? `${done}/40` : "", () => openMode("journey")),
        { id: "btn-profile", text: T("Profile"), act: () => show("profile") },
      ], w, 10, "center");
      flow("title-tertiary", [
        { id: "btn-help", text: T("How to play"), style: "btn-ghost", act: () => show("help") },
        { id: "btn-settings", text: T("Settings"), style: "btn-ghost", act: () => show("settings") },
        { id: "btn-leaderboard", text: T("Scores"), style: "btn-ghost", act: () => showLeaderboard("endless") },
      ], w, 6, "center");
    }, { width: w, spacing: 14, align: "center" });
    lastSize.set("title-card", r);
  });
}
function syncLine(): string | null {
  switch (platform.syncState()) {
    case "synced": return T("Cloud save synced");
    case "saving": return T("Cloud saving…");
    case "connecting": return T("Cloud connecting…");
    case "error": return T("Cloud sync error — local copy safe");
    default: return null;
  }
}

const MODES: [string, string, string][] = [
  ["learn", N("Learn"), N("Interactive lessons — one rule at a time. ~2 minutes.")],
  ["journey", N("Journey"), N("40 authored stages with rising stakes and mastery tests.")],
  ["daily", N("Daily"), N("One shared seed per UTC day. Compare scores worldwide.")],
  ["practice", N("Practice"), N("Relaxed play with undo and hints. Never ranked.")],
  ["challenge", N("Challenge"), N("Move limits, speed targets, tight counters.")],
  ["score", N("Score chase"), N("Endless counter — play until it overflows. Ranked.")],
];
function card(id: string, title: string, desc: string, w: number, act: () => void): void {
  const iw = w - 34;
  button({
    id, text: title, name: title, style: "btn-mode", width: w, act,
    content: () => ui.column(`${id}-face`, () => {
      ui.style("mode-name").label(title);
      para(desc, iw, "mini");
    }, { spacing: 2, width: iw }),
  });
}
function modesPanel(w: number): void {
  para(T("Choose a mode"), w, "h2", "modes-h");
  ui.column("mode-list", () => { for (const [id, name, desc] of MODES) card(`mode-${id}`, T(name), T(desc), w, () => openMode(id)); }, { spacing: 10, width: w });
}

/** ui.js rulesLine. */
function rulesLine(cfg: Cfg): string {
  const bits = [T("{shelves}×{cols} shelves", { shelves: cfg.board.shelves, cols: cfg.board.cols }), T("{n} staging cells", { n: cfg.board.counter })];
  if (cfg.delivery) {
    const every = T(cfg.delivery.every > 1 ? "delivery every {n} moves" : "delivery every move", { n: cfg.delivery.every });
    bits.push(every + (cfg.delivery.per > 1 ? ` ×${cfg.delivery.per}` : ""));
  }
  if (cfg.moveLimit) bits.push(T("{n} move limit", { n: cfg.moveLimit }));
  if (cfg.timeLimitSec) bits.push(T("{time} time limit", { time: fmtTime(cfg.timeLimitSec * 1000) }));
  if (!cfg.mechanics.undo) bits.push(T("no undo"));
  if (!cfg.mechanics.hint) bits.push(T("no hints"));
  return bits.join(" · ");
}
/** A labelled control on one row (#setup-body > label). */
function fieldRow(id: string, label: string, w: number, control: (cw: number) => void): void {
  ui.row(`${id}-row`, () => {
    para(label, w * 0.4, "text", `${id}-label`);
    ui.spacer();
    control(Math.min(w * 0.55, 300));
  }, { width: w, align: "center", spacing: 10, height: 48 });
}
function selectRow(id: string, label: string, w: number, index: number, options: string[], set: (i: number) => void, disabled?: (i: number) => boolean): void {
  fieldRow(id, label, w, (cw) => {
    const opts = options.map((o, i) => (disabled?.(i) ? { text: o, disabled: true } : o)) as (string | ui.SelectOption)[];
    const pick = ui.id(id).select(label, index, opts, { width: cw } as ui.WidgetOptions);
    if (pick !== index) later(() => set(pick));
  });
}
function themeLabel(i: number): string {
  const t = Content.THEMES[i]!;
  const locked = totalStars() < t.unlockStars;
  return T(t.name) + (locked ? ` 🔒 ${t.unlockStars}★` : "");
}
function setupPanel(w: number): void {
  const C = Content;
  const mode = app.setupMode;
  para(cfgName(null, mode), w, "h2", "setup-h");
  if (mode === "practice") {
    para(T("Relaxed play. Undo and hints allowed; results are never ranked."), w, "text", "setup-intro");
    selectRow("practice-diff", T("Difficulty"), w, app.setup.practice, C.PRACTICE.map((p) => T(p.name)), (i) => { app.setup.practice = i; });
    fieldRow("practice-seed", T("Seed (optional)"), w, (cw) => {
      app.setup.practiceSeed = ui.textField("practice-seed", app.setup.practiceSeed, { width: cw, placeholder: T("random"), maxChars: 64 });
    });
    const stars = totalStars();
    selectRow("setup-theme", T("Theme"), w, app.setup.theme, C.THEMES.map((_, i) => themeLabel(i)), (i) => {
      app.setup.theme = i;
      setSetting("theme", C.THEMES[i]!.id);
    }, (i) => stars < C.THEMES[i]!.unlockStars);
    para(rulesLine(C.PRACTICE[app.setup.practice]!), w, "mini", "setup-rules");
  } else if (mode === "daily") {
    const cfg = dailyCfg();
    para(T("{name} — one shared seed for everyone today. Ranked.", { name: cfgName(cfg) }), w, "text", "setup-intro");
    para(rulesLine(cfg), w, "mini", "setup-rules");
    para(T("Seed {seed} · content v{version}", { seed: cfg.seed, version: cfg.version }), w, "mini", "setup-seed");
    const done = platform.save().progress.dailiesDone[cfg.date];
    if (done != null) para(T("Completed today: {n} points. You can replay to improve.", { n: done }), w, "text", "setup-done");
  } else if (mode === "challenge") {
    selectRow("challenge-pick", T("Challenge"), w, app.setup.challenge, C.CHALLENGES.map((c) => T(c.name)), (i) => { app.setup.challenge = i; });
    const c = C.CHALLENGES[app.setup.challenge]!;
    para((c.intro ? `${T(c.intro)} — ` : "") + rulesLine(c), w, "mini", "setup-rules");
    const best = platform.save().progress.challengeBest[c.id];
    para(best ? T("Your best: {n}", { n: best }) : T("Ranked."), w, "mini", "setup-best");
  } else if (mode === "score") {
    const c = C.SCORE_CHASE;
    para(`${T(c.name)}: ${T(c.intro ?? "")}`, w, "text", "setup-intro");
    para(rulesLine(c), w, "mini", "setup-rules");
    fieldRow("score-seed", T("Seed (share to challenge others)"), w, (cw) => {
      app.setup.scoreSeed = ui.textField("score-seed", app.setup.scoreSeed, { width: cw, placeholder: T("random"), maxChars: 64 });
    });
    para(T("Ranked · submissions verified by replaying your input log."), w, "mini", "setup-ranked");
  }
}

function journeyPanel(w: number): void {
  const prog = platform.save().progress;
  const J = Content.JOURNEY;
  para(T("Journey"), w, "h2", "journey-h");
  para(T("{n} / {total} stars", { n: totalStars(), total: J.length * 3 }), w, "mini", "journey-stars-total");
  const gap = 8, min = 64;
  const cols = Math.max(1, Math.floor((w + gap) / (min + gap)));
  const cw = (w - (cols - 1) * gap) / cols;
  ui.column("journey-grid", () => {
    for (let r = 0; r * cols < J.length; r++) {
      ui.row(`journey-grid-r${r}`, () => {
        for (let i = r * cols; i < Math.min(J.length, (r + 1) * cols); i++) {
          const lvl = J[i]!;
          const stars = prog.journeyStars[lvl.id] || 0;
          const unlocked = i === 0 || (prog.journeyStars[J[i - 1]!.id] || 0) > 0;
          const name = (unlocked ? T("Stage {n}: {name}, {stars} stars", { n: i + 1, name: T(lvl.name ?? ""), stars }) : T("Stage {n}: {name}, locked", { n: i + 1, name: T(lvl.name ?? "") })) + (lvl.mastery ? ` — ${T("Mastery stage")}` : "");
          button({
            id: `stage-${i + 1}`, text: name, name, style: lvl.mastery ? "level-mastery" : "level-cell", width: cw, height: cw, disabled: !unlocked,
            act: () => startRound(lvl),
            content: () => ui.column(`stage-${i + 1}-face`, () => {
              ui.style("lvl-num").label(String(i + 1));
              ui.style("lvl-stars").label("★".repeat(stars) + "☆".repeat(Math.max(0, 3 - stars)));
            }, { spacing: 0, align: "center" }),
          });
        }
      }, { spacing: gap });
    }
  }, { spacing: gap, width: w });
}

function learnPanel(w: number): void {
  const done = platform.save().progress.tutorialDone;
  para(T("Learn"), w, "h2", "learn-h");
  ui.column("lesson-list", () => {
    Content.tutorialLessons().forEach((l, i) => card(`lesson-${i + 1}`, `${done[l.id] ? "✓ " : ""}${i + 1}. ${T(l.title)}`, `${T(l.text).slice(0, 80)}…`, w, () => startLesson(i)));
  }, { spacing: 10, width: w });
  para(T("Lessons use the same legal-action rules as real play."), w, "mini", "learn-note");
}

function pausePanel(w: number): void {
  para(T("Paused"), w, "h2", "pause-h");
  button({ id: "btn-resume", text: T("Resume"), style: "btn-big", act: resumeRound });
  ui.column("pause-stack", () => {
    button({ id: "btn-pause-settings", text: T("Settings"), width: w, act: () => show("settings") });
    button({ id: "btn-pause-help", text: T("Help"), width: w, act: () => show("help") });
    button({ id: "btn-restart", text: T("Restart round"), width: w, act: restartRound });
    button({ id: "btn-leave", text: T("Leave round"), style: "btn-danger", width: w, act: leaveRound });
  }, { spacing: 10, width: w });
}

const WON: Record<string, string> = { "orders-complete": N("Orders complete!") };
const LOST: Record<string, string> = {
  "staging-overflow": N("The counter overflowed!"), "move-limit": N("Out of moves!"), "time-up": N("Time ran out!"), resigned: N("Round resigned."),
};
function resultsPanel(w: number): void {
  const r = app.results;
  if (!r) return;
  para(T("Round over"), w, "h2", "results-h");
  para(T(r.won ? (WON[r.reason] || "Stage complete!") : (LOST[r.reason] || "Round over")), w, "headline", "results-headline");
  const rows: [string, string, string, number][] = [
    ["clears", N("Triples cleared"), `${r.score.clears} × `, r.score.clearPoints],
    ["orders", N("Orders completed"), "", r.score.orderBonus],
    ["capacity", N("Spare capacity"), "", r.score.capacityBonus],
    ["moves", N("Move bonus"), r.cfg.par && r.cfg.par.moves ? T("par {n}", { n: r.cfg.par.moves }) : "", r.score.moveBonus],
    ["time", N("Time bonus"), "", r.score.timeBonus],
  ];
  if (r.cfg.endless) rows.push(["waves", N("Order waves finished"), "", r.score.rounds]);
  const numW = 70, noteW = 90;
  ui.column("results-table", () => {
    for (const [key, label, note, val] of rows) {
      if (!val && key !== "clears") continue;
      ui.row(`res-${key}`, () => {
        para(T(label), w - numW - noteW - 30, "text", `res-${key}-k`);
        ui.spacer();
        if (note) ui.style("mini", { width: noteW, text: { align: "end" } }).label(note);
        ui.style("num", { width: numW }).id(`res-${key}-v`).label(String(val));
      }, { style: "row-line", width: w, align: "center", spacing: 8 });
    }
    ui.row("res-total", () => {
      ui.style("total").label(T("Total"));
      ui.spacer();
      ui.style("num-total", { width: numW }).id("res-total-v").label(String(r.score.total));
    }, { style: "row-total", width: w, align: "center" });
  }, { spacing: 0, width: w });
  if (r.stars) ui.style("stars").id("results-stars").label("★".repeat(r.stars) + "☆".repeat(3 - r.stars));
  if (r.newAchievements.length) {
    ui.column("results-achievements", () => {
      r.newAchievements.forEach((a, i) => ui.column(`res-ach-${i}`, () => para(`🏆 ${T(a.name)} — ${T(a.desc)}`, w - 22, "text"), { style: "ach", width: w }));
    }, { spacing: 5, width: w });
  }
  const compare = [
    r.lbRank != null ? T("Local board rank #{n}", { n: r.lbRank + 1 }) : null,
    r.bestImproved ? T("New personal best!") : null,
    r.verified === true ? T("Score verified by replay.") : r.verified === false ? T("Score could not be verified (casual).") : null,
  ].filter(Boolean).join(" · ");
  if (compare) para(compare, w, "mini", "results-compare");
  const lb = r.lb;
  if (lb) para(lb === "posting" ? S("lbPosting") : !lb.posted ? S("lbNotPosted") : lb.rank ? S("lbRank", { rank: lb.rank }) : S("lbPosted"), w, "mini", "results-lb");
}

/** A check box row (#settings-form label + checkbox; a role "checkbox" widget: built-in check box labels don't wrap). */
function toggleRow(id: string, label: string, on: boolean, w: number, set: (v: boolean) => void): void {
  ui.row(`${id}-row`, () => {
    para(label, w - 60, "text", `${id}-label`);
    ui.spacer();
    const res = ui.id(id).widget(label, {
      role: "checkbox", checked: on, size: { width: 44, height: 44 },
      draw: (r, st) => {
        const s = st.scale, box = 22 * s, bx = r.x + (r.width - box) / 2, by = r.y + (r.height - box) / 2;
        draw.roundRect(bx, by, box, box, 4, on ? token("accent-2") : token("panel-2"));
        draw.strokeRoundRect(bx, by, box, box, 4, on ? token("accent-2") : "#ffffff66", 2);
        if (on) draw.text("✓", bx + box / 2, by + 1 * s, { size: 17 * s, color: token("primary-ink"), align: "center", weight: "bold" });
      },
    });
    if (res.activated && fresh()) later(() => set(!on));
  }, { width: w, align: "center", spacing: 8, height: 46 });
}
function fieldset(id: string, legend: string, w: number, build: (iw: number) => void): void {
  ui.column(id, () => { para(legend, w - 28, "legend", `${id}-legend`); build(w - 28); }, { style: "fieldset", width: w, spacing: 6 });
}
function settingsPanel(w: number): void {
  const s = settings();
  para(T("Settings"), w, "h2", "settings-h");
  fieldset("set-audio", T("Audio"), w, (iw) => {
    para(T("Music, effects and mute, graphics quality, language, larger text, high contrast and reduced motion are in the StarHermit Options."), iw, "mini", "options-note");
    button({ id: "btn-options", text: T("Open Options"), act: () => openMenu(), width: Math.min(iw, buttonWidth(T("Open Options"), "btn")) });
    toggleRow("set-captions", T("Captions for audio cues"), !!s.captions, iw, (v) => setSetting("captions", v));
  });
  fieldset("set-graphics", T("Graphics"), w, (iw) => {
    selectRow("set-palette", T("Color palette"), iw, s.colorPalette === "high-visibility" ? 1 : 0, [T("Standard"), T("High visibility")],
      (i) => setSetting("colorPalette", i === 1 ? "high-visibility" : "standard"));
  });
  fieldset("set-a11y", T("Accessibility"), w, (iw) => {
    toggleRow("set-left", T("Left-handed controls"), !!s.leftHanded, iw, (v) => setSetting("leftHanded", v));
    toggleRow("set-mirror", T("Visible board controls (DOM)"), !!s.boardMirror, iw, (v) => setSetting("boardMirror", v));
    toggleRow("set-confirm", T("Confirm moves (tap target twice)"), !!s.confirmMoves, iw, (v) => setSetting("confirmMoves", v));
    toggleRow("set-haptics", T("Haptics"), !!s.haptics, iw, (v) => setSetting("haptics", v));
    selectRow("set-select-style", T("Selection style"), iw, s.holdToDrag === "hold" ? 1 : 0, [T("Tap to select"), T("Hold and drag")],
      (i) => setSetting("holdToDrag", i === 1 ? "hold" : "tap"));
  });
  fieldset("set-controls", T("Controls"), w, (iw) => {
    para(T("Keys and gamepad buttons are rebound in the StarHermit Options."), iw, "mini", "controls-note");
    button({ id: "btn-rebind", text: T("Key bindings"), act: () => requestRebind(), width: Math.min(iw, buttonWidth(T("Key bindings"), "btn")) });
  });
  fieldset("set-data", T("Data"), w, (iw) => {
    if (!app.confirmErase) {
      button({ id: "btn-erase", text: T("Erase all local progress"), style: "btn-danger", width: Math.min(iw, buttonWidth(T("Erase all local progress"), "btn-danger")), act: () => { app.confirmErase = true; } });
      return;
    }
    para(T("Erase ALL local progress, settings, and scores?"), iw, "text", "erase-q");
    flow("erase-row", [
      { id: "btn-erase-yes", text: T("Erase"), style: "btn-danger", act: () => { app.confirmErase = false; eraseAll(); } },
      { id: "btn-erase-no", text: T("Cancel"), style: "btn-ghost", act: () => { app.confirmErase = false; } },
    ], iw, 8);
  });
}

const GLYPH: Record<string, string> = { "Arrow Up": "Up", "Arrow Down": "Down", "Arrow Left": "Left", "Arrow Right": "Right" };
function keysFor(action: string, device: "keyboard" | "gamepad" = "keyboard"): string {
  let list: string[] = [];
  try { list = bindings(action).filter((b) => b.device === device).map((b) => GLYPH[b.label] ?? b.label); } catch { /* not yet */ }
  return [...new Set(list)].join("/");
}
function helpPanel(w: number): void {
  const s = settings();
  const k = (a: string): string => keysFor(a);
  const pad = (a: string): string => keysFor(a, "gamepad") || T("default");
  const cards: [string, string][] = [
    [T("Goal"), T("Fill every order shown on the left. Orders ask for sets of three identical objects.")],
    [T("Moving"), T(s.holdToDrag === "hold" ? N("Hold an object, drag it onto a glowing empty cell, and release.") : N("Tap an object to lift it, then tap any glowing empty cell to place it."))],
    [T("Triples"), T("Three identical objects on the same shelf row clear away and count toward orders.")],
    [T("The counter"), T("New stock arrives on the front counter. If a delivery finds no free staging cell, the round is lost.")],
    [T("Scoring"), T("Triples score 100 points plus streak bonuses. Winning adds bonuses for spare space, speed, and staying under par.")],
    [T("Keyboard"), T("{arrows} move the focus ring · {confirm} select/place · {cancel} cancel · {undo} undo · {hint} hint · {camera} camera · {pause} pause · {skip} skip animations.", {
      arrows: ["up", "down", "left", "right"].map(k).join(" "), confirm: k("confirm"), cancel: k("cancel"), undo: k("undo"),
      hint: k("hint"), camera: k("camera"), pause: k("pause"), skip: k("skip"),
    })],
    [T("Gamepad"), T("Stick or D-pad moves focus · {confirm} confirm · {cancel} cancel · {pause} pause · {undo} undo.", {
      confirm: pad("confirm"), cancel: pad("cancel"), pause: pad("pause"), undo: pad("undo"),
    })],
  ];
  para(T("How to play"), w, "h2", "help-h");
  ui.column("help-body", () => {
    cards.forEach(([title, body], i) => ui.column(`help-${i}`, () => {
      para(title, w, "h3", `help-${i}-h`);
      para(body, Math.min(w, 620), "text", `help-${i}-p`);
    }, { style: "help-card", width: w, spacing: 4 }));
  }, { spacing: 0, width: w });
}

function statGrid(id: string, list: [string, string | number][], w: number): void {
  const gap = 10, min = 130;
  const cols = Math.max(1, Math.min(list.length, Math.floor((w + gap) / (min + gap))));
  const cw = (w - (cols - 1) * gap) / cols;
  ui.column(id, () => {
    for (let r = 0; r * cols < list.length; r++) {
      ui.row(`${id}-r${r}`, () => {
        for (let i = r * cols; i < Math.min(list.length, (r + 1) * cols); i++) {
          const [label, val] = list[i]!;
          ui.column(`${id}-${i}`, () => {
            ui.style("stat-b").label(String(val));
            para(label, cw - 20, "mini");
          }, { style: "stat", width: cw, spacing: 2 });
        }
      }, { spacing: gap });
    }
  }, { spacing: gap, width: w });
}
function profilePanel(w: number): void {
  const p = platform.save().progress;
  const st = p.stats;
  para(T("Profile"), w, "h2", "profile-h");
  if (platform.signedIn()) {
    statGrid("account", [[T("Account"), platform.displayName() || T("Player")], [T("Cloud save"), syncLine() || "—"]], w);
  } else {
    fieldRow("profile-name", T("Display name"), w, (cw) => {
      const cur = playerName();
      const next = ui.textField("profile-name", cur, { width: cw, maxChars: 24 });
      if (next !== cur) setPlayerName(next);
    });
  }
  statGrid("stats", [
    [T("Rounds"), st.rounds], [T("Wins"), st.wins], [T("Triples"), st.clears], [T("Items cleared"), st.itemsCleared],
    [T("Best streak"), st.bestStreak], [T("Journey stars"), totalStars()], [T("Play time"), fmtTime(st.playMs)],
  ], w);
  para(T("Achievements"), w, "h3", "ach-h");
  ui.column("achievements", () => {
    for (const a of Content.ACHIEVEMENTS) {
      const got = !!p.achievements[a.key];
      ui.column(`ach-${a.key}`, () => para(`${got ? "🏆 " : "□ "}${T(a.name)} — ${T(a.desc)}`, w - 22, got ? "text" : "mini"), { style: "ach", width: w });
    }
  }, { spacing: 5, width: w });
  para(T("Themes"), w, "h3", "themes-h");
  const stars = totalStars();
  flow("themes", Content.THEMES.map((t, i) => ({
    id: `theme-${t.id}`, text: themeLabel(i), style: settings().theme === t.id ? "btn-primary" : "btn",
    disabled: stars < t.unlockStars, act: () => setSetting("theme", t.id),
  })), w, 8);
}

function leaderboardPanel(w: number, L: Layout): void {
  para(T("Scores"), w, "h2", "lb-h");
  const tabs: [string, string][] = [["endless", N("Score chase")], ["daily", N("Daily")], ["challenge", N("Challenges")]];
  flow("lb-tabs", tabs.map(([id, name]) => ({ id: `lb-tab-${id}`, text: T(name), style: app.lbTab === id ? "btn-primary" : "btn", act: () => showLeaderboard(id) })), w, 6);
  para(T("Entries carry ruleset, content version, seed, assists, and duration. Verified entries replay cleanly."), w, "mini", "lb-note");
  const entries = platform.localEntries(app.lbTab);
  const narrow = w < 480 || L.phone;
  const cols = narrow ? [28, 0, 70] : [34, 0, 92, 0, 70];
  const flexW = w - cols.reduce((a, b) => a + b, 0) - (cols.length - 1) * 8 - 8;
  const widths = narrow ? [28, flexW, 70] : [34, flexW * 0.45, 92, flexW * 0.55, 70];
  const rowOf = (id: string, cells: [string, string][], cls: string): void => {
    ui.row(id, () => {
      cells.forEach(([text, style], i) => ui.style(style, { width: widths[i]!, text: { overflow: "ellipsis", ...(i === cells.length - 1 ? { align: "end" as const } : {}) } }).label(text));
    }, { style: cls, width: w, spacing: 8, align: "center" });
  };
  ui.column("lb-table", () => {
    rowOf("lb-head", narrow ? [["#", "mini"], [T("Player"), "mini"], [T("Score"), "mini"]] : [["#", "mini"], [T("Player"), "mini"], [T("When"), "mini"], [T("Meta"), "mini"], [T("Score"), "mini"]], "row-line");
    entries.forEach((e, i) => {
      const who = shownName(e.name) + (e.verified ? " ✓" : "") + (e.assists ? ` ${T("(assists)")}` : "");
      const meta = `${e.ruleset || ""} · ${T("seed {seed}", { seed: e.seed })} · ${fmtTime(e.durationMs || 0)}`;
      const txt = e.mine ? "me-text" : "text";
      rowOf(`lb-${i}`, narrow ? [[String(i + 1), txt], [who, txt], [String(e.score), txt]]
        : [[String(i + 1), txt], [who, txt], [e.date, "mini"], [meta, "mini"], [String(e.score), txt]], e.mine ? "row-me" : "row-line");
    });
  }, { spacing: 0, width: w });
  if (!entries.length) para(T("No entries yet — be the first."), w, "mini", "lb-empty");
  const plat = app.lbPlatform;
  if (app.lbTab === "endless" && plat && plat.length) {
    para(T("Platform rankings"), w, "h3", "lb-platform-h");
    para(T("Global board hosted by StarHermit — read-only. Your ranked runs submit to the game backend for replay verification."), w, "mini", "lb-platform-note");
    ui.column("lb-platform", () => {
      plat.forEach((e, i) => ui.row(`lbp-${i}`, () => {
        ui.style("text", { width: 34 }).label(String(i + 1));
        ui.style("text", { text: { overflow: "ellipsis" } }).label(e.name);
        ui.spacer();
        ui.style("num", { width: 80 }).label(String(e.score));
      }, { style: "row-line", width: w, spacing: 8, align: "center" }));
    }, { spacing: 0, width: w });
  }
}

