import * as THREE from 'three';
import { RAPIER, staticBox, staticCylinder, ignorePair } from '../core/physics';
import { G } from '../game/ctx';
import { toonMat } from '../render/toon';
import { rigidSkin } from '../render/batch';
import type { Pig } from '../pig/pig';
import { Prop, PROPS } from './props';
import { HANDS, type Socket } from './hands';

/**
 * Bob's coffee break = breathing window #4 (GDD: coffee, nap, phone call, toilet). His "read the paper" chore on the
 * porch: he sits in his rocking chair behind the newspaper (blind to the front, hears only what's close), his coffee
 * mug on a little side table at his right hand. Every few seconds the paper comes down, he reaches for the mug and
 * takes a sip (he sees again for a moment), then it goes back on the table. Pigs, with the hooves (world/hands.ts):
 *  - spike it: take the bottle of hot sauce by his BBQ grill, tip it over the mug (R) → at the next sip he spits it
 *    out, breathes fire, hops about fanning his mouth and runs to the pond to dunk his head (a long window), then
 *    hunts for whoever did it (prank `coffeeSpike`). A muddy pig can RMB a hoof of mud into it instead (he spits,
 *    wipes his tongue, furious);
 *  - steal it (loot, 15): when he reaches for it and it's gone, he gets up and looks around the porch.
 * The mug is a real prop: he really lifts it off the table (it rides in his hand, synced like any prop). One synced
 * entity per farm with a rocker (decor kit).
 */
export const COFFEE = {
  /** A sip every … s while he reads; a sip lasts `sip` s; the coffee reaches his lips `taste` s in. */
  sipEvery: [5.5, 8.5] as [number, number], sip: 2.6, taste: 1.15,
  /** Reading: only a noise this close (m) makes him lower the paper. */
  hear: 10,
  /** This much hot sauce (the bottle holds 1) spikes the cup. A muddy pig's hoof reaches the mug from … m. */
  hot: 0.18, mudR: 1.0,
  /** The mug counts as "on the table" within … m of its spot (he puts it back properly then). */
  onTable: 0.45,
  /** Hot sauce: he hops and fans his mouth … s, runs to the water, dunks his head … s. Mud: spits and wipes … s. */
  hotTime: 3.2, dunk: 4.5, mudTime: 2.6,
  /** Table top height (m). */
  topH: 0.56,
};

const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), ZAX = new THREE.Vector3(0, 0, 1);
const COFFEE_COL = [0x5a3218, 0xb8321e, 0x6b5a3e];
const rand = ([a, b]: [number, number]) => a + Math.random() * (b - a);

interface BobLike {
  state: string; doing: boolean; choreIdx: number; chores: { id: string }[];
  body: RAPIER.RigidBody; yaw: number; visual: { rig: { handR: THREE.Object3D; head: THREE.Object3D } };
}

export class Porch {
  kind = 'porch' as const;
  /** The rocker (where Bob sits), the way he faces, his right hand side. */
  chair: THREE.Vector3; fwd: THREE.Vector3; right: THREE.Vector3; yaw: number;
  /** The side table (ground) and the mug's spot on it. */
  table: THREE.Vector3; top = new THREE.Vector3();
  mug: Prop; sauce: Prop | null = null;
  /** Water troughs on the farm (game.ts fills it in: Bob's nearest water after a spiked cup, with the pond). */
  troughs: { x: number; z: number; yaw: number }[] = [];
  private socket: Socket;
  private coffee: THREE.Mesh | null;
  private coffeeMat: THREE.MeshToonMaterial | null = null;
  // ---- state (host; synced)
  /** 0 = he isn't on his break, 1 = reading (the newspaper up), 2 = a sip (the mug in his hand). */
  phase = 0; sipT0 = -10;
  /** What's in his coffee now: 0 = just coffee, 1 = hot sauce, 2 = mud. `full` = there is coffee in the mug. */
  spiked = 0; full = true;
  /** The last spit-take was (1 hot sauce / 2 mud): Bob's fire breath / tongue wiping (synced). */
  spat = 0;
  // ---- host
  private hot = 0; private ignored = false;
  private steamT = 0;

