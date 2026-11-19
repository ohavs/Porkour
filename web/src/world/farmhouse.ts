import * as THREE from 'three';
import { RAPIER, world, groups, L, staticBox } from '../core/physics';
import { G } from '../game/ctx';
import { toonMat } from '../render/toon';
import { PROPS, type Prop } from './props';
import type { DayNight, Lamp } from './daynight';
import type { Pig } from '../pig/pig';

/**
 * Bob's farmhouse you can walk into (s26, user: the farmhouses were closed models — "build real walk-in farmhouses").
 * Built from code on every farm (same layout, a look per farm: butter-yellow clapboard, a cream orchard cottage, a
 * blue dairy house, a dusky pumpkin-night house, a red log cabin under snow): a stone foundation, lap siding / logs,
 * corner boards, shuttered windows with flower boxes (open: a pig can jump in or out), a front stoop with a little
 * porch roof and double doors standing open, a shingled gable roof + a stone chimney. Inside: a living room with the
 * fireplace (its smoke comes out of the chimney), an open kitchen, Bob's bedroom (he sleeps in his king bed at night —
 * pigs can sneak in: his piggy bank is on the nightstand) and a bathroom. Wallpaper with wainscot per room, plank /
 * tiled floors, pendant lamps: the windows glow at night while Bob is up and go dark once he's asleep.
 * The roof + ceiling hide while my pig is inside (the camera looks in from above; its colliders stop pulling the
 * camera in). Interiors.ts furnishes it from `layout` (fixed spots, not the random barn fill).
 * Local frame: +z = the front (door), x across, y = 0 on the floor; `yaw` turns it on the farm.
 */
export const HOUSE = {
  /** Wall height (the ceiling), outer / inner wall thickness, floor height over the ground. */
  H: 2.9, T: 0.2, IT: 0.16, floor: 0.2,
  /** Door / inner doorways: width (Bob's nav needs ≥ 1.8), height. */
  door: 1.8, doorH: 2.35,
  /** Roof: ridge rise over the walls, eave overhang (front / back), rake overhang (gable ends), slab thickness. */
  rise: 2.5, over: 0.55, overSide: 0.4, slab: 0.18,
  /** The stoop's shed roof: height at the wall / over the posts, depth. */
  porch: { y0: 2.6, y1: 2.3, len: 1.75 },
  /** The partition between the front rooms and the back rooms (local z), and between bedroom and bathroom (local x). */
  backZ: -0.6, bathX: 1.0,
};
/** Bob in his bed: how high he lies over the bed's bottom, his feet in from its foot end; mud reach to his face (m). */
/** (+ his weight in the bed while he sleeps: a pig brushing past doesn't move it, a ram does) */
export const BED = { lieY: 0.62, foot: 0.32, faceR: 2.0, marks: 3, bobKg: 140 };
/** Bob lying on his back in the bed (his up → the bed's −z = the headboard, his front → up). */
const LIE = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)));
const v1 = new THREE.Vector3();
interface BobLike { state: string; inBed: boolean; mudMarks: number; mudFace(p: Pig): void }
export type HouseStyleId = 'classic' | 'orchard' | 'dairy' | 'spooky' | 'winter';
interface Style {
  wall: number; trim: number; roof: number; shutter: number; door: number; stone: number; glow: number;
  logs?: boolean; snow?: boolean; flowers: number[];
}
const STYLES: Record<HouseStyleId, Style> = {
  classic: { wall: 0xf2d98f, trim: 0xfff6e6, roof: 0xc4473a, shutter: 0x4f9a5c, door: 0xc4473a, stone: 0xa49c92, glow: 0xffc46e, flowers: [0xff5d8f, 0xffd23f, 0xffffff] },
  orchard: { wall: 0xf7eedc, trim: 0x8a5a35, roof: 0xc8683e, shutter: 0x6f9a3a, door: 0x6f9a3a, stone: 0xb0a48e, glow: 0xffc46e, flowers: [0xff7a59, 0xffe066, 0xc77dff] },
  dairy: { wall: 0xa9d0ea, trim: 0xffffff, roof: 0x55606f, shutter: 0x2f5f94, door: 0xd8402e, stone: 0xbab3a6, glow: 0xffc46e, flowers: [0xffffff, 0xffd23f, 0xff6f91] },
  spooky: { wall: 0x6a6280, trim: 0x2c2836, roof: 0x3b3445, shutter: 0x1f1b27, door: 0x7a2f2a, stone: 0x6f6a66, glow: 0xff9838, flowers: [0xff8a1f, 0x8a2be2, 0xffd23f] },
  winter: { wall: 0xa45a32, trim: 0xf6f3ea, roof: 0x7d3a2e, shutter: 0x2f6b4a, door: 0x2f6b4a, stone: 0x908b86, glow: 0xffc46e, logs: true, snow: true, flowers: [0xd8342c, 0x2f9a5a, 0xffffff] },
};

