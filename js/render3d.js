/* Shelf Shift — Three.js presentation layer.
 * Miniature boutique: warm key light, wooden shelf unit, counter table.
 * The renderer consumes immutable rules snapshots + event lists; it never
 * mutates game state. All decorative randomness comes from the decor/av
 * seed streams, never the rules stream.
 *
 * Graphics quality (js/gfx.js) is applied live by setGraphics(): shadow map,
 * image-based lighting, procedural surface detail, particles, ambient motion
 * and a post chain (GTAO → bloom → grade → output → SMAA/FXAA).
 *
 * Layers: 0 environment, 1 gameplay (items, cells), 2 selection/ghosts,
 * 3 effects. Raycasts only hit layers 1–2.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const Gfx = window.SSGfx;

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

// Item materials are shared per (type, colour, detail) so the flame/lantern
// glow can flicker with one uniform write and rebuilding a board allocates nothing new.
const CERAMIC = new Set(['teapot', 'vase', 'mug']);
const itemMatCache = new Map();
const glowMats = {};
function glowMaterial(detail) {
  if (!glowMats[detail]) glowMats[detail] = new THREE.MeshStandardMaterial({
    color: 0xffdd99, emissive: 0xffbb55, emissiveIntensity: detail === 'detailed' ? 2.2 : 1.6, roughness: 0.4
  });
  return glowMats[detail];
}
function itemMaterials(type, color, detail) {
  const key = type + '|' + color + '|' + detail;
  let e = itemMatCache.get(key);
  if (e) return e;
  const darkCol = new THREE.Color(color).multiplyScalar(0.55);
  if (detail !== 'detailed') {
    e = {
      mat: new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.08 }),
      dark: new THREE.MeshStandardMaterial({ color: darkCol, roughness: 0.7, metalness: 0.05 })
    };
  } else if (CERAMIC.has(type)) {
    // glazed ceramic: clearcoat catches the lamp and room reflections
    e = {
      mat: new THREE.MeshPhysicalMaterial({ color, roughness: 0.5, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.18, envMapIntensity: 0.35 }),
      dark: new THREE.MeshPhysicalMaterial({ color: darkCol, roughness: 0.5, clearcoat: 0.45, clearcoatRoughness: 0.25, envMapIntensity: 0.35 })
    };
  } else if (type === 'lantern' || type === 'clock') {
    e = {
      mat: new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.45, envMapIntensity: 1.0 }),
      dark: new THREE.MeshStandardMaterial({ color: darkCol, roughness: 0.3, metalness: 0.75, envMapIntensity: 1.1 })
    };
  } else if (type === 'candle') {
    e = {
      mat: new THREE.MeshPhysicalMaterial({ color, roughness: 0.5, sheen: 0.6, sheenColor: 0xfff0d0, sheenRoughness: 0.5, envMapIntensity: 0.6 }),
      dark: new THREE.MeshStandardMaterial({ color: darkCol, roughness: 0.6 })
    };
  } else { // book, plant: cloth and leaf, soft and matte
    e = {
      mat: new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0, envMapIntensity: 0.5 }),
      dark: new THREE.MeshStandardMaterial({ color: darkCol, roughness: 0.62, metalness: 0.05, envMapIntensity: 0.6 })
    };
  }
  itemMatCache.set(key, e);
  return e;
}

function makeItemMesh(type, geos, color, detail) {
  const grp = new THREE.Group();
  const { mat, dark } = itemMaterials(type, color, detail);
  const glow = glowMaterial(detail);
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
      size: 0.11, vertexColors: true, transparent: true, opacity: 0.95, map: softDot(),
      depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending
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

// ---------- procedural textures (deterministic; canvas 2D) ----------
function hashRng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}
let _softDot = null;
function softDot() {
  if (_softDot) return _softDot;
  _softDot = canvasTex(64, 64, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.4, 'rgba(255,255,255,0.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  });
  _softDot.wrapS = _softDot.wrapT = THREE.ClampToEdgeWrapping;
  return _softDot;
}
// Wood grain: long wavy streaks along U, multiplied onto the theme wood colour.
function woodTexture(seed) {
  const rnd = hashRng(seed);
  return canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#ece4dc'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const y0 = rnd() * h, amp = 1 + rnd() * 4, f = 1 + rnd() * 3, ph = rnd() * 6.28;
      const l = 150 + rnd() * 90 | 0;
      g.strokeStyle = `rgba(${l * 0.55 | 0},${l * 0.4 | 0},${l * 0.3 | 0},${0.08 + rnd() * 0.2})`;
      g.lineWidth = 0.6 + rnd() * 2.2;
      g.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = y0 + Math.sin(x / w * Math.PI * 2 * f + ph) * amp;
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < 3; i++) { // a few knots
      const x = rnd() * w, y = rnd() * h, r = 3 + rnd() * 5;
      const k = g.createRadialGradient(x, y, 0, x, y, r * 2);
      k.addColorStop(0, 'rgba(80,50,30,0.45)'); k.addColorStop(1, 'rgba(80,50,30,0)');
      g.fillStyle = k; g.beginPath(); g.ellipse(x, y, r * 3, r, 0, 0, 7); g.fill();
    }
  });
}
// Floor planks: staggered boards with seams and per-board tone.
function floorTexture(seed) {
  const rnd = hashRng(seed);
  return canvasTex(512, 512, (g, w, h) => {
    const rows = 8, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      // planks fill exactly one texture width from a random start and are also
      // drawn shifted by ±w, so the texture tiles without a seam
      const x0 = rnd() * w;
      let x = x0;
      while (x < x0 + w) {
        const len = Math.min(180 + rnd() * 200, x0 + w - x), v = 205 + rnd() * 50 | 0;
        const lines = [];
        for (let i = 0; i < 7; i++) lines.push([0.06 + rnd() * 0.12, 0.8 + rnd() * 1.5, r * rh + rnd() * rh, (rnd() - 0.5) * 4]);
        for (const off of [-w, 0]) {
          const px = x + off;
          g.fillStyle = `rgb(${v},${v * 0.95 | 0},${v * 0.9 | 0})`;
          g.fillRect(px, r * rh, len, rh);
          for (const [a, lw, y, dy] of lines) {
            g.strokeStyle = `rgba(90,60,40,${a})`; g.lineWidth = lw;
            g.beginPath(); g.moveTo(px, y); g.lineTo(px + len, y + dy); g.stroke();
          }
          g.fillStyle = 'rgba(40,25,15,0.55)'; g.fillRect(px, r * rh, 2, rh);
        }
        x += len;
      }
      g.fillStyle = 'rgba(40,25,15,0.6)'; g.fillRect(0, r * rh, w, 2);
    }
  }, [8, 6]);
}
// Wallpaper: soft vertical stripes with a small diamond motif.
function wallTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,1)'; g.fillRect(0, 0, w / 2, h);
    g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(w / 2 - 3, 0, 6, h); g.fillRect(w - 3, 0, 6, h); g.fillRect(0, 0, 3, h);
    g.fillStyle = 'rgba(0,0,0,0.08)';
    for (const [cx, cy] of [[w / 4, h / 4], [w / 4, h * 3 / 4], [w * 3 / 4, h / 2], [w * 3 / 4, 0], [w * 3 / 4, h]]) {
      g.beginPath(); g.moveTo(cx, cy - 12); g.lineTo(cx + 8, cy); g.lineTo(cx, cy + 12); g.lineTo(cx - 8, cy); g.closePath(); g.fill();
    }
  }, [16, 6]);
}

// Drifting dust motes in the lamp light (layer 3, never raycast).
class Dust {
  constructor(scene, n) {
    const rnd = hashRng(77);
    this.n = n;
    this.base = new Float32Array(n * 3);
    this.pos = new Float32Array(n * 3);
    this.ph = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.base[i * 3] = (rnd() - 0.5) * 9;
      this.base[i * 3 + 1] = 0.8 + rnd() * 6.8;
      this.base[i * 3 + 2] = -0.4 + rnd() * 3.8;
      this.ph[i] = rnd() * 100;
    }
    this.pos.set(this.base);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.045, color: 0xffe2b8, map: softDot(), transparent: true, opacity: 0.55,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
    }));
    this.points.layers.set(LAYER_FX);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }
  tick(t) {
    if (!this.points.visible) return;
    for (let i = 0; i < this.n; i++) {
      const p = this.ph[i], k = i * 3;
      this.pos[k] = this.base[k] + Math.sin(t * 0.13 + p) * 0.35;
      this.pos[k + 1] = this.base[k + 1] + Math.sin(t * 0.09 + p * 1.7) * 0.45;
      this.pos[k + 2] = this.base[k + 2] + Math.cos(t * 0.11 + p) * 0.25;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

// Colour grade + vignette (linear HDR in, before OutputPass tone mapping).
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.28 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = src.rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // warm highlights, slightly cooler shadows, a touch more saturation
      vec3 g = c * mix(vec3(0.95, 0.98, 1.06), vec3(1.05, 1.0, 0.94), smoothstep(0.02, 0.5, l));
      float gl = dot(g, vec3(0.2126, 0.7152, 0.0722));
      g = max(mix(vec3(gl), g, 1.1), 0.0);
      // gentle contrast around mid-grey in log space
      g = pow(g / 0.18, vec3(1.06)) * 0.18;
      c = mix(c, g, uAmount);
      float d = length((vUv - 0.5) * vec2(1.1, 1.0));
      c *= 1.0 - uVignette * smoothstep(0.38, 0.9, d);
      gl_FragColor = vec4(c, src.a);
    }`
};

function detectGpu(gl) {
  try {
    const ctx = gl.getContext();
    const ext = ctx.getExtension('WEBGL_debug_renderer_info');
    return String(ctx.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : ctx.RENDERER) || '');
  } catch (e) { return ''; }
}
function isTouchDevice() {
  try {
    return (matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches) ||
      /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  } catch (e) { return false; }
}

// ---------- renderer ----------
export function createRenderer(opts) {
  const host = opts.host;
  const Content = opts.content;
  let settings = opts.settings;
  const tweens = new Tweens();
  const geos = geoCache();
  const mats = {}; // theme materials, rebuilt on setTheme

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);
  const gpu = detectGpu(renderer);
  const detected = Gfx.detectPreset(gpu, isTouchDevice());

  // Image-based lighting: a neutral room environment prefiltered once.
  let envMap = null;
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    envMap = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    pmrem.dispose();
  } catch (e) { envMap = null; }

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

  // lights (created once, tinted per theme): warm directional key with a
  // shadow frustum fitted to the shelf unit, hemisphere fill, cool-ish rim,
  // and (with surface detail) a pendant lamp glow without shadows.
  const keyLight = new THREE.DirectionalLight(0xffc98a, 2.4);
  keyLight.position.set(3.2, 9, 7.5);
  keyLight.castShadow = false;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.02;
  keyLight.shadow.radius = 3;
  const keyTarget = new THREE.Object3D();
  keyLight.target = keyTarget;
  const fillLight = new THREE.HemisphereLight(0xfff0dd, 0x30221a, 0.9);
  const rimLight = new THREE.DirectionalLight(0xffdcb0, 0.7);
  rimLight.position.set(-4, 5, -3);
  const lampLight = new THREE.PointLight(0xffb866, 14, 0, 2);
  lampLight.position.set(0, 6.9, 1.2);
  lampLight.visible = false;
  scene.add(keyLight, keyTarget, fillLight, rimLight, lampLight);

  const particles = new Particles(scene, 400);
  const dust = new Dust(scene, 140);
  let lamps = [];          // pendant groups (sway)
  let texCache = null;     // procedural textures, built on first detailed use

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
  let quality = 'low';
  let q = Gfx.resolve({}, detected); // resolved graphics settings
  let gfxJson = null;
  let lookKey = null;       // theme + detail + item palette currently built
  let composer = null, postKey = null, postFailed = false;
  let pixelRatio = 1, size = [0, 0], adaptiveScale = 1, frameTimes = [], fps = 0;
  let clock = 0;            // ambient time (frozen when motion is off)
  let reducedMotion = false;
  let disposed = false;

  function keyOf(loc) {
    return loc.area === 'counter' ? 'c:' + loc.i : 's:' + loc.r + ':' + loc.c;
  }

  // ---------- theme ----------
  function themeById(id) {
    return Content.THEMES.find(t => t.id === id) || Content.THEMES[0];
  }
  let themeId = null;
  function setTheme(id, force) {
    const th = themeById(id);
    const key = th.id + '|' + q.detail + '|' + settings.colorPalette;
    if (key === lookKey && !force) return; // nothing visual changed
    lookKey = key;
    themeId = th.id;
    const p = th.palette;
    const detailed = q.detail === 'detailed';
    scene.background = new THREE.Color(p.fog);
    scene.fog = null; // fog would swallow the board at portrait camera distances
    keyLight.color.set(p.light);
    rimLight.color.set(p.accent);
    lampLight.color.set(p.light);
    lampLight.visible = detailed;
    for (const m of Object.values(mats)) m.dispose && m.dispose();
    if (detailed && !texCache) texCache = { wood: woodTexture(11), wood2: woodTexture(29), floor: floorTexture(5), wall: wallTexture() };
    const T = detailed ? texCache : {};
    const std = (o) => new THREE.MeshStandardMaterial(o);
    mats.wall = std({ color: p.wall, roughness: 0.95, map: T.wall || null, envMapIntensity: 0.3 });
    mats.floor = std({ color: p.floor, roughness: 0.62, map: T.floor || null, envMapIntensity: 0.45 });
    mats.wood = std({ color: p.wood, roughness: 0.55, map: T.wood || null, envMapIntensity: 0.5 });
    mats.woodDark = std({ color: p.woodDark, roughness: 0.65, map: T.wood2 || null, envMapIntensity: 0.4 });
    mats.counter = detailed
      ? new THREE.MeshPhysicalMaterial({ color: p.counter, roughness: 0.4, map: T.wood, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 0.6 })
      : std({ color: p.counter, roughness: 0.55 });
    mats.metal = std({ color: p.metal, roughness: 0.35, metalness: 0.7, envMapIntensity: 1.0 });
    mats.shade = std({ color: p.metal, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide, envMapIntensity: 0.9 });
    mats.accentGlow = std({ color: p.accent, emissive: p.accent, emissiveIntensity: detailed ? 2.4 : 0.9 });
    mats.canvasArt = std({ color: new THREE.Color(p.accent).lerp(new THREE.Color(p.wall), 0.45), roughness: 0.9, envMapIntensity: 0.2 });
    mats.canvasArt2 = std({ color: new THREE.Color(p.light).lerp(new THREE.Color(p.woodDark), 0.55), roughness: 0.9, envMapIntensity: 0.2 });
    buildEnv(p);
    if (curState) buildBoard(curState); // rebuild cells with new materials
  }

  // ---------- environment (deterministic decor from decor stream) ----------
  function buildEnv(p) {
    while (envGroup.children.length) {
      const c = envGroup.children.pop();
      c.traverse(o => { if (o.isMesh && o.geometry && !Object.values(geos).includes(o.geometry)) o.geometry.dispose(); });
    }
    const detailed = q.detail === 'detailed';
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), mats.floor);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.layers.set(LAYER_ENV);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 16), mats.wall);
    wall.position.set(0, 8, -2.2); wall.receiveShadow = true; wall.layers.set(LAYER_ENV);
    envGroup.add(floor, wall);
    lamps = [];

    if (!detailed) {
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
    } else {
      // wainscot panelling, chair rail and skirting along the wall
      const wains = new THREE.Mesh(new THREE.BoxGeometry(40, 1.5, 0.08), mats.woodDark);
      wains.position.set(0, 0.75, -2.14); wains.receiveShadow = true;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(40, 0.1, 0.16), mats.wood);
      rail.position.set(0, 1.53, -2.1); rail.receiveShadow = true;
      envGroup.add(wains, rail);
      for (let i = -9; i <= 9; i++) { // raised panel strips
        const stile = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.3, 0.05), mats.wood);
        stile.position.set(i * 1.6, 0.72, -2.08); stile.receiveShadow = true;
        envGroup.add(stile);
      }
      // pendant lamps: cord, metal shade, glowing bulb; each sways from its hook
      const shadeGeo = new THREE.CylinderGeometry(0.12, 0.42, 0.36, 24, 1, true);
      const capGeo = new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      const bulbGeo = new THREE.SphereGeometry(0.11, 12, 10);
      const cordGeo = new THREE.CylinderGeometry(0.022, 0.022, 2.2, 5);
      for (let i = 0; i < 3; i++) {
        const lamp = new THREE.Group();
        lamp.position.set((i - 1) * 3.2, 9.8, 1.2);
        const cord = new THREE.Mesh(cordGeo, mats.metal); cord.position.y = -1.1;
        const cap = new THREE.Mesh(capGeo, mats.shade); cap.position.y = -2.2;
        const shade = new THREE.Mesh(shadeGeo, mats.shade); shade.position.y = -2.34;
        const bulb = new THREE.Mesh(bulbGeo, mats.accentGlow); bulb.position.y = -2.44;
        lamp.add(cord, cap, shade, bulb);
        lamp.userData.phase = i * 1.9;
        lamps.push(lamp);
        envGroup.add(lamp);
      }
      // framed pictures beside the shelf unit (deterministic; not behind the title card)
      const frng = opts.rng.derive(curState ? curState.seed : 4242, opts.rng.STREAM_DECOR ^ 0x51);
      const frameGeoCache = [];
      for (let i = 0; curState && i < 4; i++) {
        const side = i % 2 ? 1 : -1;
        const fw = 0.9 + frng.next() * 0.6, fh = 0.7 + frng.next() * 0.7;
        const x = side * (boardDims.w / 2 + 1.6 + (i >> 1) * 2.2 + frng.next() * 0.5);
        const y = 3.4 + frng.next() * 2.2;
        const frame = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.06), mats.wood);
        frame.position.set(x, y, -2.14); frame.castShadow = frame.receiveShadow = true;
        const art = new THREE.Mesh(new THREE.PlaneGeometry(fw - 0.16, fh - 0.16), frng.next() > 0.5 ? mats.canvasArt : mats.canvasArt2);
        art.position.set(x, y, -2.105);
        frameGeoCache.push(frame, art);
      }
      if (frameGeoCache.length) envGroup.add(...frameGeoCache);
    }

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
    envGroup.traverse(o => { if (o.isMesh) o.layers.set(LAYER_ENV); });
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
    buildEnv(themeById(themeId || settings.theme).palette); // seeded crates per level
    fitShadow();
    renderer.compile(scene, camera);
  }

  // Fit the key light's orthographic shadow box tightly around the play area
  // (shelf unit, counter and the side crates), in light space.
  const _sc = new THREE.OrthographicCamera();
  const _v = new THREE.Vector3();
  function fitShadow() {
    const hw = boardDims.w / 2 + 2.6;
    keyTarget.position.set(0, boardDims.h * 0.45, 0.9);
    keyLight.position.set(keyTarget.position.x + 3.2, keyTarget.position.y + 7, keyTarget.position.z + 7.5);
    _sc.position.copy(keyLight.position);
    _sc.lookAt(keyTarget.position);
    _sc.updateMatrixWorld(true);
    const inv = _sc.matrixWorldInverse;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const x of [-hw, hw]) for (const y of [0, boardDims.h + 0.6]) for (const z of [-2.2, 3.6]) {
      _v.set(x, y, z).applyMatrix4(inv);
      x0 = Math.min(x0, _v.x); x1 = Math.max(x1, _v.x);
      y0 = Math.min(y0, _v.y); y1 = Math.max(y1, _v.y);
      z0 = Math.min(z0, _v.z); z1 = Math.max(z1, _v.z);
    }
    const c = keyLight.shadow.camera;
    Object.assign(c, { left: x0, right: x1, bottom: y0, top: y1, near: Math.max(0.1, -z1 - 0.5), far: -z0 + 0.5 });
    c.updateProjectionMatrix();
    keyLight.shadow.needsUpdate = true;
  }

  // Screen rectangle not covered by HUD chrome (top bar, rails, tray, lesson
  // banner). The camera frames the board inside it via a view offset.
  function safeRect() {
    const W = host.clientWidth, H = host.clientHeight;
    let top = 0, bottom = H, left = 0, right = W;
    const vis = (id) => {
      const el = document.getElementById(id);
      if (!el || el.classList.contains('hidden')) return null;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      const h = host.getBoundingClientRect();
      return { x: r.left - h.left, y: r.top - h.top, w: r.width, h: r.height };
    };
    const carve = (r) => {
      if (!r) return;
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      // full-width band → carve top/bottom; otherwise carve the nearer side
      if (r.w > W * 0.6) { if (cy < H / 2) top = Math.max(top, r.y + r.h); else bottom = Math.min(bottom, r.y); return; }
      if (r.h > (bottom - top) * 0.5 || r.w < W * 0.35) {
        if (cx < W / 2) left = Math.max(left, r.x + r.w); else right = Math.min(right, r.x);
        return;
      }
      if (cy < H / 2) top = Math.max(top, r.y + r.h); else bottom = Math.min(bottom, r.y);
    };
    carve(vis('hud-top'));
    carve(vis('hud-orders'));
    carve(vis('hud-actions'));
    const banner = vis('lesson-banner');
    if (banner) {
      // a wide banner across the top pushes the board down; a narrow docked
      // one behaves like a side rail
      if (banner.w > W * 0.45) top = Math.max(top, banner.y + banner.h);
      else if (banner.x + banner.w / 2 < W / 2) left = Math.max(left, banner.x + banner.w);
      else right = Math.min(right, banner.x);
    }
    // never let chrome squeeze the play rect below a usable size
    if (right - left < W * 0.4) { left = 0; right = W; }
    if (bottom - top < H * 0.4) { top = Math.min(top, H * 0.3); bottom = Math.max(bottom, H * 0.7); }
    return { x: left, y: top, w: right - left, h: bottom - top, W, H };
  }

  function fitCamera() {
    const sr = safeRect();
    // extra headroom at the top: the shelf unit's cap sits above the top row
    const ui = (window.UIScale && UIScale.value) || 1;
    const pad = 8 * ui, padTop = Math.min(48 * ui, sr.h * 0.08);
    const sx = sr.x + pad, sy = sr.y + padTop, sw = Math.max(1, sr.w - pad * 2), sh = Math.max(1, sr.h - pad - padTop);
    camera.aspect = sw / sh;
    camera.setViewOffset(sw, sh, -sx, -sy, sr.W, sr.H);
    camera.updateProjectionMatrix();
    const aspect = camera.aspect;
    const vFit = (boardDims.h * 0.8) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const hFit = (boardDims.w * 0.72) / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect);
    const dist = Math.max(7.5, vFit, hFit) + 1.2;
    camBase.set(0, 2.2 + boardDims.h * 0.42, dist);
    camTarget.set(0, boardDims.h * 0.5, 0.6);
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
    const g = makeItemMesh(type, geos, itemColor(type), q.detail);
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
          particles.burst(p, itemColor(ev.item), q.particles === 'low' ? 10 : 24, 1.6, 1.8);
        }
        if (!reducedMotion) camShake = Math.max(camShake, 0.06);
      } else if (ev.type === 'win') {
        particles.burst(new THREE.Vector3(0, boardDims.h * 0.6, 0.5), 0xffd070, q.particles === 'low' ? 30 : 80, 3.2, 2.6);
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
    ghost = makeItemMesh(itemType, geos, itemColor(itemType), q.detail);
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

  // ---------- graphics settings (js/gfx.js) ----------
  /** Apply saved graphics settings (settings.gfx). Unchanged settings are a no-op. */
  function setGraphics(saved) {
    const json = JSON.stringify(saved || {});
    if (json === gfxJson) return;
    gfxJson = json;
    const prevDetail = q.detail;
    q = Gfx.resolve(saved || {}, detected);
    quality = q.preset;
    const sz = Gfx.SHADOW_MAP[q.shadows];
    renderer.shadowMap.enabled = sz > 0;
    keyLight.castShadow = sz > 0;
    if (sz > 0 && keyLight.shadow.mapSize.x !== sz) {
      keyLight.shadow.mapSize.set(sz, sz);
      keyLight.shadow.map && keyLight.shadow.map.dispose();
      keyLight.shadow.map = null;
    }
    keyLight.shadow.radius = q.shadows === 'high' ? 4 : 3;
    // Image-based lighting: with the room environment the hemisphere fill steps back.
    scene.environment = q.reflections === 'on' ? envMap : null;
    fillLight.intensity = scene.environment ? 0.55 : 0.9;
    if (q.detail !== prevDetail && lookKey) setTheme(themeId, true);
    dust.points.visible = q.particles === 'high';
    adaptiveScale = 1;
    frameTimes.length = 0;
    postKey = null; // rebuild the post chain on the next frame
    fpsVisible(q.showFps);
    // Materials pick up shadow-map changes on recompile.
    scene.traverse(o => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
    });
    for (const m of itemMatCache.values()) { m.mat.needsUpdate = true; m.dark.needsUpdate = true; }
    const el = renderer.domElement;
    el.dataset.gfxPreset = q.preset;
    document.body.dataset.gfxPreset = q.preset;
    document.body.dataset.gfxAuto = q.auto ? 'true' : 'false';
    applySize(true);
  }

  /** What the Graphics panel shows: GPU, auto choice, resolved tiers, pixels, frame rate. */
  function graphicsInfo() {
    const px = [Math.round(size[0] * pixelRatio), Math.round(size[1] * pixelRatio)];
    return { gpu, detected, resolved: q, pixels: px, fps: Math.round(fps), adaptiveScale: Math.round(adaptiveScale * 100) / 100, postFailed };
  }

  function fpsVisible(on) {
    let el = document.getElementById('fps-meter');
    if (on && !el) {
      el = document.createElement('div');
      el.id = 'fps-meter';
      el.setAttribute('aria-hidden', 'true');
      el.textContent = '… fps';
      document.body.append(el);
    }
    if (el) el.hidden = !on;
  }

  function currentPostKey() {
    return q.post ? [q.ao, q.bloom, q.grade, q.antialias, size[0], size[1], pixelRatio].join('|') : 'none';
  }

  function buildPost() {
    if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); composer.passes.forEach(p => p.dispose && p.dispose()); }
    composer = null;
    if (!q.post || postFailed) return;
    const [w, h] = size;
    const pw = Math.max(1, Math.round(w * pixelRatio)), ph = Math.max(1, Math.round(h * pixelRatio));
    try {
      const target = new THREE.WebGLRenderTarget(pw, ph, { type: THREE.HalfFloatType, samples: q.antialias === 'msaa' ? 4 : 0 });
      const c = new EffectComposer(renderer, target);
      c.setPixelRatio(pixelRatio);
      c.setSize(w, h);
      c.addPass(new RenderPass(scene, camera));
      if (q.ao !== 'off') {
        const ao = new GTAOPass(scene, camera, pw, ph);
        ao.output = GTAOPass.OUTPUT.Default;
        ao.blendIntensity = 0.75;
        const hi = q.ao === 'high';
        ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: hi ? 16 : 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: hi ? 6 : 4, rings: 2, samples: hi ? 16 : 8 });
        c.addPass(ao);
      }
      // High threshold: only flames, lantern glass and lamp bulbs bloom.
      if (q.bloom === 'on') c.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.5, 0.9));
      if (q.grade === 'on') c.addPass(new ShaderPass(GradeShader));
      c.addPass(new OutputPass());
      if (q.antialias === 'smaa') c.addPass(new SMAAPass(pw, ph));
      if (q.antialias === 'fxaa') {
        const fxaa = new ShaderPass(FXAAShader);
        fxaa.material.uniforms.resolution.value.set(1 / pw, 1 / ph);
        c.addPass(fxaa);
      }
      composer = c;
    } catch (e) {
      // Post-processing is an enhancement: render directly when it cannot be built
      // (the Graphics panel says so).
      postFailed = true;
      composer = null;
    }
  }

  // Adaptive resolution: step the render scale down when frames are slow, back up when fast.
  function adapt(dtMs) {
    frameTimes.push(dtMs);
    if (frameTimes.length < 90) return false;
    let sum = 0;
    for (const f of frameTimes) sum += f;
    const avg = sum / frameTimes.length;
    frameTimes.length = 0;
    fps = 1000 / avg;
    const el = document.getElementById('fps-meter');
    if (el && !el.hidden) el.textContent = Math.round(fps) + ' fps · ' + (Math.round(pixelRatio * 100) / 100) + '×';
    if (!q.adaptive) return false;
    const before = adaptiveScale;
    if (avg > 26) adaptiveScale = Math.max(0.6, adaptiveScale - 0.1);
    else if (avg < 14 && adaptiveScale < 1) adaptiveScale = Math.min(1, adaptiveScale + 0.05);
    return before !== adaptiveScale;
  }

  // Pixel ratio = min(dpr, preset cap) × preset/user scale × adaptive scale.
  function applySize(force) {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return false;
    const ratio = Math.min(window.devicePixelRatio || 1, q.cap) * q.scale * adaptiveScale;
    if (!force && w === size[0] && h === size[1] && ratio === pixelRatio) return false;
    size = [w, h];
    pixelRatio = ratio;
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    return true;
  }

  function setReducedMotion(on) { reducedMotion = !!on; }
  function setParallax(x, y) { parallax.x = x; parallax.y = y; }

  function resize() {
    if (!host.clientWidth || !host.clientHeight) return;
    applySize(false);
    fitCamera();
  }

  // ---------- frame loop ----------
  let last = 0;
  let running = true;
  function frame(t) {
    if (disposed) return;
    requestAnimationFrame(frame);
    if (!running) { last = t; return; }
    const rawMs = last ? Math.min(250, t - last) : 16;
    const dt = Math.min(0.05, rawMs / 1000);
    last = t;
    tweens.tick(dt);
    particles.tick(dt);
    // ambient motion: candle/lantern flicker, lamp sway, dust drift
    if (q.ambient === 'animated' && !reducedMotion) {
      clock += dt;
      const glow = glowMats[q.detail];
      const base = q.detail === 'detailed' ? 2.2 : 1.6;
      if (glow) glow.emissiveIntensity = base * (1 + 0.1 * Math.sin(clock * 9.1) + 0.06 * Math.sin(clock * 23.7 + 1.3));
      for (const l of lamps) l.rotation.z = Math.sin(clock * 0.6 + l.userData.phase) * 0.012;
      lampLight.intensity = 14 * (1 + 0.03 * Math.sin(clock * 5.3));
      dust.tick(clock);
    } else if (glowMats[q.detail]) glowMats[q.detail].emissiveIntensity = q.detail === 'detailed' ? 2.2 : 1.6;
    if (adapt(rawMs) && applySize(false)) fitCamera();
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
    const key = currentPostKey();
    if (key !== postKey) { postKey = key; buildPost(); }
    if (composer) composer.render(dt);
    else renderer.render(scene, camera);
  }

  function setRunning(on) { running = !!on; }
  function skipAll() { tweens.finishAll(); }
  function isBusy() { return tweens.busy; }

  function dispose() {
    disposed = true;
    renderer.dispose();
    for (const g of Object.values(geos)) g.dispose();
    for (const m of Object.values(mats)) m.dispose && m.dispose();
    if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); }
    if (envMap) envMap.dispose();
    host.removeChild(renderer.domElement);
  }

  function setSettings(s) { settings = s; }

  setGraphics(settings.gfx || {});
  setTheme(settings.theme || 'ember');
  resize();
  requestAnimationFrame(frame);

  return {
    buildBoard, syncState, skipAll, isBusy,
    pickLoc, screenPos, setCursor,
    setSelection, clearSelection, showGhost, hideGhost, setHint, clearHint,
    setTheme, setGraphics, graphicsInfo, setSettings, setReducedMotion, setParallax,
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
