using System.Collections.Generic;
using UnityEngine;

namespace Porkour
{
    /// <summary>Puzzle parts that talk over a numbered channel (switch → gate). Set from NetSpawnPoint.channel.</summary>
    public interface IPuzzleChannel
    {
        int Channel { get; set; }
    }

    /// <summary>
    /// Server-side puzzle wiring: switches turn a channel on/off, gates/doors read it.
    /// A channel is on while at least one of its sources is on.
    /// </summary>
    public static class PuzzleSignals
    {
        static readonly Dictionary<int, HashSet<Object>> Sources = new();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Sources.Clear();

        public static void Set(int channel, Object source, bool on)
        {
            if (!Sources.TryGetValue(channel, out var set)) Sources[channel] = set = new HashSet<Object>();
            if (on) set.Add(source);
            else set.Remove(source);
        }

        public static bool IsOn(int channel) => Sources.TryGetValue(channel, out var set) && set.Count > 0;
    }
}
