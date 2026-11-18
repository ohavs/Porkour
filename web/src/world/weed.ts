import * as THREE from 'three';
import { G } from '../game/ctx';
import type { Pig } from '../pig/pig';
import type { Prop } from './props';
import type { IconId } from '../game/icons';
import type { Rect } from './terrain';
import type { Kit } from './farmKit';
import { Chain, buildShed, buildBeam, need, type Station } from './chain';
import { plantGeometry, plantMaterial } from './chainProps';
import { staticBox, staticCylinder } from '../core/physics';
import { fitted } from '../core/assets';
import { toonMat } from '../render/toon';
import { V3, clamp } from '../core/util';

/**
 * Farm 6 — Bob's cannabis farm (user: "seeds, water to speed it up, harvest, wheelbarrow, the shed's grinding machine,
 * rolling papers + a filter + a lighter, bongs, cookies in the oven — I like all the options, combine them"). The chain:
 *   field (water with the can, refill at the pump · plant seeds · harvest ripe plants with the sickle or by hitting them)
 *   → buds → wheelbarrow (drop them in, push it to the shed; tip it and they spill)
 *   → grinder (crank: circle the mouse, not too fast) → bag of ground weed (3–4 pinches)
 *   → rolling table (fold the filter · sprinkle evenly · roll · lick) → joint → light it (strike the lighter, bring the flame
 *     to it — a friend can hold it) → puff
 *   → bong (fill water, pack a pinch, light + hold the breath in the band; too long = coughing fit Bob hears)
 *   → stove (butter + a pinch, stir so it doesn't burn) → magic butter → bowl (+ flour, knead) → tray → oven
 *     (take it out golden: too early = gooey and weak, too late = burnt + the smoke alarm)
 *   → cookies (kick in late, hit hard).
 * Everything made = points (the round's quota line). Then the high challenges (world/chain.ts).
 */
export const WEED = {
  dry: 1 / 55, grow: 1 / 62, pour: 0.42, drown: 1.05, bakeMin: 22, bakeMax: 34, alarm: 38, jointBuzz: 0.14, cookieBuzz: 0.45,
};
const POINTS: Record<string, number> = { bud: 5, weed: 20, joint: 40, bong: 40, magic: 40, cookies: 120 };

interface Plant { x: number; z: number; y: number; g: number; w: number; root: THREE.Group; stages: THREE.Mesh[]; puddle: THREE.Mesh; drop: THREE.Sprite; star: THREE.Sprite }

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
const flat = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

function iconSprite(draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  draw(c.getContext('2d')!);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.setScalar(0.45); s.renderOrder = 10; s.visible = false;
  return s;
}
const dropTex = (g: CanvasRenderingContext2D) => { g.beginPath(); g.moveTo(32, 6); g.bezierCurveTo(52, 30, 52, 56, 32, 58); g.bezierCurveTo(12, 56, 12, 30, 32, 6); g.fillStyle = '#4fb3ff'; g.fill(); g.lineWidth = 5; g.strokeStyle = '#3b2412'; g.stroke(); };
const starTex = (g: CanvasRenderingContext2D) => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 12 : 28; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); } g.closePath(); g.fillStyle = '#ffd166'; g.fill(); g.lineWidth = 4; g.strokeStyle = '#3b2412'; g.stroke(); };

export class Weed extends Chain {
  kind = 1 as const;
  plants: Plant[] = [];
  barrow!: Prop; cargo = 0;
  grinder!: Station; table!: Station; bong!: Station; stove!: Station; bowl!: Station; oven!: Station; fridge!: Station; pump!: Station;
  buds = 0; tableWeed = 0; bongWater = 0; bongPacked = 0; potButter = 0; potWeed = 0; bowlMagic = 0; bowlFlour = 0; ovenTray = 0; ovenT0 = 0; fridgeAt = 0; alarmAt = 0;
  /** Joints lit until (pool order) and lighter flames until. */
  private joints: Prop[] = []; private lit: number[] = []; private lighters: Prop[] = []; private flame: number[] = [];
  /** Joints rolled this round (the mission counts a puff on one of these), half-baked cookie trays. */
  private gooey = new Set<Prop>();
  private grinderOut = new THREE.Vector3(); private hopper = new THREE.Vector3(); private fieldC = new THREE.Vector3();
  private crank!: THREE.Object3D; private ovenGlow!: THREE.MeshToonMaterial; private ovenRing!: THREE.Mesh; private bongWaterM!: THREE.Mesh; private bongSmoke = 0;
  private potM!: THREE.Mesh; private bowlM!: THREE.Mesh;
  beamSpot = new THREE.Vector3();

