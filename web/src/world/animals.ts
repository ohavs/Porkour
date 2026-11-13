import * as THREE from 'three';
import { RAPIER, world, groups, L, owners, HOOKS, raycast } from '../core/physics';
import { Synced } from '../core/synced';
import { G, type Holdable } from '../game/ctx';
import { dampAngle, Rng } from '../core/util';
import { AnimalVisual, type AnimalKind } from './animalModels';
import { carrierCode, carrierFrom } from '../net/refs';

export interface CritterDef {
  kind: AnimalKind; mass: number; speed: number; flee: number; radius: number; label: string;
  sound?: string; soundEvery?: number; scared?: string;
}
export const CRITTERS: Record<string, CritterDef> = {
  hen: { kind: 'hen', mass: 2.5, speed: 1.6, flee: 4.5, radius: 0.18, label: 'item.hen', sound: 'cluck', soundEvery: 9, scared: 'squawk' },
  chick: { kind: 'chick', mass: 1, speed: 1.4, flee: 3.5, radius: 0.1, label: 'item.chick', sound: 'cluck', soundEvery: 14, scared: 'squawk' },
  cow: { kind: 'cow', mass: 300, speed: 1.0, flee: 0, radius: 0.55, label: 'item.pig', sound: 'moo', soundEvery: 22 },
  dog: { kind: 'dog', mass: 16, speed: 2.6, flee: 0, radius: 0.28, label: 'item.dog', sound: 'bark', soundEvery: 30 },
  cat: { kind: 'cat', mass: 4, speed: 2.2, flee: 4, radius: 0.18, label: 'item.cat', sound: 'meow', soundEvery: 40 },
  bunny: { kind: 'bunny', mass: 2, speed: 2.6, flee: 5, radius: 0.16, label: 'item.bunny' },
  sheep: { kind: 'sheep', mass: 45, speed: 1.1, flee: 3, radius: 0.4, label: 'item.lamb' },
  duck: { kind: 'duck', mass: 2, speed: 1.2, flee: 4, radius: 0.16, label: 'item.duck', sound: 'cluck', soundEvery: 18, scared: 'squawk' },
};

const rng = new Rng(99);
const v1 = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Farm animal: wanders inside its home area, flees pigs and wolves, can be grabbed / thrown (small ones), tumbles when hit.
 * Hens go back to the coop at night; the dog barks at wolves (wakes Bob).
 */
export class Critter implements Holdable {
  kind = 'critter' as const;
  heldBy: any = null;
  body: RAPIER.RigidBody;
  mass: number; radius: number;
  synced: Synced;
  visual: AnimalVisual;
  private target = new THREE.Vector3();
  private nextThink = 0;
  private yaw = rng.range(0, 6.28);
  private tumbleUntil = 0;
  private vel = new THREE.Vector3();
  private eatUntil = 0;
  private soundT = rng.range(2, 20);
  private fleeing = false;
  private excite = 0;
  label: string;
  height: number;
  /** Night roost (hens → coop). */
  roost?: THREE.Vector3;

