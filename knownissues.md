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
| `npm test` | no `package.json`; `node tests/rules.test.js` → 19/19 pass |
| `node --check` on all modules | clean (8 `js/*.js` + `server.js`) |
| `tests/e2e.mjs` (headless Chrome) | not present — substituted a CDP boot check (see *Not tested*): page loads, title "Shelf Shift", canvas present, **no console errors, no page exceptions, no failed requests** |

## Confirmed defects

Each defect below was reproduced by executing the real modules, not merely reported by the model.

### 1. Move timestamps are taken from the client, so time limits and time bonuses are player-controlled

- **File:** `js/rules.js:255-257` (`applyCommand`), reachable through `server.js:82`
  (`verifySubmission`)
- **Trigger:** submit a leaderboard entry whose command log carries fabricated `atMs` values.
- **Behaviour:** the authoritative clock *is* the command payload:

  ```js
  if (typeof cmd.atMs === 'number' && isFinite(cmd.atMs) && cmd.atMs >= 0) {
    s.elapsedMs = Math.floor(cmd.atMs / 100) * 100; // quantized, replay-safe
  }
  ```

  `elapsedMs` then decides the `time-up` loss (`js/rules.js:329`) and the `timeBonus` component
  (`js/rules.js:320-322`). `validateCommandShape` (`js/rules.js:434`) checks `type`, `id`, `from`
  and `to` — never `atMs` — and it is not required to be monotonic. The server replays the client's
  own timestamps, so it computes exactly the score the client intended and marks the entry
  `verified`.
- **Expected:** spec §5: "Treat client clocks, scores, inventories, roles, physics outcomes, and
  completion claims as untrusted in competitive contexts", and "quantize authoritative inputs".
  Quantizing a client value does not make it authoritative.
- **Evidence:** the same seven-move solution of challenge `c1` (`timeLimitSec: 100`,
  `par.timeSec: 90`), replayed with honest and fabricated timestamps:

  ```
  real 30s/move  -> {"reason":"time-up","won":false}         elapsedMs 120000  total  700
  claimed 0.1s   -> {"reason":"orders-complete","won":true}  elapsedMs    100  total 2465
  ```

  and posted to the running server:

  ```
  POST /api/v1/leaderboard  -> 200 {"ok":true,"verified":true}
  GET  ?board=challenge-c1  -> {"entries":[{"name":"TimeLiar","score":2465,"durationMs":100,
                                            "verified":true}]}
  ```

  A challenge that must be finished inside 100 seconds was won with unlimited real time and
  received a near-maximum time bonus.

### 2. The invalid-action count used for tie-breaking is not part of authoritative state

- **File:** `js/rules.js:113` (`createGame` state shape) and `js/rules.js:248-249`
  (`applyCommand` rejection path); `js/main.js:388` (`invalidFeedback`); `server.js:158-170`
- **Trigger:** submit any leaderboard entry with `invalid: 0`.
- **Behaviour:** the rules state contains no invalid-action counter — `applyCommand` returns
  `{ ok: false, reason, state: state, events: [] }` and leaves the state untouched. The count lives
  only in the UI (`session.invalid`, incremented in `invalidFeedback`) and is copied into the
  submission at `js/main.js:602`. `verifySubmission` never recomputes or checks it, and the POST
  handler stores the parsed client object verbatim (`entry.verified = true; boards.entries.push(entry)`).
  Both the client board (`js/store.js:101` `sortEntries`) and the server board (`server.js:151`)
  then order ties by that unverified number.
- **Expected:** spec §2 makes "fewer invalid actions" a ranking criterion, and spec §5 requires
  competitive claims to be untrusted. A criterion the authoritative replay cannot reconstruct
  cannot be enforced.
- **Evidence:** the state literal at `js/rules.js:125-141` has no such field; `server.js:97-105`
  replays the log without tracking rejections (a rejected command would in fact abort validation
  with `illegal command in log`, so an honest log can never contain one).

## Suspected — not confirmed

### 1. Neither leaderboard applies the first spec tie-break (objective completion)

- **File:** `server.js:151` and `js/store.js:101` (`sortEntries`)
- **Concern:** both comparators are `score → invalid → durationMs → sessionId`; neither reads
  `terminal.won`, and the stored entry does not carry it. Spec §2 requires ties to resolve on
  "primary objective completion" first.
- **Why unconfirmed:** every board turns out to be homogeneous in win state, so the missing step
  currently has no observable effect. `daily-*` and `challenge-*` refuse unwon rounds
  (`server.js:110-112`), and in `endless` mode `ordersComplete` starts a new order wave instead of
  terminating (`js/rules.js:296-313`), so `won: true` is set only at `js/rules.js:315` — a
  non-endless path. No pair of entries with different win states can share a board today. It is a
  latent gap, not a live ranking error.

### 2. Endless order waves mutate `cfg` inside the live state

- **File:** `js/rules.js:305-312`
- **Concern:** the endless round-advance writes back into `s.cfg.orders`
  (`s.cfg.orders[ot] = 3 * (1 + Math.floor(s.endlessRound / 2))`). `state.cfg` is the immutable
  content definition everywhere else — `server.js:65` (`canonicalCfg`) deliberately rebuilds it
  from versioned content "instead of trusting the client-supplied snapshot".
- **Why unconfirmed:** because the config is cloned into the state at creation
  (`js/rules.js:128`), the mutation stays inside the replay and reproduces identically on the
  server, so no divergence could be demonstrated. It is a layering smell rather than a proven bug.

### 3. Same-row triples clear only three at a time

- **File:** `js/rules.js:275-277`
- **Concern:** `var cells = byType[t].slice(0, 3)` clears exactly three, and `byType` is computed before any
  clearing, so a row holding six of one type in a single move scores one clear, not two.
- **Why unconfirmed:** with the shipped board widths (`cfg.board.cols`) it is not clear that six of
  a kind can occupy one row, and no content or test exercises it.

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

- **`tests/e2e.mjs`**: not shipped, and this game has no `package.json` (so no `npm test` script).
  Substituted a CDP boot check against `node server.js 39603`; it verifies a clean boot but does not
  play a shift to completion.
- **3-D rendering**: `js/render3d.js` (775 lines) was not reviewed beyond confirming the page raises
  no WebGL or console errors and that the `webgl-continue` fallback control is present.
- **Hosted platform paths**: there is no `js/platform.js` in this game; host integration was not
  exercised.
- **Board durability**: `loadBoards`/`saveBoards` write to a JSON file next to the server; restart
  and concurrent-writer behaviour was not assessed.

## QA artifacts left on disk

Reproducing the findings above required running `shelf-shift/server.js` locally, which created an
untracked `data/` directory. It holds the evidence entries used here (`TimeLiar`). **Delete
`data/` before treating any of it as real data** — this QA pass had no permission to remove it.
