import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

/** Interpolates a visual between the last two physics states (smooth at any frame rate). */
export class Synced {
  prevP = new THREE.Vector3(); currP = new THREE.Vector3();
  prevQ = new THREE.Quaternion(); currQ = new THREE.Quaternion();
  preVel = new THREE.Vector3();
  constructor(public body: RAPIER.RigidBody, public obj?: THREE.Object3D) { this.capture(); this.capture(); }
  /** Before the physics step: remember velocity (used to judge hits). */
  beforeStep() { const v = this.body.linvel(); this.preVel.set(v.x, v.y, v.z); }
  capture() {
    this.prevP.copy(this.currP); this.prevQ.copy(this.currQ);
    const p = this.body.translation(), q = this.body.rotation();
    this.currP.set(p.x, p.y, p.z); this.currQ.set(q.x, q.y, q.z, q.w);
  }
  pos(alpha: number, out: THREE.Vector3) { return out.lerpVectors(this.prevP, this.currP, alpha); }
  rot(alpha: number, out: THREE.Quaternion) { return out.slerpQuaternions(this.prevQ, this.currQ, alpha); }
  apply(alpha: number) {
    if (!this.obj) return;
    this.pos(alpha, this.obj.position); this.rot(alpha, this.obj.quaternion);
  }
}
