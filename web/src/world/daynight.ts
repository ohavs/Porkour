import * as THREE from 'three';
import type { Gfx } from '../render/gfx';
import { G, ADMIN, SECS_PER_HOUR, DUSK, DAWN } from '../game/ctx';
import { clamp, smoothstep, lerp } from '../core/util';
import type { Loop } from '../core/audio';
import { damp } from '../core/util';
import { RainFx } from '../render/rain';
import { MOD } from '../game/modifiers';

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

export interface Lamp { at: THREE.Vector3; glow: THREE.Mesh; base: number; distance: number; d2: number }

/**
 * Day / night: moves the sun and moon, blends sky / light / fog / cloud colours through dawn, day, dusk and night,
 * shows stars, turns the farm lamps on, swaps day birds ↔ night crickets, rooster at dawn.
 */
export class DayNight {
  lamps: Lamp[] = [];
  /**
   * A fixed pool of point lights handed to the lamps nearest the camera each frame. Every light costs on every
   * pixel of every lit material (also by day at intensity 0), so the pool is a graphics option, not one per lamp.
   * The farthest lit lamp fades out as the next one comes closer: no popping.
   */
  private pool: THREE.PointLight[] = [];
  private poolSize = 6;
  private lastHour = G.hour;
  private ambDay: Loop | null = null;
  private ambNight: Loop | null = null;
  private birdT = 0; private cricketT = 0;
  private started = false;
  private fogNear = 110; private fogFar = 330;
  /** Weather of the round's modifier (0..1, eased in / out): rain and fog. */
  weather = { rain: 0, fog: 0 };
  private rainFx: RainFx;
  private rainLoop: Loop | null = null;
  private thunderAt = 0; private flash = 0; private flashes: number[] = []; private boomAt = 0;

  constructor(private gfx: Gfx) { this.rainFx = new RainFx(gfx.scene); }

