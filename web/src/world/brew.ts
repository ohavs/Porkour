import * as THREE from 'three';
import { G } from '../game/ctx';
import type { Pig } from '../pig/pig';
import type { Prop } from './props';
import { IC, type IconId } from '../game/icons';
import type { Rect } from './terrain';
import type { Kit } from './farmKit';
import { Chain, buildShed, buildBeam, need, type Station } from './chain';
import { wheatGeometry, plantMaterial } from './chainProps';
import { staticBox, staticCylinder } from '../core/physics';
import { fitted } from '../core/assets';
import { toonMat } from '../render/toon';
import { V3 } from '../core/util';
import { CENTER } from '../pig/pigBody';

/**
 * Farm 7 — Bob grows wheat; the pigs brew beer (user: "the same idea as the cannabis farm: make beer and drink it").
 *   wheat field (scythe it — or headbutt it — each patch drops a sheaf)
 *   → threshing floor (drop sheaves on it, then JUMP on them; a drum keeps the beat: stomps on the beat count double —
 *     all four pigs jumping together is fastest) → grain sack
 *   → malt mill in the shed (crank) → malt
 *   → kettle over the fire pit: water ×2 (bucket / can), malt, logs on the fire → stir the mash (keep the heat in the
 *     band) → hops ×2 (shake them off the hop poles) → it boils → pour into the barrel (roll the barrel over)
 *   → the barrel ferments (bubbles, ~30 s) → tap it (fill the mug to the line — too much = a foam mess) → drink up
 *     (burp: loud) → drunk challenges (world/chain.ts + serenading Bob, dancing on the beer-garden table).
 */
export const BREW = { boil: 12, ferment: 30, fuelLog: 70, beat: 0.75, beatWin: 0.17, stompNeed: 6, mugBuzz: 0.17 };
const POINTS: Record<string, number> = { sheaf: 5, grain: 15, malt: 25, wort: 60, barrel: 80, mug: 30 };

interface Patch { x: number; z: number; y: number; cut: boolean; up: THREE.Mesh; down: THREE.Mesh }

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
const flat = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

export class Brew extends Chain {
  kind = 2 as const;
  patches: Patch[] = [];
  mill!: Station; kettle!: Station; tap!: Station; pump!: Station;
  grain = 0;
  /** Kettle: water doses (need 2), malt, hops (need 2), fuel (s of fire left), stage 0 filling · 1 mashed (add hops) · 2 boiling (since `boilT`) · 3 ready. */
  water = 0; malt = 0; hops = 0; fuel = 0; stage = 0; boilT = 0;
  /** The barrel: 0 empty · 1 fermenting (since fermT) · 2 beer (mugs left). */
  barrelState = 0; fermT = 0; mugs = 0;
  barrel!: Prop;
  private floorC = new THREE.Vector3(); private floorR = 2.3; private beatT0 = 0;
  private stompN = new Map<Prop, number>(); private airborne = new Map<Pig, number>();
  private poles: { x: number; z: number; y: number; next: number; obj: THREE.Object3D }[] = [];
  private fireC = new THREE.Vector3(); private fireLight!: THREE.PointLight; private flames!: THREE.Group; private brewM!: THREE.Mesh; private floorRing!: THREE.Mesh;
  private tableTop = new THREE.Vector3(); private dance = new Map<Pig, number>(); private songs = new Map<Pig, number[]>();
  private burpAt = new Map<Pig, number>();
  /** Mugs each pig has finished this round (the "everyone drinks up" mission). */
  drunkMugs = new Map<Pig, number>();
  fieldC = new THREE.Vector3(); beamSpot = new THREE.Vector3();

