import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RAPIER } from '../core/physics';
import { gltf, instance } from '../core/assets';
import { RAMP } from '../render/toon';
import { googly } from '../render/googly';
import type { LimbDef } from '../core/ragdoll';
import { damp, clamp } from '../core/util';
import { AnimalVisual, type AnimalKind, type AnimalPose } from './animalModels';

/**
 * Animals from Quaternius "Ultimate Animated Animals" (CC0, skinned, 12 clips each). Same interface as the procedural
 * `AnimalVisual`: `root` (origin on the ground between the feet, facing +z), `rig.height`, `update(pose)`.
 * Ragdoll: the neck and the 4 upper legs are bones; while limp each one takes the physical rotation of its part
 * (relative to the rest pose), on top of the playing clip.
 */
/**
 * Goofy on purpose (user: animals and characters as goofy / ragdolly as possible): big head (`head` = scale of the
 * head + ear bones), huge googly eyes, brighter colours (`colors` = new colour per pack material name).
 */
export interface GlbSpec { model: string; size: number; walk: number; gallop: number; head: number; eye: number; colors?: Record<string, number> }
export const GLB_ANIMALS: Partial<Record<AnimalKind, GlbSpec>> = {
  cow: { model: 'animals/Cow', size: 1.75, walk: 0.9, gallop: 3, head: 1.45, eye: 1.6, colors: { Main: 0xfaf6ee, Main_Light: 0x2e2a2a, Muzzle: 0xffa3b5, Horns: 0xf2e3b3 } },
  dog: { model: 'animals/ShibaInu', size: 0.78, walk: 1.0, gallop: 3.5, head: 1.5, eye: 1.4, colors: { Main: 0xe08a3c, Main_Light: 0xfff0d8 } },
  wolf: { model: 'animals/Wolf', size: 1.15, walk: 1.2, gallop: 4.5, head: 1.35, eye: 1.5, colors: { Main: 0x6d7686, Main_Light: 0xc9d0da } },
  horse: { model: 'animals/Horse', size: 2.3, walk: 1.3, gallop: 5, head: 1.35, eye: 1.6 },
  horse2: { model: 'animals/Horse_White', size: 2.3, walk: 1.3, gallop: 5, head: 1.35, eye: 1.6 },
  donkey: { model: 'animals/Donkey', size: 1.65, walk: 1.0, gallop: 3.5, head: 1.45, eye: 1.6, colors: { Main: 0x9a9aa3, Main_Light: 0xdedee3 } },
  alpaca: { model: 'animals/Alpaca', size: 1.9, walk: 1.0, gallop: 3.5, head: 1.5, eye: 1.6, colors: { Main: 0xf2dcc0, Main_Light: 0xfff5e6 } },
};
export const GLB_MODELS = [...new Set(Object.values(GLB_ANIMALS).map((s) => s!.model))];

const LIMB_BONES = ['Neck1', 'FrontUpperLeg.L', 'FrontUpperLeg.R', 'BackUpperLeg.L', 'BackUpperLeg.R'];
let vcMat: THREE.MeshToonMaterial | null = null;
const prepared = new Set<string>();
/**
 * Per model: each eye (left / right) from the pack's eye materials: one vertex index (merged mesh; the eye's vertices
 * are collapsed onto their centre so the small original eye disappears under the googly one), centre + radius
 * (geometry space).
 */
const eyeInfo = new Map<string, { at: number; c: THREE.Vector3; r: number }[]>();

/** Once per model: all primitives → one SkinnedMesh with vertex colours (1 draw call per animal instead of 4–8). */
function prepare(name: string, colors?: Record<string, number>) {
  if (prepared.has(name)) return;
  prepared.add(name);
  const eyes: number[][] = [[], []];
  let base = 0;
  const g = gltf(name); if (!g) return;
  vcMat ??= new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: RAMP });
  const groups = new Map<THREE.Object3D, THREE.SkinnedMesh[]>();
  g.scene.traverse((o) => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh) { const a = groups.get(m.parent!) ?? []; a.push(m); groups.set(m.parent!, a); } });
  for (const [parent, meshes] of groups) {
    const geos = meshes.map((m) => {
      const geo = m.geometry.clone();
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'skinIndex', 'skinWeight'].includes(k)) geo.deleteAttribute(k);
      const mat = m.material as THREE.MeshToonMaterial;
      const c = colors?.[mat.name] !== undefined ? new THREE.Color(colors[mat.name]) : (mat.color ?? new THREE.Color(1, 1, 1)).clone().offsetHSL(0, 0.12, 0.05);
      const n = geo.attributes.position.count, col = new Float32Array(n * 3);
      if (/eye/i.test(mat.name)) {
        const pa = geo.attributes.position;
        for (let i = 0; i < n; i++) eyes[pa.getX(i) > 0 ? 0 : 1].push(base + i);
      }
      base += n;
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      if (!geo.index) geo.setIndex([...Array(n).keys()]);
      return geo;
    });
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const sm = new THREE.SkinnedMesh(merged, vcMat);
    sm.name = 'animal';
    sm.position.copy(meshes[0].position); sm.quaternion.copy(meshes[0].quaternion); sm.scale.copy(meshes[0].scale);
    sm.bind(meshes[0].skeleton, meshes[0].bindMatrix);
    for (const m of meshes) parent.remove(m);
    parent.add(sm);
    const pa = merged.attributes.position as THREE.BufferAttribute;
    eyeInfo.set(name, eyes.filter((e) => e.length > 0).map((idx) => {
      const pts = idx.map((i) => new THREE.Vector3().fromBufferAttribute(pa, i));
      const c = pts.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(pts.length);
      const r = Math.max(...pts.map((v) => v.distanceTo(c)));
      for (const i of idx) pa.setXYZ(i, c.x, c.y, c.z);
      return { at: idx[0], c, r };
    }));
    pa.needsUpdate = true;
  }
}

