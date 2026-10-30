// The miniature boutique on starhermit:scene, as the browser build's
// js/render3d.js drew it with three.js r160: the wall and plank floor, the
// pendant lamps (bulbs on cords on Low; cord, brass shade and glowing bulb
// swaying from hooks, with the lamp's point light, when detailed), the
// wainscot, chair rail and framed pictures (detailed), the seeded crates, the
// shelf unit (back panel, planks, pillars) and the counter table, the cell
// inlays and their marker rings (legal targets green, the lifted item's cell
// amber, the hint blue), the keyboard focus ring, the eight procedural items
// (teapot, candle, book, plant, vase, clock, mug, lantern) with their
// lift / fly / drop / pop tweens, the selection outline and the drag ghost,
// pooled particle bursts on clears and wins, drifting dust motes, candle and
// lantern flicker, the camera's pointer parallax and shake. Graphics follow
// the runtime's quality tier (native/quality.ts: gfx.js's presets and
// budgets) and the game's colour palette; the theme (Content.THEMES) tints
// the room.
//
// From three.js r160 (physically based lights): colours and intensities as
// written (engine.minor 23+ takes r155+ light units). render3d.js's `new RoomEnvironment(renderer)` (r160) is kept
// exactly; every lit material carries the environment as its own envMap at
// its envMapIntensity, as r160's scene.environment applied each material's
// intensity. The old composer (RenderPass in half floats → GTAO → UnrealBloom
// 0.5 / 0.5 / 0.9, its strength squared as r160's pass added less light than
// r185's → the colour grade + vignette → OutputPass with ACES at
// exposure 1.05 → SMAA / FXAA) is the runtime's renderer.ao / bloom / post /
// antialias; the grade is the old shader in WGSL as renderer.post, which the
// engine runs before bloom (the old one ran after it). The old canvas filled
// the window with the HUD over it: the camera frames the board in the part
// the HUD leaves uncovered with a view offset (render3d.js safeRect /
// fitCamera).
import {
  ACESFilmicToneMapping, AdditiveBlending, BackSide, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, ClampToEdgeWrapping, Color,
  ConeGeometry, CylinderGeometry, DirectionalLight, DoubleSide, Group, HemisphereLight, IcosahedronGeometry, InstancedMesh, LatheGeometry,
  Matrix4, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, PerspectiveCamera, PlaneGeometry, PMREMGenerator,
  PointLight, Points, PointsMaterial, Raycaster, RepeatWrapping, RingGeometry, RoomEnvironment, SphereGeometry, SRGBColorSpace,
  OrthographicCamera, TorusGeometry, Vector2, Vector3, pointerToNdc, renderer, scene, type Material, type Texture,
} from "starhermit:scene";
import { OffscreenCanvas, type OffscreenCanvasRenderingContext2D } from "starhermit:canvas";
import { Content, RNG, type Loc, type GameEvent, type State, type Theme } from "./classic.ts";
import { DUST_MAX, type Look } from "./quality.ts";

export interface Rect { x: number; y: number; width: number; height: number }

