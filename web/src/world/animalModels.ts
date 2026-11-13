import * as THREE from 'three';
import { rigidSkin } from '../render/batch';
import { googly } from '../render/googly';
import { toonMat } from '../render/toon';
import { damp, clamp } from '../core/util';

/**
 * Round cartoon farm animals in the same style as the pigs and Bob (smooth shapes, cel shading, big eyes).
 * Each builder returns a rig; AnimalVisual animates it procedurally (walk / run / hop / peck / wag / flap / tumble).
 * Animals face +z, origin on the ground between the feet.
 */
export type AnimalKind = 'hen' | 'chick' | 'cow' | 'dog' | 'cat' | 'bunny' | 'wolf' | 'sheep' | 'duck' | 'horse' | 'horse2' | 'donkey' | 'alpaca'
  | 'rooster' | 'turkey';
/** Two-legged birds (waddle, peck, flap). */
export const BIRDS = new Set<AnimalKind>(['hen', 'chick', 'duck', 'rooster', 'turkey']);

export interface AnimalRig {
  kind: AnimalKind;
  body: THREE.Group;          // bobs / rolls
  head: THREE.Group;
  legs: THREE.Group[];        // pivot at the hip, swing about x
  phases: number[];           // gait phase per leg
  tail?: THREE.Group; ears: THREE.Group[]; wings: THREE.Group[]; eyes: THREE.Object3D[];
  jaw?: THREE.Group;
  height: number;
}

const sphere = new THREE.SphereGeometry(1, 28, 20);
const small = new THREE.SphereGeometry(1, 14, 10);
const mats = new Map<number, THREE.MeshToonMaterial>();
const M = (c: number) => { let m = mats.get(c); if (!m) { m = toonMat(c); mats.set(c, m); } return m; };

type V = [number, number, number];
function mesh(g: THREE.BufferGeometry, c: number | THREE.Material, p: V, parent: THREE.Object3D, s?: V, r?: V) {
  const o = new THREE.Mesh(g, typeof c === 'number' ? M(c) : c);
  o.position.set(...p); if (s) o.scale.set(...s); if (r) o.rotation.set(...r);
  o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
}
function group(parent: THREE.Object3D, p: V) { const g = new THREE.Group(); g.position.set(...p); parent.add(g); return g; }
/** Cartoon eye: white, pupil, highlight. */
function eye(parent: THREE.Object3D, p: V, r: number, s = 1, iris = 0x1b1010, white = 0xffffff) {
  const e = group(parent, p);
  e.userData.r = r;
  mesh(small, white, [0, 0, 0], e, [r, r * 1.1, r * 0.75]);
  mesh(small, iris, [s * -r * 0.08, -r * 0.05, r * 0.55], e, [r * 0.6, r * 0.66, r * 0.4]);
  const hl = mesh(small, 0xffffff, [s * r * 0.15, r * 0.3, r * 0.9], e, [r * 0.2, r * 0.2, r * 0.15]); hl.castShadow = false;
  return e;
}
function leg(parent: THREE.Object3D, p: V, len: number, r: number, color: number, foot?: number, footS?: V) {
  const g = group(parent, p);
  mesh(new THREE.CapsuleGeometry(r, len, 4, 10), color, [0, -len / 2 - r * 0.2, 0], g);
  if (foot !== undefined) mesh(sphere, foot, [0, -len - r * 0.6, r * 0.25], g, footS ?? [r * 1.25, r * 0.7, r * 1.5]);
  return g;
}

