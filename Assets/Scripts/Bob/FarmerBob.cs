using System;
using System.Collections.Generic;
using Unity.Netcode;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.InputSystem;

namespace Porkour
{
    public enum BobState : byte { Away, Coming, Searching, Investigating, Chasing, Carrying, Stunned, Leaving }

    /// <summary>
    /// Farmer Bob and the Grill Call cycle (server runs the AI on a runtime-baked NavMesh; clients just see
    /// NetworkTransform + the synced state for HUD/indicators/sounds).
    /// Away (at the grill in the yard) → every ~2 min: Coming (dinner bell, 5 s to hide) → Searching the barn.
    /// He spots pigs in his view cone with line of sight - not pigs hidden in hay (HideSpot), in fart smoke,
    /// under a bucket (standing still), or frozen (standing still) unless very close; smoke also blinds and slows him.
    /// He ignores sleeping pigs (nobody plays them) and escaped ones. Spotted → Chasing → grab → Carrying to his BBQ:
    /// on the way others can save the pig by hitting him hard (thrown things, flying pigs, Heavy's slam, Armed's shots →
    /// Stunned 3 s, pig dropped) or throwing a chicken/calf (Bait) at him. At the BBQ he locks it in his cage (PigCage):
    /// 2 minutes until the grill is hot, then he throws it on (grilled - RoundManager counts it). While he's at the BBQ he
    /// tends the grill and glances around - rescuers must sneak up (or distract / stun him).
    /// A pig he can't reach (loft, beams, crates) gets corn thrown at it until it falls or he gives up.
    /// Last minute of the round: final hunt - he searches non-stop. A rung bell lures him.
    /// Only acts while the round is being played. Host debug: G = Grill Call now.
    /// </summary>
    [RequireComponent(typeof(NavMeshAgent), typeof(Rigidbody))]
    public class FarmerBob : NetworkBehaviour, IPigCarrier
    {
        public static FarmerBob Instance { get; private set; }

        [Header("Grill Call timing (seconds)")]
        public float firstCallDelay = 45f;
        public Vector2 callInterval = new(95f, 135f);
        public float warningTime = 5f;
        public float searchTime = 40f;
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
        [Tooltip("Second area he also searches when he can get there (the farmyard once the exit is open). Zero size = none.")]
        public Vector3 searchCenter2;
        public Vector2 searchHalfSize2;
        public int doorChannel = ChannelIds.BobDoor;
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
        public float grabRange = 1.7f;
        [Tooltip("Hit speed that stuns Bob (flying pigs need a bit more).")]
        public float stunHitSpeed = 7f;

        [Header("Throwing (pigs out of reach)")]
        public float throwSpeed = 14f;
        public float throwInterval = 1.5f;
        public int throwsBeforeGivingUp = 3;

        readonly NetworkVariable<BobState> state = new();
        readonly NetworkVariable<double> stateEnd = new();
        readonly NetworkVariable<double> nextCall = new();
        readonly NetworkVariable<ulong> carriedId = new(ulong.MaxValue);
        readonly NetworkVariable<ulong> targetId = new(ulong.MaxValue);
        readonly NetworkVariable<int> grilled = new();
        readonly NetworkVariable<bool> finalHunt = new();

        public BobState State => state.Value;
        /// <summary>Seconds left in the current phase (HIDE countdown, rescue time...). 0 if untimed.</summary>
        public float StateTimeLeft => IsSpawned && stateEnd.Value > 0.0
            ? Mathf.Max(0f, (float)(stateEnd.Value - NetworkManager.ServerTime.Time)) : 0f;
        public float NextCallIn => IsSpawned ? Mathf.Max(0f, (float)(nextCall.Value - NetworkManager.ServerTime.Time)) : 0f;
        public ulong CarriedPigId => carriedId.Value;
        public ulong TargetPigId => targetId.Value;
        public int GrilledCount => grilled.Value;
        public bool FinalHunt => finalHunt.Value;
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
        float unreachableTime, nextThrow;
        float glanceAt, glanceUntil;
        int throwsAtTarget;
        readonly Dictionary<PigController, float> ignoreUntil = new();

