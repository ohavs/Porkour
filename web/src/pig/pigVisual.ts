import * as THREE from 'three';
import { rigidSkin } from '../render/batch';
import { damp, clamp, lerp } from '../core/util';
import { G } from '../game/ctx';
import { buildPig, PIVOT, STAND_POS, STAND_ANGLE, NECK, SNOUT_TIP, ARM, type PigRig, type Arm } from './pigModel';
import { HEAD_TILT } from './pigBody';
import { dress, defaultOutfit, type Outfit } from './cosmetics';
import { makeCigarette } from '../world/snacks';
import { toonMat, RAMP } from '../render/toon';

const DOWN = new THREE.Vector3(0, -1, 0);
const SNOUT_DIR = SNOUT_TIP.clone().sub(NECK).normalize();
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const _e = new THREE.Euler(), _look = new THREE.Vector3();
const _mi = new THREE.Matrix4(), _mouth = new THREE.Vector3(), _sh = new THREE.Vector3(), _t = new THREE.Vector3(), _v = new THREE.Vector3(), _off = new THREE.Vector3();
const _pole = new THREE.Vector3(), _uq = new THREE.Quaternion(), _pp = new THREE.Vector3(), _el = new THREE.Vector3(), _u = new THREE.Vector3(), _w = new THREE.Vector3();
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(), _bm = new THREE.Matrix4(), _bq = new THREE.Quaternion();
const MUD = new THREE.Color(0x6b4423), BURNT = new THREE.Color(0x3a2620), SNOW_COAT = new THREE.Color(0xf6f9ff);

/**
 * Mud on the pig (s26, user: "real mud on me until it's gone"): lumpy splotches on the body, head and legs (one
 * InstancedMesh per moving part). Fresh = big, dark and wet; drying = paler, cracked; then they flake off one by one
 * (each has its own moment) until the pig is clean. Farm 5: clumps of snow instead.
 */
const MUD_WET = new THREE.Color(0x4a2c14), MUD_DRY = new THREE.Color(0xa88760), SNOW_CLUMP = new THREE.Color(0xf4f8ff);
const MUD_GEO = (() => {
  const g = new THREE.IcosahedronGeometry(1, 2), pa = g.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i), n = 1 + 0.22 * Math.sin(x * 5.1 + z * 3.3) * Math.cos(z * 4.7 - x * 2.1) + 0.1 * Math.sin(y * 9 + x * 7);
    pa.setXYZ(i, x * n, y * (y > 0 ? 1 : 0.4) * n, z * n);   // a lumpy pancake, flatter underneath (it sits on the skin)
  }
  g.computeVertexNormals();
  return g;
})();
interface MudSplat { m: THREE.InstancedMesh; i: number; pos: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3; t: number }

export interface PigPose {
  speed: number; grounded: boolean; vy: number; standing: boolean; mode: string;
  sprinting: boolean; muddy: number; holding: boolean;
  /** 0..1 of the mud coat left (fresh → flaked off): the splotches. */
  mudLeft?: number; charging: number; dt: number; t: number; burnt?: number;
  /** 0..1 how close a standing pig is to falling over; punch 0..1 (jab progress). */
  wobble?: number; punch?: number;
  /** Standing balance lean (radians): forward / sideways (+ = toward the pig's left), from the physics. */
  leanF?: number; leanS?: number;
  /** On a balance beam: lean on four legs too. */
  beam?: boolean;
  /** Limp (ragdoll / carried): `rel` = physical rotations of head, frontL, frontR, hindL, hindR relative to the torso. */
  limp?: boolean; rel?: THREE.Quaternion[];
  /** Grip hand position (model space) while holding something: the head (four legs) or the arms (standing) reach for it. */
  hand?: THREE.Vector3 | null;
  /** Half the width of what it holds (one hoof on each side of it). */
  handW?: number;
  /** What it's doing with its hooves / mouth right now ('eat' = chomping, 'puff' = a drag on the cigarette) + progress 0..1. */
  act?: string; actK?: number;
  /** A lit cigarette in its mouth / hoof. */
  cig?: boolean;
  /** Spinach: Popeye arms. */
  strong?: boolean;
  /** Where its eyes look (world: another pig's head it glances at), or null = its own idle darting about. */
  lookAt?: THREE.Vector3 | null;
  /** Bloodshot, droopy eyes 0..1 (smoking / high). */
  red?: number;
  /** Blown up by a mine: a sizzling strip of bacon lies there instead of the pig. */
  bacon?: boolean;
  /** Dancing (the emote wheel: game/emotes.ts ids) and for how long (s). */
  dance?: number; danceT?: number;
  /** Sitting on the lounge couch: upright, leaning back into it, hind legs sticking out over the cushion. */
  sit?: boolean;
}

/** One frame of a dance: body offsets / turns, head, hind legs, each hoof's target (from its shoulder, pig model space:
 * +x = the pig's left, +y up, +z forward), front legs when it isn't standing, blissful eyes. */
interface DanceFrame {
  hipX: number; hipY: number; swayY: number; swayZ: number; upperY: number; upperZ: number; upperX: number;
  headX: number; headY: number; headZ: number; legL: number; legR: number; legLz: number; legRz: number;
  arm: [THREE.Vector3, THREE.Vector3]; frontL: number; frontR: number; rate: number; eyes: number; back: boolean; tail: number;
}
const DF: DanceFrame = { hipX: 0, hipY: 0, swayY: 0, swayZ: 0, upperY: 0, upperZ: 0, upperX: 0, headX: 0, headY: 0, headZ: 0, legL: 0, legR: 0, legLz: 0, legRz: 0,
  arm: [new THREE.Vector3(), new THREE.Vector3()], frontL: 0, frontR: 0, rate: 22, eyes: 1, back: false, tail: 4 };
const sm = (x: number) => { const k = clamp(x, 0, 1); return k * k * (3 - 2 * k); };
/** Robo Pork's poses: [left hoof, right hoof] (from the shoulder), head yaw / pitch, torso twist. */
const ROBO: [number[], number[], number, number, number][] = [
  [[0.22, 0.2, 0.08], [0.02, -0.26, 0.04], 0.55, 0, 0.25],
  [[-0.02, -0.26, 0.04], [-0.22, 0.2, 0.08], -0.55, 0, -0.25],
  [[0.02, 0.0, 0.34], [-0.02, 0.0, 0.34], 0, 0.25, 0],
  [[0.24, 0.02, 0.0], [-0.06, -0.24, 0.1], 0.35, -0.15, 0.35],
  [[0.12, 0.34, 0.06], [-0.12, 0.34, 0.06], 0, -0.35, 0],
  [[0.04, 0.04, 0.3], [-0.2, -0.1, -0.02], -0.4, 0.1, -0.3],
];

