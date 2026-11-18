import * as THREE from 'three';
import { G } from '../game/ctx';
import { Prop, PROPS } from './props';
import type { Pig } from '../pig/pig';
import type { MiniStep } from '../game/minigame';
import { IC, type IconId } from '../game/icons';
import { makeVision } from './chainProps';
import { staticBox } from '../core/physics';
import { toonMat } from '../render/toon';
import { V3 } from '../core/util';
import type { Kit } from './farmKit';

/**
 * Chain modes (user: "modes where the missions are very specific" — farm 6 = Bob grows cannabis, farm 7 = Bob grows
 * wheat): a production chain where every step is its own little game (Overcooked-style co-op: grow → harvest → haul
 * → process → craft → consume), then challenges that are hard to do high / drunk. The shared parts live here:
 *  - stations: a spot you use with RMB (a mini-game on your screen, game/minigame.ts → an input `act` code), and
 *    that takes ingredients you click at it (LMB with the thing in your hooves);
 *  - pools of item props (hidden until made);
 *  - visions (hallucinations only high / drunk pigs see: catch them), the balance beam over the pond,
 *    the challenges every chain mode shares (hug Bob, munchies, cloud gazing).
 * Host-authoritative like everything else: stations change only on the host; state reaches players in snapshots.
 */
/** Icons for a station's needs: ✔ when it has it, the icon (dim) + n/need otherwise. */
export const need = (ic: IconId, have: number, of = 1) => `<span class="nd${have >= of ? ' ok' : ''}">${IC[ic]}${of > 1 ? `<b>${Math.min(have, of)}/${of}</b>` : have >= of ? '<b>✔</b>' : ''}</span>`;

export interface Station {
  idx: number;
  at: THREE.Vector3; r: number; icon: IconId;
  markPos: THREE.Vector3;
  /** RMB can start it now (empty hooves; players read the synced state). */
  ready(p: Pig): boolean;
  /** Mini-game steps; null = instant (done on the RMB press, host). */
  steps(p: Pig): MiniStep[] | null;
  /** Host: the result came in (0 failed · 1..3 how well · 4 overdone). */
  done(p: Pig, q: number): void;
  /** Ingredients it takes with a click: the prompt's icon, or null. */
  takes?(item: Prop, p: Pig): IconId | null;
  /** Host: take the item (or one serving of it). */
  take?(item: Prop, p: Pig): void;
  /** HUD (no text): what it still needs / is doing, as icons + numbers. */
  needs?(): string;
}
type StationDef = Omit<Station, 'idx'>;

const v1 = new THREE.Vector3();
const flat = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

export abstract class Chain {
  stations: Station[] = [];
  private pools = new Map<string, Prop[]>();
  visions: Visions;
  beams: Beams;
  /** This mode's buzz: 1 = high (cannabis), 2 = drunk (beer). */
  abstract kind: 1 | 2;
  /** Seconds each pig has been lying back watching the clouds while buzzed. */
  private gaze = new Map<Pig, number>();

  constructor(public scene: THREE.Scene, public props: Prop[]) {
    this.visions = new Visions(scene);
    this.beams = new Beams();
    G.chain = this;
    G.uses.push({ near: (p: Pig) => !!this.useAt(p), icon: (p: Pig) => this.useAt(p)?.icon ?? 'question' });
    // hug Bob (high / drunk, right next to him)
    G.uses.push({ near: (p: Pig) => this.canHug(p), icon: () => 'heart' });
  }

  station(def: StationDef): Station { const s = def as Station; s.idx = this.stations.length; this.stations.push(s); return s; }

