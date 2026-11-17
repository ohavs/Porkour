import * as THREE from 'three';
import { RAPIER, world, groups, L, owners } from '../core/physics';
import { Synced } from '../core/synced';
import { G } from '../game/ctx';
import { toonMat } from '../render/toon';
import { rigidSkin } from '../render/batch';
import type { Rect } from './terrain';
import type { Pig } from '../pig/pig';

/** Tuning. */
export const GATE = {
  height: 1.1, mass: 30, latchR: 1.35,
  /** Bob opens a gate when he's about to walk through it, keeps it open while he's this close, then shuts it behind him. */
  bobAhead: 0.9, bobKeep: 2.3, bobDoor: 1.0,
  padHp: 2, repair: 6, lockTime: 1.4, closeTime: 1.0,
  /** Pen animals: how often a wander pick heads for an open gate. */
  leave: 0.45,
};

export type GateState = 'shut' | 'locked' | 'free' | 'broken';
const STATES: GateState[] = ['shut', 'locked', 'free', 'broken'];

export interface GateDef {
  id: string;
  /** The two ends of the gap (ground level); the hinge is at `a`. */
  a: THREE.Vector3; b: THREE.Vector3;
  /** Outward normal (away from the pen) and the pen itself. */
  out: THREE.Vector3; rect: Rect;
  /** Bob never padlocks it (the pigs' own sty). */
  lockable: boolean;
  start: GateState;
}

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
const UP = THREE.Object3D.DEFAULT_UP;
const inRect = (r: Rect, p: { x: number; z: number }) => p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1;

/**
 * A pen gate (sty, chickens, pasture, garden, sheep): a real hinged leaf (dynamic body on a revolute joint).
 * shut = latched (RMB / LMB at the latch opens it) · locked = Bob's padlock (lock-pick puzzle, 2 weapon whacks, or
 * ram it) · free = swings when pushed (pen animals amble out when it's open) · broken = rammed off its hinges, lies
 * where it fell until Bob comes with his hammer. Bob opens gates he walks through and shuts them behind him
 * (padlocked when he's wary); an open or smashed gate he sees is evidence: he comes to close / repair it.
 */
export class Gate {
  kind = 'gate' as const;
  heldBy = null;
  mass = GATE.mass; radius: number;
  state: GateState = 'shut';
  body: RAPIER.RigidBody;
  synced: Synced;
  root = new THREE.Group();
  /** Joint angle (rad, + swings the free end toward `swingDir`). */
  angle = 0;
  padHp = GATE.padHp;
  /** Bob is walking through (it's held open for him); after that it swings shut and ends `after`. */
  bobPass = false; closing = false; after: GateState = 'shut';
  /** Where the latch is (closed), the middle of the gap, a point outside / just inside the pen. */
  latch: THREE.Vector3; center: THREE.Vector3; outside: THREE.Vector3; doorIn: THREE.Vector3;
  /** The free end moves toward this side at a positive angle. */
  swingDir: THREE.Vector3;
  width: number;
  private hinge: RAPIER.RigidBody;
  private joint: RAPIER.RevoluteImpulseJoint | null = null;
  private q0: THREE.Quaternion; private rest: THREE.Vector3;
  private padlock: THREE.Object3D;
  private mode = '';
  private rattleT = 0;

