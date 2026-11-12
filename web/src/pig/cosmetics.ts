import * as THREE from 'three';
import { toonMat } from '../render/toon';
import { has, fitted } from '../core/assets';
import type { PigRig } from './pigModel';

/**
 * Pig wardrobe: skins, hats, hair, beards, glasses, neck and back items.
 * Pack items (KayKit Adventurers / Skeletons / Halloween, CC0) are loaded as GLB; the rest are hand-modelled here
 * in the same cel-shaded style as the pig. Every item attaches to an anchor of the pig rig.
 */
export type Slot = 'skin' | 'hat' | 'hair' | 'face' | 'eyes' | 'neck' | 'back';
export interface Outfit { skin: string; hat: string; hair: string; face: string; eyes: string; neck: string; back: string }
export const SLOTS: Slot[] = ['skin', 'hat', 'hair', 'face', 'eyes', 'neck', 'back'];
export const defaultOutfit = (): Outfit => ({ skin: 'pink', hat: 'party', hair: '', face: '', eyes: '', neck: '', back: '' });

type Anchor = keyof PigRig['anchors'];
interface Item { id: string; anchor: Anchor; build: (color: number) => THREE.Object3D; pack?: boolean; hidesHair?: boolean }

export const SKINS: Record<string, { body: number; snout: number; extra?: 'spots' | 'boar' }> = {
  pink: { body: 0xffa9c2, snout: 0xff8fb0 }, rose: { body: 0xff8fb0, snout: 0xff6f98 }, peach: { body: 0xffc9a8, snout: 0xffaa88 },
  tan: { body: 0xdcab76, snout: 0xc98a5b }, brown: { body: 0x9a6440, snout: 0x7e4f33 }, black: { body: 0x4b3c41, snout: 0x5e474e },
  spotted: { body: 0xffb3c7, snout: 0xff96b4, extra: 'spots' }, boar: { body: 0x80583a, snout: 0x5e3f2a, extra: 'boar' },
  gold: { body: 0xffd166, snout: 0xf2b84b }, mint: { body: 0xa8e6cf, snout: 0x86d6b6 }, lilac: { body: 0xd6bcff, snout: 0xc2a1ff },
};

// ---------------------------------------------------------------- helpers
const S = new THREE.SphereGeometry(1, 24, 16);
const mats = new Map<number, THREE.MeshToonMaterial>();
const M = (c: number) => { let m = mats.get(c); if (!m) { m = toonMat(c); mats.set(c, m); } return m; };
type V = [number, number, number];
function add(g: THREE.BufferGeometry, c: number | THREE.Material, p: V, parent: THREE.Object3D, s?: V, r?: V) {
  const o = new THREE.Mesh(g, typeof c === 'number' ? M(c) : c);
  o.position.set(...p); if (s) o.scale.set(...s); if (r) o.rotation.set(...r);
  o.castShadow = true; parent.add(o); return o;
}
const G0 = () => new THREE.Group();
const tube = (pts: V[], r: number) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 24, r, 8);
function shapeGeo(draw: (s: THREE.Shape) => void, depth = 0.02) {
  const sh = new THREE.Shape(); draw(sh);
  return new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2 }).center();
}
const heart = (s: THREE.Shape, k = 0.07) => {
  s.moveTo(0, -k * 0.9); s.bezierCurveTo(-k * 1.4, -k * 0.1, -k * 0.9, k * 1.1, 0, k * 0.45); s.bezierCurveTo(k * 0.9, k * 1.1, k * 1.4, -k * 0.1, 0, -k * 0.9);
};
const star = (s: THREE.Shape, r = 0.08) => {
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + Math.PI / 2, rr = i % 2 ? r * 0.45 : r; i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
};
/** KayKit model fitted to a width, optional extra rotation / offset. */
function pack(name: string, width: number, rot: V = [0, 0, 0], off: V = [0, 0, 0]) {
  return () => {
    const g = G0();
    if (!has(name)) return g;
    const m = fitted(name, { width, cast: true });
    m.rotation.set(...rot); m.position.set(...off);
    g.add(m); return g;
  };
}

