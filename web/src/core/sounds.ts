/**
 * Sound manifest: logical name → recorded variants (files in public/assets/sfx, made by tools/fetch_sounds.sh,
 * sources + licenses in sfx/CREDITS.md). A random variant is played each time.
 * OPTIONAL sounds have no free recording yet: the game plays them only if the file exists
 * (drop <name>.wav/.mp3 into web/sfx_user/ and run tools/fetch_sounds.sh).
 */
const n = (base: string, k: number) => Array.from({ length: k }, (_, i) => base + (i + 1));

export const SOUND_SETS: Record<string, string[]> = {
  // pigs
  oink: n('oink', 3), grunt: n('grunt', 2), squeal: n('squeal', 3), pigcry: n('pigcry', 2),
  fart: ['fart_short', 'fart_deep'],
  step: n('step', 4), boot: n('boot', 4), mudstep: n('mudstep', 3), splat: n('splat', 2),
  bite: ['bite'], whoosh: n('whoosh', 3), throw: ['throw'],
  // hits
  punch: n('punch', 2), body: n('body', 3), slap: n('slap', 2), thud: n('thud', 3),
  wood: n('wood', 6), metal: n('metal', 4), squish: ['squish'],
  // Bob
  bob_oof: n('bob_oof', 4), bob_down: n('bob_down', 3), bob_laugh: ['bob_laugh'], bob_huh: ['bob_huh'],
  // cage / grill / misc
  unlock: ['unlock'], creak: ['creak'], sizzle: ['sizzle'], crackle: ['crackle'], fanfare: ['fanfare'], coins: ['coins'],
  // animals
  moo: n('moo', 2), cluck: n('cluck', 3), squawk: ['squawk'], bark: n('bark', 3), growl: n('growl', 4), yelp: n('yelp', 2),
  howl: ['howl'], meow: ['meow'], munch: ['munch'],
  // ambience
  rooster: ['rooster'], night: ['night'], cricket: n('cricket', 3), bird: ['bird3', 'bird4', 'bird5'],
  amb_day: ['amb_day'], amb_farm: ['amb_farm'],
};

/** Wanted but no free recording found yet (see the user's to-do list). */
export const OPTIONAL = ['cough', 'snore', 'yawn', 'mower', 'bob_hey', 'bob_insult', 'wolf_howl', 'banjo'];

export function allFiles(): string[] {
  const s = new Set<string>();
  for (const v of Object.values(SOUND_SETS)) for (const f of v) s.add(f);
  return [...s];
}
