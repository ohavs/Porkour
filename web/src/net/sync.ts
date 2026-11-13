import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Synced } from '../core/synced';
import { G, ADMIN } from '../game/ctx';
import { emptyInput, type PigInput, type RemotePose } from '../pig/pig';
import type { Game } from '../game/game';
import type { Online } from './online';
import { Writer, Reader } from './codec';

/**
 * Online play, host-authoritative (the model of Human: Fall Flat / Gang Beasts style physics co-op):
 * the host's browser runs the whole simulation; players send their controls (inputs) and receive the world
 * as compact binary snapshots 30×/s — only what changed since the previous snapshot (delta), keyframes on join /
 * after a gap. Players render the world ~70–120 ms in the past, interpolating between two snapshots (smooth even
 * with jittery networks). Sounds, particles and game events that happen in the host's simulation are recorded and
 * replayed on the players' machines.
 */

/** Something whose state goes over the network. */
export interface NetEnt {
  body?: RAPIER.RigidBody;
  synced?: Synced;
  netState?(n: number[], s: string[]): void;
  /** Player side: state of the older snapshot (n, s); `nb` / `alpha` = the newer one, for fields worth interpolating. */
  netApply?(n: number[], s: string[], nb?: number[], alpha?: number): void;
  /** Player side: the interpolated position (for gameplay-ish reads like the HUD). */
  netPose?(p: THREE.Vector3): void;
}

const T = { SNAP: 1, INPUT: 2, KEYREQ: 3, PING: 5, PONG: 6 } as const;
export const SNAP_EVERY = 2;          // fixed steps per snapshot (60 Hz sim → 30 Hz snapshots)
const HELD = ['jump', 'sprint', 'fart', 'stand', 'wallow', 'grab', 'attack'] as const;
const PRESS = ['jumpP', 'sprintP', 'fartP', 'standP', 'wallowP', 'grabP', 'grabR', 'oinkP', 'attackP', 'attackR', 'pickP', 'pickFailP'] as const;

