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
  /** Working with the hooves: the focus slides a little past the pig (0..1, smoothed). */
  private workK = 0;
  /**
   * First and third person keep their own up / down angle (s26, user: "for the other player, switching to third person
   * the camera looks from right above the pig, far"): looking down at the hooves in first person (pitch ~1) carried
   * over = a third-person camera straight overhead. Back in third person = the angle it had before.
   */
  private fpWas = false; private tpPitch = 0.32;
  constructor(public camera: THREE.PerspectiveCamera) {}

  /** Camera forward / right on the ground plane (for movement input). */
  basis() {
    const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const r = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    return { f, r };
  }

  /** First person (admin test): the camera is the pig's eyes — same yaw / pitch, so turning feels the same. */
  updateFP(dt: number, lookX: number, lookY: number, eye: THREE.Vector3) {
    void dt;
    if (!this.fpWas) { this.fpWas = true; this.tpPitch = this.pitch; this.pitch = clamp(this.pitch - 0.25, -0.3, 0.6); }   // eyes level-ish
    this.yaw -= lookX;
    this.pitch = clamp(this.pitch + lookY, -1.35, 1.35);
    this.camera.position.copy(eye);
    const cp = Math.cos(this.pitch);
    this.camera.lookAt(eye.x + Math.sin(this.yaw) * cp, eye.y - Math.sin(this.pitch), eye.z + Math.cos(this.yaw) * cp);
    const s = G.fx.shakeAmt * G.fx.shakeAmt * 0.35;
    if (s > 0.0005) this.camera.rotateZ((Math.random() - 0.5) * s * 0.3);
    this.first = true;   // back in third person: snap the orbit focus to the pig
  }

  update(dt: number, lookX: number, lookY: number, target: THREE.Vector3, standing: boolean, work = 0) {
    if (this.fpWas) { this.fpWas = false; this.pitch = clamp(this.tpPitch, 0.05, 0.75); this.cur = this.dist; }
    this.yaw -= lookX;
    this.pitch = clamp(this.pitch + lookY, -0.5, 1.25);
    this.workK = damp(this.workK, work, 4, dt);
    // working (something light in the hooves, a crank…): look a little past the pig so the crosshair is on the work
    const wk = this.workK, ax = target.x + Math.sin(this.yaw) * 0.55 * wk, az = target.z + Math.cos(this.yaw) * 0.55 * wk;
    const fy = target.y + (standing ? 1.05 : 0.85) + 0.12 * wk;
    if (this.first) { this.focus.set(ax, fy, az); this.first = false; }
    this.focus.x = damp(this.focus.x, ax, 18, dt);
    this.focus.z = damp(this.focus.z, az, 18, dt);
    this.focus.y = damp(this.focus.y, fy, 9, dt);
    const want = (this.dist + (standing ? 0.4 : 0)) * (1 - 0.32 * wk);
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const hit = raycast(this.focus, dir, want + 0.3, L.STATIC, undefined, (c) => owners.get(c.handle)?.kind !== 'cage' && !G.camSkip.has(c.handle));
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
