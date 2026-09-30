using Unity.Netcode;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Gate that slides open (by default down into the floor) while its puzzle channel is on, and closes again
    /// when it's off. Server moves the kinematic body; NetworkTransform shows it on every PC.
    /// </summary>
    [RequireComponent(typeof(Rigidbody))]
    public class Gate : NetworkBehaviour, IPuzzleChannel
    {
        public int channel;
        public Vector3 openOffset = new(0f, -3.05f, 0f);
        public float speed = 3f;

        public int Channel { get => channel; set => channel = value; }

        Rigidbody rb;
        Vector3 closedPosition;

        void Awake() => rb = GetComponent<Rigidbody>();

        public override void OnNetworkSpawn()
        {
            closedPosition = transform.position;
            if (IsServer) rb.isKinematic = true;
        }

        void FixedUpdate()
        {
            if (!IsSpawned || !IsServer) return;
            Vector3 target = PuzzleSignals.IsOn(channel) ? closedPosition + openOffset : closedPosition;
            if (rb.position != target) rb.MovePosition(Vector3.MoveTowards(rb.position, target, speed * Time.fixedDeltaTime));
        }
    }
}
