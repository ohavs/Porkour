using System.Collections.Generic;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Grab / carry / throw. Hold Grab to pick up the nearest loose object or pig in front of the snout
    /// and carry it on your back; release to drop, press Throw to launch it.
    /// Held things follow by velocity (they still collide with walls), heavy loads slow you down,
    /// and a carried pig can wriggle free by mashing jump.
    /// </summary>
    [RequireComponent(typeof(PigController))]
    public class PigGrabber : MonoBehaviour
    {
        [Header("Grab")]
        public float reach = 0.9f;
        public float grabRadius = 0.7f;
        [Tooltip("Heaviest thing this pig can lift (a pig is 30).")]
        public float maxLiftMass = 35f;
        [Tooltip("Speed multiplier when carrying something at max lift mass.")]
        public float fullLoadSpeed = 0.55f;

        [Header("Carry")]
        public float followStrength = 18f;
        public float maxFollowSpeed = 25f;
        [Tooltip("Drop if the load gets stuck this far from the carry point.")]
        public float breakDistance = 1.8f;

        [Header("Throw")]
        public float throwSpeed = 11f;
        public float throwUpSpeed = 5f;
        [Tooltip("Throw speed multiplier at max lift mass.")]
        public float fullLoadThrow = 0.6f;

        public Rigidbody Held { get; private set; }
        public bool IsHolding => Held != null;

        PigController pig;
        Collider[] ownColliders;
        readonly List<Collider> heldColliders = new();
        PigController heldPig;
        Quaternion heldRelativeRotation;
        float heldLift; // carry point height above our centre
        bool grabHeld;

        void Awake()
        {
            pig = GetComponent<PigController>();
            ownColliders = GetComponentsInChildren<Collider>();
        }

        /// <summary>Called every frame by the owner with the Grab button state.</summary>
        public void SetGrab(bool held)
        {
            if (held && !grabHeld && !IsHolding && !pig.IsHeld) TryGrab();
            else if (!held && grabHeld && IsHolding) Drop();
            grabHeld = held;
        }

        public void Throw()
        {
            if (!IsHolding) return;
            var rb = Held;
            float load = LoadFactor(rb.mass);
            Vector3 forward = transform.forward;
            Drop();
            Vector3 throwVelocity = forward * throwSpeed + Vector3.up * throwUpSpeed;
            rb.linearVelocity = pig.Body.linearVelocity + throwVelocity * Mathf.Lerp(1f, fullLoadThrow, load);
        }

        void TryGrab()
        {
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
            if (best != null) Grab(best);
        }

        bool CanGrab(Rigidbody rb)
        {
            if (rb == null || rb == pig.Body || rb.isKinematic || rb.mass > maxLiftMass) return false;
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
            heldColliders.Clear();
            rb.GetComponentsInChildren(heldColliders);
            SetIgnoreCollisions(true);

            // Carry on the back: centre of load sits just above our top.
            var bounds = new Bounds(rb.position, Vector3.zero);
            foreach (var c in heldColliders) bounds.Encapsulate(c.bounds);
            float bottomBelowPivot = rb.position.y - bounds.min.y;
            heldLift = 0.45f + bottomBelowPivot + 0.05f;
            heldRelativeRotation = Quaternion.Inverse(transform.rotation) * rb.rotation;

            if (rb.TryGetComponent(out heldPig)) heldPig.SetHeldBy(this);
            else rb.useGravity = false;

            pig.SpeedMultiplier = Mathf.Lerp(1f, fullLoadSpeed, LoadFactor(rb.mass));
        }

        public void Drop()
        {
            if (!IsHolding) return;
            var rb = Held;
            SetIgnoreCollisions(false);
            if (heldPig != null) heldPig.SetHeldBy(null);
            else rb.useGravity = true;
            Held = null;
            heldPig = null;
            heldColliders.Clear();
            pig.SpeedMultiplier = 1f;
        }

        void FixedUpdate()
        {
            if (!IsHolding) return;
            if (Held == null || !Held.gameObject.activeInHierarchy) { Drop(); return; }

            Vector3 target = pig.Body.position + Vector3.up * heldLift;
            Vector3 toTarget = target - Held.position;
            if (toTarget.magnitude > breakDistance) { Drop(); return; }

            Vector3 velocity = pig.Body.linearVelocity + toTarget * followStrength;
            Held.linearVelocity = Vector3.ClampMagnitude(velocity, maxFollowSpeed);
            Held.angularVelocity = Vector3.zero;
            Held.MoveRotation(Quaternion.Slerp(Held.rotation, transform.rotation * heldRelativeRotation, 0.3f));
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
