/* Shelf Shift — bootstrap + session orchestration.
 * Modules: rules (pure), content (data), store (persistence), audio,
 * render3d (Three.js), ui (DOM). Only this file wires them together;
 * rules state is mutated exclusively through validated commands.
 */
import { createRenderer, webglAvailable } from './render3d.js';

const Rules = window.SSRules;
const Content = window.SSContent;
const Store = window.SSStore;
const RNG = window.SSRNG;
const UI = window.SSUI;
const Audio = window.SSAudio;
const Platform = window.SSPlatform;
const I18N = window.SSI18N;
const { T, N } = I18N;
const lang = () => I18N.getLang();
const shText = () => window.SSShStrings.strings(lang());
// Language first (sh-language.js: Language setting → account preference → browser).
I18N.initLanguage();

const $ = id => document.getElementById(id);

// ---------- persistent document ----------
let saveDoc = Store.load();

// ---------- StarHermit platform adapter (inert without a launch token) ----------
const platform = Platform.create({ onSync: updateSyncStatus, onSignedOut: onPlatformSignedOut });

// ---------- session ----------
const session = {
  cfg: null, state: null, mode: null,
  log: [],            // ordered validated commands (replay envelope body)
  undoStack: [],      // {json, logLen, elapsedMs}
  invalid: 0,
  assists: false,
  elapsedMs: 0,
  lastStamp: 0,
  paused: true,
  active: false,
  lesson: null,       // tutorial lesson meta while in Learn mode
  sessionId: Math.random().toString(36).slice(2, 10),
  lastCmdSig: '',     // double-commit guard (action identity, not a timer)
  lastCmdAt: 0
};

let renderer = null;
let screenStack = [];
let selected = null;      // loc of lifted item
let cursor = null;        // keyboard/gamepad focus loc
let confirmTarget = null; // pending target when confirmMoves is on
let pausedByHide = false; // round was auto-paused by the tab going hidden

// ---------- tiny helpers ----------
function persist() {
  const wrapped = Store.save(saveDoc); // localStorage stays the offline cache
  platform.queueCloudSave(wrapped);    // cloud is a mirror (hosted only)
  platform.pushSettings(saveDoc.settings); // preferences → platform settings KV
}
// Small sync/account line under the title (hosted only; hidden in local play).
function updateSyncStatus() {
  const el = $('platform-status');
  if (!el) return;
  const name = platform.hosted() ? platform.displayName() : null;
  const label = platform.syncLabel();
  const text = [name ? T('Playing as {name}', { name }) : null, label].filter(Boolean).join(' · ');
  el.textContent = text;
  el.hidden = !text;
  const L = shText();
  $('btn-signin').textContent = L.signIn;
  $('btn-invite').textContent = L.invite;
  $('btn-signin').classList.toggle('hidden', !platform.canSignIn());
  $('btn-invite').classList.toggle('hidden', !platform.inviteLink());
}
function onPlatformSignedOut() {
  toast(shText().signedOut, 3600);
}
async function copyInviteLink() {
  const L = shText();
  const link = platform.inviteLink();
  if (!link) return;
  try { await navigator.clipboard.writeText(link); toast(L.copied); }
  catch (e) { toast(L.copyFailed + ': ' + link, 6000); }
}
$('btn-signin').addEventListener('click', () => platform.signIn());
$('btn-invite').addEventListener('click', () => { copyInviteLink(); });
// Hosted start: cloud save (merged with this device's), then settings KV
// (platform wins), then the player's keyboard bindings.
async function hostedBoot() {
  platform.onSaveConflict(pullCloudSave);
  await pullCloudSave();
  if (await platform.syncSettings(saveDoc.settings)) { Store.save(saveDoc); applySettings(); }
  await platform.loadControls();
}
// Merge the cloud copy into this device's progress (Store.mergeDocs: best of
// both, nothing dropped), rewrite localStorage underneath and save the merged
// doc back. Also the 'saveconflict' path when another device saved first.
async function pullCloudSave() {
  const wrapped = await platform.loadCloudSave();
  if (!wrapped) { if (platform.hosted() && saveDoc.progress.stats.rounds) persist(); return; }
  const doc = Store.unwrap(wrapped);
  if (!doc) return;
  const merged = Store.mergeDocs(doc, saveDoc);
  const changed = JSON.stringify(merged.progress) !== JSON.stringify(saveDoc.progress);
  saveDoc = merged;
  persist();
  applySettings();
  refreshTitle();
  if (changed) toast(T('Progress synced from your account.'));
}
function toast(msg, ms) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), ms || 2400);
}
function announce(msg) { $('sr-live').textContent = msg; }
function message(msg, ms) {
  const m = $('hud-message');
  m.textContent = msg;
  m.classList.remove('hidden');
  clearTimeout(m._timer);
  if (ms !== 0) m._timer = setTimeout(() => m.classList.add('hidden'), ms || 3200);
}
function haptic(ms) {
  if (saveDoc.settings.haptics && navigator.vibrate) navigator.vibrate(ms);
}

// ---------- router ----------
const SCREENS = ['title', 'modes', 'setup', 'journey', 'pause', 'results', 'settings', 'help', 'profile', 'leaderboard', 'learn'];
function show(name, push = true) {
  for (const s of SCREENS)
    document.querySelector('.screen[data-name="' + s + '"]').classList.toggle('active', s === name);
  document.getElementById('app').dataset.screen = name;
  if (push && screenStack[screenStack.length - 1] !== name) screenStack.push(name);
  const first = document.querySelector('.screen[data-name="' + name + '"] .btn:not([disabled])');
  if (first) first.focus({ preventScroll: true });
}
function hideScreens() {
  for (const s of SCREENS)
    document.querySelector('.screen[data-name="' + s + '"]').classList.remove('active');
  document.getElementById('app').dataset.screen = 'game';
}
function back() {
  screenStack.pop();
  const prev = screenStack[screenStack.length - 1] || 'title';
  show(prev, false);
}
function goTitle() {
  screenStack = ['title'];
  refreshTitle();
  show('title', false);
  setHudVisible(false);
}
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => { Audio.play('ui'); back(); }));

