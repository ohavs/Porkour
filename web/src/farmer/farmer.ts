import * as THREE from 'three';
import { RAPIER, world, groups, L, owners, raycast, ignorePair } from '../core/physics';
import { Synced } from '../core/synced';
import { clamp, dampAngle, wrapAngle } from '../core/util';
import { G, type Holdable, type Cloud } from '../game/ctx';
import type { Pig } from '../pig/pig';
import type { Cage } from '../world/cage';
import type { Rect } from '../world/terrain';
import { Nav } from './nav';
import { FarmerVisual, type FarmerAnim } from './farmerVisual';

/** Tuning. */
export const BOB = {
  mass: 95, walk: 2.5, run: 5.7, carry: 3.6, accel: 22,
  grabReach: 1.9, windup: 0.42, lunge: 0.3, lungeSpeed: 7, catchR: 1.15, recover: 0.85,
  escapeNeed: 15, escapeNeedMuddy: 8,
  poiseWindow: 3, stagger: 100, knockdown: 160, ram: 60, staggerTime: 1.5, downTime: 3.4,
  cough: 3, loseSight: 4.5, search: 4, stamina: 14, pant: 2.6, fistGiveUp: 6,
};

/** How Bob sees, per activity. cos of the half view angle, range (m). */
const VIEW = {
  normal: { cos: Math.cos(1.05), range: 20 },
  busy: { cos: Math.cos(0.7), range: 13 },
  nap: { cos: 2, range: 0 },
  alert: { cos: Math.cos(1.25), range: 26 },
};
type View = keyof typeof VIEW;

export interface Chore { id: string; label: string; at: [number, number]; look: [number, number]; anim: FarmerAnim; dur: number; view: View }

type State = 'routine' | 'investigate' | 'suspect' | 'chase' | 'search' | 'windup' | 'lunge' | 'recover' | 'carry' | 'dust'
  | 'stagger' | 'down' | 'cough' | 'fist' | 'pant' | 'guard';

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const UP = THREE.Object3D.DEFAULT_UP;
const HALF = 0.55, RAD = 0.38, CENTER = HALF + RAD;   // capsule; body centre height above the feet

/**
 * Farmer Bob: daily routine of chores (Untitled Goose Game), per-pig suspicion (only un-piggy behaviour counts:
 * standing, carrying, sprinting, flying, trespassing), hears noises, chases, grab windup + lunge (dodgeable), carries
 * the pig to the cage by the BBQ. Strong hits stack (poise) → stagger / knock-down, which drops the pig.
 */
export class Farmer {
  kind = 'farmer' as const;
  body: RAPIER.RigidBody;
  collider!: RAPIER.Collider;
  visual = new FarmerVisual();
  synced: Synced;
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
  activity = '';
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
  /** Test hook: freeze the brain and show this animation. */
  debugAnim: FarmerAnim | null = null;

