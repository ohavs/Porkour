import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { G, ADMIN } from '../game/ctx';
import { toonMat } from '../render/toon';
import type { Pig } from '../pig/pig';
import type { Prop } from './props';
import type { Nav } from '../farmer/nav';
import type { Rect } from './terrain';

/**
 * Land mines (user: "scatter mines around the map: step on one and it blows up and sends you flying; a pig lands as
 * bacon"). A few cartoon mines, half sunk in the ground at random spots each round (a red button, a blinking light,
 * a beep when you get close). Anyone who steps on one — a pig, Bob, an animal — hears a CLICK and a moment later goes
 * sky-high. A pig lands as a strip of bacon (sizzling, a few seconds), and it costs it a lot of HP; Bob lands flat on
 * his back (prank `mineBob`). The bang is loud (Bob comes to look). Used up until the next round. One synced entity.
 */
export const MINE = {
  /** How many per round (bigger farms: up to `max`), at least `apart` m from each other, `clear` m from the sty / cage / spawns. */
  count: 6, max: 8, apart: 9, clear: 9,
  /** Stepping within … m clicks it; it goes off `fuse` s later; the blast: launch speed, reach (m), HP for the one on it / the rest. */
  r: 0.55, fuse: 0.32, launch: 13.5, blastR: 3.4, dmg: 60, splash: 25,
  /** A pig closer than … m hears it beep. */
  beep: 2.8,
};