  // ------------------------------------------------------------------ pools of items
  pool(kind: string, n: number) {
    const list: Prop[] = [];
    for (let i = 0; i < n; i++) {
      const p = new Prop(this.scene, PROPS[kind], V3(i * 0.8 - 20, -60 - this.pools.size * 2, 0), 0);
      p.pooled = true; p.bank(); this.props.push(p); list.push(p);
    }
    this.pools.set(kind, list);
    return list;
  }
  /** Host: a fresh item at a spot (null = the pool is used up). */
  spawn(kind: string, at: THREE.Vector3, yaw = 0, kick?: THREE.Vector3) {
    const pr = this.pools.get(kind)?.find((p) => p.banked) ?? null;
    if (!pr) return null;
    pr.setLeft(pr.def.servings ?? 0); pr.worth = null;
    pr.unbank(at, yaw);
    if (kick) pr.body.setLinvel(kick, true);
    return pr;
  }
  /** Host: an item is used up (it vanishes). */
  consume(pr: Prop) { if (pr.heldBy) pr.heldBy.release?.(false); if (pr.heldBy) pr.heldBy.release?.(false); pr.bank(); }
  /** Host: one serving of an item (a pinch from the bag, a pour from the can): gone when it was the last. */
  serve(pr: Prop) { pr.setLeft(pr.left - 1); if (pr.left <= 0) this.consume(pr); }
  /** Host: one pour from a can / bucket (it stays, empty: refill it). */
  pour(pr: Prop) { pr.setLeft(Math.max(0, pr.left - 1)); }
  item(pr: unknown) { const p = pr as Prop | null; return p?.kind === 'prop' ? p.def.item ?? '' : ''; }

  // ------------------------------------------------------------------ stations: RMB / clicks
  /** The station this pig would start with RMB right now. */
  useAt(p: Pig): Station | null {
    if (p.held || p.out || p.cage || p.heldBy || p.mode !== 'normal') return null;
    let best: Station | null = null, bd = Infinity;
    for (const s of this.stations) { const d = flat(p.pos, s.at); if (d < s.r && d < bd && s.ready(p)) { bd = d; best = s; } }
    return best;
  }
  /** HUD: what the nearest station still needs (icons), when there's nothing to do there right now. */
  needsAt(p: Pig): string {
    let best: Station | null = null, bd = Infinity;
    for (const s of this.stations) { if (!s.needs) continue; const d = flat(p.pos, s.at); if (d < s.r + 0.5 && d < bd) { bd = d; best = s; } }
    return best?.needs?.() ?? '';
  }
  /** The station that takes what this pig holds (a click puts it in), and its icon. */
  takerOf(p: Pig): [Station, IconId] | null {
    const h = p.held as Prop | null;
    if (!h || h.kind !== 'prop') return null;
    let best: [Station, IconId] | null = null, bd = Infinity;
    for (const s of this.stations) {
      if (!s.takes) continue;
      const d = flat(p.pos, s.at); if (d > s.r + 0.8 || d > bd) continue;
      const ic = s.takes(h, p); if (ic) { bd = d; best = [s, ic]; }
    }
    return best;
  }
  /** Host: a quick LMB click with an item in the hooves. True = handled (no hit). */
  useItem(p: Pig, h: Prop): boolean {
    const t = this.takerOf(p);
    if (t) { t[0].take!(h, p); return true; }
    return this.selfUse(p, h);
  }
  /** HUD: what a click with this item does here (icon), or ''. */
  itemIcon(p: Pig): IconId | '' {
    const t = this.takerOf(p);
    if (t) return t[1];
    return p.held ? this.selfIcon(p, p.held as Prop) : '';
  }
  /** Using an item on its own (smoke the joint, eat a cookie, water a plant, strike the lighter…). Host. */
  protected abstract selfUse(p: Pig, h: Prop): boolean;
  protected abstract selfIcon(p: Pig, h: Prop): IconId | '';

  /** Host: a player's mini-game result (input act code: 1 + station × 8 + result). */
  act(p: Pig, code: number) {
    const s = this.stations[(code - 1) >> 3], q = (code - 1) & 7;
    if (s && flat(p.pos, s.at) < s.r + 1.5) s.done(p, q);
  }
  /** Act code base of a station (the mini-game adds the result). */
  codeOf(s: Station) { return 1 + s.idx * 8; }

