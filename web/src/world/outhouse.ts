import * as THREE from 'three';
import { RAPIER, world, groups, L, owners } from '../core/physics';
import { G } from '../game/ctx';
import { toonMat } from '../render/toon';
import { rigidSkin } from '../render/batch';
import type { Pig } from '../pig/pig';
import type { Prop } from './props';
import type { BobJob } from '../farmer/farmer';

/**
 * Bob's outhouse = a breathing window (GDD: coffee, nap, phone call, toilet): a couple of times a round he walks
 * over, goes in and sees nothing for a while. Pigs can slide the bolt on the door (he bangs, then bursts out
 * furious) or rock it over (rams, headbutts, things thrown at it): with him inside he's flung out of the door —
 * or, when it lands on its door, stuck banging until he heaves it back up. Bob puts it back up / rehangs the door
 * when he notices (a farm job). One synced entity per outhouse (every farm has one, built by the decor kit).
 */
export const LOO = {
  /** His breaks: the first one this many s into the round, then every … s (he goes between two chores). */
  first: [70, 120] as [number, number], every: [150, 210] as [number, number],
  /** Seconds inside; a noise this close (m) or a knock on the door brings him out sooner. */
  time: 18, hear: 14,
  /** Bolted in: he bangs every … s, bursts the door off after … s. Landed on its door: he heaves it up after … s. */
  bangEvery: 1.2, lockedMax: 20, stuck: 10,
  /** Rocking it: a ram adds this, a headbutt / punch this × the hit's strength, a thrown thing by momentum / … ; 1 = over. */
  ram: 0.62, punch: 0.24, impact: 170, drain: 0.1,
  /** Bob notices it tipped / its door off (m), waits this long first, fixes it in … s. */
  notice: 26, fixAfter: 5, fixTime: 6,
  /** How close a pig must be to the bolt (m). */
  boltR: 1.2,
  W: 1.2, H: 2.1,
};

const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), q3 = new THREE.Quaternion();
/** Scratch for `pose` only (callers pass the other scratch vectors in). */
const s1 = new THREE.Vector3(), s2 = new THREE.Vector3(), sq = new THREE.Quaternion();
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const rand = ([a, b]: [number, number]) => a + Math.random() * (b - a);
/** Tip directions in the hut's own frame: 0 = onto its door (front), 1 = right, 2 = backward, 3 = left. */
const LOCAL_DIRS = [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0)];

interface BobLike {
  pos: THREE.Vector3; state: string;
  looksAt(pt: THREE.Vector3, range?: number): boolean;
  looTipped(o: Outhouse, doorDown: boolean): void;
  looKnock(o: Outhouse): void;
}

export class Outhouse {
  kind = 'outhouse' as const;
  root = new THREE.Group();
  /** Inside the root: rocks on its base (wobble / his banging). */
  private hut = new THREE.Group();
  private doorPivot = new THREE.Group(); private bolt = new THREE.Group();
  /** (Not `body`: the network sync would move it; the tip angle does.) */
  private rb: RAPIER.RigidBody;
  private q0: THREE.Quaternion;
  /** Where it stands (ground, centre), the way its door faces, where Bob stands to go in, the bolt. */
  base: THREE.Vector3; front: THREE.Vector3; doorstep: THREE.Vector3; boltAt: THREE.Vector3;
  // ---- state (host; synced)
  /** Tipped angle (0 upright .. π/2 on its side) and which way (LOCAL_DIRS index, -1 = upright); 1 = falling, -1 = rising. */
  tip = 0; tipIdx = -1; tipping = 0; private tipVel = 0;
  /** Door angle (0 shut .. ~1.7 open) and where it's going. */
  door = 0; private doorGoal = 0; private closeAt = 0;
  bolted = false; broken = false; occupied = false;
  /** 0..1: how hard it's rocking (1 = over it goes). */
  rock = 0; private rockDir = new THREE.Vector3(1, 0, 0);
  /** Bangs from inside (a counter: every browser jolts the hut when it changes). */
  bangs = 0;
  /** When it got knocked over / its door broken (Bob waits a little before he comes to fix it). */
  private hurtAt = -10;
  private knockT = -10; private impactT = -10;
  // ---- render-only
  private shownBangs = 0; private joltT = 9; private flyT = 9; private wasBroken = false; private shownDoor = 0;

