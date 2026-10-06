using System;
using UnityEngine;

namespace Porkour
{
    public enum Sound : byte
    {
        Jump, Land, Step, Fart, Dash, Slam, Boing, Rope, Shoot, Suck, Smash, Splat, Bell, Ding, Click, Zap,
        Unlock, Engine, EngineLoop, Rumble, Grab, Throw, GrillCall, Spotted, Caught, Bonk, Sizzle, Escape, Win,
        Lose, Tick, Cluck, Baa, Alarm, Moo, Oink,
    }

    /// <summary>
    /// Sound effects. Real clips come from the SoundBank (menu Porkour → Sounds; several clips = random variant).
    /// Only the important event sounds (Bob, puzzle, round) fall back to a placeholder synthesized from code; frequent
    /// little sounds (steps, jumps, clucks, engine hum...) stay silent until a real clip is assigned.
    /// Anti-spam: the same sound plays at most MaxVoices at once and not faster than MinGap; far sounds are skipped.
    /// A file named like the Sound in Assets/Resources/Sfx/ (e.g. "Fart.wav") also works.
    /// Local only: call it from code that already runs on every PC (PlayEffect, RPCs, NetworkVariable changes).
    /// </summary>
    public static class Sfx
    {
        const int Rate = 22050;
        const int PoolSize = 24;
        const int MaxVoices = 2;
        const float MinGap = 0.08f;
        const float HearingRange = 32f;

        /// <summary>Sounds that use the synthesized placeholder when the SoundBank has no clip (the rest stay quiet).</summary>
        static readonly Sound[] PlaceholderSounds =
        {
            Sound.Fart, Sound.Slam, Sound.Boing, Sound.Shoot, Sound.Smash, Sound.Splat, Sound.Bell, Sound.Ding, Sound.Zap,
            Sound.Unlock, Sound.Engine, Sound.GrillCall, Sound.Spotted, Sound.Caught, Sound.Bonk, Sound.Sizzle, Sound.Escape,
            Sound.Win, Sound.Lose, Sound.Tick, Sound.Alarm, Sound.Oink,
        };

        /// <summary>Volume for all effects (the SoundBank's effectsVolume when there is one).</summary>
        public static float EffectsVolume => SoundBank.Instance != null ? SoundBank.Instance.effectsVolume : 0.8f;

        static AudioClip[][] clips; // variants per Sound (empty = silent)
        static float[] volumes, lastPlayed;
        static Sound[] voiceSound; // what each pool voice is playing
        static AudioSource[] pool;
        static int next;
        static readonly System.Random Rng = new(1234);

        enum Wave { Sine, Square, Saw, Tri, Noise }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            clips = null;
            volumes = null;
            lastPlayed = null;
            voiceSound = null;
            startOffsets.Clear();
            listener = null;
            pool = null;
            next = 0;
        }

        /// <summary>Make all clips once when the game starts, so nothing is generated mid-game.</summary>
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Prewarm() => EnsureClips();

        /// <summary>A clip for this sound (random variant).</summary>
        public static AudioClip Clip(Sound sound)
        {
            EnsureClips();
            var variants = clips[(int)sound];
            return variants.Length == 0 ? null : variants[UnityEngine.Random.Range(0, variants.Length)];
        }

        /// <summary>3D sound at a world position.</summary>
        public static void Play(Sound sound, Vector3 position, float volume = 1f, float pitchJitter = 0.08f)
            => PlayInternal(sound, position, volume, pitchJitter, true);

        /// <summary>2D sound (UI, round start/end).</summary>
        public static void PlayUi(Sound sound, float volume = 1f) => PlayInternal(sound, Vector3.zero, volume, 0f, false);

        /// <summary>Looping 3D sound attached to an object (e.g. a running generator). Not playing yet.</summary>
        public static AudioSource CreateLoop(Sound sound, Transform parent, float volume)
        {
            var src = parent.gameObject.AddComponent<AudioSource>();
            Setup3D(src);
            src.clip = Clip(sound); // null = silent loop (no placeholder hum)
            src.loop = true;
            src.volume = volume * volumes[(int)sound] * EffectsVolume;
            src.playOnAwake = false;
            return src;
        }

