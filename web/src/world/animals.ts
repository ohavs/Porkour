import * as THREE from 'three';
import { RAPIER, world, groups, L, owners, HOOKS, raycast, SEE_THROUGH } from '../core/physics';
import { Synced } from '../core/synced';
import { Ragdoll, type LimbDef, type Tone } from '../core/ragdoll';
import type { AnimalRig } from './animalModels';
import { G, ADMIN, type Holdable } from '../game/ctx';
import { dampAngle, Rng } from '../core/util';
import { type AnimalKind } from './animalModels';
import { animalVisual, GlbAnimalVisual, type AnyAnimalVisual } from './animalGlb';
import { carrierCode, carrierFrom } from '../net/refs';

export interface CritterDef {
  kind: AnimalKind; mass: number; speed: number; flee: number; radius: number; label: string;
  sound?: string; soundEvery?: number; scared?: string;
  /** Alarm bird: gives pigs away to Bob (rooster crows, turkeys gobble + chase + peck). */
  alarm?: 'rooster' | 'turkey';
}
export const CRITTERS: Record<string, CritterDef> = {
  hen: { kind: 'hen', mass: 2.5, speed: 1.6, flee: 4.5, radius: 0.18, label: 'item.hen', sound: 'cluck', soundEvery: 9, scared: 'squawk' },
  chick: { kind: 'chick', mass: 1, speed: 1.4, flee: 3.5, radius: 0.1, label: 'item.chick', sound: 'cluck', soundEvery: 14, scared: 'squawk' },
  cow: { kind: 'cow', mass: 300, speed: 1.0, flee: 0, radius: 0.55, label: 'item.pig', sound: 'moo', soundEvery: 22 },
  dog: { kind: 'dog', mass: 16, speed: 2.6, flee: 0, radius: 0.28, label: 'item.dog', sound: 'bark', soundEvery: 30 },
  cat: { kind: 'cat', mass: 4, speed: 2.2, flee: 4, radius: 0.18, label: 'item.cat', sound: 'meow', soundEvery: 40 },
  bunny: { kind: 'bunny', mass: 2, speed: 2.6, flee: 5, radius: 0.16, label: 'item.bunny' },
  sheep: { kind: 'sheep', mass: 45, speed: 1.1, flee: 3, radius: 0.4, label: 'item.lamb', sound: 'baa', soundEvery: 25 },
  horse: { kind: 'horse', mass: 450, speed: 1.3, flee: 0, radius: 0.5, label: 'item.horse', sound: 'neigh', soundEvery: 35 },
  horse2: { kind: 'horse2', mass: 450, speed: 1.3, flee: 0, radius: 0.5, label: 'item.horse', sound: 'neigh', soundEvery: 35 },
  donkey: { kind: 'donkey', mass: 200, speed: 1.0, flee: 0, radius: 0.42, label: 'item.donkey', sound: 'bray', soundEvery: 40 },
  alpaca: { kind: 'alpaca', mass: 70, speed: 1.0, flee: 2.5, radius: 0.36, label: 'item.alpaca', sound: 'llama', soundEvery: 45 },
  rooster: { kind: 'rooster', mass: 3.5, speed: 1.7, flee: 0, radius: 0.24, label: 'item.rooster', sound: 'cluck', soundEvery: 16, scared: 'squawk', alarm: 'rooster' },
  turkey: { kind: 'turkey', mass: 9, speed: 1.3, flee: 0, radius: 0.36, label: 'item.turkey', sound: 'gobble', soundEvery: 24, scared: 'gobble', alarm: 'turkey' },
  duck: { kind: 'duck', mass: 2, speed: 1.2, flee: 4, radius: 0.16, label: 'item.duck', sound: 'cluck', soundEvery: 18, scared: 'squawk' },
};

