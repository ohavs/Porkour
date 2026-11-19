import * as THREE from 'three';
import { G } from '../game/ctx';
import type { Pig } from '../pig/pig';
import type { Prop } from './props';

/**
 * Everything a pig can sit on (user: "sitting faces the camera, like Fortnite's couch" — the lounge couch, armchairs,
 * beanbags, and the furniture inside buildings: couches, chairs, stools, beds, the toilet…). RMB at a free seat = sit
 * (pig.ts `sitDown`), held there by a velocity spring that follows the seat (a couch being dragged carries its sitter);
 * a seat on a prop that's been knocked over / picked up / stolen is no use: the sitter gets up. `Pig.seat` = the index
 * here (synced; every machine registers the same seats in the same order).
 */
export interface Seat {
  /** The cushion top (world) now, or null when it can't be sat on (tipped over, carried, gone). */
  at(out: THREE.Vector3): THREE.Vector3 | null;
  /** Which way a sitter faces (world yaw). */
  yaw(): number;
  /** How high the cushion is above the floor (getting up: back down to the floor). */
  h: number;
}

// (separate temps: `at(out)` callers pass their own vectors — never let one alias another)
const v1 = new THREE.Vector3(), vT = new THREE.Vector3(), vU = new THREE.Vector3(), vF = new THREE.Vector3(), vS = new THREE.Vector3(), q1 = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);

class Seats {
  list: Seat[] = [];
  /** RMB reach to a seat (m, along the ground). */
  sitR = 0.95;
  add(s: Seat) { this.list.push(s); return this.list.length - 1; }
  /** A fixed seat (world spot + facing). */
  fixed(p: THREE.Vector3, yaw: number, h: number) { const c = p.clone(); return this.add({ at: (o) => o.copy(c), yaw: () => yaw, h }); }
  /** A seat on a furniture prop: `local` = the cushion in the prop's body space, `ly` = facing in its space. */
  onProp(pr: Prop, local: THREE.Vector3, ly: number, h: number) {
    const lp = local.clone();
    return this.add({
      h,
      at: (o) => {
        if (pr.banked || pr.heldBy) return null;
        const r = pr.body.rotation(); q1.set(r.x, r.y, r.z, r.w);
        if (vU.set(0, 1, 0).applyQuaternion(q1).y < 0.8) return null;   // knocked over
        const t = pr.body.translation();
        return o.copy(lp).applyQuaternion(q1).add(vT.set(t.x, t.y, t.z));
      },
      yaw: () => { const r = pr.body.rotation(); const f = vF.set(Math.sin(ly), 0, Math.cos(ly)).applyQuaternion(q1.set(r.x, r.y, r.z, r.w)); return Math.atan2(f.x, f.z); },
    });
  }
  at(i: number, out: THREE.Vector3) { return this.list[i]?.at(out) ?? null; }
  yaw(i: number) { return this.list[i]?.yaw() ?? 0; }
  /** The free seat a pig standing here would sit on (close along the ground, about its height), or -1. */
  seatFor(p: Pig) {
    if (p.out || p.cage || p.heldBy || p.mode !== 'normal' || p.gulag) return -1;
    let best = -1, bd = this.sitR;
    for (let i = 0; i < this.list.length; i++) {
      const s = this.list[i].at(vS); if (!s) continue;
      const d = Math.hypot(p.pos.x - s.x, p.pos.z - s.z);
      if (d >= bd || Math.abs(s.y - p.pos.y) > 1.3) continue;
      if ((G.pigs as Pig[]).some((o) => o.seat === i && o !== p)) continue;
      bd = d; best = i;
    }
    return best;
  }
  /** Getting up: a step in front of the seat, on the floor. */
  standSpot(i: number, out: THREE.Vector3) {
    const s = this.list[i]; if (!s || !s.at(out)) return null;
    const y = s.yaw();
    return out.addScaledVector(vF.set(Math.sin(y), 0, Math.cos(y)), 0.62).setY(out.y - s.h + 0.16);
  }
}
export const SEATS = new Seats();
void UP;
