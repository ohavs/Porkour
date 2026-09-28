using System.Collections.Generic;
using Unity.Netcode;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Porkour
{
    /// <summary>One frame of a player's controls, sent from the owner's PC to the server.</summary>
    public struct PigInputFrame : INetworkSerializable
    {
        public Vector3 Move, Aim;
        public bool JumpHeld, SprintHeld, GrabHeld;
        // Press counters (wrap around) so quick taps are never lost between sends.
        public byte JumpPresses, GrabPresses, SwitchPresses;

        public void NetworkSerialize<T>(BufferSerializer<T> serializer) where T : IReaderWriter
        {
            serializer.SerializeValue(ref Move);
            serializer.SerializeValue(ref Aim);
            serializer.SerializeValue(ref JumpHeld);
            serializer.SerializeValue(ref SprintHeld);
            serializer.SerializeValue(ref GrabHeld);
            serializer.SerializeValue(ref JumpPresses);
            serializer.SerializeValue(ref GrabPresses);
            serializer.SerializeValue(ref SwitchPresses);
        }
    }

    /// <summary>
    /// A connected player (one per PC, spawned by the server, owned by that PC).
    /// Owner: reads local input + camera, sends it to the server, shows camera/HUD for its pig.
    /// Server: applies the latest input to the pig this player controls (server-authoritative physics).
    /// </summary>
    public class NetPlayer : NetworkBehaviour
    {
        public static readonly List<NetPlayer> All = new();

        public InputActionAsset controls;
        [Tooltip("Throw-arc line material for the HUD (set by the builder).")]
        public Material arcMaterial;
        public float sendRate = 30f;

        readonly NetworkVariable<ulong> pigId = new(ulong.MaxValue);

        public PigController Pig { get; private set; }
        public bool UsingGamepad { get; private set; }

        // Owner side
        InputActionAsset actions;
        InputAction moveAction, lookAction, jumpAction, sprintAction, grabAction, switchAction;
        ThirdPersonCamera cam;
        PigInputFrame pending;
        float nextSendTime;

        // Server side
        PigInputFrame latest;
        byte lastJump, lastGrab, lastSwitch;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => All.Clear();

        public override void OnNetworkSpawn()
        {
            All.Add(this);
            name = $"Player {OwnerClientId}";
            if (IsOwner)
            {
                actions = Instantiate(controls);
                moveAction = actions["Move"];
                lookAction = actions["Look"];
                jumpAction = actions["Jump"];
                sprintAction = actions["Sprint"];
                grabAction = actions["Grab"];
                switchAction = actions["SwitchPig"];
                actions.Enable();
                if (Camera.main != null) cam = Camera.main.GetComponent<ThirdPersonCamera>();
                var hud = gameObject.AddComponent<PlayerHud>();
                hud.arcMaterial = arcMaterial;
            }
            pigId.OnValueChanged += OnPigIdChanged;
            ResolvePig();
        }

        public override void OnNetworkDespawn()
        {
            All.Remove(this);
            pigId.OnValueChanged -= OnPigIdChanged;
            if (IsServer && Pig != null) ReleasePig();
            if (actions != null)
            {
                actions.Disable();
                Destroy(actions);
            }
        }

        void OnPigIdChanged(ulong previous, ulong current) => ResolvePig();

        void ResolvePig()
        {
            PigController pig = null;
            if (pigId.Value != ulong.MaxValue && NetworkManager != null
                && NetworkManager.SpawnManager.SpawnedObjects.TryGetValue(pigId.Value, out var obj))
                pig = obj.GetComponent<PigController>();
            if (!IsServer) Pig = pig; // server sets Pig directly in AssignPig
            if (IsOwner && cam != null) cam.SetTarget(pig != null ? pig.transform : null);
        }

        void Update()
        {
            if (!IsSpawned) return;
            // The pig may spawn on this PC after we do - keep trying until it resolves.
            if (!IsServer && Pig == null && pigId.Value != ulong.MaxValue) ResolvePig();
            if (IsOwner) GatherAndSend();
            if (IsServer) ApplyToPig();
        }

        // ---------- owner ----------

        void GatherAndSend()
        {
            if (lookAction.activeControl != null) UsingGamepad = lookAction.activeControl.device is Gamepad;
            if (moveAction.activeControl != null) UsingGamepad = moveAction.activeControl.device is Gamepad;
            if (cam != null) cam.SetLookInput(lookAction.ReadValue<Vector2>(), lookAction.activeControl?.device is Pointer);

            if (jumpAction.WasPressedThisFrame()) pending.JumpPresses++;
            if (grabAction.WasPressedThisFrame()) pending.GrabPresses++;
            if (switchAction.WasPressedThisFrame()) pending.SwitchPresses++;

            // Camera-relative stick → world direction; aim = where the camera looks.
            Vector3 aim = cam != null ? cam.transform.forward : (Pig != null ? Pig.transform.forward : Vector3.forward);
            Vector3 forward = Vector3.ProjectOnPlane(aim, Vector3.up);
            forward = forward.sqrMagnitude > 0.001f ? forward.normalized : Vector3.forward;
            Vector3 right = Vector3.Cross(Vector3.up, forward);
            Vector2 move = moveAction.ReadValue<Vector2>();
            pending.Move = Vector3.ClampMagnitude(forward * move.y + right * move.x, 1f);
            pending.Aim = aim;
            pending.JumpHeld = jumpAction.IsPressed();
            pending.SprintHeld = sprintAction.IsPressed();
            pending.GrabHeld = grabAction.IsPressed();

            if (IsServer)
            {
                Receive(pending);
                return;
            }
            // Clients: keep the local pig's aim current for the HUD throw preview (it doesn't simulate here).
            if (Pig != null) Pig.SetInput(pending.Move, pending.Aim, pending.JumpHeld, pending.SprintHeld);
            if (Time.unscaledTime >= nextSendTime)
            {
                nextSendTime = Time.unscaledTime + 1f / sendRate;
                SubmitInputRpc(pending);
            }
        }

        [Rpc(SendTo.Server)]
        void SubmitInputRpc(PigInputFrame frame) => Receive(frame);

        // ---------- server ----------

        void Receive(PigInputFrame frame)
        {
            latest = frame;
            int jumps = (byte)(frame.JumpPresses - lastJump);
            int grabs = (byte)(frame.GrabPresses - lastGrab);
            int switches = (byte)(frame.SwitchPresses - lastSwitch);
            lastJump = frame.JumpPresses;
            lastGrab = frame.GrabPresses;
            lastSwitch = frame.SwitchPresses;

            if (switches > 0) SwitchToNextFreePig();
            if (Pig == null) return;
            for (int i = 0; i < Mathf.Min(jumps, 3); i++) Pig.PressJump();
            if (grabs > 0 && Pig.Grabber != null)
            {
                // Replay a full press so taps shorter than one send interval still count.
                Pig.Grabber.SetGrabButton(false);
                Pig.Grabber.SetGrabButton(true);
            }
        }

        void ApplyToPig()
        {
            if (Pig == null) return;
            Pig.SetInput(latest.Move, latest.Aim, latest.JumpHeld, latest.SprintHeld);
            if (Pig.Grabber != null) Pig.Grabber.SetGrabButton(latest.GrabHeld);
        }

        /// <summary>Server: give this player control of a pig (null = none).</summary>
        public void AssignPig(PigController pig)
        {
            if (!IsServer) return;
            if (Pig != null) ReleasePig();
            Pig = pig;
            if (pig != null) pig.Owner = this;
            pigId.Value = pig != null ? pig.GetComponent<NetworkObject>().NetworkObjectId : ulong.MaxValue;
        }

        void ReleasePig()
        {
            Pig.ClearInput();
            if (Pig.Grabber != null) Pig.Grabber.CancelInput();
            Pig.Owner = null;
            Pig = null;
        }

        /// <summary>Server: take the next pig nobody controls (solo testing now; maybe a feature later).</summary>
        void SwitchToNextFreePig()
        {
            var pigs = PigController.All;
            if (pigs.Count == 0) return;
            int start = Pig != null ? pigs.IndexOf(Pig) : -1;
            for (int i = 1; i <= pigs.Count; i++)
            {
                var next = pigs[(start + i + pigs.Count) % pigs.Count];
                if (next.Owner == null) { AssignPig(next); return; }
            }
        }

        /// <summary>Server: first pig nobody controls.</summary>
        public static PigController FindFreePig()
        {
            foreach (var pig in PigController.All)
                if (pig.Owner == null) return pig;
            return null;
        }
    }
}
