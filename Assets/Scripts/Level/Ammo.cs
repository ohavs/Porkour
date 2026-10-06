using System.Collections.Generic;
using Unity.Netcode;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Small item Armed can suck up and shoot (apple, corn, egg, bolt). A normal networked physics prop
    /// (anyone can also grab/throw it). When fired it ignores the shooter for a moment; eggs splat on a hard hit.
    /// Farmer Bob throws corn too: his throws knock a pig off whatever it stands on.
    /// Server-side prefab lookup by kind (from the NetworkManager's prefab list) so abilities need no references.
    /// </summary>
    public class Ammo : NetworkBehaviour
    {
        public enum Kind : byte { Apple, Corn, Egg, Bolt }

        public Kind kind;
        [Tooltip("Splats (disappears with debris) when it hits something hard, like an egg.")]
        public bool breaksOnHit;
        public Color debrisColor = Color.white;

        static readonly Dictionary<Kind, GameObject> Prefabs = new();

        Rigidbody rb;
        Collider[] shooterColliders;
        bool knocksPigs;

        public Rigidbody Body => rb;
        /// <summary>Server: shot by a pig (Armed) within the last 1.5 s - such a hit always stuns Bob.</summary>
        public bool ShotByPig => !knocksPigsShot && Time.time - firedAt < 1.5f;

        float firedAt = -10f;
        bool knocksPigsShot;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Prefabs.Clear();

        void Awake() => rb = GetComponent<Rigidbody>();

        /// <summary>Registered network prefab for this kind (null if missing).</summary>
        public static GameObject PrefabFor(Kind kind)
        {
            if (Prefabs.TryGetValue(kind, out var cached) && cached != null) return cached;
            var nm = NetworkManager.Singleton;
            if (nm == null) return null;
            foreach (var entry in nm.NetworkConfig.Prefabs.Prefabs)
                if (entry.Prefab != null && entry.Prefab.TryGetComponent(out Ammo ammo) && ammo.kind == kind)
                    return Prefabs[kind] = entry.Prefab;
            return null;
        }

        /// <summary>Server, right after Spawn: launch it and don't hit the shooter for a moment.</summary>
        public void Fire(Collider[] shooter, Vector3 velocity, bool knockPigs = false)
        {
            rb.linearVelocity = velocity;
            rb.angularVelocity = Random.insideUnitSphere * 10f;
            knocksPigs = knocksPigsShot = knockPigs;
            firedAt = Time.time;
            shooterColliders = shooter;
            IgnoreShooter(true);
            Invoke(nameof(RestoreCollisions), 0.4f);
        }

        /// <summary>Launch velocity (about `speed`) that lands on target despite gravity.</summary>
        public static Vector3 BallisticVelocity(Vector3 from, Vector3 to, float speed)
        {
            Vector3 delta = to - from;
            float time = Mathf.Max(0.05f, delta.magnitude / speed);
            return delta / time - Physics.gravity * (0.5f * time);
        }

        void RestoreCollisions() => IgnoreShooter(false);

        void IgnoreShooter(bool ignore)
        {
            if (shooterColliders == null) return;
            foreach (var mine in GetComponentsInChildren<Collider>())
            foreach (var theirs in shooterColliders)
                if (theirs != null) Physics.IgnoreCollision(theirs, mine, ignore);
            if (!ignore) shooterColliders = null;
        }

        void OnCollisionEnter(Collision collision)
        {
            if (!IsServer || !IsSpawned) return;
            if (knocksPigs)
            {
                knocksPigs = false; // only the first thing it hits
                if (collision.rigidbody != null && collision.rigidbody.TryGetComponent(out PigController pig) && !pig.IsHeld)
                {
                    Vector3 push = rb.linearVelocity;
                    push.y = 0f;
                    pig.Launch(4f, push.normalized * 5f);
                    BonkRpc(pig.Body.position);
                }
            }
            if (breaksOnHit && collision.relativeVelocity.magnitude > 8f) Splat();
        }

        void Splat()
        {
            SplatRpc(transform.position);
            NetworkObject.Despawn(true);
        }

        [Rpc(SendTo.Everyone)]
        void BonkRpc(Vector3 position)
        {
            Sfx.Play(Sound.Bonk, position);
            ThirdPersonCamera.Shake(position, 0.35f, 4f);
        }

        [Rpc(SendTo.Everyone)]
        void SplatRpc(Vector3 position)
        {
            Sfx.Play(Sound.Splat, position);
            Debris.Burst(new Bounds(position, Vector3.one * 0.3f), debrisColor, 6);
        }
    }
}
