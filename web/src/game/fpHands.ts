import * as THREE from 'three';
import { toonMat } from '../render/toon';
import { clamp, damp } from '../core/util';
import type { Pig } from '../pig/pig';

/**
 * First person (user: "I won't see the character, at most the pig's hands"; default in the chain modes, V switches):
 * two pink arms with cloven hooves at the bottom of the screen, like an FPS view model. They follow what the pig does:
 * trot on four legs, T-rex arms standing, a jab on a punch, pulled back winding up a throw, a hoof to the mouth eating /
 * smoking — and standing they REACH for the real thing: a hoof on each side of what it holds, a hoof on the crank's
 * knob / the lever / the bolt it works, out to what it touches (two-bone IK, rubber-hose stretch when it's far).
 * Children of the camera; drawn on top (no clipping into walls).
 */
const SHOULDER = [new THREE.Vector3(-0.17, -0.27, -0.42), new THREE.Vector3(0.17, -0.27, -0.42)];
/** Upper arm / forearm (to the hoof) lengths. */
const L1 = 0.16, L2 = 0.165;
const X = new THREE.Vector3(1, 0, 0), UP = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _r = new THREE.Vector3();
const _m = new THREE.Matrix4(), _qa = new THREE.Quaternion(), _cq = new THREE.Quaternion();

interface Arm { g: THREE.Group; fore: THREE.Group; up: THREE.Mesh; fm: THREE.Mesh; hoof: THREE.Mesh; toes: THREE.Mesh[]; k: number; tgt: THREE.Vector3 }

export class FpHands {
  readonly root = new THREE.Group();
  private arms: Arm[] = [];
  private skin: THREE.MeshToonMaterial; private hoof: THREE.MeshToonMaterial;
  private phase = 0; private s = { stand: 0, hold: 0, wind: 0, mouth: 0 };