const rng = new Rng(99);
/** Guard dog off the leash (Bob's alert 2+): the whole farm is its beat. Smell range in the open / into a bush (m). */
const DOG = { patrol: { x: 0, z: -40, r: 46 }, smell: 11, smellHidden: 4, give: 12, skip: 10, chew: 14, boneSee: 14, boneSkip: 45, tipEvery: 3 };
/**
 * Alarm birds (Untitled Goose Game's geese, on Bob's side). Rooster: sees a pig up to no good (holding something,
 * standing, sprinting) within 9 m — or any pig under 3.5 m — and crows: a loud noise right where the pig is, so Bob
 * comes to look (10 s between crows). Turkeys: guard the garden; a pig within 6 m → gobble (noise) and they charge
 * (4.3 m/s, a walking pig just outruns them), peck = a shove and you DROP what you hold; give up after 6 s or 15 m from
 * home. A fart scares any of them off; they can be grabbed and thrown like hens. Asleep at night.
 */
const BIRD = { see: 9, close: 3.5, crowEvery: 10, turkeySee: 6, gobbleEvery: 3.5, chase: 4.3, chaseFor: 6, leash: 15, skip: 8, peckR: 0.85,
  peckEvery: 1.2, crowNoise: 34, gobbleNoise: 22 };
const v1 = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