  /** A lantern: glowing bulb + (when in the pool) a warm point light, on at night. */
  addLamp(parent: THREE.Object3D, at: THREE.Vector3, intensity = 9, distance = 13) {
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd27a, toneMapped: false }));
    glow.position.copy(at); parent.add(glow);
    parent.updateMatrixWorld(true);
    this.lamps.push({ at: at.clone().applyMatrix4(parent.matrixWorld), glow, base: intensity, distance, d2: 0 });
    if (this.pool.length < Math.min(this.poolSize, this.lamps.length)) this.setLampLights(this.poolSize);
  }

  /** How many lamps really light their surroundings (the nearest ones). Changing it recompiles materials once. */
  setLampLights(n: number) {
    this.poolSize = n;
    const want = Math.min(n, this.lamps.length);
    while (this.pool.length > want) this.pool.pop()!.removeFromParent();
    while (this.pool.length < want) {
      const l = new THREE.PointLight(0xffb45a, 0, 13, 1.6);
      this.gfx.scene.add(l); this.pool.push(l);
    }
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
    this.applyWeather(dt, camPos);
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
    (g.stars.material as THREE.PointsMaterial).opacity = smoothstep(0.35, 1, G.night) * 0.95 * (1 - Math.max(this.weather.rain, this.weather.fog * 0.8));
    g.stars.position.copy(camPos); g.stars.rotation.y = h * 0.03;
    // lamps
    const lampOn = smoothstep(0.25, 0.75, G.night);
    for (const l of this.lamps) {
      l.d2 = l.at.distanceToSquared(camPos);
      (l.glow.material as THREE.MeshBasicMaterial).color.setHex(lampOn > 0.3 ? 0xffd27a : 0x8a7a5a);
    }
    const near = this.pool.length < this.lamps.length ? [...this.lamps].sort((a, b) => a.d2 - b.d2) : this.lamps;
    const flick = 0.94 + Math.sin(G.time * 7.3) * 0.03;
    this.pool.forEach((light, i) => {
      const l = near[i];
      // the last lit lamp hands over smoothly to the next one in line
      const fade = i === this.pool.length - 1 && near[i + 1] ? clamp((Math.sqrt(near[i + 1].d2) - Math.sqrt(l.d2)) / 6, 0, 1) : 1;
      light.position.copy(l.at); light.distance = l.distance;
      light.intensity = l.base * lampOn * fade * (flick + Math.sin(G.time * 13 + i * 1.7) * 0.03);
    });
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

  /**
   * Rain: grey sky and clouds, less sun, the fog comes in, streaks + rain loop, lightning flashes (sky + light) with the
   * thunder a moment later. Fog: the fog wall closes in to ~60 m and the sky fades to its colour. Purely visual —
   * the gameplay side is in modifiers.ts (Bob's sight / hearing), so every browser just eases toward G.mod.
   */
  private applyWeather(dt: number, cam: THREE.Vector3) {
    const W = this.weather, g = this.gfx, u = g.skyMat.uniforms, fog = g.scene.fog as THREE.Fog;
    W.rain = damp(W.rain, G.mod === 'rain' ? 1 : 0, 0.6, dt);
    W.fog = damp(W.fog, G.mod === 'fog' ? 1 : 0, 0.6, dt);
    const r = W.rain, f = W.fog, day = 1 - G.night;
    if (r > 0.001) {
      u.uTop.value.lerp(ca.setHex(0x66758a), r * (0.35 + 0.5 * day));
      u.uHorizon.value.lerp(ca.setHex(0x97a2ae), r * (0.3 + 0.45 * day));
      u.uBottom.value.lerp(ca.setHex(0x55634a), r * 0.4 * day);
      u.uGlow.value.multiplyScalar(1 - r * 0.85);
      g.sun.intensity *= 1 - r * 0.7;
      g.hemi.intensity *= 1 - r * 0.22;
      g.hemi.color.lerp(ca.setHex(0xb8c4d2), r * 0.5 * day);
      g.cloudMat.color.lerp(ca.setHex(0x8b95a3), r * 0.75 * day);
      fog.near = lerp(fog.near, 30, r); fog.far = lerp(fog.far, 150, r);
      fog.color.lerp(ca.setHex(0x9aa5b0), r * 0.6 * day);
    }
    if (f > 0.001) {
      const fc = ca.setHex(0xd3dade).lerp(cb.setHex(0x2a3550), G.night);
      u.uTop.value.lerp(fc, f * 0.55); u.uHorizon.value.lerp(fc, f * 0.9); u.uBottom.value.lerp(fc, f * 0.8);
      u.uGlow.value.multiplyScalar(1 - f * 0.6);
      g.sun.intensity *= 1 - f * 0.35;
      fog.color.lerp(fc, f); fog.near = lerp(fog.near, 3, f); fog.far = lerp(fog.far, 62, f);
    }
    (g.scene.background as THREE.Color).copy(u.uHorizon.value);
    g.outline?.setFade(Math.min(70, fog.near + 4), Math.min(160, fog.near + (fog.far - fog.near) * 0.55));
    // lightning: a double flash, thunder 0.6–2 s later
    if (r > 0.6) {
      if (!this.thunderAt) this.thunderAt = G.time + 4 + Math.random() * 8;
      if (G.time > this.thunderAt) {
        const [a, b] = MOD.rain.thunder;
        this.thunderAt = G.time + a + Math.random() * (b - a);
        this.flashes = [G.time, G.time + 0.14 + Math.random() * 0.1];
        this.boomAt = G.time + 0.6 + Math.random() * 1.4;
      }
    } else this.thunderAt = 0;
    if (this.flashes.length && G.time >= this.flashes[0]) { this.flash = 1; this.flashes.shift(); }
    if (this.boomAt && G.time >= this.boomAt) { this.boomAt = 0; G.audio?.play('thunder', { vol: 0.75, bus: 'amb', rand: 0.1 }); }
    this.flash = Math.max(0, this.flash - dt * 7);
    if (this.flash > 0) {
      const k = this.flash * r;
      g.hemi.intensity += k * 2.2;
      u.uTop.value.lerp(ca.setHex(0xe8eeff), k * 0.6); u.uHorizon.value.lerp(ca.setHex(0xf2f5ff), k * 0.5);
    }
    this.rainFx.update(dt, cam, r, G.night);
  }

  private sounds(dt: number, cam: THREE.Vector3) {
    const A = G.audio; if (!A || A.ctx.state !== 'running') return;
    if (!this.ambDay) this.ambDay = A.loop('amb_day', { vol: 0 });
    if (!this.ambNight) this.ambNight = A.loop('night', { vol: 0 });
    if (!this.rainLoop && this.weather.rain > 0.01) this.rainLoop = A.loop('rain', { vol: 0, bus: 'amb' });
    this.rainLoop?.setVolume(this.weather.rain * 0.55, 1);
    this.ambDay?.setVolume((1 - G.night) * 0.35 * (1 - this.weather.rain * 0.7), 1.5);
    this.ambNight?.setVolume(G.night * 0.32, 1.5);
    A.musicDuck(1 - G.night * 0.55);
    // scattered calls around the listener
    const around = () => cam.clone().add(new THREE.Vector3((Math.random() - 0.5) * 30, 2, (Math.random() - 0.5) * 30));
    this.birdT -= dt; this.cricketT -= dt;
    if (this.birdT <= 0) { this.birdT = 3 + Math.random() * 6; if (G.night < 0.3 && this.weather.rain < 0.3) A.play('bird', { pos: around(), vol: 0.5, bus: 'amb', rand: 0.15 }); }
    if (this.cricketT <= 0) { this.cricketT = 0.4 + Math.random() * 1.2; if (G.night > 0.6) A.play('cricket', { pos: around(), vol: 0.55, bus: 'amb', rand: 0.1, minGap: 0.2 }); }
  }
}
