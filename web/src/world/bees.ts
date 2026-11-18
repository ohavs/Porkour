import * as THREE from 'three';
import { RAPIER, world, groups, L, owners } from '../core/physics';
import { G, ignored } from '../game/ctx';
import { toonMat } from '../render/toon';
import { rigidSkin } from '../render/batch';
import type { Prop } from './props';
import type { Pig } from '../pig/pig';
import type { Loop } from '../core/audio';

/**
 * Farm 2's beehives (host-authoritative, synced as one entity). Knock a hive — headbutt / punch / whack it, ram it,
 * or throw something at it — and an angry swarm comes out after whoever is nearest: a pig, or Bob. Bees are a bit
 * faster than a walking pig (sprint away!), sting every second (a hop + a squeal, you drop what you hold) and give
 * up on a muddy pig, a pig in the pond, or a fart / stink cloud. Lead them to Bob: he yelps and flails (stagger,
 * drops a pig he carries) — a prank. At night the bees sleep.
 */
export const BEES = { speed: 5.3, life: 14, sting: 1.0, reach: 1.05, see: 12, keep: 20, max: 3, noise: 10 };

const v1 = new THREE.Vector3();
const N_BEES = 36;
/** Hives are drawn a bit fat (goofy) — model + collider scale. */
const HIVE_S = 1.35;

interface Hive { i: number; x: number; z: number; y: number; g: THREE.Group; wobT: number; lastAnger: number }
interface Swarm {
  on: boolean; pos: THREE.Vector3; vel: THREE.Vector3; hive: number; until: number; nextSting: number; think: number;
  target: Pig | { kind: 'farmer' } | null; home: boolean;
  /** Render: shown position (players smooth toward the host's), the bees' points + offsets, the buzz. */
  show: THREE.Vector3; pts: THREE.Points; off: Float32Array; loop: Loop | null;
}

export class Bees {
  hives: Hive[] = [];
  swarms: Swarm[] = [];
  private ambientT = 0;

