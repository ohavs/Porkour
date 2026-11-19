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

/**
 * Furniture inside the buildings (user: "the maps are full, but the insides of buildings feel empty: furniture and lots
 * of things, all of them grab & throw, some with more to do"). Every building a pig can walk into (found on the nav
 * grid: free floor inside its footprint that the yard reaches) gets furnished by its kind — a house: living room,
 * kitchen, bedroom, bathroom bits; a barn / stable / mill: an old couch, a table and stools, shelves, a beer fridge,
 * a cot. Quaternius Ultimate House Interior (CC0). Big pieces go against the walls, facing in; the doorway stays clear.
 * Every piece is a prop: light ones you carry and throw, big ones are heavy (two pigs / spinach drag them) — and loot.
 * More to do: sit on couches, chairs, stools, beds, the bathtub, the toilet (getting up flushes it — Bob hears),
 * hit a lamp = on / off, RMB at the fridge = a can out of it, RMB at the washing machine = a noisy shaking spin.
 * Deterministic (seeded by the building's spot): every machine furnishes the same; lamps / the spin are synced.
 */
type Use = 'lamp' | 'fridge' | 'wash';
interface Kind {
  /** Quaternius model name, its height (m), mass (kg), loot value; against a wall (`wall`) or free-standing. */
  m: string; h: number; mass: number; value: number; wall?: boolean;
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
  bathtub: { m: 'Bathroom_Bathtub', h: 0.65, mass: 85, value: 35, wall: true, seats: [[0, 0.32, 0, 0]] },
  washer: { m: 'Bathroom_WashingMachine', h: 1.0, mass: 70, value: 45, wall: true, use: 'wash' },
  bSink: { m: 'Bathroom_Sink', h: 1.0, mass: 22, value: 15, wall: true },
  shelf: { m: 'Bookshelf', h: 2.0, mass: 70, value: 30, wall: true },
  shelf2: { m: 'Shelf_1', h: 1.7, mass: 30, value: 20, wall: true },
  drawer1: { m: 'Drawer_1', h: 1.0, mass: 40, value: 25, wall: true },
  drawer3: { m: 'Drawer_3', h: 1.1, mass: 45, value: 25, wall: true },
  fireplace: { m: 'Fireplace', h: 1.4, mass: 140, value: 0, wall: true },
  fridge: { m: 'Kitchen_Fridge', h: 1.9, mass: 80, value: 50, wall: true, use: 'fridge' },
  oven: { m: 'Kitchen_Oven', h: 1.0, mass: 70, value: 40, wall: true },
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
export const INTERIOR_MODELS = [...new Set(Object.values(K).map((k) => 'interior/' + k.m)), 'interior/Carpet_1', 'interior/Carpet_Round'];

/** What goes in a building, by kind, in order (the first ones get the best wall spots). Groups: a table + seats round it. */
const HOUSE = ['couchL', 'fireplace', 'shelf', 'fridge', 'oven', 'kSink', 'kDrawers', 'bedKing', 'nightstand', 'washer', 'toilet', 'bathtub', 'drawer1', 'kCab',
  'shelf2', 'bSink', 'couchS', 'bed', '@table', 'floorLamp', 'plant4', 'plant2', 'standLamp', 'trash', 'plant7'];
const BARN = ['couchS', 'shelf2', 'fridge', 'bunk', 'drawer3', 'couchM', 'shelf', 'kCab', '@stools', 'standLamp', 'trash', 'plant7', 'bed'];
const isHouse = (m: string) => /Inn|House|Silo_House/.test(m);
/** Small things put on tables / shelves / by the toilet afterwards. */
const SMALL_ON_TABLE = ['plate', 'plate', 'deskLamp'];

const v1 = new THREE.Vector3(), q1 = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
const LIT = new WeakSet<THREE.Material>(), WARM = new THREE.Color(0xfff1d8);
const rnd = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

interface Lamp { pr: Prop; bulb: THREE.Mesh; mat: THREE.MeshBasicMaterial; on: boolean; hitT: number }
interface Fridge { pr: Prop; cans: Prop[] }
interface Washer { pr: Prop; until: number }

export class Interiors {
  kind = 'interiors' as const;
  lamps: Lamp[] = []; fridges: Fridge[] = []; washers: Washer[] = [];
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
    G.hittables.push({ hit: (x, y, z, r) => this.hitLamp(x, y, z, r) });
    G.uses.push({ near: (p: Pig) => !p.held && !!this.useNear(p), icon: (p: Pig) => (this.useNear(p)?.kind === 'fridge' ? 'eat' : 'gear') });
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
      const kd = K[id]; if (!kd || !has('interior/' + kd.m)) continue;
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
    let s = this.sizes.get(kd.m);
    if (!s) { const o = fitted('interior/' + kd.m, { height: kd.h }); s = (o.userData.size as THREE.Vector3).clone(); this.sizes.set(kd.m, s); }
    return s;
  }
  /** One piece: a prop (+ its seats, its lamp bulb, its fridge's cans…). */
  private place(id: string, kd: Kind, x: number, y: number, z: number, yaw: number) {
    let def = this.defs.get(id);
    if (!def) {
      def = { model: 'interior/' + kd.m, height: kd.h, mass: kd.mass, shape: kd.shape ?? 'box', sound: kd.mass > 30 ? 'wood|thud' : 'wood', label: 'item.furniture', value: kd.value, friction: 0.8, id: 'f_' + id };
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
    for (const [fx, h, fz, ly] of kd.seats ?? []) {
      const bed = id === 'bed' || id === 'bedKing' || id === 'bunk';
      const sid = SEATS.onProp(pr, new THREE.Vector3(fx * sz.x, h - sz.y / 2, fz * sz.z), ly, h, bed ? 1.75 : undefined);
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
    return pr;
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
  useNear(p: Pig): { kind: 'wash'; w: Washer } | { kind: 'fridge' } | null {
    if (p.seat >= 0 || p.out || p.heldBy) return null;
    for (const w of this.washers) if (!w.pr.banked && !w.pr.heldBy && w.until < G.time && this.frontOf(w.pr, 0.6, p.pos) < 1.0) return { kind: 'wash', w };
    return null;
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
    // RMB at a washing machine: a 6 s spin (it rattles about, loud)
    for (const p of G.pigs as Pig[]) {
      if (!p.input.grabP || p.held) continue;
      const u = this.useNear(p); if (u?.kind !== 'wash') continue;
      u.w.until = G.time + 6;
      p.touch(v1.copy(u.w.pr.synced.currP).setY(u.w.pr.synced.currP.y + 0.3));
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
    for (const f of this.fridges) for (const c of f.cans) { c.bank(); }
    for (const w of this.washers) w.until = 0;
  }

  // ================================================================== network
  netState(n: number[]) {
    let bits = 0; this.lamps.forEach((l, i) => { if (l.on && i < 30) bits |= 1 << i; });
    n.push(bits); for (const w of this.washers) n.push(Math.round(w.until * 10) / 10);
  }
  netApply(n: number[]) {
    if (!n.length) return;
    this.lamps.forEach((l, i) => { const on = i < 30 && !!(n[0] & (1 << i)); if (on !== l.on) this.setLamp(l, on); });
    this.washers.forEach((w, i) => { w.until = n[1 + i] ?? 0; });
  }
  /** Every frame: a lit bulb glows (bloom), a spinning washer hums. */
  render() {
    const t = G.time;
    for (const l of this.lamps) if (l.on) l.bulb.scale.setScalar(1 + Math.sin(t * 3 + l.pr.homePos.x) * 0.03);
    this.fridgeSpots();
    void UP;
  }
}
