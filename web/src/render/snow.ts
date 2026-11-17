import * as THREE from 'three';
import { softDot } from './textures';

/**
 * Falling snow in a box that travels with the camera (one Points draw call, like the rain). Each flake drifts down
 * at its own speed and sways sideways; flakes wrap around the box so there are never more than N. No depth write →
 * the ink outline ignores them. `amount` 0..1 thins them out.
 */
export class SnowFx {
  readonly mesh: THREE.Points;
  private pos: Float32Array;
  private f: Float32Array;   // x, y, z, speed, phase per flake
  private mat: THREE.PointsMaterial;
  private N = 2400; private W = 44; private H = 24;

  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(this.N * 3);
    this.f = new Float32Array(this.N * 5);
    for (let i = 0; i < this.N; i++) {
      const k = i * 5;
      this.f[k] = (Math.random() - 0.5) * this.W; this.f[k + 1] = (Math.random() - 0.5) * this.H; this.f[k + 2] = (Math.random() - 0.5) * this.W;
      this.f[k + 3] = 0.9 + Math.random() * 1.3; this.f[k + 4] = Math.random() * 6.28;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.11, map: softDot(), transparent: true, opacity: 0, depthWrite: false, fog: true, sizeAttenuation: true });
    this.mesh = new THREE.Points(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 5; this.mesh.visible = false;
    scene.add(this.mesh);
  }

  update(dt: number, cam: THREE.Vector3, amount: number, t: number) {
    const on = amount > 0.01;
    this.mesh.visible = on;
    if (!on) return;
    this.mat.opacity = Math.min(1, amount * 1.1);
    const n = Math.floor(this.N * Math.min(1, 0.2 + amount * 0.8));
    const f = this.f, p = this.pos, W = this.W, H = this.H, hw = W / 2, hh = H / 2;
    const wind = Math.sin(t * 0.13) * 0.6 + 0.5;
    for (let i = 0; i < n; i++) {
      const k = i * 5, s = f[k + 3];
      f[k] += (Math.sin(t * 1.3 + f[k + 4]) * 0.5 + wind) * dt;
      f[k + 1] -= s * dt;
      f[k + 2] += Math.cos(t * 1.1 + f[k + 4] * 1.7) * 0.4 * dt;
      if (f[k + 1] < -hh) { f[k + 1] += H; f[k] = (Math.random() - 0.5) * W; f[k + 2] = (Math.random() - 0.5) * W; }
      if (f[k] > hw) f[k] -= W; else if (f[k] < -hw) f[k] += W;
      if (f[k + 2] > hw) f[k + 2] -= W; else if (f[k + 2] < -hw) f[k + 2] += W;
      const j = i * 3;
      p[j] = cam.x + f[k]; p[j + 1] = cam.y + f[k + 1]; p[j + 2] = cam.z + f[k + 2];
    }
    const g = this.mesh.geometry;
    g.setDrawRange(0, n);
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
