using System.Collections.Generic;
using UnityEngine;

namespace Porkour.EditorTools
{
    /// <summary>
    /// The farmyard north of the barn (x -28..28, z 15.4..60): Bob's house with the truck keys (3 ways in: chimney,
    /// boarded back door, shuttered window; the front door opens from inside), the getaway truck (ignition), chicken pen,
    /// calf, apple trees, mud, hay. Medieval kit for the look, invisible boxes for the gameplay.
    /// </summary>
    public static partial class PorkourBuilder
    {
        /// <summary>The truck's origin: centre of its bed, on the ground. It faces +Z, tailgate ramp to the south.</summary>
        static readonly Vector3 TruckPos = new(14f, 0f, 44f);
        /// <summary>From TruckPos: the ignition post by the cab door, the exhaust under the back.</summary>
        static readonly Vector3 IgnitionOffset = new(2.1f, 0f, 3.3f);
        static readonly Vector3 TruckExhaust = new(1.8f, 0.3f, -2.75f);
        /// <summary>Bob's chimney (west of the house) and where a pig pops out (the fireplace inside).</summary>
        static readonly Vector3 ChimneyTop = new(-20.85f, 5.72f, 35f);
        static readonly Vector3 ChimneyExit = new(-19.2f, 0.6f, 35.3f);

