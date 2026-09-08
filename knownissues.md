# Known Issues — Shelf Shift

QA pass 2026-08-20. Static review driven by Qwen3.8 27B on spark185 (OBLITERATED Q8_0, 262k ctx),
alongside the game's own unit tests and a headless-Chrome boot check.

Method note: broad "find the defects in this module" prompts to the review model mostly came back
*NO DEFECTS FOUND*; the findings below were located by reading the source and then **re-executing
the real modules** to reproduce each one. Narrow, single-question prompts to the model were used
afterwards to double-check individual findings, and where that happened it is noted in the
evidence.

## Test results

| Check | Result |
| --- | --- |
| `npm test` (`node tests/rules.test.js`) | 20/20 pass (2026-09-07) |
| `node --check` on all modules | clean (8 `js/*.js` + `server.js`) |
| `npm run test:e2e` (`node tests/e2e.mjs`, headless Chrome) | PASS — desktop + mobile playthrough, no page errors |
| Browser smoke (2026-09-07): pause/visibility, keyboard board play, focus retention, restart guard, favicon | PASS, no console/page errors |
| Server probes (2026-09-07): honest and inflated `challenge-c3` submissions, `GET /api/v1/leaderboard`, path-traversal attempts | `422 round not won` / `422 score mismatch` / `200` / contained (no escape from root) |

## Resolved

Both confirmed defects were closed on 2026-08-20 (QA fix pass). Neither touched the
deterministic rules engine; each makes the server stop trusting a client-supplied value.

### 1. Move timestamps taken from the client — RESOLVED

- **Fix:** `server.js` `verifySubmission` (replay loop + post-replay checks). The
  authoritative replay now
  - requires the per-command `atMs` sequence to be **monotonic non-decreasing**
    (rejects fabricated/backwards time as `implausible time`);
  - **recomputes the elapsed time and re-writes `entry.durationMs`** from the
    replayed terminal `state.elapsedMs` (the engine-authoritative value), instead of
    storing the client-declared `durationMs` verbatim;
  - for a timed round (`timeLimitSec` or `par.timeSec`), rejects a claimed total play
    time below a real-time floor of `MIN_MS_PER_MOVE` (100 ms) per actually-played
    move (`implausible time`). A human move on this UI takes well over 100 ms, so real
    play is never rejected, while a near-zero fabricated clock can no longer dodge a
    time limit or harvest a time bonus. Client time is now only ever a verified lower
    bound, never a source of a competitive advantage.
- **Verified:** replaying challenge `c1` with honest 30 s/move still yields
  `{reason:"time-up", won:false, elapsedMs:120000, total:700}` and `422 round not won`;
  the fabricated 0.01 s/move log is now `422 implausible time` (previously it was
  verified with `orders-complete, won:true`).

### 2. Invalid-action count not part of authoritative state — RESOLVED

- **Fix:** the count is now reconstructed by the authoritative replay instead of trusted
  from the payload.
  - `server.js` `verifySubmission` no longer aborts on a shape-valid-but-illegal command
    (`illegal command in log`); it **counts** it as an invalid action and skips it (the
    engine leaves state untouched, so skipping is replay-safe/idempotent), then writes the
    reconstructed `entry.invalid` to storage. The client's claimed `invalid` scalar is
    ignored.
  - `js/main.js` `commitMove` now records a rejected attempt in `session.log` (before
    `invalidFeedback`) so the server replay actually sees the invalid actions; a rejected
    command mutates no state, so retaining it is safe and the undo/`logLen` snapshots
    remain consistent. `verifyEntry` was updated to the same count-and-skip rule so local
    verification and the server agree.
- **Verified:** a legit `c1` entry whose log includes 3 rejected attempts posts
  `200 verified`; the stored `leaderboards.json` entry carries `invalid:3` and
  `durationMs:7000` (engine-authoritative), i.e. a cheating `invalid:0` claim is no longer
  trusted.

## Review pass 2026-09-07 (Claude Opus 5) — resolved

### 3. Endless order waves left the finished wave permanently required — RESOLVED

