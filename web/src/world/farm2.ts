import * as THREE from 'three';
import { V3 } from '../core/util';
import { Terrain, type Rect } from './terrain';
import { Cage } from './cage';
import type { Chore } from '../farmer/farmer';
import type { DayNight } from './daynight';
import { decorKit } from './decor';
import { coverKit } from './hideouts';
import { sunflowers } from './landmarks';
import { farmKit, type FarmBuild, type FarmDef } from './farmKit';
import { Orchard } from './orchard';
import { Bees } from './bees';
import { G } from '../game/ctx';
import type { MissionId } from '../game/round';

/** Models only farm 2 uses (preloaded when farm 2 is played). Quaternius Medieval Village + Nature (CC0). */
export const FARM2_MODELS = [
  ...['Mill', 'Stable', 'Inn', 'Sawmill', 'Gazebo', 'Bell_Tower', 'Cart', 'Bench_1', 'Cauldron'].map((n) => 'village/' + n),
  ...['Willow_1', 'Willow_2', 'TreeStump', 'Grass_Wispy_Tall', 'Grass_Common_Tall', 'Bush_Common_Flowers'].map((n) => 'nature/' + n),
];

/**
 * Farm 2 — Bob's orchard & beehives. North = −z, the road gate is in the south (x = 0) like on farm 1.
 * Layout: sty (start, south-east) · the orchard (east half: rows of apple trees you can shake, a golden apple in the
 * middle, tall-grass strips) · paddock + stable (north-east) · farmhouse = the old inn (north, cage + BBQ by the porch)
 * · vegetable garden (north-west of the house) · apiary with 6 beehives + sunflowers + the honey stand (north-west
 * corner) · windmill + duck pond with willows (west) · cider house + cider press (west) · sheep pen (south-west) ·
 * chicken pen + barn + yard (south-centre).
 */
export const FARM2: Rect = { x0: -60, x1: 60, z0: -104, z1: 16 };

const CHORES: Chore[] = [
  { id: 'pigs', at: [28.4, 1.2], look: [31, 1.2], anim: 'pour', dur: 12, view: 'busy' },
  { id: 'chickens', at: [-7, -19.6], look: [-7, -24], anim: 'feed', dur: 16, view: 'busy' },
  { id: 'apples', at: [23.2, -53], look: [26.6, -53], anim: 'fix', dur: 16, view: 'busy' },
  { id: 'mow', at: [0, 0], look: [0, 0], anim: 'ride', dur: 50, view: 'busy' },
  { id: 'bees', at: [-48.6, -95.9], look: [-48.6, -98.6], anim: 'water', dur: 18, view: 'busy' },
  { id: 'horses', at: [33, -79.8], look: [33, -86], anim: 'lean', dur: 14, view: 'normal' },
  { id: 'cider', at: [-28, -5.4], look: [-28, -8], anim: 'pour', dur: 16, view: 'busy' },
  { id: 'nap', at: [10.6, -40.5], look: [14, -40.5], anim: 'nap', dur: 26, view: 'nap' },
  { id: 'garden', at: [-13.6, -92], look: [-18, -92], anim: 'water', dur: 18, view: 'busy' },
  { id: 'apples', at: [42.2, -32], look: [45.5, -32], anim: 'fix', dur: 16, view: 'busy' },
  { id: 'paper', at: [-10.2, -76.6], look: [-8, -68], anim: 'read', dur: 30, view: 'paper' },
  { id: 'laundry', at: [-26, -70.6], look: [-26, -72], anim: 'laundry', dur: 14, view: 'busy' },
  { id: 'coffee', at: [13.5, -71.5], look: [10, -64], anim: 'coffee', dur: 16, view: 'busy' },
  { id: 'wood', at: [-31.5, 9.4], look: [-31.5, 8], anim: 'chop', dur: 16, view: 'busy' },
  // evening: flashlight round
  { id: 'patrol', at: [26, -2], look: [36, 4], anim: 'look', dur: 5, view: 'flashlight', phase: 'evening' },
  { id: 'patrol', at: [11, -30], look: [26, -40], anim: 'look', dur: 5, view: 'flashlight', phase: 'evening' },
  { id: 'patrol', at: [12, -62], look: [30, -70], anim: 'look', dur: 5, view: 'flashlight', phase: 'evening' },
  { id: 'patrol', at: [-38, -88], look: [-48, -96], anim: 'look', dur: 5, view: 'flashlight', phase: 'evening' },
  { id: 'patrol', at: [-26, -20], look: [-36, -12], anim: 'look', dur: 5, view: 'flashlight', phase: 'evening' },
  // night
  { id: 'bed', at: [-4, -76.4], look: [-4, -84], anim: 'idle', dur: 1, view: 'normal', phase: 'night' },
];

