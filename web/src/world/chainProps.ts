import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonMat } from '../render/toon';

/**
 * Procedural models of the chain modes (farm 6: cannabis, farm 7: beer). Cartoon: fat shapes, toon colours,
 * shared geometry + materials. Plants are baked into one vertex-coloured mesh per growth stage (cheap to draw).
 */
const mats = new Map<number, THREE.MeshToonMaterial>();
const M = (c: number, e = 0) => { const k = c * 7 + e; let m = mats.get(k); if (!m) { m = toonMat(c, e ? { emissive: new THREE.Color(e) } : {}); mats.set(k, m); } return m; };
function add(g: THREE.Object3D, geo: THREE.BufferGeometry, c: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, name = '') {
  const m = new THREE.Mesh(geo, M(c)); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true;
  if (name) m.name = name;
  g.add(m); return m;
}

// ------------------------------------------------------------------ cannabis plants (baked per stage)
/** One serrated leaflet (flat), pointing +y. */
function leaflet(len: number, wid: number) {
  const s = new THREE.Shape(), n = 7;
  s.moveTo(0, 0);
  for (let i = 1; i <= n; i++) { const t = i / n, w = Math.sin(t * Math.PI) * wid * (1 - t * 0.35); s.lineTo(w * (i % 2 ? 1.18 : 0.86), t * len); }
  for (let i = n - 1; i >= 1; i--) { const t = i / n, w = Math.sin(t * Math.PI) * wid * (1 - t * 0.35); s.lineTo(-w * (i % 2 ? 1.18 : 0.86), t * len); }
  s.lineTo(0, 0);
  return new THREE.ShapeGeometry(s);
}
const VCOL = toonMat(0xffffff, { vertexColors: true, side: THREE.DoubleSide });
type Part = [THREE.BufferGeometry, number, THREE.Matrix4];
function bake(parts: Part[]) {
  const gs = parts.map(([g, c, m]) => {
    const x = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(m);
    for (const k of Object.keys(x.attributes)) if (k !== 'position' && k !== 'normal') x.deleteAttribute(k);
    if (!x.attributes.normal) x.computeVertexNormals();
    const col = new THREE.Color(c), n = x.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
    x.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return x;
  });
  return mergeGeometries(gs)!;
}
const mtx = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(s, s, s));
const LEAF = [leaflet(0.44, 0.08), leaflet(0.34, 0.065), leaflet(0.22, 0.05)];
const STEM = new THREE.CylinderGeometry(0.018, 0.03, 1, 6);
const BUD = new THREE.IcosahedronGeometry(0.07, 0);
const HAIR = new THREE.IcosahedronGeometry(0.018, 0);
/** A fan leaf (7 leaflets) on a petiole, at (x, y, z) facing yaw, tilted down `tilt`. */
function fan(parts: Part[], x: number, y: number, z: number, yaw: number, tilt: number, s: number, c: number) {
  const base = mtx(x, y, z, 0, yaw, 0);
  const ang = [0, 0.42, -0.42, 0.85, -0.85, 1.3, -1.3], li = [0, 0, 0, 1, 1, 2, 2];
  for (let i = 0; i < 7; i++) {
    const m = base.clone().multiply(mtx(0, 0, 0, -Math.PI / 2 + tilt, 0, ang[i], s));
    parts.push([LEAF[li[i]], c, m]);
  }
}
/** Stage 0 seedling · 1 small · 2 bushy · 3 flowering (ripe: fat buds). */
export function plantGeometry(stage: 0 | 1 | 2 | 3) {
  const parts: Part[] = [];
  const h = [0.32, 0.8, 1.25, 1.55][stage], G1 = 0x4fae3c, G2 = 0x66c84a, G3 = 0x3f9434;
  parts.push([STEM, 0x5c8a2e, mtx(0, h / 2, 0).multiply(new THREE.Matrix4().makeScale(1, h, 1))]);
  const nodes = [1, 3, 5, 6][stage];
  for (let i = 0; i < nodes; i++) {
    const y = h * (0.3 + 0.65 * (i / Math.max(1, nodes - 1))) * (stage === 0 ? 0.9 : 1), s = (stage === 0 ? 0.6 : 1.3 - (i / nodes) * 0.5);
    for (let k = 0; k < (stage >= 2 ? 3 : 2); k++) fan(parts, 0, y, 0, i * 1.57 + k * (stage >= 2 ? 2.09 : Math.PI), 0.55, s, i % 2 ? G1 : G2);
    if (stage >= 2 && i > 0) for (let k = 0; k < 2; k++) {   // side branches
      const a = i * 1.57 + 0.78 + k * Math.PI, bx = Math.sin(a) * 0.12, bz = Math.cos(a) * 0.12;
      fan(parts, bx, y + 0.06, bz, a, 0.35, s * 0.6, G3);
    }
  }
  if (stage === 3) {   // buds: fat green-purple colas with orange hairs (the ripe sign)
    const tops = [[0, h + 0.04, 0, 1.4], [0.13, h * 0.78, 0.05, 1], [-0.12, h * 0.7, -0.06, 1], [0.05, h * 0.55, -0.13, 0.9]] as const;
    for (const [x, y, z, s] of tops) {
      for (let k = 0; k < 5; k++) parts.push([BUD, k % 2 ? 0x8fcf5a : 0x9a7bc8, mtx(x + Math.sin(k * 2.4) * 0.04 * s, y - k * 0.05 * s, z + Math.cos(k * 2.4) * 0.04 * s, k, k, 0, s * (1 - k * 0.1))]);
      for (let k = 0; k < 6; k++) parts.push([HAIR, 0xff9a3a, mtx(x + Math.sin(k * 1.9) * 0.07 * s, y - k * 0.035 * s, z + Math.cos(k * 1.9) * 0.07 * s)]);
    }
  }
  return bake(parts);
}
export const plantMaterial = () => VCOL;