        static void PlayInternal(Sound sound, Vector3 position, float volume, float pitchJitter, bool spatial)
        {
            if (!Application.isPlaying) return;
            var clip = Clip(sound);
            if (clip == null) return;
            int s = (int)sound;
            if (Time.unscaledTime - lastPlayed[s] < MinGap) return; // the same sound a moment ago
            if (spatial && TooFar(position)) return;
            if (pool != null && pool[0] != null && CountPlaying(sound) >= MaxVoices) return;
            var src = NextSource();
            lastPlayed[s] = Time.unscaledTime;
            voiceSound[Array.IndexOf(pool, src)] = sound;
            src.transform.position = position;
            src.spatialBlend = spatial ? 1f : 0f;
            src.pitch = 1f + UnityEngine.Random.Range(-pitchJitter, pitchJitter);
            src.volume = Mathf.Clamp01(volume * volumes[s] * EffectsVolume);
            src.clip = clip;
            src.time = StartOffset(clip); // skip silence at the start of the file: the sound starts with the action
            src.Play();
        }

        static readonly System.Collections.Generic.Dictionary<AudioClip, float> startOffsets = new();

        /// <summary>Seconds of silence at the start of a clip (some sound files begin with a gap), measured once.</summary>
        static float StartOffset(AudioClip clip)
        {
            if (startOffsets.TryGetValue(clip, out float t)) return t;
            t = 0f;
            if (clip.loadType != AudioClipLoadType.Streaming && clip.samples > 0
                && (clip.loadState == AudioDataLoadState.Loaded || (clip.LoadAudioData() && clip.loadState == AudioDataLoadState.Loaded)))
            {
                int frames = Mathf.Min(clip.samples, clip.frequency * 2);
                var data = new float[frames * clip.channels];
                if (clip.GetData(data, 0))
                    for (int i = 0; i < data.Length; i++)
                        if (Mathf.Abs(data[i]) > 0.03f)
                        {
                            t = Mathf.Max(0f, (float)(i / clip.channels) / clip.frequency - 0.01f);
                            break;
                        }
            }
            startOffsets[clip] = t;
            return t;
        }

        static AudioListener listener;

        static bool TooFar(Vector3 position)
        {
            if (listener == null || !listener.isActiveAndEnabled) listener = UnityEngine.Object.FindAnyObjectByType<AudioListener>();
            return listener != null && (listener.transform.position - position).sqrMagnitude > HearingRange * HearingRange;
        }

        static int CountPlaying(Sound sound)
        {
            int n = 0;
            for (int i = 0; i < pool.Length; i++)
                if (pool[i].isPlaying && voiceSound[i] == sound) n++;
            return n;
        }

        static AudioSource NextSource()
        {
            if (pool == null || pool[0] == null)
            {
                var host = new GameObject("Sfx");
                UnityEngine.Object.DontDestroyOnLoad(host);
                pool = new AudioSource[PoolSize];
                voiceSound = new Sound[PoolSize];
                for (int i = 0; i < PoolSize; i++)
                {
                    var child = new GameObject("Voice");
                    child.transform.SetParent(host.transform, false);
                    pool[i] = child.AddComponent<AudioSource>();
                    pool[i].playOnAwake = false;
                    Setup3D(pool[i]);
                }
            }
            for (int i = 0; i < PoolSize; i++) // a free voice, else steal the oldest
            {
                var src = pool[(next + i) % PoolSize];
                if (src.isPlaying) continue;
                next = (next + i + 1) % PoolSize;
                return src;
            }
            var oldest = pool[next];
            next = (next + 1) % PoolSize;
            return oldest;
        }

        static void Setup3D(AudioSource src)
        {
            src.spatialBlend = 1f;
            src.rolloffMode = AudioRolloffMode.Linear;
            src.minDistance = 3f;
            src.maxDistance = HearingRange;
            src.dopplerLevel = 0f;
        }

