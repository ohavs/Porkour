import * as THREE from 'three';
import { V3, Rng } from '../core/util';
import { Terrain, type Rect } from './terrain';
import { Cage } from './cage';
import type { Chore } from '../farmer/farmer';
import type { DayNight } from './daynight';
import { decorKit } from './decor';
import { coverKit } from './hideouts';
import { farmKit, type FarmBuild, type FarmDef } from './farmKit';
import { Pumpkins } from './pumpkins';
import { swamp } from './swamp';
import { G } from '../game/ctx';
import type { MissionId } from '../game/round';

/** Models only farm 4 uses (preloaded when farm 4 is played): KayKit Halloween Bits + Quaternius (CC0). */
export const FARM4_MODELS = [
  ...['pumpkin_yellow_small', 'tree_dead_large', 'tree_dead_medium', 'tree_dead_small', 'tree_pine_orange_large',
    'tree_pine_orange_medium', 'tree_pine_yellow_large', 'tree_pine_yellow_medium', 'gravestone', 'grave_A', 'grave_B', 'gravemarker_A',
    'gravemarker_B', 'fence', 'arch_gate', 'crypt', 'candle_triple', 'skull_candle', 'bench_decorated'].map((n) => 'halloween/' + n),
  'kaykit/pumpkin_orange_small', 'kaykit/jar_A_large',
  ...['Bench_2', 'Cart'].map((n) => 'village/' + n),
  'nature/Willow_1', 'crops/Pumpkin_4',
];

/**
 * Farm 4 — the pumpkin farm, played at NIGHT (harvest night before the county fair: Bob is up all night guarding his
 * giant prize pumpkin). North = −z, the road gate in the south (x = 0). The round runs from dusk (19:30) to just
 * before dawn. Jack-o'-lanterns light pools Bob sees you in (snuff them!), a catapult flings pumpkins / hens / pigs.
 * Layout: sty (start, south-east) · yard + barn (south-centre) · chicken pen + duck pond (south-west) · the pumpkin
 * patch (west, the giant pumpkin at its east edge by the lane) · the catapult (centre) · the corn maze (north-west, a
 * trophy in the middle) · the farmhouse + porch where Bob carves pumpkins (north) · cage + grill by the porch ·
 * the old family plot with a crypt (north-east) · Bob's garden (north, behind the cage).
 */
export const FARM4: Rect = { x0: -60, x1: 60, z0: -104, z1: 16 };
const PATCH: Rect = { x0: -52, x1: -16, z0: -62, z1: -22 };
const MAZE = { x0: -58, z0: -102, cols: 21, rows: 19, cell: 1.6 };
const GRAVES: Rect = { x0: 30, x1: 54, z0: -102, z1: -84 };
const GIANT = { x: -12.5, z: -40 };
const CATAPULT = { x: 14, z: -46 };
const PORCH = { x: -6, z: -79.6 };   // the carving table
/**
 * The bog (east half, user: "the maps should differ more"): murky pools joined by channels, a boardwalk over them,
 * stepping stones, dead trees, will-o'-wisps and mist at night, frogs and an owl.
 */
const BOG = [{ x: 36, z: -56, r: 4.5 }, { x: 42, z: -68, r: 4 }, { x: 46, z: -46, r: 3 }];

