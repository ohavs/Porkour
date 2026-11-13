import * as THREE from 'three';
import { rigidSkin } from '../render/batch';
import { RAPIER, world, groups, L, owners, HOOKS } from '../core/physics';
import { fitted, sizeOf } from '../core/assets';
import { Synced } from '../core/synced';
import { G, type Holdable } from '../game/ctx';
import { hayBale } from './nature';
import { carrierCode, carrierFrom } from '../net/refs';

export type PropShape = 'box' | 'ball' | 'cyl';
export interface PropDef {
  model?: string; make?: () => THREE.Object3D; height?: number; scale?: number; mass: number; shape?: PropShape;
  sound?: string; label?: string; friction?: number; bounce?: number;
}

/** A loose physics object (crate, barrel, pumpkin…): can be pushed, rammed, grabbed and thrown. */
export class Prop implements Holdable {
  kind = 'prop' as const;
  heldBy: any = null;
  radius: number;
  synced: Synced;
  obj = new THREE.Group();
  lastHit = 0;
  constructor(scene: THREE.Scene, public def: PropDef, at: THREE.Vector3, yaw = 0) {
    const model = def.make ? made(def.make()) : fitted(def.model!, { height: def.height, scale: def.scale });
    const size = sizeOf(model);
    model.position.y = -size.y / 2;
    this.obj.add(model);
    if (def.make) rigidSkin(this.obj);
    scene.add(this.obj);
    const shape = def.shape ?? 'box';
    const q = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y + size.y / 2 + 0.02, at.z)
      .setRotation(q).setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.3));
    let d: RAPIER.ColliderDesc;
    if (shape === 'ball') d = RAPIER.ColliderDesc.ball(Math.max(size.x, size.y, size.z) / 2);
    else if (shape === 'cyl') d = RAPIER.ColliderDesc.cylinder(size.y / 2, Math.max(size.x, size.z) / 2);
    else d = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2);
    d.setMass(def.mass).setFriction(def.friction ?? 0.7).setRestitution(def.bounce ?? 0.15)
      .setCollisionGroups(groups(L.PROP)).setActiveHooks(HOOKS)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(def.mass * 90);
    const c = world.createCollider(d, body);
    owners.set(c.handle, this);
    this.body = body;
    this.mass = def.mass;
    this.radius = Math.max(size.x, size.z) / 2;
    this.label = def.label;
    this.synced = new Synced(body, this.obj);
    G.holdables.push(this);
  }
  body: RAPIER.RigidBody;
  mass: number;
  label?: string;

  netState(n: number[]) { n.push(carrierCode(this.heldBy)); }
  netApply(n: number[]) { if (n.length) this.heldBy = carrierFrom(n[0]); }

  knock(dv: THREE.Vector3) {
    const lv = this.body.linvel();
    this.body.setLinvel({ x: lv.x + dv.x, y: lv.y + dv.y, z: lv.z + dv.z }, true);
    this.body.setAngvel({ x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 10 }, true);
  }

  /** Called from contact force events: clunk. */
  impact(force: number) {
    if (G.time - this.lastHit < 0.12) return;
    this.lastHit = G.time;
    const vol = Math.min(1, force / (this.mass * 600));
    if (vol < 0.08) return;
    const p = this.body.translation();
    G.audio.play(this.def.sound ?? 'wood', { pos: new THREE.Vector3(p.x, p.y, p.z), vol, minGap: 0.03 });
    if (vol > 0.4) G.noise(new THREE.Vector3(p.x, p.y, p.z), 10 * vol);
  }
}

function made(o: THREE.Object3D) {
  const h = new THREE.Group(); h.add(o);
  const b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3());
  o.position.set(-c.x, -b.min.y, -c.z);
  h.userData.size = b.getSize(new THREE.Vector3());
  return h;
}

export const PROPS: Record<string, PropDef> = {
  hay: { make: hayBale, mass: 22, shape: 'box', sound: 'thud', label: 'item.hay', friction: 0.9 },
  crate: { model: 'kit/Prop_Crate', height: 0.8, mass: 12, sound: 'wood', label: 'item.crate' },
  veggieCrate: { model: 'kaykit/crate_carrots', height: 0.55, mass: 9, sound: 'wood', label: 'item.carrots' },
  potatoCrate: { model: 'kaykit/crate_potatoes', height: 0.55, mass: 9, sound: 'wood', label: 'item.potatoes' },
  tomatoCrate: { model: 'kaykit/crate_tomatoes', height: 0.55, mass: 9, sound: 'wood', label: 'item.tomatoes' },
  cheese: { model: 'kaykit/crate_cheese', height: 0.55, mass: 10, sound: 'wood', label: 'item.cheese' },
  ham: { model: 'kaykit/food_ingredient_ham', height: 0.3, mass: 3, shape: 'ball', sound: 'squish', label: 'item.ham' },
  barrel: { model: 'kenney/barrel', height: 0.95, mass: 20, shape: 'cyl', sound: 'wood', label: 'item.barrel' },
  pot: { model: 'kenney/pot_large', height: 0.7, mass: 14, shape: 'cyl', sound: 'metal', label: 'item.pot' },
  pumpkin: { model: 'kenney/crop_pumpkin', height: 0.42, mass: 5, shape: 'ball', sound: 'squish|thud', label: 'item.pumpkin', bounce: 0.3 },
  bigPumpkin: { model: 'kaykit/pumpkin_orange', height: 0.62, mass: 12, shape: 'ball', sound: 'squish|thud', label: 'item.pumpkin', bounce: 0.25 },
  melon: { model: 'kenney/crop_melon', height: 0.35, mass: 4, shape: 'ball', sound: 'squish|thud', label: 'item.melon', bounce: 0.3 },
  log: { model: 'kenney/log', height: 0.4, mass: 16, shape: 'box', sound: 'wood', label: 'item.log' },
  wheel: { model: 'kenney/wheel', height: 0.9, mass: 14, shape: 'box', sound: 'wood', label: 'item.wheel' },
  mug: { model: 'kaykit/mug_full', height: 0.22, mass: 1, shape: 'box', sound: 'metal', label: 'item.mug' },
  sword: { model: 'kaykit/sword_1handed', height: 0.9, mass: 3, shape: 'box', sound: 'metal', label: 'item.sword' },
};
