/* Shelf Shift — DOM UI builders: screens, settings form, boards.
 * Pure view layer over the shared ctx object assembled in main.js.
 * Loaded as a classic script; used by the ES-module bootstrap.
 */
(function (root) {
  'use strict';

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (attrs[k] === null || attrs[k] === undefined) continue;
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(c => n.appendChild(c));
    return n;
  }

  function fmtTime(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  }

  // ---------- mode cards ----------
  function buildModeList(host, ctx) {
    host.innerHTML = '';
    const modes = [
      { id: 'learn', name: 'Learn', desc: 'Interactive lessons — one rule at a time. ~2 minutes.' },
      { id: 'journey', name: 'Journey', desc: '40 authored stages with rising stakes and mastery tests.' },
      { id: 'daily', name: 'Daily', desc: 'One shared seed per UTC day. Compare scores worldwide.' },
      { id: 'practice', name: 'Practice', desc: 'Relaxed play with undo and hints. Never ranked.' },
      { id: 'challenge', name: 'Challenge', desc: 'Move limits, speed targets, tight counters.' },
      { id: 'score', name: 'Score chase', desc: 'Endless counter — play until it overflows. Ranked.' }
    ];
    for (const m of modes) {
      host.appendChild(el('button', {
        class: 'btn mode-card', onclick: () => ctx.openMode(m.id)
      }, [el('strong', { text: m.name }), el('span', { class: 'mini', text: m.desc })]));
    }
  }

  // ---------- mode setup ----------
  function buildSetup(host, ctx, mode) {
    host.innerHTML = '';
    const C = ctx.Content;
    const add = (...nodes) => nodes.forEach(n => host.appendChild(n));
    const rulesLine = cfg => {
      const bits = [];
      bits.push(cfg.board.shelves + '×' + cfg.board.cols + ' shelves', cfg.board.counter + ' staging cells');
      if (cfg.delivery) bits.push('delivery every ' + cfg.delivery.every + ' move' + (cfg.delivery.every > 1 ? 's' : '') + (cfg.delivery.per > 1 ? ' ×' + cfg.delivery.per : ''));
      if (cfg.moveLimit) bits.push(cfg.moveLimit + ' move limit');
      if (cfg.timeLimitSec) bits.push(fmtTime(cfg.timeLimitSec * 1000) + ' time limit');
      if (!cfg.mechanics.undo) bits.push('no undo');
      if (!cfg.mechanics.hint) bits.push('no hints');
      return bits.join(' · ');
    };

    if (mode === 'practice') {
      add(el('p', { text: 'Relaxed play. Undo and hints allowed; results are never ranked.' }));
      const sel = el('select', { id: 'practice-diff', 'aria-label': 'Difficulty' });
      C.PRACTICE.forEach(p => sel.appendChild(el('option', { value: p.id, text: p.name })));
      add(el('label', {}, [document.createTextNode('Difficulty '), sel]));
      const seedIn = el('input', { id: 'practice-seed', type: 'text', placeholder: 'random', 'aria-label': 'Seed (optional)' });
      add(el('label', {}, [document.createTextNode('Seed (optional) '), seedIn]));
      const themeSel = themeSelect(ctx);
      add(themeSel);
      add(el('p', { class: 'mini', id: 'setup-rules' }));
      const upd = () => {
        const p = C.PRACTICE.find(x => x.id === sel.value);
        host.querySelector('#setup-rules').textContent = rulesLine(p);
      };
      sel.addEventListener('change', upd); upd();
      ctx.setupStart = () => {
        const p = C.PRACTICE.find(x => x.id === sel.value);
        const seedTxt = seedIn.value.trim();
        const seed = seedTxt ? ctx.SSRNG.hashString(seedTxt) : (Math.random() * 0xffffffff) >>> 0;
        ctx.startRound(Object.assign({}, p, { seed, theme: themeSel.value }));
      };
    } else if (mode === 'daily') {
      const cfg = ctx.dailyCfg;
      add(el('p', { text: cfg.name + ' — one shared seed for everyone today. Ranked.' }));
      add(el('p', { class: 'mini', text: rulesLine(cfg) }));
      add(el('p', { class: 'mini', text: 'Seed ' + cfg.seed + ' · content v' + cfg.version }));
      const done = ctx.saveDoc.progress.dailiesDone[cfg.date];
      if (done != null) add(el('p', { text: 'Completed today: ' + done + ' points. You can replay to improve.' }));
      ctx.setupStart = () => ctx.startRound(cfg);
    } else if (mode === 'challenge') {
      const sel = el('select', { id: 'challenge-pick', 'aria-label': 'Challenge' });
      C.CHALLENGES.forEach(c => sel.appendChild(el('option', { value: c.id, text: c.name })));
      add(el('label', {}, [document.createTextNode('Challenge '), sel]));
      add(el('p', { class: 'mini', id: 'setup-rules' }));
      add(el('p', { class: 'mini', id: 'setup-best' }));
      const upd = () => {
        const c = C.CHALLENGES.find(x => x.id === sel.value);
        host.querySelector('#setup-rules').textContent = (c.intro ? c.intro + ' — ' : '') + rulesLine(c);
        const best = ctx.saveDoc.progress.challengeBest[c.id];
        host.querySelector('#setup-best').textContent = best ? 'Your best: ' + best : 'Ranked.';
      };
      sel.addEventListener('change', upd); upd();
      ctx.setupStart = () => ctx.startRound(C.CHALLENGES.find(x => x.id === sel.value));
    } else if (mode === 'score') {
      const c = C.SCORE_CHASE;
      add(el('p', { text: c.name + ': ' + c.intro }));
      add(el('p', { class: 'mini', text: rulesLine(c) }));
      const seedIn = el('input', { id: 'score-seed', type: 'text', placeholder: 'random', 'aria-label': 'Seed (optional)' });
      add(el('label', {}, [document.createTextNode('Seed (share to challenge others) '), seedIn]));
      add(el('p', { class: 'mini', text: 'Ranked · submissions verified by replaying your input log.' }));
      ctx.setupStart = () => {
        const seedTxt = seedIn.value.trim();
        const seed = seedTxt ? ctx.SSRNG.hashString(seedTxt) : (Math.random() * 0xffffffff) >>> 0;
        ctx.startRound(Object.assign({}, c, { seed }));
      };
    }
  }

  function themeSelect(ctx) {
    const sel = el('select', { id: 'setup-theme', 'aria-label': 'Theme' });
    const stars = ctx.totalStars();
    ctx.Content.THEMES.forEach(t => {
      const locked = stars < t.unlockStars;
      sel.appendChild(el('option', {
        value: t.id, text: t.name + (locked ? ' 🔒 ' + t.unlockStars + '★' : ''), disabled: locked ? 'disabled' : null
      }));
    });
    sel.value = ctx.saveDoc.settings.theme;
    sel.addEventListener('change', () => {
      ctx.saveDoc.settings.theme = sel.value;
      ctx.applySettings();
      ctx.persist();
    });
    return el('label', {}, [document.createTextNode('Theme '), sel]);
  }

  // ---------- journey grid ----------
  function buildJourney(host, ctx) {
    host.innerHTML = '';
    const prog = ctx.saveDoc.progress;
    const C = ctx.Content;
    document.getElementById('journey-stars-total').textContent =
      ctx.totalStars() + ' / ' + (C.JOURNEY.length * 3) + ' stars';
    C.JOURNEY.forEach((lvl, i) => {
      const stars = prog.journeyStars[lvl.id] || 0;
      const unlocked = i === 0 || (prog.journeyStars[C.JOURNEY[i - 1].id] || 0) > 0;
      const cell = el('button', {
        class: 'level-cell' + (lvl.mastery ? ' mastery' : ''),
        disabled: unlocked ? null : 'disabled',
        'aria-label': 'Stage ' + (i + 1) + ': ' + lvl.name + (unlocked ? ', ' + stars + ' stars' : ', locked'),
        onclick: () => unlocked && ctx.startRound(lvl)
      }, [
        el('span', { text: String(i + 1) }),
        el('span', { class: 'lvl-stars', text: '★'.repeat(stars) + '☆'.repeat(Math.max(0, 3 - stars)).slice(0, 3) })
      ]);
      if (lvl.mastery) cell.title = 'Mastery stage';
      host.appendChild(cell);
    });
  }

  // ---------- results ----------
  function buildResults(ctx, r) {
    // r: {won, reason, score, moves, elapsedMs, stars, mode, cfg, invalid, newAchievements, lbRank, bestImproved}
    document.getElementById('results-headline').textContent =
      r.won ? ({ 'orders-complete': 'Orders complete!' }[r.reason] || 'Stage complete!')
            : ({ 'staging-overflow': 'The counter overflowed!', 'move-limit': 'Out of moves!',
                 'time-up': 'Time ran out!', 'resigned': 'Round resigned.' }[r.reason] || 'Round over');
    const tb = document.querySelector('#results-table tbody');
    tb.innerHTML = '';
    const rows = [
      ['Triples cleared', r.score.clears + ' × ', r.score.clearPoints],
      ['Orders completed', '', r.score.orderBonus],
      ['Spare capacity', '', r.score.capacityBonus],
      ['Move bonus', r.cfg.par && r.cfg.par.moves ? 'par ' + r.cfg.par.moves : '', r.score.moveBonus],
      ['Time bonus', '', r.score.timeBonus]
    ];
    if (r.cfg.endless) rows.push(['Order waves finished', '', r.score.rounds]);
    for (const [label, note, val] of rows) {
      if (!val && label !== 'Triples cleared') continue;
      tb.appendChild(el('tr', {}, [
        el('td', { text: label }), el('td', { class: 'mini', text: note }),
        el('td', { text: String(val) })
      ]));
    }
    tb.appendChild(el('tr', { class: 'total' }, [
      el('td', { text: 'Total' }), el('td', {}), el('td', { text: String(r.score.total) })
    ]));
    document.getElementById('results-stars').textContent =
      r.stars ? '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars) : '';
    const ach = document.getElementById('results-achievements');
    ach.innerHTML = '';
    for (const a of r.newAchievements || [])
      ach.appendChild(el('li', { text: '🏆 ' + a.name + ' — ' + a.desc }));
    document.getElementById('results-compare').textContent =
      [r.lbRank != null ? 'Leaderboard rank #' + (r.lbRank + 1) : null,
       r.bestImproved ? 'New personal best!' : null,
       r.verified === true ? 'Score verified by replay.' : r.verified === false ? 'Score could not be verified (casual).' : null]
        .filter(Boolean).join(' · ');
    document.getElementById('btn-results-next').style.display = r.nextCfg ? '' : 'none';
  }

  // ---------- settings ----------
  function buildSettingsForm(host, ctx) {
    host.innerHTML = '';
    const s = ctx.saveDoc.settings;
    const fs = (legend, nodes) => el('fieldset', {}, [el('legend', { text: legend }), ...nodes]);
    const slider = (label, key) =>
      el('label', {}, [document.createTextNode(label),
        el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s[key],
          oninput: e => { s[key] = +e.target.value; ctx.applySettings(); ctx.persist(); } })]);
    const check = (label, key, extra) =>
      el('label', {}, [document.createTextNode(label),
        el('input', { type: 'checkbox', ...(s[key] ? { checked: 'checked' } : {}),
          onchange: e => { s[key] = e.target.checked; ctx.applySettings(); ctx.persist(); if (extra) extra(); } })]);
    const select = (label, key, opts2) =>
      el('label', {}, [document.createTextNode(label),
        el('select', { onchange: e => { s[key] = e.target.value; ctx.applySettings(); ctx.persist(); } },
          opts2.map(o => el('option', { value: o[0], text: o[1], ...(s[key] === o[0] ? { selected: 'selected' } : {}) })))]);

    host.appendChild(fs('Audio', [
      slider('Music', 'music'), slider('Effects', 'effects'),
      slider('Ambience', 'ambience'), slider('Voice cues', 'voice'),
      check('Mute all', 'muted'), check('Captions for audio cues', 'captions')
    ]));
    host.appendChild(fs('Graphics', [
      select('Quality tier', 'graphicsTier', [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]),
      select('Color palette', 'colorPalette', [['standard', 'Standard'], ['high-visibility', 'High visibility']])
    ]));
    host.appendChild(fs('Accessibility', [
      check('Reduced motion', 'reducedMotion'),
      check('High contrast', 'highContrast'),
      check('Larger text', 'largeText'),
      check('Left-handed controls', 'leftHanded'),
      check('Visible board controls (DOM)', 'boardMirror'),
      check('Confirm moves (tap target twice)', 'confirmMoves'),
      check('Haptics', 'haptics'),
      select('Selection style', 'holdToDrag', [['tap', 'Tap to select'], ['hold', 'Hold and drag']])
    ]));
    const remap = el('div', { class: 'stack' }, [el('p', { class: 'mini', text: 'Gamepad mapping — click an action, then press a gamepad button.' })]);
    for (const action of ['confirm', 'cancel', 'pause', 'undo']) {
      remap.appendChild(el('button', {
        class: 'btn ghost', onclick: () => ctx.remapGamepad(action)
      }, [document.createTextNode(action + ': button ' + (ctx.saveDoc.settings['pad_' + action] ?? 'default'))]));
    }
    host.appendChild(fs('Controls', [remap]));
    const danger = el('button', {
      class: 'btn danger', onclick: () => ctx.resetSave()
    }, [document.createTextNode('Erase all local progress')]);
    host.appendChild(fs('Data', [danger]));
  }

  // ---------- help ----------
  function buildHelp(host, ctx) {
    const s = ctx.saveDoc.settings;
    const cards = [
      ['Goal', 'Fill every order shown on the left. Orders ask for sets of three identical objects.'],
      ['Moving', s.holdToDrag === 'hold'
        ? 'Hold an object, drag it onto a glowing empty cell, and release.'
        : 'Tap an object to lift it, then tap any glowing empty cell to place it.'],
      ['Triples', 'Three identical objects on the same shelf row clear away and count toward orders.'],
      ['The counter', 'New stock arrives on the front counter. If a delivery finds no free staging cell, the round is lost.'],
      ['Scoring', 'Triples score 100 points plus streak bonuses. Winning adds bonuses for spare space, speed, and staying under par.'],
      ['Keyboard', 'Arrow keys move the focus ring · Enter select/place · Esc cancel · U undo · H hint · C camera · P pause.'],
      ['Gamepad', 'Stick or D-pad moves focus · ' + padLabel(s, 'confirm') + ' confirm · ' + padLabel(s, 'cancel') + ' cancel · ' + padLabel(s, 'pause') + ' pause · ' + padLabel(s, 'undo') + ' undo.']
    ];
    host.innerHTML = '';
    for (const [t, body] of cards)
      host.appendChild(el('div', { class: 'panel-2', style: 'padding:.6rem 0;border-bottom:1px solid #ffffff14' }, [
        el('h3', { text: t, style: 'margin:.2rem 0' }), el('p', { text: body, style: 'margin:.2rem 0;max-width:70ch' })
      ]));
  }
  function padLabel(s, action) {
    const v = s['pad_' + action];
    return v == null ? 'default' : 'btn ' + v;
  }

  // ---------- profile ----------
  function buildProfile(host, ctx) {
    host.innerHTML = '';
    const p = ctx.saveDoc.progress;
    const st = p.stats;
    if (ctx.platform.hosted()) {
      // Platform identity: nickname comes from the account profile (adapter);
      // the free-text display name below is the local-guest identity only.
      host.appendChild(el('div', { class: 'stat-grid' }, [
        stat('Account', ctx.platform.displayName() || 'Player'),
        stat('Cloud save', ctx.platform.syncLabel() || '—')
      ]));
    } else {
      const nameIn = el('input', {
        type: 'text', value: ctx.playerName(), maxlength: '24', 'aria-label': 'Display name',
        onchange: e => { ctx.setPlayerName(e.target.value); }
      });
      host.appendChild(el('label', {}, [document.createTextNode('Display name '), nameIn]));
    }
    host.appendChild(el('div', { class: 'stat-grid' }, [
      stat('Rounds', st.rounds), stat('Wins', st.wins), stat('Triples', st.clears),
      stat('Items cleared', st.itemsCleared), stat('Best streak', st.bestStreak),
      stat('Journey stars', ctx.totalStars()), stat('Play time', fmtTime(st.playMs))
    ]));
    host.appendChild(el('h3', { text: 'Achievements' }));
    const list = el('ul', { class: 'achievements' });
    for (const a of ctx.Content.ACHIEVEMENTS) {
      const got = p.achievements[a.key];
      list.appendChild(el('li', {
        text: (got ? '🏆 ' : '◻ ') + a.name + ' — ' + a.desc,
        style: got ? '' : 'opacity:.55'
      }));
    }
    host.appendChild(list);
    host.appendChild(el('h3', { text: 'Themes' }));
    const wrap = el('div', { class: 'row wrap' });
    const stars = ctx.totalStars();
    for (const t of ctx.Content.THEMES) {
      const locked = stars < t.unlockStars;
      wrap.appendChild(el('button', {
        class: 'btn' + (ctx.saveDoc.settings.theme === t.id ? ' primary' : ''),
        disabled: locked ? 'disabled' : null,
        text: t.name + (locked ? ' 🔒' + t.unlockStars + '★' : ''),
        onclick: () => { ctx.saveDoc.settings.theme = t.id; ctx.applySettings(); ctx.persist(); buildProfile(host, ctx); }
      }));
    }
    host.appendChild(wrap);
    function stat(label, val) {
      return el('div', { class: 'stat' }, [el('b', { text: String(val) }), el('span', { class: 'mini', text: label })]);
    }
  }

  // ---------- leaderboard ----------
  // entries: local records (always available). platformEntries: the
  // platform-owned global board, read-only — shown for the game's primary
  // ranked mode (Score chase) when the platform hosts one.
  function buildLeaderboard(host, ctx, entries, tab, platformEntries) {
    host.innerHTML = '';
    const tabs = el('div', { class: 'lb-tabs', role: 'tablist' });
    for (const t of [['endless', 'Score chase'], ['daily', 'Daily'], ['challenge', 'Challenges']]) {
      tabs.appendChild(el('button', {
        class: 'btn' + (tab === t[0] ? ' primary' : ''), role: 'tab',
        'aria-selected': tab === t[0] ? 'true' : 'false',
        text: t[1], onclick: () => ctx.showLeaderboard(t[0])
      }));
    }
    host.appendChild(tabs);
    host.appendChild(el('p', {
      class: 'mini',
      text: 'Entries carry ruleset, content version, seed, assists, and duration. Verified entries replay cleanly.'
    }));
    const table = el('table', { class: 'lb' });
    table.appendChild(el('tr', {}, [
      el('th', { text: '#' }), el('th', { text: 'Player' }), el('th', { text: 'When' }),
      el('th', { text: 'Meta' }), el('th', { text: 'Score' })
    ]));
    entries.forEach((e, i) => {
      table.appendChild(el('tr', { class: e.mine ? 'me' : '' }, [
        el('td', { text: String(i + 1) }),
        el('td', { text: e.name + (e.verified ? ' ✓' : '') + (e.assists ? ' (assists)' : '') }),
        el('td', { class: 'mini', text: e.date }),
        el('td', { class: 'mini', text: (e.ruleset || '') + ' · seed ' + e.seed + ' · ' + fmtTime(e.durationMs || 0) }),
        el('td', { text: String(e.score) })
      ]));
    });
    if (!entries.length) host.appendChild(el('p', { class: 'mini', text: 'No entries yet — be the first.' }));
    host.appendChild(table);
    if (tab === 'endless' && platformEntries && platformEntries.length) {
      host.appendChild(el('h3', { text: 'Platform rankings' }));
      host.appendChild(el('p', {
        class: 'mini',
        text: 'Global board hosted by StarHermit — read-only. Your ranked runs submit to the game backend for replay verification.'
      }));
      const pt = el('table', { class: 'lb' });
      pt.appendChild(el('tr', {}, [
        el('th', { text: '#' }), el('th', { text: 'Player' }), el('th', { text: 'Score' })
      ]));
      platformEntries.forEach((e, i) => {
        pt.appendChild(el('tr', {}, [
          el('td', { text: String(i + 1) }),
          el('td', { text: e.name }),
          el('td', { text: String(e.score) })
        ]));
      });
      host.appendChild(pt);
    }
  }

  // ---------- learn list ----------
  function buildLessonList(host, ctx) {
    host.innerHTML = '';
    const done = ctx.saveDoc.progress.tutorialDone;
    ctx.Content.tutorialLessons().forEach((l, i) => {
      host.appendChild(el('button', { class: 'btn mode-card', onclick: () => ctx.startLesson(i) }, [
        el('strong', { text: (done[l.id] ? '✓ ' : '') + (i + 1) + '. ' + l.title }),
        el('span', { class: 'mini', text: l.text.slice(0, 80) + '…' })
      ]));
    });
    host.appendChild(el('p', { class: 'mini', text: 'Lessons use the same legal-action rules as real play.' }));
  }

  root.SSUI = {
    el, fmtTime,
    buildModeList, buildSetup, buildJourney, buildResults,
    buildSettingsForm, buildHelp, buildProfile, buildLeaderboard, buildLessonList
  };
})(typeof self !== 'undefined' ? self : this);
