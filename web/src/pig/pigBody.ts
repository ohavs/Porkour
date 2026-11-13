import * as THREE from 'three';
import { RAPIER, world, groups, L } from '../core/physics';
import { PIVOT, STAND_POS, STAND_ANGLE, NECK, HEAD_C, HIPS } from './pigModel';

/**
 * Active ragdoll for the pig (the Gang Beasts / Human: Fall Flat / Party Animals idea, kept stable):
 * the torso is the existing locomotion body; the head and the four legs are real rigid bodies hung on spherical
 * joints. While the pig is in control they follow the animated pose exactly (no collisions, no weight: locomotion
 * feels the same). When it is hit, knocked over or carried, the "muscles" go limp: the parts collide, swing and
 * flop under gravity, with a little muscle tone (and soft joint limits) so the pig flails instead of folding.
 * The visual then shows the physical pose of every part.
 */

export type Shape = 'four' | 'two' | 'rag';
/** Height of the torso body origin above the model origin (pig's feet), per collider shape. */
export const CENTER: Record<Shape, number> = { four: 0.36, two: 0.70, rag: 0.5 };
/** Standing: the head tips forward a bit so the pig looks ahead, not at the sky. */
export const HEAD_TILT = 0.55;
/** How the parts behave this step. */
export type Tone = 'active' | 'ragdoll' | 'carried' | 'dragged';

const LEG_DROP = 0.15;
const X = new THREE.Vector3(1, 0, 0);
const QSTAND = new THREE.Quaternion().setFromAxisAngle(X, -STAND_ANGLE);
const QHEAD_STAND = new THREE.Quaternion().setFromAxisAngle(X, -STAND_ANGLE + HEAD_TILT);
const ID = new THREE.Quaternion();
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), q3 = new THREE.Quaternion();
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();

interface Part {
  body: RAPIER.RigidBody; col: RAPIER.Collider; joint: RAPIER.ImpulseJoint;
  /** Joint and centre in model space (four legs pose); is it on the upper (hinged) body. */
  jointM: THREE.Vector3; centerM: THREE.Vector3; upper: boolean;
  /** Soft limit (radians from rest) and flail phase. */
  limit: number; phase: number;
}

/** Model point → torso-local point for a collider shape (the upper body is hinged up when standing). */
export function toTorso(m: THREE.Vector3, upper: boolean, shape: Shape, out: THREE.Vector3) {
  out.copy(m);
  if (shape === 'two' && upper) out.sub(PIVOT).applyQuaternion(QSTAND).add(STAND_POS);
  out.y -= CENTER[shape];
  return out;
}

export class PigParts {
  parts: Part[] = [];
  shape: Shape = 'four';
  tone: Tone = 'active';
  /** Player side: relative rotations received from the host. */
  netRel = [0, 1, 2, 3, 4].map(() => new THREE.Quaternion());
  private enabled = true;

