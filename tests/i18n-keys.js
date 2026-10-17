// Key extraction for the i18n coverage test (also handy for listing keys):
// literal T('…') / N('…') calls in js/, data-i18n markup in index.html, and
// the display fields of the content tables.
'use strict';
const fs = require('fs');
const path = require('path');
const Content = require('../js/content.js');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['i18n.js', 'sh-strings.js', 'gfx.js']);
const unescape = (s) => s.replace(/\\(['"\\`])/g, '$1');

function sourceKeys() {
  const keys = new Set();
  const ternary = /(?<![\w.$])T\([^'"\n()]*?\?\s*'((?:[^'\\\n]|\\.)*)'\s*:\s*'((?:[^'\\\n]|\\.)*)'/g;
  const call = /(?<![\w.$])(?:T|N)\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")/g;
  const dir = path.join(ROOT, 'js');
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js') || SKIP.has(f)) continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(call)) keys.add(unescape(m[1] ?? m[2]));
    for (const m of src.matchAll(ternary)) { keys.add(unescape(m[1])); keys.add(unescape(m[2])); }
  }
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-aria|-title)?="([^"]+)"/g)) keys.add(m[1].replace(/&quot;/g, '"'));
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
  // Sound captions (js/audio.js CAPTIONS), shown through T() in main.js.
  add('select', 'place', 'not allowed', 'delivery', 'triple cleared', 'order complete', 'stage complete', 'round lost', 'undo', 'hint');
  // Default stored player names, shown through shownName().
  add('Guest', 'Player');
  return keys;
}

const ALL = new Set([...sourceKeys(), ...contentKeys()]);
module.exports = { ALL, sourceKeys, contentKeys };
