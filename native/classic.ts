// The browser build's pure game scripts, unchanged and shared with the Node
// tests: the seeded streams (js/rng.js), the rules (js/rules.js), the content
// (js/content.js: items, themes, the 40 Journey stages, challenges, practice
// presets, Score chase, the Daily generator, the five lessons,
// achievements), the save model (js/store.js: the versioned checksummed
// document, its migration and the two-device merge, the local score boards)
// and the string tables (js/locales/*.js, js/i18n.js, js/sh-strings.js),
// evaluated as classic scripts so their globals (SSRNG, SSRules, SSContent,
// SSStore, SSI18N, SSShStrings) are this module's exports.
//
// js/store.js keeps its local score boards in `localStorage`: here that is a
// small shim over the device's starhermit:storage, installed before the
// scripts run. The progression itself is the engine save (platform.ts).
import { storage } from "starhermit:storage";
import { loadClassic } from "starhermit:script";

const shim = {
  getItem(key: string): string | null {
    try { return storage.getText(key); } catch { return null; }
  },
  setItem(key: string, value: string): void {
    try { storage.set(key, String(value)); } catch (e) { console.warn(`storage ${key}: ${String(e)}`); }
  },
  removeItem(key: string): void {
    try { storage.remove(key); } catch { /* gone */ }
  },
};
(globalThis as unknown as { localStorage: typeof shim }).localStorage = shim;

for (const f of [
  "js/rng.js", "js/rules.js", "js/content.js", "js/store.js",
  "js/locales/en-GB.js", "js/locales/es.js", "js/locales/de.js", "js/locales/fr.js", "js/locales/pt.js", "js/locales/it.js",
  "js/i18n.js", "js/sh-strings.js", "js/migrate.js",
]) loadClassic(f);

// -- The shapes this client reads -------------------------------------------------
export type ItemType = string;
export interface Loc { area: "shelf" | "counter"; r?: number; c?: number; i?: number }
export interface Board { shelves: number; cols: number; counter: number }
export interface Cfg {
  id: string; version: number; kind: string; name?: string; seed: number; date?: string; index?: number;
  board: Board; types: ItemType[]; stock: Record<string, number>; orders: Record<string, number>;
  counterStart: number; delivery: { every: number; per: number } | null; moveLimit: number; timeLimitSec: number;
  par: { moves: number; timeSec: number } | null; mechanics: { undo: boolean; hint: boolean }; endless: boolean;
  theme?: string; intro?: string; mastery?: boolean;
}
export interface Score {
  clears: number; clearPoints: number; streakBest: number; orderBonus: number; capacityBonus: number;
  moveBonus: number; timeBonus: number; rounds: number; total: number;
}
export interface State {
  v: number; cfg: Cfg; seed: number; rngState: number; tick: number;
  shelves: (ItemType | null)[][]; counter: (ItemType | null)[]; orders: Record<string, number>;
  score: Score; streak: number; moves: number; elapsedMs: number; endlessRound: number;
  terminal: { reason: string; won: boolean } | null; events: GameEvent[];
}
export interface GameEvent {
  type: string; item?: ItemType; from?: Loc; to?: Loc; shelf?: number; cells?: number[]; points?: number; streak?: number;
  cell?: number; reason?: string; round?: number; restock?: boolean; orders?: Record<string, number>;
}
export interface Command { type: string; id?: string; from?: Loc; to?: Loc; atMs?: number }
export interface Move { from: Loc; to: Loc; item: ItemType }
export interface Hint extends Move { why: string }
export interface Lesson {
  id: string; title: string; text: string; goal: { event: string; count: number }; cfg: Cfg;
  force?: { counter0?: ItemType; counterTypes?: ItemType[]; shelves?: (ItemType | null)[][] };
}
export interface Item { label: string; icon: string; color: number; colorHC: number; shape: string }
export interface Theme { id: string; name: string; unlockStars: number; palette: Record<string, number> }
export interface Achievement { key: string; name: string; desc: string }
export interface Progress {
  tutorialDone: Record<string, boolean>; journeyStars: Record<string, number>; journeyBest: Record<string, number>;
  challengeBest: Record<string, number>; dailiesDone: Record<string, number>; endlessBest: number;
  achievements: Record<string, number>;
  stats: { rounds: number; wins: number; clears: number; itemsCleared: number; bestStreak: number; playMs: number };
  cosmetics: { theme: string };
}
/** The browser build's settings block; the game still reads the keys in GAME_SETTING_KEYS (platform.ts). */
export interface Settings {
  captions: boolean; theme: string; colorPalette: "standard" | "high-visibility"; leftHanded: boolean;
  holdToDrag: "tap" | "hold"; haptics: boolean; boardMirror: boolean; confirmMoves: boolean;
  [key: string]: unknown;
}
export interface SaveDoc { v: number; settings: Settings; progress: Progress; profileName?: string }
export interface BoardEntry {
  board: string; name: string; score: number; seed: number; ruleset: string; version: number; won: boolean;
  assists: boolean; durationMs: number; invalid: number; sessionId: string; date: string; mine?: boolean; verified?: boolean;
  cfgSnapshot?: Cfg; log?: Command[]; finalHash?: number;
}

