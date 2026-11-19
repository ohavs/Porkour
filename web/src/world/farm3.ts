import * as THREE from 'three';
import { V3 } from '../core/util';
import { Terrain, type Rect } from './terrain';
import { Cage } from './cage';
import type { Chore } from '../farmer/farmer';
import type { DayNight } from './daynight';
import { decorKit } from './decor';
import { coverKit } from './hideouts';
import { farmKit, type FarmBuild, type FarmDef } from './farmKit';
import { DecorAnimal } from './animals';
import { Dairy } from './dairy';
import { G } from '../game/ctx';
import type { MissionId } from '../game/round';

/** Models only farm 3 uses (preloaded when farm 3 is played). Quaternius Medieval Village + Nature (CC0). */
export const FARM3_MODELS = [
  ...['House_1', 'House_2', 'Blacksmith', 'Bench_1', 'Bench_2', 'Cart', 'Cauldron'].map((n) => 'village/' + n),
  ...['Willow_1', 'Willow_2', 'TreeStump', 'Grass_Wispy_Tall', 'Grass_Common_Tall'].map((n) => 'nature/' + n),
];

/**
 * Farm 3 — Bob's dairy & cheese farm. North = −z, the road gate is in the south (x = 0) like on the other farms.
 * Layout: sty (start, south-west) · the yard + the dairy barn + milk churns (south-centre) · silo · cow pasture
 * (east: tip the cows!) · the bull's paddock (north-east, a sturdy fence and a gate he can burst) · cheese hill
 * (north-west: a flat top where the cheese wheels dry in the sun + the prize cheese; push a wheel off the edge and it
 * rolls down the slope) · cheese house + creamery (south of the hill) · farmhouse (north, cage + BBQ by the porch) ·
 * garden behind the house · duck pond + windmill (west) · chicken pen · sheep pen (north-west corner).
 */
export const FARM3: Rect = { x0: -60, x1: 60, z0: -104, z1: 16 };
/** The bull's paddock. */
const BULL_PEN: Rect = { x0: 28, x1: 56, z0: -98, z1: -68 };
const HILL = { x: -30, z: -62, r: 22, h: 6.5, flat: 5.5 };

const CHORES: Chore[] = [
  { id: 'pigs', at: [-35.4, 2], look: [-38, 2], anim: 'pour', dur: 12, view: 'busy' },
  { id: 'milk', at: [6.6, -15.2], look: [8.4, -15.2], anim: 'fix', dur: 20, view: 'busy' },
  { id: 'chickens', at: [-8, -17.6], look: [-8, -22], anim: 'feed', dur: 16, view: 'busy' },
  { id: 'mow', at: [0, 0], look: [0, 0], anim: 'ride', dur: 50, view: 'busy' },
  { id: 'cheese', at: [-27.6, -60.2], look: [-30, -63], anim: 'fix', dur: 18, view: 'busy' },
  { id: 'bull', at: [25.8, -76], look: [30, -76], anim: 'pour', dur: 14, view: 'normal' },
  { id: 'cows', at: [21.6, -30], look: [28, -30], anim: 'lean', dur: 14, view: 'normal' },
  { id: 'nap', at: [-24, -3.4], look: [-24, -8], anim: 'nap', dur: 26, view: 'nap' },
  { id: 'garden', at: [-9.4, -95], look: [-14, -95], anim: 'water', dur: 18, view: 'busy' },
  { id: 'creamery', at: [-35, -29.4], look: [-35, -33], anim: 'pour', dur: 16, view: 'busy' },
  { id: 'paper', at: [-9.6, -80.6], look: [-7, -72], anim: 'read', dur: 30, view: 'paper' },
  { id: 'laundry', at: [-12, -76.6], look: [-12, -78], anim: 'laundry', dur: 14, view: 'busy' },
  { id: 'milk', at: [6.6, -15.2], look: [8.4, -15.2], anim: 'fix', dur: 16, view: 'busy' },
  { id: 'coffee', at: [14.5, -75.5], look: [11, -70], anim: 'coffee', dur: 16, view: 'busy' },
  { id: 'wood', at: [43.5, 7.4], look: [43.5, 6], anim: 'chop', dur: 16, view: 'busy' },
  // evening: flashlight round
  { id: 'patrol', at: [-34, 2], look: [-42, 4], anim: 'look', dur: 5, view: 'flashlight', phase: 'evening' },
  { id: 'patrol', at: [20, -28], look: [34, -36], anim: 'look', dur: 5, view: 'flashlight', phase: 'evening' },
  { id: 'patrol', at: [24, -70], look: [36, -82], anim: 'look', dur: 5, view: 'flashlight', phase: 'evening' },
  { id: 'patrol', at: [-12, -52], look: [-26, -60], anim: 'look', dur: 5, view: 'flashlight', phase: 'evening' },
  { id: 'patrol', at: [-24, -24], look: [-34, -34], anim: 'look', dur: 5, view: 'flashlight', phase: 'evening' },
  // night
  { id: 'bed', at: [-2, -81.6], look: [-2, -88], anim: 'idle', dur: 1, view: 'normal', phase: 'night' },
];

