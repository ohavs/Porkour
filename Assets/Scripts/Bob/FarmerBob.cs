using System;
using Unity.Netcode;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.InputSystem;

namespace Porkour
{
    public enum BobState : byte { Away, Coming, Searching, Investigating, Chasing, Carrying, Stunned, Leaving }

    /// <summary>
    /// Farmer Bob and the Grill Call cycle (server runs the AI on a runtime-baked NavMesh; clients just see
    /// NetworkTransform + the synced state for HUD/indicators).
    /// Away (at the grill in the yard) → every 2-3 min: Coming (bell, 5 s to hide) → Searching the barn.
    /// He spots pigs in his view cone with line of sight - not pigs hidden in hay (HideSpot), in fart smoke,
    /// or frozen (standing still) unless very close; smoke also blinds and slows him. Spotted → Chasing →
    /// grab → Carrying to the grill: others have 20 s to rescue by hitting him hard (thrown things, flying pigs,
    /// Heavy's slam, Armed's shots → Stunned 3 s, pig dropped) or throwing a chicken (Bait) at him.
    /// Too late → the pig is grilled (respawns at the start). A bell shot rings → he goes to check (lure).
    /// Host debug: G = Grill Call now.
    /// </summary>
    [RequireComponent(typeof(NavMeshAgent), typeof(Rigidbody))]
    public class FarmerBob : NetworkBehaviour, IPigCarrier
    {
        public static FarmerBob Instance { get; private set; }
        /// <summary>Messages for every PC's HUD ("the Jumpy pig got grilled!").</summary>
        public static event Action<string> Announced;

        [Header("Grill Call timing (seconds)")]
        public float firstCallDelay = 30f;
        public Vector2 callInterval = new(120f, 180f);
        public float warningTime = 5f;
        public float searchTime = 25f;
        public float rescueTime = 20f;
        public float stunTime = 3f;

        [Header("Places (set by the builder)")]
        public Vector3 doorPosition = new(0f, 0f, -15.5f);
        [Tooltip("Direction from the door to the yard (outside).")]
        public Vector3 doorOutward = Vector3.back;
        [Tooltip("Where Bob walks to when he comes in.")]
        public Vector3 insidePoint = new(0f, 0f, -12f);
        public Vector3 searchCenter = Vector3.zero;
        public Vector2 searchHalfSize = new(13f, 13f);
        public int doorChannel = 99;
        public Transform carryPoint;

        [Header("Movement")]
        public float walkSpeed = 3.2f;
        public float chaseSpeed = 5.2f;
        public float carrySpeed = 2.6f;
        [Tooltip("Speed multiplier inside fart smoke.")]
        public float smokeSlow = 0.4f;

        [Header("Senses")]
        public float sightRange = 14f;
        public float sightHalfAngle = 70f;
        [Tooltip("Pigs standing still this long count as 'frozen'...")]
        public float freezeTime = 1f;
        [Tooltip("...and are only noticed this close.")]
        public float frozenSpotRange = 3f;
        public float grabRange = 1.5f;
        [Tooltip("Hit speed that stuns Bob (flying pigs need a bit more).")]
        public float stunHitSpeed = 7f;

        readonly NetworkVariable<BobState> state = new();
        readonly NetworkVariable<double> stateEnd = new();
        readonly NetworkVariable<double> nextCall = new();
        readonly NetworkVariable<ulong> carriedId = new(ulong.MaxValue);
        readonly NetworkVariable<ulong> targetId = new(ulong.MaxValue);
        readonly NetworkVariable<int> grilled = new();

        public BobState State => state.Value;
        /// <summary>Seconds left in the current phase (HIDE countdown, rescue time...). 0 if untimed.</summary>
        public float StateTimeLeft => IsSpawned && stateEnd.Value > 0.0
            ? Mathf.Max(0f, (float)(stateEnd.Value - NetworkManager.ServerTime.Time)) : 0f;
        public float NextCallIn => IsSpawned ? Mathf.Max(0f, (float)(nextCall.Value - NetworkManager.ServerTime.Time)) : 0f;
        public ulong CarriedPigId => carriedId.Value;
        public ulong TargetPigId => targetId.Value;
        public int GrilledCount => grilled.Value;
        public int EscapePresses => int.MaxValue; // no wriggling out - friends must rescue you

        NavMeshAgent agent;
        Collider[] ownColliders;
        Vector3 home, wanderPoint, noisePos, lastSeenPos, lastDestination;
        PigController carried, target;
        Bait carriedBait;
        Collider[] carriedColliders;
        bool hasWanderPoint;
        float stateStart, stateUntil, searchEnd, wanderUntil, investigateUntil, lastSeenTime;
        float nextLook, nextRepath, nextCallTime;

