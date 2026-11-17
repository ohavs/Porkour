import * as THREE from 'three';
import { RAPIER, world, groups, L, owners } from '../core/physics';
import { V3 } from '../core/util';
import { G } from '../game/ctx';
import { toonMat } from '../render/toon';
import { rigidSkin } from '../render/batch';
import { fruitTreeGeo } from './nature';
import { Prop, PROPS } from './props';
import type { Pig } from '../pig/pig';

/**
 * Farm 2's orchard (host-authoritative, synced as one entity): fruit trees you can SHAKE — headbutt / punch / whack
 * the trunk, ram it at full sprint, or throw something hard at it — and apples rain down (rustle + noise Bob hears).
 * Each tree has a few apples a round (the fruit on the tree disappears when it's empty); the apples are a pool of
 * props (cheap loot, throwable: they splat on Bob). One tree in the middle grows THE golden apple.
 * The cider press next to the cider house eats apples dropped in its hopper; the 6th one makes a jug of cider.
 */
export const ORCHARD = { fruit: 4, perShake: 2, pool: 30, noise: 12, ramMin: 7, throwMin: 5, press: 6, hopperR: 0.75 };

const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), m1 = new THREE.Matrix4(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

interface Tree {
  i: number; x: number; z: number; y: number; s: number; yaw: number;
  /** Instanced mesh + slot of the tree and of its fruit. */
  im: THREE.InstancedMesh; fim: THREE.InstancedMesh; slot: number;
  fruit: number; gold: boolean; shook: boolean;
  /** Wiggle (render): when it was last shaken and which way. */
  wigT: number; wigX: number; wigZ: number;
  lastHit: number;
}

export class Orchard {
  trees: Tree[] = [];
  apples: Prop[] = [];
  gold: Prop | null = null;
  cider: Prop | null = null;
  /** Apples squeezed in the press this round. */
  pressed = 0;
  private press: { x: number; z: number; y: number; screw: THREE.Object3D; spinT: number } | null = null;
  private dropped: Prop[] = [];
  private fruitKey = '';

  constructor(private scene: THREE.Scene, spots: { x: number; z: number; s?: number; gold?: boolean }[], props: Prop[], private y: (x: number, z: number) => number) {
    // 3 tree shapes, each as an instanced tree + its fruit
    const variants = [0, 1, 2].map(() => fruitTreeGeo(0xe8322f));
    const goldGeo = fruitTreeGeo(0xffcf3a, 1);
    const mat = toonMat(0xffffff, { vertexColors: true });
    const counts = [0, 0, 0];
    spots.forEach((s, i) => { if (!s.gold) counts[i % 3]++; });
    const ims = variants.map((v, k) => [new THREE.InstancedMesh(v.tree, mat, Math.max(1, counts[k])), new THREE.InstancedMesh(v.fruit, mat, Math.max(1, counts[k]))]);
    const gim = [new THREE.InstancedMesh(goldGeo.tree, mat, 1), new THREE.InstancedMesh(goldGeo.fruit, mat, 1)];
    const used = [0, 0, 0];
    spots.forEach((sp, i) => {
      const k = i % 3, [im, fim] = sp.gold ? gim : ims[k], slot = sp.gold ? 0 : used[k]++;
      const ty = y(sp.x, sp.z) - 0.05, s = sp.s ?? 1, yaw = ((i * 2.399) % 6.28);
      const t: Tree = { i, x: sp.x, z: sp.z, y: ty, s, yaw, im, fim, slot, fruit: sp.gold ? 1 : ORCHARD.fruit, gold: !!sp.gold, shook: false, wigT: -10, wigX: 0, wigZ: 0, lastHit: -10 };
      this.trees.push(t);
      this.place(t, 0);
      // trunk collider: rams, thrown things and punches find the tree through it
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(sp.x, ty + 1.5, sp.z));
      const c = world.createCollider(RAPIER.ColliderDesc.cylinder(1.5, 0.3 * s).setCollisionGroups(groups(L.STATIC)), body);
      owners.set(c.handle, {
        kind: 'tree',
        onRam: (by: Pig, dir: THREE.Vector3) => this.shake(t, dir, by, 1),
        onImpact: (p: Prop, force: number) => { if (p.def === PROPS.apple || p.def === PROPS.goldApple) return; if (p.synced.preVel.length() > ORCHARD.throwMin && force > p.mass * 200) this.shake(t, p.synced.preVel, null, 0.7); },
      });
    });
    for (const [im, fim] of [...ims, gim]) for (const m of [im, fim]) { m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere(); scene.add(m); }
    // the apple pool (hidden until a tree drops them)
    const home = V3(0, -40, 0);
    for (let i = 0; i < ORCHARD.pool; i++) {
      const p = new Prop(scene, PROPS.apple, home.clone().setX(40 + i * 0.6), 0);
      p.pooled = true; p.bank();
      this.apples.push(p); props.push(p);
    }
    if (spots.some((s) => s.gold)) {
      this.gold = new Prop(scene, PROPS.goldApple, home.clone().setX(70), 0);
      this.gold.pooled = true; this.gold.bank(); props.push(this.gold);
    }
    G.hittables.push({ hit: (hx, hy, hz, reach, dir, k, by) => this.punch(hx, hy, hz, reach, dir, k, by as Pig) });
  }

  /** The cider press (a hopper you drop apples into, a big wooden screw that turns): built by the farm, next to the cider house. */
  buildPress(x: number, z: number, yaw: number, props: Prop[]) {
    const y = this.y(x, z);
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = yaw; this.scene.add(g);
    const wood = toonMat(0x9a6a3c), dark = toonMat(0x6e4524), iron = toonMat(0x55575c), juice = toonMat(0xd9902a);
    const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, px: number, py: number, pz: number, parent: THREE.Object3D = g) => {
      const o = new THREE.Mesh(geo, m); o.position.set(px, py, pz); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
    };
    mesh(new THREE.BoxGeometry(1.9, 0.3, 1.3), dark, 0, 0.15, 0);                      // base
    mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.7, 16, 1, true), wood, 0, 0.65, 0);   // the tub (slats)
    for (const yy of [0.42, 0.88]) mesh(new THREE.TorusGeometry(0.63, 0.035, 6, 20), iron, 0, yy, 0).rotation.x = Math.PI / 2;
    mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.05, 16), juice, 0, 0.75, 0);          // apple mash
    for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.16, 2.3, 0.16), dark, s * 0.82, 1.15, 0);   // frame
    mesh(new THREE.BoxGeometry(1.9, 0.2, 0.22), dark, 0, 2.3, 0);
    const screw = new THREE.Group(); screw.position.set(0, 1.55, 0); g.add(screw);
    mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.6, 8), iron, 0, 0, 0, screw);
    mesh(new THREE.BoxGeometry(1.3, 0.07, 0.07), wood, 0, 0.55, 0, screw);             // the turning bar
    mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 16), wood, 0, -0.62, 0, screw);    // pressing plate
    mesh(new THREE.BoxGeometry(0.3, 0.08, 0.5), wood, 0.85, 0.25, 0.55).rotation.x = 0.25;   // spout
    rigidSkin(g);   // the screw group is a pivot: it becomes a bone and keeps turning
    // colliders: base + the tub wall (an open hopper: apples fall in)
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation(q1.setFromAxisAngle(UP, yaw)));
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.95, 0.15, 0.65).setTranslation(0, 0.15, 0).setCollisionGroups(groups(L.STATIC)), body);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      world.createCollider(RAPIER.ColliderDesc.cuboid(0.25, 0.35, 0.05).setTranslation(Math.cos(a) * 0.62, 0.65, Math.sin(a) * 0.62)
        .setRotation(q2.setFromAxisAngle(UP, -a + Math.PI / 2)).setCollisionGroups(groups(L.STATIC)), body);
    }
    for (const s of [-1, 1]) world.createCollider(RAPIER.ColliderDesc.cuboid(0.08, 1.15, 0.08).setTranslation(s * 0.82, 1.15, 0).setCollisionGroups(groups(L.STATIC)), body);
    this.press = { x, z, y, screw, spinT: 0 };
    // the jug of cider it makes
    this.cider = new Prop(this.scene, PROPS.cider, V3(0, -40, -5), 0);
    this.cider.pooled = true; this.cider.bank(); props.push(this.cider);
  }
  get pressAt() { return this.press ? v2.set(this.press.x, this.press.y + 1.2, this.press.z) : null; }

  /** Instance matrices of a tree (+ its fruit, hidden once it's empty), leaning `tilt` toward the wiggle direction. */
  private place(t: Tree, tilt: number) {
    q1.setFromAxisAngle(UP, t.yaw);
    if (tilt) { v1.set(t.wigZ, 0, -t.wigX).normalize(); q2.setFromAxisAngle(v1, tilt); q1.premultiply(q2); }
    m1.compose(v1.set(t.x, t.y, t.z), q1, v2.setScalar(t.s));
    t.im.setMatrixAt(t.slot, m1); t.im.instanceMatrix.needsUpdate = true;
    t.fim.setMatrixAt(t.slot, t.fruit > 0 ? m1 : ZERO); t.fim.instanceMatrix.needsUpdate = true;
  }

  /** A hoof / headbutt / weapon / bash lands near a trunk. */
  private punch(hx: number, _hy: number, hz: number, reach: number, dir: THREE.Vector3, k: number, by: Pig) {
    let best: Tree | null = null, bd = reach * 0.85 + 0.3;
    for (const t of this.trees) { const d = Math.hypot(t.x - hx, t.z - hz) - 0.3 * t.s; if (d < bd) { bd = d; best = t; } }
    if (!best) return false;
    this.shake(best, dir, by, Math.min(1, k + 0.2));
    return true;
  }

  /** Host: the tree shakes; apples fall if it has any left. */
  shake(t: Tree, dir: THREE.Vector3, by: Pig | null, k: number) {
    if (G.net === 'client' || G.time - t.lastHit < 0.35) return;
    t.lastHit = G.time;
    const at = v1.set(t.x, t.y + 2.4 * t.s, t.z);
    G.audio.play('rustle', { pos: at, vol: 1, pitch: 0.8 + Math.random() * 0.2 });
    G.audio.play('wood', { pos: at, vol: 0.6, pitch: 0.7 });
    G.fx.bits(at, { count: 14, color: 0x5cb83d, spread: 1.2, speed: 1.5, up: 0.5, grav: 3, life: 1.4, size: 0.12, grow: 0, drag: 1.5, alpha: 1 });
    G.noise(at, ORCHARD.noise * k);
    if (by) G.shakeFor(by, 0.25);
    G.events.push({ type: 'treeShake', text: String(t.i), why: `${Math.round(dir.x * 100) / 100},${Math.round(dir.z * 100) / 100}` });
    if (t.fruit <= 0) return;
    const n = t.gold ? 1 : Math.min(t.fruit, ORCHARD.perShake + (k >= 1 && Math.random() < 0.5 ? 1 : 0));
    t.fruit -= n;
    for (let i = 0; i < n; i++) this.drop(t);
    if (!t.shook) { t.shook = true; G.events.push({ type: 'treeShaken', who: by ?? undefined }); }
  }

  /** An apple falls out of the canopy (the oldest lying apple is recycled when the pool runs out). */
  private drop(t: Tree) {
    let p = t.gold ? this.gold : this.apples.find((a) => a.banked && !a.smashed) ?? this.apples.find((a) => a.banked);
    if (!p) {
      p = this.dropped.find((a) => !a.heldBy && !a.banked) ?? null;
      if (!p) return;
    }
    const a = Math.random() * Math.PI * 2, r = (0.5 + Math.random() * 0.8) * t.s;
    v1.set(t.x + Math.cos(a) * r, t.y, t.z + Math.sin(a) * r);
    p.unbank(v1, Math.random() * 6.28);
    p.body.setTranslation({ x: v1.x, y: t.y + (2.2 + Math.random() * 0.6) * t.s, z: v1.z }, true);
    p.body.setLinvel({ x: Math.cos(a) * 0.8, y: 0.5 + Math.random(), z: Math.sin(a) * 0.8 }, true);
    p.synced.capture(); p.synced.capture();
    this.dropped = this.dropped.filter((x) => x !== p); this.dropped.push(p);
  }

  /** Host, every fixed step: apples dropped in the press hopper get squeezed. */
  step() {
    const pr = this.press;
    if (!pr) return;
    for (const a of this.apples) {
      if (a.banked || a.heldBy) continue;
      const p = a.synced.currP;
      if (Math.hypot(p.x - pr.x, p.z - pr.z) > ORCHARD.hopperR || p.y > pr.y + 1.05 || p.y < pr.y + 0.3) continue;
      a.bank();
      this.pressed++;
      G.events.push({ type: 'pressed', why: String(this.pressed) });
      G.audio.play('squish', { pos: p, vol: 0.9 });
      G.audio.play('creak', { pos: p, vol: 0.5, pitch: 1.2 });
      G.fx.bits(v1.set(pr.x, pr.y + 0.8, pr.z), { count: 12, color: 0xf2c25a, speed: 2, up: 2.5, grav: 9, life: 0.6, size: 0.1, grow: 0, alpha: 1 });
      G.noise(p, 7);
      if (this.pressed === ORCHARD.press && this.cider?.banked) this.cider.unbank(v1.set(pr.x + 1.4, pr.y, pr.z + 0.6), 0);
    }
  }

  /** Every frame (all browsers): trees wiggle after a shake, the press screw turns. */
  render(dt: number) {
    for (const t of this.trees) {
      const e = G.time - t.wigT;
      if (e < 0 || e > 1.4) { if (t.wigT > 0) { t.wigT = -10; this.place(t, 0); } continue; }
      this.place(t, Math.sin(e * 16) * 0.09 * Math.exp(-e * 3.2));
    }
    const pr = this.press;
    if (pr && pr.spinT > 0) { pr.spinT -= dt; pr.screw.rotation.y += dt * 5; pr.screw.position.y = 1.55 - Math.sin(Math.min(1, pr.spinT) * Math.PI) * 0.12; }
    // fruit left on each tree (players get it as a string)
    const key = this.fruitKey;
    if (G.net === 'client' && key) for (let i = 0; i < this.trees.length; i++) {
      const f = Number(key[i] ?? '0');
      if (f !== this.trees[i].fruit) { this.trees[i].fruit = f; this.place(this.trees[i], 0); }
    }
  }
  /** Event (all browsers): a tree was shaken → wiggle it; the press squeezed → turn the screw. */
  onEvent(type: string, text = '', why = '') {
    if (type === 'treeShake') {
      const t = this.trees[Number(text)]; if (!t) return;
      const [dx, dz] = why.split(',').map(Number);
      t.wigT = G.time; t.wigX = dx || 1; t.wigZ = dz || 0;
      if (G.net !== 'client') this.place(t, 0);
    }
    if (type === 'pressed' && this.press) this.press.spinT = 1.2;
  }

  /** New round: full trees, apples back in the pool, an empty press. */
  reset() {
    for (const t of this.trees) { t.fruit = t.gold ? 1 : ORCHARD.fruit; t.shook = false; t.wigT = -10; this.place(t, 0); }
    this.pressed = 0; this.dropped = [];
  }

  /** Admin: the nearest tree to a point. */
  nearest(p: THREE.Vector3) { return this.trees.slice().sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0]; }

  // network: fruit per tree as one digit each + apples pressed
  netState(n: number[], s: string[]) { n.push(this.pressed); s.push(this.trees.map((t) => Math.max(0, Math.min(9, t.fruit))).join('')); }
  netApply(n: number[], s: string[]) { if (n.length) this.pressed = n[0]; if (s[0] !== undefined) this.fruitKey = s[0]; }
}

