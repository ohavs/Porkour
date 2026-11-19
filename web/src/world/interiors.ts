import * as THREE from 'three';
import { G } from '../game/ctx';
import { fitted, has } from '../core/assets';
import { Prop, PROPS, type PropDef } from './props';
import { HANDS } from './hands';
import { SEATS } from './seats';
import { toonMat } from '../render/toon';
import { rigidSkin } from '../render/batch';
import type { Pig } from '../pig/pig';
import type { Nav } from '../farmer/nav';
import type { BobJob } from '../farmer/farmer';
import { makeTV, makePie } from './funProps';
import { drawChannel } from './lounge';
import type { Loop } from '../core/audio';

/**
 * Furniture inside the buildings (user: "the maps are full, but the insides of buildings feel empty: furniture and lots
 * of things, all of them grab & throw, some with more to do"). Every building a pig can walk into (found on the nav
 * grid: free floor inside its footprint that the yard reaches) gets furnished by its kind — a house: living room,
 * kitchen, bedroom, bathroom bits; a barn / stable / mill: an old couch, a table and stools, shelves, a beer fridge,
 * a cot. Quaternius Ultimate House Interior (CC0). Big pieces go against the walls, facing in; the doorway stays clear.
 * Every piece is a prop: light ones you carry and throw, big ones are heavy (two pigs / spinach drag them) — and loot.
 * More to do: sit on couches, chairs, stools, beds, the bathtub, the toilet (getting up flushes it — Bob hears),
 * hit a lamp = on / off, RMB at the fridge = a can out of it, RMB at the washing machine = a noisy shaking spin.
 * s23 (user: "more pieces with something to do: TV, radio, oven, bathroom"): an old TV (RMB = on / next channel /
 * off: chatter Bob hears), a radio (a hit = on / off; carry it anywhere while it plays: music Bob hears from far —
 * he walks over and switches it off = a lure), the oven (RMB = bake: 16 s later a pie pops out on top, 2 per oven —
 * throw it in Bob's face), the bathtub (sit in it: the taps fill it, a bubble bath washes the mud off).
 * Deterministic (seeded by the building's spot): every machine furnishes the same; lamps / the spin are synced.
 */
type Use = 'lamp' | 'fridge' | 'wash' | 'tv' | 'radio' | 'oven' | 'bath' | 'gramo';
interface Kind {
  /** Quaternius model name (or `make` = built in code), its height (m), mass (kg), loot value; against a wall (`wall`) or free-standing. */
  m: string; h: number; mass: number; value: number; wall?: boolean; make?: () => THREE.Object3D;
  /** Seats: [x share of its width, cushion height (m above the floor), z share of its depth, facing (rad)]. */
  seats?: [number, number, number, number][];
  use?: Use; shape?: 'box' | 'cyl';
}
const K: Record<string, Kind> = {
  couchL: { m: 'Couch_Large1', h: 0.95, mass: 75, value: 60, wall: true, seats: [[-0.36, 0.48, 0.1, 0], [-0.12, 0.48, 0.1, 0], [0.12, 0.48, 0.1, 0], [0.36, 0.48, 0.1, 0]] },
  couchM: { m: 'Couch_Medium1', h: 0.95, mass: 60, value: 45, wall: true, seats: [[-0.22, 0.48, 0.1, 0], [0.22, 0.48, 0.1, 0]] },
  couchS: { m: 'Couch_Small1', h: 0.95, mass: 45, value: 35, wall: true, seats: [[-0.22, 0.48, 0.1, 0], [0.22, 0.48, 0.1, 0]] },
  chair1: { m: 'Chair_1', h: 1.0, mass: 6, value: 10, seats: [[0, 0.5, 0.05, 0]] },
  chair2: { m: 'Chair_2', h: 1.0, mass: 6, value: 10, seats: [[0, 0.5, 0.05, 0]] },
  chair3: { m: 'Chair_3', h: 1.0, mass: 6, value: 10, seats: [[0, 0.5, 0.05, 0]] },
  stool: { m: 'Stool', h: 0.55, mass: 4, value: 6, seats: [[0, 0.56, 0, 0]], shape: 'cyl' },
  bed: { m: 'Bed_Single', h: 0.85, mass: 45, value: 30, wall: true, seats: [[0, 0.55, 0.1, 0]] },
  bedKing: { m: 'Bed_King', h: 0.9, mass: 70, value: 50, wall: true, seats: [[-0.25, 0.55, 0.1, 0], [0.25, 0.55, 0.1, 0]] },
  bunk: { m: 'Bed_Bunk', h: 1.8, mass: 55, value: 25, wall: true, seats: [[0, 0.5, 0.1, 0]] },
  toilet: { m: 'Bathroom_Toilet', h: 0.85, mass: 28, value: 20, wall: true, seats: [[0, 0.46, 0.15, 0]] },
  bathtub: { m: 'Bathroom_Bathtub', h: 0.65, mass: 85, value: 35, wall: true, seats: [[0, 0.32, 0, 0]], use: 'bath' },
  washer: { m: 'Bathroom_WashingMachine', h: 1.0, mass: 70, value: 45, wall: true, use: 'wash' },
  bSink: { m: 'Bathroom_Sink', h: 1.0, mass: 22, value: 15, wall: true },
  shelf: { m: 'Bookshelf', h: 2.0, mass: 70, value: 30, wall: true },
  shelf2: { m: 'Shelf_1', h: 1.7, mass: 30, value: 20, wall: true },
  drawer1: { m: 'Drawer_1', h: 1.0, mass: 40, value: 25, wall: true },
  drawer3: { m: 'Drawer_3', h: 1.1, mass: 45, value: 25, wall: true },
  fireplace: { m: 'Fireplace', h: 1.4, mass: 140, value: 0, wall: true },
  fridge: { m: 'Kitchen_Fridge', h: 1.9, mass: 80, value: 50, wall: true, use: 'fridge' },
  oven: { m: 'Kitchen_Oven', h: 1.0, mass: 70, value: 40, wall: true, use: 'oven' },
  tvSet: { m: '', h: 0.85, mass: 30, value: 40, wall: true, make: makeTV, use: 'tv' },
  radio: { m: '', h: 0.3, mass: 2.5, value: 25, make: makeRadio, use: 'radio' },
  gramo: { m: '', h: 1.35, mass: 18, value: 45, wall: true, make: makeGramo, use: 'gramo' },
  kSink: { m: 'Kitchen_Sink', h: 1.0, mass: 50, value: 25, wall: true },
  kDrawers: { m: 'Kitchen_2Drawers', h: 1.0, mass: 45, value: 20, wall: true },
  kCab: { m: 'Kitchen_Cabinet1', h: 1.0, mass: 45, value: 20, wall: true },
  floorLamp: { m: 'Light_Floor1', h: 1.7, mass: 5, value: 15, use: 'lamp', shape: 'cyl' },
  standLamp: { m: 'Light_Stand1', h: 1.6, mass: 5, value: 15, use: 'lamp', shape: 'cyl' },
  deskLamp: { m: 'Light_Desk', h: 0.5, mass: 1.5, value: 10, use: 'lamp' },
  nightstand: { m: 'NightStand_1', h: 0.6, mass: 10, value: 15, wall: true },
  tableL: { m: 'Table_RoundLarge', h: 0.8, mass: 25, value: 20, shape: 'cyl' },
  tableS: { m: 'Table_RoundSmall', h: 0.7, mass: 10, value: 12, shape: 'cyl' },
  trash: { m: 'Trashcan_Small1', h: 0.55, mass: 3, value: 2, shape: 'cyl' },
  plant2: { m: 'Houseplant_2', h: 1.0, mass: 6, value: 8, shape: 'cyl' },
  plant4: { m: 'Houseplant_4', h: 1.3, mass: 8, value: 8, shape: 'cyl' },
  plant7: { m: 'Houseplant_7', h: 0.6, mass: 3, value: 6, shape: 'cyl' },
  paper: { m: 'Bathroom_ToiletPaper', h: 0.16, mass: 0.2, value: 1, shape: 'cyl' },
  plate: { m: 'Plate_1', h: 0.04, mass: 0.4, value: 2, shape: 'cyl' },
};
export const INTERIOR_MODELS = [...new Set(Object.values(K).filter((k) => k.m).map((k) => 'interior/' + k.m)), 'interior/Carpet_1', 'interior/Carpet_Round'];