        static void EnsureClips()
        {
            if (clips != null) return;
            var sounds = (Sound[])Enum.GetValues(typeof(Sound));
            clips = new AudioClip[sounds.Length][];
            volumes = new float[sounds.Length];
            lastPlayed = new float[sounds.Length];
            for (int i = 0; i < lastPlayed.Length; i++) lastPlayed[i] = -10f;
            var bank = SoundBank.Instance;
            foreach (var sound in sounds)
            {
                int i = (int)sound;
                volumes[i] = 1f;
                var entry = bank != null ? bank.Find(sound) : null;
                if (entry != null)
                {
                    var assigned = Array.FindAll(entry.clips ?? new AudioClip[0], c => c != null);
                    if (assigned.Length > 0)
                    {
                        clips[i] = assigned;
                        volumes[i] = entry.volume;
                        continue;
                    }
                }
                string name = sound.ToString();
                var custom = Resources.Load<AudioClip>("Sfx/" + name);
                if (custom != null) { clips[i] = new[] { custom }; continue; }
                if (Array.IndexOf(PlaceholderSounds, sound) < 0) { clips[i] = new AudioClip[0]; continue; }
                var data = Normalize(Make(sound));
                var clip = AudioClip.Create(name, data.Length, 1, Rate, false);
                clip.SetData(data, 0);
                clips[i] = new[] { clip };
            }
        }

        // ---------- recipes ----------

