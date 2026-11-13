import * as THREE from 'three';
import { has } from '../core/assets';
import { staticBox, SEE_THROUGH } from '../core/physics';
import { V3, type Rng } from '../core/util';
import { toonMat } from '../render/toon';
import { G } from '../game/ctx';
import type { Terrain, Rect } from './terrain';
import type { FarmBuild } from './farm1';
import type { PROPS } from './props';

/** Kenney car kit models used by the junkyard (tools/fetch_assets.sh). */
export const LANDMARK_MODELS = ['kenney/sedan', 'kenney/van', 'kenney/delivery', 'kenney/truck'];

interface Ctx {
  scene: THREE.Scene; t: Terrain; rng: Rng; out: FarmBuild; blocked: Rect[];
  decor: (model: string, x: number, z: number, o?: { height?: number; scale?: number; yaw?: number; collide?: 'box' | 'trunk' | false; sink?: number }) => THREE.Object3D | null;
  prop: (kind: keyof typeof PROPS, x: number, z: number, yaw?: number, lift?: number) => void;
}

const mats = new Map<number, THREE.MeshToonMaterial>();
const M = (c: number) => { let m = mats.get(c); if (!m) { m = toonMat(c); mats.set(c, m); } return m; };
function mesh(g: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material | number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, typeof mat === 'number' ? M(mat) : mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
}

/**
 * Big places to hide, search and wreck (the farm stays the same size; its empty corners get filled):
 * a hedge maze with a golden trophy in the middle (NE), a sunflower field taller than a standing pig (N),
 * a junkyard of old cars and tyre stacks (SW) and a greenhouse full of flower pots to smash (W, by the garden).
 */
export function buildLandmarks(c: Ctx) {
  hedgeMaze(c);
  sunflowers(c);
  junkyard(c);
  greenhouse(c);
}

