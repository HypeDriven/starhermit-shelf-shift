# Shelf Shift

A cozy boutique shelf-organizing puzzle. Move objects among shelf cells to form
triples, clear requested orders, and keep the delivery counter from overflowing.

## Run

Any static file server works (the client makes no server API calls;
leaderboards are local):

```
python3 -m http.server 8080
```

## Play

- **Pointer/touch:** tap an object to lift it, tap a glowing cell to place it —
  or drag. Three identical objects on one shelf row clear.
- **Keyboard:** arrows move the focus ring · Enter select/place · Esc cancel ·
  U undo · H hint · C camera · P pause · S skip animations.
- **Gamepad:** stick/D-pad focus, confirm/cancel/pause/undo (remappable in
  Settings).

Lose only when a delivery finds no free staging cell on the counter.

## Modes

Learn (5 interactive lessons) · Journey (40 authored stages, mastery every 10th) ·
Daily (one shared seed per UTC day) · Practice (3 difficulties, undo/hints,
unranked) · Challenge (move limits, speed targets, tight counters) ·
Score chase (endless, replay-verified leaderboard).

## Architecture

| File | Role |
| --- | --- |
| `js/rng.js` | seeded streams (rules / decor / audiovisual stay independent) |
| `js/rules.js` | pure deterministic rules engine: legality, resolution, scoring, serialization, state hashing |
| `js/content.js` | versioned items, themes, 40 journey stages, challenges, tutorial, daily generator |
| `js/store.js` | versioned, checksummed local save + leaderboards |
| `js/audio.js` | WebAudio: authored one-shots in `sfx/*.opus` per logical event (synth fallback), ambience, generative music |
| `js/render3d.js` | Three.js boutique scene, animation, particles, post-processing, live graphics settings |
| `js/gfx.js` | graphics quality model: presets, overrides, GPU detection, cost summary, panel strings |
| `js/ui.js` | DOM screens/settings/results builders |
| `js/main.js` | bootstrap, session, input (pointer/keyboard/gamepad), platform glue |
| `server.js` | static host + `/api/v1` time, daily, replay-verified leaderboard |
| `tests/rules.test.js` | unit, replay-property, and fuzz tests |
| `tools/validate.js` | offline content validator (solver proves every stage winnable) |

## Verify

```
node tests/rules.test.js
node tools/validate.js
```

## Notes

- Determinism: same seed + same command log → identical state hashes; the
  server replays submitted logs before accepting leaderboard entries.
- If WebGL is unavailable the game offers a fully playable DOM board and
  preserves all progress.
- `starhermit.txt` declares `name`, `launch`, and `server` for the host shell.
