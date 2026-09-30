using UnityEngine;

namespace Porkour
{
    /// <summary>Where the server spawns a networked prefab (pig, crate, key...) when a game starts.</summary>
    public class NetSpawnPoint : MonoBehaviour
    {
        public GameObject prefab;

        void OnDrawGizmos()
        {
            Gizmos.color = new Color(1f, 0.62f, 0.68f);
            Gizmos.DrawWireSphere(transform.position, 0.3f);
        }
    }
}
