import { G } from './ctx';

/**
 * Round modifiers (Dead by Daylight offerings / Goose Game days): one per round, rolled at the start, shown on the
 * mission panel. They change how Bob notices things and the farm's mood, not the rules.
 *   rain   — grey sky, rain + thunder, Bob sees ×0.75 and hears ×0.7, the whole farm is mud (wallow anywhere).
 *   fog    — thick fog all day: Bob sees ×0.6 (so do you).
 *   grumpy — Bob got up on the wrong side of the bed: never below alert 1, heats up ×1.4, slaps more, never dances,
 *            a storm cloud over his head — but loot is worth ×1.25.
 *   market — market day: Bob drives off 9:00–13:00 (the dog guards the farm meanwhile), quota +150.
 */
export type ModId = typeof G.mod;
export const MOD_IDS: ModId[] = ['none', 'rain', 'fog', 'grumpy', 'market'];
export const MOD = {
  weight: { none: 3, rain: 2, fog: 1.5, grumpy: 2, market: 2 } as Record<ModId, number>,
  rain: { sight: 0.75, hear: 0.7, mud: 0.6, thunder: [14, 34] },
  fog: { sight: 0.6 },
  grumpy: { floor: 1, heat: 1.4, slap: 0.55, loot: 1.25 },
  market: { leave: 9, back: 13, quota: 150 },
};

/** How far Bob sees / hears under this round's weather (×). */
export const modSight = () => (G.mod === 'rain' ? MOD.rain.sight : G.mod === 'fog' ? MOD.fog.sight : 1);
export const modHear = () => (G.mod === 'rain' ? MOD.rain.hear : 1);
/** Is Bob at the market right now (market day, his away hours)? */
export const marketHours = () => G.mod === 'market' && G.hour >= MOD.market.leave && G.hour < MOD.market.back;

export function rollMod(): ModId {
  const total = MOD_IDS.reduce((a, m) => a + MOD.weight[m], 0);
  let r = Math.random() * total;
  for (const m of MOD_IDS) { r -= MOD.weight[m]; if (r < 0) return m; }
  return 'none';
}

/** Small line icons for the mission panel / results (currentColor). */
export const MOD_SVG: Record<ModId, string> = {
  none: '',
  rain: '<svg viewBox="0 0 24 24"><path d="M7 15a4 4 0 0 1 0-8 5.5 5.5 0 0 1 10.5 1.5A3.3 3.3 0 0 1 17 15z" fill="currentColor"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  fog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 8c3-2 6 2 9 0s6-2 9 0M3 13c3-2 6 2 9 0s6-2 9 0M3 18c3-2 6 2 9 0s6-2 9 0"/></svg>',
  grumpy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M7.5 8.5l3 1.5M16.5 8.5l-3 1.5M8.5 17c2-2 5-2 7 0"/></svg>',
  market: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2.5l2.2 10.5h10l2-7.5H7"/><circle cx="9" cy="19" r="1.6" fill="currentColor"/><circle cx="17" cy="19" r="1.6" fill="currentColor"/></svg>',
};
