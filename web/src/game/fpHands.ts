import * as THREE from 'three';
import { toonMat } from '../render/toon';
import { clamp, damp } from '../core/util';
import type { Pig } from '../pig/pig';

/**
 * First person (admin test, user: "I won't see the character, at most the pig's hands"): two pink arms with cloven
 * hooves at the bottom of the screen, like an FPS view model. They follow what the pig does: trot on four legs, T-rex
 * arms standing, a jab on a punch, both hooves forward around what it holds, pulled back winding up a throw, a hoof
 * to the mouth eating / smoking. Children of the camera; drawn on top (no clipping into walls).
 */
const SHOULDER = [new THREE.Vector3(-0.2, -0.3, -0.3), new THREE.Vector3(0.2, -0.3, -0.3)];

export class FpHands {
  readonly root = new THREE.Group();
  private arms: { g: THREE.Group; fore: THREE.Group; toes: THREE.Mesh[] }[] = [];
  private skin: THREE.MeshToonMaterial; private hoof: THREE.MeshToonMaterial;
  private phase = 0; private s = { stand: 0, hold: 0, wind: 0, mouth: 0 };

  constructor(camera: THREE.Camera) {
    this.skin = toonMat(0xffa9c2); this.hoof = toonMat(0x6b4048);
    for (const m of [this.skin, this.hoof]) { m.depthTest = false; m.depthWrite = false; }
    const upperG = new THREE.CapsuleGeometry(0.055, 0.2, 4, 10), foreG = new THREE.CapsuleGeometry(0.05, 0.17, 4, 10);
    const hoofG = new THREE.CylinderGeometry(0.055, 0.06, 0.07, 12), toeG = new THREE.SphereGeometry(0.035, 8, 6);
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group(); g.position.copy(SHOULDER[i]); this.root.add(g);
      const up = new THREE.Mesh(upperG, this.skin); up.rotation.x = -Math.PI / 2; up.position.z = -0.12; g.add(up);
      const fore = new THREE.Group(); fore.position.z = -0.25; g.add(fore);
      const fm = new THREE.Mesh(foreG, this.skin); fm.rotation.x = -Math.PI / 2; fm.position.z = -0.1; fore.add(fm);
      const h = new THREE.Mesh(hoofG, this.hoof); h.rotation.x = -Math.PI / 2; h.position.z = -0.22; fore.add(h);
      const toes = [-1, 1].map((s) => { const t = new THREE.Mesh(toeG, this.hoof); t.position.set(s * 0.025, 0, -0.26); t.scale.set(0.8, 1, 1.3); fore.add(t); return t; });
      this.arms.push({ g, fore, toes });
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
    this.arms.forEach((a, i) => {
      const side = i ? 1 : -1, step = Math.sin(this.phase + i * Math.PI);
      // four legs: the front legs point down-forward and trot; standing: T-rex arms up front
      let rx = 0.95 - S.stand * 1.15, y = -0.42 + S.stand * 0.14, z = -0.22 - S.stand * 0.05, x = SHOULDER[i].x, ry = 0, elbow = 0.15 + S.stand * 0.75;
      rx += step * 0.35 * (1 - S.stand) * clamp(sp / 3, 0, 1);
      // holding: both hooves forward, a little inward
      rx = THREE.MathUtils.lerp(rx, -0.05, S.hold); y = THREE.MathUtils.lerp(y, -0.24, S.hold); z = THREE.MathUtils.lerp(z, -0.32, S.hold);
      ry += -side * 0.3 * S.hold; elbow = THREE.MathUtils.lerp(elbow, 0.35, S.hold);
      // winding up a throw: pulled back and up
      z += S.wind * 0.12; y += S.wind * 0.06; rx -= S.wind * 0.5;
      // punch: the right hoof jabs (four legs: a headbutt — both arms brace)
      if (i === 1 && pig.standing) { z -= punch * 0.28; elbow -= punch * 0.7; rx -= punch * 0.2; }
      // eating / smoking: the right hoof to the mouth
      if (i === 1) { x = THREE.MathUtils.lerp(x, 0.06, S.mouth); y = THREE.MathUtils.lerp(y, -0.2, S.mouth); z = THREE.MathUtils.lerp(z, -0.12, S.mouth); rx = THREE.MathUtils.lerp(rx, -0.9, S.mouth); ry = THREE.MathUtils.lerp(ry, -0.5, S.mouth); elbow = THREE.MathUtils.lerp(elbow, 1.6, S.mouth); }
      a.g.position.set(x, y + bob, z);
      a.g.rotation.set(-rx, ry, side * 0.08);   // rx = how far the arm points down
      a.fore.rotation.x = elbow;                 // the forearm bends up at the elbow
      const open = pig.held ? 0.5 : 0.15;
      a.toes.forEach((t, k) => { t.position.x = (k ? 1 : -1) * (0.02 + open * 0.03); });
    });
  }
}
