import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, SMAAEffect, BloomEffect, ToneMappingEffect, ToneMappingMode,
  VignetteEffect, HueSaturationEffect,
} from 'postprocessing';
import { InkOutline, toonMat } from './toon';
import { Rng } from '../core/util';

export type Quality = 'high' | 'low';

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
  quality: Quality;
  clouds = new THREE.Group();
  skyMat!: THREE.ShaderMaterial;
  hemi!: THREE.HemisphereLight;
  stars!: THREE.Points;
  moon!: THREE.Mesh;
  cloudMat!: THREE.MeshToonMaterial;
  outline!: InkOutline;

  constructor(container: HTMLElement, quality: Quality) {
    this.quality = quality;
    const r = new THREE.WebGLRenderer({ powerPreference: 'high-performance', antialias: false, stencil: false, depth: true });
    r.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 1.5 : 1));
    r.setSize(innerWidth, innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
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
    this.sun.castShadow = true;
    const S = quality === 'high' ? 3072 : 1536;
    this.sun.shadow.mapSize.set(S, S);
    const c = this.sun.shadow.camera; c.left = -40; c.right = 40; c.top = 40; c.bottom = -40; c.near = 1; c.far = 220;
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xd8efff, 0x7aa64a, 1.15);
    this.scene.add(this.hemi);
    this.makeStars();

    this.composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.outline = new InkOutline(quality === 'high' ? 1.4 : 1.1);
    this.composer.addPass(new EffectPass(this.camera, this.outline));
    this.composer.addPass(new EffectPass(this.camera,
      new BloomEffect({ intensity: 0.35, luminanceThreshold: 0.9, luminanceSmoothing: 0.15, mipmapBlur: true }),
      new HueSaturationEffect({ saturation: 0.12 }),
      new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL }),
      new VignetteEffect({ darkness: 0.3, offset: 0.35 }),
    ));
    this.composer.addPass(new EffectPass(this.camera, new SMAAEffect()));
    addEventListener('resize', () => this.resize());
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

  /** Live quality switch (no reload). */
  setQuality(q: Quality) {
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q === 'high' ? 1.5 : 1));
    const S = q === 'high' ? 3072 : 1536;
    this.sun.shadow.mapSize.set(S, S);
    this.sun.shadow.map?.dispose(); (this.sun.shadow as any).map = null;
    (this.outline.uniforms.get('uThick') as THREE.Uniform).value = q === 'high' ? 1.4 : 1.1;
    this.resize();
  }

  resize() {
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