  constructor(private torso: RAPIER.RigidBody, at: THREE.Vector3) {
    const def = (jointM: THREE.Vector3, centerM: THREE.Vector3, upper: boolean, desc: RAPIER.ColliderDesc, mass: number, limit: number, phase: number) => {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x + centerM.x, at.y + centerM.y, at.z + centerM.z)
        .setCanSleep(false).setGravityScale(0).setLinearDamping(0.4).setAngularDamping(1.2));
      const col = world.createCollider(desc.setMass(mass).setFriction(0.8).setRestitution(0.1).setCollisionGroups(groups(L.LIMB, 0)), body);
      const a1 = toTorso(jointM, upper, 'four', new THREE.Vector3());
      const a2 = v1.copy(jointM).sub(centerM);
      const joint = world.createImpulseJoint(RAPIER.JointData.spherical(a1, { x: a2.x, y: a2.y, z: a2.z }), torso, body, true);
      joint.setContactsEnabled(false);
      this.parts.push({ body, col, joint, jointM, centerM, upper, limit, phase });
    };
    def(NECK, HEAD_C, true, RAPIER.ColliderDesc.ball(0.23), 2, 0.75, 0);
    HIPS.forEach((h, i) => def(h, h.clone().setY(h.y - LEG_DROP), i < 2, RAPIER.ColliderDesc.capsule(0.08, 0.08), 1, 1.45, i * 1.7 + 1));
  }

  get head() { return this.parts[0].body; }

  /** Rest rotation of a part relative to the torso. */
  private rest(i: number, out: THREE.Quaternion) {
    if (this.shape !== 'two') return out.identity();
    return out.copy(i === 0 ? QHEAD_STAND : ID);   // standing: head looks ahead, arms hang down, hind legs straight
  }

  /** The collider shape changed: move the joint anchors on the torso. */
  setShape(s: Shape) {
    this.shape = s;
    for (const p of this.parts) p.joint.setAnchor1(toTorso(p.jointM, p.upper, s, v1));
  }

  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    for (const p of this.parts) p.body.setEnabled(on);
    if (on) this.snap();
  }

  /** Muscles on (follow the pose) or limp (collide, flop). */
  setTone(t: Tone) {
    if (t === this.tone) return;
    this.tone = t;
    const active = t === 'active';
    const filter = t === 'ragdoll' ? L.STATIC | L.PROP | L.PIG | L.FARMER | L.CRITTER : t === 'dragged' ? L.STATIC | L.PROP : 0;
    for (const p of this.parts) {
      p.col.setCollisionGroups(groups(L.LIMB, filter));
      p.body.setGravityScale(active ? 0 : 1, true);
    }
  }
  get limp() { return this.tone !== 'active'; }

  /** Target world pose of a part (exactly satisfies its joint). */
  private target(i: number, tp: THREE.Vector3, tq: THREE.Quaternion, pos: THREE.Vector3, rot: THREE.Quaternion) {
    const p = this.parts[i];
    rot.copy(tq).multiply(this.rest(i, q3));
    toTorso(p.jointM, p.upper, this.shape, pos).applyQuaternion(tq).add(tp);
    return pos.add(v3.copy(p.centerM).sub(p.jointM).applyQuaternion(rot));
  }

  /** Every fixed step before physics. `t` = game time (flail rhythm). */
  step(t: number) {
    if (!this.enabled) return;
    const tp = v1.copy(this.torso.translation() as THREE.Vector3), r = this.torso.rotation();
    const tq = q1.set(r.x, r.y, r.z, r.w);
    const lv = this.torso.linvel(), av = this.torso.angvel();
    // a teleport (respawn, cage, carried too far) leaves the parts behind: bring them along
    for (const p of this.parts) {
      const a = p.joint.anchor1(), b = p.body.translation();
      v2.set(a.x, a.y, a.z).applyQuaternion(tq).add(tp);
      if (v2.distanceToSquared(b as THREE.Vector3) > 1) { this.snap(); break; }
    }
    if (this.tone === 'active') {
      this.parts.forEach((p, i) => {
        this.target(i, tp, tq, v2, q2);
        p.body.setTranslation(v2, true);
        p.body.setRotation(q2, true);
        p.body.setLinvel(lv, true);
        p.body.setAngvel(av, true);
      });
      return;
    }
    // limp: muscle tone pulls (weakly) toward a flailing pose; soft joint limits stop limbs folding through the body
    const flail = this.tone === 'carried' ? 1 : this.tone === 'dragged' ? 0.7 : 0.45;
    const tone = this.tone === 'ragdoll' ? 0.06 : 0.12;
    this.parts.forEach((p, i) => {
      const br = p.body.rotation();
      const cur = q2.set(br.x, br.y, br.z, br.w);
      const rest = this.rest(i, q3);
      // error to rest (for the limit)
      const want = new THREE.Quaternion().copy(tq).multiply(rest);
      const errRest = angleTo(want, cur);
      // flail target
      const f = t * (i === 0 ? 7 : 17) + p.phase;
      if (i === 0) want.multiply(q3.setFromEuler(eul.set(Math.sin(f) * 0.25 * flail, Math.sin(f * 0.7) * 0.3 * flail, 0)));
      else want.multiply(q3.setFromEuler(eul.set(Math.sin(f) * 0.9 * flail, 0, (p.jointM.x > 0 ? 0.3 : -0.3) * flail)));
      let k = tone;
      if (errRest > p.limit) k += Math.min(0.6, (errRest - p.limit) * 1.5);
      const d = rotDelta(want, cur, v3);
      const w = p.body.angvel();
      const kd = 1 / 0.12;
      p.body.setAngvel({
        x: w.x + (av.x + d.x * kd - w.x) * k,
        y: w.y + (av.y + d.y * kd - w.y) * k,
        z: w.z + (av.z + d.z * kd - w.z) * k,
      }, true);
    });
  }

  /** Put every part at its rest pose, moving with the torso. */
  snap() {
    const tp = v1.copy(this.torso.translation() as THREE.Vector3), r = this.torso.rotation();
    const tq = q1.set(r.x, r.y, r.z, r.w), lv = this.torso.linvel();
    this.parts.forEach((p, i) => {
      this.target(i, tp, tq, v2, q2);
      p.body.setTranslation(v2, true); p.body.setRotation(q2, true);
      p.body.setLinvel(lv, true); p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    });
  }

  /** Thrown / knocked: the parts fly with the torso (they'd lag behind otherwise). */
  matchVelocity() {
    const lv = this.torso.linvel();
    for (const p of this.parts) p.body.setLinvel(lv, true);
  }

  /** Rotation of part i relative to the torso (host: physics; player: last snapshot). */
  rel(i: number, out: THREE.Quaternion, net: boolean) {
    if (net) return out.copy(this.netRel[i]);
    const r = this.torso.rotation(), b = this.parts[i].body.rotation();
    return out.set(r.x, r.y, r.z, r.w).invert().multiply(q2.set(b.x, b.y, b.z, b.w));
  }

  /** Host → players: relative part rotations (x, y, z; w ≥ 0 rebuilt). */
  netState(n: number[]) {
    for (let i = 0; i < this.parts.length; i++) {
      const q = this.rel(i, q1, false);
      if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      n.push(r3(q.x), r3(q.y), r3(q.z));
    }
  }
  netApply(n: number[], at: number) {
    for (let i = 0; i < this.parts.length; i++) {
      const x = n[at + i * 3] ?? 0, y = n[at + i * 3 + 1] ?? 0, z = n[at + i * 3 + 2] ?? 0;
      this.netRel[i].set(x, y, z, Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z)));
    }
  }
}

