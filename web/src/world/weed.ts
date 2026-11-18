import * as THREE from 'three';
import { G } from '../game/ctx';
import type { Pig } from '../pig/pig';
import type { Prop } from './props';
import { IC, type IconId } from '../game/icons';
import type { Rect } from './terrain';
import type { Kit } from './farmKit';
import { Chain, buildShed, buildBeam, need, fillable, Pump } from './chain';
import { plantGeometry, plantMaterial, makeSpoon } from './chainProps';
import { HANDS, crank, lever, slider, type Socket, type Handle } from './hands';
import { staticBox, staticCylinder, RAPIER } from '../core/physics';
import { Wheelbarrow } from './barrow';
import { fitted } from '../core/assets';
import { toonMat } from '../render/toon';
import { V3, clamp } from '../core/util';

/**
 * Farm 6 — Bob's cannabis farm (user: "seeds, water to speed it up, harvest, wheelbarrow, the shed's grinding machine,
 * rolling papers + a filter + a lighter, bongs, cookies in the oven"; then: "no mini-games — the pig physically takes the
 * filter, the paper, puts the filter on the paper, pours the weed in and rolls it"). Everything is done with the hooves
 * (world/hands.ts: aim with the mouse, R tips what you hold, things snap where they go):
 *   field: tip the watering can over a plant (refill: park it under the pump and pump the handle, or dip it in the
 *     pond), tip the seed bag over an empty mound, harvest ripe plants with the sickle (click) or by hitting them
 *   → buds → the wheelbarrow (a real one, world/barrow.ts: toss them in, push it by the handles, stand + R = tip it)
 *   → dump them on the grate beside the grinder: a belt carries them up into the hopper
 *   → the grinder: drop buds in the hopper, take the crank and turn it (circle the mouse; too fast = it jams, loud)
 *     → ground weed fills the bag under the chute
 *   → the rolling table: take a paper from the booklet, put it on the mat (it clicks in), a filter from the box onto
 *     its end, tip the bag over the paper (not too little, not too much), take the paper's edge and push it away to
 *     roll it, click to lick it shut → a joint → light it (strike the lighter, bring the flame to its tip — a friend
 *     can hold the flame, or lay the joint in the ashtray), click = a puff
 *   → the bong: pour water in (the can), tip a pinch into the bowl, light the bowl, put your snout on the mouthpiece:
 *     the chamber fills with smoke — pull away in time (too long = a coughing fit Bob hears)
 *   → the stove: butter in the pot (drop it in), pour weed in, take the spoon and stir (don't stop: it burns, the
 *     smoke alarm goes off) → magic butter → tip the pot over the mixing bowl, pour flour in, stir → dough → tip the
 *     bowl over a baking tray → open the oven door (pull the handle down), slide the tray in, shut it, take it out
 *     golden (too late = burnt + the alarm) → cookies (kick in late, hit hard).
 * Everything made = points (the round's quota line). Then the high challenges (world/chain.ts).
 */
export const WEED = {
  dry: 1 / 55, grow: 1 / 62, water: 0.34, drown: 1.05, seed: 0.3, bakeMin: 22, bakeMax: 34, alarm: 38, jointBuzz: 0.14, cookieBuzz: 0.45,
  potTurns: 6, bowlTurns: 5, burnAfter: 9, jam: 7.5, bagMax: 4, paperMin: 0.6, paperGood: [0.85, 1.3] as const,
};
const POINTS: Record<string, number> = { bud: 5, weedUnit: 6, joint: 40, bong: 40, magic: 40, cookies: 120 };

interface Plant { x: number; z: number; y: number; g: number; w: number; seed: number; root: THREE.Group; stages: THREE.Mesh[]; puddle: THREE.Mesh; drop: THREE.Sprite; star: THREE.Sprite }

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const flat = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const TWO_PI = Math.PI * 2;

function iconSprite(draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  draw(c.getContext('2d')!);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.setScalar(0.45); s.renderOrder = 10; s.visible = false;
  return s;
}
const dropTex = (g: CanvasRenderingContext2D) => { g.beginPath(); g.moveTo(32, 6); g.bezierCurveTo(52, 30, 52, 56, 32, 58); g.bezierCurveTo(12, 56, 12, 30, 32, 6); g.fillStyle = '#4fb3ff'; g.fill(); g.lineWidth = 5; g.strokeStyle = '#3b2412'; g.stroke(); };
const starTex = (g: CanvasRenderingContext2D) => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 12 : 28; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); } g.closePath(); g.fillStyle = '#ffd166'; g.fill(); g.lineWidth = 4; g.strokeStyle = '#3b2412'; g.stroke(); };
/** A mesh's own material (recoloured live), so the shared toon colour isn't changed everywhere. */
const ownMat = (o: THREE.Object3D | undefined) => { const m = o as THREE.Mesh | undefined; if (m?.isMesh) m.material = (m.material as THREE.Material).clone(); return m ?? null; };

export class Weed extends Chain {
  kind = 1 as const;
  plants: Plant[] = [];
  /** The wheelbarrow (world/barrow.ts: a real wheel, a hollow tray); `cargo` = buds lying in it now (host counts, synced). */
  barrow!: Prop; cart!: Wheelbarrow; cargo = 0;
  /** Buds riding the intake belt up into the hopper (host). */
  private belt: { pr: Prop; t: number; from: THREE.Vector3 }[] = [];
  private beltA = new THREE.Vector3(); private beltB = new THREE.Vector3(); private intake = new THREE.Vector3();
  private slats: THREE.Object3D[] = []; private beltRun = 0; private beltOff = 0;
  pump: Pump;
  // grinder
  buds = 0; private grindProg = 0; private crankSpd = 0; private jamUntil = 0; private overT = 0;
  private grindCrank!: Handle; private bagSock!: Socket; private wheel!: THREE.Object3D; private hopper = new THREE.Vector3(); private chute = new THREE.Vector3();
  // rolling table
  private paperSock!: Socket; private filterSock!: Socket; private rollH!: Handle; fill = 0;
  paperIn = false; filterIn = false; private matC = new THREE.Vector3(); private papersAt = new THREE.Vector3(); private filtersAt = new THREE.Vector3();
  /** Joints (pool order): sealed (licked shut), lit until; lighters: flame until. */
  private joints: Prop[] = []; private sealed: boolean[] = []; private lit: number[] = []; private lighters: Prop[] = []; private flame: number[] = [];
  // bong
  bongWater = 0; bongPacked = 0; bowlLit = 0; chamber = 0; private inhaler: Pig | null = null;
  private bongTop = new THREE.Vector3(); private bongBowl = new THREE.Vector3(); private bongWaterM!: THREE.Mesh; private smokeM!: THREE.Mesh; private bowlEmber!: THREE.MeshToonMaterial;
  // stove: the pot + the spoon
  pot!: Prop; potButter = 0; potWeed = 0; potCook = 0; potBurn = 0; private lastStir = -10; private burner!: Socket; private potStir!: Handle; private potSpoon!: THREE.Object3D;
  potOn = false;
  // the mixing bowl
  bowl!: Prop; bowlMagic = 0; bowlFlour = 0; bowlMix = 0; private counter!: Socket; private bowlStir!: Handle; private bowlSpoon!: THREE.Object3D; bowlOn = false;
  private trays: Prop[] = []; private trayDough = new Map<Prop, number>(); private traySock!: Socket;
  // oven
  private ovenDoor!: Handle; private ovenSock!: Socket; bakeT = 0; private alarmAt = 0; trayIn = false;
  private door!: THREE.Group; private ovenGlow!: THREE.MeshToonMaterial; private ovenRing!: THREE.Mesh; private ovenMark = new THREE.Vector3();
  // fridge
  private fridgeAt = 0; private fridgeDoor!: THREE.Object3D;
  private fieldC = new THREE.Vector3();
  beamSpot = new THREE.Vector3();
  private shedQ = new THREE.Quaternion();
  private L!: (x: number, y: number, z: number) => THREE.Vector3;
  private fwd = new THREE.Vector3(); private right = new THREE.Vector3();

  constructor(scene: THREE.Scene, props: Prop[], kit: Kit, o: { field: Rect; shed: [number, number, number]; pump: [number, number]; beam: [THREE.Vector3, THREE.Vector3]; barrow: [number, number] }) {
    super(scene, props);
    this.buildField(kit, o.field);
    // pools first (stations hand these out / swap into them)
    this.pool('bud', 30); this.joints = this.pool('joint', 4); this.lit = this.joints.map(() => 0); this.sealed = this.joints.map(() => false);
    this.pool('weedBag', 4); this.pool('butter', 3); this.pool('paper', 4); this.pool('filter', 4);
    this.pool('trayRaw', 2); this.pool('cookies', 2); this.pool('cookiesBurnt', 2);
    this.buildShedStations(kit, o.shed);
    // the hand pump by the field (fill the watering cans)
    const [px, pz] = o.pump;
    this.pump = new Pump(kit, scene, px, pz, 0);
    // the beam over the pond (high challenge)
    this.beamSpot.copy(o.beam[0]);
    buildBeam(kit, scene, o.beam[0], o.beam[1], 2.4, this.beams);
    const P = (kind: string, x: number, z: number, lift = 0, yaw = 0) => kit.prop(kind as never, x, z, yaw, lift);
    this.barrow = P('wheelbarrow', o.barrow[0], o.barrow[1]);
    this.cart = new Wheelbarrow(this.barrow);
    P('wateringCan', px + 1.4, pz - 0.6); P('wateringCan', o.field.x1 - 1.2, o.field.z1 + 1.6);
    P('sickle', px - 1, pz + 0.6); P('sickle', this.L(-1.2, 0, 1.6).x, this.L(-1.2, 0, 1.6).z);
    fillable(this.props, 'can', 'water', 6);
    // things you can't take right now: a paper with its filter on (take the edge and roll it instead), the filter
    // once rolling started, a tray behind the shut oven door
    const atSock = (pr: Prop, sk: Socket) => pr.synced.currP.distanceTo(sk.p) < 0.06;
    for (const pr of this.props) {
      const it = pr.def.item ?? '';
      if (it === 'paper') pr.noGrab = () => this.filterIn && atSock(pr, this.paperSock);
      else if (it === 'filter') pr.noGrab = () => this.rollH.v > 0 && atSock(pr, this.filterSock);
      else if (['tray', 'trayRaw', 'cookies', 'cookiesBurnt'].includes(it)) pr.noGrab = () => this.ovenDoor.v < 1.1 && atSock(pr, this.ovenSock);
    }
    // hits on ripe plants harvest them (headbutt / punch / weapon whack)
    G.hittables.push({ hit: (hx, _hy, hz, reach, dir, _k, by) => this.hitPlant(hx, hz, reach, dir, by as Pig) });
  }

