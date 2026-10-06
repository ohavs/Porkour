using UnityEngine;

namespace Porkour
{
    public enum MusicMood : byte { None, Calm, Danger, Chase, FinalHunt, Theme }

    /// <summary>
    /// Background music (local, one per PC): the HUD picks a mood from the game state (round intro = Theme, Bob away =
    /// Calm, Grill Call = Danger, chase/carry = Chase, last minute = FinalHunt) and the tracks from the SoundBank crossfade.
    /// A missing mood falls back to a calmer one; no tracks at all = silence. M mutes (see PlayerHud).
    /// </summary>
    public class MusicPlayer : MonoBehaviour
    {
        const float FadeTime = 1.5f;

        static MusicPlayer instance;

        /// <summary>Music switched off by the player.</summary>
        public static bool Muted { get; set; }

        AudioSource[] sources;
        float[] targets;
        int active;
        MusicMood mood = (MusicMood)255;
        AudioClip playing;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            instance = null;
            Muted = false;
        }

        public static void SetMood(MusicMood newMood)
        {
            if (instance == null)
            {
                if (newMood == MusicMood.None) return;
                var go = new GameObject("Music");
                DontDestroyOnLoad(go);
                instance = go.AddComponent<MusicPlayer>();
            }
            instance.Want(newMood);
        }

        void Awake()
        {
            sources = new AudioSource[2];
            targets = new float[2];
            for (int i = 0; i < 2; i++)
            {
                sources[i] = gameObject.AddComponent<AudioSource>();
                sources[i].loop = true;
                sources[i].playOnAwake = false;
                sources[i].spatialBlend = 0f;
                sources[i].volume = 0f;
            }
        }

        void Want(MusicMood newMood)
        {
            if (newMood == mood) return;
            mood = newMood;
            var entry = Pick(newMood);
            var clip = entry != null ? entry.clip : null;
            if (clip == playing) { SetTargetVolume(entry); return; }
            playing = clip;
            targets[active] = 0f; // fade the old track out
            if (clip == null) return;
            active = 1 - active;
            var src = sources[active];
            src.clip = clip;
            src.volume = 0f;
            src.Play();
            SetTargetVolume(entry);
        }

        void SetTargetVolume(SoundBank.MusicEntry entry)
        {
            var bank = SoundBank.Instance;
            targets[active] = entry == null || bank == null ? 0f : entry.volume * bank.musicVolume;
        }

        /// <summary>Track for a mood, falling back to calmer moods when one is missing.</summary>
        static SoundBank.MusicEntry Pick(MusicMood m)
        {
            var bank = SoundBank.Instance;
            if (bank == null || m == MusicMood.None) return null;
            if (m == MusicMood.Theme) return bank.FindMusic(MusicMood.Theme) ?? bank.FindMusic(MusicMood.Calm);
            for (var tryMood = m; tryMood >= MusicMood.Calm; tryMood--)
            {
                var entry = bank.FindMusic(tryMood);
                if (entry != null) return entry;
            }
            return null;
        }

        void Update()
        {
            float step = Time.unscaledDeltaTime / FadeTime;
            for (int i = 0; i < 2; i++)
            {
                float target = Muted ? 0f : targets[i];
                sources[i].volume = Mathf.MoveTowards(sources[i].volume, target, step);
                if (sources[i].isPlaying && i != active && sources[i].volume <= 0f) sources[i].Stop();
            }
        }
    }
}
