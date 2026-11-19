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

/**
 * Bob's safe (heavy loot: too heavy for one pig — two drag it, or one pig full of spinach): a squat green-grey steel
 * box on little feet, a big brass dial, a lever handle, rivets and a gold "$".
 */
export function makeSafe() {
  const g = new THREE.Group();
  const W = 0.82, H = 0.86, D = 0.74;
  add(g, new THREE.BoxGeometry(W, H, D), 0x4f6b5c, 0, 0.08 + H / 2, 0);                                // body
  add(g, new THREE.BoxGeometry(W + 0.04, 0.07, D + 0.04), 0x3c5246, 0, 0.08 + H, 0);                    // lid rim
  add(g, new THREE.BoxGeometry(W - 0.14, H - 0.16, 0.04), 0x5e7d6b, 0, 0.08 + H / 2, D / 2 + 0.02);     // door
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, new THREE.CylinderGeometry(0.06, 0.07, 0.08, 8), 0x2b2b30, sx * (W / 2 - 0.08), 0.04, sz * (D / 2 - 0.08));   // feet
  add(g, new THREE.CylinderGeometry(0.12, 0.12, 0.05, 20), 0xd9a92e, 0.06, 0.08 + H / 2 + 0.08, D / 2 + 0.06, Math.PI / 2, 0, 0);   // dial
  add(g, new THREE.CylinderGeometry(0.06, 0.06, 0.06, 12), 0x8a6a1c, 0.06, 0.08 + H / 2 + 0.08, D / 2 + 0.08, Math.PI / 2, 0, 0);
  add(g, new THREE.BoxGeometry(0.03, 0.05, 0.02), 0x3b2412, 0.06, 0.08 + H / 2 + 0.17, D / 2 + 0.085);   // dial mark
  add(g, new THREE.BoxGeometry(0.2, 0.04, 0.04), 0xc9ced8, 0.06, 0.08 + H / 2 - 0.16, D / 2 + 0.07, 0, 0, 0.5);   // lever
  add(g, new THREE.SphereGeometry(0.035, 8, 6), 0xc9ced8, 0.14, 0.08 + H / 2 - 0.12, D / 2 + 0.08);
  for (const y of [0.24, 0.72]) add(g, new THREE.BoxGeometry(0.05, 0.12, 0.05), 0x2b2b30, -(W / 2 - 0.1), 0.08 + y, D / 2 + 0.05);   // hinges
  const rivet = new THREE.SphereGeometry(0.022, 6, 5);
  for (const x of [-1, 1]) for (const y of [0, 1]) add(g, rivet, 0xb7c0b8, x * (W / 2 - 0.1), 0.08 + 0.1 + y * (H - 0.2), D / 2 + 0.045);
  // a gold dollar sign on top
  const s = new THREE.Shape();
  s.moveTo(0.06, 0.07); s.bezierCurveTo(0.02, 0.1, -0.07, 0.09, -0.06, 0.03); s.bezierCurveTo(-0.05, -0.01, 0.06, 0.0, 0.06, -0.04);
  s.bezierCurveTo(0.07, -0.1, -0.03, -0.1, -0.07, -0.07); s.lineTo(-0.06, -0.05); s.bezierCurveTo(-0.02, -0.08, 0.05, -0.08, 0.04, -0.04);
  s.bezierCurveTo(0.03, -0.01, -0.08, -0.02, -0.08, 0.03); s.bezierCurveTo(-0.08, 0.11, 0.03, 0.11, 0.07, 0.09); s.lineTo(0.06, 0.07);
  const dollar = add(g, new THREE.ExtrudeGeometry(s, { depth: 0.015, bevelEnabled: false }), 0xffd166, 0, 0.08 + H + 0.04, 0, -Math.PI / 2, 0, 0);
  dollar.scale.setScalar(1.8);
  add(g, new THREE.BoxGeometry(0.018, 0.02, 0.3), 0xffd166, 0, 0.08 + H + 0.05, 0);
  return g;
}

/**
 * Bob's old TV (heavy loot: two pigs, or one on spinach): a wooden cabinet set on stubby legs, a bulging grey-blue
 * screen, two brass knobs, a speaker grille and rabbit-ear antennas. Drop it / throw it / punch it and the screen
 * cracks (`crack`, hidden until then): it's worth next to nothing after that.
 */
