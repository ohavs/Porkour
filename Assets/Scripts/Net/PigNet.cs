using Unity.Netcode;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Network side of a pig. The server simulates (PigController/PigGrabber/ability); clients only receive
    /// position via NetworkTransform/NetworkRigidbody plus the few states the HUD needs, synced here.
    /// Type is synced and applied on every PC (stats, ability component, skin colour).
    /// HUD code reads Type/IsHeld/Held/IsCharging/Charge/AbilityCooldownLeft from this class on every PC.
    /// </summary>
    [RequireComponent(typeof(PigController), typeof(PigGrabber))]
    public class PigNet : NetworkBehaviour
    {
        [Tooltip("Pig type, set by the server before spawning (random per game).")]
        public PigType initialType;

        readonly NetworkVariable<PigType> type = new();
        readonly NetworkVariable<ulong> heldId = new(ulong.MaxValue);
        readonly NetworkVariable<bool> isHeld = new();
        readonly NetworkVariable<bool> charging = new();
        readonly NetworkVariable<double> chargeStart = new();
        readonly NetworkVariable<double> abilityReadyAt = new();
        readonly NetworkVariable<int> abilityCharges = new(-1);

        PigController controller;
        PigGrabber grabber;
        PigLook look;
        PigAbility hookedAbility;
        float syncedReadyTime = -1f;

        bool Authority => !IsSpawned || IsServer;

        public PigType Type => controller.Type;
        public PigAbility Ability => controller.Ability;
        public bool IsHeld => Authority ? controller.IsHeld : isHeld.Value;
        public bool IsCharging => Authority ? grabber.IsCharging : charging.Value;
        public float Charge => Authority ? grabber.Charge
            : charging.Value ? Mathf.Clamp01((float)(NetworkManager.ServerTime.Time - chargeStart.Value) / grabber.fullChargeTime) : 0f;
        /// <summary>Ability's stored uses for the HUD (Armed's ammo); -1 = none.</summary>
        public int AbilityCharges => Ability == null ? -1 : Authority ? Ability.Charges : abilityCharges.Value;
        public float AbilityCooldownLeft => Ability == null ? 0f
            : Authority ? Ability.CooldownLeft
            : Mathf.Max(0f, (float)(abilityReadyAt.Value - NetworkManager.ServerTime.Time));

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
            if (IsServer) type.Value = initialType;
            ApplyType(type.Value);
            type.OnValueChanged += OnTypeChanged;
        }

        public override void OnNetworkDespawn()
        {
            type.OnValueChanged -= OnTypeChanged;
            HookAbility(null);
        }

        /// <summary>Server: change this pig's type (e.g. a new round).</summary>
        public void SetType(PigType newType)
        {
            if (IsServer) type.Value = newType;
        }

        void SetSimulate(bool simulate)
        {
            controller.Simulate = simulate;
            grabber.Simulate = simulate;
        }

        void OnTypeChanged(PigType previous, PigType current) => ApplyType(current);

        void ApplyType(PigType pigType)
        {
            controller.SetType(pigType);
            HookAbility(controller.Ability);
            if (look == null) return;
            var color = PigTypes.Info(pigType).Color;
            look.skinColor = color; // PigLook.Start re-applies this
            look.SetSkinColor(color);
        }

        // ---------- ability visuals: server → every PC ----------

        void HookAbility(PigAbility ability)
        {
            if (hookedAbility != null) hookedAbility.EffectTriggered -= OnAbilityEffect;
            hookedAbility = ability;
            if (ability != null) ability.EffectTriggered += OnAbilityEffect;
        }

        void OnAbilityEffect(byte kind, Vector3 position, Vector3 direction)
        {
            if (IsServer && IsSpawned) AbilityEffectRpc(kind, position, direction);
        }

        [Rpc(SendTo.Everyone)]
        void AbilityEffectRpc(byte kind, Vector3 position, Vector3 direction)
        {
            if (Ability != null) Ability.PlayEffect(kind, position, direction);
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

            // Cooldown: send only when the ability is used (the end time, not a ticking value).
            var ability = Ability;
            int charges = ability != null ? ability.Charges : -1;
            if (abilityCharges.Value != charges) abilityCharges.Value = charges;
            if (ability != null && ability.ReadyTime != syncedReadyTime)
            {
                syncedReadyTime = ability.ReadyTime;
                abilityReadyAt.Value = NetworkManager.ServerTime.Time + ability.CooldownLeft;
            }
        }
    }
}
