import * as THREE from 'three';
import { RAPIER, world, groups, L, owners, raycast, ignorePair, HOOKS } from '../core/physics';
import { Synced } from '../core/synced';
import { clamp, dampAngle, wrapAngle } from '../core/util';
import { MOD } from '../game/modifiers';
import { G, ADMIN, type Holdable, type Carrier } from '../game/ctx';
import type { Cage } from '../world/cage';
import { PigVisual } from './pigVisual';
import type { Outfit } from './cosmetics';
import { carrierCode, carrierFrom, holdableIndex, holdableFrom } from '../net/refs';
import { PigParts, CENTER, SCRUFF, type Shape } from './pigBody';
import { Grip } from '../core/grip';
import type { Tone } from '../core/ragdoll';
import { PIVOT, STAND_POS, STAND_ANGLE } from './pigModel';
import { SNACK, SNACK_IDS, type SnackId } from '../world/snacks';
import type { Prop } from '../world/props';
import { HANDS, type Handle } from '../world/hands';

/** What a player (local or remote) sends to their pig each physics step. World-space move, camera aim. */
export interface PigInput {
  mx: number; mz: number; yaw: number; pitch: number;
  jump: boolean; sprint: boolean; fart: boolean; stand: boolean; wallow: boolean; grab: boolean; attack: boolean;
  jumpP: boolean; sprintP: boolean; fartP: boolean; standP: boolean; wallowP: boolean; grabP: boolean; grabR: boolean; oinkP: boolean;
  /** LMB pressed / released; the lock-pick puzzle was solved / a pin slipped (the puzzle runs on the player's screen). */
  attackP: boolean; attackR: boolean; pickP: boolean; pickFailP: boolean;
  /** The crosshair: where the player aims (world offset from the pig, m; NaN = none) — held things go there (world/hands.ts). */
  ax: number; ay: number; az: number;
  /** Mouse wheel: how far the arms / neck stretch (0..1). R held: tip what you hold (pour). */
  reach: number; tilt: boolean;
}
export const emptyInput = (): PigInput => ({
  mx: 0, mz: 0, yaw: 0, pitch: 0, jump: false, sprint: false, fart: false, stand: false, wallow: false, grab: false, attack: false,
  jumpP: false, sprintP: false, fartP: false, standP: false, wallowP: false, grabP: false, grabR: false, oinkP: false,
  attackP: false, attackR: false, pickP: false, pickFailP: false, ax: NaN, ay: 0, az: 0, reach: 0, tilt: false,
});

/** Where a player's own copy of their pig is (sent with the controls, host follows it). */
export interface RemotePose { x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number; at: number }

/** Tuning (all pigs are equal). */
export const PIG = {
  mass: 30, walk: 4.8, standWalk: 3.5, sprint: 10.5, accel: 40, airAccel: 10, airBrake: 14,
  jump: 7.6, standJump: 7.0, fartUp: 9.8, fartFwd: 6, fartCd: 6, sprintCd: 5, sprintDur: 1.6,
  wallowDur: 1.1, mudTime: 60, ice: 0.1, iceSprint: 0.16, hitSpeed: 9.5, landSpeed: 13, ragMin: 1.0, ragMax: 4,
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
  two: { hold: new THREE.Vector3(0, 0.92, 0.4), wind: new THREE.Vector3(0, 1.5, -0.1), rel: new THREE.Vector3(0, 1.3, 0.8) },
};
/** Hand-to-mouth (lick / light up): how long. */
const MOUTH_T = 0.6;
/** Eating: where the food goes (the mouth), per stance. */
const MOUTH = { four: new THREE.Vector3(0, 0.72, 0.82), two: new THREE.Vector3(0, 1.3, 0.34) };
/** A snack in the hooves that a click uses (eat it / light a cigarette), not a hit. */
/** Heavy loot two pigs can hold together (Bob's safe). */
const coopOf = (h: Holdable | null) => (h as { def?: { coop?: boolean } } | null)?.def?.coop === true;
const snackOf = (h: Holdable | null) => { const p = h as Prop | null; return p?.kind === 'prop' && (p.def.snack || p.def.smokes) && p.left > 0 ? p : null; };
const MIDDLE = new THREE.Vector3();
const QSTAND = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -STAND_ANGLE);

