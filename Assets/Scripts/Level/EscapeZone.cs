using System.Collections.Generic;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// The goal (the getaway truck's bed): a pig whose centre gets inside this box has escaped (RoundManager, server).
    /// Scene object, plain math like HideSpot.
    /// </summary>
    public class EscapeZone : MonoBehaviour
    {
        public static readonly List<EscapeZone> All = new();

        public Vector3 size = new(3f, 2f, 4f);

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => All.Clear();

        void OnEnable() => All.Add(this);
        void OnDisable() => All.Remove(this);

        public bool Contains(Vector3 point)
        {
            Vector3 local = transform.InverseTransformPoint(point);
            return Mathf.Abs(local.x) <= size.x / 2f && Mathf.Abs(local.y) <= size.y / 2f && Mathf.Abs(local.z) <= size.z / 2f;
        }

        public static bool IsInside(Vector3 point)
        {
            foreach (var zone in All)
                if (zone.Contains(point)) return true;
            return false;
        }

        void OnDrawGizmos()
        {
            Gizmos.color = new Color(0.3f, 1f, 0.3f, 0.6f);
            Gizmos.matrix = transform.localToWorldMatrix;
            Gizmos.DrawWireCube(Vector3.zero, size);
        }
    }
}
