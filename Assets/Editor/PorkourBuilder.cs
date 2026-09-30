using System.Collections.Generic;
using Unity.Netcode;
using Unity.Netcode.Components;
using Unity.Netcode.Transports.UTP;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Porkour.EditorTools
{
    /// <summary>
    /// Menu "Porkour/..." - builds the placeholder prefabs (pig, player, props - all networked) and the
    /// test barn scene from code, so no manual editor setup is needed. Re-running overwrites them.
    /// </summary>
    public static class PorkourBuilder
    {
        const string MaterialDir = "Assets/Art/Materials";
        const string PhysicsDir = "Assets/Art/Physics";
        const string PrefabDir = "Assets/Prefabs";
        const string PigPrefabPath = PrefabDir + "/Pig.prefab";
        const string PlayerPrefabPath = PrefabDir + "/Player.prefab";
        const string PropDir = PrefabDir + "/Props";
        const string ScenePath = "Assets/Scenes/TestBarn.unity";
        const string InputPath = "Assets/Input/PigControls.inputactions";

        public static GameObject BuildPigPrefab()
        {
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

            root.AddComponent<PigController>();
            root.AddComponent<PigGrabber>();
            var look = root.AddComponent<PigLook>();
            AddNetworkSync(root);
            root.AddComponent<PigNet>();

            // Placeholder look - primitives only, no colliders.
            var v = new GameObject("Visual").transform;
            v.SetParent(root.transform, false);
            var skin = new List<Renderer>
            {
                Part(PrimitiveType.Capsule, "Body", v, new Vector3(0f, 0.05f, 0f), new Vector3(0.85f, 0.65f, 0.7f), pink, new Vector3(90f, 0f, 0f)).GetComponent<Renderer>(),
                Part(PrimitiveType.Sphere, "Head", v, new Vector3(0f, 0.2f, 0.62f), Vector3.one * 0.6f, pink).GetComponent<Renderer>(),
            };
            Part(PrimitiveType.Cylinder, "Snout", v, new Vector3(0f, 0.15f, 0.93f), new Vector3(0.28f, 0.05f, 0.28f), darkPink, new Vector3(90f, 0f, 0f));
            Part(PrimitiveType.Sphere, "EyeL", v, new Vector3(-0.12f, 0.3f, 0.87f), Vector3.one * 0.07f, black);
            Part(PrimitiveType.Sphere, "EyeR", v, new Vector3(0.12f, 0.3f, 0.87f), Vector3.one * 0.07f, black);
            Part(PrimitiveType.Cube, "EarL", v, new Vector3(-0.16f, 0.48f, 0.58f), new Vector3(0.14f, 0.18f, 0.04f), darkPink, new Vector3(0f, 0f, 20f));
            Part(PrimitiveType.Cube, "EarR", v, new Vector3(0.16f, 0.48f, 0.58f), new Vector3(0.14f, 0.18f, 0.04f), darkPink, new Vector3(0f, 0f, -20f));
            Part(PrimitiveType.Sphere, "Tail", v, new Vector3(0f, 0.2f, -0.68f), Vector3.one * 0.12f, darkPink);
            foreach (var (x, z) in new[] { (-0.22f, 0.38f), (0.22f, 0.38f), (-0.22f, -0.38f), (0.22f, -0.38f) })
                skin.Add(Part(PrimitiveType.Cylinder, "Leg", v, new Vector3(x, -0.35f, z), new Vector3(0.16f, 0.1f, 0.16f), pink).GetComponent<Renderer>());
            look.skin = skin.ToArray();

            return SavePrefab(root, PigPrefabPath);
        }

        public static GameObject BuildPlayerPrefab()
        {
            var controls = AssetDatabase.LoadAssetAtPath<InputActionAsset>(InputPath);
            if (controls == null)
            {
                Debug.LogError($"Porkour: input asset not found at {InputPath}");
                return null;
            }
            EnsureFolder(PrefabDir);

            var root = new GameObject("Player");
            root.AddComponent<NetworkObject>();
            var player = root.AddComponent<NetPlayer>();
            player.controls = controls;
            player.arcMaterial = UnlitMat("ThrowArc", new Color(1f, 0.85f, 0.2f));

            return SavePrefab(root, PlayerPrefabPath);
        }

        [MenuItem("Porkour/Rebuild Test Barn")]
        static void RebuildTestBarnMenu()
        {
            if (EditorApplication.isPlaying)
            {
                EditorUtility.DisplayDialog("Porkour", "Stop Play mode first (click the Play button again), then run Porkour > Rebuild Test Barn.", "OK");
                return;
            }
            try
            {
                if (BuildTestBarn())
                    EditorUtility.DisplayDialog("Porkour", "Test barn rebuilt!\n\nHierarchy should now show: Main Camera, Directional Light, Barn, NetworkManager, SpawnPoints.\nPress Play (pigs appear when the game starts).", "OK");
            }
            catch (System.Exception e)
            {
                Debug.LogException(e);
                EditorUtility.DisplayDialog("Porkour - error", e.Message + "\n\nCopy the red error from the Console to Claude.", "OK");
            }
        }

        public static bool BuildTestBarn()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return false;
            var pigPrefab = BuildPigPrefab();
            var playerPrefab = BuildPlayerPrefab();
            if (pigPrefab == null || playerPrefab == null) return false;

            var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);

            var cam = Camera.main;
            cam.gameObject.AddComponent<ThirdPersonCamera>();
            cam.transform.SetPositionAndRotation(new Vector3(0f, 3f, -15f), Quaternion.Euler(20f, 0f, 0f));
            var sun = GameObject.Find("Directional Light");
            if (sun != null) sun.transform.rotation = Quaternion.Euler(50f, -30f, 0f);

            BuildRoom();

            // Networked things are spawned by the server when a game starts, at these points.
            var wood = Mat("Crate", new Color(0.8f, 0.62f, 0.38f));
            var crate = BuildPropPrefab("Crate", PrimitiveType.Cube, Vector3.one, wood, 8f);
            var barrel = BuildPropPrefab("Barrel", PrimitiveType.Cylinder, new Vector3(0.8f, 0.6f, 0.8f), wood, 15f);
            var key = BuildPropPrefab("Key", PrimitiveType.Cube, new Vector3(0.5f, 0.2f, 0.25f), Mat("Gold", new Color(1f, 0.8f, 0.1f)), 1f);

            var spawnRoot = new GameObject("SpawnPoints").transform;
            var points = new List<NetSpawnPoint>();
            // One pig per type; the server gives them random types (colour = type) when the game starts.
            for (int i = 0; i < PigTypes.All.Length; i++)
                points.Add(SpawnPoint(spawnRoot, $"Pig {i + 1}", pigPrefab, new Vector3(-3f + i * 2f, 1f, -10f)));
            for (int i = 0; i < 4; i++)
                points.Add(SpawnPoint(spawnRoot, "Crate", crate, new Vector3(-1.5f + i * 1.3f, 0.5f, -6f)));
            for (int i = 0; i < 3; i++)
                points.Add(SpawnPoint(spawnRoot, "Barrel", barrel, new Vector3(9f + i * 1.2f, 0.6f, -10f)));
            // Key on top of the tall pillar: stack crates, or carry a pig, jump and throw it up.
            points.Add(SpawnPoint(spawnRoot, "Key", key, new Vector3(5f, 3.2f, -6f)));

            var netGo = new GameObject("NetworkManager");
            var nm = netGo.AddComponent<NetworkManager>();
            var transport = netGo.AddComponent<UnityTransport>();
            if (nm.NetworkConfig == null) nm.NetworkConfig = new NetworkConfig();
            nm.NetworkConfig.NetworkTransport = transport;
            nm.NetworkConfig.EnableSceneManagement = false; // everyone loads the same scene; all networked objects are spawned at runtime
            nm.NetworkConfig.Prefabs.NetworkPrefabsLists = new List<NetworkPrefabsList>
            {
                BuildNetworkPrefabsList(pigPrefab, playerPrefab, crate, barrel, key),
            };
            var game = netGo.AddComponent<NetworkGame>();
            game.playerPrefab = playerPrefab;
            game.spawnPoints = points.ToArray();

            EnsureFolder("Assets/Scenes");
            EditorSceneManager.SaveScene(scene, ScenePath);
            var scenes = new List<EditorBuildSettingsScene>(EditorBuildSettings.scenes);
            scenes.RemoveAll(s => s.path == ScenePath);
            scenes.Insert(0, new EditorBuildSettingsScene(ScenePath, true));
            EditorBuildSettings.scenes = scenes.ToArray();
            AssetDatabase.SaveAssets();
            Debug.Log("Porkour: Test barn built. Press Play!");
            return true;
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

            // Floor + walls.
            Block("Floor", r, new Vector3(0f, -0.5f, 0f), new Vector3(half * 2f, 1f, half * 2f), floor);
            Block("WallN", r, new Vector3(0f, wallH / 2f, half + 0.5f), new Vector3(half * 2f + 2f, wallH, 1f), wall);
            Block("WallS", r, new Vector3(0f, wallH / 2f, -half - 0.5f), new Vector3(half * 2f + 2f, wallH, 1f), wall);
            Block("WallE", r, new Vector3(half + 0.5f, wallH / 2f, 0f), new Vector3(1f, wallH, half * 2f), wall);
            Block("WallW", r, new Vector3(-half - 0.5f, wallH / 2f, 0f), new Vector3(1f, wallH, half * 2f), wall);

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

            // Hay bales (round). Pushable crates, barrels and the key are network-spawned (see BuildTestBarn).
            Block("HayBale1", r, new Vector3(-11f, 0.8f, 10f), new Vector3(1.6f, 1f, 1.6f), hay, new Vector3(0f, 0f, 90f), PrimitiveType.Cylinder);
            Block("HayBale2", r, new Vector3(-11f, 0.8f, 6f), new Vector3(1.6f, 1f, 1.6f), hay, new Vector3(0f, 30f, 90f), PrimitiveType.Cylinder);
        }

        // ---------- helpers ----------

        /// <summary>Our own list of spawnable network prefabs (replaces Netcode's auto-generated default list).</summary>
        static NetworkPrefabsList BuildNetworkPrefabsList(params GameObject[] prefabs)
        {
            const string path = PrefabDir + "/PorkourNetworkPrefabs.asset";
            AssetDatabase.DeleteAsset(path);
            var list = ScriptableObject.CreateInstance<NetworkPrefabsList>();
            foreach (var prefab in prefabs) list.Add(new NetworkPrefab { Prefab = prefab });
            AssetDatabase.CreateAsset(list, path);
            return list;
        }

        static GameObject SavePrefab(GameObject go, string path)
        {
            PrefabUtility.SaveAsPrefabAsset(go, path);
            Object.DestroyImmediate(go);
            // Re-import so Netcode regenerates the prefab's network id (GlobalObjectIdHash) from the saved asset.
            AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceUpdate);
            return AssetDatabase.LoadAssetAtPath<GameObject>(path);
        }

        static GameObject BuildPropPrefab(string name, PrimitiveType type, Vector3 scale, Material mat, float mass)
        {
            EnsureFolder(PropDir);
            var go = Part(type, name, null, Vector3.zero, scale, mat, default, keepCollider: true);
            go.AddComponent<Rigidbody>().mass = mass;
            AddNetworkSync(go);
            return SavePrefab(go, $"{PropDir}/{name}.prefab");
        }

        /// <summary>Server-authoritative physics object: clients just follow the synced transform.</summary>
        static void AddNetworkSync(GameObject go)
        {
            go.AddComponent<NetworkObject>();
            var nt = go.AddComponent<NetworkTransform>();
            nt.SyncScaleX = nt.SyncScaleY = nt.SyncScaleZ = false;
            go.AddComponent<NetworkRigidbody>();
        }

        static NetSpawnPoint SpawnPoint(Transform parent, string name, GameObject prefab, Vector3 position)
        {
            var point = new GameObject(name).AddComponent<NetSpawnPoint>();
            point.transform.SetParent(parent, false);
            point.transform.position = position;
            point.prefab = prefab;
            return point;
        }

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

        static Material UnlitMat(string name, Color color)
        {
            EnsureFolder(MaterialDir);
            string path = $"{MaterialDir}/{name}.mat";
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat == null)
            {
                mat = new Material(Shader.Find("Universal Render Pipeline/Unlit"));
                AssetDatabase.CreateAsset(mat, path);
            }
            mat.SetColor("_BaseColor", color);
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
