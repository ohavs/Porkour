import * as THREE from 'three';
import { G, ADMIN } from './ctx';
import { t, type Key } from '../i18n';
import { fitted } from '../core/assets';
import { toonMat } from '../render/toon';
import { PROPS, type Prop } from '../world/props';
import type { Critter } from '../world/animals';
import type { Gate } from '../world/gates';
import type { Outhouse } from '../world/outhouse';
import { SETTINGS, saveSettings } from './settings';
import { gadget, consumeGadget, loadout, level, levelProgress, HORSESHOE_BONUS, type GadgetId } from './shop';
import { POOL_IDS, type PoolId } from '../world/gadgets';
import type { Game } from './game';
import { farmId, stageOf, STAGE } from '../world/farms';
import { MOD, MOD_IDS, MOD_SVG, rollMod, type ModId } from './modifiers';
import type { Spot } from '../world/pumpkins';
import { IC, kc, type IconId } from './icons';

/**
 * M5 round loop (Burglin' Gnomes / Untitled Goose Game to-do list): steal loot into the stash in the sty (each item
 * has a coin value), do the pranks on the list, then everyone back to the stash — or hold out until the clock runs
 * out. 3 grilled pigs = busted. Stars + coins at the end (saved for the shop). Host-authoritative: the host runs
 * `step` / `onEvent`; players get the state through `netState` like any synced entity.
 */
export const ROUND = { quotaBase: 400, quotaPer: 200, startHour: 7, prankCoins: 40, stashR: 2.3, madeBase: 300, madePer: 150 };

export type MissionId = 'quota' | 'knockBob' | 'staggerBob' | 'fartBob' | 'mugPond' | 'catBath' | 'lambStash' | 'hensOut' | 'wolfScare' | 'pumpkinWell'
  | 'sheepOut' | 'hayPond' | 'loseBob' | 'whackBob' | 'henPond'
  | 'smashPots' | 'melonSmash' | 'eggBob' | 'gnomePond' | 'undiesWell' | 'pieSteal' | 'mudPorch' | 'mazeTrophy' | 'cowsOut' | 'gateBreak'
  // farm 2 (orchard & beehives)
  | 'shakeTrees' | 'appleBob' | 'ciderPress' | 'beeBob' | 'honeySteal' | 'goldApple'
  // farm 3 (dairy & cheese)
  | 'bullBob' | 'bullOut' | 'cowTip' | 'cheeseBob' | 'prizeCheese' | 'spillMilk' | 'milkSlip'
  // farm 4 (pumpkin farm at night)
  | 'lanternsOut' | 'catapultBob' | 'pigLaunch' | 'giantPumpkin' | 'pumpkinSmash'
  // farm 5 (winter)
  | 'snowballBob' | 'bigSnowball' | 'snowmanDown' | 'bobIce' | 'iceHole' | 'bigPresent'
  // every farm: Bob's outhouse, his safe (heavy: two pigs)
  | 'looLock' | 'looTip' | 'safeSteal'
  // every farm: Bob's phone (cut him off mid-call, prank-call him from the payphone), more heavy loot
  | 'hangUp' | 'prankCall' | 'tvSteal' | 'clockSteal'
  // farms with a hammock: Bob's siesta
  | 'hammockFlip' | 'mudFace'
  // chain modes: farm 6 (cannabis), farm 7 (beer), and the challenges you do high / drunk
  | 'rollJoint' | 'bongRip' | 'bakeCookies' | 'everyoneHigh' | 'brewBeer' | 'drinkUp'
  | 'beamWalk' | 'visions' | 'munchies' | 'hugBob' | 'cloudGaze' | 'tableDance' | 'serenade';
/** Chain-mode challenges (done buzzed): the cannabis farm's pool and the beer farm's pool. */
const HIGH_POOL: MissionId[] = ['beamWalk', 'visions', 'munchies', 'hugBob', 'cloudGaze'];
const DRUNK_POOL: MissionId[] = ['beamWalk', 'visions', 'hugBob', 'tableDance', 'serenade', 'cloudGaze'];
const REQ_POOL: MissionId[] = ['knockBob', 'fartBob', 'mugPond', 'hensOut', 'pumpkinWell', 'lambStash', 'sheepOut', 'hayPond', 'loseBob', 'whackBob',
  'smashPots', 'eggBob', 'gnomePond', 'undiesWell', 'pieSteal', 'mudPorch', 'cowsOut', 'gateBreak',
  'shakeTrees', 'appleBob', 'ciderPress', 'beeBob', 'honeySteal', 'goldApple',
  'bullBob', 'bullOut', 'cowTip', 'cheeseBob', 'prizeCheese', 'spillMilk', 'milkSlip',
  'lanternsOut', 'catapultBob', 'pigLaunch', 'giantPumpkin', 'pumpkinSmash',
  'snowballBob', 'bigSnowball', 'snowmanDown', 'bobIce', 'iceHole', 'bigPresent', 'looLock', 'looTip', 'prankCall', 'hammockFlip'];
