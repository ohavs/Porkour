import * as THREE from 'three';
import { rigidSkin } from '../render/batch';
import { damp, clamp, dampAngle, wrapAngle } from '../core/util';
import { G } from '../game/ctx';
import { buildFarmer, HIP, type FarmerRig } from './farmerModel';

export type FarmerAnim =
  | 'idle' | 'feed' | 'water' | 'chop' | 'coffee' | 'nap' | 'fix' | 'pour' | 'lean'
  | 'look' | 'suspect' | 'windup' | 'lunge' | 'recover' | 'carry' | 'stagger' | 'down' | 'cough' | 'fist' | 'pant' | 'dust'
  | 'ride' | 'slapWind' | 'slap' | 'taunt' | 'dance' | 'read' | 'laundry';

export interface FarmerPose {
  speed: number; run: boolean; anim: FarmerAnim; at: number; t: number; dt: number;
  angry: number; yell: number; lookYaw: number; carrying: boolean; flashlight?: boolean;
  /** Knocked down (real ragdoll): `rel` = physical rotations of head, armL, armR, legL, legR relative to the torso. */
  limp?: boolean; rel?: THREE.Quaternion[];
  /** Grip hand (model space) while he holds a pig: both arms reach for it. */
  hand?: THREE.Vector3 | null;
}

const TOOL: Partial<Record<FarmerAnim, string>> = { feed: 'bucket', pour: 'bucket', water: 'can', chop: 'axe', coffee: 'mug', fix: 'hammer', read: 'paper', laundry: 'shirt' };
const GREEN = new THREE.Color(0x9ccf4f);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0), qa = new THREE.Quaternion();

/** Joint targets; everything is damped toward them so poses blend smoothly. */
interface Targets {
  hipY: number; hipZ: number; tiltX: number; tiltY: number; lean: number; twist: number; roll: number; headX: number; headY: number;
  lsx: number; lsz: number; lex: number; rsx: number; rsz: number; rex: number;
  ltx: number; lkx: number; rtx: number; rkx: number;
}
const rest = (): Targets => ({
  hipY: 0, hipZ: 0, tiltX: 0, tiltY: 0, lean: 0.04, twist: 0, roll: 0, headX: 0, headY: 0,
  lsx: 0.05, lsz: 0.16, lex: -0.15, rsx: 0.05, rsz: -0.16, rex: -0.15, ltx: 0, lkx: 0, rtx: 0, rkx: 0,
});

/** Procedurally animated cartoon farmer: walk / angry run, chores with tools, grab, carry, stagger, knock-down, cough. */
export class FarmerVisual {
  root = new THREE.Group();
  rig: FarmerRig;
  private cur = rest();
  private phase = 0;
  private blinkAt = 1;
  private shown = '';
  private fxT = 0;
  private limpT = 0;

  constructor() {
    this.rig = buildFarmer(this.root);
    rigidSkin(this.root, new Set([this.rig.browL, this.rig.browR, this.rig.mouth]), new Set(this.rig.face.map((f) => f.mat)));   // one draw call instead of ~60
  }

  /** World position of the right hand (for particles). */
  hand(out: THREE.Vector3) { return this.rig.handR.getWorldPosition(out); }
  headPos(out: THREE.Vector3) { return this.rig.head.getWorldPosition(out); }

