import * as THREE from 'three';
import { rigidSkin } from '../render/batch';
import { toonMat } from '../render/toon';
import { staticBox, staticCylinder } from '../core/physics';
import { fitted, has, sizeOf } from '../core/assets';
import { V3, type Rng } from '../core/util';
import { G } from '../game/ctx';
import type { Terrain, Rect } from './terrain';
import type { FarmBuild } from './farm1';
import type { DayNight } from './daynight';
import type { PROPS } from './props';

interface Ctx {
  scene: THREE.Scene; t: Terrain; rng: Rng; out: FarmBuild; daynight: DayNight; blocked: Rect[];
  decor: (model: string, x: number, z: number, o?: { height?: number; scale?: number; yaw?: number; collide?: 'box' | 'trunk' | false }) => THREE.Object3D | null;
  prop: (kind: keyof typeof PROPS, x: number, z: number, yaw?: number, lift?: number) => void;
  POND: { x: number; z: number; r: number }; F: Rect;
}

const mats = new Map<number, THREE.MeshToonMaterial>();
const M = (c: number) => { let m = mats.get(c); if (!m) { m = toonMat(c); mats.set(c, m); } return m; };
type V = [number, number, number];
function add(g: THREE.BufferGeometry, c: number | THREE.Material, p: V, parent: THREE.Object3D, r?: V, s?: V) {
  const o = new THREE.Mesh(g, typeof c === 'number' ? M(c) : c);
  o.position.set(...p); if (r) o.rotation.set(...r); if (s) o.scale.set(...s);
  o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
}
const WOOD = 0x9a6a3c, DARKWOOD = 0x6e4524;

/**
 * Farm dressing that makes the place feel lived-in: lantern posts (light up at night), a duck pond, Bob's laundry line,
 * a scarecrow in the corn, beehives with bees, a picnic table, an outhouse, a mailbox, Bob's porch rocking chair,
 * a pumpkin patch and a water trough.
 */
