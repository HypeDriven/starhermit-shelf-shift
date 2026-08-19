/* Shelf Shift — Three.js presentation layer.
 * Miniature boutique: warm key light, wooden shelf unit, counter table.
 * The renderer consumes immutable rules snapshots + event lists; it never
 * mutates game state. All decorative randomness comes from the decor/av
 * seed streams, never the rules stream.
 *
 * Layers: 0 environment, 1 gameplay (items, cells), 2 selection/ghosts,
 * 3 effects. Raycasts only hit layers 1–2.
 */
import * as THREE from '../vendor/three.module.min.js';

const LAYER_ENV = 0, LAYER_GAME = 1, LAYER_SEL = 2, LAYER_FX = 3;

// ---------- tiny deterministic tween manager (no per-frame allocation) ----------
class Tweens {
  constructor() { this.list = []; }
  add(t) { // {dur, ease, onUpdate(k), onDone, tag}
    t.t = 0;
    if (t.tag) this.kill(t.tag);
    this.list.push(t);
    return t;
  }
  kill(tag) {
    for (let i = this.list.length - 1; i >= 0; i--)
      if (this.list[i].tag === tag) this.list.splice(i, 1);
  }
  tick(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const tw = this.list[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.onUpdate((tw.ease || easeInOut)(k));
      if (k >= 1) { this.list.splice(i, 1); if (tw.onDone) tw.onDone(); }
    }
  }
  finishAll() {
    for (const tw of this.list) { tw.onUpdate(1); if (tw.onDone) tw.onDone(); }
    this.list.length = 0;
  }
  get busy() { return this.list.length > 0; }
}
const easeInOut = k => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
const easeOutBack = k => { const c = 1.70158; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
const easeOut = k => 1 - Math.pow(1 - k, 3);

// ---------- item geometry factories (original procedural assets) ----------
function geoCache() {
  const g = {};
  g.potBody = new THREE.LatheGeometry([
    new THREE.Vector2(0.0, 0), new THREE.Vector2(0.26, 0.02), new THREE.Vector2(0.34, 0.18),
    new THREE.Vector2(0.3, 0.38), new THREE.Vector2(0.16, 0.48), new THREE.Vector2(0.18, 0.52)
  ], 20);
  g.potLid = new THREE.SphereGeometry(0.1, 12, 8);
  g.potSpout = new THREE.CylinderGeometry(0.05, 0.08, 0.28, 8);
  g.candle = new THREE.CylinderGeometry(0.16, 0.18, 0.5, 16);
  g.flame = new THREE.ConeGeometry(0.05, 0.16, 8);
  g.book = new THREE.BoxGeometry(0.5, 0.62, 0.16);
  g.bookCover = new THREE.BoxGeometry(0.54, 0.66, 0.05);
  g.plantPot = new THREE.CylinderGeometry(0.2, 0.15, 0.24, 12);
  g.leaf = new THREE.IcosahedronGeometry(0.17, 0);
  g.vase = new THREE.LatheGeometry([
    new THREE.Vector2(0, 0), new THREE.Vector2(0.18, 0.02), new THREE.Vector2(0.24, 0.25),
    new THREE.Vector2(0.12, 0.5), new THREE.Vector2(0.15, 0.62)
  ], 18);
  g.clockFace = new THREE.CylinderGeometry(0.3, 0.3, 0.09, 24);
  g.clockRim = new THREE.TorusGeometry(0.3, 0.045, 8, 24);
  g.clockHand = new THREE.BoxGeometry(0.03, 0.2, 0.02);
  g.mug = new THREE.CylinderGeometry(0.17, 0.15, 0.36, 16);
  g.mugHandle = new THREE.TorusGeometry(0.11, 0.03, 8, 12, Math.PI);
  g.lanternFrame = new THREE.CylinderGeometry(0.2, 0.24, 0.5, 6, 1, true);
  g.lanternGlow = new THREE.SphereGeometry(0.11, 10, 8);
  g.lanternCap = new THREE.ConeGeometry(0.22, 0.14, 6);
  g.cell = new THREE.PlaneGeometry(1.0, 0.92);
  g.marker = new THREE.RingGeometry(0.3, 0.42, 24);
  return g;
}

function makeItemMesh(type, geos, color, palette) {
  const grp = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.08 });
  const dark = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.55), roughness: 0.7, metalness: 0.05
  });
  const glow = new THREE.MeshStandardMaterial({
    color: 0xffdd99, emissive: 0xffbb55, emissiveIntensity: 1.6, roughness: 0.4
  });
  let m;
  switch (type) {
    case 'teapot':
      m = new THREE.Mesh(geos.potBody, mat); grp.add(m);
      m = new THREE.Mesh(geos.potLid, dark); m.position.y = 0.54; grp.add(m);
      m = new THREE.Mesh(geos.potSpout, dark); m.position.set(0.34, 0.3, 0); m.rotation.z = -0.7; grp.add(m);
      break;
    case 'candle':
      m = new THREE.Mesh(geos.candle, mat); m.position.y = 0.25; grp.add(m);
      m = new THREE.Mesh(geos.flame, glow); m.position.y = 0.58; grp.add(m);
      break;
    case 'book':
      m = new THREE.Mesh(geos.book, mat); m.position.y = 0.31; m.rotation.y = 0.12; grp.add(m);
      m = new THREE.Mesh(geos.bookCover, dark); m.position.set(0, 0.31, 0.09); m.rotation.y = 0.12; grp.add(m);
      break;
    case 'plant':
      m = new THREE.Mesh(geos.plantPot, dark); m.position.y = 0.12; grp.add(m);
      m = new THREE.Mesh(geos.leaf, mat); m.position.y = 0.42; grp.add(m);
      m = new THREE.Mesh(geos.leaf, mat); m.scale.setScalar(0.7); m.position.set(0.12, 0.55, 0.05); grp.add(m);
      break;
    case 'vase':
      m = new THREE.Mesh(geos.vase, mat); grp.add(m);
      break;
    case 'clock':
      m = new THREE.Mesh(geos.clockFace, mat); m.rotation.x = Math.PI / 2; m.position.y = 0.34; grp.add(m);
      m = new THREE.Mesh(geos.clockRim, dark); m.position.y = 0.34; grp.add(m);
      m = new THREE.Mesh(geos.clockHand, dark); m.position.set(0.05, 0.36, 0.06); m.rotation.z = -0.5; grp.add(m);
      break;
    case 'mug':
      m = new THREE.Mesh(geos.mug, mat); m.position.y = 0.18; grp.add(m);
      m = new THREE.Mesh(geos.mugHandle, dark); m.position.set(0.19, 0.2, 0); m.rotation.z = -Math.PI / 2; grp.add(m);
      break;
    case 'lantern':
      m = new THREE.Mesh(geos.lanternFrame, mat); m.position.y = 0.27; grp.add(m);
      m = new THREE.Mesh(geos.lanternGlow, glow); m.position.y = 0.27; grp.add(m);
      m = new THREE.Mesh(geos.lanternCap, dark); m.position.y = 0.58; grp.add(m);
      break;
  }
  grp.traverse(o => { o.layers.set(LAYER_GAME); if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  grp.userData.itemType = type;
  return grp;
}

// ---------- pooled particle bursts (layer 3, never raycast) ----------
class Particles {
  constructor(scene, capacity) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.col = new Float32Array(capacity * 3);
    for (let i = 0; i < capacity; i++) this.pos[i * 3 + 1] = -999;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.07, vertexColors: true, transparent: true, opacity: 0.95,
      depthWrite: false, sizeAttenuation: true
    }));
    this.points.layers.set(LAYER_FX);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.cursor = 0;
  }
  burst(p, color, n, spread, up) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.cursor; this.cursor = (this.cursor + 1) % this.cap;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      const a = Math.random() * Math.PI * 2, r = Math.random() * spread;
      this.vel[i * 3] = Math.cos(a) * r;
      this.vel[i * 3 + 1] = Math.random() * up + 0.8;
      this.vel[i * 3 + 2] = Math.sin(a) * r * 0.5;
      this.life[i] = 0.7 + Math.random() * 0.4;
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
    }
  }
  tick(dt) {
    let any = false;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -999; continue; }
      this.vel[i * 3 + 1] -= 4.5 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    if (any) this.points.geometry.attributes.position.needsUpdate = true;
  }
}

