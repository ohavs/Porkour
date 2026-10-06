using System;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Base of a pig type's special ability (one button: Right Click / LT).
    /// Gameplay runs on the server only (pig.Simulate); visuals go through TriggerEffect, which PigNet
    /// relays to every PC as PlayEffect. Added at runtime by PigController.SetType, so tune values in code.
    /// </summary>
    [RequireComponent(typeof(PigController))]
    public abstract class PigAbility : MonoBehaviour
    {
        [Tooltip("Seconds before the ability can be used again.")]
        public float cooldown = 4f;

        public abstract PigType Type { get; }
        /// <summary>Extra HUD hint shown next to the ability name (null = none).</summary>
        public virtual string Hint => null;
        /// <summary>Time.time when the ability is usable again (server).</summary>
        public float ReadyTime { get; private set; }
        public float CooldownLeft => Mathf.Max(0f, ReadyTime - Time.time);
        public bool IsReady => CooldownLeft <= 0f;
        /// <summary>Stored uses shown on the HUD (e.g. Armed's ammo). -1 = this ability has none.</summary>
        public virtual int Charges => -1;
        public virtual int MaxCharges => 0;

        /// <summary>Raised on the server for visuals (kind, position, direction); PigNet sends it to every PC. Unhooked = play locally.</summary>
        public event Action<byte, Vector3, Vector3> EffectTriggered;

        protected PigController pig;
        bool buttonHeld;

        protected virtual void Awake() => pig = GetComponent<PigController>();

        /// <summary>Called every frame by the controlling player with the ability button state.</summary>
        public virtual void SetButton(bool pressed)
        {
            if (!pig.Simulate || !enabled) return;
            if (pig.HeldBy is PigCage.Hold) { buttonHeld = pressed; return; } // no powers inside Bob's cage
            bool down = pressed && !buttonHeld;
            buttonHeld = pressed;
            if (!down) return;
            if (IsReady && CanUse())
            {
                ReadyTime = Time.time + cooldown;
                Use();
            }
            else PressedWhileUnavailable();
        }

        /// <summary>Server: pressed while cooling down / not usable (e.g. Jumpy pulls its rope back up).</summary>
        protected virtual void PressedWhileUnavailable() { }

        /// <summary>Server: (re)start the cooldown with a custom length.</summary>
        protected void StartCooldown(float seconds) => ReadyTime = Time.time + seconds;

        /// <summary>Forget button state (player switched pig, type changed...).</summary>
        public virtual void CancelInput() => buttonHeld = false;

        protected virtual bool CanUse() => true;

        /// <summary>Server: jump pressed in the air. Return true if the ability used it (e.g. wall bounce).</summary>
        public virtual bool TryAirJump() => false;

        /// <summary>Server: do the ability.</summary>
        protected abstract void Use();

        /// <summary>Every PC: show the ability's visuals. Kind = which effect (ability-specific).</summary>
        public virtual void PlayEffect(byte kind, Vector3 position, Vector3 direction) { }

        protected void TriggerEffect(byte kind, Vector3 position, Vector3 direction)
        {
            if (EffectTriggered != null) EffectTriggered(kind, position, direction);
            else PlayEffect(kind, position, direction);
        }
    }
}
