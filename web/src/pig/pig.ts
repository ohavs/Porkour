import * as THREE from 'three';
import { RAPIER, world, groups, L, owners, raycast, ignorePair, HOOKS } from '../core/physics';
import { Synced } from '../core/synced';
import { clamp, dampAngle, wrapAngle } from '../core/util';
import { G, ADMIN, type Holdable, type Carrier } from '../game/ctx';
import type { Cage } from '../world/cage';
import { PigVisual } from './pigVisual';
import type { Outfit } from './cosmetics';
import { carrierCode, carrierFrom, holdableIndex, holdableFrom } from '../net/refs';
import { PigParts, CENTER, SCRUFF, type Shape } from './pigBody';
import { Grip } from '../core/grip';
import type { Tone } from '../core/ragdoll';
import { PIVOT, STAND_POS, STAND_ANGLE } from './pigModel';

/** What a player (local or remote) sends to their pig each physics step. World-space move, camera aim. */
export interface PigInput {
  mx: number; mz: number; yaw: number; pitch: number;
  jump: boolean; sprint: boolean; fart: boolean; stand: boolean; wallow: boolean; grab: boolean; attack: boolean;
  jumpP: boolean; sprintP: boolean; fartP: boolean; standP: boolean; wallowP: boolean; grabP: boolean; grabR: boolean; oinkP: boolean;
  /** LMB pressed / released; the lock-pick puzzle was solved / a pin slipped (the puzzle runs on the player's screen). */
  attackP: boolean; attackR: boolean; pickP: boolean; pickFailP: boolean;
}
export const emptyInput = (): PigInput => ({
  mx: 0, mz: 0, yaw: 0, pitch: 0, jump: false, sprint: false, fart: false, stand: false, wallow: false, grab: false, attack: false,
  jumpP: false, sprintP: false, fartP: false, standP: false, wallowP: false, grabP: false, grabR: false, oinkP: false,
  attackP: false, attackR: false, pickP: false, pickFailP: false,
});

/** Where a player's own copy of their pig is (sent with the controls, host follows it). */
export interface RemotePose { x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number; at: number }

/** Tuning (all pigs are equal). */
export const PIG = {
  mass: 30, walk: 4.8, standWalk: 3.5, sprint: 10.5, accel: 40, airAccel: 10, airBrake: 14,
  jump: 7.6, standJump: 7.0, fartUp: 9.8, fartFwd: 6, fartCd: 6, sprintCd: 5, sprintDur: 1.6,
  wallowDur: 1.1, mudTime: 60, hitSpeed: 9.5, landSpeed: 13, ragMin: 1.0, ragMax: 4,
  liftMax: 26, dragMax: 90, throwMin: 5, throwMax: 16, grabRange: 1.7,
  // standing on two legs: strong hooves (punch, lift, throw, latch) but wobbly
  liftMaxStand: 50, throwStand: 1.35, punchCd: 0.45, punchRange: 1.15, punchPoise: 34, wobbleFall: 1,
  /** LMB shorter than this = a hit, longer = wind up a throw. Headbutt (four legs) = this share of a punch on Bob. */
  clickTime: 0.22, headbutt: 0.6,
  // grip (real physics): lift force = liftMax × g × gripLift, drag force = dragMax × g × gripDrag; throw swing time
  gripLift: 1.2, gripDrag: 0.6, swing: 0.14,
};

/**
 * Standing balance (inverted pendulum). fall0 = gravity tipping it over, kp = the pig righting itself (saturates at
 * `sat` rad: past that, gravity slowly wins), kd = damping (low = sways back and forth), accel = lean per m/s² of
 * speed change, turn = lean out of turns, noise = random teeter, stumble / fall = radians, stagger = m/s of forced
 * steps per radian past `stumble`.
 */
export const BAL = { fall0: 10, kp: 22, sat: 0.27, kd: 2.6, accel: 0.13, turn: 0.11, noise: 0.7, stumble: 0.3, fall: 0.62, stagger: 22 };

/** Grip targets in model space (pig's feet = origin, facing +z): hold, wind-up (full charge), release. */
const GRIP = {
  four: { hold: new THREE.Vector3(0, 0.6, 0.86), wind: new THREE.Vector3(0, 1.05, 0.42), rel: new THREE.Vector3(0, 0.95, 1.2) },
  two: { hold: new THREE.Vector3(0, 0.95, 0.5), wind: new THREE.Vector3(0, 1.5, -0.1), rel: new THREE.Vector3(0, 1.3, 0.8) },
};
const QSTAND = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -STAND_ANGLE);