type Mode = 'normal' | 'ragdoll' | 'wallow' | 'held';
const MODES: Mode[] = ['normal', 'ragdoll', 'wallow', 'held'];
const SHAPES: Shape[] = ['four', 'two', 'rag'];
const QX90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
const qHold = new THREE.Quaternion(), qTilt = new THREE.Quaternion(), XAXIS = new THREE.Vector3(1, 0, 0);
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
  /** A machine part in my hoof (a crank, a spoon, a lever, a bolt…: world/hands.ts). */
  handle: Handle | null = null; private handleFar = 0;
  /** R held: what I hold tips over (0 upright … 1 tipped, pouring). */
  tiltK = 0;
  /** Hand to mouth with what I hold (lick a joint, puff): since when. */
  mouthAt = -10;
  /** Reaching out to touch something (hug Bob, pull a plug, smear mud, drop a coin in a slot): since when, where. */
  touchAt = -10; touchP = new THREE.Vector3();
  /** Host: a short reach of the hooves / snout to a spot (the animation of an RMB "use"). */
  touch(at: THREE.Vector3) { this.touchAt = this.now; this.touchP.copy(at); }
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
  /** Shop gadget this player brings (online players: from their outfit message; host reads it at round start). */
  gadget = '';
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
  private swingT = -1; private swingC = 0; private strainT = 0; private heavyTold = -10;
  /** Heavy loot: how far its centre was when it was grabbed (the leash). */
  private leash = 1; private stuckT = 0;
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
  // ---- chain modes (farms 6 / 7): high (cannabis) / drunk (beer)
  /** 1 = high, 2 = drunk, 0 = sober. Level (0..1.3) kicks in over 5 s from buzzFrom, fades over 25 s after buzzUntil. */
  buzzKind = 0; buzzLvl = 0; buzzFrom = 0; buzzUntil = 0;
  private lagX = 0; private lagZ = 0;
  /** Balance beam (world/beams.ts): sideways lean (rad) and its speed while walking a log. */
  beamLean = 0; private beamLeanV = 0; onBeam: unknown = null;
  get buzz() {
    if (!this.buzzKind) return 0;
    const n = this.now;
    return Math.min(1, this.buzzLvl) * clamp((n - this.buzzFrom) / 5, 0, 1) * clamp(1 - (n - this.buzzUntil) / 25, 0, 1);
  }
  get high() { return this.buzzKind === 1 ? this.buzz : 0; }
  get drunk() { return this.buzzKind === 2 ? this.buzz : 0; }
  /** Host: a puff / a hit / a cookie / a mug: `amount` stronger, `secs` longer (a cookie kicks in after `delay`). */
  addBuzz(kind: 1 | 2, amount: number, secs: number, delay = 0) {
    const n = this.now;
    if (this.buzzKind !== kind || (this.buzz < 0.02 && n > this.buzzUntil + 25)) { this.buzzKind = kind; this.buzzLvl = 0; this.buzzFrom = n + delay; this.buzzUntil = n + delay; }
    if (this.buzz < 0.02 && n < this.buzzFrom) this.buzzFrom = Math.min(this.buzzFrom, n + delay);
    this.buzzLvl = Math.min(1.3, this.buzzLvl + amount);
    this.buzzUntil = Math.min(n + 200, Math.max(this.buzzUntil, n + delay) + secs);
  }
  clearBuzz() { this.buzzKind = 0; this.buzzLvl = 0; this.buzzUntil = 0; this.beamLean = this.beamLeanV = 0; }
  private buzzState() { return [this.buzzKind, this.buzzLvl, this.buzzFrom, this.buzzUntil, this.beamLean]; }
  private buzzApply(n: number[], j: number) {
    if (n[j] === undefined) return;
    this.buzzKind = n[j]; this.buzzLvl = n[j + 1]; this.buzzFrom = n[j + 2]; this.buzzUntil = n[j + 3];
    if (!this.predicting) this.beamLean = n[j + 4] ?? 0;
  }
  /** High / drunk controls: late (lag), drifting sideways; drunk also swaps left / right for a moment now and then. */
  private buzzMove(mx: number, mz: number, dt: number): [number, number] {
    const b = this.buzz;
    if (b < 0.02) { this.lagX = mx; this.lagZ = mz; return [mx, mz]; }
    const t = this.now + this.seed * 50, drunk = this.buzzKind === 2;
    const lag = Math.min(1, dt * (16 - (drunk ? 13 : 11) * b));
    this.lagX += (mx - this.lagX) * lag; this.lagZ += (mz - this.lagZ) * lag;
    mx = this.lagX; mz = this.lagZ;
    const ml = Math.hypot(mx, mz);
    if (ml < 0.1) return [mx, mz];
    const drift = drunk ? (Math.sin(t * 0.9) + Math.sin(t * 2.3) * 0.5) * 0.5 * b : Math.sin(t * 0.55) * 0.38 * b;
    mx += (-mz / ml) * drift * ml; mz += (mx / ml) * drift * ml;
    if (drunk && b > 0.55 && Math.sin(t * 0.21) > 0.82) {   // "which way is left?"
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw), d = mx * rx + mz * rz;
      mx -= 2 * d * rx; mz -= 2 * d * rz;
    }
    return [mx, mz];
  }

  /** Admin powers / punishments (host): ghost = nobody notices this pig; jailed (the sky cell) / frozen until. */
  pw = { ghost: false };
  jailUntil = 0; frozenUntil = 0;
  private flyOn = false;
  /** Admin power (host / solo, my own pig): flies through everything. */
  get flying() { return this === G.localPig && ADMIN.fly && G.net !== 'client' && !this.out && !this.heldBy; }
  get jailed() { return this.now < this.jailUntil; }
  get frozen() { return this.now < this.frozenUntil; }
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
  /** How hard the hooves can drag (heavy loot); spinach helps. */
  get dragMax() { return PIG.dragMax * (this.boosted('spinach') ? SNACK.lift : 1); }
  get liftMax() { return (this.standing ? PIG.liftMaxStand : PIG.liftMax) * (this.boosted('spinach') ? SNACK.lift : 1); }
  /** 0..1 jab progress (visual). */
  /** Snacks (world/snacks.ts): boost end times; eating since; smoking until; last puff. */
  boostUntil: Record<SnackId, number> = { beans: 0, spinach: 0, energy: 0, dogfood: 0 };
  eatAt = -10; cigUntil = 0; puffAt = -10;
  private eatProp: Prop | null = null; private nextPuff = 0; private puffFx = -10; private cigFx = 0;
  boosted(id: SnackId) { return this.now < this.boostUntil[id]; }
  get smoking() { return this.now < this.cigUntil; }
  get eating() { return this.now - this.eatAt < SNACK.eat; }
  get punchT() { const k = (this.now - this.punchAt) / 0.28; return k >= 0 && k <= 1 ? k : 0; }
  /** 0..1 how ready an ability is (HUD). */
  readiness(which: 'fart' | 'sprint') {
    const [ready, cd] = which === 'fart' ? [this.fartReady, PIG.fartCd * (this.boosted('beans') ? SNACK.fartCd : 1)] : [this.sprintReady, PIG.sprintCd * (this.boosted('energy') ? SNACK.sprintCd : 1)];
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
    this.snackStep();
    this.jailStep();

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
    if (this.flying) { if (this.mode !== 'normal') { if (this.mode === 'ragdoll') this.getUp(); this.mode = 'normal'; } this.flyStep(inp, dt); return; }
    if (this.flyOn) this.flyOff();
    if (this.frozen) { inp.mx = inp.mz = 0; inp.jumpP = inp.fartP = inp.sprintP = inp.standP = inp.wallowP = inp.grabP = inp.attackP = false; }

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
    if (G.lobby && (inp.grabP || inp.attackP) && !this.held) this.yaw = inp.yaw;   // lobby: grab / hit where the pointer is
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
    if (!this.beamCheck(dt, true)) { if (this.standing) this.balanceStep(dt); else if (this.wobble || this.leanX || this.leanZ) this.resetLean(); }
    if (this.punchAt > 0 && !this.punched && this.now - this.punchAt > 0.12) { this.punched = true; this.punchHit(); }
    this.finishStep(dt);
  }

  /** Admin flying: no gravity, through walls; WASD along the camera, Space up, C down, Shift fast. Grabs still work. */
  private flyStep(inp: PigInput, dt: number) {
    if (this.standing) this.setStanding(false);
    if (!this.flyOn) { this.flyOn = true; this.body.setGravityScale(0, true); this.collider.setSensor(true); }
    const sp = inp.sprint ? 26 : 11;
    const tx = inp.mx * sp, tz = inp.mz * sp, ty = (inp.jump ? 1 : 0) - (inp.wallow ? 1 : 0);
    const k = Math.min(1, dt * 8);
    this.vel.x += (tx - this.vel.x) * k; this.vel.z += (tz - this.vel.z) * k; this.vel.y += (ty * sp * 0.7 - this.vel.y) * k;
    this.yaw = dampAngle(this.yaw, inp.yaw, 14, dt);
    this.grounded = false;
    this.grabStep(inp);
    if (inp.oinkP) this.oink();
    this.finishStep(dt);
  }
  private flyOff() { this.flyOn = false; this.body.setGravityScale(1, true); this.collider.setSensor(false); }
  /** Admin jail (host): kept in the sky cell until the time is up, then back to the sty. */
  private jailStep() {
    if (!this.jailUntil || G.net === 'client') return;
    const J = G.jail;
    if (!this.jailed || !J) { this.jailUntil = 0; this.respawn(); return; }
    if (!J.inside(this.pos) && !this.heldBy) {
      const s = J.spot(G.pigs.indexOf(this), v1);
      if (this.mode === 'ragdoll') this.getUp();
      this.body.setTranslation(s, true); this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.parts.snap(); this.hostTakes(0.4);
    }
  }

  /** Walk / sprint / jump / facing from the controls (host, solo, and the player's own prediction). */
  private moveStep(inp: PigInput, dt: number) {
    let [mx, mz] = this.buzzMove(inp.mx, inp.mz, dt);
    const moving = mx * mx + mz * mz > 0.01;
    if (this.sprinting && !moving) { mx = Math.sin(this.yaw); mz = Math.cos(this.yaw); }
    let speed = this.sprinting ? PIG.sprint : this.standing ? PIG.standWalk : PIG.walk;
    if (this.held) speed *= 1 - clamp(this.held.mass / (this.liftMax * 2.5), 0, 0.55) * (this.standing ? 0.5 : 1);
    if (coopOf(this.held)) {
      // heavy loot on a leash: past the distance you grabbed it at you slow right down (it drags you back), so you
      // go as fast as it slides (positions, not speeds: an online player sees it where the snapshots put it); alone
      // (spinach) only at a crawl
      const hp = this.held!.body.translation(), d = Math.hypot(hp.x - this.pos.x, hp.z - this.pos.z);
      const alone = !(this.held as { helper?: unknown }).helper && this.held!.heldBy === this;
      speed = Math.min(speed, Math.max(0.25, (this.leash + 0.6 - d) * 2.5), alone ? 1.4 : Infinity);
    }
    if (this.muddy > 0) speed *= 0.95;
    if (this.high) speed *= 1 - 0.2 * this.high;
    if (this.boosted('energy')) speed *= SNACK.fast;
    let tx = mx * speed, tz = mz * speed;
    if (this.standing) { tx += this.stumbleX; tz += this.stumbleZ; }   // staggering steps (balance)
    let acc = this.grounded ? PIG.accel : PIG.airAccel;
    if (this.grounded && G.iceAt?.(this.pos.x, this.pos.z)) acc *= this.sprinting ? PIG.iceSprint : PIG.ice;   // farm 5: hooves on ice
    if (!this.grounded && !moving && this.ownJump) acc = PIG.airBrake;
    if (!this.grounded && !moving && !this.ownJump) acc = 1.5; // thrown / launched: keep momentum
    const dx = tx - this.vel.x, dz = tz - this.vel.z, dl = Math.hypot(dx, dz), maxD = acc * dt;
    if (dl > maxD) { this.vel.x += (dx / dl) * maxD; this.vel.z += (dz / dl) * maxD; } else { this.vel.x = tx; this.vel.z = tz; }

    // facing: camera direction while moving (strafe), movement direction while sprinting
    const want = this.sprinting ? Math.atan2(this.vel.x, this.vel.z) : inp.yaw;
    if (moving || this.held || this.handle || this.chargeStart >= 0 || G.lobby) this.yaw = dampAngle(this.yaw, want, this.sprinting ? 10 : 14, dt);

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
    const bz = this.buzz, dr = this.buzzKind === 2 ? bz : 0;
    const amp = B.noise * (0.35 + sp * 0.22 + heavy * 1.4) * (this.grounded ? 1 : 1.8) * (this.smoking ? SNACK.calm : 1) * (1 + bz * 2.2 + dr * 0.5);
    const nx = (Math.sin(t * 1.31) + Math.sin(t * 2.17 + 1.3) * 0.6 + Math.sin(t * 0.53 + 4) * 0.8) * amp + Math.sin(t * 0.27) * 2 * dr;
    const nz = (Math.sin(t * 1.07 + 2.1) + Math.sin(t * 2.71 + 0.4) * 0.6 + Math.sin(t * 0.61 + 1) * 0.8) * amp + Math.cos(t * 0.23) * 2 * dr;
    // turning while moving: lean out of the turn
    const turn = clamp(dYaw / Math.max(dt, 1e-3), -8, 8) * sp * B.turn;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);     // pig's right (world)
    const am = Math.hypot(ax, az), acc = am > 60 ? 60 / am : 1;     // collisions are handled as kicks (postStep)
    const L0 = Math.hypot(this.leanX, this.leanZ);
    const kp = B.kp * (1 - heavy * 0.35) * (1 - bz * 0.3) * (this.grounded ? 1 : 0.5) * (L0 > B.sat ? B.sat / L0 : 1);
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
  /** Walking a balance beam (chain modes)? Then the beam balance runs instead of the normal one. */
  private beamCheck(dt: number, canFall: boolean) {
    const beams = G.chain?.beams;
    const b = beams && this.mode === 'normal' && this.grounded ? beams.at(this, this.pos.y - CENTER[this.standing ? 'two' : 'four']) : null;
    if (b !== this.onBeam) { this.onBeam = b; this.beamLean = 0; this.beamLeanV = 0; if (!b) this.resetLean(); }
    if (!b) return false;
    this.beamStep(dt, b, canFall);
    return true;
  }
  /**
   * The beam: a sideways inverted pendulum. It tips over by itself (and teeters — much worse high / drunk); A / D
   * (whatever is left / right of the log on screen) push back: it leans left → press right. Walking makes it worse;
   * on four legs it's calmer. Past the edge you fall off sideways (host).
   */
  private beamStep(dt: number, b: { a: THREE.Vector3; axis: THREE.Vector3; right: THREE.Vector3 }, canFall: boolean) {
    const bz = this.buzz, mx = bz > 0.02 ? this.lagX : this.input.mx, mz = bz > 0.02 ? this.lagZ : this.input.mz;
    const u = clamp(mx * b.right.x + mz * b.right.z, -1, 1), f = clamp(mx * b.axis.x + mz * b.axis.z, -1, 1);
    const two = this.standing, t = this.now + this.seed * 31;
    // the push you have (14) always beats the worst teeter (≈ 9 when very high): it's hard because of the lag, not impossible
    const shake = (Math.sin(t * 1.7) + 0.6 * Math.sin(t * 3.1 + 1) + 0.5 * Math.sin(t * 0.7 + 2)) * (0.5 + 1.6 * bz + (this.buzzKind === 2 ? 0.8 * bz : 0)) * (two ? 1 : 0.55);
    const acc = (two ? 4 : 2.5) * this.beamLean + 14 * u - 2.6 * this.beamLeanV + shake * (1 + Math.abs(f) * 0.5);
    this.beamLeanV += acc * dt; this.beamLean += this.beamLeanV * dt;
    // stay on the log: walk along it, pulled to its centre line
    const off = (this.pos.x - b.a.x) * b.right.x + (this.pos.z - b.a.z) * b.right.z, sp = f * (two ? 1.7 : 2.2);
    this.vel.x = b.axis.x * sp - b.right.x * off * 6; this.vel.z = b.axis.z * sp - b.right.z * off * 6;
    this.leanX = b.right.x * this.beamLean; this.leanZ = b.right.z * this.beamLean;
    const fall = two ? 0.62 : 0.8;
    this.wobble = clamp(Math.abs(this.beamLean) / fall, 0, 1);
    this.stumbleX = this.stumbleZ = 0;
    if (canFall && Math.abs(this.beamLean) > fall) {
      const s = Math.sign(this.beamLean);
      this.beamLean = this.beamLeanV = 0; this.onBeam = null;
      this.startRagdoll(v1.set(b.right.x * s * 5, 2, b.right.z * s * 5), true);   // off the log, into the pond
      G.audio.play('squeal', { pos: this.pos, vol: 0.9 });
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
    const k = (butt ? PIG.headbutt : h && !wpn ? 0.75 : 1) * (this.boosted('spinach') ? SNACK.strong : 1);
    let hit = false;
    const farmer = G.farmer;
    if (farmer && Math.hypot(farmer.pos.x - hx, farmer.pos.z - hz) < reach && Math.abs(farmer.pos.y + 1 - hy) < 1.4) {
      if (wpn) { farmer.whacked?.(dir, wpn * (this.boosted('spinach') ? SNACK.strong : 1)); this.weaponHit(); } else farmer.punched?.(dir, k);
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
    // farm things that react to a hit (fruit trees shake, beehives get angry…)
    for (const o of G.hittables) if (o.hit(hx, hy, hz, reach, dir, k, this)) hit = true;
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
    this.handleStep(dt);
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
    // rainy day: the whole farm is mud
    const mud = Math.max(G.terrain.mudAt(this.pos.x, this.pos.z), G.mod === 'rain' ? MOD.rain.mud : 0);
    if (G.snowy && mud < 0.3 && G.terrain.dirtAt(this.pos.x, this.pos.z) < 0.3 && !G.iceAt?.(this.pos.x, this.pos.z)) {
      // farm 5: a roll in the snow = a snow-white coat (camouflage on snow, Bob sees you later)
      this.muddyUntil = this.now + PIG.mudTime;
      G.fx.puff(v1.copy(this.pos).setY(this.pos.y - 0.2), { count: 14, color: 0xffffff, speed: 2, up: 1.4, life: 1, size: 0.6, alpha: 0.8 });
      G.fx.bits(v1.copy(this.pos), { count: 20, color: 0xf4f8ff, speed: 3, up: 3, grav: 10, life: 0.7, size: 0.1, grow: 0, alpha: 1 });
      G.audio.play('snowstep', { pos: this.pos, vol: 1, pitch: 0.8 });
      G.events.push({ type: 'snowCoat', who: this });
    } else if (mud > 0.3) {
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
    const beans = this.boosted('beans'), big = beans ? 1.45 : 1;
    this.fartReady = this.now + (ADMIN.noCooldowns && this === G.localPig ? 0.3 : PIG.fartCd * (beans ? SNACK.fartCd : 1));
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
    this.vel.y = Math.max(this.vel.y, (this.grounded ? PIG.fartUp : PIG.fartUp * 0.85) * (beans ? SNACK.fartUp : 1));
    this.vel.x += dir.x * PIG.fartFwd * big; this.vel.z += dir.z * PIG.fartFwd * big;
    this.ownJump = false;
    if (this.mode === 'ragdoll') this.getUp();
    this.body.setLinvel(this.vel, true); this.setVel.copy(this.vel);
    // the cloud
    const vis = big * (G.lobby ? 0.55 : 1);   // the lobby camera is close: a smaller cloud
    G.fx.puff(butt, { count: Math.round(46 * vis), color: 0x9ccf4f, spread: 0.45 * vis, speed: 3.2 * vis, up: -0.8, life: 3.2, size: 1.9 * vis, grow: 2.4, drag: 2.0, alpha: 0.8, dir: v3.copy(f).negate().setY(-0.5) });
    G.fx.puff(butt, { count: 14, color: 0xe2f58a, spread: 0.2, speed: 6, up: -1, life: 0.7, size: 0.9, grow: 3, drag: 4, alpha: 0.95 });
    G.clouds.push({ x: butt.x, y: butt.y, z: butt.z, r: 3 * big, until: this.now + 6 });
    G.audio.play('fart', { pos: this.pos, vol: 1, rand: 0.18, minGap: 0.1, pitch: beans ? 0.75 : 1 });
    G.shakeFor(this, 0.3 * big);
    G.noise(this.pos, 22);
    // blast pushes everything nearby
    for (const h of G.holdables) {
      if (h === this || h === this.held) continue;
      const hp = h.body.translation();
      const d = v3.set(hp.x - butt.x, hp.y - butt.y, hp.z - butt.z);
      const dist = d.length();
      if (dist > 3.5 * big || dist < 0.01) continue;
      const k = 1 - dist / (3.5 * big);
      d.normalize().y += 0.5;
      const dv = Math.min(10, (k * 260) / Math.max(h.mass, 4));
      if (h.knock) h.knock(d.normalize().multiplyScalar(dv), dist < 1.8 && h.kind === 'pig');
      else h.body.applyImpulse(d.multiplyScalar(dv * h.mass), true);
    }
  }

  private startSprint() {
    this.sprintUntil = this.now + PIG.sprintDur;
    this.sprintReady = this.now + (ADMIN.noCooldowns && this === G.localPig ? 0.3 : PIG.sprintCd * (this.boosted('energy') ? SNACK.sprintCd : 1));
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
      const o = owners.get(c.handle) as (Holdable & { onRam?: (by: Pig, dir: THREE.Vector3) => void }) | undefined;
      if (!o || o === this.held || this.rammed.has(o)) return;
      this.rammed.add(o);
      const dir = v1.set(this.vel.x / sp, 0.45, this.vel.z / sp).normalize();
      if (o.onRam) o.onRam(this, dir);   // a static farm thing (fruit tree, beehive): it reacts, the pig bounces off
      else {
        const dv = Math.min(12, 520 / Math.max(o.mass, 5)) * (this.boosted('spinach') ? 1.4 : 1);
        if (o.knock) o.knock(dir.multiplyScalar(dv), true);
        else o.body.applyImpulse(dir.multiplyScalar(dv * o.mass), true);
      }
      this.vel.x *= -0.25; this.vel.z *= -0.25; this.vel.y = 3;
      this.sprintUntil = this.now; this.hostTakes(0.4);
      G.audio.play('punch|body', { pos: this.pos, vol: 1 });
      G.fx.bits(this.pos, { count: 12, color: 0xffe08a, speed: 4, up: 2, life: 0.5, size: 0.18, grow: 0, drag: 3, alpha: 1 });
      G.shakeFor(this, 0.45);
      G.noise(this.pos, 14);
    });
  }

  private oink() {
    if (this.buzz > 0.2) G.chain?.oinked(this);
    G.audio.play('oink', { pos: this.pos, vol: 0.9, minGap: 0.25, pitch: this.buzz > 0.2 ? 1.25 + Math.random() * 0.3 : 1 });
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
      if (this.handle) this.letGo();
      else if (this.held) this.release(false);
      else if (!this.cageLatchNear()) {
        // what's under the crosshair (in reach): a thing, a machine part, a dispenser
        const t = HANDS.target(this);
        if (t?.h) this.grab(t.h);
        else if (t?.handle) this.takeHandle(t.handle);
        else if (t?.disp) { const pr = t.disp.take(this, HANDS.aimGoal(this, v4)); if (pr) this.grab(pr); }
      }
    }
    this.tiltK = clamp(this.tiltK + (inp.tilt && this.held ? 2.2 : -3) * (1 / 60), 0, 1);
    if (inp.attackP && this.mode === 'normal' && !this.eating && !this.handle) {
      if (this.held) this.chargeStart = this.now;
      else this.startHit();
    }
    if (inp.attackR && this.held && this.chargeStart >= 0) {
      const quick = this.now - this.chargeStart < PIG.clickTime, c = this.charge();
      this.chargeStart = -1;
      const snack = quick ? snackOf(this.held) : null;
      if (snack && !(snack.def.smokes && this.smoking)) this.useSnack(snack);
      else if (quick && G.chain && (this.held as Prop).def?.item && G.chain.useItem(this, this.held as Prop)) { /* a chain item did its thing */ }
      else if (quick && this.buzz > 0.2 && (this.held as Prop).def?.food) { this.eatAt = this.now; this.eatProp = this.held as Prop; G.audio.play('munch', { pos: this.pos, vol: 0.9 }); }   // the munchies
      else if (quick) this.startHit();
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
  /** At the cage latch / a closed gate's latch: RMB opens it there (lock-pick puzzle: game.ts), so the pig doesn't grab. */
  private cageLatchNear() { const c = this.cage ?? G.cage; return (!!c && c.canPick(this)) || !!G.gates?.latchOf(this) || G.uses.some((u) => u.near(this)); }
  charge() { return this.chargeStart < 0 ? 0 : clamp((this.now - this.chargeStart - PIG.clickTime) / 0.9, 0, 1); }

  /** Could this pig take hold of it at all (not counting distance)? */
  canGrab(h: Holdable) {
    if (h === this || (h as any).held === this) return false;
    const coop = coopOf(h);
    // heavy loot another pig is dragging: a second pig can take hold too
    if (h.heldBy && !(coop && h.heldBy.kind === 'pig' && h.heldBy !== this && !(h as { helper?: unknown }).helper)) return false;
    if (h.mass > PIG.dragMax && !coop) return false;
    if ((h as Prop).noGrab?.()) return false;
    return true;
  }
  findGrabTarget(): Holdable | null {
    let best: Holdable | null = null, bestScore = Infinity;
    const f = this.forward;
    const reachY = this.standing ? 1.3 : 0.9;
    for (const h of G.holdables) {
      if (!this.canGrab(h)) continue;
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

  /** Click with a snack in the hooves: eat the can (boost when it's down) / light up a cigarette from the pack. */
  private useSnack(p: Prop) {
    if (p.def.smokes) {
      p.setLeft(p.left - 1);
      this.cigUntil = this.now + SNACK.cig; this.nextPuff = this.now + 1.4;
      G.audio.play('unlock', { pos: this.pos, vol: 0.6, pitch: 2.2 });
      G.fx.bits(v1.copy(this.pos).setY(this.pos.y + (this.standing ? 0.9 : 0.3)), { count: 6, color: 0xffb13a, speed: 0.6, up: 1.2, life: 0.35, size: 0.06, grow: 0, alpha: 1 });
      G.events.push({ type: 'lightUp', who: this });
      return;
    }
    this.eatAt = this.now; this.eatProp = p;
    G.audio.play('munch', { pos: this.pos, vol: 0.9 });
  }
  /** Host: eating finishes (the boost), puffs on the cigarette, the coughing fit at the end. */
  private snackStep() {
    const e = this.eatProp;
    if (e && (this.held !== e || this.mode !== 'normal')) { this.eatProp = null; this.eatAt = -10; }
    else if (e && !this.eating) {
      this.eatProp = null;
      const id = e.def.snack;
      if (id && e.left > 0) {
        e.setLeft(e.left - 1);
        this.boostUntil[id] = this.now + SNACK.secs[id];
        G.audio.play('oink', { pos: this.pos, vol: 0.8, pitch: 0.7 });
        G.events.push({ type: 'ate', who: this, text: id });
        if (this.buzz > 0.2) G.events.push({ type: 'munch', who: this });
      } else if (!id && e.def.food) {   // the munchies: gone in a few bites
        this.release(false); e.bank();
        G.audio.play('oink', { pos: this.pos, vol: 0.8, pitch: 0.8 });
        G.fx.bits(v1.copy(this.pos).setY(this.pos.y + 0.6), { count: 10, color: e.def.bits ?? 0xffd166, speed: 2, up: 2, life: 0.6, size: 0.08, grow: 0, alpha: 1 });
        G.events.push({ type: 'munch', who: this });
      }
    }
    if (this.smoking) { if (this.now > this.nextPuff) { this.puffAt = this.now; this.nextPuff = this.now + SNACK.puffEvery; } }
    else if (this.cigUntil > 0) {
      this.cigUntil = 0;
      if (Math.random() < SNACK.coughChance) {
        G.audio.play('cough', { pos: this.pos, vol: 0.9, pitch: 1.5 });
        G.noise(this.pos, 9);
        G.events.push({ type: 'pigCough', who: this });
      }
    }
  }
  /** A new round: no boosts, no cigarette. */
  clearSnacks() { for (const k of SNACK_IDS) this.boostUntil[k] = 0; this.cigUntil = 0; this.eatAt = -10; this.eatProp = null; }

  grab(h: Holdable) {
    const join = !!h.heldBy && coopOf(h);   // the second pig on a heavy thing
    if ((h as Prop).dockedIn) HANDS.undock(h as Prop, this);   // out of its socket
    this.tiltK = 0;
    this.held = h;
    { const hp = h.body.translation(); this.leash = Math.hypot(hp.x - this.pos.x, hp.z - this.pos.z); }
    if (join) (h as { helper?: unknown }).helper = this; else h.heldBy = this;
    ignorePair(this.body, h.body, true);
    if (!join) h.onGrabbed?.(this);
    if (h.kind === 'pig') (h as Pig).grabbedByPig();
    this.swingT = -1; this.strainT = 0;
    // pigs by the scruff; light things at their middle (they stick to the hooves: upright, aimed, tipped to pour —
    // no swinging about the grab point); heavy ones by the edge nearest the snout (dragged along)
    const atMiddle = h.kind === 'prop' && h.mass <= this.liftMax;
    this.grip.attach(h.body, this.gripTarget(GRIP[this.standing ? 'two' : 'four'].hold, v1), h.kind === 'pig' ? SCRUFF : atMiddle ? MIDDLE : undefined);
    G.audio.play('bite', { pos: this.pos, vol: 0.7 });
    G.noise(this.pos, 4);
  }

  /** Take hold of a machine part (a crank, a spoon, a lever…): it follows my hoof along its path. */
  takeHandle(hd: Handle) {
    if (hd.heldBy && hd.heldBy !== this) return;
    this.handle = hd; hd.heldBy = this; this.handleFar = 0;
    G.audio.play('bite', { pos: this.pos, vol: 0.5, pitch: 1.4 });
  }
  letGo() { const hd = this.handle; if (!hd) return; if (hd.heldBy === this) hd.heldBy = null; this.handle = null; }
  /** Host: the hoof works the handle; let go when it's out of reach (or I'm knocked over). */
  private handleStep(dt: number) {
    const hd = this.handle; if (!hd) return;
    if (this.mode !== 'normal' || hd.heldBy !== this) { this.letGo(); return; }
    hd.drive(HANDS.aimGoal(this, v1, true), this, dt);
    const rr = HANDS.reach(this, v2), kd = hd.knob(v3).distanceTo(v2);
    this.handleFar = kd > rr + 0.5 ? this.handleFar + dt : 0;
    if (this.handleFar > 0.3) this.letGo();
  }

  release(thrown: boolean) {
    const h = this.held; if (!h) return;
    this.held = null; this.chargeStart = -1; this.swingT = -1;
    const hp = h as { helper?: Pig | null };
    if (hp.helper === this) hp.helper = null;                                    // the second pig lets go
    else if (h.heldBy === this) { h.heldBy = hp.helper ?? null; if (hp.helper) hp.helper = null; }   // the first one: the other keeps it
    this.grip.detach();
    ignorePair(this.body, h.body, false);
    if (h.kind === 'prop') HANDS.ghostly(h as Prop, false);
    if (!h.heldBy) h.onReleased?.(this, thrown);
    if (h.kind === 'pig') (h as Pig).startRagdoll(null, false);
  }

  private throwHeld(c: number) {
    const h = this.held; if (!h) return;
    const heavy = h.mass > this.liftMax;
    const pitch = clamp(-this.input.pitch, -0.3, 0.7) + 0.32;
    const dir = v1.set(Math.sin(this.input.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(this.input.yaw) * Math.cos(pitch));
    const sp = (PIG.throwMin + (PIG.throwMax - PIG.throwMin) * c) * Math.sqrt(clamp(14 / Math.max(h.mass, 6), 0.2, 1.4)) * (heavy ? 0.35 : 1)
      * (this.standing ? PIG.throwStand : 1) * (this.boosted('spinach') ? SNACK.throwK : 1);
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
    } else if ((this.eatProp && this.eating) || this.now - this.mouthAt < MOUTH_T) {   // bring it to the mouth (eat / lick / light), back down
      const e = this.eatProp && this.eating ? (this.now - this.eatAt) / SNACK.eat : (this.now - this.mouthAt) / MOUTH_T, k = clamp(Math.min(e / 0.22, (1 - e) / 0.18), 0, 1);
      out.lerpVectors(g.hold, MOUTH[this.standing ? 'two' : 'four'], k * k * (3 - 2 * k));
    } else if (!this.held || this.held.mass > this.liftMax) out.copy(g.hold);   // heavy: dragged along in front
    else {
      // light: it goes where I aim (the crosshair, within reach); pulled back while winding up; a whack thrusts it out
      HANDS.aimGoal(this, out);
      const c = this.charge();
      if (c > 0) out.lerp(this.gripTarget(v4.copy(g.wind), v4), c);
      if (this.punchT > 0) out.addScaledVector(this.forward, Math.sin(this.punchT * Math.PI) * 0.45);
      return out;
    }
    return this.gripTarget(out, out);
  }

  /** The held thing hangs on the grip hand; the hand's motor is only as strong as the pig (lift / drag limits). */
  private holdStep(dt: number) {
    const h = this.held; if (!h) return;
    const swing = this.swingT >= 0, g = 20;
    const goal = this.gripGoal(v1);
    // light props stay upright, facing where I face (R tips them over: pour); near a socket that takes them, the
    // magnet pulls them in and turns them to fit
    let qT: THREE.Quaternion | null = null;
    if (h.kind === 'prop' && h.mass <= this.liftMax && !swing) {
      qT = qHold.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw).multiply(qTilt.setFromAxisAngle(XAXIS, this.tiltK * 2.0));
      // being pulled into its place (or tipped over an opening): it slides in without catching on edges
      const pull = this.charge() <= 0 && !this.eating && this.tiltK < 0.3 ? HANDS.magnet(this, h as Prop, goal, qT) : 0;
      HANDS.ghostly(h as Prop, pull > 0.3 || (this.tiltK > 0.05 && !!HANDS.pourMagnet(this, h as Prop, goal)));
    }
    this.grip.drive(goal, this.body, h.mass, dt, {
      up: (this.liftMax * PIG.gripLift + Grip.MASS) * g * (swing ? 2.5 : 1),
      side: this.dragMax * g * PIG.gripDrag * (swing ? 1.6 : 1),
      kp: swing ? 24 : 12, react: this.grounded ? 0.25 : 0.8, g,
    });
    if (qT) this.grip.orient(qT, h.mass < 8 ? 0.4 : 0.15);
    // lost grip: snagged on something / yanked away
    const coop = coopOf(h), alone = coop && !(h as { helper?: unknown }).helper;
    // heavy loot alone, pulling, and it doesn't budge for a second: you let go
    if (alone) {
      const hv = h.body.linvel(), pulling = this.input.mx * this.input.mx + this.input.mz * this.input.mz > 0.09;
      this.stuckT = pulling && Math.hypot(hv.x, hv.z) < 0.2 ? this.stuckT + dt : 0;
    } else this.stuckT = 0;
    const lost = this.grip.strain > (coop ? 2.6 : 2) || (this.grip.strain > (coop ? 1.4 : 1.1) && (this.strainT += dt) > (coop ? 0.7 : 0.4)) || this.stuckT > 1;
    if (this.grip.strain <= (coop ? 1.4 : 1.1)) this.strainT = 0;
    if (lost) {
      this.release(false);
      // heavy loot alone: it won't budge (a friend, or spinach)
      if (alone && this.now > this.heavyTold) { this.heavyTold = this.now + 4; G.events.push({ type: 'tooHeavy', who: this }); }
    }
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
    n.push(this.eatAt, this.cigUntil, this.puffAt, ...SNACK_IDS.map((k) => this.boostUntil[k]));
    n.push(this.jailUntil, this.frozenUntil, this.flying ? 1 : 0, ...this.buzzState());
    n.push(this.handle ? this.handle.id : -1, this.mouthAt, this.touchAt, Math.round(this.touchP.x * 100) / 100, Math.round(this.touchP.y * 100) / 100, Math.round(this.touchP.z * 100) / 100);
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
    const was = this.held;
    this.held = holdableFrom(n[20]);
    if (was && was !== this.held && (was as { helper?: unknown }).helper === this) (was as { helper?: unknown }).helper = null;
    if (this.held && this.held !== was) { const hp = this.held.body.translation(); this.leash = Math.hypot(hp.x - this.pos.x, hp.z - this.pos.z); }
    if (this.held) {   // heavy loot: the second pig is its helper (the host's prop state says who holds it first)
      const h = this.held as Holdable & { helper?: unknown };
      if (h.heldBy && h.heldBy !== this && h.heldBy.held === h && coopOf(h)) h.helper = this; else h.heldBy = this;
    }
    this.parts.netApply(n, 22);
    this.netHand.set(n[37] ?? 0, n[38] ?? 0, n[39] ?? 0); this.netHasHand = !!this.held;
    if (n[41] !== undefined) { this.eatAt = n[41]; this.cigUntil = n[42]; this.puffAt = n[43]; SNACK_IDS.forEach((k, i) => (this.boostUntil[k] = n[44 + i])); }
    const j = 44 + SNACK_IDS.length;
    if (n[j] !== undefined) { this.jailUntil = n[j]; this.frozenUntil = n[j + 1]; this.netFly = n[j + 2] === 1; this.buzzApply(n, j + 3); }
    if (n[j + 8] !== undefined) {
      const hd = n[j + 8] >= 0 ? HANDS.handles[n[j + 8]] ?? null : null;
      if (hd !== this.handle) { if (this.handle?.heldBy === this) this.handle.heldBy = null; this.handle = hd; if (hd) hd.heldBy = this; }
      this.mouthAt = n[j + 9];
      if (n[j + 10] !== undefined) { this.touchAt = n[j + 10]; this.touchP.set(n[j + 11], n[j + 12], n[j + 13]); }
    }
  }
  /** Player side: the host's pig is flying (admin). */
  netFly = false;

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
      this.sprintUntil = this.predSprintUntil = this.now + PIG.sprintDur; this.sprintReady = this.predSprint = this.now + PIG.sprintCd * (this.boosted('energy') ? SNACK.sprintCd : 1);
      this.setStanding(false);
    }
    if (inp.fartP && this.now >= this.fartReady && normal) {
      const beans = this.boosted('beans'), big = beans ? 1.45 : 1;
      this.fartReady = this.predFart = this.now + PIG.fartCd * (beans ? SNACK.fartCd : 1);
      const mvLen = Math.hypot(inp.mx, inp.mz), f = this.forward;
      const dir = mvLen > 0.1 ? v2.set(inp.mx / mvLen, 0, inp.mz / mvLen) : v2.copy(f);
      this.vel.y = Math.max(this.vel.y, (this.grounded ? PIG.fartUp : PIG.fartUp * 0.85) * (beans ? SNACK.fartUp : 1));
      this.vel.x += dir.x * PIG.fartFwd * big; this.vel.z += dir.z * PIG.fartFwd * big;
      this.ownJump = false;
    }
    if (inp.wallowP && normal && this.grounded) { this.predWallow = this.now + PIG.wallowDur; this.setStanding(false); }
    if (this.mode === 'wallow' || this.now < this.predWallow) {
      if (inp.wallow) this.predWallow = Math.max(this.predWallow, this.now + 0.15);
      this.vel.x *= 0.8; this.vel.z *= 0.8;
    } else this.moveStep(inp, dt);
    if (!this.beamCheck(dt, false)) { if (this.standing) this.balanceStep(dt, false); else if (this.wobble || this.leanX || this.leanZ) this.resetLean(); }   // the host decides falls
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
      // the hooves go on the thing itself (where it really is on screen), not on the invisible grip point
      const hv = (this.held as { obj?: THREE.Object3D; visual?: { root: THREE.Object3D } });
      const ho = hv.obj ?? hv.visual?.root;
      if (ho && this.standing) {
        hand.copy(ho.position).sub(r.position).applyQuaternion(this.tq2.copy(r.quaternion).invert());
        hand.y += CENTER[this.shape];
      }
    } else if (this.handle) {   // a machine part: the hoof / snout is on its knob
      hand = this.handle.knob(this.handM).sub(r.position).applyQuaternion(this.tq2.copy(r.quaternion).invert());
      hand.y += CENTER[this.shape];
    } else if (this.now - this.touchAt < 0.55) {   // reaching out to touch something, then back
      hand = this.handM.copy(this.touchP).sub(r.position).applyQuaternion(this.tq2.copy(r.quaternion).invert());
      hand.y += CENTER[this.shape];
    }
    this.visual.update({
      limp, rel: this.relQ, hand, handW: this.held ? this.held.radius : this.handle ? 0.04 : 0,
      act: this.eating ? 'eat' : this.smoking && this.now - this.puffAt < SNACK.puff ? 'puff' : '',
      actK: this.eating ? (this.now - this.eatAt) / SNACK.eat : (this.now - this.puffAt) / SNACK.puff,
      cig: this.smoking, strong: this.boosted('spinach'),
      speed: sp, grounded: this.grounded, vy: this.vel.y, standing: this.standing, mode: this.mode,
      sprinting: this.sprinting, muddy: this.muddy, holding: !!this.held, charging: this.charge(), dt, t: this.now,
      burnt: clamp((this.burntUntil - this.now) / 5, 0, 1), wobble: this.wobble, punch: this.punchT, beam: !!this.onBeam,
      leanF: this.leanX * Math.sin(this.yaw) + this.leanZ * Math.cos(this.yaw), leanS: this.leanX * Math.cos(this.yaw) - this.leanZ * Math.sin(this.yaw),
    });
    // smoking: a wisp off the ember, and a puff of smoke out of the snout after each drag
    if (this.smoking) {
      const tip = this.visual.cigTip(v2);
      if (tip && this.now > this.cigFx) { this.cigFx = this.now + 0.22; G.fx.puff(tip, { count: 1, color: 0xd9d9d9, spread: 0.01, speed: 0.15, up: 0.5, life: 1.2, size: 0.12, grow: 0.5, drag: 1, alpha: 0.4 }); }
      if (this.puffAt !== this.puffFx && this.now - this.puffAt > SNACK.puff * 0.6) {
        this.puffFx = this.puffAt;
        const sn = this.visual.snoutPos(v2), f = this.forward;
        G.fx.puff(sn, { count: 9, color: 0xe6e6e6, spread: 0.06, speed: 0.9, up: 0.5, life: 1.6, size: 0.32, grow: 1.6, drag: 1.4, alpha: 0.55, dir: v3.set(f.x, 0.2, f.z) });
      }
    }
    if (this.boosted('energy') && this.grounded && Math.hypot(this.vel.x, this.vel.z) > 3 && Math.random() < dt * 14)
      G.fx.bits(v1.copy(r.position).setY(r.position.y - 0.2), { count: 1, color: 0xffe14a, spread: 0.25, speed: 0.6, up: 1.2, life: 0.4, size: 0.08, grow: 0, alpha: 1 });
    if (this.boosted('beans') && Math.random() < dt * 1.5)
      G.fx.puff(v1.copy(r.position).addScaledVector(this.forward, -0.45), { count: 1, color: 0x9ccf4f, spread: 0.05, speed: 0.2, up: 0.2, life: 1, size: 0.3, grow: 1, alpha: 0.5 });
    // dust while sprinting, mud drips
    if (this.sprinting && this.grounded && Math.random() < dt * 30)
      G.fx.puff(v1.copy(r.position).setY(r.position.y - 0.35), { count: 1, color: G.snowy ? 0xf2f6ff : 0xd6c29b, speed: 0.6, up: 0.5, life: 0.7, size: 0.6, alpha: 0.45 });
    if (this.muddy > 0 && Math.random() < dt * 4 * this.muddy)
      G.fx.bits(v1.copy(r.position), { count: 1, color: G.snowy ? 0xffffff : 0x4a2f18, spread: 0.3, speed: 0.2, up: -0.5, grav: 9, life: 0.6, size: 0.07, grow: 0, alpha: 1 });
    void wrapAngle;
  }
}
