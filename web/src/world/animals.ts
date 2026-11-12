import * as THREE from 'three';
import { RAPIER, world, groups, L, owners, HOOKS, raycast } from '../core/physics';
import { gltf, instance } from '../core/assets';
import { Synced } from '../core/synced';
import { G, type Holdable } from '../game/ctx';
import { dampAngle, Rng } from '../core/util';

export interface CritterDef { model: string; scale: number; mass: number; speed: number; flee: number; radius: number; height: number; sound?: string }
export const CRITTERS: Record<string, CritterDef> = {
  chick: { model: 'pets/chick', scale: 0.32, mass: 2, speed: 2.2, flee: 4.5, radius: 0.18, height: 0.42 },
  cow: { model: 'pets/cow', scale: 0.95, mass: 300, speed: 1.2, flee: 0, radius: 0.6, height: 1.4 },
  dog: { model: 'pets/dog', scale: 0.55, mass: 16, speed: 2.8, flee: 0, radius: 0.32, height: 0.8 },
  cat: { model: 'pets/cat', scale: 0.4, mass: 4, speed: 2.4, flee: 4, radius: 0.22, height: 0.55 },
  bunny: { model: 'pets/bunny', scale: 0.36, mass: 2, speed: 3, flee: 5, radius: 0.2, height: 0.5 },
};

const rng = new Rng(99);
const v1 = new THREE.Vector3();

/** Farm animal: wanders inside its home area, flees pigs, can be grabbed / thrown (small ones), tumbles when hit. */
export class Critter implements Holdable {
  kind = 'critter' as const;
  heldBy: any = null;
  body: RAPIER.RigidBody;
  mass: number; radius: number;
  synced: Synced;
  root = new THREE.Group();
  private model: THREE.Object3D;
  private mixer?: THREE.AnimationMixer;
  private actions: Record<string, THREE.AnimationAction> = {};
  private current = '';
  private target = new THREE.Vector3();
  private nextThink = 0;
  private yaw = rng.range(0, 6.28);
  private tumbleUntil = 0;
  private vel = new THREE.Vector3();
  label: string;