export function buildDecor(c: Ctx) {
  const { scene, t, rng, out, daynight, blocked } = c;
  const y = (x: number, z: number) => t.height(x, z);
  const groups: THREE.Object3D[] = [];
  const group = (x: number, z: number, yaw = 0) => { const g = new THREE.Group(); g.position.set(x, y(x, z), z); g.rotation.y = yaw; scene.add(g); groups.push(g); return g; };
  const keep = new Set<THREE.Object3D>();   // meshes animated by updaters
  const block = (x: number, z: number, r: number) => blocked.push({ x0: x - r, x1: x + r, z0: z - r, z1: z + r });

  // ---------------------------------------------------------------- lantern posts
  const LAMPS: [number, number][] = [[-14.2, -31.8], [4.2, 9.8], [22.6, 1.0], [20.6, -16.6], [-4.6, -38.2], [2.6, -53.6], [-33.4, -0.8], [-4.2, 18.4], [31, -78.6]];
  for (const [x, z] of LAMPS) {
    const H = 2.5;
    if (has('kaykit/post_lantern')) {
      const m = fitted('kaykit/post_lantern', { height: H }); m.position.set(x, y(x, z) - 0.02, z); m.rotation.y = rng.range(0, 6.28); scene.add(m); out.statics.push(m);
      const s = sizeOf(m);
      daynight.addLamp(scene, V3(x, y(x, z) + H - Math.min(0.45, s.y * 0.2), z));
    } else {
      const g = group(x, z);
      add(new THREE.CylinderGeometry(0.07, 0.09, H, 8), DARKWOOD, [0, H / 2, 0], g);
      add(new THREE.BoxGeometry(0.28, 0.32, 0.28), 0x2b2b2b, [0, H + 0.1, 0], g);
      daynight.addLamp(g, V3(0, H + 0.1, 0));
    }
    staticCylinder(V3(x, y(x, z) + 1.2, z), 1.2, 0.12);
    block(x, z, 1.2);
  }

  // ---------------------------------------------------------------- duck pond (washes the mud off)
  {
    const { x, z, r } = c.POND;
    const g = group(x, z);
    const water = toonMat(0x4fb2e3, { transparent: true, opacity: 0.86 });
    const w = add(new THREE.CircleGeometry(r, 48), water, [0, 0.06, 0], g, [-Math.PI / 2, 0, 0]);
    w.castShadow = false;
    const shine = add(new THREE.RingGeometry(r * 0.35, r * 0.42, 40, 1, 0.4, 1.4), toonMat(0xbfe8ff, { transparent: true, opacity: 0.6 }), [0.6, 0.07, -0.4], g, [-Math.PI / 2, 0, 0]);
    shine.castShadow = false; keep.add(shine);
    const edge = add(new THREE.TorusGeometry(r, 0.18, 6, 48), 0x7c6a4f, [0, 0.04, 0], g, [Math.PI / 2, 0, 0], [1, 1, 0.4]);
    edge.castShadow = false;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rng.range(-0.1, 0.1), rr = r + rng.range(0.1, 0.5);
      const rock = add(new THREE.IcosahedronGeometry(rng.range(0.22, 0.42), 1), rng.next() < 0.5 ? 0x9a9a92 : 0x85857c, [Math.cos(a) * rr, 0.1, Math.sin(a) * rr], g);
      rock.scale.y = 0.6;
    }
    for (let i = 0; i < 22; i++) {   // reeds + cattails
      const a = rng.range(0.6, 2.6), rr = r - rng.range(0.1, 0.7);
      const h = rng.range(0.7, 1.3);
      const rx = Math.cos(a) * rr, rz = Math.sin(a) * rr;
      add(new THREE.CylinderGeometry(0.015, 0.02, h, 5), 0x4f8f3a, [rx, h / 2, rz], g, [rng.range(-0.15, 0.15), 0, rng.range(-0.15, 0.15)]);
      if (rng.next() < 0.5) add(new THREE.CapsuleGeometry(0.035, 0.12, 4, 6), 0x6b4226, [rx, h - 0.05, rz], g);
    }
    for (let i = 0; i < 6; i++) {    // lily pads
      const a = rng.range(0, 6.28), rr = rng.range(1, r - 1);
      const pad = add(new THREE.CircleGeometry(rng.range(0.25, 0.4), 16, 0.3, Math.PI * 1.85), 0x4c9a3a, [Math.cos(a) * rr, 0.075, Math.sin(a) * rr], g, [-Math.PI / 2, 0, rng.range(0, 6)]);
      pad.castShadow = false;
      if (i % 2 === 0) add(new THREE.SphereGeometry(0.07, 10, 8), 0xff9ad2, [pad.position.x, 0.12, pad.position.z], g);
    }
    // jetty
    const j = new THREE.Group(); j.position.set(-r + 0.3, 0, 1.2); j.rotation.y = 0.2; g.add(j);
    for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(0.28, 0.06, 1.3), i % 2 ? WOOD : 0xa8774a, [i * 0.3, 0.32, 0], j);
    for (const [px, pz] of [[0, -0.55], [0, 0.55], [1.5, -0.55], [1.5, 0.55]]) add(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 6), DARKWOOD, [px, 0.1, pz], j);
    t.noGrass({ x0: x - r, x1: x + r, z0: z - r, z1: z + r });
    block(x, z, r + 1);
    let k = 0;
    out.updaters.push((dt, time) => {
      shine.rotation.z = time * 0.05;
      (water.color as THREE.Color).setHSL(0.55, 0.62, 0.6 + Math.sin(time * 0.8) * 0.015);
      // splashes when pigs paddle through
      k += dt;
      if (k > 0.12) { k = 0; for (const p of G.pigs) if (!p.out && Math.hypot(p.pos.x - x, p.pos.z - z) < r && Math.hypot(p.vel.x, p.vel.z) > 1.5)
        G.fx.bits(V3(p.pos.x, y(x, z) + 0.15, p.pos.z), { count: 3, color: 0xbfe8ff, spread: 0.3, speed: 1.6, up: 2.2, grav: 9, life: 0.5, size: 0.08, grow: 0, alpha: 0.9 }); }
    });
  }

  // ---------------------------------------------------------------- Bob's laundry line
  {
    const x0 = -35.6, x1 = -27.4, z = -28.6;
    const g = group((x0 + x1) / 2, z);
    const half = (x1 - x0) / 2;
    for (const s of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.07, 0.08, 2.1, 8), DARKWOOD, [s * half, 1.05, 0], g);
      add(new THREE.BoxGeometry(0.7, 0.07, 0.07), DARKWOOD, [s * half, 2.0, 0], g);
      staticBox(V3(x0 + (s < 0 ? 0 : x1 - x0), y(x0, z) + 1, z), V3(0.1, 1, 0.1));
    }
    for (const dz of [-0.28, 0.28]) add(new THREE.CylinderGeometry(0.008, 0.008, x1 - x0, 4), 0xeeeeee, [0, 1.97, dz], g, [0, 0, Math.PI / 2]);
    const clothes: THREE.Object3D[] = [];
    const cloth = (px: number, dz: number, w: number, h: number, col: number, kind: 'shirt' | 'pants' | 'sheet' | 'sock') => {
      const pivot = new THREE.Group(); pivot.position.set(px, 1.97, dz); g.add(pivot);
      const m = toonMat(col, { side: THREE.DoubleSide });
      if (kind === 'sheet') add(new THREE.PlaneGeometry(w, h, 4, 4), m, [0, -h / 2, 0], pivot);
      if (kind === 'sock') add(new THREE.BoxGeometry(0.1, 0.32, 0.03), m, [0, -0.16, 0], pivot);
      if (kind === 'shirt') {
        add(new THREE.BoxGeometry(w, h, 0.03), m, [0, -h / 2, 0], pivot);
        for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.22, 0.12, 0.03), m, [s * (w / 2 + 0.09), -0.1, 0], pivot, [0, 0, s * -0.5]);
      }
      if (kind === 'pants') {   // Bob's spare overalls
        add(new THREE.BoxGeometry(w, h * 0.45, 0.03), m, [0, -h * 0.22, 0], pivot);
        for (const s of [-1, 1]) add(new THREE.BoxGeometry(w * 0.45, h * 0.6, 0.03), m, [s * w * 0.26, -h * 0.72, 0], pivot);
      }
      clothes.push(pivot);
    };
    cloth(-3.2, -0.28, 0.6, 0.55, 0xd8403a, 'shirt'); cloth(-2.2, -0.28, 0.65, 0.95, 0x3f6fb5, 'pants'); cloth(-1.2, -0.28, 0.1, 0.3, 0xff7fb5, 'sock');
    cloth(-0.95, -0.28, 0.1, 0.3, 0xffe066, 'sock'); cloth(0.2, 0.28, 1.4, 1.1, 0xf6f1e6, 'sheet'); cloth(1.7, 0.28, 0.6, 0.55, 0x6fb3e0, 'shirt');
    cloth(2.8, -0.28, 0.6, 0.55, 0xf2f2f2, 'shirt');
    block((x0 + x1) / 2, z, 4.6);
    out.updaters.push((_dt, time) => { clothes.forEach((p, i) => { p.rotation.x = Math.sin(time * 1.9 + i * 0.7) * 0.22 + 0.12; p.rotation.z = Math.sin(time * 1.3 + i) * 0.04; }); });
  }

  // ---------------------------------------------------------------- scarecrow (corn field)
  {
    const x = -48, z = -99;
    const g = group(x, z, 0.4);
    add(new THREE.CylinderGeometry(0.06, 0.07, 2.4, 8), DARKWOOD, [0, 1.2, 0], g);
    add(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 8), DARKWOOD, [0, 1.75, 0], g, [0, 0, Math.PI / 2]);
    add(new THREE.CylinderGeometry(0.28, 0.34, 0.75, 12), 0xc0392b, [0, 1.55, 0], g);                       // shirt
    for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.62, 0.035, 0.6), 0x2b2b2b, [0, 1.3 + i * 0.17, 0], g, [0, i * 0.4, 0], [1, 1, 1]).visible = i % 2 === 0;
    for (const s of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.1, 0.12, 0.6, 10), 0xc0392b, [s * 0.5, 1.75, 0], g, [0, 0, Math.PI / 2]);
      for (let k = 0; k < 4; k++) add(new THREE.ConeGeometry(0.04, 0.22, 5), 0xf0cb6c, [s * (0.85 + k * 0.01), 1.75 + (k - 1.5) * 0.04, (k - 1.5) * 0.04], g, [0, 0, s * (Math.PI / 2 + (k - 1.5) * 0.3)]);
    }
    if (has('kaykit/pumpkin_orange_jackolantern')) {
      const h = fitted('kaykit/pumpkin_orange_jackolantern', { height: 0.55 }); h.position.set(0, 1.92, 0); g.add(h);
    } else add(new THREE.SphereGeometry(0.28, 16, 12), 0xe08a2e, [0, 2.15, 0], g);
    add(new THREE.CylinderGeometry(0.42, 0.44, 0.03, 24), 0xf0cb6c, [0, 2.42, 0], g, [0.15, 0, 0.1]);
    add(new THREE.CylinderGeometry(0.2, 0.22, 0.2, 16), 0xf0cb6c, [0, 2.53, 0], g, [0.15, 0, 0.1]);
    // a crow that isn't scared at all
    const crow = new THREE.Group(); crow.position.set(0.72, 1.92, 0); g.add(crow);
    add(new THREE.SphereGeometry(0.12, 12, 10), 0x1f1f2a, [0, 0, 0], crow, undefined, [1, 0.9, 1.3]);
    add(new THREE.SphereGeometry(0.08, 10, 8), 0x1f1f2a, [0, 0.1, 0.1], crow);
    add(new THREE.ConeGeometry(0.03, 0.09, 6), 0xffb02e, [0, 0.09, 0.2], crow, [Math.PI / 2, 0, 0]);
    out.updaters.push((_dt, time) => { crow.rotation.y = Math.sin(time * 0.7) > 0.6 ? 1.2 : 0; crow.position.y = 1.92 + Math.max(0, Math.sin(time * 3.1)) * 0.03; });
    staticCylinder(V3(x, y(x, z) + 1.2, z), 1.2, 0.15);
    block(x, z, 1.5);
  }

  // ---------------------------------------------------------------- beehives + bees (by the orchard)
  {
    const hives: THREE.Vector3[] = [];
    for (const [x, z] of [[21.5, -89.5], [24, -89.8], [26.5, -89.4]] as const) {
      const g = group(x, z, rng.range(-0.2, 0.2));
      add(new THREE.BoxGeometry(0.7, 0.12, 0.7), 0x8a6a3c, [0, 0.06, 0], g);
      for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.62, 0.24, 0.62), i % 2 ? 0xf6f1e6 : 0xffe9a8, [0, 0.24 + i * 0.25, 0], g);
      add(new THREE.ConeGeometry(0.55, 0.28, 4), 0xc0392b, [0, 1.05, 0], g, [0, Math.PI / 4, 0]);
      add(new THREE.BoxGeometry(0.22, 0.04, 0.05), 0x2b2b2b, [0, 0.18, 0.32], g);
      staticBox(V3(x, y(x, z) + 0.6, z), V3(0.36, 0.6, 0.36));
      hives.push(V3(x, y(x, z) + 0.5, z + 0.35));
      block(x, z, 1);
    }
    out.updaters.push((dt) => {
      if (G.night > 0.6) return;
      for (const h of hives) if (Math.random() < dt * 5)
        G.fx.bits(V3(h.x + (Math.random() - 0.5) * 1.2, h.y + Math.random() * 0.8, h.z + (Math.random() - 0.5) * 1.2),
          { count: 1, color: 0xffd23a, spread: 0.05, speed: 1.2, up: 0.4, grav: 0, life: 1.4, size: 0.06, grow: 0, drag: 0.2, alpha: 1 });
    });
  }

  // ---------------------------------------------------------------- picnic table (by the well)
  {
    const x = 8.5, z = -47.5;
    const g = group(x, z, 0.3);
    add(new THREE.BoxGeometry(1.9, 0.08, 0.85), WOOD, [0, 0.78, 0], g);
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(1.9, 0.06, 0.3), WOOD, [0, 0.45, s * 0.7], g);
      for (const k of [-1, 1]) add(new THREE.BoxGeometry(0.08, 0.8, 0.08), DARKWOOD, [k * 0.75, 0.4, s * 0.3], g, [s * 0.35, 0, 0]);
    }
    add(new THREE.CylinderGeometry(0.2, 0.17, 0.08, 16), 0xf2d27a, [0.3, 0.86, 0], g);           // pie
    add(new THREE.CylinderGeometry(0.21, 0.21, 0.02, 16), 0xffffff, [0.3, 0.83, 0], g);
    add(new THREE.CylinderGeometry(0.05, 0.045, 0.12, 12), 0xd8403a, [-0.4, 0.88, 0.1], g);      // cup
    staticBox(V3(x, y(x, z) + 0.45, z), V3(0.95, 0.45, 0.85), 0.3);
    block(x, z, 1.8);
  }

  // ---------------------------------------------------------------- outhouse (with a moon on the door)
  {
    const x = -41, z = -45;
    const g = group(x, z, Math.PI / 2);
    add(new THREE.BoxGeometry(1.2, 2.1, 1.2), 0x8f6034, [0, 1.05, 0], g);
    add(new THREE.BoxGeometry(1.45, 0.1, 1.5), 0x6b4226, [0, 2.2, 0], g, [0.12, 0, 0]);
    add(new THREE.BoxGeometry(0.8, 1.7, 0.04), 0xa8774a, [0, 0.9, 0.61], g);
    const moon = new THREE.Shape(); moon.absarc(0, 0, 0.11, 0.6, Math.PI * 2 - 0.6, false); moon.absarc(0.06, 0, 0.09, Math.PI * 2 - 0.9, 0.9, true);
    add(new THREE.ShapeGeometry(moon), 0x2b1a0c, [0, 1.5, 0.64], g);
    staticBox(V3(x, y(x, z) + 1.05, z), V3(0.62, 1.05, 0.62), Math.PI / 2);
    block(x, z, 1.6);
  }

  // ---------------------------------------------------------------- mailbox by the gate
  {
    const g = group(5.2, 18.2, -0.2);
    add(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 8), DARKWOOD, [0, 0.55, 0], g);
    add(new THREE.CapsuleGeometry(0.17, 0.32, 6, 12), 0xd8403a, [0, 1.2, 0], g, [Math.PI / 2, 0, 0]);
    add(new THREE.BoxGeometry(0.03, 0.22, 0.12), 0xffd166, [0.18, 1.32, -0.1], g);
    staticCylinder(V3(5.2, y(5.2, 18.2) + 0.7, 18.2), 0.7, 0.2);
  }

  // ---------------------------------------------------------------- Bob's rocking chair (he reads the paper here)
  {
    const g = group(-15.3, -29.2, Math.atan2(-12 - -15.3, -22 - -29.2) + Math.PI);
    for (const s of [-1, 1]) {
      add(new THREE.TorusGeometry(0.7, 0.03, 6, 20, 1.1), DARKWOOD, [s * 0.28, 0.72, 0.05], g, [0, Math.PI / 2, Math.PI + 1.0]);
      add(new THREE.BoxGeometry(0.05, 0.5, 0.05), DARKWOOD, [s * 0.28, 0.32, 0.2], g);
      add(new THREE.BoxGeometry(0.05, 0.5, 0.05), DARKWOOD, [s * 0.28, 0.32, -0.2], g);
    }
    add(new THREE.BoxGeometry(0.62, 0.06, 0.55), WOOD, [0, 0.47, 0], g);
    add(new THREE.BoxGeometry(0.62, 0.7, 0.06), WOOD, [0, 0.85, 0.3], g, [-0.2, 0, 0]);
    add(new THREE.BoxGeometry(0.5, 0.06, 0.45), 0xd8403a, [0, 0.51, 0], g);   // cushion
  }

  // ---------------------------------------------------------------- pumpkin patch (grab-able) + water trough
  for (let i = 0; i < 7; i++) c.prop(i % 3 === 0 ? 'bigPumpkin' : 'pumpkin', -27 + rng.range(-2, 2), -62 + rng.range(-3, 3));
  {
    const x = 35, z = -52.6;
    const g = group(x, z);
    add(new THREE.BoxGeometry(2.2, 0.5, 0.7), 0x8a8f99, [0, 0.25, 0], g);
    add(new THREE.BoxGeometry(2.0, 0.04, 0.5), toonMat(0x5fb6e6), [0, 0.46, 0], g);
    staticBox(V3(x, y(x, z) + 0.25, z), V3(1.1, 0.25, 0.35));
  }
  // fewer draw calls: each piece becomes one skinned mesh (moving pivots are its bones)
  for (const g of groups) rigidSkin(g, keep);
  void c.decor; void c.F;
}
