import * as THREE from 'three';
import { has } from '../core/assets';
import { staticBox } from '../core/physics';
import { V3, type Rng } from '../core/util';
import { toonMat } from '../render/toon';
import { G } from '../game/ctx';
import type { Terrain, Rect } from './terrain';
import type { FarmBuild } from './farm1';
import type { Forest } from './nature';

/** Quaternius CC0 models used as hiding spots (tools/fetch_assets.sh → public/assets/cover). */
export const COVER_MODELS = ['Hay', 'Bags', 'MarketStand_1', 'MarketStand_2', 'WoodLog',
  'Crate_Big_Stack2', 'Crate_Stack2', 'Crate_Stack1', 'Logs'].map((n) => 'cover/' + n);

interface Ctx {
  scene: THREE.Scene; t: Terrain; rng: Rng; out: FarmBuild; blocked: Rect[]; forest: Forest;
  decor: (model: string, x: number, z: number, o?: { height?: number; scale?: number; yaw?: number; collide?: 'box' | 'trunk' | false; sink?: number }) => THREE.Object3D | null;
}

/** Straw bale (shared geometry / materials → instanced with everything else). */
const BALE = new THREE.BoxGeometry(1.25, 0.58, 0.62);
const BAND = new THREE.BoxGeometry(0.06, 0.6, 0.64);
const STRAW = toonMat(0xe9c46a), STRAW2 = toonMat(0xdcb458), TWINE = toonMat(0xa8742e);

/**
 * Places to hide from Bob (the farm stays the same size, the open lawns get broken up):
 * soft cover (big bushes, a wheat field, a second corn patch — walk in, Bob can't see in, moving fast rustles) and
 * hard cover (straw-bale stacks you can climb, log piles, crate stacks, sack piles, a fallen log, farm stands).
 * Soft cover goes into `G.cover` (Bob's eyes), hard cover has colliders (they block his sight ray already).
 */
