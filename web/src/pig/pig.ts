import * as THREE from 'three';
import { RAPIER, world, groups, L, owners, raycast, ignorePair, HOOKS } from '../core/physics';
import { Synced } from '../core/synced';
import { clamp, dampAngle, wrapAngle } from '../core/util';
import { G, type Holdable, type Carrier } from '../game/ctx';
import type { Cage } from '../world/cage';
import { PigVisual } from './pigVisual';

/** What a player (local or remote) sends to their pig each physics step. World-space move, camera aim. */
export interface PigInput {
  mx: number; mz: number; yaw: number; pitch: number;
  jump: boolean; sprint: boolean; fart: boolean; stand: boolean; wallow: boolean; grab: boolean;
  jumpP: boolean; sprintP: boolean; fartP: boolean; standP: boolean; wallowP: boolean; grabP: boolean; grabR: boolean; oinkP: boolean;
}
export const emptyInput = (): PigInput => ({
  mx: 0, mz: 0, yaw: 0, pitch: 0, jump: false, sprint: false, fart: false, stand: false, wallow: false, grab: false,
  jumpP: false, sprintP: false, fartP: false, standP: false, wallowP: false, grabP: false, grabR: false, oinkP: false,
});

/** Tuning (all pigs are equal). */
export const PIG = {
  mass: 30, walk: 4.8, standWalk: 3.1, sprint: 10.5, accel: 40, airAccel: 10, airBrake: 14,
  jump: 7.6, standJump: 6.4, fartUp: 9.8, fartFwd: 6, fartCd: 6, sprintCd: 5, sprintDur: 1.6,
  wallowDur: 1.1, mudTime: 60, hitSpeed: 9.5, landSpeed: 13, ragMin: 1.0, ragMax: 4,
  liftMax: 26, dragMax: 90, throwMin: 5, throwMax: 16, grabRange: 1.7,
};

type Mode = 'normal' | 'ragdoll' | 'wallow' | 'held';
type Shape = 'four' | 'two' | 'rag';
const QX90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

export class Pig implements Holdable {
  kind = 'pig' as const;
  body: RAPIER.RigidBody;
  collider!: RAPIER.Collider;
  shape: Shape = 'four';
  mass = PIG.mass; radius = 0.5;
  heldBy: Carrier | null = null;
  /** Locked in Bob's cage (grill timer running). */
  cage: Cage | null = null; grillAt = 0;
  /** Grilled: out of the game until outUntil, then back in the sty. */
  out = false; outUntil = 0; burntUntil = 0;
  held: Holdable | null = null;
  input = emptyInput();
  yaw = 0;
  standing = false;
  mode: Mode = 'normal';
  grounded = false; groundNormal = new THREE.Vector3(0, 1, 0);
  private coyote = 0; private jumpBuf = 0; private ownJump = false;
  sprintUntil = 0; sprintReady = 0; fartReady = 0; wallowUntil = 0; muddyUntil = 0;
  private ragSince = 0; private still = 0; escape = 0;
  chargeStart = -1;
  private rammed = new Set<unknown>();
  private setVel = new THREE.Vector3();
  private stepT = 0;
  visual: PigVisual;
  synced: Synced;
  label: string;
  spawn: THREE.Vector3;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();