        static void BuildFarmyard(Transform r)
        {
            var wood = Mat("Crate", new Color(0.8f, 0.62f, 0.38f));
            var darkWood = Mat("RoofWood", new Color(0.33f, 0.22f, 0.14f));
            var hay = Mat("Hay", new Color(0.93f, 0.8f, 0.35f));
            var dirt = Mat("Dirt", new Color(0.5f, 0.38f, 0.24f));
            bool kit = Kit.Available;
            var farm = new GameObject("Farmyard").transform;
            farm.SetParent(r, false);

            // Invisible walls + roof (14 m) around the farmyard; a wooden fence for the eye.
            const float t = 0.4f, wallH = 14f;
            Boundary(farm, "FarmW", new Vector3(-28.2f, wallH / 2f, 37.7f), new Vector3(t, wallH, 44.6f));
            Boundary(farm, "FarmE", new Vector3(28.2f, wallH / 2f, 37.7f), new Vector3(t, wallH, 44.6f));
            Boundary(farm, "FarmN", new Vector3(0f, wallH / 2f, 60.2f), new Vector3(56.8f, wallH, t));
            Boundary(farm, "FarmSW", new Vector3(-24.2f, wallH / 2f, 15.2f), new Vector3(7.6f, wallH, t));
            Boundary(farm, "FarmSE", new Vector3(24.2f, wallH / 2f, 15.2f), new Vector3(7.6f, wallH, t));
            Boundary(farm, "FarmRoof", new Vector3(0f, wallH + 0.25f, 37.7f), new Vector3(56.8f, 0.5f, 45f));
            FenceRun(farm, new Vector3(-28f, 0f, 15.4f), new Vector3(-28f, 0f, 60f), wood);
            FenceRun(farm, new Vector3(28f, 0f, 15.4f), new Vector3(28f, 0f, 60f), wood);
            FenceRun(farm, new Vector3(-28f, 0f, 60f), new Vector3(28f, 0f, 60f), wood);
            FenceRun(farm, new Vector3(-28f, 0f, 15.4f), new Vector3(-20.4f, 0f, 15.4f), wood);
            FenceRun(farm, new Vector3(20.4f, 0f, 15.4f), new Vector3(28f, 0f, 15.4f), wood);

            BobsHouse(farm, kit);
            BuildTruck(farm);
            Label(farm, "BOB'S FARM", new Vector3(0f, 4.6f, 20.5f), new Color(1f, 0.85f, 0.4f), 0.08f);

            // Dirt paths: barn exit → house / truck.
            Part(PrimitiveType.Cube, "Path", farm, new Vector3(0f, 0.01f, 25.5f), new Vector3(3f, 0.02f, 12f), dirt);
            Part(PrimitiveType.Cube, "Path", farm, new Vector3(-8.75f, 0.01f, 30.5f), new Vector3(14.5f, 0.02f, 2.5f), dirt);
            Part(PrimitiveType.Cube, "Path", farm, new Vector3(7f, 0.01f, 30.5f), new Vector3(11f, 0.02f, 2.5f), dirt);
            Part(PrimitiveType.Cube, "Path", farm, TruckPos + new Vector3(0f, 0.012f, -0.5f), new Vector3(6f, 0.02f, 17f), dirt);

            // Chicken pen (x 18..26, z 20..26): low fence with a gate gap in the north side.
            Solid("PenW", farm, new Vector3(18f, 0.45f, 23f), new Vector3(0.15f, 0.9f, 6f), wood, kit);
            Solid("PenE", farm, new Vector3(26f, 0.45f, 23f), new Vector3(0.15f, 0.9f, 6f), wood, kit);
            Solid("PenS", farm, new Vector3(22f, 0.45f, 20f), new Vector3(8f, 0.9f, 0.15f), wood, kit);
            Solid("PenN1", farm, new Vector3(19.5f, 0.45f, 26f), new Vector3(3f, 0.9f, 0.15f), wood, kit);
            Solid("PenN2", farm, new Vector3(24.5f, 0.45f, 26f), new Vector3(3f, 0.9f, 0.15f), wood, kit);
            if (kit)
            {
                FenceRun(farm, new Vector3(18f, 0f, 20f), new Vector3(18f, 0f, 26f), wood);
                FenceRun(farm, new Vector3(26f, 0f, 20f), new Vector3(26f, 0f, 26f), wood);
                FenceRun(farm, new Vector3(18f, 0f, 20f), new Vector3(26f, 0f, 20f), wood);
                FenceRun(farm, new Vector3(18f, 0f, 26f), new Vector3(21f, 0f, 26f), wood);
                FenceRun(farm, new Vector3(23f, 0f, 26f), new Vector3(26f, 0f, 26f), wood);
            }
            Block("Coop", farm, new Vector3(24.6f, 0.6f, 21.2f), new Vector3(2f, 1.2f, 1.6f), darkWood);
            Block("CoopRoof", farm, new Vector3(24.6f, 1.35f, 21.2f), new Vector3(2.3f, 0.3f, 1.9f), Mat("TargetRed", new Color(0.85f, 0.15f, 0.12f)));
            Label(farm, "CHICKENS (Bob loves them)", new Vector3(22f, 2.3f, 23f), Color.white, 0.04f);

            // Calf corner with a trough.
            Block("CalfTrough", farm, new Vector3(-4f, 0.25f, 54.5f), new Vector3(2.2f, 0.5f, 0.6f), darkWood);

            // Hiding: mud puddles, hay; Heavy shakes apples out of the apple trees.
            Mud(farm, new Vector3(-4.5f, 0f, 27f), 1.6f);
            Mud(farm, new Vector3(21f, 0f, 34f), 1.4f);
            Mud(farm, new Vector3(-8f, 0f, 48f), 1.5f);
            Haystack(farm, new Vector3(10f, 0f, 56f), hay);
            Haystack(farm, new Vector3(-25f, 0f, 24f), hay);
            Haystack(farm, new Vector3(4f, 0f, 37f), hay);
            AppleTreeAt(farm, new Vector3(7f, 0f, 25f));
            AppleTreeAt(farm, new Vector3(-6f, 0f, 57f));
            AppleTreeAt(farm, new Vector3(23f, 0f, 55f));
            Label(farm, "APPLE TREE\n(Heavy: slam it)", new Vector3(7f, 5.6f, 25f), new Color(1f, 0.6f, 0.5f), 0.035f);

            // Static crates (step up to the lean-to roof) + a few around the yard.
            foreach (var c in new[] { new Vector3(-22.6f, 0f, 38.9f), new Vector3(17.6f, 0f, 41.2f), new Vector3(-26.8f, 0f, 46f), new Vector3(-26.8f, 0f, 47.1f) })
                StaticCrate(farm, c, wood, kit);

            Scenery(r);
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

            var zone = new GameObject("EscapeZone");
            zone.transform.SetParent(truck, false);
            zone.transform.position = o + new Vector3(0f, 1.9f, 0f);
            zone.AddComponent<EscapeZone>().size = new Vector3(3.4f, 2f, 3.8f);
            Label(truck, "GETAWAY TRUCK", o + new Vector3(0f, 3.6f, 2f), new Color(0.5f, 1f, 0.5f), 0.07f);
        }

