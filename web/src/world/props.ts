import * as THREE from 'three';
import { rigidSkin } from '../render/batch';
import { RAPIER, world, groups, L, owners, HOOKS } from '../core/physics';
import { fitted, sizeOf } from '../core/assets';
import { Synced } from '../core/synced';
import { G, type Holdable } from '../game/ctx';
import { hayBale } from './nature';
import { carrierCode, carrierFrom } from '../net/refs';
import { HANDS } from './hands';
import { makeEgg, makeGnome, makeUndies, makePie, makeFlowerPot, makeApple, makeHoneyJar, makeHoneyPot, makeCiderJug, makeMilkChurn, makeCheeseWheel, makeRedRag, makeGiantPumpkin,
  makeSnowball, makeSnowBoulder, makePresent, makeSnowmanBall, makeFishBucket, makeSafe, makeTV, makeClock, makeCoffeeMug, makeHotSauce, makePotato } from './funProps';
import { makeBud, makeWeedBag, makeJoint, makeLighter, makeWateringCan, makeSeedBag, makeSickle, makeButter, makeSack, makeTray, makeWheelbarrow,
  makeHops, makeSheaf, makeBeerBarrel, makePaper, makeFilter, makeCookPot, makeMixBowl, makeEmptyTray, makeMugFill, makeCoin, makePlug, makeHandset } from './chainProps';

/** 'wheel' = a cylinder lying along x (rolls along z): cheese wheels. */
export type PropShape = 'box' | 'ball' | 'cyl' | 'wheel';
export interface PropDef {
  model?: string; make?: () => THREE.Object3D; height?: number; scale?: number; mass: number; shape?: PropShape;
  sound?: string; label?: string; friction?: number; bounce?: number;
  /** Loot value in coins when it is dropped in the pigs' stash (M5). */
  value?: number;
  /** Melee weapon (click): poise damage on Bob; breaks after `breaks` hits on him. */
  weapon?: number; breaks?: number;
  /** Breakable: smashes when it hits something faster than this (m/s), or gets punched / headbutted. `bits` = shard colour. */
  fragile?: number; bits?: number;
  /** Sound when it smashes (default wood / thud). */
  smashSound?: string;
  /** Ball radius override (a squat pumpkin: smaller than its widest side) and angular damping (rolls to a stop). */
  r?: number; damp?: number;
  /** Key in PROPS (filled in below). */
  id?: string;
  /** Snacks (world/snacks.ts): a food can's boost, a pack of cigarettes; how many bites / cigarettes it holds. */
  snack?: 'beans' | 'spinach' | 'energy' | 'dogfood'; smokes?: boolean; servings?: number;
  /** Heavy loot (Bob's safe): a second pig can grab it too (they drag it together); one pig alone barely budges it. */
  coop?: boolean;
  /** Bob's TV: its screen cracks when it hits something faster than this (m/s) or gets punched — then it's worth `cracked`. */
  screen?: number; cracked?: number;
  /** Chain modes (farms 6 / 7): what this is along the production chain (world/chain.ts: a quick LMB click uses it). */
  item?: string;
  /** Munchies: a high pig eats it with a click (counts for the munchies challenge). */
  food?: boolean;
  /**
   * Pours when tipped over (world/hands.ts: hold R): what comes out, how fast (`left` per second), from where (local),
   * the stream's colour / bit size / sound. `left` = how much is in it (servings: the starting amount).
   */
  pour?: { stuff: string; rate: number; spout: [number, number, number]; color: number; size?: number; sound?: string };
  /**
   * Pushed, not carried (the wheelbarrow): held at this point (model space: its handles), at hoof / snout height in
   * front of the pig — never aimed or turned upright; R lifts the handles high (dump it); LMB = a shove.
   */
  push?: [number, number, number];
}

