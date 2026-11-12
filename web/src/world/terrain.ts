import * as THREE from 'three';
import { RAPIER, world, groups, L } from '../core/physics';
import { fbm, smoothstep, clamp } from '../core/util';
import { grassTexture, dirtTexture, mudTexture } from '../render/textures';
import { RAMP } from '../render/toon';

export const WORLD = 380;          // ground plane size (m)
const HALF = WORLD / 2;
const SPLAT = 1024;                // splat map resolution over the whole ground

export interface Rect { x0: number; x1: number; z0: number; z1: number }

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

  private sample(x: number, z: number, ch: number) {
    const i = clamp(Math.floor(this.px(x)), 0, SPLAT - 1), j = clamp(Math.floor(this.px(z)), 0, SPLAT - 1);
    return this.data[(j * SPLAT + i) * 4 + ch] / 255;
  }
  mudAt(x: number, z: number) { return this.sample(x, z, 1); }
  dirtAt(x: number, z: number) { return this.sample(x, z, 0); }
  isBare(x: number, z: number) {
    if (this.dirtAt(x, z) > 0.25 || this.mudAt(x, z) > 0.05) return true;
    return this.noGrassRects.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
  }
  inFarm(x: number, z: number, m = 0) {
    const f = this.farm; return x > f.x0 + m && x < f.x1 - m && z > f.z0 + m && z < f.z1 - m;
  }

  height(x: number, z: number): number {
    const f = this.farm;
    const dx = Math.max(f.x0 - x, 0, x - f.x1), dz = Math.max(f.z0 - z, 0, z - f.z1);
    const out = Math.hypot(dx, dz);
    let h = (fbm(x * 0.035 + 3, z * 0.035 - 7, 3) - 0.5) * 0.7;
    h += smoothstep(8, 90, out) * (3 + 12 * fbm(x * 0.016, z * 0.016, 4));
    if (this.data) h -= this.mudAt(x, z) * 0.18;
    return h;
  }

  build(scene: THREE.Scene) {
    this.data = this.ctx.getImageData(0, 0, SPLAT, SPLAT).data;
    const splatTex = new THREE.CanvasTexture(this.canvas);
    splatTex.colorSpace = THREE.NoColorSpace;
    splatTex.flipY = false;

    const seg = 190;
    const geo = new THREE.PlaneGeometry(WORLD, WORLD, seg, seg).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.height(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();

    const mat = new THREE.MeshToonMaterial({ map: grassTexture(), gradientMap: RAMP });
    const F = this.farm;
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
          g.rgb = mix(g.rgb, g2.rgb * vec3(1.05, 0.95, 0.8), 0.4);
          vec4 dt = texture2D(dirtMap, uvW * 0.75);
          vec4 md = texture2D(mudMap, uvW * 1.2);
          vec3 sp = texture2D(splatMap, (vW + ${HALF.toFixed(1)}) / ${WORLD.toFixed(1)}).rgb;
          float dirtW = smoothstep(0.22, 0.7, sp.r + (g.g - 0.45) * 0.5);
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
