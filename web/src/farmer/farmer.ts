import * as THREE from 'three';
import { RAPIER, world, groups, L, owners, raycast, ignorePair } from '../core/physics';
import { Synced } from '../core/synced';
import { clamp, dampAngle, wrapAngle } from '../core/util';
import { G, ADMIN, type Holdable, type Cloud } from '../game/ctx';
import type { Pig } from '../pig/pig';
import type { Cage } from '../world/cage';
import type { Rect } from '../world/terrain';
import type { Wolf } from '../world/wolf';
import { Nav } from './nav';
import { Mower } from './mower';
import { FarmerVisual, type FarmerAnim } from './farmerVisual';
import { Ragdoll, type LimbDef } from '../core/ragdoll';
import { Grip } from '../core/grip';
import { SCRUFF } from '../pig/pigBody';

/** Tuning. */
export const BOB = {
  mass: 95, walk: 2.5, run: 5.7, carry: 3.6, mow: 2.2, accel: 22,
  grabReach: 1.9, windup: 0.42, lunge: 0.3, lungeSpeed: 7, catchR: 1.15, recover: 0.85,
  // grip: lots of mashing, progress drains fast, and he shakes the pig every few seconds
  escapeNeed: 24, escapeNeedMuddy: 14, shakeEvery: 2.2, shakeLoss: 4,
  slapChance: 0.3, slapWind: 0.35, slap: 0.3, slapReach: 1.75, taunt: 2.2,
  danceChance: 0.18, danceTime: 7,
  poiseWindow: 3, stagger: 100, knockdown: 160, ram: 60, punch: 34, staggerTime: 1.5, downTime: 3.4,
  cough: 3, loseSight: 4.5, search: 4, stamina: 14, pant: 2.6, fistGiveUp: 6,
};

/** How Bob sees, per activity. cos of the half view angle, range (m). */
const VIEW = {
  normal: { cos: Math.cos(1.05), range: 20 },
  busy: { cos: Math.cos(0.7), range: 13 },
  nap: { cos: 2, range: 0 },
  alert: { cos: Math.cos(1.25), range: 26 },
  flashlight: { cos: Math.cos(0.42), range: 16 },
};
type View = keyof typeof VIEW;

export type ChorePhase = 'day' | 'evening' | 'night';
export interface Chore {
  id: string; at: [number, number]; look: [number, number]; anim: FarmerAnim; dur: number; view: View;
  phase?: ChorePhase;
}

type State = 'routine' | 'investigate' | 'suspect' | 'chase' | 'search' | 'windup' | 'lunge' | 'recover' | 'carry' | 'dust'
  | 'stagger' | 'down' | 'cough' | 'fist' | 'pant' | 'guard' | 'slapWind' | 'slap' | 'taunt' | 'dance' | 'shoo' | 'sleep' | 'off';

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const UP = THREE.Object3D.DEFAULT_UP;
const HALF = 0.55, RAD = 0.38, CENTER = HALF + RAD;   // capsule; body centre height above the feet

/** Body parts (real bodies, limp when knocked down): head, armL, armR, legL, legR. Model space, Bob faces +z. */
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const LIMBS: LimbDef[] = [
  { joint: V(0, 1.58, 0.02), center: V(0, 1.76, 0.03), shape: () => RAPIER.ColliderDesc.ball(0.25), mass: 6, limit: 0.7,
    flail: { x: 0.2, y: 0.4, z: 0, speed: 5, phase: 0 } },
  ...[1, -1].map((s, i): LimbDef => ({ joint: V(s * 0.38, 1.42, 0), center: V(s * 0.4, 1.12, 0), shape: () => RAPIER.ColliderDesc.capsule(0.2, 0.09),
    mass: 5, limit: 2.2, flail: { x: 1.1, y: 0, z: s * 0.9, speed: 9, phase: i * 2 } })),
  ...[1, -1].map((s, i): LimbDef => ({ joint: V(s * 0.16, 0.86, 0), center: V(s * 0.16, 0.46, 0.02), shape: () => RAPIER.ColliderDesc.capsule(0.28, 0.12),
    mass: 9, limit: 1.4, flail: { x: 0.6, y: 0, z: s * 0.25, speed: 7, phase: 1 + i * 2.5 } })),
];
/** Where he holds a pig he carries (by the scruff, at arm's length in front of the belly), body space. */
const CARRY_AT = V(0, 1.38 - CENTER, 0.8);

/**
 * Farmer Bob: daily routine of chores (Untitled Goose Game) on a clock — day chores, flashlight patrol in the evening,
 * sleeps in the house at night. Per-pig suspicion (only un-piggy behaviour counts), hears noises, chases,
 * grabs (windup + lunge, dodgeable) or slaps, carries the pig to the cage by the BBQ. Strong hits stack (poise) →
 * stagger / knock-down. Dances now and then, mows the lawn, chases wolves away.
 */
export class Farmer {
  kind = 'farmer' as const;
  body: RAPIER.RigidBody;
  collider!: RAPIER.Collider;
  visual = new FarmerVisual();
  synced: Synced;
  /** Head, arms and legs as real bodies (limp when he is knocked down) and the hand that holds a pig. */
  parts: Ragdoll;
  grip = new Grip();
  private vq = new THREE.Quaternion(); private tq = new THREE.Quaternion();
  private relQ = [0, 1, 2, 3, 4].map(() => new THREE.Quaternion());
  private handM = new THREE.Vector3(); private netHand = new THREE.Vector3();
  mass = BOB.mass; radius = RAD; heldBy = null;
  label = 'Bob';
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  state: State = 'routine';
  stateT = 0;
  /** Suspicion per pig 0..1 ("?" at 0.3, "!" at 1). */
  sus = new Map<Pig, number>();
  target: Pig | null = null;
  carrying: Pig | null = null;
  choreIdx = 0;
  doing = false;
  /** i18n key of what he's doing (HUD). */
  activity = 'chore.walk';
  mower: Mower;
  private choreUntil = 0;
  private path: THREE.Vector3[] = [];
  private pathGoal = new THREE.Vector3(1e9, 0, 0);
  private pathAt = -10;
  private lastSeen = new THREE.Vector3();
  private lastSeenT = 0;
  private searchAt = new THREE.Vector3();
  private noiseT = 0;
  private poise = 0; private poiseT = -10;
  private hitBy = new Map<unknown, number>();
  private usedClouds = new WeakSet<Cloud>();
  private chaseRun = 0;
  private stuckT = 0; private stuck = 0; private stuckRef = new THREE.Vector3();
  private side = new THREE.Vector3(); private sideUntil = 0;
  private lying = false;
  private stunUntil = 0;
  private lookYaw = 0;
  private yell = 0;
  private stepT = 0;
  private unreachableT = 0;
  private shakeT = 0; private shakeUntil = 0;
  private slapDone = false; private slapped: Pig[] = []; forceSlap = false;
  private danceUntil = 0;
  private shooWolf: Wolf | null = null;
  private mowPath: THREE.Vector3[] = []; private mowIdx = 0; private riding = false;
  private flash: THREE.SpotLight;
  private sleepT = 0;
  /** Test hook: freeze the brain and show this animation. */
  debugAnim: FarmerAnim | null = null;

