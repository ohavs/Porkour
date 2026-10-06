using Unity.Netcode;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Turns its output channel on for good once all its input channels are on at the same moment (e.g. two pigs on the
    /// two garage plates). Scene object, server only; forgets it when a new round starts.
    /// </summary>
    public class ChannelLatch : MonoBehaviour
    {
        public int[] inputs = { ChannelIds.GatePlateA, ChannelIds.GatePlateB };
        public int output = ChannelIds.GarageDoor;

        bool latched;
        int round = -1;

        void FixedUpdate()
        {
            var nm = NetworkManager.Singleton;
            if (nm == null || !nm.IsServer) return;
            int now = RoundManager.Instance != null ? RoundManager.Instance.RoundNumber : 0;
            if (now != round)
            {
                round = now;
                latched = false;
            }
            if (!latched && PuzzleSignals.AllOn(inputs)) latched = true;
            PuzzleSignals.Set(output, this, latched);
        }
    }
}
