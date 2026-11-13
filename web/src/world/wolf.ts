import * as THREE from 'three';
import { RAPIER, world, groups, L, owners, HOOKS, ignorePair } from '../core/physics';
import { Synced } from '../core/synced';
import { G, ADMIN, type Cloud } from '../game/ctx';
import { clamp, dampAngle, Rng } from '../core/util';
import { animalVisual } from './animalGlb';
import type { Nav } from '../farmer/nav';
import type { Rect } from './terrain';
import type { Pig } from '../pig/pig';
import { Grip } from '../core/grip';
import { SCRUFF } from '../pig/pigBody';

const rng = new Rng(777);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
const H = 0.9, R = 0.3;   // capsule height / radius

export const WOLF = { walk: 2.4, run: 5.6, chaseRange: 22, bite: 1.05, escapeNeed: 10, escapeNeedMuddy: 6, fleeTime: 7, max: 3 };

type State = 'enter' | 'prowl' | 'chase' | 'drag' | 'flee' | 'leave' | 'howl' | 'gone';

/**
 * Night wolf: slips under the farm fence, prowls, chases the nearest pig (or hen), bites and drags the pig off the farm.
 * The pig mashes to escape; teammates ram the wolf; a fart or Bob scares it away; at dawn the wolves leave.
 */
export class Wolf {
  kind = 'wolf' as const;
  body: RAPIER.RigidBody;
  synced: Synced;
  visual = animalVisual('wolf');
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  state: State = 'enter';
  stateT = 0;
  active = true;
  /** Online id (host numbers wolves as they come). */
  netId = 0;
  target: Pig | null = null;
  carrying: Pig | null = null;
  /** Jaws: the pig hangs on them by the scruff (a joint) and gets dragged along the ground. */
  private grip = new Grip();
  mass = 35; radius = R; heldBy = null;
  private goal = new THREE.Vector3();
  private path: THREE.Vector3[] = [];
  private pathAt = -10;
  private pathGoal = new THREE.Vector3(1e9, 0, 0);
  private tumbleUntil = 0;
  private usedClouds = new WeakSet<Cloud>();
  private growlT = rng.range(2, 6);