const BONUS_POOL: MissionId[] = ['catBath', 'wolfScare', 'staggerBob', 'henPond', 'melonSmash', 'mazeTrophy', 'safeSteal', 'hangUp', 'tvSteal', 'clockSteal', 'mudFace', ...REQ_POOL];
interface Mission { id: MissionId; req: boolean; done: boolean; n: number }
/** Places things get taken to (waypoint when you hold the thing). */
export type Where = 'pond' | 'well' | 'stash' | 'porch' | 'bob' | 'press' | 'hole';
/** Counted pranks (progress shown as n / need). */
const NEED: Partial<Record<MissionId, number>> = { visions: 6, munchies: 5, smashPots: 4, melonSmash: 3, eggBob: 2, shakeTrees: 5, appleBob: 3, ciderPress: 6, cowTip: 3, spillMilk: 3, lanternsOut: 6, pumpkinSmash: 5, snowballBob: 4, iceHole: 3 };
/** Which props / critters a prank is about, and where they go. */
/** Big pasture animals (they walk out on their own when the pasture gate is open). */
const BIG = ['cow', 'horse', 'horse2', 'donkey', 'reindeer', 'doe'];
const MDEF: Partial<Record<MissionId, { props?: string[]; critters?: string[]; to?: Where; inCoop?: boolean; inPen?: boolean; inPasture?: boolean; inBullPen?: boolean; noArrow?: boolean }>> = {
  mugPond: { props: ['mug'], to: 'pond' }, hayPond: { props: ['hay'], to: 'pond' }, gnomePond: { props: ['gnome'], to: 'pond' },
  catBath: { critters: ['cat'], to: 'pond' }, henPond: { critters: ['hen'], to: 'pond' },
  lambStash: { critters: ['sheep'], to: 'stash' }, pieSteal: { props: ['pie'], to: 'stash' }, mazeTrophy: { props: ['trophy'], to: 'stash' },
  pumpkinWell: { props: ['pumpkin', 'bigPumpkin'], to: 'well' }, undiesWell: { props: ['undies'], to: 'well' },
  hensOut: { critters: ['hen'], inCoop: true }, sheepOut: { critters: ['sheep'], inPen: true },
  cowsOut: { critters: BIG, inPasture: true },
  smashPots: { props: ['flowerPot'] }, melonSmash: { props: ['melon'] }, eggBob: { props: ['egg'], to: 'bob' },
  appleBob: { props: ['apple'], to: 'bob' }, ciderPress: { props: ['apple'], to: 'press' },
  honeySteal: { props: ['honeyPot'], to: 'stash' }, goldApple: { props: ['goldApple'], to: 'stash' },
  bullBob: { critters: ['bull'], props: ['redRag'], to: 'bob' }, bullOut: { critters: ['bull'], inBullPen: true }, cowTip: { critters: ['cow'] },
  cheeseBob: { props: ['cheeseWheel'], to: 'bob' }, prizeCheese: { props: ['prizeCheese'], to: 'stash' },
  spillMilk: { props: ['milkChurn'] }, milkSlip: { props: ['milkChurn'] },
  giantPumpkin: { props: ['giantPumpkin'], to: 'stash' }, pumpkinSmash: { props: ['patchPumpkin', 'patchPumpkinY'] },
  safeSteal: { props: ['safe'], to: 'stash' }, tvSteal: { props: ['tv'], to: 'stash' }, clockSteal: { props: ['clock'], to: 'stash' },
  snowballBob: { props: ['snowball'], to: 'bob', noArrow: true }, bigSnowball: { props: ['snowboulder'], to: 'bob' }, bigPresent: { props: ['bigPresent'], to: 'stash' },
};
type Phase = 'play' | 'escape' | 'end';
const PHASES: Phase[] = ['play', 'escape', 'end'];

/**
 * One colour per line of the mission list (user: each mission has its own coloured arrow; the arrows in the world
 * have the colour of their mission). Line 0 = the loot quota (gold, like the loot arrows).
 */
