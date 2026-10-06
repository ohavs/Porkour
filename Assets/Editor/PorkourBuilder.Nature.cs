using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Porkour.EditorTools
{
    /// <summary>
    /// The farm's look without extra packs: a painted grass texture for the ground, grass tufts + wild flowers
    /// (GrassField, made at runtime), sky / fog / ambient light and a post-processing volume (bloom, colours, vignette).
    /// With packs added later: a sky material (ArtSetup.FindSkybox), bushes (hiding spots), rocks and flowers scattered
    /// around (ArtSetup.FindModelsByWord), and furniture for the rooms (Furnish) - primitives when nothing is found.
    /// </summary>
    public static partial class PorkourBuilder
    {
        /// <summary>Ground (x, z) rectangles without grass / scattered plants: roads, fields, floors, buildings.</summary>
        static readonly List<Rect> NoGrass = new();

        static void NoGrassRect(float x0, float z0, float x1, float z1) =>
            NoGrass.Add(Rect.MinMaxRect(Mathf.Min(x0, x1), Mathf.Min(z0, z1), Mathf.Max(x0, x1), Mathf.Max(z0, z1)));

        static void NoGrassAround(Vector3 center, Vector3 size, float margin = 0.3f) =>
            NoGrassRect(center.x - size.x / 2f - margin, center.z - size.z / 2f - margin, center.x + size.x / 2f + margin, center.z + size.z / 2f + margin);

        /// <summary>A dirt road (flat, no collider) - also keeps grass off it.</summary>
        static void DirtPath(Transform parent, Vector3 center, Vector3 size, Material dirt)
        {
            Part(PrimitiveType.Cube, "Path", parent, center, size, dirt);
            NoGrassAround(center, size, 0.1f);
        }

        // ---------- textures ----------

        static float Hash(int x, int y, int seed)
        {
            unchecked
            {
                uint h = (uint)(x * 374761393 + y * 668265263 + seed * 1442695041);
                h = (h ^ (h >> 13)) * 1274126177u;
                h ^= h >> 16;
                return (h & 0xFFFFFF) / (float)0x1000000;
            }
        }

        /// <summary>Smooth value noise that tiles every `period` lattice cells.</summary>
        static float TileNoise(float x, float y, int period, int seed)
        {
            int x0 = Mathf.FloorToInt(x), y0 = Mathf.FloorToInt(y);
            float fx = x - x0, fy = y - y0;
            fx = fx * fx * (3f - 2f * fx);
            fy = fy * fy * (3f - 2f * fy);
            int W(int v) => ((v % period) + period) % period;
            float a = Hash(W(x0), W(y0), seed), b = Hash(W(x0 + 1), W(y0), seed);
            float c = Hash(W(x0), W(y0 + 1), seed), d = Hash(W(x0 + 1), W(y0 + 1), seed);
            return Mathf.Lerp(Mathf.Lerp(a, b, fx), Mathf.Lerp(c, d, fx), fy);
        }

        static float Fbm(float u, float v, int frequency, int octaves, int seed)
        {
            float sum = 0f, amp = 0.5f, norm = 0f;
            for (int o = 0; o < octaves; o++, frequency *= 2, amp *= 0.5f)
            {
                sum += amp * TileNoise(u * frequency, v * frequency, frequency, seed + o * 31);
                norm += amp;
            }
            return sum / norm;
        }

        /// <summary>Writes a generated PNG into Art/Generated (same pixels every build → no git churn) and imports it.</summary>
        static Texture2D SaveTexture(string name, int size, Color[] pixels, bool cutout)
        {
            EnsureFolder(ArtSetup.GeneratedDir);
            string path = $"{ArtSetup.GeneratedDir}/{name}.png";
            var tex = new Texture2D(size, size, TextureFormat.RGBA32, false);
            tex.SetPixels(pixels);
            tex.Apply();
            File.WriteAllBytes(path, tex.EncodeToPNG());
            Object.DestroyImmediate(tex);
            AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceUpdate);
            if (AssetImporter.GetAtPath(path) is TextureImporter importer)
            {
                importer.wrapMode = cutout ? TextureWrapMode.Clamp : TextureWrapMode.Repeat;
                importer.mipmapEnabled = true;
                importer.alphaIsTransparency = cutout;
                importer.mipMapsPreserveCoverage = cutout; // blades don't vanish in the distance
                importer.alphaTestReferenceValue = 0.45f;
                importer.anisoLevel = cutout ? 1 : 4;
                importer.SaveAndReimport();
            }
            return AssetDatabase.LoadAssetAtPath<Texture2D>(path);
        }

        /// <summary>Soft painted meadow: big light/dark patches, a few dry spots, fine blade strokes. Tiles seamlessly.</summary>
        static Texture2D GrassGroundTexture()
        {
            const int size = 512;
            var shade = new float[size * size];
            var rng = new System.Random(4242);
            for (int s = 0; s < 3200; s++) // short blade strokes (wrap around the edges)
            {
                int x = rng.Next(size), y = rng.Next(size), length = 3 + rng.Next(6);
                float tilt = (float)(rng.NextDouble() - 0.5) * 0.8f, value = (float)(rng.NextDouble() - 0.45) * 0.16f;
                for (int i = 0; i < length; i++)
                {
                    int px = ((x + Mathf.RoundToInt(tilt * i)) % size + size) % size, py = (y + i) % size;
                    shade[py * size + px] += value * (1f - i / (float)length * 0.5f);
                }
            }
            var dark = new Color(0.26f, 0.48f, 0.17f);
            var light = new Color(0.44f, 0.67f, 0.26f);
            var dry = new Color(0.58f, 0.63f, 0.3f);
            var pixels = new Color[size * size];
            for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++)
            {
                float u = x / (float)size, v = y / (float)size;
                float patches = Fbm(u, v, 4, 4, 11);
                float grain = Fbm(u, v, 32, 2, 23);
                float dryness = Mathf.Clamp01((Fbm(u, v, 3, 3, 37) - 0.62f) * 4f);
                Color c = Color.Lerp(dark, light, Mathf.SmoothStep(0.15f, 0.85f, patches));
                c = Color.Lerp(c, dry, dryness * 0.5f);
                c *= 0.92f + 0.16f * grain + shade[y * size + x];
                c.a = 1f;
                pixels[y * size + x] = c;
            }
            return SaveTexture("GrassGround", size, pixels, false);
        }

        /// <summary>Cut-out grass blades (alpha) for the tufts; with flowers = little blossoms on some tips.</summary>
        static Texture2D BladeTexture(string name, int seed, Color bottom, Color top, bool flowers)
        {
            const int size = 128;
            var pixels = new Color[size * size];
            var rng = new System.Random(seed);
            var tips = new List<Vector2>();
            for (int b = 0; b < 12; b++)
            {
                float x0 = 12 + (float)rng.NextDouble() * (size - 24), height = 56 + (float)rng.NextDouble() * 68;
                float baseWidth = 5 + (float)rng.NextDouble() * 6, bend = ((float)rng.NextDouble() - 0.5f) * 30f;
                float tint = 0.85f + (float)rng.NextDouble() * 0.3f;
                for (int y = 0; y < height && y < size; y++)
                {
                    float t = y / height, center = x0 + bend * t * t, half = baseWidth / 2f * (1f - t) + 0.4f;
                    Color c = Color.Lerp(bottom, top, t) * tint;
                    c.a = 1f;
                    for (int x = Mathf.FloorToInt(center - half); x <= Mathf.CeilToInt(center + half); x++)
                        if (x >= 0 && x < size && Mathf.Abs(x - center) <= half) pixels[y * size + x] = c;
                }
                tips.Add(new Vector2(x0 + bend, Mathf.Min(height, size - 6)));
            }
            if (flowers)
            {
                Color[] petals = { new(1f, 1f, 0.95f), new(1f, 0.85f, 0.2f), new(0.95f, 0.55f, 0.75f), new(0.65f, 0.55f, 0.95f) };
                for (int f = 0; f < 5; f++)
                {
                    var tip = tips[rng.Next(tips.Count)];
                    Color petal = petals[rng.Next(petals.Length)];
                    float radius = 4f + (float)rng.NextDouble() * 3f;
                    for (int y = (int)(tip.y - radius); y <= tip.y + radius; y++)
                    for (int x = (int)(tip.x - radius); x <= tip.x + radius; x++)
                    {
                        if (x < 0 || y < 0 || x >= size || y >= size) continue;
                        float d = Vector2.Distance(new Vector2(x, y), tip);
                        if (d > radius) continue;
                        pixels[y * size + x] = d < radius * 0.35f ? new Color(1f, 0.8f, 0.15f, 1f) : petal;
                    }
                }
            }
            return SaveTexture(name, size, pixels, true);
        }

        static Material TexturedMat(string name, Texture2D texture, Vector2 tiling)
        {
            var mat = Mat(name, Color.white);
            mat.SetTexture("_BaseMap", texture);
            mat.SetTextureScale("_BaseMap", tiling);
            mat.mainTexture = texture;
            mat.mainTextureScale = tiling;
            mat.SetFloat("_Smoothness", 0.05f);
            EditorUtility.SetDirty(mat);
            return mat;
        }

        /// <summary>URP Lit, alpha-clipped, both faces, no shine - for grass tufts.</summary>
        static Material CutoutMat(string name, Texture2D texture)
        {
            var mat = Mat(name, Color.white);
            mat.SetTexture("_BaseMap", texture);
            mat.mainTexture = texture;
            mat.SetFloat("_AlphaClip", 1f);
            mat.SetFloat("_Cutoff", 0.45f);
            mat.EnableKeyword("_ALPHATEST_ON");
            mat.SetFloat("_Cull", 0f);
            mat.doubleSidedGI = true;
            mat.SetOverrideTag("RenderType", "TransparentCutout");
            mat.renderQueue = (int)RenderQueue.AlphaTest;
            mat.SetFloat("_Smoothness", 0f);
            mat.SetFloat("_SpecularHighlights", 0f);
            mat.EnableKeyword("_SPECULARHIGHLIGHTS_OFF");
            mat.SetFloat("_EnvironmentReflections", 0f);
            mat.EnableKeyword("_ENVIRONMENTREFLECTIONS_OFF");
            EditorUtility.SetDirty(mat);
            return mat;
        }

        /// <summary>The painted grass for the ground slab (meters per texture repeat).</summary>
        static Material GroundMaterial(string name, Vector3 slabSize, float metersPerTile)
        {
            grassTexture ??= GrassGroundTexture();
            return TexturedMat(name, grassTexture, new Vector2(slabSize.x / metersPerTile, slabSize.z / metersPerTile));
        }

        static Texture2D grassTexture;

        /// <summary>Grass tufts + wild flowers over the whole farm (GrassField builds them at runtime on every PC).</summary>
        static void AddGrassField(Transform r)
        {
            var green = BladeTexture("GrassBlades", 7, new Color(0.22f, 0.42f, 0.14f), new Color(0.5f, 0.74f, 0.3f), false);
            var flowery = BladeTexture("GrassFlowers", 19, new Color(0.22f, 0.42f, 0.14f), new Color(0.46f, 0.7f, 0.27f), true);
            var pale = BladeTexture("GrassBladesLight", 31, new Color(0.3f, 0.5f, 0.18f), new Color(0.62f, 0.78f, 0.34f), false);
            var go = new GameObject("GrassField");
            go.transform.SetParent(r, false);
            var field = go.AddComponent<GrassField>();
            field.min = new Vector2(-72f, -40f);
            field.max = new Vector2(72f, 112f);
            field.spacing = 1.5f;
            field.materials = new[] { CutoutMat("GrassTuft", green), CutoutMat("FlowerTuft", flowery), CutoutMat("GrassTuftLight", pale) };
            field.noGrass = new List<Rect>(NoGrass);
        }

        // ---------- sky, light, post-processing ----------

        static void SetupLook(Camera cam, Light sun)
        {
            if (sun != null)
            {
                sun.color = new Color(1f, 0.95f, 0.85f);
                sun.intensity = 1.25f;
                sun.shadows = LightShadows.Soft;
                sun.shadowStrength = 0.75f;
                RenderSettings.sun = sun;
            }
            var sky = ArtSetup.FindSkybox();
            if (sky == null)
            {
                var shader = Shader.Find("Skybox/Procedural");
                if (shader != null)
                {
                    EnsureFolder(MaterialDir);
                    string path = $"{MaterialDir}/Sky.mat";
                    sky = AssetDatabase.LoadAssetAtPath<Material>(path);
                    if (sky == null)
                    {
                        sky = new Material(shader);
                        AssetDatabase.CreateAsset(sky, path);
                    }
                    sky.shader = shader;
                    sky.SetColor("_SkyTint", new Color(0.42f, 0.6f, 0.9f));
                    sky.SetColor("_GroundColor", new Color(0.42f, 0.48f, 0.38f));
                    sky.SetFloat("_AtmosphereThickness", 0.75f);
                    sky.SetFloat("_Exposure", 1.25f);
                    sky.SetFloat("_SunSize", 0.035f);
                    EditorUtility.SetDirty(sky);
                }
            }
            if (sky != null) RenderSettings.skybox = sky;
            // Soft cartoon light from three directions (no baking needed), light haze in the distance.
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(0.62f, 0.72f, 0.86f);
            RenderSettings.ambientEquatorColor = new Color(0.56f, 0.6f, 0.55f);
            RenderSettings.ambientGroundColor = new Color(0.34f, 0.32f, 0.26f);
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = new Color(0.74f, 0.84f, 0.94f);
            RenderSettings.fogStartDistance = 70f;
            RenderSettings.fogEndDistance = 300f;

            if (cam != null)
            {
                var data = cam.GetUniversalAdditionalCameraData();
                data.renderPostProcessing = true;
                data.antialiasing = UnityEngine.Rendering.Universal.AntialiasingMode.SubpixelMorphologicalAntiAliasing;
                cam.farClipPlane = 400f;
            }

            // Post-processing: a touch of bloom, warmer and more saturated colours, soft vignette.
            EnsureFolder(ArtSetup.GeneratedDir);
            string profilePath = $"{ArtSetup.GeneratedDir}/PostFX.asset";
            var profile = AssetDatabase.LoadAssetAtPath<VolumeProfile>(profilePath);
            if (profile == null)
            {
                profile = ScriptableObject.CreateInstance<VolumeProfile>();
                AssetDatabase.CreateAsset(profile, profilePath);
            }
            T Effect<T>() where T : VolumeComponent
            {
                if (profile.TryGet(out T effect)) return effect;
                effect = profile.Add<T>(true);
                AssetDatabase.AddObjectToAsset(effect, profile);
                return effect;
            }
            var bloom = Effect<Bloom>();
            bloom.threshold.Override(1.05f);
            bloom.intensity.Override(0.35f);
            bloom.scatter.Override(0.6f);
            var colors = Effect<ColorAdjustments>();
            colors.postExposure.Override(0.1f);
            colors.contrast.Override(8f);
            colors.saturation.Override(14f);
            Effect<WhiteBalance>().temperature.Override(6f);
            Effect<Tonemapping>().mode.Override(TonemappingMode.Neutral);
            var vignette = Effect<Vignette>();
            vignette.intensity.Override(0.18f);
            vignette.smoothness.Override(0.45f);
            foreach (var component in profile.components) EditorUtility.SetDirty(component);
            EditorUtility.SetDirty(profile);
            var volume = new GameObject("PostFX").AddComponent<Volume>();
            volume.isGlobal = true;
            volume.sharedProfile = profile;
        }

        // ---------- plants and rocks from an added nature pack ----------

        /// <summary>
        /// With a nature pack (e.g. Quaternius Stylized Nature MegaKit): bushes (pigs hide in them), rocks (solid) and
        /// flowers / ferns / mushrooms scattered over free ground. Nothing happens without one.
        /// </summary>
        static void ScatterNature(Transform r, List<NetSpawnPoint> keepClear)
        {
            var bushes = ArtSetup.FindModelsByWord(new[] { "bush", "shrub", "hedge" }, new[] { "dead", "berry" });
            var rocks = ArtSetup.FindModelsByWord(new[] { "rock", "boulder", "pebble" }, new[] { "path", "wall", "tile", "brick", "cliff" });
            var plants = ArtSetup.FindModelsByWord(new[] { "flower", "fern", "clover", "mushroom", "plant" }, new[] { "pot", "vase", "dead" });
            if (bushes.Count + rocks.Count + plants.Count == 0) return;
            Physics.SyncTransforms();
            var root = new GameObject("Nature").transform;
            root.SetParent(r, false);
            var rng = new System.Random(777);
            Scatter(bushes, 45, 1.1f, 1.6f, (go, b) =>
            {
                var hide = new GameObject("BushHideSpot"); // at the bush's base, whatever the model's pivot
                hide.transform.SetParent(root, false);
                hide.transform.position = new Vector3(b.center.x, b.min.y, b.center.z);
                var spot = hide.AddComponent<HideSpot>();
                spot.radius = Mathf.Max(0.7f, Mathf.Min(b.extents.x, b.extents.z) * 0.9f);
                spot.height = Mathf.Max(1f, b.size.y);
                spot.hint = "Hidden in the bush";
            });
            Scatter(rocks, 30, 0.5f, 1.4f, (go, b) =>
                Invisible(Block("RockCollider", root, b.center, new Vector3(b.size.x * 0.8f, b.size.y, b.size.z * 0.8f), null)));
            Scatter(plants, 140, 0.3f, 0.7f, null);

            void Scatter(List<GameObject> models, int count, float minHeight, float maxHeight, System.Action<GameObject, Bounds> extra)
            {
                if (models.Count == 0) return;
                for (int placed = 0, tries = 0; placed < count && tries < count * 8; tries++)
                {
                    float x = Mathf.Lerp(-62f, 62f, (float)rng.NextDouble()), z = Mathf.Lerp(-14f, 98f, (float)rng.NextDouble());
                    if (!FreeGround(x, z) || NearSpawn(x, z)) continue;
                    var model = models[rng.Next(models.Count)];
                    float height = Mathf.Lerp(minHeight, maxHeight, (float)rng.NextDouble());
                    var go = FitModel(model, root, model.name, height, root.InverseTransformPoint(new Vector3(x, 0f, z)), (float)rng.NextDouble() * 360f, null, out var bounds);
                    if (go == null) continue;
                    MakeStatic(go);
                    extra?.Invoke(go, bounds);
                    NoGrassAround(bounds.center, bounds.size * 0.5f, 0f);
                    placed++;
                }
            }

            bool NearSpawn(float x, float z)
            {
                foreach (var point in keepClear)
                {
                    Vector3 d = point.transform.position - new Vector3(x, 0f, z);
                    if (d.x * d.x + d.z * d.z < 3f * 3f) return true; // pigs, plates, locks, props, coins stay free
                }
                return false;
            }
        }

        /// <summary>Open ground (editor): not a road / field / building rect, and a ray down lands on the Ground slab.</summary>
        static bool FreeGround(float x, float z)
        {
            var p = new Vector2(x, z);
            foreach (var rect in NoGrass)
                if (rect.Contains(p)) return false;
            return Physics.Raycast(new Vector3(x, 5f, z), Vector3.down, out RaycastHit hit, 7f, ~0, QueryTriggerInteraction.Ignore)
                   && hit.collider.name == "Ground";
        }

        // ---------- furniture ----------

        static readonly Dictionary<string, List<GameObject>> furnitureModels = new();

        static readonly Dictionary<string, (string[] words, string[] without, float height)> FurnitureKinds = new()
        {
            ["bed"] = (new[] { "bed" }, new[] { "flower", "bunk", "side", "roll" }, 0.9f),
            ["table"] = (new[] { "table" }, new[] { "side", "night", "bedside", "coffee", "small", "round" }, 0.85f),
            ["chair"] = (new[] { "chair", "stool" }, new[] { "arm", "office", "sofa" }, 0.95f),
            ["shelf"] = (new[] { "shelf", "bookcase", "bookshelf", "cabinet", "cupboard", "wardrobe", "dresser" }, new[] { "wall", "small", "corner" }, 1.9f),
            ["barrel"] = (new[] { "barrel" }, new[] { "explosive", "toxic" }, 1.1f),
            ["chest"] = (new[] { "chest" }, new[] { "drawer", "armor" }, 0.7f),
            ["workbench"] = (new[] { "workbench", "anvil" }, null, 0.95f),
            ["sack"] = (new[] { "sack", "bag" }, new[] { "sleeping" }, 0.7f),
        };

        /// <summary>
        /// A piece of furniture standing on the floor at floorPos, facing yaw: a model from an added props / furniture
        /// pack (Quaternius Fantasy Props MegaKit, Kenney Furniture Kit...) or a simple primitive one. Solid, except sacks.
        /// </summary>
        static void Furnish(Transform parent, string kind, Vector3 floorPos, float yaw, Material wood)
        {
            if (!furnitureModels.TryGetValue(kind, out var models))
            {
                var (words, without, _) = FurnitureKinds[kind];
                furnitureModels[kind] = models = ArtSetup.FindModelsByWord(words, without);
            }
            float height = FurnitureKinds[kind].height;
            if (models.Count > 0)
            {
                var model = models[Mathf.Abs(Mathf.RoundToInt(floorPos.x * 13f + floorPos.z * 7f)) % models.Count];
                var go = FitModel(model, parent, kind, height, parent.InverseTransformPoint(floorPos), yaw, null, out var b);
                if (go != null)
                {
                    MakeStatic(go);
                    if (kind == "bed") BedCover(parent, b.center, Mathf.Min(0.6f, b.size.y), b.size);
                    else if (kind != "sack")
                        Invisible(Block(kind + "Collider", parent, b.center, new Vector3(b.size.x * 0.9f, b.size.y, b.size.z * 0.9f), null));
                    NoGrassAround(b.center, b.size, 0f);
                    return;
                }
            }
            var turn = Quaternion.Euler(0f, yaw, 0f);
            Vector3 At(float x, float y, float z) => floorPos + turn * new Vector3(x, y, z);
            var dark = Mat("RoofWood", new Color(0.33f, 0.22f, 0.14f));
            Vector3 e = new(0f, yaw, 0f);
            switch (kind)
            {
                case "bed":
                    Block("Bed", parent, At(0f, 0.25f, 0f), new Vector3(1.3f, 0.5f, 2f), dark, e);
                    Part(PrimitiveType.Cube, "Blanket", parent, At(0f, 0.56f, 0.25f), new Vector3(1.35f, 0.14f, 1.5f), Mat("Blanket", new Color(0.75f, 0.2f, 0.2f)), e);
                    Part(PrimitiveType.Cube, "Pillow", parent, At(0f, 0.58f, -0.7f), new Vector3(0.9f, 0.18f, 0.4f), Mat("Lamp", Color.white), e);
                    BedCover(parent, At(0f, 0.25f, 0.2f), 0.5f, new Vector3(1.3f, 0.5f, 2f));
                    break;
                case "table":
                case "workbench":
                    Block("TableTop", parent, At(0f, 0.8f, 0f), new Vector3(1.4f, 0.1f, 0.9f), wood, e);
                    foreach (var (x, z) in new[] { (-0.6f, -0.35f), (0.6f, -0.35f), (-0.6f, 0.35f), (0.6f, 0.35f) })
                        Block("TableLeg", parent, At(x, 0.375f, z), new Vector3(0.1f, 0.75f, 0.1f), wood, e);
                    break;
                case "chair":
                    Block("Seat", parent, At(0f, 0.45f, 0f), new Vector3(0.45f, 0.08f, 0.45f), wood, e);
                    Part(PrimitiveType.Cube, "Back", parent, At(0f, 0.75f, -0.2f), new Vector3(0.45f, 0.55f, 0.06f), wood, e);
                    foreach (var (x, z) in new[] { (-0.18f, -0.18f), (0.18f, -0.18f), (-0.18f, 0.18f), (0.18f, 0.18f) })
                        Part(PrimitiveType.Cube, "Leg", parent, At(x, 0.21f, z), new Vector3(0.06f, 0.42f, 0.06f), wood, e);
                    break;
                case "shelf":
                    Block("Shelf", parent, At(0f, 0.95f, 0f), new Vector3(1.2f, 1.9f, 0.4f), dark, e);
                    for (int i = 0; i < 3; i++)
                        Part(PrimitiveType.Cube, "Jar", parent, At(-0.35f + i * 0.35f, 1.35f, 0.05f), new Vector3(0.18f, 0.25f, 0.18f),
                            Mat(i == 1 ? "Apple" : "Hay", i == 1 ? new Color(0.85f, 0.12f, 0.1f) : new Color(0.93f, 0.8f, 0.35f)), e);
                    break;
                case "barrel":
                    Block("Barrel", parent, At(0f, 0.55f, 0f), new Vector3(0.8f, 0.55f, 0.8f), wood, e, PrimitiveType.Cylinder);
                    break;
                case "chest":
                    Block("Chest", parent, At(0f, 0.3f, 0f), new Vector3(1f, 0.6f, 0.6f), dark, e);
                    break;
                case "sack":
                    Part(PrimitiveType.Sphere, "Sack", parent, At(0f, 0.3f, 0f), new Vector3(0.6f, 0.6f, 0.5f), Mat("Sack", new Color(0.72f, 0.62f, 0.45f)), e);
                    break;
            }
        }

        /// <summary>Hide under the blanket (like Bob's bed): solid frame, hiding spot on top.</summary>
        static void BedCover(Transform parent, Vector3 center, float frameHeight, Vector3 size)
        {
            Invisible(Block("BedCollider", parent, new Vector3(center.x, frameHeight / 2f, center.z), new Vector3(size.x * 0.9f, frameHeight, size.z * 0.9f), null));
            var go = new GameObject("BedHideSpot");
            go.transform.SetParent(parent, false);
            go.transform.position = new Vector3(center.x, frameHeight, center.z);
            var hide = go.AddComponent<HideSpot>();
            hide.radius = Mathf.Max(0.6f, Mathf.Min(size.x, size.z) * 0.5f);
            hide.height = 0.9f;
            hide.hint = "Hidden under the blanket!";
        }

        /// <summary>A wooden ladder up to a loft edge (Climbable: walk into it or hold jump). Faces `outward` (away from the loft).</summary>
        static void Ladder(Transform parent, Vector3 foot, Vector3 outward, float height, Material wood)
        {
            var go = new GameObject("Ladder");
            go.transform.SetParent(parent, false);
            go.transform.SetPositionAndRotation(foot, Quaternion.LookRotation(outward));
            var climb = go.AddComponent<Climbable>();
            climb.height = height;
            climb.halfWidth = 0.6f;
            Vector3 side = Vector3.Cross(Vector3.up, outward).normalized;
            Vector3 e = Quaternion.LookRotation(outward).eulerAngles;
            // Planks behind the ladder: the pig climbs against them (not up under the loft floor).
            Block("LadderBoards", parent, foot - outward * 0.06f + Vector3.up * height / 2f, new Vector3(1.4f, height, 0.1f), wood, e);
            foreach (float s in new[] { -0.35f, 0.35f })
                Part(PrimitiveType.Cube, "LadderRail", parent, foot + side * s + outward * 0.08f + Vector3.up * (height + 0.8f) / 2f,
                    new Vector3(0.08f, height + 0.8f, 0.08f), wood, e);
            for (float y = 0.3f; y < height + 0.6f; y += 0.35f)
                Part(PrimitiveType.Cube, "LadderRung", parent, foot + outward * 0.08f + Vector3.up * y, new Vector3(0.7f, 0.05f, 0.06f), wood, e);
        }
    }
}