export function makeTV() {
  const g = new THREE.Group();
  const W = 0.9, H = 0.68, D = 0.62, L = 0.12;
  add(g, new THREE.BoxGeometry(W, H, D), 0x8a5a32, 0, L + H / 2, 0);                                     // cabinet
  add(g, new THREE.BoxGeometry(W + 0.03, 0.04, D + 0.03), 0x6e4524, 0, L + H, 0);                          // top rim
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, new THREE.CylinderGeometry(0.03, 0.022, L, 8), 0x3b2412, sx * (W / 2 - 0.08), L / 2, sz * (D / 2 - 0.08));
  add(g, new THREE.BoxGeometry(0.6, 0.5, 0.03), 0x3a3a40, -0.1, L + H / 2, D / 2 + 0.005);                // screen bezel
  const sm = toonMat(0x9fd3ea); sm.emissive.setHex(0x3f7f9a);   // it's on: a soft blue glow
  const scr = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14, Math.PI / 2 - 0.62, 1.24, Math.PI / 2 - 0.5, 1.0), sm);
  scr.name = 'screen'; scr.position.set(-0.1, L + H / 2, D / 2 - 0.3); scr.scale.set(1, 1, 1); scr.castShadow = true; g.add(scr);
  add(g, new THREE.SphereGeometry(0.09, 10, 8), 0xdff3ff, -0.24, L + H / 2 + 0.1, D / 2 + 0.105).scale.set(1, 0.6, 0.2);   // glare
  // the crack (hidden until it breaks): a few dark zig-zags over the glass
  const crack = new THREE.Group(); crack.name = 'crackG'; crack.position.set(-0.1, L + H / 2, D / 2 + 0.125); g.add(crack);
  const cm = toonMat(0xf4f8ff); cm.emissive.setHex(0x9aa8b0);
  for (const [x, y, a, l] of [[0, 0, 0.3, 0.3], [0.08, 0.06, -0.9, 0.2], [-0.06, -0.05, 2.2, 0.24], [0.02, -0.09, -2.0, 0.18], [-0.1, 0.07, 1.1, 0.16]]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(l * 1.3, 0.028, 0.012), cm); c.name = 'crack';
    c.position.set(x + Math.cos(a) * l / 2, y + Math.sin(a) * l / 2, 0); c.rotation.z = a; crack.add(c);
  }
  crack.visible = false;
  for (const y of [0.1, -0.06]) {
    add(g, new THREE.CylinderGeometry(0.045, 0.045, 0.04, 14), 0xd9a92e, 0.31, L + H / 2 + y, D / 2 + 0.02, Math.PI / 2, 0, 0);
    add(g, new THREE.BoxGeometry(0.012, 0.05, 0.012), 0x3b2412, 0.31, L + H / 2 + y + 0.015, D / 2 + 0.045);
  }
  for (let i = 0; i < 4; i++) add(g, new THREE.BoxGeometry(0.16, 0.012, 0.01), 0x3b2412, 0.31, L + 0.12 + i * 0.035, D / 2 + 0.005);   // speaker grille
  // rabbit ears
  add(g, new THREE.SphereGeometry(0.07, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0x2b2b30, 0.05, L + H + 0.02, -0.05);
  for (const s of [-1, 1]) {
    const ear = add(g, new THREE.CylinderGeometry(0.008, 0.008, 0.62, 5), 0xc9ced8, 0.05 + s * 0.15, L + H + 0.3, -0.05, 0, 0, -s * 0.5);
    void ear;
    add(g, new THREE.SphereGeometry(0.018, 6, 5), 0xc9ced8, 0.05 + s * 0.3, L + H + 0.56, -0.05);
  }
  return g;
}

/**
 * The grandfather clock (heavy loot: tall — it topples when you drag it too hard): a dark wooden case with a hood,
 * a round face whose hands show the game's time, a brass pendulum swinging behind the trunk's glass, a crown on top.
 * It goes BONG on every full hour, wherever it is (pigs dragging it get heard).
 */