        // Indicators (every PC)
        Transform stars;
        TextMesh mark;
        Material indicatorMaterial;
        ProceduralAnimator anim;
        string speech;
        float speechUntil;

        Vector3 Eyes => transform.position + Vector3.up * 2.1f;
        Vector3 CarryPosition => carryPoint != null ? carryPoint.position : transform.TransformPoint(new Vector3(0.3f, 2.55f, -0.1f));
        static bool RoundActive => RoundManager.Instance == null || RoundManager.Instance.IsPlaying;
        /// <summary>Server: a caged pig's grill time is up - Bob drops what he's doing and goes back to his grill.</summary>
        static bool GrillDue => PigCage.Instance != null && PigCage.Instance.Overdue() != null;

        void Awake()
        {
            agent = GetComponent<NavMeshAgent>();
            ownColliders = GetComponentsInChildren<Collider>();
            anim = GetComponent<ProceduralAnimator>();
            agent.enabled = false; // server switches it on; clients follow the NetworkTransform
            BuildIndicators();
        }

        public override void OnNetworkSpawn()
        {
            Instance = this;
            state.OnValueChanged += OnStateChanged;
            targetId.OnValueChanged += OnTargetChanged;
            if (!IsServer) return;
            home = transform.position;
            agent.enabled = true;
            if (!agent.Warp(home)) Debug.LogWarning("Porkour: Farmer Bob is not on the NavMesh - he can't walk.");
            ResetCallTimer();
            SetState(BobState.Away, 0f);
        }

        public override void OnNetworkDespawn()
        {
            if (Instance == this) Instance = null;
            state.OnValueChanged -= OnStateChanged;
            targetId.OnValueChanged -= OnTargetChanged;
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
            if (!RoundActive) { Stop(); return; } // intro / round over: wait at the grill (or freeze)
            if (state.Value == BobState.Away && Keyboard.current != null && Keyboard.current.gKey.wasPressedThisFrame)
                StartGrillCall(); // host debug key
            Think();
            UpdateDoor();
        }

        /// <summary>Server: the round starts - first Grill Call after firstCallDelay.</summary>
        public void ResetCallTimer()
        {
            if (!IsServer) return;
            nextCallTime = Time.time + firstCallDelay;
            nextCall.Value = NetworkManager.ServerTime.Time + firstCallDelay;
        }

        /// <summary>Server: last minute of the round - Bob comes in and searches until the end.</summary>
        public void StartFinalHunt()
        {
            if (!IsServer || finalHunt.Value) return;
            finalHunt.Value = true;
            Say("No more hiding, piggies!");
            if (state.Value == BobState.Away) StartGrillCall();
            else if (state.Value == BobState.Searching) BeginSearch(0f);
        }

        // ---------- brain (server) ----------

