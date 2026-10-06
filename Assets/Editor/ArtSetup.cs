using System.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

namespace Porkour.EditorTools
{
    /// <summary>
    /// The imported art packs, ready for the game (called by the builder before it makes prefabs):
    /// Bob (Mixamo) = Humanoid rig + his animation files share his avatar, looping clips, root motion baked in place;
    /// Kenney Cube Pets = looping idle/walk/run. Then animator controllers in Assets/Art/Generated.
    /// Import settings are changed once per file (marked in the importer's userData) so later manual tweaks stay.
    /// Every getter returns null when a file is missing - the builder then keeps the primitive placeholder.
    /// </summary>
    public static class ArtSetup
    {
        public const string BobDir = "Assets/Art/Characters";
        public const string AnimalDir = "Assets/Art/Animals/kenney_cube-pets_1.0/Models/FBX format";
        public const string GeneratedDir = "Assets/Art/Generated";
        const string Marker = "porkour-import-1";

        static readonly (string file, string clip, bool loop)[] BobClips =
        {
            ("Bob_Idle", "Idle", true), ("Bob_Walk", "Walk", true), ("Bob_Run", "Run", true),
            ("Bob_LookAround", "LookAround", true), ("Bob_Carry", "Carry", true), ("Bob_Dizzy", "Dizzy", true),
            ("Bob_Throw", "Throw", false), ("Bob_Yell", "Yell", true),
        };

        static readonly string[] Animals = { "pig", "hog", "chick", "cow" };

        public static GameObject BobModel => AssetDatabase.LoadAssetAtPath<GameObject>(BobDir + "/Bob.fbx");

        public static GameObject AnimalModel(string animal) => AssetDatabase.LoadAssetAtPath<GameObject>(AnimalPath(animal));

        static string AnimalPath(string animal) => $"{AnimalDir}/animal-{animal}.fbx";

        /// <summary>Fix the import settings of Bob and the animals (only the first time for each file).</summary>
        public static void PrepareImports()
        {
            PrepareBob();
            foreach (var animal in Animals) PrepareAnimal(animal);
        }

        static void PrepareBob()
        {
            string path = BobDir + "/Bob.fbx";
            if (!(AssetImporter.GetAtPath(path) is ModelImporter bob)) return;
            if (bob.userData != Marker)
            {
                bob.animationType = ModelImporterAnimationType.Human;
                bob.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel;
                bob.importAnimation = false;
                bob.userData = Marker;
                bob.SaveAndReimport();
            }
            var avatar = AssetDatabase.LoadAllAssetsAtPath(path).OfType<Avatar>().FirstOrDefault();
            if (avatar == null || !avatar.isHuman)
            {
                Debug.LogWarning("Porkour: Bob.fbx could not be set up as a Humanoid - his animations may not play.");
                return;
            }
            foreach (var (file, clipName, loop) in BobClips)
            {
                string animPath = $"{BobDir}/{file}.fbx";
                if (!(AssetImporter.GetAtPath(animPath) is ModelImporter anim) || anim.userData == Marker) continue;
                anim.animationType = ModelImporterAnimationType.Human;
                anim.avatarSetup = ModelImporterAvatarSetup.CopyFromOther;
                anim.sourceAvatar = avatar;
                anim.importAnimation = true;
                var clips = anim.defaultClipAnimations;
                if (clips.Length > 0)
                {
                    var c = clips[0];
                    c.name = clipName;
                    c.loopTime = loop;
                    c.loopPose = loop;
                    // "In place": the NavMeshAgent moves Bob, the animation must not.
                    c.lockRootRotation = c.lockRootHeightY = c.lockRootPositionXZ = true;
                    c.keepOriginalOrientation = c.keepOriginalPositionY = c.keepOriginalPositionXZ = true;
                    anim.clipAnimations = new[] { c };
                }
                anim.userData = Marker;
                anim.SaveAndReimport();
            }
        }

        static void PrepareAnimal(string animal)
        {
            if (!(AssetImporter.GetAtPath(AnimalPath(animal)) is ModelImporter imp) || imp.userData == Marker) return;
            imp.animationType = ModelImporterAnimationType.Generic;
            imp.importAnimation = true;
            var clips = imp.defaultClipAnimations;
            foreach (var c in clips)
            {
                string n = c.name.ToLowerInvariant();
                c.loopTime = c.loopPose = n.Contains("idle") || n.Contains("walk") || n.Contains("run") || n.Contains("dance") || n.Contains("eat");
            }
            if (clips.Length > 0) imp.clipAnimations = clips;
            imp.userData = Marker;
            imp.SaveAndReimport();
        }

        /// <summary>First animation clip in a model file whose name contains the word (null if none).</summary>
        static AnimationClip FindClip(string path, string word) =>
            AssetDatabase.LoadAllAssetRepresentationsAtPath(path).OfType<AnimationClip>()
                .FirstOrDefault(c => !c.name.StartsWith("__preview__") && c.name.ToLowerInvariant().Contains(word));

        static AnimationClip BobClip(string file) =>
            AssetDatabase.LoadAllAssetRepresentationsAtPath($"{BobDir}/{file}.fbx").OfType<AnimationClip>()
                .FirstOrDefault(c => !c.name.StartsWith("__preview__"));

