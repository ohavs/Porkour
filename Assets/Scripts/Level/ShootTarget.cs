using Unity.Netcode;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Bullseye switch (a "remote lock"): a hard hit (Armed's shot, or anything thrown fast) toggles its puzzle
    /// channel on/off - e.g. opens a gate. Centre turns green while on.
    /// </summary>
    public class ShootTarget : NetworkBehaviour, IPuzzleChannel
    {
        public int channel;
        public float minHitSpeed = 6f;
        [Tooltip("Centre disc that shows on/off (set by the builder).")]
        public Renderer lamp;
        public Color offColor = new(0.85f, 0.2f, 0.15f);
        public Color onColor = new(0.3f, 0.85f, 0.3f);

        readonly NetworkVariable<bool> on = new();

        public int Channel { get => channel; set => channel = value; }

        MaterialPropertyBlock block;
        float nextHitTime, wobble;

        void Awake() => block = new MaterialPropertyBlock();

        public override void OnNetworkSpawn() => on.OnValueChanged += OnToggled;

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
            on.Value = !on.Value;
            PuzzleSignals.Set(channel, this, on.Value);
        }

        void OnToggled(bool previous, bool current) => wobble = 1f;

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
