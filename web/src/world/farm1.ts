import * as THREE from 'three';
import { fitted, sizeOf, has } from '../core/assets';
import { staticBox, staticCylinder, staticTrimesh, SEE_THROUGH } from '../core/physics';
import { Rng, V3 } from '../core/util';
import { Terrain, type Rect } from './terrain';
import { Prop, PROPS } from './props';
import { Critter, CRITTERS, DecorAnimal } from './animals';
import { Forest, type TreeKind } from './nature';
import { Cage } from './cage';
import type { Chore } from '../farmer/farmer';
import type { DayNight } from './daynight';
import { buildDecor } from './decor';
import { buildHideouts } from './hideouts';
import { G } from '../game/ctx';
import { instanceStatic } from '../render/batch';

/**
 * Farm 1 — Bob's family farm. North = −z. Everything placed from code (art-agnostic: missing models → magenta box).
 * Layout: sty (start, east) · big barn (centre) · farmhouse (north-west) · garage (west) · chicken pen · cow pasture ·
 * vegetable garden · orchard · windmills · hay shed · well. Farm fence all around, hills + forest outside.
 */
export const FARM: Rect = { x0: -64, x1: 64, z0: -110, z1: 20 };

export interface FarmBuild {
  props: Prop[]; critters: Critter[]; decor: DecorAnimal[]; spinners: { obj: THREE.Object3D; speed: number }[];
  updaters: ((dt: number, t: number) => void)[];
  /** Static models (buildings, fences, crops, rocks…): instanced at the end of the build. */
  statics: THREE.Object3D[];
  pigSpawns: THREE.Vector3[];
  cage: Cage; chores: Chore[]; farmerSpawn: THREE.Vector3;
  zones: { garden: Rect[]; lawn: Rect; door: THREE.Vector3; mowerAt: THREE.Vector3 };
  inWater: (x: number, z: number) => boolean;
}

/**
 * Bob's day on farm 1. Day chores loop in order (05:30–20:00), evening = flashlight patrol (20:00–22:30),
 * night = bed (he sleeps in the house until dawn). Stand points are snapped to walkable cells.
 */
const CHORES: Chore[] = [
  { id: 'pigs', at: [26, 0.5], look: [26, 4], anim: 'pour', dur: 12, view: 'busy' },
  { id: 'chickens', at: [21, -22.5], look: [24, -26], anim: 'feed', dur: 18, view: 'busy' },
  { id: 'mow', at: [0, 0], look: [0, 0], anim: 'ride', dur: 55, view: 'busy' },
  { id: 'cows', at: [20.7, -59], look: [30, -59], anim: 'lean', dur: 14, view: 'normal' },
  { id: 'laundry', at: [-31.5, -27.2], look: [-31.5, -28.6], anim: 'laundry', dur: 14, view: 'busy' },
  { id: 'nap', at: [38, -81], look: [38, -74], anim: 'nap', dur: 28, view: 'nap' },
  { id: 'garden', at: [-36, -58.5], look: [-41, -58.5], anim: 'water', dur: 20, view: 'busy' },
  { id: 'paper', at: [-15.3, -29.2], look: [-12, -22], anim: 'read', dur: 22, view: 'busy' },
  { id: 'coffee', at: [-4.5, -30.5], look: [0, -20], anim: 'coffee', dur: 18, view: 'busy' },
  { id: 'wood', at: [-40.4, 10.4], look: [-40.4, 9], anim: 'chop', dur: 18, view: 'busy' },
  { id: 'tractor', at: [6.8, 6.6], look: [9, 9], anim: 'fix', dur: 16, view: 'busy' },
  // evening: flashlight round
  { id: 'patrol', at: [20, 0], look: [30, 6], anim: 'look', dur: 5, view: 'flashlight', phase: 'evening' },
  { id: 'patrol', at: [12, -24], look: [22, -26], anim: 'look', dur: 5, view: 'flashlight', phase: 'evening' },
  { id: 'patrol', at: [6, -58], look: [26, -62], anim: 'look', dur: 5, view: 'flashlight', phase: 'evening' },
  { id: 'patrol', at: [-28, -52], look: [-40, -58], anim: 'look', dur: 5, view: 'flashlight', phase: 'evening' },
  { id: 'patrol', at: [-6, -18], look: [-8, -35], anim: 'look', dur: 5, view: 'flashlight', phase: 'evening' },
  // night
  { id: 'bed', at: [-17.6, -33.4], look: [-24, -40], anim: 'idle', dur: 1, view: 'normal', phase: 'night' },
];