function bird(kind: 'hen' | 'chick' | 'duck', root: THREE.Group): AnimalRig {
  const chick = kind === 'chick', duck = kind === 'duck';
  const s = chick ? 0.55 : 1;
  const col = chick ? 0xffe066 : duck ? 0xffffff : Math.random() < 0.5 ? 0xffffff : 0xc9773a;
  const beakC = 0xffa62b;
  const body = group(root, [0, 0, 0]);
  const by = (duck ? 0.22 : 0.27) * s;
  mesh(sphere, col, [0, by, 0], body, [0.19 * s, (duck ? 0.15 : 0.18) * s, (duck ? 0.25 : 0.21) * s]);
  // tail feathers
  if (!chick) for (let i = -1; i <= 1; i++)
    mesh(sphere, col, [i * 0.05, by + (duck ? 0.05 : 0.12), -0.2], body, [0.04, duck ? 0.06 : 0.11, 0.05], [duck ? -0.9 : -0.4, 0, i * 0.3]);
  const head = group(body, [0, by + (chick ? 0.1 : duck ? 0.17 : 0.18) * (chick ? 1 : 1), (chick ? 0.05 : duck ? 0.18 : 0.13)]);
  const hr = chick ? 0.075 : 0.105;
  mesh(sphere, col, [0, 0, 0], head, [hr, hr * 1.05, hr]);
  if (duck) mesh(sphere, beakC, [0, -0.015, hr + 0.04], head, [0.05, 0.022, 0.07]);
  else mesh(new THREE.ConeGeometry(0.028 * (chick ? 0.8 : 1), 0.07 * (chick ? 0.8 : 1), 10), beakC, [0, -0.01, hr + 0.025], head, undefined, [Math.PI / 2, 0, 0]);
  if (kind === 'hen') {
    for (let i = 0; i < 3; i++) mesh(small, 0xe8322f, [0, hr + 0.015, -0.03 + i * 0.035], head, [0.022, 0.035, 0.022]);
    mesh(small, 0xe8322f, [0, -0.06, hr - 0.01], head, [0.02, 0.035, 0.02]);
  }
  const eyes = [eye(head, [0.06 * (chick ? 0.75 : 1), 0.02, hr * 0.62], hr * 0.32, 1), eye(head, [-0.06 * (chick ? 0.75 : 1), 0.02, hr * 0.62], hr * 0.32, -1)];
  const wings = [-1, 1].map((sd) => {
    const w = group(body, [sd * 0.17 * s, by + 0.03 * s, -0.01]);
    mesh(sphere, col, [sd * 0.02, -0.02, 0], w, [0.04 * s, 0.1 * s, 0.14 * s], [0, 0, sd * 0.2]);
    return w;
  });
  const legs = [-1, 1].map((sd) => leg(root, [sd * 0.07 * s, by - 0.12 * s, 0], (duck ? 0.06 : 0.1) * s, 0.016, beakC, beakC, [0.035, 0.012, 0.06]));
  return { kind, body, head, legs, phases: [0, Math.PI], ears: [], wings, eyes, height: by + 0.25 * s };
}

/**
 * The farm's alarm birds. Rooster: rusty body, golden ruff, huge comb, tall dark-green sickle tail. Turkey: big round
 * brown body, bare blue-white head with a red snood, and a striped fan tail that folds back and pops up when it's angry
 * (`tail` scales / tilts with excite).
 */
