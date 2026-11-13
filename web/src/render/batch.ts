import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Draw-call reduction (the look stays exactly the same):
 *  - `instanceStatic`: every copy of the same static model part (corn, fence planks, flowers, rocks…) becomes one
 *    InstancedMesh per area chunk → one draw call instead of hundreds (and one in the shadow pass).
 *  - `rigidSkin`: a procedural model (animals, Bob, pigs, decor) becomes one skinned mesh whose bones are its own
 *    pivots, so the code that animates them keeps working.
 */

const CHUNK = 36;
const tmpM = new THREE.Matrix4();
const tmpS = new THREE.Vector3();

/** Instanced chunks of small things (flowers, rocks, crops): hidden beyond the graphics "detail distance". */
const DETAIL: THREE.InstancedMesh[] = [];
/** Show small static things only within `dist` metres of the camera (per chunk, so it costs nothing). */
export function cullDetail(cam: THREE.Vector3, dist: number) {
  for (const m of DETAIL) {
    const s = m.boundingSphere!;
    m.visible = dist === Infinity || s.center.distanceTo(cam) - s.radius * 0.5 < dist;
  }
}

function anyAncestorIn(o: THREE.Object3D, set: Set<THREE.Object3D>, stop: THREE.Object3D) {
  for (let c: THREE.Object3D | null = o; c && c !== stop.parent; c = c.parent) if (set.has(c)) return true;
  return false;
}
function visibleUpTo(o: THREE.Object3D, stop: THREE.Object3D) {
  for (let c: THREE.Object3D | null = o; c && c !== stop.parent; c = c.parent) if (!c.visible) return false;
  return true;
}
const matKey = (m: THREE.Material | THREE.Material[]) => (Array.isArray(m) ? m.map((x) => x.uuid).join(',') : m.uuid);

/**
 * Replace repeated static meshes under `roots` with chunked InstancedMeshes. `keep` = subtrees that move (windmill
 * blades). Roots left without meshes are removed from the scene. Returns the number of meshes replaced.
 */
export function instanceStatic(scene: THREE.Scene, roots: THREE.Object3D[], keep = new Set<THREE.Object3D>()) {
  const groups = new Map<string, { mesh: THREE.Mesh; world: THREE.Matrix4 }[]>();
  for (const r of roots) {
    r.updateMatrixWorld(true);
    r.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || m.morphTargetInfluences) return;
      if (anyAncestorIn(m, keep, r) || !visibleUpTo(m, r)) return;
      if (m.matrixWorld.determinant() < 0) return;           // mirrored copies flip winding: leave them alone
      const k = `${m.geometry.uuid}|${matKey(m.material)}|${+m.castShadow}${+m.receiveShadow}|${m.renderOrder}`;
      let g = groups.get(k); if (!g) groups.set(k, (g = []));
      g.push({ mesh: m, world: m.matrixWorld.clone() });
    });
  }
  let replaced = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const cells = new Map<string, typeof list>();
    const p = new THREE.Vector3();
    for (const it of list) {
      p.setFromMatrixPosition(it.world);
      const ck = `${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)}`;
      let c = cells.get(ck); if (!c) cells.set(ck, (c = []));
      c.push(it);
    }
    const src = list[0].mesh;
    if (!src.geometry.boundingSphere) src.geometry.computeBoundingSphere();
    tmpS.setFromMatrixScale(list[0].world);
    const small = src.geometry.boundingSphere!.radius * Math.max(tmpS.x, tmpS.y, tmpS.z) < 0.5;
    for (const items of cells.values()) {
      const im = new THREE.InstancedMesh(src.geometry, src.material, items.length);
      items.forEach((it, i) => im.setMatrixAt(i, it.world));
      im.castShadow = src.castShadow; im.receiveShadow = src.receiveShadow; im.renderOrder = src.renderOrder;
      im.name = 'inst:' + (src.name || 'mesh');
      im.computeBoundingSphere();
      im.matrixAutoUpdate = false; im.updateMatrix();
      scene.add(im);
      if (small) DETAIL.push(im);
    }
    for (const it of list) it.mesh.removeFromParent();
    replaced += list.length;
  }
  // roots that only had instanced parts are now empty shells
  for (const r of roots) {
    let meshes = 0;
    r.traverse((o) => { if ((o as THREE.Mesh).isMesh || (o as THREE.Light).isLight) meshes++; });
    if (!meshes) r.removeFromParent();
    else r.traverse((o) => { if (!anyAncestorIn(o, keep, r)) { o.matrixAutoUpdate = false; } });
  }
  return replaced;
}

const vcMats = new Map<string, THREE.MeshToonMaterial>();
/**
 * Plain cel-shaded colours (no texture, opaque) can share one material: the colour moves into the vertices.
 * Returns the key + shared material, or null when the material must stay as it is.
 */
