import * as THREE from 'three';
import { G } from '../game/ctx';
import { Prop, PROPS } from './props';
import { toonMat } from '../render/toon';

/**
 * Shop gadgets in the world (host). Every pig slot has its own cherry bomb, stink bomb and bone in a pool: hidden
 * props (synced like any prop) that the round hands out next to the pig at the start, hidden again on the next round.
 *  - Cherry bomb: lights when it's thrown or hit (punch / headbutt / ram), fuse 2.5 s, then BANG: a noise Bob comes
 *    to check (34 m), Bob right next to it jumps out of his boots (stagger: drops a pig he carries), animals and the
 *    dog scatter, pigs and loose things nearby get blown over, other cherry bombs nearby go off too.
 *  - Stink bomb: bursts when it lands hard → a green stink cloud for 9 s: Bob coughs (again every 3 s if he stays),
 *    animals, dog and wolves keep away.
 *  - Bone: the guard dog's favourite (animals.ts dogBrain).
 */
export type PoolId = 'cherryBomb' | 'stinkBomb' | 'bone';
export const POOL_IDS: PoolId[] = ['cherryBomb', 'stinkBomb', 'bone'];
const SLOTS = 4;
export const GADGET_FX = { fuse: 2.5, bangR: 3.4, noise: 34, stinkSecs: 9, stinkR: 3.6, stinkEvery: 3 };

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), q1 = new THREE.Quaternion();

export class Gadgets {
  pool: Record<PoolId, Prop[]> = { cherryBomb: [], stinkBomb: [], bone: [] };
  private lit = new Map<Prop, number>();
  private held = new Set<Prop>();
  private stunk = new Set<Prop>();
  private sparkAt = 0;
  private stinks: { at: THREE.Vector3; until: number; cloudAt: number; puffAt: number }[] = [];

  constructor(scene: THREE.Scene, props: Prop[]) {
    const home = new THREE.Vector3(0, -40, 0);
    for (const id of POOL_IDS) for (let i = 0; i < SLOTS; i++) {
      const p = new Prop(scene, PROPS[id], home.clone().setX(i * 2 + POOL_IDS.indexOf(id) * 10), 0);
      p.pooled = true; p.bank();
      this.pool[id].push(p); props.push(p);
    }
  }

  /** Round start (host): pig slot `slot` gets its gadget right in front of it. */
  give(id: PoolId, slot: number, at: THREE.Vector3, yaw: number) {
    const p = this.pool[id][slot] ?? this.pool[id].find((x) => x.banked);
    if (!p) return null;
    if (p.heldBy) p.heldBy.release?.(false);
    this.lit.delete(p); this.held.delete(p); this.stunk.delete(p);
    const a = yaw - 0.65;   // ahead and a bit to the right: the camera behind the pig sees it
    v1.set(at.x + Math.sin(a) * 1.25, 0, at.z + Math.cos(a) * 1.25);
    v1.y = G.terrain.height(v1.x, v1.z) + 0.15;
    p.unbank(v1, yaw);
    return p;
  }
  /** Admin: one more in front of me (the first hidden one). */
  giveAny(id: PoolId, at: THREE.Vector3, yaw: number) {
    const i = this.pool[id].findIndex((x) => x.banked);
    return this.give(id, i < 0 ? 0 : i, at, yaw);
  }
  /** New round: nothing burning, no stink left. */
  clear() { this.lit.clear(); this.held.clear(); this.stunk.clear(); this.stinks = []; }

  /** Host, every fixed step. */
  step() {
    const now = G.time;
    // ---- cherry bombs: light on a throw or a hit, sparks while the fuse burns, bang
    for (const b of this.pool.cherryBomb) {
      if (b.banked) { this.held.delete(b); continue; }
      if (b.heldBy) { this.held.add(b); }
      else {
        const lv = b.body.linvel(), sp = Math.hypot(lv.x, lv.y, lv.z);
        if (!this.lit.has(b) && ((this.held.has(b) && sp > 2.5) || now - b.lastKnock < 0.1)) this.light(b);
        this.held.delete(b);
      }
      const end = this.lit.get(b);
      if (end === undefined) continue;
      if (now >= end) { this.bang(b); continue; }
      if (now >= this.sparkAt) {
        const p = b.body.translation(), r = b.body.rotation();
        v1.set(0, b.half + 0.06, 0).applyQuaternion(q1.set(r.x, r.y, r.z, r.w)).add(v2.set(p.x, p.y, p.z));
        G.fx.bits(v1, { count: 3, color: Math.random() < 0.5 ? 0xffd166 : 0xff8a3d, speed: 1.6, up: 1.8, grav: 6, life: 0.32, size: 0.07, grow: 0, alpha: 1 });
      }
    }
    if (now >= this.sparkAt) this.sparkAt = now + 0.07;
    // ---- stink bombs: burst → cloud
    for (const s of this.pool.stinkBomb) {
      if (!s.smashed) { this.stunk.delete(s); continue; }
      if (this.stunk.has(s)) continue;
      this.stunk.add(s);
      this.stink(s.synced.currP);
    }
    for (const st of this.stinks) {
      if (now >= st.cloudAt && now < st.until) {
        st.cloudAt = now + GADGET_FX.stinkEvery;
        G.clouds.push({ x: st.at.x, y: st.at.y + 0.6, z: st.at.z, r: GADGET_FX.stinkR, until: Math.min(st.until, now + GADGET_FX.stinkEvery + 0.2), kind: 'stink' });
      }
      if (now >= st.puffAt && now < st.until) {
        st.puffAt = now + 0.22;
        const a = Math.random() * Math.PI * 2, d = Math.random() * GADGET_FX.stinkR * 0.75;
        v1.set(st.at.x + Math.cos(a) * d, st.at.y + 0.2, st.at.z + Math.sin(a) * d);
        G.fx.puff(v1, { count: 2, color: Math.random() < 0.6 ? 0x9bd35a : 0xc5e36b, speed: 0.4, up: 0.35, life: 1.8, size: 1.3, alpha: 0.42 });
      }
    }
    this.stinks = this.stinks.filter((s) => s.until > now);
  }

