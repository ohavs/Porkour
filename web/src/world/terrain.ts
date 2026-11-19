import * as THREE from 'three';
import { RAPIER, world, groups, L } from '../core/physics';
import { fbm, smoothstep, clamp } from '../core/util';
import { grassTexture, dirtTexture, mudTexture, snowTexture } from '../render/textures';
import { RAMP } from '../render/toon';

export const WORLD = 380;          // ground plane size (m)
const HALF = WORLD / 2;
const SPLAT = 1024;                // splat map resolution over the whole ground

export interface Rect { x0: number; x1: number; z0: number; z1: number }
/**
 * A water course (river / stream / marsh channel / round pool): a channel carved along a dense polyline. The water
 * surface lies `LEVEL` under the banks, the bed `depth` under them.
 */
export interface Water { pts: [number, number][]; w: number; depth: number; bb: Rect }
/** A terrace step (farm 2's hillside): the ground north of z (−z side) is `rise` higher; the 1 m wall band is between
 * z − 1 and z; `ramps` = [x0, x1, len]: there the step is spread over len metres (cut into the upper level). */
export interface Step { z: number; rise: number; ramps: [number, number, number][] }
/** Water surface: this far under the bank. */
export const LEVEL = 0.25;

/**
 * Ground: height field (gentle inside the farm, hills outside), splat map (grass / dirt / mud) painted on a canvas,
 * one trimesh collider. Queries: height(), mudAt(), isBare() for grass placement.
 */
export class Terrain {
  farm: Rect;
  mesh!: THREE.Mesh;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private data!: Uint8ClampedArray;
  private noGrassRects: Rect[] = [];
  mudZones: { x: number; z: number; rx: number; rz: number }[] = [];
  collider!: RAPIER.Collider;
  /** Farm 5: snow instead of grass (paths = shovelled gravel, the farmland outside = snowy fields). Set before build(). */
  snow = false;
  /** The land outside the fence: base height + noise amplitude of its hills (farm 5: mountains, farm 4: flat swamp). */
  outside = { base: 3, amp: 12, freq: 0.016 };
  /** 1 m ground grid instead of 2 m (terrace walls need it; set before build()). */
  fine = false;
  waters: Water[] = [];
  /** Water colour (farm 4's bog: murky green). */
  waterTint = 0x4fb2e3;
  steps: Step[] = [];

