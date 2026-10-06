using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Animation driver, local on every PC (reads only the synced transform). Real models: feeds the active Animator
    /// under "Visual" (Speed, Grounded, Held parameters; Bob's Mode / Throw via SetMode / Trigger). Primitive
    /// placeholders: walk bob + sway, swinging legs/arms. Always: squash &amp; stretch on jump/land, land/footstep
    /// sounds, and for pigs a label above the head (Zzz = nobody plays this pig, P2 = another player, FREE! = escaped).
    /// </summary>
    public class ProceduralAnimator : MonoBehaviour
    {
        public enum Kind { Pig, Farmer, Critter }

        public Kind kind = Kind.Pig;
        [Tooltip("Model root that gets bobbed / squashed (found by name 'Visual' if empty).")]
        public Transform visual;
        [Tooltip("Steps per metre walked.")]
        public float stepsPerMetre = 1.4f;
        public float bobHeight = 0.07f;
        public float swayAngle = 5f;
        public float limbSwing = 35f;
        [Tooltip("Speed that counts as full walking (for bob/swing strength).")]
        public float fullSpeed = 6f;
        [Tooltip("Footstep sound volume (0 = silent). Bob's heavy steps warn the pigs.")]
        public float stepVolume;

        /// <summary>Horizontal speed seen on this PC (m/s).</summary>
        public float Speed { get; private set; }
        /// <summary>Farmer: arms raised (carrying a pig).</summary>
        public bool ArmsUp { get; set; }
        /// <summary>Wobble around (stunned).</summary>
        public bool Dizzy { get; set; }

        struct Limb
        {
            public Transform T;
            public Vector3 Pos;
            public Quaternion Rot;
            public float HalfHeight, Phase;
            public bool Slide; // boots slide forward/back instead of swinging
        }

        Limb[] legs = new Limb[0], arms = new Limb[0];
        Transform tail;
        Vector3 tailPos, visualPos, visualScale;
        Quaternion visualRot;

        Vector3 lastPos, velocity;
        float cycle, airTime, minAirVy, lastGroundedTime, squash, squashVel;
        bool grounded, jumpLatched, hasLast;

        PigController pig;
        PigNet pigNet;
        TextMesh label;
        Animator animator;
        readonly System.Collections.Generic.HashSet<string> animatorParams = new();
        static readonly int SpeedId = Animator.StringToHash("Speed"), GroundedId = Animator.StringToHash("Grounded"),
            HeldId = Animator.StringToHash("Held"), ModeId = Animator.StringToHash("Mode");

        /// <summary>The model's Animator (the active one - pigs swap pig / hog models), or null for primitives.</summary>
        Animator ActiveAnimator
        {
            get
            {
                if (animator != null && animator.isActiveAndEnabled) return animator;
                animator = visual != null ? visual.GetComponentInChildren<Animator>() : null; // only active ones
                animatorParams.Clear();
                if (animator != null && animator.runtimeAnimatorController != null)
                    foreach (var p in animator.parameters) animatorParams.Add(p.name);
                return animator;
            }
        }

        /// <summary>Bob: animation mode (0 walk/run, 1 carry, 2 dizzy, 3 look around, 4 yell).</summary>
        public void SetMode(int mode)
        {
            var a = ActiveAnimator;
            if (a != null && animatorParams.Contains("Mode") && a.GetInteger(ModeId) != mode) a.SetInteger(ModeId, mode);
        }

        /// <summary>Fire an animation trigger (e.g. "Throw") if the model has it.</summary>
        public void Trigger(string name)
        {
            var a = ActiveAnimator;
            if (a != null && animatorParams.Contains(name)) a.SetTrigger(name);
        }

        void Awake()
        {
            if (visual == null) visual = transform.Find("Visual");
            pig = GetComponent<PigController>();
            pigNet = GetComponent<PigNet>();
            if (visual != null)
            {
                visualPos = visual.localPosition;
                visualRot = visual.localRotation;
                visualScale = visual.localScale;
                FindLimbs();
            }
            if (kind == Kind.Pig) BuildLabel();
        }

        void FindLimbs()
        {
            var legList = new System.Collections.Generic.List<Limb>();
            var armList = new System.Collections.Generic.List<Limb>();
            foreach (Transform child in visual)
            {
                string n = child.name;
                var limb = new Limb { T = child, Pos = child.localPosition, Rot = child.localRotation, HalfHeight = child.localScale.y };
                if (kind == Kind.Pig && n == "Leg")
                {
                    limb.Phase = child.localPosition.x * child.localPosition.z > 0f ? Mathf.PI : 0f; // diagonal pairs
                    legList.Add(limb);
                }
                else if (kind == Kind.Critter && n.StartsWith("Leg"))
                {
                    limb.Phase = child.localPosition.x < 0f ? 0f : Mathf.PI;
                    legList.Add(limb);
                }
                else if (kind == Kind.Farmer && (n == "BootL" || n == "BootR"))
                {
                    limb.Phase = n == "BootL" ? 0f : Mathf.PI;
                    limb.Slide = true;
                    legList.Add(limb);
                }
                else if (kind == Kind.Farmer && (n == "ArmL" || n == "ArmR"))
                {
                    limb.Phase = n == "ArmL" ? Mathf.PI : 0f; // opposite to the leg on the same side
                    armList.Add(limb);
                }
                else if (n == "Tail")
                {
                    tail = child;
                    tailPos = child.localPosition;
                }
            }
            legs = legList.ToArray();
            arms = armList.ToArray();
        }

        void LateUpdate()
        {
            float dt = Time.deltaTime;
            if (dt <= 0f) return;
            Vector3 pos = transform.position;
            if (!hasLast) { lastPos = pos; hasLast = true; }
            Vector3 raw = (pos - lastPos) / dt;
            lastPos = pos;
            if (raw.sqrMagnitude < 40f * 40f) // ignore teleports (respawn)
                velocity = Vector3.Lerp(velocity, raw, 1f - Mathf.Exp(-15f * dt));

            bool held = pigNet != null && pigNet.IsSpawned ? pigNet.IsHeld : pig != null && pig.IsHeld;
            UpdateGround(pos, held, dt);

            float speed = new Vector3(velocity.x, 0f, velocity.z).magnitude;
            Speed = speed;
            float move = Mathf.Clamp01(speed / fullSpeed);
            if (grounded)
            {
                float before = Mathf.Floor(cycle / Mathf.PI);
                cycle += speed * stepsPerMetre * Mathf.PI * dt;
                if (stepVolume > 0f && move > 0.15f && Mathf.Floor(cycle / Mathf.PI) != before)
                    Sfx.Play(Sound.Step, pos, stepVolume * Mathf.Lerp(0.6f, 1f, move));
            }

            UpdateSquash(dt);
            var a = ActiveAnimator;
            if (a != null)
            {
                if (animatorParams.Contains("Speed")) a.SetFloat(SpeedId, held ? 0f : speed, 0.1f, dt);
                if (animatorParams.Contains("Grounded")) a.SetBool(GroundedId, grounded || held);
                if (animatorParams.Contains("Held")) a.SetBool(HeldId, held);
            }
            if (visual != null) Pose(a != null ? 0f : move, held);
            if (label != null) UpdateLabel();
        }

        void UpdateGround(Vector3 pos, bool held, float dt)
        {
            Vector3 origin = kind == Kind.Pig ? pos : pos + Vector3.up * 0.3f;
            float probe = kind == Kind.Pig ? 0.62f : kind == Kind.Farmer ? 0.45f : 0.6f;
            bool wasGrounded = grounded;
            grounded = !held && Physics.Raycast(origin, Vector3.down, probe, ~0, QueryTriggerInteraction.Ignore);
            if (grounded)
            {
                lastGroundedTime = Time.time;
                jumpLatched = false;
                if (!wasGrounded && airTime > 0.25f && minAirVy < -4f) Landed(pos);
                airTime = 0f;
                minAirVy = 0f;
            }
            else
            {
                airTime += dt;
                minAirVy = Mathf.Min(minAirVy, velocity.y);
                // Just left the ground going up fast = a jump (own jump, fart, bounce...).
                if (!jumpLatched && !held && velocity.y > 2.5f && Time.time - lastGroundedTime < 0.2f)
                {
                    jumpLatched = true;
                    squashVel += 3.5f;
                    if (kind == Kind.Pig) Sfx.Play(Sound.Jump, pos, 0.35f, 0.15f);
                }
            }
        }

        void Landed(Vector3 pos)
        {
            float impact = -minAirVy;
            squash = Mathf.Min(squash, -Mathf.Clamp(impact * 0.025f, 0.05f, 0.3f));
            if (impact > 6f) Sfx.Play(Sound.Land, pos, Mathf.Clamp01(impact / 16f) * 0.6f, 0.15f); // only real thumps
            if (impact > 9f) SmokeCloud.Spawn(pos + Vector3.down * (kind == Kind.Pig ? 0.4f : 0f), 0.45f, 0.6f, SmokeCloud.DustColor);
        }

        void UpdateSquash(float dt)
        {
            // Little spring: + = stretched tall, - = squashed flat.
            squashVel += (-220f * squash - 14f * squashVel) * dt;
            squash = Mathf.Clamp(squash + squashVel * dt, -0.35f, 0.35f);
        }

        void Pose(float move, bool held)
        {
            float t = Time.time;
            float bob = grounded ? Mathf.Abs(Mathf.Sin(cycle)) * bobHeight * move : 0f;
            float roll = grounded ? Mathf.Sin(cycle) * swayAngle * move : 0f;
            float yaw = Dizzy ? Mathf.Sin(t * 9f) * 20f : 0f;
            visual.localPosition = visualPos + Vector3.up * bob;
            visual.localRotation = visualRot * Quaternion.Euler(0f, yaw, roll);
            float side = 1f - squash * 0.5f;
            visual.localScale = Vector3.Scale(visualScale, new Vector3(side, 1f + squash, side));

            for (int i = 0; i < legs.Length; i++)
            {
                var limb = legs[i];
                float angle;
                if (held) angle = Mathf.Sin(t * 25f + limb.Phase) * 40f; // flailing
                else if (!grounded) angle = (limb.Pos.z >= 0f ? -25f : 25f) * (kind == Kind.Pig ? 1f : 0.5f);
                else angle = Mathf.Sin(cycle + limb.Phase) * limbSwing * move;
                if (limb.Slide)
                {
                    float slide = grounded ? Mathf.Sin(cycle + limb.Phase) * 0.18f * move : 0f;
                    limb.T.localPosition = limb.Pos + Vector3.forward * slide + Vector3.up * Mathf.Max(0f, Mathf.Cos(cycle + limb.Phase)) * 0.08f * move;
                }
                else Swing(limb, angle);
            }
            for (int i = 0; i < arms.Length; i++)
            {
                var limb = arms[i];
                float angle = ArmsUp ? -165f
                    : Dizzy ? Mathf.Sin(t * 14f + limb.Phase) * 50f
                    : Mathf.Sin(cycle + limb.Phase) * limbSwing * 0.8f * move;
                Swing(limb, angle);
            }
            if (tail != null)
                tail.localPosition = tailPos + new Vector3(Mathf.Sin(t * 14f), Mathf.Cos(t * 14f), 0f) * (0.03f + 0.03f * move);
        }

        /// <summary>Rotate a limb around its top end (primitives are 2 units tall: top = centre + up * scale.y).</summary>
        static void Swing(Limb limb, float angle)
        {
            Vector3 top = limb.Pos + limb.Rot * Vector3.up * limb.HalfHeight;
            Quaternion rot = Quaternion.AngleAxis(angle, Vector3.right) * limb.Rot;
            limb.T.localRotation = rot;
            limb.T.localPosition = top - rot * Vector3.up * limb.HalfHeight;
        }

        // ---------- pig label ----------

        void BuildLabel()
        {
            label = GameFonts.CreateTextMesh(transform, "Label", 0.045f, Color.white);
            label.transform.localPosition = Vector3.up * 1.25f;
        }

        void UpdateLabel()
        {
            string text = "";
            Color color = Color.white;
            NetPlayer owner = null;
            foreach (var p in NetPlayer.All)
                if (p != null && p.Pig == pig) { owner = p; break; }
            if (pigNet != null && pigNet.IsSpawned && pigNet.IsEscaped)
            {
                text = "FREE!";
                color = new Color(0.45f, 1f, 0.45f);
            }
            else if (owner == null)
            {
                int dots = (int)(Time.time * 2f) % 3;
                text = dots == 0 ? "z" : dots == 1 ? "zZ" : "zZz";
                color = new Color(0.7f, 0.85f, 1f);
            }
            else if (!owner.IsOwner) text = $"P{owner.OwnerClientId + 1}";
            label.text = text;
            label.color = color;
            if (text == "") return;
            label.transform.position = transform.position + Vector3.up * 1.25f;
            var cam = Camera.main;
            if (cam != null) label.transform.rotation = Quaternion.LookRotation(label.transform.position - cam.transform.position);
        }
    }
}