        // Indicators (every PC)
        Transform stars;
        TextMesh mark;
        Material indicatorMaterial;

        Vector3 Eyes => transform.position + Vector3.up * 1.7f;
        Vector3 CarryPosition => carryPoint != null ? carryPoint.position : transform.TransformPoint(new Vector3(0.3f, 2f, -0.1f));

        void Awake()
        {
            agent = GetComponent<NavMeshAgent>();
            ownColliders = GetComponentsInChildren<Collider>();
            agent.enabled = false; // server switches it on; clients follow the NetworkTransform
            BuildIndicators();
        }

        public override void OnNetworkSpawn()
        {
            Instance = this;
            if (!IsServer) return;
            home = transform.position;
            agent.enabled = true;
            if (!agent.Warp(home)) Debug.LogWarning("Porkour: Farmer Bob is not on the NavMesh - he can't walk.");
            nextCallTime = Time.time + firstCallDelay;
            nextCall.Value = NetworkManager.ServerTime.Time + firstCallDelay;
            SetState(BobState.Away, 0f);
        }

        public override void OnNetworkDespawn()
        {
            if (Instance == this) Instance = null;
            if (!IsServer) return;
            ReleaseCarried();
            PuzzleSignals.Set(doorChannel, this, false);
        }

        public override void OnDestroy()
        {
            if (indicatorMaterial != null) Destroy(indicatorMaterial);
            base.OnDestroy();
        }

        void Update()
        {
            UpdateIndicators();
            if (!IsServer || !IsSpawned) return;
            if (state.Value == BobState.Away && Keyboard.current != null && Keyboard.current.gKey.wasPressedThisFrame)
                StartGrillCall(); // host debug key
            Think();
            UpdateDoor();
        }

        // ---------- brain (server) ----------

        void Think()
        {
            float now = Time.time;
            float slow = SmokeCloud.InSmoke(Eyes) || SmokeCloud.InSmoke(transform.position + Vector3.up * 0.5f) ? smokeSlow : 1f;
            switch (state.Value)
            {
                case BobState.Away:
                    Stop();
                    if (now >= nextCallTime) StartGrillCall();
                    break;

                case BobState.Coming:
                    if (now < stateStart + 2f) Stop(); // ringing the bell by the grill
                    else MoveTo(insidePoint, walkSpeed * slow);
                    if (Arrived(insidePoint, 1f) || now > stateStart + warningTime + 10f) BeginSearch(searchTime);
                    break;

                case BobState.Searching:
                    if (TrySpot()) break;
                    if (now >= searchEnd) { SetState(BobState.Leaving, 0f); break; }
                    if (!hasWanderPoint || Arrived(wanderPoint, 1.2f) || now > wanderUntil) PickWanderPoint();
                    MoveTo(wanderPoint, walkSpeed * slow);
                    break;

                case BobState.Investigating:
                    if (TrySpot()) break;
                    MoveTo(noisePos, chaseSpeed * slow);
                    if (investigateUntil <= 0f && Arrived(noisePos, 2f)) investigateUntil = now + 3f; // look around
                    if ((investigateUntil > 0f && now > investigateUntil) || now > stateStart + 12f)
                        BeginSearch(Mathf.Max(8f, searchEnd - now));
                    break;

                case BobState.Chasing:
                    Chase(slow);
                    break;

                case BobState.Carrying:
                    if (carried == null) // got away (e.g. farted out)
                    {
                        Announce("The pig got away from Bob!");
                        BeginSearch(12f);
                        break;
                    }
                    MoveTo(home, carrySpeed * slow);
                    if (now >= stateUntil) Grill();
                    break;

                case BobState.Stunned:
                    Stop();
                    if (now >= stateUntil) BeginSearch(15f);
                    break;

                case BobState.Leaving:
                    MoveTo(home, walkSpeed * slow);
                    if (Arrived(home, 0.8f)) GoAway();
                    break;
            }
        }

        void StartGrillCall()
        {
            SetState(BobState.Coming, warningTime);
            Announce("GRILL CALL! Bob is coming - hide!");
        }

        void BeginSearch(float duration)
        {
            target = null;
            targetId.Value = ulong.MaxValue;
            searchEnd = Time.time + duration;
            hasWanderPoint = false;
            SetState(BobState.Searching, duration);
        }