/** Pranks that work here: the shared ones whose places / things exist + the dairy's own (featured). */
const FEATURED: MissionId[] = ['bullBob', 'bullOut', 'cowTip', 'cheeseBob', 'prizeCheese', 'spillMilk', 'milkSlip'];
const MISSIONS: MissionId[] = [...FEATURED, 'knockBob', 'staggerBob', 'fartBob', 'mugPond', 'catBath', 'lambStash', 'hensOut', 'wolfScare',
  'pumpkinWell', 'sheepOut', 'hayPond', 'loseBob', 'whackBob', 'henPond', 'smashPots', 'melonSmash', 'eggBob', 'gnomePond', 'undiesWell',
  'pieSteal', 'mudPorch', 'cowsOut', 'gateBreak'];

export function buildFarm3(scene: THREE.Scene): FarmDef {
  const F = FARM3;
  const terrain = new Terrain(F);
  terrain.hill(HILL.x, HILL.z, HILL.r, HILL.h, HILL.flat);
  // ---- ground paint (before terrain.build)
  const P = (pts: [number, number][], w = 3) => terrain.path(pts, w);
  P([[0, 22], [0, 2]], 4.5);                                        // road in from the south gate
  P([[0, 2], [2, -20], [4, -40], [2, -62], [-2, -80]], 3.5);        // the main lane up to the farmhouse
  P([[-2, -4], [-20, -2], [-34, 2]], 2.6);                          // yard → sty
  P([[2, -8], [8, -12], [12, -12]], 3);                             // yard → dairy barn
  P([[-2, -24], [-20, -28], [-34, -28]], 2.4);                      // lane → cheese house / creamery
  P([[3, -36], [20, -36], [24, -36]], 2.4);                         // lane → pasture gate
  P([[2, -60], [16, -66], [26, -80]], 2.2);                         // lane → bull paddock
  P([[-14, -40], [-22, -50], [-26, -58]], 2);                       // the track up cheese hill
  P([[-4, -86], [-9, -95]], 2.2);                                   // house → garden
  terrain.dirt({ x0: -10, x1: 12, z0: -12, z1: 6 }, 3);             // yard
  terrain.dirt({ x0: -50, x1: -37, z0: -4, z1: 8 }, 1.5);           // sty floor
  terrain.dirt({ x0: -14, x1: -2, z0: -30, z1: -20 }, 2);           // chicken pen
  terrain.dirt({ x0: -20, x1: -10, z0: -100, z1: -90 }, 1);         // garden soil
  terrain.dirt({ x0: -40, x1: -18, z0: -32, z1: -24 }, 2);          // cheese yard
  terrain.dirt({ x0: 4, x1: 12, z0: -18, z1: -12 }, 1.5);           // milking stand
  terrain.dirt({ x0: 30, x1: 54, z0: -96, z1: -70 }, 0.6);          // the bull's trampled paddock
  terrain.dirt({ x0: HILL.x - 4.5, x1: HILL.x + 4.5, z0: HILL.z - 4.5, z1: HILL.z + 4.5 }, 2);   // hilltop
  terrain.mud(-45, 4.5, 3, 2.2);                                    // the sty wallow
  terrain.mud(18, -42, 2.2, 1.6); terrain.mud(-6, -60, 2, 1.5); terrain.mud(48, -12, 2.4, 1.8);
  terrain.mud(40, -60, 2.2, 1.6); terrain.mud(-50, -62, 1.8, 1.5); terrain.mud(36, -36, 2.5, 2);
  const POND = { x: -47, z: -22, r: 6 };

  const build = (t: Terrain, daynight: DayNight): FarmBuild => {
    const garden = { x0: -20, x1: -10, z0: -100, z1: -90 };
    const pasture = { x0: 24, x1: 56, z0: -54, z1: -20 };
    const out: FarmBuild = {
      props: [], critters: [], decor: [], spinners: [], updaters: [], statics: [], pigSpawns: [],
      cage: new Cage(scene, V3(12, t.height(12, -79), -79), 0), chores: CHORES,
      farmerSpawn: V3(6, t.height(6, -74), -74),
      zones: { garden: [garden], lawn: { x0: -2, x1: 14, z0: -72, z1: -58 }, door: V3(-2, t.height(-2, -81.6), -81.6), mowerAt: V3(18, t.height(18, -62), -62),
        roadGate: V3(0, t.height(0, 12.5), 12.5) },
      inWater: (x, z) => Math.hypot(x - POND.x, z - POND.z) < POND.r - 0.3,
      gates: [],
      places: {
        pond: POND, well: { x: 6, z: -40 },
        coop: { x0: -14, x1: -2, z0: -30, z1: -20 }, sheepPen: { x0: -58, x1: -46, z0: -100, z1: -88 }, pasture,
        stash: V3(-40.5, t.height(-40.5, 1), 1), roadGate: V3(0, t.height(0, 12.5), 12.5), dogPatrol: { x: 0, z: -44, r: 46 },
        tp: [['sty', -42, 1], ['cage', 12, -76], ['house', -2, -80], ['dairy', 6, -12], ['pasture', 21, -34], ['bull', 25, -84],
          ['hill', HILL.x, HILL.z + 3], ['cheese', -22, -27], ['pond', -40, -18], ['garden', -8, -94], ['mill', -52, -40]],
      },
      missions: MISSIONS,
      featured: FEATURED,
    };
    t.noGrass({ x0: 7, x1: 17, z0: -82, z1: -76 });
    const kit = farmKit(scene, t, out, F, 3031);
    const { rng, blocked, y, building, decor, pen, prop, critter, spinner, forest } = kit;

    // ---------------------------------------------------------------- buildings
    building('village/House_2', -2, -88, 9.5, 0);                         // the farmhouse
    building('farm/BigBarn', 17, -9, 8.5, -Math.PI / 2);                  // the dairy barn (milking)
    building('farm/Silo_House', 28, 2, 10, Math.PI / 2);
    building('village/House_1', -22, -36, 7.5, 0);                       // the cheese house
    building('village/Blacksmith', -36, -37, 6.2, 0);                     // the creamery (cheese vat)
    spinner(building('farm/TowerWindmill', -52, -48, 12, Math.PI / 2), 'TowerWindmill_Blades', 0.8);
    building('farm/ChickenCoop', -11, -27, 3.4, Math.PI / 2);
    building('farm/Well', 6, -40, 3.2);
    building('farm/OpenBarn', -24, -8, 6, 0);                             // hay shed
    building('farm/WaterTower', 52, 8, 11);
    building('farm/ChickenCoop', -47.5, 5.4, 2.8, Math.PI);               // the pigs' hut
    building('farm/OpenBarn', 50, -44, 5, -Math.PI / 2);                  // the cows' shelter (in the pasture)
    blocked.push({ x0: 6, x1: 19, z0: -84, z1: -70 });                    // cage + grill + Bob's coffee spot
    blocked.push({ x0: -3, x1: 15, z0: -73, z1: -57 }, { x0: -6, x1: 6, z0: -80, z1: 6 });   // the lawn (mowing) + the main lane

    // ---------------------------------------------------------------- pens & fences
    pen({ x0: -50, x1: -37, z0: -4, z1: 8 }, 'e', 2.6, undefined, 'sty', { lockable: false, start: 'free' });
    pen({ x0: -14, x1: -2, z0: -30, z1: -20 }, 's', 2.4, undefined, 'chickens');
    pen(pasture, 'w', 3.5, 'kenney/fence_planks', 'pasture');
    pen(BULL_PEN, 'w', 3.2, undefined, 'bull');                         // rails: the bull sees a red rag through them
    pen(garden, 'e', 2.4, undefined, 'garden');
    pen({ x0: -58, x1: -46, z0: -100, z1: -88 }, 'e', 2.6, 'kenney/fence_planks', 'sheep');
    kit.outerFence();

    // ---------------------------------------------------------------- the dairy: milking stand, churns, the creamery
    const d = decorKit({ scene, t, rng, out, daynight, blocked, decor, prop, POND, F });
    out.decor.push(new DecorAnimal(scene, 'cow', V3(8.6, y(8.6, -15.2), -15.2), Math.PI / 2, 1));   // the cow being milked
    decor('kenney/stump_round', 7.4, -15.6, { height: 0.42 });                                       // milking stool
    for (const [x, z] of [[10.4, -11.2], [11.1, -11.6], [10.6, -12.2], [11.4, -12.6]] as const) prop('milkChurn', x, z, rng.range(0, 6));
    decor('village/Cart', 5.4, 8.6, { height: 2.2, yaw: -0.4, collide: 'box' });                     // the milk cart by the gate
    for (const [x, z] of [[4.4, 5.6], [5.2, 5.2]] as const) prop('milkChurn', x, z, rng.range(0, 6));
    for (const [x, z] of [[-33.6, -31.4], [-32.8, -30.8]] as const) prop('milkChurn', x, z, rng.range(0, 6));
    decor('village/Cauldron', -35.5, -32.2, { height: 1.1, collide: 'box' });                       // the cheese vat
    decor('village/Bench_2', -22, -30.6, { height: 0.9, yaw: 0, collide: 'box' });                   // cheese table
    prop('cheese', -23, -30.5, 0, 0.9); prop('cheese', -21.2, -30.7, 0.3, 0.9);
    prop('cheeseWheel', -18.2, -31.2, Math.PI / 2); prop('cheeseWheel', -17.4, -30, Math.PI / 2 + 0.3);

    // ---------------------------------------------------------------- cheese hill: wheels drying on top + the prize cheese
    const hy = y(HILL.x, HILL.z);
    decor('village/Bench_1', HILL.x - 1.8, HILL.z - 2.6, { height: 1, yaw: 0.3, collide: 'box' });
    // a row of wheels along the east rim, standing on edge, axis along the rim: push one outward and it rolls down the
    // slope (toward the lawn and the farmhouse lane)
    for (let i = 0; i < 4; i++) {
      const a = -0.75 + i * 0.5, r = 3.6, x = HILL.x + Math.cos(a) * r, z = HILL.z + Math.sin(a) * r;
      prop('cheeseWheel', x, z, -a - Math.PI / 2);
    }
    prop('prizeCheese', HILL.x - 1.6, HILL.z + 1.2, 0.6);
    // wildflowers on the slopes (no colliders: wheels roll straight through)
    for (let i = 0; i < 70; i++) {
      const a = rng.range(0, 6.28), r = rng.range(HILL.flat + 1, HILL.r - 2), x = HILL.x + Math.cos(a) * r, z = HILL.z + Math.sin(a) * r;
      decor(rng.next() < 0.5 ? 'nature/Flower_3_Group' : 'nature/Flower_4_Group', x, z, { height: rng.range(0.35, 0.5), yaw: rng.range(0, 6.28) });
    }
    decor('kenney/sign', HILL.x + 1.6, HILL.z + 3.2, { height: 1.1, yaw: -0.6 });
    void hy;

    // ---------------------------------------------------------------- the bull's paddock
    d.trough(31, -74, Math.PI / 2);
    decor('kenney/sign', 26.6, -88, { height: 1.1, yaw: Math.PI / 2 });                              // "beware of the bull"
    prop('redRag', 26.4, -89.2, 0.3);                                                                // hanging by the sign
    for (const [x, z] of [[46, -94], [52, -74]] as const) decor('kenney/rock_largeA', x, z, { height: 1.3, yaw: rng.range(0, 6), collide: 'box' });
    decor('nature/TreeStump', 38, -92, { height: 0.9, collide: 'box' });

    // ---------------------------------------------------------------- hay meadow: tall-grass strips (soft cover)
    const strip = (x0: number, x1: number, z0: number, z1: number) => {
      for (let x = x0 + 0.35; x < x1; x += 0.75) for (let z = z0 + 0.35; z < z1; z += 0.75)
        decor(rng.next() < 0.6 ? 'nature/Grass_Wispy_Tall' : 'nature/Grass_Common_Tall', x + rng.range(-0.2, 0.2), z + rng.range(-0.2, 0.2), { height: rng.range(1.05, 1.35), yaw: rng.range(0, 6.28) });
      t.noGrass({ x0, x1, z0, z1 });
      G.cover.rect('crop', x0, x1, z0, z1, y((x0 + x1) / 2, (z0 + z1) / 2) - 0.3, 1.3);
      blocked.push({ x0, x1, z0, z1 });
    };
    strip(30, 52, -66, -60); strip(10, 18, -54, -44); strip(-8, -2, -50, -38); strip(30, 38, -16, -8); strip(-56, -50, -86, -70);

    // ---------------------------------------------------------------- garden rows (beds of crops)
    for (let i = 0; i < 4; i++) {
      const z = -98 + i * 2.3;
      for (let x = -19; x < -11; x += 2) {
        decor('kenney/crops_dirtRow', x + 1, z, { scale: 2, yaw: Math.PI / 2 });
        const [crop, sc, sink] = ([['crops/Carrot_4', 1.5, 0.9], ['crops/Lettuce_4', 1.2, 0.04], ['crops/Beet_4', 1.5, 0.45], ['crops/Watermelon_4', 1.15, 0.22]] as const)[i];
        decor(crop, x + 1 + rng.range(-0.15, 0.15), z, { scale: sc, sink, yaw: rng.range(0, 6.28) });
      }
    }

    // ---------------------------------------------------------------- dressing: lamps, pond, laundry, picnic table, outhouse…
    d.lamps([[-8, -80], [4, 9], [-34.4, -2], [-6, -18], [8, -58], [-28, -24], [22, -36.6], [24, -80.6], [-4, 14.5], [12, -18]]);
    d.pond(POND);
    d.laundry(-18, -6, -78);
    d.picnic(17, -66, 0.3);
    d.outhouse(-32, -14, Math.PI / 2);
    d.phone(9.4, -80.2, 0, 12.0, -77.2);
    d.payphone(-4.6, 9.0, Math.PI / 2);
    d.hammock(-13.6, -78.5, 0);
    d.mailbox(5.2, 14.2);
    d.rocker(-9.6, -80.6, -7, -72);
    d.scarecrow(-16, -96, 0.2);
    d.trough(30, -26);
    d.trough(-52, -92, Math.PI / 2);
    d.finish();
    decor('nature/Willow_1', -54, -14, { height: 8, collide: 'trunk' }); decor('nature/Willow_2', -40, -28.5, { height: 7, collide: 'trunk' });
    blocked.push({ x0: -56, x1: -38, z0: -30, z1: -14 });
    decor('kenney/tractor', 20, 4.6, { height: 2.6, yaw: 2.4, collide: 'box' });
    for (let i = 0; i < 4; i++) decor('kenney/stump_round', 41.6 + i * 1.6, 8.4 + rng.range(-0.3, 0.3), { height: 0.5, collide: 'box' });
    decor('nature/TreeStump', 14, -48.5, { height: 0.8, collide: 'box' });

    // ---------------------------------------------------------------- hiding spots
    const ck = coverKit({ scene, t, rng, out, blocked, forest, decor });
    for (const cl of [[[-56, 10], [-53.4, 12]], [[56, -60], [57.6, -63]], [[-8, -100.5], [-5, -101.5]], [[-44, -82], [-42, -85]],
      [[18, 12], [21, 13.4]], [[-12, -46], [-14.6, -48]], [[22, -56], [20, -58.6]], [[56, -2], [57, 1]], [[-30, -88], [-33, -90]]] as [number, number][][])
      for (const [x, z] of cl) ck.bush(x, z);
    ck.baleStack(-22, -5.5, 0.1);              // in the hay shed
    ck.baleStack(-44, -40, 1.2, 2);
    ck.baleStack(14, -26, -0.4, 2);
    ck.baleStack(44, -66.4, 0);
    ck.baleStack(-14, -60, 1.3, 2);            // at the foot of cheese hill
    ck.hard('cover/Logs', 46, 10.5, 1.2, 0.2);
    ck.hard('cover/Crate_Big_Stack2', 20.5, -18, 1.8, 0.3);
    ck.hard('cover/Bags', -28, -30.5, 0.95, 1);
    ck.hard('cover/WoodLog', -8, -56, 0.9, 0.6);
    ck.hard('cover/WoodLog', 36, -98.6, 0.9, 0.2);
    ck.hard('cover/Crate_Stack2', 8, -3, 1.5, -0.3);
    ck.hard('cover/MarketStand_2', -8, 12, 2.6, 0);                       // milk + cheese stand by the gate
    ck.hard('cover/Hay', 42, -50, 1.2, 0.4);

    // ---------------------------------------------------------------- loose props
    for (const [x, z] of [[-6, 4.5], [-7.2, 5.6], [-9, -10]] as const) prop('crate', x, z);
    for (const [x, z] of [[-38.6, -30.6], [-39.6, -31.4], [22.6, -6.2], [22.8, -11.6]] as const) prop('barrel', x, z, 0);
    for (const [x, z] of [[41.4, 9.6], [42.8, 10.4], [40.4, 10.8]] as const) prop('log', x, z);
    prop('axe', 43.2, 9.2, 0.3, 0.55);
    prop('sword', 52, -40); prop('shovel', -12.6, -92.6, 1.2); prop('pan', 10.8, -77.4);
    // valuables: the farmhouse porch, the picnic table, the barn, the creamery, the silo
    prop('chest', -7.2, -82.2, 0.2); prop('chalice', 1.6, -81.8); prop('necklace', 3.4, -82.2);
    prop('safe', 5.8, -81.4, 0);   // heavy loot: two pigs drag it (or one full of spinach)
    prop('tv', -7.0, -76.4, -2.6);
    prop('clock', 2.4, -82.6, 0);
    prop('phone', 16.7, -66.2, 0.3, 0.84); prop('radio', 17.6, -65.6, 0.3, 0.84);
    prop('gold', -37.8, -30.8, 0.4); prop('crown', 54, -96, 0.6);                                   // the crown: deep in the bull's paddock
    prop('gasCan', 24, 6); prop('propane', 14.6, -77.4, 0); prop('firstAid', -14, 4); prop('backpack', -12.4, 3);
    prop('ham', 2.2, -82.8, 0, 0); prop('mug', 14.2, -74.6);
    prop('veggieCrate', -9.8, -90); prop('tomatoCrate', -9.6, -88.6); prop('trashcan', 4.6, -76.6, 0);
    // bones for the dog
    prop('bone', 5.4, -76); prop('bone', -20, 4); prop('bone', 26, -14); prop('bone', -40, -46);
    // pranks: the pie on the picnic table, Bob's undies under the laundry line, a gnome in the garden, eggs by the coop,
    // flower pots on the porch, melons + pumpkins in the garden, hay bales to roll into the pond
    prop('pie', 17.3, -66.3, 0, 0.84);
    prop('undies', -10.4, -77.6, 0.4);
    prop('gnome', -11.4, -94, 2.2);
    for (const [x, z] of [[-3.2, -24.6], [-3.5, -24.8], [-3.3, -25.0], [-12.4, -22], [-12.1, -21.8]] as const) prop('egg', x, z, rng.range(0, 6));
    for (const [x, z] of [[-6.4, -81.8], [-5.6, -82.1], [1.8, -82.6], [0.9, -82.3]] as const) prop('flowerPot', x, z, 0);
    for (const [x, z] of [[-18.4, -91.4], [-15.8, -91.6]] as const) prop('melon', x, z);
    for (const [x, z] of [[-19, -97.6], [-12.4, -97.4], [-10.6, -86]] as const) prop('pumpkin', x, z);
    prop('bigPumpkin', -19.2, -93.4);
    for (const [x, z] of [[-21.2, -10.6], [-26.4, -11.4], [-23.2, -12.2], [8.6, -24], [26.6, -60], [-40, -12]] as const) prop('hay', x, z);

    // ---------------------------------------------------------------- animals
    const coop = V3(-11, y(-11, -27), -27);
    for (let i = 0; i < 6; i++) critter('hen', rng.range(-12, -4), rng.range(-28, -22), 4);
    for (let i = 0; i < 4; i++) critter('chick', rng.range(-11, -5), rng.range(-27, -23), 3);
    critter('rooster', -4, -22.6, 5);
    for (const c of out.critters) c.roost = coop;
    for (const [x, z] of [[30, -28], [36, -34], [44, -26], [40, -46], [32, -48], [48, -34]] as const) critter('cow', x, z, 9);
    critter('donkey', 46, -30, 6);
    const bull = critter('bull', 44, -84, 11);
    for (let i = 0; i < 4; i++) critter('sheep', rng.range(-56, -48), rng.range(-98, -90), 4.5);
    critter('dog', 4, -74, 5);
    for (const [x, z] of [[-14.4, -94], [-15, -97], [-12.6, -91.6]] as const) critter('turkey', x, z, 4);   // guard the garden
    critter('cat', -10, 2, 6); critter('cat', -24, -32, 4);
    critter('bunny', 14, -50, 6); critter('bunny', -36, -70, 6); critter('bunny', -16, -92, 4);
    for (let i = 0; i < 3; i++) critter('duck', POND.x + rng.range(-3, 3), POND.z + rng.range(-3, 3), 3.5);
    const dairy = new Dairy(scene, BULL_PEN, out.critters, out.props);
    dairy.setBull(bull);
    out.dairy = dairy;
    // milking sounds while Bob milks
    let milkT = 0;
    out.updaters.push((dt) => {
      const f = G.farmer; if (!f || f.activity !== 'chore.milk' || Math.hypot(f.pos.x - 6.6, f.pos.z + 15.2) > 1.5) return;
      milkT -= dt; if (milkT > 0) return;
      milkT = 1.3 + Math.random() * 0.8;
      G.audio.play('milk', { pos: V3(8, f.pos.y + 0.3, -15.2), vol: 0.5, rand: 0.1 });
    });

    // ---------------------------------------------------------------- pigs start in the sty
    out.pigSpawns.push(V3(-45, y(-45, 0.5) + 0.5, 0.5), V3(-40, y(-40, 0.5) + 0.5, 0.5), V3(-45.4, y(-45.4, 7.5) + 0.5, 7.5), V3(-41.4, y(-41.4, 6.5) + 0.5, 6.5));

    // ---------------------------------------------------------------- nature
    kit.hedgeRing();
    kit.surroundings(['oak', 'oak', 'poplar', 'pine']);
    blocked.push({ x0: HILL.x - HILL.r * 0.6, x1: HILL.x + HILL.r * 0.6, z0: HILL.z - HILL.r * 0.6, z1: HILL.z + HILL.r * 0.6 });   // keep the slopes clear for rolling
    kit.scatter({ trees: 8, bushes: 34 });
    return kit.finish();
  };
  return { bounds: FARM3, terrain, build };
}