export function entities(game: Game): NetEnt[] {
  return [...game.pigs, game.farmer!, game.farm.cage, game.round, game.traps, ...game.farm.critters, ...game.farm.props] as unknown as NetEnt[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), qq = new THREE.Quaternion();

// ====================================================================== host
interface Remote { inp: PigInput; presses: number; seq: number; pose: RemotePose | null }

export class NetHost {
  private ents: NetEnt[];
  private bp: Float32Array; private bq: Float32Array; private bn: number[][]; private bs: string[][];
  private seq = 0; private steps = 0;
  needKey = new Set<number>();
  private remote = new Map<number, Remote>();   // by peer id
  private rec = { sounds: [] as unknown[], fx: [] as unknown[], ev: [] as unknown[], shakes: [] as unknown[] };
  private evStart = 0;
  private w = new Writer(); private kw = new Writer();
  lastSize = 0;

  constructor(private game: Game, private on: Online) {
    this.ents = entities(game);
    const N = this.ents.length;
    this.bp = new Float32Array(N * 3).fill(NaN); this.bq = new Float32Array(N * 4).fill(NaN);
    this.bn = this.ents.map(() => []); this.bs = this.ents.map(() => []);
    on.onData = (from, u8) => this.onData(from, u8);
    on.onDirect = (peer) => this.needKey.add(peer);   // switched path (relay ↔ direct): resync that player
    installRecorders();
  }

  /** Controls of the pig in `slot` for this fixed step (null = no player). */
  inputFor(slot: number): PigInput | null {
    for (const [id, r] of this.remote) {
      if (this.on.peers.get(id)?.slot !== slot) continue;
      const inp = { ...r.inp };
      PRESS.forEach((k, i) => (inp[k] = !!(r.presses & (1 << i))));
      r.presses = 0;
      return inp;
    }
    return null;
  }
  /** Where that player says their own pig is (client-side prediction), or null. */
  poseFor(slot: number): RemotePose | null {
    for (const [id, r] of this.remote) if (this.on.peers.get(id)?.slot === slot) return r.pose;
    return null;
  }
  dropPeer(id: number) { this.remote.delete(id); this.needKey.delete(id); }

  private onData(from: number, u8: Uint8Array) {
    const r = new Reader(u8);
    const type = r.u8r();
    if (type === T.KEYREQ) { this.needKey.add(from); return; }
    if (type === T.PING) { const w = new Writer(); w.u8w(T.PONG).f64(r.f64()); this.on.sendData(from, w.bytes()); return; }
    if (type !== T.INPUT) return;
    const seq = r.u32();
    let rm = this.remote.get(from);
    if (!rm) { rm = { inp: emptyInput(), presses: 0, seq: -1, pose: null }; this.remote.set(from, rm); }
    if (seq <= rm.seq) return;
    rm.seq = seq;
    const inp = rm.inp;
    inp.mx = r.i8() / 127; inp.mz = r.i8() / 127; inp.yaw = r.f32(); inp.pitch = r.f32();
    const held = r.u8r(); HELD.forEach((k, i) => (inp[k] = !!(held & (1 << i))));
    rm.presses |= r.u16();
    if (r.left >= 28) {   // their own pig's pose (they move it themselves)
      const pose = rm.pose ?? (rm.pose = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, at: 0 });
      pose.x = r.f32(); pose.y = r.f32(); pose.z = r.f32(); pose.vx = r.f32(); pose.vy = r.f32(); pose.vz = r.f32(); pose.yaw = r.f32();
      pose.at = G.time;
    } else rm.pose = null;
  }

  beginStep() { G.rec = this.rec; this.evStart = G.events.length; }
  endStep() {
    for (let i = this.evStart; i < G.events.length; i++) {
      const e = G.events[i];
      this.rec.ev.push({ type: e.type, who: e.who ? G.pigs.indexOf(e.who) : -1, why: e.why, text: e.text });
    }
    G.rec = null;
    if (++this.steps % SNAP_EVERY === 0) this.send();
  }

  private send() {
    if (this.on.peers.size < 2) { this.clearRec(); return; }
    this.seq++;
    const w = this.w.reset(), kw = this.kw.reset();
    const wantKey = this.needKey.size > 0;
    this.header(w, false);
    if (wantKey) this.header(kw, true);
    const n: number[] = [], s: string[] = [];
    this.ents.forEach((e, i) => {
      n.length = 0; s.length = 0;
      e.netState?.(n, s);
      let bits = 0;
      let p: RAPIER.Vector | null = null, q: RAPIER.Rotation | null = null;
      if (e.body) {
        p = e.body.translation(); q = e.body.rotation();
        const bp = this.bp, bq = this.bq;
        if (!(Math.abs(p.x - bp[i * 3]) < 5e-4 && Math.abs(p.y - bp[i * 3 + 1]) < 5e-4 && Math.abs(p.z - bp[i * 3 + 2]) < 5e-4)) bits |= 1;
        if (!(Math.abs(q.x - bq[i * 4]) < 3e-4 && Math.abs(q.y - bq[i * 4 + 1]) < 3e-4 && Math.abs(q.z - bq[i * 4 + 2]) < 3e-4 && Math.abs(q.w - bq[i * 4 + 3]) < 3e-4)) bits |= 2;
      }
      const bn = this.bn[i], bs = this.bs[i];
      let nlo = 0, nhi = 0, smask = 0;
      for (let k = 0; k < n.length; k++) if (bn.length !== n.length || !(Math.abs(n[k] - bn[k]) < 1e-4 || n[k] === bn[k])) {
        if (k < 32) nlo |= 1 << k; else nhi |= 1 << (k - 32);
      }
      for (let k = 0; k < s.length; k++) if (bs[k] !== s[k]) smask |= 1 << k;
      const nmask = nlo || nhi;
      if (nmask) bits |= 4;
      if (nhi) bits |= 16;
      if (smask) bits |= 8;
      if (bits) {
        this.writeEnt(w, i, bits, p, q, n, s, nlo, nhi, smask);
        if (bits & 1) { this.bp[i * 3] = p!.x; this.bp[i * 3 + 1] = p!.y; this.bp[i * 3 + 2] = p!.z; }
        if (bits & 2) { this.bq[i * 4] = q!.x; this.bq[i * 4 + 1] = q!.y; this.bq[i * 4 + 2] = q!.z; this.bq[i * 4 + 3] = q!.w; }
        if (nmask) this.bn[i] = n.slice();
        if (smask) this.bs[i] = s.slice();
      }
      if (wantKey) {
        const lo = n.length >= 32 ? -1 : (1 << n.length) - 1, hi = n.length <= 32 ? 0 : n.length >= 64 ? -1 : (1 << (n.length - 32)) - 1;
        this.writeEnt(kw, i, (e.body ? 3 : 0) | (n.length ? 4 : 0) | (s.length ? 8 : 0) | (hi ? 16 : 0), p, q, n, s, lo, hi, (1 << s.length) - 1);
      }
    });
    w.u16(0xffff); if (wantKey) kw.u16(0xffff);
    this.writeWolves(w); if (wantKey) this.writeWolves(kw);
    const ev = this.rec.sounds.length + this.rec.fx.length + this.rec.ev.length + this.rec.shakes.length ? JSON.stringify(this.rec) : '';
    w.str(ev); if (wantKey) kw.str(ev);
    this.clearRec();
    const delta = w.bytes(), key = wantKey ? kw.bytes() : null;
    this.lastSize = delta.length;
    for (const id of this.on.peers.keys()) {
      if (id === this.on.myId) continue;
      if (this.needKey.has(id) && key) this.on.sendData(id, key); else this.on.sendData(id, delta);
    }
    this.needKey.clear();
  }
  private clearRec() { this.rec.sounds.length = 0; this.rec.fx.length = 0; this.rec.ev.length = 0; this.rec.shakes.length = 0; }

  private header(w: Writer, key: boolean) {
    w.u8w(T.SNAP).u32(this.seq).u8w(key ? 1 : 0).f64(G.time).f32(G.hour).u16(G.day).u8w(Math.min(255, G.grills)).u8w(ADMIN.bob ? 1 : 0);
  }
  /** Entity record: index, bits (1 pos, 2 rot, 4 numbers, 8 strings, 16 numbers past the 32nd), then the changed fields. */
  private writeEnt(w: Writer, i: number, bits: number, p: RAPIER.Vector | null, q: RAPIER.Rotation | null, n: number[], s: string[], nlo: number, nhi: number, smask: number) {
    w.u16(i).u8w(bits);
    if (bits & 1) w.f32(p!.x).f32(p!.y).f32(p!.z);
    if (bits & 2) { const k = q!.w < 0 ? -32767 : 32767; w.i16(q!.x * k).i16(q!.y * k).i16(q!.z * k).i16(q!.w * k); }
    if (bits & 4) {
      w.u32(nlo); if (bits & 16) w.u32(nhi);
      for (let k = 0; k < n.length; k++) if (((k < 32 ? nlo >>> k : nhi >>> (k - 32)) & 1) === 1) w.f32(n[k]);
    }
    if (bits & 8) { w.u8w(smask); for (let k = 0; k < s.length; k++) if (smask & (1 << k)) w.str(s[k]); }
  }
  /** Wolves come and go: always sent whole (there are only a few). */
  private writeWolves(w: Writer) {
    const ws = this.game.wolves.wolves.filter((x) => x.active);
    w.u8w(ws.length);
    const n: number[] = [], s: string[] = [];
    for (const wf of ws) {
      n.length = 0; s.length = 0; wf.netState(n, s);
      const p = wf.body.translation(), q = wf.body.rotation(), k = q.w < 0 ? -32767 : 32767;
      w.u16(wf.netId).f32(p.x).f32(p.y).f32(p.z).i16(q.x * k).i16(q.y * k).i16(q.z * k).i16(q.w * k);
      w.u8w(n.length); for (const x of n) w.f32(x);
      w.u8w(s.length); for (const x of s) w.str(x);
    }
  }
}

