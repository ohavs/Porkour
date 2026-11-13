import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { toonify } from '../render/toon';

const loader = new GLTFLoader();
const gltfs = new Map<string, GLTF>();
const BASE = './assets/';

/**
 * Per-model colour fixes (material name → colour) so packs match the farm's palette. Kenney's nature kit is
 * mint-teal "grass" + peach "dirt": corn leaves would be teal, wheat white, rocks peach.
 */
const PALETTE: Record<string, Record<string, number>> = {
  'kenney/crops_cornStageD': { grass: 0x5fae35 },
  'kenney/crops_cornStageB': { grass: 0x5fae35 },
  'kenney/crops_wheatStageB': { woodInner: 0xe2b84a, _defaultMat: 0xc99a3e },
  'kenney/rock_largeA': { dirt: 0x9b958e, grass: 0x6bb547 },
  'kenney/rock_smallA': { dirt: 0x9b958e, grass: 0x6bb547 },
};
function repaint(name: string, root: THREE.Object3D) {
  const p = PALETTE[name]; if (!p) return;
  root.traverse((o) => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const c = p[mat.name]; const s = mat as THREE.MeshStandardMaterial;
      if (c !== undefined && s.color) s.color.setHex(c);
    }
  });
}

export async function preload(names: string[], onProgress: (f: number) => void) {
  let done = 0;
  await Promise.all(names.map(async (n) => {
    try { const g = await loader.loadAsync(BASE + n + '.glb'); repaint(n, g.scene); toonify(g.scene); gltfs.set(n, g); }
    catch (e) { console.warn('model missing', n, e); }
    onProgress(++done / names.length);
  }));
}

export function has(name: string) { return gltfs.has(name); }
export function gltf(name: string): GLTF | undefined { return gltfs.get(name); }

/** Fresh copy of a model with shadows on. Skinned models are cloned with their skeleton. */
export function instance(name: string, opts: { cast?: boolean; receive?: boolean } = {}): THREE.Object3D {
  const g = gltfs.get(name);
  if (!g) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xff00ff }));
    m.name = 'missing:' + name; return m;
  }
  let skinned = false;
  g.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true; });
  const obj = skinned ? skeletonClone(g.scene) : g.scene.clone(true);
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.castShadow = opts.cast ?? true; m.receiveShadow = opts.receive ?? true; }
  });
  return obj;
}

/** Wrap a model so that its bounding box base sits at y=0, centred on x/z, scaled to a height (or uniform scale). */
export function fitted(name: string, o: { height?: number; scale?: number; width?: number; center?: boolean; cast?: boolean } = {}) {
  const model = instance(name, { cast: o.cast });
  const holder = new THREE.Group(); holder.name = name;
  holder.add(model);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  let s = o.scale ?? 1;
  if (o.height) s = o.height / Math.max(size.y, 1e-4);
  if (o.width) s = o.width / Math.max(size.x, size.z, 1e-4);
  model.scale.multiplyScalar(s);
  const c = box.getCenter(new THREE.Vector3());
  model.position.set(o.center === false ? 0 : -c.x * s, -box.min.y * s, o.center === false ? 0 : -c.z * s);
  holder.userData.size = size.multiplyScalar(s);
  return holder;
}

/** Bounding box size of an object in its local frame (after fitting). */
export function sizeOf(o: THREE.Object3D): THREE.Vector3 {
  if (o.userData.size) return (o.userData.size as THREE.Vector3).clone();
  return new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
}
