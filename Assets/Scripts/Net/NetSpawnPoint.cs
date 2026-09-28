using UnityEngine;

namespace Porkour
{
    /// <summary>Where the server spawns a networked prefab (pig, crate, key...) when a game starts.</summary>
    public class NetSpawnPoint : MonoBehaviour
    {
        public GameObject prefab;
        [Tooltip("Pigs only: skin colour.")]
        public Color pigColor = new(1f, 0.62f, 0.68f);

        void OnDrawGizmos()
        {
            Gizmos.color = pigColor;
            Gizmos.DrawWireSphere(transform.position, 0.3f);
        }
    }
}
