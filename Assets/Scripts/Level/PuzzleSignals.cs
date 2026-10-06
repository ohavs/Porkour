using System.Collections.Generic;
using UnityEngine;

namespace Porkour
{
    /// <summary>Puzzle parts that talk over a numbered channel (switch → gate). Set from NetSpawnPoint.channel.</summary>
    public interface IPuzzleChannel
    {
        int Channel { get; set; }
    }

    /// <summary>Channel numbers used by the barn (builder, RoundManager objectives and Bob share them).</summary>
    public static class ChannelIds
    {
        public const int Lift = 2;
        public const int Padlock = 11;
        public const int Fence = 12;
        public const int Generator = 13;
        public const int Truck = 14;
        public const int FarmGate = 15;
        /// <summary>On while Bob's pie sits in the truck (RoundManager).</summary>
        public const int PieInTruck = 16;
        /// <summary>Bob's gas bottle at the BBQ smashed: the grill heats slowly.</summary>
        public const int Sabotage = 41;
        /// <summary>The two plates that open the farm gate together (ChannelLatch → FarmGate).</summary>
        public const int GatePlateA = 51, GatePlateB = 52;
        public const int HouseWindow = 31;
        public const int HouseDoor = 33;
        public const int Target1 = 21, Target2 = 22, Target3 = 23;
        public const int BobDoor = 99;
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

        /// <summary>True when every channel in the list is on (empty list = false).</summary>
        public static bool AllOn(int[] channels)
        {
            if (channels == null || channels.Length == 0) return false;
            foreach (int c in channels)
                if (!IsOn(c)) return false;
            return true;
        }

        /// <summary>Forget every switch (new round: the level is respawned).</summary>
        public static void Clear() => Sources.Clear();
    }
}