        static float[] Make(Sound sound)
        {
            switch (sound)
            {
                case Sound.Jump: return Voice(0.13f, u => 300f + 350f * u, Wave.Square, 0.22f, curve: 1.2f, cutoff: _ => 3000f);
                case Sound.Land:
                    return Mix(Voice(0.12f, u => 140f - 80f * u, Wave.Sine, 0.6f),
                        Voice(0.1f, null, Wave.Noise, 0.3f, curve: 3f, cutoff: _ => 500f));
                case Sound.Step:
                    return Mix(Voice(0.1f, u => 85f - 35f * u, Wave.Sine, 0.8f, curve: 2.5f),
                        Voice(0.06f, null, Wave.Noise, 0.3f, cutoff: _ => 350f));
                case Sound.Fart:
                    return Voice(0.75f, u => 70f + 35f * (1f - u) + 18f * Mathf.Sin(u * 0.75f * 2f * Mathf.PI * 13f), Wave.Square, 0.8f,
                        attack: 0.02f, curve: 0.8f, noise: 0.35f, cutoff: _ => 700f,
                        amp: s => 0.55f + 0.45f * Sqr(Mathf.Sin(2f * Mathf.PI * 27f * s)) * (0.7f + 0.3f * Hash((int)(s * 40f))));
                case Sound.Dash:
                    return Voice(0.35f, null, Wave.Noise, 0.6f, attack: 0.08f, curve: 1f, cutoff: u => 300f + 2500f * Mathf.Sin(Mathf.PI * u));
                case Sound.Slam:
                    return Mix(Voice(0.5f, u => 80f - 50f * u, Wave.Sine, 1f, curve: 1.8f),
                        Voice(0.3f, null, Wave.Noise, 0.6f, curve: 2.5f, cutoff: u => 900f - 600f * u));
                case Sound.Boing:
                    return Voice(0.4f, u => (200f + 300f * u) * (1f + 0.25f * Mathf.Sin(2f * Mathf.PI * 16f * u * 0.4f)), Wave.Sine, 0.45f, curve: 1.3f);
                case Sound.Rope:
                    return Voice(0.45f, null, Wave.Noise, 0.35f, attack: 0.02f, curve: 1.5f, cutoff: u => 2500f - 1800f * u);
                case Sound.Shoot:
                    return Mix(Voice(0.13f, u => 1100f - 850f * u, Wave.Square, 0.25f, curve: 1.5f, cutoff: _ => 4000f),
                        Voice(0.06f, null, Wave.Noise, 0.2f, cutoff: _ => 3000f));
                case Sound.Suck:
                    return Voice(0.5f, null, Wave.Noise, 0.4f, attack: 0.15f, curve: 0.6f, cutoff: u => 400f + 2600f * u);
                case Sound.Smash:
                    return Mix(Voice(0.35f, null, Wave.Noise, 0.7f, curve: 2f, cutoff: u => 2500f - 1500f * u,
                            amp: s => 0.4f + 0.6f * Hash((int)(s * 60f))),
                        Voice(0.2f, u => 110f - 60f * u, Wave.Sine, 0.6f));
                case Sound.Splat:
                    return Mix(Voice(0.18f, null, Wave.Noise, 0.6f, curve: 3f, cutoff: u => 1200f - 900f * u),
                        Voice(0.12f, u => 220f - 140f * u, Wave.Sine, 0.4f));
                case Sound.Bell: return BellTone(660f, 1.6f, 0.6f);
                case Sound.Ding: return BellTone(1320f, 0.5f, 0.4f);
                case Sound.Click:
                    return Seq(Voice(0.025f, _ => 1800f, Wave.Square, 0.25f, curve: 1f), Voice(0.03f, _ => 1100f, Wave.Square, 0.2f, curve: 1f));
                case Sound.Zap:
                    return Voice(0.4f, u => 110f + 40f * Hash((int)(u * 30f)), Wave.Saw, 0.5f, curve: 1.2f, noise: 0.45f, cutoff: _ => 5000f,
                        amp: s => 0.4f + 0.6f * Hash((int)(s * 90f) + 7));
                case Sound.Unlock:
                    return Seq(Voice(0.04f, null, Wave.Noise, 0.3f, cutoff: _ => 4000f),
                        Voice(0.1f, _ => 660f, Wave.Tri, 0.4f, curve: 1.2f), Voice(0.4f, _ => 990f, Wave.Tri, 0.4f, curve: 1.5f));
                case Sound.Engine:
                    return Voice(1.4f, u => 38f + 30f * u, Wave.Saw, 0.6f, attack: 0.05f, curve: 0.5f, cutoff: _ => 500f,
                        amp: s => 0.55f + 0.45f * Mathf.Abs(Mathf.Sin(2f * Mathf.PI * 7f * s)));
                case Sound.EngineLoop: // exactly 1 s, whole cycles → loops without a click
                    return Voice(1f, _ => 55f, Wave.Saw, 0.5f, attack: 0f, curve: 0f, cutoff: _ => 450f,
                        amp: s => 0.6f + 0.4f * Mathf.Abs(Mathf.Sin(2f * Mathf.PI * 4f * s)));
                case Sound.Rumble:
                    return Mix(Voice(1.2f, null, Wave.Noise, 0.6f, attack: 0.1f, curve: 1f, cutoff: _ => 180f),
                        Voice(1.2f, _ => 48f, Wave.Saw, 0.3f, attack: 0.1f, curve: 1f, cutoff: _ => 300f));
                case Sound.Grab: return Voice(0.07f, u => 450f + 500f * u, Wave.Sine, 0.4f, curve: 1.5f);
                case Sound.Throw:
                    return Voice(0.22f, null, Wave.Noise, 0.45f, attack: 0.03f, curve: 1f, cutoff: u => 400f + 1800f * Mathf.Sin(Mathf.PI * u));
                case Sound.GrillCall:
                    return Seq(BellTone(1500f, 0.22f, 0.4f), BellTone(1500f, 0.22f, 0.4f), BellTone(1500f, 0.7f, 0.4f));
                case Sound.Spotted:
                    return Seq(Voice(0.09f, _ => 660f, Wave.Square, 0.3f, curve: 0.5f, cutoff: _ => 3000f),
                        Voice(0.3f, _ => 990f, Wave.Square, 0.3f, curve: 1.2f, cutoff: _ => 3000f));
                case Sound.Caught:
                    return Seq(Note(392f, 0.18f, Wave.Saw, 1500f), Note(330f, 0.18f, Wave.Saw, 1500f),
                        Voice(0.5f, u => 262f * (1f + 0.03f * Mathf.Sin(2f * Mathf.PI * 6f * u * 0.5f)), Wave.Saw, 0.35f, curve: 1f, cutoff: _ => 1500f));
                case Sound.Bonk:
                    return Mix(Voice(0.18f, u => 700f - 500f * u, Wave.Sine, 0.5f), Voice(0.03f, null, Wave.Noise, 0.3f, cutoff: _ => 4000f));
                case Sound.Sizzle:
                    return Voice(1.6f, null, Wave.Noise, 0.35f, attack: 0.05f, curve: 0.8f, highpass: 2500f,
                        amp: s => 0.5f + 0.5f * Hash((int)(s * 40f)));
                case Sound.Escape:
                    return Seq(Note(523f, 0.09f, Wave.Tri), Note(659f, 0.09f, Wave.Tri), Note(784f, 0.09f, Wave.Tri), Note(1047f, 0.3f, Wave.Tri));
                case Sound.Win:
                    return Seq(Note(523f, 0.12f, Wave.Square, 2500f), Note(659f, 0.12f, Wave.Square, 2500f), Note(784f, 0.12f, Wave.Square, 2500f),
                        Note(1047f, 0.3f, Wave.Square, 2500f), Note(784f, 0.12f, Wave.Square, 2500f), Note(1047f, 0.7f, Wave.Square, 2500f));
                case Sound.Lose:
                    return Seq(Note(392f, 0.3f, Wave.Saw, 1200f), Note(370f, 0.3f, Wave.Saw, 1200f), Note(349f, 0.3f, Wave.Saw, 1200f),
                        Voice(1f, u => 330f * (1f + 0.025f * Mathf.Sin(2f * Mathf.PI * 6f * u)), Wave.Saw, 0.35f, attack: 0.01f, curve: 1f, cutoff: _ => 1200f));
                case Sound.Tick: return Voice(0.035f, _ => 1200f, Wave.Square, 0.2f, curve: 1f);
                case Sound.Cluck:
                    return Seq(Voice(0.06f, u => 700f + 400f * u, Wave.Square, 0.2f, curve: 1f, cutoff: _ => 2500f), Silence(0.04f),
                        Voice(0.08f, u => 900f - 300f * u, Wave.Square, 0.2f, curve: 1.2f, cutoff: _ => 2500f));
                case Sound.Oink: // "oink-oink": two short nasal grunts
                    return Seq(Voice(0.15f, u => 240f - 80f * u + 30f * Mathf.Sin(2f * Mathf.PI * 4.5f * u), Wave.Saw, 0.32f,
                            attack: 0.01f, curve: 1.2f, cutoff: _ => 1100f), Silence(0.07f),
                        Voice(0.2f, u => 260f - 110f * u + 30f * Mathf.Sin(2f * Mathf.PI * 6f * u), Wave.Saw, 0.32f,
                            attack: 0.01f, curve: 1.1f, cutoff: _ => 1000f));
                case Sound.Baa:
                    return Voice(0.6f, u => 290f * (1f + 0.04f * Mathf.Sin(2f * Mathf.PI * 7f * u * 0.6f)), Wave.Saw, 0.35f,
                        attack: 0.05f, curve: 0.7f, cutoff: _ => 1100f);
                case Sound.Alarm:
                    return Voice(1.5f, u => 650f + 250f * Mathf.Sin(2f * Mathf.PI * 2f * u * 1.5f), Wave.Square, 0.25f,
                        attack: 0.02f, curve: 0.3f, cutoff: _ => 2000f);
                default: return Silence(0.05f);
            }
        }

