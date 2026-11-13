/**
 * Graphics options: presets (low → ultra), "auto" picks one from the GPU, and every option can be changed on its
 * own (→ "custom"). Applied live by Gfx (resolution, shadows, post effects), Grass, DayNight (lamp lights) and the
 * detail culler. The look only drops where it is cheapest to notice; dynamic resolution keeps the frame rate up.
 */
export type Preset = 'low' | 'medium' | 'high' | 'ultra';
export type PresetChoice = 'auto' | Preset | 'custom';

export interface GfxOpts {
  /** Render resolution, 0.5..1 of the screen (× the preset's pixel-ratio cap on high-DPI screens). */
  res: number;
  /** Lower the resolution on its own while the frame rate drops, raise it back when there's room. */
  dynRes: boolean;
  /** 0 off · 1 low · 2 medium · 3 high · 4 ultra (shadow map size + softness). */
  shadows: 0 | 1 | 2 | 3 | 4;
  /** 0 off · 1 low · 2 medium · 3 high (blade density + distance). */
  grass: 0 | 1 | 2 | 3;
  /** Lamp lights at night: 0 → 2 nearest · 1 → 4 · 2 → 6 · 3 → all. */
  lamps: 0 | 1 | 2 | 3;
  /** Small things (flowers, rocks, crops) drawn up to: 0 near · 1 medium · 2 far · 3 everything. */
  detail: 0 | 1 | 2 | 3;
  outline: boolean;
  bloom: boolean;
  /** Anti-aliasing: 0 off · 1 FXAA (cheap) · 2 SMAA (sharper). */
  aa: 0 | 1 | 2;
  /** Max pixel ratio on high-DPI screens (laptops / phones / 4K). */
  dpr: number;
  /** Frame-rate limit (0 = the screen's refresh rate). */
  fpsCap: 0 | 30 | 60;
}

export const PRESETS: Record<Preset, GfxOpts> = {
  low: { res: 0.8, dynRes: true, shadows: 1, grass: 1, lamps: 0, detail: 0, outline: true, bloom: false, aa: 1, dpr: 1, fpsCap: 0 },
  medium: { res: 1, dynRes: true, shadows: 2, grass: 2, lamps: 1, detail: 1, outline: true, bloom: true, aa: 1, dpr: 1, fpsCap: 0 },
  high: { res: 1, dynRes: true, shadows: 3, grass: 3, lamps: 2, detail: 2, outline: true, bloom: true, aa: 2, dpr: 1.5, fpsCap: 0 },
  ultra: { res: 1, dynRes: false, shadows: 4, grass: 3, lamps: 3, detail: 3, outline: true, bloom: true, aa: 2, dpr: 2, fpsCap: 0 },
};
export const PRESET_ORDER: Preset[] = ['low', 'medium', 'high', 'ultra'];

export const SHADOW_SIZE = [0, 1024, 2048, 3072, 4096];
export const GRASS_LEVEL = [{ density: 0, range: 0 }, { density: 0.35, range: 30 }, { density: 0.65, range: 40 }, { density: 1, range: 52 }];
export const LAMP_LIGHTS = [2, 4, 6, 99];
export const DETAIL_DIST = [45, 75, 120, Infinity];

let detected: { preset: Preset; gpu: string } | null = null;
/** Pick a preset from the graphics card (no benchmark: dynamic resolution covers the rest). */
export function detectPreset(): { preset: Preset; gpu: string } {
  if (detected) return detected;
  let gpu = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    gpu = (ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '') || '';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* no info */ }
  const g = gpu.toLowerCase();
  const mobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 820);
  let preset: Preset = 'high';
  if (/swiftshader|llvmpipe|software|basic render/.test(g)) preset = 'low';
  else if (mobile || /mali|adreno|powervr|videocore/.test(g)) preset = 'low';
  else if (/intel|uhd|iris|hd graphics/.test(g)) preset = 'medium';
  else if (/rtx|rx 6[7-9]|rx 7[7-9]|radeon pro|apple m[2-9]/.test(g)) preset = 'ultra';
  detected = { preset, gpu };
  return detected;
}

/** The preset in use for a choice ("auto" → detected, "custom" → none). */
export const presetOf = (c: PresetChoice): Preset | null => (c === 'auto' ? detectPreset().preset : c === 'custom' ? null : c);
