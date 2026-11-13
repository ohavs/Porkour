import * as THREE from 'three';
import { toonMat } from '../render/toon';

/** Hind-hip hinge (stand-up pivot) and leg top height, in metres. Pig faces +z, origin on the ground. */
export const HIP_Y = 0.30;
export const PIVOT = new THREE.Vector3(0, HIP_Y, -0.30);
/** Standing on the hind legs: where the upper body hinges to, and how far it tips back. */
export const STAND_POS = new THREE.Vector3(0, PIVOT.y + 0.1, PIVOT.z + 0.05);
export const STAND_ANGLE = 1.25;
/** Neck pivot (head turns about it), head centre, snout tip — model space. */
export const NECK = new THREE.Vector3(0, 0.62, 0.26);
export const HEAD_C = new THREE.Vector3(0, 0.63, 0.44);
export const SNOUT_TIP = new THREE.Vector3(0, 0.58, 0.78);
/** Leg hinge points (front legs ride the upper body). Order = frontL, frontR, hindL, hindR. */
export const HIPS = [new THREE.Vector3(0.19, HIP_Y, 0.3), new THREE.Vector3(-0.19, HIP_Y, 0.3),
  new THREE.Vector3(0.2, HIP_Y, -0.3), new THREE.Vector3(-0.2, HIP_Y, -0.3)];

export interface PigRig {
  upper: THREE.Group;                 // body, head, front legs, ears, tail (rotates about PIVOT)
  head: THREE.Group;                  // head, snout, eyes, ears, hat (turns about NECK, child of upper)
  hindL: THREE.Group; hindR: THREE.Group; frontL: THREE.Group; frontR: THREE.Group;
  earL: THREE.Group; earR: THREE.Group; tail: THREE.Group; eyes: THREE.Group[];
  hatAnchor: THREE.Group;
  /** Cosmetic anchors (children of upper): head top, glasses, snout (moustache), chin (beard), neck, back. */
  anchors: Record<'head' | 'eyes' | 'snout' | 'chin' | 'neck' | 'back' | 'party', THREE.Group>;
  skin: { mat: THREE.MeshToonMaterial; base: THREE.Color }[];
  bodyMat: THREE.MeshToonMaterial; snoutMat: THREE.MeshToonMaterial;
}

const PINK = 0xffa9c2, SNOUT = 0xff8fb0, HOOF = 0x6b4048, DARK = 0x5b2234;