// ---------- settings ----------
function applySettings() {
  const s = saveDoc.settings;
  document.body.classList.toggle('reduced-motion', !!s.reducedMotion);
  document.body.classList.toggle('high-contrast', !!s.highContrast);
  document.body.classList.toggle('large-text', !!s.largeText);
  document.body.classList.toggle('left-handed', !!s.leftHanded);
  $('board-mirror').classList.toggle('hidden', !(s.boardMirror && session.active));
  $('board-mirror').classList.toggle('visible-mode', !!s.boardMirror);
  Audio.applySettings(s);
  Audio.setCaptions(!!s.captions, text => {
    const c = $('caption');
    c.textContent = '♪ ' + T(text);
    c.classList.remove('hidden');
    clearTimeout(c._timer);
    c._timer = setTimeout(() => c.classList.add('hidden'), 1500);
  });
  if (renderer) {
    renderer.setSettings(s);
    renderer.setReducedMotion(!!s.reducedMotion);
    renderer.setGraphics(s.gfx);
    renderer.setTheme(s.theme);
  }
}

function totalStars() {
  return Object.values(saveDoc.progress.journeyStars).reduce((a, b) => a + b, 0);
}

// ---------- daily ----------
let dailyCfg = null;
function refreshDaily() {
  const ds = Content.utcDateString(Date.now());
  dailyCfg = Content.dailyConfig(ds);
}
function dailyCountdownText() {
  const n = new Date(Date.now());
  const next = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1);
  const ms = next - Date.now();
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return T('new in {h}h {m}m', { h, m });
}

// ---------- title ----------
function refreshTitle() {
  refreshDaily();
  $('daily-countdown').textContent = dailyCountdownText();
  const done = Object.keys(saveDoc.progress.journeyStars).length;
  $('journey-progress-mini').textContent = done ? done + '/40' : '';
}

// ---------- HUD ----------
function setHudVisible(on) {
  for (const id of ['hud-top', 'hud-orders', 'hud-actions'])
    $(id).classList.toggle('hidden', !on);
  if (!on) $('hud-message').classList.add('hidden');
  $('board-mirror').classList.toggle('hidden', !(on && saveDoc.settings.boardMirror));
}
const MODE_NAMES = { learn: N('Learn'), journey: N('Journey'), daily: N('Daily'), practice: N('Practice'), challenge: N('Challenge'), score: N('Score chase') };
/** A round config's display name (content names are English source strings; dailies are composed). */
function cfgName(cfg, mode) {
  const name = cfg && cfg.name;
  if (!name) return MODE_NAMES[mode] ? T(MODE_NAMES[mode]) : (mode || '');
  const daily = /^Daily (\d{4}-\d\d-\d\d)$/.exec(name);
  return daily ? T('Daily {date}', { date: daily[1] }) : T(name);
}
/** Stored player names: the default guest/player names translate, real names pass through. */
function shownName(name) { return name === 'Guest' || name === 'Player' ? T(name) : name; }
function updateHud() {
  const s = session.state;
  if (!s) return;
  $('hud-mode-name').textContent = cfgName(session.cfg, session.mode);
  $('hud-score').textContent = String(s.score.total || currentScore(s));
  $('hud-streak').textContent = s.streak > 1 ? '🔥 ' + s.streak : '';
  const bits = [];
  if (s.cfg.moveLimit) bits.push(T('moves {n}/{limit}', { n: s.moves, limit: s.cfg.moveLimit }));
  else bits.push(T('moves {n}', { n: s.moves }));
  $('hud-moves').textContent = bits.join(' ');
  // timer
  const t = $('hud-timer');
  if (s.cfg.timeLimitSec) {
    const left = s.cfg.timeLimitSec * 1000 - session.elapsedMs;
    t.textContent = '⏱ ' + UI.fmtTime(left);
    t.style.color = left < 20000 ? 'var(--danger)' : '';
  } else {
    t.textContent = UI.fmtTime(session.elapsedMs);
    t.style.color = '';
  }
  // orders
  const list = $('orders-list');
  list.innerHTML = '';
  for (const ty in s.cfg.orders) {
    const need = s.cfg.orders[ty], have = Math.min(s.orders[ty] || 0, need);
    const li = UI.el('li', { class: have >= need ? 'done' : '' }, [
      UI.el('span', { class: 'ord-icon', text: Content.ITEMS[ty].icon }),
      UI.el('span', { text: T(Content.ITEMS[ty].label) + ' ' + have + '/' + need }),
      UI.el('span', { class: 'ord-bar' }, [
        UI.el('span', { class: 'ord-fill', style: 'width:' + Math.round(100 * have / need) + '%' })
      ])
    ]);
    list.appendChild(li);
  }
  const undoBtn = $('btn-undo'), hintBtn = $('btn-hint');
  undoBtn.disabled = !(s.cfg.mechanics.undo && session.undoStack.length);
  hintBtn.disabled = !s.cfg.mechanics.hint;
}
function currentScore(s) {
  return s.score.clearPoints + s.score.orderBonus + s.score.capacityBonus + s.score.moveBonus + s.score.timeBonus;
}

// ---------- accessible board mirror ----------
function locKey(loc) {
  return loc.area === 'counter' ? 'c:' + loc.i : 's:' + loc.r + ':' + loc.c;
}
function buildMirror() {
  const s = session.state;
  const shelvesHost = $('mirror-shelves'), counterHost = $('mirror-counter');
  // The mirror is rebuilt after every action; without this, keyboard and
  // screen-reader users lose their place on the board on every single move.
  const active = document.activeElement;
  const refocus = active && active.dataset && active.closest('#board-mirror') ? active.dataset.loc : null;
  shelvesHost.innerHTML = ''; counterHost.innerHTML = '';
  if (!s) return;
  for (let r = s.shelves.length - 1; r >= 0; r--) {
    const row = UI.el('div', { class: 'mirror-row', role: 'group', 'aria-label': T('Shelf {n}', { n: r + 1 }) });
    row.appendChild(UI.el('span', { class: 'mirror-label', text: T('Shelf {n}', { n: r + 1 }) }));
    for (let c = 0; c < s.shelves[r].length; c++) {
      row.appendChild(mirrorCell({ area: 'shelf', r, c }, s.shelves[r][c]));
    }
    shelvesHost.appendChild(row);
  }
  const crow = UI.el('div', { class: 'mirror-row', role: 'group', 'aria-label': T('Counter') });
  crow.appendChild(UI.el('span', { class: 'mirror-label', text: T('Counter') }));
  for (let i = 0; i < s.counter.length; i++)
    crow.appendChild(mirrorCell({ area: 'counter', i }, s.counter[i]));
  counterHost.appendChild(crow);
  if (refocus) {
    const again = $('board-mirror').querySelector('[data-loc="' + refocus + '"]');
    if (again) again.focus({ preventScroll: true });
  }
}
function mirrorCell(loc, item) {
  const label = item ? T(Content.ITEMS[item].label) : T('empty');
  const pos = loc.area === 'counter' ? T('counter cell {n}', { n: loc.i + 1 }) : T('shelf {r} cell {c}', { r: loc.r + 1, c: loc.c + 1 });
  const btn = UI.el('button', {
    class: 'cell-btn' + (selected && legalTarget(loc) ? ' target-ok' : ''),
    'aria-label': pos + ': ' + label + (selected && !item && !Rules.locEq(loc, selected) ? ' — ' + T('place here') : ''),
    'aria-pressed': selected && Rules.locEq(loc, selected) ? 'true' : 'false',
    text: item ? Content.ITEMS[item].icon : '·'
  });
  btn.dataset.loc = locKey(loc);
  btn.addEventListener('click', () => tapCell(loc));
  // Keep the 3-D cursor ring and DOM focus describing the same cell.
  btn.addEventListener('focus', () => {
    cursor = loc;
    if (renderer) renderer.setCursor(loc);
  });
  return btn;
}
function legalTarget(loc) {
  if (!selected || !session.state) return false;
  return Rules.checkMove(session.state, selected, loc) === null;
}

