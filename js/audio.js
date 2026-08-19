/* Shelf Shift — procedural WebAudio: original short transients per logical
 * event, layered material knocks, quiet ambience, adaptive music pad.
 * No audio assets; everything is synthesized. Browser global: SSAudio.
 */
(function (root) {
  'use strict';

  var ctx = null, master = null;
  var buses = {}; // music, effects, ambience, voice
  var settings = { music: 0.6, effects: 0.9, ambience: 0.5, voice: 0.8, muted: false };
  var captions = false;
  var captionFn = null;
  var started = false;
  var musicTimer = null, ambienceNodes = null;
  var avRng = null; // seeded variants for replay consistency

  function ensureCtx() {
    if (ctx) return true;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    ['music', 'effects', 'ambience', 'voice'].forEach(function (name) {
      var g = ctx.createGain();
      g.gain.value = settings.muted ? 0 : (settings[name] != null ? settings[name] : 0.8);
      g.connect(master);
      buses[name] = g;
    });
    return true;
  }

  function applySettings(s) {
    Object.assign(settings, s || {});
    if (!ctx) return;
    Object.keys(buses).forEach(function (name) {
      var v = settings.muted ? 0 : (settings[name] != null ? settings[name] : 0.8);
      buses[name].gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    });
  }

  function caption(text) {
    if (captions && captionFn && text) captionFn(text);
  }

  // ---------- primitive builders ----------
  function blip(freq, dur, type, gain, bus, when, sweepTo) {
    var t = (when || ctx.currentTime);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(buses[bus || 'effects']);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function knock(dur, gain, cutoff, when) { // filtered noise = wooden impact
    var t = when || ctx.currentTime;
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ctx.createBufferSource(); src.buffer = buf;
    var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
    var g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(buses.effects);
    src.start(t);
  }

  function variant(base) { // seeded pitch variant (±6%) when replay consistency matters
    var r = avRng ? avRng.next() : Math.random();
    return base * (0.94 + r * 0.12);
  }

  // ---------- event map ----------
  var SFX = {
    'ui':        function () { blip(660, 0.06, 'triangle', 0.12); },
    'select':    function () { blip(variant(520), 0.09, 'sine', 0.18); blip(variant(780), 0.07, 'sine', 0.08, 'effects', ctx.currentTime + 0.03); caption('select'); },
    'deselect':  function () { blip(390, 0.07, 'sine', 0.1); },
    'place':     function () { knock(0.09, 0.5, 900); blip(variant(240), 0.08, 'sine', 0.12); caption('place'); },
    'invalid':   function () { blip(160, 0.16, 'square', 0.07); blip(150, 0.14, 'square', 0.05, 'effects', ctx.currentTime + 0.05); caption('not allowed'); },
    'delivery':  function () { knock(0.07, 0.3, 1400); blip(variant(880), 0.05, 'triangle', 0.06, 'effects', ctx.currentTime + 0.02); caption('delivery'); },
    'clear':     function () {
      var base = 620;
      [0, 4, 7].forEach(function (st, i) {
        blip(variant(base * Math.pow(2, st / 12)), 0.22, 'sine', 0.14, 'effects', ctx.currentTime + i * 0.05);
      });
      knock(0.06, 0.25, 2000, ctx.currentTime);
      caption('triple cleared');
    },
    'order':     function () { blip(523, 0.3, 'sine', 0.14); blip(784, 0.35, 'sine', 0.12, 'effects', ctx.currentTime + 0.12); caption('order complete'); },
    'win':       function () {
      [0, 4, 7, 12].forEach(function (st, i) {
        blip(523 * Math.pow(2, st / 12), 0.5, 'triangle', 0.14, 'effects', ctx.currentTime + i * 0.12);
      });
      caption('stage complete');
    },
    'lose':      function () { blip(300, 0.5, 'sine', 0.16, 'effects', ctx.currentTime, 180); blip(200, 0.6, 'sine', 0.1, 'effects', ctx.currentTime + 0.15, 120); caption('round lost'); },
    'undo':      function () { blip(500, 0.08, 'triangle', 0.1, 'effects', ctx.currentTime, 380); caption('undo'); },
    'hint':      function () { blip(990, 0.12, 'sine', 0.1); blip(1320, 0.14, 'sine', 0.07, 'effects', ctx.currentTime + 0.07); caption('hint'); },
    'star':      function () { blip(1568, 0.18, 'sine', 0.1); }
  };

  function play(name) {
    if (!started || !ctx || settings.muted) return;
    if (ctx.state === 'suspended') ctx.resume();
    var fn = SFX[name];
    if (fn) fn();
  }

  // ---------- ambience: warm room tone (filtered noise, very quiet) ----------
  function startAmbience() {
    if (!ctx || ambienceNodes) return;
    var len = ctx.sampleRate * 2;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var last = 0;
    for (var i = 0; i < len; i++) { // brown-ish noise
      var w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
    var src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320;
    var g = ctx.createGain(); g.gain.value = 0.35;
    src.connect(f); f.connect(g); g.connect(buses.ambience);
    src.start();
    ambienceNodes = { src: src, gain: g };
  }

  // ---------- music: slow generative pad, seeded chord walk ----------
  var CHORDS = [
    [220.0, 277.18, 329.63], // A  C# E
    [196.0, 246.94, 293.66], // G  B  D
    [174.61, 220.0, 261.63], // F  A  C
    [146.83, 220.0, 293.66]  // D  A  D
  ];
  var chordIdx = 0;
  function schedulePad() {
    if (!ctx || settings.muted) return;
    var t = ctx.currentTime + 0.1;
    var chord = CHORDS[chordIdx % CHORDS.length];
    chordIdx++;
    chord.forEach(function (freq, i) {
      var o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.value = freq * 0.5;
      f.type = 'lowpass'; f.frequency.value = 700;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 1.8);
      g.gain.linearRampToValueAtTime(0.0001, t + 6.4);
      o.connect(f); f.connect(g); g.connect(buses.music);
      o.start(t); o.stop(t + 6.6);
    });
  }
  function startMusic() {
    if (musicTimer || !ctx) return;
    schedulePad();
    musicTimer = setInterval(schedulePad, 5200);
  }

  function start(opts) {
    if (!ensureCtx()) return false;
    if (ctx.state === 'suspended') ctx.resume();
    started = true;
    startAmbience();
    startMusic();
    return true;
  }

  function suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); }
  function resume() { if (ctx && started && ctx.state === 'suspended') ctx.resume(); }

  function setAvRng(rng) { avRng = rng; }
  function setCaptions(on, fn) { captions = !!on; captionFn = fn || captionFn; }

  root.SSAudio = {
    start: start, play: play, applySettings: applySettings,
    suspend: suspend, resume: resume, setAvRng: setAvRng, setCaptions: setCaptions,
    isStarted: function () { return started; }
  };
})(typeof self !== 'undefined' ? self : this);
