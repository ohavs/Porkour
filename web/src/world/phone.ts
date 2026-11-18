import * as THREE from 'three';
import { staticBox, staticCylinder } from '../core/physics';
import { G } from '../game/ctx';
import { toonMat } from '../render/toon';
import { rigidSkin } from '../render/batch';
import type { Pig } from '../pig/pig';
import type { BobJob } from '../farmer/farmer';

/**
 * Bob's telephone = another breathing window (GDD: coffee, nap, phone call, toilet). An old crank wall phone on a post
 * by his porch rings a few times a round: he hurries over and chats for a while, facing the box (his back to the farm,
 * a narrow view, glancing around now and then). Its wire runs along the ground to a jack on a stake: a pig that yanks
 * the plug mid-call cuts him off ("Hello? HELLO?!") — he rattles the hook, then storms off along the wire to look for
 * whoever did it. Down by the road gate there's a payphone: a pig drops a coin, Bob's phone rings, he comes running
 * (lured all the way to his porch) — oink into the line when he says "Hello?" and he's furious. Two prank calls and he
 * stops falling for it: the next ring sends him straight to the payphone. One synced entity per farm (decor kit).
 */
export const PHONE = {
  /** Real calls: the first one this many s into the round, then every … s; Bob busy = it tries again in … s. */
  first: [110, 160] as [number, number], every: [170, 230] as [number, number], retry: 15,
  /** The caller gives up after … s of ringing; a real call lasts … s; a noise this close (m) cuts it short. */
  ringMax: 30, talk: [16, 24] as [number, number], hear: 9,
  /** Ring cadence: a burst at 0 and at `gap` s, every `period` s. */
  period: 3, gap: 0.8,
  /** Prank calls: the coin drops, the line connects after … s; the payphone works again after … s. */
  dial: 1.6, payCd: 40,
  /** "Hello? … Hello?": how long he listens before hanging up; the caller must stay this close to the payphone (m). */
  hello: 7, lineR: 3,
  /** After … prank calls (within … s of each other) he stops answering: the next ring sends him to the payphone. */
  wise: 2, wiseFor: 150,
  /** Cut off: he rattles the hook this long before he storms off. Plugging it back takes … s. Notices an unplugged jack (m). */
  rattle: 2.4, fixTime: 3, notice: 15, fixAfter: 4,
  /** RMB reach at the jack / the payphone (m). */
  near: 1.3,
};

const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), q1 = new THREE.Quaternion();
const rand = ([a, b]: [number, number]) => a + Math.random() * (b - a);
const mats = new Map<number, THREE.MeshToonMaterial>();
const M = (c: number) => { let m = mats.get(c); if (!m) { m = toonMat(c); mats.set(c, m); } return m; };
type V = [number, number, number];
function add(g: THREE.BufferGeometry, c: number, p: V, parent: THREE.Object3D, r?: V) {
  const o = new THREE.Mesh(g, M(c));
  o.position.set(...p); if (r) o.rotation.set(...r);
  o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
}
const WOOD = 0x9a6a3c, DARK = 0x6e4524, BLACK = 0x26221f, BRASS = 0xd9b04a;
/** Cartoon size (the box reads from across the yard); box centre heights before scaling. */
const S = 1.3, H_WALL = 1.2, H_PAY = 1.1;

interface BobLike {
  pos: THREE.Vector3; state: string;
  looksAt(pt: THREE.Vector3, range?: number): boolean;
}

/** One old phone (Bob's on the wall post, or the payphone): what the build gives back. */
interface Set_ { root: THREE.Group; bells: THREE.Group; crank: THREE.Group; recv: THREE.Group; cord: THREE.Mesh; hook: THREE.Vector3; cordAt: THREE.Vector3 }

/** A coiled cord of unit length along +y (scaled to the distance between the box and the receiver). */
function coilGeometry() {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 160; i++) { const k = i / 160, a = k * Math.PI * 2 * 18; pts.push(new THREE.Vector3(Math.cos(a) * 0.022, k, Math.sin(a) * 0.022)); }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 320, 0.006, 5, false);
}

