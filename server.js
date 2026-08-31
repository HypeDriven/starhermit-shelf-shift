/* Shelf Shift — authoritative host script (StarHermit-style).
 * Serves the static distribution plus a minimal same-origin API:
 *   GET  /api/v1/time                 server time for daily boundaries
 *   GET  /api/v1/daily/:date          canonical daily config (immutable)
 *   GET  /api/v1/leaderboard?board=…  ranked entries
 *   POST /api/v1/leaderboard          submit {…, log, cfgSnapshot, finalHash}
 *   POST /api/v1/telemetry            anonymous funnel events (204)
 *
 * Score submissions are validated by replaying the ordered input log
 * through the shared rules engine and comparing the terminal hash —
 * client claims are never trusted. Unverifiable entries are labeled
 * casual and kept out of ranked boards.
 *
 * Zero dependencies. Run: node server.js [port]
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const Rules = require('./js/rules.js');
const Content = require('./js/content.js');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const LB_FILE = path.join(DATA_DIR, 'leaderboards.json');
const PORT = +(process.argv[2] || process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8',
  '.opus': 'audio/ogg'
};

function loadBoards() {
  try { return JSON.parse(fs.readFileSync(LB_FILE, 'utf8')); }
  catch (e) { return { entries: [] }; }
}
function saveBoards(b) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LB_FILE, JSON.stringify(b));
}

// ---------- validation ----------
const MAX_BODY = 256 * 1024;
const rate = new Map(); // ip -> {count, resetAt}
function rateLimited(ip) {
  const now = Date.now();
  let r = rate.get(ip);
  if (!r || now > r.resetAt) { r = { count: 0, resetAt: now + 60000 }; rate.set(ip, r); }
  return ++r.count > 30;
}

function validBoardId(id) {
  if (id === 'endless') return true;
  let m = /^challenge-(.+)$/.exec(id);
  if (m) return Content.CHALLENGES.some(c => c.id === m[1]);
  m = /^daily-(\d{4}-\d{2}-\d{2})$/.exec(id);
  if (m) return !isNaN(Date.parse(m[1] + 'T00:00:00Z'));
  return false;
}

function canonicalCfg(board, snapshot) {
  // Rebuild the config from versioned content instead of trusting the
  // client-supplied snapshot; the seed is the only free parameter.
  if (!snapshot || !Number.isInteger(snapshot.seed)) return null;
  if (board === 'endless') return Object.assign({}, Content.SCORE_CHASE, { seed: snapshot.seed });
  let m = /^challenge-(.+)$/.exec(board);
  if (m) {
    const c = Content.CHALLENGES.find(x => x.id === m[1]);
    return c ? Object.assign({}, c) : null; // challenge seeds are fixed
  }
  m = /^daily-(\d{4}-\d{2}-\d{2})$/.exec(board);
  if (m) return Content.dailyConfig(m[1]); // immutable after publication
  return null;
}

function verifySubmission(entry) {
  // Structural checks
  if (!entry || typeof entry !== 'object') return { ok: false, error: 'malformed' };
  if (typeof entry.board !== 'string' || !validBoardId(entry.board)) return { ok: false, error: 'unknown board' };
  if (!Number.isInteger(entry.score) || entry.score < 0 || entry.score > 1000000) return { ok: false, error: 'implausible score' };
  if (!Array.isArray(entry.log) || entry.log.length > 20000) return { ok: false, error: 'bad log' };
  if (typeof entry.name !== 'string' || !entry.name.trim()) entry.name = 'Guest';
  entry.name = entry.name.slice(0, 24);

  const cfg = canonicalCfg(entry.board, entry.cfgSnapshot);
  if (!cfg) return { ok: false, error: 'unknown ruleset' };
  if (entry.version !== Content.CONTENT_VERSION) return { ok: false, error: 'stale content version' };

  // Authoritative replay of the input log.
  let state;
  try { state = Rules.createGame(cfg); } catch (e) { return { ok: false, error: 'bad cfg' }; }
  const seen = new Set();
  for (const cmd of entry.log) {
    if (Rules.validateCommandShape(cmd)) return { ok: false, error: 'malformed command' };
    if (cmd.id) { // duplicate commands rejected idempotently
      if (seen.has(cmd.id)) continue;
      seen.add(cmd.id);
    }
    const res = Rules.applyCommand(state, cmd);
    if (!res.ok) return { ok: false, error: 'illegal command in log' };
    state = res.state;
  }
  if (!state.terminal) return { ok: false, error: 'log does not reach a terminal state' };
  if (state.score.total !== entry.score) return { ok: false, error: 'score mismatch' };
  if (entry.finalHash != null && Rules.hashState(state) !== entry.finalHash) return { ok: false, error: 'hash mismatch' };
  if (entry.board.startsWith('daily-') || entry.board.startsWith('challenge-')) {
    if (!state.terminal.won) return { ok: false, error: 'round not won' };
  }
  return { ok: true, verified: true };
}

// ---------- http ----------
function send(res, code, body, type) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, {
    'content-type': type || 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(data);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = req.socket.remoteAddress || 'unknown';

  if (url.pathname === '/api/v1/time') {
    return send(res, 200, { now: Date.now() });
  }
  let m;
  if ((m = /^\/api\/v1\/daily\/(\d{4}-\d{2}-\d{2})$/.exec(url.pathname)) && req.method === 'GET') {
    if (isNaN(Date.parse(m[1] + 'T00:00:00Z'))) return send(res, 400, { error: 'bad date' });
    return send(res, 200, Content.dailyConfig(m[1]));
  }
  if (url.pathname === '/api/v1/telemetry' && req.method === 'POST') {
    // anonymous funnel only: event name + coarse data; nothing is stored long-term
    return readBody(req, res, () => send(res, 204, ''));
  }
  if (url.pathname === '/api/v1/leaderboard') {
    if (rateLimited(ip)) return send(res, 429, { error: 'rate limited' });
    if (req.method === 'GET') {
      const board = url.searchParams.get('board') || 'endless';
      if (!validBoardId(board)) return send(res, 400, { error: 'unknown board' });
      const boards = loadBoards();
      const entries = boards.entries
        .filter(e => e.board === board && e.verified)
        .sort((a, b) => b.score - a.score || (a.invalid || 0) - (b.invalid || 0) ||
                        (a.durationMs || 0) - (b.durationMs || 0) || String(a.sessionId).localeCompare(String(b.sessionId)))
        .slice(0, 100)
        .map(e => ({ name: e.name, score: e.score, seed: e.seed, ruleset: e.ruleset, version: e.version,
                      assists: !!e.assists, durationMs: e.durationMs, date: e.date, verified: true }));
      return send(res, 200, { board, entries });
    }
    if (req.method === 'POST') {
      return readBody(req, res, body => {
        let entry;
        try { entry = JSON.parse(body); } catch (e) { return send(res, 400, { error: 'bad json' }); }
        const v = verifySubmission(entry);
        if (!v.ok) return send(res, 422, { error: v.error });
        entry.verified = true;
        entry.submittedAt = Date.now();
        const boards = loadBoards();
        boards.entries.push(entry);
        if (boards.entries.length > 2000) boards.entries = boards.entries.slice(-2000);
        saveBoards(boards);
        return send(res, 200, { ok: true, verified: true });
      });
    }
    return send(res, 405, { error: 'method not allowed' });
  }
  if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });

  // static files (no secrets, no dotfiles, no path escape)
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT) || rel.includes('..') || path.basename(rel).startsWith('.')) {
    return send(res, 403, { error: 'forbidden' });
  }
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'not found' });
    const ext = path.extname(file).toLowerCase();
    const immutable = /^\/(vendor|js|css)\//.test(rel);
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=3600' : 'no-cache',
      'x-content-type-options': 'nosniff'
    });
    res.end(data);
  });
});

function readBody(req, res, cb) {
  let size = 0;
  const chunks = [];
  req.on('data', c => {
    size += c.length;
    if (size > MAX_BODY) { send(res, 413, { error: 'payload too large' }); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => cb(Buffer.concat(chunks).toString('utf8')));
  req.on('error', () => send(res, 400, { error: 'bad request' }));
}

server.listen(PORT, () => {
  console.log('Shelf Shift — http://localhost:' + PORT + '/');
});
