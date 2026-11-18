import * as THREE from 'three';
import { G } from '../game/ctx';
import { Prop, PROPS } from './props';
import type { Pig } from '../pig/pig';
import { IC, type IconId } from '../game/icons';
import { makeVision } from './chainProps';
import { staticBox, staticCylinder } from '../core/physics';
import { toonMat } from '../render/toon';
import { V3 } from '../core/util';
import type { Kit } from './farmKit';
import { HANDS, lever, type Handle } from './hands';

/**
 * Chain modes (user: "modes where the missions are very specific" — farm 6 = Bob grows cannabis, farm 7 = Bob grows
 * wheat): a production chain made of real actions with the hooves (user: "not mini-games: the pig physically takes the
 * filter, the paper, puts the filter on the paper, pours the stuff in and rolls it" — world/hands.ts): grow → harvest
 * → haul → process (crank a machine, stir a pot) → craft (pour, snap things together, roll) → consume; then challenges
 * that are hard to do high / drunk. The shared parts live here:
 *  - pools of item props (hidden until made), spawning / using up / swapping them;
 *  - spots: what a work place still needs (HUD icons when you stand there);
 *  - visions (hallucinations only high / drunk pigs see: catch them), the balance beam over the pond,
 *    the challenges every chain mode shares (hug Bob, munchies, cloud gazing).
 * Host-authoritative like everything else: state changes only on the host; players get it in snapshots.
 */
/** Icons for a station's needs: ✔ when it has it, the icon (dim) + n/need otherwise. */
export const need = (ic: IconId, have: number, of = 1) => `<span class="nd${have >= of ? ' ok' : ''}">${IC[ic]}${of > 1 ? `<b>${Math.min(have, of)}/${of}</b>` : have >= of ? '<b>✔</b>' : ''}</span>`;

/** A work place (HUD: what it still needs, as icons, when you stand there; arrows point at markPos). */
export interface Spot { at: THREE.Vector3; r: number; markPos: THREE.Vector3; needs(): string }

const v1 = new THREE.Vector3();
const flat = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

export abstract class Chain {
  spots: Spot[] = [];
  private pools = new Map<string, Prop[]>();
  visions: Visions;
  beams: Beams;
  /** The shed (Bob finds a pig in there suspicious); its roof (hidden while my pig is inside). */
  shedAt = new THREE.Vector3(); shedR = 0; shedRoof: THREE.Object3D | null = null;
  /** Every frame: the roof goes see-through while my pig works in the shed (the camera looks in from above). */
  protected shedRender() {
    const L = G.localPig as Pig | null;
    if (this.shedRoof) this.shedRoof.visible = !(L && !L.out && this.inShed(L.pos) && L.pos.y < this.shedAt.y + 2.5);
  }
  inShed(p: THREE.Vector3) { return this.shedR > 0 && Math.hypot(p.x - this.shedAt.x, p.z - this.shedAt.z) < this.shedR; }
  /** This mode's buzz: 1 = high (cannabis), 2 = drunk (beer). */
  abstract kind: 1 | 2;
  /** Seconds each pig has been lying back watching the clouds while buzzed. */
  private gaze = new Map<Pig, number>();

  constructor(public scene: THREE.Scene, public props: Prop[]) {
    this.visions = new Visions(scene);
    this.beams = new Beams();
    G.chain = this;
    // hug Bob (high / drunk, right next to him)
    G.uses.push({ near: (p: Pig) => this.canHug(p), icon: () => 'heart' });
  }