// ================================================================== canvas textures (cartoon, drawn once per page)
const hex = (c: number, k = 1) => '#' + new THREE.Color(c).multiplyScalar(k).getHexString();
function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
/** A seeded random (the textures look the same on every machine). */
const rnd = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
/** Lap siding, 1 × 1 m: 5 boards, each lit from above with a shadow line under its lap. */
const sidingTex = (c0: number) => canvasTex(128, 256, (c, w, h) => {
  const r = rnd(7), n = 5, bh = h / n;
  for (let i = 0; i < n; i++) {
    const y = i * bh, g = c.createLinearGradient(0, y, 0, y + bh);
    g.addColorStop(0, hex(c0, 1.06)); g.addColorStop(0.8, hex(c0, 0.97)); g.addColorStop(1, hex(c0, 0.86));
    c.fillStyle = g; c.fillRect(0, y, w, bh);
    c.fillStyle = hex(c0, 0.62); c.fillRect(0, y + bh - 5, w, 5);
    c.fillStyle = hex(c0, 0.92);
    for (let k = 0; k < 3; k++) c.fillRect(0, y + 6 + r() * (bh - 16), w, 1);
  }
});
/** Log wall, 1 × 1.2 m: 4 round logs, light chinking between. */
const logTex = (c0: number) => canvasTex(128, 256, (c, w, h) => {
  const r = rnd(11), n = 4, bh = h / n;
  c.fillStyle = '#e8dcc0'; c.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const y = i * bh + 3, g = c.createLinearGradient(0, y, 0, y + bh - 6);
    g.addColorStop(0, hex(c0, 0.72)); g.addColorStop(0.35, hex(c0, 1.12)); g.addColorStop(0.75, hex(c0, 0.95)); g.addColorStop(1, hex(c0, 0.6));
    c.fillStyle = g; c.fillRect(0, y, w, bh - 6);
    c.strokeStyle = hex(c0, 0.75); c.lineWidth = 1;
    for (let k = 0; k < 4; k++) { const yy = y + 8 + r() * (bh - 22); c.beginPath(); c.moveTo(0, yy); c.bezierCurveTo(w * 0.3, yy + 2, w * 0.6, yy - 2, w, yy); c.stroke(); }
  }
});
/** Shingles, 1 × 1 m (v = up the slope): 4 rows of rounded tabs, each a little different. */
const shingleTex = (c0: number) => canvasTex(256, 256, (c, w, h) => {
  const r = rnd(5), rows = 4, rh = h / rows, tabs = 6, tw = w / tabs;
  c.fillStyle = hex(c0, 0.55); c.fillRect(0, 0, w, h);
  // canvas top = the upper end of the tile (v = 1): draw the upper rows first, the lower ones overlap them
  for (let i = 0; i < rows; i++) {
    const y = i * rh, off = (i % 2) * tw / 2;
    for (let k = -1; k <= tabs; k++) {
      const x = k * tw + off;
      c.fillStyle = hex(c0, 0.88 + r() * 0.22);
      c.beginPath(); c.moveTo(x + 1, y - 4); c.lineTo(x + tw - 1, y - 4); c.lineTo(x + tw - 1, y + rh - tw * 0.35);
      c.quadraticCurveTo(x + tw - 1, y + rh + 2, x + tw / 2, y + rh + 2); c.quadraticCurveTo(x + 1, y + rh + 2, x + 1, y + rh - tw * 0.35); c.closePath(); c.fill();
      c.strokeStyle = hex(c0, 0.5); c.lineWidth = 2; c.stroke();
      c.fillStyle = hex(c0, 1.15); c.fillRect(x + 5, y + 2, tw - 10, 3);
    }
  }
});
/** Floor planks, 2 × 2 m: 0.2 m planks along u, joints here and there. */
const plankTex = (c0: number) => canvasTex(256, 256, (c, w, h) => {
  const r = rnd(3), n = 10, ph = h / n;
  for (let i = 0; i < n; i++) {
    let x = -r() * 120;
    while (x < w) {
      const len = 70 + r() * 110;
      c.fillStyle = hex(c0, 0.86 + r() * 0.24); c.fillRect(x, i * ph, len, ph);
      c.fillStyle = hex(c0, 0.6); c.fillRect(x, i * ph, 2, ph);
      c.fillStyle = hex(c0, 0.8);
      for (let k = 0; k < 2; k++) c.fillRect(x + 6, i * ph + 4 + r() * (ph - 8), len - 12, 1);
      x += len;
    }
    c.fillStyle = hex(c0, 0.55); c.fillRect(0, i * ph + ph - 2, w, 2);
  }
});
/** Checker tiles, 0.6 × 0.6 m (2 × 2 tiles) with grout. */
const checkerTex = (a: number, b: number) => canvasTex(128, 128, (c, w, h) => {
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { c.fillStyle = hex((i + j) % 2 ? a : b); c.fillRect(i * w / 2, j * h / 2, w / 2, h / 2); }
  c.strokeStyle = 'rgba(70,60,50,0.45)'; c.lineWidth = 2; c.strokeRect(1, 1, w / 2 - 2, h / 2 - 2); c.strokeRect(w / 2 + 1, 1, w / 2 - 2, h / 2 - 2);
  c.strokeRect(1, h / 2 + 1, w / 2 - 2, h / 2 - 2); c.strokeRect(w / 2 + 1, h / 2 + 1, w / 2 - 2, h / 2 - 2);
});
/** Rough stones in mortar, 1 × 1 m. */
const stoneTex = (c0: number) => canvasTex(256, 256, (c, w, h) => {
  const r = rnd(9);
  c.fillStyle = hex(c0, 0.55); c.fillRect(0, 0, w, h);
  const rows = 6, rh = h / rows;
  for (let i = 0; i < rows; i++) {
    let x = -r() * 30;
    while (x < w + 30) {
      const sw = 34 + r() * 40;
      c.fillStyle = hex(c0, 0.82 + r() * 0.35);
      c.beginPath(); c.ellipse(x + sw / 2, i * rh + rh / 2, sw / 2 - 2.5, rh / 2 - 2.5, (r() - 0.5) * 0.2, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.18)'; c.beginPath(); c.ellipse(x + sw / 2 - 4, i * rh + rh / 2 - 5, sw / 4, rh / 6, 0, 0, Math.PI * 2); c.fill();
      // wrap the edges so the tile repeats without a seam
      x += sw;
    }
  }
});
/** Wallpaper (1 m wide × the wall height): a pattern up top, a chair rail, painted wainscot below, a baseboard. */
type Paper = { top: number; ink: number; low: number; pattern: 'stripes' | 'dots' | 'flowers' | 'tiles' | 'plain' };
const paperTex = (p: Paper) => canvasTex(128, 512, (c, w, h) => {
  const H = HOUSE.H, my = (y: number) => h - (y / H) * h;   // metres above the floor → canvas y
  c.fillStyle = hex(p.top); c.fillRect(0, 0, w, h);
  const rail = p.pattern === 'tiles' ? 1.3 : 0.95;
  if (p.pattern === 'stripes') { c.fillStyle = hex(p.ink); for (let x = 0; x < w; x += 32) c.fillRect(x, 0, 12, my(rail)); c.fillStyle = hex(p.top, 0.94); for (let x = 20; x < w; x += 32) c.fillRect(x, 0, 3, my(rail)); }
  if (p.pattern === 'dots') { c.fillStyle = hex(p.ink); for (let y = 10; y < my(rail); y += 28) for (let x = (y / 28) % 2 ? 8 : 24; x < w; x += 32) { c.beginPath(); c.arc(x, y, 4, 0, 7); c.fill(); } }
  if (p.pattern === 'flowers') {
    for (let y = 16; y < my(rail) - 6; y += 40) for (let x = (y / 40) % 2 ? 16 : 48; x < w; x += 64) {
      c.fillStyle = hex(p.ink); for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; c.beginPath(); c.arc(x + Math.cos(a) * 5, y + Math.sin(a) * 5, 4, 0, 7); c.fill(); }
      c.fillStyle = '#ffd84a'; c.beginPath(); c.arc(x, y, 3, 0, 7); c.fill();
      c.fillStyle = hex(0x6fa85a); c.fillRect(x - 1, y + 9, 2, 8);
    }
  }
  if (p.pattern === 'tiles') {   // bathroom / kitchen: square tiles up to the rail
    c.fillStyle = hex(p.low); c.fillRect(0, my(rail), w, h - my(rail));
    c.strokeStyle = hex(p.low, 0.78); c.lineWidth = 2;
    const ts = (0.16 / H) * h;
    for (let y = h; y > my(rail); y -= ts) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    for (let x = 0; x <= w; x += w / 6) { c.beginPath(); c.moveTo(x, my(rail)); c.lineTo(x, h); c.stroke(); }
  } else {   // painted wainscot: vertical boards
    c.fillStyle = hex(p.low); c.fillRect(0, my(rail), w, h - my(rail));
    c.fillStyle = hex(p.low, 0.78); for (let x = 0; x < w; x += 21) c.fillRect(x, my(rail), 2, h - my(rail));
    c.fillStyle = hex(p.low, 0.62); c.fillRect(0, my(0.12), w, my(0) - my(0.12));   // baseboard
  }
  c.fillStyle = hex(p.low, 0.7); c.fillRect(0, my(rail) - 7, w, 7);                  // chair rail
  c.fillStyle = hex(p.low, 1.12); c.fillRect(0, my(rail) - 7, w, 2);
  c.fillStyle = hex(p.top, 0.85); c.fillRect(0, 0, w, 6);                             // crown shadow
});
/** Shutter louvers (one panel). */
const louverTex = (c0: number) => canvasTex(64, 128, (c, w, h) => {
  c.fillStyle = hex(c0); c.fillRect(0, 0, w, h);
  for (let y = 12; y < h - 10; y += 8) { c.fillStyle = hex(c0, 0.62); c.fillRect(8, y, w - 16, 3); c.fillStyle = hex(c0, 1.2); c.fillRect(8, y + 3, w - 16, 1); }
  c.strokeStyle = hex(c0, 0.55); c.lineWidth = 4; c.strokeRect(4, 4, w - 8, h - 8);
});

