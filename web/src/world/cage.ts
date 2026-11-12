import * as THREE from 'three';
import { RAPIER, world, groups, L, owners } from '../core/physics';
import { toonMat } from '../render/toon';
import { clamp, damp } from '../core/util';
import { G } from '../game/ctx';
import type { Pig } from '../pig/pig';

const W = 1.9, D = 1.9, H = 1.45;           // inner size of the cage
const v1 = new THREE.Vector3();

/**
 * Bob's pig cage next to his BBQ grill. Caught pigs are locked inside; the grill heats up (90 s) and then… grilled.
 * Opens when a pig outside holds LMB at the latch, when a caged pig picks the lock (slow), or when it's rammed.
 */
export class Cage {
  root = new THREE.Group();
  door = new THREE.Group();
  open = false;
  /** Latch progress 0..1 (pigs holding LMB at the door). */
  progress = 0;
  pigs: Pig[] = [];
  /** Where Bob stands to put a pig in (outside the door), the inside drop point, the latch. */
  front: THREE.Vector3; inside: THREE.Vector3; latch: THREE.Vector3; grillPos: THREE.Vector3;
  private doorCollider: RAPIER.Collider;
  private doorAngle = 0;
  private fwd: THREE.Vector3;
  private smokeT = 0;
  private lastPick = 0;