// ---------- round lifecycle ----------
function startRound(cfg, mode) {
  mode = mode || cfg.kind;
  session.cfg = cfg;
  session.mode = mode;
  session.state = Rules.createGame(cfg);
  session.log = [];
  session.undoStack = [];
  session.invalid = 0;
  session.assists = false;
  session.elapsedMs = 0;
  session.lastStamp = performance.now();
  session.paused = false;
  session.active = true;
  session.lesson = null;
  // A fresh round must not inherit the previous round's double-commit guard,
  // or an identical first move played within 250 ms would be swallowed.
  session.lastCmdSig = ''; session.lastCmdAt = 0;
  selected = null; cursor = null; confirmTarget = null; pausedByHide = false;
  Audio.setAvRng(RNG.derive(cfg.seed, RNG.STREAM_AV));

  if (renderer) {
    renderer.setTheme(cfg.theme || saveDoc.settings.theme);
    renderer.buildBoard(session.state);
  }
  hideScreens();
  setHudVisible(true);
  $('lesson-banner').classList.add('hidden');
  updateHud();
  buildMirror();
  if (saveDoc.settings.boardMirror) $('board-mirror').classList.remove('hidden');
  if (cfg.intro) message(T(cfg.intro), 6000);
  announce(T('Round started. {name}. Fill the orders on the left.', { name: cfgName(cfg, mode) }));
}

function endActiveSession() {
  session.active = false;
  session.paused = true;
  pausedByHide = false;
  selected = null; cursor = null;
  if (renderer) { renderer.clearSelection(); renderer.setCursor(null); }
}

function pauseRound(showOverlay) {
  if (!session.active || session.paused) return;
  if (showOverlay !== false) pausedByHide = false;
  session.paused = true;
  if (renderer) renderer.setRunning(false);
  Audio.suspend();
  if (showOverlay !== false) show('pause');
}
function resumeRound() {
  if (!session.active) return;
  pausedByHide = false;
  session.paused = false;
  session.lastStamp = performance.now();
  if (renderer) renderer.setRunning(true);
  Audio.resume();
  hideScreens();
}

function tickClock() {
  if (session.active && !session.paused) {
    const t = performance.now();
    session.elapsedMs += t - session.lastStamp;
    session.lastStamp = t;
  }
}

// ---------- moves ----------
let cmdCounter = 0;
function legalTargetsFor(loc) {
  return Rules.legalMoves(session.state).filter(m => Rules.locEq(m.from, loc)).map(m => m.to);
}

function tapCell(loc) {
  if (!session.active || session.paused || !session.state || session.state.terminal) return;
  Audio.start();
  const s = session.state;
  const item = Rules.getCell(s, loc);
  if (selected) {
    if (Rules.locEq(selected, loc)) { deselect(); return; }
    const reason = Rules.checkMove(s, selected, loc);
    if (reason === null) {
      if (saveDoc.settings.confirmMoves && !(confirmTarget && Rules.locEq(confirmTarget, loc))) {
        confirmTarget = loc;
        if (renderer) renderer.showGhost(loc, Rules.getCell(s, selected));
        message(T('Tap again to confirm'), 1800);
        return;
      }
      commitMove(selected, loc);
    } else {
      // tapping another occupied cell re-selects it
      if (item) selectCell(loc);
      else { invalidFeedback(reason); }
    }
  } else if (item) {
    selectCell(loc);
  }
}

function selectCell(loc) {
  selected = loc;
  confirmTarget = null;
  const targets = legalTargetsFor(loc);
  if (renderer) renderer.setSelection(loc, targets);
  Audio.play('select');
  haptic(8);
  buildMirror();
  const item = Rules.getCell(session.state, loc);
  announce(T('{item} selected. {n} openings available.', { item: T(Content.ITEMS[item].label), n: targets.length }));
}

function deselect() {
  selected = null; confirmTarget = null;
  if (renderer) renderer.clearSelection();
  Audio.play('deselect');
  buildMirror();
}

function invalidFeedback(reason) {
  const texts = {
    'empty-source': N('That cell is empty.'),
    'occupied-target': N('That cell is occupied.'),
    'same-cell': N('Already there.'),
    'game-ended': N('The round is over.'),
    'bad-location': N('Not a valid cell.')
  };
  session.invalid++;
  Audio.play('invalid');
  haptic([20, 40, 20]);
  message(T(texts[reason] || N('Not a legal move.')));
  announce(T('Invalid move: {reason}', { reason: texts[reason] ? T(texts[reason]) : reason }));
}

