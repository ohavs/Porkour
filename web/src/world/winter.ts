import * as THREE from 'three';
import { RAPIER, world, groups, L, owners } from '../core/physics';
import { G } from '../game/ctx';
import { toonMat } from '../render/toon';
import { rigidSkin } from '../render/batch';
import { clamp } from '../core/util';
import { makeSnowman, SNOWMAN } from './funProps';
import type { Prop } from './props';
import type { Pig } from '../pig/pig';
import type { BobJob } from '../farmer/farmer';
import type { Spot } from './pumpkins';

/**
 * Farm 5 — the winter farm (host-authoritative, synced as one entity).
 *
 * ICE: the frozen pond (and frozen puddles) — hooves and boots slide, and Bob going down hard when he hurries across it.
 * Bob's ice-fishing hole: whatever slides in sinks (a prank), a pig that falls in pops out soaked, Bob goes for a dip.
 * FOOTPRINTS: every pig leaves hoofprints in the snow (not on the shovelled paths or the ice). They fill in after a
 * while — but if Bob spots a fresh trail he follows it to where it ends.
 * SNOWBALLS: piles of them to grab and throw (a hit on Bob counts for the pranks); the piles fill up again. A rolling
 * snowball GROWS as it rolls over fresh snow — roll one big enough and it bowls Bob over.
 * BOB'S PRIZE SNOWMAN: knock it over (headbutt, punch, ram, throw something, a big snowball) — the balls roll off,
 * and Bob comes and builds it again when he notices.
 */
export const WINTER = {
  /** Ice: the top of the slab above the ground, its friction (props slide). */
  iceTop: 0.06, iceFriction: 0.03,
  /** Hoofprints every this many metres, Bob's boots every …, how long they stay in the snow. */
  printStep: 0.55, bootStep: 0.8, printLife: 55,
  /** Bob follows a trail younger than this, that he sees within this range (less at night), not when it ends this close. */
  followAge: 30, followSee: 15, followSeeNight: 8, followMin: 6, followAgain: 25,
  /** Rolling snowballs: growth per metre rolled on snow, start / max radius, mass at the start (× (r/r0)³, capped). */
  ballGrow: 0.028, ballR0: 0.42, ballMax: 1.25, ballMass: 10, ballMassMax: 170,
  /** A snowball pile refills a used snowball after this long. */
  restock: 7,
  /** Snowman: a thrown thing faster than this knocks it over; Bob rebuilds it after he's seen it down this long. */
  snowmanHit: 4.2, rebuildAfter: 4, rebuildTime: 6, bobNotice: 28,
  /** The ice-fishing hole. */
  holeR: 0.75,
};

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), m1 = new THREE.Matrix4(), q1 = new THREE.Quaternion(), s1 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const c1 = new THREE.Color();
const PRINT = new THREE.Color(0x93a8c8), SNOWC = new THREE.Color(0xe8eff9);
const MAXP = 1100;

interface Rink { x: number; z: number; r: number; y: number }
interface Print { x: number; z: number; yaw: number; t: number; who: number; sx: number; sz: number }
interface Boulder { p: Prop; r: number; set: number; markD: number; last: THREE.Vector3 }

function iceTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(128, 128, 20, 128, 128, 128);
  g.addColorStop(0, '#d7ecff'); g.addColorStop(0.75, '#c3e1fb'); g.addColorStop(1, '#eef7ff');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  // skate scratches + a few cracks
  for (let i = 0; i < 70; i++) {
    x.strokeStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.35})`; x.lineWidth = 0.6 + Math.random();
    const a = Math.random() * 6.28, r = 20 + Math.random() * 90, cx = 128 + Math.cos(a) * r * 0.5, cy = 128 + Math.sin(a) * r * 0.5;
    x.beginPath(); x.arc(cx, cy, 20 + Math.random() * 60, a, a + 0.4 + Math.random() * 0.8); x.stroke();
  }
  for (let i = 0; i < 6; i++) {
    x.strokeStyle = 'rgba(120,160,200,0.35)'; x.lineWidth = 1;
    let px = 40 + Math.random() * 176, py = 40 + Math.random() * 176;
    x.beginPath(); x.moveTo(px, py);
    for (let k = 0; k < 5; k++) { px += (Math.random() - 0.5) * 40; py += (Math.random() - 0.5) * 40; x.lineTo(px, py); }
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Winter {
  rinks: Rink[] = [];
  hole: { x: number; z: number; y: number } | null = null;
  boulders: Boulder[] = [];
  piles: { x: number; z: number; y: number; props: Prop[] }[] = [];
  snowman: { x: number; z: number; y: number; yaw: number; up: boolean; downAt: number; vis: THREE.Object3D; body: RAPIER.RigidBody; parts: Prop[]; spot: Spot } | null = null;
  /** Round arrows: the ice-fishing hole. */
  holeSpot: Spot | null = null;
  private prints: Print[] = [];
  private pi = 0;
  private printMesh: THREE.InstancedMesh;
  private dirty = true; private colorT = 0;
  /** Per pig (index; −1 = Bob): where its last print was. */
  private lastAt = new Map<number, THREE.Vector3>();
  /** Per pig: its newest print (the trail's end) + when Bob last followed one of its trails. */
  private trailEnd = new Map<Pig, Print>();
  private followed = new Map<Pig, number>();
  private smashedAt = new Map<Prop, number>();
  private dunkAt = new Map<unknown, number>();

  constructor(private scene: THREE.Scene, private y: (x: number, z: number) => number) {
    G.snowy = true;
    G.iceAt = (x, z) => this.iceAt(x, z);
    G.clues.push({ spot: (bob: BobLike) => this.clueFor(bob) });
    G.jobs.push({ spot: (bob: BobLike) => this.jobFor(bob) });
    G.hittables.push({ hit: (hx, hy, hz, reach, dir, _k, by) => this.punch(hx, hy, hz, reach, dir, by as Pig | null) });
    // footprints: one instanced flat oval, recoloured as they fill in
    const geo = new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2);
    const mat = toonMat(0xffffff, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.printMesh = new THREE.InstancedMesh(geo, mat, MAXP);
    this.printMesh.frustumCulled = false; this.printMesh.receiveShadow = true;
    m1.makeScale(0, 0, 0);
    for (let i = 0; i < MAXP; i++) { this.printMesh.setMatrixAt(i, m1); this.printMesh.setColorAt(i, PRINT); }
    scene.add(this.printMesh);
  }

  // ================================================================== build (farm 5)
  /** A frozen pond / puddle on ground the farm flattened (Terrain.flatten) before the terrain was built. */
  addRink(x: number, z: number, r: number, statics: THREE.Object3D[]) {
    const y = this.y(x, z) + WINTER.iceTop;
    this.rinks.push({ x, z, r, y });
    const ice = new THREE.Mesh(new THREE.CircleGeometry(r + 0.25, 56).rotateX(-Math.PI / 2),
      toonMat(0xffffff, { map: iceTexture(), polygonOffset: true, polygonOffsetFactor: -1 }));
    ice.position.set(x, y, z); ice.receiveShadow = true; ice.name = 'ice';
    this.scene.add(ice);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y - 0.05, z));
    world.createCollider(RAPIER.ColliderDesc.cylinder(0.05, r).setFriction(WINTER.iceFriction).setCollisionGroups(groups(L.STATIC)), body);
    // a bank of snow lumps around the edge
    const lump = new THREE.IcosahedronGeometry(1, 1), snow = toonMat(0xf3f7ff);
    const n = Math.round(r * 5);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.2, d = r + 0.35 + Math.random() * 0.25, s = 0.28 + Math.random() * 0.22;
      const m = new THREE.Mesh(lump, snow);
      m.position.set(x + Math.cos(a) * d, this.y(x + Math.cos(a) * d, z + Math.sin(a) * d) - 0.05, z + Math.sin(a) * d);
      m.scale.set(s * 1.6, s * 0.7, s * 1.3); m.rotation.y = -a;
      m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m); statics.push(m);
    }
  }
  /** Bob's ice-fishing hole (on a rink). */
  addHole(x: number, z: number) {
    const rink = this.rinks.find((r) => Math.hypot(x - r.x, z - r.z) < r.r);
    const y = rink?.y ?? this.y(x, z) + WINTER.iceTop;
    this.hole = { x, z, y };
    this.holeSpot = { kind: 'spot', markPos: new THREE.Vector3(x, y + 0.4, z), heldBy: null };
    const g = new THREE.Group(); g.position.set(x, y, z); this.scene.add(g);
    const water = new THREE.Mesh(new THREE.CircleGeometry(WINTER.holeR, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1a4466, polygonOffset: true, polygonOffsetFactor: -3 }));
    water.position.y = 0.01; g.add(water);
    const chunk = new THREE.BoxGeometry(1, 1, 1), ice = toonMat(0xdff0ff);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2, m = new THREE.Mesh(chunk, ice);
      m.position.set(Math.cos(a) * (WINTER.holeR + 0.08), 0.03, Math.sin(a) * (WINTER.holeR + 0.08));
      m.scale.set(0.22 + Math.random() * 0.12, 0.07 + Math.random() * 0.05, 0.14); m.rotation.set(Math.random() * 0.3, -a, Math.random() * 0.3);
      m.castShadow = true; g.add(m);
    }
  }
  /** A pile of snowballs (the props sit on it; used ones come back after a while). */
  addPile(x: number, z: number, props: Prop[], statics: THREE.Object3D[]) {
    const y = this.y(x, z);
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), toonMat(0xf3f7ff));
    m.position.set(x, y - 0.12, z); m.scale.set(0.85, 0.42, 0.75); m.castShadow = true; m.receiveShadow = true;
    this.scene.add(m); statics.push(m);
    this.piles.push({ x, z, y, props });
  }
  addBoulder(p: Prop) { this.boulders.push({ p, r: WINTER.ballR0, set: WINTER.ballR0, markD: 0, last: new THREE.Vector3().copy(p.synced.currP) }); }
  /** Bob's prize snowman + its three balls (pooled props, hidden until it's knocked over). */
  addSnowman(x: number, z: number, yaw: number, parts: Prop[]) {
    const y = this.y(x, z);
    const vis = makeSnowman();
    vis.position.set(x, y - 0.06, z); vis.rotation.y = yaw;
    this.scene.add(vis);
    rigidSkin(vis);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y + 1.1, z));
    const c = world.createCollider(RAPIER.ColliderDesc.capsule(0.55, 0.58).setCollisionGroups(groups(L.STATIC)), body);
    owners.set(c.handle, {
      kind: 'snowman',
      onRam: (by: Pig, dir: THREE.Vector3) => this.topple(dir, by),
      onImpact: (p: Prop) => {
        const sp = p.synced.preVel.length();
        if (sp > WINTER.snowmanHit || (p.def.id === 'snowboulder' && sp > 1.6)) this.topple(v1.copy(p.synced.preVel).setY(0), null);
      },
    });
    for (const p of parts) { p.pooled = true; p.bank(); }
    this.snowman = { x, z, y, yaw, up: true, downAt: -10, vis, body, parts, spot: { kind: 'spot', markPos: new THREE.Vector3(x, y + 2.9, z), heldBy: null } };
  }

  // ================================================================== queries
  iceAt(x: number, z: number) {
    for (const r of this.rinks) if ((x - r.x) ** 2 + (z - r.z) ** 2 < (r.r - 0.1) ** 2) return true;
    return false;
  }
  /** Fresh snow here (not a shovelled path / the yard, not ice, not mud)? */
  snowAt(x: number, z: number) {
    const t = G.terrain;
    return t.dirtAt(x, z) < 0.3 && t.mudAt(x, z) < 0.2 && !this.iceAt(x, z) && t.inFarm(x, z, 1);
  }

  // ================================================================== snowman
  topple(dir: THREE.Vector3, by: Pig | null) {
    const s = this.snowman;
    if (G.net === 'client' || !s || !s.up) return;
    s.up = false; s.downAt = G.time;
    s.vis.visible = false; s.body.setEnabled(false);
    const d = Math.hypot(dir.x, dir.z) > 0.01 ? v2.set(dir.x, 0, dir.z).normalize() : v2.set(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    const at = [SNOWMAN.yBase, SNOWMAN.yMid, SNOWMAN.yHead], push = [1.2, 2.6, 4.2];
    s.parts.forEach((p, i) => {
      if (p.heldBy) p.heldBy.release?.(false);
      p.unbank(v1.set(s.x, s.y, s.z), s.yaw);
      p.body.setTranslation({ x: s.x + d.x * 0.1 * i, y: s.y + at[i] + 0.05, z: s.z + d.z * 0.1 * i }, true);
      p.body.setLinvel({ x: d.x * push[i], y: i * 1.2, z: d.z * push[i] }, true);
      p.body.setAngvel({ x: d.z * 3, y: 0, z: -d.x * 3 }, true);
      p.synced.capture(); p.synced.capture();
    });
    const c = v1.set(s.x, s.y + 1.4, s.z);
    G.audio.play('snowhit', { pos: c, vol: 1, pitch: 0.6 }); G.audio.play('thud', { pos: c, vol: 0.7, pitch: 0.7 });
    G.fx.puff(c, { count: 18, color: 0xffffff, speed: 2.4, up: 1.2, life: 1.2, size: 0.9, alpha: 0.85 });
    G.fx.bits(c, { count: 24, color: 0xf4f8ff, speed: 4, up: 3, grav: 10, life: 0.9, size: 0.1, grow: 0, alpha: 1 });
    G.noise(c, 12);
    G.events.push({ type: 'snowmanDown', who: by ?? undefined });
  }
  rebuild(quiet = false) {
    const s = this.snowman;
    if (!s || (s.up && !quiet)) return;
    for (const p of s.parts) { if (p.heldBy) p.heldBy.release?.(false); p.bank(); p.putHome(); }
    s.up = true; s.vis.visible = true; s.body.setEnabled(true);
    if (quiet) return;
    const c = v1.set(s.x, s.y + 1.2, s.z);
    G.fx.puff(c, { count: 14, color: 0xffffff, speed: 1.5, up: 1, life: 1, size: 0.8, alpha: 0.8 });
    G.audio.play('snowstep', { pos: c, vol: 0.8 });
    G.events.push({ type: 'snowmanUp' });
  }
  private jobFor(bob: BobLike): BobJob | null {
    const s = this.snowman;
    if (!s || s.up || G.time - s.downAt < WINTER.rebuildAfter) return null;
    if (!bob.looksAt(v1.set(s.x, s.y + 1, s.z), WINTER.bobNotice)) return null;
    return this.jobOf(bob.pos);
  }
  jobOf(from: THREE.Vector3): BobJob | null {
    const s = this.snowman; if (!s) return null;
    const dx = from.x - s.x, dz = from.z - s.z, d = Math.hypot(dx, dz) || 1;
    return {
      at: new THREE.Vector3(s.x + (dx / d) * 1.4, s.y, s.z + (dz / d) * 1.4), look: new THREE.Vector3(s.x, s.y + 1, s.z),
      dur: WINTER.rebuildTime, activity: 'bob.snowman',
      still: () => !s.up, done: () => this.rebuild(),
    };
  }
  /** A hoof / headbutt / weapon near the snowman knocks it over. */
  private punch(hx: number, hy: number, hz: number, reach: number, dir: THREE.Vector3, by: Pig | null) {
    const s = this.snowman;
    if (!s || !s.up || Math.hypot(s.x - hx, s.z - hz) > reach * 0.85 + 0.7 || hy - s.y > 2.6) return false;
    this.topple(dir, by);
    return true;
  }

  // ================================================================== footprints (every browser, fixed step)
  private addPrint(x: number, z: number, yaw: number, who: number, sx: number, sz: number) {
    const p: Print = { x, z, yaw, t: G.time, who, sx, sz };
    const i = this.pi; this.pi = (this.pi + 1) % MAXP;
    this.prints[i] = p;
    q1.setFromAxisAngle(UP, yaw);
    m1.compose(v1.set(x, this.y(x, z) + 0.03, z), q1, s1.set(sx, 1, sz));
    this.printMesh.setMatrixAt(i, m1); this.printMesh.setColorAt(i, PRINT);
    this.dirty = true;
    return p;
  }
  stepAll() {
    const pigs = G.pigs as Pig[];
    pigs.forEach((pig, i) => {
      if (pig.out || pig.absent || pig.cage || pig.heldBy || pig.mode === 'ragdoll' || pig.mode === 'held') { this.lastAt.delete(i); return; }
      const ground = this.y(pig.pos.x, pig.pos.z);
      if (pig.pos.y - ground > 1.05 || !this.snowAt(pig.pos.x, pig.pos.z)) { this.lastAt.delete(i); return; }
      const last = this.lastAt.get(i);
      if (!last) { this.lastAt.set(i, pig.pos.clone()); return; }
      if (Math.hypot(pig.pos.x - last.x, pig.pos.z - last.z) < WINTER.printStep) return;
      const yaw = Math.atan2(pig.pos.x - last.x, pig.pos.z - last.z), cx = Math.cos(yaw), sz = Math.sin(yaw);
      const w = pig.standing ? 0.09 : 0.11;
      this.addPrint(pig.pos.x + cx * w, pig.pos.z - sz * w, yaw, i, 0.055, 0.08);
      const p = this.addPrint(pig.pos.x - cx * w, pig.pos.z + sz * w, yaw, i, 0.055, 0.08);
      this.trailEnd.set(pig, p);
      last.copy(pig.pos);
    });
    // Bob's boots
    const f = G.farmer;
    if (f && f.visual?.root?.visible !== false && f.state !== 'down' && f.state !== 'sleep' && f.state !== 'away' && !f.riding && this.snowAt(f.pos.x, f.pos.z)) {
      const last = this.lastAt.get(-1);
      if (!last) this.lastAt.set(-1, f.pos.clone());
      else if (Math.hypot(f.pos.x - last.x, f.pos.z - last.z) > WINTER.bootStep) {
        const yaw = Math.atan2(f.pos.x - last.x, f.pos.z - last.z), side = (this.pi % 2 ? 1 : -1) * 0.13;
        this.addPrint(f.pos.x + Math.cos(yaw) * side, f.pos.z - Math.sin(yaw) * side, yaw, -1, 0.1, 0.17);
        last.copy(f.pos);
      }
    } else this.lastAt.delete(-1);
    // rolling snowballs: a groove in the snow
    for (const b of this.boulders) {
      if (b.p.banked) continue;
      const p = b.p.synced.currP;
      const d = Math.hypot(p.x - b.last.x, p.z - b.last.z);
      if (d > 3) { b.last.copy(p); continue; }
      b.markD += d; b.last.copy(p);
      if (b.markD < 0.4 || p.y - this.y(p.x, p.z) > b.r + 0.15 || !this.snowAt(p.x, p.z)) { if (b.markD >= 0.4) b.markD = 0; continue; }
      b.markD = 0;
      const lv = b.p.body.linvel();
      this.addPrint(p.x, p.z, Math.atan2(lv.x, lv.z), -2, b.r * 0.55, 0.32);
    }
  }

  /** Bob (host): a fresh trail he can see → the place it ends. */
  private clueFor(bob: BobLike): THREE.Vector3 | null {
    if (!this.prints.length) return null;
    const night = G.night > 0.5, see = night ? WINTER.followSeeNight : WINTER.followSee;
    const stash = G.places?.stash;
    for (const pig of G.pigs as Pig[]) {
      const end = this.trailEnd.get(pig);
      if (!end || pig.out || pig.cage || G.time - end.t > WINTER.followAge) continue;
      if (G.time - (this.followed.get(pig) ?? -99) < WINTER.followAgain) continue;
      if (Math.hypot(end.x - bob.pos.x, end.z - bob.pos.z) < WINTER.followMin) continue;
      if (stash && Math.hypot(end.x - stash.x, end.z - stash.z) < 7) continue;   // pigs in the sty: nothing odd
      const pi = (G.pigs as Pig[]).indexOf(pig);
      // the nearest of its fresh prints in front of him
      let best: Print | null = null, bd = see;
      const fx = Math.sin(bob.yaw), fz = Math.cos(bob.yaw);
      for (const p of this.prints) {
        if (!p || p.who !== pi || G.time - p.t > WINTER.followAge) continue;
        const dx = p.x - bob.pos.x, dz = p.z - bob.pos.z, d = Math.hypot(dx, dz);
        if (d >= bd || (dx * fx + dz * fz) / Math.max(d, 0.01) < 0.35) continue;
        best = p; bd = d;
      }
      if (!best || !bob.looksAt(v1.set(best.x, this.y(best.x, best.z) + 0.1, best.z), see)) continue;
      this.followed.set(pig, G.time);
      return new THREE.Vector3(end.x, this.y(end.x, end.z), end.z);
    }
    return null;
  }

  // ================================================================== host step
  stepHost(dt: number) {
    const now = G.time;
    // snowball piles fill up again
    for (const pile of this.piles) pile.props.forEach((p, i) => {
      if (!p.banked || !p.smashed) { this.smashedAt.delete(p); return; }
      const at = this.smashedAt.get(p);
      if (at === undefined) { this.smashedAt.set(p, now); return; }
      if (now - at < WINTER.restock) return;
      this.smashedAt.delete(p);
      const a = (i / pile.props.length) * Math.PI * 2;
      p.unbank(v1.set(pile.x + Math.cos(a) * 0.32, pile.y + 0.12, pile.z + Math.sin(a) * 0.28), 0);
    });
    // rolling snowballs grow on fresh snow
    for (const b of this.boulders) {
      if (b.p.banked || b.r >= WINTER.ballMax) continue;
      const p = b.p.body.translation(), lv = b.p.body.linvel(), sp = Math.hypot(lv.x, lv.z);
      if (sp < 0.4 || p.y - this.y(p.x, p.z) > b.r + 0.12 || !this.snowAt(p.x, p.z)) continue;
      b.r = Math.min(WINTER.ballMax, b.r + sp * dt * WINTER.ballGrow);
      if (b.r - b.set > 0.01) this.setRadius(b, b.r);
      if (Math.random() < dt * sp * 1.5) G.fx.bits(v1.set(p.x, p.y - b.r * 0.8, p.z), { count: 2, color: 0xffffff, speed: 1.2, up: 1.5, grav: 8, life: 0.5, size: 0.08, grow: 0, alpha: 1 });
    }
    // the ice-fishing hole: things slide in and sink, pigs fall in and pop out, Bob takes a dip
    const h = this.hole;
    if (h) {
      const R = WINTER.holeR;
      for (const pr of G.props as Prop[]) {
        if (pr.banked || pr.heldBy) continue;
        const p = pr.synced.currP;
        if ((p.x - h.x) ** 2 + (p.z - h.z) ** 2 > (R * 0.85) ** 2 || p.y > h.y + 0.9) continue;
        if (pr.def.id === 'snowboulder' && pr.radius > R) continue;   // too big: it rolls over the hole
        this.sink(pr);
      }
      for (const pig of G.pigs as Pig[]) {
        if (pig.out || pig.cage || pig.heldBy || now < (this.dunkAt.get(pig) ?? 0)) continue;
        if ((pig.pos.x - h.x) ** 2 + (pig.pos.z - h.z) ** 2 > (R * 0.8) ** 2 || pig.pos.y > h.y + 1.2) continue;
        this.dunkAt.set(pig, now + 3);
        if (pig.held) pig.release(false);
        pig.muddyUntil = now;   // the dip washes the snow coat off
        const out = v2.set(pig.pos.x - h.x, 0, pig.pos.z - h.z); if (out.lengthSq() < 0.01) out.set(1, 0, 0);
        out.normalize();
        pig.knock(v1.set(out.x * 5, 8, out.z * 5), true);
        this.splash(pig.pos);
        G.events.push({ type: 'pigDunked', who: pig });
      }
      const f = G.farmer;
      if (f && (f.pos.x - h.x) ** 2 + (f.pos.z - h.z) ** 2 < (R * 0.8) ** 2 && f.pos.y < h.y + 0.6 && f.dunked()) this.splash(f.pos);
    }
  }
  private sink(pr: Prop) {
    const p = v1.copy(pr.synced.currP);
    pr.bank();
    if (pr.def.id === 'snowball') pr.smashed = true;   // the pile makes a new one
    this.splash(p);
    G.events.push({ type: 'iceHole', text: pr.def.id ?? '' });
  }
  private splash(at: THREE.Vector3) {
    G.audio.play('splash', { pos: at, vol: 1 });
    G.audio.play('icecrack', { pos: at, vol: 0.5, pitch: 1.2 });
    G.fx.bits(v2.copy(at).setY(at.y + 0.2), { count: 22, color: 0xbfe3ff, speed: 3.5, up: 4, grav: 12, life: 0.8, size: 0.09, grow: 0, alpha: 1 });
    G.noise(at, 9);
  }
  private setRadius(b: Boulder, r: number) {
    b.set = r;
    const k = r / WINTER.ballR0, c = b.p.body.collider(0);
    c.setRadius(r);
    const mass = Math.min(WINTER.ballMassMax, WINTER.ballMass * k * k * k);
    c.setMass(mass);
    b.p.mass = mass; b.p.radius = r; b.p.half = r;
    b.p.obj.scale.setScalar(k);
  }

  // ================================================================== every browser
  render(dt: number) {
    // prints fill in with snow: fade toward the snow colour, then gone
    this.colorT -= dt;
    if (this.colorT <= 0) {
      this.colorT = 0.25;
      this.prints.forEach((p, i) => {
        if (!p) return;
        const a = (G.time - p.t) / WINTER.printLife;
        if (a >= 1) { m1.makeScale(0, 0, 0); this.printMesh.setMatrixAt(i, m1); (this.prints as (Print | undefined)[])[i] = undefined; return; }
        this.printMesh.setColorAt(i, c1.copy(PRINT).lerp(SNOWC, clamp(a * a * 1.2, 0, 1)));
      });
      this.dirty = true;
    }
    if (this.dirty) {
      this.dirty = false;
      this.printMesh.instanceMatrix.needsUpdate = true;
      if (this.printMesh.instanceColor) this.printMesh.instanceColor.needsUpdate = true;
    }
  }
  onEvent(type: string) {
    const s = this.snowman; if (!s || G.net !== 'client') return;
    if (type === 'snowmanDown') { s.up = false; s.vis.visible = false; s.body.setEnabled(false); }
    if (type === 'snowmanUp') { s.up = true; s.vis.visible = true; s.body.setEnabled(true); }
  }
  /** New round: snowman up, snowballs back to their start size. */
  reset() {
    this.rebuild(true);
    for (const b of this.boulders) { b.r = WINTER.ballR0; this.setRadius(b, b.r); }
    this.smashedAt.clear(); this.followed.clear(); this.trailEnd.clear(); this.dunkAt.clear();
  }
  /** Round arrows: the snowman while it stands. */
  snowmanSpots(): Spot[] { return this.snowman?.up ? [this.snowman.spot] : []; }
  nearestBoulder(p: THREE.Vector3) {
    let best: Boulder | null = null, bd = Infinity;
    for (const b of this.boulders) { const q = b.p.synced.currP, d = Math.hypot(q.x - p.x, q.z - p.z); if (d < bd) { bd = d; best = b; } }
    return best;
  }
  growBoulder(b: Boulder, r: number) { b.r = clamp(r, WINTER.ballR0, WINTER.ballMax); this.setRadius(b, b.r); }

  // network: snowman up + the rolling snowballs' radius
  netState(n: number[]) {
    n.push(this.snowman?.up === false ? 0 : 1);
    for (const b of this.boulders) n.push(Math.round(b.r * 100) / 100);
  }
  netApply(n: number[]) {
    if (!n.length) return;
    const s = this.snowman, up = n[0] === 1;
    if (s && s.up !== up) { s.up = up; s.vis.visible = up; s.body.setEnabled(up); }
    this.boulders.forEach((b, i) => { const r = n[1 + i]; if (r !== undefined && Math.abs(r - b.set) > 0.005) { b.r = r; this.setRadius(b, r); } });
  }
}

interface BobLike { pos: THREE.Vector3; yaw: number; looksAt(pt: THREE.Vector3, range?: number): boolean }