// ---------- tiny deterministic tween manager ----------
interface Tween { dur: number; ease?: (k: number) => number; onUpdate: (k: number) => void; onDone?: () => void; tag?: string; t: number }
class Tweens {
  list: Tween[] = [];
  add(t: Omit<Tween, "t">): void {
    if (t.tag) this.kill(t.tag);
    this.list.push({ ...t, t: 0 });
  }
  kill(tag: string): void { for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i]!.tag === tag) this.list.splice(i, 1); }
  has(tag: string): boolean { return this.list.some((t) => t.tag === tag); }
  tick(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const tw = this.list[i]!;
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.onUpdate((tw.ease || easeInOut)(k));
      if (k >= 1) { this.list.splice(this.list.indexOf(tw), 1); tw.onDone?.(); }
    }
  }
  finishAll(): void {
    const all = this.list.splice(0);
    for (const tw of all) { tw.onUpdate(1); tw.onDone?.(); }
  }
  get busy(): boolean { return this.list.length > 0; }
}
const easeInOut = (k: number): number => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const easeOutBack = (k: number): number => { const c = 1.70158; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
const easeOut = (k: number): number => 1 - Math.pow(1 - k, 3);

// ---------- item geometry (render3d.js geoCache) ----------
const V2 = (x: number, y: number): Vector2 => new Vector2(x, y);
const geos = {
  potBody: new LatheGeometry([V2(0, 0), V2(0.26, 0.02), V2(0.34, 0.18), V2(0.3, 0.38), V2(0.16, 0.48), V2(0.18, 0.52)], 20),
  potLid: new SphereGeometry(0.1, 12, 8),
  potSpout: new CylinderGeometry(0.05, 0.08, 0.28, 8),
  candle: new CylinderGeometry(0.16, 0.18, 0.5, 16),
  flame: new ConeGeometry(0.05, 0.16, 8),
  book: new BoxGeometry(0.5, 0.62, 0.16),
  bookCover: new BoxGeometry(0.54, 0.66, 0.05),
  plantPot: new CylinderGeometry(0.2, 0.15, 0.24, 12),
  leaf: new IcosahedronGeometry(0.17, 0),
  vase: new LatheGeometry([V2(0, 0), V2(0.18, 0.02), V2(0.24, 0.25), V2(0.12, 0.5), V2(0.15, 0.62)], 18),
  clockFace: new CylinderGeometry(0.3, 0.3, 0.09, 24),
  clockRim: new TorusGeometry(0.3, 0.045, 8, 24),
  clockHand: new BoxGeometry(0.03, 0.2, 0.02),
  mug: new CylinderGeometry(0.17, 0.15, 0.36, 16),
  mugHandle: new TorusGeometry(0.11, 0.03, 8, 12, Math.PI),
  lanternFrame: new CylinderGeometry(0.2, 0.24, 0.5, 6, 1, true),
  lanternGlow: new SphereGeometry(0.11, 10, 8),
  lanternCap: new ConeGeometry(0.22, 0.14, 6),
  cell: new PlaneGeometry(1.0, 0.92),
  marker: new RingGeometry(0.3, 0.42, 24),
};
const proxyGeo = new BoxGeometry(1.0, 0.8, 0.92);
// low on the counter: the shelf unit's bottom row is seen over the counter table
const counterProxyGeo = new BoxGeometry(1.0, 0.3, 0.92);
const proxyMat = new MeshBasicMaterial({ color: 0xffffff });
const sharedGeos = new Set<BufferGeometry>([...Object.values(geos), proxyGeo, counterProxyGeo]);

// ---------- the scene's state ----------
let look: Look | null = null;
let palette: "standard" | "high-visibility" = "standard";
let reducedMotion = false;
let envTex: Texture | null = null;
const tweens = new Tweens();

/** Every lit material made (for the environment, shadows and texture maps applied later). */
const litMats = new Set<MeshStandardMaterial>();
function lit<M extends MeshStandardMaterial>(m: M): M { litMats.add(m); return m; }

// Item materials are shared per (type, colour, detail, budget) so the flame/lantern glow flickers with one write.
const CERAMIC = new Set(["teapot", "vase", "mug"]);
const itemMatCache = new Map<string, { mat: MeshStandardMaterial; dark: MeshStandardMaterial }>();
const glowMats: Record<string, MeshStandardMaterial> = {};
const detailKey = (): string => (look?.detailed ? "detailed" : "plain");
function glowMaterial(): MeshStandardMaterial {
  const d = detailKey();
  glowMats[d] ??= lit(new MeshStandardMaterial({ color: 0xffdd99, emissive: 0xffbb55, emissiveIntensity: d === "detailed" ? 2.2 : 1.6, roughness: 0.4 }));
  return glowMats[d]!;
}
function itemMaterials(type: string, color: number): { mat: MeshStandardMaterial; dark: MeshStandardMaterial } {
  const detail = detailKey(), material = look?.budget.material ?? "standard";
  const key = `${type}|${color}|${detail}|${material}`;
  const hit = itemMatCache.get(key);
  if (hit) return hit;
  const darkCol = new Color(color).multiplyScalar(0.55);
  const std = (o: ConstructorParameters<typeof MeshStandardMaterial>[0]): MeshStandardMaterial => lit(new MeshStandardMaterial(o));
  const phys = (o: ConstructorParameters<typeof MeshPhysicalMaterial>[0]): MeshPhysicalMaterial => lit(new MeshPhysicalMaterial(o));
  let e: { mat: MeshStandardMaterial; dark: MeshStandardMaterial };
  if (detail !== "detailed") {
    e = { mat: std({ color, roughness: 0.65, metalness: 0.08 }), dark: std({ color: darkCol, roughness: 0.7, metalness: 0.05 }) };
  } else if (CERAMIC.has(type) && material === "standard") {
    e = { mat: std({ color, roughness: 0.4, metalness: 0, envMapIntensity: 0.45 }), dark: std({ color: darkCol, roughness: 0.42, envMapIntensity: 0.45 }) };
  } else if (CERAMIC.has(type)) {
    // glazed ceramic: clearcoat catches the lamp and room reflections
    e = {
      mat: phys({ color, roughness: 0.5, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.18, envMapIntensity: 0.35 }),
      dark: phys({ color: darkCol, roughness: 0.5, clearcoat: 0.45, clearcoatRoughness: 0.25, envMapIntensity: 0.35 }),
    };
  } else if (type === "lantern" || type === "clock") {
    e = { mat: std({ color, roughness: 0.38, metalness: 0.45, envMapIntensity: 1.0 }), dark: std({ color: darkCol, roughness: 0.3, metalness: 0.75, envMapIntensity: 1.1 }) };
  } else if (type === "candle" && material === "standard") {
    e = { mat: std({ color, roughness: 0.5, envMapIntensity: 0.6 }), dark: std({ color: darkCol, roughness: 0.6 }) };
  } else if (type === "candle") {
    // render3d.js gave the wax sheen 0.6 (#fff0d0); the engine keeps sheen but does not draw it
    e = { mat: phys({ color, roughness: 0.5, envMapIntensity: 0.6 }), dark: std({ color: darkCol, roughness: 0.6 }) };
  } else { // book, plant: cloth and leaf, soft and matte
    e = { mat: std({ color, roughness: 0.78, metalness: 0, envMapIntensity: 0.5 }), dark: std({ color: darkCol, roughness: 0.62, metalness: 0.05, envMapIntensity: 0.6 }) };
  }
  applyEnv([e.mat, e.dark]);
  itemMatCache.set(key, e);
  return e;
}
function makeItemMesh(type: string, color: number): Group {
  const grp = new Group();
  const { mat, dark } = itemMaterials(type, color);
  const glow = glowMaterial();
  const add = (geo: BufferGeometry, m: Material, f?: (o: Mesh) => void): void => { const o = new Mesh(geo, m); f?.(o); grp.add(o); };
  switch (type) {
    case "teapot":
      add(geos.potBody, mat);
      add(geos.potLid, dark, (o) => { o.position.y = 0.54; });
      add(geos.potSpout, dark, (o) => { o.position.set(0.34, 0.3, 0); o.rotation.z = -0.7; });
      break;
    case "candle":
      add(geos.candle, mat, (o) => { o.position.y = 0.25; });
      add(geos.flame, glow, (o) => { o.position.y = 0.58; });
      break;
    case "book":
      add(geos.book, mat, (o) => { o.position.y = 0.31; o.rotation.y = 0.12; });
      add(geos.bookCover, dark, (o) => { o.position.set(0, 0.31, 0.09); o.rotation.y = 0.12; });
      break;
    case "plant":
      add(geos.plantPot, dark, (o) => { o.position.y = 0.12; });
      add(geos.leaf, mat, (o) => { o.position.y = 0.42; });
      add(geos.leaf, mat, (o) => { o.scale.setScalar(0.7); o.position.set(0.12, 0.55, 0.05); });
      break;
    case "vase":
      add(geos.vase, mat);
      break;
    case "clock":
      add(geos.clockFace, mat, (o) => { o.rotation.x = Math.PI / 2; o.position.y = 0.34; });
      add(geos.clockRim, dark, (o) => { o.position.y = 0.34; });
      add(geos.clockHand, dark, (o) => { o.position.set(0.05, 0.36, 0.06); o.rotation.z = -0.5; });
      break;
    case "mug":
      add(geos.mug, mat, (o) => { o.position.y = 0.18; });
      add(geos.mugHandle, dark, (o) => { o.position.set(0.19, 0.2, 0); o.rotation.z = -Math.PI / 2; });
      break;
    case "lantern":
      add(geos.lanternFrame, mat, (o) => { o.position.y = 0.27; });
      add(geos.lanternGlow, glow, (o) => { o.position.y = 0.27; });
      add(geos.lanternCap, dark, (o) => { o.position.y = 0.58; });
      break;
  }
  grp.traverse((o) => { if (o instanceof Mesh) { o.castShadow = true; o.receiveShadow = true; } });
  grp.userData.itemType = type;
  return grp;
}

// ---------- procedural textures (render3d.js, unchanged drawing) ----------
type Ctx = OffscreenCanvasRenderingContext2D;
function hashRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** `k` scales the canvas (the preset's texture budget); the pattern is drawn in the same logical w×h space. */
function canvasTex(w: number, h: number, paint: (g: Ctx, w: number, h: number) => void, repeat: [number, number] | null, k = 1): CanvasTexture {
  const c = new OffscreenCanvas(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
  const g = c.getContext("2d");
  g.scale(c.width / w, c.height / h);
  paint(g, w, h);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}
let softDotTex: CanvasTexture | null = null;
function softDot(): CanvasTexture {
  if (softDotTex) return softDotTex;
  softDotTex = canvasTex(64, 64, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.4, "rgba(255,255,255,0.55)"); r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  }, null);
  softDotTex.wrapS = softDotTex.wrapT = ClampToEdgeWrapping;
  return softDotTex;
}
/** Wood grain: long wavy streaks along U, multiplied onto the theme wood colour. */
function woodTexture(seed: number, k: number): CanvasTexture {
  const rnd = hashRng(seed);
  return canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = "#ece4dc"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const y0 = rnd() * h, amp = 1 + rnd() * 4, f = 1 + rnd() * 3, ph = rnd() * 6.28;
      const l = (150 + rnd() * 90) | 0;
      g.strokeStyle = `rgba(${(l * 0.55) | 0},${(l * 0.4) | 0},${(l * 0.3) | 0},${0.08 + rnd() * 0.2})`;
      g.lineWidth = 0.6 + rnd() * 2.2;
      g.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = y0 + Math.sin((x / w) * Math.PI * 2 * f + ph) * amp;
        if (x) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < 3; i++) { // a few knots
      const x = rnd() * w, y = rnd() * h, r = 3 + rnd() * 5;
      const kg = g.createRadialGradient(x, y, 0, x, y, r * 2);
      kg.addColorStop(0, "rgba(80,50,30,0.45)"); kg.addColorStop(1, "rgba(80,50,30,0)");
      g.fillStyle = kg; g.beginPath(); g.ellipse(x, y, r * 3, r, 0, 0, 7); g.fill();
    }
  }, null, k);
}
/** Floor planks: staggered boards with seams and per-board tone. */
function floorTexture(seed: number, k: number): CanvasTexture {
  const rnd = hashRng(seed);
  return canvasTex(512, 512, (g, w, h) => {
    const rows = 8, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      // planks fill exactly one texture width from a random start and are also drawn shifted by ±w (tiles without a seam)
      const x0 = rnd() * w;
      let x = x0;
      while (x < x0 + w) {
        const len = Math.min(180 + rnd() * 200, x0 + w - x), v = (205 + rnd() * 50) | 0;
        const lines: [number, number, number, number][] = [];
        for (let i = 0; i < 7; i++) lines.push([0.06 + rnd() * 0.12, 0.8 + rnd() * 1.5, r * rh + rnd() * rh, (rnd() - 0.5) * 4]);
        for (const off of [-w, 0]) {
          const px = x + off;
          g.fillStyle = `rgb(${v},${(v * 0.95) | 0},${(v * 0.9) | 0})`;
          g.fillRect(px, r * rh, len, rh);
          for (const [a, lw, y, dy] of lines) {
            g.strokeStyle = `rgba(90,60,40,${a})`; g.lineWidth = lw;
            g.beginPath(); g.moveTo(px, y); g.lineTo(px + len, y + dy); g.stroke();
          }
          g.fillStyle = "rgba(40,25,15,0.55)"; g.fillRect(px, r * rh, 2, rh);
        }
        x += len;
      }
      g.fillStyle = "rgba(40,25,15,0.6)"; g.fillRect(0, r * rh, w, 2);
    }
  }, [8, 6], k);
}
/** Wallpaper: soft vertical stripes with a small diamond motif. */
function wallTexture(k: number): CanvasTexture {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "#f2f2f2"; g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(255,255,255,1)"; g.fillRect(0, 0, w / 2, h);
    g.fillStyle = "rgba(0,0,0,0.06)"; g.fillRect(w / 2 - 3, 0, 6, h); g.fillRect(w - 3, 0, 6, h); g.fillRect(0, 0, 3, h);
    g.fillStyle = "rgba(0,0,0,0.08)";
    for (const [cx, cy] of [[w / 4, h / 4], [w / 4, (h * 3) / 4], [(w * 3) / 4, h / 2], [(w * 3) / 4, 0], [(w * 3) / 4, h]] as [number, number][]) {
      g.beginPath(); g.moveTo(cx, cy - 12); g.lineTo(cx + 8, cy); g.lineTo(cx, cy + 12); g.lineTo(cx - 8, cy); g.closePath(); g.fill();
    }
  }, [16, 6], k);
}
/** The detailed textures at a texture budget, painted one a frame (the canvas work budget), then put on their materials. */
interface TexSet { k: number; wood?: CanvasTexture; wood2?: CanvasTexture; floor?: CanvasTexture; wall?: CanvasTexture }
let texCache: TexSet | null = null;
const TEX_JOBS: [keyof Omit<TexSet, "k">, (k: number) => CanvasTexture][] = [
  ["floor", (k) => floorTexture(5, k)], ["wall", (k) => wallTexture(k)], ["wood", (k) => woodTexture(11, k)], ["wood2", (k) => woodTexture(29, k)],
];
function textureStep(): void {
  if (!look?.detailed || !texCache) return;
  for (const [name, make] of TEX_JOBS) {
    if (texCache[name]) continue;
    try { texCache[name] = make(texCache.k); } catch (e) { console.warn(`texture ${name}: ${String(e)}`); texCache[name] = undefined; return; }
    applyMaps();
    return;
  }
}
function applyMaps(): void {
  const T = look?.detailed && texCache ? texCache : null;
  const set = (m: MeshStandardMaterial | undefined, t: Texture | undefined): void => {
    if (!m) return;
    const next = T && t ? t : null;
    if (m.map !== next) m.map = next;
  };
  set(mats.wall, T?.wall); set(mats.floor, T?.floor); set(mats.wood, T?.wood); set(mats.woodDark, T?.wood2);
  if (mats.counter instanceof MeshPhysicalMaterial) set(mats.counter, T?.wood);
}

