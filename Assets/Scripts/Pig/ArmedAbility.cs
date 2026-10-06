using System.Collections;
using System.Collections.Generic;
using Unity.Netcode;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Armed's Slingshot Snout (one button):
    /// hold = suck up small items (Ammo: apples, corn, eggs, bolts) in a cone in front of the snout;
    /// tap = shoot the last one where the camera aims (crosshair). Shots ring bells, hit target switches
    /// and stun Farmer Bob (any fast hit does - see FarmerBob / ShootTarget / Bell).
    /// </summary>
    public class ArmedAbility : PigAbility
    {
        [Header("Suck")]
        public float suckRange = 4.5f;
        [Tooltip("Half angle of the suck cone (degrees).")]
        public float suckAngle = 35f;
        public float suckSpeed = 7f;
        public int magazineSize = 6;
        [Tooltip("Hold longer than this = suck; shorter = shoot.")]
        public float tapTime = 0.2f;

        [Header("Shoot")]
        public float shotSpeed = 26f;
        public float shotCooldown = 0.35f;

        public override PigType Type => PigType.Armed;
        public override string Hint => "hold: suck up  |  tap: shoot";
        public override int Charges => magazine.Count;
        public override int MaxCharges => magazineSize;

        const byte FxSuckOn = 0, FxSuckOff = 1, FxShoot = 2;

        readonly List<Ammo.Kind> magazine = new();
        bool buttonHeld, sucking;
        float pressStart;
        Coroutine suckFx; // every PC

        Vector3 Snout => transform.position + transform.forward * 0.95f + Vector3.up * 0.15f;

        protected override void Awake()
        {
            base.Awake();
            cooldown = shotCooldown;
        }

        void OnDisable() => SetSucking(false);

        public override void SetButton(bool pressed)
        {
            if (!pig.Simulate || !enabled) return;
            bool down = pressed && !buttonHeld;
            bool up = !pressed && buttonHeld;
            buttonHeld = pressed;

            if (down)
            {
                pressStart = Time.time;
                if (magazine.Count == 0) SetSucking(true); // nothing to shoot: suck right away
            }
            if (pressed && !sucking && Time.time - pressStart >= tapTime) SetSucking(true);
            if (up)
            {
                if (!sucking && magazine.Count > 0 && IsReady && !pig.IsHeld) Shoot();
                SetSucking(false);
            }
        }

        public override void CancelInput()
        {
            buttonHeld = false;
            SetSucking(false);
        }

        protected override void Use() { } // button handled in SetButton

        void SetSucking(bool on)
        {
            if (sucking == on) return;
            sucking = on;
            if (pig != null && pig.Simulate) TriggerEffect(on ? FxSuckOn : FxSuckOff, Vector3.zero, Vector3.zero);
        }

        // ---------- suck (server) ----------

        void FixedUpdate()
        {
            if (!sucking || !pig.Simulate) return;
            if (pig.IsHeld || magazine.Count >= magazineSize) return;

            Vector3 snout = Snout;
            Vector3 aim = AimDirection();
            foreach (var col in Physics.OverlapSphere(snout, suckRange, ~0, QueryTriggerInteraction.Ignore))
            {
                var rb = col.attachedRigidbody;
                if (rb == null || rb.isKinematic || !rb.TryGetComponent(out Ammo ammo) || !ammo.IsSpawned) continue;
                if (pig.Grabber != null && pig.Grabber.Held == rb) continue;
                Vector3 to = rb.position - snout;
                if (to.magnitude < 0.6f)
                {
                    magazine.Add(ammo.kind);
                    ammo.NetworkObject.Despawn(true);
                    if (magazine.Count >= magazineSize) return;
                    continue;
                }
                if (Vector3.Angle(aim, to) > suckAngle) continue;
                rb.linearVelocity = -to.normalized * suckSpeed; // set every step, so gravity barely matters
            }
        }

        // ---------- shoot (server) ----------

        void Shoot()
        {
            var kind = magazine[magazine.Count - 1];
            var prefab = Ammo.PrefabFor(kind);
            if (prefab == null) return;
            magazine.RemoveAt(magazine.Count - 1);

            Vector3 aim = AimDirection();
            Vector3 flat = Vector3.ProjectOnPlane(aim, Vector3.up);
            if (flat.sqrMagnitude > 0.001f) pig.FaceDirection(flat);
            Vector3 muzzle = pig.Body.position + (flat.sqrMagnitude > 0.001f ? flat.normalized : transform.forward) * 1.25f
                             + Vector3.up * 0.2f;
            Vector3 velocity = Ammo.BallisticVelocity(muzzle, AimPoint(aim), shotSpeed);

            var go = Instantiate(prefab, muzzle, Quaternion.LookRotation(velocity));
            go.GetComponent<NetworkObject>().Spawn();
            go.GetComponent<Ammo>().Fire(pig.GetComponentsInChildren<Collider>(), velocity);
            StartCooldown(shotCooldown);
            TriggerEffect(FxShoot, muzzle, velocity.normalized);
        }

        Vector3 AimDirection() => pig.Aim.sqrMagnitude > 0.01f ? pig.Aim.normalized : transform.forward;

        /// <summary>What the crosshair points at: the camera ray passes through its pivot (1 m above the pig).</summary>
        Vector3 AimPoint(Vector3 aim)
        {
            Vector3 pivot = pig.Body.position + Vector3.up;
            float best = 60f;
            foreach (var hit in Physics.RaycastAll(pivot, aim, 60f, ~0, QueryTriggerInteraction.Ignore))
            {
                if (hit.rigidbody == pig.Body || hit.distance < 0.5f) continue;
                if (pig.Grabber != null && hit.rigidbody != null && hit.rigidbody == pig.Grabber.Held) continue;
                if (hit.distance < best) best = hit.distance;
            }
            return pivot + aim * best;
        }

        // ---------- visuals (every PC) ----------

        public override void PlayEffect(byte kind, Vector3 position, Vector3 direction)
        {
            switch (kind)
            {
                case FxSuckOn:
                    if (suckFx == null) suckFx = StartCoroutine(SuckSwirl());
                    Sfx.Play(Sound.Suck, transform.position, 0.6f);
                    break;
                case FxSuckOff:
                    if (suckFx != null) StopCoroutine(suckFx);
                    suckFx = null;
                    break;
                case FxShoot:
                    SmokeCloud.Spawn(position, 0.25f, 0.35f, SmokeCloud.DustColor);
                    Sfx.Play(Sound.Shoot, position);
                    break;
            }
        }

        IEnumerator SuckSwirl()
        {
            var wait = new WaitForSeconds(0.06f);
            while (true)
            {
                Vector3 snout = Snout;
                Vector3 dir = Quaternion.Euler(Random.Range(-suckAngle, suckAngle), Random.Range(-suckAngle, suckAngle), 0f)
                              * transform.forward;
                Vector3 start = snout + dir * Random.Range(2f, suckRange);
                SmokeCloud.SpawnMoving(start, (snout - start) / 0.3f, 0.12f, 0.3f, SmokeCloud.DustColor);
                yield return wait;
            }
        }
    }
}
