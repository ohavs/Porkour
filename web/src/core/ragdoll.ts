import * as THREE from 'three';
import { RAPIER, world, groups, L } from './physics';

/**
 * Active ragdoll (the Gang Beasts / Human: Fall Flat / Party Animals idea, kept stable): the torso is the
 * character's own locomotion body; head and limbs are real rigid bodies hung on spherical joints. While the
 * character is in control they are switched off (the animation drives the visual; movement feels the same, no cost);
 * they wake up in the current pose the moment it goes limp.
 * When it is hit, knocked over or carried, the "muscles" go limp: the parts collide, swing and flop under gravity,
 * with a little muscle tone (and soft joint limits) so it flails instead of folding. The visual then shows the
 * physical rotation of every part. Players (online) get the part rotations in snapshots.
 */

/** How the parts behave this step. */
export type Tone = 'active' | 'ragdoll' | 'carried' | 'dragged';

export interface LimbDef {
  /** Joint and part centre in model space (rest pose). */
  joint: THREE.Vector3; center: THREE.Vector3;
  shape: () => RAPIER.ColliderDesc; mass: number;
  /** Soft limit: radians away from rest before the joint pushes back. */
  limit: number;
  /** Flail when limp: swing amplitudes about x / y (rad), constant splay about z (rad), rhythm (rad/s), phase. */
  flail: { x: number; y: number; z: number; speed: number; phase: number };
}

interface Part { def: LimbDef; body: RAPIER.RigidBody; col: RAPIER.Collider; joint: RAPIER.ImpulseJoint | null }

