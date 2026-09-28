using System.Collections.Generic;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Physics-based pig movement: camera-relative run, sprint, jump with coyote time and jump buffer.
    /// Driven by whoever owns it (a PigPlayer now; later AI/farmer states) via SetInput/PressJump.
    /// Tuning values live here as defaults - the builder recreates the prefab, so tweak in code.
    /// </summary>
    [RequireComponent(typeof(Rigidbody), typeof(CapsuleCollider))]
    public class PigController : MonoBehaviour
    {
        /// <summary>All active pigs (used later by Bob, objectives, etc.).</summary>
        public static readonly List<PigController> All = new();

        [Header("Move")]
        public float walkSpeed = 6f;
        public float sprintSpeed = 9f;
        public float groundAcceleration = 60f;
        public float airAcceleration = 20f;
        public float turnSpeed = 720f;

        [Header("Jump")]
        public float jumpHeight = 1.6f;
        public float fallGravityMultiplier = 2f;
        public float shortJumpGravityMultiplier = 2.5f;
        public float coyoteTime = 0.12f;
        public float jumpBufferTime = 0.15f;

        [Header("Ground Check")]
        public float groundCheckRadius = 0.35f;
        public float groundCheckDistance = 0.12f;
        public float maxGroundAngle = 50f;
        public LayerMask groundLayers = ~0;

        [Header("Respawn")]
        public float killHeight = -10f;

        public bool IsGrounded { get; private set; }
        public PigPlayer Owner { get; internal set; }

        Rigidbody rb;
        CapsuleCollider body;
        Transform cam;

        Vector2 moveInput;
        bool jumpHeld, sprintHeld;
        float lastGroundedTime = float.NegativeInfinity;
        float lastJumpPressedTime = float.NegativeInfinity;
        float groundLockUntil;
        Vector3 spawnPosition;
        Quaternion spawnRotation;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => All.Clear();

        void Awake()
        {
            rb = GetComponent<Rigidbody>();
            body = GetComponent<CapsuleCollider>();
            spawnPosition = transform.position;
            spawnRotation = transform.rotation;
        }

        void OnEnable() => All.Add(this);
        void OnDisable() => All.Remove(this);

        void Start()
        {
            if (Camera.main != null) cam = Camera.main.transform;
        }

        /// <summary>Continuous input, called every frame by the owner.</summary>
        public void SetInput(Vector2 move, bool jumpIsHeld, bool sprintIsHeld)
        {
            moveInput = move;
            jumpHeld = jumpIsHeld;
            sprintHeld = sprintIsHeld;
        }

        /// <summary>Jump press (buffered, so it may fire slightly before landing).</summary>
        public void PressJump() => lastJumpPressedTime = Time.time;

        public void ClearInput() => SetInput(Vector2.zero, false, false);

        void FixedUpdate()
        {
            if (rb.position.y < killHeight) { Respawn(); return; }

            CheckGround();
            Vector3 moveDir = GetMoveDirection();
            Move(moveDir);
            Turn(moveDir);
            TryJump();
            ApplyExtraGravity();
        }

        void CheckGround()
        {
            IsGrounded = false;
            if (Time.time < groundLockUntil) return;

            // Sphere starts inside our own collider, so the cast ignores it.
            Vector3 origin = rb.position + rb.rotation * body.center;
            float distance = body.radius - groundCheckRadius + groundCheckDistance;
            if (Physics.SphereCast(origin, groundCheckRadius, Vector3.down, out RaycastHit hit, distance,
                    groundLayers, QueryTriggerInteraction.Ignore)
                && Vector3.Angle(hit.normal, Vector3.up) <= maxGroundAngle)
            {
                IsGrounded = true;
                lastGroundedTime = Time.time;
            }
        }

        Vector3 GetMoveDirection()
        {
            Vector3 forward = Vector3.forward;
            if (cam != null)
            {
                forward = Vector3.ProjectOnPlane(cam.forward, Vector3.up);
                if (forward.sqrMagnitude < 0.01f) forward = Vector3.ProjectOnPlane(cam.up, Vector3.up);
                forward.Normalize();
            }
            Vector3 right = Vector3.Cross(Vector3.up, forward);
            return Vector3.ClampMagnitude(forward * moveInput.y + right * moveInput.x, 1f);
        }

        void Move(Vector3 moveDir)
        {
            Vector3 velocity = rb.linearVelocity;
            Vector3 horizontal = new(velocity.x, 0f, velocity.z);
            Vector3 target = moveDir * (sprintHeld ? sprintSpeed : walkSpeed);
            float accel = IsGrounded ? groundAcceleration : airAcceleration;
            Vector3 newHorizontal = Vector3.MoveTowards(horizontal, target, accel * Time.fixedDeltaTime);
            rb.AddForce(newHorizontal - horizontal, ForceMode.VelocityChange);
        }

        void Turn(Vector3 moveDir)
        {
            rb.angularVelocity = Vector3.zero;
            if (moveDir.sqrMagnitude < 0.01f) return;
            Quaternion target = Quaternion.LookRotation(moveDir, Vector3.up);
            rb.MoveRotation(Quaternion.RotateTowards(rb.rotation, target, turnSpeed * Time.fixedDeltaTime));
        }

        void TryJump()
        {
            bool buffered = Time.time - lastJumpPressedTime <= jumpBufferTime;
            bool canJump = Time.time - lastGroundedTime <= coyoteTime;
            if (!buffered || !canJump) return;

            Vector3 velocity = rb.linearVelocity;
            velocity.y = Mathf.Sqrt(2f * -Physics.gravity.y * jumpHeight);
            rb.linearVelocity = velocity;

            lastJumpPressedTime = float.NegativeInfinity;
            lastGroundedTime = float.NegativeInfinity;
            groundLockUntil = Time.time + 0.15f;
            IsGrounded = false;
        }

        void ApplyExtraGravity()
        {
            if (IsGrounded) return;
            float multiplier = rb.linearVelocity.y < 0f ? fallGravityMultiplier
                : !jumpHeld ? shortJumpGravityMultiplier
                : 1f;
            if (multiplier > 1f) rb.AddForce(Physics.gravity * (multiplier - 1f), ForceMode.Acceleration);
        }

        public void Respawn()
        {
            rb.linearVelocity = Vector3.zero;
            rb.angularVelocity = Vector3.zero;
            rb.position = spawnPosition;
            rb.rotation = spawnRotation;
            transform.SetPositionAndRotation(spawnPosition, spawnRotation);
        }
    }
}
