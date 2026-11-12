import * as THREE from 'three';
import { raycast, L, owners } from '../core/physics';
import { clamp, damp } from '../core/util';
import { G } from './ctx';

/** Third-person orbit camera: mouse / right stick, pulls in on walls, shake. */
export class CamRig {
  yaw = Math.PI; pitch = 0.32;
  dist = 4.8;
  private cur = 4.8;
  private focus = new THREE.Vector3();
  private first = true;
  constructor(public camera: THREE.PerspectiveCamera) {}

  /** Camera forward / right on the ground plane (for movement input). */
  basis() {
    const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const r = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    return { f, r };
  }

  update(dt: number, lookX: number, lookY: number, target: THREE.Vector3, standing: boolean) {
    this.yaw -= lookX;
    this.pitch = clamp(this.pitch + lookY, -0.5, 1.25);
    const fy = target.y + (standing ? 1.05 : 0.85);
    if (this.first) { this.focus.set(target.x, fy, target.z); this.first = false; }
    this.focus.x = damp(this.focus.x, target.x, 18, dt);
    this.focus.z = damp(this.focus.z, target.z, 18, dt);
    this.focus.y = damp(this.focus.y, fy, 9, dt);
    const want = this.dist + (standing ? 0.4 : 0);
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const hit = raycast(this.focus, dir, want + 0.3, L.STATIC, undefined, (c) => owners.get(c.handle)?.kind !== 'cage');
    const d = hit ? Math.max(0.6, hit.dist - 0.3) : want;
    this.cur = d < this.cur ? d : damp(this.cur, d, 4, dt);
    this.camera.position.copy(this.focus).addScaledVector(dir, this.cur);
    const groundY = G.terrain.height(this.camera.position.x, this.camera.position.z) + 0.3;
    if (this.camera.position.y < groundY) this.camera.position.y = groundY;
    this.camera.lookAt(this.focus);
    const s = G.fx.shakeAmt * G.fx.shakeAmt * 0.35;
    if (s > 0.0005) {
      this.camera.position.x += (Math.random() - 0.5) * s; this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.rotateZ((Math.random() - 0.5) * s * 0.2);
    }
  }
}