function fowl(kind: 'rooster' | 'turkey', outer: THREE.Group): AnimalRig {
  const T = kind === 'turkey';
  // built at hen scale, then scaled up as a whole (a turkey is about as tall as a pig)
  const S = T ? 1.4 : 1.2, root = group(outer, [0, 0, 0]); root.scale.setScalar(S);
  const body = group(root, [0, 0, 0]);
  const by = T ? 0.4 : 0.31;
  const col = T ? 0x5b3a26 : 0xc8541f, wingC = T ? 0x47301f : 0x8a3b1b;
  mesh(sphere, col, [0, by, 0], body, T ? [0.27, 0.25, 0.31] : [0.2, 0.2, 0.23]);
  mesh(sphere, T ? 0x3f2a1d : 0x2b2a2e, [0, by - 0.05, T ? 0.17 : 0.12], body, T ? [0.2, 0.19, 0.15] : [0.14, 0.15, 0.12]);   // breast
  let head: THREE.Group, hr: number;
  if (T) {
    mesh(new THREE.CapsuleGeometry(0.045, 0.16, 4, 10), 0xd8e2ec, [0, by + 0.2, 0.25], body, undefined, [0.35, 0, 0]);   // bare neck
    head = group(body, [0, by + 0.33, 0.3]); hr = 0.085;
    mesh(sphere, 0xd8e2ec, [0, 0, 0], head, [hr, hr * 1.05, hr * 1.1]);
    mesh(new THREE.ConeGeometry(0.022, 0.05, 8), 0xe8c07a, [0, -0.01, hr + 0.018], head, undefined, [Math.PI / 2, 0, 0]);
    mesh(new THREE.CapsuleGeometry(0.014, 0.07, 4, 8), 0xd8322f, [0.012, -0.03, hr + 0.03], head, undefined, [0.25, 0, 0.15]);   // snood
    mesh(sphere, 0xd8322f, [0, -0.07, hr * 0.55], head, [0.035, 0.05, 0.035]);                                               // wattle
  } else {
    mesh(sphere, 0xf0a63a, [0, by + 0.13, 0.12], body, [0.13, 0.13, 0.12]);   // golden ruff
    head = group(body, [0, by + 0.23, 0.15]); hr = 0.11;
    mesh(sphere, 0xf0a63a, [0, 0, 0], head, [hr, hr * 1.05, hr]);
    mesh(new THREE.ConeGeometry(0.03, 0.075, 10), 0xffc12b, [0, -0.01, hr + 0.027], head, undefined, [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 5; i++) mesh(small, 0xe8322f, [0, hr + 0.025 + Math.sin((i / 4) * Math.PI) * 0.025, -0.055 + i * 0.03], head, [0.024, 0.05, 0.026]);
    for (const sx of [-1, 1]) mesh(small, 0xe8322f, [sx * 0.012, -0.075, hr - 0.015], head, [0.02, 0.045, 0.02]);
  }
  const eyes = [eye(head, [hr * 0.55, 0.02, hr * 0.62], hr * 0.34, 1), eye(head, [-hr * 0.55, 0.02, hr * 0.62], hr * 0.34, -1)];
  // tail
  const tail = group(body, [0, by + (T ? 0.06 : 0.1), T ? -0.25 : -0.17]);
  if (T) {
    for (let i = 0; i < 11; i++) {
      const f = group(tail, [0, 0, 0]); f.rotation.z = -1.3 + (i / 10) * 2.6;
      mesh(sphere, i % 2 ? 0x7d5233 : 0x6b4329, [0, 0.24, 0], f, [0.065, 0.25, 0.022]);
      mesh(sphere, 0x2b1c12, [0, 0.4, 0.003], f, [0.06, 0.035, 0.022]);
      mesh(sphere, 0xeadfc6, [0, 0.46, 0.004], f, [0.055, 0.035, 0.022]);
    }
    tail.rotation.x = 0.9; tail.scale.setScalar(0.6);
  } else {
    for (let i = 0; i < 5; i++) {
      const f = group(tail, [(i - 2) * 0.025, 0, 0]); f.rotation.set(-0.15 - i * 0.22, 0, (i - 2) * 0.12);
      mesh(sphere, i % 2 ? 0x15302a : 0x1f4a3a, [0, 0.17, -0.02], f, [0.03, 0.2, 0.055], [-0.35, 0, 0]);
    }
  }
  const wings = [-1, 1].map((sd) => {
    const w = group(body, [sd * (T ? 0.24 : 0.18), by + 0.03, -0.02]);
    mesh(sphere, wingC, [sd * 0.02, -0.02, 0], w, T ? [0.05, 0.14, 0.2] : [0.045, 0.11, 0.15], [0, 0, sd * 0.2]);
    return w;
  });
  const legC = T ? 0xc99a86 : 0xffc12b;
  const legs = [-1, 1].map((sd) => leg(root, [sd * (T ? 0.1 : 0.075), by - (T ? 0.2 : 0.15), 0], T ? 0.13 : 0.11, 0.019, legC, legC, [0.04, 0.013, 0.07]));
  for (const e of eyes) e.userData.r *= S;   // googly eyes are sized in world units
  return { kind, body, head, legs, phases: [0, Math.PI], ears: [], wings, eyes, tail, height: (by + (T ? 0.45 : 0.4)) * S };
}

function quad(kind: 'cow' | 'dog' | 'cat' | 'wolf' | 'sheep' | 'bunny', root: THREE.Group): AnimalRig {
  const P = {
    cow: { col: 0xffffff, w: 0.5, h: 0.46, l: 0.82, by: 0.9, head: 0.27, legL: 0.5, legR: 0.09, hoof: 0x4a3328, hx: 0.3, hz: 0.48 },
    dog: { col: 0xc98a4b, w: 0.22, h: 0.21, l: 0.34, by: 0.42, head: 0.17, legL: 0.2, legR: 0.055, hoof: 0xa86d38, hx: 0.12, hz: 0.2 },
    cat: { col: 0xf0a04b, w: 0.16, h: 0.15, l: 0.26, by: 0.3, head: 0.14, legL: 0.15, legR: 0.04, hoof: 0xffffff, hx: 0.09, hz: 0.15 },
    wolf: { col: 0x7d8796, w: 0.27, h: 0.26, l: 0.48, by: 0.58, head: 0.19, legL: 0.3, legR: 0.065, hoof: 0x4f5764, hx: 0.14, hz: 0.28 },
    sheep: { col: 0xf6f3ea, w: 0.36, h: 0.32, l: 0.46, by: 0.62, head: 0.16, legL: 0.3, legR: 0.05, hoof: 0x2b2524, hx: 0.17, hz: 0.24 },
    bunny: { col: 0xf2ece4, w: 0.15, h: 0.14, l: 0.18, by: 0.18, head: 0.115, legL: 0.07, legR: 0.035, hoof: 0xf2ece4, hx: 0.07, hz: 0.08 },
  }[kind];
  if (kind === 'cat' && Math.random() < 0.4) P.col = 0x8a8f99;
  if (kind === 'dog' && Math.random() < 0.3) P.col = 0x3b3030;
  if (kind === 'bunny' && Math.random() < 0.5) P.col = 0xb59a84;
  const body = group(root, [0, 0, 0]);
  const torso = mesh(sphere, P.col, [0, P.by, 0], body, [P.w, P.h, P.l]);
  const ears: THREE.Group[] = [];
  let tail: THREE.Group | undefined;
  let jaw: THREE.Group | undefined;
  // ---- per kind body details
  if (kind === 'cow') {
    const spots = [[0.3, 0.15, 0.2, 0.2], [-0.32, 0.05, -0.25, 0.22], [0.1, 0.38, -0.35, 0.18], [-0.2, 0.3, 0.35, 0.15], [0.33, -0.05, -0.45, 0.14]];
    for (const [x, y, z, r] of spots) {
      const d = new THREE.Vector3(x / P.w, y / P.h, z / P.l).normalize();
      mesh(sphere, 0x2b2524, [d.x * P.w * 0.97, P.by + d.y * P.h * 0.97, d.z * P.l * 0.97], body, [r, r * 0.8, r]);
    }
    mesh(sphere, 0xffa3b5, [0, P.by - P.h * 0.82, -P.l * 0.45], body, [0.16, 0.1, 0.15]);   // udder
  }
  if (kind === 'sheep') {   // fluffy wool
    torso.visible = false;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 * 3.1, y = Math.sin(i * 1.7) * 0.6;
      const d = new THREE.Vector3(Math.cos(a), y, Math.sin(a) * 1.2).normalize();
      mesh(new THREE.IcosahedronGeometry(1, 1), P.col, [d.x * P.w * 0.75, P.by + d.y * P.h * 0.7, d.z * P.l * 0.75], body, [0.17, 0.16, 0.17]);
    }
    mesh(sphere, P.col, [0, P.by, 0], body, [P.w * 0.9, P.h * 0.9, P.l * 0.95]);
  }
  if (kind === 'wolf') mesh(sphere, 0xd6dbe2, [0, P.by - 0.06, P.l * 0.55], body, [0.17, 0.2, 0.16]);  // pale chest
  // ---- head
  const head = group(body, [0, P.by + P.h * (kind === 'bunny' ? 0.75 : 0.55), P.l * (kind === 'bunny' ? 0.7 : 0.88)]);
  const headCol = kind === 'sheep' ? 0x3a302c : P.col;
  mesh(sphere, headCol, [0, 0, 0], head, [P.head, P.head * 0.95, P.head * (kind === 'cow' ? 1.05 : 1)]);
  const H = P.head;
  if (kind === 'cow') {
    mesh(sphere, 0xffb3c1, [0, -H * 0.32, H * 0.8], head, [H * 0.72, H * 0.5, H * 0.5]);   // muzzle
    for (const s of [-1, 1]) mesh(small, 0x6b3a3a, [s * H * 0.25, -H * 0.27, H * 1.25], head, [0.03, 0.04, 0.02]);
    for (const s of [-1, 1]) mesh(new THREE.ConeGeometry(0.04, 0.14, 10), 0xf3e6c8, [s * H * 0.55, H * 0.85, -0.02], head, undefined, [0, 0, -s * 0.5]);
    mesh(sphere, 0x2b2524, [H * 0.35, H * 0.35, H * 0.55], head, [0.08, 0.07, 0.05]);    // eye patch
  }
  if (kind === 'dog' || kind === 'wolf') {
    const sn = kind === 'wolf' ? 1.25 : 1;
    mesh(sphere, kind === 'wolf' ? 0xd6dbe2 : 0xf0c896, [0, -H * 0.25, H * 0.85], head, [H * 0.5, H * 0.42, H * 0.62 * sn]);
    mesh(small, 0x1b1010, [0, -H * 0.05, H * (1.4 + (sn - 1) * 0.7)], head, [0.03, 0.025, 0.025]);
    jaw = group(head, [0, -H * 0.45, H * 0.55]);
    mesh(sphere, kind === 'wolf' ? 0xd6dbe2 : 0xf0c896, [0, 0, H * 0.3], jaw, [H * 0.36, H * 0.14, H * 0.42 * sn]);
    if (kind === 'wolf') for (const s of [-1, 1]) mesh(new THREE.ConeGeometry(0.012, 0.04, 6), 0xffffff, [s * 0.03, H * 0.1, H * 0.62], jaw, undefined, [Math.PI, 0, 0]);
    mesh(small, 0xff7d8a, [0, -0.01, H * 0.45], jaw, [0.035, 0.012, 0.05]); // tongue
  }
  if (kind === 'cat') {
    mesh(sphere, 0xfff4e6, [0, -H * 0.3, H * 0.75], head, [H * 0.45, H * 0.3, H * 0.3]);
    mesh(small, 0xff8fa3, [0, -H * 0.12, H * 1.0], head, [0.018, 0.013, 0.012]);
    for (const s of [-1, 1]) for (const k of [-1, 1]) mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.12, 4), 0xffffff, [s * 0.07, -H * 0.25 + k * 0.012, H * 0.9], head, undefined, [0, 0, Math.PI / 2 + k * 0.15 * s]).castShadow = false;
  }
  if (kind === 'bunny') {
    mesh(small, 0xff8fa3, [0, -H * 0.15, H * 0.98], head, [0.02, 0.015, 0.012]);
    mesh(sphere, 0xffffff, [0, -H * 0.38, H * 0.78], head, [H * 0.38, H * 0.25, H * 0.25]);
  }
  if (kind === 'sheep') mesh(sphere, 0x3a302c, [0, -H * 0.3, H * 0.6], head, [H * 0.62, H * 0.5, H * 0.62]);
  // eyes
  const ey = kind === 'cow' ? H * 0.3 : kind === 'sheep' ? H * 0.2 : H * 0.18;
  const ez = H * (kind === 'cow' ? 0.72 : 0.78), ex = H * (kind === 'cow' ? 0.4 : 0.42);
  const iris = kind === 'wolf' ? 0xf2c230 : kind === 'cat' ? 0x7ed957 : 0x1b1010;
  const er = H * (kind === 'bunny' || kind === 'cat' ? 0.3 : 0.26);
  const eyes = [eye(head, [ex, ey, ez], er, 1, iris), eye(head, [-ex, ey, ez], er, -1, iris)];
  if (kind === 'wolf') {   // grumpy brows
    for (const s of [-1, 1]) mesh(new THREE.CapsuleGeometry(0.014, 0.07, 4, 8), 0x3b4250, [s * ex, ey + er * 1.05, ez + 0.02], head, undefined, [0, 0, Math.PI / 2 - s * 0.45]);
    for (const e of eyes) e.children[1].scale.multiplyScalar(0.7);
  }
  // ears
  const earDef: Record<string, { s: V; p: V; r: V; col: number; geo?: THREE.BufferGeometry }> = {
    cow: { s: [0.13, 0.05, 0.08], p: [H * 0.95, H * 0.4, -0.02], r: [0, 0, -0.3], col: P.col },
    dog: { s: [0.06, 0.13, 0.04], p: [H * 0.82, H * 0.3, -0.02], r: [0, 0, -0.35], col: kind === 'dog' ? 0x8a5a2b : P.col },
    cat: { s: [1, 1, 0.45], p: [H * 0.55, H * 0.85, -0.02], r: [0, 0, -0.25], col: P.col, geo: new THREE.ConeGeometry(0.055, 0.1, 4).translate(0, 0.04, 0) },
    wolf: { s: [1, 1, 0.45], p: [H * 0.5, H * 0.9, -0.04], r: [0, 0, -0.2], col: P.col, geo: new THREE.ConeGeometry(0.07, 0.16, 4).translate(0, 0.07, 0) },
    sheep: { s: [0.1, 0.035, 0.05], p: [H * 0.95, H * 0.25, -0.02], r: [0, 0, -0.4], col: 0x3a302c },
    bunny: { s: [0.035, 0.14, 0.02], p: [H * 0.4, H * 0.95, -0.03], r: [0, 0, -0.15], col: P.col },
  };
  const ed = earDef[kind];
  for (const s of [-1, 1]) {
    const g = group(head, [s * ed.p[0], ed.p[1], ed.p[2]]);
    const pivotOff: V = ed.geo ? [0, 0, 0] : kind === 'bunny' ? [0, ed.s[1] * 0.85, 0] : kind === 'dog' ? [0, -ed.s[1] * 0.6, 0] : [s * ed.s[0] * 0.6, 0, 0];
    const m = mesh(ed.geo ?? sphere, ed.col, pivotOff, g, ed.s, ed.geo ? [0, Math.PI / 4, 0] : undefined);
    if (kind === 'bunny') mesh(sphere, 0xffb3c7, [0, 0, 0.012], m, [0.6, 0.85, 0.6]);
    g.rotation.set(ed.r[0], ed.r[1], s * ed.r[2]);
    ears.push(g);
  }
  // tail
  if (kind === 'cow') {
    tail = group(body, [0, P.by + P.h * 0.5, -P.l * 0.95]);
    mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.55, 6), P.col, [0, -0.27, -0.03], tail, undefined, [0.12, 0, 0]);
    mesh(sphere, 0x2b2524, [0, -0.56, -0.06], tail, [0.05, 0.08, 0.05]);
  } else if (kind === 'dog' || kind === 'cat' || kind === 'wolf') {
    tail = group(body, [0, P.by + P.h * 0.45, -P.l * 0.92]);
    const len = kind === 'cat' ? 0.3 : kind === 'wolf' ? 0.38 : 0.2;
    if (kind === 'wolf') {
      mesh(sphere, P.col, [0, -0.05, -len * 0.5], tail, [0.09, 0.09, len * 0.55], [-0.6, 0, 0]);
      mesh(sphere, 0xd6dbe2, [0, -0.15, -len * 0.9], tail, [0.06, 0.06, 0.08], [-0.6, 0, 0]);
    } else mesh(new THREE.CapsuleGeometry(kind === 'cat' ? 0.025 : 0.035, len, 4, 8), P.col, [0, len * 0.42, -len * 0.25], tail, undefined, [-0.5, 0, 0]);
  } else {
    tail = group(body, [0, P.by + P.h * 0.2, -P.l * 0.98]);
    mesh(sphere, kind === 'bunny' ? 0xffffff : P.col, [0, 0, 0], tail, kind === 'bunny' ? [0.06, 0.06, 0.06] : [0.06, 0.06, 0.05]);
  }
  if (kind === 'dog') { const c = mesh(new THREE.TorusGeometry(H * 0.75, 0.018, 8, 20), 0xd8403a, [0, P.by + P.h * 0.45, P.l * 0.7], body, undefined, [Math.PI / 2 - 0.5, 0, 0]); c.castShadow = false; }
  // legs (front pair, back pair)
  const legCol = kind === 'sheep' ? 0x2b2524 : P.col;
  const ly = P.by - P.h * 0.55;
  const legs = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sz]) =>
    leg(root, [sx * P.hx, ly, sz * P.hz], P.legL, P.legR, legCol, kind === 'cow' || kind === 'sheep' || kind === 'wolf' ? P.hoof : legCol,
      kind === 'bunny' && sz < 0 ? [P.legR * 1.4, P.legR * 0.7, P.legR * 2.6] : undefined));
  return { kind, body, head, legs, phases: [0, Math.PI, Math.PI, 0], tail, ears, wings: [], eyes, jaw, height: P.by + P.h };
}