/** Wheat (farm 7): a clump of stalks with golden ears; cut = short stubble. */
export function wheatGeometry(cut: boolean) {
  const parts: Part[] = [], stalk = new THREE.CylinderGeometry(0.008, 0.012, 1, 4), ear = new THREE.CapsuleGeometry(0.03, 0.12, 2, 5);
  for (let i = 0; i < 16; i++) {
    const a = i * 2.39, r = 0.12 + (i % 4) * 0.08, x = Math.sin(a) * r, z = Math.cos(a) * r, h = cut ? 0.14 : 0.95 + (i % 3) * 0.12, lean = 0.08 * Math.sin(i);
    parts.push([stalk, cut ? 0xc9a24a : 0xd9b04a, mtx(x, h / 2, z, lean, 0, -lean).multiply(new THREE.Matrix4().makeScale(1, h, 1))]);
    if (!cut) parts.push([ear, 0xf2c94c, mtx(x + lean * 0.5, h + 0.06, z, lean, a, -lean)]);
  }
  return bake(parts);
}

// ------------------------------------------------------------------ props (make() functions for PropDefs)
export function makeBud() {
  const g = new THREE.Group();
  for (let k = 0; k < 6; k++) add(g, BUD, k % 2 ? 0x8fcf5a : 0x9a7bc8, Math.sin(k * 2.4) * 0.05, 0.07 + k * 0.025, Math.cos(k * 2.4) * 0.05, k, k);
  for (let k = 0; k < 5; k++) add(g, HAIR, 0xff9a3a, Math.sin(k * 1.9) * 0.08, 0.1 + k * 0.02, Math.cos(k * 1.9) * 0.08);
  return g;
}
export function makeWeedBag() {
  const g = new THREE.Group();
  add(g, new THREE.BoxGeometry(0.22, 0.16, 0.07), 0xd8f0d0, 0, 0.08, 0);
  add(g, new THREE.BoxGeometry(0.19, 0.1, 0.075), 0x6fae3e, 0, 0.065, 0);       // the green stuff inside
  add(g, new THREE.BoxGeometry(0.23, 0.02, 0.08), 0x3f9ad8, 0, 0.165, 0);       // zip
  return g;
}
export function makeJoint() {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.02, 0.013, 0.2, 8), 0xfff6e6, 0, 0, 0, 0, 0, Math.PI / 2);
  add(g, new THREE.CylinderGeometry(0.0135, 0.0135, 0.035, 8), 0xe8c48a, -0.11, 0, 0, 0, 0, Math.PI / 2);   // filter tip
  const ember = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), toonMat(0x7a6a5a, { emissive: new THREE.Color(0) }));
  ember.name = 'ember'; ember.position.set(0.1, 0, 0); g.add(ember);
  return g;
}
export function makeLighter() {
  const g = new THREE.Group();
  add(g, new THREE.BoxGeometry(0.06, 0.11, 0.03), 0xff4a6a, 0, 0.055, 0);
  add(g, new THREE.BoxGeometry(0.06, 0.03, 0.032), 0xc9ced8, 0, 0.125, 0);
  add(g, new THREE.CylinderGeometry(0.008, 0.008, 0.03, 8), 0x8a8f99, 0.016, 0.13, 0, 0, 0, Math.PI / 2);
  return g;
}
export function makeWateringCan() {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.17, 0.19, 0.3, 14), 0x5fb3e8, 0, 0.15, 0);
  add(g, new THREE.CylinderGeometry(0.02, 0.035, 0.42, 8), 0x5fb3e8, 0, 0.27, 0.27, 0.9, 0, 0);
  add(g, new THREE.CylinderGeometry(0.06, 0.03, 0.05, 10), 0x4a9ad0, 0, 0.42, 0.45, 0.9, 0, 0);
  add(g, new THREE.TorusGeometry(0.13, 0.022, 6, 12, Math.PI), 0x4a9ad0, 0, 0.3, -0.05, 0, Math.PI / 2, 0);
  return g;
}
export function makeSeedBag() {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.11, 0.14, 0.24, 10), 0xd9c08a, 0, 0.12, 0);
  add(g, new THREE.ConeGeometry(0.08, 0.08, 10), 0xd9c08a, 0, 0.27, 0);
  add(g, new THREE.TorusGeometry(0.075, 0.012, 5, 12), 0x8a5a2a, 0, 0.245, 0, Math.PI / 2);
  add(g, new THREE.BoxGeometry(0.1, 0.08, 0.01), 0x5cb83d, 0, 0.13, 0.135);
  return g;
}
export function makeSickle() {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.025, 0.03, 0.32, 8), 0x8a5a2a, 0, 0.16, 0);
  add(g, new THREE.TorusGeometry(0.16, 0.022, 4, 14, Math.PI * 1.2), 0xcfd6de, 0.1, 0.34, 0, 0, Math.PI / 2, 0.5);
  return g;
}
export function makeButter(magic = false) {
  const g = new THREE.Group();
  if (!magic) { add(g, new THREE.BoxGeometry(0.2, 0.08, 0.1), 0xffe27a, 0, 0.04, 0); add(g, new THREE.BoxGeometry(0.12, 0.085, 0.105), 0xf4f0e6, 0.05, 0.04, 0); return g; }
  add(g, new THREE.CylinderGeometry(0.1, 0.1, 0.16, 14), 0xc7dca0, 0, 0.08, 0);       // jar of green butter
  add(g, new THREE.CylinderGeometry(0.105, 0.105, 0.04, 14), 0xd8342c, 0, 0.18, 0);
  add(g, new THREE.BoxGeometry(0.1, 0.06, 0.01), 0x5cb83d, 0, 0.09, 0.1);
  return g;
}
export function makeSack(color = 0xf4efe4, band = 0xc9a24a, w = 0.34, h = 0.42) {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(w * 0.42, w * 0.5, h, 10), color, 0, h / 2, 0);
  add(g, new THREE.SphereGeometry(w * 0.42, 10, 6), color, 0, h, 0);
  add(g, new THREE.TorusGeometry(w * 0.2, 0.02, 5, 12), band, 0, h + 0.06, 0, Math.PI / 2);
  add(g, new THREE.ConeGeometry(w * 0.18, 0.1, 8), color, 0, h + 0.13, 0);
  return g;
}
const COOKIE = new THREE.CylinderGeometry(0.05, 0.055, 0.025, 12);
const DOUGH = new THREE.SphereGeometry(0.045, 10, 6);
/** Baking tray: 'raw' dough balls, golden 'baked' cookies or 'burnt' ones. */
export function makeTray(kind: 'raw' | 'baked' | 'burnt') {
  const g = new THREE.Group();
  add(g, new THREE.BoxGeometry(0.46, 0.025, 0.34), 0x9aa3ad, 0, 0.012, 0);
  add(g, new THREE.BoxGeometry(0.48, 0.035, 0.02), 0x8a929c, 0, 0.03, 0.17); add(g, new THREE.BoxGeometry(0.48, 0.035, 0.02), 0x8a929c, 0, 0.03, -0.17);
  for (let i = 0; i < 6; i++) {
    const x = -0.14 + (i % 3) * 0.14, z = i < 3 ? -0.075 : 0.075;
    if (kind === 'raw') add(g, DOUGH, 0xf2dcae, x, 0.05, z, 0, 0, 0).scale.set(1, 0.65, 1);
    else { add(g, COOKIE, kind === 'baked' ? 0xd9a35a : 0x3a2a1e, x, 0.04, z); if (kind === 'baked') add(g, HAIR, 0x5cb83d, x + 0.015, 0.055, z); }
  }
  return g;
}
export function makeWheelbarrow() {
  const g = new THREE.Group();
  // tub (open box), wheel at the front, two handles at the back
  add(g, new THREE.BoxGeometry(0.72, 0.05, 1.0), 0x3f8f5a, 0, 0.36, 0);
  add(g, new THREE.BoxGeometry(0.06, 0.3, 1.0), 0x3f8f5a, -0.36, 0.5, 0, 0, 0, -0.18); add(g, new THREE.BoxGeometry(0.06, 0.3, 1.0), 0x3f8f5a, 0.36, 0.5, 0, 0, 0, 0.18);
  add(g, new THREE.BoxGeometry(0.78, 0.3, 0.06), 0x3f8f5a, 0, 0.5, 0.5, -0.25, 0, 0); add(g, new THREE.BoxGeometry(0.72, 0.28, 0.06), 0x3f8f5a, 0, 0.5, -0.5, 0.2, 0, 0);
  add(g, new THREE.CylinderGeometry(0.2, 0.2, 0.09, 14), 0x2b2b30, 0, 0.2, 0.62, 0, 0, Math.PI / 2);
  add(g, new THREE.CylinderGeometry(0.08, 0.08, 0.1, 10), 0xc9ced8, 0, 0.2, 0.62, 0, 0, Math.PI / 2);
  for (const s of [-1, 1]) {
    add(g, new THREE.BoxGeometry(0.05, 0.05, 1.5), 0x8a5a2a, s * 0.3, 0.33, -0.1, 0.12, 0, 0);
    add(g, new THREE.BoxGeometry(0.04, 0.3, 0.04), 0x5c5f66, s * 0.3, 0.17, -0.35);
  }
  // cargo pile (scaled by how much is in it; hidden when empty)
  const pile = new THREE.Group(); pile.name = 'cargo'; pile.position.set(0, 0.4, 0); g.add(pile);
  for (let k = 0; k < 9; k++) add(pile, BUD, k % 2 ? 0x8fcf5a : 0x6fae3e, Math.sin(k * 2.4) * 0.2, 0.06 + (k % 3) * 0.05, Math.cos(k * 2.4) * 0.3, k, k).scale.setScalar(1.6);
  return g;
}
export function makeHops() {
  const g = new THREE.Group(), cone = new THREE.ConeGeometry(0.045, 0.1, 6);
  for (let k = 0; k < 5; k++) add(g, cone, 0x9fd36a, Math.sin(k * 1.3) * 0.05, 0.06 + (k % 2) * 0.03, Math.cos(k * 1.3) * 0.05, Math.PI, k, 0.3);
  add(g, new THREE.BoxGeometry(0.12, 0.012, 0.05), 0x4fa636, 0, 0.13, 0, 0, 0, 0.4);
  return g;
}
export function makeSheaf() {
  const g = new THREE.Group(), stalk = new THREE.CylinderGeometry(0.012, 0.012, 0.6, 4), ear = new THREE.CapsuleGeometry(0.025, 0.08, 2, 5);
  for (let i = 0; i < 12; i++) {
    const a = i * 2.39, r = 0.03 + (i % 3) * 0.03, sp = 0.18;
    add(g, stalk, 0xd9b04a, Math.sin(a) * r, 0.3, Math.cos(a) * r, Math.cos(a) * sp, 0, Math.sin(a) * sp);
    add(g, ear, 0xf2c94c, Math.sin(a) * (r + 0.06), 0.62, Math.cos(a) * (r + 0.06), Math.cos(a) * sp, 0, Math.sin(a) * sp);
  }
  add(g, new THREE.TorusGeometry(0.08, 0.018, 5, 12), 0x8a5a2a, 0, 0.3, 0, Math.PI / 2);
  return g;
}
export function makeMug(full: boolean) {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.075, 0.07, 0.17, 14), 0xd8e8ee, 0, 0.085, 0);
  if (full) { add(g, new THREE.CylinderGeometry(0.068, 0.064, 0.15, 14), 0xffb42a, 0, 0.08, 0); add(g, new THREE.SphereGeometry(0.078, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0xfffaf0, 0, 0.165, 0); }
  add(g, new THREE.TorusGeometry(0.05, 0.015, 6, 12), 0xd8e8ee, 0.085, 0.09, 0, 0, 0, Math.PI / 2);
  return g;
}
/** Bob's beer barrel (rolls; a tap on the front). */
export function makeBeerBarrel() {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.34, 0.34, 0.75, 16), 0xa86a32, 0, 0, 0, 0, 0, Math.PI / 2);
  add(g, new THREE.CylinderGeometry(0.38, 0.38, 0.12, 16), 0xb5793d, 0, 0, 0, 0, 0, Math.PI / 2);
  for (const x of [-0.28, 0.28]) add(g, new THREE.CylinderGeometry(0.355, 0.355, 0.04, 16), 0x5c5f66, x, 0, 0, 0, 0, Math.PI / 2);
  add(g, new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8), 0xc9a24a, 0.4, -0.12, 0, 0, 0, Math.PI / 2);
  add(g, new THREE.BoxGeometry(0.03, 0.08, 0.03), 0xc9a24a, 0.46, -0.08, 0);
  add(g, new THREE.CylinderGeometry(0.045, 0.045, 0.05, 8), 0xe8d6b0, 0, 0.36, 0, 0, 0, 0).name = 'cork';
  return g;
}
/** A big floating hallucination (only high / drunk pigs see them): a sprinkled rainbow doughnut. */
export function makeVision(i: number) {
  const g = new THREE.Group();
  const cols = [0xff6fa8, 0xffd166, 0x8be04e, 0x4fd8ff, 0xb57bff];
  if (i % 2 === 0) {
    const d = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.2, 12, 24), toonMat(0xe8b06a, { emissive: new THREE.Color(0x553311) })); g.add(d);
    const icing = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.205, 12, 24, Math.PI * 2), toonMat(cols[i % 5], { emissive: new THREE.Color(cols[i % 5]).multiplyScalar(0.5) }));
    icing.scale.set(1, 1, 0.6); icing.position.z = 0.06; g.add(icing);
    for (let k = 0; k < 14; k++) { const a = k * 0.45; const s = new THREE.Mesh(new THREE.CapsuleGeometry(0.015, 0.06, 2, 4), M(cols[k % 5])); s.position.set(Math.cos(a) * 0.42, Math.sin(a) * 0.42, 0.2); s.rotation.z = k; g.add(s); }
  } else {
    // a glowing pink elephant head (balloon-ish)
    const pink = toonMat(0xff9ad2, { emissive: new THREE.Color(0x662244) });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), pink); g.add(head);
    for (const s of [-1, 1]) { const ear = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), pink); ear.scale.set(0.3, 1, 1); ear.position.set(s * 0.42, 0.05, -0.05); g.add(ear); }
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 0.55, 8), pink); trunk.position.set(0, -0.3, 0.32); trunk.rotation.x = 0.9; g.add(trunk);
    for (const s of [-1, 1]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), M(0x1a1a1a)); eye.position.set(s * 0.15, 0.12, 0.37); g.add(eye); }
  }
  g.traverse((o) => { o.castShadow = false; });
  return g;
}
