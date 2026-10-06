using System.Collections.Generic;
using Unity.AI.Navigation;
using UnityEngine;
using UnityEngine.AI;

namespace Porkour.EditorTools
{
    /// <summary>
    /// The barn: gameplay = invisible boxes (walls 0.4 thick outside the wall lines, like the kit walls), medieval kit
    /// walls / roof / floor on top. Without the kit the boxes stay visible (old look).
    /// </summary>
    public static partial class PorkourBuilder
    {
        const float CeilingHeight = 8.5f;
        /// <summary>Bob's BBQ (behind the barn): his cage and his grill; the pig flap in the barn's south wall (x).</summary>
        static readonly Vector3 CagePos = new(5f, 0f, -29f);
        static readonly Vector3 GrillPos = new(-5f, 1f, -29f);
        const float PigFlapX = -11f;
        /// <summary>Barn walls: three kit stories (9.36 m).</summary>
        const float BarnWallTop = 3f * Kit.StoryHeight;
        const float Story = Kit.StoryHeight;

        /// <summary>
        /// Barn 40 x 30 (x -20..20, z -15..15), walls 9.36 + invisible ceiling at 8.5. South: Bob's door → his yard + grill.
        /// North: exit passage (electric fence, exit gate) → the farmyard (BuildFarmyard). East: hayloft (3.2 m) + lift.
        /// West: tool shed (rotten boards, fuse box) and a shelf up to the roof beams (5.5 m). South-east: pig pen.
        /// Returns the level root (NavMesh surface for Bob).
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
            var darkWood = Mat("RoofWood", new Color(0.33f, 0.22f, 0.14f));
            var lampMat = Mat("Lamp", Color.white);
            bool kit = Kit.Available;

            var r = new GameObject("Farm").transform;
            r.gameObject.AddComponent<SceneBuildInfo>().builderVersion = BuildVersion;
            // Farmer Bob's NavMesh: baked on the server at game start from these (static) children only.
            var surface = r.gameObject.AddComponent<NavMeshSurface>();
            surface.collectObjects = CollectObjects.Children;
            surface.useGeometry = NavMeshCollectGeometry.PhysicsColliders;

            // Ground: one grass slab under barn, yard and farmyard (+ NavMesh); far grass to the horizon is scenery only.
            Block("Ground", r, new Vector3(0f, -0.5f, 26f), new Vector3(104f, 1f, 144f), grass);
            Part(PrimitiveType.Cube, "FarGrass", null, new Vector3(0f, -0.55f, 26f), new Vector3(500f, 1f, 500f), grass);

