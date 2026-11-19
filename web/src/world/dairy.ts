import * as THREE from 'three';
import { raycast, L, SEE_THROUGH } from '../core/physics';
import { G, ignored } from '../game/ctx';
import { toonMat } from '../render/toon';
import type { Critter, CritterBrain } from './animals';
import type { Prop } from './props';
import type { Rect } from './terrain';
import type { Pig } from '../pig/pig';
import type { Gate } from './gates';

/**
 * Farm 3 — the dairy (host-authoritative, synced as one entity): the bull, milk churns that spill, cow tipping.
 *
 * The bull lives in his own paddock. A pig in there (or near him once he's loose), or anyone waving the red rag,
 * gets noticed: he stares, snorts, paws the ground — then charges in a straight line (9 m/s: dodge sideways, or
 * sprint). Whatever he runs into flies: pigs ragdoll, props scatter, cows tip over, a closed gate bursts (he's out),
 * and Bob gets flattened (a prank). Running into a fence / wall leaves him dazed. Loose, he hates Bob too.
 *
 * Milk churns: knock one over and the milk spills into a puddle. Walk through it carefully: Bob (walking) and pigs
 * that sprint / stand up in it slip and land flat on their backs.
 */
export const BULL = {
  see: 15, looseSee: 10, ragSee: 26, ragGround: 18, notice: 0.7, paw: 1.4, speed: 9.2, turn: 0.95, chargeMax: 2.4, chargeDist: 19,
  reach: 1.2, dazed: 2.8, rest: 1.8, bobSee: 14, bobCalm: 35, scan: 0.25,
};
export const MILK = { tilt: 0.42, r: 1.2, life: 75, max: 8, pigSlip: 3.4, standSlip: 1.4, bobSlip: 0.7 };

type BullState = 'graze' | 'notice' | 'paw' | 'charge' | 'dazed' | 'rest';
const STATES: BullState[] = ['graze', 'notice', 'paw', 'charge', 'dazed', 'rest'];
type Target = Pig | { kind: 'farmer' } | Prop;
const BOB_T = { kind: 'farmer' as const };

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
const inRect = (r: Rect, p: { x: number; z: number }) => p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1;
const angDiff = (a: number, b: number) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

interface Puddle { x: number; z: number; t0: number; mesh: THREE.Mesh }

export class Dairy implements CritterBrain {
  bull: Critter | null = null;
  state: BullState = 'graze';
  private until = 0;
  private target: Target | null = null;
  private dir = new THREE.Vector3();
  private from = new THREE.Vector3();
  private t0 = 0;
  private hits = new Set<unknown>();
  private scanAt = 0; private fxAt = 0; private bobCalm = 0; private ragCalm = 0;
  /** After running someone over he pulls up (doesn't carry on through the fence behind them). */
  private stopAt = 0;
  private churns: Prop[] = [];
  private spilled: boolean[] = [];
  private puddles: Puddle[] = [];
  private slipAt = new Map<unknown, number>();

  /** `pen` = the bull's paddock; `critters` / `props` = the farm's (filled while the farm is built). */
  constructor(scene: THREE.Scene, public pen: Rect, private critters: Critter[], private props: Prop[]) {
    const mat = toonMat(0xfbfbf4);
    mat.transparent = true; mat.polygonOffset = true; mat.polygonOffsetFactor = -3; mat.depthWrite = false;
    const geo = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
    // a lumpy puddle: wobble the rim
    const pa = geo.attributes.position;
    for (let i = 1; i < pa.count; i++) { const a = Math.atan2(pa.getZ(i), pa.getX(i)), k = 1 + Math.sin(a * 3) * 0.12 + Math.sin(a * 5 + 1) * 0.08; pa.setX(i, pa.getX(i) * k); pa.setZ(i, pa.getZ(i) * k); }
    for (let i = 0; i < MILK.max; i++) {
      const m = new THREE.Mesh(geo, mat.clone()); m.visible = false; m.renderOrder = 2; m.receiveShadow = true;
      m.scale.set(MILK.r * (1 + (i % 3) * 0.12), 1, MILK.r * (1.1 - (i % 2) * 0.15)); m.rotation.y = i * 1.3;
      scene.add(m);
      this.puddles.push({ x: 0, z: 0, t0: -1e9, mesh: m });
    }
    // cow tipping: a punch / headbutt on a cow knocks her over (rams already do, through Critter.knock)
    G.hittables.push({
      hit: (hx, _hy, hz, reach, dir) => {
        const c = this.critters.find((x) => x.def.kind === 'cow' && Math.hypot(x.pos.x - hx, x.pos.z - hz) < reach * 0.8 + x.radius + 0.3);
        if (c) c.knock(v1.copy(dir).multiplyScalar(2));
        return !!c;
      },
    });
  }