/**
 * The dances (game/emotes.ts): each a little choreography on a beat. 1 Hula Hog — hips round, both hooves wave like
 * the sea; 2 Robo Pork — snapping robot poses with servo clicks; 3 Pork Fever — disco point up / down, hip bounce, a
 * spin every 4 beats; 4 Bacon Spin — on its back, spinning, legs pedalling, a freeze now and then; 5 Cluck Strut —
 * chicken wings, pecking head, high steps, a clap; 6 Wiggle — turns its back and shakes its bum, looking over its shoulder.
 */
function danceFrame(id: number, t: number): DanceFrame {
  const D = DF;
  D.hipX = D.hipY = D.swayY = D.swayZ = D.upperY = D.upperZ = D.upperX = D.headX = D.headY = D.headZ = 0;
  D.legL = D.legR = D.legLz = D.legRz = D.frontL = D.frontR = 0; D.rate = 22; D.eyes = 1; D.back = false; D.tail = 6;
  const [L, R] = D.arm;
  const TAU = Math.PI * 2;
  switch (id) {
    case 1: {   // Hula Hog (100 bpm): hips circle, hooves flow side to side
      const b = t * (100 / 60), w = Math.sin(TAU * b / 2), c = Math.cos(TAU * b / 2);
      D.hipX = w * 0.07; D.hipY = -0.03 + Math.abs(Math.sin(Math.PI * b)) * 0.025; D.swayZ = w * 0.13; D.upperZ = -w * 0.12; D.upperX = c * 0.05;
      D.headZ = -w * 0.22; D.headX = -0.1; D.eyes = 0.45;
      L.set(0.08 + w * 0.26, 0.02 + Math.sin(TAU * b + 0.5) * 0.07, 0.2);
      R.set(-0.08 + w * 0.26, 0.02 + Math.sin(TAU * b + 2.1) * 0.07, 0.2);
      D.legL = Math.max(0, w) * 0.25; D.legR = Math.max(0, -w) * 0.25; D.tail = 3;
      break;
    }
    case 2: {   // Robo Pork (120 bpm, a pose every half beat): snap… hold
      const b = t * (120 / 60) * 2, k = Math.floor(b), f = b - k;
      const A = ROBO[k % ROBO.length], B = ROBO[(k + ROBO.length - 1) % ROBO.length], m = sm(f / 0.18);
      L.set(B[0][0] + (A[0][0] - B[0][0]) * m, B[0][1] + (A[0][1] - B[0][1]) * m, B[0][2] + (A[0][2] - B[0][2]) * m);
      R.set(B[1][0] + (A[1][0] - B[1][0]) * m, B[1][1] + (A[1][1] - B[1][1]) * m, B[1][2] + (A[1][2] - B[1][2]) * m);
      D.headY = B[2] + (A[2] - B[2]) * m; D.headX = B[3] + (A[3] - B[3]) * m; D.upperY = B[4] + (A[4] - B[4]) * m;
      D.hipY = -0.02 * Math.floor(k / 2 % 2); D.rate = 60; D.eyes = 1.15; D.tail = 0;
      D.legL = k % 4 === 1 ? 0.35 : 0; D.legR = k % 4 === 3 ? 0.35 : 0;
      break;
    }
    case 3: {   // Pork Fever (110 bpm): point up, point down; a spin every 4th beat
      const b = t * (110 / 60), k = Math.floor(b), f = b - k, up = k % 2 === 0;
      const spin = k % 8 === 7 ? sm(f) * TAU : 0;
      D.swayY = spin; D.hipY = -0.045 * Math.abs(Math.cos(Math.PI * b)); D.swayZ = (up ? 1 : -1) * 0.1 * sm(f * 3);
      R.copy(up ? _danceUp : _danceDown); L.set(0.16, -0.2, -0.04);   // the right hoof points, the left on the hip
      D.headX = up ? -0.35 : 0.3; D.headY = up ? -0.3 : 0.2; D.upperZ = up ? -0.12 : 0.1;
      D.legL = up ? 0.15 : 0; D.legR = up ? 0 : 0.15;
      break;
    }
    case 4: {   // Bacon Spin: on its back, spinning, legs pedalling; every 2.6 s a freeze pose
      const cyc = t % 2.6, frz = cyc > 2.1;
      D.back = true;
      D.swayY = (Math.floor(t / 2.6) * 2.1 + Math.min(cyc, 2.1)) * 7.5;
      const ped = frz ? 0 : t * 13;
      D.legL = frz ? -1.2 : Math.sin(ped) * 0.9; D.legR = frz ? 0.6 : Math.sin(ped + Math.PI) * 0.9;
      D.frontL = frz ? -1.4 : Math.sin(ped + 1.6) * 0.8; D.frontR = frz ? 0.3 : Math.sin(ped + 4.7) * 0.8;
      D.headY = frz ? 0.5 : Math.sin(t * 9) * 0.25; D.eyes = frz ? 0.4 : 1; D.tail = 14;
      break;
    }
    case 5: {   // Cluck Strut (130 bpm): flapping wings, pecking, high steps; a clap every 4 beats
      const b = t * (130 / 60), k = Math.floor(b), f = b - k, flap = Math.abs(Math.sin(TAU * b)), clap = k % 4 === 3;
      if (clap) { const c = Math.sin(Math.PI * clamp(f * 2, 0, 1)); L.set(0.04 - c * 0.06, 0.06, 0.24); R.set(-0.04 + c * 0.06, 0.06, 0.24); }
      else { L.set(0.12 + flap * 0.12, -0.04 + flap * 0.06, -0.03); R.set(-0.12 - flap * 0.12, -0.04 + flap * 0.06, -0.03); }
      D.headX = Math.sin(TAU * b) * 0.35; D.hipY = -0.05 * Math.abs(Math.sin(Math.PI * b)); D.swayZ = Math.sin(TAU * b * 2) * 0.07;
      D.legL = k % 2 === 0 ? Math.sin(Math.PI * f) * 0.7 : 0; D.legR = k % 2 === 1 ? Math.sin(Math.PI * f) * 0.7 : 0; D.rate = 34;
      break;
    }
    case 6: {   // Wiggle: back to the camera, bum shaking, glancing back over the shoulder
      const turn = sm(t / 0.4);
      D.swayY = turn * Math.PI; D.swayZ = Math.sin(t * 15) * 0.16 * turn; D.hipX = Math.sin(t * 15) * 0.05 * turn; D.hipY = -0.06;
      D.upperX = 0.25 * turn; D.headY = (Math.sin(t * 1.3) > 0 ? 1.1 : -1.1) * turn; D.headX = -0.15;
      L.set(0.14, -0.16, 0.08); R.set(-0.14, -0.16, 0.08); D.tail = 22; D.eyes = 1.1;
      D.legL = Math.max(0, Math.sin(t * 15)) * 0.2; D.legR = Math.max(0, -Math.sin(t * 15)) * 0.2;
      break;
    }
  }
  return D;
}
const _danceUp = new THREE.Vector3(-0.2, 0.42, 0.16), _danceDown = new THREE.Vector3(0.16, -0.24, 0.12);

