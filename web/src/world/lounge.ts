import * as THREE from 'three';
import { staticBox } from '../core/physics';
import { G } from '../game/ctx';
import { toonMat } from '../render/toon';
import { rigidSkin } from '../render/batch';
import type { Pig } from '../pig/pig';
import { Prop, PROPS } from './props';
import { SEATS } from './seats';

/**
 * The smoking lounge (cannabis mode; user: "a smoking & chill room: the pigs come to sit on the couch and get high in
 * peace. Sitting: picture the couch facing the camera, the pig sits on it facing the camera — like Fortnite's couch:
 * you see the player's face, not their back. They can smoke, eat, get high, dance and fool around; a pass button
 * passes the joint" · "a couch has 2 or 4 seats, not 3; armchairs, beanbags; a TV, furniture"). An open-front room near
 * the shed: a 4-seat velvet couch on the back wall, an armchair, two beanbags, a coffee table with snacks + cigarettes,
 * an old TV (RMB = next channel), a bookshelf, a floor lamp, a lava lamp, string lights, a rug, a tapestry, a plant.
 * RMB at a free seat = sit (also with something in the hooves), facing where that seat faces; my camera swings round
 * in front of me. WASD / jump = get up. G = pass what I hold to the pig next to me (pig.ts `passHeld`). Seats are
 * static (the same on every machine): a sitting pig is held there by its own step (host and prediction).
 */
/** The coffee table's distance from the back wall (room to stand between it and the couch). */
const TABLE_Z = 2.1;
export const LOUNGE = { W: 8.4, D: 5.6, H: 2.9, couch: 4, seatH: 0.48, sitR: 0.95 };
/** TV channels: colour bars, snow, a cartoon (a pig bouncing), Bob's BBQ show (a grill and flames). */
const CHANNELS = 4;

const v1 = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
/** One TV picture (the lounge's TV, the TVs in the houses): 0 colour bars, 1 snow, 2 a pig cartoon, 3 Bob's BBQ show. */
export function drawChannel(cv: HTMLCanvasElement, ch: number, t: number) {
  const c = cv.getContext('2d')!, w = cv.width, h = cv.height;
  switch (ch) {
    case 0: { const cols = ['#fff', '#ff0', '#0ff', '#0f0', '#f0f', '#f00', '#00f']; cols.forEach((col, i) => { c.fillStyle = col; c.fillRect((i * w) / 7, 0, w / 7 + 1, h * 0.75); }); c.fillStyle = '#111'; c.fillRect(0, h * 0.75, w, h); break; }
    case 1: { const img = c.createImageData(w, h); for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; } c.putImageData(img, 0, 0); break; }
    case 2: {   // a cartoon: a pink pig face bouncing on blue
      c.fillStyle = '#5fb6e6'; c.fillRect(0, 0, w, h); const y = h * 0.55 - Math.abs(Math.sin(t * 4)) * 18;
      c.fillStyle = '#ffb3c7'; c.beginPath(); c.arc(w / 2, y, 20, 0, 7); c.fill(); c.fillStyle = '#ff8fb0'; c.beginPath(); c.ellipse(w / 2, y + 5, 9, 6, 0, 0, 7); c.fill();
      c.fillStyle = '#222'; for (const s of [-1, 1]) { c.beginPath(); c.arc(w / 2 + s * 8, y - 6, 3, 0, 7); c.fill(); }
      c.fillStyle = '#7cc95a'; c.fillRect(0, h * 0.85, w, h); break;
    }
    default: {   // Bob's BBQ show: a red grill, flames
      c.fillStyle = '#3a2614'; c.fillRect(0, 0, w, h); c.fillStyle = '#c63a2f'; c.beginPath(); c.arc(w / 2, h * 0.7, 26, Math.PI, 0); c.fill();
      for (let i = 0; i < 6; i++) { c.fillStyle = i % 2 ? '#ffd166' : '#ff7a2a'; const fh = 10 + Math.abs(Math.sin(t * 9 + i)) * 14; c.fillRect(w / 2 - 20 + i * 8, h * 0.7 - 26 - fh, 6, fh); }
      c.fillStyle = '#fff'; c.font = 'bold 11px sans-serif'; c.fillText('BBQ', w / 2 - 12, 14);
    }
  }
}