// ---------------------------------------------------------------- hats (anchor: head top, y up, z forward)
const HATS: Item[] = [
  { id: 'party', anchor: 'party', build: (c) => {
    const g = G0();
    const cone = add(new THREE.ConeGeometry(0.13, 0.32, 20), c, [0, 0.14, 0], g);
    add(new THREE.SphereGeometry(0.05, 12, 8), 0xffffff, [0, 0.17, 0], cone);
    add(new THREE.TorusGeometry(0.12, 0.022, 8, 24), 0xffffff, [0, -0.14, 0], cone, undefined, [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 5; i++) add(new THREE.SphereGeometry(0.018, 8, 6), [0xffe066, 0x7ee0ff, 0xff7fb5][i % 3], [Math.cos(i * 2.4) * 0.07, -0.05 + i * 0.045, Math.sin(i * 2.4) * 0.07], cone);
    return g;
  } },
  { id: 'top', anchor: 'head', hidesHair: true, build: () => {
    const g = G0();
    add(new THREE.CylinderGeometry(0.235, 0.235, 0.022, 32), 0x1f1b22, [0, 0.0, 0], g);
    add(new THREE.CylinderGeometry(0.14, 0.13, 0.27, 28), 0x1f1b22, [0, 0.14, 0], g);
    add(new THREE.CylinderGeometry(0.133, 0.133, 0.05, 28), 0xc0392b, [0, 0.04, 0], g);
    add(new THREE.SphereGeometry(0.025, 10, 8), 0xffd166, [0.1, 0.05, 0.08], g);
    g.rotation.z = -0.12; return g;
  } },
  { id: 'cowboy', anchor: 'head', hidesHair: true, build: () => {
    const g = G0(); const brown = 0x9a6a3c;
    add(S, brown, [0, 0, 0], g, [0.34, 0.03, 0.3]);
    for (const s of [-1, 1]) add(new THREE.TorusGeometry(0.16, 0.035, 8, 20, Math.PI), brown, [s * 0.28, 0.03, 0], g, [0.3, 0.55, 1.3], [0, Math.PI / 2, s * 0.6]);
    add(S, brown, [0, 0.11, 0], g, [0.15, 0.14, 0.17]);
    add(new THREE.CylinderGeometry(0.152, 0.16, 0.04, 24), 0x4a2c16, [0, 0.03, 0], g, [1, 1, 1.12]);
    add(S, 0x7a5230, [0, 0.235, 0], g, [0.07, 0.02, 0.1]);     // dent
    return g;
  } },
  { id: 'sombrero', anchor: 'head', hidesHair: true, build: () => {
    const g = G0();
    const pts = [new THREE.Vector2(0.001, 0.0), new THREE.Vector2(0.44, 0.0), new THREE.Vector2(0.47, 0.06), new THREE.Vector2(0.43, 0.05),
      new THREE.Vector2(0.2, 0.03), new THREE.Vector2(0.15, 0.08), new THREE.Vector2(0.12, 0.3), new THREE.Vector2(0.07, 0.38), new THREE.Vector2(0.001, 0.39)];
    add(new THREE.LatheGeometry(pts, 36), toonMat(0xf2c25a, { side: THREE.DoubleSide }), [0, 0, 0], g);
    for (const [y, r, c] of [[0.1, 0.145, 0xd8403a], [0.15, 0.135, 0x3fae5a], [0.2, 0.125, 0xffffff]] as const)
      add(new THREE.TorusGeometry(r, 0.014, 6, 28), c, [0, y, 0], g, undefined, [Math.PI / 2, 0, 0]);
    add(new THREE.TorusGeometry(0.455, 0.014, 6, 40), 0xd8403a, [0, 0.055, 0], g, undefined, [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; add(new THREE.SphereGeometry(0.018, 8, 6), 0xd8403a, [Math.cos(a) * 0.47, 0.03, Math.sin(a) * 0.47], g); }
    g.scale.setScalar(0.78); g.rotation.x = -0.08;
    return g;
  } },
  { id: 'chef', anchor: 'head', hidesHair: true, build: () => {
    const g = G0();
    add(new THREE.CylinderGeometry(0.13, 0.13, 0.13, 24), 0xffffff, [0, 0.06, 0], g);
    for (const [x, z, s] of [[0, 0, 0.13], [0.08, 0.04, 0.09], [-0.08, 0.03, 0.09], [0.02, -0.08, 0.09], [-0.03, 0.09, 0.08]] as const) add(S, 0xffffff, [x, 0.19, z], g, [s, s * 0.85, s]);
    return g;
  } },
  { id: 'crown', anchor: 'head', build: () => {
    const g = G0(); const gold = toonMat(0xffc93c, { emissive: new THREE.Color(0x553300), side: THREE.DoubleSide });
    add(new THREE.CylinderGeometry(0.13, 0.12, 0.09, 24, 1, true), gold, [0, 0.04, 0], g);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      add(new THREE.ConeGeometry(0.03, 0.08, 6), gold, [Math.cos(a) * 0.125, 0.12, Math.sin(a) * 0.125], g);
      add(new THREE.SphereGeometry(0.018, 8, 6), i % 2 ? 0xe8322f : 0x3a7bd5, [Math.cos(a) * 0.13, 0.04, Math.sin(a) * 0.13], g);
    }
    g.rotation.z = 0.15; return g;
  } },
  { id: 'propeller', anchor: 'head', hidesHair: true, build: () => {
    const g = G0();
    const cols = [0xd8403a, 0xffd166, 0x3a7bd5, 0x3fae5a];
    for (let i = 0; i < 4; i++) add(new THREE.SphereGeometry(0.15, 16, 8, (i * Math.PI) / 2, Math.PI / 2, 0, Math.PI / 2), cols[i], [0, 0, 0], g, [1, 0.75, 1]);
    add(new THREE.CylinderGeometry(0.01, 0.01, 0.07, 6), 0x555555, [0, 0.14, 0], g);
    const prop = G0(); prop.position.y = 0.18; prop.name = 'spin'; g.add(prop);
    for (const s of [-1, 1]) add(S, s > 0 ? 0xd8403a : 0x3a7bd5, [s * 0.09, 0, 0], prop, [0.09, 0.008, 0.025], [0.25 * s, 0, 0]);
    return g;
  } },
  { id: 'cap', anchor: 'head', build: (c) => {
    const g = G0();
    add(new THREE.SphereGeometry(0.15, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), c, [0, -0.01, 0], g, [1, 0.8, 1.05]);
    add(new THREE.CylinderGeometry(0.15, 0.15, 0.015, 24, 1, false, -Math.PI / 2, Math.PI), c, [0, 0.0, 0.07], g, [0.9, 1, 1.25]);
    add(new THREE.SphereGeometry(0.02, 8, 6), 0xffffff, [0, 0.115, 0], g);
    return g;
  } },
  { id: 'beanie', anchor: 'head', hidesHair: true, build: (c) => {
    const g = G0();
    add(new THREE.SphereGeometry(0.15, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), c, [0, 0, 0], g, [1, 1.15, 1]);
    add(new THREE.TorusGeometry(0.145, 0.035, 8, 24), 0xffffff, [0, 0.01, 0], g, [1, 1, 0.9], [Math.PI / 2, 0, 0]);
    add(new THREE.IcosahedronGeometry(0.05, 1), 0xffffff, [0, 0.19, 0], g);
    return g;
  } },
  { id: 'straw', anchor: 'head', hidesHair: true, build: () => {
    const g = G0();
    add(new THREE.CylinderGeometry(0.33, 0.35, 0.02, 32), 0xf0cb6c, [0, 0, 0], g);
    add(new THREE.CylinderGeometry(0.15, 0.17, 0.14, 24), 0xf0cb6c, [0, 0.07, 0], g);
    add(S, 0xf0cb6c, [0, 0.14, 0], g, [0.15, 0.04, 0.15]);
    add(new THREE.CylinderGeometry(0.172, 0.172, 0.04, 24), 0xb33b2b, [0, 0.03, 0], g);
    add(new THREE.SphereGeometry(0.035, 10, 8), 0xffe066, [0.15, 0.06, 0.06], g);
    return g;
  } },
  { id: 'flowers', anchor: 'head', build: () => {
    const g = G0();
    add(new THREE.TorusGeometry(0.15, 0.018, 6, 24), 0x58a64a, [0, 0, 0], g, undefined, [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2, c = [0xff7fb5, 0xffe066, 0xffffff, 0xb18cff][i % 4];
      const f = G0(); f.position.set(Math.cos(a) * 0.15, 0.015, Math.sin(a) * 0.15); g.add(f);
      for (let k = 0; k < 5; k++) { const b = (k / 5) * Math.PI * 2; add(new THREE.SphereGeometry(0.018, 8, 6), c, [Math.cos(b) * 0.022, 0.01, Math.sin(b) * 0.022], f); }
      add(new THREE.SphereGeometry(0.014, 8, 6), 0xffb02e, [0, 0.018, 0], f);
    }
    return g;
  } },
  { id: 'wizard', anchor: 'head', hidesHair: true, pack: true, build: pack('cosm/wizard_hat', 0.42, [0, 0, 0], [0, -0.04, 0]) },
  { id: 'viking', anchor: 'head', hidesHair: true, pack: true, build: pack('cosm/viking_helmet', 0.46, [0, 0, 0], [0, -0.19, 0.01]) },
  { id: 'knight', anchor: 'head', hidesHair: true, pack: true, build: pack('cosm/knight_helmet', 0.44, [0, 0, 0], [0, -0.2, 0]) },
  { id: 'skull', anchor: 'head', hidesHair: true, pack: true, build: pack('cosm/skull_helmet', 0.46, [0, 0, 0], [0, -0.2, 0]) },
  { id: 'darkWizard', anchor: 'head', hidesHair: true, pack: true, build: pack('cosm/dark_wizard_hat', 0.42, [0, 0, 0], [0, -0.04, 0]) },
  { id: 'hood', anchor: 'head', hidesHair: true, pack: true, build: pack('cosm/hood', 0.5, [0, 0, 0], [0, -0.3, -0.05]) },
  { id: 'pumpkin', anchor: 'head', hidesHair: true, pack: true, build: pack('kaykit/pumpkin_orange_jackolantern', 0.5, [0, 0, 0], [0, -0.32, 0.02]) },
];

// ---------------------------------------------------------------- hair (head top)
const HAIR_C = 0x5a3a24;
const HAIR: Item[] = [
  { id: 'mohawk', anchor: 'head', build: () => {
    const g = G0();
    for (let i = 0; i < 6; i++) add(new THREE.ConeGeometry(0.04, 0.16 - Math.abs(i - 2.5) * 0.02, 8), 0xff4fa3, [0, 0.06, 0.12 - i * 0.055], g, [0.6, 1, 1.4], [-0.3 + i * 0.12, 0, 0]);
    return g;
  } },
  { id: 'curls', anchor: 'head', build: () => {
    const g = G0();
    for (let i = 0; i < 14; i++) { const a = i * 2.4, r = 0.03 + (i % 5) * 0.022; add(new THREE.IcosahedronGeometry(0.045, 1), HAIR_C, [Math.cos(a) * r, 0.02 + (i % 3) * 0.015, Math.sin(a) * r + 0.02], g); }
    return g;
  } },
  { id: 'bunches', anchor: 'head', build: () => {
    const g = G0();
    add(S, 0xd9862e, [0, 0.0, 0.0], g, [0.13, 0.045, 0.14]);
    for (const s of [-1, 1]) {
      add(S, 0xd9862e, [s * 0.2, -0.04, -0.02], g, [0.06, 0.09, 0.06], [0, 0, s * 0.6]);
      add(new THREE.TorusGeometry(0.03, 0.01, 6, 12), 0x3a7bd5, [s * 0.16, 0.0, -0.02], g, undefined, [0, Math.PI / 2, s * 0.6]);
    }
    return g;
  } },
  { id: 'fringe', anchor: 'head', build: () => {
    const g = G0();
    add(S, 0x1f1b22, [0, 0.0, 0.0], g, [0.15, 0.05, 0.15]);
    add(S, 0x1f1b22, [0.05, -0.06, 0.14], g, [0.12, 0.05, 0.06], [0.6, 0, -0.5]);
    return g;
  } },
  { id: 'afro', anchor: 'head', build: () => {
    const g = G0();
    for (let i = 0; i < 22; i++) { const u = (i / 22) * 2 - 1, a = i * 2.39996, r = Math.sqrt(1 - u * u); add(new THREE.IcosahedronGeometry(0.07, 1), 0x3a2418, [Math.cos(a) * r * 0.16, 0.08 + u * 0.1, Math.sin(a) * r * 0.16 - 0.02], g); }
    add(S, 0x3a2418, [0, 0.08, -0.02], g, [0.17, 0.13, 0.17]);
    return g;
  } },
  { id: 'bun', anchor: 'head', build: () => {
    const g = G0();
    add(S, 0x8a5a2b, [0, -0.01, 0], g, [0.14, 0.04, 0.14]);
    add(S, 0x8a5a2b, [0, 0.07, -0.02], g, [0.07, 0.065, 0.07]);
    add(new THREE.TorusGeometry(0.05, 0.012, 6, 14), 0xff7fb5, [0, 0.035, -0.02], g, undefined, [Math.PI / 2, 0, 0]);
    return g;
  } },
];

// ---------------------------------------------------------------- face (snout / chin)
const STACHE = 0x6b4226;
const FACE: Item[] = [
  { id: 'handlebar', anchor: 'snout', build: () => {
    const g = G0();
    add(S, STACHE, [0, 0, 0.01], g, [0.07, 0.03, 0.03]);
    for (const s of [-1, 1]) add(tube([[0, 0, 0.01], [s * 0.07, -0.01, 0.0], [s * 0.13, 0.02, -0.02], [s * 0.14, 0.06, -0.02], [s * 0.11, 0.06, -0.01]], 0.018), STACHE, [0, 0, 0], g);
    return g;
  } },
  { id: 'walrus', anchor: 'snout', build: () => {
    const g = G0();
    for (const s of [-1, 1]) add(S, 0xe8e2d6, [s * 0.06, -0.035, 0.0], g, [0.075, 0.06, 0.035], [0, 0, s * 0.35]);
    return g;
  } },
  { id: 'goatee', anchor: 'chin', build: () => {
    const g = G0();
    add(new THREE.ConeGeometry(0.05, 0.14, 10), STACHE, [0, -0.06, 0.06], g, [1, 1, 0.6], [Math.PI, 0, 0]);
    return g;
  } },
  { id: 'beard', anchor: 'chin', build: () => {
    const g = G0();
    add(S, 0xb5794a, [0, -0.04, 0.02], g, [0.2, 0.15, 0.13]);
    add(S, 0xb5794a, [0, -0.15, 0.05], g, [0.12, 0.1, 0.08]);
    for (const s of [-1, 1]) add(S, 0xb5794a, [s * 0.16, 0.08, -0.04], g, [0.06, 0.12, 0.08]);
    return g;
  } },
  { id: 'chops', anchor: 'chin', build: () => {
    const g = G0();
    for (const s of [-1, 1]) add(S, 0x8a5a2b, [s * 0.2, 0.12, -0.06], g, [0.06, 0.12, 0.09], [0, 0, s * 0.2]);
    return g;
  } },
];

// ---------------------------------------------------------------- glasses (eye anchor: centre between the eyes, in front)
const rimG = new THREE.TorusGeometry(0.075, 0.011, 8, 28);
function frame(g: THREE.Group, c: number) {
  add(tube([[-0.045, 0.01, 0.0], [0, 0.03, 0.01], [0.045, 0.01, 0.0]], 0.008), c, [0, 0, 0], g);
  for (const s of [-1, 1]) add(tube([[s * 0.19, 0.0, -0.01], [s * 0.24, 0.0, -0.12], [s * 0.23, -0.02, -0.2]], 0.008), c, [0, 0, 0], g);
}
const lensMat = () => toonMat(0xcfeaff, { transparent: true, opacity: 0.35 });
const EYES: Item[] = [
  { id: 'round', anchor: 'eyes', build: () => {
    const g = G0(); frame(g, 0x2b2b2b);
    for (const s of [-1, 1]) { add(rimG, 0x2b2b2b, [s * 0.12, 0, 0], g); add(new THREE.CircleGeometry(0.072, 24), lensMat(), [s * 0.12, 0, 0.002], g).castShadow = false; }
    return g;
  } },
  { id: 'shades', anchor: 'eyes', build: () => {
    const g = G0(); frame(g, 0x111111);
    for (const s of [-1, 1]) add(S, 0x111111, [s * 0.12, -0.005, 0.0], g, [0.085, 0.065, 0.015]);
    add(new THREE.BoxGeometry(0.4, 0.02, 0.02), 0x111111, [0, 0.055, 0], g);
    return g;
  } },
  { id: 'monocle', anchor: 'eyes', build: () => {
    const g = G0();
    add(rimG, 0xffc93c, [-0.12, 0, 0.005], g);
    add(new THREE.CircleGeometry(0.072, 24), lensMat(), [-0.12, 0, 0.006], g).castShadow = false;
    add(tube([[-0.19, -0.03, 0.0], [-0.22, -0.15, 0.02], [-0.2, -0.28, 0.05]], 0.005), 0xffc93c, [0, 0, 0], g);
    return g;
  } },
  { id: 'hearts', anchor: 'eyes', build: () => {
    const g = G0(); frame(g, 0xd8403a);
    const geo = shapeGeo((s) => heart(s, 0.075));
    for (const s of [-1, 1]) add(geo, toonMat(0xff5a8a, { transparent: true, opacity: 0.85 }), [s * 0.12, 0, 0], g);
    return g;
  } },
  { id: 'stars', anchor: 'eyes', build: () => {
    const g = G0(); frame(g, 0xffb02e);
    const geo = shapeGeo((s) => star(s, 0.095));
    for (const s of [-1, 1]) add(geo, toonMat(0xffd166, { transparent: true, opacity: 0.9 }), [s * 0.12, 0, 0], g);
    return g;
  } },
  { id: 'goggles', anchor: 'eyes', build: () => {
    const g = G0();
    add(new THREE.TorusGeometry(0.27, 0.025, 8, 32), 0x6b4226, [0, 0, -0.2], g, [1, 0.35, 1], [Math.PI / 2, 0, 0]);
    for (const s of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.075, 0.08, 0.06, 20), 0xc89b4a, [s * 0.12, 0, 0], g, undefined, [Math.PI / 2, 0, 0]);
      add(new THREE.CircleGeometry(0.06, 20), toonMat(0x7ad0ff, { transparent: true, opacity: 0.7 }), [s * 0.12, 0, 0.031], g).castShadow = false;
    }
    return g;
  } },
];