// ---------------------------------------------------------------- hedge maze
const HEDGE = new THREE.BoxGeometry(1, 1, 1);
const BUMP = new THREE.IcosahedronGeometry(0.5, 1);
function hedgeMaze(c: Ctx) {
  const { scene, t, rng, out, blocked } = c;
  const CW = 2.6, NX = 6, NZ = 4, x0 = 44, z0 = -106.2, H = 1.95, TH = 0.7;
  const y = (x: number, z: number) => t.height(x, z);
  // carve a perfect maze (recursive backtracker), then knock out a few extra walls so it has loops (more fun to flee in)
  const id = (i: number, j: number) => j * NX + i;
  const seen = new Set<number>();
  const open = new Set<string>();            // "a|b" between neighbouring cells
  const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const stack = [[0, 0]]; seen.add(0);
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const nb = [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < NX && b < NZ && !seen.has(id(a, b)));
    if (!nb.length) { stack.pop(); continue; }
    const [a, b] = nb[Math.floor(rng.next() * nb.length)];
    open.add(key(id(i, j), id(a, b))); seen.add(id(a, b)); stack.push([a, b]);
  }
  for (let k = 0; k < 4; k++) { const i = rng.int(0, NX - 2), j = rng.int(0, NZ - 1); open.add(key(id(i, j), id(i + 1, j))); }
  const wall = (x: number, z: number, len: number, alongX: boolean) => {
    const g = new THREE.Group(); g.position.set(x, y(x, z) - 0.05, z); g.rotation.y = alongX ? 0 : Math.PI / 2; scene.add(g); out.statics.push(g);
    const b = mesh(g, HEDGE, 0x3f8f3a, 0, H / 2, 0); b.scale.set(len + TH, H, TH);
    const n = Math.max(2, Math.round(len / 0.9));
    for (let k = 0; k < n; k++) {
      const s = 0.55 + rng.range(0, 0.25);
      const bp = mesh(g, BUMP, k % 2 ? 0x4aa043 : 0x3a8a35, -len / 2 + (k + 0.5) * (len / n), H - 0.05 + rng.range(-0.05, 0.08), rng.range(-0.08, 0.08));
      bp.scale.set(s * 1.3, s * 0.8, s * 0.9);
    }
    staticBox(V3(x, y(x, z) + H / 2, z), V3((len + TH) / 2, H / 2, TH / 2), alongX ? 0 : Math.PI / 2);
  };
  // inner walls between cells that stay closed + the outer ring (gaps: south entrance, west exit)
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const cx = x0 + (i + 0.5) * CW, cz = z0 + (j + 0.5) * CW;
    if (i < NX - 1 && !open.has(key(id(i, j), id(i + 1, j)))) wall(cx + CW / 2, cz, CW, false);
    if (j < NZ - 1 && !open.has(key(id(i, j), id(i, j + 1)))) wall(cx, cz + CW / 2, CW, true);
  }
  const X1 = x0 + NX * CW, Z1 = z0 + NZ * CW;
  for (let i = 0; i < NX; i++) {
    const cx = x0 + (i + 0.5) * CW;
    if (i !== 1) wall(cx, Z1, CW, true);          // south side (entrance at cell 1)
    wall(cx, z0, CW, true);                         // north side
  }
  for (let j = 0; j < NZ; j++) {
    const cz = z0 + (j + 0.5) * CW;
    if (j !== 2) wall(x0, cz, CW, false);          // west side (second way out)
    wall(X1, cz, CW, false);
  }
  t.noGrass({ x0: x0 - 0.5, x1: X1 + 0.5, z0: z0 - 0.5, z1: Z1 + 0.5 });
  blocked.push({ x0: x0 - 2, x1: X1 + 2, z0: z0 - 2, z1: Z1 + 2 });
  // the prize in the middle, on a little stone plinth
  const mx = x0 + Math.floor(NX / 2) * CW - CW / 2, mz = z0 + Math.floor(NZ / 2) * CW - CW / 2;
  const plinth = new THREE.Group(); plinth.position.set(mx, y(mx, mz), mz); scene.add(plinth); out.statics.push(plinth);
  mesh(plinth, new THREE.CylinderGeometry(0.42, 0.5, 0.6, 10), 0xb9b2a6, 0, 0.3, 0);
  staticBox(V3(mx, y(mx, mz) + 0.3, mz), V3(0.42, 0.3, 0.42));
  c.prop('trophy', mx, mz, 0, 0.62);
  c.prop('gnome', x0 + CW * 4.5, z0 + CW * 0.5, 2.4);       // a gnome lost in the maze too
}

