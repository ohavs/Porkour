using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using Unity.AI.Navigation;
using Unity.Netcode;
using Unity.Netcode.Components;
using Unity.Netcode.Transports.UTP;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.InputSystem;

namespace Porkour.EditorTools
{
    /// <summary>
    /// Menu "Porkour/..." - builds the placeholder prefabs (pig, player, props - all networked) and the
    /// test barn scene from code, so no manual editor setup is needed. Re-running overwrites them.
    /// After every compile the editor checks the scene's SceneBuildInfo stamp and rebuilds by itself when
    /// BuildVersion is newer - so the user never has to remember "Rebuild Test Barn".
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
        /// <summary>Bump whenever BuildTestBarn generates something new → auto-rebuild after the next compile.</summary>
        const int BuildVersion = 3;

        static bool autoRebuildFailed;

        [InitializeOnLoadMethod]
        static void ScheduleAutoRebuildCheck()
        {
            // Multiplayer Play Mode virtual players share our Assets folder - only the main editor may write.
            if (Application.dataPath.Replace('\\', '/').Contains("/Library/VP/")) return;
            EditorApplication.delayCall += AutoRebuildIfOutdated;
        }

        static void AutoRebuildIfOutdated()
        {
            if (autoRebuildFailed || EditorApplication.isPlayingOrWillChangePlaymode) return;
            if (EditorApplication.isCompiling || EditorApplication.isUpdating)
            {
                EditorApplication.delayCall += AutoRebuildIfOutdated; // try again when the editor is idle
                return;
            }
            if (SceneBuildVersion() >= BuildVersion) return;

            Debug.Log($"Porkour: test barn is older than the builder (v{BuildVersion}) - rebuilding automatically.");
            try
            {
                if (BuildTestBarn())
                    EditorUtility.DisplayDialog("Porkour",
                        "The test barn was updated automatically with the newest objects.\n\n" +
                        "Press Play to try it. Later, commit the changed files in GitHub Desktop.", "OK");
            }
            catch (System.Exception e)
            {
                autoRebuildFailed = true;
                Debug.LogException(e);
                EditorUtility.DisplayDialog("Porkour - error", "Automatic test barn rebuild failed:\n" + e.Message +
                    "\n\nCopy the red error from the Console to Claude.", "OK");
            }
        }

        /// <summary>builderVersion stamped in the saved scene file (0 = no scene / made by an older builder).</summary>
        static int SceneBuildVersion()
        {
            if (!File.Exists(ScenePath)) return 0;
            var match = Regex.Match(File.ReadAllText(ScenePath), @"builderVersion: (\d+)");
            return match.Success ? int.Parse(match.Groups[1].Value) : 0;
        }

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

            var barn = BuildRoom();

            // Networked things are spawned by the server when a game starts, at these points.
            var wood = Mat("Crate", new Color(0.8f, 0.62f, 0.38f));
            var crate = BuildPropPrefab("Crate", PrimitiveType.Cube, Vector3.one, wood, 8f);
            var barrel = BuildPropPrefab("Barrel", PrimitiveType.Cylinder, new Vector3(0.8f, 0.6f, 0.8f), wood, 15f);
            var key = BuildPropPrefab("Key", PrimitiveType.Cube, new Vector3(0.5f, 0.2f, 0.25f), Mat("Gold", new Color(1f, 0.8f, 0.1f)), 1f);
            var weakCrate = BuildBreakableCratePrefab();
            var boards = BuildRottenBoardsPrefab();
            var plate = BuildPressurePlatePrefab();
            var gate = BuildGatePrefab("Gate", new Vector3(0.4f, 3f, 2f), new Vector3(0f, -3.05f, 0f), 3f, carve: true,
                Mat("Gate", new Color(0.35f, 0.37f, 0.42f)));
            var barnDoor = BuildGatePrefab("BarnDoor", new Vector3(3f, 3.5f, 0.3f), new Vector3(0f, -3.6f, 0f), 5f, carve: false,
                Mat("BarnDoor", new Color(0.45f, 0.2f, 0.12f)));
            var bob = BuildBobPrefab();
            var target = BuildTargetPrefab();
            var bell = BuildBellPrefab();
            var chicken = BuildChickenPrefab();
            var apple = BuildAmmoPrefab("Apple", Ammo.Kind.Apple, PrimitiveType.Sphere, Vector3.one * 0.28f, new Color(0.85f, 0.12f, 0.1f));
            var corn = BuildAmmoPrefab("Corn", Ammo.Kind.Corn, PrimitiveType.Capsule, new Vector3(0.16f, 0.2f, 0.16f), new Color(1f, 0.85f, 0.2f));
            var egg = BuildAmmoPrefab("Egg", Ammo.Kind.Egg, PrimitiveType.Sphere, new Vector3(0.2f, 0.26f, 0.2f), new Color(0.98f, 0.95f, 0.85f),
                breaks: true, debris: new Color(1f, 0.85f, 0.3f));
            var bolt = BuildAmmoPrefab("Bolt", Ammo.Kind.Bolt, PrimitiveType.Cylinder, new Vector3(0.12f, 0.1f, 0.12f), new Color(0.55f, 0.57f, 0.6f));

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