        void Think()
        {
            float now = Time.time;
            float slow = SmokeCloud.InSmoke(Eyes) || SmokeCloud.InSmoke(transform.position + Vector3.up * 0.5f) ? smokeSlow : 1f;
            switch (state.Value)
            {
                case BobState.Away:
                    if (TendGrill()) break;
                    if (now >= nextCallTime && (PigCage.Instance == null || PigCage.Instance.Overdue() == null)) StartGrillCall();
                    break;

                case BobState.Coming:
                    if (GrillDue) { GoGrill(); break; }
                    if (now < stateStart + 2f) Stop(); // ringing the bell by the grill
                    else MoveTo(insidePoint, walkSpeed * slow);
                    if (Arrived(insidePoint, 1f) || now > stateStart + warningTime + 10f) BeginSearch(searchTime);
                    break;

                case BobState.Searching:
                    if (TrySpot()) break;
                    if (now >= searchEnd) { SetState(BobState.Leaving, 0f); break; }
                    if (GrillDue) { GoGrill(); break; }
                    if (!hasWanderPoint || Arrived(wanderPoint, 1.2f) || now > wanderUntil) PickWanderPoint();
                    MoveTo(wanderPoint, walkSpeed * slow * (finalHunt.Value ? 1.15f : 1f));
                    break;

                case BobState.Investigating:
                    if (GrillDue) { GoGrill(); break; }
                    if (TrySpot()) break;
                    MoveTo(noisePos, chaseSpeed * slow);
                    if (investigateUntil <= 0f && Arrived(noisePos, 2f)) investigateUntil = now + 3f; // look around
                    if ((investigateUntil > 0f && now > investigateUntil) || now > stateStart + 12f)
                        BeginSearch(Mathf.Max(8f, searchEnd - now));
                    break;

                case BobState.Chasing:
                    if (GrillDue) { GoGrill(); break; }
                    Chase(slow);
                    break;

                case BobState.Carrying:
                    if (carried == null) // got away (e.g. farted out)
                    {
                        Announce("The pig got away from Bob!");
                        BeginSearch(12f);
                        break;
                    }
                    var cage = PigCage.Instance;
                    if (cage == null) // no cage in this level: straight onto the grill
                    {
                        MoveTo(home, carrySpeed * slow);
                        if (now >= stateUntil) GrillPig(ReleaseCarriedPig());
                        break;
                    }
                    MoveTo(cage.DoorPoint, carrySpeed * slow);
                    if (Arrived(cage.DoorPoint, 1.8f) || now > stateStart + 60f) CagePig(cage);
                    break;

                case BobState.Stunned:
                    Stop();
                    if (now >= stateUntil) BeginSearch(15f);
                    break;

                case BobState.Leaving:
                    bool due = GrillDue;
                    if (finalHunt.Value && carriedBait == null && !due) { BeginSearch(0f); break; }
                    MoveTo(home, walkSpeed * slow * (due ? 1.4f : 1f)); // hurrying back to a hot grill
                    if (Arrived(home, 0.8f)) GoAway();
                    break;
            }
        }

        void GoGrill()
        {
            ClearTarget();
            Say("Ooh, the grill's hot!");
            Announce("The grill is hot - Bob is going back to his BBQ!");
            SetState(BobState.Leaving, 0f);
        }

        void StartGrillCall()
        {
            SetState(BobState.Coming, warningTime);
            Announce(finalHunt.Value ? "FINAL HUNT! Bob is coming and won't stop!" : "GRILL CALL! Bob is coming - hide!");
            Say(finalHunt.Value ? "BBQ time is NOW!" : "Dinner time, piggies!");
        }

        void BeginSearch(float duration)
        {
            if (finalHunt.Value) duration = 9999f;
            ClearTarget();
            searchEnd = Time.time + duration;
            hasWanderPoint = false;
            SetState(BobState.Searching, finalHunt.Value ? 0f : duration);
        }