  constructor(scene: THREE.Scene, x: number, y: number, z: number, yaw: number) {
    this.base = new THREE.Vector3(x, y, z);
    this.q0 = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    this.front = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    this.doorstep = this.base.clone().addScaledVector(this.front, 1.55);
    this.boltAt = new THREE.Vector3(0.5, 1.0, 0.66).applyQuaternion(this.q0).add(this.base);
    this.build();
    this.root.position.copy(this.base); this.root.quaternion.copy(this.q0);
    scene.add(this.root);
    // physics: fixed while it stands (Bob's nav grid sees it), kinematic once it starts moving
    this.rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation({ x: this.q0.x, y: this.q0.y, z: this.q0.z, w: this.q0.w }));
    const c = world.createCollider(RAPIER.ColliderDesc.cuboid(LOO.W / 2 + 0.02, LOO.H / 2, LOO.W / 2 + 0.02).setTranslation(0, LOO.H / 2, 0)
      .setFriction(0.6).setCollisionGroups(groups(L.STATIC)), this.rb);
    owners.set(c.handle, {
      kind: 'outhouse',
      onRam: (by: Pig, dir: THREE.Vector3) => this.push(LOO.ram * (by.boosted?.('spinach') ? 1.4 : 1), dir, by),
      onImpact: (p: Prop, force: number) => this.impact(p, force),
    });
    G.hittables.push({ hit: (hx, hy, hz, reach, dir, k, by) => this.hit(hx, hy, hz, reach, dir, k, by as Pig | null) });
    G.jobs.push({ spot: (bob: BobLike) => this.jobFor(bob) });
  }

  /** Planks, a tin roof, the door with a moon on it, the bolt, a toilet roll on a nail. */
  private build() {
    const M = (c: number) => toonMat(c);
    const box = (sx: number, sy: number, sz: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D, rx = 0, ry = 0, rz = 0) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
      o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
    };
    const W = LOO.W, H = LOO.H, wood = M(0x8f6034), dark = M(0x5e3a1c), light = M(0xa8774a);
    this.root.add(this.hut);
    box(W, H, W, wood, 0, H / 2, 0, this.hut);
    // plank seams on the sides and back
    for (const s of [-1, 1]) for (const k of [-0.3, 0, 0.3]) box(0.03, H - 0.1, 0.02, dark, k, H / 2, s === 1 ? -W / 2 - 0.005 : -W / 2 - 0.005, this.hut, 0, s === 1 ? 0 : Math.PI / 2);
    for (const s of [-1, 1]) for (const k of [-0.3, 0.3]) box(0.02, H - 0.1, 0.03, dark, s * (W / 2 + 0.005), H / 2, k, this.hut);
    box(W + 0.25, 0.1, W + 0.3, M(0x6b4226), 0, H + 0.1, 0, this.hut, 0.12, 0, 0);
    box(W + 0.05, 0.08, 0.06, dark, 0, H - 0.04, W / 2 + 0.02, this.hut);                          // lintel
    // the door: hinge on its left edge, swings outward
    this.doorPivot.position.set(-0.4, 0, W / 2 + 0.01); this.hut.add(this.doorPivot);
    box(0.8, 1.72, 0.05, light, 0.4, 0.9, 0, this.doorPivot);
    box(0.7, 0.08, 0.03, dark, 0.4, 0.45, 0.035, this.doorPivot); box(0.7, 0.08, 0.03, dark, 0.4, 1.35, 0.035, this.doorPivot);
    const moon = new THREE.Shape(); moon.absarc(0, 0, 0.11, 0.6, Math.PI * 2 - 0.6, false); moon.absarc(0.06, 0, 0.09, Math.PI * 2 - 0.9, 0.9, true);
    const mm = new THREE.Mesh(new THREE.ShapeGeometry(moon), M(0x2b1a0c)); mm.position.set(0.4, 1.58, 0.03); this.doorPivot.add(mm);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), M(0x3b2412)); knob.position.set(0.7, 0.95, 0.05); this.doorPivot.add(knob);
    // slide bolt: the red bar rides on the door, the bracket is on the frame
    this.bolt.position.set(0.66, 1.05, 0.05); this.doorPivot.add(this.bolt);
    box(0.24, 0.06, 0.05, M(0xd9442b), 0, 0, 0, this.bolt);
    box(0.04, 0.1, 0.05, M(0xd9442b), -0.08, 0.05, 0.02, this.bolt);
    box(0.08, 0.14, 0.07, M(0x3a3a40), 0.5, 1.05, W / 2 + 0.04, this.hut);
    // a toilet roll on a nail by the door
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.11, 12), M(0xfff8ee));
    roll.rotation.z = Math.PI / 2; roll.position.set(W / 2 + 0.09, 1.2, 0.25); roll.castShadow = true; this.hut.add(roll);
    rigidSkin(this.root);
  }

  // ================================================================== geometry
  /** World direction of a tip index. */
  private dirOf(i: number, out: THREE.Vector3) { return out.copy(LOCAL_DIRS[i]).applyQuaternion(this.q0); }
  /** The hut's world pose at a tip angle (it turns about the bottom edge on the side it falls to). */
  private pose(tip: number, outP: THREE.Vector3, outQ: THREE.Quaternion) {
    if (this.tipIdx < 0 || tip <= 0) { outP.copy(this.base); outQ.copy(this.q0); return; }
    const d = this.dirOf(this.tipIdx, s1);
    sq.setFromAxisAngle(s2.set(d.z, 0, -d.x), tip);
    const px = this.base.x + d.x * LOO.W / 2, pz = this.base.z + d.z * LOO.W / 2;
    outP.set(this.base.x - px, 0, this.base.z - pz).applyQuaternion(sq).add(s2.set(px, this.base.y, pz));
    outQ.copy(sq).multiply(this.q0);
  }
  private placeBody() {
    const p = v1, q = q1;
    this.pose(this.tip, p, q);
    if (this.rb.isKinematic()) { this.rb.setNextKinematicTranslation(p); this.rb.setNextKinematicRotation(q); }
    else { this.rb.setTranslation(p, true); this.rb.setRotation(q, true); }
  }
  private kinematic() { if (!this.rb.isKinematic()) this.rb.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true); }
  /** Where Bob comes out (in front of the door, standing). */
  exitPoint(out: THREE.Vector3) { return out.copy(this.base).addScaledVector(this.front, 1.2); }
  /** Lying on its side / back: where the door opening is now and which way it faces (world). */
  doorOut(pos: THREE.Vector3, dir: THREE.Vector3) {
    this.pose(this.tip, pos, q1);
    const qT = q2.copy(q1).multiply(q3.copy(this.q0).invert());
    dir.copy(this.front).applyQuaternion(qT);
    pos.add(v2.set(0, LOO.H / 2, 0).applyQuaternion(q1)).addScaledVector(dir, LOO.W / 2 + 0.55);
    return pos;
  }
  /** Fallen on its door (he can't get out). */
  get doorDown() { return this.tipIdx === 0 && this.tip > 0.1; }
  get upright() { return this.tip === 0 && this.tipping === 0; }
  /** Bob can use it (he slides the bolt back himself). */
  get usable() { return this.upright && !this.broken && !this.occupied; }
  get needsFix() { return !this.occupied && this.tipping === 0 && (this.tip > 0 || this.broken); }
  /** Where an arrow / the HUD points at it. */
  get markPos() { return v2.copy(this.base).setY(this.base.y + (this.tip > 0 ? 1.5 : LOO.H + 0.4)); }

  // ================================================================== pigs (host)
  /** At the bolt, outside the door (the HUD prompt, RMB = no grab here). */
  boltNear(p: Pig) {
    if (!this.upright || this.broken || this.door > 0.25 || p.out || p.cage || p.heldBy || p.mode !== 'normal') return false;
    if ((p.pos.x - this.base.x) * this.front.x + (p.pos.z - this.base.z) * this.front.z < 0.3) return false;
    return Math.hypot(p.pos.x - this.boltAt.x, p.pos.z - this.boltAt.z) < LOO.boltR && Math.abs(p.pos.y + 0.5 - this.boltAt.y) < 1.6;
  }
  setBolt(on: boolean, by: Pig | null) {
    if (on === this.bolted) return;
    this.bolted = on;
    G.audio.play('unlock', { pos: this.boltAt, vol: 0.8, pitch: on ? 1.5 : 1.2 });
    if (by) G.events.push({ type: on ? 'looBolted' : 'looUnbolted', who: by });
    if (on && this.occupied) G.audio.play('bob_huh', { pos: this.boltAt, vol: 0.7, minGap: 1 });
  }
  /** A ram / a hit / something thrown at it: it rocks; enough and over it goes. */
  push(k: number, dir: THREE.Vector3, by: Pig | null) {
    if (!this.upright || G.net === 'client') return;
    this.rock = Math.min(1.2, this.rock + k);
    if (Math.hypot(dir.x, dir.z) > 0.01) this.rockDir.set(dir.x, 0, dir.z).normalize();
    G.audio.play('wood', { pos: this.base, vol: clamp(0.5 + k, 0.5, 1), pitch: 0.75 + Math.random() * 0.15 });
    G.noise(this.base, 10);
    if (this.occupied) G.farmer?.looKnock?.(this);
    if (this.rock >= 1) this.knockOver(this.rockDir, by);
  }
  private hit(x: number, y: number, z: number, reach: number, dir: THREE.Vector3, k: number, by: Pig | null) {
    if (!this.upright) return false;
    const lx = x - this.base.x, lz = z - this.base.z;
    if (Math.hypot(lx, lz) > LOO.W / 2 + 0.25 + reach * 0.5 || y < this.base.y - 0.5 || y > this.base.y + LOO.H) return false;
    if (G.time - this.knockT < 0.25) return true;
    this.knockT = G.time;
    this.push(LOO.punch * k, dir, by);
    return true;
  }
  private impact(p: Prop, force: number) {
    const sp = p.synced.preVel.length();
    if (sp < 4 || p.mass < 2 || force < p.mass * 120 || G.time - this.impactT < 0.3) return;
    this.impactT = G.time;
    this.push(clamp((p.mass * sp) / LOO.impact, 0.05, 0.7), p.synced.preVel, null);
  }
  /** Over it goes (toward the side it was pushed). */
  knockOver(dir: THREE.Vector3, by: Pig | null) {
    if (!this.upright) return;
    // the side it falls to: the hut's own axis closest to the push
    let best = 0, bd = -Infinity;
    for (let i = 0; i < 4; i++) { const d = this.dirOf(i, v1).dot(dir); if (d > bd) { bd = d; best = i; } }
    this.tipIdx = best; this.tipping = 1; this.tipVel = 0.9; this.rock = 0;
    this.doorGoal = 0; this.closeAt = 0;
    this.kinematic();
    G.audio.play('creak', { pos: this.base, vol: 1, pitch: 0.7 });
    if (this.occupied) G.audio.play('bob_huh', { pos: this.base, vol: 1, minGap: 0.5 });
    if (by) G.events.push({ type: 'looRocked', who: by });
  }
  private landed() {
    const d = this.dirOf(this.tipIdx, v1);
    const at = v2.copy(this.base).addScaledVector(d, 1.4);
    G.audio.play('wood', { pos: at, vol: 1, pitch: 0.6 });
    G.audio.play('thud|body', { pos: at, vol: 1, pitch: 0.7 });
    G.fx.puff(at, { count: 16, color: 0xd8c29a, spread: 1, speed: 2.2, up: 0.8, life: 1.1, size: 1.1, alpha: 0.6 });
    G.fx.bits(at, { count: 14, color: 0x8f6034, spread: 0.8, speed: 3.5, up: 3, grav: 12, life: 0.8, size: 0.1, grow: 0, alpha: 1 });
    G.fx.shake(0.3);
    G.noise(at, 28);
    this.hurtAt = G.time;
    G.events.push({ type: 'looTipped', text: this.occupied ? 'bob' : '' });
    if (this.occupied) G.farmer?.looTipped?.(this, this.doorDown);
  }

  // ================================================================== Bob
  /** He goes in (slides the bolt back if a pig shut it), the door swings open and slams behind him. */
  enter() {
    this.occupied = true; this.bolted = false; this.rock = 0;
    this.swing();
  }
  /** He comes out (the door swings open and shut again). */
  leave() { this.occupied = false; this.swing(); }
  /** He's gone without the door (knock-down, round reset…). */
  vacate() { this.occupied = false; }
  private swing() {
    this.doorGoal = 1.7; this.closeAt = G.time + 0.7;
    G.audio.play('creak', { pos: this.doorstep, vol: 0.7, pitch: 1.1 + Math.random() * 0.2 });
  }
  /** Locked in: BANG on the door (the hut jolts). */
  bang() {
    this.bangs++;
    G.audio.play('wood|thud', { pos: this.base, vol: 1, pitch: 0.7 + Math.random() * 0.25 });
    G.fx.puff(v1.copy(this.base).setY(this.base.y + LOO.H + 0.1), { count: 3, color: 0xd8c29a, speed: 0.8, up: 0.3, life: 0.7, size: 0.5, alpha: 0.5 });
    G.noise(this.base, 16);
  }
  /** Fed up: the door flies off its hinges. */
  burst() {
    this.broken = true; this.bolted = false; this.occupied = false; this.door = 0; this.doorGoal = 0; this.closeAt = 0;
    this.hurtAt = G.time;
    G.audio.play('wood', { pos: this.doorstep, vol: 1, pitch: 0.55 });
    G.audio.play('thud|body', { pos: this.doorstep, vol: 1 });
    G.fx.bits(this.doorstep, { count: 22, color: 0xa8774a, spread: 0.6, speed: 4.5, up: 3.5, grav: 12, life: 0.9, size: 0.12, grow: 0, alpha: 1 });
    G.fx.puff(this.doorstep, { count: 10, color: 0xd8c29a, speed: 1.8, up: 0.6, life: 0.9, size: 0.9, alpha: 0.6 });
    G.noise(this.doorstep, 24);
    G.events.push({ type: 'looBurst' });
  }
  /** Thrown out of the door (it was knocked over with him inside): the door is gone. */
  eject() { this.occupied = false; this.broken = true; this.bolted = false; this.hurtAt = G.time; }
  /** Landed on its door with him inside: he heaves it back up from in there. */
  heave() { this.tipping = -1; G.audio.play('creak', { pos: this.base, vol: 1, pitch: 0.6 }); }
  /** Bob's job (or admin): back on its feet, door rehung, bolt open. */
  fix() {
    if (this.tip > 0) this.tipping = -1;
    this.broken = false; this.bolted = false; this.door = 0; this.doorGoal = 0;
    G.audio.play('wood', { pos: this.base, vol: 0.9, pitch: 1.2 });
  }
  private jobFor(bob: BobLike): BobJob | null {
    if (!this.needsFix || G.time - this.hurtAt < LOO.fixAfter) return null;
    if (!bob.looksAt(v1.copy(this.base).setY(this.base.y + 0.8), LOO.notice)) return null;
    return this.jobOf();
  }
  jobOf(): BobJob {
    // tipped: he stands at its bottom (outside the spot it stood on: his nav grid still has it there)
    const at = this.tip > 0 ? this.base.clone().addScaledVector(this.dirOf(this.tipIdx, v1), -1.2) : this.doorstep.clone();
    return {
      at, look: this.base.clone().setY(this.base.y + 0.8), dur: LOO.fixTime, activity: 'bob.fixLoo',
      still: () => this.needsFix, done: () => this.fix(),
    };
  }

  // ================================================================== fixed step (host)
  step(dt: number) {
    this.rock = Math.max(0, this.rock - LOO.drain * dt);
    if (this.tipping === 1) {
      this.tipVel += 11 * Math.sin(Math.max(this.tip, 0.15)) * dt + 2 * dt;
      this.tip += this.tipVel * dt;
      if (this.tip >= Math.PI / 2) { this.tip = Math.PI / 2; this.tipping = 0; this.placeBody(); this.landed(); return; }
      this.placeBody();
    } else if (this.tipping === -1) {
      this.tip -= 1.5 * dt;
      if (this.tip <= 0) { this.tip = 0; this.tipping = 0; this.tipIdx = -1; G.audio.play('wood', { pos: this.base, vol: 0.9, pitch: 0.8 }); G.events.push({ type: 'looUp' }); }
      this.placeBody();
    }
    if (this.closeAt && G.time > this.closeAt) { this.closeAt = 0; this.doorGoal = 0; }
    const k = this.doorGoal > this.door ? 7 : 4.5, was = this.door;
    this.door += clamp(this.doorGoal - this.door, -k * dt, k * dt);
    if (was > 0.05 && this.door <= 0.05 && this.doorGoal === 0) { this.door = 0; G.audio.play('wood', { pos: this.doorstep, vol: 0.8, pitch: 1.3 }); }
    // pigs at the bolt: RMB slides it (LMB = a headbutt on the door: Bob hears the knock)
    for (const p of G.pigs as Pig[]) {
      if (!this.boltNear(p)) continue;
      const inp = p.input;
      if (inp.grabP && !p.held) { this.setBolt(!this.bolted, p); break; }
    }
  }

  /** New round: standing, door on, nobody inside. */
  reset() {
    this.tip = 0; this.tipIdx = -1; this.tipping = 0; this.tipVel = 0;
    this.door = 0; this.doorGoal = 0; this.closeAt = 0;
    this.bolted = false; this.broken = false; this.occupied = false; this.rock = 0; this.hurtAt = -10;
    this.placeBody();
  }

  // ================================================================== network
  netState(n: number[]) {
    n.push(Math.round(this.tip * 1000) / 1000, this.tipIdx, Math.round(this.door * 100) / 100,
      (this.bolted ? 1 : 0) | (this.broken ? 2 : 0) | (this.occupied ? 4 : 0), Math.round(this.rock * 100) / 100, this.bangs, Math.round(this.rockDir.x * 100) / 100, Math.round(this.rockDir.z * 100) / 100);
  }
  netApply(n: number[]) {
    if (n.length < 6) return;
    const moved = n[0] !== this.tip || n[1] !== this.tipIdx;
    this.tip = n[0]; this.tipIdx = n[1]; this.door = n[2];
    this.bolted = (n[3] & 1) !== 0; this.broken = (n[3] & 2) !== 0; this.occupied = (n[3] & 4) !== 0;
    this.rock = n[4]; this.bangs = n[5];
    if (n[6] !== undefined) this.rockDir.set(n[6], 0, n[7]);
    if (moved) { if (this.tip > 0) this.kinematic(); this.placeBody(); }
  }

  // ================================================================== render (every browser)
  render(dt: number) {
    this.pose(this.tip, this.root.position, this.root.quaternion);
    // jolts when he bangs inside, rocks when it's pushed
    if (this.bangs !== this.shownBangs) { this.shownBangs = this.bangs; this.joltT = 0; }
    this.joltT += dt;
    const t = G.time, jolt = this.joltT < 0.35 ? Math.sin(this.joltT * 40) * 0.04 * (1 - this.joltT / 0.35) : 0;
    const wob = this.rock > 0.02 && this.tip === 0 ? Math.sin(t * 13) * this.rock * 0.09 : 0;
    // rock about the axis across the push (in the hut's frame)
    v1.copy(this.rockDir).applyQuaternion(q1.copy(this.q0).invert());
    this.hut.quaternion.setFromAxisAngle(v2.set(v1.z, 0, -v1.x).normalize(), wob + jolt);
    // door: swings on its hinge; broken = flies off and lies in front
    if (this.broken !== this.wasBroken) { this.wasBroken = this.broken; this.flyT = this.broken ? 0 : 9; }
    if (this.broken) {
      this.flyT += dt;
      const k = clamp(this.flyT / 0.45, 0, 1);
      this.doorPivot.scale.setScalar(this.tip === 0 ? 1 : 0.001);   // skinned: a bone can't hide, it shrinks
      this.doorPivot.position.set(-0.4 + 0.1 * k, Math.sin(k * Math.PI) * 0.7 + 0.03 * k, LOO.W / 2 + 0.01 + 1.35 * k);
      this.doorPivot.rotation.set(-Math.PI / 2 * k, -0.3 * k, 0);
    } else {
      this.shownDoor += (this.door - this.shownDoor) * Math.min(1, dt * 18);
      this.doorPivot.scale.setScalar(1);
      this.doorPivot.position.set(-0.4, 0, LOO.W / 2 + 0.01);
      const rattle = this.occupied && this.bolted && this.joltT < 0.35 ? Math.sin(this.joltT * 50) * 0.05 : 0;
      this.doorPivot.rotation.set(0, -this.shownDoor - rattle, 0);
    }
    this.bolt.position.x = this.bolted ? 0.86 : 0.64;
  }
}

/** Seconds until Bob's first / next break. */
export const looFirst = () => rand(LOO.first);
export const looEvery = () => rand(LOO.every);
