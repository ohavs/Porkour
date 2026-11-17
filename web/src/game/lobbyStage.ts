import * as THREE from 'three';
import { world, staticBox, type RAPIER } from '../core/physics';
import { fitted, has } from '../core/assets';
import { Forest, hayBale } from '../world/nature';
import { Prop, PROPS, type PropDef } from '../world/props';
import { makeApple, makeEgg, makePie } from '../world/funProps';
import { toonMat } from '../render/toon';
import { G } from './ctx';
import '../world/snacks';   // the snack props must exist before the lobby's copies of them

/**
 * The lobby (user: "Fortnite style, but the pig can move"): a little farmyard diorama far away from the farm, a fixed
 * camera, the menus around the edges. Your pig (and your party's) walk, jump, fart, grab and throw things inside the
 * part of the stage the screen shows: invisible walls follow the screen edges. Throwables respawn.
 */
export const STAGE = { x: 0, z: 760, y: 0, hour: 16.4, camDist: 4.9, camH: 1.85, lookY: 0.55 };
const C = new THREE.Vector3(STAGE.x, STAGE.y, STAGE.z);
/** Where each seat's pig stands (seat 0 in the middle). */
const SPOTS = [[0, 0.7], [-1.7, -0.1], [1.7, -0.1], [0, -1.3]].map(([x, z]) => new THREE.Vector3(C.x + x, C.y, C.z + z));
/** Screen rectangle (NDC) the pigs stay in: a bit inside the edges, above the bottom bar. */
const NDC = { x: 0.88, near: -0.8, far: 0.1 };

const lobbyDef = (base: PropDef, id: string, extra: Partial<PropDef> = {}): PropDef => ({ ...base, value: 0, id, ...extra });
const BALL_COLS = [0xff4d5e, 0xfff4e6, 0x4fb4ff, 0xffd166, 0x8cf04a, 0xfff4e6];
/** A big light beach ball (6 coloured wedges). */
function makeBeachBall() {
  const g = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12, (i / 6) * Math.PI * 2, Math.PI / 3), toonMat(BALL_COLS[i]));
    m.position.y = 0.3; m.castShadow = true; g.add(m);
  }
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), toonMat(0xffffff)); cap.position.y = 0.6; g.add(cap);
  return g;
}
PROPS.lobbyBall = { make: makeBeachBall, mass: 0.8, shape: 'ball', r: 0.3, sound: 'thud', label: 'item.ball', bounce: 0.75, friction: 0.6, damp: 0.6, id: 'lobbyBall' };
PROPS.lobbyApple = lobbyDef(PROPS.apple, 'lobbyApple', { make: () => makeApple() });
PROPS.lobbyEgg = lobbyDef(PROPS.egg, 'lobbyEgg', { make: makeEgg });
PROPS.lobbyPie = lobbyDef(PROPS.pie, 'lobbyPie', { make: makePie });
PROPS.lobbyCrate = lobbyDef(PROPS.crate, 'lobbyCrate', { height: 0.6, mass: 7 });
PROPS.lobbyBeans = lobbyDef(PROPS.canBeans, 'lobbyBeans');
PROPS.lobbyEnergy = lobbyDef(PROPS.canEnergy, 'lobbyEnergy');
PROPS.lobbyCigs = lobbyDef(PROPS.cigPack, 'lobbyCigs');

const v1 = new THREE.Vector3(), ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -STAGE.y);

export class LobbyStage {
  readonly center = C;
  props: Prop[] = [];
  camPos = new THREE.Vector3(); look = new THREE.Vector3();
  /** Floor corners of the playable area (near left, near right, far right, far left). */
  quad: THREE.Vector3[] = [];
  private walls: RAPIER.RigidBody[] = [];
  private aspect = 0;
  private gone = new Map<Prop, number>();

