using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Porkour
{
    /// <summary>
    /// Grass tufts and wild flowers all over the farm, made locally on every PC when the scene starts (look only, no
    /// colliders, no network): crossed quads with the builder's cut-out blade textures, merged into a few big meshes.
    /// A tuft grows only where a ray down hits the "Ground" collider (not on floors, roads, under buildings) and outside
    /// the noGrass rectangles (paths, fields, mud). Same seed → same grass on every PC.
    /// </summary>
    public class GrassField : MonoBehaviour
    {
        [Tooltip("Area (x, z) to cover.")]
        public Vector2 min = new(-64f, -16f), max = new(64f, 100f);
        [Tooltip("Grid step between tuft candidates (m); patches leave gaps.")]
        public float spacing = 1.5f;
        [Tooltip("0 = plain grass, 1 = grass with flowers, 2.. = more grass variants.")]
        public Material[] materials;
        public List<Rect> noGrass = new();
        public int seed = 12345;
        public string groundName = "Ground";

        const int MaxVertices = 60000;

        sealed class Chunk
        {
            public readonly List<Vector3> vertices = new();
            public readonly List<Vector2> uvs = new();
            public readonly List<int> triangles = new();
        }

        readonly List<Mesh> meshes = new();

        void Start()
        {
            if (materials == null || materials.Length == 0) return;
            Physics.SyncTransforms();
            var rng = new System.Random(seed);
            var chunks = new Chunk[materials.Length];
            for (int i = 0; i < chunks.Length; i++) chunks[i] = new Chunk();
            for (float x = min.x; x < max.x; x += spacing)
            for (float z = min.y; z < max.y; z += spacing)
            {
                float px = x + (float)rng.NextDouble() * spacing, pz = z + (float)rng.NextDouble() * spacing;
                float patch = Mathf.PerlinNoise(px * 0.07f + 100f, pz * 0.07f + 50f); // meadows and thinner spots
                double roll = rng.NextDouble();
                if (roll > Mathf.Lerp(0.2f, 1f, patch) || !Allowed(px, pz, out float y)) continue;
                int m = 0;
                if (materials.Length > 1 && Mathf.PerlinNoise(px * 0.045f + 300f, pz * 0.045f) > 0.6f && rng.NextDouble() < 0.4) m = 1;
                else if (materials.Length > 2 && rng.NextDouble() < 0.35) m = 2 + rng.Next(materials.Length - 2);
                var chunk = chunks[m];
                if (chunk.vertices.Count + 12 > MaxVertices)
                {
                    Flush(chunk, materials[m]);
                    chunks[m] = chunk = new Chunk();
                }
                float height = Mathf.Lerp(0.28f, 0.6f, (float)rng.NextDouble()) * Mathf.Lerp(0.8f, 1.2f, patch);
                float width = Mathf.Lerp(0.45f, 0.8f, (float)rng.NextDouble());
                AddTuft(chunk, new Vector3(px, y, pz), width, height, (float)rng.NextDouble() * 180f);
            }
            for (int i = 0; i < chunks.Length; i++)
                if (chunks[i].vertices.Count > 0) Flush(chunks[i], materials[i]);
        }

        void OnDestroy()
        {
            foreach (var mesh in meshes)
                if (mesh != null) Destroy(mesh);
        }

        bool Allowed(float x, float z, out float y)
        {
            y = 0f;
            var p = new Vector2(x, z);
            foreach (var r in noGrass)
                if (r.Contains(p)) return false;
            if (!Physics.Raycast(new Vector3(x, 5f, z), Vector3.down, out RaycastHit hit, 7f, ~0, QueryTriggerInteraction.Ignore)) return false;
            y = hit.point.y;
            return hit.collider.name == groundName;
        }

        /// <summary>Three quads crossed at 60°, normals pointing up so tufts are lit like the ground (no dark back faces).</summary>
        static void AddTuft(Chunk c, Vector3 foot, float width, float height, float yaw)
        {
            for (int q = 0; q < 3; q++)
            {
                Quaternion rot = Quaternion.Euler(0f, yaw + q * 60f, 0f);
                Vector3 side = rot * Vector3.right * (width / 2f);
                Vector3 lean = rot * Vector3.forward * (height * 0.12f * (q - 1)); // a little untidy
                int start = c.vertices.Count;
                c.vertices.Add(foot - side);
                c.vertices.Add(foot + side);
                c.vertices.Add(foot + side + Vector3.up * height + lean);
                c.vertices.Add(foot - side + Vector3.up * height + lean);
                c.uvs.Add(new Vector2(0f, 0f));
                c.uvs.Add(new Vector2(1f, 0f));
                c.uvs.Add(new Vector2(1f, 1f));
                c.uvs.Add(new Vector2(0f, 1f));
                c.triangles.Add(start); c.triangles.Add(start + 2); c.triangles.Add(start + 1);
                c.triangles.Add(start); c.triangles.Add(start + 3); c.triangles.Add(start + 2);
            }
        }

        void Flush(Chunk c, Material material)
        {
            var mesh = new Mesh { name = "GrassTufts", indexFormat = IndexFormat.UInt32 };
            mesh.SetVertices(c.vertices);
            mesh.SetUVs(0, c.uvs);
            mesh.SetTriangles(c.triangles, 0);
            var normals = new Vector3[c.vertices.Count];
            for (int i = 0; i < normals.Length; i++) normals[i] = Vector3.up;
            mesh.normals = normals;
            mesh.RecalculateBounds();
            meshes.Add(mesh);
            var go = new GameObject("GrassTufts", typeof(MeshFilter), typeof(MeshRenderer));
            go.transform.SetParent(transform, false);
            go.GetComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.GetComponent<MeshRenderer>();
            r.sharedMaterial = material;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = true;
        }
    }
}
