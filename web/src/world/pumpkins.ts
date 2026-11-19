import * as THREE from 'three';
import { RAPIER, world, groups, L, owners } from '../core/physics';
import { fitted } from '../core/assets';
import { clamp, smoothstep, damp } from '../core/util';
import { G, type Holdable, type Cloud } from '../game/ctx';
import { toonMat } from '../render/toon';
import { rigidSkin } from '../render/batch';
import type { DayNight, Lamp } from './daynight';
import type { Prop } from './props';
import type { Pig } from '../pig/pig';
import type { BobJob } from '../farmer/farmer';
import { lever, type Handle } from './hands';

/**
 * Farm 4 — the pumpkin farm at night (host-authoritative, synced as one entity).
 *
 * JACK-O'-LANTERNS: carved pumpkins glow all over the farm and light a pool around them. In the dark Bob only sees
 * what his flashlight beam hits — but a pig standing in a lantern's light he sees like by day. Snuff them: headbutt /
 * punch / whack one, ram it, throw something at it, fart on it (or set off a cherry bomb next to it). Bob notices
 * a lantern that went dark, walks over and lights it again.
 *
 * THE CATAPULT ("pumpkin chunkin'"): whatever sits in its basket — a pumpkin, a hen, a pig — flies when someone hits
 * the frame. Ram it from the side to swing it round. Pointed roughly at Bob, the shot comes down right on him.
 */
export const PUMPKIN = {
  /** Lit pool radius (Bob sees a pig in it), the lantern light. */
  litR: 4.4, lightI: 7, lightD: 9,
  /** A fart / bang this far beyond its cloud blows a lantern out; Bob relights one that's been dark this long. */
  blowR: 1.0, relightAfter: 4, relightTime: 3.4, bobNotice: 30,
  // catapult
  zoneR: 1.1, maxMass: 60, reload: 2.8, swing: 0.3, release: 0.17, minD: 10, maxD: 46, defD: 30, assist: 0.62, rot: 0.32, noise: 24,
};

const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), m1 = new THREE.Matrix4(), q1 = new THREE.Quaternion(), s1 = new THREE.Vector3();
const v3 = new THREE.Vector3(), q3 = new THREE.Quaternion(), q2b = new THREE.Quaternion(), XA = new THREE.Vector3(1, 0, 0);
const c1 = new THREE.Color();
const LIT = new THREE.Color(2.4, 1.45, 0.42), OUT = new THREE.Color(0.06, 0.03, 0.015);
const GLOW = new THREE.Color(0.62, 0.32, 0.09);

/** Something the round can point an arrow at (markers.ts): a lantern, the catapult. */
export interface Spot { kind: 'spot'; markPos: THREE.Vector3; heldBy: null }

interface Lantern {
  i: number; x: number; y: number; z: number; yaw: number; h: number;
  lit: boolean; outAt: number; wobT: number; light: Lamp; spot: Spot;
}

/** The carved face of a KayKit jack-o'-lantern (the dark triangles of its texture atlas), ready to glow. */
function faceGeo(model: string, height: number): THREE.BufferGeometry | null {
  const o = fitted(model, { height });
  o.updateMatrixWorld(true);
  const pos: number[] = [];
  const a = new THREE.Vector3();
  o.traverse((m) => {
    const mesh = m as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry, P = g.attributes.position, U = g.attributes.uv;
    if (!U) return;
    const idx = g.index, n = idx ? idx.count : P.count;
    for (let t = 0; t + 2 < n; t += 3) {
      const ids = [0, 1, 2].map((k) => (idx ? idx.getX(t + k) : t + k));
      const u = (U.getX(ids[0]) + U.getX(ids[1]) + U.getX(ids[2])) / 3, v = (U.getY(ids[0]) + U.getY(ids[1]) + U.getY(ids[2])) / 3;
      if (u < 0.15 || u > 0.225 || v < 0.125 || v > 0.165) continue;
      for (const id of ids) { a.fromBufferAttribute(P as THREE.BufferAttribute, id).applyMatrix4(mesh.matrixWorld); pos.push(a.x, a.y, a.z); }
    }
  });
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return geo;
}