// ---------- pooled particle bursts ----------
class Particles {
  readonly cap: number;
  readonly pos: Float32Array; readonly vel: Float32Array; readonly life: Float32Array; readonly col: Float32Array;
  readonly points: Points;
  cursor = 0;
  constructor(capacity: number) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3); this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity); this.col = new Float32Array(capacity * 3);
    for (let i = 0; i < capacity; i++) this.pos[i * 3 + 1] = -999;
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(this.pos, 3));
    g.setAttribute("color", new BufferAttribute(this.col, 3));
    this.points = new Points(g, new PointsMaterial({
      size: 0.11, vertexColors: true, transparent: true, opacity: 0.95, map: softDot(),
      depthWrite: false, sizeAttenuation: true, blending: AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  burst(p: Vector3, color: number, n: number, spread: number, up: number): void {
    const c = new Color(color);
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
    (this.points.geometry.attributes.color as BufferAttribute).needsUpdate = true;
  }
  tick(dt: number): void {
    let any = false;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i]! <= 0) continue;
      any = true;
      this.life[i] = this.life[i]! - dt;
      if (this.life[i]! <= 0) { this.pos[i * 3 + 1] = -999; continue; }
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1]! - 4.5 * dt;
      this.pos[i * 3] = this.pos[i * 3]! + this.vel[i * 3]! * dt;
      this.pos[i * 3 + 1] = this.pos[i * 3 + 1]! + this.vel[i * 3 + 1]! * dt;
      this.pos[i * 3 + 2] = this.pos[i * 3 + 2]! + this.vel[i * 3 + 2]! * dt;
    }
    if (any) (this.points.geometry.attributes.position as BufferAttribute).needsUpdate = true;
  }
}