/** Body parts of an animal (head + legs), measured from its procedural model (root at the feet, facing +z). */
export function animalLimbs(rig: AnimalRig, mass: number): LimbDef[] {
  const box = new THREE.Box3(), size = new THREE.Vector3();
  const hb = box.setFromObject(rig.head).getSize(size), hr = Math.max(0.03, Math.max(hb.x, hb.y, hb.z) * 0.4);
  const hc = rig.head.getWorldPosition(new THREE.Vector3());
  const limbs: LimbDef[] = [{
    joint: hc.clone().add(new THREE.Vector3(0, -hr * 0.4, -hr * 0.9)), center: hc, shape: () => RAPIER.ColliderDesc.ball(hr),
    mass: Math.max(0.1, mass * 0.08), limit: 0.8, flail: { x: 0.35, y: 0.4, z: 0, speed: 9, phase: 0 },
  }];
  rig.legs.forEach((l, i) => {
    const hip = l.getWorldPosition(new THREE.Vector3()), len = Math.max(0.04, hip.y);
    const lr = Math.max(0.015, Math.min(0.12, box.setFromObject(l).getSize(size).x * 0.4));
    limbs.push({ joint: hip, center: hip.clone().setY(hip.y - len / 2), shape: () => RAPIER.ColliderDesc.capsule(Math.max(0.005, len / 2 - lr), lr),
      mass: Math.max(0.05, mass * 0.03), limit: 1.3, flail: { x: 1, y: 0, z: hip.x > 0 ? 0.3 : -0.3, speed: 18, phase: i * 1.9 } });
  });
  return limbs;
}

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
  visual: AnyAnimalVisual;
  /** Head + legs as real bodies: limp (flailing) when tumbling or dangling from a grip. */
  parts: Ragdoll;
  private relQ: THREE.Quaternion[];
  private target = new THREE.Vector3();
  private nextThink = 0;
  private yaw = rng.range(0, 6.28);
  private tumbleUntil = 0;
  private vel = new THREE.Vector3();
  private eatUntil = 0;
  private soundT = rng.range(2, 20);
  private fleeing = false;
  private excite = 0;
  // guard dog: chewing a bone until, bones it's done with, the pig it's onto (since), pigs it gave up on, bark / tip-off clocks
  private chewUntil = 0; private chewing: Holdable | null = null; private boneSkip = new WeakMap<object, number>(); private bones: Holdable[] | null = null;
  private sniffAt = 0; private sniffPig: any = null; private sniffSince = 0; private pigSkip = new Map<unknown, number>();
  private barkAt = 0; private tipAt = 0; private scaredUntil = 0; private scaredFrom = new THREE.Vector3();
  // alarm birds: next call, the pig a turkey is chasing (since), next peck
  private callAt = 0; private chasePig: any = null; private chaseSince = 0; private peckAt = 0; private scanAt = 0;
  label: string;
  height: number;
  /** Night roost (hens → coop). */
  roost?: THREE.Vector3;

  constructor(scene: THREE.Scene, public def: CritterDef, at: THREE.Vector3, public home: { x: number; z: number; r: number }) {
    this.visual = animalVisual(def.kind);
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
    this.visual.root.updateMatrixWorld(true);
    const limbs = this.visual instanceof GlbAnimalVisual ? this.visual.limbs(def.mass) : animalLimbs(this.visual.rig, def.mass), hh = this.height / 2;
    this.parts = new Ragdoll(this.body, limbs, at, (i, anchor, rest) => { anchor.copy(limbs[i].joint).setY(limbs[i].joint.y - hh); rest.identity(); });
    this.relQ = limbs.map(() => new THREE.Quaternion());
    // goofy: floppy when tumbling, flails wildly when held
    this.parts.toneK.ragdoll = 0.03; this.parts.flailK.ragdoll = 0.8; this.parts.flailK.carried = 1.3;
    this.target.copy(at);
    this.spawnAt = at.clone();
    if (def.mass <= 40) G.holdables.push(this);
  }
  private spawnAt: THREE.Vector3;
  /** New round: back home on its feet. */
  reset() {
    if (this.heldBy) this.heldBy.release?.(false);
    const a = this.spawnAt;
    this.body.setTranslation({ x: a.x, y: a.y + this.height / 2 + 0.05, z: a.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.tumbleUntil = 0; this.body.lockRotations(true, true); this.vel.set(0, 0, 0); this.target.copy(a);
    this.parts.snap(); this.synced.capture(); this.synced.capture();
    this.sniffPig = null; this.chewUntil = 0; this.chewing = null; this.scaredUntil = 0; this.sicUntil = 0; this.pigSkip.clear();
    this.chasePig = null; this.callAt = 0; this.excite = 0;
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
  private tumble(dur = 2.2, spin = 9) {
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
      const big = this.def.mass > 150;
      const r = this.def.kind === 'dog' ? 0 : big ? 5 : 9;
      if (d < r && d < bd) { bd = d; best = w.pos; }
    }
    return best;
  }

  preStep(dt: number) {
    this.control(dt);
    const tone: Tone = this.heldBy ? 'carried' : G.time < this.tumbleUntil ? 'ragdoll' : 'active';
    this.parts.setTone(tone); this.parts.step(G.time);
  }
  private control(dt: number) {
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
    // dog: barks at wolves (wakes Bob up); loves bones; Bob's guard dog when he's on alert
    if (this.def.kind === 'dog') {
      this.excite = Math.max(0, this.excite - dt);
      let busy = false;
      for (const w of G.wolves) if (w.active && Math.hypot(p.x - w.pos.x, p.z - w.pos.z) < 16) {
        if (rng.next() < dt * 1.5) { G.audio.play('bark', { pos: v1.set(p.x, p.y, p.z), vol: 1, minGap: 0.4 }); G.noise(v1, 40); }
        this.excite = 1; this.target.set(w.pos.x, p.y, w.pos.z); this.nextThink = G.time + 0.5; busy = true;
      }
      if (!busy) this.dogBrain(p, dt);
    }
    if (this.def.alarm && !this.fleeing) this.birdBrain(p, dt);
    const night = G.night > 0.6 && this.roost;
    if (!this.fleeing && G.time > this.nextThink) {
      if (night) { this.target.copy(this.roost!).add(v1.set(rng.range(-0.8, 0.8), 0, rng.range(-0.8, 0.8))); this.nextThink = G.time + 6; }
      else {
        const home = this.def.kind === 'dog' && ((G.farmer?.level ?? 0) >= 2 || G.farmer?.state === 'away') ? DOG.patrol : this.home;   // off the leash
        const a = rng.range(0, 6.28), r = Math.sqrt(rng.next()) * home.r;
        this.target.set(home.x + Math.cos(a) * r, p.y, home.z + Math.sin(a) * r);
        this.nextThink = G.time + rng.range(2.5, 7);
        if (rng.next() < 0.35) { this.eatUntil = G.time + rng.range(2, 4); this.target.set(p.x, p.y, p.z); }
      }
    }
    const dx = this.target.x - p.x, dz = this.target.z - p.z, d = Math.hypot(dx, dz);
    const speed = d > 0.4 && G.time > this.eatUntil ? (this.fleeing ? this.def.speed * 2 : this.chasePig ? BIRD.chase : this.def.speed * (this.excite > 0 ? 2 : 1)) : 0;
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
      if (!(night && this.def.mass < 150)) G.audio.play(this.def.sound, { pos: v1.set(p.x, p.y, p.z), vol: this.def.mass > 150 ? 0.8 : 0.5, rand: 0.1 });
    }
  }

  /**
   * The dog (host). A fart in its face → runs off yelping. A bone in sight → fetch + chew it for a while (any alert
   * level; a pig carrying a bone is followed like a friend). Bob on alert (2+) → guard dog: sniffs out pigs (11 m in the
   * open, 4 m into a bush, walls block it beyond 4 m), runs at the pig and stands next to it barking, and every few
   * seconds Bob gets told where (he comes to look). Gives up on a pig after 12 s. Sprint away (dog 5.2 m/s, pig 10.5).
   */
  private dogBrain(p: { x: number; y: number; z: number }, dt: number) {
    const now = G.time;
    for (const c of G.clouds) if (Math.hypot(c.x - p.x, c.z - p.z) < c.r + 0.6 && now > this.scaredUntil - 3) {
      this.scaredUntil = now + 5; this.scaredFrom.set(c.x, 0, c.z); this.sniffPig = null;
      G.audio.play('yelp', { pos: v1.set(p.x, p.y, p.z), vol: 0.9, minGap: 0.5 });
    }
    if (now < this.scaredUntil) {
      const dx = p.x - this.scaredFrom.x, dz = p.z - this.scaredFrom.z, d = Math.hypot(dx, dz) || 1;
      this.target.set(p.x + (dx / d) * 5, p.y, p.z + (dz / d) * 5); this.nextThink = now + 0.5; this.fleeing = true;
      return;
    }
    // bones
    if (now < this.chewUntil && this.chewing) {
      const cb = this.chewing.body.translation();
      if (Math.hypot(cb.x - p.x, cb.z - p.z) > 1.4) { this.chewUntil = 0; this.boneSkip.delete(this.chewing); this.chewing = null; }   // a pig took it: follow!
    }
    if (now < this.chewUntil) {
      this.eatUntil = now + 0.4; this.target.set(p.x, p.y, p.z); this.nextThink = now + 0.5;
      if (rng.next() < dt * 0.7) G.audio.play('munch', { pos: v1.set(p.x, p.y, p.z), vol: 0.6, minGap: 0.6 });
      return;
    }
    this.bones ??= G.holdables.filter((h) => (h as { def?: { id?: string } }).def?.id === 'bone');
    let bone: Holdable | null = null, bd = DOG.boneSee;
    for (const b of this.bones) {
      if ((b as { banked?: boolean }).banked || (this.boneSkip.get(b) ?? 0) > now) continue;
      if (!b.heldBy && ((b as { homeDist?: () => number }).homeDist?.() ?? 9) < 1.5) continue;   // only bones a pig brought / threw
      const bp = b.body.translation(), d = Math.hypot(bp.x - p.x, bp.z - p.z);
      if (d < bd) { bd = d; bone = b; }
    }
    if (bone) {
      const bp = bone.body.translation();
      this.excite = 1; this.nextThink = now + 0.5; this.sniffPig = null;
      if (bone.heldBy) { this.target.set(bp.x, p.y, bp.z); if (bd < 1.6) this.target.set(p.x, p.y, p.z); return; }   // follows the pig that has it
      this.target.set(bp.x, p.y, bp.z);
      if (bd < 0.9) {
        this.chewUntil = now + DOG.chew; this.boneSkip.set(bone, now + DOG.boneSkip); this.chewing = bone;
        G.audio.play('munch', { pos: v1.set(p.x, p.y, p.z), vol: 0.9 });
        G.events.push({ type: 'dogBone' });
      }
      return;
    }
    // guard dog
    const bob = G.farmer;
    // on the job at alert 2+, and while Bob is away at the market (he hears about it when he's back)
    if (!bob || ((bob.level ?? 0) < 2 && bob.state !== 'away') || bob.state === 'off') { this.sniffPig = null; return; }
    if (now > this.sniffAt) {
      this.sniffAt = now + 0.3;
      let best: any = null, bdist = 1e9;
      for (const pig of G.pigs) {
        if (pig.out || pig.cage || pig.heldBy?.kind === 'farmer' || (this.pigSkip.get(pig) ?? 0) > now) continue;
        if (pig === G.localPig && (ADMIN.god || !ADMIN.bobSees)) continue;
        const d = Math.hypot(pig.pos.x - p.x, pig.pos.z - p.z);
        if (d > (G.cover.at(pig.pos) ? DOG.smellHidden : DOG.smell) || d > bdist) continue;
        if (d > DOG.smellHidden) {
          const dir = v1.set(pig.pos.x - p.x, pig.pos.y - p.y, pig.pos.z - p.z); const len = dir.length(); dir.divideScalar(len);
          const hit = raycast({ x: p.x, y: p.y + 0.2, z: p.z } as THREE.Vector3, dir, len, L.STATIC, this.body, (c) => !SEE_THROUGH.has(c.handle));
          if (hit && hit.dist < len - 0.5) continue;
        }
        best = pig; bdist = d;
      }
      if (best !== this.sniffPig) {
        if (this.sicUntil > now && this.sniffPig && !best) best = this.sniffPig;   // admin "sniff me": keeps on it
        if (best && this.sniffPig && best !== this.sniffPig) this.pigSkip.set(this.sniffPig, now + 3);
        if (best !== this.sniffPig) this.sniffSince = now;
        this.sniffPig = best;
      }
      if (best && now - this.sniffSince < 0.01) { G.events.push({ type: 'dogFound', who: best }); this.tipAt = now + 1; }
    }
    const pig = this.sniffPig;
    if (!pig) return;
    if (now - this.sniffSince > DOG.give || pig.out || pig.cage) { this.pigSkip.set(pig, now + DOG.skip); this.sniffPig = null; return; }
    const d = Math.hypot(pig.pos.x - p.x, pig.pos.z - p.z);
    this.excite = 1; this.nextThink = now + 0.5;
    if (d > 1.4) this.target.set(pig.pos.x, p.y, pig.pos.z); else this.target.set(p.x, p.y, p.z);
    if (d > 0.5) this.yaw = dampAngle(this.yaw, Math.atan2(pig.pos.x - p.x, pig.pos.z - p.z), 8, dt);
    if (d < 8 && now > this.barkAt) {
      this.barkAt = now + 0.5 + rng.next() * 0.35;
      G.audio.play('bark', { pos: v1.set(p.x, p.y, p.z), vol: 1, minGap: 0.3 });
    }
    if (now > this.tipAt) { this.tipAt = now + DOG.tipEvery; bob.tipOff(pig, pig.pos); }
  }
  /** Rooster / turkeys (host): see the class comment of BIRD. */
  private birdBrain(p: { x: number; y: number; z: number }, dt: number) {
    const now = G.time, turkey = this.def.alarm === 'turkey';
    this.excite = Math.max(0, this.excite - dt * 0.5);
    for (const c of G.clouds) if (Math.hypot(c.x - p.x, c.z - p.z) < c.r + 0.6 && now > this.scaredUntil - 3) {
      this.scaredUntil = now + 5; this.scaredFrom.set(c.x, 0, c.z); this.chasePig = null;
      G.audio.play(this.def.scared ?? 'squawk', { pos: v1.set(p.x, p.y, p.z), vol: 0.9, minGap: 0.5 });
    }
    if (now < this.scaredUntil) {
      const dx = p.x - this.scaredFrom.x, dz = p.z - this.scaredFrom.z, d = Math.hypot(dx, dz) || 1;
      this.target.set(p.x + (dx / d) * 5, p.y, p.z + (dz / d) * 5); this.nextThink = now + 0.5; this.fleeing = true;
      return;
    }
    if (G.night > 0.6) { this.chasePig = null; return; }   // asleep
    // a turkey on a pig: charge, peck, give up when it's gone or too far from home
    const cp = this.chasePig;
    if (cp) {
      const away = Math.hypot(p.x - this.home.x, p.z - this.home.z);
      if (cp.out || cp.cage || cp.heldBy || now - this.chaseSince > BIRD.chaseFor || away > BIRD.leash) {
        this.pigSkip.set(cp, now + BIRD.skip); this.chasePig = null; this.target.set(this.home.x, p.y, this.home.z); this.nextThink = now + 2;
        return;
      }
      const d = Math.hypot(cp.pos.x - p.x, cp.pos.z - p.z);
      this.excite = 1; this.nextThink = now + 0.5; this.eatUntil = 0;
      this.target.set(cp.pos.x, p.y, cp.pos.z);
      if (now > this.callAt) { this.callAt = now + BIRD.gobbleEvery; this.call(cp, BIRD.gobbleNoise, p); }
      if (d < BIRD.peckR + cp.radius && now > this.peckAt) this.peck(cp, p);
      return;
    }
    if (now < this.scanAt) return;
    this.scanAt = now + 0.25;
    let best: any = null, bd = 1e9;
    for (const pig of G.pigs) {
      if (pig.out || pig.cage || pig.heldBy || (this.pigSkip.get(pig) ?? 0) > now) continue;
      if (pig === G.localPig && (ADMIN.god || !ADMIN.bobSees)) continue;
      const d = Math.hypot(pig.pos.x - p.x, pig.pos.z - p.z);
      const up2 = pig.held || pig.standing || pig.sprinting;
      if (d > (turkey ? BIRD.turkeySee : up2 ? BIRD.see : BIRD.close) || d > bd) continue;
      if (G.cover.at(pig.pos) && d > 2) continue;                       // hiding in a bush: they don't spot it
      const dir = v1.set(pig.pos.x - p.x, pig.pos.y + 0.3 - p.y, pig.pos.z - p.z), len = dir.length(); dir.divideScalar(len);
      const hit = raycast({ x: p.x, y: p.y + 0.2, z: p.z } as THREE.Vector3, dir, len, L.STATIC, this.body, (c) => !SEE_THROUGH.has(c.handle));
      if (hit && hit.dist < len - 0.5) continue;
      best = pig; bd = d;
    }
    if (!best || now < this.callAt) return;
    this.yaw = Math.atan2(best.pos.x - p.x, best.pos.z - p.z);
    this.excite = 1;
    if (turkey) { this.chasePig = best; this.chaseSince = now; this.callAt = now + BIRD.gobbleEvery; this.call(best, BIRD.gobbleNoise, p); }
    else {
      this.callAt = now + BIRD.crowEvery; this.call(best, BIRD.crowNoise, p);
      this.eatUntil = now + 2.2; this.target.set(p.x, p.y, p.z);           // stands and crows (flapping)
      const lv = this.body.linvel(); this.body.setLinvel({ x: lv.x, y: 3.2, z: lv.z }, true);
    }
  }
  /** Crow / gobble: loud, right where the pig is (Bob comes to look there). */
  private call(pig: any, radius: number, p: { x: number; y: number; z: number }) {
    const rooster = this.def.alarm === 'rooster';
    G.audio.play(rooster ? 'rooster' : 'gobble', { pos: v1.set(p.x, p.y, p.z), vol: 1, rand: 0.08, minGap: 0.8 });
    G.noise(pig.pos, radius);
    G.events.push({ type: 'birdAlarm', who: pig, text: this.def.alarm });
  }
  private peck(pig: any, p: { x: number; y: number; z: number }) {
    this.peckAt = G.time + BIRD.peckEvery; this.eatUntil = G.time + 0.3;
    const dx = pig.pos.x - p.x, dz = pig.pos.z - p.z, d = Math.hypot(dx, dz) || 1;
    const dropped = !!pig.held;
    if (dropped) pig.release(false);
    pig.knock(v1.set((dx / d) * 3, 2.4, (dz / d) * 3), false);
    G.audio.play('bite', { pos: pig.pos, vol: 0.8, pitch: 1.3 });
    G.audio.play('squeal', { pos: pig.pos, vol: 0.6, minGap: 0.6 });
    G.fx.bits(v1.copy(pig.pos).setY(pig.pos.y + 0.4), { count: 7, color: 0x7d5233, speed: 2.5, up: 2, life: 0.6, size: 0.1, grow: 0, drag: 2, alpha: 1 });
    G.shakeFor(pig, 0.25);
    G.events.push({ type: 'pecked', who: pig, text: dropped ? 'drop' : '' });
  }
  /** Admin: the turkeys come for this pig. */
  sicBird(pig: unknown) {
    if (this.def.alarm === 'turkey') { this.chasePig = pig; this.chaseSince = G.time; this.callAt = 0; this.pigSkip.delete(pig); }
    else { this.callAt = 0; this.scanAt = 0; this.pigSkip.delete(pig); }
  }

  /** Admin: sniff this pig out now. */
  sicEm(pig: unknown) { this.sniffPig = pig; this.sniffSince = G.time; this.sicUntil = G.time + DOG.give; this.pigSkip.delete(pig); this.chewUntil = 0; this.tipAt = G.time + 1; }
  private sicUntil = 0;

  postStep() { this.synced.capture(); }

  netState(n: number[]) {
    n.push(this.vel.x, this.vel.y, this.vel.z, this.tumbleUntil, this.eatUntil, this.fleeing ? 1 : 0, this.excite, carrierCode(this.heldBy));
    this.parts.netState(n);
  }
  netApply(n: number[]) {
    if (!n.length) return;
    this.vel.set(n[0], n[1], n[2]); this.tumbleUntil = n[3]; this.eatUntil = n[4]; this.fleeing = n[5] === 1; this.excite = n[6];
    this.heldBy = carrierFrom(n[7]);
    this.parts.netApply(n, 8);
  }

  render(alpha: number, dt: number) {
    const r = this.visual.root;
    this.synced.pos(alpha, r.position);
    this.synced.rot(alpha, r.quaternion);
    r.position.sub(v1.set(0, this.height / 2, 0).applyQuaternion(r.quaternion));   // feet below the centre, also when tumbling / dangling
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const mode = this.heldBy ? 'held' : G.time < this.tumbleUntil ? 'tumble' : G.time < this.eatUntil ? 'eat' : sp > 0.15 ? 'move' : 'idle';
    const limp = mode === 'held' || mode === 'tumble';
    if (limp) this.relQ.forEach((q, i) => this.parts.rel(i, q, G.net === 'client'));
    this.visual.update({ speed: sp, run: this.fleeing || sp > this.def.speed * 1.4, t: G.time, dt, mode, excite: this.excite, limp, rel: this.relQ });
  }
}

/** Static decor animal (no physics): idles, looks around, eats. */
export class DecorAnimal {
  visual: AnyAnimalVisual;
  private eatT = rng.range(0, 5);
  constructor(scene: THREE.Scene, kind: AnimalKind, at: THREE.Vector3, yaw: number, scale = 1) {
    this.visual = animalVisual(kind);
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
