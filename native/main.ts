// Shelf Shift on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules (js/rules.js), content
// (js/content.js) and save model (js/store.js) are the browser build's,
// unchanged; this module is what js/main.js did around them — the screen
// flow (title → modes / setup / journey / learn / profile / scores / help /
// settings → the round ⇄ pause → results), starting every mode (Learn,
// Journey, Daily, Practice, Challenge, Score chase), moving objects by keys,
// pads, pointer, touch and drags, undo, the hint, the five lessons with their
// banner, the results with stars, achievements, the local score boards and
// the platform score post, and the lifecycle (a hidden window pauses the
// round and resumes it on return, as visibilitychange did). Screens are drawn
// by screens.ts (starhermit:ui), the boutique by render.ts (starhermit:scene).
//
// Time is the runtime's fixed steps: the round clock, the message, toast and
// caption timers, the lesson hand-offs and the results' short wait run on a
// clock advanced 1/60 s per fixed step (the browser build used
// performance.now and setTimeout), so slow frames never change a round and
// play scripts replay exactly.
import { clipboard, frame, onFixedUpdate, onPreferencesChange, onRender, onResume, onStart, onSuspend, onUpdate, preferences, setFixedRate } from "starhermit:engine";
import { onAction, onPointerButton, onPointerMove, onTouch, primaryPointer, vibrate } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onSessionEnded, requestSignIn } from "starhermit:platform";
import { Content, RNG, Rules, type Achievement, type BoardEntry, type Cfg, type Command, type GameEvent, type Lesson, type Loc, type Score, type Settings, type State } from "./classic.ts";
import * as audio from "./audio.ts";
import { N, S, T } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens } from "./screens.ts";
import { applyTokens, initStyles } from "./style.ts";

export type Screen = "title" | "modes" | "setup" | "journey" | "pause" | "results" | "settings" | "help" | "profile" | "leaderboard" | "learn";
export interface Results {
  won: boolean; reason: string; score: Score; moves: number; elapsedMs: number; stars: number; mode: string; cfg: Cfg;
  invalid: number; newAchievements: Achievement[]; lbRank: number | null; bestImproved: boolean; verified: boolean | null; nextCfg: Cfg | null;
  lb: platform.Posted | "posting" | null;
}
const MAX_UNDO = 60;

export const app = {
  /** The open screen (null: the round, or nothing over the title's room). */
  screen: "title" as Screen | null,
  stack: ["title"] as Screen[],
  openedFrame: 0,
  focusNext: null as string | null,
  setupMode: "practice" as string,
  setup: { practice: 0, practiceSeed: "", theme: 0, challenge: 0, scoreSeed: "" },
  lbTab: "endless",
  lbPlatform: null as platform.BoardRow[] | null,
  results: null as Results | null,
  message: null as { text: string; until: number } | null,
  toasts: [] as { text: string; until: number }[],
  caption: null as { text: string; until: number } | null,
  bannerCollapsed: false,
  confirmErase: false,
};
/** js/main.js session. */
export const session = {
  cfg: null as Cfg | null, state: null as State | null, mode: "" as string,
  log: [] as Command[], undoStack: [] as { json: string; logLen: number; elapsedMs: number }[],
  invalid: 0, assists: false, elapsedMs: 0, paused: true, active: false,
  lesson: null as (Lesson & { count: number }) | null, lessonIdx: -1,
  sessionId: "", lastCmdSig: "", lastCmdAt: -1e9,
};
export let selected: Loc | null = null;
export let cursor: Loc | null = null;
let confirmTarget: Loc | null = null;
let pausedByHide = false;
let cmdCounter = 0;

let clockMs = 0;
export const now = (): number => clockMs;
export const fresh = (): boolean => frame().frame !== app.openedFrame;
const timers: { at: number; fn: () => void }[] = [];
/** setTimeout on the fixed-step clock. */
function after(ms: number, fn: () => void): void { timers.push({ at: clockMs + ms, fn }); }

