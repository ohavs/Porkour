import * as THREE from 'three';
import { toonMat } from '../render/toon';
import { G } from '../game/ctx';
import { Prop, PROPS } from './props';
import type { Nav } from '../farmer/nav';

/**
 * Snacks lying around the farm (user request): food cans that give a pig a boost for a while, and packs of
 * cigarettes. Grab one (RMB) and click (LMB) = eat it / light one up. The hooves bring it to the mouth.
 *  - Beans: mega farts (cooldown ×0.3, bigger launch and cloud).
 *  - Spinach: strong (punches / headbutts / rams hit harder, lifts and throws more; Popeye arms).
 *  - Energy drink: fast (walk / run ×1.3, sprint recharges fast).
 *  - Dog food: smells like the dog's dinner, the guard dog doesn't bark at you.
 *  - Cigarette (5 per pack): ~14 s of smoking: a puff every few seconds (the hoof brings it to the mouth), calm on
 *    two legs (wobble ×0.5), bees leave you alone (smoke calms bees). But a smoking pig is NOT normal: Bob gets
 *    suspicious when he sees it, and it may end in a coughing fit (a noise).
 */
export type SnackId = 'beans' | 'spinach' | 'energy' | 'dogfood';
export const SNACK_IDS: SnackId[] = ['beans', 'spinach', 'energy', 'dogfood'];
export const SNACK = {
  secs: { beans: 30, spinach: 30, energy: 25, dogfood: 45 } as Record<SnackId, number>,
  eat: 1.5, cig: 14, puffEvery: 3.2, puff: 1.1, coughChance: 0.35,
  fartCd: 0.3, fartUp: 1.3, strong: 1.6, lift: 1.6, throwK: 1.25, fast: 1.3, sprintCd: 0.35, calm: 0.5,
  packs: 3, cans: 8,
};
const LABEL: Record<SnackId, number> = { beans: 0xe8792e, spinach: 0x3f9d3a, energy: 0x2f5fd8, dogfood: 0xd8342c };

const mats = new Map<number, THREE.MeshToonMaterial>();
const M = (c: number) => { let m = mats.get(c); if (!m) { m = toonMat(c); mats.set(c, m); } return m; };
function add(g: THREE.Object3D, geo: THREE.BufferGeometry, c: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, M(c)); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
}

/** A tin can with a coloured label and a picture of what's inside; the lid is its own mesh (gone once eaten). */
export function makeCan(kind: SnackId) {
  const g = new THREE.Group();
  const R = 0.1, H = 0.24, S = 0xc9ced8;
  add(g, new THREE.CylinderGeometry(R, R, H, 20), S, 0, H / 2, 0);
  add(g, new THREE.CylinderGeometry(R + 0.003, R + 0.003, H * 0.62, 20, 1, true), LABEL[kind], 0, H / 2, 0);
  for (const y of [0.012, H - 0.012]) add(g, new THREE.CylinderGeometry(R + 0.008, R + 0.008, 0.018, 20), 0xaab0bc, 0, y, 0);
  add(g, new THREE.CircleGeometry(R - 0.012, 18), kind === 'energy' ? 0x9be3ff : kind === 'spinach' ? 0x2d6b25 : kind === 'dogfood' ? 0x8a5a35 : 0xc8552a, 0, H + 0.002, 0, -Math.PI / 2);
  const lid = add(g, new THREE.CylinderGeometry(R - 0.004, R - 0.004, 0.012, 20), 0xdfe3ea, 0, H + 0.004, 0);
  lid.name = 'lid';
  const tab = add(lid, new THREE.BoxGeometry(0.05, 0.006, 0.022), 0xaab0bc, 0.02, 0.008, 0); tab.name = 'tab';
  // the picture on the front (+z) and the back
  for (const s of [1, -1]) {
    const z = s * (R + 0.006), f = new THREE.Group(); f.position.set(0, H / 2, z); if (s < 0) f.rotation.y = Math.PI; g.add(f);
    if (kind === 'beans') for (const [x, y] of [[-0.03, 0.012], [0.025, 0.02], [0, -0.022]]) add(f, new THREE.SphereGeometry(0.022, 10, 8).scale(1.3, 0.8, 0.5), 0xff5a2a, x, y, 0);
    if (kind === 'spinach') { add(f, new THREE.SphereGeometry(0.04, 12, 8).scale(0.8, 1.2, 0.3), 0x7fd357, 0, 0.004, 0, 0, 0, 0.5); add(f, new THREE.BoxGeometry(0.006, 0.07, 0.006), 0x2d6b25, 0, -0.005, 0.008, 0, 0, 0.5); }
    if (kind === 'energy') { add(f, new THREE.BoxGeometry(0.026, 0.05, 0.008), 0xffd166, 0.006, 0.02, 0, 0, 0, -0.45); add(f, new THREE.BoxGeometry(0.026, 0.05, 0.008), 0xffd166, -0.006, -0.02, 0, 0, 0, -0.45); add(f, new THREE.BoxGeometry(0.04, 0.012, 0.008), 0xffd166, 0, 0, 0, 0, 0, 0.2); }
    if (kind === 'dogfood') { add(f, new THREE.BoxGeometry(0.06, 0.016, 0.008), 0xfff4e6); for (const x of [-0.032, 0.032]) for (const y of [-0.01, 0.01]) add(f, new THREE.SphereGeometry(0.013, 8, 6), 0xfff4e6, x, y, 0); }
  }
  return g;
}