        void GoAway()
        {
            if (carriedBait != null)
            {
                IgnoreCollisions(carriedBait.GetComponentsInChildren<Collider>(), false);
                carriedBait.ReturnHome();
                carriedBait = null;
            }
            ClearTarget();
            if (Time.time >= nextCallTime - 1f) // back from a Grill Call (not just from the cage): next one later
            {
                float wait = finalHunt.Value ? 6f : UnityEngine.Random.Range(callInterval.x, callInterval.y);
                nextCallTime = Time.time + wait;
                nextCall.Value = NetworkManager.ServerTime.Time + wait;
            }
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

        void ClearTarget()
        {
            target = null;
            targetId.Value = ulong.MaxValue;
            unreachableTime = 0f;
            throwsAtTarget = 0;
        }

        /// <summary>Server: the pigs opened the big exit door - Bob comes running.</summary>
        public void Alarm(Vector3 position)
        {
            if (!IsServer) return;
            if (state.Value == BobState.Away || state.Value == BobState.Leaving)
            {
                SetState(BobState.Coming, 2f);
                Announce("Bob heard the big door! He's coming!");
                Say("WHAT WAS THAT?!");
            }
            else HearNoise(position);
        }

        /// <summary>Server: a loud noise (bell). Bob goes to check it unless he's busy with a pig.</summary>
        public void HearNoise(Vector3 position)
        {
            if (!IsServer) return;
            var s = state.Value;
            if (s != BobState.Searching && s != BobState.Investigating && s != BobState.Chasing) return;
            if (s == BobState.Investigating && (position - noisePos).sqrMagnitude < 25f && Time.time - stateStart < 4f) return; // already on it
            noisePos = NavMesh.SamplePosition(position, out NavMeshHit hit, 5f, NavMesh.AllAreas) ? hit.position : position;
            ClearTarget();
            SetState(BobState.Investigating, 0f);
            Announce("Bob heard something...");
            Say("Huh? What was that?");
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
                    bool second = searchHalfSize2.sqrMagnitude > 0f && UnityEngine.Random.value < 0.65f;
                    Vector3 c = second ? searchCenter2 : searchCenter;
                    Vector2 h = second ? searchHalfSize2 : searchHalfSize;
                    // The farm is big: half the time Bob "sniffs" his way to the area around a random pig (not right onto it).
                    if (i < 4 && UnityEngine.Random.value < 0.5f && RandomHuntablePig() is PigController near)
                    {
                        c = near.Body.position;
                        h = new Vector2(10f, 10f);
                    }
                    Vector3 p = c + new Vector3(UnityEngine.Random.Range(-h.x, h.x), 0f, UnityEngine.Random.Range(-h.y, h.y));
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
                if (pig == null) continue;
                float d = (pig.Body.position - transform.position).sqrMagnitude;
                if (ignoreUntil.TryGetValue(pig, out float until) && Time.time < until && d > 4f) continue; // gave up on it
                if (!CanSee(pig)) continue;
                if (d < bestDist) { bestDist = d; best = pig; }
            }
            if (best == null) return false;
            ClearTarget();
            target = best;
            targetId.Value = best.GetComponent<NetworkObject>().NetworkObjectId;
            lastSeenTime = Time.time;
            lastSeenPos = best.Body.position;
            SetState(BobState.Chasing, 0f);
            string[] lines = { "THERE you are!", "BACON!", "Come here, pork chop!", "Gotcha now!" };
            Say(lines[UnityEngine.Random.Range(0, lines.Length)]);
            return true;
        }

        /// <summary>Pigs Bob cares about: someone plays it, it's free, not escaped yet.</summary>
        static PigController RandomHuntablePig()
        {
            int count = 0;
            PigController pick = null;
            foreach (var pig in PigController.All)
                if (IsHuntable(pig) && UnityEngine.Random.Range(0, ++count) == 0) pick = pig;
            return pick;
        }

        static bool IsHuntable(PigController pig) => pig != null && pig.Owner != null && !pig.Escaped && !pig.IsHeld && pig.CagedIn == null;

        /// <summary>Hidden right now (hay, still under a bucket) - can't be seen or grabbed.</summary>
        static bool IsHidden(PigController pig)
        {
            if (HideSpot.IsHidden(pig.Body.position)) return true;
            var worn = pig.Worn;
            return worn != null && pig.StillTime >= worn.hideStillTime;
        }

        bool CanSee(PigController pig)
        {
            if (!IsHuntable(pig)) return false;
            Vector3 eyes = Eyes;
            Vector3 p = pig.Body.position;
            Vector3 to = p - eyes;
            float dist = to.magnitude;
            if (dist > sightRange) return false;
            if (IsHidden(pig) || SmokeCloud.InSmoke(p)) return false;
            var worn = pig.Worn;
            if (worn != null && dist > worn.movingSpotRange) return false; // "just a bucket"... "wait, it moved?"
            if (worn == null && pig.StillTime >= freezeTime && dist > frozenSpotRange) return false; // "just a pig statue"
            if (dist > 2.5f && Vector3.Angle(transform.forward, new Vector3(to.x, 0f, to.z)) > sightHalfAngle) return false;
            // Line of sight: the first thing between the eyes and the pig must be the pig (or what it carries / wears).
            if (!Physics.Linecast(eyes, p, out RaycastHit hit, ~0, QueryTriggerInteraction.Ignore)) return true;
            return hit.rigidbody != null && (hit.rigidbody == pig.Body || (pig.Grabber != null && hit.rigidbody == pig.Grabber.Held));
        }

