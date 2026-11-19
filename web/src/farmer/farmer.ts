import * as THREE from 'three';
import { RAPIER, world, groups, L, owners, raycast, ignorePair, SEE_THROUGH } from '../core/physics';
import { Synced } from '../core/synced';
import { clamp, dampAngle, wrapAngle } from '../core/util';
import { G, ADMIN, ignored, type Holdable, type Cloud } from '../game/ctx';
import type { Pig } from '../pig/pig';
import type { Cage } from '../world/cage';
import type { Rect } from '../world/terrain';
import type { Wolf } from '../world/wolf';
import type { Prop } from '../world/props';
import { Nav } from './nav';
import { Mower } from './mower';
import { FarmerVisual, type FarmerAnim } from './farmerVisual';
import { Ragdoll, type LimbDef } from '../core/ragdoll';
import { Grip } from '../core/grip';
import { SCRUFF } from '../pig/pigBody';
import { sightPoint } from '../world/cover';
import { MOD, modSight, modHear, marketHours } from '../game/modifiers';
import { toonMat } from '../render/toon';
import { GATE, type Gate, type Gates } from '../world/gates';
import { LOO, looFirst, looEvery, type Outhouse } from '../world/outhouse';
import { PHONE, type Phones } from '../world/phone';
import { NAP, type Hammock } from '../world/hammock';
import { COFFEE, type Porch } from '../world/porch';

/** Tuning. */
export const BOB = {
  mass: 95, walk: 2.5, run: 5.7, carry: 3.6, mow: 2.2, accel: 22,
  grabReach: 1.9, windup: 0.42, lunge: 0.3, lungeSpeed: 7, catchR: 1.15, recover: 0.85,
  // grip: lots of mashing, progress drains fast, and he shakes the pig every few seconds
  escapeNeed: 24, escapeNeedMuddy: 14, shakeEvery: 2.2, shakeLoss: 4,
  slapChance: 0.3, slapWind: 0.35, slap: 0.3, slapReach: 1.75, taunt: 2.2,
  danceChance: 0.18, danceTime: 7,
  // a pig right next to him: now and then he just breaks into a dance (once per pig per `danceNearCool` s; in a chase
  // the chance is smaller, and the pig gets a moment to run)
  danceNear: 4, danceNearChance: 0.25, danceNearChase: 0.12, danceNearCool: 20, danceNearTime: 4.5,
  poiseWindow: 3, stagger: 100, knockdown: 160, ram: 60, punch: 34, staggerTime: 1.5, downTime: 3.4,
  cough: 3, loseSight: 3, search: 4, stamina: 14, pant: 2.6, fistGiveUp: 6,
  // hunting a pig he lost: suspicion drains slowly while it stays out of sight; he checks hiding spots near where
  // he lost it and recognises it (even acting natural) when it's this close
  huntDecay: 0.035, unseenDecay: 0.06, seenDecay: 0.12, huntSpots: 4, lookAround: 2.4, recognise: 9, huntMax: 45,
  // farm 5: grip on ice (× accel); hurrying across it (faster than iceSlip m/s) he goes down now and then (per second)
  ice: 0.14, iceSlip: 3.1, iceSlipRate: 0.9,
};

/**
 * Farm-wide alert (GDD "difficulty without killing the fun"): heat 0..100 rises with what he notices (spotting a pig,
 * getting hit, pranks, escapes) and drains when it's quiet. Level 0 routine · 1 wary (hears further, sees further,
 * hunts longer) · 2 alert (guard dog off the leash, pitchfork = longer grab, bear traps where he caught / lost pigs,
 * patrols at night instead of sleeping) · 3 furious (rock-salt shotgun: knock-back, no damage; runs faster).
 * The last 2 minutes of a round are at least level 2.
 */
export const ALERT = {
  at: [0, 22, 50, 80], drop: 8, decay: 0.7, hold: 7,
  hear: [1, 1.3, 1.45, 1.6], sight: [1, 1.08, 1.15, 1.22], sus: [1, 1.2, 1.35, 1.5], hunt: [1, 0.8, 0.65, 0.5], run: [1, 1, 1.06, 1.16],
  gain: { alarm: 22, suspect: 4, noise: 2, lost: 6, escaped: 10, caged: 4, cough: 6, splat: 5, down: 22, stagger: 9, prank: 10, loot: 6, trap: 6, gateOpen: 5, gateBroken: 14 },
  reach: 2.55, catchR: 1.4, catchAt: 1.15,                                                  // pitchfork (level 2+)
  gunMin: 3.2, gunMax: 14, gunAim: 0.8, gunShoot: 0.6, gunCool: 5.5, gunCone: Math.cos(0.27), gunPush: 11,   // shotgun (level 3)
  /** User: "almost never misses — soften it a tiny bit": the aim locks this long before the shot, a little wobble (rad),
   * and far shots (past `gunFar` m) can scatter wide (up to `gunFarMiss` at max range). */
  gunCommit: 0.2, gunWobble: 0.05, gunFar: 8, gunFarMiss: 0.3,
  /** HP a rock-salt hit costs a pig at point-blank (× the falloff; 3 close hits = the gulag). */
  gunDmg: 34,
  traps: 4, trapEvery: 25,
  /** Wary (1+): now and then he padlocks a gate that is only latched. */
  lockEvery: 18,
};
export type AlertGain = keyof typeof ALERT.gain;

/** How Bob sees, per activity. cos of the half view angle, range (m). */
const VIEW = {
  normal: { cos: Math.cos(1.05), range: 20 },
  busy: { cos: Math.cos(0.7), range: 13 },
  nap: { cos: 2, range: 0 },
  alert: { cos: Math.cos(1.25), range: 26 },
  flashlight: { cos: Math.cos(0.42), range: 16 },
  /** At night: a pig standing in a lit spot (farm 4's jack-o'-lanterns) is seen like by day. */
  lit: { cos: Math.cos(1.1), range: 24 },
  /** On the phone: facing the box on its post (glancing over his shoulder now and then). */
  phone: { cos: Math.cos(0.6), range: 12 },
  /** Behind his newspaper (the coffee break): sees nothing in front (only a pig right next to him). */
  paper: { cos: 2, range: 0 },
};
type View = keyof typeof VIEW;

export type ChorePhase = 'day' | 'evening' | 'night';
export interface Chore {
  id: string; at: [number, number]; look: [number, number]; anim: FarmerAnim; dur: number; view: View;
  phase?: ChorePhase;
}

type State = 'routine' | 'investigate' | 'suspect' | 'chase' | 'search' | 'windup' | 'lunge' | 'recover' | 'carry' | 'dust'
  | 'stagger' | 'down' | 'cough' | 'fist' | 'pant' | 'guard' | 'slapWind' | 'slap' | 'taunt' | 'dance' | 'shoo' | 'sleep' | 'off' | 'tidy'
  | 'aim' | 'shoot' | 'setTrap' | 'market' | 'away' | 'gate' | 'job' | 'loo' | 'inLoo' | 'phone' | 'onPhone' | 'toHammock' | 'hammock'
  | 'hot' | 'cool' | 'dunk';

/** A farm thing Bob fixes once he notices it (farm 4: a jack-o'-lantern that went out). Sources live in `G.jobs`. */
export interface BobJob {
  at: THREE.Vector3; look: THREE.Vector3; dur: number;
  /** HUD chip text key while he's on it. */
  activity: string;
  /** Still needs him (someone may have fixed / moved it meanwhile). */
  still(): boolean;
  done(): void;
  /** What he does right after (default: back to work). */
  then?: () => void;
  /** How close counts as there (m, default 0.7): music he can dance to from the doorway. */
  near?: number;
}

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const UP = THREE.Object3D.DEFAULT_UP;
/** Bob's spoken lines (the rest are grunts / groans). */
const LINES = new Set(['hey', 'grr', 'ha', 'hello', 'insult', 'win', 'bye', 'oops']);
const HALF = 0.55, RAD = 0.38, CENTER = HALF + RAD;   // capsule; body centre height above the feet

/** Body parts (real bodies, limp when knocked down): head, armL, armR, legL, legR. Model space, Bob faces +z. */
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const LIMBS: LimbDef[] = [
  { joint: V(0, 1.58, 0.02), center: V(0, 1.76, 0.03), shape: () => RAPIER.ColliderDesc.ball(0.25), mass: 6, limit: 0.7,
    flail: { x: 0.2, y: 0.4, z: 0, speed: 5, phase: 0 } },
  ...[1, -1].map((s, i): LimbDef => ({ joint: V(s * 0.38, 1.42, 0), center: V(s * 0.4, 1.12, 0), shape: () => RAPIER.ColliderDesc.capsule(0.2, 0.09),
    mass: 5, limit: 2.2, flail: { x: 1.1, y: 0, z: s * 0.9, speed: 9, phase: i * 2 } })),
  ...[1, -1].map((s, i): LimbDef => ({ joint: V(s * 0.16, 0.86, 0), center: V(s * 0.16, 0.46, 0.02), shape: () => RAPIER.ColliderDesc.capsule(0.28, 0.12),
    mass: 9, limit: 1.4, flail: { x: 0.6, y: 0, z: s * 0.25, speed: 7, phase: 1 + i * 2.5 } })),
];
/** Where he holds a pig he carries (by the scruff, at arm's length in front of the belly), body space. */
const CARRY_AT = V(0, 1.38 - CENTER, 0.8);

/**
 * Farmer Bob: daily routine of chores (Untitled Goose Game) on a clock — day chores, flashlight patrol in the evening,
 * sleeps in the house at night. Per-pig suspicion (only un-piggy behaviour counts), hears noises, chases,
 * grabs (windup + lunge, dodgeable) or slaps, carries the pig to the cage by the BBQ. Strong hits stack (poise) →
 * stagger / knock-down. Dances now and then, mows the lawn, chases wolves away.
 */
export class Farmer {
  kind = 'farmer' as const;
  body: RAPIER.RigidBody;
  collider!: RAPIER.Collider;
  visual = new FarmerVisual();
  synced: Synced;
  /** Head, arms and legs as real bodies (limp when he is knocked down) and the hand that holds a pig. */
  parts: Ragdoll;
  grip = new Grip();
  private vq = new THREE.Quaternion(); private tq = new THREE.Quaternion();
  private relQ = [0, 1, 2, 3, 4].map(() => new THREE.Quaternion());
  private handM = new THREE.Vector3(); private netHand = new THREE.Vector3();
  mass = BOB.mass; radius = RAD; heldBy = null;
  label = 'Bob';
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  state: State = 'routine';
  stateT = 0;
  /** Suspicion per pig 0..1 ("?" at 0.3, "!" at 1). */
  sus = new Map<Pig, number>();
  target: Pig | null = null;
  carrying: Pig | null = null;
  choreIdx = 0;
  doing = false;
  /** i18n key of what he's doing (HUD). */
  activity = 'chore.walk';
  mower: Mower;
  private choreUntil = 0;
  private path: THREE.Vector3[] = [];
  private pathGoal = new THREE.Vector3(1e9, 0, 0);
  private pathAt = -10;
  private lastSeen = new THREE.Vector3();
  private lastSeenT = 0;
  private lastVel = new THREE.Vector3();
  /** The pig he lost and is looking for (search state), the spots he checks, when each pig was last in sight. */
  hunt: Pig | null = null;
  private spots: THREE.Vector3[] = []; private spotIdx = 0; private lookUntil = 0; private lookStart = 0; private spotBy = 0;
  private seenAt = new Map<Pig, number>(); private seenSince = new Map<Pig, number>();
  /** Stolen loot he spotted lying around and is taking back (tidy state), whether it's in his hands. */
  tidyProp: Prop | null = null; heldProp: Prop | null = null; private tidyScan = 0;
  private tidySkip = new WeakMap<Prop, number>(); private netHolding = false;
  private searchAt = new THREE.Vector3();
  private noiseT = 0;
  private poise = 0; private poiseT = -10;
  private hitBy = new Map<unknown, number>();
  private usedClouds = new WeakSet<Cloud>();
  private chaseRun = 0;
  private stuckT = 0; private stuck = 0; private stuckRef = new THREE.Vector3();
  private side = new THREE.Vector3(); private sideUntil = 0;
  private lying = false;
  private stunUntil = 0;
  private lookYaw = 0;
  private yell = 0;
  private stepT = 0;
  private unreachableT = 0;
  private shakeT = 0; private shakeUntil = 0;
  private slapDone = false; private slapped: Pig[] = []; forceSlap = false;
  private danceUntil = 0;
  /** Dancing next to this pig (faces it); back to the chase afterwards. Per-pig "rolled the dice" times. */
  private danceFace: { pos: THREE.Vector3; out?: boolean } | null = null; private danceChase = false; private danceRoll = new WeakMap<Pig, number>();
  private shooWolf: Wolf | null = null;
  /** Wolves he already chased off (he doesn't keep shooing the same one). */
  private shooed = new WeakMap<Wolf, number>();
  private mowPath: THREE.Vector3[] = []; private mowIdx = 0; private riding = false;
  private flash: THREE.SpotLight;
  private sleepT = 0;
  /** Alert: heat 0..100 → level 0..3 (`floor` = the round's minimum, e.g. the last 2 minutes). */
  heat = 0; level = 0; floor = 0; private heatT = -10;
  private gunReady = 0;
  /** Where he caught / lost pigs (he sets bear traps there at alert 2+), the spot he's setting one at now. */
  private hotSpots: THREE.Vector3[] = []; private trapAt = new THREE.Vector3(); private trapNext = 0;
  /** Market day: he went this round already; where the dog barked at a pig while he was away (he checks it first). */
  private marketDone = false; private awayTip: THREE.Vector3 | null = null; private awayTipPig: Pig | null = null;
  /** The gate he's going to shut / repair / padlock, when he looks for gates next, when he padlocks the next one. */
  private gateJob: Gate | null = null; private gateNext = 0; private lockNext = 0;
  private gateSkip = new WeakMap<Gate, number>(); private gatePt = new THREE.Vector3();
  /** A farm job (relight a lantern…) he's on, when he looks for one next. */
  private job: BobJob | null = null; private jobNext = 0;
  /** Farm 5: following footprints in the snow (the investigate state's label + when he looks for the next trail). */
  private clueNext = 0; private tracking = false;
  /**
   * Toilet breaks (world/outhouse.ts): when the next one is due, the outhouse he's using, when he comes out, a noise /
   * knock he heard in there (he looks there when he's out), banging on a bolted / fallen-over door, stuck under it.
   */
  private looNext = looFirst(); loo: Outhouse | null = null; private looUntil = 0; private looHeard: THREE.Vector3 | null = null;
  private looBanging = false; private looBangStart = 0; private looBang = 0; private looStuck = false; private looHeave = false;
  /**
   * The phone (world/phone.ts): the call he already reacted to, when the call / his "Hello?" ends, when the line went
   * dead, his next bit of chatter, glances over his shoulder.
   */
  /**
   * The siesta (world/hammock.ts): the game hour he naps after, whether he had it this round, when he wakes up, a noise
   * that will wake him (groggy first), what he does once he's up after being flipped out; mud marks on his face (synced).
   */
  private napHour = NAP.hour + Math.random() * NAP.spread; private napped = false; private napUntil = 0; private napWake = 0;
  private napHeard: THREE.Vector3 | null = null; private afterStun: (() => void) | null = null; mudMarks = 0;
  private phoneCall = -1; private phoneUntil = 0; private phoneDeadT = 0; private phoneChat = 0; private phoneGlance = 0; private glanceT = -10; private glanceDir = 1;
  /**
   * The coffee break (world/porch.ts): his next sip, whether this sip reached his lips yet; after a spiked cup: what
   * was in it (1 hot sauce / 2 mud) and the spot by the pond where he dunks his head.
   */
  private sipNext = 0; private tasted = false; spitKind = 0; private coolAt = new THREE.Vector3(); private coolWater = new THREE.Vector3();
  /** Grumpy Bob: a little storm cloud over his head. */
  private moodCloud: THREE.Group; private moodDrops: THREE.Mesh[] = [];
  /** Test hook: freeze the brain and show this animation. */
  debugAnim: FarmerAnim | null = null;