type Mode = 'normal' | 'ragdoll' | 'wallow' | 'held';
const MODES: Mode[] = ['normal', 'ragdoll', 'wallow', 'held'];
const SHAPES: Shape[] = ['four', 'two', 'rag'];
const QX90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
/** Poise damage of a held weapon (0 = not a weapon). */
const weaponOf = (h: Holdable) => (h as { def?: { weapon?: number } }).def?.weapon ?? 0;
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
  /** Standing balance: 0 steady … 1 falls over. */
  wobble = 0; private lastYaw = 0; turnRate = 0;
  /** Standing balance: top-of-body lean (world x / z, radians) and its speed. */
  leanX = 0; leanZ = 0; private leanVX = 0; private leanVZ = 0; private lastVx = 0; private lastVz = 0; private stumbleSnd = 0;
  private stumbleX = 0; private stumbleZ = 0; private bumpT = 0;
  private seed = Math.random();
  punchAt = -10; private punched = false;
  /** Grilled / taken by a wolf (HUD text). */
  outReason: 'grill' | 'wolf' = 'grill';
  /** Online: no player in this slot (the pig isn't in the game). */
  absent = false;
  /** Online: escape mashes needed (players get it from the host). */
  private netNeed = 0;
  private setVel = new THREE.Vector3();
  private stepT = 0;
  /** Next time pushing through a bush may rustle (game.ts). */
  rustleAt = 0;
  visual: PigVisual;
  synced: Synced;
  /** Head + legs as real bodies (active ragdoll) and the grip hand. */
  parts: PigParts;
  grip: Grip;
  /** Throw swing in progress (time since release, -1 = none) and its charge. */
  private swingT = -1; private swingC = 0; private strainT = 0;
  /** Just thrown: it may still overlap us for a moment (no collision, doesn't count as a hit). */
  private thrown: { h: Holdable; until: number } | null = null;
  /** Online, host: the player's own simulation of this pig (pose it reports); host control window (knocks, rams…). */
  remote: RemotePose | null = null; ctlUntil = 0;
  /** Online, player: this is my pig and I move it myself right away (client-side prediction). */
  predicting = false;
  private predFart = 0; private predSprint = 0; private predSprintUntil = 0; private predWallow = 0; private standDiff = 0;
  private predIgnore: Holdable | null = null;
  /** Player side: hand position (torso space) from the host. */
  private netHand = new THREE.Vector3(); private netHasHand = false;
  label: string;
  spawn: THREE.Vector3;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();

  constructor(scene: THREE.Scene, at: THREE.Vector3, public color: number, name: string, outfit?: Outfit) {
    this.label = name;
    this.spawn = at.clone();
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y + 0.6, at.z)
      .setCcdEnabled(true).setCanSleep(false).lockRotations());
    this.setShape('four');
    this.parts = new PigParts(this.body, v1.set(at.x, at.y + 0.6 - CENTER.four, at.z));
    this.grip = new Grip();
    this.visual = new PigVisual(color, outfit);
    this.visual.centerHeight = CENTER.four;
    scene.add(this.visual.root);
    this.synced = new Synced(this.body);
    G.holdables.push(this);
  }

  get now() { return G.time; }
  escapeNeed() { return G.net === 'client' ? this.netNeed : this.heldBy?.escapeNeed?.(this) ?? 5; }
  get sprinting() { return this.now < this.sprintUntil; }
  get muddy() { return clamp((this.muddyUntil - this.now) / 10, 0, 1); }
  get forward() { return v3.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  get liftMax() { return this.standing ? PIG.liftMaxStand : PIG.liftMax; }
  /** 0..1 jab progress (visual). */
  get punchT() { const k = (this.now - this.punchAt) / 0.28; return k >= 0 && k <= 1 ? k : 0; }
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
    else d = RAPIER.ColliderDesc.roundCuboid(0.25, 0.22, 0.42, 0.1).setTranslation(0, 0, -0.06);   // body only: head + legs are parts
    d.setMass(PIG.mass).setCollisionGroups(groups(L.PIG)).setActiveHooks(HOOKS)
      .setFriction(s === 'rag' ? 0.7 : 0).setRestitution(s === 'rag' ? 0.25 : 0)
      .setFrictionCombineRule(s === 'rag' ? RAPIER.CoefficientCombineRule.Average : RAPIER.CoefficientCombineRule.Min);
    this.collider = world.createCollider(d, this.body);
    owners.set(this.collider.handle, this);
    this.shape = s;
    this.parts?.setShape(s);
    if (this.visual) this.visual.centerHeight = CENTER[s];
  }
  private bottom() { return CENTER[this.shape === 'rag' ? 'four' : this.shape]; }

  /** How the body parts behave now (muscles on, or limp). */
  private toneNow(): Tone {
    if (this.heldBy) return this.heldBy.kind === 'farmer' ? 'carried' : 'dragged';
    return this.mode === 'ragdoll' ? 'ragdoll' : 'active';
  }

  // ------------------------------------------------------------------ fixed step (before physics)
  preStep(dt: number) {
    this.control(dt);
    if (!this.out) { this.parts.setTone(this.toneNow()); this.parts.step(this.now); }
  }
  private control(dt: number) {
    this.stepT += dt;
    if (this.thrown && this.now > this.thrown.until) { if (this.thrown.h !== this.held) ignorePair(this.body, this.thrown.h.body, false); this.thrown = null; }
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
      this.escape = Math.max(0, this.escape - dt * (this.heldBy.kind === 'farmer' ? 2.4 : 0.8));
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
      this.finishStep(dt);
      return;
    }

    this.moveStep(inp, dt);
    this.follow(dt);

    if (this.sprinting) this.ramStep();
    if (this.standing) this.balanceStep(dt); else if (this.wobble || this.leanX || this.leanZ) this.resetLean();
    if (this.punchAt > 0 && !this.punched && this.now - this.punchAt > 0.12) { this.punched = true; this.punchHit(); }
    this.finishStep(dt);
  }

  /** Walk / sprint / jump / facing from the controls (host, solo, and the player's own prediction). */
  private moveStep(inp: PigInput, dt: number) {
    let mx = inp.mx, mz = inp.mz;
    const moving = mx * mx + mz * mz > 0.01;
    if (this.sprinting && !moving) { mx = Math.sin(this.yaw); mz = Math.cos(this.yaw); }
    let speed = this.sprinting ? PIG.sprint : this.standing ? PIG.standWalk : PIG.walk;
    if (this.held) speed *= 1 - clamp(this.held.mass / (this.liftMax * 2.5), 0, 0.55) * (this.standing ? 0.5 : 1);
    if (this.muddy > 0) speed *= 0.95;
    let tx = mx * speed, tz = mz * speed;
    if (this.standing) { tx += this.stumbleX; tz += this.stumbleZ; }   // staggering steps (balance)
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
      G.audio.play('whoosh', { pos: this.pos, vol: 0.25, pitch: 1.3 });
    }
    // short hop when jump released early
    if (this.ownJump && !inp.jump && this.vel.y > 2) this.vel.y -= 40 * dt;

  }

  /** Host: a player moves their own pig on their machine (no input lag); here it follows the pose they report. */
  private follow(dt: number) {
    const r = this.remote;
    if (!r || G.net !== 'host' || this.now - r.at > 0.3 || this.now < this.ctlUntil || this.mode !== 'normal') return;
    const age = clamp(this.now - r.at, 0, 0.1);
    const ex = r.x + r.vx * age - this.pos.x, ey = r.y + r.vy * age - this.pos.y, ez = r.z + r.vz * age - this.pos.z;
    if (ex * ex + ey * ey + ez * ez > 9) { this.hostTakes(0.3); return; }   // blocked here but not there: resync them
    // catch up gently (a hard push into something only here would knock the pig over)
    const cx = ex * 10, cz = ez * 10, cl = Math.hypot(cx, cz), k = cl > 5 ? 5 / cl : 1;
    this.vel.set(r.vx + cx * k, r.vy + clamp(ey * 10, -6, 6), r.vz + cz * k);
    this.yaw = r.yaw;
    void dt;
  }
  /** Host: something pushed this pig here (knock, ram, teleport): the host moves it for a moment, the player follows. */
  hostTakes(secs: number) { this.ctlUntil = Math.max(this.ctlUntil, this.now + secs); }

  /**
   * Two legs = an inverted pendulum (Gang Beasts / Human: Fall Flat feel). The pig's top leans; speeding up leaves it
   * behind, stopping or turning throws it forward / outward, carrying heavy stuff and a slow random teeter push it,
   * hits and hard landings kick it. The pig rights itself (underdamped spring → it sways back and forth); past
   * `stumble` it staggers a few steps toward the lean to catch itself; past `fall` it goes over (ragdoll).
   * Moving toward the lean on purpose helps (that's how you catch yourself).
   */
  private balanceStep(dt: number, canFall = true) {
    const B = BAL;
    const ax = (this.vel.x - this.lastVx) / dt, az = (this.vel.z - this.lastVz) / dt;
    this.lastVx = this.vel.x; this.lastVz = this.vel.z;
    const dYaw = wrapAngle(this.yaw - this.lastYaw); this.lastYaw = this.yaw;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const heavy = this.held ? clamp(this.held.mass / 50, 0, 1) : 0;
    // slow, smooth random teeter (fixed frequencies per pig: no phase jumps)
    const t = this.now + this.seed * 37;
    const amp = B.noise * (0.35 + sp * 0.22 + heavy * 1.4) * (this.grounded ? 1 : 1.8);
    const nx = (Math.sin(t * 1.31) + Math.sin(t * 2.17 + 1.3) * 0.6 + Math.sin(t * 0.53 + 4) * 0.8) * amp;
    const nz = (Math.sin(t * 1.07 + 2.1) + Math.sin(t * 2.71 + 0.4) * 0.6 + Math.sin(t * 0.61 + 1) * 0.8) * amp;
    // turning while moving: lean out of the turn
    const turn = clamp(dYaw / Math.max(dt, 1e-3), -8, 8) * sp * B.turn;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);     // pig's right (world)
    const am = Math.hypot(ax, az), acc = am > 60 ? 60 / am : 1;     // collisions are handled as kicks (postStep)
    const L0 = Math.hypot(this.leanX, this.leanZ);
    const kp = B.kp * (1 - heavy * 0.35) * (this.grounded ? 1 : 0.5) * (L0 > B.sat ? B.sat / L0 : 1);
    const fx = B.fall0 * this.leanX - B.accel * ax * acc - kp * this.leanX - B.kd * this.leanVX + nx - turn * rx;
    const fz = B.fall0 * this.leanZ - B.accel * az * acc - kp * this.leanZ - B.kd * this.leanVZ + nz - turn * rz;
    this.leanVX += fx * dt; this.leanVZ += fz * dt;
    this.leanX += this.leanVX * dt; this.leanZ += this.leanVZ * dt;
    const L = Math.hypot(this.leanX, this.leanZ);
    this.wobble = clamp(L / B.fall, 0, 1);
    this.turnRate = 0;
    // past `stumble`: the feet stagger toward the lean to get back under the body (moveStep adds it to the walk)
    const st = L > B.stumble && this.grounded ? (L - B.stumble) * B.stagger : 0;
    this.stumbleX = st ? (this.leanX / L) * st : 0; this.stumbleZ = st ? (this.leanZ / L) * st : 0;
    if (st > 0.8 && this.now > this.stumbleSnd) { this.stumbleSnd = this.now + 0.45; G.audio.play('step|mudstep', { pos: this.pos, vol: 0.45, pitch: 1.4 }); }
    if (canFall && L > B.fall) {
      const dx = this.leanX / L, dz = this.leanZ / L;
      this.resetLean();
      this.startRagdoll(v1.set(dx * 2.5, 0.5, dz * 2.5), true);
      G.audio.play('grunt', { pos: this.pos, vol: 0.8 });
      G.events.push({ type: 'fell', who: this });
    }
  }
  /** A shove to the balance (hit, throw, landing, punch recoil): `k` ≈ how hard; direction = forward by default. */
  balanceKick(k: number, dir?: THREE.Vector3) {
    if (!this.standing) return;
    const f = dir ?? this.forward, l = Math.hypot(f.x, f.z) || 1;
    const r = (Math.random() - 0.5) * 0.8;
    this.leanVX += (f.x / l + r * Math.cos(this.yaw)) * k; this.leanVZ += (f.z / l - r * Math.sin(this.yaw)) * k;
  }
  private resetLean() { this.leanX = this.leanZ = this.leanVX = this.leanVZ = this.stumbleX = this.stumbleZ = 0; this.wobble = 0; this.lastVx = this.vel.x; this.lastVz = this.vel.z; this.lastYaw = this.yaw; }

  /**
   * The hit lands: hoof punch (standing), headbutt (four legs), weapon whack, or a bash with whatever is held.
   * Counts on Bob's poise, knocks pigs / critters / props, scares wolves.
   */
  private punchHit() {
    const f = this.forward;
    const h = this.held, wpn = h ? weaponOf(h) : 0, butt = !this.standing && !h;
    const reach = (butt ? 1.0 : PIG.punchRange) + (wpn ? 0.6 : h ? 0.3 : 0);
    const fwd = wpn ? 0.95 : butt ? 0.75 : 0.7;
    const hx = this.pos.x + f.x * fwd, hz = this.pos.z + f.z * fwd, hy = this.pos.y + (butt ? 0.05 : 0.3);
    const dir = v1.set(f.x, 0.35, f.z).normalize();
    const k = butt ? PIG.headbutt : h && !wpn ? 0.75 : 1;
    let hit = false;
    const farmer = G.farmer;
    if (farmer && Math.hypot(farmer.pos.x - hx, farmer.pos.z - hz) < reach && Math.abs(farmer.pos.y + 1 - hy) < 1.4) {
      if (wpn) { farmer.whacked?.(dir, wpn); this.weaponHit(); } else farmer.punched?.(dir, k);
      hit = true;
    }
    for (const w of G.wolves) if (w.active && Math.hypot(w.pos.x - hx, w.pos.z - hz) < reach * 0.9) { w.knock(v2.copy(dir).multiplyScalar(wpn ? 9 : 6 * k)); hit = true; }
    for (const o of G.holdables) {
      if (o === this || o === h || o.heldBy) continue;
      const p = o.body.translation();
      if (Math.hypot(p.x - hx, p.z - hz) - o.radius > 0.55 || Math.abs(p.y - hy) > 1) continue;
      const dv = Math.min(7, (160 * k) / Math.max(o.mass, 4));
      if (o.knock) o.knock(v2.copy(dir).multiplyScalar(dv), o.kind === 'pig');
      else o.body.applyImpulse(v2.copy(dir).multiplyScalar(dv * o.mass), true);
      hit = true;
    }
    if (hit) {
      G.audio.play(wpn ? 'metal' : h ? (h.kind === 'prop' ? 'wood|thud' : 'body') : 'punch|body', { pos: this.pos, vol: wpn ? 1 : 0.9, pitch: wpn ? 0.9 : butt ? 0.85 : 1 });
      G.fx.bits(v1.set(hx, hy + 0.3, hz), { count: 8, color: 0xfff1a8, speed: 3, up: 1.5, life: 0.35, size: 0.12, grow: 0, drag: 3, alpha: 1 });
      G.shakeFor(this, 0.2);
      G.noise(this.pos, 10);
    }
  }

  private finishStep(dt: number) {
    this.body.setLinvel(this.vel, true);
    this.body.setRotation(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw), true);
    this.setVel.copy(this.vel);
    this.holdStep(dt);
  }

  // ------------------------------------------------------------------ after physics: did something hit us?
  postStep(dt: number) {
    this.synced.capture();
    if (this.mode === 'ragdoll' || this.mode === 'held') return;
    const lv = this.body.linvel();
    const dvx = lv.x - this.setVel.x, dvz = lv.z - this.setVel.z;
    const dvy = lv.y - (this.setVel.y - 20 * dt);
    const side = Math.hypot(dvx, dvz);
    const k = this.standing ? 0.6 : 1;           // two legs: easier to knock over
    if (this.standing && dvy > 5) this.balanceKick(dvy * 0.12);   // hard landing on two legs
    if (this.standing && side > 4 && this.now > this.bumpT) { this.bumpT = this.now + 0.5; this.balanceKick(side * 0.3, v2.set(dvx, 0, dvz)); }   // shoved
    if (side > PIG.hitSpeed * k || dvy > PIG.landSpeed * (this.standing ? 0.75 : 1) || dvy < -PIG.hitSpeed * k) {
      this.startRagdoll(v1.set(dvx, Math.max(dvy, 0), dvz), true);
      return;
    }
    // fast objects hitting us
    world.contactPairsWith(this.collider, (c) => {
      const o = owners.get(c.handle) as Holdable | undefined;
      if (!o || o === this.held || o.heldBy === this || o === this.thrown?.h || this.mode !== 'normal') return;
      const ov = (o as any).synced?.preVel as THREE.Vector3 | undefined;
      if (!ov) return;
      const rel = v2.copy(ov).sub(this.vel).length();
      if (rel > (this.standing ? 6 : 8) && o.mass >= 3 && ov.length() > 6) {
        G.audio.play('body', { pos: this.pos, vol: 0.8 });
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
    this.resetLean(); if (this.standing) this.balanceKick(0.6, v2.set(-this.forward.x, 0, -this.forward.z));   // rocks back as it gets up
    G.audio.play('grunt', { pos: this.pos, vol: 0.5, pitch: this.standing ? 1.15 : 0.9 });
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
      G.audio.play('splat', { pos: this.pos, vol: 0.9 });
    } else {
      G.fx.puff(v1.copy(this.pos).setY(this.pos.y - 0.3), { count: 8, color: 0xcbb48c, speed: 1.2, up: 0.5, life: 0.9, size: 0.7, alpha: 0.5 });
      G.audio.play('thud', { pos: this.pos, vol: 0.5 });
    }
  }

  private tryFart() {
    if (this.now < this.fartReady || this.mode === 'wallow') return;
    this.fartReady = this.now + (ADMIN.noCooldowns && this === G.localPig ? 0.3 : PIG.fartCd);
    if (this.heldBy?.fartedOn) {      // carried: stink in his face, wriggle
      this.escape += this.heldBy.kind === 'farmer' ? 3 : 5;
      const b = v1.copy(this.pos);
      G.fx.puff(b, { count: 40, color: 0x9ccf4f, spread: 0.5, speed: 2.5, up: 0.3, life: 3, size: 1.8, grow: 2.2, drag: 2.2, alpha: 0.8 });
      G.clouds.push({ x: b.x, y: b.y, z: b.z, r: 3, until: this.now + 6 });
      G.audio.play('fart', { pos: this.pos, vol: 1, rand: 0.18, minGap: 0.1 });
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
    G.audio.play('fart', { pos: this.pos, vol: 1, rand: 0.18, minGap: 0.1 });
    G.shakeFor(this, 0.3);
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
    this.sprintReady = this.now + (ADMIN.noCooldowns && this === G.localPig ? 0.3 : PIG.sprintCd);
    if (this.standing) { this.standing = false; this.setShape('four'); }
    G.fx.puff(v1.copy(this.pos).setY(this.pos.y - 0.3), { count: 10, color: 0xd8c29a, speed: 2, up: 0.8, life: 0.8, size: 0.8, alpha: 0.6 });
    G.audio.play('grunt', { pos: this.pos, vol: 0.6 });
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
      this.sprintUntil = this.now; this.hostTakes(0.4);
      G.audio.play('punch|body', { pos: this.pos, vol: 1 });
      G.fx.bits(this.pos, { count: 12, color: 0xffe08a, speed: 4, up: 2, life: 0.5, size: 0.18, grow: 0, drag: 3, alpha: 1 });
      G.shakeFor(this, 0.45);
      G.noise(this.pos, 14);
    });
  }

  private oink() {
    G.audio.play('oink', { pos: this.pos, vol: 0.9, minGap: 0.25 });
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
    this.parts.matchVelocity();
    this.hostTakes(0.5);
  }

  startRagdoll(hit: THREE.Vector3 | null, sound: boolean) {
    if (this.held) this.release(false);
    const wasStanding = this.standing && this.shape === 'two';
    this.mode = 'ragdoll'; this.ragSince = this.now; this.still = 0;
    this.standing = false; this.sprintUntil = 0; this.swingT = -1;
    if (this.shape !== 'rag') {
      // keep the body where it is on screen: the ragdoll torso starts in the pose the pig had (upright when standing)
      const p = this.body.translation(), r = this.body.rotation();
      const yawQ = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);
      const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
      if (wasStanding) {
        const up = v2.copy(STAND_POS).setY(STAND_POS.y - CENTER.two).applyQuaternion(yawQ);
        q.copy(yawQ).multiply(QSTAND);
        up.sub(v3.copy(PIVOT).setY(PIVOT.y - CENTER.rag).applyQuaternion(q));
        this.body.setTranslation({ x: p.x + up.x, y: p.y + up.y, z: p.z + up.z }, true);
        this.body.setRotation(q, true);
        this.visual.snapStand();
      } else {
        const up = v2.set(0, CENTER.rag - CENTER[this.shape], 0).applyQuaternion(q);
        this.body.setTranslation({ x: p.x + up.x, y: p.y + up.y, z: p.z + up.z }, true);
      }
    }
    this.setShape('rag');
    this.body.lockRotations(false, true);
    const r = () => (Math.random() * 2 - 1) * 6;
    const av = hit ? v2.set(hit.z, 0, -hit.x).multiplyScalar(0.7) : v2.set(r(), r(), r());
    this.body.setAngvel({ x: av.x + r() * 0.3, y: av.y + r() * 0.3, z: av.z + r() * 0.3 }, true);
    if (sound) { G.audio.play('thud|body', { pos: this.pos, vol: 0.8 }); if (Math.random() < 0.5) G.audio.play('squeal', { pos: this.pos, vol: 0.6, minGap: 0.5 }); }
    if (hit) G.shakeFor(this, Math.min(0.6, hit.length() * 0.04));
    this.parts.matchVelocity();
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
    this.hostTakes(0.25);
  }

  // ------------------------------------------------------------------ farmer: caught / caged / grilled
  caughtBy(by: Carrier) {
    if (this.held) this.release(false);         // Bob confiscates the loot
    if (this.heldBy) this.heldBy.release(false);
    if (this.mode !== 'ragdoll') this.startRagdoll(null, false);   // hangs limp from the carrier's grip
    this.heldBy = by; this.mode = 'held'; this.escape = 0;
    this.standing = false; this.sprintUntil = 0; this.chargeStart = -1;
  }
  enterCage(cage: Cage, grillAt: number) { this.cage = cage; this.grillAt = grillAt; }
  freed() { this.cage = null; this.grillAt = 0; }
  /** Dragged off the farm by a wolf: out for a bit, back in the sty. */
  takenByWolf() { this.grilled(); this.outReason = 'wolf'; this.burntUntil = 0; }
  grilled() {
    this.cage = null; this.out = true; this.outUntil = this.now + 8; this.outReason = 'grill';
    if (this.held) this.release(false);
    this.body.setEnabled(false); this.parts.setEnabled(false);
    this.visual.root.visible = false;
  }
  private backFromGrill() {
    this.out = false; this.burntUntil = this.outReason === 'grill' ? this.now + 20 : 0;
    this.body.setEnabled(true); this.parts.setEnabled(true);
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
    this.parts.snap();
    this.hostTakes(0.3);
  }

  // ------------------------------------------------------------------ grab / carry / throw / hit
  /**
   * RMB: grab what's in front / drop what you hold. LMB: a click hits (hoof punch standing, headbutt on four legs,
   * whack with a weapon, bash with whatever else you hold); held down with something in your mouth / hooves = wind up
   * and throw it on release.
   */
  private grabStep(inp: PigInput) {
    if (inp.grabP && this.mode === 'normal') {
      if (this.held) this.release(false);
      else if (!this.cageLatchNear()) { const t = this.findGrabTarget(); if (t) this.grab(t); }
    }
    if (inp.attackP && this.mode === 'normal') {
      if (this.held) this.chargeStart = this.now;
      else this.startHit();
    }
    if (inp.attackR && this.held && this.chargeStart >= 0) {
      const quick = this.now - this.chargeStart < PIG.clickTime, c = this.charge();
      this.chargeStart = -1;
      if (quick) this.startHit();
      // light things: a real swing (hand flies forward, the thing follows), then let go; heavy ones: a shove
      else if (this.held.mass > this.liftMax) this.throwHeld(c);
      else { this.swingT = 0; this.swingC = c; }
    }
    if (this.swingT >= 0) {
      if (!this.held) this.swingT = -1;
      else if ((this.swingT += 1 / 60) >= PIG.swing) { this.swingT = -1; this.throwHeld(this.swingC); }
    }
  }
  /** Start a hit (lands a moment later in `punchHit`). */
  private startHit() {
    if (this.now - this.punchAt < PIG.punchCd) return;
    this.punchAt = this.now; this.punched = false;
    const wpn = this.held ? weaponOf(this.held) : 0;
    if (this.standing) this.balanceKick(0.5 + (wpn ? 0.4 : 0));
    else if (!this.held) { const f = this.forward; this.vel.x += f.x * 3; this.vel.z += f.z * 3; }   // headbutt lunge
    G.audio.play('whoosh', { pos: this.pos, vol: wpn ? 0.6 : 0.35, pitch: wpn ? 0.8 : 1.3 });
  }
  /** A weapon wears out on Bob's head: after a few hits it breaks (gone until the next round). */
  private weaponHit() {
    const h = this.held as (Holdable & { uses?: number; def?: { breaks?: number }; bank?: () => void }) | null;
    if (!h || h.uses === undefined) return;
    h.uses++;
    if (h.uses < (h.def?.breaks ?? 3)) return;
    const at = v2.copy(this.pos).setY(this.pos.y + 0.6);
    this.release(false);
    h.bank?.();
    G.audio.play('wood|metal', { pos: at, vol: 1, pitch: 0.7 });
    G.fx.bits(at, { count: 14, color: 0xc9c2b8, speed: 4, up: 3, life: 0.6, size: 0.12, grow: 0, drag: 2, alpha: 1 });
    G.events.push({ type: 'weaponBroke', who: this, text: h.label });
  }
  /** At the cage latch: RMB opens the lock-pick puzzle there (game.ts), so the pig doesn't grab. */
  private cageLatchNear() { const c = this.cage ?? G.cage; return !!c && c.canPick(this); }
  charge() { return this.chargeStart < 0 ? 0 : clamp((this.now - this.chargeStart - PIG.clickTime) / 0.9, 0, 1); }

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
    if (h.kind === 'pig') (h as Pig).grabbedByPig();
    this.swingT = -1; this.strainT = 0;
    this.grip.attach(h.body, this.gripTarget(GRIP[this.standing ? 'two' : 'four'].hold, v1), h.kind === 'pig' ? SCRUFF : undefined);
    G.audio.play('bite', { pos: this.pos, vol: 0.7 });
    G.noise(this.pos, 4);
  }

  release(thrown: boolean) {
    const h = this.held; if (!h) return;
    this.held = null; h.heldBy = null; this.chargeStart = -1; this.swingT = -1;
    this.grip.detach();
    ignorePair(this.body, h.body, false);
    h.onReleased?.(this, thrown);
    if (h.kind === 'pig') (h as Pig).startRagdoll(null, false);
  }

  private throwHeld(c: number) {
    const h = this.held; if (!h) return;
    const heavy = h.mass > this.liftMax;
    const pitch = clamp(-this.input.pitch, -0.3, 0.7) + 0.32;
    const dir = v1.set(Math.sin(this.input.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(this.input.yaw) * Math.cos(pitch));
    const sp = (PIG.throwMin + (PIG.throwMax - PIG.throwMin) * c) * Math.sqrt(clamp(14 / Math.max(h.mass, 6), 0.2, 1.4)) * (heavy ? 0.35 : 1)
      * (this.standing ? PIG.throwStand : 1);
    this.release(true);
    if (this.thrown && this.thrown.h !== h) ignorePair(this.body, this.thrown.h.body, false);
    ignorePair(this.body, h.body, true); this.thrown = { h, until: this.now + 0.35 };
    h.body.setLinvel({ x: dir.x * sp + this.vel.x * 0.5, y: dir.y * sp + Math.max(this.vel.y, 0) * 0.5, z: dir.z * sp + this.vel.z * 0.5 }, true);
    // keep the spin the swing gave it (plus a little tumble)
    const av = h.body.angvel();
    h.body.setAngvel({ x: av.x + (Math.random() - 0.5) * 4, y: av.y + (Math.random() - 0.5) * 4, z: av.z + (Math.random() - 0.5) * 4 }, true);
    if (h.kind === 'pig') (h as Pig).parts.matchVelocity();
    G.audio.play('throw|whoosh', { pos: this.pos, vol: 0.4 + c * 0.6, pitch: 1.2 - c * 0.4 });
    if (this.standing) this.balanceKick(0.6 + c * 0.9);
    G.noise(this.pos, 6 + c * 8);
  }

  /** Grip target (world) for a model-space point, riding the torso (yaw only: the pig is upright while in control). */
  private gripTarget(m: THREE.Vector3, out: THREE.Vector3) {
    const shape: Shape = this.standing ? 'two' : 'four';
    out.copy(m); out.y -= CENTER[shape];
    return out.applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw).add(this.pos);
  }
  /** Where the hand wants to be: at the snout / hooves, pulled back while charging, flung forward in the swing. */
  private gripGoal(out: THREE.Vector3) {
    const g = GRIP[this.standing ? 'two' : 'four'];
    if (this.swingT >= 0) {
      const k = clamp(this.swingT / PIG.swing, 0, 1);
      out.lerpVectors(g.hold, g.wind, this.swingC).lerp(g.rel, k * k * (3 - 2 * k));
    } else if (this.punchT > 0) out.lerpVectors(g.hold, g.rel, Math.sin(this.punchT * Math.PI) * 1.2);   // bash / whack with it
    else out.lerpVectors(g.hold, g.wind, this.held && this.held.mass > this.liftMax ? 0 : this.charge());
    return this.gripTarget(out, out);
  }

  /** The held thing hangs on the grip hand; the hand's motor is only as strong as the pig (lift / drag limits). */
  private holdStep(dt: number) {
    const h = this.held; if (!h) return;
    const swing = this.swingT >= 0, g = 20;
    this.grip.drive(this.gripGoal(v1), this.body, h.mass, dt, {
      up: (this.liftMax * PIG.gripLift + Grip.MASS) * g * (swing ? 2.5 : 1),
      side: PIG.dragMax * g * PIG.gripDrag * (swing ? 1.6 : 1),
      kp: swing ? 24 : 12, react: this.grounded ? 0.25 : 0.8, g,
    });
    // lost grip: snagged on something / yanked away
    if (this.grip.strain > 2) this.release(false);
    else if (this.grip.strain > 1.1) { if ((this.strainT += dt) > 0.4) this.release(false); }
    else this.strainT = 0;
  }

  /** Grabbed by another pig: hang limp from the grip (real ragdoll, free to swing). */
  grabbedByPig() {
    if (this.held) this.release(false);
    if (this.mode !== 'ragdoll') this.startRagdoll(null, false);
    this.mode = 'held';
  }

  // ------------------------------------------------------------------ online
  /** Host: a player joined / left this slot. */
  setPresent(on: boolean) {
    if (on === !this.absent) return;
    if (!on) {
      if (this.held) this.release(false);
      if (this.heldBy) this.heldBy.release(false);
      if (this.cage) { this.cage.pigs = this.cage.pigs.filter((p) => p !== this); this.freed(); }
      if (this.mode === 'ragdoll') this.getUp();
      this.absent = true; this.out = true; this.outUntil = Infinity;
      this.body.setEnabled(false); this.parts.setEnabled(false); this.visual.root.visible = false;
    } else {
      this.absent = false; this.out = false; this.burntUntil = 0;
      this.body.setEnabled(true); this.parts.setEnabled(true); this.visual.root.visible = true;
      this.respawn();
    }
  }
  /** Host → players: everything the visuals and the HUD need (positions travel separately). */
  netState(n: number[]) {
    n.push(MODES.indexOf(this.mode), SHAPES.indexOf(this.shape),
      (this.grounded ? 1 : 0) | (this.standing ? 2 : 0) | (this.out ? 4 : 0) | (this.outReason === 'wolf' ? 8 : 0) | (this.absent ? 16 : 0) | (this.cage ? 32 : 0) | (this.now < this.ctlUntil ? 64 : 0),
      this.vel.x, this.vel.y, this.vel.z, this.yaw, this.sprintUntil, this.sprintReady, this.fartReady, this.muddyUntil, this.burntUntil,
      this.punchAt, this.chargeStart, this.outUntil === Infinity ? -1 : this.outUntil, this.grillAt, this.wobble, this.leanX, this.escape,
      this.heldBy ? this.escapeNeed() : 0, holdableIndex(this.held), carrierCode(this.heldBy));
    this.parts.netState(n);
    const hp = this.grip.pos, r = this.body.rotation(), bp = this.body.translation();
    const hl = this.held ? v1.set(hp.x - bp.x, hp.y - bp.y, hp.z - bp.z).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w).invert()) : v1.set(0, 0, 0);
    n.push(Math.round(hl.x * 1000) / 1000, Math.round(hl.y * 1000) / 1000, Math.round(hl.z * 1000) / 1000, this.leanZ);
  }
  netApply(n: number[]) {
    if (!n.length) return;
    const f = n[2];
    const hostMode = MODES[n[0]] ?? 'normal', ctl = !!(f & 64), out = !!(f & 4);
    this.heldBy = carrierFrom(n[21]);
    // my own pig: I move it myself (prediction) whenever the host isn't moving it for me (knocked, carried, caged-out…)
    if (G.net === 'client' && this === G.localPig) {
      const can = ADMIN.predict && !ctl && !out && !this.heldBy && (hostMode === 'normal' || hostMode === 'wallow');
      if (can && !this.predicting) this.startPredicting(n);
      else if (!can) this.predicting = false;
    } else if (G.net === 'client' && this.body.isEnabled() === out) this.body.setEnabled(!out);
    const pred = this.predicting;
    this.mode = hostMode;
    const shape = SHAPES[n[1]] ?? 'four';
    if (!pred && shape !== this.shape) { this.shape = shape; this.visual.centerHeight = CENTER[shape]; }
    this.out = out; this.outReason = f & 8 ? 'wolf' : 'grill'; this.absent = !!(f & 16);
    this.cage = f & 32 ? G.cage : null;
    this.visual.root.visible = !this.out;
    if (!pred) {
      this.grounded = !!(f & 1); this.standing = !!(f & 2);
      this.vel.set(n[3], n[4], n[5]); this.yaw = n[6];
      this.sprintUntil = n[7]; this.sprintReady = n[8]; this.fartReady = n[9];
    } else {
      // the host is a little behind me: keep my own timers until its catch up; standing follows it if we disagree for long
      this.sprintUntil = Math.max(n[7], this.predSprintUntil); this.sprintReady = Math.max(n[8], this.predSprint); this.fartReady = Math.max(n[9], this.predFart);
      const hostStand = !!(f & 2);
      if (hostStand === this.standing) this.standDiff = 0;
      else if (!this.standDiff) this.standDiff = performance.now();
      else if (performance.now() - this.standDiff > 500) { this.setStanding(hostStand); this.standDiff = 0; }
    }
    this.muddyUntil = n[10]; this.burntUntil = n[11];
    this.punchAt = n[12]; this.chargeStart = n[13]; this.outUntil = n[14] < 0 ? Infinity : n[14]; this.grillAt = n[15];
    if (!pred) { this.wobble = n[16]; this.leanX = n[17]; this.leanZ = n[40] ?? 0; }
    this.escape = n[18]; this.netNeed = n[19];
    this.held = holdableFrom(n[20]);
    if (this.held) this.held.heldBy = this;
    this.parts.netApply(n, 22);
    this.netHand.set(n[37] ?? 0, n[38] ?? 0, n[39] ?? 0); this.netHasHand = !!this.held;
  }

  /** Player: take over my pig from the latest snapshot (pose, speed, heading, stance). */
  private startPredicting(n: number[]) {
    this.predicting = true;
    const p = this.synced.currP;
    this.yaw = n[6]; this.vel.set(n[3], n[4], n[5]);
    const shape = SHAPES[n[1]] ?? 'four';
    this.standing = !!(n[2] & 2);
    this.setShape(shape === 'rag' ? 'four' : shape);
    this.body.lockRotations(true, true);
    this.body.setTranslation(p, true);
    this.body.setLinvel(this.vel, true);
    this.body.setRotation(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw), true);
    this.synced.capture(); this.synced.capture();
    this.predWallow = 0; this.standDiff = 0;
  }

  /** Stand up / drop to four legs (shape + height), no sound. */
  private setStanding(on: boolean) {
    if (on === this.standing) return;
    this.standing = on;
    const p = this.body.translation();
    if (on) this.body.setTranslation({ x: p.x, y: p.y + 0.36, z: p.z }, true);
    this.setShape(on ? 'two' : 'four');
    this.lastYaw = this.yaw;
  }

  /**
   * Player: one fixed step of my own pig on my machine — movement, jump, sprint, fart launch, stance, wallow — so it
   * answers my keys at once. The host still runs everything that touches the world (grabs, rams, blasts, Bob…)
   * and follows where I say my pig is.
   */
  predictStep(dt: number) {
    const inp = this.input;
    const p = this.body.translation(); this.pos.set(p.x, p.y, p.z);
    const lv = this.body.linvel(); this.vel.set(lv.x, lv.y, lv.z);
    this.synced.beforeStep();
    const hit = raycast(this.pos, DOWN, this.bottom() + 0.16, ~L.FARMER & 0xffff, this.body, (c) => !(this.held && c.parent() === this.held.body));
    this.grounded = !!hit && hit.normal.y > 0.55;
    if (hit) this.groundNormal.copy(hit.normal);
    if (this.grounded) { this.coyote = 0.1; this.ownJump = false; } else this.coyote -= dt;
    this.jumpBuf = inp.jumpP ? 0.14 : this.jumpBuf - dt;
    const normal = this.mode === 'normal' && this.now >= this.predWallow;
    if (inp.standP && normal) this.setStanding(!this.standing);
    if (inp.sprintP && normal && this.now >= this.sprintReady) {
      this.sprintUntil = this.predSprintUntil = this.now + PIG.sprintDur; this.sprintReady = this.predSprint = this.now + PIG.sprintCd;
      this.setStanding(false);
    }
    if (inp.fartP && this.now >= this.fartReady && normal) {
      this.fartReady = this.predFart = this.now + PIG.fartCd;
      const mvLen = Math.hypot(inp.mx, inp.mz), f = this.forward;
      const dir = mvLen > 0.1 ? v2.set(inp.mx / mvLen, 0, inp.mz / mvLen) : v2.copy(f);
      this.vel.y = Math.max(this.vel.y, this.grounded ? PIG.fartUp : PIG.fartUp * 0.85);
      this.vel.x += dir.x * PIG.fartFwd; this.vel.z += dir.z * PIG.fartFwd;
      this.ownJump = false;
    }
    if (inp.wallowP && normal && this.grounded) { this.predWallow = this.now + PIG.wallowDur; this.setStanding(false); }
    if (this.mode === 'wallow' || this.now < this.predWallow) {
      if (inp.wallow) this.predWallow = Math.max(this.predWallow, this.now + 0.15);
      this.vel.x *= 0.8; this.vel.z *= 0.8;
    } else this.moveStep(inp, dt);
    if (this.standing) this.balanceStep(dt, false); else if (this.wobble || this.leanX || this.leanZ) this.resetLean();   // the host decides falls
    this.body.setLinvel(this.vel, true);
    this.body.setRotation(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw), true);
    // what I hold isn't simulated here: don't bump into it
    if (this.held !== this.predIgnore) {
      if (this.predIgnore) ignorePair(this.body, this.predIgnore.body, false);
      if (this.held) ignorePair(this.body, this.held.body, true);
      this.predIgnore = this.held;
    }
  }
  /** Player: my pose for the host (it follows it). */
  pose(): number[] {
    const p = this.body.translation(), v = this.body.linvel();
    return [p.x, p.y, p.z, v.x, v.y, v.z, this.yaw];
  }
  netPose(p: THREE.Vector3) { this.pos.copy(p); }

  // ------------------------------------------------------------------ render
  private vq = new THREE.Quaternion(); private tq = new THREE.Quaternion(); private tq2 = new THREE.Quaternion();
  private relQ = [0, 1, 2, 3, 4].map(() => new THREE.Quaternion()); private handM = new THREE.Vector3();
  render(alpha: number, dt: number) {
    if (this.out) return;
    const r = this.visual.root;
    this.synced.pos(alpha, r.position);
    this.synced.rot(alpha, this.tq);
    this.vq.slerp(this.tq, 1 - Math.exp(-(this.mode === 'ragdoll' || this.mode === 'held' ? 30 : 18) * dt));
    r.quaternion.copy(this.vq);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const net = G.net === 'client';
    const limp = this.mode === 'ragdoll' || this.mode === 'held';
    if (limp) for (let i = 0; i < 5; i++) this.parts.rel(i, this.relQ[i], net);
    let hand: THREE.Vector3 | null = null;
    if (this.held) {
      if (net) hand = this.handM.copy(this.netHand);
      else {
        const hp = this.grip.pos, q = this.body.rotation();
        hand = this.handM.set(hp.x, hp.y, hp.z).sub(this.synced.currP).applyQuaternion(this.tq2.set(q.x, q.y, q.z, q.w).invert());
      }
      hand.y += CENTER[this.shape];
    }
    this.visual.update({
      limp, rel: this.relQ, hand,
      speed: sp, grounded: this.grounded, vy: this.vel.y, standing: this.standing, mode: this.mode,
      sprinting: this.sprinting, muddy: this.muddy, holding: !!this.held, charging: this.charge(), dt, t: this.now,
      burnt: clamp((this.burntUntil - this.now) / 5, 0, 1), wobble: this.wobble, punch: this.punchT,
      leanF: this.leanX * Math.sin(this.yaw) + this.leanZ * Math.cos(this.yaw), leanS: this.leanX * Math.cos(this.yaw) - this.leanZ * Math.sin(this.yaw),
    });
    // dust while sprinting, mud drips
    if (this.sprinting && this.grounded && Math.random() < dt * 30)
      G.fx.puff(v1.copy(r.position).setY(r.position.y - 0.35), { count: 1, color: 0xd6c29b, speed: 0.6, up: 0.5, life: 0.7, size: 0.6, alpha: 0.45 });
    if (this.muddy > 0 && Math.random() < dt * 4 * this.muddy)
      G.fx.bits(v1.copy(r.position), { count: 1, color: 0x4a2f18, spread: 0.3, speed: 0.2, up: -0.5, grav: 9, life: 0.6, size: 0.07, grow: 0, alpha: 1 });
    void wrapAngle;
  }
}
