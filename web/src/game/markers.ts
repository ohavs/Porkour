import * as THREE from 'three';
import { G } from './ctx';
import type { Game } from './game';

const MAX = 160;
const VERT = `attribute vec4 aColor; attribute float aSize; uniform float uPx; varying vec4 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * clamp(16.0 / max(-mv.z, 0.1), 0.8, 1.3) * uPx;
  vColor = aColor;
}`;
// a fat cartoon arrow pointing down, with a dark outline (drawn in the point sprite, no texture)
const FRAG = `varying vec4 vColor;
float tri(vec2 q, float g) { return (q.y > -0.34 - g && q.y < 0.40 + g && abs(q.x) < (0.40 + g * 1.6 - q.y) * 0.62) ? 1.0 : 0.0; }
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float inner = tri(q, 0.0), outer = tri(q, 0.07);
  if (outer < 0.5 || vColor.a < 0.01) discard;
  vec3 c = inner > 0.5 ? vColor.rgb * (1.05 - q.y * 0.5) : vec3(0.23, 0.14, 0.07);
  gl_FragColor = vec4(c, vColor.a);
}`;

const GOLD = new THREE.Color(0xffd166), tmpC = new THREE.Color();
const v1 = new THREE.Vector3();

/**
 * Bobbing arrows over the things worth taking (gold: loot — bigger for valuables; pink: what an open prank is about),
 * seen through walls and fading with distance. One point cloud = one draw call.
 */
export class Markers {
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 4);
  private size = new Float32Array(MAX);
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;
  points: THREE.Points;

  constructor(scene: THREE.Scene, private game: Game) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false, uniforms: { uPx: { value: 1 } } });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = 999;
    scene.add(this.points);
  }

  update(cam: THREE.Camera, px: number) {
    const g = this.game, L = g.local, r = g.round;
    this.mat.uniforms.uPx.value = px;
    let n = 0;
    const t = G.time;
    const put = (p: THREE.Vector3, top: number, c: THREE.Color, size: number, range: number, seed: number) => {
      if (n >= MAX) return;
      const d = p.distanceTo(cam.position);
      const a = Math.min(1, Math.max(0, (range - d) / 8)) * Math.min(1, Math.max(0, (d - 1.6) / 1.5));
      if (a <= 0.01) return;
      this.pos[n * 3] = p.x; this.pos[n * 3 + 1] = p.y + top + 0.55 + Math.sin(t * 3.2 + seed) * 0.1; this.pos[n * 3 + 2] = p.z;
      this.col[n * 4] = c.r; this.col[n * 4 + 1] = c.g; this.col[n * 4 + 2] = c.b; this.col[n * 4 + 3] = a * 0.95;
      this.size[n] = size;
      n++;
    };
    const show = r.phase !== 'end' && g.running && !L.out;
    if (show) {
      // one arrow per open prank, in the colour of its line in the mission list (Bob's pranks side by side over him)
      const mission = new Set<unknown>();
      for (const mk of r.missionMarks()) {
        const off = (mk as { off?: number }).off ?? 0;
        tmpC.set(mk.color);
        if (off) { v1.copy(mk.at); v1.x += (off % 2 ? 1 : -1) * Math.ceil(off / 2) * 0.45; put(v1, mk.top, tmpC, 34, 90, mk.i); }
        else put(mk.at, mk.top, tmpC, 36, 90, mk.i);
      }
      const held = new Set(g.pigs.map((p) => p.held));
      for (const pr of g.farm.props) {
        // (furniture is loot too, but a house full of arrows was noise: only the real valuables get one)
        if (pr.banked || pr.heldBy || pr.value < 25 || mission.has(pr) || held.has(pr) || pr.def.id?.startsWith('f_')) continue;
        const big = pr.value >= 60;
        put(pr.obj.position, pr.half, GOLD, big ? 34 : 25, big ? 48 : 28, pr.obj.position.x);
      }
    }
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'aColor', 'aSize']) (this.geo.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
    void v1;
  }
}