/** A loose physics object (crate, barrel, pumpkin…): can be pushed, rammed, grabbed and thrown. */
export class Prop implements Holdable {
  kind = 'prop' as const;
  heldBy: any = null;
  /** Heavy loot: the second pig holding it (heldBy = the first one). */
  helper: any = null;
  /** Heavy loot scraping along the ground: next scrape sound. */
  private scrapeT = 0;
  radius: number;
  synced: Synced;
  obj = new THREE.Group();
  lastHit = 0;
  /** Dropped in the stash: counted, hidden, out of the world until the next round. */
  banked = false;
  /** Smashed to bits (breakables): hidden like banked, but not loot. */
  smashed = false;
  /** Its screen cracked (Bob's TV): still loot, worth next to nothing. */
  broken = false;
  private home: { p: THREE.Vector3; q: THREE.Quaternion };
  get value() { return this.worth ?? this.def.value ?? 0; }
  /** Value override for this round (a spilled milk churn is just an empty can). */
  worth: number | null = null;
  /** Hits a weapon has landed on Bob this round. */
  uses = 0;
  /** Half its height (the body's centre → its top; markers float above it). */
  half = 0.3;
  /** Shop gadget from a pool (world/gadgets.ts): hidden until handed out, hidden again on a new round. */
  pooled = false;
  /** Last time it was punched / headbutted / rammed (a cherry bomb lights). */
  lastKnock = -10;
  /** Snacks: bites / cigarettes left (an eaten can loses its lid). */
  left = 0;
  private lid: THREE.Object3D | null = null;
  /**
   * Swap its one box collider for several pieces (the wheelbarrow: a hollow tray, legs, a wheel). Body space (the
   * centre of the model's box). `slick` = no friction from this piece (a wheel: something else grips for it).
   */
  compound(parts: { box?: [number, number, number]; ball?: number; at: [number, number, number]; rot?: [number, number, number]; mass: number; friction?: number; slick?: boolean }[]) {
    const c0 = this.body.collider(0);
    owners.delete(c0.handle); world.removeCollider(c0, false);
    for (const p of parts) {
      const d = p.ball ? RAPIER.ColliderDesc.ball(p.ball) : RAPIER.ColliderDesc.cuboid(p.box![0], p.box![1], p.box![2]);
      d.setTranslation(p.at[0], p.at[1], p.at[2]);
      if (p.rot) { const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rot[0], p.rot[1], p.rot[2])); d.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }); }
      d.setMass(p.mass).setFriction(p.slick ? 0 : p.friction ?? this.def.friction ?? 0.7).setRestitution(this.def.bounce ?? 0.15)
        .setCollisionGroups(groups(L.PROP)).setActiveHooks(HOOKS)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(this.def.mass * 90);
      if (p.slick) d.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
      owners.set(world.createCollider(d, this.body).handle, this);
    }
  }
  setLeft(n: number) { this.left = n; if (this.lid) this.lid.visible = n > 0; this.onLeft?.(n); }
  /** A container shows how full it is (chain props: the mug's beer, the bag's weed). */
  onLeft?: (n: number) => void;
  /** Sitting in a socket (world/hands.ts): kinematic there until someone takes it out. */
  dockedIn: any = null;
  /** Just snapped somewhere: bins don't catch it again for a moment. */
  snapCd = 0;
  /** The socket it was just taken out of (it isn't pulled back in until it's been carried away). */
  outOf: any = null;
  /** Tipped over an opening (pouring): it passes through static things for now (world/hands.ts). */
  ghosted = false;
  /** What it pours now when it has contents that change (a pot of butter, a bowl of dough); else def.pour. */
  pourNow?: () => { stuff: string; color: number } | null;
  /** Its size (the model's box). */
  size = new THREE.Vector3();
  /** Can't be taken right now (a paper being rolled, a tray behind a shut oven door). */
  noGrab?: () => boolean;
  /** Pushed by its handles (def.push), body space; null = carried normally. */
  pushAt: THREE.Vector3 | null = null;
  constructor(scene: THREE.Scene, public def: PropDef, at: THREE.Vector3, yaw = 0) {
    const model = def.make ? made(def.make()) : fitted(def.model!, { height: def.height, scale: def.scale });
    const size = sizeOf(model);
    this.size.copy(size);
    model.position.y = def.r ? -def.r : -size.y / 2;
    this.obj.add(model);
    if (def.make) rigidSkin(this.obj);
    this.lid = this.obj.getObjectByName('lid') ?? null;
    this.left = def.servings ?? 0;
    scene.add(this.obj);
    const shape = def.shape ?? 'box';
    const q = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y + size.y / 2 + 0.02, at.z)
      .setRotation(q).setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(def.damp ?? 0.3));
    let d: RAPIER.ColliderDesc;
    if (shape === 'ball') d = RAPIER.ColliderDesc.ball(def.r ?? Math.max(size.x, size.y, size.z) / 2);
    else if (shape === 'cyl') d = RAPIER.ColliderDesc.cylinder(size.y / 2, Math.max(size.x, size.z) / 2);
    else if (shape === 'wheel') d = RAPIER.ColliderDesc.roundCylinder(size.x / 2 - 0.03, Math.max(size.y, size.z) / 2 - 0.03, 0.03)
      .setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 });
    else d = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2);
    d.setMass(def.mass).setFriction(def.friction ?? 0.7).setRestitution(def.bounce ?? 0.15)
      .setCollisionGroups(groups(L.PROP)).setActiveHooks(HOOKS)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(def.mass * 90);
    const c = world.createCollider(d, body);
    owners.set(c.handle, this);
    this.body = body;
    this.mass = def.mass;
    this.radius = Math.max(size.x, size.z) / 2;
    this.half = size.y / 2;
    if (def.push) this.pushAt = new THREE.Vector3(def.push[0], def.push[1] - size.y / 2, def.push[2]);
    this.label = def.label;
    this.synced = new Synced(body, this.obj);
    this.home = { p: new THREE.Vector3(at.x, at.y + size.y / 2 + 0.02, at.z), q: q.clone() };
    G.holdables.push(this);
  }

  /** Into the stash (host): hidden, no physics, not grabbable. */
  bank() {
    if (this.banked) return;
    if (this.dockedIn) HANDS.undock(this, null);
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
  /** Out of the stash / pool again, at a spot (gadget handed out). */
  unbank(at: THREE.Vector3, yaw = 0) {
    this.banked = false; this.smashed = false; this.uses = 0;
    if (G.net !== 'client' && this.body.isKinematic()) this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.body.setEnabled(true); this.obj.visible = true;
    if (!G.holdables.includes(this)) G.holdables.push(this);
    this.body.setTranslation({ x: at.x, y: at.y + this.half + 0.05, z: at.z }, true);
    this.body.setRotation(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.synced.capture(); this.synced.capture();
  }
  /** New round: back where it started. */
  reset() {
    if (this.dockedIn) HANDS.undock(this, null, false);
    if (G.net !== 'client' && this.body.isKinematic()) this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.uses = 0; this.smashed = false; this.worth = null; this.setLeft(this.def.servings ?? 0); this.setBroken(false);
    if (this.pooled) { this.bank(); this.putHome(); return; }
    if (this.banked) { this.banked = false; this.body.setEnabled(true); this.obj.visible = true; if (!G.holdables.includes(this)) G.holdables.push(this); }
    this.body.setTranslation(this.home.p, true); this.body.setRotation(this.home.q, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.synced.capture(); this.synced.capture();
  }
  body: RAPIER.RigidBody;
  mass: number;
  label?: string;

  netState(n: number[]) { n.push(carrierCode(this.heldBy), this.banked ? 1 : 0, this.left); if (this.def.screen) n.push(this.broken ? 1 : 0); }
  netApply(n: number[]) {
    if (!n.length) return;
    this.heldBy = carrierFrom(n[0]);
    if (n[2] !== undefined && n[2] !== this.left) this.setLeft(n[2]);
    if (n[3] !== undefined && (n[3] === 1) !== this.broken) this.setBroken(n[3] === 1);
    const b = n[1] === 1;
    if (b !== this.banked) { this.banked = b; this.obj.visible = !b; this.body.setEnabled(!b); const i = G.holdables.indexOf(this); if (b && i >= 0) G.holdables.splice(i, 1); else if (!b && i < 0) G.holdables.push(this); }
  }

  knock(dv: THREE.Vector3) {
    this.lastKnock = G.time;
    if (this.def.fragile && !this.heldBy) { this.smash(); return; }
    if (this.def.screen) this.crack();
    const lv = this.body.linvel();
    this.body.setLinvel({ x: lv.x + dv.x, y: lv.y + dv.y, z: lv.z + dv.z }, true);
    this.body.setAngvel({ x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 10 }, true);
  }

  /** Heavy loot being dragged: a scrape now and then (loud: Bob hears it). Host, every fixed step. */
  scrape() {
    if (!this.def.coop || !this.heldBy || this.banked) return;
    const v = this.body.linvel(), sp = Math.hypot(v.x, v.z);
    if (sp < 0.35 || G.time < this.scrapeT) return;
    this.scrapeT = G.time + 0.45 - Math.min(0.2, sp * 0.08);
    const p = this.body.translation(), at = new THREE.Vector3(p.x, p.y - this.half, p.z);
    G.audio.play('metal', { pos: at, vol: Math.min(0.75, 0.3 + sp * 0.25), pitch: 0.45 + Math.random() * 0.15, minGap: 0.1 });
    G.fx.puff(at, { count: 2, color: 0xd8c29a, speed: 0.6, up: 0.3, life: 0.6, size: 0.4, alpha: 0.5 });
    G.noise(at, 13);
  }

  /** Called from contact force events: clunk. */
  impact(force: number) {
    if (this.def.fragile && !this.banked && this.synced.preVel.length() > this.def.fragile) { this.smash(); return; }
    if (this.def.screen && !this.banked && this.synced.preVel.length() > this.def.screen) this.crack();
    if (G.time - this.lastHit < 0.12) return;
    this.lastHit = G.time;
    const vol = Math.min(1, force / (this.mass * 600));
    if (vol < 0.08) return;
    const p = this.body.translation();
    G.audio.play(this.def.sound ?? 'wood', { pos: new THREE.Vector3(p.x, p.y, p.z), vol, minGap: 0.03 });
    if (vol > 0.4) G.noise(new THREE.Vector3(p.x, p.y, p.z), 10 * vol);
  }
}

export interface Prop { smash(how?: string): void; crack(): void; setBroken(on: boolean): void }
/** Bob's TV: the screen cracks (host) — glass tinkle, sparks, a puff of smoke; it's worth `cracked` coins from now on. */
Prop.prototype.crack = function (this: Prop) {
  if (this.broken || this.banked || G.net === 'client') return;
  this.setBroken(true);
  this.worth = this.def.cracked ?? 0;
  const p = this.body.translation(), at = new THREE.Vector3(p.x, p.y + 0.1, p.z);
  G.audio.play('glass', { pos: at, vol: 1 });
  G.fx.bits(at, { count: 16, color: 0xdff3ff, spread: 0.2, speed: 3, up: 2.5, grav: 12, life: 0.7, size: 0.06, grow: 0, alpha: 1 });
  G.fx.bits(at, { count: 8, color: 0xffe08a, spread: 0.1, speed: 2.5, up: 2, grav: 8, life: 0.35, size: 0.05, grow: 0, alpha: 1 });
  G.fx.puff(at, { count: 6, color: 0x8a8f99, speed: 0.6, up: 0.8, life: 1.4, size: 0.5, alpha: 0.5 });
  G.noise(at, 14);
  G.events.push({ type: 'tvBroken' });
};
Prop.prototype.setBroken = function (this: Prop, on: boolean) {
  this.broken = on;
  const c = this.obj.getObjectByName('crackG'); if (c) c.visible = on;
  const s = this.obj.getObjectByName('screen') as THREE.Mesh | undefined;
  if (s) { const m = s.material as THREE.MeshToonMaterial; m.color.setHex(on ? 0x2b3338 : 0x9fd3ea); m.emissive.setHex(on ? 0x000000 : 0x3f7f9a); }
};
/** Breakables: shards + splat, gone for the round (host; the event counts for the pranks). */
Prop.prototype.smash = function (this: Prop, how = '') {
  if (this.banked) return;
  if (this.heldBy) this.heldBy.release?.(false);
  const p = this.body.translation(), at = new THREE.Vector3(p.x, p.y, p.z);
  G.fx.bits(at, { count: 22, color: this.def.bits ?? 0xc8673a, spread: 0.2, speed: 4, up: 3.5, grav: 12, life: 0.9, size: 0.1, grow: 0, alpha: 1 });
  G.fx.puff(at, { count: 6, color: 0xe8d9c0, speed: 1.2, up: 0.6, life: 0.7, size: 0.5, alpha: 0.5 });
  G.audio.play(this.def.smashSound ?? (this.def.id === 'egg' || this.def.id === 'melon' ? 'splat|squish' : 'wood|thud'), { pos: at, vol: 1, pitch: this.def.id === 'flowerPot' ? 1.4 : 1 });
  G.noise(at, 8);
  this.smashed = true;
  this.bank();
  G.events.push({ type: 'smashed', text: this.def.id ?? '', why: how });
};

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
  melon: { model: 'kenney/crop_melon', height: 0.35, mass: 4, shape: 'ball', sound: 'squish|thud', label: 'item.melon', bounce: 0.3, value: 20, fragile: 7, bits: 0xe8443a },
  // pranks (procedural, funProps.ts)
  egg: { make: makeEgg, mass: 0.3, shape: 'box', sound: 'thud', label: 'item.egg', fragile: 3.2, bits: 0xffe27a },
  flowerPot: { make: () => makeFlowerPot([0xff6fa8, 0xffd166, 0xb57bff, 0xff7a4a][Math.floor(Math.random() * 4)]), mass: 3, shape: 'cyl', sound: 'wood', label: 'item.flowerPot', fragile: 5.5, value: 5 },
  gnome: { make: makeGnome, mass: 6, sound: 'thud', label: 'item.gnome', value: 30, bounce: 0.2 },
  undies: { make: makeUndies, mass: 0.6, sound: 'thud', label: 'item.undies', value: 25, friction: 0.9 },
  trophy: { model: 'loot/Chalice', height: 0.55, mass: 4, shape: 'cyl', sound: 'metal', label: 'item.trophy', value: 100 },
  pie: { make: makePie, mass: 1.5, shape: 'cyl', sound: 'squish', label: 'item.pie', value: 80 },
  log: { model: 'kenney/log', height: 0.4, mass: 16, shape: 'box', sound: 'wood', label: 'item.log', value: 5, item: 'log' },
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
  // the guard dog drops everything for a bone (KayKit Halloween, CC0)
  bone: { model: 'kaykit/bone_A', height: 0.13, mass: 0.6, shape: 'box', sound: 'thud', label: 'item.bone', friction: 0.8 },
  // shop gadgets (world/gadgets.ts): cherry bomb (Quaternius Platformer) lights when thrown / hit, bangs 2.5 s later;
  // stink bomb (KayKit smokebomb) bursts into a stink cloud when it lands hard
  cherryBomb: { model: 'loot/Bomb', height: 0.3, mass: 1.2, shape: 'ball', sound: 'thud', label: 'item.cherryBomb', bounce: 0.3, friction: 0.9 },
  // farm 2 (orchard & beehives): apples fall from shaken trees (a pool, world/orchard.ts), the one golden apple, honey,
  // Bob's prize honey pot, cider from the press
  apple: { make: () => makeApple(), mass: 0.4, shape: 'ball', sound: 'thud', label: 'item.apple', value: 5, bounce: 0.35, fragile: 13, bits: 0xf2e6b0, smashSound: 'splat|squish' },
  goldApple: { make: () => makeApple(true), mass: 0.5, shape: 'ball', sound: 'metal', label: 'item.goldApple', value: 120, bounce: 0.35 },
  honey: { make: makeHoneyJar, mass: 1.5, shape: 'cyl', sound: 'wood', label: 'item.honey', value: 35 },
  honeyPot: { make: makeHoneyPot, mass: 5, shape: 'ball', sound: 'wood', label: 'item.honeyPot', value: 110 },
  cider: { make: makeCiderJug, mass: 3, shape: 'ball', sound: 'wood', label: 'item.cider', value: 60 },
  // farm 3 (dairy & cheese): milk churns (knock one over = spilled milk, Bob slips in it), cheese wheels that roll,
  // the prize cheese (big, heavy: stand up or bring a friend), the red rag (the bull charges whoever holds it)
  milkChurn: { make: makeMilkChurn, mass: 9, shape: 'cyl', sound: 'metal', label: 'item.milkChurn', value: 30, friction: 0.6 },
  cheeseWheel: { make: () => makeCheeseWheel(), mass: 12, shape: 'wheel', sound: 'thud', label: 'item.cheeseWheel', value: 45, friction: 0.9, bounce: 0.1 },
  prizeCheese: { make: () => makeCheeseWheel(true), mass: 45, shape: 'wheel', sound: 'thud', label: 'item.prizeCheese', value: 220, friction: 0.9, bounce: 0.05 },
  redRag: { make: makeRedRag, mass: 1, shape: 'box', sound: 'thud', label: 'item.redRag', friction: 0.9 },
  // farm 4 (pumpkin farm at night): smashable patch pumpkins, the giant prize pumpkin (too heavy to carry: roll it)
  patchPumpkin: { model: 'kaykit/pumpkin_orange_small', height: 0.46, mass: 6, shape: 'ball', sound: 'squish|thud', label: 'item.pumpkin', bounce: 0.25, value: 10, fragile: 8, bits: 0xf08a24, smashSound: 'splat|squish' },
  patchPumpkinY: { model: 'halloween/pumpkin_yellow_small', height: 0.44, mass: 5, shape: 'ball', sound: 'squish|thud', label: 'item.pumpkin', bounce: 0.25, value: 10, fragile: 8, bits: 0xf2c23a, smashSound: 'splat|squish' },
  candyJar: { model: 'kaykit/jar_A_large', height: 0.42, mass: 2.5, shape: 'cyl', sound: 'wood', label: 'item.candyJar', value: 45 },
  giantPumpkin: { make: () => makeGiantPumpkin((m, h) => fitted(m, { height: h })), mass: 140, shape: 'ball', r: 1.0, damp: 1.4, sound: 'thud', label: 'item.giantPumpkin', value: 250, friction: 1, bounce: 0.05 },
  // farm 5 (winter): snowballs (the piles restock them, world/winter.ts), a snowball to roll up big, presents under the
  // tree + Bob's big present, the snowman's parts once he's knocked over, Bob's ice-fishing catch, a sled
  snowball: { make: makeSnowball, mass: 0.5, shape: 'ball', r: 0.13, damp: 2.5, sound: 'snowhit', label: 'item.snowball', fragile: 4.5, bits: 0xffffff, smashSound: 'snowhit', bounce: 0.1, friction: 0.9 },
  snowboulder: { make: makeSnowBoulder, mass: 10, shape: 'ball', r: 0.42, damp: 0.45, sound: 'snowhit', label: 'item.snowboulder', friction: 1, bounce: 0.02 },
  present: { make: () => makePresent(0.42, 0.34, 0.42, 0xd8342c, 0xffd166), mass: 3, sound: 'thud', label: 'item.present', value: 40 },
  presentG: { make: () => makePresent(0.52, 0.26, 0.36, 0x2f9a5a, 0xd8342c), mass: 3, sound: 'thud', label: 'item.present', value: 35 },
  presentB: { make: () => makePresent(0.3, 0.46, 0.3, 0x3d6fd1, 0xfff4e6), mass: 2.5, sound: 'thud', label: 'item.present', value: 45 },
  bigPresent: { make: () => makePresent(1.0, 0.85, 1.0, 0xffc93a, 0xd8342c), mass: 45, sound: 'thud', label: 'item.bigPresent', value: 200, friction: 0.8 },
  snowBase: { make: () => makeSnowmanBall('base'), mass: 30, shape: 'ball', r: 0.62, damp: 0.9, sound: 'snowhit', label: 'item.snowman', friction: 1, bounce: 0.02 },
  snowMid: { make: () => makeSnowmanBall('mid'), mass: 14, shape: 'ball', r: 0.45, damp: 0.9, sound: 'snowhit', label: 'item.snowman', friction: 1, bounce: 0.02 },
  snowHead: { make: () => makeSnowmanBall('head'), mass: 5, shape: 'ball', r: 0.33, damp: 0.7, sound: 'snowhit', label: 'item.snowmanHead', friction: 1, bounce: 0.05 },
  fishBucket: { make: makeFishBucket, mass: 4, shape: 'cyl', sound: 'metal', label: 'item.fishBucket', value: 45 },
  sled: { model: 'winter/sled', height: 0.42, mass: 8, sound: 'wood', label: 'item.sled', value: 30, friction: 0.06 },
  // heavy loot: Bob's safe (two pigs drag it; one pig on spinach can too). Loud when it scrapes along.
  safe: { make: makeSafe, mass: 150, sound: 'metal', label: 'item.safe', value: 300, friction: 0.75, bounce: 0.02, coop: true },
  // more heavy loot: Bob's old TV (the screen cracks if it's dropped / thrown / punched: 220 → 30) and the grandfather
  // clock (tall: it topples when dragged hard; BONG on every full hour wherever it is — world/heavyLoot.ts)
  tv: { make: makeTV, mass: 85, sound: 'wood', label: 'item.tv', value: 220, friction: 0.7, bounce: 0.05, coop: true, screen: 5.2, cracked: 30 },
  clock: { make: makeClock, mass: 110, sound: 'wood', label: 'item.clock', value: 260, friction: 0.65, bounce: 0.03, coop: true },
  // chain modes (farm 6: cannabis — world/weed.ts; everything is done with the hooves, world/hands.ts): harvested buds,
  // a bag of ground weed (pours: 4 pinches), a rolling paper + a filter tip (they snap together on the rolling mat),
  // rolled joints (puffs), the lighter, watering cans (pour on the plants; refill at the pump / the pond), seeds (pour
  // on an empty mound), the sickle, butter, the cooking pot (pours the magic butter), flour (pours), the mixing bowl
  // (pours the dough), baking trays, the wheelbarrow
  bud: { make: makeBud, mass: 0.3, shape: 'ball', r: 0.1, damp: 2, sound: 'squish', label: 'item.bud', item: 'bud', friction: 0.9 },
  weedBag: { make: makeWeedBag, mass: 0.4, sound: 'squish', label: 'item.weedBag', item: 'weed', servings: 4,
    pour: { stuff: 'weed', rate: 0.6, spout: [0, 0.09, 0], color: 0x6fae3e, size: 0.03, sound: 'rustle' } },
  paper: { make: makePaper, mass: 0.1, sound: 'thud', label: 'item.paper', item: 'paper', friction: 0.95 },
  filter: { make: makeFilter, mass: 0.06, sound: 'thud', label: 'item.filter', item: 'filter', friction: 0.9 },
  joint: { make: makeJoint, mass: 0.05, sound: 'thud', label: 'item.joint', item: 'joint', servings: 5, friction: 0.9 },
  lighter: { make: makeLighter, mass: 0.1, sound: 'metal', label: 'item.lighter', item: 'lighter' },
  wateringCan: { make: makeWateringCan, mass: 3, sound: 'metal', label: 'item.wateringCan', item: 'can', servings: 6,
    pour: { stuff: 'water', rate: 1.6, spout: [0, 0.2, 0.3], color: 0x7fd0ff, size: 0.05 } },
  seedBag: { make: makeSeedBag, mass: 1, sound: 'thud', label: 'item.seedBag', item: 'seed', servings: 4,
    pour: { stuff: 'seed', rate: 1.2, spout: [0, 0.17, 0], color: 0xc9a24a, size: 0.03, sound: 'rustle' } },
  sickle: { make: makeSickle, mass: 1.2, sound: 'metal', label: 'item.sickle', item: 'sickle' },
  butter: { make: () => makeButter(false), mass: 0.3, sound: 'squish', label: 'item.butter', item: 'butter', food: true },
  magicButter: { make: () => makeButter(true), mass: 0.8, shape: 'cyl', sound: 'wood', label: 'item.magicButter', item: 'magic' },
  cookPot: { make: makeCookPot, mass: 2, shape: 'cyl', sound: 'metal', label: 'item.cookPot', item: 'pot', friction: 0.8,
    pour: { stuff: 'magic', rate: 0.7, spout: [0, 0.1, 0.17], color: 0x9fbf4a, size: 0.06, sound: 'pour' } },
  mixBowl: { make: makeMixBowl, mass: 1.5, shape: 'cyl', sound: 'wood', label: 'item.mixBowl', item: 'bowl', friction: 0.8,
    pour: { stuff: 'dough', rate: 0.6, spout: [0, 0.1, 0.2], color: 0xf2dcae, size: 0.07, sound: 'squish' } },
  flour: { make: () => makeSack(0xf8f4ea, 0x3f9ad8, 0.32, 0.36), mass: 5, shape: 'cyl', sound: 'thud', label: 'item.flour', item: 'flour', servings: 3,
    pour: { stuff: 'flour', rate: 0.8, spout: [0, 0.27, 0], color: 0xf8f4ea, size: 0.045, sound: 'rustle' } },
  tray: { make: makeEmptyTray, mass: 1, sound: 'metal', label: 'item.tray', item: 'tray' },
  trayRaw: { make: () => makeTray('raw'), mass: 1.2, sound: 'metal', label: 'item.trayRaw', item: 'trayRaw' },
  cookies: { make: () => makeTray('baked'), mass: 1.2, sound: 'metal', label: 'item.cookies', item: 'cookies', servings: 6, food: true },
  cookiesBurnt: { make: () => makeTray('burnt'), mass: 1.2, sound: 'metal', label: 'item.cookiesBurnt', item: 'burnt' },
  wheelbarrow: { make: makeWheelbarrow, mass: 30, sound: 'metal', label: 'item.wheelbarrow', item: 'barrow', friction: 0.6, bounce: 0.02, push: [0, 0.44, -0.84] },
  // farm 7 (beer — world/brew.ts): the scythe, wheat sheaves, grain sacks (pour into the mill) → malt sacks (pour into
  // the kettle), hops, the water bucket, the barrel, mugs (fill them at the tap, drink, refill)
  scythe: { model: 'brew/Scythe', height: 1.3, mass: 2.5, sound: 'metal', label: 'item.scythe', item: 'scythe' },
  sheaf: { make: makeSheaf, mass: 1.5, sound: 'thud', label: 'item.sheaf', item: 'sheaf', friction: 0.9 },
  grain: { make: () => makeSack(0xe8d6b0, 0xc9a24a), mass: 8, shape: 'cyl', sound: 'thud', label: 'item.grain', item: 'grain', friction: 0.9, servings: 3,
    pour: { stuff: 'grain', rate: 1.2, spout: [0, 0.3, 0], color: 0xe8d6b0, size: 0.035, sound: 'rustle' } },
  malt: { make: () => makeSack(0xb5793d, 0xffd166), mass: 7, shape: 'cyl', sound: 'thud', label: 'item.malt', item: 'malt', friction: 0.9, servings: 3,
    pour: { stuff: 'malt', rate: 1.2, spout: [0, 0.3, 0], color: 0xb5793d, size: 0.035, sound: 'rustle' } },
  hops: { make: makeHops, mass: 0.3, sound: 'squish', label: 'item.hops', item: 'hops' },
  bucket: { model: 'brew/Bucket', height: 0.4, mass: 2, shape: 'cyl', sound: 'metal', label: 'item.bucket', item: 'can', servings: 3,
    pour: { stuff: 'water', rate: 1.6, spout: [0, 0.2, 0.15], color: 0x7fd0ff, size: 0.05 } },
  beerMug: { make: makeMugFill, mass: 0.6, shape: 'cyl', sound: 'metal', label: 'item.beerMug', item: 'beer', servings: 0,
    pour: { stuff: 'beer', rate: 1.5, spout: [0, 0.09, 0.075], color: 0xffb42a, size: 0.04 } },
  beerBarrel: { make: makeBeerBarrel, mass: 45, shape: 'wheel', sound: 'wood', label: 'item.beerBarrel', item: 'barrel', friction: 1, damp: 3.5 },
  // the payphone's coins, the phone's plug (on its cord), the payphone handset (on its cord) — world/phone.ts
  coin: { make: makeCoin, mass: 0.05, sound: 'metal', label: 'item.coin', item: 'coin', friction: 0.9 },
  plug: { make: makePlug, mass: 0.1, sound: 'thud', label: 'item.plug', item: 'plug' },
  handset: { make: makeHandset, mass: 0.4, sound: 'thud', label: 'item.handset', item: 'handset' },
  // Bob's coffee break on the porch (world/porch.ts): his mug on the side table, the hot sauce by the grill
  coffeeMug: { make: makeCoffeeMug, mass: 0.6, shape: 'cyl', sound: 'metal', label: 'item.coffeeMug', value: 15 },
  hotSauce: { make: makeHotSauce, mass: 0.5, shape: 'cyl', sound: 'thud', label: 'item.hotSauce', servings: 1,
    pour: { stuff: 'hot', rate: 0.5, spout: [0, 0.15, 0], color: 0xe2352b, size: 0.03, sound: 'pour' } },
  // the gulag (world/gulag.ts): potatoes for its sack
  potato: { make: makePotato, mass: 0.3, shape: 'ball', sound: 'thud', label: 'item.potato' },
  stinkBomb: { model: 'kaykit/smokebomb', height: 0.26, mass: 0.8, shape: 'ball', sound: 'thud', label: 'item.stinkBomb', fragile: 4.2, bits: 0x9bd35a, smashSound: 'splat|squish' },
};
for (const k in PROPS) PROPS[k].id = k;
for (const k of ['apple', 'pie', 'ham', 'melon', 'egg', 'cheeseWheel', 'pumpkin', 'honey', 'patchPumpkin']) PROPS[k].food = true;   // the munchies
export const LOOT_MODELS = Object.values(PROPS).map((d) => d.model).filter((m): m is string => !!m && m.startsWith('loot/'));
