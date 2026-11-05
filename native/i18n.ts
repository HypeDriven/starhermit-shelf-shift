// Localization: the engine's string tables (assets/strings.json: US English
// source strings as keys, the nine StarHermit locales) in the interface
// language the runtime reports (the player's choice in Options › Language,
// else the account's preferred language or the device's). Every string is drawn
// through T() each frame, so a change shows on the next frame and never
// restarts a round. The account lines are the engine's own `starhermit.*` strings.
import { strings } from "starhermit:engine";
import * as ui from "starhermit:ui";

strings.load("assets/strings.json");
strings.defaultLocale = "en-US";
ui.setLanguage(strings.locale);
strings.onChange((locale) => ui.setLanguage(locale));

export function currentLocale(): string { return strings.locale; }
export type Vars = Record<string, string | number>;
const fill = (s: string, vars: Vars): string => s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] != null ? String(vars[k]) : m));
/** An English source string in the player's language (unknown strings pass through); `{name}` placeholders from vars. */
export function T(key: string, vars?: Vars | null): string {
  if (strings.has(key)) return strings.t(key, vars ?? undefined);
  return vars ? fill(key, vars) : key;
}
/** Marks an English key that is translated with T() where it is shown. */
export const N = (s: string): string => s;
const ACCOUNT = {
  signIn: "signIn", invite: "invite", copied: "inviteCopied", copyFailed: "inviteFailed", signedOut: "signedOut",
  lbPosting: "leaderboardPosting", lbRank: "leaderboardRank", lbPosted: "leaderboardPosted", lbNotPosted: "leaderboardNotPosted",
} as const;
/** An account line (the engine's) in the player's language. */
export function S(key: keyof typeof ACCOUNT, vars?: Vars): string { return strings.t(`starhermit.${ACCOUNT[key]}`, vars); }