// ====================================================================== player (client)
interface WolfState { p: number[]; q: number[]; n: number[]; s: string[] }
interface Frame {
  seq: number; t: number; recv: number; hour: number; day: number; grills: number; bob: boolean;
  p: Float32Array; q: Float32Array; n: number[][]; s: string[][];
  wolves: Map<number, WolfState>; ev: string; fired: boolean;
}

export class NetClient {
  private ents: NetEnt[];
  private frames: Frame[] = [];
  private last: Frame | null = null;
  private waitKey = true;
  private keyAskedAt = -1e9;
  renderT = 0;
  delay = 0.1; private jitter = 0.01;
  private inputSeq = 0; private pending = 0; private lastSend = 0; private lastSig = '';
  rtt = 0;
  started = false;
  onFirstFrame?: () => void;
  private pingT = 0;

  /** Interpolated snapshot position of my own pig (to carry what I hold along with my predicted pig). */
  ownSnap = new THREE.Vector3();

  constructor(private game: Game, private on: Online) {
    this.ents = entities(game);
    // here only my own pig is simulated (prediction): everything else is placed from snapshots
    for (const e of this.ents) if (e.body && e !== (game.local as unknown as NetEnt)) e.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    on.onData = (from, u8) => { if (from === on.hostId) this.onData(u8); };
    on.onDirect = () => {};
    installRecorders();
    this.askKey();
  }

