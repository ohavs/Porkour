import * as THREE from 'three';
import { RAPIER, world, L } from '../core/physics';
import type { Terrain, Rect } from '../world/terrain';

/**
 * Walkability grid for the farmer (0.5 m cells, baked from the static colliders), A* (8-way, no corner cutting)
 * + line-of-sight smoothing.
 */
export class Nav {
  readonly cell = 0.5;
  x0: number; z0: number; w: number; h: number;
  blocked: Uint8Array;
  private g: Float32Array; private f: Float32Array; private from: Int32Array; private stamp: Uint32Array; private closed: Uint32Array;
  private gen = 1;

  constructor(area: Rect, private terrain: Terrain, radius = 0.48) {
    this.x0 = area.x0; this.z0 = area.z0;
    this.w = Math.ceil((area.x1 - area.x0) / this.cell); this.h = Math.ceil((area.z1 - area.z0) / this.cell);
    const n = this.w * this.h;
    this.blocked = new Uint8Array(n);
    this.g = new Float32Array(n); this.f = new Float32Array(n); this.from = new Int32Array(n);
    this.stamp = new Uint32Array(n); this.closed = new Uint32Array(n);
    this.rasterize(radius);
  }

  /**
   * Bake: sample every static collider (boxes, cylinders, building trimeshes) every 0.2 m; a sample between
   * 0.35 and 2.05 m above the ground blocks every cell whose centre is within `radius` of it. Pure JS, ~50 ms.
   */
  private rasterize(R: number) {
    const ground = this.terrain.collider, cs = this.cell, W = this.w, H = this.h, R2 = R * R;
    const q = new THREE.Quaternion(), t = new THREE.Vector3(), p = new THREE.Vector3();
    const mark = (x: number, y: number, z: number) => {
      const rel = y - this.terrain.height(x, z);
      if (rel < 0.35 || rel > 2.05) return;
      const ci = Math.floor((x - this.x0) / cs), cj = Math.floor((z - this.z0) / cs);
      for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
        if (i < 0 || j < 0 || i >= W || j >= H) continue;
        const dx = this.x0 + (i + 0.5) * cs - x, dz = this.z0 + (j + 0.5) * cs - z;
        if (dx * dx + dz * dz <= R2) this.blocked[j * W + i] = 1;
      }
    };
    const local = (lx: number, ly: number, lz: number) => { p.set(lx, ly, lz).applyQuaternion(q).add(t); mark(p.x, p.y, p.z); };
    const steps = (len: number) => Math.max(1, Math.ceil(len / 0.2));
    world.forEachCollider((c) => {
      if (c.handle === ground.handle || !c.parent()?.isFixed() || !c.isEnabled()) return;
      if (((c.collisionGroups() >>> 16) & L.STATIC) === 0) return;
      const ct = c.translation(), cr = c.rotation();
      t.set(ct.x, ct.y, ct.z); q.set(cr.x, cr.y, cr.z, cr.w);
      const type = c.shapeType();
      if (type === RAPIER.ShapeType.Cuboid) {
        const he = c.halfExtents();
        const nx = steps(he.x * 2), ny = steps(he.y * 2), nz = steps(he.z * 2);
        for (let a = 0; a <= nx; a++) for (let b = 0; b <= ny; b++) for (let d = 0; d <= nz; d++) {
          if (a > 0 && a < nx && d > 0 && d < nz && b > 0 && b < ny) continue;   // the shell is enough
          local(-he.x + (2 * he.x * a) / nx, -he.y + (2 * he.y * b) / ny, -he.z + (2 * he.z * d) / nz);
        }
      } else if (type === RAPIER.ShapeType.Cylinder || type === RAPIER.ShapeType.Ball || type === RAPIER.ShapeType.Capsule) {
        const r = c.radius(), hh = type === RAPIER.ShapeType.Ball ? 0 : c.halfHeight();
        const ny = steps(hh * 2), na = Math.max(8, Math.ceil((Math.PI * 2 * r) / 0.2));
        for (let b = 0; b <= ny; b++) {
          const y = -hh + (ny ? (2 * hh * b) / ny : 0);
          for (let a = 0; a < na; a++) local(Math.cos((a / na) * 6.283) * r, y, Math.sin((a / na) * 6.283) * r);
        }
      } else if (type === RAPIER.ShapeType.TriMesh) {
        const v = c.vertices(), idx = c.indices();
        if (!idx) return;
        const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
        for (let k = 0; k < idx.length; k += 3) {
          A.fromArray(v, idx[k] * 3).applyQuaternion(q).add(t);
          B.fromArray(v, idx[k + 1] * 3).applyQuaternion(q).add(t);
          C.fromArray(v, idx[k + 2] * 3).applyQuaternion(q).add(t);
          const ymin = Math.min(A.y, B.y, C.y), ymax = Math.max(A.y, B.y, C.y);
          if (ymax < -1 || ymin > 3) continue;
          const n = steps(Math.max(A.distanceTo(B), B.distanceTo(C), C.distanceTo(A)));
          for (let a = 0; a <= n; a++) for (let b = 0; b <= n - a; b++) {
            const u = a / n, w = b / n, z = 1 - u - w;
            mark(A.x * u + B.x * w + C.x * z, A.y * u + B.y * w + C.y * z, A.z * u + B.z * w + C.z * z);
          }
        }
      }
    });
  }

  idx(x: number, z: number) {
    const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }
  free(x: number, z: number) { const k = this.idx(x, z); return k >= 0 && !this.blocked[k]; }
  center(k: number, out = new THREE.Vector3()) {
    const i = k % this.w, j = (k / this.w) | 0;
    const x = this.x0 + (i + 0.5) * this.cell, z = this.z0 + (j + 0.5) * this.cell;
    return out.set(x, this.terrain.height(x, z), z);
  }

  /** Closest walkable cell centre to a point (spiral search), or null. */
  nearestFree(x: number, z: number, maxR = 8): THREE.Vector3 | null {
    if (this.free(x, z)) { const k = this.idx(x, z); return this.center(k); }
    const ci = Math.floor((x - this.x0) / this.cell), cj = Math.floor((z - this.z0) / this.cell);
    const R = Math.ceil(maxR / this.cell);
    let best = -1, bd = Infinity;
    for (let r = 1; r <= R; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= this.w || j >= this.h || this.blocked[j * this.w + i]) continue;
        const d = di * di + dj * dj;
        if (d < bd) { bd = d; best = j * this.w + i; }
      }
      if (best >= 0) return this.center(best);
    }
    return null;
  }

  /** Straight walkable line between two points (samples every quarter cell). */
  los(ax: number, az: number, bx: number, bz: number) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / (this.cell * 0.5));
    for (let s = 0; s <= n; s++) {
      const t = n ? s / n : 0;
      if (!this.free(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  /** A* path from → to (both snapped to walkable cells). Returns smoothed waypoints (excluding the start) or null. */
  path(from: THREE.Vector3, to: THREE.Vector3, maxIter = 60000): THREE.Vector3[] | null {
    const a = this.nearestFree(from.x, from.z, 3), b = this.nearestFree(to.x, to.z, 6);
    if (!a || !b) return null;
    const s = this.idx(a.x, a.z), e = this.idx(b.x, b.z);
    if (s === e) return [b];
    const gen = ++this.gen, W = this.w, H = this.h;
    const ei = e % W, ej = (e / W) | 0;
    const hfn = (k: number) => {
      const dx = Math.abs((k % W) - ei), dz = Math.abs(((k / W) | 0) - ej);
      return (dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz));
    };
    const heap: number[] = [];
    const push = (k: number) => {
      heap.push(k); let i = heap.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (this.f[heap[p]] <= this.f[heap[i]]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last; let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1; let m = i;
          if (l < heap.length && this.f[heap[l]] < this.f[heap[m]]) m = l;
          if (r < heap.length && this.f[heap[r]] < this.f[heap[m]]) m = r;
          if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
        }
      }
      return top;
    };
    this.stamp[s] = gen; this.g[s] = 0; this.f[s] = hfn(s); this.from[s] = -1; push(s);
    let found = false, it = 0;
    while (heap.length && it++ < maxIter) {
      const k = pop();
      if (this.closed[k] === gen) continue;
      this.closed[k] = gen;
      if (k === e) { found = true; break; }
      const i = k % W, j = (k / W) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const nk = nj * W + ni;
        if (this.blocked[nk] || this.closed[nk] === gen) continue;
        if (di && dj && (this.blocked[j * W + ni] || this.blocked[nj * W + i])) continue;
        const ng = this.g[k] + (di && dj ? Math.SQRT2 : 1);
        if (this.stamp[nk] === gen && ng >= this.g[nk]) continue;
        this.stamp[nk] = gen; this.g[nk] = ng; this.f[nk] = ng + hfn(nk) * 1.05; this.from[nk] = k; push(nk);
      }
    }
    if (!found) return null;
    const cells: number[] = [];
    for (let k = e; k !== -1; k = this.from[k]) cells.push(k);
    cells.reverse();
    // string pulling: keep only the corners we cannot see past
    const pts = cells.map((k) => this.center(k));
    pts[0].copy(a);
    const out: THREE.Vector3[] = [];
    let anchor = pts[0], i = 0;
    while (i < pts.length - 1) {
      let j = i + 1;
      while (j + 1 < pts.length && this.los(anchor.x, anchor.z, pts[j + 1].x, pts[j + 1].z)) j++;
      out.push(pts[j]); anchor = pts[j]; i = j;
    }
    return out;
  }
}
