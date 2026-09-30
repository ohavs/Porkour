using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Gassy's Rocket Fart: launches the pig up (plus a push where it runs) - also mid-air, and it breaks
    /// free if someone carries it - blasts nearby objects and pigs away and leaves a green smoke cloud
    /// (FartCloud; later blinds/slows Bob).
    /// </summary>
    public class GassyAbility : PigAbility
    {
        [Header("Launch")]
        [Tooltip("Metres the fart lifts the pig (a normal jump is 1.6).")]
        public float launchHeight = 3.5f;
        [Tooltip("Extra horizontal speed toward the move direction.")]
        public float forwardBoost = 3f;

        [Header("Blast")]
        public float blastRadius = 3f;
        [Tooltip("Push strength: speed given = this / mass (capped), weaker further away.")]
        public float blastImpulse = 120f;
        public float maxBlastSpeed = 9f;

        [Header("Smoke")]
        public float cloudRadius = 2.2f;
        public float cloudLifetime = 6f;
        public float trailTime = 0.4f;

        public override PigType Type => PigType.Gassy;

        readonly HashSet<Rigidbody> blasted = new();

        Vector3 RearPoint => transform.position - transform.forward * 0.8f;

        protected override void Use()
        {
            if (pig.IsHeld) pig.HeldBy.Drop(); // fart your way out of anyone's arms
            Vector3 rear = RearPoint;
            pig.Launch(Mathf.Sqrt(2f * -Physics.gravity.y * launchHeight), pig.MoveInput * forwardBoost);
            Blast(rear);
            TriggerEffect(rear, -transform.forward);
        }

        void Blast(Vector3 center)
        {
            blasted.Clear();
            foreach (var col in Physics.OverlapSphere(center, blastRadius, ~0, QueryTriggerInteraction.Ignore))
            {
                var rb = col.attachedRigidbody;
                if (rb == null || rb == pig.Body || rb.isKinematic || !blasted.Add(rb)) continue;
                if (pig.Grabber != null && rb == pig.Grabber.Held) continue;
                if (rb.TryGetComponent(out PigController other) && other.IsHeld) continue;

                Vector3 away = rb.worldCenterOfMass - center;
                Vector3 flat = new(away.x, 0f, away.z);
                Vector3 dir = (flat.sqrMagnitude > 0.01f ? flat.normalized : -transform.forward) + Vector3.up * 0.6f;
                float falloff = 1f - Mathf.Clamp01(away.magnitude / blastRadius);
                float speed = Mathf.Min(blastImpulse / rb.mass, maxBlastSpeed) * falloff;
                rb.AddForce(dir.normalized * speed, ForceMode.VelocityChange);
            }
        }

        public override void PlayEffect(Vector3 position, Vector3 direction)
        {
            FartCloud.Spawn(position, cloudRadius, cloudLifetime, smokeScreen: true);
            StartCoroutine(Trail());
        }

        IEnumerator Trail()
        {
            var wait = new WaitForSeconds(0.05f);
            for (float t = 0f; t < trailTime; t += 0.05f)
            {
                FartCloud.Spawn(RearPoint, 0.35f, 1.2f, smokeScreen: false);
                yield return wait;
            }
        }
    }
}