  constructor(scene: THREE.Scene, at: THREE.Vector3, public nav: Nav, public chores: Chore[], public cage: Cage,
    public pigs: Pig[], public zones: { garden: Rect[] }) {
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y + CENTER + 0.05, at.z)
      .lockRotations().setCanSleep(false).setCcdEnabled(true));
    this.setCollider(false);
    this.synced = new Synced(this.body);
    scene.add(this.visual.root);
    this.pos.copy(at);
  }

  private setCollider(lying: boolean) {
    if (this.collider) { owners.delete(this.collider.handle); world.removeCollider(this.collider, false); }
    const d = RAPIER.ColliderDesc.capsule(HALF, RAD).setMass(BOB.mass).setFriction(0)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min).setCollisionGroups(groups(L.FARMER));
    // knocked down: lying capsule behind him (head toward −z), belly = trampoline
    if (lying) d.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2))
      .setTranslation(0, -CENTER + RAD, -0.85).setRestitution(0.9).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
    this.collider = world.createCollider(d, this.body);
    owners.set(this.collider.handle, this);
    this.lying = lying;
  }

  get now() { return G.time; }
  get forward() { return v3.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  /** Highest suspicion over all pigs (HUD). */
  get alarm() { let m = 0; for (const v of this.sus.values()) m = Math.max(m, v); return m; }
  get chasing() { return ['chase', 'windup', 'lunge', 'recover', 'fist', 'pant'].includes(this.state); }
  escapeNeed(p: Pig) { return p.muddy > 0 ? BOB.escapeNeedMuddy : BOB.escapeNeed; }

  private go(s: State) { this.state = s; this.stateT = this.now; }

  // ================================================================== fixed step
  preStep(dt: number) {
    this.synced.beforeStep();
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
      if (this.lying) { this.setCollider(false); this.body.setTranslation({ x: p.x, y: p.y + 0.05, z: p.z }, true); }
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
        if (this.now - this.stateT > BOB.windup) { this.go('lunge'); G.audio.play('cloth', { pos: this.pos, vol: 0.8, pitch: 0.6 }); }
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
      case 'recover':
        if (this.now - this.stateT > BOB.recover) this.go(this.target ? 'chase' : 'routine');
        break;
      case 'carry': want = this.carry(dt); break;
      case 'dust':
        if (this.now - this.stateT > 1.4) this.backToWork();
        break;
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
      case 'down': break;
    }
    // apply velocity
    const target = want === 0 ? v1.set(0, 0, 0) : v1.copy(this.moveVel);
    const dx = target.x - this.vel.x, dz = target.z - this.vel.z, dl = Math.hypot(dx, dz), mx = BOB.accel * dt;
    if (dl > mx) { this.vel.x += (dx / dl) * mx; this.vel.z += (dz / dl) * mx; } else { this.vel.x = target.x; this.vel.z = target.z; }
    this.body.setLinvel(this.vel, true);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.4 && this.state !== 'stagger' && this.state !== 'lunge') this.yaw = dampAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), 8, dt);
    this.body.setRotation(new THREE.Quaternion().setFromAxisAngle(UP, this.yaw), true);
    this.holdCarried(dt);
    // footsteps
    if (sp > 0.8 && !this.lying) {
      this.stepT += dt * sp * (sp > 4 ? 0.62 : 0.85);
      if (this.stepT > 1) { this.stepT = 0; G.audio.play('step1|step2|step3|step4', { pos: this.pos, vol: sp > 4 ? 0.8 : 0.45, pitch: 0.75 }); }
    }
  }
  private moveVel = new THREE.Vector3();

  postStep() {
    this.synced.capture();
    if (this.state === 'down') return;
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

  // ================================================================== perception
  private view(): View {
    if (this.state === 'routine' && this.doing) return this.chores[this.choreIdx].view;
    if (this.state === 'routine' || this.state === 'dust' || this.state === 'carry') return 'normal';
    return 'alert';
  }

  /** How un-piggy is this pig right now (0 = just a pig). */
  private suspicious(p: Pig): number {
    if (p.out || p.cage || p.heldBy) return 0;
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
  private canSee(p: Pig, v: { cos: number; range: number }) {
    this.eye.copy(this.pos).setY(this.pos.y + 1.7);
    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z, d = Math.hypot(dx, dz);
    let range = v.range * (p.standing ? 1.25 : 1);
    if (p.muddy > 0) range *= G.terrain.isBare(p.pos.x, p.pos.z) ? 0.5 : 0.75;   // mud = camouflage
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
      const calm = this.state === 'routine' || this.state === 'investigate' || this.state === 'search' || this.state === 'guard' || this.state === 'suspect' || this.state === 'dust';
      if (!calm) continue;
      if (s >= 1) { this.alarmed(p); return; }
      if (s >= 0.3 && this.state !== 'suspect') {
        this.target = p; this.go('suspect'); this.voice('huh'); this.yell = 0.5;
      }
    }
    // noises
    if (this.state === 'routine' || this.state === 'search' || this.state === 'guard') {
      for (const n of G.noises) {
        if (n.t <= this.noiseT) continue;
        this.noiseT = n.t;
        const d = Math.hypot(n.x - this.pos.x, n.z - this.pos.z);
        const asleep = this.view() === 'nap';
        if (d > n.radius * (asleep ? 0.6 : 1)) continue;
        this.searchAt.set(n.x, n.y, n.z);
        this.voice(asleep ? 'yawn' : 'huh');
        this.doing = false;
        this.go('investigate'); this.path = [];
        break;
      }
    } else if (G.noises.length) this.noiseT = G.noises[G.noises.length - 1].t;
  }

  private alarmed(p: Pig) {
    this.target = p; this.sus.set(p, 1);
    this.lastSeen.copy(p.pos); this.lastSeenT = this.now;
    this.doing = false;
    this.go('chase'); this.path = [];
    this.voice('hey'); this.yell = 1;
    if (p === G.localPig) G.audio.play('jingle_alert', { vol: 0.7 });
    G.events.push({ type: 'alarm', who: p });
  }

  private giveUp() {
    if (this.target) this.sus.set(this.target, 0.45);
    this.target = null;
    this.voice('mutter');
    this.backToWork();
  }

  private backToWork() {
    this.target = null; this.lookYaw = 0;
    this.go(this.cage.pigs.length >= 2 ? 'guard' : 'routine');
    this.path = [];
  }

  // ================================================================== routine
  private routine(dt: number) {
    const c = this.chores[this.choreIdx];
    this.activity = c.label;
    if (!this.doing) {
      const goal = v2.set(c.at[0], 0, c.at[1]);
      const d = this.moveTo(goal, BOB.walk, dt);
      if (d < 0.5 || (d < 2.2 && this.stuck >= 2)) {
        this.stuck = 0;
        this.doing = true; this.choreUntil = this.now + c.dur;
      }
      return BOB.walk;
    }
    this.face(v2.set(c.look[0], 0, c.look[1]), dt, 4);
    if (c.anim === 'nap' && Math.random() < dt * 0.25) this.voice('snore', 0.5);
    if (this.now > this.choreUntil) {
      this.doing = false; this.choreIdx = (this.choreIdx + 1) % this.chores.length; this.path = [];
      if (Math.random() < 0.5) this.voice('mutter', 0.5);
    }
    return 0;
  }

  /** Two or more pigs caged: Bob stands by the grill with his eyes open. */
  private guard(dt: number) {
    this.activity = 'guarding the BBQ';
    if (this.cage.pigs.length < 2) { this.go('routine'); return 0; }
    const spot = v2.copy(this.cage.front).addScaledVector(v3.copy(this.cage.front).sub(this.cage.center).setY(0).normalize(), 1.5);
    const d = this.moveTo(spot, BOB.walk, dt);
    if (d < 0.6) { this.lookYaw = Math.sin(this.now * 0.6) * 0.9; return 0; }
    return BOB.walk;
  }

  // ================================================================== chase / grab
  private reachable(p: Pig) {
    const ground = G.terrain.height(p.pos.x, p.pos.z);
    if (p.pos.y - ground > 1.9) return false;
    const n = this.nav.nearestFree(p.pos.x, p.pos.z, 3);
    return !!n && Math.hypot(n.x - p.pos.x, n.z - p.pos.z) < 2.2;
  }

  private chase(dt: number) {
    const t = this.target;
    this.activity = 'CHASING';
    if (!t || t.out || t.cage || (t.heldBy && t.heldBy !== this)) { this.giveUp(); return 0; }
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
      this.go('windup'); this.yell = 0.8;
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
      if (p.out || p.cage || p.heldBy) continue;
      const d = Math.hypot(p.pos.x - hx, (p.pos.y - hy) * 0.6, p.pos.z - hz);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  private pickUp(p: Pig) {
    this.carrying = p; this.target = p;
    p.caughtBy(this);
    ignorePair(this.body, p.body, true);
    G.audio.play('grab', { pos: this.pos, vol: 1, pitch: 0.7 });
    this.voice('ha');
    if (p === G.localPig) { G.audio.play('jingle_caught', { vol: 0.7 }); G.fx.shake(0.35); }
    G.events.push({ type: 'caught', who: p });
    this.chaseRun = 0;
    this.go('carry'); this.path = [];
  }

  /** Pig wriggled free / he got hit: drop it. */
  release(_thrown: boolean) {
    const p = this.carrying; if (!p) return;
    this.carrying = null;
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
    this.activity = 'taking a pig to the BBQ';
    if (!p) { this.backToWork(); return 0; }
    const d = this.moveTo(this.cage.front, BOB.carry, dt);
    if (d < 0.7) {
      this.carrying = null;
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

  private holdCarried(dt: number) {
    const p = this.carrying; if (!p) return;
    const f = this.forward;
    const tgt = v1.set(this.pos.x + f.x * 0.62, this.pos.y + 1.22, this.pos.z + f.z * 0.62);
    const pp = p.body.translation();
    const d = v2.set(tgt.x - pp.x, tgt.y - pp.y, tgt.z - pp.z);
    if (d.length() > 3) { p.body.setTranslation(tgt, true); d.set(0, 0, 0); }
    const vv = d.multiplyScalar(18).add(v3.copy(this.vel));
    p.body.setLinvel(vv, true);
    p.body.setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw + Math.PI / 2, Math.PI / 2 + Math.sin(this.now * 14) * 0.25)), true);
    void dt;
  }

  // ================================================================== getting hurt
  /** Pig ram (via Pig.ramStep → knock). */
  knock(dv: THREE.Vector3, _ragdoll: boolean) {
    if ((this.hitBy.get('ram') ?? -10) > this.now - 0.4) return;
    this.hitBy.set('ram', this.now);
    this.hit(BOB.ram, dv);
  }

  private hit(dmg: number, dir: THREE.Vector3) {
    if (this.state === 'down') return;
    const winded = this.state === 'pant' || this.state === 'cough' ? 1.5 : 1;
    this.poise += dmg * winded; this.poiseT = this.now;
    G.audio.play('punch|punch2', { pos: this.pos, vol: 1 });
    this.voice('oof', 0.9);
    G.fx.bits(v1.copy(this.pos).setY(this.pos.y + 1.2), { count: 10, color: 0xfff1a8, speed: 3.5, up: 1.5, life: 0.4, size: 0.14, grow: 0, drag: 3, alpha: 1 });
    G.fx.shake(0.15);
    // knocked back a little
    const len = Math.hypot(dir.x, dir.z) || 1;
    this.vel.x += (dir.x / len) * 2.5; this.vel.z += (dir.z / len) * 2.5;
    // he's mad now: the nearest free pig did it
    let best: Pig | null = null, bd = 12;
    for (const p of this.pigs) {
      if (p.out || p.cage || p.heldBy) continue;
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
    if (kind === 'down') {
      this.setCollider(true);
      G.audio.play('thud|thud2', { pos: this.pos, vol: 1, pitch: 0.6 });
      G.audio.play('jingle_knock', { vol: 0.6 });
      G.fx.shake(0.4);
      G.events.push({ type: 'knockdown' });
      this.poise = 0;
    }
    if (kind === 'stagger') G.events.push({ type: 'stagger' });   // poise keeps stacking: more hits now = knock-down
    this.doing = false;
    this.go(kind); this.stunUntil = this.now + secs;
  }

  private cough() {
    if (this.state === 'down' || this.state === 'stagger') return;
    this.stun('cough', BOB.cough);
    G.audio.play('cough', { pos: this.pos, vol: 0.9, rand: 0.1 });
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

  private voice(kind: string, vol = 1) {
    G.audio.voice(kind, v1.copy(this.pos).setY(this.pos.y + 1.7), { vol });
    if (kind === 'hey' || kind === 'grr') this.yell = 1;
  }

  // ================================================================== render
  render(alpha: number, dt: number) {
    const r = this.visual.root;
    this.synced.pos(alpha, r.position); r.position.y -= CENTER;
    r.rotation.y = this.yaw;
    const anim = this.animFor();
    this.visual.update({
      speed: Math.hypot(this.vel.x, this.vel.z), run: this.chasing || this.state === 'chase', anim, at: this.now - this.stateT,
      t: this.now, dt, angry: this.chasing || this.state === 'carry' || this.state === 'fist' ? 1 : this.state === 'suspect' ? 0.5 : 0,
      yell: this.yell, lookYaw: this.lookYaw, carrying: !!this.carrying,
    });
    void wrapAngle;
  }

  private animFor(): FarmerAnim {
    if (this.debugAnim) return this.debugAnim;
    switch (this.state) {
      case 'routine': return this.doing ? this.chores[this.choreIdx].anim : 'idle';
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
      default: return 'idle';
    }
  }
}
