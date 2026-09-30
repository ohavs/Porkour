using System.Collections.Generic;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Something pigs can climb (rope ladder now, fixed ladders later): a volume in front of it, from the
    /// transform (bottom) up to Top. A pig inside that pushes toward it (or holds jump) climbs up and is popped
    /// over the edge at the top (see PigController.Climb). Plain math, no colliders - the server checks All.
    /// </summary>
    public class Climbable : MonoBehaviour
    {
        public static readonly List<Climbable> All = new();

        [Tooltip("Height from this transform (bottom) to the ledge the climb ends on.")]
        public float height = 3f;
        [Tooltip("Half width of the climb zone, sideways.")]
        public float halfWidth = 0.6f;

        /// <summary>Horizontal direction pointing away from the wall/ledge (pigs climb toward -Outward).</summary>
        public Vector3 Outward => transform.forward;
        public float Top => transform.position.y + height;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => All.Clear();

        void OnEnable() => All.Add(this);
        void OnDisable() => All.Remove(this);

        /// <summary>Is a pig centred here in the climb zone?</summary>
        public bool Contains(Vector3 pigCenter)
        {
            Vector3 rel = pigCenter - transform.position;
            if (rel.y < -0.3f || rel.y > height + 0.45f) return false;
            float side = Vector3.Dot(rel, transform.right);
            float front = Vector3.Dot(rel, Outward); // pig's centre is ~0.9 in front when its nose touches
            return Mathf.Abs(side) <= halfWidth && front >= -0.6f && front <= 1.3f;
        }

        public static Climbable Find(Vector3 pigCenter)
        {
            foreach (var c in All)
                if (c.Contains(pigCenter)) return c;
            return null;
        }
    }
}
