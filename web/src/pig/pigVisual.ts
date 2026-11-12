import * as THREE from 'three';
import { damp, clamp, lerp } from '../core/util';
import { toonMat } from '../render/toon';
import { G } from '../game/ctx';
import { buildPig, PIVOT, type PigRig } from './pigModel';

const STAND_POS = new THREE.Vector3(0, PIVOT.y + 0.1, PIVOT.z + 0.05);
const STAND_ANGLE = 1.25;
const MUD = new THREE.Color(0x6b4423), BURNT = new THREE.Color(0x3a2620);

export interface PigPose {
  speed: number; grounded: boolean; vy: number; standing: boolean; mode: string;
  sprinting: boolean; muddy: number; holding: boolean; charging: number; dt: number; t: number; burnt?: number;
}

/**
 * Procedurally animated cartoon pig: trot, stand up on the hind legs (front legs become arms), wallow on the back,
 * flail when ragdolled / carried, floppy ears, wiggly tail, blinking, squash & stretch, party hat in the player colour.
 */
export class PigVisual {
  root = new THREE.Group();
  private roll = new THREE.Group();
  private base = new THREE.Group();
  private rig: PigRig;
  private phase = 0; private standT = 0; private rollT = 0; private squash = 0;
  private lastGrounded = true; private blinkAt = 2;
  centerHeight = 0.36;

  constructor(color: number) {
    this.root.add(this.roll); this.roll.add(this.base);
    this.rig = buildPig(this.base);
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.32, 18), toonMat(color));
    hat.position.y = 0.14; hat.castShadow = true;
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), toonMat(0xffffff)); pom.position.y = 0.17; hat.add(pom);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.022, 8, 24), toonMat(0xffffff)); band.rotation.x = Math.PI / 2; band.position.y = -0.14; hat.add(band);
    this.rig.hatAnchor.add(hat);
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

    // hinge
    R.upper.position.lerpVectors(PIVOT, STAND_POS, sT);
    R.upper.rotation.x = -STAND_ANGLE * sT + (moving ? Math.sin(this.phase * 2) * 0.04 * amp : 0);
    R.upper.rotation.z = moving ? Math.sin(this.phase) * 0.06 * amp * (sT * 2 + 0.6) : 0;
    this.base.position.y = -this.centerHeight + (moving ? Math.abs(Math.sin(this.phase)) * 0.05 * amp : 0);

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
      if (p.charging > 0) { fl = fr = arm - p.charging * 1.3; }
      set(R.frontL, fl, sT * 0.15); set(R.frontR, fr, -sT * 0.15);
    }
    R.hindL.position.x = 0.2 * (1 + sT * 0.15); R.hindR.position.x = -0.2 * (1 + sT * 0.15);

    // ears flop with speed / bounce, tail wiggles, blink
    const flop = 0.55 + (moving ? Math.sin(this.phase * 2) * 0.25 * amp : 0) - (air ? 0.5 : 0) + (flail ? Math.sin(p.t * 17) * 0.4 : 0);
    set(R.earL, flop, -0.55 + (flail ? Math.sin(p.t * 13) * 0.3 : 0), 14); set(R.earR, flop, 0.55 - (flail ? Math.sin(p.t * 11) * 0.3 : 0), 14);
    R.tail.rotation.y = Math.sin(p.t * (moving ? 14 : 4)) * (moving ? 0.5 : 0.25);
    if (p.t > this.blinkAt) this.blinkAt = p.t + 2 + Math.random() * 3;
    const blink = this.blinkAt - p.t < 0.12 ? 0.1 : 1;
    for (const e of R.eyes) e.scale.y = flail ? 0.25 : damp(e.scale.y, blink, 30, dt);

    // wallow: roll onto the back
    this.roll.rotation.z = this.rollT * Math.PI * (1 + Math.sin(p.t * 9) * 0.04 * this.rollT);
    this.roll.position.y = this.rollT * 0.12;

    // mud
    const m = clamp(p.muddy, 0, 1) * 0.8;
    const b = clamp(p.burnt ?? 0, 0, 1) * 0.75;
    for (const s of R.skin) s.mat.color.copy(s.base).lerp(MUD, m).lerp(BURNT, b);
    if (b > 0 && Math.random() < p.dt * 6 * b) G.fx.puff(this.root.position, { count: 1, color: 0x555555, spread: 0.2, speed: 0.2, up: 0.8, life: 1.2, size: 0.4, grow: 0.6, alpha: 0.35 });
  }
}
