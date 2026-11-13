import * as THREE from 'three';

/**
 * Rain streaks in a box that travels with the camera (one LineSegments draw call). Drops fall slanted by the wind and
 * wrap around the box, so there are never more than N of them. No depth write → the ink outline ignores them
 * (like the grass). `amount` 0..1 fades them in / out and thins them out.
 */
export class RainFx {
  readonly mesh: THREE.LineSegments;
  private pos: Float32Array;
  private drops: Float32Array;   // x, y, z, speed per drop
  private mat: THREE.LineBasicMaterial;
  private N = 1800; private W = 46; private H = 26;
  private wind = new THREE.Vector2(1.6, 0.8);

  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(this.N * 6);
    this.drops = new Float32Array(this.N * 4);
    for (let i = 0; i < this.N; i++) {
      this.drops[i * 4] = (Math.random() - 0.5) * this.W; this.drops[i * 4 + 1] = (Math.random() - 0.5) * this.H;
      this.drops[i * 4 + 2] = (Math.random() - 0.5) * this.W; this.drops[i * 4 + 3] = 17 + Math.random() * 8;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.LineBasicMaterial({ color: 0xcbd8ea, transparent: true, opacity: 0, depthWrite: false, fog: true });
    this.mesh = new THREE.LineSegments(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 5; this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Drops are stored relative to the camera box; the box follows the camera so they never run out. */
  update(dt: number, cam: THREE.Vector3, amount: number, night: number) {
    const on = amount > 0.01;
    this.mesh.visible = on;
    if (!on) return;
    this.mat.opacity = amount * (0.55 - night * 0.25);
    const n = Math.floor(this.N * Math.min(1, 0.25 + amount * 0.75));
    const d = this.drops, p = this.pos, W = this.W, H = this.H, hw = W / 2, hh = H / 2;
    const wx = this.wind.x, wz = this.wind.y;
    for (let i = 0; i < n; i++) {
      const k = i * 4, s = d[k + 3];
      d[k] += wx * dt; d[k + 1] -= s * dt; d[k + 2] += wz * dt;
      if (d[k + 1] < -hh) { d[k + 1] += H; d[k] = (Math.random() - 0.5) * W; d[k + 2] = (Math.random() - 0.5) * W; }
      if (d[k] > hw) d[k] -= W; else if (d[k] < -hw) d[k] += W;
      if (d[k + 2] > hw) d[k + 2] -= W; else if (d[k + 2] < -hw) d[k + 2] += W;
      const x = cam.x + d[k], y = cam.y + d[k + 1], z = cam.z + d[k + 2], len = s * 0.045;
      const j = i * 6;
      p[j] = x; p[j + 1] = y; p[j + 2] = z;
      p[j + 3] = x + (wx / s) * len; p[j + 4] = y + len; p[j + 5] = z + (wz / s) * len;
    }
    const g = this.mesh.geometry;
    g.setDrawRange(0, n * 2);
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