/** Soft warm circle on the ground (additive): shows where the light reaches. */
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.5)'); g.addColorStop(0.6, 'rgba(255,255,255,0.2)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Pumpkins {
  lanterns: Lantern[] = [];
  /** Lamps that are always on at night (the porch light…): lit pools too. */
  fixedLit: { x: number; z: number; r: number }[] = [];
  cat: Catapult | null = null;
  private faces: THREE.InstancedMesh | null = null;
  private pools: THREE.InstancedMesh | null = null;
  private seen = new WeakSet<Cloud>();
  private litKey = '';

  constructor(private scene: THREE.Scene, private daynight: DayNight, private y: (x: number, z: number) => number) {
    G.litAt = (x, z) => this.litAt(x, z);
    G.jobs.push({ spot: (bob: BobLike) => this.jobFor(bob) });
    G.hittables.push({ hit: (hx, hy, hz, reach, dir, k, by) => this.punch(hx, hy, hz, reach, dir, k, by as Pig) });
  }

  // ================================================================== build (farm 4)
  /** A jack-o'-lantern at (x, z), `lift` = standing on something (a hay bale, a post, the porch). The pumpkin itself is placed by the farm. */
  addLantern(x: number, z: number, yaw: number, h: number, lift = 0) {
    const y = this.y(x, z) + lift;
    const i = this.lanterns.length;
    const light = this.daynight.addLight(new THREE.Vector3(x, y + h + 0.7, z), PUMPKIN.lightI, PUMPKIN.lightD, 0xff8a2a);   // above it: lights the ground, doesn't burn out the pumpkin
    const l: Lantern = { i, x, y, z, yaw, h, lit: true, outAt: -10, wobT: -10, light, spot: { kind: 'spot', markPos: new THREE.Vector3(x, y + h, z), heldBy: null } };
    this.lanterns.push(l);
    G.flames.push({ r: 0.7, at: (o) => (l.lit ? o.set(l.x, l.y + l.h * 0.5, l.z) : null) });   // a fart next to a lit one = a fireball
    // collider: rams and thrown things find it
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y + h * 0.42, z));
    const c = world.createCollider(RAPIER.ColliderDesc.ball(h * 0.48).setCollisionGroups(groups(L.STATIC)), body);
    owners.set(c.handle, {
      kind: 'lantern',
      onRam: (by: Pig) => this.snuff(l, 'ram', by),
      onImpact: (p: Prop) => { if (p.synced.preVel.length() > 4) this.snuff(l, 'throw', null); },
    });
    return l;
  }
  /** After the last lantern: the glowing faces + light pools as two instanced meshes. */
  finishLanterns(model: string, h: number) {
    const n = this.lanterns.length;
    if (!n) return;
    const geo = faceGeo(model, h);
    if (geo) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      this.faces = new THREE.InstancedMesh(geo, mat, n);
      this.faces.frustumCulled = false;
      this.scene.add(this.faces);
    }
    const pm = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), pm, n);
    this.pools.renderOrder = 6; this.pools.frustumCulled = false;
    this.scene.add(this.pools);
    for (const l of this.lanterns) this.place(l, 0, 1);
  }
  buildCatapult(x: number, z: number, yaw: number) { this.cat = new Catapult(this.scene, x, z, yaw, this.y); return this.cat; }

  private place(l: Lantern, tilt: number, glow: number) {
    q1.setFromAxisAngle(UP, l.yaw);
    if (tilt) q1.premultiply(new THREE.Quaternion().setFromAxisAngle(v2.set(Math.cos(l.yaw), 0, -Math.sin(l.yaw)), tilt));
    if (this.faces) {
      m1.compose(v1.set(l.x, l.y - 0.02, l.z), q1, s1.setScalar(1));
      this.faces.setMatrixAt(l.i, m1);
      this.faces.setColorAt(l.i, c1.copy(OUT).lerp(LIT, glow));
    }
    if (this.pools) {
      const r = PUMPKIN.litR * 2 * Math.min(1, glow * 1.4);
      m1.compose(v1.set(l.x, this.y(l.x, l.z) + 0.07, l.z), q1.identity(), s1.set(r, 1, r));
      this.pools.setMatrixAt(l.i, m1);
      this.pools.setColorAt(l.i, c1.copy(GLOW).multiplyScalar(glow * smoothstep(0.15, 0.8, G.night)));
    }
  }

  // ================================================================== lit pools (Bob's sight)
  litAt(x: number, z: number) {
    if (G.night < 0.5) return false;
    for (const l of this.lanterns) if (l.lit && Math.hypot(x - l.x, z - l.z) < PUMPKIN.litR) return true;
    for (const f of this.fixedLit) if (Math.hypot(x - f.x, z - f.z) < f.r) return true;
    return false;
  }

  // ================================================================== snuff / relight (host)
  snuff(l: Lantern, how: string, by: Pig | null) {
    if (G.net === 'client' || !l.lit) return;
    l.lit = false; l.outAt = G.time; l.wobT = G.time;
    const at = v1.set(l.x, l.y + l.h * 0.8, l.z);
    G.audio.play('whoosh', { pos: at, vol: 0.7, pitch: 0.6 });
    G.fx.puff(at, { count: 10, color: 0x4a4a4a, speed: 0.6, up: 1.4, life: 1.6, size: 0.5, alpha: 0.55 });
    G.fx.bits(at, { count: 6, color: 0xffb347, speed: 1.5, up: 1.5, grav: 4, life: 0.5, size: 0.06, grow: 0, alpha: 1 });
    G.noise(at, how === 'fart' ? 4 : 7);
    G.events.push({ type: 'lanternOut', who: by ?? undefined, text: String(l.i), why: how });
  }
  relight(l: Lantern) {
    if (G.net === 'client' || l.lit) return;
    l.lit = true; l.wobT = G.time;
    const at = v1.set(l.x, l.y + l.h * 0.7, l.z);
    G.audio.play('fuse', { pos: at, vol: 0.5, pitch: 1.4 });
    G.audio.play('crackle', { pos: at, vol: 0.4 });
    G.fx.bits(at, { count: 8, color: 0xffd27a, speed: 1.2, up: 1.2, grav: 2, life: 0.6, size: 0.07, grow: 0, alpha: 1 });
    G.events.push({ type: 'lanternLit', text: String(l.i) });
  }
  /** A hoof / headbutt / weapon lands near a lit lantern (or the catapult's frame). */
  private punch(hx: number, hy: number, hz: number, reach: number, _dir: THREE.Vector3, _k: number, by: Pig) {
    let hit = false;
    for (const l of this.lanterns) {
      if (!l.lit || Math.hypot(l.x - hx, l.z - hz) > reach * 0.85 + l.h * 0.5 || Math.abs(hy - (l.y + l.h * 0.4)) > 1.3) continue;
      this.snuff(l, 'hit', by); hit = true;
    }
    if (this.cat?.hitBy(hx, hz, by)) hit = true;
    return hit;
  }
  /** Bob's farm job: the nearest lantern he can see that went dark a while ago. */
  private jobFor(bob: BobLike): BobJob | null {
    let best: Lantern | null = null, bd = PUMPKIN.bobNotice;
    for (const l of this.lanterns) {
      if (l.lit || G.time - l.outAt < PUMPKIN.relightAfter) continue;
      const d = Math.hypot(l.x - bob.pos.x, l.z - bob.pos.z);
      if (d >= bd || !bob.looksAt(v1.set(l.x, l.y + l.h * 0.5, l.z), PUMPKIN.bobNotice)) continue;
      best = l; bd = d;
    }
    return best ? this.jobOf(best, bob.pos) : null;
  }
  jobOf(l: Lantern, from: THREE.Vector3): BobJob {
    const dx = from.x - l.x, dz = from.z - l.z, d = Math.hypot(dx, dz) || 1;
    return {
      at: new THREE.Vector3(l.x + (dx / d) * 1.05, l.y, l.z + (dz / d) * 1.05), look: new THREE.Vector3(l.x, l.y, l.z),
      dur: PUMPKIN.relightTime, activity: 'bob.relight',
      still: () => !l.lit, done: () => this.relight(l),
    };
  }
  nearest(p: THREE.Vector3, lit?: boolean) {
    let best: Lantern | null = null, bd = Infinity;
    for (const l of this.lanterns) { if (lit !== undefined && l.lit !== lit) continue; const d = Math.hypot(l.x - p.x, l.z - p.z); if (d < bd) { bd = d; best = l; } }
    return best;
  }

  /** Host, every fixed step: farts / bangs blow lanterns out; the catapult lets go of its load. */
  stepHost() {
    for (const c of G.clouds) {
      if (this.seen.has(c)) continue;
      this.seen.add(c);
      let who: Pig | null = null;
      if (c.kind !== 'bang') { let bd = 4; for (const p of G.pigs as Pig[]) { const d = Math.hypot(p.pos.x - c.x, p.pos.z - c.z); if (d < bd) { bd = d; who = p; } } }
      for (const l of this.lanterns) {
        if (!l.lit || Math.hypot(l.x - c.x, l.z - c.z) > c.r + PUMPKIN.blowR || Math.abs(c.y - (l.y + l.h * 0.5)) > 2.5) continue;
        this.snuff(l, c.kind === 'bang' ? 'bang' : 'fart', who);
      }
    }
    this.cat?.step();
  }

  // ================================================================== all browsers
  render(dt: number) {
    // players: lit / out from the host's string
    if (G.net === 'client' && this.litKey) this.lanterns.forEach((l, i) => { const on = this.litKey[i] === '1'; if (on !== l.lit) { l.lit = on; l.wobT = G.time; } });
    const night = 0.35 + 0.65 * smoothstep(0.1, 0.7, G.night);
    for (const l of this.lanterns) {
      l.light.k = damp(l.light.k, l.lit ? 1 : 0, 9, dt);
      const e = G.time - l.wobT, wob = e >= 0 && e < 1.2 ? Math.sin(e * 18) * 0.22 * Math.exp(-e * 4) : 0;
      const flick = l.lit ? 0.92 + Math.sin(G.time * 11 + l.i * 2.3) * 0.05 + Math.sin(G.time * 23 + l.i) * 0.03 : 1;
      this.place(l, wob, l.light.k * flick * night);
    }
    if (this.faces) { this.faces.instanceMatrix.needsUpdate = true; if (this.faces.instanceColor) this.faces.instanceColor.needsUpdate = true; }
    if (this.pools) { this.pools.instanceMatrix.needsUpdate = true; if (this.pools.instanceColor) this.pools.instanceColor.needsUpdate = true; }
    this.cat?.render();
  }
  onEvent(type: string, text = '') {
    const l = this.lanterns[Number(text)];
    if (!l) return;
    if (type === 'lanternOut') { l.lit = false; l.wobT = G.time; }
    if (type === 'lanternLit') { l.lit = true; l.wobT = G.time; }
  }

  /** New round: every lantern lit, the catapult cocked. */
  reset() {
    for (const l of this.lanterns) { l.lit = true; l.outAt = -10; }
    this.cat?.reset();
  }

  /** Round arrows: the lanterns still lit (prank "snuff them"). */
  litSpots(): Spot[] { return this.lanterns.filter((l) => l.lit).map((l) => l.spot); }

  // network: catapult (yaw, last shot) + which lanterns are lit
  netState(n: number[], s: string[]) {
    n.push(this.cat ? Math.round(this.cat.yaw * 1000) / 1000 : 0, this.cat ? Math.round(this.cat.fireT * 100) / 100 : -10, this.cat ? Math.round(this.cat.release.v * 100) / 100 : 0);
    s.push(this.lanterns.map((l) => (l.lit ? '1' : '0')).join(''));
  }
  netApply(n: number[], s: string[]) {
    if (n.length >= 2 && this.cat) { this.cat.setYaw(n[0]); this.cat.fireT = n[1]; if (n[2] !== undefined) this.cat.release.v = n[2]; }
    if (s[0] !== undefined) this.litKey = s[0];
  }
}