  // ------------------------------------------------------------------ shared challenges
  private canHug(p: Pig) {
    const b = G.farmer;
    return p.buzz > 0.3 && !p.held && !!b && b.state !== 'off' && b.state !== 'away' && !b.carrying && b.visual.root.visible && flat(p.pos, b.pos) < 1.7;
  }
  /** Host, every fixed step. */
  stepHost(dt: number) {
    for (const p of G.pigs as Pig[]) {
      if (p.absent || p.out) continue;
      // RMB at a station without a mini-game / at Bob for a hug
      if (p.input.grabP && !p.held) {
        const s = this.useAt(p);
        if (s && !s.steps(p)) s.done(p, 1);
        else if (!s && this.canHug(p) && G.farmer?.hugged(p)) G.events.push({ type: 'hugBob', who: p });
      }
      if (p.input.act) this.act(p, p.input.act);
      // cloud gazing: lie back (play dead) while buzzed for 6 s
      const g = p.buzz > 0.3 && p.mode === 'wallow' ? (this.gaze.get(p) ?? 0) + dt : 0;
      this.gaze.set(p, g);
      if (g >= 6) { this.gaze.set(p, -30); G.events.push({ type: 'cloudGaze', who: p }); }
    }
    this.visions.stepHost(dt);
    this.beams.stepHost();
    this.tick(dt);
  }
  /** This mode's own host logic (plants grow, the oven bakes…). */
  protected abstract tick(dt: number): void;
  /** New round. */
  reset() { this.visions.clear(); this.gaze.clear(); this.resetMode(); }
  protected abstract resetMode(): void;
  /** Every frame, every browser. */
  abstract render(dt: number): void;
  /** Synced state of the mode (≤ 64 numbers). */
  abstract netState(n: number[], s: string[]): void;
  abstract netApply(n: number[], s: string[]): void;
  /** Admin buttons for this mode: [action, label key]. */
  abstract adminButtons(): [string, string][];
  /** Admin action (host). True = handled. */
  abstract admin(a: string, me: Pig): boolean;
  /** Where the round's arrows point for this mode's missions (null = nothing to show). */
  abstract markFor(id: string, me: Pig): THREE.Vector3 | null;
  /** A drunk / high pig oinked (farm 7: singing to Bob). */
  oinked(_p: Pig) { /* per mode */ }
}

// ====================================================================== visions
/**
 * Hallucinations: sprinkled rainbow doughnuts and pink elephant heads float around the farm while someone is high /
 * drunk. Only buzzed pigs see them (each browser shows them when its own pig is buzzed); a buzzed pig that touches
 * one catches it (host). Synced entity: 5 × (x, y, z, until).
 */
