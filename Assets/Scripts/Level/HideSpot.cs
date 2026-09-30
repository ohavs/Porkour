using System.Collections.Generic;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Place a pig can hide in (hay pile...): a pig whose centre is inside this upright cylinder is invisible to
    /// Farmer Bob. Scene object, plain math (no colliders) - pigs walk right into the hay.
    /// </summary>
    public class HideSpot : MonoBehaviour
    {
        public static readonly List<HideSpot> All = new();

        public float radius = 1.1f;
        public float height = 1.3f;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => All.Clear();

        void OnEnable() => All.Add(this);
        void OnDisable() => All.Remove(this);

        public bool Covers(Vector3 point)
        {
            Vector3 rel = point - transform.position;
            return rel.y >= -0.2f && rel.y <= height && new Vector2(rel.x, rel.z).sqrMagnitude <= radius * radius;
        }

        public static bool IsHidden(Vector3 point)
        {
            foreach (var spot in All)
                if (spot.Covers(point)) return true;
            return false;
        }

        void OnDrawGizmos()
        {
            Gizmos.color = new Color(1f, 0.9f, 0.3f, 0.5f);
            Gizmos.DrawWireSphere(transform.position + Vector3.up * height / 2f, radius);
        }
    }
}
