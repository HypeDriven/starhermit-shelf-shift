/* Shelf Shift — graphics quality model: presets, per-category overrides,
 * StarHermit hardware-level detection, per-preset budgets, cost summary and the Graphics panel strings.
 * Pure (no three.js), so the settings panel, the renderer and the unit tests
 * agree on what a setting means. Browser global: window.SSGfx.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SSGfx = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PRESETS = ['low', 'balanced', 'high', 'ultra'];

  // Category → allowed tiers, cheapest first.
  var CATEGORIES = {
    shadows: ['off', 'low', 'medium', 'high'],
    ao: ['off', 'on', 'high'],
    bloom: ['off', 'on'],
    grade: ['off', 'on'],
    antialias: ['off', 'fxaa', 'smaa', 'msaa'],
    reflections: ['off', 'on'],   // image-based lighting (room environment map)
    detail: ['plain', 'detailed'], // procedural wood/wallpaper/floor, lamp shades, glazed pieces
    particles: ['low', 'high'],   // burst density + drifting dust motes in the lamp light
    ambient: ['static', 'animated'] // candle/lantern flicker, lamp sway
  };

  // Each preset: a row of tiers, a device-pixel-ratio cap and a render scale.
  var TABLE = {
    low: { cap: 1, scale: 1, shadows: 'off', ao: 'off', bloom: 'off', grade: 'off', antialias: 'msaa',
      reflections: 'off', detail: 'plain', particles: 'low', ambient: 'static' },
    balanced: { cap: 1.5, scale: 1, shadows: 'low', ao: 'off', bloom: 'on', grade: 'on', antialias: 'fxaa',
      reflections: 'on', detail: 'detailed', particles: 'high', ambient: 'animated' },
    high: { cap: 2, scale: 1, shadows: 'medium', ao: 'on', bloom: 'on', grade: 'on', antialias: 'smaa',
      reflections: 'on', detail: 'detailed', particles: 'high', ambient: 'animated' },
    ultra: { cap: 2, scale: 1.25, shadows: 'high', ao: 'high', bloom: 'on', grade: 'on', antialias: 'msaa',
      reflections: 'on', detail: 'detailed', particles: 'high', ambient: 'animated' }
  };

  var SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };

  var DEFAULTS = { preset: 'auto', render_scale: 1, adaptive: true, show_fps: false };

  // Auto picks the preset from the StarHermit hardware level (0 = Galaxy S20 / Intel UHD or weaker, 20 = RTX
  // 5090; js/gpu-level.js → window.StarHermitGpu, a classic script loaded before this one): Low from 0,
  // Balanced from 4, High from 10, Ultra from 17. Phones, tablets and ≤ 4 GB machines are capped at level 9.
  var LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };
  function gpuApi() { return typeof globalThis !== 'undefined' ? globalThis.StarHermitGpu : undefined; }

  /** Hardware level 0–20 for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
  function detectLevel(gpu, system) {
    var G = gpuApi();
    var sys = Object.assign({ webgl: true, webgl2: true }, system || {}, { gpu: String(gpu || '') });
    if (!gpu) sys.webgl = false; // no renderer string: no usable WebGL
    return G ? G.detectLevel(sys) : (gpu ? LEVELS.balanced : 0);
  }

  /** The preset Auto starts from for a hardware level. */
  function presetForLevel(level) {
    var G = gpuApi();
    if (G) return G.presetForLevel(level, LEVELS);
    return PRESETS.filter(function (p) { return LEVELS[p] <= level; }).pop() || 'low';
  }

  /** Best preset for this GPU (the hardware level already caps phones and tablets at Balanced). */
  function detectPreset(gpu, system) {
    return presetForLevel(detectLevel(gpu, system));
  }

  /*
   * Per-preset asset and effect budget. Each preset holds 60 FPS on the weakest GPU Auto gives it (Low →
   * level 0, Balanced → 4, High → 10, Ultra → 17; measured with tests/gfx-bench.mjs). Shelves, items,
   * picking and rules are identical on every preset — only visuals change.
   *   texture   procedural wood / floor / wallpaper canvas scale (×1 = 512×128 wood, 512² floor, 256² wallpaper;
   *             Detail on)
   *   material  item shading with Detail on: standard everywhere (Balanced) or the glazed / sheen
   *             physical materials (High, Ultra)
   *   dust      drifting dust motes in the lamp light (Particles high), scaled with the level
   *   burst     particle-burst density multiplier, scaled with the level
   *   bloomRes / aoRes  bloom and GTAO resolution as a fraction of the frame
   */
  var BUDGETS = {
    low: { texture: 0.5, material: 'standard', dust: 40, burst: 0.6, bloomRes: 0.5, aoRes: 0.5 },
    balanced: { texture: 0.5, material: 'standard', dust: 60, burst: 0.8, bloomRes: 0.5, aoRes: 0.5 },
    high: { texture: 1, material: 'physical', dust: 90, burst: 1, bloomRes: 0.5, aoRes: 0.5 },
    ultra: { texture: 2, material: 'physical', dust: 140, burst: 1, bloomRes: 1, aoRes: 1 }
  };
  var DUST_MAX = 280;

  /** A preset's concrete budget for a hardware level (counts scale ≤ 2× within the preset). */
  function budgetFor(preset, level) {
    var b = Object.assign({}, BUDGETS[preset] || BUDGETS.balanced);
    var G = gpuApi(), floor = LEVELS[preset] || 0;
    var lv = Math.max(isFinite(level) ? level : floor, floor);
    var k = G ? Math.min(2, G.scaleBudget(1, lv, floor)) : 1;
    b.dust = Math.min(DUST_MAX, Math.round(b.dust * k));
    b.burst = Math.min(2, Math.round(b.burst * k * 100) / 100);
    return b;
  }

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  /**
   * Resolve saved settings into concrete tiers.
   * saved: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }
   */
  function resolve(saved, detected, level) {
    var s = saved || {};
    var auto = PRESETS.indexOf(s.preset) < 0;
    var preset = auto ? (PRESETS.indexOf(detected) >= 0 ? detected : 'balanced') : s.preset;
    var row = TABLE[preset];
    var userScale = clamp(Number(s.render_scale) || 1, 0.5, 2);
    var out = { preset: preset, auto: auto, cap: row.cap, userScale: userScale, scale: row.scale * userScale };
    for (var cat in CATEGORIES) {
      out[cat] = CATEGORIES[cat].indexOf(s[cat]) >= 0 ? s[cat] : row[cat];
    }
    out.level = isFinite(level) && level !== null ? level : LEVELS[preset];
    out.budget = budgetFor(preset, out.level);
    out.adaptive = s.adaptive !== false;
    out.showFps = !!s.show_fps;
    // The composer runs only when something needs it; otherwise canvas MSAA is used.
    out.post = out.ao !== 'off' || out.bloom === 'on' || out.grade === 'on' ||
      out.antialias === 'fxaa' || out.antialias === 'smaa';
    return out;
  }

  /** Settings after picking a preset: overrides cleared, scale/adaptive/fps kept. */
  function choosePreset(saved, preset) {
    var s = saved || {};
    return {
      preset: PRESETS.indexOf(preset) >= 0 ? preset : 'auto',
      render_scale: s.render_scale == null ? 1 : s.render_scale,
      adaptive: s.adaptive !== false,
      show_fps: !!s.show_fps
    };
  }

  /** The preset's own tier for a category (for "From preset (…)" labels). */
  function presetTier(preset, cat) {
    return TABLE[preset] ? TABLE[preset][cat] : undefined;
  }

  /** Cost summary, e.g. "2048² shadows · ambient occlusion · bloom · SMAA · 1280×800 px". */
  function describe(r, pixels, t) {
    var S = (t && t.summary) || STRINGS['en-US'].summary;
    var parts = [
      r.shadows === 'off' ? S.noShadows : S.shadows.replace('{n}', SHADOW_MAP[r.shadows] + '²'),
      r.ao === 'off' ? null : r.ao === 'high' ? S.aoHigh : S.ao,
      r.bloom === 'on' ? S.bloom : null,
      r.reflections === 'on' ? S.reflections : null,
      r.antialias === 'off' ? S.noAa : r.antialias.toUpperCase(),
      pixels ? pixels[0] + '×' + pixels[1] + ' px' : null
    ];
    return parts.filter(Boolean).join(' · ');
  }

  // ---------- Graphics panel strings (the rest of the game is English-only) ----------
  var EN = {
    legend: 'Graphics', quality: 'Quality', auto: 'Auto (detected: {tier})',
    presets: { low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra' },
    renderScale: 'Render scale', fromPreset: 'From preset ({tier})',
    adaptive: 'Adaptive resolution', showFps: 'Show frame rate',
    cats: { shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom', grade: 'Colour grade',
      antialias: 'Anti-aliasing', reflections: 'Reflections', detail: 'Surface detail',
      particles: 'Particles', ambient: 'Ambient motion' },
    tiers: { off: 'Off', on: 'On', low: 'Low', medium: 'Medium', high: 'High', fxaa: 'FXAA', smaa: 'SMAA',
      msaa: 'MSAA', 'static': 'Static', animated: 'Animated', plain: 'Plain', detailed: 'Detailed' },
    postFailed: 'Post-processing is unavailable on this device, so effects render without it.',
    noRenderer: '3D view unavailable: graphics settings have no effect.',
    unknownGpu: 'unknown GPU', level: 'Level {n}',
    summary: { noShadows: 'no shadows', shadows: '{n} shadows', ao: 'ambient occlusion',
      aoHigh: 'full ambient occlusion', bloom: 'bloom', reflections: 'reflections', noAa: 'no anti-aliasing' }
  };
  function variant(base, over) {
    var o = {};
    for (var k in base) o[k] = (over[k] && typeof base[k] === 'object') ? variant(base[k], over[k]) : (k in over ? over[k] : base[k]);
    return o;
  }
  var STRINGS = {};
  STRINGS['en-US'] = variant(EN, { cats: { grade: 'Color grade' } });
  STRINGS['en-GB'] = EN;
  var ES = {
    legend: 'Gráficos', quality: 'Calidad', auto: 'Automática (detectada: {tier})',
    presets: { low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra' },
    renderScale: 'Escala de renderizado', fromPreset: 'Según calidad ({tier})',
    adaptive: 'Resolución adaptativa', showFps: 'Mostrar fotogramas por segundo',
    cats: { shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Corrección de color',
      antialias: 'Antialiasing', reflections: 'Reflejos', detail: 'Detalle de superficies',
      particles: 'Partículas', ambient: 'Movimiento ambiental' },
    tiers: { off: 'No', on: 'Sí', low: 'Bajo', medium: 'Medio', high: 'Alto', 'static': 'Estático',
      animated: 'Animado', plain: 'Simple', detailed: 'Detallado' },
    postFailed: 'El posprocesado no está disponible en este dispositivo; los efectos se muestran sin él.',
    noRenderer: 'Vista 3D no disponible: los ajustes gráficos no tienen efecto.',
    unknownGpu: 'GPU desconocida', level: 'Nivel {n}',
    summary: { noShadows: 'sin sombras', shadows: 'sombras {n}', ao: 'oclusión ambiental',
      aoHigh: 'oclusión ambiental completa', bloom: 'resplandor', reflections: 'reflejos', noAa: 'sin antialiasing' }
  };
  STRINGS['es-419'] = variant(EN, ES);
  STRINGS['es-ES'] = variant(EN, variant(ES, { showFps: 'Mostrar tasa de fotogramas', renderScale: 'Escala de renderizado',
    cats: { antialias: 'Suavizado de bordes' }, summary: { noAa: 'sin suavizado' } }));
  STRINGS['de-DE'] = variant(EN, {
    legend: 'Grafik', quality: 'Qualität', auto: 'Automatisch (erkannt: {tier})',
    presets: { low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra' },
    renderScale: 'Renderskalierung', fromPreset: 'Laut Voreinstellung ({tier})',
    adaptive: 'Adaptive Auflösung', showFps: 'Bildrate anzeigen',
    cats: { shadows: 'Schatten', ao: 'Umgebungsverdeckung', bloom: 'Leuchteffekt', grade: 'Farbkorrektur',
      antialias: 'Kantenglättung', reflections: 'Spiegelungen', detail: 'Oberflächendetails',
      particles: 'Partikel', ambient: 'Umgebungsanimation' },
    tiers: { off: 'Aus', on: 'An', low: 'Niedrig', medium: 'Mittel', high: 'Hoch', 'static': 'Statisch',
      animated: 'Animiert', plain: 'Schlicht', detailed: 'Detailliert' },
    postFailed: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar; Effekte werden ohne sie dargestellt.',
    noRenderer: '3D-Ansicht nicht verfügbar: Grafikeinstellungen haben keine Wirkung.',
    unknownGpu: 'unbekannte GPU', level: 'Stufe {n}',
    summary: { noShadows: 'keine Schatten', shadows: '{n}-Schatten', ao: 'Umgebungsverdeckung',
      aoHigh: 'volle Umgebungsverdeckung', bloom: 'Leuchteffekt', reflections: 'Spiegelungen', noAa: 'keine Kantenglättung' }
  });
  var FR = {
    legend: 'Graphismes', quality: 'Qualité', auto: 'Automatique (détectée : {tier})',
    presets: { low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra' },
    renderScale: 'Échelle de rendu', fromPreset: 'Selon la qualité ({tier})',
    adaptive: 'Résolution adaptative', showFps: 'Afficher la fréquence d’images',
    cats: { shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Halo lumineux', grade: 'Étalonnage des couleurs',
      antialias: 'Anticrénelage', reflections: 'Reflets', detail: 'Détail des surfaces',
      particles: 'Particules', ambient: 'Animation d’ambiance' },
    tiers: { off: 'Non', on: 'Oui', low: 'Bas', medium: 'Moyen', high: 'Élevé', 'static': 'Statique',
      animated: 'Animé', plain: 'Simple', detailed: 'Détaillé' },
    postFailed: 'Le post-traitement n’est pas disponible sur cet appareil ; les effets s’affichent sans lui.',
    noRenderer: 'Vue 3D indisponible : les réglages graphiques n’ont aucun effet.',
    unknownGpu: 'GPU inconnu', level: 'Niveau {n}',
    summary: { noShadows: 'sans ombres', shadows: 'ombres {n}', ao: 'occlusion ambiante',
      aoHigh: 'occlusion ambiante complète', bloom: 'halo lumineux', reflections: 'reflets', noAa: 'sans anticrénelage' }
  };
  STRINGS['fr-FR'] = variant(EN, FR);
  STRINGS['fr-CA'] = variant(EN, variant(FR, { cats: { antialias: 'Lissage des contours' },
    summary: { noAa: 'sans lissage' }, adaptive: 'Résolution adaptative', showFps: 'Afficher le taux de rafraîchissement' }));
  STRINGS['pt-BR'] = variant(EN, {
    legend: 'Gráficos', quality: 'Qualidade', auto: 'Automática (detectada: {tier})',
    presets: { low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra' },
    renderScale: 'Escala de renderização', fromPreset: 'Conforme a qualidade ({tier})',
    adaptive: 'Resolução adaptativa', showFps: 'Mostrar taxa de quadros',
    cats: { shadows: 'Sombras', ao: 'Oclusão ambiente', bloom: 'Brilho', grade: 'Correção de cor',
      antialias: 'Suavização de serrilhado', reflections: 'Reflexos', detail: 'Detalhe das superfícies',
      particles: 'Partículas', ambient: 'Movimento ambiente' },
    tiers: { off: 'Não', on: 'Sim', low: 'Baixo', medium: 'Médio', high: 'Alto', 'static': 'Estático',
      animated: 'Animado', plain: 'Simples', detailed: 'Detalhado' },
    postFailed: 'O pós-processamento não está disponível neste dispositivo; os efeitos são exibidos sem ele.',
    noRenderer: 'Visão 3D indisponível: as configurações gráficas não têm efeito.',
    unknownGpu: 'GPU desconhecida', level: 'Nível {n}',
    summary: { noShadows: 'sem sombras', shadows: 'sombras {n}', ao: 'oclusão ambiente',
      aoHigh: 'oclusão ambiente completa', bloom: 'brilho', reflections: 'reflexos', noAa: 'sem suavização' }
  });
  STRINGS['it-IT'] = variant(EN, {
    legend: 'Grafica', quality: 'Qualità', auto: 'Automatica (rilevata: {tier})',
    presets: { low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra' },
    renderScale: 'Scala di rendering', fromPreset: 'Da preimpostazione ({tier})',
    adaptive: 'Risoluzione adattiva', showFps: 'Mostra frequenza fotogrammi',
    cats: { shadows: 'Ombre', ao: 'Occlusione ambientale', bloom: 'Bagliore', grade: 'Correzione colore',
      antialias: 'Antialiasing', reflections: 'Riflessi', detail: 'Dettaglio superfici',
      particles: 'Particelle', ambient: 'Animazione ambientale' },
    tiers: { off: 'No', on: 'Sì', low: 'Basso', medium: 'Medio', high: 'Alto', 'static': 'Statico',
      animated: 'Animato', plain: 'Semplice', detailed: 'Dettagliato' },
    postFailed: 'La post-elaborazione non è disponibile su questo dispositivo; gli effetti vengono mostrati senza.',
    noRenderer: 'Vista 3D non disponibile: le impostazioni grafiche non hanno effetto.',
    unknownGpu: 'GPU sconosciuta', level: 'Livello {n}',
    summary: { noShadows: 'senza ombre', shadows: 'ombre {n}', ao: 'occlusione ambientale',
      aoHigh: 'occlusione ambientale completa', bloom: 'bagliore', reflections: 'riflessi', noAa: 'senza antialiasing' }
  });

  var FALLBACK = { en: 'en-US', es: 'es-419', fr: 'fr-FR', de: 'de-DE', pt: 'pt-BR', it: 'it-IT' };

  /** Pick the closest supported locale for a BCP-47 tag (e.g. navigator.language). */
  function pickLocale(tag) {
    var t = String(tag || 'en-US').replace('_', '-');
    for (var k in STRINGS) if (k.toLowerCase() === t.toLowerCase()) return k;
    var lang = t.split('-')[0].toLowerCase();
    if (lang === 'es' && /-(ES|ea|ic)$/i.test(t)) return 'es-ES';
    if (lang === 'en' && /-(GB|IE|AU|NZ|ZA|IN)$/i.test(t)) return 'en-GB';
    return FALLBACK[lang] || 'en-US';
  }

  function strings(tag) { return STRINGS[pickLocale(tag)]; }

  return {
    PRESETS: PRESETS, CATEGORIES: CATEGORIES, SHADOW_MAP: SHADOW_MAP, DEFAULTS: DEFAULTS, STRINGS: STRINGS,
    LEVELS: LEVELS, BUDGETS: BUDGETS, DUST_MAX: DUST_MAX,
    detectLevel: detectLevel, presetForLevel: presetForLevel, budgetFor: budgetFor,
    detectPreset: detectPreset, resolve: resolve, choosePreset: choosePreset, presetTier: presetTier,
    describe: describe, pickLocale: pickLocale, strings: strings
  };
});
