# Shelf Shift — specification

Shelf Shift is a single-player shelf-organizing puzzle set in a warmly lit miniature boutique. The player moves
objects between shelf cells and the front counter to form triples and fill customer orders while deliveries keep
arriving. It is a StarHermit engine script game (engine 1.20.1, host API 1.22, `engine.minor=20`): one package,
played natively by the StarHermit client and in browsers by the engine's web runtime.

## Rules (js/rules.js, unchanged)

- The board is `shelves × cols` shelf cells plus a counter of staging cells. Stock is shuffled onto the shelves
  from the round's seed (never a starting triple); `counterStart` objects wait on the counter.
- A move takes one object from an occupied cell to any empty cell (shelf or counter).
- Three identical objects on one shelf row clear. Cleared triples count toward the orders. A clear scores 100 plus
  15 × (streak − 1); a move without a clear resets the streak. Completing an order adds 250.
- Every `delivery.every` moves, `delivery.per` new objects arrive on the counter (order-needed types most likely).
  A delivery that finds no free counter cell — or a board with no empty cell — loses the round. Move and time
  limits lose the round when reached.
- Winning (every order filled) adds 25 per empty cell, 20 per move under par and, for timed stages, 5 per second
  under the par time. Score chase never ends on orders: each finished wave adds the spare-capacity bonus and deals
  a new seeded wave of orders.
- Hints (`Rules.hint`) suggest a triple-completing move, then a pair, then relieving a full counter.
- Everything is deterministic from (seed, moves); the round's time only enters through quantized `atMs`.

## Content (js/content.js, unchanged)

Eight objects (teapot, candle, book, plant, vase, clock, mug, lantern) with shape, colour, a high-visibility colour
and an icon; five themes (Ember Glow, Verdant Shop, Nocturne, Rose Atelier, Ivory Hall) unlocked by Journey stars
(0/12/30/55/85); 40 Journey stages (mastery every 10th); six challenges; three practice presets; Score chase; the
Daily ruleset derived from the UTC date; five lessons; nine achievements.

## Modes and screens

- **Title** (over the empty boutique): Play, Daily challenge (with the time to the next Daily), Journey (with
  stages cleared), Profile, How to play, Settings, Scores; signed-out players see Sign in with StarHermit,
  signed-in players their name, the cloud-save line and Invite a friend.