  constructor(scene: THREE.Scene, at: THREE.Vector3, public nav: Nav, public chores: Chore[], public cage: Cage,
    public pigs: Pig[], public zones: { garden: Rect[]; lawn: Rect; door: THREE.Vector3; mowerAt: THREE.Vector3 }) {
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y + CENTER + 0.05, at.z)
      .lockRotations().setCanSleep(false).setCcdEnabled(true));
    this.setCollider(false);
    this.parts = new Ragdoll(this.body, LIMBS, at, (i, anchor, rest) => { anchor.copy(LIMBS[i].joint).setY(LIMBS[i].joint.y - CENTER); rest.identity(); });
    this.parts.flailK.ragdoll = 0.3; this.parts.toneK.ragdoll = 0.05;
    this.synced = new Synced(this.body);
    scene.add(this.visual.root);
    this.pos.copy(at);
    this.mower = new Mower(scene, zones.mowerAt, Math.PI / 2);
    // flashlight (evening patrol / woken up at night)
    this.flash = new THREE.SpotLight(0xfff2c8, 0, 24, 0.45, 0.45, 1.3);
    this.flash.position.set(-0.3, 1.25, 0.35);
    this.flash.target.position.set(0, 0, 9);
    this.visual.root.add(this.flash, this.flash.target);
    G.farmer = this;
  }

  private setCollider(lying: boolean) {
    if (this.collider) { owners.delete(this.collider.handle); world.removeCollider(this.collider, false); }
    // knocked down (real ragdoll): the torso only (head + limbs are parts), belly = trampoline
    const d = lying ? RAPIER.ColliderDesc.capsule(0.12, 0.42).setTranslation(0, 1.15 - CENTER, 0.02).setFriction(0.8)
      .setRestitution(0.9).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
      : RAPIER.ColliderDesc.capsule(HALF, RAD).setFriction(0).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
    d.setMass(BOB.mass).setCollisionGroups(groups(L.FARMER));
    this.collider = world.createCollider(d, this.body);
    owners.set(this.collider.handle, this);
    this.lying = lying;
  }

  get now() { return G.time; }
  get forward() { return v3.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  /** Highest suspicion over all pigs (HUD). */
  get alarm() { let m = 0; for (const v of this.sus.values()) m = Math.max(m, v); return m; }
  get chasing() { return ['chase', 'windup', 'lunge', 'recover', 'fist', 'pant', 'slapWind', 'slap'].includes(this.state); }
  get asleep() { return this.state === 'sleep' || this.state === 'off'; }
  get flashlightOn() { return G.night > 0.5 && !this.asleep && this.state !== 'down'; }
  escapeNeed(p: Pig) { return ADMIN.easyEscape && p === G.localPig ? 1 : p.muddy > 0 ? BOB.escapeNeedMuddy : BOB.escapeNeed; }

  private go(s: State) { this.state = s; this.stateT = this.now; }
  private phaseNow(): ChorePhase { const h = G.hour; return h >= 5.5 && h < 20 ? 'day' : h >= 20 && h < 22.5 ? 'evening' : 'night'; }

  // ================================================================== admin
  setEnabled(on: boolean) {
    if (on === (this.state !== 'off')) return;
    if (!on) {
      if (this.carrying) this.release(false);
      this.stopRiding();
      if (this.lying) this.getUp();
      this.go('off'); this.target = null;
      this.body.setEnabled(false); this.parts.setEnabled(false); this.visual.root.visible = false;
    } else {
      this.body.setEnabled(true); this.parts.setEnabled(true); this.visual.root.visible = true;
      this.body.setTranslation({ x: this.zones.door.x, y: this.zones.door.y + CENTER + 0.1, z: this.zones.door.z }, true);
      this.go('routine'); this.doing = false; this.path = [];
    }
  }
  forceDance() { if (this.calm()) { this.stopRiding(); this.doing = false; this.dance(BOB.danceTime); } }
  forceMow() { const i = this.chores.findIndex((c) => c.id === 'mow'); if (i >= 0 && this.calm()) { this.stopRiding(); this.choreIdx = i; this.doing = false; this.go('routine'); } }
  forceBed() { const i = this.chores.findIndex((c) => c.id === 'bed'); if (i >= 0 && this.calm()) { this.stopRiding(); this.choreIdx = i; this.doing = false; this.go('routine'); } }
  slapMe(p: Pig) { if (this.state === 'sleep') this.wake(); this.forceSlap = true; this.stopRiding(); this.alarmed(p); }
  /** Admin: a poise-breaking hit (real ragdoll knock-down). */
  knockDown() { if (this.state === 'sleep') this.wake(); if (this.state !== 'off' && this.state !== 'down') this.hit(BOB.knockdown + 10, this.forward.clone()); }
  /** Admin: pick this pig up right now (tests the limp, dangling pig). */
  carryMe(p: Pig) { if (this.state === 'off' || this.state === 'down') return; if (this.state === 'sleep') this.wake(); this.stopRiding(); this.pickUp(p); }
  private calm() { return ['routine', 'investigate', 'search', 'suspect', 'guard', 'dust', 'dance'].includes(this.state); }

  // ================================================================== fixed step
  preStep(dt: number) {
    this.control(dt);
    if (!this.asleep) { this.parts.setTone(this.lying ? 'ragdoll' : 'active'); this.parts.step(this.now); }
  }
  private control(dt: number) {
    this.synced.beforeStep();
    if (this.state === 'off') return;
    if (this.state === 'sleep') { this.sleepStep(dt); return; }
    const p = this.body.translation(); this.pos.set(p.x, p.y - CENTER, p.z);
    const lv = this.body.linvel(); this.vel.set(lv.x, lv.y, lv.z);
    if (p.y < -20) { this.body.setTranslation({ x: 0, y: 3, z: -30 }, true); return; }
    this.yell = Math.max(0, this.yell - dt * 2);
    if (this.now - this.poiseT > BOB.poiseWindow) this.poise = Math.max(0, this.poise - 60 * dt);
    let want = 0;   // desired speed (set by states via moveTo)
    this.moveVel.set(0, 0, 0);
    if (this.debugAnim) { this.body.setLinvel({ x: 0, y: lv.y, z: 0 }, true); this.vel.set(0, lv.y, 0); return; }

    // stuns: cough / stagger / down end → resume
    if (this.stunUntil && this.now > this.stunUntil) {
      this.stunUntil = 0;
      if (this.lying) this.getUp();
      this.go(this.carrying ? 'carry' : this.target ? 'chase' : this.cage.pigs.length >= 2 ? 'guard' : 'routine');
      if (this.state === 'chase') this.lastSeenT = this.now;
      this.path = [];
    }
    if (this.state !== 'down' && this.state !== 'stagger' && this.state !== 'cough') this.checkClouds();
    if (!this.stunUntil) this.perceive(dt);

    switch (this.state) {
      case 'routine': want = this.routine(dt); break;
      case 'guard': want = this.guard(dt); break;
      case 'investigate': {
        this.activity = 'bob.heard';
        const d = this.moveTo(this.searchAt, BOB.walk, dt);
        want = BOB.walk;
        if (d < 1.2 || this.now - this.stateT > 15) { this.go('search'); }
        break;
      }
      case 'search':
        this.lookYaw = 0;
        if (this.now - this.stateT > BOB.search) { this.backToWork(); }
        break;
      case 'suspect': {
        const t = this.target;
        if (!t) { this.backToWork(); break; }
        this.face(t.pos, dt, 6);
        const d = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
        if (d > 5) { this.moveTo(t.pos, BOB.walk * 0.6, dt); want = 1; }
        if ((this.sus.get(t) ?? 0) < 0.12) { this.voice('mutter'); this.backToWork(); }
        break;
      }
      case 'chase': want = this.chase(dt); break;
      case 'windup': {
        const t = this.target;
        if (t) this.face(t.pos, dt, 14);
        if (this.now - this.stateT > BOB.windup) { this.go('lunge'); G.audio.play('whoosh', { pos: this.pos, vol: 0.8, pitch: 0.6 }); }
        break;
      }
      case 'lunge': {
        const f = this.forward;
        this.moveVel.set(f.x * BOB.lungeSpeed, 0, f.z * BOB.lungeSpeed); want = -1;
        const caught = this.tryCatch();
        if (caught) this.pickUp(caught);
        else if (this.now - this.stateT > BOB.lunge) { this.go('recover'); this.voice('grr', 0.8); }
        break;
      }
      case 'slapWind': {
        const t = this.target;
        if (t) this.face(t.pos, dt, 16);
        if (this.now - this.stateT > BOB.slapWind) { this.go('slap'); this.slapDone = false; G.audio.play('whoosh', { pos: this.pos, vol: 1, pitch: 0.8 }); }
        break;
      }
      case 'slap':
        if (!this.slapDone && this.now - this.stateT > 0.08) { this.slapDone = true; this.slapHit(); }
        if (this.now - this.stateT > BOB.slap) {
          if (this.slapped.length) { this.go('taunt'); this.voice('ha'); } else { this.go('recover'); this.voice('grr', 0.8); }
        }
        break;
      case 'taunt':
        if (this.slapped[0]) this.face(this.slapped[0].pos, dt, 4);
        if (this.now - this.stateT > BOB.taunt) {
          for (const s of this.slapped) this.sus.set(s, 0.4);
          this.slapped = []; this.target = null; this.chaseRun = 0;
          this.backToWork();
        }
        break;
      case 'recover':
        if (this.now - this.stateT > BOB.recover) this.go(this.target ? 'chase' : 'routine');
        break;
      case 'carry': want = this.carry(dt); break;
      case 'dust':
        if (this.now - this.stateT > 1.4) { if (Math.random() < 0.5 && G.night < 0.5) this.dance(5); else this.backToWork(); }
        break;
      case 'dance':
        this.activity = 'bob.dance';
        if (this.now > this.danceUntil) this.backToWork();
        break;
      case 'shoo': want = this.shoo(dt); break;
      case 'fist': {
        const t = this.target;
        if (t) this.face(t.pos, dt, 8);
        if (Math.random() < dt * 0.8) this.voice(Math.random() < 0.5 ? 'grr' : 'hey');
        if (this.now - this.stateT > 1.2) {
          if (t && this.reachable(t)) this.go('chase');
          else if (this.now - this.stateT > BOB.fistGiveUp) { this.giveUp(); }
        }
        break;
      }
      case 'pant':
        if (this.now - this.stateT > BOB.pant) { this.chaseRun = 0; this.go(this.target ? 'chase' : 'routine'); }
        break;
      case 'cough': this.moveVel.copy(this.forward).multiplyScalar(0.4); want = -1; break;
      case 'stagger': this.moveVel.copy(this.forward).multiplyScalar(-1.2); want = -1; break;
      case 'down': return;   // a real ragdoll: physics only
    }
    // apply velocity
    const target = want === 0 ? v1.set(0, 0, 0) : v1.copy(this.moveVel);
    const dx = target.x - this.vel.x, dz = target.z - this.vel.z, dl = Math.hypot(dx, dz), mx = BOB.accel * dt;
    if (dl > mx) { this.vel.x += (dx / dl) * mx; this.vel.z += (dz / dl) * mx; } else { this.vel.x = target.x; this.vel.z = target.z; }
    this.body.setLinvel(this.vel, true);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.4 && this.state !== 'stagger' && this.state !== 'lunge') this.yaw = dampAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), this.riding ? 4 : 8, dt);
    this.body.setRotation(new THREE.Quaternion().setFromAxisAngle(UP, this.yaw), true);
    this.holdCarried(dt);
    if (this.riding) this.mower.ride(this.pos, this.yaw, sp, dt);
    // footsteps
    if (sp > 0.8 && !this.lying && !this.riding) {
      this.stepT += dt * sp * (sp > 4 ? 0.62 : 0.85);
      if (this.stepT > 1) { this.stepT = 0; G.audio.play('boot', { pos: this.pos, vol: sp > 4 ? 0.9 : 0.55, pitch: 0.85 }); }
    }
  }
  private moveVel = new THREE.Vector3();

  postStep() {
    this.synced.capture();
    if (this.state === 'down' || this.asleep) return;
    // hard objects hitting him (thrown crates, pigs, pumpkins…)
    world.contactPairsWith(this.collider, (c) => {
      const o = owners.get(c.handle) as (Holdable & { synced?: Synced }) | undefined;
      if (!o || o === this.carrying || !o.synced || (o as any).heldBy) return;
      const ov = o.synced.preVel, rel = v2.copy(ov).sub(this.vel).length();
      if (rel < 6.5 || o.mass < 2) return;
      if ((this.hitBy.get(o) ?? -10) > this.now - 0.6) return;
      this.hitBy.set(o, this.now);
      this.hit(clamp((o.mass * rel) / 4, 6, 90), ov);
    });
  }

  // ================================================================== sleeping in the house
  private sleep() {
    this.stopRiding();
    this.go('sleep'); this.activity = 'bob.sleep';
    this.body.setEnabled(false); this.parts.setEnabled(false); this.visual.root.visible = false;
    this.sleepT = 0;
  }
  private wake(at?: THREE.Vector3) {
    if (this.state !== 'sleep') return;
    const d = this.zones.door;
    this.body.setEnabled(true); this.parts.setEnabled(true); this.visual.root.visible = true;
    this.body.setTranslation({ x: d.x, y: d.y + CENTER + 0.1, z: d.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.pos.copy(d);
    this.doing = false; this.path = [];
    if (at) { this.searchAt.copy(at); this.go('investigate'); this.voice('huh'); G.events.push({ type: 'bobWakes' }); }
    else { this.choreIdx = this.chores.findIndex((c) => (c.phase ?? 'day') === 'day'); this.go('routine'); this.voice('yawn', 0.7); }
  }
  private sleepStep(dt: number) {
    this.sleepT += dt;
    if (this.phaseNow() === 'day') { this.wake(); return; }
    if (Math.random() < dt * 0.3) G.audio.play('snore', { pos: this.zones.door, vol: 0.6, minGap: 2 });
    for (const n of G.noises) {
      if (n.t <= this.noiseT) continue;
      this.noiseT = n.t;
      if (this.sleepT < 3) continue;
      const d = Math.hypot(n.x - this.zones.door.x, n.z - this.zones.door.z);
      if (d < Math.min(30, n.radius * 0.9)) { this.wake(new THREE.Vector3(n.x, n.y, n.z)); return; }
    }
  }

  // ================================================================== perception
  private view(): View {
    if (G.night > 0.5 && this.state !== 'chase') return 'flashlight';
    if (this.state === 'routine' && this.doing) return this.chores[this.choreIdx].view;
    if (this.state === 'dance') return 'busy';
    if (this.state === 'routine' || this.state === 'dust' || this.state === 'carry') return 'normal';
    return 'alert';
  }

  /** How un-piggy is this pig right now (0 = just a pig). */
  private suspicious(p: Pig): number {
    if (p.out || p.cage || p.heldBy) return 0;
    if (p === G.localPig && (!ADMIN.bobSees || ADMIN.god)) return 0;
    let w = 0;
    if (p.held) w = 1;
    if (p.standing) w = Math.max(w, 0.55);
    if (p.sprinting) w = Math.max(w, 0.45);
    if (p.mode === 'ragdoll' && p.vel.length() > 4) w = Math.max(w, 0.5);
    if (this.zones.garden.some((r) => p.pos.x > r.x0 && p.pos.x < r.x1 && p.pos.z > r.z0 && p.pos.z < r.z1)) w = Math.max(w, 0.4);
    if (this.cage.pigs.length && this.cage.contains(p.pos, 2.2)) w = Math.max(w, 0.9);
    if (p.mode === 'wallow' && p.input.wallow) w = 0;        // playing dead
    return w;
  }

  private eye = new THREE.Vector3();
  private canSee(p: { pos: THREE.Vector3; standing?: boolean; muddy?: number }, v: { cos: number; range: number }) {
    this.eye.copy(this.pos).setY(this.pos.y + 1.7);
    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z, d = Math.hypot(dx, dz);
    let range = v.range * (p.standing ? 1.25 : 1);
    if ((p.muddy ?? 0) > 0) range *= G.terrain.isBare(p.pos.x, p.pos.z) ? 0.5 : 0.75;   // mud = camouflage
    if (G.night > 0.5 && this.state === 'chase') range *= 0.75;
    if (d > range && d > 2.2) return 0;
    if (d > 2.2) {   // inside 2.2 m he notices you anyway
      const look = this.yaw + this.lookYaw;
      const dot = (dx * Math.sin(look) + dz * Math.cos(look)) / Math.max(d, 0.01);
      if (dot < v.cos) return 0;
    }
    const dir = v2.set(p.pos.x - this.eye.x, p.pos.y - this.eye.y, p.pos.z - this.eye.z);
    const dist = dir.length(); dir.divideScalar(dist);
    const hit = raycast(this.eye, dir, dist, L.STATIC);
    if (hit && hit.dist < dist - 0.4) return 0;
    return 1 - clamp(d / Math.max(range, 1), 0, 1);
  }

  private perceive(dt: number) {
    const v = VIEW[this.view()];
    for (const p of this.pigs) {
      let s = this.sus.get(p) ?? 0;
      const w = this.suspicious(p);
      const near = v.range > 0 ? this.canSee(p, v) : 0;
      const seen = near > 0;
      if (p === this.target && seen && !p.out && !p.cage && !p.heldBy) { this.lastSeen.copy(p.pos); this.lastSeenT = this.now; }
      if (w > 0 && near > 0) s += w * (0.25 + 1.3 * near * near) * dt * (this.state === 'search' || this.state === 'investigate' ? 1.5 : 1);
      else if (p !== this.target || !this.chasing) s -= (near > 0 ? 0.3 : 0.2) * dt;
      s = clamp(s, 0, 1);
      if (p.out || p.cage) s = 0;
      this.sus.set(p, s);
      // reactions
      if (!this.calm() || this.state === 'shoo') continue;
      if (s >= 1) { this.alarmed(p); return; }
      if (s >= 0.3 && this.state !== 'suspect') {
        this.stopRiding();
        this.target = p; this.go('suspect'); this.voice('huh'); this.yell = 0.5;
      }
    }
    // wolves on his farm: chase them off
    if (this.calm() && this.state !== 'suspect' && !this.carrying) {
      for (const w of G.wolves as Wolf[]) {
        if (!w.active || w.state === 'flee' || w.state === 'leave') continue;
        if (Math.hypot(w.pos.x - this.pos.x, w.pos.z - this.pos.z) > 18 || !this.canSee(w, VIEW.alert)) continue;
        this.stopRiding(); this.doing = false;
        this.shooWolf = w; this.go('shoo'); this.voice('hey'); this.path = [];
        return;
      }
    }
    // noises
    if (this.state === 'routine' || this.state === 'search' || this.state === 'guard' || this.state === 'dance') {
      for (const n of G.noises) {
        if (n.t <= this.noiseT) continue;
        this.noiseT = n.t;
        const d = Math.hypot(n.x - this.pos.x, n.z - this.pos.z);
        const asleep = this.view() === 'nap';
        if (d > n.radius * (asleep ? 0.6 : this.riding ? 0.5 : 1)) continue;
        this.stopRiding();
        this.searchAt.set(n.x, n.y, n.z);
        this.voice(asleep ? 'yawn' : 'huh');
        this.doing = false;
        this.go('investigate'); this.path = [];
        break;
      }
    } else if (G.noises.length) this.noiseT = G.noises[G.noises.length - 1].t;
  }

  private alarmed(p: Pig) {
    this.stopRiding();
    this.target = p; this.sus.set(p, 1);
    this.lastSeen.copy(p.pos); this.lastSeenT = this.now;
    this.doing = false;
    this.go('chase'); this.path = [];
    this.voice('hey'); this.yell = 1;
    G.events.push({ type: 'alarm', who: p });
  }

  private giveUp() {
    if (this.target) this.sus.set(this.target, 0.45);
    this.target = null;
    this.voice('mutter');
    this.backToWork();
  }

  private backToWork() {
    this.target = null; this.lookYaw = 0; this.shooWolf = null;
    this.go(this.cage.pigs.length >= 2 ? 'guard' : 'routine');
    this.path = [];
  }

  private dance(secs: number) {
    this.go('dance'); this.danceUntil = this.now + secs;
    G.audio.play('banjo', { pos: this.pos, vol: 0.8 });
    this.voice('ha', 0.6);
  }

  // ================================================================== routine (clock-driven)
  private routine(dt: number) {
    const phase = this.phaseNow();
    let c = this.chores[this.choreIdx];
    if ((c.phase ?? 'day') !== phase && !(this.doing && c.id === 'mow')) {
      this.stopRiding();
      this.choreIdx = this.chores.findIndex((k) => (k.phase ?? 'day') === phase);
      this.doing = false; this.path = [];
      c = this.chores[this.choreIdx];
    }
    this.activity = 'chore.' + c.id;
    if (c.id === 'mow') return this.mowChore(c, dt);
    if (!this.doing) {
      const goal = v2.set(c.at[0], 0, c.at[1]);
      const d = this.moveTo(goal, BOB.walk, dt);
      if (d < 0.5 || (d < 2.2 && this.stuck >= 2)) {
        this.stuck = 0;
        if (c.id === 'bed') { this.sleep(); return 0; }
        this.doing = true; this.choreUntil = this.now + c.dur;
      }
      return BOB.walk;
    }
    this.face(v2.set(c.look[0], 0, c.look[1]), dt, 4);
    if (c.anim === 'nap' && Math.random() < dt * 0.25) this.voice('snore', 0.5);
    if (this.now > this.choreUntil) this.nextChore();
    return 0;
  }
  private nextChore() {
    const phase = this.phaseNow();
    this.doing = false; this.path = [];
    const n = this.chores.length;
    for (let k = 1; k <= n; k++) { const i = (this.choreIdx + k) % n; if ((this.chores[i].phase ?? 'day') === phase) { this.choreIdx = i; break; } }
    if (phase === 'day' && Math.random() < BOB.danceChance) this.dance(BOB.danceTime);
    else if (Math.random() < 0.4) this.voice('mutter', 0.5);
  }

  /** Lawn mowing: walk to the mower, ride serpentine rows over the lawn, park. */
  private mowChore(c: Chore, dt: number) {
    if (!this.doing) {
      const d = this.moveTo(this.mower.pos, BOB.walk, dt);
      if (d < 1.3 || (d < 2.5 && this.stuck >= 2)) {
        this.stuck = 0;
        this.mower.mount(this.visual.root); this.riding = true;
        this.mowPath = Mower.lawnPath(this.nav, this.zones.lawn); this.mowIdx = 0;
        this.doing = true; this.choreUntil = this.now + c.dur;
      }
      return BOB.walk;
    }
    const wp = this.mowPath[this.mowIdx];
    if (!wp || this.now > this.choreUntil) { this.stopRiding(); this.nextChore(); return 0; }
    if (this.moveTo(wp, BOB.mow, dt) < 0.9) { this.mowIdx++; this.path = []; }
    return BOB.mow;
  }
  private stopRiding() {
    if (!this.riding) return;
    this.riding = false;
    this.mower.dismount(this.pos, this.yaw);
    if (this.state === 'routine' && this.chores[this.choreIdx]?.id === 'mow') this.doing = false;
  }

  /** Two or more pigs caged: Bob stands by the grill with his eyes open. */
  private guard(dt: number) {
    this.activity = 'chore.guard';
    if (this.cage.pigs.length < 2) { this.go('routine'); return 0; }
    const spot = v2.copy(this.cage.front).addScaledVector(v3.copy(this.cage.front).sub(this.cage.center).setY(0).normalize(), 1.5);
    const d = this.moveTo(spot, BOB.walk, dt);
    if (d < 0.6) { this.lookYaw = Math.sin(this.now * 0.6) * 0.9; return 0; }
    return BOB.walk;
  }

  private shoo(dt: number) {
    const w = this.shooWolf;
    this.activity = 'bob.shoo';
    if (!w || !w.active || w.state === 'flee' || w.state === 'leave' || this.now - this.stateT > 10) { this.backToWork(); return 0; }
    const d = this.moveTo(w.pos, BOB.run * 0.9, dt, 0.5);
    if (Math.random() < dt * 0.7) this.voice('hey');
    if (d < 4.5) { w.scare(); this.go('fist'); this.target = null; this.stateT = this.now - BOB.fistGiveUp + 1.2; }
    return BOB.run * 0.9;
  }

  // ================================================================== chase / grab / slap
  private reachable(p: Pig) {
    const ground = G.terrain.height(p.pos.x, p.pos.z);
    if (p.pos.y - ground > 1.9) return false;
    const n = this.nav.nearestFree(p.pos.x, p.pos.z, 3);
    return !!n && Math.hypot(n.x - p.pos.x, n.z - p.pos.z) < 2.2;
  }

  private chase(dt: number) {
    const t = this.target;
    this.activity = 'bob.chaseYou';
    if (!t || t.out || t.cage || (t.heldBy && t.heldBy !== this) || (t === G.localPig && ADMIN.god)) { this.giveUp(); return 0; }
    if (this.now - this.lastSeenT > BOB.loseSight) {        // lost it: search where it was last seen
      this.searchAt.copy(this.lastSeen); this.sus.set(t, 0.6); this.target = null;
      this.voice('huh'); this.go('investigate'); this.path = [];
      return 0;
    }
    this.chaseRun += dt;
    if (this.chaseRun > BOB.stamina) { this.go('pant'); this.voice('yawn', 0.6); return 0; }
    const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z, d = Math.hypot(dx, dz), dy = t.pos.y - this.pos.y;
    if (d < BOB.grabReach && dy < 1.7 && dy > -0.8) {
      this.face(t.pos, dt, 16);
      // sometimes he doesn't bother grabbing: a big humiliating slap instead
      if (this.forceSlap || Math.random() < BOB.slapChance) { this.forceSlap = false; this.go('slapWind'); this.voice('grr', 0.7); }
      else this.go('windup');
      this.yell = 0.8;
      return 0;
    }
    if (!this.reachable(t)) {
      this.unreachableT += dt;
      if (this.unreachableT > 0.6 && d < 8) { this.unreachableT = 0; this.go('fist'); return 0; }
    } else this.unreachableT = 0;
    const goal = this.now - this.lastSeenT < 0.3 ? t.pos : this.lastSeen;
    this.moveTo(goal, BOB.run, dt, 0.45);
    return BOB.run;
  }

  /** Any free pig in front of his hands during the lunge. */
  private tryCatch(): Pig | null {
    const f = this.forward;
    const hx = this.pos.x + f.x * 0.75, hz = this.pos.z + f.z * 0.75, hy = this.pos.y + 0.8;
    let best: Pig | null = null, bd = BOB.catchR;
    for (const p of this.pigs) {
      if (p.out || p.cage || p.heldBy || (p === G.localPig && ADMIN.god)) continue;
      const d = Math.hypot(p.pos.x - hx, (p.pos.y - hy) * 0.6, p.pos.z - hz);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** The slap: every pig in front of his right hand flies sideways, spinning. */
  private slapHit() {
    const f = this.forward, right = v1.set(-f.z, 0, f.x);
    const hx = this.pos.x + f.x * 0.9, hz = this.pos.z + f.z * 0.9;
    this.slapped = [];
    for (const p of this.pigs) {
      if (p.out || p.cage || p.heldBy || (p === G.localPig && ADMIN.god)) continue;
      if (Math.hypot(p.pos.x - hx, p.pos.z - hz) > BOB.slapReach || Math.abs(p.pos.y - this.pos.y - 0.4) > 1.4) continue;
      const imp = v2.copy(right).multiplyScalar(-9).addScaledVector(f, 4); imp.y = 6.5;
      p.knock(imp, true);
      this.slapped.push(p);
      G.audio.play('slap', { pos: p.pos, vol: 1.2, pitch: 1.1 });
      G.audio.play('squeal', { pos: p.pos, vol: 1 });
      G.fx.bits(v3.copy(p.pos).setY(p.pos.y + 0.4), { count: 16, color: 0xfff1a8, speed: 4, up: 2, life: 0.5, size: 0.16, grow: 0, drag: 3, alpha: 1 });
      G.shakeFor(p, 0.5);
      G.events.push({ type: 'slapped', who: p, text: 'insult.' + Math.floor(Math.random() * 6) });
    }
    G.noise(this.pos, 12);
  }

  /** Admin / pig punch: a hoof jab. */
  punched(dir: THREE.Vector3) {
    if (this.asleep) return;
    if ((this.hitBy.get('punch') ?? -10) > this.now - 0.3) return;
    this.hitBy.set('punch', this.now);
    this.hit(BOB.punch, dir);
  }

  private pickUp(p: Pig) {
    this.carrying = p; this.target = p;
    p.caughtBy(this);
    ignorePair(this.body, p.body, true);
    this.grip.attach(p.body, p.pos, SCRUFF);   // he grabs it by the scruff: it dangles, kicks, swings
    G.audio.play('body', { pos: this.pos, vol: 1 });
    G.audio.play('squeal', { pos: p.pos, vol: 1 });
    this.voice('ha');
    G.shakeFor(p, 0.35);
    G.events.push({ type: 'caught', who: p });
    this.chaseRun = 0; this.shakeT = 0;
    this.go('carry'); this.path = [];
  }

  /** Pig wriggled free / he got hit: drop it. */
  release(_thrown: boolean) {
    const p = this.carrying; if (!p) return;
    this.carrying = null;
    this.grip.detach();
    ignorePair(this.body, p.body, false);
    p.heldBy = null;
    const f = this.forward;
    p.body.setLinvel({ x: f.x * 3 + (Math.random() - 0.5) * 3, y: 5, z: f.z * 3 + (Math.random() - 0.5) * 3 }, true);
    p.startRagdoll(null, false);
    G.events.push({ type: 'escaped', who: p });
    if (this.state === 'carry') {
      this.voice('grr'); this.sus.set(p, 1); this.target = p; this.lastSeenT = this.now; this.lastSeen.copy(p.pos);
      this.go('recover');
    }
  }

  /** Pig farts in his face while carried. */
  fartedOn() { this.cough(); }

  private carry(dt: number) {
    const p = this.carrying;
    this.activity = 'bob.carryPig';
    if (!p) { this.backToWork(); return 0; }
    // a firm grip: every few seconds he gives the pig a good shake (loses escape progress)
    this.shakeT += dt;
    if (this.shakeT > BOB.shakeEvery) {
      this.shakeT = 0; this.shakeUntil = this.now + 0.35;
      p.escape = Math.max(0, p.escape - BOB.shakeLoss);
      this.voice('grr', 0.7);
      G.shakeFor(p, 0.25);
    }
    const d = this.moveTo(this.cage.front, BOB.carry, dt);
    if (d < 0.7) {
      this.carrying = null;
      this.grip.detach();
      ignorePair(this.body, p.body, false);
      p.heldBy = null;
      this.cage.lock(p);
      this.sus.set(p, 0); this.target = null;
      this.voice('ha'); this.go('dust');
      G.events.push({ type: 'caged', who: p });
      return 0;
    }
    return BOB.carry;
  }

  /** The pig hangs from his hand (a joint at its scruff); a strong arm: it lifts any pig. Shakes = real shakes. */
  private holdCarried(dt: number) {
    const p = this.carrying; if (!p) return;
    const shake = this.now < this.shakeUntil ? Math.sin(this.now * 60) * 0.22 : Math.sin(this.now * 7) * 0.03;
    const T = v1.copy(CARRY_AT).setX(shake).applyAxisAngle(UP, this.yaw).add(this.pos).setY(this.pos.y + CENTER + CARRY_AT.y + Math.abs(shake) * 0.5);
    this.grip.drive(T, this.body, p.mass + 6, dt, { up: 5000, side: 5000, kp: 16, react: 0, g: 20 });
    if (this.grip.strain > 2.5) {    // snagged / teleported: bring it back to his hand
      p.body.setTranslation({ x: T.x, y: T.y - 0.3, z: T.z }, true); p.body.setLinvel(this.vel, true);
      this.grip.attach(p.body, p.pos, SCRUFF);
    }
  }

  // ================================================================== getting hurt
  /** Pig ram (via Pig.ramStep → knock). */
  knock(dv: THREE.Vector3, _ragdoll: boolean) {
    if (this.asleep) return;
    if ((this.hitBy.get('ram') ?? -10) > this.now - 0.4) return;
    this.hitBy.set('ram', this.now);
    this.hit(BOB.ram, dv);
  }

  private hit(dmg: number, dir: THREE.Vector3) {
    if (this.state === 'down') return;
    this.stopRiding();
    const winded = this.state === 'pant' || this.state === 'cough' || this.state === 'dance' ? 1.5 : 1;
    this.poise += dmg * winded; this.poiseT = this.now;
    G.audio.play('punch|body', { pos: this.pos, vol: 1 });
    this.voice('oof', 0.9);
    G.fx.bits(v1.copy(this.pos).setY(this.pos.y + 1.2), { count: 10, color: 0xfff1a8, speed: 3.5, up: 1.5, life: 0.4, size: 0.14, grow: 0, drag: 3, alpha: 1 });
    G.fx.shake(0.15);
    // knocked back a little
    const len = Math.hypot(dir.x, dir.z) || 1;
    this.vel.x += (dir.x / len) * 2.5; this.vel.z += (dir.z / len) * 2.5;
    // he's mad now: the nearest free pig did it
    let best: Pig | null = null, bd = 12;
    for (const p of this.pigs) {
      if (p.out || p.cage || p.heldBy || (p === G.localPig && ADMIN.god)) continue;
      const d = p.pos.distanceTo(this.pos);
      if (d < bd) { bd = d; best = p; }
    }
    const down = this.poise >= BOB.knockdown, stagger = !down && this.poise >= BOB.stagger && this.state !== 'stagger';
    if (down || stagger) {
      this.stun(down ? 'down' : 'stagger', down ? BOB.downTime : BOB.staggerTime);
      if (best) { this.target = best; this.sus.set(best, 1); this.lastSeen.copy(best.pos); }
    } else if (best && !this.carrying && !this.chasing && !this.stunUntil && bd < 6) this.alarmed(best);
  }

  private stun(kind: 'down' | 'stagger' | 'cough', secs: number) {
    if (kind !== 'cough' && this.carrying) this.release(false);
    this.stopRiding();
    if (kind === 'down') {
      this.setCollider(true);
      // he topples over backwards (head away from the hit), arms and legs flopping
      this.body.lockRotations(false, true);
      const f = this.forward;
      this.body.setAngvel({ x: -Math.cos(this.yaw) * 2.6, y: (Math.random() - 0.5) * 1.5, z: Math.sin(this.yaw) * 2.6 }, true);
      this.body.setLinvel({ x: this.vel.x - f.x * 1.5, y: 1.5, z: this.vel.z - f.z * 1.5 }, true);
      this.parts.setTone('ragdoll'); this.parts.matchVelocity();
      G.audio.play('thud|body', { pos: this.pos, vol: 1, pitch: 0.7 });
      G.audio.play('bob_down', { pos: this.pos, vol: 1 });
      G.fx.shake(0.4);
      G.events.push({ type: 'knockdown' });
      this.poise = 0;
    }
    if (kind === 'stagger') G.events.push({ type: 'stagger' });   // poise keeps stacking: more hits now = knock-down
    this.doing = false;
    this.go(kind); this.stunUntil = this.now + secs;
  }

  /** Back on his feet after a knock-down: upright, same heading, rotations locked again. */
  private getUp() {
    const p = this.body.translation();
    this.setCollider(false);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.lockRotations(true, true);
    this.body.setRotation(new THREE.Quaternion().setFromAxisAngle(UP, this.yaw), true);
    this.body.setTranslation({ x: p.x, y: Math.max(p.y, G.terrain.height(p.x, p.z) + CENTER + 0.05), z: p.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.vel.set(0, 0, 0);
  }

  private cough() {
    if (this.state === 'down' || this.state === 'stagger') return;
    this.stun('cough', BOB.cough);
    G.audio.play('cough', { pos: this.pos, vol: 0.9, rand: 0.1 });
    if (!G.audio.has('cough')) this.voice('oof', 0.7);
  }

  private checkClouds() {
    const cx = this.pos.x, cy = this.pos.y + 1.2, cz = this.pos.z;
    for (const c of G.clouds) {
      if (this.usedClouds.has(c)) continue;
      if (Math.hypot(c.x - cx, (c.y - cy) * 0.7, c.z - cz) < c.r * 0.8 + 0.3) {
        this.usedClouds.add(c);
        this.cough();
        return;
      }
    }
  }

  // ================================================================== movement helpers
  /** Follow a nav path to goal at speed; returns remaining straight distance. */
  private moveTo(goal: THREE.Vector3, speed: number, dt: number, replan = 5) {
    const dist = Math.hypot(goal.x - this.pos.x, goal.z - this.pos.z);
    const moved = Math.hypot(goal.x - this.pathGoal.x, goal.z - this.pathGoal.z);
    if (!this.path.length || moved > 1.5 || this.now - this.pathAt > replan) {
      const direct = this.nav.los(this.pos.x, this.pos.z, goal.x, goal.z);
      this.path = direct ? [goal.clone()] : (this.nav.path(this.pos, goal) ?? [goal.clone()]);
      this.pathGoal.copy(goal); this.pathAt = this.now;
    }
    let wp = this.path[0];
    while (wp && this.path.length > 1 && Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z) < 0.6) { this.path.shift(); wp = this.path[0]; }
    if (!wp) return dist;
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z, d = Math.hypot(dx, dz);
    const slow = this.path.length === 1 ? clamp(d / 1.2, 0.25, 1) : 1;
    if (d > 0.05) this.moveVel.set((dx / d) * speed * slow, 0, (dz / d) * speed * slow);
    // stuck → re-plan + sidestep for a moment
    this.stuckT += dt;
    if (this.stuckT > 1.2) {
      this.stuckT = 0;
      if (this.stuckRef.distanceTo(this.pos) < 0.4 && dist > 0.8) {
        this.stuck++; this.path = []; this.pathAt = -10;
        this.side.set(-dz, 0, dx).normalize().multiplyScalar(Math.random() < 0.5 ? -2.2 : 2.2); this.sideUntil = this.now + 0.6;
      } else this.stuck = 0;
      this.stuckRef.copy(this.pos);
    }
    if (this.now < this.sideUntil) this.moveVel.add(this.side);
    return dist;
  }

  private face(p: THREE.Vector3, dt: number, k: number) {
    this.yaw = dampAngle(this.yaw, Math.atan2(p.x - this.pos.x, p.z - this.pos.z), k, dt);
  }

  /** Bob's voice: real recorded grunts / laugh (+ optional extra recordings the user can drop in). */
  private voice(kind: string, vol = 1) {
    const at = v1.copy(this.pos).setY(this.pos.y + 1.7);
    const map: Record<string, string> = {
      huh: 'bob_huh', hey: 'bob_hey|bob_oof', grr: 'bob_oof', oof: 'bob_oof', ha: 'bob_laugh', yawn: 'yawn', snore: 'snore', mutter: '',
    };
    const s = map[kind];
    if (s) G.audio.play(s, { pos: at, vol, minGap: 0.35, pitch: kind === 'hey' ? 1.05 : 1 });
    if (kind === 'hey' || kind === 'grr') this.yell = 1;
  }

  // ================================================================== online
  /** Host → players: Bob's brain state as the visuals / HUD need it. */
  netState(n: number[], s: string[]) {
    n.push(this.stateT, this.yaw, this.vel.x, this.vel.y, this.vel.z, this.yell, this.lookYaw,
      this.carrying ? G.pigs.indexOf(this.carrying) : -1, this.target ? G.pigs.indexOf(this.target) : -1,
      this.riding ? 1 : 0, this.doing ? 1 : 0, this.choreIdx);
    for (const p of this.pigs) n.push(this.sus.get(p) ?? 0);
    this.parts.netState(n);
    const hp = this.grip.pos, bp = this.body.translation();
    const hl = this.carrying ? v1.set(hp.x - bp.x, hp.y - bp.y, hp.z - bp.z).applyAxisAngle(UP, -this.yaw) : v1.set(0, 0, 0);
    n.push(Math.round(hl.x * 1000) / 1000, Math.round(hl.y * 1000) / 1000, Math.round(hl.z * 1000) / 1000);
    s.push(this.state, this.activity, this.debugAnim ?? '');
  }
  netApply(n: number[], s: string[], nb: number[] = n, alpha = 0) {
    if (!n.length) return;
    this.state = s[0] as State; this.activity = s[1]; this.debugAnim = (s[2] || null) as FarmerAnim | null;
    const lerpA = (a: number, b: number) => a + wrapAngle((b ?? a) - a) * alpha;
    this.stateT = n[0]; this.yaw = lerpA(n[1], nb[1]); this.vel.set(n[2], n[3], n[4]); this.yell = n[5]; this.lookYaw = lerpA(n[6], nb[6]);
    this.carrying = n[7] >= 0 ? G.pigs[n[7]] : null; this.target = n[8] >= 0 ? G.pigs[n[8]] : null;
    const riding = n[9] === 1;
    if (riding !== this.riding) { this.riding = riding; if (riding) this.mower.mount(this.visual.root); else this.mower.dismount(this.pos, this.yaw); }
    this.doing = n[10] === 1; this.choreIdx = n[11];
    this.pigs.forEach((p, i) => this.sus.set(p, n[12 + i] ?? 0));
    const at = 12 + this.pigs.length;
    this.parts.netApply(n, at);
    this.netHand.set(n[at + 15] ?? 0, n[at + 16] ?? 0, n[at + 17] ?? 0);
    this.visual.root.visible = !this.asleep;
  }
  netPose(p: THREE.Vector3) { this.pos.copy(p).setY(p.y - CENTER); }

  // ================================================================== render
  render(alpha: number, dt: number) {
    if (this.state === 'off' || this.state === 'sleep') { this.flash.intensity = 0; return; }
    const r = this.visual.root;
    // knocked down: the whole body follows the physics torso; otherwise upright, facing his heading
    const limp = this.state === 'down';
    if (limp) this.synced.rot(alpha, this.tq); else this.tq.setFromAxisAngle(UP, this.yaw);
    this.vq.slerp(this.tq, 1 - Math.exp(-(limp ? 40 : 30) * dt));
    if (limp) for (let i = 0; i < 5; i++) this.parts.rel(i, this.relQ[i], G.net === 'client');
    this.synced.pos(alpha, r.position);
    r.position.sub(v1.set(0, CENTER, 0).applyQuaternion(this.vq));
    r.quaternion.copy(this.vq);
    let hand: THREE.Vector3 | null = null;
    if (this.carrying) {
      if (G.net === 'client') hand = this.handM.copy(this.netHand);
      else { const hp = this.grip.pos, bp = this.synced.currP; hand = this.handM.set(hp.x - bp.x, hp.y - bp.y, hp.z - bp.z).applyAxisAngle(UP, -this.yaw); }
      hand.y += CENTER;
    }
    const anim = this.animFor();
    const fl = this.flashlightOn && !this.riding;
    this.flash.intensity = fl ? 60 : 0;
    if (this.riding && G.net === 'client') this.mower.showRide(this.pos, this.yaw, Math.hypot(this.vel.x, this.vel.z), dt);
    this.visual.update({
      speed: Math.hypot(this.vel.x, this.vel.z), run: this.chasing || this.state === 'chase' || this.state === 'shoo', anim, at: this.now - this.stateT,
      t: this.now, dt, angry: this.chasing || this.state === 'carry' || this.state === 'fist' || this.state === 'shoo' ? 1 : this.state === 'suspect' ? 0.5 : 0,
      yell: this.yell, lookYaw: this.lookYaw, carrying: !!this.carrying, flashlight: fl, limp, rel: this.relQ, hand,
    });
  }

  private animFor(): FarmerAnim {
    if (this.debugAnim) return this.debugAnim;
    switch (this.state) {
      case 'routine': return this.riding ? 'ride' : this.doing ? this.chores[this.choreIdx].anim : 'idle';
      case 'search': return 'look';
      case 'suspect': return 'suspect';
      case 'windup': return 'windup';
      case 'lunge': return 'lunge';
      case 'recover': return 'recover';
      case 'carry': return 'carry';
      case 'dust': return 'dust';
      case 'stagger': return 'stagger';
      case 'down': return 'down';
      case 'cough': return 'cough';
      case 'fist': return 'fist';
      case 'pant': return 'pant';
      case 'slapWind': return 'slapWind';
      case 'slap': return 'slap';
      case 'taunt': return 'taunt';
      case 'dance': return 'dance';
      default: return 'idle';
    }
  }
}