// ------------------------------------------------------------------ helpers
const spoken: string[] = [];
/** The live region (#sr-live): one announcement a frame, joined. */
export function announce(text: string): void { if (text) spoken.push(text); }
function flushAnnouncements(): void {
  if (!spoken.length) return;
  const text = spoken.splice(0).join(" ").slice(0, 500);
  try { ui.announce(text); } catch { /* busy */ }
}
export function toast(text: string, ms = 2400): void {
  app.toasts = [{ text, until: clockMs + ms }];
}
/** #hud-message: the pill under the board (ms 0: until replaced). */
export function message(text: string, ms = 3200): void {
  app.message = { text, until: ms === 0 ? Infinity : clockMs + ms };
}
const CAPTIONS: Partial<Record<audio.Sfx, string>> = {
  select: N("select"), place: N("place"), invalid: N("not allowed"), delivery: N("delivery"), clear: N("triple cleared"),
  order: N("order complete"), win: N("stage complete"), lose: N("round lost"), undo: N("undo"), hint: N("hint"),
};
/** audio.js play with its caption (#caption: ♪ text for 1.5 s). */
export function sound(ev: audio.Sfx): void {
  audio.play(ev);
  const c = CAPTIONS[ev];
  if (c && settings().captions) app.caption = { text: `♪ ${T(c)}`, until: clockMs + 1500 };
}
function haptic(pattern: number | number[]): void {
  if (!settings().haptics) return;
  // navigator.vibrate patterns: the device's buzz for the "on" parts in total
  const ms = Array.isArray(pattern) ? pattern.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) : pattern;
  try { vibrate(ms); } catch { /* none */ }
}
const pending: (() => void)[] = [];
/** A widget's press, run once the frame's UI is built (state changes mid-build would break later widgets). */
export function later(fn: () => void): void { pending.push(fn); }
export const settings = (): Settings => platform.settings();
export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  settings()[key] = value;
  platform.persist();
  applySettings();
}

// ------------------------------------------------------------------ router (main.js show / back)
export function show(name: Screen, push = true): void {
  if (push && app.stack[app.stack.length - 1] !== name) app.stack.push(name);
  app.screen = name;
  app.openedFrame = frame().frame;
  app.confirmErase = false;
  app.focusNext = primaryPointer() === "coarse" ? null : firstFocus(name);
  ui.setFocus(null);
}
function firstFocus(s: Screen): string | null {
  switch (s) {
    case "title": return "btn-play";
    case "modes": return "mode-learn";
    case "setup": return "btn-start-round";
    case "journey": return "stage-1";
    case "pause": return "btn-resume";
    case "results": return app.results?.nextCfg ? "btn-results-next" : "btn-results-retry";
    case "learn": return "lesson-1";
    default: return "btn-back";
  }
}
function hideScreens(): void { app.screen = null; app.openedFrame = frame().frame; ui.setFocus(null); }
export function back(): void {
  app.stack.pop();
  const prev = app.stack[app.stack.length - 1] || "title";
  if (prev === "title" && !session.active) { goTitle(); return; }
  show(prev, false);
}
export function goTitle(): void {
  app.stack = ["title"];
  show("title", false);
}

// ------------------------------------------------------------------ settings
function applySettings(): void {
  const s = settings();
  render.setPalette(s.colorPalette === "high-visibility" ? "high-visibility" : "standard");
  render.setReducedMotion(preferences().reducedMotion);
  if (!session.state) render.setTheme(s.theme || "ember");
}
export function totalStars(): number {
  return Object.values(platform.save().progress.journeyStars).reduce((a, b) => a + b, 0);
}

// ------------------------------------------------------------------ daily
export function dailyCfg(): Cfg & { date: string } { return Content.dailyConfig(Content.utcDateString(platform.nowMs())); }
export function dailyCountdownText(): string {
  const nowMs = platform.nowMs();
  const n = new Date(nowMs);
  const next = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1);
  const ms = next - nowMs;
  return T("new in {h}h {m}m", { h: Math.floor(ms / 3600000), m: Math.floor((ms % 3600000) / 60000) });
}