        void GoAway()
        {
            if (carriedBait != null)
            {
                IgnoreCollisions(carriedBait.GetComponentsInChildren<Collider>(), false);
                carriedBait.ReturnHome();
                carriedBait = null;
            }
            target = null;
            targetId.Value = ulong.MaxValue;
            float wait = UnityEngine.Random.Range(callInterval.x, callInterval.y);
            nextCallTime = Time.time + wait;
            nextCall.Value = NetworkManager.ServerTime.Time + wait;
            SetState(BobState.Away, 0f);
        }

        void SetState(BobState newState, float duration)
        {
            state.Value = newState;
            stateStart = Time.time;
            stateUntil = Time.time + duration;
            stateEnd.Value = duration > 0f ? NetworkManager.ServerTime.Time + duration : 0.0;
            investigateUntil = 0f;
        }

        /// <summary>Server: a loud noise (bell). Bob goes to check it unless he's busy with a pig.</summary>
        public void HearNoise(Vector3 position)
        {
            if (!IsServer) return;
            var s = state.Value;
            if (s != BobState.Searching && s != BobState.Investigating && s != BobState.Chasing) return;
            noisePos = NavMesh.SamplePosition(position, out NavMeshHit hit, 5f, NavMesh.AllAreas) ? hit.position : position;
            target = null;
            targetId.Value = ulong.MaxValue;
            SetState(BobState.Investigating, 0f);
            Announce("Bob heard something...");
        }

        // ---------- moving ----------

        void MoveTo(Vector3 point, float speed)
        {
            if (!agent.isOnNavMesh) return;
            agent.speed = speed;
            agent.isStopped = false;
            if ((point - lastDestination).sqrMagnitude > 0.25f || Time.time > nextRepath)
            {
                agent.SetDestination(point);
                lastDestination = point;
                nextRepath = Time.time + 0.5f;
            }
        }

        void Stop()
        {
            if (agent.isOnNavMesh) agent.isStopped = true;
        }

        bool Arrived(Vector3 point, float radius)
        {
            Vector3 d = point - transform.position;
            d.y = 0f;
            return d.magnitude <= radius;
        }

        void PickWanderPoint()
        {
            hasWanderPoint = true;
            if (agent.isOnNavMesh)
            {
                var path = new NavMeshPath();
                for (int i = 0; i < 8; i++)
                {
                    Vector3 p = searchCenter + new Vector3(UnityEngine.Random.Range(-searchHalfSize.x, searchHalfSize.x), 0f,
                        UnityEngine.Random.Range(-searchHalfSize.y, searchHalfSize.y));
                    if (!NavMesh.SamplePosition(p, out NavMeshHit hit, 2f, NavMesh.AllAreas)) continue;
                    if (!agent.CalculatePath(hit.position, path) || path.status != NavMeshPathStatus.PathComplete) continue;
                    wanderPoint = hit.position;
                    wanderUntil = Time.time + 8f;
                    return;
                }
            }
            wanderPoint = insidePoint;
            wanderUntil = Time.time + 4f;
        }

        // ---------- eyes ----------

        bool TrySpot()
        {
            if (Time.time < nextLook) return false;
            nextLook = Time.time + 0.15f;
            if (SmokeCloud.InSmoke(Eyes)) return false; // blinded
            PigController best = null;
            float bestDist = float.MaxValue;
            foreach (var pig in PigController.All)
            {
                if (!CanSee(pig)) continue;
                float d = (pig.Body.position - transform.position).sqrMagnitude;
                if (d < bestDist) { bestDist = d; best = pig; }
            }
            if (best == null) return false;
            target = best;
            targetId.Value = best.GetComponent<NetworkObject>().NetworkObjectId;
            lastSeenTime = Time.time;
            lastSeenPos = best.Body.position;
            SetState(BobState.Chasing, 0f);
            return true;
        }

        bool CanSee(PigController pig)
        {
            if (pig == null || pig.IsHeld) return false;
            Vector3 eyes = Eyes;
            Vector3 p = pig.Body.position;
            Vector3 to = p - eyes;
            float dist = to.magnitude;
            if (dist > sightRange) return false;
            if (HideSpot.IsHidden(p) || SmokeCloud.InSmoke(p)) return false;
            if (pig.StillTime >= freezeTime && dist > frozenSpotRange) return false; // "just a pig statue"
            if (dist > 2.5f && Vector3.Angle(transform.forward, new Vector3(to.x, 0f, to.z)) > sightHalfAngle) return false;
            // Line of sight: the first thing between the eyes and the pig must be the pig itself.
            return !Physics.Linecast(eyes, p, out RaycastHit hit, ~0, QueryTriggerInteraction.Ignore) || hit.rigidbody == pig.Body;
        }

