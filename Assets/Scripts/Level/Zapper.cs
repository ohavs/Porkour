using Unity.Netcode;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Electric fence: while its Gate is closed (power on) it zaps pigs that touch it - they fly back with sparks.
    /// When the gate's channel turns on (fuse box smashed) the fence sinks into the floor and goes quiet.
    /// </summary>
    [RequireComponent(typeof(Gate))]
    public class Zapper : NetworkBehaviour
    {
        public float knockSpeed = 6f;
        public float knockHeight = 1.2f;
        [Tooltip("Wires that flicker while powered (set by the builder).")]
        public Renderer[] wires = new Renderer[0];
        public Color wireColor = new(1f, 0.9f, 0.2f);

        Gate gate;
        MaterialPropertyBlock block;
        float nextZap, nextSpark;

        void Awake()
        {
            gate = GetComponent<Gate>();
            block = new MaterialPropertyBlock();
        }

        void OnCollisionEnter(Collision collision) => TryZap(collision);
        void OnCollisionStay(Collision collision) => TryZap(collision);

        void TryZap(Collision collision)
        {
            if (!IsServer || !IsSpawned || gate.IsOpen || Time.time < nextZap) return;
            var rb = collision.rigidbody;
            if (rb == null || !rb.TryGetComponent(out PigController pig) || pig.IsHeld) return;
            nextZap = Time.time + 0.4f;
            Vector3 side = Vector3.Dot(pig.Body.position - transform.position, transform.forward) >= 0f ? transform.forward : -transform.forward;
            Vector3 v = pig.Body.linearVelocity;
            pig.Launch(Mathf.Sqrt(2f * -Physics.gravity.y * knockHeight), side * knockSpeed - new Vector3(v.x, 0f, v.z));
            Vector3 point = collision.contactCount > 0 ? collision.GetContact(0).point : pig.Body.position;
            ZapRpc(point);
        }

        [Rpc(SendTo.Everyone)]
        void ZapRpc(Vector3 point)
        {
            Sfx.Play(Sound.Zap, point, 1f);
            ThirdPersonCamera.Shake(point, 0.5f, 6f);
            for (int i = 0; i < 5; i++)
                SmokeCloud.SpawnMoving(point, Random.insideUnitSphere * 3f, 0.12f, 0.35f, new Color(1f, 0.95f, 0.4f, 0.9f));
        }

        void Update()
        {
            bool powered = IsSpawned && !gate.IsOpen;
            float flicker = powered ? (Random.value < 0.15f ? 1.4f : 1f) : 0.25f;
            foreach (var wire in wires)
            {
                if (wire == null) continue;
                wire.GetPropertyBlock(block);
                block.SetColor(FxUtil.BaseColorId, powered ? wireColor * flicker : new Color(0.35f, 0.35f, 0.35f));
                wire.SetPropertyBlock(block);
            }
            if (!powered || Time.time < nextSpark || wires.Length == 0) return;
            nextSpark = Time.time + Random.Range(0.3f, 1.2f);
            var w = wires[Random.Range(0, wires.Length)];
            if (w == null) return;
            Vector3 p = w.bounds.center + Vector3.right * Random.Range(-w.bounds.extents.x, w.bounds.extents.x)
                        + Vector3.forward * Random.Range(-w.bounds.extents.z, w.bounds.extents.z);
            SmokeCloud.SpawnMoving(p, Random.insideUnitSphere * 1.5f, 0.08f, 0.25f, new Color(1f, 0.95f, 0.4f, 0.9f));
        }
    }
}