// ------------------------------------------------------------------ names
const MODE_NAMES: Record<string, string> = { learn: N("Learn"), journey: N("Journey"), daily: N("Daily"), practice: N("Practice"), challenge: N("Challenge"), score: N("Score chase") };
/** A round config's display name (content names are English source strings; dailies are composed). */
export function cfgName(cfg: Cfg | null, mode?: string): string {
  const name = cfg?.name;
  if (!name) return MODE_NAMES[mode ?? ""] ? T(MODE_NAMES[mode ?? ""]!) : (mode || "");
  const daily = /^Daily (\d{4}-\d\d-\d\d)$/.exec(name);
  return daily ? T("Daily {date}", { date: daily[1]! }) : T(name);
}
/** Stored player names: the default guest/player names translate, real names pass through. */
export function shownName(name: string): string { return name === "Guest" || name === "Player" ? T(name) : name; }
export function playerName(): string {
  if (platform.signedIn()) return platform.displayName() || "Player";
  return platform.save().profileName || "Guest";
}
export function setPlayerName(n: string): void {
  platform.save().profileName = (n || "").slice(0, 24) || "Guest";
  platform.persist();
}
export function currentScore(s: State): number {
  return s.score.total || (s.score.clearPoints + s.score.orderBonus + s.score.capacityBonus + s.score.moveBonus + s.score.timeBonus);
}
export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ------------------------------------------------------------------ rounds
function themeFor(cfg: Cfg): string { return cfg.theme || settings().theme || "ember"; }
function newSessionId(): string { return Math.floor(Math.random() * 2 ** 40).toString(36).slice(0, 8); }
export function startRound(cfg: Cfg, mode?: string): void {
  session.cfg = cfg;
  session.mode = mode || cfg.kind;
  session.state = Rules.createGame(cfg);
  session.log = []; session.undoStack = []; session.invalid = 0; session.assists = false; session.elapsedMs = 0;
  session.paused = false; session.active = true; session.lesson = null;
  session.sessionId = newSessionId();
  // a fresh round must not inherit the previous round's double-commit guard
  session.lastCmdSig = ""; session.lastCmdAt = -1e9;
  selected = null; cursor = null; confirmTarget = null; pausedByHide = false;
  app.results = null;
  render.setTheme(themeFor(cfg));
  render.buildBoard(session.state);
  audio.setSuspended(false);
  hideScreens();
  if (cfg.intro) message(T(cfg.intro), 6000); else app.message = null;
  announce(T("Round started. {name}. Fill the orders on the left.", { name: cfgName(cfg, session.mode) }));
}
function endActiveSession(): void {
  session.active = false;
  session.paused = true;
  pausedByHide = false;
  selected = null; cursor = null;
  render.clearSelection();
  render.setCursor(null);
}
export function pauseRound(showOverlay = true): void {
  if (!session.active || session.paused) return;
  if (showOverlay) pausedByHide = false;
  session.paused = true;
  audio.setSuspended(true);
  if (showOverlay) show("pause");
}
export function resumeRound(): void {
  if (!session.active) return;
  pausedByHide = false;
  session.paused = false;
  audio.setSuspended(false);
  app.stack = ["title"];
  hideScreens();
}
export function togglePause(): void {
  if (!session.active) return;
  if (session.paused) resumeRound(); else pauseRound();
}
export function restartRound(): void {
  if (!session.cfg) return;
  if (session.mode === "learn" && session.lessonIdx >= 0) startLesson(session.lessonIdx);
  else startRound(session.cfg, session.mode);
}
export function leaveRound(): void {
  // ends the round as a loss (main.js: a resign that is not recorded)
  if (session.active && session.state && !session.state.terminal) Rules.applyCommand(session.state, { type: "resign" });
  session.lesson = null;
  endActiveSession();
  goTitle();
}
export function nextRound(): void {
  const n = app.results?.nextCfg;
  if (n) startRound(n, "journey"); else { endActiveSession(); goTitle(); }
}
export function retryRound(): void { if (session.cfg) startRound(session.cfg, session.mode); }
export function menuFromResults(): void { endActiveSession(); goTitle(); }