/** Drifting dust motes in the lamp light. */
class Dust {
  readonly n: number; readonly base: Float32Array; readonly pos: Float32Array; readonly ph: Float32Array;
  readonly points: Points;
  count: number;
  constructor(n: number) {
    const rnd = hashRng(77);
    this.n = n; this.count = n;
    this.base = new Float32Array(n * 3); this.pos = new Float32Array(n * 3); this.ph = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.base[i * 3] = (rnd() - 0.5) * 9;
      this.base[i * 3 + 1] = 0.8 + rnd() * 6.8;
      this.base[i * 3 + 2] = -0.4 + rnd() * 3.8;
      this.ph[i] = rnd() * 100;
    }
    this.pos.set(this.base);
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(this.pos, 3));
    this.points = new Points(g, new PointsMaterial({
      size: 0.045, color: 0xffe2b8, map: softDot(), transparent: true, opacity: 0.55,
      depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }
  /** Draw (and animate) only the first n motes: the preset's dust budget. */
  setCount(n: number): void {
    this.count = Math.max(0, Math.min(this.n, n | 0));
    this.points.geometry.setDrawRange(0, this.count);
  }
  tick(t: number): void {
    if (!this.points.visible) return;
    for (let i = 0; i < this.count; i++) {
      const p = this.ph[i]!, k = i * 3;
      this.pos[k] = this.base[k]! + Math.sin(t * 0.13 + p) * 0.35;
      this.pos[k + 1] = this.base[k + 1]! + Math.sin(t * 0.09 + p * 1.7) * 0.45;
      this.pos[k + 2] = this.base[k + 2]! + Math.cos(t * 0.11 + p) * 0.25;
    }
    (this.points.geometry.attributes.position as BufferAttribute).needsUpdate = true;
  }
}

// The old GradeShader (warm highlights, slightly cooler shadows, saturation 1.1, a gentle log-space contrast about
// mid-grey, a 0.28 vignette), on the linear light before the tone mapping, as renderer.post.
const GRADE = {
  pixel: /* wgsl */ `
fn pixel(p: Pixel) -> vec4f {
  let src = scene_color(p.uv);
  var c = src.rgb;
  let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  var g = c * mix(vec3f(0.95, 0.98, 1.06), vec3f(1.05, 1.0, 0.94), smoothstep(0.02, 0.5, l));
  let gl = dot(g, vec3f(0.2126, 0.7152, 0.0722));
  g = max(mix(vec3f(gl), g, 1.1), vec3f(0.0));
  g = pow(max(g, vec3f(1e-7)) / 0.18, vec3f(1.06)) * 0.18;
  c = mix(c, g, 1.0);
  let d = length((p.uv - vec2f(0.5)) * vec2f(1.1, 1.0));
  c = c * (1.0 - 0.28 * smoothstep(0.38, 0.9, d));
  return vec4f(c, src.a);
}`,
};

// ---------- camera, lights, groups ----------
const camera = new PerspectiveCamera(34, 1, 0.1, 100);
const camBase = new Vector3(0, 4.6, 9.2);
const camTarget = new Vector3(0, 2.6, 0);
let camShake = 0;
const parallax = { x: 0, y: 0 };
const raycaster = new Raycaster();
const ndc = new Vector2();

const envGroup = new Group();
const boardGroup = new Group();
const itemGroup = new Group();
const selGroup = new Group();
scene.add(envGroup, boardGroup, itemGroup, selGroup);

// warm directional key with shadows, hemisphere fill, rim, and (detailed) the pendant lamp's glow without shadows
const keyLight = new DirectionalLight(0xffc98a, 2.4);
keyLight.position.set(3.2, 9, 7.5);
keyLight.castShadow = false;
keyLight.shadow.bias = -0.0004;
keyLight.shadow.normalBias = 0.02;
keyLight.shadow.radius = 3;
const keyTarget = new Object3D();
keyLight.target = keyTarget;
const fillLight = new HemisphereLight(0xfff0dd, 0x30221a, 0.9);
const rimLight = new DirectionalLight(0xffdcb0, 0.7);
rimLight.position.set(-4, 5, -3);
const LAMP = 14;
const lampLight = new PointLight(0xffb866, LAMP, 0, 2);
lampLight.position.set(0, 6.9, 1.2);
lampLight.visible = false;
scene.add(keyLight, keyTarget, fillLight, rimLight, lampLight);

const particles = new Particles(800);
const dust = new Dust(DUST_MAX);
let lamps: Group[] = [];

// ---------- the board's state ----------
interface CellView { mesh: Mesh; ring: Mesh; ringMat: MeshBasicMaterial; pos: Vector3; key: string; proxy: Mesh }
let cellMeshes = new Map<string, CellView>();
let itemMeshes = new Map<string, Group>();
let curState: State | null = null;
let selection: string | null = null;
let legalTargetKeys = new Set<string>();
let hintCells: CellView[] = [];
let ghost: Group | null = null;
let outline: Group | null = null;
let boardDims = { w: 5, h: 6 };
let clock = 0;
let themeId = "ember";
let lookKey = "";

const keyOf = (loc: Loc): string => (loc.area === "counter" ? `c:${loc.i}` : `s:${loc.r}:${loc.c}`);
function parseKey(key: string): Loc {
  const p = key.split(":");
  return p[0] === "c" ? { area: "counter", i: +p[1]! } : { area: "shelf", r: +p[1]!, c: +p[2]! };
}

// ---------- theme materials ----------
const mats: {
  wall?: MeshStandardMaterial; floor?: MeshStandardMaterial; wood?: MeshStandardMaterial; woodDark?: MeshStandardMaterial;
  counter?: MeshStandardMaterial; metal?: MeshStandardMaterial; shade?: MeshStandardMaterial; accentGlow?: MeshStandardMaterial;
  canvasArt?: MeshStandardMaterial; canvasArt2?: MeshStandardMaterial;
} = {};
function themeById(id: string): Theme { return Content.THEMES.find((t) => t.id === id) || Content.THEMES[0]!; }

function environmentTexture(): Texture | null {
  if (!envTex) {
    try {
      const pmrem = new PMREMGenerator(renderer);
      envTex = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    } catch (e) { console.warn(`environment: ${String(e)}`); }
  }
  return envTex;
}
/** r160 scene.environment at each material's envMapIntensity (Reflections on). */
function applyEnv(list: Iterable<MeshStandardMaterial>): void {
  const env = look?.reflections ? environmentTexture() : null;
  for (const m of list) if (m.envMap !== env) m.envMap = env;
}

/** render3d.js setTheme: room colours and materials for a theme (rebuilt only when something visual changed). */
export function setTheme(id: string, force = false): void {
  const th = themeById(id);
  const key = `${th.id}|${lookOf()}|${palette}`;
  if (key === lookKey && !force) return;
  lookKey = key;
  themeId = th.id;
  const p = th.palette;
  const detailed = !!look?.detailed;
  scene.background = new Color(p.fog!);
  scene.fog = null;
  keyLight.color.set(p.light!);
  rimLight.color.set(p.accent!);
  lampLight.color.set(p.light!);
  lampLight.visible = detailed;
  for (const m of Object.values(mats)) { if (m) { litMats.delete(m); m.dispose(); } }
  const tk = look?.budget.texture ?? 1;
  if (texCache && texCache.k !== tk) {
    for (const t of [texCache.wood, texCache.wood2, texCache.floor, texCache.wall]) t?.dispose();
    texCache = null;
  }
  if (detailed && !texCache) texCache = { k: tk };
  const std = (o: ConstructorParameters<typeof MeshStandardMaterial>[0]): MeshStandardMaterial => lit(new MeshStandardMaterial(o));
  mats.wall = std({ color: p.wall!, roughness: 0.95, envMapIntensity: 0.3 });
  mats.floor = std({ color: p.floor!, roughness: 0.62, envMapIntensity: 0.45 });
  mats.wood = std({ color: p.wood!, roughness: 0.55, envMapIntensity: 0.5 });
  mats.woodDark = std({ color: p.woodDark!, roughness: 0.65, envMapIntensity: 0.4 });
  mats.counter = detailed && look?.budget.material === "physical"
    ? lit(new MeshPhysicalMaterial({ color: p.counter!, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 0.6 }))
    : std({ color: p.counter!, roughness: 0.55 });
  mats.metal = std({ color: p.metal!, roughness: 0.35, metalness: 0.7, envMapIntensity: 1.0 });
  mats.shade = std({ color: p.metal!, roughness: 0.4, metalness: 0.6, side: DoubleSide, envMapIntensity: 0.9 });
  mats.accentGlow = std({ color: p.accent!, emissive: p.accent!, emissiveIntensity: detailed ? 2.4 : 0.9 });
  mats.canvasArt = std({ color: new Color(p.accent!).lerp(new Color(p.wall!), 0.45), roughness: 0.9, envMapIntensity: 0.2 });
  mats.canvasArt2 = std({ color: new Color(p.light!).lerp(new Color(p.woodDark!), 0.55), roughness: 0.9, envMapIntensity: 0.2 });
  applyEnv(Object.values(mats).filter((m): m is MeshStandardMaterial => !!m));
  applyMaps();
  buildEnv();
  if (curState) buildBoard(curState); // rebuild cells with the new materials
}
const lookOf = (): string => (look ? [look.detailed, look.budget.material, look.budget.texture].join("|") : "");

function disposeTree(g: Object3D): void {
  g.traverse((o) => { if (o instanceof Mesh && !sharedGeos.has(o.geometry)) o.geometry.dispose(); });
}
/** render3d.js buildEnv: floor, wall, lamps, panelling, pictures and the seeded crates. */
function buildEnv(): void {
  while (envGroup.children.length) { const c = envGroup.children[envGroup.children.length - 1]!; envGroup.remove(c); disposeTree(c); }
  const detailed = !!look?.detailed;
  const floor = new Mesh(new PlaneGeometry(40, 30), mats.floor!);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  const wall = new Mesh(new PlaneGeometry(40, 16), mats.wall!);
  wall.position.set(0, 8, -2.2); wall.receiveShadow = true;
  envGroup.add(floor, wall);
  lamps = [];
  if (!detailed) {
    // pendant lamps (instanced bulbs)
    const bulbs = new InstancedMesh(new SphereGeometry(0.12, 10, 8), mats.accentGlow!, 3);
    const m4 = new Matrix4();
    for (let i = 0; i < 3; i++) {
      m4.makeTranslation((i - 1) * 3.2, 7.6, 1.2);
      bulbs.setMatrixAt(i, m4);
      const cord = new Mesh(new CylinderGeometry(0.015, 0.015, 2.4, 4), mats.metal!);
      cord.position.set((i - 1) * 3.2, 8.8, 1.2);
      envGroup.add(cord);
    }
    bulbs.instanceMatrix.needsUpdate = true;
    envGroup.add(bulbs);
  } else {
    // wainscot panelling, chair rail and skirting along the wall
    const wains = new Mesh(new BoxGeometry(40, 1.5, 0.08), mats.woodDark!);
    wains.position.set(0, 0.75, -2.14); wains.receiveShadow = true;
    const rail = new Mesh(new BoxGeometry(40, 0.1, 0.16), mats.wood!);
    rail.position.set(0, 1.53, -2.1); rail.receiveShadow = true;
    envGroup.add(wains, rail);
    const stileGeo = new BoxGeometry(0.08, 1.3, 0.05);
    for (let i = -9; i <= 9; i++) { // raised panel strips
      const stile = new Mesh(stileGeo, mats.wood!);
      stile.position.set(i * 1.6, 0.72, -2.08); stile.receiveShadow = true;
      envGroup.add(stile);
    }
    // pendant lamps: cord, metal shade, glowing bulb; each sways from its hook
    const shadeGeo = new CylinderGeometry(0.12, 0.42, 0.36, 24, 1, true);
    const capGeo = new SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const bulbGeo = new SphereGeometry(0.11, 12, 10);
    const cordGeo = new CylinderGeometry(0.022, 0.022, 2.2, 5);
    for (let i = 0; i < 3; i++) {
      const lamp = new Group();
      lamp.position.set((i - 1) * 3.2, 9.8, 1.2);
      const cord = new Mesh(cordGeo, mats.metal!); cord.position.y = -1.1;
      const cap = new Mesh(capGeo, mats.shade!); cap.position.y = -2.2;
      const shade = new Mesh(shadeGeo, mats.shade!); shade.position.y = -2.34;
      const bulb = new Mesh(bulbGeo, mats.accentGlow!); bulb.position.y = -2.44;
      lamp.add(cord, cap, shade, bulb);
      lamp.userData.phase = i * 1.9;
      lamps.push(lamp);
      envGroup.add(lamp);
    }
    // framed pictures beside the shelf unit (deterministic; not behind the title card)
    const frng = RNG.derive(curState ? curState.seed : 4242, RNG.STREAM_DECOR ^ 0x51);
    for (let i = 0; curState && i < 4; i++) {
      const side = i % 2 ? 1 : -1;
      const fw = 0.9 + frng.next() * 0.6, fh = 0.7 + frng.next() * 0.7;
      const x = side * (boardDims.w / 2 + 1.6 + (i >> 1) * 2.2 + frng.next() * 0.5);
      const y = 3.4 + frng.next() * 2.2;
      const frame = new Mesh(new BoxGeometry(fw, fh, 0.06), mats.wood!);
      frame.position.set(x, y, -2.14); frame.castShadow = frame.receiveShadow = true;
      const art = new Mesh(new PlaneGeometry(fw - 0.16, fh - 0.16), frng.next() > 0.5 ? mats.canvasArt! : mats.canvasArt2!);
      art.position.set(x, y, -2.105);
      envGroup.add(frame, art);
    }
  }
  // seeded decor: crates along the sides
  if (curState) {
    const drng = RNG.derive(curState.seed, RNG.STREAM_DECOR);
    for (let i = 0; i < 4; i++) {
      const w = 0.6 + drng.next() * 0.5;
      const crate = new Mesh(new BoxGeometry(w, w, w), drng.next() > 0.5 ? mats.wood! : mats.woodDark!);
      const side = i % 2 ? 1 : -1;
      crate.position.set(side * (boardDims.w / 2 + 1.4 + drng.next()), w / 2, -1 + drng.next() * 2);
      crate.rotation.y = drng.next() * 0.8;
      crate.castShadow = crate.receiveShadow = true;
      envGroup.add(crate);
    }
  }
}

// ---------- board construction ----------
interface Layout { pos: Map<string, Vector3>; w: number; h: number; cellW: number; rowH: number; baseY: number; counterY: number; counterZ: number; shelves: number; cols: number; counter: number }
function layout(st: State): Layout {
  const { shelves, cols, counter } = st.cfg.board;
  const cellW = 1.06, rowH = 1.5, baseY = 1.55, counterZ = 2.6, counterY = 1.0;
  const w = Math.max(cols, counter) * cellW + 0.5;
  const pos = new Map<string, Vector3>();
  for (let r = 0; r < shelves; r++) for (let c = 0; c < cols; c++) pos.set(`s:${r}:${c}`, new Vector3((c - (cols - 1) / 2) * cellW, baseY + r * rowH, 0));
  for (let i = 0; i < counter; i++) pos.set(`c:${i}`, new Vector3((i - (counter - 1) / 2) * cellW, counterY, counterZ));
  const topY = baseY + (shelves - 1) * rowH + 0.9;
  return { pos, w, h: topY, cellW, rowH, baseY, counterY, counterZ, shelves, cols, counter };
}
const cellTargetY = (key: string, pos: Vector3): number => Math.max(0.7, pos.y + (key.startsWith("c:") ? 0 : -0.7));

/** render3d.js buildBoard: the shelf unit, counter, cell inlays and rings, the items. */
export function buildBoard(state: State): void {
  curState = state;
  for (const c of [...boardGroup.children]) { boardGroup.remove(c); disposeTree(c); }
  for (const g of [...itemGroup.children]) itemGroup.remove(g);
  cellMeshes = new Map(); itemMeshes = new Map();
  tweens.finishAll();
  clearSelection(); clearHint();
  const L = layout(state);
  boardDims = { w: L.w, h: L.h };
  const unitW = L.cols * L.cellW + 0.4;
  const unitH = L.h - L.baseY + 0.9;
  const back = new Mesh(new BoxGeometry(unitW, unitH, 0.1), mats.woodDark!);
  back.position.set(0, L.baseY + unitH / 2 - 0.7, -0.5);
  back.receiveShadow = true;
  boardGroup.add(back);
  const plankGeo = new BoxGeometry(unitW, 0.09, 1.1);
  for (let r = 0; r <= L.shelves; r++) {
    const plank = new Mesh(plankGeo, mats.wood!);
    plank.position.set(0, L.baseY + r * L.rowH - 0.75, 0);
    plank.castShadow = plank.receiveShadow = true;
    boardGroup.add(plank);
  }
  const pillarGeo = new BoxGeometry(0.12, unitH, 1.1);
  for (const sx of [-1, 1]) {
    const pillar = new Mesh(pillarGeo, mats.wood!);
    pillar.position.set(sx * (unitW / 2 - 0.06), L.baseY + unitH / 2 - 0.7, 0);
    pillar.castShadow = true;
    boardGroup.add(pillar);
  }
  const cW = L.counter * L.cellW + 0.5;
  const table = new Mesh(new BoxGeometry(cW, 0.14, 1.2), mats.counter!);
  table.position.set(0, L.counterY - 0.07, L.counterZ);
  table.castShadow = table.receiveShadow = true;
  boardGroup.add(table);
  const leg = new Mesh(new BoxGeometry(cW * 0.9, L.counterY - 0.14, 0.9), mats.woodDark!);
  leg.position.set(0, (L.counterY - 0.14) / 2, L.counterZ);
  leg.receiveShadow = true;
  boardGroup.add(leg);
  // cell inlays (the picking surface) and their marker rings
  const inlayMat = lit(new MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.18, roughness: 1 }));
  applyEnv([inlayMat]);
  for (const [key, p] of L.pos) {
    const isCounter = key.startsWith("c:");
    const inlay = new Mesh(geos.cell, inlayMat);
    inlay.rotation.x = -Math.PI / 2;
    inlay.position.copy(p);
    inlay.position.y += isCounter ? 0.002 : -0.698;
    inlay.userData.loc = key;
    boardGroup.add(inlay);
    const ringMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: DoubleSide, depthWrite: false });
    const ring = new Mesh(geos.marker, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(inlay.position); ring.position.y += 0.005;
    ring.visible = false;
    boardGroup.add(ring);
    // an invisible box over the inlay up to an item's height: an empty cell is tapped by the space above it
    // (render3d.js picked the flat inlay alone, a thin sliver at this camera's angle)
    const proxy = new Mesh(isCounter ? counterProxyGeo : proxyGeo, proxyMat);
    proxy.position.copy(inlay.position); proxy.position.y += isCounter ? 0.15 : 0.4;
    proxy.visible = false;
    proxy.userData.loc = key;
    boardGroup.add(proxy);
    cellMeshes.set(key, { mesh: inlay, ring, ringMat, pos: p.clone(), key, proxy });
  }
  for (let r = 0; r < state.shelves.length; r++)
    for (let c = 0; c < state.shelves[r]!.length; c++) if (state.shelves[r]![c]) placeItem(state.shelves[r]![c]!, { area: "shelf", r, c }, true);
  for (let i = 0; i < state.counter.length; i++) if (state.counter[i]) placeItem(state.counter[i]!, { area: "counter", i }, true);
  buildEnv(); // seeded crates and pictures per level
  fitShadow();
  frameKey = "";
}
/** The title's room: no shelf unit (render3d.js before the first round). */
export function clearBoard(): void {
  curState = null;
  for (const c of [...boardGroup.children]) { boardGroup.remove(c); disposeTree(c); }
  for (const g of [...itemGroup.children]) itemGroup.remove(g);
  cellMeshes = new Map(); itemMeshes = new Map();
  clearSelection(); clearHint();
  boardDims = { w: 5, h: 6 };
  buildEnv();
  frameKey = "";
}