            // Barn floor, walls, invisible ceiling (nobody flies out over the walls).
            const float t = 0.4f;
            const float h = CeilingHeight;
            Solid("Floor", r, new Vector3(0f, -0.49f, 0f), new Vector3(40.8f, 1f, 30.8f), floor, kit);
            Solid("WallN1", r, new Vector3(-11.2f, BarnWallTop / 2f, 15.2f), new Vector3(18.4f, BarnWallTop, t), wall, kit);
            Solid("WallN2", r, new Vector3(11.2f, BarnWallTop / 2f, 15.2f), new Vector3(18.4f, BarnWallTop, t), wall, kit);
            Solid("ExitLintel", r, new Vector3(0f, (Story + BarnWallTop) / 2f, 15.2f), new Vector3(4f, BarnWallTop - Story, t), wall, kit);
            // South wall west part, with the PIG FLAP: a low hole (1.1 m) pigs fit through but Bob doesn't - the way out to his
            // BBQ to rescue caged friends.
            Solid("WallS1a", r, new Vector3((-20.4f + PigFlapX - 0.7f) / 2f, BarnWallTop / 2f, -15.2f), new Vector3(PigFlapX - 0.7f + 20.4f, BarnWallTop, t), wall, kit);
            Solid("WallS1b", r, new Vector3((PigFlapX + 0.7f - 2f) / 2f, BarnWallTop / 2f, -15.2f), new Vector3(-2f - PigFlapX - 0.7f, BarnWallTop, t), wall, kit);
            Solid("PigFlapLintel", r, new Vector3(PigFlapX, (1.1f + BarnWallTop) / 2f, -15.2f), new Vector3(1.4f, BarnWallTop - 1.1f, t), wall, kit);
            Part(PrimitiveType.Cube, "PigFlapBoards", r, new Vector3(PigFlapX, 1.8f, -15.2f), new Vector3(1.5f, 1.4f, 0.5f), Mat("RoofWood", new Color(0.33f, 0.22f, 0.14f)));
            Part(PrimitiveType.Cube, "PigFlap", r, new Vector3(PigFlapX, 0.85f, -15.48f), new Vector3(1.3f, 0.5f, 0.04f), Mat("FlapRubber", new Color(0.15f, 0.12f, 0.1f)), new Vector3(-25f, 0f, 0f));
            Label(r, "PIG FLAP\n(to Bob's BBQ)", new Vector3(PigFlapX, 2.9f, -14.6f), new Color(1f, 0.85f, 0.4f), 0.035f);
            Solid("WallS2", r, new Vector3(11.2f, BarnWallTop / 2f, -15.2f), new Vector3(18.4f, BarnWallTop, t), wall, kit);
            Solid("DoorLintel", r, new Vector3(0f, (Story + BarnWallTop) / 2f, -15.2f), new Vector3(4f, BarnWallTop - Story, t), wall, kit);
            Solid("WallE", r, new Vector3(20.2f, BarnWallTop / 2f, 0f), new Vector3(t, BarnWallTop, 30.8f), wall, kit);
            Solid("WallW", r, new Vector3(-20.2f, BarnWallTop / 2f, 0f), new Vector3(t, BarnWallTop, 30.8f), wall, kit);
            Boundary(r, "Ceiling", new Vector3(0f, h + 0.25f, 0f), new Vector3(40.8f, 0.5f, 30.8f));
            DoorFrame(r, new Vector3(0f, 0f, -15.2f), 4f, beam);
            DoorFrame(r, new Vector3(0f, 0f, 15.2f), 4f, beam);
            if (kit)
            {
                BarnKitWalls(r);
                BarnKitRoof(r);
                var tiles = new GameObject("BarnFloor (kit)").transform;
                tiles.SetParent(r, false);
                Kit.FloorTiles("Floor_WoodDark", tiles, new Vector2(-20f, -15f), new Vector2(20f, 15f), 0.02f);
                Kit.FloorTiles("Floor_WoodDark", tiles, new Vector2(12f, -6f), new Vector2(20f, 14f), 3.212f); // hayloft
            }

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

            // Tool shed (west, x -20..-12, z -8..2): its doorway (z -4..-2) is nailed shut with rotten boards (network-spawned).
            Solid("ShedE1", r, new Vector3(-11.8f, Story / 2f, -6.2f), new Vector3(t, Story, 4.4f), shed, kit);
            Solid("ShedE2", r, new Vector3(-11.8f, Story / 2f, 0.2f), new Vector3(t, Story, 4.4f), shed, kit);
            Solid("ShedN", r, new Vector3(-15.8f, Story / 2f, 2.2f), new Vector3(8.4f, Story, t), shed, kit);
            Solid("ShedS", r, new Vector3(-15.8f, Story / 2f, -8.2f), new Vector3(8.4f, Story, t), shed, kit);
            Block("ShedRoof", r, new Vector3(-15.8f, Story + 0.15f, -3f), new Vector3(8.4f, 0.3f, 10.8f), darkWood);
            if (kit)
            {
                var shedWalls = new GameObject("ShedWalls (kit)").transform;
                shedWalls.SetParent(r, false);
                Kit.WallRun(shedWalls, new Vector3(-12f, 0f, -8f), new Vector3(-12f, 0f, 2f), Vector3.right, 1, (i, _) => i == 2 ? null : "Wall_Plaster_WoodGrid");
                Kit.WallRun(shedWalls, new Vector3(-20f, 0f, 2f), new Vector3(-12f, 0f, 2f), Vector3.forward, 1, (_, _) => "Wall_Plaster_WoodGrid");
                Kit.WallRun(shedWalls, new Vector3(-20f, 0f, -8f), new Vector3(-12f, 0f, -8f), Vector3.back, 1, (_, _) => "Wall_Plaster_WoodGrid");
                foreach (float z in new[] { 2.2f, -8.2f })
                    Kit.Fit("Corner_Exterior_Wood", shedWalls, new Vector3(-11.8f, Story / 2f, z), new Vector3(0.45f, Story, 0.45f), 0f);
            }
            Label(r, "TOOL SHED", new Vector3(-11.3f, 4f, -3f), Color.white, 0.06f);
            Label(r, "FUSE BOX", new Vector3(-19.3f, 2.2f, -3f), new Color(1f, 0.9f, 0.3f), 0.04f);
            PointLight(r, new Vector3(-16f, 2.6f, -3f), new Color(1f, 0.8f, 0.5f), 8f, 1.5f);