  constructor(scene: THREE.Scene, props: Prop[]) {
    // ground: a big round lawn with a darker rim, a wooden deck in the middle (the floor is one big static box)
    staticBox(v1.set(C.x, C.y - 0.5, C.z), new THREE.Vector3(30, 0.5, 30), 0, 0.8);
    const lawn = new THREE.Mesh(new THREE.CircleGeometry(60, 64), toonMat(G.snowy ? 0xeef4ff : 0x86c85a));
    lawn.rotation.x = -Math.PI / 2; lawn.position.copy(C); lawn.receiveShadow = true; scene.add(lawn);
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.8, 0.08, 40), toonMat(0xc9935a));
    deck.position.set(C.x, C.y + 0.0, C.z - 0.2); deck.receiveShadow = true; scene.add(deck);
    for (let i = 0; i < 9; i++) {   // plank lines
      const line = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.01, 0.03), toonMat(0x9a6a3c));
      line.position.set(C.x, C.y + 0.045, C.z - 0.2 + (i - 4) * 1.0); line.scale.x = Math.sqrt(Math.max(0.05, 1 - ((i - 4) / 4.7) ** 2)); scene.add(line);
    }
    // backdrop: a barn, a silo, a windmill, fences, hay, trees and bushes, lanterns
    const put = (name: string, x: number, z: number, h: number, ry = 0) => {
      if (!has(name)) return null;
      const o = fitted(name, { height: h }); o.position.set(C.x + x, C.y, C.z + z); o.rotation.y = ry; scene.add(o); return o;
    };
    put('farm/Barn', -6.5, -14, 7.5, 0.35);
    put('farm/Silo', 4.5, -17, 9, 0);
    put('farm/TowerWindmill', 12, -22, 12, -0.4);
    put('kenney/tractor', 8.5, -7.5, 2.4, -0.7);
    put('kenney/cart', -9.5, -5.5, 1.6, 0.9);
    for (let i = -6; i <= 6; i++) put('kenney/fence_simple', i * 1.6, -6.8, 1.0, 0);
    for (const [x, z, r] of [[-6.4, -3.6, 0.2], [-7.3, -4.6, 1.2], [-6.9, -4.1, 0.6]] as const) {
      const h = hayBale(); h.position.set(C.x + x, C.y + 0.55, C.z + z); h.rotation.y = r; scene.add(h);
    }
    const top = hayBale(); top.position.set(C.x - 6.9, C.y + 1.55, C.z - 4.1); top.rotation.y = 0.9; scene.add(top);
    put('kaykit/post_lantern', -4.9, -2.2, 2.2, 0.4); put('kaykit/post_lantern', 4.9, -2.2, 2.2, -0.4);
    for (const [x, z] of [[-3, 2], [3.4, 2.4], [-5.2, 1], [5.6, 0.8], [-1.8, -5.6], [2.3, -5.8]]) put('nature/Flower_3_Group', x, z, 0.35, x);
    put('nature/Mushroom_Common', 6.4, 1.9, 0.4); put('kenney/rock_largeA', -8.2, 1.8, 0.9, 0.5);
    const f = new Forest();
    for (const [k, x, z, s] of [['oak', -14, -12, 1.5], ['pine', -18, -20, 1.6], ['oak', 16, -12, 1.4], ['poplar', 19, -17, 1.3], ['pine', -11, -24, 1.8],
      ['oak', 25, -26, 1.7], ['pine', -26, -16, 1.6], ['bush', -9, -7.5, 1.2], ['bush', 10.5, -5, 1.1], ['flowerBush', -11.5, -2, 1], ['bigBush', 13, -2.5, 1],
      ['oak', -22, -6, 1.5], ['pine', 23, -8, 1.5], ['apple', 7.5, -12.5, 1.2], ['hedge', -2, -9.5, 1], ['hedge', 1.5, -9.5, 1]] as const)
      f.add(k, C.x + x, C.y, C.z + z, s);
    f.finish(scene);
    // throwables (respawn when smashed or lost)
    const things: [string, number, number][] = [['lobbyBall', -2.3, 1.6], ['lobbyApple', 1.2, 1.9], ['lobbyApple', 1.45, 2.1], ['lobbyApple', -1.0, -1.6],
      ['lobbyEgg', 2.6, 0.9], ['lobbyEgg', 2.8, 1.1], ['lobbyPie', -2.9, -0.6], ['lobbyCrate', 3.3, -1.6], ['lobbyBeans', -0.9, 1.9], ['lobbyEnergy', 0.7, -1.9], ['lobbyCigs', -3.4, 0.9]];
    for (const [id, x, z] of things) { const p = new Prop(scene, PROPS[id], v1.set(C.x + x, C.y + 0.05, C.z + z), x * 2); this.props.push(p); props.push(p); }
  }

  /** Seat's standing spot. */
  spot(slot: number) { return SPOTS[slot % SPOTS.length]; }
  /** Is this one of the lobby's throwables? */
  owns(p: Prop) { return this.props.includes(p); }

  /** The fixed camera (pulled back on narrow screens); walls follow the screen edges. */
  placeCamera(cam: THREE.PerspectiveCamera) {
    const back = Math.max(1, 1.45 / Math.max(cam.aspect, 0.4));
    this.camPos.set(C.x, C.y + STAGE.camH * back, C.z + STAGE.camDist * back);
    this.look.set(C.x, C.y + STAGE.lookY, C.z - 0.3);
    cam.position.copy(this.camPos); cam.lookAt(this.look); cam.updateMatrixWorld();
    // online, every machine needs the same walls (the host simulates them): a 16:9 screen's; solo: this screen's
    const asp = G.net === 'solo' ? cam.aspect : 16 / 9 + 1e-3;
    if (Math.abs(asp - this.aspect) > 0.01) {
      this.aspect = asp;
      if (G.net === 'solo') this.buildWalls(cam);
      else { const ref = new THREE.PerspectiveCamera(cam.fov, 16 / 9, 0.1, 100); ref.position.copy(this.camPos); ref.lookAt(this.look); ref.updateMatrixWorld(); this.buildWalls(ref); }
    }
  }
  /** Where a screen point (NDC) meets the stage floor. */
  floorAt(cam: THREE.Camera, nx: number, ny: number, out = new THREE.Vector3()) {
    ray.setFromCamera(new THREE.Vector2(nx, ny), cam);
    return ray.ray.intersectPlane(plane, out) ?? out.copy(C);
  }
  private buildWalls(cam: THREE.Camera) {
    for (const w of this.walls) world.removeRigidBody(w);
    this.walls = [];
    this.quad = [[-NDC.x, NDC.near], [NDC.x, NDC.near], [NDC.x, NDC.far], [-NDC.x, NDC.far]].map(([x, y]) => this.floorAt(cam, x, y));
    for (let i = 0; i < 4; i++) {
      const a = this.quad[i], b = this.quad[(i + 1) % 4];
      const mid = v1.copy(a).add(b).multiplyScalar(0.5), len = a.distanceTo(b);
      const nx = b.z - a.z, nz = -(b.x - a.x), nl = Math.hypot(nx, nz);   // inward normal: the wall sits half a metre outside the edge
      mid.x -= (nx / nl) * 0.5; mid.z -= (nz / nl) * 0.5; mid.y = C.y + 10;
      this.walls.push(staticBox(mid, new THREE.Vector3(len / 2 + 1, 10, 0.5), Math.atan2(b.x - a.x, b.z - a.z) - Math.PI / 2));
    }
  }
  /** Inside the playable area (with a margin)? */
  inside(p: { x: number; z: number }, margin = 0) {
    const q = this.quad; if (q.length < 4) return true;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      const cross = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
      if (cross > margin * Math.hypot(b.x - a.x, b.z - a.z)) return false;
    }
    return true;
  }

  /** Host / solo, every fixed step: pigs and throwables that got out (or smashed) come back. */
  step(pigs: { pos: THREE.Vector3; out: boolean; absent: boolean; heldBy: unknown; respawn(): void }[]) {
    for (const p of pigs) if (!p.out && !p.absent && !p.heldBy && (p.pos.y < C.y - 3 || !this.inside(p.pos, 1.5))) p.respawn();
    for (const p of this.props) {
      if (p.heldBy) continue;
      if (p.banked || (p.def.servings && p.left === 0)) {   // smashed / eaten: a new one after a moment
        const t = this.gone.get(p);
        if (t === undefined) this.gone.set(p, G.time);
        else if (G.time - t > (p.banked ? 2.5 : 6)) { this.gone.delete(p); p.reset(); }
        continue;
      }
      const at = p.synced.currP;
      if (at.y < C.y - 3 || !this.inside(at, 2)) p.reset();
    }
  }
}