/** A strip of bacon with googly eyes and a curly tail (what a pig becomes when it lands after a mine). */
function makeBacon() {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(0.44, 0.05, 1.3, 8, 1, 36);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const meat = new THREE.Color(0xc23d33), dark = new THREE.Color(0x9a2a24), fat = new THREE.Color(0xf7dcc8), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, pos.getY(i) + Math.sin(z * 9) * 0.055 + Math.sin(x * 7 + z * 3) * 0.01);
    const band = Math.cos(x * 34 + Math.sin(z * 5) * 0.8);
    c.copy(band > 0.45 ? fat : (Math.abs(x) > 0.17 ? dark : meat));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const strip = new THREE.Mesh(geo, toonMat(0xffffff, { vertexColors: true })); strip.castShadow = true; strip.receiveShadow = true;
  strip.position.y = 0.07; g.add(strip);
  const white = toonMat(0xffffff), black = toonMat(0x1b1010), pink = toonMat(0xffa9c2);
  for (const s of [-1, 1]) {   // googly eyes at the front end
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), white); e.position.set(s * 0.09, 0.17, 0.56); g.add(e);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 8), black); p.position.set(s * 0.09 + s * 0.012, 0.16, 0.625); p.name = 'pupil'; g.add(p);
  }
  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.016, 6, 12, Math.PI * 1.6), pink); tail.position.set(0, 0.14, -0.66); tail.rotation.y = Math.PI / 2; g.add(tail);
  return g;
}

/**
 * Procedurally animated cartoon pig: trot, stand up on the hind legs (front legs become arms), wallow on the back,
 * flail when ragdolled / carried, floppy ears, wiggly tail, blinking, squash & stretch, wobble on two legs,
 * hoof punch, outfit (hat, hair, glasses…).
 */
export class PigVisual {
  root = new THREE.Group();
  private roll = new THREE.Group();
  private base = new THREE.Group();
  private sway = new THREE.Group();
  rig: PigRig;
  private spots = new THREE.Group();
  private animParts: THREE.Object3D[] = [];
  private phase = 0; private standT = 0; private rollT = 0; private squash = 0;
  private lastGrounded = true; private blinkAt = 2;
  /** Eyes: the current idle dart (yaw / pitch, rad) and when the next one starts / this one ends; eyes' smoothed angles. */
  private baconG: THREE.Group | null = null;
  private backT = 0; private danceBeat = -1; private danceWas = 0; private sitT = 0;
  private dartAt = 1; private dartEnd = 0; private dartY = 0; private dartX = 0; private eyeY = 0; private eyeX = 0; private redOn = false;
  private limpT = 0; private lf = 0; private ls = 0;
  centerHeight = 0.36;
  outfit: Outfit = defaultOutfit();
  /** The beat of a dance, as sounds (every browser hears the dancer near it). */
  private danceSounds(p: PigPose) {
    const id = p.mode === 'normal' ? p.dance ?? 0 : 0, t = p.danceT ?? 0;
    if (id !== this.danceWas) { this.danceWas = id; this.danceBeat = -1; }
    if (!id) return;
    const at = this.root.position;
    const beat = (bpm: number, sub = 1) => Math.floor(t * (bpm / 60) * sub);
    const k = id === 1 ? beat(100) : id === 2 ? beat(120, 2) : id === 3 ? beat(110) : id === 4 ? Math.floor(t * 7.5 / (Math.PI * 2) + (t % 2.6 > 2.1 ? 100 : 0)) : id === 5 ? beat(130) : Math.floor(t / 0.6);
    if (k === this.danceBeat) return;
    const first = this.danceBeat < 0; this.danceBeat = k;
    if (first) return;
    switch (id) {
      case 1: if (k % 4 === 0) G.audio.play('oink', { pos: at, vol: 0.35, pitch: 1.35, minGap: 0.5 }); break;
      case 2: G.audio.play('tick', { pos: at, vol: 0.45, pitch: 2.4 + (k % 3) * 0.2 }); if (k % 8 === 0) G.audio.play('unlock', { pos: at, vol: 0.3, pitch: 2.2 }); break;
      case 3: if (k % 8 === 7) G.audio.play('whoosh', { pos: at, vol: 0.5, pitch: 1.2 }); else if (k % 2 === 0) G.audio.play('oink', { pos: at, vol: 0.3, pitch: 1.5, minGap: 0.3 }); break;
      case 4: G.audio.play(k >= 100 ? 'oink' : 'whoosh', { pos: at, vol: 0.4, pitch: k >= 100 ? 1.3 : 1.4, minGap: 0.15 }); break;
      case 5: if (k % 4 === 3) G.audio.play('slap', { pos: at, vol: 0.45, pitch: 1.7 }); else if (k % 2 === 0) G.audio.play('cluck', { pos: at, vol: 0.4, pitch: 0.9, minGap: 0.3 }); break;
      case 6: if (k % 2 === 0) G.audio.play('oink', { pos: at, vol: 0.4, pitch: 1.6, minGap: 0.4 }); break;
    }
  }

