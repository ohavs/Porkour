using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Porkour.EditorTools
{
    /// <summary>
    /// Menu "Porkour/..." - builds the placeholder pig prefab and the test barn scene from code,
    /// so no manual editor setup is needed. Re-running overwrites the prefab and the scene.
    /// </summary>
    public static class PorkourBuilder
    {
        const string MaterialDir = "Assets/Art/Materials";
        const string PhysicsDir = "Assets/Art/Physics";
        const string PrefabDir = "Assets/Prefabs";
        const string PigPrefabPath = PrefabDir + "/Pig.prefab";
        const string ScenePath = "Assets/Scenes/TestBarn.unity";
        const string InputPath = "Assets/Input/PigControls.inputactions";

        [MenuItem("Porkour/Build Pig Prefab")]
        public static GameObject BuildPigPrefab()
        {
            var controls = AssetDatabase.LoadAssetAtPath<InputActionAsset>(InputPath);
            if (controls == null)
            {
                Debug.LogError($"Porkour: input asset not found at {InputPath}");
                return null;
            }

            EnsureFolder(PrefabDir);
            var pink = Mat("Pig", new Color(1f, 0.62f, 0.68f));
            var darkPink = Mat("PigSnout", new Color(0.9f, 0.42f, 0.5f));
            var black = Mat("Eye", new Color(0.05f, 0.05f, 0.05f));

            var root = new GameObject("Pig");
            var rb = root.AddComponent<Rigidbody>();
            rb.mass = 30f;
            rb.interpolation = RigidbodyInterpolation.Interpolate;
            rb.collisionDetectionMode = CollisionDetectionMode.ContinuousDynamic;
            rb.constraints = RigidbodyConstraints.FreezeRotationX | RigidbodyConstraints.FreezeRotationZ;

            var col = root.AddComponent<CapsuleCollider>();
            col.direction = 2; // lying along Z (pig faces +Z)
            col.radius = 0.45f;
            col.height = 1.6f;
            col.center = new Vector3(0f, 0f, 0.1f);
            col.sharedMaterial = SlipperyMaterial();

            var input = root.AddComponent<PlayerInput>();
            input.actions = controls;
            input.defaultActionMap = "Player";
            input.notificationBehavior = PlayerNotifications.InvokeCSharpEvents;

            root.AddComponent<PigController>();

            // Placeholder look - primitives only, no colliders.
            var v = new GameObject("Visual").transform;
            v.SetParent(root.transform, false);
            Part(PrimitiveType.Capsule, "Body", v, new Vector3(0f, 0.05f, 0f), new Vector3(0.85f, 0.65f, 0.7f), pink, new Vector3(90f, 0f, 0f));
            Part(PrimitiveType.Sphere, "Head", v, new Vector3(0f, 0.2f, 0.62f), Vector3.one * 0.6f, pink);
            Part(PrimitiveType.Cylinder, "Snout", v, new Vector3(0f, 0.15f, 0.93f), new Vector3(0.28f, 0.05f, 0.28f), darkPink, new Vector3(90f, 0f, 0f));
            Part(PrimitiveType.Sphere, "EyeL", v, new Vector3(-0.12f, 0.3f, 0.87f), Vector3.one * 0.07f, black);
            Part(PrimitiveType.Sphere, "EyeR", v, new Vector3(0.12f, 0.3f, 0.87f), Vector3.one * 0.07f, black);
            Part(PrimitiveType.Cube, "EarL", v, new Vector3(-0.16f, 0.48f, 0.58f), new Vector3(0.14f, 0.18f, 0.04f), darkPink, new Vector3(0f, 0f, 20f));
            Part(PrimitiveType.Cube, "EarR", v, new Vector3(0.16f, 0.48f, 0.58f), new Vector3(0.14f, 0.18f, 0.04f), darkPink, new Vector3(0f, 0f, -20f));
            Part(PrimitiveType.Sphere, "Tail", v, new Vector3(0f, 0.2f, -0.68f), Vector3.one * 0.12f, darkPink);
            foreach (var (x, z) in new[] { (-0.22f, 0.38f), (0.22f, 0.38f), (-0.22f, -0.38f), (0.22f, -0.38f) })
                Part(PrimitiveType.Cylinder, "Leg", v, new Vector3(x, -0.35f, z), new Vector3(0.16f, 0.1f, 0.16f), pink);

            var prefab = PrefabUtility.SaveAsPrefabAsset(root, PigPrefabPath);
            Object.DestroyImmediate(root);
            return prefab;
        }

        [MenuItem("Porkour/Build Test Barn Scene")]
        public static void BuildTestBarn()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            var pigPrefab = BuildPigPrefab();
            if (pigPrefab == null) return;

            var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);

            var cam = Camera.main;
            cam.gameObject.AddComponent<PartyCamera>();
            cam.transform.SetPositionAndRotation(new Vector3(0f, 11f, -18f), Quaternion.Euler(55f, 0f, 0f));
            var sun = GameObject.Find("Directional Light");
            if (sun != null) sun.transform.rotation = Quaternion.Euler(50f, -30f, 0f);

            BuildRoom();

            var pig = (GameObject)PrefabUtility.InstantiatePrefab(pigPrefab);
            pig.transform.position = new Vector3(0f, 1f, -10f);

            EnsureFolder("Assets/Scenes");
            EditorSceneManager.SaveScene(scene, ScenePath);
            var scenes = new List<EditorBuildSettingsScene>(EditorBuildSettings.scenes);
            scenes.RemoveAll(s => s.path == ScenePath);
            scenes.Insert(0, new EditorBuildSettingsScene(ScenePath, true));
            EditorBuildSettings.scenes = scenes.ToArray();
            AssetDatabase.SaveAssets();
            Debug.Log("Porkour: Test barn built. Press Play!");
        }

        static void BuildRoom()
        {
            var floor = Mat("BarnFloor", new Color(0.55f, 0.4f, 0.25f));
            var wall = Mat("BarnWall", new Color(0.65f, 0.18f, 0.15f));
            var wood = Mat("Crate", new Color(0.8f, 0.62f, 0.38f));
            var hay = Mat("Hay", new Color(0.93f, 0.8f, 0.35f));
            var stone = Mat("Stone", new Color(0.55f, 0.55f, 0.58f));

            var r = new GameObject("Barn").transform;
            const float half = 15f, wallH = 4f;

            // Floor + walls. The south wall faces the camera, so it is an invisible collider.
            Block("Floor", r, new Vector3(0f, -0.5f, 0f), new Vector3(half * 2f, 1f, half * 2f), floor);
            Block("WallN", r, new Vector3(0f, wallH / 2f, half + 0.5f), new Vector3(half * 2f + 2f, wallH, 1f), wall);
            Block("WallE", r, new Vector3(half + 0.5f, wallH / 2f, 0f), new Vector3(1f, wallH, half * 2f), wall);
            Block("WallW", r, new Vector3(-half - 0.5f, wallH / 2f, 0f), new Vector3(1f, wallH, half * 2f), wall);
            var south = Block("WallS_Invisible", r, new Vector3(0f, wallH / 2f, -half - 0.5f), new Vector3(half * 2f + 2f, wallH, 1f), wall);
            south.GetComponent<Renderer>().enabled = false;
            Block("FenceS", r, new Vector3(0f, 0.3f, -half - 0.5f), new Vector3(half * 2f + 2f, 0.6f, 0.3f), wall);

            // Staircase of crates (0.6 / 1.2 / 1.8 / 2.4) - tests jump height.
            Block("Step1", r, new Vector3(-6f, 0.3f, -6f), new Vector3(2f, 0.6f, 2f), wood);
            Block("Step2", r, new Vector3(-6f, 0.6f, -3.5f), new Vector3(2f, 1.2f, 2f), wood);
            Block("Step3", r, new Vector3(-6f, 0.9f, -1f), new Vector3(2f, 1.8f, 2f), wood);
            Block("Step4", r, new Vector3(-6f, 1.2f, 2.5f), new Vector3(2f, 2.4f, 4f), wood);

            // Too tall for one pig - a future co-op challenge.
            Block("TallPillar", r, new Vector3(5f, 1.5f, -6f), new Vector3(2f, 3f, 2f), stone);

            // Ramp up to a platform, then gap jumps over to the staircase top.
            const float rampRise = 2f, rampRun = 7f;
            float rampAngle = Mathf.Atan2(rampRise, rampRun) * Mathf.Rad2Deg;
            float rampLen = Mathf.Sqrt(rampRise * rampRise + rampRun * rampRun);
            Block("Ramp", r, new Vector3(10f, rampRise / 2f - 0.15f, 1.5f), new Vector3(4f, 0.3f, rampLen), stone, new Vector3(-rampAngle, 0f, 0f));
            Block("RampTop", r, new Vector3(10f, 1f, 8f), new Vector3(6f, 2f, 6f), stone);
            Block("Gap1", r, new Vector3(4f, 1.75f, 8f), new Vector3(2f, 0.5f, 2f), wood);
            Block("Gap2", r, new Vector3(0f, 1.75f, 8f), new Vector3(2f, 0.5f, 2f), wood);
            Block("Gap3", r, new Vector3(-4f, 2.15f, 5.5f), new Vector3(2f, 0.5f, 2f), wood);

            // Hay bales (round) and pushable crates.
            Block("HayBale1", r, new Vector3(-11f, 0.8f, 10f), new Vector3(1.6f, 1f, 1.6f), hay, new Vector3(0f, 0f, 90f), PrimitiveType.Cylinder);
            Block("HayBale2", r, new Vector3(-11f, 0.8f, 6f), new Vector3(1.6f, 1f, 1.6f), hay, new Vector3(0f, 30f, 90f), PrimitiveType.Cylinder);
            for (int i = 0; i < 4; i++)
            {
                var crate = Block("PushCrate", r, new Vector3(-1.5f + i * 1.3f, 0.5f, -6f), Vector3.one, wood);
                crate.AddComponent<Rigidbody>().mass = 8f;
            }
        }

        // ---------- helpers ----------

        static GameObject Block(string name, Transform parent, Vector3 pos, Vector3 scale, Material mat,
            Vector3 euler = default, PrimitiveType type = PrimitiveType.Cube)
        {
            return Part(type, name, parent, pos, scale, mat, euler, keepCollider: true);
        }

        static GameObject Part(PrimitiveType type, string name, Transform parent, Vector3 pos, Vector3 scale,
            Material mat, Vector3 euler = default, bool keepCollider = false)
        {
            var go = GameObject.CreatePrimitive(type);
            go.name = name;
            if (!keepCollider) Object.DestroyImmediate(go.GetComponent<Collider>());
            go.transform.SetParent(parent, false);
            go.transform.SetLocalPositionAndRotation(pos, Quaternion.Euler(euler));
            go.transform.localScale = scale;
            go.GetComponent<Renderer>().sharedMaterial = mat;
            return go;
        }

        static Material Mat(string name, Color color)
        {
            EnsureFolder(MaterialDir);
            string path = $"{MaterialDir}/{name}.mat";
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat == null)
            {
                mat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
                AssetDatabase.CreateAsset(mat, path);
            }
            mat.SetColor("_BaseColor", color);
            mat.SetFloat("_Smoothness", 0.15f);
            EditorUtility.SetDirty(mat);
            return mat;
        }

        static PhysicsMaterial SlipperyMaterial()
        {
            EnsureFolder(PhysicsDir);
            string path = $"{PhysicsDir}/PigSlippery.asset";
            var pm = AssetDatabase.LoadAssetAtPath<PhysicsMaterial>(path);
            if (pm == null)
            {
                pm = new PhysicsMaterial("PigSlippery");
                AssetDatabase.CreateAsset(pm, path);
            }
            // No friction so pigs don't stick to walls mid-jump; movement code handles stopping.
            pm.dynamicFriction = 0f;
            pm.staticFriction = 0f;
            pm.frictionCombine = PhysicsMaterialCombine.Minimum;
            pm.bounciness = 0f;
            EditorUtility.SetDirty(pm);
            return pm;
        }

        static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            int slash = path.LastIndexOf('/');
            string parent = path.Substring(0, slash);
            EnsureFolder(parent);
            AssetDatabase.CreateFolder(parent, path.Substring(slash + 1));
        }
    }
}