  constructor(private camera: THREE.Camera) {
    this.skin = toonMat(0xffa9c2); this.hoof = toonMat(0x5a3a3e);
    for (const m of [this.skin, this.hoof]) { m.depthTest = false; m.depthWrite = false; }
    const upperG = new THREE.CapsuleGeometry(0.034, 0.13, 4, 10), foreG = new THREE.CapsuleGeometry(0.031, 0.11, 4, 10);
    const hoofG = new THREE.CylinderGeometry(0.03, 0.036, 0.045, 12), toeG = new THREE.SphereGeometry(0.021, 8, 6);
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group(); g.position.copy(SHOULDER[i]); this.root.add(g);
      const up = new THREE.Mesh(upperG, this.skin); up.rotation.x = -Math.PI / 2; up.position.z = -0.08; g.add(up);
      const fore = new THREE.Group(); fore.position.z = -0.16; g.add(fore);
      const fm = new THREE.Mesh(foreG, this.skin); fm.rotation.x = -Math.PI / 2; fm.position.z = -0.07; fore.add(fm);
      const h = new THREE.Mesh(hoofG, this.hoof); h.rotation.x = -Math.PI / 2; h.position.z = -0.15; fore.add(h);
      const toes = [-1, 1].map((s) => { const t = new THREE.Mesh(toeG, this.hoof); t.position.set(s * 0.016, 0, -0.175); t.scale.set(0.8, 1, 1.4); fore.add(t); return t; });
      this.arms.push({ g, fore, up, fm, hoof: h, toes, k: 0, tgt: new THREE.Vector3() });
    }
    this.root.traverse((o) => { o.renderOrder = 50; o.frustumCulled = false; });
    this.root.visible = false;
    camera.add(this.root);
  }

  update(dt: number, pig: Pig, on: boolean) {
    this.root.visible = on && !pig.out && pig.mode !== 'ragdoll';
    if (!this.root.visible) return;
    this.skin.color.copy(pig.visual.rig.skin[0].mat.color);
    const sp = Math.hypot(pig.vel.x, pig.vel.z), S = this.s;
    this.phase += dt * (pig.standing ? 5 : 8) * clamp(sp / 4, 0, 1.6);
    S.stand = damp(S.stand, pig.standing ? 1 : 0, 10, dt);
    S.hold = damp(S.hold, pig.held ? 1 : 0, 12, dt);
    S.wind = damp(S.wind, pig.charge(), 14, dt);
    S.mouth = damp(S.mouth, pig.eating || (pig.smoking && pig.now - pig.puffAt < 1.2) ? 1 : 0, 10, dt);
    const punch = pig.punchT ? Math.sin(pig.punchT * Math.PI) : 0, bob = Math.sin(this.phase * 2) * 0.012 * clamp(sp / 3, 0, 1);

    // where the real hooves are working (standing): camera space targets for the left / right hoof
    const want = this.targets(pig);

    this.arms.forEach((a, i) => {
      const side = i ? 1 : -1, step = Math.sin(this.phase + i * Math.PI);
      // four legs: the front legs point down-forward and trot; standing: T-rex arms up front
      // (four legs: the front hooves show at the bottom edge, stepping when you walk)
      let rx = 0.35 - S.stand * 0.57, y = -0.2 - S.stand * 0.04, z = SHOULDER[i].z - S.stand * 0.02, x = SHOULDER[i].x, ry = 0, elbow = 0.1 + S.stand * 0.75;
      rx += step * 0.32 * (1 - S.stand) * clamp(sp / 3, 0, 1); y += Math.max(0, -step) * 0.025 * (1 - S.stand) * clamp(sp / 3, 0, 1);
      // holding (by the snout on four legs): both hooves forward, a little inward
      rx = THREE.MathUtils.lerp(rx, 0.02, S.hold); y = THREE.MathUtils.lerp(y, -0.22, S.hold); z = THREE.MathUtils.lerp(z, -0.4, S.hold);
      ry += -side * 0.32 * S.hold; elbow = THREE.MathUtils.lerp(elbow, 0.35, S.hold);
      // winding up a throw: pulled back and up
      z += S.wind * 0.1; y += S.wind * 0.05; rx -= S.wind * 0.5;
      // punch: the right hoof jabs (four legs: a headbutt — both arms brace)
      if (i === 1 && pig.standing) { z -= punch * 0.2; elbow -= punch * 0.7; rx -= punch * 0.25; }
      // eating / smoking: the right hoof to the mouth
      if (i === 1) { x = THREE.MathUtils.lerp(x, 0.05, S.mouth); y = THREE.MathUtils.lerp(y, -0.2, S.mouth); z = THREE.MathUtils.lerp(z, -0.24, S.mouth); rx = THREE.MathUtils.lerp(rx, -0.9, S.mouth); ry = THREE.MathUtils.lerp(ry, -0.5, S.mouth); elbow = THREE.MathUtils.lerp(elbow, 1.6, S.mouth); }
      a.g.position.set(x, y + bob, z);
      a.g.rotation.set(-rx, ry, side * 0.08);   // rx = how far the arm points down
      a.fore.rotation.x = elbow;                 // the forearm bends up at the elbow

      // reaching for the real thing: blend into the IK pose (the hoof lands on it, the arm stretches if it's far)
      const w = want[i];
      if (w) a.tgt.copy(w);
      a.k = damp(a.k, w && S.wind < 0.3 ? 1 : 0, w ? 16 : 10, dt);
      let st = 1;
      if (a.k > 0.002) {
        const ik = this.solve(SHOULDER[i], a.tgt);
        a.g.position.lerp(SHOULDER[i], a.k);
        a.g.quaternion.slerp(ik.q, a.k);
        a.fore.rotation.x = THREE.MathUtils.lerp(a.fore.rotation.x, ik.bend, a.k);
        st = THREE.MathUtils.lerp(1, ik.st, a.k);
      }
      // rubber-hose stretch along the arm (the hoof keeps its size)
      a.up.scale.y = st; a.up.position.z = -0.08 * st;
      a.fore.position.z = -0.16 * st;
      a.fm.scale.y = st; a.fm.position.z = -0.07 * st;
      a.hoof.position.z = -0.15 * st;
      const open = pig.held ? 0.5 : pig.handle && a.k > 0.5 ? 0.3 : 0.15;
      a.toes.forEach((t, k) => { t.position.x = (k ? 1 : -1) * (0.013 + open * 0.02); t.position.z = a.hoof.position.z - 0.025; });
    });
  }

  /** Camera-space targets for the left / right hoof (null = that arm just animates). */
  private wantV = [new THREE.Vector3(), new THREE.Vector3()];
  private targets(pig: Pig): (THREE.Vector3 | null)[] {
    const out: (THREE.Vector3 | null)[] = [null, null];
    if (!pig.standing || !pig.handAt || pig.mode === 'held') return out;
    const cam = this.camera;
    cam.updateMatrixWorld();
    if (pig.held) {
      // a hoof on each side of the thing (sideways = the camera's right)
      const hw = clamp(pig.held.radius, 0.06, 0.32);
      _r.set(1, 0, 0).applyQuaternion(cam.getWorldQuaternion(_cq));
      for (let i = 0; i < 2; i++) {
        out[i] = this.wantV[i].copy(pig.handAt).addScaledVector(_r, (i ? 1 : -1) * hw);
        out[i]!.y -= 0.02;
      }
    } else out[1] = this.wantV[1].copy(pig.handAt);   // a machine part / a touch: the right hoof
    for (let i = 0; i < 2; i++) {
      const v = out[i];
      if (!v) continue;
      cam.worldToLocal(v);
      if (v.z > -0.08) out[i] = null;   // behind the eyes: leave it to the animation
    }
    return out;
  }

  private ikQ = new THREE.Quaternion();
  /** Two-bone IK from the shoulder to T (camera space): the arm's rotation, the elbow bend and the stretch. */
  private solve(S: THREE.Vector3, T: THREE.Vector3) {
    const dir = _d.copy(T).sub(S);
    const d = Math.max(dir.length(), 1e-4);
    _z.copy(dir).divideScalar(-d);                       // the arm points along its -z
    _x.crossVectors(UP, _z);
    if (_x.lengthSq() < 1e-6) _x.copy(X); else _x.normalize();
    _y.crossVectors(_z, _x);
    this.ikQ.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
    const reach = (L1 + L2) * 0.98;
    let st = 1, bend = 0;
    if (d >= reach) st = Math.min(d / reach, 4);         // far: straight and stretched (cartoon)
    else {
      const dd = Math.max(d, 0.06);
      const a = Math.acos(clamp((L1 * L1 + dd * dd - L2 * L2) / (2 * L1 * dd), -1, 1));
      bend = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - dd * dd) / (2 * L1 * L2), -1, 1));
      this.ikQ.multiply(_qa.setFromAxisAngle(X, -a));    // the upper arm dips, the elbow points down, the forearm comes up
    }
    return { q: this.ikQ, bend, st };
  }
}
