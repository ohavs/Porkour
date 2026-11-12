import * as THREE from 'three';
import type { Gfx } from '../render/gfx';
import { G, ADMIN, SECS_PER_HOUR, DUSK, DAWN } from '../game/ctx';
import { clamp, smoothstep, lerp } from '../core/util';
import type { Loop } from '../core/audio';

/** Palette key at an hour. Colours are hex, the rest scalars. */
interface Key { h: number; top: number; hor: number; bot: number; sun: number; sunI: number; hemiS: number; hemiG: number; hemiI: number; cloud: number; cloudE: number; glow: number }
const K = (h: number, top: number, hor: number, bot: number, sun: number, sunI: number, hemiS: number, hemiG: number, hemiI: number, cloud: number, cloudE: number, glow: number): Key =>
  ({ h, top, hor, bot, sun, sunI, hemiS, hemiG, hemiI, cloud, cloudE, glow });
const NIGHT = K(0, 0x0b1636, 0x24365e, 0x16241a, 0x9fb8ff, 0.55, 0x6f86c4, 0x1d2a26, 0.55, 0x47527a, 0x161c33, 0x000000);
const KEYS: Key[] = [
  NIGHT, { ...NIGHT, h: 4.6 },
  K(5.6, 0x3a3f7a, 0xf09a7a, 0x4a5a3a, 0xffb27a, 0.9, 0xb7a6d6, 0x4a5a36, 0.8, 0xf2b5a8, 0x6a4a5a, 0xff9a5a),
  K(7, 0x5fa8ea, 0xffe0c0, 0x8fc070, 0xffe6c4, 2.0, 0xd8e6ff, 0x7aa64a, 1.05, 0xffffff, 0x9a9aa8, 0xffe4b0),
  K(9, 0x3d9be9, 0xbfe6ff, 0x9fd27a, 0xfff1d6, 2.4, 0xd8efff, 0x7aa64a, 1.15, 0xffffff, 0x8fa7bf, 0xfff1c0),
  K(17, 0x3d9be9, 0xbfe6ff, 0x9fd27a, 0xfff1d6, 2.4, 0xd8efff, 0x7aa64a, 1.15, 0xffffff, 0x8fa7bf, 0xfff1c0),
  K(19, 0x4a7fd0, 0xffc58a, 0x8aa860, 0xffb070, 1.8, 0xf0d0b8, 0x6a8a40, 1.0, 0xffe0c8, 0x9a7a7a, 0xff9a4a),
  K(20.2, 0x2a3570, 0xe9806a, 0x3a4a30, 0xff8a5a, 0.8, 0x9a8ac0, 0x3a4a2a, 0.75, 0xc08aa0, 0x4a3a50, 0xff6a3a),
  { ...NIGHT, h: 21.4 }, { ...NIGHT, h: 24 },
];
const ca = new THREE.Color(), cb = new THREE.Color();
const mix = (out: THREE.Color, a: number, b: number, t: number) => out.copy(ca.setHex(a)).lerp(cb.setHex(b), t);

export interface Lamp { light: THREE.PointLight; glow: THREE.Mesh; base: number }

/**
 * Day / night: moves the sun and moon, blends sky / light / fog / cloud colours through dawn, day, dusk and night,
 * shows stars, turns the farm lamps on, swaps day birds ↔ night crickets, rooster at dawn.
 */
export class DayNight {
  lamps: Lamp[] = [];
  private lastHour = G.hour;
  private ambDay: Loop | null = null;
  private ambNight: Loop | null = null;
  private birdT = 0; private cricketT = 0;
  private started = false;
  private fogNear = 110; private fogFar = 330;

  constructor(private gfx: Gfx) {}