function commitMove(from, to) {
  const s = session.state;
  const sig = JSON.stringify(from) + '>' + JSON.stringify(to);
  const tNow = performance.now();
  if (sig === session.lastCmdSig && tNow - session.lastCmdAt < 250) return; // idempotent double-tap guard
  session.lastCmdSig = sig; session.lastCmdAt = tNow;

  tickClock();
  const cmd = {
    type: 'move', id: session.sessionId + '-' + (++cmdCounter),
    from: Rules.clone(from), to: Rules.clone(to),
    atMs: Math.round(session.elapsedMs)
  };
  const shapeErr = Rules.validateCommandShape(cmd);
  if (shapeErr) { invalidFeedback(shapeErr); return; }
  const res = Rules.applyCommand(s, cmd);
  if (!res.ok) {
    // Record the rejected attempt in the authoritative input log so the server
    // replay reconstructs the invalid-action count itself instead of trusting
    // the client-supplied scalar (the rejected command changes no state, so it
    // is safe to retain; the server counts and skips it).
    session.log.push(cmd);
    invalidFeedback(res.reason);
    return;
  }

  // undo snapshot (state before the move)
  session.undoStack.push({ json: Rules.serialize(s), logLen: session.log.length, elapsedMs: session.elapsedMs });
  if (session.undoStack.length > 60) session.undoStack.shift();
  session.log.push(cmd);
  session.state = res.state;
  selected = null; confirmTarget = null;

  Audio.play('place');
  haptic(12);
  if (renderer) { renderer.clearSelection(); renderer.clearHint(); renderer.syncState(res.state, res.events, false); }
  for (const ev of res.events) {
    if (ev.type === 'clear') {
      Audio.play('clear'); haptic(25);
      announce(T('Triple cleared: {item} for {n} points.', { item: T(Content.ITEMS[ev.item].label), n: ev.points }));
    } else if (ev.type === 'order-complete') {
      Audio.play('order');
      message(T('Order complete: {item}!', { item: T(Content.ITEMS[ev.item].label) }));
      announce(T('Order complete: {item}', { item: T(Content.ITEMS[ev.item].label) }));
    } else if (ev.type === 'delivery') {
      Audio.play('delivery');
    } else if (ev.type === 'orders-new') {
      message(T('New order wave — round {n}!', { n: res.state.endlessRound }), 2600);
      announce(T('New orders. Wave {n}', { n: res.state.endlessRound }));
    }
  }
  updateHud();
  buildMirror();
  lessonProgress(res.events, 'move');

  if (res.state.terminal) {
    if (session.mode === 'learn') {
      if (!res.state.terminal.won) {
        // lesson failed (e.g. overflow in the delivery lesson): retry
        const idx = lessonIdx;
        message(T('The counter overflowed — let’s try that lesson again.'), 2600);
        setTimeout(() => startLesson(idx), 1400);
      }
      // won lessons are completed via lessonProgress (goal event 'win')
    } else {
      finishRound(res.state);
    }
  }
}

function doUndo() {
  if (!session.active || session.paused) return;
  const s = session.state;
  if (!s.cfg.mechanics.undo || !session.undoStack.length || s.terminal) return;
  const snap = session.undoStack.pop();
  session.state = Rules.deserialize(snap.json);
  session.log.length = snap.logLen;
  session.elapsedMs = snap.elapsedMs;
  session.assists = true;
  selected = null; confirmTarget = null;
  if (renderer) { renderer.clearSelection(); renderer.syncState(session.state, [], true); }
  Audio.play('undo');
  message(T('Undone.'));
  updateHud();
  buildMirror();
  lessonProgress([{ type: 'undo' }], 'undo');
}

function doHint() {
  if (!session.active || session.paused || !session.state || session.state.terminal) return;
  if (!session.state.cfg.mechanics.hint) return;
  const h = Rules.hint(session.state); // same legal-action surface as play
  if (!h) return;
  session.assists = true;
  if (renderer) renderer.setHint(h.from, h.to);
  Audio.play('hint');
  const item = T(Content.ITEMS[h.item].label);
  const texts = {
    'complete-triple': N('Move the {item} to finish a triple.'),
    'build-pair': N('Pair the {item} with its twin on a shelf.'),
    'clear-counter': N('Make room: shelve the {item} from the counter.'),
    'any': N('Try relocating the {item}.')
  };
  const text = T(texts[h.why] || texts.any, { item });
  message('💡 ' + text, 4200);
  announce(T('Hint: {text}', { text }));
  setTimeout(() => renderer && renderer.clearHint(), 4200);
}

// ---------- round end ----------
function finishRound(state) {
  tickClock();
  session.active = false;
  const won = state.terminal.won;
  Audio.play(won ? 'win' : 'lose');
  haptic(won ? [30, 60, 30] : 80);
  announce(won ? T('Stage complete!') : T('Round lost: {reason}', { reason: state.terminal.reason }));

  const p = saveDoc.progress;
  p.stats.rounds++;
  if (won) p.stats.wins++;
  p.stats.clears += state.score.clears;
  p.stats.itemsCleared += state.score.clears * 3;
  p.stats.bestStreak = Math.max(p.stats.bestStreak, state.score.streakBest);
  p.stats.playMs += session.elapsedMs;

  // stars (journey): win = 1, under par moves = +1, under par time = +1
  let stars = 0;
  if (session.mode === 'journey' && won) {
    stars = 1;
    if (state.cfg.par && state.moves <= state.cfg.par.moves) stars++;
    if (state.cfg.par && session.elapsedMs <= state.cfg.par.timeSec * 1000) stars++;
    p.journeyStars[state.cfg.id] = Math.max(p.journeyStars[state.cfg.id] || 0, stars);
    p.journeyBest[state.cfg.id] = Math.max(p.journeyBest[state.cfg.id] || 0, state.score.total);
  }
  if (session.mode === 'daily' && won) {
    p.dailiesDone[state.cfg.date] = Math.max(p.dailiesDone[state.cfg.date] || 0, state.score.total);
  }
  if (session.mode === 'challenge' && won) {
    p.challengeBest[state.cfg.id] = Math.max(p.challengeBest[state.cfg.id] || 0, state.score.total);
  }
  if (session.mode === 'score') {
    p.endlessBest = Math.max(p.endlessBest || 0, state.score.total);
  }

  const newAch = checkAchievements(state, won);
  persist();

  // leaderboard submission for ranked modes
  let lbRank = null, verified = null, bestImproved = false;
  const ranked = ['daily', 'challenge', 'score'].includes(session.mode) && (won || session.mode === 'score');
  if (ranked && state.score.total > 0) {
    const entry = makeEntry(state);
    verified = verifyEntry(entry);
    lbRank = submitEntry(entry);
    bestImproved = lbRank === 0;
  }

  const nextCfg = nextLevelCfg();
  const showResults = () => {
    lastResults = {
      won, reason: state.terminal.reason, score: state.score, moves: state.moves,
      elapsedMs: session.elapsedMs, stars, mode: session.mode, cfg: state.cfg,
      invalid: session.invalid, newAchievements: newAch, lbRank, bestImproved, verified, nextCfg
    };
    UI.buildResults(ctx, lastResults);
    setHudVisible(false);
    show('results');
    postToLeaderboard(state);
  };
  if (renderer && renderer.isBusy() && !saveDoc.settings.reducedMotion) {
    setTimeout(showResults, 650);
  } else showResults();
}

