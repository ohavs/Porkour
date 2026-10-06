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
    /// Menu "Porkour/..." - builds the placeholder prefabs (pig, player, props - all networked) and the barn
    /// scene from code, so no manual editor setup is needed. Re-running overwrites them.
    /// After every compile the editor checks the scene's SceneBuildInfo stamp and rebuilds by itself when
    /// BuildVersion is newer - so the user never has to remember "Rebuild Barn".
    /// </summary>
    public static class PorkourBuilder
    {
        const string MaterialDir = "Assets/Art/Materials";
        const string PhysicsDir = "Assets/Art/Physics";
        const string PrefabDir = "Assets/Prefabs";
        const string PigPrefabPath = PrefabDir + "/Pig.prefab";
        const string PlayerPrefabPath = PrefabDir + "/Player.prefab";
        const string PropDir = PrefabDir + "/Props";
        const string ScenePath = "Assets/Scenes/Barn.unity";
        /// <summary>Replaced by the barn (deleted on rebuild).</summary>
        const string OldScenePath = "Assets/Scenes/TestBarn.unity";
        const string InputPath = "Assets/Input/PigControls.inputactions";
        /// <summary>Bump whenever BuildBarn generates something new → auto-rebuild after the next compile.</summary>
        const int BuildVersion = 4;

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

            Debug.Log($"Porkour: the barn is older than the builder (v{BuildVersion}) - rebuilding automatically.");
            try
            {
                if (BuildBarn())
                    EditorUtility.DisplayDialog("Porkour",
                        "The barn was updated automatically with the newest objects.\n\n" +
                        "Press Play to try it. Later, commit the changed files in GitHub Desktop.", "OK");
            }
            catch (System.Exception e)
            {
                autoRebuildFailed = true;
                Debug.LogException(e);
                EditorUtility.DisplayDialog("Porkour - error", "Automatic barn rebuild failed:\n" + e.Message +
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

            var anim = root.AddComponent<ProceduralAnimator>();
            anim.kind = ProceduralAnimator.Kind.Pig;
            anim.visual = v;

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

        /// <summary>The round manager (timer, objectives, win/lose) - spawned once by NetworkGame.</summary>
        static GameObject BuildRoundPrefab()
        {
            EnsureFolder(PrefabDir);
            var root = new GameObject("Round");
            root.AddComponent<NetworkObject>();
            root.AddComponent<RoundManager>();
            return SavePrefab(root, PrefabDir + "/Round.prefab");
        }

        [MenuItem("Porkour/Rebuild Barn")]
        static void RebuildBarnMenu()
        {
            if (EditorApplication.isPlaying)
            {
                EditorUtility.DisplayDialog("Porkour", "Stop Play mode first (click the Play button again), then run Porkour > Rebuild Barn.", "OK");
                return;
            }
            try
            {
                if (BuildBarn())
                    EditorUtility.DisplayDialog("Porkour", "Barn rebuilt!\n\nHierarchy should now show: Main Camera, Directional Light, Barn, NetworkManager, SpawnPoints.\nPress Play (pigs appear when the game starts).", "OK");
            }
            catch (System.Exception e)
            {
                Debug.LogException(e);
                EditorUtility.DisplayDialog("Porkour - error", e.Message + "\n\nCopy the red error from the Console to Claude.", "OK");
            }
        }

        public static bool BuildBarn()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return false;
            var pigPrefab = BuildPigPrefab();
            var playerPrefab = BuildPlayerPrefab();
            if (pigPrefab == null || playerPrefab == null) return false;
            var round = BuildRoundPrefab();

            var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);

            var cam = Camera.main;
            cam.gameObject.AddComponent<ThirdPersonCamera>();
            cam.transform.SetPositionAndRotation(new Vector3(13f, 4f, -18f), Quaternion.Euler(15f, 0f, 0f));
            var sun = GameObject.Find("Directional Light");
            if (sun != null) sun.transform.rotation = Quaternion.Euler(58f, -35f, 0f);

            var barn = BuildLevel();

            // Networked things are spawned by the server when a round starts, at these points.
            var wood = Mat("Crate", new Color(0.8f, 0.62f, 0.38f));
            var crate = BuildPropPrefab("Crate", PrimitiveType.Cube, Vector3.one, wood, 8f);
            var barrel = BuildPropPrefab("Barrel", PrimitiveType.Cylinder, new Vector3(0.8f, 0.6f, 0.8f), wood, 15f);
            var key = BuildKeyPrefab();
            var weakCrate = BuildBreakableCratePrefab();
            var boards = BuildRottenBoardsPrefab();
            var plate = BuildPressurePlatePrefab();
            var lift = BuildGatePrefab("Lift", new Vector3(2.4f, 0.2f, 2.4f), new Vector3(0f, 3.1f, 0f), 1.5f, carve: false,
                Mat("LiftDeck", new Color(0.85f, 0.7f, 0.25f)));
            var barnDoor = BuildGatePrefab("BarnDoor", new Vector3(3f, 3.5f, 0.3f), new Vector3(0f, -3.6f, 0f), 5f, carve: false,
                Mat("BarnDoor", new Color(0.45f, 0.2f, 0.12f)));
            var exitGate = BuildExitGatePrefab();
            var fence = BuildElectricFencePrefab();
            var fuseBox = BuildFuseBoxPrefab();
            var generator = BuildGeneratorPrefab();
            var padlock = BuildKeySlotPrefab();
            var bob = BuildBobPrefab();
            var target = BuildTargetPrefab();
            var bell = BuildBellPrefab();
            var chicken = BuildChickenPrefab();
            var sheep = BuildSheepPrefab();
            var bucket = BuildBucketPrefab();
            var apple = BuildAmmoPrefab("Apple", Ammo.Kind.Apple, PrimitiveType.Sphere, Vector3.one * 0.28f, new Color(0.85f, 0.12f, 0.1f));
            var corn = BuildAmmoPrefab("Corn", Ammo.Kind.Corn, PrimitiveType.Capsule, new Vector3(0.16f, 0.2f, 0.16f), new Color(1f, 0.85f, 0.2f));
            var egg = BuildAmmoPrefab("Egg", Ammo.Kind.Egg, PrimitiveType.Sphere, new Vector3(0.2f, 0.26f, 0.2f), new Color(0.98f, 0.95f, 0.85f),
                breaks: true, debris: new Color(1f, 0.85f, 0.3f));
            var bolt = BuildAmmoPrefab("Bolt", Ammo.Kind.Bolt, PrimitiveType.Cylinder, new Vector3(0.12f, 0.1f, 0.12f), new Color(0.55f, 0.57f, 0.6f));

            var spawnRoot = new GameObject("SpawnPoints").transform;
            var points = new List<NetSpawnPoint>();
            // Pigs start in the pen (south-east); the server gives them random types (colour = type) every round.
            for (int i = 0; i < PigTypes.All.Length; i++)
                points.Add(SpawnPoint(spawnRoot, $"Pig {i + 1}", pigPrefab, new Vector3(10.6f + i * 1.8f, 1f, -10.5f)));

            // ---- Escape: 4 locks on the exit (north) ----
            // 1. Padlock: the key sits on the north roof beam, far west - Jumpy's job (Gassy can rocket up too).
            points.Add(SpawnPoint(spawnRoot, "Key", key, new Vector3(-12f, 5.75f, 7f)));
            points.Add(SpawnPoint(spawnRoot, "Padlock", padlock, new Vector3(-4.5f, 0f, 13.6f), channel: ChannelIds.Padlock));
            // 2. Electric fence in the exit passage; its fuse box is in the tool shed behind rotten boards - Heavy.
            points.Add(SpawnPoint(spawnRoot, "ElectricFence", fence, new Vector3(0f, 2f, 16.6f), channel: ChannelIds.Fence));
            points.Add(SpawnPoint(spawnRoot, "RottenBoards", boards, new Vector3(-13f, 1.5f, -2.5f), rotation: Quaternion.Euler(0f, 90f, 0f)));
            points.Add(SpawnPoint(spawnRoot, "FuseBox", fuseBox, new Vector3(-19.75f, 1f, -2.5f), channel: ChannelIds.Fence,
                rotation: Quaternion.Euler(0f, 90f, 0f)));
            // 3. Generator (runs on farts) up on the hayloft - Gassy.
            points.Add(SpawnPoint(spawnRoot, "Generator", generator, new Vector3(17.5f, 3.2f, 10.5f), channel: ChannelIds.Generator,
                rotation: Quaternion.Euler(0f, -90f, 0f)));
            // 4. Three bullseyes high on the walls - Armed (latching).
            points.Add(SpawnPoint(spawnRoot, "Bullseye 1", target, new Vector3(9f, 6f, 14.85f), channel: ChannelIds.Target1,
                rotation: Quaternion.Euler(0f, 180f, 0f)));
            points.Add(SpawnPoint(spawnRoot, "Bullseye 2", target, new Vector3(-8f, 6f, -14.85f), channel: ChannelIds.Target2));
            points.Add(SpawnPoint(spawnRoot, "Bullseye 3", target, new Vector3(-19.85f, 6.5f, -11f), channel: ChannelIds.Target3,
                rotation: Quaternion.Euler(0f, 90f, 0f)));
            // The exit gate opens when padlock + generator + bullseyes are done (see BuildExitGatePrefab).
            points.Add(SpawnPoint(spawnRoot, "ExitGate", exitGate, new Vector3(0f, 2f, 19.5f)));

            // ---- Getting up high ----
            // Lift to the hayloft: stand on the plate (40 kg = Heavy, or two pigs) and the lift rises.
            points.Add(SpawnPoint(spawnRoot, "LiftPlate", plate, new Vector3(6.5f, 0f, -3.3f), channel: ChannelIds.Lift));
            points.Add(SpawnPoint(spawnRoot, "Lift", lift, new Vector3(10.7f, 0.1f, -3.3f), channel: ChannelIds.Lift));
            // Crates to stack: by the hayloft edge and under the west shelf.
            foreach (var p in new[] { new Vector3(10.8f, 0.5f, 2.5f), new Vector3(10.8f, 0.5f, 3.8f), new Vector3(9.6f, 0.5f, 3.1f),
                         new Vector3(-17f, 0.5f, 9.3f), new Vector3(-17f, 0.5f, 10.6f), new Vector3(-15.7f, 0.5f, 9.9f) })
                points.Add(SpawnPoint(spawnRoot, "Crate", crate, p));
            foreach (var p in new[] { new Vector3(-4f, 0.6f, -10f), new Vector3(-3f, 0.6f, -11f), new Vector3(6f, 0.6f, 9f) })
                points.Add(SpawnPoint(spawnRoot, "Barrel", barrel, p));

            // ---- Heavy's toys: weak crates (some with ammo inside) ----
            points.Add(SpawnPoint(spawnRoot, "BreakableCrate", weakCrate, new Vector3(-8f, 0.45f, -9f), contents: apple));
            points.Add(SpawnPoint(spawnRoot, "BreakableCrate", weakCrate, new Vector3(2f, 0.45f, 10f), contents: corn));
            points.Add(SpawnPoint(spawnRoot, "BreakableCrate", weakCrate, new Vector3(-10f, 0.45f, 4f)));
            points.Add(SpawnPoint(spawnRoot, "BreakableCrate", weakCrate, new Vector3(-18.5f, 0.45f, 0.8f), contents: apple));

            // ---- Farmer Bob, his barn door (channel 99), bait, hiding buckets, the bell lure ----
            points.Add(SpawnPoint(spawnRoot, "FarmerBob", bob, new Vector3(0f, 0f, -21.5f)));
            points.Add(SpawnPoint(spawnRoot, "BarnDoor", barnDoor, new Vector3(0f, 1.75f, -15.5f), channel: ChannelIds.BobDoor));
            foreach (var p in new[] { new Vector3(-4f, 0.35f, 0f), new Vector3(4f, 0.35f, -5f), new Vector3(-12f, 0.35f, 8f) })
                points.Add(SpawnPoint(spawnRoot, "Chicken", chicken, p));
            points.Add(SpawnPoint(spawnRoot, "Sheep", sheep, new Vector3(6f, 0.55f, 2f)));
            foreach (var p in new[] { new Vector3(3f, 0.55f, -8f), new Vector3(-10f, 0.55f, 12f), new Vector3(-15.5f, 0.55f, 0.5f) })
                points.Add(SpawnPoint(spawnRoot, "Bucket", bucket, p));
            points.Add(SpawnPoint(spawnRoot, "Bell", bell, new Vector3(-5f, 5.1f, -2f)));

            // ---- Armed's ammo piles ----
            var ammoPiles = new (GameObject prefab, Vector3 center, int count)[]
            {
                (apple, new Vector3(7.5f, 0.2f, -7f), 4), (corn, new Vector3(-2f, 0.2f, 3f), 4),
                (egg, new Vector3(18.5f, 3.4f, 3f), 3), (bolt, new Vector3(-17f, 0.2f, -5.5f), 4),
            };
            foreach (var (prefab, center, count) in ammoPiles)
                for (int i = 0; i < count; i++)
                    points.Add(SpawnPoint(spawnRoot, prefab.name, prefab, center + new Vector3((i % 2 - 0.5f) * 0.5f, 0f, (i / 2 - 0.5f) * 0.5f)));

            var netGo = new GameObject("NetworkManager");
            var nm = netGo.AddComponent<NetworkManager>();
            var transport = netGo.AddComponent<UnityTransport>();
            if (nm.NetworkConfig == null) nm.NetworkConfig = new NetworkConfig();
            nm.NetworkConfig.NetworkTransport = transport;
            nm.NetworkConfig.EnableSceneManagement = false; // everyone loads the same scene; all networked objects are spawned at runtime
            nm.NetworkConfig.Prefabs.NetworkPrefabsLists = new List<NetworkPrefabsList>
            {
                BuildNetworkPrefabsList(pigPrefab, playerPrefab, round, crate, barrel, key, weakCrate, boards, plate, lift,
                    barnDoor, exitGate, fence, fuseBox, generator, padlock, bob, target, bell, chicken, sheep, bucket,
                    apple, corn, egg, bolt),
            };
            var game = netGo.AddComponent<NetworkGame>();
            game.playerPrefab = playerPrefab;
            game.roundPrefab = round;
            game.spawnPoints = points.ToArray();
            game.navMesh = barn.GetComponent<NavMeshSurface>();

            EnsureFolder("Assets/Scenes");
            EditorSceneManager.SaveScene(scene, ScenePath);
            var scenes = new List<EditorBuildSettingsScene>(EditorBuildSettings.scenes);
            scenes.RemoveAll(s => s.path == ScenePath || s.path == OldScenePath);
            scenes.Insert(0, new EditorBuildSettingsScene(ScenePath, true));
            EditorBuildSettings.scenes = scenes.ToArray();
            // Leftovers from the old test barn.
            if (File.Exists(OldScenePath)) AssetDatabase.DeleteAsset(OldScenePath);
            if (File.Exists(PropDir + "/Gate.prefab")) AssetDatabase.DeleteAsset(PropDir + "/Gate.prefab");
            if (File.Exists(PropDir + "/Key.prefab")) AssetDatabase.DeleteAsset(PropDir + "/Key.prefab");
            AssetDatabase.SaveAssets();
            Debug.Log("Porkour: Barn built. Press Play!");
            return true;
        }

        // ---------- the barn (static level geometry) ----------

        /// <summary>
        /// Barn 40 x 30 (x -20..20, z -15..15), walls 8.5 high + invisible ceiling. South: Bob's door → yard + grill.
        /// North: exit passage (electric fence, exit gate) → meadow with the getaway truck. East: hayloft (3.2 m) + lift.
        /// West: tool shed (rotten boards, fuse box) and a shelf up to the roof beams (5.5 m). South-east: pig pen.
        /// </summary>
        static Transform BuildLevel()
        {
            var floor = Mat("BarnFloor", new Color(0.55f, 0.4f, 0.25f));
            var wall = Mat("BarnWall", new Color(0.65f, 0.18f, 0.15f));
            var wood = Mat("Crate", new Color(0.8f, 0.62f, 0.38f));
            var beam = Mat("Beam", new Color(0.42f, 0.28f, 0.16f));
            var hay = Mat("Hay", new Color(0.93f, 0.8f, 0.35f));
            var grass = Mat("Grass", new Color(0.35f, 0.6f, 0.25f));
            var shed = Mat("ShedWall", new Color(0.5f, 0.42f, 0.32f));
            var lampMat = Mat("Lamp", Color.white);

            var r = new GameObject("Barn").transform;
            r.gameObject.AddComponent<SceneBuildInfo>().builderVersion = BuildVersion;
            // Farmer Bob's NavMesh: baked on the server at game start from these (static) children only.
            var surface = r.gameObject.AddComponent<NavMeshSurface>();
            surface.collectObjects = CollectObjects.Children;
            surface.useGeometry = NavMeshCollectGeometry.PhysicsColliders;
            const float h = 8.5f; // wall height = ceiling

            // Floor, walls, invisible ceiling (nobody flies out over the walls).
            Block("Floor", r, new Vector3(0f, -0.5f, 0f), new Vector3(42f, 1f, 32f), floor);
            Block("WallN1", r, new Vector3(-11.5f, h / 2f, 15.5f), new Vector3(19f, h, 1f), wall);
            Block("WallN2", r, new Vector3(11.5f, h / 2f, 15.5f), new Vector3(19f, h, 1f), wall);
            Block("ExitLintel", r, new Vector3(0f, (4f + h) / 2f, 15.5f), new Vector3(4f, h - 4f, 1f), wall);
            Block("WallS1", r, new Vector3(-11.25f, h / 2f, -15.5f), new Vector3(19.5f, h, 1f), wall);
            Block("WallS2", r, new Vector3(11.25f, h / 2f, -15.5f), new Vector3(19.5f, h, 1f), wall);
            Block("DoorLintel", r, new Vector3(0f, (3.5f + h) / 2f, -15.5f), new Vector3(3f, h - 3.5f, 1f), wall);
            Block("WallE", r, new Vector3(20.5f, h / 2f, 0f), new Vector3(1f, h, 30f), wall);
            Block("WallW", r, new Vector3(-20.5f, h / 2f, 0f), new Vector3(1f, h, 30f), wall);
            var ceiling = Block("Ceiling", r, new Vector3(0f, h + 0.25f, 0f), new Vector3(42f, 0.5f, 32f), wall);
            Object.DestroyImmediate(ceiling.GetComponent<MeshRenderer>());
            Object.DestroyImmediate(ceiling.GetComponent<MeshFilter>());
            ceiling.AddComponent<CameraPassThrough>();

            // Roof beams (5.5 m): the key sits on the north one, far west, between two little rails.
            // Up from the hayloft or the west shelf (3.2 m): Jumpy's ledge grab, Gassy's rocket, a rope, Heavy's trampoline.
            // 1.6 m wide: Jumpy's ledge grab pops it up with some forward speed, and it has to land on it.
            PassThrough(Block("BeamS", r, new Vector3(0f, 5.3f, -2f), new Vector3(40f, 0.4f, 1.6f), beam));
            PassThrough(Block("BeamN", r, new Vector3(0f, 5.3f, 7f), new Vector3(40f, 0.4f, 1.6f), beam));
            PassThrough(Block("CrossBeam", r, new Vector3(-8f, 5.3f, 2.5f), new Vector3(1.2f, 0.4f, 7.6f), beam));
            PassThrough(Block("KeyRail1", r, new Vector3(-12f, 5.65f, 6.25f), new Vector3(1.2f, 0.3f, 0.1f), beam));
            PassThrough(Block("KeyRail2", r, new Vector3(-12f, 5.65f, 7.75f), new Vector3(1.2f, 0.3f, 0.1f), beam));
            // West shelf (3.2 m, like the hayloft) next to the north beam: Jumpy (ledge grab) / Gassy (rocket) / stacked crates.
            Block("Shelf", r, new Vector3(-19.2f, 3.05f, 9.4f), new Vector3(1.6f, 0.3f, 3f), beam);
            Part(PrimitiveType.Cube, "ShelfBracket", r, new Vector3(-19.7f, 2.5f, 8.3f), new Vector3(0.2f, 0.9f, 0.15f), beam, new Vector3(0f, 0f, 30f));
            Part(PrimitiveType.Cube, "ShelfBracket", r, new Vector3(-19.7f, 2.5f, 10.5f), new Vector3(0.2f, 0.9f, 0.15f), beam, new Vector3(0f, 0f, 30f));

            // Hayloft (east, 3.2 m) on posts; the lift (network-spawned) rises at its south-west corner.
            Block("Hayloft", r, new Vector3(16f, 3f, 4.5f), new Vector3(8f, 0.4f, 21f), wood);
            foreach (float z in new[] { -5.75f, -0.5f, 4.5f, 9.5f, 14.5f })
                PassThrough(Block("LoftPost", r, new Vector3(12.25f, 1.4f, z), new Vector3(0.4f, 2.8f, 0.4f), beam));
            Block("LoftBale1", r, new Vector3(19f, 4f, 12.5f), new Vector3(1.6f, 1f, 1.6f), hay, new Vector3(0f, 0f, 90f), PrimitiveType.Cylinder);
            Block("LoftBale2", r, new Vector3(19f, 4f, 6f), new Vector3(1.6f, 1f, 1.6f), hay, new Vector3(0f, 0f, 90f), PrimitiveType.Cylinder);
            Haystack(r, new Vector3(17.5f, 3.2f, -3.5f), hay);
            Label(r, "HAYLOFT", new Vector3(12.2f, 4.2f, 2f), Color.white, 0.06f);
            Label(r, "LIFT", new Vector3(6.5f, 1.8f, -3.3f), Color.white, 0.05f);
            PointLight(r, new Vector3(15.5f, 2.3f, 1.5f), new Color(1f, 0.85f, 0.6f), 9f, 1.5f); // under the loft

            // Tool shed (west): doorway in its east wall is nailed shut with rotten boards (network-spawned).
            Block("ShedE1", r, new Vector3(-13f, 1.75f, -5.25f), new Vector3(0.5f, 3.5f, 3.5f), shed);
            Block("ShedE2", r, new Vector3(-13f, 1.75f, 0.25f), new Vector3(0.5f, 3.5f, 3.5f), shed);
            Block("ShedLintel", r, new Vector3(-13f, 3.25f, -2.5f), new Vector3(0.5f, 0.5f, 2f), shed);
            Block("ShedN", r, new Vector3(-16.625f, 1.75f, 2.25f), new Vector3(7.25f, 3.5f, 0.5f), shed);
            Block("ShedS", r, new Vector3(-16.625f, 1.75f, -7.25f), new Vector3(7.25f, 3.5f, 0.5f), shed);
            Block("ShedRoof", r, new Vector3(-16.5f, 3.65f, -2.5f), new Vector3(7.5f, 0.3f, 10f), shed);
            Label(r, "TOOL SHED", new Vector3(-12.6f, 4.3f, -2.5f), Color.white, 0.06f);
            Label(r, "FUSE BOX", new Vector3(-19.3f, 2.2f, -2.5f), new Color(1f, 0.9f, 0.3f), 0.04f);
            PointLight(r, new Vector3(-16.5f, 3f, -2.5f), new Color(1f, 0.8f, 0.5f), 8f, 1.5f);

            // Exit passage through the north wall: electric fence, then the exit gate (both network-spawned).
            Block("PassageFloor", r, new Vector3(0f, -0.5f, 18f), new Vector3(6f, 1f, 4f), floor);
            Block("PassageW", r, new Vector3(-2.5f, 2.25f, 18f), new Vector3(1f, 4.5f, 4f), wall);
            Block("PassageE", r, new Vector3(2.5f, 2.25f, 18f), new Vector3(1f, 4.5f, 4f), wall);
            Block("PassageRoof", r, new Vector3(0f, 4.25f, 18f), new Vector3(6f, 0.5f, 4f), wall);
            Label(r, "EXIT", new Vector3(0f, 6.4f, 14.7f), new Color(0.5f, 1f, 0.5f), 0.1f);
            string[] lampNames = { "KEY", "FENCE", "POWER", "TARGETS" };
            for (int i = 0; i < lampNames.Length; i++)
            {
                float x = -1.65f + i * 1.1f;
                var lamp = Part(PrimitiveType.Sphere, "ExitLamp", r, new Vector3(x, 5.2f, 14.8f), Vector3.one * 0.45f, lampMat);
                var objectiveLamp = lamp.AddComponent<ObjectiveLamp>();
                objectiveLamp.objective = i;
                objectiveLamp.lamp = lamp.GetComponent<Renderer>();
                Label(r, lampNames[i], new Vector3(x, 4.6f, 14.7f), Color.white, 0.03f);
            }
            Label(r, "PADLOCK", new Vector3(-4.5f, 2.3f, 13.6f), new Color(1f, 0.85f, 0.2f), 0.04f);
            PointLight(r, new Vector3(0f, 3.5f, 12.5f), new Color(0.8f, 1f, 0.8f), 9f, 1.2f);

            // Meadow behind the exit + the getaway truck (goal).
            Block("Meadow", r, new Vector3(0f, -0.5f, 27f), new Vector3(18f, 1f, 14f), grass);
            Block("MeadowFenceW", r, new Vector3(-9.15f, 1.25f, 27f), new Vector3(0.3f, 2.5f, 14f), wood);
            Block("MeadowFenceE", r, new Vector3(9.15f, 1.25f, 27f), new Vector3(0.3f, 2.5f, 14f), wood);
            Block("MeadowFenceN", r, new Vector3(0f, 1.25f, 34.15f), new Vector3(18.6f, 2.5f, 0.3f), wood);
            Block("MeadowFenceSW", r, new Vector3(-6f, 1.25f, 20.15f), new Vector3(6f, 2.5f, 0.3f), wood);
            Block("MeadowFenceSE", r, new Vector3(6f, 1.25f, 20.15f), new Vector3(6f, 2.5f, 0.3f), wood);
            BuildTruck(r);
            foreach (var p in new[] { new Vector3(-12f, 0f, 24f), new Vector3(12f, 0f, 30f), new Vector3(-11f, 0f, 33f), new Vector3(11.5f, 0f, 21f) })
                Tree(r, p);

            // Pig pen (start), south-east: low fence (jump over) with a gap on the north-west.
            Block("PenN", r, new Vector3(13.8f, 0.4f, -8f), new Vector3(6.4f, 0.8f, 0.2f), wood);
            Block("PenW", r, new Vector3(9f, 0.4f, -11f), new Vector3(0.2f, 0.8f, 6f), wood);
            Block("PenE", r, new Vector3(17f, 0.4f, -11f), new Vector3(0.2f, 0.8f, 6f), wood);
            Block("PenS", r, new Vector3(13f, 0.4f, -14f), new Vector3(8.2f, 0.8f, 0.2f), wood);
            Block("Trough", r, new Vector3(11f, 0.25f, -13.4f), new Vector3(2f, 0.5f, 0.6f), beam);
            Part(PrimitiveType.Cube, "Mud", r, new Vector3(14.5f, 0.01f, -12f), new Vector3(3f, 0.02f, 2.2f), Mat("Mud", new Color(0.35f, 0.24f, 0.14f)));

            // Hay to hide in (no colliders - walk in), bales as obstacles.
            Haystack(r, new Vector3(-6f, 0f, 11f), hay);
            Haystack(r, new Vector3(5f, 0f, 12f), hay);
            Haystack(r, new Vector3(-15f, 0f, -11.5f), hay);
            Haystack(r, new Vector3(16f, 0f, 1.5f), hay); // under the hayloft
            Block("HayBale1", r, new Vector3(-17.5f, 0.8f, 13f), new Vector3(1.6f, 1f, 1.6f), hay, new Vector3(0f, 0f, 90f), PrimitiveType.Cylinder);
            Block("HayBale2", r, new Vector3(-15.3f, 0.8f, 13.3f), new Vector3(1.6f, 1f, 1.6f), hay, new Vector3(0f, 30f, 90f), PrimitiveType.Cylinder);
            Block("HayBale3", r, new Vector3(-9f, 0.8f, -12.5f), new Vector3(1.6f, 1f, 1.6f), hay, new Vector3(0f, 70f, 90f), PrimitiveType.Cylinder);

            // Yard behind Bob's barn door: his grill.
            Block("YardFloor", r, new Vector3(0f, -0.5f, -21f), new Vector3(14f, 1f, 12f), grass);
            Block("FenceW", r, new Vector3(-7.15f, 1.25f, -21.5f), new Vector3(0.3f, 2.5f, 11f), wood);
            Block("FenceE", r, new Vector3(7.15f, 1.25f, -21.5f), new Vector3(0.3f, 2.5f, 11f), wood);
            Block("FenceS", r, new Vector3(0f, 1.25f, -27.15f), new Vector3(14.6f, 2.5f, 0.3f), wood);
            Block("Grill", r, new Vector3(0f, 0.45f, -24f), new Vector3(1.8f, 0.9f, 1f), Mat("GrillMetal", new Color(0.18f, 0.18f, 0.2f)));
            Block("GrillCoals", r, new Vector3(0f, 0.93f, -24f), new Vector3(1.6f, 0.06f, 0.8f), Mat("Coals", new Color(1f, 0.35f, 0.1f)));
            Label(r, "BOB'S BBQ", new Vector3(0f, 2.2f, -24f), new Color(1f, 0.5f, 0.3f), 0.06f);
            return r;
        }

        static void BuildTruck(Transform r)
        {
            var paint = Mat("Truck", new Color(0.2f, 0.45f, 0.75f));
            var dark = Mat("Wheel", new Color(0.12f, 0.12f, 0.13f));
            var glass = Mat("TruckWindow", new Color(0.55f, 0.75f, 0.9f));
            var wood = Mat("Crate", new Color(0.8f, 0.62f, 0.38f));
            Block("TruckChassis", r, new Vector3(0f, 0.35f, 28f), new Vector3(3.4f, 0.5f, 7f), dark);
            Block("TruckBed", r, new Vector3(0f, 0.75f, 27f), new Vector3(3.6f, 0.3f, 4f), wood);
            Block("TruckSideW", r, new Vector3(-1.75f, 1.2f, 27f), new Vector3(0.1f, 0.6f, 4f), paint);
            Block("TruckSideE", r, new Vector3(1.75f, 1.2f, 27f), new Vector3(0.1f, 0.6f, 4f), paint);
            Block("TruckBedFront", r, new Vector3(0f, 1.2f, 28.95f), new Vector3(3.6f, 0.6f, 0.1f), paint);
            Block("TruckCab", r, new Vector3(0f, 1.4f, 30.3f), new Vector3(3.6f, 2f, 2.4f), paint);
            Block("TruckHood", r, new Vector3(0f, 0.95f, 32.2f), new Vector3(3.4f, 1.1f, 1.5f), paint);
            Part(PrimitiveType.Cube, "TruckWindowBack", r, new Vector3(0f, 1.9f, 29.08f), new Vector3(2.8f, 0.7f, 0.05f), glass);
            Part(PrimitiveType.Cube, "TruckWindowFront", r, new Vector3(0f, 1.9f, 31.52f), new Vector3(3f, 0.7f, 0.05f), glass);
            foreach (var (x, z) in new[] { (-1.75f, 25.8f), (1.75f, 25.8f), (-1.75f, 31.3f), (1.75f, 31.3f) })
                Part(PrimitiveType.Cylinder, "Wheel", r, new Vector3(x, 0.45f, z), new Vector3(0.9f, 0.15f, 0.9f), dark, new Vector3(0f, 0f, 90f));
            // Tailgate down = ramp into the bed.
            const float rise = 0.9f, run = 2f;
            float angle = Mathf.Atan2(rise, run) * Mathf.Rad2Deg;
            float length = Mathf.Sqrt(rise * rise + run * run);
            Block("TruckRamp", r, new Vector3(0f, rise / 2f - 0.1f, 24f), new Vector3(3.2f, 0.2f, length), wood, new Vector3(-angle, 0f, 0f));

            var zone = new GameObject("EscapeZone");
            zone.transform.SetParent(r, false);
            zone.transform.position = new Vector3(0f, 1.9f, 27f);
            zone.AddComponent<EscapeZone>().size = new Vector3(3.4f, 2f, 3.8f);
            Label(r, "GETAWAY TRUCK - JUMP IN!", new Vector3(0f, 3.4f, 29f), new Color(0.5f, 1f, 0.5f), 0.07f);
        }

        static void Tree(Transform parent, Vector3 position)
        {
            Part(PrimitiveType.Cylinder, "Trunk", parent, position + Vector3.up * 1.5f, new Vector3(0.5f, 1.5f, 0.5f), Mat("Trunk", new Color(0.4f, 0.27f, 0.15f)));
            Part(PrimitiveType.Sphere, "Leaves", parent, position + Vector3.up * 3.6f, new Vector3(3f, 2.6f, 3f), Mat("Leaves", new Color(0.25f, 0.55f, 0.2f)));
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

        static void Label(Transform parent, string text, Vector3 position, Color color, float size)
        {
            var go = new GameObject("Label " + text);
            go.transform.SetParent(parent, false);
            go.transform.position = position;
            var label = go.AddComponent<WorldLabel>();
            label.text = text;
            label.color = color;
            label.characterSize = size;
            label.billboard = true;
        }

        static void PointLight(Transform parent, Vector3 position, Color color, float range, float intensity)
        {
            var go = new GameObject("Light");
            go.transform.SetParent(parent, false);
            go.transform.position = position;
            var light = go.AddComponent<Light>();
            light.type = LightType.Point;
            light.color = color;
            light.range = range;
            light.intensity = intensity;
            light.shadows = LightShadows.None;
        }

        static GameObject PassThrough(GameObject go)
        {
            go.AddComponent<CameraPassThrough>();
            return go;
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

        /// <summary>The padlock key (gold bar + KEY label).</summary>
        static GameObject BuildKeyPrefab()
        {
            EnsureFolder(PropDir);
            var go = Part(PrimitiveType.Cube, "GateKey", null, Vector3.zero, new Vector3(0.5f, 0.2f, 0.25f), Mat("Gold", new Color(1f, 0.8f, 0.1f)), default, keepCollider: true);
            go.AddComponent<Rigidbody>().mass = 1f;
            AddNetworkSync(go);
            go.AddComponent<KeyItem>();
            return SavePrefab(go, $"{PropDir}/GateKey.prefab");
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

        /// <summary>Gate / door / lift that moves by openOffset while its channel is on (see Gate).</summary>
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

        /// <summary>Big wooden exit door: sinks when the padlock, generator and all three bullseyes are done.</summary>
        static GameObject BuildExitGatePrefab()
        {
            EnsureFolder(PropDir);
            var plank = Mat("ExitDoor", new Color(0.5f, 0.3f, 0.16f));
            var dark = Mat("Beam", new Color(0.42f, 0.28f, 0.16f));
            var go = Part(PrimitiveType.Cube, "ExitGate", null, Vector3.zero, new Vector3(4f, 4f, 0.35f), plank, default, keepCollider: true);
            var rb = go.AddComponent<Rigidbody>();
            rb.isKinematic = true;
            rb.mass = 1000f;
            go.AddComponent<NetworkObject>();
            var nt = go.AddComponent<NetworkTransform>();
            nt.SyncScaleX = nt.SyncScaleY = nt.SyncScaleZ = false;
            var gate = go.AddComponent<Gate>();
            gate.requiredChannels = new[] { ChannelIds.Padlock, ChannelIds.Generator, ChannelIds.Target1, ChannelIds.Target2, ChannelIds.Target3 };
            gate.openOffset = new Vector3(0f, -4.05f, 0f);
            gate.speed = 1.2f;
            var obstacle = go.AddComponent<NavMeshObstacle>();
            obstacle.shape = NavMeshObstacleShape.Box;
            obstacle.size = Vector3.one;
            obstacle.carving = true;
            // Z brace (children live in the scaled cube's local space: divide by its size).
            var inv = new Vector3(1f / 4f, 1f / 4f, 1f / 0.35f);
            Part(PrimitiveType.Cube, "Brace", go.transform, Vector3.Scale(new Vector3(0f, 1.4f, -0.2f), inv), Vector3.Scale(new Vector3(3.8f, 0.3f, 0.06f), inv), dark);
            Part(PrimitiveType.Cube, "Brace", go.transform, Vector3.Scale(new Vector3(0f, -1.4f, -0.2f), inv), Vector3.Scale(new Vector3(3.8f, 0.3f, 0.06f), inv), dark);
            return SavePrefab(go, $"{PropDir}/ExitGate.prefab");
        }

        /// <summary>Electric fence filling the exit passage: zaps pigs, sinks when the fuse box is smashed.</summary>
        static GameObject BuildElectricFencePrefab()
        {
            EnsureFolder(PropDir);
            var post = Mat("FencePost", new Color(0.25f, 0.25f, 0.27f));
            var wire = Mat("Wire", new Color(1f, 0.9f, 0.2f));
            var root = new GameObject("ElectricFence");
            root.AddComponent<BoxCollider>().size = new Vector3(4f, 4f, 0.3f);
            var rb = root.AddComponent<Rigidbody>();
            rb.isKinematic = true;
            rb.mass = 1000f;
            root.AddComponent<NetworkObject>();
            var nt = root.AddComponent<NetworkTransform>();
            nt.SyncScaleX = nt.SyncScaleY = nt.SyncScaleZ = false;
            var gate = root.AddComponent<Gate>();
            gate.openOffset = new Vector3(0f, -4.05f, 0f);
            gate.speed = 2f;
            var obstacle = root.AddComponent<NavMeshObstacle>();
            obstacle.shape = NavMeshObstacleShape.Box;
            obstacle.size = new Vector3(4f, 4f, 0.3f);
            obstacle.carving = true;
            Part(PrimitiveType.Cube, "Post", root.transform, new Vector3(-1.9f, 0f, 0f), new Vector3(0.2f, 4f, 0.25f), post);
            Part(PrimitiveType.Cube, "Post", root.transform, new Vector3(1.9f, 0f, 0f), new Vector3(0.2f, 4f, 0.25f), post);
            Part(PrimitiveType.Cube, "Post", root.transform, new Vector3(0f, 0f, 0f), new Vector3(0.15f, 4f, 0.2f), post);
            var wires = new List<Renderer>();
            for (int i = 0; i < 8; i++)
                wires.Add(Part(PrimitiveType.Cube, "Wire", root.transform, new Vector3(0f, -1.75f + i * 0.5f, 0f), new Vector3(3.8f, 0.05f, 0.05f), wire).GetComponent<Renderer>());
            var sign = Part(PrimitiveType.Cube, "DangerSign", root.transform, new Vector3(0f, 0.6f, -0.14f), new Vector3(0.9f, 0.6f, 0.03f), wire);
            sign.transform.localRotation = Quaternion.Euler(0f, 0f, 45f);
            var zapper = root.AddComponent<Zapper>();
            zapper.wires = wires.ToArray();
            return SavePrefab(root, $"{PropDir}/ElectricFence.prefab");
        }

        /// <summary>Fuse box on the shed wall (Breakable with a channel: smashing it powers the fence down).</summary>
        static GameObject BuildFuseBoxPrefab()
        {
            EnsureFolder(PropDir);
            var grey = new Color(0.5f, 0.52f, 0.55f);
            var root = new GameObject("FuseBox");
            root.AddComponent<BoxCollider>().size = new Vector3(1.2f, 1.2f, 0.5f);
            root.AddComponent<NetworkObject>();
            var breakable = root.AddComponent<Breakable>();
            breakable.channel = ChannelIds.Fence; // also on the prefab, so clients know it's the fuse box
            breakable.debrisColor = grey;
            breakable.debrisPieces = 14;
            root.AddComponent<Sparker>().size = new Vector3(1.2f, 1.2f, 0.5f);
            Part(PrimitiveType.Cube, "Box", root.transform, Vector3.zero, new Vector3(1.2f, 1.2f, 0.5f), Mat("FuseBox", grey));
            var yellow = Mat("Wire", new Color(1f, 0.9f, 0.2f));
            Part(PrimitiveType.Cube, "Bolt1", root.transform, new Vector3(0.05f, 0.18f, 0.26f), new Vector3(0.12f, 0.45f, 0.02f), yellow, new Vector3(0f, 0f, -25f));
            Part(PrimitiveType.Cube, "Bolt2", root.transform, new Vector3(-0.05f, -0.18f, 0.26f), new Vector3(0.12f, 0.45f, 0.02f), yellow, new Vector3(0f, 0f, -25f));
            Part(PrimitiveType.Cylinder, "Cable", root.transform, new Vector3(0.4f, 1.3f, 0f), new Vector3(0.08f, 0.8f, 0.08f), Mat("FencePost", new Color(0.25f, 0.25f, 0.27f)));
            return SavePrefab(root, $"{PropDir}/FuseBox.prefab");
        }

        /// <summary>Generator that starts on a Rocket Fart (FartSwitch). Fan faces +Z.</summary>
        static GameObject BuildGeneratorPrefab()
        {
            EnsureFolder(PropDir);
            var green = Mat("Generator", new Color(0.3f, 0.45f, 0.3f));
            var metal = Mat("FencePost", new Color(0.25f, 0.25f, 0.27f));
            var root = new GameObject("Generator");
            var box = root.AddComponent<BoxCollider>();
            box.size = new Vector3(1.6f, 1.2f, 1.1f);
            box.center = new Vector3(0f, 0.6f, 0f);
            root.AddComponent<NetworkObject>();
            var gen = root.AddComponent<FartSwitch>();
            Part(PrimitiveType.Cube, "Body", root.transform, new Vector3(0f, 0.6f, 0f), new Vector3(1.6f, 1f, 1f), green);
            Part(PrimitiveType.Cube, "Base", root.transform, new Vector3(0f, 0.05f, 0f), new Vector3(1.8f, 0.1f, 1.1f), metal);
            Part(PrimitiveType.Cylinder, "FanRing", root.transform, new Vector3(0f, 0.6f, 0.52f), new Vector3(0.85f, 0.03f, 0.85f), metal, new Vector3(90f, 0f, 0f));
            var fan = new GameObject("Fan").transform;
            fan.SetParent(root.transform, false);
            fan.SetLocalPositionAndRotation(new Vector3(0f, 0.6f, 0.56f), Quaternion.Euler(90f, 0f, 0f));
            for (int i = 0; i < 3; i++)
                Part(PrimitiveType.Cube, "Blade", fan, Vector3.zero, new Vector3(0.12f, 0.02f, 0.75f), Mat("Lamp", Color.white), new Vector3(0f, i * 60f, 0f));
            Part(PrimitiveType.Cylinder, "Exhaust", root.transform, new Vector3(0.55f, 1.3f, -0.3f), new Vector3(0.14f, 0.25f, 0.14f), metal);
            var exhaust = new GameObject("ExhaustTip").transform;
            exhaust.SetParent(root.transform, false);
            exhaust.localPosition = new Vector3(0.55f, 1.6f, -0.3f);
            var lamp = Part(PrimitiveType.Sphere, "Lamp", root.transform, new Vector3(-0.55f, 1.15f, 0.4f), Vector3.one * 0.22f, Mat("Lamp", Color.white));
            gen.fan = fan;
            gen.exhaust = exhaust;
            gen.lamp = lamp.GetComponent<Renderer>();
            var label = new GameObject("Label");
            label.transform.SetParent(root.transform, false);
            label.transform.localPosition = new Vector3(0f, 2.1f, 0f);
            var text = label.AddComponent<WorldLabel>();
            text.text = "GENERATOR\n(runs on farts)";
            text.color = new Color(0.7f, 1f, 0.5f);
            text.characterSize = 0.035f;
            text.billboard = true;
            return SavePrefab(root, $"{PropDir}/Generator.prefab");
        }

        /// <summary>Padlock on a post (KeySlot).</summary>
        static GameObject BuildKeySlotPrefab()
        {
            EnsureFolder(PropDir);
            var gold = Mat("Padlock", new Color(0.85f, 0.65f, 0.2f));
            var metal = Mat("FencePost", new Color(0.25f, 0.25f, 0.27f));
            var root = new GameObject("Padlock");
            var box = root.AddComponent<BoxCollider>();
            box.size = new Vector3(0.35f, 1.1f, 0.35f);
            box.center = new Vector3(0f, 0.55f, 0f);
            root.AddComponent<NetworkObject>();
            var slot = root.AddComponent<KeySlot>();
            Part(PrimitiveType.Cylinder, "Post", root.transform, new Vector3(0f, 0.55f, 0f), new Vector3(0.25f, 0.55f, 0.25f), Mat("Beam", new Color(0.42f, 0.28f, 0.16f)));
            Part(PrimitiveType.Cube, "Lock", root.transform, new Vector3(0f, 1.3f, 0f), new Vector3(0.6f, 0.5f, 0.3f), gold);
            var shackle = new GameObject("Shackle").transform;
            shackle.SetParent(root.transform, false);
            shackle.localPosition = new Vector3(0f, 1.62f, 0f);
            Part(PrimitiveType.Cube, "Left", shackle, new Vector3(-0.2f, 0f, 0f), new Vector3(0.08f, 0.3f, 0.08f), metal);
            Part(PrimitiveType.Cube, "Right", shackle, new Vector3(0.2f, 0f, 0f), new Vector3(0.08f, 0.3f, 0.08f), metal);
            Part(PrimitiveType.Cube, "Top", shackle, new Vector3(0f, 0.15f, 0f), new Vector3(0.48f, 0.08f, 0.08f), metal);
            var lamp = Part(PrimitiveType.Sphere, "Lamp", root.transform, new Vector3(0f, 1.3f, 0.16f), Vector3.one * 0.18f, Mat("Lamp", Color.white));
            slot.shackle = shackle;
            slot.lamp = lamp.GetComponent<Renderer>();
            return SavePrefab(root, $"{PropDir}/Padlock.prefab");
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

            var anim = root.AddComponent<ProceduralAnimator>();
            anim.kind = ProceduralAnimator.Kind.Farmer;
            anim.visual = v;
            anim.stepsPerMetre = 1.1f;
            anim.bobHeight = 0.05f;
            anim.fullSpeed = 4.5f;
            anim.limbSwing = 30f;
            anim.stepVolume = 0.9f; // heavy footsteps: the pigs hear him coming
            var bob = root.AddComponent<FarmerBob>();

            var carry = new GameObject("CarryPoint").transform;
            carry.SetParent(root.transform, false);
            carry.localPosition = new Vector3(0.3f, 2.05f, -0.1f);
            bob.carryPoint = carry;
            // Barn layout (see BuildLevel).
            bob.doorPosition = new Vector3(0f, 0f, -15.5f);
            bob.doorOutward = Vector3.back;
            bob.insidePoint = new Vector3(0f, 0f, -12f);
            bob.searchCenter = new Vector3(0f, 0f, 0f);
            bob.searchHalfSize = new Vector2(18f, 13f);
            bob.doorChannel = ChannelIds.BobDoor;
            return SavePrefab(root, $"{PrefabDir}/FarmerBob.prefab");
        }

        /// <summary>Bullseye switch facing +Z (see ShootTarget). Latching: stays on once hit.</summary>
        static GameObject BuildTargetPrefab()
        {
            EnsureFolder(PropDir);
            var root = new GameObject("ShootTarget");
            root.AddComponent<BoxCollider>().size = new Vector3(1f, 1f, 0.2f);
            root.AddComponent<NetworkObject>();
            var target = root.AddComponent<ShootTarget>();
            target.latch = true;
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

        /// <summary>Chicken = Bait for Farmer Bob (grab + throw it at him). Wanders and flees from pigs (Critter).</summary>
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
            var critter = root.AddComponent<Critter>();
            critter.groundCheck = 0.45f;
            var v = new GameObject("Visual").transform;
            v.SetParent(root.transform, false);
            Part(PrimitiveType.Sphere, "Body", v, Vector3.zero, new Vector3(0.5f, 0.45f, 0.6f), white);
            Part(PrimitiveType.Sphere, "Head", v, new Vector3(0f, 0.25f, 0.25f), Vector3.one * 0.28f, white);
            Part(PrimitiveType.Cube, "Comb", v, new Vector3(0f, 0.42f, 0.25f), new Vector3(0.05f, 0.1f, 0.14f), red);
            Part(PrimitiveType.Cube, "Beak", v, new Vector3(0f, 0.24f, 0.42f), new Vector3(0.08f, 0.06f, 0.1f), yellow);
            Part(PrimitiveType.Cube, "Tail", v, new Vector3(0f, 0.15f, -0.3f), new Vector3(0.3f, 0.25f, 0.08f), white, new Vector3(-25f, 0f, 0f));
            Part(PrimitiveType.Cylinder, "LegL", v, new Vector3(-0.08f, -0.25f, 0f), new Vector3(0.04f, 0.08f, 0.04f), yellow);
            Part(PrimitiveType.Cylinder, "LegR", v, new Vector3(0.08f, -0.25f, 0f), new Vector3(0.04f, 0.08f, 0.04f), yellow);
            var anim = root.AddComponent<ProceduralAnimator>();
            anim.kind = ProceduralAnimator.Kind.Critter;
            anim.visual = v;
            anim.stepsPerMetre = 3f;
            anim.bobHeight = 0.05f;
            anim.fullSpeed = 3f;
            return SavePrefab(root, $"{PropDir}/Chicken.prefab");
        }

        /// <summary>Sheep = heavier Bait (harder to throw), wanders slowly and baas.</summary>
        static GameObject BuildSheepPrefab()
        {
            EnsureFolder(PropDir);
            var wool = Mat("Wool", new Color(0.95f, 0.93f, 0.86f));
            var face = Mat("SheepFace", new Color(0.15f, 0.13f, 0.12f));
            var root = new GameObject("Sheep");
            var sphere = root.AddComponent<SphereCollider>();
            sphere.radius = 0.5f;
            root.AddComponent<Rigidbody>().mass = 18f;
            AddNetworkSync(root);
            root.AddComponent<Bait>().displayName = "sheep";
            var critter = root.AddComponent<Critter>();
            critter.walkSpeed = 0.9f;
            critter.fleeSpeed = 2.8f;
            critter.hopSpeed = 0f;
            critter.groundCheck = 0.7f;
            critter.voice = Sound.Baa;
            critter.voiceVolume = 0.7f;
            var v = new GameObject("Visual").transform;
            v.SetParent(root.transform, false);
            Part(PrimitiveType.Sphere, "Wool", v, new Vector3(0f, 0.05f, 0f), new Vector3(0.9f, 0.75f, 1.15f), wool);
            Part(PrimitiveType.Sphere, "Head", v, new Vector3(0f, 0.25f, 0.6f), new Vector3(0.36f, 0.4f, 0.42f), face);
            Part(PrimitiveType.Sphere, "WoolTop", v, new Vector3(0f, 0.45f, 0.55f), Vector3.one * 0.3f, wool);
            Part(PrimitiveType.Cube, "EarL", v, new Vector3(-0.22f, 0.3f, 0.55f), new Vector3(0.18f, 0.06f, 0.1f), face, new Vector3(0f, 0f, -20f));
            Part(PrimitiveType.Cube, "EarR", v, new Vector3(0.22f, 0.3f, 0.55f), new Vector3(0.18f, 0.06f, 0.1f), face, new Vector3(0f, 0f, 20f));
            foreach (var (x, z) in new[] { (-0.22f, 0.3f), (0.22f, 0.3f), (-0.22f, -0.3f), (0.22f, -0.3f) })
                Part(PrimitiveType.Cylinder, "Leg", v, new Vector3(x, -0.35f, z), new Vector3(0.12f, 0.15f, 0.12f), face);
            var anim = root.AddComponent<ProceduralAnimator>();
            anim.kind = ProceduralAnimator.Kind.Critter;
            anim.visual = v;
            anim.stepsPerMetre = 2f;
            anim.bobHeight = 0.04f;
            anim.fullSpeed = 2.5f;
            return SavePrefab(root, $"{PropDir}/Sheep.prefab");
        }

        /// <summary>Big upside-down tub: grab it to wear it and hide from Bob (Wearable).</summary>
        static GameObject BuildBucketPrefab()
        {
            EnsureFolder(PropDir);
            var metal = Mat("Galvanized", new Color(0.62f, 0.68f, 0.72f));
            var band = Mat("FencePost", new Color(0.25f, 0.25f, 0.27f));
            var root = new GameObject("Bucket");
            root.AddComponent<BoxCollider>().size = new Vector3(1.6f, 1f, 1.6f);
            root.AddComponent<Rigidbody>().mass = 4f;
            AddNetworkSync(root);
            root.AddComponent<Wearable>();
            Part(PrimitiveType.Cylinder, "Tub", root.transform, Vector3.zero, new Vector3(1.8f, 0.5f, 1.8f), metal);
            Part(PrimitiveType.Cylinder, "Rim", root.transform, new Vector3(0f, -0.46f, 0f), new Vector3(1.88f, 0.04f, 1.88f), band);
            Part(PrimitiveType.Cylinder, "Band", root.transform, new Vector3(0f, 0.2f, 0f), new Vector3(1.84f, 0.03f, 1.84f), band);
            Part(PrimitiveType.Cube, "Handle", root.transform, new Vector3(0f, 0.56f, 0f), new Vector3(0.9f, 0.08f, 0.08f), band);
            return SavePrefab(root, $"{PropDir}/Bucket.prefab");
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
