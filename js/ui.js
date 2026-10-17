/* Shelf Shift — DOM UI builders: screens, settings form, boards.
 * Pure view layer over the shared ctx object assembled in main.js.
 * Loaded as a classic script; used by the ES-module bootstrap.
 */
(function (root) {
  'use strict';
  // i18n.js (classic script, loaded first): English-keyed lookups in the game language.
  const T = (k, v) => (root.SSI18N ? root.SSI18N.T(k, v) : String(k).replace(/\{(\w+)\}/g, (m, x) => (v && v[x] != null ? v[x] : m)));
  const N = (k) => k;

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
      { id: 'learn', name: N('Learn'), desc: N('Interactive lessons — one rule at a time. ~2 minutes.') },
      { id: 'journey', name: N('Journey'), desc: N('40 authored stages with rising stakes and mastery tests.') },
      { id: 'daily', name: N('Daily'), desc: N('One shared seed per UTC day. Compare scores worldwide.') },
      { id: 'practice', name: N('Practice'), desc: N('Relaxed play with undo and hints. Never ranked.') },
      { id: 'challenge', name: N('Challenge'), desc: N('Move limits, speed targets, tight counters.') },
      { id: 'score', name: N('Score chase'), desc: N('Endless counter — play until it overflows. Ranked.') }
    ];
    for (const m of modes) {
      host.appendChild(el('button', {
        class: 'btn mode-card', 'data-mode': m.id, onclick: () => ctx.openMode(m.id)
      }, [el('strong', { text: T(m.name) }), el('span', { class: 'mini', text: T(m.desc) })]));
    }
  }

  // ---------- mode setup ----------
  function buildSetup(host, ctx, mode) {
    host.innerHTML = '';
    const C = ctx.Content;
    const add = (...nodes) => nodes.forEach(n => host.appendChild(n));
    const rulesLine = cfg => {
      const bits = [];
      bits.push(T('{shelves}×{cols} shelves', { shelves: cfg.board.shelves, cols: cfg.board.cols }), T('{n} staging cells', { n: cfg.board.counter }));
      if (cfg.delivery) {
        const every = T(cfg.delivery.every > 1 ? 'delivery every {n} moves' : 'delivery every move', { n: cfg.delivery.every });
        bits.push(every + (cfg.delivery.per > 1 ? ' ×' + cfg.delivery.per : ''));
      }
      if (cfg.moveLimit) bits.push(T('{n} move limit', { n: cfg.moveLimit }));
      if (cfg.timeLimitSec) bits.push(T('{time} time limit', { time: fmtTime(cfg.timeLimitSec * 1000) }));
      if (!cfg.mechanics.undo) bits.push(T('no undo'));
      if (!cfg.mechanics.hint) bits.push(T('no hints'));
      return bits.join(' · ');
    };

    if (mode === 'practice') {
      add(el('p', { text: T('Relaxed play. Undo and hints allowed; results are never ranked.') }));
      const sel = el('select', { id: 'practice-diff', 'aria-label': T('Difficulty') });
      C.PRACTICE.forEach(p => sel.appendChild(el('option', { value: p.id, text: T(p.name) })));
      add(el('label', {}, [document.createTextNode(T('Difficulty') + ' '), sel]));
      const seedIn = el('input', { id: 'practice-seed', type: 'text', placeholder: T('random'), 'aria-label': T('Seed (optional)') });
      add(el('label', {}, [document.createTextNode(T('Seed (optional)') + ' '), seedIn]));
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
      add(el('p', { text: T('{name} — one shared seed for everyone today. Ranked.', { name: ctx.cfgName(cfg) }) }));
      add(el('p', { class: 'mini', text: rulesLine(cfg) }));
      add(el('p', { class: 'mini', text: T('Seed {seed} · content v{version}', { seed: cfg.seed, version: cfg.version }) }));
      const done = ctx.saveDoc.progress.dailiesDone[cfg.date];
      if (done != null) add(el('p', { text: T('Completed today: {n} points. You can replay to improve.', { n: done }) }));
      ctx.setupStart = () => ctx.startRound(cfg);
    } else if (mode === 'challenge') {
      const sel = el('select', { id: 'challenge-pick', 'aria-label': T('Challenge') });
      C.CHALLENGES.forEach(c => sel.appendChild(el('option', { value: c.id, text: T(c.name) })));
      add(el('label', {}, [document.createTextNode(T('Challenge') + ' '), sel]));
      add(el('p', { class: 'mini', id: 'setup-rules' }));
      add(el('p', { class: 'mini', id: 'setup-best' }));
      const upd = () => {
        const c = C.CHALLENGES.find(x => x.id === sel.value);
        host.querySelector('#setup-rules').textContent = (c.intro ? T(c.intro) + ' — ' : '') + rulesLine(c);
        const best = ctx.saveDoc.progress.challengeBest[c.id];
        host.querySelector('#setup-best').textContent = best ? T('Your best: {n}', { n: best }) : T('Ranked.');
      };
      sel.addEventListener('change', upd); upd();
      ctx.setupStart = () => ctx.startRound(C.CHALLENGES.find(x => x.id === sel.value));
    } else if (mode === 'score') {
      const c = C.SCORE_CHASE;
      add(el('p', { text: T(c.name) + ': ' + T(c.intro) }));
      add(el('p', { class: 'mini', text: rulesLine(c) }));
      const seedIn = el('input', { id: 'score-seed', type: 'text', placeholder: T('random'), 'aria-label': T('Seed (optional)') });
      add(el('label', {}, [document.createTextNode(T('Seed (share to challenge others)') + ' '), seedIn]));
      add(el('p', { class: 'mini', text: T('Ranked · submissions verified by replaying your input log.') }));
      ctx.setupStart = () => {
        const seedTxt = seedIn.value.trim();
        const seed = seedTxt ? ctx.SSRNG.hashString(seedTxt) : (Math.random() * 0xffffffff) >>> 0;
        ctx.startRound(Object.assign({}, c, { seed }));
      };
    }
  }

  function themeSelect(ctx) {
    const sel = el('select', { id: 'setup-theme', 'aria-label': T('Theme') });
    const stars = ctx.totalStars();
    ctx.Content.THEMES.forEach(t => {
      const locked = stars < t.unlockStars;
      sel.appendChild(el('option', {
        value: t.id, text: T(t.name) + (locked ? ' 🔒 ' + t.unlockStars + '★' : ''), disabled: locked ? 'disabled' : null
      }));
    });
    sel.value = ctx.saveDoc.settings.theme;
    sel.addEventListener('change', () => {
      ctx.saveDoc.settings.theme = sel.value;
      ctx.applySettings();
      ctx.persist();
    });
    return el('label', {}, [document.createTextNode(T('Theme') + ' '), sel]);
  }

  // ---------- journey grid ----------
  function buildJourney(host, ctx) {
    host.innerHTML = '';
    const prog = ctx.saveDoc.progress;
    const C = ctx.Content;
    document.getElementById('journey-stars-total').textContent =
      T('{n} / {total} stars', { n: ctx.totalStars(), total: C.JOURNEY.length * 3 });
    C.JOURNEY.forEach((lvl, i) => {
      const stars = prog.journeyStars[lvl.id] || 0;
      const unlocked = i === 0 || (prog.journeyStars[C.JOURNEY[i - 1].id] || 0) > 0;
      const cell = el('button', {
        class: 'level-cell' + (lvl.mastery ? ' mastery' : ''),
        disabled: unlocked ? null : 'disabled',
        'aria-label': unlocked ? T('Stage {n}: {name}, {stars} stars', { n: i + 1, name: T(lvl.name), stars })
          : T('Stage {n}: {name}, locked', { n: i + 1, name: T(lvl.name) }),
        onclick: () => unlocked && ctx.startRound(lvl)
      }, [
        el('span', { text: String(i + 1) }),
        el('span', { class: 'lvl-stars', text: '★'.repeat(stars) + '☆'.repeat(Math.max(0, 3 - stars)).slice(0, 3) })
      ]);
      if (lvl.mastery) cell.title = T('Mastery stage');
      host.appendChild(cell);
    });
  }

  // ---------- results ----------
  function buildResults(ctx, r) {
    // r: {won, reason, score, moves, elapsedMs, stars, mode, cfg, invalid, newAchievements, lbRank, bestImproved}
    const won = { 'orders-complete': N('Orders complete!') };
    const lost = { 'staging-overflow': N('The counter overflowed!'), 'move-limit': N('Out of moves!'),
      'time-up': N('Time ran out!'), 'resigned': N('Round resigned.') };
    document.getElementById('results-headline').textContent =
      T(r.won ? (won[r.reason] || 'Stage complete!') : (lost[r.reason] || 'Round over'));
    const tb = document.querySelector('#results-table tbody');
    tb.innerHTML = '';
    const rows = [
      ['clears', N('Triples cleared'), r.score.clears + ' × ', r.score.clearPoints],
      ['orders', N('Orders completed'), '', r.score.orderBonus],
      ['capacity', N('Spare capacity'), '', r.score.capacityBonus],
      ['moves', N('Move bonus'), r.cfg.par && r.cfg.par.moves ? T('par {n}', { n: r.cfg.par.moves }) : '', r.score.moveBonus],
      ['time', N('Time bonus'), '', r.score.timeBonus]
    ];
    if (r.cfg.endless) rows.push(['waves', N('Order waves finished'), '', r.score.rounds]);
    for (const [key, label, note, val] of rows) {
      if (!val && key !== 'clears') continue;
      tb.appendChild(el('tr', {}, [
        el('td', { text: T(label) }), el('td', { class: 'mini', text: note }),
        el('td', { text: String(val) })
      ]));
    }
    tb.appendChild(el('tr', { class: 'total' }, [
      el('td', { text: T('Total') }), el('td', {}), el('td', { text: String(r.score.total) })
    ]));
    document.getElementById('results-stars').textContent =
      r.stars ? '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars) : '';
    const ach = document.getElementById('results-achievements');
    ach.innerHTML = '';
    for (const a of r.newAchievements || [])
      ach.appendChild(el('li', { text: '🏆 ' + T(a.name) + ' — ' + T(a.desc) }));
    document.getElementById('results-compare').textContent =
      [r.lbRank != null ? T('Local board rank #{n}', { n: r.lbRank + 1 }) : null,
       r.bestImproved ? T('New personal best!') : null,
       r.verified === true ? T('Score verified by replay.') : r.verified === false ? T('Score could not be verified (casual).') : null]
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

    host.appendChild(fs(T('Audio'), [
      slider(T('Music'), 'music'), slider(T('Effects'), 'effects'),
      slider(T('Ambience'), 'ambience'), slider(T('Voice cues'), 'voice'),
      check(T('Mute all'), 'muted'), check(T('Captions for audio cues'), 'captions')
    ]));
    host.appendChild(buildGraphics(ctx, select(T('Color palette'), 'colorPalette', [['standard', T('Standard')], ['high-visibility', T('High visibility')]])));
    host.appendChild(fs(T('Accessibility'), [
      check(T('Reduced motion'), 'reducedMotion'),
      check(T('High contrast'), 'highContrast'),
      check(T('Larger text'), 'largeText'),
      check(T('Left-handed controls'), 'leftHanded'),
      check(T('Visible board controls (DOM)'), 'boardMirror'),
      check(T('Confirm moves (tap target twice)'), 'confirmMoves'),
      check(T('Haptics'), 'haptics'),
      select(T('Selection style'), 'holdToDrag', [['tap', T('Tap to select')], ['hold', T('Hold and drag')]])
    ]));
    const remap = el('div', { class: 'stack' }, [el('p', { class: 'mini', text: T('Gamepad mapping — click an action, then press a gamepad button.') })]);
    for (const action of ['confirm', 'cancel', 'pause', 'undo']) {
      const btnNo = ctx.saveDoc.settings['pad_' + action];
      remap.appendChild(el('button', {
        class: 'btn ghost', onclick: () => ctx.remapGamepad(action)
      }, [document.createTextNode(T(PAD_ACTIONS[action]) + ': ' + (btnNo == null ? T('button default') : T('button {n}', { n: btnNo })))]));
    }
    host.appendChild(fs(T('Controls'), [remap]));
    const danger = el('button', {
      class: 'btn danger', onclick: () => ctx.resetSave()
    }, [document.createTextNode(T('Erase all local progress'))]);
    host.appendChild(fs(T('Data'), [danger]));
  }
  const PAD_ACTIONS = { confirm: N('confirm'), cancel: N('cancel'), pause: N('pause'), undo: N('undo') };

  // ---------- graphics section (quality model in js/gfx.js) ----------
  // Stable ids for tests: #gfx-preset, #gfx-scale, #gfx-<category>, #gfx-adaptive,
  // #gfx-fps, #gfx-summary, #gfx-note. Every control applies live and persists.
  // The section node persists across Settings rebuilds (it hosts the shared
  // game-options.js Language / Sound / Report sections after its inner box);
  // only the inner box is redrawn, so those sections are never destroyed.
  function buildGraphics(ctx, paletteRow) {
    if (ctx.gfxSection) { ctx.gfxSection.rerender(paletteRow); return ctx.gfxSection; }
    const G = ctx.gfx;
    let t = G.strings(ctx.lang());
    const s = () => ctx.saveDoc.settings;
    const section = el('fieldset', { id: 'gfx-section' });
    const legend = el('legend');
    const box = el('div', { class: 'gfx-box' });
    section.append(legend, box);
    let timer = 0;

    function info() { return ctx.graphicsInfo ? ctx.graphicsInfo() : null; }
    function commit(rebuild) {
      ctx.applySettings();
      ctx.persist();
      if (rebuild) render();
      // pixel size/post chain settle on the next frames
      requestAnimationFrame(() => requestAnimationFrame(updateSummary));
    }
    function updateSummary() {
      const sum = box.querySelector('#gfx-summary');
      const note = box.querySelector('#gfx-note');
      if (!sum) return;
      const i = info();
      const r = i ? i.resolved : G.resolve(s().gfx, 'balanced');
      sum.textContent = [i ? (i.gpu || t.unknownGpu) : t.unknownGpu, G.describe(r, i ? i.pixels : null, t)].join(' · ');
      const msg = !i ? t.noRenderer : i.postFailed ? t.postFailed : '';
      note.textContent = msg;
      note.hidden = !msg;
    }
    function row(labelText, control, id) {
      return el('label', { for: id }, [document.createTextNode(labelText), control]);
    }
    function render() {
      t = G.strings(ctx.lang());
      if (!s().gfx || typeof s().gfx !== 'object') s().gfx = Object.assign({}, G.DEFAULTS);
      box.innerHTML = '';
      clearInterval(timer);
      const g = s().gfx;
      const i = info();
      const detected = i ? i.detected : 'balanced';
      const eff = G.resolve(g, detected).preset;
      legend.textContent = t.legend;
      const section = box; // controls render into the inner box

      const presetSel = el('select', { id: 'gfx-preset', 'data-gfx': 'preset',
        onchange: e => { s().gfx = G.choosePreset(s().gfx, e.target.value); commit(true); } },
      [el('option', { value: 'auto', text: t.auto.replace('{tier}', t.presets[detected]) })]
        .concat(G.PRESETS.map(p => el('option', { value: p, text: t.presets[p] }))));
      presetSel.value = G.PRESETS.indexOf(g.preset) >= 0 ? g.preset : 'auto';
      section.appendChild(row(t.quality, presetSel, 'gfx-preset'));

      const pct = Math.round((Number(g.render_scale) || 1) * 100);
      const scaleVal = el('output', { id: 'gfx-scale-value', for: 'gfx-scale', text: pct + '%' });
      const scale = el('input', { id: 'gfx-scale', type: 'range', min: 50, max: 200, step: 5, value: pct, 'data-gfx': 'render_scale',
        oninput: e => { scaleVal.textContent = e.target.value + '%'; s().gfx.render_scale = +e.target.value / 100; commit(false); } });
      section.appendChild(row(t.renderScale, el('span', { class: 'gfx-range' }, [scale, scaleVal]), 'gfx-scale'));

      for (const cat of Object.keys(G.CATEGORIES)) {
        const tiers = G.CATEGORIES[cat];
        const sel = el('select', { id: 'gfx-' + cat, 'data-gfx-cat': cat,
          onchange: e => {
            if (e.target.value === 'preset') delete s().gfx[cat]; else s().gfx[cat] = e.target.value;
            commit(false);
          } },
        [el('option', { value: 'preset', text: t.fromPreset.replace('{tier}', t.tiers[G.presetTier(eff, cat)]) })]
          .concat(tiers.map(v => el('option', { value: v, text: t.tiers[v] }))));
        sel.value = tiers.indexOf(g[cat]) >= 0 ? g[cat] : 'preset';
        section.appendChild(row(t.cats[cat], sel, 'gfx-' + cat));
      }

      const checkRow = (id, key, label) => {
        const c = el('input', { id, type: 'checkbox', 'data-gfx': key,
          onchange: e => { s().gfx[key] = e.target.checked; commit(false); } });
        c.checked = key === 'adaptive' ? g.adaptive !== false : !!g[key];
        return row(label, c, id);
      };
      section.appendChild(checkRow('gfx-adaptive', 'adaptive', t.adaptive));
      section.appendChild(checkRow('gfx-fps', 'show_fps', t.showFps));
      section.appendChild(paletteRow);
      section.appendChild(el('p', { id: 'gfx-summary', class: 'mini gfx-summary', 'aria-live': 'polite' }));
      section.appendChild(el('p', { id: 'gfx-note', class: 'mini gfx-note', role: 'status', hidden: 'hidden' }));
      updateSummary();
      // keep the summary current (adaptive resolution) while the panel is open
      timer = setInterval(() => { if (!box.isConnected) clearInterval(timer); else updateSummary(); }, 1000);
    }
    section.rerender = (row) => { paletteRow = row; render(); };
    render();
    ctx.gfxSection = section;
    return section;
  }

  // ---------- help ----------
  function buildHelp(host, ctx) {
    const s = ctx.saveDoc.settings;
    const k = (a) => ctx.platform.keyLabel(a);
    const cards = [
      [T('Goal'), T('Fill every order shown on the left. Orders ask for sets of three identical objects.')],
      [T('Moving'), T(s.holdToDrag === 'hold'
        ? N('Hold an object, drag it onto a glowing empty cell, and release.')
        : N('Tap an object to lift it, then tap any glowing empty cell to place it.'))],
      [T('Triples'), T('Three identical objects on the same shelf row clear away and count toward orders.')],
      [T('The counter'), T('New stock arrives on the front counter. If a delivery finds no free staging cell, the round is lost.')],
      [T('Scoring'), T('Triples score 100 points plus streak bonuses. Winning adds bonuses for spare space, speed, and staying under par.')],
      [T('Keyboard'), T('{arrows} move the focus ring · {confirm} select/place · {cancel} cancel · {undo} undo · {hint} hint · {camera} camera · {pause} pause · {skip} skip animations.', {
        arrows: ['up', 'down', 'left', 'right'].map(k).join(' '), confirm: k('confirm'), cancel: k('cancel'), undo: k('undo'),
        hint: k('hint'), camera: k('camera'), pause: k('pause'), skip: k('skip'),
      })],
      [T('Gamepad'), T('Stick or D-pad moves focus · {confirm} confirm · {cancel} cancel · {pause} pause · {undo} undo.', {
        confirm: padLabel(s, 'confirm'), cancel: padLabel(s, 'cancel'), pause: padLabel(s, 'pause'), undo: padLabel(s, 'undo'),
      })]
    ];
    host.innerHTML = '';
    for (const [t, body] of cards)
      host.appendChild(el('div', { class: 'panel-2', style: 'padding:.6rem 0;border-bottom:1px solid #ffffff14' }, [
        el('h3', { text: t, style: 'margin:.2rem 0' }), el('p', { text: body, style: 'margin:.2rem 0;max-width:70ch' })
      ]));
  }
  function padLabel(s, action) {
    const v = s['pad_' + action];
    return v == null ? T('default') : T('btn {n}', { n: v });
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
        stat(T('Account'), ctx.platform.displayName() || T('Player')),
        stat(T('Cloud save'), ctx.platform.syncLabel() || '—')
      ]));
    } else {
      const nameIn = el('input', {
        type: 'text', value: ctx.playerName(), maxlength: '24', 'aria-label': T('Display name'),
        onchange: e => { ctx.setPlayerName(e.target.value); }
      });
      host.appendChild(el('label', {}, [document.createTextNode(T('Display name') + ' '), nameIn]));
    }
    host.appendChild(el('div', { class: 'stat-grid' }, [
      stat(T('Rounds'), st.rounds), stat(T('Wins'), st.wins), stat(T('Triples'), st.clears),
      stat(T('Items cleared'), st.itemsCleared), stat(T('Best streak'), st.bestStreak),
      stat(T('Journey stars'), ctx.totalStars()), stat(T('Play time'), fmtTime(st.playMs))
    ]));
    host.appendChild(el('h3', { text: T('Achievements') }));
    const list = el('ul', { class: 'achievements' });
    for (const a of ctx.Content.ACHIEVEMENTS) {
      const got = p.achievements[a.key];
      list.appendChild(el('li', {
        text: (got ? '🏆 ' : '◻ ') + T(a.name) + ' — ' + T(a.desc),
        style: got ? '' : 'opacity:.55'
      }));
    }
    host.appendChild(list);
    host.appendChild(el('h3', { text: T('Themes') }));
    const wrap = el('div', { class: 'row wrap' });
    const stars = ctx.totalStars();
    for (const t of ctx.Content.THEMES) {
      const locked = stars < t.unlockStars;
      wrap.appendChild(el('button', {
        class: 'btn' + (ctx.saveDoc.settings.theme === t.id ? ' primary' : ''),
        disabled: locked ? 'disabled' : null,
        text: T(t.name) + (locked ? ' 🔒' + t.unlockStars + '★' : ''),
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
    for (const t of [['endless', N('Score chase')], ['daily', N('Daily')], ['challenge', N('Challenges')]]) {
      tabs.appendChild(el('button', {
        class: 'btn' + (tab === t[0] ? ' primary' : ''), role: 'tab',
        'aria-selected': tab === t[0] ? 'true' : 'false',
        text: T(t[1]), onclick: () => ctx.showLeaderboard(t[0])
      }));
    }
    host.appendChild(tabs);
    host.appendChild(el('p', {
      class: 'mini',
      text: T('Entries carry ruleset, content version, seed, assists, and duration. Verified entries replay cleanly.')
    }));
    const table = el('table', { class: 'lb' });
    table.appendChild(el('tr', {}, [
      el('th', { text: '#' }), el('th', { text: T('Player') }), el('th', { text: T('When') }),
      el('th', { text: T('Meta') }), el('th', { text: T('Score') })
    ]));
    entries.forEach((e, i) => {
      table.appendChild(el('tr', { class: e.mine ? 'me' : '' }, [
        el('td', { text: String(i + 1) }),
        el('td', { text: ctx.shownName(e.name) + (e.verified ? ' ✓' : '') + (e.assists ? ' ' + T('(assists)') : '') }),
        el('td', { class: 'mini', text: e.date }),
        el('td', { class: 'mini', text: (e.ruleset || '') + ' · ' + T('seed {seed}', { seed: e.seed }) + ' · ' + fmtTime(e.durationMs || 0) }),
        el('td', { text: String(e.score) })
      ]));
    });
    if (!entries.length) host.appendChild(el('p', { class: 'mini', text: T('No entries yet — be the first.') }));
    host.appendChild(table);
    if (tab === 'endless' && platformEntries && platformEntries.length) {
      host.appendChild(el('h3', { text: T('Platform rankings') }));
      host.appendChild(el('p', {
        class: 'mini',
        text: T('Global board hosted by StarHermit — read-only. Your ranked runs submit to the game backend for replay verification.')
      }));
      const pt = el('table', { class: 'lb' });
      pt.appendChild(el('tr', {}, [
        el('th', { text: '#' }), el('th', { text: T('Player') }), el('th', { text: T('Score') })
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
        el('strong', { text: (done[l.id] ? '✓ ' : '') + (i + 1) + '. ' + T(l.title) }),
        el('span', { class: 'mini', text: T(l.text).slice(0, 80) + '…' })
      ]));
    });
    host.appendChild(el('p', { class: 'mini', text: T('Lessons use the same legal-action rules as real play.') }));
  }

  root.SSUI = {
    el, fmtTime,
    buildModeList, buildSetup, buildJourney, buildResults,
    buildSettingsForm, buildHelp, buildProfile, buildLeaderboard, buildLessonList
  };
})(typeof self !== 'undefined' ? self : this);