// ------------------------------------------------------------------ moves
export function legalTarget(loc: Loc): boolean {
  if (!selected || !session.state) return false;
  return Rules.checkMove(session.state, selected, loc) === null;
}
function legalTargetsFor(loc: Loc): Loc[] {
  return Rules.legalMoves(session.state!).filter((m) => Rules.locEq(m.from, loc)).map((m) => m.to);
}
export const playing = (): boolean => session.active && !session.paused && !!session.state && !session.state.terminal && app.screen === null;
export function tapCell(loc: Loc): void {
  if (!session.active || session.paused || !session.state || session.state.terminal) return;
  audio.startBed();
  const s = session.state;
  const item = Rules.getCell(s, loc);
  if (selected) {
    if (Rules.locEq(selected, loc)) { deselect(); return; }
    const reason = Rules.checkMove(s, selected, loc);
    if (reason === null) {
      if (settings().confirmMoves && !(confirmTarget && Rules.locEq(confirmTarget, loc))) {
        confirmTarget = loc;
        render.showGhost(loc, Rules.getCell(s, selected));
        message(T("Tap again to confirm"), 1800);
        return;
      }
      commitMove(selected, loc);
    } else if (item) selectCell(loc); // tapping another occupied cell re-selects it
    else invalidFeedback(reason);
  } else if (item) selectCell(loc);
}
function selectCell(loc: Loc): void {
  selected = loc;
  confirmTarget = null;
  const targets = legalTargetsFor(loc);
  render.setSelection(loc, targets);
  sound("select");
  haptic(8);
  const item = Rules.getCell(session.state!, loc)!;
  announce(T("{item} selected. {n} openings available.", { item: T(Content.ITEMS[item]!.label), n: targets.length }));
}
export function deselect(): void {
  selected = null; confirmTarget = null;
  render.clearSelection();
  sound("deselect");
}
const INVALID_TEXT: Record<string, string> = {
  "empty-source": N("That cell is empty."), "occupied-target": N("That cell is occupied."), "same-cell": N("Already there."),
  "game-ended": N("The round is over."), "bad-location": N("Not a valid cell."),
};
function invalidFeedback(reason: string): void {
  session.invalid++;
  sound("invalid");
  haptic([20, 40, 20]);
  message(T(INVALID_TEXT[reason] || N("Not a legal move.")));
  announce(T("Invalid move: {reason}", { reason: INVALID_TEXT[reason] ? T(INVALID_TEXT[reason]!) : reason }));
}
function commitMove(from: Loc, to: Loc): void {
  const s = session.state!;
  const sig = JSON.stringify(from) + ">" + JSON.stringify(to);
  if (sig === session.lastCmdSig && clockMs - session.lastCmdAt < 250) return; // idempotent double-tap guard
  session.lastCmdSig = sig; session.lastCmdAt = clockMs;
  const cmd: Command = { type: "move", id: `${session.sessionId}-${++cmdCounter}`, from: Rules.clone(from), to: Rules.clone(to), atMs: Math.round(session.elapsedMs) };
  const shapeErr = Rules.validateCommandShape(cmd);
  if (shapeErr) { invalidFeedback(shapeErr); return; }
  const res = Rules.applyCommand(s, cmd);
  if (!res.ok) {
    // the rejected attempt stays in the input log (the replay reconstructs the invalid count)
    session.log.push(cmd);
    invalidFeedback(res.reason ?? "");
    return;
  }
  session.undoStack.push({ json: Rules.serialize(s), logLen: session.log.length, elapsedMs: session.elapsedMs });
  if (session.undoStack.length > MAX_UNDO) session.undoStack.shift();
  session.log.push(cmd);
  session.state = res.state;
  selected = null; confirmTarget = null;
  sound("place");
  haptic(12);
  render.clearSelection(); render.clearHint(); render.syncState(res.state, res.events, false);
  for (const ev of res.events) {
    if (ev.type === "clear") {
      sound("clear"); haptic(25);
      announce(T("Triple cleared: {item} for {n} points.", { item: T(Content.ITEMS[ev.item!]!.label), n: ev.points ?? 0 }));
    } else if (ev.type === "order-complete") {
      sound("order");
      message(T("Order complete: {item}!", { item: T(Content.ITEMS[ev.item!]!.label) }));
      announce(T("Order complete: {item}", { item: T(Content.ITEMS[ev.item!]!.label) }));
    } else if (ev.type === "delivery") sound("delivery");
    else if (ev.type === "orders-new") {
      message(T("New order wave — round {n}!", { n: res.state.endlessRound }), 2600);
      announce(T("New orders. Wave {n}", { n: res.state.endlessRound }));
    }
  }
  lessonProgress(res.events, "move");
  if (res.state.terminal) {
    if (session.mode === "learn") {
      if (!res.state.terminal.won) {
        // lesson failed (the counter overflowed in the delivery lesson): retry
        const idx = session.lessonIdx;
        message(T("The counter overflowed — let’s try that lesson again."), 2600);
        after(1400, () => { if (session.mode === "learn" && session.lessonIdx === idx) startLesson(idx); });
      }
    } else finishRound(res.state);
  }
}
export function canUndo(): boolean {
  const s = session.state;
  return !!s && s.cfg.mechanics.undo && session.undoStack.length > 0 && !s.terminal;
}
export function doUndo(): void {
  if (!session.active || session.paused || !canUndo()) return;
  const snap = session.undoStack.pop()!;
  session.state = Rules.deserialize(snap.json);
  session.log.length = snap.logLen;
  session.elapsedMs = snap.elapsedMs;
  session.assists = true;
  selected = null; confirmTarget = null;
  render.clearSelection();
  render.syncState(session.state, [], true);
  sound("undo");
  message(T("Undone."));
  lessonProgress([{ type: "undo" }], "undo");
}
const HINT_TEXT: Record<string, string> = {
  "complete-triple": N("Move the {item} to finish a triple."), "build-pair": N("Pair the {item} with its twin on a shelf."),
  "clear-counter": N("Make room: shelve the {item} from the counter."), any: N("Try relocating the {item}."),
};
let hintSeq = 0;
export function doHint(): void {
  const s = session.state;
  if (!session.active || session.paused || !s || s.terminal || !s.cfg.mechanics.hint) return;
  const h = Rules.hint(s); // same legal-action surface as play
  if (!h) return;
  session.assists = true;
  render.setHint(h.from, h.to);
  sound("hint");
  const text = T(HINT_TEXT[h.why] || HINT_TEXT.any!, { item: T(Content.ITEMS[h.item]!.label) });
  message(`💡 ${text}`, 4200);
  announce(T("Hint: {text}", { text }));
  const mine = ++hintSeq;
  after(4200, () => { if (mine === hintSeq) render.clearHint(); });
}
export function skipAnimations(): void { render.skipAll(); }
export function resetCamera(): void { cursor = null; render.setCursor(null); render.reframe(); }