        // ---------- tiny synth ----------

        /// <summary>
        /// One synthesized voice, peak-normalized to `gain`. freq/cutoff get the normalized time u (0..1),
        /// amp gets seconds. Envelope: linear attack, then (1-t)^curve decay (curve 0 = no decay).
        /// </summary>
        static float[] Voice(float dur, Func<float, float> freq, Wave wave, float gain, float attack = 0.005f, float curve = 2f,
            float noise = 0f, Func<float, float> cutoff = null, Func<float, float> amp = null, float highpass = 0f)
        {
            int n = Mathf.Max(1, (int)(dur * Rate));
            var data = new float[n];
            double phase = 0.0;
            float lp = 0f, hp = 0f;
            float hpAlpha = highpass > 0f ? 1f - Mathf.Exp(-2f * Mathf.PI * highpass / Rate) : 0f;
            for (int i = 0; i < n; i++)
            {
                float s = i / (float)Rate;
                float u = i / (float)n;
                float x;
                if (wave == Wave.Noise) x = Noise();
                else
                {
                    phase += (freq != null ? freq(u) : 440f) / Rate;
                    phase -= Math.Floor(phase);
                    x = Osc(wave, (float)phase);
                    if (noise > 0f) x = x * (1f - noise) + Noise() * noise;
                }
                if (cutoff != null)
                {
                    float a = 1f - Mathf.Exp(-2f * Mathf.PI * cutoff(u) / Rate);
                    lp += (x - lp) * a;
                    x = lp;
                }
                if (highpass > 0f)
                {
                    hp += (x - hp) * hpAlpha;
                    x -= hp;
                }
                float env = attack > 0f && s < attack ? s / attack
                    : curve <= 0f ? 1f
                    : Mathf.Pow(1f - Mathf.Clamp01((s - attack) / Mathf.Max(0.0001f, dur - attack)), curve);
                if (amp != null) env *= amp(s);
                data[i] = x * env;
            }
            return Normalize(data, gain);
        }

