import * as THREE from 'three';
import { staticBox } from '../core/physics';
import { G } from '../game/ctx';
import { toonMat } from '../render/toon';
import { rigidSkin } from '../render/batch';
import type { Pig } from '../pig/pig';
import { Prop, PROPS } from './props';

/**
 * The smoking lounge (cannabis mode; user: "a smoking & chill room: the pigs come to sit on the couch and get high in
 * peace. Sitting: picture the couch facing the camera, the pig sits on it facing the camera — like Fortnite's couch:
 * you see the player's face, not their back. They can smoke, eat, get high, dance and fool around; a pass button
 * passes the joint"). An open-front room near the shed: a big velvet couch (3 seats) against the back wall, a coffee
 * table with snacks + a pack of cigarettes, a lava lamp, string lights, a rug, a tapestry, a big plant.
 * RMB at a free seat = sit (also with something in the hooves): the pig sits facing out of the room and my camera
 * swings round in front of it. WASD / jump = get up. G = pass what I hold to the pig next to me (pig.ts `passHeld`).
 * Seats are static (the same on every machine): a sitting pig is held there by its own step (host and prediction).
 */
/** The coffee table's distance from the back wall (room to stand between it and the couch). */
const TABLE_Z = 2.1;
export const LOUNGE = { W: 7.2, D: 4.8, H: 2.8, seats: 3, seatH: 0.48, sitR: 0.95 };

const v1 = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

export class Lounge {
  kind = 'lounge' as const;
  center: THREE.Vector3; yaw: number;
  /** Seat cushions (world, the cushion top) and the way a sitting pig faces. */
  seats: THREE.Vector3[] = [];
  private roof = new THREE.Group();
  private lava: THREE.Mesh[] = [];
  private lights: THREE.Mesh[] = [];
  private root = new THREE.Group();

  constructor(scene: THREE.Scene, props: Prop[], at: THREE.Vector3, yaw: number) {
    this.center = at.clone(); this.yaw = yaw;
    this.build(scene);
    const L = (x: number, y: number, z: number) => v1.set(x, y, z).applyAxisAngle(UP, yaw).add(this.center).clone();
    for (let i = 0; i < LOUNGE.seats; i++) this.seats.push(L((i - 1) * 0.95, LOUNGE.seatH, -LOUNGE.D / 2 + 0.84));
    // on the coffee table: a pack of cigarettes, two cans of something (the munchies)
    const tz = -LOUNGE.D / 2 + TABLE_Z;
    props.push(new Prop(scene, PROPS.cigPack, L(-0.35, 0.47, tz), yaw + 0.4));
    props.push(new Prop(scene, PROPS.canBeans ?? PROPS.cigPack, L(0.25, 0.47, tz + 0.1), yaw));
    props.push(new Prop(scene, PROPS.canEnergy ?? PROPS.cigPack, L(0.55, 0.47, tz - 0.12), yaw));
    // sitting = RMB at a free seat (pig.ts asks seatFor)
    G.uses.push({ near: (p: Pig) => p.seat < 0 && this.seatFor(p) >= 0, icon: () => 'couch' });
  }