export function makeClock() {
  const g = new THREE.Group();
  const C = 0x6b3d1f, DK = 0x4a2812;
  add(g, new THREE.BoxGeometry(0.6, 0.32, 0.42), DK, 0, 0.16, 0);                                       // plinth
  add(g, new THREE.BoxGeometry(0.48, 1.1, 0.34), C, 0, 0.32 + 0.55, 0);                                 // trunk
  add(g, new THREE.BoxGeometry(0.3, 0.8, 0.02), 0x9fc8d8, 0, 0.32 + 0.55, 0.175);   // glass
  add(g, new THREE.BoxGeometry(0.58, 0.56, 0.42), C, 0, 1.42 + 0.28, 0);                                // hood
  add(g, new THREE.BoxGeometry(0.62, 0.06, 0.46), DK, 0, 1.42, 0);
  add(g, new THREE.BoxGeometry(0.64, 0.06, 0.48), DK, 0, 1.98, 0);
  // crown: a little broken pediment with a brass finial
  for (const s of [-1, 1]) add(g, new THREE.BoxGeometry(0.3, 0.06, 0.44), C, s * 0.15, 2.06, 0, 0, 0, -s * 0.35);
  add(g, new THREE.SphereGeometry(0.05, 10, 8), 0xd9a92e, 0, 2.2, 0);
  // face: white disc, brass ring, 12 ticks
  const fz = 0.215, fy = 1.7;
  add(g, new THREE.CylinderGeometry(0.22, 0.22, 0.02, 28), 0xd9a92e, 0, fy, fz - 0.005, Math.PI / 2, 0, 0);
  add(g, new THREE.CylinderGeometry(0.195, 0.195, 0.02, 28), 0xfff6e6, 0, fy, fz + 0.002, Math.PI / 2, 0, 0);
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; add(g, new THREE.BoxGeometry(0.014, i % 3 ? 0.03 : 0.05, 0.01), 0x3b2412, Math.sin(a) * 0.165, fy + Math.cos(a) * 0.165, fz + 0.014, 0, 0, -a); }
  // hands (pivots turned by world/heavyLoot.ts)
  for (const [name, len, w] of [['hourHand', 0.1, 0.022], ['minHand', 0.15, 0.014]] as [string, number, number][]) {
    const pv = new THREE.Group(); pv.name = name; pv.position.set(0, fy, fz + (name === 'minHand' ? 0.026 : 0.02)); g.add(pv);
    add(pv, new THREE.BoxGeometry(w, len, 0.008), 0x2a1a0c, 0, len / 2 - 0.015, 0);
  }
  add(g, new THREE.SphereGeometry(0.018, 8, 6), 0xd9a92e, 0, fy, fz + 0.03);
  // pendulum behind the glass
  const pend = new THREE.Group(); pend.name = 'pendulum'; pend.position.set(0, 1.32, 0.12); g.add(pend);
  add(pend, new THREE.BoxGeometry(0.02, 0.62, 0.01), 0xd9a92e, 0, -0.31, 0);
  add(pend, new THREE.CylinderGeometry(0.075, 0.075, 0.02, 20), 0xd9a92e, 0, -0.64, 0, Math.PI / 2, 0, 0);
  return g;
}

/**
 * Bob's coffee mug (his coffee break on the porch, world/porch.ts): a fat white enamel tin mug with a blue rim, a
 * handle, and coffee in it — the surface (named 'coffee', its own material) turns red when it's spiked with hot sauce,
 * brown-grey with mud, and hides once he has spat it out.
 */
export function makeCoffeeMug() {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.075, 0.068, 0.15, 16), 0xf6f1e4, 0, 0.075, 0);
  add(g, new THREE.TorusGeometry(0.073, 0.008, 6, 20), 0x3f7fd0, 0, 0.15, 0, Math.PI / 2);                 // blue rim
  add(g, new THREE.CylinderGeometry(0.069, 0.069, 0.006, 16), 0x3f7fd0, 0, 0.003, 0);                       // blue foot
  add(g, new THREE.TorusGeometry(0.038, 0.011, 6, 12, Math.PI * 1.25), 0xf6f1e4, 0.085, 0.08, 0, 0, 0, -Math.PI * 0.62);   // handle
  for (const [x, y] of [[-0.02, 0.06], [0.03, 0.1], [0.0, 0.035]]) add(g, new THREE.SphereGeometry(0.008, 6, 4), 0x2d2a36, x, y, 0.071);   // chipped enamel
  const c = new THREE.Mesh(new THREE.CircleGeometry(0.066, 16), toonMat(0x5a3218));
  c.name = 'coffee'; c.rotation.x = -Math.PI / 2; c.position.y = 0.135; g.add(c);
  return g;
}

/** A bottle of very hot sauce (by Bob's BBQ grill): red, a green cap, a cream label with a little red chili. */
export function makeHotSauce() {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.05, 0.052, 0.16, 14), 0xd8281f, 0, 0.08, 0);
  add(g, new THREE.CylinderGeometry(0.022, 0.05, 0.05, 14), 0xd8281f, 0, 0.185, 0);                       // shoulders
  add(g, new THREE.CylinderGeometry(0.02, 0.022, 0.05, 10), 0xd8281f, 0, 0.235, 0);                       // neck
  add(g, new THREE.CylinderGeometry(0.026, 0.026, 0.035, 10), 0x2f8a35, 0, 0.275, 0);                     // cap
  add(g, new THREE.CylinderGeometry(0.0525, 0.0525, 0.08, 14, 1, true), 0xfff1c9, 0, 0.085, 0);            // label
  add(g, new THREE.CapsuleGeometry(0.012, 0.045, 4, 8), 0xe2352b, 0, 0.085, 0.055, 0, 0, 1.2);             // chili
  add(g, new THREE.CylinderGeometry(0.004, 0.004, 0.02, 4), 0x2f8a35, 0.03, 0.1, 0.055, 0, 0, 1.2);
  return g;
}