interface BobLike { pos: THREE.Vector3; looksAt(pt: THREE.Vector3, range?: number): boolean }

/** Arm angles (rotation about x of the arm pivot): cocked = basket on the ground behind, fired = flung up front. */
const COCKED = -0.52, FIRED = 2.3, ARM = 3.1, AXLE = new THREE.Vector3(0, 2.2, 0.4);

/**
 * A wooden catapult on wheels. Local frame: +z = where it throws. The basket sits on the ground behind the frame;
 * anything in it (props up to 60 kg, critters, pigs) flies when the frame is hit. Ram it from the side to turn it.
 */
export class Catapult {
  yaw: number;
  fireT = -10;
  spot: Spot;
  private g = new THREE.Group();
  private arm = new THREE.Group();
  private body: RAPIER.RigidBody;
  private launchAt = 0;
  private payload: Holdable[] = [];
  private by: Pig | null = null;
  private turnT = -10;
  private basketBody: RAPIER.RigidBody;
  /** The basket's colliders follow the arm (every browser: own pigs are predicted against it online). */
  private placeBasket(rx: number) {
    const q = q3.setFromAxisAngle(UP, this.yaw).multiply(q2b.setFromAxisAngle(XA, rx));
    const p = v3.copy(AXLE).applyAxisAngle(UP, this.yaw).add(v2.set(this.x, this.y0, this.z));
    this.basketBody.setTranslation(p, true); this.basketBody.setRotation(q, true);
    this.basketBody.setEnabled(rx < COCKED + 0.06);
  }
  /** The release lever: pull it back and it lets fly. */
  release: Handle; private leverG: THREE.Group;
  /** Shots in the air (host): does one come down on Bob? */
  private flying: { o: Holdable; until: number }[] = [];
  readonly y0: number;