/** What goes in a building, by kind, in order (the first ones get the best wall spots). Groups: a table + seats round it. */
const HOUSE = ['couchL', 'tvSet', 'fireplace', 'gramo', 'shelf', 'fridge', 'oven', 'kSink', 'kDrawers', 'bedKing', 'nightstand', 'washer', 'toilet', 'bathtub', 'drawer1', 'kCab',
  'shelf2', 'bSink', 'couchS', 'bed', '@table', 'floorLamp', 'plant4', 'plant2', 'standLamp', 'trash', 'plant7', 'radio'];
const BARN = ['couchS', 'tvSet', 'gramo', 'shelf2', 'fridge', 'radio', 'oven', 'bathtub', 'bunk', 'drawer3', 'couchM', 'shelf', 'kCab', '@stools', 'standLamp', 'trash', 'plant7', 'bed'];
const isHouse = (m: string) => /Inn|House|Silo_House/.test(m);
/** Small things put on tables / shelves / by the toilet afterwards. */
const SMALL_ON_TABLE = ['plate', 'radio', 'deskLamp'];

const v1 = new THREE.Vector3(), q1 = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
const LIT = new WeakSet<THREE.Material>(), WARM = new THREE.Color(0xfff1d8);
const rnd = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** An old wooden table radio: a speaker grille, a glowing dial, two knobs, a telescopic aerial. */
function makeRadio() {
  const g = new THREE.Group();
  const box = (w: number, h: number, d: number, c: number, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toonMat(c)); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  box(0.42, 0.24, 0.16, 0x9a5b2e, 0, 0.12, 0);
  box(0.44, 0.03, 0.17, 0x6e3f1e, 0, 0.255, 0);
  const grille = box(0.2, 0.15, 0.01, 0xe8d6b0, -0.08, 0.125, 0.081);
  for (let i = 0; i < 5; i++) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.008, 0.004), toonMat(0x6e3f1e)); l.position.set(0, -0.06 + i * 0.03, 0.006); grille.add(l); }
  const dial = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.05, 0.01), new THREE.MeshBasicMaterial({ color: 0x5c4a2a })); dial.name = 'dial'; dial.position.set(0.11, 0.16, 0.081); g.add(dial);
  for (const x of [0.07, 0.15]) { const k = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 10), toonMat(0x3b2412)); k.rotation.x = Math.PI / 2; k.position.set(x, 0.07, 0.09); g.add(k); }
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.36, 5), toonMat(0xc9ced8)); ant.position.set(0.14, 0.42, -0.04); ant.rotation.z = -0.35; g.add(ant);
  return g;
}
/**
 * A wind-up gramophone on a little cabinet (s24): the record spins (named meshes: they turn), a tone arm, a big brass
 * horn. RMB = needle down / up. Bob hears it from far, walks over to stop it — and can't help dancing first (blind).
 */
function makeGramo() {
  const g = new THREE.Group();
  const box = (w: number, h: number, d: number, c: number, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toonMat(c)); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  box(0.52, 0.6, 0.42, 0x8a5a32, 0, 0.3, 0);                 // cabinet
  box(0.56, 0.04, 0.46, 0x6e4524, 0, 0.62, 0);               // its top
  box(0.012, 0.46, 0.006, 0x5a3820, 0, 0.3, 0.212);          // the doors' gap
  for (const x of [-0.05, 0.05]) { const k = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), toonMat(0xd9a93a)); k.position.set(x, 0.34, 0.22); g.add(k); }
  box(0.42, 0.13, 0.36, 0x9a5b2e, 0, 0.705, 0);              // the player box
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.012, 24), toonMat(0x1d1a1e)); disc.name = 'disc'; disc.position.set(-0.02, 0.778, 0.02); g.add(disc);
  const lab = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.016, 14), toonMat(0xd8402e)); lab.name = 'discLabel'; disc.add(lab);
  const dot = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.018, 0.014), toonMat(0xfff1d0)); dot.name = 'discDot'; dot.position.set(0.032, 0, 0); disc.add(dot);
  const arm = box(0.025, 0.025, 0.2, 0xc9ced8, 0.14, 0.8, -0.02); arm.rotation.y = 0.55;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.22, 10), toonMat(0xd9a93a)); neck.position.set(0.15, 0.86, -0.13); g.add(neck);
  const brass = toonMat(0xe0b040).clone(); brass.side = THREE.DoubleSide;
  const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.03, 0.46, 22, 1, true), brass); horn.name = 'horn';
  horn.position.set(0.1, 1.1, -0.02); horn.rotation.set(0.75, 0, 0.3); horn.castShadow = true; g.add(horn);
  const crank = box(0.02, 0.02, 0.12, 0x3b2412, 0.23, 0.7, 0.04); crank.rotation.x = 0.4;
  return g;
}
const GRAMO = { lure: 24, dance: 8 };
/** A pie fresh out of the oven: throw it in Bob's face (a cream splat). */
PROPS.ovenPie = { make: makePie, mass: 1.2, shape: 'cyl', sound: 'squish', label: 'item.pie', value: 15, fragile: 6, bits: 0xf4e3b0, id: 'ovenPie' };
const BAKE = { secs: 16, pies: 2 };
/** The host's fixed step (s). */
const STEP_DT = 1 / 60;
const LURE = { radio: 22, tv: 12 };

