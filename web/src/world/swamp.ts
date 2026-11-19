import * as THREE from 'three';
import { Rng, V3, clamp } from '../core/util';
import { G } from '../game/ctx';
import type { Terrain, Rect } from './terrain';
import type { FarmBuild } from './farmKit';

/**
 * Farm 4's bog (the pumpkin farm at night): will-o'-wisps (soft green lights drifting over the water — only at night),
 * a low mist lying on the pools, lily pads, frogs croaking from the water, an owl in a dead tree. The pools and channels
 * themselves are `Terrain.river` water (murky tint) + boardwalks / stepping stones from the waterworks.
 */
function glow() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const k = c.getContext('2d')!, g = k.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(220,255,225,0.75)'); g.addColorStop(1, 'rgba(160,255,190,0)');
  k.fillStyle = g; k.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
function mistTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const k = c.getContext('2d')!, r = new Rng(9);
  for (let i = 0; i < 14; i++) {
    const x = r.range(30, 98), y = r.range(30, 98), rad = r.range(18, 40), g = k.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    k.fillStyle = g; k.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(c);
}

export function swamp(scene: THREE.Scene, t: Terrain, out: FarmBuild, area: Rect, pools: { x: number; z: number; r: number }[], owlAt: THREE.Vector3) {
  const rng = new Rng(3131);
  // ---- lily pads (+ a few pink flowers) on the pools
  const pad = new THREE.CircleGeometry(1, 14, 0.3, Math.PI * 1.85).rotateX(-Math.PI / 2);
  const pads = new THREE.InstancedMesh(pad, new THREE.MeshToonMaterial({ color: 0x4c8a3a }), 40);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  let n = 0;
  for (const p of pools) for (let i = 0; i < Math.round(p.r * 2.4) && n < 40; i++) {
    const a = rng.range(0, 6.28), d = rng.range(0.6, p.r * 0.8), x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
    q.setFromAxisAngle(V3(0, 1, 0), rng.range(0, 6.28));
    const s = rng.range(0.25, 0.42);
    m.compose(V3(x, t.surfaceAt(p.x, p.z) + 0.035, z), q, V3(s, 1, s)); pads.setMatrixAt(n++, m);
  }
  pads.count = n; pads.receiveShadow = true; scene.add(pads);
  // ---- will-o'-wisps (additive sprites, only at night)
  const wisps: { s: THREE.Sprite; x: number; z: number; ph: number; sp: number }[] = [];
  const wmat = new THREE.SpriteMaterial({ map: glow(), color: 0xaaffc0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, fog: false });
  for (let i = 0; i < 7; i++) {
    const s = new THREE.Sprite(wmat); s.scale.setScalar(0.55); scene.add(s);
    wisps.push({ s, x: rng.range(area.x0, area.x1), z: rng.range(area.z0, area.z1), ph: rng.range(0, 6.28), sp: rng.range(0.25, 0.5) });
  }
  // ---- mist lying on the water
  const mmat = new THREE.MeshBasicMaterial({ map: mistTex(), transparent: true, depthWrite: false, opacity: 0.5, color: 0xd8e8f0 });
  const mists: THREE.Mesh[] = [];
  for (const p of pools) {
    const me = new THREE.Mesh(new THREE.PlaneGeometry(p.r * 3, p.r * 3).rotateX(-Math.PI / 2), mmat);
    me.position.set(p.x, t.surfaceAt(p.x, p.z) + 0.35, p.z); me.renderOrder = 6; scene.add(me); mists.push(me);
  }
  let frogT = 2, owlT = 12;
  out.updaters.push((dt, time) => {
    const night = G.night ?? 0;
    wmat.opacity = clamp(night * 1.2, 0, 0.95);
    mmat.opacity = 0.25 + night * 0.35;
    const cam = G.cam?.position;
    for (const w of wisps) {
      w.ph += dt * w.sp;
      const x = w.x + Math.sin(w.ph * 0.7) * 4 + Math.sin(w.ph * 1.9) * 0.8, z = w.z + Math.cos(w.ph * 0.55) * 4;
      w.s.position.set(x, t.height(x, z) + 0.9 + Math.sin(w.ph * 2.3) * 0.35, z);
      w.s.scale.setScalar(0.45 + Math.sin(time * 3 + w.ph) * 0.08);
    }
    for (const me of mists) me.rotation.y += dt * 0.02;
    // frogs (more at night) and the owl, only when someone's close enough to hear
    if (!cam || cam.x < area.x0 - 40 || cam.x > area.x1 + 40 || cam.z < area.z0 - 40 || cam.z > area.z1 + 40) return;
    frogT -= dt * (0.4 + night);
    if (frogT <= 0) {
      frogT = rng.range(1.2, 4.5);
      const p = pools[rng.int(0, pools.length - 1)], a = rng.range(0, 6.28);
      G.audio.play('frog', { pos: V3(p.x + Math.cos(a) * p.r * 0.8, t.surfaceAt(p.x, p.z), p.z + Math.sin(a) * p.r * 0.8), vol: 0.75, rand: 0.12 });
    }
    owlT -= dt;
    if (owlT <= 0) { owlT = rng.range(25, 50); if (night > 0.3) G.audio.play('owl', { pos: owlAt, vol: 0.7 }); }
  });
}
