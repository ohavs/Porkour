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
  step: n('step', 4), boot: n('boot', 4), mudstep: n('mudstep', 3), splat: n('splat', 2), rustle: n('rustle', 3),
  bite: ['bite'], whoosh: n('whoosh', 3), throw: ['throw'],
  // hits
  punch: n('punch', 2), body: n('body', 3), slap: n('slap', 2), thud: n('thud', 3),
  wood: n('wood', 6), metal: n('metal', 4), squish: ['squish'],
  // Bob
  // Bob = a hillbilly farmer (Hedgewars HillBilly voice pack): grunts, lines (chase / anger / insults / caught you / bye-bye…)
  bob_oof: ['bobv_ooff1', 'bobv_ooff2', 'bobv_ooff3', 'bobv_ow1', 'bobv_ow3', 'bobv_ow4'], bob_down: ['bobv_nooo', 'bobv_ow2'], bob_laugh: ['bobv_laugh'], bob_huh: ['bob_huh'],
  bob_hey: ['bobv_comeonthen', 'bobv_watchit', 'bobv_illgetyou', 'bobv_cutitout'], bob_grr: ['bobv_youllregretthat', 'bobv_leavemealone', 'bobv_cutitout'],
  bob_insult: ['bobv_stupid', 'bobv_coward', 'bobv_nutter'], bob_hello: ['bobv_hello'], bob_win: ['bobv_yessir', 'bobv_victory'], bob_bye: ['bobv_byebye'],
  bob_oops: ['bobv_oops', 'bobv_uh_oh'], bob_cough: ['bobv_poisoncough'],
  // cage / grill / misc
  unlock: ['unlock'], creak: ['creak'], sizzle: ['sizzle'], crackle: ['crackle'], fanfare: ['fanfare'], coins: ['coins'],
  shot: n('shot', 2), snap: ['snap'], fuse: ['fuse'], bang: ['bang'],
  // animals
  moo: n('moo', 2), neigh: n('neigh', 2), bray: n('bray', 2), baa: ['baa1'], llama: ['llama'], cluck: n('cluck', 3), squawk: ['squawk'], bark: n('bark', 3), growl: n('growl', 4), yelp: n('yelp', 2),
  howl: ['howl'], meow: ['meow'], munch: ['munch'], gobble: n('gobble', 2),
  // ambience
  rooster: ['rooster'], night: ['night'], cricket: n('cricket', 3), bird: ['bird3', 'bird4', 'bird5'],
  amb_day: ['amb_day'], amb_farm: ['amb_farm'], rain: ['rain'], thunder: n('thunder', 2),
  buzz: ['buzz'],
  // farm 3: the bull, a tipped cow, milking + spilled milk
  bull: ['bull4', 'bull5', 'bull7'], charge: ['charge'], cowhurt: ['cowhurt'], milk: ['milk'], splash: ['splash'],
  // farm 5: winter (wind, snow footsteps, snowball hits, cracking ice)
  wind: ['wind'], gust: ['gust'], snowstep: n('snowstep', 4), snowhit: n('snowhit', 2), icecrack: ['icecrack'], icestep: n('icestep', 3),
  // Bob's phone: the bell, Bob rambling into it, the caller / a pig's oink through the line, a dead line, coin, receiver slam
  ring: ['ring'], phonetalk: n('phonetalk', 3), phonevoice: ['phonevoice1', 'phonevoice3', 'phonevoice5'], phoneoink: ['phoneoink'],
  static: ['static'], coin: ['coin'], clunk: ['clunk'],
  // heavy loot: the grandfather clock (ticks, strikes the hours), the old TV's screen
  tick: ['tick'], bong: ['bong'], glass: n('glass', 2),
};

/** Wanted but no free recording found yet (see the user's to-do list). */
export const OPTIONAL = ['cough', 'snore', 'yawn', 'mower', 'wolf_howl', 'banjo'];

export function allFiles(): string[] {
  const s = new Set<string>();
  for (const v of Object.values(SOUND_SETS)) for (const f of v) s.add(f);
  return [...s];
}