// ---------------------------------------------------------------- neck (anchor axis = body axis)
const NECK: Item[] = [
  { id: 'bowtie', anchor: 'neck', build: () => {
    const g = G0(); const c = 0xd8403a;
    for (const s of [-1, 1]) add(new THREE.ConeGeometry(0.06, 0.1, 4), c, [s * 0.05, -0.2, 0.17], g, [1, 1, 0.5], [0, 0, s * Math.PI / 2]);
    add(S, c, [0, -0.2, 0.18], g, [0.03, 0.03, 0.025]);
    for (const [x, y] of [[-0.06, -0.19], [0.05, -0.21], [0.07, -0.18]] as const) add(new THREE.SphereGeometry(0.01, 6, 4), 0xffffff, [x, y, 0.2], g);
    return g;
  } },
  { id: 'scarf', anchor: 'neck', build: () => {
    const g = G0();
    add(new THREE.TorusGeometry(0.22, 0.06, 10, 28), 0xd8403a, [0, 0, 0], g, [1.05, 1, 1]);
    add(new THREE.BoxGeometry(0.1, 0.24, 0.035), 0xd8403a, [0.12, -0.27, 0.12], g, undefined, [0.3, 0, 0.25]);
    for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.102, 0.03, 0.037), 0xffffff, [0.12 + i * 0.008, -0.2 - i * 0.07, 0.14 - i * 0.02], g, undefined, [0.3, 0, 0.25]);
    return g;
  } },
  { id: 'bandana', anchor: 'neck', build: () => {
    const g = G0();
    add(new THREE.TorusGeometry(0.21, 0.025, 8, 28), 0x2f6fd6, [0, 0, 0], g);
    add(new THREE.ConeGeometry(0.15, 0.2, 3), 0x2f6fd6, [0, -0.25, 0.1], g, [1, 1, 0.25], [0.15, 0, Math.PI]);
    return g;
  } },
  { id: 'bell', anchor: 'neck', build: () => {
    const g = G0();
    add(new THREE.TorusGeometry(0.215, 0.022, 8, 28), 0x6b4226, [0, 0, 0], g);
    const pts = [new THREE.Vector2(0.001, 0), new THREE.Vector2(0.03, 0), new THREE.Vector2(0.035, -0.04), new THREE.Vector2(0.06, -0.1), new THREE.Vector2(0.001, -0.1)];
    add(new THREE.LatheGeometry(pts, 16), toonMat(0xffc93c, { side: THREE.DoubleSide }), [0, -0.22, 0.06], g);
    add(new THREE.SphereGeometry(0.02, 8, 6), 0x8a6a2a, [0, -0.325, 0.06], g);
    return g;
  } },
  { id: 'chain', anchor: 'neck', build: () => {
    const g = G0();
    add(new THREE.TorusGeometry(0.23, 0.014, 6, 36), 0xffc93c, [0, -0.02, 0], g);
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.015, 20), toonMat(0xffc93c, { emissive: new THREE.Color(0x553300) }), [0, -0.24, 0.1], g, undefined, [Math.PI / 2 - 0.3, 0, 0]);
    return g;
  } },
  { id: 'pearls', anchor: 'neck', build: () => {
    const g = G0();
    for (let i = 0; i < 26; i++) { const a = (i / 26) * Math.PI * 2; add(new THREE.SphereGeometry(0.02, 8, 6), 0xfff8f0, [Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0], g); }
    return g;
  } },
];