// ------------------------------------------------------------------ round end (main.js finishRound)
function finishRound(state: State): void {
  session.active = false;
  const won = !!state.terminal?.won;
  sound(won ? "win" : "lose");
  haptic(won ? [30, 60, 30] : 80);
  announce(won ? T("Stage complete!") : T("Round lost: {reason}", { reason: state.terminal?.reason ?? "" }));
  const p = platform.save().progress;
  p.stats.rounds++;
  if (won) p.stats.wins++;
  p.stats.clears += state.score.clears;
  p.stats.itemsCleared += state.score.clears * 3;
  p.stats.bestStreak = Math.max(p.stats.bestStreak, state.score.streakBest);
  p.stats.playMs += session.elapsedMs;
  // stars (journey): win = 1, at or under par moves = +1, at or under par time = +1
  let stars = 0;
  if (session.mode === "journey" && won) {
    stars = 1;
    if (state.cfg.par && state.moves <= state.cfg.par.moves) stars++;
    if (state.cfg.par && session.elapsedMs <= state.cfg.par.timeSec * 1000) stars++;
    p.journeyStars[state.cfg.id] = Math.max(p.journeyStars[state.cfg.id] || 0, stars);
    p.journeyBest[state.cfg.id] = Math.max(p.journeyBest[state.cfg.id] || 0, state.score.total);
  }
  if (session.mode === "daily" && won && state.cfg.date) p.dailiesDone[state.cfg.date] = Math.max(p.dailiesDone[state.cfg.date] || 0, state.score.total);
  if (session.mode === "challenge" && won) p.challengeBest[state.cfg.id] = Math.max(p.challengeBest[state.cfg.id] || 0, state.score.total);
  if (session.mode === "score") p.endlessBest = Math.max(p.endlessBest || 0, state.score.total);
  const newAch = checkAchievements(state, won);
  platform.persist();
  // the local boards for the ranked modes
  let lbRank: number | null = null, verified: boolean | null = null, bestImproved = false;
  const ranked = ["daily", "challenge", "score"].includes(session.mode) && (won || session.mode === "score");
  if (ranked && state.score.total > 0) {
    const entry = makeEntry(state);
    verified = verifyEntry(entry);
    lbRank = platform.submitEntry(entry);
    bestImproved = lbRank === 0;
  }
  const nextCfg = session.mode === "journey" && won && session.cfg?.index != null ? Content.JOURNEY[session.cfg.index + 1] ?? null : null;
  const mode = session.mode, elapsedMs = session.elapsedMs, invalid = session.invalid;
  const showResults = (): void => {
    const r: Results = {
      won, reason: state.terminal?.reason ?? "", score: state.score, moves: state.moves, elapsedMs, stars, mode, cfg: state.cfg,
      invalid, newAchievements: newAch, lbRank, bestImproved, verified, nextCfg, lb: null,
    };
    app.results = r;
    show("results");
    // signed in: every finished Journey, Daily, Challenge or Score chase run posts its total (score-script.js)
    if (platform.signedIn() && ["journey", "daily", "challenge", "score"].includes(mode)) {
      r.lb = "posting";
      void platform.postScore(state.score.total).then((res) => { r.lb = res; });
    }
  };
  if (render.isBusy() && !preferences().reducedMotion) after(650, showResults); else showResults();
}
function checkAchievements(state: State, won: boolean): Achievement[] {
  const p = platform.save().progress;
  const got: Achievement[] = [];
  const unlock = (key: string): void => {
    if (p.achievements[key]) return;
    p.achievements[key] = Date.now();
    const def = Content.ACHIEVEMENTS.find((a) => a.key === key)!;
    got.push(def);
    // the results panel lists new achievements itself; a toast there would cover it, so only toast elsewhere
    after(900 + got.length * 600, () => { if (app.screen !== "results") toast(`🏆 ${T(def.name)}`); sound("star"); });
  };
  if (state.score.clears > 0) unlock("first-clear");
  if (won) unlock("first-win");
  if (state.score.streakBest >= 5) unlock("streak-5");
  if (p.stats.clears >= 100) unlock("clears-100");
  if (Object.keys(p.journeyStars).length >= 20) unlock("journey-half");
  if (Object.keys(p.journeyStars).length >= 40) unlock("journey-done");
  if (Object.keys(p.dailiesDone).length >= 7) unlock("daily-7");
  if (state.score.total >= 2000) unlock("score-2000");
  if (p.stats.itemsCleared >= 500) unlock("items-500");
  return got;
}
function boardIdFor(mode: string, cfg: Cfg): string {
  if (mode === "daily") return `daily-${cfg.date}`;
  if (mode === "challenge") return `challenge-${cfg.id}`;
  return "endless";
}
function makeEntry(state: State): BoardEntry {
  return {
    board: boardIdFor(session.mode, state.cfg), name: playerName(), score: state.score.total,
    seed: state.cfg.seed, ruleset: state.cfg.id, version: state.cfg.version, won: !!state.terminal?.won,
    assists: session.assists, durationMs: Math.round(session.elapsedMs), invalid: session.invalid, sessionId: session.sessionId,
    date: new Date(platform.nowMs()).toISOString().slice(0, 10),
    cfgSnapshot: Rules.clone(state.cfg), log: Rules.clone(session.log), finalHash: Rules.hashState(state), mine: true,
  };
}
/** main.js verifyEntry: replay the log from the config and compare the terminal hash and total. */
export function verifyEntry(entry: BoardEntry): boolean {
  try {
    let state = Rules.createGame(entry.cfgSnapshot!);
    for (const cmd of entry.log ?? []) {
      if (Rules.validateCommandShape(cmd)) return false;
      const res = Rules.applyCommand(state, cmd);
      if (!res.ok) continue; // invalid action: skipped, reconstructed as the count
      state = res.state;
    }
    return Rules.hashState(state) === entry.finalHash && state.score.total === entry.score;
  } catch { return false; }
}