  /** Bacon: the pig hides, a strip of bacon lies flat under where it is (its heading), sizzling, eyes rolling. */
  private baconStep(p: PigPose) {
    const on = !!p.bacon;
    if (!on && !this.baconG?.visible) return;
    if (!this.baconG) { this.baconG = makeBacon(); }
    if (!this.baconG.parent && this.root.parent) this.root.parent.add(this.baconG);
    this.baconG.visible = on; this.sway.visible = !on;
    if (!on) return;
    const r = this.root.position, b = this.baconG;
    b.position.set(r.x, G.terrain.height(r.x, r.z) + 0.02, r.z);
    const f = _look.set(0, 0, 1).applyQuaternion(this.root.quaternion);
    b.rotation.y = Math.atan2(f.x, f.z);
    b.scale.set(1, 1, 0.96 + Math.sin(p.t * 3) * 0.04);   // curling up in the heat
    let k = 0; b.traverse((o) => { if (o.name === 'pupil') { o.position.x = (k++ ? 1 : -1) * 0.09 + Math.sin(p.t * 6 + k) * 0.025; } });
    if (Math.random() < p.dt * 5) G.fx.puff(_look.set(b.position.x + (Math.random() - 0.5) * 0.3, b.position.y + 0.15, b.position.z + (Math.random() - 0.5) * 0.6), { count: 1, color: 0xffffff, spread: 0.05, speed: 0.2, up: 0.9, life: 0.9, size: 0.25, grow: 0.4, alpha: 0.45 });
    if (Math.random() < p.dt * 0.9) G.audio.play('sizzle', { pos: b.position, vol: 0.5, pitch: 1.2 + Math.random() * 0.2, minGap: 0.6 });
  }

  /**
   * Living eyes (user: "when a pig is next to me my eyes look at it now and then, and they dart about by themselves"):
   * the eye groups turn about their centres (the pupils roll round the eyeballs), toward `p.lookAt`, else small random
   * darts; red glaze on when smoking / high.
   */
  private lookStep(p: PigPose, dt: number, red: number) {
    const R = this.rig;
    let ty = 0, tx = 0;
    if (p.lookAt && !p.limp) {
      const l = R.head.worldToLocal(_look.copy(p.lookAt)), e0 = R.eyes[0].position;
      l.y -= e0.y; l.z -= e0.z;
      ty = clamp(Math.atan2(l.x, Math.max(l.z, 0.05)), -0.55, 0.55);
      tx = clamp(-Math.atan2(l.y, Math.max(Math.hypot(l.x, l.z), 0.05)), -0.35, 0.35);
    } else {
      if (p.t > this.dartAt) {
        if (Math.random() < 0.7) { this.dartY = (Math.random() - 0.5) * 1.0; this.dartX = (Math.random() - 0.5) * 0.4; }
        else { this.dartY = 0; this.dartX = 0; }
        this.dartEnd = p.t + 0.25 + Math.random() * 0.8; this.dartAt = p.t + 1.2 + Math.random() * 2.6;
      }
      if (p.t < this.dartEnd) { ty = this.dartY; tx = this.dartX; }
    }
    // eyes snap (saccades): fast toward the target
    this.eyeY = damp(this.eyeY, ty, 22, dt); this.eyeX = damp(this.eyeX, tx, 22, dt);
    for (const e of R.eyes) { e.rotation.y = this.eyeY; e.rotation.x = this.eyeX; }
    const on = red > 0.1;
    if (on !== this.redOn) { this.redOn = on; for (const e of R.eyes) { const m = e.getObjectByName('redEye'); if (m) m.visible = on; } }
  }

  /** The lit cigarette: between the toes of the right hoof (standing, hooves free) or in the corner of the mouth. */
  private cig = makeCigarette();
  private ember: THREE.Mesh;
  private bulge = 1;
  /** Four legs, reaching far (the mouse wheel): the neck stretches (rubber neck) — how far, and the neck piece. */
  private neckX = 0; private headRest = new THREE.Vector3(); private neck: THREE.Mesh;

