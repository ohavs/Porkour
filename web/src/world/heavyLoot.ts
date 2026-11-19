import * as THREE from 'three';
import { G } from '../game/ctx';
import type { Loop } from '../core/audio';
import { PROPS, type Prop } from './props';

/**
 * Heavy loot that does something (the safe only scrapes): the grandfather clock shows the game's time, ticks, swings its
 * pendulum while it stands, and goes BONG on every full hour (three on 6 / 12) wherever it is — Bob hears that far, so
 * pigs dragging it time their run between the bongs, or park it in a bush. Knocked flat it clangs. Bob's old TV is in
 * props.ts (its screen cracks on a hard knock).
 */
export const CLOCK = { hear: 22, bongGap: 1.6, fallHear: 16 };

const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3(), q1 = new THREE.Quaternion();

interface ClockView { prop: Prop; hour: THREE.Object3D | null; min: THREE.Object3D | null; pend: THREE.Object3D | null; tick: Loop | null; lying: boolean }

export class HeavyLoot {
  private clocks: ClockView[];
  /** Host: the hour it last struck, bongs still to come, when the next one sounds. */
  private struck = -1; private bongs = 0; private bongAt = 0;

  constructor(props: Prop[]) {
    this.clocks = props.filter((p) => p.def === PROPS.clock).map((prop) => ({
      prop, hour: prop.obj.getObjectByName('hourHand') ?? null, min: prop.obj.getObjectByName('minHand') ?? null,
      pend: prop.obj.getObjectByName('pendulum') ?? null, tick: null, lying: false,
    }));
  }
  get any() { return this.clocks.length > 0; }

  /** Host, every fixed step: the hourly strike (sounds + noise are recorded for the players). */
  stepHost() {
    if (!this.clocks.length) return;
    const h = Math.floor(G.hour);
    if (this.struck < 0) this.struck = h;
    if (h !== this.struck) { this.struck = h; this.strike(h % 6 === 0 ? 3 : 1); }
    if (this.bongs > 0 && G.time > this.bongAt) { this.bongs--; this.bongAt = G.time + CLOCK.bongGap; this.bong(); }
    // knocked over: a clang (it lands on its side)
    for (const c of this.clocks) {
      const p = c.prop;
      if (p.banked) { c.lying = false; continue; }
      const r = p.body.rotation(), up = v1.set(0, 1, 0).applyQuaternion(q1.set(r.x, r.y, r.z, r.w));
      const lying = up.y < 0.45;
      if (lying && !c.lying && p.synced.preVel.length() > 1.2) {
        const t = p.body.translation(), at = v1.set(t.x, t.y, t.z);
        G.audio.play('bong', { pos: at, vol: 0.8, pitch: 0.7, rand: 0.1 });
        G.audio.play('wood', { pos: at, vol: 1, pitch: 0.6 });
        G.noise(at, CLOCK.fallHear);
      }
      c.lying = lying;
    }
  }
  /** Admin: strike now. */
  strike(n = 1) { this.bongs = n; this.bongAt = G.time; }
  private bong() {
    for (const c of this.clocks) {
      if (c.prop.banked) continue;
      const t = c.prop.body.translation(), at = v1.set(t.x, t.y + 0.6, t.z);
      G.audio.play('bong', { pos: at, vol: 1, rand: 0.03, minGap: 0.2 });
      G.fx.puff(v1.set(t.x, t.y + 1.1, t.z), { count: 3, color: 0xffe08a, speed: 0.8, up: 0.6, life: 0.6, size: 0.35, alpha: 0.35 });
      G.noise(at, CLOCK.hear, c.prop.homeDist() < 2.5);   // his clock striking where it always stands: nothing to look into
      G.events.push({ type: 'clockBong', why: String(this.clocks.indexOf(c)) });
    }
  }
  /** New round: it strikes again from the round's first hour. */
  reset() { this.struck = -1; this.bongs = 0; }

  /** Every browser: hands at the game's time, the pendulum swings while it stands, a soft tick nearby. */
  render() {
    for (const c of this.clocks) {
      const p = c.prop, h = G.hour;
      if (c.hour) c.hour.rotation.z = -((h % 12) / 12) * Math.PI * 2;
      if (c.min) c.min.rotation.z = -(h % 1) * Math.PI * 2;
      const q = p.obj.quaternion, up = v1.copy(UP).applyQuaternion(q);
      if (c.pend) c.pend.rotation.z = up.y > 0.8 ? Math.sin(G.time * Math.PI) * 0.22 : c.pend.rotation.z * 0.9;
      if (!c.tick && G.audio?.has?.('tick')) c.tick = G.audio.loop('tick', { pos: p.obj.position, vol: 0.55, ref: 1.2, bus: 'sfx' });
      if (c.tick) { c.tick.setPos(p.obj.position); c.tick.setVolume(p.banked || up.y < 0.8 ? 0 : 0.55, 0.3); }
    }
  }
  /** Where the clocks are (HUD pops on a bong). */
  clockPos(i: number) { return this.clocks[i]?.prop.obj.position ?? null; }
}
