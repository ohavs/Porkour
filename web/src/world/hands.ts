import * as THREE from 'three';
import { clone as skClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { RAPIER, ignorePair, groups, L } from '../core/physics';
import { G } from '../game/ctx';
import { clamp, wrapAngle } from '../core/util';
import type { Pig } from '../pig/pig';
import type { Prop } from './props';
import type { IconId } from '../game/icons';
import { CENTER } from '../pig/pigBody';

/**
 * Active hands (user: "like Burglin' Gnomes: the pig reaches out, the thing sticks to its hooves, you move it and put
 * it where it goes — it snaps into place; real actions, not mini-games"). Shared by every farm:
 *  - aim: what you hold goes where your crosshair is (within reach; the mouse wheel stretches the arms / neck further),
 *    it keeps upright and faces where you face; R tips it over (pouring);
 *  - sockets: places a held thing snaps into (a filter onto the paper, a tray into the oven, a coin into the slot):
 *    a ghost shows where it goes, close by it's pulled in (magnet) and clicks in. `dock` = it stays there (grab it to
 *    take it out again), else the socket takes it (a log into the fire). `bin` sockets also catch things just dropped in;
 *  - pouring: containers (a bag of weed, a watering can, a bucket, a pot…) pour a stream when tipped; whatever is
 *    under the spout (a receiver: the paper, the bong, a plant, the kettle…) gets it;
 *  - handles: machine parts the hoof takes hold of and moves (crank wheels, stirring spoons, levers, door handles,
 *    bolts, a paper being rolled): they follow the hoof along their own path;
 *  - dispensers: a spot that hands you a fresh thing (a paper from the booklet, a coin from the cup).
 * Host-authoritative: sockets / pours / handles change state on the host; players see bodies + synced states.
 */
export const REACH = {
  /** Reach centre (pig model space: feet = 0, facing +z) and radius: four legs = the snout, two legs = the hooves. */
  four: { c: new THREE.Vector3(0, 0.6, 0.5), r: 0.5, minZ: 0.5, minY: 0.06, maxY: 1.2 },
  two: { c: new THREE.Vector3(0, 1.0, 0.14), r: 0.76, minZ: 0.24, minY: 0.06, maxY: 1.9 },
  /** The mouse wheel stretches the arms (two legs) / the neck (four legs) up to this much further. */
  ext: 0.55,
  /** The crosshair picks a thing / handle within this of it (plus the thing's size). */
  pick: 0.42,
  /** Things are dropped into a magnet's pull within this share of its radius, snap at `snap` m. */
  snap: 0.07,
};

export interface Socket {
  id: number;
  /** World pose (sockets on a body follow it). */
  p: THREE.Vector3; q: THREE.Quaternion;
  on: { body: RAPIER.RigidBody; lp: THREE.Vector3; lq: THREE.Quaternion } | null;
  /** Magnet radius. */
  r: number;
  accepts(it: Prop, by: Pig | null): boolean;
  /** true = the thing stays there (grab it to take it out), false = the socket takes it (onSnap uses it up). */
  dock: boolean;
  /** Also catches things that are dropped / thrown in (a hopper, the fire, a pot). */
  bin?: boolean;
  onSnap?(it: Prop, by: Pig | null): void;
  onOut?(it: Prop, by: Pig | null): void;
  occupant: Prop | null;
  /** Ghost preview of where it goes (default on). */
  ghost?: boolean;
  /** Keep the item's yaw (round things: any angle fits) — only the tilt is matched. */
  anyYaw?: boolean;
  /** HUD: what this place is (shown next to the hold prompt: "it goes there"). */
  icon?: IconId;
}
export interface Receiver {
  id: number;
  /** Middle of its opening (world). */
  at(out: THREE.Vector3): THREE.Vector3;
  r: number;
  accepts(stuff: string): boolean;
  /** Host: `amount` of `stuff` landed in it. */
  fill(stuff: string, amount: number, by: Pig | null): void;
}
export interface Handle {
  id: number; icon: IconId;
  /** How it moves (the HUD hint: circle the mouse for a crank). */
  kind: 'crank' | 'lever' | 'slide';
  heldBy: Pig | null;
  /** Its state (angle / 0..1), synced by its owner. */
  v: number;
  /** Where the hoof holds it (world), now. */
  knob(out: THREE.Vector3): THREE.Vector3;
  ready(p: Pig): boolean;
  /** Host: the hoof wants to be at `goal`: the handle moves along its path toward it (rate-limited). */
  drive(goal: THREE.Vector3, p: Pig, dt: number): void;
}
export interface Dispenser {
  at: THREE.Vector3; r: number; icon: IconId;
  ready(p: Pig): boolean;
  /** Host: a fresh thing at `at` (it goes straight into the pig's grip). */
  take(p: Pig, at: THREE.Vector3): Prop | null;
}
/** What a pig would take hold of now (the crosshair's pick). */
export type Target = { h: import('../game/ctx').Holdable; handle?: undefined; disp?: undefined }
  | { handle: Handle; h?: undefined; disp?: undefined } | { disp: Dispenser; h?: undefined; handle?: undefined };

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3(), vS = new THREE.Vector3(), vR = new THREE.Vector3();
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), qF = new THREE.Quaternion(), vF = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const smooth = (k: number) => k * k * (3 - 2 * k);

