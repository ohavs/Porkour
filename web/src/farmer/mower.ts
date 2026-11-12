import * as THREE from 'three';
import { toonMat } from '../render/toon';
import { RAPIER, world, groups, L } from '../core/physics';
import { G } from '../game/ctx';
import type { Nav } from './nav';
import type { Rect } from '../world/terrain';
import type { Loop } from '../core/audio';

/**
 * Bob's red ride-on lawn mower. Parked = static collider; ridden = attached under Bob, cuts the grass
 * (Grass.mow), sprays clippings, knocks pigs out of the way, makes noise.
 */
export class Mower {
  root = new THREE.Group();
  private wheels: THREE.Object3D[] = [];
  private blade = new THREE.Group();
  private body: RAPIER.RigidBody;
  riding = false;
  pos = new THREE.Vector3();
  yaw = 0;
  private engine: Loop | null = null;
  private noiseT = 0;
  onMow?: (x: number, z: number, r: number) => void;

  constructor(private scene: THREE.Scene, at: THREE.Vector3, yaw: number) {
    const red = toonMat(0xd8302a), dark = toonMat(0x2b2b2b), seat = toonMat(0x3a3a3a), metal = toonMat(0xb8c0c8), yellow = toonMat(0xffd166);
    const m = (g: THREE.BufferGeometry, mat: THREE.Material, p: [number, number, number], r?: [number, number, number], parent: THREE.Object3D = this.root) => {
      const o = new THREE.Mesh(g, mat); o.position.set(...p); if (r) o.rotation.set(...r); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
    };
    // deck + hood + seat (front = +z)
    m(new THREE.BoxGeometry(0.9, 0.12, 1.3), red, [0, 0.32, 0.05]);
    const hood = m(new THREE.CapsuleGeometry(0.32, 0.36, 6, 14), red, [0, 0.52, 0.42], [Math.PI / 2, 0, 0]); hood.scale.set(1.15, 1, 0.8);
    m(new THREE.BoxGeometry(0.5, 0.06, 0.3), dark, [0, 0.55, 0.78]);   // grille
    m(new THREE.SphereGeometry(0.05, 10, 8), yellow, [0.18, 0.56, 0.75]); m(new THREE.SphereGeometry(0.05, 10, 8), yellow, [-0.18, 0.56, 0.75]);
    m(new THREE.BoxGeometry(0.5, 0.1, 0.42), seat, [0, 0.62, -0.25]);
    m(new THREE.BoxGeometry(0.5, 0.42, 0.1), seat, [0, 0.82, -0.47], [-0.15, 0, 0]);
    m(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), dark, [0, 0.78, 0.18], [-0.6, 0, 0]);
    m(new THREE.TorusGeometry(0.15, 0.025, 8, 20), dark, [0, 1.0, 0.07], [-0.95, 0, 0]);      // steering wheel
    m(new THREE.BoxGeometry(0.4, 0.3, 0.35), toonMat(0x3fae5a), [0, 0.5, -0.72]);              // grass bag
    m(new THREE.CylinderGeometry(0.04, 0.05, 0.18, 8), metal, [0.28, 0.72, 0.42]);              // exhaust
    for (const [x, z, r] of [[0.42, 0.45, 0.17], [-0.42, 0.45, 0.17], [0.44, -0.4, 0.26], [-0.44, -0.4, 0.26]] as const) {
      const w = m(new THREE.CylinderGeometry(r, r, 0.14, 18), dark, [x, r, z], [0, 0, Math.PI / 2]);
      m(new THREE.CylinderGeometry(r * 0.45, r * 0.45, 0.15, 12), yellow, [0, 0, 0], undefined, w);
      this.wheels.push(w);
    }
    this.root.add(this.blade);
    this.place(at, yaw);
    scene.add(this.root);
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(at.x, at.y + 0.5, at.z));
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.48, 0.5, 0.75).setCollisionGroups(groups(L.STATIC)), this.body);
    this.parkBody();
  }

  private place(at: THREE.Vector3, yaw: number) { this.pos.copy(at); this.yaw = yaw; this.root.position.copy(at); this.root.rotation.y = yaw; }
  private parkBody() {
    this.body.setTranslation({ x: this.pos.x, y: this.pos.y + 0.5, z: this.pos.z }, true);
    this.body.setRotation(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw), true);
  }

  /** Bob climbs on: the mower becomes part of his visual. */
  mount(bobRoot: THREE.Object3D) {
    this.riding = true;
    this.body.setEnabled(false);
    bobRoot.add(this.root);
    this.root.position.set(0, 0, 0.15); this.root.rotation.set(0, 0, 0);
    this.engine = G.audio.loop('mower', { vol: 0.7, pos: this.pos, bus: 'sfx', ref: 6 });
  }
  /** Bob gets off: park where he is. */
  dismount(at: THREE.Vector3, yaw: number) {
    if (!this.riding) return;
    this.riding = false;
    this.scene.add(this.root);
    const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    this.place(at.clone().addScaledVector(f, 0.15), yaw);
    this.body.setEnabled(true); this.parkBody();
    this.engine?.stop(); this.engine = null;
  }

  /** While ridden (fixed step): cut grass, clippings, knock pigs, noise. */
  ride(at: THREE.Vector3, yaw: number, speed: number, dt: number) {
    const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    this.pos.copy(at).addScaledVector(f, 0.15);
    for (const w of this.wheels) w.rotation.x += speed * dt * 4;
    this.engine?.setPos(this.pos);
    this.engine?.setRate(0.9 + speed * 0.08);
    this.onMow?.(this.pos.x, this.pos.z, 0.75);
    if (speed > 0.3 && Math.random() < dt * 25) {
      const back = this.pos.clone().addScaledVector(f, -0.7); back.y += 0.3;
      G.fx.bits(back, { count: 2, color: Math.random() < 0.5 ? 0x6db33f : 0x8bcf52, spread: 0.2, speed: 2, up: 1.5, grav: 8, life: 0.7, size: 0.06, grow: 0, drag: 1, alpha: 1, dir: f.clone().negate() });
    }
    if (Math.random() < dt * 3) G.fx.puff(this.pos.clone().add(new THREE.Vector3(0.28, 0.85, 0.42).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw)),
      { count: 1, color: 0x666666, spread: 0.05, speed: 0.3, up: 0.8, life: 0.9, size: 0.18, grow: 0.4, alpha: 0.35 });
    // pigs in front get bumped (and squeal)
    for (const p of G.pigs) {
      if (p.out || p.cage || p.heldBy || p.mode === 'ragdoll') continue;
      const d = Math.hypot(p.pos.x - (this.pos.x + f.x * 0.7), p.pos.z - (this.pos.z + f.z * 0.7));
      if (d < 0.75 && Math.abs(p.pos.y - at.y - 0.4) < 1) {
        p.knock(new THREE.Vector3(f.x * 5 + (Math.random() - 0.5) * 3, 6, f.z * 5 + (Math.random() - 0.5) * 3), true);
        G.audio.play('squeal', { pos: p.pos, vol: 1 });
      }
    }
    this.noiseT -= dt;
    if (this.noiseT <= 0) { this.noiseT = 1; G.noise(this.pos, 0.1); }   // marker only (Bob is the one mowing)
  }

  /** Serpentine rows inside a rect, only through walkable cells. */
  static lawnPath(nav: Nav, r: Rect, gap = 1.7): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    let flip = false;
    for (let z = r.z0; z <= r.z1; z += gap) {
      const row: THREE.Vector3[] = [];
      for (let x = r.x0; x <= r.x1; x += 1) if (nav.free(x, z)) row.push(new THREE.Vector3(x, 0, z));
      if (row.length < 3) continue;
      if (flip) row.reverse();
      pts.push(row[0], row[row.length - 1]);
      flip = !flip;
    }
    for (const p of pts) p.y = G.terrain.height(p.x, p.z);
    return pts;
  }
}
