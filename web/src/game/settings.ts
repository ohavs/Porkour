import type { Outfit } from '../pig/cosmetics';
import type { Save } from './saves';
import { PRESETS, presetOf, type GfxOpts, type PresetChoice } from '../render/quality';

/** Player settings, saved in localStorage. */
export const SETTINGS = {
  /** Graphics preset ("auto" = picked from the graphics card) and the options in use (edited → "custom"). */
  preset: 'auto' as PresetChoice,
  gfx: { ...PRESETS.high } as GfxOpts,
  sfx: 1, music: 0.6, ambience: 0.8,
  sens: 1, invertY: false, muted: false, fps: false,
  outfit: null as Outfit | null,
  /** Coins + XP from finished rounds; what the shop sold me (game/shop.ts): items 'slot:id', gadget counts, the one I take along. */
  coins: 0, xp: 0,
  owned: [] as string[], gadgets: {} as Record<string, number>, loadout: '', shopInit: false,
  /** Farm to play: 'farm1' | 'farm2' | 'random' (world/farms.ts). */
  farm: 'random',
  /** Story mode (before the saves: the highest stage won; moved into save 1). */
  story: 0,
  /** Story saves (game/saves.ts): 5 slots, the one in use. */
  saves: [] as (Save | null)[], slot: -1,
  /** Online server override (empty = the built-in one). */
  server: '',
};
const KEY = 'porkour.settings';

export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (s.quality && !s.preset) s.preset = s.quality === 'low' ? 'low' : 'auto';   // old 2-level setting
    delete s.quality;
    Object.assign(SETTINGS, s);
    SETTINGS.gfx = { ...PRESETS.high, ...(s.gfx ?? {}) };
  } catch { /* private mode / bad json */ }
  const q = new URLSearchParams(location.search).get('q');
  if (q === 'low' || q === 'medium' || q === 'high' || q === 'ultra') SETTINGS.preset = q;
  setPreset(SETTINGS.preset);
  return SETTINGS;
}
/** Choose a preset (its options replace the current ones; "custom" keeps them). */
export function setPreset(c: PresetChoice) {
  SETTINGS.preset = c;
  const p = presetOf(c);
  if (p) SETTINGS.gfx = { ...PRESETS[p] };
}
export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(SETTINGS)); } catch { /* ignore */ }
}
