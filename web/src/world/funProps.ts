import * as THREE from 'three';
import { toonMat } from '../render/toon';

/**
 * Small procedural props for the pranks (cartoon, shared geometry + materials so `rigidSkin` / instancing stay cheap):
 * an egg, Bob's garden gnome, Bob's heart-print underpants and the pie cooling on his porch.
 */
const mats = new Map<number, THREE.MeshToonMaterial>();
const M = (c: number) => { let m = mats.get(c); if (!m) { m = toonMat(c); mats.set(c, m); } return m; };
function add(g: THREE.Object3D, geo: THREE.BufferGeometry, c: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, M(c)); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
}

const EGG = new THREE.SphereGeometry(0.07, 14, 10).scale(1, 1.3, 1);
export function makeEgg() { const g = new THREE.Group(); add(g, EGG, 0xfff4e0, 0, 0.09, 0); return g; }

/** Goofy garden gnome: big red hat, huge white beard, round pink nose, little blue body. */
export function makeGnome() {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.13, 0.16, 0.26, 12), 0x3d6fd1, 0, 0.13, 0);                 // body
  add(g, new THREE.CylinderGeometry(0.165, 0.165, 0.05, 12), 0x5a3a1e, 0, 0.2, 0);                 // belt
  add(g, new THREE.BoxGeometry(0.06, 0.045, 0.02), 0xffd166, 0, 0.2, 0.165);                       // buckle
  add(g, new THREE.SphereGeometry(0.13, 14, 10), 0xffc9a8, 0, 0.36, 0.01);                         // head
  add(g, new THREE.ConeGeometry(0.15, 0.28, 12, 1, true), 0xffffff, 0, 0.27, 0.06, Math.PI, 0, 0).scale.set(1, 1, 0.8);   // beard
  add(g, new THREE.SphereGeometry(0.045, 10, 8), 0xff8fa0, 0, 0.36, 0.13);                          // nose
  for (const s of [-1, 1]) add(g, new THREE.SphereGeometry(0.028, 8, 6), 0x222222, s * 0.05, 0.4, 0.115);   // eyes
  const hat = add(g, new THREE.ConeGeometry(0.15, 0.36, 14), 0xd8342c, 0, 0.6, -0.02);              // hat
  hat.rotation.x = -0.25;
  for (const s of [-1, 1]) add(g, new THREE.SphereGeometry(0.05, 8, 6), 0x2a2a2a, s * 0.08, 0.02, 0.04);   // boots
  return g;
}

/** Bob's underpants: white boxers with red hearts. */
export function makeUndies() {
  const g = new THREE.Group();
  const W = 0xfaf6ef, R = 0xe0344a;
  add(g, new THREE.BoxGeometry(0.42, 0.16, 0.08), W, 0, 0.2, 0);                                   // seat
  add(g, new THREE.BoxGeometry(0.44, 0.05, 0.09), 0x7fb3e6, 0, 0.3, 0);                            // waistband
  for (const s of [-1, 1]) add(g, new THREE.BoxGeometry(0.19, 0.16, 0.08), W, s * 0.115, 0.07, 0, 0, 0, s * 0.12);   // legs
  const heart = new THREE.SphereGeometry(0.03, 8, 6);
  for (const [x, y] of [[-0.12, 0.2], [0.05, 0.24], [0.14, 0.14], [-0.08, 0.08], [0.1, 0.05]] as const) { add(g, heart, R, x, y, 0.045); add(g, heart, R, -x, y, -0.045); }
  return g;
}

/** A fresh pie: tin, golden crust with a lattice, steam is left to the imagination. */
export function makePie() {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.2, 0.17, 0.07, 18), 0xb9c0c8, 0, 0.035, 0);
  add(g, new THREE.CylinderGeometry(0.2, 0.2, 0.05, 18), 0xe0a85a, 0, 0.085, 0);
  add(g, new THREE.TorusGeometry(0.19, 0.025, 6, 20), 0xc98a3c, 0, 0.11, 0, Math.PI / 2);
  for (let i = -1; i <= 1; i++) {
    add(g, new THREE.BoxGeometry(0.36, 0.015, 0.03), 0xc98a3c, 0, 0.115, i * 0.09);
    add(g, new THREE.BoxGeometry(0.03, 0.015, 0.36), 0xc98a3c, i * 0.09, 0.118, 0);
  }
  add(g, new THREE.CylinderGeometry(0.17, 0.17, 0.01, 18), 0x8a1f3a, 0, 0.108, 0);                // cherry filling
  return g;
}