  constructor(farm: Rect) {
    this.farm = farm;
    this.canvas.width = this.canvas.height = SPLAT;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, SPLAT, SPLAT);
  }
  private px(v: number) { return ((v + HALF) / WORLD) * SPLAT; }

  /** Dirt path through points (x,z pairs). */
  path(pts: [number, number][], width = 3) {
    const c = this.ctx;
    c.save(); c.filter = 'blur(3px)';
    c.strokeStyle = 'rgb(255,0,0)'; c.lineCap = 'round'; c.lineJoin = 'round';
    c.lineWidth = (width / WORLD) * SPLAT;
    c.globalCompositeOperation = 'lighter';
    c.beginPath(); pts.forEach(([x, z], i) => (i ? c.lineTo(this.px(x), this.px(z)) : c.moveTo(this.px(x), this.px(z))));
    c.stroke(); c.restore();
  }
  /** Bare dirt area (yards, under buildings). */
  dirt(r: Rect, soft = 2) {
    const c = this.ctx; c.save(); c.filter = `blur(${(soft / WORLD) * SPLAT}px)`;
    c.globalCompositeOperation = 'lighter'; c.fillStyle = 'rgb(255,0,0)';
    c.fillRect(this.px(r.x0), this.px(r.z0), this.px(r.x1) - this.px(r.x0), this.px(r.z1) - this.px(r.z0));
    c.restore();
  }
  /** Mud puddle (wallow here to get muddy). */
  mud(x: number, z: number, rx: number, rz = rx) {
    this.mudZones.push({ x, z, rx, rz });
    const c = this.ctx; c.save(); c.filter = 'blur(4px)'; c.globalCompositeOperation = 'lighter';
    c.fillStyle = 'rgb(160,0,0)';
    c.beginPath(); c.ellipse(this.px(x), this.px(z), (rx * 1.35 / WORLD) * SPLAT, (rz * 1.35 / WORLD) * SPLAT, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgb(0,255,0)';
    c.beginPath(); c.ellipse(this.px(x), this.px(z), (rx / WORLD) * SPLAT, (rz / WORLD) * SPLAT, 0, 0, Math.PI * 2); c.fill();
    c.restore();
  }
  noGrass(r: Rect) { this.noGrassRects.push(r); }
  /** A round hill inside the farm (radius r, height h, a flat top of radius `flat`) — before build(). */
  hill(x: number, z: number, r: number, h: number, flat = 0) { this.hills.push({ x, z, r, h, flat }); }
  private hills: { x: number; z: number; r: number; h: number; flat: number }[] = [];
  /** A dead-flat round spot (a frozen pond's ice lies on it): the ground there is the noise height at its centre. */
  flatten(x: number, z: number, r: number, edge = 3) { this.flats.push({ x, z, r, edge, h: this.noiseH(x, z) }); }
  private flats: { x: number; z: number; r: number; edge: number; h: number }[] = [];
  /**
   * A dead-flat rectangle (a house stands on it: s26 farmhouse), turned by `yaw`, at the ground height its centre had,
   * blending back over `edge` m. Before build(), after the hills / terraces it sits on.
   */
  pad(x: number, z: number, yaw: number, w: number, d: number, edge = 3) {
    this.pads.push({ x, z, c: Math.cos(yaw), s: Math.sin(yaw), hw: w / 2, hd: d / 2, edge, h: this.base(x, z) });
  }
  private pads: { x: number; z: number; c: number; s: number; hw: number; hd: number; edge: number; h: number }[] = [];
  private noiseH(x: number, z: number) { return (fbm(x * 0.035 + 3, z * 0.035 - 7, 3) - 0.5) * 0.7; }
  /**
   * A river / stream through the points (smoothed, w = water width, depth = bank → bed). Before build().
   * One point = a round pool of diameter w.
   */
  river(pts: [number, number][], w = 5, depth = 0.75) {
    let dense: [number, number][] = pts;
    if (pts.length > 2) {
      const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
      const n = Math.max(8, Math.ceil(curve.getLength() / 1.5));
      dense = curve.getSpacedPoints(n).map((v) => [v.x, v.z] as [number, number]);
    }
    const m = w / 2 + 3;
    const xs = dense.map((p) => p[0]), zs = dense.map((p) => p[1]);
    this.wg = null;   // (the lookup grid is rebuilt on the next query)
    this.waters.push({ pts: dense, w, depth, bb: { x0: Math.min(...xs) - m, x1: Math.max(...xs) + m, z0: Math.min(...zs) - m, z1: Math.max(...zs) + m } });
    return this.waters[this.waters.length - 1];
  }
  /** A terrace step across the whole map at z (see Step). Before build(); needs `fine`. */
  terrace(z: number, rise: number, ramps: [number, number, number][] = []) { this.steps.push({ z, rise, ramps }); this.fine = true; }
  /** Nearest point of a water's centre line: distance + the point. */
  private near(wt: Water, x: number, z: number, out: { d: number; x: number; z: number }) {
    out.d = Infinity;
    const P = wt.pts;
    if (P.length === 1) { out.d = Math.hypot(x - P[0][0], z - P[0][1]); out.x = P[0][0]; out.z = P[0][1]; return out; }
    for (let i = 0; i < P.length - 1; i++) {
      const ax = P[i][0], az = P[i][1], bx = P[i + 1][0], bz = P[i + 1][1];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
      const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
      if (d < out.d) { out.d = d; out.x = px; out.z = pz; }
    }
    return out;
  }
  /**
   * Water lookup grid (0.5 m, over all the water courses): how deep the channel cuts, the water surface, the distance
   * to the water's edge — so height() / waterAt() cost the same near a river as anywhere else (they're called
   * thousands of times a frame: feet, props, critters, Bob, the nav grid).
   */
  private wg: { x0: number; z0: number; w: number; h: number; carve: Float32Array; surf: Float32Array; edge: Float32Array } | null = null;
  private wgrid() {
    if (this.wg) return this.wg;
    const C = 0.5, M = 7;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const wt of this.waters) { x0 = Math.min(x0, wt.bb.x0 - M); x1 = Math.max(x1, wt.bb.x1 + M); z0 = Math.min(z0, wt.bb.z0 - M); z1 = Math.max(z1, wt.bb.z1 + M); }
    const w = Math.ceil((x1 - x0) / C) + 1, h = Math.ceil((z1 - z0) / C) + 1;
    const carve = new Float32Array(w * h), surf = new Float32Array(w * h), edge = new Float32Array(w * h).fill(99);
    const n = { d: 0, x: 0, z: 0 };
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const x = x0 + i * C, z = z0 + j * C, k = j * w + i;
      for (const wt of this.waters) {
        if (x < wt.bb.x0 - M || x > wt.bb.x1 + M || z < wt.bb.z0 - M || z > wt.bb.z1 + M) continue;
        this.near(wt, x, z, n);
        edge[k] = Math.min(edge[k], n.d - wt.w / 2);
        const c = n.d < wt.w / 2 + 1.6 ? this.carve(wt, n.d) : 0;
        if (c > carve[k]) { carve[k] = c; surf[k] = this.base(n.x, n.z) - LEVEL; }
      }
    }
    this.wg = { x0, z0, w, h, carve, surf, edge };
    return this.wg;
  }
  /** Bilinear sample of a water grid layer (outside the grid: `out`). */
  private wsample(a: Float32Array, x: number, z: number, out: number) {
    const g = this.wgrid()!, fx = (x - g.x0) / 0.5, fz = (z - g.z0) / 0.5;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= g.w - 1 || j >= g.h - 1) return out;
    const tx = fx - i, tz = fz - j, k = j * g.w + i;
    return (a[k] * (1 - tx) + a[k + 1] * tx) * (1 - tz) + (a[k + g.w] * (1 - tx) + a[k + g.w + 1] * tx) * tz;
  }
  /** How much a water course lowers the ground here (0 away from it). */
  private carve(wt: Water, d: number) {
    const half = wt.w / 2;
    return wt.depth * (1 - smoothstep(half * 0.55, half + 1.6, d));
  }
  /** Water depth here (0 = dry). */
  waterAt(x: number, z: number) {
    if (!this.waters.length) return 0;
    const g = this.wgrid()!;
    if (this.wsample(g.carve, x, z, 0) < LEVEL) return 0;
    return Math.max(0, this.wsample(g.surf, x, z, 0) - this.height(x, z));
  }
  /** The water surface height at a point of a water course's centre line. */
  surfaceAt(x: number, z: number) { return this.base(x, z) - LEVEL; }

  private sample(x: number, z: number, ch: number) {
    const i = clamp(Math.floor(this.px(x)), 0, SPLAT - 1), j = clamp(Math.floor(this.px(z)), 0, SPLAT - 1);
    return this.data[(j * SPLAT + i) * 4 + ch] / 255;
  }
  mudAt(x: number, z: number) { return this.sample(x, z, 1); }
  dirtAt(x: number, z: number) { return this.sample(x, z, 0); }
  /** Within `pad` m of a water course's water (no grass, no scattered decor there). */
  nearWater(x: number, z: number, pad = 0.4) {
    if (!this.waters.length) return false;
    return this.wsample(this.wgrid()!.edge, x, z, 99) < pad;
  }
  isBare(x: number, z: number) {
    if (this.dirtAt(x, z) > 0.25 || this.mudAt(x, z) > 0.05) return true;
    if (this.waters.length && this.nearWater(x, z)) return true;
    return this.noGrassRects.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
  }
  inFarm(x: number, z: number, m = 0) {
    const f = this.farm; return x > f.x0 + m && x < f.x1 - m && z > f.z0 + m && z < f.z1 - m;
  }

  height(x: number, z: number): number {
    let h = this.base(x, z);
    if (this.waters.length) h -= this.wsample(this.wgrid()!.carve, x, z, 0);
    if (this.data) h -= this.mudAt(x, z) * 0.18;
    return h;
  }
  /** The ground without water channels / mud dips (terraces, hills, flats, the land outside). */
  base(x: number, z: number): number {
    const f = this.farm;
    const dx = Math.max(f.x0 - x, 0, x - f.x1), dz = Math.max(f.z0 - z, 0, z - f.z1);
    const out = Math.hypot(dx, dz);
    let h = this.noiseH(x, z);
    for (const fl of this.flats) {
      const d = Math.hypot(x - fl.x, z - fl.z);
      if (d < fl.r + fl.edge) h += (fl.h - h) * (1 - smoothstep(fl.r, fl.r + fl.edge, d));
    }
    const O = this.outside;
    h += smoothstep(8, 90, out) * (O.base + O.amp * fbm(x * O.freq, z * O.freq, 4));
    for (const hl of this.hills) {
      const d = Math.hypot(x - hl.x, z - hl.z);
      if (d < hl.r) h += d <= hl.flat ? hl.h : hl.h * 0.5 * (1 + Math.cos((Math.PI * (d - hl.flat)) / (hl.r - hl.flat)));
    }
    for (const st of this.steps) h += st.rise * this.stepK(st, x, z);
    for (const pd of this.pads) {
      const dx = x - pd.x, dz = z - pd.z, lx = Math.abs(dx * pd.c - dz * pd.s) - pd.hw, lz = Math.abs(dx * pd.s + dz * pd.c) - pd.hd;
      const d = Math.hypot(Math.max(lx, 0), Math.max(lz, 0));
      if (d < pd.edge) h += (pd.h - h) * (1 - smoothstep(0, pd.edge, d));
    }
    return h;
  }
  /** 0 (below) … 1 (above) a terrace step: a 1 m wall band, or a ramp cut into the upper level. */
  stepK(st: Step, x: number, z: number) {
    const dz = st.z - z;
    if (dz <= 0) return 0;
    const f = this.farm, ox = Math.max(f.x0 - x, 0, x - f.x1);
    const band = 1 + 14 * smoothstep(10, 45, ox);   // a 1 m wall in the farm, a gentle bank far outside
    const wall = Math.min(1, dz / band);
    let k = wall;
    for (const [r0, r1, len] of st.ramps) {
      const f = clamp(Math.min(x - (r0 - 1), r1 + 1 - x), 0, 1);
      if (f > 0) k = wall + (Math.min(1, dz / len) - wall) * f;
    }
    return k;
  }

  build(scene: THREE.Scene) {
    this.data = this.ctx.getImageData(0, 0, SPLAT, SPLAT).data;
    const splatTex = new THREE.CanvasTexture(this.canvas);
    splatTex.colorSpace = THREE.NoColorSpace;
    splatTex.flipY = false;

    // grid lines: fine where you play (1 m with terrace walls, else 2 m; on whole / even metres), 2 m just outside the
    // fence, 4 m out on the hills — about half the triangles of a uniform 2 m grid (a third of a 1 m one)
    const F = this.farm, step = this.fine ? 1 : 2;
    const axis = (a0: number, a1: number) => {
      const out: number[] = [];
      for (let v = -HALF; v <= HALF + 1e-6;) {
        out.push(v);
        const d = Math.max(a0 - v, v - a1, 0);
        v += d < 14 ? step : d < 44 ? 2 : 4;
        if (v > HALF) { if (out[out.length - 1] < HALF) out.push(HALF); break; }
      }
      return out;
    };
    const xs = axis(F.x0, F.x1), zs = axis(F.z0, F.z1), nx = xs.length, nz = zs.length;
    const P = new Float32Array(nx * nz * 3);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = (j * nx + i) * 3; P[k] = xs[i]; P[k + 1] = this.height(xs[i], zs[j]); P[k + 2] = zs[j];
    }
    const I = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let n = 0;
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      I[n++] = a; I[n++] = c; I[n++] = b; I[n++] = b; I[n++] = c; I[n++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setIndex(new THREE.BufferAttribute(I, 1));
    geo.computeVertexNormals();
    const pos = geo.attributes.position as THREE.BufferAttribute;

    const mat = new THREE.MeshToonMaterial({ map: this.snow ? snowTexture() : grassTexture(), gradientMap: RAMP });
    const SNOW = this.snow ? 1 : 0;
    const dirt = dirtTexture(), mudT = mudTexture();
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.dirtMap = { value: dirt }; sh.uniforms.mudMap = { value: mudT }; sh.uniforms.splatMap = { value: splatTex };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = (modelMatrix * vec4(transformed,1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec2 vW; uniform sampler2D dirtMap; uniform sampler2D mudMap; uniform sampler2D splatMap;`)
        .replace('#include <map_fragment>', `
          vec2 uvW = vW * 0.19;
          vec4 g = texture2D(map, uvW);
          vec4 g2 = texture2D(map, uvW * 0.21 + 0.37);
          g.rgb = mix(g.rgb, g2.rgb * ${SNOW ? 'vec3(0.97, 0.98, 1.0)' : 'vec3(1.05, 0.95, 0.8)'}, 0.4);
          vec4 dt = texture2D(dirtMap, uvW * 0.75);
          vec4 md = texture2D(mudMap, uvW * 1.2);
          vec3 sp = texture2D(splatMap, (vW + ${HALF.toFixed(1)}) / ${WORLD.toFixed(1)}).rgb;
          float dirtW = smoothstep(0.22, 0.7, sp.r + (g.g - ${SNOW ? '0.88' : '0.45'}) * 0.5)${SNOW ? ' * 0.9' : ''};
          ${SNOW ? 'dt.rgb = mix(dt.rgb * vec3(0.78, 0.76, 0.78), vec3(0.86, 0.9, 0.98), 0.25 + 0.3 * smoothstep(0.4, 0.8, g.r));' : ''}
          float mudW = smoothstep(0.25, 0.65, sp.g + (dt.r - 0.5) * 0.4);
          vec4 col = mix(g, dt, dirtW);
          col = mix(col, md * vec4(0.8, 0.78, 0.75, 1.0), mudW);
          diffuseColor *= col;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          // patchwork farmland outside the fence
          float dOut = max(max(${F.x0.toFixed(1)} - vW.x, vW.x - ${F.x1.toFixed(1)}), max(${F.z0.toFixed(1)} - vW.y, vW.y - ${F.z1.toFixed(1)}));
          float outW = smoothstep(3.0, 9.0, dOut);
          vec2 cs = vec2(34.0, 26.0);
          vec2 cell = floor((vW + vec2(11.0, 5.0)) / cs);
          vec2 inC = fract((vW + vec2(11.0, 5.0)) / cs) * cs;
          float hsh = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
          float stripe = 0.5 + 0.5 * sin((hsh > 0.5 ? vW.x : vW.y) * 2.2);
          vec3 fieldC = hsh < 0.22 ? mix(vec3(0.93, 0.78, 0.36), vec3(0.86, 0.68, 0.3), stripe)
                      : hsh < 0.4 ? mix(vec3(0.58, 0.38, 0.22), vec3(0.48, 0.3, 0.17), stripe)
                      : hsh < 0.7 ? vec3(0.48, 0.74, 0.3) : mix(vec3(0.4, 0.66, 0.26), vec3(0.36, 0.6, 0.24), stripe);
          float hedge = 1.0 - smoothstep(0.6, 1.3, min(min(inC.x, cs.x - inC.x), min(inC.y, cs.y - inC.y)));
          fieldC = mix(fieldC, vec3(0.2, 0.45, 0.16), hedge);
          ${SNOW ? 'fieldC = mix(vec3(0.9, 0.93, 1.0), vec3(0.8, 0.85, 0.94), stripe * step(0.4, hsh) * 0.6) - hedge * vec3(0.32, 0.26, 0.2);' : ''}
          diffuseColor.rgb = mix(diffuseColor.rgb, fieldC * (0.92 + g.g * 0.2), outW);`);
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'ground';
    scene.add(this.mesh);

    const verts = new Float32Array(pos.array as ArrayLike<number>);
    const idx = new Uint32Array(geo.index!.array as ArrayLike<number>);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.collider = world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx).setFriction(0.8).setCollisionGroups(groups(L.STATIC)), body);
  }
}
