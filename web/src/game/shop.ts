import { ITEMS, SKINS, SLOTS, defaultOutfit, type Outfit, type Slot } from '../pig/cosmetics';
import { SETTINGS, saveSettings } from './settings';

/**
 * Shop (coins + XP from rounds, saved in SETTINGS): wardrobe items cost coins (a few are free from the start), the
 * fancy ones also need a player level (level comes from XP = every coin ever earned). Gadgets are bought one at a
 * time; one of them (the "loadout") is taken into each round and used up when the round starts:
 *   cherry bomb / stink bomb / bone = a prop waiting next to your pig (world/gadgets.ts),
 *   lucky horseshoe = +25 % coins at the end, skeleton key = easier lock-picks.
 */
export const itemKey = (slot: Slot, id: string) => `${slot}:${id}`;

/** [price, level] per wardrobe item; missing = free. */
const P: Record<string, [number, number?]> = {
  // skins
  'skin:brown': [150], 'skin:black': [150], 'skin:spotted': [250], 'skin:mint': [300], 'skin:lilac': [300],
  'skin:boar': [450, 3], 'skin:gold': [1500, 8],
  // hats
  'hat:beanie': [100], 'hat:flowers': [150], 'hat:cowboy': [250], 'hat:chef': [250], 'hat:top': [300], 'hat:sombrero': [350],
  'hat:propeller': [400, 2], 'hat:hood': [500, 2], 'hat:wizard': [600, 3], 'hat:pumpkin': [600, 4], 'hat:viking': [700, 4],
  'hat:knight': [800, 5], 'hat:skull': [900, 6], 'hat:darkWizard': [900, 6], 'hat:crown': [2000, 10],
  // hair
  'hair:curls': [120], 'hair:bunches': [120], 'hair:mohawk': [200], 'hair:afro': [250, 2],
  // beards
  'face:handlebar': [150], 'face:walrus': [150], 'face:beard': [200], 'face:chops': [200, 2],
  // glasses
  'eyes:shades': [150], 'eyes:hearts': [250], 'eyes:stars': [250], 'eyes:monocle': [300, 2], 'eyes:goggles': [400, 3],
  // neck
  'neck:scarf': [100], 'neck:bandana': [100], 'neck:bell': [150], 'neck:pearls': [400, 4], 'neck:chain': [500, 5],
  // back
  'back:capeRogue': [500, 2], 'back:capeKnight': [600, 3], 'back:capeMage': [600, 3], 'back:capeBarbarian': [700, 4], 'back:wings': [1200, 7],
};
/** Free from the start (everything not in P is free too). */
export function priceOf(slot: Slot, id: string) { return id ? P[itemKey(slot, id)]?.[0] ?? 0 : 0; }
export function levelFor(slot: Slot, id: string) { return id ? P[itemKey(slot, id)]?.[1] ?? 1 : 1; }

// ---------------------------------------------------------------- levels
/** XP needed to reach level n: 300 · n(n−1)/2 (L2 300, L3 900, L4 1800, L5 3000 … L10 13 500). */
export const xpForLevel = (n: number) => 150 * n * (n - 1);
export function level(xp = SETTINGS.xp) { let n = 1; while (xp >= xpForLevel(n + 1)) n++; return n; }
/** 0..1 progress to the next level. */
export function levelProgress(xp = SETTINGS.xp) { const n = level(xp), a = xpForLevel(n), b = xpForLevel(n + 1); return (xp - a) / (b - a); }

// ---------------------------------------------------------------- owned items
const owned = () => new Set(SETTINGS.owned);
export function isOwned(slot: Slot, id: string) { return !id || priceOf(slot, id) === 0 || owned().has(itemKey(slot, id)); }
export type BuyResult = 'ok' | 'coins' | 'level' | 'owned';
export function canBuy(slot: Slot, id: string): BuyResult {
  if (isOwned(slot, id)) return 'owned';
  if (level() < levelFor(slot, id)) return 'level';
  if (SETTINGS.coins < priceOf(slot, id)) return 'coins';
  return 'ok';
}
export function buyItem(slot: Slot, id: string): BuyResult {
  const r = canBuy(slot, id);
  if (r !== 'ok') return r;
  SETTINGS.coins -= priceOf(slot, id);
  SETTINGS.owned = [...SETTINGS.owned, itemKey(slot, id)];
  saveSettings();
  return 'ok';
}
/** The same outfit with every item the player doesn't own swapped back (saved outfits, random picks). */
export function ownedOnly(o: Outfit): Outfit {
  const out = { ...o };
  if (!isOwned('skin', out.skin)) out.skin = defaultOutfit().skin;
  for (const s of SLOTS) if (s !== 'skin' && !isOwned(s, out[s])) out[s] = '';
  return out;
}
/** Every item the player owns in a slot (random outfits). */
export function ownedIds(slot: Slot) {
  const ids = slot === 'skin' ? Object.keys(SKINS) : ITEMS[slot].map((i) => i.id);
  return ids.filter((id) => isOwned(slot, id));
}