// ------------------------------------------------------------------ lessons (main.js startLesson)
export function startLesson(i: number): void {
  const lessons = Content.tutorialLessons();
  const lesson = lessons[i]!;
  const cfg = lesson.cfg;
  session.cfg = cfg;
  session.mode = "learn";
  session.lessonIdx = i;
  session.state = Rules.createGame(cfg);
  // deterministic lesson fixtures
  if (lesson.force?.counterTypes) lesson.force.counterTypes.forEach((t, k) => { session.state!.counter[k] = t; });
  if (lesson.force?.counter0) session.state.counter[0] = lesson.force.counter0;
  if (lesson.force?.shelves) lesson.force.shelves.forEach((row, r) => row.forEach((t, c) => { session.state!.shelves[r]![c] = t; }));
  session.log = []; session.undoStack = []; session.invalid = 0; session.assists = false; session.elapsedMs = 0;
  session.paused = false; session.active = true;
  session.sessionId = newSessionId();
  session.lastCmdSig = ""; session.lastCmdAt = -1e9;
  session.lesson = { ...lesson, count: 0 };
  selected = null; cursor = null; confirmTarget = null;
  app.results = null;
  app.message = null;
  render.setTheme(themeFor(cfg));
  render.buildBoard(session.state);
  audio.setSuspended(false);
  hideScreens();
  announce(`${T("Lesson {n}: {title}", { n: i + 1, title: T(lesson.title) })}. ${T(lesson.text)}`);
}
function lessonProgress(events: GameEvent[], action: string): void {
  const L = session.lesson;
  if (!L) return;
  const goal = L.goal;
  const hit = goal.event === "undo" && action === "undo" ? 1 : events.filter((e) => e.type === goal.event).length;
  L.count += hit;
  if (goal.event === "win" && events.some((e) => e.type === "win")) L.count = goal.count;
  if (L.count < goal.count) return;
  platform.save().progress.tutorialDone[L.id] = true;
  platform.persist();
  toast(T("Lesson complete!"));
  sound("win");
  announce(T("Lesson complete."));
  const next = session.lessonIdx + 1;
  session.lesson = null;
  if (next < Content.tutorialLessons().length) after(900, () => { if (session.mode === "learn") startLesson(next); });
  else {
    endActiveSession();
    after(900, () => { toast(T("Tutorial finished — the boutique is yours!")); goTitle(); });
  }
}
export function exitLesson(): void {
  session.lesson = null;
  endActiveSession();
  goTitle();
}

// ------------------------------------------------------------------ modes, setup, scores
export function openMode(mode: string): void {
  if (mode === "journey") { show("journey"); return; }
  if (mode === "learn") { show("learn"); return; }
  app.setupMode = mode;
  const themes = Content.THEMES;
  app.setup.theme = Math.max(0, themes.findIndex((t) => t.id === settings().theme));
  show("setup");
}
/** ui.js buildSetup's Start. */
export function startSetup(): void {
  const C = Content;
  const seedOf = (txt: string): number => (txt.trim() ? RNG.hashString(txt.trim()) : (Math.random() * 0xffffffff) >>> 0);
  if (app.setupMode === "practice") {
    const p = C.PRACTICE[app.setup.practice]!;
    const theme = C.THEMES[app.setup.theme]?.id ?? "ember";
    startRound({ ...p, seed: seedOf(app.setup.practiceSeed), theme });
  } else if (app.setupMode === "daily") startRound(dailyCfg());
  else if (app.setupMode === "challenge") startRound(C.CHALLENGES[app.setup.challenge]!);
  else if (app.setupMode === "score") startRound({ ...C.SCORE_CHASE, seed: seedOf(app.setup.scoreSeed) });
}
let lbSeq = 0;
export function showLeaderboard(tab: string): void {
  app.lbTab = tab;
  if (app.screen !== "leaderboard") show("leaderboard");
  // local records show at once; the platform's high-score board arrives when signed in
  if (!platform.signedIn()) { app.lbPlatform = null; return; }
  const req = ++lbSeq;
  void platform.topEntries(50).then((rows) => { if (req === lbSeq) app.lbPlatform = rows; });
}
export function eraseAll(): void {
  platform.eraseAll();
  applySettings();
  toast(T("Local data erased."));
  goTitle();
}
export function signIn(): void { void requestSignIn().catch(() => undefined); }
export function invite(): void {
  const link = platform.inviteLink();
  if (!link) return;
  try { clipboard.writeText(link); toast(S("copied")); } catch { toast(`${S("copyFailed")}: ${link}`, 6000); }
}