        void Chase(float slow)
        {
            if (target == null || !IsHuntable(target)) { BeginSearch(Mathf.Max(8f, searchEnd - Time.time)); return; }
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
                ClearTarget();
                SetState(BobState.Investigating, 0f);
                Say("Where'd it go?");
                return;
            }

            Vector3 d = target.Body.position - transform.position;
            float dy = d.y;
            d.y = 0f;
            if (d.magnitude <= grabRange && dy > -0.5f && dy < 1.8f && !IsHidden(target))
            {
                GrabPig(target);
                return;
            }

            // Out of reach (loft, beams, crate stack)? Stand there and throw corn at it.
            bool tooHigh = d.magnitude <= 2.5f && dy >= 1.8f;
            bool pathEnds = agent.isOnNavMesh && !agent.pathPending && agent.hasPath
                            && agent.pathStatus != NavMeshPathStatus.PathComplete && agent.remainingDistance < 0.8f;
            unreachableTime = tooHigh || pathEnds ? unreachableTime + Time.deltaTime : 0f;
            if (unreachableTime < 0.8f)
            {
                MoveTo(lastSeenPos, chaseSpeed * slow * (finalHunt.Value ? 1.1f : 1f));
                return;
            }
            Stop();
            if (d.sqrMagnitude > 0.01f) transform.rotation = Quaternion.RotateTowards(transform.rotation, Quaternion.LookRotation(d), 360f * Time.deltaTime);
            if (Time.time < nextThrow) return;
            if (throwsAtTarget >= throwsBeforeGivingUp)
            {
                ignoreUntil[target] = Time.time + 10f;
                Say("Fine, stay up there!");
                BeginSearch(Mathf.Max(8f, searchEnd - Time.time));
                return;
            }
            ThrowCornAt(target);
            throwsAtTarget++;
            nextThrow = Time.time + throwInterval;
        }

        void ThrowCornAt(PigController pig)
        {
            var prefab = Ammo.PrefabFor(Ammo.Kind.Corn);
            if (prefab == null) return;
            Vector3 hand = transform.position + Vector3.up * 2.3f + transform.forward * 0.5f;
            Vector3 aim = pig.Body.position + pig.Body.linearVelocity * 0.25f + UnityEngine.Random.insideUnitSphere * 0.35f;
            Vector3 velocity = Ammo.BallisticVelocity(hand, aim, throwSpeed);
            var go = Instantiate(prefab, hand, Quaternion.LookRotation(velocity));
            go.GetComponent<NetworkObject>().Spawn();
            go.GetComponent<Ammo>().Fire(ownColliders, velocity, knockPigs: true);
            if (throwsAtTarget == 0) Say("Get down here!");
            ThrowFxRpc(hand);
        }

        // ---------- carrying ----------

