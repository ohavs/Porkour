import * as THREE from 'three';
import { RAPIER } from '../core/physics';
import { Ragdoll, type LimbDef } from '../core/ragdoll';
import { PIVOT, STAND_POS, STAND_ANGLE, NECK, HEAD_C, HIPS } from './pigModel';

/** The pig's body parts: head + four legs (see core/ragdoll.ts). */

export type Shape = 'four' | 'two' | 'rag';
/** Height of the torso body origin above the model origin (pig's feet), per collider shape. */
export const CENTER: Record<Shape, number> = { four: 0.36, two: 0.70, rag: 0.5 };
/** Where a pig is held by a grip (ragdoll torso space): the scruff, behind the head. */
export const SCRUFF = new THREE.Vector3(0, 0.28, 0.22);
/** Standing: the head tips forward a bit so the pig looks ahead, not at the sky. */
export const HEAD_TILT = 0.55;

const LEG_DROP = 0.15;
const X = new THREE.Vector3(1, 0, 0);
const QSTAND = new THREE.Quaternion().setFromAxisAngle(X, -STAND_ANGLE);
const QHEAD_STAND = new THREE.Quaternion().setFromAxisAngle(X, -STAND_ANGLE + HEAD_TILT);

/** Model point → torso-local point for a collider shape (the upper body is hinged up when standing). */
export function toTorso(m: THREE.Vector3, upper: boolean, shape: Shape, out: THREE.Vector3) {
  out.copy(m);
  if (shape === 'two' && upper) out.sub(PIVOT).applyQuaternion(QSTAND).add(STAND_POS);
  out.y -= CENTER[shape];
  return out;
}

/** Part order: head, frontL, frontR, hindL, hindR (front legs + head ride the upper body). */
const DEFS: LimbDef[] = [
  { joint: NECK, center: HEAD_C, shape: () => RAPIER.ColliderDesc.ball(0.23), mass: 2, limit: 0.75,
    flail: { x: 0.25, y: 0.3, z: 0, speed: 7, phase: 0 } },
  ...HIPS.map((h, i): LimbDef => ({ joint: h, center: h.clone().setY(h.y - LEG_DROP), shape: () => RAPIER.ColliderDesc.capsule(0.08, 0.08),
    mass: 1, limit: 1.45, flail: { x: 0.9, y: 0, z: h.x > 0 ? 0.3 : -0.3, speed: 17, phase: i * 1.7 + 1 } })),
];

export class PigParts extends Ragdoll {
  shape: Shape = 'four';
  constructor(torso: RAPIER.RigidBody, at: THREE.Vector3) {
    let self: PigParts | null = null;
    super(torso, DEFS, at, (i, anchor, rest) => {
      const shape = self?.shape ?? 'four';
      toTorso(DEFS[i].joint, i < 3, shape, anchor);
      // standing: head looks ahead, arms hang down, hind legs straight
      if (shape !== 'two') rest.identity(); else if (i === 0) rest.copy(QHEAD_STAND); else rest.identity();
    });
    self = this;
  }
  /** The collider shape changed: move the joint anchors on the torso. */
  setShape(s: Shape) { this.shape = s; this.refresh(); }
}
