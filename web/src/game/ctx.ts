import type * as THREE from 'three';
import type { Fx } from '../render/fx';
import type { Audio } from '../core/audio';
import type { Terrain } from '../world/terrain';
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
export interface Cloud { x: number; y: number; z: number; r: number; until: number }
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
};

/** Shared game context (set up once in Game). */
export const G = {
  time: 0,
  /** Clock: hour of day 0..24 and day number. 1 game hour = SECS_PER_HOUR real seconds. */
  hour: 7, day: 1,
  /** 0 = full day, 1 = full night (smooth over dusk / dawn). */
  night: 0,
  fx: null as unknown as Fx,
  audio: null as unknown as Audio,
  terrain: null as unknown as Terrain,
  holdables: [] as Holdable[],
  noises: [] as Noise[],
  clouds: [] as Cloud[],
  localPig: null as any,
  pigs: [] as any[],
  farmer: null as any,
  wolves: [] as any[],
  cage: null as any,
  events: [] as GameEvent[],
  /** Times a pig got grilled this round. */
  grills: 0,
  noise(p: THREE.Vector3, radius: number) {
    this.noises.push({ x: p.x, y: p.y, z: p.z, radius, t: this.time });
    if (this.noises.length > 40) this.noises.shift();
  },
};

export const SECS_PER_HOUR = 25;   // 24 h = 10 min
/** Night between these hours (dusk / dawn ramps around them). */
export const DUSK = 20, DAWN = 5.5;
