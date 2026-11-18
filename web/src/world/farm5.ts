import * as THREE from 'three';
import { V3 } from '../core/util';
import { Terrain, type Rect } from './terrain';
import { Cage } from './cage';
import type { Chore } from '../farmer/farmer';
import type { DayNight } from './daynight';
import { decorKit } from './decor';
import { coverKit } from './hideouts';
import { farmKit, type FarmBuild, type FarmDef } from './farmKit';
import { Winter } from './winter';
import { snowyForest } from './nature';
import { BOB_STYLE } from '../farmer/farmerModel';
import { GLB_ANIMALS, HUSKY } from './animalGlb';
import type { MissionId } from '../game/round';

/** Models only farm 5 uses (preloaded when farm 5 is played): Kenney Holiday Kit + Quaternius snowy nature + animals (CC0). */
const SNOWY = ['PineTree_Snow_1', 'PineTree_Snow_2', 'PineTree_Snow_3', 'PineTree_Snow_4', 'CommonTree_Snow_1', 'CommonTree_Snow_2', 'BirchTree_Snow_1',
  'CommonTree_Dead_Snow_1', 'Bush_Snow_1', 'Bush_Snow_2', 'Rock_Snow_1', 'Rock_Snow_2', 'Rock_Snow_3', 'TreeStump_Snow', 'WoodLog_Snow'];
export const FARM5_MODELS = [
  ...SNOWY.map((n) => 'winter/' + n),
  ...['sled', 'snowFort', 'treeDecorated', 'candyCane', 'wreath', 'lightpost'].map((n) => 'winter/' + n),
  'animals/Husky', 'animals/Stag', 'animals/Deer', 'village/House_2', 'village/Bench_2', 'kaykit/jar_A_large', 'crops/Lettuce_4', 'crops/Beet_4',
];

/**
 * Farm 5 — the winter farm (snow and ice; the week before the holidays). North = −z, the road gate in the south.
 * Everything is under snow: pigs leave hoofprints Bob can follow (the shovelled paths don't take prints), a roll in
 * the snow is a white camouflage coat, snowballs to throw, snowballs that grow as they roll. Ice: the frozen pond with
 * Bob's ice-fishing hole, frozen puddles on the lane — hooves slide, Bob slips when he hurries.
 * Layout: sty (start, south-east) · yard + barn (south-centre) · chicken pen (south-west) · the frozen pond (west) ·
 * the reindeer paddock (east) · the sledding hill (north-east) · the farmhouse with the decorated tree, the presents
 * and Bob's prize snowman (north) · cage by the porch · woodshed (north-west) · Bob's winter garden (north).
 */
export const FARM5: Rect = { x0: -60, x1: 60, z0: -104, z1: 16 };
const RINK = { x: -34, z: -40, r: 10 };
const HOLE = { x: -25.8, z: -41.6 };
const HILL = { x: 36, z: -70, r: 15, h: 4.4, flat: 3 };
const PADDOCK: Rect = { x0: 34, x1: 54, z0: -48, z1: -28 };
const SNOWMAN = { x: -9, z: -75 };
const TREE = { x: 9, z: -83.5 };
const PUDDLES: [number, number, number][] = [[2, -29, 2.4], [-13, -66.5, 2.2], [24, 1.6, 2.1]];