  constructor(scene: THREE.Scene, public def: GateDef, posts: THREE.Group) {
    const dir = v1.copy(def.b).sub(def.a).setY(0);
    const gap = dir.length(); dir.normalize();
    const w = (this.width = gap - 0.24);
    this.radius = w / 2;
    const yaw = Math.atan2(-dir.z, dir.x);
    this.q0 = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    this.swingDir = new THREE.Vector3(dir.z, 0, -dir.x);
    const gy = (def.a.y + def.b.y) / 2, H = GATE.height;
    const hingeAt = new THREE.Vector3().copy(def.a).addScaledVector(dir, 0.12).setY(gy + 0.12 + H / 2);
    this.rest = hingeAt.clone().addScaledVector(dir, w / 2);
    this.center = def.a.clone().lerp(def.b, 0.5).setY(gy);
    this.latch = hingeAt.clone().addScaledVector(dir, w).setY(gy + 0.8);
    this.outside = this.center.clone().addScaledVector(def.out, 4.5);
    this.doorIn = this.center.clone().addScaledVector(def.out, -1.3);

    // ---- look: cartoon planks, a diagonal brace, a red latch; Bob's brass padlock
    const wood = toonMat(0xb9814a), dark = toonMat(0x8a5a30), red = toonMat(0xd9442b);
    const box = (sx: number, sy: number, sz: number, m: THREE.Material, x: number, y: number, z = 0, rz = 0, parent: THREE.Object3D = this.root) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
      o.position.set(x, y, z); o.rotation.z = rz; o.castShadow = true; parent.add(o); return o;
    };
    const hw = w / 2, hh = H / 2;
    box(0.11, H, 0.1, dark, -hw + 0.055, 0); box(0.11, H, 0.1, dark, hw - 0.055, 0);
    for (const y of [-hh + 0.16, -0.05, hh - 0.14]) box(w - 0.06, 0.13, 0.07, wood, 0, y);
    const bl = Math.hypot(w - 0.25, H - 0.4);
    box(bl, 0.11, 0.06, wood, 0, 0, 0.04, Math.atan2(H - 0.4, w - 0.25));
    box(0.2, 0.08, 0.13, red, hw - 0.02, 0.27);
    this.padlock = new THREE.Group(); this.padlock.position.set(hw + 0.07, 0.12, 0);
    box(0.13, 0.15, 0.08, toonMat(0xf2c14e, { emissive: 0x3a2a00 }), 0, 0, 0, 0, this.padlock);
    const sh = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.014, 6, 12, Math.PI), toonMat(0xc4c9d1));
    sh.position.y = 0.075; this.padlock.add(sh);
    this.root.add(this.padlock);
    rigidSkin(this.root, new Set([this.padlock]));
    scene.add(this.root);
    // posts at both ends of the gap (all gates' posts become one draw call: Gates)
    const postM = toonMat(0x7a4e2a), postG = new THREE.CylinderGeometry(0.1, 0.12, H + 0.45, 8), capG = new THREE.SphereGeometry(0.12, 8, 6);
    for (const e of [def.a, def.b]) {
      const p = new THREE.Mesh(postG, postM); p.position.set(e.x, e.y + (H + 0.45) / 2 - 0.05, e.z); p.castShadow = true; posts.add(p);
      const cap = new THREE.Mesh(capG, postM); cap.position.set(e.x, e.y + H + 0.42, e.z); cap.castShadow = true; posts.add(cap);
    }

    // ---- physics: a fixed hinge + the leaf on a revolute joint (Bob's capsule passes through it: he opens it anyway)
    this.hinge = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(hingeAt.x, hingeAt.y, hingeAt.z)
      .setRotation({ x: this.q0.x, y: this.q0.y, z: this.q0.z, w: this.q0.w }));
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(this.rest.x, this.rest.y, this.rest.z)
      .setRotation({ x: this.q0.x, y: this.q0.y, z: this.q0.z, w: this.q0.w }).setLinearDamping(0.4).setAngularDamping(1.6));
    const c = world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, H / 2, 0.06).setMass(GATE.mass).setFriction(0.5)
      .setCollisionGroups(groups(L.PROP, 0xffff & ~L.FARMER)), this.body);
    owners.set(c.handle, this);
    this.synced = new Synced(this.body, this.root);
    this.attach();
    this.setState(def.start);
  }

  private attach() {
    if (this.joint) return;
    const w = this.width;
    this.joint = world.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: -w / 2, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }),
      this.hinge, this.body, true) as RAPIER.RevoluteImpulseJoint;
    this.joint.setContactsEnabled(false);
    this.mode = '';
  }

  /** Pen animals try it: open, or only unlatched (they push it). */
  get unlatched() { return this.state === 'broken' || this.bobPass || this.state === 'free'; }
  /** Something Bob wants to deal with: left open, or smashed. */
  get needsBob() { return this.state === 'broken' || (this.state === 'free' && !this.bobPass && !this.closing && Math.abs(this.angle) > 0.3); }
  get label() { return 'gate.' + this.def.id; }
  /** Where an arrow / the HUD points at it. */
  get markPos() { return v2.copy(this.center).setY(this.center.y + 1.2); }
  /** Which side of the gate a point is on (+1 = the swing side). */
  side(p: { x: number; z: number }) { return Math.sign((p.x - this.center.x) * this.swingDir.x + (p.z - this.center.z) * this.swingDir.z) || 1; }

  setState(s: GateState) {
    if (s === 'locked' && !this.def.lockable) s = 'shut';
    if (this.state === 'broken' && s !== 'broken') this.rehang();
    this.state = s;
    if (s === 'locked') this.padHp = GATE.padHp;
    if (s !== 'free') { this.closing = false; }
    this.show();
    this.config();
  }
  show() { this.padlock.visible = this.state === 'locked' && !this.bobPass; }

  /** Back on its hinges, closed (Bob's repair / a new round). */
  private rehang() {
    this.body.setTranslation(this.rest, true);
    this.body.setRotation({ x: this.q0.x, y: this.q0.y, z: this.q0.z, w: this.q0.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    if (G.net !== 'client') this.attach();
    this.synced.capture(); this.synced.capture();
  }

  // ---------------------------------------------------------------- what pigs do (host)
  /** Close enough to the latch (from either side). */
  atLatch(p: Pig, slack = 0) {
    if (p.out || p.cage || p.heldBy || p.mode !== 'normal') return false;
    return Math.hypot(p.pos.x - this.latch.x, p.pos.z - this.latch.z) < GATE.latchR + slack && Math.abs(p.pos.y - this.latch.y) < 1.6;
  }
  /** Lock-pick puzzle settings: a padlock is easier than the cage; standing = steadier hooves. */
  pickOpts(p: Pig) { return { pins: 4, zone: 0.17 * (p.standing ? 1.4 : 1), speed: 1.3 }; }

  /** Lift the latch: the leaf swings away from the pig. */
  unlatch(p: Pig | null) {
    if (this.state !== 'shut') return;
    this.setState('free');
    const s = p ? -this.side(p.pos) : 1;
    this.body.setAngvel({ x: 0, y: 2.2 * s, z: 0 }, true);
    G.audio.play('unlock', { pos: this.latch, vol: 0.7, pitch: 1.25 });
    G.audio.play('creak', { pos: this.latch, vol: 0.6, pitch: 1.1 });
    G.noise(this.latch, 6);
    if (p) G.events.push({ type: 'gateOpened', who: p, text: this.label });
  }
  /** Lock picked / padlock smashed: the padlock drops, the gate is free. */
  unlock(p: Pig | null, how: 'pick' | 'whack') {
    if (this.state !== 'locked') return;
    G.fx.bits(this.latch, { count: 12, color: 0xf2c14e, speed: 2.5, up: 2, grav: 10, life: 0.6, size: 0.07, grow: 0, alpha: 1 });
    this.setState('free');
    if (p) this.body.setAngvel({ x: 0, y: 1.6 * -this.side(p.pos), z: 0 }, true);
    G.audio.play('unlock', { pos: this.latch, vol: 1, pitch: how === 'pick' ? 1 : 0.8 });
    G.audio.play('creak', { pos: this.latch, vol: 0.7 });
    G.noise(this.latch, how === 'pick' ? 6 : 16);
    G.events.push({ type: how === 'pick' ? 'gatePicked' : 'padlockBroke', who: p ?? undefined, text: this.label });
  }
  /** A weapon on the padlock: CLANG. */
  whack(p: Pig) {
    if (this.state !== 'locked') return;
    this.padHp--;
    G.audio.play('metal', { pos: this.latch, vol: 1, pitch: 0.75 + this.padHp * 0.15 });
    G.fx.bits(this.latch, { count: 8, color: 0xfff1a8, speed: 3.5, up: 2, grav: 8, life: 0.35, size: 0.05, grow: 0, alpha: 1 });
    G.shakeFor(p, 0.15);
    G.noise(this.latch, 16);
    if (this.padHp <= 0) this.unlock(p, 'whack');
  }
  /** Rammed off its hinges. */
  smash(dir: THREE.Vector3, by: Pig | null) {
    if (this.state === 'broken') return;
    if (this.joint) { world.removeImpulseJoint(this.joint, true); this.joint = null; }
    this.state = 'broken'; this.bobPass = false; this.closing = false;
    this.show();
    const d = v1.copy(dir).setY(0).normalize();
    this.body.setLinvel({ x: d.x * 6, y: 3.5, z: d.z * 6 }, true);
    this.body.setAngvel({ x: (Math.random() - 0.5) * 5, y: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 5 }, true);
    G.audio.play('wood', { pos: this.center, vol: 1, pitch: 0.7 });
    G.audio.play('thud|body', { pos: this.center, vol: 1 });
    G.fx.bits(v2.copy(this.center).setY(this.center.y + 0.6), { count: 20, color: 0xb9814a, spread: 0.6, speed: 4.5, up: 3.5, grav: 12, life: 0.9, size: 0.13, grow: 0, alpha: 1 });
    G.fx.puff(this.center, { count: 8, color: 0xd8c29a, speed: 1.6, up: 0.6, life: 0.9, size: 0.9, alpha: 0.6 });
    G.fx.shake(0.25);
    G.noise(this.center, 26);
    G.events.push({ type: 'gateBroken', who: by ?? undefined, text: this.label });
  }
  /** Ram target (pig.ts calls `knock` on what it runs into): a closed gate breaks, a free one bangs open. */
  knock(impulse: THREE.Vector3) {
    if (G.net === 'client') return;
    const by = (G.pigs as Pig[]).reduce<Pig | null>((b, p) => (p.sprinting || p.vel.length() > 5) && p.pos.distanceTo(this.center) < (b ? b.pos.distanceTo(this.center) : 3.5) ? p : b, null);
    if (this.state === 'shut' || this.state === 'locked') { this.smash(impulse, by); return; }
    if (this.state === 'free' && by) this.body.setAngvel({ x: 0, y: 5 * -this.side(by.pos), z: 0 }, true);
    else this.body.applyImpulse({ x: impulse.x * 8, y: impulse.y * 4, z: impulse.z * 8 }, true);
  }

  // ---------------------------------------------------------------- Bob
  /** Bob latches (or padlocks) it: it swings shut first. */
  closeBy(final: GateState) {
    if (this.state === 'broken') return;
    this.after = final === 'locked' && !this.def.lockable ? 'shut' : final;
    if (Math.abs(this.angle) < 0.05) { this.finishClose(); return; }
    this.state = 'free'; this.closing = true;
    this.show();
  }
  private finishClose() {
    this.closing = false;
    this.setState(this.after);
    G.audio.play('unlock', { pos: this.latch, vol: 0.6, pitch: this.state === 'locked' ? 0.7 : 1.4 });
    if (this.state === 'locked') G.audio.play('metal', { pos: this.latch, vol: 0.5, pitch: 1.6 });
  }
  /** Bob's hammer: back on its hinges (padlocked when he's wary). */
  repair(final: GateState) {
    if (this.state !== 'broken') return;
    this.setState(final);
    G.audio.play('wood', { pos: this.center, vol: 0.9, pitch: 1.2 });
    G.fx.puff(this.center, { count: 6, color: 0xd8c29a, speed: 1, up: 0.5, life: 0.7, size: 0.6, alpha: 0.5 });
  }

  // ---------------------------------------------------------------- fixed step (host)
  step(dt: number) {
    q1.set(this.q0.x, this.q0.y, this.q0.z, this.q0.w).invert();
    const r = this.body.rotation();
    const rel = q2.set(r.x, r.y, r.z, r.w).premultiply(q1);
    this.angle = this.state === 'broken' ? 0 : 2 * Math.atan2(rel.y, rel.w);
    if (this.angle > Math.PI) this.angle -= Math.PI * 2; else if (this.angle < -Math.PI) this.angle += Math.PI * 2;
    this.rattleT -= dt;
    if (this.state === 'broken') return;
    // Bob walking through: open it ahead of him, keep it open, then shut it behind him
    const f = G.farmer;
    if (f && !f.asleep && f.state !== 'down' && f.body.isEnabled()) {
      const d = this.segDist(f.pos.x, f.pos.z);
      const ahead = this.crosses(f.pos.x, f.pos.z, f.pos.x + f.vel.x * GATE.bobAhead, f.pos.z + f.vel.z * GATE.bobAhead);
      if (!this.bobPass && (ahead || d < GATE.bobDoor) && Math.hypot(f.vel.x, f.vel.z) > 0.3) {
        this.bobPass = true; this.closing = false;
        this.after = this.state === 'locked' || (f.level >= 1 && this.def.lockable) ? 'locked' : 'shut';
        this.state = 'free';
        this.passSide = this.side(f.pos);
        G.audio.play('unlock', { pos: this.latch, vol: 0.5, pitch: 1.1 });
        G.audio.play('creak', { pos: this.latch, vol: 0.55, pitch: 0.95 });
        this.show();
      } else if (this.bobPass && d > GATE.bobKeep) { this.bobPass = false; this.closing = true; this.show(); }
    } else if (this.bobPass) { this.bobPass = false; this.closing = true; this.show(); }
    if (this.closing && Math.abs(this.angle) < 0.05) this.finishClose();
    this.config();
    // pigs at the latch
    for (const p of G.pigs as Pig[]) {
      if (this.state !== 'shut' && this.state !== 'locked') break;
      if (!this.atLatch(p, 0.8)) continue;   // the lock-pick result may come in after a little drift
      const inp = p.input;
      if (this.state === 'locked' && inp.pickP) { this.unlock(p, 'pick'); break; }
      if (this.state === 'locked' && inp.pickFailP) { G.audio.play('metal', { pos: this.latch, vol: 0.9, pitch: 1.5 }); G.noise(this.latch, 12); }
      if (!this.atLatch(p)) continue;
      if (this.state === 'shut' && ((inp.grabP && !p.held) || inp.attackP)) { this.unlatch(p); break; }
      if (this.state === 'locked') {
        const wpn = (p.held as { def?: { weapon?: number } } | null)?.def?.weapon ?? 0;
        if (inp.attackP && wpn) { this.whack(p); break; }
        if (inp.attackP && this.rattleT <= 0) { this.rattleT = 0.6; G.audio.play('metal', { pos: this.latch, vol: 0.45, pitch: 1.3 }); G.events.push({ type: 'gateRattle', who: p }); }
      }
    }
  }
  private passSide = 1;
  /** Joint limits / motor for what the gate is doing (only when that changes). */
  config() {
    const j = this.joint; if (!j || G.net === 'client') return;
    const m = this.bobPass ? 'bob' + this.passSide : this.closing ? 'close' : this.state;
    if (m === this.mode) return;
    this.mode = m;
    if (m === 'shut' || m === 'locked') { j.setLimits(-0.004, 0.004); j.configureMotorPosition(0, 40, 10); }
    else if (m === 'free') { j.setLimits(-1.85, 1.85); j.configureMotorVelocity(0, 0.6); }
    else if (m === 'close') { j.setLimits(-1.85, 1.85); j.configureMotorPosition(0, 14, 6); }
    else { j.setLimits(-1.85, 1.85); j.configureMotorPosition(-this.passSide * 1.65, 30, 9); }
    this.body.wakeUp();
  }
  /** Horizontal distance from the gap (segment a→b). */
  segDist(x: number, z: number) {
    const a = this.def.a, b = this.def.b, dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
  }
  /** Does the move (x0,z0)→(x1,z1) go through the gap? */
  private crosses(x0: number, z0: number, x1: number, z1: number) {
    const a = this.def.a, b = this.def.b;
    const s0 = this.side({ x: x0, z: z0 }), s1 = this.side({ x: x1, z: z1 });
    if (s0 === s1) return false;
    // where the move crosses the gate line: within the gap (+ a little)
    const n = this.swingDir, d0 = (x0 - this.center.x) * n.x + (z0 - this.center.z) * n.z, d1 = (x1 - this.center.x) * n.x + (z1 - this.center.z) * n.z;
    const t = d0 / (d0 - d1), cx = x0 + (x1 - x0) * t, cz = z0 + (z1 - z0) * t;
    const half = a.distanceTo(b) / 2 + 0.3;
    return Math.hypot(cx - this.center.x, cz - this.center.z) < half;
  }

  /**
   * Pen animals' wander (host): out through an open gate (doorstep first, then outside); once out they graze
   * outside until the round ends. Returns seconds to the next think, or 0 = not handled (normal wander at home).
   */
  wander(p: { x: number; z: number }, out: THREE.Vector3, rnd: () => number, leaving: { on: boolean }) {
    if (!inRect(this.def.rect, p)) {
      out.set(this.outside.x + (rnd() - 0.5) * 7 + this.def.out.x * rnd() * 4, 0, this.outside.z + (rnd() - 0.5) * 7 + this.def.out.z * rnd() * 4);
      leaving.on = false;
      return 3 + rnd() * 4;
    }
    if (!this.unlatched) { leaving.on = false; return 0; }
    if (!leaving.on && rnd() > GATE.leave) return 0;
    leaving.on = true;
    if (Math.hypot(p.x - this.doorIn.x, p.z - this.doorIn.z) > 1.1) { out.set(this.doorIn.x, 0, this.doorIn.z); return 1.2; }
    out.set(this.outside.x, 0, this.outside.z); return 2.5;
  }

  /** New round: closed the way it started. */
  reset() {
    this.bobPass = false; this.closing = false;
    if (this.state === 'broken') this.rehang();
    else { this.body.setTranslation(this.rest, true); this.body.setRotation({ x: this.q0.x, y: this.q0.y, z: this.q0.z, w: this.q0.w }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true); }
    this.state = this.def.start; this.padHp = GATE.padHp; this.mode = '';
    this.config(); this.show();
    this.synced.capture(); this.synced.capture();
  }

  // ---------------------------------------------------------------- network
  netState(n: number[]) { n.push(STATES.indexOf(this.state), this.padHp, this.bobPass ? 1 : 0, Math.round(this.angle * 100) / 100); }
  netApply(n: number[]) {
    if (!n.length) return;
    this.state = STATES[n[0]] ?? 'shut'; this.padHp = n[1]; this.bobPass = n[2] === 1; this.angle = n[3];
    this.show();
  }
}

/** All the gates on the farm (`G.gates`). */
export class Gates {
  list: Gate[];
  constructor(scene: THREE.Scene, defs: GateDef[]) {
    const posts = new THREE.Group(); scene.add(posts);
    this.list = defs.map((d) => new Gate(scene, d, posts));
    rigidSkin(posts);
    G.gates = this;
  }
  step(dt: number) { for (const g of this.list) g.step(dt); }
  render(alpha: number) { for (const g of this.list) g.synced.apply(alpha); }
  capture() { for (const g of this.list) g.synced.capture(); }
  reset() { for (const g of this.list) g.reset(); }
  byId(id: string) { return this.list.find((g) => g.def.id === id) ?? null; }
  /** The closed gate whose latch this pig is at (HUD, RMB = no grab there). */
  latchOf(p: Pig, slack = 0) { return this.list.find((g) => (g.state === 'shut' || g.state === 'locked') && !g.bobPass && g.atLatch(p, slack)) ?? null; }
  nearest(p: THREE.Vector3) {
    let best: Gate | null = null, bd = Infinity;
    for (const g of this.list) { const d = g.center.distanceTo(p); if (d < bd) { bd = d; best = g; } }
    return best;
  }
  /** Admin. */
  all(s: GateState) {
    for (const g of this.list) {
      g.bobPass = false; g.closing = false;
      if (g.state === 'broken') g.repair(s); else g.setState(s);
      if (s === 'free') g.body.setAngvel({ x: 0, y: 3, z: 0 }, true);
    }
  }
}