// ================================================================== geometry: quads / boxes merged per material
const tA = new THREE.Vector3(), tB = new THREE.Vector3(), tN = new THREE.Vector3();
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** Tile size of a textured material (m per texture repeat), for world-scaled UVs. */
const tiled = (m: THREE.Material, s: number, sv = s) => { m.userData.s = s; m.userData.sv = sv; return m; };
class Mesher {
  private by = new Map<THREE.Material, { p: number[]; n: number[]; uv: number[] }>();
  private buf(m: THREE.Material) { let b = this.by.get(m); if (!b) this.by.set(m, b = { p: [], n: [], uv: [] }); return b; }
  /** A flat quad, turned so its normal points along `want`; UVs world-scaled by the material's tile size (or given). */
  quad(m: THREE.Material, want: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, uv?: number[]) {
    tN.subVectors(b, a).cross(tA.subVectors(c, a));
    if (tN.dot(want) < 0) { [b, d] = [d, b]; if (uv) uv = [uv[0], uv[1], uv[6], uv[7], uv[4], uv[5], uv[2], uv[3]]; }
    tN.copy(want).normalize();
    const B = this.buf(m), s = m.userData.s ?? 1, sv = m.userData.sv ?? s, P = [a, b, c, d];
    const U: number[] = uv ?? [];
    if (!uv) for (const p of P) {
      if (Math.abs(tN.y) > 0.7) U.push(p.x / s, p.z / sv);
      else { const tx = tN.z, tz = -tN.x, l = Math.hypot(tx, tz) || 1; U.push((p.x * tx + p.z * tz) / l / s, p.y / sv); }
    }
    for (const k of [0, 1, 2, 0, 2, 3]) { const p = P[k]; B.p.push(p.x, p.y, p.z); B.n.push(tN.x, tN.y, tN.z); B.uv.push(U[k * 2], U[k * 2 + 1]); }
  }
  tri(m: THREE.Material, want: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
    tN.subVectors(b, a).cross(tA.subVectors(c, a));
    if (tN.dot(want) < 0) [b, c] = [c, b];
    tN.copy(want).normalize();
    const B = this.buf(m), s = m.userData.s ?? 1, sv = m.userData.sv ?? s, tx = tN.z, tz = -tN.x, l = Math.hypot(tx, tz) || 1;
    for (const p of [a, b, c]) { B.p.push(p.x, p.y, p.z); B.n.push(tN.x, tN.y, tN.z); B.uv.push((p.x * tx + p.z * tz) / l / s, p.y / sv); }
  }
  /** Axis-aligned box; `mats` per face (px nx py ny pz nz), a face set to null is skipped. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: THREE.Material | Partial<Record<'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz', THREE.Material | null>>) {
    const f = (k: 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz') => ((m as THREE.Material).isMaterial ? m as THREE.Material : (m as Record<string, THREE.Material | null>)[k] ?? null);
    let q: THREE.Material | null;
    if ((q = f('px'))) this.quad(q, V(1, 0, 0), V(x1, y0, z1), V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1));
    if ((q = f('nx'))) this.quad(q, V(-1, 0, 0), V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0));
    if ((q = f('py'))) this.quad(q, V(0, 1, 0), V(x0, y1, z1), V(x1, y1, z1), V(x1, y1, z0), V(x0, y1, z0));
    if ((q = f('ny'))) this.quad(q, V(0, -1, 0), V(x0, y0, z0), V(x1, y0, z0), V(x1, y0, z1), V(x0, y0, z1));
    if ((q = f('pz'))) this.quad(q, V(0, 0, 1), V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1));
    if ((q = f('nz'))) this.quad(q, V(0, 0, -1), V(x1, y0, z0), V(x0, y0, z0), V(x0, y1, z0), V(x1, y1, z0));
  }
  /** Any geometry (spheres, cylinders, a turned box…) placed by a matrix. */
  geo(m: THREE.Material, g: THREE.BufferGeometry, mat: THREE.Matrix4) {
    const gg = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(mat);
    const B = this.buf(m), p = gg.attributes.position, n = gg.attributes.normal, uv = gg.attributes.uv;
    for (let i = 0; i < p.count; i++) { B.p.push(p.getX(i), p.getY(i), p.getZ(i)); B.n.push(n.getX(i), n.getY(i), n.getZ(i)); B.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0); }
    gg.dispose();
  }
  build(into: THREE.Object3D, shadow = true) {
    for (const [m, b] of this.by) {
      if (!b.p.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, m); mesh.castShadow = shadow; mesh.receiveShadow = true;
      into.add(mesh);
    }
    this.by.clear();
  }
}
const M4 = new THREE.Matrix4(), Q4 = new THREE.Quaternion(), S4 = new THREE.Vector3(), P4 = new THREE.Vector3();
const place = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  M4.compose(P4.set(x, y, z), Q4.setFromEuler(new THREE.Euler(rx, ry, rz)), S4.set(sx, sy, sz));

// ================================================================== the piggy bank (loot on Bob's nightstand)
function makePiggyBank() {
  const g = new THREE.Group(), pink = toonMat(0xff9ec4), dark = toonMat(0x7a2f4a), gold = toonMat(0xffd34a);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) => {
    const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.rotation.set(rx, 0, rz); o.castShadow = true; g.add(o); return o;
  };
  const ball = new THREE.SphereGeometry(1, 16, 12);
  add(ball, pink, 0, 0.16, 0, 0.13, 0.12, 0.17);                                           // belly
  add(new THREE.CylinderGeometry(0.05, 0.055, 0.05, 14), pink, 0, 0.17, 0.17, 1, 1, 1, Math.PI / 2);   // snout
  for (const x of [-0.018, 0.018]) add(ball, dark, x, 0.175, 0.197, 0.009, 0.013, 0.006);   // nostrils
  for (const x of [-0.06, 0.06]) { add(new THREE.ConeGeometry(0.035, 0.06, 8), pink, x, 0.27, 0.08, 1, 1, 0.6, -0.3, x > 0 ? -0.4 : 0.4); add(ball, dark, x * 0.75, 0.21, 0.135, 0.012, 0.016, 0.01); }
  for (const [x, z] of [[-0.07, 0.09], [0.07, 0.09], [-0.07, -0.09], [0.07, -0.09]]) add(new THREE.CylinderGeometry(0.025, 0.028, 0.07, 10), pink, x, 0.035, z);
  add(new THREE.BoxGeometry(0.06, 0.012, 0.012), dark, 0, 0.278, -0.01);                     // the coin slot
  add(new THREE.CylinderGeometry(0.022, 0.022, 0.006, 14), gold, 0.0, 0.29, -0.01, 1, 1, 1, Math.PI / 2, 0);   // a coin stuck in it
  const tail = add(new THREE.TorusGeometry(0.025, 0.007, 6, 14, Math.PI * 1.5), pink, 0, 0.18, -0.175); tail.rotation.y = Math.PI / 2;
  return g;
}
PROPS.piggyBank = { make: makePiggyBank, mass: 2, sound: 'metal', label: 'item.piggyBank', value: 90, id: 'piggyBank', bounce: 0.2 };

// ================================================================== the house
/** A furniture spot for interiors.ts (local frame). `wall` = (x, z) is on the wall's face: the piece stands out by half its depth. */
export type HouseItem =
  | { id: string; x: number; z: number; yaw: number; wall?: boolean; tag?: string }
  | { row: string[]; x: number; z: number; yaw: number; dir: [number, number] }
  | { rug: string; x: number; z: number; yaw: number; width: number }
  | { table: string; x: number; z: number; yaw: number; chairs: string[] }
  | { top: string; id?: string; prop?: string; dx?: number };
interface Hole { c: number; w: number; y0: number; y1: number; kind: 'door' | 'window' | 'inner' }
interface Room { id: 'living' | 'kitchen' | 'bed' | 'bath'; x0: number; x1: number; z0: number; z1: number }

export interface FarmhouseOpts { x: number; z: number; yaw: number; w?: number; d?: number; style: HouseStyleId; y?: number }

export class Farmhouse {
  kind = 'farmhouse' as const;
  root = new THREE.Group();
  /** Hidden while my pig is inside (roof slabs, gables, the ceiling, the snow on it). */
  roofG = new THREE.Group();
  readonly x: number; readonly z: number; readonly yaw: number; readonly w: number; readonly d: number;
  /** World height of the floor. */
  readonly y0: number;
  readonly style: Style;
  private q: THREE.Quaternion; private cos: number; private sin: number;
  rooms: Room[];
  /** Furniture spots (local), resolved by interiors.ts. */
  layout: HouseItem[] = [];
  /** Bob's bed (set by interiors.ts once it's placed) — he sleeps in it at night. */
  bed: Prop | null = null;
  /** The kitchen (set by interiors.ts): stove, fridge, table + its chairs — his lunch (world/lunch.ts). */
  oven: Prop | null = null; fridge: Prop | null = null; table: Prop | null = null; chairs: Prop[] = [];
  /** Outside the front door (Bob's door zone), just inside it. */
  door: THREE.Vector3; doorIn: THREE.Vector3;
  /** Where the smoke leaves the chimney (world). */
  chimneyTop: THREE.Vector3;
  /** The roof's colliders: the camera may pass through them while my pig is inside. */
  private roofHandles: number[] = [];
  private lamps: Lamp[] = [];
  private bulbs: THREE.MeshBasicMaterial[] = [];
  private glowMat: THREE.MeshBasicMaterial;
  /** 0..1: Bob's lights are on (evening, he's up). */
  private lit = 0;
  private skipOn = false;