class Hands {
  sockets: Socket[] = [];
  receivers: Receiver[] = [];
  handles: Handle[] = [];
  dispensers: Dispenser[] = [];
  private pourers: Prop[] = [];
  private scene: THREE.Scene | null = null;
  private ghost: THREE.Object3D | null = null; private ghostOf = '';
  private ghostMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.35, depthWrite: false });
  private ring: THREE.Mesh | null = null;

  /** Game start (after the farm is built). */
  init(scene: THREE.Scene, props: Prop[]) {
    this.scene = scene;
    this.pourers = props.filter((p) => p.def.pour || p.pourNow);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.14, 28), new THREE.MeshBasicMaterial({ color: 0xffe14a, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide }));
    ring.renderOrder = 11; ring.visible = false; scene.add(ring); this.ring = ring;
  }

  // ------------------------------------------------------------------ registration
  socket(s: Omit<Socket, 'id' | 'occupant' | 'p' | 'q'> & { p?: THREE.Vector3; q?: THREE.Quaternion }): Socket {
    const out = s as Socket;
    out.id = this.sockets.length; out.occupant = null;
    out.p = s.p?.clone() ?? new THREE.Vector3(); out.q = s.q?.clone() ?? new THREE.Quaternion();
    this.sockets.push(out); this.pose(out);
    return out;
  }
  receiver(r: Omit<Receiver, 'id'>): Receiver { const o = r as Receiver; o.id = this.receivers.length; this.receivers.push(o); return o; }
  handle<T extends Handle>(h: Omit<T, 'id' | 'heldBy'> & Partial<Pick<T, 'heldBy'>>): T { const o = h as T; o.id = this.handles.length; o.heldBy = null; this.handles.push(o); return o; }
  dispenser(d: Dispenser) { this.dispensers.push(d); return d; }

  private pose(s: Socket) {
    if (!s.on) return;
    const t = s.on.body.translation(), r = s.on.body.rotation();
    q1.set(r.x, r.y, r.z, r.w);
    s.p.copy(s.on.lp).applyQuaternion(q1).add(v1.set(t.x, t.y, t.z));
    s.q.copy(q1).multiply(s.on.lq);
  }

  // ------------------------------------------------------------------ reach
  /** How far the wheel stretches this pig's arms / neck (0..1). */
  ext(p: Pig) { return clamp(p.input.reach ?? 0, 0, 1); }
  /** Reach centre (world) of a pig now; returns its radius (with the wheel's stretch). */
  reach(p: Pig, out: THREE.Vector3) {
    const R = p.standing ? REACH.two : REACH.four;
    out.copy(R.c).applyAxisAngle(UP, p.yaw).add(p.pos);
    out.y -= CENTER[p.standing ? 'two' : 'four'];
    return R.r + REACH.ext * this.ext(p);
  }
  /** The crosshair point (world) this pig aims at (sent by its player). */
  aimAt(p: Pig, out: THREE.Vector3) { const i = p.input; return out.set(p.pos.x + (i.ax ?? 0), p.pos.y + (i.ay ?? 0.3), p.pos.z + (i.az ?? 1)); }
  /**
   * Where the pig wants its hoof / snout: the crosshair, kept within reach and in front of it. `loose` (a machine part
   * in the hoof): anywhere within reach — pulling a door / a lever toward yourself is fine. `lean`: a hoof already on a
   * machine part may lean that much further (pushing the roll / a lever to its end from a step back).
   */
  aimGoal(p: Pig, out: THREE.Vector3, loose = false, lean = 0) {
    const R = p.standing ? REACH.two : REACH.four, e = this.ext(p);
    const c = v4, rr = this.reach(p, c) + lean;
    const d = this.aimAt(p, out).sub(c);
    if (d.length() > rr) d.setLength(rr);
    // pig space (+z = forward): keep it in front of the pig, between the ground and over its head
    const s = Math.sin(p.yaw), co = Math.cos(p.yaw);
    const lx = d.x * co - d.z * s, lz = Math.max(d.x * s + d.z * co, loose ? -R.c.z - 0.1 : R.minZ - R.c.z);
    const feet = p.pos.y - CENTER[p.standing ? 'two' : 'four'];
    const y = clamp(c.y + d.y, feet + R.minY, feet + R.maxY + e * 0.5);
    return out.set(c.x + lx * co + lz * s, y, c.z - lx * s + lz * co);
  }

  // ------------------------------------------------------------------ what the crosshair picks
  target(p: Pig): Target | null {
    this.far = null;
    if (p.held || p.handle || p.out || p.cage || p.heldBy || p.mode !== 'normal') return null;
    const c = v2, rr = this.reach(p, c);
    const A = this.aimAt(p, v3);
    const inReach = rr + 0.5;
    let best: Target | null = null, bd = Infinity, far: Target | null = null, fd = Infinity;
    const consider = (t: Target, pos: THREE.Vector3, size: number) => {
      const d = pos.distanceTo(A) - size;
      if (d >= REACH.pick) return;
      if (pos.distanceTo(c) - size > inReach) { if (d < fd) { fd = d; far = t; } return; }
      if (d < bd) { bd = d; best = t; }
    };
    for (const h of G.holdables) {
      if (h === (p as unknown) || !p.canGrab(h)) continue;
      const t = h.body.translation();
      // (a thing sitting in its place counts as a little further: the spoon in the bowl wins over the bowl)
      consider({ h }, v1.set(t.x, t.y, t.z), h.radius * 0.8 - ((h as Prop).dockedIn ? 0.15 : 0));
    }
    for (const hd of this.handles) if (!hd.heldBy && hd.ready(p)) consider({ handle: hd }, hd.knob(v1), 0.05);
    for (const ds of this.dispensers) if (ds.ready(p)) consider({ disp: ds }, v1.copy(ds.at), ds.r);
    if (best) return best;
    // the crosshair is on something out of reach: nothing (the HUD shows the wheel: reach further) — else, nothing
    // under the crosshair at all: the old way (the nearest thing in front of the snout)
    if (far) { this.far = far; return null; }
    const h = p.findGrabTarget();
    return h ? { h } : null;
  }
  /** The last target() found something under the crosshair, but out of reach (HUD: roll the wheel). */
  far: Target | null = null;
  /** Where to draw the pick ring (world), or null. */
  targetPos(t: Target, out: THREE.Vector3) {
    if (t.h) { const b = t.h.body.translation(); return out.set(b.x, b.y, b.z); }
    if (t.handle) return t.handle.knob(out);
    return out.copy(t.disp!.at);
  }

  // ------------------------------------------------------------------ magnet (pig holdStep, host)
  /** The free socket that takes what this pig holds, nearest to it within its pull (or null). */
  socketFor(it: Prop, by: Pig | null, range = 0): Socket | null {
    const ip = it.body.translation();
    let best: Socket | null = null, bd = Infinity;
    for (const s of this.sockets) {
      if (s.occupant || !s.accepts(it, by)) continue;
      const d = Math.hypot(ip.x - s.p.x, ip.y - s.p.y, ip.z - s.p.z);
      // just taken out of this one: it doesn't pull it back until it has been carried away from it
      if (it.outOf === s) { if (d > s.r * 1.3) it.outOf = null; else continue; }
      if (d < (range || s.r) && d < bd) { bd = d; best = s; }
    }
    return best;
  }
  /** Pull the hand goal + the orientation toward the socket it fits (blend by how close). Returns the pull (0..1). */
  magnet(p: Pig, it: Prop, goal: THREE.Vector3, q: THREE.Quaternion) {
    const s = this.socketFor(it, p);
    if (!s) return 0;
    const ip = it.body.translation(), ir = it.body.rotation(), hp = p.grip.pos;
    const d = Math.hypot(ip.x - s.p.x, ip.y - s.p.y, ip.z - s.p.z);
    const k = smooth(clamp((s.r - d) / (s.r * 0.55), 0, 1));
    const sq = this.alignQ(s, it, q2);
    // the hand goes where it must be for the thing's centre to land on the socket
    v1.set(hp.x - ip.x, hp.y - ip.y, hp.z - ip.z).applyQuaternion(q1.set(ir.x, ir.y, ir.z, ir.w).invert()).applyQuaternion(sq).add(s.p);
    goal.lerp(v1, k);
    q.slerp(sq, k);
    return k;
  }
  /**
   * Pouring help (the magnet of a pour): tipped over near an opening that takes what it pours, the hand slides so the
   * spout comes over the opening (a little above it).
   */
  pourMagnet(p: Pig, it: Prop, goal: THREE.Vector3) {
    const st = this.stuffOf(it);
    if (!st || it.left <= 0.001) return null;
    // (own temps: accepts() / at() use the shared ones)
    const sp = this.spout(it, vS);
    let best: Receiver | null = null, bd = 0.55;
    for (const r of this.receivers) {
      if (!r.accepts(st.stuff)) continue;
      r.at(vR);
      const d = Math.hypot(sp.x - vR.x, sp.z - vR.z);
      if (d < bd && sp.y > vR.y - 0.3) { bd = d; best = r; }
    }
    if (!best) return null;
    best.at(vR);
    const k = smooth(clamp((0.55 - bd) / 0.3, 0, 1)) * clamp(p.tiltK * 3, 0, 1);
    goal.x += (vR.x - sp.x) * k; goal.z += (vR.z - sp.z) * k;
    if (sp.y < vR.y + 0.18) goal.y += (vR.y + 0.18 - sp.y) * k;
    return best;
  }
  /** While it's tipped over an opening it doesn't bump into what it pours into (it would sit on the rim, not tip). */
  ghostly(it: Prop, on: boolean) {
    if (it.ghosted === on) return;
    it.ghosted = on;
    it.body.collider(0)?.setCollisionGroups(on ? groups(L.PROP, L.PROP) : groups(L.PROP));
  }
  /** HUD: where what I hold goes (the nearest place that takes it, any distance) — its icon, or ''. */
  destIcon(p: Pig): IconId | '' {
    const it = p.held as Prop | null;
    if (!it || it.kind !== 'prop') return '';
    let best: Socket | null = null, bd = 60;
    for (const s of this.sockets) {
      if (s.occupant || !s.icon || !s.accepts(it, p)) continue;
      const d = s.p.distanceTo(it.synced.currP); if (d < bd) { bd = d; best = s; }
    }
    return best?.icon ?? '';
  }
  /** The rotation it will sit at in a socket. */
  private alignQ(s: Socket, it: Prop, out: THREE.Quaternion) {
    if (!s.anyYaw) return out.copy(s.q);
    const r = it.body.rotation();
    const e = new THREE.Euler().setFromQuaternion(q1.set(r.x, r.y, r.z, r.w), 'YXZ');
    return out.setFromAxisAngle(UP, e.y).premultiply(s.q);
  }

  // ------------------------------------------------------------------ host step
  stepHost(dt: number) {
    for (const s of this.sockets) {
      this.pose(s);
      const o = s.occupant;
      if (o && (o.banked || o.dockedIn !== s)) { s.occupant = null; if (o.dockedIn === s) o.dockedIn = null; continue; }
      if (o && s.on) { o.body.setNextKinematicTranslation(s.p); o.body.setNextKinematicRotation(this.alignQ(s, o, q2)); }
    }
    // held things click into a socket they're right at
    for (const p of G.pigs as Pig[]) {
      const it = p.held as Prop | null;
      if (!it || it.kind !== 'prop' || it.banked) continue;
      const s = this.socketFor(it, p, 0.6);
      if (!s) continue;
      const ip = it.body.translation();
      if (Math.hypot(ip.x - s.p.x, ip.y - s.p.y, ip.z - s.p.z) < Math.max(REACH.snap, s.r * (s.bin ? 0.6 : 0.16))) this.snap(s, it, p);
    }
    // bins catch dropped / thrown things
    for (const s of this.sockets) {
      if (!s.bin || s.occupant) continue;
      for (const it of G.props as Prop[]) {
        if (it.banked || it.heldBy || it.dockedIn || G.time < it.snapCd) continue;
        const ip = it.synced.currP;
        if (Math.abs(ip.x - s.p.x) > s.r || Math.abs(ip.z - s.p.z) > s.r || Math.abs(ip.y - s.p.y) > s.r * 1.4) continue;
        if (Math.hypot(ip.x - s.p.x, ip.z - s.p.z) < s.r && s.accepts(it, null)) this.snap(s, it, null);
      }
    }
    this.pourStep(dt);
  }

  /** Host: it clicks in. */
  snap(s: Socket, it: Prop, by: Pig | null) {
    if (it.heldBy?.release) { const h = it.heldBy; h.release(false); if (it.helper?.release) it.helper.release(false); void h; }
    it.snapCd = G.time + 0.8;
    G.audio.play('unlock', { pos: s.p, vol: 0.55, pitch: 1.7 });
    G.fx.bits(s.p, { count: 8, color: 0xfff1a8, spread: 0.05, speed: 1.2, up: 0.8, life: 0.35, size: 0.05, grow: 0, alpha: 1 });
    if (s.dock) this.dock(s, it);
    s.onSnap?.(it, by);
  }
  /** Host: put it into a socket and keep it there (no physics until someone takes it out). */
  dock(s: Socket, it: Prop) {
    if (it.dockedIn) this.undock(it, null, false);
    s.occupant = it; it.dockedIn = s;
    it.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    it.body.setTranslation(s.p, true); it.body.setRotation(this.alignQ(s, it, q2), true);
    it.body.setLinvel({ x: 0, y: 0, z: 0 }, true); it.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    if (s.on) ignorePair(it.body, s.on.body, true);
    it.synced.capture(); it.synced.capture();
  }
  /** Host: taken out of its socket (a pig grabs it / it's used up / a new round). */
  undock(it: Prop, by: Pig | null, notify = true) {
    const s = it.dockedIn as Socket | null;
    if (!s) return;
    it.dockedIn = null; it.outOf = s;
    if (s.occupant === it) s.occupant = null;
    if (s.on) ignorePair(it.body, s.on.body, false);
    if (G.net !== 'client') it.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    if (notify) s.onOut?.(it, by);
  }
  /** Host, a new round: every socket empty again. */
  reset() {
    for (const s of this.sockets) { const o = s.occupant; if (o) this.undock(o, null, false); s.occupant = null; }
    for (const h of this.handles) h.heldBy = null;
  }

  // ------------------------------------------------------------------ pouring
  /** Tipped far enough to pour (0 = no, up to 1 = upside down). */
  flow(it: Prop, q = it.body.rotation()) {
    const up = vF.set(0, 1, 0).applyQuaternion(qF.set(q.x, q.y, q.z, q.w));
    return clamp((0.35 - up.y) / 0.6, 0, 1);
  }
  stuffOf(it: Prop) { return it.pourNow ? it.pourNow() : it.def.pour ? { stuff: it.def.pour.stuff, color: it.def.pour.color } : null; }
  spout(it: Prop, out: THREE.Vector3, pos?: THREE.Vector3, q?: THREE.Quaternion) {
    const sp = it.def.pour?.spout ?? [0, it.half, 0];
    if (pos && q) return out.set(sp[0], sp[1], sp[2]).applyQuaternion(q).add(pos);
    const t = it.body.translation(), r = it.body.rotation();
    return out.set(sp[0], sp[1], sp[2]).applyQuaternion(q1.set(r.x, r.y, r.z, r.w)).add(v2.set(t.x, t.y, t.z));
  }
  /** The receiver under a spout that takes this stuff (or null). */
  under(spIn: THREE.Vector3, stuff: string) {
    const sp = vS.copy(spIn);
    let best: Receiver | null = null, bd = Infinity;
    for (const r of this.receivers) {
      if (!r.accepts(stuff)) continue;
      r.at(v3);
      const d = Math.hypot(sp.x - v3.x, sp.z - v3.z);
      if (d > r.r || sp.y < v3.y - 0.08 || sp.y > v3.y + 1.6 || d > bd) continue;
      bd = d; best = r;
    }
    return best;
  }
  private pourStep(dt: number) {
    for (const it of this.pourers) {
      if (it.banked || it.left <= 0.001) continue;
      const k = this.flow(it);
      if (k <= 0) continue;
      const st = this.stuffOf(it);
      if (!st) continue;
      const amt = Math.min(it.left, (it.def.pour?.rate ?? 1) * dt * (0.35 + 0.65 * k));
      it.setLeft(it.left - amt);
      const sp = this.spout(it, v4);
      const r = this.under(sp, st.stuff);
      if (r) r.fill(st.stuff, amt, (it.heldBy?.kind === 'pig' ? it.heldBy : null) as Pig | null);
    }
  }
  /** Every browser: the streams (tipped containers with something in them). */
  private pourFx(dt: number) {
    for (const it of this.pourers) {
      if (it.banked || !it.obj.visible || it.left <= 0.001) continue;
      const k = this.flow(it, it.obj.quaternion);
      if (k <= 0) continue;
      const st = this.stuffOf(it);
      if (!st) continue;
      const sp = this.spout(it, v1, it.obj.position, it.obj.quaternion);
      const n = Math.random() < dt * 40 * (0.4 + k) ? 1 : 0;
      if (n) G.fx.bits(sp, { count: 1 + (k > 0.6 ? 1 : 0), color: st.color, spread: 0.02, speed: 0.4, up: -0.6, grav: 9, life: 0.55, size: it.def.pour?.size ?? 0.05, grow: 0, alpha: 1 });
      if (Math.random() < dt * 3) G.audio.play(it.def.pour?.sound ?? 'pour', { pos: sp, vol: 0.35, pitch: 1.1, minGap: 0.25 });
    }
  }

  /** Host: a machine's spout (a pump, a tap, a spigot) lets out `amount` of `stuff`: whatever is under it gets it. */
  emit(sp: THREE.Vector3, stuff: string, amount: number, by: Pig | null) {
    const r = this.under(sp, stuff);
    if (r) r.fill(stuff, amount, by);
    return r;
  }
  /** Every browser: a stream falling from a spout (fx). */
  streamFx(sp: THREE.Vector3, color: number, dt: number, size = 0.05) {
    if (Math.random() < dt * 45) G.fx.bits(sp, { count: 2, color, spread: 0.02, speed: 0.3, up: -0.8, grav: 9, life: 0.55, size, grow: 0, alpha: 1 });
  }

  // ------------------------------------------------------------------ every frame (cues for my pig)
  render(dt: number) {
    this.pourFx(dt);
    const L = G.localPig as Pig | null;
    // the ghost: where what I hold goes (the nearest socket that takes it, within 3.5 m)
    let gs: Socket | null = null;
    const it = L?.held as Prop | null;
    if (L && it?.kind === 'prop' && !it.banked) {
      let bd = 3.5;
      const ip = it.synced.currP;
      for (const s of this.sockets) {
        if (s.occupant || s.ghost === false || !s.accepts(it, L)) continue;
        const d = ip.distanceTo(s.p); if (d < bd) { bd = d; gs = s; }
      }
    }
    if (gs && it) {
      const key = it.def.id ?? '';
      if (this.ghostOf !== key) {
        if (this.ghost) this.scene?.remove(this.ghost);
        this.ghost = this.makeGhost(it); this.ghostOf = key;
        if (this.ghost) this.scene?.add(this.ghost);
      }
      if (this.ghost) {
        this.ghost.visible = true;
        this.ghost.position.copy(gs.p); this.ghost.quaternion.copy(gs.anyYaw ? this.alignQ(gs, it, q2) : gs.q);
        this.ghostMat.opacity = 0.22 + 0.16 * Math.sin(G.time * 6);
      }
    } else if (this.ghost) this.ghost.visible = false;
    // the receiver my stream would land in: a ring on its opening
    let ring: THREE.Vector3 | null = null, rr = 0.15;
    if (L && it?.kind === 'prop' && (it.def.pour || it.pourNow) && it.left > 0.001) {
      const st = this.stuffOf(it);
      if (st) {
        let bd = 3;
        for (const r of this.receivers) { if (!r.accepts(st.stuff)) continue; r.at(v2); const d = v2.distanceTo(it.synced.currP); if (d < bd) { bd = d; ring = v3.copy(v2); rr = r.r; } }
      }
    }
    if (this.ring) {
      this.ring.visible = !!ring;
      if (ring) {
        this.ring.position.copy(ring).setY(ring.y + 0.02);
        this.ring.rotation.set(-Math.PI / 2, 0, G.time);
        this.ring.scale.setScalar(Math.max(0.6, rr / 0.14) * (1 + Math.sin(G.time * 5) * 0.08));
      }
    }
  }
  private makeGhost(it: Prop): THREE.Object3D | null {
    try {
      const g = skClone(it.obj.children[0] ?? it.obj) as THREE.Object3D;
      const wrap = new THREE.Group(); wrap.add(g);
      g.position.copy((it.obj.children[0] ?? it.obj).position);
      g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.material = this.ghostMat; m.castShadow = false; m.receiveShadow = false; m.renderOrder = 8; } });
      return wrap;
    } catch { return null; }
  }
}
export const HANDS = new Hands();