// ------------------------------------------------------------------ keys and pads (main.js keydown / pollGamepad)
function cursorGrid(): Loc[][] {
  const s = session.state;
  if (!s) return [];
  const rows: Loc[][] = [];
  for (let r = s.shelves.length - 1; r >= 0; r--) rows.push(s.shelves[r]!.map((_, c) => ({ area: "shelf", r, c } as Loc)));
  rows.push(s.counter.map((_, i) => ({ area: "counter", i } as Loc)));
  return rows;
}
export function moveCursor(dir?: string): void {
  if (!session.active || session.paused) return;
  const grid = cursorGrid();
  if (!grid.length) return;
  if (!cursor) cursor = grid[grid.length - 1]![0]!;
  else {
    let ri = grid.findIndex((row) => row.some((l) => Rules.locEq(l, cursor)));
    let ci = grid[ri]!.findIndex((l) => Rules.locEq(l, cursor));
    if (dir === "left") ci = Math.max(0, ci - 1);
    else if (dir === "right") ci = Math.min(grid[ri]!.length - 1, ci + 1);
    else if (dir === "up") ri = Math.max(0, ri - 1);
    else if (dir === "down") ri = Math.min(grid.length - 1, ri + 1);
    ci = Math.min(ci, grid[ri]!.length - 1);
    cursor = grid[ri]![ci]!;
  }
  render.setCursor(cursor);
  sound("ui");
}
/** A focused board-control cell keeps the 3D focus ring on the same cell (main.js mirror focus). */
export function setCursorTo(loc: Loc): void { cursor = loc; render.setCursor(loc); }
function onConfirm(): void {
  if (!session.active || session.paused) return;
  if (!cursor) { moveCursor(); return; }
  tapCell(cursor);
}
function onCancel(): void {
  if (selected) deselect();
  else if (session.active) togglePause();
}
onAction((e) => {
  if (!e.pressed || ui.capturingKeys()) return;
  const a = e.action;
  audio.startBed();
  if (app.screen) {
    if (!fresh()) return;
    if (a === "cancel") {
      if (app.screen === "pause") later(resumeRound);
      else if (app.screen !== "title" && app.screen !== "results") later(back);
    } else if (a === "pause" && app.screen === "pause") later(resumeRound);
    return;
  }
  if (!session.active) return;
  const onBoardControl = ui.focused() !== null;
  if (onBoardControl) {
    // Enter / Space and arrows on a focused HUD or board-control button are the button's (UI focus navigation)
    if (a === "confirm" || a === "left" || a === "right" || a === "up" || a === "down") return;
  }
  switch (a) {
    case "left": case "right": case "up": case "down": later(() => moveCursor(a)); break;
    case "confirm": later(onConfirm); break;
    case "cancel": later(onCancel); break;
    case "undo": later(doUndo); break;
    case "hint": later(doHint); break;
    case "pause": later(togglePause); break;
    case "skip": render.skipAll(); break;
    case "camera": later(resetCamera); break;
  }
});

