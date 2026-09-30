using Unity.Netcode;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Hanging bell. A hard hit (Armed's shot, a thrown object) rings it: it swings on every PC and Farmer Bob,
    /// if he's in the barn and not carrying a pig, goes to check the noise - a lure.
    /// </summary>
    public class Bell : NetworkBehaviour
    {
        public float minHitSpeed = 5f;
        [Tooltip("Swinging part (set by the builder).")]
        public Transform swing;

        readonly NetworkVariable<double> rangAt = new(-100.0);
        float nextRingTime;

        void OnCollisionEnter(Collision collision)
        {
            if (!IsServer || !IsSpawned || Time.time < nextRingTime) return;
            if (collision.relativeVelocity.magnitude < minHitSpeed) return;
            nextRingTime = Time.time + 1f;
            rangAt.Value = NetworkManager.ServerTime.Time;
            if (FarmerBob.Instance != null) FarmerBob.Instance.HearNoise(transform.position);
        }

        void Update()
        {
            if (swing == null || !IsSpawned) return;
            float t = (float)(NetworkManager.ServerTime.Time - rangAt.Value);
            float angle = t < 2.5f ? Mathf.Sin(t * 12f) * 35f * (1f - t / 2.5f) : 0f;
            swing.localRotation = Quaternion.Euler(angle, 0f, 0f);
        }
    }
}
