import * as THREE from 'three';
import { rigidSkin } from './batch';
import {
  EffectComposer, RenderPass, EffectPass, SMAAEffect, BloomEffect, ToneMappingEffect, ToneMappingMode,
  VignetteEffect, HueSaturationEffect, FXAAEffect, type Pass,
} from 'postprocessing';
import { InkOutline, toonMat } from './toon';
import { Rng } from '../core/util';

import { SHADOW_SIZE, type GfxOpts } from './quality';

const SKY_VERT = `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }`;
const SKY_FRAG = `varying vec3 vDir; uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom; uniform vec3 uSunDir; uniform vec3 uGlow;
void main() {
  float h = vDir.y;
  vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(smoothstep(0.0, 0.6, h), 0.8)) : mix(uHorizon, uBottom, smoothstep(0.0, -0.2, h));
  float s = max(dot(normalize(vDir), uSunDir), 0.0);
  c += uGlow * (pow(s, 6.0) * 0.55 + pow(s, 600.0) * 2.5);   // warm glow around the sun + the disc
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

/** Cartoon renderer: gradient sky + puffy clouds, warm sun + hemisphere light, cel shading, ink outlines, light bloom. */
export class Gfx {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  sunDir = new THREE.Vector3(-0.5, 0.75, 0.42).normalize();
  composer: EffectComposer;
  opts: GfxOpts;
  /** Dynamic resolution multiplier (1 = the chosen resolution) and its frame-time bookkeeping. */
  dyn = 1;
  private dynT = 0; private dynFrames = 0; private dynTime = 0; private dynBlockUntil = 0; private dynRaisedAt = -1; private clock = 0;
  /** Seconds spent at the lowest dynamic resolution while still slow (→ a "lower the graphics" tip). */
  slowFor = 0;
  private passes: Pass[] = [];
  clouds = new THREE.Group();
  skyMat!: THREE.ShaderMaterial;
  hemi!: THREE.HemisphereLight;
  stars!: THREE.Points;
  moon!: THREE.Mesh;
  cloudMat!: THREE.MeshToonMaterial;
  outline!: InkOutline;

  constructor(container: HTMLElement, opts: GfxOpts) {
    this.opts = { ...opts };
    const r = new THREE.WebGLRenderer({ powerPreference: 'high-performance', antialias: false, stencil: false, depth: true });
    r.setPixelRatio(this.pixelRatio());
    r.setSize(innerWidth, innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = opts.shadows >= 3 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    container.appendChild(r.domElement);
    this.renderer = r;

    this.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 900);

    const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x3d9be9) }, uHorizon: { value: new THREE.Color(0xbfe6ff) }, uBottom: { value: new THREE.Color(0x9fd27a) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uGlow: { value: new THREE.Color(0xfff1c0) },
      },
    }));
    this.skyMat = sky.material as THREE.ShaderMaterial;
    sky.renderOrder = -10; sky.frustumCulled = false;
    this.scene.add(sky);
    this.scene.background = new THREE.Color(0xbfe6ff);
    this.scene.fog = new THREE.Fog(0xc8e8ff, 110, 330);
    this.makeClouds();
    this.scene.add(this.clouds);

    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    this.sun.castShadow = opts.shadows > 0;
    const S = SHADOW_SIZE[opts.shadows] || 1024;
    this.sun.shadow.mapSize.set(S, S);
    const c = this.sun.shadow.camera; c.left = -40; c.right = 40; c.top = 40; c.bottom = -40; c.near = 1; c.far = 220;
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xd8efff, 0x7aa64a, 1.15);
    this.scene.add(this.hemi);
    this.makeStars();

    this.composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType });
    this.buildPost();
    addEventListener('resize', () => this.resize());
  }

  private pixelRatio() { return Math.max(0.35, Math.min(devicePixelRatio, this.opts.dpr) * this.opts.res * this.dyn); }

  /**
   * Post chain from the options. Ink lines, bloom, colour, tone mapping and vignette run in ONE full-screen pass
   * (they used to be two); anti-aliasing runs last so the ink lines get smoothed too.
   */
  private buildPost() {
    for (const p of this.passes) { this.composer.removePass(p); p.dispose(); }
    this.passes = [];
    const o = this.opts;
    this.outline = new InkOutline(o.dpr * o.res >= 1.2 ? 1.4 : 1.2);
    const fx = [
      ...(o.outline ? [this.outline] : []),
      ...(o.bloom ? [new BloomEffect({ intensity: 0.35, luminanceThreshold: 0.9, luminanceSmoothing: 0.15, mipmapBlur: true })] : []),
      new HueSaturationEffect({ saturation: 0.12 }),
      new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL }),
      new VignetteEffect({ darkness: 0.3, offset: 0.35 }),
    ];
    this.passes.push(new RenderPass(this.scene, this.camera), new EffectPass(this.camera, ...fx));
    if (o.aa === 2) this.passes.push(new EffectPass(this.camera, new SMAAEffect()));
    if (o.aa === 1) this.passes.push(new EffectPass(this.camera, new FXAAEffect()));
    for (const p of this.passes) this.composer.addPass(p);
  }

  private makeClouds() {
    const rng = new Rng(77);
    const mat = toonMat(0xffffff, { emissive: new THREE.Color(0x8fa7bf) });
    this.cloudMat = mat;
    const blob = new THREE.IcosahedronGeometry(1, 3);
    for (let i = 0; i < 16; i++) {
      const g = new THREE.Group();
      const n = rng.int(4, 7);
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(blob, mat);
        const s = rng.range(5, 9) * (k === 0 ? 1.3 : 1);
        m.scale.set(s, s * 0.75, s);
        m.position.set((k - n / 2) * rng.range(4, 6), rng.range(-1, 2), rng.range(-3, 3));
        g.add(m);
      }
      const a = (i / 16) * Math.PI * 2 + rng.range(-0.2, 0.2), d = rng.range(160, 260);
      g.position.set(Math.cos(a) * d, rng.range(55, 95), Math.sin(a) * d - 40);
      g.rotation.y = rng.range(0, 6.28);
      this.clouds.add(g);
    }
    rigidSkin(this.clouds, undefined, new Set([mat]));   // 16 clouds × 5 puffs → one draw call (colour still follows the clock)
  }

  private makeStars() {
    const rng = new Rng(31);
    const pos: number[] = [];
    for (let i = 0; i < 900; i++) {
      const u = rng.range(0.04, 1), a = rng.range(0, Math.PI * 2), r = Math.sqrt(1 - u * u);
      pos.push(Math.cos(a) * r * 450, u * 450, Math.sin(a) * r * 450);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xfff8e0, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.stars.renderOrder = -9; this.stars.frustumCulled = false;
    this.scene.add(this.stars);
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(14, 24, 16), new THREE.MeshBasicMaterial({ color: 0xfff6d8, fog: false, transparent: true }));
    const crater = new THREE.MeshBasicMaterial({ color: 0xe8dcb4, fog: false, transparent: true });
    for (const [x, y, r] of [[-4, 3, 3.5], [5, -2, 2.6], [1, -6, 2]]) { const c = new THREE.Mesh(new THREE.CircleGeometry(r, 16), crater); c.position.set(x, y, 13.6); this.moon.add(c); }
    this.moon.renderOrder = -9;
    this.scene.add(this.moon);
  }

  /** Live graphics switch (no reload). Shadow on/off or softness changes recompile the materials once. */
  apply(o: GfxOpts) {
    const prev = this.opts;
    this.opts = { ...o };
    if (o.res !== prev.res || o.dpr !== prev.dpr || !o.dynRes) { this.dyn = 1; this.slowFor = 0; }
    const S = SHADOW_SIZE[o.shadows] || 1024;
    if (S !== this.sun.shadow.mapSize.x) {
      this.sun.shadow.mapSize.set(S, S);
      this.sun.shadow.map?.dispose(); (this.sun.shadow as any).map = null;
    }
    const type = o.shadows >= 3 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (this.sun.castShadow !== o.shadows > 0 || this.renderer.shadowMap.type !== type) {
      this.sun.castShadow = o.shadows > 0;
      this.renderer.shadowMap.type = type;
      this.scene.traverse((m) => { const mat = (m as THREE.Mesh).material; if (mat) for (const x of Array.isArray(mat) ? mat : [mat]) x.needsUpdate = true; });
    }
    if (o.outline !== prev.outline || o.bloom !== prev.bloom || o.aa !== prev.aa || o.res !== prev.res || o.dpr !== prev.dpr) this.buildPost();
    this.resize();
  }

  /**
   * Dynamic resolution: below ~50 fps for a second → render 10 % fewer pixels (down to 55 %); steady at the
   * target for a few seconds → step back up. A step up that makes it slow again blocks raising for a while.
   */
  updateDynRes(dt: number) {
    this.clock += dt;
    if (!this.opts.dynRes || document.hidden || dt > 0.25) return;
    this.dynFrames++; this.dynTime += dt; this.dynT += dt;
    if (this.dynT < 1) return;
    const fps = this.dynFrames / this.dynTime;
    this.dynFrames = 0; this.dynTime = 0; this.dynT = 0;
    const target = this.opts.fpsCap === 30 ? 30 : 60;
    const old = this.dyn;
    if (fps < target * 0.83) {
      if (this.dynRaisedAt >= 0 && this.clock - this.dynRaisedAt < 3) this.dynBlockUntil = this.clock + 30;
      this.dyn = Math.max(0.55, this.dyn - 0.1);
      this.slowFor = this.dyn <= 0.55 && fps < target * 0.6 ? this.slowFor + 1 : 0;
    } else {
      this.slowFor = 0;
      if (fps > target * 0.95 && this.dyn < 1 && this.clock > this.dynBlockUntil) {
        this.dynT = -3;                       // wait a few seconds at each step before raising again
        this.dyn = Math.min(1, this.dyn + 0.05); this.dynRaisedAt = this.clock;
      }
    }
    if (this.dyn !== old) this.resize();
  }

  resize() {
    this.renderer.setPixelRatio(this.pixelRatio());
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
  }

  /** Keep the shadow map centred on the action, snapped to texels (no shimmering). */
  focusShadows(p: THREE.Vector3) {
    const texel = 80 / this.sun.shadow.mapSize.x;
    const f = p.clone();
    const lightRot = new THREE.Matrix4().lookAt(new THREE.Vector3(), this.sunDir.clone().negate(), new THREE.Vector3(0, 1, 0));
    f.applyMatrix4(lightRot.clone().invert());
    f.x = Math.round(f.x / texel) * texel; f.y = Math.round(f.y / texel) * texel;
    f.applyMatrix4(lightRot);
    this.sun.target.position.copy(f);
    this.sun.position.copy(f).addScaledVector(this.sunDir, 110);
  }

  render(dt: number) {
    this.clouds.rotation.y += dt * 0.004;
    this.composer.render(dt);
  }
}