/** render3d.js fitShadow: the key's orthographic shadow box fitted around the play area (shelf unit, counter
 * and the side crates), in light space. */
const _sc = new OrthographicCamera();
const _v = new Vector3();
function fitShadow(): void {
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
  const c = keyLight.shadow.camera as OrthographicCamera;
  c.left = x0; c.right = x1; c.bottom = y0; c.top = y1; c.near = Math.max(0.1, -z1 - 0.5); c.far = -z0 + 0.5;
  c.updateProjectionMatrix();
}

function itemColor(type: string): number {
  const def = Content.ITEMS[type]!;
  return palette === "high-visibility" ? def.colorHC : def.color;
}
function placeItem(type: string, loc: Loc, instant: boolean): void {
  const key = keyOf(loc);
  const cell = cellMeshes.get(key);
  if (!cell) return;
  const g = makeItemMesh(type, itemColor(type));
  g.position.copy(cell.pos);
  g.position.y = cellTargetY(key, cell.pos);
  itemGroup.add(g);
  itemMeshes.set(key, g);
  if (!instant && !reducedMotion) {
    const targetY = g.position.y;
    g.position.y = targetY + 1.6;
    tweens.add({ dur: 0.35, ease: easeOut, tag: `drop:${key}`, onUpdate: (k) => { g.position.y = targetY + 1.6 * (1 - k); } });
  }
}

