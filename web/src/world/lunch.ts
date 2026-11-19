import * as THREE from 'three';
import { RAPIER } from '../core/physics';
import { G } from '../game/ctx';
import { toonMat } from '../render/toon';
import type { Loop } from '../core/audio';
import type { Pig } from '../pig/pig';
import { Prop, PROPS } from './props';
import { HANDS } from './hands';
import type { Farmhouse } from './farmhouse';

/**
 * Bob's lunch in his farmhouse kitchen (s27) = breathing window #6 (farms 1–5: the house built from code; farm 4 has
 * dinner instead). Once a round, between two chores after `MEAL.hour` (11:24–11:54; a night farm: 1.6 h after its
 * start), Bob walks into the kitchen, fries sausages + an egg at the stove (his back to the room, ~10 s: the pan
 * sizzles, the burner is a flame a fart can catch → fireball), carries the pan to the table, dishes up onto his plate
 * and sits down on HIS chair (the one nearest the front door: his back is to it). He eats with a fork (a bite every
 * 3–4 s, eyes on his plate: he only sees a narrow cone and hears what's close). Halfway he gets up and goes to the
 * fridge (3 s with his head in it), then comes back and sits down again. Pigs:
 *  - **pull his chair** (`chairPull`): drag it away (RMB) before he sits — he sits on nothing: down on his back, then
 *    he hunts. A chair shoved / tipped while he sits on it = the same;
 *  - **steal his lunch** (`lunchSteal`): the plate is a real prop (loot); gone when he reaches for it = "Huh?" + search;
 *  - **spike it** (`lunchSpike`): the hot sauce bottle stands on his table — tip it over the food (R), or a muddy pig
 *    RMB at the plate → at the next bite: the spit-take (fire breath, off to the water like the spiked coffee).
 * Bob's states live in farmer.ts ('meal'); this keeps the kitchen's things, where everything is and the synced phase.
 * One synced entity (after the porch).
 */
export const MEAL = {
  /** Lunch after this game hour (+ up to `spread`); a farm whose clock starts in the evening: `dinner` h after its start. */
  hour: 11.4, spread: 0.5, dinner: 1.6,
  /** Cooking (s), dishing up (s), sitting down (s), the fork's trip (s), a bite every … s, bites in a meal. */
  cook: 10, dish: 1.1, sit: 0.75, fork: 1.2, bite: [3, 4.2] as [number, number], bites: 6,
  /** After this many bites he goes to the fridge, head in it … s. */
  fridgeAfter: 3, fridgeLook: 3.2,
  /** The plate counts as at his place within … m; his chair as at its spot within … m (sitting down); shoved … m while he sits = he falls. */
  plateR: 0.5, chairR: 0.4, shove: 0.55,
  /** Eating: he only hears a noise this close (m). */
  hear: 10,
  /** Seated: his root this far under the cushion top (m); forward of the cushion's middle (m). */
  hipDrop: 0.47, fwd: 0.06,
  /** Hot sauce (the bottle holds 1) that spikes the food; a muddy hoof's reach to the plate (m). */
  hot: 0.18, mudR: 1.0,
  /** His weight on the chair while he sits (kg: a pig brushing past doesn't move it, a ram does). */
  bobKg: 140,
};
/** Phases (synced): what he's doing in the kitchen now. */
export const PH = { None: 0, ToStove: 1, Cook: 2, Serve: 3, Dish: 4, Sit: 5, Eat: 6, ToFridge: 7, Fridge: 8, Back: 9 } as const;
export type MealPh = typeof PH[keyof typeof PH];

// (separate temps: callers pass v1 / v2 as `out` — never let one alias another)
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), vT = new THREE.Vector3(), q1 = new THREE.Quaternion(), qT = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);

