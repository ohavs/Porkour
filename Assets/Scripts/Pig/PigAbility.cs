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

        /// <summary>Raised on the server for visuals (kind, position, direction); PigNet sends it to every PC. Unhooked = play locally.</summary>
        public event Action<byte, Vector3, Vector3> EffectTriggered;

        protected PigController pig;
        bool buttonHeld;

        protected virtual void Awake() => pig = GetComponent<PigController>();

        /// <summary>Called every frame by the controlling player with the ability button state.</summary>
        public virtual void SetButton(bool pressed)
        {
            if (!pig.Simulate || !enabled) return;
            bool down = pressed && !buttonHeld;
            buttonHeld = pressed;
            if (down && IsReady && CanUse())
            {
                ReadyTime = Time.time + cooldown;
                Use();
            }
        }

        /// <summary>Forget button state (player switched pig, type changed...).</summary>
        public virtual void CancelInput() => buttonHeld = false;

        protected virtual bool CanUse() => true;

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