// ---------- renderer ----------
export function createRenderer(opts) {
  const host = opts.host;
  const Content = opts.content;
  const settings = opts.settings;
  const tweens = new Tweens();
  const geos = geoCache();
  const mats = {}; // theme materials, rebuilt on setTheme

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.layers.enable(LAYER_GAME);
  camera.layers.enable(LAYER_SEL);
  camera.layers.enable(LAYER_FX);
  const camBase = new THREE.Vector3(0, 4.6, 9.2);
  const camTarget = new THREE.Vector3(0, 2.6, 0);
  let camShake = 0;
  let parallax = { x: 0, y: 0 };

  const raycaster = new THREE.Raycaster();
  raycaster.layers.enable(LAYER_GAME);
  raycaster.layers.enable(LAYER_SEL);
  const pointerV = new THREE.Vector2();

  // groups
  const envGroup = new THREE.Group();
  const boardGroup = new THREE.Group();
  const itemGroup = new THREE.Group();
  const selGroup = new THREE.Group();
  scene.add(envGroup, boardGroup, itemGroup, selGroup);
  envGroup.traverse(o => o.layers.set(LAYER_ENV));
  selGroup.traverse(o => o.layers.set(LAYER_SEL));

  // lights (created once, tinted per theme)
  const keyLight = new THREE.PointLight(0xffc98a, 60, 40, 1.8);
  keyLight.position.set(2.5, 6.5, 4);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.bias = -0.002;
  const fillLight = new THREE.HemisphereLight(0xfff0dd, 0x30221a, 0.5);
  const rimLight = new THREE.DirectionalLight(0xffdcb0, 0.6);
  rimLight.position.set(-4, 5, -3);
  scene.add(keyLight, fillLight, rimLight);

  const particles = new Particles(scene, 400);

  // state mirrors
  let cellMeshes = new Map();   // key -> {mesh, pos:Vector3, loc}
  let itemMeshes = new Map();   // key -> group
  let curState = null;
  let selection = null;         // loc key
  let legalTargetKeys = new Set();
  let hintMeshes = [];
  let ghost = null;
  let outline = null;
  let boardDims = { w: 5, h: 6 };
  let quality = 'medium';
  let reducedMotion = false;
  let disposed = false;

  function keyOf(loc) {
    return loc.area === 'counter' ? 'c:' + loc.i : 's:' + loc.r + ':' + loc.c;
  }

  // ---------- theme ----------
  function themeById(id) {
    return Content.THEMES.find(t => t.id === id) || Content.THEMES[0];
  }
  function setTheme(id) {
    const th = themeById(id);
    const p = th.palette;
    scene.background = new THREE.Color(p.fog);
    scene.fog = null; // fog would swallow the board at portrait camera distances
    keyLight.color.set(p.light);
    rimLight.color.set(p.accent);
    for (const m of Object.values(mats)) m.dispose && m.dispose();
    mats.wall = new THREE.MeshStandardMaterial({ color: p.wall, roughness: 0.95 });
    mats.floor = new THREE.MeshStandardMaterial({ color: p.floor, roughness: 0.85 });
    mats.wood = new THREE.MeshStandardMaterial({ color: p.wood, roughness: 0.6 });
    mats.woodDark = new THREE.MeshStandardMaterial({ color: p.woodDark, roughness: 0.7 });
    mats.counter = new THREE.MeshStandardMaterial({ color: p.counter, roughness: 0.55 });
    mats.metal = new THREE.MeshStandardMaterial({ color: p.metal, roughness: 0.35, metalness: 0.7 });
    mats.accentGlow = new THREE.MeshStandardMaterial({ color: p.accent, emissive: p.accent, emissiveIntensity: 0.9 });
    buildEnv(p);
    if (curState) buildBoard(curState); // rebuild cells with new materials
  }

  // ---------- environment (deterministic decor from decor stream) ----------
  function buildEnv(p) {
    while (envGroup.children.length) {
      const c = envGroup.children.pop();
      c.traverse(o => { if (o.isMesh && o.geometry && !Object.values(geos).includes(o.geometry)) o.geometry.dispose(); });
    }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), mats.floor);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.layers.set(LAYER_ENV);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 16), mats.wall);
    wall.position.set(0, 8, -2.2); wall.receiveShadow = true; wall.layers.set(LAYER_ENV);
    envGroup.add(floor, wall);

    // pendant lamps (instanced bulbs)
    const bulbGeo = new THREE.SphereGeometry(0.12, 10, 8);
    const bulbs = new THREE.InstancedMesh(bulbGeo, mats.accentGlow, 3);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 3; i++) {
      m4.makeTranslation((i - 1) * 3.2, 7.6, 1.2);
      bulbs.setMatrixAt(i, m4);
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 2.4, 4), mats.metal);
      cord.position.set((i - 1) * 3.2, 8.8, 1.2); cord.layers.set(LAYER_ENV);
      envGroup.add(cord);
    }
    bulbs.layers.set(LAYER_ENV);
    envGroup.add(bulbs);

    // seeded decor: crates & frames along the sides
    if (curState) {
      const drng = opts.rng.derive(curState.seed, opts.rng.STREAM_DECOR);
      for (let i = 0; i < 4; i++) {
        const w = 0.6 + drng.next() * 0.5;
        const crate = new THREE.Mesh(new THREE.BoxGeometry(w, w, w), drng.next() > 0.5 ? mats.wood : mats.woodDark);
        const side = i % 2 ? 1 : -1;
        crate.position.set(side * (boardDims.w / 2 + 1.4 + drng.next()), w / 2, -1 + drng.next() * 2);
        crate.rotation.y = drng.next() * 0.8;
        crate.castShadow = crate.receiveShadow = true; crate.layers.set(LAYER_ENV);
        envGroup.add(crate);
      }
    }
  }

  // ---------- board construction ----------
  function layout(cfg) {
    const { shelves, cols, counter } = cfg.board;
    const cellW = 1.06, rowH = 1.5, baseY = 1.55, counterZ = 2.6, counterY = 1.0;
    const w = Math.max(cols, counter) * cellW + 0.5;
    const pos = new Map();
    for (let r = 0; r < shelves; r++)
      for (let c = 0; c < cols; c++)
        pos.set('s:' + r + ':' + c, new THREE.Vector3((c - (cols - 1) / 2) * cellW, baseY + r * rowH, 0));
    for (let i = 0; i < counter; i++)
      pos.set('c:' + i, new THREE.Vector3((i - (counter - 1) / 2) * cellW, counterY, counterZ));
    const topY = baseY + (shelves - 1) * rowH + 0.9;
    return { pos, w, h: topY, cellW, rowH, baseY, counterY, counterZ, shelves, cols, counter };
  }

  function buildBoard(state) {
    curState = state;
    // clear previous
    for (const [, e] of cellMeshes) { boardGroup.remove(e.mesh); }
    for (const [, g] of itemMeshes) { itemGroup.remove(g); }
    cellMeshes = new Map(); itemMeshes = new Map();
    while (boardGroup.children.length) boardGroup.children.pop();
    clearSelection(); clearHint();

    const L = layout(state.cfg);
    boardDims = { w: L.w, h: L.h };

    // shelf unit frame
    const unitW = L.cols * L.cellW + 0.4;
    const unitH = L.h - L.baseY + 0.9;
    const back = new THREE.Mesh(new THREE.BoxGeometry(unitW, unitH, 0.1), mats.woodDark);
    back.position.set(0, L.baseY + unitH / 2 - 0.7, -0.5);
    back.receiveShadow = true; back.layers.set(LAYER_ENV);
    boardGroup.add(back);
    for (let r = 0; r <= L.shelves; r++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(unitW, 0.09, 1.1), mats.wood);
      plank.position.set(0, L.baseY + r * L.rowH - 0.75, 0);
      plank.castShadow = plank.receiveShadow = true; plank.layers.set(LAYER_ENV);
      boardGroup.add(plank);
    }
    for (const sx of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.12, unitH, 1.1), mats.wood);
      pillar.position.set(sx * (unitW / 2 - 0.06), L.baseY + unitH / 2 - 0.7, 0);
      pillar.castShadow = true; pillar.layers.set(LAYER_ENV);
      boardGroup.add(pillar);
    }
    // counter table
    const cW = L.counter * L.cellW + 0.5;
    const table = new THREE.Mesh(new THREE.BoxGeometry(cW, 0.14, 1.2), mats.counter);
    table.position.set(0, L.counterY - 0.07, L.counterZ);
    table.castShadow = table.receiveShadow = true; table.layers.set(LAYER_ENV);
    boardGroup.add(table);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(cW * 0.9, L.counterY - 0.14, 0.9), mats.woodDark);
    leg.position.set(0, (L.counterY - 0.14) / 2, L.counterZ);
    leg.receiveShadow = true; leg.layers.set(LAYER_ENV);
    boardGroup.add(leg);

    // cell inlays (interaction layer)
    for (const [key, p] of L.pos) {
      const isCounter = key.startsWith('c:');
      const inlay = new THREE.Mesh(geos.cell, new THREE.MeshStandardMaterial({
        color: 0x000000, transparent: true, opacity: 0.18, roughness: 1
      }));
      inlay.rotation.x = -Math.PI / 2;
      inlay.position.copy(p);
      inlay.position.y += isCounter ? 0.002 : -0.698;
      inlay.layers.set(LAYER_GAME);
      inlay.userData.loc = key;
      boardGroup.add(inlay);
      // marker ring (selection/ghost layer visuals)
      const ring = new THREE.Mesh(geos.marker, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false
      }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(inlay.position); ring.position.y += 0.005;
      ring.layers.set(LAYER_SEL);
      boardGroup.add(ring);
      cellMeshes.set(key, { mesh: inlay, ring, pos: p.clone(), key });
    }

    // items
    for (let r = 0; r < state.shelves.length; r++)
      for (let c = 0; c < state.shelves[r].length; c++)
        if (state.shelves[r][c]) placeItem(state.shelves[r][c], { area: 'shelf', r, c }, true);
    for (let i = 0; i < state.counter.length; i++)
      if (state.counter[i]) placeItem(state.counter[i], { area: 'counter', i }, true);

    fitCamera();
    buildEnv(themeById(settings.theme).palette); // seeded crates per level
    renderer.compile(scene, camera);
  }

  function fitCamera() {
    const aspect = host.clientWidth / Math.max(1, host.clientHeight);
    const vFit = (boardDims.h * 0.62) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const hFit = (boardDims.w * 0.72) / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect);
    const dist = Math.max(7.5, vFit, hFit) + 1.2;
    camBase.set(0, 2.2 + boardDims.h * 0.42, dist);
    camTarget.set(0, boardDims.h * 0.44, 0.6);
    camera.position.copy(camBase);
    camera.lookAt(camTarget);
  }

  function itemColor(type) {
    const def = Content.ITEMS[type];
    return (settings.colorPalette === 'high-visibility') ? def.colorHC : def.color;
  }

  function placeItem(type, loc, instant) {
    const key = keyOf(loc);
    const cell = cellMeshes.get(key);
    if (!cell) return;
    const g = makeItemMesh(type, geos, itemColor(type), null);
    g.position.copy(cell.pos);
    g.position.y = cell.pos.y + (loc.area === 'counter' ? 0.0 : -0.7);
    g.position.y = Math.max(0.7, g.position.y);
    itemGroup.add(g);
    itemMeshes.set(key, g);
    if (!instant && !reducedMotion) {
      const targetY = g.position.y;
      g.position.y = targetY + 1.6;
      tweens.add({
        dur: 0.35, ease: easeOut, tag: 'drop:' + key,
        onUpdate: k => { g.position.y = targetY + 1.6 * (1 - k); }
      });
    }
  }

  // ---------- state sync ----------
  // Compares snapshot to mirrored meshes; animates differences.
  function syncState(state, events, instant) {
    const prev = curState;
    curState = state;
    if (!prev || prev.cfg.id !== state.cfg.id || prev.board !== state.board) {
      // same-config check via dims
    }
    // remove cleared items
    const seen = new Set();
    for (let r = 0; r < state.shelves.length; r++)
      for (let c = 0; c < state.shelves[r].length; c++)
        if (state.shelves[r][c]) seen.add('s:' + r + ':' + c);
    for (let i = 0; i < state.counter.length; i++)
      if (state.counter[i]) seen.add('c:' + i);
    for (const [key, g] of itemMeshes) {
      if (!seen.has(key)) {
        if (instant || reducedMotion) { itemGroup.remove(g); itemMeshes.delete(key); }
        else {
          itemMeshes.delete(key);
          const p = g.position.clone();
          tweens.add({
            dur: 0.28, ease: easeOut, tag: 'pop:' + key,
            onUpdate: k => { g.scale.setScalar(1 + k * 0.5); g.position.y = p.y + k * 0.4; },
            onDone: () => itemGroup.remove(g)
          });
        }
      }
    }
    // apply events for animation; then reconcile positions
    const evs = events || [];
    for (const ev of evs) {
      if (ev.type === 'move') {
        const fromKey = keyOf(ev.from), toKey = keyOf(ev.to);
        const g = itemMeshes.get(fromKey);
        const toCell = cellMeshes.get(toKey);
        if (g && toCell) {
          itemMeshes.delete(fromKey);
          itemMeshes.set(toKey, g);
          const target = toCell.pos.clone();
          target.y += ev.to.area === 'counter' ? 0 : -0.7;
          target.y = Math.max(0.7, target.y);
          if (instant || reducedMotion) g.position.copy(target);
          else {
            const start = g.position.clone();
            tweens.add({
              dur: 0.32, ease: easeInOut, tag: 'fly:' + toKey,
              onUpdate: k => {
                g.position.lerpVectors(start, target, k);
                g.position.y += Math.sin(k * Math.PI) * 0.9;
              },
              onDone: () => g.position.copy(target)
            });
          }
        }
      } else if (ev.type === 'delivery') {
        const loc = { area: 'counter', i: ev.cell };
        if (!itemMeshes.get(keyOf(loc))) placeItem(ev.item, loc, instant);
      } else if (ev.type === 'clear') {
        const p = new THREE.Vector3();
        let n = 0;
        for (const c of ev.cells) {
          const cell = cellMeshes.get('s:' + ev.shelf + ':' + c);
          if (cell) { p.add(cell.pos); n++; }
        }
        if (n) {
          p.divideScalar(n);
          particles.burst(p, itemColor(ev.item), quality === 'low' ? 10 : 24, 1.6, 1.8);
        }
        if (!reducedMotion) camShake = Math.max(camShake, 0.06);
      } else if (ev.type === 'win') {
        particles.burst(new THREE.Vector3(0, boardDims.h * 0.6, 0.5), 0xffd070, quality === 'low' ? 30 : 80, 3.2, 2.6);
        if (!reducedMotion) camShake = Math.max(camShake, 0.12);
      } else if (ev.type === 'lose') {
        if (!reducedMotion) camShake = Math.max(camShake, 0.15);
      }
    }
    // reconcile: any item present in state but without a mesh (e.g. after undo)
    for (let r = 0; r < state.shelves.length; r++)
      for (let c = 0; c < state.shelves[r].length; c++) {
        const key = 's:' + r + ':' + c;
        if (state.shelves[r][c] && !itemMeshes.has(key)) placeItem(state.shelves[r][c], { area: 'shelf', r, c }, true);
      }
    for (let i = 0; i < state.counter.length; i++) {
      const key = 'c:' + i;
      if (state.counter[i] && !itemMeshes.has(key)) placeItem(state.counter[i], { area: 'counter', i }, true);
    }
  }

  // ---------- selection / hint / ghost ----------
  function clearOutline() {
    if (outline) { selGroup.remove(outline); outline = null; }
  }
  function makeOutlineOf(g) {
    clearOutline();
    const o = g.clone(true);
    o.traverse(m => {
      if (m.isMesh) {
        m.material = new THREE.MeshBasicMaterial({ color: 0xffc36a, side: THREE.BackSide });
        m.castShadow = m.receiveShadow = false;
        m.layers.set(LAYER_SEL);
      }
    });
    o.scale.setScalar(1.1);
    o.position.copy(g.position);
    selGroup.add(o);
    outline = o;
    return o;
  }

  function setSelection(loc, legalTargets) {
    clearSelection();
    if (!loc) return;
    selection = keyOf(loc);
    legalTargetKeys = new Set((legalTargets || []).map(keyOf));
    const g = itemMeshes.get(selection);
    if (g) {
      makeOutlineOf(g);
      if (!reducedMotion) {
        const baseY = g.position.y;
        tweens.add({
          dur: 0.18, ease: easeOutBack, tag: 'lift:' + selection,
          onUpdate: k => { g.position.y = baseY + k * 0.22; if (outline) outline.position.y = g.position.y; }
        });
      }
    }
    // light up legal targets
    for (const tk of legalTargetKeys) {
      const cell = cellMeshes.get(tk);
      if (cell) cell.ring.material.opacity = 0.85, cell.ring.material.color.set(0x8fce6e);
    }
    const sc = cellMeshes.get(selection);
    if (sc) { sc.ring.material.opacity = 0.9; sc.ring.material.color.set(0xffc36a); }
  }

  function clearSelection() {
    if (selection) {
      const g = itemMeshes.get(selection);
      if (g) { // settle lift
        const cell = cellMeshes.get(selection);
        if (cell && !tweens.list.some(t => t.tag === 'fly:' + selection)) {
          const ty = Math.max(0.7, cell.pos.y + (selection.startsWith('c:') ? 0 : -0.7));
          tweens.kill('lift:' + selection);
          tweens.add({ dur: 0.12, ease: easeOut, tag: 'drop2:' + selection, onUpdate: k => { g.position.y += (ty - g.position.y) * k; } });
        }
      }
    }
    selection = null;
    legalTargetKeys = new Set();
    clearOutline();
    hideGhost();
    for (const [, cell] of cellMeshes) cell.ring.material.opacity = 0;
  }

  function showGhost(loc, itemType) {
    hideGhost();
    const cell = cellMeshes.get(keyOf(loc));
    if (!cell || !itemType) return;
    ghost = makeItemMesh(itemType, geos, itemColor(itemType), null);
    ghost.traverse(m => {
      if (m.isMesh) {
        m.material = m.material.clone();
        m.material.transparent = true; m.material.opacity = 0.45;
        m.castShadow = m.receiveShadow = false;
        m.layers.set(LAYER_SEL);
      }
    });
    ghost.position.copy(cell.pos);
    ghost.position.y = Math.max(0.7, cell.pos.y + (loc.area === 'counter' ? 0 : -0.7));
    selGroup.add(ghost);
  }
  function hideGhost() { if (ghost) { selGroup.remove(ghost); ghost = null; } }

  function setHint(from, to) {
    clearHint();
    for (const loc of [from, to]) {
      const cell = cellMeshes.get(keyOf(loc));
      if (!cell) continue;
      cell.ring.material.opacity = 0.95;
      cell.ring.material.color.set(0x7fb0ff);
      hintMeshes.push(cell);
    }
  }
  function clearHint() {
    for (const c of hintMeshes) c.ring.material.opacity = 0;
    hintMeshes = [];
  }

  // keyboard / gamepad focus cursor
  const cursorRing = new THREE.Mesh(geos.marker, new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false
  }));
  cursorRing.rotation.x = -Math.PI / 2;
  cursorRing.layers.set(LAYER_SEL);
  cursorRing.scale.setScalar(1.25);
  scene.add(cursorRing);
  function setCursor(loc) {
    if (!loc) { cursorRing.material.opacity = 0; return; }
    const cell = cellMeshes.get(keyOf(loc));
    if (!cell) { cursorRing.material.opacity = 0; return; }
    cursorRing.position.copy(cell.mesh.position);
    cursorRing.position.y += 0.008;
    cursorRing.material.opacity = 0.75;
  }

  // ---------- picking ----------
  function pickLoc(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerV.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointerV, camera);
    // items first (they sit on cells)
    const itemHits = raycaster.intersectObjects(itemGroup.children, true);
    if (itemHits.length) {
      let o = itemHits[0].object;
      while (o && !o.userData.itemType) o = o.parent;
      if (o) {
        for (const [key, g] of itemMeshes) if (g === o) return { loc: parseKey(key), item: true };
      }
    }
    const cellHits = raycaster.intersectObjects([...cellMeshes.values()].map(c => c.mesh), false);
    if (cellHits.length) return { loc: parseKey(cellHits[0].object.userData.loc), item: false };
    return null;
  }
  function parseKey(key) {
    const parts = key.split(':');
    return parts[0] === 'c' ? { area: 'counter', i: +parts[1] } : { area: 'shelf', r: +parts[1], c: +parts[2] };
  }
  function screenPos(loc) {
    const cell = cellMeshes.get(keyOf(loc));
    if (!cell) return null;
    const v = cell.pos.clone().project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return { x: (v.x + 1) / 2 * rect.width + rect.left, y: (1 - v.y) / 2 * rect.height + rect.top };
  }

  // ---------- quality ----------
  function setQuality(tier) {
    quality = tier;
    const dpr = window.devicePixelRatio || 1;
    if (tier === 'low') {
      renderer.setPixelRatio(Math.min(dpr, 1));
      renderer.shadowMap.enabled = false;
      keyLight.castShadow = false;
    } else if (tier === 'medium') {
      renderer.setPixelRatio(Math.min(dpr, 1.5));
      renderer.shadowMap.enabled = true;
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.map && keyLight.shadow.map.dispose();
      keyLight.shadow.map = null;
    } else {
      renderer.setPixelRatio(Math.min(dpr, 2));
      renderer.shadowMap.enabled = true;
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(2048, 2048);
      keyLight.shadow.map && keyLight.shadow.map.dispose();
      keyLight.shadow.map = null;
    }
    resize();
  }

  function setReducedMotion(on) { reducedMotion = !!on; }
  function setParallax(x, y) { parallax.x = x; parallax.y = y; }

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitCamera();
  }

  // ---------- frame loop ----------
  let last = 0;
  let running = true;
  function frame(t) {
    if (disposed) return;
    requestAnimationFrame(frame);
    if (!running) { last = t; return; }
    const dt = Math.min(0.05, last ? (t - last) / 1000 : 0.016);
    last = t;
    tweens.tick(dt);
    particles.tick(dt);
    // camera: authored base + pointer parallax + event shake (never cumulative)
    const px = reducedMotion ? 0 : parallax.x * 0.35;
    const py = reducedMotion ? 0 : parallax.y * 0.2;
    let sx = 0, sy = 0;
    if (camShake > 0 && !reducedMotion) {
      camShake = Math.max(0, camShake - dt * 0.5);
      sx = (Math.random() - 0.5) * camShake;
      sy = (Math.random() - 0.5) * camShake;
    } else camShake = Math.max(0, camShake - dt * 0.5);
    camera.position.set(camBase.x + px + sx, camBase.y + py + sy, camBase.z);
    camera.lookAt(camTarget);
    renderer.render(scene, camera);
  }

  function setRunning(on) { running = !!on; }
  function skipAll() { tweens.finishAll(); }
  function isBusy() { return tweens.busy; }

  function dispose() {
    disposed = true;
    renderer.dispose();
    for (const g of Object.values(geos)) g.dispose();
    for (const m of Object.values(mats)) m.dispose && m.dispose();
    host.removeChild(renderer.domElement);
  }

  setTheme(settings.theme || 'ember');
  setQuality(settings.graphicsTier === 'auto'
    ? ((window.matchMedia && matchMedia('(pointer:coarse)').matches) ? 'medium' : 'high')
    : settings.graphicsTier);
  resize();
  requestAnimationFrame(frame);

  return {
    buildBoard, syncState, skipAll, isBusy,
    pickLoc, screenPos, setCursor,
    setSelection, clearSelection, showGhost, hideGhost, setHint, clearHint,
    setTheme, setQuality, setReducedMotion, setParallax,
    resize, dispose, setRunning,
    get quality() { return quality; }
  };
}

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}