const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), q3 = new THREE.Quaternion(), q4 = new THREE.Quaternion();
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const eul = new THREE.Euler();
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export class Ragdoll {
  parts: Part[] = [];
  tone: Tone = 'active';
  /** Player side: relative rotations received from the host. */
  netRel: THREE.Quaternion[];
  /** Muscle tone when limp (share of the error fixed per step) and how much it flails, per tone. */
  toneK: Record<Tone, number> = { active: 1, ragdoll: 0.06, carried: 0.12, dragged: 0.12 };
  flailK: Record<Tone, number> = { active: 0, ragdoll: 0.45, carried: 1, dragged: 0.7 };
  /** Owner in the world (not grilled / asleep…); parts simulated (only while limp: free when in control). */
  private enabled = true; private live = true;

  /**
   * `frame(i, anchor, rest)`: where part i's joint sits on the torso (torso space) and its rest rotation relative
   * to the torso, for the torso's current collider (characters change shape: standing, lying…).
   */
  constructor(private torso: RAPIER.RigidBody, defs: LimbDef[], at: THREE.Vector3,
    private frame: (i: number, anchor: THREE.Vector3, rest: THREE.Quaternion) => void) {
    defs.forEach((def, i) => {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(at.x + def.center.x, at.y + def.center.y, at.z + def.center.z)
        .setCanSleep(false).setGravityScale(0).setLinearDamping(0.4).setAngularDamping(1.2));
      const col = world.createCollider(def.shape().setMass(def.mass).setFriction(0.8).setRestitution(0.1)
        .setCollisionGroups(groups(L.LIMB, 0)), body);
      this.parts.push({ def, body, col, joint: null });
      void i;
    });
    this.netRel = defs.map(() => new THREE.Quaternion());
    this.setLive(false);
  }

  /**
   * Parts only exist in the simulation while limp (in control, the visual animates them: no cost). Their joints exist
   * only then too: a joint to a switched-off body would pin the torso in place.
   */
  private setLive(on: boolean) {
    on = on && this.enabled;
    if (on === this.live) return;
    this.live = on;
    this.parts.forEach((p, i) => {
      if (on) {
        p.body.setEnabled(true);
        this.frame(i, v1, q1);
        const a2 = v2.copy(p.def.joint).sub(p.def.center);
        p.joint = world.createImpulseJoint(RAPIER.JointData.spherical({ x: v1.x, y: v1.y, z: v1.z }, { x: a2.x, y: a2.y, z: a2.z }), this.torso, p.body, true);
        p.joint.setContactsEnabled(false);
      } else {
        if (p.joint) world.removeImpulseJoint(p.joint, true);
        p.joint = null;
        p.body.setEnabled(false);
      }
    });
    if (on) this.snap();
  }

  /** The torso's collider / pose changed: move the joint anchors. */
  refresh() {
    this.parts.forEach((p, i) => { if (!p.joint) return; this.frame(i, v1, q1); p.joint.setAnchor1({ x: v1.x, y: v1.y, z: v1.z }); });
  }

  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    this.setLive(on && this.tone !== 'active');
  }

  /** Muscles on (follow the pose) or limp (collide, flop). Ragdoll: hits everything; dragged: the ground. */
  setTone(t: Tone) {
    if (t === this.tone) return;
    this.tone = t;
    this.setLive(t !== 'active');
    const filter = t === 'ragdoll' ? L.STATIC | L.PROP | L.PIG | L.FARMER | L.CRITTER : t === 'dragged' ? L.STATIC | L.PROP : 0;
    for (const p of this.parts) {
      p.col.setCollisionGroups(groups(L.LIMB, filter));
      p.body.setGravityScale(t === 'active' ? 0 : 1, true);
    }
  }
  get limp() { return this.tone !== 'active'; }

  /** Target world pose of a part (exactly satisfies its joint). */
  private target(i: number, tp: THREE.Vector3, tq: THREE.Quaternion, pos: THREE.Vector3, rot: THREE.Quaternion) {
    const d = this.parts[i].def;
    this.frame(i, pos, rot);
    rot.premultiply(tq);
    pos.applyQuaternion(tq).add(tp);
    return pos.add(v3.copy(d.center).sub(d.joint).applyQuaternion(rot));
  }

  /** Every fixed step before physics. `t` = game time (flail rhythm). */
  step(t: number) {
    if (!this.live) return;
    const tp = v1.copy(this.torso.translation() as THREE.Vector3), r = this.torso.rotation();
    const tq = q1.set(r.x, r.y, r.z, r.w);
    const lv = this.torso.linvel(), av = this.torso.angvel();
    // a teleport (respawn, cage, carried too far) leaves the parts behind: bring them along
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i], b = p.body.translation();
      this.frame(i, v2, q2);
      v2.applyQuaternion(tq).add(tp);
      if (v2.distanceToSquared(b as THREE.Vector3) > 1) { this.snap(); break; }
    }
    // limp: muscle tone pulls (weakly) toward a flailing pose; soft joint limits stop limbs folding through the body
    const flail = this.flailK[this.tone], tone = this.toneK[this.tone];
    this.parts.forEach((p, i) => {
      const br = p.body.rotation(), f = p.def.flail;
      const cur = q2.set(br.x, br.y, br.z, br.w);
      this.frame(i, v3, q3);
      const want = q4.copy(tq).multiply(q3);
      const errRest = angleTo(want, cur);
      const a = t * f.speed + f.phase;
      want.multiply(q3.setFromEuler(eul.set(Math.sin(a) * f.x * flail, Math.sin(a * 0.7) * f.y * flail, f.z * flail)));
      let k = tone;
      if (errRest > p.def.limit) k += Math.min(0.6, (errRest - p.def.limit) * 1.5);
      const d = rotDelta(want, cur, v3);
      const w = p.body.angvel(), kd = 1 / 0.12;
      p.body.setAngvel({ x: w.x + (av.x + d.x * kd - w.x) * k, y: w.y + (av.y + d.y * kd - w.y) * k, z: w.z + (av.z + d.z * kd - w.z) * k }, true);
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
    if (!this.live) return;
    const lv = this.torso.linvel();
    for (const p of this.parts) p.body.setLinvel(lv, true);
  }

  /** Rotation of part i relative to the torso (host: physics; player: last snapshot). */
  rel(i: number, out: THREE.Quaternion, net: boolean) {
    if (net) return out.copy(this.netRel[i]);
    if (!this.live) return out.identity();
    const r = this.torso.rotation(), b = this.parts[i].body.rotation();
    return out.set(r.x, r.y, r.z, r.w).invert().multiply(q2.set(b.x, b.y, b.z, b.w));
  }

  /** Host → players: relative part rotations (x, y, z; w ≥ 0 is rebuilt). 3 numbers per part. */
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

/** Angle between two rotations. */
function angleTo(a: THREE.Quaternion, b: THREE.Quaternion) {
  const d = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return 2 * Math.acos(Math.min(1, d));
}
const qd = new THREE.Quaternion();
/** Rotation vector (axis × angle, world) taking `from` to `to`. */
function rotDelta(to: THREE.Quaternion, from: THREE.Quaternion, out: THREE.Vector3) {
  qd.copy(from).invert().premultiply(to);   // to * from⁻¹
  if (qd.w < 0) qd.set(-qd.x, -qd.y, -qd.z, -qd.w);
  const s = Math.sqrt(1 - Math.min(1, qd.w * qd.w));
  if (s < 1e-5) return out.set(0, 0, 0);
  const ang = 2 * Math.acos(Math.min(1, qd.w));
  return out.set(qd.x / s, qd.y / s, qd.z / s).multiplyScalar(ang);
}
