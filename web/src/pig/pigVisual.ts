import * as THREE from 'three';
import { rigidSkin } from '../render/batch';
import { damp, clamp, lerp } from '../core/util';
import { G } from '../game/ctx';
import { buildPig, PIVOT, STAND_POS, STAND_ANGLE, NECK, SNOUT_TIP, ARM, type PigRig, type Arm } from './pigModel';
import { HEAD_TILT } from './pigBody';
import { dress, defaultOutfit, type Outfit } from './cosmetics';
import { makeCigarette } from '../world/snacks';

const DOWN = new THREE.Vector3(0, -1, 0);
const SNOUT_DIR = SNOUT_TIP.clone().sub(NECK).normalize();
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const _e = new THREE.Euler();
const _mi = new THREE.Matrix4(), _mouth = new THREE.Vector3(), _sh = new THREE.Vector3(), _t = new THREE.Vector3(), _v = new THREE.Vector3(), _off = new THREE.Vector3();
const _pole = new THREE.Vector3(), _uq = new THREE.Quaternion(), _pp = new THREE.Vector3(), _el = new THREE.Vector3(), _u = new THREE.Vector3(), _w = new THREE.Vector3();
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(), _bm = new THREE.Matrix4(), _bq = new THREE.Quaternion();
const MUD = new THREE.Color(0x6b4423), BURNT = new THREE.Color(0x3a2620), SNOW_COAT = new THREE.Color(0xf6f9ff);

export interface PigPose {
  speed: number; grounded: boolean; vy: number; standing: boolean; mode: string;
  sprinting: boolean; muddy: number; holding: boolean; charging: number; dt: number; t: number; burnt?: number;
  /** 0..1 how close a standing pig is to falling over; punch 0..1 (jab progress). */
  wobble?: number; punch?: number;
  /** Standing balance lean (radians): forward / sideways (+ = toward the pig's left), from the physics. */
  leanF?: number; leanS?: number;
  /** On a balance beam: lean on four legs too. */
  beam?: boolean;
  /** Limp (ragdoll / carried): `rel` = physical rotations of head, frontL, frontR, hindL, hindR relative to the torso. */
  limp?: boolean; rel?: THREE.Quaternion[];
  /** Grip hand position (model space) while holding something: the head (four legs) or the arms (standing) reach for it. */
  hand?: THREE.Vector3 | null;
  /** Half the width of what it holds (one hoof on each side of it). */
  handW?: number;
  /** What it's doing with its hooves / mouth right now ('eat' = chomping, 'puff' = a drag on the cigarette) + progress 0..1. */
  act?: string; actK?: number;
  /** A lit cigarette in its mouth / hoof. */
  cig?: boolean;
  /** Spinach: Popeye arms. */
  strong?: boolean;
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
  /** The lit cigarette: between the toes of the right hoof (standing, hooves free) or in the corner of the mouth. */
  private cig = makeCigarette();
  private ember: THREE.Mesh;
  private bulge = 1;
  /** Four legs, reaching far (the mouse wheel): the neck stretches (rubber neck) — how far, and the neck piece. */
  private neckX = 0; private headRest = new THREE.Vector3(); private neck: THREE.Mesh;

