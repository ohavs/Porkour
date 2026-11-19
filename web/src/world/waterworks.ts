import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RAPIER, world, groups, L, WALKABLE, staticBox, staticCylinder } from '../core/physics';
import { Rng, V3, clamp } from '../core/util';
import { toonMat } from '../render/toon';
import { G } from '../game/ctx';
import type { Loop } from '../core/audio';
import { LEVEL, type Terrain, type Rect, type Water } from './terrain';

/**
 * The shape of the land (user 2026-11-19: "the maps are the same with other colours — I want a wider change"):
 * draws what `Terrain.river` / `Terrain.terrace` carved — flowing water ribbons (streaks drift downstream), waterfalls
 * where a stream drops over a terrace, dry-stone retaining walls along the terrace steps (+ the walls beside each ramp),
 * and the things you cross water on: arched plank bridges, boardwalks on posts, stepping stones (all walkable: Bob's
 * nav grid ignores them, so he paths across). Sounds: running water near a river, a waterfall's roar.
 */
const STONE = [0x9d968a, 0x8c857a, 0xa8a094, 0x7f796f, 0xb0a796];
const PLANK = [0xa8774a, 0x9a6a3f, 0xb3824f];
const DARK = 0x6b4a2c;
const v1 = new THREE.Vector3();

/** Vertex-coloured copy of a geometry placed by a matrix (merged into one mesh per kind). */
function part(g: THREE.BufferGeometry, color: number, m: THREE.Matrix4) {
  const ng = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(m);
  ng.deleteAttribute('uv');
  const c = new THREE.Color(color), n = ng.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  ng.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return ng;
}
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 8);
const ROCK = new THREE.CylinderGeometry(1, 1.12, 1, 9);

/** Soft light streaks on the water (emissive map, scrolled downstream). */
function streaks() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const k = c.getContext('2d')!; k.fillStyle = '#000'; k.fillRect(0, 0, 64, 256);
  const r = new Rng(7);
  for (let i = 0; i < 26; i++) {
    const x = r.range(2, 62), y = r.range(0, 256), len = r.range(14, 46), w = r.range(1.5, 3.5);
    const gr = k.createLinearGradient(0, y, 0, y + len);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${r.range(0.35, 0.8)})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    k.fillStyle = gr; k.fillRect(x, y, w, len);
    if (y + len > 256) { k.fillRect(x, y - 256, w, len); }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export interface Fall { x: number; z: number; y: number }

export class Waterworks {
  readonly group = new THREE.Group();
  private stones: THREE.BufferGeometry[] = [];
  private woods: THREE.BufferGeometry[] = [];
  private tex = streaks();
  private water: THREE.MeshToonMaterial;
  /** Where streams drop over a terrace wall (foam + the waterfall loop). */
  falls: Fall[] = [];
  private rng = new Rng(4242);
  private loops: { river?: Loop | null; falls: (Loop | null)[] } = { falls: [] };
  private k = 0;

  constructor(private scene: THREE.Scene, private t: Terrain, private F: Rect) {
    const murky = t.waterTint !== 0x4fb2e3;
    this.water = toonMat(t.waterTint, { transparent: true, opacity: murky ? 0.93 : 0.86, emissive: murky ? 0x8fbf90 : 0x9fdcff, emissiveIntensity: murky ? 0.22 : 0.55, emissiveMap: this.tex });
    scene.add(this.group);
    this.group.name = 'waterworks';
  }

