using Unity.Netcode;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Gold coin lying around the farm (networked, spawned from a NetSpawnPoint): a pig that touches it collects it for the
    /// team (RoundManager round coins). Spins and bobs on every PC.
    /// </summary>
    public class CoinPickup : NetworkBehaviour
    {
        public int value = 5;
        public float radius = 1f;
        [Tooltip("The spinning part (set by the builder).")]
        public Transform spinner;

        Vector3 spinnerRest;

        void Awake()
        {
            if (spinner != null) spinnerRest = spinner.localPosition;
        }

        void FixedUpdate()
        {
            if (!IsServer || !IsSpawned) return;
            if (RoundManager.Instance != null && !RoundManager.Instance.IsPlaying) return; // not during the intro / results
            Vector3 p = transform.position;
            foreach (var pig in PigController.All)
            {
                if (pig == null || pig.IsHeld) continue;
                if ((pig.Body.position - p).sqrMagnitude > radius * radius) continue;
                if (RoundManager.Instance != null) RoundManager.Instance.AddCoins(value, p);
                NetworkObject.Despawn(true);
                return;
            }
        }

        void Update()
        {
            if (spinner == null) return;
            spinner.Rotate(0f, 180f * Time.deltaTime, 0f, Space.World);
            spinner.localPosition = spinnerRest + Vector3.up * (Mathf.Sin(Time.time * 3f + transform.position.x) * 0.1f);
        }
    }
}
