import * as THREE from 'three';
import { rigidSkin } from '../render/batch';
import { damp, clamp, lerp } from '../core/util';
import { G } from '../game/ctx';
import { buildPig, PIVOT, STAND_POS, STAND_ANGLE, NECK, SNOUT_TIP, type PigRig } from './pigModel';
import { HEAD_TILT } from './pigBody';
import { dress, defaultOutfit, type Outfit } from './cosmetics';

const DOWN = new THREE.Vector3(0, -1, 0);
const SNOUT_DIR = SNOUT_TIP.clone().sub(NECK).normalize();
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const _e = new THREE.Euler();
const MUD = new THREE.Color(0x6b4423), BURNT = new THREE.Color(0x3a2620);

export interface PigPose {
  speed: number; grounded: boolean; vy: number; standing: boolean; mode: string;
  sprinting: boolean; muddy: number; holding: boolean; charging: number; dt: number; t: number; burnt?: number;
  /** 0..1 how close a standing pig is to falling over; punch 0..1 (jab progress). */
  wobble?: number; punch?: number;
  /** Standing balance lean (radians): forward / sideways (+ = toward the pig's left), from the physics. */
  leanF?: number; leanS?: number;
  /** Limp (ragdoll / carried): `rel` = physical rotations of head, frontL, frontR, hindL, hindR relative to the torso. */
  limp?: boolean; rel?: THREE.Quaternion[];
  /** Grip hand position (model space) while holding something: the head (four legs) or the arms (standing) reach for it. */
  hand?: THREE.Vector3 | null;
}

/**
 * Procedurally animated cartoon pig: trot, stand up on the hind legs (front legs become arms), wallow on the back,
 * flail when ragdolled / carried, floppy ears, wiggly tail, blinking, squash & stretch, wobble on two legs,
 * hoof punch, outfit (hat, hair, glasses…).
 */
export class PigVisual {
  root = new THREE.Group();
  private roll = new THREE.Group();
  private base = new THREE.Group();
  private sway = new THREE.Group();
  rig: PigRig;
  private spots = new THREE.Group();
  private animParts: THREE.Object3D[] = [];
  private phase = 0; private standT = 0; private rollT = 0; private squash = 0;
  private lastGrounded = true; private blinkAt = 2;
  private limpT = 0; private lf = 0; private ls = 0;
  centerHeight = 0.36;
  outfit: Outfit = defaultOutfit();

  constructor(public color: number, outfit?: Outfit) {
    this.root.add(this.sway); this.sway.add(this.roll); this.roll.add(this.base);
    this.rig = buildPig(this.base);
    rigidSkin(this.base, undefined, new Set(this.rig.skin.map((s) => s.mat)));   // one draw call per skin colour, not ~40 meshes
    this.spots.position.copy(PIVOT).negate(); this.rig.upper.add(this.spots);
    this.setOutfit(outfit ?? defaultOutfit());
  }

  setOutfit(o: Outfit) {
    this.outfit = { ...o };
    this.animParts = dress(this.rig, this.outfit, this.color, this.spots);
  }

  /** Knocked over while standing: the physics torso takes over the standing pose at once. */
  snapStand() { this.standT = 0; this.rig.upper.position.copy(PIVOT); this.rig.upper.rotation.set(0, 0, 0); }