export class Visions {
  list: { obj: THREE.Object3D; x: number; y: number; z: number; until: number }[] = [];
  private nextAt = 0;
  constructor(scene: THREE.Scene) {
    for (let i = 0; i < 5; i++) { const obj = makeVision(i); obj.visible = false; scene.add(obj); this.list.push({ obj, x: 0, y: -50, z: 0, until: 0 }); }
  }
  clear() { for (const v of this.list) v.until = 0; this.nextAt = 0; }
  stepHost(dt: number) {
    void dt;
    const pigs = (G.pigs as Pig[]).filter((p) => !p.absent && !p.out && p.buzz > 0.3);
    for (const v of this.list) {
      if (v.until < G.time) continue;
      const got = pigs.find((p) => Math.hypot(p.pos.x - v.x, p.pos.z - v.z) < 1.3 && Math.abs(p.pos.y + 0.4 - v.y) < 1.5);
      if (got) {
        v.until = 0;
        G.audio.play('ding', { pos: got.pos, vol: 0.7, pitch: 1.4 + Math.random() * 0.4 });
        G.fx.bits(v1.set(v.x, v.y, v.z), { count: 20, color: 0xff9ad2, speed: 3, up: 2, life: 0.8, size: 0.14, grow: 0, drag: 2, alpha: 1 });
        G.events.push({ type: 'vision', who: got });
      }
    }
    if (!pigs.length || G.time < this.nextAt) return;
    this.nextAt = G.time + 4 + Math.random() * 3;
    const free = this.list.find((v) => v.until < G.time);
    if (!free) return;
    const p = pigs[Math.floor(Math.random() * pigs.length)];
    for (let k = 0; k < 12; k++) {
      const a = Math.random() * Math.PI * 2, d = 7 + Math.random() * 14, x = p.pos.x + Math.cos(a) * d, z = p.pos.z + Math.sin(a) * d;
      if (!G.places || G.places.pond && Math.hypot(x - G.places.pond.x, z - G.places.pond.z) < G.places.pond.r) continue;
      const gy = G.terrain.height(x, z);
      if (Math.abs(gy - p.pos.y) > 3) continue;
      if (G.farmer?.nav && !G.farmer.nav.free(x, z)) continue;   // not inside a building / a pen fence
      free.x = x; free.z = z; free.y = gy + 1.1 + Math.random() * 1.2; free.until = G.time + 30;
      return;
    }
  }
  render(dt: number) {
    const L = G.localPig as Pig | null, b = L?.buzz ?? 0;
    this.list.forEach((v, i) => {
      const on = b > 0.15 && v.until > G.time;
      v.obj.visible = on;
      if (!on) return;
      const t = G.time + i * 1.7, s = Math.min(1, b * 1.6) * Math.min(1, (v.until - G.time) / 1.5);
      v.obj.position.set(v.x, v.y + Math.sin(t * 1.6) * 0.25, v.z);
      v.obj.rotation.y += dt * (0.8 + i * 0.2); v.obj.rotation.z = Math.sin(t) * 0.3;
      v.obj.scale.setScalar(s);
    });
  }
  netState(n: number[]) { for (const v of this.list) n.push(Math.round(v.x * 10) / 10, Math.round(v.y * 10) / 10, Math.round(v.z * 10) / 10, v.until); }
  netApply(n: number[]) { this.list.forEach((v, i) => { if (n[i * 4 + 3] === undefined) return; v.x = n[i * 4]; v.y = n[i * 4 + 1]; v.z = n[i * 4 + 2]; v.until = n[i * 4 + 3]; }); }
}

// ====================================================================== the balance beam
export interface Beam { a: THREE.Vector3; b: THREE.Vector3; axis: THREE.Vector3; right: THREE.Vector3; len: number; top: number }
/**
 * A thin log high over the pond: walk it on two legs (user: "the pig wobbles terribly and you counter-steer — it
 * leans left, you press right"). Pig.beamStep does the balance (players predict it on their side too); here the
 * host tracks who walks it end to end standing (the challenge).
 */
export class Beams {
  list: Beam[] = [];
  private from = new Map<Pig, { beam: Beam; end: 0 | 1 }>();
  add(a: THREE.Vector3, b: THREE.Vector3) {
    const axis = new THREE.Vector3(b.x - a.x, 0, b.z - a.z), len = axis.length(); axis.normalize();
    const beam = { a: a.clone(), b: b.clone(), axis, right: new THREE.Vector3(axis.z, 0, -axis.x), len, top: a.y };
    this.list.push(beam);
    return beam;
  }
  /** The beam a pig stands on (feet on top of the log), or null. */
  at(p: Pig, feetY: number): Beam | null {
    for (const b of this.list) {
      const dx = p.pos.x - b.a.x, dz = p.pos.z - b.a.z, t = dx * b.axis.x + dz * b.axis.z, off = dx * b.right.x + dz * b.right.z;
      if (t > -0.1 && t < b.len + 0.1 && Math.abs(off) < 0.5 && Math.abs(feetY - b.top) < 0.4) return b;
    }
    return null;
  }
  stepHost() {
    for (const p of G.pigs as Pig[]) {
      const b = p.onBeam as Beam | null;
      if (!b || !p.standing || p.mode !== 'normal') { this.from.delete(p); continue; }
      const t = (p.pos.x - b.a.x) * b.axis.x + (p.pos.z - b.a.z) * b.axis.z;
      const end: 0 | 1 | -1 = t < 1.2 ? 0 : t > b.len - 1.2 ? 1 : -1;
      const f = this.from.get(p);
      if (!f || f.beam !== b) { if (end >= 0) this.from.set(p, { beam: b, end: end as 0 | 1 }); continue; }
      if (end >= 0 && end !== f.end) {
        this.from.set(p, { beam: b, end: end as 0 | 1 });
        G.audio.play('fanfare', { pos: p.pos, vol: 0.4 });
        G.events.push({ type: 'beamCrossed', who: p, why: p.buzz > 0.3 ? 'buzzed' : '' });
      }
    }
  }
}