/** A fat, round, long cartoon pig built from smooth shapes (cel shaded). Returns a rig for procedural animation. */
export function buildPig(base: THREE.Group): PigRig {
  const skin: PigRig['skin'] = [];
  const skinMat = (c: number) => { const m = toonMat(c); skin.push({ mat: m, base: new THREE.Color(c) }); return m; };
  const body = skinMat(PINK), snoutM = skinMat(SNOUT), hoofM = toonMat(HOOF);
  const white = toonMat(0xffffff), black = toonMat(0x1b1010), nostril = toonMat(DARK), blush = toonMat(0xff7d9c);
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, p: [number, number, number], parent: THREE.Object3D, s?: [number, number, number]) => {
    const o = new THREE.Mesh(g, m); o.position.set(...p); if (s) o.scale.set(...s);
    o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
  };

  const upper = new THREE.Group(); upper.position.copy(PIVOT); base.add(upper);
  const U = (x: number, y: number, z: number): [number, number, number] => [x - PIVOT.x, y - PIVOT.y, z - PIVOT.z];
  const head = new THREE.Group(); head.position.set(...U(NECK.x, NECK.y, NECK.z)); upper.add(head);
  const H = (x: number, y: number, z: number): [number, number, number] => [x - NECK.x, y - NECK.y, z - NECK.z];

  // body: pear-shaped ellipsoid (bigger bum)
  const bg = new THREE.SphereGeometry(1, 40, 28);
  const p = bg.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i), k = 1 + Math.max(0, -z) * 0.09 - Math.max(0, z) * 0.04;
    p.setX(i, p.getX(i) * k); p.setY(i, p.getY(i) * k - (p.getY(i) < 0 ? 0.04 : 0));
  }
  bg.computeVertexNormals();
  mesh(bg, body, U(0, 0.5, -0.02), upper, [0.37, 0.34, 0.55]);
  // head
  mesh(new THREE.SphereGeometry(0.28, 32, 24), body, H(0, 0.63, 0.42), head, [1, 0.96, 1]);
  // snout + nostrils
  const sn = mesh(new THREE.CylinderGeometry(0.13, 0.145, 0.15, 28), snoutM, H(0, 0.58, 0.68), head);
  sn.rotation.x = Math.PI / 2;
  for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.03, 12, 8), nostril, H(s * 0.045, 0.585, 0.755), head, [1, 1.25, 0.45]);
  // eyes (white, pupil, highlight) — grouped so they can blink
  const eyes: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Group(); e.position.set(...H(s * 0.12, 0.74, 0.6)); head.add(e);
    mesh(new THREE.SphereGeometry(0.068, 20, 14), white, [0, 0, 0], e);
    mesh(new THREE.SphereGeometry(0.04, 16, 12), black, [s * 0.006, 0.004, 0.05], e);
    const hl = mesh(new THREE.SphereGeometry(0.014, 8, 6), white, [s * -0.012, 0.022, 0.085], e); hl.castShadow = false;
    eyes.push(e);
  }
  for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.06, 14, 10), blush, H(s * 0.2, 0.6, 0.58), head, [1, 0.6, 0.35]).castShadow = false;
  // ears: flat floppy triangles, pivot at the base
  const earG = new THREE.ConeGeometry(0.12, 0.24, 4, 1).translate(0, 0.12, 0);
  const ear = (s: number) => {
    const g = new THREE.Group(); g.position.set(...H(s * 0.16, 0.85, 0.38)); head.add(g);
    const m = mesh(earG, body, [0, 0, 0], g, [1, 1, 0.32]); m.rotation.y = Math.PI / 4;
    g.rotation.set(0.55, 0, -s * 0.55);
    return g;
  };
  const earL = ear(1), earR = ear(-1);
  // curly tail
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, a = t * Math.PI * 3.2, r = 0.065 * (1 - t * 0.45);
    pts.push(new THREE.Vector3(Math.cos(a) * r - 0.065, Math.sin(a) * r, -t * 0.1));
  }
  const tail = new THREE.Group(); tail.position.set(...U(0, 0.62, -0.58)); upper.add(tail);
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.022, 8), body, [0, 0, 0], tail);
  // legs: pivot at the hip, stubby capsule + hoof
  const legG = new THREE.CapsuleGeometry(0.085, 0.17, 6, 14).translate(0, -0.16, 0);
  const hoofG = new THREE.CylinderGeometry(0.078, 0.09, 0.07, 16).translate(0, -0.27, 0);
  const leg = (x: number, z: number, parent: THREE.Object3D, front: boolean) => {
    const g = new THREE.Group();
    if (front) g.position.set(...U(x, HIP_Y, z)); else g.position.set(x, HIP_Y, z);
    parent.add(g);
    mesh(legG, body, [0, 0, 0], g); mesh(hoofG, hoofM, [0, 0, 0], g);
    return g;
  };
  const frontL = leg(0.19, 0.3, upper, true), frontR = leg(-0.19, 0.3, upper, true);
  const hindL = leg(0.2, -0.3, base, false), hindR = leg(-0.2, -0.3, base, false);
  const hatAnchor = new THREE.Group(); hatAnchor.position.set(...H(0.06, 0.88, 0.4)); hatAnchor.rotation.set(0.15, 0, -0.3); head.add(hatAnchor);
  const anchor = (p: [number, number, number], r: [number, number, number] = [0, 0, 0], onHead = true) => {
    const g = new THREE.Group(); g.position.set(...(onHead ? H(...p) : U(...p))); g.rotation.set(...r); (onHead ? head : upper).add(g); return g;
  };
  const anchors = {
    party: hatAnchor,
    head: anchor([0, 0.885, 0.41], [0.12, 0, 0]),
    eyes: anchor([0, 0.745, 0.665]),
    snout: anchor([0, 0.53, 0.765]),
    chin: anchor([0, 0.43, 0.58]),
    neck: anchor([0, 0.5, 0.33], [-0.35, 0, 0], false),
    back: anchor([0, 0.83, 0.12], [0, 0, 0], false),
  };
  anchors.head.scale.setScalar(1.5);   // items are modelled at ~2/3 of the head: scale the whole slot
  anchors.neck.scale.setScalar(1.4);
  return { upper, head, hindL, hindR, frontL, frontR, earL, earR, tail, eyes, hatAnchor, anchors, skin, bodyMat: body, snoutMat: snoutM };
}