            // Exit passage (x -2..2, z 15.4..19.4) through the north wall: electric fence, then the exit gate (network-spawned).
            Solid("PassageW", r, new Vector3(-2.2f, Story / 2f, 17.4f), new Vector3(t, Story, 4f), wall, kit);
            Solid("PassageE", r, new Vector3(2.2f, Story / 2f, 17.4f), new Vector3(t, Story, 4f), wall, kit);
            Block("PassageRoof", r, new Vector3(0f, Story + 0.15f, 17.4f), new Vector3(4.8f, 0.3f, 4f), darkWood);
            if (kit)
            {
                var passage = new GameObject("Passage (kit)").transform;
                passage.SetParent(r, false);
                Kit.WallRun(passage, new Vector3(-2f, 0f, 15.4f), new Vector3(-2f, 0f, 19.4f), Vector3.left, 1, (_, _) => "Wall_UnevenBrick_Straight");
                Kit.WallRun(passage, new Vector3(2f, 0f, 15.4f), new Vector3(2f, 0f, 19.4f), Vector3.right, 1, (_, _) => "Wall_UnevenBrick_Straight");
            }
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
            PointLight(r, new Vector3(0f, 2.8f, 12.5f), new Color(0.8f, 1f, 0.8f), 9f, 1.2f);

            // Pig pen (start), south-east: low fence (jump over) with a gap on the north-west.
            bool fences = ArtSetup.FarmBuilding("Fence") != null;
            Solid("PenN", r, new Vector3(13.8f, 0.4f, -8f), new Vector3(6.4f, 0.8f, 0.2f), wood, fences);
            Solid("PenW", r, new Vector3(9f, 0.4f, -11f), new Vector3(0.2f, 0.8f, 6f), wood, fences);
            Solid("PenE", r, new Vector3(17f, 0.4f, -11f), new Vector3(0.2f, 0.8f, 6f), wood, fences);
            Solid("PenS", r, new Vector3(13f, 0.4f, -14f), new Vector3(8.2f, 0.8f, 0.2f), wood, fences);
            if (fences)
            {
                FenceRun(r, new Vector3(10.6f, 0f, -8f), new Vector3(17f, 0f, -8f), wood, 0.85f);
                FenceRun(r, new Vector3(9f, 0f, -8f), new Vector3(9f, 0f, -14f), wood, 0.85f);
                FenceRun(r, new Vector3(17f, 0f, -8f), new Vector3(17f, 0f, -14f), wood, 0.85f);
                FenceRun(r, new Vector3(8.9f, 0f, -14f), new Vector3(17.1f, 0f, -14f), wood, 0.85f);
            }
            Block("Trough", r, new Vector3(11f, 0.25f, -13.4f), new Vector3(2f, 0.5f, 0.6f), beam);
            Part(PrimitiveType.Cube, "Mud", r, new Vector3(14.5f, 0.035f, -12f), new Vector3(3f, 0.02f, 2.2f), Mat("Mud", new Color(0.35f, 0.24f, 0.14f)));

            // Hay to hide in (no colliders - walk in), bales as obstacles.
            Haystack(r, new Vector3(-6f, 0f, 11f), hay);
            Haystack(r, new Vector3(5f, 0f, 12f), hay);
            Haystack(r, new Vector3(-15f, 0f, -11.5f), hay);
            Haystack(r, new Vector3(16f, 0f, 1.5f), hay); // under the hayloft
            Block("HayBale1", r, new Vector3(-17.5f, 0.8f, 13f), new Vector3(1.6f, 1f, 1.6f), hay, new Vector3(0f, 0f, 90f), PrimitiveType.Cylinder);
            Block("HayBale2", r, new Vector3(-15.3f, 0.8f, 13.3f), new Vector3(1.6f, 1f, 1.6f), hay, new Vector3(0f, 30f, 90f), PrimitiveType.Cylinder);
            Block("HayBale3", r, new Vector3(-9f, 0.8f, -12.5f), new Vector3(1.6f, 1f, 1.6f), hay, new Vector3(0f, 70f, 90f), PrimitiveType.Cylinder);

