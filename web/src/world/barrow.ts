import * as THREE from 'three';
import { raycast, L } from '../core/physics';
import { clamp } from '../core/util';
import { G } from '../game/ctx';
import type { Prop } from './props';

/**
 * A real wheelbarrow (user: "everything physical: really grab things and take them where they go"). The prop's box
 * collider becomes a hollow tray (floor, sides, back, a sloped nose), two legs and a wheel, so whatever is dropped in
 * rides along and spills when it tips. A pig holds it by the handles (PropDef.push): lifted, it rolls on its wheel;
 * the tyre grips sideways (it steers like a wheelbarrow: turn and it follows round its wheel) and rolls freely forward;
 * R lifts the handles high = it tips forward over the wheel and the load slides out of the nose.
 * Host: the tyre grip. Every browser: the wheel spins as it rolls.
 */
const DOWN = new THREE.Vector3(0, -1, 0);
const q = new THREE.Quaternion(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
/** Wheel radius / axle (model space). */
const WR = 0.2, AXLE = new THREE.Vector3(0, 0.2, 0.66);

export class Wheelbarrow {
  private wheelL: THREE.Vector3;
  private h: number;
  private wheel: THREE.Object3D | null;
  private last = new THREE.Vector3(); private hasLast = false;
  private rattleAt = 0;

  constructor(public prop: Prop) {
    const h = this.h = prop.size.y / 2, Y = (y: number) => y - h;
    prop.compound([
      { box: [0.36, 0.025, 0.5], at: [0, Y(0.36), 0], mass: 14 },                              // floor
      { box: [0.03, 0.15, 0.5], at: [-0.37, Y(0.5), 0], rot: [0, 0, -0.18], mass: 1.5 },         // sides
      { box: [0.03, 0.15, 0.5], at: [0.37, Y(0.5), 0], rot: [0, 0, 0.18], mass: 1.5 },
      { box: [0.36, 0.14, 0.03], at: [0, Y(0.5), -0.5], rot: [0.2, 0, 0], mass: 1 },             // back
      { box: [0.38, 0.025, 0.17], at: [0, Y(0.49), 0.61], rot: [-0.87, 0, 0], mass: 1.5 },       // the sloped nose
      { box: [0.025, 0.16, 0.025], at: [-0.3, Y(0.16), -0.35], mass: 0.6, friction: 1 },          // legs (they hold it still)
      { box: [0.025, 0.16, 0.025], at: [0.3, Y(0.16), -0.35], mass: 0.6, friction: 1 },
      { ball: WR, at: [AXLE.x, Y(AXLE.y), AXLE.z], mass: 4, slick: true },                      // the wheel (the grip is below)
    ]);
    this.wheelL = new THREE.Vector3(AXLE.x, Y(AXLE.y), AXLE.z);
    this.wheel = prop.obj.getObjectByName('wheel') ?? null;
  }

  /** Where it points (yaw of its nose), for the pig pushing it. */
  static heading(p: Prop) { const r = p.body.rotation(), f = v1.set(0, 0, 1).applyQuaternion(q.set(r.x, r.y, r.z, r.w)); return Math.atan2(f.x, f.z); }
  /** Is this point (world) in the tray? */
  holds(p: THREE.Vector3) {
    const b = this.prop.body, t = b.translation(), r = b.rotation();
    const l = v1.set(p.x - t.x, p.y - t.y, p.z - t.z).applyQuaternion(q.set(r.x, r.y, r.z, r.w).invert());
    return Math.abs(l.x) < 0.42 && l.z > -0.55 && l.z < 0.7 && l.y > 0.36 - this.h - 0.05 && l.y < 0.36 - this.h + 0.5;
  }

  /** Host, every fixed step: the hooves on the handles keep it level; the tyre grips sideways and rolls. */
  step(dt: number) {
    const pr = this.prop, b = pr.body;
    if (pr.banked || pr.dockedIn || b.isSleeping()) return;
    const t = b.translation(), r = b.rotation();
    q.set(r.x, r.y, r.z, r.w);
    // two handles = two hooves: the holder keeps it level side to side (not its tilt forward / back: that's how high
    // the handles are; nor where it points: that's the handles pushed sideways, it pivots on its wheel)
    if ((pr.heldBy as { kind?: string } | null)?.kind === 'pig') {
      const cur = v3.set(1, 0, 0).applyQuaternion(q), want = v4.set(cur.x, 0, cur.z);
      if (want.lengthSq() > 0.05) {
        want.normalize();
        const e = v1.crossVectors(cur, want);                  // axis × angle back to level
        const ra = v2.set(0, 0, 1).applyQuaternion(q), av = b.angvel(), roll = av.x * ra.x + av.y * ra.y + av.z * ra.z;
        // velocity-level (stable whatever its inertia), capped: a ram can still knock it over
        const dw = e.multiplyScalar(40).addScaledVector(ra, -8 * roll).multiplyScalar(dt), cap = 14 * dt;
        if (dw.length() > cap) dw.setLength(cap);
        b.setAngvel({ x: av.x + dw.x, y: av.y + dw.y, z: av.z + dw.z }, true);
      }
      // tipped forward as far as the hooves go (~70°): it stops there instead of going over its nose
      const nose = Math.asin(clamp(-v2.set(0, 0, 1).applyQuaternion(q).y, -1, 1)), ax = v3.set(1, 0, 0).applyQuaternion(q);
      if (nose > 1.15) {
        const w = b.angvel(), rate = w.x * ax.x + w.y * ax.y + w.z * ax.z, want = -(nose - 1.15) * 4;
        if (rate > want) b.setAngvel({ x: w.x + ax.x * (want - rate), y: w.y + ax.y * (want - rate), z: w.z + ax.z * (want - rate) }, true);
      }
    }
    const w = v1.copy(this.wheelL).applyQuaternion(q).add(v2.set(t.x, t.y, t.z));
    if (!raycast(w, DOWN, WR + 0.07, L.STATIC, b)) return;   // the wheel isn't on the ground
    const ax = v3.set(1, 0, 0).applyQuaternion(q); ax.y = 0;
    if (ax.lengthSq() < 0.3) return;                          // on its side
    ax.normalize();
    const fw = v4.set(-ax.z, 0, ax.x);                        // rolling direction (flat)
    const lv = b.linvel(), av = b.angvel(), c = b.worldCom();
    const rx = w.x - c.x, ry = w.y - c.y, rz = w.z - c.z;
    const vx = lv.x + av.y * rz - av.z * ry, vz = lv.z + av.x * ry - av.y * rx;   // the wheel hub's velocity (v + ω × r)
    const m = pr.mass * 0.6, maxJ = 0.9 * 20 * m * dt;        // the tyre's grip: up to ~μ·N
    const j = clamp(-(vx * ax.x + vz * ax.z) * m, -maxJ, maxJ);
    const roll = vx * fw.x + vz * fw.z, jr = -roll * m * 0.5 * dt;
    b.applyImpulseAtPoint({ x: ax.x * j + fw.x * jr, y: 0, z: ax.z * j + fw.z * jr }, { x: w.x, y: w.y, z: w.z }, true);
    // a loaded barrow rattling along
    if (Math.abs(roll) > 1.2 && G.time > this.rattleAt) { this.rattleAt = G.time + 0.45; G.audio.play('tick', { pos: w, vol: 0.25, pitch: 0.45 + Math.random() * 0.1 }); }
  }

  /** Every frame: the wheel turns with how far it rolled. */
  render() {
    const o = this.prop.obj;
    if (!this.wheel || !o.visible) { this.hasLast = false; return; }
    if (this.hasLast) {
      const d = v1.copy(o.position).sub(this.last).dot(v2.set(0, 0, 1).applyQuaternion(o.quaternion));
      if (Math.abs(d) < 1) this.wheel.rotation.x += d / WR;
    }
    this.last.copy(o.position); this.hasLast = true;
  }
}