export function buildAnimal(kind: AnimalKind, root: THREE.Group): AnimalRig {
  if (kind === 'hen' || kind === 'chick' || kind === 'duck') return bird(kind, root);
  if (kind === 'rooster' || kind === 'turkey') return fowl(kind, root);
  return quad(kind === 'horse' || kind === 'horse2' || kind === 'donkey' || kind === 'alpaca' ? 'cow' : kind, root);
}

export interface AnimalPose {
  speed: number; run: boolean; t: number; dt: number; mode: 'idle' | 'move' | 'eat' | 'tumble' | 'held' | 'howl' | 'bite' | 'swim'; excite: number;
  /** Limp (tumbling / held): physical rotations of head + legs relative to the body. */
  limp?: boolean; rel?: THREE.Quaternion[];
}

/** Procedural animation shared by every animal. */
export class AnimalVisual {
  root = new THREE.Group();
  rig: AnimalRig;
  private phase = Math.random() * 6;
  private blinkAt = Math.random() * 3;
  private peck = 0;
  private limpT = 0;
  constructor(public kind: AnimalKind) {
    this.rig = buildAnimal(kind, this.root);
    // goofy: the drawn eyes become googly eyes (pupils slide around, see render/googly.ts)
    const gl = googly();
    if (gl) for (const e of this.rig.eyes) {
      const r = e.userData.r as number | undefined; if (!r) continue;
      for (const c of [...e.children]) e.remove(c);
      const a = new THREE.Object3D(); e.add(a);
      a.position.z = r * 0.15;
      a.rotation.set(-0.15, (Math.sign(e.position.x) || 1) * 0.45, 0);
      gl.add(a, r * 1.3);
    }
    rigidSkin(this.root);
  }

