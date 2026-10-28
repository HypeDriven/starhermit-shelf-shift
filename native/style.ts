// The look of the HUD, rails, tray, banner and screens: the browser build's
// css/style.css, rewritten class-based in tools/ui-style.css and converted
// once with `starhermit css` into assets/ui-style.json (`npm run css`),
// registered at start with the theme the runtime's own widgets (scroll bars,
// focus rings, selects, sliders, text fields) take. The runtime's high
// contrast option is the old body.high-contrast token set.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

type Tokens = Record<string, string>;
const BASE: Tokens = {
  bg: "#241a16", panel: "#2e221c", "panel-2": "#3a2b22", ink: "#f3e6d8", "ink-dim": "#c9b6a4",
  accent: "#ffb066", "accent-2": "#ff8a3d", danger: "#e05a4e", ok: "#8fce6e", focus: "#ffd9a0",
  edge: "#ffffff22", hover: "#4a382c", "primary-ink": "#241305", rail: "#1c130ecc", "rail-solid": "#1c130ef2",
  "danger-bg": "#5a2622", "danger-hi": "#74322c",
};
/** body.high-contrast. */
const CONTRAST: Tokens = {
  bg: "#000000", panel: "#0d0d0d", "panel-2": "#1a1a1a", ink: "#ffffff", "ink-dim": "#dddddd",
  accent: "#ffd60a", "accent-2": "#ffd60a", focus: "#ffffff", edge: "#ffffff", rail: "#000000", "rail-solid": "#000000",
};

let current: Tokens = { ...BASE };
export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  ui.setFont({ family: "sans-serif" });
  ui.setTheme({
    fontSize: 16, smallSize: 12.8, headingSize: 24, padding: 8, spacing: 8, radius: 12,
    text: BASE.ink!, muted: BASE["ink-dim"]!, panel: BASE.panel!, control: BASE["panel-2"]!, hovered: BASE.hover!,
    pressed: "#56402f", field: BASE["panel-2"]!, accent: BASE["accent-2"]!, focus: BASE.focus!, outline: "#ffffff2a",
  });
  ui.setTokens(css.tokens);
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$ink" } },
    paragraph: { text: { color: "$ink" } },
    heading: { text: { color: "$ink" } },
    widget: { focusRing: { color: "$focus", width: 3, offset: 2 } },
    scrollArea: { parts: { bar: { background: "#ffffff44", radius: 4 } } },
    tooltip: { background: "$panel", text: { color: "$ink" }, radius: 6, padding: 6 },
    // .screen.overlay: #140d0ab0 behind the panels
    dialog: { background: "#00000000", padding: 0, parts: { backdrop: { background: "#140d0ab0" } } },
    // .screen without .overlay: the menus sit over the boutique undimmed
    ".dialog-clear": { background: "#00000000", padding: 0, parts: { backdrop: { background: "#00000000" } } },
  });
  key = "";
  applyTokens(false);
}

let key = "";
/** The base or high-contrast tokens (cheap when unchanged). */
export function applyTokens(highContrast: boolean): void {
  const k = String(highContrast);
  if (k === key) return;
  key = k;
  current = { ...BASE, ...(highContrast ? CONTRAST : {}) };
  ui.setTokens(current);
  ui.setTheme({
    text: current.ink!, muted: current["ink-dim"]!, panel: current.panel!, control: current["panel-2"]!, hovered: current.hover!,
    field: current["panel-2"]!, accent: current["accent-2"]!, focus: current.focus!,
  });
}
/** A token's current colour (for draw calls, which take real colours). */
export function token(name: string): string { return current[name] ?? "#000000"; }