  private askKey() {
    const now = performance.now();
    if (now - this.keyAskedAt < 500) return;
    this.keyAskedAt = now;
    const w = new Writer(); w.u8w(T.KEYREQ); this.on.sendData(this.on.hostId, w.bytes());
  }

  private onData(u8: Uint8Array) {
    const r = new Reader(u8);
    const type = r.u8r();
    if (type === T.PONG) { this.rtt = performance.now() - r.f64(); return; }
    if (type !== T.SNAP) return;
    const seq = r.u32(), key = r.u8r() === 1;
    const prev = this.last;
    if (!key) {
      if (this.waitKey || !prev || seq <= prev.seq) { if (this.waitKey) this.askKey(); return; }
      if (seq !== prev.seq + 1) { this.waitKey = true; this.askKey(); return; }   // a gap: resync
    } else if (prev && seq < prev.seq) return;
    const N = this.ents.length;
    const f: Frame = {
      seq, t: r.f64(), recv: performance.now(), hour: r.f32(), day: r.u16(), grills: r.u8r(), bob: r.u8r() === 1,
      p: key || !prev ? new Float32Array(N * 3) : prev.p.slice(), q: key || !prev ? new Float32Array(N * 4) : prev.q.slice(),
      n: key || !prev ? this.ents.map(() => []) : prev.n.slice(), s: key || !prev ? this.ents.map(() => []) : prev.s.slice(),
      wolves: new Map(), ev: '', fired: false,
    };
    if (key) for (let i = 0; i < N; i++) f.q[i * 4 + 3] = 1;
    for (;;) {
      const i = r.u16(); if (i === 0xffff) break;
      const bits = r.u8r();
      if (bits & 1) { f.p[i * 3] = r.f32(); f.p[i * 3 + 1] = r.f32(); f.p[i * 3 + 2] = r.f32(); }
      if (bits & 2) { for (let k = 0; k < 4; k++) f.q[i * 4 + k] = r.i16() / 32767; }
      if (bits & 4) {
        const lo = r.u32(), hi = bits & 16 ? r.u32() : 0, arr = f.n[i].slice();
        for (let k = 0; k < 64; k++) if (((k < 32 ? lo >>> k : hi >>> (k - 32)) & 1) === 1) arr[k] = r.f32();
        f.n[i] = arr;
      }
      if (bits & 8) {
        const mask = r.u8r(), arr = f.s[i].slice();
        for (let k = 0; k < 8; k++) if (mask & (1 << k)) arr[k] = r.str();
        f.s[i] = arr;
      }
    }
    const nw = r.u8r();
    for (let k = 0; k < nw; k++) {
      const id = r.u16();
      const p = [r.f32(), r.f32(), r.f32()], q = [r.i16() / 32767, r.i16() / 32767, r.i16() / 32767, r.i16() / 32767];
      const n: number[] = []; const nn = r.u8r(); for (let j = 0; j < nn; j++) n.push(r.f32());
      const s: string[] = []; const ns = r.u8r(); for (let j = 0; j < ns; j++) s.push(r.str());
      f.wolves.set(id, { p, q, n, s });
    }
    f.ev = r.str();
    if (key) { this.waitKey = false; if (!prev) { this.renderT = f.t - this.delay; } }
    // network jitter → how far in the past we render
    if (prev) {
      const dev = Math.abs((f.recv - prev.recv) / 1000 - (f.t - prev.t));
      this.jitter = this.jitter * 0.92 + dev * 0.08;
      this.delay = Math.min(0.3, Math.max(0.06, (SNAP_EVERY / 60) * 1.6 + this.jitter * 2.5));
    }
    this.last = f;
    this.frames.push(f);
    if (this.frames.length > 40) this.frames.splice(0, this.frames.length - 40);
    if (!this.started) { this.started = true; this.onFirstFrame?.(); }
  }