interface RulesApi {
  createGame(cfg: Cfg): State;
  applyCommand(s: State, cmd: Command): { ok: boolean; reason?: string; state: State; events: GameEvent[] };
  checkMove(s: State, from: Loc, to: Loc): string | null;
  legalMoves(s: State): Move[];
  hint(s: State): Hint | null;
  getCell(s: State, loc: Loc): ItemType | null;
  locEq(a: Loc | null, b: Loc | null): boolean;
  hashState(s: State): number;
  serialize(s: State): string;
  deserialize(json: string): State;
  clone<T>(o: T): T;
  validateCommandShape(cmd: Command, maxLen?: number): string | null;
}
interface ContentApi {
  CONTENT_VERSION: number;
  ITEMS: Record<string, Item>; ITEM_ORDER: string[]; THEMES: Theme[]; JOURNEY: Cfg[]; CHALLENGES: (Cfg & { name: string })[];
  PRACTICE: (Cfg & { name: string })[]; SCORE_CHASE: Cfg & { name: string }; ACHIEVEMENTS: Achievement[];
  dailyConfig(date: string): Cfg & { date: string; name: string };
  utcDateString(nowMs?: number): string;
  tutorialLessons(): Lesson[];
}
interface StoreApi {
  SAVE_VERSION: number;
  fresh(): SaveDoc; migrate(doc: unknown): SaveDoc | null; mergeDocs(remote: unknown, local: unknown): SaveDoc;
  unwrap(raw: unknown): SaveDoc | null; wrap(doc: SaveDoc): string; checksum(s: string): string;
  loadBoards(): { entries: BoardEntry[] }; saveBoards(b: { entries: BoardEntry[] }): void; sortEntries(e: BoardEntry[]): BoardEntry[];
  DEFAULT_SETTINGS: Settings;
}
export interface RngStream { next(): number; int(n: number): number; state: number }
interface RngApi { derive(seed: number, stream: number): RngStream; create(state: number): RngStream; hashString(s: string): number; STREAM_DECOR: number; STREAM_AV: number }
interface I18nApi {
  LOCALES: string[]; T(key: string, vars?: Record<string, string | number> | null): string; setLocale(tag: string): void; getLang(): string;
}
interface MigrateApi {
  BROWSER_KEYS: string[]; legacyPreferences(kv: Record<string, unknown>): Partial<Settings>; isBrowserKey(key: string): boolean;
  fromBrowserSave(text: string | null): SaveDoc | null;
}
interface ShStringsApi { STRINGS: Record<string, Record<string, string>> }

const g = globalThis as unknown as {
  SSRules: RulesApi; SSContent: ContentApi; SSStore: StoreApi; SSRNG: RngApi; SSI18N: I18nApi; SSShStrings: ShStringsApi; SSMigrate: MigrateApi;
};
export const Rules = g.SSRules;
export const Content = g.SSContent;
export const Store = g.SSStore;
export const RNG = g.SSRNG;
export const I18n = g.SSI18N;
export const ShStrings = g.SSShStrings;
export const Migrate = g.SSMigrate;
