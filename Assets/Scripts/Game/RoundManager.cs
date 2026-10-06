using Unity.Netcode;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Porkour
{
    public enum RoundPhase : byte { Intro, Playing, Won, Lost }
    public enum LoseReason : byte { None, TimeUp, Grilled }

    /// <summary>
    /// One round on one of Bob's farms (server runs it, every PC reads the synced state for the HUD):
    /// Intro (read your role) → Playing (12 min) → Won / Lost → results + payout → a fresh round (NetworkGame respawns
    /// the level, pig types are shuffled again).
    /// Missions: 3 required (break out of the barn, steal the truck keys, open the farm gate) + 2 bonus (pie heist, ruin
    /// the BBQ). Win: required missions done and every pig a player controls in the getaway truck (EscapeZone).
    /// Coins (team): coin pickups, rescues from Bob's cage, bonus missions, loot in the truck, winning. Payout = coins + XP,
    /// saved on every player's PC (PlayerProgress) for the shop later. Stars: escaped, nobody grilled, fast, both bonuses.
    /// Lose: time runs out, or Bob grills maxGrills pigs. Last minute: Bob's final hunt. Host debug: R = restart.
    /// </summary>
    public class RoundManager : NetworkBehaviour
    {
        public static RoundManager Instance { get; private set; }

        /// <summary>One step of a mission: done while all its channels are on.</summary>
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

        public readonly struct Mission
        {
            public readonly string Name;
            public readonly bool Required;
            public readonly int Coins, Xp;
            public readonly int[] Steps; // indices into Objectives

            public Mission(string name, bool required, int coins, int xp, params int[] steps)
            {
                Name = name;
                Required = required;
                Coins = coins;
                Xp = xp;
                Steps = steps;
            }
        }

        /// <summary>Mission steps (HUD checklist; the first four are the lamps over the barn exit).</summary>
        public static readonly Objective[] Objectives =
        {
            new("Padlock", "bring the KEY from the roof beams", ChannelIds.Padlock),
            new("Electric fence", "smash the FUSE BOX in the tool shed (Heavy)", ChannelIds.Fence),
            new("Gate motor", "fart into the GENERATOR on the hayloft (Gassy)", ChannelIds.Generator),
            new("Gate latch", "shoot the 3 BULLSEYES (Armed)", ChannelIds.Target1, ChannelIds.Target2, ChannelIds.Target3),
            new("Truck keys", "sneak into BOB'S HOUSE (chimney / window / back door), keys into the truck's IGNITION", ChannelIds.Truck),
            new("Farm gate", "stand on BOTH gate plates at the same time (one by the gate, one by the windmill)", ChannelIds.FarmGate),
            new("Pie heist", "put BOB'S PIE (in his house) into the truck", ChannelIds.PieInTruck),
            new("Ruin the BBQ", "smash Bob's GAS BOTTLE by the grill (his grill gets slow)", ChannelIds.Sabotage),
        };

        public static readonly Mission[] Missions =
        {
            new("Break out of the barn", true, 0, 150, 0, 1, 2, 3),
            new("Steal the truck keys", true, 0, 100, 4),
            new("Open the farm gate", true, 0, 100, 5),
            new("Pie heist", false, 40, 75, 6),
            new("Ruin the BBQ", false, 40, 75, 7),
        };

        static readonly int[] TrackedChannels =
        {
            ChannelIds.Padlock, ChannelIds.Fence, ChannelIds.Generator, ChannelIds.Target1, ChannelIds.Target2, ChannelIds.Target3,
            ChannelIds.Truck, ChannelIds.FarmGate, ChannelIds.PieInTruck, ChannelIds.Sabotage,
        };

        [Header("Timing (seconds)")]
        public float introTime = 8f;
        public float roundTime = 720f;
        [Tooltip("Escape faster than this for the speed star.")]
        public float starTime = 480f;
        [Tooltip("Bob's final hunt starts when this much time is left.")]
        public float finalHuntTime = 60f;
        public float resultsTime = 12f;
        [Header("Rules")]
        [Tooltip("Pigs Bob may grill before the round is lost.")]
        public int maxGrills = 3;
        [Header("Rewards")]
        public int winCoins = 100, rescueCoins = 20;
        public int winXp = 250, rescueXp = 25;

        readonly NetworkVariable<RoundPhase> phase = new();
        readonly NetworkVariable<double> phaseEnd = new();
        readonly NetworkVariable<int> grills = new();
        readonly NetworkVariable<int> channelBits = new();
        readonly NetworkVariable<int> escaped = new();
        readonly NetworkVariable<int> players = new();
        readonly NetworkVariable<LoseReason> loseReason = new();
        readonly NetworkVariable<float> finishTime = new();
        readonly NetworkVariable<int> roundNumber = new();
        readonly NetworkVariable<int> stars = new();
        readonly NetworkVariable<int> coins = new();
        readonly NetworkVariable<int> rescues = new();
        readonly NetworkVariable<int> lootCoins = new();

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
        /// <summary>Won: stars earned (escaped + nobody grilled + fast + both bonus missions), out of MaxStars.</summary>
        public int Stars => stars.Value;
        public const int MaxStars = 4;
        /// <summary>Team coins collected this round so far (pickups, rescues, bonus missions).</summary>
        public int Coins => coins.Value;
        /// <summary>Won: coins from loot that rode away in the truck.</summary>
        public int LootCoins => lootCoins.Value;
        public int Rescues => rescues.Value;
        /// <summary>Barn exit open (padlock, generator, bullseyes done).</summary>
        public bool ExitOpen => ObjectiveDone(0) && ObjectiveDone(2) && ObjectiveDone(3);
        /// <summary>Truck started and farm gate open: pigs in the truck now count as escaped.</summary>
        public bool CanEscape => MissionDone(1) && MissionDone(2);
        public bool RequiredDone
        {
            get
            {
                for (int i = 0; i < Missions.Length; i++)
                    if (Missions[i].Required && !MissionDone(i)) return false;
                return true;
            }
        }

        bool finalHuntStarted, exitAlarmed;
        bool[] missionPaid = new bool[Missions.Length];

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

        public bool MissionDone(int m)
        {
            foreach (int step in Missions[m].Steps)
                if (!ObjectiveDone(step)) return false;
            return true;
        }

        /// <summary>Steps of mission m done / total (every PC).</summary>
        public int MissionStepsDone(int m)
        {
            int n = 0;
            foreach (int step in Missions[m].Steps)
                if (ObjectiveDone(step)) n++;
            return n;
        }

        // ---------- server ----------

        /// <summary>Server: a fresh round on a freshly spawned level (called by NetworkGame).</summary>
        public void BeginRound()
        {
            if (!IsServer) return;
            finalHuntStarted = false;
            exitAlarmed = false;
            missionPaid = new bool[Missions.Length];
            stars.Value = 0;
            coins.Value = 0;
            lootCoins.Value = 0;
            rescues.Value = 0;
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
                    UpdatePie();
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
            AnnounceRpc("GO! Break out of the barn, steal Bob's truck and get off his farm!");
            RoundSoundRpc(Sound.Escape);
        }

        /// <summary>Bob's pie counts while it sits in the truck.</summary>
        void UpdatePie()
        {
            bool inTruck = false;
            foreach (var item in KeyItem.All)
                if (item.bonus && EscapeZone.IsInside(item.transform.position)) inTruck = true;
            PuzzleSignals.Set(ChannelIds.PieInTruck, this, inTruck);
        }

        void UpdateObjectives()
        {
            int bits = 0;
            for (int i = 0; i < TrackedChannels.Length; i++)
                if (PuzzleSignals.IsOn(TrackedChannels[i])) bits |= 1 << i;
            if (bits == channelBits.Value) return;

            bool[] stepBefore = new bool[Objectives.Length];
            for (int i = 0; i < Objectives.Length; i++) stepBefore[i] = ObjectiveDone(i);
            bool[] missionBefore = new bool[Missions.Length];
            for (int m = 0; m < Missions.Length; m++) missionBefore[m] = MissionDone(m);
            channelBits.Value = bits;

            for (int m = 0; m < Missions.Length; m++)
            {
                var mission = Missions[m];
                if (!missionBefore[m] && MissionDone(m))
                {
                    AnnounceRpc(mission.Required ? $"MISSION COMPLETE: {mission.Name}!" : $"BONUS MISSION: {mission.Name}! +{mission.Coins} coins");
                    RoundSoundRpc(Sound.Escape);
                    if (!missionPaid[m])
                    {
                        missionPaid[m] = true;
                        if (mission.Coins > 0) coins.Value += mission.Coins;
                    }
                }
                else if (mission.Steps.Length > 1)
                    foreach (int step in mission.Steps)
                        if (!stepBefore[step] && ObjectiveDone(step)) AnnounceRpc($"{Objectives[step].Name}: done!");
            }
            if (!exitAlarmed && ExitOpen)
            {
                exitAlarmed = true;
                AnnounceRpc("THE BARN EXIT IS OPEN! Steal the truck keys and open the farm gate!");
                Vector3 exit = Vector3.zero;
                foreach (var gate in FindObjectsByType<Gate>(FindObjectsSortMode.None))
                    if (gate.requiredChannels != null && gate.requiredChannels.Length > 0) exit = gate.transform.position;
                if (FarmerBob.Instance != null) FarmerBob.Instance.Alarm(exit);
            }
        }

        void UpdateEscapes()
        {
            int owned = 0, free = 0;
            bool canEscape = CanEscape;
            foreach (var pig in PigController.All)
            {
                if (pig == null || !pig.TryGetComponent(out NetworkObject obj) || !obj.IsSpawned) continue;
                if (!pig.Escaped && canEscape && !pig.IsHeld && EscapeZone.IsInside(pig.Body.position))
                {
                    pig.Escaped = true;
                    AnnounceRpc($"The {PigTypes.Info(pig.Type).Name} pig is in the truck!");
                    EscapeFxRpc(pig.Body.position);
                }
                if (pig.Owner == null) continue;
                owned++;
                if (pig.Escaped) free++;
            }
            if (players.Value != owned) players.Value = owned;
            if (escaped.Value != free) escaped.Value = free;
            if (owned > 0 && free == owned && RequiredDone) Win();
        }

        /// <summary>Server: a pig touched a coin.</summary>
        public void AddCoins(int amount, Vector3 position)
        {
            if (!IsServer || phase.Value != RoundPhase.Playing) return;
            coins.Value += amount;
            CoinFxRpc(position, amount);
        }

        /// <summary>Server: pigs got out of Bob's cage.</summary>
        public void OnPigsRescued(int count)
        {
            if (!IsServer || phase.Value != RoundPhase.Playing || count <= 0) return;
            rescues.Value += count;
            coins.Value += rescueCoins * count;
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
            int loot = 0;
            foreach (var item in KeyItem.All)
                if (item.coins > 0 && EscapeZone.IsInside(item.transform.position)) loot += item.coins;
            lootCoins.Value = loot;
            bool bonuses = MissionDone(3) && MissionDone(4);
            stars.Value = 1 + (grills.Value == 0 ? 1 : 0) + (finishTime.Value <= starTime ? 1 : 0) + (bonuses ? 1 : 0);
            SetPhase(RoundPhase.Won, resultsTime);
            RoundSoundRpc(Sound.Win);
            if (FarmerBob.Instance != null) FarmerBob.Instance.Say("Noooo! My truck! My BBQ!");
            PayOut(won: true);
        }

        void Lose(LoseReason reason)
        {
            loseReason.Value = reason;
            SetPhase(RoundPhase.Lost, resultsTime);
            RoundSoundRpc(Sound.Lose);
            if (FarmerBob.Instance != null) FarmerBob.Instance.Say("BBQ TIME! Hahaha!");
            PayOut(won: false);
        }

        /// <summary>Team reward, saved on every PC: coins (half if lost) + XP for missions, rescues and the win.</summary>
        void PayOut(bool won)
        {
            int xp = rescues.Value * rescueXp + (won ? winXp : 0);
            for (int m = 0; m < Missions.Length; m++)
                if (MissionDone(m)) xp += Missions[m].Xp;
            int total = won ? coins.Value + lootCoins.Value + winCoins : coins.Value / 2;
            RewardRpc(total, xp, roundNumber.Value);
        }

        // ---------- every PC ----------

        [Rpc(SendTo.Everyone)]
        void RewardRpc(int coinReward, int xpReward, int round) => PlayerProgress.Add(coinReward, xpReward, round);

        [Rpc(SendTo.Everyone)]
        void AnnounceRpc(string text) => GameEvents.Announce(text);

        [Rpc(SendTo.Everyone)]
        void RoundSoundRpc(Sound sound) => Sfx.PlayUi(sound, 0.8f);

        [Rpc(SendTo.Everyone)]
        void CoinFxRpc(Vector3 position, int amount)
        {
            Sfx.Play(Sound.Ding, position, 0.7f, 0.1f);
            for (int i = 0; i < 4; i++)
                SmokeCloud.SpawnMoving(position, Random.insideUnitSphere * 1.5f + Vector3.up * 2f, 0.1f, 0.5f, new Color(1f, 0.85f, 0.2f, 0.9f));
        }

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