            BuildBbqYard(r, kit);
            return r;
        }

        /// <summary>
        /// Bob's BBQ yard behind the barn (x -12..12, z -36..-15.4): his brick grill, his cage (network-spawned PigCage, door
        /// toward the barn), gas bottle, picnic table. Invisible walls + roof: pigs only get here through Bob's door or the
        /// pig flap.
        /// </summary>
        static void BuildBbqYard(Transform r, bool kit)
        {
            var wood = Mat("Crate", new Color(0.8f, 0.62f, 0.38f));
            var dirt = Mat("Dirt", new Color(0.5f, 0.38f, 0.24f));
            const float t = 0.4f, h = CeilingHeight;
            var yard = new GameObject("BobsBBQ").transform;
            yard.SetParent(r, false);
            Boundary(yard, "YardW", new Vector3(-12.2f, h / 2f, -25.9f), new Vector3(t, h, 21f));
            Boundary(yard, "YardE", new Vector3(12.2f, h / 2f, -25.9f), new Vector3(t, h, 21f));
            Boundary(yard, "YardS", new Vector3(0f, h / 2f, -36.6f), new Vector3(24.8f, h, t));
            Boundary(yard, "YardRoof", new Vector3(0f, h + 0.25f, -26f), new Vector3(24.8f, 0.5f, 21.4f));
            FenceRun(yard, new Vector3(-12f, 0f, -15.4f), new Vector3(-12f, 0f, -36.4f), wood);
            FenceRun(yard, new Vector3(12f, 0f, -15.4f), new Vector3(12f, 0f, -36.4f), wood);
            FenceRun(yard, new Vector3(-12f, 0f, -36.4f), new Vector3(12f, 0f, -36.4f), wood);
            Part(PrimitiveType.Cube, "BbqDirt", yard, new Vector3(0f, 0.01f, -27f), new Vector3(20f, 0.02f, 13f), dirt);

            // Brick grill + smokestack.
            Vector3 g = new(GrillPos.x, 0f, GrillPos.z);
            Solid("Grill", yard, g + new Vector3(0f, 0.45f, 0f), new Vector3(2.6f, 0.9f, 1.3f), Mat("GrillBrick", new Color(0.55f, 0.25f, 0.18f)), kit);
            if (kit) Kit.Fit("Wall_UnevenBrick_Straight", yard, g + new Vector3(0f, 0.45f, 0f), new Vector3(2.6f, 0.9f, 1.3f), 0f);
            Block("GrillTop", yard, g + new Vector3(0f, 0.93f, 0f), new Vector3(2.3f, 0.06f, 1.1f), Mat("GrillMetal", new Color(0.18f, 0.18f, 0.2f)));
            Part(PrimitiveType.Cube, "Coals", yard, g + new Vector3(0f, 0.97f, 0f), new Vector3(2f, 0.04f, 0.9f), Mat("Coals", new Color(1f, 0.35f, 0.1f)));
            if (!kit || Kit.Fit("Prop_Chimney", yard, g + new Vector3(0f, 1.9f, -0.45f), new Vector3(0.6f, 2f, 0.4f), 0f) == null)
                Part(PrimitiveType.Cube, "Smokestack", yard, g + new Vector3(0f, 1.9f, -0.45f), new Vector3(0.5f, 2f, 0.35f), Mat("GrillBrick", new Color(0.55f, 0.25f, 0.18f)));
            PointLight(yard, g + new Vector3(0f, 1.6f, 0.6f), new Color(1f, 0.5f, 0.2f), 6f, 1.6f);
            Label(yard, "BOB'S BBQ", g + new Vector3(0f, 3.4f, 0f), new Color(1f, 0.5f, 0.3f), 0.06f);
            Label(yard, "BOB'S CAGE\n(stand at the door to open it)", CagePos + new Vector3(0f, 4.4f, 0f), new Color(1f, 0.85f, 0.4f), 0.035f);

            // Picnic table, crates (decor + cover).
            Block("PicnicTable", yard, new Vector3(0f, 0.75f, -33f), new Vector3(2.6f, 0.1f, 1.2f), wood);
            foreach (float z in new[] { -33.9f, -32.1f })
                Block("Bench", yard, new Vector3(0f, 0.45f, z), new Vector3(2.6f, 0.08f, 0.4f), wood);
            foreach (var (x, z) in new[] { (-1.1f, -33.4f), (1.1f, -33.4f), (-1.1f, -32.6f), (1.1f, -32.6f) })
                Block("TableLeg", yard, new Vector3(x, 0.35f, z), new Vector3(0.1f, 0.7f, 0.1f), wood);
            foreach (var c in new[] { new Vector3(-10.5f, 0f, -34.8f), new Vector3(-9.4f, 0f, -34.8f), new Vector3(10.5f, 0f, -18f) })
                StaticCrate(yard, c, wood, kit);
            Haystack(yard, new Vector3(-9f, 0f, -20f), Mat("Hay", new Color(0.93f, 0.8f, 0.35f)));
        }