interface Mine { p: THREE.Vector3; live: boolean; clickT: number; by: unknown }

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), m4 = new THREE.Matrix4(), q1 = new THREE.Quaternion(), s1 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Mines {
  kind = 'mines' as const;
  list: Mine[] = [];
  private body: THREE.InstancedMesh;
  private led: THREE.InstancedMesh;
  private beepT = 0;

  constructor(scene: THREE.Scene, private nav: Nav, private bounds: Rect, private avoid: () => THREE.Vector3[], private inWater: (x: number, z: number) => boolean) {
    // one merged, vertex-coloured mine (1 draw call for all of them) + the blinking lights
    const col = (g: THREE.BufferGeometry, c: number) => {
      const cc = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = cc.r; a[i * 3 + 1] = cc.g; a[i * 3 + 2] = cc.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
    };
    const parts = [
      col(new THREE.CylinderGeometry(0.27, 0.3, 0.09, 18).translate(0, 0.02, 0), 0x55603a),       // olive case
      col(new THREE.TorusGeometry(0.26, 0.025, 6, 20).rotateX(Math.PI / 2).translate(0, 0.07, 0), 0x3b4228),
      col(new THREE.SphereGeometry(0.075, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.065, 0), 0xd8281f),   // the button
      ...[0, 1, 2, 3].map((i) => col(new THREE.BoxGeometry(0.03, 0.06, 0.03).translate(Math.cos(i * 1.57 + 0.78) * 0.17, 0.09, Math.sin(i * 1.57 + 0.78) * 0.17), 0x2c3020)),
    ].map((g) => g.index ? g.toNonIndexed() : g);
    for (const g of parts) { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k); }
    const geo = mergeGeometries(parts)!;
    this.body = new THREE.InstancedMesh(geo, toonMat(0xffffff, { vertexColors: true }), MINE.max);
    this.body.castShadow = true; this.body.receiveShadow = true; this.body.count = 0; this.body.frustumCulled = false;
    this.led = new THREE.InstancedMesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a1a }), MINE.max);
    this.led.count = 0; this.led.frustumCulled = false;
    scene.add(this.body, this.led);
  }

  /** New round (host): fresh mines at random open spots. */
  reset() {
    this.list = [];
    if (G.net === 'client' || !ADMIN.mines) { this.sync(); return; }
    const B = this.bounds, keep = this.avoid();
    const area = (B.x1 - B.x0) * (B.z1 - B.z0), n = Math.min(MINE.max, Math.round(MINE.count * Math.max(1, area / 16000)));
    for (let tries = 0; tries < 400 && this.list.length < n; tries++) {
      const x = B.x0 + 6 + Math.random() * (B.x1 - B.x0 - 12), z = B.z0 + 6 + Math.random() * (B.z1 - B.z0 - 12);
      if (!this.nav.free(x, z) || this.inWater(x, z) || G.iceAt?.(x, z)) continue;
      if (keep.some((k) => Math.hypot(k.x - x, k.z - z) < MINE.clear)) continue;
      if (this.list.some((m) => Math.hypot(m.p.x - x, m.p.z - z) < MINE.apart)) continue;
      this.list.push({ p: new THREE.Vector3(x, G.terrain.height(x, z), z), live: true, clickT: 0, by: null });
    }
    this.sync();
  }
  /** Admin: one right in front of this spot. */
  add(at: THREE.Vector3) {
    if (G.net === 'client') return;
    if (this.list.length >= MINE.max) this.list.shift();
    this.list.push({ p: new THREE.Vector3(at.x, G.terrain.height(at.x, at.z), at.z), live: true, clickT: 0, by: null });
    this.sync();
  }

  // ================================================================== host
  step() {
    if (G.net === 'client') return;
    for (const m of this.list) {
      if (!m.live) continue;
      if (m.clickT) { if (G.time > m.clickT) this.boom(m); continue; }
      const who = this.onIt(m);
      if (who) {   // CLICK … (a moment to realise what you just did)
        m.clickT = G.time + MINE.fuse; m.by = who;
        G.audio.play('unlock', { pos: m.p, vol: 1, pitch: 0.6 });
        G.events.push({ type: 'mineClick' });
      }
    }
  }
  /** Who is standing on it (feet on the button): a pig, Bob or an animal. */
  private onIt(m: Mine): unknown {
    const near = (p: THREE.Vector3, feet: number) => Math.hypot(p.x - m.p.x, p.z - m.p.z) < MINE.r && Math.abs(p.y - feet - m.p.y) < 0.7;
    for (const p of G.pigs as Pig[]) if (!p.out && !p.absent && !p.cage && !p.flying && !p.heldBy && near(p.pos, 0.35)) return p;
    const bob = G.farmer as { pos: THREE.Vector3; asleep: boolean; state: string } | null;
    if (bob && !bob.asleep && bob.state !== 'off' && bob.state !== 'down' && near(bob.pos, 0)) return bob;
    for (const h of G.holdables) {
      if (h.kind !== 'critter' || h.heldBy || h.mass < 3) continue;
      const t = h.body.translation(); if (near(v1.set(t.x, t.y, t.z), 0.3)) return h;
    }
    return null;
  }
  /** BOOM. */
  private boom(m: Mine) {
    m.live = false; m.clickT = 0;
    const at = m.p;
    G.audio.play('bang', { pos: at, vol: 1.2, pitch: 0.8 });
    G.fx.puff(v1.copy(at).setY(at.y + 0.4), { count: 3, color: 0xfff4c2, speed: 0.6, up: 0.2, life: 0.2, size: 3.2, alpha: 0.95 });
    G.fx.puff(at, { count: 20, color: 0x7d7062, speed: 3.6, up: 2.4, life: 1.8, size: 1.3, alpha: 0.6 });
    G.fx.bits(at, { count: 40, color: 0x7a5232, spread: 0.2, speed: 6, up: 7, grav: 12, life: 1, size: 0.13, grow: 0, alpha: 1 });   // dirt
    G.fx.bits(at, { count: 26, color: 0xffb347, spread: 0.15, speed: 7, up: 5, grav: 10, life: 0.5, size: 0.12, grow: 0, alpha: 1 });
    G.noise(at, 36);
    G.clouds.push({ x: at.x, y: at.y + 0.5, z: at.z, r: 6, until: G.time + 1.4, kind: 'bang' });
    G.events.push({ type: 'mineBoom' });
    // pigs: the one on it goes sky-high and lands as bacon; the rest get blown over
    for (const p of G.pigs as Pig[]) {
      if (p.out || p.absent || p.cage) continue;
      const d = Math.hypot(p.pos.x - at.x, p.pos.z - at.z);
      if (d < 20) G.shakeFor(p, Math.max(0.15, 0.8 * (1 - d / 20)));
      if (p.flying || (d > MINE.blastR && p !== m.by)) continue;
      const dx = (p.pos.x - at.x) / (d || 1), dz = (p.pos.z - at.z) / (d || 1);
      if (p === m.by || d < 1.1) {
        const a = Math.random() * Math.PI * 2;
        p.knock(v1.set(Math.cos(a) * 2.5, MINE.launch, Math.sin(a) * 2.5), true);
        p.baconSoon();
        p.hurt(MINE.dmg, 'mine');
        G.events.push({ type: 'mined', who: p });
      } else {
        const k = 1 - d / MINE.blastR;
        p.knock(v1.set(dx * 8 * k, 4 + 4 * k, dz * 8 * k), k > 0.4);
        p.hurt(MINE.splash * k, 'mine');
      }
    }
    // Bob: on it = launched, flat on his back; near it = jumps out of his boots
    const bob = G.farmer as { pos: THREE.Vector3; mined(at: THREE.Vector3, on: boolean): void } | null;
    if (bob) { const d = Math.hypot(bob.pos.x - at.x, bob.pos.z - at.z); if (m.by === bob || d < 1.2) bob.mined(at, true); else if (d < 3.6) bob.mined(at, false); }
    // animals and loose things fly
    for (const h of G.holdables) {
      if (h.kind === 'pig' || h.heldBy) continue;
      const t = h.body.translation(), d = Math.hypot(t.x - at.x, t.z - at.z);
      if (d > MINE.blastR || Math.abs(t.y - at.y) > 2.5) continue;
      const k = 1 - d / MINE.blastR, dx = (t.x - at.x) / (d || 1), dz = (t.z - at.z) / (d || 1);
      if (h.kind === 'critter') (h as { knock?: (v: THREE.Vector3, r: boolean) => void }).knock?.(v1.set(dx * 7 * k, 6 + 6 * k, dz * 7 * k), true);
      else (h as Prop).knock?.(v1.set(dx * 7 * k * Math.min(1, 12 / h.mass), 4 * k, dz * 7 * k * Math.min(1, 12 / h.mass)));
    }
    this.sync();
  }

  // ================================================================== network
  netState(n: number[]) { for (const m of this.list) n.push(Math.round(m.p.x * 100) / 100, Math.round(m.p.z * 100) / 100, m.live ? 1 : 0); }
  netApply(n: number[]) {
    const k = Math.floor(n.length / 3);
    let ch = k !== this.list.length;
    for (let i = 0; i < k; i++) {
      const x = n[i * 3], z = n[i * 3 + 1], live = n[i * 3 + 2] === 1;
      const m = this.list[i];
      if (m && m.p.x === x && m.p.z === z && m.live === live) continue;
      this.list[i] = { p: new THREE.Vector3(x, G.terrain.height(x, z), z), live, clickT: 0, by: null }; ch = true;
    }
    this.list.length = k;
    if (ch) this.sync();
  }

  // ================================================================== render (every browser)
  /** Rebuild the instances (positions / which are still there). */
  private sync() {
    let i = 0;
    for (const m of this.list) {
      if (!m.live) continue;
      q1.setFromAxisAngle(UP, (m.p.x * 7.13 + m.p.z * 3.7) % 6.28);
      // half sunk, tilted to the ground a little
      this.body.setMatrixAt(i, m4.compose(v1.copy(m.p).setY(m.p.y - 0.03), q1, s1.set(1, 1, 1)));
      i++;
    }
    this.body.count = i; this.body.instanceMatrix.needsUpdate = true;
    this.led.count = i;
  }
  render(dt: number) {
    if (!this.body.count) return;
    // blinking lights (on a moment every 1.4 s, each its own phase)
    let i = 0;
    for (const m of this.list) {
      if (!m.live) continue;
      const on = ((G.time + m.p.x * 0.37) % 1.4) < 0.18 || (m.clickT > 0);
      this.led.setMatrixAt(i, m4.compose(v1.set(m.p.x + 0.1, m.p.y + 0.06, m.p.z + 0.1), q1.identity(), s1.setScalar(on ? 1 : 0.001)));
      i++;
    }
    this.led.instanceMatrix.needsUpdate = true;
    // my pig close to one: beep … beep (faster the closer)
    const L = G.localPig as Pig | null;
    if (!L || L.out) return;
    this.beepT -= dt;
    let best: Mine | null = null, bd: number = MINE.beep;
    for (const m of this.list) { if (!m.live) continue; const d = Math.hypot(L.pos.x - m.p.x, L.pos.z - m.p.z); if (d < bd) { bd = d; best = m; } }
    if (best && this.beepT <= 0) {
      this.beepT = 0.25 + (bd / MINE.beep) * 0.6;
      G.audio.play('tick', { pos: v2.copy(best.p), vol: 0.5, pitch: 2.4 });
    }
  }
}
