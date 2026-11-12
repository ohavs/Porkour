import * as THREE from 'three';
import { Rng } from '../core/util';
import type { Terrain } from '../world/terrain';
import { RAMP } from './toon';

/**
 * Instanced grass blades in 16 m chunks (distance-culled), wind in the vertex shader,
 * bent away from pigs (up to 8 "pushers"). Normals point up so blades light like the ground.
 */
export class Grass {
  private chunks: THREE.InstancedMesh[] = [];
  private uniforms = {
    uTime: { value: 0 },
    uPushers: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, -999, 0, 0)) },
  };
  range = 48;

  constructor(scene: THREE.Scene, terrain: Terrain, density: number) {
    const geo = this.blade();
    const mat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: RAMP, side: THREE.DoubleSide, depthWrite: false });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; uniform vec4 uPushers[8]; varying float vH;`)
        .replace('#include <begin_vertex>', `
          vec3 transformed = vec3(position);
          vH = position.y;
          vec4 wp = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float h2 = position.y * position.y;
          float w = sin(uTime * 1.7 + wp.x * 0.35 + wp.z * 0.21) * 0.5 + sin(uTime * 3.1 + wp.x * 1.3) * 0.18;
          vec3 bend = vec3(w * 0.22, 0.0, w * 0.12) * h2;
          for (int i = 0; i < 8; i++) {
            vec3 d = wp.xyz - uPushers[i].xyz;
            float dist = length(d.xz);
            float f = (1.0 - smoothstep(0.0, uPushers[i].w, dist)) * step(abs(d.y), 1.5);
            bend.xz += normalize(d.xz + 0.0001) * f * 0.9 * position.y;
            bend.y -= f * 0.5 * position.y;
          }
          mat3 gIm = mat3(instanceMatrix);
          transformed += inverse(gIm) * bend;`)
      ;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vH;')
        .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb *= mix(0.86, 1.22, smoothstep(0.0, 1.0, vH));`);
    };

    const C = 16, f = terrain.farm;
    const rng = new Rng(1234);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    const base = new THREE.Color(0x6db33f), dry = new THREE.Color(0xa6c449), deep = new THREE.Color(0x4e9a38);
    for (let cx = f.x0 - 8; cx < f.x1 + 8; cx += C) {
      for (let cz = f.z0 - 8; cz < f.z1 + 8; cz += C) {
        const pts: number[] = [];
        const n = Math.floor(C * C * density);
        for (let i = 0; i < n; i++) {
          const x = cx + rng.next() * C, z = cz + rng.next() * C;
          if (terrain.isBare(x, z)) continue;
          pts.push(x, z);
        }
        if (!pts.length) continue;
        const mesh = new THREE.InstancedMesh(geo, mat, pts.length / 2);
        for (let i = 0; i < pts.length / 2; i++) {
          const x = pts[i * 2], z = pts[i * 2 + 1];
          p.set(x, terrain.height(x, z) - 0.03, z);
          q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rng.next() * Math.PI * 2);
          const h = 0.14 + rng.next() * 0.24;
          s.set(1.2 + rng.next() * 0.8, h, 1);
          mesh.setMatrixAt(i, m4.compose(p, q, s));
          const t = rng.next();
          col.copy(base).lerp(t < 0.5 ? deep : dry, Math.abs(t - 0.5) * 1.3);
          mesh.setColorAt(i, col);
        }
        mesh.computeBoundingSphere();
        mesh.receiveShadow = true; mesh.castShadow = false;
        mesh.frustumCulled = true;
        mesh.renderOrder = 5; // after opaque objects (no depth write → no ink lines on grass)
        scene.add(mesh); this.chunks.push(mesh);
      }
    }
  }

  /** One blade: 3 segments, tapering, 1 unit tall (scaled per instance). */
  private blade() {
    const segs = 3, w = 0.045;
    const pos: number[] = [], idx: number[] = [], nor: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, ww = w * (1 - t * 0.85);
      const curve = t * t * 0.08;
      if (i < segs) { pos.push(-ww, t, curve, ww, t, curve); nor.push(0, 1, 0, 0, 1, 0); }
      else { pos.push(0, t, curve); nor.push(0, 1, 0); }
    }
    for (let i = 0; i < segs - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const a = (segs - 1) * 2; idx.push(a, a + 1, a + 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    return g;
  }

  update(t: number, cam: THREE.Vector3, pushers: THREE.Vector3[]) {
    this.uniforms.uTime.value = t;
    const pu = this.uniforms.uPushers.value;
    for (let i = 0; i < 8; i++) {
      const p = pushers[i];
      if (p) pu[i].set(p.x, p.y, p.z, 0.75); else pu[i].set(0, -999, 0, 0);
    }
    const r2 = (this.range + 12) ** 2;
    for (const c of this.chunks) {
      const s = c.boundingSphere!;
      c.visible = s.center.distanceToSquared(cam) < r2;
    }
  }
}