function plain(m: THREE.Material, keepMats: Set<THREE.Material>) {
  const t = m as THREE.MeshToonMaterial;
  if (!t.isMeshToonMaterial || keepMats.has(m) || t.map || t.emissiveMap || t.alphaMap || t.transparent || t.alphaTest || t.wireframe ||
    t.vertexColors || t.opacity !== 1 || t.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return null;
  const key = `vc|${t.side}|${t.emissive.getHexString()}|${t.emissiveIntensity}|${t.gradientMap?.uuid}`;
  let vm = vcMats.get(key);
  if (!vm) {
    vm = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, side: t.side, gradientMap: t.gradientMap, emissive: t.emissive.clone(), emissiveIntensity: t.emissiveIntensity });
    vcMats.set(key, vm);
  }
  return { key, mat: vm };
}

/** Geometry → indexed position / normal (+ colour) in the target space, with a rigid skin weight to one bone. */
function bake(g: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.Color | null, bone: number) {
  if (!g.getAttribute('normal')) return null;          // (draw groups only matter for multi-material meshes, skipped earlier)
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.getAttribute('position').clone());
  out.setAttribute('normal', g.getAttribute('normal').clone());
  const n = out.getAttribute('position').count;
  if (color) {
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = color.r; c[i * 3 + 1] = color.g; c[i * 3 + 2] = color.b; }
    out.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = bone; sw[i * 4] = 1; }
  out.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  out.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const idx = g.index ? Array.from(g.index.array) : Array.from({ length: n }, (_, i) => i);
  if (matrix.determinant() < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  out.setIndex(idx);
  out.applyMatrix4(matrix);
  return out;
}

/**
 * One mesh per character (per special material) instead of dozens: every mesh under `root` is baked into a shared
 * SkinnedMesh whose bones are the existing pivots (head, legs, ears, eyes…) with a rigid weight of 1. The code that
 * animates the pivots keeps working unchanged; the GPU moves the vertices. Plain colours share one vertex-colour
 * material. Stay separate: meshes in `keep` (moved / swapped by code) and their subtrees, named meshes, hidden
 * subtrees (tools that get shown later), textured / transparent ones, and materials in `keepMats` (recoloured live
 * — mud, blush, burn — those get their own skinned mesh so the colour change still works).
 */
export function rigidSkin(root: THREE.Object3D, keep = new Set<THREE.Object3D>(), keepMats = new Set<THREE.Material>()) {
  root.updateMatrixWorld(true);
  const rootInv = root.matrixWorld.clone().invert();
  const bones: THREE.Object3D[] = [], boneIdx = new Map<THREE.Object3D, number>();
  const groups = new Map<string, { mat: THREE.Material; parts: THREE.BufferGeometry[]; meshes: THREE.Mesh[]; cast: boolean; receive: boolean }>();
  const mats: THREE.Mesh[] = [];
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) mats.push(m); });
  for (const m of mats) {
    if ((m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || m.morphTargetInfluences || m.name || Array.isArray(m.material)) continue;
    if (!visibleUpTo(m, root) || anyAncestorIn(m, keep, root) || m.renderOrder || !m.frustumCulled) continue;
    const pl = plain(m.material, keepMats);
    const mt = pl ? pl.mat : m.material;
    const tm = m.material as THREE.MeshToonMaterial;
    if (!pl && (tm.map || tm.transparent)) continue;   // textures need uvs, transparency needs its own sorting
    const key = (pl ? pl.key : m.material.uuid) + `|${+m.castShadow}${+m.receiveShadow}`;
    const bone = m.parent!;
    let bi = boneIdx.get(bone); if (bi === undefined) { bi = bones.length; bones.push(bone); boneIdx.set(bone, bi); }
    const geo = bake(m.geometry, tmpM.multiplyMatrices(rootInv, m.matrixWorld), pl ? (tm.color ?? new THREE.Color(1, 1, 1)) : null, bi);
    if (!geo) continue;
    let g = groups.get(key); if (!g) groups.set(key, (g = { mat: mt, parts: [], meshes: [], cast: m.castShadow, receive: m.receiveShadow }));
    g.parts.push(geo); g.meshes.push(m);
  }
  if (!groups.size) return 0;
  const skeleton = new THREE.Skeleton(bones as THREE.Bone[]);   // plain groups work as bones (only matrixWorld is read)
  let replaced = 0;
  for (const g of groups.values()) {
    const geo = g.parts.length === 1 ? g.parts[0] : mergeGeometries(g.parts, false);
    if (g.parts.length > 1) g.parts.forEach((p) => p.dispose());
    if (!geo) continue;
    geo.computeBoundingSphere();
    const sm = new THREE.SkinnedMesh(geo, g.mat);
    sm.name = 'skinned';
    sm.castShadow = g.cast; sm.receiveShadow = g.receive;
    root.add(sm);
    sm.updateMatrixWorld(true);
    sm.bind(skeleton, sm.matrixWorld);
    // fixed generous bounds (limbs flail in ragdoll): skinning every vertex on the CPU each frame would cost more
    const bs = geo.boundingSphere!;
    sm.boundingSphere = new THREE.Sphere(bs.center.clone(), bs.radius * 1.8 + 0.3);
    for (const m of g.meshes) m.removeFromParent();
    replaced += g.meshes.length;
  }
  return replaced;
}
