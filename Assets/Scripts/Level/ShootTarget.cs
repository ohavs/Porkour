using Unity.Netcode;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Bullseye switch (a "remote lock"): a hard hit (Armed's shot, or anything thrown fast) toggles its puzzle
    /// channel on/off - e.g. opens a gate. Centre turns green while on. Latching targets stay on once hit.
    /// </summary>
    public class ShootTarget : NetworkBehaviour, IPuzzleChannel
    {
        public int channel;
        public float minHitSpeed = 6f;
        [Tooltip("Stays on after the first hit (exit gate targets).")]
        public bool latch;
        [Tooltip("Centre disc that shows on/off (set by the builder).")]
        public Renderer lamp;
        public Color offColor = new(0.85f, 0.2f, 0.15f);
        public Color onColor = new(0.3f, 0.85f, 0.3f);

        readonly NetworkVariable<bool> on = new();
        readonly NetworkVariable<int> netChannel = new(); // so every PC knows which lock it belongs to (HUD markers)

        public int Channel { get => channel; set => channel = value; }
        public bool IsOn => on.Value;

        MaterialPropertyBlock block;
        float nextHitTime, wobble;

        void Awake() => block = new MaterialPropertyBlock();

        public override void OnNetworkSpawn()
        {
            on.OnValueChanged += OnToggled;
            if (IsServer) netChannel.Value = channel;
            else channel = netChannel.Value;
        }

        public override void OnNetworkDespawn()
        {
            on.OnValueChanged -= OnToggled;
            if (IsServer) PuzzleSignals.Set(channel, this, false);
        }

        void OnCollisionEnter(Collision collision)
        {
            if (!IsServer || !IsSpawned || Time.time < nextHitTime) return;
            if (collision.relativeVelocity.magnitude < minHitSpeed) return;
            nextHitTime = Time.time + 0.5f;
            if (latch && on.Value) { HitRpc(); return; }
            on.Value = !on.Value;
            PuzzleSignals.Set(channel, this, on.Value);
        }

        void OnToggled(bool previous, bool current)
        {
            wobble = 1f;
            Sfx.Play(Sound.Ding, transform.position, 1f, 0f);
            if (current) Sfx.Play(Sound.Click, transform.position, 0.6f);
        }

        [Rpc(SendTo.Everyone)]
        void HitRpc()
        {
            wobble = 1f;
            Sfx.Play(Sound.Bonk, transform.position, 0.5f);
        }

        void Update()
        {
            if (lamp == null) return;
            lamp.GetPropertyBlock(block);
            block.SetColor(FxUtil.BaseColorId, on.Value ? onColor : offColor);
            lamp.SetPropertyBlock(block);
            // Little shake when hit.
            wobble = Mathf.MoveTowards(wobble, 0f, Time.deltaTime * 2f);
            lamp.transform.parent.localRotation = Quaternion.Euler(Mathf.Sin(Time.time * 40f) * 15f * wobble, 0f, 0f);
        }
    }
}