export function buildFarm1(scene: THREE.Scene): { terrain: Terrain; build: (t: Terrain, daynight: DayNight) => FarmBuild } {
  const terrain = new Terrain(FARM);
  // ---- ground paint (before terrain.build)
  const P = (pts: [number, number][], w = 3) => terrain.path(pts, w);
  P([[0, 26], [0, 10]], 4.5);                                  // road in from the south gate
  P([[0, 10], [-4, -12], [-14, -26], [-22, -30]], 3.5);        // barn → farmhouse
  P([[-22, -30], [-10, -46], [0, -56], [-8, -70], [-14, -76]], 3); // house → well → north barn
  P([[0, -56], [22, -56], [36, -62]], 2.6);                    // well → pasture gate
  P([[24, 6], [12, 7], [4, 8]], 2.6);                          // sty → barn
  P([[-38, 4], [-20, 6], [-6, 8]], 3);                         // garage → yard
  P([[16, -22], [8, -10], [2, 0]], 2.2);                       // chicken pen
  P([[44, -34], [36, -48], [30, -56]], 2.2);                   // windmill
  P([[-40, -52], [-24, -44], [-18, -36]], 2.2);                // garden
  P([[34, -80], [28, -66]], 2.2);                              // hay shed
  terrain.dirt({ x0: -12, x1: 12, z0: -9, z1: 12 }, 3);        // barn yard
  terrain.dirt({ x0: 24, x1: 36, z0: 3, z1: 13 }, 1.5);        // sty floor
  terrain.dirt({ x0: 16, x1: 28, z0: -30, z1: -18 }, 2);       // chicken pen
  terrain.dirt({ x0: -48, x1: -32, z0: -64, z1: -54 }, 1);     // garden soil
  terrain.dirt({ x0: -46, x1: -34, z0: -4, z1: 8 }, 2);        // garage apron
  terrain.mud(30, 8.5, 3.2, 2.4);                              // the sty wallow
  terrain.mud(9, -28, 2.2, 1.6); terrain.mud(-30, -12, 2.6, 2); terrain.mud(42, -8, 1.8, 1.5);
  terrain.mud(-6, -66, 2.4, 1.8); terrain.mud(38, -64, 2.5, 2); terrain.mud(-52, 10, 2, 1.6);

  terrain.dirt({ x0: -36, x1: -26, z0: -29, z1: -26 }, 1);          // under the laundry line
  terrain.dirt({ x0: -64, x1: -50, z0: -52, z1: -34 }, 1.5);       // sheep pen
  const POND = { x: 50, z: -2, r: 5.2 };

  const build = (t: Terrain, daynight: DayNight): FarmBuild => {
    const garden = { x0: -50, x1: -30, z0: -66, z1: -52 };
    const out: FarmBuild = {
      props: [], critters: [], decor: [], spinners: [], updaters: [], statics: [], pigSpawns: [],
      cage: new Cage(scene, V3(-8, t.height(-8, -35), -35), 0), chores: CHORES,
      farmerSpawn: V3(-4, t.height(-4, -28), -28),
      zones: { garden: [garden], lawn: { x0: -28, x1: -12, z0: -25, z1: -14 }, door: V3(-17.6, t.height(-17.6, -33.4), -33.4), mowerAt: V3(-31, t.height(-31, -16), -16) },
      inWater: (x, z) => Math.hypot(x - POND.x, z - POND.z) < POND.r - 0.3,
    };
    t.noGrass({ x0: -11, x1: -2, z0: -38, z1: -32 });
    const rng = new Rng(2026);
    const blocked: Rect[] = [];
    const y = (x: number, z: number) => t.height(x, z);

    // ---------------------------------------------------------------- helpers
    /** Building: collider follows its real mesh (open barns / sheds can be walked into). */
    const building = (model: string, x: number, z: number, height: number, yaw = 0, collide = true) => {
      const o = fitted(model, { height });
      o.position.set(x, y(x, z) - 0.05, z); o.rotation.y = yaw;
      scene.add(o); out.statics.push(o);
      const s = sizeOf(o);
      if (collide) staticTrimesh(o);
      const hx = (Math.abs(Math.cos(yaw)) * s.x + Math.abs(Math.sin(yaw)) * s.z) / 2;
      const hz = (Math.abs(Math.sin(yaw)) * s.x + Math.abs(Math.cos(yaw)) * s.z) / 2;
      const r = { x0: x - hx - 1, x1: x + hx + 1, z0: z - hz - 1, z1: z + hz + 1 };
      t.noGrass(r); blocked.push({ x0: r.x0 - 2, x1: r.x1 + 2, z0: r.z0 - 2, z1: r.z1 + 2 });
      return o;
    };
    const decor = (model: string, x: number, z: number, o: { height?: number; scale?: number; yaw?: number; collide?: 'box' | 'trunk' | false; sink?: number } = {}) => {
      if (!has(model)) return null;
      const m = fitted(model, { height: o.height, scale: o.scale });
      m.position.set(x, y(x, z) - 0.02 - (o.sink ?? 0), z); m.rotation.y = o.yaw ?? 0;
      scene.add(m); out.statics.push(m);
      const s = sizeOf(m);
      if (o.collide === 'box') staticBox(V3(x, y(x, z) + s.y / 2, z), V3(s.x / 2, s.y / 2, s.z / 2), o.yaw ?? 0);
      if (o.collide === 'trunk') staticCylinder(V3(x, y(x, z) + 2, z), 2, Math.min(0.45, s.x * 0.07 + 0.15));
      return m;
    };
    /** Fence along a line: model segments + one thin collider. */
    const fence = (x0: number, z0: number, x1: number, z1: number, model = 'kenney/fence_simple', h = 1.0) => {
      const len = Math.hypot(x1 - x0, z1 - z0); if (len < 0.5) return;
      const yaw = Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2;
      const probe = fitted(model, { height: h });
      const seg = Math.max(0.5, sizeOf(probe).x);
      const n = Math.max(1, Math.round(len / seg));
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n, x = x0 + (x1 - x0) * f, z = z0 + (z1 - z0) * f;
        const m = i === 0 ? probe : fitted(model, { height: h });
        m.scale.x = len / n / seg;
        m.position.set(x, y(x, z) - 0.05, z); m.rotation.y = yaw; scene.add(m); out.statics.push(m);
      }
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const b = staticBox(V3(cx, y(cx, cz) + 0.6, cz), V3(len / 2, 0.65, 0.12), yaw);
      if (model === 'kenney/fence_simple') SEE_THROUGH.add(b.collider(0).handle);   // rails: Bob sees through
    };
    const pen = (r: Rect, gate: 'n' | 's' | 'e' | 'w', gw = 2.4, model?: string) => {
      const gx = (r.x0 + r.x1) / 2, gz = (r.z0 + r.z1) / 2;
      if (gate === 's') { fence(r.x0, r.z1, gx - gw / 2, r.z1, model); fence(gx + gw / 2, r.z1, r.x1, r.z1, model); } else fence(r.x0, r.z1, r.x1, r.z1, model);
      if (gate === 'n') { fence(r.x0, r.z0, gx - gw / 2, r.z0, model); fence(gx + gw / 2, r.z0, r.x1, r.z0, model); } else fence(r.x0, r.z0, r.x1, r.z0, model);
      if (gate === 'w') { fence(r.x0, r.z0, r.x0, gz - gw / 2, model); fence(r.x0, gz + gw / 2, r.x0, r.z1, model); } else fence(r.x0, r.z0, r.x0, r.z1, model);
      if (gate === 'e') { fence(r.x1, r.z0, r.x1, gz - gw / 2, model); fence(r.x1, gz + gw / 2, r.x1, r.z1, model); } else fence(r.x1, r.z0, r.x1, r.z1, model);
      blocked.push(r);
    };
    const prop = (kind: keyof typeof PROPS, x: number, z: number, yaw = rng.range(0, 6.28), lift = 0) =>
      out.props.push(new Prop(scene, PROPS[kind], V3(x, y(x, z) + lift, z), yaw));
    const critter = (kind: keyof typeof CRITTERS, x: number, z: number, r: number) =>
      out.critters.push(new Critter(scene, CRITTERS[kind], V3(x, y(x, z), z), { x, z, r }));
    const spinner = (o: THREE.Object3D, name: string, speed: number) => {
      const b = o.getObjectByName(name); if (b) out.spinners.push({ obj: b, speed });
    };

    // ---------------------------------------------------------------- buildings
    building('farm/BigBarn', 0, -2, 13);
    const house = building('farm/Silo_House', -24, -40, 11, 0.25);
    void house;
    building('farm/SmallBarn', -40, -6, 7.5, Math.PI / 2);
    building('farm/Silo', 14, -9, 15);
    building('farm/Barn', -16, -86, 9, Math.PI);
    building('farm/ChickenCoop', 25, -27, 3.4, -Math.PI / 2);
    spinner(building('farm/Windmill', 48, -36, 17, -0.5), 'Windmill_Blades', 0.6);
    spinner(building('farm/TowerWindmill', -48, -94, 15, 0.4), 'TowerWindmill_Blades', 0.9);
    building('farm/WaterTower', -46, -24, 12);
    building('farm/Well', 0, -56, 3.2);
    building('farm/OpenBarn', 36, -86, 6.5, Math.PI);
    // sty shelter
    building('farm/ChickenCoop', 34.5, 11.2, 2.8, Math.PI); // the pigs' hut

    blocked.push({ x0: -12, x1: -1, z0: -39, z1: -28 });               // cage + grill + Bob's coffee spot
    // ---------------------------------------------------------------- pens & fences
    pen({ x0: 24, x1: 37, z0: 2, z1: 14 }, 'w', 2.6);                   // sty
    pen({ x0: 16, x1: 30, z0: -32, z1: -18 }, 's', 2.4);                // chickens
    pen({ x0: 22, x1: 52, z0: -76, z1: -50 }, 'w', 3.5, 'kenney/fence_planks'); // pasture
    pen(garden, 'e', 2.4);                                                // garden
    pen({ x0: -63, x1: -50, z0: -52, z1: -34 }, 'e', 2.6, 'kenney/fence_planks'); // sheep
    // outer farm fence (gate gap at the south road)
    const F = FARM, m = 0.5;
    fence(F.x0 + m, F.z1 - m, -3, F.z1 - m, 'kenney/fence_planks'); fence(3, F.z1 - m, F.x1 - m, F.z1 - m, 'kenney/fence_planks');
    fence(F.x0 + m, F.z0 + m, F.x1 - m, F.z0 + m, 'kenney/fence_planks');
    fence(F.x0 + m, F.z0 + m, F.x0 + m, F.z1 - m, 'kenney/fence_planks'); fence(F.x1 - m, F.z0 + m, F.x1 - m, F.z1 - m, 'kenney/fence_planks');
    // invisible walls (nobody leaves the farm, even with a rocket fart)
    const W = 8;
    staticBox(V3(0, W, F.z1 + 0.5), V3(70, W + 4, 0.5)); staticBox(V3(0, W, F.z0 - 0.5), V3(70, W + 4, 0.5));
    staticBox(V3(F.x0 - 0.5, W, -45), V3(0.5, W + 4, 70)); staticBox(V3(F.x1 + 0.5, W, -45), V3(0.5, W + 4, 70));

    // ---------------------------------------------------------------- garden rows
    for (let i = 0; i < 6; i++) {
      const z = -63.5 + i * 2.1;
      for (let x = -48; x < -32; x += 2) {
        decor('kenney/crops_dirtRow', x + 1, z, { scale: 2, yaw: Math.PI / 2 });
        // Quaternius Ultimate Crops (carrot / beet roots sit in the soil)
        const [crop, sc, sink] = ([['crops/Carrot_4', 1.5, 0.9], ['crops/Lettuce_4', 1.2, 0.04], ['crops/Tomato_4', 1.5, 0],
          ['crops/Beet_4', 1.5, 0.45], ['crops/BushBerries_4', 0.85, 0], ['crops/Watermelon_4', 1.15, 0.22]] as const)[i];
        decor(crop, x + 1 + rng.range(-0.15, 0.15), z, { scale: sc, sink, yaw: rng.range(0, 6.28) });
      }
    }
    // corn field
    for (let x = -60; x < -36; x += 1.6) for (let z = -104; z < -94; z += 1.6)
      if (Math.hypot(x - -48, z - -99) > 1.8) decor('kenney/crops_cornStageD', x + rng.range(-0.2, 0.2), z + rng.range(-0.2, 0.2), { scale: 2.6, yaw: rng.range(0, 6) });
    t.noGrass({ x0: -61, x1: -36, z0: -105, z1: -93 });

    // ---------------------------------------------------------------- yard dressing (static)
    decor('kenney/tractor', 9, 9, { height: 2.6, yaw: -2.2, collide: 'box' });
    decor('kenney/truckFlat', -10, -46, { height: 2.4, yaw: 0.3, collide: 'box' });
    decor('kenney/cart', -9, 4, { height: 1.6, yaw: 0.6, collide: 'box' });
    decor('kit/Prop_Wagon', 18, 0, { height: 1.8, yaw: 1.2, collide: 'box' });
    decor('kenney/log_stackLarge', -36, 4, { height: 1.4, yaw: 1.57, collide: 'box' });
    decor('kenney/stall', -30, -36, { height: 2.6, yaw: 0.3, collide: 'box' });
    decor('kenney/sign', 3, 17, { height: 1.4, yaw: 0 });
    for (let i = 0; i < 4; i++) decor('kenney/stump_round', -42 + i * 1.6, 9 + rng.range(-0.3, 0.3), { height: 0.5, collide: 'box' });
    // trough in the sty
    decor('kit/Prop_Crate', 26, 4, { height: 0.5, scale: undefined, collide: 'box', yaw: 0 });

    // ---------------------------------------------------------------- loose props
    for (const [x, z] of [[-6, 9], [-7, 10.5], [6, 9.5], [-8, -12]] as const) prop('crate', x, z);
    prop('crate', -6.5, 9.8, 0.2, 0.85);
    for (const [x, z] of [[7, -11], [8.2, -11.4], [-34, -2], [-34.5, -0.8], [46, -42]] as const) prop('barrel', x, z, 0);
    for (const [x, z] of [[-30, -50], [-31.5, -49], [-33, -50.5], [-28, -48], [-46, -50]] as const) prop('pumpkin', x, z);
    for (const [x, z] of [[-36, -50], [-38, -49.4]] as const) prop('melon', x, z);
    prop('veggieCrate', -26, -34.5); prop('potatoCrate', -28, -34); prop('tomatoCrate', -31, -34.2); prop('cheese', -21, -33);
    prop('ham', -29.5, -35.2, 0, 1.2);
    prop('pot', -18, -33); prop('mug', -2.6, -31.8);
    for (const [x, z] of [[-39, 6], [-40.5, 7], [-38, 7.6]] as const) prop('log', x, z);
    prop('wheel', -12, 6, 0.4);
    prop('sword', 36, -84); prop('axe', -38.6, 9.4, 0.3, 0.55);   // the axe lies on the chopping stumps
    // valuables (M5 loot): Bob's porch, the picnic table, the BBQ, the barn, the garage, the garden
    prop('chest', -14.2, -30.4, 2.4); prop('chalice', -15.6, -30.0); prop('necklace', -12.8, -31.6);
    prop('phone', 8.1, -47.4, 0.3, 0.84); prop('radio', 9.1, -47.7, 0.3, 0.84);
    prop('crown', -39.9, -45.3, 0.6);
    prop('gold', -10.8, -49.5, 0.3);
    prop('gasCan', 7.6, 11.6); prop('propane', -2.6, -29.6, 0); prop('pan', -4.2, -29.2);
    prop('firstAid', 4.5, 7.2); prop('backpack', -3.5, 7.4);
    prop('shovel', -23.8, -59.5, 1.2); prop('trashcan', -13.2, -26.8, 0);
    for (let i = 0; i < 4; i++) prop('crate', 34 + (i % 2) * 1.05, -84 + Math.floor(i / 2) * 1.05, 0);

    // ---------------------------------------------------------------- animals
    const coop = V3(22.5, y(22.5, -27), -27);
    for (let i = 0; i < 6; i++) critter('hen', rng.range(18, 28), rng.range(-30, -20), 4.5);
    for (let i = 0; i < 4; i++) critter('chick', rng.range(19, 27), rng.range(-29, -21), 3);
    for (const c of out.critters) c.roost = coop;
    for (let i = 0; i < 3; i++) critter('cow', rng.range(28, 46), rng.range(-70, -56), 9);
    critter('horse', 40, -62, 8); critter('horse2', 33, -67, 8); critter('donkey', 46, -57, 5);
    for (let i = 0; i < 5; i++) critter('sheep', rng.range(-60, -52), rng.range(-50, -36), 5);
    critter('alpaca', -56, -40, 4);
    critter('dog', -16, -30, 5);
    critter('cat', -4, 6, 6); critter('cat', -20, -36, 4);
    critter('bunny', -40, -58, 6); critter('bunny', -36, -61, 6); critter('bunny', 12, -76, 5);
    for (let i = 0; i < 3; i++) critter('duck', POND.x + rng.range(-3, 3), POND.z + rng.range(-3, 3), 3.5);
    for (let i = 0; i < 3; i++) out.decor.push(new DecorAnimal(scene, 'hen', V3(31 + i * 0.7, 3.3, -84.5), 0.3));

    // ---------------------------------------------------------------- pigs start in the sty
    out.pigSpawns.push(V3(28, y(28, 5) + 0.5, 5), V3(33, y(33, 5) + 0.5, 5), V3(27, y(27, 12) + 0.5, 12), V3(31, y(31, 12.5) + 0.5, 12.5));

    // ---------------------------------------------------------------- more life: lamps, pond, laundry, scarecrow, bees…
    buildDecor({ scene, t, rng, out, daynight, decor, prop, blocked, POND, F });

    // ---------------------------------------------------------------- nature (cartoon, instanced)
    const forest = new Forest();
    const free = (x: number, z: number, pad = 0) =>
      !blocked.some((r) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad) && !t.isBare(x, z);
    const tree = (kind: TreeKind, x: number, z: number, s: number, collide: boolean) => {
      forest.add(kind, x, y(x, z), z, s);
      if (collide) staticCylinder(V3(x, y(x, z) + 1.5, z), 1.5, 0.3 * s);
    };
    // hiding spots: big bushes, wheat + corn, bale stacks, log piles, crates…
    buildHideouts({ scene, t, rng, out, blocked, forest, decor });
    // hedge along the inside of the farm fence (gap at the gate)
    const hedgeRun = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.floor(len / 3.4), yaw = Math.atan2(z1 - z0, x1 - x0);
      for (let i = 0; i <= n; i++) {
        const f = i / n, x = x0 + (x1 - x0) * f, z = z0 + (z1 - z0) * f;
        if (Math.abs(x) < 5 && z > F.z1 - 4) continue;
        forest.add('hedge', x, y(x, z), z, rng.range(1.1, 1.35), -yaw);
      }
    };
    const hm = 2.2;
    hedgeRun(F.x0 + hm, F.z1 - hm, F.x1 - hm, F.z1 - hm); hedgeRun(F.x0 + hm, F.z0 + hm, F.x1 - hm, F.z0 + hm);
    hedgeRun(F.x0 + hm, F.z0 + hm, F.x0 + hm, F.z1 - hm); hedgeRun(F.x1 - hm, F.z0 + hm, F.x1 - hm, F.z1 - hm);
    // a few trees just outside the fence + groves on the farmland around
    for (let i = 0; i < 70; i++) {
      const side = rng.int(0, 3), d = rng.range(5, 14);
      const x = side < 2 ? rng.range(F.x0 - 10, F.x1 + 10) : side === 2 ? F.x0 - d : F.x1 + d;
      const z = side >= 2 ? rng.range(F.z0 - 10, F.z1 + 10) : side === 0 ? F.z0 - d : F.z1 + d;
      if (Math.abs(x) < 7 && z > F.z1) continue; // keep the road clear
      tree(rng.pick(['oak', 'oak', 'pine', 'poplar'] as TreeKind[]), x, z, rng.range(1.1, 1.6), false);
    }
    for (let gidx = 0; gidx < 9; gidx++) {
      const a = rng.range(0, 6.28), d = rng.range(110, 170), cx = Math.cos(a) * d, cz = Math.sin(a) * d - 45;
      for (let i = 0; i < 9; i++) tree(rng.pick(['oak', 'pine', 'pine', 'poplar'] as TreeKind[]), cx + rng.range(-12, 12), cz + rng.range(-12, 12), rng.range(1.3, 2), false);
    }
    // orchard + shade trees inside
    for (let x = 4; x <= 18; x += 4.6) for (let z = -84; z <= -70; z += 4.6) tree('apple', x + rng.range(-0.5, 0.5), z + rng.range(-0.5, 0.5), rng.range(1, 1.15), true);
    let placed = 0;
    for (let i = 0; i < 400 && placed < 16; i++) {
      const x = rng.range(F.x0 + 6, F.x1 - 6), z = rng.range(F.z0 + 6, F.z1 - 6);
      if (!free(x, z, 3)) continue;
      tree(rng.pick(['oak', 'oak', 'poplar', 'pine'] as TreeKind[]), x, z, rng.range(1, 1.35), true);
      blocked.push({ x0: x - 2.5, x1: x + 2.5, z0: z - 2.5, z1: z + 2.5 });
      placed++;
    }
    for (let i = 0, n = 0; i < 500 && n < 45; i++) {
      const x = rng.range(F.x0 + 4, F.x1 - 4), z = rng.range(F.z0 + 4, F.z1 - 4);
      if (!free(x, z, 1)) continue;
      const s = rng.range(0.9, 1.4);
      forest.add(rng.next() < 0.4 ? 'flowerBush' : 'bush', x, y(x, z), z, s); n++;
      G.cover.circle('bush', x, z, 0.95 * s, y(x, z), 1.2 * s);
    }
    forest.finish(scene);
    // flowers, rocks, mushrooms
    const small: [string, number, number, number][] = [
      ['nature/Flower_3_Group', 50, 0.35, 0.5], ['nature/Flower_4_Group', 50, 0.35, 0.5],
      ['kenney/rock_largeA', 8, 0.7, 1.2], ['kenney/rock_smallA', 14, 0.3, 0.5], ['nature/Mushroom_Common', 14, 0.2, 0.3],
    ];
    for (const [model, count, h0, h1] of small) {
      for (let i = 0, n = 0; i < count * 6 && n < count; i++) {
        const x = rng.range(F.x0 + 3, F.x1 - 3), z = rng.range(F.z0 + 3, F.z1 - 3);
        if (!free(x, z)) continue;
        decor(model, x, z, { height: rng.range(h0, h1), yaw: rng.range(0, 6.28), collide: model.includes('rock_large') ? 'box' : false });
        n++;
      }
    }
    // hay bales (rollable!)
    for (const [x, z] of [[30, -78], [32, -79.5], [40, -80], [-4, -14], [-2.5, -15.2], [12, 14], [-30, 0], [38, -10]] as const) prop('hay', x, z);
    // one draw call per repeated static part instead of hundreds (same look)
    const n = instanceStatic(scene, out.statics, new Set(out.spinners.map((s) => s.obj)));
    console.log(`static meshes instanced: ${n}`);
    return out;
  };
  return { terrain, build };
}