export const MISSION_COLORS = ['#ffd166', '#ff6fd0', '#4fd8ff', '#8cf04a', '#ff8a3a', '#b58cff', '#ff4d5e'];
export const missionColor = (i: number) => (i <= 0 ? MISSION_COLORS[0] : MISSION_COLORS[1 + ((i - 1) % (MISSION_COLORS.length - 1))]);
/** Little down arrow in a mission's colour (mission list, waypoints). */
export const arrowSvg = (c: string, w = 14) => `<svg class="marr" viewBox="0 0 14 14" width="${w}" height="${w}"><path d="M2 2.5h10L7 12z" fill="${c}" stroke="#3b2412" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
/** Pranks done to Bob himself: the arrow sits over him. */
const ON_BOB = new Set<MissionId>(['knockBob', 'staggerBob', 'fartBob', 'loseBob', 'beeBob', 'hugBob', 'serenade']);
export interface MissionMark { at: THREE.Vector3; top: number; color: string; i: number }

/** Waypoint icons (the place a held thing goes). */
const WHERE_IC: Record<Where, IconId> = { pond: 'water', well: 'well', stash: 'stash', porch: 'house', bob: 'bob', press: 'apple', hole: 'water' };

const inRect = (r: { x0: number; x1: number; z0: number; z1: number } | null, p: { x: number; z: number }) => !!r && p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1;
const v1 = new THREE.Vector3();

const CSS = `
#missions { position:absolute; left:16px; top:62px; width: 260px; padding: 8px 12px 9px; border-radius: 14px; background: var(--panel); font-size: 15px; }
#missions .mh { display:flex; justify-content:space-between; align-items:center; font-family: Title; font-size: 18px; color: var(--gold); }
#missions .mh .tm.low { color:#ff6a4a; }
#missions .bar { height: 8px; border-radius: 5px; background: rgba(255,246,230,.15); margin: 5px 0 7px; overflow:hidden; }
#missions .bar > div { height:100%; width:0%; background: linear-gradient(90deg, var(--gold), #fff3b0); transition: width .4s; }
#missions .how { display:flex; flex-wrap:wrap; align-items:center; gap: 2px; margin-top: 3px; padding: 2px 6px; border-radius: 9px; background: rgba(255,246,230,.12); width: fit-content; }
#missions .how .ic { width: 20px; height: 20px; } #missions .how kbd.kc { font-size: 12px; padding: 0 5px; }
#missions .m { display:flex; gap: 7px; align-items: baseline; margin: 2px 0; opacity: .95; }
#missions .m i { font-style: normal; width: 16px; flex: none; color: var(--gold); align-self: center; display:flex; }
#missions .m s { text-decoration: none; margin-left: auto; color: var(--gold); font-size: 13px; opacity: .8; }
#missions .m.done { opacity: .55; text-decoration: line-through; }
#missions .m em { font-style: normal; font-size: 11px; color: #b6e36a; margin-left: auto; }
#missions .goal { color:#b6e36a; font-size: 14px; margin-top: 4px; }
#missions .mod { display:flex; align-items:center; gap: 6px; font-size: 13px; color: #cfe3ff; margin: -1px 0 5px; }
#missions .mod svg, #results .mod svg { width: 17px; height: 17px; flex: none; }
#missions .mod.grumpy, #results .mod.grumpy { color: #ffab8a; } #missions .mod.market, #results .mod.market { color: #ffe08a; }
#results .mod { display:inline-flex; align-items:center; gap: 6px; font-size: 15px; color:#cfe3ff; margin-bottom: 4px; }
.coin { display:inline-block; width: .8em; height: .8em; border-radius: 50%; background: radial-gradient(circle at 35% 35%, #fff3b0, #ffd166 45%, #c98a1b); box-shadow: 0 0 0 1.5px #7a4b12; vertical-align: -1px; margin-right: 3px; }
.val { color: var(--gold); white-space: nowrap; }
.wpt { position:absolute; left:0; top:0; font-family: Title; font-size: 17px; color: var(--gold); opacity:0; transition: opacity .25s; transform: translate(-50%,-100%); text-align:center; pointer-events:none;
  -webkit-text-stroke: 3px #3b2412; paint-order: stroke; white-space: nowrap; }
.wpt b { display:block; font-size: 26px; line-height: .9; }
.wpt.mission { color: #ff8ad8; }
#results { position:absolute; inset:0; display:none; align-items:center; justify-content:center; background: rgba(20,10,4,.55); z-index: 30; }
#results .panel { text-align:center; min-width: 380px; }
#results h1 { font-family: Title; font-weight: normal; font-size: 52px; margin: 0; color: var(--gold); }
#results h1.lose { color: #ff6a4a; }
#results .why { font-size: 18px; opacity: .85; margin-bottom: 6px; }
#results .stars { font-size: 54px; letter-spacing: 6px; color: rgba(255,246,230,.2); margin: 4px 0 8px; }
#results .stars b { color: var(--gold); text-shadow: 0 0 14px rgba(255,209,102,.7); font-weight: normal; }
#results ul { list-style: none; padding: 0; margin: 8px auto; text-align: left; display: inline-block; font-size: 17px; }
#results li { margin: 3px 0; } #results li i { font-style: normal; display:inline-block; width: 22px; }
#results li.ok i { color: #b6e36a; } #results li.no i { color: #ff6a4a; } #results li em { font-style: normal; font-size: 12px; color:#b6e36a; }
#results .sum { font-size: 20px; margin: 10px 0 2px; } #results .sum b { color: var(--gold); }
#results .tot { font-size: 15px; opacity: .8; margin-bottom: 14px; }
#results .btns { display:flex; gap: 12px; justify-content:center; }
#results .tot.shoe { color: #b6e36a; opacity: 1; margin: -6px 0 6px; }
#results .lvl { margin: -6px auto 14px; width: 240px; font-size: 15px; }
#results .lvl .xp { height: 8px; border-radius: 6px; background: rgba(0,0,0,.35); overflow: hidden; margin-top: 4px; }
#results .lvl .xp div { height: 100%; background: linear-gradient(90deg, var(--pink), var(--gold)); }
#results .lvl.up b { color: var(--gold); font-size: 22px; font-family: Title; font-weight: normal; animation: pulse 1s ease-in-out 3; display: inline-block; }
`;

export class Round {
  phase: Phase = 'play';
  elapsed = 0;
  secs = 600;
  banked = 0;
  quota = ROUND.quotaBase;
  missions: Mission[] = [];
  won = false;
  reason = '';
  /** Round number (host counts; players see it change on a restart). */
  no = 0;
  /** This round's modifier (rain / fog / grumpy Bob / market day), mirrored in G.mod. */
  mod: ModId = 'none';
  stash: THREE.Vector3;
  /** The shop gadget each pig slot got at the start of this round ('' = none). */
  given: string[] = [];
  private paid = -1; private usedNo = -1;
  private lastMin = false;
  private panel: HTMLElement; private mark: HTMLElement; private mark2: HTMLElement; private res: HTMLElement;
  private ring: THREE.Mesh; private coin: THREE.Object3D;
  private panelKey = ''; private resNo = -1;
  private events = new Set<string>();

  constructor(scene: THREE.Scene, private game: Game, at: THREE.Vector3) {
    this.stash = at.clone();
    // ---- stash: mud pit, glowing ring, a sign and a big spinning coin
    const g = new THREE.Group(); g.position.copy(at); scene.add(g);
    const mud = new THREE.Mesh(new THREE.CircleGeometry(ROUND.stashR, 40), toonMat(0x5a3518));
    mud.rotation.x = -Math.PI / 2; mud.position.y = 0.04; mud.receiveShadow = true;
    (mud.material as THREE.Material).polygonOffset = true; (mud.material as THREE.Material).polygonOffsetFactor = -2;
    g.add(mud);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(ROUND.stashR, 0.07, 8, 56),
      new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.85 }));
    this.ring.rotation.x = Math.PI / 2; this.ring.position.y = 0.1; g.add(this.ring);
    const sign = fitted('kenney/sign', { height: 1.1 }); sign.position.set(ROUND.stashR + 0.3, 0, -0.6); sign.rotation.y = -0.5; g.add(sign);
    this.coin = fitted('loot/Coin', { height: 0.7 }); this.coin.position.set(0, 2.2, 0); g.add(this.coin);
    // ---- HUD
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const hud = document.getElementById('hud')!;
    this.panel = el('div', 'missions', 'txt'); hud.appendChild(this.panel);
    this.mark = el('div', 'stashmark', 'txt wpt'); hud.appendChild(this.mark);
    this.mark2 = el('div', 'stashmark2', 'txt wpt'); hud.appendChild(this.mark2);
    this.res = el('div', 'results'); document.body.appendChild(this.res);
  }

  get timeLeft() { return Math.max(0, this.secs - this.elapsed); }
  inStash(p: { x: number; z: number }, margin = 0) { return Math.hypot(p.x - this.stash.x, p.z - this.stash.z) < ROUND.stashR + margin; }

  // ================================================================== host
  /** New round: fresh mission list (2 required pranks + 2 bonus), clock + loot back to zero. */
  start() {
    this.no++;
    this.phase = 'play'; this.elapsed = 0; this.banked = 0; this.won = false; this.reason = ''; this.lastMin = false;
    this.secs = ADMIN.roundMins * 60;
    this.events.clear();
    this.setMod(ADMIN.mod !== 'random' && MOD_IDS.includes(ADMIN.mod as ModId) ? ADMIN.mod as ModId : rollMod(this.game.farm.noMods));
    // + what every farm has: Bob's outhouse (bolt him in / tip it over), his safe (heavy loot)
    const can: MissionId[] = [...this.game.farm.missions, ...(this.game.loos.length ? ['looLock', 'looTip'] as MissionId[] : []),
      ...(this.game.farm.props.some((p) => p.def === PROPS.safe) ? ['safeSteal'] as MissionId[] : []),
      ...(this.game.farm.props.some((p) => p.def === PROPS.tv) ? ['tvSteal'] as MissionId[] : []),
      ...(this.game.farm.props.some((p) => p.def === PROPS.clock) ? ['clockSteal'] as MissionId[] : []),
      ...(this.game.phones?.wall ? ['hangUp'] as MissionId[] : []), ...(this.game.phones?.pay ? ['prankCall'] as MissionId[] : []),
      ...(this.game.hammock ? ['hammockFlip', 'mudFace'] as MissionId[] : [])];
    const ch = this.game.farm.chain;
    if (ch) {   // chain modes: the chain's own goals + challenges done buzzed (no random pranks)
      const c3 = pick(ch.kind === 1 ? HIGH_POOL : DRUNK_POOL, 3);
      const way = pick(['bongRip', 'bakeCookies'] as MissionId[], 2);
      const req: MissionId[] = ch.kind === 1 ? ['rollJoint', way[0], c3[0]] : ['brewBeer', 'drinkUp', c3[0]];
      const bonus: MissionId[] = ch.kind === 1 ? [way[1], c3[1]] : [c3[1], c3[2]];
      if (G.net !== 'solo' && ch.kind === 1) bonus.push('everyoneHigh');
      this.missions = [{ id: 'quota', req: true, done: false, n: 0 }, ...req.map((id) => ({ id, req: true, done: false, n: 0 })), ...bonus.map((id) => ({ id, req: false, done: false, n: 0 }))];
      this.handOut();
      return;
    }
    const own = this.game.farm.featured ?? [];
    // a farm with its own pranks: one of the two required ones is always one of them
    const first = own.length ? pick(own.filter((m) => REQ_POOL.includes(m)), 1) : [];
    const req = [...first, ...pick(REQ_POOL.filter((m) => can.includes(m) && !first.includes(m)), 2 - first.length)];
    const bonus = pick(BONUS_POOL.filter((m) => can.includes(m) && !req.includes(m)), 2);
    this.missions = [{ id: 'quota', req: true, done: false, n: 0 }, ...req.map((id) => ({ id, req: true, done: false, n: 0 })), ...bonus.map((id) => ({ id, req: false, done: false, n: 0 }))];
    this.handOut();
  }

  /** Shop gadgets (host): each player's pick for this round; the props ones wait right in front of the pig. */
  private handOut() {
    const g = this.game;
    this.given = g.pigs.map((pig) => {
      if (pig.absent || (G.net === 'solo' && pig !== g.local)) return '';
      const id = pig === g.local ? loadout() : (gadget(pig.gadget) ? pig.gadget : '');
      if (POOL_IDS.includes(id as PoolId)) g.gadgets.give(id as PoolId, g.pigs.indexOf(pig), pig.pos, pig.yaw);
      return id;
    });
  }
  /** The gadget my pig has this round. */
  myGadget(): GadgetId | '' { return (this.given[this.game.pigs.indexOf(this.game.local)] ?? '') as GadgetId | ''; }

  /** Host: this round's modifier (admin can switch it live). Everyone gets a toast through the event. */
  setMod(m: ModId) {
    this.mod = m; G.mod = m;
    if (m !== 'none') G.events.push({ type: 'mod', text: m });
  }

  /** Game events (host): Bob knocked down / coughing, wolves scared… */
  onEvent(type: string, text = '', why = '') {
    if (this.phase === 'end') return;
    // chain modes: everything made counts toward the quota line; the chain's goals + buzzed challenges
    if (type === 'made') this.banked += Number(why) || 0;
    if (type === 'puff') this.done('rollJoint');
    if (type === 'bongRip') this.done('bongRip');
    if (type === 'bakeCookies') this.done('bakeCookies');
    if (type === 'brewBeer') this.done('brewBeer');
    if (type === 'beamCrossed' && why === 'buzzed') this.done('beamWalk');
    if (type === 'vision') this.count('visions');
    if (type === 'munch') this.count('munchies');
    if (type === 'hugBob') this.done('hugBob');
    if (type === 'cloudGaze') this.done('cloudGaze');
    if (type === 'tableDance') this.done('tableDance');
    if (type === 'serenade') this.done('serenade');
    if (type === 'smashed' && text === 'flowerPot') this.count('smashPots');
    if (type === 'smashed' && text === 'melon') this.count('melonSmash');
    if (type === 'splatBob') this.count(text === 'apple' ? 'appleBob' : text === 'snowball' ? 'snowballBob' : 'eggBob');
    if (type === 'treeShaken') this.count('shakeTrees');
    if (type === 'pressed') this.count('ciderPress');
    if (type === 'bobStung') this.done('beeBob');
    if (type === 'knockdown') { this.done('knockBob'); this.done('staggerBob'); }
    if (type === 'stagger') this.done('staggerBob');
    if (type === 'bobCough') this.done('fartBob');
    if (type === 'wolfScared') this.done('wolfScare');
    if (type === 'bobGaveUp') this.done('loseBob');
    if (type === 'whacked') this.done('whackBob');
    if (type === 'gateBroken') this.done('gateBreak');
    if (type === 'cowTipped') this.count('cowTip');
    if (type === 'milkSpilled') this.count('spillMilk');
    if (type === 'bullBob') this.done('bullBob');
    if (type === 'cheeseBob') this.done('cheeseBob');
    if (type === 'bobSlipped') this.done(text === 'ice' ? 'bobIce' : 'milkSlip');
    if (type === 'bobDunked') this.done('bobIce');
    if (type === 'bigSnowballBob') this.done('bigSnowball');
    if (type === 'snowmanDown') this.done('snowmanDown');
    if (type === 'iceHole') this.count('iceHole');
    if (type === 'lanternOut') this.count('lanternsOut');
    if (type === 'smashed' && (text === 'patchPumpkin' || text === 'patchPumpkinY')) this.count('pumpkinSmash');
    if (type === 'catapultBob') this.done('catapultBob');
    if (type === 'pigLaunched') this.done('pigLaunch');
    if (type === 'looLocked') this.done('looLock');
    if (type === 'looTipped' && text === 'bob') this.done('looTip');
    if (type === 'hangUp') this.done('hangUp');
    if (type === 'prankCall') this.done('prankCall');
    if (type === 'hammockFlip') this.done('hammockFlip');
    if (type === 'mudFace') this.done('mudFace');
  }

  step(dt: number) {
    if (this.phase === 'end' || !this.missions.length) return;
    this.elapsed += dt;
    this.secs = ADMIN.roundMins * 60;
    const { props, critters, places: P } = this.game.farm;
    // players: solo = just you (the other pigs in the sty are idle extras); online = every connected pig
    const pigs = G.net === 'solo' ? [this.game.local] : this.game.pigs.filter((p) => !p.absent);
    const st = stageOf(farmId());   // story stages get harder
    this.quota = this.game.farm.chain ? ROUND.madeBase + ROUND.madePer * Math.max(0, pigs.length - 1)
      : Math.round((ROUND.quotaBase + ROUND.quotaPer * Math.max(0, pigs.length - 1) + (this.mod === 'market' ? MOD.market.quota : 0)) * (st ? STAGE.quota[st - 1] : 1) / 10) * 10;
    // chain modes: everyone buzzed at once / everyone finished a mug
    if (this.wants('everyoneHigh')) this.check('everyoneHigh', pigs.every((p) => !p.out && p.high > 0.4));
    if (this.wants('drinkUp')) { const dm = (this.game.farm.chain as { drunkMugs?: Map<unknown, number> } | undefined)?.drunkMugs; this.check('drinkUp', !!dm && pigs.every((p) => (dm.get(p) ?? 0) > 0)); }
    // a player who left takes their gadget slot along (someone joining that seat mid-round didn't bring it)
    if (this.given.some((x, i) => x && this.game.pigs[i]?.absent)) this.given = this.given.map((x, i) => (this.game.pigs[i]?.absent ? '' : x));
    // loot dropped in the stash
    for (const pr of props) {
      if (pr.banked || pr.value <= 0 || pr.heldBy) continue;
      const p = pr.synced.currP;
      if (!this.inStash(p) || p.y > this.stash.y + 2.5) continue;
      const lv = pr.body.linvel();
      if (Math.hypot(lv.x, lv.y, lv.z) < 2.5) this.bankProp(pr);
    }
    // pranks that are places / states
    const inWater = this.game.farm.inWater;
    if (this.wants('mugPond')) this.check('mugPond', props.some((p) => p.def === PROPS.mug && !p.banked && inWater(p.synced.currP.x, p.synced.currP.z)));
    if (this.wants('catBath')) this.check('catBath', critters.some((c) => c.def.kind === 'cat' && inWater(c.pos.x, c.pos.z)));
    if (this.wants('lambStash')) this.check('lambStash', critters.some((c) => c.def.kind === 'sheep' && this.inStash(c.pos, 0.3)));
    if (this.wants('hensOut')) this.check('hensOut', critters.filter((c) => c.def.kind === 'hen' && !inRect(P.coop, c.pos)).length >= 3);
    if (this.wants('pumpkinWell')) this.check('pumpkinWell', props.some((p) => (p.def === PROPS.pumpkin || p.def === PROPS.bigPumpkin) && !p.banked && !p.heldBy
      && this.atWell(p.synced.currP)));
    if (this.wants('sheepOut')) this.check('sheepOut', critters.filter((c) => c.def.kind === 'sheep' && !inRect(P.sheepPen, c.pos)).length >= 2);
    if (this.wants('cowsOut')) this.check('cowsOut', critters.filter((c) => BIG.includes(c.def.kind) && !inRect(P.pasture, c.pos)).length >= 2);
    if (this.wants('hayPond')) this.check('hayPond', props.some((p) => p.def === PROPS.hay && !p.banked && inWater(p.synced.currP.x, p.synced.currP.z)));
    if (this.wants('henPond')) this.check('henPond', critters.some((c) => c.def.kind === 'hen' && inWater(c.pos.x, c.pos.z)));
    if (this.wants('gnomePond')) this.check('gnomePond', props.some((p) => p.def === PROPS.gnome && !p.banked && inWater(p.synced.currP.x, p.synced.currP.z)));
    if (this.wants('undiesWell')) this.check('undiesWell', props.some((p) => p.def === PROPS.undies && !p.banked && !p.heldBy && this.atWell(p.synced.currP)));
    if (this.wants('bullOut')) this.check('bullOut', !!this.game.farm.dairy?.loose);
    if (this.wants('mudPorch')) {
      const door = this.game.farm.zones.door;
      this.check('mudPorch', pigs.some((p) => p.muddy > 0 && !p.out && Math.hypot(p.pos.x - door.x, p.pos.z - door.z) < 2.6));
    }
    this.check('quota', this.banked >= this.quota);
    // phases
    const reqDone = this.missions.every((m) => !m.req || m.done);
    if (this.phase === 'play' && reqDone) { this.phase = 'escape'; G.events.push({ type: 'roundEscape' }); }
    if (this.phase === 'escape') {
      const ready = pigs.filter((p) => !p.out);
      if (ready.length && ready.every((p) => this.inStash(p.pos, 0.4) && !p.heldBy && !p.cage)) return this.end(true, 'win');
    }
    if (G.grills >= 3) return this.end(false, 'grill');
    if (this.timeLeft <= 0) return this.end(reqDone, 'time');
    if (!this.lastMin && this.timeLeft < 60) { this.lastMin = true; G.events.push({ type: 'lastMinute' }); }
    const sf = STAGE.floor[stageOf(farmId()) - 1] ?? 0;
    G.farmer?.setFloor(this.timeLeft < 120 ? 2 : Math.max(sf, this.mod === 'grumpy' ? MOD.grumpy.floor : 0));   // the last 2 minutes: at least "on alert"
  }

  private atWell(p: THREE.Vector3) { const w = this.game.farm.places.well; return !!w && Math.hypot(p.x - w.x, p.z - w.z) < 1.6 && p.y > G.terrain.height(w.x, w.z) + 0.9; }
  private wants(id: MissionId) { return this.missions.some((m) => m.id === id && !m.done); }
  /** One more of a counted prank (pots smashed, eggs on Bob…). */
  private count(id: MissionId) {
    const m = this.missions.find((x) => x.id === id);
    if (!m || m.done) return;
    m.n++;
    if (m.n >= (NEED[id] ?? 1)) this.done(id);
    else G.events.push({ type: 'missionStep', text: 'm.' + id, why: `${m.n}/${NEED[id]}` });
  }
  private check(id: MissionId, ok: boolean) { if (ok) this.done(id); }
  private done(id: MissionId) {
    const m = this.missions.find((x) => x.id === id);
    if (!m || m.done) return;
    m.done = true;
    G.events.push({ type: 'missionDone', text: 'm.' + id });
    G.farmer?.raise('prank');   // he notices the mess: the farm gets more alert
    G.audio.play('fanfare', { vol: 0.5 });
  }
  bankProp(pr: Prop) {
    const p = v1.copy(pr.synced.currP);
    pr.bank();
    const value = Math.round(pr.value * (this.mod === 'grumpy' ? MOD.grumpy.loot : 1));
    this.banked += value;
    if (pr.def === PROPS.pie) this.done('pieSteal');
    if (pr.def === PROPS.honeyPot) this.done('honeySteal');
    if (pr.def === PROPS.goldApple) this.done('goldApple');
    if (pr.def === PROPS.trophy) this.done('mazeTrophy');
    if (pr.def === PROPS.prizeCheese) this.done('prizeCheese');
    if (pr.def === PROPS.giantPumpkin) this.done('giantPumpkin');
    if (pr.def === PROPS.bigPresent) this.done('bigPresent');
    if (pr.def === PROPS.safe) this.done('safeSteal');
    if (pr.def === PROPS.tv && !pr.broken) this.done('tvSteal');
    if (pr.def === PROPS.clock) this.done('clockSteal');
    G.audio.play('coins', { pos: p, vol: 0.9 });
    G.fx.bits(p, { count: 18, color: 0xffd166, spread: 0.3, speed: 3, up: 4, grav: 8, life: 0.9, size: 0.1, grow: 0, alpha: 1 });
    G.events.push({ type: 'banked', text: pr.label ?? '', why: String(value) });
  }
  end(won: boolean, reason: string) {
    if (this.phase === 'end') return;
    this.phase = 'end'; this.won = won; this.reason = reason;
    G.events.push({ type: 'roundEnd' });
  }
  /** Admin: tick every mission. */
  finishAll() { for (const m of this.missions) if (m.id !== 'quota') this.done(m.id); this.banked = Math.max(this.banked, this.quota); }

  stars() { return this.won ? Math.min(3, 1 + this.missions.filter((m) => !m.req && m.done).length) : 0; }
  pranks() { return this.missions.filter((m) => m.id !== 'quota' && m.done).length; }
  coinsEarned() { return this.won ? this.banked + ROUND.prankCoins * this.pranks() : Math.floor(this.banked * 0.25); }
  /** What I get: + the lucky horseshoe's bonus if I brought one. */
  myCoins() { return Math.round(this.coinsEarned() * (this.myGadget() === 'horseshoe' ? HORSESHOE_BONUS : 1)); }

  // ================================================================== network (synced entity, no body)
  netState(n: number[], s: string[]) {
    let bits = 0; this.missions.forEach((m, i) => { if (m.done) bits |= 1 << i; });
    n.push(PHASES.indexOf(this.phase), Math.round(this.elapsed * 10) / 10, this.secs, this.banked, this.quota, this.won ? 1 : 0, bits, this.no, ...this.missions.map((m) => m.n));
    s.push(this.missions.map((m) => m.id + (m.req ? '!' : '')).join(','), this.reason, this.mod, this.given.join(','));
  }
  netApply(n: number[], s: string[]) {
    if (n.length < 8) return;
    this.phase = PHASES[n[0]] ?? 'play'; this.elapsed = n[1]; this.secs = n[2]; this.banked = n[3]; this.quota = n[4];
    this.won = n[5] === 1; this.no = n[7];
    if (s[0] !== undefined) {
      const ids = s[0] ? s[0].split(',') : [];
      this.missions = ids.map((x, i) => ({ id: x.replace('!', '') as MissionId, req: x.endsWith('!'), done: (n[6] & (1 << i)) !== 0, n: 0 }));
    } else this.missions.forEach((m, i) => { m.done = (n[6] & (1 << i)) !== 0; });
    this.missions.forEach((m, i) => { m.n = n[8 + i] ?? m.n; });
    if (s[1] !== undefined) this.reason = s[1];
    if (s[2] !== undefined) {
      const m = (MOD_IDS.includes(s[2] as ModId) ? s[2] : 'none') as ModId;
      if (m !== this.mod && m !== 'none') G.events.push({ type: 'mod', text: m });   // set outside the host's steps: not in its recorded events
      this.mod = m; G.mod = m;
    }
    if (s[3] !== undefined) this.given = s[3].split(',').map((x) => (gadget(x) ? x : ''));
  }

  // ================================================================== every frame (all browsers)
  render(dt: number, camera: THREE.Camera) {
    const tt = G.time;
    this.coin.rotation.y += dt * 2.2;
    this.coin.position.y = 2.2 + Math.sin(tt * 2) * 0.12;
    const m = this.ring.material as THREE.MeshBasicMaterial;
    const hot = this.phase === 'escape' || this.carrying();
    m.opacity = 0.55 + Math.sin(tt * (hot ? 7 : 3)) * 0.3;
    this.ring.scale.setScalar(hot ? 1 + Math.sin(tt * 7) * 0.03 : 1);
    this.renderPanel();
    this.renderMark(camera);
    this.renderResults();
    this.useGadget();
  }

  /** A new round started with my gadget: one fewer in my bag, and say where it is / what it does. */
  private useGadget() {
    if (this.no === this.usedNo || this.no <= 0 || this.phase === 'end') return;
    this.usedNo = this.no;
    const id = this.myGadget();
    if (!id) return;
    consumeGadget(id);
    this.game.onLoadout?.();
    setTimeout(() => this.game.hud.toast(t(('g.' + id) as Key), 2.2), 2600);   // after the round-start toast
  }

  /** The {n} of a mission text key ('m.smashPots' → 4, 'm.quota' → the quota). */
  textN(key: string) { const id = key.replace('m.', '') as MissionId; return id === 'quota' ? this.quota : NEED[id] ?? 0; }
  /** How to do a mission's next step, as icons (user: "I didn't get what to do"): the chain's step, mud → porch… */
  private mHow(x: Mission) {
    if (x.done || x.id === 'quota') return '';
    const L = this.game.local, ch = this.game.farm.chain;
    if (ch) { const h = ch.stepIcons(x.id, L); if (h) return h; }
    if (x.id === 'mudPorch') return L.muddy > 0 ? IC.house : kc('C') + IC.mud;
    return '';
  }
  /** Mission line: text + progress for counted pranks. */
  private mText(x: Mission) {
    if (x.id === 'quota') return t(this.game.farm.chain ? 'm.quotaMade' : 'm.quota', { n: this.quota });
    const need = NEED[x.id];
    return t(('m.' + x.id) as Key, { n: need ?? 0 }) + (need && !x.done ? ` <span class="val">${x.n}/${need}</span>` : '');
  }

  // ---------------------------------------------------------------- what to point at (markers.ts draws the arrows)
  /**
   * One arrow per open prank, in its colour (markers.ts draws them), showing the NEXT step only: the thing to take
   * (the nearest one, not all of them) → once someone holds it, where it goes. Animals that live in a pen (hens,
   * sheep, cows…) get one arrow at their pen's gate, not one each. Pranks on Bob: over Bob.
   */
  missionMarks(): MissionMark[] {
    const out: MissionMark[] = [];
    if (this.phase === 'end') return out;
    const g = this.game, L = g.local, { props, critters, places: P } = g.farm;
    const near = <T>(list: T[], pos: (x: T) => THREE.Vector3) => {
      let best: T | null = null, bd = Infinity;
      for (const x of list) { const p = pos(x), d = (p.x - L.pos.x) ** 2 + (p.z - L.pos.z) ** 2; if (d < bd) { bd = d; best = x; } }
      return best;
    };
    const bob = G.farmer;
    let onBob = 0;
    const mark = (i: number, at: THREE.Vector3 | null | undefined, top = 0) => { if (at) out.push({ at: at.clone(), top, color: missionColor(i), i }); };
    const atBob = (i: number) => { if (bob && bob.visual.root.visible) { const v = bob.visual.root.position; out.push({ at: v.clone(), top: 2.1, color: missionColor(i), i, ...{ off: onBob++ } } as MissionMark); } };
    const pens = [P.coop, P.sheepPen, P.pasture].filter(Boolean) as { x0: number; x1: number; z0: number; z1: number }[];
    /** A pen's spot to aim at: its gate if it has one, else its middle. */
    const penSpot = (r: { x0: number; x1: number; z0: number; z1: number }) => {
      const gate = ((G.gates?.list ?? []) as Gate[]).find((x) => { const q = x.def.rect; return q.x0 === r.x0 && q.z0 === r.z0 && q.x1 === r.x1 && q.z1 === r.z1; })
        ?? ((G.gates?.list ?? []) as Gate[]).find((x) => inRect(r, x.center));
      if (gate) return gate.markPos;
      const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      return new THREE.Vector3(cx, G.terrain.height(cx, cz) + 1, cz);
    };
    this.missions.forEach((m, i) => {
      if (m.done || m.id === 'quota') return;
      // chain modes: the mode knows the next step of its chain
      const cm = g.farm.chain && !ON_BOB.has(m.id) ? g.farm.chain.markFor(m.id, L) : null;
      if (cm) { mark(i, cm); return; }
      const d = MDEF[m.id];
      const isMine = (h: unknown) => !!h && !!d && ((d.props?.includes((h as Prop).def?.id ?? '') && (h as Prop).kind === 'prop')
        || ((h as Critter).kind === 'critter' && !!d.critters?.includes((h as Critter).def.kind)));
      // 1) somebody already holds the thing: where it goes
      if (d?.to && g.pigs.some((p) => !p.out && isMine(p.held))) {
        if (d.to === 'bob') atBob(i); else mark(i, this.wherePos(d.to, new THREE.Vector3()), 0.6);
        return;
      }
      switch (m.id) {
        case 'gateBreak': { const gt = near(((G.gates?.list ?? []) as Gate[]).filter((x) => x.state !== 'broken'), (x) => x.center); mark(i, gt?.markPos); return; }
        case 'lanternsOut': { const sp = near(g.farm.pumpkins?.litSpots() ?? [], (x) => x.markPos); mark(i, sp?.markPos); return; }
        case 'catapultBob': case 'pigLaunch': mark(i, g.farm.pumpkins?.cat?.spot.markPos); return;
        case 'snowmanDown': mark(i, g.farm.winter?.snowmanSpots()[0]?.markPos); return;
        case 'iceHole': if (L.held?.kind === 'prop') { mark(i, this.wherePos('hole', new THREE.Vector3()), 0.6); return; } mark(i, g.farm.winter?.holeSpot?.markPos); return;
        case 'bobIce': atBob(i); return;
        case 'looLock': case 'looTip': { const o = near(G.loos as Outhouse[], (x) => x.base); mark(i, o?.markPos); return; }
        case 'hangUp': { const ph = g.phones; mark(i, ph?.off && ph.ring === 1 ? ph.jackMark : ph?.phoneMark); return; }
        case 'prankCall': mark(i, g.phones?.payMark); return;
        case 'hammockFlip': case 'mudFace': mark(i, g.hammock?.markPos); return;
        case 'mudPorch': {   // muddy: the porch; not yet: the nearest mud to wallow in first
          if (L.muddy > 0) { mark(i, this.wherePos('porch', new THREE.Vector3()), 1.4); return; }
          const mz = near(G.terrain.mudZones, (z) => new THREE.Vector3(z.x, 0, z.z));
          if (mz) mark(i, new THREE.Vector3(mz.x, G.terrain.height(mz.x, mz.z) + 0.6, mz.z));
          return;
        }
        case 'wolfScare': { const w = near((G.wolves as { active: boolean; pos: THREE.Vector3 }[]).filter((x) => x.active), (x) => x.pos); if (w) mark(i, w.pos, 1.2); return; }
        case 'whackBob': {
          const wpn = (h: unknown) => !!(h as Prop)?.def?.weapon;
          if (wpn(L.held)) { atBob(i); return; }
          const pr = near(props.filter((p) => !p.banked && !p.heldBy && p.def.weapon), (p) => p.obj.position);
          if (pr) mark(i, pr.obj.position, pr.half);
          return;
        }
      }
      if (ON_BOB.has(m.id)) { atBob(i); return; }
      if (!d) return;
      // 2) the thing to take / smash / tip: the nearest one
      const pr = d.props ? near(props.filter((p) => !p.banked && !p.heldBy && d.props!.includes(p.def.id ?? '') && p.worth === null), (p) => p.obj.position) : null;
      if (pr && !d.critters) { mark(i, pr.obj.position, pr.half); return; }
      if (d.critters) {
        const cs = critters.filter((c) => {
          if (!d.critters!.includes(c.def.kind) || c.heldBy) return false;
          if (d.inCoop && !inRect(P.coop, c.pos)) return false;
          if (d.inPen && !inRect(P.sheepPen, c.pos)) return false;
          if (d.inPasture && !inRect(P.pasture, c.pos)) return false;
          if (d.inBullPen && g.farm.dairy?.loose) return false;
          return true;
        });
        // the bull and its rag: the rag first (whoever holds it gets charged)
        if (pr && d.to === 'bob') { mark(i, pr.obj.position, pr.half); return; }
        const c = near(cs, (x) => x.pos);
        if (!c) { if (pr) mark(i, pr.obj.position, pr.half); return; }
        const pen = pens.find((r) => inRect(r, c.pos));
        if (pen) mark(i, penSpot(pen));
        else mark(i, c.visual.root.position, c.height * 0.5);
      }
    });
    return out;
  }
  /** Where an open prank wants this thing taken (null = nowhere special). */
  targetFor(h: unknown): { where: Where; id: MissionId } | null {
    if (this.phase === 'end' || !h) return null;
    const pr = h as Prop, cr = h as Critter;
    for (const m of this.missions) {
      const d = MDEF[m.id]; if (m.done || !d?.to) continue;
      if (d.props && pr.def && d.props.includes(pr.def.id ?? '')) return { where: d.to, id: m.id };
      if (d.critters && cr.kind === 'critter' && d.critters.includes(cr.def.kind)) return { where: d.to, id: m.id };
    }
    // farm 5: anything you carry can go down Bob's ice-fishing hole
    const hole = this.missions.find((m) => m.id === 'iceHole' && !m.done);
    if (hole && pr.kind === 'prop' && this.game.farm.winter?.hole) return { where: 'hole', id: 'iceHole' };
    return null;
  }
  wherePos(w: Where, out: THREE.Vector3) {
    const { pond, well } = this.game.farm.places;
    if (w === 'pond') out.set(pond.x, G.terrain.height(pond.x, pond.z), pond.z);
    else if (w === 'well' && well) out.set(well.x, G.terrain.height(well.x, well.z) + 2.2, well.z);
    else if (w === 'press' && this.game.farm.orchard?.pressAt) out.copy(this.game.farm.orchard.pressAt);
    else if (w === 'hole' && this.game.farm.winter?.hole) { const h = this.game.farm.winter.hole; out.set(h.x, h.y + 0.3, h.z); }
    else if (w === 'porch') out.copy(this.game.farm.zones.door);
    else if (w === 'bob' && G.farmer) out.copy(G.farmer.pos).setY(G.farmer.pos.y + 1);
    else out.copy(this.stash);
    return out;
  }

  /** The modifier chip (icon + name) for the panel / results. */
  modLine() {
    if (this.mod === 'none') return '';
    return `<div class="mod ${this.mod}" title="${t(('mod.' + this.mod + '.d') as Key)}">${MOD_SVG[this.mod]}<span>${t(('mod.' + this.mod) as Key)}</span></div>`;
  }

  private carrying() { const h = this.game.local?.held as Prop | null; return !!h && (h as Prop).value > 0; }

  private renderPanel() {
    const left = Math.ceil(this.timeLeft), mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, '0');
    const hows = this.missions.map((m) => this.mHow(m));
    const key = [left, this.banked, this.quota, this.phase, this.mod, this.missions.map((m) => m.id + m.done + m.n).join(), hows.join('#')].join('|');
    if (key === this.panelKey) return;
    this.panelKey = key;
    if (!this.missions.length) { this.panel.style.display = 'none'; return; }
    this.panel.style.display = this.phase === 'end' ? 'none' : '';
    const rows = this.missions.map((x, i) => {
      const txt = this.mText(x);
      return `<div class="m${x.done ? ' done' : ''}"><i>${x.done ? "✔" : arrowSvg(missionColor(i), 16)}</i><span>${txt}${hows[i] ? `<span class="how">${hows[i]}</span>` : ''}</span>${x.req || x.done ? '' : '<s>★</s>'}</div>`;
    }).join('');
    const pct = Math.min(100, (this.banked / Math.max(1, this.quota)) * 100);
    this.panel.innerHTML = `<div class="mh"><span class="tm${left < 60 ? ' low' : ''}">⏱ ${mm}:${ss}</span><span><i class="coin"></i>${this.banked} / ${this.quota}</span></div>` +
      `<div class="bar"><div style="width:${pct}%"></div></div>${this.modLine()}${rows}` + (this.phase === 'escape' ? `<div class="goal">${t('m.escape')}</div>` : '');
  }

  /** Waypoints: where the thing you hold goes (a prank's place, the stash), Bob's porch when you're muddy for that prank. */
  private renderMark(camera: THREE.Camera) {
    const L = this.game.local;
    const list: { at: THREE.Vector3; label: string; mission: boolean; color: string }[] = [];
    const col = (id: MissionId) => missionColor(this.missions.findIndex((m) => m.id === id));
    if (this.phase !== 'end' && L && !L.out && !L.cage) {
      const tg = this.targetFor(L.held);
      if (tg && tg.where !== 'bob') list.push({ at: this.wherePos(tg.where, this.wp[0]), label: IC[WHERE_IC[tg.where]], mission: true, color: col(tg.id) });
      if (this.wants('mudPorch') && L.muddy > 0 && !tg) list.push({ at: this.wherePos('porch', this.wp[0]), label: IC.house, mission: true, color: col('mudPorch') });
      if ((this.carrying() && tg?.where !== 'stash') || (this.phase === 'escape' && !this.inStash(L.pos)) || tg?.where === 'stash')
        list.push({ at: this.wp[1].copy(this.stash), label: IC.stash, mission: false, color: MISSION_COLORS[0] });
    }
    let px = -1e9, py = -1e9;
    [this.mark, this.mark2].forEach((el, i) => {
      const m = list[i];
      el.style.opacity = m ? '1' : '0';
      if (!m) return;
      v1.copy(m.at).setY(m.at.y + 3).project(camera);
      const W = innerWidth, H = innerHeight;
      let x = (v1.x * 0.5 + 0.5) * W, y = (-v1.y * 0.5 + 0.5) * H;
      if (v1.z > 1) { x = W - x; y = H - 130; }
      x = Math.min(W - 60, Math.max(60, x)); y = Math.min(H - 130, Math.max(110, y));   // clear of the ability rings / Bob's chip
      if (Math.abs(x - px) < 150 && Math.abs(y - py) < 46) y = py - 48;   // two waypoints the same way: stack them
      px = x; py = y;
      el.style.left = x + 'px'; el.style.top = y + 'px';
      el.classList.toggle('mission', m.mission);
      el.style.color = m.color;
      const d = Math.hypot(L.pos.x - m.at.x, L.pos.z - m.at.z);
      const html = `${m.label}<b>${arrowSvg(m.color, 26)}</b>${Math.round(d)} m`;
      if (el.innerHTML !== html) el.innerHTML = html;
    });
  }
  private wp = [new THREE.Vector3(), new THREE.Vector3()];
  private lvUp = 0;

  private renderResults() {
    if (this.phase !== 'end') { if (this.resNo !== -1) { this.res.style.display = 'none'; this.resNo = -1; } return; }
    if (this.resNo === this.no) return;
    this.resNo = this.no;
    const earned = this.myCoins(), lv0 = level();
    if (this.paid !== this.no) {
      this.paid = this.no; SETTINGS.coins += earned; SETTINGS.xp += earned;
      const st = stageOf(farmId());
      if (this.won && st > SETTINGS.story) SETTINGS.story = st;   // the next stage unlocks
      saveSettings(); this.lvUp = level() > lv0 ? level() : 0;
    }
    const lv = level(), shoe = this.myGadget() === 'horseshoe' && earned > 0;
    const stars = this.stars();
    const can = G.net !== 'client';
    const li = this.missions.map((x) => {
      const txt = this.mText(x);
      return `<li class="${x.done ? 'ok' : 'no'}"><i>${x.done ? '✔' : '✘'}</i>${txt}${x.req ? '' : ` <em>${t('m.bonus')}</em>`}</li>`;
    }).join('');
    this.res.innerHTML = `<div class="panel"><h1 class="${this.won ? '' : 'lose'}">${t(this.won ? 'r.win' : 'r.lose')}</h1>` +
      `<div class="why">${t(('r.why.' + (this.reason || 'time')) as Key)}</div>` + this.modLine() +
      `<div class="stars">${[0, 1, 2].map((i) => (i < stars ? '<b>★</b>' : '★')).join('')}</div><ul>${li}</ul>` +
      `<div class="sum">${t('r.loot')}: <b><i class="coin"></i>${this.banked}</b> · ${t('r.coins')}: <b><i class="coin"></i>${earned}</b></div>` +
      (shoe ? `<div class="tot shoe">${t('r.horseshoe')}</div>` : '') +
      `<div class="tot">${t('r.total', { n: SETTINGS.coins })}</div>` +
      `<div class="lvl${this.lvUp ? ' up' : ''}"><b>${this.lvUp ? t('r.levelUp', { n: lv }) : t('shop.level', { n: lv })}</b><div class="xp"><div style="width:${Math.round(levelProgress() * 100)}%"></div></div></div>` +
      `<div class="btns">${can ? `<button class="chip" data-r="again">${t('r.again')}</button>` : `<span class="tot">${t('r.wait')}</span>`}<button class="chip" data-r="menu">${t('r.menu')}</button></div></div>`;
    this.res.style.display = 'flex';
    document.exitPointerLock?.();
    this.res.querySelector('[data-r=again]')?.addEventListener('click', () => this.game.restartRound());
    this.res.querySelector('[data-r=menu]')?.addEventListener('click', () => { location.href = G.net === 'solo' ? location.pathname : location.pathname + '?lobby=1'; });
  }
}

function el(tag: string, id: string, cls = '') { const e = document.createElement(tag); e.id = id; if (cls) e.className = cls; return e; }
function pick<T>(arr: T[], n: number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}
