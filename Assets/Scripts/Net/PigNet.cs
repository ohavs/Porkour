using Unity.Netcode;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Network side of a pig. The server simulates (PigController/PigGrabber); clients only receive
    /// position via NetworkTransform/NetworkRigidbody plus the few states the HUD needs, synced here.
    /// HUD code reads IsHeld/Held/IsCharging/Charge from this class on every PC.
    /// </summary>
    [RequireComponent(typeof(PigController), typeof(PigGrabber))]
    public class PigNet : NetworkBehaviour
    {
        [Tooltip("Skin colour, set by the server before spawning.")]
        public Color initialColor = new(1f, 0.62f, 0.68f);

        readonly NetworkVariable<Color> skin = new(new Color(1f, 0.62f, 0.68f));
        readonly NetworkVariable<ulong> heldId = new(ulong.MaxValue);
        readonly NetworkVariable<bool> isHeld = new();
        readonly NetworkVariable<bool> charging = new();
        readonly NetworkVariable<double> chargeStart = new();

        PigController controller;
        PigGrabber grabber;
        PigLook look;

        bool Authority => !IsSpawned || IsServer;

        public bool IsHeld => Authority ? controller.IsHeld : isHeld.Value;
        public bool IsCharging => Authority ? grabber.IsCharging : charging.Value;
        public float Charge => Authority ? grabber.Charge
            : charging.Value ? Mathf.Clamp01((float)(NetworkManager.ServerTime.Time - chargeStart.Value) / grabber.fullChargeTime) : 0f;

        public Rigidbody Held
        {
            get
            {
                if (Authority) return grabber.Held;
                if (heldId.Value == ulong.MaxValue) return null;
                return NetworkManager.SpawnManager.SpawnedObjects.TryGetValue(heldId.Value, out var obj)
                    ? obj.GetComponent<Rigidbody>() : null;
            }
        }

        void Awake()
        {
            controller = GetComponent<PigController>();
            grabber = GetComponent<PigGrabber>();
            look = GetComponent<PigLook>();
            // Decide early (before the first FixedUpdate) whether this copy simulates.
            var nm = NetworkManager.Singleton;
            SetSimulate(nm == null || !nm.IsListening || nm.IsServer);
        }

        public override void OnNetworkSpawn()
        {
            SetSimulate(IsServer);
            if (IsServer) skin.Value = initialColor;
            ApplyColor(skin.Value);
            skin.OnValueChanged += OnSkinChanged;
        }

        public override void OnNetworkDespawn() => skin.OnValueChanged -= OnSkinChanged;

        void SetSimulate(bool simulate)
        {
            controller.Simulate = simulate;
            grabber.Simulate = simulate;
        }

        void OnSkinChanged(Color previous, Color current) => ApplyColor(current);

        void ApplyColor(Color color)
        {
            if (look == null) return;
            look.skinColor = color;
            look.SetSkinColor(color);
        }

        void FixedUpdate()
        {
            if (!IsSpawned || !IsServer) return;

            ulong id = ulong.MaxValue;
            var held = grabber.Held;
            if (held != null && held.TryGetComponent(out NetworkObject obj) && obj.IsSpawned) id = obj.NetworkObjectId;
            if (heldId.Value != id) heldId.Value = id;

            if (isHeld.Value != controller.IsHeld) isHeld.Value = controller.IsHeld;

            if (charging.Value != grabber.IsCharging)
            {
                if (grabber.IsCharging)
                    chargeStart.Value = NetworkManager.ServerTime.Time - grabber.Charge * grabber.fullChargeTime;
                charging.Value = grabber.IsCharging;
            }
        }
    }
}