export function buildHideouts(c: Ctx) {
  const { scene, t, rng, out, blocked, forest, decor } = c;
  const y = (x: number, z: number) => t.height(x, z);
  const block = (x: number, z: number, r: number) => blocked.push({ x0: x - r, x1: x + r, z0: z - r, z1: z + r });

  // ---------------------------------------------------------------- big hiding bushes (clusters)
  const bush = (x: number, z: number, s = rng.range(0.95, 1.15)) => {
    forest.add('bigBush', x, y(x, z), z, s);
    G.cover.circle('bush', x, z, 1.45 * s, y(x, z), 1.55 * s);
    t.noGrass({ x0: x - 1.2 * s, x1: x + 1.2 * s, z0: z - 1.2 * s, z1: z + 1.2 * s });
    block(x, z, 2);
  };
  const clusters: [number, number][][] = [
    [[4, -22], [6.6, -24.2], [3.2, -25.4]],                 // meadow between the barn and the house
    [[-50, -13], [-52.6, -11], [-49.4, -9.6]],              // west, by the water tower
    [[56, 6.5], [58.4, 9.2], [55, 10.8]],                   // east, past the pond
    [[-57, 0], [-58.6, 3.2], [-55.2, 4]],                   // south-west corner
    [[-18, -56], [-20.4, -58.4], [-16.6, -59.2]],           // between the well and the garden
    [[49, -95], [51.6, -93.4]],                             // north-east, behind the hay shed
    [[37, -41], [39.6, -43.2]],                             // by the windmill path
    [[-30, -74], [-27.6, -77], [-32.8, -76.6]],             // north-west, by the old barn
    [[16.5, 15.5], [19, 13.2]],                             // by the road, near the sty
    [[-5, -88], [-2.6, -90.4]],                             // behind the orchard
    [[58, -60], [57.4, -63]],                               // east of the pasture
    [[-58, -66], [-56, -70]],                               // west, past the garden
  ];
  for (const cl of clusters) for (const [x, z] of cl) bush(x, z);

  // ---------------------------------------------------------------- wheat field (east) with sheaves
  const wheat = { x0: 36, x1: 57, z0: -29, z1: -15 };
  for (let x = wheat.x0 + 0.5; x < wheat.x1; x += 1.05) for (let z = wheat.z0 + 0.5; z < wheat.z1; z += 1.05) {
    const wx = x + rng.range(-0.25, 0.25), wz = z + rng.range(-0.25, 0.25);
    decor('kenney/crops_wheatStageB', wx, wz, { height: rng.range(1.15, 1.35), yaw: rng.range(0, 6.28) });
  }
  t.noGrass(wheat); blocked.push({ x0: wheat.x0 - 1, x1: wheat.x1 + 1, z0: wheat.z0 - 1, z1: wheat.z1 + 1 });
  G.cover.rect('crop', wheat.x0, wheat.x1, wheat.z0, wheat.z1, y((wheat.x0 + wheat.x1) / 2, (wheat.z0 + wheat.z1) / 2) - 0.3, 1.45);
  for (const [x, z] of [[38.5, -13.5], [44, -13.2], [52, -13.6], [55.5, -30.4], [47, -30.6]] as const)
    decor('cover/Hay', x, z, { height: 1.2, yaw: rng.range(0, 6.28) });

  // ---------------------------------------------------------------- second corn patch (between the well and the orchard)
  const corn = { x0: 3, x1: 14, z0: -67, z1: -60 };
  for (let x = corn.x0 + 0.6; x < corn.x1; x += 1.5) for (let z = corn.z0 + 0.6; z < corn.z1; z += 1.5)
    decor('kenney/crops_cornStageD', x + rng.range(-0.2, 0.2), z + rng.range(-0.2, 0.2), { scale: 2.6, yaw: rng.range(0, 6) });
  t.noGrass(corn); blocked.push({ x0: corn.x0 - 1, x1: corn.x1 + 1, z0: corn.z0 - 1, z1: corn.z1 + 1 });
  G.cover.rect('crop', corn.x0, corn.x1, corn.z0, corn.z1, y(8.5, -63.5) - 0.3, 2.3);
  // the big corn field in the north-west corner (built in farm1) hides pigs too
  G.cover.rect('crop', -60.5, -35.5, -104.5, -93.5, y(-48, -99) - 0.3, 2.3);

  // ---------------------------------------------------------------- straw-bale stacks (climbable: 3 / 2 / 1)
  const baleStack = (x: number, z: number, yaw: number, rows = 3) => {
    const g = new THREE.Group(); g.position.set(x, y(x, z) - 0.04, z); g.rotation.y = yaw; scene.add(g); out.statics.push(g);
    for (let r = 0; r < rows; r++) {
      const n = rows - r;
      for (let i = 0; i < n; i++) {
        const bx = (i - (n - 1) / 2) * 1.27, by = 0.29 + r * 0.58;
        for (const dz of r === 0 ? [-0.32, 0.32] : [0]) {
          const m = new THREE.Mesh(BALE, (i + r) % 2 ? STRAW : STRAW2); m.position.set(bx, by, dz); m.castShadow = m.receiveShadow = true; g.add(m);
          for (const s of [-0.32, 0.32]) { const b = new THREE.Mesh(BAND, TWINE); b.position.set(bx + s, by, dz); g.add(b); }
        }
      }
      staticBox(V3(x, y(x, z) + 0.29 + r * 0.58, z), V3(n * 0.635, 0.29, r === 0 ? 0.63 : 0.31), yaw);
    }
    t.noGrass({ x0: x - 2.4, x1: x + 2.4, z0: z - 2.4, z1: z + 2.4 });
    block(x, z, 3);
  };
  baleStack(30.5, -94, 0.2);            // by the hay shed
  baleStack(10.5, -33, -0.4);           // meadow south of the chicken pen
  baleStack(-21.5, -8.5, 1.3, 2);       // between the lawn and the yard
  baleStack(58, -44, 1.57);             // east, by the windmill
  baleStack(-8, -60, 0.9, 2);           // west of the well

  // ---------------------------------------------------------------- log piles, crate stacks, sacks, fallen log
  const hard = (model: string, x: number, z: number, h: number, yaw = rng.range(0, 6.28)) => {
    if (!has(model)) return;
    decor(model, x, z, { height: h, yaw, collide: 'box' });
    t.noGrass({ x0: x - 1.6, x1: x + 1.6, z0: z - 1.6, z1: z + 1.6 });
    block(x, z, 2.2);
  };
  hard('cover/Logs', -55.5, -60, 1.3, 0.3);
  hard('cover/Logs', 22, -40, 1.2, 1.4);
  hard('cover/Crate_Stack1', -8.5, -80.5, 1.5, 0.2);
  hard('cover/Crate_Stack2', -10, -78.6, 1.5, -0.3);
  hard('cover/Crate_Big_Stack2', 44.5, -87, 1.8, 0.1);
  hard('cover/Crate_Stack1', -47.5, 6.5, 1.5, 0.5);
  hard('cover/Bags', 13.5, -28, 0.95, 0.4);
  hard('cover/Bags', -36, -14, 0.95, 2.2);
  hard('cover/Bags', 43.5, -78.6, 0.9, 1);
  hard('cover/WoodLog', -1.5, -94, 0.9, 1.2);
  hard('cover/WoodLog', 30, -44.5, 0.9, 0.2);
  // farm stands by the gate and the pond (decor + something to duck behind)
  hard('cover/MarketStand_1', -9, 15, 2.6, 0);
  hard('cover/MarketStand_2', 42, 12, 2.4, Math.PI);
}
