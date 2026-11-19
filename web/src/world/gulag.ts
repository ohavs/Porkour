import * as THREE from 'three';
import { staticBox } from '../core/physics';
import { G } from '../game/ctx';
import { toonMat } from '../render/toon';
import { rigidSkin } from '../render/batch';
import type { Pig } from '../pig/pig';
import { Prop, PROPS } from './props';
import { HANDS, crank, type Handle } from './hands';
import type { Nav } from '../farmer/nav';
import type { Rect } from './terrain';

/**
 * The pigs' gulag (user: "pigs get HP — shot too much and the pig dies; a dead pig goes to a kind of gulag, just
 * another booth on the farm, where it has to finish a task or two, then it's back on the farm"). A small barred cabin
 * on open ground (found automatically, the same spot on every machine). A dead pig appears inside (full HP), the
 * others can see it through the bars. Jobs, with the hooves:
 *  - the big wheel: take its crank (RMB) and turn it round (circle the mouse) `turns` times;
 *  - potatoes: take one from the crate (RMB) and drop it in the sack — `potatoes` of them.
 * The first death = one job, later deaths in the round = both. Done → back in the sty. Bob, the dog and the wolves
 * ignore a pig in the gulag (ctx `ignored`). Host-authoritative; per-pig progress is synced.
 */
export const GULAG = { W: 5, D: 4, H: 2.4, turns: 4, potatoes: 3 };

type Job = 'wheel' | 'potatoes';
const JOBS: Job[] = ['wheel', 'potatoes'];
const v1 = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

export class Gulag {
  kind = 'gulag' as const;
  center: THREE.Vector3; yaw: number;
  private fwd: THREE.Vector3; private right: THREE.Vector3;
  private root = new THREE.Group();
  private wheel = new THREE.Group();
  private potatoes: Prop[] = [];
  private crank: Handle;
  private sackAt: THREE.Vector3; private crateAt: THREE.Vector3;
  // ---- state (host; synced): per pig seat: jobs still to do (bitmask 1 = wheel, 2 = potatoes), progress, deaths this round
  need = [0, 0, 0, 0]; turnsDone = [0, 0, 0, 0]; potDone = [0, 0, 0, 0]; deaths = [0, 0, 0, 0];