// ---------- state sync (render3d.js syncState) ----------
export function syncState(state: State, events: GameEvent[], instant: boolean): void {
  curState = state;
  const seen = new Set<string>();
  for (let r = 0; r < state.shelves.length; r++) for (let c = 0; c < state.shelves[r]!.length; c++) if (state.shelves[r]![c]) seen.add(`s:${r}:${c}`);
  for (let i = 0; i < state.counter.length; i++) if (state.counter[i]) seen.add(`c:${i}`);
  // the moved item leaves its cell this sync: it is not a cleared one
  const movedFrom = new Set(events.filter((e) => e.type === "move" && e.from).map((e) => keyOf(e.from!)));
  for (const [key, g] of [...itemMeshes]) {
    if (seen.has(key) || movedFrom.has(key)) continue;
    itemMeshes.delete(key);
    if (instant || reducedMotion) { itemGroup.remove(g); continue; }
    const p = g.position.clone();
    tweens.add({
      dur: 0.28, ease: easeOut, tag: `pop:${key}`,
      onUpdate: (k) => { g.scale.setScalar(1 + k * 0.5); g.position.y = p.y + k * 0.4; },
      onDone: () => itemGroup.remove(g),
    });
  }
  for (const ev of events) {
    if (ev.type === "move" && ev.from && ev.to) {
      const fromKey = keyOf(ev.from), toKey = keyOf(ev.to);
      const g = itemMeshes.get(fromKey);
      const toCell = cellMeshes.get(toKey);
      if (g && toCell) {
        itemMeshes.delete(fromKey);
        tweens.kill(`lift:${fromKey}`); tweens.kill(`drop2:${fromKey}`);
        const target = toCell.pos.clone();
        target.y = cellTargetY(toKey, toCell.pos);
        const cleared = !seen.has(toKey); // it completed a triple: fly there, then pop
        if (!cleared) itemMeshes.set(toKey, g);
        if (instant || reducedMotion) { g.position.copy(target); if (cleared) itemGroup.remove(g); }
        else {
          const start = g.position.clone();
          tweens.add({
            dur: 0.32, ease: easeInOut, tag: `fly:${toKey}`,
            onUpdate: (k) => { g.position.copy(start).lerp(target, k); g.position.y += Math.sin(k * Math.PI) * 0.9; },
            onDone: () => {
              g.position.copy(target);
              if (!cleared) return;
              tweens.add({ dur: 0.28, ease: easeOut, tag: `pop:${toKey}`, onUpdate: (k) => { g.scale.setScalar(1 + k * 0.5); g.position.y = target.y + k * 0.4; }, onDone: () => itemGroup.remove(g) });
            },
          });
        }
      }
    } else if (ev.type === "delivery" && ev.cell != null && ev.item) {
      const loc: Loc = { area: "counter", i: ev.cell };
      if (!itemMeshes.get(keyOf(loc))) placeItem(ev.item, loc, instant);
    } else if (ev.type === "clear" && ev.cells && ev.item) {
      const p = new Vector3();
      let n = 0;
      for (const c of ev.cells) { const cell = cellMeshes.get(`s:${ev.shelf}:${c}`); if (cell) { p.add(cell.pos); n++; } }
      if (n) {
        p.divideScalar(n);
        particles.burst(p, itemColor(ev.item), Math.round((look?.particles === "low" ? 10 : 24) * (look?.budget.burst ?? 1)), 1.6, 1.8);
      }
      if (!reducedMotion) camShake = Math.max(camShake, 0.06);
    } else if (ev.type === "win") {
      particles.burst(new Vector3(0, boardDims.h * 0.6, 0.5), 0xffd070, Math.round((look?.particles === "low" ? 30 : 80) * (look?.budget.burst ?? 1)), 3.2, 2.6);
      if (!reducedMotion) camShake = Math.max(camShake, 0.12);
    } else if (ev.type === "lose") {
      if (!reducedMotion) camShake = Math.max(camShake, 0.15);
    }
  }
  // reconcile: an item in the state without a mesh (after undo)
  for (let r = 0; r < state.shelves.length; r++)
    for (let c = 0; c < state.shelves[r]!.length; c++) {
      const key = `s:${r}:${c}`;
      if (state.shelves[r]![c] && !itemMeshes.has(key)) placeItem(state.shelves[r]![c]!, { area: "shelf", r, c }, true);
    }
  for (let i = 0; i < state.counter.length; i++) {
    const key = `c:${i}`;
    if (state.counter[i] && !itemMeshes.has(key)) placeItem(state.counter[i]!, { area: "counter", i }, true);
  }
  // after an undo every remaining mesh sits where the state says
  if (instant) {
    for (const [key, g] of itemMeshes) {
      const cell = cellMeshes.get(key);
      if (cell) { g.position.copy(cell.pos); g.position.y = cellTargetY(key, cell.pos); g.scale.setScalar(1); }
    }
  }
}

