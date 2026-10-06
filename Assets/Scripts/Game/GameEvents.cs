using System;
using UnityEngine;

namespace Porkour
{
    /// <summary>Local (every PC) game messages for the HUD. Raised from server RPCs (Bob, RoundManager...).</summary>
    public static class GameEvents
    {
        /// <summary>Short message line ("Bob caught the Jumpy pig!").</summary>
        public static event Action<string> Announced;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Announced = null;

        public static void Announce(string text) => Announced?.Invoke(text);
    }
}