// ================================================================== Bob's lunch plate (a real prop: loot)
/** A white plate with a blue rim: 2 sausages, a fried egg, baked beans + toast — named meshes (hidden bite by bite). */
function makeLunchPlate() {
  const g = new THREE.Group();
  const M = (c: number) => toonMat(c);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, name = '', rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.scale.set(sx, sy, sz); o.castShadow = true; o.receiveShadow = true;
    if (name) o.name = name;
    g.add(o); return o;
  };
  add(new THREE.CylinderGeometry(0.16, 0.12, 0.022, 24), M(0xfdfaf2), 0, 0.011, 0);
  add(new THREE.TorusGeometry(0.142, 0.007, 6, 28), M(0x5d93cf), 0, 0.022, 0, '', Math.PI / 2);
  const ball = new THREE.SphereGeometry(1, 12, 8), sausage = new THREE.CapsuleGeometry(0.022, 0.1, 4, 10);
  // the food, in the order it's eaten: sausages, the egg, beans + toast
  add(sausage, M(0xa8502a), -0.05, 0.045, 0.04, 'food:0', 0, 0, Math.PI / 2 - 0.25);
  add(sausage, M(0x9c4824), -0.03, 0.045, -0.02, 'food:0', 0, 0, Math.PI / 2 - 0.1);
  add(new THREE.CylinderGeometry(0.06, 0.065, 0.012, 16), M(0xffffff), 0.055, 0.03, -0.035, 'food:1', 0, 0, 0, 1, 1, 0.85);
  add(ball, M(0xffbf1a), 0.06, 0.042, -0.04, 'food:1', 0, 0, 0, 0.026, 0.016, 0.026);
  add(ball, M(0xd8642a), 0.05, 0.038, 0.06, 'food:2', 0, 0, 0, 0.05, 0.016, 0.04);
  add(new THREE.BoxGeometry(0.07, 0.014, 0.065), M(0xe0a457), -0.06, 0.04, -0.08, 'food:2', 0, 0.35);
  return g;
}
PROPS.bobLunch = { make: makeLunchPlate, mass: 0.6, shape: 'cyl', sound: 'metal', label: 'item.bobLunch', value: 20, id: 'bobLunch', friction: 0.9 };

export class Lunch {
  kind = 'lunch' as const;
  plate: Prop; sauce: Prop;
  /** World spots: in front of the stove / the fridge (where he stands), what he faces there; his chair's spot + facing. */
  stove = new THREE.Vector3(); hob = new THREE.Vector3(); fridgeAt = new THREE.Vector3(); fridgeLook = new THREE.Vector3();
  chairHome = new THREE.Vector3(); chairFwd = new THREE.Vector3();
  /** His place on the table (table body space). */
  private placeL = new THREE.Vector3();
  // ---- synced
  ph: number = PH.None; t0 = -10; biteT0 = -10;
  /** What's on his plate: 0 just food, 1 hot sauce, 2 mud; the last spit-take was (1 / 2). */
  spiked = 0; spat = 0;
  // ---- host
  private hot = 0;
  /** Where the chair stood when he sat down on it (shoved past `shove` = he falls). */
  sitAt = new THREE.Vector3();
  private food: { m: THREE.Object3D; k: number }[] = [];
  private flame: THREE.Group; private flameMats: THREE.MeshBasicMaterial[] = [];
  private loop: Loop | null = null; private smokeT = 0;