        void GrabPig(PigController pig)
        {
            carried = pig;
            carriedId.Value = pig.GetComponent<NetworkObject>().NetworkObjectId;
            ClearTarget();
            carriedColliders = pig.GetComponentsInChildren<Collider>();
            IgnoreCollisions(carriedColliders, true);
            pig.SetHeldBy(this);
            SetState(BobState.Carrying, PigCage.Instance != null ? 0f : rescueTime);
            Announce($"Bob caught the {PigTypes.Info(pig.Type).Name} pig! Hit Bob or throw a chicken at him!");
            Say("Into the cage you go!");
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

        /// <summary>Let go of the carried pig (no toss) and clear the synced id.</summary>
        PigController ReleaseCarriedPig()
        {
            var pig = ReleaseCarried();
            carriedId.Value = ulong.MaxValue;
            return pig;
        }

        void CagePig(PigCage cage)
        {
            var pig = ReleaseCarriedPig();
            if (pig == null) { BeginSearch(10f); return; }
            if (!cage.Lock(pig)) { GrillPig(pig); return; } // cage full: straight onto the grill
            Say("You wait in there till the grill's hot!");
            SetState(BobState.Leaving, 0f);
        }

        /// <summary>The pig goes on the grill: back to the pen, and the round counts it.</summary>
        void GrillPig(PigController pig)
        {
            if (pig == null) { BeginSearch(10f); return; }
            string name = PigTypes.Info(pig.Type).Name;
            pig.Respawn(); // lets go of it (Bob / cage), then back to its start
            grilled.Value++;
            var cage = PigCage.Instance;
            GrillFxRpc(cage != null ? cage.GrillPoint : home + Vector3.back * 2f);
            Say("Mmm... BBQ!");
            if (RoundManager.Instance != null) RoundManager.Instance.OnPigGrilled(name);
            else Announce($"The {name} pig got grilled! (it's back at the start)");
            SetState(BobState.Leaving, 0f);
        }

        /// <summary>
        /// Away at the BBQ: grill an overdue caged pig, else stand by the grill with his back to the barn, glancing around
        /// now and then - a pig he sees (a rescuer) gets chased. True if he started doing something else.
        /// </summary>
        bool TendGrill()
        {
            var cage = PigCage.Instance;
            var due = cage != null ? cage.Overdue() : null;
            if (due != null)
            {
                MoveTo(cage.DoorPoint, walkSpeed);
                if (Arrived(cage.DoorPoint, 1.8f))
                {
                    Stop();
                    ThrowFxRpc(cage.GrillPoint);
                    GrillPig(due);
                    return true;
                }
                return false;
            }
            Stop();
            float now = Time.time;
            if (now > glanceAt) // look over his shoulder now and then
            {
                glanceAt = now + UnityEngine.Random.Range(8f, 12f);
                glanceUntil = now + 2.5f;
                if (cage != null && cage.Count > 0) Say(UnityEngine.Random.value < 0.5f ? "Hmm?" : "Anybody there?");
            }
            Vector3 look = (now < glanceUntil ? doorPosition : cage != null ? cage.GrillPoint : home + Vector3.back) - transform.position;
            look.y = 0f;
            if (look.sqrMagnitude > 0.04f)
                transform.rotation = Quaternion.RotateTowards(transform.rotation, Quaternion.LookRotation(look), 240f * Time.deltaTime);
            return TrySpot();
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
            if ((!Busy && state.Value != BobState.Away) || !RoundActive) return; // also while guarding his grill
            string freed = carried != null ? PigTypes.Info(carried.Type).Name : null;
            Drop();
            ClearTarget();
            SetState(BobState.Stunned, stunTime);
            Stop();
            Announce(freed != null ? $"Bob is stunned - the {freed} pig is free!" : "Bob is stunned!");
            Say("OW! My head!");
        }

        void TakeBait(Bait bait)
        {
            if (!Busy || !RoundActive) return;
            bool savedPig = carried != null;
            Drop();
            foreach (var pig in PigController.All) // someone still holding it? let go
                if (pig.Grabber != null && pig.Grabber.Held == bait.Body) pig.Grabber.Drop();
            carriedBait = bait;
            bait.Body.useGravity = false;
            IgnoreCollisions(bait.GetComponentsInChildren<Collider>(), true);
            ClearTarget();
            SetState(BobState.Leaving, 0f);
            Announce(savedPig ? $"Bob took the {bait.displayName} instead - pig saved!" : $"Bob took the {bait.displayName} and left!");
            Say($"Ooh, a {bait.displayName}! Even better!");
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

        // ---------- messages, sounds & visuals ----------

        void Announce(string text) => AnnounceRpc(text);

        /// <summary>Server: a speech line over Bob's head on every PC.</summary>
        public void Say(string text)
        {
            if (IsServer && IsSpawned) SayRpc(text);
        }

        [Rpc(SendTo.Everyone)]
        void AnnounceRpc(string text) => GameEvents.Announce(text);

        [Rpc(SendTo.Everyone)]
        void SayRpc(string text)
        {
            speech = text;
            speechUntil = Time.time + 2.5f;
        }

        [Rpc(SendTo.Everyone)]
        void ThrowFxRpc(Vector3 hand)
        {
            Sfx.Play(Sound.Throw, hand, 1f);
            if (anim != null) anim.Trigger("Throw");
        }

        [Rpc(SendTo.Everyone)]
        void GrillFxRpc(Vector3 position)
        {
            Sfx.Play(Sound.Sizzle, position, 1f, 0f);
            for (int i = 0; i < 6; i++)
                SmokeCloud.Spawn(position + UnityEngine.Random.insideUnitSphere * 0.5f + Vector3.up * (0.8f + i * 0.3f),
                    0.5f, 2.5f, new Color(0.25f, 0.25f, 0.25f, 0.6f));
        }

        void OnStateChanged(BobState previous, BobState current)
        {
            Vector3 p = transform.position + Vector3.up;
            switch (current)
            {
                case BobState.Coming:
                    Sfx.PlayUi(Sound.GrillCall, 0.8f);
                    break;
                case BobState.Carrying:
                    Sfx.PlayUi(Sound.Caught, 0.7f);
                    break;
                case BobState.Stunned:
                    Sfx.Play(Sound.Bonk, p, 1f);
                    Sfx.Play(Sound.Ding, p, 0.5f);
                    ThirdPersonCamera.Shake(p, 0.4f, 8f);
                    break;
            }
        }

        void OnTargetChanged(ulong previous, ulong current)
        {
            if (current == ulong.MaxValue) return;
            var me = NetPlayer.Local != null ? NetPlayer.Local.Pig : null;
            bool isMe = me != null && me.TryGetComponent(out NetworkObject obj) && obj.NetworkObjectId == current;
            if (isMe) Sfx.PlayUi(Sound.Spotted, 0.9f);
            else Sfx.Play(Sound.Spotted, transform.position + Vector3.up * 2f, 0.6f, 0f);
        }

        void BuildIndicators()
        {
            indicatorMaterial = FxUtil.NewMaterial(new Color(1f, 0.9f, 0.2f), transparent: false);
            stars = new GameObject("DizzyStars").transform;
            stars.SetParent(transform, false);
            stars.localPosition = Vector3.up * 2.75f;
            for (int i = 0; i < 4; i++)
            {
                var star = FxUtil.NewMeshObject("Star", PrimitiveType.Sphere, stars, indicatorMaterial).transform;
                star.localPosition = Quaternion.Euler(0f, i * 90f, 0f) * Vector3.forward * 0.4f;
                star.localScale = Vector3.one * 0.12f;
            }
            stars.gameObject.SetActive(false);

            mark = GameFonts.CreateTextMesh(transform, "Mark", 0.09f, Color.white);
            mark.transform.localPosition = Vector3.up * 3.05f;
        }

        void UpdateIndicators()
        {
            var s = IsSpawned ? state.Value : BobState.Away;
            bool dizzy = s == BobState.Stunned;
            if (stars.gameObject.activeSelf != dizzy) stars.gameObject.SetActive(dizzy);
            if (dizzy) stars.Rotate(0f, 360f * Time.deltaTime, 0f, Space.Self);
            if (anim != null)
            {
                anim.ArmsUp = s == BobState.Carrying || (s == BobState.Leaving && carriedId.Value != ulong.MaxValue);
                anim.Dizzy = dizzy;
                // Model animation: 0 walk/run, 1 carry, 2 dizzy, 3 look around, 4 yell (ringing the dinner bell).
                int mode = s == BobState.Carrying ? 1
                    : dizzy ? 2
                    : s == BobState.Coming && StateTimeLeft > warningTime - 2f ? 4
                    : (s is BobState.Searching or BobState.Investigating) && anim.Speed < 0.3f ? 3
                    : 0;
                anim.SetMode(mode);
            }
            if (mark == null) return;
            if (Time.time < speechUntil && !string.IsNullOrEmpty(speech))
            {
                mark.text = speech;
                mark.characterSize = 0.05f;
                mark.color = new Color(1f, 0.97f, 0.85f);
            }
            else
            {
                mark.text = s == BobState.Chasing ? "!" : s == BobState.Investigating ? "?" : "";
                mark.characterSize = 0.09f;
                mark.color = s == BobState.Chasing ? new Color(1f, 0.2f, 0.1f) : new Color(1f, 0.9f, 0.2f);
            }
            var cam = Camera.main;
            if (cam != null && mark.text != "") mark.transform.rotation = Quaternion.LookRotation(mark.transform.position - cam.transform.position);
        }
    }
}
