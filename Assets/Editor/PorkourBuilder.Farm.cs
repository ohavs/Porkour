using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace Porkour.EditorTools
{
    /// <summary>
    /// Farm 1 around the barn (x -64..64, z -16..100), open from the start: the pigs begin in their sty east of the barn.
    /// The exit is the GATEHOUSE in the north fence (electric fence + exit gate with padlock / motor / latch, lamps on it).
    /// Bob's house holds the truck keys (chimney, boarded back door, shuttered window; the front door opens from inside),
    /// the garage holds the fuel can (door opens once both garage plates are pressed together), the truck waits by the gate.
    /// Quaternius farm buildings, medieval-kit houses (cottage, stable, workshop), pasture, coops, animals, coins and loot.
    /// Kit / farm models for the look, invisible boxes for the gameplay. Trees / truck / tractor / crops use extra packs when
    /// the user adds them (ArtSetup.FindModels).
    /// </summary>
    public static partial class PorkourBuilder
    {
        /// <summary>The truck's origin: centre of its bed, on the ground. It faces +Z (the gate), tailgate ramp to the south.</summary>
        static readonly Vector3 TruckPos = new(16f, 0f, 86f);
        const float FarmMinX = -64f, FarmMaxX = 64f, FarmMinZ = -16f, FarmMaxZ = 100f;
        /// <summary>Gatehouse in the north fence: passage x 14..18, z 95..101.</summary>
        const float GateX = 16f, GateZ0 = 95f, GateZ1 = 101f;
        /// <summary>Bob's garage (fuel can) x -46..-38, z -4..4, big door on the east side; its two plates.</summary>
        static readonly Vector3 GaragePlateA = new(-34f, 0f, -7f), GaragePlateB = new(-26f, 0f, 29f);
        /// <summary>From TruckPos: the ignition post by the cab door, the fuel cap on the other side, the exhaust under the back.</summary>
        static readonly Vector3 IgnitionOffset = new(2.1f, 0f, 3.3f);
        static readonly Vector3 FuelCapOffset = new(-2.1f, 0f, -0.6f);
        static readonly Vector3 TruckExhaust = new(1.8f, 0.3f, -2.75f);
        /// <summary>Bob's chimney (west of the house) and where a pig pops out (the fireplace inside).</summary>
        static readonly Vector3 ChimneyTop = new(-20.85f, 5.72f, 35f);
        static readonly Vector3 ChimneyExit = new(-19.2f, 0.6f, 35.3f);
        /// <summary>Armed's three bullseyes (the exit gate's latch) sit on poles around the farm.</summary>
        static readonly Vector3[] BullseyePoles = { new(-26f, 0f, 16.5f), new(50f, 0f, 40f), new(-4f, 0f, 93f) };

        static void BuildFarmyard(Transform r)
        {
            var wood = Mat("Crate", new Color(0.8f, 0.62f, 0.38f));
            var darkWood = Mat("RoofWood", new Color(0.33f, 0.22f, 0.14f));
            var hay = Mat("Hay", new Color(0.93f, 0.8f, 0.35f));
            var dirt = Mat("Dirt", new Color(0.5f, 0.38f, 0.24f));
            var stone = Mat("Stone", new Color(0.5f, 0.5f, 0.52f));
            bool kit = Kit.Available;
            var farm = new GameObject("Farm1").transform;
            farm.SetParent(r, false);

            // Invisible walls + roof (14 m) around the farm; farm fences for the eye. The barn's south wall and Bob's BBQ yard
            // close the south side between x -12 and 12 (the BBQ is NOT part of the farm: only the pig flap / Bob's door lead there).
            const float t = 0.4f, wallH = 14f;
            float midZ = (FarmMinZ + FarmMaxZ) / 2f, lenZ = FarmMaxZ - FarmMinZ;
            Boundary(farm, "FarmW", new Vector3(FarmMinX - 0.2f, wallH / 2f, midZ), new Vector3(t, wallH, lenZ + 0.8f));
            Boundary(farm, "FarmE", new Vector3(FarmMaxX + 0.2f, wallH / 2f, midZ), new Vector3(t, wallH, lenZ + 0.8f));
            Boundary(farm, "FarmN1", new Vector3((FarmMinX + GateX - 2.4f) / 2f, wallH / 2f, FarmMaxZ + 0.2f), new Vector3(GateX - 2.4f - FarmMinX, wallH, t));
            Boundary(farm, "FarmN2", new Vector3((GateX + 2.4f + FarmMaxX) / 2f, wallH / 2f, FarmMaxZ + 0.2f), new Vector3(FarmMaxX - GateX - 2.4f, wallH, t));
            Boundary(farm, "FarmS1", new Vector3((FarmMinX - 12f) / 2f, wallH / 2f, FarmMinZ - 0.2f), new Vector3(-12f - FarmMinX, wallH, t));
            Boundary(farm, "FarmS2", new Vector3((12f + FarmMaxX) / 2f, wallH / 2f, FarmMinZ - 0.2f), new Vector3(FarmMaxX - 12f, wallH, t));
            Boundary(farm, "RoadW", new Vector3(GateX - 2.6f, wallH / 2f, GateZ1 + 3f), new Vector3(t, wallH, 6f));
            Boundary(farm, "RoadE", new Vector3(GateX + 2.6f, wallH / 2f, GateZ1 + 3f), new Vector3(t, wallH, 6f));
            Boundary(farm, "RoadN", new Vector3(GateX, wallH / 2f, GateZ1 + 6.2f), new Vector3(5.6f, wallH, t));
            Boundary(farm, "FarmRoof", new Vector3(0f, wallH + 0.25f, (FarmMinZ + GateZ1 + 6f) / 2f), new Vector3(FarmMaxX - FarmMinX + 1f, 0.5f, GateZ1 + 6f - FarmMinZ));
            FenceRun(farm, new Vector3(FarmMinX, 0f, FarmMinZ), new Vector3(FarmMinX, 0f, FarmMaxZ), wood);
            FenceRun(farm, new Vector3(FarmMaxX, 0f, FarmMinZ), new Vector3(FarmMaxX, 0f, FarmMaxZ), wood);
            FenceRun(farm, new Vector3(FarmMinX, 0f, FarmMaxZ), new Vector3(GateX - 2.4f, 0f, FarmMaxZ), wood);
            FenceRun(farm, new Vector3(GateX + 2.4f, 0f, FarmMaxZ), new Vector3(FarmMaxX, 0f, FarmMaxZ), wood);
            FenceRun(farm, new Vector3(FarmMinX, 0f, FarmMinZ), new Vector3(-20.4f, 0f, FarmMinZ), wood);
            FenceRun(farm, new Vector3(20.4f, 0f, FarmMinZ), new Vector3(FarmMaxX, 0f, FarmMinZ), wood);

            Gatehouse(farm, kit, darkWood);
            BobsHouse(farm, kit);
            Garage(farm, kit, wood, darkWood);
            PigSty(farm, wood, darkWood);
            BuildTruck(farm);

            // Dirt roads: barn doorway → north, east to the truck, north through the gatehouse; side paths.
            DirtPath(farm, new Vector3(0f, 0.01f, 30.7f), new Vector3(4f, 0.02f, 30.6f), dirt);
            DirtPath(farm, new Vector3(8f, 0.01f, 46f), new Vector3(12f, 0.02f, 3f), dirt);
            DirtPath(farm, new Vector3(GateX, 0.01f, (47.5f + GateZ1 + 6f) / 2f), new Vector3(4f, 0.02f, GateZ1 + 6f - 47.5f), dirt);
            DirtPath(farm, new Vector3(-8.5f, 0.01f, 31.5f), new Vector3(13f, 0.02f, 2.5f), dirt);
            DirtPath(farm, new Vector3(-29f, 0.01f, 0f), new Vector3(17.5f, 0.02f, 3f), dirt);
            DirtPath(farm, new Vector3(23.5f, 0.01f, -7f), new Vector3(5f, 0.02f, 2.5f), dirt);   // sty → barn
            DirtPath(farm, new Vector3(45f, 0.01f, 5f), new Vector3(14f, 0.02f, 2.5f), dirt);     // → workshop
            DirtPath(farm, new Vector3(45f, 0.01f, 23f), new Vector3(10f, 0.02f, 2.5f), dirt);    // → stable
            DirtPath(farm, new Vector3(-49f, 0.01f, 16f), new Vector3(18f, 0.02f, 2.5f), dirt);   // → cottage

            // Farm buildings (Quaternius) - landmarks with simple box colliders.
            FarmBuildingAt(farm, "TowerWindmill", new Vector3(-36f, 0f, 80f), 0f, 14f, new Vector3(4f, 12f, 4f), stone, colliderXZ: 0.4f, spin: true);
            FarmBuildingAt(farm, "Windmill", new Vector3(42f, 0f, 30f), 90f, 13f, new Vector3(3f, 11f, 3f), stone, colliderXZ: 0.35f, spin: true);
            FarmBuildingAt(farm, "WaterTower", new Vector3(-40f, 0f, 28f), 0f, 10f, new Vector3(3f, 10f, 3f), stone, colliderXZ: 0.8f);
            FarmBuildingAt(farm, "Silo_House", new Vector3(40f, 0f, 84f), 180f, 11f, new Vector3(6f, 11f, 4f), stone, colliderXZ: 0.9f);
            FarmBuildingAt(farm, "Silo", new Vector3(56f, 0f, 70f), 0f, 12f, new Vector3(3.5f, 12f, 3.5f), stone, colliderXZ: 0.9f);
            FarmBuildingAt(farm, "SmallBarn", new Vector3(-38f, 0f, 52f), 90f, 6.4f, new Vector3(8f, 6f, 8f), darkWood);
            FarmBuildingAt(farm, "Barn", new Vector3(-14f, 0f, 82f), 0f, 8f, new Vector3(10f, 8f, 10f), darkWood);
            FarmBuildingAt(farm, "BigBarn", new Vector3(-55f, 0f, 64f), 90f, 10f, new Vector3(10f, 10f, 10f), darkWood);
            FarmBuildingAt(farm, "Well", new Vector3(0f, 0f, 54f), 0f, 2.6f, new Vector3(1.6f, 1f, 1.6f), stone);
            // Open barn (tractor shed): roof only, hay inside to hide in.
            var shed = FarmBuildingAt(farm, "OpenBarn", new Vector3(34f, 0f, 76f), 180f, 6f, new Vector3(7f, 6f, 7f), darkWood, collide: false);
            Invisible(Block("ShedRoofCollider", farm, new Vector3(shed.center.x, shed.max.y - 0.6f, shed.center.z), new Vector3(shed.size.x, 1.2f, shed.size.z), null));
            Haystack(farm, new Vector3(34f, 0f, 76f), hay);
            TractorAt(farm, new Vector3(28.5f, 0f, 68f), 200f);

            // Medieval-kit houses you can walk into: farmhand cottage, stable with a hay loft, workshop.
            if (kit)
            {
                Cottage(farm, wood);
                Stable(farm, wood, darkWood, hay);
                Workshop(farm, wood);
                foreach (var (pos, yaw) in new[] { (new Vector3(45f, 0f, 32f), 0f), (new Vector3(-49f, 0f, 23f), 90f), (new Vector3(-52f, 0f, 46f), 0f) })
                {
                    Invisible(Block("Wagon", farm, pos + Vector3.up * 0.6f, new Vector3(1.9f, 1.2f, 4f), null));
                    Kit.Fit("Prop_Wagon", farm, pos + Vector3.up * 0.765f, new Vector3(1.95f, 1.53f, 4f), yaw, keepLongSide: true);
                    NoGrassAround(pos, new Vector3(2f, 0f, 4f));
                }
            }

            // Chicken pen (x 18..26, z 20..26): low fence with a gap in the north side, the coop in a corner.
            bool fences = ArtSetup.FarmBuilding("Fence") != null || kit;
            Pen(farm, new Vector2(18f, 20f), new Vector2(26f, 26f), new Vector2(21f, 23f), true, wood, fences);
            FarmBuildingAt(farm, "ChickenCoop", new Vector3(24.4f, 0f, 21.6f), 180f, 2.2f, new Vector3(2.2f, 1.6f, 1.8f), darkWood);
            // Second coop east of the barn with chicks pecking around.
            Pen(farm, new Vector2(42f, -12f), new Vector2(50f, -4f), new Vector2(-8f, -6f), false, wood, fences);
            FarmBuildingAt(farm, "ChickenCoop", new Vector3(48f, 0f, -10f), 0f, 2.2f, new Vector3(2.2f, 1.6f, 1.8f), darkWood);
            foreach (var (x, z, yaw) in new[] { (44f, -7f, 30f), (45.5f, -9f, 200f), (46f, -6f, 120f) })
                DecorAnimal(farm, "chick", new Vector3(x, 0f, z), yaw, 0.6f);

            // Cow pasture (x 24..46, z 42..66), entrance on the west side; cows graze, the calf (bait) lives here.
            Pen(farm, new Vector2(24f, 42f), new Vector2(46f, 66f), new Vector2(52f, 56f), false, wood, fences);
            foreach (var (x, z, yaw) in new[] { (31f, 60f, 120f), (41f, 47f, -60f), (36f, 52f, 10f), (43f, 61f, 160f) })
                DecorAnimal(farm, "cow", new Vector3(x, 0f, z), yaw, 1.7f);
            Block("CalfTrough", farm, new Vector3(36f, 0.25f, 64.8f), new Vector3(3f, 0.5f, 0.6f), darkWood);

            // Animals around the farm (look only): Bob's dog by his house, cats, bunnies by the field.
            DecorAnimal(farm, "dog", new Vector3(-10.5f, 0f, 33f), 200f, 0.9f);
            DecorAnimal(farm, "cat", new Vector3(1.5f, 0f, 52.5f), 250f, 0.55f);
            DecorAnimal(farm, "cat", new Vector3(-41f, 0f, 6f), 80f, 0.55f);
            foreach (var (x, z, yaw) in new[] { (-28f, 72f, 40f), (-27f, 74f, 190f), (-44f, 72f, 300f) })
                DecorAnimal(farm, "bunny", new Vector3(x, 0f, z), yaw, 0.55f);

            // Hiding: mud puddles, hay; Heavy shakes apples out of the apple trees.
            Mud(farm, new Vector3(-4.5f, 0f, 26f), 1.6f);
            Mud(farm, new Vector3(21f, 0f, 34f), 1.4f);
            Mud(farm, new Vector3(-8f, 0f, 62f), 1.5f);
            Mud(farm, new Vector3(30f, 0f, 50f), 1.8f);
            Mud(farm, new Vector3(-30f, 0f, 10f), 1.5f);
            Haystack(farm, new Vector3(-25f, 0f, 22f), hay);
            Haystack(farm, new Vector3(4f, 0f, 37f), hay);
            Haystack(farm, new Vector3(-26f, 0f, 64f), hay);
            Haystack(farm, new Vector3(8f, 0f, 66f), hay);
            Haystack(farm, new Vector3(28f, 0f, 8f), hay);
            Haystack(farm, new Vector3(-50f, 0f, 8f), hay);
            Haystack(farm, new Vector3(56f, 0f, 44f), hay);
            AppleTreeAt(farm, new Vector3(7f, 0f, 24f));
            AppleTreeAt(farm, new Vector3(-6f, 0f, 70f));
            AppleTreeAt(farm, new Vector3(9f, 0f, 58f));
            AppleTreeAt(farm, new Vector3(-28f, 0f, 44f));
            AppleTreeAt(farm, new Vector3(36f, 0f, 2f));
            foreach (var (x, z, size) in new[] { (-60f, 40f, 1.2f), (-45f, 92f, 1.3f), (60f, 92f, 1.2f), (-20f, 58f, 1f), (-60f, 90f, 1.1f),
                         (60f, 50f, 1.3f), (-60f, -8f, 1.2f), (60f, -12f, 1.1f), (-30f, 96f, 1f) })
                Tree(farm, new Vector3(x, 0f, z), size, collide: true);

            // Static crates: a step up to the lean-to roof, cover around the yard.
            foreach (var c in new[] { new Vector3(-22.6f, 0f, 38.9f), new Vector3(20.6f, 0f, 82f), new Vector3(-33f, 0f, 76f), new Vector3(-33f, 0f, 77.1f),
                         new Vector3(-36f, 0f, 6f), new Vector3(38f, 0f, -14f) })
                StaticCrate(farm, c, wood, kit);
            Crops(farm, new Vector2(-46f, 58f), new Vector2(-30f, 70f));

            // Armed's three bullseyes on poles around the farm (the gate latch).
            foreach (var foot in BullseyePoles) BullseyePole(farm, foot, darkWood);

            Scenery(r);
        }

        /// <summary>Bullseye pole (the ShootTarget is network-spawned on top, see FarmSpawnPoints): kit post look.</summary>
        static void BullseyePole(Transform parent, Vector3 foot, Material wood)
        {
            bool kit = Kit.Available;
            Solid("BullseyePole", parent, foot + new Vector3(0f, 2.5f, 0f), new Vector3(0.35f, 5f, 0.35f), wood, kit);
            if (kit) Kit.Fit("Corner_ExteriorWide_Wood", parent, foot + new Vector3(0f, 2.5f, 0f), new Vector3(0.4f, 5f, 0.4f), 0f);
        }

        /// <summary>Low fenced pen (pigs hop over): colliders 1 m high + fence look; a gap in the north side (gapNorth: x range) or the west side (z range).</summary>
        static void Pen(Transform parent, Vector2 min, Vector2 max, Vector2 gap, bool gapNorth, Material wood, bool fenceLook)
        {
            void Side(Vector3 a, Vector3 b)
            {
                Vector3 d = b - a;
                if (d.magnitude < 0.2f) return;
                Vector3 c = (a + b) / 2f + Vector3.up * 0.5f;
                bool alongX = Mathf.Abs(d.x) > Mathf.Abs(d.z);
                Solid("PenFence", parent, c, alongX ? new Vector3(d.magnitude, 1f, 0.15f) : new Vector3(0.15f, 1f, d.magnitude), wood, fenceLook);
                if (fenceLook) FenceRun(parent, a, b, wood, 1f);
            }
            Vector3 p(float x, float z) => new(x, 0f, z);
            Side(p(min.x, min.y), p(max.x, min.y));
            Side(p(max.x, min.y), p(max.x, max.y));
            if (gapNorth)
            {
                Side(p(min.x, max.y), p(gap.x, max.y));
                Side(p(gap.y, max.y), p(max.x, max.y));
                Side(p(min.x, min.y), p(min.x, max.y));
            }
            else
            {
                Side(p(min.x, max.y), p(max.x, max.y));
                // gap on the west side (gap = z range); a gap outside the side's range means "closed"
                Side(p(min.x, min.y), p(min.x, Mathf.Clamp(gap.x, min.y, max.y)));
                Side(p(min.x, Mathf.Clamp(gap.y, min.y, max.y)), p(min.x, max.y));
            }
        }

        /// <summary>
        /// The farm's exit in the north fence: a little roofed gatehouse (kit walls) with the electric fence and the exit gate
        /// inside (network-spawned), four lamps over the entrance (key, fence, power, targets) and the padlock post beside it.
        /// </summary>
        static void Gatehouse(Transform parent, bool kit, Material darkWood)
        {
            var wall = Mat("BarnWall", new Color(0.65f, 0.18f, 0.15f));
            var house = new GameObject("Gatehouse").transform;
            house.SetParent(parent, false);
            NoGrassRect(GateX - 2.8f, GateZ0 - 0.5f, GateX + 2.8f, GateZ1 + 7f);
            float zc = (GateZ0 + GateZ1) / 2f, len = GateZ1 - GateZ0;
            Solid("GatehouseW", house, new Vector3(GateX - 2.2f, Story / 2f, zc), new Vector3(0.4f, Story, len), wall, kit);
            Solid("GatehouseE", house, new Vector3(GateX + 2.2f, Story / 2f, zc), new Vector3(0.4f, Story, len), wall, kit);
            Block("GatehouseRoof", house, new Vector3(GateX, Story + 0.15f, zc), new Vector3(4.8f, 0.3f, len), darkWood);
            if (kit)
            {
                Kit.WallRun(house, new Vector3(GateX - 2f, 0f, GateZ0), new Vector3(GateX - 2f, 0f, GateZ1), Vector3.left, 1, (_, _) => "Wall_UnevenBrick_Straight");
                Kit.WallRun(house, new Vector3(GateX + 2f, 0f, GateZ0), new Vector3(GateX + 2f, 0f, GateZ1), Vector3.right, 1, (_, _) => "Wall_UnevenBrick_Straight");
                Kit.Fit("Roof_RoundTiles_4x6", house, new Vector3(GateX, Story + 1.6f, zc), new Vector3(5.8f, 3.4f, len + 0.8f), 0f, keepLongSide: true);
            }
            var lampMat = Mat("Lamp", Color.white);
            string[] names = { "KEY", "FENCE", "POWER", "TARGETS" };
            for (int i = 0; i < names.Length; i++)
            {
                float x = GateX - 1.5f + i * 1f;
                var lamp = Part(PrimitiveType.Sphere, "GateLamp", house, new Vector3(x, Story - 0.35f, GateZ0 - 0.3f), Vector3.one * 0.4f, lampMat);
                var objectiveLamp = lamp.AddComponent<ObjectiveLamp>();
                objectiveLamp.objective = i;
                objectiveLamp.lamp = lamp.GetComponent<Renderer>();
                Label(house, names[i], new Vector3(x, Story - 0.85f, GateZ0 - 0.35f), Color.white, 0.022f);
            }
            PointLight(house, new Vector3(GateX, 2.4f, GateZ0 - 1f), new Color(0.8f, 1f, 0.8f), 8f, 1.2f);
        }

        /// <summary>
        /// Bob's garage (x -46..-38, z -4..4): kit walls, big door on the east side (network-spawned Gate, channel GarageDoor:
        /// opens for good once both garage plates are pressed together - ChannelLatch), the fuel can inside.
        /// </summary>
        static void Garage(Transform parent, bool kit, Material wood, Material darkWood)
        {
            var plaster = Mat("HouseWall", new Color(0.92f, 0.86f, 0.72f));
            var garage = new GameObject("Garage").transform;
            garage.SetParent(parent, false);
            const float x0 = -46f, x1 = -38f, z0 = -4f, z1 = 4f, t = 0.4f, gable = 7.8f;
            Solid("GarageW", garage, new Vector3(x0 - 0.2f, gable / 2f, 0f), new Vector3(t, gable, z1 - z0 + 0.8f), plaster, kit);
            Solid("GarageN", garage, new Vector3((x0 + x1) / 2f, Story / 2f, z1 + 0.2f), new Vector3(x1 - x0 + 0.8f, Story, t), plaster, kit);
            Solid("GarageS", garage, new Vector3((x0 + x1) / 2f, Story / 2f, z0 - 0.2f), new Vector3(x1 - x0 + 0.8f, Story, t), plaster, kit);
            Solid("GarageE1", garage, new Vector3(x1 + 0.2f, gable / 2f, -3.2f), new Vector3(t, gable, 2.4f), plaster, kit);
            Solid("GarageE2", garage, new Vector3(x1 + 0.2f, gable / 2f, 3.2f), new Vector3(t, gable, 2.4f), plaster, kit);
            Solid("GarageLintel", garage, new Vector3(x1 + 0.2f, (Story + gable) / 2f, 0f), new Vector3(t, gable - Story, 4f), plaster, kit);
            RoofSlopes(garage, x0, x1, z0, z1, Story);
            if (kit)
            {
                KitHouse(garage, x0, x1, z0, z1, 1, (side, i, _) => side == 2 && (i == 1 || i == 2) ? null
                    : side == 2 ? "Wall_UnevenBrick_Straight" : "Wall_Plaster_WoodGrid");
                Kit.FloorTiles("Floor_Brick", garage, new Vector2(x0, z0), new Vector2(x1, z1), 0.02f);
            }
            else Block("GarageRoof", garage, new Vector3((x0 + x1) / 2f, Story + 0.15f, 0f), new Vector3(x1 - x0 + 0.8f, 0.3f, z1 - z0 + 0.8f), darkWood);
            Table(garage, new Vector3(-44.5f, 0f, 2.8f), wood);
            StaticCrate(garage, new Vector3(-45f, 0f, -2.8f), wood, kit);
            Furnish(garage, "shelf", new Vector3(-45.75f, 0f, 0.4f), 90f, wood);
            Furnish(garage, "barrel", new Vector3(-38.8f, 0f, 3.3f), 0f, wood);
            Furnish(garage, "barrel", new Vector3(-39.7f, 0f, 3.4f), 0f, wood);
            PointLight(garage, new Vector3(-42f, 2.6f, 0f), new Color(1f, 0.85f, 0.6f), 8f, 1.2f);
            var latch = new GameObject("GarageDoorLatch").AddComponent<ChannelLatch>(); // both plates at once → the door stays open
            latch.transform.SetParent(garage, false);
            latch.inputs = new[] { ChannelIds.GatePlateA, ChannelIds.GatePlateB };
            latch.output = ChannelIds.GarageDoor;
        }

        /// <summary>The pigs' sty east of the barn (x 26..36, z -12..-2), where every round starts: low fence, mud, trough.</summary>
        static void PigSty(Transform parent, Material wood, Material darkWood)
        {
            bool fences = ArtSetup.FarmBuilding("Fence") != null || Kit.Available;
            Pen(parent, new Vector2(26f, -12f), new Vector2(36f, -2f), new Vector2(-8f, -6f), false, wood, fences);
            Mud(parent, new Vector3(33.5f, 0f, -9.5f), 1.8f);
            Block("StyTrough", parent, new Vector3(30f, 0.25f, -11.4f), new Vector3(2.4f, 0.5f, 0.6f), darkWood);
            Block("StyShelter", parent, new Vector3(34.5f, 1.6f, -3.2f), new Vector3(3f, 0.2f, 2.4f), darkWood);
            foreach (var (x, z) in new[] { (33.2f, -2.2f), (35.8f, -2.2f), (33.2f, -4.2f), (35.8f, -4.2f) })
                Block("ShelterPost", parent, new Vector3(x, 0.75f, z), new Vector3(0.15f, 1.5f, 0.15f), darkWood);
        }

        /// <summary>
        /// A kit house you can walk into: invisible wall boxes follow the picked pieces (a door piece leaves a 1.4 x 2.45
        /// doorway, null leaves the slot open, everything else is solid), corner posts, roof slopes; the kit look on top.
        /// pick(side 0=S 1=N 2=E 3=W, slot, story) like KitHouse. Upper floors / lofts are added by the caller.
        /// </summary>
        static Transform OpenKitHouse(Transform parent, string name, float x0, float x1, float z0, float z1, int stories,
            System.Func<int, int, int, string> pick)
        {
            var root = new GameObject(name).transform;
            root.SetParent(parent, false);
            float top = stories * Story;
            var sides = new (Vector3 a, Vector3 b, Vector3 outward)[]
            {
                (new Vector3(x0, 0f, z0), new Vector3(x1, 0f, z0), Vector3.back), (new Vector3(x0, 0f, z1), new Vector3(x1, 0f, z1), Vector3.forward),
                (new Vector3(x1, 0f, z0), new Vector3(x1, 0f, z1), Vector3.right), (new Vector3(x0, 0f, z0), new Vector3(x0, 0f, z1), Vector3.left),
            };
            for (int side = 0; side < sides.Length; side++)
            {
                var (a, b, outward) = sides[side];
                Vector3 dir = (b - a).normalized;
                bool alongX = Mathf.Abs(dir.x) > 0.5f;
                int slots = Mathf.RoundToInt((b - a).magnitude / 2f);
                Vector3 Size(float along, float height) => alongX ? new Vector3(along, height, 0.4f) : new Vector3(0.4f, height, along);
                for (int story = 0; story < stories; story++)
                for (int i = 0; i < slots; i++)
                {
                    string piece = pick(side, i, story);
                    if (piece == null) continue;
                    Vector3 c = a + dir * (2f * i + 1f) + outward * 0.2f + Vector3.up * story * Story;
                    if (piece.Contains("Door"))
                    {
                        foreach (float off in new[] { -0.85f, 0.85f })
                            Invisible(Block("Wall", root, c + dir * off + Vector3.up * Story / 2f, Size(0.3f, Story), null));
                        Invisible(Block("Lintel", root, c + Vector3.up * (2.45f + Story) / 2f, Size(1.4f, Story - 2.45f), null));
                    }
                    else Invisible(Block("Wall", root, c + Vector3.up * Story / 2f, Size(2f, Story), null));
                }
            }
            foreach (float x in new[] { x0 - 0.2f, x1 + 0.2f })
            foreach (float z in new[] { z0 - 0.2f, z1 + 0.2f })
                Invisible(Block("Corner", root, new Vector3(x, top / 2f, z), new Vector3(0.4f, top, 0.4f), null));
            RoofSlopes(root, x0, x1, z0, z1, top);
            KitHouse(root, x0, x1, z0, z1, stories, pick);
            return root;
        }

        /// <summary>Farmhand's cottage (x -60..-52, z 18..24): bed to hide under, table + chairs, shelf, chest, rug.</summary>
        static void Cottage(Transform parent, Material wood)
        {
            var house = OpenKitHouse(parent, "Cottage", -60f, -52f, 18f, 24f, 1, (side, i, _) => side == 0 && i == 1 ? "Wall_Plaster_Door_Round"
                : i % 2 == 0 ? "Wall_Plaster_Window_Wide_Round" : "Wall_Plaster_Straight");
            Kit.Wall("DoorFrame_Round_WoodDark", house, new Vector3(-57f, 0f, 18f), Vector3.back);
            Kit.FloorTiles("Floor_WoodDark", house, new Vector2(-60f, 18f), new Vector2(-52f, 24f), 0.02f);
            Part(PrimitiveType.Cube, "Rug", house, new Vector3(-55.5f, 0.035f, 21.2f), new Vector3(3f, 0.02f, 2f), Mat("Blanket", new Color(0.75f, 0.2f, 0.2f)));
            Furnish(house, "bed", new Vector3(-59.1f, 0f, 22.8f), 180f, wood);
            Furnish(house, "chest", new Vector3(-59.1f, 0f, 21.1f), 0f, wood);
            Furnish(house, "table", new Vector3(-55.5f, 0f, 21.2f), 0f, wood);
            Furnish(house, "chair", new Vector3(-56.6f, 0f, 21.2f), 90f, wood);
            Furnish(house, "chair", new Vector3(-54.4f, 0f, 21.2f), -90f, wood);
            Furnish(house, "shelf", new Vector3(-52.25f, 0f, 22.6f), -90f, wood);
            Furnish(house, "barrel", new Vector3(-52.7f, 0f, 18.7f), 0f, wood);
            Furnish(house, "sack", new Vector3(-53.6f, 0f, 18.6f), 30f, wood);
            PointLight(house, new Vector3(-56f, 2.6f, 21f), new Color(1f, 0.85f, 0.6f), 8f, 1.3f);
        }

        /// <summary>
        /// Stable (x 50..60, z 18..26): stalls with a cow and hay on the ground floor, a hay loft over the north half
        /// (3.12 m, ladder at x 58) - Bob can't follow up there (he throws corn). Doors on the west side.
        /// </summary>
        static void Stable(Transform parent, Material wood, Material darkWood, Material hay)
        {
            const float x0 = 50f, x1 = 60f, z0 = 18f, z1 = 26f, loftZ = 22f;
            var stable = OpenKitHouse(parent, "Stable", x0, x1, z0, z1, 2, (side, i, story) => story == 0
                ? (side == 3 && i % 2 == 1 ? "Wall_UnevenBrick_Door_Round" : "Wall_UnevenBrick_Straight")
                : i % 2 == 0 ? "Wall_Plaster_Window_Wide_Round" : "Wall_Plaster_WoodGrid");
            foreach (float z in new[] { 21f, 25f }) Kit.Wall("DoorFrame_Round_WoodDark", stable, new Vector3(x0, 0f, z), Vector3.left);
            Kit.FloorTiles("Floor_UnevenBrick", stable, new Vector2(x0, z0), new Vector2(x1, z1), 0.02f);
            // Loft (north half): solid floor, wooden look, ladder up at its edge.
            PassThrough(Block("Loft", stable, new Vector3((x0 + x1) / 2f, Story - 0.15f, (loftZ + z1) / 2f), new Vector3(x1 - x0, 0.3f, z1 - loftZ), darkWood));
            Kit.FloorTiles("Floor_WoodDark", stable, new Vector2(x0, loftZ), new Vector2(x1, z1), Story + 0.012f);
            Ladder(stable, new Vector3(58f, 0f, loftZ), Vector3.back, Story, wood);
            Haystack(stable, new Vector3(52.5f, Story, 24.5f), hay);
            Block("LoftBale", stable, new Vector3(57.5f, Story + 0.8f, 25.2f), new Vector3(1.6f, 1f, 1.6f), hay, new Vector3(0f, 0f, 90f), PrimitiveType.Cylinder);
            // Stalls (south half): low dividers, a cow, a haystack to hide in, a trough.
            foreach (float x in new[] { 53.4f, 56.6f })
                Block("StallWall", stable, new Vector3(x, 0.65f, 19.6f), new Vector3(0.15f, 1.3f, 3.2f), wood);
            DecorAnimal(stable, "cow", new Vector3(51.8f, 0f, 19.8f), 0f, 1.5f);
            Haystack(stable, new Vector3(55f, 0f, 19.6f), hay);
            Block("StallTrough", stable, new Vector3(58.3f, 0.3f, 18.6f), new Vector3(2.4f, 0.6f, 0.6f), darkWood);
            Furnish(stable, "barrel", new Vector3(59.3f, 0f, 23.2f), 0f, wood);
            Furnish(stable, "sack", new Vector3(51f, 0f, 21.4f), 0f, wood);
            PointLight(stable, new Vector3(55f, 2.6f, 20f), new Color(1f, 0.85f, 0.6f), 9f, 1.2f);
            PointLight(stable, new Vector3(55f, Story + 2.2f, 24f), new Color(1f, 0.85f, 0.6f), 8f, 1f);
        }

        /// <summary>Workshop (x 52..58, z 2..8): workbench (bolts on it), shelf, chest, barrels, sacks.</summary>
        static void Workshop(Transform parent, Material wood)
        {
            var shop = OpenKitHouse(parent, "Workshop", 52f, 58f, 2f, 8f, 1, (side, i, _) => side == 3 && i == 1 ? "Wall_Plaster_Door_Round"
                : side == 2 && i == 1 ? "Wall_Plaster_Window_Wide_Round" : "Wall_Plaster_WoodGrid");
            Kit.Wall("DoorFrame_Round_WoodDark", shop, new Vector3(52f, 0f, 5f), Vector3.left);
            Kit.FloorTiles("Floor_Brick", shop, new Vector2(52f, 2f), new Vector2(58f, 8f), 0.02f);
            Furnish(shop, "workbench", new Vector3(57.2f, 0f, 5f), -90f, wood);
            Furnish(shop, "shelf", new Vector3(55f, 0f, 7.75f), 180f, wood);
            Furnish(shop, "chest", new Vector3(54.5f, 0f, 2.5f), 0f, wood);
            Furnish(shop, "barrel", new Vector3(52.7f, 0f, 7.3f), 0f, wood);
            Furnish(shop, "barrel", new Vector3(53.6f, 0f, 7.4f), 0f, wood);
            Furnish(shop, "sack", new Vector3(57.2f, 0f, 2.7f), 0f, wood);
            PointLight(shop, new Vector3(55f, 2.6f, 5f), new Color(1f, 0.85f, 0.6f), 8f, 1.3f);
        }

        /// <summary>Invisible roof: two slopes from the eaves to the ridge (along x) + gable boxes - pigs that land up there slide off.</summary>
        static void RoofSlopes(Transform parent, float x0, float x1, float z0, float z1, float top)
        {
            float span = z1 - z0, k = span / 6f, rise = 4.6f * k, run = span / 2f + 0.6f;
            float angle = Mathf.Atan2(rise, run) * Mathf.Rad2Deg, slope = Mathf.Sqrt(rise * rise + run * run);
            float xc = (x0 + x1) / 2f, zc = (z0 + z1) / 2f;
            foreach (float side in new[] { -1f, 1f })
                PassThrough(Invisible(Block("RoofSlope", parent, new Vector3(xc, top + 0.1f + rise / 2f, zc + side * run / 2f),
                    new Vector3(x1 - x0 + 1.7f, 0.3f, slope), null, new Vector3(side * angle, 0f, 0f))));
            foreach (float x in new[] { x0 - 0.2f, x1 + 0.2f })
                Invisible(Block("Gable", parent, new Vector3(x, top + rise / 2f, zc), new Vector3(0.4f, rise, span * 0.5f), null));
        }

        /// <summary>
        /// Bob's house (x -20..-12, z 34..40), one story + tiled roof. Ways in: chimney (top of the lean-to → chimney →
        /// fireplace), the boarded back door (Heavy), the east window (shoot the bullseye → shutter opens). Inside, the
        /// front door opens by itself (InsideOpener) so everyone can follow. Truck keys and Bob's pie on the tables.
        /// </summary>
        static void BobsHouse(Transform parent, bool kit)
        {
            var plaster = Mat("HouseWall", new Color(0.92f, 0.86f, 0.72f));
            var wood = Mat("Crate", new Color(0.8f, 0.62f, 0.38f));
            var darkWood = Mat("RoofWood", new Color(0.33f, 0.22f, 0.14f));
            var stone = Mat("Stone", new Color(0.5f, 0.5f, 0.52f));
            var house = new GameObject("BobsHouse").transform;
            house.SetParent(parent, false);
            const float t = 0.4f, gable = 7.8f; // walls 0.4 thick outside the lines; end walls go up under the ridge

            // Collision: openings = front door (south, x -15.7..-14.3), back door (north, x -17.7..-16.3), window (east, z 36.3..37.7, 1.02..2.74 high).
            Solid("HouseS1", house, new Vector3(-18.05f, Story / 2f, 33.8f), new Vector3(4.7f, Story, t), plaster, kit);
            Solid("HouseS2", house, new Vector3(-12.95f, Story / 2f, 33.8f), new Vector3(2.7f, Story, t), plaster, kit);
            Solid("HouseS3", house, new Vector3(-15f, 2.785f, 33.8f), new Vector3(1.4f, 0.67f, t), plaster, kit);
            Solid("HouseN1", house, new Vector3(-19.05f, Story / 2f, 40.2f), new Vector3(2.7f, Story, t), plaster, kit);
            Solid("HouseN2", house, new Vector3(-13.95f, Story / 2f, 40.2f), new Vector3(4.7f, Story, t), plaster, kit);
            Solid("HouseN3", house, new Vector3(-17f, 2.785f, 40.2f), new Vector3(1.4f, 0.67f, t), plaster, kit);
            Solid("HouseE1", house, new Vector3(-11.8f, gable / 2f, 34.95f), new Vector3(t, gable, 2.7f), plaster, kit);
            Solid("HouseE2", house, new Vector3(-11.8f, gable / 2f, 39.05f), new Vector3(t, gable, 2.7f), plaster, kit);
            Solid("HouseE3", house, new Vector3(-11.8f, 0.51f, 37f), new Vector3(t, 1.02f, 1.4f), plaster, kit);
            Solid("HouseE4", house, new Vector3(-11.8f, (2.74f + gable) / 2f, 37f), new Vector3(t, gable - 2.74f, 1.4f), plaster, kit);
            Solid("HouseW", house, new Vector3(-20.2f, gable / 2f, 37f), new Vector3(t, gable, 6.8f), plaster, kit);
            // Roof slopes: pigs that land up there slide off (camera ignores them).
            const float rise = 4.6f, run = 3.6f;
            float angle = Mathf.Atan2(rise, run) * Mathf.Rad2Deg, slope = Mathf.Sqrt(rise * rise + run * run);
            foreach (float side in new[] { -1f, 1f })
                PassThrough(Invisible(Block("RoofSlope", house, new Vector3(-16f, Story + 0.1f + rise / 2f, 37f + side * run / 2f),
                    new Vector3(9.7f, 0.3f, slope), null, new Vector3(side * angle, 0f, 0f))));

            if (kit)
            {
                var look = new GameObject("House (kit)").transform;
                look.SetParent(house, false);
                KitHouse(look, -20f, -12f, 34f, 40f, 1, (side, i, _) => side switch
                {
                    0 => i == 2 ? "Wall_Plaster_Door_Round" : i == 0 || i == 3 ? "Wall_Plaster_Window_Wide_Round" : "Wall_Plaster_Straight",
                    1 => i == 1 ? "Wall_Plaster_Door_Round" : i == 2 ? "Wall_Plaster_Window_Wide_Round" : "Wall_Plaster_Straight",
                    2 => i == 1 ? "Wall_Plaster_Window_Wide_Round" : "Wall_Plaster_Straight",
                    _ => "Wall_Plaster_Straight",
                }, openWindow: (2, 1));
                Kit.FloorTiles("Floor_WoodDark", look, new Vector2(-20f, 34f), new Vector2(-12f, 40f), 0.02f);
                // Closed shutters on the windows you can't use (the east one's shutter is the network-spawned one).
                foreach (var (x, z, outward) in new[] { (-19f, 34f, Vector3.back), (-13f, 34f, Vector3.back), (-15f, 40f, Vector3.forward) })
                    Kit.Wall("WindowShutters_Wide_Round_Closed", look, new Vector3(x, 0f, z), outward);
                Kit.Wall("DoorFrame_Round_WoodDark", look, new Vector3(-15f, 0f, 34f), Vector3.back);
                Kit.Wall("DoorFrame_Round_WoodDark", look, new Vector3(-17f, 0f, 40f), Vector3.forward);
            }
            else
            {
                Block("HouseRoof", house, new Vector3(-16f, Story + 0.15f, 37f), new Vector3(8.8f, 0.3f, 6.8f), darkWood);
            }

            // Inside: fireplace (where chimney pigs pop out), tables with the keys / pie, Bob's bed (hide under the blanket).
            Part(PrimitiveType.Cube, "Fireplace", house, new Vector3(-19.85f, 0.7f, ChimneyExit.z), new Vector3(0.3f, 1.4f, 1.8f), stone);
            Part(PrimitiveType.Cube, "Embers", house, new Vector3(-19.72f, 0.2f, ChimneyExit.z), new Vector3(0.1f, 0.3f, 1f), Mat("Coals", new Color(1f, 0.35f, 0.1f)));
            PointLight(house, new Vector3(-19.3f, 0.8f, ChimneyExit.z), new Color(1f, 0.55f, 0.25f), 5f, 1.5f);
            PointLight(house, new Vector3(-16f, 2.6f, 37.5f), new Color(1f, 0.85f, 0.6f), 9f, 1.2f);
            Table(house, new Vector3(-13.4f, 0f, 38.8f), wood);
            Table(house, new Vector3(-18.6f, 0f, 38.8f), wood);
            Furnish(house, "chair", new Vector3(-18.6f, 0f, 37.9f), 0f, wood);
            Furnish(house, "chair", new Vector3(-13.4f, 0f, 37.9f), 0f, wood);
            Furnish(house, "shelf", new Vector3(-19.78f, 0f, 37.5f), 90f, wood);
            Part(PrimitiveType.Cube, "Rug", house, new Vector3(-16.2f, 0.035f, 36.6f), new Vector3(2.6f, 0.02f, 1.8f), Mat("Rug", new Color(0.3f, 0.45f, 0.7f)));
            Block("Bed", house, new Vector3(-13.4f, 0.25f, 35.2f), new Vector3(1.3f, 0.5f, 2f), darkWood);
            Part(PrimitiveType.Cube, "Blanket", house, new Vector3(-13.4f, 0.56f, 35.45f), new Vector3(1.35f, 0.14f, 1.5f), Mat("Blanket", new Color(0.75f, 0.2f, 0.2f)));
            Part(PrimitiveType.Cube, "Pillow", house, new Vector3(-13.4f, 0.58f, 34.5f), new Vector3(0.9f, 0.18f, 0.4f), Mat("Lamp", Color.white));
            var bed = new GameObject("BedHideSpot");
            bed.transform.SetParent(house, false);
            bed.transform.position = new Vector3(-13.4f, 0.5f, 35.4f);
            var hide = bed.AddComponent<HideSpot>();
            hide.radius = 0.85f;
            hide.height = 0.9f;
            hide.hint = "Hidden under Bob's blanket!";

            // The front door (network-spawned Gate, channel HouseDoor) slides open while any pig is inside.
            var opener = new GameObject("FrontDoorOpener");
            opener.transform.SetParent(house, false);
            opener.transform.position = new Vector3(-16f, 1.5f, 36.65f); // z 33.5..39.8: the doorway counts, outside doesn't
            var inside = opener.AddComponent<InsideOpener>();
            inside.channel = ChannelIds.HouseDoor;
            inside.size = new Vector3(7.6f, 3f, 6.3f);
            Label(house, "BOB'S HOUSE", new Vector3(-16f, 4.6f, 32.6f), new Color(1f, 0.85f, 0.4f), 0.06f);

            // Chimney + lean-to (roof 2.4 m, reach it from the wagon or the crate) on the west side.
            Solid("Chimney", house, new Vector3(ChimneyTop.x, ChimneyTop.y / 2f, ChimneyTop.z), new Vector3(1f, ChimneyTop.y, 1f), stone, kit);
            if (kit) Kit.Fit("Prop_Chimney", house, new Vector3(ChimneyTop.x, ChimneyTop.y / 2f, ChimneyTop.z), new Vector3(1f, ChimneyTop.y, 1f), -90f);
            Label(house, "CHIMNEY", ChimneyTop + Vector3.up * 1.4f, new Color(1f, 0.85f, 0.4f), 0.04f);
            Block("LeanToRoof", house, new Vector3(-22.25f, 2.25f, 35.5f), new Vector3(3.9f, 0.3f, 5f), darkWood);
            foreach (float z in new[] { 33.2f, 37.8f })
                Block("LeanToPost", house, new Vector3(-24f, 1.05f, z), new Vector3(0.2f, 2.1f, 0.2f), darkWood);
            Solid("Wagon", house, new Vector3(-26f, 0.6f, 35.6f), new Vector3(1.9f, 1.2f, 4f), wood, kit);
            if (kit) Kit.Fit("Prop_Wagon", house, new Vector3(-26f, 0.765f, 35.6f), new Vector3(1.95f, 1.53f, 4f), 0f, keepLongSide: true);
        }

        /// <summary>
        /// Kit walls for a box building (inner faces on x0..x1 / z0..z1, lengths multiples of 2) with window frames, corner
        /// posts, a tiled roof with the ridge along x and brick gables. pick(side 0=S 1=N 2=E 3=W, slot, story) → piece
        /// (null = gap); openWindow = a window left without frame/glass. The roof hides while you (camera or pig) are inside.
        /// </summary>
        static void KitHouse(Transform parent, float x0, float x1, float z0, float z1, int stories, System.Func<int, int, int, string> pick,
            (int side, int slot)? openWindow = null)
        {
            float top = stories * Story;
            NoGrassRect(x0 - 0.6f, z0 - 0.6f, x1 + 0.6f, z1 + 0.6f);
            var sides = new (Vector3 a, Vector3 b, Vector3 outward)[]
            {
                (new Vector3(x0, 0f, z0), new Vector3(x1, 0f, z0), Vector3.back), (new Vector3(x0, 0f, z1), new Vector3(x1, 0f, z1), Vector3.forward),
                (new Vector3(x1, 0f, z0), new Vector3(x1, 0f, z1), Vector3.right), (new Vector3(x0, 0f, z0), new Vector3(x0, 0f, z1), Vector3.left),
            };
            for (int side = 0; side < sides.Length; side++)
            {
                int n = side;
                var (a, b, outward) = sides[side];
                Kit.WallRun(parent, a, b, outward, stories, (i, s) => pick(n, i, s));
                // Frames (with glass) in the window holes - except a window pigs climb through.
                Kit.WallRun(parent, a, b, outward, stories, (i, s) =>
                    pick(n, i, s) is string piece && piece.Contains("Window_Wide_Round")
                    && !(openWindow is { } open && open.side == n && open.slot == i) ? "Window_Wide_Round1" : null);
            }
            foreach (float x in new[] { x0 - 0.2f, x1 + 0.2f })
            foreach (float z in new[] { z0 - 0.2f, z1 + 0.2f })
                Kit.Fit("Corner_Exterior_Wood", parent, new Vector3(x, top / 2f, z), new Vector3(0.45f, top, 0.45f), 0f);

            var roof = new GameObject("Roof").transform;
            roof.SetParent(parent, false);
            float length = x1 - x0, span = z1 - z0, xc = (x0 + x1) / 2f, zc = (z0 + z1) / 2f;
            // Roof_RoundTiles_6x8: 8.25 wide (6 m house + eaves), 5.67 high, 0.78 of it below the wall top.
            float k = span / 6f;
            Kit.Fit("Roof_RoundTiles_6x8", roof, new Vector3(xc, top - 0.78f * k + 5.67f * k / 2f, zc),
                new Vector3(length + 1.7f, 5.67f * k, span + 2.25f * k), 90f, keepLongSide: length + 1.7f > span + 2.25f * k);
            foreach (float side in new[] { -1f, 1f })
                Kit.Fit("Roof_Front_Brick6", roof, new Vector3(side < 0f ? x0 - 0.2f : x1 + 0.2f, top - 0.13f * k + 4.52f * k / 2f, zc),
                    new Vector3(0.4f, 4.52f * k, span + 0.7f * k), side * 90f, keepLongSide: true);
            var hider = roof.gameObject.AddComponent<RoofHider>();
            hider.center = new Vector3(xc, (top + 6f * k) / 2f, zc);
            hider.size = new Vector3(length + 1f, top + 6f * k + 1f, span + 1f);
            hider.pigCenter = new Vector3(xc, top / 2f, zc); // a pig up on the roof doesn't count as inside
            hider.pigSize = new Vector3(length + 0.2f, top + 0.5f, span + 0.2f);
        }

        /// <summary>The getaway truck (static), its bed = the EscapeZone. The ignition is network-spawned (FarmSpawnPoints).</summary>
        static void BuildTruck(Transform r)
        {
            var paint = Mat("Truck", new Color(0.2f, 0.45f, 0.75f));
            var dark = Mat("Wheel", new Color(0.12f, 0.12f, 0.13f));
            var glass = Mat("TruckWindow", new Color(0.55f, 0.75f, 0.9f));
            var wood = Mat("Crate", new Color(0.8f, 0.62f, 0.38f));
            var o = TruckPos;
            NoGrassRect(o.x - 2.2f, o.z - 4.5f, o.x + 2.2f, o.z + 6.4f);
            var truck = new GameObject("Truck").transform;
            truck.SetParent(r, false);
            Block("TruckChassis", truck, o + new Vector3(0f, 0.35f, 1f), new Vector3(3.4f, 0.5f, 7f), dark);
            Block("TruckBed", truck, o + new Vector3(0f, 0.75f, 0f), new Vector3(3.6f, 0.3f, 4f), wood);
            Block("TruckSideW", truck, o + new Vector3(-1.75f, 1.2f, 0f), new Vector3(0.1f, 0.6f, 4f), paint);
            Block("TruckSideE", truck, o + new Vector3(1.75f, 1.2f, 0f), new Vector3(0.1f, 0.6f, 4f), paint);
            Block("TruckBedFront", truck, o + new Vector3(0f, 1.2f, 1.95f), new Vector3(3.6f, 0.6f, 0.1f), paint);
            Block("TruckCab", truck, o + new Vector3(0f, 1.4f, 3.3f), new Vector3(3.6f, 2f, 2.4f), paint);
            Block("TruckHood", truck, o + new Vector3(0f, 0.95f, 5.2f), new Vector3(3.4f, 1.1f, 1.5f), paint);
            Part(PrimitiveType.Cube, "TruckWindowBack", truck, o + new Vector3(0f, 1.9f, 2.08f), new Vector3(2.8f, 0.7f, 0.05f), glass);
            Part(PrimitiveType.Cube, "TruckWindowFront", truck, o + new Vector3(0f, 1.9f, 4.52f), new Vector3(3f, 0.7f, 0.05f), glass);
            foreach (var (x, z) in new[] { (-1.75f, -1.2f), (1.75f, -1.2f), (-1.75f, 4.3f), (1.75f, 4.3f) })
                Part(PrimitiveType.Cylinder, "Wheel", truck, o + new Vector3(x, 0.45f, z), new Vector3(0.9f, 0.15f, 0.9f), dark, new Vector3(0f, 0f, 90f));
            foreach (float x in new[] { -1.25f, 1.25f })
                Part(PrimitiveType.Sphere, "Headlamp", truck, o + new Vector3(x, 0.95f, 5.95f), new Vector3(0.35f, 0.3f, 0.1f), Mat("Lamp", Color.white));
            Part(PrimitiveType.Cylinder, "ExhaustPipe", truck, o + TruckExhaust + new Vector3(0f, 0f, 0.25f), new Vector3(0.12f, 0.3f, 0.12f), dark, new Vector3(90f, 0f, 0f));
            // Tailgate down = ramp into the bed.
            const float rise = 0.9f, run = 2f;
            float angle = Mathf.Atan2(rise, run) * Mathf.Rad2Deg;
            float length = Mathf.Sqrt(rise * rise + run * run);
            Block("TruckRamp", truck, o + new Vector3(0f, rise / 2f - 0.1f, -3f), new Vector3(3.2f, 0.2f, length), wood, new Vector3(-angle, 0f, 0f));

            // A real truck model if a car pack was added (the boxes above stay as its colliders).
            var models = ArtSetup.FindModels(new[] { "truck", "pickup" }, new[] { "fire", "garbage", "police", "ambulance", "flat", "delivery", "tow" });
            if (models.Count > 0)
            {
                var model = models.Find(m => m.name.ToLowerInvariant() == "truck") ?? models[0];
                foreach (var rend in truck.GetComponentsInChildren<MeshRenderer>())
                    if (rend.name != "TruckRamp") Object.DestroyImmediate(rend);
                MakeStatic(FitModel(model, truck, "TruckModel", 2.9f, truck.InverseTransformPoint(o + new Vector3(0f, 0f, 1.2f)), FrontYaw(model), null, out _));
            }

            var zone = new GameObject("EscapeZone");
            zone.transform.SetParent(truck, false);
            zone.transform.position = o + new Vector3(0f, 1.9f, 0f);
            zone.AddComponent<EscapeZone>().size = new Vector3(3.4f, 2f, 3.8f);
            Label(truck, "GETAWAY TRUCK", o + new Vector3(0f, 3.6f, 2f), new Color(0.5f, 1f, 0.5f), 0.07f);
        }

        /// <summary>Spawn points in the farmyard, the gatehouse, the garage and Bob's house.</summary>
        static void FarmSpawnPoints(Transform spawnRoot, List<NetSpawnPoint> points, PrefabSet p)
        {
            // The pigs start in their sty east of the barn.
            for (int i = 0; i < 4; i++)
                points.Add(SpawnPoint(spawnRoot, $"Pig {i + 1}", p.pig, new Vector3(28f + i * 1.8f, 1f, -7f), rotation: Quaternion.Euler(0f, -60f, 0f)));

            // Gatehouse (mission 1): electric fence (fuse box in the barn), exit gate (padlock + generator + 3 bullseyes).
            points.Add(SpawnPoint(spawnRoot, "Padlock", p.padlock, new Vector3(GateX - 4f, 0f, GateZ0 - 1.5f), channel: ChannelIds.Padlock));
            points.Add(SpawnPoint(spawnRoot, "ElectricFence", p.fence, new Vector3(GateX, 1.55f, GateZ0 + 1.2f), channel: ChannelIds.Fence));
            points.Add(SpawnPoint(spawnRoot, "ExitGate", p.exitGate, new Vector3(GateX, 1.55f, GateZ1 - 1.4f)));
            int[] targets = { ChannelIds.Target1, ChannelIds.Target2, ChannelIds.Target3 };
            for (int i = 0; i < BullseyePoles.Length; i++)
            {
                Vector3 foot = BullseyePoles[i], face = new Vector3(-foot.x, 0f, 40f - foot.z).normalized; // facing the middle of the farm
                points.Add(SpawnPoint(spawnRoot, $"Bullseye {i + 1}", p.target, foot + new Vector3(0f, 4.6f, 0f) + face * 0.3f, channel: targets[i],
                    rotation: Quaternion.LookRotation(face)));
            }

            // Bob's house (mission 2): chimney chute, front door (opens from inside), shuttered window + its bullseye, boarded back door.
            points.Add(SpawnPoint(spawnRoot, "ChimneyChute", p.chimney, ChimneyTop));
            points.Add(SpawnPoint(spawnRoot, "HouseDoor", p.houseDoor, new Vector3(-15f, 1.225f, 33.8f), channel: ChannelIds.HouseDoor));
            points.Add(SpawnPoint(spawnRoot, "WindowShutter", p.shutter, new Vector3(-11.8f, 1.88f, 37f), channel: ChannelIds.HouseWindow,
                rotation: Quaternion.Euler(0f, 90f, 0f)));
            points.Add(SpawnPoint(spawnRoot, "WindowBullseye", p.target, new Vector3(-11.5f, 2.3f, 35f), channel: ChannelIds.HouseWindow,
                rotation: Quaternion.Euler(0f, 90f, 0f)));
            points.Add(SpawnPoint(spawnRoot, "BoardedBackDoor", p.boards, new Vector3(-17f, 1.5f, 40.55f)));
            points.Add(SpawnPoint(spawnRoot, "TruckKeys", p.truckKeys, new Vector3(-13.4f, 1f, 38.8f)));
            points.Add(SpawnPoint(spawnRoot, "Pie", p.pie, new Vector3(-18.6f, 1f, 38.8f)));
            points.Add(SpawnPoint(spawnRoot, "PiggyBank", p.piggyBank, new Vector3(-17.5f, 0.5f, 36.8f)));
            points.Add(SpawnPoint(spawnRoot, "Ignition", p.ignition, TruckPos + IgnitionOffset, channel: ChannelIds.Truck));

            // Garage (mission 3): both plates at once → the door opens for good → fuel can → the truck's fuel cap.
            points.Add(SpawnPoint(spawnRoot, "GarageDoor", p.garageDoor, new Vector3(-37.8f, 1.55f, 0f), channel: ChannelIds.GarageDoor));
            points.Add(SpawnPoint(spawnRoot, "GaragePlate A", p.gatePlate, GaragePlateA, channel: ChannelIds.GatePlateA));
            points.Add(SpawnPoint(spawnRoot, "GaragePlate B", p.gatePlate, GaragePlateB, channel: ChannelIds.GatePlateB));
            points.Add(SpawnPoint(spawnRoot, "FuelCan", p.fuelCan, new Vector3(-42.5f, 0.4f, -0.5f)));
            points.Add(SpawnPoint(spawnRoot, "FuelCap", p.fuelCap, TruckPos + FuelCapOffset, channel: ChannelIds.Fuel));

            // Animals, props, ammo.
            foreach (var pos in new[] { new Vector3(20f, 0.35f, 24f), new Vector3(22f, 0.35f, 25f), new Vector3(20.5f, 0.35f, 21.5f), new Vector3(45f, 0.35f, -7f) })
                points.Add(SpawnPoint(spawnRoot, "Chicken", p.chicken, pos));
            points.Add(SpawnPoint(spawnRoot, "Calf", p.calf, new Vector3(34f, 0.55f, 55f)));
            foreach (var pos in new[] { new Vector3(9f, 0.55f, 30f), new Vector3(-9f, 0.55f, 38f), new Vector3(-30f, 0.55f, 60f), new Vector3(24f, 0.55f, -8f),
                         new Vector3(-48f, 0.55f, 30f), new Vector3(46f, 0.55f, 70f) })
                points.Add(SpawnPoint(spawnRoot, "Bucket", p.bucket, pos));
            foreach (var pos in new[]
                     {
                         new Vector3(-25f, 0.5f, 41f), new Vector3(-26.3f, 0.5f, 41.4f), new Vector3(10f, 0.5f, 70f), new Vector3(-28f, 0.5f, 76f),
                         new Vector3(48f, 0.5f, 30f), new Vector3(-36f, 0.5f, -10f), new Vector3(-48f, 0.5f, 72f), new Vector3(23f, 0.5f, -12f),
                     })
                points.Add(SpawnPoint(spawnRoot, "Crate", p.crate, pos));
            foreach (var pos in new[] { new Vector3(6f, 0.6f, 48.5f), new Vector3(-8f, 0.6f, 24f), new Vector3(-36.5f, 0.6f, 5f), new Vector3(52f, 0.6f, 10f) })
                points.Add(SpawnPoint(spawnRoot, "Barrel", p.barrel, pos));
            points.Add(SpawnPoint(spawnRoot, "BreakableCrate", p.weakCrate, new Vector3(2f, 0.45f, 50f), contents: p.corn));
            points.Add(SpawnPoint(spawnRoot, "BreakableCrate", p.weakCrate, new Vector3(-10f, 0.45f, 32f), contents: p.apple));
            points.Add(SpawnPoint(spawnRoot, "BreakableCrate", p.weakCrate, new Vector3(30f, 0.45f, 76f), contents: p.egg));
            points.Add(SpawnPoint(spawnRoot, "BreakableCrate", p.weakCrate, new Vector3(44f, 0.45f, 20f), contents: p.corn));
            points.Add(SpawnPoint(spawnRoot, "BreakableCrate", p.weakCrate, new Vector3(-50f, 0.45f, 50f), contents: p.apple));
            AmmoPile(spawnRoot, points, p.apple, new Vector3(29f, 0.2f, -10.5f), 4); // in the sty: Armed starts with something to shoot
            AmmoPile(spawnRoot, points, p.corn, new Vector3(19.5f, 0.2f, 23f), 3);
            AmmoPile(spawnRoot, points, p.egg, new Vector3(22.5f, 0.2f, 21f), 2);
            AmmoPile(spawnRoot, points, p.bolt, new Vector3(57.2f, 1.2f, 5f), 3);                 // on the workshop's workbench
            AmmoPile(spawnRoot, points, p.corn, new Vector3(58.5f, Story + 0.3f, 24.8f), 2);      // stable loft

            // Loot + coins (team money for the shop later).
            points.Add(SpawnPoint(spawnRoot, "GoldenEgg", p.goldenEgg, new Vector3(24.4f, 3f, 21.6f))); // on the coop roof
            points.Add(SpawnPoint(spawnRoot, "GoldenEgg", p.goldenEgg, new Vector3(48f, 3f, -10f)));     // on the second coop
            points.Add(SpawnPoint(spawnRoot, "PiggyBank", p.piggyBank, new Vector3(55.5f, Story + 0.5f, 25f))); // stable loft
            foreach (var pos in new[]
                     {
                         new Vector3(-16f, 0.7f, 37f), new Vector3(-16f, 0.7f, 42.5f), new Vector3(-38f, 0.7f, 58f), new Vector3(40f, 0.7f, 62f),
                         new Vector3(-31f, 0.7f, 84f), new Vector3(-37f, 0.7f, 31f), new Vector3(36f, 0.7f, 80f), new Vector3(9f, 0.7f, 61f),
                         new Vector3(-26f, 1.85f, 35.6f), new Vector3(0f, 0.7f, 57f), new Vector3(44f, 0.7f, 25f), new Vector3(-56f, 0.7f, 26.5f),
                         new Vector3(55f, 0.7f, 30f), new Vector3(60f, 0.7f, 70f), new Vector3(-58f, 0.7f, 80f), new Vector3(30f, 0.7f, -14f),
                         new Vector3(-50f, 0.7f, -10f), new Vector3(2f, 0.7f, 88f), new Vector3(-20f, 0.7f, 70f), new Vector3(28f, 0.7f, 92f),
                         new Vector3(-41f, 0.7f, 2f), new Vector3(-55.5f, 1.5f, 21.2f), new Vector3(54f, 0.7f, 5f), new Vector3(52f, Story + 0.7f, 23f),
                         new Vector3(58f, 0.7f, 19.8f),
                     })
                points.Add(SpawnPoint(spawnRoot, "Coin", p.coin, pos));
            foreach (var pos in new[]
                     {
                         ChimneyTop + Vector3.up * 0.7f, new Vector3(-22.5f, 2.95f, 34.4f), TruckPos + new Vector3(0f, 2.95f, 3.3f),
                         new Vector3(34.5f, 2.4f, -3.2f), new Vector3(0f, 3.3f, 54f), new Vector3(-52.3f, 2.6f, 22.6f),
                     })
                points.Add(SpawnPoint(spawnRoot, "BigCoin", p.bigCoin, pos));
        }

        // ---------- farm helpers ----------

        /// <summary>Flat mud puddle: pigs lying in it are hidden from Bob.</summary>
        static void Mud(Transform parent, Vector3 position, float radius)
        {
            var mud = Part(PrimitiveType.Cylinder, "MudPuddle", parent, position + Vector3.up * 0.02f, new Vector3(radius * 2f, 0.01f, radius * 2f),
                Mat("Mud", new Color(0.35f, 0.24f, 0.14f)));
            NoGrassAround(position, new Vector3(radius * 2f, 0f, radius * 2f), 0.2f);
            var spot = mud.AddComponent<HideSpot>();
            spot.radius = radius;
            spot.height = 1f;
            spot.hint = "Hidden in the mud";
        }

        /// <summary>Apple tree: trunk collider (Heavy's slam shakes apples down - AppleTree), leaves + apples for the look.</summary>
        static void AppleTreeAt(Transform parent, Vector3 position)
        {
            var root = new GameObject("AppleTree").transform;
            root.SetParent(parent, false);
            root.position = position;
            root.gameObject.AddComponent<AppleTree>();
            Block("Trunk", root, new Vector3(0f, 1.5f, 0f), new Vector3(0.5f, 1.5f, 0.5f), Mat("Trunk", new Color(0.4f, 0.27f, 0.15f)), default, PrimitiveType.Cylinder);
            Part(PrimitiveType.Sphere, "Leaves", root, new Vector3(0f, 3.6f, 0f), new Vector3(3f, 2.6f, 3f), Mat("Leaves", new Color(0.25f, 0.55f, 0.2f)));
            var red = Mat("Apple", new Color(0.85f, 0.12f, 0.1f));
            for (int i = 0; i < 6; i++)
            {
                float a = i * 60f * Mathf.Deg2Rad;
                Part(PrimitiveType.Sphere, "AppleLook", root, new Vector3(Mathf.Cos(a) * 1.35f, 3.1f + (i % 2) * 0.6f, Mathf.Sin(a) * 1.35f), Vector3.one * 0.25f, red);
            }
        }

        static void Table(Transform parent, Vector3 floorCenter, Material wood)
        {
            Block("TableTop", parent, floorCenter + new Vector3(0f, 0.8f, 0f), new Vector3(1.3f, 0.1f, 0.9f), wood);
            foreach (var (x, z) in new[] { (-0.55f, -0.35f), (0.55f, -0.35f), (-0.55f, 0.35f), (0.55f, 0.35f) })
                Block("TableLeg", parent, floorCenter + new Vector3(x, 0.375f, z), new Vector3(0.1f, 0.75f, 0.1f), wood);
        }

        /// <summary>Static (not grabbable) crate: a step to climb on.</summary>
        static void StaticCrate(Transform parent, Vector3 floorCenter, Material wood, bool kit)
        {
            Vector3 c = floorCenter + Vector3.up * 0.53f;
            Solid("StaticCrate", parent, c, Vector3.one * 1.06f, wood, kit);
            if (kit) Kit.Fit("Prop_Crate", parent, c, Vector3.one * 1.06f, 0f);
        }

        /// <summary>Outside the fence, for the eye only (no colliders): trees, a neighbour's big barn, village cottages.</summary>
        static void Scenery(Transform r)
        {
            var scenery = new GameObject("Scenery").transform;
            scenery.SetParent(r, false);
            foreach (var (x, z, s) in new[]
                     {
                         (-70f, 0f, 1.3f), (-72f, 20f, 1.2f), (-69f, 44f, 1.4f), (-74f, 62f, 1.1f), (-70f, 86f, 1.5f), (-78f, 10f, 1.6f),
                         (-82f, 50f, 1.3f), (-76f, 100f, 1.7f), (70f, -6f, 1.2f), (72f, 14f, 1.5f), (69f, 60f, 1.3f), (74f, 76f, 1.4f),
                         (70f, 96f, 1.2f), (84f, 40f, 1.6f), (80f, 22f, 1.3f), (-50f, 108f, 1.5f), (-24f, 106f, 1.2f), (0f, 110f, 1.4f),
                         (40f, 106f, 1.3f), (56f, 112f, 1.6f), (-12f, -42f, 1.2f), (14f, -43f, 1.3f), (26f, -22f, 1.5f), (-25f, -26f, 1.1f),
                         (-44f, -24f, 1.4f), (44f, -26f, 1.2f), (60f, -22f, 1.5f), (-60f, -24f, 1.3f),
                     })
                Tree(scenery, new Vector3(x, 0f, z), s);
            var red = Mat("BarnWall", new Color(0.65f, 0.18f, 0.15f));
            var stone = Mat("Stone", new Color(0.5f, 0.5f, 0.52f));
            FarmBuildingAt(scenery, "BigBarn", new Vector3(78f, 0f, 32f), -90f, 10f, new Vector3(10f, 10f, 10f), red, collide: false);
            FarmBuildingAt(scenery, "Silo", new Vector3(76f, 0f, 46f), 0f, 12f, new Vector3(3f, 12f, 3f), stone, collide: false);
            FarmBuildingAt(scenery, "Windmill", new Vector3(-80f, 0f, 74f), 90f, 13f, new Vector3(3f, 11f, 3f), stone, colliderXZ: 0.35f, spin: true, collide: false);
            FarmBuildingAt(scenery, "SmallBarn", new Vector3(-40f, 0f, 116f), 0f, 6.4f, new Vector3(8f, 6f, 8f), red, collide: false);
            if (!Kit.Available) return;
            SceneryCottage(scenery, -82f, -74f, 26f, 32f, 2);
            SceneryCottage(scenery, 72f, 80f, 52f, 58f, 1);
            SceneryCottage(scenery, 24f, 32f, 106f, 112f, 2);
        }

        // ---------- models: farm buildings, animals, trees, vehicles, crops ----------

        /// <summary>
        /// A Quaternius farm building standing at pos (uniform scale to height, turned by yaw) with a box collider from its
        /// bounds (x/z shrunk by colliderXZ, e.g. windmill blades), or a plain block when the pack is missing. Returns the bounds.
        /// </summary>
        static Bounds FarmBuildingAt(Transform parent, string name, Vector3 pos, float yaw, float height, Vector3 fallbackSize,
            Material fallback, float colliderXZ = 1f, bool spin = false, bool collide = true)
        {
            var model = ArtSetup.FarmBuilding(name);
            if (model == null)
            {
                var block = Block(name, parent, pos + Vector3.up * fallbackSize.y / 2f, fallbackSize, fallback);
                if (!collide) Object.DestroyImmediate(block.GetComponent<Collider>());
                NoGrassAround(pos, fallbackSize);
                return new Bounds(pos + Vector3.up * fallbackSize.y / 2f, fallbackSize);
            }
            var go = FitModel(model, parent, name, height, parent.InverseTransformPoint(pos), yaw, null, out var bounds);
            NoGrassAround(bounds.center, bounds.size * colliderXZ);
            if (spin) go.AddComponent<Spinner>(); // moving parts can't be static-batched
            else MakeStatic(go);
            if (collide)
                Invisible(Block(name + "Collider", parent, bounds.center, new Vector3(bounds.size.x * colliderXZ, bounds.size.y, bounds.size.z * colliderXZ), null));
            return bounds;
        }

        static void MakeStatic(GameObject go)
        {
            foreach (var t in go.GetComponentsInChildren<Transform>())
                GameObjectUtility.SetStaticEditorFlags(t.gameObject, StaticEditorFlags.BatchingStatic);
        }

        /// <summary>A Cube Pets animal standing around for the look (idle animation); big ones (cows) get an invisible box to bump into.</summary>
        static void DecorAnimal(Transform parent, string animal, Vector3 pos, float yaw, float height)
        {
            var go = AnimalVisual(animal, parent, height, parent.InverseTransformPoint(pos), 1f, 3f, out var bounds);
            if (go == null) return;
            go.transform.RotateAround(pos, Vector3.up, yaw); // FitModel centred the model's bounds on pos
            if (height < 1f) return;
            Invisible(Block(animal + "Collider", parent, pos + Vector3.up * bounds.size.y / 2f,
                new Vector3(bounds.size.x * 0.8f, bounds.size.y, bounds.size.z * 0.8f), null, new Vector3(0f, yaw, 0f)));
        }

        static List<GameObject> treeModels;

        /// <summary>A tree: a model from an added nature pack (any file named *tree* / pine / oak / birch), else a primitive one.</summary>
        static void Tree(Transform parent, Vector3 position, float size = 1f, bool collide = false)
        {
            if (collide) // trunk (inside the farm: pigs and Bob bump into it)
                Invisible(Block("TreeTrunkCollider", parent, position + Vector3.up * 1.5f * size, new Vector3(0.6f, 1.5f, 0.6f) * size, null, default, PrimitiveType.Cylinder));
            treeModels ??= ArtSetup.FindModels(new[] { "tree", "pine", "oak", "birch", "willow" }, new[] { "street", "stump", "log", "dead" });
            if (treeModels.Count > 0)
            {
                int pick = Mathf.Abs(Mathf.RoundToInt(position.x * 7f + position.z * 13f)) % treeModels.Count;
                var go = FitModel(treeModels[pick], parent, "Tree", 6f * size, parent.InverseTransformPoint(position), (position.x * 37f) % 360f, null, out _);
                MakeStatic(go);
                return;
            }
            Part(PrimitiveType.Cylinder, "Trunk", parent, position + Vector3.up * 1.5f * size, new Vector3(0.5f, 1.5f, 0.5f) * size, Mat("Trunk", new Color(0.4f, 0.27f, 0.15f)));
            Part(PrimitiveType.Sphere, "Leaves", parent, position + Vector3.up * 3.6f * size, new Vector3(3f, 2.6f, 3f) * size, Mat("Leaves", new Color(0.25f, 0.55f, 0.2f)));
        }

        /// <summary>Bob's tractor (decor + obstacle) if a pack with a tractor model was added.</summary>
        static void TractorAt(Transform parent, Vector3 pos, float yaw)
        {
            var models = ArtSetup.FindModels(new[] { "tractor" }, new[] { "police", "shovel" });
            if (models.Count == 0) return;
            var go = FitModel(models[0], parent, "Tractor", 3f, parent.InverseTransformPoint(pos), yaw + FrontYaw(models[0]), null, out var bounds);
            MakeStatic(go);
            Invisible(Block("TractorCollider", parent, bounds.center, bounds.size * 0.9f, null));
        }

        /// <summary>Crop rows in a field if a pack with crops was added (corn, wheat, pumpkins...): decor, pigs walk through.</summary>
        static void Crops(Transform parent, Vector2 min, Vector2 max)
        {
            var models = ArtSetup.FindModelsByWord(new[] { "corn", "wheat", "crop", "pumpkin", "carrot", "cabbage", "lettuce" });
            Part(PrimitiveType.Cube, "Field", parent, new Vector3((min.x + max.x) / 2f, 0.012f, (min.y + max.y) / 2f),
                new Vector3(max.x - min.x, 0.02f, max.y - min.y), Mat("Field", new Color(0.42f, 0.3f, 0.18f)));
            NoGrassRect(min.x, min.y, max.x, max.y);
            if (models.Count == 0) return;
            int i = 0;
            for (float x = min.x + 1f; x < max.x; x += 2f)
            for (float z = min.y + 1f; z < max.y; z += 1.6f, i++)
                MakeStatic(FitModel(models[i % models.Count], parent, "Crop", 1.4f, parent.InverseTransformPoint(new Vector3(x, 0f, z)), (i * 47f) % 360f, null, out _));
        }

        /// <summary>
        /// Extra yaw so a vehicle model faces +Z: its cab (the tallest part) is at the front. Measured from the mesh vertices,
        /// so it works whatever way the file was exported.
        /// </summary>
        static float FrontYaw(GameObject model)
        {
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(model);
            try
            {
                var points = new List<Vector3>();
                foreach (var mf in instance.GetComponentsInChildren<MeshFilter>())
                    if (mf.sharedMesh != null)
                        foreach (var v in mf.sharedMesh.vertices) points.Add(mf.transform.TransformPoint(v));
                if (points.Count == 0) return 0f;
                var b = new Bounds(points[0], Vector3.zero);
                foreach (var pt in points) b.Encapsulate(pt);
                bool alongX = b.size.x > b.size.z;
                Vector3 top = Vector3.zero;
                int n = 0;
                foreach (var pt in points)
                    if (pt.y > b.min.y + b.size.y * 0.75f) { top += pt; n++; }
                if (n == 0) return alongX ? 90f : 0f;
                top /= n;
                return alongX ? (top.x > b.center.x ? -90f : 90f) : (top.z > b.center.z ? 0f : 180f);
            }
            finally
            {
                Object.DestroyImmediate(instance);
            }
        }

        static void SceneryCottage(Transform parent, float x0, float x1, float z0, float z1, int stories)
        {
            var root = new GameObject("Cottage").transform;
            root.SetParent(parent, false);
            KitHouse(root, x0, x1, z0, z1, stories, (side, i, story) =>
                story == 0 && side == 0 && i == 1 ? "Wall_Plaster_Door_RoundInset"
                : story == 0 ? (i % 2 == 0 ? "Wall_UnevenBrick_Straight" : "Wall_UnevenBrick_Window_Wide_Round")
                : i % 2 == 1 ? "Wall_Plaster_Window_Wide_Round" : "Wall_Plaster_WoodGrid");
        }
    }
}