  /** Every rendered frame: send controls (latched presses, ~30 Hz or at once on a press). */
  sendInput(inp: PigInput, pose: number[] | null = null) {
    PRESS.forEach((k, i) => { if (inp[k]) this.pending |= 1 << i; });
    let held = 0; HELD.forEach((k, i) => { if (inp[k]) held |= 1 << i; });
    const mx = Math.round(inp.mx * 127), mz = Math.round(inp.mz * 127);
    const sig = `${mx},${mz},${held},${inp.yaw.toFixed(2)}`;
    const now = performance.now();
    if (!this.pending && !pose && sig === this.lastSig && now - this.lastSend < 100) return;
    if (!this.pending && now - this.lastSend < (pose ? 33 : 30)) return;
    this.lastSend = now; this.lastSig = sig;
    const w = new Writer();
    w.u8w(T.INPUT).u32(++this.inputSeq).i8(mx).i8(mz).f32(inp.yaw).f32(inp.pitch).u8w(held).u16(this.pending);
    if (pose) for (const x of pose) w.f32(x);
    this.pending = 0;
    this.on.sendData(this.on.hostId, w.bytes());
    if (now - this.pingT > 2000) { this.pingT = now; const p = new Writer(); p.u8w(T.PING).f64(now); this.on.sendData(this.on.hostId, p.bytes()); }
  }

  /** Apply the interpolated world for this rendered frame. Returns the interpolation alpha (or -1: nothing yet). */
  frame(dt: number): number {
    if (!this.frames.length) return -1;
    const last = this.last!;
    const target = last.t + (performance.now() - last.recv) / 1000 - this.delay;
    if (Math.abs(target - this.renderT) > 0.5) this.renderT = target;
    else this.renderT += dt + (target - this.renderT) * Math.min(1, dt * 3);
    // fire events of every snapshot we pass, drop old snapshots
    while (this.frames.length > 1 && this.frames[1].t <= this.renderT) { this.fire(this.frames[0]); this.frames.shift(); }
    const A = this.frames[0], B = this.frames[1] ?? A;
    this.fire(A);
    const alpha = B === A ? 0 : Math.min(1, Math.max(0, (this.renderT - A.t) / (B.t - A.t)));
    G.time = A.t + (B.t - A.t) * alpha;
    let h = A.hour, dh = B.hour - A.hour; if (dh < -12) dh += 24;
    h += dh * alpha; if (h >= 24) h -= 24;
    G.hour = h; G.day = A.day; G.grills = A.grills; ADMIN.bob = A.bob;
    G.mute = true;
    try {
      const me = this.game.local as unknown as NetEnt;
      this.ents.forEach((e, i) => {
        if (e === me) this.ownSnap.lerpVectors(v1.set(A.p[i * 3], A.p[i * 3 + 1], A.p[i * 3 + 2]), v2.set(B.p[i * 3], B.p[i * 3 + 1], B.p[i * 3 + 2]), alpha);
        if (e.synced && !(e === me && this.game.local.predicting)) {
          const s = e.synced;
          s.prevP.set(A.p[i * 3], A.p[i * 3 + 1], A.p[i * 3 + 2]); s.currP.set(B.p[i * 3], B.p[i * 3 + 1], B.p[i * 3 + 2]);
          s.prevQ.set(A.q[i * 4], A.q[i * 4 + 1], A.q[i * 4 + 2], A.q[i * 4 + 3]).normalize();
          s.currQ.set(B.q[i * 4], B.q[i * 4 + 1], B.q[i * 4 + 2], B.q[i * 4 + 3]).normalize();
          s.pos(alpha, v1);
          e.body?.setTranslation(v1, false);
          if (e.body && e !== me) e.body.setRotation(s.rot(alpha, qq), false);
          e.netPose?.(v1);
        }
        e.netApply?.(A.n[i], A.s[i], B.n[i], alpha);
      });
      this.applyWolves(A, B, alpha);
    } finally { G.mute = false; }
    return alpha;
  }