// Signed in: every finished Journey, Daily, Challenge or Score chase run
// posts its total to the platform high-score board; the results screen
// shows the player's rank there.
function postToLeaderboard(state) {
  const line = $('results-lb');
  if (!platform.hosted() || !['journey', 'daily', 'challenge', 'score'].includes(session.mode)) {
    line.hidden = true; return;
  }
  line.hidden = false;
  lbState = { state: 'posting' };
  line.textContent = lbText(lbState);
  platform.submitScore(state.score.total).then(r => {
    if (session.state !== state) return;
    lbState = !r.posted ? { state: 'failed' } : { state: 'posted', rank: r.rank || null };
    line.textContent = lbText(lbState);
  });
}
let lastResults = null, lbState = null;
function lbText(lb) {
  const L = shText();
  if (lb.state === 'posting') return L.lbPosting;
  if (lb.state === 'failed') return L.lbNotPosted;
  return lb.rank ? L.lbRank.replace('{rank}', lb.rank) : L.lbPosted;
}

function nextLevelCfg() {
  if (session.mode !== 'journey' || !session.state.terminal.won) return null;
  const idx = session.cfg.index;
  return Content.JOURNEY[idx + 1] || null;
}

function checkAchievements(state, won) {
  const p = saveDoc.progress;
  const got = [];
  const unlock = key => {
    if (!p.achievements[key]) {
      p.achievements[key] = Date.now();
      const def = Content.ACHIEVEMENTS.find(a => a.key === key);
      got.push(def);
      // the results panel lists new achievements itself; a toast there would
      // cover its table/buttons on short screens, so only toast elsewhere
      setTimeout(() => { if ($('app').dataset.screen !== 'results') toast('🏆 ' + T(def.name)); Audio.play('star'); }, 900 + got.length * 600);
    }
  };
  if (state.score.clears > 0) unlock('first-clear');
  if (won) unlock('first-win');
  if (state.score.streakBest >= 5) unlock('streak-5');
  if (p.stats.clears >= 100) unlock('clears-100');
  if (Object.keys(p.journeyStars).length >= 20) unlock('journey-half');
  if (Object.keys(p.journeyStars).length >= 40) unlock('journey-done');
  if (Object.keys(p.dailiesDone).length >= 7) unlock('daily-7');
  if (state.score.total >= 2000) unlock('score-2000');
  if (p.stats.itemsCleared >= 500) unlock('items-500');
  return got;
}

// ---------- leaderboard ----------
function boardIdFor(mode, cfg) {
  if (mode === 'daily') return 'daily-' + cfg.date;
  if (mode === 'challenge') return 'challenge-' + cfg.id;
  return 'endless';
}
function makeEntry(state) {
  return {
    board: boardIdFor(session.mode, state.cfg),
    name: playerName(),
    score: state.score.total,
    seed: state.cfg.seed, ruleset: state.cfg.id, version: state.cfg.version,
    won: !!(state.terminal && state.terminal.won),
    assists: session.assists, durationMs: Math.round(session.elapsedMs),
    invalid: session.invalid, sessionId: session.sessionId,
    date: new Date(Date.now()).toISOString().slice(0, 10),
    cfgSnapshot: Rules.clone(state.cfg),
    log: Rules.clone(session.log),
    finalHash: Rules.hashState(state),
    mine: true
  };
}
function verifyEntry(entry) {
  try {
    let state = Rules.createGame(entry.cfgSnapshot);
    for (const cmd of entry.log) {
      if (Rules.validateCommandShape(cmd)) return false;
      const res = Rules.applyCommand(state, cmd);
      if (!res.ok) continue; // invalid action: skipped, reconstructed as the count
      state = res.state;
    }
    return Rules.hashState(state) === entry.finalHash && state.score.total === entry.score;
  } catch (e) { return false; }
}
function submitEntry(entry) {
  const boards = Store.loadBoards();
  boards.entries = boards.entries.filter(e =>
    !(e.board === entry.board && e.sessionId === entry.sessionId && e.score <= entry.score));
  boards.entries.push(entry);
  if (boards.entries.length > 400) boards.entries = Store.sortEntries(boards.entries).slice(0, 400);
  Store.saveBoards(boards);
  const same = Store.sortEntries(boards.entries.filter(e => e.board === entry.board));
  return same.indexOf(entry);
}
function leaderboardEntries(tab) {
  const boards = Store.loadBoards();
  let entries = boards.entries.filter(e => {
    if (tab === 'daily') return e.board.startsWith('daily-');
    if (tab === 'challenge') return e.board.startsWith('challenge-');
    return e.board === 'endless';
  });
  return Store.sortEntries(entries).slice(0, 50);
}

// ---------- profile ----------
// Hosted sessions are identified by the platform account nickname (resolved
// from /api/v1/users/{sub}/profile by the adapter); the free-text name below
// is the local-guest identity only.
function playerName() {
  if (platform.hosted()) return platform.displayName() || 'Player';
  return saveDoc.profileName || 'Guest';
}
function setPlayerName(n) {
  saveDoc.profileName = (n || '').slice(0, 24) || 'Guest';
  persist();
}

