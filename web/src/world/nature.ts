import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonMat } from '../render/toon';
import { Rng } from '../core/util';

/** Cartoon vegetation built from smooth blobs (cel shaded, instanced: one draw call per variant). */
export type TreeKind = 'oak' | 'pine' | 'apple' | 'poplar' | 'bush' | 'flowerBush' | 'hedge';

const rng = new Rng(4242);
function part(g: THREE.BufferGeometry, color: number, m: THREE.Matrix4) {
  const ng = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(m);
  ng.deleteAttribute('uv');
  const c = new THREE.Color(color), n = ng.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  ng.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return ng;
}
const M = (x: number, y: number, z: number, sx = 1, sy = sx, sz = sx, ry = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz));

const BLOB = new THREE.IcosahedronGeometry(1, 2);
const TRUNK = new THREE.CylinderGeometry(0.2, 0.3, 1, 10);
const CONE = new THREE.ConeGeometry(1, 1, 12);
const BALL = new THREE.SphereGeometry(1, 8, 6);
const GREENS = [0x5cb83d, 0x4fa636, 0x6cc447, 0x58b043];

function variant(kind: TreeKind): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const g = () => GREENS[rng.int(0, GREENS.length - 1)];
  if (kind === 'oak' || kind === 'apple') {
    const h = kind === 'apple' ? 1.6 : 2.4;
    parts.push(part(TRUNK, 0x8a5a35, M(0, h / 2, 0, 1, h, 1)));
    const n = kind === 'apple' ? 4 : 5;
    const blobs: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.range(0, 0.6), r = i === 0 ? 0 : rng.range(0.7, 1.1);
      const s = (kind === 'apple' ? 1.1 : 1.45) * rng.range(0.85, 1.15) * (i === 0 ? 1.15 : 1);
      const p = new THREE.Vector3(Math.cos(a) * r, h + (kind === 'apple' ? 0.9 : 1.3) + rng.range(-0.2, 0.5) + (i === 0 ? 0.5 : 0), Math.sin(a) * r);
      blobs.push(p.clone().setY(p.y).multiplyScalar(1));
      parts.push(part(BLOB, g(), M(p.x, p.y, p.z, s, s * 0.9, s)));
    }
    if (kind === 'apple') for (let i = 0; i < 14; i++) {
      const b = blobs[rng.int(0, blobs.length - 1)], d = new THREE.Vector3(rng.range(-1, 1), rng.range(-0.3, 1), rng.range(-1, 1)).normalize();
      parts.push(part(BALL, 0xe8322f, M(b.x + d.x * 1.05, b.y + d.y * 0.95, b.z + d.z * 1.05, 0.13)));
    }
  } else if (kind === 'pine') {
    parts.push(part(TRUNK, 0x7a4b2a, M(0, 0.6, 0, 0.9, 1.2, 0.9)));
    const col = rng.next() < 0.5 ? 0x2f8a4a : 0x3a9a50;
    for (let i = 0; i < 3; i++) parts.push(part(CONE, col, M(0, 1.6 + i * 1.15, 0, 1.7 - i * 0.42, 1.9, 1.7 - i * 0.42)));
  } else if (kind === 'poplar') {
    parts.push(part(TRUNK, 0x8a5a35, M(0, 1, 0, 0.8, 2, 0.8)));
    parts.push(part(BLOB, g(), M(0, 3.6, 0, 1.15, 2.6, 1.15)));
  } else if (kind === 'hedge') {
    for (let i = 0; i < 4; i++) parts.push(part(BLOB, g(), M((i - 1.5) * 0.9, 0.6 + rng.range(-0.05, 0.15), rng.range(-0.1, 0.1), 0.75, 0.75, 0.7)));
  } else {
    const n = rng.int(3, 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.28, r = i === 0 ? 0 : 0.45;
      parts.push(part(BLOB, g(), M(Math.cos(a) * r, 0.5 + (i === 0 ? 0.2 : 0), Math.sin(a) * r, rng.range(0.5, 0.7))));
    }
    if (kind === 'flowerBush') for (let i = 0; i < 10; i++) {
      const d = new THREE.Vector3(rng.range(-1, 1), rng.range(0, 1), rng.range(-1, 1)).normalize();
      parts.push(part(BALL, rng.next() < 0.5 ? 0xff7fb5 : 0xffe066, M(d.x * 0.75, 0.55 + d.y * 0.6, d.z * 0.75, 0.09)));
    }
  }
  return mergeGeometries(parts)!;
}

export class Forest {
  private items = new Map<string, THREE.Matrix4[]>();
  private geos = new Map<string, THREE.BufferGeometry>();
  private mat = toonMat(0xffffff, { vertexColors: true });

  add(kind: TreeKind, x: number, y: number, z: number, scale = 1, yaw = rng.range(0, 6.28)) {
    const key = kind + ':' + rng.int(0, kind === 'hedge' ? 1 : 2);   // a few shapes per kind
    if (!this.geos.has(key)) this.geos.set(key, variant(kind));
    if (!this.items.has(key)) this.items.set(key, []);
    this.items.get(key)!.push(M(x, y - 0.05, z, scale, scale, scale, yaw));
  }

  finish(scene: THREE.Scene) {
    for (const [key, mats] of this.items) {
      const im = new THREE.InstancedMesh(this.geos.get(key)!, this.mat, mats.length);
      mats.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = true; im.receiveShadow = true;
      im.computeBoundingSphere();
      scene.add(im);
    }
  }
}

/** Round hay bale (procedural model for a rollable prop). */
export function hayBale(): THREE.Object3D {
  const g = new THREE.Group();
  const straw = toonMat(0xe9c46a), dark = toonMat(0xc99a3e);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.95, 24), straw);
  body.rotation.z = Math.PI / 2; body.castShadow = body.receiveShadow = true; g.add(body);
  for (const x of [-0.25, 0.25]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.565, 0.565, 0.06, 24), dark);
    band.rotation.z = Math.PI / 2; band.position.x = x; band.castShadow = true; g.add(band);
  }
  const swirl = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.03, 6, 20), dark);
  swirl.rotation.y = Math.PI / 2; swirl.position.x = 0.48; g.add(swirl);
  const sw2 = swirl.clone(); sw2.position.x = -0.48; g.add(sw2);
  return g;
}