  /** A lantern: warm point light + glowing bulb, on at night. */
  addLamp(parent: THREE.Object3D, at: THREE.Vector3, intensity = 9, distance = 13) {
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd27a, toneMapped: false }));
    glow.position.copy(at); parent.add(glow);
    const light = new THREE.PointLight(0xffb45a, 0, distance, 1.6);
    light.position.copy(at); parent.add(light);
    this.lamps.push({ light, glow, base: intensity });
  }

  /** Advance the clock (fixed step). */
  tick(dt: number) {
    if (ADMIN.freezeTime) return;
    G.hour += (dt / SECS_PER_HOUR) * ADMIN.daySpeed;
    if (G.hour >= 24) { G.hour -= 24; G.day++; }
  }

  setHour(h: number) { G.hour = ((h % 24) + 24) % 24; this.lastHour = G.hour; }

  update(dt: number, camPos: THREE.Vector3) {
    const h = G.hour, g = this.gfx;
    // night factor: 1 between dusk and dawn, smooth ramps
    G.night = h >= 12 ? smoothstep(DUSK - 0.6, DUSK + 1.2, h) : 1 - smoothstep(DAWN - 0.8, DAWN + 1, h);
    // palette
    let i = 0; while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
    const a = KEYS[i], b = KEYS[i + 1], t = clamp((h - a.h) / Math.max(b.h - a.h, 1e-3), 0, 1);
    const u = g.skyMat.uniforms;
    mix(u.uTop.value, a.top, b.top, t); mix(u.uHorizon.value, a.hor, b.hor, t); mix(u.uBottom.value, a.bot, b.bot, t);
    mix(u.uGlow.value, a.glow, b.glow, t);
    (g.scene.background as THREE.Color).copy(u.uHorizon.value);
    const fog = g.scene.fog as THREE.Fog;
    fog.color.copy(u.uHorizon.value).lerp(ca.setHex(0xc8e8ff), 0.25 * (1 - G.night));
    fog.near = lerp(this.fogNear, 60, G.night); fog.far = lerp(this.fogFar, 220, G.night);
    mix(g.sun.color, a.sun, b.sun, t); g.sun.intensity = lerp(a.sunI, b.sunI, t);
    mix(g.hemi.color, a.hemiS, b.hemiS, t); mix(g.hemi.groundColor, a.hemiG, b.hemiG, t); g.hemi.intensity = lerp(a.hemiI, b.hemiI, t);
    mix(g.cloudMat.color, a.cloud, b.cloud, t); mix(g.cloudMat.emissive, a.cloudE, b.cloudE, t);
    // sun arc 6:00 → 19:30 (east → west, low in the south), moon the other way round
    const sunA = ((h - 6) / 13.5) * Math.PI;
    const sunDir = new THREE.Vector3(Math.cos(sunA), Math.sin(sunA) * 0.85 + 0.02, 0.42).normalize();
    const moonA = (((h + 24 - 19.5) % 24) / 10.5) * Math.PI;
    const moonDir = new THREE.Vector3(-Math.cos(moonA) * 0.9, Math.sin(moonA) * 0.8 + 0.12, -0.35).normalize();
    u.uSunDir.value.copy(sunDir);
    const useMoon = G.night > 0.5;
    g.sunDir.copy(useMoon ? moonDir : sunDir);
    if (g.sunDir.y < 0.18) g.sunDir.y = 0.18, g.sunDir.normalize();        // keep shadows sane near the horizon
    g.moon.position.copy(moonDir).multiplyScalar(420).add(camPos);
    g.moon.lookAt(camPos);
    (g.moon.material as THREE.MeshBasicMaterial).opacity = clamp(G.night * 1.3, 0, 1);
    g.moon.visible = G.night > 0.02;
    (g.stars.material as THREE.PointsMaterial).opacity = smoothstep(0.35, 1, G.night) * 0.95;
    g.stars.position.copy(camPos); g.stars.rotation.y = h * 0.03;
    // lamps
    const lampOn = smoothstep(0.25, 0.75, G.night);
    for (const l of this.lamps) {
      l.light.intensity = l.base * lampOn * (0.94 + Math.sin(G.time * 13 + l.base) * 0.03 + Math.sin(G.time * 7.3) * 0.03);
      (l.glow.material as THREE.MeshBasicMaterial).color.setHex(lampOn > 0.3 ? 0xffd27a : 0x8a7a5a);
    }
    this.sounds(dt, camPos);
    // dawn / dusk events
    const crossed = (x: number) => (this.lastHour < x && h >= x) || (this.lastHour > h && (x > this.lastHour || x <= h) && this.lastHour - h > 12);
    if (this.started) {
      if (crossed(DUSK + 0.6)) G.events.push({ type: 'night' });
      if (crossed(DAWN)) { G.events.push({ type: 'dawn' }); G.audio.play('rooster', { vol: 0.8, bus: 'amb' }); }
    }
    this.started = true;
    this.lastHour = h;
  }

  private sounds(dt: number, cam: THREE.Vector3) {
    const A = G.audio; if (!A || A.ctx.state !== 'running') return;
    if (!this.ambDay) this.ambDay = A.loop('amb_day', { vol: 0 });
    if (!this.ambNight) this.ambNight = A.loop('night', { vol: 0 });
    this.ambDay?.setVolume((1 - G.night) * 0.35, 1.5);
    this.ambNight?.setVolume(G.night * 0.32, 1.5);
    A.musicDuck(1 - G.night * 0.55);
    // scattered calls around the listener
    const around = () => cam.clone().add(new THREE.Vector3((Math.random() - 0.5) * 30, 2, (Math.random() - 0.5) * 30));
    this.birdT -= dt; this.cricketT -= dt;
    if (this.birdT <= 0) { this.birdT = 3 + Math.random() * 6; if (G.night < 0.3) A.play('bird', { pos: around(), vol: 0.5, bus: 'amb', rand: 0.15 }); }
    if (this.cricketT <= 0) { this.cricketT = 0.4 + Math.random() * 1.2; if (G.night > 0.6) A.play('cricket', { pos: around(), vol: 0.55, bus: 'amb', rand: 0.1, minGap: 0.2 }); }
  }
}