        /// <summary>Spawn points in the farmyard and Bob's house.</summary>
        static void FarmSpawnPoints(Transform spawnRoot, List<NetSpawnPoint> points, PrefabSet p)
        {
            // Bob's house: chimney chute, front door (opens from inside), shuttered window + its bullseye, boarded back door.
            points.Add(SpawnPoint(spawnRoot, "ChimneyChute", p.chimney, ChimneyTop));
            points.Add(SpawnPoint(spawnRoot, "HouseDoor", p.houseDoor, new Vector3(-15f, 1.225f, 33.8f), channel: ChannelIds.HouseDoor));
            points.Add(SpawnPoint(spawnRoot, "WindowShutter", p.shutter, new Vector3(-11.8f, 1.88f, 37f), channel: ChannelIds.HouseWindow,
                rotation: Quaternion.Euler(0f, 90f, 0f)));
            points.Add(SpawnPoint(spawnRoot, "WindowBullseye", p.target, new Vector3(-11.5f, 2.3f, 35f), channel: ChannelIds.HouseWindow,
                rotation: Quaternion.Euler(0f, 90f, 0f)));
            points.Add(SpawnPoint(spawnRoot, "BoardedBackDoor", p.boards, new Vector3(-17f, 1.5f, 40.55f)));
            points.Add(SpawnPoint(spawnRoot, "TruckKeys", p.truckKeys, new Vector3(-13.4f, 1f, 38.8f)));
            points.Add(SpawnPoint(spawnRoot, "Pie", p.pie, new Vector3(-18.6f, 1f, 38.8f)));
            // Truck ignition (channel Truck = last objective).
            points.Add(SpawnPoint(spawnRoot, "Ignition", p.ignition, TruckPos + IgnitionOffset, channel: ChannelIds.Truck));

            // Animals, props, ammo.
            foreach (var pos in new[] { new Vector3(20f, 0.35f, 24f), new Vector3(23f, 0.35f, 25f), new Vector3(24.5f, 0.35f, 23.5f) })
                points.Add(SpawnPoint(spawnRoot, "Chicken", p.chicken, pos));
            points.Add(SpawnPoint(spawnRoot, "Calf", p.calf, new Vector3(-4f, 0.55f, 52.5f)));
            points.Add(SpawnPoint(spawnRoot, "Bucket", p.bucket, new Vector3(9f, 0.55f, 30f)));
            points.Add(SpawnPoint(spawnRoot, "Bucket", p.bucket, new Vector3(-9f, 0.55f, 38f)));
            foreach (var pos in new[] { new Vector3(-25f, 0.5f, 41f), new Vector3(-26.3f, 0.5f, 41.4f), new Vector3(10f, 0.5f, 47f) })
                points.Add(SpawnPoint(spawnRoot, "Crate", p.crate, pos));
            foreach (var pos in new[] { new Vector3(6f, 0.6f, 46f), new Vector3(-8f, 0.6f, 24f) })
                points.Add(SpawnPoint(spawnRoot, "Barrel", p.barrel, pos));
            points.Add(SpawnPoint(spawnRoot, "BreakableCrate", p.weakCrate, new Vector3(2f, 0.45f, 50f), contents: p.corn));
            points.Add(SpawnPoint(spawnRoot, "BreakableCrate", p.weakCrate, new Vector3(-10f, 0.45f, 32f), contents: p.apple));
            AmmoPile(spawnRoot, points, p.corn, new Vector3(19.5f, 0.2f, 21.5f), 3);
            AmmoPile(spawnRoot, points, p.egg, new Vector3(25f, 0.2f, 24.5f), 2);
        }

        // ---------- farm helpers ----------

        /// <summary>Flat mud puddle: pigs lying in it are hidden from Bob.</summary>
        static void Mud(Transform parent, Vector3 position, float radius)
        {
            var mud = Part(PrimitiveType.Cylinder, "MudPuddle", parent, position + Vector3.up * 0.02f, new Vector3(radius * 2f, 0.01f, radius * 2f),
                Mat("Mud", new Color(0.35f, 0.24f, 0.14f)));
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

        /// <summary>Outside the fence, for the eye only (no colliders): trees and village cottages.</summary>
        static void Scenery(Transform r)
        {
            var scenery = new GameObject("Scenery").transform;
            scenery.SetParent(r, false);
            foreach (var (x, z, s) in new[]
                     {
                         (-34f, 20f, 1.2f), (-37f, 52f, 1.4f), (34f, 28f, 1.3f), (37f, 56f, 1.1f), (-18f, 66f, 1.5f), (8f, 67f, 1.2f),
                         (30f, 65f, 1.4f), (-12f, -31f, 1.2f), (14f, -33f, 1.3f), (-27f, -6f, 1.4f), (27f, 4f, 1.2f), (26f, -20f, 1.5f),
                         (-25f, -24f, 1.1f), (-46f, 8f, 1.6f), (47f, 14f, 1.5f), (-3f, 75f, 1.7f),
                     })
                Tree(scenery, new Vector3(x, 0f, z), s);
            if (!Kit.Available) return;
            Cottage(scenery, -48f, -40f, 26f, 32f, 2);
            Cottage(scenery, 36f, 44f, 40f, 46f, 1);
            Cottage(scenery, 18f, 26f, 66f, 72f, 2);
        }

        static void Cottage(Transform parent, float x0, float x1, float z0, float z1, int stories)
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
