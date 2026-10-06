using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// This PC's saved progress (coins + XP), kept between rounds and games in PlayerPrefs. Rounds pay out through
    /// RoundManager (every player gets the team's reward). Coins will buy powers / gadgets / hats in the shop (later).
    /// </summary>
    public static class PlayerProgress
    {
        const string CoinsKey = "porkour.coins", XpKey = "porkour.xp";
        const int XpPerLevel = 1000;

        public static int Coins => PlayerPrefs.GetInt(CoinsKey, 0);
        public static int Xp => PlayerPrefs.GetInt(XpKey, 0);
        public static int Level => 1 + Xp / XpPerLevel;
        /// <summary>0..1 progress to the next level.</summary>
        public static float LevelProgress => (Xp % XpPerLevel) / (float)XpPerLevel;

        /// <summary>The last round's payout (for the results screen).</summary>
        public static int LastCoins { get; private set; }
        public static int LastXp { get; private set; }
        public static int LastRound { get; private set; } = -1;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() // play mode starts without a domain reload in this project
        {
            LastRound = -1;
            LastCoins = LastXp = 0;
        }

        public static void Add(int coins, int xp, int round)
        {
            if (round == LastRound) return; // already paid
            LastRound = round;
            LastCoins = coins;
            LastXp = xp;
            PlayerPrefs.SetInt(CoinsKey, Coins + Mathf.Max(0, coins));
            PlayerPrefs.SetInt(XpKey, Xp + Mathf.Max(0, xp));
            PlayerPrefs.Save();
        }
    }
}