/** A pack of cigarettes: red with a white top, three poking out. */
export function makeCigPack() {
  const g = new THREE.Group();
  add(g, new THREE.BoxGeometry(0.15, 0.19, 0.07), 0xd8342c, 0, 0.095, 0);
  add(g, new THREE.BoxGeometry(0.153, 0.055, 0.073), 0xfff4e6, 0, 0.165, 0);
  add(g, new THREE.BoxGeometry(0.07, 0.03, 0.074), 0xffd166, 0, 0.09, 0);
  [-0.035, 0, 0.035].forEach((x, i) => {
    const h = 0.04 + i * 0.012;
    add(g, new THREE.CylinderGeometry(0.012, 0.012, h, 8), 0xfaf6ef, x, 0.19 + h / 2, 0);
    add(g, new THREE.CylinderGeometry(0.0125, 0.0125, 0.02, 8), 0xd98b3a, x, 0.19 + h - 0.008, 0);
  });
  return g;
}

/** The lit cigarette a pig holds (along +z: filter at the back, ember at the front). `ember` glows brighter on a puff. */
export function makeCigarette() {
  const g = new THREE.Group();
  const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.12, 8).rotateX(Math.PI / 2), toonMat(0xfaf6ef));
  const filter = new THREE.Mesh(new THREE.CylinderGeometry(0.0145, 0.0145, 0.035, 8).rotateX(Math.PI / 2), toonMat(0xd98b3a));
  filter.position.z = -0.06;
  const ash = new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.0135, 0.012, 8).rotateX(Math.PI / 2), toonMat(0x8a8a8a));
  ash.position.z = 0.064;
  const ember = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff5a1f }));
  ember.position.z = 0.068; ember.name = 'ember';
  g.add(paper, filter, ash, ember);
  g.traverse((o) => { o.castShadow = false; });
  return g;
}

/** Can props (one kind each) + the cigarette pack. */
export const SNACK_PROPS = {
  canBeans: { make: () => makeCan('beans'), snack: 'beans' as const, label: 'item.canBeans' },
  canSpinach: { make: () => makeCan('spinach'), snack: 'spinach' as const, label: 'item.canSpinach' },
  canEnergy: { make: () => makeCan('energy'), snack: 'energy' as const, label: 'item.canEnergy' },
  canDog: { make: () => makeCan('dogfood'), snack: 'dogfood' as const, label: 'item.canDog' },
};
for (const [k, v] of Object.entries(SNACK_PROPS)) PROPS[k] = { ...v, mass: 0.6, shape: 'cyl', sound: 'metal', friction: 0.8, servings: 1, id: k };
PROPS.cigPack = { make: makeCigPack, mass: 0.15, sound: 'thud', label: 'item.cigPack', friction: 0.9, smokes: true, servings: 5, id: 'cigPack' };

const rnd = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/**
 * A few packs and cans scattered over the farm (same spots on every machine: seeded). Walkable ground only, not in
 * water, not in the pigs' stash, not right next to the outer fence.
 */
export function scatterSnacks(scene: THREE.Scene, props: Prop[], nav: Nav, seed: number, inWater: (x: number, z: number) => boolean, stash: THREE.Vector3) {
  const r = rnd(seed * 7919 + 17);
  const kinds = ['canBeans', 'canSpinach', 'canEnergy', 'canDog'];
  const want = [...Array(SNACK.packs).fill('cigPack'), ...Array.from({ length: SNACK.cans }, (_, i) => kinds[i % kinds.length])];
  const placed: THREE.Vector3[] = [];
  const W = nav.w * nav.cell, H = nav.h * nav.cell;
  for (const id of want) {
    for (let tries = 0; tries < 200; tries++) {
      const x = nav.x0 + 3 + r() * (W - 6), z = nav.z0 + 3 + r() * (H - 6);
      if (!nav.free(x, z) || inWater(x, z) || Math.hypot(x - stash.x, z - stash.z) < 5) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 9)) continue;
      const at = new THREE.Vector3(x, G.terrain.height(x, z) + 0.05, z);
      placed.push(at);
      props.push(new Prop(scene, PROPS[id], at, r() * Math.PI * 2));
      break;
    }
  }
}