  /** The bull critter (built by the farm); this object becomes his brain. */
  setBull(c: Critter) { this.bull = c; c.brain = this; }
  get loose() { return !!this.bull && !inRect(this.pen, this.bull.pos); }

  // ================================================================== the bull's brain (host, inside Critter.control)
  step(c: Critter, p: { x: number; y: number; z: number }, dt: number): { speed: number; turn?: number } | null {
    const now = G.time;
    const face = (tp: THREE.Vector3, rate: number) => { c.yaw += Math.max(-rate * dt, Math.min(rate * dt, angDiff(c.yaw, Math.atan2(tp.x - p.x, tp.z - p.z)))); };
    if (this.state !== 'graze' && this.state !== 'charge' && this.state !== 'dazed' && this.target && !this.valid(this.target)) { this.state = 'rest'; this.until = now + 0.8; }
    switch (this.state) {
      case 'graze': {
        if (now < this.scanAt) return null;
        this.scanAt = now + BULL.scan;
        const t = this.pick(p);
        if (!t) return null;
        this.target = t; this.state = 'notice'; this.until = now + BULL.notice;
        G.audio.play('bull', { pos: v1.set(p.x, p.y, p.z), vol: 1, pitch: 0.62, minGap: 1.5 });
        if (t.kind === 'pig') G.events.push({ type: 'bullSees', who: t as Pig });
        return { speed: 0 };
      }
      case 'notice': case 'paw': {
        face(this.tpos(this.target!, v1), this.state === 'notice' ? 5 : 3.5);
        if (this.state === 'paw' && now > this.fxAt) {   // dust + steam from the nostrils
          this.fxAt = now + 0.35;
          const f = v2.set(Math.sin(c.yaw), 0, Math.cos(c.yaw));
          G.fx.puff(v1.set(p.x + f.x * 0.8, p.y - c.height / 2 + 0.1, p.z + f.z * 0.8), { count: 4, color: 0xc9ad84, speed: 1.4, up: 0.8, life: 0.7, size: 0.6, alpha: 0.55 });
          G.fx.puff(v1.set(p.x + f.x * 1.5, p.y + 0.35, p.z + f.z * 1.5), { count: 2, color: 0xffffff, speed: 0.8, up: 0.3, life: 0.5, size: 0.35, alpha: 0.6 });
          G.audio.play('mudstep', { pos: v1, vol: 0.5, pitch: 0.6, minGap: 0.3 });
        }
        if (now < this.until) return { speed: 0 };
        if (this.state === 'notice') {
          this.state = 'paw'; this.until = now + BULL.paw;
          G.audio.play('bull', { pos: v1.set(p.x, p.y, p.z), vol: 1, pitch: 0.55, minGap: 0.6 });
          G.noise(v1, 16);
          return { speed: 0 };
        }
        this.startCharge(c, p);
        return this.charge(c, p, dt);
      }
      case 'charge': return this.charge(c, p, dt);
      case 'dazed':
        if (now > this.fxAt) {   // stars
          this.fxAt = now + 0.3;
          G.fx.bits(v1.set(p.x, p.y + 1.1, p.z), { count: 3, color: 0xffe14a, spread: 0.4, speed: 1.2, up: 1.2, grav: 0, life: 0.5, size: 0.14, grow: 0, alpha: 1 });
        }
        if (now > this.until) { this.state = 'rest'; this.until = now + BULL.rest; }
        return { speed: 0 };
      case 'rest':
        if (now > this.until) { this.state = 'graze'; this.target = null; this.scanAt = now + 0.6; }
        return { speed: 0 };
    }
    return null;
  }