  constructor(scene: THREE.Scene, props: Prop[], kit: Kit, o: { field: Rect; shed: [number, number, number]; pump: [number, number]; beam: [THREE.Vector3, THREE.Vector3]; floor: [number, number]; table: [number, number, number] }) {
    super(scene, props);
    this.buildField(kit, o.field);
    this.buildShedStations(kit, o.shed);
    this.buildYard(kit, o);
    this.beamSpot.copy(o.beam[0]);
    buildBeam(kit, scene, o.beam[0], o.beam[1], 2.4, this.beams);
    this.pool('sheaf', 16); this.pool('grain', 6); this.pool('malt', 3); this.pool('hops', 10); this.pool('beerMug', 8);
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
    this.shedAt.set(cx, sh.y0, cz); this.shedR = 5.2;
    const at = (x: number, z: number) => sh.place(x, z);
    const deco = (model: string, lx: number, lz: number, h: number, collide = true) => {
      const p = at(lx, lz), o = fitted(model, { height: h }); o.position.copy(p); o.rotation.y = yaw; scene.add(o);
      if (collide) { const b = new THREE.Box3().setFromObject(o), s = b.getSize(v1); staticBox(V3(p.x, p.y + s.y / 2, p.z), V3(s.x / 2 * 0.9, s.y / 2, s.z / 2 * 0.9)); }
      return o;
    };
    // the mill (crank) — the same machine as the cannabis grinder, painted blue; sacks + barrels along the walls
    const gP = at(-2.5, -2.7);
    const mach = new THREE.Group(); mach.position.copy(gP); mach.rotation.y = yaw; scene.add(mach);
    const blue = toonMat(0x3d6fd1), steel = toonMat(0xaab3bd), dk = toonMat(0x3a3d44);
    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; mach.add(o); return o; };
    box(1.3, 0.9, 0.9, blue, 0, 0.45, 0);
    const hop = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.22, 0.6, 12, 1, true), steel); hop.position.set(0, 1.2, 0); (hop.material as THREE.Material).side = THREE.DoubleSide; mach.add(hop);
    box(0.4, 0.25, 0.5, steel, 0, 0.3, 0.6).rotation.x = 0.4;
    const wheel = new THREE.Group(); wheel.position.set(0.72, 0.6, 0); mach.add(wheel);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.04, 6, 20), dk); rim.rotation.y = Math.PI / 2; wheel.add(rim);
    for (let k = 0; k < 4; k++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.74, 0.04), dk); sp.rotation.x = k * Math.PI / 4; wheel.add(sp); }
    staticBox(V3(gP.x, gP.y + 0.6, gP.z), V3(0.7, 0.6, 0.5), yaw);
    for (const [lx, lz] of [[2.5, -2.8], [3.5, -2.8], [4.5, -2.6]] as const) deco('brew/Barrel', lx, lz, 1.1);
    deco('brew/Bag', 4.6, -1.0, 0.7, false); deco('brew/Bag_Open', -4.6, -2.6, 0.7, false);
    const out = at(-2.5, -1.75).setY(sh.y0 + 0.3);
    this.mill = this.station({
      at: at(-1.4, -1.7), r: 1.4, icon: 'gear', markPos: at(-2.5, -2.7).setY(sh.y0 + 2.2),
      ready: () => this.grain > 0, steps: () => [{ kind: 'crank', icon: 'gear', n: 4, speed: 9 }], needs: () => need('wheat', this.grain),
      takes: (it) => (it.def.item === 'grain' && this.grain < 3 ? 'wheat' : null),
      take: (it, p) => { this.consume(it); this.grain++; G.audio.play('thud', { pos: p.pos, vol: 0.6 }); },
      done: (p, q) => {
        if (!this.grain || q === 0) { if (q === 0) G.noise(this.mill.markPos, 12); return; }
        this.grain--;
        this.spawn('malt', out, yaw, V3(Math.sin(yaw) * 1.4, 1.2, Math.cos(yaw) * 1.4));
        G.fx.puff(out, { count: 10, color: 0xe8d6b0, speed: 0.8, up: 0.8, life: 0.9, size: 0.3, alpha: 0.6 });
        this.made('malt', p);
      },
    });
  }

  private buildYard(kit: Kit, o: { pump: [number, number]; floor: [number, number]; table: [number, number, number] }) {
    const scene = this.scene;
    // pump (water for the kettle: buckets / cans refill here or in the pond)
    const [px, pz] = o.pump, py = kit.y(px, pz);
    const iron = toonMat(0x3f8f5a);
    const pb = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 1.1, 10), iron); pb.position.set(px, py + 0.55, pz); scene.add(pb);
    const ps = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.4, 8), iron); ps.position.set(px, py + 0.85, pz + 0.22); ps.rotation.x = 1.2; scene.add(ps);
    staticCylinder(V3(px, py + 0.55, pz), 0.55, 0.2);
    this.pump = this.station({
      at: V3(px, py, pz + 0.9), r: 1.6, icon: 'can', markPos: V3(px, py + 1.6, pz), ready: () => false, steps: () => null, done: () => {},
      takes: (it) => (it.def.item === 'can' && it.left < (it.def.servings ?? 3) ? 'can' : null),
      take: (it, p) => { it.setLeft(it.def.servings ?? 3); G.audio.play('fill', { pos: p.pos, vol: 0.9 }); },
    });
    // the kettle: a cauldron over a fire pit, a little in front of the shed's open side
    const [fx, fz] = [o.pump[0] + 4.5, o.pump[1] + 1.5], fy = kit.y(fx, fz);
    this.fireC.set(fx, fy, fz);
    const ring = new THREE.Group(); ring.position.copy(this.fireC); scene.add(ring);
    const stone = toonMat(0x8a8f99);
    for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2, s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22), stone); s.position.set(Math.cos(a) * 0.85, 0.12, Math.sin(a) * 0.85); s.rotation.set(k, k * 2, 0); ring.add(s); }
    const logs = fitted('kenney/campfire_logs', { height: 0.35 }); ring.add(logs);
    const caul = fitted('village/Cauldron', { height: 1.1 }); caul.position.set(fx, fy + 0.25, fz); scene.add(caul);
    this.brewM = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 16), toonMat(0x6fb7e8)); this.brewM.position.set(fx, fy + 1.12, fz); this.brewM.visible = false; scene.add(this.brewM);
    this.flames = new THREE.Group(); this.flames.position.copy(this.fireC); scene.add(this.flames);
    for (let k = 0; k < 5; k++) { const fl = new THREE.Mesh(new THREE.ConeGeometry(0.12 + (k % 2) * 0.05, 0.5, 6), toonMat(k % 2 ? 0xffb13a : 0xff6a1a, { emissive: new THREE.Color(k % 2 ? 0xffb13a : 0xff6a1a) })); fl.position.set(Math.cos(k * 1.3) * 0.25, 0.3, Math.sin(k * 1.3) * 0.25); this.flames.add(fl); }
    this.flames.visible = false;
    this.fireLight = new THREE.PointLight(0xff9a3a, 0, 8, 1.5); this.fireLight.position.set(fx, fy + 0.8, fz); scene.add(this.fireLight);
    staticCylinder(V3(fx, fy + 0.6, fz), 0.6, 0.75);
    kit.blocked.push({ x0: fx - 2, x1: fx + 2, z0: fz - 2, z1: fz + 2 });
    this.kettle = this.station({
      at: V3(fx, fy, fz), r: 1.9, icon: 'fire', markPos: V3(fx, fy + 2.1, fz),
      ready: (p) => (this.stage === 0 && this.water >= 2 && this.malt > 0 && this.fuel > 0) || (this.stage === 3 && this.barrelNear(p)),
      steps: () => (this.stage === 0 ? [{ kind: 'stir', icon: 'fire', secs: 7, color: '#c98a4a' }] : null),
      needs: () => (this.stage === 0 ? need('water', this.water, 2) + need('wheat', this.malt) + need('fire', this.fuel > 0 ? 1 : 0)
        : this.stage === 1 ? need('leaf', this.hops, 2) + need('fire', this.fuel > 0 ? 1 : 0) : this.stage === 2 ? need('fire', this.fuel > 0 ? 1 : 0) + `<b>${Math.max(0, Math.ceil(BREW.boil - (G.time - this.boilT)))}</b>` : need('barrel', 0)),
      takes: (it) => {
        const k = it.def.item;
        if (k === 'can' && it.left > 0 && this.stage === 0 && this.water < 2) return 'water';
        if (k === 'malt' && this.stage === 0 && !this.malt) return 'wheat';
        if (k === 'hops' && this.stage === 1 && this.hops < 2) return 'leaf';
        if (k === 'log') return 'fire';
        return null;
      },
      take: (it, p) => {
        const k = it.def.item;
        if (k === 'can') { this.water++; this.pour(it); G.audio.play('pour', { pos: p.pos, vol: 0.8 }); }
        else if (k === 'malt') { this.malt = 1; this.consume(it); G.audio.play('splash', { pos: this.fireC, vol: 0.5 }); }
        else if (k === 'hops') { this.hops++; this.consume(it); G.audio.play('splash', { pos: this.fireC, vol: 0.3, pitch: 1.4 }); if (this.hops >= 2) { this.stage = 2; this.boilT = G.time; } }
        else if (k === 'log') { this.fuel = Math.min(240, this.fuel + BREW.fuelLog); this.consume(it); G.audio.play('crackle', { pos: this.fireC, vol: 0.8 }); }
      },
      done: (p, q) => {
        if (this.stage === 0) {
          if (q === 0) return;
          if (q === 4) { this.water = 0; this.malt = 0; G.audio.play('hiss', { pos: this.fireC, vol: 1 }); G.fx.puff(this.kettle.markPos, { count: 20, color: 0x55575c, speed: 1.2, up: 1.4, life: 2.5, size: 1, alpha: 0.6 }); G.noise(this.fireC, 20); G.events.push({ type: 'burnt', who: p }); return; }
          this.stage = 1; G.audio.play('fill', { pos: this.fireC, vol: 0.6, pitch: 0.5 });
          return;
        }
        if (this.stage === 3 && this.barrelNear(p)) {
          this.stage = 0; this.water = 0; this.malt = 0; this.hops = 0;
          this.barrelState = 1; this.fermT = G.time;
          G.audio.play('pour', { pos: this.fireC, vol: 1, pitch: 0.7 });
          this.made('barrel', p);
        }
      },
    });
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
    G.terrain.noGrass({ x0: tx - 3, x1: tx + 3, z0: tz - 3, z1: tz + 3 });
    kit.blocked.push({ x0: tx - 3, x1: tx + 3, z0: tz - 3, z1: tz + 3 });
    // the beer-garden table (dance on it drunk) + benches
    const [bx, bz, byaw] = o.table, by = kit.y(bx, bz), wood = toonMat(0x9a6a3c), dark = toonMat(0x6e4524);
    const tg = new THREE.Group(); tg.position.set(bx, by, bz); tg.rotation.y = byaw; scene.add(tg);
    const top = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 1.1), wood); top.position.y = 0.85; top.castShadow = true; tg.add(top);
    for (const x of [-1.3, 1.3]) for (const z of [-0.4, 0.4]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.85, 0.1), dark); l.position.set(x, 0.42, z); tg.add(l); }
    for (const z of [-0.95, 0.95]) { const bn = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.08, 0.35), wood); bn.position.set(0, 0.45, z); tg.add(bn); staticBox(V3(bx + Math.sin(byaw) * z, by + 0.45, bz + Math.cos(byaw) * z), V3(1.5, 0.05, 0.17), byaw); }
    staticBox(V3(bx, by + 0.85, bz), V3(1.6, 0.06, 0.55), byaw);
    this.tableTop.set(bx, by + 0.91, bz);
    kit.blocked.push({ x0: bx - 2.5, x1: bx + 2.5, z0: bz - 2.5, z1: bz + 2.5 });
    // things lying around: buckets, scythes, logs by the fire, the barrel
    kit.prop('bucket', px + 1.1, pz + 0.3, 0); kit.prop('bucket', fx - 1.6, fz - 1.2, 0);
    kit.prop('scythe', this.fieldC.x + 8, this.fieldC.z + 8.5, 0.4); kit.prop('scythe', px - 1.2, pz + 0.8, 1.2);
    kit.prop('log', fx + 1.8, fz - 0.6, 0.3); kit.prop('log', fx + 2.1, fz + 0.4, 1.1); kit.prop('log', fx + 2.6, fz - 0.1, 0.2);
    this.barrel = kit.prop('beerBarrel', fx + 2.2, fz + 2.4, 0);
    this.tap = this.station({
      at: this.barrel.synced.currP.clone(), r: 1.6, icon: 'beer', markPos: this.barrel.synced.currP.clone(),
      ready: () => this.barrelState === 2 && this.mugs > 0,
      needs: () => (this.barrelState === 1 ? `${IC.barrel}<b>${Math.max(0, Math.ceil(BREW.ferment - (G.time - this.fermT)))}</b>` : this.barrelState === 0 ? need('fire', this.stage === 3 ? 1 : 0) : ''),
      steps: () => [{ kind: 'hold', icon: 'beer', speed: 0.9, zone: 0.22, color: '#ffb42a' }],
      done: (p, q) => {
        if (this.barrelState !== 2 || this.mugs <= 0 || q === 0) return;
        this.mugs--;
        const bp = this.barrel.synced.currP, f = p.forward;
        if (q === 4) {   // too much: foam everywhere, the mug is half spilled (still a mug)
          G.fx.bits(V3(bp.x, bp.y + 0.3, bp.z), { count: 30, color: 0xfffaf0, speed: 2.5, up: 2.5, life: 1, size: 0.12, grow: 0, alpha: 1 });
          G.audio.play('splash', { pos: bp, vol: 0.7 });
        }
        const m = this.spawn('beerMug', V3(p.pos.x + f.x * 0.7, p.pos.y + 0.6, p.pos.z + f.z * 0.7), p.yaw);
        if (m && q === 4) m.setLeft(2);
        G.audio.play('pour', { pos: bp, vol: 0.9, pitch: 0.8 });
        if (!this.tapped) { this.tapped = true; G.events.push({ type: 'brewBeer', who: p }); }
        this.made('mug', p);
        if (this.mugs <= 0) this.barrelState = 0;
      },
    });
  }
  private tapped = false;

  // ------------------------------------------------------------------ host
  private made(kind: string, p: Pig | null, pts = POINTS[kind] ?? 10) { G.events.push({ type: 'made', who: p, text: kind, why: String(pts) }); }
  private barrelNear(_p: Pig) { const b = this.barrel.synced.currP; return !this.barrel.banked && flat(b, this.fireC) < 3.2; }
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
      case 'can': {
        const pond = G.places?.pond;
        if (pond && Math.hypot(p.pos.x - pond.x, p.pos.z - pond.z) < pond.r + 0.6) { h.setLeft(h.def.servings ?? 3); G.audio.play('fill', { pos: p.pos, vol: 0.8 }); return true; }
        return false;
      }
      case 'beer': {
        this.serve(h);
        p.addBuzz(2, BREW.mugBuzz, 35);
        G.audio.play('drink', { pos: p.pos, vol: 0.9 });
        G.events.push({ type: 'sip', who: p });
        if (h.banked) {   // that was the last sip: a whole mug down → a burp in a moment
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
      case 'beer': return 'beer';
    }
    return '';
  }

  protected tick(dt: number) {
    // the fire burns down
    if (this.fuel > 0) this.fuel = Math.max(0, this.fuel - dt);
    if (this.stage === 2 && this.fuel > 0 && G.time - this.boilT > BREW.boil) { this.stage = 3; G.audio.play('ding', { pos: this.fireC, vol: 0.9 }); G.events.push({ type: 'wortReady' }); this.made('wort', null); }
    if (this.stage === 2 && this.fuel <= 0) this.boilT += dt;   // no fire: no boil
    // the barrel ferments where it is
    this.tap.at.copy(this.barrel.synced.currP); this.tap.markPos.copy(this.barrel.synced.currP).setY(this.barrel.synced.currP.y + 1.3);
    if (this.barrelState === 1 && G.time - this.fermT > BREW.ferment) { this.barrelState = 2; this.mugs = 8; G.audio.play('ding', { pos: this.barrel.synced.currP, vol: 0.9, pitch: 0.8 }); G.events.push({ type: 'beerReady' }); }
    // the threshing floor: jumps that land on it stomp every sheaf lying there (on the beat = double)
    const sheaves = this.props.filter((pr) => pr.def.item === 'sheaf' && !pr.banked && !pr.heldBy && flat(pr.synced.currP, this.floorC) < this.floorR);
    if (sheaves.length && !this.beatT0) this.beatT0 = G.time;
    if (!sheaves.length) this.beatT0 = 0;
    for (const p of G.pigs as Pig[]) {
      if (p.absent || p.out || p.mode !== 'normal') continue;
      if (!p.grounded) { this.airborne.set(p, Math.min(this.airborne.get(p) ?? 0, p.vel.y)); continue; }
      const fall = this.airborne.get(p); this.airborne.delete(p);
      if (fall === undefined || fall > -3 || !sheaves.length || flat(p.pos, this.floorC) > this.floorR) continue;
      const ph = ((G.time - this.beatT0) % BREW.beat), onBeat = ph < BREW.beatWin || ph > BREW.beat - BREW.beatWin;
      for (const s of sheaves) {
        const n = (this.stompN.get(s) ?? 0) + (onBeat ? 2 : 1);
        if (n >= BREW.stompNeed) { this.stompN.delete(s); const sp = s.synced.currP.clone(); this.consume(s); this.spawn('grain', sp.setY(sp.y + 0.4), 0); this.made('grain', p); }
        else this.stompN.set(s, n);
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
      if (t > 5) { this.dance.set(p, -20); G.audio.play('fanfare', { pos: p.pos, vol: 0.5 }); G.events.push({ type: 'tableDance', who: p }); }
    }
  }
  /** Drunk singing: 6 oinks within 20 s, close to Bob → he's had enough (a prank). */
  oinked(p: Pig) {
    if (G.net === 'client' || p.drunk < 0.3 || !G.farmer || flat(p.pos, G.farmer.pos) > 12) return;
    const list = (this.songs.get(p) ?? []).filter((t) => G.time - t < 20); list.push(G.time); this.songs.set(p, list);
    if (list.length >= 6) { this.songs.set(p, []); G.farmer.hugged?.(p); G.events.push({ type: 'serenade', who: p }); }
  }
  protected resetMode() {
    for (const pa of this.patches) pa.cut = false;
    this.grain = 0; this.water = 0; this.malt = 0; this.hops = 0; this.fuel = 0; this.stage = 0; this.boilT = 0;
    this.barrelState = 0; this.fermT = 0; this.mugs = 0; this.tapped = false; this.beatT0 = 0;
    this.stompN.clear(); this.airborne.clear(); this.dance.clear(); this.songs.clear(); this.burpAt.clear(); this.drunkMugs.clear();
    for (const pl of this.poles) pl.next = 0;
  }

  render(dt: number) {
    this.visions.render(dt);
    for (const pa of this.patches) { pa.up.visible = !pa.cut; pa.down.visible = pa.cut; if (!pa.cut) pa.up.rotation.z = Math.sin(G.time * 1.1 + pa.x * 0.7) * 0.04; }
    const burning = this.fuel > 0;
    this.flames.visible = burning;
    this.fireLight.intensity = burning ? 2.2 + Math.sin(G.time * 13) * 0.4 : 0;
    if (burning) this.flames.children.forEach((c, i) => { c.scale.y = 0.8 + Math.sin(G.time * 9 + i * 2) * 0.3; });
    this.brewM.visible = this.water > 0 || this.stage > 0;
    (this.brewM.material as THREE.MeshToonMaterial).color.setHex(this.stage === 0 ? (this.malt ? 0xc98a4a : 0x6fb7e8) : this.stage === 1 ? 0xb5793d : 0xd99a3a);
    if (this.stage >= 2 && burning && Math.random() < dt * 8) G.fx.puff(v1.copy(this.fireC).setY(this.fireC.y + 1.3), { count: 1, color: 0xf4f4f4, speed: 0.3, up: 1, life: 1.4, size: 0.4, alpha: 0.5 });
    if (this.barrelState === 1 && Math.random() < dt * 4) G.fx.bits(v2.copy(this.barrel.synced.currP).setY(this.barrel.synced.currP.y + 0.4), { count: 2, color: 0xfffaf0, speed: 0.4, up: 0.8, life: 0.6, size: 0.06, grow: 0, alpha: 1 });
    // the floor pulses on the beat while there's wheat on it
    const m = this.floorRing.material as THREE.MeshBasicMaterial;
    if (this.beatT0) { const ph = ((G.time - this.beatT0) % BREW.beat) / BREW.beat; m.opacity = Math.max(0, 1 - ph * 3) * 0.9; if (ph < 0.02) G.audio.play('drum', { pos: this.floorC, vol: 0.35, pitch: 0.7, minGap: 0.3 }); }
    else m.opacity = 0;
  }

  netState(n: number[]) {
    let cut = 0; this.patches.forEach((pa, i) => { if (pa.cut) cut |= 1 << i; });
    n.push(cut, this.grain, this.water, this.malt, this.hops, Math.round(this.fuel), this.stage, this.boilT, this.barrelState, this.fermT, this.mugs, this.beatT0, ...this.poles.map((p) => p.next));
  }
  netApply(n: number[]) {
    if (n.length < 12) return;
    this.patches.forEach((pa, i) => { pa.cut = (n[0] & (1 << i)) !== 0; });
    [, this.grain, this.water, this.malt, this.hops, this.fuel, this.stage, this.boilT, this.barrelState, this.fermT, this.mugs, this.beatT0] = n;
    this.poles.forEach((p, i) => { p.next = n[12 + i] ?? 0; });
    this.tap.at.copy(this.barrel.synced.currP); this.tap.markPos.copy(this.barrel.synced.currP).setY(this.barrel.synced.currP.y + 1.3);
  }

  adminButtons(): [string, string][] {
    return [['brew:sheaves', 'a.brewSheaves'], ['brew:grain', 'a.brewGrain'], ['brew:kettle', 'a.brewKettle'], ['brew:beer', 'a.brewBeer'], ['brew:mug', 'a.brewMug'],
      ['brew:drunk', 'a.brewDrunk'], ['tp:shed', 'a.tpShed'], ['tp:field', 'a.tpField'], ['tp:beam', 'a.tpBeam']];
  }
  admin(a: string, me: Pig): boolean {
    const f = me.forward, front = V3(me.pos.x + f.x * 1.3, me.pos.y + 0.5, me.pos.z + f.z * 1.3);
    switch (a) {
      case 'brew:sheaves': for (let i = 0; i < 4; i++) this.spawn('sheaf', front.clone().add(V3((i % 2) * 0.4, 0.3 * i, 0)), 0); return true;
      case 'brew:grain': this.spawn('grain', front, 0); return true;
      case 'brew:kettle': this.water = 2; this.malt = 1; this.fuel = 200; this.stage = 0; return true;
      case 'brew:beer': this.barrelState = 2; this.mugs = 8; return true;
      case 'brew:mug': this.spawn('beerMug', front, me.yaw); return true;
      case 'brew:drunk': me.addBuzz(2, 0.9, 90); return true;
    }
    return false;
  }
  markFor(id: string, me: Pig): THREE.Vector3 | null {
    const near = (item: string) => { let best: Prop | null = null, bd = Infinity; for (const p of this.props) { if (p.banked || p.def.item !== item) continue; const d = flat(p.synced.currP, me.pos); if (d < bd) { bd = d; best = p; } } return best?.synced.currP.clone().setY(best.synced.currP.y + 0.3) ?? null; };
    const held = this.item(me.held);
    switch (id) {
      case 'brewBeer': {
        if (this.barrelState === 2) return this.tap.markPos;
        if (this.barrelState === 1) return this.tap.markPos;
        if (this.stage === 3) return this.barrelNear(me) ? this.kettle.markPos : this.tap.markPos;
        if (this.stage >= 1) return this.stage === 1 && held !== 'hops' ? (near('hops') ?? V3(this.poles[1].x, this.poles[1].y + 3.4, this.poles[1].z)) : this.kettle.markPos;
        if (held === 'malt' || held === 'can' || held === 'log') return this.kettle.markPos;
        if (this.malt && this.water >= 2 && this.fuel <= 0) return near('log') ?? this.kettle.markPos;
        if (this.malt && this.water < 2) return near('can') ?? this.pump.markPos;
        if (this.malt) return this.kettle.markPos;
        if (near('malt')) return near('malt');
        if (held === 'grain' || this.grain > 0) return this.mill.markPos;
        if (near('grain')) return near('grain');
        if (held === 'sheaf' || this.beatT0) return this.floorC.clone().setY(this.floorC.y + 1.2);
        if (near('sheaf')) return near('sheaf');
        return near('scythe') ?? this.fieldC.clone().setY(this.fieldC.y + 2);
      }
      case 'drinkUp': return held === 'beer' ? null : near('beer') ?? (this.barrelState === 2 ? this.tap.markPos : null);
      case 'tableDance': return this.tableTop.clone().setY(this.tableTop.y + 1.4);
      case 'serenade': return G.farmer ? G.farmer.pos.clone().setY(G.farmer.pos.y + 2.2) : null;
      case 'beamWalk': return this.beamSpot.clone().setY(this.beamSpot.y + 1.5);
    }
    return null;
  }
}