// ------------------------------------------------------------------ pointer and touch (main.js bindPointer)
/** The board's uncovered rectangle (render3d.js safeRect) in window pixels, set by screens.ts. */
export const view: render.Rect = { x: 0, y: 0, width: 1, height: 1 };
interface Press { kind: "down" | "move" | "up" | "cancel"; x: number; y: number }
const presses: Press[] = [];
let lastTouch = -1e9;
onTouch((e) => {
  lastTouch = clockMs;
  if (!e.primary) return;
  if (e.phase === "start") presses.push({ kind: "down", x: e.x, y: e.y });
  else if (e.phase === "move") presses.push({ kind: "move", x: e.x, y: e.y });
  else if (e.phase === "end") presses.push({ kind: "up", x: e.x, y: e.y });
  else presses.push({ kind: "cancel", x: e.x, y: e.y });
});
onPointerButton((e) => {
  if (e.button !== 0 || clockMs - lastTouch < 600) return;
  presses.push({ kind: e.pressed ? "down" : "up", x: e.x, y: e.y });
});
onPointerMove((x, y) => {
  if (clockMs - lastTouch >= 600) presses.push({ kind: "move", x, y });
});
let down: { x: number; y: number; t: number; loc: { loc: Loc; item: boolean } | null } | null = null;
let dragging = false;
const DRAG_PX = 12, HOLD_MS = 220;
/** The frame's presses on the board, after the UI is built (a press on a widget is the widget's). */
function pointerInput(wasPlaying: boolean): void {
  const list = presses.splice(0);
  const sc = frame().scale;
  for (const p of list) {
    if (p.kind === "move") {
      // gentle parallax (never affects picking)
      const f = frame();
      if (f.width > 0 && f.height > 0) render.setParallax(p.x / f.width - 0.5, p.y / f.height - 0.5);
      if (!down || !session.state) continue;
      const dist = Math.hypot(p.x - down.x, p.y - down.y) / sc;
      const hold = settings().holdToDrag === "hold";
      if (!dragging && dist > DRAG_PX && (hold || clockMs - down.t > HOLD_MS || (down.loc && down.loc.item))) {
        dragging = true;
        if (down.loc && down.loc.item && !selected) selectCell(down.loc.loc);
      }
      if (dragging && selected) {
        const over = render.pickLoc(p.x, p.y);
        if (over && legalTarget(over.loc)) render.showGhost(over.loc, Rules.getCell(session.state, selected));
        else render.hideGhost();
      }
      continue;
    }
    if (p.kind === "down") {
      down = null; dragging = false;
      const inView = p.x >= view.x && p.y >= view.y && p.x <= view.x + view.width && p.y <= view.y + view.height;
      // a press that closed a panel this frame, or one on a widget, is not the board's
      if (!wasPlaying || !playing() || !inView || ui.pointerOver()) continue;
      audio.startBed();
      down = { x: p.x, y: p.y, t: clockMs, loc: render.pickLoc(p.x, p.y) };
      continue;
    }
    if (!down) continue;
    const wasDrag = dragging;
    down = null; dragging = false;
    if (!playing()) { render.hideGhost(); continue; }
    if (p.kind === "cancel") { render.hideGhost(); continue; } // lost the pointer: cancel safely
    const over = render.pickLoc(p.x, p.y);
    render.hideGhost();
    ui.setFocus(null);
    if (wasDrag) {
      if (over && selected && !Rules.locEq(over.loc, selected)) {
        if (legalTarget(over.loc)) commitMove(selected, over.loc);
        else invalidFeedback(Rules.checkMove(session.state!, selected, over.loc) || "occupied-target");
      } else deselect();
    } else if (over) tapCell(over.loc);
    else if (selected) deselect();
  }
}

// ------------------------------------------------------------------ the clock
let hidden = false;
onFixedUpdate(() => {
  if (hidden) return;
  clockMs += 1000 / 60;
  if (session.active && !session.paused && !session.state?.terminal) session.elapsedMs += 1000 / 60;
  for (let i = 0; i < timers.length; i++) {
    const t = timers[i]!;
    if (clockMs >= t.at) { timers.splice(i--, 1); t.fn(); }
  }
});

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k === lookKey) return;
  lookKey = k;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}
onStart(() => {
  setFixedRate(60);
  initStyles();
  platform.initPlatform();
  audio.loadSfx();
  render.setReducedMotion(preferences().reducedMotion);
  applyLook();
  applySettings();
  render.setTheme(settings().theme || "ember", true);
  render.clearBoard();
  render.setActive(true);
  goTitle();
});
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
platform.onSettingsChange(applySettings);
platform.onProgressMerged(() => toast(T("Progress synced from your account.")));
onSessionEnded(() => toast(S("signedOut"), 3600));
onSuspend(() => {
  hidden = true;
  // only auto-resume a round this paused: one the player paused (or left for Settings/Help) stays paused
  pausedByHide = session.active && !session.paused;
  pauseRound(false);
  audio.setSuspended(true);
  platform.flush();
});
onResume(() => {
  hidden = false;
  if (session.active && pausedByHide) {
    pausedByHide = false;
    resumeRound();
    toast(T("Welcome back — round resumed."));
  } else if (!session.active || !session.paused) audio.setSuspended(false);
});

let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  applyLook();
  applyTokens(ui.preferences().highContrast);
  audio.update();
  if (app.message && app.message.until <= clockMs) app.message = null;
  if (app.caption && app.caption.until <= clockMs) app.caption = null;
  app.toasts = app.toasts.filter((x) => x.until > clockMs);
});
onRender(() => {
  const wasPlaying = playing();
  drawScreens();
  for (const fn of pending.splice(0)) fn();
  pointerInput(wasPlaying);
  const f = frame();
  render.update(frameDt, f.width, f.height, view, ui.preferences().scale);
  flushAnnouncements();
});
