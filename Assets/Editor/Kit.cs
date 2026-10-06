using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace Porkour.EditorTools
{
    /// <summary>
    /// Quaternius "Medieval Village MegaKit" pieces placed from code on the kit's 2 m grid (visuals only - the builder
    /// keeps simple invisible boxes as the real colliders, so gameplay never depends on the meshes).
    /// Calibrates once per build from two known pieces: scale (a wall is 2 m wide) and facing (walls face +Z,
    /// their inner side - where a door niche goes - is -Z), so it works whatever axes the FBX import used.
    /// Walls: the pivot is the outer face, the wall reaches WallInset to the inside.
    /// </summary>
    public static class Kit
    {
        public const string Dir = "Assets/Art/Farm/Medieval Village MegaKit[Standard]/Medieval Village MegaKit[Standard]/FBX";
        public const float WallInset = 0.31f;
        public const float StoryHeight = 3.12f;

        static bool calibrated, available;
        static float scale = 1f, yawFix;
        static readonly HashSet<string> missing = new();

        public static bool Available
        {
            get
            {
                Calibrate();
                return available;
            }
        }

        /// <summary>Forget the calibration (the builder calls this at the start of each build).</summary>
        public static void Reset()
        {
            calibrated = false;
            missing.Clear();
        }

        static GameObject Load(string piece) => AssetDatabase.LoadAssetAtPath<GameObject>($"{Dir}/{piece}.fbx");

        static void Calibrate()
        {
            if (calibrated) return;
            calibrated = true;
            scale = 1f;
            yawFix = 0f;
            var wall = Load("Wall_Plaster_Straight");
            available = wall != null;
            if (!available) return;
            var b = Measure(wall, 0f);
            bool turned = b.size.z > b.size.x;
            yawFix = turned ? 90f : 0f;
            float width = Mathf.Max(b.size.x, b.size.z);
            if (width > 0.001f) scale = 2f / width;
            if (b.size.y < 0.5f * width) Debug.LogWarning("Porkour: medieval kit walls look like they are lying down - check the FBX import.");
            var inset = Load("Wall_Plaster_Door_RoundInset");
            if (inset != null && Measure(inset, yawFix).center.z > 0f) yawFix += 180f; // niche must point inside (-Z)
            Debug.Log($"Porkour: medieval kit calibrated (scale {scale:0.###}, turn {yawFix}°).");
        }

        static Bounds Measure(GameObject asset, float yaw)
        {
            var holder = new GameObject("Measure");
            holder.transform.rotation = Quaternion.Euler(0f, yaw, 0f);
            PrefabUtility.InstantiatePrefab(asset, holder.transform);
            var b = RendererBounds(holder);
            Object.DestroyImmediate(holder);
            return b;
        }

        public static Bounds RendererBounds(GameObject go)
        {
            bool any = false;
            var b = new Bounds(go.transform.position, Vector3.zero);
            foreach (var r in go.GetComponentsInChildren<Renderer>())
            {
                if (!any) { b = r.bounds; any = true; }
                else b.Encapsulate(r.bounds);
            }
            return b;
        }

        /// <summary>A piece with its pivot at position, turned by yaw (0 = its front faces +Z). Null if the kit is missing.</summary>
        public static GameObject Place(string piece, Transform parent, Vector3 position, float yaw, float scaleMul = 1f)
        {
            Calibrate();
            var asset = Load(piece);
            if (asset == null)
            {
                if (available && missing.Add(piece)) Debug.LogWarning($"Porkour: medieval kit piece '{piece}' not found.");
                return null;
            }
            var holder = new GameObject(piece);
            holder.transform.SetParent(parent, false);
            holder.transform.SetPositionAndRotation(position, Quaternion.Euler(0f, yaw + yawFix, 0f));
            holder.transform.localScale = Vector3.one * (scale * scaleMul);
            PrefabUtility.InstantiatePrefab(asset, holder.transform);
            foreach (var t in holder.GetComponentsInChildren<Transform>())
                GameObjectUtility.SetStaticEditorFlags(t.gameObject, StaticEditorFlags.BatchingStatic);
            return holder;
        }

        /// <summary>Wall piece whose inner face lies on innerPoint's line, facing outward (unit ±X / ±Z).</summary>
        public static GameObject Wall(string piece, Transform parent, Vector3 innerPoint, Vector3 outward)
        {
            float yaw = Mathf.Atan2(outward.x, outward.z) * Mathf.Rad2Deg;
            return Place(piece, parent, innerPoint + outward * WallInset, yaw);
        }

        /// <summary>
        /// A straight run of 2 m wall pieces from a to b (inner face line), both stories if twoStories.
        /// pick(i, story) chooses the piece for slot i (null = leave a gap, e.g. a doorway).
        /// </summary>
        public static void WallRun(Transform parent, Vector3 a, Vector3 b, Vector3 outward, int stories,
            System.Func<int, int, string> pick)
        {
            Vector3 dir = b - a;
            int count = Mathf.RoundToInt(dir.magnitude / 2f);
            if (count <= 0) return;
            dir /= count;
            for (int story = 0; story < stories; story++)
            for (int i = 0; i < count; i++)
            {
                string piece = pick(i, story);
                if (piece == null) continue;
                Vector3 center = a + dir * (i + 0.5f) + Vector3.up * (story * StoryHeight);
                Wall(piece, parent, center, outward);
            }
        }

        /// <summary>Grid of 2 m floor tiles covering [min, max] (x/z) at height y.</summary>
        public static void FloorTiles(string piece, Transform parent, Vector2 min, Vector2 max, float y)
        {
            for (float x = min.x + 1f; x < max.x; x += 2f)
            for (float z = min.y + 1f; z < max.y; z += 2f)
                Place(piece, parent, new Vector3(x, y, z), 0f);
        }
    }
}