const CHORES: Chore[] = [
  { id: 'pigs', at: [35.4, 2], look: [38, 2], anim: 'pour', dur: 10, view: 'busy' },
  { id: 'chickens', at: [-20.4, -2], look: [-24, -2], anim: 'feed', dur: 12, view: 'busy' },
  { id: 'grit', at: [3.6, -29], look: [2, -29], anim: 'pour', dur: 10, view: 'busy' },
  { id: 'fish', at: [HOLE.x + 2.3, HOLE.z + 0.4], look: [HOLE.x, HOLE.z], anim: 'lean', dur: 30, view: 'busy' },
  { id: 'snowman', at: [SNOWMAN.x + 1.5, SNOWMAN.z + 1], look: [SNOWMAN.x, SNOWMAN.z], anim: 'fix', dur: 14, view: 'busy' },
  { id: 'reindeer', at: [PADDOCK.x0 - 1, -34], look: [PADDOCK.x0 + 3, -34], anim: 'feed', dur: 16, view: 'busy' },
  { id: 'wood', at: [-20.4, -82.6], look: [-20.4, -84], anim: 'chop', dur: 18, view: 'busy' },
  { id: 'cocoa', at: [TREE.x + 2.6, TREE.z + 3.2], look: [TREE.x, TREE.z], anim: 'coffee', dur: 16, view: 'busy' },
  { id: 'presents', at: [TREE.x - 1.6, TREE.z + 2.4], look: [TREE.x, TREE.z], anim: 'lean', dur: 10, view: 'normal' },
  { id: 'grit', at: [-14.4, -64.5], look: [-13, -66.5], anim: 'pour', dur: 10, view: 'busy' },
  // evening: flashlight round
  { id: 'patrol', at: [20, 0], look: [30, 6], anim: 'look', dur: 5, view: 'flashlight', phase: 'evening' },
  { id: 'patrol', at: [-20, -36], look: [-34, -40], anim: 'look', dur: 5, view: 'flashlight', phase: 'evening' },
  { id: 'patrol', at: [30, -36], look: [44, -38], anim: 'look', dur: 5, view: 'flashlight', phase: 'evening' },
  { id: 'patrol', at: [-6, -70], look: [SNOWMAN.x, SNOWMAN.z], anim: 'look', dur: 5, view: 'flashlight', phase: 'evening' },
  { id: 'patrol', at: [-8, -20], look: [-8, -35], anim: 'look', dur: 5, view: 'flashlight', phase: 'evening' },
  // night
  { id: 'bed', at: [0, -84], look: [0, -88], anim: 'idle', dur: 1, view: 'normal', phase: 'night' },
];

/** Pranks that work here: the shared ones whose places / things exist + the winter farm's own (featured). */
const FEATURED: MissionId[] = ['snowballBob', 'bigSnowball', 'snowmanDown', 'bobIce', 'iceHole', 'bigPresent'];
const MISSIONS: MissionId[] = [...FEATURED, 'knockBob', 'staggerBob', 'fartBob', 'hensOut', 'wolfScare', 'loseBob', 'whackBob', 'eggBob',
  'undiesWell', 'pieSteal', 'gateBreak', 'smashPots', 'cowsOut'];