  // ------------------------------------------------------------------ build
  private buildField(kit: Kit, f: Rect) {
    const geos = [0, 1, 2, 3].map((s) => plantGeometry(s as 0 | 1 | 2 | 3)), mat = plantMaterial();
    const soil = toonMat(0x5a3518), pud = toonMat(0x4fb3ff, { transparent: true, opacity: 0.55 });
    const cols = 5, rows = 3, dx = (f.x1 - f.x0) / cols, dz = (f.z1 - f.z0) / rows;
    this.fieldC.set((f.x0 + f.x1) / 2, kit.y((f.x0 + f.x1) / 2, (f.z0 + f.z1) / 2), (f.z0 + f.z1) / 2);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = f.x0 + dx * (c + 0.5), z = f.z0 + dz * (r + 0.5), y = kit.y(x, z);
      const root = new THREE.Group(); root.position.set(x, y, z); root.rotation.y = (r * 5 + c) * 1.3; this.scene.add(root);
      const mound = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.18, 12), soil); mound.position.y = 0.06; mound.receiveShadow = true; root.add(mound);
      const stages = geos.map((g) => { const m = new THREE.Mesh(g, mat); m.castShadow = true; m.position.y = 0.12; m.visible = false; root.add(m); return m; });
      const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.75, 16), pud); puddle.rotation.x = -Math.PI / 2; puddle.position.y = 0.16; puddle.visible = false; root.add(puddle);
      const drop = iconSprite(dropTex), star = iconSprite(starTex);
      drop.position.set(x, y + 1.7, z); star.position.set(x, y + 1.9, z); this.scene.add(drop, star);
      const pl: Plant = { x, z, y, g: (r * cols + c) % 4 === 3 ? 0 : 0.15 + ((r + c) % 3) * 0.1, w: 0.3, seed: 0, root, stages, puddle, drop, star };
      this.plants.push(pl);
      kit.blocked.push({ x0: x - 0.7, x1: x + 0.7, z0: z - 0.7, z1: z + 0.7 });
      // tip the watering can over it / the seed bag over an empty mound
      HANDS.receiver({
        r: 0.7, at: (out) => out.set(pl.x, pl.y + 0.25, pl.z),
        accepts: (s) => s === 'water' || (s === 'seed' && pl.g <= 0.001),
        fill: (s, a) => {
          if (s === 'water') { pl.w = Math.min(1.3, pl.w + a * WEED.water); if (pl.w > WEED.drown && Math.random() < 0.1) G.audio.play('splash', { pos: v1.set(pl.x, pl.y, pl.z), vol: 0.4 }); }
          else if ((pl.seed += a) >= WEED.seed) { pl.seed = 0; pl.g = 0.02; pl.w = Math.max(pl.w, 0.2); G.audio.play('mudstep', { pos: v1.set(pl.x, pl.y, pl.z), vol: 0.6 }); }
        },
      });
    }
    G.terrain.noGrass({ x0: f.x0, x1: f.x1, z0: f.z0, z1: f.z1 });
  }

  private buildShedStations(kit: Kit, [cx, cz, yaw]: [number, number, number]) {
    const scene = this.scene;
    const sh = buildShed(kit, scene, cx, cz, yaw);
    this.shedAt.set(cx, sh.y0, cz); this.shedR = 5.2; this.shedRoof = sh.roof;
    this.shedQ.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    this.fwd.set(Math.sin(yaw), 0, Math.cos(yaw)); this.right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const L = this.L = (x: number, y: number, z: number) => sh.place(x, z).setY(sh.y0 + y);
    const qs = this.shedQ;
    /**
     * A model on the shed floor; returns it + its size (before turning it). `wd` = [width, depth] to squash it to
     * (KayKit's kitchen pieces are 2-tile blocks: a stove 1.9 m deep — the pot would be out of reach).
     */
    const deco = (model: string, lx: number, lz: number, h: number, ry = 0, collide = true, wd?: [number, number]) => {
      const p = L(lx, 0, lz), o = fitted(model, { height: h }), size = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
      if (wd) { o.scale.x *= wd[0] / size.x; o.scale.z *= wd[1] / size.z; size.x = wd[0]; size.z = wd[1]; }
      o.position.copy(p); o.rotation.y = yaw + ry; scene.add(o);
      if (collide) staticBox(V3(p.x, p.y + size.y / 2, p.z), V3(size.x / 2 * 0.9, size.y / 2, size.z / 2 * 0.9), yaw + ry);
      return { o, size };
    };
    // ---- back wall (local z = -3.5): fridge · stove · oven · counter · the grinder · the bong
    // a row of kitchen pieces 0.7 m deep against the back wall (fronts at FZ), worktops at TOP
    const BZ = -3.1, FZ = BZ + 0.35, TOP = 0.95;
    const fr = deco('kaykit/fridge_A', -4.75, BZ, 2.0, 0, true, [0.9, 0.7]);
    deco('kaykit/stove_single', -3.75, BZ, TOP, 0, true, [0.85, 0.7]);
    const ov = deco('kaykit/oven', -2.85, BZ, TOP, 0, false, [0.85, 0.7]);
    // its collider is hollow: a cavity behind the door the tray slides into (base, roof, back, sides)
    const ob = (lx: number, ly: number, lz: number, hx: number, hy: number, hz: number) => { const c = L(lx, ly, lz); staticBox(c, V3(hx, hy, hz), yaw); };
    ob(-2.85, 0.1, BZ, 0.42, 0.1, 0.35); ob(-2.85, 0.86, BZ, 0.42, 0.09, 0.35); ob(-2.85, 0.48, BZ - 0.3, 0.42, 0.3, 0.05);
    ob(-2.85 - 0.37, 0.48, BZ, 0.05, 0.3, 0.35); ob(-2.85 + 0.37, 0.48, BZ, 0.05, 0.3, 0.35);
    deco('kaykit/kitchencounter_straight_A', -1.55, BZ, TOP, 0, true, [1.6, 0.7]);
    deco('kaykit/shelf_papertowel_decorated', -1.55, -3.35, 0.5, 0, false).o.position.y += 1.6;
    const P = (kind: string, p: THREE.Vector3, ry = 0) => kit.prop(kind as never, p.x, p.z, yaw + ry, p.y - kit.y(p.x, p.z));

    // ---- the fridge: open it (RMB at the door) → a block of butter (every 15 s)
    const door = new THREE.Mesh(new THREE.BoxGeometry(fr.size.x * 0.92, 1.2, 0.05), toonMat(0xf2f4f6));
    const dg = new THREE.Group(); dg.position.copy(L(-4.75 - fr.size.x * 0.46, 0.75, FZ + 0.03)); dg.rotation.y = yaw; scene.add(dg);
    door.position.set(fr.size.x * 0.46, 0.6, 0); dg.add(door);
    const knobF = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.04), toonMat(0xaab3bd)); knobF.position.set(fr.size.x * 0.82, 0.6, 0.05); dg.add(knobF);
    this.fridgeDoor = dg;
    HANDS.dispenser({
      at: L(-4.75 + fr.size.x * 0.36, 1.25, FZ + 0.08), r: 0.25, icon: 'butter',
      ready: () => G.time > this.fridgeAt,
      take: (p, at) => {
        this.fridgeAt = G.time + 15;
        G.audio.play('creak', { pos: p.pos, vol: 0.6, pitch: 1.4 });
        return this.spawn('butter', at.clone().setY(at.y - 0.05), yaw);
      },
    });
    this.spot({ at: L(-4.75, 0, -2.0), r: 1.0, markPos: L(-4.75, 2.4, BZ), needs: () => '' });

    // ---- the stove: the pot on the burner (butter in, weed in, stir — don't stop or it burns)
    const potHome = L(-3.75, TOP + 0.01, BZ + 0.1);
    this.pot = P('cookPot', potHome);
    ownMat(this.pot.obj.getObjectByName('fill'));
    this.burner = HANDS.socket({ icon: 'fire', p: potHome.clone().setY(potHome.y + this.pot.half), q: qs, on: null, r: 0.4, dock: true, anyYaw: true,
      accepts: (it) => it === this.pot && !this.potOn });
    HANDS.dock(this.burner, this.pot);
    // butter: drop it in (a bin on the pot); weed: tip the bag over it
    HANDS.socket({ icon: 'butter', on: { body: this.pot.body, lp: V3(0, 0.16, 0), lq: new THREE.Quaternion() }, r: 0.24, dock: false, bin: true,
      accepts: (it) => it.def.item === 'butter' && !this.potButter && this.potCook < 1,
      onSnap: (it) => { this.consume(it); this.potButter = 1; G.audio.play('sizzle', { pos: this.pot.synced.currP, vol: 0.6 }); } });
    HANDS.receiver({ r: 0.17, at: (out) => { const t = this.pot.body.translation(); return out.set(t.x, t.y + this.pot.half, t.z); },
      accepts: (s) => s === 'weed' && this.potWeed < 1 && this.potCook < 1 && !this.pot.banked,
      fill: (_s, a) => { this.potWeed = Math.min(1, this.potWeed + a); G.audio.play('sizzle', { pos: this.pot.synced.currP, vol: 0.4, minGap: 0.4 }); } });
    const potFrame = () => ({ p: this.pot.synced.currP, q: new THREE.Quaternion() });
    this.potStir = crank({ c: V3(0, 0.08, 0), axis: V3(0, 1, 0), r: 0.08, icon: 'stir', max: 9, frame: potFrame,
      ready: () => this.potOn && this.potButter > 0 && this.potWeed >= 0.6 && this.potCook < 1,
      turn: (d) => { this.potCook = Math.min(1, this.potCook + Math.abs(d) / TWO_PI / WEED.potTurns); this.lastStir = G.time; this.potBurn = Math.max(0, this.potBurn - Math.abs(d) * 0.5); G.audio.play('sizzle', { pos: this.pot.synced.currP, vol: 0.35, minGap: 0.5 }); } });
    this.potSpoon = makeSpoon(); this.potSpoon.visible = false; scene.add(this.potSpoon);
    this.pot.pourNow = () => (this.potCook >= 1 && this.pot.left > 0 ? { stuff: 'magic', color: 0x9fbf4a } : null);
    this.spot({ at: L(-3.75, 0, -2.0), r: 0.9, markPos: L(-3.75, 1.9, BZ), needs: () => need('butter', this.potButter) + need('leaf', this.potWeed >= 0.6 ? 1 : 0) + need('stir', this.potCook >= 1 ? 1 : 0) });

    // ---- the counter: the mixing bowl (magic butter + flour, stir → dough), baking trays
    const bowlHome = L(-1.95, TOP + 0.01, BZ + 0.1);
    this.bowl = P('mixBowl', bowlHome);
    ownMat(this.bowl.obj.getObjectByName('fill'));
    this.counter = HANDS.socket({ icon: 'bowl', p: bowlHome.clone().setY(bowlHome.y + this.bowl.half), q: qs, on: null, r: 0.4, dock: true, anyYaw: true,
      accepts: (it) => it === this.bowl && !this.bowlOn });
    HANDS.dock(this.counter, this.bowl);
    HANDS.receiver({ r: 0.2, at: (out) => { const t = this.bowl.body.translation(); return out.set(t.x, t.y + this.bowl.half, t.z); },
      accepts: (s) => ((s === 'magic' && this.bowlMagic < 1) || (s === 'flour' && this.bowlFlour < 1)) && this.bowlMix < 1 && !this.bowl.banked,
      fill: (s, a) => { if (s === 'magic') this.bowlMagic = Math.min(1, this.bowlMagic + a); else this.bowlFlour = Math.min(1, this.bowlFlour + a); } });
    const bowlFrame = () => ({ p: this.bowl.synced.currP, q: new THREE.Quaternion() });
    this.bowlStir = crank({ c: V3(0, 0.06, 0), axis: V3(0, 1, 0), r: 0.1, icon: 'stir', max: 9, frame: bowlFrame,
      ready: () => this.bowlOn && this.bowlMagic >= 0.6 && this.bowlFlour >= 0.6 && this.bowlMix < 1,
      turn: (d) => {
        this.bowlMix = Math.min(1, this.bowlMix + Math.abs(d) / TWO_PI / WEED.bowlTurns);
        G.audio.play('squish', { pos: this.bowl.synced.currP, vol: 0.35, minGap: 0.45 });
        if (this.bowlMix >= 1 && this.bowl.left <= 0) { this.bowl.setLeft(1); G.audio.play('ding', { pos: this.bowl.synced.currP, vol: 0.5, pitch: 1.3 }); }
      } });
    this.bowlSpoon = makeSpoon(); this.bowlSpoon.visible = false; scene.add(this.bowlSpoon);
    this.bowl.pourNow = () => (this.bowlMix >= 1 && this.bowl.left > 0 ? { stuff: 'dough', color: 0xf2dcae } : null);
    // trays: one on the counter, one on the floor by it; tip the bowl of dough over one
    const traySock = this.traySock = HANDS.socket({ icon: 'cookie', p: L(-1.15, TOP + 0.01, BZ + 0.1), q: qs, on: null, r: 0.35, dock: true, anyYaw: true,
      accepts: (it) => ['tray', 'trayRaw', 'cookies', 'cookiesBurnt'].includes(it.def.item ?? '') });
    this.trays = [P('tray', L(-1.15, TOP + 0.01, BZ + 0.1)), P('tray', L(-0.4, 0.02, -2.4))];
    traySock.p.y += this.trays[0].half;
    HANDS.dock(traySock, this.trays[0]);
    for (const tr of this.trays) HANDS.receiver({ r: 0.24, at: (out) => { const t = tr.body.translation(); return out.set(t.x, t.y + 0.03, t.z); },
      accepts: (s) => s === 'dough' && !tr.banked && HANDS.flow(tr) <= 0,
      fill: (_s, a, by) => {
        const d = (this.trayDough.get(tr) ?? 0) + a; this.trayDough.set(tr, d);
        if (d >= 0.8) { this.trayDough.set(tr, 0); this.swap(tr, 'trayRaw'); G.audio.play('squish', { pos: tr.synced.currP, vol: 0.6 }); void by; }
      } });
    this.spot({ at: L(-1.6, 0, -2.0), r: 0.9, markPos: L(-1.95, 1.7, BZ), needs: () => need('butter', this.bowlMagic >= 0.6 ? 1 : 0) + need('bowl', this.bowlFlour >= 0.6 ? 1 : 0) + need('stir', this.bowlMix >= 1 ? 1 : 0) });
    for (const [x, z] of [[-0.9, -2.4], [-0.55, -2.2]] as const) P('flour', L(x, 0, z));

    // ---- the oven: a door you pull down (grab its handle), the tray goes in, shut it, bake
    const ovFront = FZ + 0.03;
    this.door = new THREE.Group(); this.door.position.copy(L(-2.85, 0.14, ovFront)); this.door.rotation.order = 'YXZ'; this.door.rotation.y = yaw; scene.add(this.door);
    const dW = ov.size.x * 0.82;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(dW, 0.56, 0.05), toonMat(0x3a3d44)); panel.position.set(0, 0.28, 0); panel.castShadow = true; this.door.add(panel);
    this.ovenGlow = toonMat(0x2b2b30, { emissive: new THREE.Color(0) });
    const win = new THREE.Mesh(new THREE.PlaneGeometry(dW * 0.6, 0.24), this.ovenGlow); win.position.set(0, 0.3, 0.03); this.door.add(win);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, dW * 0.7, 8), toonMat(0xc9ced8)); bar.rotation.z = Math.PI / 2; bar.position.set(0, 0.52, 0.06); this.door.add(bar);
    this.ovenDoor = lever({ pivot: this.door.position.clone(), axis: this.right.clone(), arm: V3(0, 0.52, 0).addScaledVector(this.fwd, 0.06), min: 0, max: 1.45, icon: 'door', speed: 4 });
    this.ovenSock = HANDS.socket({ icon: 'oven', p: L(-2.85, 0.25, ovFront - 0.3), q: qs, on: null, r: 0.65, dock: true,
      accepts: (it) => ['trayRaw', 'cookies', 'cookiesBurnt', 'tray'].includes(it.def.item ?? '') && this.ovenDoor.v > 1.1 && !this.trayIn });
    this.ovenMark.copy(L(-2.85, 1.9, BZ));
    this.ovenRing = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.32, 32, 1, 0, Math.PI * 2), new THREE.MeshBasicMaterial({ color: 0xffd166, side: THREE.DoubleSide, depthTest: false, transparent: true }));
    this.ovenRing.position.copy(L(-2.85, 1.75, FZ)); this.ovenRing.renderOrder = 9; this.ovenRing.visible = false; scene.add(this.ovenRing);
    this.spot({ at: L(-2.85, 0, -2.0), r: 0.9, markPos: this.ovenMark, needs: () => (this.trayIn ? `<b>${Math.floor(this.bakeT)}</b>` : need('cookie', 0)) });

    // ---- the grinder: buds into the hopper, turn the crank (front), ground weed into the bag under the chute
    const gP = L(2.2, 0, -2.7);
    const mach = new THREE.Group(); mach.position.copy(gP); mach.rotation.y = yaw; scene.add(mach);
    const red = toonMat(0xc0453a), steel = toonMat(0xaab3bd), dk = toonMat(0x3a3d44), wood = toonMat(0x8a5a2a);
    const box = (g: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
    box(mach, 1.3, 0.9, 0.9, red, 0, 0.45, 0);
    for (const x of [-0.55, 0.55]) for (const z of [-0.35, 0.35]) box(mach, 0.12, 0.3, 0.12, dk, x, -0.0, z);
    const hop = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.22, 0.6, 12, 1, true), steel); hop.position.set(0, 1.2, 0); (hop.material as THREE.Material).side = THREE.DoubleSide; mach.add(hop);
    box(mach, 0.3, 0.22, 0.4, steel, 0.42, 0.32, 0.6).rotation.x = 0.5;   // chute
    const wheel = new THREE.Group(); wheel.position.set(-0.32, 0.55, 0.5); mach.add(wheel);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 6, 20), dk); wheel.add(rim);
    for (let k = 0; k < 4; k++) { const sp = box(wheel, 0.035, 0.56, 0.035, dk, 0, 0, 0); sp.rotation.z = k * Math.PI / 4; }
    const kn = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 8), wood); kn.rotation.x = Math.PI / 2; kn.position.set(0.28, 0, 0.08); wheel.add(kn);
    this.wheel = wheel;
    staticBox(V3(gP.x, gP.y + 0.6, gP.z), V3(0.7, 0.6, 0.5), yaw);
    mach.updateMatrixWorld(true);
    this.hopper.copy(mach.localToWorld(V3(0, 1.3, 0)));
    this.chute.copy(mach.localToWorld(V3(0.42, 0.22, 0.75)));
    HANDS.socket({ icon: 'gear', p: this.hopper.clone(), q: qs, on: null, r: 0.5, dock: false, bin: true, ghost: false,
      accepts: (it) => it.def.item === 'bud' && this.buds < 24,
      onSnap: (it) => { this.consume(it); this.buds++; G.audio.play('squish', { pos: this.hopper, vol: 0.5, pitch: 1.3 }); } });
    // ---- the intake (user: "physical, really take things where they go"): a grain pit with a grate flush with the
    // floor beside the grinder — roll the wheelbarrow onto it and dump (hold its handles, R lifts them: it tips
    // forward) or just drop buds on it; a cleated belt carries them up and over into the hopper
    const iC = this.intake.copy(L(0.75, 0.22, -2.62));
    const pit = new THREE.Group(); pit.position.copy(L(0.75, 0, -2.62)); pit.rotation.y = yaw; scene.add(pit);
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), toonMat(0x141210)); hole.rotation.x = -Math.PI / 2; hole.position.y = 0.012; pit.add(hole);
    for (let k = 0; k < 10; k++) box(pit, 0.035, 0.02, 1.3, steel, -0.585 + k * 0.13, 0.022, 0);   // the grate
    for (const z of [-0.66, 0.66]) box(pit, 1.36, 0.03, 0.04, dk, 0, 0.02, z);
    for (const x of [-0.66, 0.66]) box(pit, 0.04, 0.03, 1.36, dk, x, 0.02, 0);
    const A = this.beltA.copy(L(1.1, 0.14, -2.62)), B = this.beltB.copy(L(1.92, 1.66, -2.7)), len = A.distanceTo(B);
    const belt = new THREE.Group(); belt.position.copy(A).add(B).multiplyScalar(0.5); scene.add(belt); belt.lookAt(B);
    box(belt, 0.32, 0.04, len + 0.1, dk, 0, 0, 0);
    for (const x of [-0.19, 0.19]) box(belt, 0.04, 0.1, len + 0.1, steel, x, 0.03, 0);
    for (const z of [-len / 2, len / 2]) { const rl = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.36, 10), steel); rl.rotation.z = Math.PI / 2; rl.position.set(0, 0, z); belt.add(rl); }
    for (let k = 0; k < 7; k++) { const sl = box(belt, 0.28, 0.05, 0.03, wood, 0, 0.045, 0); this.slats.push(sl); }
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.84, 8), dk); post.position.copy(L(1.48, 0.42, -2.66)); scene.add(post);
    this.beltRun = len;
    HANDS.socket({ icon: 'gear', p: iC.clone(), q: qs, on: null, r: 0.48, dock: false, ghost: false,   // (a bud in the hooves clicks in; dropped ones: the grate, beltStep)
      accepts: (it) => it.def.item === 'bud' && this.buds + this.belt.length < 24 && !this.belt.some((b) => b.pr === it),
      onSnap: (it) => this.onBelt(it) });
    this.bagSock = HANDS.socket({ icon: 'gear', p: mach.localToWorld(V3(0.42, 0.09, 0.88)), q: qs, on: null, r: 0.3, dock: true,
      accepts: (it) => it.def.item === 'weed' && it.left < WEED.bagMax });
    this.grindCrank = crank({ c: mach.localToWorld(V3(-0.32, 0.55, 0.58)), axis: this.fwd.clone(), r: 0.28, icon: 'gear', max: 10,
      ready: () => G.time > this.jamUntil,
      turn: (d, p) => this.grind(d, p) });
    this.spot({ at: L(2.2, 0, -1.6), r: 1.4, markPos: L(2.2, 2.2, -2.7), needs: () => need('leaf', this.buds, 1) });

    // ---- the rolling table: the mat, the paper booklet, the filter box, the ashtray, the lighter
    deco('kaykit/kitchentable_A', 3.2, 0.9, 0.85);
    const top = 0.855;
    this.matC.copy(L(3.2, top, 1.42));   // near the table's front edge (the pig works from the front)
    const mat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.012, 0.28), toonMat(0x3f8f5a)); mat.position.copy(this.matC).setY(this.matC.y + 0.006); mat.rotation.y = yaw; scene.add(mat);
    const booklet = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.09), toonMat(0x5cb83d)); this.papersAt.copy(L(2.72, top + 0.02, 1.5)); booklet.position.copy(this.papersAt); booklet.rotation.y = yaw + 0.2; scene.add(booklet);
    const fbox = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.07), toonMat(0xe8c48a)); this.filtersAt.copy(L(3.68, top + 0.03, 1.5)); fbox.position.copy(this.filtersAt); fbox.rotation.y = yaw - 0.15; scene.add(fbox);
    const ash = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.03, 14), toonMat(0x8a8f99)); const ashP = L(3.75, top + 0.015, 1.15); ash.position.copy(ashP); scene.add(ash);
    HANDS.dispenser({ at: this.papersAt, r: 0.1, icon: 'paper', ready: () => true, take: (_p, at) => this.spawn('paper', at, yaw) });
    HANDS.dispenser({ at: this.filtersAt, r: 0.08, icon: 'filter', ready: () => true, take: (_p, at) => this.spawn('filter', at, yaw) });
    const paperHalf = 0.012;
    this.paperSock = HANDS.socket({ icon: 'paper', p: this.matC.clone().setY(this.matC.y + 0.012 + paperHalf), q: qs, on: null, r: 0.32, dock: true,
      accepts: (it) => it.def.item === 'paper' && !this.paperIn });
    this.filterSock = HANDS.socket({ icon: 'filter', p: this.matC.clone().addScaledVector(this.right, -0.1).setY(this.matC.y + 0.012 + 0.024 + 0.014), q: qs, on: null, r: 0.25, dock: true,
      accepts: (it) => it.def.item === 'filter' && this.paperIn && !this.filterIn && this.rollH.v <= 0 });
    HANDS.receiver({ r: 0.16, at: (out) => out.copy(this.matC).setY(this.matC.y + 0.03),
      accepts: (s) => s === 'weed' && this.paperIn && this.rollH.v <= 0 && this.fill < 2,
      fill: (_s, a) => {
        this.fill = Math.min(2, this.fill + a);
        if (this.fill > 1.6) G.fx.bits(v1.copy(this.matC).addScaledVector(this.fwd, 0.12).setY(this.matC.y + 0.05), { count: 2, color: 0x6fae3e, speed: 0.6, up: 0.3, grav: 6, life: 0.6, size: 0.025, grow: 0, alpha: 1 });   // overflowing
      } });
    // the paper's near edge: take it and push it away from you to roll it up
    this.rollH = slider({ a: this.matC.clone().addScaledVector(this.fwd, 0.08).setY(this.matC.y + 0.045), b: this.matC.clone().addScaledVector(this.fwd, -0.08).setY(this.matC.y + 0.045),
      icon: 'joint', speed: 0.5, ratchet: true,
      ready: () => this.paperIn && this.filterIn && this.fill >= WEED.paperMin,
      moved: (v, _d, p) => { G.audio.play('rustle', { pos: this.matC, vol: 0.25, pitch: 1.8, minGap: 0.35 }); if (v >= 0.999) this.rolled(p); } });
    HANDS.socket({ icon: 'joint', p: ashP.clone().setY(ashP.y + 0.035), q: qs, on: null, r: 0.2, dock: true, anyYaw: true, accepts: (it) => it.def.item === 'joint' });
    this.lighters = [P('lighter', L(2.7, top + 0.02, 1.15)), P('lighter', L(-0.95, TOP + 0.02, FZ - 0.12))]; this.flame = [0, 0];
    P('seedBag', L(4.4, 0, 1.4));
    this.spot({ at: L(3.2, 0, 2.3), r: 1.3, markPos: L(3.2, 1.7, 1.42), needs: () => need('paper', this.paperIn ? 1 : 0) + need('filter', this.filterIn ? 1 : 0) + need('leaf', this.fill >= WEED.paperMin ? 1 : 0) });

    // ---- the bong on the floor by the side wall (water in the top, a pinch in the bowl, light it, snout on it)
    const bP = L(4.45, 0, -2.35), glass = toonMat(0x9fe8d6, { transparent: true, opacity: 0.55 });
    const bong = new THREE.Group(); bong.position.copy(bP); bong.rotation.y = yaw - Math.PI / 2; scene.add(bong);
    const base = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), glass); base.position.y = 0.22; base.scale.y = 0.9; bong.add(base);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.52, 12), glass); neck.position.y = 0.64; bong.add(neck);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.02, 6, 14), glass); lip.rotation.x = Math.PI / 2; lip.position.y = 0.9; bong.add(lip);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), glass); stem.position.set(0.19, 0.34, 0); stem.rotation.z = -0.8; bong.add(stem);
    this.bowlEmber = toonMat(0x8fdcc8, { emissive: new THREE.Color(0) });
    const bowlB = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.03, 0.09, 10), this.bowlEmber); bowlB.position.set(0.3, 0.45, 0); bong.add(bowlB);
    this.bongWaterM = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), toonMat(0x4fb3ff, { transparent: true, opacity: 0.7 }));
    this.bongWaterM.position.y = 0.22; bong.add(this.bongWaterM);
    this.smokeM = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.085, 1, 10), toonMat(0xf2f2f2, { transparent: true, opacity: 0.75 }));
    this.smokeM.visible = false; bong.add(this.smokeM);
    bong.updateMatrixWorld(true);
    this.bongTop.copy(bong.localToWorld(V3(0, 0.9, 0)));
    this.bongBowl.copy(bong.localToWorld(V3(0.3, 0.5, 0)));
    staticCylinder(V3(bP.x, bP.y + 0.22, bP.z), 0.2, 0.22); staticCylinder(V3(bP.x, bP.y + 0.64, bP.z), 0.26, 0.09);
    HANDS.receiver({ r: 0.13, at: (out) => out.copy(this.bongTop), accepts: (s) => s === 'water' && this.bongWater < 1,
      fill: (_s, a) => { this.bongWater = Math.min(1, this.bongWater + a * 0.45); } });
    HANDS.receiver({ r: 0.11, at: (out) => out.copy(this.bongBowl), accepts: (s) => s === 'weed' && this.bongPacked < 0.5,
      fill: (_s, a) => { this.bongPacked = Math.min(0.5, this.bongPacked + a); } });
    this.spot({ at: L(4.3, 0, -1.4), r: 1.3, markPos: L(4.45, 1.9, -2.35), needs: () => need('water', this.bongWater >= 0.3 ? 1 : 0) + need('leaf', this.bongPacked >= 0.3 ? 1 : 0) + need('lighter', this.bowlLit > G.time ? 1 : 0) });
  }

  // ------------------------------------------------------------------ host: actions
  private made(kind: string, p: Pig | null, pts = POINTS[kind] ?? 10) { G.events.push({ type: 'made', who: p, text: kind, why: String(pts) }); }
  private smokeAlarm(at: THREE.Vector3, p: Pig | null) {
    G.audio.play('ring', { pos: at, vol: 1 }); G.audio.play('hiss', { pos: at, vol: 0.8 });
    G.fx.puff(at, { count: 30, color: 0x55575c, speed: 1.4, up: 1.6, life: 3, size: 1.2, alpha: 0.7 });
    G.noise(at, 34);
    G.events.push({ type: 'smokeAlarm', who: p });
  }
  /** The grinder's crank turned by `d` rad: a full turn grinds a bud into the bag (too fast = jammed). */
  private grind(d: number, p: Pig) {
    this.crankSpd = this.crankSpd * 0.88 + Math.abs(d) * 60 * 0.12;
    G.audio.play('tick', { pos: this.chute, vol: 0.4, pitch: 0.55, minGap: 0.16 });
    if (this.buds <= 0) return;
    this.overT = this.crankSpd > WEED.jam ? this.overT + 1 / 60 : Math.max(0, this.overT - 1 / 30);
    if (this.overT > 1.2) {   // cranked too fast for too long: jammed — one bud chewed to nothing, a loud clank; the crank kicks out of the hoof
      this.jamUntil = G.time + 2; this.crankSpd = 0; this.overT = 0; this.buds--;
      G.audio.play('metal', { pos: this.hopper, vol: 1, pitch: 0.5 }); G.noise(this.hopper, 12);
      G.fx.puff(this.hopper, { count: 8, color: 0x55575c, speed: 0.8, up: 1, life: 1.2, size: 0.4, alpha: 0.6 });
      p.letGo();
      G.events.push({ type: 'jammed', who: p });
      return;
    }
    let bag = this.bagSock.occupant;
    if (!bag) { bag = this.spawn('weedBag', this.bagSock.p.clone().setY(this.bagSock.p.y - 0.09), 0, undefined, 0); if (bag) HANDS.dock(this.bagSock, bag); }
    if (!bag || bag.left >= WEED.bagMax) return;
    this.grindProg += Math.abs(d) / TWO_PI;
    if (this.grindProg < 1) return;
    this.grindProg = 0; this.buds--;
    bag.setLeft(bag.left + 1);
    G.fx.puff(this.chute, { count: 6, color: 0x8fcf5a, speed: 0.6, up: 0.2, life: 0.7, size: 0.18, alpha: 0.7 });
    G.audio.play('squish', { pos: this.chute, vol: 0.5, pitch: 1.2 });
    this.made('weedUnit', p);
  }
  /** The paper is rolled all the way: a joint in the roller's hooves (lick it shut next). */
  private rolled(p: Pig) {
    const f = this.fill, q = f >= WEED.paperGood[0] && f <= WEED.paperGood[1] ? 3 : f >= 0.7 && f <= 1.55 ? 2 : 1;
    const pa = this.paperSock.occupant, fi = this.filterSock.occupant;
    if (pa) this.consume(pa); if (fi) this.consume(fi);
    this.fill = 0; this.rollH.v = 0; p.letGo();
    const j = this.spawn('joint', v1.copy(this.matC).setY(this.matC.y + 0.05), this.shedYaw(), undefined, 3 + q);
    if (j) { const i = this.joints.indexOf(j); this.sealed[i] = false; this.lit[i] = 0; p.grab(j); }
    G.audio.play('rustle', { pos: this.matC, vol: 0.6, pitch: 1.5 });
    this.made('joint', p);
    G.events.push({ type: 'rolled', who: p });
  }
  private shedYaw() { return new THREE.Euler().setFromQuaternion(this.shedQ, 'YXZ').y; }
  /** A hit off the bong: how full the chamber got (pull away in time). */
  private bongHit(p: Pig, c: number) {
    this.chamber = 0; this.inhaler = null;
    if (c < 0.2) return;
    this.bongPacked = 0; this.bowlLit = 0; this.bongWater = Math.max(0, this.bongWater - 0.3);
    G.audio.play('fill', { pos: this.bongTop, vol: 0.8, pitch: 0.6 });
    const sn = this.snout(p, v1);
    if (c > 1.1) {   // held it too long: a coughing fit the whole farm hears
      p.addBuzz(1, 0.55, 60);
      G.audio.play('cough', { pos: p.pos, vol: 1 }); G.audio.play('squeal', { pos: p.pos, vol: 0.7, pitch: 0.8 });
      G.fx.puff(sn, { count: 22, color: 0xe8e8e8, speed: 2.2, up: 1.2, life: 2.2, size: 0.9, alpha: 0.6 });
      G.noise(p.pos, 16);
      G.events.push({ type: 'pigCough', who: p });
    } else {
      const q = c < 0.55 ? 1 : c < 0.85 ? 2 : 3;
      p.addBuzz(1, 0.25 + 0.12 * q, 40 + 10 * q);
      G.fx.puff(sn, { count: 10, color: 0xe8e8e8, speed: 1, up: 0.8, life: 2, size: 0.6, alpha: 0.5 });
    }
    G.events.push({ type: 'bongRip', who: p });
    this.made('bong', p);
  }

  private nearPlant(x: number, z: number, r: number, want?: (pl: Plant) => boolean) {
    let best: Plant | null = null, bd = r;
    for (const pl of this.plants) { const d = Math.hypot(pl.x - x, pl.z - z); if (d < bd && (!want || want(pl))) { bd = d; best = pl; } }
    return best;
  }
  private harvest(pl: Plant, n: number, dir: THREE.Vector3, p: Pig | null) {
    pl.g = 0.05;
    for (let i = 0; i < n; i++) this.spawn('bud', V3(pl.x + (Math.random() - 0.5) * 0.4, pl.y + 1, pl.z + (Math.random() - 0.5) * 0.4), 0,
      V3(dir.x * 2 + (Math.random() - 0.5) * 2, 3, dir.z * 2 + (Math.random() - 0.5) * 2));
    G.audio.play('rustle', { pos: v1.set(pl.x, pl.y + 0.8, pl.z), vol: 1 });
    G.fx.bits(v1, { count: 14, color: 0x5cb83d, speed: 2.5, up: 2, life: 0.7, size: 0.1, grow: 0, drag: 2, alpha: 1 });
    G.noise(v1, 9);
    if (p) for (let i = 0; i < n; i++) this.made('bud', p);
  }
  private hitPlant(hx: number, hz: number, reach: number, dir: THREE.Vector3, by: Pig) {
    if (G.net === 'client') return false;
    const pl = this.nearPlant(hx, hz, reach * 0.8 + 0.4);
    if (!pl) return false;
    if (pl.g >= 1) { this.harvest(pl, 2, dir, by); return true; }
    G.audio.play('rustle', { pos: v1.set(pl.x, pl.y + 0.6, pl.z), vol: 0.6 });
    return true;
  }
  private jointTip(j: Prop, out: THREE.Vector3) { const t = j.body.translation(), r = j.body.rotation(); return out.set(0.1, 0, 0).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w)).add(v3.set(t.x, t.y, t.z)); }
  private flamePos(l: Prop, out = v2) { const p = l.body.translation(); return out.set(p.x, p.y + 0.12, p.z); }

  protected selfUse(p: Pig, h: Prop): boolean {
    const it = h.def.item, f = p.forward;
    switch (it) {
      case 'can': {   // dip it in the pond
        const pond = G.places?.pond;
        if (pond && Math.hypot(p.pos.x - pond.x, p.pos.z - pond.z) < pond.r + 0.6) { h.setLeft(h.def.servings ?? 6); G.audio.play('fill', { pos: p.pos, vol: 0.8 }); return true; }
        return false;
      }
      case 'sickle': {
        const pl = this.nearPlant(p.pos.x + f.x * 1.1, p.pos.z + f.z * 1.1, 1.7, (x) => x.g >= 1);
        if (!pl) return false;
        this.harvest(pl, 3, f, p);
        G.audio.play('whoosh', { pos: p.pos, vol: 0.6, pitch: 1.4 });
        return true;
      }
      case 'lighter': {
        const i = this.lighters.indexOf(h);
        G.audio.play('flint', { pos: p.pos, vol: 0.8 });
        if (i >= 0 && Math.random() < 0.65) { this.flame[i] = G.time + 6; G.fx.bits(this.flamePos(h), { count: 6, color: 0xffb13a, speed: 0.6, up: 1, life: 0.3, size: 0.06, grow: 0, alpha: 1 }); }
        return true;
      }
      case 'joint': {
        const i = this.joints.indexOf(h);
        if (i < 0) return false;
        if (!this.sealed[i]) {   // lick it shut
          this.sealed[i] = true; p.mouthAt = G.time;
          G.audio.play('squish', { pos: p.pos, vol: 0.5, pitch: 1.7 });
          G.events.push({ type: 'lick', who: p });
          return true;
        }
        if (this.lit[i] < G.time) return false;   // not lit: bring a flame to its tip
        p.mouthAt = G.time;
        this.serve(h);
        p.addBuzz(1, WEED.jointBuzz, 26);
        G.audio.play('fill', { pos: p.pos, vol: 0.35, pitch: 1.8 });
        G.fx.puff(this.snout(p, v1), { count: 4, color: 0xeeeeee, speed: 0.5, up: 0.6, life: 1.5, size: 0.22, alpha: 0.45 });
        G.noise(p.pos, 6);
        G.events.push({ type: 'puff', who: p });
        return true;
      }
      case 'cookies': {
        p.mouthAt = G.time;
        this.serve(h);
        p.addBuzz(1, WEED.cookieBuzz, 70, 10);
        G.audio.play('munch', { pos: p.pos, vol: 0.9 });
        G.events.push({ type: 'cookieEaten', who: p });
        if (p.buzz > 0.2) G.events.push({ type: 'munch', who: p });
        return true;
      }
      case 'burnt': {
        p.mouthAt = G.time;
        this.serve(h); G.audio.play('cough', { pos: p.pos, vol: 0.8 }); G.events.push({ type: 'pigCough', who: p });
        return true;
      }
    }
    return false;
  }
  protected selfIcon(p: Pig, h: Prop): IconId | '' {
    const f = p.forward;
    switch (h.def.item) {
      case 'can': { const pond = G.places?.pond; return pond && Math.hypot(p.pos.x - pond.x, p.pos.z - pond.z) < pond.r + 0.6 ? 'water' : ''; }
      case 'sickle': return this.nearPlant(p.pos.x + f.x * 1.1, p.pos.z + f.z * 1.1, 1.7, (x) => x.g >= 1) ? 'sickle' : '';
      case 'lighter': return 'lighter';
      case 'joint': { const i = this.joints.indexOf(h); return i < 0 ? '' : !this.sealed[i] ? 'tongue' : this.lit[i] > G.time ? 'joint' : ''; }
      case 'cookies': return 'cookie';
      case 'burnt': return 'cough';
    }
    return '';
  }

  // ------------------------------------------------------------------ host, every step
  protected tick(dt: number) {
    // socket states (the HUD + players read these)
    this.potOn = this.pot.dockedIn === this.burner; this.bowlOn = this.bowl.dockedIn === this.counter;
    this.paperIn = !!this.paperSock.occupant; this.filterIn = !!this.filterSock.occupant; this.trayIn = !!this.ovenSock.occupant;
    if (!this.paperIn) { this.fill = 0; this.rollH.v = 0; if (this.filterSock.occupant) HANDS.undock(this.filterSock.occupant, null); }
    // Bob tends his crop: while he's on his garden round, the plants around him get a drink
    const bob = G.farmer;
    const tending = !!bob && bob.state === 'routine' && flat(bob.pos, this.fieldC) < 9;
    for (const pl of this.plants) {
      if (tending && flat(bob!.pos, pl) < 5) pl.w = Math.min(0.8, pl.w + dt * 0.05);
      pl.w = Math.max(0, pl.w - WEED.dry * dt * (G.mod === 'rain' ? -0.5 : 1));
      if (G.mod === 'rain') pl.w = Math.min(0.9, pl.w);
      if (pl.g > 0 && pl.g < 1 && pl.w > 0.05 && pl.w <= WEED.drown) pl.g = Math.min(1, pl.g + WEED.grow * dt * (pl.w > 0.35 ? 1 : 0.5));
    }
    this.cart.step(dt);
    this.beltStep(dt);
    // the grinder's crank slows down when nobody turns it
    this.crankSpd *= 0.97;
    // lighters: a flame at an unlit joint's tip lights it; at the bong's packed bowl lights the bowl
    this.lighters.forEach((l, i) => {
      if (this.flame[i] < G.time || l.banked) return;
      const fp = this.flamePos(l);
      this.joints.forEach((j, k) => {
        if (j.banked || this.lit[k] > G.time || !this.sealed[k]) return;
        if (this.jointTip(j, v1).distanceTo(fp) < 0.3) { this.lit[k] = G.time + 90; G.audio.play('crackle', { pos: fp, vol: 0.5 }); G.events.push({ type: 'litUp', who: (j.heldBy ?? l.heldBy) as Pig | null }); }
      });
      if (this.bongPacked >= 0.3 && this.bowlLit < G.time && fp.distanceTo(this.bongBowl) < 0.3) { this.bowlLit = G.time + 10; G.audio.play('crackle', { pos: this.bongBowl, vol: 0.6 }); }
    });
    // the bong: a snout on the mouthpiece while the bowl burns = the chamber fills with smoke; pull away to take the hit
    if (this.inhaler && (this.inhaler.mode !== 'normal' || this.snout(this.inhaler, v1).distanceTo(this.bongTop) > 0.62 || this.bowlLit < G.time)) this.bongHit(this.inhaler, this.chamber);
    if (!this.inhaler && this.bowlLit > G.time && this.bongWater >= 0.15 && this.bongPacked > 0) {
      for (const p of G.pigs as Pig[]) if (!p.absent && !p.out && p.mode === 'normal' && this.snout(p, v1).distanceTo(this.bongTop) < 0.5) { this.inhaler = p; break; }
    }
    if (this.inhaler) {
      this.chamber += dt / 3.6;
      this.inhaler.touch(this.bongTop);
      G.audio.play('fill', { pos: this.bongTop, vol: 0.4, pitch: 0.5 + this.chamber * 0.4, minGap: 0.35 });
      if (this.chamber > 1.15) this.bongHit(this.inhaler, this.chamber);
    }
    // the pot: stir it or it burns
    if (this.potOn && this.potButter > 0 && this.potWeed > 0 && this.potCook < 1) {
      if (G.time - this.lastStir > 1.5) this.potBurn += dt;
      if (this.potBurn > 4 && Math.random() < dt * 4) G.fx.puff(v1.copy(this.pot.synced.currP).setY(this.pot.synced.currP.y + 0.3), { count: 2, color: 0x55575c, speed: 0.5, up: 1, life: 1.6, size: 0.4, alpha: 0.6 });
      if (this.potBurn > WEED.burnAfter) {
        this.potButter = this.potWeed = this.potCook = 0; this.potBurn = 0;
        this.smokeAlarm(this.pot.synced.currP, this.potStir.heldBy);
        G.events.push({ type: 'burnt', who: this.potStir.heldBy });
      }
    }
    if (this.potCook >= 1 && this.potButter > 0) {   // cooked: magic butter in the pot (tip it over the bowl)
      this.potButter = 0; this.pot.setLeft(1);
      G.audio.play('ding', { pos: this.pot.synced.currP, vol: 0.6 });
      this.made('magic', this.potStir.heldBy);
      this.potStir.heldBy?.letGo();
    }
    if (this.potCook >= 1 && this.pot.left <= 0.01) { this.potCook = 0; this.potWeed = 0; this.pot.setLeft(0); }   // poured out
    if (this.bowlMix >= 1 && this.bowl.left <= 0.01 && this.bowlMagic > 0) { this.bowlMix = this.bowlMagic = this.bowlFlour = 0; this.bowl.setLeft(0); }
    if (this.bowlMix >= 1) this.bowlStir.heldBy?.letGo();
    // the oven door, let go: past halfway it drops open (its own weight), below that its springs pull it shut
    if (!this.ovenDoor.heldBy) {
      const v = this.ovenDoor.v, to = v > 0.6 ? 1.45 : 0;
      if (v !== to) { this.ovenDoor.v = to > v ? Math.min(to, v + dt * 4) : Math.max(to, v - dt * 3); if (this.ovenDoor.v === to) G.audio.play('clunk', { pos: this.ovenMark, vol: to ? 0.4 : 0.6, pitch: to ? 0.8 : 1.2 }); }
    }
    // the oven: bakes while a tray is in and the door is shut; golden, then burnt, then the alarm
    const tray = this.ovenSock.occupant;
    if (!tray) this.bakeT = 0;
    else if (this.ovenDoor.v < 0.15) {
      this.bakeT += dt;
      if (tray.def.item === 'trayRaw' && this.bakeT >= WEED.bakeMin) {
        const c = this.swap(tray, 'cookies');
        if (c) { this.made('cookies', null); G.events.push({ type: 'bakeCookies', who: null }); G.audio.play('ding', { pos: this.ovenMark, vol: 0.7 }); }
      } else if (tray.def.item === 'cookies' && this.bakeT >= WEED.bakeMax) { this.swap(tray, 'cookiesBurnt'); G.events.push({ type: 'burnt', who: null }); }
      if (this.bakeT > WEED.bakeMax && Math.random() < dt * 3) G.fx.puff(v1.copy(this.ovenMark).setY(this.ovenMark.y - 1), { count: 3, color: 0x55575c, speed: 0.6, up: 1, life: 2, size: 0.6, alpha: 0.6 });
      if (this.bakeT > WEED.alarm && G.time > this.alarmAt) { this.alarmAt = G.time + 8; this.smokeAlarm(this.ovenMark, null); }
    }
  }
  /** Host: a bud landed on the intake grate: it drops into the pit and rides the belt up (kinematic, nobody can take it), then drops into the hopper. */
  private onBelt(it: Prop) {
    it.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    it.snapCd = G.time + 99; it.noGrab = () => true;
    this.belt.push({ pr: it, t: 0, from: it.synced.currP.clone() });
    G.audio.play('rustle', { pos: this.intake, vol: 0.4, pitch: 1.4, minGap: 0.2 });
  }
  /** Host: the belt; the buds lying in the wheelbarrow (for the arrows / mission icons). */
  private beltStep(dt: number) {
    for (let i = this.belt.length - 1; i >= 0; i--) {
      const b = this.belt[i], pr = b.pr;
      if (pr.banked) { this.offBelt(pr); this.belt.splice(i, 1); continue; }
      b.t += dt / 2.6;
      const k = b.t;
      if (k < 0.18) v1.lerpVectors(b.from, this.beltA, (k / 0.18) * (k / 0.18) * (3 - 2 * k / 0.18)).y += Math.sin((k / 0.18) * Math.PI) * 0.15;
      else v1.lerpVectors(this.beltA, this.beltB, Math.min(1, (k - 0.18) / 0.82)).y += 0.08;
      pr.body.setNextKinematicTranslation(v1);
      if (k >= 1) {   // over the top: it tumbles into the hopper (its bin catches it)
        this.offBelt(pr); pr.body.setLinvel({ x: 0, y: -0.5, z: 0 }, true);
        this.belt.splice(i, 1);
      }
    }
    if (this.belt.length) G.audio.play('tick', { pos: this.beltA, vol: 0.18, pitch: 0.7, minGap: 0.22 });
    // anything that lands on the grate (a dumped load spreads out) drops through it and goes up the belt
    let n = 0;
    for (const pr of this.props) {
      if (pr.def.item !== 'bud' || pr.banked || pr.heldBy || G.time < pr.snapCd) continue;
      const p = pr.synced.currP;
      if (this.cart.holds(p)) { n++; continue; }
      const dx = p.x - this.intake.x, dz = p.z - this.intake.z;
      if (Math.abs(dx * this.right.x + dz * this.right.z) < 0.68 && Math.abs(dx * this.fwd.x + dz * this.fwd.z) < 0.68 && p.y < this.intake.y + 0.05
        && this.buds + this.belt.length < 24) this.onBelt(pr);
    }
    this.cargo = n;
  }
  private offBelt(pr: Prop) { pr.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true); pr.snapCd = 0; pr.noGrab = undefined; }
  protected resetMode() {
    this.plants.forEach((pl, i) => { pl.g = i % 4 === 3 ? 0 : 0.15 + (i % 3) * 0.1; pl.w = 0.3; pl.seed = 0; });
    for (const b of this.belt) this.offBelt(b.pr);
    this.belt = [];
    this.cargo = 0; this.buds = 0; this.grindProg = 0; this.crankSpd = 0; this.jamUntil = 0; this.fill = 0;
    this.bongWater = 0; this.bongPacked = 0; this.bowlLit = 0; this.chamber = 0; this.inhaler = null;
    this.potButter = this.potWeed = this.potCook = this.potBurn = 0; this.bowlMagic = this.bowlFlour = this.bowlMix = 0;
    this.bakeT = 0; this.fridgeAt = 0; this.alarmAt = 0; this.lit = this.lit.map(() => 0); this.sealed = this.sealed.map(() => false); this.flame = [0, 0];
    this.trayDough.clear(); this.pump.reset();
    for (const h of [this.grindCrank, this.rollH, this.potStir, this.bowlStir, this.ovenDoor]) h.v = 0;
    // the pot / bowl / first tray back in their places
    if (G.net !== 'client') { HANDS.dock(this.burner, this.pot); HANDS.dock(this.counter, this.bowl); HANDS.dock(this.traySock, this.trays[0]); }
    this.pot.setLeft(0); this.bowl.setLeft(0);
  }

  // ------------------------------------------------------------------ every frame
  render(dt: number) {
    this.visions.render(dt);
    this.shedRender();
    this.pump.render(dt);
    const L = G.localPig as Pig | null, can = this.item(L?.held) === 'can';
    for (const pl of this.plants) {
      const st = pl.g <= 0.001 ? -1 : pl.g < 0.3 ? 0 : pl.g < 0.6 ? 1 : pl.g < 1 ? 2 : 3;
      pl.stages.forEach((m, i) => { m.visible = i === st; });
      const m = pl.stages[st];
      if (m) {
        const k = st === 3 ? 1 : 0.75 + 0.25 * ((pl.g * 3.3) % 1), dry = pl.w < 0.05 && pl.g > 0;
        m.scale.set(k, k * (dry ? 0.8 : 1), k); m.rotation.z = dry ? 0.25 : Math.sin(G.time * 1.3 + pl.x) * 0.03;
      }
      pl.puddle.visible = pl.w > WEED.drown;
      pl.drop.visible = can && pl.g > 0 && pl.g < 1 && pl.w < 0.3;
      pl.star.visible = pl.g >= 1;
      if (pl.star.visible) pl.star.material.rotation = Math.sin(G.time * 2) * 0.3;
    }
    this.cart.render();
    // the belt's cleats run up while it carries something (every browser: buds ride it as synced props)
    const run = this.beltRun, on = this.belt.length > 0 || this.props.some((p) => p.def.item === 'bud' && !p.banked && p.synced.currP.distanceTo(this.beltA) + p.synced.currP.distanceTo(this.beltB) < run + 0.25);
    if (on) this.beltOff = (this.beltOff + dt * 0.6) % (run / this.slats.length);
    this.slats.forEach((sl, k) => { sl.position.z = -run / 2 + ((k * run) / this.slats.length + this.beltOff) % run; });
    this.wheel.rotation.z = this.grindCrank.v;
    // the paper on the mat: weed strip (how much), the rolled edge moving across
    const pa = this.paperIn ? this.paperSock.occupant ?? this.props.find((x) => x.def.item === 'paper' && !x.banked && x.synced.currP.distanceTo(this.paperSock.p) < 0.05) : null;
    if (pa) {
      const w = pa.obj.getObjectByName('weed'), c = pa.obj.getObjectByName('curl'), r = this.rollH.v;
      if (w) { w.visible = this.fill > 0.02; w.scale.set(1, Math.max(0.01, Math.min(1.6, this.fill)) * (1 - r * 0.9), Math.min(1.4, 0.6 + this.fill * 0.5) * (1 - r * 0.8)); }
      if (c) { c.visible = r > 0.01; c.position.z = 0.06 - r * 0.11; c.scale.set(1 + r * 0.9, 1, 1 + r * 0.9); }
    }
    for (const pp of this.props) if (pp.def.item === 'paper' && pp !== pa) { const w = pp.obj.getObjectByName('weed'), c = pp.obj.getObjectByName('curl'); if (w) w.visible = false; if (c) c.visible = false; }
    // the oven: the door's angle; window colour = how done; the ring over it fills, golden in the window, red when burning
    this.door.rotation.x = this.ovenDoor.v;
    const t = this.trayIn ? this.bakeT : -1;
    const k = t < 0 ? 0 : Math.min(1, t / WEED.bakeMax);
    this.ovenGlow.emissive.setHex(t < 0 ? 0 : t < WEED.bakeMin ? 0x6a3a12 : t <= WEED.bakeMax ? 0xff9a2a : 0x3a1a0a).multiplyScalar(t < 0 ? 0 : 0.5 + 0.5 * Math.sin(G.time * 4) * (t > WEED.bakeMax ? 1 : 0.2));
    this.ovenRing.visible = t > 0;
    if (t > 0) {
      const ring = this.ovenRing;
      ring.geometry.dispose(); ring.geometry = new THREE.RingGeometry(0.22, 0.32, 32, 1, Math.PI / 2, -Math.PI * 2 * k);
      (ring.material as THREE.MeshBasicMaterial).color.setHex(t < WEED.bakeMin ? 0xfff6e6 : t <= WEED.bakeMax ? 0xffd166 : 0xff4a3a);
      const cam = G.cam; if (cam) ring.quaternion.copy(cam.quaternion);
    }
    // the fridge door swings open for a moment after you take butter
    const fo = this.fridgeAt - G.time;
    this.fridgeDoor.rotation.y = this.shedYaw() - (fo > 13.5 ? 1.2 * Math.min(1, (15 - fo) * 3) : fo > 12.8 ? 1.2 * Math.max(0, (fo - 12.8) / 0.7) : 0);
    // the pot + bowl contents, the spoons
    const pf = this.pot.obj.getObjectByName('fill') as THREE.Mesh | undefined;
    if (pf) { pf.visible = this.potButter > 0 || this.potWeed > 0 || this.pot.left > 0; (pf.material as THREE.MeshToonMaterial).color.setHex(this.potCook >= 1 ? 0x7fae3a : this.potWeed > 0.3 ? 0xb5c24a : 0xe9d36a); }
    const bf = this.bowl.obj.getObjectByName('fill') as THREE.Mesh | undefined;
    if (bf) { bf.visible = this.bowlMagic > 0 || this.bowlFlour > 0; (bf.material as THREE.MeshToonMaterial).color.setHex(this.bowlMix >= 1 ? 0xf2dcae : this.bowlMagic > 0 && this.bowlFlour > 0 ? 0xd8d6a0 : this.bowlMagic > 0 ? 0x9fbf4a : 0xf8f4ea); bf.scale.set(1, 1 + this.bowlMix * 2, 1); }
    this.spoonAt(this.potSpoon, this.potStir, this.potOn && this.potButter + this.potWeed > 0 && this.potCook < 1);
    this.spoonAt(this.bowlSpoon, this.bowlStir, this.bowlOn && this.bowlMagic + this.bowlFlour > 0 && this.bowlMix < 1);
    // the bong: water level, the chamber's smoke, the bowl's ember
    this.bongWaterM.scale.y = Math.max(0.01, this.bongWater);
    this.bongWaterM.visible = this.bongWater > 0.02;
    this.smokeM.visible = this.chamber > 0.02;
    if (this.smokeM.visible) { const h = Math.min(1.12, this.chamber) * 0.5; this.smokeM.scale.set(1, h, 1); this.smokeM.position.y = 0.4 + h / 2; }
    this.bowlEmber.emissive.setHex(this.bowlLit > G.time ? 0xff6a1a : 0).multiplyScalar(this.bowlLit > G.time ? 0.6 + Math.sin(G.time * 9) * 0.3 : 0);
    if (this.bowlLit > G.time && Math.random() < dt * 4) G.fx.puff(this.bongBowl, { count: 1, color: 0xdddddd, speed: 0.15, up: 0.5, life: 1.2, size: 0.15, alpha: 0.4 });
    // lit joints smoulder, lighters show their flame
    this.joints.forEach((j, i) => {
      const e = j.obj.getObjectByName('ember') as THREE.Mesh | undefined; if (!e) return;
      const on = this.lit[i] > G.time && !j.banked;
      (e.material as THREE.MeshToonMaterial).emissive.setHex(on ? 0xff6a1a : 0);
      if (on && Math.random() < dt * 3) G.fx.puff(e.getWorldPosition(v1), { count: 1, color: 0xdddddd, speed: 0.15, up: 0.5, life: 1.4, size: 0.18, alpha: 0.4 });
    });
    this.lighters.forEach((l, i) => { if (this.flame[i] > G.time && !l.banked && Math.random() < dt * 20) G.fx.bits(this.flamePos(l, v1), { count: 1, color: Math.random() < 0.5 ? 0xffb13a : 0xff6a1a, speed: 0.2, up: 0.8, life: 0.25, size: 0.07, grow: 0, alpha: 1 }); });
  }
  private spoonAt(sp: THREE.Object3D, h: Handle, show: boolean) {
    sp.visible = show || !!h.heldBy;
    if (!sp.visible) return;
    h.knob(sp.position); sp.position.y -= 0.12;
    sp.rotation.set(0.25 * Math.cos(h.v), 0, -0.25 * Math.sin(h.v));
  }

  // ------------------------------------------------------------------ net (≤ 64 numbers)
  netState(n: number[]) {
    for (const pl of this.plants) n.push(Math.round(pl.g * 100) * 256 + Math.round(pl.w * 100));
    const r2 = (x: number) => Math.round(x * 100) / 100;
    const occ = (this.paperIn ? 1 : 0) | (this.filterIn ? 2 : 0) | (this.potOn ? 4 : 0) | (this.bowlOn ? 8 : 0) | (this.trayIn ? 16 : 0);
    let seal = 0; this.sealed.forEach((s, i) => { if (s) seal |= 1 << i; });
    n.push(this.cargo, this.buds, r2(this.grindCrank.v), r2(this.fill), r2(this.rollH.v), occ, seal,
      this.potButter, r2(this.potWeed), r2(this.potCook), r2(this.potBurn), r2(this.potStir.v),
      r2(this.bowlMagic), r2(this.bowlFlour), r2(this.bowlMix), r2(this.bowlStir.v), r2(this.ovenDoor.v), r2(this.bakeT), this.fridgeAt,
      r2(this.bongWater), r2(this.bongPacked), this.bowlLit, r2(this.chamber), r2(this.pump.lever.v), this.pump.flowUntil, ...this.lit, ...this.flame);
  }
  netApply(n: number[]) {
    const P = this.plants.length;
    if (n.length < P + 25) return;
    this.plants.forEach((pl, i) => { pl.g = Math.floor(n[i] / 256) / 100; pl.w = (n[i] % 256) / 100; });
    let j = P;
    const x = () => n[j++];
    this.cargo = x(); this.buds = x(); this.grindCrank.v = x(); this.fill = x(); this.rollH.v = x();
    const occ = x(); this.paperIn = !!(occ & 1); this.filterIn = !!(occ & 2); this.potOn = !!(occ & 4); this.bowlOn = !!(occ & 8); this.trayIn = !!(occ & 16);
    const seal = x(); this.sealed = this.sealed.map((_, i) => !!(seal & (1 << i)));
    this.potButter = x(); this.potWeed = x(); this.potCook = x(); this.potBurn = x(); this.potStir.v = x();
    this.bowlMagic = x(); this.bowlFlour = x(); this.bowlMix = x(); this.bowlStir.v = x(); this.ovenDoor.v = x(); this.bakeT = x(); this.fridgeAt = x();
    this.bongWater = x(); this.bongPacked = x(); this.bowlLit = x(); this.chamber = x(); this.pump.lever.v = x(); this.pump.flowUntil = x();
    this.lit = this.lit.map(() => x() ?? 0);
    this.flame = this.flame.map(() => x() ?? 0);
  }

  // ------------------------------------------------------------------ admin + arrows
  adminButtons(): [string, string][] {
    return [['weed:ripe', 'a.weedRipe'], ['weed:water', 'a.weedWater'], ['weed:buds', 'a.weedBuds'], ['weed:barrow', 'a.weedBarrow'], ['weed:bag', 'a.weedBag'], ['weed:mat', 'a.weedMat'], ['weed:joint', 'a.weedJoint'],
      ['weed:pot', 'a.weedPot'], ['weed:high', 'a.weedHigh'], ['weed:cookies', 'a.weedCookies'], ['tp:shed', 'a.tpShed'], ['tp:field', 'a.tpField'], ['tp:beam', 'a.tpBeam']];
  }
  admin(a: string, me: Pig): boolean {
    const f = me.forward, front = V3(me.pos.x + f.x * 0.9, me.pos.y + 0.3, me.pos.z + f.z * 0.9);
    switch (a) {
      case 'weed:ripe': for (const pl of this.plants) if (pl.g > 0) pl.g = 1; return true;
      case 'weed:water': for (const pl of this.plants) pl.w = 0.8; return true;
      case 'weed:buds': for (let i = 0; i < 6; i++) this.spawn('bud', front.clone().add(V3((i % 3 - 1) * 0.3, 0.2 * i, 0)), 0); return true;
      case 'weed:bag': this.spawn('weedBag', front, me.yaw, undefined, WEED.bagMax); return true;
      case 'weed:barrow': {   // the wheelbarrow in front of me (handles toward me), 6 buds in it
        const at = V3(me.pos.x + f.x * 1.5, me.pos.y - 0.4, me.pos.z + f.z * 1.5), b = this.barrow;
        b.body.setTranslation({ x: at.x, y: at.y + b.half + 0.1, z: at.z }, true);
        b.body.setRotation(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, me.yaw), true);
        b.body.setLinvel({ x: 0, y: 0, z: 0 }, true); b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        for (let i = 0; i < 6; i++) this.spawn('bud', V3(at.x + f.x * ((i % 3) - 1) * 0.2 + f.z * 0.12 * (i < 3 ? 1 : -1), at.y + 0.9 + i * 0.12, at.z + f.z * ((i % 3) - 1) * 0.2 - f.x * 0.12 * (i < 3 ? 1 : -1)), 0);
        return true;
      }
      case 'weed:mat': {   // a paper + a filter on the mat, filled: ready to roll
        if (!this.paperSock.occupant) { const pa = this.spawn('paper', this.matC, this.shedYaw()); if (pa) HANDS.dock(this.paperSock, pa); }
        if (!this.filterSock.occupant) { const fi = this.spawn('filter', this.matC, this.shedYaw()); if (fi) HANDS.dock(this.filterSock, fi); }
        this.paperIn = this.filterIn = true; this.fill = 1.05;
        return true;
      }
      case 'weed:joint': { const j = this.spawn('joint', front, me.yaw); if (j) { const i = this.joints.indexOf(j); this.sealed[i] = true; this.lit[i] = G.time + 90; } return true; }
      case 'weed:pot': if (!this.potOn) HANDS.dock(this.burner, this.pot); this.potButter = 1; this.potWeed = 1; this.potCook = 0; this.potBurn = 0; return true;
      case 'weed:high': me.addBuzz(1, 0.9, 90); return true;
      case 'weed:cookies': this.spawn('cookies', front, me.yaw); return true;
    }
    return false;
  }
  /** How to do the next step (mission list icons). */
  stepIcons(id: string, me: Pig): string {
    const I = (...k: (IconId | string)[]) => k.map((x) => (x in IC ? IC[x as IconId] : `<kbd class="kc">${x}</kbd>`)).join('');
    const held = this.item(me.held), has = (item: string, full = false) => this.props.some((p) => !p.banked && p.def.item === item && (!full || p.left > 0.05));
    // (buds: into the wheelbarrow, push it to the intake by the grinder, R = lift the handles and dump them in)
    const toWeed = () => has('weed', true) ? I('rmb', 'leaf') : this.buds > 0 ? I('rmb', 'gear', 'circle') : held === 'bud' ? I('aim', 'gear')
      : this.cargo > 0 ? (held === 'barrow' ? (me.standing ? I('aim', 'gear', 'R', 'pour') : I('E', 'aim', 'gear', 'R', 'pour')) : I('rmb', 'cart', 'aim', 'gear')) : has('bud') ? I('rmb', 'leaf', 'aim', 'cart') : this.plants.some((x) => x.g >= 1) ? I('sickle', 'lmb') : I('R', 'can', 'pour');
    switch (id) {
      case 'rollJoint': {
        if (held === 'joint') { const i = this.joints.indexOf(me.held as Prop); return !this.sealed[i] ? I('lmb', 'tongue') : this.lit[i] < G.time ? I('lighter', 'lmb', 'aim', 'joint') : I('lmb', 'joint'); }
        if (has('joint')) return I('rmb', 'joint');
        if (!this.paperIn) return I('rmb', 'paper', 'aim');
        if (!this.filterIn) return I('rmb', 'filter', 'aim', 'paper');
        if (this.fill < WEED.paperMin) return held === 'weed' ? I('R', 'pour', 'paper') : toWeed();
        return I('rmb', 'paper', 'mouse');
      }
      case 'bongRip':
        if (this.bongWater < 0.3) return I('R', 'can', 'pour', 'bong');
        if (this.bongPacked < 0.3) return held === 'weed' ? I('R', 'pour', 'bong') : toWeed();
        if (this.bowlLit < G.time) return I('lighter', 'lmb', 'aim', 'bong');
        return I('pig', 'bong');
      case 'bakeCookies':
        if (this.trayIn) return I('oven', 'door');
        if (has('trayRaw')) return I('door', 'rmb', 'oven');
        if (this.bowlMix >= 1) return I('R', 'bowl', 'pour', 'cookie');
        if (this.bowlMagic >= 0.6 && this.bowlFlour >= 0.6) return I('rmb', 'stir', 'circle');
        if (this.potCook >= 1 && this.pot.left > 0) return I('R', 'butter', 'pour', 'bowl');
        if (this.bowlMagic >= 0.6) return I('R', 'pour', 'bowl');
        if (!this.potButter && this.potCook < 1) return I('rmb', 'butter', 'aim', 'fire');
        if (this.potWeed < 0.6) return held === 'weed' ? I('R', 'pour', 'fire') : toWeed();
        return I('rmb', 'stir', 'circle');
    }
    return '';
  }
  markFor(id: string, me: Pig): THREE.Vector3 | null {
    const has = (item: string, full = false) => this.props.some((p) => !p.banked && p.def.item === item && (!full || p.left > 0.05));
    const near = (item: string, full = false) => { let best: Prop | null = null, bd = Infinity; for (const p of this.props) { if (p.banked || p.def.item !== item || (full && p.left <= 0.05)) continue; const d = flat(p.synced.currP, me.pos); if (d < bd) { bd = d; best = p; } } return best?.synced.currP.clone().setY(best.synced.currP.y + 0.3) ?? null; };
    const ripe = () => { const pl = this.plants.filter((x) => x.g >= 1).sort((a, b) => flat(a, me.pos) - flat(b, me.pos))[0]; return pl ? V3(pl.x, pl.y + 1.6, pl.z) : null; };
    const held = this.item(me.held), heldFull = !!me.held && (me.held as Prop).left > 0.05;
    const grinder = () => this.hopper.clone().setY(this.hopper.y + 0.6);
    // the next step of the chain towards a bag of ground weed
    const toWeed = (): THREE.Vector3 | null => {
      if (held === 'weed' && heldFull) return null;
      if (has('weed', true)) return near('weed', true);
      if (this.buds > 0) return grinder();
      const intake = this.intake.clone().setY(this.intake.y + 0.6);
      if (held === 'bud') return intake;
      if (this.cargo > 0) return held === 'barrow' ? intake : this.barrow.synced.currP.clone().setY(this.barrow.synced.currP.y + 1);
      if (has('bud')) return near('bud');
      return ripe() ?? V3(this.fieldC.x, this.fieldC.y + 2, this.fieldC.z);
    };
    const mat = this.matC.clone().setY(this.matC.y + 0.5);
    switch (id) {
      case 'rollJoint': {
        if (held === 'joint') { const i = this.joints.indexOf(me.held as Prop); return i >= 0 && this.sealed[i] && this.lit[i] < G.time ? near('lighter') : null; }
        if (held === 'lighter' && has('joint')) return near('joint');
        if (has('joint')) return near('joint');
        if (!this.paperIn) return held === 'paper' ? mat : this.papersAt.clone().setY(this.papersAt.y + 0.4);
        if (!this.filterIn) return held === 'filter' ? mat : this.filtersAt.clone().setY(this.filtersAt.y + 0.4);
        if (this.fill < WEED.paperMin) return held === 'weed' && heldFull ? mat : toWeed();
        return mat;
      }
      case 'bongRip':
        if (this.bongWater < 0.3) return held === 'can' && heldFull ? this.bongTop.clone().setY(this.bongTop.y + 0.4) : near('can', true) ?? this.pump.spout;
        if (this.bongPacked < 0.3) return held === 'weed' && heldFull ? this.bongBowl.clone().setY(this.bongBowl.y + 0.4) : toWeed();
        if (this.bowlLit < G.time) return held === 'lighter' ? this.bongBowl.clone().setY(this.bongBowl.y + 0.4) : near('lighter');
        return this.bongTop.clone().setY(this.bongTop.y + 0.5);
      case 'bakeCookies': {
        const oven = this.ovenMark;
        if (this.trayIn || held === 'trayRaw') return oven;
        if (has('trayRaw')) return near('trayRaw');
        if (this.bowlMix >= 1) return held === 'bowl' ? near('tray') : this.bowl.synced.currP.clone().setY(this.bowl.synced.currP.y + 0.5);
        if (this.bowlMagic >= 0.6 && this.bowlFlour >= 0.6) return this.bowl.synced.currP.clone().setY(this.bowl.synced.currP.y + 0.5);
        if (this.potCook >= 1 && this.pot.left > 0) return held === 'pot' ? this.bowl.synced.currP.clone().setY(this.bowl.synced.currP.y + 0.5) : this.pot.synced.currP.clone().setY(this.pot.synced.currP.y + 0.5);
        if (this.bowlMagic >= 0.6) return held === 'flour' ? this.bowl.synced.currP.clone().setY(this.bowl.synced.currP.y + 0.5) : near('flour', true);
        const potAt = this.pot.synced.currP.clone().setY(this.pot.synced.currP.y + 0.5);
        if (!this.potButter && this.potCook < 1) return held === 'butter' ? potAt : near('butter') ?? this.L(-4.75, 1.6, -2.6);
        if (this.potWeed < 0.6) return held === 'weed' && heldFull ? potAt : toWeed();
        return potAt;
      }
      case 'beamWalk': return this.beamSpot.clone().setY(this.beamSpot.y + 1.5);
    }
    return null;
  }
}