type V2 = [number, number];

export class Lounge {
  kind = 'lounge' as const;
  center: THREE.Vector3; yaw: number;
  /** Seat cushions (world, the cushion top) and which way each one faces (world yaw). */
  seats: THREE.Vector3[] = []; private seatYaws: number[] = [];
  private roof = new THREE.Group();
  private lava: THREE.Mesh[] = [];
  private lights: THREE.Mesh[] = [];
  private root = new THREE.Group();
  // ---- the TV (synced: its channel)
  channel = 0;
  private tvAt = new THREE.Vector3(); private tvCanvas: HTMLCanvasElement; private tvTex: THREE.CanvasTexture; private tvT = 0;

  constructor(scene: THREE.Scene, props: Prop[], at: THREE.Vector3, yaw: number) {
    this.center = at.clone(); this.yaw = yaw;
    this.tvCanvas = document.createElement('canvas'); this.tvCanvas.width = 96; this.tvCanvas.height = 72;
    this.tvTex = new THREE.CanvasTexture(this.tvCanvas); this.tvTex.colorSpace = THREE.SRGBColorSpace;
    this.build(scene);
    const L = (x: number, y: number, z: number) => v1.set(x, y, z).applyAxisAngle(UP, yaw).add(this.center).clone();
    // the snacks on the coffee table: a pack of cigarettes, two cans (the munchies)
    const tz = -LOUNGE.D / 2 + TABLE_Z;
    props.push(new Prop(scene, PROPS.cigPack, L(-0.4, 0.47, tz), yaw + 0.4));
    props.push(new Prop(scene, PROPS.canBeans ?? PROPS.cigPack, L(0.25, 0.47, tz + 0.1), yaw));
    props.push(new Prop(scene, PROPS.canEnergy ?? PROPS.cigPack, L(0.6, 0.47, tz - 0.12), yaw));
    // sitting = RMB at a free seat (pig.ts asks seatFor); the TV: RMB at it = next channel
    G.uses.push({ near: (p: Pig) => p.seat < 0 && !p.held && this.seatFor(p) < 0 && this.tvNear(p), icon: () => 'tv' });
  }

  /** A seat: room spot (x, z), cushion height, facing (room yaw: 0 = out of the room). */
  private seat(x: number, z: number, h: number, ly: number) {
    const p = v1.set(x, h, z).applyAxisAngle(UP, this.yaw).add(this.center).clone();
    this.seats.push(p); this.seatYaws.push(this.yaw + ly);
    this.seatIds.push(SEATS.fixed(p, this.yaw + ly, h));
  }
  /** These seats' numbers in the shared registry. */
  private seatIds: number[] = [];
  /** The seat here a pig standing there would sit on (free, close), or -1. */
  seatFor(p: Pig) { const i = SEATS.seatFor(p); return this.seatIds.includes(i) ? i : -1; }
  /** Which way a pig on this seat faces (world yaw). */
  seatYaw(i: number) { return this.seatYaws[i] ?? this.yaw; }
  /** Getting up: a step in front of the seat. */
  standSpot(i: number, out = new THREE.Vector3()) { const y = this.seatYaw(i); return out.copy(this.seats[i]).addScaledVector(v1.set(Math.sin(y), 0, Math.cos(y)), 0.62).setY(this.center.y + 0.16); }
  inside(p: THREE.Vector3) {
    const l = v1.copy(p).sub(this.center).applyAxisAngle(UP, -this.yaw);
    return Math.abs(l.x) < LOUNGE.W / 2 && l.z > -LOUNGE.D / 2 && l.z < LOUNGE.D / 2 + 0.3;
  }
  get markPos() { return v1.copy(this.seats[1]).setY(this.seats[1].y + 1.8); }
  private tvNear(p: Pig) { return Math.hypot(p.pos.x - this.tvAt.x, p.pos.z - this.tvAt.z) < 1.0; }