  constructor(scene: THREE.Scene, public def: CritterDef, at: THREE.Vector3, public home: { x: number; z: number; r: number }) {
    this.visual = new AnimalVisual(def.kind);
    this.height = this.visual.rig.height;
    scene.add(this.visual.root);
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y + this.height / 2 + 0.05, at.z)
      .lockRotations().setCcdEnabled(true));
    const half = Math.max(0.01, this.height / 2 - def.radius);
    const c = world.createCollider(RAPIER.ColliderDesc.capsule(half, def.radius).setMass(def.mass).setFriction(0)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setCollisionGroups(groups(L.CRITTER)).setActiveHooks(HOOKS), this.body);
    owners.set(c.handle, this);
    this.mass = def.mass; this.radius = def.radius;
    this.label = def.label;
    this.synced = new Synced(this.body);
    this.target.copy(at);
    if (def.mass <= 40) G.holdables.push(this);
  }

  get pos() { return this.synced.currP; }

  onGrabbed() {
    G.audio.play(this.def.scared ?? this.def.sound ?? 'squish', { pos: v1.copy(this.synced.currP), vol: 0.7, minGap: 0.3 });
    this.body.lockRotations(false, true);   // dangles from the grip
  }
  onReleased(_by: any, thrown: boolean) { if (thrown) this.tumble(); else this.tumble(0.7, 2); }
  knock(dv: THREE.Vector3) {
    const lv = this.body.linvel();
    this.body.setLinvel({ x: lv.x + dv.x, y: lv.y + dv.y, z: lv.z + dv.z }, true);
    this.tumble();
    if (this.def.scared) G.audio.play(this.def.scared, { pos: v1.copy(this.synced.currP), vol: 0.8, minGap: 0.3 });
  }
  private tumble(dur = 1.6, spin = 8) {
    this.tumbleUntil = G.time + dur;
    this.body.lockRotations(false, true);
    this.body.setAngvel({ x: rng.range(-spin, spin), y: rng.range(-spin / 2, spin / 2), z: rng.range(-spin, spin) }, true);
  }

  /** Is something scary near? Returns the thing to flee from. */
  private threat(p: { x: number; z: number }): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null, bd = 1e9;
    if (this.def.flee > 0) for (const pig of G.pigs) {
      if (pig.out) continue;
      const d = Math.hypot(p.x - pig.pos.x, p.z - pig.pos.z);
      if (d < this.def.flee && d < bd) { bd = d; best = pig.pos; }
    }
    for (const w of G.wolves) {
      if (!w.active) continue;
      const d = Math.hypot(p.x - w.pos.x, p.z - w.pos.z);
      const r = this.def.kind === 'dog' ? 0 : this.def.kind === 'cow' ? 5 : 9;
      if (d < r && d < bd) { bd = d; best = w.pos; }
    }
    return best;
  }

  preStep(dt: number) {
    this.synced.beforeStep();
    const p = this.body.translation();
    if (p.y < -20) { this.body.setTranslation({ x: this.home.x, y: 3, z: this.home.z }, true); return; }
    if (this.heldBy) return;
    if (G.time < this.tumbleUntil) return;
    if (this.tumbleUntil > 0) { // back on the feet
      this.tumbleUntil = 0; this.body.lockRotations(true, true);
      this.body.setRotation(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw), true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    const lv = this.body.linvel(); this.vel.set(lv.x, lv.y, lv.z);
    const th = this.threat(p);
    this.fleeing = !!th;
    if (th) {
      const dx = p.x - th.x, dz = p.z - th.z, d = Math.hypot(dx, dz) || 1;
      this.target.set(p.x + (dx / d) * 4 + rng.range(-1, 1), p.y, p.z + (dz / d) * 4 + rng.range(-1, 1));
      this.nextThink = G.time + 0.5; this.eatUntil = 0;
      if (this.def.scared && rng.next() < dt * 0.7) G.audio.play(this.def.scared, { pos: v1.set(p.x, p.y, p.z), vol: 0.45, minGap: 0.6 });
    }
    // dog: barks at wolves (wakes Bob up) and gets excited near pigs
    if (this.def.kind === 'dog') {
      this.excite = Math.max(0, this.excite - dt);
      for (const w of G.wolves) if (w.active && Math.hypot(p.x - w.pos.x, p.z - w.pos.z) < 16) {
        if (rng.next() < dt * 1.5) { G.audio.play('bark', { pos: v1.set(p.x, p.y, p.z), vol: 1, minGap: 0.4 }); G.noise(v1, 40); }
        this.excite = 1; this.target.set(w.pos.x, p.y, w.pos.z); this.nextThink = G.time + 0.5;
      }
    }
    const night = G.night > 0.6 && this.roost;
    if (!this.fleeing && G.time > this.nextThink) {
      if (night) { this.target.copy(this.roost!).add(v1.set(rng.range(-0.8, 0.8), 0, rng.range(-0.8, 0.8))); this.nextThink = G.time + 6; }
      else {
        const a = rng.range(0, 6.28), r = Math.sqrt(rng.next()) * this.home.r;
        this.target.set(this.home.x + Math.cos(a) * r, p.y, this.home.z + Math.sin(a) * r);
        this.nextThink = G.time + rng.range(2.5, 7);
        if (rng.next() < 0.35) { this.eatUntil = G.time + rng.range(2, 4); this.target.set(p.x, p.y, p.z); }
      }
    }
    const dx = this.target.x - p.x, dz = this.target.z - p.z, d = Math.hypot(dx, dz);
    const speed = d > 0.4 && G.time > this.eatUntil ? (this.fleeing ? this.def.speed * 2 : this.def.speed * (this.excite > 0 ? 2 : 1)) : 0;
    const tx = d > 0.01 ? (dx / d) * speed : 0, tz = d > 0.01 ? (dz / d) * speed : 0;
    const grounded = !!raycast(v1.set(p.x, p.y, p.z), DOWN, this.height / 2 + 0.15, L.STATIC, this.body);
    const k = grounded ? 1 - Math.exp(-8 * dt) : 0.02;
    this.vel.x += (tx - this.vel.x) * k; this.vel.z += (tz - this.vel.z) * k;
    if (grounded && this.fleeing && rng.next() < dt * 0.8 && this.def.mass < 5) this.vel.y = 4;   // panic hop
    if (grounded && this.def.kind === 'bunny' && speed > 0.1 && rng.next() < dt * 2) this.vel.y = 3; // bunny hops
    this.body.setLinvel(this.vel, true);
    if (speed > 0.1) this.yaw = dampAngle(this.yaw, Math.atan2(tx, tz), 6, dt);
    this.body.setRotation(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw), true);
    // idle calls
    this.soundT -= dt;
    if (this.soundT <= 0 && this.def.sound) {
      this.soundT = (this.def.soundEvery ?? 20) * rng.range(0.6, 1.6);
      if (!(night && this.def.kind !== 'cow')) G.audio.play(this.def.sound, { pos: v1.set(p.x, p.y, p.z), vol: this.def.kind === 'cow' ? 0.8 : 0.5, rand: 0.1 });
    }
  }

  postStep() { this.synced.capture(); }

  netState(n: number[]) {
    n.push(this.vel.x, this.vel.y, this.vel.z, this.tumbleUntil, this.eatUntil, this.fleeing ? 1 : 0, this.excite, carrierCode(this.heldBy));
  }
  netApply(n: number[]) {
    if (!n.length) return;
    this.vel.set(n[0], n[1], n[2]); this.tumbleUntil = n[3]; this.eatUntil = n[4]; this.fleeing = n[5] === 1; this.excite = n[6];
    this.heldBy = carrierFrom(n[7]);
  }

  render(alpha: number, dt: number) {
    const r = this.visual.root;
    this.synced.pos(alpha, r.position);
    this.synced.rot(alpha, r.quaternion);
    r.position.sub(v1.set(0, this.height / 2, 0).applyQuaternion(r.quaternion));   // feet below the centre, also when tumbling / dangling
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const mode = this.heldBy ? 'held' : G.time < this.tumbleUntil ? 'tumble' : G.time < this.eatUntil ? 'eat' : sp > 0.15 ? 'move' : 'idle';
    this.visual.update({ speed: sp, run: this.fleeing || sp > this.def.speed * 1.4, t: G.time, dt, mode, excite: this.excite });
  }
}

/** Static decor animal (no physics): idles, looks around, eats. */
export class DecorAnimal {
  visual: AnimalVisual;
  private eatT = rng.range(0, 5);
  constructor(scene: THREE.Scene, kind: AnimalKind, at: THREE.Vector3, yaw: number, scale = 1) {
    this.visual = new AnimalVisual(kind);
    this.visual.root.position.copy(at); this.visual.root.rotation.y = yaw; this.visual.root.scale.setScalar(scale);
    scene.add(this.visual.root);
  }
  render(dt: number) {
    this.eatT -= dt;
    const eat = this.eatT < 0 && this.eatT > -3;
    if (this.eatT < -3) this.eatT = rng.range(3, 9);
    this.visual.update({ speed: 0, run: false, t: G.time, dt, mode: eat ? 'eat' : 'idle', excite: 0 });
  }
}