// ====================================================================== building blocks
/** The log + two platforms with ramps (static). Returns the walkable beam. */
export function buildBeam(kit: Kit, scene: THREE.Scene, a: THREE.Vector3, b: THREE.Vector3, h: number, beams: Beams) {
  const ground = Math.max(kit.y(a.x, a.z), kit.y(b.x, b.z)), top = ground + h;
  const dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z), len = dir.length(); dir.normalize();
  const yaw = Math.atan2(dir.x, dir.z);
  const wood = toonMat(0x9a6a3c), dark = toonMat(0x6e4524), bark = toonMat(0x7a5232);
  const g = new THREE.Group(); scene.add(g);
  // the log (visual: round; collider: a narrow flat top so feet stay put)
  const log = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, len + 0.6, 10), bark);
  log.position.set((a.x + b.x) / 2, top - 0.17, (a.z + b.z) / 2); log.rotation.set(Math.PI / 2, 0, 0); log.rotation.y = yaw;
  log.rotation.order = 'YXZ'; log.rotation.set(Math.PI / 2, yaw, 0); log.castShadow = true; g.add(log);
  staticBox(V3((a.x + b.x) / 2, top - 0.08, (a.z + b.z) / 2), V3(0.16, 0.08, len / 2 + 0.3), yaw);
  // platforms at both ends, a ramp down from each (away from the beam)
  for (const [p, s] of [[a, -1], [b, 1]] as const) {
    const cx = p.x + dir.x * s * 1.3, cz = p.z + dir.z * s * 1.3;
    const plat = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.2, 2.4), wood); plat.position.set(cx, top - 0.1, cz); plat.rotation.y = yaw; plat.castShadow = true; plat.receiveShadow = true; g.add(plat);
    staticBox(V3(cx, top - 0.1, cz), V3(1.2, 0.1, 1.2), yaw);
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const lx = cx + Math.cos(yaw) * ox * 1.05 + Math.sin(yaw) * oz * 1.05, lz = cz - Math.sin(yaw) * ox * 1.05 + Math.cos(yaw) * oz * 1.05, ly = kit.y(lx, lz);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, top - ly, 0.18), dark); leg.position.set(lx, (top + ly) / 2 - 0.1, lz); leg.castShadow = true; g.add(leg);
    }
    // ramp: from the platform's outer edge down to the ground, 6 m out
    const e = V3(cx + dir.x * s * 1.2, top - 0.05, cz + dir.z * s * 1.2), rl = 6.2;
    const f = V3(e.x + dir.x * s * rl, 0, e.z + dir.z * s * rl); f.y = kit.y(f.x, f.z);
    const mx = (e.x + f.x) / 2, mz = (e.z + f.z) / 2, my = (e.y + f.y) / 2, rlen = Math.hypot(rl, e.y - f.y), pitch = Math.atan2(e.y - f.y, rl);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.14, rlen), wood);
    ramp.rotation.order = 'YXZ'; ramp.rotation.set(s * pitch, yaw, 0); ramp.position.set(mx, my - 0.05, mz); ramp.castShadow = true; ramp.receiveShadow = true; g.add(ramp);
    const body = staticBox(V3(mx, my - 0.05, mz), V3(0.7, 0.07, rlen / 2), yaw);
    body.setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(s * pitch, yaw, 0, 'YXZ')), true);
    for (let k = 1; k < 6; k++) { const cl = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 0.08), dark); const u = k / 6; cl.position.set(e.x + (f.x - e.x) * u, e.y + (f.y - e.y) * u + 0.04, e.z + (f.z - e.z) * u); cl.rotation.order = 'YXZ'; cl.rotation.set(s * pitch, yaw, 0); g.add(cl); }
    kit.blocked.push({ x0: Math.min(cx, f.x) - 1.6, x1: Math.max(cx, f.x) + 1.6, z0: Math.min(cz, f.z) - 1.6, z1: Math.max(cz, f.z) + 1.6 });
  }
  return beams.add(V3(a.x, top, a.z), V3(b.x, top, b.z));
}

