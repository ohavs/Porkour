import * as THREE from 'three';
import { G, type Cloud, type Flame } from '../game/ctx';
import type { Pig } from '../pig/pig';
import type { Prop } from './props';

/**
 * Fart + fire = FIREBALL (s25). A fresh fart cloud (≤ 2.2 s old) that reaches something burning — the BBQ grill, a lit
 * fireplace, an oven baking, a jack-o'-lantern, a lighter's flame, the brew fire pit, a pig's cigarette (yours too:
 * don't fart while you smoke) — goes up: a ball of flame, BOOM. Pigs close by are blown over and come out black with
 * soot (smoking), loose things fly, animals run, Bob right next to it lands flat on his back with a black face and
 * drops the pig he carries (a carried pig's fart by the grill = a way out). Other fresh fart clouds nearby go up too.
 * Host only; the fx / sounds are recorded inside the fixed step and replayed on the players' machines.
 */
export const FIREBALL = { age: 2.2, pigR: 4.2, propR: 5, bobR: 4.2, startleR: 7, noise: 30, soot: 12 };

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const FLASH = new THREE.Color(2.2, 2, 1.6), CORE = new THREE.Color(2, 1.6, 0.7), HOT = new THREE.Color(1.8, 0.85, 0.2);

export class Fireballs {
  /** Bursts still burning (0.35 s): they light the fart clouds next to them (a chain). */
  private bursts: { at: THREE.Vector3; until: number }[] = [];
  /** Admin / tests: how many went off. */
  count = 0;

  /** The flames a pig carries: a lit cigarette at its snout. */
  private pigFlames(out: { at: THREE.Vector3; r: number }[]) {
    for (const p of G.pigs as Pig[]) {
      if (!p.smoking || p.out || p.absent) continue;
      const f = p.forward;
      out.push({ at: new THREE.Vector3(p.pos.x + f.x * 0.5, p.pos.y + (p.standing ? 0.55 : 0.25), p.pos.z + f.z * 0.5), r: 0.35 });
    }
  }

  /** Host, every fixed step (lobby too: its cigarettes burn). */
  step() {
    const now = G.time;
    this.bursts = this.bursts.filter((b) => b.until > now);
    const fresh = G.clouds.filter((c) => c.by && !c.lit && c.born !== undefined && now - c.born < FIREBALL.age && c.until > now);
    if (!fresh.length) return;
    const fl: { at: THREE.Vector3; r: number }[] = [];
    for (const f of G.flames as Flame[]) { const p = f.at(new THREE.Vector3()); if (p) fl.push({ at: p, r: f.r }); }
    this.pigFlames(fl);
    for (const b of this.bursts) fl.push({ at: b.at, r: 1.5 });
    for (const c of fresh) {
      const cp = v1.set(c.x, c.y, c.z);
      for (const f of fl) {
        if (cp.distanceTo(f.at) > c.r * 0.5 + f.r) continue;
        this.boom(c, v2.copy(cp).lerp(f.at, 0.5));
        break;
      }
    }
  }

  /** The fireball itself (host). `c` = the fart cloud that went up (null = admin). */
  boom(c: Cloud | null, at0: THREE.Vector3, by: Pig | null = (c?.by as Pig) ?? null) {
    const now = G.time, at = at0.clone();
    if (c) { c.lit = true; c.until = now; }   // the fire ate the gas: no stink left to cough in
    this.count++;
    this.bursts.push({ at: at.clone(), until: now + 0.35 });
    G.audio.play('bang', { pos: at, vol: 1, pitch: 0.72, rand: 0.05, minGap: 0 });
    G.audio.play('fire', { pos: at, vol: 1, pitch: 1.35, minGap: 0 });
    G.audio.play('whoosh', { pos: at, vol: 1, pitch: 0.55, minGap: 0 });
    // (colours over 1 = brighter than white: the bloom makes them glow)
    G.fx.bits(at, { count: 3, color: FLASH, spread: 0.2, speed: 0.4, up: 0.3, grav: 0, life: 0.18, size: 2.2, grow: 1, alpha: 0.9 });                          // flash
    G.fx.bits(at, { count: 18, color: CORE, spread: 0.45, speed: 2.2, up: 1.6, grav: -2, life: 0.45, size: 0.8, grow: 1.4, drag: 3, alpha: 0.85 });              // white-hot core
    G.fx.bits(at, { count: 30, color: HOT, spread: 0.5, speed: 2.8, up: 2.0, grav: -1.5, life: 0.7, size: 0.65, grow: 1.3, drag: 3, alpha: 0.85 });     // the ball of flame
    G.fx.puff(at, { count: 14, color: 0xff7a1a, spread: 0.5, speed: 2.2, up: 2.2, life: 0.8, size: 1.0, grow: 1.5, drag: 3, alpha: 0.6 });
    G.fx.puff(v3.copy(at).setY(at.y + 0.8), { count: 14, color: 0x4a4542, spread: 0.6, speed: 1.4, up: 2.6, life: 2.4, size: 1.0, grow: 1.8, drag: 1.2, alpha: 0.45 });   // smoke
    G.fx.bits(at, { count: 28, color: 0xff7a1a, spread: 0.3, speed: 5.5, up: 4, grav: 6, life: 0.9, size: 0.1, grow: 0, alpha: 1 });   // sparks
    G.noise(at, FIREBALL.noise);
    G.clouds.push({ x: at.x, y: at.y, z: at.z, r: 7, until: now + 1.4, kind: 'bang' });   // animals run
    // pigs: blown over, black with soot
    for (const pig of G.pigs as Pig[]) {
      if (pig.out || pig.absent) continue;
      const d = Math.hypot(pig.pos.x - at.x, pig.pos.z - at.z), dy = Math.abs(pig.pos.y - at.y);
      if (d < 14) G.shakeFor(pig, Math.max(0.15, 0.75 * (1 - d / 14)));
      if ((d > FIREBALL.pigR || dy > 2.5) && pig !== by) continue;
      const k = pig === by ? 1 : 1 - d / FIREBALL.pigR;
      pig.burntUntil = Math.max(pig.burntUntil, pig.now + 4 + FIREBALL.soot * k);
      if (pig.cage) continue;
      const dx = (pig.pos.x - at.x) / (d || 1), dz = (pig.pos.z - at.z) / (d || 1);
      pig.knock(v1.set(dx * 6.5 * k, 5 + 4.5 * k, dz * 6.5 * k), pig === by || d < FIREBALL.pigR * 0.7);
    }
    // loose things fly
    for (const pr of G.props as Prop[]) {
      if (pr.banked || pr.heldBy || pr.pooled) continue;
      const q = pr.body.translation(), d = Math.hypot(q.x - at.x, q.z - at.z);
      if (d > FIREBALL.propR || Math.abs(q.y - at.y) > 2.2 || pr.mass > 60) continue;
      const k = (1 - d / FIREBALL.propR) * Math.min(1, 12 / pr.mass);
      pr.knock(v1.set((q.x - at.x) / (d || 1) * 6 * k, 3.5 * k, (q.z - at.z) / (d || 1) * 6 * k));
    }
    // Bob: right next to it = flat on his back, black face; a bit further = he jumps
    const f = G.farmer;
    if (f) {
      const d = Math.hypot(f.pos.x - at.x, f.pos.z - at.z);
      if (d < FIREBALL.startleR && Math.abs(f.pos.y + 0.8 - at.y) < 2.6) f.fireballed(at, d < FIREBALL.bobR);
    }
    G.events.push({ type: 'fireball', who: by });
  }
}
