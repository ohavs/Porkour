using UnityEditor;
using UnityEngine;

namespace Porkour.EditorTools
{
    /// <summary>
    /// The imported characters (Kenney Cube Pets, Mixamo Bob) fitted into the game's bodies: turned to face +Z, scaled to
    /// a height, feet on the collider's bottom, Animator wired to the generated controller. Colliders and physics stay the
    /// builder's own, so a model never changes gameplay. Missing model → the caller keeps its primitive placeholder.
    /// </summary>
    public static partial class PorkourBuilder
    {
        static float? animalYaw;

        /// <summary>
        /// Model under parent: facing +Z (yaw corrects the file's facing), `height` tall, feet centred on `feet`
        /// (parent's local space). Returns the holder (null if the model is missing) and its final world bounds.
        /// </summary>
        static GameObject FitModel(GameObject model, Transform parent, string name, float height, Vector3 feet, float yaw,
            RuntimeAnimatorController controller, out Bounds bounds)
        {
            bounds = default;
            if (model == null) return null;
            var holder = new GameObject(name).transform;
            holder.SetParent(parent, false);
            holder.localRotation = Quaternion.Euler(0f, yaw, 0f);
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(model, holder);
            var b = Kit.RendererBounds(holder.gameObject);
            float s = b.size.y > 0.001f ? height / b.size.y : 1f;
            // Uniform scale about the holder's pivot: bounds scale with it (no need to re-measure skinned meshes).
            Vector3 pivot = holder.position;
            holder.localScale = Vector3.one * s;
            var scaled = new Bounds(pivot + (b.center - pivot) * s, b.size * s);
            Vector3 target = parent.TransformPoint(feet);
            Vector3 shift = target - new Vector3(scaled.center.x, scaled.min.y, scaled.center.z);
            holder.position += shift;
            bounds = new Bounds(scaled.center + shift, scaled.size);

            var animator = instance.GetComponent<Animator>();
            if (controller != null)
            {
                if (animator == null) animator = instance.AddComponent<Animator>();
                animator.runtimeAnimatorController = controller;
                animator.applyRootMotion = false;
                animator.cullingMode = AnimatorCullingMode.CullUpdateTransforms;
            }
            else if (animator != null) animator.enabled = false;
            return holder.gameObject;
        }

        /// <summary>
        /// Yaw that turns a model so it faces +Z, from two of its own transforms: one in front (e.g. a front leg, the toes)
        /// and one behind it (a back leg, the heel). 0 when they aren't found.
        /// </summary>
        static float FacingYaw(GameObject model, string frontName, string backName)
        {
            if (model == null) return 0f;
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(model);
            try
            {
                Vector3 front = Vector3.zero, back = Vector3.zero;
                int nf = 0, nb = 0;
                foreach (var t in instance.GetComponentsInChildren<Transform>())
                {
                    string n = t.name.ToLowerInvariant().Replace('_', '-');
                    if (n.EndsWith(frontName)) { front += t.position; nf++; }
                    else if (n.EndsWith(backName)) { back += t.position; nb++; }
                }
                if (nf == 0 || nb == 0) return 0f;
                Vector3 forward = front / nf - back / nb;
                forward.y = 0f;
                return forward.sqrMagnitude < 1e-6f ? 0f : -Vector3.SignedAngle(Vector3.forward, forward, Vector3.up);
            }
            finally
            {
                Object.DestroyImmediate(instance);
            }
        }

        /// <summary>All Cube Pets share one export: the pig's legs tell which way they face.</summary>
        static float AnimalYaw()
        {
            animalYaw ??= FacingYaw(ArtSetup.AnimalModel("pig"), "leg-front-left", "leg-back-left");
            return animalYaw.Value;
        }

        /// <summary>A Cube Pet as an animal's visual. Null when the model file is missing.</summary>
        static GameObject AnimalVisual(string animal, Transform parent, float height, Vector3 feet, float walkSpeed, float runSpeed,
            out Bounds bounds)
        {
            var model = ArtSetup.AnimalModel(animal);
            bounds = default;
            if (model == null) return null;
            return FitModel(model, parent, "Model_" + char.ToUpperInvariant(animal[0]) + animal.Substring(1), height, feet,
                AnimalYaw(), ArtSetup.AnimalController(animal, walkSpeed, runSpeed), out bounds);
        }

        /// <summary>Cloth in the pig-type colour over a pig model's back (+ side flaps). Children of the model, so they hide with it.</summary>
        static Renderer[] Saddle(GameObject model, Bounds bounds, Material cloth)
        {
            var t = model.transform;
            float s = t.lossyScale.x;
            var level = new Vector3(0f, -t.localEulerAngles.y, 0f); // undo the model's turn: sizes below are world-aligned
            Vector3 top = new(bounds.center.x, bounds.max.y + 0.02f, bounds.center.z - bounds.size.z * 0.12f);
            float width = bounds.size.x * 0.8f, length = bounds.size.z * 0.45f, drop = bounds.size.y * 0.3f;
            var parts = new[]
            {
                Part(PrimitiveType.Cube, "Saddle", t, t.InverseTransformPoint(top), new Vector3(width, 0.05f, length) / s, cloth, level),
                Part(PrimitiveType.Cube, "SaddleL", t, t.InverseTransformPoint(top + new Vector3(-bounds.extents.x - 0.015f, -drop / 2f, 0f)),
                    new Vector3(0.03f, drop, length) / s, cloth, level),
                Part(PrimitiveType.Cube, "SaddleR", t, t.InverseTransformPoint(top + new Vector3(bounds.extents.x + 0.015f, -drop / 2f, 0f)),
                    new Vector3(0.03f, drop, length) / s, cloth, level),
            };
            var renderers = new Renderer[parts.Length];
            for (int i = 0; i < parts.Length; i++) renderers[i] = parts[i].GetComponent<Renderer>();
            return renderers;
        }

        /// <summary>Mixamo Bob (Humanoid) with his animations. Null when Bob.fbx is missing.</summary>
        static GameObject BobVisual(Transform parent)
        {
            var model = ArtSetup.BobModel;
            if (model == null) return null;
            float yaw = FacingYaw(model, "lefttoebase", "leftfoot");
            return FitModel(model, parent, "Model_Bob", 1.95f, Vector3.zero, yaw, ArtSetup.BobController(), out _);
        }
    }
}