  update(p: AnimalPose) {
    const R = this.rig, dt = p.dt;
    const biped = BIRDS.has(R.kind);
    const hop = R.kind === 'bunny';
    const moving = p.speed > 0.15 && p.mode === 'move';
    const freq = (biped ? 9 : hop ? 7 : R.kind === 'cow' ? 3.2 : 5) * (p.run ? 1.6 : 1);
    this.phase += dt * (moving ? freq * clamp(p.speed / 1.5, 0.6, 2.2) : 0);
    const amp = moving ? (p.run ? 0.9 : 0.55) : 0;
    const flail = p.mode === 'tumble' || p.mode === 'held';
    R.legs.forEach((l, i) => {
      let x = moving ? Math.sin(this.phase + R.phases[i]) * amp : 0;
      if (hop && moving) x = Math.sin(this.phase) * 0.8 * (i < 2 ? -1 : 1);
      if (flail) x = Math.sin(p.t * 20 + i * 1.7) * 0.9;
      l.rotation.x = damp(l.rotation.x, x, 20, dt);
    });
    // body bob / hop / waddle
    const bob = moving ? (hop ? Math.max(0, Math.sin(this.phase)) * 0.12 : Math.abs(Math.sin(this.phase)) * (biped ? 0.03 : 0.02)) : 0;
    R.body.position.y = damp(R.body.position.y, bob, 25, dt);
    R.body.rotation.z = moving && (biped || R.kind === 'sheep') ? Math.sin(this.phase) * 0.12 : damp(R.body.rotation.z, 0, 8, dt);
    if (hop) R.body.rotation.x = moving ? -Math.cos(this.phase) * 0.18 : 0;
    // head: chickens jerk, peck when eating; quadrupeds graze; wolf howls
    let hx = 0, hz = 0;
    if (p.mode === 'eat') { this.peck += dt * (biped ? 9 : 2); hx = biped ? (Math.sin(this.peck) > 0.3 ? 1.1 : 0.2) : 0.7 + Math.sin(this.peck) * 0.08; }
    if (p.mode === 'howl') hx = -0.9;
    const crowing = R.kind === 'rooster' && p.excite > 0.6;   // head thrown back, wings flapping
    if (crowing) hx = -0.75;
    if (biped && moving) hz = Math.sin(this.phase * 2) * 0.04;
    R.head.rotation.x = damp(R.head.rotation.x, hx, 14, dt);
    R.head.position.z += (hz - (R.head.userData.hz ?? 0)); R.head.userData.hz = hz;
    if (R.jaw) R.jaw.rotation.x = damp(R.jaw.rotation.x, p.mode === 'bite' ? 0.6 + Math.sin(p.t * 25) * 0.3 : p.mode === 'howl' ? 0.5 : moving && p.run ? 0.25 : 0, 20, dt);
    // tail wag / swish
    if (R.tail) {
      const wag = R.kind === 'dog' ? Math.sin(p.t * (10 + p.excite * 12)) * (0.4 + p.excite * 0.4)
        : R.kind === 'cow' ? Math.sin(p.t * 1.6) * 0.35 : R.kind === 'cat' ? Math.sin(p.t * 1.2) * 0.4 : Math.sin(p.t * 3) * 0.15;
      if (R.kind === 'turkey') {   // the fan pops up when it's angry
        R.tail.rotation.x = damp(R.tail.rotation.x, 0.9 - p.excite * 0.95, 8, dt);
        R.tail.scale.setScalar(damp(R.tail.scale.x, 0.6 + p.excite * 0.45, 8, dt));
        R.tail.rotation.z = p.excite > 0.3 ? Math.sin(p.t * 22) * 0.04 : 0;   // rattle
      } else R.tail.rotation.y = wag;
    }
    // wings flap when running / falling
    for (const [i, w] of R.wings.entries()) {
      const s = i === 0 ? -1 : 1;
      const f = p.run || flail || crowing ? Math.sin(p.t * 30) * 0.9 + 0.6 : 0;
      w.rotation.z = damp(w.rotation.z, s * -f, 30, dt);
    }
    // ear twitch
    for (const [i, e] of R.ears.entries()) e.rotation.x = Math.sin(p.t * 1.3 + i) > 0.97 ? 0.3 : damp(e.rotation.x, flail ? Math.sin(p.t * 15 + i) * 0.5 : 0, 12, dt);
    // limp: head and legs show their physical rotation
    this.limpT = damp(this.limpT, p.limp ? 1 : 0, p.limp ? 25 : 8, dt);
    if (this.limpT > 0.01 && p.rel) {
      R.head.quaternion.slerp(p.rel[0], this.limpT);
      R.legs.forEach((l, i) => { if (p.rel![i + 1]) l.quaternion.slerp(p.rel![i + 1], this.limpT); });
    }
    // blink
    if (p.t > this.blinkAt) this.blinkAt = p.t + 2 + Math.random() * 4;
    const shut = flail ? 0.2 : this.blinkAt - p.t < 0.12 ? 0.1 : 1;
    for (const e of R.eyes) e.scale.y = damp(e.scale.y, shut, 30, dt);
  }
}