        void Chase(float slow)
        {
            if (target == null) { BeginSearch(Mathf.Max(8f, searchEnd - Time.time)); return; }
            if (Time.time >= nextLook)
            {
                nextLook = Time.time + 0.15f;
                if (!SmokeCloud.InSmoke(Eyes) && CanSee(target))
                {
                    lastSeenTime = Time.time;
                    lastSeenPos = target.Body.position;
                }
            }
            if (Time.time - lastSeenTime > 2.5f) // lost it: check where it was last seen
            {
                noisePos = lastSeenPos;
                target = null;
                targetId.Value = ulong.MaxValue;
                SetState(BobState.Investigating, 0f);
                return;
            }
            MoveTo(lastSeenPos, chaseSpeed * slow);

            Vector3 d = target.Body.position - transform.position;
            float dy = d.y;
            d.y = 0f;
            if (!target.IsHeld && d.magnitude <= grabRange && dy > -0.5f && dy < 1.8f && !HideSpot.IsHidden(target.Body.position))
                GrabPig(target);
        }

        // ---------- carrying ----------

        void GrabPig(PigController pig)
        {
            carried = pig;
            carriedId.Value = pig.GetComponent<NetworkObject>().NetworkObjectId;
            target = null;
            targetId.Value = ulong.MaxValue;
            carriedColliders = pig.GetComponentsInChildren<Collider>();
            IgnoreCollisions(carriedColliders, true);
            pig.SetHeldBy(this);
            SetState(BobState.Carrying, rescueTime);
            Announce($"Bob caught the {PigTypes.Info(pig.Type).Name} pig! Hit Bob or throw a chicken at him!");
        }

        public void Drop()
        {
            if (carried == null) return;
            var pig = ReleaseCarried();
            if (IsSpawned) carriedId.Value = ulong.MaxValue;
            pig.Body.linearVelocity = transform.forward * 2f + Vector3.up * 4f; // tossed free
        }

        /// <summary>Let go of the pig without touching network state (also used while despawning).</summary>
        PigController ReleaseCarried()
        {
            var pig = carried;
            if (pig == null) return null;
            IgnoreCollisions(carriedColliders, false);
            carried = null;
            carriedColliders = null;
            pig.SetHeldBy(null);
            return pig;
        }

        void Grill()
        {
            var pig = carried;
            if (pig == null) { BeginSearch(10f); return; }
            string name = PigTypes.Info(pig.Type).Name;
            pig.Respawn(); // lets go through Drop(), then back to its start
            grilled.Value++;
            GrillFxRpc(home + Vector3.back * 2f);
            Announce($"The {name} pig got grilled! (it's back at the start)");
            SetState(BobState.Leaving, 0f);
        }

        void FixedUpdate()
        {
            if (!IsServer || !IsSpawned) return;
            Rigidbody load = carried != null ? carried.Body : carriedBait != null ? carriedBait.Body : null;
            if (load == null) return;
            Vector3 to = CarryPosition - load.position;
            if (to.magnitude > 3f) // snagged on something: snap back onto the shoulder
            {
                load.position = CarryPosition;
                load.linearVelocity = Vector3.zero;
                return;
            }
            load.linearVelocity = Vector3.ClampMagnitude(to * 15f, 12f) + agent.velocity;
            load.angularVelocity = Vector3.zero;
            load.MoveRotation(Quaternion.Slerp(load.rotation, transform.rotation * Quaternion.Euler(0f, 90f, 0f), 0.2f));
        }

        void IgnoreCollisions(Collider[] others, bool ignore)
        {
            if (others == null) return;
            foreach (var mine in ownColliders)
            foreach (var other in others)
                if (mine != null && other != null) Physics.IgnoreCollision(mine, other, ignore);
        }

        // ---------- getting hit ----------

        void OnCollisionEnter(Collision collision)
        {
            if (!IsServer || !IsSpawned) return;
            var rb = collision.rigidbody;
            if (rb == null || rb.isKinematic) return;
            if (carried != null && rb == carried.Body) return;
            if (carriedBait != null && rb == carriedBait.Body) return;
            float speed = collision.relativeVelocity.magnitude;

            if (rb.TryGetComponent(out Bait bait))
            {
                if (speed > 2f) TakeBait(bait);
                return;
            }
            if (rb.TryGetComponent(out PigController pig))
            {
                // Walking into Bob does nothing - only flying pigs (thrown / launched) or a Heavy belly slam.
                if (pig.IsGrounded && !pig.MovementLocked) return;
                if (speed < stunHitSpeed + 1f) return;
            }
            else if (speed < stunHitSpeed) return;
            Stun();
        }