// ---------- selection / hint / ghost ----------
function setRing(cell: CellView, color: number, opacity: number): void {
  cell.ringMat.color.set(color);
  cell.ringMat.opacity = opacity;
  cell.ring.visible = opacity > 0;
}
function clearOutline(): void { if (outline) { selGroup.remove(outline); outline = null; } }
const outlineMat = new MeshBasicMaterial({ color: 0xffc36a, side: BackSide });
function makeOutlineOf(g: Group): void {
  clearOutline();
  const o = g.clone(true);
  o.traverse((m) => { if (m instanceof Mesh) { m.material = outlineMat; m.castShadow = m.receiveShadow = false; } });
  o.scale.setScalar(1.1);
  o.position.copy(g.position);
  selGroup.add(o);
  outline = o;
}
export function setSelection(loc: Loc | null, legalTargets: Loc[]): void {
  clearSelection();
  if (!loc) return;
  const sel = keyOf(loc);
  selection = sel;
  legalTargetKeys = new Set(legalTargets.map(keyOf));
  const g = itemMeshes.get(sel);
  if (g) {
    makeOutlineOf(g);
    if (!reducedMotion) {
      const baseY = g.position.y;
      tweens.add({ dur: 0.18, ease: easeOutBack, tag: `lift:${sel}`, onUpdate: (k) => { g.position.y = baseY + k * 0.22; if (outline) outline.position.y = g.position.y; } });
    }
  }
  for (const tk of legalTargetKeys) { const cell = cellMeshes.get(tk); if (cell) setRing(cell, 0x8fce6e, 0.85); }
  const sc = cellMeshes.get(sel);
  if (sc) setRing(sc, 0xffc36a, 0.9);
}
export function clearSelection(): void {
  if (selection) {
    const sel = selection;
    const g = itemMeshes.get(sel);
    const cell = cellMeshes.get(sel);
    if (g && cell && !tweens.has(`fly:${sel}`)) { // settle the lift
      const ty = cellTargetY(sel, cell.pos);
      tweens.kill(`lift:${sel}`);
      if (reducedMotion) g.position.y = ty;
      else tweens.add({ dur: 0.12, ease: easeOut, tag: `drop2:${sel}`, onUpdate: (k) => { g.position.y += (ty - g.position.y) * k; } });
    }
  }
  selection = null;
  legalTargetKeys = new Set();
  clearOutline();
  hideGhost();
  for (const cell of cellMeshes.values()) setRing(cell, 0xffffff, 0);
}
export function showGhost(loc: Loc, itemType: string | null): void {
  hideGhost();
  const cell = cellMeshes.get(keyOf(loc));
  if (!cell || !itemType) return;
  const gh = makeItemMesh(itemType, itemColor(itemType));
  gh.traverse((m) => {
    if (m instanceof Mesh) {
      const src = m.material as MeshStandardMaterial;
      m.material = new MeshStandardMaterial({ color: src.color, emissive: src.emissive, emissiveIntensity: src.emissiveIntensity, roughness: src.roughness, metalness: src.metalness, transparent: true, opacity: 0.45 });
      m.castShadow = m.receiveShadow = false;
    }
  });
  gh.position.copy(cell.pos);
  gh.position.y = cellTargetY(keyOf(loc), cell.pos);
  selGroup.add(gh);
  ghost = gh;
}
export function hideGhost(): void {
  if (!ghost) return;
  selGroup.remove(ghost);
  ghost.traverse((m) => { if (m instanceof Mesh) (m.material as Material).dispose(); });
  ghost = null;
}
export function setHint(from: Loc, to: Loc): void {
  clearHint();
  for (const loc of [from, to]) {
    const cell = cellMeshes.get(keyOf(loc));
    if (!cell) continue;
    setRing(cell, 0x7fb0ff, 0.95);
    hintCells.push(cell);
  }
}
export function clearHint(): void {
  for (const c of hintCells) setRing(c, 0xffffff, 0);
  hintCells = [];
}

// keyboard / gamepad focus ring
const cursorMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: DoubleSide, depthWrite: false });
const cursorRing = new Mesh(geos.marker, cursorMat);
cursorRing.rotation.x = -Math.PI / 2;
cursorRing.scale.setScalar(1.25);
cursorRing.visible = false;
scene.add(cursorRing);
export function setCursor(loc: Loc | null): void {
  const cell = loc ? cellMeshes.get(keyOf(loc)) : null;
  if (!cell) { cursorRing.visible = false; return; }
  cursorRing.position.copy(cell.mesh.position);
  cursorRing.position.y += 0.008;
  cursorMat.opacity = 0.75;
  cursorRing.visible = true;
}

