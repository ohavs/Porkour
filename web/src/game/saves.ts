import { SETTINGS, saveSettings } from './settings';

/**
 * Story saves (user: "when the host opens a private room and they get through stages, keep the progress at the host
 * for next time — not everyone has to be there; Load or New game; about 5 saves"). Kept in the host's browser
 * (settings); solo games use them too. The active save decides which story stages are open; a won stage goes into it
 * with the names of who played.
 */
export interface Save {
  /** Highest story stage won (0 = none: stage 1 is open). */
  stage: number;
  /** Best stars per stage (index = stage − 1). */
  stars: number[];
  /** Who played it last (names, up to 4). */
  names: string[];
  /** Last played (ms since 1970). */
  at: number;
}
export const SLOTS = 5;

function list(): (Save | null)[] {
  const s = SETTINGS;
  if (!Array.isArray(s.saves) || s.saves.length !== SLOTS) {
    const old = Array.isArray(s.saves) ? s.saves : [];
    s.saves = Array.from({ length: SLOTS }, (_, i) => old[i] ?? null);
    // before the saves: one progress number → save 1
    if (!s.saves.some(Boolean) && s.story > 0) { s.saves[0] = { stage: s.story, stars: [], names: [], at: Date.now() }; s.slot = 0; s.story = 0; }
  }
  return s.saves;
}
export const saves = () => list();
/** The save in use (-1 = none yet: a new game starts in the first free slot when a stage is won). */
export function slot(): number { list(); const s = SETTINGS.slot ?? -1; return s >= 0 && s < SLOTS && list()[s] ? s : -1; }
export function current(): Save | null { const i = slot(); return i >= 0 ? list()[i] : null; }
/** Story progress of the active save: the highest stage won. */
export function storyWon(): number { return current()?.stage ?? 0; }

/** New game in slot i (overwrites it). */
export function newGame(i: number) {
  list()[i] = { stage: 0, stars: [], names: [], at: Date.now() };
  SETTINGS.slot = i;
  saveSettings();
}
/** Continue save i. */
export function loadGame(i: number) { if (!list()[i]) return; SETTINGS.slot = i; saveSettings(); }
export function deleteSave(i: number) {
  list()[i] = null;
  if (SETTINGS.slot === i) SETTINGS.slot = -1;
  saveSettings();
}
/** A story stage was played to the end: progress + stars + who played go into the active save (a new one if none). */
export function recordStage(stage: number, won: boolean, stars: number, names: string[]) {
  let i = slot();
  if (i < 0) { if (!won) return; i = list().findIndex((s) => !s); if (i < 0) i = 0; newGame(i); }
  const s = list()[i]!;
  if (won && stage > s.stage) s.stage = stage;
  if (won) s.stars[stage - 1] = Math.max(s.stars[stage - 1] ?? 0, stars);
  if (names.length) s.names = names.slice(0, 4);
  s.at = Date.now();
  saveSettings();
}
/** Short label for the room / farm card: "💾 2 · ★★☆☆☆". */
export function saveLabel(): string {
  const i = slot(), s = current();
  if (i < 0 || !s) return '';
  return `💾 ${i + 1} · ${Array.from({ length: 5 }, (_, k) => (k < s.stage ? '★' : '☆')).join('')}`;
}
