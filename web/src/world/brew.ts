import * as THREE from 'three';
import { G } from '../game/ctx';
import type { Pig } from '../pig/pig';
import type { Prop } from './props';
import { IC, type IconId } from '../game/icons';
import type { Rect } from './terrain';
import type { Kit } from './farmKit';
import { Chain, buildShed, buildBeam, need, fillable, Pump } from './chain';
import { wheatGeometry, plantMaterial, makeSheaf, makeSpoon } from './chainProps';
import { HANDS, crank, lever, type Handle, type Socket } from './hands';
import { staticBox, staticCylinder } from '../core/physics';
import { fitted } from '../core/assets';
import { toonMat } from '../render/toon';
import { V3 } from '../core/util';
import { CENTER } from '../pig/pigBody';
import { t } from '../i18n';
const kcJump = () => t('key.space');

/**
 * Farm 7 — Bob grows wheat; the pigs brew beer (user: "the same idea as the cannabis farm: make beer and drink it"),
 * all with the hooves (world/hands.ts: aim, R tips what you hold, things snap where they go):
 *   wheat field (scythe it — or headbutt it — each patch drops a sheaf)
 *   → threshing floor (drop sheaves on it, then JUMP on them; a drum keeps the beat: stomps on the beat count double —
 *     all four pigs jumping together is fastest) → grain sack
 *   → the mill in the shed: tip the grain sack over the hopper, turn the crank (circle the mouse) → malt fills the sack
 *     under the chute
 *   → the kettle over the fire pit: water ×2 (fill a bucket at the pump — park it on the stone, pump the handle — and
 *     tip it into the kettle), tip the malt sack in, throw logs on the fire, take the paddle and stir the mash, drop
 *     2 hops in (shake them off the hop poles) → it boils → roll the barrel under the spigot (bung up), pull the spigot
 *     lever: the wort runs into the barrel (miss it = it's on the ground)
 *   → the barrel ferments (bubbles, ~30 s) → hold a mug under its tap and pull the tap's lever (a full mug foams over)
 *     → click = a sip (3 per mug; burp: loud) → drunk challenges (world/chain.ts + serenading Bob, dancing on the table).
 */
export const BREW = { boil: 12, ferment: 30, fuelLog: 70, beat: 0.75, beatWin: 0.17, stompNeed: 6, mugBuzz: 0.17, mashTurns: 6, millTurn: 0.5, wort: 3, barrelNeed: 2.6, beer: 24 };
const POINTS: Record<string, number> = { sheaf: 5, grain: 15, maltUnit: 8, wort: 60, barrel: 80, mug: 30 };

interface Patch { x: number; z: number; y: number; cut: boolean; up: THREE.Mesh; down: THREE.Mesh }

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
const flat = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

export class Brew extends Chain {
  kind = 2 as const;
  patches: Patch[] = [];
  pump: Pump;
  // the mill
  grainIn = 0; private millProg = 0; private millCrank!: Handle; private maltSock!: Socket; private millWheel!: THREE.Object3D; private millHopper = new THREE.Vector3(); private millOut = new THREE.Vector3();
  /** Kettle: water (need 2), malt (need 1), mash (stirred, 0..1), hops (need 2), fuel (s of fire left), stage 0 filling · 1 mashed (add hops) · 2 boiling (since `boilT`) · 3 ready (wort left). */
  water = 0; malt = 0; mash = 0; hops = 0; fuel = 0; stage = 0; boilT = 0; wort = 0;
  private paddle!: Handle; private paddleM!: THREE.Object3D; private spigot!: Handle; private spigotM!: THREE.Object3D; private spout = new THREE.Vector3();
  /** The barrel: 0 empty (wort in it so far: barrelWort) · 1 fermenting (since fermT) · 2 beer (beer left, units: 3 = a mug). */
  barrelState = 0; barrelWort = 0; fermT = 0; beer = 0;
  barrel!: Prop; private tapH!: Handle; private tapM!: THREE.Object3D;
  private floorC = new THREE.Vector3(); private floorR = 2.3; private beatT0 = 0;
  /** Threshing: sheaves dropped on the floor become straw piles there (up to 6); stomps thresh the next one. */
  floorSheaves = 0; private floorProg = 0; private piles: THREE.Object3D[] = []; private airborne = new Map<Pig, number>();
  private poles: { x: number; z: number; y: number; next: number; obj: THREE.Object3D }[] = [];
  private fireC = new THREE.Vector3(); private fireLight!: THREE.PointLight; private flames!: THREE.Group; private brewM!: THREE.Mesh; private floorRing!: THREE.Mesh;
  private tableTop = new THREE.Vector3(); private dance = new Map<Pig, number>(); private songs = new Map<Pig, number[]>();
  private burpAt = new Map<Pig, number>();
  /** Mugs each pig has finished this round (the "everyone drinks up" mission). */
  drunkMugs = new Map<Pig, number>();
  fieldC = new THREE.Vector3(); beamSpot = new THREE.Vector3();
  private kettleTop = new THREE.Vector3();
  /** Where the arrows point at the tap (follows the barrel). */
  tap = { markPos: new THREE.Vector3() };

  constructor(scene: THREE.Scene, props: Prop[], kit: Kit, o: { field: Rect; shed: [number, number, number]; pump: [number, number]; beam: [THREE.Vector3, THREE.Vector3]; floor: [number, number]; table: [number, number, number] }) {
    super(scene, props);
    this.pool('sheaf', 16); this.pool('grain', 6); this.pool('malt', 3); this.pool('hops', 10);
    this.buildField(kit, o.field);
    this.buildShedStations(kit, o.shed);
    this.pump = new Pump(kit, scene, o.pump[0], o.pump[1], 0);
    this.buildYard(kit, o);
    this.beamSpot.copy(o.beam[0]);
    buildBeam(kit, scene, o.beam[0], o.beam[1], 2.4, this.beams);
    fillable(this.props, 'can', 'water', 3);
    fillable(this.props, 'beer', 'beer', 3);
    G.hittables.push({ hit: (hx, _hy, hz, reach, dir, _k, by) => this.hit(hx, hz, reach, dir, by as Pig) });
  }