        /// <summary>Kit walls on the barn's four sides: stone base, timber frame, plaster with windows (not where a bullseye hangs).</summary>
        static void BarnKitWalls(Transform r)
        {
            var walls = new GameObject("BarnWalls (kit)").transform;
            walls.SetParent(r, false);
            void Run(Vector3 a, Vector3 b, Vector3 outward, bool doorway, int noWindow, int flap = -1)
            {
                bool Window(int i) => i % 4 == 2 && i != noWindow;
                Kit.WallRun(walls, a, b, outward, 3, (i, story) =>
                    story == 0 ? (doorway && (i == 9 || i == 10) ? null : i == flap ? "Wall_UnevenBrick_Door_Round" : "Wall_UnevenBrick_Straight")
                    : story == 1 ? "Wall_Plaster_WoodGrid"
                    : Window(i) ? "Wall_Plaster_Window_Wide_Round" : "Wall_Plaster_Straight");
                Kit.WallRun(walls, a, b, outward, 3, (i, story) => story == 2 && Window(i) ? "Window_Wide_Round1" : null);
            }
            Run(new Vector3(-20f, 0f, -15f), new Vector3(20f, 0f, -15f), Vector3.back, true, 6, Mathf.FloorToInt((PigFlapX + 20f) / 2f)); // south: Bob's door, pig flap, bullseye 2
            Run(new Vector3(-20f, 0f, 15f), new Vector3(20f, 0f, 15f), Vector3.forward, true, 14);   // north: exit, bullseye 1
            Run(new Vector3(20f, 0f, -15f), new Vector3(20f, 0f, 15f), Vector3.right, false, -1);
            Run(new Vector3(-20f, 0f, -15f), new Vector3(-20f, 0f, 15f), Vector3.left, false, 2);    // west: bullseye 3
            foreach (float x in new[] { -20.2f, 20.2f })
            foreach (float z in new[] { -15.2f, 15.2f })
                Kit.Fit("Corner_ExteriorWide_Wood", walls, new Vector3(x, BarnWallTop / 2f, z), new Vector3(0.5f, BarnWallTop, 0.5f), 0f);
        }

        /// <summary>
        /// Three tiled gable roofs side by side (ridges along x) with brick gables at both ends. Hidden while you are
        /// inside the barn (RoofHider), so it never blocks the view.
        /// </summary>
        static void BarnKitRoof(Transform r)
        {
            var roof = new GameObject("BarnRoof (kit)").transform;
            roof.SetParent(r, false);
            const float length = 41.6f; // along x, past the outer walls
            for (int j = 0; j < 3; j++)
            {
                float z = -10f + 10f * j;
                for (int k = 0; k < 3; k++)
                    Kit.Fit("Roof_RoundTiles_8x14", roof, new Vector3(-length / 2f + length / 6f * (2 * k + 1), BarnWallTop - 0.78f + 6.78f / 2f, z),
                        new Vector3(length / 3f, 6.78f, 11.8f), 90f, keepLongSide: true);
                foreach (float side in new[] { -1f, 1f })
                    Kit.Fit("Roof_Front_Brick8", roof, new Vector3(side * 20.2f, BarnWallTop - 0.13f + 5.45f / 2f, z),
                        new Vector3(0.4f, 5.45f, 10f), side * 90f, keepLongSide: true);
            }
            var hider = roof.gameObject.AddComponent<RoofHider>();
            hider.center = new Vector3(0f, 8.5f, 0f);
            hider.size = new Vector3(41f, 17f, 31f);
        }

