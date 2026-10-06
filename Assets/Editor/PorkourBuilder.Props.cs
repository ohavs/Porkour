using Unity.Netcode;
using UnityEditor;
using UnityEngine;
using UnityEngine.AI;

namespace Porkour.EditorTools
{
    /// <summary>Networked props added with the BBQ cage, the farm gate, coins and loot (v6).</summary>
    public static partial class PorkourBuilder
    {
        /// <summary>
        /// Bob's cage (PigCage): 4 wide x 2.4 high x 3.6 deep, door on its +Z side (rescuers stand in front of it); caged pigs walk around inside.
        /// Colliders on the root (so hard hits reach PigCage.OnCollisionEnter); kit metal fence panels as bars.
        /// </summary>
        static GameObject BuildCagePrefab(Vector3 grillLocal)
        {
            EnsureFolder(PropDir);
            var metal = Mat("CageMetal", new Color(0.3f, 0.3f, 0.33f));
            const float w = 4f, d = 3.6f, h = 2.4f, t = 0.1f; // room to walk around inside
            var root = new GameObject("PigCage");
            void Box(Vector3 center, Vector3 size)
            {
                var box = root.AddComponent<BoxCollider>();
                box.center = center;
                box.size = size;
            }
            Box(new Vector3(-w / 2f, h / 2f, 0f), new Vector3(t, h, d));
            Box(new Vector3(w / 2f, h / 2f, 0f), new Vector3(t, h, d));
            Box(new Vector3(0f, h / 2f, -d / 2f), new Vector3(w, h, t));
            Box(new Vector3(0f, h / 2f, d / 2f), new Vector3(w, h, t)); // the door
            Box(new Vector3(0f, h + t / 2f, 0f), new Vector3(w, t, d));
            root.AddComponent<NetworkObject>();
            var cage = root.AddComponent<PigCage>();
            cage.slots = new[] { new Vector3(-1f, 0.5f, 0.8f), new Vector3(1f, 0.5f, 0.8f), new Vector3(-1f, 0.5f, -0.8f), new Vector3(1f, 0.5f, -0.8f) };
            cage.inside = new Vector3(w, h, d);
            cage.door = new Vector3(0f, 0f, d / 2f + 0.7f);
            cage.grill = grillLocal;
            var obstacle = root.AddComponent<NavMeshObstacle>();
            obstacle.shape = NavMeshObstacleShape.Box;
            obstacle.center = new Vector3(0f, h / 2f, 0f);
            obstacle.size = new Vector3(w, h, d);
            obstacle.carving = true;

            var look = new GameObject("Look").transform;
            look.SetParent(root.transform, false);
            var sides = new (Vector3 center, Vector3 size, float yaw)[]
            {
                (new Vector3(0f, h / 2f, d / 2f), new Vector3(w, h, 0.12f), 0f), (new Vector3(0f, h / 2f, -d / 2f), new Vector3(w, h, 0.12f), 0f),
                (new Vector3(-w / 2f, h / 2f, 0f), new Vector3(0.12f, h, d), 90f), (new Vector3(w / 2f, h / 2f, 0f), new Vector3(0.12f, h, d), 90f),
            };
            foreach (var (center, size, yaw) in sides)
            {
                if (Kit.Fit("Prop_MetalFence_Simple", look, center, size, yaw) != null) continue;
                bool alongX = size.x > size.z;
                float length = alongX ? size.x : size.z;
                for (float u = -length / 2f + 0.2f; u < length / 2f; u += 0.3f) // bars
                    Part(PrimitiveType.Cylinder, "Bar", look, center + (alongX ? new Vector3(u, 0f, 0f) : new Vector3(0f, 0f, u)),
                        new Vector3(0.05f, h / 2f, 0.05f), metal);
            }
            Part(PrimitiveType.Cube, "Roof", look, new Vector3(0f, h + 0.04f, 0f), new Vector3(w + 0.1f, 0.08f, d + 0.1f), metal);
            Part(PrimitiveType.Cube, "Straw", look, new Vector3(0f, 0.02f, 0f), new Vector3(w - 0.1f, 0.04f, d - 0.1f), Mat("Hay", new Color(0.93f, 0.8f, 0.35f)));
            Part(PrimitiveType.Cube, "Padlock", look, new Vector3(1.4f, 1.1f, d / 2f + 0.08f), new Vector3(0.25f, 0.3f, 0.12f), Mat("Padlock", new Color(0.85f, 0.65f, 0.2f)));
            foreach (var tr in look.GetComponentsInChildren<Transform>()) GameObjectUtility.SetStaticEditorFlags(tr.gameObject, 0);
            var label = new GameObject("Label");
            label.transform.SetParent(root.transform, false);
            label.transform.localPosition = new Vector3(0f, h + 1f, 0f);
            cage.label = label.AddComponent<WorldLabel>();
            cage.label.text = "";
            cage.label.characterSize = 0.05f;
            cage.label.billboard = true;
            return SavePrefab(root, $"{PropDir}/PigCage.prefab");
        }