  constructor(scene: THREE.Scene, props: Prop[], kit: Kit, o: { field: Rect; shed: [number, number, number]; pump: [number, number]; beam: [THREE.Vector3, THREE.Vector3]; barrow: [number, number] }) {
    super(scene, props);
    this.buildField(kit, o.field);
    this.buildShedStations(kit, o.shed);
    // the hand pump by the field (refill the watering cans)
    const [px, pz] = o.pump, py = kit.y(px, pz);
    const pumpG = new THREE.Group(); pumpG.position.set(px, py, pz); scene.add(pumpG);
    const iron = toonMat(0x3f8f5a), dk = toonMat(0x2b2b30);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 1.1, 10), iron); body.position.y = 0.55; pumpG.add(body);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.4, 8), iron); spout.position.set(0, 0.85, 0.22); spout.rotation.x = 1.2; pumpG.add(spout);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.8), dk); handle.position.set(0, 1.15, -0.3); handle.rotation.x = -0.4; pumpG.add(handle);
    const trough = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.5), toonMat(0x7a5232)); trough.position.set(0, 0.15, 0.55); pumpG.add(trough);
    const water = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.02, 0.4), toonMat(0x4fb3ff)); water.position.set(0, 0.28, 0.55); pumpG.add(water);
    staticCylinder(V3(px, py + 0.55, pz), 0.55, 0.2);
    this.pump = this.station({
      at: V3(px, py, pz + 0.9), r: 1.6, icon: 'can', markPos: V3(px, py + 1.6, pz),
      ready: () => false, steps: () => null, done: () => {},
      takes: (it) => (it.def.item === 'can' && it.left < (it.def.servings ?? 6) ? 'can' : null),
      take: (it, p) => { it.setLeft(it.def.servings ?? 6); G.audio.play('fill', { pos: p.pos, vol: 0.9 }); G.fx.bits(V3(px, py + 0.9, pz + 0.3), { count: 12, color: 0x7fd0ff, speed: 1.5, up: 1, life: 0.5, size: 0.08, grow: 0, alpha: 1 }); },
    });
    // the beam over the pond (high challenge)
    this.beamSpot.copy(o.beam[0]);
    buildBeam(kit, scene, o.beam[0], o.beam[1], 2.4, this.beams);
    // pools + the things lying around at the start
    this.pool('bud', 30); this.joints = this.pool('joint', 4); this.lit = this.joints.map(() => 0);
    this.pool('weedBag', 5); this.pool('magicButter', 2); this.pool('butter', 3); this.pool('trayRaw', 2); this.pool('cookies', 2); this.pool('cookiesBurnt', 2);
    const P = (kind: string, x: number, z: number, lift = 0) => { const pr = kit.prop(kind as never, x, z, 0, lift); return pr; };
    this.barrow = P('wheelbarrow', o.barrow[0], o.barrow[1]);
    const s = this.shedPlace;
    const at = (lx: number, lz: number) => s(lx, lz);
    const tbl = at(3.2, 0.9);
    this.lighters = [P('lighter', tbl.x + 0.3, tbl.z - 0.2, 0.85), P('lighter', at(-0.4, -2.8).x + 0.5, at(-0.4, -2.8).z, 1.0)]; this.flame = [0, 0];
    const fl = at(-4.6, -1.6); P('flour', fl.x, fl.z); P('flour', fl.x + 0.5, fl.z + 0.2);
    const fr = at(-3.6, -1.6); P('butter', fr.x, fr.z, 0.1);
    P('wateringCan', px + 1.2, pz + 0.4); P('wateringCan', o.field.x1 - 1.2, o.field.z1 + 1.6);
    P('seedBag', at(4.4, 1.4).x, at(4.4, 1.4).z); P('sickle', px - 1, pz + 0.6); P('sickle', at(-1.2, 1.6).x, at(-1.2, 1.6).z);
    // hits on ripe plants harvest them (headbutt / punch / weapon whack)
    G.hittables.push({ hit: (hx, _hy, hz, reach, dir, _k, by) => this.hitPlant(hx, hz, reach, dir, by as Pig) });
  }

  // ------------------------------------------------------------------ build
  private shedPlace!: (x: number, z: number) => THREE.Vector3;
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
      this.plants.push({ x, z, y, g: (r * cols + c) % 4 === 3 ? 0 : 0.15 + ((r + c) % 3) * 0.1, w: 0.3, root, stages, puddle, drop, star });
      kit.blocked.push({ x0: x - 0.7, x1: x + 0.7, z0: z - 0.7, z1: z + 0.7 });
    }
    G.terrain.noGrass({ x0: f.x0, x1: f.x1, z0: f.z0, z1: f.z1 });
  }

  private buildShedStations(kit: Kit, [cx, cz, yaw]: [number, number, number]) {
    const scene = this.scene;
    const sh = buildShed(kit, scene, cx, cz, yaw);
    const at = this.shedPlace = (x: number, z: number) => sh.place(x, z);
    const deco = (model: string, lx: number, lz: number, h: number, ry = 0, collide = true) => {
      const p = at(lx, lz), o = fitted(model, { height: h }); o.position.copy(p); o.rotation.y = yaw + ry; scene.add(o);
      if (collide) { const b = new THREE.Box3().setFromObject(o), s = b.getSize(v1); staticBox(V3(p.x, p.y + s.y / 2, p.z), V3(s.x / 2 * 0.9, s.y / 2, s.z / 2 * 0.9)); }
      return o;
    };
    const front = (lx: number, lz: number) => { const p = at(lx, lz); return p; };
    // back wall (local z = -3.5): fridge · stove · oven · counter with the bowl · the grinder · the bong
    deco('kaykit/fridge_A', -4.6, -2.95, 2.0);
    deco('kaykit/stove_single', -3.2, -2.95, 1.0);
    deco('kaykit/oven', -1.8, -2.95, 1.0);
    deco('kaykit/kitchencounter_straight_A', -0.4, -2.95, 1.0);
    deco('kaykit/shelf_papertowel_decorated', -1.1, -3.3, 0.5, 0, false).position.y += 1.6;
    // the pot on the stove + the bowl on the counter (fill shows what's in them)
    const potP = at(-3.2, -2.95); const pot = fitted('kaykit/pot_A', { height: 0.3 }); pot.position.set(potP.x, potP.y + 1.0, potP.z); scene.add(pot);
    this.potM = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 14), toonMat(0xe9d36a)); this.potM.position.set(potP.x, potP.y + 1.2, potP.z); this.potM.visible = false; scene.add(this.potM);
    const bowlP = at(-0.4, -2.95); const bowl = fitted('kaykit/bowl', { height: 0.22 }); bowl.position.set(bowlP.x, bowlP.y + 1.0, bowlP.z); scene.add(bowl);
    this.bowlM = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), toonMat(0xf2dcae)); this.bowlM.position.set(bowlP.x, bowlP.y + 1.06, bowlP.z); this.bowlM.visible = false; scene.add(this.bowlM);
    // oven window glow + the bake ring over it
    const ovP = at(-1.8, -2.45);
    this.ovenGlow = toonMat(0x2b2b30, { emissive: new THREE.Color(0) });
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3), this.ovenGlow); win.position.set(ovP.x, ovP.y + 0.45, ovP.z); win.rotation.y = yaw; scene.add(win);
    this.ovenRing = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.32, 32, 1, 0, Math.PI * 2), new THREE.MeshBasicMaterial({ color: 0xffd166, side: THREE.DoubleSide, depthTest: false, transparent: true }));
    this.ovenRing.position.set(ovP.x, ovP.y + 1.75, ovP.z); this.ovenRing.renderOrder = 9; this.ovenRing.visible = false; scene.add(this.ovenRing);
    // the grinder: a big hand-cranked machine (hopper on top, crank wheel on the side, chute at the front)
    const gP = at(2.2, -2.7), gy = gP.y;
    const mach = new THREE.Group(); mach.position.copy(gP); mach.rotation.y = yaw; scene.add(mach);
    const red = toonMat(0xc0453a), steel = toonMat(0xaab3bd), dk = toonMat(0x3a3d44), wood = toonMat(0x8a5a2a);
    const box = (g: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
    box(mach, 1.3, 0.9, 0.9, red, 0, 0.45, 0);
    for (const x of [-0.55, 0.55]) for (const z of [-0.35, 0.35]) box(mach, 0.12, 0.3, 0.12, dk, x, -0.0, z);
    const hop = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.22, 0.6, 12, 1, true), steel); hop.position.set(0, 1.2, 0); (hop.material as THREE.Material).side = THREE.DoubleSide; mach.add(hop);
    box(mach, 0.4, 0.25, 0.5, steel, 0, 0.3, 0.6).rotation.x = 0.4;   // chute
    const wheel = new THREE.Group(); wheel.position.set(0.72, 0.6, 0); mach.add(wheel);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.04, 6, 20), dk); rim.rotation.y = Math.PI / 2; wheel.add(rim);
    for (let k = 0; k < 4; k++) { const sp = box(wheel, 0.04, 0.74, 0.04, dk, 0, 0, 0); sp.rotation.x = k * Math.PI / 4; }
    const knob = box(wheel, 0.2, 0.08, 0.08, wood, 0.12, 0.34, 0); void knob;
    this.crank = wheel;
    staticBox(V3(gP.x, gy + 0.6, gP.z), V3(0.7, 0.6, 0.5), yaw);
    this.hopper.set(gP.x, gy + 1.5, gP.z);
    this.grinderOut.copy(at(2.2, -1.75)).setY(gy + 0.3);
    // rolling table: papers, a filter card, the lighter (props)
    deco('kaykit/kitchentable_A', 3.2, 0.9, 0.85);
    const papers = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.08), toonMat(0x5cb83d)); const pp = at(3.0, 0.8); papers.position.set(pp.x, pp.y + 0.86, pp.z); papers.rotation.y = yaw + 0.3; scene.add(papers);
    const card = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.01, 0.06), toonMat(0xe8c48a)); card.position.set(pp.x + 0.25, pp.y + 0.86, pp.z + 0.15); scene.add(card);
    // the bong on a stool by the side wall
    deco('kaykit/chair_stool', 4.6, -2.4, 0.7);
    const bP = at(4.6, -2.4), glass = toonMat(0x9fe8d6, { transparent: true, opacity: 0.55 });
    const bong = new THREE.Group(); bong.position.set(bP.x, bP.y + 0.72, bP.z); scene.add(bong);
    const base = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), glass); base.position.y = 0.2; base.scale.y = 0.9; bong.add(base);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.8, 12), glass); neck.position.y = 0.72; bong.add(neck);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), glass); stem.position.set(0.17, 0.32, 0); stem.rotation.z = -0.8; bong.add(stem);
    const bowlB = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.03, 0.08, 10), toonMat(0x8fdcc8)); bowlB.position.set(0.28, 0.42, 0); bong.add(bowlB);
    this.bongWaterM = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), toonMat(0x4fb3ff, { transparent: true, opacity: 0.7 }));
    this.bongWaterM.position.y = 0.2; bong.add(this.bongWaterM);
    // stations
    const ST = (lx: number, lz: number) => front(lx, lz);
    this.fridge = this.station({
      at: ST(-4.6, -1.5), r: 1.3, icon: 'butter', markPos: at(-4.6, -2.9).setY(sh.y0 + 2.4),
      ready: () => G.time > this.fridgeAt, steps: () => null,
      done: (p) => {
        if (G.time < this.fridgeAt) return;
        this.fridgeAt = G.time + 20;
        G.audio.play('creak', { pos: p.pos, vol: 0.6, pitch: 1.4 });
        this.spawn('butter', at(-4.6, -1.9).setY(sh.y0 + 0.6), yaw);
      },
    });
    this.stove = this.station({
      at: ST(-3.2, -1.5), r: 1.3, icon: 'butter', markPos: at(-3.2, -2.9).setY(sh.y0 + 1.9),
      ready: () => this.potButter > 0 && this.potWeed > 0, needs: () => need('butter', this.potButter) + need('leaf', this.potWeed),
      steps: () => [{ kind: 'stir', icon: 'butter', secs: 6, color: '#e9d36a' }],
      takes: (it) => (it.def.item === 'butter' && !this.potButter ? 'butter' : it.def.item === 'weed' && !this.potWeed ? 'leaf' : null),
      take: (it, p) => {
        if (it.def.item === 'butter') { this.potButter = 1; this.consume(it); } else { this.potWeed = 1; this.serve(it); }
        G.audio.play('sizzle', { pos: p.pos, vol: 0.5 });
      },
      done: (p, q) => {
        if (!this.potButter || !this.potWeed) return;
        if (q === 0) return;
        this.potButter = this.potWeed = 0;
        if (q === 4) { this.smokeAlarm(this.stove.markPos, p); return; }
        this.spawn('magicButter', at(-3.2, -1.9).setY(sh.y0 + 0.6), yaw);
        this.made('magic', p);
      },
    });
    this.bowl = this.station({
      at: ST(-0.4, -1.5), r: 1.3, icon: 'bowl', markPos: at(-0.4, -2.9).setY(sh.y0 + 1.7),
      ready: () => this.bowlMagic > 0 && this.bowlFlour > 0, needs: () => need('butter', this.bowlMagic) + need('bowl', this.bowlFlour),
      steps: () => [{ kind: 'swipe', icon: 'bowl', n: 10, color: '#f2dcae' }],
      takes: (it) => (it.def.item === 'magic' && !this.bowlMagic ? 'butter' : it.def.item === 'flour' && !this.bowlFlour ? 'bowl' : null),
      take: (it, p) => { if (it.def.item === 'magic') { this.bowlMagic = 1; this.consume(it); } else { this.bowlFlour = 1; this.serve(it); } G.audio.play('squish', { pos: p.pos, vol: 0.6 }); },
      done: (p, q) => {
        if (!this.bowlMagic || !this.bowlFlour || q === 0) return;
        this.bowlMagic = this.bowlFlour = 0;
        this.spawn('trayRaw', at(-0.4, -1.9).setY(sh.y0 + 0.6), yaw);
        G.audio.play('wood', { pos: p.pos, vol: 0.5 });
      },
    });
    this.oven = this.station({
      at: ST(-1.8, -1.5), r: 1.3, icon: 'oven', markPos: at(-1.8, -2.9).setY(sh.y0 + 1.9),
      ready: () => this.ovenTray > 0, steps: () => null, needs: () => (this.ovenTray ? '' : need('cookie', 0)),
      takes: (it) => (it.def.item === 'trayRaw' && !this.ovenTray ? 'oven' : null),
      take: (it, p) => { this.consume(it); this.ovenTray = 1; this.ovenT0 = G.time; this.alarmAt = 0; G.audio.play('clunk', { pos: p.pos, vol: 0.7 }); },
      done: (p) => {
        if (!this.ovenTray) return;
        const t = G.time - this.ovenT0, out = at(-1.8, -1.85).setY(sh.y0 + 0.6);
        this.ovenTray = 0;
        G.audio.play('clunk', { pos: p.pos, vol: 0.7, pitch: 1.2 });
        if (t > WEED.bakeMax) { this.spawn('cookiesBurnt', out, yaw); G.events.push({ type: 'burnt', who: p }); return; }
        const c = this.spawn('cookies', out, yaw);
        if (!c) return;
        if (t < WEED.bakeMin) { this.gooey.add(c); G.events.push({ type: 'gooey', who: p }); this.made('cookiesGooey', p, 40); }
        else { this.gooey.delete(c); this.made('cookies', p); G.events.push({ type: 'bakeCookies', who: p }); }
      },
    });
    this.grinder = this.station({
      at: ST(3.3, -1.7), r: 1.4, icon: 'gear', markPos: at(2.2, -2.7).setY(sh.y0 + 2.2),
      ready: () => this.buds >= 3, steps: () => [{ kind: 'crank', icon: 'gear', n: 3, speed: 10 }], needs: () => need('leaf', this.buds, 3),
      takes: (it) => (it.def.item === 'bud' ? 'gear' : null),
      take: (it, p) => { this.consume(it); this.buds++; G.audio.play('squish', { pos: p.pos, vol: 0.5, pitch: 1.3 }); },
      done: (p, q) => {
        if (this.buds < 3) return;
        if (q === 0) { this.buds -= 1; G.audio.play('metal', { pos: this.hopper, vol: 0.9, pitch: 0.5 }); G.noise(this.hopper, 12); return; }   // jammed: one bud chewed to nothing, loud
        this.buds -= 3;
        const bag = this.spawn('weedBag', this.grinderOut, yaw, V3(Math.sin(yaw) * 1.5, 1.5, Math.cos(yaw) * 1.5));
        if (bag && q === 3) bag.setLeft(4);
        G.fx.puff(this.grinderOut, { count: 8, color: 0x8fcf5a, speed: 0.8, up: 0.8, life: 0.8, size: 0.25, alpha: 0.6 });
        this.made('weed', p);
      },
    });
    this.table = this.station({
      at: ST(3.2, 2.1), r: 1.5, icon: 'paper', markPos: at(3.2, 0.9).setY(sh.y0 + 1.6),
      ready: () => this.tableWeed > 0, needs: () => need('leaf', this.tableWeed),
      steps: () => [
        { kind: 'timing', icon: 'paper', n: 3, zone: 0.18, speed: 1.1 },   // fold the filter (crutch): 3 folds
        { kind: 'sprinkle', icon: 'leaf', n: 8, color: '#5e9c3a' },          // fill the paper evenly
        { kind: 'swipe', icon: 'joint', n: 8, color: '#fff6e6' },            // roll it
        { kind: 'timing', icon: 'pig', n: 1, zone: 0.22, speed: 1.4 },       // lick + seal
      ],
      takes: (it) => (it.def.item === 'weed' ? 'leaf' : null),
      take: (it, p) => { this.tableWeed++; this.serve(it); G.audio.play('squish', { pos: p.pos, vol: 0.4, pitch: 1.5 }); },
      done: (p, q) => {
        if (!this.tableWeed || q === 0) return;
        this.tableWeed--;
        const j = this.spawn('joint', at(3.2, 0.9).setY(sh.y0 + 0.95), yaw);
        if (j) { j.setLeft(3 + q); this.lit[this.joints.indexOf(j)] = 0; }
        this.made('joint', p);
      },
    });
    this.bong = this.station({
      at: ST(3.6, -1.9), r: 1.3, icon: 'bong', markPos: bP.clone().setY(sh.y0 + 2.0),
      ready: () => this.bongWater > 0.1 && this.bongPacked > 0, needs: () => need('can', this.bongWater > 0.1 ? 1 : 0) + need('leaf', this.bongPacked),
      steps: () => [{ kind: 'timing', icon: 'lighter', n: 1, zone: 0.2, speed: 1.3 }, { kind: 'hold', icon: 'bong', speed: 0.8, zone: 0.25, color: '#dfe9e6' }],
      takes: (it) => (it.def.item === 'can' && it.left > 0 && this.bongWater < 0.9 ? 'can' : it.def.item === 'weed' && !this.bongPacked ? 'leaf' : null),
      take: (it, p) => {
        if (it.def.item === 'can') { this.bongWater = 1; this.pour(it); G.audio.play('pour', { pos: p.pos, vol: 0.8 }); }
        else { this.bongPacked = 1; this.serve(it); G.audio.play('squish', { pos: p.pos, vol: 0.4, pitch: 1.5 }); }
      },
      done: (p, q) => {
        if (!this.bongPacked || q === 0) return;
        this.bongPacked = 0; this.bongWater = Math.max(0, this.bongWater - 0.34); this.bongSmoke = G.time + 2;
        G.audio.play('fill', { pos: p.pos, vol: 0.8, pitch: 0.6 });
        if (q === 4) {   // held it too long: a coughing fit the whole farm hears
          p.addBuzz(1, 0.55, 60);
          G.audio.play('cough', { pos: p.pos, vol: 1 }); G.audio.play('squeal', { pos: p.pos, vol: 0.7, pitch: 0.8 });
          G.fx.puff(V3(p.pos.x, p.pos.y + 0.8, p.pos.z), { count: 22, color: 0xe8e8e8, speed: 2.2, up: 1.2, life: 2.2, size: 0.9, alpha: 0.6 });
          G.noise(p.pos, 16);
          G.events.push({ type: 'pigCough', who: p });
        } else {
          p.addBuzz(1, 0.25 + 0.12 * q, 40 + 10 * q);
          G.fx.puff(V3(p.pos.x, p.pos.y + 0.8, p.pos.z), { count: 10, color: 0xe8e8e8, speed: 1, up: 0.8, life: 2, size: 0.6, alpha: 0.5 });
        }
        G.events.push({ type: 'bongRip', who: p });
        this.made('bong', p);
      },
    });
  }

  // ------------------------------------------------------------------ host
  private made(kind: string, p: Pig, pts = POINTS[kind] ?? 10) { G.events.push({ type: 'made', who: p, text: kind, why: String(pts) }); }
  private smokeAlarm(at: THREE.Vector3, p: Pig | null) {
    G.audio.play('ring', { pos: at, vol: 1 }); G.audio.play('hiss', { pos: at, vol: 0.8 });
    G.fx.puff(at, { count: 30, color: 0x55575c, speed: 1.4, up: 1.6, life: 3, size: 1.2, alpha: 0.7 });
    G.noise(at, 34);
    G.events.push({ type: 'smokeAlarm', who: p });
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

  protected selfUse(p: Pig, h: Prop): boolean {
    const it = h.def.item, f = p.forward, fx = p.pos.x + f.x * 1.1, fz = p.pos.z + f.z * 1.1;
    switch (it) {
      case 'can': {
        const pond = G.places?.pond;
        if (pond && Math.hypot(p.pos.x - pond.x, p.pos.z - pond.z) < pond.r + 0.6) { h.setLeft(h.def.servings ?? 6); G.audio.play('fill', { pos: p.pos, vol: 0.8 }); return true; }
        if (h.left <= 0) return false;
        const pl = this.nearPlant(fx, fz, 1.6);
        this.pour(h);
        G.audio.play('pour', { pos: p.pos, vol: 0.8 });
        const hp = h.body.translation();
        G.fx.bits(v1.set(hp.x + f.x * 0.4, hp.y + 0.1, hp.z + f.z * 0.4), { count: 16, color: 0x7fd0ff, spread: 0.1, speed: 1.6, up: 0.4, grav: 9, life: 0.6, size: 0.07, grow: 0, alpha: 1 });
        if (pl) { pl.w = Math.min(1.25, pl.w + WEED.pour); if (pl.w > WEED.drown) G.audio.play('splash', { pos: v1.set(pl.x, pl.y, pl.z), vol: 0.4 }); }
        return true;
      }
      case 'seed': {
        const pl = this.nearPlant(fx, fz, 1.6, (x) => x.g <= 0.001);
        if (!pl) return false;
        pl.g = 0.02; pl.w = Math.max(pl.w, 0.2); this.serve(h);
        G.audio.play('mudstep', { pos: p.pos, vol: 0.6 });
        return true;
      }
      case 'sickle': {
        const pl = this.nearPlant(fx, fz, 1.7, (x) => x.g >= 1);
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
        if (i < 0 || this.lit[i] < G.time) return false;   // not lit: bring a flame to it
        this.serve(h);
        p.addBuzz(1, WEED.jointBuzz, 26);
        G.audio.play('fill', { pos: p.pos, vol: 0.35, pitch: 1.8 });
        G.fx.puff(V3(p.pos.x + f.x * 0.5, p.pos.y + (p.standing ? 0.9 : 0.4), p.pos.z + f.z * 0.5), { count: 6, color: 0xeeeeee, speed: 0.6, up: 0.7, life: 1.8, size: 0.45, alpha: 0.5 });
        G.noise(p.pos, 6);
        G.events.push({ type: 'puff', who: p });
        return true;
      }
      case 'cookies': {
        const weak = this.gooey.has(h);
        this.serve(h);
        p.addBuzz(1, weak ? 0.25 : WEED.cookieBuzz, 70, 10);
        G.audio.play('munch', { pos: p.pos, vol: 0.9 });
        G.events.push({ type: 'cookieEaten', who: p });
        if (p.buzz > 0.2) G.events.push({ type: 'munch', who: p });
        return true;
      }
      case 'burnt': {
        this.serve(h); G.audio.play('cough', { pos: p.pos, vol: 0.8 }); G.events.push({ type: 'pigCough', who: p });
        return true;
      }
    }
    return false;
  }
  protected selfIcon(p: Pig, h: Prop): IconId | '' {
    const f = p.forward, fx = p.pos.x + f.x * 1.1, fz = p.pos.z + f.z * 1.1;
    switch (h.def.item) {
      case 'can': { const pond = G.places?.pond; if (pond && Math.hypot(p.pos.x - pond.x, p.pos.z - pond.z) < pond.r + 0.6) return 'water'; return h.left > 0 && this.nearPlant(fx, fz, 1.6) ? 'can' : ''; }
      case 'seed': return this.nearPlant(fx, fz, 1.6, (x) => x.g <= 0.001) ? 'seed' : '';
      case 'sickle': return this.nearPlant(fx, fz, 1.7, (x) => x.g >= 1) ? 'sickle' : '';
      case 'lighter': return 'lighter';
      case 'joint': { const i = this.joints.indexOf(h); return i >= 0 && this.lit[i] > G.time ? 'joint' : ''; }
      case 'cookies': return 'cookie';
      case 'burnt': return 'cough';
    }
    return '';
  }
  private flamePos(l: Prop) { const p = l.body.translation(); return v2.set(p.x, p.y + 0.12, p.z); }

  protected tick(dt: number) {
    // Bob tends his crop: while he's on his garden round, the plants around him get a drink
    const bob = G.farmer;
    const tending = !!bob && bob.state === 'routine' && flat(bob.pos, this.fieldC) < 9;
    // plants: dry out, grow while watered, stall while drowned
    for (const pl of this.plants) {
      if (tending && flat(bob!.pos, pl) < 5) pl.w = Math.min(0.8, pl.w + dt * 0.05);
      pl.w = Math.max(0, pl.w - WEED.dry * dt * (G.mod === 'rain' ? -0.5 : 1));
      if (G.mod === 'rain') pl.w = Math.min(0.9, pl.w);
      if (pl.g > 0 && pl.g < 1 && pl.w > 0.05 && pl.w <= WEED.drown) pl.g = Math.min(1, pl.g + WEED.grow * dt * (pl.w > 0.35 ? 1 : 0.5));
    }
    // the wheelbarrow: buds dropped in become its load; tipped = it spills; parked by the grinder = it unloads
    const b = this.barrow, bp = b.body.translation(), bq = b.body.rotation();
    const q = new THREE.Quaternion(bq.x, bq.y, bq.z, bq.w), inv = q.clone().invert(), up = v1.set(0, 1, 0).applyQuaternion(q);
    if (!b.banked) {
      if (this.cargo < 12) for (const pr of this.props) {
        if (pr.def.item !== 'bud' || pr.banked || pr.heldBy) continue;
        const pp = pr.body.translation(), l = v2.set(pp.x - bp.x, pp.y - bp.y, pp.z - bp.z).applyQuaternion(inv);
        if (Math.abs(l.x) < 0.36 && Math.abs(l.z) < 0.48 && l.y > -0.1 && l.y < 0.9) { this.consume(pr); this.cargo++; G.audio.play('squish', { pos: pr.synced.currP, vol: 0.4, pitch: 1.3 }); }
      }
      if (this.cargo > 0 && up.y < 0.35) {
        for (let i = 0; i < this.cargo; i++) this.spawn('bud', V3(bp.x + (Math.random() - 0.5) * 0.8, bp.y + 0.3, bp.z + (Math.random() - 0.5) * 0.8), 0, V3((Math.random() - 0.5) * 3, 2, (Math.random() - 0.5) * 3));
        this.cargo = 0; G.audio.play('rustle', { pos: b.synced.currP, vol: 1 }); G.events.push({ type: 'barrowSpill' });
      }
      if (this.cargo > 0 && Math.hypot(bp.x - this.grinder.at.x, bp.z - this.grinder.at.z) < 2.8 && this.buds < 24) {
        const n = Math.min(this.cargo, 24 - this.buds); this.buds += n; this.cargo -= n;
        G.audio.play('squish', { pos: this.hopper, vol: 0.8 }); G.fx.bits(this.hopper, { count: 16, color: 0x8fcf5a, speed: 2, up: 2, life: 0.6, size: 0.1, grow: 0, alpha: 1 });
      }
    }
    // buds thrown into the hopper
    for (const pr of this.props) {
      if (pr.def.item !== 'bud' || pr.banked || pr.heldBy || this.buds >= 24) continue;
      const pp = pr.synced.currP;
      if (Math.hypot(pp.x - this.hopper.x, pp.z - this.hopper.z) < 0.6 && Math.abs(pp.y - this.hopper.y) < 0.6) { this.consume(pr); this.buds++; }
    }
    // lighters: a flame near an unlit joint lights it
    this.lighters.forEach((l, i) => {
      if (this.flame[i] < G.time || l.banked) return;
      const fp = this.flamePos(l);
      this.joints.forEach((j, k) => {
        if (j.banked || this.lit[k] > G.time) return;
        const jp = j.body.translation();
        if (Math.hypot(jp.x - fp.x, jp.y - fp.y, jp.z - fp.z) < 0.75) { this.lit[k] = G.time + 90; G.audio.play('crackle', { pos: fp, vol: 0.5 }); G.events.push({ type: 'litUp', who: (j.heldBy ?? l.heldBy) as Pig | null }); }
      });
    });
    // the oven: burning → smoke, then the alarm
    if (this.ovenTray) {
      const t = G.time - this.ovenT0;
      if (t > WEED.bakeMax && Math.random() < dt * 3) G.fx.puff(this.oven.markPos.clone().setY(this.oven.markPos.y - 1), { count: 3, color: 0x55575c, speed: 0.6, up: 1, life: 2, size: 0.6, alpha: 0.6 });
      if (t > WEED.alarm && G.time > this.alarmAt) { this.alarmAt = G.time + 8; this.smokeAlarm(this.oven.markPos, null); }
    }
  }
  protected resetMode() {
    this.plants.forEach((pl, i) => { pl.g = i % 4 === 3 ? 0 : 0.15 + (i % 3) * 0.1; pl.w = 0.3; });
    this.cargo = 0; this.buds = 0; this.tableWeed = 0; this.bongWater = 0; this.bongPacked = 0; this.potButter = this.potWeed = 0; this.bowlMagic = this.bowlFlour = 0;
    this.ovenTray = 0; this.fridgeAt = 0; this.alarmAt = 0; this.lit = this.lit.map(() => 0); this.flame = [0, 0]; this.gooey.clear();
  }

  // ------------------------------------------------------------------ every frame
  render(dt: number) {
    this.visions.render(dt);
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
    const cargo = this.barrow.obj.getObjectByName('cargo');
    if (cargo) { cargo.visible = this.cargo > 0; cargo.scale.setScalar(0.5 + 0.5 * Math.min(1, this.cargo / 12)); }
    this.crank.rotation.x -= dt * (this.buds >= 3 ? 0.4 : 0);
    // the oven: window colour = how done; the ring over it fills, golden in the window, red when burning
    const t = this.ovenTray ? G.time - this.ovenT0 : -1;
    const k = t < 0 ? 0 : Math.min(1, t / WEED.bakeMax);
    this.ovenGlow.emissive.setHex(t < 0 ? 0 : t < WEED.bakeMin ? 0x6a3a12 : t <= WEED.bakeMax ? 0xff9a2a : 0x3a1a0a).multiplyScalar(t < 0 ? 0 : 0.5 + 0.5 * Math.sin(G.time * 4) * (t > WEED.bakeMax ? 1 : 0.2));
    this.ovenRing.visible = t >= 0;
    if (t >= 0) {
      const ring = this.ovenRing;
      ring.geometry.dispose(); ring.geometry = new THREE.RingGeometry(0.22, 0.32, 32, 1, Math.PI / 2, -Math.PI * 2 * k);
      (ring.material as THREE.MeshBasicMaterial).color.setHex(t < WEED.bakeMin ? 0xfff6e6 : t <= WEED.bakeMax ? 0xffd166 : 0xff4a3a);
      const cam = (G as { cam?: THREE.Camera }).cam; if (cam) ring.quaternion.copy(cam.quaternion);
    }
    this.potM.visible = this.potButter > 0 || this.potWeed > 0;
    (this.potM.material as THREE.MeshToonMaterial).color.setHex(this.potWeed ? 0x9fbf4a : 0xe9d36a);
    this.bowlM.visible = this.bowlMagic > 0 || this.bowlFlour > 0;
    this.bongWaterM.scale.y = Math.max(0.01, this.bongWater);
    this.bongWaterM.visible = this.bongWater > 0.02;
    if (this.bongSmoke > G.time && Math.random() < dt * 6) G.fx.puff(this.bong.markPos.clone().setY(this.bong.markPos.y - 0.6), { count: 1, color: 0xeeeeee, speed: 0.3, up: 0.6, life: 1.6, size: 0.35, alpha: 0.4 });
    // lit joints smoulder, lighters show their flame
    this.joints.forEach((j, i) => {
      const e = j.obj.getObjectByName('ember') as THREE.Mesh | undefined; if (!e) return;
      const on = this.lit[i] > G.time && !j.banked;
      (e.material as THREE.MeshToonMaterial).emissive.setHex(on ? 0xff6a1a : 0);
      if (on && Math.random() < dt * 3) G.fx.puff(e.getWorldPosition(v1), { count: 1, color: 0xdddddd, speed: 0.15, up: 0.5, life: 1.4, size: 0.18, alpha: 0.4 });
    });
    this.lighters.forEach((l, i) => { if (this.flame[i] > G.time && !l.banked && Math.random() < dt * 20) G.fx.bits(this.flamePos(l), { count: 1, color: Math.random() < 0.5 ? 0xffb13a : 0xff6a1a, speed: 0.2, up: 0.8, life: 0.25, size: 0.07, grow: 0, alpha: 1 }); });
  }

  // ------------------------------------------------------------------ net (≤ 64 numbers)
  netState(n: number[]) {
    for (const pl of this.plants) n.push(Math.round(pl.g * 100) / 100, Math.round(pl.w * 100) / 100);
    n.push(this.cargo, this.buds, this.tableWeed, Math.round(this.bongWater * 100) / 100, this.bongPacked, this.potButter, this.potWeed, this.bowlMagic, this.bowlFlour,
      this.ovenTray, this.ovenT0, this.fridgeAt, ...this.lit, ...this.flame);
  }
  netApply(n: number[]) {
    if (n.length < this.plants.length * 2 + 12) return;
    this.plants.forEach((pl, i) => { pl.g = n[i * 2]; pl.w = n[i * 2 + 1]; });
    let j = this.plants.length * 2;
    [this.cargo, this.buds, this.tableWeed, this.bongWater, this.bongPacked, this.potButter, this.potWeed, this.bowlMagic, this.bowlFlour, this.ovenTray, this.ovenT0, this.fridgeAt] = n.slice(j, j + 12);
    j += 12;
    this.lit = this.lit.map((_, i) => n[j + i] ?? 0); j += this.lit.length;
    this.flame = this.flame.map((_, i) => n[j + i] ?? 0);
  }

  // ------------------------------------------------------------------ admin + arrows
  adminButtons(): [string, string][] {
    return [['weed:ripe', 'a.weedRipe'], ['weed:water', 'a.weedWater'], ['weed:buds', 'a.weedBuds'], ['weed:bag', 'a.weedBag'], ['weed:joint', 'a.weedJoint'],
      ['weed:high', 'a.weedHigh'], ['weed:cookies', 'a.weedCookies'], ['tp:shed', 'a.tpShed'], ['tp:field', 'a.tpField'], ['tp:beam', 'a.tpBeam']];
  }
  admin(a: string, me: Pig): boolean {
    const f = me.forward, front = V3(me.pos.x + f.x * 1.3, me.pos.y + 0.5, me.pos.z + f.z * 1.3);
    switch (a) {
      case 'weed:ripe': for (const pl of this.plants) if (pl.g > 0) pl.g = 1; return true;
      case 'weed:water': for (const pl of this.plants) pl.w = 0.8; return true;
      case 'weed:buds': for (let i = 0; i < 6; i++) this.spawn('bud', front.clone().add(V3((i % 3 - 1) * 0.3, 0.2 * i, 0)), 0); return true;
      case 'weed:bag': this.spawn('weedBag', front, me.yaw); return true;
      case 'weed:joint': { const j = this.spawn('joint', front, me.yaw); if (j) this.lit[this.joints.indexOf(j)] = G.time + 90; return true; }
      case 'weed:high': me.addBuzz(1, 0.9, 90); return true;
      case 'weed:cookies': this.spawn('cookies', front, me.yaw); return true;
    }
    return false;
  }
  markFor(id: string, me: Pig): THREE.Vector3 | null {
    const has = (item: string) => this.props.some((p) => !p.banked && p.def.item === item);
    const near = (item: string) => { let best: Prop | null = null, bd = Infinity; for (const p of this.props) { if (p.banked || p.def.item !== item) continue; const d = flat(p.synced.currP, me.pos); if (d < bd) { bd = d; best = p; } } return best?.synced.currP.clone().setY(best.synced.currP.y + 0.3) ?? null; };
    const ripe = () => { const pl = this.plants.filter((x) => x.g >= 1).sort((a, b) => flat(a, me.pos) - flat(b, me.pos))[0]; return pl ? V3(pl.x, pl.y + 1.6, pl.z) : null; };
    // the next step of the chain towards a bag of ground weed
    const toWeed = (): THREE.Vector3 | null => {
      if (has('weed')) return near('weed');
      if (this.buds >= 3) return this.grinder.markPos;
      if (this.cargo > 0) return this.barrow.synced.currP.clone().setY(this.barrow.synced.currP.y + 1);
      if (has('bud')) return near('bud');
      return ripe() ?? V3(this.fieldC.x, this.fieldC.y + 2, this.fieldC.z);
    };
    const held = this.item(me.held);
    switch (id) {
      case 'rollJoint':
        if (held === 'joint') return null;
        if (has('joint')) return near('joint');
        if (this.tableWeed > 0) return this.table.markPos;
        if (held === 'weed') return this.table.markPos;
        return toWeed();
      case 'bongRip':
        if (this.bongPacked && this.bongWater > 0.1) return this.bong.markPos;
        if (held === 'weed' || held === 'can') return this.bong.markPos;
        return this.bongWater > 0.1 ? toWeed() : near('can');
      case 'bakeCookies':
        if (this.ovenTray) return this.oven.markPos;
        if (held === 'trayRaw') return this.oven.markPos;
        if (has('trayRaw')) return near('trayRaw');
        if (held === 'magic' || held === 'flour') return this.bowl.markPos;
        if (has('magic')) return this.bowlFlour ? near('magic') : near('flour');
        if (held === 'butter' || held === 'weed') return this.stove.markPos;
        if (!this.potButter) return has('butter') ? near('butter') : this.fridge.markPos;
        return toWeed();
      case 'beamWalk': return this.beamSpot.clone().setY(this.beamSpot.y + 1.5);
    }
    return null;
  }
}