  /** Open front (facing +z local): the couch on the back wall, the TV in the front-right corner, the rest round them. */
  private build(scene: THREE.Scene) {
    const { W, D, H, seatH } = LOUNGE, r = this.root;
    r.position.copy(this.center); r.rotation.y = this.yaw; scene.add(r);
    const M = (c: number, o?: object) => toonMat(c, o as never);
    const wall = M(0x6f4a8a), wall2 = M(0x5e3d78), floor = M(0x8a6a4a), wood = M(0x7a4a26), velvet = M(0x3f8f6a), velvet2 = M(0x357a5a), cushion = M(0xf2a23a);
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = r, rx = 0, ry = 0, rz = 0) => {
      const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
    };
    const C = this.center, q = (x: number, y: number, z: number) => v1.set(x, y, z).applyAxisAngle(UP, this.yaw).add(C).clone();
    /** A static box collider in room space (turned with the room + `ly`). */
    const solid = (x: number, y: number, z: number, hx: number, hy: number, hz: number, ly = 0) => staticBox(q(x, y, z), new THREE.Vector3(hx, hy, hz), this.yaw + ly);
    /** A group placed in the room (room x, z, facing room yaw). */
    const piece = (x: number, z: number, ly: number) => { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ly; r.add(g); return g; };
    /** A point of a piece (its own x, z) in room space. */
    const at = ([x, z]: V2, ly: number, [px, pz]: V2): V2 => [x + px * Math.cos(ly) + pz * Math.sin(ly), z - px * Math.sin(ly) + pz * Math.cos(ly)];

