using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Jumpy, the parkour pig.
    /// Passive: Wall Bounce - jump in the air next to a wall to kick off it (not twice in a row off the same
    /// wall, so climb between two walls / in corners); ledge grab - pushing into a ledge within reach while
    /// airborne pulls Jumpy up onto it.
    /// Ability: Rope Ladder - at a ledge's edge (looking at it), drop a rope ladder any pig can climb
    /// (20 s, then a long cooldown). Press again to pull it back up.
    /// </summary>
    public class JumpyAbility : PigAbility
    {
        [Header("Wall bounce")]
        public float wallJumpHeight = 1.6f;
        [Tooltip("Speed away from the wall.")]
        public float wallJumpPush = 5.5f;

        [Header("Ledge grab")]
        [Tooltip("How far above Jumpy's centre a ledge can be grabbed.")]
        public float ledgeReach = 1.1f;

        [Header("Rope ladder")]
        public float maxRopeLength = 8f;
        public float ropeLifetime = 20f;

        public override PigType Type => PigType.Jumpy;
        public override string Hint => "at an edge  |  jump at walls: wall bounce";

        const byte FxWallJump = 0, FxMantle = 1, FxRopeDrop = 2, FxRopeRemove = 3;

        Vector3 lastWallNormal;
        bool hasLastWall;
        float nextMantleTime;
        RopeLadder rope; // on every PC
        Vector3 edgeTop, edgeOutward;
        float edgeDrop;

        protected override void Awake()
        {
            base.Awake();
            cooldown = 90f; // counts from the drop; pulling the rope up doesn't reset it
        }

        void OnDisable()
        {
            if (rope != null) Destroy(rope.gameObject);
        }

        // ---------- wall bounce ----------

        public override bool TryAirJump()
        {
            if (pig.IsHeld || !FindWall(out Vector3 normal, out Vector3 point)) return false;
            if (hasLastWall && Vector3.Dot(lastWallNormal, normal) > 0.5f) return false; // same wall again
            lastWallNormal = normal;
            hasLastWall = true;

            Vector3 v = pig.Body.linearVelocity;
            Vector3 flat = new(v.x, 0f, v.z);
            Vector3 along = flat - normal * Vector3.Dot(flat, normal); // keep some sideways speed
            Vector3 wanted = along * 0.5f + normal * wallJumpPush;
            pig.Launch(Mathf.Sqrt(2f * -Physics.gravity.y * wallJumpHeight), wanted - flat);
            TriggerEffect(FxWallJump, point, normal);
            return true;
        }

        void FixedUpdate()
        {
            if (!pig.Simulate) return;
            if (pig.IsGrounded) hasLastWall = false;
            else TryMantle();
        }

        // ---------- ledge grab ----------

        void TryMantle()
        {
            if (Time.time < nextMantleTime || pig.IsHeld || pig.IsClimbing || pig.MovementLocked) return;
            var body = pig.Body;
            if (body.linearVelocity.y > 3f || pig.MoveInput.sqrMagnitude < 0.25f) return;
            if (!FindWall(out Vector3 normal, out Vector3 point)) return;
            if (Vector3.Dot(pig.MoveInput.normalized, -normal) < 0.5f) return; // not pushing into it

            GetCapsuleInfo(out float centerY, out float feet);
            Vector3 probe = new Vector3(point.x, centerY + ledgeReach, point.z) - normal * 0.35f;
            if (!Physics.Raycast(probe, Vector3.down, out RaycastHit top, ledgeReach + 0.6f, ~0, QueryTriggerInteraction.Ignore)) return;
            if (top.normal.y < 0.7f || top.point.y < feet + 0.15f) return; // not a ledge above our feet
            if (top.rigidbody != null && !top.rigidbody.isKinematic) return; // don't climb loose objects
            if (!HasRoom(top.point + Vector3.up * 0.6f, 0.4f)) return;

            Vector3 v = body.linearVelocity;
            Vector3 flat = new(v.x, 0f, v.z);
            float rise = top.point.y - feet + 0.3f;
            pig.Launch(Mathf.Sqrt(2f * -Physics.gravity.y * rise), -normal * 2.5f - flat);
            nextMantleTime = Time.time + 0.5f;
            TriggerEffect(FxMantle, top.point, normal);
        }

        /// <summary>Nothing but Jumpy itself in this sphere.</summary>
        bool HasRoom(Vector3 center, float radius)
        {
            foreach (var col in Physics.OverlapSphere(center, radius, ~0, QueryTriggerInteraction.Ignore))
                if (col.attachedRigidbody != pig.Body) return false;
            return true;
        }

        void GetCapsuleInfo(out float centerY, out float feet)
        {
            pig.GetCapsule(out Vector3 a, out Vector3 b, out float radius);
            centerY = (a.y + b.y) / 2f;
            feet = Mathf.Min(a.y, b.y) - radius;
        }

        /// <summary>Nearest wall (static or kinematic, roughly vertical) touching Jumpy's body.</summary>
        bool FindWall(out Vector3 normal, out Vector3 point)
        {
            normal = point = Vector3.zero;
            pig.GetCapsule(out Vector3 a, out Vector3 b, out float radius);
            float best = float.MaxValue;
            foreach (var col in Physics.OverlapCapsule(a, b, radius + 0.15f, ~0, QueryTriggerInteraction.Ignore))
            {
                var rb = col.attachedRigidbody;
                if (rb == pig.Body || (rb != null && !rb.isKinematic)) continue;
                if (col is MeshCollider mesh && !mesh.convex) continue; // ClosestPoint can't do these
                if (col is TerrainCollider) continue;
                CheckWallPoint(col, a, ref best, ref normal, ref point);
                CheckWallPoint(col, b, ref best, ref normal, ref point);
            }
            return best < float.MaxValue;
        }

        static void CheckWallPoint(Collider col, Vector3 from, ref float best, ref Vector3 normal, ref Vector3 point)
        {
            Vector3 cp = col.ClosestPoint(from);
            Vector3 dir = from - cp;
            Vector3 flat = new(dir.x, 0f, dir.z);
            float dist = dir.magnitude;
            if (dist < 0.001f || flat.magnitude < 0.7f * dist) return; // inside, or floor/ceiling
            if (dist < best) { best = dist; normal = flat.normalized; point = cp; }
        }

        // ---------- rope ladder ----------

        protected override bool CanUse() => !pig.IsHeld && rope == null && pig.IsGrounded && FindEdge();

        // Direction encodes the rope: outward * length.
        protected override void Use() => TriggerEffect(FxRopeDrop, edgeTop, edgeOutward * edgeDrop);

        protected override void PressedWhileUnavailable()
        {
            if (rope != null) TriggerEffect(FxRopeRemove, Vector3.zero, Vector3.zero);
        }

        /// <summary>Is there a drop in front of Jumpy (where it looks)? Fills edgeTop / edgeOutward / edgeDrop.</summary>
        bool FindEdge()
        {
            var body = pig.Body;
            Vector3 fwd = Vector3.ProjectOnPlane(pig.Aim.sqrMagnitude > 0.01f ? pig.Aim : transform.forward, Vector3.up);
            if (fwd.sqrMagnitude < 0.001f) return false;
            fwd.Normalize();
            GetCapsuleInfo(out float centerY, out float feet);
            float surface = feet;
            for (float d = 0.3f; d <= 1.8f; d += 0.15f)
            {
                Vector3 p = new Vector3(body.position.x, centerY, body.position.z) + fwd * d;
                if (Physics.Raycast(p + Vector3.up * 0.3f, Vector3.down, out RaycastHit hit, 1.3f, ~0, QueryTriggerInteraction.Ignore)
                    && hit.point.y > feet - 0.6f)
                {
                    surface = hit.point.y; // still standing ground here
                    continue;
                }
                // Drop found: the rope hangs just past the edge down to the ground.
                Vector3 top = new Vector3(p.x, surface, p.z) + fwd * 0.1f;
                float drop = Physics.Raycast(top + fwd * 0.2f + Vector3.down * 0.05f, Vector3.down, out RaycastHit ground,
                    maxRopeLength, ~0, QueryTriggerInteraction.Ignore) ? top.y - ground.point.y : maxRopeLength;
                if (drop < 1.2f) return false; // just a small step
                edgeTop = top;
                edgeOutward = fwd;
                edgeDrop = drop;
                return true;
            }
            return false;
        }

        // ---------- visuals (every PC) ----------

        public override void PlayEffect(byte kind, Vector3 position, Vector3 direction)
        {
            switch (kind)
            {
                case FxWallJump:
                case FxMantle:
                    SmokeCloud.Spawn(position, 0.35f, 0.5f, SmokeCloud.DustColor);
                    break;
                case FxRopeDrop:
                    if (rope != null) Destroy(rope.gameObject);
                    rope = RopeLadder.Create(position, direction, direction.magnitude, ropeLifetime);
                    break;
                case FxRopeRemove:
                    if (rope != null) Destroy(rope.gameObject);
                    rope = null;
                    break;
            }
        }
    }
}
