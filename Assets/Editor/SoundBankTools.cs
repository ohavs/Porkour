using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Porkour.EditorTools
{
    /// <summary>
    /// Menu "Porkour/Sounds/...": makes the SoundBank (one slot per game sound + music moods) and fills empty slots
    /// with imported audio files whose names fit (fart, footstep, bell, click...). The user checks / fixes by dragging.
    /// </summary>
    public static class SoundBankTools
    {
        const string BankPath = "Assets/Resources/SoundBank.asset";

        /// <summary>File-name words per sound. "a+b" = both words must appear.</summary>
        static readonly Dictionary<Sound, string[]> Keywords = new()
        {
            { Sound.Jump, new[] { "jump" } },
            { Sound.Land, new[] { "land", "thud" } },
            { Sound.Step, new[] { "footstep", "step" } },
            { Sound.Fart, new[] { "fart", "toot" } },
            { Sound.Dash, new[] { "whoosh", "swoosh", "dash" } },
            { Sound.Slam, new[] { "slam", "boom", "thump", "impact+heavy" } },
            { Sound.Boing, new[] { "boing", "spring", "bounce" } },
            { Sound.Rope, new[] { "rope", "cloth", "rustle" } },
            { Sound.Shoot, new[] { "slingshot", "shoot", "pew", "pop" } },
            { Sound.Suck, new[] { "suck", "vacuum", "inhale" } },
            { Sound.Smash, new[] { "smash", "break", "crash", "shatter", "destroy" } },
            { Sound.Splat, new[] { "splat", "squish", "splash" } },
            { Sound.Bell, new[] { "bell" } },
            { Sound.Ding, new[] { "ding", "chime", "confirmation" } },
            { Sound.Click, new[] { "click", "switch", "toggle" } },
            { Sound.Zap, new[] { "zap", "electric", "shock", "spark" } },
            { Sound.Unlock, new[] { "unlock", "key", "lock" } },
            { Sound.Engine, new[] { "engine+start", "motor+start", "engine", "motor", "generator" } },
            { Sound.EngineLoop, new[] { "engine+loop", "motor+loop", "engine+idle" } },
            { Sound.Rumble, new[] { "rumble", "door", "gate", "slide" } },
            { Sound.Grab, new[] { "grab", "pickup", "pick+up" } },
            { Sound.Throw, new[] { "throw", "toss", "whoosh" } },
            { Sound.GrillCall, new[] { "dinner", "triangle", "bell" } },
            { Sound.Spotted, new[] { "alert", "spotted", "surprise", "exclaim" } },
            { Sound.Caught, new[] { "caught", "trombone", "sad", "fail" } },
            { Sound.Bonk, new[] { "bonk", "punch", "hit" } },
            { Sound.Sizzle, new[] { "sizzle", "fry", "grill", "fire" } },
            { Sound.Escape, new[] { "success", "powerup", "power+up", "collect" } },
            { Sound.Win, new[] { "win", "victory", "fanfare" } },
            { Sound.Lose, new[] { "lose", "gameover", "game+over", "defeat" } },
            { Sound.Tick, new[] { "tick", "clock" } },
            { Sound.Cluck, new[] { "chicken", "cluck", "hen" } },
            { Sound.Baa, new[] { "sheep", "baa" } },
            { Sound.Alarm, new[] { "alarm", "siren", "warning" } },
        };

        static readonly Dictionary<MusicMood, string[]> MusicKeywords = new()
        {
            { MusicMood.Calm, new[] { "calm", "menu", "farm", "happy", "fishin", "theme", "peace" } },
            { MusicMood.Danger, new[] { "danger", "tense", "sneak", "suspense", "stealth" } },
            { MusicMood.Chase, new[] { "chase", "action", "fast", "run", "battle" } },
            { MusicMood.FinalHunt, new[] { "final", "boss", "intense", "hunt" } },
        };

        [MenuItem("Porkour/Sounds/Open Sound Bank")]
        static void OpenBank()
        {
            var bank = EnsureBank();
            Selection.activeObject = bank;
            EditorGUIUtility.PingObject(bank);
        }

        [MenuItem("Porkour/Sounds/Auto-fill From Imported Audio")]
        static void AutoFill()
        {
            var bank = EnsureBank();
            var effects = new List<(string path, string name)>();
            var musicFiles = new List<(string path, string name)>();
            foreach (var guid in AssetDatabase.FindAssets("t:AudioClip"))
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                if (!path.StartsWith("Assets/")) continue;
                string name = Normalize(Path.GetFileNameWithoutExtension(path));
                if (path.ToLowerInvariant().Contains("music")) musicFiles.Add((path, name));
                else effects.Add((path, name));
            }
            effects.Sort((a, b) => string.CompareOrdinal(a.path, b.path));
            musicFiles.Sort((a, b) => string.CompareOrdinal(a.path, b.path));

            int filled = 0;
            var missing = new List<string>();
            foreach (var entry in bank.sounds)
            {
                if (entry.clips != null && Array.Exists(entry.clips, c => c != null)) continue;
                var found = new List<AudioClip>();
                if (Keywords.TryGetValue(entry.sound, out var words))
                    foreach (var word in words) // first keyword that matches anything wins
                    {
                        foreach (var (path, name) in effects)
                            if (Matches(name, word) && found.Count < 4) found.Add(AssetDatabase.LoadAssetAtPath<AudioClip>(path));
                        if (found.Count > 0) break;
                    }
                if (found.Count > 0) { entry.clips = found.ToArray(); filled++; }
                else missing.Add(entry.name);
            }

            int music = 0;
            var used = new HashSet<string>();
            foreach (var entry in bank.music)
                if (entry.clip != null) used.Add(AssetDatabase.GetAssetPath(entry.clip));
            foreach (var entry in bank.music)
            {
                if (entry.clip != null || !MusicKeywords.TryGetValue(entry.mood, out var words)) continue;
                foreach (var (path, name) in musicFiles)
                {
                    if (used.Contains(path) || !Array.Exists(words, w => Matches(name, w))) continue;
                    entry.clip = AssetDatabase.LoadAssetAtPath<AudioClip>(path);
                    used.Add(path);
                    music++;
                    break;
                }
            }
            // Still no calm track? Take the first unused file from a Music folder.
            var calm = bank.music.Find(m => m.mood == MusicMood.Calm);
            if (calm != null && calm.clip == null)
                foreach (var (path, _) in musicFiles)
                    if (!used.Contains(path)) { calm.clip = AssetDatabase.LoadAssetAtPath<AudioClip>(path); music++; break; }

            EditorUtility.SetDirty(bank);
            AssetDatabase.SaveAssets();
            Selection.activeObject = bank;
            EditorUtility.DisplayDialog("Porkour - sounds",
                $"Filled {filled} sounds and {music} music tracks from {effects.Count + musicFiles.Count} audio files.\n\n" +
                (missing.Count > 0 ? "Still using placeholders: " + string.Join(", ", missing) + "\n\n" : "") +
                "Check the Sound Bank in the Inspector: drag other files into any slot to change it, " +
                "or empty a slot to get the placeholder back. Music = files inside a folder named Music.", "OK");
        }

        /// <summary>Load (or make) the bank and make sure every sound / music mood has a slot.</summary>
        static SoundBank EnsureBank()
        {
            var bank = AssetDatabase.LoadAssetAtPath<SoundBank>(BankPath);
            if (bank == null)
            {
                if (!AssetDatabase.IsValidFolder("Assets/Resources")) AssetDatabase.CreateFolder("Assets", "Resources");
                bank = ScriptableObject.CreateInstance<SoundBank>();
                AssetDatabase.CreateAsset(bank, BankPath);
            }
            foreach (Sound sound in Enum.GetValues(typeof(Sound)))
                if (bank.Find(sound) == null) bank.sounds.Add(new SoundBank.SoundEntry { name = sound.ToString(), sound = sound });
            foreach (MusicMood mood in Enum.GetValues(typeof(MusicMood)))
                if (mood != MusicMood.None && !bank.music.Exists(m => m.mood == mood))
                    bank.music.Add(new SoundBank.MusicEntry { name = mood.ToString(), mood = mood });
            EditorUtility.SetDirty(bank);
            AssetDatabase.SaveAssets();
            return bank;
        }

        static string Normalize(string fileName) => fileName.ToLowerInvariant().Replace('-', '_').Replace(' ', '_').Replace('.', '_');

        static bool Matches(string name, string keyword)
        {
            foreach (var part in keyword.Split('+'))
                if (!name.Contains(part)) return false;
            return true;
        }
    }
}