  constructor(scene: THREE.Scene, props: Prop[], at: THREE.Vector3, yaw: number) {
    this.center = at.clone(); this.yaw = yaw;
    this.fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)); this.right = new THREE.Vector3(-this.fwd.z, 0, this.fwd.x);
    this.build(scene);
    const L = (x: number, y: number, z: number) => v1.set(x, y, z).applyAxisAngle(UP, yaw).add(this.center).clone();
    // the big wheel on the back-left wall: a crank on its rim
    const wc = L(-1.3, 1.05, -GULAG.D / 2 + 0.35);
    this.crank = crank({ c: wc, axis: this.fwd.clone(), r: 0.42, icon: 'circle', max: 5,
      ready: (p) => !!p.gulag && !!(this.need[this.seat(p)] & 1),
      turn: (d, p) => this.turned(p, d) });
    // potatoes: a crate (RMB = one into the hooves) → the sack by the right wall
    this.crateAt = L(1.5, 0.78, -GULAG.D / 2 + 0.45);
    this.sackAt = L(1.6, 0.45, 0.9);
    for (let i = 0; i < 4; i++) { const p = new Prop(scene, PROPS.potato, new THREE.Vector3(at.x + i * 0.3, -60, at.z), 0); p.pooled = true; p.bank(); props.push(p); this.potatoes.push(p); }
    HANDS.dispenser({ at: this.crateAt, r: 0.25, icon: 'grab',
      ready: (p) => !!p.gulag && !!(this.need[this.seat(p)] & 2) && this.potatoes.some((k) => k.banked),
      take: (_p, a) => { const k = this.potatoes.find((x) => x.banked); if (!k) return null; k.unbank(a, 0); return k; } });
    HANDS.socket({ p: this.sackAt, q: new THREE.Quaternion(), on: null, r: 0.38, dock: false, bin: true, ghost: false,
      accepts: (it) => it.def === PROPS.potato,
      onSnap: (it, by) => { it.bank(); this.potatoIn(by); } });
  }

  /**
   * A flat open spot for the cabin (deterministic: every machine builds the same): free on the nav grid, no water /
   * bushes / dirt paths, not near Bob's work places, 14–40 m from the pigs' stash (nearer 22 m is better).
   */
  static findSpot(nav: Nav, F: Rect, stash: THREE.Vector3, avoid: THREE.Vector3[], inWater: (x: number, z: number) => boolean, o = { min: 14, max: 40, pref: 22, half: 3.5 }) {
    let best: { x: number; z: number } | null = null, bs = Infinity;
    const T = G.terrain;
    for (let x = F.x0 + 10; x <= F.x1 - 10; x += 2) for (let z = F.z0 + 10; z <= F.z1 - 10; z += 2) {
      const ds = Math.hypot(x - stash.x, z - stash.z);
      if (ds < o.min || ds > o.max) continue;
      if (avoid.some((a) => Math.hypot(a.x - x, a.z - z) < 9)) continue;
      let ok = true, lo = Infinity, hi = -Infinity;
      for (let dx = -o.half; dx <= o.half && ok; dx += 1) for (let dz = -o.half; dz <= o.half && ok; dz += 1) {
        const px = x + dx, pz = z + dz;
        if (!nav.free(px, pz) || inWater(px, pz) || T.dirtAt(px, pz) > 0.4 || G.cover?.at(v1.set(px, T.height(px, pz) + 0.5, pz))) ok = false;
        const h = T.height(px, pz); lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      if (!ok || hi - lo > 0.6) continue;
      const sc = Math.abs(ds - o.pref) + (hi - lo) * 4;
      if (sc < bs) { bs = sc; best = { x, z }; }
    }
    if (!best) return null;
    const y = T.height(best.x, best.z);
    // its barred front faces the stash (the pigs see their friend doing time)
    return { at: new THREE.Vector3(best.x, y, best.z), yaw: Math.atan2(stash.x - best.x, stash.z - best.z) };
  }

  /** A plank cabin, a barred front, a tin roof, a sign; inside: a big wheel on the wall, a crate of potatoes, a sack. */
  private build(scene: THREE.Scene) {
    const { W, D, H } = GULAG, r = this.root;
    r.position.copy(this.center); r.rotation.y = this.yaw; scene.add(r);
    const M = (c: number) => toonMat(c);
    const plank = M(0x8a5a35), dark = M(0x5e3a1f), iron = M(0x3a3d44), roof = M(0x9aa3ad), red = M(0xc23b2e), cream = M(0xfff1c9);
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = r, rx = 0, ry = 0, rz = 0) => {
      const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
    };
    add(new THREE.BoxGeometry(W + 0.3, 0.2, D + 0.3), dark, 0, 0.1, 0);                         // floor
    add(new THREE.BoxGeometry(W + 0.2, 0.15, 0.15), plank, 0, H, 0);
    add(new THREE.BoxGeometry(W, H, 0.12), plank, 0, H / 2, -D / 2);                             // back wall
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.12, H, D), plank, s * W / 2, H / 2, 0);  // sides
    for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(W - 0.1, 0.03, 0.02), dark, 0, 0.3 + i * 0.38, -D / 2 + 0.07);   // plank lines
    // the barred front (a gate frame + bars)
    for (const y of [0.25, H - 0.1]) add(new THREE.BoxGeometry(W, 0.1, 0.1), iron, 0, y, D / 2);
    const bar = new THREE.CylinderGeometry(0.035, 0.035, H - 0.3, 6);
    for (let i = 0; i <= 14; i++) add(bar, iron, -W / 2 + 0.1 + (i / 14) * (W - 0.2), H / 2 + 0.05, D / 2);
    // tin roof, sloping back
    add(new THREE.BoxGeometry(W + 0.6, 0.08, D + 0.8), roof, 0, H + 0.3, 0.1, r, -0.14, 0, 0);
    // the sign over the bars: a red board, a cream pig face behind bars
    const sign = new THREE.Group(); sign.position.set(0, H + 0.62, D / 2 + 0.25); r.add(sign);
    add(new THREE.BoxGeometry(1.8, 0.5, 0.06), red, 0, 0, 0, sign);
    add(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 16), cream, -0.55, 0, 0.04, sign, Math.PI / 2, 0, 0);
    for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.03, 0.4, 0.03), iron, -0.7 + i * 0.1, 0, 0.07, sign);
    for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.85, 0.06, 0.03), cream, 0.3, 0.12 - i * 0.12, 0.04, sign);
    // inside: the wheel (turns with the crank), the potato crate, the sack
    this.wheel.position.set(-1.3, 1.05, -D / 2 + 0.3); r.add(this.wheel);
    add(new THREE.TorusGeometry(0.42, 0.045, 8, 24), dark, 0, 0, 0, this.wheel);
    for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.84, 0.05, 0.04), plank, 0, 0, 0, this.wheel, 0, 0, (i * Math.PI) / 4);
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8), red, 0.42, 0, 0.1, this.wheel, Math.PI / 2, 0, 0);   // the knob
    add(new THREE.BoxGeometry(0.6, 0.5, 0.5), plank, 1.5, 0.45, -D / 2 + 0.45);                // crate
    for (let i = 0; i < 6; i++) add(new THREE.SphereGeometry(0.08, 8, 6), M(0xc49a5a), 1.35 + (i % 3) * 0.13, 0.72, -D / 2 + 0.38 + Math.floor(i / 3) * 0.14);
    add(new THREE.CylinderGeometry(0.3, 0.36, 0.7, 12, 1, true), M(0xd8c29a), 1.6, 0.45, 0.9);    // the sack (open)
    add(new THREE.TorusGeometry(0.3, 0.05, 6, 16), M(0xc9b27e), 1.6, 0.8, 0.9, r, Math.PI / 2, 0, 0);
    rigidSkin(r, new Set([this.wheel]));
    // colliders: floor, back, sides, the barred front, the roof, the crate (the sack is open: things drop in)
    const C = this.center, q = (x: number, y: number, z: number) => v1.set(x, y, z).applyAxisAngle(UP, this.yaw).add(C).clone();
    staticBox(q(0, 0.1, 0), new THREE.Vector3(W / 2 + 0.15, 0.1, D / 2 + 0.15), this.yaw);
    staticBox(q(0, H / 2, -D / 2), new THREE.Vector3(W / 2, H / 2 + 0.3, 0.08), this.yaw);
    staticBox(q(0, H / 2, D / 2), new THREE.Vector3(W / 2, H / 2 + 0.3, 0.06), this.yaw);
    for (const s of [-1, 1]) staticBox(q(s * W / 2, H / 2, 0), new THREE.Vector3(0.08, H / 2 + 0.3, D / 2), this.yaw);
    staticBox(q(0, H + 0.3, 0.1), new THREE.Vector3(W / 2 + 0.3, 0.06, D / 2 + 0.4), this.yaw);
    staticBox(q(1.5, 0.45, -D / 2 + 0.45), new THREE.Vector3(0.3, 0.25, 0.25), this.yaw);
  }

  private seat(p: Pig) { return Math.max(0, (G.pigs as Pig[]).indexOf(p)); }
  /** Inside, standing on the floor (spread out: one spot per seat). */
  spot(i: number, out = new THREE.Vector3()) { return out.set(-0.6 + (i % 2) * 1.2, 0.8, -0.2 + Math.floor(i / 2) * 0.9).applyAxisAngle(UP, this.yaw).add(this.center); }

  // ================================================================== host
  /** A pig died (HP 0): in it goes — full HP, a job (or two, if it's been here this round). */
  admit(p: Pig) {
    if (G.net === 'client') return;
    const i = this.seat(p);
    this.deaths[i]++;
    this.need[i] = this.deaths[i] > 1 ? 3 : 1 << Math.floor(Math.random() * 2);
    this.turnsDone[i] = 0; this.potDone[i] = 0;
    p.gulag = true; p.hp = 100;
    if (p.mode === 'ragdoll') p.getUp();
    const at = this.spot(i);
    p.body.setTranslation({ x: at.x, y: at.y, z: at.z }, true); p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    p.yaw = this.yaw + Math.PI;   // facing the back wall (the jobs)
    G.audio.play('unlock', { pos: at, vol: 1, pitch: 0.7 });
    G.events.push({ type: 'gulagIn', who: p });
  }
  private turned(p: Pig, d: number) {
    const i = this.seat(p);
    if (!(this.need[i] & 1)) return;
    this.turnsDone[i] += Math.abs(d) / (Math.PI * 2);
    if (Math.random() < 0.08) G.audio.play('creak', { pos: this.center, vol: 0.5, pitch: 1.2 + Math.random() * 0.3, minGap: 0.3 });
    if (this.turnsDone[i] >= GULAG.turns) this.jobDone(p, 1);
  }
  private potatoIn(by: Pig | null) {
    // dropped / thrown in: the gulag pig nearest the sack did it
    let p = by;
    if (!p || !p.gulag) { let bd = 4; for (const q of G.pigs as Pig[]) { if (!q.gulag) continue; const d = q.pos.distanceTo(this.sackAt); if (d < bd) { bd = d; p = q; } } }
    G.audio.play('thud', { pos: this.sackAt, vol: 0.6, pitch: 1.3 });
    if (!p?.gulag) return;
    const i = this.seat(p);
    if (!(this.need[i] & 2)) return;
    this.potDone[i]++;
    if (this.potDone[i] >= GULAG.potatoes) this.jobDone(p, 2);
  }
  private jobDone(p: Pig, bit: number) {
    const i = this.seat(p);
    this.need[i] &= ~bit;
    G.audio.play('ding', { pos: p.pos, vol: 0.8 });
    if (!this.need[i]) this.release(p);
  }
  /** Time served: back to the sty. */
  release(p: Pig) {
    p.gulag = false;
    if (p.held) p.release(false);
    if (p.handle) p.letGo();
    p.respawn();
    G.events.push({ type: 'gulagOut', who: p });
  }
  /** Host: keep gulag pigs inside (an online player's predicted pig, a glitch through a wall): back to its spot. */
  step() {
    if (G.net === 'client') return;
    (G.pigs as Pig[]).forEach((p, i) => {
      if (!p.gulag) return;
      if (p.absent) { p.gulag = false; this.need[i] = 0; return; }
      const l = v1.copy(p.pos).sub(this.center).applyAxisAngle(UP, -this.yaw);
      if (Math.abs(l.x) > GULAG.W / 2 + 0.6 || Math.abs(l.z) > GULAG.D / 2 + 0.6 || l.y > GULAG.H + 1 || l.y < -2) {
        const at = this.spot(i); p.body.setTranslation({ x: at.x, y: at.y, z: at.z }, true); p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    });
    for (const k of this.potatoes) {   // a potato thrown out through the bars comes back to the crate
      if (k.banked || k.heldBy) continue;
      const t = k.body.translation(), l = v1.set(t.x, t.y, t.z).sub(this.center).applyAxisAngle(UP, -this.yaw);
      if (Math.abs(l.x) > GULAG.W / 2 + 1 || Math.abs(l.z) > GULAG.D / 2 + 1 || t.y < this.center.y - 3) k.bank();
    }
  }
  /** New round: nobody inside. */
  reset() {
    (G.pigs as Pig[]).forEach((p) => { if (p.gulag) { p.gulag = false; } });
    this.need = [0, 0, 0, 0]; this.turnsDone = [0, 0, 0, 0]; this.potDone = [0, 0, 0, 0]; this.deaths = [0, 0, 0, 0];
    for (const k of this.potatoes) k.bank();
  }
  /** HUD: my jobs (icon + progress). */
  jobs(p: Pig) {
    const i = this.seat(p), out: { job: Job; n: number; of: number }[] = [];
    if (this.need[i] & 1) out.push({ job: 'wheel', n: Math.floor(this.turnsDone[i]), of: GULAG.turns });
    if (this.need[i] & 2) out.push({ job: 'potatoes', n: this.potDone[i], of: GULAG.potatoes });
    return out;
  }
  get markPos() { return v1.copy(this.center).setY(this.center.y + GULAG.H + 1.2); }

  // ================================================================== network
  netState(n: number[]) { for (let i = 0; i < 4; i++) n.push(this.need[i], Math.round(this.turnsDone[i] * 100) / 100, this.potDone[i], this.deaths[i]); n.push(Math.round(this.crank.v * 1000) / 1000); }
  netApply(n: number[]) {
    if (n.length < 17) return;
    for (let i = 0; i < 4; i++) { this.need[i] = n[i * 4]; this.turnsDone[i] = n[i * 4 + 1]; this.potDone[i] = n[i * 4 + 2]; this.deaths[i] = n[i * 4 + 3]; }
    if (!this.crank.heldBy || this.crank.heldBy !== G.localPig) this.crank.v = n[16];
  }

  // ================================================================== render (every browser)
  /** The wheel turns with its crank (its knob mesh points where the crank's knob is). */
  render() {
    const k = this.crank.knob(v1);
    this.root.worldToLocal(k);
    this.wheel.rotation.z = Math.atan2(k.y - this.wheel.position.y, k.x - this.wheel.position.x);
  }
}
void JOBS;