  constructor(private scene: THREE.Scene, at: THREE.Vector3, private nav: Nav, private farm: Rect) {
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y + H / 2 + 0.05, at.z)
      .lockRotations().setCcdEnabled(true).setCanSleep(false));
    const c = world.createCollider(RAPIER.ColliderDesc.capsule(H / 2 - R, R).setMass(this.mass).setFriction(0)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min).setCollisionGroups(groups(L.CRITTER)).setActiveHooks(HOOKS), this.body);
    owners.set(c.handle, this);
    this.synced = new Synced(this.body);
    scene.add(this.visual.root);
    this.pos.copy(at);
    this.yaw = Math.atan2(-at.x, -(at.z + 45));
    G.fx.puff(v1.copy(at).setY(at.y + 0.2), { count: 16, color: 0x8a6a48, speed: 2, up: 1.5, life: 1, size: 0.6, alpha: 0.6 });
    G.audio.play('growl', { pos: at, vol: 1 });
    this.go('enter');
    this.goal.set(at.x * 0.85, 0, -45 + (at.z + 45) * 0.85);
  }

  private go(s: State) { this.state = s; this.stateT = G.time; this.path = []; }
  get now() { return G.time; }

  escapeNeed(p: Pig) { return ADMIN.easyEscape && p === G.localPig ? 1 : p.muddy > 0 ? WOLF.escapeNeedMuddy : WOLF.escapeNeed; }
  /** Pig wriggled free / wolf got hit. */
  release(_thrown: boolean) {
    const p = this.carrying; if (!p) return;
    this.carrying = null;
    this.grip.detach();
    ignorePair(this.body, p.body, false);
    p.heldBy = null;
    p.body.setLinvel({ x: rng.range(-2, 2), y: 5, z: rng.range(-2, 2) }, true);
    p.startRagdoll(null, false);
    G.events.push({ type: 'escaped', who: p });
    this.scare();
  }
  fartedOn() { this.release(false); }

  /** Rammed / punched / hit by Bob. */
  knock(dv: THREE.Vector3) {
    if (this.carrying) this.release(false);
    const lv = this.body.linvel();
    this.body.setLinvel({ x: lv.x + dv.x, y: lv.y + Math.max(dv.y, 3), z: lv.z + dv.z }, true);
    this.tumbleUntil = this.now + 1.2;
    this.body.lockRotations(false, true);
    this.body.setAngvel({ x: rng.range(-6, 6), y: rng.range(-3, 3), z: rng.range(-6, 6) }, true);
    G.audio.play('yelp', { pos: this.pos, vol: 1 });
    this.scare();
  }

  scare() {
    if (this.state === 'leave' || this.state === 'gone') return;
    if (this.state !== 'flee') G.events.push({ type: 'wolfScared' });
    this.target = null;
    this.go('flee');
    this.goal.copy(this.edgePoint(this.pos, 0));
  }

  /** Dawn: run off the farm. */
  leave() { if (this.carrying) this.release(false); if (this.state !== 'gone') { this.target = null; this.go('leave'); this.goal.copy(this.edgePoint(this.pos)); } }

  private edgePoint(p: THREE.Vector3, m = 3.2) {
    const F = this.farm;
    const cand = [[F.x0 + m, p.z], [F.x1 - m, p.z], [p.x, F.z0 + m], [p.x, F.z1 - m]] as const;
    let best = cand[0], bd = 1e9;
    for (const c of cand) { const d = Math.hypot(c[0] - p.x, c[1] - p.z); if (d < bd) { bd = d; best = c; } }
    return new THREE.Vector3(clamp(best[0], F.x0 + m, F.x1 - m), 0, clamp(best[1], F.z0 + m, F.z1 - m));
  }

  private pickTarget(): Pig | null {
    let best: Pig | null = null, bd = WOLF.chaseRange;
    for (const p of G.pigs as Pig[]) {
      if (p.out || p.cage || p.heldBy || (ADMIN.god && p === G.localPig)) continue;
      if (p.pos.y - G.terrain.height(p.pos.x, p.pos.z) > 1.8) continue;          // up on something
      const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  private checkClouds() {
    for (const c of G.clouds) {
      if (this.usedClouds.has(c)) continue;
      if (Math.hypot(c.x - this.pos.x, c.y - this.pos.y - 0.4, c.z - this.pos.z) < c.r) {
        this.usedClouds.add(c);
        if (this.carrying) this.release(false); else this.scare();
        G.audio.play('yelp', { pos: this.pos, vol: 0.8 });
        return;
      }
    }
  }

  preStep(dt: number) {
    this.synced.beforeStep();
    if (!this.active) return;
    const p = this.body.translation(); this.pos.set(p.x, p.y - H / 2, p.z);
    const lv = this.body.linvel(); this.vel.set(lv.x, lv.y, lv.z);
    if (p.y < -20) { this.despawn(); return; }
    if (this.now < this.tumbleUntil) return;
    if (this.tumbleUntil) {
      this.tumbleUntil = 0; this.body.lockRotations(true, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.checkClouds();
    let speed = 0;
    const sinceT = this.now - this.stateT;
    switch (this.state) {
      case 'enter':
        speed = WOLF.walk;
        if (this.moveTo(this.goal) < 1.5 || sinceT > 6) this.go('prowl');
        break;
      case 'prowl': {
        speed = WOLF.walk;
        const t = this.pickTarget();
        if (t && sinceT > 1) { this.target = t; this.go('chase'); G.audio.play('growl', { pos: this.pos, vol: 1 }); break; }
        if (this.moveTo(this.goal) < 1.5 || sinceT > 9) {
          if (rng.next() < 0.25) { this.go('howl'); G.audio.play('wolf_howl|howl', { pos: this.pos, vol: 1, ref: 10 }); break; }
          this.goal.set(rng.range(this.farm.x0 + 8, this.farm.x1 - 8), 0, rng.range(this.farm.z0 + 8, this.farm.z1 - 8));
          this.stateT = this.now;
        }
        break;
      }
      case 'howl':
        if (sinceT > 2.2) this.go('prowl');
        break;
      case 'chase': {
        const t = this.target;
        if (!t || t.out || t.cage || t.heldBy || (ADMIN.god && t === G.localPig) || sinceT > 18) { this.target = null; this.go('prowl'); break; }
        const d = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
        if (d > WOLF.chaseRange * 1.4) { this.target = null; this.go('prowl'); break; }
        speed = WOLF.run;
        this.goal.copy(t.pos);
        this.moveTo(this.goal, 0.4);
        if (d < WOLF.bite && Math.abs(t.pos.y - this.pos.y - 0.4) < 1.0 && t.mode !== 'held') this.bite(t);
        break;
      }
      case 'drag': {
        const p2 = this.carrying;
        if (!p2) { this.go('prowl'); break; }
        speed = WOLF.walk * 1.15;
        const d = this.moveTo(this.goal);
        if (d < 1.2) { this.takeAway(p2); }
        break;
      }
      case 'flee':
        // scared wolves run for the fence and slip out under it (the pack sends others later). Before this they turned
        // around at the fence and came straight back — next to Bob, who kept shooing them forever (stuck).
        speed = WOLF.run;
        if (this.moveTo(this.goal) < 1.5 || sinceT > WOLF.fleeTime) this.go('leave');
        break;
      case 'leave':
        speed = WOLF.run * 0.8;
        if (this.moveTo(this.goal) < 2.2 || sinceT > 14) this.despawn();
        break;
    }
    // steer
    const tgt = speed > 0 ? this.steer.multiplyScalar(speed) : v1.set(0, 0, 0);
    const k = 1 - Math.exp(-10 * dt);
    this.vel.x += (tgt.x - this.vel.x) * k; this.vel.z += (tgt.z - this.vel.z) * k;
    this.body.setLinvel(this.vel, true);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.3) this.yaw = dampAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), 9, dt);
    this.body.setRotation(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw), true);
    this.holdCarried();
    this.growlT -= dt;
    if (this.growlT < 0) { this.growlT = rng.range(4, 9); if (this.state === 'chase' || this.state === 'prowl') G.audio.play('growl', { pos: this.pos, vol: 0.8 }); }
  }
  private steer = new THREE.Vector3();

  private bite(t: Pig) {
    G.audio.play('bark|growl', { pos: this.pos, vol: 1 });
    G.audio.play('squeal', { pos: t.pos, vol: 1 });
    G.fx.bits(v1.copy(t.pos).setY(t.pos.y + 0.3), { count: 10, color: 0xffe08a, speed: 3, up: 2, life: 0.4, size: 0.12, grow: 0, alpha: 1 });
    this.carrying = t; t.caughtBy(this);
    ignorePair(this.body, t.body, true);
    this.grip.attach(t.body, t.pos, SCRUFF);
    G.shakeFor(t, 0.35);
    G.events.push({ type: 'wolfBit', who: t });
    this.go('drag');
    this.goal.copy(this.edgePoint(this.pos));
  }

  private takeAway(p: Pig) {
    this.carrying = null;
    this.grip.detach();
    ignorePair(this.body, p.body, false);
    p.heldBy = null;
    p.takenByWolf();
    G.events.push({ type: 'lostToWolf', who: p });
    this.go('flee'); this.goal.copy(this.edgePoint(this.pos));
  }

  private holdCarried() {
    const p = this.carrying; if (!p) return;
    const f = v2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const tgt = v1.set(this.pos.x + f.x * 0.75, this.pos.y + 0.5 + Math.sin(this.now * 12) * 0.06, this.pos.z + f.z * 0.75);
    // jaws are strong sideways but can't lift a pig: it's dragged, kicking, along the ground
    this.grip.drive(tgt, this.body, p.mass + 6, 1 / 60, { up: 22 * 20, side: 2600, kp: 14, react: 0, g: 20 });
    if (this.grip.strain > 2.5) { p.body.setTranslation({ x: tgt.x, y: tgt.y, z: tgt.z }, true); p.body.setLinvel(this.vel, true); this.grip.attach(p.body, p.pos, SCRUFF); }
  }

  private moveTo(goal: THREE.Vector3, replan = 3) {
    const dist = Math.hypot(goal.x - this.pos.x, goal.z - this.pos.z);
    if (!this.path.length || Math.hypot(goal.x - this.pathGoal.x, goal.z - this.pathGoal.z) > 1.5 || this.now - this.pathAt > replan) {
      this.path = this.nav.los(this.pos.x, this.pos.z, goal.x, goal.z) ? [goal.clone()] : (this.nav.path(this.pos, goal) ?? [goal.clone()]);
      this.pathGoal.copy(goal); this.pathAt = this.now;
    }
    let wp = this.path[0];
    while (wp && this.path.length > 1 && Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z) < 0.7) { this.path.shift(); wp = this.path[0]; }
    if (!wp) { this.steer.set(0, 0, 0); return dist; }
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
    this.steer.set(dx / d, 0, dz / d);
    return dist;
  }

  despawn() {
    if (this.carrying) this.release(false);
    G.fx.puff(v1.copy(this.pos).setY(this.pos.y + 0.3), { count: 14, color: 0x8a6a48, speed: 2, up: 1.5, life: 1, size: 0.6, alpha: 0.6 });
    this.active = false; this.state = 'gone';
    this.body.setEnabled(false);
    this.scene.remove(this.visual.root);
    // free the physics bodies (a night spawns many wolves: disabled bodies used to pile up in the world)
    const w = this;
    queueMicrotask(() => {
      for (let i = 0; i < w.body.numColliders(); i++) owners.delete(w.body.collider(i).handle);
      world.removeRigidBody(w.body);
      w.grip.dispose();
    });
  }

  postStep() { this.synced.capture(); }

  netState(n: number[], s: string[]) {
    n.push(this.vel.x, this.vel.y, this.vel.z, this.tumbleUntil, this.carrying ? G.pigs.indexOf(this.carrying) : -1);
    s.push(this.state);
  }
  netApply(n: number[], s: string[]) {
    this.vel.set(n[0], n[1], n[2]); this.tumbleUntil = n[3]; this.carrying = n[4] >= 0 ? G.pigs[n[4]] : null;
    this.state = s[0] as State;
  }

  render(alpha: number, dt: number) {
    if (!this.active) return;
    const r = this.visual.root;
    this.synced.pos(alpha, r.position); r.position.y -= H / 2;
    this.synced.rot(alpha, r.quaternion);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const mode = this.now < this.tumbleUntil ? 'tumble' : this.state === 'howl' ? 'howl' : this.carrying ? 'bite' : sp > 0.2 ? 'move' : 'idle';
    this.visual.update({ speed: sp, run: sp > WOLF.walk * 1.3, t: this.now, dt, mode, excite: 0 });
  }
}

