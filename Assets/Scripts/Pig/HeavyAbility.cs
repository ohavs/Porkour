using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Heavy's Belly Slam. On the ground: belly dash toward the aim - smashes Breakables and knocks
    /// objects/pigs away, stops at walls. In the air: belly flop straight down - smashes what's below and
    /// the landing shockwave throws everything nearby up and away.
    /// Passive: trampoline - pigs that fall onto Heavy's back bounce high.
    /// </summary>
    public class HeavyAbility : PigAbility
    {
        [Header("Dash (on the ground)")]
        public float dashSpeed = 13f;
        public float dashTime = 0.35f;
        [Tooltip("Radius of the hit zone in front of the pig.")]
        public float hitRadius = 0.75f;
        [Tooltip("Speed given to things hit = this / mass (capped).")]
        public float knockImpulse = 260f;
        public float maxKnockSpeed = 11f;

        [Header("Belly flop (in the air)")]
        public float slamSpeed = 18f;
        public float slamRadius = 3f;
        [Tooltip("Breakables this close to the landing point are smashed.")]
        public float slamBreakRadius = 1.6f;
        public float slamImpulse = 200f;
        public float maxSlamSpeed = 8f;

        [Header("Trampoline")]
        [Tooltip("Pigs falling onto Heavy's back bounce this high (metres).")]
        public float bounceHeight = 3.2f;
        public float minBounceFallSpeed = 3f;

        public override PigType Type => PigType.Heavy;
        public override string Hint => "in the air: belly flop";

        const byte FxDash = 0, FxSlam = 1, FxBounce = 2;

        enum State { Idle, Dashing, Slamming }
        State state;
        float stateStart;
        int steps; // physics steps since the move started (velocity checks need at least one)
        Vector3 dashDirection;
        readonly HashSet<Rigidbody> hitBodies = new();

        protected override void Awake()
        {
            base.Awake();
            cooldown = 2.5f;
        }

        void OnDisable() => EndMove();

        protected override bool CanUse() => !pig.IsHeld;

        protected override void Use()
        {
            hitBodies.Clear();
            stateStart = Time.time;
            steps = 0;
            pig.MovementLocked = true;
            if (pig.IsGrounded)
            {
                Vector3 dir = Vector3.ProjectOnPlane(pig.Aim, Vector3.up);
                dashDirection = dir.sqrMagnitude > 0.01f ? dir.normalized : transform.forward;
                pig.FaceDirection(dashDirection);
                state = State.Dashing;
                TriggerEffect(FxDash, transform.position, dashDirection);
            }
            else state = State.Slamming;
        }

        void EndMove()
        {
            state = State.Idle;
            if (pig != null) pig.MovementLocked = false;
        }

        void FixedUpdate()
        {
            if (state == State.Idle || !pig.Simulate) return;
            if (pig.IsHeld) { EndMove(); return; }
            steps++;
            if (state == State.Dashing) DashStep();
            else SlamStep();
        }

        void DashStep()
        {
            var body = pig.Body;
            Vector3 v = body.linearVelocity;
            float elapsed = Time.time - stateStart;
            // Done, or bumped into something solid (much slower than we push).
            if (elapsed >= dashTime || (steps > 2 && new Vector3(v.x, 0f, v.z).magnitude < dashSpeed * 0.4f))
            {
                body.linearVelocity = new Vector3(v.x * 0.5f, v.y, v.z * 0.5f);
                EndMove();
                return;
            }
            body.linearVelocity = new Vector3(dashDirection.x * dashSpeed, v.y, dashDirection.z * dashSpeed);
            body.angularVelocity = Vector3.zero; // Turn() is paused while locked - don't spin from bumps
            Vector3 front = body.position + dashDirection * 0.9f;
            Hit(front, hitRadius, front, dashDirection, knockImpulse, maxKnockSpeed, hitRadius);
        }

        void SlamStep()
        {
            var body = pig.Body;
            Vector3 v = body.linearVelocity;
            float elapsed = Time.time - stateStart;
            // Landed: on the ground, or something stopped the fall.
            if ((steps > 1 && (pig.IsGrounded || v.y > -slamSpeed * 0.5f)) || elapsed > 2f)
            {
                Vector3 c = body.position;
                Hit(c, slamRadius, c + Vector3.down * 0.5f, Vector3.zero, slamImpulse, maxSlamSpeed, slamBreakRadius);
                TriggerEffect(FxSlam, c + Vector3.down * 0.4f, Vector3.up);
                EndMove();
                return;
            }
            body.linearVelocity = new Vector3(v.x * 0.9f, -slamSpeed, v.z * 0.9f);
            // Smash breakables just below before we hit them, so we fall through.
            Hit(body.position + Vector3.down * 0.6f, 0.6f, body.position, Vector3.zero, 0f, 0f, 0.6f);
        }

        /// <summary>
        /// Smash breakables within breakRadius of the zone, and knock rigidbodies in the zone away:
        /// along `direction` (+ a little up), or radially from `from` when direction is zero.
        /// </summary>
        void Hit(Vector3 center, float radius, Vector3 from, Vector3 direction, float impulse, float maxSpeed, float breakRadius)
        {
            foreach (var col in Physics.OverlapSphere(center, radius, ~0, QueryTriggerInteraction.Ignore))
            {
                var breakable = col.GetComponentInParent<Breakable>();
                if (breakable != null)
                {
                    if (breakable.IsBroken) continue;
                    if ((col.ClosestPoint(center) - center).sqrMagnitude <= breakRadius * breakRadius)
                    {
                        breakable.Break();
                        continue;
                    }
                }

                var rb = col.attachedRigidbody;
                if (impulse <= 0f || rb == null || rb == pig.Body || rb.isKinematic || !hitBodies.Add(rb)) continue;
                if (pig.Grabber != null && rb == pig.Grabber.Held) continue;
                if (rb.TryGetComponent(out PigController other) && other.IsHeld) continue;

                Vector3 dir;
                float falloff = 1f;
                if (direction != Vector3.zero) dir = direction + Vector3.up * 0.35f;
                else
                {
                    Vector3 away = rb.worldCenterOfMass - from;
                    Vector3 flat = new(away.x, 0f, away.z);
                    dir = (flat.sqrMagnitude > 0.01f ? flat.normalized : Vector3.forward) + Vector3.up * 0.8f;
                    falloff = 1f - 0.6f * Mathf.Clamp01(away.magnitude / radius);
                }
                float speed = Mathf.Min(impulse / rb.mass, maxSpeed) * falloff;
                rb.AddForce(dir.normalized * speed, ForceMode.VelocityChange);
            }
        }

        // ---------- trampoline ----------

        void OnCollisionEnter(Collision collision)
        {
            if (!enabled || !pig.Simulate || collision.rigidbody == null) return;
            if (!collision.rigidbody.TryGetComponent(out PigController other) || other.IsHeld) return;
            if (other.Body.position.y < pig.Body.position.y + 0.45f) return; // must land on top
            if (Mathf.Abs(collision.relativeVelocity.y) < minBounceFallSpeed) return;
            other.Launch(Mathf.Sqrt(2f * -Physics.gravity.y * bounceHeight), Vector3.zero);
            TriggerEffect(FxBounce, other.Body.position + Vector3.down * 0.4f, Vector3.up);
        }

        // ---------- visuals (every PC) ----------

        public override void PlayEffect(byte kind, Vector3 position, Vector3 direction)
        {
            switch (kind)
            {
                case FxDash:
                    StartCoroutine(DashTrail());
                    break;
                case FxSlam:
                    SmokeCloud.Spawn(position, 1f, 0.9f, SmokeCloud.DustColor);
                    for (int i = 0; i < 8; i++)
                    {
                        Vector3 ring = Quaternion.Euler(0f, i * 45f, 0f) * Vector3.forward * 1.4f;
                        SmokeCloud.Spawn(position + ring, 0.55f, 0.8f, SmokeCloud.DustColor);
                    }
                    break;
                case FxBounce:
                    SmokeCloud.Spawn(position, 0.4f, 0.5f, SmokeCloud.DustColor);
                    break;
            }
        }

        IEnumerator DashTrail()
        {
            var wait = new WaitForSeconds(0.04f);
            for (float t = 0f; t < dashTime; t += 0.04f)
            {
                SmokeCloud.Spawn(transform.position + Vector3.down * 0.35f, 0.35f, 0.6f, SmokeCloud.DustColor);
                yield return wait;
            }
        }
    }
}