/** Terracotta flower pot with a flower (breakable). */
export function makeFlowerPot(c = 0xff6fa8) {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.16, 0.11, 0.24, 12), 0xc8673a, 0, 0.12, 0);
  add(g, new THREE.CylinderGeometry(0.175, 0.175, 0.05, 12), 0xd77a4a, 0, 0.235, 0);
  add(g, new THREE.CylinderGeometry(0.15, 0.15, 0.02, 12), 0x4a2f18, 0, 0.25, 0);
  add(g, new THREE.CylinderGeometry(0.012, 0.012, 0.22, 5), 0x3f9a3a, 0, 0.35, 0);
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; add(g, new THREE.SphereGeometry(0.045, 8, 6), c, Math.cos(a) * 0.05, 0.47, Math.sin(a) * 0.05); }
  add(g, new THREE.SphereGeometry(0.035, 8, 6), 0xffd166, 0, 0.475, 0);
  for (const s of [-1, 1]) add(g, new THREE.SphereGeometry(0.04, 8, 6), 0x4fb848, s * 0.05, 0.33, 0).scale.set(1.4, 0.4, 0.8);
  return g;
}

/** An apple (orchard, farm 2): falls when you shake the tree. `gold` = the one golden apple. */
const APPLE = new THREE.SphereGeometry(0.11, 14, 10).scale(1, 0.92, 1);
const STALK = new THREE.CylinderGeometry(0.008, 0.01, 0.06, 5);
const LEAF = new THREE.SphereGeometry(0.035, 8, 5).scale(1.6, 0.25, 0.8);
export function makeApple(gold = false) {
  const g = new THREE.Group();
  add(g, APPLE, gold ? 0xffcf3a : 0xe0302c, 0, 0.1, 0);
  add(g, STALK, 0x5a3a1e, 0, 0.22, 0, 0, 0, 0.2);
  add(g, LEAF, gold ? 0xfff2a8 : 0x4fa636, 0.04, 0.22, 0, 0, 0, -0.3);
  return g;
}

/** Jar of honey: amber glass, cloth lid tied with string (farm 2's honey stand). */
export function makeHoneyJar() {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.1, 0.1, 0.2, 14), 0xf0a21e, 0, 0.1, 0);
  add(g, new THREE.CylinderGeometry(0.075, 0.09, 0.03, 14), 0xf6c04a, 0, 0.215, 0);
  add(g, new THREE.CylinderGeometry(0.115, 0.1, 0.035, 14), 0xe8d6b0, 0, 0.24, 0);                 // cloth
  add(g, new THREE.TorusGeometry(0.093, 0.008, 5, 16), 0xb0453a, 0, 0.225, 0, Math.PI / 2);         // string
  add(g, new THREE.BoxGeometry(0.11, 0.07, 0.01), 0xfff4d6, 0, 0.1, 0.1);                          // label
  return g;
}

/** Bob's prize honey pot: a fat golden pot with a dipper, honey dripping over the rim. */
export function makeHoneyPot() {
  const g = new THREE.Group();
  add(g, new THREE.SphereGeometry(0.2, 18, 12).scale(1, 0.85, 1), 0xd98a1a, 0, 0.18, 0);
  add(g, new THREE.CylinderGeometry(0.13, 0.15, 0.08, 16), 0xd98a1a, 0, 0.34, 0);
  add(g, new THREE.TorusGeometry(0.13, 0.025, 6, 18), 0xb86d10, 0, 0.38, 0, Math.PI / 2);
  for (let i = 0; i < 5; i++) {   // drips
    const a = i * 1.3;
    add(g, new THREE.CapsuleGeometry(0.022, 0.07 + (i % 2) * 0.05, 4, 6), 0xffb52e, Math.cos(a) * 0.14, 0.31 - (i % 2) * 0.03, Math.sin(a) * 0.14);
  }
  add(g, new THREE.CylinderGeometry(0.015, 0.015, 0.34, 6), 0x9a6a3c, 0.05, 0.45, 0, 0, 0, -0.3);  // dipper
  add(g, new THREE.SphereGeometry(0.04, 8, 6).scale(1, 1.4, 1), 0x9a6a3c, 0.0, 0.3, 0);
  add(g, new THREE.BoxGeometry(0.12, 0.08, 0.01), 0xfff4d6, 0, 0.2, 0.19);
  return g;
}

