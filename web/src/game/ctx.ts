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

export interface Noise { x: number; y: number; z: number; radius: number; t: number }
export interface Cloud { x: number; y: number; z: number; r: number; until: number }

/** Shared game context (set up once in Game). */
export const G = {
  time: 0,
  fx: null as unknown as Fx,
  audio: null as unknown as Audio,
  terrain: null as unknown as Terrain,
  holdables: [] as Holdable[],
  noises: [] as Noise[],
  clouds: [] as Cloud[],
  localPig: null as any,
  noise(p: THREE.Vector3, radius: number) {
    this.noises.push({ x: p.x, y: p.y, z: p.z, radius, t: this.time });
    if (this.noises.length > 40) this.noises.shift();
  },
};
