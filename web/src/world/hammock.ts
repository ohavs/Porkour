import * as THREE from 'three';
import { RAPIER, world, groups, L, owners } from '../core/physics';
import { G } from '../game/ctx';
import { toonMat } from '../render/toon';
import { rigidSkin } from '../render/batch';
import type { Pig } from '../pig/pig';
import type { Prop } from './props';

/**
 * Bob's siesta = breathing window #3: once a round, after lunch, he naps in a striped hammock strung between two posts
 * (sees nothing, hears only what's close, and even then he's groggy for a moment). Pigs can swing the hammock — a ram
 * shoves it hard, headbutts / punches pump it a little each (time them with the swing) — till he flips out onto the
 * ground (prank `hammockFlip`). Or a muddy pig sneaks up to his head and RMB = smears mud on his face (spectacles, a pig
 * snout, whiskers: prank `mudFace`) which he wears for the rest of the round. One synced entity per farm (decor kit).
 */
export const NAP = {
  /** He naps once a round, some time after this game hour (+ up to `spread` h), for … s. */
  hour: 12.5, spread: 1, time: 28,
  /** A noise this close (m) wakes him — after `groggy` s (time for the flip to land). */
  hear: 8, groggy: 1.2,
  /** Swing: stiffness, damping; a ram / a hit adds this much angular speed (rad/s; × the hit's strength: headbutt 0.6, punch 1);
   * over `flip` rad he falls out — one ram, 2 punches or ~4 headbutts timed with the swing. */
  k: 9, damp: 0.35, ram: 3.6, butt: 2.4, flip: 1.05,
  /** Swinging this hard for … s wakes him (if he hasn't fallen out by then). The shoves themselves don't: the rocking lulls him. */
  rouse: 0.7, rouseTime: 3,
  /** RMB reach to his face (m), how many mud marks he can get. */
  faceR: 1.3, marks: 3,
  L: 3.4, H: 1.5,
};

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), q1 = new THREE.Quaternion();
const AX = new THREE.Vector3(1, 0, 0);
/** Bob lying on his back along the hammock (his up → the hammock's +x, his front → up). */
const LIE = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)));
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
/** The bed's sag below the rope line at x (−L/2 … L/2 along the hammock). */
const sag = (x: number) => -0.15 - 0.36 * (1 - (x / 1.35) ** 2);

interface BobLike { state: string; hammockFlipped(h: Hammock, dir: THREE.Vector3): void }

export class Hammock {
  kind = 'hammock' as const;
  root = new THREE.Group();
  /** Turns about the rope line (the swing). */
  private swingG = new THREE.Group();
  base: THREE.Vector3; yaw: number; q0: THREE.Quaternion;
  /** Its long axis and its side (world), where Bob climbs in / out. */
  axis: THREE.Vector3; side: THREE.Vector3; getIn: THREE.Vector3;
  // ---- state (host; synced)
  swing = 0; private omega = 0;
  occupied = false;
  // ---- host
  private hitT = -10; private impactT = -10; private rouseT = 0;
  /** When it was last shoved (the bump's own noise doesn't wake him). */
  pushT = -10;