- **Choose a mode**: Learn, Journey, Daily, Practice, Challenge, Score chase.
- **Setup**: Practice (difficulty, optional seed text, theme — locked themes show their star price), Daily (its
  rules, seed and today's best), Challenge (pick one, its rules and your best), Score chase (optional seed).
- **Journey**: the 40 stages in a grid with their stars; a stage unlocks once the previous one has a star.
- **Learn**: the five lessons. A lesson's banner (Hide / Show, Exit lesson) sits under the top bar; reaching the
  goal starts the next lesson after a moment; an overflow in lesson 4 restarts it.
- **Round**: the top bar (Pause, the round's name and clock — a countdown for timed rounds, red under 20 s —
  score, streak, moves or moves/limit), the Orders rail (each order's icon, progress and bar), the action tray
  (Undo, Hint, Skip animations, Reset view), the message pill (stage intro, hints, invalid moves, order
  completions), captions when on.
- **Pause**: Resume, Settings, Help, Restart round, Leave round. Menus over a round dim it; the title's menus sit
  over the boutique undimmed.
- **Results**: the headline, the score breakdown, stars (Journey: a win, at or under par moves, at or under par
  time), new achievements, the local board rank, personal best and replay verification, the leaderboard line
  when signed in; Next (Journey), Retry, Menu.
- **Profile**: display name (guests) or account and cloud-save state, statistics, achievements, theme choice.
- **Scores**: the local boards (Score chase, Daily, Challenges) and, signed in, the platform's high-score board.

## Controls

- **Pointer and touch**: tap an object to lift it (its legal openings glow green, its own cell amber), tap a
  glowing cell to place it, tap the lifted object again to put it back, tap another object to switch. Or drag an
  object onto a cell (a ghost shows over legal cells). "Hold and drag" in Settings makes drags start on any hold.
  An empty cell is tapped anywhere in the space above it. With "Confirm moves" a placement needs a second tap.
- **Keyboard** (rebindable in the runtime's Options): arrows move the focus ring over the cells (counter last),
  Enter / Space select and place, Escape cancels a selection or pauses (and goes back in menus), U undo, H hint,
  P pause, S skip animations, C reset the view.
- **Gamepad**: D-pad / left stick focus, South confirm, East cancel, Start pause, West undo, North hint, Select
  skip, right stick press reset view.
- Every cell is a named target ("shelf 2 cell 3: Teapot", "counter cell 1: empty — place here") for screen
  readers and play scripts; "Visible board controls" shows the board as buttons.

## Settings

The runtime's Options own volumes and mute, graphics quality and frame rate, language, text size, high contrast,
reduced motion and key/pad bindings (Settings links to Options and to key bindings). The game's own settings, kept
in the save document: captions for audio cues, colour palette (standard / high visibility), left-handed controls
(rails swap sides), visible board controls, confirm moves, haptics (device vibration), selection style, the
theme; and Erase all local progress (with an inline confirmation).

## Layouts

Picked by the window's logical size: phone portrait (≤ 700 px wide, portrait: the tray is a bottom bar, the orders
sit under the top bar, the banner spans the width), short landscape (≤ 500 px tall: the orders bottom-left, the
banner a narrow left column, the tray a right column) and desktop (orders left and tray right, vertically
centred; narrower orders under 1024 px). The camera frames the board in the rectangle the HUD leaves uncovered.

## Presentation

- The boutique on `starhermit:scene`, as the browser build drew it with three.js r160: wall, plank floor, three
  pendant lamps, wainscot and framed pictures, seeded crates, the shelf unit and counter table, cell inlays with
  marker rings, the eight procedural objects, lift / fly / drop / pop tweens, particle bursts, dust motes, flicker
  and lamp sway, pointer parallax and shake. Lights are r160's ÷ π; `RoomEnvironment(renderer)` as each lit
  material's own envMap at its old intensity; ACES at exposure 1.05.
- Quality tiers follow the browser build's presets (native/quality.ts): Low (no shadows, no environment, plain
  surfaces, MSAA), Balanced (1024 shadows, environment, procedural textures at half size, bloom, the grade, FXAA),
  High (2048 shadows, GTAO, clear-coated ceramics, SMAA), Ultra (4096 shadows, full-resolution GTAO and bloom,
  double-size textures, MSAA); dust and burst density scale within a tier by the graphics level.
- The old colour grade + vignette runs as `renderer.post` (before bloom, where the old composer graded after it).
- Sound: the 13 authored clips (sfx/), a looped room tone and the generative chord pad rendered into clips.

## Platform

- **Save**: the engine save (schema 1) is js/store.js's document `{ v, settings, progress, profileName }`, merged
  across devices with `Store.mergeDocs`. The browser build's cloud slot (`game:<slug>`, the checksummed
  `{ sum, payload }`) is read as a foreign save, merged in and replaced once; its account settings KV keys are
  adopted for the game's preferences and then removed (js/migrate.js). Guests' old browser localStorage is not
  migrated.
- **Scores**: signed in, every finished Journey, Daily, Challenge or Score chase run posts its total to the
  `high-score` board through score-script.js (range-checked; solo scores are client totals by design). Ranked runs
  (won Daily and Challenge, every Score chase) also go to local boards on the device, verified by replaying the
  round's command log.
- **Daily**: the UTC date by the platform's clock (`serverNow`), the device's when offline.
- There is no multiplayer: the browser build never used rooms, and server.js is only a dev static host.

## Checks

- `npm run test:unit`: rules (unit, replay, fuzz), i18n coverage of every string native/*.ts shows in all nine
  locales, the save model and migrations, the content's solvability by the scripts' solver.
- `npm run test:native`: web index, tsc, `starhermit check` without warnings, and the play scripts
  (tests/native: Journey 1 by keys and 2 by clicks; the five lessons by finger on a DPR-3 phone; Practice on a
  short landscape phone with hint, undo, pause, settings, help, restart, leave; the menus, Challenge 1 through the
  visible board controls, Score chase, Scores; today's Daily written at test time). `npm run plays` regenerates
  them from tools/gen-plays.mjs.
- `npm run test:browser`: the packaged loader in GPU Chrome at desktop, phone and landscape: clicks, taps, mouse
  and finger drags, pause, lessons, the Daily.
- `npm run validate`: every stage, challenge, preset and Daily is winnable (tools/validate.js).

## Known limitations

- 🪴 is not in StarHermit Emoji yet: the plant's icon shows 🌿.
- The candle's wax sheen is not drawn (the engine keeps but does not draw sheen).
- The old build's moves popped the object at its source and showed it at the target at once (a sync-order bug);
  the port plays the intended fly animation.
- Guests' progress from the old browser build (localStorage) does not carry over; cloud saves do.