  update(p: PigPose) {
    const dt = p.dt, R = this.rig;
    const standTarget = p.standing && p.mode !== 'ragdoll' && p.mode !== 'wallow' ? 1 : 0;
    this.standT = damp(this.standT, standTarget, 10, dt);
    this.rollT = damp(this.rollT, p.mode === 'wallow' ? 1 : 0, 9, dt);
    const sT = this.standT;

    const moving = p.grounded && p.speed > 0.3 && p.mode === 'normal';
    const stride = p.sprinting ? 2.3 : sT > 0.5 ? 3.3 : 2.8;
    this.phase += dt * (moving ? Math.max(4, p.speed * stride) : 0);
    const amp = moving ? clamp(p.speed / 4.5, 0.25, 1) * (p.sprinting ? 1.0 : 0.65) : 0;
    const s1 = Math.sin(this.phase), s2 = Math.sin(this.phase + Math.PI);

    // squash & stretch
    if (p.grounded && !this.lastGrounded) this.squash = clamp(-p.vy * 0.035 + 0.12, 0.1, 0.32);
    this.lastGrounded = p.grounded;
    this.squash = damp(this.squash, 0, 9, dt);
    const stretch = !p.grounded ? clamp(p.vy * 0.022, -0.1, 0.14) : 0;
    const breath = Math.sin(p.t * 2.6) * 0.018;
    this.base.scale.set(1 + this.squash * 0.6 - stretch * 0.5, 1 - this.squash + stretch + breath, 1 + this.squash * 0.3);

    // balance on two legs: the whole pig leans around its feet exactly as the physics lean says (smoothed a touch:
    // the sim runs at 60 Hz). The pivot is at the feet: sway sits at foot level, roll / base are lifted back up.
    const w = clamp(p.wobble ?? 0, 0, 1);
    this.lf = damp(this.lf, (p.leanF ?? 0) * sT, 30, dt); this.ls = damp(this.ls, (p.leanS ?? 0) * sT, 30, dt);
    this.sway.position.y = -this.centerHeight;
    this.sway.rotation.x = this.lf;
    this.sway.rotation.z = -this.ls;

    // hinge
    R.upper.position.lerpVectors(PIVOT, STAND_POS, sT);
    R.upper.rotation.x = -STAND_ANGLE * sT + (moving ? Math.sin(this.phase * 2) * 0.04 * amp : 0) + (p.punch ? Math.sin(p.punch * Math.PI) * 0.15 * sT : 0);
    R.upper.rotation.z = moving ? Math.sin(this.phase) * 0.06 * amp * (sT * 2 + 0.6) : 0;
    this.base.position.y = -this.centerHeight + (moving ? Math.abs(Math.sin(this.phase)) * 0.05 * amp : 0);
    // headbutt (four legs): the body lunges, the head ducks and rams
    const butt = p.punch && sT < 0.5 && !p.holding ? Math.sin(clamp(p.punch, 0, 1) * Math.PI) : 0;
    if (butt) { R.upper.position.z += butt * 0.22; R.upper.rotation.x += butt * 0.18; }

    // legs
    const flail = p.mode === 'ragdoll' || p.mode === 'held' || (p.mode === 'wallow' && this.rollT > 0.5);
    const air = !p.grounded && p.mode === 'normal';
    const set = (o: THREE.Object3D, x: number, z = 0, k = 22) => { o.rotation.x = damp(o.rotation.x, x, k, dt); o.rotation.z = damp(o.rotation.z, z, k, dt); };
    if (flail) {
      const f = p.t * (p.mode === 'wallow' ? 12 : 19);
      set(R.frontL, Math.sin(f) * 0.9, 0.3); set(R.frontR, Math.sin(f + 2) * 0.9, -0.3);
      set(R.hindL, Math.sin(f + 1) * 0.9, 0.3); set(R.hindR, Math.sin(f + 3) * 0.9, -0.3);
    } else if (air) {
      set(R.frontL, -0.75 + sT * 1.6, 0.2); set(R.frontR, -0.75 + sT * 1.6, -0.2);
      set(R.hindL, 0.75 - sT * 0.5, 0.2); set(R.hindR, 0.75 - sT * 0.5, -0.2);
    } else {
      set(R.hindL, s1 * amp * (1 + sT * 0.3)); set(R.hindR, s2 * amp * (1 + sT * 0.3));
      const arm = lerp(0, (p.holding ? 0.2 : 1.05) * STAND_ANGLE, sT);
      const swing = sT > 0.5 ? (p.holding ? 0 : 0.6) : 1;
      let fl = arm + s2 * amp * swing, fr = arm + s1 * amp * swing;
      let zl = sT * 0.15, zr = -sT * 0.15;
      if (p.charging > 0) { fl = fr = arm - p.charging * 1.3; }
      if (w > 0.45 && sT > 0.5) {   // windmilling arms: about to fall
        const k = (w - 0.45) / 0.55;
        fl = arm + Math.sin(p.t * 16) * 1.4 * k; fr = arm + Math.sin(p.t * 16 + Math.PI) * 1.4 * k; zl = 0.6 * k + 0.15; zr = -0.6 * k - 0.15;
      }
      if (p.punch && sT > 0.5) { const k = Math.sin(clamp(p.punch, 0, 1) * Math.PI); fr = arm + 1.0 * k; zr = -0.15 + 0.35 * k; }
      set(R.frontL, fl, zl, p.punch ? 40 : 22); set(R.frontR, fr, zr, p.punch ? 40 : 22);
    }
    R.hindL.position.x = 0.2 * (1 + sT * 0.15); R.hindR.position.x = -0.2 * (1 + sT * 0.15);

    // head: looks ahead when standing; reaches for what it holds (four legs)
    _q.setFromEuler(_e.set(HEAD_TILT * sT + butt * 0.55, 0, 0));
    if (p.hand && !flail) {
      R.upper.updateMatrix();
      _p.copy(p.hand).applyMatrix4(_m.copy(R.upper.matrix).invert());      // hand in the upper body's space
      if (sT < 0.5) {
        _d.copy(_p).sub(R.head.position).normalize();
        _qi.setFromUnitVectors(SNOUT_DIR, _d);
        const ang = 2 * Math.acos(Math.min(1, Math.abs(_qi.w)));
        if (ang > 1.1) _qi.slerp(_q.identity(), 1 - 1.1 / ang);
        _q.setFromEuler(_e.set(HEAD_TILT * sT, 0, 0)).premultiply(_qi);
      } else {
        // both front hooves reach for the hand
        for (const leg of [R.frontL, R.frontR]) {
          _d.copy(_p).sub(leg.position);
          if (_d.lengthSq() < 1e-4) continue;
          _qi.setFromUnitVectors(DOWN, _d.normalize());
          leg.quaternion.slerp(_qi, 1 - Math.exp(-28 * dt));
        }
      }
    }
    R.head.quaternion.slerp(_q, 1 - Math.exp(-16 * dt));

    // limp: every part shows its physical rotation (head + legs flop, swing, hang)
    this.limpT = damp(this.limpT, p.limp ? 1 : 0, p.limp ? 25 : 8, dt);
    if (this.limpT > 0.01 && p.rel) {
      R.head.quaternion.slerp(p.rel[0], this.limpT);
      [R.frontL, R.frontR, R.hindL, R.hindR].forEach((leg, i) => leg.quaternion.slerp(p.rel![i + 1], this.limpT));
    }

    // ears flop with speed / bounce, tail wiggles, blink
    const flop = 0.55 + (moving ? Math.sin(this.phase * 2) * 0.25 * amp : 0) - (air ? 0.5 : 0) + (flail ? Math.sin(p.t * 17) * 0.4 : 0);
    set(R.earL, flop, -0.55 + (flail ? Math.sin(p.t * 13) * 0.3 : 0), 14); set(R.earR, flop, 0.55 - (flail ? Math.sin(p.t * 11) * 0.3 : 0), 14);
    R.tail.rotation.y = Math.sin(p.t * (moving ? 14 : 4)) * (moving ? 0.5 : 0.25);
    if (p.t > this.blinkAt) this.blinkAt = p.t + 2 + Math.random() * 3;
    const blink = this.blinkAt - p.t < 0.12 ? 0.1 : 1;
    for (const e of R.eyes) e.scale.y = flail ? 0.25 : damp(e.scale.y, blink, 30, dt);

    // wallow: roll onto the back (around the body's middle, not the feet)
    this.roll.rotation.z = this.rollT * Math.PI * (1 + Math.sin(p.t * 9) * 0.04 * this.rollT);
    this.roll.position.y = this.centerHeight + this.rollT * 0.12;

    // outfit animation
    for (const a of this.animParts) {
      if (a.name === 'spin') a.rotation.y += dt * (8 + p.speed * 6);
      else a.rotation.y = (a.name === 'wingL' ? -1 : 1) * (0.15 + Math.sin(p.t * (moving || air ? 18 : 3)) * (moving || air ? 0.45 : 0.1));
    }

    // mud / burnt tint
    const m = clamp(p.muddy, 0, 1) * 0.8;
    const b = clamp(p.burnt ?? 0, 0, 1) * 0.75;
    for (const s of R.skin) s.mat.color.copy(s.base).lerp(MUD, m).lerp(BURNT, b);
    if (b > 0 && Math.random() < p.dt * 6 * b) G.fx.puff(this.root.position, { count: 1, color: 0x555555, spread: 0.2, speed: 0.2, up: 0.8, life: 1.2, size: 0.4, grow: 0.6, alpha: 0.35 });
  }
}