/** A jug of fresh cider (comes out of the press). */
export function makeCiderJug() {
  const g = new THREE.Group();
  add(g, new THREE.SphereGeometry(0.17, 16, 12).scale(1, 1.1, 1), 0xc8853a, 0, 0.18, 0);
  add(g, new THREE.CylinderGeometry(0.05, 0.08, 0.12, 12), 0xc8853a, 0, 0.38, 0);
  add(g, new THREE.CylinderGeometry(0.04, 0.04, 0.05, 8), 0x8a5a35, 0, 0.46, 0);                   // cork
  add(g, new THREE.TorusGeometry(0.06, 0.018, 6, 12, Math.PI * 1.2), 0xc8853a, 0.1, 0.33, 0, 0, 0, -0.9);   // handle
  add(g, new THREE.BoxGeometry(0.14, 0.1, 0.01), 0xfff4d6, 0, 0.18, 0.17);
  return g;
}

// ---------------------------------------------------------------- farm 3 (dairy & cheese)
/** A dented old milk churn (full: spill it by knocking it over). */
export function makeMilkChurn() {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.17, 0.19, 0.42, 16), 0xb9c4cc, 0, 0.21, 0);
  add(g, new THREE.CylinderGeometry(0.1, 0.17, 0.12, 16), 0xb9c4cc, 0, 0.48, 0);           // shoulder
  add(g, new THREE.CylinderGeometry(0.1, 0.1, 0.1, 14), 0xa6b2ba, 0, 0.59, 0);              // neck
  add(g, new THREE.CylinderGeometry(0.12, 0.12, 0.04, 14), 0x8e9aa3, 0, 0.65, 0);            // lid
  add(g, new THREE.SphereGeometry(0.035, 8, 6), 0x8e9aa3, 0, 0.69, 0);
  for (const s of [-1, 1]) add(g, new THREE.TorusGeometry(0.05, 0.014, 6, 10, Math.PI), 0x8e9aa3, s * 0.15, 0.5, 0, 0, Math.PI / 2, 0);   // handles
  add(g, new THREE.TorusGeometry(0.19, 0.012, 6, 24), 0x8e9aa3, 0, 0.03, 0, Math.PI / 2);   // rims
  add(g, new THREE.TorusGeometry(0.18, 0.012, 6, 24), 0x8e9aa3, 0, 0.3, 0, Math.PI / 2);
  add(g, new THREE.BoxGeometry(0.16, 0.1, 0.01), 0xfff4d6, 0, 0.2, 0.185);                    // label
  return g;
}

/**
 * A wheel of cheese standing on its edge (it rolls!): waxed rind, a cut wedge on the prize one + a blue ribbon.
 * The geometry's axis is x (a 'wheel' prop: the collider is a cylinder lying along x).
 */
export function makeCheeseWheel(prize = false) {
  const g = new THREE.Group();
  const r = prize ? 0.62 : 0.34, w = prize ? 0.42 : 0.2;
  const rind = prize ? 0xe8a417 : 0xf3c23a, wax = prize ? 0xc22d2d : 0xf0d36b;
  add(g, new THREE.CylinderGeometry(r, r, w, 28), rind, 0, r, 0, 0, 0, Math.PI / 2);
  add(g, new THREE.CylinderGeometry(r * 0.94, r * 0.94, w * 1.03, 28), 0xffdf6e, 0, r, 0, 0, 0, Math.PI / 2);   // the paler face
  add(g, new THREE.TorusGeometry(r * 0.97, 0.025 * (prize ? 1.6 : 1), 6, 30), wax, w / 2, r, 0, 0, Math.PI / 2, 0);
  add(g, new THREE.TorusGeometry(r * 0.97, 0.025 * (prize ? 1.6 : 1), 6, 30), wax, -w / 2, r, 0, 0, Math.PI / 2, 0);
  // holes (dark dots on both faces)
  for (let i = 0; i < (prize ? 9 : 5); i++) {
    const a = i * 2.39, d = r * (0.25 + ((i * 37) % 10) / 16);
    for (const s of [-1, 1]) add(g, new THREE.CircleGeometry(r * 0.07 * (1 + (i % 3) * 0.3), 10), 0xd9a62c, s * (w / 2 + 0.017), r + Math.sin(a) * d * 0.9, Math.cos(a) * d * 0.9, 0, (s * Math.PI) / 2, 0);
  }
  if (prize) {   // blue-ribbon rosette on the face
    add(g, new THREE.CircleGeometry(0.16, 16), 0x2f6fd6, w / 2 + 0.03, r + 0.12, 0, 0, Math.PI / 2, 0);
    add(g, new THREE.CircleGeometry(0.08, 12), 0xffd166, w / 2 + 0.035, r + 0.12, 0, 0, Math.PI / 2, 0);
    for (const s of [-1, 1]) add(g, new THREE.BoxGeometry(0.01, 0.2, 0.06), 0x2f6fd6, w / 2 + 0.03, r - 0.05, s * 0.05, s * 0.3, 0, 0);
  }
  return g;
}