- **File:** `js/rules.js` (endless round advance)
- **Defect:** the wave advance reset the tallies (`s.orders = {}`) but not the requirement table,
  so every type from a completed wave stayed in `s.cfg.orders` at its old count with its tally
  back at zero. `ordersComplete` reads `cfg.orders`, so each finished wave was silently
  re-required forever and the order rail accumulated every type ever asked for.
- **Fix:** the advance now clears `s.cfg.orders` alongside `s.orders`, so a wave replaces its
  predecessor. Covered by the new unit test *"endless order wave replaces the finished wave
  instead of accumulating"*.
- **Note on suspected item 2 (below):** the `s.cfg.orders` write is still the mechanism, and it
  remains replay-safe for the same reason as before (the cfg is cloned into the state at creation);
  the defect was the missing reset, not the layering.

### 4. Deliberate pause was cancelled by a tab switch — RESOLVED

- **File:** `js/main.js` `visibilitychange`
- **Defect:** returning to the tab called `resumeRound()` for any active round, so a round the
  player had paused on purpose — or left running behind the Settings/Help overlay opened from the
  pause menu — silently resumed and `hideScreens()` tore that overlay down.
- **Fix:** a `pausedByHide` flag records whether *this* handler caused the pause; only that case
  auto-resumes. Verified in a browser: pause → hide → show keeps `session.paused` and the pause
  overlay, while an unpaused round still auto-pauses and auto-resumes.

### 5. Keyboard could not operate the accessible DOM board — RESOLVED

- **File:** `js/main.js` global `keydown`
- **Defect:** the handler swallowed `Enter`/`Space` (`e.preventDefault()` → `onConfirm()` on the
  3-D `cursor`) even while a `#board-mirror` cell button had DOM focus, so activating the focused
  button never happened; arrow keys moved only the 3-D cursor ring. In the no-WebGL fallback —
  where the DOM board *is* the playfield — the board was therefore unreachable by keyboard.
- **Fix:** with focus on a board-mirror cell, `Enter`/`Space` fall through to native button
  activation and the arrows move real DOM focus (kept in sync with the 3-D cursor ring via a
  `focus` listener). Verified in a browser: focus a cell → Enter → focus target → Enter completes
  a real move.

### 6. Board mirror discarded keyboard focus on every action — RESOLVED

- **File:** `js/main.js` `buildMirror`
- **Defect:** the mirror is rebuilt from scratch after every move/selection, so keyboard and
  screen-reader users lost their place on the board on each input.
- **Fix:** cells carry a stable `data-loc`; the rebuild restores focus to the same cell.

### 7. Restart inherited the previous round's double-commit guard — RESOLVED

- **File:** `js/main.js` `startRound`
- **Defect:** `session.lastCmdSig`/`lastCmdAt` survived a restart, so an identical first move
  played within 250 ms of the previous round's last move was dropped by the double-tap guard.
- **Fix:** both are reset when a round starts. Verified in a browser (restart → immediate repeat
  of the same relocation lands).

### 8. Leaderboard tie-break skipped objective completion — RESOLVED

- **File:** `js/store.js` `sortEntries`, `server.js` GET sort, `js/main.js` `makeEntry`
- **Fix of suspected item 1:** entries now carry `won`, and both comparators apply
  `score → objective completion → invalid → durationMs → sessionId` as spec §2 requires. The
  local comparator only applies the win step when both entries record it, so entries written
  before the field existed keep their relative order. The server sets `entry.won` from its own
  replay, never from the payload.

### 9. Favicon artwork was overridden by a leftover placeholder — RESOLVED

- **File:** `index.html`
- **Defect:** the commit that added `favicon.svg` left the older inline `data:` icon link below it;
  the later link wins, so browsers kept showing the placeholder.
- **Fix:** the inline duplicate is removed (replaced by an `apple-touch-icon` pointing at
  `icon.png`). Verified in a browser: exactly one `link[rel=icon]`, `./favicon.svg`.

Also removed an unused `require('crypto')` from `server.js`, and added `LICENSE.md`
(PolyForm Noncommercial 1.0.0), which the repo was missing.

