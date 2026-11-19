import * as THREE from 'three';
import { fitted, sizeOf, has } from '../core/assets';
import { staticBox, staticCylinder, staticTrimesh, SEE_THROUGH } from '../core/physics';
import { Rng, V3 } from '../core/util';
import type { Terrain, Rect } from './terrain';
import { Prop, PROPS } from './props';
import { Critter, CRITTERS, type DecorAnimal } from './animals';
import { Forest, type TreeKind } from './nature';
import type { Cage } from './cage';
import type { Chore } from '../farmer/farmer';
import type { DayNight } from './daynight';
import type { GateDef, GateState } from './gates';
import type { MissionId } from '../game/round';
import type { Orchard } from './orchard';
import type { Bees } from './bees';
import type { Dairy } from './dairy';
import type { Pumpkins } from './pumpkins';
import type { Winter } from './winter';
import type { Outhouse } from './outhouse';
import type { Phones } from './phone';
import type { Hammock } from './hammock';
import type { Porch } from './porch';
import type { ModId } from '../game/modifiers';
import { G } from '../game/ctx';
import { instanceStatic } from '../render/batch';
import { Waterworks } from './waterworks';
import { Farmhouse, HOUSE, type FarmhouseOpts } from './farmhouse';

/** Named spots of a farm the game logic needs (pranks, Bob's trips, the dog's patrol, admin teleports). */
export interface Places {
  pond: { x: number; z: number; r: number };
  /** Things dropped down the well (pranks); null = this farm has none. */
  well: { x: number; z: number } | null;
  /** Pens the "let them out" pranks count (hens / sheep / big animals). */
  coop: Rect | null; sheepPen: Rect | null; pasture: Rect | null;
  /** The pigs' loot stash (in the sty). */
  stash: THREE.Vector3;
  /** The road gate (Bob leaves for the market there; things that fall off the world come back near it). */
  roadGate: THREE.Vector3;
  /** Where the guard dog patrols off the leash. */
  dogPatrol: { x: number; z: number; r: number };
  /** Farm 5: the mountain's top (mission: climb it). */
  peak?: { x: number; z: number; r: number };
  /** Admin teleports: [label key suffix (a.<key>), x, z]. */
  tp: [string, number, number][];
}

export interface FarmBuild {
  props: Prop[]; critters: Critter[]; decor: DecorAnimal[]; spinners: { obj: THREE.Object3D; speed: number }[];
  updaters: ((dt: number, t: number) => void)[];
  /** Static models (buildings, fences, crops, rocks…): instanced at the end of the build. */
  statics: THREE.Object3D[];
  pigSpawns: THREE.Vector3[];
  cage: Cage; chores: Chore[]; farmerSpawn: THREE.Vector3;
  zones: { garden: Rect[]; lawn: Rect; door: THREE.Vector3; mowerAt: THREE.Vector3; roadGate: THREE.Vector3 };
  inWater: (x: number, z: number) => boolean;
  /** Pen gates (built in game.ts: they need the pigs / Bob). */
  gates: GateDef[];
  places: Places;
  /** Pranks this farm can roll (required / bonus pools are filtered by it). */
  missions: MissionId[];
  /** This farm's own pranks: one of the two required ones each round comes from here. */
  featured?: MissionId[];
  /** Farm 2: shakeable fruit trees + cider press, angry beehives (synced entities). */
  orchard?: Orchard; bees?: Bees;
  /** Farm 3: the bull's brain, milk churns + spilled milk, cow tipping (one synced entity). */
  dairy?: Dairy;
  /** Farm 4: jack-o'-lanterns (lit pools, snuffed / relit) + the catapult (one synced entity). */
  pumpkins?: Pumpkins;
  /** Farm 5: ice + the fishing hole, footprints, snowballs, the prize snowman (one synced entity). */
  winter?: Winter;
  /** Bob's outhouse(s) (toilet breaks: bolt him in, tip it over; synced entities, built by the decor kit). */
  loos?: Outhouse[];
  /** Bob's phone by the porch + the payphone by the road gate (one synced entity, built by the decor kit). */
  phones?: Phones;
  /** Bob's hammock (his siesta; synced entity, decor kit). */
  hammock?: Hammock;
  /** Bob's walk-in farmhouse (built from code: rooms, his bed, the roof hides while my pig is inside). */
  house?: Farmhouse;
  /** Every building placed by the kit (model, centre, turn, its model size before turning): interiors.ts looks inside. */
  buildings?: { model: string; x: number; z: number; yaw: number; sx: number; sz: number; sy: number }[];
  /** Water troughs (Bob cools his mouth in one after a spiked coffee). */
  troughs?: { x: number; z: number; yaw: number }[];
  /** Bob's coffee break: the side table by his rocker, his mug, the hot sauce by the grill (synced entity, decor kit). */
  porch?: Porch;
  /** Chain modes (farms 6 / 7): the production chain (world/chain.ts; one synced entity + its visions). */
  chain?: import('./chain').Chain;
  /** Rivers / streams / terrace walls + their bridges (waterworks.ts). */
  water?: Waterworks;
  /** The round's clock (farm 4: starts at dusk, slow hours so the round stays at night); default 7:00, 25 s / hour. */
  clock?: { start: number; secsPerHour: number };
  /** 0..1 darker nights (farm 4). */
  darkNight?: number;
  /** Hours the wolves come (default 21:00–4:18). */
  wolfHours?: [number, number];
  /** Round modifiers that make no sense here (farm 4 at night: no market day). */
  noMods?: ModId[];
}