  constructor(scene: THREE.Scene, props: Prop[], height: (x: number, z: number) => number, x: number, z: number, lx: number, lz: number, grill: THREE.Vector3 | null) {
    this.chair = new THREE.Vector3(x, height(x, z), z);
    this.yaw = Math.atan2(lx - x, lz - z);
    this.fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.right = new THREE.Vector3(-this.fwd.z, 0, this.fwd.x);
    this.table = this.chair.clone().addScaledVector(this.right, 0.78).addScaledVector(this.fwd, 0.15);
    this.table.y = height(this.table.x, this.table.z);
    this.buildTable(scene);
    // his mug: a real prop that sits in its spot on the table (docked: grab it to take it)
    this.mug = new Prop(scene, PROPS.coffeeMug, v1.set(this.table.x, this.table.y + COFFEE.topH, this.table.z), this.yaw + Math.PI / 2);
    props.push(this.mug);
    this.top.set(this.table.x, this.table.y + COFFEE.topH + this.mug.half + 0.01, this.table.z);
    this.mug.noGrab = () => this.phase === 2;
    this.coffee = this.mug.obj.getObjectByName('coffee') as THREE.Mesh | null;
    if (this.coffee) { this.coffeeMat = toonMat(COFFEE_COL[0]); this.coffee.material = this.coffeeMat; }
    this.socket = HANDS.socket({ p: this.top, q: new THREE.Quaternion().setFromAxisAngle(UP, this.yaw + Math.PI / 2), on: null, r: 0.3, dock: true,
      anyYaw: true, accepts: (it) => it === this.mug });
    // what goes in it: hot sauce poured from the bottle …
    HANDS.receiver({ r: 0.1,
      at: (out) => { const t = this.mug.body.translation(); return out.set(t.x, t.y + this.mug.half - 0.02, t.z); },
      accepts: (st) => st === 'hot' && this.full && !this.mug.banked,
      fill: (_st, amt, by) => this.addHot(amt, by) });
    // … or a hoof of mud (RMB, a muddy pig at the mug)
    G.uses.push({ near: (p: Pig) => this.mudNear(p), icon: () => 'mud' });
    // the bottle of hot sauce: on a little crate of BBQ sauces next to the grill
    if (grill) {
      const c = grill.clone().add(v1.set(0, 0, 1.0));
      c.y = height(c.x, c.z);
      this.buildCrate(scene, c);
      this.sauce = new Prop(scene, PROPS.hotSauce, v1.set(c.x + 0.1, c.y + 0.42, c.z), 0.4);
      props.push(this.sauce);
    }
  }

