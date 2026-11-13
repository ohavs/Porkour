import { G, type Carrier } from '../game/ctx';

/** Online: references between objects (who holds what) as small numbers, the same on every machine. */
/** Who carries / is carried, as a number (pig index, Bob, wolf id). */
export function carrierCode(c: Carrier | null | undefined): number {
  if (!c) return -1;
  if (c.kind === 'pig') return G.pigs.indexOf(c);
  if (c.kind === 'farmer') return 10;
  if (c.kind === 'wolf') return 1000 + ((c as any).netId ?? 0);
  if (c.kind === 'trap') return 20 + ((c as any).index ?? 0);
  return -1;
}
export function carrierFrom(code: number): any {
  if (code < 0) return null;
  if (code < 10) return G.pigs[code] ?? null;
  if (code === 10) return G.farmer;
  if (code >= 20 && code < 40) return G.traps?.list[code - 20] ?? null;
  return G.wolves.find((w: any) => w.netId === code - 1000) ?? null;
}
export const holdableIndex = (h: unknown) => (h ? G.holdables.indexOf(h as any) : -1);
export const holdableFrom = (i: number) => (i >= 0 ? G.holdables[i] ?? null : null);

