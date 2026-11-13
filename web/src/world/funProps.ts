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
