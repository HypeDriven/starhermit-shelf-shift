// The game's data and the StarHermit platform, on the runtime's modules (what
// js/platform.js and js/store.js did over the JS SDK and localStorage):
// - the save (starhermit:storage `saves`, schema 1: on the device and in the
//   player's cloud slot) is the browser build's save document (js/store.js:
//   { v, settings, progress, profileName }) without its checksum wrapper (the
//   engine keeps its own integrity); two devices' saves merge on a conflict
//   with Store.mergeDocs (best of both, nothing dropped; this device's
//   preferences), as the browser build merged on its saveconflict; the slot
//   the browser build wrote through the JS SDK (game:<slug>: the checksummed
//   { sum, payload } document) shows as foreign: it is unwrapped, merged in
//   and replaced once;
// - the game's own preferences stay in the document's settings (captions,
//   theme, colour palette, left-handed rails, selection style, haptics,
//   visible board controls, confirm moves); the browser build's copies of
//   them in the account's settings KV are adopted once (the platform's value
//   won there too), then all its KV keys are removed (volumes, mute, graphics,
//   reduced motion, contrast, larger text, the gamepad mapping and the
//   language are the runtime's Options now);
// - the local score boards (Store.loadBoards/saveBoards over the device's
//   key/value storage, as before only on this device);
// - the player, the invite link, the platform's clock for the Daily, posting a
//   finished run's total through score-script.js (a practice session whose
//   socket carries { type: 'result', scores }, as the JS SDK's submitScores
//   did) with the rank, and the high-score board's top entries.
import type { JsonValue } from "starhermit:engine";
import {
  connectGame, inviteLink as fetchInviteLink, leaderboards, onPlayerChange, player, serverNow, serverTime, sessions, type Leaderboard,
} from "starhermit:platform";
import { saves, settings as kv } from "starhermit:storage";
import { Migrate, Store, type BoardEntry, type SaveDoc, type Settings } from "./classic.ts";

// --- the save --------------------------------------------------------------------------------
let doc: SaveDoc = Store.fresh();
let lastSavedAt = 0;
let hadSave = false;
const mergedListeners = new Set<() => void>();
/** fn() after progress from the account (another device, the browser build) was merged in. */
export function onProgressMerged(fn: () => void): void { mergedListeners.add(fn); }
function merged(): void { for (const fn of mergedListeners) fn(); }

/** Canonical JSON (sorted keys): saves compare equal whatever their key order. */
function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
}
function write(opts: { replaceForeign?: boolean } = {}): void {
  try {
    saves.save(JSON.parse(JSON.stringify(doc)) as JsonValue, { schema: 1, ...opts });
    lastSavedAt = saves.load()?.savedAt ?? lastSavedAt;
  } catch (e) { console.warn(`save: ${String(e)}`); }
}
/** The live save document (change it, then persist()). */
export function save(): SaveDoc { return doc; }
export function settings(): Settings { return doc.settings; }
/** Saves (the device at once, the account debounced by the runtime). */
export function persist(): void { write(); }
/** Store.mergeDocs(other, this device's); true when the progress changed. */
function adopt(other: unknown): boolean {
  const next = Store.mergeDocs(other, doc);
  if (canon(next) === canon(doc)) return false;
  const grew = canon(next.progress) !== canon(doc.progress);
  doc = next;
  write();
  return grew;
}
saves.onConflict((mine, remote) => ({ merged: Store.mergeDocs(remote.data, mine?.data ?? null) as unknown as JsonValue }));
saves.onStatus((_status, state) => {
  if (state === "foreign") { migrateForeign(); return; }
  const cur = saves.load();
  if (cur && cur.savedAt !== lastSavedAt) {
    lastSavedAt = cur.savedAt;
    if (adopt(cur.data)) merged();
  }
});
/** The browser build's cloud document ({ sum, payload }): merged with this device's save, saved over it once. */
function migrateForeign(): void {
  const old = saves.foreign();
  if (!old) return;
  const prev = Migrate.fromBrowserSave(old.text);
  let grew = false;
  if (prev) {
    const next = Store.mergeDocs(prev, doc);
    grew = canon(next.progress) !== canon(doc.progress);
    // a first engine save takes the old build's preferences too (Store.mergeDocs keeps this device's)
    if (!hadSave) next.settings = { ...next.settings, ...prev.settings };
    doc = next;
  }
  write({ replaceForeign: true });
  hadSave = true;
  if (grew) merged();
  settingsListeners.forEach((fn) => fn());
}

/** The sync line: null for a guest, else saving / synced / error (platform.js syncLabel). */
export function syncState(): "local" | "connecting" | "saving" | "synced" | "error" {
  if (!player()) return "local";
  const st = saves.state();
  if (st === "error" || st === "read-blocked") return "error";
  if (st === "loading") return "connecting";
  if (st === "foreign" || st === "uploading" || saves.status() === "pending") return "saving";
  return "synced";
}
export function flush(): void { void saves.flush().catch(() => undefined); }

// --- the browser build's settings KV (js/migrate.js) ------------------------------------------
let legacyDone = false;
function importLegacy(): void {
  const keys = kv.legacyKeys();
  if (!keys || legacyDone) return;
  legacyDone = true;
  const old: Record<string, unknown> = {};
  for (const key of keys) old[key] = kv.legacy(key);
  const prefs = Migrate.legacyPreferences(old);
  if (Object.keys(prefs).length) { Object.assign(doc.settings, prefs); write(); settingsListeners.forEach((fn) => fn()); }
  for (const key of keys) if (Migrate.isBrowserKey(key)) kv.removeLegacy(key);
}
const settingsListeners = new Set<() => void>();
export function onSettingsChange(fn: () => void): void { settingsListeners.add(fn); }