export interface FarmDef {
  bounds: Rect;
  terrain: Terrain;
  build: (t: Terrain, daynight: DayNight) => FarmBuild;
}

export type DecorOpts = { height?: number; scale?: number; yaw?: number; collide?: 'box' | 'trunk' | false; sink?: number };

/**
 * The building blocks every farm uses (they place models, colliders, nav-blocking rects and hiding info the same way).
 * `blocked` = rects where scattered trees / rocks / bushes must not go (buildings, pens, paths…).
 */
/**
 * The farm-pack barns (BigBarn / Barn / SmallBarn) are hollow inside — walls with inner faces, a ceiling, a real
 * doorway — only their doors shut them. Take the doors off (before the collider is made; swung open, their plain
 * backs looked like blank boards): the barn is walk-in, so interiors.ts furnishes it and pigs can hide / loot in there.
 */
function openDoors(o: THREE.Object3D) {
  const doors: THREE.Object3D[] = [];
  o.traverse((c) => { if (/_Door2?$/.test(c.name)) doors.push(c); });
  for (const d of doors) d.removeFromParent();
  return doors.length > 0;
}

export function farmKit(scene: THREE.Scene, t: Terrain, out: FarmBuild, F: Rect, seed: number) {
  const rng = new Rng(seed);
  const blocked: Rect[] = [];
  const y = (x: number, z: number) => t.height(x, z);
  const forest = new Forest();
  // rivers / streams / terrace walls carved into this farm's ground (its bridges / boardwalks are added by the farm)
  const water = new Waterworks(scene, t, F);
  water.waters(); water.terraceWalls();
  for (const st of t.steps) {   // nothing scattered on a terrace wall or a ramp, no grass through the stones
    blocked.push({ x0: F.x0 - 30, x1: F.x1 + 30, z0: st.z - 2.2, z1: st.z + 1.2 });
    t.noGrass({ x0: F.x0 - 30, x1: F.x1 + 30, z0: st.z - 1.15, z1: st.z + 0.2 });
    for (const [r0, r1, len] of st.ramps) {
      blocked.push({ x0: r0 - 1.6, x1: r1 + 1.6, z0: st.z - len - 1, z1: st.z + 1 });
      t.noGrass({ x0: r0 - 1.1, x1: r0 + 0.1, z0: st.z - len, z1: st.z }); t.noGrass({ x0: r1 - 0.1, x1: r1 + 1.1, z0: st.z - len, z1: st.z });
    }
  }

  /** Building: collider follows its real mesh (open barns / sheds can be walked into). */
  const building = (model: string, x: number, z: number, height: number, yaw = 0, collide = true) => {
    const o = fitted(model, { height });
    openDoors(o);
    o.position.set(x, y(x, z) - 0.05, z); o.rotation.y = yaw;
    scene.add(o); out.statics.push(o);
    const s = sizeOf(o);
    if (collide) staticTrimesh(o);
    const hx = (Math.abs(Math.cos(yaw)) * s.x + Math.abs(Math.sin(yaw)) * s.z) / 2;
    const hz = (Math.abs(Math.sin(yaw)) * s.x + Math.abs(Math.cos(yaw)) * s.z) / 2;
    const r = { x0: x - hx - 1, x1: x + hx + 1, z0: z - hz - 1, z1: z + hz + 1 };
    t.noGrass(r); blocked.push({ x0: r.x0 - 2, x1: r.x1 + 2, z0: r.z0 - 2, z1: r.z1 + 2 });
    (out.buildings ??= []).push({ model, x, z, yaw, sx: s.x, sz: s.z, sy: s.y });   // (world/interiors.ts furnishes the ones you can walk into)
    return o;
  };
  const decor = (model: string, x: number, z: number, o: DecorOpts = {}) => {
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
    if (model === 'kenney/fence_simple' || model === 'halloween/fence') SEE_THROUGH.add(b.collider(0).handle);   // rails / iron bars: Bob sees through
  };
  /** A fenced pen with a gap on one side; `gateId` = a real hinged gate in the gap (gates.ts). */
  const pen = (r: Rect, gate: 'n' | 's' | 'e' | 'w', gw = 2.4, model?: string, gateId?: string, o: { lockable?: boolean; start?: GateState } = {}) => {
    const gx = (r.x0 + r.x1) / 2, gz = (r.z0 + r.z1) / 2;
    if (gate === 's') { fence(r.x0, r.z1, gx - gw / 2, r.z1, model); fence(gx + gw / 2, r.z1, r.x1, r.z1, model); } else fence(r.x0, r.z1, r.x1, r.z1, model);
    if (gate === 'n') { fence(r.x0, r.z0, gx - gw / 2, r.z0, model); fence(gx + gw / 2, r.z0, r.x1, r.z0, model); } else fence(r.x0, r.z0, r.x1, r.z0, model);
    if (gate === 'w') { fence(r.x0, r.z0, r.x0, gz - gw / 2, model); fence(r.x0, gz + gw / 2, r.x0, r.z1, model); } else fence(r.x0, r.z0, r.x0, r.z1, model);
    if (gate === 'e') { fence(r.x1, r.z0, r.x1, gz - gw / 2, model); fence(r.x1, gz + gw / 2, r.x1, r.z1, model); } else fence(r.x1, r.z0, r.x1, r.z1, model);
    blocked.push(r);
    if (!gateId) return;
    const ns = gate === 'n' || gate === 's', ex = gate === 'w' ? r.x0 : gate === 'e' ? r.x1 : gx, ez = gate === 'n' ? r.z0 : gate === 's' ? r.z1 : gz;
    const a = ns ? V3(ex - gw / 2, 0, ez) : V3(ex, 0, ez - gw / 2), b = ns ? V3(ex + gw / 2, 0, ez) : V3(ex, 0, ez + gw / 2);
    a.y = y(a.x, a.z); b.y = y(b.x, b.z);
    const outN = gate === 'n' ? V3(0, 0, -1) : gate === 's' ? V3(0, 0, 1) : gate === 'w' ? V3(-1, 0, 0) : V3(1, 0, 0);
    out.gates.push({ id: gateId, a, b, out: outN, rect: r, lockable: o.lockable ?? true, start: o.start ?? 'shut' });
  };
  const prop = (kind: keyof typeof PROPS, x: number, z: number, yaw = rng.range(0, 6.28), lift = 0) => {
    const p = new Prop(scene, PROPS[kind], V3(x, y(x, z) + lift, z), yaw);
    out.props.push(p);
    return p;
  };
  const critter = (kind: keyof typeof CRITTERS, x: number, z: number, r: number) => {
    const c = new Critter(scene, CRITTERS[kind], V3(x, y(x, z), z), { x, z, r });
    out.critters.push(c);
    return c;
  };
  const spinner = (o: THREE.Object3D, name: string, speed: number) => {
    const b = o.getObjectByName(name); if (b) out.spinners.push({ obj: b, speed });
  };
  const free = (x: number, z: number, pad = 0) =>
    !blocked.some((r) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad) && !t.isBare(x, z) && !t.nearWater(x, z, 1.4 + pad);
  const tree = (kind: TreeKind, x: number, z: number, s: number, collide: boolean) => {
    forest.add(kind, x, y(x, z), z, s);
    if (collide) staticCylinder(V3(x, y(x, z) + 1.5, z), 1.5, 0.3 * s);
  };
  /** Outer farm fence with a gap for the road gate at x = 0 on the south side, + invisible walls (no rocket-fart escapes). */
  const outerFence = () => {
    const m = 0.5;
    fence(F.x0 + m, F.z1 - m, -3, F.z1 - m, 'kenney/fence_planks'); fence(3, F.z1 - m, F.x1 - m, F.z1 - m, 'kenney/fence_planks');
    fence(F.x0 + m, F.z0 + m, F.x1 - m, F.z0 + m, 'kenney/fence_planks');
    fence(F.x0 + m, F.z0 + m, F.x0 + m, F.z1 - m, 'kenney/fence_planks'); fence(F.x1 - m, F.z0 + m, F.x1 - m, F.z1 - m, 'kenney/fence_planks');
    const W = 8, cx = (F.x0 + F.x1) / 2, cz = (F.z0 + F.z1) / 2, hx = (F.x1 - F.x0) / 2 + 6, hz = (F.z1 - F.z0) / 2 + 6;
    staticBox(V3(cx, W, F.z1 + 0.5), V3(hx, W + 4, 0.5)); staticBox(V3(cx, W, F.z0 - 0.5), V3(hx, W + 4, 0.5));
    staticBox(V3(F.x0 - 0.5, W, cz), V3(0.5, W + 4, hz)); staticBox(V3(F.x1 + 0.5, W, cz), V3(0.5, W + 4, hz));
  };
  /** Hedge along the inside of the farm fence (gap at the road gate). */
  const hedgeRing = () => {
    const run = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.floor(len / 3.4), yaw = Math.atan2(z1 - z0, x1 - x0);
      for (let i = 0; i <= n; i++) {
        const f = i / n, x = x0 + (x1 - x0) * f, z = z0 + (z1 - z0) * f;
        if (Math.abs(x) < 5 && z > F.z1 - 4) continue;
        forest.add('hedge', x, y(x, z), z, rng.range(1.1, 1.35), -yaw);
      }
    };
    const hm = 2.2;
    run(F.x0 + hm, F.z1 - hm, F.x1 - hm, F.z1 - hm); run(F.x0 + hm, F.z0 + hm, F.x1 - hm, F.z0 + hm);
    run(F.x0 + hm, F.z0 + hm, F.x0 + hm, F.z1 - hm); run(F.x1 - hm, F.z0 + hm, F.x1 - hm, F.z1 - hm);
  };
  /** Trees just outside the fence + groves on the farmland around (no colliders: nobody gets there). */
  const surroundings = (kinds: TreeKind[] = ['oak', 'oak', 'pine', 'poplar'], n = 70) => {
    for (let i = 0; i < n; i++) {
      const side = rng.int(0, 3), d = rng.range(5, 14);
      const x = side < 2 ? rng.range(F.x0 - 10, F.x1 + 10) : side === 2 ? F.x0 - d : F.x1 + d;
      const z = side >= 2 ? rng.range(F.z0 - 10, F.z1 + 10) : side === 0 ? F.z0 - d : F.z1 + d;
      if (Math.abs(x) < 7 && z > F.z1) continue; // keep the road clear
      tree(rng.pick(kinds), x, z, rng.range(1.1, 1.6), false);
    }
    const cx = (F.x0 + F.x1) / 2, cz = (F.z0 + F.z1) / 2;
    for (let gidx = 0; gidx < 9; gidx++) {
      const a = rng.range(0, 6.28), d = rng.range(110, 170), gx = Math.cos(a) * d + cx, gz = Math.sin(a) * d + cz;
      for (let i = 0; i < 9; i++) tree(rng.pick(['oak', 'pine', 'pine', 'poplar'] as TreeKind[]), gx + rng.range(-12, 12), gz + rng.range(-12, 12), rng.range(1.3, 2), false);
    }
  };
  /** Shade trees inside (with trunks), small bushes (soft cover), flowers / rocks / mushrooms on the free ground. */
  const scatter = (o: { trees?: number; bushes?: number; small?: [string, number, number, number][] } = {}) => {
    let placed = 0;
    for (let i = 0; i < 400 && placed < (o.trees ?? 16); i++) {
      const x = rng.range(F.x0 + 6, F.x1 - 6), z = rng.range(F.z0 + 6, F.z1 - 6);
      if (!free(x, z, 3)) continue;
      tree(rng.pick(['oak', 'oak', 'poplar', 'pine'] as TreeKind[]), x, z, rng.range(1, 1.35), true);
      blocked.push({ x0: x - 2.5, x1: x + 2.5, z0: z - 2.5, z1: z + 2.5 });
      placed++;
    }
    for (let i = 0, n = 0; i < 500 && n < (o.bushes ?? 45); i++) {
      const x = rng.range(F.x0 + 4, F.x1 - 4), z = rng.range(F.z0 + 4, F.z1 - 4);
      if (!free(x, z, 1)) continue;
      const s = rng.range(0.9, 1.4);
      forest.add(rng.next() < 0.4 ? 'flowerBush' : 'bush', x, y(x, z), z, s); n++;
      G.cover.circle('bush', x, z, 0.95 * s, y(x, z), 1.2 * s);
    }
    forest.finish(scene);
    const small = o.small ?? [
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
  };
  /**
   * Bob's walk-in farmhouse (s26): replaces the closed house models. The farm flattened a pad for it first
   * (`Terrain.pad` before the ground was built). Its door becomes Bob's door zone, his bed chore goes to his bed.
   */
  const farmhouse = (o: FarmhouseOpts, daynight: DayNight | null) => {
    const h = new Farmhouse(scene, o, y, daynight);
    out.house = h;
    const c = Math.abs(Math.cos(o.yaw)), s = Math.abs(Math.sin(o.yaw)), W = h.w + 1.6, D = h.d + 4;
    const hx = (c * W + s * D) / 2, hz = (s * W + c * D) / 2;
    const r = { x0: o.x - hx, x1: o.x + hx, z0: o.z - hz, z1: o.z + hz };
    t.noGrass(r); blocked.push({ x0: r.x0 - 1.5, x1: r.x1 + 1.5, z0: r.z0 - 1.5, z1: r.z1 + 1.5 });
    out.zones.door.copy(h.door);
    const bed = h.toWorld(-2.4, -1.5, new THREE.Vector3()); out.places.tp.push(['bedroom', bed.x, bed.z]);
    // (furnished by interiors.ts from its fixed layout: it isn't one of the barns' random fills)
    (out.buildings ??= []).push({ model: 'farmhouse', x: o.x, z: o.z, yaw: o.yaw, sx: h.w, sz: h.d, sy: HOUSE.H });
    return h;
  };
  /** Last step: one draw call per repeated static part instead of hundreds (same look). */
  const finish = () => {
    water.finish();
    if (t.waters.length) out.updaters.push((dt) => water.update(dt));
    out.water = water;
    const n = instanceStatic(scene, out.statics, new Set(out.spinners.map((s) => s.obj)));
    console.log(`static meshes instanced: ${n}`);
    return out;
  };
  return { rng, blocked, y, forest, water, building, decor, fence, pen, prop, critter, spinner, free, tree, outerFence, hedgeRing, surroundings, scatter, farmhouse, finish };
}
export type Kit = ReturnType<typeof farmKit>;
