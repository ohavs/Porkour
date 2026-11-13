import * as THREE from 'three';
import { RAMP } from './toon';

/**
 * Googly eyes (Party Animals / Untitled Goose Game silliness): a white dome with a black pupil that slides around
 * under gravity and lags behind every move (spring + bounce on the rim). All eyes in the game are 2 InstancedMeshes.
 * An eye follows an anchor Object3D whose +z points out of the face.
 */
interface Eye { anchor: THREE.Object3D; r: number; off: THREE.Vector2; vel: THREE.Vector2; last: THREE.Vector3; lastV: THREE.Vector3; seen: boolean; on: boolean }

const MAX = 128;
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
const m1 = new THREE.Matrix4(), s1 = new THREE.Vector3(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class GooglyEyes {
  whites: THREE.InstancedMesh;
  pupils: THREE.InstancedMesh;
  private eyes: Eye[] = [];
  constructor(scene: THREE.Scene) {
    const white = new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);   // dome
    white.rotateX(Math.PI / 2);                                                          // opens along +z
    const pupil = new THREE.SphereGeometry(1, 12, 8); pupil.scale(1, 1, 0.35);
    this.whites = new THREE.InstancedMesh(white, new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: RAMP }), MAX);
    this.pupils = new THREE.InstancedMesh(pupil, new THREE.MeshBasicMaterial({ color: 0x111111 }), MAX);
    for (const m of [this.whites, this.pupils]) {
      m.frustumCulled = false; m.count = 0; m.castShadow = false; m.receiveShadow = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m);
    }
  }
  add(anchor: THREE.Object3D, r: number) {
    if (this.eyes.length >= MAX) return null;
    const e: Eye = { anchor, r, off: new THREE.Vector2(0, -r * 0.3), vel: new THREE.Vector2(), last: new THREE.Vector3(), lastV: new THREE.Vector3(), seen: false, on: true };
    this.eyes.push(e); return e;
  }
  remove(anchor: THREE.Object3D) { this.eyes = this.eyes.filter((e) => e.anchor !== anchor); }

  update(dt: number) {
    dt = Math.min(dt, 1 / 20);
    let n = 0, gone = false;
    for (const e of this.eyes) {
      const a = e.anchor;
      let vis = true, top: THREE.Object3D = a;
      for (let o: THREE.Object3D | null = a; o; o = o.parent) { if (!o.visible) vis = false; top = o; }
      if (!(top as THREE.Scene).isScene) { if (e.seen) { e.on = false; gone = true; } continue; }
      if (!vis) continue;
      a.matrixWorld.decompose(v1, q1, s1);
      // anchor velocity + acceleration (world) → local face plane (x, y)
      const vel = v2.copy(v1).sub(e.last).divideScalar(Math.max(dt, 1e-3));
      if (!e.seen) { vel.set(0, 0, 0); e.lastV.set(0, 0, 0); e.seen = true; }
      const acc = e.lastV.clone().sub(vel).divideScalar(Math.max(dt, 1e-3));   // inertia: the pupil lags behind
      e.last.copy(v1); e.lastV.copy(vel);
      acc.y -= 9.8 * 2;                                                            // gravity (after the inertia scale below)
      acc.multiplyScalar(0.5).clampLength(0, 30);
      const inv = q2.copy(q1).invert();
      acc.applyQuaternion(inv);
      const lim = e.r * 0.48;
      e.vel.x += acc.x * dt * 0.09; e.vel.y += acc.y * dt * 0.09;
      e.vel.multiplyScalar(Math.exp(-3 * dt));
      e.off.x += e.vel.x * dt * 6; e.off.y += e.vel.y * dt * 6;
      const l = e.off.length();
      if (l > lim) {                                                               // bounce on the rim
        e.off.multiplyScalar(lim / l);
        const nx = e.off.x / lim, ny = e.off.y / lim, d = e.vel.x * nx + e.vel.y * ny;
        if (d > 0) { e.vel.x -= 1.6 * d * nx; e.vel.y -= 1.6 * d * ny; }
      }
      m1.compose(v1, q1, s1.setScalar(e.r));
      this.whites.setMatrixAt(n, m1);
      const pr = e.r * 0.5;
      const pz = Math.sqrt(Math.max(0, e.r * e.r - e.off.lengthSq())) * 0.96;
      const p = v2.set(e.off.x, e.off.y, pz).applyQuaternion(q1).add(v1);
      m1.compose(p, q1, s1.setScalar(pr));
      this.pupils.setMatrixAt(n, m1);
      n++;
    }
    if (gone) this.eyes = this.eyes.filter((e) => e.on);
    for (let i = n; i < this.whites.count; i++) { this.whites.setMatrixAt(i, ZERO); this.pupils.setMatrixAt(i, ZERO); }
    this.whites.count = this.pupils.count = n;
    this.whites.instanceMatrix.needsUpdate = this.pupils.instanceMatrix.needsUpdate = true;
  }
}

let shared: GooglyEyes | null = null;
export function googly(scene?: THREE.Scene) { if (!shared && scene) shared = new GooglyEyes(scene); return shared; }
