using System.Collections.Generic;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// One-button grab / carry / throw.
    /// Press Grab near a loose object or pig → it goes onto your back (no need to hold).
    /// Press Grab again → throw where you aim; hold longer before releasing = stronger throw
    /// (a quick tap just tosses it down in front of you).
    /// Held things follow by velocity (still collide with walls), heavy loads slow you down,
    /// and a carried pig can wriggle free by mashing jump. Wearables (the bucket) go over the pig instead of on its back.
    /// </summary>
    [RequireComponent(typeof(PigController))]
    public class PigGrabber : MonoBehaviour, IPigCarrier
    {
        [Header("Grab")]
        public float reach = 0.9f;
        public float grabRadius = 0.8f;
        [Tooltip("Heaviest thing this pig can lift (pigs weigh 22-30, Heavy 45 - see PigTypes).")]
        public float maxLiftMass = 35f;
        [Tooltip("Speed multiplier when carrying something at max lift mass.")]
        public float fullLoadSpeed = 0.6f;
        [Tooltip("Height of the pig's back above its centre (carried things sit on it).")]
        public float backHeight = 0.62f;

        [Header("Carry")]
        public float followStrength = 12f;
        [Tooltip("Max correction speed toward the carry point (on top of the carrier's own speed).")]
        public float maxCorrectionSpeed = 6f;
        [Tooltip("Drop if the load stays stuck this far from the carry point.")]
        public float breakDistance = 2.5f;

        [Header("Throw")]
        public float minThrowSpeed = 3f;
        public float maxThrowSpeed = 14f;
        [Tooltip("Seconds of holding the button for a full-power throw.")]
        public float fullChargeTime = 0.6f;
        [Tooltip("Throw angle when aiming straight ahead; looking up/down adds/subtracts.")]
        public float baseThrowAngle = 40f;
        public float minThrowAngle = 5f;
        public float maxThrowAngle = 70f;
        [Tooltip("Throw speed multiplier at max lift mass.")]
        public float fullLoadThrow = 0.7f;

        public Rigidbody Held { get; private set; }
        /// <summary>False on network clients (see PigController.Simulate).</summary>
        public bool Simulate { get; set; } = true;
        public bool IsHolding => Held != null;
        /// <summary>A carried pig escapes with its own struggleToEscape presses.</summary>
        public int EscapePresses => 0;
        public bool IsCharging => charging;
        /// <summary>0..1 while charging a throw. Reaching 1 throws automatically.</summary>
        public float Charge => charging ? Mathf.Clamp01((Time.time - chargeStart) / fullChargeTime) : 0f;

        PigController pig;
        Collider[] ownColliders;
        readonly List<Collider> heldColliders = new();
        PigController heldPig;
        Wearable worn;
        Quaternion heldRelativeRotation;
        float heldLift; // carry point height above our centre
        float stuckTime;
        bool buttonHeld, charging;
        float chargeStart;

        void Awake()
        {
            pig = GetComponent<PigController>();
            ownColliders = GetComponentsInChildren<Collider>();
        }

        /// <summary>Called every frame by the owner with the Grab button state.</summary>
        public void SetGrabButton(bool pressed)
        {
            if (!Simulate) return;
            bool down = pressed && !buttonHeld;
            bool up = !pressed && buttonHeld;
            buttonHeld = pressed;

            if (down)
            {
                if (!IsHolding) { if (!pig.IsHeld) TryGrab(); } // this press only picks up
                else { charging = true; chargeStart = Time.time; }
            }
            else if (up && charging)
            {
                float power = Charge;
                charging = false;
                Throw(power);
            }

            if (charging && Charge >= 1f)
            {
                charging = false;
                Throw(1f);
            }
        }

        /// <summary>Forget button state (e.g. when the player switches to another pig). Keeps holding.</summary>
        public void CancelInput()
        {
            buttonHeld = false;
            charging = false;
        }

        void TryGrab()
        {
            var target = FindGrabTarget();
            if (target != null) Grab(target);
        }

        /// <summary>What a grab press would pick up right now (null if nothing).</summary>
        public Rigidbody FindGrabTarget()
        {
            if (IsHolding || pig.IsHeld) return null;
            Vector3 center = pig.Body.position + transform.forward * reach + Vector3.up * 0.1f;
            Rigidbody best = null;
            float bestDist = float.MaxValue;
            foreach (var col in Physics.OverlapSphere(center, grabRadius, ~0, QueryTriggerInteraction.Ignore))
            {
                var rb = col.attachedRigidbody;
                if (!CanGrab(rb)) continue;
                float d = (rb.worldCenterOfMass - center).sqrMagnitude;
                if (d < bestDist) { bestDist = d; best = rb; }
            }
            return best;
        }

        bool CanGrab(Rigidbody rb)
        {
            if (rb == null || rb == pig.Body || rb.mass > maxLiftMass) return false;
            if (rb.isKinematic && Simulate) return false; // on clients every synced body is kinematic
            if (rb.TryGetComponent(out PigController other))
            {
                if (other.IsHeld) return false;
                if (other.Grabber != null && other.Grabber.Held == pig.Body) return false; // no carry loops
            }
            return true;
        }

        void Grab(Rigidbody rb)
        {
            Held = rb;
            stuckTime = 0f;
            heldColliders.Clear();
            rb.GetComponentsInChildren(heldColliders);
            SetIgnoreCollisions(true);

            // Carry on the back: bottom of the load sits just above our top.
            var bounds = new Bounds(rb.position, Vector3.zero);
            foreach (var c in heldColliders) bounds.Encapsulate(c.bounds);
            float bottomBelowPivot = rb.position.y - bounds.min.y;
            heldLift = backHeight + bottomBelowPivot + 0.05f;
            heldRelativeRotation = Quaternion.Inverse(transform.rotation) * rb.rotation;

            rb.TryGetComponent(out worn);
            if (rb.TryGetComponent(out heldPig)) heldPig.SetHeldBy(this);
            else rb.useGravity = false;

            pig.SpeedMultiplier = Mathf.Lerp(1f, fullLoadSpeed, LoadFactor(rb.mass));
        }

        void Throw(float power)
        {
            if (!IsHolding) return;
            var rb = Held;
            Vector3 velocity = PredictThrowVelocity(power, rb);
            pig.FaceDirection(new Vector3(velocity.x, 0f, velocity.z));
            Drop();
            rb.linearVelocity = velocity;
        }

        /// <summary>Launch velocity a throw with this power (0..1) would give this load right now.</summary>
        public Vector3 PredictThrowVelocity(float power, Rigidbody load)
        {
            if (load == null) return Vector3.zero;
            Vector3 aim = pig.Aim.sqrMagnitude > 0.01f ? pig.Aim.normalized : transform.forward;
            Vector3 flat = Vector3.ProjectOnPlane(aim, Vector3.up);
            flat = flat.sqrMagnitude > 0.001f ? flat.normalized : transform.forward;
            float lookUp = Mathf.Asin(Mathf.Clamp(aim.y, -1f, 1f)) * Mathf.Rad2Deg;
            float angle = Mathf.Clamp(baseThrowAngle + lookUp, minThrowAngle, maxThrowAngle) * Mathf.Deg2Rad;
            Vector3 direction = flat * Mathf.Cos(angle) + Vector3.up * Mathf.Sin(angle);
            float speed = Mathf.Lerp(minThrowSpeed, maxThrowSpeed, power) * Mathf.Lerp(1f, fullLoadThrow, LoadFactor(load.mass));
            return pig.Body.linearVelocity + direction * speed;
        }

        /// <summary>Let go without throwing (struggle, respawn, switching roles...).</summary>
        public void Drop()
        {
            if (!IsHolding) return;
            var rb = Held;
            SetIgnoreCollisions(false);
            if (heldPig != null) heldPig.SetHeldBy(null);
            else rb.useGravity = true;
            rb.linearVelocity = pig.Body.linearVelocity; // no leftover pull-up speed
            Held = null;
            heldPig = null;
            worn = null;
            heldColliders.Clear();
            charging = false;
            pig.SpeedMultiplier = 1f;
        }

        void FixedUpdate()
        {
            if (!Simulate || !IsHolding) return;
            if (!Held.gameObject.activeInHierarchy) { Drop(); return; }

            Vector3 target = worn != null ? pig.Body.position + transform.rotation * worn.wornOffset
                : pig.Body.position + Vector3.up * heldLift;
            Vector3 toTarget = target - Held.position;
            if (toTarget.magnitude > breakDistance)
            {
                stuckTime += Time.fixedDeltaTime;
                if (stuckTime > 0.3f) { Drop(); return; }
            }
            else stuckTime = 0f;

            Vector3 correction = Vector3.ClampMagnitude(toTarget * followStrength, maxCorrectionSpeed);
            Held.linearVelocity = pig.Body.linearVelocity + correction;
            Held.angularVelocity = Vector3.zero;
            Quaternion rotation = worn != null ? transform.rotation : transform.rotation * heldRelativeRotation;
            Held.MoveRotation(Quaternion.Slerp(Held.rotation, rotation, 0.3f));
        }

        void OnDisable() => Drop();

        float LoadFactor(float mass) => Mathf.Clamp01(mass / maxLiftMass);

        void SetIgnoreCollisions(bool ignore)
        {
            foreach (var own in ownColliders)
            foreach (var other in heldColliders)
                if (own != null && other != null) Physics.IgnoreCollision(own, other, ignore);
        }
    }
}