// ====================================================================== handle shapes
type Frame = () => { p: THREE.Vector3; q: THREE.Quaternion };
const ID = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
const toWorld = (f: Frame | undefined, local: THREE.Vector3, out: THREE.Vector3) => { const F = f ? f() : ID; return out.copy(local).applyQuaternion(F.q).add(F.p); };
const toLocal = (f: Frame | undefined, world: THREE.Vector3, out: THREE.Vector3) => { const F = f ? f() : ID; return out.copy(world).sub(F.p).applyQuaternion(q1.copy(F.q).invert()); };
const basis = (axis: THREE.Vector3) => {
  const a = axis.clone().normalize(), u = Math.abs(a.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(a).normalize() : new THREE.Vector3(1, 0, 0).cross(a).normalize();
  return { a, u, w: a.clone().cross(u).normalize() };
};

/**
 * A crank / a stirring spoon: the knob goes round `c` (radius r) in the plane across `axis`. The hoof leads it round;
 * it turns at most `max` rad/s (heavy machines). `turn(dθ)` gets every bit it turns (signed).
 */
export function crank(o: { c: THREE.Vector3; axis: THREE.Vector3; r: number; icon: IconId; max?: number; frame?: Frame;
  ready?(p: Pig): boolean; turn?(d: number, p: Pig): void }) {
  const B = basis(o.axis);
  return HANDS.handle<Handle>({
    icon: o.icon, v: 0, kind: 'crank',
    ready: o.ready ?? (() => true),
    knob(out) { v1.copy(o.c).addScaledVector(B.u, Math.cos(this.v) * o.r).addScaledVector(B.w, Math.sin(this.v) * o.r); return toWorld(o.frame, v1, out); },
    drive(goal, p, dt) {
      const l = toLocal(o.frame, goal, v2).sub(o.c);
      const x = l.dot(B.u), y = l.dot(B.w);
      if (Math.hypot(x, y) < o.r * 0.25) return;
      const d = clamp(wrapAngle(Math.atan2(y, x) - this.v), -(o.max ?? 9) * dt, (o.max ?? 9) * dt);
      this.v = wrapAngle(this.v + d);
      if (Math.abs(d) > 1e-4) o.turn?.(d, p);
    },
  });
}
/** A lever / a door: turns about `axis` through `pivot`; `arm` = the knob at v = 0; v stays in [min, max]. */
export function lever(o: { pivot: THREE.Vector3; axis: THREE.Vector3; arm: THREE.Vector3; min: number; max: number; icon: IconId; speed?: number; frame?: Frame;
  ready?(p: Pig): boolean; moved?(v: number, p: Pig): void; v?: number }) {
  const B = basis(o.axis);
  const a0 = Math.atan2(o.arm.dot(B.w), o.arm.dot(B.u)), along = o.arm.dot(B.a), rad = Math.hypot(o.arm.dot(B.u), o.arm.dot(B.w));
  return HANDS.handle<Handle>({
    icon: o.icon, v: o.v ?? 0, kind: 'lever',
    ready: o.ready ?? (() => true),
    knob(out) { const a = a0 + this.v; v1.copy(o.pivot).addScaledVector(B.a, along).addScaledVector(B.u, Math.cos(a) * rad).addScaledVector(B.w, Math.sin(a) * rad); return toWorld(o.frame, v1, out); },
    drive(goal, p, dt) {
      const l = toLocal(o.frame, goal, v2).sub(o.pivot);
      const x = l.dot(B.u), y = l.dot(B.w);
      if (Math.hypot(x, y) < rad * 0.2) return;
      const want = clamp(wrapAngle(Math.atan2(y, x) - a0), o.min, o.max);
      const sp = (o.speed ?? 5) * dt, nv = this.v + clamp(want - this.v, -sp, sp);
      if (nv !== this.v) { this.v = nv; o.moved?.(nv, p); }
    },
  });
}
/** A bolt / a drawer / a paper being rolled: the knob slides from `a` (v = 0) to `b` (v = 1). `ratchet` = only forward. */
export function slider(o: { a: THREE.Vector3; b: THREE.Vector3; icon: IconId; speed?: number; ratchet?: boolean; frame?: Frame;
  ready?(p: Pig): boolean; moved?(v: number, d: number, p: Pig): void }) {
  const ab = o.b.clone().sub(o.a), len2 = ab.lengthSq();
  return HANDS.handle<Handle>({
    icon: o.icon, v: 0, kind: 'slide',
    ready: o.ready ?? (() => true),
    knob(out) { v1.copy(o.a).addScaledVector(ab, this.v); return toWorld(o.frame, v1, out); },
    drive(goal, p, dt) {
      const l = toLocal(o.frame, goal, v2).sub(o.a);
      let want = clamp(l.dot(ab) / len2, 0, 1);
      if (o.ratchet) want = Math.max(want, this.v);
      const sp = (o.speed ?? 2) * dt, nv = this.v + clamp(want - this.v, -sp, sp);
      if (Math.abs(nv - this.v) > 1e-5) { const d = nv - this.v; this.v = nv; o.moved?.(nv, d, p); }
    },
  });
}