  private light(b: Prop, fuse = GADGET_FX.fuse) {
    this.lit.set(b, G.time + fuse);
    const p = b.body.translation();
    G.audio.play('fuse', { pos: v1.set(p.x, p.y, p.z), vol: 0.8, rand: 0, minGap: 0 });
  }

  private bang(b: Prop) {
    this.lit.delete(b); this.held.delete(b);
    const p = b.body.translation(), at = new THREE.Vector3(p.x, p.y, p.z);
    if (b.heldBy) b.heldBy.release?.(false);
    b.smashed = true; b.bank();
    G.audio.play('bang', { pos: at, vol: 1, rand: 0.06, minGap: 0 });
    G.fx.puff(at, { count: 3, color: 0xfff4c2, speed: 0.5, up: 0.2, life: 0.18, size: 2.6, alpha: 0.9 });          // flash
    G.fx.puff(at, { count: 16, color: 0x8f8a84, speed: 3.2, up: 1.4, life: 1.5, size: 1.1, alpha: 0.55 });         // smoke
    G.fx.bits(at, { count: 34, color: 0xffb347, spread: 0.15, speed: 7.5, up: 4, grav: 10, life: 0.65, size: 0.12, grow: 0, alpha: 1 });
    G.fx.bits(at, { count: 14, color: 0xff5a3c, spread: 0.15, speed: 5, up: 5, grav: 10, life: 0.5, size: 0.1, grow: 0, alpha: 1 });
    G.noise(at, GADGET_FX.noise);
    G.clouds.push({ x: at.x, y: at.y, z: at.z, r: 6, until: G.time + 1.4, kind: 'bang' });
    G.events.push({ type: 'bang' });
    const R = GADGET_FX.bangR;
    // pigs: blown over close by, the screen shakes for everyone near
    for (const pig of G.pigs) {
      if (pig.out || pig.absent) continue;
      const d = Math.hypot(pig.pos.x - at.x, pig.pos.z - at.z);
      if (d < 16) G.shakeFor(pig, Math.max(0.12, 0.6 * (1 - d / 16)));
      if (d > R || pig.cage) continue;
      const k = 1 - d / R, dx = (pig.pos.x - at.x) / (d || 1), dz = (pig.pos.z - at.z) / (d || 1);
      pig.knock(v1.set(dx * 7 * k, 4 + 3 * k, dz * 7 * k), d < R * 0.6);
      pig.hurt(20 * k, 'bang');
    }
    // loose things fly; other cherry bombs nearby go off soon after
    for (const pr of G.props as Prop[]) {
      if (pr === b || pr.banked || pr.heldBy) continue;
      const q = pr.body.translation(), d = Math.hypot(q.x - at.x, q.z - at.z);
      if (d > R || Math.abs(q.y - at.y) > 2) continue;
      if (pr.def.id === 'cherryBomb') { if (!this.lit.has(pr) || this.lit.get(pr)! > G.time + 0.4) this.light(pr, 0.35); continue; }
      const k = (1 - d / R) * Math.min(1, 12 / pr.mass);
      pr.knock(v1.set((q.x - at.x) / (d || 1) * 6 * k, 3 * k, (q.z - at.z) / (d || 1) * 6 * k));
    }
    G.farmer?.startle(at);
  }

  private stink(at: THREE.Vector3) {
    this.stinks.push({ at: at.clone().setY(G.terrain.height(at.x, at.z)), until: G.time + GADGET_FX.stinkSecs, cloudAt: 0, puffAt: 0 });
    G.audio.play('fart', { pos: at, vol: 1, pitch: 0.7, rand: 0.05 });
    G.fx.puff(at, { count: 12, color: 0x9bd35a, speed: 2.4, up: 0.8, life: 1.6, size: 1.2, alpha: 0.55 });
  }
}

/** A lucky horseshoe for the shop's thumbnail (it's a passive gadget: nothing in the world). */
export function makeHorseshoe() {
  const g = new THREE.Group();
  const shoe = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.04, 10, 28, Math.PI * 1.45), toonMat(0xd9dee4));
  shoe.rotation.z = Math.PI * 0.775;   // the gap (0.55 π) centred at the top
  g.add(shoe);
  const holeMat = toonMat(0x4a4f57);
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 2 + (i < 3 ? -1 : 1) * (1.2 + (i % 3) * 0.55);
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), holeMat);
    h.position.set(Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0.035); g.add(h);
  }
  for (const s of [-1, 1]) {   // little toes at the open end
    const a = Math.PI / 2 + s * 0.98;
    const toe = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.085), toonMat(0xc3c9d0));
    toe.position.set(Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0); toe.rotation.z = a; g.add(toe);
  }
  return g;   // open end up: the luck doesn't run out
}
