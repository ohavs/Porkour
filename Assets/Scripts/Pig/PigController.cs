using System.Collections.Generic;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Physics-based pig movement: run, sprint, jump with coyote time and jump buffer.
    /// Driven only through SetInput/PressJump (world-space move + aim direction), never reads the
    /// camera itself - the server applies each player's input (NetPlayer), AI/Bob can do the same.
    /// Tuning values live here as defaults - the builder recreates the prefab, so tweak in code.
    /// Pig type (SetType) scales speed/jump/braking/mass and picks the ability (see PigTypes).
    /// </summary>
    [RequireComponent(typeof(Rigidbody), typeof(CapsuleCollider))]
    public class PigController : MonoBehaviour
    {
        /// <summary>All active pigs (used later by Bob, objectives, etc.).</summary>
        public static readonly List<PigController> All = new();

        [Header("Move")]
        public float walkSpeed = 6f;
        public float sprintSpeed = 9f;
        public float groundAcceleration = 30f;
        public float groundDeceleration = 40f;
        public float airAcceleration = 15f;
        [Tooltip("Horizontal slow-down in the air with no input.")]
        public float airDrag = 5f;
        public float turnSpeed = 480f;
        [Tooltip("Face where the camera looks (A/D strafe sideways). Off = turn toward movement.")]
        public bool faceAimDirection = true;

        [Header("Jump")]
        public float jumpHeight = 1.6f;
        public float fallGravityMultiplier = 2f;
        [Tooltip("Extra gravity while rising after releasing jump early (short hop). Only for own jumps.")]
        public float shortJumpGravityMultiplier = 2.5f;
        public float coyoteTime = 0.12f;
        public float jumpBufferTime = 0.15f;

        [Header("Ground Check")]
        public float groundCheckRadius = 0.35f;
        public float groundCheckDistance = 0.12f;
        public float maxGroundAngle = 50f;
        public LayerMask groundLayers = ~0;

        [Header("Held")]
        [Tooltip("Jump presses needed to wriggle free when another pig carries you.")]
        public int struggleToEscape = 6;

        [Header("Respawn")]
        public float killHeight = -10f;

        public bool IsGrounded { get; private set; }
        public NetPlayer Owner { get; internal set; }
        /// <summary>False on network clients: the server simulates, clients only show the synced result.</summary>
        public bool Simulate { get; set; } = true;
        public Rigidbody Body => rb;
        public PigGrabber Grabber { get; private set; }
        /// <summary>The pig carrying this pig (null when free).</summary>
        public PigGrabber HeldBy { get; private set; }
        public bool IsHeld => HeldBy != null;
        /// <summary>Set by the grabber: carrying heavy things slows you down.</summary>
        public float SpeedMultiplier { get; set; } = 1f;
        /// <summary>Where the controller is looking (camera forward for players). Zero = no aim.</summary>
        public Vector3 Aim { get; private set; }
        /// <summary>World-space move input (length ≤ 1).</summary>
        public Vector3 MoveInput => moveInput;
        public PigType Type { get; private set; }
        /// <summary>This type's special ability (null if not built yet).</summary>
        public PigAbility Ability { get; private set; }

        Rigidbody rb;
        CapsuleCollider body;

        Vector3 moveInput;
        bool jumpHeld, sprintHeld, jumpedThisAir;
        float lastGroundedTime = float.NegativeInfinity;
        float lastJumpPressedTime = float.NegativeInfinity;
        float groundLockUntil;
        Vector3 spawnPosition;
        Quaternion spawnRotation;
        int struggleCount;
        float speedFactor = 1f, jumpFactor = 1f, brakeFactor = 1f;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => All.Clear();

        void Awake()
        {
            rb = GetComponent<Rigidbody>();
            body = GetComponent<CapsuleCollider>();
            Grabber = GetComponent<PigGrabber>();
            spawnPosition = transform.position;
            spawnRotation = transform.rotation;
        }

        void OnEnable() => All.Add(this);
        void OnDisable() => All.Remove(this);

        /// <summary>Continuous input, called every frame by the owner. Move is world-space (length ≤ 1).</summary>
        public void SetInput(Vector3 worldMove, Vector3 aim, bool jumpIsHeld, bool sprintIsHeld)
        {
            moveInput = Vector3.ClampMagnitude(new Vector3(worldMove.x, 0f, worldMove.z), 1f);
            Aim = aim;
            jumpHeld = jumpIsHeld;
            sprintHeld = sprintIsHeld;
        }

        public void ClearInput() => SetInput(Vector3.zero, Vector3.zero, false, false);

        /// <summary>Apply a pig type (on every PC): body stats + enable its ability (added on first use).</summary>
        public void SetType(PigType type)
        {
            Type = type;
            var info = PigTypes.Info(type);
            speedFactor = info.Speed;
            jumpFactor = info.Jump;
            brakeFactor = info.Brake;
            rb.mass = info.Mass;

            Ability = null;
            foreach (var ability in GetComponents<PigAbility>())
            {
                ability.CancelInput();
                ability.enabled = ability.Type == type;
                if (ability.enabled) Ability = ability;
            }
            if (Ability == null) Ability = PigTypes.AddAbility(gameObject, type);
        }

        /// <summary>Jump press (buffered, so it may fire slightly before landing).</summary>
        public void PressJump()
        {
            if (IsHeld)
            {
                if (++struggleCount >= struggleToEscape) HeldBy.Drop();
                return;
            }
            lastJumpPressedTime = Time.time;
        }

        internal void SetHeldBy(PigGrabber grabber)
        {
            HeldBy = grabber;
            struggleCount = 0;
            jumpedThisAir = false;
            rb.useGravity = grabber == null;
            if (grabber != null && Grabber != null) Grabber.Drop(); // can't carry while being carried
        }

        void FixedUpdate()
        {
            if (!Simulate) return;
            if (rb.position.y < killHeight) { Respawn(); return; }
            if (IsHeld) { IsGrounded = false; return; } // the carrier moves us

            CheckGround();
            Move();
            Turn();
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
                jumpedThisAir = false;
                lastGroundedTime = Time.time;
            }
        }

        void Move()
        {
            Vector3 velocity = rb.linearVelocity;
            Vector3 horizontal = new(velocity.x, 0f, velocity.z);
            Vector3 target = moveInput * ((sprintHeld ? sprintSpeed : walkSpeed) * speedFactor * SpeedMultiplier);
            bool hasInput = moveInput.sqrMagnitude > 0.01f;
            float dt = Time.fixedDeltaTime;
            Vector3 newHorizontal;
            if (IsGrounded)
                newHorizontal = Vector3.MoveTowards(horizontal, target, (hasInput ? groundAcceleration : groundDeceleration * brakeFactor) * dt);
            else if (!hasInput) // no input in the air: only light drag, so throws/knockbacks carry
                newHorizontal = Vector3.MoveTowards(horizontal, Vector3.zero, airDrag * dt);
            else if (horizontal.magnitude <= target.magnitude)
                newHorizontal = Vector3.MoveTowards(horizontal, target, airAcceleration * dt);
            else // flying faster than we can run (thrown): steer, don't brake
                newHorizontal = Vector3.MoveTowards(horizontal, moveInput.normalized * horizontal.magnitude, airAcceleration * dt);
            rb.AddForce(newHorizontal - horizontal, ForceMode.VelocityChange);
        }

        void Turn()
        {
            rb.angularVelocity = Vector3.zero;
            if (moveInput.sqrMagnitude < 0.01f) return; // standing still: let the camera orbit freely
            Vector3 facing = faceAimDirection ? Vector3.ProjectOnPlane(Aim, Vector3.up) : moveInput;
            if (facing.sqrMagnitude < 0.001f) facing = moveInput;
            Quaternion target = Quaternion.LookRotation(facing.normalized, Vector3.up);
            rb.MoveRotation(Quaternion.RotateTowards(rb.rotation, target, turnSpeed * Time.fixedDeltaTime));
        }

        /// <summary>Instantly face a direction (e.g. when throwing).</summary>
        public void FaceDirection(Vector3 direction)
        {
            direction = Vector3.ProjectOnPlane(direction, Vector3.up);
            if (direction.sqrMagnitude < 0.001f) return;
            rb.MoveRotation(Quaternion.LookRotation(direction.normalized, Vector3.up));
        }

        void TryJump()
        {
            bool buffered = Time.time - lastJumpPressedTime <= jumpBufferTime;
            bool canJump = Time.time - lastGroundedTime <= coyoteTime;
            if (!buffered || !canJump) return;

            Vector3 velocity = rb.linearVelocity;
            velocity.y = Mathf.Sqrt(2f * -Physics.gravity.y * jumpHeight * jumpFactor);
            rb.linearVelocity = velocity;

            lastJumpPressedTime = float.NegativeInfinity;
            lastGroundedTime = float.NegativeInfinity;
            groundLockUntil = Time.time + 0.15f;
            IsGrounded = false;
            jumpedThisAir = true;
        }

        /// <summary>Ability launch (e.g. Rocket Fart): sets upward speed, adds a horizontal push, no short-hop braking.</summary>
        public void Launch(float upSpeed, Vector3 horizontalPush)
        {
            Vector3 velocity = rb.linearVelocity + new Vector3(horizontalPush.x, 0f, horizontalPush.z);
            velocity.y = upSpeed;
            rb.linearVelocity = velocity;
            lastGroundedTime = float.NegativeInfinity; // no coyote jump stacked on top
            groundLockUntil = Time.time + 0.15f;
            IsGrounded = false;
            jumpedThisAir = false;
        }

        void ApplyExtraGravity()
        {
            if (IsGrounded) return;
            float multiplier = rb.linearVelocity.y < 0f ? fallGravityMultiplier
                : jumpedThisAir && !jumpHeld ? shortJumpGravityMultiplier
                : 1f;
            if (multiplier > 1f) rb.AddForce(Physics.gravity * (multiplier - 1f), ForceMode.Acceleration);
        }

        public void Respawn()
        {
            if (IsHeld) HeldBy.Drop();
            if (Grabber != null) Grabber.Drop();
            rb.linearVelocity = Vector3.zero;
            rb.angularVelocity = Vector3.zero;
            rb.position = spawnPosition;
            rb.rotation = spawnRotation;
            transform.SetPositionAndRotation(spawnPosition, spawnRotation);
        }
    }
}