        /// <summary>Spawn points inside the barn (and Bob in his yard).</summary>
        static void BarnSpawnPoints(Transform spawnRoot, List<NetSpawnPoint> points, PrefabSet p)
        {
            // Pigs start in the pen (south-east); the server gives them random types (colour = type) every round.
            for (int i = 0; i < PigTypes.All.Length; i++)
                points.Add(SpawnPoint(spawnRoot, $"Pig {i + 1}", p.pig, new Vector3(10.6f + i * 1.8f, 1f, -10.5f)));

            // ---- Escape: 4 locks on the exit (north) ----
            // 1. Padlock: the key sits on the north roof beam, far west - Jumpy's job (Gassy can rocket up too).
            points.Add(SpawnPoint(spawnRoot, "Key", p.key, new Vector3(-12f, 5.75f, 7f)));
            points.Add(SpawnPoint(spawnRoot, "Padlock", p.padlock, new Vector3(-4.5f, 0f, 13.6f), channel: ChannelIds.Padlock));
            // 2. Electric fence in the exit passage; its fuse box is in the tool shed behind rotten boards - Heavy.
            points.Add(SpawnPoint(spawnRoot, "ElectricFence", p.fence, new Vector3(0f, 1.55f, 16.6f), channel: ChannelIds.Fence));
            points.Add(SpawnPoint(spawnRoot, "RottenBoards", p.boards, new Vector3(-11.8f, 1.55f, -3f), rotation: Quaternion.Euler(0f, 90f, 0f)));
            points.Add(SpawnPoint(spawnRoot, "FuseBox", p.fuseBox, new Vector3(-19.75f, 1f, -3f), channel: ChannelIds.Fence,
                rotation: Quaternion.Euler(0f, 90f, 0f)));
            // 3. Generator (runs on farts) up on the hayloft - Gassy.
            points.Add(SpawnPoint(spawnRoot, "Generator", p.generator, new Vector3(17.5f, 3.2f, 10.5f), channel: ChannelIds.Generator,
                rotation: Quaternion.Euler(0f, -90f, 0f)));
            // 4. Three bullseyes high on the walls - Armed (latching).
            points.Add(SpawnPoint(spawnRoot, "Bullseye 1", p.target, new Vector3(9f, 6f, 14.85f), channel: ChannelIds.Target1,
                rotation: Quaternion.Euler(0f, 180f, 0f)));
            points.Add(SpawnPoint(spawnRoot, "Bullseye 2", p.target, new Vector3(-8f, 6f, -14.85f), channel: ChannelIds.Target2));
            points.Add(SpawnPoint(spawnRoot, "Bullseye 3", p.target, new Vector3(-19.85f, 6.5f, -11f), channel: ChannelIds.Target3,
                rotation: Quaternion.Euler(0f, 90f, 0f)));
            // The exit gate opens when padlock + generator + bullseyes are done (see BuildExitGatePrefab).
            points.Add(SpawnPoint(spawnRoot, "ExitGate", p.exitGate, new Vector3(0f, 1.55f, 19.1f)));

            // ---- Getting up high ----
            // Lift to the hayloft: stand on the plate (40 kg = Heavy, or two pigs) and the lift rises.
            points.Add(SpawnPoint(spawnRoot, "LiftPlate", p.plate, new Vector3(6.5f, 0f, -3.3f), channel: ChannelIds.Lift));
            points.Add(SpawnPoint(spawnRoot, "Lift", p.lift, new Vector3(10.7f, 0.1f, -3.3f), channel: ChannelIds.Lift));
            // Crates to stack: by the hayloft edge and under the west shelf.
            foreach (var pos in new[] { new Vector3(10.8f, 0.5f, 2.5f), new Vector3(10.8f, 0.5f, 3.8f), new Vector3(9.6f, 0.5f, 3.1f),
                         new Vector3(-17f, 0.5f, 9.3f), new Vector3(-17f, 0.5f, 10.6f), new Vector3(-15.7f, 0.5f, 9.9f) })
                points.Add(SpawnPoint(spawnRoot, "Crate", p.crate, pos));
            foreach (var pos in new[] { new Vector3(-4f, 0.6f, -10f), new Vector3(-3f, 0.6f, -11f), new Vector3(6f, 0.6f, 9f) })
                points.Add(SpawnPoint(spawnRoot, "Barrel", p.barrel, pos));

            // ---- Heavy's toys: weak crates (some with ammo inside) ----
            points.Add(SpawnPoint(spawnRoot, "BreakableCrate", p.weakCrate, new Vector3(-8f, 0.45f, -9f), contents: p.apple));
            points.Add(SpawnPoint(spawnRoot, "BreakableCrate", p.weakCrate, new Vector3(2f, 0.45f, 10f), contents: p.corn));
            points.Add(SpawnPoint(spawnRoot, "BreakableCrate", p.weakCrate, new Vector3(-10f, 0.45f, 4f)));
            points.Add(SpawnPoint(spawnRoot, "BreakableCrate", p.weakCrate, new Vector3(-18.5f, 0.45f, 0.8f), contents: p.apple));

            // ---- Farmer Bob, his barn door (channel 99), bait, hiding buckets, the bell lure ----
            points.Add(SpawnPoint(spawnRoot, "FarmerBob", p.bob, new Vector3(0f, 0f, -22f)));
            // His BBQ: the cage (door toward the barn) and the gas bottle (bonus: smash it, the grill gets slow).
            points.Add(SpawnPoint(spawnRoot, "PigCage", p.cage, CagePos));
            points.Add(SpawnPoint(spawnRoot, "GasBottle", p.gasBottle, new Vector3(GrillPos.x - 2.3f, 0.65f, GrillPos.z - 0.4f), channel: ChannelIds.Sabotage));
            // Loot: Bob's gold watch up on the hayloft.
            points.Add(SpawnPoint(spawnRoot, "GoldWatch", p.watch, new Vector3(18.6f, 3.5f, 0.5f)));
            // Coins: easy ones near the start, big ones in hard places (beams, shelf).
            foreach (var pos in new[] { new Vector3(13f, 0.7f, -12.5f), new Vector3(-16f, 0.7f, -6f), new Vector3(-2f, 0.7f, 11.5f),
                         new Vector3(9.5f, 0.7f, -33.5f), new Vector3(-6f, 0.7f, -2f) })
                points.Add(SpawnPoint(spawnRoot, "Coin", p.coin, pos));
            foreach (var pos in new[] { new Vector3(8f, 5.95f, 7f), new Vector3(-16f, 5.95f, -2f), new Vector3(-19.2f, 3.75f, 10.3f),
                         new Vector3(18.5f, 4.9f, 12.5f) })
                points.Add(SpawnPoint(spawnRoot, "BigCoin", p.bigCoin, pos));
            points.Add(SpawnPoint(spawnRoot, "BarnDoor", p.barnDoor, new Vector3(0f, 1.55f, -15.2f), channel: ChannelIds.BobDoor));
            foreach (var pos in new[] { new Vector3(-4f, 0.35f, 0f), new Vector3(4f, 0.35f, -5f) })
                points.Add(SpawnPoint(spawnRoot, "Chicken", p.chicken, pos));
            foreach (var pos in new[] { new Vector3(3f, 0.55f, -8f), new Vector3(-10f, 0.55f, 12f), new Vector3(-15.5f, 0.55f, 0.5f) })
                points.Add(SpawnPoint(spawnRoot, "Bucket", p.bucket, pos));
            points.Add(SpawnPoint(spawnRoot, "Bell", p.bell, new Vector3(-5f, 5.1f, -2f)));

            // ---- Armed's ammo piles ----
            var ammoPiles = new (GameObject prefab, Vector3 center, int count)[]
            {
                (p.apple, new Vector3(7.5f, 0.2f, -7f), 4), (p.corn, new Vector3(-2f, 0.2f, 3f), 4),
                (p.egg, new Vector3(18.5f, 3.4f, 3f), 3), (p.bolt, new Vector3(-17f, 0.2f, -5.5f), 4),
            };
            foreach (var (prefab, center, count) in ammoPiles)
                AmmoPile(spawnRoot, points, prefab, center, count);
        }