  private startCharge(c: Critter, p: { x: number; y: number; z: number }) {
    this.state = 'charge'; this.t0 = G.time; this.hits.clear(); this.stopAt = 0;
    this.from.set(p.x, p.y, p.z);
    this.dir.set(Math.sin(c.yaw), 0, Math.cos(c.yaw));
    G.audio.play('charge', { pos: this.from, vol: 1, pitch: 0.8 });
    G.audio.play('bull', { pos: this.from, vol: 1, pitch: 0.7, minGap: 0.3 });
    G.noise(this.from, 20);
    G.events.push({ type: 'bullCharge' });
  }

  /** Charging: barely turns (a pig that jumps aside is missed), runs over whatever is in front. */
  private charge(c: Critter, p: { x: number; y: number; z: number }, dt: number) {
    const now = G.time;
    // steer a little toward the target while it's still ahead
    if (this.target && this.valid(this.target)) {
      const tp = this.tpos(this.target, v1), dx = tp.x - p.x, dz = tp.z - p.z;
      if (dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw) > 1.5) c.yaw += Math.max(-BULL.turn * dt, Math.min(BULL.turn * dt, angDiff(c.yaw, Math.atan2(dx, dz))));
    }
    const fwd = v2.set(Math.sin(c.yaw), 0, Math.cos(c.yaw));
    c.target.set(p.x + fwd.x * 10, p.y, p.z + fwd.z * 10);
    if (now > this.fxAt) { this.fxAt = now + 0.12; G.fx.puff(v1.set(p.x, p.y - c.height / 2 + 0.1, p.z), { count: 2, color: 0xc9ad84, speed: 1, up: 0.5, life: 0.6, size: 0.7, alpha: 0.5 }); }
    this.ram(c, p, fwd);
    const ran = Math.hypot(p.x - this.from.x, p.z - this.from.z), sp = Math.hypot(c.vel.x, c.vel.z);
    if (now - this.t0 > 0.45 && sp < 2.4) {   // ran into a fence / a wall: BONK
      this.state = 'dazed'; this.until = now + BULL.dazed; this.fxAt = 0;
      G.audio.play('wood|thud', { pos: v1.set(p.x, p.y, p.z), vol: 1, pitch: 0.6 });
      G.audio.play('bull', { pos: v1, vol: 0.8, pitch: 0.9, minGap: 0.5 });
      G.noise(v1, 14);
      return { speed: 0 };
    }
    if (this.target?.kind === 'prop') this.ragCalm = now + 8;   // a rag on the ground: not again right away
    const tp = this.target ? this.tpos(this.target, v1) : null;
    const past = tp ? (tp.x - p.x) * fwd.x + (tp.z - p.z) * fwd.z < -2.5 : false;
    if (ran > BULL.chargeDist || now - this.t0 > BULL.chargeMax || past || (this.stopAt && now > this.stopAt)) { this.state = 'rest'; this.until = now + BULL.rest; return { speed: 0 }; }
    return { speed: BULL.speed, turn: BULL.turn };
  }

  /** Whatever is in front of the charging bull flies. */
  private ram(c: Critter, p: { x: number; y: number; z: number }, fwd: THREE.Vector3) {
    const fx = p.x + fwd.x * 1.0, fz = p.z + fwd.z * 1.0, R = BULL.reach;
    const near = (q: { x: number; z: number }, r = 0) => Math.hypot(q.x - fx, q.z - fz) < R + r;
    for (const pig of G.pigs as Pig[]) {
      if (pig.out || pig.cage || this.hits.has(pig) || pig.heldBy?.kind === 'farmer' || !near(pig.pos, 0.2) || Math.abs(pig.pos.y - p.y) > 1.6) continue;
      this.hits.add(pig);
      pig.knock(v1.set(fwd.x * 10 + (Math.random() - 0.5) * 3, 7.5, fwd.z * 10 + (Math.random() - 0.5) * 3), true);
      pig.hurt(25, 'bull');
      G.audio.play('body', { pos: pig.pos, vol: 1, pitch: 0.8 });
      G.audio.play('squeal', { pos: pig.pos, vol: 1, minGap: 0.2 });
      G.fx.bits(v1.copy(pig.pos).setY(pig.pos.y + 0.4), { count: 14, color: 0xfff1a8, speed: 4, up: 2, life: 0.5, size: 0.16, grow: 0, drag: 3, alpha: 1 });
      G.shakeFor(pig, 0.7);
      G.events.push({ type: 'bullHit', who: pig });
      if (pig === this.target) this.stopAt ||= G.time + 0.4;
    }
    const f = G.farmer;
    if (f && !this.hits.has(f) && near(f.pos, 0.3) && Math.abs(f.pos.y - (p.y - c.height / 2)) < 2) {
      this.hits.add(f);
      if (f.bullHit(fwd)) { this.bobCalm = G.time + BULL.bobCalm; G.audio.play('body', { pos: f.pos, vol: 1, pitch: 0.6 }); G.fx.shake(0.5); this.stopAt ||= G.time + 0.4; }
    }
    for (const o of G.holdables) {
      if (o === c || o.heldBy || this.hits.has(o) || (o as Pig).kind === 'pig') continue;
      const b = o.body.translation();
      if (!near(b, o.radius) || Math.abs(b.y - p.y) > 1.6) continue;
      this.hits.add(o);
      if (o.knock) o.knock(v1.set(fwd.x * 8, 4, fwd.z * 8), true);
      else o.body.applyImpulse(v1.set(fwd.x * 8 * o.mass, 4 * o.mass, fwd.z * 8 * o.mass), true);
    }
    for (const cr of this.critters) {
      if (cr === c || cr.mass <= 40 || this.hits.has(cr) || !near(cr.pos, cr.radius)) continue;
      this.hits.add(cr);
      cr.knock(v1.set(fwd.x * 3, 1.5, fwd.z * 3));
    }
    for (const g of (G.gates?.list ?? []) as Gate[]) {
      if (g.state === 'broken' || this.hits.has(g) || g.segDist(fx, fz) > 1.1) continue;
      this.hits.add(g);
      if (g.state === 'shut' || g.state === 'locked') g.smash(fwd, null);
      else g.body.applyImpulse({ x: fwd.x * 400, y: 0, z: fwd.z * 400 }, true);
    }
  }

  // ---------------------------------------------------------------- who he goes for
  private valid(t: Target) {
    if (t.kind === 'farmer') { const f = G.farmer; return !!f && !f.asleep && f.state !== 'down' && f.state !== 'off' && f.state !== 'away'; }
    if (t.kind === 'prop') { const pr = t as Prop; return !pr.banked; }
    const pig = t as Pig; return !ignored(pig) && !pig.out && !pig.cage && pig.heldBy?.kind !== 'farmer';
  }
  private tpos(t: Target, out: THREE.Vector3) {
    if (t.kind === 'farmer') return out.copy(G.farmer.pos);
    if (t.kind === 'prop') { const b = (t as Prop).body.translation(); return out.set(b.x, b.y, b.z); }
    return out.copy((t as Pig).pos);
  }
  private sees(p: { x: number; y: number; z: number }, q: THREE.Vector3) {
    const dir = v1.set(q.x - p.x, q.y + 0.4 - (p.y + 0.5), q.z - p.z), len = dir.length(); if (len < 0.01) return true;
    dir.divideScalar(len);
    const hit = raycast(v2.set(p.x, p.y + 0.5, p.z), dir, len, L.STATIC, this.bull?.body, (cl) => !SEE_THROUGH.has(cl.handle));   // rail fences: he sees through
    return !hit || hit.dist > len - 0.6;
  }
  /** The red rag (held by a pig, or lying around), a pig in his paddock / near him once he's loose, Bob (loose). */
  private pick(p: { x: number; y: number; z: number }): Target | null {
    const night = G.night > 0.6 ? 0.5 : 1;
    const loose = !inRect(this.pen, p);
    let best: Target | null = null, bd = Infinity;
    for (const pig of G.pigs as Pig[]) {
      if (pig.absent || !this.valid(pig)) continue;
      const d = Math.hypot(pig.pos.x - p.x, pig.pos.z - p.z);
      const rag = (pig.held as Prop | null)?.def?.id === 'redRag';
      const range = rag ? BULL.ragSee : loose ? BULL.looseSee : inRect(this.pen, pig.pos) ? BULL.see : 0;
      if (d > range * night) continue;
      if (!rag && G.cover.at(pig.pos) && d > 2.5) continue;           // hidden in the grass / a bush
      if (!this.sees(p, pig.pos)) continue;
      const score = rag ? d - 100 : d;                                 // the rag beats everything
      if (score < bd) { bd = score; best = pig; }
    }
    if (bd < -50) return best;
    for (const pr of this.props) {
      if (pr.def.id !== 'redRag' || pr.banked || pr.heldBy || G.time < this.ragCalm) continue;
      const b = pr.body.translation(), d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d > BULL.ragGround * night || d < 1.2 || !this.sees(p, v1.set(b.x, b.y, b.z))) continue;
      if (d < bd) { bd = d; best = pr; }
    }
    const f = G.farmer;
    if (loose && f && G.time > this.bobCalm && this.valid(BOB_T)) {
      const d = Math.hypot(f.pos.x - p.x, f.pos.z - p.z);
      if (d < BULL.bobSee * night && d < bd && this.sees(p, v1.copy(f.pos).setY(f.pos.y + 0.6))) { bd = d; best = BOB_T; }
    }
    return best;
  }

  /** A pig rammed / punched him: he turns on the nearest pig (host). */
  provoked(c: Critter) {
    if (G.net === 'client' || this.state !== 'graze') return;
    let best: Pig | null = null, bd = 4;
    for (const pig of G.pigs as Pig[]) { if (pig.absent || !this.valid(pig)) continue; const d = pig.pos.distanceTo(c.pos); if (d < bd) { bd = d; best = pig; } }
    if (!best) return;
    this.target = best; this.state = 'notice'; this.until = G.time + 0.35;
    G.audio.play('bull', { pos: c.pos, vol: 1, pitch: 0.6, minGap: 0.5 });
  }

  /** Animation for the bull (all browsers). */
  mode(): 'paw' | 'charge' | 'dazed' | null {
    return this.state === 'paw' || this.state === 'notice' ? 'paw' : this.state === 'charge' ? 'charge' : this.state === 'dazed' ? 'dazed' : null;
  }

  // ================================================================== milk (host, every fixed step)
  stepHost() {
    if (!this.churns.length) this.churns = this.props.filter((p) => p.def.id === 'milkChurn');
    const now = G.time;
    this.churns.forEach((ch, i) => {
      if (this.spilled[i] || ch.banked || ch.heldBy) return;
      const q = ch.body.rotation(), up = 1 - 2 * (q.x * q.x + q.z * q.z);
      if (up > MILK.tilt) return;
      // which way the opening points (the body's local +y, flattened)
      const ux = 2 * (q.x * q.y - q.w * q.z), uz = 2 * (q.y * q.z + q.w * q.x), ul = Math.hypot(ux, uz) || 1;
      const b = ch.body.translation();
      this.spill(ch, i, b.x + (ux / ul) * 0.7, b.z + (uz / ul) * 0.7);
    });
    // slips: Bob walking through, pigs sprinting / standing in it
    const live = this.puddles.filter((pd) => now - pd.t0 < MILK.life);
    if (!live.length) return;
    const inMilk = (q: { x: number; z: number }) => live.some((pd) => Math.hypot(q.x - pd.x, q.z - pd.z) < MILK.r * 0.85);
    const f = G.farmer;
    if (f && Math.hypot(f.vel.x, f.vel.z) > MILK.bobSlip && inMilk(f.pos) && f.slip()) G.audio.play('splash', { pos: f.pos, vol: 0.8, pitch: 1.2 });
    for (const pig of G.pigs as Pig[]) {
      if (pig.out || pig.cage || pig.heldBy || pig.mode === 'ragdoll' || now < (this.slipAt.get(pig) ?? 0)) continue;
      const sp = Math.hypot(pig.vel.x, pig.vel.z);
      if (sp < (pig.standing ? MILK.standSlip : MILK.pigSlip) || !inMilk(pig.pos)) continue;
      this.slipAt.set(pig, now + 2.5);
      pig.knock(v1.set(pig.vel.x * 0.5, 4, pig.vel.z * 0.5), true);
      G.audio.play('whoosh', { pos: pig.pos, vol: 0.9, pitch: 0.9 });
      G.audio.play('splash', { pos: pig.pos, vol: 0.6, pitch: 1.3 });
      G.events.push({ type: 'pigSlipped', who: pig });
    }
  }

  private spill(ch: Prop, i: number, x: number, z: number) {
    this.spilled[i] = true; ch.worth = 5;
    const slot = this.puddles.reduce((a, b) => (b.t0 < a.t0 ? b : a));
    slot.x = x; slot.z = z; slot.t0 = G.time;
    const at = v1.set(x, G.terrain.height(x, z) + 0.2, z);
    G.audio.play('splash', { pos: at, vol: 1 });
    G.audio.play('metal', { pos: at, vol: 0.6, pitch: 0.8 });
    G.fx.bits(at, { count: 18, color: 0xffffff, spread: 0.3, speed: 2.5, up: 2.5, grav: 10, life: 0.7, size: 0.1, grow: 0, alpha: 1 });
    G.noise(at, 9);
    G.events.push({ type: 'milkSpilled' });
  }

  /** Admin: spill milk right here. */
  spillAt(x: number, z: number) {
    const slot = this.puddles.reduce((a, b) => (b.t0 < a.t0 ? b : a));
    slot.x = x; slot.z = z; slot.t0 = G.time;
    G.audio.play('splash', { pos: v1.set(x, G.terrain.height(x, z), z), vol: 1 });
  }
  /** Admin: the bull comes for this pig right now. */
  sic(pig: Pig) { this.target = pig; this.state = 'notice'; this.until = G.time + 0.3; }
  /** Admin: the bull, out of his paddock (in front of his gate). */
  letOut(at: THREE.Vector3) {
    const b = this.bull; if (!b) return;
    b.body.setTranslation({ x: at.x, y: at.y + b.height / 2 + 0.3, z: at.z }, true); b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.synced.capture(); b.synced.capture();
    this.state = 'rest'; this.until = G.time + 1;
  }

  // ================================================================== all browsers
  render(_dt: number) {
    const now = G.time;
    for (const pd of this.puddles) {
      const age = now - pd.t0, on = age >= 0 && age < MILK.life;
      pd.mesh.visible = on;
      if (!on) continue;
      const grow = Math.min(1, age / 0.6), fade = Math.min(1, (MILK.life - age) / 6);
      pd.mesh.position.set(pd.x, G.terrain.height(pd.x, pd.z) + 0.04, pd.z);
      pd.mesh.scale.x = MILK.r * grow * (1 + (this.puddles.indexOf(pd) % 3) * 0.12); pd.mesh.scale.z = MILK.r * grow;
      (pd.mesh.material as THREE.Material).opacity = 0.92 * fade;
    }
  }
  onEvent(_type: string) { /* nothing to animate */ }

  /** New round: the bull back to grazing, churns full, no milk on the ground. */
  reset() {
    this.state = 'graze'; this.target = null; this.until = 0; this.bobCalm = 0; this.ragCalm = 0;
    this.spilled = []; this.slipAt.clear();
    for (const pd of this.puddles) { pd.t0 = -1e9; pd.mesh.visible = false; }
  }

  // network: bull state, spilled churns (bits), puddles (x, z, born)
  netState(n: number[]) {
    let bits = 0; this.spilled.forEach((s, i) => { if (s) bits |= 1 << i; });
    n.push(STATES.indexOf(this.state), bits);
    for (const pd of this.puddles) n.push(Math.round(pd.x * 100) / 100, Math.round(pd.z * 100) / 100, pd.t0 < -1e8 ? -1 : Math.round(pd.t0 * 10) / 10);
  }
  netApply(n: number[]) {
    if (!n.length) return;
    this.state = STATES[n[0]] ?? 'graze';
    if (!this.churns.length) this.churns = this.props.filter((p) => p.def.id === 'milkChurn');
    this.churns.forEach((ch, i) => { const s = (n[1] & (1 << i)) !== 0; this.spilled[i] = s; ch.worth = s ? 5 : null; });
    this.puddles.forEach((pd, i) => { const k = 2 + i * 3; if (n[k + 2] === undefined) return; pd.x = n[k]; pd.z = n[k + 1]; pd.t0 = n[k + 2] < 0 ? -1e9 : n[k + 2]; });
  }
}