  constructor(scene: THREE.Scene, public x: number, public z: number, yaw: number, private y: (x: number, z: number) => number) {
    this.yaw = yaw;
    this.y0 = y(x, z);
    const g = this.g; g.position.set(x, this.y0, z); g.rotation.y = yaw; scene.add(g);
    const wood = toonMat(0xa8743f), dark = toonMat(0x6e4524), iron = toonMat(0x55575c), red = toonMat(0xd8402e), rope = toonMat(0xd8c08a);
    const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, px: number, py: number, pz: number, parent: THREE.Object3D = g) => {
      const o = new THREE.Mesh(geo, m); o.position.set(px, py, pz); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
    };
    for (const s of [-1, 1]) {
      mesh(new THREE.BoxGeometry(0.24, 0.24, 4.6), wood, s * 0.75, 0.62, -0.6);                              // base beams
      for (const wz of [1.25, -2.45]) {                                                                          // wheels
        const w = mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.14, 14), dark, s * 0.9, 0.44, wz); w.rotation.z = Math.PI / 2;
        const hub = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.2, 8), iron, s * 0.92, 0.44, wz); hub.rotation.z = Math.PI / 2;
      }
      mesh(new THREE.BoxGeometry(0.2, 1.75, 0.2), wood, s * 0.75, 1.45, 0.4);                                 // upright
      const br = mesh(new THREE.BoxGeometry(0.14, 1.8, 0.14), dark, s * 0.75, 1.3, 1.05); br.rotation.x = -0.62;   // brace
    }
    for (const cz of [1.6, -0.6, -2.8]) mesh(new THREE.BoxGeometry(1.74, 0.2, 0.2), dark, 0, 0.66, cz);         // cross beams
    const ax = mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.8, 8), iron, AXLE.x, AXLE.y, AXLE.z); ax.rotation.z = Math.PI / 2;
    // the arm (a pivot: it becomes a bone and swings)
    this.arm.position.copy(AXLE); g.add(this.arm);
    mesh(new THREE.BoxGeometry(0.2, 0.22, ARM + 0.9), wood, 0, 0, -(ARM - 0.9) / 2, this.arm);
    mesh(new THREE.BoxGeometry(0.8, 0.72, 0.62), dark, 0, -0.42, 0.85, this.arm);                             // counterweight
    for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), rope, s * 0.32, -0.12, 0.85, this.arm);
    mesh(new THREE.CylinderGeometry(0.62, 0.4, 0.34, 14), wood, 0, 0.12, -ARM, this.arm);                     // the basket (a tub…
    mesh(new THREE.CylinderGeometry(0.54, 0.54, 0.04, 14), dark, 0, 0.27, -ARM, this.arm);                    // …with a dark inside)
    mesh(new THREE.TorusGeometry(0.62, 0.05, 6, 18), iron, 0, 0.29, -ARM, this.arm).rotation.x = Math.PI / 2;
    // the release lever (red handle) on the right side: grab it and pull it back (a pivot: it becomes a bone and moves)
    const lg = new THREE.Group(); lg.position.set(1.02, 0.62, -0.6); g.add(lg);
    mesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), dark, 0, 0.4, 0, lg);
    mesh(new THREE.SphereGeometry(0.11, 10, 8), red, 0, 0.8, 0, lg);
    this.leverG = lg;
    rigidSkin(g);
    this.release = lever({ pivot: new THREE.Vector3(1.02, 0.62, -0.6), axis: new THREE.Vector3(1, 0, 0), arm: new THREE.Vector3(0, 0.8, 0), min: -0.9, max: 0.4, v: 0.35, icon: 'lever', speed: 3.5,
      frame: () => ({ p: v3.set(this.x, this.y0, this.z), q: q3.setFromAxisAngle(UP, this.yaw) }),
      moved: (v, p) => { if (v < -0.65 && this.ready) { this.fire(p); p.letGo(); } } });
    this.arm.rotation.x = COCKED;
    // colliders: the frame (the basket is open: things sit in it on the ground)
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, this.y0, z).setRotation(q1.setFromAxisAngle(UP, yaw)));
    const own = { kind: 'catapult', onRam: (by: Pig, dir: THREE.Vector3) => this.rammed(by, dir) };
    const col = (hx: number, hy: number, hz: number, px: number, py: number, pz: number) =>
      owners.set(world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(px, py, pz).setCollisionGroups(groups(L.STATIC)), this.body).handle, own);
    for (const s of [-1, 1]) { col(0.14, 0.4, 2.3, s * 0.78, 0.5, -0.6); col(0.11, 0.9, 0.11, s * 0.75, 1.45, 0.4); }
    col(0.9, 0.12, 0.12, 0, 0.66, 1.6);
    // the basket is a real tub (user: "the pig goes inside it"): a floor + a ring of walls riding on the arm, so things
    // sit IN it; off while the arm swings (the launch sets the speeds)
    this.basketBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const bcol = (d: RAPIER.ColliderDesc) => world.createCollider(d.setCollisionGroups(groups(L.STATIC)).setFriction(0.9), this.basketBody);
    bcol(RAPIER.ColliderDesc.cylinder(0.04, 0.56).setTranslation(0, -0.03, -ARM));
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      bcol(RAPIER.ColliderDesc.cuboid(0.2, 0.2, 0.04).setTranslation(Math.cos(a) * 0.6, 0.15, -ARM + Math.sin(a) * 0.6).setRotation(q1.setFromAxisAngle(UP, -a + Math.PI / 2)));
    }
    this.placeBasket(COCKED);
    this.spot = { kind: 'spot', markPos: new THREE.Vector3(x, this.y0 + 3, z), heldBy: null };
  }

  /** Where the basket rests (cocked), in world space. */
  basket(out = new THREE.Vector3()) {
    const ly = AXLE.y + ARM * Math.sin(COCKED), lz = AXLE.z - ARM * Math.cos(COCKED);
    return out.set(this.x + Math.sin(this.yaw) * lz, this.y0 + ly, this.z + Math.cos(this.yaw) * lz);
  }
  private get ready() { return G.time - this.fireT > PUMPKIN.reload; }
  setYaw(y: number) {
    if (y === this.yaw) return;
    this.yaw = y; this.g.rotation.y = y;
    this.body.setRotation(q1.setFromAxisAngle(UP, y), true);
  }

  /** A hit lands on / next to the frame (in its local box): fire. */
  hitBy(hx: number, hz: number, by: Pig) {
    const dx = hx - this.x, dz = hz - this.z, c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) > 1.45 || lz < -3.5 || lz > 2.1) return false;
    this.fire(by);
    return true;
  }
  /** Rammed from the side: it swings round a bit (head-on: just a thunk). */
  private rammed(by: Pig, dir: THREE.Vector3) {
    if (G.net === 'client' || G.time - this.turnT < 0.4) return;
    const rx = by.pos.x - this.x, rz = by.pos.z - this.z;
    const torque = rz * dir.x - rx * dir.z;   // y of r × F
    G.audio.play('wood', { pos: by.pos, vol: 0.9, pitch: 0.7 });
    if (Math.abs(torque) < 0.35) return;
    this.turnT = G.time;
    this.setYaw(this.yaw + Math.sign(torque) * PUMPKIN.rot);
    G.audio.play('creak', { pos: v1.set(this.x, this.y0 + 1, this.z), vol: 0.8, pitch: 0.8 });
    G.fx.puff(v1.set(this.x, this.y0 + 0.2, this.z), { count: 10, color: 0xcbb48c, speed: 1.6, up: 0.4, life: 0.9, size: 0.9, alpha: 0.5 });
  }

  /** Host: let fly (whatever is in the basket goes at the release point of the swing). */
  fire(by: Pig | null) {
    if (G.net === 'client' || !this.ready) return false;
    this.fireT = G.time; this.launchAt = G.time + PUMPKIN.release; this.by = by;
    const b = this.basket(v1);
    this.payload = G.holdables.filter((o) => {
      if (o.heldBy || o.mass > PUMPKIN.maxMass) return false;
      const p = o.body.translation();
      if (Math.hypot(p.x - b.x, p.z - b.z) > PUMPKIN.zoneR + o.radius * 0.5 || p.y > b.y + 1.6 || p.y < this.y0 - 0.5) return false;
      const pig = o as unknown as Pig;
      return !(o.kind === 'pig' && (pig.out || pig.cage));
    });
    G.audio.play('creak', { pos: b, vol: 1, pitch: 1.3 });
    G.audio.play('whoosh', { pos: v2.set(this.x, this.y0 + 2, this.z), vol: 1, pitch: 0.7 });
    G.noise(v2.set(this.x, this.y0, this.z), PUMPKIN.noise);
    G.events.push({ type: 'catapult', who: by ?? undefined });
    return true;
  }
  /** Host: the release point of the swing: everything in the basket flies (aimed at Bob when he's about where it points). */
  step() {
    this.track();
    if (!this.release.heldBy) this.release.v += (0.35 - this.release.v) * 0.1;   // springs back
    if (!this.launchAt || G.time < this.launchAt) return;
    this.launchAt = 0;
    G.audio.play('wood', { pos: v1.set(this.x, this.y0 + 2.5, this.z), vol: 1, pitch: 0.6 });
    if (!this.payload.length) return;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const b = this.basket(v2);
    const target = v1.set(this.x + fx * PUMPKIN.defD, 0, this.z + fz * PUMPKIN.defD);
    target.y = this.y(target.x, target.z);
    const f = G.farmer;
    if (f && !f.asleep && f.state !== 'down') {
      const dx = f.pos.x - b.x, dz = f.pos.z - b.z, d = Math.hypot(dx, dz);
      const ang = Math.acos(clamp((dx * fx + dz * fz) / Math.max(d, 0.01), -1, 1));
      if (ang < PUMPKIN.assist && d > PUMPKIN.minD && d < PUMPKIN.maxD) {
        const tf = 0.75 + d / 26;   // lead him a little
        target.set(f.pos.x + f.vel.x * tf * 0.8, f.pos.y + 0.9, f.pos.z + f.vel.z * tf * 0.8);
      }
    }
    for (const o of this.payload) {
      if (o.heldBy) continue;
      const p = o.body.translation();
      if (Math.hypot(p.x - b.x, p.z - b.z) > PUMPKIN.zoneR + 1.2) continue;   // jumped out meanwhile
      const dx = target.x - p.x, dz = target.z - p.z, d = Math.max(PUMPKIN.minD, Math.hypot(dx, dz)), tf = 0.75 + d / 26;
      const k = d / Math.max(Math.hypot(dx, dz), 0.01);
      const vel = new THREE.Vector3((dx * k) / tf, (target.y - p.y + 0.5 * 20 * tf * tf) / tf, (dz * k) / tf);
      this.flying.push({ o, until: G.time + 4 });
      if (o.kind === 'pig') {
        const pig = o as unknown as Pig;
        pig.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        pig.knock(vel, true);
        G.audio.play('squeal', { pos: pig.pos, vol: 1 });
        G.shakeFor(pig, 0.5);
        G.events.push({ type: 'pigLaunched', who: pig });
      } else if (o.kind === 'critter') {
        o.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        o.knock?.(vel, true);
      } else {
        o.body.setLinvel(vel, true);
        o.body.setAngvel({ x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 8 }, true);
      }
    }
    this.payload = [];
  }

  /** Host: a shot (still flying, or just splatted / smashed this step) within reach of Bob's body = a hit. */
  private track() {
    if (!this.flying.length) return;
    const f = G.farmer;
    this.flying = this.flying.filter(({ o, until }) => {
      if (G.time > until || o.heldBy) return false;
      const p = o.body.translation(), gone = (o as unknown as Prop).banked === true;
      if (f && G.time - (until - 4) > 0.3 && Math.hypot(p.x - f.pos.x, p.z - f.pos.z) < 1.3 + o.radius * 0.5 && p.y > f.pos.y - 0.3 && p.y < f.pos.y + 2.4 && f.catapulted()) return false;
      return !gone;
    });
  }

  render() {
    const e = G.time - this.fireT, sw = PUMPKIN.swing, back = PUMPKIN.reload - sw - 0.3;
    let rx = COCKED;
    if (e >= 0 && e < sw) { const k = e / sw; rx = COCKED + (FIRED - COCKED) * k * k; }
    else if (e >= sw && e < sw + 0.3) rx = FIRED - Math.sin(((e - sw) / 0.3) * Math.PI) * 0.12;
    else if (e >= sw + 0.3 && e < PUMPKIN.reload) rx = FIRED + (COCKED - FIRED) * smoothstep(0, 1, (e - sw - 0.3) / back);
    this.arm.rotation.x = rx;
    this.placeBasket(rx);
    this.spot.markPos.set(this.x, this.y0 + 3, this.z);
  }
  reset() { this.fireT = -10; this.launchAt = 0; this.payload = []; this.flying = []; }
}