        /// <summary>Bob's gas bottle by the grill (Breakable, channel Sabotage): Heavy smashes it → the grill gets slow.</summary>
        static GameObject BuildGasBottlePrefab()
        {
            EnsureFolder(PropDir);
            var red = new Color(0.8f, 0.15f, 0.1f);
            var root = new GameObject("GasBottle");
            root.AddComponent<BoxCollider>().size = new Vector3(0.65f, 1.3f, 0.65f);
            root.AddComponent<NetworkObject>();
            var breakable = root.AddComponent<Breakable>();
            breakable.channel = ChannelIds.Sabotage; // also on the prefab, so clients know what it is
            breakable.debrisColor = red;
            breakable.debrisPieces = 14;
            var paint = Mat("GasBottle", red);
            Part(PrimitiveType.Cylinder, "Bottle", root.transform, new Vector3(0f, -0.08f, 0f), new Vector3(0.6f, 0.5f, 0.6f), paint);
            Part(PrimitiveType.Sphere, "Top", root.transform, new Vector3(0f, 0.42f, 0f), new Vector3(0.6f, 0.4f, 0.6f), paint);
            Part(PrimitiveType.Cylinder, "Valve", root.transform, new Vector3(0f, 0.62f, 0f), new Vector3(0.14f, 0.06f, 0.14f), Mat("FencePost", new Color(0.25f, 0.25f, 0.27f)));
            Part(PrimitiveType.Cube, "Band", root.transform, new Vector3(0f, 0.05f, 0.31f), new Vector3(0.4f, 0.25f, 0.02f), Mat("Lamp", Color.white));
            var label = new GameObject("Label");
            label.transform.SetParent(root.transform, false);
            label.transform.localPosition = new Vector3(0f, 1.2f, 0f);
            var text = label.AddComponent<WorldLabel>();
            text.text = "GAS";
            text.color = new Color(1f, 0.5f, 0.35f);
            text.characterSize = 0.035f;
            text.billboard = true;
            return SavePrefab(root, $"{PropDir}/GasBottle.prefab");
        }

        /// <summary>Gold coin that spins (CoinPickup): touched = coins for the team. No collider, no physics.</summary>
        static GameObject BuildCoinPrefab(string name, int value, float size)
        {
            EnsureFolder(PropDir);
            var gold = Mat("CoinGold", new Color(1f, 0.78f, 0.15f));
            var root = new GameObject(name);
            root.AddComponent<NetworkObject>();
            var coin = root.AddComponent<CoinPickup>();
            coin.value = value;
            coin.radius = 0.9f + size * 0.3f;
            var spin = new GameObject("Spin").transform;
            spin.SetParent(root.transform, false);
            Part(PrimitiveType.Cylinder, "Coin", spin, Vector3.zero, new Vector3(size, 0.04f, size), gold, new Vector3(90f, 0f, 0f));
            Part(PrimitiveType.Cylinder, "Face", spin, Vector3.zero, new Vector3(size * 0.7f, 0.05f, size * 0.7f), Mat("CoinFace", new Color(1f, 0.9f, 0.45f)), new Vector3(90f, 0f, 0f));
            coin.spinner = spin;
            return SavePrefab(root, $"{PropDir}/{name}.prefab");
        }

        /// <summary>Red fuel can (KeyItem "fuel") in Bob's garage: carry it to the truck's fuel cap.</summary>
        static GameObject BuildFuelCanPrefab()
        {
            EnsureFolder(PropDir);
            var red = Mat("FuelCan", new Color(0.85f, 0.15f, 0.1f));
            var metal = Mat("FencePost", new Color(0.25f, 0.25f, 0.27f));
            var root = new GameObject("FuelCan");
            root.AddComponent<BoxCollider>().size = new Vector3(0.45f, 0.6f, 0.3f);
            root.AddComponent<Rigidbody>().mass = 3f;
            AddNetworkSync(root);
            var key = root.AddComponent<KeyItem>();
            key.keyId = "fuel";
            key.labelText = "FUEL";
            key.labelColor = new Color(1f, 0.55f, 0.3f);
            Part(PrimitiveType.Cube, "Can", root.transform, Vector3.zero, new Vector3(0.45f, 0.6f, 0.3f), red);
            Part(PrimitiveType.Cube, "Handle", root.transform, new Vector3(0.05f, 0.36f, 0f), new Vector3(0.25f, 0.08f, 0.06f), metal);
            Part(PrimitiveType.Cylinder, "Spout", root.transform, new Vector3(-0.17f, 0.36f, 0f), new Vector3(0.08f, 0.08f, 0.08f), metal, new Vector3(0f, 0f, 30f));
            return SavePrefab(root, $"{PropDir}/FuelCan.prefab");
        }