        bool Busy => state.Value is BobState.Coming or BobState.Searching or BobState.Investigating
            or BobState.Chasing or BobState.Carrying;

        void Stun()
        {
            if (!Busy) return;
            string freed = carried != null ? PigTypes.Info(carried.Type).Name : null;
            Drop();
            target = null;
            targetId.Value = ulong.MaxValue;
            SetState(BobState.Stunned, stunTime);
            Stop();
            Announce(freed != null ? $"Bob is stunned - the {freed} pig is free!" : "Bob is stunned!");
        }

        void TakeBait(Bait bait)
        {
            if (!Busy) return;
            bool savedPig = carried != null;
            Drop();
            foreach (var pig in PigController.All) // someone still holding it? let go
                if (pig.Grabber != null && pig.Grabber.Held == bait.Body) pig.Grabber.Drop();
            carriedBait = bait;
            bait.Body.useGravity = false;
            IgnoreCollisions(bait.GetComponentsInChildren<Collider>(), true);
            target = null;
            targetId.Value = ulong.MaxValue;
            SetState(BobState.Leaving, 0f);
            Announce(savedPig ? $"Bob took the {bait.displayName} instead - pig saved!" : $"Bob took the {bait.displayName} and left!");
        }

        // ---------- barn door ----------

        void UpdateDoor()
        {
            bool open = state.Value != BobState.Away && Arrived(doorPosition, 4.5f);
            if (!open) // pigs stuck outside may always come back in (it never opens for pigs inside)
                foreach (var pig in PigController.All)
                {
                    Vector3 rel = pig.Body.position - doorPosition;
                    if (Vector3.Dot(rel, doorOutward) > 0.5f && new Vector3(rel.x, 0f, rel.z).magnitude < 3.5f) { open = true; break; }
                }
            PuzzleSignals.Set(doorChannel, this, open);
        }

        // ---------- messages & visuals ----------

        void Announce(string text) => AnnounceRpc(text);

        [Rpc(SendTo.Everyone)]
        void AnnounceRpc(string text) => Announced?.Invoke(text);

        [Rpc(SendTo.Everyone)]
        void GrillFxRpc(Vector3 position)
        {
            for (int i = 0; i < 6; i++)
                SmokeCloud.Spawn(position + UnityEngine.Random.insideUnitSphere * 0.5f + Vector3.up * (0.8f + i * 0.3f),
                    0.5f, 2.5f, new Color(0.25f, 0.25f, 0.25f, 0.6f));
        }

        void BuildIndicators()
        {
            indicatorMaterial = FxUtil.NewMaterial(new Color(1f, 0.9f, 0.2f), transparent: false);
            stars = new GameObject("DizzyStars").transform;
            stars.SetParent(transform, false);
            stars.localPosition = Vector3.up * 2.3f;
            for (int i = 0; i < 4; i++)
            {
                var star = FxUtil.NewMeshObject("Star", PrimitiveType.Sphere, stars, indicatorMaterial).transform;
                star.localPosition = Quaternion.Euler(0f, i * 90f, 0f) * Vector3.forward * 0.4f;
                star.localScale = Vector3.one * 0.12f;
            }
            stars.gameObject.SetActive(false);

            var font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            if (font == null) return;
            var go = new GameObject("Mark");
            go.transform.SetParent(transform, false);
            go.transform.localPosition = Vector3.up * 2.6f;
            go.AddComponent<MeshRenderer>().sharedMaterial = font.material;
            mark = go.AddComponent<TextMesh>();
            mark.font = font;
            mark.fontSize = 96;
            mark.characterSize = 0.06f;
            mark.fontStyle = FontStyle.Bold;
            mark.anchor = TextAnchor.MiddleCenter;
            mark.alignment = TextAlignment.Center;
        }

        void UpdateIndicators()
        {
            var s = IsSpawned ? state.Value : BobState.Away;
            bool dizzy = s == BobState.Stunned;
            if (stars.gameObject.activeSelf != dizzy) stars.gameObject.SetActive(dizzy);
            if (dizzy) stars.Rotate(0f, 360f * Time.deltaTime, 0f, Space.Self);
            if (mark == null) return;
            mark.text = s == BobState.Chasing ? "!" : s == BobState.Investigating ? "?" : "";
            mark.color = s == BobState.Chasing ? new Color(1f, 0.2f, 0.1f) : new Color(1f, 0.9f, 0.2f);
            var cam = Camera.main;
            if (cam != null && mark.text != "") mark.transform.rotation = Quaternion.LookRotation(mark.transform.position - cam.transform.position);
        }
    }
}