  // ------------------------------------------------------------------ build
  private buildField(kit: Kit, f: Rect) {
    const up = wheatGeometry(false), down = wheatGeometry(true), mat = plantMaterial();
    const cols = 6, rows = 4, dx = (f.x1 - f.x0) / cols, dz = (f.z1 - f.z0) / rows;
    this.fieldC.set((f.x0 + f.x1) / 2, kit.y((f.x0 + f.x1) / 2, (f.z0 + f.z1) / 2), (f.z0 + f.z1) / 2);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = f.x0 + dx * (c + 0.5), z = f.z0 + dz * (r + 0.5), y = kit.y(x, z);
      const a = new THREE.Mesh(up, mat), b = new THREE.Mesh(down, mat);
      for (const m of [a, b]) { m.position.set(x, y, z); m.rotation.y = (r * 7 + c) * 0.9; m.scale.set(dx / 1.0, 1.15, dz / 1.0); m.castShadow = m === a; this.scene.add(m); }
      b.visible = false;
      this.patches.push({ x, z, y, cut: false, up: a, down: b });
      G.cover.circle('crop', x, z, Math.min(dx, dz) * 0.55, y, 1.2);
    }
    G.terrain.noGrass({ x0: f.x0, x1: f.x1, z0: f.z0, z1: f.z1 });
  }

  private buildShedStations(kit: Kit, [cx, cz, yaw]: [number, number, number]) {
    const scene = this.scene, sh = buildShed(kit, scene, cx, cz, yaw);
    this.shedAt.set(cx, sh.y0, cz); this.shedR = 5.2; this.shedRoof = sh.roof;
    const at = (x: number, z: number) => sh.place(x, z);
    const qs = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), fwd = V3(Math.sin(yaw), 0, Math.cos(yaw));
    const deco = (model: string, lx: number, lz: number, h: number, collide = true) => {
      const p = at(lx, lz), o = fitted(model, { height: h }); o.position.copy(p); o.rotation.y = yaw; scene.add(o);
      if (collide) { const b = new THREE.Box3().setFromObject(o), s = b.getSize(v1); staticBox(V3(p.x, p.y + s.y / 2, p.z), V3(s.x / 2 * 0.9, s.y / 2, s.z / 2 * 0.9)); }
      return o;
    };
    // the mill — the same machine as the cannabis grinder, painted blue: grain poured in the hopper, the crank on the
    // front, malt into the sack under the chute
    const gP = at(-2.5, -2.7);
    const mach = new THREE.Group(); mach.position.copy(gP); mach.rotation.y = yaw; scene.add(mach);
    const blue = toonMat(0x3d6fd1), steel = toonMat(0xaab3bd), dk = toonMat(0x3a3d44), wood = toonMat(0x8a5a2a);
    const box = (g: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
    box(mach, 1.3, 0.9, 0.9, blue, 0, 0.45, 0);
    const hop = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.22, 0.6, 12, 1, true), steel); hop.position.set(0, 1.2, 0); (hop.material as THREE.Material).side = THREE.DoubleSide; mach.add(hop);
    box(mach, 0.3, 0.22, 0.4, steel, 0.42, 0.32, 0.6).rotation.x = 0.5;
    const wheel = new THREE.Group(); wheel.position.set(-0.32, 0.55, 0.5); mach.add(wheel);
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 6, 20), dk));
    for (let k = 0; k < 4; k++) { const sp = box(wheel, 0.035, 0.56, 0.035, dk, 0, 0, 0); sp.rotation.z = k * Math.PI / 4; }
    const kn = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 8), wood); kn.rotation.x = Math.PI / 2; kn.position.set(0.28, 0, 0.08); wheel.add(kn);
    this.millWheel = wheel;
    staticBox(V3(gP.x, gP.y + 0.6, gP.z), V3(0.7, 0.6, 0.5), yaw);
    mach.updateMatrixWorld(true);
    this.millHopper.copy(mach.localToWorld(V3(0, 1.45, 0)));
    this.millOut.copy(mach.localToWorld(V3(0.42, 0.22, 0.75)));
    HANDS.receiver({ r: 0.5, at: (out) => out.copy(this.millHopper), accepts: (st) => st === 'grain' && this.grainIn < 6,
      fill: (_s, a) => { this.grainIn = Math.min(6, this.grainIn + a); } });
    this.maltSock = HANDS.socket({ icon: 'gear', p: mach.localToWorld(V3(0.42, 0.24, 0.92)), q: qs, on: null, r: 0.35, dock: true, anyYaw: true,
      accepts: (it) => it.def.item === 'malt' && it.left < 3 });
    this.millCrank = crank({ c: mach.localToWorld(V3(-0.32, 0.55, 0.58)), axis: fwd, r: 0.28, icon: 'gear', max: 10,
      turn: (d, p) => this.mill(d, p) });
    for (const [lx, lz] of [[2.5, -2.8], [3.5, -2.8], [4.5, -2.6]] as const) deco('brew/Barrel', lx, lz, 1.1);
    deco('brew/Bag', 4.6, -1.0, 0.7, false); deco('brew/Bag_Open', -4.6, -2.6, 0.7, false);
    this.spot({ at: at(-2.5, -1.5), r: 1.5, markPos: at(-2.5, -2.7).setY(sh.y0 + 2.2), needs: () => need('wheat', this.grainIn >= 0.5 ? 1 : 0) });
  }

  private buildYard(kit: Kit, o: { pump: [number, number]; floor: [number, number]; table: [number, number, number] }) {
    const scene = this.scene;
    const [px, pz] = o.pump;
    // the kettle: a cauldron over a fire pit, a little in front of the shed's open side
    const [fx, fz] = [o.pump[0] + 4.5, o.pump[1] + 1.5], fy = kit.y(fx, fz);
    this.fireC.set(fx, fy, fz);
    const ring = new THREE.Group(); ring.position.copy(this.fireC); scene.add(ring);
    const stone = toonMat(0x8a8f99);
    for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2, s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22), stone); s.position.set(Math.cos(a) * 0.85, 0.12, Math.sin(a) * 0.85); s.rotation.set(k, k * 2, 0); ring.add(s); }
    const logs = fitted('kenney/campfire_logs', { height: 0.35 }); ring.add(logs);
    const caul = fitted('village/Cauldron', { height: 1.1 }); caul.position.set(fx, fy + 0.25, fz); scene.add(caul);
    this.kettleTop.set(fx, fy + 1.12, fz);
    this.brewM = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 16), toonMat(0x6fb7e8)); this.brewM.position.copy(this.kettleTop); this.brewM.visible = false; scene.add(this.brewM);
    this.flames = new THREE.Group(); this.flames.position.copy(this.fireC); scene.add(this.flames);
    for (let k = 0; k < 5; k++) { const fl = new THREE.Mesh(new THREE.ConeGeometry(0.12 + (k % 2) * 0.05, 0.5, 6), toonMat(k % 2 ? 0xffb13a : 0xff6a1a, { emissive: new THREE.Color(k % 2 ? 0xffb13a : 0xff6a1a) })); fl.position.set(Math.cos(k * 1.3) * 0.25, 0.3, Math.sin(k * 1.3) * 0.25); this.flames.add(fl); }
    this.flames.visible = false;
    this.fireLight = new THREE.PointLight(0xff9a3a, 0, 8, 1.5); this.fireLight.position.set(fx, fy + 0.8, fz); scene.add(this.fireLight);
    staticCylinder(V3(fx, fy + 0.6, fz), 0.6, 0.75);
    kit.blocked.push({ x0: fx - 2, x1: fx + 2, z0: fz - 2, z1: fz + 2 });
    // pour water / malt over the rim; drop hops in; throw logs on the fire; stir with the paddle
    HANDS.receiver({ r: 0.5, at: (out) => out.copy(this.kettleTop),
      accepts: (st) => this.stage === 0 && ((st === 'water' && this.water < 2) || (st === 'malt' && this.malt < 1)),
      fill: (st, a) => { if (st === 'water') this.water = Math.min(2, this.water + a); else this.malt = Math.min(1, this.malt + a); G.audio.play('splash', { pos: this.kettleTop, vol: 0.3, minGap: 0.5 }); } });
    HANDS.socket({ icon: 'fire', p: this.kettleTop.clone().setY(this.kettleTop.y + 0.1), q: new THREE.Quaternion(), on: null, r: 0.45, dock: false, bin: true,
      accepts: (it) => it.def.item === 'hops' && this.stage === 1 && this.hops < 2,
      onSnap: (it) => { this.consume(it); this.hops++; G.audio.play('splash', { pos: this.kettleTop, vol: 0.3, pitch: 1.4 }); if (this.hops >= 2) { this.stage = 2; this.boilT = G.time; } } });
    HANDS.socket({ icon: 'fire', p: this.fireC.clone().setY(fy + 0.35), q: new THREE.Quaternion(), on: null, r: 1.15, dock: false, bin: true, ghost: false,
      accepts: (it) => it.def.item === 'log' && this.fuel < 200,
      onSnap: (it) => { this.fuel = Math.min(240, this.fuel + BREW.fuelLog); this.consume(it); G.audio.play('crackle', { pos: this.fireC, vol: 0.8 }); } });
    this.paddle = crank({ c: this.kettleTop.clone().setY(this.kettleTop.y + 0.12), axis: V3(0, 1, 0), r: 0.18, icon: 'stir', max: 7,
      ready: () => this.stage === 0 && this.water >= 1.9 && this.malt >= 0.9 && this.fuel > 0,
      turn: (d) => {
        this.mash = Math.min(1, this.mash + Math.abs(d) / (Math.PI * 2) / BREW.mashTurns);
        G.audio.play('splash', { pos: this.kettleTop, vol: 0.25, pitch: 0.7, minGap: 0.6 });
        if (this.mash >= 1) { this.stage = 1; this.paddle.heldBy?.letGo(); G.audio.play('fill', { pos: this.fireC, vol: 0.6, pitch: 0.5 }); }
      } });
    this.paddleM = makeSpoon(1.0, true); this.paddleM.visible = false; scene.add(this.paddleM);
    // the spigot on the kettle's side (toward the barrel's corner): pull the lever, the wort runs out
    const side = V3(1, 0, 0.6).normalize();
    const pivot = this.fireC.clone().addScaledVector(side, 0.7).setY(fy + 0.62);
    this.spout.copy(this.fireC).addScaledVector(side, 0.86).setY(fy + 0.5);
    const sg = new THREE.Group(); sg.position.copy(pivot); sg.rotation.y = Math.atan2(side.x, side.z); scene.add(sg);
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 8), toonMat(0xc9a24a)); pipe.rotation.x = Math.PI / 2; pipe.position.z = 0.08; sg.add(pipe);
    this.spigotM = new THREE.Group(); sg.add(this.spigotM);
    const lv = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.04), toonMat(0x3a3d44)); lv.position.y = 0.11; this.spigotM.add(lv);
    const lk = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), toonMat(0xc0453a)); lk.position.y = 0.22; this.spigotM.add(lk);
    const tang = V3(side.z, 0, -side.x);
    this.spigot = lever({ pivot, axis: tang, arm: V3(0, 0.22, 0), min: -1.3, max: 1.3, icon: 'lever', speed: 5, ready: () => true });
    this.spot({ at: this.fireC, r: 2.4, markPos: V3(fx, fy + 2.1, fz),
      needs: () => (this.stage === 0 ? need('water', this.water, 2) + need('wheat', this.malt >= 0.9 ? 1 : 0) + need('fire', this.fuel > 0 ? 1 : 0) + need('stir', this.mash >= 1 ? 1 : 0)
        : this.stage === 1 ? need('leaf', this.hops, 2) + need('fire', this.fuel > 0 ? 1 : 0) : this.stage === 2 ? need('fire', this.fuel > 0 ? 1 : 0) + `<b>${Math.max(0, Math.ceil(BREW.boil - (G.time - this.boilT)))}</b>` : need('barrel', 0)) });
    // hop poles (hit one: hop cones drop)
    for (let k = 0; k < 3; k++) {
      const x = fx - 3 + k * 1.6, z = fz + 4.2, y = kit.y(x, z);
      const g = new THREE.Group(); g.position.set(x, y, z); scene.add(g);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.2, 6), toonMat(0x8a5a2a)); pole.position.y = 1.6; g.add(pole);
      const vine = toonMat(0x4fa636), cone = toonMat(0x9fd36a);
      for (let i = 0; i < 9; i++) {
        const a = i * 1.1, h = 0.4 + i * 0.3;
        const lf = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 5), vine); lf.position.set(Math.cos(a) * 0.15, h, Math.sin(a) * 0.15); lf.scale.set(1, 0.6, 1); g.add(lf);
        if (i % 2) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 6), cone); c.position.set(Math.cos(a + 1) * 0.24, h - 0.1, Math.sin(a + 1) * 0.24); c.rotation.x = Math.PI; g.add(c); }
      }
      staticCylinder(V3(x, y + 1.6, z), 1.6, 0.1);
      this.poles.push({ x, z, y, next: 0, obj: g });
    }
    // threshing floor: a round of flat stones; a drum beats while there's wheat on it
    const [tx, tz] = o.floor, ty = kit.y(tx, tz);
    this.floorC.set(tx, ty, tz);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(this.floorR, this.floorR + 0.1, 0.12, 28), toonMat(0xb9b2a4)); disc.position.set(tx, ty + 0.03, tz); disc.receiveShadow = true; scene.add(disc);
    for (let k = 0; k < 14; k++) { const a = k * 2.3, r = 0.4 + (k % 4) * 0.45, s = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.13, 7), toonMat(k % 2 ? 0xa8a090 : 0xc4bcae)); s.position.set(tx + Math.cos(a) * r, ty + 0.05, tz + Math.sin(a) * r); scene.add(s); }
    this.floorRing = new THREE.Mesh(new THREE.TorusGeometry(this.floorR, 0.06, 6, 40), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0 }));
    this.floorRing.rotation.x = Math.PI / 2; this.floorRing.position.set(tx, ty + 0.15, tz); scene.add(this.floorRing);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.5, 14), toonMat(0xc0453a)); drum.position.set(tx + this.floorR + 0.6, ty + 0.25, tz); scene.add(drum);
    for (let k = 0; k < 6; k++) {   // straw piles on the floor (shown per sheaf dropped there)
      const pile = makeSheaf(), a = k * 1.05; pile.position.set(tx + Math.cos(a) * (0.5 + (k % 2) * 0.8), ty + 0.15, tz + Math.sin(a) * (0.5 + (k % 2) * 0.8));
      pile.rotation.set(0, a, Math.PI / 2); pile.visible = false; scene.add(pile); this.piles.push(pile);
    }
    G.terrain.noGrass({ x0: tx - 3, x1: tx + 3, z0: tz - 3, z1: tz + 3 });
    kit.blocked.push({ x0: tx - 3, x1: tx + 3, z0: tz - 3, z1: tz + 3 });
    // the beer-garden table (dance on it drunk) + benches; empty mugs on it
    const [bx, bz, byaw] = o.table, by = kit.y(bx, bz), wood = toonMat(0x9a6a3c), dark = toonMat(0x6e4524);
    const tg = new THREE.Group(); tg.position.set(bx, by, bz); tg.rotation.y = byaw; scene.add(tg);
    const top = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 1.1), wood); top.position.y = 0.85; top.castShadow = true; tg.add(top);
    for (const x of [-1.3, 1.3]) for (const z of [-0.4, 0.4]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.85, 0.1), dark); l.position.set(x, 0.42, z); tg.add(l); }
    for (const z of [-0.95, 0.95]) { const bn = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.08, 0.35), wood); bn.position.set(0, 0.45, z); tg.add(bn); staticBox(V3(bx + Math.sin(byaw) * z, by + 0.45, bz + Math.cos(byaw) * z), V3(1.5, 0.05, 0.17), byaw); }
    staticBox(V3(bx, by + 0.85, bz), V3(1.6, 0.06, 0.55), byaw);
    this.tableTop.set(bx, by + 0.91, bz);
    kit.blocked.push({ x0: bx - 2.5, x1: bx + 2.5, z0: bz - 2.5, z1: bz + 2.5 });
    for (let i = 0; i < 6; i++) { const u = -1.2 + i * 0.48; kit.prop('beerMug', bx + Math.cos(byaw) * u, bz - Math.sin(byaw) * u, byaw, 0.92); }
    // things lying around: buckets, scythes, logs by the fire, the barrel
    kit.prop('bucket', px + 1.4, pz - 0.6, 0); kit.prop('bucket', fx - 1.6, fz - 1.2, 0);
    kit.prop('scythe', this.fieldC.x + 8, this.fieldC.z + 8.5, 0.4); kit.prop('scythe', px - 1.2, pz + 0.8, 1.2);
    kit.prop('log', fx + 1.8, fz - 0.6, 0.3); kit.prop('log', fx + 2.1, fz + 0.4, 1.1); kit.prop('log', fx + 2.6, fz - 0.1, 0.2); kit.prop('log', fx - 2.2, fz + 1.4, 0.8);
    this.barrel = kit.prop('beerBarrel', fx + 2.2, fz + 2.4, 0);
    // the barrel's bung (top, cork up): the wort goes in there
    HANDS.receiver({ r: 0.22, at: (out) => { const t = this.barrel.body.translation(); return out.set(t.x, t.y + 0.36, t.z); },
      accepts: (st) => st === 'wort' && this.barrelState === 0 && this.corkUp(),
      fill: (_s, a, by) => { this.barrelWort += a; if (this.barrelWort >= BREW.barrelNeed) { this.barrelState = 1; this.fermT = G.time; this.barrelWort = 0; this.made('barrel', by); G.audio.play('clunk', { pos: this.barrel.synced.currP, vol: 0.6 }); } } });
    // its tap (on the end face): pull the little lever and the beer runs into whatever is under it
    const frame = () => ({ p: this.barrel.synced.currP, q: this.barrel.synced.currQ });
    this.tapH = lever({ pivot: V3(0.44, -0.04, 0), axis: V3(0, 0, 1), arm: V3(0, 0.14, 0), min: -1.1, max: 1.1, icon: 'beer', speed: 5, frame,
      ready: () => this.barrelState === 2 });
    this.tapM = new THREE.Group(); this.barrel.obj.add(this.tapM);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.03), toonMat(0xc9a24a)); tl.position.y = 0.07; this.tapM.add(tl);
    const tk = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), toonMat(0x3a3d44)); tk.position.y = 0.14; this.tapM.add(tk);
    this.tapM.position.set(0.44, -0.04, 0);
  }
  private corkUp() { const r = this.barrel.body.rotation(); return v1.set(0, 1, 0).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w)).y > 0.7; }
  /** Where the barrel's tap lets the beer out (world). */
  private tapSpout(out: THREE.Vector3) { return out.set(0.5, -0.12, 0).applyQuaternion(this.barrel.synced.currQ).add(this.barrel.synced.currP); }
  private get spigotOpen() { return Math.abs(this.spigot.v) > 0.6; }
  private get tapOpen() { return Math.abs(this.tapH.v) > 0.55; }

  // ------------------------------------------------------------------ host
  private made(kind: string, p: Pig | null, pts = POINTS[kind] ?? 10) { G.events.push({ type: 'made', who: p, text: kind, why: String(pts) }); }
  /** The mill's crank turned: grain in the hopper → malt into the sack under the chute. */
  private mill(d: number, p: Pig) {
    G.audio.play('tick', { pos: this.millOut, vol: 0.4, pitch: 0.5, minGap: 0.18 });
    if (this.grainIn < BREW.millTurn - 0.01) return;
    let sack = this.maltSock.occupant;
    if (!sack) { sack = this.spawn('malt', this.maltSock.p.clone().setY(this.maltSock.p.y - 0.24), 0, undefined, 0); if (sack) HANDS.dock(this.maltSock, sack); }
    if (!sack || sack.left >= 3) return;
    this.millProg += Math.abs(d) / (Math.PI * 2);
    if (this.millProg < 1) return;
    this.millProg = 0; this.grainIn = Math.max(0, this.grainIn - BREW.millTurn);
    sack.setLeft(Math.min(3, sack.left + 0.5));
    G.fx.puff(this.millOut, { count: 8, color: 0xe8d6b0, speed: 0.7, up: 0.4, life: 0.9, size: 0.25, alpha: 0.6 });
    this.made('maltUnit', p);
  }
  barrelNear(_p?: Pig) { const b = this.barrel.synced.currP; return !this.barrel.banked && flat(b, this.fireC) < 3.8; }
  private nearPatch(x: number, z: number, r: number) {
    let best: Patch | null = null, bd = r;
    for (const pa of this.patches) { if (pa.cut) continue; const d = Math.hypot(pa.x - x, pa.z - z); if (d < bd) { bd = d; best = pa; } }
    return best;
  }
  private cut(pa: Patch, dir: THREE.Vector3, p: Pig | null) {
    pa.cut = true;
    this.spawn('sheaf', V3(pa.x, pa.y + 0.9, pa.z), Math.random() * 6, V3(dir.x * 1.5, 2.5, dir.z * 1.5));
    G.audio.play('rustle', { pos: v1.set(pa.x, pa.y + 0.6, pa.z), vol: 1 });
    G.fx.bits(v1, { count: 14, color: 0xf2c94c, speed: 2.5, up: 2, life: 0.7, size: 0.08, grow: 0, drag: 2, alpha: 1 });
    G.noise(v1, 8);
    if (p) this.made('sheaf', p);
  }
  private hit(hx: number, hz: number, reach: number, dir: THREE.Vector3, by: Pig) {
    if (G.net === 'client') return false;
    const pa = this.nearPatch(hx, hz, reach * 0.8 + 0.4);
    if (pa) { this.cut(pa, dir, by); return true; }
    for (const pl of this.poles) {
      if (Math.hypot(pl.x - hx, pl.z - hz) > reach + 0.3) continue;
      if (G.time > pl.next) {
        pl.next = G.time + 8;
        for (let i = 0; i < 2; i++) this.spawn('hops', V3(pl.x + (Math.random() - 0.5) * 0.5, pl.y + 2.2, pl.z + (Math.random() - 0.5) * 0.5), 0, V3(dir.x * 1.5 + (Math.random() - 0.5), 1, dir.z * 1.5 + (Math.random() - 0.5)));
        G.audio.play('rustle', { pos: v1.set(pl.x, pl.y + 1.5, pl.z), vol: 0.9 });
      }
      return true;
    }
    return false;
  }

  protected selfUse(p: Pig, h: Prop): boolean {
    const f = p.forward, fx = p.pos.x + f.x * 1.2, fz = p.pos.z + f.z * 1.2;
    switch (h.def.item) {
      case 'scythe': {
        let n = 0;
        for (let k = 0; k < 3; k++) { const pa = this.nearPatch(fx + f.x * (k - 1) * 0.6, fz + f.z * (k - 1) * 0.6, 1.5); if (pa) { this.cut(pa, f, p); n++; } if (n >= 2) break; }
        G.audio.play('whoosh', { pos: p.pos, vol: 0.7, pitch: 0.9 });
        return n > 0;
      }
      case 'can': {   // dip it in the pond
        const pond = G.places?.pond;
        if (pond && Math.hypot(p.pos.x - pond.x, p.pos.z - pond.z) < pond.r + 0.6) { h.setLeft(h.def.servings ?? 3); G.audio.play('fill', { pos: p.pos, vol: 0.8 }); return true; }
        return false;
      }
      case 'beer': {
        if (h.left < 0.3) return false;
        p.mouthAt = G.time;
        h.setLeft(Math.max(0, h.left - 1));
        p.addBuzz(2, BREW.mugBuzz, 35);
        G.audio.play('drink', { pos: p.pos, vol: 0.9 });
        G.events.push({ type: 'sip', who: p });
        if (h.left <= 0.05) {   // a whole mug down → a burp in a moment
          h.setLeft(0);
          this.drunkMugs.set(p, (this.drunkMugs.get(p) ?? 0) + 1);
          this.burpAt.set(p, G.time + 1.2);
          G.events.push({ type: 'mugDown', who: p });
        }
        return true;
      }
    }
    return false;
  }
  protected selfIcon(p: Pig, h: Prop): IconId | '' {
    const f = p.forward;
    switch (h.def.item) {
      case 'scythe': return this.nearPatch(p.pos.x + f.x * 1.2, p.pos.z + f.z * 1.2, 1.5) ? 'sickle' : '';
      case 'can': { const pond = G.places?.pond; return pond && Math.hypot(p.pos.x - pond.x, p.pos.z - pond.z) < pond.r + 0.6 ? 'water' : ''; }
      case 'beer': return h.left >= 0.3 ? 'beer' : '';
    }
    return '';
  }

  protected tick(dt: number) {
    // the fire burns down
    if (this.fuel > 0) this.fuel = Math.max(0, this.fuel - dt);
    if (this.stage === 2 && this.fuel > 0 && G.time - this.boilT > BREW.boil) { this.stage = 3; this.wort = BREW.wort; G.audio.play('ding', { pos: this.fireC, vol: 0.9 }); G.events.push({ type: 'wortReady' }); this.made('wort', null); }
    if (this.stage === 2 && this.fuel <= 0) this.boilT += dt;   // no fire: no boil
    // the spigot: open = the wort runs out (into the barrel's bung if it's under it)
    if (this.stage === 3 && this.spigotOpen && this.wort > 0) {
      const a = Math.min(this.wort, dt * 0.9);
      this.wort -= a;
      HANDS.emit(this.spout, 'wort', a, this.spigot.heldBy);
      if (this.wort <= 0.001) { this.stage = 0; this.water = 0; this.malt = 0; this.mash = 0; this.hops = 0; this.wort = 0; }
    }
    // the barrel ferments where it is; then its tap pours beer
    this.tapSpout(this.tap.markPos).setY(this.barrel.synced.currP.y + 1.3);
    if (this.barrelState === 1 && G.time - this.fermT > BREW.ferment) { this.barrelState = 2; this.beer = BREW.beer; G.audio.play('ding', { pos: this.barrel.synced.currP, vol: 0.9, pitch: 0.8 }); G.events.push({ type: 'beerReady' }); }
    if (this.barrelState === 2 && this.tapOpen && this.beer > 0) {
      const a = Math.min(this.beer, dt * 1.4);
      this.beer -= a;
      const r = HANDS.emit(this.tapSpout(v2), 'beer', a, this.tapH.heldBy);
      if (r && !this.tapped) { this.tapped = true; G.events.push({ type: 'brewBeer', who: this.tapH.heldBy }); }
      if (r) { this.tapUnits += a; if (this.tapUnits >= 3) { this.tapUnits -= 3; this.made('mug', this.tapH.heldBy); } }
      if (this.beer <= 0.001) { this.barrelState = 0; this.beer = 0; }
    }
    // the threshing floor: a sheaf dropped on it becomes a straw pile there; jumps that land on the floor thresh
    // the piles (on the beat = double)
    for (const pr of this.props) {
      if (pr.def.item !== 'sheaf' || pr.banked || pr.heldBy || this.floorSheaves >= 6) continue;
      const pp = pr.synced.currP;
      if (flat(pp, this.floorC) < this.floorR && pp.y < this.floorC.y + 1 && pr.body.linvel().y > -1) { this.consume(pr); this.floorSheaves++; G.audio.play('rustle', { pos: pp, vol: 0.6 }); }
    }
    if (this.floorSheaves && !this.beatT0) this.beatT0 = G.time;
    if (!this.floorSheaves) { this.beatT0 = 0; this.floorProg = 0; }
    for (const p of G.pigs as Pig[]) {
      if (p.absent || p.out || p.mode !== 'normal') continue;
      if (!p.grounded) { this.airborne.set(p, Math.min(this.airborne.get(p) ?? 0, p.vel.y)); continue; }
      const fall = this.airborne.get(p); this.airborne.delete(p);
      if (fall === undefined || fall > -3 || !this.floorSheaves || flat(p.pos, this.floorC) > this.floorR + 0.3) continue;
      const ph = ((G.time - this.beatT0) % BREW.beat), onBeat = ph < BREW.beatWin || ph > BREW.beat - BREW.beatWin;
      this.floorProg += onBeat ? 2 : 1;
      if (this.floorProg >= BREW.stompNeed) {
        this.floorProg = 0; this.floorSheaves--;
        const a = Math.random() * Math.PI * 2;
        this.spawn('grain', V3(this.floorC.x + Math.cos(a) * (this.floorR + 0.6), this.floorC.y + 0.8, this.floorC.z + Math.sin(a) * (this.floorR + 0.6)), 0, V3(Math.cos(a) * 1.5, 2, Math.sin(a) * 1.5));
        G.audio.play('thud', { pos: this.floorC, vol: 0.8 });
        this.made('grain', p);
      }
      G.audio.play(onBeat ? 'drum' : 'thud', { pos: p.pos, vol: 0.8, pitch: onBeat ? 1.2 : 0.8 });
      G.fx.bits(v1.set(p.pos.x, p.pos.y - 0.3, p.pos.z), { count: onBeat ? 18 : 8, color: 0xf2c94c, speed: 2.5, up: 1.6, life: 0.6, size: 0.07, grow: 0, alpha: 1 });
      if (onBeat) G.events.push({ type: 'stompBeat', who: p });
    }
    // burps (loud) after a mug
    for (const [p, t] of this.burpAt) if (G.time > t) { this.burpAt.delete(p); G.audio.play('grunt', { pos: p.pos, vol: 1, pitch: 0.5 }); G.noise(p.pos, 14); G.events.push({ type: 'burp', who: p }); }
    // dancing on the beer-garden table (drunk, on two legs, 5 s)
    for (const p of G.pigs as Pig[]) {
      const on = p.drunk > 0.3 && p.standing && p.mode === 'normal' && flat(p.pos, this.tableTop) < 1.6 && Math.abs(p.pos.y - CENTER.two - this.tableTop.y) < 0.4;
      const t = on ? (this.dance.get(p) ?? 0) + dt : 0;
      this.dance.set(p, t);
      if (t > 4) { this.dance.set(p, -20); G.audio.play('fanfare', { pos: p.pos, vol: 0.5 }); G.events.push({ type: 'tableDance', who: p }); }
    }
  }
  private tapped = false; private tapUnits = 0;
  /** Drunk singing: 6 oinks within 20 s, close to Bob → he's had enough (a prank). */
  oinked(p: Pig) {
    if (G.net === 'client' || p.drunk < 0.3 || !G.farmer || flat(p.pos, G.farmer.pos) > 12) return;
    const list = (this.songs.get(p) ?? []).filter((t) => G.time - t < 20); list.push(G.time); this.songs.set(p, list);
    if (list.length >= 6) { this.songs.set(p, []); G.farmer.hugged?.(p); G.events.push({ type: 'serenade', who: p }); }
  }
  protected resetMode() {
    for (const pa of this.patches) pa.cut = false;
    this.grainIn = 0; this.millProg = 0; this.water = 0; this.malt = 0; this.mash = 0; this.hops = 0; this.fuel = 0; this.stage = 0; this.boilT = 0; this.wort = 0;
    this.barrelState = 0; this.barrelWort = 0; this.fermT = 0; this.beer = 0; this.tapped = false; this.tapUnits = 0; this.beatT0 = 0;
    this.floorSheaves = 0; this.floorProg = 0; this.airborne.clear(); this.dance.clear(); this.songs.clear(); this.burpAt.clear(); this.drunkMugs.clear();
    for (const pl of this.poles) pl.next = 0;
    for (const h of [this.millCrank, this.paddle, this.spigot, this.tapH]) h.v = 0;
    this.pump.reset();
  }

  render(dt: number) {
    this.visions.render(dt);
    this.shedRender();
    this.pump.render(dt);
    for (const pa of this.patches) { pa.up.visible = !pa.cut; pa.down.visible = pa.cut; if (!pa.cut) pa.up.rotation.z = Math.sin(G.time * 1.1 + pa.x * 0.7) * 0.04; }
    const burning = this.fuel > 0;
    this.flames.visible = burning;
    this.fireLight.intensity = burning ? 2.2 + Math.sin(G.time * 13) * 0.4 : 0;
    if (burning) this.flames.children.forEach((c, i) => { c.scale.y = 0.8 + Math.sin(G.time * 9 + i * 2) * 0.3; });
    this.brewM.visible = this.water > 0 || this.stage > 0;
    (this.brewM.material as THREE.MeshToonMaterial).color.setHex(this.stage === 0 ? (this.malt ? 0xc98a4a : 0x6fb7e8) : this.stage === 1 ? 0xb5793d : 0xd99a3a);
    this.brewM.position.y = this.kettleTop.y - 0.25 + 0.2 * Math.min(1, (this.water + (this.stage === 3 ? this.wort / BREW.wort * 2 : this.stage > 0 ? 2 : 0)) / 2);
    if (this.stage >= 2 && burning && Math.random() < dt * 8) G.fx.puff(v1.copy(this.fireC).setY(this.fireC.y + 1.3), { count: 1, color: 0xf4f4f4, speed: 0.3, up: 1, life: 1.4, size: 0.4, alpha: 0.5 });
    if (this.barrelState === 1 && Math.random() < dt * 4) G.fx.bits(v2.copy(this.barrel.synced.currP).setY(this.barrel.synced.currP.y + 0.4), { count: 2, color: 0xfffaf0, speed: 0.4, up: 0.8, life: 0.6, size: 0.06, grow: 0, alpha: 1 });
    this.piles.forEach((pl, i) => { pl.visible = i < this.floorSheaves; });
    // the floor pulses on the beat while there's wheat on it
    const m = this.floorRing.material as THREE.MeshBasicMaterial;
    if (this.beatT0) { const ph = ((G.time - this.beatT0) % BREW.beat) / BREW.beat; m.opacity = Math.max(0, 1 - ph * 3) * 0.9; if (ph < 0.02) G.audio.play('drum', { pos: this.floorC, vol: 0.35, pitch: 0.7, minGap: 0.3 }); }
    else m.opacity = 0;
    // the mill's wheel, the paddle in the kettle, the spigot + the tap levers, the streams
    this.millWheel.rotation.z = this.millCrank.v;
    this.paddleM.visible = (this.stage === 0 && this.water > 0) || !!this.paddle.heldBy;
    if (this.paddleM.visible) { this.paddle.knob(this.paddleM.position); this.paddleM.position.y -= 0.45; this.paddleM.rotation.set(0.3 * Math.cos(this.paddle.v), this.paddle.v, -0.3 * Math.sin(this.paddle.v)); }
    this.spigotM.rotation.x = -this.spigot.v;
    this.tapM.rotation.z = this.tapH.v;
    if (this.stage === 3 && this.spigotOpen && this.wort > 0) HANDS.streamFx(this.spout, 0xc98a4a, dt, 0.06);
    if (this.barrelState === 2 && this.tapOpen && this.beer > 0) HANDS.streamFx(this.tapSpout(v1), 0xffb42a, dt, 0.05);
    // mugs: how full (beer + a foam head when full)
    for (const pr of this.props) {
      if (pr.def.item !== 'beer' || pr.banked) continue;
      const b = pr.obj.getObjectByName('beer'), fo = pr.obj.getObjectByName('foam'), k = Math.min(1, pr.left / 3);
      if (b) { b.visible = k > 0.02; b.scale.y = Math.max(0.02, k); }
      if (fo) { fo.visible = k > 0.9; }
    }
  }

  netState(n: number[]) {
    let cut = 0; this.patches.forEach((pa, i) => { if (pa.cut) cut |= 1 << i; });
    const r2 = (x: number) => Math.round(x * 100) / 100;
    n.push(cut, r2(this.grainIn), r2(this.water), r2(this.malt), r2(this.mash), this.hops, Math.round(this.fuel), this.stage, this.boilT, r2(this.wort), this.barrelState, r2(this.barrelWort), this.fermT, r2(this.beer),
      this.beatT0, this.floorSheaves, r2(this.millCrank.v), r2(this.paddle.v), r2(this.spigot.v), r2(this.tapH.v), r2(this.pump.lever.v), this.pump.flowUntil, ...this.poles.map((p) => p.next));
  }
  netApply(n: number[]) {
    if (n.length < 22) return;
    this.patches.forEach((pa, i) => { pa.cut = (n[0] & (1 << i)) !== 0; });
    [, this.grainIn, this.water, this.malt, this.mash, this.hops, this.fuel, this.stage, this.boilT, this.wort, this.barrelState, this.barrelWort, this.fermT, this.beer, this.beatT0, this.floorSheaves] = n;
    this.millCrank.v = n[16]; this.paddle.v = n[17]; this.spigot.v = n[18]; this.tapH.v = n[19]; this.pump.lever.v = n[20]; this.pump.flowUntil = n[21];
    this.poles.forEach((p, i) => { p.next = n[22 + i] ?? 0; });
    this.tapSpout(this.tap.markPos).setY(this.barrel.synced.currP.y + 1.3);
  }

  adminButtons(): [string, string][] {
    return [['brew:sheaves', 'a.brewSheaves'], ['brew:floor', 'a.brewFloor'], ['brew:grain', 'a.brewGrain'], ['brew:kettle', 'a.brewKettle'], ['brew:wort', 'a.brewWort'], ['brew:beer', 'a.brewBeer'], ['brew:mug', 'a.brewMug'],
      ['brew:drunk', 'a.brewDrunk'], ['tp:shed', 'a.tpShed'], ['tp:field', 'a.tpField'], ['tp:beam', 'a.tpBeam']];
  }
  admin(a: string, me: Pig): boolean {
    const f = me.forward, front = V3(me.pos.x + f.x * 0.9, me.pos.y + 0.3, me.pos.z + f.z * 0.9);
    switch (a) {
      case 'brew:sheaves': for (let i = 0; i < 4; i++) this.spawn('sheaf', front.clone().add(V3((i % 2) * 0.4, 0.3 * i, 0)), 0); return true;
      case 'brew:floor': this.floorSheaves = 4; return true;
      case 'brew:grain': this.spawn('grain', front, 0); return true;
      case 'brew:kettle': this.water = 2; this.malt = 1; this.fuel = 200; this.stage = 0; this.mash = 0; return true;
      case 'brew:wort': this.stage = 3; this.wort = BREW.wort; this.fuel = Math.max(this.fuel, 60); return true;
      case 'brew:beer': this.barrelState = 2; this.beer = BREW.beer; return true;
      case 'brew:mug': { const m = this.props.find((p) => p.def.item === 'beer' && !p.banked && !p.heldBy); if (m) { m.body.setTranslation(front, true); m.body.setLinvel({ x: 0, y: 0, z: 0 }, true); m.setLeft(3); } return true; }
      case 'brew:drunk': me.addBuzz(2, 0.9, 90); return true;
    }
    return false;
  }
  /** How to do the next step (mission list icons). */
  stepIcons(id: string, me: Pig): string {
    const I = (...k: (IconId | string)[]) => k.map((x) => (x in IC ? IC[x as IconId] : `<kbd class="kc">${x}</kbd>`)).join('');
    const held = this.item(me.held), has = (item: string, full = false) => this.props.some((p) => !p.banked && p.def.item === item && (!full || p.left > 0.05));
    switch (id) {
      case 'brewBeer':
        if (this.barrelState === 2) return I('beer', 'rmb', 'lever');
        if (this.barrelState === 1) return I('barrel', 'clock');
        if (this.stage === 3) return I('barrel', 'rmb', 'lever');
        if (this.stage === 2) return I('fire', 'clock');
        if (this.stage === 1) return I('rmb', 'leaf', 'aim', 'fire');
        if (this.water >= 1.9 && this.malt >= 0.9) return this.fuel <= 0 ? I('rmb', 'fire') : I('rmb', 'stir', 'circle');
        if (this.water < 1.9) return held === 'can' ? I('R', 'pour', 'fire') : I('water', 'rmb', 'lever');
        if (has('malt', true)) return I('R', 'wheat', 'pour', 'fire');
        if (this.grainIn >= 0.5) return I('rmb', 'gear', 'circle');
        if (has('grain', true)) return I('R', 'wheat', 'pour', 'gear');
        if (has('sheaf') || this.floorSheaves) return I('wheat', kcJump(), 'note');
        return I('sickle', 'lmb', 'wheat');
      case 'drinkUp': return held === 'beer' ? I('lmb', 'beer') : I('beer', 'rmb', 'lever');
    }
    return '';
  }
  markFor(id: string, me: Pig): THREE.Vector3 | null {
    const near = (item: string, full = false) => { let best: Prop | null = null, bd = Infinity; for (const p of this.props) { if (p.banked || p.def.item !== item || (full && p.left <= 0.05)) continue; const d = flat(p.synced.currP, me.pos); if (d < bd) { bd = d; best = p; } } return best?.synced.currP.clone().setY(best.synced.currP.y + 0.3) ?? null; };
    const held = this.item(me.held), heldFull = !!me.held && (me.held as Prop).left > 0.05;
    const kettle = this.kettleTop.clone().setY(this.kettleTop.y + 0.8), mill = this.millHopper.clone().setY(this.millHopper.y + 0.6);
    switch (id) {
      case 'brewBeer': {
        if (this.barrelState === 2) return held === 'beer' ? this.tap.markPos : near('beer') ?? this.tap.markPos;
        if (this.barrelState === 1) return this.tap.markPos;
        if (this.stage === 3) return this.barrelNear(me) && this.corkUp() ? this.spout.clone().setY(this.spout.y + 0.6) : this.barrel.synced.currP.clone().setY(this.barrel.synced.currP.y + 1);
        if (this.stage >= 1) return this.stage === 1 && held !== 'hops' ? (near('hops') ?? V3(this.poles[1].x, this.poles[1].y + 3.4, this.poles[1].z)) : kettle;
        if (this.water >= 1.9 && this.malt >= 0.9) return this.fuel <= 0 ? (held === 'log' ? kettle : near('log') ?? kettle) : kettle;
        if (this.water < 1.9) return held === 'can' && heldFull ? kettle : near('can', true) ?? this.pump.spout;
        if (held === 'malt' && heldFull) return kettle;
        if (near('malt', true)) return near('malt', true);
        if (this.grainIn >= 0.5) return mill;
        if (held === 'grain' && heldFull) return mill;
        if (near('grain', true)) return near('grain', true);
        if (held === 'sheaf' || this.floorSheaves) return this.floorC.clone().setY(this.floorC.y + 1.2);
        if (near('sheaf')) return near('sheaf');
        return near('scythe') ?? this.fieldC.clone().setY(this.fieldC.y + 2);
      }
      case 'drinkUp': return held === 'beer' && heldFull ? null : this.barrelState === 2 ? this.tap.markPos : near('beer', true);
      case 'tableDance': return this.tableTop.clone().setY(this.tableTop.y + 1.4);
      case 'serenade': return G.farmer ? G.farmer.pos.clone().setY(G.farmer.pos.y + 2.2) : null;
      case 'beamWalk': return this.beamSpot.clone().setY(this.beamSpot.y + 1.5);
    }
    return null;
  }
}