        static void AmmoPile(Transform spawnRoot, List<NetSpawnPoint> points, GameObject prefab, Vector3 center, int count)
        {
            for (int i = 0; i < count; i++)
                points.Add(SpawnPoint(spawnRoot, prefab.name, prefab, center + new Vector3((i % 2 - 0.5f) * 0.5f, 0f, (i / 2 - 0.5f) * 0.5f)));
        }

        // ---------- level helpers ----------

        /// <summary>Collision box that is drawn only when the kit is missing (the kit pieces are its look).</summary>
        static GameObject Solid(string name, Transform parent, Vector3 pos, Vector3 scale, Material mat, bool hidden)
        {
            var go = Block(name, parent, pos, scale, mat);
            if (hidden) Invisible(go);
            return go;
        }

        /// <summary>Invisible wall / roof that keeps pigs in the play area; the camera ignores it.</summary>
        static GameObject Boundary(Transform parent, string name, Vector3 pos, Vector3 scale) =>
            PassThrough(Invisible(Block(name, parent, pos, scale, null)));

        static GameObject Invisible(GameObject go)
        {
            Object.DestroyImmediate(go.GetComponent<MeshRenderer>());
            Object.DestroyImmediate(go.GetComponent<MeshFilter>());
            return go;
        }

        /// <summary>
        /// Wooden fence look from a to b: Quaternius farm fence pieces (about 6 m), else medieval kit fences (2 m), else two
        /// rails. No colliders (the builder adds boxes / invisible walls where it matters).
        /// </summary>
        static void FenceRun(Transform parent, Vector3 a, Vector3 b, Material wood, float height = 1.1f)
        {
            var farmFence = ArtSetup.FarmBuilding("Fence");
            Vector3 dir = b - a;
            float pieceLength = farmFence != null ? 6f : 2f;
            int count = Mathf.Max(1, Mathf.RoundToInt(dir.magnitude / pieceLength));
            bool alongX = Mathf.Abs(dir.x) >= Mathf.Abs(dir.z);
            float piece = dir.magnitude / count;
            for (int i = 0; i < count; i++)
            {
                Vector3 c = a + dir * ((i + 0.5f) / count);
                var size = alongX ? new Vector3(piece, height, 0.16f) : new Vector3(0.16f, height, piece);
                if (Kit.FitAsset(farmFence, parent, c + Vector3.up * height / 2f, size, alongX ? 0f : 90f, keepLongSide: true) != null) continue;
                if (Kit.Fit("Prop_WoodenFence_Single", parent, c + Vector3.up * height / 2f, size, alongX ? 0f : 90f) != null) continue;
                Part(PrimitiveType.Cube, "Rail", parent, c + Vector3.up * height * 0.75f, alongX ? new Vector3(piece, 0.1f, 0.08f) : new Vector3(0.08f, 0.1f, piece), wood);
                Part(PrimitiveType.Cube, "Rail", parent, c + Vector3.up * height * 0.35f, alongX ? new Vector3(piece, 0.1f, 0.08f) : new Vector3(0.08f, 0.1f, piece), wood);
                Part(PrimitiveType.Cube, "Post", parent, c - dir.normalized * piece / 2f + Vector3.up * height / 2f, new Vector3(0.12f, height, 0.12f), wood);
            }
        }

        /// <summary>Wooden posts + beam around a doorway (one story) in a wall along x; no colliders.</summary>
        static void DoorFrame(Transform parent, Vector3 bottomCenter, float width, Material wood)
        {
            foreach (float side in new[] { -1f, 1f })
                Part(PrimitiveType.Cube, "DoorPost", parent, bottomCenter + new Vector3(side * (width / 2f + 0.12f), Story / 2f, 0f),
                    new Vector3(0.24f, Story, 0.6f), wood);
            Part(PrimitiveType.Cube, "DoorBeam", parent, bottomCenter + new Vector3(0f, Story + 0.1f, 0f), new Vector3(width + 0.48f, 0.3f, 0.6f), wood);
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
    }
}