/** Pranks that work here: the shared ones whose places / things exist + the orchard's own (featured). */
const FEATURED: MissionId[] = ['shakeTrees', 'appleBob', 'ciderPress', 'beeBob', 'honeySteal', 'goldApple'];
const MISSIONS: MissionId[] = [...FEATURED, 'knockBob', 'staggerBob', 'fartBob', 'mugPond', 'catBath', 'lambStash', 'hensOut', 'wolfScare',
  'pumpkinWell', 'sheepOut', 'hayPond', 'loseBob', 'whackBob', 'henPond', 'smashPots', 'melonSmash', 'eggBob', 'gnomePond', 'undiesWell',
  'pieSteal', 'mudPorch', 'cowsOut', 'gateBreak'];

export function buildFarm2(scene: THREE.Scene): FarmDef {
  const F = FARM2;
  const terrain = new Terrain(F);
  // ---- ground paint (before terrain.build)
  const P = (pts: [number, number][], w = 3) => terrain.path(pts, w);
  P([[0, 22], [0, 4]], 4.5);                                        // road in from the south gate
  P([[0, 4], [-2, -16], [-4, -40], [-4, -60], [-4, -76]], 3.5);     // the main lane up to the farmhouse
  P([[0, 2], [16, 2], [28, 3]], 2.6);                               // yard → sty
  P([[-2, -8], [-16, -8], [-26, -8]], 3);                           // yard → cider house
  P([[-4, -46], [-22, -46], [-34, -44]], 2.4);                      // lane → pond
  P([[-4, -66], [-26, -78], [-40, -90]], 2.4);                      // house → apiary
  P([[-4, -40], [10, -38], [52, -38]], 2.6);                        // the orchard's middle aisle
  P([[4, -76], [33, -79]], 2.2);                                    // house → paddock gate
  P([[-8, -88], [-14, -92]], 2.2);                                  // house → garden
  terrain.dirt({ x0: -12, x1: 12, z0: -12, z1: 8 }, 3);             // yard
  terrain.dirt({ x0: 30, x1: 43, z0: -2, z1: 10 }, 1.5);            // sty floor
  terrain.dirt({ x0: -14, x1: 0, z0: -34, z1: -22 }, 2);            // chicken pen
  terrain.dirt({ x0: -32, x1: -16, z0: -98, z1: -86 }, 1);          // garden soil
  terrain.dirt({ x0: -34, x1: -22, z0: -12, z1: -2 }, 2);           // cider press yard
  terrain.dirt({ x0: -58, x1: -46, z0: 0, z1: 13 }, 1.5);           // sheep pen
  terrain.dirt({ x0: 20, x1: 56, z0: -100, z1: -82 }, 0.8);         // paddock (worn grass)
  terrain.mud(38, 6.5, 3, 2.2);                                     // the sty wallow
  terrain.mud(-20, -40, 2.2, 1.6); terrain.mud(30, -28, 2, 1.5); terrain.mud(-50, -24, 2.4, 1.8);
  terrain.mud(46, -60, 2.2, 1.6); terrain.mud(-36, -60, 1.8, 1.5); terrain.mud(24, -94, 2.5, 2);
  const POND = { x: -42, z: -44, r: 6 };

  const build = (t: Terrain, daynight: DayNight): FarmBuild => {
    const garden = { x0: -32, x1: -16, z0: -98, z1: -86 };
    const out: FarmBuild = {
      props: [], critters: [], decor: [], spinners: [], updaters: [], statics: [], pigSpawns: [],
      cage: new Cage(scene, V3(10, t.height(10, -75), -75), 0), chores: CHORES,
      farmerSpawn: V3(4, t.height(4, -70), -70),
      zones: { garden: [garden], lawn: { x0: -12, x1: 6, z0: -66, z1: -54 }, door: V3(-4, t.height(-4, -76.4), -76.4), mowerAt: V3(-16, t.height(-16, -60), -60),
        roadGate: V3(0, t.height(0, 12.5), 12.5) },
      inWater: (x, z) => Math.hypot(x - POND.x, z - POND.z) < POND.r - 0.3,
      gates: [],
      places: {
        pond: POND, well: { x: 6, z: -46 },
        coop: { x0: -14, x1: 0, z0: -34, z1: -22 }, sheepPen: { x0: -58, x1: -46, z0: 0, z1: 13 }, pasture: { x0: 20, x1: 56, z0: -100, z1: -82 },
        stash: V3(35.5, t.height(35.5, 3), 3), roadGate: V3(0, t.height(0, 12.5), 12.5), dogPatrol: { x: 0, z: -44, r: 46 },
        tp: [['sty', 36, 1], ['cage', 10, -72], ['house', -4, -74], ['orchard', 30, -38], ['apiary', -40, -92], ['press', -26, -6],
          ['pasture', 33, -78], ['garden', -12, -90], ['pond', -34, -40], ['mill', -44, -58], ['wheat', 17, -55]],
      },
      missions: MISSIONS,
      featured: FEATURED,
    };
    t.noGrass({ x0: 5, x1: 15, z0: -78, z1: -72 });
    const kit = farmKit(scene, t, out, F, 2027);
    const { rng, blocked, y, building, decor, pen, prop, critter, spinner, forest } = kit;

    // ---------------------------------------------------------------- buildings
    building('village/Inn', -4, -85, 10.5, 0);                          // the farmhouse (an old inn)
    building('farm/Barn', -18, 0, 8.5, Math.PI / 2);
    building('village/Sawmill', -40, -9, 7.5, Math.PI / 2);              // the cider house
    spinner(building('village/Mill', -48, -66, 15, 0.6), 'Mill_Blades', 0.7);
    building('village/Stable', 47, -94, 6.5, Math.PI);
    building('farm/ChickenCoop', -11, -29, 3.4, Math.PI / 2);
    building('farm/Well', 6, -46, 3.2);
    building('farm/OpenBarn', -24, -30, 6, 0);                           // hay shed
    building('farm/WaterTower', 52, 8, 11);
    building('farm/ChickenCoop', 40.5, 7.4, 2.8, Math.PI);                // the pigs' hut
    decor('village/Bell_Tower', 16, -86, { height: 9, yaw: 0.4, collide: 'box' });
    blocked.push({ x0: 4, x1: 17, z0: -80, z1: -66 });                    // cage + grill + Bob's coffee spot
    blocked.push({ x0: -13, x1: 7, z0: -67, z1: -53 }, { x0: -8, x1: 2, z0: -78, z1: 6 });   // the lawn (mowing) + the main lane

    // ---------------------------------------------------------------- pens & fences
    pen({ x0: 30, x1: 43, z0: -2, z1: 10 }, 'w', 2.6, undefined, 'sty', { lockable: false, start: 'free' });
    pen({ x0: -14, x1: 0, z0: -34, z1: -22 }, 's', 2.4, undefined, 'chickens');
    pen({ x0: 20, x1: 56, z0: -100, z1: -82 }, 's', 3.5, 'kenney/fence_planks', 'pasture');
    pen(garden, 'e', 2.4, undefined, 'garden');
    pen({ x0: -58, x1: -46, z0: 0, z1: 13 }, 'e', 2.6, 'kenney/fence_planks', 'sheep');
    kit.outerFence();

    // ---------------------------------------------------------------- the orchard: rows of shakeable apple trees
    const trees: { x: number; z: number; s: number; gold?: boolean }[] = [];
    for (let i = 0; i < 7; i++) for (let j = 0; j < 9; j++) {
      const x = 14 + i * 6.3, z = -74 + j * 7;
      if (Math.abs(z - -39) < 2 && i === 0) continue;           // the middle aisle starts open
      const gold = i === 3 && j === 5;
      trees.push({ x: x + (gold ? 0 : rng.range(-0.5, 0.5)), z: z + (gold ? 0 : rng.range(-0.5, 0.5)), s: gold ? 1.2 : rng.range(0.92, 1.1), gold });
      blocked.push({ x0: x - 1.6, x1: x + 1.6, z0: z - 1.6, z1: z + 1.6 });
    }
    const orchard = new Orchard(scene, trees, out.props, y);
    orchard.buildPress(-28, -8, 0.2, out.props);
    out.orchard = orchard;
    // tall-grass strips along some aisles (soft cover between the trees)
    const strip = (x0: number, x1: number, z0: number, z1: number) => {
      for (let x = x0 + 0.35; x < x1; x += 0.75) for (let z = z0 + 0.35; z < z1; z += 0.75)
        decor(rng.next() < 0.6 ? 'nature/Grass_Wispy_Tall' : 'nature/Grass_Common_Tall', x + rng.range(-0.2, 0.2), z + rng.range(-0.2, 0.2), { height: rng.range(1.05, 1.35), yaw: rng.range(0, 6.28) });
      t.noGrass({ x0, x1, z0, z1 });
      G.cover.rect('crop', x0, x1, z0, z1, y((x0 + x1) / 2, (z0 + z1) / 2) - 0.3, 1.3);
    };
    strip(15.9, 18.4, -71, -44); strip(35, 37.5, -64, -42); strip(47.6, 50.1, -74, -48); strip(22.2, 24.7, -34, -18); strip(41.2, 43.7, -28, -16);
    // ladder + apple crates in the rows
    for (const [x, z, yaw] of [[20.6, -60.5, 0.3], [39.5, -25.5, 1.2], [45.6, -67.4, -0.4]] as const) decor('cover/Crate_Stack1', x, z, { height: 1.2, yaw, collide: 'box' });

    // ---------------------------------------------------------------- the apiary (6 hives) + sunflowers + the honey stand
    const bees = new Bees(scene, [[-52, -98.6], [-48.6, -99], [-45.2, -98.6], [-52, -93.2], [-48.6, -92.8], [-45.2, -93.2]], y);
    out.bees = bees;
    blocked.push({ x0: -55, x1: -42, z0: -101, z1: -91 });
    sunflowers({ scene, t, rng, out, blocked, decor, prop }, { x0: -58, x1: -46, z0: -88, z1: -78 }, false);
    decor('village/Gazebo', -37, -98, { height: 3.4, yaw: 0.2 });
    const d = decorKit({ scene, t, rng, out, daynight, blocked, decor, prop, POND, F });
    d.picnic(-37, -98, 0.2);                                              // the honey table under the gazebo
    for (const [x, z] of [[-37.6, -98.1], [-37.1, -97.9], [-36.6, -98.2], [-36.2, -97.8]] as const) prop('honey', x, z, 0, 0.84);
    prop('honeyPot', -38.3, -97.7, 0, 0.84);
    for (let i = 0; i < 30; i++) { const x = rng.range(-58, -40), z = rng.range(-102, -90); if (Math.hypot(x + 48.6, z + 96) > 5.5) decor('nature/Flower_3_Group', x, z, { height: 0.45, yaw: rng.range(0, 6) }); }

    // ---------------------------------------------------------------- garden rows (beds of crops)
    for (let i = 0; i < 5; i++) {
      const z = -96.5 + i * 2.2;
      for (let x = -30; x < -18; x += 2) {
        decor('kenney/crops_dirtRow', x + 1, z, { scale: 2, yaw: Math.PI / 2 });
        const [crop, sc, sink] = ([['crops/Carrot_4', 1.5, 0.9], ['crops/Lettuce_4', 1.2, 0.04], ['crops/Tomato_4', 1.5, 0], ['crops/Beet_4', 1.5, 0.45], ['crops/Watermelon_4', 1.15, 0.22]] as const)[i];
        decor(crop, x + 1 + rng.range(-0.15, 0.15), z, { scale: sc, sink, yaw: rng.range(0, 6.28) });
      }
    }

    // ---------------------------------------------------------------- dressing: lamps, pond, laundry, picnic table, outhouse…
    d.lamps([[-12, -77], [4, 9], [27.6, -3], [-6, -18], [8, -60], [-26, -13], [-40, -88], [30, -80.6], [-4, 14.5], [26, -40]]);
    d.pond(POND);
    d.laundry(-30, -22, -72);
    d.picnic(17, -66, 0.3);
    d.outhouse(-34, -26, Math.PI / 2);
    d.phone(6.4, -75.6, 0, 9.0, -72.6);
    d.payphone(-4.6, 9.0, Math.PI / 2);
    d.hammock(-12.5, -67.9, Math.PI / 2);
    d.mailbox(5.2, 14.2);
    d.rocker(-10.2, -76.6, -8, -68);
    d.scarecrow(-24, -92, 0.2);
    d.trough(28, -86);
    d.trough(-52, 4, Math.PI / 2);
    d.finish();
    decor('nature/Willow_1', -49.5, -37, { height: 8, collide: 'trunk' }); decor('nature/Willow_2', -33, -51, { height: 7.5, collide: 'trunk' });
    decor('nature/Willow_1', -50, -51.5, { height: 7, collide: 'trunk' });
    blocked.push({ x0: -53, x1: -30, z0: -55, z1: -33 });
    decor('village/Cart', 6, 4, { height: 2.2, yaw: -0.6, collide: 'box' });
    decor('kenney/tractor', 9, -6, { height: 2.6, yaw: 2.4, collide: 'box' });
    decor('village/Cauldron', -33.5, -4.5, { height: 0.9, collide: 'box' });
    decor('village/Bench_1', -14, -74, { height: 1, yaw: Math.PI, collide: 'box' });
    for (let i = 0; i < 4; i++) decor('kenney/stump_round', -33.4 + i * 1.6, 8.2 + rng.range(-0.3, 0.3), { height: 0.5, collide: 'box' });
    decor('nature/TreeStump', 11, -36.5, { height: 0.8, collide: 'box' });

    // ---------------------------------------------------------------- hiding spots
    const ck = coverKit({ scene, t, rng, out, blocked, forest, decor });
    for (const cl of [[[-56, -14], [-53.4, -16.4], [-57, -18.6]], [[56, -20], [57.6, -23]], [[56, -76], [57.4, -73]], [[-8, -100], [-5, -101]],
      [[-36, -76], [-38.6, -74]], [[22, 12], [25, 13.4]], [[-12, -48], [-14.6, -50]], [[-56, -78], [-57, -72]], [[18, -84.6]]] as [number, number][][])
      for (const [x, z] of cl) ck.bush(x, z);
    ck.baleStack(-22, -26.5, 0.1);             // in the hay shed
    ck.baleStack(-46, -30, 1.2, 2);
    ck.baleStack(4, -24, -0.4, 2);
    ck.baleStack(54, -42, 1.57);
    ck.hard('cover/Logs', -36.5, 12, 1.2, 0.2);
    ck.hard('cover/Crate_Big_Stack2', -32, -16, 1.8, 0.3);
    ck.hard('cover/Bags', -26.6, -34.5, 0.95, 1);
    ck.hard('cover/WoodLog', -14, -56, 0.9, 0.6);
    ck.hard('cover/WoodLog', 52, -86.6, 0.9, 0.2);
    ck.hard('cover/Crate_Stack2', 8, -3, 1.5, -0.3);
    ck.hard('cover/MarketStand_1', -8, 12, 2.6, 0);                       // fruit stand by the gate
    ck.hard('cover/Hay', 26, -96, 1.2, 0.4);

    // ---------------------------------------------------------------- loose props
    for (const [x, z] of [[-6, 6.5], [-7.2, 7.6], [5, 7.6], [-9, -10]] as const) prop('crate', x, z);
    for (const [x, z] of [[-30.6, -4.2], [-31.8, -3.6], [-24.5, -10.6], [-25.6, -11.4], [-33, -11]] as const) prop('barrel', x, z, 0);
    for (const [x, z] of [[-31.4, 8.6], [-32.8, 9.6], [-30.4, 9.8]] as const) prop('log', x, z);
    prop('axe', -33.2, 8.4, 0.3, 0.55);
    prop('sword', 49, -96); prop('shovel', -15.6, -95.6, 1.2); prop('pan', 8.8, -73.4);
    // valuables: the farmhouse porch, the picnic table, the barn, the cider house, the tractor
    prop('chest', -9.2, -78.4, 0.2); prop('chalice', -1.6, -77.8); prop('necklace', 0.6, -78.2);
    prop('safe', 2.6, -77.4, 0);   // heavy loot: two pigs drag it (or one full of spinach)
    prop('tv', -7.6, -72.2, -2.6);
    prop('clock', -0.6, -78.4, 0);
    prop('phone', 16.7, -66.2, 0.3, 0.84); prop('radio', 17.6, -65.6, 0.3, 0.84);
    prop('gold', -36.8, -5.6, 0.4); prop('crown', 50.4, -97.4, 0.6);
    prop('gasCan', 11, -4); prop('propane', 12.6, -73.4, 0); prop('firstAid', -14, 4); prop('backpack', -12.4, 3);
    prop('cheese', -2, -79); prop('ham', 2.2, -78.8, 0, 0); prop('mug', 12.2, -70.6);
    prop('veggieCrate', -14.8, -88); prop('tomatoCrate', -14.6, -86.6); prop('trashcan', 2.6, -72.6, 0);
    // bones for the dog
    prop('bone', 3.4, -72); prop('bone', -20, 4); prop('bone', 26, -20); prop('bone', -40, -36);
    // pranks: the pie on the picnic table, Bob's undies under the laundry line, a gnome in the garden, eggs by the coop,
    // flower pots on the porch, melons + pumpkins in the garden, hay bales to roll into the pond
    prop('pie', 17.3, -66.3, 0, 0.84);
    prop('undies', -24.4, -71.6, 0.4);
    prop('gnome', -17.4, -90, 2.2);
    for (const [x, z] of [[-3.2, -26.6], [-3.5, -26.8], [-3.3, -27.0], [-12.4, -24], [-12.1, -23.8]] as const) prop('egg', x, z, rng.range(0, 6));
    for (const [x, z] of [[-6.4, -77.8], [-7.1, -78.1], [-1, -78.6], [-0.2, -78.3]] as const) prop('flowerPot', x, z, 0);
    for (const [x, z] of [[-20.4, -88.6], [-22.8, -88.8], [-27.6, -88.4], [-25, -97.4]] as const) prop('melon', x, z);
    for (const [x, z] of [[-29.4, -86.6], [-30.6, -87.6], [-17.6, -97], [-12, -84]] as const) prop('pumpkin', x, z);
    prop('bigPumpkin', -31, -96.6); prop('bigPumpkin', -17.4, -95);
    for (const [x, z] of [[-21.2, -27.6], [-26.4, -28.4], [-23.2, -33.2], [6.6, -20], [27.2, -90], [-44, -26]] as const) prop('hay', x, z);

    // ---------------------------------------------------------------- animals
    const coop = V3(-11, y(-11, -29), -29);
    for (let i = 0; i < 6; i++) critter('hen', rng.range(-12, -2), rng.range(-32, -24), 4.5);
    for (let i = 0; i < 4; i++) critter('chick', rng.range(-11, -3), rng.range(-31, -25), 3);
    critter('rooster', -4, -24.6, 6);
    for (const c of out.critters) c.roost = coop;
    critter('cow', 28, -92, 7); critter('cow', 36, -95, 7);
    critter('horse', 32, -88, 8); critter('horse2', 40, -90, 8); critter('donkey', 26, -88, 5); critter('alpaca', 24, -96, 4);
    for (let i = 0; i < 5; i++) critter('sheep', rng.range(-56, -48), rng.range(2, 11), 5);
    critter('dog', 2, -72, 5);
    for (const [x, z] of [[-12.4, -90], [-13, -94], [-11.6, -96]] as const) critter('turkey', x, z, 4.5);   // guard the garden
    critter('cat', -10, 2, 6); critter('cat', -6, -75, 4);
    critter('bunny', 20, -50, 6); critter('bunny', 40, -60, 6); critter('bunny', -22, -92, 5);
    for (let i = 0; i < 3; i++) critter('duck', POND.x + rng.range(-3, 3), POND.z + rng.range(-3, 3), 3.5);

    // ---------------------------------------------------------------- pigs start in the sty
    out.pigSpawns.push(V3(33, y(33, 0.5) + 0.5, 0.5), V3(38, y(38, 0.5) + 0.5, 0.5), V3(32.6, y(32.6, 7.5) + 0.5, 7.5), V3(36.6, y(36.6, 8.5) + 0.5, 8.5));

    // ---------------------------------------------------------------- nature
    kit.hedgeRing();
    kit.surroundings(['oak', 'apple', 'poplar', 'pine']);
    kit.scatter({ trees: 8, bushes: 36 });
    return kit.finish();
  };
  return { bounds: FARM2, terrain, build };
}