  spot(s: Spot) { this.spots.push(s); return s; }

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
  /** Host: a fresh item at a spot (null = the pool is used up). `left` = how much is in it (default: its servings). */
  spawn(kind: string, at: THREE.Vector3, yaw = 0, kick?: THREE.Vector3, left?: number) {
    const pr = this.pools.get(kind)?.find((p) => p.banked) ?? null;
    if (!pr) return null;
    pr.setLeft(left ?? pr.def.servings ?? 0); pr.worth = null;
    pr.unbank(at, yaw);
    if (kick) pr.body.setLinvel(kick, true);
    return pr;
  }
  /** Host: an item is used up (it vanishes). */
  consume(pr: Prop) { if (pr.heldBy) pr.heldBy.release?.(false); if (pr.heldBy) pr.heldBy.release?.(false); pr.bank(); }
  /** Host: one serving of an item (a pinch from the bag, a pour from the can): gone when it was the last. */
  serve(pr: Prop) { pr.setLeft(pr.left - 1); if (pr.left <= 0) this.consume(pr); }
  /**
   * Host: an item turns into another (a tray of dough → cookies in the oven, an empty tray → a tray of dough): same
   * place, same socket, the same pig keeps holding it.
   */
  swap(pr: Prop, kind: string, left?: number) {
    const s = pr.dockedIn, holder = pr.heldBy?.kind === 'pig' ? pr.heldBy as Pig : null;
    const t = pr.body.translation(), r = pr.body.rotation();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w), yaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
    this.consume(pr);
    const n = this.spawn(kind, V3(t.x, t.y - pr.half, t.z), yaw, undefined, left);
    if (!n) return null;
    if (s) HANDS.dock(s, n);
    else if (holder && !holder.held) holder.grab(n);
    return n;
  }
  item(pr: unknown) { const p = pr as Prop | null; return p?.kind === 'prop' ? p.def.item ?? '' : ''; }

  // ------------------------------------------------------------------ clicks with an item in the hooves
  /** Host: a quick LMB click with an item in the hooves (eat, puff, lick, strike the lighter…). True = handled (no hit). */
  useItem(p: Pig, h: Prop): boolean { return this.selfUse(p, h); }
  /** HUD: what a click with this item does here (icon), or ''. */
  itemIcon(p: Pig): IconId | '' { return p.held ? this.selfIcon(p, p.held as Prop) : ''; }
  protected abstract selfUse(p: Pig, h: Prop): boolean;
  protected abstract selfIcon(p: Pig, h: Prop): IconId | '';
  /** HUD: what the work place I stand at still needs (icons). */
  needsAt(p: Pig): string {
    let best: Spot | null = null, bd = Infinity;
    for (const s of this.spots) { const d = flat(p.pos, s.at); if (d < s.r && d < bd) { bd = d; best = s; } }
    return best?.needs() ?? '';
  }
  /** Where a pig's snout is (bong mouthpieces, lighting up). */
  snout(p: Pig, out: THREE.Vector3) { const f = p.forward; return out.set(p.pos.x + f.x * (p.standing ? 0.36 : 0.62), p.pos.y + (p.standing ? 0.6 : 0.26), p.pos.z + f.z * (p.standing ? 0.36 : 0.62)); }

