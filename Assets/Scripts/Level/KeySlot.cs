using Unity.Netcode;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Lock for a KeyItem (padlock on a post, the truck's ignition). Bring the matching key close (carried on your back
    /// or thrown at it): the key is used up, the lock pops open and its puzzle channel stays on.
    /// </summary>
    public class KeySlot : NetworkBehaviour, IPuzzleChannel
    {
        public int channel;
        [Tooltip("KeyItem.keyId this lock takes.")]
        public string acceptsKey = "gate";
        [Tooltip("Lock position above this object's pivot, and how close the key must get.")]
        public Vector3 lockOffset = new(0f, 1.3f, 0f);
        public float radius = 1.2f;
        [Tooltip("Set by the builder: the shackle pops up, the lamp turns green.")]
        public Transform shackle;
        public Renderer lamp;

        readonly NetworkVariable<bool> unlocked = new();

        public int Channel { get => channel; set => channel = value; }
        public bool IsUnlocked => unlocked.Value;

        MaterialPropertyBlock block;
        Vector3 shackleRest;

        void Awake()
        {
            block = new MaterialPropertyBlock();
            if (shackle != null) shackleRest = shackle.localPosition;
        }

        public override void OnNetworkSpawn() => unlocked.OnValueChanged += OnUnlocked;

        public override void OnNetworkDespawn()
        {
            unlocked.OnValueChanged -= OnUnlocked;
            if (IsServer) PuzzleSignals.Set(channel, this, false);
        }

        void FixedUpdate()
        {
            if (!IsServer || !IsSpawned || unlocked.Value) return;
            foreach (var col in Physics.OverlapSphere(transform.position + lockOffset, radius, ~0, QueryTriggerInteraction.Ignore))
            {
                var rb = col.attachedRigidbody;
                if (rb == null || !rb.TryGetComponent(out KeyItem key) || key.keyId != acceptsKey) continue;
                foreach (var pig in PigController.All)
                    if (pig.Grabber != null && pig.Grabber.Held == rb) pig.Grabber.Drop();
                if (rb.TryGetComponent(out NetworkObject keyObject) && keyObject.IsSpawned) keyObject.Despawn(true);
                unlocked.Value = true;
                PuzzleSignals.Set(channel, this, true);
                return;
            }
        }

        void OnUnlocked(bool previous, bool current)
        {
            if (current) Sfx.Play(Sound.Unlock, transform.position + lockOffset, 1f, 0f);
        }

        void Update()
        {
            bool open = IsSpawned && unlocked.Value;
            if (shackle != null)
                shackle.localPosition = Vector3.MoveTowards(shackle.localPosition, shackleRest + (open ? Vector3.up * 0.25f : Vector3.zero), Time.deltaTime);
            if (lamp == null) return;
            lamp.GetPropertyBlock(block);
            float pulse = open ? 1f : 0.6f + 0.4f * Mathf.Sin(Time.time * 4f);
            block.SetColor(FxUtil.BaseColorId, open ? new Color(0.3f, 0.9f, 0.3f) : new Color(0.9f, 0.25f, 0.2f) * pulse);
            lamp.SetPropertyBlock(block);
        }
    }
}
