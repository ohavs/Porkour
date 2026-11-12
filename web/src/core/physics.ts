import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export { RAPIER };
export let world: RAPIER.World;
export const eventQueue = () => queue;
let queue: RAPIER.EventQueue;

/** Collision layers (membership bits). */
export const L = { STATIC: 1, PIG: 2, PROP: 4, CRITTER: 8, FARMER: 16 } as const;
const ALL = 0xffff;
export const groups = (member: number, filter = ALL) => (member << 16) | filter;

/** Anything a collider belongs to (pig, prop, critter…). */
export const owners = new Map<number, any>();

/** Pairs that must not collide (carrier ↔ held object). */
const ignored = new Set<string>();
const key = (a: number, b: number) => (a < b ? a + ':' + b : b + ':' + a);
export function ignorePair(a: RAPIER.RigidBody, b: RAPIER.RigidBody, on: boolean) {
  const k = key(a.handle, b.handle);
  if (on) ignored.add(k); else ignored.delete(k);
}
const hooks: RAPIER.PhysicsHooks = {
  filterContactPair(_c1, _c2, b1, b2) {
    return ignored.has(key(b1, b2)) ? null : RAPIER.SolverFlags.COMPUTE_IMPULSE;
  },
  filterIntersectionPair() { return true; },
};

export async function initPhysics() {
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: -20, z: 0 });
  world.timestep = 1 / 60;
  queue = new RAPIER.EventQueue(true);
}

export function step(onForce?: (h1: number, h2: number, force: number) => void) {
  world.step(queue, hooks);
  queue.drainContactForceEvents((e) => onForce?.(e.collider1(), e.collider2(), e.totalForceMagnitude()));
  queue.drainCollisionEvents(() => {});
}

/** Colliders that may need the filter hook. */
export const HOOKS = RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS;

export function staticBox(center: THREE.Vector3, half: THREE.Vector3, yaw = 0, friction = 0.6) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z).setRotation(q));
  world.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setFriction(friction)
    .setCollisionGroups(groups(L.STATIC)), body);
  return body;
}
export function staticCylinder(center: THREE.Vector3, halfH: number, r: number) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z));
  world.createCollider(RAPIER.ColliderDesc.cylinder(halfH, r).setCollisionGroups(groups(L.STATIC)), body);
  return body;
}

/** Fixed trimesh collider from every mesh under an object (world space). */
export function staticTrimesh(obj: THREE.Object3D) {
  obj.updateMatrixWorld(true);
  const verts: number[] = [], idx: number[] = [];
  const v = new THREE.Vector3();
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry, pos = g.attributes.position, base = verts.length / 3;
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); verts.push(v.x, v.y, v.z); }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
    else for (let i = 0; i < pos.count; i++) idx.push(base + i);
  });
  if (!idx.length) return null;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(idx)).setFriction(0.6)
    .setCollisionGroups(groups(L.STATIC)), body);
  return body;
}

const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
/** Ray cast; returns distance + normal + collider or null. */
export function raycast(from: THREE.Vector3, dir: THREE.Vector3, max: number, filter = ALL,
  excludeBody?: RAPIER.RigidBody, pred?: (c: RAPIER.Collider) => boolean) {
  ray.origin = { x: from.x, y: from.y, z: from.z };
  ray.dir = { x: dir.x, y: dir.y, z: dir.z };
  const hit = world.castRayAndGetNormal(ray, max, true, undefined, (ALL << 16) | filter, undefined, excludeBody, pred);
  if (!hit) return null;
  return { dist: hit.timeOfImpact, normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z), collider: hit.collider };
}

export const toV = (v: { x: number; y: number; z: number }, out = new THREE.Vector3()) => out.set(v.x, v.y, v.z);
export const toQ = (q: { x: number; y: number; z: number; w: number }, out = new THREE.Quaternion()) => out.set(q.x, q.y, q.z, q.w);