  constructor(scene: THREE.Scene, public center: THREE.Vector3, public yaw: number) {
    this.root.position.copy(center); this.root.rotation.y = yaw; scene.add(this.root);
    this.fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const wood = toonMat(0x8a5a32), bar = toonMat(0x3b3f45), floor = toonMat(0xb48a55), red = toonMat(0xc0392b);
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.root) => {
      const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
    };
    // frame + floor + roof
    mesh(new THREE.BoxGeometry(W + 0.2, 0.12, D + 0.2), floor, 0, 0.06, 0);
    mesh(new THREE.BoxGeometry(W + 0.3, 0.1, D + 0.3), wood, 0, H + 0.05, 0);
    const post = new THREE.BoxGeometry(0.12, H, 0.12);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(post, wood, sx * W / 2, H / 2, sz * D / 2);
    const barG = new THREE.CylinderGeometry(0.022, 0.022, H - 0.1, 6);
    const railG = new THREE.BoxGeometry(W, 0.07, 0.07);
    // back + sides (bars)
    for (let i = 1; i < 10; i++) {
      const f = -W / 2 + (i * W) / 10;
      mesh(barG, bar, f, H / 2, -D / 2);
      mesh(barG, bar, -W / 2, H / 2, f); mesh(barG, bar, W / 2, H / 2, f);
    }
    for (const y of [0.15, H - 0.12]) {
      mesh(railG, wood, 0, y, -D / 2);
      const side = mesh(railG, wood, -W / 2, y, 0); side.rotation.y = Math.PI / 2;
      const side2 = mesh(railG, wood, W / 2, y, 0); side2.rotation.y = Math.PI / 2;
    }
    // door (hinged on the left post)
    this.door.position.set(-W / 2, 0, D / 2); this.root.add(this.door);
    for (let i = 1; i < 10; i++) mesh(barG, bar, (i * W) / 10, H / 2, 0, this.door);
    for (const y of [0.15, H - 0.12]) mesh(railG, wood, W / 2, y, 0, this.door);
    mesh(new THREE.BoxGeometry(0.12, 0.2, 0.12), red, W - 0.08, H * 0.55, 0.06, this.door);     // latch
    // little sign
    const sign = mesh(new THREE.BoxGeometry(0.9, 0.32, 0.04), [toonMat(0xe9d3a8), toonMat(0xe9d3a8), toonMat(0xe9d3a8), toonMat(0xe9d3a8),
      toonMat(0xffffff, { map: signTexture() }), toonMat(0xe9d3a8)] as unknown as THREE.Material, 0, H + 0.32, D / 2 + 0.05);
    sign.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.04), wood).translateY(-0.25));

    // colliders: walls, roof, door (all STATIC); ramming any of them bursts the door open
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z)
      .setRotation(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw)));
    const box = (hx: number, hy: number, hz: number, x: number, y: number, z: number) => {
      const c = world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setCollisionGroups(groups(L.STATIC)), body);
      owners.set(c.handle, this.ramTarget);
      return c;
    };
    box(W / 2 + 0.1, 0.06, D / 2 + 0.1, 0, 0.06, 0);
    box(W / 2 + 0.15, 0.08, D / 2 + 0.15, 0, H + 0.05, 0);
    box(W / 2, H / 2, 0.06, 0, H / 2, -D / 2);
    box(0.06, H / 2, D / 2, -W / 2, H / 2, 0); box(0.06, H / 2, D / 2, W / 2, H / 2, 0);
    this.doorCollider = box(W / 2, H / 2, 0.06, 0, H / 2, D / 2);

    const at = (x: number, z: number) => new THREE.Vector3(x, 0, z).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw).add(center);
    this.front = at(0, D / 2 + 1.25);
    this.inside = at(0, 0).setY(center.y + 0.55);
    this.latch = at(W / 2 - 0.1, D / 2);
    this.grillPos = at(W / 2 + 1.7, -0.3);
    buildGrill(this.root, W / 2 + 1.7, -0.3);
  }

  /** Ram / hard hit on the cage (pig ram calls knock on the collider owner). */
  ramTarget = {
    kind: 'cage', mass: 500, radius: 1, heldBy: null,
    body: null as unknown as RAPIER.RigidBody,
    knock: () => { if (!this.open) { this.setOpen(true, 'rammed'); G.fx.shake(0.4); } },
  };

  contains(p: THREE.Vector3, margin = 0) {
    v1.copy(p).sub(this.center).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -this.yaw);
    return Math.abs(v1.x) < W / 2 + margin && Math.abs(v1.z) < D / 2 + margin && v1.y < H + 0.4;
  }

  setOpen(open: boolean, why = '') {
    if (this.open === open) return;
    this.open = open;
    this.doorCollider.setEnabled(!open);
    this.progress = 0;
    G.audio.play('latch', { pos: this.latch, vol: 0.9, pitch: open ? 1 : 0.8 });
    G.audio.play('metal', { pos: this.latch, vol: 0.6, pitch: open ? 0.8 : 1.1 });
    if (open) {
      for (const p of this.pigs) p.freed();
      if (this.pigs.length) G.audio.play('jingle_free', { vol: 0.6 });
      this.pigs = [];
      G.events.push({ type: 'cage-open', why });
    }
  }

  /** Bob locks a pig inside. */
  lock(pig: Pig) {
    this.setOpen(false);
    pig.body.setTranslation({ x: this.inside.x, y: this.inside.y, z: this.inside.z }, true);
    pig.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    if (!this.pigs.includes(pig)) this.pigs.push(pig);
    pig.enterCage(this, G.time + BBQ_TIME);
  }

  update(dt: number, pigs: Pig[]) {
    // latch: pigs outside hold LMB near it (fast); caged pigs pick the lock from inside (slow)
    let rate = 0;
    if (!this.open) {
      for (const p of pigs) {
        if (!p.input.grab || p.mode !== 'normal' || p.out) continue;
        const d = Math.hypot(p.pos.x - this.latch.x, p.pos.z - this.latch.z);
        if (d > 1.25) continue;
        rate = Math.max(rate, this.pigs.includes(p) ? (p.muddy > 0 ? 1 / 6 : 1 / 9) : 1 / 1.1);
      }
      if (rate > 0) {
        this.progress += rate * dt;
        if (G.time - this.lastPick > 0.35) { this.lastPick = G.time; G.audio.play('click', { pos: this.latch, vol: 0.5, rand: 0.3 }); }
        if (this.progress >= 1) this.setOpen(true, 'latch');
      } else this.progress = Math.max(0, this.progress - dt * 0.05);
    }
    // keep caged pigs inside (ragdolls can squeeze through bars)
    if (!this.open) for (const p of this.pigs) if (!this.contains(p.pos, 0.3) && !p.heldBy) {
      p.body.setTranslation({ x: this.inside.x, y: this.inside.y, z: this.inside.z }, true); p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    // time's up: grilled!
    for (const p of [...this.pigs]) {
      if (G.time < p.grillAt) continue;
      this.pigs.splice(this.pigs.indexOf(p), 1);
      G.fx.puff(v1.copy(p.pos), { count: 30, color: 0x444444, spread: 0.6, speed: 2, up: 2, life: 2.5, size: 1.4, grow: 1.5, alpha: 0.7 });
      G.fx.bits(v1, { count: 25, color: 0xff7a1a, spread: 0.4, speed: 4, up: 3, grav: 6, life: 0.8, size: 0.12, grow: 0, alpha: 1 });
      G.audio.play('sizzle', { pos: p.pos, vol: 1 });
      if (p === G.localPig) G.audio.play('jingle_grilled', { vol: 0.8 });
      p.grilled();
      G.grills++;
      G.events.push({ type: 'grilled', who: p });
    }
    // grill: smoke grows as the BBQ heats up
    let heat = 0;
    for (const p of this.pigs) heat = Math.max(heat, 1 - clamp((p.grillAt - G.time) / BBQ_TIME, 0, 1));
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.5 - heat * 0.4;
      const gp = v1.copy(this.grillPos); gp.y += 1.05;
      G.fx.puff(gp, { count: 1, color: heat > 0.7 ? 0x6b6b6b : 0xd9d9d9, spread: 0.15, speed: 0.2, up: 1.2 + heat, life: 2.2, size: 0.4 + heat * 0.5, grow: 0.8, drag: 0.6, alpha: 0.35 + heat * 0.3 });
      if (heat > 0.3) G.fx.bits(gp, { count: Math.ceil(heat * 3), color: 0xff8a2a, spread: 0.2, speed: 0.4, up: 1.5, grav: -1, life: 0.6, size: 0.06, grow: 0, alpha: 1 });
      if (heat > 0.5 && Math.random() < heat) G.audio.play('sizzle', { pos: gp, vol: 0.25 + heat * 0.4, rand: 0.2, minGap: 0.2 });
    }
    // door swing
    this.doorAngle = damp(this.doorAngle, this.open ? -1.9 : 0, 7, dt);
    this.door.rotation.y = this.doorAngle;
  }
}

