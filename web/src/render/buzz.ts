import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

/**
 * Chain modes: what being high / drunk does to the screen (only for your own pig). High = colours slowly shift and
 * glow, the picture breathes and the edges smear into rainbow fringes; drunk = double vision that drifts in and out,
 * a warm haze. Its own pass (it reads neighbouring pixels); at 0 / 0 it's a plain copy.
 */
const FRAG = /* glsl */ `
uniform float uHigh;
uniform float uDrunk;
uniform float uTime;
vec3 hueShift(vec3 c, float a) { const vec3 k = vec3(0.57735); float ca = cos(a); return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca); }
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 q = uv;
  float w = uHigh * 0.005 + uDrunk * 0.003;
  q += vec2(sin(uv.y * 9.0 + uTime * 1.7), cos(uv.x * 7.0 + uTime * 1.3)) * w * smoothstep(0.1, 0.7, distance(uv, vec2(0.5)) + 0.2);
  vec3 c = texture2D(inputBuffer, q).rgb;
  if (uDrunk > 0.0) {
    vec2 o = vec2(sin(uTime * 0.9), cos(uTime * 0.7)) * 0.014 * uDrunk * (0.6 + 0.4 * sin(uTime * 0.4));
    c = mix(c, texture2D(inputBuffer, q + o).rgb, 0.45 * min(1.0, uDrunk * 1.5));
    c *= vec3(1.0 + 0.07 * uDrunk, 1.0 + 0.02 * uDrunk, 1.0 - 0.09 * uDrunk);
  }
  if (uHigh > 0.0) {
    vec2 d = (uv - 0.5) * 0.012 * uHigh;
    c.r = mix(c.r, texture2D(inputBuffer, q + d).r, 0.7 * uHigh);
    c.b = mix(c.b, texture2D(inputBuffer, q - d).b, 0.7 * uHigh);
    c = mix(c, hueShift(c, sin(uTime * 0.3) * 0.9 + distance(uv, vec2(0.5)) * 1.6), 0.45 * uHigh);
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(l), c, 1.0 + 0.5 * uHigh);
  }
  outputColor = vec4(c, inputColor.a);
}`;

export class BuzzEffect extends Effect {
  constructor() {
    super('BuzzEffect', FRAG, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([['uHigh', new THREE.Uniform(0)], ['uDrunk', new THREE.Uniform(0)], ['uTime', new THREE.Uniform(0)]]),
    });
  }
  set(high: number, drunk: number, time: number) {
    this.uniforms.get('uHigh')!.value = high; this.uniforms.get('uDrunk')!.value = drunk; this.uniforms.get('uTime')!.value = time;
  }
}