export function buildFarm5(scene: THREE.Scene): FarmDef {
  const F = FARM5;
  const terrain = new Terrain(F);
  terrain.snow = true;
  // ---- ground (before terrain.build): shovelled paths + yards (no prints there), flat spots for the ice, the hill
  const P = (pts: [number, number][], w = 3) => terrain.path(pts, w);
  P([[0, 22], [0, 2]], 4.5);                                        // road in from the south gate
  P([[0, 2], [2, -20], [3, -44], [1, -66], [0, -80]], 3.4);         // the main lane up to the farmhouse
  P([[0, 1], [20, 2], [36, 2]], 3);                                 // yard → sty
  P([[-2, -2], [-20, -2]], 2.4);                                    // yard → chickens
  P([[2, -38], [-14, -40], [-22, -40]], 2.2);                       // lane → the frozen pond
  P([[3, -36], [PADDOCK.x0 - 1, -36]], 2.2);                        // lane → reindeer paddock
  P([[0, -80], [-18, -84]], 2.2);                                   // porch → woodshed
  P([[2, -58], [22, -62]], 2);                                      // lane → foot of the sledding hill
  P([[1, -86], [14, -96]], 2);                                      // → garden
  terrain.dirt({ x0: -10, x1: 12, z0: -10, z1: 6 }, 3);             // yard
  terrain.dirt({ x0: 37, x1: 50, z0: -4, z1: 8 }, 1.5);             // sty floor
  terrain.dirt({ x0: -34, x1: -22, z0: -8, z1: 4 }, 2);             // chicken run
  terrain.dirt({ x0: -8, x1: 16, z0: -88, z1: -78 }, 2);            // front yard (shovelled)
  terrain.dirt({ x0: -24, x1: -16, z0: -88, z1: -82 }, 1);          // woodshed
  terrain.dirt({ x0: 14, x1: 26, z0: -102, z1: -92 }, 1);           // garden soil
  terrain.flatten(RINK.x, RINK.z, RINK.r + 0.6, 3);
  for (const [x, z, r] of PUDDLES) terrain.flatten(x, z, r + 0.4, 1.5);
  terrain.hill(HILL.x, HILL.z, HILL.r, HILL.h, HILL.flat);

  const build = (t: Terrain, daynight: DayNight): FarmBuild => {
    snowyForest(true);
    BOB_STYLE.winter = true;
    GLB_ANIMALS.dog = HUSKY;
    daynight.winter = true;
    const garden = { x0: 14, x1: 26, z0: -102, z1: -92 };
    const out: FarmBuild = {
      props: [], critters: [], decor: [], spinners: [], updaters: [], statics: [], pigSpawns: [],
      cage: new Cage(scene, V3(16, t.height(16, -78), -78), 0), chores: CHORES,
      farmerSpawn: V3(4, t.height(4, -76), -76),
      zones: { garden: [garden], lawn: { x0: 20, x1: 28, z0: -34, z1: -30 }, door: V3(0, t.height(0, -85), -85), mowerAt: V3(-10.5, t.height(-10.5, 9), 9),
        roadGate: V3(0, t.height(0, 12.5), 12.5) },
      inWater: (x, z) => Math.hypot(x - HOLE.x, z - HOLE.z) < 0.7,
      gates: [],
      places: {
        pond: { x: RINK.x, z: RINK.z, r: RINK.r }, well: { x: -6, z: -58 },
        coop: { x0: -34, x1: -22, z0: -8, z1: 4 }, sheepPen: null, pasture: PADDOCK,
        stash: V3(41.5, t.height(41.5, 1), 1), roadGate: V3(0, t.height(0, 12.5), 12.5), dogPatrol: { x: 0, z: -44, r: 46 },
        tp: [['sty', 40, 1], ['cage', 16, -75], ['house', 0, -80], ['rink', RINK.x + RINK.r + 1.5, RINK.z], ['hole', HOLE.x + 2.6, HOLE.z + 0.6],
          ['snowman', SNOWMAN.x + 2.5, SNOWMAN.z + 2], ['tree', TREE.x - 2, TREE.z + 4], ['sled', HILL.x - 1, HILL.z + 2], ['paddock', PADDOCK.x0 - 2, -38],
          ['woodshed', -20, -80], ['garden', 12, -96]],
      },
      missions: MISSIONS,
      featured: FEATURED,
      noMods: ['rain'],
    };
    const kit = farmKit(scene, t, out, F, 5051);
    const { rng, blocked, y, building, decor, pen, prop, critter } = kit;
    const winter = new Winter(scene, y);
    out.winter = winter;

    // ---------------------------------------------------------------- buildings
    building('village/House_2', 0, -94, 9.5, 0);                         // the farmhouse
    building('farm/BigBarn', 22, -14, 8.5, -Math.PI / 2);
    building('farm/Silo', 53, -12, 11);
    building('farm/ChickenCoop', -31, -3, 3.4, Math.PI / 2);
    building('farm/Well', -6, -58, 3.2);
    building('farm/OpenBarn', -10, 10, 5.5, Math.PI);                     // hay shed by the gate (the mower's parked in it)
    building('farm/OpenBarn', -21, -88.5, 4.2, 0);                        // the woodshed
    building('farm/ChickenCoop', 47.5, 5.4, 2.8, Math.PI);                // the pigs' hut
    blocked.push({ x0: 10, x1: 23, z0: -84, z1: -70 });                   // cage + grill
    blocked.push({ x0: -6, x1: 6, z0: -82, z1: 6 });                      // the main lane

    // ---------------------------------------------------------------- pens & fences
    pen({ x0: 37, x1: 50, z0: -4, z1: 8 }, 'w', 2.6, undefined, 'sty', { lockable: false, start: 'free' });
    pen({ x0: -34, x1: -22, z0: -8, z1: 4 }, 'e', 2.4, undefined, 'chickens');
    pen(garden, 'w', 2.4, undefined, 'garden');
    pen(PADDOCK, 'w', 2.8, undefined, 'pasture');
    kit.outerFence();

    // ---------------------------------------------------------------- ice: the frozen pond + Bob's fishing hole, frozen puddles
    winter.addRink(RINK.x, RINK.z, RINK.r, out.statics);
    for (const [x, z, r] of PUDDLES) winter.addRink(x, z, r, out.statics);
    winter.addHole(HOLE.x, HOLE.z);
    blocked.push({ x0: RINK.x - RINK.r - 2, x1: RINK.x + RINK.r + 2, z0: RINK.z - RINK.r - 2, z1: RINK.z + RINK.r + 2 });
    decor('kenney/stump_round', HOLE.x + 1.4, HOLE.z + 1.1, { height: 0.45, collide: 'box' });   // Bob's fishing stool
    prop('fishBucket', HOLE.x + 1.2, HOLE.z - 0.9, 0.3);
    for (const [x, z] of [[-42, -33], [-37, -49], [-29, -36]] as const) prop('snowball', x, z, 0);   // a few lying on the ice

    // ---------------------------------------------------------------- the farmhouse: decorated tree, presents, the prize snowman
    const d = decorKit({ scene, t, rng, out, daynight, blocked, decor, prop, POND: out.places.pond, F });
    decor('winter/treeDecorated', TREE.x, TREE.z, { height: 5.2, collide: 'trunk' });
    blocked.push({ x0: TREE.x - 3, x1: TREE.x + 3, z0: TREE.z - 3, z1: TREE.z + 3 });
    for (const [k, x, z] of [['present', -1.2, 1.3], ['presentG', 1.3, 1.1], ['presentB', 0.2, 1.7], ['present', 1.5, -0.6], ['presentG', -1.5, -0.4], ['presentB', -0.3, -1.6]] as const)
      prop(k, TREE.x + x, TREE.z + z, rng.range(-0.5, 0.5));
    prop('bigPresent', TREE.x + 2.4, TREE.z + 1.6, 0.2);
    const parts = (['snowBase', 'snowMid', 'snowHead'] as const).map((k) => prop(k, SNOWMAN.x, SNOWMAN.z, 0));
    winter.addSnowman(SNOWMAN.x, SNOWMAN.z, 0.3, parts);
    blocked.push({ x0: SNOWMAN.x - 2.5, x1: SNOWMAN.x + 2.5, z0: SNOWMAN.z - 2.5, z1: SNOWMAN.z + 2.5 });
    decor('kenney/sign', SNOWMAN.x + 1.6, SNOWMAN.z + 1.2, { height: 1.1, yaw: -0.4 });   // "1st prize"
    for (let z = -66; z >= -79; z -= 3.3) for (const s of [-1, 1]) decor('winter/candyCane', s * 2.4, z, { height: 1.05, yaw: s > 0 ? Math.PI : 0 });
    decor('village/Bench_2', -4.5, -84.2, { height: 0.9, yaw: 0, collide: 'box' });
    d.rocker(5.5, -85, 5.5, -80);
    d.laundry(-18, -9, -76);                                             // frozen stiff on the line
    d.mailbox(5.2, 14.2);
    d.lamps([[-3.6, -82], [4, 9], [-4, 14.5], [16.5, -10.5], [35, -5], [-21, -36], [4.4, -48], [-14, -80], [30, -36]]);
    d.outhouse(40, -18, -Math.PI / 2);
    d.trough(34, 6, Math.PI / 2);
    d.trough(PADDOCK.x0 + 2, -42, 0);
    d.scarecrow(22, -96, 0.6);
    d.finish();
    decor('kenney/tractor', 8, -4, { height: 2.6, yaw: 2.4, collide: 'box' });
    decor('kit/Prop_Wagon', -7, 0, { height: 1.8, yaw: 0.3, collide: 'box' });

    // ---------------------------------------------------------------- the sledding hill: sleds, a pile, a snowball at the top
    for (const [x, z, yaw] of [[HILL.x - 1.4, HILL.z + 1.2, -1.2], [HILL.x + 1.2, HILL.z + 1.8, -0.9]] as const) prop('sled', x, z, yaw, 0.1);
    decor('winter/snowFort', 16, -44, { height: 1.3, yaw: 0.4, collide: 'box' });
    decor('winter/snowFort', -12, -54, { height: 1.3, yaw: -2.6, collide: 'box' });
    blocked.push({ x0: 13, x1: 19, z0: -47, z1: -41 }, { x0: -15, x1: -9, z0: -57, z1: -51 });

    // ---------------------------------------------------------------- snowballs: piles to throw from, three to roll up big
    const pile = (x: number, z: number) => {
      const ps = [0, 1, 2, 3].map((i) => { const a = (i / 4) * Math.PI * 2; return prop('snowball', x + Math.cos(a) * 0.32, z + Math.sin(a) * 0.28, 0, 0.12); });
      winter.addPile(x, z, ps, out.statics);
      blocked.push({ x0: x - 1.2, x1: x + 1.2, z0: z - 1.2, z1: z + 1.2 });
    };
    pile(7, -9); pile(-20, -44); pile(-13, -71); pile(HILL.x + 0.6, HILL.z - 0.8); pile(31, 7); pile(12, -40);
    for (const [x, z] of [[HILL.x - 1.6, HILL.z - 1.2], [-16, -22], [24, -50]] as const) winter.addBoulder(prop('snowboulder', x, z, 0));

    // ---------------------------------------------------------------- woodshed + garden
    decor('kenney/log_stackLarge', -23.5, -88, { height: 1.2, yaw: 0, collide: 'box' });
    decor('kenney/stump_round', -20.4, -84.2, { height: 0.5, collide: 'box' });
    for (let i = 0; i < 3; i++) {
      const z = -100 + i * 2.6;
      for (let x = 15; x < 25; x += 2) {
        decor('kenney/crops_dirtRow', x + 1, z, { scale: 2, yaw: Math.PI / 2 });
        const [crop, sc, sink] = ([['crops/Lettuce_4', 1.2, 0.04], ['crops/Beet_4', 1.3, 0.1], ['crops/Carrot_4', 1.5, 0.9]] as const)[i];
        decor(crop, x + 1 + rng.range(-0.15, 0.15), z, { scale: sc, sink, yaw: rng.range(0, 6.28) });
      }
    }

    // ---------------------------------------------------------------- hiding spots (snowy bushes, bales, log piles, crates)
    const ck = coverKit({ scene, t, rng, out, blocked, forest: kit.forest, decor });
    for (const [x, z] of [[-56, 10], [-53, 12.4], [56, -60], [10, -101.5], [56, -2], [57, 1], [-10, -30], [-12.4, -32], [24, -54],
      [-56, -60], [-57, -63], [8, -26], [28, -42], [-2, -100], [-14, -94], [56, -86], [-46, -20], [-50, -70], [12, -66]] as [number, number][]) ck.bush(x, z);
    ck.baleStack(-8, -14, 0.2);
    ck.baleStack(26, -58, 1.1, 2);
    ck.baleStack(-14, -46, 0.4, 2);
    ck.baleStack(32, -2, 1.57);
    ck.hard('cover/Logs', 46, 12, 1.2, 0.2);
    ck.hard('cover/Crate_Big_Stack2', 28, -20, 1.8, 0.3);
    ck.hard('cover/Bags', -18, -18, 0.95, 1);
    ck.hard('cover/WoodLog', -26, -78, 0.9, 0.6);
    ck.hard('cover/Crate_Stack2', 10, 3, 1.5, -0.3);
    ck.hard('cover/MarketStand_2', 8, 12, 2.6, Math.PI);                   // the Christmas-tree stand by the gate

    // ---------------------------------------------------------------- loose props
    for (const [x, z] of [[-6, 4.5], [-4.8, 5.6], [24, -4]] as const) prop('crate', x, z);
    for (const [x, z] of [[27.6, -6.2], [27.8, -10.4], [-38, -6]] as const) prop('barrel', x, z, 0);
    for (const [x, z] of [[-6, -6], [-7.6, -5], [-24, -84], [44, -24], [-40, -10]] as const) prop('hay', x, z);
    prop('pan', 12, -79); prop('shovel', 3.4, -27, 1.2); prop('sword', 25.6, -6, 0.4); prop('axe', -19.6, -84.6, 0.3);
    // valuables: the porch, the woodshed, the barn
    prop('chest', -7.8, -85.6, 0.2); prop('chalice', 1.6, -85.4); prop('necklace', 3.4, -85.6);
    prop('safe', 5.8, -85.0, 0);   // heavy loot: two pigs drag it (or one full of spinach)
    prop('ham', -4.2, -84.2, 0, 0.9); prop('mug', 17, -73.8); prop('candyJar', -5, -84.2, 0.3, 0.9);
    prop('gold', -22.6, -90.2, 0.4); prop('crown', 53, -102, 0.6);
    prop('gasCan', 10, -2); prop('propane', 18.6, -76.6, 0); prop('firstAid', 24, -18); prop('backpack', 25, -16.6);
    prop('veggieCrate', 13, -92); prop('trashcan', 6.6, -79.6, 0);
    prop('bone', 6, -73); prop('bone', -18, 4); prop('bone', 30, -36); prop('bone', -30, -70);
    // pranks: the pie cooling on the bench, undies frozen on the line, a gnome in the garden, eggs by the coop, pots on the porch
    prop('pie', -4.2, -84.2, 0, 0.9);
    prop('undies', -12.4, -77.6, 0.4);
    prop('gnome', 23, -95, 2.2);
    for (const [x, z] of [[-23.2, -6.6], [-23.5, -6.8], [-23.3, -7.0], [-32.4, 2], [-32.1, 2.2]] as const) prop('egg', x, z, rng.range(0, 6));
    for (const [x, z] of [[-1.4, -85.6], [1, -85.6], [5, -84.6], [-6.6, -85.4]] as const) prop('flowerPot', x, z, 0);

    // ---------------------------------------------------------------- animals
    const coop = V3(-31, y(-31, -3), -3);
    for (let i = 0; i < 6; i++) critter('hen', rng.range(-32, -24), rng.range(-6, 2), 4);
    for (let i = 0; i < 3; i++) critter('chick', rng.range(-31, -25), rng.range(-5, 1), 3);
    critter('rooster', -24, -6, 5);
    for (const cr of out.critters) cr.roost = coop;
    critter('dog', 6, -76, 5);
    critter('reindeer', 42, -36, 6); critter('reindeer', 48, -42, 6); critter('doe', 44, -32, 5);
    for (const [x, z] of [[18, -96], [21, -98]] as const) critter('turkey', x, z, 4);
    critter('cat', -8, -80, 5); critter('cat', 40, -90, 6);
    critter('bunny', -20, -30, 6); critter('bunny', 20, -40, 6); critter('bunny', 44, -80, 6);

    // ---------------------------------------------------------------- pigs start in the sty
    out.pigSpawns.push(V3(45, y(45, 0.5) + 0.5, 0.5), V3(40, y(40, 0.5) + 0.5, 0.5), V3(45.4, y(45.4, -2.5) + 0.5, -2.5), V3(41.4, y(41.4, 6.5) + 0.5, 6.5));

    // ---------------------------------------------------------------- snowy trees (Quaternius) with trunks, rocks, stumps
    const pines = ['PineTree_Snow_1', 'PineTree_Snow_2', 'PineTree_Snow_3', 'PineTree_Snow_4'];
    for (const [x, z, h] of [[-56, 4, 9], [-44, -66, 8], [56, -30, 8.5], [56, -100, 9], [-14, -100, 8], [-20, -14, 7], [26, -88, 7.5], [10, -34, 7],
      [54, 12, 8], [-30, 12, 8], [-56, -86, 9], [-44, -98, 8.5], [44, -98, 7], [-54, -34, 8], [16, -64, 7.5], [-30, -62, 7]] as [number, number, number][]) {
      decor('winter/' + rng.pick(pines), x, z, { height: h, yaw: rng.range(0, 6.28), collide: 'trunk' });
      blocked.push({ x0: x - 2.5, x1: x + 2.5, z0: z - 2.5, z1: z + 2.5 });
    }
    for (const [m, x, z, h] of [['CommonTree_Snow_1', -40, -84, 7], ['CommonTree_Snow_2', 30, -100, 7.5], ['BirchTree_Snow_1', -50, 2, 8], ['CommonTree_Dead_Snow_1', 44, -56, 6],
      ['BirchTree_Snow_1', 22, -28, 7.5]] as [string, number, number, number][]) {
      decor('winter/' + m, x, z, { height: h, yaw: rng.range(0, 6.28), collide: 'trunk' });
      blocked.push({ x0: x - 2.5, x1: x + 2.5, z0: z - 2.5, z1: z + 2.5 });
    }

    // ---------------------------------------------------------------- nature (snow-capped hedges / bushes; snowy rocks, stumps, logs)
    kit.hedgeRing();
    kit.surroundings(['pine', 'pine', 'pine', 'oak']);
    kit.scatter({ trees: 3, bushes: 22, small: [['winter/Rock_Snow_1', 7, 0.8, 1.3], ['winter/Rock_Snow_2', 6, 0.5, 0.9], ['winter/Rock_Snow_3', 8, 0.3, 0.6],
      ['winter/TreeStump_Snow', 6, 0.5, 0.7], ['winter/WoodLog_Snow', 4, 0.4, 0.5], ['winter/Bush_Snow_1', 10, 0.6, 0.9], ['winter/Bush_Snow_2', 8, 0.5, 0.8]] });
    return kit.finish();
  };
  return { bounds: FARM5, terrain, build };
}
