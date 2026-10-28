# Shelf Shift

A cozy boutique shelf-organizing puzzle. Move objects among shelf cells to form
triples, clear requested orders, and keep the delivery counter from overflowing.
A StarHermit engine script game (engine 1.20.1): played natively by the
StarHermit client and in browsers by the engine's web runtime (`index.html` is
the engine's loader, written by `npm run package`).

## Play

- **Pointer/touch:** tap an object to lift it, tap a glowing cell to place it —
  or drag. Three identical objects on one shelf row clear.
- **Keyboard:** arrows move the focus ring · Enter select/place · Esc cancel ·
  U undo · H hint · C camera · P pause · S skip animations (rebind in Options).
- **Gamepad:** stick/D-pad focus, South confirm, East cancel, Start pause,
  West undo, North hint.

Lose only when a delivery finds no free staging cell on the counter.

## Modes

Learn (5 interactive lessons) · Journey (40 authored stages, mastery every 10th) ·
Daily (one shared seed per UTC day) · Practice (3 difficulties, undo/hints,
unranked) · Challenge (move limits, speed targets, tight counters) ·
Score chase (endless).

## Layout

| Path | Role |
| --- | --- |
| `js/rng.js`, `js/rules.js`, `js/content.js`, `js/store.js` | the browser build's pure game modules (seeded streams, rules, content, save model), unchanged |
| `js/migrate.js` | what the browser build left in the account (cloud slot, settings KV) |
| `js/i18n.js`, `js/locales/`, `js/sh-strings.js` | strings in nine locales |
| `native/*.ts` | the engine client: main (flow, input, rounds), screens (UI), render (scene), audio, platform (save, scores), quality, style, i18n, classic (loads js/) |
| `tools/ui-style.css` → `assets/ui-style.json` | the UI's styles (`npm run css`) |
| `score-script.js` | the platform script posting high scores |
| `server.js` | dev static host (not part of the package) |

## Develop

```
npm test               # unit tests + native checks (needs the engine runtime)
npm run test:browser   # the packaged game in GPU Chrome
npm run plays          # regenerate tests/native/*.play
npm run package        # after every change: loader + starhermit-files.json
```

See spec.md for the full specification.
