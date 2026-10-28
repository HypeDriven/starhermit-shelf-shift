// Key extraction for the i18n coverage test (also handy for listing keys):
// literal T("…") / N("…") calls in the engine client (native/*.ts) and the
// display fields of the content tables.
'use strict';
const fs = require('fs');
const path = require('path');
const Content = require('../js/content.js');

const ROOT = path.join(__dirname, '..');
const unescape = (s) => s.replace(/\\(['"\\`])/g, '$1');

function sourceKeys() {
  const keys = new Set();
  const ternary = /(?<![\w.$])T\([^'"\n()]*?\?\s*(?:N\()?"((?:[^"\\\n]|\\.)*)"\)?\s*:\s*(?:N\()?"((?:[^"\\\n]|\\.)*)"/g;
  const call = /(?<![\w.$])(?:T|N)\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")/g;
  const dir = path.join(ROOT, 'native');
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.ts')) continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(call)) keys.add(unescape(m[1] ?? m[2]));
    for (const m of src.matchAll(ternary)) { keys.add(unescape(m[1])); keys.add(unescape(m[2])); }
  }
  return keys;
}

function contentKeys() {
  const keys = new Set();
  const add = (...v) => v.forEach((s) => { if (typeof s === 'string' && s) keys.add(s); });
  Object.values(Content.ITEMS).forEach((i) => add(i.label));
  Content.THEMES.forEach((t) => add(t.name));
  Content.JOURNEY.forEach((l) => add(l.name, l.intro));
  Content.CHALLENGES.forEach((c) => add(c.name, c.intro));
  Content.PRACTICE.forEach((p) => add(p.name));
  add(Content.SCORE_CHASE.name, Content.SCORE_CHASE.intro, Content.dailyConfig('2026-01-01').intro);
  Content.tutorialLessons().forEach((l) => add(l.title, l.text));
  Content.ACHIEVEMENTS.forEach((a) => add(a.name, a.desc));
  // Sound captions (main.ts CAPTIONS, N() marked) are found in the source.
  // Default stored player names, shown through shownName().
  add('Guest', 'Player');
  return keys;
}

const ALL = new Set([...sourceKeys(), ...contentKeys()]);
module.exports = { ALL, sourceKeys, contentKeys };