const CHORES: Chore[] = [
  // dusk
  { id: 'pigs', at: [35.4, 2], look: [38, 2], anim: 'pour', dur: 10, view: 'busy' },
  { id: 'carve', at: [PORCH.x, PORCH.z + 1.4], look: [PORCH.x, PORCH.z], anim: 'fix', dur: 16, view: 'busy' },
  { id: 'chickens', at: [-20.4, -2], look: [-24, -2], anim: 'feed', dur: 12, view: 'busy' },
  // evening: flashlight round of the farm
  { id: 'patrol', at: [-12, -24], look: [-30, -36], anim: 'look', dur: 5, view: 'flashlight', phase: 'evening' },
  { id: 'prize', at: [GIANT.x + 2.6, GIANT.z + 0.6], look: [GIANT.x, GIANT.z], anim: 'lean', dur: 14, view: 'normal', phase: 'evening' },
  { id: 'patrol', at: [-20, -66], look: [-34, -80], anim: 'look', dur: 5, view: 'flashlight', phase: 'evening' },
  { id: 'carve', at: [PORCH.x, PORCH.z + 1.4], look: [PORCH.x, PORCH.z], anim: 'fix', dur: 18, view: 'busy', phase: 'evening' },
  { id: 'patrol', at: [42, -79], look: [42, -92], anim: 'look', dur: 5, view: 'flashlight', phase: 'evening' },
  { id: 'patrol', at: [28, -6], look: [40, 2], anim: 'look', dur: 5, view: 'flashlight', phase: 'evening' },
  { id: 'patrol', at: [CATAPULT.x - 4, CATAPULT.z + 3], look: [CATAPULT.x, CATAPULT.z], anim: 'look', dur: 5, view: 'flashlight', phase: 'evening' },
  // night: up all night — carving, guarding the prize pumpkin, rounds, a doze on the porch, coffee
  { id: 'carve', at: [PORCH.x, PORCH.z + 1.4], look: [PORCH.x, PORCH.z], anim: 'fix', dur: 22, view: 'busy', phase: 'night' },
  { id: 'prize', at: [GIANT.x + 2.6, GIANT.z + 0.6], look: [GIANT.x, GIANT.z], anim: 'lean', dur: 18, view: 'normal', phase: 'night' },
  { id: 'patrol', at: [-24, -34], look: [-40, -44], anim: 'look', dur: 5, view: 'flashlight', phase: 'night' },
  { id: 'patrol', at: [-22, -86], look: [-34, -90], anim: 'look', dur: 5, view: 'flashlight', phase: 'night' },
  { id: 'doze', at: [6, -80.4], look: [6, -76], anim: 'nap', dur: 24, view: 'nap', phase: 'night' },
  { id: 'coffee', at: [17.5, -75.5], look: [14, -72], anim: 'coffee', dur: 14, view: 'busy', phase: 'night' },
  { id: 'patrol', at: [42, -79], look: [44, -94], anim: 'look', dur: 5, view: 'flashlight', phase: 'night' },
  { id: 'patrol', at: [24, -2], look: [40, 2], anim: 'look', dur: 5, view: 'flashlight', phase: 'night' },
  { id: 'patrol', at: [-16, -6], look: [-30, -2], anim: 'look', dur: 5, view: 'flashlight', phase: 'night' },
];

/** Pranks that work here: the shared ones whose places / things exist + the pumpkin farm's own (featured). */
const FEATURED: MissionId[] = ['lanternsOut', 'catapultBob', 'pigLaunch', 'giantPumpkin', 'pumpkinSmash'];
const MISSIONS: MissionId[] = [...FEATURED, 'knockBob', 'staggerBob', 'fartBob', 'mugPond', 'catBath', 'hensOut', 'wolfScare', 'pumpkinWell',
  'hayPond', 'loseBob', 'whackBob', 'henPond', 'eggBob', 'gnomePond', 'undiesWell', 'pieSteal', 'mudPorch', 'gateBreak', 'smashPots', 'mazeTrophy',
  'melonSmash'];

/** A perfect maze on a (2c+1)×(2r+1) grid (true = corn), carved depth-first. */
function maze(cols: number, rows: number, rng: Rng) {
  const w = cols, h = rows, wall: boolean[][] = Array.from({ length: h }, () => Array(w).fill(true));
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  const stack: [number, number][] = [[1, 1]]; wall[1][1] = false;
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const next = ([[2, 0], [-2, 0], [0, 2], [0, -2]] as [number, number][]).filter(([dx, dy]) => {
      const nx = x + dx, ny = y + dy; return nx > 0 && ny > 0 && nx < w - 1 && ny < h - 1 && wall[ny][nx];
    });
    if (!next.length) { stack.pop(); continue; }
    const [dx, dy] = next[rng.int(0, next.length - 1)];
    wall[y + dy / 2][x + dx / 2] = false; wall[y + dy][x + dx] = false;
    stack.push([x + dx, y + dy]);
  }
  // a few extra openings (loops: more than one way to run from Bob) + a clearing in the middle
  for (let i = 0; i < 9; i++) { const x = rng.int(1, (w - 3) / 2) * 2, y = rng.int(1, (h - 3) / 2) * 2 - 1; if (wall[y]?.[x] !== undefined) wall[y][x] = false; }
  for (let y = Math.floor(cy) - 1; y <= Math.ceil(cy) + 1; y++) for (let x = Math.floor(cx) - 1; x <= Math.ceil(cx) + 1; x++) wall[y][x] = false;
  wall[h - 1][1] = false;          // entrance: south-west corner
  wall[Math.floor(h * 0.7) | 1][w - 1] = false;   // exit: east side
  return wall;
}