  constructor(scene: THREE.Scene, at: THREE.Vector3, public nav: Nav, public chores: Chore[], public cage: Cage,
    public pigs: Pig[], public zones: { garden: Rect[]; lawn: Rect; door: THREE.Vector3; mowerAt: THREE.Vector3; roadGate: THREE.Vector3 }) {
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y + CENTER + 0.05, at.z)
      .lockRotations().setCanSleep(false).setCcdEnabled(true));
    this.setCollider(false);
    this.parts = new Ragdoll(this.body, LIMBS, at, (i, anchor, rest) => { anchor.copy(LIMBS[i].joint).setY(LIMBS[i].joint.y - CENTER); rest.identity(); });
    this.parts.flailK.ragdoll = 0.3; this.parts.toneK.ragdoll = 0.05;
    this.synced = new Synced(this.body);
    scene.add(this.visual.root);
    this.pos.copy(at);
    this.mower = new Mower(scene, zones.mowerAt, Math.PI / 2);
    // flashlight (evening patrol / woken up at night)
    this.flash = new THREE.SpotLight(0xfff2c8, 0, 24, 0.45, 0.45, 1.3);
    this.flash.position.set(-0.3, 1.25, 0.35);
    this.flash.target.position.set(0, 0, 9);
    this.visual.root.add(this.flash, this.flash.target);
    this.moodCloud = this.buildMoodCloud(); this.visual.root.add(this.moodCloud);
    G.farmer = this;
  }

  private setCollider(lying: boolean) {
    if (this.collider) { owners.delete(this.collider.handle); world.removeCollider(this.collider, false); }
    // knocked down (real ragdoll): the torso only (head + limbs are parts), belly = trampoline
    const d = lying ? RAPIER.ColliderDesc.capsule(0.12, 0.42).setTranslation(0, 1.15 - CENTER, 0.02).setFriction(0.8)
      .setRestitution(0.9).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
      : RAPIER.ColliderDesc.capsule(HALF, RAD).setFriction(0).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
    d.setMass(BOB.mass).setCollisionGroups(groups(L.FARMER));
    this.collider = world.createCollider(d, this.body);
    owners.set(this.collider.handle, this);
    this.lying = lying;
  }

  get now() { return G.time; }
  get forward() { return v3.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  /** Highest suspicion over all pigs (HUD). */
  get alarm() { let m = 0; for (const v of this.sus.values()) m = Math.max(m, v); return m; }
  get chasing() { return ['chase', 'windup', 'lunge', 'recover', 'fist', 'pant', 'slapWind', 'slap', 'aim', 'shoot'].includes(this.state); }
  /** What he carries around at this alert level (shown in his hand when no chore tool is). */
  get weapon(): '' | 'fork' | 'gun' { return this.level >= 3 ? 'gun' : this.level >= 2 ? 'fork' : ''; }
  get asleep() { return this.state === 'sleep' || this.state === 'off' || this.state === 'away' || this.state === 'inLoo'; }
  /** In the house asleep, off to the market or in the outhouse (not on the farm, but he'll be back). */
  private get gone() { return this.state === 'sleep' || this.state === 'away' || this.state === 'inLoo'; }
  private get gate() { return v1.copy(this.zones.roadGate); }
  get flashlightOn() { return G.night > 0.5 && !this.asleep && this.state !== 'down' && !this.dozing; }
  /** Dozing on a chore (the porch rocker): eyes shut, flashlight off — also at night. */
  private get dozing() { return this.state === 'routine' && this.doing && this.chores[this.choreIdx]?.view === 'nap'; }
  escapeNeed(p: Pig) { return ADMIN.easyEscape && p === G.localPig ? 1 : p.muddy > 0 ? BOB.escapeNeedMuddy : BOB.escapeNeed; }

  private go(s: State) {
    if (this.state === 'tidy' && s !== 'tidy') this.dropProp();
    if (s !== 'investigate') this.tracking = false;
    if (this.state === 'inLoo' && s !== 'inLoo' && this.loo) { this.loo.vacate(); this.loo = null; }
    if (this.state === 'onPhone' && s !== 'onPhone') { (G.phones as Phones | null)?.hangUp(); this.lookYaw = 0; }
    if (this.state === 'hammock' && s !== 'hammock') { (G.hammock as Hammock | null)?.climbOut(); this.body.setEnabled(true); this.parts.setEnabled(true); }
    this.state = s; this.stateT = this.now;
  }
  /** Day chores, evening flashlight round, bed at night — but on alert (2+) he keeps patrolling all night. */
  private phaseNow(): ChorePhase {
    const h = G.hour, p: ChorePhase = h >= 5.5 && h < 20 ? 'day' : h >= 20 && h < 22.5 ? 'evening' : 'night';
    return p === 'night' && this.level >= 2 ? 'evening' : p;
  }

  // ================================================================== alert level
  /** Something got him worked up (a named reason or raw heat). */
  raise(k: AlertGain | number) {
    if (this.state === 'off' || G.net === 'client') return;
    this.heat = Math.min(100, this.heat + (typeof k === 'number' ? k : ALERT.gain[k]) * (G.mod === 'grumpy' ? MOD.grumpy.heat : 1));
    this.heatT = this.now;
    this.updateLevel();
  }
  /** Round rule: never below this level (e.g. 2 in the last two minutes). */
  setFloor(l: number) { if (l !== this.floor) { this.floor = l; this.updateLevel(); } }
  /** Admin: jump straight to a level. */
  setAlert(l: number) { this.heat = l ? ALERT.at[l] + 5 : 0; this.heatT = this.now; this.updateLevel(); }
  private updateLevel() {
    let l = this.level;
    while (l < 3 && this.heat >= ALERT.at[l + 1]) l++;
    while (l > 0 && this.heat < ALERT.at[l] - ALERT.drop) l--;
    l = Math.max(l, this.floor);
    if (l === this.level) return;
    const up = l > this.level;
    this.level = l;
    G.events.push({ type: 'alert', why: String(l), text: up ? 'up' : 'down' });
    if (up && !this.asleep) this.voice(l >= 3 ? 'grr' : 'huh');
    if (l < 2) this.trapNext = 0;
  }
  /** Quiet = the heat drains (not while he chases, carries or hunts). */
  private coolDown(dt: number) {
    if (this.now - this.heatT < ALERT.hold || this.chasing || this.state === 'carry' || this.state === 'search') return;
    if (this.heat > 0) { this.heat = Math.max(0, this.heat - ALERT.decay * dt); this.updateLevel(); }
  }
  /** Remember a place where pigs get caught / slip away (bear traps go there at alert 2+). */
  private hot(p: THREE.Vector3) {
    const f = this.nav.nearestFree(p.x, p.z, 3); if (!f) return;
    const at = new THREE.Vector3(f.x, G.terrain.height(f.x, f.z), f.z);
    this.hotSpots = this.hotSpots.filter((h) => h.distanceTo(at) > 4);
    this.hotSpots.push(at);
    if (this.hotSpots.length > 8) this.hotSpots.shift();
  }

  // ================================================================== admin
  /** New round: drop whatever he holds, stand up, back to his routine at `at`. */
  resetRound(at: THREE.Vector3) {
    if (this.state === 'off') return;
    if (this.carrying) this.release(false);
    this.dropProp();
    this.stopRiding();
    if (this.lying) this.getUp();
    this.body.setTranslation({ x: at.x, y: at.y + CENTER + 0.05, z: at.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.vel.set(0, 0, 0);
    this.sus.clear(); this.target = null; this.hunt = null; this.path = []; this.doing = false;
    this.heat = 0; this.floor = 0; this.hotSpots = []; this.gunReady = 0; this.trapNext = 0;
    this.marketDone = false; this.awayTip = null; this.awayTipPig = null;
    this.gateJob = null; this.lockNext = 0;
    if (this.gone) { this.body.setEnabled(true); this.parts.setEnabled(true); this.visual.root.visible = true; }
    this.loo = null; this.looNext = this.now + looFirst(); this.looHeard = null;
    this.phoneCall = -1;
    if (this.state === 'hammock') { (G.hammock as Hammock | null)?.climbOut(); this.body.setEnabled(true); this.parts.setEnabled(true); }
    this.napped = false; this.napHour = NAP.hour + Math.random() * NAP.spread; this.napHeard = null; this.afterStun = null; this.setMud(0);
    if (this.level) { this.level = 0; G.events.push({ type: 'alert', why: '0', text: 'down' }); }
    this.parts.snap();
    this.go('routine');
  }
  setEnabled(on: boolean) {
    if (on === (this.state !== 'off')) return;
    if (!on) {
      if (this.carrying) this.release(false);
      this.dropProp();
      this.stopRiding();
      if (this.lying) this.getUp();
      this.go('off'); this.target = null;
      this.body.setEnabled(false); this.parts.setEnabled(false); this.visual.root.visible = false;
    } else {
      this.body.setEnabled(true); this.parts.setEnabled(true); this.visual.root.visible = true;
      this.body.setTranslation({ x: this.zones.door.x, y: this.zones.door.y + CENTER + 0.1, z: this.zones.door.z }, true);
      this.go('routine'); this.doing = false; this.path = [];
    }
  }
  forceDance() { if (this.calm()) { this.stopRiding(); this.doing = false; this.dance(BOB.danceTime); } }
  forceMow() { const i = this.chores.findIndex((c) => c.id === 'mow'); if (i >= 0 && this.calm()) { this.stopRiding(); this.choreIdx = i; this.doing = false; this.go('routine'); } }
  forceBed() { const i = this.chores.findIndex((c) => c.id === 'bed'); if (i >= 0 && this.calm()) { this.stopRiding(); this.choreIdx = i; this.doing = false; this.go('routine'); } }
  slapMe(p: Pig) { if (this.gone) this.wake(); this.forceSlap = true; this.stopRiding(); this.alarmed(p); }
  /** Admin: he loses sight of this pig and starts hunting for it. */
  loseMe(p: Pig) {
    if (this.state === 'off' || this.state === 'down') return;
    if (this.gone) this.wake();
    if (this.carrying) this.release(false);
    this.sus.set(p, 0.85); this.lastSeen.copy(p.pos); this.lastVel.copy(p.vel);
    this.startSearch(p.pos, p, BOB.huntSpots);
  }
  /** Was this pig in his sight a moment ago (host)? */
  sees(p: Pig) { return this.now - (this.seenAt.get(p) ?? -10) < 0.15; }
  /** Admin: a poise-breaking hit (real ragdoll knock-down). */
  knockDown() { if (this.gone) this.wake(); if (this.state !== 'off' && this.state !== 'down') this.hit(BOB.knockdown + 10, this.forward.clone()); }
  /** Admin: pick this pig up right now (tests the limp, dangling pig). */
  carryMe(p: Pig) { if (this.state === 'off' || this.state === 'down') return; if (this.gone) this.wake(); this.stopRiding(); this.pickUp(p); }
  private calm() { return ['routine', 'investigate', 'search', 'suspect', 'guard', 'dust', 'dance', 'tidy', 'setTrap', 'market', 'gate', 'job', 'loo', 'phone', 'onPhone', 'toHammock'].includes(this.state); }

  // ================================================================== fixed step
  preStep(dt: number) {
    this.control(dt);
    if (!this.asleep) { this.parts.setTone(this.lying ? 'ragdoll' : 'active'); this.parts.step(this.now); }
  }
  private control(dt: number) {
    this.synced.beforeStep();
    if (this.state === 'off') return;
    this.coolDown(dt);
    if (this.state === 'sleep') { this.sleepStep(dt); return; }
    if (this.state === 'away') { if (!marketHours()) this.wake(); return; }
    if (this.state === 'inLoo') { this.looStep(); return; }
    if (this.state === 'hammock') { this.napStep(); return; }
    const p = this.body.translation(); this.pos.set(p.x, p.y - CENTER, p.z);
    const lv = this.body.linvel(); this.vel.set(lv.x, lv.y, lv.z);
    if (p.y < -20) { const d = this.zones.door; this.body.setTranslation({ x: d.x, y: d.y + 3, z: d.z + 3 }, true); return; }
    this.yell = Math.max(0, this.yell - dt * 2);
    if (this.now - this.poiseT > BOB.poiseWindow) this.poise = Math.max(0, this.poise - 60 * dt);
    let want = 0;   // desired speed (set by states via moveTo)
    this.moveVel.set(0, 0, 0);
    if (this.debugAnim) { this.body.setLinvel({ x: 0, y: lv.y, z: 0 }, true); this.vel.set(0, lv.y, 0); return; }

    // stuns: cough / stagger / down end → resume
    if (this.stunUntil && this.now > this.stunUntil) {
      this.stunUntil = 0;
      if (this.lying) this.getUp();
      this.go(this.carrying ? 'carry' : this.target ? 'chase' : this.cage.pigs.length >= 2 ? 'guard' : 'routine');
      if (this.state === 'chase') this.lastSeenT = this.now;
      this.path = [];
      const then = this.afterStun; this.afterStun = null;
      if (then && this.state === 'routine') then();
    }
    if (this.state !== 'down' && this.state !== 'stagger' && this.state !== 'cough') this.checkClouds();
    if (!this.stunUntil) this.perceive(dt);
    if (!this.stunUntil) this.checkPhone();

    switch (this.state) {
      case 'routine': want = this.routine(dt); break;
      case 'guard': want = this.guard(dt); break;
      case 'investigate': {
        this.activity = this.tracking ? 'bob.tracks' : 'bob.heard';
        const d = this.moveTo(this.searchAt, BOB.walk, dt);
        want = BOB.walk;
        if (d < 1.2 || this.now - this.stateT > 15) this.startSearch(this.searchAt, this.hunt, this.hunt ? 3 : 2);
        break;
      }
      case 'search': want = this.search(dt); break;
      case 'suspect': {
        const t = this.target;
        if (!t) { this.backToWork(); break; }
        const unseen = this.now - (this.seenAt.get(t) ?? -10);
        if (unseen > 1.6) { this.startSearch(this.lastSeen, t, 3); break; }     // it ducked out of sight: go and look
        if (unseen < 0.2) { this.lastSeen.copy(t.pos); this.lastVel.copy(t.vel); }
        this.face(this.lastSeen, dt, 6);
        const d = Math.hypot(this.lastSeen.x - this.pos.x, this.lastSeen.z - this.pos.z);
        if (d > 5) { this.moveTo(this.lastSeen, BOB.walk * 0.6, dt); want = 1; }
        if ((this.sus.get(t) ?? 0) < 0.12) { this.voice('mutter'); this.backToWork(); }
        break;
      }
      case 'chase': want = this.chase(dt); break;
      case 'windup': {
        const t = this.target;
        if (t) this.face(t.pos, dt, 14);
        if (this.now - this.stateT > BOB.windup) { this.go('lunge'); G.audio.play('whoosh', { pos: this.pos, vol: 0.8, pitch: 0.6 }); }
        break;
      }
      case 'lunge': {
        const f = this.forward;
        this.moveVel.set(f.x * BOB.lungeSpeed, 0, f.z * BOB.lungeSpeed); want = -1;
        const caught = this.tryCatch();
        if (caught) this.pickUp(caught);
        else if (this.now - this.stateT > BOB.lunge) { this.go('recover'); this.voice('grr', 0.8); }
        break;
      }
      case 'slapWind': {
        const t = this.target;
        if (t) this.face(t.pos, dt, 16);
        if (this.now - this.stateT > BOB.slapWind) { this.go('slap'); this.slapDone = false; G.audio.play('whoosh', { pos: this.pos, vol: 1, pitch: 0.8 }); }
        break;
      }
      case 'slap':
        if (!this.slapDone && this.now - this.stateT > 0.08) { this.slapDone = true; this.slapHit(); }
        if (this.now - this.stateT > BOB.slap) {
          if (this.slapped.length) { this.go('taunt'); this.voice('ha', 0.8); } else { this.go('recover'); this.voice('grr', 0.8); }
        }
        break;
      case 'taunt':
        if (this.slapped[0]) this.face(this.slapped[0].pos, dt, 4);
        if (this.now - this.stateT > BOB.taunt) {
          for (const s of this.slapped) this.sus.set(s, 0.4);
          this.slapped = []; this.target = null; this.chaseRun = 0;
          this.backToWork();
        }
        break;
      case 'recover':
        if (this.now - this.stateT > BOB.recover) this.go(this.target ? 'chase' : 'routine');
        break;
      case 'carry': want = this.carry(dt); break;
      case 'dust':
        if (this.now - this.stateT > 1.4) { if (Math.random() < 0.5 && G.night < 0.5 && G.mod !== 'grumpy') this.dance(5); else this.backToWork(); }
        break;
      case 'dance':
        this.activity = 'bob.dance';
        if (this.danceFace && !this.danceFace.out) this.face(this.danceFace.pos, dt, 5);
        if (this.now > this.danceUntil) {
          const t = this.target;
          if (this.danceChase && t && !t.out && !t.cage && !t.heldBy) { this.lastSeenT = this.now; this.chaseRun = 0; this.go('chase'); this.path = []; this.voice('hey', 0.7); }
          else this.backToWork();
          this.danceFace = null; this.danceChase = false;
        }
        break;
      case 'shoo': want = this.shoo(dt); break;
      case 'tidy': want = this.tidy(dt); break;
      case 'aim': {   // rock-salt shotgun (alert 3): a clear wind-up you can dodge
        const t = this.target;
        if (t && this.now - this.stateT < ALERT.gunAim - ALERT.gunCommit) this.face(t.pos, dt, 9);   // the last moment: aim locked (dodge!)
        if (this.now - this.stateT > ALERT.gunAim) { this.fire(); this.go('shoot'); }
        break;
      }
      case 'shoot':
        if (this.now - this.stateT > ALERT.gunShoot) { this.lastSeenT = this.now; this.go(this.target ? 'chase' : 'routine'); }
        break;
      case 'setTrap': want = this.setTrap(dt); break;
      case 'gate': want = this.gateStep(dt); break;
      case 'job': want = this.jobStep(dt); break;
      case 'market': want = this.toMarket(dt); break;
      case 'loo': want = this.looWalk(dt); break;
      case 'phone': want = this.phoneWalk(dt); break;
      case 'onPhone': want = this.phoneStep(dt); break;
      case 'toHammock': want = this.napWalk(dt); break;
      case 'hot': this.hotStep(); break;
      case 'cool': want = this.coolStep(dt); break;
      case 'dunk': this.dunkStep(dt); break;
      case 'fist': {
        const t = this.target;
        if (t) this.face(t.pos, dt, 8);
        if (Math.random() < dt * 0.8) this.voice(Math.random() < 0.5 ? 'grr' : 'hey');
        if (this.now - this.stateT > 1.2) {
          if (t && this.reachable(t)) this.go('chase');
          else if (this.now - this.stateT > BOB.fistGiveUp) { this.giveUp(); }
        }
        break;
      }
      case 'pant':
        if (this.now - this.stateT > BOB.pant) { this.chaseRun = 0; this.go(this.target ? 'chase' : 'routine'); }
        break;
      case 'cough': this.moveVel.copy(this.forward).multiplyScalar(0.4); want = -1; break;
      case 'stagger': this.moveVel.copy(this.forward).multiplyScalar(-1.2); want = -1; break;
      case 'down': return;   // a real ragdoll: physics only
    }
    // apply velocity
    const target = want === 0 ? v1.set(0, 0, 0) : v1.copy(this.moveVel);
    const onIce = !!G.iceAt?.(this.pos.x, this.pos.z) && !this.riding;
    const dx = target.x - this.vel.x, dz = target.z - this.vel.z, dl = Math.hypot(dx, dz), mx = BOB.accel * dt * (onIce ? BOB.ice : 1);
    if (dl > mx) { this.vel.x += (dx / dl) * mx; this.vel.z += (dz / dl) * mx; } else { this.vel.x = target.x; this.vel.z = target.z; }
    this.body.setLinvel(this.vel, true);
    if (want !== 0 && !this.riding && !this.lying) this.stepUp(target);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.4 && this.state !== 'stagger' && this.state !== 'lunge') this.yaw = dampAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), this.riding ? 4 : 8, dt);
    this.body.setRotation(new THREE.Quaternion().setFromAxisAngle(UP, this.yaw), true);
    this.holdCarried(dt);
    this.holdProp(dt);
    if (this.riding) this.mower.ride(this.pos, this.yaw, sp, dt);
    // farm 5: in a hurry on the ice → whoops (feet up, flat on his back)
    if (onIce && sp > BOB.iceSlip && G.net !== 'client' && Math.random() < dt * BOB.iceSlipRate * (sp / BOB.iceSlip)) this.slip('ice');
    // footsteps
    if (sp > 0.8 && !this.lying && !this.riding) {
      this.stepT += dt * sp * (sp > 4 ? 0.62 : 0.85);
      if (this.stepT > 1) {
        this.stepT = 0;
        const snd = !G.snowy ? 'boot' : onIce ? 'icestep' : G.terrain.dirtAt(this.pos.x, this.pos.z) > 0.3 ? 'boot' : 'snowstep';
        G.audio.play(snd, { pos: this.pos, vol: sp > 4 ? 0.9 : 0.55, pitch: 0.85 });
      }
    }
  }
  private moveVel = new THREE.Vector3();
  /**
   * A low ledge in his way (a barn's raised floor at its door, a deck, a kerb ≤ 0.38 m): he steps up onto it. His
   * capsule can't climb one by itself (it just pushes against the edge) — the nav grid treats anything that low as
   * walkable, so without this he stood at a barn door forever (the record player, a running tap inside).
   */
  private stepUp(dir: THREE.Vector3) {
    const sp = Math.hypot(dir.x, dir.z); if (sp < 0.3) return;
    const fx = dir.x / sp, fz = dir.z / sp, reach = RAD + 0.22, feet = this.pos.y;
    const low = raycast(v3.set(this.pos.x, feet + 0.06, this.pos.z), v2.set(fx, 0, fz), reach, L.STATIC, this.body);
    if (!low || low.normal.y > 0.6) return;
    if (raycast(v3.set(this.pos.x, feet + 0.44, this.pos.z), v2.set(fx, 0, fz), reach + 0.1, L.STATIC, this.body)) return;   // a wall, not a step
    const top = raycast(v3.set(this.pos.x + fx * (low.dist + 0.12), feet + 0.44, this.pos.z + fz * (low.dist + 0.12)), v2.set(0, -1, 0), 0.5, L.STATIC, this.body);
    if (!top || top.normal.y < 0.7) return;
    const rise = 0.44 - top.dist;
    if (rise < 0.03 || rise > 0.38) return;
    const t = this.body.translation();
    this.body.setTranslation({ x: t.x + fx * 0.05, y: t.y + rise + 0.02, z: t.z + fz * 0.05 }, true);
  }

  postStep() {
    this.synced.capture();
    if (this.state === 'down' || this.asleep) return;
    // hard objects hitting him (thrown crates, pigs, pumpkins…)
    world.contactPairsWith(this.collider, (c) => {
      const o = owners.get(c.handle) as (Holdable & { synced?: Synced }) | undefined;
      if (!o || o === this.carrying || !o.synced || (o as any).heldBy) return;
      const ov = o.synced.preVel, rel = v2.copy(ov).sub(this.vel).length();
      // eggs / melons / pots thrown at him: SPLAT (a prank; he's furious but it barely hurts)
      const br = o as unknown as { def?: { fragile?: number; id?: string }; smash?: (how: string) => void; banked?: boolean };
      if (br.def?.fragile && rel > 2.5 && !br.banked) { br.smash?.('bob'); this.splatted(ov, br.def.id); return; }
      // a cheese wheel rolled into him (farm 3): bowled over like a skittle
      if ((br.def?.id === 'cheeseWheel' || br.def?.id === 'prizeCheese') && rel > 3.2) { this.cheesed(ov, br.def.id === 'prizeCheese'); return; }
      // a snowball rolled up big (farm 5)
      if (br.def?.id === 'snowboulder' && rel > 2.4) { this.snowballed(ov, o.radius); return; }
      if (rel < 6.5 || o.mass < 2) return;
      if ((this.hitBy.get(o) ?? -10) > this.now - 0.6) return;
      this.hitBy.set(o, this.now);
      this.hit(clamp((o.mass * rel) / 4, 6, 90), ov);
    });
  }

  // ================================================================== sleeping in the house
  private sleep() {
    this.stopRiding();
    this.go('sleep'); this.activity = 'bob.sleep';
    this.body.setEnabled(false); this.parts.setEnabled(false); this.visual.root.visible = false;
    this.sleepT = 0;
  }
  private wake(at?: THREE.Vector3) {
    if (!this.gone) return;
    if (this.state === 'inLoo') {   // out of the outhouse (admin / the dog barked): he goes to look
      this.exitLoo(false);
      if (at) { this.searchAt.copy(at); this.go('investigate'); this.voice('huh'); }
      return;
    }
    const back = this.state === 'away';
    const d = back ? this.gate.clone() : this.zones.door;
    this.body.setEnabled(true); this.parts.setEnabled(true); this.visual.root.visible = true;
    this.body.setTranslation({ x: d.x, y: d.y + CENTER + 0.1, z: d.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.pos.copy(d);
    this.doing = false; this.path = [];
    if (back) {   // home from the market: first he checks where the dog was barking
      G.events.push({ type: 'market', text: 'back' }); this.voice('hey', 0.8);
      G.fx.puff(v2.copy(d).setY(d.y + 0.4), { count: 14, color: 0xcbb48c, speed: 2, up: 0.6, life: 1.2, size: 1.2, alpha: 0.6 });
      const tip = at ?? this.awayTip;
      if (tip && this.awayTipPig) { this.sus.set(this.awayTipPig, 0.55); this.lastSeen.copy(tip); this.lastVel.set(0, 0, 0); this.startSearch(tip, this.awayTipPig, 3); }
      else this.go('routine');
      this.awayTip = null; this.awayTipPig = null;
      return;
    }
    if (at) { this.searchAt.copy(at); this.go('investigate'); this.voice('huh'); G.events.push({ type: 'bobWakes' }); }
    else { this.choreIdx = this.chores.findIndex((c) => (c.phase ?? 'day') === 'day'); this.go('routine'); this.voice('yawn', 0.7); }
  }
  private sleepStep(dt: number) {
    this.sleepT += dt;
    if (this.phaseNow() === 'day') { this.wake(); return; }
    if (Math.random() < dt * 0.3) G.audio.play('snore', { pos: this.zones.door, vol: 0.6, minGap: 2 });
    for (const n of G.noises) {
      if (n.t <= this.noiseT) continue;
      this.noiseT = n.t;
      if (this.sleepT < 3) continue;
      const d = Math.hypot(n.x - this.zones.door.x, n.z - this.zones.door.z);
      if (d < Math.min(30, n.radius * 0.9) * ALERT.hear[this.level] * modHear()) { this.wake(new THREE.Vector3(n.x, n.y, n.z)); return; }
    }
  }

  // ================================================================== perception
  private view(): View {
    if (this.dozing) return 'nap';
    if (G.night > 0.5 && this.state !== 'chase') return 'flashlight';
    if (this.state === 'routine' && this.doing) return this.sipping ? 'busy' : this.chores[this.choreIdx].view;
    if (this.state === 'hot' || this.state === 'dunk') return 'nap';   // eyes squeezed shut / head in the pond
    if (this.state === 'cool') return 'busy';
    if (this.state === 'dance' || ((this.state === 'setTrap' || this.state === 'gate' || this.state === 'job') && this.doing)) return 'busy';
    if (this.state === 'onPhone') return 'phone';
    if (this.state === 'setTrap' || this.state === 'gate' || this.state === 'job' || this.state === 'loo' || this.state === 'phone') return 'normal';
    if (this.state === 'routine' || this.state === 'dust' || this.state === 'carry') return 'normal';
    return 'alert';
  }

  /** How un-piggy is this pig right now (0 = just a pig). */
  private suspicious(p: Pig): number {
    if (p.out || p.cage || (p.heldBy && p.heldBy.kind !== 'trap')) return 0;
    if (ignored(p)) return 0;
    if (p.heldBy) return 1;                                    // squealing in one of his traps
    let w = 0;
    if (p.held) w = 1;
    if (p.standing) w = Math.max(w, 0.55);
    if (p.sprinting) w = Math.max(w, 0.3);
    if (p.smoking) w = Math.max(w, 0.5);                       // a pig smoking a cigarette is NOT normal
    if (p.buzz > 0.3) w = Math.max(w, 0.35);                   // chain modes: a giggling, swaying pig
    if (G.chain?.inShed(p.pos)) w = Math.max(w, 0.6);          // chain modes: a pig in his shed, at his machines
    if (p.mode === 'ragdoll' && p.vel.length() > 4) w = Math.max(w, 0.5);
    if (this.zones.garden.some((r) => p.pos.x > r.x0 && p.pos.x < r.x1 && p.pos.z > r.z0 && p.pos.z < r.z1)) w = Math.max(w, 0.4);
    if (this.cage.pigs.length && this.cage.contains(p.pos, 2.2)) w = Math.max(w, 0.9);
    if (p.mode === 'wallow' && p.input.wallow) w = 0;        // playing dead
    return w;
  }

  private eye = new THREE.Vector3();
  private seePt = new THREE.Vector3();
  /**
   * 0 = can't see it, else closeness 0..1. View cone + range (standing = seen further, mud = camouflage), then a sight
   * ray to the pig's back (its head when standing): buildings / solid fences / bale stacks block it, rail fences don't,
   * and soft cover (bushes, corn, wheat) hides what is inside or behind it. A pig hidden in a bush is found only when
   * he's right next to it, or when it moves (the bush shakes).
   */
  private canSee(p: { pos: THREE.Vector3; vel?: THREE.Vector3; standing?: boolean; muddy?: number }, v: { cos: number; range: number }) {
    this.eye.copy(this.pos).setY(this.pos.y + 1.7);
    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z, d = Math.hypot(dx, dz);
    let range = v.range * (p.standing ? 1.25 : 1) * ALERT.sight[this.level] * modSight();
    if ((p.muddy ?? 0) > 0) {   // mud = camouflage (farm 5: a snow-white coat on the snow)
      const bare = G.terrain.isBare(p.pos.x, p.pos.z);
      range *= G.snowy ? (bare ? 0.85 : 0.5) : bare ? 0.5 : 0.75;
    }
    if (G.night > 0.5 && this.state === 'chase') range *= 0.75;
    if (d > range && d > 2.2) return 0;
    if (d > 2.2) {   // inside 2.2 m he notices you anyway
      const look = this.yaw + this.lookYaw;
      const dot = (dx * Math.sin(look) + dz * Math.cos(look)) / Math.max(d, 0.01);
      if (dot < v.cos) return 0;
    }
    const to = sightPoint(p, this.seePt);
    const dir = v2.set(to.x - this.eye.x, to.y - this.eye.y, to.z - this.eye.z);
    const dist = dir.length(); dir.divideScalar(dist);
    const hit = raycast(this.eye, dir, dist, L.STATIC, undefined, (c) => !SEE_THROUGH.has(c.handle));
    if (hit && hit.dist < dist - 0.4) return 0;
    const inside = G.cover.at(to);
    const moving = p.vel ? Math.hypot(p.vel.x, p.vel.z) > 1.5 : false;
    if (inside && d > (moving ? 5 : 1.7)) return 0;                 // hiding in a bush / the corn
    if (!inside && d > 1.7 && G.cover.blocks(this.eye, to)) return 0; // behind one
    return 1 - clamp(d / Math.max(range, 1), 0, 1);
  }

  private perceive(dt: number) {
    const v = VIEW[this.view()];
    const looking = this.state === 'search' || this.state === 'investigate';
    for (const p of this.pigs) {
      let s = this.sus.get(p) ?? 0;
      const w = this.suspicious(p);
      // at night a pig in a lit spot (jack-o'-lanterns) is seen like by day, not only in his flashlight's beam
      const vp = v === VIEW.flashlight && G.litAt?.(p.pos.x, p.pos.z) ? VIEW.lit : v;
      const near = v.range > 0 && !p.out && !p.cage && (!p.heldBy || p.heldBy.kind === 'trap') ? this.canSee(p, vp) : 0;
      const seen = near > 0;
      if (seen) {
        if (this.now - (this.seenAt.get(p) ?? -10) > 0.1) this.seenSince.set(p, this.now);   // a new glimpse
        this.seenAt.set(p, this.now);
      }
      if ((p === this.target || p === this.hunt) && seen) { this.lastSeen.copy(p.pos); this.lastVel.copy(p.vel); this.lastSeenT = this.now; }
      // only un-piggy behaviour he SEES raises it; out of sight it drains slowly (slowest for the pig he's hunting)
      if (w > 0 && seen) s += w * (0.25 + 1.3 * near * near) * dt * (looking ? 1.5 : 1) * ALERT.sus[this.level] * (ADMIN.chill ? 0.6 : 1);
      else if (p !== this.target || !this.chasing) {
        // hunting it: no let-up until he has reached the place he lost it
        const huntK = this.state === 'search' && this.spotIdx === 0 && !this.lookUntil ? 0 : BOB.huntDecay * ALERT.hunt[this.level];
        s -= (seen ? BOB.seenDecay : p === this.hunt ? huntK : BOB.unseenDecay) * dt;
      }
      s = clamp(s, 0, 1);
      if (p.out || p.cage) s = 0;
      this.sus.set(p, s);
      // reactions
      if (!this.calm() || this.state === 'shoo' || !seen) continue;
      if (s >= 1) { this.alarmed(p); return; }
      if (['routine', 'investigate', 'search', 'suspect', 'guard'].includes(this.state) && this.danceNear(p, false)) return;
      // the pig he's looking for: recognised up close even when it acts natural
      if (p === this.hunt && s > 0.25 && this.now - (this.seenSince.get(p) ?? this.now) > 0.35
        && Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < BOB.recognise) { this.alarmed(p); return; }
      if (s >= 0.3 && w > 0 && this.state !== 'suspect') {
        this.stopRiding();
        this.target = p; this.go('suspect'); this.voice('huh'); this.yell = 0.5; this.raise('suspect');
      }
    }
    // wolves on his farm: chase them off
    if (this.calm() && this.state !== 'suspect' && !this.carrying) {
      for (const w of G.wolves as Wolf[]) {
        if (!w.active || w.state === 'flee' || w.state === 'leave' || (this.shooed.get(w) ?? -99) > this.now - 15) continue;
        if (Math.hypot(w.pos.x - this.pos.x, w.pos.z - this.pos.z) > 18 || !this.canSee(w, VIEW.alert)) continue;
        this.stopRiding(); this.doing = false;
        this.shooWolf = w; this.go('shoo'); this.voice('hey'); this.path = [];
        return;
      }
    }
    // stolen loot lying around where it doesn't belong: he takes it back
    if (this.state === 'routine' && !this.carrying && this.now > this.tidyScan) {
      this.tidyScan = this.now + 0.5;
      const p = this.spotLoot(v);
      if (p) { this.stopRiding(); this.doing = false; this.tidyProp = p; this.path = []; this.go('tidy'); this.voice('huh'); this.raise('loot'); return; }
    }
    // gates: one left open / smashed that he sees = he goes and deals with it; wary = he padlocks latched ones
    if (this.state === 'routine' && !this.carrying && this.now > this.gateNext) {
      this.gateNext = this.now + 0.6;
      const g = this.spotGate(v);
      if (g) { this.startGate(g); return; }
    }
    // farm jobs (a jack-o'-lantern that went out…): he goes and fixes what he notices
    if (this.state === 'routine' && !this.carrying && this.now > this.jobNext && G.jobs.length) {
      this.jobNext = this.now + 0.7;
      for (const src of G.jobs) {
        const j = src.spot(this) as BobJob | null;
        if (!j) continue;
        this.stopRiding(); this.doing = false; this.path = [];
        this.job = j; this.go('job'); this.voice('huh', 0.7);
        return;
      }
    }
    // clues (farm 5: fresh footprints in the snow): he follows the trail to where it ends
    if (this.state === 'routine' && !this.carrying && this.now > this.clueNext && G.clues.length) {
      this.clueNext = this.now + 0.8;
      for (const src of G.clues) {
        const at = src.spot(this);
        if (!at) continue;
        this.stopRiding(); this.doing = false; this.path = [];
        this.searchAt.copy(at); this.go('investigate'); this.tracking = true;
        this.voice('huh', 0.8); this.raise('noise');
        G.events.push({ type: 'bobTracks' });
        return;
      }
    }
    // noises
    if (this.state === 'routine' || this.state === 'search' || this.state === 'guard' || this.state === 'dance' || this.state === 'onPhone') {
      for (const n of G.noises) {
        if (n.t <= this.noiseT) continue;
        this.noiseT = n.t;
        const d = Math.hypot(n.x - this.pos.x, n.z - this.pos.z);
        const vw = this.view(), asleep = vw === 'nap';
        const r = this.state === 'onPhone' ? Math.min(n.radius, PHONE.hear) : vw === 'paper' ? Math.min(n.radius, COFFEE.hear)   // chatting / reading: only what's close
          : n.radius * (asleep ? 0.6 : this.riding ? 0.5 : 1);
        if (d > r * ALERT.hear[this.level] * modHear()) continue;
        this.stopRiding();
        this.searchAt.set(n.x, n.y, n.z);
        this.voice(asleep ? 'yawn' : 'huh');
        this.doing = false;
        this.go('investigate'); this.path = []; this.raise('noise'); this.tracking = false;
        break;
      }
    } else if (G.noises.length) this.noiseT = G.noises[G.noises.length - 1].t;
  }

  private alarmed(p: Pig) {
    this.stopRiding();
    this.hunt = null; this.lookYaw = 0;
    this.target = p; this.sus.set(p, 1);
    this.lastSeen.copy(p.pos); this.lastSeenT = this.now;
    this.doing = false;
    this.go('chase'); this.path = [];
    this.voice('hey'); this.yell = 1;
    this.raise('alarm');
    G.events.push({ type: 'alarm', who: p });
  }

  private giveUp() {
    if (this.target) this.sus.set(this.target, 0.45);
    this.target = null;
    this.voice('mutter');
    this.backToWork();
  }

  // ================================================================== searching (lost a pig / heard something)
  /** Look around `at` and a few hiding spots near it (bushes, corn, behind things, ahead of where the pig ran). */
  private startSearch(at: THREE.Vector3, hunt: Pig | null, n: number) {
    this.stopRiding(); this.doing = false;
    this.hunt = hunt; this.target = null;
    this.spots = [at.clone(), ...this.findSpots(at, hunt ? this.lastVel : null, n - 1)];
    this.spotIdx = 0; this.lookUntil = 0; this.path = []; this.spotBy = this.spotDeadline(this.spots[0], hunt);
    this.go('search');
  }

  private findSpots(c: THREE.Vector3, dir: THREE.Vector3 | null, n: number): THREE.Vector3[] {
    const cands: { p: THREE.Vector3; score: number }[] = [];
    const sp = dir ? Math.hypot(dir.x, dir.z) : 0;
    const fx = sp > 0.5 ? dir!.x / sp : 0, fz = sp > 0.5 ? dir!.z / sp : 0;
    const eye = v1.copy(this.pos).setY(this.pos.y + 1.7);
    const add = (x: number, z: number, bonus: number) => {
      const y = G.terrain.height(x, z);
      const pt = new THREE.Vector3(x, y, z), probe = v2.set(x, y + 0.66, z);
      let score = bonus + Math.random() * 0.6;
      if (G.cover.at(probe)) score += 2.2;
      else {
        const dir2 = v3.copy(probe).sub(eye); const len = dir2.length(); dir2.divideScalar(len);
        const hit = raycast(eye, dir2, len, L.STATIC, undefined, (k) => !SEE_THROUGH.has(k.handle));
        if ((hit && hit.dist < len - 0.4) || G.cover.blocks(eye, probe)) score += 1.4;   // out of his sight from here
      }
      const ox = x - c.x, oz = z - c.z, od = Math.hypot(ox, oz) || 1;
      score += ((ox * fx + oz * fz) / od) * 1.3;                                          // the way it was running
      cands.push({ p: pt, score });
    };
    // soft cover nearby (he pokes into bushes)
    for (const cv of G.cover.list) {
      const tx = cv.rect ? clamp(c.x, cv.rect.x0 + 1.2, cv.rect.x1 - 1.2) : cv.x, tz = cv.rect ? clamp(c.z, cv.rect.z0 + 1.2, cv.rect.z1 - 1.2) : cv.z;
      const d = Math.hypot(tx - c.x, tz - c.z);
      if (d > 2 && d < 13) add(tx, tz, 0.4);
    }
    // rings around the spot
    for (const r of [4.5, 8.5]) for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + r;
      const f = this.nav.nearestFree(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, 2);
      if (f) add(f.x, f.z, 0);
    }
    cands.sort((a, b) => b.score - a.score);
    const out: THREE.Vector3[] = [];
    for (const k of cands) {
      if (out.length >= n) break;
      if (out.every((o) => o.distanceTo(k.p) > 4) && k.p.distanceTo(c) > 2.5) out.push(k.p);
    }
    // visit them nearest-first from where he lost it
    const ordered: THREE.Vector3[] = []; let from = c;
    while (out.length) {
      let bi = 0; for (let i = 1; i < out.length; i++) if (out[i].distanceTo(from) < out[bi].distanceTo(from)) bi = i;
      from = out.splice(bi, 1)[0]; ordered.push(from);
    }
    return ordered;
  }

  private spotDeadline(p: THREE.Vector3 | undefined, hunt: Pig | null) {
    return this.now + 3 + (p ? Math.hypot(p.x - this.pos.x, p.z - this.pos.z) / (hunt ? BOB.walk * 1.35 : BOB.walk) * 1.4 : 0);
  }
  /** Walk to each spot, look around there; give up when suspicion has drained (or out of spots / time). */
  private search(dt: number) {
    const h = this.hunt;
    this.activity = h ? 'bob.search' : 'bob.heard';
    const over = h ? (this.sus.get(h) ?? 0) < 0.3 || h.out || !!h.cage || this.now - this.stateT > BOB.huntMax * (1 + this.level * 0.25) : this.now - this.stateT > 30;
    const spot = this.spots[this.spotIdx];
    if (!spot || over) {
      if (h) G.events.push({ type: 'bobGaveUp', who: h });
      this.voice('mutter'); this.backToWork();
      return 0;
    }
    if (this.lookUntil) {                                    // looking around (his view sweeps left / right)
      this.lookYaw = Math.sin((this.now - this.lookStart) * 2.4) * 1.05;
      if (this.now > this.lookUntil) { this.lookUntil = 0; this.lookYaw = 0; this.spotIdx++; this.path = []; this.spotBy = this.spotDeadline(this.spots[this.spotIdx], h); }
      return 0;
    }
    const speed = h ? BOB.walk * 1.35 : BOB.walk;
    const d = this.moveTo(spot, speed, dt);
    if (d < 1 || this.now > this.spotBy || (d < 2.5 && this.stuck >= 2)) {
      this.stuck = 0; this.lookStart = this.now; this.lookUntil = this.now + (h ? BOB.lookAround : BOB.lookAround * 0.8);
      if (Math.random() < 0.5) this.voice('huh', 0.6);
    }
    return speed;
  }

  // ================================================================== tidying up (M5: stolen loot goes back)
  /** Valuable loot in his sight that lies far from where it belongs (not in a pig's mouth, not hidden in a bush). */
  private spotLoot(v: { cos: number; range: number }): Prop | null {
    let best: Prop | null = null, bd = 16;
    for (const h of G.holdables) {
      if (h.kind !== 'prop') continue;
      const pr = h as unknown as Prop;
      if (pr.value < 15 || pr.banked || pr.heldBy || pr.mass > 60 || (this.tidySkip.get(pr) ?? -1) > this.now) continue;   // not the giant pumpkin
      const p = pr.synced.currP, d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
      if (d > bd || pr.synced.preVel.lengthSq() > 0.4 || pr.homeDist() < 5) continue;
      if (this.canSee({ pos: v3.set(p.x, p.y - 0.25, p.z) }, v) <= 0) continue;
      best = pr; bd = d;
    }
    return best;
  }

  private tidy(dt: number) {
    const pr = this.tidyProp;
    this.activity = 'bob.tidy';
    if (!pr || pr.banked || (pr.heldBy && pr.heldBy !== this) || this.now - this.stateT > 40) { this.backToWork(); return 0; }
    if (!this.heldProp) {
      const p = pr.synced.currP;
      const d = this.moveTo(v2.set(p.x, p.y, p.z), BOB.walk * 1.2, dt);
      if (d < 1.4) {
        this.heldProp = pr; pr.heldBy = this;
        ignorePair(this.body, pr.body, true);
        this.grip.attach(pr.body, v1.set(p.x, p.y, p.z), new THREE.Vector3(0, 0.05, 0));
        this.voice('mutter');
      } else if (this.stuck >= 3) { this.tidySkip.set(pr, this.now + 60); this.backToWork(); }
      return BOB.walk * 1.2;
    }
    const home = pr.homePos;
    const d = this.moveTo(home, BOB.walk, dt);
    if (d < 1.3 || (d < 2.6 && this.stuck >= 2)) {
      this.dropProp(true);
      G.events.push({ type: 'tidied', text: pr.label });
      this.backToWork();
      return 0;
    }
    return BOB.walk;
  }

  /** Let go of the loot he carries (home = put it back neatly where it belongs). */
  private dropProp(home = false) {
    const pr = this.heldProp;
    this.tidyProp = null;
    if (!pr) return;
    this.heldProp = null;
    this.grip.detach();
    ignorePair(this.body, pr.body, false);
    pr.heldBy = null;
    if (home) pr.putHome();
    else this.tidySkip.set(pr, this.now + 20);   // knocked out of his hands: leave it a while
  }

  private holdProp(dt: number) {
    const pr = this.heldProp; if (!pr) return;
    const T = v1.copy(CARRY_AT).applyAxisAngle(UP, this.yaw).add(this.pos).setY(this.pos.y + CENTER + CARRY_AT.y - 0.15);
    this.grip.drive(T, this.body, pr.mass + 2, dt, { up: 4000, side: 4000, kp: 16, react: 0, g: 20 });
    if (this.grip.strain > 2.5) { pr.body.setTranslation(T, true); pr.body.setLinvel(this.vel, true); this.grip.attach(pr.body, T); }
  }

  private backToWork() {
    this.target = null; this.hunt = null; this.lookYaw = 0; this.shooWolf = null;
    this.go(this.cage.pigs.length >= 2 ? 'guard' : 'routine');
    this.path = [];
  }

  private dance(secs: number) {
    this.danceFace = null; this.danceChase = false;
    this.go('dance'); this.danceUntil = this.now + secs;
    G.audio.play('banjo', { pos: this.pos, vol: 0.8 });
    this.voice('ha', 0.6);
  }

  /**
   * A pig right next to him: roll the dice once per pig (every `danceNearCool` s) — sometimes he just dances at it.
   * In a chase it's rarer, and he picks the chase up again afterwards (the pig gets a few seconds' head start).
   */
  private danceNear(p: Pig, chase: boolean) {
    if (G.mod === 'grumpy' || this.carrying || this.now < (this.danceRoll.get(p) ?? -99)) return false;
    if (Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) > (chase ? 3.2 : BOB.danceNear)) return false;
    this.danceRoll.set(p, this.now + BOB.danceNearCool);
    if (Math.random() >= (this.forceDanceNear ? 1 : chase ? BOB.danceNearChase : BOB.danceNearChance)) return false;
    this.forceDanceNear = false;
    this.stopRiding(); this.doing = false; this.path = [];
    this.dance(BOB.danceNearTime);
    this.danceFace = p; this.danceChase = chase;
    G.events.push({ type: 'bobDance', who: p });
    return true;
  }
  /** Admin: the next pig he meets up close gets a dance for sure. */
  forceDanceNear = false;
  /** A record playing (interiors' gramophone): he dances `secs` facing it, blind, then back to work. */
  danceFor(secs: number, at?: THREE.Vector3) {
    if (G.mod === 'grumpy') { this.backToWork(); return; }
    this.dance(secs);
    if (at) this.danceFace = { pos: at.clone() };
  }
  danceSoon() { this.forceDanceNear = true; this.danceRoll = new WeakMap(); }

  // ================================================================== routine (clock-driven)
  private routine(dt: number) {
    if (marketHours() && !this.marketDone && !this.carrying) { this.stopRiding(); this.doing = false; this.path = []; this.go('market'); this.voice('mutter', 0.6); return 0; }
    if (this.wantTrap()) { this.stopRiding(); this.doing = false; this.path = []; this.go('setTrap'); this.voice('mutter'); return 0; }
    const phase = this.phaseNow();
    let c = this.chores[this.choreIdx];
    if ((c.phase ?? 'day') !== phase && !(this.doing && c.id === 'mow')) {
      this.stopRiding();
      this.choreIdx = this.chores.findIndex((k) => (k.phase ?? 'day') === phase);
      this.doing = false; this.path = [];
      c = this.chores[this.choreIdx];
    }
    this.activity = 'chore.' + c.id;
    if (c.id === 'mow') return this.mowChore(c, dt);
    if (!this.doing) {
      const goal = v2.set(c.at[0], 0, c.at[1]);
      const d = this.moveTo(goal, BOB.walk, dt);
      if (d < 0.5 || (d < 2.2 && this.stuck >= 2)) {
        this.stuck = 0;
        if (c.id === 'bed') { this.sleep(); return 0; }
        this.doing = true; this.choreUntil = this.now + c.dur;
      }
      return BOB.walk;
    }
    this.face(v2.set(c.look[0], 0, c.look[1]), dt, 4);
    if (c.anim === 'look') this.lookYaw = Math.sin((this.now - this.choreUntil + c.dur) * 1.6) * 0.75;
    if (c.anim === 'nap' && Math.random() < dt * 0.25) this.voice('snore', 0.5);
    if (c.id === 'paper' && G.porch) { this.coffeeStep(); if (this.state !== 'routine' || !this.doing) return 0; }
    if (this.now > this.choreUntil && !this.sipping) this.nextChore();
    return 0;
  }

  // ================================================================== coffee break (world/porch.ts)
  /** The mug is at his lips right now (the paper is down: he sees). */
  get sipping() { return this.state === 'routine' && this.doing && (G.porch as Porch | null)?.phase === 2; }
  /** Reading the paper on the porch: a sip every few seconds — if the mug is still there, and if it's still just coffee. */
  private coffeeStep() {
    const pc = G.porch as Porch;
    if (!pc.phase) { pc.begin(); this.sipNext = this.now + 1.5 + Math.random() * 2; G.events.push({ type: 'bobCoffee' }); }
    if (this.sipSoon && pc.phase === 1) { this.sipNext = this.now; this.sipSoon = false; }
    if (pc.phase === 1 && this.now > this.sipNext) {
      if (!pc.mugHome()) { this.mugGone(pc); return; }
      pc.startSip(); this.tasted = false;
    } else if (pc.phase === 2) {
      const k = this.now - pc.sipT0;
      if (!this.tasted && k > COFFEE.taste) {
        this.tasted = true;
        if (pc.spiked && pc.full) { this.spitTake(pc); return; }
        G.audio.play('drink', { pos: v1.copy(this.pos).setY(this.pos.y + 1.3), vol: 0.45, pitch: 0.75 });
      }
      if (k > COFFEE.sip) { pc.endSip(); this.sipNext = this.now + COFFEE.sipEvery[0] + Math.random() * (COFFEE.sipEvery[1] - COFFEE.sipEvery[0]); }
    }
  }
  /** He reaches for his mug — gone! Up he gets and looks around the porch. */
  private mugGone(pc: Porch) {
    pc.endBreak();
    this.voice('huh'); this.raise('loot');
    G.events.push({ type: 'mugGone' });
    this.lookYaw = 0;
    this.startSearch(pc.top, null, 3);
  }
  /** Spiked: he spits it all out, the mug flies — hot sauce = fire breath, hopping, then off to dunk his head in the pond. */
  private spitTake(pc: Porch) {
    const f = this.forward.clone();
    const kind = pc.spit(f);
    this.spitKind = kind;
    const m = v1.copy(this.pos).setY(this.pos.y + 1.25).addScaledVector(f, 0.35);
    G.fx.bits(m, { count: 28, color: kind === 1 ? 0x9a3a1e : 0x6b4a2b, spread: 0.06, speed: 4.2, up: 0.8, grav: 9, life: 0.7, size: 0.06, grow: 0, alpha: 1, dir: f });
    G.audio.play('splash', { pos: m, vol: 0.7, pitch: 1.7 });
    if (kind === 1) { G.audio.play('fire', { pos: m, vol: 1 }); this.voice('oof', 1); } else this.voice('oops', 1);
    this.doing = false; this.lookYaw = 0; this.path = [];
    this.go('hot'); this.activity = kind === 1 ? 'bob.hot' : 'bob.yuck';
    this.raise('prank');
    G.events.push({ type: 'coffeeSpit', why: kind === 1 ? 'hot' : 'mud' });
  }
  /** Hopping about, fanning his mouth (fire breath) — then to the pond; mud: spitting, wiping his tongue — then he hunts. */
  private hotStep() {
    this.activity = this.spitKind === 1 ? 'bob.hot' : 'bob.yuck';
    if (this.now - this.stateT < (this.spitKind === 1 ? COFFEE.hotTime : COFFEE.mudTime)) return;
    const w = G.places?.pond;
    if (this.spitKind !== 1 || !w) { this.afterCoffee(); return; }
    // the nearest water: the pond's edge or a trough
    const dx = this.pos.x - w.x, dz = this.pos.z - w.z, d = Math.max(0.1, Math.hypot(dx, dz));
    let x = w.x + (dx / d) * (w.r + 0.7), z = w.z + (dz / d) * (w.r + 0.7);
    this.coolWater.set(w.x, 0, w.z);
    for (const tr of (G.porch as Porch | null)?.troughs ?? []) {
      const sx = tr.x + Math.sin(tr.yaw) * 0.9, sz = tr.z + Math.cos(tr.yaw) * 0.9;   // stand at its long side
      if (Math.hypot(sx - this.pos.x, sz - this.pos.z) < Math.hypot(x - this.pos.x, z - this.pos.z)) { x = sx; z = sz; this.coolWater.set(tr.x, 0, tr.z); }
    }
    const fr = this.nav.nearestFree(x, z, 4) ?? { x, z };
    this.coolAt.set(fr.x, G.terrain.height(fr.x, fr.z), fr.z);
    this.go('cool'); this.path = [];
    this.voice('oof', 0.8);
  }
  private coolStep(dt: number) {
    this.activity = 'bob.cool';
    const d = this.moveTo(this.coolAt, BOB.run, dt);
    if (d < 0.9 || (d < 2.5 && this.stuck >= 2) || this.now - this.stateT > 20) {
      this.stuck = 0; this.go('dunk');
      G.audio.play(G.snowy ? 'snowhit' : 'splash', { pos: this.coolAt, vol: 0.9, pitch: 0.9 });
      G.audio.play('hiss', { pos: this.coolAt, vol: 0.8 });
      return 0;
    }
    return BOB.run;
  }
  private dunkStep(dt: number) {
    this.activity = 'bob.cool';
    this.face(this.coolWater, dt, 6);
    if (this.now - this.stateT > COFFEE.dunk) {
      G.audio.play(G.snowy ? 'snowhit' : 'splash', { pos: this.pos, vol: 0.8, pitch: 1.2 });
      this.afterCoffee();
    }
  }
  /** Furious: back to the porch to find whoever did it. */
  private afterCoffee() {
    const pc = G.porch as Porch | null;
    this.voice('grr');
    this.startSearch(pc ? pc.top : this.pos, null, 3);
  }
  private nextChore() {
    const phase = this.phaseNow();
    this.doing = false; this.path = []; this.lookYaw = 0;
    const n = this.chores.length;
    for (let k = 1; k <= n; k++) { const i = (this.choreIdx + k) % n; if ((this.chores[i].phase ?? 'day') === phase) { this.choreIdx = i; break; } }
    // nature calls: between two chores, off to the outhouse (a breathing window for the pigs)
    if (phase !== 'night' && this.now > this.looNext && !this.carrying && !marketHours()) {
      const o = this.looPick();
      if (o) { this.loo = o; this.go('loo'); this.voice('mutter', 0.6); G.events.push({ type: 'bobLoo' }); return; }
      this.looNext = this.now + 20;
    }
    // after lunch: a nap in the hammock (once a round)
    if (phase === 'day' && !this.napped && G.hour >= this.napHour && !this.carrying && (G.hammock as Hammock | null)?.usable) {
      this.napped = true; this.go('toHammock'); this.voice('yawn', 0.8); G.events.push({ type: 'bobNap' }); return;
    }
    if (phase === 'day' && G.mod !== 'grumpy' && Math.random() < BOB.danceChance) this.dance(BOB.danceTime);
    else if (Math.random() < 0.4) this.voice('mutter', 0.5);
  }

  /** Lawn mowing: walk to the mower, ride serpentine rows over the lawn, park. */
  private mowChore(c: Chore, dt: number) {
    if (!this.doing) {
      const d = this.moveTo(this.mower.pos, BOB.walk, dt);
      if (d < 1.3 || (d < 2.5 && this.stuck >= 2)) {
        this.stuck = 0;
        this.mower.mount(this.visual.root); this.riding = true;
        this.mowPath = Mower.lawnPath(this.nav, this.zones.lawn); this.mowIdx = 0;
        this.doing = true; this.choreUntil = this.now + c.dur;
      }
      return BOB.walk;
    }
    const wp = this.mowPath[this.mowIdx];
    if (!wp || this.now > this.choreUntil) { this.stopRiding(); this.nextChore(); return 0; }
    if (this.moveTo(wp, BOB.mow, dt) < 0.9) { this.mowIdx++; this.path = []; }
    return BOB.mow;
  }
  private stopRiding() {
    if (!this.riding) return;
    this.riding = false;
    this.mower.dismount(this.pos, this.yaw);
    if (this.state === 'routine' && this.chores[this.choreIdx]?.id === 'mow') this.doing = false;
  }

  /** Two or more pigs caged: Bob stands by the grill with his eyes open. */
  private guard(dt: number) {
    this.activity = 'chore.guard';
    if (this.cage.pigs.length < 2) { this.go('routine'); return 0; }
    const spot = v2.copy(this.cage.front).addScaledVector(v3.copy(this.cage.front).sub(this.cage.center).setY(0).normalize(), 1.5);
    const d = this.moveTo(spot, BOB.walk, dt);
    if (d < 0.6) { this.lookYaw = Math.sin(this.now * 0.6) * 0.9; return 0; }
    return BOB.walk;
  }

  private shoo(dt: number) {
    const w = this.shooWolf;
    this.activity = 'bob.shoo';
    if (!w || !w.active || w.state === 'flee' || w.state === 'leave' || this.now - this.stateT > 10) { if (w) this.shooed.set(w, this.now); this.backToWork(); return 0; }
    const d = this.moveTo(w.pos, BOB.run * 0.9, dt, 0.5);
    if (Math.random() < dt * 0.7) this.voice('hey');
    if (d < 4.5) { w.scare(); this.shooed.set(w, this.now); this.go('fist'); this.target = null; this.stateT = this.now - BOB.fistGiveUp + 1.2; }
    return BOB.run * 0.9;
  }

  // ================================================================== bear traps (alert 2+)
  /** Alert 2+: now and then he takes a trap to a spot where pigs got caught / away (not next to another trap). */
  private wantTrap() {
    const traps = G.traps;
    if (this.level < 2 || !traps || this.carrying || this.now < this.trapNext) return false;
    this.trapNext = this.now + 3;
    if (traps.armedCount() >= ALERT.traps) return false;
    for (let i = this.hotSpots.length - 1; i >= 0; i--) {
      const h = this.hotSpots[i];
      if (traps.near(h, 4) || this.cage.contains(h, 3)) continue;
      this.trapAt.copy(h); this.hotSpots.splice(i, 1);
      return true;
    }
    return false;
  }
  private setTrap(dt: number) {
    this.activity = 'bob.trap';
    if (this.now - this.stateT > 25) { this.backToWork(); return 0; }
    if (!this.doing) {
      const d = this.moveTo(this.trapAt, BOB.walk * 1.2, dt);
      if (d < 0.9 || (d < 2.4 && this.stuck >= 2)) { this.doing = true; this.choreUntil = this.now + 1.6; this.stuck = 0; }
      return BOB.walk * 1.2;
    }
    if (this.now > this.choreUntil) {
      const f = this.forward;
      G.traps?.place(v1.set(this.pos.x + f.x * 0.7, 0, this.pos.z + f.z * 0.7));
      this.voice('ha', 0.6);
      this.trapNext = this.now + ALERT.trapEvery;
      this.doing = false; this.backToWork();
    }
    return 0;
  }

  // ================================================================== gates
  private spotGate(v: { cos: number; range: number }): Gate | null {
    const gates = G.gates as Gates | null; if (!gates) return null;
    let best: Gate | null = null, bd = 26;
    for (const g of gates.list) {
      if (!g.needsBob || (this.gateSkip.get(g) ?? -1) > this.now) continue;
      const d = Math.hypot(g.center.x - this.pos.x, g.center.z - this.pos.z);
      if (d < bd && this.canSee({ pos: this.gatePt.copy(g.center).setY(g.center.y + 0.6) }, v) > 0) { best = g; bd = d; }
    }
    if (best || this.level < 1 || this.now < this.lockNext) return best;
    // wary: padlock the nearest gate that is only latched (he knows his farm: no need to see it)
    this.lockNext = this.now + ALERT.lockEvery;
    bd = 50;
    for (const g of gates.list) {
      if (g.state !== 'shut' || !g.def.lockable || (this.gateSkip.get(g) ?? -1) > this.now) continue;
      const d = Math.hypot(g.center.x - this.pos.x, g.center.z - this.pos.z);
      if (d < bd) { best = g; bd = d; }
    }
    return best;
  }
  private startGate(g: Gate) {
    this.stopRiding(); this.doing = false; this.path = [];
    this.gateJob = g; this.go('gate');
    if (g.state === 'broken') { this.voice('grr'); this.raise('gateBroken'); }
    else if (g.state === 'free') { this.voice('huh'); this.raise('gateOpen'); }
    else this.voice('mutter', 0.6);
  }
  /** Admin: deal with the nearest gate now (whatever its state). */
  gateNow(g: Gate) { if (this.gone) this.wake(); if (this.calm() && !this.carrying) this.startGate(g); }
  /** Walk to the latch side of the gate, then shut it / hammer it back on its hinges / padlock it. */
  private gateStep(dt: number) {
    const g = this.gateJob;
    this.activity = g?.state === 'broken' ? 'bob.repair' : 'bob.gate';
    const lockIt = !!g && this.level >= 1 && g.def.lockable;
    if (!g || this.now - this.stateT > 40 || (!this.doing && !g.needsBob && !(g.state === 'shut' && lockIt))) { this.gateJob = null; this.backToWork(); return 0; }
    if (!this.doing) {
      const s = g.side(this.pos);
      const spot = v2.copy(g.latch).lerp(g.center, 0.35).addScaledVector(g.swingDir, s * 1.3).setY(g.center.y);
      const d = this.moveTo(spot, BOB.walk * 1.15, dt);
      if (d < 0.6 || (d < 2.4 && this.stuck >= 2)) {
        this.stuck = 0; this.doing = true;
        const broken = g.state === 'broken';
        this.choreUntil = this.now + (broken ? GATE.repair : g.state === 'shut' ? GATE.lockTime : GATE.closeTime);
        if (broken) G.events.push({ type: 'gateFix', text: g.label });
      }
      return BOB.walk * 1.15;
    }
    this.face(g.center, dt, 6);
    if (g.state === 'broken' && Math.random() < dt * 2.4) G.audio.play('wood', { pos: g.center, vol: 0.55, pitch: 1.35 + Math.random() * 0.3, minGap: 0.22 });
    if (this.now > this.choreUntil) {
      const final = lockIt ? 'locked' : 'shut';
      if (g.state === 'broken') g.repair(final); else g.closeBy(final);
      if (final === 'locked') G.events.push({ type: 'gateLocked', text: g.label });
      this.voice(final === 'locked' ? 'ha' : 'mutter', 0.6);
      this.gateSkip.set(g, this.now + 8);
      this.gateJob = null; this.doing = false;
      this.backToWork();
    }
    return 0;
  }

  /** Can he see this spot from here (farm jobs: wide view, no pig rules)? */
  looksAt(pt: THREE.Vector3, range = 28, cos = Math.cos(1.1)) { return this.canSee({ pos: pt }, { cos, range }) > 0; }
  /** Admin / farm: send him to a job now. */
  jobNow(j: BobJob) { if (this.gone) this.wake(); if (this.calm() && !this.carrying) { this.stopRiding(); this.doing = false; this.path = []; this.job = j; this.go('job'); } }
  /** Walk over, fiddle with it for a while (fix pose), done. */
  private jobStep(dt: number) {
    const j = this.job;
    if (!j || this.now - this.stateT > 35 || (!this.doing && !j.still())) { this.job = null; this.backToWork(); return 0; }
    this.activity = j.activity;
    if (!this.doing) {
      const d = this.moveTo(j.at, BOB.walk * 1.1, dt);
      if (d < (j.near ?? 0.7) || (d < 2.4 && this.stuck >= 2)) { this.stuck = 0; this.doing = true; this.choreUntil = this.now + j.dur; }
      return BOB.walk * 1.1;
    }
    this.face(j.look, dt, 6);
    if (this.now > this.choreUntil) {
      if (j.still()) j.done();
      this.voice('mutter', 0.5);
      this.job = null; this.doing = false;
      if (j.then) j.then(); else this.backToWork();
    }
    return 0;
  }

  /** Admin: off to his coffee break now / (sip) a sip right now (straight into the rocker if he isn't there yet). */
  coffeeNow(sip = false) {
    const pc = G.porch as Porch | null, i = this.chores.findIndex((c) => c.id === 'paper');
    if (!pc || i < 0 || this.state === 'off' || this.state === 'down') return;
    if (this.gone) this.wake();
    if (this.carrying) this.release(false);
    if (!(this.state === 'routine' && this.doing && this.choreIdx === i)) {
      this.stopRiding(); this.target = null; this.hunt = null; this.path = [];
      this.choreIdx = i; this.doing = false; this.go('routine');
      if (sip) {
        const c = this.chores[i], y = G.terrain.height(c.at[0], c.at[1]);
        this.body.setTranslation({ x: c.at[0], y: y + CENTER + 0.05, z: c.at[1] }, true); this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.pos.set(c.at[0], y, c.at[1]); this.yaw = Math.atan2(c.look[0] - c.at[0], c.look[1] - c.at[1]);
        this.doing = true; this.choreUntil = this.now + c.dur;
      }
    }
    if (sip) this.sipSoon = true;
  }
  private sipSoon = false;

  // ================================================================== the siesta (world/hammock.ts)
  /** Admin: off to the hammock now / straight in. */
  napNow(inside = false) {
    const h = G.hammock as Hammock | null;
    if (!h || this.state === 'hammock' || this.state === 'off' || this.state === 'down') return;
    if (this.gone) this.wake();
    if (this.carrying) this.release(false);
    this.stopRiding(); this.doing = false; this.path = []; this.target = null; this.hunt = null; this.napped = true;
    if (inside) this.enterNap(h); else { this.go('toHammock'); G.events.push({ type: 'bobNap' }); }
  }
  private napWalk(dt: number) {
    const h = G.hammock as Hammock | null;
    this.activity = 'bob.toNap';
    if (!h || !h.usable) { this.backToWork(); return 0; }
    const d = this.moveTo(h.getIn, BOB.walk * 0.9, dt);
    if (d < 0.6 || (d < 2 && this.stuck >= 2)) { this.stuck = 0; this.enterNap(h); return 0; }
    return BOB.walk * 0.9;
  }
  private enterNap(h: Hammock) {
    this.stopRiding(); this.dropProp(); this.doing = false; this.path = [];
    h.climbIn();
    this.go('hammock'); this.activity = 'bob.nap';
    this.napUntil = this.now + NAP.time * (0.85 + Math.random() * 0.3); this.napWake = 0; this.napHeard = null;
    this.body.setEnabled(false); this.parts.setEnabled(false);
    this.vel.set(0, 0, 0);
  }
  /** Asleep: blind; a noise close by (or a hard swinging) wakes him — groggy for a moment first. */
  private napStep() {
    const h = G.hammock as Hammock | null;
    if (!h) { this.go('routine'); return; }
    this.activity = 'bob.nap';
    for (const n of G.noises) {
      if (n.t <= this.noiseT) continue;
      this.noiseT = n.t;
      if (Math.abs(n.t - h.pushT) < 0.05) continue;   // the hammock being shoved: the rocking lulls him
      const d = Math.hypot(n.x - h.base.x, n.z - h.base.z);
      if (d < Math.min(NAP.hear, n.radius) * ALERT.hear[this.level] * modHear()) {
        if (!this.napWake) { this.napWake = this.now + NAP.groggy; this.voice('huh', 0.6); }
        this.napHeard = new THREE.Vector3(n.x, n.y, n.z);
      }
    }
    if (h.rousing && !this.napWake) { this.napWake = this.now + 0.6; this.voice('huh', 0.7); }
    if ((this.napWake && this.now > this.napWake) || this.now > this.napUntil) this.leaveNap(h);
  }
  /** Out of the hammock: yawns and back to work — or off to see what woke him. */
  private leaveNap(h: Hammock) {
    const at = h.getIn;
    this.body.setTranslation({ x: at.x, y: at.y + CENTER + 0.05, z: at.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.pos.copy(at); this.yaw = Math.atan2(h.side.x, h.side.z);
    this.state = 'routine';   // (go() below must not climb out twice)
    h.climbOut(); this.body.setEnabled(true); this.parts.setEnabled(true); this.parts.snap();
    const heard = this.napHeard; this.napHeard = null;
    if (heard) { this.searchAt.copy(heard); this.go('investigate'); this.voice('huh'); }
    else { this.voice('yawn', 0.8); this.backToWork(); }
  }
  /** The hammock swung over: he's flung out onto the ground (a knock-down), then looks around, furious. */
  hammockFlipped(h: Hammock, dir: THREE.Vector3) {
    if (this.state !== 'hammock') return;
    const at = v1.copy(h.base).addScaledVector(dir, 0.7);
    this.body.setTranslation({ x: at.x, y: at.y + CENTER + 0.7, z: at.z }, true);
    this.body.setLinvel({ x: dir.x * 3, y: 1, z: dir.z * 3 }, true);
    this.pos.copy(at); this.yaw = Math.atan2(-dir.x, -dir.z);
    this.state = 'routine';
    this.body.setEnabled(true); this.parts.setEnabled(true); this.parts.snap();
    this.napHeard = null;
    this.voice('oops');
    this.stun('down', BOB.downTime);
    this.raise('prank');
    G.events.push({ type: 'hammockFlip' });
    const look = at.clone();
    this.afterStun = () => { this.voice('grr'); this.startSearch(look, null, 3); };
  }
  /** A muddy pig smeared his face while he napped: spectacles, a pig snout, whiskers (he wears them all round). */
  mudFace(p: Pig) {
    if (this.state !== 'hammock' || this.mudMarks >= NAP.marks) return;
    this.setMud(this.mudMarks + 1);
    p.muddyUntil = p.now;   // the mud is on Bob now
    const h = (G.hammock as Hammock).headPos(v1);
    G.audio.play('splat', { pos: h, vol: 0.8, pitch: 1.2 });
    G.fx.bits(h, { count: 10, color: 0x6b4a2b, speed: 1.6, up: 1.2, life: 0.5, size: 0.08, grow: 0, alpha: 1 });
    G.events.push({ type: 'mudFace', who: p });
    if (Math.random() < 0.2 && !this.napWake) { this.voice('huh', 0.5); this.napUntil = Math.min(this.napUntil, this.now + 3); }   // he stirs…
  }
  setMud(n: number) { this.mudMarks = n; this.visual.setMud(n); }

  // ================================================================== the phone (world/phone.ts)
  /** He can come to the phone now (doing something that can wait). */
  phoneFree() {
    if (this.carrying || this.stunUntil) return false;
    return this.state === 'routine' || this.state === 'dance' || this.state === 'dust' || this.state === 'investigate' || this.state === 'tidy'
      || (this.state === 'search' && !this.hunt);
  }
  /** It's ringing: off he hurries ("Coming!") — or, fed up with prank calls, straight to the payphone. */
  private checkPhone() {
    const ph = G.phones as Phones | null;
    if (!ph?.ringing || this.state === 'phone' || this.state === 'onPhone' || this.phoneCall === ph.callNo || !this.phoneFree()) return;
    this.phoneCall = ph.callNo;
    this.stopRiding(); this.doing = false; this.path = []; this.stuck = 0;
    if (ph.ring === 2 && ph.wise && ph.pay) {
      this.searchAt.copy(ph.pay.base); this.go('investigate'); this.voice('grr'); this.raise('noise');
      G.events.push({ type: 'bobWise' });
      return;
    }
    this.go('phone'); this.voice('hey', 0.6);
  }
  /** Hurrying over (it stops ringing before he gets there = he grumbles and goes back to work). */
  private phoneWalk(dt: number) {
    const ph = G.phones as Phones | null;
    this.activity = 'bob.phone';
    if (!ph?.ringing || !ph.standAt) { this.voice('mutter', 0.7); this.backToWork(); return 0; }
    const sp = BOB.walk * 1.5;
    const d = this.moveTo(ph.standAt, sp, dt);
    if (d < 0.45 || (d < 1.8 && this.stuck >= 2)) {
      this.stuck = 0;
      const kind = ph.pickUp();
      this.go('onPhone'); this.activity = 'bob.onPhone';
      this.phoneUntil = this.now + (kind === 2 ? PHONE.hello : PHONE.talk[0] + Math.random() * (PHONE.talk[1] - PHONE.talk[0]));
      this.phoneDeadT = 0; this.phoneChat = this.now + 0.5; this.phoneGlance = this.now + 4 + Math.random() * 3; this.glanceT = -10;
      G.events.push({ type: 'bobPhone' });
      if (kind === 2) this.voice('hello');
      return 0;
    }
    return sp;
  }
  /** On the phone: chatting away facing the box — cut off (unplugged), or a prank call ("Hello? … HELLO?"). */
  private phoneStep(dt: number) {
    const ph = G.phones as Phones | null;
    if (!ph?.off || !ph.standAt) { this.backToWork(); return 0; }
    this.activity = 'bob.onPhone';
    this.yaw = dampAngle(this.yaw, ph.faceYaw, 6, dt);
    if (Math.hypot(ph.standAt.x - this.pos.x, ph.standAt.z - this.pos.z) > 0.5) this.moveTo(ph.standAt, BOB.walk * 0.5, dt);
    // the line went dead: "Hello? HELLO?!", rattles the hook, then off along the wire to find who did that
    if (ph.dead) {
      if (!this.phoneDeadT) { this.phoneDeadT = this.now; this.voice('hello'); this.lookYaw = 0; }
      if (this.now > this.phoneChat) { this.phoneChat = this.now + 0.8; this.voice('hey', 0.8); G.audio.play('clunk', { pos: v1.copy(this.pos).setY(this.pos.y + 1.5), vol: 0.5, pitch: 1.4, minGap: 0.2 }); }
      if (this.now - this.phoneDeadT > PHONE.rattle) {
        ph.hangUp(true); this.voice('grr'); this.yell = 1; this.raise('prank');
        G.events.push({ type: 'hangUp' });
        // along the wire to the jack: plug it back in, then look around for whoever did that
        const j = ph.jobOf(), at = ph.wall!.jack.clone();
        j.then = () => this.startSearch(at, null, 3);
        this.job = j; this.go('job'); this.path = []; this.doing = false;
      }
      return 0;
    }
    // a prank call: "Hello?" … an oink down the line = furious (and after a couple he knows where they come from)
    if (ph.ring === 2) {
      if (ph.oinked) {
        ph.hangUp(true); this.yell = 1; this.voice('grr'); this.raise('prank');
        const wise = ph.pranked();
        G.events.push({ type: 'prankCall' });
        if (wise && ph.pay) { this.searchAt.copy(ph.pay.base); this.go('investigate'); this.path = []; }
        else this.backToWork();
        return 0;
      }
      if (this.now > this.phoneChat) { this.phoneChat = this.now + 2.4 + Math.random(); this.voice('hello', 0.8); }
      this.lookYaw = Math.sin((this.now - this.stateT) * 0.9) * 0.4;
      if (this.now > this.phoneUntil) { ph.hangUp(true); this.voice('mutter'); this.backToWork(); }
      return 0;
    }
    // a real call: rambling on, a laugh now and then, a glance over his shoulder every few seconds
    if (this.now > this.phoneChat) {
      this.phoneChat = this.now + 0.9 + Math.random() * 1.5;
      ph.chat(v1.copy(this.pos).setY(this.pos.y + 1.7));
      if (Math.random() < 0.08) this.voice('ha', 0.6);
    }
    if (this.now > this.phoneGlance) { this.phoneGlance = this.now + 6 + Math.random() * 4; this.glanceT = this.now; this.glanceDir = Math.random() < 0.5 ? -1 : 1; }
    const g = this.now - this.glanceT;
    this.lookYaw = g < 2.2 ? this.glanceDir * 1.8 * Math.sin((Math.PI * g) / 2.2) : Math.sin(this.now * 0.5) * 0.2;
    if (this.now > this.phoneUntil) { ph.hangUp(); this.voice(Math.random() < 0.4 ? 'ha' : 'mutter', 0.7); this.backToWork(); }
    return 0;
  }
  /** The receiver at his ear (render): his right hand, the earpiece toward his head. */
  onPhoneHand(out: THREE.Vector3, q: THREE.Quaternion) {
    if (this.state !== 'onPhone' || this.asleep) return false;
    this.visual.hand(out);
    this.visual.headPos(v2);
    q.setFromUnitVectors(UP, v2.sub(out).negate().normalize());
    return true;
  }
  /** Admin: off to the phone (it rings now). */
  phoneNow() { if (this.gone) this.wake(); this.phoneCall = -1; }

  // ================================================================== toilet breaks (world/outhouse.ts)
  /** The nearest outhouse he can use. */
  private looPick(): Outhouse | null {
    let best: Outhouse | null = null, bd = Infinity;
    for (const o of G.loos as Outhouse[]) { if (!o.usable) continue; const d = o.base.distanceTo(this.pos); if (d < bd) { bd = d; best = o; } }
    return best;
  }
  /** Admin: off to the outhouse now / straight inside. */
  looNow(inside = false) {
    if (this.state === 'off' || this.state === 'down') return;
    if (this.state === 'inLoo') return;
    if (this.gone) this.wake();
    const o = this.looPick(); if (!o) return;
    if (this.carrying) this.release(false);
    this.stopRiding(); this.doing = false; this.path = []; this.target = null; this.hunt = null;
    this.loo = o;
    if (inside) this.enterLoo(o); else { this.go('loo'); G.events.push({ type: 'bobLoo' }); }
  }
  /** Walking over (a little faster than usual: he needs to go). */
  private looWalk(dt: number) {
    const o = this.loo;
    if (!o || !o.usable) { this.loo = null; this.looNext = this.now + 25; this.backToWork(); return 0; }
    this.activity = 'bob.loo';
    const d = this.moveTo(o.doorstep, BOB.walk * 1.2, dt);
    if (d < 0.6 || (d < 2.2 && this.stuck >= 2)) { this.stuck = 0; this.enterLoo(o); return 0; }
    return BOB.walk * 1.2;
  }
  private enterLoo(o: Outhouse) {
    this.stopRiding(); this.dropProp(); this.doing = false; this.path = [];
    o.enter();
    this.go('inLoo'); this.loo = o; this.activity = 'bob.inLoo';
    this.looUntil = this.now + LOO.time * (0.85 + Math.random() * 0.3);
    this.looNext = this.now + looEvery();
    this.looHeard = null; this.looBanging = false; this.looStuck = false; this.looHeave = false;
    this.yaw = Math.atan2(-o.front.x, -o.front.z);
    this.body.setEnabled(false); this.parts.setEnabled(false); this.visual.root.visible = false;
    this.vel.set(0, 0, 0);
  }
  /** Inside: he sees nothing. A noise close by / a knock brings him out sooner; a bolted door = he bangs, then bursts out. */
  private looStep() {
    const o = this.loo;
    if (!o) { this.go('routine'); this.body.setEnabled(true); this.parts.setEnabled(true); this.visual.root.visible = true; return; }
    this.activity = 'bob.inLoo';
    for (const n of G.noises) {
      if (n.t <= this.noiseT) continue;
      this.noiseT = n.t;
      const d = Math.hypot(n.x - o.base.x, n.z - o.base.z);
      if (d < Math.min(LOO.hear, n.radius) * ALERT.hear[this.level] * modHear() && d > 0.1) {
        if (!this.looHeard) this.voice('huh', 0.7);
        this.looHeard = new THREE.Vector3(n.x, n.y, n.z); this.looUntil = Math.min(this.looUntil, this.now + LOO.hurry);
      }
    }
    if (o.tipping) return;   // falling over: `looTipped` once it lands
    if (this.looHeave) { if (o.upright) this.exitLoo(true); return; }
    if (this.now < this.looUntil) return;
    if (o.bolted || this.looStuck) {
      if (!this.looBanging) {
        this.looBanging = true; this.looBangStart = this.now; this.looBang = 0;
        this.voice('hey'); this.raise('prank');
        G.events.push({ type: 'looLocked' });
      }
      if (this.now > this.looBang) { this.looBang = this.now + LOO.bangEvery * (0.75 + Math.random() * 0.5); o.bang(); if (Math.random() < 0.5) this.voice('grr', 0.8); }
      if (this.now - this.looBangStart > (this.looStuck ? LOO.stuck : LOO.lockedMax)) {
        if (this.looStuck) { this.looHeave = true; o.heave(); this.voice('grr'); }
        else { o.burst(); this.exitLoo(true); }
      }
      return;
    }
    this.exitLoo(this.looBanging);
  }
  /** Out of the door: calm (back to work), curious (he heard something: looks there) or furious (searches around). */
  private exitLoo(angry: boolean) {
    const o = this.loo;
    if (!o) return;
    const at = o.exitPoint(v1);
    if (!o.broken) o.leave(); else o.vacate();
    this.loo = null;
    this.body.setEnabled(true); this.parts.setEnabled(true); this.visual.root.visible = true;
    this.body.setTranslation({ x: at.x, y: at.y + CENTER + 0.05, z: at.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.vel.set(0, 0, 0);
    this.pos.copy(at); this.yaw = Math.atan2(o.front.x, o.front.z);
    this.parts.snap();
    this.doing = false; this.path = []; this.stuck = 0;
    const heard = this.looHeard; this.looHeard = null;
    if (angry) {
      this.voice('grr'); this.raise('prank');
      this.state = 'routine';   // (not inLoo any more: go() below must not vacate again)
      this.startSearch(at.clone().addScaledVector(o.front, 2.5), null, 4);
    } else if (heard) { this.state = 'routine'; this.searchAt.copy(heard); this.go('investigate'); this.voice('huh'); }
    else { this.voice('mutter', 0.6); this.state = 'routine'; this.backToWork(); }
  }
  /** The outhouse went over with him inside: flung out of the door — or, on its door, stuck banging till he heaves it up. */
  looTipped(o: Outhouse, doorDown: boolean) {
    if (this.state !== 'inLoo' || this.loo !== o) return;
    this.raise('prank');
    if (doorDown) {
      this.looStuck = true; this.looBanging = true; this.looBangStart = this.now; this.looBang = this.now + 0.6; this.looUntil = this.now;
      this.voice('hey');
      G.events.push({ type: 'looStuck' });
      return;
    }
    const dir = v2, at = o.doorOut(v1, dir);
    o.eject();
    this.loo = null; this.state = 'routine';
    this.body.setEnabled(true); this.parts.setEnabled(true); this.visual.root.visible = true;
    this.body.setTranslation({ x: at.x, y: Math.max(at.y, G.terrain.height(at.x, at.z) + 0.3) + CENTER, z: at.z }, true);
    this.pos.set(at.x, at.y, at.z);
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.parts.snap();
    this.vel.set(dir.x * 5, 0, dir.z * 5);
    this.stun('down', BOB.downTime);
    this.body.setLinvel({ x: dir.x * 5.5, y: 4 + Math.max(0, dir.y) * 5, z: dir.z * 5.5 }, true);
    this.parts.matchVelocity();
    G.events.push({ type: 'looFlung' });
  }
  /** A pig knocked on / rocked the outhouse while he's in there: he hurries out to see who it was. */
  looKnock(o: Outhouse) {
    if (this.state !== 'inLoo' || this.loo !== o || this.looBanging) return;
    if (!this.looHeard) this.voice('huh', 0.8);
    this.looHeard = o.doorstep.clone().addScaledVector(o.front, 2);
    this.looUntil = Math.min(this.looUntil, this.now + LOO.hurry);
  }

  // ================================================================== market day
  /** Admin: he may go (again) this round. */
  resetMarket() { this.marketDone = false; }
  /** Market day: off to the gate (he drives to town), gone until the market closes. */
  private toMarket(dt: number) {
    this.activity = 'bob.toMarket';
    if (!marketHours()) { this.marketDone = true; this.backToWork(); return 0; }
    const d = this.moveTo(this.gate, BOB.walk * 1.25, dt);
    if (d < 1.3 || (d < 3 && this.stuck >= 2)) { this.leave(); return 0; }
    return BOB.walk * 1.25;
  }
  private leave() {
    this.marketDone = true; this.stuck = 0;
    this.dropProp(); this.stopRiding();
    this.go('away'); this.activity = 'bob.market';
    G.fx.puff(v2.copy(this.pos).setY(this.pos.y + 0.4), { count: 14, color: 0xcbb48c, speed: 2, up: 0.6, life: 1.2, size: 1.2, alpha: 0.6 });
    this.body.setEnabled(false); this.parts.setEnabled(false); this.visual.root.visible = false;
    G.events.push({ type: 'market', text: 'gone' });
  }

  /** The guard dog barked at a pig: he comes over to look (or wakes up). */
  tipOff(p: Pig, at: THREE.Vector3) {
    if (this.state === 'away') { this.awayTip = at.clone(); this.awayTipPig = p; return; }   // he'll hear about it later
    if (this.state === 'inLoo') { this.looHeard = at.clone(); this.looUntil = Math.min(this.looUntil, this.now + 1.5); return; }   // he hurries
    if (this.state === 'off' || this.state === 'down' || this.carrying) return;
    if (this.state === 'sleep') { this.wake(at); return; }
    if (!this.calm() || this.state === 'suspect') return;
    this.sus.set(p, Math.max(this.sus.get(p) ?? 0, 0.55));
    this.lastSeen.copy(at); this.lastVel.set(0, 0, 0);
    this.stopRiding(); this.voice('huh');
    this.startSearch(at, p, 3);
  }
  /**
   * Chain modes: a high / drunk pig hugs him (or sings to him) — he freezes, "huh?!", hearts pop, then he wants to know
   * who that was (a search from there). True = it counted.
   */
  hugged(p: Pig): boolean {
    if (this.asleep || this.state === 'down' || this.state === 'off' || this.state === 'away' || this.state === 'inLoo' || this.carrying) return false;
    if ((this.hitBy.get('hug') ?? -10) > this.now - 3) return false;
    this.hitBy.set('hug', this.now);
    this.voice('huh');
    G.fx.bits(v1.copy(this.pos).setY(this.pos.y + 1.9), { count: 8, color: 0xff6fa8, speed: 1.6, up: 2.2, life: 1.1, size: 0.16, grow: 0, drag: 2, alpha: 1 });
    if (this.state !== 'stagger') this.stun('stagger', BOB.staggerTime + 0.6);
    this.raise('suspect');
    this.tipOff(p, p.pos);
    return true;
  }
  /** A pig stepped in one of his traps: he heard the snap and knows exactly where to go. */
  trapSprung(p: Pig, at: THREE.Vector3) { this.raise('trap'); this.tipOff(p, at); }

  // ================================================================== shotgun (alert 3)
  /** Rock salt: a cone of knock-back (ragdoll, no damage) on every pig in front of the barrel, hens fly. */
  private fire() {
    const f = this.forward.clone().applyAxisAngle(UP, (Math.random() - 0.5) * 2 * ALERT.gunWobble), muzzle = v1.copy(this.pos).addScaledVector(f, 1.1).setY(this.pos.y + 1.35);
    this.gunReady = this.now + ALERT.gunCool;
    G.audio.play('shot', { pos: muzzle, vol: 1.4 });
    G.noise(this.pos, 40);
    G.fx.puff(muzzle, { count: 9, color: 0xe8e2d6, spread: 0.25, speed: 1.6, up: 0.6, life: 1.3, size: 0.45, grow: 1.4, drag: 2, alpha: 0.7, dir: f });
    G.fx.bits(muzzle, { count: 12, color: 0xffb347, spread: 0.15, speed: 6, up: 0.3, life: 0.18, size: 0.22, grow: 0, drag: 6, alpha: 1, dir: f });
    G.fx.bits(muzzle, { count: 36, color: 0xffffff, spread: 0.32, speed: 16, up: 0.6, life: 0.55, size: 0.06, grow: 0, grav: 6, alpha: 1, dir: f });
    G.events.push({ type: 'shot' });
    const cone = (x: number, z: number) => {
      const dx = x - this.pos.x, dz = z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > ALERT.gunMax + 2) return -1;
      return d < 1.3 || (dx * f.x + dz * f.z) / d > ALERT.gunCone ? d : -1;
    };
    for (const p of this.pigs) {
      if (p.out || p.cage || p.heldBy?.kind === 'farmer' || ignored(p)) continue;
      const d = cone(p.pos.x, p.pos.z); if (d < 0) continue;
      if (d > ALERT.gunFar && Math.random() < ALERT.gunFarMiss * (d - ALERT.gunFar) / (ALERT.gunMax - ALERT.gunFar)) continue;   // scattered wide
      const to = v2.set(p.pos.x - muzzle.x, p.pos.y + 0.3 - muzzle.y, p.pos.z - muzzle.z), len = to.length(); to.divideScalar(len);
      const wall = raycast(muzzle, to, len, L.STATIC, undefined, (c) => !SEE_THROUGH.has(c.handle));
      if (wall && wall.dist < len - 0.4) continue;
      const k = clamp(1.15 - d / (ALERT.gunMax + 3), 0.4, 1);
      p.knock(v3.copy(f).multiplyScalar(ALERT.gunPush * k).setY(5.5 * k), true);
      p.hurt(ALERT.gunDmg * k, 'shot');
      G.audio.play('squeal', { pos: p.pos, vol: 1 });
      G.fx.bits(v2.copy(p.pos).setY(p.pos.y + 0.4), { count: 18, color: 0xffffff, speed: 4, up: 2, life: 0.5, size: 0.07, grow: 0, grav: 8, alpha: 1 });
      G.shakeFor(p, 0.6);
      G.events.push({ type: 'shotHit', who: p });
    }
    for (const c of G.holdables) {
      if (c.kind !== 'critter' || c.heldBy) continue;
      const cp = c.body.translation(), d = cone(cp.x, cp.z); if (d < 0 || d > 9) continue;
      c.knock?.(v3.copy(f).multiplyScalar(6).setY(4), true);
    }
  }

  // ================================================================== chase / grab / slap
  private reachable(p: Pig) {
    const ground = G.terrain.height(p.pos.x, p.pos.z);
    if (p.pos.y - ground > 1.9) return false;
    const n = this.nav.nearestFree(p.pos.x, p.pos.z, 3);
    return !!n && Math.hypot(n.x - p.pos.x, n.z - p.pos.z) < 2.2;
  }

  private chase(dt: number) {
    const t = this.target;
    this.activity = 'bob.chaseYou';
    if (!t || t.out || t.cage || (t.heldBy && t.heldBy !== this && t.heldBy.kind !== 'trap') || ignored(t)) { this.giveUp(); return 0; }
    if (this.now - this.lastSeenT > BOB.loseSight) {        // lost it: hunt for it around where it was last seen
      this.sus.set(t, Math.max(0.85, this.sus.get(t) ?? 0));
      this.voice('huh'); this.startSearch(this.lastSeen, t, BOB.huntSpots);
      this.raise('lost'); this.hot(this.lastSeen);
      G.events.push({ type: 'bobLost', who: t });
      return 0;
    }
    this.chaseRun += dt;
    if (this.chaseRun > BOB.stamina) { this.go('pant'); this.voice('yawn', 0.6); return 0; }
    const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z, d = Math.hypot(dx, dz), dy = t.pos.y - this.pos.y;
    if (this.level >= 3 && this.now > this.gunReady && this.now - this.lastSeenT < 0.15 && d > ALERT.gunMin && d < ALERT.gunMax
      && Math.abs(dy) < 2.5 && Math.random() < dt * 8) {
      this.go('aim'); this.voice('hey'); this.yell = 1;
      G.audio.play('unlock', { pos: this.pos, vol: 0.9, pitch: 1.5 });   // click-clack
      G.events.push({ type: 'aim', who: t });
      return 0;
    }
    if (d < 3.2 && this.now - this.lastSeenT < 0.2 && this.danceNear(t, true)) return 0;
    if (d < (this.level >= 2 ? ALERT.reach : BOB.grabReach) && dy < 1.7 && dy > -0.8) {
      this.face(t.pos, dt, 16);
      // sometimes he doesn't bother grabbing: a big humiliating slap instead
      if (this.forceSlap || Math.random() < (G.mod === 'grumpy' ? MOD.grumpy.slap : BOB.slapChance)) { this.forceSlap = false; this.go('slapWind'); this.voice('grr', 0.7); }
      else this.go('windup');
      this.yell = 0.8;
      return 0;
    }
    if (!this.reachable(t)) {
      this.unreachableT += dt;
      if (this.unreachableT > 0.6 && d < 8) { this.unreachableT = 0; this.go('fist'); return 0; }
    } else this.unreachableT = 0;
    const goal = this.now - this.lastSeenT < 0.3 ? t.pos : this.lastSeen;
    const run = BOB.run * ALERT.run[this.level] * (ADMIN.chill ? 0.85 : 1);
    this.moveTo(goal, run, dt, 0.45);
    return run;
  }

  /** Any free pig in front of his hands during the lunge. */
  private tryCatch(): Pig | null {
    const f = this.forward;
    const fork = this.level >= 2, at = fork ? ALERT.catchAt : 0.75;   // the pitchfork reaches further
    const hx = this.pos.x + f.x * at, hz = this.pos.z + f.z * at, hy = this.pos.y + 0.8;
    let best: Pig | null = null, bd = fork ? ALERT.catchR : BOB.catchR;
    for (const p of this.pigs) {
      if (p.out || p.cage || (p.heldBy && p.heldBy.kind !== 'trap') || ignored(p)) continue;
      const d = Math.hypot(p.pos.x - hx, (p.pos.y - hy) * 0.6, p.pos.z - hz);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** The slap: every pig in front of his right hand flies sideways, spinning. */
  private slapHit() {
    const f = this.forward, right = v1.set(-f.z, 0, f.x);
    const hx = this.pos.x + f.x * 0.9, hz = this.pos.z + f.z * 0.9;
    this.slapped = [];
    for (const p of this.pigs) {
      if (p.out || p.cage || p.heldBy || ignored(p)) continue;
      if (Math.hypot(p.pos.x - hx, p.pos.z - hz) > BOB.slapReach || Math.abs(p.pos.y - this.pos.y - 0.4) > 1.4) continue;
      const imp = v2.copy(right).multiplyScalar(-9).addScaledVector(f, 4); imp.y = 6.5;
      p.knock(imp, true);
      this.slapped.push(p);
      G.audio.play('slap', { pos: p.pos, vol: 1.2, pitch: 1.1 });
      G.audio.play('squeal', { pos: p.pos, vol: 1 });
      G.fx.bits(v3.copy(p.pos).setY(p.pos.y + 0.4), { count: 16, color: 0xfff1a8, speed: 4, up: 2, life: 0.5, size: 0.16, grow: 0, drag: 3, alpha: 1 });
      G.shakeFor(p, 0.5);
      G.events.push({ type: 'slapped', who: p, text: 'insult.' + Math.floor(Math.random() * 6) });
    }
    if (this.slapped.length) this.voice('insult');
    G.noise(this.pos, 12);
  }

  /** Something squishy burst on him (egg, melon, flower pot). */
  private splatted(dir: THREE.Vector3, what = '') {
    if ((this.hitBy.get('splat') ?? -10) > this.now - 0.2) return;
    this.hitBy.set('splat', this.now);
    G.audio.play(what === 'snowball' ? 'snowhit' : 'splat|squish', { pos: this.pos, vol: 1 });
    G.fx.bits(v1.copy(this.pos).setY(this.pos.y + 1.6), { count: 14, color: what === 'apple' ? 0xf2e6b0 : what === 'snowball' ? 0xffffff : 0xffe27a, speed: 2.5, up: 1, grav: 10, life: 0.8, size: 0.12, grow: 0, alpha: 1 });
    G.events.push({ type: 'splatBob', text: what });
    this.raise('splat');
    this.hit(8, v2.copy(dir));
  }

  /** Admin / pig punch: a hoof jab (k < 1: a headbutt / a bash with something that isn't a weapon). */
  punched(dir: THREE.Vector3, k = 1) {
    if (this.asleep) return;
    if ((this.hitBy.get('punch') ?? -10) > this.now - 0.3) return;
    this.hitBy.set('punch', this.now);
    this.hit(BOB.punch * k, dir);
  }

  /** A pig whacked him with a weapon (pan, shovel, sword, axe). */
  whacked(dir: THREE.Vector3, dmg: number) {
    if (this.asleep) return;
    if ((this.hitBy.get('weapon') ?? -10) > this.now - 0.3) return;
    this.hitBy.set('weapon', this.now);
    G.events.push({ type: 'whacked' });
    G.audio.play('metal', { pos: v1.copy(this.pos).setY(this.pos.y + 1.7), vol: 1, pitch: 0.75 });
    this.hit(dmg, dir);
  }

  private pickUp(p: Pig) {
    this.hot(p.pos);
    this.carrying = p; this.target = p;
    p.caughtBy(this);
    ignorePair(this.body, p.body, true);
    this.grip.attach(p.body, p.pos, SCRUFF);   // he grabs it by the scruff: it dangles, kicks, swings
    G.audio.play('body', { pos: this.pos, vol: 1 });
    G.audio.play('squeal', { pos: p.pos, vol: 1 });
    this.voice('win');
    G.shakeFor(p, 0.35);
    G.events.push({ type: 'caught', who: p });
    this.chaseRun = 0; this.shakeT = 0;
    this.go('carry'); this.path = [];
  }

  /** Pig wriggled free / he got hit: drop it. */
  release(_thrown: boolean) {
    const p = this.carrying; if (!p) return;
    this.carrying = null;
    this.grip.detach();
    ignorePair(this.body, p.body, false);
    p.heldBy = null;
    const f = this.forward;
    p.body.setLinvel({ x: f.x * 3 + (Math.random() - 0.5) * 3, y: 5, z: f.z * 3 + (Math.random() - 0.5) * 3 }, true);
    p.startRagdoll(null, false);
    G.events.push({ type: 'escaped', who: p });
    if (this.state === 'carry') {
      this.raise('escaped');
      this.voice('oops'); this.sus.set(p, 1); this.target = p; this.lastSeenT = this.now; this.lastSeen.copy(p.pos);
      this.go('recover');
    }
  }

  /** Pig farts in his face while carried. */
  fartedOn() { this.cough(); }

  private carry(dt: number) {
    const p = this.carrying;
    this.activity = 'bob.carryPig';
    if (!p) { this.backToWork(); return 0; }
    // a firm grip: every few seconds he gives the pig a good shake (loses escape progress)
    this.shakeT += dt;
    if (this.shakeT > BOB.shakeEvery) {
      this.shakeT = 0; this.shakeUntil = this.now + 0.35;
      p.escape = Math.max(0, p.escape - BOB.shakeLoss);
      this.voice('grr', 0.7);
      G.shakeFor(p, 0.25);
    }
    const d = this.moveTo(this.cage.front, BOB.carry, dt);
    if (d < 0.7) {
      this.carrying = null;
      this.grip.detach();
      ignorePair(this.body, p.body, false);
      p.heldBy = null;
      this.cage.lock(p);
      this.sus.set(p, 0); this.target = null;
      this.voice('bye'); this.go('dust'); this.raise('caged');
      G.events.push({ type: 'caged', who: p });
      return 0;
    }
    return BOB.carry;
  }

  /** The pig hangs from his hand (a joint at its scruff); a strong arm: it lifts any pig. Shakes = real shakes. */
  private holdCarried(dt: number) {
    const p = this.carrying; if (!p) return;
    const shake = this.now < this.shakeUntil ? Math.sin(this.now * 60) * 0.22 : Math.sin(this.now * 7) * 0.03;
    const T = v1.copy(CARRY_AT).setX(shake).applyAxisAngle(UP, this.yaw).add(this.pos).setY(this.pos.y + CENTER + CARRY_AT.y + Math.abs(shake) * 0.5);
    this.grip.drive(T, this.body, p.mass + 6, dt, { up: 5000, side: 5000, kp: 16, react: 0, g: 20 });
    if (this.grip.strain > 2.5) {    // snagged / teleported: bring it back to his hand
      p.body.setTranslation({ x: T.x, y: T.y - 0.3, z: T.z }, true); p.body.setLinvel(this.vel, true);
      this.grip.attach(p.body, p.pos, SCRUFF);
    }
  }

  // ================================================================== getting hurt
  /** Pig ram (via Pig.ramStep → knock). */
  knock(dv: THREE.Vector3, _ragdoll: boolean) {
    if (this.asleep) return;
    if ((this.hitBy.get('ram') ?? -10) > this.now - 0.4) return;
    this.hitBy.set('ram', this.now);
    this.hit(BOB.ram, dv);
  }

  private hit(dmg: number, dir: THREE.Vector3) {
    if (this.state === 'down') return;
    this.stopRiding();
    const winded = this.state === 'pant' || this.state === 'cough' || this.state === 'dance' ? 1.5 : 1;
    this.poise += dmg * winded; this.poiseT = this.now;
    this.raise(dmg * 0.12);
    G.audio.play('punch|body', { pos: this.pos, vol: 1 });
    this.voice('oof', 0.9);
    G.fx.bits(v1.copy(this.pos).setY(this.pos.y + 1.2), { count: 10, color: 0xfff1a8, speed: 3.5, up: 1.5, life: 0.4, size: 0.14, grow: 0, drag: 3, alpha: 1 });
    G.fx.shake(0.15);
    // knocked back a little
    const len = Math.hypot(dir.x, dir.z) || 1;
    this.vel.x += (dir.x / len) * 2.5; this.vel.z += (dir.z / len) * 2.5;
    // he's mad now: the nearest free pig did it
    let best: Pig | null = null, bd = 12;
    for (const p of this.pigs) {
      if (p.out || p.cage || p.heldBy || ignored(p)) continue;
      const d = p.pos.distanceTo(this.pos);
      if (d < bd) { bd = d; best = p; }
    }
    const down = this.poise >= BOB.knockdown, stagger = !down && this.poise >= BOB.stagger && this.state !== 'stagger';
    if (down || stagger) {
      this.stun(down ? 'down' : 'stagger', down ? BOB.downTime : BOB.staggerTime);
      if (best) { this.target = best; this.sus.set(best, 1); this.lastSeen.copy(best.pos); }
    } else if (best && !this.carrying && !this.chasing && !this.stunUntil && bd < 6) this.alarmed(best);
  }

  private stun(kind: 'down' | 'stagger' | 'cough', secs: number) {
    if (kind !== 'cough' && this.carrying) this.release(false);
    this.stopRiding();
    if (kind === 'down') {
      this.setCollider(true);
      // he topples over backwards (head away from the hit), arms and legs flopping
      this.body.lockRotations(false, true);
      const f = this.forward;
      this.body.setAngvel({ x: -Math.cos(this.yaw) * 2.6, y: (Math.random() - 0.5) * 1.5, z: Math.sin(this.yaw) * 2.6 }, true);
      this.body.setLinvel({ x: this.vel.x - f.x * 1.5, y: 1.5, z: this.vel.z - f.z * 1.5 }, true);
      this.parts.setTone('ragdoll'); this.parts.matchVelocity();
      G.audio.play('thud|body', { pos: this.pos, vol: 1, pitch: 0.7 });
      G.audio.play('bob_down', { pos: this.pos, vol: 1 });
      G.fx.shake(0.4);
      G.events.push({ type: 'knockdown' });
      this.raise('down');
      this.poise = 0;
    }
    if (kind === 'stagger') { G.events.push({ type: 'stagger' }); this.raise('stagger'); }   // poise keeps stacking: more hits now = knock-down
    this.doing = false;
    this.go(kind); this.stunUntil = this.now + secs;
  }

  /** Back on his feet after a knock-down: upright, same heading, rotations locked again. */
  private getUp() {
    const p = this.body.translation();
    this.setCollider(false);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.lockRotations(true, true);
    this.body.setRotation(new THREE.Quaternion().setFromAxisAngle(UP, this.yaw), true);
    this.body.setTranslation({ x: p.x, y: Math.max(p.y, G.terrain.height(p.x, p.z) + CENTER + 0.05), z: p.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.vel.set(0, 0, 0);
  }

  /** A rolling cheese wheel bowled into him (farm 3): stagger, or flat on his back (the prize cheese / a second one). */
  private cheesed(dir: THREE.Vector3, big: boolean) {
    if ((this.hitBy.get('cheese') ?? -10) > this.now - 0.8) return;
    this.hitBy.set('cheese', this.now);
    G.audio.play('thud|body', { pos: this.pos, vol: 1, pitch: 0.8 });
    G.fx.bits(v1.copy(this.pos).setY(this.pos.y + 0.6), { count: 14, color: 0xffd34d, speed: 3.5, up: 2, life: 0.6, size: 0.12, grow: 0, drag: 3, alpha: 1 });
    G.events.push({ type: 'cheeseBob' });
    this.raise('splat');
    this.hit(big ? BOB.knockdown + 10 : BOB.stagger + 10, v2.copy(dir));
  }

  /**
   * Farm 3's bull ran him over: flung through the air, flat on his back (drops a pig he carries). False = he wasn't
   * there to be hit (asleep, away, already down).
   */
  bullHit(dir: THREE.Vector3): boolean {
    if (this.asleep || this.state === 'down' || this.state === 'off' || this.state === 'away') return false;
    this.stun('down', BOB.downTime + 1.6);
    const d = Math.hypot(dir.x, dir.z) || 1;
    this.body.setLinvel({ x: (dir.x / d) * 8, y: 7, z: (dir.z / d) * 8 }, true);
    this.body.setAngvel({ x: (dir.z / d) * 5, y: (Math.random() - 0.5) * 3, z: -(dir.x / d) * 5 }, true);
    this.parts.matchVelocity();
    this.voice('oof', 1);
    G.events.push({ type: 'bullBob' });
    return true;
  }

  /** He stepped in spilled milk (farm 3) / hurried across the ice (farm 5) / a flooded floor (a sink left running): feet up, flat on his back. */
  slip(on: 'milk' | 'ice' | 'water' = 'milk'): boolean {
    if (this.asleep || this.state === 'down' || this.state === 'off' || this.state === 'away' || this.riding) return false;
    if ((this.hitBy.get('slip') ?? -10) > this.now - 4) return false;
    this.hitBy.set('slip', this.now);
    this.stun('down', BOB.downTime);
    const f = this.forward;
    this.body.setLinvel({ x: f.x * 3.5, y: 3.5, z: f.z * 3.5 }, true);
    this.body.setAngvel({ x: -Math.cos(this.yaw) * 6, y: 0, z: Math.sin(this.yaw) * 6 }, true);   // feet fly forward, head back
    this.parts.matchVelocity();
    G.audio.play('whoosh', { pos: this.pos, vol: 1, pitch: 0.8 });
    if (on === 'ice') G.audio.play('icecrack', { pos: this.pos, vol: 0.8, pitch: 1.1 });
    G.events.push({ type: 'bobSlipped', text: on });
    return true;
  }

  /** Farm 5: he went through the ice-fishing hole — splash, out he scrambles, soaked and flat on his back. */
  dunked(): boolean {
    if (this.asleep || this.state === 'down' || this.state === 'off' || this.state === 'away') return false;
    if ((this.hitBy.get('dunk') ?? -10) > this.now - 6) return false;
    this.hitBy.set('dunk', this.now);
    this.stun('down', BOB.downTime + 1.2);
    this.body.setLinvel({ x: (Math.random() - 0.5) * 3, y: 6.5, z: (Math.random() - 0.5) * 3 }, true);
    this.parts.matchVelocity();
    this.voice('oof', 1);
    G.audio.play('splash', { pos: this.pos, vol: 1 });
    G.fx.bits(v1.copy(this.pos).setY(this.pos.y + 0.3), { count: 26, color: 0xbfe3ff, speed: 4, up: 4, grav: 12, life: 0.8, size: 0.1, grow: 0, alpha: 1 });
    G.events.push({ type: 'bobDunked' });
    this.raise('splat');
    return true;
  }

  /** Farm 5: a snowball he rolled into him: a big one (≥ 0.75 m) bowls him over, a small one staggers him. */
  private snowballed(dir: THREE.Vector3, r: number) {
    if ((this.hitBy.get('snowball') ?? -10) > this.now - 1) return;
    this.hitBy.set('snowball', this.now);
    G.audio.play('snowhit', { pos: this.pos, vol: 1, pitch: 0.7 });
    G.fx.puff(v1.copy(this.pos).setY(this.pos.y + 0.8), { count: 16, color: 0xffffff, speed: 3, up: 1.5, life: 1, size: 0.8, alpha: 0.85 });
    if (r >= 0.75) G.events.push({ type: 'bigSnowballBob' });
    this.raise('splat');
    this.hit(r >= 0.75 ? BOB.knockdown + 10 : BOB.stagger + 10, v2.copy(dir));
  }

  /** Farm 4's catapult landed a shot on him (a pumpkin, a hen, a pig…): knocked silly (stagger: drops a pig he carries). */
  catapulted(): boolean {
    if (this.asleep || this.state === 'off' || this.state === 'away') return false;
    if ((this.hitBy.get('catapult') ?? -10) > this.now - 1.5) return false;
    this.hitBy.set('catapult', this.now);
    G.events.push({ type: 'catapultBob' });
    this.raise('splat');
    this.voice('oof', 1);
    if (this.state !== 'stagger' && this.state !== 'down') this.stun('stagger', BOB.staggerTime + 0.6);
    return true;
  }

  /** He stepped on a mine (world/mines.ts): sky-high, then flat on his back (a knock-down); close by: a stagger. */
  mined(at: THREE.Vector3, onIt: boolean) {
    if (this.asleep || this.state === 'off' || this.state === 'away') return;
    if (!onIt) { this.startle(at); return; }
    if (this.carrying) this.release(false);
    this.voice('oops', 1);
    this.raise('down');
    G.events.push({ type: 'mineBob' });
    const dir = v2.set(this.pos.x - at.x + (Math.random() - 0.5) * 0.4, 0, this.pos.z - at.z + (Math.random() - 0.5) * 0.4).normalize();
    if (this.state !== 'down') this.hit(BOB.knockdown + 30, dir.clone());
    const lv = this.body.linvel();
    this.body.setLinvel({ x: lv.x + dir.x * 2, y: 10, z: lv.z + dir.z * 2 }, true);
    this.parts.matchVelocity?.();
    const look = at.clone();
    this.afterStun = () => { this.voice('grr'); this.startSearch(look, null, 3); };
  }
  /**
   * A pig's fart went up in a fireball next to him (s25, host): flat on his back, a pig he carries is dropped, his face
   * black with soot (smoking a while), then he hunts round the spot, fuming. Further out he only jumps (stagger).
   */
  fireballed(at: THREE.Vector3, close: boolean) {
    if (this.asleep || this.state === 'off' || this.state === 'away') return false;
    if (!close) return this.startle(at);
    if (this.carrying) this.release(false);
    this.sootUntil = this.now + 45;
    this.voice('oops', 1);
    this.raise('down');
    G.events.push({ type: 'bobFireball' });
    const dir = v2.set(this.pos.x - at.x + (Math.random() - 0.5) * 0.4, 0, this.pos.z - at.z + (Math.random() - 0.5) * 0.4).normalize();
    if (this.state !== 'down') this.hit(BOB.knockdown + 30, dir.clone());
    const lv = this.body.linvel();
    this.body.setLinvel({ x: lv.x + dir.x * 4.5, y: 6.5, z: lv.z + dir.z * 4.5 }, true);
    this.parts.matchVelocity?.();
    const look = at.clone();
    this.afterStun = () => { this.voice('grr'); this.startSearch(look, null, 3); };
    return true;
  }
  /** Soot on his face from a fireball (s25): until (his clock), synced. */
  sootUntil = 0; private sootFx = 0;
  /** A cherry bomb went off (host): right next to him he jumps out of his boots (stagger: drops a pig he carries). */
  startle(at: THREE.Vector3) {
    if (this.asleep || this.state === 'down' || this.state === 'off' || this.state === 'away') return false;
    if (Math.hypot(at.x - this.pos.x, at.z - this.pos.z) > 3.6 || Math.abs(at.y - this.pos.y - 0.8) > 2.5) return false;
    this.voice('oof', 1);
    G.fx.bits(v1.copy(this.pos).setY(this.pos.y + 2), { count: 8, color: 0xfff1a8, speed: 2.5, up: 2, life: 0.5, size: 0.16, grow: 0, drag: 3, alpha: 1 });
    this.stun('stagger', BOB.staggerTime + 0.8);
    return true;
  }

  /** A drunk pig threw up on him (beer mode): disgusted, he staggers back wiping himself. */
  vomitedOn(_p: Pig) {
    if (this.asleep || this.state === 'down' || this.state === 'off' || this.state === 'stagger') return;
    this.voice('oops', 1);
    G.fx.bits(v1.copy(this.pos).setY(this.pos.y + 1.2), { count: 14, color: 0xc9c24a, speed: 2, up: 1, life: 0.6, size: 0.08, grow: 0, alpha: 1 });
    this.raise('splat');
    G.events.push({ type: 'bobVomited' });
    this.stun('stagger', BOB.staggerTime);
  }
  /**
   * An angry bee swarm stings him (farm 2's hives): he yelps and flails (stagger: drops a pig he carries). Not again
   * for a moment, so a swarm on him is a run of stings, not a stun-lock.
   */
  stung(): boolean {
    if (this.asleep || this.state === 'down' || this.state === 'off' || this.state === 'away') return false;
    if ((this.hitBy.get('sting') ?? -10) > this.now - 2.6) return false;
    this.hitBy.set('sting', this.now);
    this.voice('oof', 1);
    G.audio.play('slap', { pos: this.pos, vol: 0.5, pitch: 1.6 });
    G.fx.bits(v1.copy(this.pos).setY(this.pos.y + 1.7), { count: 10, color: 0xffd23a, speed: 3, up: 2, life: 0.5, size: 0.1, grow: 0, drag: 3, alpha: 1 });
    G.events.push({ type: 'bobStung' });
    this.raise('splat');
    if (this.state !== 'stagger') this.stun('stagger', BOB.staggerTime + 0.5);
    return true;
  }

  private cough() {
    if (this.state === 'down' || this.state === 'stagger') return;
    this.stun('cough', BOB.cough);
    G.events.push({ type: 'bobCough' });
    this.raise('cough');
    G.audio.play('bob_cough', { pos: v1.copy(this.pos).setY(this.pos.y + 1.6), vol: 1, rand: 0.1 });
  }

  private checkClouds() {
    const cx = this.pos.x, cy = this.pos.y + 1.2, cz = this.pos.z;
    for (const c of G.clouds) {
      if (this.usedClouds.has(c) || c.kind === 'bang') continue;
      if (Math.hypot(c.x - cx, (c.y - cy) * 0.7, c.z - cz) < c.r * 0.8 + 0.3) {
        this.usedClouds.add(c);
        this.cough();
        return;
      }
    }
  }

  // ================================================================== movement helpers
  /** Follow a nav path to goal at speed; returns remaining straight distance. */
  private moveTo(goal: THREE.Vector3, speed: number, dt: number, replan = 5) {
    const dist = Math.hypot(goal.x - this.pos.x, goal.z - this.pos.z);
    const moved = Math.hypot(goal.x - this.pathGoal.x, goal.z - this.pathGoal.z);
    if (!this.path.length || moved > 1.5 || this.now - this.pathAt > replan) {
      const direct = this.nav.los(this.pos.x, this.pos.z, goal.x, goal.z);
      this.path = direct ? [goal.clone()] : (this.nav.path(this.pos, goal) ?? [goal.clone()]);
      this.pathGoal.copy(goal); this.pathAt = this.now;
    }
    let wp = this.path[0];
    while (wp && this.path.length > 1 && Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z) < 0.6) { this.path.shift(); wp = this.path[0]; }
    if (!wp) return dist;
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z, d = Math.hypot(dx, dz);
    const slow = this.path.length === 1 ? clamp(d / 1.2, 0.25, 1) : 1;
    if (d > 0.05) this.moveVel.set((dx / d) * speed * slow, 0, (dz / d) * speed * slow);
    // stuck → re-plan + sidestep for a moment
    this.stuckT += dt;
    if (this.stuckT > 1.2) {
      this.stuckT = 0;
      if (this.stuckRef.distanceTo(this.pos) < 0.4 && dist > 0.8) {
        this.stuck++; this.path = []; this.pathAt = -10;
        this.side.set(-dz, 0, dx).normalize().multiplyScalar(Math.random() < 0.5 ? -2.2 : 2.2); this.sideUntil = this.now + 0.6;
      } else this.stuck = 0;
      this.stuckRef.copy(this.pos);
    }
    if (this.now < this.sideUntil) this.moveVel.add(this.side);
    return dist;
  }

  private face(p: THREE.Vector3, dt: number, k: number) {
    this.yaw = dampAngle(this.yaw, Math.atan2(p.x - this.pos.x, p.z - this.pos.z), k, dt);
  }

  /** Bob's voice: real recorded grunts / laugh (+ optional extra recordings the user can drop in). */
  private voice(kind: string, vol = 1) {
    const at = v1.copy(this.pos).setY(this.pos.y + 1.7);
    const map: Record<string, string> = {
      huh: 'bob_huh', hey: 'bob_hey', grr: 'bob_grr', oof: 'bob_oof', ha: 'bob_laugh', yawn: 'yawn', snore: 'snore', mutter: '',
      hello: 'bob_hello', insult: 'bob_insult', win: 'bob_win', bye: 'bob_bye', oops: 'bob_oops',
    };
    let s = map[kind];
    // spoken lines (1–3 s) never overlap and don't repeat too often: in between, an angry line is just a grunt
    if (LINES.has(kind)) {
      if (this.now < this.lineUntil) { s = kind === 'hey' || kind === 'grr' ? 'bob_oof' : ''; vol *= 0.7; }
      else this.lineUntil = this.now + (kind === 'hey' || kind === 'grr' ? 4.5 : 3);
    }
    if (s) G.audio.play(s, { pos: at, vol, minGap: 0.35, rand: 0.04 });
    if (kind === 'hey' || kind === 'grr' || kind === 'insult') this.yell = 1;
  }
  /** When his next spoken line may start (voice). */
  private lineUntil = 0;

  // ================================================================== online
  /** Host → players: Bob's brain state as the visuals / HUD need it. */
  netState(n: number[], s: string[]) {
    n.push(this.stateT, this.yaw, this.vel.x, this.vel.y, this.vel.z, this.yell, this.lookYaw,
      this.carrying ? G.pigs.indexOf(this.carrying) : -1, this.target ? G.pigs.indexOf(this.target) : -1,
      this.riding ? 1 : 0, this.doing ? 1 : 0, this.choreIdx);
    for (const p of this.pigs) n.push(this.sus.get(p) ?? 0);
    this.parts.netState(n);
    const hp = this.grip.pos, bp = this.body.translation();
    const hl = this.carrying || this.heldProp ? v1.set(hp.x - bp.x, hp.y - bp.y, hp.z - bp.z).applyAxisAngle(UP, -this.yaw) : v1.set(0, 0, 0);
    n.push(Math.round(hl.x * 1000) / 1000, Math.round(hl.y * 1000) / 1000, Math.round(hl.z * 1000) / 1000);
    n.push(this.hunt ? G.pigs.indexOf(this.hunt) : -1, this.heldProp ? 1 : 0, Math.round(this.heat * 10) / 10, this.level, this.mudMarks, Math.max(0, Math.round((this.sootUntil - this.now) * 10) / 10));
    s.push(this.state, this.activity, this.debugAnim ?? '');
  }
  netApply(n: number[], s: string[], nb: number[] = n, alpha = 0) {
    if (!n.length) return;
    this.state = s[0] as State; this.activity = s[1]; this.debugAnim = (s[2] || null) as FarmerAnim | null;
    const lerpA = (a: number, b: number) => a + wrapAngle((b ?? a) - a) * alpha;
    this.stateT = n[0]; this.yaw = lerpA(n[1], nb[1]); this.vel.set(n[2], n[3], n[4]); this.yell = n[5]; this.lookYaw = lerpA(n[6], nb[6]);
    this.carrying = n[7] >= 0 ? G.pigs[n[7]] : null; this.target = n[8] >= 0 ? G.pigs[n[8]] : null;
    const riding = n[9] === 1;
    if (riding !== this.riding) { this.riding = riding; if (riding) this.mower.mount(this.visual.root); else this.mower.dismount(this.pos, this.yaw); }
    this.doing = n[10] === 1; this.choreIdx = n[11];
    this.pigs.forEach((p, i) => this.sus.set(p, n[12 + i] ?? 0));
    const at = 12 + this.pigs.length;
    this.parts.netApply(n, at);
    this.netHand.set(n[at + 15] ?? 0, n[at + 16] ?? 0, n[at + 17] ?? 0);
    this.hunt = (n[at + 18] ?? -1) >= 0 ? G.pigs[n[at + 18]] : null;
    this.netHolding = n[at + 19] === 1;
    this.heat = n[at + 20] ?? 0;
    this.level = n[at + 21] ?? 0;   // the 'alert' event itself comes with the host's recorded events
    if ((n[at + 22] ?? 0) !== this.mudMarks) this.setMud(n[at + 22] ?? 0);
    this.sootUntil = this.now + (n[at + 23] ?? 0);
    this.visual.root.visible = !this.asleep;
  }
  netPose(p: THREE.Vector3) { this.pos.copy(p).setY(p.y - CENTER); }

  // ================================================================== render
  render(alpha: number, dt: number) {
    if (this.asleep) { this.flash.intensity = 0; return; }
    this.updateMoodCloud(dt);
    const r = this.visual.root;
    // knocked down: the whole body follows the physics torso; otherwise upright, facing his heading
    const limp = this.state === 'down';
    if (limp) this.synced.rot(alpha, this.tq); else this.tq.setFromAxisAngle(UP, this.yaw);
    this.vq.slerp(this.tq, 1 - Math.exp(-(limp ? 40 : 30) * dt));
    if (limp) for (let i = 0; i < 5; i++) this.parts.rel(i, this.relQ[i], G.net === 'client');
    this.synced.pos(alpha, r.position);
    r.position.sub(v1.set(0, CENTER, 0).applyQuaternion(this.vq));
    r.quaternion.copy(this.vq);
    if (this.state === 'hammock' && G.hammock) { (G.hammock as Hammock).bobPose(r.position, r.quaternion); this.vq.copy(r.quaternion); }
    let hand: THREE.Vector3 | null = null;
    const holding = !!this.carrying || (G.net === 'client' ? this.netHolding : !!this.heldProp);
    if (holding) {
      if (G.net === 'client') hand = this.handM.copy(this.netHand);
      else { const hp = this.grip.pos, bp = this.synced.currP; hand = this.handM.set(hp.x - bp.x, hp.y - bp.y, hp.z - bp.z).applyAxisAngle(UP, -this.yaw); }
      hand.y += CENTER;
    }
    const anim = this.animFor();
    const fl = this.flashlightOn && !this.riding;
    this.flash.intensity = fl ? 60 : 0;
    if (this.riding && G.net === 'client') this.mower.showRide(this.pos, this.yaw, Math.hypot(this.vel.x, this.vel.z), dt);
    this.visual.update({
      speed: Math.hypot(this.vel.x, this.vel.z), run: this.chasing || this.state === 'chase' || this.state === 'shoo' || this.state === 'cool', anim, at: this.now - this.stateT,
      t: this.now, dt, angry: this.chasing || this.state === 'carry' || this.state === 'fist' || this.state === 'shoo' ? 1 : this.state === 'suspect' ? 0.5 : 0,
      yell: this.yell, lookYaw: this.lookYaw, carrying: holding, flashlight: fl, limp, rel: this.relQ, hand,
      weapon: this.weapon, fury: this.state === 'hot' || this.state === 'cool' ? 1 : this.level / 3,
      sip: anim === 'sip' ? (this.now - ((G.porch as Porch | null)?.sipT0 ?? 0)) / COFFEE.sip : 0,
      fire: (G.porch as Porch | null)?.spat ?? 0, soot: Math.min(1, Math.max(0, (this.sootUntil - this.now) / 8)),
    });
    // fresh soot: his hair still smokes a while
    if (this.sootUntil - this.now > 30 && this.now > this.sootFx) {
      this.sootFx = this.now + 0.28;
      G.fx.puff(this.visual.headPos(v1).setY(v1.y + 0.35), { count: 1, color: 0x55524e, spread: 0.12, speed: 0.3, up: 1.1, life: 1.4, size: 0.35, grow: 1.2, drag: 1, alpha: 0.45 });
    }
  }

  /** A cartoon storm cloud that follows grumpy Bob around (drizzle + an odd flicker). */
  private buildMoodCloud() {
    const g = new THREE.Group(); g.position.set(0, 2.75, 0); g.visible = false;
    const m = toonMat(0x5c6370), ball = new THREE.SphereGeometry(1, 14, 10);
    for (const [x, y, z, r] of [[0, 0, 0, 0.3], [0.3, -0.05, 0.05, 0.22], [-0.3, -0.04, -0.02, 0.24], [0.08, 0.14, -0.08, 0.22], [-0.12, -0.1, 0.16, 0.2]]) {
      const b = new THREE.Mesh(ball, m); b.position.set(x, y, z); b.scale.set(r * 1.25, r, r); b.castShadow = false; g.add(b);
    }
    const dm = new THREE.MeshBasicMaterial({ color: 0x8fc4ff }), dg = new THREE.CapsuleGeometry(0.018, 0.08, 2, 6);
    for (let i = 0; i < 5; i++) { const d = new THREE.Mesh(dg, dm); d.userData.ph = i / 5; g.add(d); this.moodDrops.push(d); }
    return g;
  }
  private updateMoodCloud(dt: number) {
    const on = G.mod === 'grumpy' && this.state !== 'down';
    this.moodCloud.visible = on;
    if (!on) return;
    const c = this.moodCloud, t = this.now;
    c.position.y = 2.75 + Math.sin(t * 2.1) * 0.05 + (this.lying ? -1 : 0);
    c.rotation.y += dt * 0.6;
    this.moodDrops.forEach((d, i) => {
      const ph = (t * 1.4 + d.userData.ph) % 1;
      const a = i * 2.4;
      d.position.set(Math.cos(a) * 0.2, -0.2 - ph * 0.65, Math.sin(a) * 0.15);
      d.visible = ph < 0.9;
    });
    const m = (c.children[0] as THREE.Mesh).material as THREE.MeshToonMaterial;
    m.emissive.setHex(this.level >= 2 && Math.sin(t * 9) > 0.96 ? 0x9a9a60 : 0x000000);   // grumbling flicker
  }

  private animFor(): FarmerAnim {
    if (this.debugAnim) return this.debugAnim;
    switch (this.state) {
      case 'routine': return this.riding ? 'ride' : this.doing ? ((G.porch as Porch | null)?.phase === 2 && this.chores[this.choreIdx].id === 'paper' ? 'sip' : this.chores[this.choreIdx].anim) : 'idle';
      case 'search': return 'look';
      case 'suspect': return 'suspect';
      case 'windup': return 'windup';
      case 'lunge': return 'lunge';
      case 'recover': return 'recover';
      case 'carry': return 'carry';
      case 'tidy': return (G.net === 'client' ? this.netHolding : this.heldProp) ? 'carry' : 'idle';
      case 'dust': return 'dust';
      case 'stagger': return 'stagger';
      case 'down': return 'down';
      case 'cough': return 'cough';
      case 'fist': return 'fist';
      case 'pant': return 'pant';
      case 'slapWind': return 'slapWind';
      case 'slap': return 'slap';
      case 'taunt': return 'taunt';
      case 'dance': return 'dance';
      case 'aim': return 'aim';
      case 'shoot': return 'shoot';
      case 'setTrap': case 'gate': case 'job': return this.doing ? 'fix' : 'idle';
      case 'onPhone': return 'phone';
      case 'hammock': return 'hammock';
      case 'hot': case 'cool': return 'hot';
      case 'dunk': return 'dunk';
      default: return 'idle';
    }
  }
}
