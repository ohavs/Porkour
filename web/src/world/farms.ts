import type * as THREE from 'three';
import { SETTINGS } from '../game/settings';
import { buildFarm1 } from './farm1';
import { buildFarm2 } from './farm2';
import { buildFarm3 } from './farm3';
import { buildFarm4 } from './farm4';
import type { FarmDef } from './farmKit';

/**
 * The levels (GDD "Farms"). A farm is built once when the page loads; switching farms reloads the page with
 * `?farm=<id>` (online: the room says which farm, a player whose page built another one reloads into the room).
 */
export type FarmId = 'farm1' | 'farm2' | 'farm3' | 'farm4';
export const FARM_IDS: FarmId[] = ['farm1', 'farm2', 'farm3', 'farm4'];
export const FARM_BUILDERS: Record<FarmId, (scene: THREE.Scene) => FarmDef> = { farm1: buildFarm1, farm2: buildFarm2, farm3: buildFarm3, farm4: buildFarm4 };

const isFarm = (x: unknown): x is FarmId => FARM_IDS.includes(x as FarmId);
let current: FarmId | null = null;

/** The farm this page plays: `?farm=` (an online room / a switch) → my setting ('random' = a new one each load). */
export function farmId(): FarmId {
  if (current) return current;
  const q = new URLSearchParams(location.search).get('farm');
  const want = isFarm(q) ? q : SETTINGS.farm;
  current = isFarm(want) ? want : FARM_IDS[Math.floor(Math.random() * FARM_IDS.length)];
  return current;
}
export function asFarm(x: unknown): FarmId | null { return isFarm(x) ? x : x === undefined || x === '' ? null : 'farm1'; }

/** Reload the page on another farm (keeps an invite / lobby in the URL). */
export function reloadOnFarm(id: FarmId, extra: Record<string, string> = {}) {
  const q = new URLSearchParams(location.search);
  q.set('farm', id);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  q.delete('auto');
  location.href = location.pathname + '?' + q.toString();
}