        static float[] Note(float freq, float dur, Wave wave, float cutoff = 0f)
            => Voice(dur, _ => freq, wave, 0.35f, attack: 0.01f, curve: 0.8f, cutoff: cutoff > 0f ? _ => cutoff : null);

        /// <summary>Inharmonic partials with long decay - bells, dings.</summary>
        static float[] BellTone(float freq, float dur, float gain)
        {
            float[] ratios = { 1f, 2f, 2.76f, 4.07f, 5.4f };
            float[] amps = { 1f, 0.55f, 0.4f, 0.22f, 0.12f };
            int n = Mathf.Max(1, (int)(dur * Rate));
            var data = new float[n];
            for (int i = 0; i < n; i++)
            {
                float s = i / (float)Rate;
                float sum = 0f;
                for (int k = 0; k < ratios.Length; k++)
                    sum += amps[k] * Mathf.Sin(2f * Mathf.PI * freq * ratios[k] * s) * Mathf.Exp(-s * (3f + 3f * k) / dur);
                data[i] = sum * Mathf.Clamp01(s / 0.002f);
            }
            return Normalize(data, gain);
        }

        static float Osc(Wave wave, float p) => wave switch
        {
            Wave.Sine => Mathf.Sin(2f * Mathf.PI * p),
            Wave.Square => p < 0.5f ? 1f : -1f,
            Wave.Saw => 2f * p - 1f,
            Wave.Tri => 1f - 4f * Mathf.Abs(p - 0.5f),
            _ => Noise(),
        };

        static float Noise() => (float)(Rng.NextDouble() * 2.0 - 1.0);

        static float Hash(int i)
        {
            float x = Mathf.Sin(i * 12.9898f) * 43758.5453f;
            return x - Mathf.Floor(x);
        }

        static float Sqr(float x) => x * x;

        static float[] Silence(float dur) => new float[Mathf.Max(1, (int)(dur * Rate))];

        static float[] Seq(params float[][] parts)
        {
            int total = 0;
            foreach (var p in parts) total += p.Length;
            var data = new float[total];
            int at = 0;
            foreach (var p in parts)
            {
                Array.Copy(p, 0, data, at, p.Length);
                at += p.Length;
            }
            return data;
        }

        static float[] Mix(params float[][] parts)
        {
            int total = 0;
            foreach (var p in parts) total = Mathf.Max(total, p.Length);
            var data = new float[total];
            foreach (var p in parts)
                for (int i = 0; i < p.Length; i++) data[i] += p[i];
            return data;
        }

        /// <summary>Scale to the given peak (default: only scale down when it would clip).</summary>
        static float[] Normalize(float[] data, float peak = -1f)
        {
            float max = 0f;
            foreach (float v in data) max = Mathf.Max(max, Mathf.Abs(v));
            if (max < 0.0001f) return data;
            float scale = peak > 0f ? peak / max : max > 0.95f ? 0.95f / max : 1f;
            for (int i = 0; i < data.Length; i++) data[i] *= scale;
            return data;
        }
    }
}