const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), q3 = new THREE.Quaternion();
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();

export class GlbAnimalVisual {
  root = new THREE.Group();
  rig: { height: number };
  mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private cur: THREE.AnimationAction | null = null;
  private bones: THREE.Bone[] = [];
  private restRel: THREE.Quaternion[] = [];
  private limpT = 0;
  private idleAlt = 0;
  private eyes: THREE.Object3D[] = [];
  private big: THREE.Bone[] = [];
  /** Model-space points (root at the feet): neck base, head, hips. */
  private pts: { neck: THREE.Vector3; head: THREE.Vector3; hips: THREE.Vector3[]; scale: number };

  constructor(public kind: AnimalKind, public spec: GlbSpec) {
    prepare(spec.model, spec.colors);
    const model = instance(spec.model);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const s = spec.size / Math.max(1e-4, box.max.y - box.min.y);
    model.scale.multiplyScalar(s);
    model.position.y = -box.min.y * s;
    this.root.add(model);
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; }
    });
    this.root.updateMatrixWorld(true);
    const bone = (n: string) => model.getObjectByName(n) as THREE.Bone | undefined;
    const wp = (n: string) => (bone(n)?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3());
    this.bones = LIMB_BONES.map((n) => bone(n)!).filter(Boolean);
    const rootInv = this.root.getWorldQuaternion(q1).invert();
    this.restRel = this.bones.map((b) => rootInv.clone().multiply(b.getWorldQuaternion(q2)));
    const neck = wp('Neck1'), head = wp('Head');
    this.pts = { neck, head: head.clone().lerp(neck, -0.1), hips: LIMB_BONES.slice(1).map(wp), scale: s };
    this.rig = { height: neck.y };
    // goofy: googly eyes on the head bone, then a big head (+ ears)
    const headBone = bone('Head'), mesh = model.getObjectByName('animal');
    const eyes = googly();
    if (headBone && mesh && eyes) {
      const hc = headBone.getWorldPosition(new THREE.Vector3());
      const sm = mesh as THREE.SkinnedMesh, pa = sm.geometry.attributes.position;
      const info = eyeInfo.get(spec.model) ?? [];
      const ws = info.map((e) => sm.applyBoneTransform(e.at, new THREE.Vector3().fromBufferAttribute(pa, e.at)).applyMatrix4(sm.matrixWorld));
      // geometry → world scale, from the distance between the two eyes
      const k = info.length === 2 ? ws[0].distanceTo(ws[1]) / Math.max(1e-6, info[0].c.distanceTo(info[1].c)) : 0;
      info.forEach((e, i) => {
        const w = ws[i];
        const r = Math.max(k ? e.r * k * spec.eye : 0, spec.size * 0.035);
        const side = Math.sign(w.x - hc.x) || 1;
        const dir = new THREE.Vector3(side * 0.45, 0.2, 0.87).normalize();
        const a = new THREE.Object3D(); headBone.add(a);
        a.position.copy(headBone.worldToLocal(w.clone().addScaledVector(dir, r * 0.3)));
        a.updateMatrixWorld(true);
        a.lookAt(a.getWorldPosition(new THREE.Vector3()).add(dir));
        this.eyes.push(a);
        eyes.add(a, r * spec.head);
      });
    }
    for (const n of ['Head', 'Ear1.L', 'Ear1.R']) { const b = bone(n); if (b) { b.scale.setScalar(spec.head); this.big.push(b); } }
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf(spec.model)?.animations ?? []) {
      const a = this.mixer.clipAction(clip); this.actions.set(clip.name.replace(/^.*\|/, ''), a);
    }
    this.play('Idle', 0);
    this.mixer.setTime(Math.random() * 3);
  }

  private play(name: string, fade = 0.25, ts = 1) {
    const a = this.actions.get(name) ?? this.actions.get('Idle');
    if (!a) return;
    a.timeScale = ts;
    if (a === this.cur) return;
    a.reset().play();
    if (this.cur && fade > 0) a.crossFadeFrom(this.cur, fade, false); else this.cur?.stop();
    this.cur = a;
  }

  /** Ragdoll parts (head + 4 legs), same layout as `animalLimbs` for the procedural rigs. */
  limbs(mass: number): LimbDef[] {
    const P = this.pts, size = this.spec.size;
    const hr = clamp(size * 0.12, 0.05, 0.3);
    const limbs: LimbDef[] = [{
      joint: P.neck.clone(), center: P.head.clone(), shape: () => RAPIER.ColliderDesc.ball(hr),
      mass: Math.max(0.1, mass * 0.08), limit: 0.8, flail: { x: 0.35, y: 0.4, z: 0, speed: 9, phase: 0 },
    }];
    P.hips.forEach((hip, i) => {
      const len = Math.max(0.05, hip.y), lr = clamp(size * 0.035, 0.02, 0.09);
      limbs.push({ joint: hip.clone(), center: hip.clone().setY(hip.y - len / 2), shape: () => RAPIER.ColliderDesc.capsule(Math.max(0.005, len / 2 - lr), lr),
        mass: Math.max(0.05, mass * 0.03), limit: 1.3, flail: { x: 1, y: 0, z: hip.x > 0 ? 0.3 : -0.3, speed: 18, phase: i * 1.9 } });
    });
    return limbs;
  }

  update(p: AnimalPose) {
    const S = this.spec, dt = p.dt;
    const flail = p.mode === 'tumble' || p.mode === 'held';
    if (flail) this.play('Gallop', 0.15, 1.8);
    else if (p.mode === 'eat') this.play('Eating');
    else if (p.mode === 'bite') this.play(this.actions.has('Attack') ? 'Attack' : 'Attack_Headbutt', 0.15, 1.3);
    else if (p.mode === 'move' || p.mode === 'swim') {
      if (p.run || p.speed > S.walk * 1.6) this.play('Gallop', 0.25, clamp(p.speed / S.gallop, 0.6, 1.8));
      else this.play('Walk', 0.25, clamp(p.speed / S.walk, 0.5, 2));
    } else {
      this.idleAlt -= dt;
      if (this.idleAlt < -6) this.idleAlt = 3 + Math.random() * 8;
      this.play(this.idleAlt < 0 && this.actions.has('Idle_2') ? 'Idle_2' : 'Idle', 0.4, p.mode === 'howl' ? 0.5 : 1);
    }
    this.mixer.update(dt);
    for (const b of this.big) b.scale.setScalar(this.spec.head);
    // wolf howl: neck up
    if (p.mode === 'howl' && this.bones[0]) {
      this.root.updateMatrixWorld(true);
      const nb = this.bones[0], pq = nb.parent!.getWorldQuaternion(q1);
      const axis = v1.set(1, 0, 0).applyQuaternion(this.root.getWorldQuaternion(q2));
      const want = q3.setFromAxisAngle(axis, -0.9).multiply(nb.getWorldQuaternion(q2));
      nb.quaternion.copy(pq.invert().multiply(want));
    }
    // limp: neck + upper legs follow their physical parts
    this.limpT = damp(this.limpT, p.limp ? 1 : 0, p.limp ? 25 : 8, dt);
    if (this.limpT > 0.01 && p.rel) {
      this.root.updateMatrixWorld(true);
      const rq = this.root.getWorldQuaternion(new THREE.Quaternion());
      this.bones.forEach((b, i) => {
        const rel = p.rel![i]; if (!rel) return;
        const want = q2.copy(rq).multiply(rel).multiply(this.restRel[i]);
        const local = b.parent!.getWorldQuaternion(q1).invert().multiply(want);
        b.quaternion.slerp(local, this.limpT);
        b.updateMatrixWorld(true);
      });
    }
    void v2;
  }
}

export type AnyAnimalVisual = AnimalVisual | GlbAnimalVisual;
/** The pack model when there is one (and it loaded), else the procedural animal. */
export function animalVisual(kind: AnimalKind): AnyAnimalVisual {
  const spec = GLB_ANIMALS[kind];
  if (spec && gltf(spec.model)) return new GlbAnimalVisual(kind, spec);
  return new AnimalVisual(kind === 'horse' || kind === 'horse2' || kind === 'donkey' || kind === 'alpaca' ? 'cow' : kind);
}
