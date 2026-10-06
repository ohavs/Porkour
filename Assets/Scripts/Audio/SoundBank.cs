using System;
using System.Collections.Generic;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Real sounds + music for the game (Assets/Resources/SoundBank.asset, made by menu Porkour → Sounds).
    /// Drag audio files into a sound's Clips (several = a random one each time); empty = the placeholder from Sfx.
    /// Music: one looping track per mood (MusicPlayer). "Auto-fill" guesses clips from the imported files' names.
    /// </summary>
    [CreateAssetMenu(menuName = "Porkour/Sound Bank", fileName = "SoundBank")]
    public class SoundBank : ScriptableObject
    {
        [Serializable]
        public class SoundEntry
        {
            public string name;
            public Sound sound;
            public AudioClip[] clips = new AudioClip[0];
            [Range(0f, 2f)] public float volume = 1f;
        }

        [Serializable]
        public class MusicEntry
        {
            public string name;
            public MusicMood mood;
            public AudioClip clip;
            [Range(0f, 1f)] public float volume = 0.6f;
        }

        [Range(0f, 1f)] public float effectsVolume = 0.8f;
        [Range(0f, 1f)] public float musicVolume = 0.5f;
        public List<SoundEntry> sounds = new();
        public List<MusicEntry> music = new();

        static SoundBank cached;
        static bool loaded;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            cached = null;
            loaded = false;
        }

        /// <summary>The project's bank (null if it hasn't been made yet).</summary>
        public static SoundBank Instance
        {
            get
            {
                if (!loaded)
                {
                    cached = Resources.Load<SoundBank>("SoundBank");
                    loaded = true;
                }
                return cached;
            }
        }

        public SoundEntry Find(Sound sound)
        {
            foreach (var e in sounds)
                if (e.sound == sound) return e;
            return null;
        }

        /// <summary>Track for a mood (null = none assigned).</summary>
        public MusicEntry FindMusic(MusicMood mood)
        {
            foreach (var e in music)
                if (e.mood == mood && e.clip != null) return e;
            return null;
        }
    }
}