// ---------------------------------------------------------------- sunflower field
const STEM = new THREE.CylinderGeometry(0.035, 0.05, 1, 6);
const LEAF = new THREE.SphereGeometry(0.16, 8, 6);
const DISC = new THREE.CylinderGeometry(0.19, 0.2, 0.08, 12);
const PETALS = (() => {
  const s = new THREE.Shape(), N = 13;
  for (let i = 0; i <= N * 2; i++) {
    const a = (i / (N * 2)) * Math.PI * 2, r = i % 2 ? 0.33 : 0.56;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ShapeGeometry(s);
})();
function sunflowers(c: Ctx) {
  const { scene, t, rng, out, blocked } = c;
  const F = { x0: 14, x1: 28, z0: -107, z1: -97 };
  const y = (x: number, z: number) => t.height(x, z);
  const petal = toonMat(0xffd21f, { side: THREE.DoubleSide, emissive: new THREE.Color(0x6b4a00) });
  for (let x = F.x0 + 0.5; x < F.x1; x += 1.05) for (let z = F.z0 + 0.5; z < F.z1; z += 1.05) {
    const px = x + rng.range(-0.3, 0.3), pz = z + rng.range(-0.3, 0.3), h = rng.range(2.1, 2.6);
    const g = new THREE.Group(); g.position.set(px, y(px, pz) - 0.05, pz); g.rotation.y = rng.range(-0.4, 0.4); scene.add(g); out.statics.push(g);
    const st = mesh(g, STEM, 0x4f9a3a, 0, h / 2, 0); st.scale.y = h;
    for (const s of [-1, 1]) { const l = mesh(g, LEAF, 0x5cb83d, s * 0.16, h * (0.4 + s * 0.08), 0); l.scale.set(1.3, 0.3, 0.7); l.rotation.z = s * 0.5; }
    // heads look south-east (toward the morning sun), nodding a little
    const head = new THREE.Group(); head.position.set(0, h, 0.04); head.rotation.set(-0.35 + rng.range(-0.15, 0.15), 0.6, 0); g.add(head);
    mesh(head, PETALS, petal, 0, 0, 0.05);
    mesh(head, DISC, 0x6b3a1a, 0, 0, 0.07, Math.PI / 2);
  }
  t.noGrass(F); blocked.push({ x0: F.x0 - 1, x1: F.x1 + 1, z0: F.z0 - 1, z1: F.z1 + 1 });
  G.cover.rect('crop', F.x0, F.x1, F.z0, F.z1, y((F.x0 + F.x1) / 2, (F.z0 + F.z1) / 2) - 0.3, 2.4);
  c.prop('melon', 21, -101.5); c.prop('backpack', 17.5, -104);     // somebody left things in there
}

// ---------------------------------------------------------------- junkyard (old cars, tyre stacks)
const TYRE = new THREE.TorusGeometry(0.4, 0.17, 8, 18);
const HUB = new THREE.CylinderGeometry(0.24, 0.24, 0.12, 12);
function junkyard(c: Ctx) {
  const { t, rng, blocked, decor } = c;
  void decor;
  if (!has('kenney/sedan')) return;
  const car = (model: string, x: number, z: number, h: number, yaw: number) => {
    decor(model, x, z, { height: h, yaw, collide: 'box' });
    t.noGrass({ x0: x - 2.4, x1: x + 2.4, z0: z - 2.4, z1: z + 2.4 });
  };
  car('kenney/sedan', -56.2, 12.4, 1.55, 0.5);
  car('kenney/van', -48.6, 14.2, 2.1, -1.25);
  car('kenney/delivery', -53, 16.4, 2.3, 1.62);
  car('kenney/truck', -60, 8.6, 2.2, -0.2);
  // tyre stacks (climb on them, hide behind them)
  const tyres = (x: number, z: number, n: number) => {
    const g = new THREE.Group(); g.position.set(x, t.height(x, z) - 0.02, z); c.scene.add(g); c.out.statics.push(g);
    for (let i = 0; i < n; i++) {
      mesh(g, TYRE, 0x2b2b2e, rng.range(-0.06, 0.06), 0.17 + i * 0.34, rng.range(-0.06, 0.06), Math.PI / 2);
      mesh(g, HUB, 0x8a8f99, 0, 0.17 + i * 0.34, 0, 0);
    }
    staticBox(V3(x, t.height(x, z) + n * 0.17, z), V3(0.55, n * 0.17, 0.55));
  };
  tyres(-45.4, 10.4, 3); tyres(-46.4, 11.4, 2); tyres(-51, 8.6, 4); tyres(-58.4, 15.2, 2);
  blocked.push({ x0: -62, x1: -43, z0: 6, z1: 18 });
  // junk worth a coin or two
  c.prop('gasCan', -52.4, 12.2); c.prop('radio', -55, 9.6); c.prop('wheel', -47.6, 8.4, 1.2); c.prop('barrel', -57.8, 10.6, 0);
}

// ---------------------------------------------------------------- greenhouse (glass, pots on tables)
function greenhouse(c: Ctx) {
  const { scene, t, out, blocked } = c;
  const cx = -43, cz = -77, W = 9, D = 6, H = 2.3, R = 1.3;
  const y0 = t.height(cx, cz);
  const g = new THREE.Group(); g.position.set(cx, y0 - 0.02, cz); scene.add(g); out.statics.push(g);
  const frame = 0x2f8a5a, glass = new THREE.MeshToonMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.28, depthWrite: false });
  const post = new THREE.BoxGeometry(0.1, H, 0.1), pane = new THREE.BoxGeometry(1, 1, 0.03), bar = new THREE.BoxGeometry(1, 0.08, 0.08);
  mesh(g, new THREE.BoxGeometry(W + 0.2, 0.12, D + 0.2), 0x9a8f80, 0, 0.06, 0);   // floor slab
  // walls: posts every 1.5 m, glass between, a door gap on the east side
  const side = (len: number, along: 'x' | 'z', off: number, gap: boolean) => {
    const n = Math.round(len / 1.5);
    for (let k = 0; k <= n; k++) {
      const p = -len / 2 + (k * len) / n;
      mesh(g, post, frame, along === 'x' ? p : off, H / 2, along === 'x' ? off : p);
      if (k === n) continue;
      const mid = p + len / n / 2;
      if (gap && Math.abs(mid) < 0.9) continue;
      const pn = mesh(g, pane, glass, along === 'x' ? mid : off, H / 2, along === 'x' ? off : mid);
      pn.scale.set(len / n - 0.1, H - 0.1, 1); if (along === 'z') pn.rotation.y = Math.PI / 2;
      pn.castShadow = false;
    }
    const top = mesh(g, bar, frame, along === 'x' ? 0 : off, H, along === 'x' ? off : 0); top.scale.x = len; if (along === 'z') top.rotation.y = Math.PI / 2;
  };
  side(W, 'x', -D / 2, false); side(W, 'x', D / 2, false); side(D, 'z', -W / 2, false); side(D, 'z', W / 2, true);
  // gable roof: two glass slopes + ridge
  const slope = Math.atan2(R, D / 2), sl = Math.hypot(R, D / 2);
  for (const s of [-1, 1]) {
    const r = mesh(g, pane, glass, 0, H + R / 2, s * D / 4, -s * (Math.PI / 2 - slope), 0, 0); r.scale.set(W, sl, 1); r.castShadow = false;
  }
  const ridge = mesh(g, bar, frame, 0, H + R, 0); ridge.scale.x = W;
  // colliders: glass walls (Bob sees through them), roof
  const wallC = (x: number, z: number, hx: number, hz: number) => { const b = staticBox(V3(cx + x, y0 + H / 2, cz + z), V3(hx, H / 2, hz)); SEE_THROUGH.add(b.collider(0).handle); };
  wallC(0, -D / 2, W / 2, 0.06); wallC(0, D / 2, W / 2, 0.06); wallC(-W / 2, 0, 0.06, D / 2);
  wallC(W / 2, -(D / 2 + 0.9) / 2, 0.06, (D / 2 - 0.9) / 2); wallC(W / 2, (D / 2 + 0.9) / 2, 0.06, (D / 2 - 0.9) / 2);
  staticBox(V3(cx, y0 + H + R / 2, cz), V3(W / 2, 0.05, D / 2 + 0.1));
  // two potting tables with flower pots (smash them!) + bags of soil
  for (const tz of [-1.6, 1.6]) {
    mesh(g, new THREE.BoxGeometry(6.4, 0.08, 1.0), 0x9a6a3c, -0.6, 0.78, tz);
    for (const lx of [-3.6, 2.4]) for (const lz of [-0.4, 0.4]) mesh(g, new THREE.BoxGeometry(0.08, 0.78, 0.08), 0x6e4524, lx, 0.39, tz + lz);
    staticBox(V3(cx - 0.6, y0 + 0.78, cz + tz), V3(3.2, 0.04, 0.5));
    for (let k = 0; k < 4; k++) c.prop('flowerPot', cx - 3.2 + k * 1.6, cz + tz, 0, 0.82);
  }
  t.noGrass({ x0: cx - W / 2 - 0.5, x1: cx + W / 2 + 0.5, z0: cz - D / 2 - 0.5, z1: cz + D / 2 + 0.5 });
  blocked.push({ x0: cx - W / 2 - 2, x1: cx + W / 2 + 2, z0: cz - D / 2 - 2, z1: cz + D / 2 + 2 });
}