    add(new THREE.BoxGeometry(W + 0.3, 0.16, D + 0.3), floor, 0, 0.08, 0);
    add(new THREE.BoxGeometry(W, H, 0.14), wall, 0, H / 2, -D / 2);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.14, H, D), wall2, s * W / 2, H / 2, 0);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.22, H + 0.3, 0.22), wood, s * W / 2, (H + 0.3) / 2, D / 2);
    r.add(this.roof);
    add(new THREE.BoxGeometry(W + 0.8, 0.14, D + 1.0), M(0x4a3060), 0, H + 0.15, 0.2, this.roof, -0.06);
    for (const [rad, c, y] of [[2.3, 0xf2a23a, 0.17], [1.7, 0x8a4fbf, 0.175], [1.0, 0xffd166, 0.18]] as const) add(new THREE.CylinderGeometry(rad, rad, 0.01, 28), M(c), 0, y, 0);
    // the tapestry: a big green leaf on purple, a sun
    add(new THREE.BoxGeometry(2.6, 1.4, 0.03), M(0x2b1f45), 0, 2.0, -D / 2 + 0.09);
    for (let i = 0; i < 7; i++) { const a = -0.9 + i * 0.3; add(new THREE.ConeGeometry(0.09, 0.62, 4), M(0x5fbf4a), Math.sin(a) * 0.28, 1.96 + Math.cos(a) * 0.28, -D / 2 + 0.12, r, 0, 0, -a); }
    add(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 20), M(0xffb13a), 0.85, 2.4, -D / 2 + 0.11, r, Math.PI / 2, 0, 0);

    // ---- the couch: 4 seats on the back wall
    const cz = -D / 2 + 0.7, N = LOUNGE.couch, cw = N * 0.92 + 0.2;
    add(new THREE.BoxGeometry(cw, 0.3, 0.95), velvet2, 0, 0.32, cz);
    for (let i = 0; i < N; i++) {
      const x = (i - (N - 1) / 2) * 0.92;
      add(new THREE.BoxGeometry(0.88, 0.14, 0.9), velvet, x, seatH - 0.06, cz + 0.03);
      this.seat(x, cz + 0.14, seatH, 0);
    }
    add(new THREE.BoxGeometry(cw, 0.75, 0.28), velvet2, 0, 0.75, cz - 0.42, r, -0.12);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.28, 0.62, 0.98), velvet2, s * (cw / 2 + 0.12), 0.48, cz);
    for (const s of [-1, 1]) for (const z of [-0.38, 0.38]) add(new THREE.CylinderGeometry(0.05, 0.04, 0.16, 8), wood, s * (cw / 2), 0.1, cz + z);
    for (const x of [-cw / 2 + 0.35, cw / 2 - 0.35]) add(new THREE.SphereGeometry(0.22, 12, 8), cushion, x, 0.78, cz - 0.22).scale.set(1, 0.85, 0.5);
    solid(0, 0.75, cz - 0.42, cw / 2, 0.4, 0.16);
    for (const s of [-1, 1]) solid(s * (cw / 2 + 0.12), 0.48, cz, 0.14, 0.31, 0.5);
    solid(0, 0.2, cz, cw / 2, 0.12, 0.48);

    // ---- the coffee table (an ashtray on it)
    const tz = -D / 2 + TABLE_Z;
    add(new THREE.BoxGeometry(1.9, 0.08, 0.75), wood, 0, 0.42, tz);
    for (const sx of [-0.85, 0.85]) for (const sz of [-0.3, 0.3]) add(new THREE.BoxGeometry(0.07, 0.36, 0.07), wood, sx, 0.2, tz + sz);
    add(new THREE.CylinderGeometry(0.12, 0.09, 0.05, 14), M(0x8a93a0), -0.75, 0.48, tz + 0.2);
    for (let i = 0; i < 3; i++) add(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 4), M(0xf4efe4), -0.76 + i * 0.03, 0.52, tz + 0.18, r, 0, 0, 1.2);
    solid(0, 0.23, tz, 0.95, 0.23, 0.38);

    // ---- the TV: an old wooden CRT on a low stand, front-right corner, turned to the couch
    const tvP: V2 = [W / 2 - 0.95, D / 2 - 1.0], tvY = Math.atan2(0 - tvP[0], (cz + 0.1) - tvP[1]);
    const tv = piece(tvP[0], tvP[1], tvY);
    add(new THREE.BoxGeometry(1.1, 0.45, 0.5), wood, 0, 0.23, 0, tv);
    add(new THREE.BoxGeometry(0.9, 0.7, 0.6), M(0x8a5a35), 0, 0.82, -0.02, tv);
    add(new THREE.BoxGeometry(0.72, 0.52, 0.02), M(0x2a2a2a), -0.05, 0.84, 0.29, tv);
    add(new THREE.PlaneGeometry(0.64, 0.46), new THREE.MeshBasicMaterial({ map: this.tvTex }), -0.05, 0.84, 0.305, tv).castShadow = false;
    for (const y of [0.95, 0.78]) add(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 10), M(0xd9b04a), 0.36, y, 0.3, tv, Math.PI / 2, 0, 0);   // knobs
    for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.008, 0.008, 0.55, 4), M(0x9aa3ad), s * 0.15, 1.4, -0.05, tv, 0, 0, s * 0.45);   // rabbit ears
    const tvc = at(tvP, tvY, [0, 0]); solid(tvc[0], 0.6, tvc[1], 0.55, 0.6, 0.3, tvY);
    const tvf = at(tvP, tvY, [0, 0.75]); this.tvAt.copy(q(tvf[0], 0, tvf[1]));
    const look = (p: V2) => Math.atan2(tvc[0] - p[0], tvc[1] - p[1]);   // a seat turned toward the TV

    // ---- an armchair (left side, turned to the TV)
    const acP: V2 = [-W / 2 + 1.05, 0.25], acY = look(acP);
    const ac = piece(acP[0], acP[1], acY);
    add(new THREE.BoxGeometry(0.95, 0.32, 0.9), M(0xc0663a), 0, 0.26, 0, ac);
    add(new THREE.BoxGeometry(0.75, 0.14, 0.75), M(0xe08a4a), 0, 0.46, 0.04, ac);
    add(new THREE.BoxGeometry(0.95, 0.8, 0.22), M(0xc0663a), 0, 0.72, -0.36, ac, -0.12);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.18, 0.5, 0.86), M(0xa8552e), s * 0.46, 0.5, 0, ac);
    const acB = at(acP, acY, [0, -0.36]); solid(acB[0], 0.72, acB[1], 0.47, 0.4, 0.12, acY);
    for (const s of [-1, 1]) { const a2 = at(acP, acY, [s * 0.46, 0]); solid(a2[0], 0.5, a2[1], 0.09, 0.25, 0.43, acY); }
    { const sc = at(acP, acY, [0, 0.1]); this.seat(sc[0], sc[1], 0.5, acY); }

    // ---- two beanbags on the rug (low: a pig sinks right in), turned to the TV
    for (const [bp, col] of [[[-1.9, 1.3], 0x5fbf4a], [[0.2, 1.55], 0xff6fa8]] as [V2, number][]) {
      const by = look(bp), bb = piece(bp[0], bp[1], by);
      add(new THREE.SphereGeometry(0.5, 16, 12), M(col), 0, 0.3, 0, bb).scale.set(1, 0.6, 1);
      add(new THREE.SphereGeometry(0.42, 14, 10), M(col), 0, 0.5, -0.3, bb).scale.set(1, 0.85, 0.6);   // the back of it
      add(new THREE.SphereGeometry(0.06, 8, 6), M(0xffffff), 0.2, 0.52, 0.22, bb);   // a little label
      solid(bp[0], 0.1, bp[1], 0.42, 0.1, 0.42, by);
      this.seat(bp[0], bp[1], 0.36, by);
    }

    // ---- a bookshelf (left wall, back), a floor lamp (by the couch's left end)
    const bsx = -W / 2 + 0.25, bsz = -D / 2 + 1.0;
    add(new THREE.BoxGeometry(0.4, 1.9, 1.2), wood, bsx, 0.95, bsz);
    for (let sh = 0; sh < 4; sh++) {
      add(new THREE.BoxGeometry(0.36, 0.03, 1.12), M(0x5e3a1f), bsx + 0.03, 0.25 + sh * 0.45, bsz);
      for (let b = 0; b < 7; b++) add(new THREE.BoxGeometry(0.26, 0.28 + ((b * 7 + sh * 3) % 5) * 0.025, 0.1), M([0xd8403a, 0x3f7fd0, 0xffd166, 0x7cc95a, 0xb57bff][(b + sh) % 5]), bsx + 0.06, 0.41 + sh * 0.45, bsz - 0.45 + b * 0.14);
    }
    solid(bsx, 0.95, bsz, 0.2, 0.95, 0.6);
    const flx = -cw / 2 - 0.6, flz = -D / 2 + 0.45;
    add(new THREE.CylinderGeometry(0.18, 0.2, 0.05, 14), M(0x3a3d44), flx, 0.2, flz);
    add(new THREE.CylinderGeometry(0.025, 0.025, 1.6, 8), M(0x3a3d44), flx, 1.0, flz);
    add(new THREE.CylinderGeometry(0.16, 0.28, 0.32, 16, 1, true), M(0xfff1c9, { emissive: new THREE.Color(0xffd27a), emissiveIntensity: 0.7, side: THREE.DoubleSide }), flx, 1.85, flz);
    solid(flx, 0.9, flz, 0.12, 0.9, 0.12);

    // ---- the lava lamp (on a side table at the couch's right end)
    const lx = cw / 2 + 0.6, lz = -D / 2 + 0.55;
    add(new THREE.CylinderGeometry(0.22, 0.22, 0.55, 12), wood, lx, 0.28, lz);
    add(new THREE.CylinderGeometry(0.07, 0.11, 0.12, 12), M(0xd9b04a), lx, 0.62, lz);
    add(new THREE.CylinderGeometry(0.075, 0.075, 0.42, 14), M(0xff7ad0, { transparent: true, opacity: 0.55, emissive: new THREE.Color(0xff4fb0), emissiveIntensity: 0.6 }), lx, 0.89, lz);
    add(new THREE.ConeGeometry(0.075, 0.1, 12), M(0xd9b04a), lx, 1.15, lz);
    for (let i = 0; i < 3; i++) this.lava.push(add(new THREE.SphereGeometry(0.035 + i * 0.008, 10, 8), M(0xffb13a, { emissive: new THREE.Color(0xff7a2a), emissiveIntensity: 1 }), lx, 0.8, lz));
    solid(lx, 0.3, lz, 0.22, 0.3, 0.22);
    // string lights along the front, a big potted plant in the back-right corner
    for (let i = 0; i < 16; i++) {
      const x = -W / 2 + 0.3 + (i / 15) * (W - 0.6), sag = Math.sin((i / 15) * Math.PI) * 0.25;
      this.lights.push(add(new THREE.SphereGeometry(0.05, 8, 6), M([0xff5a5a, 0xffd166, 0x5fd0ff, 0x8cf04a][i % 4], { emissive: new THREE.Color([0xff3030, 0xffb000, 0x30b0ff, 0x60e030][i % 4]), emissiveIntensity: 1.2 }), x, H - 0.1 - sag, D / 2 - 0.05));
    }
    const px = W / 2 - 0.6, pz = -D / 2 + 0.6;
    add(new THREE.CylinderGeometry(0.26, 0.2, 0.45, 12), M(0xc0663a), px, 0.4, pz);
    for (let i = 0; i < 9; i++) { const a = i * 0.7; add(new THREE.ConeGeometry(0.1, 0.7, 4), M(0x4fae3e), px + Math.cos(a) * 0.12, 0.95, pz + Math.sin(a) * 0.12, r, Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5); }
    solid(px, 0.3, pz, 0.24, 0.3, 0.24);
    rigidSkin(r, new Set([...this.lava, ...this.lights, this.roof]));
    // walls + floor
    solid(0, 0.08, 0, W / 2 + 0.15, 0.08, D / 2 + 0.15);
    solid(0, H / 2, -D / 2, W / 2, H / 2, 0.08);
    for (const s of [-1, 1]) solid(s * W / 2, H / 2, 0, 0.08, H / 2, D / 2);
    this.drawTV();
  }

  // ================================================================== the TV
  /** Host: next channel (RMB at the TV with free hooves). */
  private zap() { this.channel = (this.channel + 1) % CHANNELS; G.audio.play('clunk', { pos: this.tvAt, vol: 0.6, pitch: 1.4 }); G.audio.play('static', { pos: this.tvAt, vol: 0.25, minGap: 0.2 }); }
  step() {
    if (G.net === 'client') return;
    for (const p of G.pigs as Pig[]) if (p.input.grabP && p.seat < 0 && !p.held && this.seatFor(p) < 0 && this.tvNear(p)) { this.zap(); p.touch(v1.copy(this.tvAt).setY(this.tvAt.y + 0.8)); break; }
  }
  private drawTV() {
    drawChannel(this.tvCanvas, this.channel, G.time);
    this.tvTex.needsUpdate = true;
  }

  // ================================================================== network
  netState(n: number[]) { n.push(this.channel); }
  netApply(n: number[]) { if (n.length) this.channel = n[0]; }

  /** Every frame: the TV picture (only when someone's near), lava blobs drift, the lights twinkle, the roof hides while my pig is inside. */
  render(dt: number) {
    const t = G.time, me = G.localPig as Pig | null;
    const near = !!me && Math.hypot(me.pos.x - this.center.x, me.pos.z - this.center.z) < 25;
    this.tvT -= dt;
    if (near && this.tvT <= 0) { this.tvT = this.channel === 0 ? 1 : 0.12; this.drawTV(); }
    this.lava.forEach((b, i) => { b.position.y = 0.8 + (Math.sin(t * (0.35 + i * 0.13) + i * 2) * 0.5 + 0.5) * 0.24; });
    this.lights.forEach((l, i) => { const m = l.material as THREE.MeshToonMaterial; m.emissiveIntensity = 0.7 + 0.6 * (0.5 + 0.5 * Math.sin(t * 2 + i * 1.7)); });
    this.roof.visible = !(me && !me.out && this.inside(me.pos));
  }
}
