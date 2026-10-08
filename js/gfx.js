/* Shelf Shift — graphics quality model: presets, per-category overrides,
 * GPU detection, cost summary and the Graphics panel strings.
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

  /** Best preset for this GPU (unmasked renderer string). Touch devices are capped at balanced. */
  function detectPreset(gpu, mobile) {
    var g = String(gpu || '').toLowerCase();
    var p;
    if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(g)) p = 'low';
    else if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|amd radeon(?!.*graphics)|apple m\d/.test(g)) p = 'high';
    else p = 'balanced';
    if (mobile && p !== 'low') p = 'balanced';
    return p;
  }

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  /**
   * Resolve saved settings into concrete tiers.
   * saved: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }
   */
  function resolve(saved, detected) {
    var s = saved || {};
    var auto = PRESETS.indexOf(s.preset) < 0;
    var preset = auto ? (PRESETS.indexOf(detected) >= 0 ? detected : 'balanced') : s.preset;
    var row = TABLE[preset];
    var userScale = clamp(Number(s.render_scale) || 1, 0.5, 2);
    var out = { preset: preset, auto: auto, cap: row.cap, userScale: userScale, scale: row.scale * userScale };
    for (var cat in CATEGORIES) {
      out[cat] = CATEGORIES[cat].indexOf(s[cat]) >= 0 ? s[cat] : row[cat];
    }
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
    unknownGpu: 'unknown GPU',
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
    unknownGpu: 'GPU desconocida',
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
    unknownGpu: 'unbekannte GPU',
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
    unknownGpu: 'GPU inconnu',
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
    unknownGpu: 'GPU desconhecida',
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
    unknownGpu: 'GPU sconosciuta',
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
    detectPreset: detectPreset, resolve: resolve, choosePreset: choosePreset, presetTier: presetTier,
    describe: describe, pickLocale: pickLocale, strings: strings
  };
});