export const BBQ_TIME = 90;

function signTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 92;
  const x = c.getContext('2d')!;
  x.fillStyle = '#e9d3a8'; x.fillRect(0, 0, 256, 92);
  x.fillStyle = '#b3261e'; x.font = 'bold 58px Title, Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('BBQ', 128, 50);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Cartoon kettle grill (red), with legs, lid propped open and glowing coals. */
function buildGrill(parent: THREE.Object3D, x: number, z: number) {
  const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g);
  const red = toonMat(0xc63a2f), dark = toonMat(0x2b2b2b), coal = toonMat(0xff6a1a, { emissive: new THREE.Color(0xff3a00), emissiveIntensity: 0.9 });
  const m = (geo: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number, pz: number) => {
    const o = new THREE.Mesh(geo, mat); o.position.set(px, py, pz); o.castShadow = true; g.add(o); return o;
  };
  m(new THREE.SphereGeometry(0.42, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), red, 0, 0.92, 0).material = toonMat(0xc63a2f, { side: THREE.DoubleSide });
  m(new THREE.CylinderGeometry(0.4, 0.4, 0.03, 24), coal, 0, 0.86, 0);
  m(new THREE.CylinderGeometry(0.41, 0.41, 0.01, 24, 1, true), dark, 0, 0.93, 0);
  const grate = m(new THREE.CylinderGeometry(0.41, 0.41, 0.02, 24), toonMat(0x555555, { wireframe: true }), 0, 0.92, 0); grate.castShadow = false;
  const lid = m(new THREE.SphereGeometry(0.42, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), red, 0, 0.94, -0.38);
  lid.rotation.x = -1.2;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = m(new THREE.CylinderGeometry(0.025, 0.025, 0.75, 6), dark, Math.cos(a) * 0.25, 0.4, Math.sin(a) * 0.25);
    leg.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
  }
  m(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8), dark, 0, 1.36, -0.75);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  parent.updateMatrixWorld(true);
  const wp = g.getWorldPosition(new THREE.Vector3());
  world.createCollider(RAPIER.ColliderDesc.cylinder(0.5, 0.45).setTranslation(wp.x, wp.y + 0.5, wp.z).setCollisionGroups(groups(L.STATIC)), body);
}