  /** The seat a pig standing here would sit on (free, close, in front of it), or -1. */
  seatFor(p: Pig) {
    if (p.out || p.cage || p.heldBy || p.mode !== 'normal' || p.gulag) return -1;
    let best = -1, bd: number = LOUNGE.sitR;
    this.seats.forEach((s, i) => {
      if ((G.pigs as Pig[]).some((o) => o.seat === i && o !== p)) return;
      const d = Math.hypot(p.pos.x - s.x, p.pos.z - s.z);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }
  /** A sitting pig's pose: the cushion (world) and its heading (out of the room, toward the camera). */
  seatYaw() { return this.yaw; }
  /** Getting up: a step in front of the seat. */
  standSpot(i: number, out = new THREE.Vector3()) { return out.copy(this.seats[i]).addScaledVector(v1.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), 0.62).setY(this.center.y + 0.16); }
  inside(p: THREE.Vector3) {
    const l = v1.copy(p).sub(this.center).applyAxisAngle(UP, -this.yaw);
    return Math.abs(l.x) < LOUNGE.W / 2 && l.z > -LOUNGE.D / 2 && l.z < LOUNGE.D / 2 + 0.3;
  }
  get markPos() { return v1.copy(this.seats[1]).setY(this.seats[1].y + 1.8); }

  /** Open front (facing +z local), a couch on the back wall, a coffee table, decor. */
  private build(scene: THREE.Scene) {
    const { W, D, H, seatH } = LOUNGE, r = this.root;
    r.position.copy(this.center); r.rotation.y = this.yaw; scene.add(r);
    const M = (c: number, o?: object) => toonMat(c, o as never);
    const wall = M(0x6f4a8a), wall2 = M(0x5e3d78), floor = M(0x8a6a4a), wood = M(0x7a4a26), velvet = M(0x3f8f6a), velvet2 = M(0x357a5a), cushion = M(0xf2a23a);
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = r, rx = 0, ry = 0, rz = 0) => {
      const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
    };
    add(new THREE.BoxGeometry(W + 0.3, 0.16, D + 0.3), floor, 0, 0.08, 0);
    add(new THREE.BoxGeometry(W, H, 0.14), wall, 0, H / 2, -D / 2);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.14, H, D), wall2, s * W / 2, H / 2, 0);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.22, H + 0.3, 0.22), wood, s * W / 2, (H + 0.3) / 2, D / 2);
    // roof (hides while my pig is inside so the camera sees in)
    r.add(this.roof);
    add(new THREE.BoxGeometry(W + 0.8, 0.14, D + 1.0), M(0x4a3060), 0, H + 0.15, 0.2, this.roof, -0.06);
    // the rug: a round one, orange + purple rings
    for (const [rad, c, y] of [[2.0, 0xf2a23a, 0.17], [1.5, 0x8a4fbf, 0.175], [0.9, 0xffd166, 0.18]] as const) add(new THREE.CylinderGeometry(rad, rad, 0.01, 28), M(c), 0, y, -0.2);
    // the tapestry on the back wall: a big green leaf on purple, a sun
    add(new THREE.BoxGeometry(2.6, 1.4, 0.03), M(0x2b1f45), 0, 1.9, -D / 2 + 0.09);
    for (let i = 0; i < 7; i++) { const a = -0.9 + i * 0.3; add(new THREE.ConeGeometry(0.09, 0.62, 4), M(0x5fbf4a), Math.sin(a) * 0.28, 1.86 + Math.cos(a) * 0.28, -D / 2 + 0.12, r, 0, 0, -a); }
    add(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 20), M(0xffb13a), 0.85, 2.3, -D / 2 + 0.11, r, Math.PI / 2, 0, 0);
    // the couch: base, 3 seat cushions, backrest, arms, little stubby legs
    const cz = -D / 2 + 0.7, cw = LOUNGE.seats * 0.95 + 0.2;
    add(new THREE.BoxGeometry(cw, 0.3, 0.95), velvet2, 0, 0.32, cz);
    for (let i = 0; i < LOUNGE.seats; i++) add(new THREE.BoxGeometry(0.9, 0.14, 0.9), velvet, (i - 1) * 0.95, seatH - 0.06, cz + 0.03).scale.set(1, 1, 1);
    add(new THREE.BoxGeometry(cw, 0.75, 0.28), velvet2, 0, 0.75, cz - 0.42, r, -0.12);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.28, 0.62, 0.98), velvet2, s * (cw / 2 + 0.12), 0.48, cz);
    for (const s of [-1, 1]) for (const z of [-0.38, 0.38]) add(new THREE.CylinderGeometry(0.05, 0.04, 0.16, 8), wood, s * (cw / 2), 0.1, cz + z);
    for (const x of [-1.15, 1.15]) add(new THREE.SphereGeometry(0.22, 12, 8), cushion, x, 0.78, cz - 0.22).scale.set(1, 0.85, 0.5);   // throw pillows
    // the coffee table
    const tz = -D / 2 + TABLE_Z;
    add(new THREE.BoxGeometry(1.7, 0.08, 0.75), wood, 0, 0.42, tz);
    for (const sx of [-0.75, 0.75]) for (const sz of [-0.3, 0.3]) add(new THREE.BoxGeometry(0.07, 0.36, 0.07), wood, sx, 0.2, tz + sz);
    add(new THREE.CylinderGeometry(0.12, 0.09, 0.05, 14), M(0x8a93a0), -0.65, 0.48, tz + 0.2);   // ashtray
    for (let i = 0; i < 3; i++) add(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 4), M(0xf4efe4), -0.66 + i * 0.03, 0.52, tz + 0.18, r, 0, 0, 1.2);
    // a lava lamp on a side table (glowing blobs drift up and down)
    const lx = W / 2 - 0.55, lz = -D / 2 + 0.55;
    add(new THREE.CylinderGeometry(0.22, 0.22, 0.55, 12), wood, lx, 0.28, lz);
    add(new THREE.CylinderGeometry(0.07, 0.11, 0.12, 12), M(0xd9b04a), lx, 0.62, lz);
    add(new THREE.CylinderGeometry(0.075, 0.075, 0.42, 14), M(0xff7ad0, { transparent: true, opacity: 0.55, emissive: new THREE.Color(0xff4fb0), emissiveIntensity: 0.6 }), lx, 0.89, lz);
    add(new THREE.ConeGeometry(0.075, 0.1, 12), M(0xd9b04a), lx, 1.15, lz);
    for (let i = 0; i < 3; i++) this.lava.push(add(new THREE.SphereGeometry(0.035 + i * 0.008, 10, 8), M(0xffb13a, { emissive: new THREE.Color(0xff7a2a), emissiveIntensity: 1 }), lx, 0.8, lz));
    // string lights along the front, a big potted plant in the corner
    for (let i = 0; i < 14; i++) {
      const x = -W / 2 + 0.3 + (i / 13) * (W - 0.6), sag = Math.sin((i / 13) * Math.PI) * 0.25;
      this.lights.push(add(new THREE.SphereGeometry(0.05, 8, 6), M([0xff5a5a, 0xffd166, 0x5fd0ff, 0x8cf04a][i % 4], { emissive: new THREE.Color([0xff3030, 0xffb000, 0x30b0ff, 0x60e030][i % 4]), emissiveIntensity: 1.2 }), x, H - 0.1 - sag, D / 2 - 0.05));
    }
    const px = -W / 2 + 0.6, pz = -D / 2 + 0.6;
    add(new THREE.CylinderGeometry(0.26, 0.2, 0.45, 12), M(0xc0663a), px, 0.4, pz);
    for (let i = 0; i < 9; i++) { const a = i * 0.7; add(new THREE.ConeGeometry(0.1, 0.7, 4), M(0x4fae3e), px + Math.cos(a) * 0.12, 0.95, pz + Math.sin(a) * 0.12, r, Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5); }
    rigidSkin(r, new Set([...this.lava, ...this.lights, this.roof]));
    // colliders: walls, the couch (back + arms + base low enough to sit on), the coffee table, the lamp table, the plant
    const C = this.center, q = (x: number, y: number, z: number) => v1.set(x, y, z).applyAxisAngle(UP, this.yaw).add(C).clone();
    staticBox(q(0, 0.08, 0), new THREE.Vector3(W / 2 + 0.15, 0.08, D / 2 + 0.15), this.yaw);
    staticBox(q(0, H / 2, -D / 2), new THREE.Vector3(W / 2, H / 2, 0.08), this.yaw);
    for (const s of [-1, 1]) staticBox(q(s * W / 2, H / 2, 0), new THREE.Vector3(0.08, H / 2, D / 2), this.yaw);
    staticBox(q(0, 0.75, cz - 0.42), new THREE.Vector3(cw / 2, 0.4, 0.16), this.yaw);
    for (const s of [-1, 1]) staticBox(q(s * (cw / 2 + 0.12), 0.48, cz), new THREE.Vector3(0.14, 0.31, 0.5), this.yaw);
    staticBox(q(0, 0.2, cz), new THREE.Vector3(cw / 2, 0.12, 0.48), this.yaw);   // couch base (below the cushions)
    staticBox(q(0, 0.23, tz), new THREE.Vector3(0.85, 0.23, 0.38), this.yaw);
    staticBox(q(lx, 0.3, lz), new THREE.Vector3(0.22, 0.3, 0.22), this.yaw);
    staticBox(q(px, 0.3, pz), new THREE.Vector3(0.24, 0.3, 0.24), this.yaw);
  }

  /** Every frame: lava blobs drift, the lights twinkle, the roof hides while my pig is inside. */
  render(_dt: number) {
    const t = G.time;
    this.lava.forEach((b, i) => { b.position.y = 0.8 + (Math.sin(t * (0.35 + i * 0.13) + i * 2) * 0.5 + 0.5) * 0.24; });
    this.lights.forEach((l, i) => { const m = l.material as THREE.MeshToonMaterial; m.emissiveIntensity = 0.7 + 0.6 * (0.5 + 0.5 * Math.sin(t * 2 + i * 1.7)); });
    const me = G.localPig as Pig | null;
    this.roof.visible = !(me && !me.out && this.inside(me.pos));
  }
}
