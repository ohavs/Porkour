import type { Outfit } from '../pig/cosmetics';

/** Player settings, saved in localStorage. */
export const SETTINGS = {
  quality: 'high' as 'high' | 'low',
  sfx: 1, music: 0.6, ambience: 0.8,
  sens: 1, invertY: false, muted: false, fps: false,
  outfit: null as Outfit | null,
};
const KEY = 'porkour.settings';

export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    Object.assign(SETTINGS, s);
  } catch { /* private mode / bad json */ }
  const q = new URLSearchParams(location.search).get('q');
  if (q === 'low' || q === 'high') SETTINGS.quality = q;
  return SETTINGS;
}
export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(SETTINGS)); } catch { /* ignore */ }
}