        /// <summary>The truck's fuel cap (KeySlot "fuel", channel Fuel) on a little post by the truck's west side.</summary>
        static GameObject BuildFuelCapPrefab()
        {
            EnsureFolder(PropDir);
            var root = new GameObject("FuelCap");
            var box = root.AddComponent<BoxCollider>();
            box.size = new Vector3(0.35f, 1.1f, 0.35f);
            box.center = new Vector3(0f, 0.55f, 0f);
            root.AddComponent<NetworkObject>();
            var slot = root.AddComponent<KeySlot>();
            slot.acceptsKey = "fuel";
            slot.channel = ChannelIds.Fuel;
            slot.lockOffset = new Vector3(0f, 1.1f, 0f);
            slot.radius = 1.4f;
            Part(PrimitiveType.Cylinder, "Post", root.transform, new Vector3(0f, 0.5f, 0f), new Vector3(0.22f, 0.5f, 0.22f), Mat("Beam", new Color(0.42f, 0.28f, 0.16f)));
            Part(PrimitiveType.Cylinder, "Funnel", root.transform, new Vector3(0f, 1.12f, 0f), new Vector3(0.5f, 0.12f, 0.5f), Mat("FuelCan", new Color(0.85f, 0.15f, 0.1f)));
            var cap = new GameObject("Cap").transform; // pops up = tank filled
            cap.SetParent(root.transform, false);
            cap.localPosition = new Vector3(0f, 1.28f, 0f);
            Part(PrimitiveType.Cylinder, "Lid", cap, Vector3.zero, new Vector3(0.3f, 0.05f, 0.3f), Mat("FencePost", new Color(0.25f, 0.25f, 0.27f)));
            var lamp = Part(PrimitiveType.Sphere, "Lamp", root.transform, new Vector3(0f, 0.9f, 0.13f), Vector3.one * 0.16f, Mat("Lamp", Color.white));
            slot.shackle = cap;
            slot.lamp = lamp.GetComponent<Renderer>();
            return SavePrefab(root, $"{PropDir}/FuelCap.prefab");
        }

        /// <summary>Loot (KeyItem with coins, no lock): worth its coins if it rides away in the truck.</summary>
        static GameObject BuildLootPrefab(string name, string label, int coins, float mass, Vector3 box, System.Action<Transform> look)
        {
            EnsureFolder(PropDir);
            var root = new GameObject(name);
            root.AddComponent<BoxCollider>().size = box;
            root.AddComponent<Rigidbody>().mass = mass;
            AddNetworkSync(root);
            var item = root.AddComponent<KeyItem>();
            item.keyId = "";
            item.coins = coins;
            item.labelText = $"{label} ({coins})";
            item.labelColor = new Color(1f, 0.85f, 0.3f);
            look(root.transform);
            return SavePrefab(root, $"{PropDir}/{name}.prefab");
        }

        static GameObject BuildPiggyBankPrefab() => BuildLootPrefab("PiggyBank", "PIGGY BANK", 50, 5f, new Vector3(0.5f, 0.45f, 0.65f), t =>
        {
            var pink = Mat("PiggyBank", new Color(1f, 0.55f, 0.65f));
            Part(PrimitiveType.Sphere, "Body", t, Vector3.zero, new Vector3(0.5f, 0.45f, 0.6f), pink);
            Part(PrimitiveType.Cylinder, "Snout", t, new Vector3(0f, 0f, 0.3f), new Vector3(0.18f, 0.04f, 0.18f), pink, new Vector3(90f, 0f, 0f));
            Part(PrimitiveType.Cube, "Slot", t, new Vector3(0f, 0.22f, 0f), new Vector3(0.04f, 0.02f, 0.16f), Mat("Eye", new Color(0.05f, 0.05f, 0.05f)));
            foreach (var (x, z) in new[] { (-0.13f, 0.15f), (0.13f, 0.15f), (-0.13f, -0.15f), (0.13f, -0.15f) })
                Part(PrimitiveType.Cylinder, "Leg", t, new Vector3(x, -0.2f, z), new Vector3(0.08f, 0.05f, 0.08f), pink);
        });

        static GameObject BuildGoldenEggPrefab() => BuildLootPrefab("GoldenEgg", "GOLDEN EGG", 30, 1f, new Vector3(0.3f, 0.4f, 0.3f), t =>
            Part(PrimitiveType.Sphere, "Egg", t, Vector3.zero, new Vector3(0.3f, 0.4f, 0.3f), Mat("CoinGold", new Color(1f, 0.78f, 0.15f))));

        static GameObject BuildWatchPrefab() => BuildLootPrefab("GoldWatch", "BOB'S GOLD WATCH", 40, 1f, new Vector3(0.4f, 0.12f, 0.4f), t =>
        {
            Part(PrimitiveType.Cylinder, "Case", t, Vector3.zero, new Vector3(0.36f, 0.05f, 0.36f), Mat("CoinGold", new Color(1f, 0.78f, 0.15f)));
            Part(PrimitiveType.Cylinder, "Face", t, new Vector3(0f, 0.03f, 0f), new Vector3(0.28f, 0.03f, 0.28f), Mat("Lamp", Color.white));
            Part(PrimitiveType.Cube, "Hand", t, new Vector3(0.05f, 0.06f, 0f), new Vector3(0.1f, 0.01f, 0.02f), Mat("Eye", new Color(0.05f, 0.05f, 0.05f)));
        });
    }
}
