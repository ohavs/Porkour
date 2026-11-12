import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

/** 3-band cel shading ramp shared by every toon material. */
export const RAMP = (() => {
  const d = new Uint8Array([120, 120, 120, 255, 196, 196, 196, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
})();

export const toonMat = (color: THREE.ColorRepresentation, extra: THREE.MeshToonMaterialParameters = {}) =>
  new THREE.MeshToonMaterial({ color, gradientMap: RAMP, ...extra });

const cache = new Map<string, THREE.Material>();
/** Swap PBR materials for cel-shaded ones (keeps colour, texture, vertex colours, alpha). */
export function toonify(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const conv = (src: THREE.Material) => {
      if ((src as THREE.MeshToonMaterial).isMeshToonMaterial) return src;
      let t = cache.get(src.uuid);
      if (!t) {
        const s = src as THREE.MeshStandardMaterial;
        const col = s.color ? s.color.clone() : new THREE.Color(1, 1, 1);
        if (!s.map) col.offsetHSL(0, 0.08, 0.02);      // flat-coloured models: a bit more cartoon saturation
        t = new THREE.MeshToonMaterial({
          name: s.name, color: col, map: s.map ?? null, gradientMap: RAMP, vertexColors: s.vertexColors,
          transparent: s.transparent, opacity: s.opacity, alphaTest: s.alphaTest || (s.map && s.transparent ? 0.4 : 0),
          side: s.side, emissive: s.emissive ?? new THREE.Color(0), emissiveMap: s.emissiveMap ?? null,
        });
        if (t instanceof THREE.MeshToonMaterial && s.transparent && s.map) { t.transparent = false; t.alphaTest = 0.45; }
        cache.set(src.uuid, t);
      }
      return t;
    };
    m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material);
  });
  return obj;
}

const FRAG = `
uniform vec3 uColor; uniform float uThick;
float vz(const in vec2 uv) { return -getViewZ(readDepth(uv)); }
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  float z = -getViewZ(depth);
  vec2 o = texelSize * uThick;
  float z1 = vz(uv + vec2(o.x, 0.0)), z2 = vz(uv - vec2(o.x, 0.0));
  float z3 = vz(uv + vec2(0.0, o.y)), z4 = vz(uv - vec2(0.0, o.y));
  float lap = (z1 + z2 + z3 + z4 - 4.0 * z) / max(z, 0.5);
  float edge = smoothstep(0.025, 0.09, lap);
  edge *= 1.0 - smoothstep(70.0, 160.0, z);
  outputColor = vec4(mix(inputColor.rgb, uColor, edge * 0.95), inputColor.a);
}`;

/** Ink outlines from depth discontinuities (silhouettes + strong creases). Grass / particles don't write depth → no lines. */
export class InkOutline extends Effect {
  constructor(thickness = 1.3, color = 0x2b170c) {
    super('InkOutline', FRAG, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([['uColor', new THREE.Uniform(new THREE.Color(color))], ['uThick', new THREE.Uniform(thickness)]]),
    });
  }
}