// ---------------------------------------------------------------- back (anchor on top of the back, z = toward the head)
const cape = (name: string): Item['build'] => () => {
  const g = G0();
  if (!has(name)) return g;
  const m = fitted(name, { width: 0.62, cast: true });
  // KayKit capes hang down a human back; tip them over so they drape along the pig's back toward the tail
  m.rotation.set(1.25, 0, 0); m.position.set(0, -0.2, -0.64);
  m.name = 'cape'; g.add(m); return g;
};
const BACK: Item[] = [
  { id: 'capeKnight', anchor: 'back', pack: true, build: cape('cosm/cape_knight') },
  { id: 'capeMage', anchor: 'back', pack: true, build: cape('cosm/cape_mage') },
  { id: 'capeBarbarian', anchor: 'back', pack: true, build: cape('cosm/cape_barbarian') },
  { id: 'capeRogue', anchor: 'back', pack: true, build: cape('cosm/cape_rogue') },
  { id: 'wings', anchor: 'back', build: () => {
    const g = G0();
    for (const s of [-1, 1]) {
      const w = G0(); w.position.set(s * 0.14, 0.02, 0); w.name = s < 0 ? 'wingL' : 'wingR'; g.add(w);
      for (let i = 0; i < 4; i++) add(S, 0xffffff, [s * (0.08 + i * 0.05), 0.08 + i * 0.03, -0.04 - i * 0.03], w, [0.1 - i * 0.012, 0.035, 0.07 + i * 0.012], [0, 0, s * (0.4 + i * 0.1)]);
    }
    return g;
  } },
  { id: 'backpack', anchor: 'back', build: () => {
    const g = G0();
    add(new THREE.BoxGeometry(0.26, 0.16, 0.22), 0x3f6fb5, [0, 0.06, -0.08], g);
    add(S, 0x3f6fb5, [0, 0.14, -0.08], g, [0.13, 0.04, 0.11]);
    add(new THREE.BoxGeometry(0.18, 0.08, 0.02), 0x2d5288, [0, 0.04, -0.2], g);
    for (const s of [-1, 1]) add(new THREE.TorusGeometry(0.2, 0.015, 6, 20, Math.PI), 0x2d5288, [s * 0.1, -0.08, 0.02], g, [1, 1, 0.8], [0, Math.PI / 2, 0]);
    return g;
  } },
];