interface Tv { pr: Prop; ch: number; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; screen: THREE.Mesh | null; on: THREE.Material; off: THREE.Material; loop: Loop | null; drawT: number; noiseT: number }
interface Radio { pr: Prop; on: boolean; hitT: number; dial: THREE.Mesh | null; loop: Loop | null; noiseT: number }
/** `danced`: Bob already danced to this record (the next visit he switches it off). */
interface Gramo { pr: Prop; on: boolean; danced: boolean; ignoreUntil: number; disc: THREE.Object3D | null; loop: Loop | null; crackle: Loop | null; noiseT: number }
interface Oven { pr: Prop; until: number; pies: Prop[]; glow: THREE.Mesh; loop: Loop | null }
interface Bath { pr: Prop; seat: number; fill: number; water: THREE.Mesh; idleT: number; washed: Set<Pig>; loop: Loop | null }
interface Lamp { pr: Prop; bulb: THREE.Mesh; mat: THREE.MeshBasicMaterial; on: boolean; hitT: number }
interface Fridge { pr: Prop; cans: Prop[] }
interface Washer { pr: Prop; until: number }

export class Interiors {
  kind = 'interiors' as const;
  lamps: Lamp[] = []; fridges: Fridge[] = []; washers: Washer[] = [];
  tvs: Tv[] = []; radios: Radio[] = []; ovens: Oven[] = []; baths: Bath[] = []; gramos: Gramo[] = [];
  /** The toilets' seat numbers (getting up off one flushes it). */
  private toiletSeats = new Set<number>(); private sat = new Map<Pig, number>();
  /** Seats on beds / bunks (mission: nap in Bob's bed). */
  bedSeats = new Set<number>();
  private cansOut = 0;
  get hasToilet() { return this.toiletSeats.size > 0; }
  /** Every piece + the building it came from (missions: drag furniture out, furniture in the water). */
  pieces: { pr: Prop; home: { x: number; z: number; r: number }; x0: number; z0: number }[] = [];
  private cur = { x: 0, z: 0, r: 0 };
  /** Furnished rooms (for the admin teleports / tests): centre + kind. */
  rooms: { x: number; z: number; model: string; pieces: number }[] = [];

  constructor(private scene: THREE.Scene, private props: Prop[], nav: Nav, buildings: { model: string; x: number; z: number; yaw: number; sx: number; sz: number }[], start: THREE.Vector3) {
    if (!buildings.length) return;
    const reach = this.flood(nav, start);
    for (const b of buildings) {
      if (/ChickenCoop|Well|WaterTower|Silo$|Windmill|TowerWindmill/.test(b.model)) continue;
      this.furnish(nav, reach, b);
    }
    G.hittables.push({ hit: (x, y, z, r) => this.hitLamp(x, y, z, r) || this.hitRadio(x, y, z, r) });
    G.uses.push({ near: (p: Pig) => !p.held && !!this.useNear(p), icon: (p: Pig) => { const k = this.useNear(p)?.kind; return k === 'fridge' ? 'eat' : k === 'tv' ? 'tv' : k === 'oven' ? 'oven' : k === 'gramo' ? 'note' : 'gear'; } });
    // Bob hears a radio / TV left on: he walks over and switches it off (a lure)
    if (this.radios.length || this.tvs.length || this.gramos.length) G.jobs.push({ spot: (bob: { pos: THREE.Vector3; looksAt(pt: THREE.Vector3, range?: number): boolean }) => this.jobFor(bob) });
  }

