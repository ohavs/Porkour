using Unity.Netcode;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Porkour
{
    public enum RoundPhase : byte { Intro, Playing, Won, Lost }
    public enum LoseReason : byte { None, TimeUp, Grilled }

    /// <summary>
    /// One round of Porkour (server runs it, every PC reads the synced state for the HUD):
    /// Intro (a few seconds, read your role) → Playing (10 min timer) → Won / Lost → results → a fresh round
    /// (NetworkGame respawns the level, pig types are shuffled again).
    /// Win: every pig that a player controls reaches the getaway truck (EscapeZone) - the exit only opens when the
    /// four escape objectives (padlock, electric fence, generator, bullseyes) are done.
    /// Lose: time runs out, or Bob grills maxGrills pigs. Last minute: Bob's final hunt.
    /// Lives as its own networked object (spawned once by NetworkGame, survives restarts). Host debug: R = restart.
    /// </summary>
    public class RoundManager : NetworkBehaviour
    {
        public static RoundManager Instance { get; private set; }

        public readonly struct Objective
        {
            public readonly string Name, Hint;
            public readonly int[] Channels;

            public Objective(string name, string hint, params int[] channels)
            {
                Name = name;
                Hint = hint;
                Channels = channels;
            }
        }

        /// <summary>The escape plan (HUD checklist + lamps over the exit). Exit gate = Padlock + Generator + all Targets.</summary>
        public static readonly Objective[] Objectives =
        {
            new("Padlock", "bring the KEY from the roof beams", ChannelIds.Padlock),
            new("Electric fence", "smash the FUSE BOX in the tool shed (Heavy)", ChannelIds.Fence),
            new("Gate motor", "fart into the GENERATOR on the hayloft (Gassy)", ChannelIds.Generator),
            new("Gate latch", "shoot the 3 BULLSEYES (Armed)", ChannelIds.Target1, ChannelIds.Target2, ChannelIds.Target3),
        };

        static readonly int[] TrackedChannels =
            { ChannelIds.Padlock, ChannelIds.Fence, ChannelIds.Generator, ChannelIds.Target1, ChannelIds.Target2, ChannelIds.Target3 };

        [Header("Timing (seconds)")]
        public float introTime = 8f;
        public float roundTime = 600f;
        [Tooltip("Bob's final hunt starts when this much time is left.")]
        public float finalHuntTime = 60f;
        public float resultsTime = 10f;
        [Header("Rules")]
        [Tooltip("Pigs Bob may grill before the round is lost.")]
        public int maxGrills = 3;

        readonly NetworkVariable<RoundPhase> phase = new();
        readonly NetworkVariable<double> phaseEnd = new();
        readonly NetworkVariable<int> grills = new();
        readonly NetworkVariable<int> channelBits = new();
        readonly NetworkVariable<int> escaped = new();
        readonly NetworkVariable<int> players = new();
        readonly NetworkVariable<LoseReason> loseReason = new();
        readonly NetworkVariable<float> finishTime = new();
        readonly NetworkVariable<int> roundNumber = new();

        public RoundPhase Phase => phase.Value;
        public bool IsPlaying => IsSpawned && phase.Value == RoundPhase.Playing;
        public bool IsOver => IsSpawned && (phase.Value == RoundPhase.Won || phase.Value == RoundPhase.Lost);
        /// <summary>Seconds left in the current phase (intro countdown, round timer, results).</summary>
        public float PhaseTimeLeft => IsSpawned ? Mathf.Max(0f, (float)(phaseEnd.Value - NetworkManager.ServerTime.Time)) : 0f;
        public float RoundTimeLeft => phase.Value == RoundPhase.Playing ? PhaseTimeLeft : phase.Value == RoundPhase.Intro ? roundTime : 0f;
        public int Grills => grills.Value;
        public int EscapedCount => escaped.Value;
        public int PlayerCount => players.Value;
        public LoseReason Reason => loseReason.Value;
        /// <summary>Seconds the team needed to escape (Won only).</summary>
        public float FinishTime => finishTime.Value;
        public int RoundNumber => roundNumber.Value;
        public bool AllObjectivesDone
        {
            get
            {
                for (int i = 0; i < Objectives.Length; i++)
                    if (!ObjectiveDone(i)) return false;
                return true;
            }
        }

        bool finalHuntStarted;

        public override void OnNetworkSpawn() => Instance = this;

        public override void OnNetworkDespawn()
        {
            if (Instance == this) Instance = null;
        }

        /// <summary>How many of objective i's switches are on (every PC).</summary>
        public void ObjectiveProgress(int i, out int done, out int total)
        {
            var channels = Objectives[i].Channels;
            total = channels.Length;
            done = 0;
            foreach (int c in channels)
            {
                int bit = System.Array.IndexOf(TrackedChannels, c);
                if (bit >= 0 && (channelBits.Value & (1 << bit)) != 0) done++;
            }
        }

        public bool ObjectiveDone(int i)
        {
            ObjectiveProgress(i, out int done, out int total);
            return done == total;
        }

        // ---------- server ----------

        /// <summary>Server: a fresh round on a freshly spawned level (called by NetworkGame).</summary>
        public void BeginRound()
        {
            if (!IsServer) return;
            finalHuntStarted = false;
            grills.Value = 0;
            channelBits.Value = 0;
            escaped.Value = 0;
            loseReason.Value = LoseReason.None;
            finishTime.Value = 0f;
            roundNumber.Value++;
            SetPhase(RoundPhase.Intro, introTime);
        }

        void SetPhase(RoundPhase newPhase, float duration)
        {
            phase.Value = newPhase;
            phaseEnd.Value = NetworkManager.ServerTime.Time + duration;
        }

        void Update()
        {
            if (!IsServer || !IsSpawned) return;
            if (IsHost && Keyboard.current != null && Keyboard.current.rKey.wasPressedThisFrame)
            {
                Restart();
                return;
            }

            switch (phase.Value)
            {
                case RoundPhase.Intro:
                    if (PhaseTimeLeft <= 0f) StartPlaying();
                    break;

                case RoundPhase.Playing:
                    UpdateObjectives();
                    UpdateEscapes();
                    if (phase.Value != RoundPhase.Playing) break; // won just now
                    float left = PhaseTimeLeft;
                    if (!finalHuntStarted && left <= finalHuntTime)
                    {
                        finalHuntStarted = true;
                        if (FarmerBob.Instance != null) FarmerBob.Instance.StartFinalHunt();
                        AnnounceRpc("ONE MINUTE LEFT - Bob's final hunt!");
                        RoundSoundRpc(Sound.Alarm);
                    }
                    if (left <= 0f) Lose(LoseReason.TimeUp);
                    break;

                case RoundPhase.Won:
                case RoundPhase.Lost:
                    if (PhaseTimeLeft <= 0f) Restart();
                    break;
            }
        }

        void Restart()
        {
            var game = NetworkManager.GetComponent<NetworkGame>();
            if (game != null) game.RestartRound();
        }

        void StartPlaying()
        {
            SetPhase(RoundPhase.Playing, roundTime);
            if (FarmerBob.Instance != null) FarmerBob.Instance.ResetCallTimer();
            AnnounceRpc("GO! Open the 4 locks on the exit and escape before Bob's BBQ!");
            RoundSoundRpc(Sound.Escape);
        }

        void UpdateObjectives()
        {
            int bits = 0;
            for (int i = 0; i < TrackedChannels.Length; i++)
                if (PuzzleSignals.IsOn(TrackedChannels[i])) bits |= 1 << i;
            if (bits == channelBits.Value) return;

            bool[] before = new bool[Objectives.Length];
            for (int i = 0; i < Objectives.Length; i++) before[i] = ObjectiveDone(i);
            channelBits.Value = bits;
            for (int i = 0; i < Objectives.Length; i++)
            {
                if (before[i] || !ObjectiveDone(i)) continue;
                AnnounceRpc(AllObjectivesDone
                    ? "THE EXIT IS OPEN! Everyone into the getaway truck!"
                    : $"{Objectives[i].Name}: done!");
                RoundSoundRpc(AllObjectivesDone ? Sound.Win : Sound.Escape);
            }
        }

        void UpdateEscapes()
        {
            int owned = 0, free = 0;
            foreach (var pig in PigController.All)
            {
                if (pig == null || !pig.TryGetComponent(out NetworkObject obj) || !obj.IsSpawned) continue;
                if (!pig.Escaped && EscapeZone.IsInside(pig.Body.position))
                {
                    pig.Escaped = true;
                    AnnounceRpc($"The {PigTypes.Info(pig.Type).Name} pig escaped!");
                    EscapeFxRpc(pig.Body.position);
                }
                if (pig.Owner == null) continue;
                owned++;
                if (pig.Escaped) free++;
            }
            if (players.Value != owned) players.Value = owned;
            if (escaped.Value != free) escaped.Value = free;
            if (owned > 0 && free == owned) Win();
        }

        /// <summary>Server: Bob grilled a pig.</summary>
        public void OnPigGrilled(string pigName)
        {
            if (!IsServer || phase.Value != RoundPhase.Playing) return;
            grills.Value++;
            if (grills.Value >= maxGrills)
            {
                AnnounceRpc($"The {pigName} pig got grilled - that's {maxGrills}!");
                Lose(LoseReason.Grilled);
                return;
            }
            AnnounceRpc($"The {pigName} pig got grilled! ({grills.Value}/{maxGrills}) - it's back in the pen");
        }

        void Win()
        {
            finishTime.Value = roundTime - PhaseTimeLeft;
            SetPhase(RoundPhase.Won, resultsTime);
            RoundSoundRpc(Sound.Win);
            if (FarmerBob.Instance != null) FarmerBob.Instance.Say("Noooo! My BBQ!");
        }

        void Lose(LoseReason reason)
        {
            loseReason.Value = reason;
            SetPhase(RoundPhase.Lost, resultsTime);
            RoundSoundRpc(Sound.Lose);
            if (FarmerBob.Instance != null) FarmerBob.Instance.Say("BBQ TIME! Hahaha!");
        }

        // ---------- every PC ----------

        [Rpc(SendTo.Everyone)]
        void AnnounceRpc(string text) => GameEvents.Announce(text);

        [Rpc(SendTo.Everyone)]
        void RoundSoundRpc(Sound sound) => Sfx.PlayUi(sound, 0.8f);

        [Rpc(SendTo.Everyone)]
        void EscapeFxRpc(Vector3 position)
        {
            Sfx.Play(Sound.Escape, position, 1f, 0f);
            for (int i = 0; i < 8; i++)
                SmokeCloud.SpawnMoving(position, Random.insideUnitSphere * 3f + Vector3.up * 2f, 0.15f, 0.8f,
                    Color.HSVToRGB(Random.value, 0.7f, 1f) * new Color(1f, 1f, 1f, 0.9f));
        }
    }
}