export function buildFarm4(scene: THREE.Scene): FarmDef {
  const F = FARM4;
  const terrain = new Terrain(F);
  terrain.waterTint = 0x4a6b45;
  for (const b of BOG) terrain.river([[b.x, b.z]], b.r * 2, 0.75);
  terrain.river([[36, -56], [39, -62], [42, -68]], 3, 0.6);
  terrain.river([[42, -68], [49, -69.5], [56, -66], [68, -66]], 3, 0.6);
  terrain.river([[36, -56], [41, -51], [46, -46]], 2.6, 0.6);
  terrain.outside = { base: 1.2, amp: 6, freq: 0.02 };   // low, flat marshland all round
  // ---- ground paint (before terrain.build)
  const P = (pts: [number, number][], w = 3) => terrain.path(pts, w);
  P([[0, 22], [0, 2]], 4.5);                                        // road in from the south gate
  P([[0, 2], [2, -20], [3, -44], [1, -66], [0, -80]], 3.5);         // the main lane up to the farmhouse
  P([[0, 1], [20, 2], [36, 2]], 3.2);                               // yard → sty (flat: roll the giant pumpkin home)
  P([[-2, -2], [-20, -2]], 2.4);                                    // yard → chickens
  P([[2, -36], [-14, -38], [-34, -42], [-50, -42]], 2.4);           // through the pumpkin patch
  P([[-34, -24], [-34, -60]], 2);
  P([[1, -66], [-18, -74], [-23, -80]], 2.2);                       // lane → maze exit
  P([[3, -78], [24, -80], [42, -82]], 2.4);                         // porch → graveyard
  P([[4, -50], [CATAPULT.x - 2, CATAPULT.z + 1]], 2);                // lane → catapult
  terrain.dirt({ x0: -10, x1: 12, z0: -10, z1: 6 }, 3);             // yard
  terrain.dirt({ x0: 37, x1: 50, z0: -4, z1: 8 }, 1.5);             // sty floor
  terrain.dirt({ x0: -34, x1: -22, z0: -8, z1: 4 }, 2);             // chicken pen
  terrain.dirt(PATCH, 2);                                          // the pumpkin patch (soil)
  terrain.dirt({ x0: MAZE.x0 - 1, x1: MAZE.x0 + MAZE.cols * MAZE.cell + 1, z0: MAZE.z0 - 1, z1: MAZE.z0 + MAZE.rows * MAZE.cell + 1 }, 1);
  terrain.dirt({ x0: 14, x1: 26, z0: -102, z1: -92 }, 1);           // garden soil
  terrain.dirt({ x0: CATAPULT.x - 3, x1: CATAPULT.x + 3, z0: CATAPULT.z - 4, z1: CATAPULT.z + 4 }, 1.5);
  terrain.mud(45, 4.5, 3, 2.2);                                     // the sty wallow
  terrain.mud(-6, -54, 2.2, 1.6); terrain.mud(24, -40, 2, 1.5); terrain.mud(-44, -16, 2.4, 1.8); terrain.mud(30, -66, 2.2, 1.6);
  const POND = { x: -48, z: -8, r: 6 };

  // Bob's walk-in farmhouse (s26; was a closed village house): the ground under it is flattened first
  const HOUSE = { x: 0, z: -91.5, yaw: 0, style: 'spooky' as const };
  terrain.pad(HOUSE.x, HOUSE.z, HOUSE.yaw, 14, 17, 3);

  const build = (t: Terrain, daynight: DayNight): FarmBuild => {
    const garden = { x0: 14, x1: 26, z0: -102, z1: -92 };
    const out: FarmBuild = {
      props: [], critters: [], decor: [], spinners: [], updaters: [], statics: [], pigSpawns: [],
      cage: new Cage(scene, V3(14, t.height(14, -78), -78), 0), chores: CHORES,
      farmerSpawn: V3(4, t.height(4, -74), -74),
      zones: { garden: [garden], lawn: { x0: 20, x1: 28, z0: -34, z1: -30 }, door: V3(0, t.height(0, -82), -82), mowerAt: V3(26, t.height(26, -26), -26),
        roadGate: V3(0, t.height(0, 12.5), 12.5) },
      inWater: (x, z) => Math.hypot(x - POND.x, z - POND.z) < POND.r - 0.3,
      gates: [],
      places: {
        pond: POND, well: { x: -6, z: -62 },
        coop: { x0: -34, x1: -22, z0: -8, z1: 4 }, sheepPen: null, pasture: null,
        stash: V3(41.5, t.height(41.5, 1), 1), roadGate: V3(0, t.height(0, 12.5), 12.5), dogPatrol: { x: 0, z: -44, r: 46 },
        tp: [['sty', 40, 1], ['cage', 14, -75], ['house', 0, -78], ['patch', -30, -36], ['giant', GIANT.x + 3, GIANT.z + 2], ['catapult', CATAPULT.x - 3, CATAPULT.z + 4],
          ['maze', -56, -68], ['graves', 42, -80], ['bog', 30, -62], ['pond', -40, -10], ['garden', 12, -96]],
      },
      missions: MISSIONS,
      featured: FEATURED,
      clock: { start: 19.5, secsPerHour: 62 }, darkNight: 0.5,
      wolfHours: [0, 4],
      noMods: ['market'],
    };
    t.noGrass({ x0: 9, x1: 19, z0: -81, z1: -75 });
    const kit = farmKit(scene, t, out, F, 4047);
    const { rng, blocked, y, building, decor, pen, prop, critter, spinner, forest } = kit;
    const pumpkins = new Pumpkins(scene, daynight, y);
    out.pumpkins = pumpkins;

    // ---------------------------------------------------------------- buildings
    kit.farmhouse(HOUSE, daynight);                                       // Bob's walk-in farmhouse (s26)
    building('farm/BigBarn', 22, -14, 8.5, -Math.PI / 2);
    building('farm/Silo', 31, -26, 11);
    building('farm/ChickenCoop', -31, -3, 3.4, Math.PI / 2);
    building('farm/Well', -6, -62, 3.2);
    building('farm/OpenBarn', -10, 10, 5.5, Math.PI);                     // hay shed by the gate
    building('farm/ChickenCoop', 47.5, 5.4, 2.8, Math.PI);                // the pigs' hut
    spinner(building('farm/Windmill', 52, -54, 12, -Math.PI / 2), 'Windmill_Blades', 0.5);
    blocked.push({ x0: 8, x1: 21, z0: -84, z1: -70 });                    // cage + grill + coffee spot
    blocked.push({ x0: -6, x1: 6, z0: -80, z1: 6 });                      // the main lane

    // ---------------------------------------------------------------- pens & fences
    pen({ x0: 37, x1: 50, z0: -4, z1: 8 }, 'w', 2.6, undefined, 'sty', { lockable: false, start: 'free' });
    pen({ x0: -34, x1: -22, z0: -8, z1: 4 }, 'e', 2.4, undefined, 'chickens');
    pen(garden, 'w', 2.4, undefined, 'garden');
    pen(GRAVES, 's', 2.6, 'halloween/fence');                             // the old family plot (iron railings)
    kit.outerFence();

    // ---------------------------------------------------------------- the bog: a boardwalk over it, stepping stones, dead trees
    kit.water.walkway([[25.6, -61], [32.4, -61.4], [38, -63.2], [42.4, -66.6], [46.4, -72.4], [51.6, -74.6]], { w: 1.7 });
    kit.water.steppingStones([38.6, -48.6], [43.6, -53.6], 4);
    for (const [m, x, z, h] of [['tree_dead_large', 31, -51, 6.5], ['tree_dead_medium', 48.6, -63, 4.6], ['tree_dead_small', 38, -73.6, 3.4],
      ['tree_dead_medium', 52, -46.5, 4.4], ['tree_dead_large', 44.6, -58.4, 6]] as const) decor('halloween/' + m, x, z, { height: h, yaw: rng.range(0, 6.28), collide: 'trunk' });
    blocked.push({ x0: 28, x1: 58, z0: -76, z1: -42 });
    swamp(scene, t, out, { x0: 30, x1: 54, z0: -72, z1: -44 }, BOG, V3(31, y(31, -51) + 5, -51));

    // ---------------------------------------------------------------- the porch: Bob's carving table, pumpkins, lanterns
    const d = decorKit({ scene, t, rng, out, daynight, blocked, decor, prop, POND, F });
    decor('village/Bench_2', PORCH.x, PORCH.z, { height: 0.9, yaw: 0, collide: 'box' });
    decor('kaykit/pumpkin_orange', PORCH.x + 0.5, PORCH.z, { height: 0.42, yaw: 0.4, sink: -0.88 });
    decor('kaykit/pumpkin_orange_small', PORCH.x - 0.55, PORCH.z + 0.1, { height: 0.3, yaw: 1.2, sink: -0.88 });
    d.rocker(6, -80.4, 6, -76);
    d.laundry(-18, -9, -76);
    d.mailbox(5.2, 14.2);
    d.picnic(20, -66, 0.3);
    d.lamps([[-3.6, -81.5], [4, 9], [-4, 14.5], [16.5, -10.5], [35, -5]]);
    pumpkins.fixedLit.push({ x: -3.6, z: -81.5, r: 3.4 }, { x: 4, z: 9, r: 3.2 }, { x: -4, z: 14.5, r: 3.2 }, { x: 16.5, z: -10.5, r: 3.2 }, { x: 35, z: -5, r: 3 });
    d.pond(POND);
    d.outhouse(40, -40, -Math.PI / 2);
    d.phone(-6.0, -80.6, 0, -8.8, -77.6);
    d.payphone(-5.0, 8.4, Math.PI / 2);
    d.trough(34, 6, Math.PI / 2);
    d.scarecrow(-42, -30, 0.6); d.scarecrow(-24, -54, -0.4);
    d.finish();
    decor('nature/Willow_1', -54, -18, { height: 8, collide: 'trunk' });
    decor('kenney/tractor', 8, -4, { height: 2.6, yaw: 2.4, collide: 'box' });
    decor('kit/Prop_Wagon', -7, 0, { height: 1.8, yaw: 0.3, collide: 'box' });   // the hay-ride wagon
    decor('village/Cart', 11, -60, { height: 2.2, yaw: 1.1, collide: 'box' });   // pumpkin cart by the lane
    for (const [x, z] of [[10.8, -59.6], [11.4, -60.4]] as const) decor('kaykit/pumpkin_orange', x, z, { height: 0.45, yaw: rng.range(0, 6), sink: -1.0 });

    // ---------------------------------------------------------------- the pumpkin patch: vines, pumpkins, the giant prize pumpkin
    t.noGrass(PATCH);
    for (let z = PATCH.z0 + 1.5; z < PATCH.z1 - 1; z += 2.6) for (let x = PATCH.x0 + 1.2; x < PATCH.x1 - 1; x += 1.9) {
      if (Math.abs(x + 34) < 1.6 || Math.abs(z + 41) < 2 || Math.hypot(x - GIANT.x, z - GIANT.z) < 4) continue;   // paths + the giant
      decor('crops/Pumpkin_4', x + rng.range(-0.3, 0.3), z + rng.range(-0.3, 0.3), { scale: rng.range(1.1, 1.4), yaw: rng.range(0, 6.28) });
    }
    blocked.push(PATCH);
    for (let i = 0, n = 0; i < 200 && n < 18; i++) {
      const x = rng.range(PATCH.x0 + 2, PATCH.x1 - 2), z = rng.range(PATCH.z0 + 2, PATCH.z1 - 2);
      if (Math.abs(x + 34) < 1.6 || Math.abs(z + 41) < 2 || Math.hypot(x - GIANT.x, z - GIANT.z) < 4) continue;
      prop(rng.next() < 0.65 ? 'patchPumpkin' : 'patchPumpkinY', x, z); n++;
    }
    prop('giantPumpkin', GIANT.x, GIANT.z, 0.3);
    decor('kenney/sign', GIANT.x + 1.8, GIANT.z + 1.6, { height: 1.1, yaw: -0.4 });   // "1st prize"
    prop('pumpkin', -18, -24); prop('pumpkin', -48, -58); prop('bigPumpkin', -44, -26);

    // ---------------------------------------------------------------- the catapult (aimed at the porch) + a pile of ammo
    const yawToPorch = Math.atan2(PORCH.x - CATAPULT.x, PORCH.z - CATAPULT.z);
    pumpkins.buildCatapult(CATAPULT.x, CATAPULT.z, yawToPorch);
    blocked.push({ x0: CATAPULT.x - 4, x1: CATAPULT.x + 4, z0: CATAPULT.z - 5, z1: CATAPULT.z + 5 });
    for (const [x, z] of [[18.4, -47.5], [18.9, -46.6], [18.2, -46.2], [19, -48.3]] as const) prop('patchPumpkin', x, z);

    // ---------------------------------------------------------------- the corn maze (soft cover walls) + the trophy in the middle
    const grid = maze(MAZE.cols, MAZE.rows, rng), c = MAZE.cell;
    for (let r = 0; r < MAZE.rows; r++) for (let k = 0; k < MAZE.cols; k++) {
      if (!grid[r][k]) continue;
      const x0 = MAZE.x0 + k * c, z0 = MAZE.z0 + r * c;
      for (const [ox, oz] of [[0.4, 0.4], [1.2, 1.15]] as const)
        decor('kenney/crops_cornStageD', x0 + ox + rng.range(-0.15, 0.15), z0 + oz + rng.range(-0.15, 0.15), { scale: 2.6, yaw: rng.range(0, 6) });
      G.cover.rect('crop', x0, x0 + c, z0, z0 + c, y(x0 + c / 2, z0 + c / 2) - 0.3, 2.6);
    }
    const mz: Rect = { x0: MAZE.x0, x1: MAZE.x0 + MAZE.cols * c, z0: MAZE.z0, z1: MAZE.z0 + MAZE.rows * c };
    t.noGrass({ x0: mz.x0 - 0.5, x1: mz.x1 + 0.5, z0: mz.z0 - 0.5, z1: mz.z1 + 0.5 });
    blocked.push({ x0: mz.x0 - 2, x1: mz.x1 + 2, z0: mz.z0 - 2, z1: mz.z1 + 2 });
    const mcx = MAZE.x0 + ((MAZE.cols - 1) / 2 + 0.5) * c, mcz = MAZE.z0 + ((MAZE.rows - 1) / 2 + 0.5) * c;
    decor('kenney/stump_round', mcx, mcz, { height: 0.5, collide: 'box' });
    prop('trophy', mcx, mcz, 0, 0.5);

    // ---------------------------------------------------------------- the old family plot: graves, a crypt, dead trees, candles
    decor('halloween/arch_gate', 42, GRAVES.z1, { height: 3.2, yaw: 0 });
    decor('halloween/crypt', 46, -97.5, { height: 3.6, yaw: 0, collide: 'box' });
    t.noGrass({ x0: 42, x1: 50, z0: -101, z1: -94 });
    const stones = ['halloween/gravestone', 'halloween/grave_A', 'halloween/grave_B', 'halloween/gravemarker_A', 'halloween/gravemarker_B'];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) {
      const x = 33 + k * 2.6 + rng.range(-0.3, 0.3), z = -99 + r * 4 + rng.range(-0.3, 0.3);
      if (x > 40 && z < -95) continue;
      decor(rng.pick(stones), x, z, { height: rng.range(0.9, 1.25), yaw: rng.range(-0.25, 0.25), collide: 'box' });
    }
    decor('halloween/tree_dead_large', 52, -88, { height: 6, collide: 'trunk' });
    decor('halloween/tree_dead_medium', 32, -86.5, { height: 4.5, collide: 'trunk' });
    for (const [x, z] of [[34, -94.6], [38.6, -98.6], [44.5, -93]] as const) decor('halloween/candle_triple', x, z, { height: 0.4 });
    decor('halloween/skull_candle', 46, -94.8, { height: 0.35 });
    decor('halloween/bench_decorated', 50.5, -92, { height: 1, yaw: -Math.PI / 2, collide: 'box' });

    // ---------------------------------------------------------------- garden (Bob's melons + veg; turkeys guard it)
    for (let i = 0; i < 3; i++) {
      const z = -100 + i * 2.6;
      for (let x = 15; x < 25; x += 2) {
        decor('kenney/crops_dirtRow', x + 1, z, { scale: 2, yaw: Math.PI / 2 });
        const [crop, sc, sink] = ([['crops/Carrot_4', 1.5, 0.9], ['crops/Watermelon_4', 1.15, 0.22], ['crops/Lettuce_4', 1.2, 0.04]] as const)[i];
        decor(crop, x + 1 + rng.range(-0.15, 0.15), z, { scale: sc, sink, yaw: rng.range(0, 6.28) });
      }
    }

    // ---------------------------------------------------------------- jack-o'-lanterns (the lights Bob sees you in)
    const JACK = 'kaykit/pumpkin_orange_jackolantern', JH = 0.55;
    const jack = (x: number, z: number, face: [number, number], lift = 0) => {
      const yaw = Math.atan2(face[0] - x, face[1] - z);
      decor(JACK, x, z, { height: JH, yaw, sink: -lift });
      pumpkins.addLantern(x, z, yaw, JH, lift);
    };
    jack(-2.6, 11, [0, 6]); jack(2.6, 11, [0, 6]);                                   // the road gate
    jack(4.6, -22, [0, -22]); jack(-2.6, -50, [0, -50]); jack(3.6, -68, [0, -68]);   // along the lane
    jack(-2.4, -83.2, [0, -78], 0.3); jack(2.4, -83.2, [0, -78], 0.3);               // porch steps
    jack(PORCH.x - 0.1, PORCH.z - 0.15, [PORCH.x, PORCH.z + 3], 0.88);                // on the carving table
    jack(GIANT.x - 2.6, GIANT.z + 1.4, [GIANT.x, GIANT.z + 6]); jack(GIANT.x + 2.4, GIANT.z - 1.8, [GIANT.x + 4, GIANT.z + 4]);   // guard the prize
    jack(-34, -23.2, [-34, -18]); jack(-50.6, -36, [-46, -36]); jack(-40, -60.8, [-40, -56]); jack(-20, -60.6, [-20, -56]); jack(-36.2, -43.2, [-30, -43]);
    jack(MAZE.x0 + 1.5, mz.z1 + 1.6, [MAZE.x0 + 1.5, mz.z1 + 6]); jack(mz.x1 + 1.4, MAZE.z0 + ((Math.floor(MAZE.rows * 0.7) | 1) + 0.5) * c, [mz.x1 + 6, -82]);
    jack(39.6, GRAVES.z1 + 1.2, [42, -80]); jack(44.4, GRAVES.z1 + 1.2, [42, -80]);   // the graveyard arch
    jack(CATAPULT.x - 3.2, CATAPULT.z - 1, [CATAPULT.x - 6, CATAPULT.z + 2]);
    jack(-19, -1, [-14, -2]); jack(14.6, -9, [10, -8]); jack(23.4, -63.6, [21, -60]);
    pumpkins.finishLanterns(JACK, JH);

    // ---------------------------------------------------------------- hiding spots
    const ck = coverKit({ scene, t, rng, out, blocked, forest, decor });
    for (const [x, z] of [[-56, 10], [-53, 12.4], [48, -78], [50, -80.4], [10, -101.5], [56, -2], [57, 1], [-10, -30], [-12.4, -32], [24, -54],
      [26, -56.4], [-56, -40], [-57, -43], [8, -26], [30, -44], [-2, -98], [-14, -84], [54, -76]] as [number, number][]) ck.bush(x, z);
    ck.baleStack(-8, -14, 0.2);
    ck.baleStack(26, -60, 1.1, 2);
    ck.baleStack(-14, -66, 0.4, 2);
    ck.baleStack(32, -2, 1.57);
    ck.hard('cover/Logs', 46, 12, 1.2, 0.2);
    ck.hard('cover/Crate_Big_Stack2', 28, -20, 1.8, 0.3);
    ck.hard('cover/Bags', -18, -18, 0.95, 1);
    ck.hard('cover/WoodLog', 26, -50, 0.9, 0.6);
    ck.hard('cover/Crate_Stack2', 10, 3, 1.5, -0.3);
    ck.hard('cover/MarketStand_2', 8, 12, 2.6, Math.PI);                    // pumpkin stand by the gate
    ck.hard('cover/Hay', -16, -48, 1.2, 0.4);

    // ---------------------------------------------------------------- loose props
    for (const [x, z] of [[-6, 4.5], [-4.8, 5.6], [24, -4]] as const) prop('crate', x, z);
    for (const [x, z] of [[27.6, -6.2], [27.8, -10.4], [-38, -6]] as const) prop('barrel', x, z, 0);
    for (const [x, z] of [[-6, -6], [-7.6, -5], [-9, -6.4], [25, -58], [-40, -20], [-24, -66]] as const) prop('hay', x, z);
    prop('pan', 10, -74); prop('shovel', 16, -93, 1.2); prop('sword', 50, -90); prop('axe', 26.6, -8, 0.3);
    // valuables: the porch, the picnic table, the barn, the crypt, the maze
    prop('chest', -7.8, -82.4, 0.2); prop('chalice', 1.6, -82.4); prop('necklace', 3.6, -82.6);
    prop('safe', 6.0, -81.8, 0);   // heavy loot: two pigs drag it (or one full of spinach)
    prop('tv', 5.2, -76.6, 2.9);
    prop('clock', -2.8, -82.8, 0);
    prop('phone', 19.7, -66.2, 0.3, 0.84); prop('radio', 20.6, -65.6, 0.3, 0.84);
    prop('gold', 46, -95.2, 0.4); prop('crown', 33.5, -101, 0.6);
    prop('gasCan', 10, -2); prop('propane', 16.6, -76.6, 0); prop('firstAid', 24, -18); prop('backpack', 25, -16.6);
    prop('ham', 2.4, -83, 0, 0); prop('mug', 17, -73.8); prop('candyJar', -3.6, -82.8, 0.3);
    prop('veggieCrate', 13, -92); prop('tomatoCrate', 13, -93.4); prop('trashcan', 6.6, -76.6, 0);
    prop('bone', 6, -73); prop('bone', -18, 4); prop('bone', 30, -36); prop('bone', -30, -70);
    // pranks: the pie on the picnic table, undies under the laundry line, a gnome in the garden, eggs by the coop,
    // flower pots on the porch, melons in the garden
    prop('pie', 20.3, -66.3, 0, 0.84);
    prop('undies', -12.4, -77.6, 0.4);
    prop('gnome', 23, -95, 2.2);
    for (const [x, z] of [[-23.2, -6.6], [-23.5, -6.8], [-23.3, -7.0], [-32.4, 2], [-32.1, 2.2]] as const) prop('egg', x, z, rng.range(0, 6));
    for (const [x, z] of [[-1, -82.6], [1, -82.6], [-5, -82.2], [5, -82.4]] as const) prop('flowerPot', x, z, 0);
    for (const [x, z] of [[17.4, -97.4], [20.6, -97.6], [23, -97.2]] as const) prop('melon', x, z);

    // ---------------------------------------------------------------- animals
    const coop = V3(-31, y(-31, -3), -3);
    for (let i = 0; i < 6; i++) critter('hen', rng.range(-32, -24), rng.range(-6, 2), 4);
    for (let i = 0; i < 3; i++) critter('chick', rng.range(-31, -25), rng.range(-5, 1), 3);
    critter('rooster', -24, -6, 5);
    for (const cr of out.critters) cr.roost = coop;
    critter('dog', 6, -74, 5);
    for (const [x, z] of [[18, -96], [21, -98], [16, -94]] as const) critter('turkey', x, z, 4);
    critter('cat', -8, -78, 5); critter('cat', 40, -90, 6);
    critter('bunny', -20, -30, 6); critter('bunny', 20, -40, 6);
    for (let i = 0; i < 3; i++) critter('duck', POND.x + rng.range(-3, 3), POND.z + rng.range(-3, 3), 3.5);

    // ---------------------------------------------------------------- pigs start in the sty
    out.pigSpawns.push(V3(45, y(45, 0.5) + 0.5, 0.5), V3(40, y(40, 0.5) + 0.5, 0.5), V3(45.4, y(45.4, -2.5) + 0.5, -2.5), V3(41.4, y(41.4, 6.5) + 0.5, 6.5));

    // ---------------------------------------------------------------- autumn trees (orange / yellow pines, dead trees)
    for (const [m, x, z, h] of [['tree_pine_orange_large', -56, 4, 8], ['tree_pine_yellow_large', -44, -66, 7.5], ['tree_pine_orange_medium', 30, -50, 6],
      ['tree_pine_yellow_medium', 56, -30, 6.5], ['tree_pine_orange_large', 56, -100, 8], ['tree_pine_yellow_large', -14, -100, 7], ['tree_dead_large', -20, -14, 6],
      ['tree_dead_medium', 26, -88, 4.5], ['tree_pine_orange_medium', 10, -36, 5.5], ['tree_dead_small', -50, -66, 3.5], ['tree_pine_yellow_medium', 54, 12, 6],
      ['tree_pine_orange_medium', -30, 12, 6]] as [string, number, number, number][]) {
      decor('halloween/' + m, x, z, { height: h, yaw: rng.range(0, 6.28), collide: 'trunk' });
      blocked.push({ x0: x - 2.5, x1: x + 2.5, z0: z - 2.5, z1: z + 2.5 });
    }

    // ---------------------------------------------------------------- nature
    kit.hedgeRing();
    kit.surroundings(['pine', 'pine', 'oak', 'poplar']);
    kit.scatter({ trees: 5, bushes: 26, small: [['nature/Mushroom_Common', 22, 0.2, 0.3], ['kenney/rock_largeA', 6, 0.7, 1.2], ['kenney/rock_smallA', 12, 0.3, 0.5],
      ['kaykit/pumpkin_orange_small', 14, 0.25, 0.4]] });
    return kit.finish();
  };
  return { bounds: FARM4, terrain, build };
}