  constructor(public color: number, outfit?: Outfit) {
    this.root.add(this.sway); this.sway.add(this.roll); this.roll.add(this.base);
    this.rig = buildPig(this.base);
    rigidSkin(this.base, undefined, new Set(this.rig.skin.map((s) => s.mat)));   // one draw call per skin colour, not ~40 meshes
    this.spots.position.copy(PIVOT).negate(); this.rig.upper.add(this.spots);
    this.setOutfit(outfit ?? defaultOutfit());
    this.cig.visible = false; this.cig.scale.setScalar(1.5);
    this.ember = this.cig.getObjectByName('ember') as THREE.Mesh;
    this.headRest.copy(this.rig.head.position);
    this.neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 1, 14, 1, true), this.rig.bodyMat);
    this.neck.visible = false; this.neck.castShadow = true; this.rig.upper.add(this.neck);
    this.buildMud();
  }

  // ---------------------------------------------------------------- mud splotches
  private mudMat = new THREE.MeshToonMaterial({ color: MUD_WET.clone(), gradientMap: RAMP });
  private splats: MudSplat[] = [];
  private mudMeshes: THREE.InstancedMesh[] = [];
  private mudShown = -1;
  private buildMud() {
    const R = this.rig;
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const UP = new THREE.Vector3(0, 1, 0);
    const group = (parent: THREE.Object3D, list: { pos: THREE.Vector3; n: THREE.Vector3; size: number }[]) => {
      const m = new THREE.InstancedMesh(MUD_GEO, this.mudMat, list.length);
      m.castShadow = false; m.frustumCulled = false; m.visible = false; m.name = 'mud';
      parent.add(m); this.mudMeshes.push(m);
      list.forEach((l, i) => {
        const q = new THREE.Quaternion().setFromUnitVectors(UP, l.n).multiply(new THREE.Quaternion().setFromAxisAngle(UP, rnd() * 6.28));
        // flakes off at its own moment (bigger ones last longer); a few go early
        this.splats.push({ m, i, pos: l.pos.clone().addScaledVector(l.n, -0.012), q, s: new THREE.Vector3(l.size, l.size * 0.55, l.size * (0.7 + rnd() * 0.5)), t: 0.04 + rnd() * 0.55 * (1.2 - l.size * 3) });
      });
    };
    // body: the pear-shaped ellipsoid (centre (0, 0.5, −0.02), radii 0.37 / 0.34 / 0.55) in `upper` space
    const c = new THREE.Vector3(0, 0.5, -0.02).sub(PIVOT), body: { pos: THREE.Vector3; n: THREE.Vector3; size: number }[] = [];
    for (let k = 0; body.length < 22 && k < 400; k++) {
      const d = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); if (d.lengthSq() > 1 || d.lengthSq() < 0.05) continue; d.normalize();
      if (d.y < -0.55 || d.z > 0.8) continue;   // not under the belly, not inside the neck
      const kk = 1 + Math.max(0, -d.z) * 0.09 - Math.max(0, d.z) * 0.04;
      const pt = new THREE.Vector3(d.x * kk * 0.37, (d.y * kk - (d.y < 0 ? 0.04 : 0)) * 0.34, d.z * 0.55);
      const n = new THREE.Vector3(pt.x / 0.137, pt.y / 0.116, pt.z / 0.3).normalize();
      body.push({ pos: pt.add(c), n, size: 0.06 + rnd() * 0.09 });
    }
    group(R.upper, body);
    // head (sphere r 0.28 at (0, 0.63, 0.42), in head space): the forehead, the cheeks, the top — not the eyes / snout
    const hc = new THREE.Vector3(0, 0.63, 0.42).sub(NECK), head: { pos: THREE.Vector3; n: THREE.Vector3; size: number }[] = [];
    for (const [x, y, z, sz] of [[0, 0.95, 0.15, 0.07], [0.75, 0.3, 0.45, 0.06], [-0.8, 0.1, 0.4, 0.055], [0.45, 0.85, -0.2, 0.05], [-0.55, 0.7, -0.35, 0.06], [0.2, -0.6, 0.55, 0.045]]) {
      const n = new THREE.Vector3(x, y, z).normalize();
      head.push({ pos: n.clone().multiplyScalar(0.28).add(hc), n, size: sz });
    }
    group(R.head, head);
    // legs: mud socks (round the lower leg) on the hind legs, a couple on each forearm
    const sock = (r: number, y0: number, n: number) => {
      const out: { pos: THREE.Vector3; n: THREE.Vector3; size: number }[] = [];
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + rnd(), nn = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)); out.push({ pos: nn.clone().multiplyScalar(r).setY(y0 + (rnd() - 0.5) * 0.08), n: nn, size: 0.045 + rnd() * 0.025 }); }
      return out;
    };
    group(R.hindL, sock(0.08, -0.22, 4)); group(R.hindR, sock(0.08, -0.22, 4));
    for (const a of R.arms) group(a.segL, sock(0.072, -0.06, 3));
  }
  /** Mud left 0..1: wet and dark → pale and cracked → each splotch falls off at its moment (snow: white clumps). */
  private updateMud(left: number) {
    const k = Math.round(left * 200) / 200;
    if (k === this.mudShown) return;
    this.mudShown = k;
    const on = k > 0.001;
    for (const m of this.mudMeshes) m.visible = on;
    if (!on) return;
    if (G.snowy) this.mudMat.color.copy(SNOW_CLUMP);
    else this.mudMat.color.copy(MUD_WET).lerp(MUD_DRY, clamp((1 - k) * 1.6 - 0.15, 0, 1));
    const fresh = 1 + Math.max(0, k - 0.9) * 2.5;   // just rolled: a bit puffier
    for (const sp of this.splats) {
      const f = clamp((k - sp.t) / 0.08, 0, 1) * fresh;
      _bm.compose(sp.pos, sp.q, _v.copy(sp.s).multiplyScalar(Math.max(f, 1e-4)));
      sp.m.setMatrixAt(sp.i, _bm);
    }
    for (const m of this.mudMeshes) m.instanceMatrix.needsUpdate = true;
  }
  /** World position of the cigarette's ember (null when not smoking). */
  cigTip(out: THREE.Vector3) { return this.cig.visible && this.cig.parent ? this.ember.getWorldPosition(out) : null; }
  /** World position of the snout (smoke comes out of it). */
  snoutPos(out: THREE.Vector3) { return this.rig.anchors.snout.getWorldPosition(out); }

  setOutfit(o: Outfit) {
    this.outfit = { ...o };
    this.animParts = dress(this.rig, this.outfit, this.color, this.spots);
  }

  /** Knocked over while standing: the physics torso takes over the standing pose at once. */
  snapStand() { this.standT = 0; this.rig.upper.position.copy(PIVOT); this.rig.upper.rotation.set(0, 0, 0); }

  /**
   * Two-bone IK (upper space): shoulder → elbow → hoof tips reach T, the elbow bends toward `pole`. Out of reach the
   * arm stretches like a rubber hose (cartoon) up to 3.6× (the mouse wheel's long reach).
   */
  private solveArm(a: Arm, T: THREE.Vector3, pole: THREE.Vector3, rate: number, dt: number) {
    const S = a.shoulder.position, L1 = ARM.upper, L2 = ARM.fore;
    const dir = _v.copy(T).sub(S);
    let d = dir.length(); dir.divideScalar(Math.max(d, 1e-4));
    const st = clamp(d / ((L1 + L2) * 0.97), 1, 3.6), l1 = L1 * st, l2 = L2 * st;
    d = clamp(d, Math.abs(l1 - l2) + 0.02, (l1 + l2) * 0.97);
    const ang = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
    _pp.copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (_pp.lengthSq() < 1e-6) _pp.set(0, -1, 0).addScaledVector(dir, dir.y);
    _pp.normalize();
    _el.copy(S).addScaledVector(dir, l1 * Math.cos(ang)).addScaledVector(_pp, l1 * Math.sin(ang));
    const u = _u.copy(_el).sub(S).normalize();
    const w = _w.copy(S).addScaledVector(dir, d).sub(_el).normalize();
    const bend = Math.acos(clamp(u.dot(w), -1, 1));
    _bz.copy(w).addScaledVector(u, -u.dot(w));
    if (_bz.lengthSq() < 1e-6) _bz.copy(_pp).addScaledVector(u, -u.dot(_pp));
    _bz.normalize().negate();
    _by.copy(u).negate();
    _bx.crossVectors(_by, _bz).normalize();
    _bz.crossVectors(_bx, _by);
    _bq.setFromRotationMatrix(_bm.makeBasis(_bx, _by, _bz));
    const k = 1 - Math.exp(-rate * dt);
    a.shoulder.quaternion.slerp(_bq, k);
    a.elbow.rotation.x += (bend - a.elbow.rotation.x) * k;
    a.segU.scale.y = a.segL.scale.y = a.segU.scale.y + (st - a.segU.scale.y) * k;
    a.elbow.position.y = -ARM.upper * a.segU.scale.y; a.hand.position.y = -ARM.hand * a.segU.scale.y;
  }

  update(p: PigPose) {
    const dt = p.dt, R = this.rig;
    this.baconStep(p);
    const standTarget = p.standing && p.mode !== 'ragdoll' && p.mode !== 'wallow' ? 1 : 0;
    this.standT = damp(this.standT, standTarget, 10, dt);
    this.rollT = damp(this.rollT, p.mode === 'wallow' ? 1 : 0, 9, dt);
    const sT = this.standT;

    const moving = p.grounded && p.speed > 0.3 && p.mode === 'normal';
    const stride = p.sprinting ? 2.3 : sT > 0.5 ? 3.3 : 2.8;
    this.phase += dt * (moving ? Math.max(4, p.speed * stride) : 0);
    const amp = moving ? clamp(p.speed / 4.5, 0.25, 1) * (p.sprinting ? 1.0 : 0.65) : 0;
    const s1 = Math.sin(this.phase), s2 = Math.sin(this.phase + Math.PI);

    // squash & stretch
    if (p.grounded && !this.lastGrounded) this.squash = clamp(-p.vy * 0.035 + 0.12, 0.1, 0.32);
    this.lastGrounded = p.grounded;
    this.squash = damp(this.squash, 0, 9, dt);
    const stretch = !p.grounded ? clamp(p.vy * 0.022, -0.1, 0.14) : 0;
    const breath = Math.sin(p.t * 2.6) * 0.018;
    this.base.scale.set(1 + this.squash * 0.6 - stretch * 0.5, 1 - this.squash + stretch + breath, 1 + this.squash * 0.3);

    // balance on two legs: the whole pig leans around its feet exactly as the physics lean says (smoothed a touch:
    // the sim runs at 60 Hz). The pivot is at the feet: sway sits at foot level, roll / base are lifted back up.
    const w = clamp(p.wobble ?? 0, 0, 1);
    const lk = Math.max(sT, p.beam ? 0.8 : 0);
    this.lf = damp(this.lf, (p.leanF ?? 0) * lk, 30, dt); this.ls = damp(this.ls, (p.leanS ?? 0) * lk, 30, dt);
    this.sway.position.y = -this.centerHeight;
    this.sway.rotation.x = this.lf;
    this.sway.rotation.z = -this.ls;
    // dancing: the whole body moves on the beat
    const dz = p.dance && p.mode === 'normal' ? danceFrame(p.dance, p.danceT ?? 0) : null;
    this.danceSounds(p);
    this.sway.rotation.y = dz ? dz.swayY : damp(this.sway.rotation.y, 0, 12, dt);
    if (dz) { this.sway.rotation.z += dz.swayZ; this.base.position.x = dz.hipX; } else this.base.position.x = damp(this.base.position.x, 0, 12, dt);
    this.sitT = damp(this.sitT, p.sit ? 1 : 0, 10, dt);
    if (this.sitT > 0.01) { this.sway.rotation.x -= 0.32 * this.sitT; if (dz) this.sway.rotation.y *= 0.15; }   // lean back into the couch (seated dances stay seated)

    // hinge
    R.upper.position.lerpVectors(PIVOT, STAND_POS, sT);
    R.upper.rotation.x = -STAND_ANGLE * sT + (moving ? Math.sin(this.phase * 2) * 0.04 * amp : 0) + (p.punch ? Math.sin(p.punch * Math.PI) * 0.15 * sT : 0);
    R.upper.rotation.z = moving ? Math.sin(this.phase) * 0.06 * amp * (sT * 2 + 0.6) : 0;
    this.base.position.y = -this.centerHeight + (moving ? Math.abs(Math.sin(this.phase)) * 0.05 * amp : 0) + (dz ? dz.hipY : 0) - this.sitT * 0.16;
    R.upper.rotation.y = dz ? dz.upperY : 0;
    if (dz) { R.upper.rotation.z += dz.upperZ; R.upper.rotation.x += dz.upperX; }
    // headbutt (four legs): the body lunges, the head ducks and rams
    const butt = p.punch && sT < 0.5 && !p.holding ? Math.sin(clamp(p.punch, 0, 1) * Math.PI) : 0;
    if (butt) { R.upper.position.z += butt * 0.22; R.upper.rotation.x += butt * 0.18; }

    // legs
    const flail = p.mode === 'ragdoll' || p.mode === 'held' || (p.mode === 'wallow' && this.rollT > 0.5);
    const air = !p.grounded && p.mode === 'normal';
    const set = (o: THREE.Object3D, x: number, z = 0, k = 22) => { o.rotation.x = damp(o.rotation.x, x, k, dt); o.rotation.z = damp(o.rotation.z, z, k, dt); };
    // standing (and in control): the front legs are arms driven by IK (hands reach, hold, punch, bring things to the mouth)
    const ik = sT > 0.5 && !flail;
    const A = R.arms;
    if (flail) {
      const f = p.t * (p.mode === 'wallow' ? 12 : 19);
      set(R.frontL, Math.sin(f) * 0.9, 0.3); set(R.frontR, Math.sin(f + 2) * 0.9, -0.3);
      set(R.hindL, Math.sin(f + 1) * 0.9, 0.3); set(R.hindR, Math.sin(f + 3) * 0.9, -0.3);
      A[0].elbow.rotation.x = damp(A[0].elbow.rotation.x, 0.4 + Math.sin(f * 1.3) * 0.5, 16, dt);
      A[1].elbow.rotation.x = damp(A[1].elbow.rotation.x, 0.4 + Math.sin(f * 1.3 + 2) * 0.5, 16, dt);
    } else if (air) {
      if (!ik) {
        set(R.frontL, -0.75 + sT * 1.6, 0.2); set(R.frontR, -0.75 + sT * 1.6, -0.2);
        for (const a of A) a.elbow.rotation.x = damp(a.elbow.rotation.x, 0.9, 14, dt);   // hooves tucked in
      }
      set(R.hindL, 0.75 - sT * 0.5, 0.2); set(R.hindR, 0.75 - sT * 0.5, -0.2);
    } else {
      set(R.hindL, s1 * amp * (1 + sT * 0.3)); set(R.hindR, s2 * amp * (1 + sT * 0.3));
      if (!ik) {
        const arm = lerp(0, (p.holding ? 0.2 : 1.05) * STAND_ANGLE, sT);
        let fl = arm + s2 * amp, fr = arm + s1 * amp;
        if (p.charging > 0) { fl = fr = arm - p.charging * 1.3; }
        set(R.frontL, fl, sT * 0.15); set(R.frontR, fr, -sT * 0.15);
        // trot: the hoof folds back as the leg swings forward
        A[0].elbow.rotation.x = damp(A[0].elbow.rotation.x, Math.max(0, Math.cos(this.phase + Math.PI)) * 0.85 * amp, 20, dt);
        A[1].elbow.rotation.x = damp(A[1].elbow.rotation.x, Math.max(0, Math.cos(this.phase)) * 0.85 * amp, 20, dt);
      }
    }
    if (this.sitT > 0.5 && !flail) {   // sitting: legs straight out over the cushion (a little kick when dancing)
      set(R.hindL, -1.35 + (dz ? dz.legL * 0.6 : 0), 0.12, 18); set(R.hindR, -1.35 + (dz ? dz.legR * 0.6 : 0), -0.12, 18);
    } else if (dz && !flail) {
      set(R.hindL, dz.legL, dz.legLz, 26); set(R.hindR, dz.legR, dz.legRz, 26);
      if (dz.back) { set(R.frontL, dz.frontL, 0.3, 26); set(R.frontR, dz.frontR, -0.3, 26); }
    }
    R.hindL.position.x = 0.2 * (1 + sT * 0.15); R.hindR.position.x = -0.2 * (1 + sT * 0.15);

    // head: looks ahead when standing; reaches for what it holds (four legs)
    _q.setFromEuler(_e.set(HEAD_TILT * sT + butt * 0.55, 0, 0));
    R.upper.updateMatrix();
    _mi.copy(R.upper.matrix).invert();
    if (p.hand && !flail && sT < 0.5) {
      _p.copy(p.hand).applyMatrix4(_mi);      // hand in the upper body's space
      _d.copy(_p).sub(this.headRest).normalize();
      _qi.setFromUnitVectors(SNOUT_DIR, _d);
      const ang = 2 * Math.acos(Math.min(1, Math.abs(_qi.w)));
      if (ang > 1.1) _qi.slerp(_q.identity(), 1 - 1.1 / ang);
      _q.setFromEuler(_e.set(HEAD_TILT * sT, 0, 0)).premultiply(_qi);
    }
    // eating: chomp chomp (the head bobs; the food is at the mouth); a puff: chin up, then blow the smoke out
    const act = flail ? '' : p.act ?? '', ak = clamp(p.actK ?? 0, 0, 1);
    if (act === 'eat') _q.multiply(_qi.setFromEuler(_e.set(0.25 * sT + Math.sin(p.t * 19) * 0.16, 0, Math.sin(p.t * 7) * 0.08)));
    if (act === 'puff') _q.multiply(_qi.setFromEuler(_e.set(-Math.sin(ak * Math.PI) * 0.3, 0, 0)));
    if (dz) _q.multiply(_qi.setFromEuler(_e.set(dz.headX, dz.headY, dz.headZ)));
    R.head.quaternion.slerp(_q, 1 - Math.exp(-16 * dt));
    // four legs, holding / working far out in front (the mouse wheel): the neck stretches toward it
    let nx = 0;
    if (p.hand && !flail && sT < 0.5) {
      _p.copy(p.hand).applyMatrix4(_mi);
      nx = clamp(_p.distanceTo(this.headRest) - 0.52, 0, 0.7);
    }
    this.neckX = damp(this.neckX, nx, 14, dt);
    if (this.neckX > 0.01) {
      _d.copy(SNOUT_DIR).applyQuaternion(R.head.quaternion);
      R.head.position.copy(this.headRest).addScaledVector(_d, this.neckX);
      this.neck.visible = true;
      this.neck.position.copy(this.headRest).addScaledVector(_d, this.neckX * 0.5);
      this.neck.quaternion.setFromUnitVectors(_v.set(0, 1, 0), _d);
      this.neck.scale.set(1, this.neckX + 0.12, 1);
    } else if (this.neck.visible) { this.neck.visible = false; R.head.position.copy(this.headRest); }

    // arms (standing): where each hoof goes, in the pig's model space (feet = origin, facing +z, +x = its left)
    if (ik) {
      R.head.updateMatrix();
      const mouth = _mouth.copy(R.anchors.snout.position).applyMatrix4(R.head.matrix).applyMatrix4(R.upper.matrix);
      const punchK = p.punch ? Math.sin(clamp(p.punch, 0, 1) * Math.PI) : 0;
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? 1 : -1, a = A[i];
        const S = _sh.copy(a.shoulder.position).applyMatrix4(R.upper.matrix);
        const T = _t;
        let rate = 22, grip = 0.15;
        if (w > 0.45) {   // windmilling: about to fall
          const k = (w - 0.45) / 0.55, ph = p.t * 16 + (i ? Math.PI : 0);
          T.set(S.x + side * (0.12 + 0.12 * k), S.y + Math.cos(ph) * 0.26 * k + 0.05, S.z + Math.sin(ph) * 0.26 * k + 0.08);
          rate = 30; grip = 0.3;
        } else if (p.hand) {
          // holding: one hoof on each side of the thing
          const hw = clamp(p.handW ?? 0.15, 0.06, 0.32);
          T.copy(p.hand); T.x += side * hw; T.y -= 0.02; T.z -= 0.03;
          rate = 30; grip = 0;
        } else if (air) {
          T.set(S.x + side * 0.16, S.y + 0.22, S.z + 0.08); grip = 0.35;
        } else if (dz) {
          T.copy(S).add(dz.arm[i]); rate = dz.rate; grip = 0.2;
        } else if (punchK > 0 && i === 1) {
          T.set(S.x + 0.1 * punchK, S.y + 0.06, S.z + 0.16 + 0.46 * punchK); rate = 45; grip = 0;
        } else if (act === 'puff' && i === 1 && p.cig) {
          const k = Math.sin(ak * Math.PI);
          T.set(S.x - side * 0.02, S.y - 0.02, S.z + 0.22).lerp(_v.copy(mouth).add(_off.set(-0.09, -0.03, 0.03)), clamp(k * 1.6, 0, 1));
          grip = 0;
        } else {
          // T-rex arms: hooves in front of the belly, swinging a little as it walks (a fist up when the other punches)
          const sw = moving ? Math.sin(this.phase + (i ? 0 : Math.PI)) * 0.07 * amp : 0;
          const guard = punchK > 0 ? 0.08 : 0;
          const smoker = p.cig && i === 1 ? 0.06 : 0;
          T.set(S.x - side * 0.04, S.y - 0.16 + guard + smoker + breath * 0.5, S.z + 0.17 + sw + guard);
          grip = p.cig && i === 1 ? 0 : 0.12;
        }
        _pole.set(side * 0.6, -1, -0.6).normalize().applyQuaternion(_uq.copy(R.upper.quaternion).invert());
        this.solveArm(a, T.applyMatrix4(_mi), _pole, rate, dt);
        for (const [j, toe] of a.toes.entries()) toe.rotation.z = damp(toe.rotation.z, (j ? -1 : 1) * grip, 20, dt);
      }
    } else {
      for (const a of A) {
        a.segU.scale.y = a.segL.scale.y = damp(a.segU.scale.y, 1, 14, dt);
        a.elbow.position.y = -ARM.upper * a.segU.scale.y; a.hand.position.y = -ARM.hand * a.segU.scale.y;
        for (const [j, toe] of a.toes.entries()) toe.rotation.z = damp(toe.rotation.z, (j ? -1 : 1) * 0.08, 20, dt);
      }
    }

    // the cigarette: in the right hoof when it has free hooves on two legs, else in the corner of the mouth
    this.cig.visible = !!p.cig;
    if (p.cig) {
      const inHoof = ik && !p.hand;
      const parent = inHoof ? A[1].hand : R.anchors.snout;
      if (this.cig.parent !== parent) {
        parent.add(this.cig);
        if (inHoof) { this.cig.position.set(0, -0.085, 0.01); this.cig.rotation.set(Math.PI / 2, 0, 0); }
        else { this.cig.position.set(-0.12, 0.01, -0.03); this.cig.rotation.set(0.2, -0.75, 0); }
      }
      const glow = act === 'puff' ? Math.sin(ak * Math.PI) : 0;
      (this.ember.material as THREE.MeshBasicMaterial).color.setRGB(1, 0.3 + glow * 0.5, 0.08 + glow * 0.3);
      this.ember.scale.setScalar(1 + glow * 0.5);
    }
    // spinach: Popeye arms
    this.bulge = damp(this.bulge, p.strong ? 1.5 : 1, 6, dt);
    for (const a of A) { a.segU.scale.x = a.segU.scale.z = this.bulge; a.segL.scale.x = a.segL.scale.z = 1 + (this.bulge - 1) * 0.6; }

    // limp: every part shows its physical rotation (head + legs flop, swing, hang)
    this.limpT = damp(this.limpT, p.limp ? 1 : 0, p.limp ? 25 : 8, dt);
    if (this.limpT > 0.01 && p.rel) {
      R.head.quaternion.slerp(p.rel[0], this.limpT);
      [R.frontL, R.frontR, R.hindL, R.hindR].forEach((leg, i) => leg.quaternion.slerp(p.rel![i + 1], this.limpT));
    }

    // ears flop with speed / bounce, tail wiggles, blink
    const flop = 0.55 + (moving ? Math.sin(this.phase * 2) * 0.25 * amp : 0) - (air ? 0.5 : 0) + (flail ? Math.sin(p.t * 17) * 0.4 : 0);
    set(R.earL, flop, -0.55 + (flail ? Math.sin(p.t * 13) * 0.3 : 0), 14); set(R.earR, flop, 0.55 - (flail ? Math.sin(p.t * 11) * 0.3 : 0), 14);
    R.tail.rotation.y = Math.sin(p.t * (dz ? dz.tail : moving ? 14 : 4)) * (moving || dz ? 0.5 : 0.25);
    if (p.t > this.blinkAt) this.blinkAt = p.t + 2 + Math.random() * 3;
    const red = clamp(p.red ?? 0, 0, 1);
    const blink = Math.min(this.blinkAt - p.t < 0.12 ? 0.1 : dz ? dz.eyes : 1, 1 - red * 0.42);   // stoned: droopy lids
    for (const e of R.eyes) e.scale.y = flail ? 0.25 : damp(e.scale.y, blink, 30, dt);
    this.lookStep(p, dt, red);

    // wallow: roll onto the back (around the body's middle, not the feet)
    this.backT = damp(this.backT, dz?.back ? 1 : 0, 9, dt);   // (the breakdance spin is on its back too)
    const rT = Math.max(this.rollT, this.backT);
    this.roll.rotation.z = rT * Math.PI * (1 + Math.sin(p.t * 9) * 0.04 * this.rollT);
    this.roll.position.y = this.centerHeight + rT * 0.12;

    // outfit animation
    for (const a of this.animParts) {
      if (a.name === 'spin') a.rotation.y += dt * (8 + p.speed * 6);
      else a.rotation.y = (a.name === 'wingL' ? -1 : 1) * (0.15 + Math.sin(p.t * (moving || air ? 18 : 3)) * (moving || air ? 0.45 : 0.1));
    }

    // mud / burnt tint (the splotches carry the mud now: the skin only gets a dusty tinge)
    this.updateMud(p.mudLeft ?? 0);
    const m = clamp(p.muddy, 0, 1) * 0.35;
    const b = clamp(p.burnt ?? 0, 0, 1) * 0.75;
    for (const s of R.skin) s.mat.color.copy(s.base).lerp(G.snowy ? SNOW_COAT : MUD, m).lerp(BURNT, b);
    if (b > 0 && Math.random() < p.dt * 6 * b) G.fx.puff(this.root.position, { count: 1, color: 0x555555, spread: 0.2, speed: 0.2, up: 0.8, life: 1.2, size: 0.4, grow: 0.6, alpha: 0.35 });
  }
}
