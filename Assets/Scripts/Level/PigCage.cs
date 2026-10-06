using System;
using Unity.Netcode;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Bob's cage next to his BBQ grill. Bob locks the pigs he catches in here; each one has grillTime seconds (the grill
    /// heating up) before Bob throws it on the grill. Free pigs open the cage by standing at its door for unlockTime
    /// seconds (nosing the latch), or at once with a hard hit on it (thrown thing, Armed's shot, Heavy's slam).
    /// Smashing Bob's gas bottle (channel Sabotage) makes the grill much slower. Server runs it, every PC reads the synced
    /// list for the HUD / timer label / grill smoke.
    /// </summary>
    public class PigCage : NetworkBehaviour
    {
        public static PigCage Instance { get; private set; }

        /// <summary>One caged pig (synced).</summary>
        public struct Caged : IEquatable<Caged>
        {
            public ulong PigId;
            public double ReadyAt;
            public byte Slot;

            public bool Equals(Caged other) => PigId == other.PigId && ReadyAt == other.ReadyAt && Slot == other.Slot;
        }

        /// <summary>The cage "carrying" one pig - so Respawn / Drop let go of just that pig. No wriggling out.</summary>
        public sealed class Hold : IPigCarrier
        {
            public readonly PigCage Cage;
            public readonly PigController Pig;

            public Hold(PigCage cage, PigController pig)
            {
                Cage = cage;
                Pig = pig;
            }

            public void Drop() => Cage.Release(Pig, false);
            public int EscapePresses => int.MaxValue;
        }

        [Tooltip("Seconds until the grill is hot (then Bob throws the pig on it).")]
        public float grillTime = 120f;
        [Tooltip("Extra seconds once the gas bottle is smashed.")]
        public float sabotageBonus = 60f;
        [Tooltip("Seconds a free pig must stand at the door to open the cage.")]
        public float unlockTime = 3f;
        public float unlockRadius = 1.3f;
        public float hardHitSpeed = 7f;
        [Tooltip("Local: where caged pigs sit (set by the builder), the door (rescuers stand there), the grill (smoke).")]
        public Vector3[] slots = { new(-0.5f, 0.5f, 0.3f), new(0.5f, 0.5f, 0.3f), new(-0.5f, 0.5f, -0.4f), new(0.5f, 0.5f, -0.4f) };
        public Vector3 door = new(0f, 0f, 1.6f);
        public Vector3 grill = new(-5f, 1f, 0f);
        public WorldLabel label;

        NetworkList<Caged> caged;
        readonly NetworkVariable<float> unlock = new();
        readonly NetworkVariable<bool> sabotaged = new();
        float lastRescuer;
        float nextSmoke;

        public int Count => caged != null ? caged.Count : 0;
        public bool Sabotaged => sabotaged.Value;
        /// <summary>0..1 while someone is opening the latch.</summary>
        public float UnlockProgress => unlock.Value;
        public Vector3 DoorPoint => transform.TransformPoint(door);
        public Vector3 GrillPoint => transform.TransformPoint(grill);

        void Awake() => caged = new NetworkList<Caged>();

        public override void OnNetworkSpawn() => Instance = this;

        public override void OnNetworkDespawn()
        {
            if (Instance == this) Instance = null;
            if (!IsServer) return;
            for (int i = caged.Count - 1; i >= 0; i--)
            {
                var pig = PigOf(caged[i]);
                if (pig != null && pig.HeldBy is Hold) pig.SetHeldBy(null);
            }
        }

        /// <summary>Seconds until pig's grill time (0 = ready now), or -1 if it isn't in the cage. Every PC.</summary>
        public float TimeLeft(ulong pigId)
        {
            if (caged == null) return -1f;
            foreach (var c in caged)
                if (c.PigId == pigId) return Mathf.Max(0f, (float)(c.ReadyAt - NetworkManager.ServerTime.Time));
            return -1f;
        }

        /// <summary>The caged pig closest to the grill (smallest time left), for the HUD. False if empty.</summary>
        public bool Soonest(out ulong pigId, out float timeLeft)
        {
            pigId = 0;
            timeLeft = float.MaxValue;
            if (caged == null || caged.Count == 0) return false;
            foreach (var c in caged)
            {
                float left = Mathf.Max(0f, (float)(c.ReadyAt - NetworkManager.ServerTime.Time));
                if (left < timeLeft) { timeLeft = left; pigId = c.PigId; }
            }
            return true;
        }

        // ---------- server ----------

        /// <summary>Server: Bob puts a pig in. False when the cage is full.</summary>
        public bool Lock(PigController pig)
        {
            if (!IsServer || pig == null || caged.Count >= slots.Length) return false;
            byte slot = 0;
            while (SlotTaken(slot)) slot++;
            var id = pig.GetComponent<NetworkObject>().NetworkObjectId;
            if (pig.IsHeld) pig.HeldBy.Drop();
            if (pig.Grabber != null) pig.Grabber.Drop();
            pig.SetHeldBy(new Hold(this, pig));
            pig.TeleportTo(transform.TransformPoint(slots[slot]), transform.rotation); // facing the door
            float time = grillTime + (sabotaged.Value ? sabotageBonus : 0f);
            caged.Add(new Caged { PigId = id, ReadyAt = NetworkManager.ServerTime.Time + time, Slot = slot });
            LockFxRpc(PigTypes.Info(pig.Type).Name, Mathf.RoundToInt(time));
            return true;
        }

        /// <summary>Server: a pig whose grill time is up (Bob takes it). Null if none.</summary>
        public PigController Overdue()
        {
            if (!IsServer) return null;
            double now = NetworkManager.ServerTime.Time;
            foreach (var c in caged)
                if (c.ReadyAt <= now) return PigOf(c);
            return null;
        }

        /// <summary>Server: let one pig out of the cage (respawn, grilled, freed). push = hop out of the door.</summary>
        public void Release(PigController pig, bool push)
        {
            if (!IsServer || pig == null) return;
            var id = pig.GetComponent<NetworkObject>().NetworkObjectId;
            for (int i = caged.Count - 1; i >= 0; i--)
                if (caged[i].PigId == id) caged.RemoveAt(i);
            if (pig.HeldBy is Hold) pig.SetHeldBy(null);
            if (!push) return;
            // Out through the (now open) door: the door's collider stays, so put the pig outside first.
            Vector3 outside = transform.TransformPoint(door + new Vector3(UnityEngine.Random.Range(-0.6f, 0.6f), 0.6f, 0.4f));
            pig.TeleportTo(outside, transform.rotation);
            pig.Launch(4f, transform.forward * 3f);
        }

        /// <summary>Server: open the door - everyone inside is free.</summary>
        public void Open(string how)
        {
            if (!IsServer || caged.Count == 0) return;
            int freed = 0;
            for (int i = caged.Count - 1; i >= 0; i--)
            {
                var pig = PigOf(caged[i]);
                if (pig != null) { Release(pig, true); freed++; }
                else caged.RemoveAt(i);
            }
            unlock.Value = 0f;
            OpenFxRpc(freed, how);
            if (RoundManager.Instance != null) RoundManager.Instance.OnPigsRescued(freed);
        }

        /// <summary>Server: Heavy's Belly Slam or another big hit.</summary>
        public void Smash() => Open("smashed open");

        void FixedUpdate()
        {
            if (!IsServer || !IsSpawned) return;
            CheckSabotage();
            if (caged.Count == 0)
            {
                if (unlock.Value != 0f) unlock.Value = 0f;
                return;
            }
            // Keep the prisoners in their spots.
            for (int i = caged.Count - 1; i >= 0; i--)
            {
                var pig = PigOf(caged[i]);
                if (pig == null || !(pig.HeldBy is Hold)) { caged.RemoveAt(i); continue; }
                Vector3 to = transform.TransformPoint(slots[caged[i].Slot]) - pig.Body.position;
                pig.Body.linearVelocity = to.magnitude > 2f ? Vector3.zero : to * 10f;
                if (to.magnitude > 2f) pig.Body.position += to;
                pig.Body.angularVelocity = Vector3.zero;
            }
            // Rescuers nosing the latch.
            bool rescuer = false;
            Vector3 d = DoorPoint;
            foreach (var pig in PigController.All)
            {
                if (pig == null || pig.IsHeld || pig.Escaped || pig.Owner == null) continue; // sleeping pigs don't help
                Vector3 rel = pig.Body.position - d;
                if (Mathf.Abs(rel.y) < 1.5f && new Vector2(rel.x, rel.z).magnitude < unlockRadius) { rescuer = true; break; }
            }
            if (rescuer) lastRescuer = Time.time;
            float progress = rescuer ? unlock.Value + Time.fixedDeltaTime / unlockTime
                : Time.time - lastRescuer > 1f ? Mathf.Max(0f, unlock.Value - Time.fixedDeltaTime / unlockTime) : unlock.Value;
            if (!Mathf.Approximately(progress, unlock.Value)) unlock.Value = Mathf.Min(1f, progress);
            if (unlock.Value >= 1f) Open("opened");
        }

        void CheckSabotage()
        {
            if (sabotaged.Value || !PuzzleSignals.IsOn(ChannelIds.Sabotage)) return;
            sabotaged.Value = true;
            for (int i = 0; i < caged.Count; i++)
            {
                var c = caged[i];
                c.ReadyAt += sabotageBonus;
                caged[i] = c;
            }
        }

        void OnCollisionEnter(Collision collision)
        {
            if (!IsServer || !IsSpawned || caged.Count == 0) return;
            var rb = collision.rigidbody;
            if (rb == null || rb.isKinematic || collision.relativeVelocity.magnitude < hardHitSpeed) return;
            if (rb.TryGetComponent(out PigController pig))
            {
                // Running into it does nothing - only a flying pig (thrown / launched) bursts it open.
                if (pig.HeldBy is Hold || (pig.IsGrounded && !pig.MovementLocked)) return;
                if (collision.relativeVelocity.magnitude < hardHitSpeed + 1f) return;
            }
            Open("knocked open");
        }

        bool SlotTaken(byte slot)
        {
            foreach (var c in caged)
                if (c.Slot == slot) return true;
            return false;
        }

        PigController PigOf(Caged c) =>
            NetworkManager.SpawnManager.SpawnedObjects.TryGetValue(c.PigId, out var obj) && obj != null ? obj.GetComponent<PigController>() : null;

        // ---------- every PC ----------

        void Update()
        {
            if (!IsSpawned) return;
            bool any = Soonest(out _, out float left);
            if (label != null)
            {
                string text = !any ? "" : unlock.Value > 0f ? $"OPENING {Mathf.RoundToInt(unlock.Value * 100f)}%"
                    : $"GRILL HOT IN {Mathf.CeilToInt(left) / 60}:{Mathf.CeilToInt(left) % 60:00}";
                label.Set(text, unlock.Value > 0f ? new Color(0.5f, 1f, 0.45f) : left < 20f ? new Color(1f, 0.3f, 0.15f) : new Color(1f, 0.85f, 0.4f));
            }
            // The grill smokes harder as it gets hot.
            if (!any || Time.time < nextSmoke) return;
            float heat = 1f - Mathf.Clamp01(left / grillTime);
            nextSmoke = Time.time + Mathf.Lerp(0.8f, 0.12f, heat);
            SmokeCloud.SpawnMoving(GrillPoint + UnityEngine.Random.insideUnitSphere * 0.3f, Vector3.up * 1.2f, Mathf.Lerp(0.2f, 0.45f, heat), 2f,
                new Color(0.3f, 0.3f, 0.3f, 0.45f));
        }

        [Rpc(SendTo.Everyone)]
        void LockFxRpc(string pigName, int seconds)
        {
            Sfx.Play(Sound.Unlock, DoorPoint, 0.8f);
            GameEvents.Announce($"The {pigName} pig is in Bob's CAGE! {seconds / 60}:{seconds % 60:00} until the grill is hot - stand at the cage door to open it!");
        }

        [Rpc(SendTo.Everyone)]
        void OpenFxRpc(int freed, string how)
        {
            Sfx.Play(Sound.Unlock, DoorPoint, 1f, 0f);
            Sfx.Play(Sound.Escape, DoorPoint, 0.8f, 0f);
            for (int i = 0; i < 6; i++)
                SmokeCloud.SpawnMoving(DoorPoint + Vector3.up * 0.8f, UnityEngine.Random.insideUnitSphere * 2.5f + Vector3.up * 1.5f, 0.15f, 0.8f,
                    Color.HSVToRGB(UnityEngine.Random.value, 0.6f, 1f) * new Color(1f, 1f, 1f, 0.9f));
            GameEvents.Announce(freed == 1 ? $"The cage was {how} - pig rescued!" : $"The cage was {how} - {freed} pigs rescued!");
        }
    }
}