/** Red rag on a stick (a matador's cape): the bull charges whoever waves it. */
export function makeRedRag() {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.018, 0.018, 0.9, 6), 0x8a5a35, 0, 0.45, 0, 0, 0, Math.PI / 2);
  const cloth = new THREE.PlaneGeometry(0.62, 0.5, 6, 4);
  const pa = cloth.attributes.position;
  for (let i = 0; i < pa.count; i++) pa.setZ(i, Math.sin(pa.getX(i) * 9) * 0.04);
  cloth.computeVertexNormals();
  add(g, cloth, 0xd11f2a, 0.05, 0.22, 0);
  add(g, cloth, 0xd11f2a, 0.05, 0.22, 0, 0, Math.PI, 0);   // the back (single-sided materials)
  return g;
}

/** Farm 4's giant prize pumpkin (county-fair winner): a KayKit pumpkin blown up, with a blue-ribbon rosette. */
export function makeGiantPumpkin(fit: (model: string, h: number) => THREE.Object3D) {
  const g = new THREE.Group();
  const p = fit('kaykit/pumpkin_orange', 2); g.add(p);
  // rosette on its front (+z), a bit above the middle
  add(g, new THREE.CircleGeometry(0.24, 16), 0x2f6fd6, 0, 1.2, 1.12, -0.15, 0, 0);
  add(g, new THREE.CircleGeometry(0.12, 12), 0xffd166, 0, 1.2, 1.135, -0.15, 0, 0);
  for (const s of [-1, 1]) add(g, new THREE.BoxGeometry(0.1, 0.34, 0.01), 0x2f6fd6, s * 0.08, 0.9, 1.15, -0.2, 0, s * 0.3);
  return g;
}