// ---------- tutorial (Learn) ----------
let lessonIdx = -1;
function startLesson(i) {
  const lessons = Content.tutorialLessons();
  lessonIdx = i;
  const lesson = lessons[i];
  const cfg = lesson.cfg;
  session.cfg = cfg;
  session.mode = 'learn';
  session.state = Rules.createGame(cfg);
  // deterministic lesson fixtures
  if (lesson.force && lesson.force.counterTypes)
    lesson.force.counterTypes.forEach((t, k) => { session.state.counter[k] = t; });
  if (lesson.force && lesson.force.counter0)
    session.state.counter[0] = lesson.force.counter0;
  if (lesson.force && lesson.force.shelves)
    lesson.force.shelves.forEach((row, r) => row.forEach((t, c) => { session.state.shelves[r][c] = t; }));
  session.log = []; session.undoStack = []; session.invalid = 0;
  session.assists = false; session.elapsedMs = 0;
  session.lastStamp = performance.now();
  session.paused = false; session.active = true;
  session.lesson = { ...lesson, count: 0 };
  selected = null; cursor = null;
  if (renderer) {
    renderer.setTheme(cfg.theme || saveDoc.settings.theme);
    renderer.buildBoard(session.state);
  }
  hideScreens();
  setHudVisible(true);
  $('lesson-banner').classList.remove('hidden');
  renderLessonBanner();
  updateHud();
  buildMirror();
  if (saveDoc.settings.boardMirror) $('board-mirror').classList.remove('hidden');
  announce(T('Lesson {n}: {title}', { n: i + 1, title: T(lesson.title) }) + '. ' + T(lesson.text));
}
function renderLessonBanner() {
  const lesson = Content.tutorialLessons()[lessonIdx];
  if (!lesson) return;
  $('lesson-title').textContent = T('Lesson {n}: {title}', { n: lessonIdx + 1, title: T(lesson.title) });
  $('lesson-text').textContent = T(lesson.text);
  $('lesson-toggle').textContent = T($('lesson-banner').classList.contains('collapsed') ? 'Show' : 'Hide');
}
function lessonProgress(events, action) {
  const L = session.lesson;
  if (!L) return;
  const goal = L.goal;
  let hit = 0;
  if (goal.event === 'undo' && action === 'undo') hit = 1;
  else hit = events.filter(e => e.type === goal.event).length;
  L.count += hit;
  if (goal.event === 'win' && events.some(e => e.type === 'win')) L.count = goal.count;
  if (L.count >= goal.count) {
    saveDoc.progress.tutorialDone[L.id] = true;
    persist();
    toast(T('Lesson complete!'));
    Audio.play('win');
    announce(T('Lesson complete.'));
    const next = lessonIdx + 1;
    session.lesson = null;
    $('lesson-banner').classList.add('hidden');
    if (next < Content.tutorialLessons().length) {
      setTimeout(() => startLesson(next), 900);
    } else {
      endActiveSession();
      setTimeout(() => { toast(T('Tutorial finished — the boutique is yours!')); goTitle(); }, 900);
    }
  }
}
$('lesson-toggle').addEventListener('click', () => {
  const b = $('lesson-banner');
  const collapsed = b.classList.toggle('collapsed');
  $('lesson-toggle').textContent = T(collapsed ? 'Show' : 'Hide');
  $('lesson-toggle').setAttribute('aria-expanded', String(!collapsed));
  if (renderer) renderer.resize();
});
$('lesson-quit').addEventListener('click', () => {
  session.lesson = null;
  $('lesson-banner').classList.add('hidden');
  endActiveSession();
  goTitle();
});

// ---------- gamepad ----------
let padState = { buttons: [], axisX: 0, axisY: 0, lastMove: 0 };
let remapAction = null;
function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = pads && pads[0];
  if (!gp) return;
  if (remapAction) {
    for (let i = 0; i < gp.buttons.length; i++) {
      if (gp.buttons[i].pressed) {
        saveDoc.settings['pad_' + remapAction] = i;
        persist();
        toast(T('{action} → button {n}', { action: T(remapAction), n: i }));
        remapAction = null;
        UI.buildSettingsForm($('settings-form'), ctx);
        return;
      }
    }
    return;
  }
  const s = saveDoc.settings;
  const btn = (def, custom) => gp.buttons[custom != null ? custom : def] && gp.buttons[custom != null ? custom : def].pressed;
  const pressed = {
    confirm: btn(0, s['pad_confirm']), cancel: btn(1, s['pad_cancel']),
    pause: btn(9, s['pad_pause']), undo: btn(2, s['pad_undo'])
  };
  for (const k in pressed) {
    if (pressed[k] && !padState.buttons[k]) {
      if (k === 'confirm') onConfirm();
      else if (k === 'cancel') onCancel();
      else if (k === 'pause') togglePause();
      else if (k === 'undo') doUndo();
    }
    padState.buttons[k] = pressed[k];
  }
  // d-pad / left stick → cursor
  const ax = (gp.axes[0] || 0) + (gp.buttons[15] && gp.buttons[15].pressed ? 1 : 0) - (gp.buttons[14] && gp.buttons[14].pressed ? 1 : 0);
  const ay = (gp.axes[1] || 0) + (gp.buttons[13] && gp.buttons[13].pressed ? 1 : 0) - (gp.buttons[12] && gp.buttons[12].pressed ? 1 : 0);
  const t = performance.now();
  if ((Math.abs(ax) > 0.5 || Math.abs(ay) > 0.5) && t - padState.lastMove > 180) {
    padState.lastMove = t;
    moveCursor(Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'right' : 'left') : (ay > 0 ? 'down' : 'up'));
  }
}
setInterval(pollGamepad, 50);

// ---------- keyboard / cursor ----------
function cursorGrid() {
  // ordered rows top→bottom for arrow navigation; counter last
  const s = session.state;
  if (!s) return [];
  const rows = [];
  for (let r = s.shelves.length - 1; r >= 0; r--)
    rows.push(s.shelves[r].map((_, c) => ({ area: 'shelf', r, c })));
  rows.push(s.counter.map((_, i) => ({ area: 'counter', i })));
  return rows;
}
function moveCursor(dir) {
  if (!session.active || session.paused) return;
  const grid = cursorGrid();
  if (!grid.length) return;
  if (!cursor) { cursor = grid[grid.length - 1][0]; }
  else {
    let ri = grid.findIndex(row => row.some(l => Rules.locEq(l, cursor)));
    let ci = grid[ri].findIndex(l => Rules.locEq(l, cursor));
    if (dir === 'left') ci = Math.max(0, ci - 1);
    else if (dir === 'right') ci = Math.min(grid[ri].length - 1, ci + 1);
    else if (dir === 'up') ri = Math.max(0, ri - 1);
    else if (dir === 'down') ri = Math.min(grid.length - 1, ri + 1);
    ci = Math.min(ci, grid[ri].length - 1);
    cursor = grid[ri][ci];
  }
  if (renderer) renderer.setCursor(cursor);
  Audio.play('ui');
}
function focusMirrorCell(loc) {
  if (!loc) return;
  const btn = $('board-mirror').querySelector('[data-loc="' + locKey(loc) + '"]');
  if (btn) btn.focus({ preventScroll: false });
}
function onConfirm() {
  if (!session.active || session.paused) return;
  if (!cursor) { moveCursor(); return; }
  tapCell(cursor);
}
function onCancel() {
  if (selected) deselect();
  else if (session.active) togglePause();
}
function togglePause() {
  if (!session.active) return;
  if (session.paused) resumeRound(); else pauseRound();
}