## Remaining confirmed defects

None.

## Suspected — not confirmed

### 1. ~~Neither leaderboard applies the first spec tie-break~~ — fixed above (item 8)

### 2. Endless order waves mutate `cfg` inside the live state

- **File:** `js/rules.js` (endless round advance)
- **Concern:** the endless round-advance writes back into `s.cfg.orders`. `state.cfg` is the
  immutable content definition everywhere else — `server.js` `canonicalCfg` deliberately rebuilds
  it from versioned content "instead of trusting the client-supplied snapshot".
- **Why unconfirmed:** because the config is cloned into the state at creation, the mutation stays
  inside the replay and reproduces identically on the server, so no divergence could be
  demonstrated. It is a layering smell rather than a proven bug. (The one real defect it caused —
  stale requirements across waves — is fixed as item 3.)

### 3. ~~Same-row triples clear only three at a time~~ — not reachable

- `var cells = byType[t].slice(0, 3)` does clear exactly three, but the widest shipped board is
  `cols: 4` (`js/content.js`), so a row can never hold six of one type. Unreachable with shipped
  content; left as-is rather than adding an untestable loop.

## Checked, no defects found

- `server.js` `verifySubmission` is otherwise a genuine authoritative validator: it rebuilds the
  config from versioned content via `canonicalCfg` (only the seed is a free parameter, and only for
  `endless`), replays the log through the same engine, requires a terminal state, and rejects a
  score that differs from the replayed total or a mismatched `finalHash`. Contrast this with the
  sibling games where the content definition itself is client-supplied.
- Duplicate command ids are skipped idempotently inside the replay loop (`server.js:99-102`), and
  the client applies a 250 ms double-tap guard (`js/main.js:399`).
- `js/rules.js` scoring: `clearPoints`, `orderBonus`, `capacityBonus`, `moveBonus` and `timeBonus`
  are all integers, `finalizeScore` is their exact sum, and the streak bonus
  `CLEAR_BASE + CLEAR_STREAK * (streak - 1)` is correct at streak 1 (no negative term).
- `js/rules.js` terminal ordering: victory is evaluated before the move and time limits, and the
  overflow rule matches its documented intent — a loss only when a delivery finds no free staging
  cell, with partial deliveries placing what fits (covered by the "partial delivery does not lose"
  unit test).
- Soft-lock guards: the zero-empty-cells check and the empty-board restock both terminate or
  refill deterministically from the rules RNG stream.
- `js/rules.js` `hint()` is built on `legalMoves()`, the same legality surface play uses, as
  spec §2 requires.
- `server.js` static serving: `path.normalize` + `startsWith(ROOT)` + explicit `..` and dotfile
  rejection; 20 000-command and body-size caps; per-IP rate limiting on the leaderboard routes.
- `js/store.js` persistence: every `localStorage` access is wrapped in try/catch, so a blocked or
  corrupt store degrades instead of throwing.

## Not tested

- **3-D rendering**: `js/render3d.js` (775 lines) was not reviewed beyond confirming the page raises
  no WebGL or console errors and that the `webgl-continue` fallback control is present.
- **Hosted platform paths**: there is no `js/platform.js` in this game; host integration was not
  exercised.
- **Board durability**: `loadBoards`/`saveBoards` write to a JSON file next to the server; restart
  and concurrent-writer behaviour was not assessed.
- **Full timing authority**: an off-line replay can never verify a client's *total* real elapsed
  time. The fix above makes time a verified lower bound (monotonic + per-move floor) rather than a
  trusted claim, which closes the near-zero cheat; a client can still report a moderate-but-honest
  pacing for a time limit. Fully authoritative timing requires a hosted server clock (spec §6 /
  "in hosted play, the authoritative clock continues"), which this offline-first build does not use.

## QA artifacts

The replayed verification for the two fixes above ran `shelf-shift/server.js` locally and wrote an
untracked `data/leaderboards.json`; it has been **deleted** after inspection (its stored `invalid:3`
and `durationMs:7000` were read out and recorded in the *Resolved* section). `data/` is not part of
the game and should not be treated as real data.