  private applyWolves(A: Frame, B: Frame, alpha: number) {
    const pack = this.game.wolves;
    for (const w of [...pack.wolves]) if (w.active && !A.wolves.has(w.netId)) w.despawn();
    pack.wolves = pack.wolves.filter((w) => w.active); G.wolves = pack.wolves;
    for (const [id, a] of A.wolves) {
      let w = pack.wolves.find((x) => x.netId === id);
      if (!w) { w = pack.spawnAt(new THREE.Vector3(a.p[0], a.p[1], a.p[2]), id); w.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true); }
      const b = B.wolves.get(id) ?? a, s = w.synced;
      s.prevP.set(a.p[0], a.p[1], a.p[2]); s.currP.set(b.p[0], b.p[1], b.p[2]);
      s.prevQ.set(a.q[0], a.q[1], a.q[2], a.q[3]).normalize(); s.currQ.set(b.q[0], b.q[1], b.q[2], b.q[3]).normalize();
      s.pos(alpha, v1); w.body.setTranslation(v1, false); w.pos.copy(v1);
      w.netApply(a.n, a.s);
    }
  }

  /** Replay the host's sounds / particles / events once their snapshot is "now". */
  private fire(f: Frame) {
    if (f.fired) return;
    f.fired = true;
    if (!f.ev) return;
    let e: { sounds: any[]; fx: any[]; ev: any[]; shakes: any[] };
    try { e = JSON.parse(f.ev); } catch { return; }
    for (const s of e.sounds) {
      const [name, x, y, z, vol, pitch, rand, minGap, bus, ref] = s;
      RAW.play?.(name, { pos: x === null ? undefined : new THREE.Vector3(x, y, z), vol, pitch, rand, minGap, bus: bus ?? undefined, ref: ref ?? undefined });
    }
    for (const [k, x, y, z, b] of e.fx) {
      if (k === 's') RAW.shake?.(x); else (k === 'p' ? RAW.puff : RAW.bits)?.(new THREE.Vector3(x, y, z), b);
    }
    const me = this.on.mySlot();
    for (const [slot, amt] of e.shakes) if (slot === me) RAW.shake?.(amt);
    for (const ev of e.ev) G.events.push({ type: ev.type, who: ev.who >= 0 ? G.pigs[ev.who] : undefined, why: ev.why, text: ev.text });
  }
}

// ====================================================================== side-effect recorders
const RAW: { play?: (n: string, o: any) => void; puff?: (a: THREE.Vector3, b: any) => void; bits?: (a: THREE.Vector3, b: any) => void; shake?: (a: number) => void } = {};
let installed = false;
/**
 * Host: sounds / particles / shakes made by the simulation (fixed steps) are recorded for the players.
 * Player: the same calls made while applying a snapshot are dropped (the host's recording plays instead).
 */
function installRecorders() {
  if (installed) return;
  installed = true;
  const A = G.audio as any, F = G.fx as any;
  RAW.play = A.play.bind(A); RAW.puff = F.puff.bind(F); RAW.bits = F.bits.bind(F); RAW.shake = F.shake.bind(F);
  A.play = (name: string, o: any = {}) => {
    if (G.mute) return;
    G.rec?.sounds.push([name, o.pos ? r2(o.pos.x) : null, o.pos ? r2(o.pos.y) : null, o.pos ? r2(o.pos.z) : null,
      o.vol ?? 1, o.pitch ?? 1, o.rand ?? 0.08, o.minGap ?? 0.05, o.bus ?? null, o.ref ?? null]);
    RAW.play!(name, o);
  };
  const fx = (k: 'p' | 'b') => (at: THREE.Vector3, b: any) => {
    if (G.mute) return;
    G.rec?.fx.push([k, r2(at.x), r2(at.y), r2(at.z), b.dir ? { ...b, dir: { x: r2(b.dir.x), y: r2(b.dir.y), z: r2(b.dir.z) } } : b]);
    (k === 'p' ? RAW.puff : RAW.bits)!(at, b);
  };
  F.puff = fx('p'); F.bits = fx('b');
  F.shake = (a: number) => { if (G.mute) return; G.rec?.fx.push(['s', a, 0, 0, null]); RAW.shake!(a); };
}