            // Heavy's toys: weak crates to smash, and the side room (see BuildRoom) with a key crate inside.
            for (int i = 0; i < 3; i++)
                points.Add(SpawnPoint(spawnRoot, "BreakableCrate", weakCrate, new Vector3(-1f + i * 1.5f, 0.45f, -2.5f)));
            points.Add(SpawnPoint(spawnRoot, "RottenBoards", boards, new Vector3(-12f, 1.5f, -9f)));
            points.Add(SpawnPoint(spawnRoot, "Gate", gate, new Vector3(-9f, 1.5f, -12f), channel: 1));
            points.Add(SpawnPoint(spawnRoot, "PressurePlate", plate, new Vector3(-6f, 0f, -12.5f), channel: 1));
            points.Add(SpawnPoint(spawnRoot, "KeyCrate", weakCrate, new Vector3(-12.5f, 0.45f, -12.5f), contents: key));

            // Farmer Bob waits by his grill in the yard; the barn door (channel 99) opens for him.
            points.Add(SpawnPoint(spawnRoot, "FarmerBob", bob, new Vector3(0f, 0f, -21.5f)));
            points.Add(SpawnPoint(spawnRoot, "BarnDoor", barnDoor, new Vector3(0f, 1.75f, -15.5f), channel: 99));
            // Bait: throw a chicken at Bob and he drops the pig / leaves.
            points.Add(SpawnPoint(spawnRoot, "Chicken", chicken, new Vector3(4f, 0.35f, 0f)));
            points.Add(SpawnPoint(spawnRoot, "Chicken", chicken, new Vector3(-3.5f, 0.35f, 0f)));

            // Armed's toys: ammo piles, a bullseye over the side room gate (also opens it), a bell that lures Bob.
            points.Add(SpawnPoint(spawnRoot, "GateTarget", target, new Vector3(-8.7f, 3.5f, -12f), channel: 1,
                rotation: Quaternion.Euler(0f, 90f, 0f)));
            points.Add(SpawnPoint(spawnRoot, "Bell", bell, new Vector3(13.5f, 3.2f, 12.6f)));
            var ammoPiles = new (GameObject prefab, Vector3 center)[]
            {
                (apple, new Vector3(-3f, 0.2f, 4.5f)), (corn, new Vector3(2f, 0.2f, 3.5f)),
                (egg, new Vector3(-8f, 0.2f, 9.5f)), (bolt, new Vector3(7f, 0.2f, -2.8f)),
            };
            foreach (var (prefab, center) in ammoPiles)
                for (int i = 0; i < 3; i++)
                    points.Add(SpawnPoint(spawnRoot, prefab.name, prefab, center + new Vector3((i - 1) * 0.5f, 0f, (i % 2) * 0.5f)));