const eul = new THREE.Euler();
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Angle between two rotations. */
function angleTo(a: THREE.Quaternion, b: THREE.Quaternion) {
  const d = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return 2 * Math.acos(Math.min(1, d));
}
/** Rotation vector (axis × angle, world) taking `from` to `to`. */
function rotDelta(to: THREE.Quaternion, from: THREE.Quaternion, out: THREE.Vector3) {
  const d = new THREE.Quaternion().copy(from).invert().premultiply(to);   // to * from⁻¹
  if (d.w < 0) d.set(-d.x, -d.y, -d.z, -d.w);
  const s = Math.sqrt(1 - Math.min(1, d.w * d.w));
  if (s < 1e-5) return out.set(0, 0, 0);
  const ang = 2 * Math.acos(Math.min(1, d.w));
  return out.set(d.x / s, d.y / s, d.z / s).multiplyScalar(ang);
}

// ====================================================================== grip
/**
 * The pig's grip: an invisible "hand" body (at the snout on four legs, between the front hooves standing) that a
 * held object hangs on by a spherical joint at the point where it was grabbed. A force-limited motor pulls the hand
 * toward where the pig wants it: light things are lifted and dangle / swing, heavy ones are dragged along the ground,
 * stuck ones slip out of the grip. Throwing swings the hand back (wind-up) and then forward fast before letting go.
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