  /** A round wooden side table (one leg, a cross foot). */
  private buildTable(scene: THREE.Scene) {
    const g = new THREE.Group(); g.position.copy(this.table); g.rotation.y = this.yaw; scene.add(g);
    const M = (c: number) => toonMat(c);
    const wood = M(0x9a6a3c), dark = M(0x6e4524), cloth = M(0xd8403a), cream = M(0xfff1c9);
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0) => {
      const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, 0); o.castShadow = true; o.receiveShadow = true; g.add(o); return o;
    };
    add(new THREE.CylinderGeometry(0.27, 0.27, 0.04, 20), wood, 0, COFFEE.topH - 0.02, 0);
    add(new THREE.CylinderGeometry(0.035, 0.045, COFFEE.topH - 0.04, 8), dark, 0, (COFFEE.topH - 0.04) / 2, 0);
    for (const r of [0, Math.PI / 2]) add(new THREE.BoxGeometry(0.42, 0.04, 0.06), dark, 0, 0.02, 0, 0, r);
    // a little checked doily under the mug + yesterday's paper folded on the edge
    add(new THREE.CylinderGeometry(0.13, 0.13, 0.005, 16), cloth, 0, COFFEE.topH + 0.003, 0);
    add(new THREE.CylinderGeometry(0.1, 0.1, 0.006, 16), cream, 0, COFFEE.topH + 0.006, 0);
    add(new THREE.BoxGeometry(0.2, 0.012, 0.14), M(0xf4f1e8), -0.12, COFFEE.topH + 0.006, 0.12, 0, 0.3);
    rigidSkin(g);
    staticCylinder(v1.set(this.table.x, this.table.y + COFFEE.topH / 2, this.table.z), COFFEE.topH / 2, 0.24);
  }
  /** A crate of BBQ sauces (ketchup, mustard: painted on), the hot sauce stands on it. */
  private buildCrate(scene: THREE.Scene, at: THREE.Vector3) {
    const g = new THREE.Group(); g.position.copy(at); scene.add(g);
    const add = (geo: THREE.BufferGeometry, c: number, x: number, y: number, z: number) => {
      const o = new THREE.Mesh(geo, toonMat(c)); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; g.add(o); return o;
    };
    add(new THREE.BoxGeometry(0.56, 0.4, 0.42), 0xa87445, 0, 0.2, 0);
    for (const y of [0.1, 0.3]) add(new THREE.BoxGeometry(0.58, 0.03, 0.44), 0x7a4a26, 0, y, 0);
    add(new THREE.CylinderGeometry(0.045, 0.05, 0.2, 10), 0xd8281f, -0.17, 0.5, -0.08);   // ketchup
    add(new THREE.ConeGeometry(0.03, 0.05, 8), 0xffffff, -0.17, 0.625, -0.08);
    add(new THREE.CylinderGeometry(0.045, 0.05, 0.2, 10), 0xf2c418, -0.06, 0.5, -0.13);   // mustard
    add(new THREE.ConeGeometry(0.03, 0.05, 8), 0xd8281f, -0.06, 0.625, -0.13);
    rigidSkin(g);
    staticBox(v1.set(at.x, at.y + 0.2, at.z), v2.set(0.28, 0.2, 0.21), 0);
  }

  // ================================================================== queries
  /** His mug is in its spot on the table (or close to it, not in anyone's hooves). */
  mugHome() {
    const m = this.mug;
    if (m.banked || m.heldBy) return false;
    if (m.dockedIn === this.socket) return true;
    const t = m.body.translation();
    return Math.hypot(t.x - this.top.x, t.z - this.top.z) < COFFEE.onTable && Math.abs(t.y - this.top.y) < 0.3;
  }
  get markPos() { return v1.copy(this.top).setY(this.top.y + 0.5); }
  /** Where the coffee is now (HUD / arrows). */
  get mugPos() { return this.mug.synced.currP; }
  /** A muddy pig with a hoof (or the snout) at his coffee: RMB = mud in it. */
  mudNear(p: Pig) {
    if (!this.full || this.spiked || this.phase === 2 || this.mug.banked || this.mug.heldBy) return false;
    if (p.out || p.cage || p.heldBy || p.held || p.mode !== 'normal' || !(p.muddy > 0)) return false;
    const t = this.mug.synced.currP;
    return Math.hypot(p.pos.x - t.x, p.pos.z - t.z) < COFFEE.mudR && p.pos.y + 1.4 > t.y;
  }

  // ================================================================== Bob (host)
  /** He sits down with the paper (a fresh cup if the last one went over). */
  begin() {
    this.phase = 1;
    if (!this.full) { this.full = true; this.setSpiked(0); }
    this.spat = 0;
    if (this.mugHome() && this.mug.dockedIn !== this.socket) HANDS.dock(this.socket, this.mug);
  }
  /** The paper comes down, he lifts the mug off the table. */
  startSip() {
    const bob = G.farmer as BobLike | null;
    if (!bob) return;
    if (!this.ignored) { ignorePair(this.mug.body, bob.body, true); this.ignored = true; }
    if (this.mug.dockedIn) HANDS.undock(this.mug, null, false);
    this.mug.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.phase = 2; this.sipT0 = G.time;
  }
  /** Back on the table. */
  endSip() {
    this.phase = 1;
    this.mug.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    HANDS.dock(this.socket, this.mug);
    if (this.full) G.audio.play('wood', { pos: this.top, vol: 0.25, pitch: 1.8 });
  }
  /** The break is over (the chore ended, a noise, the phone…): the mug goes back if he holds it. */
  endBreak() {
    if (this.phase === 2) this.endSip();
    this.phase = 0;
  }
  /** Spit-take: the mug flies out of his hand (empty now), the break is over. Returns what was in it. */
  spit(dir: THREE.Vector3) {
    const k = this.spiked;
    this.phase = 0; this.full = false; this.spat = k; this.hot = 0;
    this.mug.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.mug.body.setLinvel({ x: dir.x * 2.2 + this.right.x * 1.2, y: 2.4, z: dir.z * 2.2 + this.right.z * 1.2 }, true);
    this.mug.body.setAngvel({ x: 6, y: 2, z: -5 }, true);
    this.setSpiked(k);   // (colour stays until the coffee's gone: hidden below)
    if (this.coffee) this.coffee.visible = false;
    return k;
  }
  /** Admin: spike it now (1 hot sauce, 2 mud). */
  spike(k: number) { if (G.net === 'client') return; this.full = true; this.hot = k === 1 ? COFFEE.hot : 0; this.setSpiked(k); }
  private setSpiked(k: number) {
    this.spiked = k;
    this.coffeeMat?.color.setHex(COFFEE_COL[k] ?? COFFEE_COL[0]);
    if (this.coffee) this.coffee.visible = this.full;
  }
  private addHot(amt: number, by: Pig | null) {
    if (G.net === 'client') return;
    this.hot += amt;
    if (this.hot >= COFFEE.hot && this.spiked !== 1) {
      this.setSpiked(1);
      const t = this.mug.body.translation();
      G.audio.play('sizzle', { pos: v1.set(t.x, t.y, t.z), vol: 0.5, pitch: 1.5 });
      G.fx.bits(v1.set(t.x, t.y + this.mug.half, t.z), { count: 10, color: 0xff5a2a, spread: 0.03, speed: 0.8, up: 1.2, life: 0.5, size: 0.04, grow: 0, alpha: 1 });
      G.events.push({ type: 'coffeeSpiked', who: by ?? undefined });
    }
  }
  /** A muddy hoof in his coffee (host). */
  private mudIt(p: Pig) {
    this.setSpiked(2);
    p.muddyUntil = p.now;   // the mud is in the cup now
    const t = this.mug.synced.currP;
    p.touch(v1.copy(t).setY(t.y + this.mug.half));
    G.audio.play('splat', { pos: t, vol: 0.6, pitch: 1.5 });
    G.fx.bits(v1.copy(t).setY(t.y + this.mug.half), { count: 8, color: 0x6b4a2b, speed: 1, up: 1, life: 0.45, size: 0.05, grow: 0, alpha: 1 });
    G.events.push({ type: 'coffeeSpiked', who: p, why: 'mud' });
  }

  // ================================================================== fixed step (host)
  step() {
    const bob = G.farmer as BobLike | null;
    const onBreak = !!bob && bob.state === 'routine' && bob.doing && bob.chores[bob.choreIdx]?.id === 'paper';
    if (this.phase && !onBreak) this.endBreak();
    // the sip: the mug rides in his right hand (the rig's pose from the last frame)
    if (this.phase === 2 && bob) {
      const h = bob.visual.rig.handR;
      h.updateWorldMatrix(true, false);
      const p = h.localToWorld(v1.set(0, -0.06, 0.08));
      const k = (G.time - this.sipT0) / COFFEE.sip;
      const tip = k > 0.3 && k < 0.75 ? 0.55 : 0;   // tipped to his lips
      q1.setFromAxisAngle(UP, bob.yaw + Math.PI / 2).multiply(q2.setFromAxisAngle(ZAX, -tip));
      this.mug.body.setNextKinematicTranslation(p);
      this.mug.body.setNextKinematicRotation(q1);
    }
    // a muddy hoof in it
    for (const p of G.pigs as Pig[]) if (p.input.grabP && this.mudNear(p)) { this.mudIt(p); break; }
  }
  /** New round: a fresh cup on the table, the bottle full (props reset first). */
  reset() {
    this.phase = 0; this.sipT0 = -10; this.hot = 0; this.spat = 0; this.full = true;
    this.setSpiked(0);
    if (G.net !== 'client') HANDS.dock(this.socket, this.mug);
  }

  // ================================================================== network
  netState(n: number[]) { n.push(this.phase, Math.round(this.sipT0 * 100) / 100, this.spiked, this.full ? 1 : 0, this.spat); }
  netApply(n: number[]) {
    if (n.length < 5) return;
    this.phase = n[0]; this.sipT0 = n[1]; this.spat = n[4];
    const full = n[3] === 1;
    if (n[2] !== this.spiked || full !== this.full) { this.full = full; this.setSpiked(n[2]); }
  }

  // ================================================================== render (every browser)
  render(dt: number) {
    if (!this.full || this.mug.banked || !this.mug.obj.visible) return;
    this.steamT -= dt;
    if (this.steamT > 0) return;
    this.steamT = 0.5 + Math.random() * 0.4;
    const t = this.mug.obj.position;
    G.fx.puff(v1.set(t.x, t.y + this.mug.half + 0.04, t.z), { count: 1, color: 0xffffff, spread: 0.02, speed: 0.08, up: 0.45, life: 1.3, size: 0.1, grow: 0.22, alpha: 0.3 });
    if (this.spiked === 1 && Math.random() < 0.5)
      G.fx.bits(v1.set(t.x, t.y + this.mug.half, t.z), { count: 1, color: 0xff6a2a, spread: 0.03, speed: 0.3, up: 0.6, life: 0.4, size: 0.03, grow: 0, alpha: 1 });
  }
}