  update(p: FarmerPose) {
    const R = this.rig, dt = p.dt, t = p.t, a = p.at;
    const T = rest();
    const moving = p.speed > 0.3 && p.anim !== 'down' && p.anim !== 'nap';
    // ---------------------------------------------------------------- locomotion layer
    const runK = p.run ? 1 : 0;
    this.phase += dt * (moving ? clamp(p.speed, 1.5, 7) * (p.run ? 1.55 : 2.4) : 0);
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const amp = moving ? clamp(p.speed / 2.6, 0.4, 1) * (p.run ? 1.2 : 0.75) : 0;
    if (moving) {
      T.ltx = -s * 0.55 * amp; T.rtx = s * 0.55 * amp;
      T.lkx = Math.max(0, c) * 0.9 * amp + 0.05; T.rkx = Math.max(0, -c) * 0.9 * amp + 0.05;
      T.lsx = s * 0.5 * amp - runK * 0.3; T.rsx = -s * 0.5 * amp - runK * 0.3;
      T.lex = -0.25 - runK * 1.1; T.rex = -0.25 - runK * 1.1;
      T.lsz = 0.2 + runK * 0.15; T.rsz = -0.2 - runK * 0.15;
      T.hipY = Math.abs(c) * 0.05 * amp - 0.02 - runK * 0.05;
      T.hipZ = s * 0.07 * amp;                  // waddle
      T.roll = -s * 0.05 * amp;
      T.twist = s * 0.1 * amp;
      T.lean = 0.06 + runK * 0.28;
    }
    // ---------------------------------------------------------------- action layer
    const cyc = (period: number) => (a % period) / period;
    switch (p.anim) {
      case 'idle':
        T.headY = Math.sin(t * 0.35) * 0.35 * Math.max(0, Math.sin(t * 0.13));
        break;
      case 'feed': {   // bucket in the right hand, scattering grain with the left
        T.rsx = -0.55; T.rex = -1.1; T.rsz = -0.25;
        const k = cyc(1.5), sw = k < 0.3 ? k / 0.3 : 1 - (k - 0.3) / 0.7;
        T.lsx = 0.2 - sw * 1.5; T.lsz = 0.3 + sw * 0.4; T.lex = -0.6 + sw * 0.4;
        T.twist = sw * -0.25; T.headY = -0.2;
        if (k > 0.25 && k < 0.32 && this.fxT <= 0) { this.fxT = 0.4; this.grain(); }
        break;
      }
      case 'pour':
        T.lsx = T.rsx = -1.25; T.lex = T.rex = -0.5; T.lsz = 0.1; T.rsz = -0.1; T.lean = 0.2; T.headX = 0.35;
        if (Math.random() < dt * 8) this.grain(0.4);
        break;
      case 'water': {
        T.rsx = -0.95 + Math.sin(a * 0.9) * 0.15; T.rex = -0.35; T.rsz = -0.2 + Math.sin(a * 0.7) * 0.25;
        T.lsz = 0.45; T.lex = -1.4; T.lsx = -0.2; T.lean = 0.12; T.headX = 0.35;
        if (Math.random() < dt * 30) {
          const h = this.tipOf('can', v1);
          G.fx.bits(h, { count: 1, color: 0x7cc7f2, spread: 0.02, speed: 0.4, up: 0.2, grav: 9, life: 0.5, size: 0.06, grow: 0, alpha: 0.9 });
        }
        break;
      }
      case 'chop': {
        const k = cyc(1.6);
        const up = k < 0.55 ? k / 0.55 : k < 0.68 ? 1 - (k - 0.55) / 0.13 : 0;
        T.lsx = T.rsx = -0.7 - up * 2.2; T.lex = T.rex = -0.5 + up * 0.2; T.lsz = 0.05; T.rsz = -0.05;
        T.lean = 0.25 - up * 0.35; T.headX = 0.25 - up * 0.2; T.ltx = -0.25; T.lkx = 0.2; T.rtx = 0.15;
        if (k > 0.67 && k < 0.72 && this.fxT <= 0) {
          this.fxT = 0.5;
          const h = this.tipOf('axe', v1);
          G.audio.play('wood', { pos: h, vol: 0.8, pitch: 0.8 });
          G.fx.bits(h, { count: 8, color: 0xc8955a, speed: 3, up: 2.5, grav: 12, life: 0.6, size: 0.08, grow: 0, alpha: 1 });
        }
        break;
      }
      case 'coffee': {
        const k = cyc(5), sip = k > 0.6 && k < 0.85 ? 1 : 0;
        const sipS = sip;
        T.rsx = -0.5 - sipS * 0.9; T.rex = -1.5 - sipS * 0.7; T.rsz = -0.25 + sipS * 0.2;
        T.lsz = 0.55; T.lsx = 0.15; T.lex = -1.5;   // hand on the hip
        T.headX = -sipS * 0.35; T.lean = -0.04; T.headY = sip ? 0 : Math.sin(t * 0.4) * 0.2;
        if (Math.random() < dt * 1.5) {
          const h = this.tipOf('mug', v1); h.y += 0.08;
          G.fx.puff(h, { count: 1, color: 0xffffff, spread: 0.02, speed: 0.1, up: 0.5, life: 1.2, size: 0.12, grow: 0.25, alpha: 0.35 });
        }
        break;
      }
      case 'nap':
        T.hipY = -HIP + 0.3; T.ltx = T.rtx = -1.45; T.lkx = T.rkx = 0.25; T.lsz = 0.05; T.rsz = -0.05;
        T.lean = -0.35 + Math.sin(t * 1.4) * 0.03; T.headX = 0.45; T.headY = 0.2;
        T.lsx = T.rsx = -0.55; T.lex = T.rex = -1.2; T.lsz = -0.25; T.rsz = 0.25;
        if (Math.random() < dt * 0.7) {
          this.headPos(v1).y += 0.35;
          G.fx.bits(v1, { count: 1, color: 0xffffff, spread: 0.05, speed: 0.3, up: 0.6, life: 2, size: 0.14, grow: 0.12, drag: 0.5, alpha: 0.8 });
        }
        break;
      case 'fix': {
        T.hipY = -0.42; T.ltx = -1.45; T.lkx = 1.45; T.rtx = 0.1; T.rkx = 1.55;
        T.lean = 0.35; T.headX = 0.3;
        const k = cyc(0.42), hit = k < 0.3 ? 1 - k / 0.3 : (k - 0.3) / 0.7;
        T.rsx = -1.0 - hit * 0.7; T.rex = -0.5 + hit * 0.1; T.rsz = -0.1;
        T.lsx = -0.6; T.lex = -0.6;
        if (k < 0.08 && this.fxT <= 0) {
          this.fxT = 0.25;
          const h = this.tipOf('hammer', v1);
          G.audio.play('metal', { pos: h, vol: 0.3, pitch: 1.5, rand: 0.15, minGap: 0.2 });
          if (Math.random() < 0.4) G.fx.bits(h, { count: 3, color: 0xffe08a, speed: 2, up: 1.5, grav: 8, life: 0.3, size: 0.05, grow: 0, alpha: 1 });
        }
        break;
      }
      case 'lean':
        T.lsx = T.rsx = -1.05; T.lex = T.rex = -1.55; T.lsz = 0.1; T.rsz = -0.1; T.lean = 0.33; T.headX = -0.15;
        T.headY = Math.sin(t * 0.3) * 0.4; T.rtx = 0.15; T.rkx = 0.15;
        break;
      case 'look':
        T.rsx = -2.3; T.rex = -1.5; T.rsz = 0.2;       // shading the eyes
        T.headY = Math.sin(a * 1.6) * 0.7; T.twist = Math.sin(a * 1.6) * 0.25; T.lean = 0.12;
        break;
      case 'suspect':
        T.lean = 0.18; T.headX = 0.1; T.lsz = 0.5; T.lex = -1.6; T.rsz = -0.5; T.rex = -1.6; // hands on hips, leaning in
        T.headY = Math.sin(t * 2.2) * 0.08;
        break;
      case 'windup':
        T.hipY = -0.14; T.lean = 0.3; T.ltx = -0.5; T.lkx = 0.6; T.rtx = 0.3; T.rkx = 0.5;
        T.lsx = T.rsx = -1.3; T.lsz = 1.0; T.rsz = -1.0; T.lex = T.rex = -0.4; T.headX = 0.05;
        break;
      case 'lunge':
        T.hipY = -0.18; T.lean = 0.65; T.ltx = -0.9; T.lkx = 0.5; T.rtx = 0.6; T.rkx = 0.2;
        T.lsx = T.rsx = -1.55; T.lsz = 0.25; T.rsz = -0.25; T.lex = T.rex = -0.1; T.headX = -0.25;
        break;
      case 'recover':
        T.lean = 0.5 - a * 0.4; T.hipY = -0.1; T.lsx = T.rsx = -0.4; T.lsz = 0.5; T.rsz = -0.5; T.headY = Math.sin(a * 8) * 0.2;
        break;
      case 'carry':
        T.lsx = T.rsx = -1.05; T.lex = T.rex = -0.85; T.lsz = 0.05; T.rsz = -0.05; T.lean = moving ? -0.04 + runK * 0.15 : -0.08;
        break;
      case 'stagger':
        T.lsx = Math.sin(a * 14) * 1.5 - 1; T.rsx = Math.sin(a * 14 + 2) * 1.5 - 1; T.lsz = 1.1; T.rsz = -1.1;
        T.lean = -0.25 + Math.sin(a * 9) * 0.15; T.roll = Math.sin(a * 7) * 0.25; T.headX = -0.3;
        T.ltx = Math.sin(a * 11) * 0.5; T.rtx = -Math.sin(a * 11) * 0.5; T.lkx = T.rkx = 0.3;
        break;
      case 'down': {
        const k = clamp(a / 0.45, 0, 1);
        T.tiltX = -Math.PI / 2 * (k * k * (3 - 2 * k)); T.hipY = 0;
        T.ltx = -0.4 + Math.sin(a * 13) * 0.4 * Math.max(0, 1 - a); T.rtx = -0.6 - Math.sin(a * 11) * 0.4 * Math.max(0, 1 - a);
        T.lkx = 0.8; T.rkx = 0.5; T.lsz = 1.3; T.rsz = -1.3; T.lsx = -0.3; T.rsx = -0.3; T.lex = T.rex = -0.6;
        T.headX = -0.3 + Math.sin(a * 3) * 0.1; T.headY = Math.sin(a * 2.5) * 0.4;
        if (Math.random() < dt * 6) {     // dizzy stars
          this.headPos(v1);
          v1.x += Math.cos(t * 6) * 0.35; v1.z += Math.sin(t * 6) * 0.35; v1.y += 0.15;
          G.fx.bits(v1, { count: 1, color: 0xffe14d, spread: 0.02, speed: 0.1, up: 0.1, life: 0.5, size: 0.12, grow: 0, alpha: 1 });
        }
        break;
      }
      case 'cough': {
        const k = Math.sin(a * 17) * Math.max(0, Math.sin(a * 3.1));
        T.lean = 0.45 + k * 0.15; T.headX = 0.3 + k * 0.2; T.rsx = -1.7; T.rex = -2.1; T.rsz = 0.25;
        T.lsx = -0.4; T.lsz = 0.9 + Math.sin(a * 9) * 0.4; T.lex = -0.5;   // waving the stink away
        T.hipY = -0.04;
        break;
      }
      case 'fist':
        T.rsx = -2.7; T.rsz = -0.35; T.rex = -0.9 + Math.sin(t * 18) * 0.35; T.lsz = 0.5; T.lex = -1.6; T.lean = -0.05; T.headX = -0.25;
        break;
      case 'pant':
        T.lean = 0.7 + Math.sin(t * 9) * 0.05; T.hipY = -0.1; T.lsx = T.rsx = -0.85; T.lex = T.rex = -0.05; T.lsz = 0.25; T.rsz = -0.25;
        T.ltx = T.rtx = -0.25; T.lkx = T.rkx = 0.45; T.headX = -0.45;
        break;
      case 'dust': {
        const k = Math.sin(a * 16);
        T.lsx = T.rsx = -0.9; T.lex = T.rex = -1.0; T.lsz = 0.05 - k * 0.25; T.rsz = -0.05 + k * 0.25;
        break;
      }
      case 'ride':   // sitting on the mower, hands on the wheel
        T.hipY = -HIP + 0.72; T.ltx = T.rtx = -1.35; T.lkx = T.rkx = 1.2; T.lsz = 0.12; T.rsz = -0.12;
        T.lsx = T.rsx = -1.05; T.lex = T.rex = -0.7; T.lean = 0.1 + Math.sin(t * 9) * 0.02; T.headY = Math.sin(t * 0.7) * 0.25;
        T.hipZ = Math.sin(t * 13) * 0.015;   // engine rumble
        break;
      case 'slapWind':   // right hand raised way back
        T.rsx = -1.0; T.rsz = -1.7; T.rex = -0.6; T.twist = 0.55; T.lean = -0.05; T.lsz = 0.4; T.lex = -1.2; T.headX = -0.1;
        T.ltx = -0.2; T.rtx = 0.2;
        break;
      case 'slap': {   // big backhand swing across
        const k = clamp(a / 0.18, 0, 1);
        T.rsx = -1.4; T.rsz = -1.7 + k * 2.6; T.rex = -0.2; T.twist = 0.55 - k * 1.1; T.lean = 0.2; T.lsz = 0.5; T.lex = -1.3;
        T.ltx = -0.5; T.lkx = 0.4; T.rtx = 0.3;
        break;
      }
      case 'taunt': {   // belly laugh, pointing at the pig
        const k = Math.sin(t * 22);
        T.rsx = -1.5; T.rsz = -0.1; T.rex = -0.05;                     // pointing
        T.lsz = 0.5; T.lsx = 0.1; T.lex = -1.6;                       // hand on the belly
        T.lean = -0.25 + k * 0.05; T.headX = -0.35 + k * 0.08; T.hipY = k * 0.015;
        R.belly.scale.y += k * 0.04;
        break;
      }
      case 'dance': {   // a little farm jig: four moves, two seconds each
        const move = Math.floor(a / 2) % 4, b = a * 7;
        if (move === 0) {          // disco point
          const up = Math.sin(b) > 0;
          T.rsx = up ? -2.6 : -0.4; T.rsz = up ? -0.4 : -0.6; T.rex = 0; T.lsz = 0.5; T.lex = -1.6;
          T.hipZ = Math.sin(b) * 0.12; T.roll = -Math.sin(b) * 0.08; T.headY = up ? 0.3 : -0.2;
        } else if (move === 1) {   // chicken dance
          const fl = Math.abs(Math.sin(b * 1.2));
          T.lsz = 0.4 + fl * 0.9; T.rsz = -0.4 - fl * 0.9; T.lex = T.rex = -1.9; T.lsx = T.rsx = -0.2;
          T.hipY = -0.08 - fl * 0.08; T.lkx = T.rkx = 0.3 + fl * 0.3; T.ltx = T.rtx = -0.2 - fl * 0.2; T.headX = Math.sin(b * 2.4) * 0.2;
        } else if (move === 2) {   // jig: kicks
          const kk = Math.sin(b);
          T.ltx = kk > 0 ? -1.0 * kk : 0; T.rtx = kk < 0 ? 1.0 * kk : 0; T.lkx = Math.max(0, kk) * 0.4; T.rkx = Math.max(0, -kk) * 0.4;
          T.hipY = Math.abs(kk) * 0.06; T.lsz = 0.9; T.rsz = -0.9; T.lex = T.rex = -0.4; T.lsx = T.rsx = Math.sin(b * 2) * 0.4;
          T.tiltY = Math.sin(a * 2) * 0.6;
        } else {                   // hat tip + belly wobble
          T.rsx = -2.4; T.rex = -1.8; T.rsz = -0.2; T.lsz = 0.6; T.lex = -1.5;
          T.hipZ = Math.sin(b * 0.8) * 0.15; T.roll = Math.sin(b * 0.8) * 0.12; T.lean = -0.08; T.tiltY = wrapAngle(a * 3);
        }
        break;
      }
      case 'read':   // sitting, newspaper up
        T.hipY = -HIP + 0.48; T.ltx = T.rtx = -1.45; T.lkx = T.rkx = 1.4; T.lsz = 0.2; T.rsz = -0.2;
        T.lsx = T.rsx = -1.15; T.lex = T.rex = -1.0; T.lean = -0.12; T.headX = 0.15 + Math.sin(t * 0.5) * 0.05;
        T.headY = Math.sin(t * 0.9) * 0.18;
        break;
      case 'laundry': {   // pegging a shirt on the line
        const k = (a % 4) / 4, up = k < 0.5 ? Math.sin(k * Math.PI * 2) : 0;
        T.lsx = T.rsx = -2.3 - up * 0.3; T.lex = T.rex = -0.4; T.lsz = 0.2; T.rsz = -0.2; T.lean = -0.12; T.headX = -0.4;
        break;
      }
    }
    if (moving && (p.anim === 'carry' || p.anim === 'suspect')) { T.ltx = -s * 0.55 * amp; T.rtx = s * 0.55 * amp; }
    if (p.flashlight && !TOOL[p.anim] && p.anim !== 'carry') { T.rsx = -1.25; T.rex = -0.25; T.rsz = -0.05; }
    if (p.limp) {   // physics does the falling: no animated tilt / lean; elbows and knees a little bent
      T.tiltX = 0; T.tiltY = 0; T.hipY = 0; T.hipZ = 0; T.lean = 0; T.twist = 0; T.roll = 0;
      T.lex = T.rex = -0.35; T.lkx = T.rkx = 0.35;
    }
    // ---------------------------------------------------------------- apply (damped)
    const C = this.cur, k = p.anim === 'down' || p.anim === 'lunge' || p.anim === 'stagger' ? 26 : 14;
    for (const key of Object.keys(T) as (keyof Targets)[]) C[key] = damp(C[key], T[key], key === 'tiltX' ? 40 : k, dt);
    const breath = Math.sin(t * (p.anim === 'pant' ? 9 : 2.2)) * (p.anim === 'pant' ? 0.04 : 0.015);
    R.tilt.rotation.set(C.tiltX, p.anim === 'dance' ? T.tiltY : dampAngle(R.tilt.rotation.y, 0, 8, dt), 0); R.tilt.position.y = -C.tiltX / (Math.PI / 2) * 0.38; // lying on the back: body rests on the belly radius
    R.hips.position.y = HIP + C.hipY; R.hips.rotation.z = C.hipZ;
    R.torso.rotation.set(C.lean, C.twist, C.roll);
    R.belly.scale.set(1 + breath, 1 + breath * 0.6, 1 + breath);
    R.head.rotation.set(C.headX, C.headY + p.lookYaw, 0);
    R.shoulderL.rotation.set(C.lsx, 0, C.lsz); R.shoulderR.rotation.set(C.rsx, 0, C.rsz);
    R.elbowL.rotation.x = C.lex; R.elbowR.rotation.x = C.rex;
    R.thighL.rotation.x = C.ltx; R.thighR.rotation.x = C.rtx;
    R.kneeL.rotation.x = C.lkx; R.kneeR.rotation.x = C.rkx;
    // carrying a pig by the scruff: both arms reach for the grip
    if (p.hand && !p.limp) {
      this.root.updateMatrixWorld();
      const local = R.torso.worldToLocal(v1.copy(p.hand).applyMatrix4(this.root.matrixWorld));
      [R.shoulderL, R.shoulderR].forEach((sh, i) => {
        v2.copy(local).setX(local.x + (i ? -0.07 : 0.07)).sub(sh.position);
        if (v2.lengthSq() < 1e-4) return;
        sh.quaternion.copy(qa.setFromUnitVectors(DOWN, v2.normalize()));
      });
      R.elbowL.rotation.x = R.elbowR.rotation.x = -0.2;
    }
    // knocked down: every part shows its physical rotation
    this.limpT = damp(this.limpT, p.limp ? 1 : 0, p.limp ? 25 : 6, dt);
    if (this.limpT > 0.01 && p.rel) {
      [R.head, R.shoulderL, R.shoulderR, R.thighL, R.thighR].forEach((o, i) => o.quaternion.slerp(p.rel![i], this.limpT));
    }
    // face: brows, mouth, blink, cough tint
    const ang = clamp(p.angry, 0, 1);
    R.browL.rotation.z = Math.PI / 2 - 0.45 * ang + (p.anim === 'down' ? 0.3 : 0);
    R.browR.rotation.z = Math.PI / 2 + 0.45 * ang - (p.anim === 'down' ? 0.3 : 0);
    R.browL.position.y = R.browR.position.y = 0.3 - ang * 0.02 + (p.anim === 'suspect' || p.anim === 'look' ? 0.025 : 0);
    R.mouth.scale.y = damp(R.mouth.scale.y, 0.012 + clamp(p.yell, 0, 1) * 0.05 + (p.anim === 'pant' || p.anim === 'cough' ? 0.035 : 0), 20, dt);
    if (t > this.blinkAt) this.blinkAt = t + 2 + Math.random() * 3;
    const shut = p.anim === 'nap' || p.anim === 'down' || p.anim === 'cough' ? 0.15 : this.blinkAt - t < 0.12 ? 0.1 : 1;
    for (const e of R.eyes) e.scale.y = damp(e.scale.y, shut, 30, dt);
    const green = p.anim === 'cough' ? 0.55 : 0;
    for (const f of R.face) f.mat.color.copy(f.base).lerp(GREEN, green);
    // hat flies a little when knocked
    R.hat.position.y = 0.36 + (p.anim === 'down' ? Math.max(0, 0.25 - Math.abs(a - 0.3)) * 0.8 : 0);
    // tools
    const want = TOOL[p.anim] ?? (p.flashlight && p.anim !== 'carry' ? 'flashlight' : '');
    if (want !== this.shown) {
      for (const [n, o] of Object.entries(R.tools)) o.visible = n === want;
      this.shown = want;
    }
    if (want === 'can') R.tools.can.rotation.x = 0.55 + Math.sin(a * 0.9) * 0.1;
    this.fxT -= dt;
    this.root.updateMatrixWorld();
  }

  private tipOf(tool: string, out: THREE.Vector3) {
    const o = this.rig.tools[tool];
    if (tool === 'can') return o.localToWorld(out.set(0, -0.02, 0.4));
    if (tool === 'axe') return o.localToWorld(out.set(0, -0.07, 0.58));
    if (tool === 'hammer') return o.localToWorld(out.set(0, 0, 0.26));
    return o.getWorldPosition(out);
  }
  private grain(spread = 1) {
    const h = this.rig.handL.getWorldPosition(v1);
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
    G.fx.bits(h, { count: Math.ceil(10 * spread), color: 0xf2d27a, spread: 0.05, speed: 2.4 * spread, up: 1, grav: 10, life: 0.7, size: 0.05, grow: 0, drag: 1, alpha: 1, dir: f });
  }
}