// ---------------------------------------------------------------- farm 5 (winter)
const SNOW = 0xf6f9ff, COAL = 0x26232a;
const LUMP = new THREE.IcosahedronGeometry(1, 2);
/** A lumpy ball of packed snow (radius r, sitting on y = 0). */
function snowLump(g: THREE.Group, r: number, y: number, sq = 1) {
  const m = add(g, LUMP, SNOW, 0, y, 0); m.scale.set(r, r * sq, r); return m;
}
/** A snowball to throw (smashes into powder on a hit). */
export function makeSnowball() { const g = new THREE.Group(); snowLump(g, 0.13, 0.13); return g; }
/** A snowball to roll: it grows as it rolls over fresh snow (world/winter.ts scales it). */
export function makeSnowBoulder() {
  const g = new THREE.Group(); snowLump(g, 0.42, 0.42);
  for (let i = 0; i < 5; i++) {   // a few clumps stuck on it (shows it turning)
    const a = i * 2.4, b = (i % 3) * 0.9 - 0.9, m = add(g, LUMP, 0xe2ebf7, Math.cos(a) * 0.36 * Math.cos(b), 0.42 + Math.sin(b) * 0.36, Math.sin(a) * 0.36 * Math.cos(b));
    m.scale.setScalar(0.1);
  }
  return g;
}
/** A wrapped present: box + ribbon cross + a bow on top. */
export function makePresent(w: number, h: number, d: number, box: number, ribbon: number) {
  const g = new THREE.Group();
  add(g, new THREE.BoxGeometry(w, h, d), box, 0, h / 2, 0);
  add(g, new THREE.BoxGeometry(w * 0.16, h + 0.01, d + 0.01), ribbon, 0, h / 2, 0);
  add(g, new THREE.BoxGeometry(w + 0.01, h + 0.01, d * 0.16), ribbon, 0, h / 2, 0);
  const loop = new THREE.TorusGeometry(Math.min(w, d) * 0.16, Math.min(w, d) * 0.045, 6, 14);
  for (const s of [-1, 1]) add(g, loop, ribbon, s * Math.min(w, d) * 0.14, h + Math.min(w, d) * 0.12, 0, 0, s * 0.5, 0);
  return g;
}
/** Bob's prize snowman (the static one standing in the yard): 3 balls, coal face, carrot nose, stick arms, scarf, top hat. */
export const SNOWMAN = { base: 0.62, mid: 0.45, head: 0.33, yBase: 0.56, yMid: 1.36, yHead: 1.98 };
function snowmanHead(g: THREE.Group, y: number) {
  const r = SNOWMAN.head;
  snowLump(g, r, y);
  for (const s of [-1, 1]) add(g, new THREE.SphereGeometry(0.045, 8, 6), COAL, s * 0.11, y + 0.09, r * 0.88);
  add(g, new THREE.ConeGeometry(0.05, 0.3, 10), 0xff7a1f, 0, y, r + 0.1, Math.PI / 2, 0, 0);          // carrot nose
  for (let i = 0; i < 5; i++) { const a = (i - 2) * 0.32; add(g, new THREE.SphereGeometry(0.026, 6, 5), COAL, Math.sin(a) * 0.15, y - 0.12 + Math.abs(i - 2) * 0.03, r * 0.93); }
  const hat = new THREE.Group(); hat.position.set(0.04, y + r * 0.82, -0.02); hat.rotation.set(-0.15, 0, -0.22); g.add(hat);
  add(hat, new THREE.CylinderGeometry(0.3, 0.3, 0.03, 18), COAL, 0, 0, 0);
  add(hat, new THREE.CylinderGeometry(0.2, 0.21, 0.36, 18), COAL, 0, 0.18, 0);
  add(hat, new THREE.CylinderGeometry(0.212, 0.212, 0.07, 18), 0xd8342c, 0, 0.06, 0);
}
export function makeSnowman() {
  const g = new THREE.Group(), S = SNOWMAN;
  snowLump(g, S.base, S.yBase, 0.92);
  snowLump(g, S.mid, S.yMid, 0.95);
  for (let i = 0; i < 3; i++) add(g, new THREE.SphereGeometry(0.05, 8, 6), COAL, 0, S.yMid + 0.2 - i * 0.18, S.mid * 0.95 - Math.abs(i - 1) * 0.03);
  for (const s of [-1, 1]) {   // stick arms with twig fingers, waving
    const arm = add(g, new THREE.CylinderGeometry(0.025, 0.035, 0.85, 6), 0x6a4428, s * 0.72, S.yMid + 0.22, 0, 0, 0, s * (Math.PI / 2 - 0.55));
    void arm;
    add(g, new THREE.CylinderGeometry(0.015, 0.02, 0.22, 5), 0x6a4428, s * 1.05, S.yMid + 0.55, 0, 0, 0, s * 0.2);
  }
  add(g, new THREE.TorusGeometry(0.3, 0.07, 8, 20), 0xd8342c, 0, S.yHead - 0.3, 0, Math.PI / 2, 0, 0);   // scarf
  add(g, new THREE.BoxGeometry(0.14, 0.42, 0.05), 0xd8342c, 0.16, S.yHead - 0.52, 0.3, 0.25, 0, 0.15);
  snowmanHead(g, S.yHead);
  return g;
}
/** The snowman's parts once he's knocked over: they roll (props, world/winter.ts). */
export function makeSnowmanBall(part: 'base' | 'mid' | 'head') {
  const g = new THREE.Group(), r = SNOWMAN[part];
  if (part === 'head') snowmanHead(g, r);
  else {
    snowLump(g, r, r);
    if (part === 'mid') for (let i = 0; i < 3; i++) add(g, new THREE.SphereGeometry(0.05, 8, 6), COAL, 0, r + 0.2 - i * 0.18, r * 0.95 - Math.abs(i - 1) * 0.03);
  }
  return g;
}
/** Bob's ice-fishing catch: a bucket with fish tails sticking out. */
export function makeFishBucket() {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.2, 0.16, 0.3, 14), 0x8c99ad, 0, 0.15, 0);
  add(g, new THREE.TorusGeometry(0.2, 0.015, 6, 18), 0x5d6778, 0, 0.3, 0, Math.PI / 2, 0, 0);
  const body = new THREE.SphereGeometry(0.06, 10, 8), tail = new THREE.ConeGeometry(0.05, 0.08, 4);
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1, x = Math.cos(a) * 0.07, z = Math.sin(a) * 0.07;
    add(g, body, i === 1 ? 0xf08a5a : 0x9fc4dd, x, 0.33, z, 0.3 - i * 0.2, a, 0.4).scale.set(0.8, 2.2, 0.5);
    add(g, tail, i === 1 ? 0xf08a5a : 0x9fc4dd, x * 1.3, 0.46, z * 1.3, 0, a, 0);
  }
  return g;
}
