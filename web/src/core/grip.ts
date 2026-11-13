import * as THREE from 'three';
import { RAPIER, world, groups, L } from './physics';

const q1 = new THREE.Quaternion();
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();

/**
 * A grip: an invisible "hand" body (a pig's snout / hooves, Bob's hands, a wolf's jaws) that a
 * held object hangs on by a spherical joint at the point where it was grabbed. A force-limited motor pulls the hand
 * toward where its owner wants it: light things are lifted and dangle / swing, heavy ones are dragged along the ground,
 * stuck ones slip out of the grip. Throwing swings the hand back (wind-up) and then forward fast before letting go (pig).
 */
export class Grip {
  hand: RAPIER.RigidBody;
  joint: RAPIER.ImpulseJoint | null = null;
  held: RAPIER.RigidBody | null = null;
  private prevT = new THREE.Vector3(); private hasPrev = false;
  private oldDamp = 0;
  strain = 0;
  static MASS = 2;

  constructor() {
    this.hand = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).lockRotations().setEnabled(false)
      .setAdditionalSolverIterations(4));
    world.createCollider(RAPIER.ColliderDesc.ball(0.05).setMass(Grip.MASS).setCollisionGroups(groups(L.LIMB, 0)), this.hand);
  }
  get pos() { return this.hand.translation(); }

  /** Hold `body` at the point of it nearest to `from` (world), or at `at` (body space) when given (a pig's scruff). */
  attach(body: RAPIER.RigidBody, from: THREE.Vector3, at?: THREE.Vector3) {
    this.detach();
    const t = body.translation(), r = body.rotation();
    let pt: THREE.Vector3;
    if (at) pt = v1.copy(at).applyQuaternion(q1.set(r.x, r.y, r.z, r.w)).add(v2.set(t.x, t.y, t.z));
    else {
      const proj = world.projectPoint(from, false, undefined, undefined, undefined, undefined, (c) => c.parent()?.handle === body.handle);
      pt = proj ? v1.set(proj.point.x, proj.point.y, proj.point.z) : v1.set(t.x, t.y, t.z);
    }
    this.hand.setEnabled(true);
    this.hand.setTranslation(pt, true);
    this.hand.setLinvel(body.linvel(), true);
    const local = v2.copy(pt).sub(v3.set(t.x, t.y, t.z)).applyQuaternion(q1.set(r.x, r.y, r.z, r.w).invert());
    this.joint = world.createImpulseJoint(RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, { x: local.x, y: local.y, z: local.z }), this.hand, body, true);
    this.joint.setContactsEnabled(false);
    this.held = body;
    this.oldDamp = body.angularDamping();
    body.setAngularDamping(Math.max(this.oldDamp, 2.5));
    this.hasPrev = false; this.strain = 0;
  }

  detach() {
    if (this.joint) world.removeImpulseJoint(this.joint, true);
    if (this.held) this.held.setAngularDamping(this.oldDamp);
    this.joint = null; this.held = null;
    this.hand.setEnabled(false);
  }

  /**
   * Pull the hand toward `T` (world). Forces: `up` (N) lifting, `side` (N) dragging. `mass` = held mass.
   * The reaction pushes the pig back (`react`: share felt, the rest goes into the ground).
   */
  drive(T: THREE.Vector3, torso: RAPIER.RigidBody, mass: number, dt: number, o: { up: number; side: number; kp: number; react: number; g: number }) {
    const hp = this.hand.translation(), hv = this.hand.linvel();
    const vT = this.hasPrev ? v1.copy(T).sub(this.prevT).divideScalar(dt) : v1.copy(torso.linvel() as THREE.Vector3);
    this.prevT.copy(T); this.hasPrev = true;
    const ex = v2.set(T.x - hp.x, T.y - hp.y, T.z - hp.z);
    this.strain = ex.length();
    const dv = vT.addScaledVector(ex, o.kp).sub(v3.set(hv.x, hv.y, hv.z));
    const gain = 0.55;
    const Mh = Grip.MASS + mass * 0.45, Mv = Grip.MASS + mass;
    let jx = Mh * dv.x * gain, jz = Mh * dv.z * gain;
    let jy = Mv * (dv.y * gain + o.g * dt);
    const side = o.side * dt, hl = Math.hypot(jx, jz);
    if (hl > side) { jx *= side / hl; jz *= side / hl; }
    jy = Math.max(-side * 0.5, Math.min(o.up * dt, jy));
    this.hand.applyImpulse({ x: jx, y: jy, z: jz }, true);
    torso.applyImpulse({ x: -jx * o.react, y: -jy * 0.5, z: -jz * o.react }, true);
  }
}