export class Phones {
  kind = 'phones' as const;
  // ---- Bob's phone (post by the porch) + its jack; the payphone by the road gate
  wall: { base: THREE.Vector3; front: THREE.Vector3; yaw: number; stand: THREE.Vector3; box: THREE.Vector3; jack: THREE.Vector3; plugOut: THREE.Vector3; set: Set_ } | null = null;
  pay: { base: THREE.Vector3; front: THREE.Vector3; yaw: number; at: THREE.Vector3; box: THREE.Vector3; set: Set_ } | null = null;
  private plug = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.11), M(BLACK));
  private wire = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1, 5), M(BLACK));
  // ---- state (host; synced)
  /** 0 = quiet, 1 = a real call ringing / on, 2 = a prank call from the payphone. */
  ring = 0;
  /** Bob holds the receiver (the call is on). */
  off = false;
  plugged = true;
  /** The line went dead while he was on it (unplugged). */
  dead = false;
  /** Bob says "Hello?" on a prank call: the caller can oink at him. */
  listening = false;
  /** The pig that dropped the coin (index), the payphone's receiver is up while it's on the line. */
  caller = -1;
  payReady = true;
  /** Rings since the round started (players restart their bell shake on a change). */
  rings = 0;
  /** An oink went down the line (Bob hears it). */
  oinked = false;
  /** Calls so far (Bob reacts once to each). */
  callNo = 0;
  // ---- host timers
  private ringT = -10; private burst = -1; private nextCall = 0; private dialAt = 0; private payAt = 0;
  private pranks = 0; private prankT = -999; private unplugT = -10;
  // ---- render-only
  private shownRings = 0; private shakeT = 9; private crankA = 0;

  constructor(private scene: THREE.Scene) {
    G.uses.push({ near: (p: Pig) => this.jackNear(p) || this.payNear(p), icon: (p: Pig) => (this.payNear(p) ? 'phone' : 'plug') });
    G.jobs.push({ spot: (bob: BobLike) => this.jobFor(bob) });
    this.reset();
  }

  // ================================================================== build (decor kit)
  /** Bob's wall phone on a post (the box faces `yaw`), its wire to a jack on a stake at (jx, jz). */
  setWall(x: number, y: number, z: number, yaw: number, jx: number, jy: number, jz: number) {
    const front = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const set = this.build(x, y, z, yaw, false);
    const base = new THREE.Vector3(x, y, z), jack = new THREE.Vector3(jx, jy, jz);
    // the jack: a grey box on a stake, the wire goes into the ground under it
    const g = new THREE.Group(); g.position.copy(jack); g.rotation.y = Math.atan2(x - jx, z - jz); this.scene.add(g);
    add(new THREE.BoxGeometry(0.06, 0.62, 0.06), DARK, [0, 0.31, 0], g);
    add(new THREE.BoxGeometry(0.16, 0.18, 0.09), 0x8a8f99, [0, 0.62, 0.05], g);
    add(new THREE.BoxGeometry(0.1, 0.03, 0.02), 0xd9442b, [0, 0.68, 0.1], g);
    rigidSkin(g);
    this.plug.castShadow = true; this.scene.add(this.plug);
    this.wire.castShadow = true; this.scene.add(this.wire);
    const toPost = v1.set(x - jx, 0, z - jz).normalize();
    const plugOut = jack.clone().addScaledVector(toPost, 0.5); plugOut.y = jy + 0.04;
    this.wall = { base, front, yaw, set, stand: base.clone().addScaledVector(front, 0.95), box: base.clone().add(v1.set(0, H_WALL * S, 0)).addScaledVector(front, 0.2 * S), jack, plugOut };
    staticCylinder(new THREE.Vector3(x, y + 1.1, z), 1.1, 0.12);
  }
  /** The payphone by the road gate (a hooded box on a post). */
  setPay(x: number, y: number, z: number, yaw: number) {
    const front = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const set = this.build(x, y, z, yaw, true);
    const base = new THREE.Vector3(x, y, z);
    this.pay = { base, front, yaw, set, at: base.clone().addScaledVector(front, 0.85), box: base.clone().add(v1.set(0, H_PAY * S, 0)).addScaledVector(front, 0.2 * S) };
    staticBox(new THREE.Vector3(x, y + 1.1, z).addScaledVector(front, 0.08), new THREE.Vector3(0.36 * S, 1.1, 0.24 * S), yaw);
  }

  /** An old crank phone: wooden box, two brass bells, a horn mouthpiece, the receiver on its hook (left), a crank (right). */
  private build(x: number, y: number, z: number, yaw: number, pay: boolean): Set_ {
    const root = new THREE.Group(); root.position.set(x, y, z); root.rotation.y = yaw; root.scale.setScalar(S); this.scene.add(root);
    const H = pay ? H_PAY : H_WALL;   // box centre height (before the cartoon scale)
    add(new THREE.BoxGeometry(0.14, H + 0.5, 0.14), DARK, [0, (H + 0.5) / 2, 0], root);
    if (pay) {
      // a hood: back, two sides, a roof, a little sign on top
      add(new THREE.BoxGeometry(0.72, 1.0, 0.05), 0x2f7d5b, [0, H + 0.1, 0.03], root);
      for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.05, 1.0, 0.46), 0x2f7d5b, [s * 0.36, H + 0.1, 0.24], root);
      add(new THREE.BoxGeometry(0.84, 0.07, 0.58), 0x24614a, [0, H + 0.63, 0.24], root);
      add(new THREE.CylinderGeometry(0.15, 0.15, 0.04, 16), 0xfff1c9, [0, H + 0.86, 0.1], root, [Math.PI / 2, 0, 0]);
      add(new THREE.BoxGeometry(0.03, 0.2, 0.03), 0x24614a, [0, H + 0.72, 0.1], root);
      add(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 16), 0x2f7d5b, [0, H + 0.86, 0.105], root, [Math.PI / 2, 0, 0]);
    } else {
      add(new THREE.BoxGeometry(0.6, 0.05, 0.44), 0x8a3b2a, [0, H + 0.42, 0.12], root, [-0.22, 0, 0]);   // a little roof
    }
    const boxC = pay ? 0xc23b2e : WOOD;
    add(new THREE.BoxGeometry(0.36, 0.5, 0.18), boxC, [0, H, 0.16], root);
    add(new THREE.BoxGeometry(0.3, 0.1, 0.02), pay ? 0x8f241b : DARK, [0, H + 0.17, 0.255], root);
    if (pay) { add(new THREE.BoxGeometry(0.1, 0.025, 0.02), BRASS, [0.09, H + 0.17, 0.27], root); add(new THREE.BoxGeometry(0.03, 0.012, 0.02), BLACK, [0.09, H + 0.17, 0.28], root); }
    // mouthpiece horn
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 8), BLACK, [0, H - 0.06, 0.3], root, [Math.PI / 2, 0, 0]);
    add(new THREE.CylinderGeometry(0.055, 0.025, 0.07, 12), BLACK, [0, H - 0.06, 0.38], root, [Math.PI / 2, 0, 0]);
    // bells (shake when it rings)
    const bells = new THREE.Group(); bells.position.set(0, H + 0.2, 0.27); root.add(bells);
    for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.065, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), BRASS, [s * 0.075, 0, 0], bells, [Math.PI / 2, 0, 0]);
    add(new THREE.BoxGeometry(0.012, 0.06, 0.03), BLACK, [0, 0.0, 0.02], bells);
    // crank (right side; turns when a pig dials)
    const crank = new THREE.Group(); crank.position.set(0.19, H - 0.02, 0.18); root.add(crank);
    add(new THREE.CylinderGeometry(0.015, 0.015, 0.05, 6), BLACK, [0.02, 0, 0], crank, [0, 0, Math.PI / 2]);
    add(new THREE.BoxGeometry(0.02, 0.12, 0.02), BLACK, [0.045, -0.05, 0], crank);
    add(new THREE.CylinderGeometry(0.018, 0.018, 0.05, 6), WOOD, [0.07, -0.1, 0], crank, [0, 0, Math.PI / 2]);
    // receiver hook (left side)
    add(new THREE.BoxGeometry(0.06, 0.02, 0.03), BLACK, [-0.21, H + 0.08, 0.18], root);
    rigidSkin(root);
    // the receiver + its coiled cord: loose in the scene (it rides in Bob's hand)
    const recv = new THREE.Group(); recv.scale.setScalar(S); this.scene.add(recv);
    add(new THREE.CylinderGeometry(0.026, 0.026, 0.2, 8), BLACK, [0, 0, 0], recv);
    add(new THREE.CylinderGeometry(0.06, 0.03, 0.07, 12), BLACK, [0, -0.12, 0], recv);
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 8), BLACK, [0, 0.11, 0], recv);
    const cord = new THREE.Mesh(coilGeometry(), M(BLACK)); this.scene.add(cord);
    const hook = new THREE.Vector3(-0.23, H - 0.05, 0.2).multiplyScalar(S).applyAxisAngle(UP, yaw).add(root.position);
    const cordAt = new THREE.Vector3(-0.17, H - 0.18, 0.2).multiplyScalar(S).applyAxisAngle(UP, yaw).add(root.position);
    return { root, bells, crank, recv, cord, hook, cordAt };
  }

  // ================================================================== queries
  /** Bob can come to the phone (the farm has one, and the line is in). */
  get rigged() { return !!this.wall; }
  /** It's ringing (nobody picked it up yet). */
  get ringing() { return this.ring > 0 && !this.off; }
  /** Bob's hand-side spot in front of the box, and which way he faces there. */
  get standAt() { return this.wall?.stand ?? null; }
  get faceYaw() { return this.wall ? Math.atan2(-this.wall.front.x, -this.wall.front.z) : 0; }
  /** Where arrows / the HUD point: the jack (a call is on), the payphone. */
  get jackMark() { return this.wall ? v2.copy(this.wall.jack).setY(this.wall.jack.y + 1.1) : null; }
  get payMark() { return this.pay ? v3.copy(this.pay.base).setY(this.pay.base.y + 2.6) : null; }
  get phoneMark() { return this.wall ? v2.copy(this.wall.base).setY(this.wall.base.y + 2.4) : null; }
  private free(p: Pig) { return !p.out && !p.cage && !p.heldBy && !p.held && p.mode === 'normal'; }
  jackNear(p: Pig) {
    if (!this.wall || !this.free(p)) return false;
    const j = this.wall.jack;
    return Math.hypot(p.pos.x - j.x, p.pos.z - j.z) < PHONE.near && Math.abs(p.pos.y - j.y) < 1.4;
  }
  payNear(p: Pig) {
    if (!this.pay || !this.free(p) || !this.payReady || this.ring || this.dialAt || this.caller >= 0) return false;
    const a = this.pay.at;
    return Math.hypot(p.pos.x - a.x, p.pos.z - a.z) < PHONE.near && Math.abs(p.pos.y - a.y) < 1.4;
  }
  /** HUD: this pig made the prank call and Bob is listening (F = oink into the line). */
  oinkNow(p: Pig) {
    if (!this.listening || this.caller < 0 || G.pigs[this.caller] !== p || !this.pay) return false;
    return Math.hypot(p.pos.x - this.pay.base.x, p.pos.z - this.pay.base.z) < PHONE.lineR;
  }

  // ================================================================== Bob (farmer.ts)
  /** He picks up: the bell stops, the receiver goes to his ear. */
  pickUp() {
    if (!this.ringing) return 0;
    this.off = true; this.dead = !this.plugged;
    G.audio.play('clunk', { pos: this.wall!.box, vol: 0.6, pitch: 1.3 });
    if (this.ring === 2) this.listening = !this.dead;
    return this.ring;
  }
  /** He hangs up (slammed = angry). */
  hangUp(slam = false) {
    if (!this.off) return;
    this.off = false; this.ring = 0; this.dead = false; this.listening = false; this.oinked = false; this.caller = -1;
    G.audio.play('clunk', { pos: this.wall!.box, vol: slam ? 1 : 0.6, pitch: slam ? 0.8 : 1.1 });
    if (slam) G.audio.play('wood', { pos: this.wall!.box, vol: 0.7, pitch: 1.3 });
  }
  /** Chatter on a real call: his rambling, the caller's tinny voice. */
  chat(bobHead: THREE.Vector3) {
    if (Math.random() < 0.62) G.audio.play('phonetalk', { pos: bobHead, vol: 0.75, minGap: 0.6, rand: 0.06 });
    else G.audio.play('phonevoice', { pos: bobHead, vol: 0.4, minGap: 0.6, ref: 1.5 });
  }
  /** Prank call answered and he got oinked at: does he know where it came from by now? */
  pranked(): boolean {
    this.pranks = G.time - this.prankT < PHONE.wiseFor ? this.pranks + 1 : 1;
    this.prankT = G.time;
    return this.pranks >= PHONE.wise;
  }
  /** He's had enough prank calls: a ring from the payphone sends him there instead. */
  get wise() { return this.pranks >= PHONE.wise && G.time - this.prankT < PHONE.wiseFor; }

  // ================================================================== host
  private startRing(kind: 1 | 2, caller: number) {
    this.ring = kind; this.caller = caller; this.ringT = G.time; this.burst = -1; this.rings++; this.callNo++;
    G.events.push({ type: 'phoneRing', text: kind === 2 ? 'prank' : '' });
  }
  private stopRing() { this.ring = 0; this.caller = -1; }
  /** Admin: a call right now (`prank` = from the payphone, as this pig). */
  callNow(prank = false, by: Pig | null = null) {
    if (!this.wall || this.off) return;
    if (this.ring) this.stopRing();
    if (!this.plugged) this.setPlug(true, null);
    this.startRing(prank ? 2 : 1, prank && by ? G.pigs.indexOf(by) : -1);
    if (!prank) this.nextCall = G.time + rand(PHONE.every);
  }
  setPlug(on: boolean, by: Pig | null) {
    if (!this.wall || on === this.plugged) return;
    this.plugged = on;
    G.audio.play('clunk', { pos: this.wall.jack, vol: 0.7, pitch: on ? 1.5 : 1.8 });
    if (!on) {
      this.unplugT = G.time;
      G.fx.bits(v1.copy(this.wall.jack).setY(this.wall.jack.y + 0.6), { count: 6, color: 0xffe08a, speed: 2, up: 1.5, grav: 8, life: 0.3, size: 0.05, grow: 0, alpha: 1 });
      if (by) G.events.push({ type: 'unplugged', who: by });
      if (this.off) { this.dead = true; this.listening = false; G.audio.play('static', { pos: this.wall.box, vol: 0.6 }); }
      else if (this.ring) this.stopRing();   // the caller hears nothing: the bell stops
    }
  }
  /** A pig drops a coin in the payphone: Bob's phone rings in a moment (or the line is dead). */
  private dialFrom(p: Pig) {
    const pay = this.pay!;
    this.caller = G.pigs.indexOf(p); this.dialAt = G.time + PHONE.dial; this.payReady = false; this.payAt = G.time + PHONE.payCd;
    G.audio.play('coin', { pos: pay.box, vol: 0.9 });
    G.audio.play('wood', { pos: pay.box, vol: 0.35, pitch: 1.8 });
    G.events.push({ type: 'dialed', who: p });
  }
  /** The caller oinks into the payphone while Bob listens. */
  private oinkThrough(p: Pig) {
    this.oinked = true; this.listening = false;
    G.audio.play('phoneoink', { pos: this.wall!.box, vol: 1, rand: 0.1 });
    G.audio.play('phoneoink', { pos: this.pay!.box, vol: 0.5, rand: 0.1, minGap: 0 });
    G.events.push({ type: 'prankOink', who: p });
  }
  stepHost() {
    if (!this.wall) return;
    const now = G.time, bob = G.farmer as { phoneFree?(): boolean } | null;
    // a real call now and then (when Bob can take it)
    if (now > this.nextCall && !this.ring && !this.off && !this.dialAt) {
      if (this.plugged && bob?.phoneFree?.()) { this.startRing(1, -1); this.nextCall = now + rand(PHONE.every); }
      else this.nextCall = now + PHONE.retry;
    }
    // ringing: two bursts, a pause… until he picks up or the caller gives up
    if (this.ringing) {
      const t = now - this.ringT, k = Math.floor(t / PHONE.period) * 2 + (t % PHONE.period > PHONE.gap ? 1 : 0);
      if (k !== this.burst) { this.burst = k; this.rings++; G.audio.play('ring', { pos: this.wall.box, vol: 1, minGap: 0.3, rand: 0.02, ref: 7 }); }
      if (t > PHONE.ringMax) { this.stopRing(); G.events.push({ type: 'phoneMissed' }); }
    }
    // the payphone: a coin → the line connects
    if (this.dialAt && now > this.dialAt) {
      this.dialAt = 0;
      if (this.plugged && !this.ring && !this.off) this.startRing(2, this.caller);
      else { G.audio.play('static', { pos: this.pay!.box, vol: 0.6 }); this.caller = -1; }
    }
    if (!this.payReady && now > this.payAt && !this.ring && !this.off) this.payReady = true;
    // pigs: RMB at the jack (pull the plug / put it back), at the payphone (drop a coin); F into the line
    for (const p of G.pigs as Pig[]) {
      const inp = p.input;
      if (inp.grabP && !p.held) {
        if (this.payNear(p)) { this.dialFrom(p); break; }
        if (this.jackNear(p)) { this.setPlug(!this.plugged, p); break; }
      }
      if (inp.oinkP && this.oinkNow(p)) this.oinkThrough(p);
    }
  }
  /** Bob notices the jack hanging out (a farm job: he plugs it back in). */
  private jobFor(bob: BobLike): BobJob | null {
    if (!this.wall || this.plugged || this.off || G.time - this.unplugT < PHONE.fixAfter) return null;
    if (!bob.looksAt(v1.copy(this.wall.jack).setY(this.wall.jack.y + 0.4), PHONE.notice)) return null;
    return this.jobOf();
  }
  jobOf(): BobJob {
    const w = this.wall!;
    return {
      at: w.plugOut.clone().addScaledVector(v1.subVectors(w.plugOut, w.jack).normalize(), 0.5), look: w.jack.clone(), dur: PHONE.fixTime, activity: 'bob.fixPhone',
      still: () => !this.plugged, done: () => this.setPlug(true, null),
    };
  }

  /** New round: quiet, plugged in, the first call a while away. */
  reset() {
    this.ring = 0; this.off = false; this.plugged = true; this.dead = false; this.listening = false; this.oinked = false;
    this.caller = -1; this.payReady = true; this.dialAt = 0; this.payAt = 0; this.pranks = 0; this.prankT = -999;
    this.nextCall = G.time + rand(PHONE.first);
  }

  // ================================================================== network
  netState(n: number[]) {
    n.push(this.ring, (this.off ? 1 : 0) | (this.plugged ? 0 : 2) | (this.dead ? 4 : 0) | (this.listening ? 8 : 0) | (this.payReady ? 16 : 0), this.caller, this.rings);
  }
  netApply(n: number[]) {
    if (n.length < 4) return;
    this.ring = n[0];
    this.off = (n[1] & 1) !== 0; this.plugged = (n[1] & 2) === 0; this.dead = (n[1] & 4) !== 0; this.listening = (n[1] & 8) !== 0; this.payReady = (n[1] & 16) !== 0;
    this.caller = n[2]; this.rings = n[3];
  }

  // ================================================================== render (every browser)
  render(dt: number) {
    const w = this.wall;
    if (w) {
      // bells rattle on every burst
      if (this.rings !== this.shownRings) { this.shownRings = this.rings; if (this.ringing) this.shakeT = 0; }
      this.shakeT += dt;
      const sh = this.shakeT < 0.6 ? Math.sin(this.shakeT * 70) * 0.12 * (1 - this.shakeT / 0.6) : 0;
      w.set.bells.rotation.z = sh;
      // the receiver: on its hook, or at Bob's ear
      const bob = G.farmer as { onPhoneHand?(out: THREE.Vector3, q: THREE.Quaternion): boolean } | null;
      const r = w.set.recv;
      if (this.off && bob?.onPhoneHand?.(r.position, r.quaternion)) { /* in his hand */ }
      else { r.position.copy(w.set.hook); r.quaternion.setFromAxisAngle(UP, w.yaw); }
      this.stretchCord(w.set);
      // the jack's plug + the wire from the post's foot
      const pp = this.plugged ? v1.copy(w.jack).add(v2.set(0, 0.56, 0)).addScaledVector(v3.subVectors(w.base, w.jack).setY(0).normalize(), 0.08) : v1.copy(w.plugOut);
      this.plug.position.copy(pp);
      this.plug.rotation.set(this.plugged ? 0 : Math.PI / 2, Math.atan2(w.base.x - w.jack.x, w.base.z - w.jack.z), 0);
      const foot = v2.copy(w.base).setY(w.base.y + 0.03);
      this.wire.position.copy(foot).add(pp).multiplyScalar(0.5);
      const len = foot.distanceTo(pp);
      this.wire.quaternion.setFromUnitVectors(UP, v3.subVectors(pp, foot).normalize());
      this.wire.scale.set(1, len, 1);
    }
    const p = this.pay;
    if (p) {
      // dialling: the crank turns; the receiver lifts while a pig is on the line
      const dialing = this.caller >= 0 && !this.ring && !this.off;
      if (dialing) this.crankA -= dt * 14; else this.crankA *= Math.max(0, 1 - dt * 6);
      p.set.crank.rotation.x = this.crankA;
      const r = p.set.recv, onLine = this.caller >= 0 && (dialing || this.ring === 2 || this.listening);
      const pig = onLine ? G.pigs[this.caller] as Pig | undefined : undefined;
      if (pig && Math.hypot(pig.pos.x - p.base.x, pig.pos.z - p.base.z) < PHONE.lineR) {
        r.position.copy(p.set.hook).addScaledVector(p.front, 0.25).add(v1.set(0, -0.25, 0));
        q1.setFromAxisAngle(v1.set(1, 0, 0), 0.9); r.quaternion.setFromAxisAngle(UP, p.yaw).multiply(q1);
      } else { r.position.copy(p.set.hook); r.quaternion.setFromAxisAngle(UP, p.yaw); }
      this.stretchCord(p.set);
    }
  }
  private stretchCord(s: Set_) {
    const end = v1.set(0, 0.11 * S, 0).applyQuaternion(s.recv.quaternion).add(s.recv.position);
    const d = v2.subVectors(end, s.cordAt), len = Math.max(0.05, d.length());
    s.cord.position.copy(s.cordAt);
    s.cord.quaternion.setFromUnitVectors(UP, d.normalize());
    s.cord.scale.set(1, len, 1);
  }
}

/** Seconds until the first real call. */
export const phoneFirst = () => rand(PHONE.first);
