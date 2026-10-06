using Unity.Netcode;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// A door you can open from the inside: while any pig is inside this box (the house), its channel is on (server) -
    /// the front door Gate opens. Scene object, plain math.
    /// </summary>
    public class InsideOpener : MonoBehaviour
    {
        public int channel;
        public Vector3 size = new(6f, 3f, 4f);

        void FixedUpdate()
        {
            var nm = NetworkManager.Singleton;
            if (nm == null || !nm.IsServer) return;
            bool anyone = false;
            foreach (var pig in PigController.All)
            {
                if (pig == null) continue;
                Vector3 local = transform.InverseTransformPoint(pig.Body.position);
                if (Mathf.Abs(local.x) <= size.x / 2f && Mathf.Abs(local.y) <= size.y / 2f && Mathf.Abs(local.z) <= size.z / 2f)
                {
                    anyone = true;
                    break;
                }
            }
            PuzzleSignals.Set(channel, this, anyone);
        }

        void OnDrawGizmos()
        {
            Gizmos.color = new Color(0.3f, 0.6f, 1f, 0.6f);
            Gizmos.matrix = transform.localToWorldMatrix;
            Gizmos.DrawWireCube(Vector3.zero, size);
        }
    }
}
