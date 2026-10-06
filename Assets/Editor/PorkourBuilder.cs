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
    /// Menu "Porkour/..." - builds the prefabs (pig, player, props - all networked) and the farm scene from code, so no
    /// manual editor setup is needed. Re-running overwrites them. Split in parts: this file = prefabs + spawn points,
    /// .Level = the barn, .Farm = farmyard / Bob's house / truck, .Models = imported characters.
    /// Gameplay geometry is always simple boxes (colliders, NavMesh); the medieval kit / models are visuals on top
    /// (missing art → primitive placeholders).
    /// After every compile the editor checks the scene's SceneBuildInfo stamp and rebuilds by itself when
    /// BuildVersion is newer - so the user never has to remember "Rebuild Barn".
    /// </summary>
    public static partial class PorkourBuilder
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
        const int BuildVersion = 8;
        /// <summary>Farmer Bob is a big man (model height; collider / NavMesh agent follow).</summary>
        const float BobHeight = 2.4f;

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
            var root = new GameObject("Pig");
            var rb = root.AddComponent<Rigidbody>();
            rb.mass = 30f;
            rb.interpolation = RigidbodyInterpolation.Interpolate;
            rb.collisionDetectionMode = CollisionDetectionMode.ContinuousDynamic;
            rb.constraints = RigidbodyConstraints.FreezeRotationX | RigidbodyConstraints.FreezeRotationZ;

            var col = root.AddComponent<CapsuleCollider>();
            col.direction = 2; // lying along Z (pig faces +Z)
            col.radius = 0.45f;
            col.height = 1.35f;
            col.center = Vector3.zero;
            col.sharedMaterial = SlipperyMaterial();

            root.AddComponent<PigController>();
            root.AddComponent<PigGrabber>();
            var look = root.AddComponent<PigLook>();
            AddNetworkSync(root);
            root.AddComponent<PigNet>();

            var v = new GameObject("Visual").transform;
            v.SetParent(root.transform, false);
            // Cube Pets models: pig for everyone (recoloured per type), the big hog for Heavy (PigLook swaps them).
            var feet = new Vector3(0f, -col.radius, 0.05f);
            var pigModel = AnimalVisual("pig", v, 1.15f, feet, 2.5f, 7f, out _);
            if (pigModel != null)
            {
                var hogModel = AnimalVisual("hog", v, 1.3f, feet, 2.2f, 6f, out _);
                if (hogModel != null) hogModel.SetActive(false);
                look.pigModel = pigModel;
                look.hogModel = hogModel;
                look.typeMaterials = PigSkins(pigModel); // each type its own colour
            }
            else look.skin = PrimitivePig(v);

            var anim = root.AddComponent<ProceduralAnimator>();
            anim.kind = ProceduralAnimator.Kind.Pig;
            anim.visual = v;

            return SavePrefab(root, PigPrefabPath);
        }

        /// <summary>The old placeholder pig from primitives (no model imported). Returns the skin renderers.</summary>
        static Renderer[] PrimitivePig(Transform v)
        {
            var pink = Mat("Pig", new Color(1f, 0.62f, 0.68f));
            var darkPink = Mat("PigSnout", new Color(0.9f, 0.42f, 0.5f));
            var black = Mat("Eye", new Color(0.05f, 0.05f, 0.05f));
            var skin = new List<Renderer>
            {
                Part(PrimitiveType.Capsule, "Body", v, new Vector3(0f, 0.05f, 0f), new Vector3(0.85f, 0.65f, 0.7f), pink, new Vector3(90f, 0f, 0f)).GetComponent<Renderer>(),
                Part(PrimitiveType.Sphere, "Head", v, new Vector3(0f, 0.2f, 0.52f), Vector3.one * 0.6f, pink).GetComponent<Renderer>(),
            };
            Part(PrimitiveType.Cylinder, "Snout", v, new Vector3(0f, 0.15f, 0.83f), new Vector3(0.28f, 0.05f, 0.28f), darkPink, new Vector3(90f, 0f, 0f));
            Part(PrimitiveType.Sphere, "EyeL", v, new Vector3(-0.12f, 0.3f, 0.77f), Vector3.one * 0.07f, black);
            Part(PrimitiveType.Sphere, "EyeR", v, new Vector3(0.12f, 0.3f, 0.77f), Vector3.one * 0.07f, black);
            Part(PrimitiveType.Cube, "EarL", v, new Vector3(-0.16f, 0.48f, 0.48f), new Vector3(0.14f, 0.18f, 0.04f), darkPink, new Vector3(0f, 0f, 20f));
            Part(PrimitiveType.Cube, "EarR", v, new Vector3(0.16f, 0.48f, 0.48f), new Vector3(0.14f, 0.18f, 0.04f), darkPink, new Vector3(0f, 0f, -20f));
            Part(PrimitiveType.Sphere, "Tail", v, new Vector3(0f, 0.2f, -0.6f), Vector3.one * 0.12f, darkPink);
            foreach (var (x, z) in new[] { (-0.22f, 0.32f), (0.22f, 0.32f), (-0.22f, -0.32f), (0.22f, -0.32f) })
                skin.Add(Part(PrimitiveType.Cylinder, "Leg", v, new Vector3(x, -0.35f, z), new Vector3(0.16f, 0.1f, 0.16f), pink).GetComponent<Renderer>());
            return skin.ToArray();
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

        /// <summary>Every networked prefab, built once per rebuild and handed to the spawn-point layouts.</summary>
        sealed class PrefabSet
        {
            public GameObject pig, player, round, crate, barrel, key, weakCrate, boards, plate, lift, barnDoor, exitGate, fence,
                fuseBox, generator, padlock, bob, target, bell, chicken, calf, bucket, apple, corn, egg, bolt,
                truckKeys, pie, ignition, chimney, houseDoor, shutter,
                cage, gasBottle, gatePlate, coin, bigCoin, piggyBank, goldenEgg, watch, fuelCan, fuelCap, garageDoor;

            public GameObject[] All => new[]
            {
                pig, player, round, crate, barrel, key, weakCrate, boards, plate, lift, barnDoor, exitGate, fence, fuseBox,
                generator, padlock, bob, target, bell, chicken, calf, bucket, apple, corn, egg, bolt, truckKeys, pie,
                ignition, chimney, houseDoor, shutter, cage, gasBottle, gatePlate, coin, bigCoin, piggyBank, goldenEgg, watch,
                fuelCan, fuelCap, garageDoor,
            };
        }

        public static bool BuildBarn()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return false;
            Kit.Reset();
            animalYaw = null;
            treeModels = null;
            NoGrass.Clear();
            furnitureModels.Clear();
            grassTexture = null;
            ArtSetup.PrepareImports(); // Bob / animal import settings (first time only)

            var p = new PrefabSet { pig = BuildPigPrefab(), player = BuildPlayerPrefab() };
            if (p.pig == null || p.player == null) return false;
            p.round = BuildRoundPrefab();

            var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
            var cam = Camera.main;
            cam.gameObject.AddComponent<ThirdPersonCamera>();
            cam.transform.SetPositionAndRotation(new Vector3(13f, 4f, -18f), Quaternion.Euler(15f, 0f, 0f));
            var sun = GameObject.Find("Directional Light");
            if (sun != null) sun.transform.rotation = Quaternion.Euler(58f, -35f, 0f);

            var level = BuildLevel();   // ground, barn, Bob's yard (PorkourBuilder.Level)
            BuildFarmyard(level);       // farmyard, Bob's house, truck (PorkourBuilder.Farm)
            ScatterNature(level);       // bushes / rocks / flowers if a nature pack was added (PorkourBuilder.Nature)
            AddGrassField(level);       // grass tufts + wild flowers (made at runtime)
            SetupLook(cam, sun != null ? sun.GetComponent<Light>() : null); // sky, fog, ambient, post-processing

            var wood = Mat("Crate", new Color(0.8f, 0.62f, 0.38f));
            p.crate = BuildPropPrefab("Crate", PrimitiveType.Cube, Vector3.one, wood, 8f, "Prop_Crate");
            p.barrel = BuildPropPrefab("Barrel", PrimitiveType.Cylinder, new Vector3(0.8f, 0.6f, 0.8f), wood, 15f);
            p.key = BuildKeyPrefab();
            p.weakCrate = BuildBreakableCratePrefab();
            p.boards = BuildRottenBoardsPrefab();
            p.plate = BuildPressurePlatePrefab();
            p.lift = BuildGatePrefab("Lift", new Vector3(2.4f, 0.2f, 2.4f), new Vector3(0f, 3.1f, 0f), 1.5f, carve: false,
                Mat("LiftDeck", new Color(0.85f, 0.7f, 0.25f)));
            p.barnDoor = BuildGatePrefab("BarnDoor", new Vector3(4f, 3.1f, 0.3f), new Vector3(0f, -3.15f, 0f), 5f, carve: false,
                Mat("BarnDoor", new Color(0.45f, 0.2f, 0.12f)));
            p.houseDoor = BuildGatePrefab("HouseDoor", new Vector3(1.4f, 2.45f, 0.15f), new Vector3(1.45f, 0f, 0f), 3f, carve: true,
                Mat("HouseDoor", new Color(0.4f, 0.24f, 0.13f)), rumble: false);
            p.shutter = BuildGatePrefab("WindowShutter", new Vector3(1.45f, 1.8f, 0.1f), new Vector3(0f, 0f, 1.5f), 2.5f, carve: false,
                Mat("Shutter", new Color(0.3f, 0.45f, 0.3f)), rumble: false);
            p.exitGate = BuildExitGatePrefab();
            p.fence = BuildElectricFencePrefab();
            p.fuseBox = BuildFuseBoxPrefab();
            p.generator = BuildGeneratorPrefab();
            p.padlock = BuildKeySlotPrefab();
            p.bob = BuildBobPrefab();
            p.target = BuildTargetPrefab();
            p.bell = BuildBellPrefab();
            p.chicken = BuildChickenPrefab();
            p.calf = BuildCalfPrefab();
            p.bucket = BuildBucketPrefab();
            p.apple = BuildAmmoPrefab("Apple", Ammo.Kind.Apple, PrimitiveType.Sphere, Vector3.one * 0.28f, new Color(0.85f, 0.12f, 0.1f));
            p.corn = BuildAmmoPrefab("Corn", Ammo.Kind.Corn, PrimitiveType.Capsule, new Vector3(0.16f, 0.2f, 0.16f), new Color(1f, 0.85f, 0.2f));
            p.egg = BuildAmmoPrefab("Egg", Ammo.Kind.Egg, PrimitiveType.Sphere, new Vector3(0.2f, 0.26f, 0.2f), new Color(0.98f, 0.95f, 0.85f),
                breaks: true, debris: new Color(1f, 0.85f, 0.3f));
            p.bolt = BuildAmmoPrefab("Bolt", Ammo.Kind.Bolt, PrimitiveType.Cylinder, new Vector3(0.12f, 0.1f, 0.12f), new Color(0.55f, 0.57f, 0.6f));
            p.truckKeys = BuildTruckKeysPrefab();
            p.pie = BuildPiePrefab();
            p.ignition = BuildIgnitionPrefab();
            p.chimney = BuildChimneyPrefab();
            p.cage = BuildCagePrefab(GrillPos - CagePos);
            p.gasBottle = BuildGasBottlePrefab();
            p.gatePlate = BuildPressurePlatePrefab("GatePlate", 20f); // the garage's two plates (both at once)
            p.coin = BuildCoinPrefab("Coin", 5, 0.45f);
            p.bigCoin = BuildCoinPrefab("BigCoin", 15, 0.7f);
            p.fuelCan = BuildFuelCanPrefab();
            p.fuelCap = BuildFuelCapPrefab();
            p.garageDoor = BuildGatePrefab("GarageDoor", new Vector3(0.3f, 3.1f, 4f), new Vector3(0f, -3.15f, 0f), 3f, carve: true,
                Mat("BarnDoor", new Color(0.45f, 0.2f, 0.12f)));
            p.piggyBank = BuildPiggyBankPrefab();
            p.goldenEgg = BuildGoldenEggPrefab();
            p.watch = BuildWatchPrefab();

            // Networked things are spawned by the server when a round starts, at these points.
            var spawnRoot = new GameObject("SpawnPoints").transform;
            var points = new List<NetSpawnPoint>();
            BarnSpawnPoints(spawnRoot, points, p);
            FarmSpawnPoints(spawnRoot, points, p);

            var netGo = new GameObject("NetworkManager");
            var nm = netGo.AddComponent<NetworkManager>();
            var transport = netGo.AddComponent<UnityTransport>();
            if (nm.NetworkConfig == null) nm.NetworkConfig = new NetworkConfig();
            nm.NetworkConfig.NetworkTransport = transport;
            nm.NetworkConfig.EnableSceneManagement = false; // everyone loads the same scene; all networked objects are spawned at runtime
            nm.NetworkConfig.Prefabs.NetworkPrefabsLists = new List<NetworkPrefabsList> { BuildNetworkPrefabsList(p.All) };
            var game = netGo.AddComponent<NetworkGame>();
            game.playerPrefab = p.player;
            game.roundPrefab = p.round;
            game.spawnPoints = points.ToArray();
            game.navMesh = level.GetComponent<NavMeshSurface>();

            EnsureFolder("Assets/Scenes");
            EditorSceneManager.SaveScene(scene, ScenePath);
            var scenes = new List<EditorBuildSettingsScene>(EditorBuildSettings.scenes);
            scenes.RemoveAll(s => s.path == ScenePath || s.path == OldScenePath);
            scenes.Insert(0, new EditorBuildSettingsScene(ScenePath, true));
            EditorBuildSettings.scenes = scenes.ToArray();
            // Leftovers from older builds.
            foreach (var old in new[] { OldScenePath, PropDir + "/Gate.prefab", PropDir + "/Key.prefab", PropDir + "/Sheep.prefab", PropDir + "/FarmGate.prefab" })
                if (File.Exists(old)) AssetDatabase.DeleteAsset(old);
            AssetDatabase.SaveAssets();
            Debug.Log("Porkour: Farm built. Press Play!");
            return true;
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

        static GameObject BuildPropPrefab(string name, PrimitiveType type, Vector3 scale, Material mat, float mass, string kitLook = null)
        {
            EnsureFolder(PropDir);
            var go = Part(type, name, null, Vector3.zero, scale, mat, default, keepCollider: true);
            go.AddComponent<Rigidbody>().mass = mass;
            // Kit model as the look (only for unscaled props: the root is built at the origin with scale 1).
            if (kitLook != null && scale == Vector3.one && Kit.Fit(kitLook, go.transform, Vector3.zero, scale, 0f) is GameObject look)
            {
                foreach (var t in look.GetComponentsInChildren<Transform>()) GameObjectUtility.SetStaticEditorFlags(t.gameObject, 0); // it moves
                Object.DestroyImmediate(go.GetComponent<MeshRenderer>()); // the kit model is the look; the box stays the collider
            }
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
        static GameObject BuildPressurePlatePrefab(string name = "PressurePlate", float requiredMass = 40f, string label = null)
        {
            EnsureFolder(PropDir);
            var root = new GameObject(name);
            var box = root.AddComponent<BoxCollider>();
            box.size = new Vector3(2f, 0.1f, 2f);
            box.center = new Vector3(0f, 0.05f, 0f);
            root.AddComponent<NetworkObject>();
            var plate = root.AddComponent<PressurePlate>();
            Part(PrimitiveType.Cube, "Frame", root.transform, new Vector3(0f, 0.04f, 0f), new Vector3(2.2f, 0.08f, 2.2f), Mat("PlateFrame", new Color(0.3f, 0.3f, 0.32f)));
            var top = Part(PrimitiveType.Cube, "Top", root.transform, new Vector3(0f, 0.08f, 0f), new Vector3(1.8f, 0.06f, 1.8f), Mat("PlateTop", Color.white));
            plate.top = top.GetComponent<Renderer>();
            plate.requiredMass = requiredMass;
            if (label != null)
            {
                var go = new GameObject("Label");
                go.transform.SetParent(root.transform, false);
                go.transform.localPosition = new Vector3(0f, 2.3f, 0f); // above the plate's own weight label
                var text = go.AddComponent<WorldLabel>();
                text.text = label;
                text.color = new Color(1f, 0.85f, 0.4f);
                text.characterSize = 0.035f;
                text.billboard = true;
            }
            return SavePrefab(root, $"{PropDir}/{name}.prefab");
        }

        /// <summary>Gate / door / lift that moves by openOffset while its channel is on (see Gate).</summary>
        static GameObject BuildGatePrefab(string name, Vector3 size, Vector3 openOffset, float speed, bool carve, Material mat,
            bool rumble = true)
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
            gate.rumble = rumble;
            if (carve) // Bob paths around it while it's closed
            {
                var obstacle = go.AddComponent<NavMeshObstacle>();
                obstacle.shape = NavMeshObstacleShape.Box;
                obstacle.size = Vector3.one; // local space of the scaled cube
                obstacle.carving = true;
            }
            return SavePrefab(go, $"{PropDir}/{name}.prefab");
        }

        /// <summary>Big wooden exit door (4 x 3.1, one kit story): sinks when the padlock, generator and all three bullseyes are done.</summary>
        static GameObject BuildExitGatePrefab()
        {
            EnsureFolder(PropDir);
            var plank = Mat("ExitDoor", new Color(0.5f, 0.3f, 0.16f));
            var dark = Mat("Beam", new Color(0.42f, 0.28f, 0.16f));
            var go = Part(PrimitiveType.Cube, "ExitGate", null, Vector3.zero, new Vector3(4f, 3.1f, 0.35f), plank, default, keepCollider: true);
            var rb = go.AddComponent<Rigidbody>();
            rb.isKinematic = true;
            rb.mass = 1000f;
            go.AddComponent<NetworkObject>();
            var nt = go.AddComponent<NetworkTransform>();
            nt.SyncScaleX = nt.SyncScaleY = nt.SyncScaleZ = false;
            var gate = go.AddComponent<Gate>();
            gate.requiredChannels = new[] { ChannelIds.Padlock, ChannelIds.Generator, ChannelIds.Target1, ChannelIds.Target2, ChannelIds.Target3 };
            gate.openOffset = new Vector3(0f, -3.15f, 0f);
            gate.speed = 1.2f;
            var obstacle = go.AddComponent<NavMeshObstacle>();
            obstacle.shape = NavMeshObstacleShape.Box;
            obstacle.size = Vector3.one;
            obstacle.carving = true;
            // Z brace (children live in the scaled cube's local space: divide by its size).
            var inv = new Vector3(1f / 4f, 1f / 3.1f, 1f / 0.35f);
            Part(PrimitiveType.Cube, "Brace", go.transform, Vector3.Scale(new Vector3(0f, 1.05f, -0.2f), inv), Vector3.Scale(new Vector3(3.8f, 0.3f, 0.06f), inv), dark);
            Part(PrimitiveType.Cube, "Brace", go.transform, Vector3.Scale(new Vector3(0f, -1.05f, -0.2f), inv), Vector3.Scale(new Vector3(3.8f, 0.3f, 0.06f), inv), dark);
            return SavePrefab(go, $"{PropDir}/ExitGate.prefab");
        }

        /// <summary>Electric fence filling the exit passage: zaps pigs, sinks when the fuse box is smashed.</summary>
        static GameObject BuildElectricFencePrefab()
        {
            EnsureFolder(PropDir);
            var post = Mat("FencePost", new Color(0.25f, 0.25f, 0.27f));
            var wire = Mat("Wire", new Color(1f, 0.9f, 0.2f));
            var root = new GameObject("ElectricFence");
            root.AddComponent<BoxCollider>().size = new Vector3(4f, 3.1f, 0.3f);
            var rb = root.AddComponent<Rigidbody>();
            rb.isKinematic = true;
            rb.mass = 1000f;
            root.AddComponent<NetworkObject>();
            var nt = root.AddComponent<NetworkTransform>();
            nt.SyncScaleX = nt.SyncScaleY = nt.SyncScaleZ = false;
            var gate = root.AddComponent<Gate>();
            gate.openOffset = new Vector3(0f, -3.15f, 0f);
            gate.speed = 2f;
            var obstacle = root.AddComponent<NavMeshObstacle>();
            obstacle.shape = NavMeshObstacleShape.Box;
            obstacle.size = new Vector3(4f, 3.1f, 0.3f);
            obstacle.carving = true;
            Part(PrimitiveType.Cube, "Post", root.transform, new Vector3(-1.9f, 0f, 0f), new Vector3(0.2f, 3.1f, 0.25f), post);
            Part(PrimitiveType.Cube, "Post", root.transform, new Vector3(1.9f, 0f, 0f), new Vector3(0.2f, 3.1f, 0.25f), post);
            Part(PrimitiveType.Cube, "Post", root.transform, new Vector3(0f, 0f, 0f), new Vector3(0.15f, 3.1f, 0.2f), post);
            var wires = new List<Renderer>();
            for (int i = 0; i < 6; i++)
                wires.Add(Part(PrimitiveType.Cube, "Wire", root.transform, new Vector3(0f, -1.3f + i * 0.5f, 0f), new Vector3(3.8f, 0.05f, 0.05f), wire).GetComponent<Renderer>());
            var sign = Part(PrimitiveType.Cube, "DangerSign", root.transform, new Vector3(0f, 0.3f, -0.14f), new Vector3(0.9f, 0.6f, 0.03f), wire);
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

        /// <summary>Farmer Bob (Mixamo model, or a primitive farmer): kinematic body + NavMeshAgent (server) + FarmerBob.</summary>
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
            col.height = BobHeight - 0.1f;
            col.radius = 0.45f;
            col.center = new Vector3(0f, (BobHeight - 0.1f) / 2f, 0f);
            var rb = root.AddComponent<Rigidbody>();
            rb.isKinematic = true;
            rb.mass = 100f; // never grabbable
            var agent = root.AddComponent<NavMeshAgent>();
            agent.radius = 0.5f;
            agent.height = BobHeight - 0.1f;
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
            bool model = BobVisual(v, BobHeight) != null; // Mixamo Bob + his animations, else the primitive farmer
            if (!model)
            {
                v.localScale = Vector3.one * (BobHeight / 2.2f); // the primitive farmer is 2.2 m with his hat
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
            }

            var anim = root.AddComponent<ProceduralAnimator>();
            anim.kind = ProceduralAnimator.Kind.Farmer;
            anim.visual = v;
            anim.stepsPerMetre = 0.6f; // big slow strides (footstep sounds)
            anim.bobHeight = 0.05f;
            anim.fullSpeed = 4.5f;
            anim.limbSwing = 30f;
            anim.stepVolume = 0.9f; // heavy footsteps: the pigs hear him coming
            var bob = root.AddComponent<FarmerBob>();

            var carry = new GameObject("CarryPoint").transform;
            carry.SetParent(root.transform, false);
            carry.localPosition = new Vector3(0.3f, BobHeight + 0.15f, -0.1f);
            bob.carryPoint = carry;
            // Barn layout (see BuildLevel).
            bob.doorPosition = new Vector3(0f, 0f, -15.5f);
            bob.doorOutward = Vector3.back;
            bob.insidePoint = new Vector3(0f, 0f, -12f);
            bob.searchCenter = new Vector3(0f, 0f, 0f);
            bob.searchHalfSize = new Vector2(18f, 13f);
            // Farmyard (see BuildFarmyard): only reachable for him once the barn exit is open.
            bob.searchCenter2 = new Vector3(0f, 0f, 42f);
            bob.searchHalfSize2 = new Vector2(60f, 56f);
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
            if (AnimalVisual("chick", v, 0.75f, new Vector3(0f, -0.25f, 0f), critter.walkSpeed, critter.fleeSpeed, out _) == null)
            {
                Part(PrimitiveType.Sphere, "Body", v, Vector3.zero, new Vector3(0.5f, 0.45f, 0.6f), white);
                Part(PrimitiveType.Sphere, "Head", v, new Vector3(0f, 0.25f, 0.25f), Vector3.one * 0.28f, white);
                Part(PrimitiveType.Cube, "Comb", v, new Vector3(0f, 0.42f, 0.25f), new Vector3(0.05f, 0.1f, 0.14f), red);
                Part(PrimitiveType.Cube, "Beak", v, new Vector3(0f, 0.24f, 0.42f), new Vector3(0.08f, 0.06f, 0.1f), yellow);
                Part(PrimitiveType.Cube, "Tail", v, new Vector3(0f, 0.15f, -0.3f), new Vector3(0.3f, 0.25f, 0.08f), white, new Vector3(-25f, 0f, 0f));
                Part(PrimitiveType.Cylinder, "LegL", v, new Vector3(-0.08f, -0.25f, 0f), new Vector3(0.04f, 0.08f, 0.04f), yellow);
                Part(PrimitiveType.Cylinder, "LegR", v, new Vector3(0.08f, -0.25f, 0f), new Vector3(0.04f, 0.08f, 0.04f), yellow);
            }
            var anim = root.AddComponent<ProceduralAnimator>();
            anim.kind = ProceduralAnimator.Kind.Critter;
            anim.visual = v;
            anim.stepsPerMetre = 3f;
            anim.bobHeight = 0.05f;
            anim.fullSpeed = 3f;
            return SavePrefab(root, $"{PropDir}/Chicken.prefab");
        }

        /// <summary>Calf = heavier Bait (harder to throw), wanders slowly. Kenney cow model, or a primitive one.</summary>
        static GameObject BuildCalfPrefab()
        {
            EnsureFolder(PropDir);
            var hide = Mat("CalfHide", new Color(0.95f, 0.93f, 0.88f));
            var spots = Mat("CalfSpots", new Color(0.2f, 0.16f, 0.14f));
            var root = new GameObject("Calf");
            var sphere = root.AddComponent<SphereCollider>();
            sphere.radius = 0.5f;
            root.AddComponent<Rigidbody>().mass = 18f;
            AddNetworkSync(root);
            root.AddComponent<Bait>().displayName = "calf";
            var critter = root.AddComponent<Critter>();
            critter.walkSpeed = 0.9f;
            critter.fleeSpeed = 2.8f;
            critter.hopSpeed = 0f;
            critter.groundCheck = 0.7f;
            critter.voice = Sound.Moo;
            critter.voiceVolume = 0.7f;
            var v = new GameObject("Visual").transform;
            v.SetParent(root.transform, false);
            if (AnimalVisual("cow", v, 1.15f, new Vector3(0f, -0.5f, 0f), critter.walkSpeed, critter.fleeSpeed, out _) == null)
            {
                Part(PrimitiveType.Sphere, "Body", v, new Vector3(0f, 0.05f, 0f), new Vector3(0.8f, 0.7f, 1.1f), hide);
                Part(PrimitiveType.Sphere, "Spot", v, new Vector3(0.25f, 0.2f, -0.1f), new Vector3(0.4f, 0.35f, 0.5f), spots);
                Part(PrimitiveType.Sphere, "Head", v, new Vector3(0f, 0.3f, 0.6f), new Vector3(0.42f, 0.42f, 0.48f), hide);
                Part(PrimitiveType.Cube, "EarL", v, new Vector3(-0.25f, 0.4f, 0.55f), new Vector3(0.2f, 0.06f, 0.1f), spots, new Vector3(0f, 0f, -20f));
                Part(PrimitiveType.Cube, "EarR", v, new Vector3(0.25f, 0.4f, 0.55f), new Vector3(0.2f, 0.06f, 0.1f), spots, new Vector3(0f, 0f, 20f));
                foreach (var (x, z) in new[] { (-0.22f, 0.3f), (0.22f, 0.3f), (-0.22f, -0.3f), (0.22f, -0.3f) })
                    Part(PrimitiveType.Cylinder, "Leg", v, new Vector3(x, -0.35f, z), new Vector3(0.12f, 0.15f, 0.12f), hide);
            }
            var anim = root.AddComponent<ProceduralAnimator>();
            anim.kind = ProceduralAnimator.Kind.Critter;
            anim.visual = v;
            anim.stepsPerMetre = 2f;
            anim.bobHeight = 0.04f;
            anim.fullSpeed = 2.5f;
            return SavePrefab(root, $"{PropDir}/Calf.prefab");
        }

        // ---------- the farmhouse puzzle ----------

        /// <summary>Bob's truck keys (KeyItem "truck"): bring them to the truck's ignition.</summary>
        static GameObject BuildTruckKeysPrefab()
        {
            EnsureFolder(PropDir);
            var gold = Mat("Gold", new Color(1f, 0.8f, 0.1f));
            var metal = Mat("FencePost", new Color(0.25f, 0.25f, 0.27f));
            var root = new GameObject("TruckKeys");
            root.AddComponent<BoxCollider>().size = new Vector3(0.55f, 0.15f, 0.35f);
            root.AddComponent<Rigidbody>().mass = 1f;
            AddNetworkSync(root);
            var key = root.AddComponent<KeyItem>();
            key.keyId = "truck";
            key.labelText = "TRUCK KEYS";
            key.labelColor = new Color(0.5f, 0.9f, 1f);
            Part(PrimitiveType.Cylinder, "Ring", root.transform, Vector3.zero, new Vector3(0.3f, 0.02f, 0.3f), metal);
            Part(PrimitiveType.Cube, "Key1", root.transform, new Vector3(0.2f, 0f, 0.05f), new Vector3(0.3f, 0.06f, 0.1f), gold, new Vector3(0f, 20f, 0f));
            Part(PrimitiveType.Cube, "Key2", root.transform, new Vector3(-0.18f, 0f, 0.08f), new Vector3(0.28f, 0.06f, 0.1f), gold, new Vector3(0f, -30f, 0f));
            Part(PrimitiveType.Cube, "Tag", root.transform, new Vector3(0f, 0f, -0.15f), new Vector3(0.14f, 0.05f, 0.12f), Mat("TargetRed", new Color(0.85f, 0.15f, 0.12f)));
            return SavePrefab(root, $"{PropDir}/TruckKeys.prefab");
        }

        /// <summary>Bob's pie (bonus KeyItem, no lock): a star if it rides away in the truck.</summary>
        static GameObject BuildPiePrefab()
        {
            EnsureFolder(PropDir);
            var root = new GameObject("Pie");
            var box = root.AddComponent<BoxCollider>();
            box.size = new Vector3(0.6f, 0.18f, 0.6f);
            root.AddComponent<Rigidbody>().mass = 2f;
            AddNetworkSync(root);
            var pie = root.AddComponent<KeyItem>();
            pie.keyId = "";
            pie.bonus = true;
            pie.labelText = "PIE (bonus star)";
            pie.labelColor = new Color(1f, 0.7f, 0.4f);
            Part(PrimitiveType.Cylinder, "Tin", root.transform, new Vector3(0f, -0.04f, 0f), new Vector3(0.6f, 0.05f, 0.6f), Mat("FencePost", new Color(0.25f, 0.25f, 0.27f)));
            Part(PrimitiveType.Cylinder, "Crust", root.transform, new Vector3(0f, 0.02f, 0f), new Vector3(0.56f, 0.06f, 0.56f), Mat("PieCrust", new Color(0.85f, 0.6f, 0.3f)));
            Part(PrimitiveType.Sphere, "Top", root.transform, new Vector3(0f, 0.07f, 0f), new Vector3(0.5f, 0.08f, 0.5f), Mat("PieTop", new Color(0.75f, 0.45f, 0.2f)));
            return SavePrefab(root, $"{PropDir}/Pie.prefab");
        }

        /// <summary>
        /// The truck's ignition (KeySlot "truck" on a post by the cab door) + IgnitionFx: exhaust and headlights placed
        /// around the truck relative to this post (see BuildTruck / FarmSpawnPoints).
        /// </summary>
        static GameObject BuildIgnitionPrefab()
        {
            EnsureFolder(PropDir);
            var metal = Mat("FencePost", new Color(0.25f, 0.25f, 0.27f));
            var root = new GameObject("Ignition");
            var box = root.AddComponent<BoxCollider>();
            box.size = new Vector3(0.35f, 1.1f, 0.35f);
            box.center = new Vector3(0f, 0.55f, 0f);
            root.AddComponent<NetworkObject>();
            var slot = root.AddComponent<KeySlot>();
            slot.acceptsKey = "truck";
            slot.channel = ChannelIds.Truck;
            slot.radius = 1.4f;
            Part(PrimitiveType.Cylinder, "Post", root.transform, new Vector3(0f, 0.55f, 0f), new Vector3(0.25f, 0.55f, 0.25f), Mat("Beam", new Color(0.42f, 0.28f, 0.16f)));
            Part(PrimitiveType.Cube, "Box", root.transform, new Vector3(0f, 1.3f, 0f), new Vector3(0.6f, 0.5f, 0.35f), metal);
            var shackle = new GameObject("Key").transform; // pops up = keys turned
            shackle.SetParent(root.transform, false);
            shackle.localPosition = new Vector3(0f, 1.5f, 0f);
            Part(PrimitiveType.Cube, "Blade", shackle, Vector3.zero, new Vector3(0.06f, 0.25f, 0.04f), Mat("Gold", new Color(1f, 0.8f, 0.1f)));
            var lamp = Part(PrimitiveType.Sphere, "Lamp", root.transform, new Vector3(0f, 1.3f, 0.18f), Vector3.one * 0.18f, Mat("Lamp", Color.white));
            slot.shackle = shackle;
            slot.lamp = lamp.GetComponent<Renderer>();

            var fx = root.AddComponent<IgnitionFx>();
            var exhaust = new GameObject("Exhaust").transform;
            exhaust.SetParent(root.transform, false);
            exhaust.localPosition = TruckExhaust - IgnitionOffset;
            var lights = new List<Light>();
            foreach (float side in new[] { -1f, 1f })
            {
                var go = new GameObject("Headlight");
                go.transform.SetParent(root.transform, false);
                go.transform.localPosition = new Vector3(side * 1.25f, 0.95f, 6f) - IgnitionOffset;
                var light = go.AddComponent<Light>();
                light.type = LightType.Spot;
                light.range = 16f;
                light.spotAngle = 60f;
                light.intensity = 4f;
                light.color = new Color(1f, 0.95f, 0.75f);
                light.shadows = LightShadows.None;
                light.enabled = false;
                lights.Add(light);
            }
            fx.exhaust = exhaust;
            fx.headlights = lights.ToArray();
            var label = new GameObject("Label");
            label.transform.SetParent(root.transform, false);
            label.transform.localPosition = new Vector3(0f, 2.2f, 0f);
            var text = label.AddComponent<WorldLabel>();
            text.text = "IGNITION\n(bring the TRUCK KEYS)";
            text.color = new Color(0.5f, 0.9f, 1f);
            text.characterSize = 0.035f;
            text.billboard = true;
            return SavePrefab(root, $"{PropDir}/Ignition.prefab");
        }

        /// <summary>Bob's chimney top: a pig that gets up there slides down into the house (ChimneyChute; geometry is static).</summary>
        static GameObject BuildChimneyPrefab()
        {
            EnsureFolder(PropDir);
            var root = new GameObject("ChimneyChute");
            root.AddComponent<NetworkObject>();
            var chute = root.AddComponent<ChimneyChute>();
            chute.radius = 0.9f;
            chute.height = 1.6f;
            chute.exitOffset = ChimneyExit - ChimneyTop;
            chute.exitYaw = 90f;
            return SavePrefab(root, $"{PropDir}/ChimneyChute.prefab");
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
