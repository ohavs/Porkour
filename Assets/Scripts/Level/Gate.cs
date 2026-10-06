using Unity.Netcode;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Gate / door / lift that moves by openOffset (by default down into the floor) while it's "on", and back when off.
    /// On = its channel is on, or - if requiredChannels is set (the exit gate) - all of those are on.
    /// Server moves the kinematic body; NetworkTransform shows it on every PC. Rumbles when it starts moving.
    /// </summary>
    [RequireComponent(typeof(Rigidbody))]
    public class Gate : NetworkBehaviour, IPuzzleChannel
    {
        public int channel;
        [Tooltip("If not empty: opens only when ALL these channels are on (channel is ignored).")]
        public int[] requiredChannels;
        public Vector3 openOffset = new(0f, -3.05f, 0f);
        public float speed = 3f;
        [Tooltip("Play the rumble sound when it starts moving.")]
        public bool rumble = true;

        public int Channel { get => channel; set => channel = value; }
        /// <summary>Open signal (synced: every PC knows it).</summary>
        public bool IsOpen => isOpen.Value;

        readonly NetworkVariable<bool> isOpen = new();

        Rigidbody rb;
        Vector3 closedPosition;

        void Awake() => rb = GetComponent<Rigidbody>();

        public override void OnNetworkSpawn()
        {
            closedPosition = transform.position;
            if (IsServer) rb.isKinematic = true;
            isOpen.OnValueChanged += OnOpenChanged;
        }

        public override void OnNetworkDespawn() => isOpen.OnValueChanged -= OnOpenChanged;

        void OnOpenChanged(bool previous, bool current)
        {
            if (rumble) Sfx.Play(Sound.Rumble, transform.position, 0.8f);
        }

        void FixedUpdate()
        {
            if (!IsSpawned || !IsServer) return;
            bool open = requiredChannels != null && requiredChannels.Length > 0 ? PuzzleSignals.AllOn(requiredChannels) : PuzzleSignals.IsOn(channel);
            if (isOpen.Value != open) isOpen.Value = open;
            Vector3 target = open ? closedPosition + openOffset : closedPosition;
            if (rb.position != target) rb.MovePosition(Vector3.MoveTowards(rb.position, target, speed * Time.fixedDeltaTime));
        }
    }
}