            var netGo = new GameObject("NetworkManager");
            var nm = netGo.AddComponent<NetworkManager>();
            var transport = netGo.AddComponent<UnityTransport>();
            if (nm.NetworkConfig == null) nm.NetworkConfig = new NetworkConfig();
            nm.NetworkConfig.NetworkTransport = transport;
            nm.NetworkConfig.EnableSceneManagement = false; // everyone loads the same scene; all networked objects are spawned at runtime
            nm.NetworkConfig.Prefabs.NetworkPrefabsLists = new List<NetworkPrefabsList>
            {
                BuildNetworkPrefabsList(pigPrefab, playerPrefab, crate, barrel, key, weakCrate, boards, plate, gate,
                    barnDoor, bob, target, bell, chicken, apple, corn, egg, bolt),
            };
            var game = netGo.AddComponent<NetworkGame>();
            game.playerPrefab = playerPrefab;
            game.spawnPoints = points.ToArray();
            game.navMesh = barn.GetComponent<NavMeshSurface>();

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

        static Transform BuildRoom()
        {
            var floor = Mat("BarnFloor", new Color(0.55f, 0.4f, 0.25f));
            var wall = Mat("BarnWall", new Color(0.65f, 0.18f, 0.15f));
            var wood = Mat("Crate", new Color(0.8f, 0.62f, 0.38f));
            var hay = Mat("Hay", new Color(0.93f, 0.8f, 0.35f));
            var stone = Mat("Stone", new Color(0.55f, 0.55f, 0.58f));

            var r = new GameObject("Barn").transform;
            r.gameObject.AddComponent<SceneBuildInfo>().builderVersion = BuildVersion;
            // Farmer Bob's NavMesh: baked on the server at game start from these (static) children only.
            var surface = r.gameObject.AddComponent<NavMeshSurface>();
            surface.collectObjects = CollectObjects.Children;
            surface.useGeometry = NavMeshCollectGeometry.PhysicsColliders;
            const float half = 15f, wallH = 4f;

            // Floor + walls.
            Block("Floor", r, new Vector3(0f, -0.5f, 0f), new Vector3(half * 2f, 1f, half * 2f), floor);
            Block("WallN", r, new Vector3(0f, wallH / 2f, half + 0.5f), new Vector3(half * 2f + 2f, wallH, 1f), wall);
            // South wall with a 3 m barn door opening in the middle (door = network-spawned gate, opened by Bob).
            Block("WallS1", r, new Vector3(-8.75f, wallH / 2f, -half - 0.5f), new Vector3(14.5f, wallH, 1f), wall);
            Block("WallS2", r, new Vector3(8.75f, wallH / 2f, -half - 0.5f), new Vector3(14.5f, wallH, 1f), wall);
            Block("DoorLintel", r, new Vector3(0f, 3.75f, -half - 0.5f), new Vector3(3f, 0.5f, 1f), wall);
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

            // Side room (south-west corner). Two ways in: rotten boards (Heavy smashes them) and a gate
            // opened by the pressure plate outside (Heavy alone, or two pigs). Boards/gate/plate are network-spawned.
            Block("RoomWallN1", r, new Vector3(-14f, wallH / 2f, -9f), new Vector3(2f, wallH, 0.5f), wall);
            Block("RoomWallN2", r, new Vector3(-9.875f, wallH / 2f, -9f), new Vector3(2.25f, wallH, 0.5f), wall);
            Block("RoomLintelN", r, new Vector3(-12f, 3.5f, -9f), new Vector3(2f, 1f, 0.5f), wall);
            Block("RoomWallE1", r, new Vector3(-9f, wallH / 2f, -14f), new Vector3(0.5f, wallH, 2f), wall);
            Block("RoomWallE2", r, new Vector3(-9f, wallH / 2f, -10f), new Vector3(0.5f, wallH, 2f), wall);
            Block("RoomLintelE", r, new Vector3(-9f, 3.5f, -12f), new Vector3(0.5f, 1f, 2f), wall);

            // Hay bales (round). Pushable crates, barrels and the key are network-spawned (see BuildTestBarn).
            Block("HayBale1", r, new Vector3(-11f, 0.8f, 10f), new Vector3(1.6f, 1f, 1.6f), hay, new Vector3(0f, 0f, 90f), PrimitiveType.Cylinder);
            Block("HayBale2", r, new Vector3(-11f, 0.8f, 6f), new Vector3(1.6f, 1f, 1.6f), hay, new Vector3(0f, 30f, 90f), PrimitiveType.Cylinder);

            // Haystacks to hide in from Bob (no colliders - walk in).
            Haystack(r, new Vector3(-11f, 0f, 1f), hay);
            Haystack(r, new Vector3(5f, 0f, 12.5f), hay);
            Haystack(r, new Vector3(12.5f, 0f, -12.5f), hay);

            // Post + arm for the bell (the bell itself is network-spawned).
            Block("BellPost", r, new Vector3(13.5f, 1.7f, 13.5f), new Vector3(0.25f, 3.4f, 0.25f), wood);
            Block("BellArm", r, new Vector3(13.5f, 3.3f, 13.05f), new Vector3(0.15f, 0.15f, 1f), wood);

            // Yard behind the barn door: Farmer Bob's grill.
            Block("YardFloor", r, new Vector3(0f, -0.5f, -21f), new Vector3(14f, 1f, 12f), Mat("Grass", new Color(0.35f, 0.6f, 0.25f)));
            Block("FenceW", r, new Vector3(-7.15f, 1.25f, -21.5f), new Vector3(0.3f, 2.5f, 11f), wood);
            Block("FenceE", r, new Vector3(7.15f, 1.25f, -21.5f), new Vector3(0.3f, 2.5f, 11f), wood);
            Block("FenceS", r, new Vector3(0f, 1.25f, -27.15f), new Vector3(14.6f, 2.5f, 0.3f), wood);
            Block("Grill", r, new Vector3(0f, 0.45f, -24f), new Vector3(1.8f, 0.9f, 1f), Mat("GrillMetal", new Color(0.18f, 0.18f, 0.2f)));
            Block("GrillCoals", r, new Vector3(0f, 0.93f, -24f), new Vector3(1.6f, 0.06f, 0.8f), Mat("Coals", new Color(1f, 0.35f, 0.1f)));
            return r;
        }

