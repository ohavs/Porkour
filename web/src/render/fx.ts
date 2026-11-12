import * as THREE from 'three';
import { softDot } from './textures';

interface P { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number;
  size: number; grow: number; r: number; g: number; b: number; a: number; drag: number; grav: number }

const VERT = `
attribute float aSize; attribute vec4 aColor; varying vec4 vColor;
uniform float uScale;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform sampler2D uMap; varying vec4 vColor;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
  if (gl_FragColor.a < 0.01) discard;
  #include <colorspace_fragment>
}`;

/** Pooled point-sprite particles (one draw call per texture) + camera shake. */
class Pool {
  ps: P[] = [];
  geo = new THREE.BufferGeometry();
  points: THREE.Points;
  private pos: Float32Array; private size: Float32Array; private color: Float32Array;
  constructor(scene: THREE.Scene, tex: THREE.Texture, private max: number, blending: THREE.Blending) {
    this.pos = new Float32Array(max * 3); this.size = new Float32Array(max); this.color = new Float32Array(max * 4);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 4).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending,
      uniforms: { uMap: { value: tex }, uScale: { value: innerHeight * 0.9 } },
    });
    addEventListener('resize', () => (mat.uniforms.uScale.value = innerHeight * 0.9));
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  add(p: P) { if (this.ps.length < this.max) this.ps.push(p); }
  update(dt: number) {
    let n = 0;
    for (let i = this.ps.length - 1; i >= 0; i--) {
      const p = this.ps[i];
      p.life += dt;
      if (p.life >= p.max) { this.ps[i] = this.ps[this.ps.length - 1]; this.ps.pop(); continue; }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy = p.vy * d - p.grav * dt; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.size += p.grow * dt;
    }
    for (const p of this.ps) {
      const t = p.life / p.max;
      this.pos[n * 3] = p.x; this.pos[n * 3 + 1] = p.y; this.pos[n * 3 + 2] = p.z;
      this.size[n] = p.size;
      const fade = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      this.color[n * 4] = p.r; this.color[n * 4 + 1] = p.g; this.color[n * 4 + 2] = p.b; this.color[n * 4 + 3] = p.a * fade;
      n++;
    }
    this.geo.setDrawRange(0, n);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
  }
}

export interface Burst {
  count: number; color: number | THREE.Color; spread?: number; speed?: number; up?: number; life?: number;
  size?: number; grow?: number; drag?: number; grav?: number; alpha?: number; dir?: THREE.Vector3; jitter?: number;
}

export class Fx {
  private smoke: Pool; private dots: Pool;
  shakeAmt = 0;
  private c = new THREE.Color();
  constructor(scene: THREE.Scene) {
    const loader = new THREE.TextureLoader();
    const smokeTex = loader.load('./assets/fx/smoke_04.png');
    this.smoke = new Pool(scene, smokeTex, 1500, THREE.NormalBlending);
    this.dots = new Pool(scene, softDot(), 1500, THREE.NormalBlending);
  }
  private emit(pool: Pool, at: THREE.Vector3, b: Burst) {
    this.c.set(b.color as THREE.ColorRepresentation);
    for (let i = 0; i < b.count; i++) {
      const sp = b.spread ?? 0.3, v = b.speed ?? 2;
      const dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
      const dir = b.dir;
      const j = b.jitter ?? 0.12;
      pool.add({
        x: at.x + dx * sp, y: at.y + dy * sp * 0.5, z: at.z + dz * sp,
        vx: (dir ? dir.x * v : 0) + dx * v * (dir ? 0.35 : 1), vy: (dir ? dir.y * v : 0) + (b.up ?? 1) + dy * v * 0.3,
        vz: (dir ? dir.z * v : 0) + dz * v * (dir ? 0.35 : 1),
        life: 0, max: (b.life ?? 1) * (0.7 + Math.random() * 0.6), size: (b.size ?? 0.6) * (0.7 + Math.random() * 0.6),
        grow: b.grow ?? 0.8, r: this.c.r * (1 - j + Math.random() * j * 2), g: this.c.g * (1 - j + Math.random() * j * 2),
        b: this.c.b * (1 - j + Math.random() * j * 2), a: b.alpha ?? 0.9, drag: b.drag ?? 2, grav: b.grav ?? 0,
      });
    }
  }
  puff(at: THREE.Vector3, b: Burst) { this.emit(this.smoke, at, b); }
  bits(at: THREE.Vector3, b: Burst) { this.emit(this.dots, at, b); }
  shake(amount: number) { this.shakeAmt = Math.min(1.2, this.shakeAmt + amount); }
  update(dt: number) {
    this.smoke.update(dt); this.dots.update(dt);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
  }
}