  constructor(scene: THREE.Scene, spots: [number, number][], y: (x: number, z: number) => number) {
    const base = toonMat(0x8a6a3c), box = [toonMat(0xf6f1e6), toonMat(0xffe9a8)], roof = toonMat(0xc0392b), dark = toonMat(0x2b2b2b);
    const BASE = new THREE.BoxGeometry(0.75, 0.14, 0.75), BOX = new THREE.BoxGeometry(0.66, 0.26, 0.66), ROOF = new THREE.ConeGeometry(0.58, 0.3, 4), DOOR = new THREE.BoxGeometry(0.24, 0.05, 0.05);
    const LEG = new THREE.BoxGeometry(0.08, 0.3, 0.08);
    spots.forEach(([x, z], i) => {
      const hy = y(x, z);
      const g = new THREE.Group(); g.position.set(x, hy, z); g.rotation.y = (i * 1.7) % 0.6 - 0.3; g.scale.setScalar(HIVE_S); scene.add(g);
      const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, px: number, py: number, pz: number, ry = 0) => {
        const o = new THREE.Mesh(geo, m); o.position.set(px, py, pz); o.rotation.y = ry; o.castShadow = true; o.receiveShadow = true; g.add(o); return o;
      };
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(LEG, base, sx * 0.28, 0.15, sz * 0.28);
      mesh(BASE, base, 0, 0.35, 0);
      for (let k = 0; k < 3; k++) mesh(BOX, box[k % 2], 0, 0.55 + k * 0.27, 0);
      mesh(ROOF, roof, 0, 1.47, 0, Math.PI / 4);
      mesh(DOOR, dark, 0, 0.47, 0.34);
      rigidSkin(g);
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, hy + 0.7 * HIVE_S, z));
      const c = world.createCollider(RAPIER.ColliderDesc.cuboid(0.38 * HIVE_S, 0.7 * HIVE_S, 0.38 * HIVE_S).setCollisionGroups(groups(L.STATIC)), body);
      const h: Hive = { i, x, z, y: hy, g, wobT: -10, lastAnger: -10 };
      owners.set(c.handle, {
        kind: 'hive',
        onRam: (by: Pig) => this.anger(h, by),
        onImpact: (p: Prop, force: number) => { if (p.synced.preVel.length() > 4 && force > p.mass * 120) this.anger(h, null); },
      });
      this.hives.push(h);
    });
    G.hittables.push({
      hit: (hx, _hy, hz, reach, _dir, _k, by) => {
        const h = this.hives.find((x) => Math.hypot(x.x - hx, x.z - hz) < reach * 0.8 + 0.4);
        if (h) this.anger(h, by as Pig);
        return !!h;
      },
    });
    const mat = new THREE.PointsMaterial({ color: 0xffc928, size: 0.11, sizeAttenuation: true });
    for (let k = 0; k < BEES.max; k++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N_BEES * 3), 3));
      const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.visible = false; scene.add(pts);
      const off = new Float32Array(N_BEES * 4);
      for (let i = 0; i < N_BEES; i++) { off[i * 4] = Math.random() * 6.28; off[i * 4 + 1] = 0.25 + Math.random() * 0.75; off[i * 4 + 2] = 2 + Math.random() * 5; off[i * 4 + 3] = Math.random() * 6.28; }
      this.swarms.push({ on: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), hive: 0, until: 0, nextSting: 0, think: 0, target: null, home: false, show: new THREE.Vector3(), pts, off, loop: null });
    }
  }

  /** Host: a hive got knocked. Out comes a swarm (or the one already out gets angrier). */
  anger(h: Hive, by: Pig | null) {
    if (G.net === 'client' || G.time - h.lastAnger < 0.4) return;
    h.lastAnger = G.time;
    G.events.push({ type: 'hiveHit', text: String(h.i) });
    G.audio.play('wood', { pos: v1.set(h.x, h.y + 0.8, h.z), vol: 0.8, pitch: 1.3 });
    if (G.night > 0.6) return;   // sleeping bees
    const out = this.swarms.find((s) => s.on && s.hive === h.i);
    if (out) { out.until = G.time + BEES.life; out.home = false; if (by) out.target = by; return; }
    const s = this.swarms.find((x) => !x.on);
    if (!s) return;
    s.on = true; s.hive = h.i; s.home = false; s.until = G.time + BEES.life; s.nextSting = G.time + 0.8; s.think = 0;
    s.pos.set(h.x, h.y + 1.5, h.z); s.vel.set(0, 1.5, 0); s.show.copy(s.pos);
    s.target = by && this.valid(by) ? by : this.nearest(s.pos);
    G.noise(s.pos, BEES.noise);
    G.events.push({ type: 'beesOut', who: by ?? undefined });
  }

  private valid(t: Pig | { kind: 'farmer' }) {
    if (t.kind === 'farmer') { const f = G.farmer; return !!f && !f.asleep && f.state !== 'down' && f.state !== 'off'; }
    const p = t as Pig;
    return !ignored(p) && !p.out && !p.cage && !(p.heldBy?.kind === 'farmer') && p.muddy <= 0 && !this.inWater(p) && !p.smoking;   // smoke calms bees
  }
  private inWater(p: Pig) { const w = G.places?.pond; return !!w && Math.hypot(p.pos.x - w.x, p.pos.z - w.z) < w.r - 0.3; }
  private tpos(t: Pig | { kind: 'farmer' }, out: THREE.Vector3) {
    if (t.kind === 'farmer') return out.copy(G.farmer.pos).setY(G.farmer.pos.y + 1.7);
    const p = t as Pig; return out.copy(p.pos).setY(p.pos.y + (p.standing ? 1.1 : 0.55));
  }
  private nearest(from: THREE.Vector3): Pig | { kind: 'farmer' } | null {
    let best: Pig | { kind: 'farmer' } | null = null, bd = BEES.see;
    for (const p of G.pigs as Pig[]) { if (p.absent || !this.valid(p)) continue; const d = from.distanceTo(p.pos); if (d < bd) { bd = d; best = p; } }
    const f = G.farmer, bob = { kind: 'farmer' as const };
    if (f && this.valid(bob) && from.distanceTo(v1.copy(f.pos).setY(f.pos.y + 1)) < bd) best = bob;
    return best;
  }

  /** Host, every fixed step. */
  step(dt: number) {
    const now = G.time;
    for (const s of this.swarms) {
      if (!s.on) continue;
      const hive = this.hives[s.hive];
      // a fart / stink cloud scatters them
      if (G.clouds.some((c) => c.kind !== 'bang' && Math.hypot(c.x - s.pos.x, c.y - s.pos.y, c.z - s.pos.z) < c.r + 0.5)) {
        G.fx.bits(s.pos, { count: 16, color: 0xffc928, spread: 0.5, speed: 4, up: 1, grav: 0, life: 0.6, size: 0.08, grow: 0, drag: 1, alpha: 1 });
        s.on = false; G.events.push({ type: 'beesGone' }); continue;
      }
      if (now > s.until || G.night > 0.6) s.home = true;
      if (!s.home && now >= s.think) {
        s.think = now + 0.4;
        const keep = s.target && this.valid(s.target) && s.pos.distanceTo(this.tpos(s.target, v1)) < BEES.keep;
        if (!keep) s.target = this.nearest(s.pos);
        if (!s.target) s.home = true;
      }
      const goal = s.home || !s.target ? v1.set(hive.x, hive.y + 1, hive.z) : this.tpos(s.target, v1);
      const d = goal.clone().sub(s.pos), dist = d.length();
      if (s.home && dist < 0.8) { s.on = false; continue; }
      const sp = s.home ? BEES.speed * 0.8 : BEES.speed;
      d.multiplyScalar(dist > 0.01 ? sp / dist : 0);
      s.vel.lerp(d, Math.min(1, dt * 3.5));
      s.pos.addScaledVector(s.vel, dt);
      s.pos.y = Math.max(s.pos.y, G.terrain.height(s.pos.x, s.pos.z) + 0.3);
      // sting
      if (!s.home && s.target && dist < BEES.reach + 0.4 && now >= s.nextSting) {
        s.nextSting = now + BEES.sting;
        if (s.target.kind === 'farmer') { G.farmer?.stung?.(); }
        else this.stingPig(s.target as Pig, s);
      }
    }
    // a few bees buzz around the calm hives in the daytime
    if (now >= this.ambientT && G.night < 0.6) {
      this.ambientT = now + 0.18;
      const h = this.hives[Math.floor(Math.random() * this.hives.length)];
      if (h) G.fx.bits(v1.set(h.x + (Math.random() - 0.5) * 1.2, h.y + 0.6 + Math.random() * 0.9, h.z + (Math.random() - 0.5) * 1.2),
        { count: 1, color: 0xffd23a, spread: 0.05, speed: 1.2, up: 0.4, grav: 0, life: 1.4, size: 0.06, grow: 0, drag: 0.2, alpha: 1 });
    }
  }

  private stingPig(p: Pig, s: Swarm) {
    const dx = p.pos.x - s.pos.x, dz = p.pos.z - s.pos.z, l = Math.hypot(dx, dz) || 1;
    if (p.held) p.release(false);
    if (!p.heldBy) p.knock(v1.set((dx / l) * 2.5, 4.5, (dz / l) * 2.5), false);
    G.audio.play('squeal', { pos: p.pos, vol: 1, pitch: 1.25 });
    G.fx.bits(v1.copy(p.pos).setY(p.pos.y + 0.8), { count: 8, color: 0xffd23a, speed: 2.5, up: 2, life: 0.4, size: 0.1, grow: 0, drag: 3, alpha: 1 });
    G.shakeFor(p, 0.3);
    G.noise(p.pos, 8);
    G.events.push({ type: 'stung', who: p });
  }

  /** Every frame (all browsers): the swarm clouds, their buzz, wobbling hives. */
  render(dt: number) {
    const t = G.time;
    for (const s of this.swarms) {
      s.pts.visible = s.on;
      if (!s.on) { if (s.loop) { s.loop.stop(0.6); s.loop = null; } continue; }
      s.show.lerp(s.pos, Math.min(1, dt * (G.net === 'client' ? 8 : 30)));
      const a = s.pts.geometry.attributes.position as THREE.BufferAttribute, o = s.off;
      for (let i = 0; i < N_BEES; i++) {
        const ph = o[i * 4] + t * o[i * 4 + 2], r = o[i * 4 + 1] * (1 + Math.sin(t * 3 + o[i * 4 + 3]) * 0.25);
        a.setXYZ(i, s.show.x + Math.cos(ph) * r, s.show.y + Math.sin(ph * 1.7 + o[i * 4 + 3]) * r * 0.6, s.show.z + Math.sin(ph) * r);
      }
      a.needsUpdate = true;
      if (!s.loop) s.loop = G.audio.loop('buzz', { vol: 1, pos: s.show, bus: 'sfx', ref: 4 });
      s.loop?.setPos(s.show);
    }
    for (const h of this.hives) {
      const e = t - h.wobT;
      h.g.rotation.z = e >= 0 && e < 1.2 ? Math.sin(e * 22) * 0.12 * Math.exp(-e * 3) : 0;
    }
  }
  onEvent(type: string, text = '') {
    if (type === 'hiveHit') { const h = this.hives[Number(text)]; if (h) h.wobT = G.time; }
  }

  /** New round / admin: everyone back in the hives. */
  clear() { for (const s of this.swarms) { s.on = false; s.target = null; } }
  /** Admin: a swarm out of the nearest hive, after me. */
  sic(p: Pig) {
    const h = this.hives.slice().sort((a, b) => Math.hypot(a.x - p.pos.x, a.z - p.pos.z) - Math.hypot(b.x - p.pos.x, b.z - p.pos.z))[0];
    if (!h) return;
    h.lastAnger = -10; this.anger(h, p);
    // far from the hives (testing): the swarm starts a few metres behind me
    const s = this.swarms.find((x) => x.on && x.hive === h.i);
    if (s && s.pos.distanceTo(p.pos) > 8) { const f = p.forward; s.pos.set(p.pos.x - f.x * 5, p.pos.y + 1.2, p.pos.z - f.z * 5); s.show.copy(s.pos); s.target = p; }
  }
  get angry() { return this.swarms.some((s) => s.on && !s.home); }

  // network: per swarm on + position
  netState(n: number[]) { for (const s of this.swarms) n.push(s.on ? 1 : 0, Math.round(s.pos.x * 100) / 100, Math.round(s.pos.y * 100) / 100, Math.round(s.pos.z * 100) / 100); }
  netApply(n: number[]) {
    this.swarms.forEach((s, i) => {
      if (n.length < i * 4 + 4) return;
      const on = n[i * 4] === 1;
      s.pos.set(n[i * 4 + 1], n[i * 4 + 2], n[i * 4 + 3]);
      if (on && !s.on) s.show.copy(s.pos);
      s.on = on;
    });
  }
}