document.addEventListener('keydown', e => {
  const inField = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName || '');
  const action = platform.actionFor(e.code);
  if (action === 'cancel') {
    if (screenStack[screenStack.length - 1] === 'settings' || screenStack[screenStack.length - 1] === 'help') { back(); return; }
    onCancel();
    return;
  }
  if (inField) return;
  if (!session.active) return;
  // A focused DOM board button is the playfield in the accessible/no-WebGL
  // path: leave Enter/Space to activate it natively, and let the arrows move
  // real DOM focus so keyboard play matches what the focus ring shows.
  const onMirrorCell = document.activeElement && document.activeElement.dataset &&
    document.activeElement.dataset.loc && document.activeElement.closest('#board-mirror');
  if (onMirrorCell) {
    if (action === 'confirm') return;
    if (action === 'left' || action === 'right' || action === 'up' || action === 'down') {
      e.preventDefault();
      moveCursor(action);
      focusMirrorCell(cursor);
      return;
    }
  }
  switch (action) {
    case 'left': case 'right': case 'up': case 'down': e.preventDefault(); moveCursor(action); break;
    case 'confirm': e.preventDefault(); onConfirm(); break;
    case 'undo': doUndo(); break;
    case 'hint': doHint(); break;
    case 'pause': togglePause(); break;
    case 'skip': renderer && renderer.skipAll(); break;
    case 'camera': if (renderer) { renderer.setCursor(null); cursor = null; renderer.resize(); } break;
  }
});

// ---------- pointer input ----------
function bindPointer() {
  const host = $('scene-host');
  let down = null, dragging = false;
  const DRAG_PX = 12, HOLD_MS = 220;

  host.addEventListener('pointerdown', e => {
    if (!session.active || session.paused || !renderer) return;
    Audio.start();
    down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, loc: renderer.pickLoc(e.clientX, e.clientY) };
    dragging = false;
    try { host.setPointerCapture(e.pointerId); } catch (err) {}
  });
  host.addEventListener('pointermove', e => {
    if (!renderer) return;
    // gentle parallax (never affects raycast truth)
    const r = host.getBoundingClientRect();
    renderer.setParallax((e.clientX - r.left) / r.width - 0.5, (e.clientY - r.top) / r.height - 0.5);
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    const hold = saveDoc.settings.holdToDrag === 'hold';
    if (!dragging && Math.hypot(dx, dy) > DRAG_PX && (hold || performance.now() - down.t > HOLD_MS || (down.loc && down.loc.item))) {
      dragging = true;
      if (down.loc && down.loc.item && !selected) selectCell(down.loc.loc);
    }
    if (dragging && selected) {
      const over = renderer.pickLoc(e.clientX, e.clientY);
      if (over && legalTarget(over.loc)) renderer.showGhost(over.loc, Rules.getCell(session.state, selected));
      else renderer.hideGhost();
    }
  });
  function release(e, cancelled) {
    if (!down) return;
    const wasDrag = dragging;
    down = null; dragging = false;
    if (!session.active || session.paused || !renderer) return;
    if (cancelled) { renderer.hideGhost(); return; } // lost capture: cancel safely
    const over = renderer.pickLoc(e.clientX, e.clientY);
    renderer.hideGhost();
    if (wasDrag) {
      if (over && selected && !Rules.locEq(over.loc, selected)) {
        if (legalTarget(over.loc)) commitMove(selected, over.loc);
        else invalidFeedback(Rules.checkMove(session.state, selected, over.loc) || 'occupied-target');
      } else deselect();
    } else if (over) {
      tapCell(over.loc);
    } else if (selected) deselect();
  }
  host.addEventListener('pointerup', e => release(e, false));
  host.addEventListener('pointercancel', e => release(e, true));
  host.addEventListener('lostpointercapture', () => { if (down) { down = null; dragging = false; if (renderer) renderer.hideGhost(); } });
}

// ---------- HUD buttons ----------
$('btn-pause').addEventListener('click', () => pauseRound());
$('btn-resume').addEventListener('click', () => resumeRound());
$('btn-undo').addEventListener('click', doUndo);
$('btn-hint').addEventListener('click', doHint);
$('btn-skip').addEventListener('click', () => renderer && renderer.skipAll());
$('btn-camera').addEventListener('click', () => { if (renderer) { cursor = null; renderer.setCursor(null); renderer.resize(); } });
$('btn-restart').addEventListener('click', () => {
  if (!session.cfg) return;
  const cfg = session.cfg;
  startRound(cfg, session.mode);
});
$('btn-leave').addEventListener('click', () => {
  if (session.active && session.state && !session.state.terminal)
    Rules.applyCommand(session.state, { type: 'resign' }); // ends the round as a loss
  endActiveSession();
  goTitle();
});
$('btn-pause-settings').addEventListener('click', () => { UI.buildSettingsForm($('settings-form'), ctx); show('settings'); });
$('btn-pause-help').addEventListener('click', () => { UI.buildHelp($('help-body'), ctx); show('help'); });

// ---------- results buttons ----------
$('btn-results-retry').addEventListener('click', () => { startRound(session.cfg, session.mode); });
$('btn-results-menu').addEventListener('click', () => { endActiveSession(); goTitle(); });
$('btn-results-next').addEventListener('click', () => {
  const n = nextLevelCfg();
  if (n) startRound(n, 'journey'); else { endActiveSession(); goTitle(); }
});

// ---------- title buttons ----------
$('btn-play').addEventListener('click', () => { Audio.play('ui'); UI.buildModeList($('mode-list'), ctx); show('modes'); });
$('btn-daily').addEventListener('click', () => { Audio.play('ui'); openMode('daily'); });
$('btn-journey').addEventListener('click', () => { Audio.play('ui'); openMode('journey'); });
$('btn-profile').addEventListener('click', () => { Audio.play('ui'); UI.buildProfile($('profile-body'), ctx); show('profile'); });
$('btn-help').addEventListener('click', () => { Audio.play('ui'); UI.buildHelp($('help-body'), ctx); show('help'); });
$('btn-settings').addEventListener('click', () => { Audio.play('ui'); UI.buildSettingsForm($('settings-form'), ctx); show('settings'); });
$('btn-leaderboard').addEventListener('click', () => { Audio.play('ui'); showLeaderboard('endless'); });
$('btn-start-round').addEventListener('click', () => { if (ctx.setupStart) ctx.setupStart(); });

let setupMode = null;
function openMode(mode) {
  if (mode === 'journey') { UI.buildJourney($('journey-grid'), ctx); show('journey'); return; }
  if (mode === 'learn') { UI.buildLessonList($('lesson-list'), ctx); show('learn'); return; }
  refreshDaily();
  setupMode = mode;
  UI.buildSetup($('setup-body'), ctx, mode);
  show('setup');
}
let lbSeq = 0, lbTab = 'endless';
function showLeaderboard(tab) {
  lbTab = tab;
  // Local records render immediately; the platform's high-score board
  // arrives when signed in.
  UI.buildLeaderboard($('lb-body'), ctx, leaderboardEntries(tab), tab, null);
  show('leaderboard');
  if (!platform.hosted()) return;
  const req = ++lbSeq;
  platform.fetchPlatformLeaderboard(50).then(platformEntries => {
    if (platformEntries && req === lbSeq &&
        document.getElementById('app').dataset.screen === 'leaderboard') {
      UI.buildLeaderboard($('lb-body'), ctx, leaderboardEntries(tab), tab, platformEntries);
    }
  });
}
function remapGamepad(action) {
  remapAction = action;
  toast(T('Press a gamepad button for “{action}”…', { action: T(action) }), 4000);
}
function resetSave() {
  if (!confirm(T('Erase ALL local progress, settings, and scores?'))) return;
  saveDoc = Store.fresh();
  persist();
  applySettings();
  toast(T('Local data erased.'));
  goTitle();
}