  constructor(scene: THREE.Scene, o: FarmhouseOpts, ground: (x: number, z: number) => number, daynight: DayNight | null) {
    this.x = o.x; this.z = o.z; this.yaw = o.yaw; this.w = o.w ?? 11; this.d = o.d ?? 9;
    this.style = STYLES[o.style];
    this.cos = Math.cos(o.yaw); this.sin = Math.sin(o.yaw);
    this.q = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, o.yaw);
    // the floor sits a step above the highest ground under the footprint (the farm flattens a pad for it first)
    let top = -Infinity;
    for (let a = -1; a <= 1; a += 0.25) for (let b = -1; b <= 1; b += 0.25) { const p = this.toWorld(a * this.w / 2, b * this.d / 2, tB); top = Math.max(top, ground(p.x, p.z)); }
    this.y0 = o.y ?? top + HOUSE.floor;
    this.root.position.set(o.x, this.y0, o.z); this.root.quaternion.copy(this.q);
    this.root.add(this.roofG);
    scene.add(this.root);
    const W = this.w, D = this.d, bz = HOUSE.backZ, bx = HOUSE.bathX;
    this.rooms = [
      { id: 'living', x0: -W / 2, x1: 0.6, z0: bz, z1: D / 2 }, { id: 'kitchen', x0: 0.6, x1: W / 2, z0: bz, z1: D / 2 },
      { id: 'bed', x0: -W / 2, x1: bx, z0: -D / 2, z1: bz }, { id: 'bath', x0: bx, x1: W / 2, z0: -D / 2, z1: bz },
    ];
    this.door = this.toWorld(0, D / 2 + 2.3, new THREE.Vector3()); this.door.y = ground(this.door.x, this.door.z);
    this.doorIn = this.toWorld(0, D / 2 - 1.2, new THREE.Vector3()); this.doorIn.y = this.y0;
    const chim = this.chimneyLocal();
    this.chimneyTop = this.toWorld(chim.x, chim.z, new THREE.Vector3()); this.chimneyTop.y = this.y0 + chim.y;
    this.glowMat = new THREE.MeshBasicMaterial({ color: this.style.glow, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.build();
    this.colliders();
    this.makeLayout();
    // Bob's pendant lamps: real lights from the lamp pool at night while he's up
    if (daynight) for (const [lx, lz] of [[-2.6, 2.0], [3.0, 2.0], [-2.3, -2.4]]) this.lamps.push(daynight.addLight(this.toWorld(lx, lz, new THREE.Vector3()).setY(this.y0 + 2.2), 5, 8, 0xffc27a));
    G.uses.push({ near: (p: Pig) => this.faceNear(p), icon: () => 'mud' });
  }

  /** Local (x, z) → world (x, z) (y left as is). */
  toWorld(lx: number, lz: number, out: THREE.Vector3) { return out.set(this.x + lx * this.cos + lz * this.sin, out.y, this.z - lx * this.sin + lz * this.cos); }
  toLocal(x: number, z: number) { const dx = x - this.x, dz = z - this.z; return [dx * this.cos - dz * this.sin, dx * this.sin + dz * this.cos]; }
  /** Inside the walls (and not on the roof). */
  inside(p: THREE.Vector3, pad = 0) {
    const [lx, lz] = this.toLocal(p.x, p.z);
    return Math.abs(lx) < this.w / 2 - pad && Math.abs(lz) < this.d / 2 - pad && p.y < this.y0 + HOUSE.H + 0.3 && p.y > this.y0 - 1;
  }
  roomAt(p: THREE.Vector3) { if (!this.inside(p)) return null; const [lx, lz] = this.toLocal(p.x, p.z); return this.rooms.find((r) => lx >= r.x0 && lx <= r.x1 && lz >= r.z0 && lz <= r.z1)?.id ?? null; }
  private chimneyLocal() {
    const H = HOUSE.H, zc = 1.9, roofAt = H + HOUSE.rise * (1 - Math.abs(zc) / (this.d / 2));
    return { x: -this.w / 2 - 0.38, z: zc, y: roofAt + 1.0, zc };
  }

  // ---------------------------------------------------------------- the look
  private build() {
    const S = this.style, W = this.w, D = this.d, H = HOUSE.H, T = HOUSE.T, IT = HOUSE.IT, bz = HOUSE.backZ, bx = HOUSE.bathX;
    const M = new Mesher(), R = new Mesher();
    // materials
    const outside = tiled(toonMat(0xffffff, { map: S.logs ? logTex(S.wall) : sidingTex(S.wall) }), 1, S.logs ? 1.2 : 1);
    const trim = toonMat(S.trim), trimIn = toonMat(0xf4ead8), wallTop = toonMat(0x6b4a2e), dark = toonMat(0x2b211b);
    const stone = tiled(toonMat(0xffffff, { map: stoneTex(S.stone) }), 0.9);
    const roof = tiled(toonMat(0xffffff, { map: shingleTex(S.roof) }), 1);
    const roofEdge = toonMat(new THREE.Color(S.roof).multiplyScalar(0.7)), soffit = toonMat(0xd9c3a0);
    const deck = tiled(toonMat(0xffffff, { map: plankTex(0xa8774a) }), 2);
    const ceiling = toonMat(0xf3ead9);
    const shutter = tiled(toonMat(0xffffff, { map: louverTex(S.shutter) }), 1);
    const doorM = toonMat(S.door), brass = toonMat(0xe0b040), box = toonMat(0x8a5a35), soil = toonMat(0x5a3b22);
    const papers: Record<Room['id'], THREE.Material> = {
      living: tiled(toonMat(0xffffff, { map: paperTex({ top: 0xf3d9a6, ink: 0xe8c07e, low: 0x7d5a3c, pattern: 'stripes' }) }), 1, H),
      kitchen: tiled(toonMat(0xffffff, { map: paperTex({ top: 0xfff4dc, ink: 0x8fc3e6, low: 0xe9f2f5, pattern: 'tiles' }) }), 1, H),
      bed: tiled(toonMat(0xffffff, { map: paperTex({ top: 0xf7dfe6, ink: 0xe98aa8, low: 0xb88fb0, pattern: 'flowers' }) }), 1, H),
      bath: tiled(toonMat(0xffffff, { map: paperTex({ top: 0xcfeee0, ink: 0x9ad3bb, low: 0xf8f8f4, pattern: 'tiles' }) }), 1, H),
    };
    const floors: Record<Room['id'], THREE.Material> = {
      living: tiled(toonMat(0xffffff, { map: plankTex(0xb07a4c) }), 2), kitchen: tiled(toonMat(0xffffff, { map: checkerTex(0xf4efe6, 0x5f8fb8) }), 0.6),
      bed: tiled(toonMat(0xffffff, { map: plankTex(0x9a6a42) }), 2), bath: tiled(toonMat(0xffffff, { map: checkerTex(0xffffff, 0x8fcfb5) }), 0.6),
    };
    const roomMat = (x: number, z: number) => papers[(this.rooms.find((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) ?? this.rooms[0]).id];

    // ---- the walls (outer: siding outside, the room's wallpaper inside; inner: wallpaper both sides)
    const win = (c: number, w = 1.2, y0 = 0.9, y1 = 2.1): Hole => ({ c, w, y0, y1, kind: 'window' });
    const front: Hole[] = [{ c: 0, w: HOUSE.door, y0: 0, y1: HOUSE.doorH, kind: 'door' }, win(-3.3), win(3.3)];
    const back: Hole[] = [win(4.0, 0.8, 1.45, 2.1), win(-4.45, 0.9, 1.0, 2.1)];
    const left: Hole[] = [win(-2.5, 1.0, 1.0, 2.1)];
    const right: Hole[] = [win(2.2, 1.2, 1.15, 2.15)];
    const inner = (c: number): Hole => ({ c, w: HOUSE.door, y0: 0, y1: 2.3, kind: 'inner' });
    type WallDef = { axis: 'x' | 'z'; at: number; from: number; to: number; t: number; holes: Hole[]; pos: (s: number) => THREE.Material; neg: (s: number) => THREE.Material; outer: boolean };
    const walls: WallDef[] = [
      { axis: 'x', at: D / 2 - T / 2, from: -W / 2, to: W / 2, t: T, holes: front, pos: () => outside, neg: (s) => roomMat(s, D / 2 - 0.5), outer: true },
      { axis: 'x', at: -D / 2 + T / 2, from: -W / 2, to: W / 2, t: T, holes: back, pos: (s) => roomMat(s, -D / 2 + 0.5), neg: () => outside, outer: true },
      { axis: 'z', at: -W / 2 + T / 2, from: -D / 2 + T, to: D / 2 - T, t: T, holes: left, pos: (s) => roomMat(-W / 2 + 0.5, s), neg: () => outside, outer: true },
      { axis: 'z', at: W / 2 - T / 2, from: -D / 2 + T, to: D / 2 - T, t: T, holes: right, pos: () => outside, neg: (s) => roomMat(W / 2 - 0.5, s), outer: true },
      // front rooms | back rooms (doorways into the bedroom and the bathroom)
      { axis: 'x', at: bz, from: -W / 2 + T, to: W / 2 - T, t: IT, holes: [inner(-2.2), inner(3.25)], pos: (s) => roomMat(s, bz + 0.5), neg: (s) => roomMat(s, bz - 0.5), outer: false },
      // bedroom | bathroom
      { axis: 'z', at: bx, from: -D / 2 + T, to: bz - IT / 2, t: IT, holes: [], pos: () => papers.bath, neg: () => papers.bed, outer: false },
    ];
    this.wallBoxes = [];
    for (const wd of walls) {
      // break points: hole edges + where the room (wallpaper) changes along the wall
      const cuts = new Set<number>([wd.from, wd.to]);
      for (const h of wd.holes) { cuts.add(h.c - h.w / 2); cuts.add(h.c + h.w / 2); }
      let prevP = wd.pos(wd.from), prevN = wd.neg(wd.from);
      for (let s = wd.from; s < wd.to; s += 0.05) { const p = wd.pos(s), n = wd.neg(s); if (p !== prevP || n !== prevN) { cuts.add(Math.round(s * 20) / 20); prevP = p; prevN = n; } }
      const cs = [...cuts].sort((a, b) => a - b);
      for (let i = 0; i < cs.length - 1; i++) {
        const a = cs[i], b = cs[i + 1]; if (b - a < 0.01) continue;
        const mid = (a + b) / 2, hole = wd.holes.find((h) => Math.abs(h.c - mid) < h.w / 2 - 1e-3);
        const spans: [number, number][] = hole ? [[0, hole.y0], [hole.y1, H]] : [[0, H]];
        for (const [y0, y1] of spans) {
          if (y1 - y0 < 0.01) continue;
          const pm = wd.pos(mid), nm = wd.neg(mid), rev = hole ? (hole.kind === 'window' ? trim : trimIn) : null;
          const top = y1 >= H - 1e-3 ? wallTop : rev, bottom = y0 > 0 ? rev : null, ht = wd.t / 2;
          if (wd.axis === 'x') {
            M.box(a, y0, wd.at - ht, b, y1, wd.at + ht, { pz: pm, nz: nm, py: top, ny: bottom });
            this.wallBoxes.push([(a + b) / 2, (y0 + y1) / 2, wd.at, (b - a) / 2, (y1 - y0) / 2, ht]);
          } else {
            M.box(wd.at - ht, y0, a, wd.at + ht, y1, b, { px: pm, nx: nm, py: top, ny: bottom });
            this.wallBoxes.push([wd.at, (y0 + y1) / 2, (a + b) / 2, ht, (y1 - y0) / 2, (b - a) / 2]);
          }
        }
        // the reveals (window / door sides) of a hole: its jambs
        if (hole) {
          const rev = hole.kind === 'window' ? trim : trimIn, ht = wd.t / 2;
          const atA = Math.abs(a - (hole.c - hole.w / 2)) < 1e-3, atB = Math.abs(b - (hole.c + hole.w / 2)) < 1e-3;
          if (wd.axis === 'x') {
            if (atA) M.quad(rev, V(1, 0, 0), V(a, hole.y0, wd.at - ht), V(a, hole.y0, wd.at + ht), V(a, hole.y1, wd.at + ht), V(a, hole.y1, wd.at - ht));
            if (atB) M.quad(rev, V(-1, 0, 0), V(b, hole.y0, wd.at - ht), V(b, hole.y0, wd.at + ht), V(b, hole.y1, wd.at + ht), V(b, hole.y1, wd.at - ht));
          } else {
            if (atA) M.quad(rev, V(0, 0, 1), V(wd.at - ht, hole.y0, a), V(wd.at + ht, hole.y0, a), V(wd.at + ht, hole.y1, a), V(wd.at - ht, hole.y1, a));
            if (atB) M.quad(rev, V(0, 0, -1), V(wd.at - ht, hole.y0, b), V(wd.at + ht, hole.y0, b), V(wd.at + ht, hole.y1, b), V(wd.at - ht, hole.y1, b));
          }
        }
      }
      // trims round the holes
      for (const h of wd.holes) {
        const faces: number[] = h.kind === 'inner' ? [1, -1] : [wd.axis === 'x' ? (wd.at > 0 ? 1 : -1) : (wd.at > 0 ? 1 : -1), wd.axis === 'x' ? (wd.at > 0 ? -1 : 1) : (wd.at > 0 ? -1 : 1)];
        faces.forEach((sd, fi) => {
          const outerFace = h.kind !== 'inner' && fi === 0, tm = outerFace ? trim : trimIn, f = wd.at + sd * (wd.t / 2), o = 0.035, bw = outerFace ? 0.12 : 0.09;
          const put = (s0: number, s1: number, y0: number, y1: number, depth = o) => {
            const d0 = Math.min(f, f + sd * depth), d1 = Math.max(f, f + sd * depth);
            if (wd.axis === 'x') M.box(s0, y0, d0, s1, y1, d1, tm); else M.box(d0, y0, s0, d1, y1, s1, tm);
          };
          const s0 = h.c - h.w / 2, s1 = h.c + h.w / 2;
          put(s0 - bw, s1 + bw, h.y1, h.y1 + bw + (outerFace ? 0.04 : 0));       // header
          put(s0 - bw, s0, h.kind === 'window' ? h.y0 : 0, h.y1);                // sides
          put(s1, s1 + bw, h.kind === 'window' ? h.y0 : 0, h.y1);
          if (h.kind === 'window') {
            put(s0 - bw - 0.04, s1 + bw + 0.04, h.y0 - 0.07, h.y0, outerFace ? 0.12 : 0.06);   // sill
            if (outerFace) {
              // shutters
              const sw = h.w / 2 + 0.05;
              put(s0 - bw - sw, s0 - bw - 0.02, h.y0, h.y1, 0.05); put(s1 + bw + 0.02, s1 + bw + sw, h.y0, h.y1, 0.05);
              const shut = (x0: number, x1: number) => {
                const d = f + sd * 0.051;
                if (wd.axis === 'x') M.quad(shutter, V(0, 0, sd), V(x0, h.y0, d), V(x1, h.y0, d), V(x1, h.y1, d), V(x0, h.y1, d), [0, 0, 1, 0, 1, 1, 0, 1]);
                else M.quad(shutter, V(sd, 0, 0), V(d, h.y0, x0), V(d, h.y0, x1), V(d, h.y1, x1), V(d, h.y1, x0), [0, 0, 1, 0, 1, 1, 0, 1]);
              };
              shut(s0 - bw - sw, s0 - bw - 0.02); shut(s1 + bw + 0.02, s1 + bw + sw);
              // a flower box under the front windows
              if (wd.axis === 'x' && wd.at > 0 && h.y0 < 1.2) {
                const z0 = f + 0.02, z1 = f + 0.32;
                M.box(s0 - 0.1, h.y0 - 0.42, z0, s1 + 0.1, h.y0 - 0.12, z1, box);
                M.box(s0 - 0.06, h.y0 - 0.15, z0 + 0.04, s1 + 0.06, h.y0 - 0.12, z1 - 0.04, soil);
                const r = rnd(Math.round(h.c * 10) + 3), ball = new THREE.IcosahedronGeometry(1, 1);
                for (let k = 0; k < 9; k++) {
                  const fx = s0 + 0.02 + (k / 8) * (h.w - 0.04), fz = (z0 + z1) / 2 + (r() - 0.5) * 0.14, fy = h.y0 - 0.1 + r() * 0.14;
                  M.geo(toonMatCached(0x4f9a3a), ball, place(fx, fy - 0.03, fz, 0, 0, 0, 0.09, 0.07, 0.09));
                  M.geo(toonMatCached(S.flowers[k % S.flowers.length]), ball, place(fx + (r() - 0.5) * 0.06, fy + 0.05, fz, 0, 0, 0, 0.06, 0.05, 0.06));
                }
              }
            } else {
              // curtains (inside): two gathered panels + a rod
              const cm = toonMatCached(curtainFor(wd, h));
              const d0 = f + sd * 0.06;
              const panel = (x0: number, x1: number) => { if (wd.axis === 'x') M.box(x0, h.y0 - 0.1, Math.min(d0, d0 + sd * 0.06), x1, h.y1 + 0.12, Math.max(d0, d0 + sd * 0.06), cm); else M.box(Math.min(d0, d0 + sd * 0.06), h.y0 - 0.1, x0, Math.max(d0, d0 + sd * 0.06), h.y1 + 0.12, x1, cm); };
              panel(s0 - 0.28, s0 + 0.04); panel(s1 - 0.04, s1 + 0.28);
              if (wd.axis === 'x') M.box(s0 - 0.36, h.y1 + 0.12, Math.min(d0, d0 + sd * 0.09), s1 + 0.36, h.y1 + 0.16, Math.max(d0, d0 + sd * 0.09), brass);
              else M.box(Math.min(d0, d0 + sd * 0.09), h.y1 + 0.12, s0 - 0.36, Math.max(d0, d0 + sd * 0.09), h.y1 + 0.16, s1 + 0.36, brass);
            }
          }
        });
      }
    }
    // corner boards + a frieze under the eaves
    for (const [cx, cz] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]]) M.box(cx - 0.13, 0, cz - 0.13, cx + 0.13, H, cz + 0.13, trim);
    M.box(-W / 2 - 0.04, H - 0.26, D / 2 - 0.02, W / 2 + 0.04, H, D / 2 + 0.04, trim);
    M.box(-W / 2 - 0.04, H - 0.26, -D / 2 - 0.04, W / 2 + 0.04, H, -D / 2 + 0.02, trim);
    // the stone foundation (outside faces only: the floor shows inside)
    const fy0 = -1.2, fy1 = 0.04, e = 0.06;
    M.box(-W / 2 - e, fy0, -D / 2 - e, W / 2 + e, fy1, D / 2 + e, { px: stone, nx: stone, pz: stone, nz: stone });
    // floors (per room) + the thresholds in the doorways
    for (const r of this.rooms) M.quad(floors[r.id], V(0, 1, 0), V(r.x0, 0, r.z1), V(r.x1, 0, r.z1), V(r.x1, 0, r.z0), V(r.x0, 0, r.z0));
    // ---- the front stoop: deck, a step, two posts, a little gable roof over the door
    const sz0 = D / 2, sz1 = D / 2 + 1.5;
    M.box(-1.7, -1.2, sz0, 1.7, 0, sz1, { py: deck, px: deck, nx: deck, pz: deck });
    M.box(-1.25, -1.2, sz1, 1.25, -0.1, sz1 + 0.38, { py: deck, px: deck, nx: deck, pz: deck });
    const PR = HOUSE.porch;
    for (const px of [-1.5, 1.5]) { M.box(px - 0.08, 0, sz1 - 0.24, px + 0.08, PR.y1, sz1 - 0.08, trim); M.box(px - 0.12, 0, sz1 - 0.28, px + 0.12, 0.18, sz1 - 0.04, trim); }
    {   // a shed roof over the stoop (shingles on top, a beam on the posts), tucked under the main eave
      const ang = Math.atan2(PR.y0 - PR.y1, PR.len), cy = (PR.y0 + PR.y1) / 2 + 0.06, cz = D / 2 + PR.len / 2;
      const top = new THREE.BoxGeometry(3.7, 0.12, Math.hypot(PR.len, PR.y0 - PR.y1));
      M.geo(roofEdge, top, place(0, cy, cz, ang, 0, 0));
      const sh = new THREE.PlaneGeometry(3.7, Math.hypot(PR.len, PR.y0 - PR.y1)); sh.rotateX(-Math.PI / 2);
      const uv = sh.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3.7, uv.getY(i) * 1.8);
      M.geo(roof, sh, place(0, cy + 0.062, cz, ang, 0, 0));
      M.box(-1.62, PR.y1 - 0.14, sz1 - 0.26, 1.62, PR.y1, sz1 - 0.06, trim);
    }
    // ---- the double front door, swung open against the wall outside; a doormat
    for (const sd of [-1, 1]) {
      const hx = sd * HOUSE.door / 2, ang = sd * 2.75, lw = HOUSE.door / 2 - 0.02;
      const g = new THREE.BoxGeometry(lw, HOUSE.doorH - 0.04, 0.06); g.translate(sd * lw / 2, (HOUSE.doorH - 0.04) / 2, 0);
      const m4 = new THREE.Matrix4().makeRotationY(ang - sd * Math.PI).premultiply(new THREE.Matrix4().makeTranslation(hx, 0.02, D / 2 + 0.06));
      M.geo(doorM, g, m4);
      for (const py of [0.55, 1.55]) { const pg = new THREE.BoxGeometry(lw * 0.62, 0.7, 0.05); pg.translate(sd * lw / 2, py, 0.03); M.geo(toonMatCached(new THREE.Color(S.door).multiplyScalar(0.8).getHex()), pg, m4); }
      const kn = new THREE.SphereGeometry(0.045, 10, 8); kn.translate(sd * (lw - 0.1), 1.05, 0.07); M.geo(brass, kn, m4);
    }
    M.box(-0.75, 0.005, D / 2 + 0.25, 0.75, 0.03, D / 2 + 1.05, toonMatCached(0x9b3b2e));
    // ---- the chimney (stone, up the left gable end, through the eaves)
    const ch = this.chimneyLocal();
    M.box(-W / 2 - 0.78, -1.2, ch.zc - 0.55, -W / 2 - 0.0, ch.y - 0.25, ch.zc + 0.55, { px: stone, nx: stone, pz: stone, nz: stone });
    M.box(-W / 2 - 0.88, ch.y - 0.25, ch.zc - 0.65, -W / 2 + 0.1, ch.y, ch.zc + 0.65, { px: dark, nx: dark, pz: dark, nz: dark, ny: dark });
    M.box(-W / 2 - 0.88, ch.y - 0.001, ch.zc - 0.65, -W / 2 + 0.1, ch.y, ch.zc + 0.65, { py: toonMatCached(0x3a2f28) });
    M.box(-W / 2 - 0.6, ch.y, ch.zc - 0.38, -W / 2 - 0.18, ch.y + 0.04, ch.zc + 0.38, { py: toonMatCached(0x0f0c0a) });
    // ---- pendant lamps (cord, shade; the bulb is its own mesh: it lights up) — with the ceiling: they hide with it
    const shade = toonMat(0x2f6b4a, { side: THREE.DoubleSide });
    for (const [lx, lz] of [[-2.6, 2.0], [3.0, 2.0], [-2.3, -2.4]]) {
      R.geo(dark, new THREE.CylinderGeometry(0.008, 0.008, 0.55, 5), place(lx, H - 0.27, lz));
      R.geo(shade, new THREE.CylinderGeometry(0.07, 0.26, 0.2, 16, 1, true), place(lx, H - 0.62, lz));
      const bm = new THREE.MeshBasicMaterial({ color: 0x8a7a5a }); this.bulbs.push(bm);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), bm); bulb.position.set(lx, H - 0.72, lz); this.roofG.add(bulb);
    }
    // ---- the roof (its own group: hidden while my pig is inside)
    const k = HOUSE.rise / (D / 2), O = HOUSE.over, Os = HOUSE.overSide, tv = HOUSE.slab * Math.sqrt(1 + k * k), Xr = W / 2 + Os, Ze = D / 2 + O;
    const yU = (z: number) => H + HOUSE.rise - k * Math.abs(z);   // the underside at z
    const slopeLen = Ze * Math.sqrt(1 + k * k);
    for (const sd of [-1, 1]) {
      const n = V(0, 1, sd * k).normalize();
      const a = V(-Xr, yU(0) + tv, 0), b = V(Xr, yU(0) + tv, 0), c = V(Xr, yU(Ze) + tv, sd * Ze), d = V(-Xr, yU(Ze) + tv, sd * Ze);
      R.quad(roof, n, a, b, c, d, [-Xr, slopeLen, Xr, slopeLen, Xr, 0, -Xr, 0]);
      R.quad(soffit, n.clone().negate(), V(-Xr, yU(0), 0), V(Xr, yU(0), 0), V(Xr, yU(Ze), sd * Ze), V(-Xr, yU(Ze), sd * Ze));
      R.quad(roofEdge, V(0, 0, sd), V(-Xr, yU(Ze), sd * Ze), V(Xr, yU(Ze), sd * Ze), V(Xr, yU(Ze) + tv, sd * Ze), V(-Xr, yU(Ze) + tv, sd * Ze));
      for (const sx of [-1, 1]) R.quad(roofEdge, V(sx, 0, 0), V(sx * Xr, yU(0), 0), V(sx * Xr, yU(Ze), sd * Ze), V(sx * Xr, yU(Ze) + tv, sd * Ze), V(sx * Xr, yU(0) + tv, 0));
      // fascia board (trim colour) under the eave edge
      R.box(-Xr, yU(Ze) - 0.16, sd > 0 ? Ze - 0.05 : -Ze, Xr, yU(Ze) + 0.02, sd > 0 ? Ze : -Ze + 0.05, trim);
    }
    R.box(-Xr - 0.04, yU(0) + tv - 0.06, -0.17, Xr + 0.04, yU(0) + tv + 0.1, 0.17, roofEdge);   // ridge cap
    // gables (siding / logs) with a little round attic window
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 - 0.0);
      R.tri(outside, V(sx, 0, 0), V(x, H, -D / 2), V(x, H, D / 2), V(x, H + HOUSE.rise, 0));
      R.geo(dark, new THREE.CylinderGeometry(0.28, 0.28, 0.04, 18), place(x + sx * 0.01, H + HOUSE.rise * 0.42, 0, 0, 0, Math.PI / 2));
      R.geo(trim, new THREE.TorusGeometry(0.3, 0.05, 6, 18), place(x + sx * 0.03, H + HOUSE.rise * 0.42, 0, 0, Math.PI / 2, 0));
      R.geo(trim, new THREE.BoxGeometry(0.03, 0.56, 0.05), place(x + sx * 0.03, H + HOUSE.rise * 0.42, 0));
      R.geo(trim, new THREE.BoxGeometry(0.03, 0.05, 0.56), place(x + sx * 0.03, H + HOUSE.rise * 0.42, 0));
    }
    // the ceiling (per room)
    for (const r of this.rooms) R.quad(ceiling, V(0, -1, 0), V(r.x0, H, r.z0), V(r.x1, H, r.z0), V(r.x1, H, r.z1), V(r.x0, H, r.z1));
    // winter: snow on the roof + icicles
    if (S.snow) {
      const snow = toonMatCached(0xf6fbff), ice = toonMatCached(0xcfeaff), st = 0.16;
      for (const sd of [-1, 1]) {
        const n = V(0, 1, sd * k).normalize(), lift = tv + 0.01;
        const a = V(-Xr - 0.05, yU(0) + lift + st, 0), b = V(Xr + 0.05, yU(0) + lift + st, 0), c = V(Xr + 0.05, yU(Ze) + lift + st, sd * (Ze + 0.06)), d = V(-Xr - 0.05, yU(Ze) + lift + st, sd * (Ze + 0.06));
        R.quad(snow, n, a, b, c, d);
        R.quad(snow, V(0, 0, sd), V(-Xr - 0.05, yU(Ze) + lift - 0.04, sd * (Ze + 0.06)), V(Xr + 0.05, yU(Ze) + lift - 0.04, sd * (Ze + 0.06)), c, d);
        for (const sx of [-1, 1]) R.quad(snow, V(sx, 0, 0), V(sx * (Xr + 0.05), yU(0) + lift, 0), V(sx * (Xr + 0.05), yU(Ze) + lift - 0.04, sd * (Ze + 0.06)), V(sx * (Xr + 0.05), yU(Ze) + lift + st, sd * (Ze + 0.06)), V(sx * (Xr + 0.05), yU(0) + lift + st, 0));
        const r = rnd(sd > 0 ? 21 : 22), cone = new THREE.ConeGeometry(0.045, 1, 6);
        for (let x = -Xr + 0.2; x < Xr - 0.1; x += 0.28 + r() * 0.25) { const l = 0.15 + r() * 0.4; R.geo(ice, cone, place(x, yU(Ze) - 0.16 - l / 2, sd * (Ze - 0.02), Math.PI, 0, 0, 1, l, 1)); }
      }
      // snow on the stoop roof
      const PR2 = HOUSE.porch, ang = Math.atan2(PR2.y0 - PR2.y1, PR2.len);
      M.geo(snow, new THREE.BoxGeometry(3.75, 0.12, Math.hypot(PR2.len, PR2.y0 - PR2.y1) + 0.04), place(0, (PR2.y0 + PR2.y1) / 2 + 0.19, D / 2 + PR2.len / 2, ang, 0, 0));
    }
    M.build(this.root);
    R.build(this.roofG);
    // night: the windows glow warm from outside while Bob's lights are on
    for (const wd of walls) for (const h of wd.holes) {
      if (h.kind !== 'window' || !wd.outer) continue;
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(h.w, h.y1 - h.y0), this.glowMat);
      const out = wd.at > 0 ? 1 : -1, f = wd.at - out * 0.02;
      if (wd.axis === 'x') { pl.position.set(h.c, (h.y0 + h.y1) / 2, f); pl.rotation.y = out > 0 ? 0 : Math.PI; }
      else { pl.position.set(f, (h.y0 + h.y1) / 2, h.c); pl.rotation.y = out > 0 ? Math.PI / 2 : -Math.PI / 2; }
      pl.renderOrder = 6; this.root.add(pl);
    }
  }

  /** Wall boxes (local centre + half sizes) collected while building: one static collider each. */
  private wallBoxes: number[][] = [];
  private colliders() {
    const W = this.w, D = this.d, H = HOUSE.H, c = new THREE.Vector3(), h = new THREE.Vector3();
    const put = (lx: number, ly: number, lz: number, hx: number, hy: number, hz: number) => {
      this.toWorld(lx, lz, c); c.y = this.y0 + ly;
      return staticBox(c, h.set(hx, hy, hz), this.yaw);
    };
    for (const [x, y, z, hx, hy, hz] of this.wallBoxes) put(x, y, z, hx, hy, hz);
    put(0, -0.6, 0, W / 2 + 0.06, 0.6, D / 2 + 0.06);                       // floor + foundation
    put(0, -0.6, D / 2 + 0.75, 1.7, 0.6, 0.75);                               // the stoop
    put(0, -0.65, D / 2 + 1.69, 1.25, 0.55, 0.19);                            // its step
    const PR = HOUSE.porch;
    for (const px of [-1.5, 1.5]) put(px, PR.y1 / 2, D / 2 + 1.34, 0.08, PR.y1 / 2, 0.08);   // porch posts
    {   // its roof (pigs can land on it)
      const ang = Math.atan2(PR.y0 - PR.y1, PR.len), q = this.q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ang));
      this.toWorld(0, D / 2 + PR.len / 2, c); c.y = this.y0 + (PR.y0 + PR.y1) / 2 + 0.06;
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(c.x, c.y, c.z).setRotation(q));
      world.createCollider(RAPIER.ColliderDesc.cuboid(1.85, 0.06, Math.hypot(PR.len, PR.y0 - PR.y1) / 2).setCollisionGroups(groups(L.STATIC)), body);
    }
    const ch = this.chimneyLocal();
    put(-W / 2 - 0.39, (ch.y - 1.2) / 2, ch.zc, 0.39, (ch.y + 1.2) / 2, 0.55);
    // the roof: two slabs (tilted boxes), the ceiling, the gable ends (prisms) — the camera skips these while I'm inside
    const k = HOUSE.rise / (D / 2), Xr = W / 2 + HOUSE.overSide, Ze = D / 2 + HOUSE.over, ang = Math.atan(k), len = Ze / Math.cos(ang), t = HOUSE.slab;
    const qy = this.q;
    for (const sd of [-1, 1]) {
      const cz = sd * Ze / 2, cy = H + HOUSE.rise - k * Ze / 2 + t / 2 / Math.cos(ang);
      const q = qy.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), sd * ang));
      this.toWorld(0, cz, c); c.y = this.y0 + cy;
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(c.x, c.y, c.z).setRotation(q));
      const col = world.createCollider(RAPIER.ColliderDesc.cuboid(Xr, t / 2, len / 2).setFriction(0.5).setCollisionGroups(groups(L.STATIC)), body);
      this.roofHandles.push(col.handle);
    }
    const ceil = put(0, H + 0.05, 0, W / 2, 0.05, D / 2); this.roofHandles.push(ceil.collider(0).handle);
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 - HOUSE.T / 2), pts: number[] = [];
      for (const dx of [-HOUSE.T / 2, HOUSE.T / 2]) for (const [pz, py] of [[-D / 2, H], [D / 2, H], [0, H + HOUSE.rise]]) pts.push(x + dx, py, pz);
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(this.x, this.y0, this.z).setRotation(qy));
      const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
      if (desc) { const col = world.createCollider(desc.setCollisionGroups(groups(L.STATIC)), body); this.roofHandles.push(col.handle); }
    }
  }

  // ---------------------------------------------------------------- the rooms' furniture (local; interiors.ts places it)
  private makeLayout() {
    const W = this.w, D = this.d, T = HOUSE.T, IT = HOUSE.IT, bz = HOUSE.backZ, bx = HOUSE.bathX;
    const iL = -W / 2 + T, iR = W / 2 - T, iF = D / 2 - T, iB = -D / 2 + T;   // inner wall faces
    const pa = bz + IT / 2, pb = bz - IT / 2;                                     // the partition's two faces
    const E = Math.PI / 2;
    this.layout = [
      // living room: the fireplace on the left wall, a couch facing it, the TV, the record player, books, a lamp, a rug
      { id: 'fireplace', x: iL, z: 1.9, yaw: E, wall: true, tag: 'hearth' },
      { id: 'couchM', x: -1.9, z: 1.9, yaw: -E },
      { id: 'tvSet', x: -4.55, z: pa, yaw: 0, wall: true },
      { id: 'gramo', x: -0.35, z: pa, yaw: 0, wall: true },
      { id: 'shelf', x: iL, z: 3.75, yaw: E, wall: true },
      { id: 'floorLamp', x: -1.9, z: 3.4, yaw: 0 },
      { id: 'plant4', x: -1.55, z: iF - 0.35, yaw: 0 },
      { rug: 'Carpet_Round', x: -3.1, z: 1.9, yaw: 0, width: 2.4 },
      // kitchen: a counter run along the right wall, a table with chairs, a trash can
      { row: ['fridge', 'oven', 'kSink', 'kDrawers', 'kCab'], x: iR, z: pa + 0.05, yaw: -E, dir: [0, 1] },
      { table: 'tableL', x: 2.35, z: 2.3, yaw: 0, chairs: ['chair1', 'chair2', 'chair1', 'chair3'] },
      { id: 'trash', x: 0.95, z: iF - 0.3, yaw: 0 },
      { top: 'kDrawers', id: 'radio' },
      // Bob's bedroom: the king bed against the back wall, nightstands, a dresser, a shelf, a rug at the foot of the bed
      { id: 'bedKing', x: -2.45, z: iB, yaw: 0, wall: true, tag: 'bobBed' },
      { id: 'nightstand', x: -4.05, z: iB, yaw: 0, wall: true, tag: 'nsL' },
      { id: 'nightstand', x: -0.85, z: iB, yaw: 0, wall: true, tag: 'nsR' },
      { top: 'nsL', id: 'deskLamp' },
      { top: 'nsR', prop: 'piggyBank' },
      { id: 'drawer3', x: bx - IT / 2, z: -1.75, yaw: -E, wall: true },
      { id: 'plant7', x: iL + 0.35, z: pb - 0.35, yaw: 0 },
      { rug: 'Carpet_1', x: -2.45, z: -1.35, yaw: 0, width: 2.0 },
      // bathroom: the tub along the back wall, the toilet, the sink, the washing machine
      { id: 'bathtub', x: 2.3, z: iB, yaw: 0, wall: true },
      { id: 'toilet', x: iR, z: -3.35, yaw: -E, wall: true },
      { id: 'bSink', x: iR, z: -1.85, yaw: -E, wall: true },
      { id: 'washer', x: bx + IT / 2, z: -1.4, yaw: E, wall: true },
      { top: 'toilet', id: 'paper', dx: 0.35 },
    ];
  }

  // ---------------------------------------------------------------- Bob's bed
  /** The bed is there to sleep in (not stolen, not carried off, not knocked over, still in the house). */
  get bedOk() {
    const b = this.bed;
    if (!b || b.banked || b.heldBy || b.helper) return false;
    const up = v1.set(0, 1, 0).applyQuaternion(b.obj.quaternion).y;
    return up > 0.85 && this.inside(b.obj.position);
  }
  /** With Bob in it: gone, tipped or out of the house (being held / shoved is measured by how far it moved). */
  get bedUpset() {
    const b = this.bed;
    if (!b || b.banked) return true;
    return v1.set(0, 1, 0).applyQuaternion(b.obj.quaternion).y < 0.8 || !this.inside(b.obj.position);
  }
  /** Where Bob stands to get in / out: beside the bed, halfway down (world, on the floor). */
  bedSide(out: THREE.Vector3) {
    const b = this.bed!;
    return out.set(b.size.x / 2 + 0.55, 0, 0.25).applyQuaternion(b.obj.quaternion).add(b.obj.position).setY(this.y0);
  }
  /** Bob's body in the bed (feet at the foot end, head on the pillow). */
  bedPose(pos: THREE.Vector3, q: THREE.Quaternion) {
    const b = this.bed!;
    q.copy(b.obj.quaternion).multiply(LIE);
    pos.set(0, -b.size.y / 2 + BED.lieY, b.size.z / 2 - BED.foot).applyQuaternion(b.obj.quaternion).add(b.obj.position);
  }
  headPos(out: THREE.Vector3) {
    const b = this.bed!;
    return out.set(0, -b.size.y / 2 + BED.lieY + 0.25, b.size.z / 2 - BED.foot - 1.75).applyQuaternion(b.obj.quaternion).add(b.obj.position);
  }
  get markPos() { return this.bed ? this.headPos(new THREE.Vector3()).setY(this.y0 + 1.9) : this.doorIn; }
  /** A muddy pig at sleeping Bob's head (RMB = mud on his face, like in the hammock). */
  faceNear(p: Pig) {
    const bob = G.farmer as BobLike | null;
    if (!bob?.inBed || !this.bed || p.out || p.cage || p.heldBy || p.held || p.mode !== 'normal' || !(p.muddy > 0) || bob.mudMarks >= BED.marks) return false;
    const h = this.headPos(v1);
    return Math.hypot(p.pos.x - h.x, p.pos.z - h.z) < BED.faceR && Math.abs(p.pos.y - h.y) < 1.3;   // from beside the bed, or up on it
  }
  private quilt: THREE.Mesh | null = null;
  /** His patchwork quilt: on the bed only while he's in it. */
  private ensureQuilt() {
    if (this.quilt || !this.bed) return this.quilt;
    const b = this.bed, c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d')!, cols = ['#e05a4e', '#f2c14e', '#5fa8d3', '#7cc36a', '#f4f1e8', '#c77dff'];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.fillStyle = cols[(i * 3 + j * 2) % cols.length]; x.fillRect(i * 16, j * 16, 16, 16); }
    x.strokeStyle = 'rgba(255,255,255,0.7)'; x.setLineDash([2, 2]); for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * 16, 0); x.lineTo(i * 16, 64); x.moveTo(0, i * 16); x.lineTo(64, i * 16); x.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter;
    const q = new THREE.Mesh(new THREE.BoxGeometry(b.size.x * 0.84, 0.18, b.size.z * 0.6), toonMat(0xffffff, { map: t }));
    q.position.set(0, -b.size.y / 2 + BED.lieY + 0.33, b.size.z / 2 - b.size.z * 0.3 - 0.06); q.castShadow = true; q.visible = false;
    b.obj.add(q); this.quilt = q;
    return q;
  }
  /** Host: a muddy hoof on sleeping Bob's face. */
  step() {
    const bob = G.farmer as BobLike | null;
    if (!bob?.inBed) return;
    for (const p of G.pigs as Pig[]) if (p.input.grabP && this.faceNear(p)) { p.touch(this.headPos(v1)); bob.mudFace(p); break; }
  }

  // ---------------------------------------------------------------- every frame
  /** Roof hides while my pig is inside (third person); lights on in the evening while Bob's up. */
  render(dt: number, me: Pig | null, fp: boolean, bobUp: boolean) {
    const inside = !!me && !me.out && !fp && this.inside(me.pos, -0.2);
    this.roofG.visible = !inside;
    if (inside !== this.skipOn) {
      this.skipOn = inside;
      for (const h of this.roofHandles) { if (inside) G.camSkip.add(h); else G.camSkip.delete(h); }
    }
    const q = this.ensureQuilt(); if (q) q.visible = !!(G.farmer as BobLike | null)?.inBed;
    const want = bobUp && G.night > 0.2 ? 1 : 0;
    this.lit += (want - this.lit) * Math.min(1, dt * 1.5);
    for (const l of this.lamps) l.k = this.lit;
    const on = this.lit * Math.min(1, G.night * 1.6);
    for (const b of this.bulbs) b.color.setRGB(0.54 + 0.46 * on, 0.48 + 0.48 * on, 0.35 + 0.25 * on);
    this.glowMat.opacity = 0.5 * on;
  }
}

/** Shared plain toon colours (flowers, soil…). */
const MATS = new Map<number, THREE.Material>();
function toonMatCached(c: number) { let m = MATS.get(c); if (!m) MATS.set(c, m = toonMat(c)); return m; }
/** Curtain colour by the room behind the window. */
function curtainFor(wd: { axis: 'x' | 'z'; at: number }, h: Hole) {
  const lz = wd.axis === 'x' ? wd.at : h.c, lx = wd.axis === 'x' ? h.c : wd.at;
  if (lz < HOUSE.backZ) return lx < HOUSE.bathX ? 0xd86a8e : 0x7fc8b0;   // bedroom pink, bathroom mint
  return lx < 0.6 ? 0xc0453a : 0x5f8fb8;                                 // living red, kitchen blue
}