export const ITEMS: Record<Exclude<Slot, 'skin'>, Item[]> = { hat: HATS, hair: HAIR, face: FACE, eyes: EYES, neck: NECK, back: BACK };
export const labelKey = (slot: Slot, id: string) => (id ? `${slot === 'skin' ? 'skin' : slot}.${id}` : 'w.none');

export function randomOutfit(): Outfit {
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  const o = defaultOutfit();
  o.skin = pick(Object.keys(SKINS));
  for (const s of ['hat', 'hair', 'face', 'eyes', 'neck', 'back'] as const) o[s] = Math.random() < (s === 'hat' ? 0.85 : 0.45) ? pick(ITEMS[s]).id : '';
  if (o.hat && ITEMS.hat.find((h) => h.id === o.hat)?.hidesHair) o.hair = '';
  return o;
}

/** Builds / rebuilds the outfit on a pig rig. Returns parts that animate (propeller, wings). */
export function dress(rig: PigRig, o: Outfit, color: number, spots: THREE.Group) {
  for (const a of Object.values(rig.anchors)) for (const c of [...a.children]) if (c.userData.cosmetic) a.remove(c);
  spots.clear();
  const sk = SKINS[o.skin] ?? SKINS.pink;
  rig.bodyMat.color.setHex(sk.body); rig.snoutMat.color.setHex(sk.snout);
  for (const s of rig.skin) s.base.copy(s.mat.color);
  if (sk.extra === 'spots') {
    // directions on the pear-shaped body (centre 0,0.5,-0.02, radii .37/.34/.55)
    for (const [x, y, z, r] of [[0.8, 0.4, 0.1, 0.11], [-0.7, 0.2, -0.5, 0.13], [0.1, 0.9, -0.4, 0.1], [-0.4, 0.7, 0.45, 0.08], [0.6, -0.1, -0.7, 0.09], [-0.85, -0.2, 0.3, 0.07]] as const) {
      const d = new THREE.Vector3(x, y, z).normalize();
      const k = 1 / Math.sqrt((d.x / 0.37) ** 2 + (d.y / 0.34) ** 2 + (d.z / 0.57) ** 2);
      const m = add(S, 0x4b3c41, [d.x * k, 0.5 + d.y * k, -0.02 + d.z * k], spots, [r, r, r * 0.35]);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d); m.castShadow = false;
    }
  }
  if (sk.extra === 'boar') {
    add(S, 0x4e3524, [0, 0.82, -0.1], spots, [0.09, 0.05, 0.5]);
    for (const s of [-1, 1]) add(new THREE.ConeGeometry(0.022, 0.1, 8), 0xfff4dc, [s * 0.11, 0.56, 0.72], spots, undefined, [-0.5, 0, s * -0.4]);
  }
  const anim: THREE.Object3D[] = [];
  const hat = ITEMS.hat.find((i) => i.id === o.hat);
  for (const slot of ['hat', 'hair', 'face', 'eyes', 'neck', 'back'] as const) {
    const it = ITEMS[slot].find((i) => i.id === o[slot]);
    if (!it || (slot === 'hair' && hat?.hidesHair)) continue;
    const obj = it.build(color);
    obj.userData.cosmetic = true;
    obj.traverse((m) => { if ((m as THREE.Mesh).isMesh) { m.castShadow = true; } if (m.name === 'spin' || m.name.startsWith('wing')) anim.push(m); });
    // hair under a small hat sits a bit lower
    rig.anchors[it.anchor].add(obj);
  }
  return anim;
}