/** Spawns wolves at night, sends them home at dawn. */
export class WolfPack {
  wolves: Wolf[] = [];
  private nextSpawn = 0;
  private nextId = 1;
  constructor(private scene: THREE.Scene, private nav: Nav, private farm: Rect) {}

  /** Online players: a wolf the host told us about. */
  spawnAt(at: THREE.Vector3, id: number) {
    const w = new Wolf(this.scene, at, this.nav, this.farm);
    w.netId = id; w.body.setEnabled(false);
    this.wolves.push(w); G.wolves = this.wolves;
    return w;
  }

  spawn() {
    const F = this.farm, m = 3.4;
    const side = rng.int(0, 2);   // west, east or north (the south has the road + gate)
    const x = side === 0 ? F.x0 + m : side === 1 ? F.x1 - m : rng.range(F.x0 + 10, F.x1 - 10);
    const z = side === 2 ? F.z0 + m : rng.range(F.z0 + 10, F.z1 - 25);
    const n = this.nav.nearestFree(x, z, 6);
    const at = new THREE.Vector3(n?.x ?? x, 0, n?.z ?? z); at.y = G.terrain.height(at.x, at.z);
    const w = new Wolf(this.scene, at, this.nav, this.farm);
    w.netId = this.nextId++; if (this.nextId > 60000) this.nextId = 1;
    this.wolves.push(w); G.wolves = this.wolves;
    if (this.wolves.filter((k) => k.active).length === 1) G.events.push({ type: 'wolves' });
  }
  clear() { for (const w of this.wolves) if (w.active) w.despawn(); this.cleanup(); }
  private cleanup() { this.wolves = this.wolves.filter((w) => w.active); G.wolves = this.wolves; }

  update() {
    const h = G.hour, night = h >= 21 || h < 4.3;
    const active = this.wolves.filter((w) => w.active);
    if (night && G.time > this.nextSpawn && active.length < Math.min(WOLF.max, 1 + G.pigs.length / 2)) {
      this.nextSpawn = G.time + rng.range(20, 45);
      this.spawn();
    }
    if (!night && h < 12) for (const w of active) if (w.state !== 'leave' && w.state !== 'flee') w.leave();
    if (this.wolves.length !== active.length) this.cleanup();
  }
}