// ---------- picking ----------
/** The cell under a window point: items first (they sit on cells), then the inlays. */
export function pickLoc(x: number, y: number): { loc: Loc; item: boolean } | null {
  if (!curState) return null;
  pointerToNdc(x, y, ndc);
  raycaster.setFromCamera(ndc, camera);
  const itemHits = raycaster.intersectObjects(itemGroup.children, true);
  for (const h of itemHits) {
    let o: Object3D | null = h.object;
    while (o && !o.userData.itemType) o = o.parent;
    if (!o) continue;
    for (const [key, g] of itemMeshes) {
      if (g !== o) continue;
      // an item still flying to its cell is not picked there (the ray goes on to what is under it)
      const cell = cellMeshes.get(key);
      if (cell && Math.hypot(g.position.x - cell.pos.x, g.position.z - cell.pos.z) < 0.3 && Math.abs(g.position.y - cellTargetY(key, cell.pos)) < 0.5) return { loc: parseKey(key), item: true };
    }
  }
  const cellHits = raycaster.intersectObjects([...cellMeshes.values()].flatMap((c) => [c.mesh, c.proxy]), false);
  if (cellHits.length) return { loc: parseKey(cellHits[0]!.object.userData.loc as string), item: false };
  return null;
}
let win = { w: 1, h: 1 };
/** A cell's box on screen (window px): from the inlay's corners up to the item's height, for its named target. */
export function cellScreenRect(loc: Loc): Rect | null {
  const cell = cellMeshes.get(keyOf(loc));
  if (!cell) return null;
  const base = cell.mesh.position;
  const top = loc.area === "counter" ? 0.28 : 0.75;
  const pts = [[-0.46, 0, -0.4], [0.46, 0, -0.4], [-0.46, 0, 0.4], [0.46, 0, 0.4], [-0.4, top, 0], [0.4, top, 0]].map(([dx, dy, dz]) => {
    const v = new Vector3(base.x + dx!, base.y + dy!, base.z + dz!).project(camera);
    return { x: ((v.x + 1) / 2) * win.w, y: ((1 - v.y) / 2) * win.h };
  });
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  // neighbours touch: shrink a little so the targets don't overlap
  const sx = (x1 - x0) * 0.06, sy = (y1 - y0) * 0.06;
  return { x: x0 + sx, y: y0 + sy, width: x1 - x0 - 2 * sx, height: y1 - y0 - 2 * sy };
}

// ---------- graphics ----------
/** The runtime's quality tier applied live (render3d.js setGraphics). */
export function applyLook(next: Look): void {
  if (look && JSON.stringify(look) === JSON.stringify(next)) return;
  const prevLook = lookOf();
  const hadReflections = look?.reflections;
  look = next;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const sm = next.shadows;
  renderer.shadowMap.enabled = sm > 0;
  keyLight.castShadow = sm > 0;
  if (sm > 0) keyLight.shadow.mapSize = sm;
  keyLight.shadow.radius = sm === 4096 ? 4 : 3;
  // image-based lighting: with the room environment the hemisphere fill steps back
  fillLight.intensity = next.reflections ? 0.55 : 0.9;
  // GTAO radius 0.45, distance exponent 1.4, thickness 1.2, 16 / 8 samples and the denoise per tier; blend 0.75
  const hi = next.ao === "high";
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.75, radius: 0.45, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: hi ? 16 : 8, resolution: next.budget.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: hi ? 6 : 4, rings: 2, samples: hi ? 16 : 8, radiusExponent: 2 },
  };
  // UnrealBloomPass(0.5, 0.5, 0.9): only flames, lantern glass and lamp bulbs bloom (r160 page: the engine's r160 bloom model at the page's strength)
  renderer.bloom = next.bloom ? { model: "r160", strength: 0.5, radius: 0.5, threshold: 0.9, resolution: next.budget.bloomRes } : null;
  renderer.post = next.grade ? GRADE : null;
  renderer.grade = null;
  renderer.antialias = next.antialias;
  dust.setCount(next.budget.dust);
  dust.points.visible = next.particles === "high";
  if (hadReflections !== next.reflections) applyEnv(litMats);
  if (lookOf() !== prevLook) setTheme(themeId, true);
}
export function setPalette(name: "standard" | "high-visibility"): void {
  if (name === palette) return;
  palette = name;
  if (look) setTheme(themeId, true);
}
export function setReducedMotion(v: boolean): void { reducedMotion = v; }
export function setParallax(x: number, y: number): void { parallax.x = x; parallax.y = y; }
export function skipAll(): void { tweens.finishAll(); }
export function isBusy(): boolean { return tweens.busy; }
export function setActive(on: boolean): void { renderer.camera = on ? camera : null; }
/** C / View: re-frame (render3d.js resize). */
export function reframe(): void { frameKey = ""; }

// ---------- framing (render3d.js fitCamera) ----------
let frameKey = "";
let view: Rect = { x: 0, y: 0, width: 1, height: 1 };
let uiScale = 1;
function fitCamera(): void {
  const pad = 8 * uiScale, padTop = Math.min(48 * uiScale, view.height * 0.08);
  const sx = view.x + pad, sy = view.y + padTop, sw = Math.max(1, view.width - pad * 2), sh = Math.max(1, view.height - pad - padTop);
  camera.aspect = sw / sh;
  camera.setViewOffset(sw, sh, -sx, -sy, win.w, win.h);
  camera.updateProjectionMatrix();
  const aspect = camera.aspect;
  const t = Math.tan(((camera.fov / 2) * Math.PI) / 180);
  const vFit = (boardDims.h * 0.8) / t;
  const hFit = (boardDims.w * 0.72) / (t * aspect);
  const dist = Math.max(7.5, vFit, hFit) + 1.2;
  camBase.set(0, 2.2 + boardDims.h * 0.42, dist);
  camTarget.set(0, boardDims.h * 0.5, 0.6);
  camera.position.copy(camBase);
  camera.lookAt(camTarget);
}

/** Each frame: the framing to the uncovered rectangle, tweens, particles, ambient motion, the camera. */
export function update(dt: number, w: number, h: number, rect: Rect, scale: number): void {
  dt = Math.min(0.05, dt);
  const fk = `${w}x${h}:${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}:${scale}`;
  if (w > 0 && h > 0 && rect.width > 0 && rect.height > 0 && fk !== frameKey) {
    frameKey = fk;
    win = { w, h };
    view = { ...rect };
    uiScale = scale;
    fitCamera();
  }
  textureStep();
  tweens.tick(dt);
  particles.tick(dt);
  const glow = glowMats[detailKey()];
  const base = look?.detailed ? 2.2 : 1.6;
  if (look?.animated && !reducedMotion) {
    clock += dt;
    if (glow) glow.emissiveIntensity = base * (1 + 0.1 * Math.sin(clock * 9.1) + 0.06 * Math.sin(clock * 23.7 + 1.3));
    for (const l of lamps) l.rotation.z = Math.sin(clock * 0.6 + (l.userData.phase as number)) * 0.012;
    lampLight.intensity = LAMP * (1 + 0.03 * Math.sin(clock * 5.3));
    dust.tick(clock);
  } else if (glow) glow.emissiveIntensity = base;
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
}
