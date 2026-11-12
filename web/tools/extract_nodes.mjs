// Usage: node tools/extract_nodes.mjs <in.glb> <out.glb> <NodeName>...
// Keeps only the named (non-skinned) mesh nodes, puts them at the scene root with their transform reset,
// drops skins / animations / everything else.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup } from '@gltf-transform/functions';
const [src, out, ...names] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const keep = names.map((n) => { const x = root.listNodes().find((k) => k.getName() === n); if (!x) throw new Error('no node ' + n); return x; });
for (const k of keep) {
  for (const p of root.listNodes()) if (p.listChildren().includes(k)) p.removeChild(k);
  for (const c of k.listChildren()) k.removeChild(c);
  k.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]).setSkin(null);
}
for (const c of scene.listChildren()) scene.removeChild(c);
for (const k of keep) scene.addChild(k);
for (const a of root.listAnimations()) { a.listChannels().forEach((c) => c.dispose()); a.listSamplers().forEach((x) => x.dispose()); a.dispose(); }
for (const s of root.listSkins()) s.dispose();
for (const sc of root.listScenes()) if (sc !== scene) sc.dispose();
for (const n of root.listNodes()) if (!keep.includes(n)) n.dispose();
const used = new Set(keep.map((k) => k.getMesh()));
for (const m of root.listMeshes()) if (!used.has(m)) m.dispose();
const keepAcc = new Set();
for (const m of used) for (const pr of m.listPrimitives()) { if (pr.getIndices()) keepAcc.add(pr.getIndices()); for (const a of pr.listAttributes()) keepAcc.add(a); }
for (const a of root.listAccessors()) if (!keepAcc.has(a)) a.dispose();
await doc.transform(prune(), dedup());
await io.write(out, doc);