/**
 * The shed (user: "a house / shed on the farm with the machine"): a wooden pavilion, open on its front (+local z) so
 * you can see in (and so can Bob), walls on the other three sides, a roof. `place(x, z)` = local → world.
 */
export function buildShed(kit: Kit, scene: THREE.Scene, cx: number, cz: number, yaw: number, W = 11, D = 7, H = 3) {
  const y0 = kit.y(cx, cz);
  const g = new THREE.Group(); g.position.set(cx, y0, cz); g.rotation.y = yaw; scene.add(g);
  const plank = toonMat(0xb5793d), plank2 = toonMat(0x9a6a3c), roofM = toonMat(0xc0453a), floorM = toonMat(0x8a6a4a);
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; g.add(o); return o;
  };
  box(W + 0.4, 0.2, D + 0.4, floorM, 0, 0.1, 0);
  box(W, H, 0.16, plank, 0, H / 2 + 0.2, -D / 2);                         // back wall
  box(0.16, H, D, plank2, -W / 2, H / 2 + 0.2, 0); box(0.16, H, D, plank2, W / 2, H / 2 + 0.2, 0);   // side walls
  for (const x of [-W / 2, -W / 6, W / 6, W / 2]) box(0.22, H + 0.4, 0.22, plank2, x, (H + 0.4) / 2, D / 2);   // front posts
  const roof = box(W + 1.2, 0.16, D + 1.6, roofM, 0, H + 0.55, 0.2); roof.rotation.x = -0.12;
  for (let i = 0; i < 7; i++) box(0.05, 0.1, D + 1.6, toonMat(0xa0372e), -W / 2 - 0.3 + (i + 0.5) * (W + 0.6) / 7, H + 0.66, 0.2).rotation.x = -0.12;
  const place = (x: number, z: number) => new THREE.Vector3(cx + Math.cos(yaw) * x + Math.sin(yaw) * z, y0 + 0.2, cz - Math.sin(yaw) * x + Math.cos(yaw) * z);
  // colliders: walls (+ the floor's lip)
  const wall = (x: number, z: number, hx: number, hz: number) => { const p = place(x, z); staticBox(V3(p.x, y0 + H / 2 + 0.2, p.z), V3(hx, H / 2, hz), yaw); };
  wall(0, -D / 2, W / 2, 0.1); wall(-W / 2, 0, 0.1, D / 2); wall(W / 2, 0, 0.1, D / 2);
  staticBox(V3(cx, y0 + 0.1, cz), V3(W / 2 + 0.2, 0.1, D / 2 + 0.2), yaw);
  const r = { x0: cx - W / 2 - 1, x1: cx + W / 2 + 1, z0: cz - D / 2 - 1, z1: cz + D / 2 + 1 };
  G.terrain.noGrass(r); kit.blocked.push({ x0: r.x0 - 1.5, x1: r.x1 + 1.5, z0: r.z0 - 1.5, z1: r.z1 + 1.5 });
  return { place, y0: y0 + 0.2, yaw, g };
}
