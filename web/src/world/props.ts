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
  /** Loot value in coins when it is dropped in the pigs' stash (M5). */
  value?: number;
  /** Melee weapon (standing pig, click): poise damage on Bob; breaks after `breaks` hits on him. */
  weapon?: number; breaks?: number;
}

/** A loose physics object (crate, barrel, pumpkin…): can be pushed, rammed, grabbed and thrown. */
export class Prop implements Holdable {
  kind = 'prop' as const;
  heldBy: any = null;
  radius: number;
  synced: Synced;
  obj = new THREE.Group();
  lastHit = 0;
  /** Dropped in the stash: counted, hidden, out of the world until the next round. */
  banked = false;
  private home: { p: THREE.Vector3; q: THREE.Quaternion };
  get value() { return this.def.value ?? 0; }
  /** Hits a weapon has landed on Bob this round. */
  uses = 0;
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
    this.home = { p: new THREE.Vector3(at.x, at.y + size.y / 2 + 0.02, at.z), q: q.clone() };
    G.holdables.push(this);
  }

  /** Into the stash (host): hidden, no physics, not grabbable. */
  bank() {
    if (this.banked) return;
    this.banked = true;
    this.body.setEnabled(false);
    this.obj.visible = false;
    const i = G.holdables.indexOf(this); if (i >= 0) G.holdables.splice(i, 1);
  }
  /** How far it is from where it belongs (Bob tidies stolen loot back). */
  homeDist() { const p = this.body.translation(); return Math.hypot(p.x - this.home.p.x, p.z - this.home.p.z); }
  get homePos() { return this.home.p; }
  /** Bob puts it back neatly. */
  putHome() {
    this.body.setTranslation(this.home.p, true); this.body.setRotation(this.home.q, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  /** New round: back where it started. */
  reset() {
    this.uses = 0;
    if (this.banked) { this.banked = false; this.body.setEnabled(true); this.obj.visible = true; if (!G.holdables.includes(this)) G.holdables.push(this); }
    this.body.setTranslation(this.home.p, true); this.body.setRotation(this.home.q, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.synced.capture(); this.synced.capture();
  }
  body: RAPIER.RigidBody;
  mass: number;
  label?: string;

  netState(n: number[]) { n.push(carrierCode(this.heldBy), this.banked ? 1 : 0); }
  netApply(n: number[]) {
    if (!n.length) return;
    this.heldBy = carrierFrom(n[0]);
    const b = n[1] === 1;
    if (b !== this.banked) { this.banked = b; this.obj.visible = !b; const i = G.holdables.indexOf(this); if (b && i >= 0) G.holdables.splice(i, 1); else if (!b && i < 0) G.holdables.push(this); }
  }

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
  hay: { make: hayBale, mass: 22, shape: 'box', sound: 'thud', label: 'item.hay', friction: 0.9, value: 10 },
  crate: { model: 'kit/Prop_Crate', height: 0.8, mass: 12, sound: 'wood', label: 'item.crate', value: 20 },
  veggieCrate: { model: 'kaykit/crate_carrots', height: 0.55, mass: 9, sound: 'wood', label: 'item.carrots', value: 30 },
  potatoCrate: { model: 'kaykit/crate_potatoes', height: 0.55, mass: 9, sound: 'wood', label: 'item.potatoes', value: 30 },
  tomatoCrate: { model: 'kaykit/crate_tomatoes', height: 0.55, mass: 9, sound: 'wood', label: 'item.tomatoes', value: 30 },
  cheese: { model: 'kaykit/crate_cheese', height: 0.55, mass: 10, sound: 'wood', label: 'item.cheese', value: 60 },
  ham: { model: 'kaykit/food_ingredient_ham', height: 0.3, mass: 3, shape: 'ball', sound: 'squish', label: 'item.ham', value: 40 },
  barrel: { model: 'kenney/barrel', height: 0.95, mass: 20, shape: 'cyl', sound: 'wood', label: 'item.barrel', value: 20 },
  pot: { model: 'kenney/pot_large', height: 0.7, mass: 14, shape: 'cyl', sound: 'metal', label: 'item.pot', value: 30 },
  pumpkin: { model: 'kenney/crop_pumpkin', height: 0.42, mass: 5, shape: 'ball', sound: 'squish|thud', label: 'item.pumpkin', bounce: 0.3, value: 15 },
  bigPumpkin: { model: 'kaykit/pumpkin_orange', height: 0.62, mass: 12, shape: 'ball', sound: 'squish|thud', label: 'item.pumpkin', bounce: 0.25, value: 35 },
  melon: { model: 'kenney/crop_melon', height: 0.35, mass: 4, shape: 'ball', sound: 'squish|thud', label: 'item.melon', bounce: 0.3, value: 20 },
  log: { model: 'kenney/log', height: 0.4, mass: 16, shape: 'box', sound: 'wood', label: 'item.log', value: 5 },
  wheel: { model: 'kenney/wheel', height: 0.9, mass: 14, shape: 'box', sound: 'wood', label: 'item.wheel', value: 25 },
  mug: { model: 'kaykit/mug_full', height: 0.22, mass: 1, shape: 'box', sound: 'metal', label: 'item.mug', value: 15 },
  sword: { model: 'kaykit/sword_1handed', height: 0.9, mass: 3, shape: 'box', sound: 'metal', label: 'item.sword', value: 60, weapon: 60, breaks: 3 },
  axe: { model: 'kaykit/axe_1handed', height: 0.75, mass: 3, shape: 'box', sound: 'metal', label: 'item.axe', value: 25, weapon: 58, breaks: 3 },
  // valuables (Quaternius RPG Items / Survival, CC0)
  gold: { model: 'loot/Gold_Ingots', height: 0.32, mass: 28, sound: 'metal', label: 'item.gold', value: 150 },
  chest: { model: 'loot/Chest_Closed', height: 0.6, mass: 36, sound: 'wood', label: 'item.chest', value: 250 },
  crown: { model: 'loot/Crown', height: 0.22, mass: 2, sound: 'metal', label: 'item.crown', value: 120, bounce: 0.3 },
  chalice: { model: 'loot/Chalice', height: 0.3, mass: 2, shape: 'cyl', sound: 'metal', label: 'item.chalice', value: 70 },
  necklace: { model: 'loot/Necklace1', height: 0.12, mass: 1, sound: 'metal', label: 'item.necklace', value: 60 },
  radio: { model: 'loot/Radio', height: 0.32, mass: 4, sound: 'metal', label: 'item.radio', value: 45 },
  phone: { model: 'loot/Phone', height: 0.2, mass: 1, sound: 'metal', label: 'item.phone', value: 90 },
  gasCan: { model: 'loot/GasCan', height: 0.45, mass: 8, sound: 'metal', label: 'item.gasCan', value: 35 },
  pan: { model: 'loot/Pan', height: 0.12, mass: 2, sound: 'metal', label: 'item.pan', value: 30, weapon: 50, breaks: 4 },
  propane: { model: 'loot/PropaneTank', height: 0.7, mass: 18, shape: 'cyl', sound: 'metal', label: 'item.propane', value: 40 },
  firstAid: { model: 'loot/FirstAidKit', height: 0.25, mass: 2, sound: 'thud', label: 'item.firstAid', value: 25 },
  backpack: { model: 'loot/Backpack', height: 0.5, mass: 4, sound: 'thud', label: 'item.backpack', value: 30 },
  shovel: { model: 'loot/Shovel', height: 1.1, mass: 3, sound: 'metal', label: 'item.shovel', value: 20, weapon: 55, breaks: 3 },
  trashcan: { model: 'loot/Trashcan', height: 0.8, mass: 9, shape: 'cyl', sound: 'metal', label: 'item.trashcan', value: 10 },
};
export const LOOT_MODELS = Object.values(PROPS).map((d) => d.model).filter((m): m is string => !!m && m.startsWith('loot/'));