  constructor(public color: number, outfit?: Outfit) {
    this.root.add(this.sway); this.sway.add(this.roll); this.roll.add(this.base);
    this.rig = buildPig(this.base);
    rigidSkin(this.base, undefined, new Set(this.rig.skin.map((s) => s.mat)));   // one draw call per skin colour, not ~40 meshes
    this.spots.position.copy(PIVOT).negate(); this.rig.upper.add(this.spots);
    this.setOutfit(outfit ?? defaultOutfit());
    this.cig.visible = false; this.cig.scale.setScalar(1.5);
    this.ember = this.cig.getObjectByName('ember') as THREE.Mesh;
    this.headRest.copy(this.rig.head.position);
    this.neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 1, 14, 1, true), this.rig.bodyMat);
    this.neck.visible = false; this.neck.castShadow = true; this.rig.upper.add(this.neck);
  }
  /** World position of the cigarette's ember (null when not smoking). */
  cigTip(out: THREE.Vector3) { return this.cig.visible && this.cig.parent ? this.ember.getWorldPosition(out) : null; }
  /** World position of the snout (smoke comes out of it). */
  snoutPos(out: THREE.Vector3) { return this.rig.anchors.snout.getWorldPosition(out); }

  setOutfit(o: Outfit) {
    this.outfit = { ...o };
    this.animParts = dress(this.rig, this.outfit, this.color, this.spots);
  }

  /** Knocked over while standing: the physics torso takes over the standing pose at once. */
  snapStand() { this.standT = 0; this.rig.upper.position.copy(PIVOT); this.rig.upper.rotation.set(0, 0, 0); }

  /**
   * Two-bone IK (upper space): shoulder → elbow → hoof tips reach T, the elbow bends toward `pole`. Out of reach the
   * arm stretches like a rubber hose (cartoon) up to 3.6× (the mouse wheel's long reach).
   */
  private solveArm(a: Arm, T: THREE.Vector3, pole: THREE.Vector3, rate: number, dt: number) {
    const S = a.shoulder.position, L1 = ARM.upper, L2 = ARM.fore;
    const dir = _v.copy(T).sub(S);
    let d = dir.length(); dir.divideScalar(Math.max(d, 1e-4));
    const st = clamp(d / ((L1 + L2) * 0.97), 1, 3.6), l1 = L1 * st, l2 = L2 * st;
    d = clamp(d, Math.abs(l1 - l2) + 0.02, (l1 + l2) * 0.97);
    const ang = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
    _pp.copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (_pp.lengthSq() < 1e-6) _pp.set(0, -1, 0).addScaledVector(dir, dir.y);
    _pp.normalize();
    _el.copy(S).addScaledVector(dir, l1 * Math.cos(ang)).addScaledVector(_pp, l1 * Math.sin(ang));
    const u = _u.copy(_el).sub(S).normalize();
    const w = _w.copy(S).addScaledVector(dir, d).sub(_el).normalize();
    const bend = Math.acos(clamp(u.dot(w), -1, 1));
    _bz.copy(w).addScaledVector(u, -u.dot(w));
    if (_bz.lengthSq() < 1e-6) _bz.copy(_pp).addScaledVector(u, -u.dot(_pp));
    _bz.normalize().negate();
    _by.copy(u).negate();
    _bx.crossVectors(_by, _bz).normalize();
    _bz.crossVectors(_bx, _by);
    _bq.setFromRotationMatrix(_bm.makeBasis(_bx, _by, _bz));
    const k = 1 - Math.exp(-rate * dt);
    a.shoulder.quaternion.slerp(_bq, k);
    a.elbow.rotation.x += (bend - a.elbow.rotation.x) * k;
    a.segU.scale.y = a.segL.scale.y = a.segU.scale.y + (st - a.segU.scale.y) * k;
    a.elbow.position.y = -ARM.upper * a.segU.scale.y; a.hand.position.y = -ARM.hand * a.segU.scale.y;
  }

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
    const lk = Math.max(sT, p.beam ? 0.8 : 0);
    this.lf = damp(this.lf, (p.leanF ?? 0) * lk, 30, dt); this.ls = damp(this.ls, (p.leanS ?? 0) * lk, 30, dt);
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
    // standing (and in control): the front legs are arms driven by IK (hands reach, hold, punch, bring things to the mouth)
    const ik = sT > 0.5 && !flail;
    const A = R.arms;
    if (flail) {
      const f = p.t * (p.mode === 'wallow' ? 12 : 19);
      set(R.frontL, Math.sin(f) * 0.9, 0.3); set(R.frontR, Math.sin(f + 2) * 0.9, -0.3);
      set(R.hindL, Math.sin(f + 1) * 0.9, 0.3); set(R.hindR, Math.sin(f + 3) * 0.9, -0.3);
      A[0].elbow.rotation.x = damp(A[0].elbow.rotation.x, 0.4 + Math.sin(f * 1.3) * 0.5, 16, dt);
      A[1].elbow.rotation.x = damp(A[1].elbow.rotation.x, 0.4 + Math.sin(f * 1.3 + 2) * 0.5, 16, dt);
    } else if (air) {
      if (!ik) {
        set(R.frontL, -0.75 + sT * 1.6, 0.2); set(R.frontR, -0.75 + sT * 1.6, -0.2);
        for (const a of A) a.elbow.rotation.x = damp(a.elbow.rotation.x, 0.9, 14, dt);   // hooves tucked in
      }
      set(R.hindL, 0.75 - sT * 0.5, 0.2); set(R.hindR, 0.75 - sT * 0.5, -0.2);
    } else {
      set(R.hindL, s1 * amp * (1 + sT * 0.3)); set(R.hindR, s2 * amp * (1 + sT * 0.3));
      if (!ik) {
        const arm = lerp(0, (p.holding ? 0.2 : 1.05) * STAND_ANGLE, sT);
        let fl = arm + s2 * amp, fr = arm + s1 * amp;
        if (p.charging > 0) { fl = fr = arm - p.charging * 1.3; }
        set(R.frontL, fl, sT * 0.15); set(R.frontR, fr, -sT * 0.15);
        // trot: the hoof folds back as the leg swings forward
        A[0].elbow.rotation.x = damp(A[0].elbow.rotation.x, Math.max(0, Math.cos(this.phase + Math.PI)) * 0.85 * amp, 20, dt);
        A[1].elbow.rotation.x = damp(A[1].elbow.rotation.x, Math.max(0, Math.cos(this.phase)) * 0.85 * amp, 20, dt);
      }
    }
    R.hindL.position.x = 0.2 * (1 + sT * 0.15); R.hindR.position.x = -0.2 * (1 + sT * 0.15);

    // head: looks ahead when standing; reaches for what it holds (four legs)
    _q.setFromEuler(_e.set(HEAD_TILT * sT + butt * 0.55, 0, 0));
    R.upper.updateMatrix();
    _mi.copy(R.upper.matrix).invert();
    if (p.hand && !flail && sT < 0.5) {
      _p.copy(p.hand).applyMatrix4(_mi);      // hand in the upper body's space
      _d.copy(_p).sub(this.headRest).normalize();
      _qi.setFromUnitVectors(SNOUT_DIR, _d);
      const ang = 2 * Math.acos(Math.min(1, Math.abs(_qi.w)));
      if (ang > 1.1) _qi.slerp(_q.identity(), 1 - 1.1 / ang);
      _q.setFromEuler(_e.set(HEAD_TILT * sT, 0, 0)).premultiply(_qi);
    }
    // eating: chomp chomp (the head bobs; the food is at the mouth); a puff: chin up, then blow the smoke out
    const act = flail ? '' : p.act ?? '', ak = clamp(p.actK ?? 0, 0, 1);
    if (act === 'eat') _q.multiply(_qi.setFromEuler(_e.set(0.25 * sT + Math.sin(p.t * 19) * 0.16, 0, Math.sin(p.t * 7) * 0.08)));
    if (act === 'puff') _q.multiply(_qi.setFromEuler(_e.set(-Math.sin(ak * Math.PI) * 0.3, 0, 0)));
    R.head.quaternion.slerp(_q, 1 - Math.exp(-16 * dt));
    // four legs, holding / working far out in front (the mouse wheel): the neck stretches toward it
    let nx = 0;
    if (p.hand && !flail && sT < 0.5) {
      _p.copy(p.hand).applyMatrix4(_mi);
      nx = clamp(_p.distanceTo(this.headRest) - 0.52, 0, 0.7);
    }
    this.neckX = damp(this.neckX, nx, 14, dt);
    if (this.neckX > 0.01) {
      _d.copy(SNOUT_DIR).applyQuaternion(R.head.quaternion);
      R.head.position.copy(this.headRest).addScaledVector(_d, this.neckX);
      this.neck.visible = true;
      this.neck.position.copy(this.headRest).addScaledVector(_d, this.neckX * 0.5);
      this.neck.quaternion.setFromUnitVectors(_v.set(0, 1, 0), _d);
      this.neck.scale.set(1, this.neckX + 0.12, 1);
    } else if (this.neck.visible) { this.neck.visible = false; R.head.position.copy(this.headRest); }

    // arms (standing): where each hoof goes, in the pig's model space (feet = origin, facing +z, +x = its left)
    if (ik) {
      R.head.updateMatrix();
      const mouth = _mouth.copy(R.anchors.snout.position).applyMatrix4(R.head.matrix).applyMatrix4(R.upper.matrix);
      const punchK = p.punch ? Math.sin(clamp(p.punch, 0, 1) * Math.PI) : 0;
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? 1 : -1, a = A[i];
        const S = _sh.copy(a.shoulder.position).applyMatrix4(R.upper.matrix);
        const T = _t;
        let rate = 22, grip = 0.15;
        if (w > 0.45) {   // windmilling: about to fall
          const k = (w - 0.45) / 0.55, ph = p.t * 16 + (i ? Math.PI : 0);
          T.set(S.x + side * (0.12 + 0.12 * k), S.y + Math.cos(ph) * 0.26 * k + 0.05, S.z + Math.sin(ph) * 0.26 * k + 0.08);
          rate = 30; grip = 0.3;
        } else if (p.hand) {
          // holding: one hoof on each side of the thing
          const hw = clamp(p.handW ?? 0.15, 0.06, 0.32);
          T.copy(p.hand); T.x += side * hw; T.y -= 0.02; T.z -= 0.03;
          rate = 30; grip = 0;
        } else if (air) {
          T.set(S.x + side * 0.16, S.y + 0.22, S.z + 0.08); grip = 0.35;
        } else if (punchK > 0 && i === 1) {
          T.set(S.x + 0.1 * punchK, S.y + 0.06, S.z + 0.16 + 0.46 * punchK); rate = 45; grip = 0;
        } else if (act === 'puff' && i === 1 && p.cig) {
          const k = Math.sin(ak * Math.PI);
          T.set(S.x - side * 0.02, S.y - 0.02, S.z + 0.22).lerp(_v.copy(mouth).add(_off.set(-0.09, -0.03, 0.03)), clamp(k * 1.6, 0, 1));
          grip = 0;
        } else {
          // T-rex arms: hooves in front of the belly, swinging a little as it walks (a fist up when the other punches)
          const sw = moving ? Math.sin(this.phase + (i ? 0 : Math.PI)) * 0.07 * amp : 0;
          const guard = punchK > 0 ? 0.08 : 0;
          const smoker = p.cig && i === 1 ? 0.06 : 0;
          T.set(S.x - side * 0.04, S.y - 0.16 + guard + smoker + breath * 0.5, S.z + 0.17 + sw + guard);
          grip = p.cig && i === 1 ? 0 : 0.12;
        }
        _pole.set(side * 0.6, -1, -0.6).normalize().applyQuaternion(_uq.copy(R.upper.quaternion).invert());
        this.solveArm(a, T.applyMatrix4(_mi), _pole, rate, dt);
        for (const [j, toe] of a.toes.entries()) toe.rotation.z = damp(toe.rotation.z, (j ? -1 : 1) * grip, 20, dt);
      }
    } else {
      for (const a of A) {
        a.segU.scale.y = a.segL.scale.y = damp(a.segU.scale.y, 1, 14, dt);
        a.elbow.position.y = -ARM.upper * a.segU.scale.y; a.hand.position.y = -ARM.hand * a.segU.scale.y;
        for (const [j, toe] of a.toes.entries()) toe.rotation.z = damp(toe.rotation.z, (j ? -1 : 1) * 0.08, 20, dt);
      }
    }

    // the cigarette: in the right hoof when it has free hooves on two legs, else in the corner of the mouth
    this.cig.visible = !!p.cig;
    if (p.cig) {
      const inHoof = ik && !p.hand;
      const parent = inHoof ? A[1].hand : R.anchors.snout;
      if (this.cig.parent !== parent) {
        parent.add(this.cig);
        if (inHoof) { this.cig.position.set(0, -0.085, 0.01); this.cig.rotation.set(Math.PI / 2, 0, 0); }
        else { this.cig.position.set(-0.12, 0.01, -0.03); this.cig.rotation.set(0.2, -0.75, 0); }
      }
      const glow = act === 'puff' ? Math.sin(ak * Math.PI) : 0;
      (this.ember.material as THREE.MeshBasicMaterial).color.setRGB(1, 0.3 + glow * 0.5, 0.08 + glow * 0.3);
      this.ember.scale.setScalar(1 + glow * 0.5);
    }
    // spinach: Popeye arms
    this.bulge = damp(this.bulge, p.strong ? 1.5 : 1, 6, dt);
    for (const a of A) { a.segU.scale.x = a.segU.scale.z = this.bulge; a.segL.scale.x = a.segL.scale.z = 1 + (this.bulge - 1) * 0.6; }

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
    for (const s of R.skin) s.mat.color.copy(s.base).lerp(G.snowy ? SNOW_COAT : MUD, m).lerp(BURNT, b);
    if (b > 0 && Math.random() < p.dt * 6 * b) G.fx.puff(this.root.position, { count: 1, color: 0x555555, spread: 0.2, speed: 0.2, up: 0.8, life: 1.2, size: 0.4, grow: 0.6, alpha: 0.35 });
  }
}