  constructor(scene: THREE.Scene, props: Prop[], public house: Farmhouse, public oven: Prop, public table: Prop, public chair: Prop, public fridge: Prop | null) {
    // in front of the stove (its +z = the room side), the burner on its top
    const front = (pr: Prop, d: number, out: THREE.Vector3) => {
      const t = pr.body.translation(), r = pr.body.rotation();
      q1.set(r.x, r.y, r.z, r.w);
      return out.set(0, 0, pr.size.z / 2 + d).applyQuaternion(q1).add(v2.set(t.x, house.y0, t.z));
    };
    front(oven, 0.5, this.stove);
    { const t = oven.body.translation(); this.hob.set(t.x, t.y + oven.size.y / 2, t.z); front(oven, -oven.size.z / 2 + 0.1, v1); this.hob.x = v1.x; this.hob.z = v1.z; }
    if (fridge) { front(fridge, 0.5, this.fridgeAt); const t = fridge.body.translation(); this.fridgeLook.set(t.x, house.y0, t.z); }
    // his chair (facing the table) and his place in front of it (kept in the table's frame: it follows a nudged table)
    this.homeChair();
    { const t = table.body.translation(), r = table.body.rotation();
      q1.set(r.x, r.y, r.z, r.w).invert();
      this.placeL.copy(this.chairHome).addScaledVector(this.chairFwd, 0.58).sub(v2.set(t.x, t.y, t.z)).applyQuaternion(q1);
      this.placeL.y = table.size.y / 2 + 0.01; }
    // his plate at his place, the hot sauce bottle in the middle of the table
    this.plate = new Prop(scene, PROPS.bobLunch, this.placeSpot(v1).setY(v1.y - 0.01), Math.atan2(this.chairFwd.x, this.chairFwd.z));
    props.push(this.plate);
    this.plate.obj.traverse((o) => { const k = o.name.startsWith('food:') ? +o.name.slice(5) : -1; if (k >= 0) this.food.push({ m: o, k }); });
    this.plate.onLeft = () => this.showFood();
    this.showFood();
    const tt = table.body.translation();   // the hot sauce: the middle of the table, a hand's width to his right
    this.sauce = new Prop(scene, PROPS.hotSauce, v1.set(tt.x - this.chairFwd.z * 0.25, tt.y + table.size.y / 2 + 0.01, tt.z + this.chairFwd.x * 0.25), 0.6);
    props.push(this.sauce);
    this.pickStand(props);
    // what goes on it: hot sauce from the bottle … or a hoof of mud (RMB)
    HANDS.receiver({ r: 0.16,
      at: (out) => { const t = this.plate.body.translation(); return out.set(t.x, t.y + this.plate.half, t.z); },
      accepts: (st) => st === 'hot' && this.full && !this.plate.banked,
      fill: (_st, amt, by) => this.addHot(amt, by) });
    G.uses.push({ near: (p: Pig) => this.mudNear(p), icon: () => 'mud' });
    // the burner: a ring of little flames under his pan while he cooks (a fart catches it: fireball)
    this.flame = new THREE.Group(); this.flame.position.copy(this.hob); this.flame.visible = false; scene.add(this.flame);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, m = new THREE.MeshBasicMaterial({ color: i % 2 ? 0x5fb8ff : 0xffb43a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.09, 6), m); f.position.set(Math.cos(a) * 0.09, 0.045, Math.sin(a) * 0.09);
      this.flame.add(f); this.flameMats.push(m);
    }
    G.flames.push({ r: 0.6, at: (o) => (this.ph === PH.Cook ? o.copy(this.hob).setY(this.hob.y + 0.15) : null) });
  }

  // ================================================================== where things are
  /** His place on the table, in front of his chair (follows the table if it's been nudged). */
  placeSpot(out: THREE.Vector3) {
    const t = this.table.body.translation(), r = this.table.body.rotation();
    return out.copy(this.placeL).applyQuaternion(qT.set(r.x, r.y, r.z, r.w)).add(vT.set(t.x, t.y, t.z));
  }
  /** His chair's spot = where it stands (the build / a new round; when lunch starts: if it's only settled a little). */
  homeChair() {
    const t = this.chair.body.translation(), r = this.chair.body.rotation();
    this.chairHome.set(t.x, this.house.y0, t.z);
    this.chairFwd.set(0, 0, 1).applyQuaternion(q1.set(r.x, r.y, r.z, r.w)).setY(0).normalize();
  }
  /** Lunch starts: his chair, a little settled since (< 0.35 m, upright), counts as in its spot there. */
  begin(props: Prop[]) {
    if (this.chairOk(this.chairHome, 0.35)) { this.homeChair(); this.pickStand(props); }
  }
  /** There's food on his plate. */
  get full() { return this.plate.left > 0; }
  /** The plate is at his place on the table (not taken, not knocked off, not tipped). */
  plateHome() {
    const p = this.plate;
    if (p.banked || p.heldBy) return false;
    const t = p.body.translation(), r = p.body.rotation();
    if (v1.set(0, 1, 0).applyQuaternion(q1.set(r.x, r.y, r.z, r.w)).y < 0.7) return false;
    const s = this.placeSpot(v2);
    return Math.hypot(t.x - s.x, t.z - s.z) < MEAL.plateR && Math.abs(t.y - this.plate.half - s.y) < 0.25;
  }
  /** His chair is upright, not carried off, within `r` of `at` (its spot / where he sat on it). */
  chairOk(at: THREE.Vector3, r: number) {
    const c = this.chair;
    if (c.banked || c.heldBy || c.helper) return false;
    const t = c.body.translation(), q = c.body.rotation();
    if (v1.set(0, 1, 0).applyQuaternion(q1.set(q.x, q.y, q.z, q.w)).y < 0.8) return false;
    return Math.hypot(t.x - at.x, t.z - at.z) < r;
  }
  /** Where he stands to sit down: beside his chair, a little behind it (the side with more room), on the floor. */
  stand = new THREE.Vector3();
  private pickStand(props: Prop[]) {
    const f = this.chairFwd;
    let best = -Infinity;
    for (const s of [1, -1]) {
      const c = v1.copy(this.chairHome).addScaledVector(v2.set(f.z * s, 0, -f.x * s), 0.55).addScaledVector(f, -0.45);
      let room = this.house.inside(v2.set(c.x, this.house.y0 + 1, c.z), 0.45) ? 3 : -5;
      for (const pr of props) {
        if (pr === this.chair || pr === this.table || pr === this.plate || pr === this.sauce || pr.banked) continue;
        const t = pr.body.translation(); if (Math.abs(t.y - this.house.y0) > 2.5) continue;
        room = Math.min(room, Math.hypot(t.x - c.x, t.z - c.z) - Math.max(pr.size.x, pr.size.z) / 2);
      }
      if (room > best) { best = room; this.stand.copy(c).setY(this.house.y0); }
    }
  }
  /** Bob on the chair (the visual root: feet on the floor in front of the seat, facing the table); `k` < 1 = lowering from `from`. */
  bobPose(pos: THREE.Vector3, q: THREE.Quaternion, k = 1, from?: THREE.Vector3) {
    const c = this.chair, t = c.body.translation(), r = c.body.rotation();
    q1.set(r.x, r.y, r.z, r.w);
    const fw = v1.set(0, 0, 1).applyQuaternion(q1); fw.y = 0; fw.normalize();
    const seatY = t.y - c.size.y / 2 + 0.5 - MEAL.hipDrop;
    pos.set(t.x + fw.x * MEAL.fwd, seatY, t.z + fw.z * MEAL.fwd);
    const yaw = Math.atan2(fw.x, fw.z);
    if (k < 1 && from) { const e = k * k * (3 - 2 * k); pos.lerpVectors(from, pos, e); pos.y = from.y + (seatY - from.y) * e; }
    q.setFromAxisAngle(UP, yaw);
    return yaw;
  }
  get markPos() { return v1.copy(this.plate.synced.currP).setY(this.plate.synced.currP.y + 0.6); }
  /** It's there to have lunch with (built, the chair and the stove still in the house). */
  get usable() { const t = this.oven.body.translation(); return !this.oven.banked && !this.chair.banked && this.house.inside(v1.set(t.x, t.y, t.z)); }

  // ================================================================== the food
  private showFood() {
    const left = this.plate.left, stage = left <= 0 ? 3 : left > 4 ? 0 : left > 2 ? 1 : 2;   // 6 bites: sausages, egg, beans
    for (const f of this.food) f.m.visible = f.k >= stage;
  }
  /** Bob dishes up (host). */
  dishUp() { this.plate.setLeft(MEAL.bites); this.hot = 0; this.setSpiked(0); }
  /** A bite gone (host). */
  bite() { if (this.plate.left > 0) this.plate.setLeft(this.plate.left - 1); }
  private setSpiked(k: number) { this.spiked = k; }
  private addHot(amt: number, by: Pig | null) {
    if (G.net === 'client') return;
    this.hot += amt;
    if (this.hot >= MEAL.hot && this.spiked !== 1) {
      this.setSpiked(1);
      const t = this.plate.body.translation();
      G.audio.play('sizzle', { pos: v1.set(t.x, t.y, t.z), vol: 0.5, pitch: 1.5 });
      G.fx.bits(v1.set(t.x, t.y + 0.05, t.z), { count: 10, color: 0xff5a2a, spread: 0.05, speed: 0.8, up: 1.2, life: 0.5, size: 0.04, grow: 0, alpha: 1 });
      G.events.push({ type: 'lunchSpiked', who: by ?? undefined });
    }
  }
  /** A muddy pig with a hoof at his plate (with food on it): RMB = mud on his lunch. */
  mudNear(p: Pig) {
    if (!this.full || this.spiked || this.plate.banked || this.plate.heldBy) return false;
    if (p.out || p.cage || p.heldBy || p.held || p.mode !== 'normal' || !(p.muddy > 0)) return false;
    const t = this.plate.synced.currP;
    return Math.hypot(p.pos.x - t.x, p.pos.z - t.z) < MEAL.mudR && p.pos.y + 1.4 > t.y;
  }
  private mudIt(p: Pig) {
    this.setSpiked(2);
    p.muddyUntil = p.now;
    const t = this.plate.synced.currP;
    p.touch(v1.copy(t).setY(t.y + 0.05));
    G.audio.play('splat', { pos: t, vol: 0.6, pitch: 1.5 });
    G.fx.bits(v1.copy(t).setY(t.y + 0.06), { count: 8, color: 0x6b4a2b, speed: 1, up: 1, life: 0.45, size: 0.05, grow: 0, alpha: 1 });
    G.events.push({ type: 'lunchSpiked', who: p, why: 'mud' });
  }
  /** Spit-take: the plate flies off the table (the food's gone). Returns what was on it. */
  spit(dir: THREE.Vector3) {
    const k = this.spiked;
    this.spat = k; this.hot = 0;
    this.plate.setLeft(0);
    const b = this.plate.body;
    if (b.isKinematic()) b.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    b.setLinvel({ x: dir.x * 2.4, y: 2.6, z: dir.z * 2.4 }, true);
    b.setAngvel({ x: 7, y: 3, z: -6 }, true);
    this.setSpiked(0);
    return k;
  }
  /** Admin: spike it now (1 hot sauce, 2 mud). */
  spike(k: number) { if (G.net === 'client') return; if (!this.full) this.dishUp(); this.hot = k === 1 ? MEAL.hot : 0; this.setSpiked(k); }

  // ================================================================== fixed step (host)
  step() {
    for (const p of G.pigs as Pig[]) if (p.input.grabP && this.mudNear(p)) { this.mudIt(p); break; }
  }
  /** New round: an empty plate at his place (props reset first). */
  reset() { this.ph = PH.None; this.t0 = this.biteT0 = -10; this.hot = 0; this.spiked = this.spat = 0; this.showFood(); }

  // ================================================================== network
  netState(n: number[]) { n.push(this.ph, Math.round(this.t0 * 100) / 100, Math.round(this.biteT0 * 100) / 100, this.spiked, this.spat); }
  netApply(n: number[]) {
    if (n.length < 5) return;
    this.ph = n[0]; this.t0 = n[1]; this.biteT0 = n[2]; this.spiked = n[3]; this.spat = n[4];
  }

  // ================================================================== every frame (every browser)
  render(dt: number) {
    const cooking = this.ph === PH.Cook;
    this.flame.visible = cooking;
    if (cooking) {
      const t = G.time;
      this.flame.children.forEach((f, i) => { f.scale.y = 0.8 + Math.sin(t * 23 + i * 1.7) * 0.25; });
      this.smokeT -= dt;
      if (this.smokeT < 0) {
        this.smokeT = 0.3 + Math.random() * 0.25;
        G.fx.puff(v1.copy(this.hob).setY(this.hob.y + 0.35), { count: 1, color: 0xffffff, spread: 0.06, speed: 0.1, up: 0.7, life: 1.2, size: 0.12, grow: 0.35, alpha: 0.35 });
        if (Math.random() < 0.35) G.fx.bits(v1.copy(this.hob).setY(this.hob.y + 0.3), { count: 2, color: 0xffe08a, spread: 0.05, speed: 1.2, up: 1.4, grav: 9, life: 0.35, size: 0.025, grow: 0, alpha: 1 });
      }
    }
    if (cooking && !this.loop) this.loop = G.audio.loop('sizzle', { pos: this.hob, vol: 0.55, bus: 'sfx', ref: 4 });
    else if (!cooking && this.loop) { this.loop.stop(0.4); this.loop = null; }
    // spiked: a wisp of red steam off the plate
    if (this.spiked === 1 && this.full && Math.random() < dt * 4) {
      const t = this.plate.obj.position;
      G.fx.bits(v1.set(t.x, t.y + 0.05, t.z), { count: 1, color: 0xff6a2a, spread: 0.05, speed: 0.3, up: 0.6, life: 0.4, size: 0.03, grow: 0, alpha: 1 });
    }
    for (const m of this.flameMats) m.opacity = 0.7 + Math.random() * 0.25;
  }
}