  constructor(scene: THREE.Scene, x: number, y: number, z: number, yaw: number) {
    this.base = new THREE.Vector3(x, y, z); this.yaw = yaw;
    this.q0 = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    this.axis = new THREE.Vector3(1, 0, 0).applyQuaternion(this.q0);
    this.side = new THREE.Vector3(0, 0, 1).applyQuaternion(this.q0);
    this.getIn = this.base.clone().addScaledVector(this.side, 1.1);
    this.build();
    this.root.position.copy(this.base); this.root.quaternion.copy(this.q0);
    scene.add(this.root);
    // the two posts are solid (rams shove the hammock), the bed isn't (pigs walk under it)
    for (const s of [-1, 1]) {
      const p = this.base.clone().addScaledVector(this.axis, s * NAP.L / 2);
      const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.x, p.y + NAP.H / 2 + 0.05, p.z));
      const c = world.createCollider(RAPIER.ColliderDesc.cylinder(NAP.H / 2 + 0.05, 0.1).setCollisionGroups(groups(L.STATIC)), b);
      owners.set(c.handle, {
        kind: 'hammock',
        onRam: (by: Pig, dir: THREE.Vector3) => this.push(NAP.ram * (by.boosted?.('spinach') ? 1.3 : 1), dir),
        onImpact: (pr: Prop, force: number) => this.impact(pr, force),
      });
    }
    G.hittables.push({ hit: (hx, hy, hz, reach, dir, k) => this.hit(hx, hy, hz, reach, dir, k) });
    G.uses.push({ near: (p: Pig) => this.faceNear(p), icon: () => 'mud' });
  }

  /** Two posts, ropes, spreader bars and a red / cream striped canvas bed. */
  private build() {
    const M = (c: number) => toonMat(c);
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D, rx = 0, ry = 0, rz = 0) => {
      const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
    };
    const wood = M(0x7a4a26), rope = M(0xd9c08a), red = M(0xd8403a), cream = M(0xfff1c9);
    for (const s of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.08, 0.1, NAP.H + 0.25, 8), wood, s * NAP.L / 2, (NAP.H + 0.25) / 2, 0, this.root);
      add(new THREE.SphereGeometry(0.1, 8, 6), wood, s * NAP.L / 2, NAP.H + 0.27, 0, this.root);
    }
    this.swingG.position.set(0, NAP.H - 0.05, 0); this.root.add(this.swingG);
    const W = 0.95, N = 10, x0 = -1.35, x1 = 1.35;
    for (let i = 0; i < N; i++) {
      const a = x0 + ((x1 - x0) * i) / N, b = x0 + ((x1 - x0) * (i + 1)) / N;
      const ya = sag(a), yb = sag(b), len = Math.hypot(b - a, yb - ya);
      add(new THREE.BoxGeometry(len + 0.01, 0.04, W), i % 2 ? cream : red, (a + b) / 2, (ya + yb) / 2, 0, this.swingG, 0, 0, Math.atan2(yb - ya, b - a));
    }
    for (const s of [-1, 1]) {
      const ex = s * 1.38, ey = sag(1.35);
      add(new THREE.CylinderGeometry(0.03, 0.03, W + 0.12, 6), wood, ex, ey, 0, this.swingG, Math.PI / 2, 0, 0);   // spreader bar
      for (const sz of [-1, 1]) {   // ropes from the post's top to the bar ends
        const px = s * NAP.L / 2, dx = ex - px, dy = ey, dz = sz * (W / 2 + 0.05), len = Math.hypot(dx, dy, dz);
        const r = add(new THREE.CylinderGeometry(0.012, 0.012, len, 4), rope, px + dx / 2, dy / 2, dz / 2, this.swingG);
        r.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, v1.set(dx, dy, dz).normalize());
      }
    }
    // a little pillow at the head end
    add(new THREE.SphereGeometry(0.22, 12, 8), cream, 0.95, sag(0.95) + 0.08, 0, this.swingG).scale.set(1, 0.4, 1.4);
    rigidSkin(this.root);
  }

  // ================================================================== queries
  get usable() { return !this.occupied && Math.abs(this.swing) < 0.2; }
  /** Bob's head (world), for the pigs' RMB and the HUD. */
  headPos(out: THREE.Vector3) { return out.set(0.85, sag(0.85) + 0.3, 0).applyAxisAngle(AX, this.swing).add(v2.set(0, NAP.H - 0.05, 0)).applyQuaternion(this.q0).add(this.base); }
  get markPos() { return v1.copy(this.base).setY(this.base.y + NAP.H + 0.9); }
  /** A muddy pig at his face while he naps (RMB = smear). */
  faceNear(p: Pig) {
    if (!this.occupied || p.out || p.cage || p.heldBy || p.held || p.mode !== 'normal' || !(p.muddy > 0)) return false;
    const h = this.headPos(v1), bob = G.farmer as { mudMarks?: number } | null;
    if ((bob?.mudMarks ?? 0) >= NAP.marks) return false;
    return Math.hypot(p.pos.x - h.x, p.pos.z - h.z) < NAP.faceR && p.pos.y + 1.4 > h.y - 0.6;
  }

  // ================================================================== pigs (host)
  /** A shove on the hammock: the swing speeds up toward the hit's side (a well-timed pump adds up). */
  push(k: number, dir: THREE.Vector3) {
    if (G.net === 'client') return;
    const s = -(Math.sign(dir.dot(this.side)) || 1);   // (a positive swing moves the bed toward −side)
    this.omega += s * k; this.pushT = G.time;
    G.audio.play('creak', { pos: this.base, vol: clamp(0.4 + k * 0.15, 0.4, 0.9), pitch: 1.3 + Math.random() * 0.2, minGap: 0.15 });
    G.audio.play('rustle', { pos: this.base, vol: 0.6, minGap: 0.1 });
  }
  private hit(x: number, y: number, z: number, reach: number, dir: THREE.Vector3, k: number) {
    const lx = x - this.base.x, lz = z - this.base.z;
    const along = lx * this.axis.x + lz * this.axis.z, across = lx * this.side.x + lz * this.side.z;
    if (Math.abs(along) > 1.5 || Math.abs(across) > 0.8 + reach * 0.5 || y < this.base.y - 0.4 || y > this.base.y + NAP.H + 0.3) return false;
    if (G.time - this.hitT < 0.25) return true;
    this.hitT = G.time;
    this.push(NAP.butt * k, dir);
    return true;
  }
  private impact(p: Prop, force: number) {
    const sp = p.synced.preVel.length();
    if (sp < 4 || p.mass < 2 || force < p.mass * 120 || G.time - this.impactT < 0.3) return;
    this.impactT = G.time;
    this.push(clamp((p.mass * sp) / 60, 0.3, 3), p.synced.preVel);
  }

  // ================================================================== Bob
  climbIn() { this.occupied = true; this.omega = 0; this.swing *= 0.3; this.rouseT = 0; G.audio.play('creak', { pos: this.base, vol: 0.8, pitch: 0.9 }); }
  climbOut() { this.occupied = false; }
  /** Where Bob lies (render, every browser): his root (feet) + orientation, swinging with the bed. */
  bobPose(pos: THREE.Vector3, q: THREE.Quaternion) {
    pos.set(-0.95, sag(-0.95) + 0.14, 0).applyAxisAngle(AX, this.swing).add(v2.set(0, NAP.H - 0.05, 0)).applyQuaternion(this.q0).add(this.base);
    q.copy(this.q0).multiply(q1.setFromAxisAngle(AX, this.swing)).multiply(LIE);
  }
  /** Swinging hard enough to rouse him (farmer checks it while he naps). */
  get rousing() { return this.rouseT > NAP.rouseTime; }

  // ================================================================== fixed step (host)
  step(dt: number) {
    this.omega += (-NAP.k * Math.sin(this.swing) - NAP.damp * this.omega) * dt;
    this.swing = clamp(this.swing + this.omega * dt, -2.6, 2.6);
    if (Math.abs(this.swing) > NAP.rouse) this.rouseT += dt; else this.rouseT = Math.max(0, this.rouseT - dt * 0.5);
    if (this.occupied && Math.abs(this.swing) > NAP.flip) {
      const dir = v1.copy(this.side).multiplyScalar(-Math.sign(this.swing));   // the way the bed tipped
      this.occupied = false;
      G.audio.play('wood', { pos: this.base, vol: 0.8, pitch: 0.9 });
      (G.farmer as BobLike | null)?.hammockFlipped(this, dir.clone());
    }
    // pigs: a muddy hoof on his face
    for (const p of G.pigs as Pig[]) {
      if (p.input.grabP && this.faceNear(p)) { (G.farmer as { mudFace?(p: Pig): void } | null)?.mudFace?.(p); break; }
    }
  }
  /** New round: still, empty. */
  reset() { this.swing = 0; this.omega = 0; this.occupied = false; this.rouseT = 0; }

  // ================================================================== network
  netState(n: number[]) { n.push(Math.round(this.swing * 1000) / 1000, this.occupied ? 1 : 0); }
  netApply(n: number[]) { if (n.length < 2) return; this.swing = n[0]; this.occupied = n[1] === 1; }

  // ================================================================== render
  render() { this.swingG.rotation.x = this.swing; }
}