  constructor(scene: THREE.Scene, at: THREE.Vector3, public color: number, name: string) {
    this.label = name;
    this.spawn = at.clone();
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y + 0.6, at.z)
      .setCcdEnabled(true).setCanSleep(false).lockRotations());
    this.setShape('four');
    this.visual = new PigVisual(color);
    this.visual.centerHeight = 0.36;
    scene.add(this.visual.root);
    this.synced = new Synced(this.body);
    G.holdables.push(this);
  }

  get now() { return G.time; }
  escapeNeed() { return this.heldBy?.escapeNeed?.(this) ?? 5; }
  get sprinting() { return this.now < this.sprintUntil; }
  get muddy() { return clamp((this.muddyUntil - this.now) / 10, 0, 1); }
  get forward() { return v3.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  /** 0..1 how ready an ability is (HUD). */
  readiness(which: 'fart' | 'sprint') {
    const [ready, cd] = which === 'fart' ? [this.fartReady, PIG.fartCd] : [this.sprintReady, PIG.sprintCd];
    return clamp(1 - (ready - this.now) / cd, 0, 1);
  }

  private setShape(s: Shape) {
    if (this.collider) { owners.delete(this.collider.handle); world.removeCollider(this.collider, false); }
    let d: RAPIER.ColliderDesc;
    if (s === 'four') d = RAPIER.ColliderDesc.capsule(0.22, 0.36).setRotation(QX90);
    else if (s === 'two') d = RAPIER.ColliderDesc.capsule(0.38, 0.32);
    else d = RAPIER.ColliderDesc.cuboid(0.37, 0.36, 0.6);
    d.setMass(PIG.mass).setCollisionGroups(groups(L.PIG)).setActiveHooks(HOOKS)
      .setFriction(s === 'rag' ? 0.7 : 0).setRestitution(s === 'rag' ? 0.25 : 0)
      .setFrictionCombineRule(s === 'rag' ? RAPIER.CoefficientCombineRule.Average : RAPIER.CoefficientCombineRule.Min);
    this.collider = world.createCollider(d, this.body);
    owners.set(this.collider.handle, this);
    this.shape = s;
    if (this.visual) this.visual.centerHeight = s === 'two' ? 0.70 : s === 'rag' ? 0.5 : 0.36;
  }
  private bottom() { return this.shape === 'two' ? 0.70 : 0.36; }

  // ------------------------------------------------------------------ fixed step (before physics)
  preStep(dt: number) {
    this.stepT += dt;
    const inp = this.input;
    const p = this.body.translation(); this.pos.set(p.x, p.y, p.z);
    const lv = this.body.linvel(); this.vel.set(lv.x, lv.y, lv.z);
    this.synced.beforeStep();

    if (this.out) {
      if (this.now > this.outUntil) this.backFromGrill();
      return;
    }
    if (this.pos.y < -25) this.respawn();

    if (this.heldBy) {
      this.mode = 'held';
      this.escape = Math.max(0, this.escape - dt * 0.8);
      if (inp.fartP) this.tryFart();
      if (inp.jumpP && (this.escape += 1) >= this.escapeNeed()) {
        this.heldBy.release(false); this.escape = 0; this.vel.y = 6; this.body.setLinvel(this.vel, true);
      }
      return;
    }
    if (this.mode === 'held') this.mode = 'ragdoll', this.startRagdoll(null, false);

    // ground
    const hit = this.shape === 'rag' ? null : raycast(this.pos, DOWN, this.bottom() + 0.16, ~L.FARMER & 0xffff, this.body,
      (c) => !(this.held && c.parent() === this.held.body));
    this.grounded = !!hit && hit.normal.y > 0.55;
    if (hit) this.groundNormal.copy(hit.normal);

    if (this.mode === 'ragdoll') { this.ragdollStep(dt); return; }

    // timers
    if (this.grounded) { this.coyote = 0.1; this.ownJump = false; } else this.coyote -= dt;
    this.jumpBuf = inp.jumpP ? 0.14 : this.jumpBuf - dt;
    if (!this.sprinting) this.rammed.clear();

    // --- abilities
    if (inp.standP && this.mode === 'normal') this.toggleStand();
    if (inp.wallowP && this.mode === 'normal' && this.grounded) this.startWallow();
    if (inp.fartP) this.tryFart();
    if (inp.sprintP && this.now >= this.sprintReady && this.mode === 'normal') this.startSprint();
    if (inp.oinkP) this.oink();
    this.grabStep(inp);

    // --- wallow
    if (this.mode === 'wallow') {
      if (inp.wallow) this.wallowUntil = Math.max(this.wallowUntil, this.now + 0.15); // hold = play dead
      this.vel.x *= 0.8; this.vel.z *= 0.8;
      if (this.now > this.wallowUntil) this.mode = 'normal';
      this.finishStep();
      return;
    }

    // --- move
    let mx = inp.mx, mz = inp.mz;
    const moving = mx * mx + mz * mz > 0.01;
    if (this.sprinting && !moving) { mx = Math.sin(this.yaw); mz = Math.cos(this.yaw); }
    let speed = this.sprinting ? PIG.sprint : this.standing ? PIG.standWalk : PIG.walk;
    if (this.held) speed *= 1 - clamp(this.held.mass / (PIG.liftMax * 2.5), 0, 0.55);
    if (this.muddy > 0) speed *= 0.95;
    const tx = mx * speed, tz = mz * speed;
    let acc = this.grounded ? PIG.accel : PIG.airAccel;
    if (!this.grounded && !moving && this.ownJump) acc = PIG.airBrake;
    if (!this.grounded && !moving && !this.ownJump) acc = 1.5; // thrown / launched: keep momentum
    const dx = tx - this.vel.x, dz = tz - this.vel.z, dl = Math.hypot(dx, dz), maxD = acc * dt;
    if (dl > maxD) { this.vel.x += (dx / dl) * maxD; this.vel.z += (dz / dl) * maxD; } else { this.vel.x = tx; this.vel.z = tz; }

    // facing: camera direction while moving (strafe), movement direction while sprinting
    const want = this.sprinting ? Math.atan2(this.vel.x, this.vel.z) : inp.yaw;
    if (moving || this.held || this.chargeStart >= 0) this.yaw = dampAngle(this.yaw, want, this.sprinting ? 10 : 14, dt);

    // jump
    if (this.jumpBuf > 0 && this.coyote > 0) {
      this.vel.y = this.standing ? PIG.standJump : PIG.jump;
      this.jumpBuf = 0; this.coyote = 0; this.ownJump = true;
      G.audio.play('cloth', { pos: this.pos, vol: 0.35, pitch: 1.4 });
    }
    // short hop when jump released early
    if (this.ownJump && !inp.jump && this.vel.y > 2) this.vel.y -= 40 * dt;

    if (this.sprinting) this.ramStep();
    this.finishStep();
  }

  private finishStep() {
    this.body.setLinvel(this.vel, true);
    this.body.setRotation(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw), true);
    this.setVel.copy(this.vel);
    this.holdStep();
  }

  // ------------------------------------------------------------------ after physics: did something hit us?
  postStep(dt: number) {
    this.synced.capture();
    if (this.mode === 'ragdoll' || this.mode === 'held') return;
    const lv = this.body.linvel();
    const dvx = lv.x - this.setVel.x, dvz = lv.z - this.setVel.z;
    const dvy = lv.y - (this.setVel.y - 20 * dt);
    const side = Math.hypot(dvx, dvz);
    if (side > PIG.hitSpeed || dvy > PIG.landSpeed || dvy < -PIG.hitSpeed) {
      this.startRagdoll(v1.set(dvx, Math.max(dvy, 0), dvz), true);
      return;
    }
    // fast objects hitting us
    world.contactPairsWith(this.collider, (c) => {
      const o = owners.get(c.handle) as Holdable | undefined;
      if (!o || o === this.held || o.heldBy === this || this.mode !== 'normal') return;
      const ov = (o as any).synced?.preVel as THREE.Vector3 | undefined;
      if (!ov) return;
      const rel = v2.copy(ov).sub(this.vel).length();
      if (rel > 8 && o.mass >= 3 && ov.length() > 6) {
        G.audio.play('punch|punch2', { pos: this.pos, vol: 0.8 });
        this.startRagdoll(v1.copy(ov).multiplyScalar(0.5), true);
      }
    });
  }

  // ------------------------------------------------------------------ abilities
  private toggleStand() {
    this.standing = !this.standing;
    const p = this.body.translation();
    if (this.standing) this.body.setTranslation({ x: p.x, y: p.y + 0.36, z: p.z }, true);
    this.setShape(this.standing ? 'two' : 'four');
    G.audio.play('cloth', { pos: this.pos, vol: 0.5, pitch: this.standing ? 1.2 : 0.9 });
  }

  private startWallow() {
    this.mode = 'wallow';
    this.wallowUntil = this.now + PIG.wallowDur;
    if (this.held) this.release(false);
    if (this.standing) { this.standing = false; this.setShape('four'); }
    const mud = G.terrain.mudAt(this.pos.x, this.pos.z);
    if (mud > 0.3) {
      this.muddyUntil = this.now + PIG.mudTime;
      G.fx.bits(v1.copy(this.pos).setY(this.pos.y - 0.1), { count: 26, color: 0x5a3a1e, speed: 3, up: 3, grav: 14, life: 0.8, size: 0.16, grow: 0, drag: 0.5, alpha: 1 });
      G.audio.play('thud|thud2', { pos: this.pos, vol: 0.9, pitch: 0.7 });
    } else {
      G.fx.puff(v1.copy(this.pos).setY(this.pos.y - 0.3), { count: 8, color: 0xcbb48c, speed: 1.2, up: 0.5, life: 0.9, size: 0.7, alpha: 0.5 });
      G.audio.play('thud2', { pos: this.pos, vol: 0.5 });
    }
  }

  private tryFart() {
    if (this.now < this.fartReady || this.mode === 'wallow') return;
    this.fartReady = this.now + PIG.fartCd;
    if (this.heldBy?.fartedOn) {      // carried by Bob: stink in his face, wriggle a lot
      this.escape += 5;
      const b = v1.copy(this.pos);
      G.fx.puff(b, { count: 40, color: 0x9ccf4f, spread: 0.5, speed: 2.5, up: 0.3, life: 3, size: 1.8, grow: 2.2, drag: 2.2, alpha: 0.8 });
      G.clouds.push({ x: b.x, y: b.y, z: b.z, r: 3, until: this.now + 6 });
      G.audio.play('fart_short|fart_deep', { pos: this.pos, vol: 1, rand: 0.18, minGap: 0.1 });
      G.noise(this.pos, 22);
      this.heldBy.fartedOn(this);
      return;
    }
    if (this.heldBy) this.heldBy.release(false);
    const f = this.forward.clone();
    const butt = v1.copy(this.pos).addScaledVector(f, this.standing ? -0.2 : -0.5).setY(this.pos.y + (this.standing ? -0.3 : 0.05));
    // launch: up + toward where you push (or forward)
    const mvLen = Math.hypot(this.input.mx, this.input.mz);
    const dir = mvLen > 0.1 ? v2.set(this.input.mx / mvLen, 0, this.input.mz / mvLen) : v2.copy(f);
    this.vel.y = Math.max(this.vel.y, this.grounded ? PIG.fartUp : PIG.fartUp * 0.85);
    this.vel.x += dir.x * PIG.fartFwd; this.vel.z += dir.z * PIG.fartFwd;
    this.ownJump = false;
    if (this.mode === 'ragdoll') this.getUp();
    this.body.setLinvel(this.vel, true); this.setVel.copy(this.vel);
    // the cloud
    G.fx.puff(butt, { count: 46, color: 0x9ccf4f, spread: 0.45, speed: 3.2, up: -0.8, life: 3.2, size: 1.9, grow: 2.4, drag: 2.0, alpha: 0.8, dir: v3.copy(f).negate().setY(-0.5) });
    G.fx.puff(butt, { count: 14, color: 0xe2f58a, spread: 0.2, speed: 6, up: -1, life: 0.7, size: 0.9, grow: 3, drag: 4, alpha: 0.95 });
    G.clouds.push({ x: butt.x, y: butt.y, z: butt.z, r: 3, until: this.now + 6 });
    G.audio.play('fart_short|fart_deep', { pos: this.pos, vol: 1, rand: 0.18, minGap: 0.1 });
    if (this === G.localPig) G.fx.shake(0.3);
    G.noise(this.pos, 22);
    // blast pushes everything nearby
    for (const h of G.holdables) {
      if (h === this || h === this.held) continue;
      const hp = h.body.translation();
      const d = v3.set(hp.x - butt.x, hp.y - butt.y, hp.z - butt.z);
      const dist = d.length();
      if (dist > 3.5 || dist < 0.01) continue;
      const k = 1 - dist / 3.5;
      d.normalize().y += 0.5;
      const dv = Math.min(10, (k * 260) / Math.max(h.mass, 4));
      if (h.knock) h.knock(d.normalize().multiplyScalar(dv), dist < 1.8 && h.kind === 'pig');
      else h.body.applyImpulse(d.multiplyScalar(dv * h.mass), true);
    }
  }

  private startSprint() {
    this.sprintUntil = this.now + PIG.sprintDur;
    this.sprintReady = this.now + PIG.sprintCd;
    if (this.standing) { this.standing = false; this.setShape('four'); }
    G.fx.puff(v1.copy(this.pos).setY(this.pos.y - 0.3), { count: 10, color: 0xd8c29a, speed: 2, up: 0.8, life: 0.8, size: 0.8, alpha: 0.6 });
    G.audio.play('cloth', { pos: this.pos, vol: 0.6, pitch: 0.7 });
    G.noise(this.pos, 8);
  }

  /** Full-speed sprint = ram: knocks pigs / critters / props you run into. */
  private ramStep() {
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp < 7) return;
    world.contactPairsWith(this.collider, (c) => {
      const o = owners.get(c.handle) as Holdable | undefined;
      if (!o || o === this.held || this.rammed.has(o)) return;
      this.rammed.add(o);
      const dir = v1.set(this.vel.x / sp, 0.45, this.vel.z / sp).normalize();
      const dv = Math.min(12, 520 / Math.max(o.mass, 5));
      if (o.knock) o.knock(dir.multiplyScalar(dv), true);
      else o.body.applyImpulse(dir.multiplyScalar(dv * o.mass), true);
      this.vel.x *= -0.25; this.vel.z *= -0.25; this.vel.y = 3;
      this.sprintUntil = this.now;
      G.audio.play('punch', { pos: this.pos, vol: 1 });
      G.fx.bits(this.pos, { count: 12, color: 0xffe08a, speed: 4, up: 2, life: 0.5, size: 0.18, grow: 0, drag: 3, alpha: 1 });
      if (this === G.localPig) G.fx.shake(0.45);
      G.noise(this.pos, 14);
    });
  }

  private oink() {
    G.audio.play('pop', { pos: this.pos, vol: 0.7, pitch: 0.6 });
    G.noise(this.pos, 15);
  }

  // ------------------------------------------------------------------ ragdoll
  knock(impulse: THREE.Vector3, ragdoll: boolean) {
    if (this.heldBy?.kind === 'farmer' || this.out) return;   // only poise-breaking hits free a pig from Bob
    if (this.heldBy) this.heldBy.release(false);
    if (ragdoll && this.mode !== 'ragdoll') this.startRagdoll(null, true);
    const lv = this.body.linvel();
    this.body.setLinvel({ x: lv.x + impulse.x, y: lv.y + impulse.y, z: lv.z + impulse.z }, true);
    this.setVel.set(lv.x + impulse.x, lv.y + impulse.y, lv.z + impulse.z);
  }

  startRagdoll(hit: THREE.Vector3 | null, sound: boolean) {
    if (this.held) this.release(false);
    this.mode = 'ragdoll'; this.ragSince = this.now; this.still = 0;
    this.standing = false; this.sprintUntil = 0;
    this.setShape('rag');
    this.body.lockRotations(false, true);
    const r = () => (Math.random() * 2 - 1) * 6;
    const av = hit ? v2.set(hit.z, 0, -hit.x).multiplyScalar(0.7) : v2.set(r(), r(), r());
    this.body.setAngvel({ x: av.x + r() * 0.3, y: av.y + r() * 0.3, z: av.z + r() * 0.3 }, true);
    if (sound) G.audio.play('thud|thud2', { pos: this.pos, vol: 0.8 });
    if (this === G.localPig && hit) G.fx.shake(Math.min(0.6, hit.length() * 0.04));
  }

  private ragdollStep(dt: number) {
    const t = this.now - this.ragSince;
    if (this.input.jumpP) this.ragSince -= 0.18; // mash to get up faster
    const sp = this.vel.length();
    this.still = sp < 1.2 ? this.still + dt : 0;
    if ((t > PIG.ragMin && this.still > 0.35) || t > PIG.ragMax) this.getUp();
  }

  getUp() {
    const q = this.body.rotation();
    const fwd = v1.set(0, 0, 1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
    this.yaw = Math.atan2(fwd.x, fwd.z);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.lockRotations(true, true);
    this.body.setRotation(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw), true);
    const p = this.body.translation();
    this.body.setTranslation({ x: p.x, y: p.y + 0.25, z: p.z }, true);
    this.setShape('four');
    this.mode = 'normal';
    const lv = this.body.linvel();
    this.body.setLinvel({ x: lv.x * 0.3, y: 3.5, z: lv.z * 0.3 }, true);
    this.setVel.set(lv.x * 0.3, 3.5, lv.z * 0.3);
  }

  // ------------------------------------------------------------------ farmer: caught / caged / grilled
  caughtBy(by: Carrier) {
    if (this.held) this.release(false);         // Bob confiscates the loot
    if (this.heldBy) this.heldBy.release(false);
    this.heldBy = by; this.mode = 'held'; this.escape = 0;
    this.standing = false; this.sprintUntil = 0; this.chargeStart = -1;
  }
  enterCage(cage: Cage, grillAt: number) { this.cage = cage; this.grillAt = grillAt; }
  freed() { this.cage = null; this.grillAt = 0; }
  grilled() {
    this.cage = null; this.out = true; this.outUntil = this.now + 8;
    if (this.held) this.release(false);
    this.body.setEnabled(false);
    this.visual.root.visible = false;
  }
  private backFromGrill() {
    this.out = false; this.burntUntil = this.now + 20;
    this.body.setEnabled(true);
    this.visual.root.visible = true;
    this.respawn();
    if (this.mode !== 'normal') { this.mode = 'normal'; this.setShape('four'); this.body.lockRotations(true, true); }
  }

  respawn() {
    if (this.held) this.release(false);
    if (this.mode === 'ragdoll') this.getUp();
    this.body.setTranslation({ x: this.spawn.x, y: this.spawn.y + 1, z: this.spawn.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.setVel.set(0, 0, 0);
  }

  // ------------------------------------------------------------------ grab / carry / throw
  private grabStep(inp: PigInput) {
    if (inp.grabP) {
      if (this.held) this.chargeStart = this.now;
      else if (this.mode === 'normal') { const t = this.findGrabTarget(); if (t) this.grab(t); }
    }
    if (inp.grabR && this.held && this.chargeStart >= 0) {
      const c = this.charge();
      this.chargeStart = -1;
      this.throwHeld(c);
    }
  }
  charge() { return this.chargeStart < 0 ? 0 : clamp((this.now - this.chargeStart) / 0.9, 0, 1); }

  findGrabTarget(): Holdable | null {
    let best: Holdable | null = null, bestScore = Infinity;
    const f = this.forward;
    const reachY = this.standing ? 1.3 : 0.9;
    for (const h of G.holdables) {
      if (h === this || h.heldBy || h.mass > PIG.dragMax || (h as any).held === this) continue;
      const p = h.body.translation();
      const dx = p.x - this.pos.x, dz = p.z - this.pos.z, dy = p.y - this.pos.y;
      const d = Math.hypot(dx, dz) - h.radius;
      if (d > PIG.grabRange || dy > reachY || dy < -1) continue;
      const dot = (dx * f.x + dz * f.z) / Math.max(Math.hypot(dx, dz), 0.01);
      if (dot < 0.2) continue;
      const score = d - dot;
      if (score < bestScore) { bestScore = score; best = h; }
    }
    return best;
  }

  grab(h: Holdable) {
    this.held = h; h.heldBy = this;
    ignorePair(this.body, h.body, true);
    h.onGrabbed?.(this);
    if (h.kind === 'pig') (h as Pig).mode = 'held';
    G.audio.play('grab', { pos: this.pos, vol: 0.8 });
    G.noise(this.pos, 4);
  }

  release(thrown: boolean) {
    const h = this.held; if (!h) return;
    this.held = null; h.heldBy = null; this.chargeStart = -1;
    ignorePair(this.body, h.body, false);
    h.onReleased?.(this, thrown);
    if (h.kind === 'pig') (h as Pig).startRagdoll(null, false);
  }

  private throwHeld(c: number) {
    const h = this.held; if (!h) return;
    const heavy = h.mass > PIG.liftMax;
    const pitch = clamp(-this.input.pitch, -0.3, 0.7) + 0.32;
    const dir = v1.set(Math.sin(this.input.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(this.input.yaw) * Math.cos(pitch));
    const sp = (PIG.throwMin + (PIG.throwMax - PIG.throwMin) * c) * Math.sqrt(clamp(14 / Math.max(h.mass, 6), 0.2, 1.4)) * (heavy ? 0.35 : 1);
    this.release(true);
    h.body.setLinvel({ x: dir.x * sp + this.vel.x * 0.5, y: dir.y * sp + Math.max(this.vel.y, 0) * 0.5, z: dir.z * sp + this.vel.z * 0.5 }, true);
    h.body.setAngvel({ x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 }, true);
    G.audio.play('throw', { pos: this.pos, vol: 0.4 + c * 0.6, pitch: 1.2 - c * 0.4 });
    G.noise(this.pos, 6 + c * 8);
  }

  /** Spring the held thing to the snout (4 legs) or the front hooves (2 legs). Heavy things are dragged. */
  private holdStep() {
    const h = this.held; if (!h) return;
    const hp = h.body.translation();
    const heavy = h.mass > PIG.liftMax;
    const f = this.forward;
    const reach = this.radius + h.radius + (this.standing ? 0.05 : 0.1);
    const target = v1.copy(this.pos).addScaledVector(f, reach);
    if (h.kind === 'pig') target.copy(this.pos).addScaledVector(f, this.standing ? 0.45 : -0.05).setY(this.pos.y + (this.standing ? 0.55 : 0.8));
    else target.y = heavy ? hp.y : this.pos.y + (this.standing ? 0.2 : 0.12) + h.radius * 0.3;
    const d = v2.set(target.x - hp.x, target.y - hp.y, target.z - hp.z);
    if (d.length() > 2.6) { this.release(false); return; }
    const k = heavy ? 6 : 16;
    const v = d.multiplyScalar(k).add(v3.copy(this.vel).multiplyScalar(heavy ? 0.6 : 1));
    if (heavy) v.y = h.body.linvel().y;
    const max = 14; if (v.length() > max) v.setLength(max);
    h.body.setLinvel(v, true);
    if (h.kind !== 'pig') {
      const av = h.body.angvel();
      h.body.setAngvel({ x: av.x * 0.7, y: av.y * 0.7, z: av.z * 0.7 }, true);
    } else {
      h.body.setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw + Math.PI / 2, Math.PI / 2)), true);
    }
  }

  // ------------------------------------------------------------------ render
  private vq = new THREE.Quaternion(); private tq = new THREE.Quaternion();
  render(alpha: number, dt: number) {
    if (this.out) return;
    const r = this.visual.root;
    this.synced.pos(alpha, r.position);
    this.synced.rot(alpha, this.tq);
    this.vq.slerp(this.tq, 1 - Math.exp(-(this.mode === 'ragdoll' || this.mode === 'held' ? 30 : 18) * dt));
    r.quaternion.copy(this.vq);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.visual.update({
      speed: sp, grounded: this.grounded, vy: this.vel.y, standing: this.standing, mode: this.mode,
      sprinting: this.sprinting, muddy: this.muddy, holding: !!this.held, charging: this.charge(), dt, t: this.now,
      burnt: clamp((this.burntUntil - this.now) / 5, 0, 1),
    });
    // dust while sprinting, mud drips
    if (this.sprinting && this.grounded && Math.random() < dt * 30)
      G.fx.puff(v1.copy(r.position).setY(r.position.y - 0.35), { count: 1, color: 0xd6c29b, speed: 0.6, up: 0.5, life: 0.7, size: 0.6, alpha: 0.45 });
    if (this.muddy > 0 && Math.random() < dt * 4 * this.muddy)
      G.fx.bits(v1.copy(r.position), { count: 1, color: 0x4a2f18, spread: 0.3, speed: 0.2, up: -0.5, grav: 9, life: 0.6, size: 0.07, grow: 0, alpha: 1 });
    void wrapAngle;
  }
}