  /** Every nav cell the yard reaches (from the pigs' sty). */
  private flood(N: Nav, s: THREE.Vector3) {
    const W = N.w, H = N.h, seen = new Uint8Array(W * H);
    const f = N.nearestFree(s.x, s.z, 8); if (!f) return seen;
    const k0 = N.idx(f.x, f.z), q = [k0]; seen[k0] = 1;
    while (q.length) {
      const k = q.pop()!, i = k % W, j = (k / W) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, c = j + dj; if (a < 0 || c < 0 || a >= W || c >= H) continue;
        const n = c * W + a; if (!seen[n] && !N.blocked[n]) { seen[n] = 1; q.push(n); }
      }
    }
    return seen;
  }

  /** Lay out one building: free reachable floor cells inside it, walls, the doorway; then the pieces. */
  private furnish(N: Nav, reach: Uint8Array, b: { model: string; x: number; z: number; yaw: number; sx: number; sz: number }) {
    const cs = N.cell, cos = Math.cos(b.yaw), sin = Math.sin(b.yaw);
    const hx = b.sx / 2 - 0.2, hz = b.sz / 2 - 0.2;
    this.cur = { x: b.x, z: b.z, r: Math.max(b.sx, b.sz) / 2 + 1.5 };
    const local = (x: number, z: number) => { const dx = x - b.x, dz = z - b.z; return [dx * cos - dz * sin, dx * sin + dz * cos]; };
    const inside = (x: number, z: number) => { const [lx, lz] = local(x, z); return Math.abs(lx) < hx && Math.abs(lz) < hz; };
    /** The wall band: between the room and just outside the footprint (walkable there = an opening, a door). */
    const band = (x: number, z: number) => { const [lx, lz] = local(x, z); return Math.abs(lx) < b.sx / 2 + 0.6 && Math.abs(lz) < b.sz / 2 + 0.6 && !inside(x, z); };
    // the room's cells (world grid)
    const cells: number[] = [];
    const i0 = Math.max(0, Math.floor((b.x - Math.max(b.sx, b.sz) / 1.4 - N.x0) / cs)), i1 = Math.min(N.w - 1, Math.ceil((b.x + Math.max(b.sx, b.sz) / 1.4 - N.x0) / cs));
    const j0 = Math.max(0, Math.floor((b.z - Math.max(b.sx, b.sz) / 1.4 - N.z0) / cs)), j1 = Math.min(N.h - 1, Math.ceil((b.z + Math.max(b.sx, b.sz) / 1.4 - N.z0) / cs));
    const cx = (i: number) => N.x0 + (i + 0.5) * cs, cz = (j: number) => N.z0 + (j + 0.5) * cs;
    const room = new Set<number>();
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * N.w + i; if (reach[k] && inside(cx(i), cz(j))) { room.add(k); cells.push(k); } }
    if (cells.length < 40) return;   // < 10 m²: not a room
    // the doorway(s): walkable cells in the wall band (openings) → keep 1.4 m round them clear
    const door: THREE.Vector3[] = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * N.w + i; if (reach[k] && band(cx(i), cz(j))) door.push(new THREE.Vector3(cx(i), 0, cz(j))); }
    // houses get a plank floor (their models have none: the yard's ground showed inside)
    if (isHouse(b.model)) {
      const fl = new THREE.Mesh(new THREE.BoxGeometry(b.sx - 0.5, 0.05, b.sz - 0.5), toonMat(0xa8754a));
      fl.position.set(b.x, G.terrain.height(b.x, b.z) + 0.025, b.z); fl.rotation.y = b.yaw; fl.receiveShadow = true;
      for (let i = 0; i < Math.floor((b.sx - 0.5) / 0.35); i++) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.002, b.sz - 0.55), toonMat(0x7a4f2c)); line.position.set(-(b.sx - 0.5) / 2 + (i + 1) * 0.35, 0.026, 0); fl.add(line);
      }
      this.scene.add(fl); rigidSkin(fl);
    }
    const used = new Set<number>();
    // things already standing in there (hay bales, crates, the shed's machines): their floor is taken
    for (const pr of this.props) {
      if (pr.banked || pr.pooled) continue;
      const t = pr.body.translation(); if (!inside(t.x, t.z)) continue;
      const r = Math.max(pr.size.x, pr.size.z) / 2 + 0.3;
      for (let a = -r; a <= r; a += cs / 2) for (let c = -r; c <= r; c += cs / 2) { const k = N.idx(t.x + a, t.z + c); if (k >= 0) used.add(k); }
    }
    const free = (x: number, z: number) => { const k = N.idx(x, z); return k >= 0 && room.has(k) && !used.has(k) && !door.some((d) => Math.hypot(d.x - x, d.z - z) < 1.1); };
    const mark = (x: number, z: number, w: number, d: number, yaw: number, pad = 0.25) => {
      for (let a = -w / 2 - pad; a <= w / 2 + pad; a += cs / 2) for (let c = -d / 2 - pad; c <= d / 2 + pad; c += cs / 2) {
        const k = N.idx(x + a * Math.cos(yaw) + c * Math.sin(yaw), z - a * Math.sin(yaw) + c * Math.cos(yaw)); if (k >= 0) used.add(k);
      }
    };
    const fits = (x: number, z: number, w: number, d: number, yaw: number) => {
      for (let a = -w / 2; a <= w / 2 + 1e-6; a += cs / 2) for (let c = -d / 2; c <= d / 2 + 1e-6; c += cs / 2)
        if (!free(x + a * Math.cos(yaw) + c * Math.sin(yaw), z - a * Math.sin(yaw) + c * Math.cos(yaw))) return false;
      return true;
    };
    const rng = rnd(Math.round(b.x * 131 + b.z * 977));
    const y0 = G.terrain.height(b.x, b.z);
    // wall spots: room cells with a wall (blocked / not the room) right behind them, the way in = facing away
    const walls: { x: number; z: number; yaw: number }[] = [];
    for (const k of cells) {
      const i = k % N.w, j = (k / N.w) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = (j + dj) * N.w + i + di;
        if (room.has(n) || reach[n]) continue;   // open (another room cell, or the way out)
        walls.push({ x: cx(i), z: cz(j), yaw: Math.atan2(-di, -dj) });   // facing into the room
      }
    }
    walls.sort(() => rng() - 0.5);
    let pieces = 0;
    const list = isHouse(b.model) ? HOUSE : BARN;
    for (const id of list) {
      if (id === '@table' || id === '@stools') { if (this.group(id, free, fits, mark, room, N, rng, y0)) pieces++; continue; }
      const kd = K[id]; if (!kd || (!kd.make && !has('interior/' + kd.m))) continue;
      const sz = this.sizeOf(kd);
      if (kd.wall) {
        for (const w of walls) {
          // the piece's back on the wall: its centre half its depth out from the wall
          const x = w.x + Math.sin(w.yaw) * (sz.z / 2 - cs / 2 + 0.05), z = w.z + Math.cos(w.yaw) * (sz.z / 2 - cs / 2 + 0.05);
          if (!fits(x, z, sz.x, sz.z, w.yaw)) continue;
          this.place(id, kd, x, y0, z, w.yaw); mark(x, z, sz.x, sz.z + 0.5, w.yaw, 0.15); pieces++;   // + a little room in front of it
          break;
        }
      } else {
        for (let tries = 0; tries < 60; tries++) {
          const k = cells[Math.floor(rng() * cells.length)], x = cx(k % N.w), z = cz((k / N.w) | 0), yaw = rng() * Math.PI * 2;
          if (!fits(x, z, sz.x + 0.3, sz.z + 0.3, yaw)) continue;
          this.place(id, kd, x, y0, z, yaw); mark(x, z, sz.x, sz.z, yaw); pieces++;
          break;
        }
      }
    }
    // a rug in the middle of the free floor (static, flat)
    if (has('interior/Carpet_Round')) {
      const mid = cells.filter((k) => !used.has(k));
      if (mid.length > 20) {
        let sx = 0, sz = 0; for (const k of mid) { sx += cx(k % N.w); sz += cz((k / N.w) | 0); }
        const rug = fitted(isHouse(b.model) ? 'interior/Carpet_Round' : 'interior/Carpet_1', { width: 2.2 });
        rug.position.set(sx / mid.length, y0 + 0.02, sz / mid.length); rug.rotation.y = b.yaw;
        rug.traverse((o) => { o.castShadow = false; }); this.scene.add(rug);
      }
    }
    this.rooms.push({ x: b.x, z: b.z, model: b.model, pieces });
  }
  /** A table with chairs round it (house) / stools (barn), in the free middle. */
  private group(id: string, free: (x: number, z: number) => boolean, fits: (x: number, z: number, w: number, d: number, yaw: number) => boolean,
    mark: (x: number, z: number, w: number, d: number, yaw: number, pad?: number) => void, room: Set<number>, N: Nav, rng: () => number, y0: number) {
    const cells = [...room];
    const seat = id === '@table' ? ['chair1', 'chair2', 'chair1'] : ['stool', 'stool'];
    for (let tries = 0; tries < 80; tries++) {
      const k = cells[Math.floor(rng() * cells.length)], x = N.x0 + ((k % N.w) + 0.5) * N.cell, z = N.z0 + (((k / N.w) | 0) + 0.5) * N.cell;
      if (!fits(x, z, 2.6, 2.6, 0)) continue;
      const tk = id === '@table' ? 'tableL' : 'tableS';
      this.place(tk, K[tk], x, y0, z, rng() * 6.28);
      seat.forEach((s, i) => {
        const a = (i / seat.length) * Math.PI * 2 + rng() * 0.3, d = 0.95;
        this.place(s, K[s], x + Math.sin(a) * d, y0, z + Math.cos(a) * d, a + Math.PI);   // facing the table
      });
      // something on the table
      const top = this.sizeOf(K[tk]).y;
      const small = SMALL_ON_TABLE[Math.floor(rng() * SMALL_ON_TABLE.length)];
      this.place(small, K[small], x + 0.15, y0 + top + 0.02, z - 0.1, rng() * 6.28);
      mark(x, z, 2.6, 2.6, 0, 0);
      void free;
      return true;
    }
    return false;
  }

  private defs = new Map<string, PropDef>();
  private sizes = new Map<string, THREE.Vector3>();
  private sizeOf(kd: Kind) {
    const key = kd.m || String(kd.make?.name);
    let s = this.sizes.get(key);
    if (!s) {
      if (kd.make) s = new THREE.Box3().setFromObject(kd.make()).getSize(new THREE.Vector3());
      else { const o = fitted('interior/' + kd.m, { height: kd.h }); s = (o.userData.size as THREE.Vector3).clone(); }
      this.sizes.set(key, s);
    }
    return s;
  }
  /** One piece: a prop (+ its seats, its lamp bulb, its fridge's cans…). */
  private place(id: string, kd: Kind, x: number, y: number, z: number, yaw: number) {
    let def = this.defs.get(id);
    if (!def) {
      def = { ...(kd.make ? { make: kd.make } : { model: 'interior/' + kd.m, height: kd.h }), mass: kd.mass, shape: kd.shape ?? 'box', sound: kd.mass > 30 ? 'wood|thud' : 'wood', label: 'item.furniture', value: kd.value, friction: 0.8, id: 'f_' + id };
      PROPS['f_' + id] = def; this.defs.set(id, def);
    }
    const pr = new Prop(this.scene, def, v1.set(x, y, z), yaw);
    this.props.push(pr);
    this.pieces.push({ pr, home: this.cur, x0: x, z0: z });
    // the pack's colours read too dark in a barn's shade: lighten / warm them a little (once per shared material)
    pr.obj.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshToonMaterial | undefined;
      if (!m || !m.color || LIT.has(m)) return;
      LIT.add(m); m.color.lerp(WARM, 0.28);
    });
    const sz = pr.size;
    let lastSeat = -1;
    for (const [fx, h, fz, ly] of kd.seats ?? []) {
      const bed = id === 'bed' || id === 'bedKing' || id === 'bunk';
      const sid = lastSeat = SEATS.onProp(pr, new THREE.Vector3(fx * sz.x, h - sz.y / 2, fz * sz.z), ly, h, bed ? 1.75 : undefined);
      if (id === 'toilet') this.toiletSeats.add(sid);
      if (bed) this.bedSeats.add(sid);
    }
    if (kd.use === 'lamp') {
      const mat = new THREE.MeshBasicMaterial({ color: 0x6b5a3a });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(id === 'deskLamp' ? 0.05 : 0.09, 10, 8), mat);
      bulb.position.set(0, sz.y / 2 - (id === 'deskLamp' ? 0.12 : 0.25), id === 'deskLamp' ? 0.05 : 0); pr.obj.add(bulb);
      this.lamps.push({ pr, bulb, mat, on: false, hitT: -10 });
      this.setLamp(this.lamps[this.lamps.length - 1], true);
    }
    if (kd.use === 'fridge') {
      const cans: Prop[] = [];
      for (const c of ['canBeans', 'canEnergy', 'canSpinach']) { const d = PROPS[c]; if (!d) continue; const p = new Prop(this.scene, d, v1.set(x, -50, z), 0); p.pooled = true; p.bank(); this.props.push(p); cans.push(p); }
      const fr: Fridge = { pr, cans };
      this.fridges.push(fr);
      HANDS.dispenser({ at: new THREE.Vector3(), r: 0.5, icon: 'eat',
        ready: (p) => !fr.pr.banked && fr.cans.some((c) => c.banked) && this.frontOf(fr.pr, 0.5, p.pos) < 1.2,
        take: (p, at) => { const c = fr.cans.find((k) => k.banked); if (!c) return null; c.unbank(at, 0); G.audio.play('clunk', { pos: at, vol: 0.5, pitch: 1.3 }); return c; } });
      // (the dispenser's spot follows the fridge: updated every step)
      (fr as Fridge & { disp?: unknown }).disp = HANDS.dispensers[HANDS.dispensers.length - 1];
    }
    if (kd.use === 'wash') this.washers.push({ pr, until: 0 });
    if (kd.use === 'tv') {
      const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48;
      const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
      const screen = pr.obj.getObjectByName('screen') as THREE.Mesh | null;
      const off = toonMat(0x2a3036);
      if (screen) screen.material = off;
      this.tvs.push({ pr, ch: 0, canvas, tex, screen, on: new THREE.MeshBasicMaterial({ map: tex }), off, loop: null, drawT: 0, noiseT: 0 });
    }
    if (kd.use === 'gramo') this.gramos.push({ pr, on: false, danced: false, ignoreUntil: 0, disc: pr.obj.getObjectByName('disc') ?? null, loop: null, crackle: null, noiseT: 0 });
    if (kd.use === 'radio') this.radios.push({ pr, on: false, hitT: -10, dial: pr.obj.getObjectByName('dial') as THREE.Mesh | null, loop: null, noiseT: 0 });
    if (kd.use === 'oven') {
      // the oven window glows while it bakes; its pies wait (hidden) until they're done
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(sz.x * 0.5, sz.y * 0.28), new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85 }));
      glow.position.set(0, -sz.y * 0.08, sz.z / 2 + 0.012); glow.visible = false; pr.obj.add(glow);
      const pies: Prop[] = [];
      for (let i = 0; i < BAKE.pies; i++) { const pp = new Prop(this.scene, PROPS.ovenPie, v1.set(x, -50, z), 0); pp.pooled = true; pp.bank(); this.props.push(pp); pies.push(pp); }
      this.ovens.push({ pr, until: 0, pies, glow, loop: null });
    }
    if (kd.use === 'bath') {
      const water = new THREE.Mesh(new THREE.BoxGeometry(sz.x * 0.78, 0.02, sz.z * 0.62), new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.85 }));
      water.position.set(0, -sz.y / 2 + 0.12, 0); water.visible = false; pr.obj.add(water);
      // bubbles on top
      for (let i = 0; i < 9; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.07 + (i % 3) * 0.03, 8, 6), toonMat(0xffffff)); b.position.set(((i % 3) - 1) * sz.x * 0.25, 0.02, (Math.floor(i / 3) - 1) * sz.z * 0.18); water.add(b); }
      this.baths.push({ pr, seat: lastSeat, fill: 0, water, idleT: 0, washed: new Set(), loop: null });
    }
    return pr;
  }
  /** The spot `d` m in front of a prop (its +z side, on the ground at its height). */
  private front(pr: Prop, d: number) {
    const t = pr.body.translation(), r = pr.body.rotation();
    const f = v1.set(0, 0, 1).applyQuaternion(q1.set(r.x, r.y, r.z, r.w));
    const k = d + pr.size.z / 2;
    return new THREE.Vector3(t.x + f.x * k, t.y, t.z + f.z * k);
  }
  /** How far a point is from the spot `d` m in front of a prop (along the ground). */
  private frontOf(pr: Prop, d: number, p: THREE.Vector3) {
    const t = pr.body.translation(), r = pr.body.rotation();
    const f = v1.set(0, 0, 1).applyQuaternion(q1.set(r.x, r.y, r.z, r.w));
    return Math.hypot(p.x - (t.x + f.x * d), p.z - (t.z + f.z * d));
  }

  // ================================================================== uses
  private setLamp(l: Lamp, on: boolean) {
    l.on = on;
    l.mat.color.setHex(on ? 0xfff1a8 : 0x6b5a3a);
  }
  /** A hit (headbutt, punch, a whack) on a lamp: on / off. */
  private hitLamp(x: number, y: number, z: number, reach: number) {
    if (G.net === 'client') return false;
    for (const l of this.lamps) {
      if (l.pr.banked || l.pr.heldBy) continue;
      const t = l.pr.body.translation();
      if (Math.hypot(t.x - x, t.z - z) > 0.6 + reach * 0.5 || Math.abs(t.y - y) > 1.2) continue;
      if (G.time - l.hitT < 0.4) return true;
      l.hitT = G.time; this.setLamp(l, !l.on);
      G.audio.play('unlock', { pos: v1.set(t.x, t.y, t.z), vol: 0.5, pitch: 1.8 });
      return true;
    }
    return false;
  }
  /** RMB things next to a pig: the washing machine (a fridge's can is a dispenser). */
  useNear(p: Pig): { kind: 'wash'; w: Washer } | { kind: 'tv'; tv: Tv } | { kind: 'oven'; o: Oven } | { kind: 'gramo'; gr: Gramo } | { kind: 'fridge' } | null {
    if (p.seat >= 0 || p.out || p.heldBy) return null;
    const ok = (pr: Prop) => !pr.banked && !pr.heldBy && this.upright(pr);
    for (const w of this.washers) if (ok(w.pr) && w.until < G.time && this.frontOf(w.pr, 0.6, p.pos) < 1.0) return { kind: 'wash', w };
    for (const tv of this.tvs) if (ok(tv.pr) && this.frontOf(tv.pr, 0.7, p.pos) < 0.9) return { kind: 'tv', tv };
    for (const gr of this.gramos) if (ok(gr.pr) && this.frontOf(gr.pr, 0.6, p.pos) < 1.0) return { kind: 'gramo', gr };
    for (const o of this.ovens) if (ok(o.pr) && o.until <= 0 && o.pies.some((k) => k.banked) && this.frontOf(o.pr, 0.6, p.pos) < 1.0) return { kind: 'oven', o };
    return null;
  }
  private upright(pr: Prop) { const r = pr.body.rotation(); return v1.set(0, 1, 0).applyQuaternion(q1.set(r.x, r.y, r.z, r.w)).y > 0.7; }
  /** A hit on a radio: on / off. */
  private hitRadio(x: number, y: number, z: number, reach: number) {
    if (G.net === 'client') return false;
    for (const r of this.radios) {
      if (r.pr.banked || r.pr.heldBy) continue;
      const t = r.pr.body.translation();
      if (Math.hypot(t.x - x, t.z - z) > 0.55 + reach * 0.5 || Math.abs(t.y - y) > 1.2) continue;
      if (G.time - r.hitT < 0.4) return true;
      r.hitT = G.time; r.on = !r.on; r.noiseT = G.time + 1;
      G.audio.play('clunk', { pos: v1.set(t.x, t.y, t.z), vol: 0.5, pitch: 1.6 });
      if (r.on) G.audio.play('static', { pos: v1, vol: 0.4, minGap: 0.2 });
      return true;
    }
    return false;
  }
  /** Admin: the nearest radio on / off, TV next channel, oven bakes (1 s), bath full. */
  admin(what: string, at: THREE.Vector3) {
    const near = <T extends { pr: Prop }>(l: T[]) => l.filter((x) => !x.pr.banked).sort((a, b) => a.pr.synced.currP.distanceTo(at) - b.pr.synced.currP.distanceTo(at))[0];
    if (what === 'radio') { const r = near(this.radios); if (r) { r.on = !r.on; r.noiseT = G.time + 1; } }
    if (what === 'gramo') { const gr = near(this.gramos); if (gr) { gr.on = !gr.on; gr.danced = false; gr.noiseT = G.time + 1; } }
    if (what === 'tv') { const tv = near(this.tvs); if (tv) { tv.ch = (tv.ch + 1) % 5; tv.noiseT = G.time + 2; } }
    if (what === 'bake') { const o = near(this.ovens); if (o) o.until = G.time + 1; }
    if (what === 'bath') { const b = near(this.baths); if (b) { b.fill = 1; b.idleT = 0; } }
  }
  /** Admin: Bob's job for the nearest playing radio / TV (switched on first if none is). */
  lureJob(at: THREE.Vector3, bob?: { pos: THREE.Vector3; danceFor?(secs: number, at?: THREE.Vector3): void }, gramo = false) {
    if (!bob) return null;
    if (gramo) { if (!this.gramos.some((g) => g.on)) this.admin('gramo', at); }
    else if (!this.radios.some((r) => r.on) && !this.tvs.some((tv) => tv.ch)) this.admin(this.radios.length ? 'radio' : 'tv', at);
    return this.jobFor({ pos: bob.pos, looksAt: () => true, danceFor: bob.danceFor?.bind(bob) });
  }
  /** Bob: a radio / TV playing that he hears (or sees) → he walks over and switches it off. */
  jobFor(bob: { pos: THREE.Vector3; looksAt(pt: THREE.Vector3, range?: number): boolean; danceFor?(secs: number, at?: THREE.Vector3): void }): BobJob | null {
    let best: { pr: Prop; off: () => void; still: () => boolean } | null = null, bd = Infinity;
    const at = (pr: Prop) => pr.synced.currP;
    // a record playing: the first time he gets there he can't help himself — he dances (blind) before he stops it
    let gb: Gramo | null = null, gd = Infinity;
    for (const gr of this.gramos) {
      if (!gr.on || gr.pr.banked || gr.pr.heldBy || G.time < gr.ignoreUntil) continue;
      const d = at(gr.pr).distanceTo(bob.pos);
      if (d < gd && (d < GRAMO.lure || bob.looksAt(at(gr.pr), 30))) { gd = d; gb = gr; }
    }
    if (gb) {
      const gr = gb, p = at(gr.pr), spot = this.front(gr.pr, 1.1);   // in front of it (it stands against a wall)
      if (!gr.danced) return {
        at: spot, look: p.clone(), dur: 0.5, near: 6, activity: 'bob.radioOff', still: () => gr.on && !gr.pr.banked,
        done: () => { gr.danced = true; G.events.push({ type: 'bobDisco' }); },
        then: () => { if (gr.on) bob.danceFor?.(GRAMO.dance, p); },
      };
      // can't get to it (a tight doorway) within 25 s: he gives up on it for a while
      const t0 = G.time;
      best = { pr: gr.pr, off: () => { gr.on = false; }, still: () => { if (G.time - t0 > 25) { gr.ignoreUntil = G.time + 40; return false; } return gr.on && !gr.pr.heldBy && !gr.pr.banked; } }; bd = gd;
    }
    for (const r of this.radios) {
      if (!r.on || r.pr.banked || r.pr.heldBy) continue;
      const d = at(r.pr).distanceTo(bob.pos);
      if (d < bd && (d < LURE.radio || bob.looksAt(at(r.pr), 30))) { bd = d; best = { pr: r.pr, off: () => { r.on = false; }, still: () => r.on && !r.pr.heldBy && !r.pr.banked }; }
    }
    for (const tv of this.tvs) {
      if (!tv.ch || tv.pr.banked || tv.pr.heldBy) continue;
      const d = at(tv.pr).distanceTo(bob.pos);
      if (d < bd && (d < LURE.tv || bob.looksAt(at(tv.pr), 20))) { bd = d; best = { pr: tv.pr, off: () => { tv.ch = 0; }, still: () => tv.ch > 0 && !tv.pr.banked }; }
    }
    if (!best) return null;
    const b = best, p = at(b.pr), dx = bob.pos.x - p.x, dz = bob.pos.z - p.z, d = Math.hypot(dx, dz) || 1;
    // wall pieces (TV, record player): he stands in front of it, not on his side (that can be behind the wall)
    const wall = this.tvs.some((tv) => tv.pr === b.pr) || this.gramos.some((g) => g.pr === b.pr);
    return {
      at: wall ? this.front(b.pr, 1.0) : new THREE.Vector3(p.x + (dx / d) * 0.9, p.y, p.z + (dz / d) * 0.9), look: p.clone(), dur: 1.6, activity: 'bob.radioOff',
      still: b.still,
      done: () => { b.off(); G.audio.play('clunk', { pos: at(b.pr), vol: 0.6, pitch: 1.2 }); G.events.push({ type: 'radioOff' }); },
    };
  }

  // ================================================================== host step
  /** The fridges' dispensers sit at their doors (every browser: the HUD prompt picks them too). */
  private fridgeSpots() {
    for (const fr of this.fridges) {
      const d = (fr as Fridge & { disp?: { at: THREE.Vector3 } }).disp; if (!d) continue;
      const t = fr.pr.body.translation(), r = fr.pr.body.rotation(), f = v1.set(0, 0, 1).applyQuaternion(q1.set(r.x, r.y, r.z, r.w));
      d.at.set(t.x + f.x * (fr.pr.size.z / 2 + 0.1), t.y + 0.1, t.z + f.z * (fr.pr.size.z / 2 + 0.1));
    }
  }
  step() {
    if (G.net === 'client') return;
    this.fridgeSpots();
    // cans taken out of the fridges since the last step (the dispenser runs after the round reads this step's events)
    let out = 0; for (const fr of this.fridges) for (const c of fr.cans) if (!c.banked) out++;
    for (; this.cansOut < out; this.cansOut++) G.events.push({ type: 'fridge' });
    this.cansOut = out;
    // RMB at a washing machine: a 6 s spin (it rattles about, loud) · at a TV: next channel (… → off) · at the oven: bake
    for (const p of G.pigs as Pig[]) {
      if (!p.input.grabP || p.held) continue;
      const u = this.useNear(p); if (!u || u.kind === 'fridge') continue;
      if (u.kind === 'wash') { u.w.until = G.time + 6; p.touch(v1.copy(u.w.pr.synced.currP).setY(u.w.pr.synced.currP.y + 0.3)); }
      if (u.kind === 'tv') {
        u.tv.ch = (u.tv.ch + 1) % 5; u.tv.noiseT = G.time + 2;
        G.audio.play('clunk', { pos: u.tv.pr.synced.currP, vol: 0.6, pitch: 1.4 }); G.audio.play('static', { pos: u.tv.pr.synced.currP, vol: 0.3, minGap: 0.2 });
        p.touch(v1.copy(u.tv.pr.synced.currP).setY(u.tv.pr.synced.currP.y + 0.2));
      }
      if (u.kind === 'gramo') {
        const gr = u.gr; gr.on = !gr.on; gr.noiseT = G.time + 1.5; if (gr.on) gr.danced = false;
        G.audio.play('clunk', { pos: gr.pr.synced.currP, vol: 0.5, pitch: gr.on ? 1.7 : 1.3 });
        p.touch(v1.copy(gr.pr.synced.currP).setY(gr.pr.synced.currP.y + 0.3));
      }
      if (u.kind === 'oven') {
        u.o.until = G.time + BAKE.secs;
        G.audio.play('flint', { pos: u.o.pr.synced.currP, vol: 0.7 }); G.audio.play('fire', { pos: u.o.pr.synced.currP, vol: 0.5 });
        p.touch(v1.copy(u.o.pr.synced.currP).setY(u.o.pr.synced.currP.y + 0.3));
      }
    }
    // the oven: done → ding, a pie pops out on top (hot, throwable)
    for (const o of this.ovens) {
      if (o.until <= 0 || G.time < o.until) continue;
      o.until = 0;
      const pie = o.pies.find((k) => k.banked); if (!pie) continue;
      const t = o.pr.synced.currP;
      pie.unbank(v1.set(t.x, t.y + o.pr.size.y / 2 + 0.25, t.z), 0);
      pie.body.setLinvel({ x: 0, y: 2.2, z: 0 }, true);
      G.audio.play('ding', { pos: t, vol: 0.9 }); G.noise(t, 8);
      G.fx.bits(v1.set(t.x, t.y + o.pr.size.y / 2 + 0.3, t.z), { count: 10, color: 0xffffff, speed: 0.8, up: 1.5, grav: -1, life: 1.4, size: 0.18, grow: 0.3, alpha: 0.6 });
      G.events.push({ type: 'baked' });
    }
    // radios / TVs that play: Bob hears them (a noise every few seconds)
    for (const r of this.radios) if (r.on && !r.pr.banked && G.time > r.noiseT) { r.noiseT = G.time + 4; G.noise(r.pr.synced.currP, LURE.radio); }
    for (const gr of this.gramos) {
      if (gr.on && (!this.upright(gr.pr) || gr.pr.banked)) gr.on = false;   // knocked over: the needle skips off
      // (no G.noise: a noise would make him investigate — and cut his dance short; he hears it through his job check)
    }
    for (const tv of this.tvs) if (tv.ch && !tv.pr.banked && G.time > tv.noiseT) { tv.noiseT = G.time + 5; G.noise(tv.pr.synced.currP, LURE.tv); }
    // the bathtub: someone in it = the taps fill it (4 s); full = a bubble bath (the mud washes off); empty drains slowly
    for (const b of this.baths) {
      const who = (G.pigs as Pig[]).find((p) => p.seat === b.seat && b.seat >= 0) ?? null;
      if (who && !b.pr.banked && this.upright(b.pr)) {
        b.fill = Math.min(1, b.fill + STEP_DT / 4); b.idleT = 0;
        if (b.fill >= 1) {
          if (who.muddyUntil > who.now) who.muddyUntil = who.now;
          if (!b.washed.has(who)) { b.washed.add(who); G.events.push({ type: 'bath', who }); G.audio.play('splash', { pos: b.pr.synced.currP, vol: 0.7, pitch: 1.3 }); }
        }
      } else {
        b.washed.clear();
        b.idleT += STEP_DT; if (b.idleT > 20 || !this.upright(b.pr)) b.fill = Math.max(0, b.fill - STEP_DT / 6);
      }
    }
    for (const w of this.washers) {
      if (w.until < G.time || w.pr.banked) continue;
      if (Math.random() < 0.25) {
        const b = w.pr.body; b.applyImpulse({ x: (Math.random() - 0.5) * w.pr.mass * 0.6, y: w.pr.mass * 0.4, z: (Math.random() - 0.5) * w.pr.mass * 0.6 }, true);
        G.audio.play('thud', { pos: w.pr.synced.currP, vol: 0.6, pitch: 0.7 + Math.random() * 0.2, minGap: 0.15 });
      }
      if (Math.random() < 0.05) G.noise(w.pr.synced.currP, 14);
    }
    // a lamp knocked over goes out
    for (const l of this.lamps) {
      if (!l.on) continue;
      const r = l.pr.body.rotation();
      if (v1.set(0, 1, 0).applyQuaternion(q1.set(r.x, r.y, r.z, r.w)).y < 0.5) this.setLamp(l, false);
    }
    // getting up off the toilet: it flushes (Bob hears that)
    for (const p of G.pigs as Pig[]) {
      const was = this.sat.get(p) ?? -1;
      if (was !== p.seat) {
        if (was >= 0 && this.toiletSeats.has(was)) { const s = SEATS.at(was, v1); if (s) { G.audio.play('splash', { pos: s, vol: 1, pitch: 0.6 }); G.audio.play('pour', { pos: s, vol: 0.7, pitch: 0.7 }); G.noise(s, 12); G.events.push({ type: 'flush', who: p }); } }
        this.sat.set(p, p.seat);
      }
    }
  }
  /** New round: lamps back on, fridges full, no spin. */
  reset() {
    for (const l of this.lamps) this.setLamp(l, true);
    for (const tv of this.tvs) tv.ch = 0;
    for (const r of this.radios) r.on = false;
    for (const gr of this.gramos) { gr.on = false; gr.danced = false; }
    for (const o of this.ovens) { o.until = 0; for (const k of o.pies) k.bank(); }
    for (const b of this.baths) b.fill = 0;
    for (const f of this.fridges) for (const c of f.cans) { c.bank(); }
    for (const w of this.washers) w.until = 0;
  }

  // ================================================================== network
  netState(n: number[]) {
    let bits = 0; this.lamps.forEach((l, i) => { if (l.on && i < 30) bits |= 1 << i; });
    n.push(bits); for (const w of this.washers) n.push(Math.round(w.until * 10) / 10);
    let rb = 0; this.radios.forEach((r, i) => { if (r.on && i < 30) rb |= 1 << i; });
    n.push(rb); for (const tv of this.tvs) n.push(tv.ch);
    for (const o of this.ovens) n.push(o.until > 0 ? Math.round(o.until * 10) / 10 : 0);
    for (const b of this.baths) n.push(Math.round(b.fill * 100) / 100);
    let gb = 0; this.gramos.forEach((g, i) => { if (g.on && i < 30) gb |= 1 << i; }); n.push(gb);
  }
  netApply(n: number[]) {
    if (!n.length) return;
    this.lamps.forEach((l, i) => { const on = i < 30 && !!(n[0] & (1 << i)); if (on !== l.on) this.setLamp(l, on); });
    let k = 1;
    this.washers.forEach((w) => { w.until = n[k++] ?? 0; });
    const rb = n[k++] ?? 0; this.radios.forEach((r, i) => { r.on = i < 30 && !!(rb & (1 << i)); });
    for (const tv of this.tvs) tv.ch = n[k++] ?? 0;
    for (const o of this.ovens) o.until = n[k++] ?? 0;
    for (const b of this.baths) b.fill = n[k++] ?? 0;
    const gb = n[k++] ?? 0; this.gramos.forEach((g, i) => { g.on = i < 30 && !!(gb & (1 << i)); });
  }
  /** A positional loop that runs while `on` (started / stopped / moved here). */
  private sound(l: Loop | null, on: boolean, name: string, at: THREE.Vector3, vol: number, ref: number) {
    if (on && !l) l = G.audio.loop(name, { pos: at, vol, bus: 'sfx', ref });
    else if (!on && l) { l.stop(0.3); l = null; }
    l?.setPos(at);
    return l;
  }
  /** Every frame: a lit bulb glows (bloom), a spinning washer hums. */
  render(dt = 1 / 60) {
    const t = G.time, me = G.localPig as Pig | null;
    for (const l of this.lamps) if (l.on) l.bulb.scale.setScalar(1 + Math.sin(t * 3 + l.pr.homePos.x) * 0.03);
    this.fridgeSpots();
    const near = (pr: Prop, r: number) => !!me && !pr.banked && pr.obj.position.distanceTo(me.pos) < r;
    // TVs: the picture (only near my pig), the chatter
    for (const tv of this.tvs) {
      const on = tv.ch > 0 && !tv.pr.banked;
      if (tv.screen) tv.screen.material = on ? tv.on : tv.off;
      tv.drawT -= dt;
      if (on && near(tv.pr, 22) && tv.drawT <= 0) { tv.drawT = tv.ch === 1 ? 1 : 0.12; drawChannel(tv.canvas, tv.ch - 1, t); tv.tex.needsUpdate = true; }
      tv.loop = this.sound(tv.loop, on && near(tv.pr, 30), 'phonevoice', tv.pr.obj.position, 0.35, 2.5);
    }
    // radios: the dial glows, music (the theme song) follows the radio wherever it's carried
    for (const r of this.radios) {
      const on = r.on && !r.pr.banked;
      (r.dial?.material as THREE.MeshBasicMaterial | undefined)?.color.setHex(on ? 0xffd166 : 0x5c4a2a);
      r.loop = this.sound(r.loop, on && near(r.pr, 45), 'music_theme', r.pr.obj.position, 0.6, 3);
    }
    // gramophones: the record spins, the theme song a little slow and old (+ the needle's crackle)
    for (const gr of this.gramos) {
      const on = gr.on && !gr.pr.banked;
      if (on && gr.disc) gr.disc.rotation.y -= dt * 3.4;
      gr.loop = this.sound(gr.loop, on && near(gr.pr, 45), 'music_theme', gr.pr.obj.position, 0.65, 3);
      if (gr.loop && on) gr.loop.setRate(0.9);
      gr.crackle = this.sound(gr.crackle, on && near(gr.pr, 14), 'crackle', gr.pr.obj.position, 0.25, 1.5);
    }
    // ovens: the window glows, a fire crackles; baths: the water rises, the bubbles wobble, the taps run while filling
    for (const o of this.ovens) {
      const on = o.until > 0;
      o.glow.visible = on; if (on) (o.glow.material as THREE.MeshBasicMaterial).opacity = 0.7 + Math.sin(t * 9) * 0.15;
      o.loop = this.sound(o.loop, on && near(o.pr, 20), 'fire', o.pr.obj.position, 0.35, 2);
    }
    for (const b of this.baths) {
      const sy = b.pr.size.y;
      b.water.visible = b.fill > 0.02;
      b.water.position.y = -sy / 2 + 0.1 + b.fill * sy * 0.6;
      b.water.children.forEach((c, i) => { c.visible = b.fill > 0.6; c.scale.setScalar(0.8 + Math.sin(t * 2 + i) * 0.15); });
      const filling = b.fill > 0 && b.fill < 1 && b.idleT === 0;
      b.loop = this.sound(b.loop, filling && near(b.pr, 20), 'pour', b.pr.obj.position, 0.5, 2);
    }
    void UP;
  }
}