        /// <summary>
        /// Bob: Locomotion blend (Speed: idle → walk → run) + Mode states (1 carry, 2 dizzy, 3 look around, 4 yell)
        /// + a Throw trigger. Null when his files are missing.
        /// </summary>
        public static RuntimeAnimatorController BobController()
        {
            var idle = BobClip("Bob_Idle");
            var walk = BobClip("Bob_Walk");
            if (BobModel == null || idle == null || walk == null) return null;
            var run = BobClip("Bob_Run");
            string path = GeneratedDir + "/Bob.controller";
            var controller = NewController(path, ("Speed", AnimatorControllerParameterType.Float),
                ("Mode", AnimatorControllerParameterType.Int), ("Throw", AnimatorControllerParameterType.Trigger));
            var sm = controller.layers[0].stateMachine;
            var loco = controller.CreateBlendTreeInController("Locomotion", out BlendTree tree, 0);
            tree.blendType = BlendTreeType.Simple1D;
            tree.blendParameter = "Speed";
            tree.useAutomaticThresholds = false;
            tree.AddChild(idle, 0f);
            tree.AddChild(walk, 2.6f);
            if (run != null) tree.AddChild(run, 5f);
            sm.defaultState = loco;
            ModeState(sm, loco, "Carry", BobClip("Bob_Carry") ?? walk, 1);
            ModeState(sm, loco, "Dizzy", BobClip("Bob_Dizzy") ?? idle, 2);
            ModeState(sm, loco, "LookAround", BobClip("Bob_LookAround") ?? idle, 3);
            ModeState(sm, loco, "Yell", BobClip("Bob_Yell") ?? idle, 4);
            var throwClip = BobClip("Bob_Throw");
            if (throwClip != null)
            {
                var state = sm.AddState("Throw");
                state.motion = throwClip;
                var into = sm.AddAnyStateTransition(state);
                into.AddCondition(AnimatorConditionMode.If, 0f, "Throw");
                into.hasExitTime = false;
                into.duration = 0.1f;
                into.canTransitionToSelf = false;
                var back = state.AddTransition(loco);
                back.hasExitTime = true;
                back.exitTime = 0.85f;
                back.duration = 0.2f;
            }
            AssetDatabase.SaveAssets();
            return controller;
        }

        static void ModeState(AnimatorStateMachine sm, AnimatorState loco, string name, Motion motion, int mode)
        {
            var state = sm.AddState(name);
            state.motion = motion;
            var into = loco.AddTransition(state);
            into.AddCondition(AnimatorConditionMode.Equals, mode, "Mode");
            into.hasExitTime = false;
            into.duration = 0.2f;
            var back = state.AddTransition(loco);
            back.AddCondition(AnimatorConditionMode.NotEqual, mode, "Mode");
            back.hasExitTime = false;
            back.duration = 0.25f;
        }

        /// <summary>
        /// A Cube Pet: Locomotion blend (Speed: idle → walk → run) + Held (wriggles with its dance clip while carried).
        /// Null when the file or its clips are missing.
        /// </summary>
        public static RuntimeAnimatorController AnimalController(string animal, float walkSpeed, float runSpeed)
        {
            string model = AnimalPath(animal);
            var idle = FindClip(model, "idle");
            var walk = FindClip(model, "walk");
            if (idle == null || walk == null) return null;
            var run = FindClip(model, "run");
            var wiggle = FindClip(model, "dance") ?? FindClip(model, "gesture");
            var controller = NewController($"{GeneratedDir}/Animal-{animal}.controller",
                ("Speed", AnimatorControllerParameterType.Float), ("Held", AnimatorControllerParameterType.Bool));
            var sm = controller.layers[0].stateMachine;
            var loco = controller.CreateBlendTreeInController("Locomotion", out BlendTree tree, 0);
            tree.blendType = BlendTreeType.Simple1D;
            tree.blendParameter = "Speed";
            tree.useAutomaticThresholds = false;
            tree.AddChild(idle, 0f);
            tree.AddChild(walk, walkSpeed);
            if (run != null) tree.AddChild(run, runSpeed);
            sm.defaultState = loco;
            if (wiggle != null)
            {
                var held = sm.AddState("Held");
                held.motion = wiggle;
                var into = loco.AddTransition(held);
                into.AddCondition(AnimatorConditionMode.If, 0f, "Held");
                into.hasExitTime = false;
                into.duration = 0.1f;
                var back = held.AddTransition(loco);
                back.AddCondition(AnimatorConditionMode.IfNot, 0f, "Held");
                back.hasExitTime = false;
                back.duration = 0.15f;
            }
            AssetDatabase.SaveAssets();
            return controller;
        }

        static AnimatorController NewController(string path, params (string name, AnimatorControllerParameterType type)[] parameters)
        {
            EnsureFolder(GeneratedDir);
            AssetDatabase.DeleteAsset(path);
            var controller = AnimatorController.CreateAnimatorControllerAtPath(path);
            foreach (var (name, type) in parameters) controller.AddParameter(name, type);
            return controller;
        }

        static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            int slash = path.LastIndexOf('/');
            EnsureFolder(path.Substring(0, slash));
            AssetDatabase.CreateFolder(path.Substring(0, slash), path.Substring(slash + 1));
        }
    }
}
