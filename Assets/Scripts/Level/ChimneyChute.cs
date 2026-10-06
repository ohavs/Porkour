using Unity.Netcode;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Bob's chimney: a pig that gets to the top of it (Gassy's rocket, Jumpy's ledge grab from the lean-to roof) slides
    /// down and pops out of the fireplace inside the house, in a puff of soot. Server checks, every PC sees the soot.
    /// </summary>
    public class ChimneyChute : NetworkBehaviour
    {
        [Tooltip("Catch zone above this point (the chimney top).")]
        public float radius = 0.8f;
        public float height = 1.6f;
        [Tooltip("Where the pig comes out (world offset from the chimney top) - set by the builder.")]
        public Vector3 exitOffset;
        public float exitYaw;

        void FixedUpdate()
        {
            if (!IsServer || !IsSpawned) return;
            Vector3 top = transform.position;
            foreach (var pig in PigController.All)
            {
                if (pig == null || pig.IsHeld) continue;
                Vector3 rel = pig.Body.position - top;
                if (rel.y < -0.4f || rel.y > height || new Vector2(rel.x, rel.z).sqrMagnitude > radius * radius) continue;
                Vector3 exit = top + exitOffset;
                pig.TeleportTo(exit, Quaternion.Euler(0f, exitYaw, 0f));
                pig.Launch(2f, Quaternion.Euler(0f, exitYaw, 0f) * Vector3.forward * 2.5f); // tumble out of the fireplace
                ChuteRpc(top, exit, PigTypes.Info(pig.Type).Name);
            }
        }

        [Rpc(SendTo.Everyone)]
        void ChuteRpc(Vector3 top, Vector3 exit, string pigName)
        {
            var soot = new Color(0.15f, 0.13f, 0.12f, 0.7f);
            for (int i = 0; i < 4; i++)
            {
                SmokeCloud.Spawn(top + Random.insideUnitSphere * 0.4f + Vector3.up * 0.5f, 0.5f, 1.2f, soot);
                SmokeCloud.Spawn(exit + Random.insideUnitSphere * 0.5f, 0.6f, 1.5f, soot);
            }
            Sfx.Play(Sound.Rope, top);
            Sfx.Play(Sound.Bonk, exit, 0.7f);
            GameEvents.Announce($"The {pigName} pig slid down the chimney! Ho ho ho!");
        }
    }
}
