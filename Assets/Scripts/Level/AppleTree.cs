using Unity.Netcode;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Apple tree: Heavy's Belly Slam into the trunk shakes a few apples loose (Armed's ammo). Server spawns them;
    /// scene object, so the falling apples are the feedback.
    /// </summary>
    public class AppleTree : MonoBehaviour
    {
        public int applesPerShake = 3;
        public float cooldown = 15f;
        [Tooltip("Height and radius of the leafy crown where apples drop from.")]
        public float crownHeight = 3.2f;
        public float crownRadius = 1.2f;

        float readyTime;

        /// <summary>Server: shaken by a hard hit.</summary>
        public void Shake()
        {
            var nm = NetworkManager.Singleton;
            if (nm == null || !nm.IsServer || Time.time < readyTime) return;
            readyTime = Time.time + cooldown;
            var prefab = Ammo.PrefabFor(Ammo.Kind.Apple);
            if (prefab == null) return;
            for (int i = 0; i < applesPerShake; i++)
            {
                Vector2 r = Random.insideUnitCircle * crownRadius;
                var apple = Instantiate(prefab, transform.position + new Vector3(r.x, crownHeight, r.y), Random.rotation);
                apple.GetComponent<NetworkObject>().Spawn();
            }
        }
    }
}
