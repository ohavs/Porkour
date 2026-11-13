import * as THREE from 'three';

/**
 * Soft cover: bushes, corn, tall wheat, hay… things pigs can walk INTO and that hide them from Bob's eyes
 * (no collider). Bob's sight ray is blocked where it runs through a cover volume below its top; a pig deep inside
 * one is hidden, a pig standing on 2 legs pokes its head over low bushes. Moving fast inside rustles (noise).
 * Circles (bushes) or axis-aligned rects (crop fields). Looked up through a coarse grid.
 */
export interface CoverVol {
  kind: 'bush' | 'crop' | 'hay';
  /** circle: x, z, r · rect: x0..x1, z0..z1 */
  x: number; z: number; r: number;
  rect?: { x0: number; x1: number; z0: number; z1: number };
  /** Ground height and top (world y). */
  y0: number; top: number;
  stamp: number;
}

const CELL = 8;

/** The point Bob has to see of a pig: its back on 4 legs, its head standing (pokes over low bushes / wheat). */
export function sightPoint(p: { pos: THREE.Vector3; standing?: boolean }, out: THREE.Vector3) {
  return out.set(p.pos.x, p.pos.y + (p.standing ? 0.72 : 0.3), p.pos.z);
}

export class CoverMap {
  list: CoverVol[] = [];
  private grid = new Map<number, CoverVol[]>();
  private stamp = 0;

  private key(cx: number, cz: number) { return (cx + 512) * 4096 + (cz + 512); }
  private insert(c: CoverVol, x0: number, x1: number, z0: number, z1: number) {
    this.list.push(c);
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const k = this.key(cx, cz);
        let a = this.grid.get(k); if (!a) this.grid.set(k, (a = []));
        a.push(c);
      }
  }

  /** A bush-like round volume (radius r, height h above the ground y0). */
  circle(kind: CoverVol['kind'], x: number, z: number, r: number, y0: number, h: number) {
    this.insert({ kind, x, z, r, y0, top: y0 + h, stamp: 0 }, x - r, x + r, z - r, z + r);
  }
  /** A field (rect). */
  rect(kind: CoverVol['kind'], x0: number, x1: number, z0: number, z1: number, y0: number, h: number) {
    this.insert({ kind, x: (x0 + x1) / 2, z: (z0 + z1) / 2, r: 0, rect: { x0, x1, z0, z1 }, y0, top: y0 + h, stamp: 0 }, x0, x1, z0, z1);
  }

  /** The cover volume this point is inside of (and below the top of), if any. */
  at(p: THREE.Vector3, pad = 0): CoverVol | null {
    const a = this.grid.get(this.key(Math.floor(p.x / CELL), Math.floor(p.z / CELL)));
    if (!a) return null;
    for (const c of a) {
      if (p.y > c.top) continue;
      if (c.rect) { const r = c.rect; if (p.x > r.x0 - pad && p.x < r.x1 + pad && p.z > r.z0 - pad && p.z < r.z1 + pad) return c; }
      else if (Math.hypot(p.x - c.x, p.z - c.z) < c.r + pad) return c;
    }
    return null;
  }

  /**
   * Does cover hide `to` from an eye at `from`? The ray must run through at least `depth` m of foliage below its top
   * (a pig at the very edge of a bush peeks out). Volumes containing the eye are ignored (Bob in the corn sees close by).
   */
  blocks(from: THREE.Vector3, to: THREE.Vector3, depth = 0.7): boolean {
    const dx = to.x - from.x, dz = to.z - from.z, dy = to.y - from.y;
    const len = Math.hypot(dx, dz); if (len < 0.01) return false;
    const st = ++this.stamp;
    const cx0 = Math.floor(Math.min(from.x, to.x) / CELL), cx1 = Math.floor(Math.max(from.x, to.x) / CELL);
    const cz0 = Math.floor(Math.min(from.z, to.z) / CELL), cz1 = Math.floor(Math.max(from.z, to.z) / CELL);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const a = this.grid.get(this.key(cx, cz)); if (!a) continue;
      for (const c of a) {
        if (c.stamp === st) continue;
        c.stamp = st;
        // parametric entry / exit of the 2D segment
        let t0 = 0, t1 = 1;
        if (c.rect) {
          const r = c.rect;
          if (from.x > r.x0 && from.x < r.x1 && from.z > r.z0 && from.z < r.z1) continue;
          for (const [o, d, lo, hi] of [[from.x, dx, r.x0, r.x1], [from.z, dz, r.z0, r.z1]] as const) {
            if (Math.abs(d) < 1e-6) { if (o < lo || o > hi) { t0 = 2; break; } continue; }
            let a0 = (lo - o) / d, a1 = (hi - o) / d; if (a0 > a1) { const s = a0; a0 = a1; a1 = s; }
            t0 = Math.max(t0, a0); t1 = Math.min(t1, a1);
          }
        } else {
          const fx = from.x - c.x, fz = from.z - c.z;
          const A = dx * dx + dz * dz, B = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - c.r * c.r;
          if (C < 0) continue;                                    // the eye is inside this one
          const disc = B * B - 4 * A * C; if (disc <= 0) continue;
          const sq = Math.sqrt(disc);
          t0 = Math.max(t0, (-B - sq) / (2 * A)); t1 = Math.min(t1, (-B + sq) / (2 * A));
        }
        if (t1 <= t0 || t0 > 1) continue;
        // how much of the ray inside the volume is below its top
        const yIn = from.y + dy * t0, yOut = from.y + dy * t1;
        if (yIn > c.top && yOut > c.top) continue;
        let tb0 = t0, tb1 = t1;
        if (Math.abs(dy) > 1e-6) {
          const tTop = (c.top - from.y) / dy;
          if (dy < 0) tb0 = Math.max(t0, tTop); else tb1 = Math.min(t1, tTop);
        }
        if ((tb1 - tb0) * len >= depth) return true;
      }
    }
    return false;
  }
}
