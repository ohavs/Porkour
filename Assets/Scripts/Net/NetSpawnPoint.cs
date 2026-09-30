using UnityEngine;

namespace Porkour
{
    /// <summary>Where the server spawns a networked prefab (pig, crate, key, gate...) when a game starts.</summary>
    public class NetSpawnPoint : MonoBehaviour
    {
        public GameObject prefab;
        [Tooltip("Puzzle parts only: switches and gates with the same channel are linked.")]
        public int channel;
        [Tooltip("Breakables only: networked prefab spawned inside when it's smashed (e.g. Key).")]
        public GameObject contents;

        void OnDrawGizmos()
        {
            Gizmos.color = new Color(1f, 0.62f, 0.68f);
            Gizmos.DrawWireSphere(transform.position, 0.3f);
        }
    }
}