        static void Haystack(Transform parent, Vector3 position, Material hay)
        {
            var root = new GameObject("Haystack").transform;
            root.SetParent(parent, false);
            root.position = position;
            Part(PrimitiveType.Sphere, "Hay", root, new Vector3(0f, 0.4f, 0f), new Vector3(2.6f, 1.5f, 2.6f), hay);
            Part(PrimitiveType.Sphere, "Hay", root, new Vector3(0.6f, 0.25f, 0.5f), new Vector3(1.4f, 1f, 1.4f), hay);
            Part(PrimitiveType.Sphere, "Hay", root, new Vector3(-0.7f, 0.2f, -0.4f), new Vector3(1.2f, 0.9f, 1.2f), hay);
            var spot = root.gameObject.AddComponent<HideSpot>();
            spot.radius = 1.1f;
            spot.height = 1.2f;
            var obstacle = root.gameObject.AddComponent<NavMeshObstacle>(); // Bob walks around, not through
            obstacle.shape = NavMeshObstacleShape.Capsule;
            obstacle.center = new Vector3(0f, 0.8f, 0f);
            obstacle.radius = 1.2f;
            obstacle.height = 1.6f;
            obstacle.carving = true;
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

        static NetSpawnPoint SpawnPoint(Transform parent, string name, GameObject prefab, Vector3 position,
            int channel = 0, GameObject contents = null, Quaternion? rotation = null)
        {
            var point = new GameObject(name).AddComponent<NetSpawnPoint>();
            point.transform.SetParent(parent, false);
            point.transform.SetPositionAndRotation(position, rotation ?? Quaternion.identity);
            point.prefab = prefab;
            point.channel = channel;
            point.contents = contents;
            return point;
        }

        /// <summary>Lighter crate with dark X planks: Heavy's Belly Slam smashes it.</summary>
        static GameObject BuildBreakableCratePrefab()
        {
            EnsureFolder(PropDir);
            var woodColor = new Color(0.78f, 0.52f, 0.26f);
            var wood = Mat("WeakCrate", woodColor);
            var cracks = Mat("WeakCrateCracks", new Color(0.3f, 0.2f, 0.12f));
            var go = Part(PrimitiveType.Cube, "BreakableCrate", null, Vector3.zero, Vector3.one * 0.9f, wood, default, keepCollider: true);
            go.AddComponent<Rigidbody>().mass = 6f;
            AddNetworkSync(go);
            go.AddComponent<Breakable>().debrisColor = woodColor;
            foreach (float yaw in new[] { 0f, 90f, 180f, 270f })
            foreach (float roll in new[] { 45f, -45f })
            {
                var rotation = Quaternion.Euler(0f, yaw, 0f);
                Part(PrimitiveType.Cube, "Crack", go.transform, rotation * new Vector3(0f, 0f, 0.51f),
                    new Vector3(1.2f, 0.09f, 0.02f), cracks, (rotation * Quaternion.Euler(0f, 0f, roll)).eulerAngles);
            }
            return SavePrefab(go, $"{PropDir}/BreakableCrate.prefab");
        }

        /// <summary>Rotten planks nailed over a doorway (static, breakable).</summary>
        static GameObject BuildRottenBoardsPrefab()
        {
            EnsureFolder(PropDir);
            var rottenColor = new Color(0.45f, 0.4f, 0.26f);
            var rotten = Mat("RottenWood", rottenColor);
            var root = new GameObject("RottenBoards");
            root.AddComponent<BoxCollider>().size = new Vector3(2f, 3f, 0.3f);
            root.AddComponent<NetworkObject>();
            var breakable = root.AddComponent<Breakable>();
            breakable.debrisColor = rottenColor;
            breakable.debrisPieces = 14;
            var obstacle = root.AddComponent<NavMeshObstacle>(); // Bob can't path through until smashed
            obstacle.shape = NavMeshObstacleShape.Box;
            obstacle.size = new Vector3(2f, 3f, 0.3f);
            obstacle.carving = true;
            for (int i = 0; i < 4; i++)
                Part(PrimitiveType.Cube, "Plank", root.transform, new Vector3(-0.75f + i * 0.5f, 0f, 0f),
                    new Vector3(0.42f, 2.9f, 0.12f), rotten, new Vector3(0f, 0f, i % 2 == 0 ? 2f : -3f));
            Part(PrimitiveType.Cube, "Cross", root.transform, new Vector3(0f, 0.6f, 0.1f), new Vector3(2f, 0.3f, 0.08f), rotten, new Vector3(0f, 0f, 8f));
            Part(PrimitiveType.Cube, "Cross", root.transform, new Vector3(0f, -0.7f, 0.1f), new Vector3(2f, 0.3f, 0.08f), rotten, new Vector3(0f, 0f, -6f));
            return SavePrefab(root, $"{PropDir}/RottenBoards.prefab");
        }

        /// <summary>Heavy floor switch (see PressurePlate): 2x2 plate, top turns green when pressed.</summary>
        static GameObject BuildPressurePlatePrefab()
        {
            EnsureFolder(PropDir);
            var root = new GameObject("PressurePlate");
            var box = root.AddComponent<BoxCollider>();
            box.size = new Vector3(2f, 0.1f, 2f);
            box.center = new Vector3(0f, 0.05f, 0f);
            root.AddComponent<NetworkObject>();
            var plate = root.AddComponent<PressurePlate>();
            Part(PrimitiveType.Cube, "Frame", root.transform, new Vector3(0f, 0.04f, 0f), new Vector3(2.2f, 0.08f, 2.2f), Mat("PlateFrame", new Color(0.3f, 0.3f, 0.32f)));
            var top = Part(PrimitiveType.Cube, "Top", root.transform, new Vector3(0f, 0.08f, 0f), new Vector3(1.8f, 0.06f, 1.8f), Mat("PlateTop", Color.white));
            plate.top = top.GetComponent<Renderer>();
            return SavePrefab(root, $"{PropDir}/PressurePlate.prefab");
        }

        /// <summary>Gate/door that sinks into the floor while its channel is on (see Gate).</summary>
        static GameObject BuildGatePrefab(string name, Vector3 size, Vector3 openOffset, float speed, bool carve, Material mat)
        {
            EnsureFolder(PropDir);
            var go = Part(PrimitiveType.Cube, name, null, Vector3.zero, size, mat, default, keepCollider: true);
            var rb = go.AddComponent<Rigidbody>();
            rb.isKinematic = true;
            rb.mass = 1000f; // never grabbable
            go.AddComponent<NetworkObject>();
            var nt = go.AddComponent<NetworkTransform>();
            nt.SyncScaleX = nt.SyncScaleY = nt.SyncScaleZ = false;
            var gate = go.AddComponent<Gate>();
            gate.openOffset = openOffset;
            gate.speed = speed;
            if (carve) // Bob paths around it while it's closed
            {
                var obstacle = go.AddComponent<NavMeshObstacle>();
                obstacle.shape = NavMeshObstacleShape.Box;
                obstacle.size = Vector3.one; // local space of the scaled cube
                obstacle.carving = true;
            }
            return SavePrefab(go, $"{PropDir}/{name}.prefab");
        }

        /// <summary>Farmer Bob (placeholder farmer from primitives): kinematic body + NavMeshAgent (server) + FarmerBob.</summary>
        static GameObject BuildBobPrefab()
        {
            EnsureFolder(PrefabDir);
            var skin = Mat("BobSkin", new Color(0.96f, 0.76f, 0.62f));
            var overalls = Mat("BobOveralls", new Color(0.2f, 0.35f, 0.7f));
            var shirt = Mat("BobShirt", new Color(0.8f, 0.2f, 0.2f));
            var straw = Mat("BobHat", new Color(0.9f, 0.78f, 0.4f));
            var boots = Mat("BobBoots", new Color(0.3f, 0.2f, 0.12f));

            var root = new GameObject("FarmerBob");
            var col = root.AddComponent<CapsuleCollider>();
            col.height = 1.9f;
            col.radius = 0.4f;
            col.center = new Vector3(0f, 0.95f, 0f);
            var rb = root.AddComponent<Rigidbody>();
            rb.isKinematic = true;
            rb.mass = 100f; // never grabbable
            var agent = root.AddComponent<NavMeshAgent>();
            agent.radius = 0.45f;
            agent.height = 1.9f;
            agent.speed = 3.2f;
            agent.angularSpeed = 540f;
            agent.acceleration = 20f;
            agent.stoppingDistance = 0.2f;
            agent.obstacleAvoidanceType = ObstacleAvoidanceType.NoObstacleAvoidance;
            agent.enabled = false; // the server turns it on
            root.AddComponent<NetworkObject>();
            var nt = root.AddComponent<NetworkTransform>();
            nt.SyncScaleX = nt.SyncScaleY = nt.SyncScaleZ = false;
            nt.SyncRotAngleX = nt.SyncRotAngleZ = false;
            var bob = root.AddComponent<FarmerBob>();

            var v = new GameObject("Visual").transform;
            v.SetParent(root.transform, false);
            Part(PrimitiveType.Capsule, "Legs", v, new Vector3(0f, 0.55f, 0f), new Vector3(0.55f, 0.55f, 0.4f), overalls);
            Part(PrimitiveType.Capsule, "Body", v, new Vector3(0f, 1.25f, 0f), new Vector3(0.75f, 0.5f, 0.5f), overalls);
            Part(PrimitiveType.Cube, "Shirt", v, new Vector3(0f, 1.55f, 0f), new Vector3(0.7f, 0.25f, 0.42f), shirt);
            Part(PrimitiveType.Sphere, "Head", v, new Vector3(0f, 1.85f, 0f), Vector3.one * 0.42f, skin);
            Part(PrimitiveType.Sphere, "Nose", v, new Vector3(0f, 1.83f, 0.22f), Vector3.one * 0.1f, skin);
            Part(PrimitiveType.Cylinder, "HatBrim", v, new Vector3(0f, 2.05f, 0f), new Vector3(0.8f, 0.02f, 0.8f), straw);
            Part(PrimitiveType.Cylinder, "HatTop", v, new Vector3(0f, 2.15f, 0f), new Vector3(0.42f, 0.1f, 0.42f), straw);
            Part(PrimitiveType.Capsule, "ArmL", v, new Vector3(-0.48f, 1.3f, 0f), new Vector3(0.18f, 0.35f, 0.18f), shirt, new Vector3(0f, 0f, 10f));
            Part(PrimitiveType.Capsule, "ArmR", v, new Vector3(0.48f, 1.3f, 0f), new Vector3(0.18f, 0.35f, 0.18f), shirt, new Vector3(0f, 0f, -10f));
            Part(PrimitiveType.Cube, "BootL", v, new Vector3(-0.15f, 0.08f, 0.05f), new Vector3(0.2f, 0.16f, 0.35f), boots);
            Part(PrimitiveType.Cube, "BootR", v, new Vector3(0.15f, 0.08f, 0.05f), new Vector3(0.2f, 0.16f, 0.35f), boots);

            var carry = new GameObject("CarryPoint").transform;
            carry.SetParent(root.transform, false);
            carry.localPosition = new Vector3(0.3f, 2.05f, -0.1f);
            bob.carryPoint = carry;
            // Test barn layout (see BuildRoom).
            bob.doorPosition = new Vector3(0f, 0f, -15.5f);
            bob.doorOutward = Vector3.back;
            bob.insidePoint = new Vector3(0f, 0f, -12f);
            bob.searchCenter = Vector3.zero;
            bob.searchHalfSize = new Vector2(13f, 13f);
            bob.doorChannel = 99;
            return SavePrefab(root, $"{PrefabDir}/FarmerBob.prefab");
        }

        /// <summary>Bullseye switch facing +Z (see ShootTarget).</summary>
        static GameObject BuildTargetPrefab()
        {
            EnsureFolder(PropDir);
            var root = new GameObject("ShootTarget");
            root.AddComponent<BoxCollider>().size = new Vector3(1f, 1f, 0.2f);
            root.AddComponent<NetworkObject>();
            var target = root.AddComponent<ShootTarget>();
            var face = new GameObject("Face").transform; // wobbles when hit
            face.SetParent(root.transform, false);
            var flat = new Vector3(90f, 0f, 0f); // cylinder axis → +Z
            Part(PrimitiveType.Cylinder, "Ring", face, Vector3.zero, new Vector3(1f, 0.05f, 1f), Mat("TargetWhite", Color.white), flat);
            Part(PrimitiveType.Cylinder, "Ring2", face, new Vector3(0f, 0f, 0.03f), new Vector3(0.66f, 0.05f, 0.66f), Mat("TargetRed", new Color(0.85f, 0.15f, 0.12f)), flat);
            var lamp = Part(PrimitiveType.Cylinder, "Centre", face, new Vector3(0f, 0f, 0.06f), new Vector3(0.33f, 0.05f, 0.33f), Mat("TargetCentre", Color.white), flat);
            target.lamp = lamp.GetComponent<Renderer>();
            return SavePrefab(root, $"{PropDir}/ShootTarget.prefab");
        }

        /// <summary>Hanging bell, pivot at the top (see Bell).</summary>
        static GameObject BuildBellPrefab()
        {
            EnsureFolder(PropDir);
            var brass = Mat("Bell", new Color(0.85f, 0.65f, 0.2f));
            var dark = Mat("BellClapper", new Color(0.2f, 0.18f, 0.15f));
            var root = new GameObject("Bell");
            var sphere = root.AddComponent<SphereCollider>();
            sphere.center = new Vector3(0f, -0.35f, 0f);
            sphere.radius = 0.4f;
            root.AddComponent<NetworkObject>();
            var bell = root.AddComponent<Bell>();
            var swing = new GameObject("Swing").transform;
            swing.SetParent(root.transform, false);
            Part(PrimitiveType.Cylinder, "Rope", swing, new Vector3(0f, -0.05f, 0f), new Vector3(0.04f, 0.06f, 0.04f), dark);
            Part(PrimitiveType.Sphere, "Dome", swing, new Vector3(0f, -0.2f, 0f), new Vector3(0.45f, 0.35f, 0.45f), brass);
            Part(PrimitiveType.Cylinder, "Mouth", swing, new Vector3(0f, -0.38f, 0f), new Vector3(0.6f, 0.15f, 0.6f), brass);
            Part(PrimitiveType.Sphere, "Clapper", swing, new Vector3(0f, -0.58f, 0f), Vector3.one * 0.14f, dark);
            bell.swing = swing;
            return SavePrefab(root, $"{PropDir}/Bell.prefab");
        }

        /// <summary>Chicken = Bait for Farmer Bob (grab + throw it at him).</summary>
        static GameObject BuildChickenPrefab()
        {
            EnsureFolder(PropDir);
            var white = Mat("Chicken", new Color(0.97f, 0.97f, 0.95f));
            var red = Mat("ChickenComb", new Color(0.9f, 0.15f, 0.12f));
            var yellow = Mat("ChickenBeak", new Color(1f, 0.75f, 0.15f));
            var root = new GameObject("Chicken");
            var sphere = root.AddComponent<SphereCollider>();
            sphere.radius = 0.3f;
            sphere.center = new Vector3(0f, 0.05f, 0f);
            root.AddComponent<Rigidbody>().mass = 2f;
            AddNetworkSync(root);
            root.AddComponent<Bait>();
            Part(PrimitiveType.Sphere, "Body", root.transform, Vector3.zero, new Vector3(0.5f, 0.45f, 0.6f), white);
            Part(PrimitiveType.Sphere, "Head", root.transform, new Vector3(0f, 0.25f, 0.25f), Vector3.one * 0.28f, white);
            Part(PrimitiveType.Cube, "Comb", root.transform, new Vector3(0f, 0.42f, 0.25f), new Vector3(0.05f, 0.1f, 0.14f), red);
            Part(PrimitiveType.Cube, "Beak", root.transform, new Vector3(0f, 0.24f, 0.42f), new Vector3(0.08f, 0.06f, 0.1f), yellow);
            Part(PrimitiveType.Cube, "Tail", root.transform, new Vector3(0f, 0.15f, -0.3f), new Vector3(0.3f, 0.25f, 0.08f), white, new Vector3(-25f, 0f, 0f));
            Part(PrimitiveType.Cylinder, "LegL", root.transform, new Vector3(-0.08f, -0.25f, 0f), new Vector3(0.04f, 0.08f, 0.04f), yellow);
            Part(PrimitiveType.Cylinder, "LegR", root.transform, new Vector3(0.08f, -0.25f, 0f), new Vector3(0.04f, 0.08f, 0.04f), yellow);
            return SavePrefab(root, $"{PropDir}/Chicken.prefab");
        }

        /// <summary>Small networked item Armed can suck up and shoot (see Ammo).</summary>
        static GameObject BuildAmmoPrefab(string name, Ammo.Kind kind, PrimitiveType type, Vector3 scale, Color color,
            bool breaks = false, Color? debris = null)
        {
            EnsureFolder(PropDir);
            var go = Part(type, name, null, Vector3.zero, scale, Mat(name, color), default, keepCollider: true);
            var rb = go.AddComponent<Rigidbody>();
            rb.mass = 0.3f;
            rb.collisionDetectionMode = CollisionDetectionMode.ContinuousDynamic; // fast shots
            AddNetworkSync(go);
            var ammo = go.AddComponent<Ammo>();
            ammo.kind = kind;
            ammo.breaksOnHit = breaks;
            ammo.debrisColor = debris ?? color;
            return SavePrefab(go, $"{PropDir}/{name}.prefab");
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