// ---------- shared ctx for ui.js ----------
const ctx = {
  gfx: window.SSGfx,
  graphicsInfo: () => (renderer ? renderer.graphicsInfo() : null),
  Rules, Content, Store, SSRNG: RNG, platform,
  get saveDoc() { return saveDoc; },
  set saveDoc(v) { saveDoc = v; },
  dailyCfg: null,
  totalStars, applySettings, persist, startRound, startLesson, openMode,
  showLeaderboard, remapGamepad, resetSave, playerName, setPlayerName,
  lang, cfgName, shownName,
  setupStart: null
};
Object.defineProperty(ctx, 'dailyCfg', { get: () => dailyCfg });

// ---------- timers ----------
setInterval(() => { // HUD clock + daily countdown
  if (session.active && !session.paused) { tickClock(); updateHud(); }
  if (document.getElementById('app').dataset.screen === 'title')
    $('daily-countdown').textContent = dailyCountdownText();
}, 1000);

// ---------- lifecycle ----------
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Only auto-resume a round that this handler paused: a round the player
    // paused deliberately (or left to open Settings/Help) must stay paused.
    pausedByHide = session.active && !session.paused;
    pauseRound(false);
    if (renderer) renderer.setRunning(false);
    Audio.suspend();
  } else if (session.active && pausedByHide) {
    pausedByHide = false;
    resumeRound();
    toast(T('Welcome back — round resumed.'));
  }
});
window.addEventListener('resize', () => renderer && renderer.resize());
// Refit the board whenever HUD chrome (lesson banner, rails, tray) changes size
// or visibility, so it is framed in the uncovered part of the screen.
{
  let refit = 0;
  const schedule = () => {
    cancelAnimationFrame(refit);
    refit = requestAnimationFrame(() => {
      const b = $('lesson-banner');
      const h = b.classList.contains('hidden') ? 0 : b.getBoundingClientRect().height;
      // visual px → layout px inside the zoomed HUD (ui-scale.js)
      $('app').style.setProperty('--banner-h', Math.round(h / ((window.UIScale && UIScale.value) || 1)) + 'px');
      if (renderer) renderer.resize();
    });
  };
  const watched = ['lesson-banner', 'hud-top', 'hud-orders', 'hud-actions'].map((id) => $(id)).filter(Boolean);
  if (typeof ResizeObserver === 'function') { const ro = new ResizeObserver(schedule); watched.forEach((el) => ro.observe(el)); }
  const mo = new MutationObserver(schedule);
  watched.forEach((el) => mo.observe(el, { attributes: true, attributeFilter: ['class'] }));
  mo.observe($('app'), { attributes: true, attributeFilter: ['data-screen'] });
}
window.addEventListener('orientationchange', () => setTimeout(() => renderer && renderer.resize(), 60));

// ---------- language ----------
// A change re-renders every text built in code, in place: title, the open
// screen (keeping setup choices), HUD, board mirror, lesson banner, results.
function refreshLanguage() {
  updateSyncStatus();
  refreshTitle();
  const screen = document.getElementById('app').dataset.screen;
  if (screen === 'modes') UI.buildModeList($('mode-list'), ctx);
  else if (screen === 'setup' && setupMode) {
    const keep = {};
    $('setup-body').querySelectorAll('select[id], input[id]').forEach((n) => { keep[n.id] = n.value; });
    UI.buildSetup($('setup-body'), ctx, setupMode);
    $('setup-body').querySelectorAll('select[id], input[id]').forEach((n) => {
      if (keep[n.id] != null) { n.value = keep[n.id]; n.dispatchEvent(new Event('change')); }
    });
  } else if (screen === 'journey') UI.buildJourney($('journey-grid'), ctx);
  else if (screen === 'learn') UI.buildLessonList($('lesson-list'), ctx);
  else if (screen === 'profile') UI.buildProfile($('profile-body'), ctx);
  else if (screen === 'help') UI.buildHelp($('help-body'), ctx);
  else if (screen === 'leaderboard') showLeaderboard(lbTab);
  else if (screen === 'settings') UI.buildSettingsForm($('settings-form'), ctx);
  else if (screen === 'results' && lastResults) {
    UI.buildResults(ctx, lastResults);
    if (lbState && !$('results-lb').hidden) $('results-lb').textContent = lbText(lbState);
  }
  if (session.state) { updateHud(); buildMirror(); }
  if (session.lesson || !$('lesson-banner').classList.contains('hidden')) renderLessonBanner();
}
I18N.onLanguage(refreshLanguage);

// ---------- boot ----------
function boot() {
  applySettings();
  refreshDaily();
  if (webglAvailable()) {
    try {
      renderer = createRenderer({
        host: $('scene-host'), content: Content, settings: saveDoc.settings, rng: RNG
      });
    } catch (e) {
      console.error('renderer init failed', e);
      renderer = null;
    }
  }
  if (!renderer) {
    $('webgl-fallback').classList.remove('hidden');
    saveDoc.settings.boardMirror = true; // DOM board becomes the playfield
  }
  $('webgl-continue').addEventListener('click', () => $('webgl-fallback').classList.add('hidden'));
  bindPointer();
  goTitle();
  // audio starts on first interaction (autoplay policy)
  const kick = () => { Audio.start(); document.removeEventListener('pointerdown', kick); document.removeEventListener('keydown', kick); };
  document.addEventListener('pointerdown', kick);
  document.addEventListener('keydown', kick);
  // Hosted iff a launch token was read: authenticate, pull the cloud save
  // (remote wins), and show account/sync status. The game never calls its own
  // server routes; the daily uses the local clock.
  platform.start();
  updateSyncStatus();
  if (platform.hosted()) void hostedBoot();
}

boot();

// Debug/testing hook (read-only state access + the same input path the UI uses)
window.__ss = { session, tapCellForTest: tapCell, get save() { return saveDoc; } };
