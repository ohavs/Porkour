import type * as THREE from 'three';
import type { Fx } from '../render/fx';
import type { Audio } from '../core/audio';
import type { Terrain } from '../world/terrain';
import { CoverMap } from '../world/cover';
import type RAPIER from '@dimforge/rapier3d-compat';

/** Anything a pig can pick up / drag / throw. */
export interface Holdable {
  kind: 'pig' | 'prop' | 'critter';
  body: RAPIER.RigidBody;
  mass: number;
  radius: number;
  heldBy: any;
  label?: string;
  onGrabbed?(by: any): void;
  onReleased?(by: any, thrown: boolean): void;
  /** Hit hard by something (ram, blast, fast object). */
  knock?(impulse: THREE.Vector3, ragdoll: boolean): void;
}

/** Something that can carry a pig (another pig, the farmer, a wolf). */
export interface Carrier {
  kind: string;
  release(thrown: boolean): void;
  escapeNeed?(p: any): number;
  fartedOn?(p: any): void;
}

export interface Noise { x: number; y: number; z: number; radius: number; t: number }
/** Fart / stink cloud (Bob coughs, animals run) or a cherry bomb's bang (`kind` 'bang': animals run, no cough). */
export interface Cloud { x: number; y: number; z: number; r: number; until: number; kind?: 'bang' | 'stink' }
/** Things the HUD / round logic react to. */
export interface GameEvent { type: string; why?: string; who?: any; text?: string }

/** Test / admin switches (admin panel, `?admin=1`). */
export const ADMIN = {
  open: false,
  bob: true,            // Bob active
  bobSees: true,        // false = Bob ignores the local pig
  god: false,           // nothing can catch the local pig
  easyEscape: false,    // 1 mash frees you
  noCooldowns: false,
  freezeTime: false,
  bbqTime: 90,          // seconds until a caged pig is grilled
  daySpeed: 1,          // × clock speed
  gameSpeed: 1,         // × simulation speed
  netLag: 0,            // online test: extra delay (ms) on everything this browser sends
  predict: true,        // online player: move my own pig on my machine at once (client-side prediction)
  roundMins: 10,        // round length (minutes)
  showSight: false,     // HUD line: does Bob see me right now
  mod: 'random',        // next round's modifier: random or a fixed one (admin)
};

/** Shared game context (set up once in Game). */
export const G = {
  time: 0,
  /** Clock: hour of day 0..24 and day number. 1 game hour = G.secsPerHour real seconds (SECS_PER_HOUR by default). */
  hour: 7, day: 1,
  /** 0 = full day, 1 = full night (smooth over dusk / dawn). */
  night: 0,
  fx: null as unknown as Fx,
  audio: null as unknown as Audio,
  terrain: null as unknown as Terrain,
  /** Bushes / crops / hay pigs can hide in (Bob can't see through). */
  cover: new CoverMap(),
  holdables: [] as Holdable[],
  /** Every loose prop (also the hidden ones: banked loot, pooled gadgets). */
  props: [] as any[],
  noises: [] as Noise[],
  clouds: [] as Cloud[],
  localPig: null as any,
  pigs: [] as any[],
  farmer: null as any,
  /** In the lobby (menus around a little stage): idle pigs turn to face the mouse aim. */
  lobby: false,
  wolves: [] as any[],
  cage: null as any,
  /** Bob's bear traps (world/traps.ts). */
  traps: null as any,
  /** Pen gates (world/gates.ts). */
  gates: null as any,
  /** Bob's outhouses (world/outhouse.ts). */
  loos: [] as any[],
  /** Static farm things a punch / headbutt / whack can hit (orchard trees, beehives): true = something was hit. */
  hittables: [] as { hit(x: number, y: number, z: number, reach: number, dir: THREE.Vector3, k: number, by: unknown): boolean }[],
  /** Farm things Bob fixes when he notices them (farm 4's jack-o'-lanterns): `spot(bob)` → a BobJob or null. */
  jobs: [] as { spot(bob: any): unknown }[],
  /** Farm 4: is this spot lit at night (a jack-o'-lantern's glow)? Bob sees a pig there like by day. */
  litAt: null as null | ((x: number, z: number) => boolean),
  /** Farm 5 (winter): the ground is snow (a wallow = a snow-white coat, footprints, snowballs). */
  snowy: false,
  /** Farm 5: is this spot ice (pigs and Bob slide, Bob slips when he hurries)? */
  iceAt: null as null | ((x: number, z: number) => boolean),
  /** Things that lead Bob somewhere (farm 5's footprints in the snow): `spot(bob)` → where to look, or null. */
  clues: [] as { spot(bob: any): THREE.Vector3 | null }[],
  /** Real seconds per game hour (farm 4's night runs slower so a round stays between dusk and dawn). */
  secsPerHour: 25,
  /** Named spots of the current farm (world/farmKit.ts Places). */
  places: null as null | import('../world/farmKit').Places,
  events: [] as GameEvent[],
  /** Times a pig got grilled this round. */
  grills: 0,
  /** This round's modifier (game/modifiers.ts): set by the round on the host, from snapshots on players. */
  mod: 'none' as 'none' | 'rain' | 'fog' | 'grumpy' | 'market',
  /** Online role of this browser: solo, host (runs the world) or client (shows the host's world). */
  net: 'solo' as 'solo' | 'host' | 'client',
  /** Host: sounds / particles / shakes of the current fixed step, recorded for the players. */
  rec: null as null | { sounds: unknown[]; fx: unknown[]; ev: unknown[]; shakes: unknown[] },
  /** Client: drop local side effects while a snapshot is applied. */
  mute: false,
  /** Screen shake for the player of this pig (sent over the network when it's someone else's pig). */
  shakeFor(pig: unknown, amount: number) {
    if (pig === this.localPig) this.fx.shake(amount);
    else if (this.rec) { const i = this.pigs.indexOf(pig); if (i >= 0) this.rec.shakes.push([i, amount]); }
  },
  noise(p: THREE.Vector3, radius: number) {
    this.noises.push({ x: p.x, y: p.y, z: p.z, radius, t: this.time });
    if (this.noises.length > 40) this.noises.shift();
  },
};

export const SECS_PER_HOUR = 25;   // 24 h = 10 min
/** Night between these hours (dusk / dawn ramps around them). */
export const DUSK = 20, DAWN = 5.5;