// ---------------------------------------------------------------- gadgets
export type GadgetId = 'cherryBomb' | 'stinkBomb' | 'bone' | 'horseshoe' | 'key';
export interface GadgetDef { id: GadgetId; price: number; lvl: number; model: string; prop: boolean }
export const GADGETS: GadgetDef[] = [
  { id: 'bone', price: 30, lvl: 1, model: 'kaykit/bone_A', prop: true },
  { id: 'cherryBomb', price: 60, lvl: 1, model: 'loot/Bomb', prop: true },
  { id: 'stinkBomb', price: 80, lvl: 2, model: 'kaykit/smokebomb', prop: true },
  { id: 'horseshoe', price: 100, lvl: 3, model: '', prop: false },
  { id: 'key', price: 120, lvl: 4, model: 'loot/Key2', prop: false },
];
export const GADGET_IDS = GADGETS.map((g) => g.id);
export const gadget = (id: string) => GADGETS.find((g) => g.id === id);
export const HORSESHOE_BONUS = 1.25;

export function gadgetCount(id: string) { return SETTINGS.gadgets[id] ?? 0; }
export function canBuyGadget(id: GadgetId): BuyResult {
  const g = gadget(id)!;
  if (level() < g.lvl) return 'level';
  if (SETTINGS.coins < g.price) return 'coins';
  return 'ok';
}
export function buyGadget(id: GadgetId): BuyResult {
  const r = canBuyGadget(id);
  if (r !== 'ok') return r;
  SETTINGS.coins -= gadget(id)!.price;
  SETTINGS.gadgets = { ...SETTINGS.gadgets, [id]: gadgetCount(id) + 1 };
  if (!SETTINGS.loadout) SETTINGS.loadout = id;
  saveSettings();
  return 'ok';
}
/** The gadget I take into the next round ('' = none / none left). */
export function loadout(): GadgetId | '' {
  const id = SETTINGS.loadout;
  return id && gadget(id) && gadgetCount(id) > 0 ? id as GadgetId : '';
}
export function setLoadout(id: GadgetId | '') { SETTINGS.loadout = id; saveSettings(); }
/** A round started with this gadget of mine: one fewer (the loadout stays picked while some are left). */
export function consumeGadget(id: GadgetId) {
  SETTINGS.gadgets = { ...SETTINGS.gadgets, [id]: Math.max(0, gadgetCount(id) - 1) };
  saveSettings();
}
/** What the host reads from my outfit message: the outfit + the gadget I bring ('g'). */
export function outfitMsg(o: Outfit) { return JSON.stringify({ ...o, g: loadout() }); }
export function gadgetOfMsg(json: string): GadgetId | '' {
  try { const g = JSON.parse(json)?.g; return typeof g === 'string' && gadget(g) ? g as GadgetId : ''; } catch { return ''; }
}

/** First run with the shop: the outfit the player already wears stays theirs (it was free before). */
export function initShop() {
  if (!Array.isArray(SETTINGS.owned)) SETTINGS.owned = [];
  if (!SETTINGS.gadgets || typeof SETTINGS.gadgets !== 'object') SETTINGS.gadgets = {};
  if (!SETTINGS.shopInit) {
    SETTINGS.shopInit = true;
    const o = SETTINGS.outfit;
    if (o) for (const s of SLOTS) if (o[s] && priceOf(s, o[s]) > 0) SETTINGS.owned.push(itemKey(s, o[s]));
    saveSettings();
  }
  if (SETTINGS.outfit) SETTINGS.outfit = ownedOnly(SETTINGS.outfit);
}