  constructor(scene: THREE.Scene, public def: CritterDef, at: THREE.Vector3, public home: { x: number; z: number; r: number }) {
    this.model = instance(def.model);
    this.model.scale.setScalar(def.scale);
    this.model.position.y = -def.height / 2;
    this.root.add(this.model);
    scene.add(this.root);
    const g = gltf(def.model);
    if (g?.animations.length) {
      this.mixer = new THREE.AnimationMixer(this.model);
      for (const clip of g.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
      this.play('idle');
      this.mixer.setTime(rng.range(0, 2));
    }
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y + def.height / 2 + 0.05, at.z)
      .lockRotations().setCcdEnabled(true));
    const half = Math.max(0.01, def.height / 2 - def.radius);
    const c = world.createCollider(RAPIER.ColliderDesc.capsule(half, def.radius).setMass(def.mass).setFriction(0)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setCollisionGroups(groups(L.CRITTER)).setActiveHooks(HOOKS), this.body);
    owners.set(c.handle, this);
    this.mass = def.mass; this.radius = def.radius;
    this.label = def.model.split('/')[1];
    this.synced = new Synced(this.body);
    this.target.copy(at);
    if (def.mass <= 40) G.holdables.push(this);
  }

  private play(name: string) {
    if (this.current === name || !this.actions[name]) return;
    const next = this.actions[name];
    next.reset().fadeIn(0.2).play();
    if (this.current) this.actions[this.current].fadeOut(0.2);
    this.current = name;
  }

  onGrabbed() { G.audio.play('pop', { pos: v1.copy(this.synced.currP), vol: 0.6, pitch: 1.6 }); }
  onReleased(_by: any, thrown: boolean) { if (thrown) this.tumble(); }
  knock(dv: THREE.Vector3) {
    const lv = this.body.linvel();
    this.body.setLinvel({ x: lv.x + dv.x, y: lv.y + dv.y, z: lv.z + dv.z }, true);
    this.tumble();
  }
  private tumble() {
    this.tumbleUntil = G.time + 1.6;
    this.body.lockRotations(false, true);
    this.body.setAngvel({ x: rng.range(-8, 8), y: rng.range(-4, 4), z: rng.range(-8, 8) }, true);
  }

  preStep(dt: number) {
    this.synced.beforeStep();
    const p = this.body.translation();
    if (p.y < -20) { this.body.setTranslation({ x: this.home.x, y: 3, z: this.home.z }, true); return; }
    if (this.heldBy) return;
    if (G.time < this.tumbleUntil) return;
    if (this.tumbleUntil > 0) { // get back on the feet
      this.tumbleUntil = 0; this.body.lockRotations(true, true);
      this.body.setRotation(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw), true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    const lv = this.body.linvel(); this.vel.set(lv.x, lv.y, lv.z);
    // flee the nearest pig
    let fleeing = false;
    if (this.def.flee > 0) {
      for (const h of G.holdables) {
        if (h.kind !== 'pig') continue;
        const q = h.body.translation();
        const dx = p.x - q.x, dz = p.z - q.z, d = Math.hypot(dx, dz);
        if (d < this.def.flee) {
          fleeing = true;
          this.target.set(p.x + (dx / d) * 4 + rng.range(-1, 1), p.y, p.z + (dz / d) * 4 + rng.range(-1, 1));
          this.nextThink = G.time + 0.5;
          if (rng.next() < dt * 0.6) G.audio.play('pop', { pos: v1.set(p.x, p.y, p.z), vol: 0.25, pitch: 2 });
          break;
        }
      }
    }
    if (!fleeing && G.time > this.nextThink) {
      const a = rng.range(0, 6.28), r = Math.sqrt(rng.next()) * this.home.r;
      this.target.set(this.home.x + Math.cos(a) * r, p.y, this.home.z + Math.sin(a) * r);
      this.nextThink = G.time + rng.range(2.5, 7);
    }
    const dx = this.target.x - p.x, dz = this.target.z - p.z, d = Math.hypot(dx, dz);
    const speed = d > 0.4 ? (fleeing ? this.def.speed * 1.9 : this.def.speed) : 0;
    const tx = d > 0.01 ? (dx / d) * speed : 0, tz = d > 0.01 ? (dz / d) * speed : 0;
    const grounded = !!raycast(v1.set(p.x, p.y, p.z), new THREE.Vector3(0, -1, 0), this.def.height / 2 + 0.15, L.STATIC, this.body);
    const k = grounded ? 1 - Math.exp(-8 * dt) : 0.02;
    this.vel.x += (tx - this.vel.x) * k; this.vel.z += (tz - this.vel.z) * k;
    if (grounded && fleeing && rng.next() < dt * 0.8 && this.def.mass < 5) this.vel.y = 4; // panic hop
    this.body.setLinvel(this.vel, true);
    if (speed > 0.1) this.yaw = dampAngle(this.yaw, Math.atan2(tx, tz), 6, dt);
    this.body.setRotation(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw), true);
    this.play(speed > this.def.speed * 1.3 ? 'run' : speed > 0.1 ? 'walk' : (rng.next() < 0.002 ? 'eat' : this.current === 'eat' ? 'eat' : 'idle'));
  }

  postStep() { this.synced.capture(); }

  render(alpha: number, dt: number) {
    this.synced.pos(alpha, this.root.position);
    this.synced.rot(alpha, this.root.quaternion);
    this.mixer?.update(dt);
  }
}

/** Static decor animal (no physics): plays an idle animation. */
export function decorAnimal(scene: THREE.Scene, model: string, at: THREE.Vector3, yaw: number, scale: number, clip = 'idle') {
  const m = instance(model); m.scale.setScalar(scale); m.position.copy(at); m.rotation.y = yaw; scene.add(m);
  const g = gltf(model); let mixer: THREE.AnimationMixer | undefined;
  if (g?.animations.length) {
    mixer = new THREE.AnimationMixer(m);
    const c = g.animations.find((a) => a.name === clip) ?? g.animations[0];
    mixer.clipAction(c).play(); mixer.setTime(Math.random() * 3);
  }
  return mixer;
}