  // ================================================================== water
  /** A ribbon of water over every water course (+ a disc for a round pool) and the falls where a stream drops. */
  waters() {
    for (const wt of this.t.waters) this.ribbon(wt);
    for (const st of this.t.steps) for (const wt of this.t.waters) for (const x of this.crossings(wt, st.z)) {
      this.falls.push({ x, z: st.z + 0.35, y: this.t.base(x, st.z + 1.5) - LEVEL });
    }
  }
  private ribbon(wt: Water) {
    const P = wt.pts, half = wt.w / 2 + 1.1;
    let geo: THREE.BufferGeometry;
    if (P.length === 1) {
      geo = new THREE.CircleGeometry(half, 40).rotateX(-Math.PI / 2);
      geo.translate(P[0][0], this.t.surfaceAt(P[0][0], P[0][1]), P[0][1]);
    } else {
      // resample finely so the surface follows terrace drops closely (a waterfall = a short steep stretch)
      const pts: [number, number][] = [];
      for (let i = 0; i < P.length - 1; i++) {
        const [ax, az] = P[i], [bx, bz] = P[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5));
        for (let j = 0; j < n; j++) pts.push([ax + (bx - ax) * (j / n), az + (bz - az) * (j / n)]);
      }
      pts.push(P[P.length - 1]);
      const pos: number[] = [], uv: number[] = [], idx: number[] = [];
      let len = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        const [x, z] = pts[i], y = this.t.surfaceAt(x, z) + 0.02;
        if (i) len += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
        pos.push(x - tz * half, y, z + tx * half, x + tz * half, y, z - tx * half);
        uv.push(0, len / 7, 1, len / 7);
        if (i) { const o = (i - 1) * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
      }
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals();
      // the normal can face down if the strip winds the other way: keep it up
      const nm = geo.attributes.normal as THREE.BufferAttribute;
      if (nm.getY(0) < 0) { for (let i = 0; i < idx.length; i += 3) { const a = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = a; } geo.setIndex(idx); geo.computeVertexNormals(); }
    }
    const m = new THREE.Mesh(geo, this.water);
    m.receiveShadow = true; m.castShadow = false; m.name = 'water';
    this.group.add(m);
    // reeds along the banks
    for (let i = 0; i < P.length; i += 2) {
      if (this.rng.next() < 0.45) continue;
      const [x, z] = P[i], s = this.rng.next() < 0.5 ? 1 : -1;
      const j = Math.min(P.length - 1, i + 1), dx = P[j][0] - x, dz = P[j][1] - z, dl = Math.hypot(dx, dz) || 1;
      const off = wt.w / 2 + this.rng.range(0.1, 0.9);
      const rx = x - (dz / dl) * off * s, rz = z + (dx / dl) * off * s;
      if (!this.t.inFarm(rx, rz, -20)) continue;
      for (let r = 0; r < 4; r++) {
        const h = this.rng.range(0.6, 1.2), px = rx + this.rng.range(-0.4, 0.4), pz = rz + this.rng.range(-0.4, 0.4);
        this.woods.push(part(CYL, 0x4f8f3a, new THREE.Matrix4().compose(V3(px, this.t.height(px, pz) + h / 2, pz), new THREE.Quaternion(), V3(0.018, h, 0.018))));
        if (r === 0) this.woods.push(part(CYL, 0x6b4226, new THREE.Matrix4().compose(V3(px, this.t.height(px, pz) + h, pz), new THREE.Quaternion(), V3(0.045, 0.16, 0.045))));
      }
    }
  }
  /** x where a water course's centre line crosses z (falls over a terrace). */
  private crossings(wt: Water, z: number) {
    const out: number[] = [], P = wt.pts;
    for (let i = 0; i < P.length - 1; i++) {
      const [ax, az] = P[i], [bx, bz] = P[i + 1];
      if ((az - z) * (bz - z) <= 0 && az !== bz) out.push(ax + (bx - ax) * ((z - az) / (bz - az)));
    }
    return out;
  }

  // ================================================================== terraces
  /**
   * Dry-stone retaining walls along every terrace step (in the farm + a little way past the fence), a gap where a
   * stream falls through, side walls along each ramp. One static box per ~5 m (they follow the ground's waves).
   */
  terraceWalls() {
    const F = this.F;
    for (const st of this.t.steps) {
      const gaps: [number, number][] = [];
      for (const [r0, r1] of st.ramps) gaps.push([r0 - 1, r1 + 1]);
      for (const wt of this.t.waters) for (const x of this.crossings(wt, st.z)) gaps.push([x - wt.w / 2 - 0.3, x + wt.w / 2 + 0.3]);
      gaps.sort((a, b) => a[0] - b[0]);
      let x = F.x0 - 10;
      const runs: [number, number][] = [];
      for (const [g0, g1] of gaps) { if (g0 > x) runs.push([x, g0]); x = Math.max(x, g1); }
      if (x < F.x1 + 10) runs.push([x, F.x1 + 10]);
      for (const [a, b] of runs) this.wall(a, b, st.z - 1, st.z, 'x');
      for (const [r0, r1, len] of st.ramps) { this.wall(st.z - len, st.z, r0 - 1, r0, 'z'); this.wall(st.z - len, st.z, r1, r1 + 1, 'z'); }
    }
  }
  /**
   * A wall from a to b along x (band z0..z1) or along z (band x0..x1 = c0..c1): its top = the upper ground + a lip,
   * its foot under the lower ground; stones in courses, one collider box per chunk.
   */
  private wall(a: number, b: number, c0: number, c1: number, along: 'x' | 'z') {
    const T = this.t, len = b - a;
    if (len < 0.3) return;
    const n = Math.max(1, Math.round(len / 5));
    const at = (u: number, c: number) => (along === 'x' ? T.base(u, c) : T.base(c, u));
    for (let i = 0; i < n; i++) {
      const u0 = a + (len * i) / n, u1 = a + (len * (i + 1)) / n, um = (u0 + u1) / 2;
      // upper / lower ground around this chunk (sampled a little beyond the band on each side)
      let hi = -Infinity, lo = Infinity;
      for (let k = 0; k <= 4; k++) {
        const u = u0 + ((u1 - u0) * k) / 4;
        const s0 = at(u, c0 - 0.6), s1 = at(u, c1 + 0.6);
        hi = Math.max(hi, s0, s1); lo = Math.min(lo, s0, s1);
      }
      const top = hi + 0.06, foot = lo - 0.5, hh = (top - foot) / 2, cm = (c0 + c1) / 2;
      const center = along === 'x' ? V3(um, foot + hh, cm) : V3(cm, foot + hh, um);
      const half = along === 'x' ? V3((u1 - u0) / 2, hh, (c1 - c0) / 2) : V3((c1 - c0) / 2, hh, (u1 - u0) / 2);
      staticBox(center, half);
      // the stones: courses of blocks, staggered, a little bumpy
      let y = foot, row = 0;
      while (y < top - 0.05) {
        const ch = Math.min(this.rng.range(0.44, 0.56), top - y);
        let u = u0 - (row % 2 ? 0.45 : 0);
        while (u < u1) {
          const bl = this.rng.range(0.95, 1.6), s0 = Math.max(u, u0), s1 = Math.min(u + bl, u1);
          if (s1 - s0 > 0.12) {
            const bu = (s0 + s1) / 2, out = this.rng.range(-0.04, 0.06), cw = c1 - c0;
            const m = new THREE.Matrix4().compose(
              along === 'x' ? V3(bu, y + ch / 2, cm + out) : V3(cm + out, y + ch / 2, bu), new THREE.Quaternion(),
              along === 'x' ? V3(s1 - s0 - 0.05, ch - 0.04, cw + 0.08) : V3(cw + 0.08, ch - 0.04, s1 - s0 - 0.05));
            this.stones.push(part(BOX, STONE[this.rng.int(0, STONE.length - 1)], m));
          }
          u += bl;
        }
        y += ch; row++;
      }
      // cap stones (flat, a shade lighter)
      const cap = new THREE.Matrix4().compose(along === 'x' ? V3(um, top - 0.02, cm) : V3(cm, top - 0.02, um), new THREE.Quaternion(),
        along === 'x' ? V3(u1 - u0, 0.1, c1 - c0 + 0.16) : V3(c1 - c0 + 0.16, 0.1, u1 - u0));
      this.stones.push(part(BOX, 0xbdb5a6, cap));
    }
  }

  // ================================================================== crossings
  /**
   * A walkway through points: plank deck on posts (rails optional). The ends sit on the ground; points in between
   * stand over the water (`lift` above the surface, or the ground if that's higher). `arch` bows a single span up.
   */
  walkway(pts: [number, number][], o: { w?: number; arch?: number; rails?: boolean; lift?: number } = {}) {
    const T = this.t, w = o.w ?? 2.4, arch = o.arch ?? 0, lift = o.lift ?? 0.35;
    const ys = pts.map(([x, z], i) => {
      const g = T.height(x, z) + 0.05;
      return i === 0 || i === pts.length - 1 ? g : Math.max(g + 0.15, T.surfaceAt(x, z) + lift);
    });
    const deck: THREE.Matrix4[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz);
      const n = Math.max(2, Math.round(len / 0.34));
      const yAt = (f: number) => ys[i] + (ys[i + 1] - ys[i]) * f + (pts.length === 2 ? Math.sin(Math.PI * f) * arch : 0);
      for (let k = 0; k < n; k++) {
        const f = (k + 0.5) / n, x = ax + dx * f, z = az + dz * f, y = yAt(f);
        const slope = Math.atan2(yAt(Math.min(1, f + 0.5 / n)) - yAt(Math.max(0, f - 0.5 / n)), len / n);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-slope, yaw, 0, 'YXZ'));
        const m = new THREE.Matrix4().compose(V3(x, y - 0.04, z), q, V3(w + this.rng.range(-0.06, 0.06), 0.08, len / n - 0.03));
        deck.push(m);
        this.woods.push(part(BOX, PLANK[this.rng.int(0, PLANK.length - 1)], m));
      }
      // stringers under the planks + posts down to the bed
      for (const s of [-1, 1]) {
        const ox = Math.cos(yaw) * s * (w / 2 - 0.12), oz = -Math.sin(yaw) * s * (w / 2 - 0.12);
        for (let k = 0; k <= Math.max(1, Math.round(len / 1.6)); k++) {
          const f = k / Math.max(1, Math.round(len / 1.6)), x = ax + dx * f + ox, z = az + dz * f + oz, y = yAt(f);
          const g = T.height(x, z);
          if (y - g > 0.25) this.woods.push(part(CYL, DARK, new THREE.Matrix4().compose(V3(x, (y + g) / 2 - 0.1, z), new THREE.Quaternion(), V3(0.09, y - g + 0.2, 0.09))));
          if (o.rails) {
            this.woods.push(part(CYL, DARK, new THREE.Matrix4().compose(V3(x, y + 0.45, z), new THREE.Quaternion(), V3(0.06, 0.9, 0.06))));
          }
        }
        if (o.rails) {
          const steps = 8;
          for (let k = 0; k < steps; k++) {
            const f0 = k / steps, f1 = (k + 1) / steps, y0 = yAt(f0) + 0.88, y1 = yAt(f1) + 0.88;
            const x0 = ax + dx * f0 + ox, z0 = az + dz * f0 + oz, x1 = ax + dx * f1 + ox, z1 = az + dz * f1 + oz;
            const sl = Math.hypot(x1 - x0, z1 - z0), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.atan2(y1 - y0, sl), yaw, 0, 'YXZ'));
            this.woods.push(part(BOX, 0x8a5a35, new THREE.Matrix4().compose(V3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), q, V3(0.08, 0.08, sl + 0.04))));
          }
          // a rail collider along the side (keeps Bob and a careless pig on the bridge)
          const ym = (ys[i] + ys[i + 1]) / 2 + (pts.length === 2 ? arch * 0.7 : 0);
          staticBox(V3((ax + bx) / 2 + ox, ym + 0.5, (az + bz) / 2 + oz), V3(0.05, 0.42, len / 2 * 0.86), yaw);
        }
      }
    }
    // the deck you walk on: one trimesh of the planks, ignored by Bob's nav grid (he walks across)
    const verts: number[] = [], idx: number[] = [];
    const pos = BOX.attributes.position, ix = BOX.index!;
    for (const m of deck) {
      const base = verts.length / 3;
      for (let i = 0; i < pos.count; i++) { v1.fromBufferAttribute(pos, i).applyMatrix4(m); verts.push(v1.x, v1.y, v1.z); }
      for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
    }
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const col = world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(idx)).setFriction(0.7)
      .setCollisionGroups(groups(L.STATIC)), body);
    WALKABLE.add(col.handle);
  }
  /** Flat stepping stones from a to b (hop across a stream). */
  steppingStones(a: [number, number], b: [number, number], n = 5) {
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n, x = a[0] + (b[0] - a[0]) * f + this.rng.range(-0.25, 0.25), z = a[1] + (b[1] - a[1]) * f + this.rng.range(-0.25, 0.25);
      const r = this.rng.range(0.5, 0.65), top = Math.max(this.t.surfaceAt(x, z) + 0.14, this.t.height(x, z) + 0.1), bed = this.t.height(x, z) - 0.2;
      const hh = (top - bed) / 2;
      this.stones.push(part(ROCK, STONE[i % STONE.length], new THREE.Matrix4().compose(V3(x, bed + hh, z), new THREE.Quaternion(), V3(r, top - bed, r * this.rng.range(0.8, 1)))));
      const body = staticCylinder(V3(x, bed + hh, z), hh, r * 0.92);
      WALKABLE.add(body.collider(0).handle);
    }
  }

  /** Everything built: one mesh for all the stone, one for all the wood. */
  finish() {
    for (const [list, name] of [[this.stones, 'stone'], [this.woods, 'wood']] as const) {
      if (!list.length) continue;
      const m = new THREE.Mesh(mergeGeometries(list as THREE.BufferGeometry[])!, toonMat(0xffffff, { vertexColors: true }));
      m.castShadow = m.receiveShadow = true; m.name = name;
      this.group.add(m);
      list.length = 0;
    }
  }

  // ================================================================== every frame
  /** Streaks drift downstream, splashes where pigs / Bob wade, foam + roar at the falls, running water nearby. */
  update(dt: number) {
    this.tex.offset.y -= dt * 0.22;
    const T = this.t;
    if (!T.waters.length) return;
    this.k += dt;
    if (this.k < 0.12) return;
    this.k = 0;
    const cam = G.cam?.position;
    // wading splashes
    const movers: { pos: THREE.Vector3; vel: THREE.Vector3; out?: boolean }[] = [...G.pigs, ...(G.farmer ? [G.farmer] : [])];
    for (const p of movers) {
      if (p.out || Math.hypot(p.vel.x, p.vel.z) < 1.2) continue;
      if (T.waterAt(p.pos.x, p.pos.z) < 0.12) continue;
      const sy = T.surfaceAt(p.pos.x, p.pos.z);
      G.fx.bits(v1.set(p.pos.x, sy + 0.08, p.pos.z), { count: 3, color: 0xbfe8ff, spread: 0.35, speed: 1.6, up: 2.2, grav: 9, life: 0.5, size: 0.08, grow: 0, alpha: 0.9 });
      if (Math.random() < 0.25) G.audio.play('mudstep', { pos: p.pos, vol: 0.5, minGap: 0.2 });
    }
    if (!cam) return;
    // foam at the falls the camera is near
    for (const f of this.falls) {
      if (Math.hypot(cam.x - f.x, cam.z - f.z) > 45) continue;
      G.fx.bits(v1.set(f.x + (Math.random() - 0.5) * 1.4, f.y + 0.05, f.z + Math.random() * 0.6), { count: 2, color: 0xffffff, spread: 0.25, speed: 1.1, up: 1.6, grav: 7, life: 0.45, size: 0.1, grow: 0.4, alpha: 0.8 });
    }
    if (!G.audio?.has?.('river')) return;
    // running water: one loop at the nearest point of any water course; the nearest fall roars
    let best = Infinity; const at = new THREE.Vector3();
    for (const wt of T.waters) for (const [x, z] of wt.pts) {
      const d = Math.hypot(cam.x - x, cam.z - z);
      if (d < best) { best = d; at.set(x, T.surfaceAt(x, z), z); }
    }
    this.loops.river ??= G.audio.loop('river', { pos: at, vol: 0, ref: 5, bus: 'amb' });
    this.loops.river?.setPos(at); this.loops.river?.setVolume(clamp(1 - best / 38, 0, 1) * 0.8, 0.4);
    if (this.falls.length) {
      let fb = Infinity, fi = 0;
      this.falls.forEach((f, i) => { const d = Math.hypot(cam.x - f.x, cam.z - f.z); if (d < fb) { fb = d; fi = i; } });
      const f = this.falls[fi];
      this.loops.falls[0] ??= G.audio.loop('waterfall', { pos: V3(f.x, f.y, f.z), vol: 0, ref: 4, bus: 'amb' });
      this.loops.falls[0]?.setPos(v1.set(f.x, f.y, f.z)); this.loops.falls[0]?.setVolume(clamp(1 - fb / 30, 0, 1) * 0.7, 0.4);
    }
  }
}