/** Reads the device's save (from onStart). */
export function initPlatform(): void {
  const cur = saves.load();
  lastSavedAt = cur?.savedAt ?? 0;
  hadSave = !!cur;
  doc = (cur ? Store.migrate(JSON.parse(JSON.stringify(cur.data))) : null) ?? Store.fresh();
  kv.onLegacy(importLegacy);
  importLegacy();
  if (saves.state() === "foreign") migrateForeign();
  refreshPlayer();
  void serverTime().then(() => undefined, () => undefined);
}
/** Settings › Erase all local progress (main.js resetSave). */
export function eraseAll(): void {
  doc = Store.fresh();
  write();
  try { Store.saveBoards({ entries: [] }); } catch { /* none */ }
}

// --- the player and the clock -----------------------------------------------------------------
export function signedIn(): boolean { return !!player(); }
export function displayName(): string { return player()?.displayName ?? ""; }
let invite: string | null = null;
/** The invite link, fetched ahead so a button press can copy it at once. */
export function inviteLink(): string | null { return player() ? invite : null; }
function refreshPlayer(): void {
  invite = null;
  board = undefined;
  if (!player()) return;
  fetchInviteLink().then((u) => { invite = u; }, () => { invite = null; });
}
const playerListeners = new Set<() => void>();
export function onPlayer(fn: () => void): void { playerListeners.add(fn); }
onPlayerChange(() => { refreshPlayer(); for (const fn of playerListeners) fn(); });

/** Now in ms by the platform's clock when it has answered, else the device's (the Daily's UTC day). */
export function nowMs(): number {
  try { return serverNow() ?? Date.now(); } catch { return Date.now(); }
}

// --- the local score boards (main.js submitEntry / leaderboardEntries) -----------------------
const BOARD_CAP = 400;
/** Records a finished ranked run; its 0-based rank on its board. The replay envelope is not kept (nothing reads it back). */
export function submitEntry(entry: BoardEntry): number {
  const slim: BoardEntry = { ...entry };
  delete slim.log; delete slim.cfgSnapshot; delete slim.finalHash;
  const boards = Store.loadBoards();
  boards.entries = boards.entries.filter((e) => !(e.board === slim.board && e.sessionId === slim.sessionId && e.score <= slim.score));
  boards.entries.push(slim);
  if (boards.entries.length > BOARD_CAP) boards.entries = Store.sortEntries(boards.entries).slice(0, BOARD_CAP);
  try { Store.saveBoards(boards); } catch (e) { console.warn(`boards: ${String(e)}`); }
  return Store.sortEntries(boards.entries.filter((e) => e.board === slim.board)).findIndex((e) => e.sessionId === slim.sessionId && e.score === slim.score);
}
export function localEntries(tab: string): BoardEntry[] {
  const entries = Store.loadBoards().entries.filter((e) => {
    if (tab === "daily") return e.board.startsWith("daily-");
    if (tab === "challenge") return e.board.startsWith("challenge-");
    return e.board === "endless";
  });
  return Store.sortEntries(entries).slice(0, 50);
}

// --- the high-score board ---------------------------------------------------------------------
let board: Leaderboard | null | undefined;
async function highScoreBoard(): Promise<Leaderboard | null> {
  if (board !== undefined) return board;
  const list = await leaderboards.list();
  board = list.find((b) => b.key === "high-score") ?? list[0] ?? null;
  return board;
}
export interface BoardRow { name: string; score: number }
/** platform.js fetchPlatformLeaderboard: the board's top entries (signed in), null when unavailable. */
export async function topEntries(n: number): Promise<BoardRow[] | null> {
  if (!player()) return null;
  try {
    const b = await highScoreBoard();
    if (!b) return null;
    const r = await leaderboards.entries(b.id, { pageSize: n });
    const rows = r.items.slice(0, n).map((e) => ({ name: e.displayName || e.username || "", score: Number.isFinite(e.score) ? e.score : 0 }));
    return rows.length ? rows : null;
  } catch { return null; }
}
export interface Posted { posted: boolean; rank: number | null }
/** Signed in only: post a finished run's total through score-script.js; { posted, rank }. Never rejects. */
export async function postScore(total: number): Promise<Posted> {
  const me = player();
  if (!me) return { posted: false, rank: null };
  const score = Math.max(0, Math.round(total));
  let accepted: string[] = [];
  try {
    const sessionId = await sessions.practice();
    accepted = await new Promise<string[]>((resolve) => {
      const socket = connectGame(sessionId);
      let done = false;
      const finish = (list: string[]): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.close();
        resolve(list);
      };
      const timer = setTimeout(() => finish([]), 15000);
      socket.on("open", () => { socket.sendCommand({ type: "result", scores: { "high-score": score } }); });
      socket.on("game", (d) => {
        const m = d as { type?: string; accepted?: string[] } | null;
        if (m && m.type === "result-ack") finish(Array.isArray(m.accepted) ? m.accepted : []);
      });
      socket.on("error", () => finish([]));
      socket.on("stopped", () => finish([]));
      socket.on("abandoned", () => finish([]));
    });
  } catch { return { posted: false, rank: null }; }
  if (!accepted.includes("high-score")) return { posted: false, rank: null };
  try {
    const b = await highScoreBoard();
    if (!b) return { posted: true, rank: null };
    const r = await leaderboards.entries(b.id, { pageSize: 100 });
    const mine = r.items.find((e) => e.userId === me.userId);
    return { posted: true, rank: mine ? mine.rank : null };
  } catch { return { posted: true, rank: null }; }
}
