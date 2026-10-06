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
            // holder (position, scale - its axes are the parent's: the model faces its +Z) → Turn (yaw fix) → the model.
            var holder = new GameObject(name).transform;
            holder.SetParent(parent, false);
            var turn = new GameObject("Turn").transform;
            turn.SetParent(holder, false);
            turn.localRotation = Quaternion.Euler(0f, yaw, 0f);
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(model, turn);
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

        /// <summary>
        /// Pig skins per type: the Cube Pets texture with its pink recoloured to the type colour (eyes, snout shading and
        /// the rest stay), saved in Assets/Art/Generated. Index = PigType; Heavy keeps the hog's own look (null).
        /// Null array when the texture can't be read - PigLook then tints instead.
        /// </summary>
        static Material[] PigSkins(GameObject pigModel)
        {
            var renderer = pigModel.GetComponentInChildren<Renderer>(true);
            var baseMat = renderer != null ? renderer.sharedMaterial : null;
            var tex = baseMat != null ? baseMat.mainTexture as Texture2D : null;
            string texPath = tex != null ? AssetDatabase.GetAssetPath(tex) : "";
            if (string.IsNullOrEmpty(texPath) || !System.IO.File.Exists(texPath))
            {
                Debug.LogWarning("Porkour: pig texture not found - pig colours will be tints.");
                return null;
            }
            var src = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            if (!src.LoadImage(System.IO.File.ReadAllBytes(texPath)))
            {
                Object.DestroyImmediate(src);
                return null;
            }
            var original = src.GetPixels32();
            var mats = new Material[System.Enum.GetValues(typeof(PigType)).Length];
            var srcImporter = AssetImporter.GetAtPath(texPath) as TextureImporter;
            foreach (PigType type in System.Enum.GetValues(typeof(PigType)))
            {
                if (type == PigType.Heavy) continue;
                Color.RGBToHSV(PigTypes.Info(type).Color, out float hue, out float sat, out _);
                var pixels = (Color32[])original.Clone();
                for (int i = 0; i < pixels.Length; i++)
                {
                    Color.RGBToHSV(pixels[i], out float h, out float s, out float v);
                    bool pink = (h > 0.86f || h < 0.05f) && s > 0.12f && v > 0.25f;
                    if (!pink) continue;
                    var c = Color.HSVToRGB(hue, Mathf.Clamp01(Mathf.Lerp(s, sat, 0.7f) + 0.05f), v);
                    pixels[i] = new Color32((byte)(c.r * 255f), (byte)(c.g * 255f), (byte)(c.b * 255f), pixels[i].a);
                }
                var outTex = new Texture2D(src.width, src.height, TextureFormat.RGBA32, false);
                outTex.SetPixels32(pixels);
                outTex.Apply();
                string path = $"{ArtSetup.GeneratedDir}/PigSkin_{type}.png";
                System.IO.File.WriteAllBytes(path, outTex.EncodeToPNG());
                Object.DestroyImmediate(outTex);
                AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceUpdate);
                if (AssetImporter.GetAtPath(path) is TextureImporter importer)
                {
                    importer.mipmapEnabled = false; // a colour atlas: no blending between neighbouring colours
                    importer.filterMode = srcImporter != null ? srcImporter.filterMode : FilterMode.Point;
                    importer.textureCompression = TextureImporterCompression.Uncompressed;
                    importer.SaveAndReimport();
                }
                var skinTex = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
                string matPath = $"{ArtSetup.GeneratedDir}/PigSkin_{type}.mat";
                AssetDatabase.DeleteAsset(matPath);
                var mat = new Material(baseMat);
                if (mat.HasProperty("_BaseMap")) mat.SetTexture("_BaseMap", skinTex);
                mat.mainTexture = skinTex;
                AssetDatabase.CreateAsset(mat, matPath);
                mats[(int)type] = mat;
            }
            Object.DestroyImmediate(src);
            return mats;
        }

        /// <summary>Mixamo Bob (Humanoid) with his animations and his real skin. Null when Bob.fbx is missing.</summary>
        static GameObject BobVisual(Transform parent, float height)
        {
            var model = ArtSetup.BobModel;
            if (model == null) return null;
            float yaw = FacingYaw(model, "lefttoebase", "leftfoot");
            var bob = FitModel(model, parent, "Model_Bob", height, Vector3.zero, yaw, ArtSetup.BobController(), out _);
            var skin = ArtSetup.BobMaterial();
            if (skin != null)
                foreach (var r in bob.GetComponentsInChildren<Renderer>())
                {
                    var mats = r.sharedMaterials;
                    for (int i = 0; i < mats.Length; i++)
                        if (mats[i] == null || mats[i].mainTexture == null) mats[i] = skin; // only the white ones
                    r.sharedMaterials = mats;
                }
            return bob;
        }
    }
}