// ------------------------------------------------------------------ shared challenges
  private canHug(p: Pig) {
    const b = G.farmer;
    return p.buzz > 0.3 && !p.held && !!b && b.state !== 'off' && b.state !== 'away' && !b.carrying && b.visual.root.visible && flat(p.pos, b.pos) < 1.7;
  }
  /** Host, every fixed step. */
  stepHost(dt: number) {
    for (const p of G.pigs as Pig[]) {
      if (p.absent || p.out) continue;
      // RMB right next to Bob (buzzed): a big hug (arms around him)
      if (p.input.grabP && !p.held && !p.handle && this.canHug(p) && G.farmer?.hugged(p)) {
        p.touch(v1.copy(G.farmer.pos).setY(G.farmer.pos.y + 0.9));
        G.events.push({ type: 'hugBob', who: p });
      }
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
  /** Where the arrows point for a spot (above it). */
  protected markOf(s: Spot) { return s.markPos; }
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
  /** The mission list: how to do the next step, as icons (keys + things), or ''. */
  stepIcons(_id: string, _me: Pig): string { return ''; }
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
  // the roof (its own group: it's hidden while my pig works inside, so the camera sees in)
  const roofG = new THREE.Group(); g.add(roofG);
  const roof = box(W + 1.2, 0.16, D + 1.6, roofM, 0, H + 0.55, 0.2); roof.rotation.x = -0.12; roofG.add(roof);
  for (let i = 0; i < 7; i++) { const st = box(0.05, 0.1, D + 1.6, toonMat(0xa0372e), -W / 2 - 0.3 + (i + 0.5) * (W + 0.6) / 7, H + 0.66, 0.2); st.rotation.x = -0.12; roofG.add(st); }
  const place = (x: number, z: number) => new THREE.Vector3(cx + Math.cos(yaw) * x + Math.sin(yaw) * z, y0 + 0.2, cz - Math.sin(yaw) * x + Math.cos(yaw) * z);
  // colliders: walls (+ the floor's lip)
  const wall = (x: number, z: number, hx: number, hz: number) => { const p = place(x, z); staticBox(V3(p.x, y0 + H / 2 + 0.2, p.z), V3(hx, H / 2, hz), yaw); };
  wall(0, -D / 2, W / 2, 0.1); wall(-W / 2, 0, 0.1, D / 2); wall(W / 2, 0, 0.1, D / 2);
  staticBox(V3(cx, y0 + 0.1, cz), V3(W / 2 + 0.2, 0.1, D / 2 + 0.2), yaw);
  const r = { x0: cx - W / 2 - 1, x1: cx + W / 2 + 1, z0: cz - D / 2 - 1, z1: cz + D / 2 + 1 };
  G.terrain.noGrass(r); kit.blocked.push({ x0: r.x0 - 1.5, x1: r.x1 + 1.5, z0: r.z0 - 1.5, z1: r.z1 + 1.5 });
  return { place, y0: y0 + 0.2, yaw, g, roof: roofG };
}

// ====================================================================== shared hands-on pieces
/**
 * Containers that fill up (watering cans / buckets under the pump, mugs under the tap): a receiver on each one, at
 * its opening, while it stands upright and isn't full. `max` = how much it holds.
 */
export function fillable(props: Prop[], item: string, stuff: string, max: number, onFill?: (pr: Prop, amount: number) => void) {
  for (const pr of props) {
    if (pr.def.item !== item) continue;
    HANDS.receiver({
      r: Math.max(0.12, pr.radius * 0.9),
      at: (out) => { const t = pr.body.translation(); return out.set(t.x, t.y + pr.half, t.z); },
      accepts: (s) => s === stuff && !pr.banked && pr.left < max - 0.01 && HANDS.flow(pr) <= 0,
      fill: (_s, a) => { pr.setLeft(Math.min(max, pr.left + a)); onFill?.(pr, a); },
    });
  }
}

/**
 * The hand pump (both chain farms): pump the handle up and down (grab it, move the mouse up / down) — every push down
 * gushes water out of the spout into whatever stands under it (a can / bucket parked on the stone under it, or held
 * there). Faces +z rotated by `yaw`: the spout in front, the handle at the back (stand behind it).
 */
export class Pump {
  lever: Handle; spout = new THREE.Vector3(); flowUntil = 0; private g: THREE.Group; private arm: THREE.Group;
  constructor(kit: Kit, scene: THREE.Scene, x: number, z: number, yaw: number) {
    const y = kit.y(x, z);
    const g = this.g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = yaw; scene.add(g);
    const iron = toonMat(0x3f8f5a), dk = toonMat(0x2b2b30), stone = toonMat(0x9a9fa8);
    const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, px: number, py: number, pz: number, rx = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(px, py, pz); o.rotation.x = rx; o.castShadow = true; g.add(o); return o; };
    mesh(new THREE.CylinderGeometry(0.14, 0.18, 1.1, 10), iron, 0, 0.55, 0);
    mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.4, 8), iron, 0, 0.85, 0.22, 1.2);
    mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.08, 12), stone, 0, 0.04, 0.55);   // the stone the can stands on
    // the handle: a bar hinged on top, pointing back
    this.arm = new THREE.Group(); this.arm.position.set(0, 1.12, -0.05); g.add(this.arm);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.62), dk); bar.position.z = -0.3; bar.castShadow = true; this.arm.add(bar);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), toonMat(0xc0453a)); knob.position.z = -0.6; this.arm.add(knob);
    staticCylinder(V3(x, y + 0.55, z), 0.55, 0.2);
    g.updateMatrixWorld(true);
    this.spout.copy(g.localToWorld(V3(0, 0.74, 0.4)));
    const pivot = g.localToWorld(V3(0, 1.12, -0.05)), axis = V3(1, 0, 0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    const armV = V3(0, 0, -0.6).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    this.lever = lever({ pivot, axis, arm: armV, min: -0.55, max: 0.55, icon: 'water', speed: 6,
      moved: (v, p) => {
        // a push down (the handle's end goes down) gushes water
        const dv = this.lastV - v; this.lastV = v;
        if (dv <= 0) return;
        this.flowUntil = G.time + 0.3;
        HANDS.emit(this.spout, 'water', dv * 1.7, p);
        G.audio.play('pour', { pos: this.spout, vol: 0.5, pitch: 1.2, minGap: 0.3 });
      } });
    // a can / bucket parked on the stone fills while you pump
    HANDS.socket({ icon: 'water', p: g.localToWorld(V3(0, 0.3, 0.5)), q: new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), on: null, r: 0.45, dock: true, anyYaw: true,
      accepts: (it) => it.def.item === 'can' });
    kit.blocked.push({ x0: x - 1, x1: x + 1, z0: z - 1, z1: z + 1 });
  }
  private lastV = 0;
  reset() { this.lever.v = 0; this.lastV = 0; this.flowUntil = 0; }
  render(dt: number) {
    this.arm.rotation.x = this.lever.v;
    if (this.flowUntil > G.time) HANDS.streamFx(this.spout, 0x7fd0ff, dt, 0.06);
  }
}
