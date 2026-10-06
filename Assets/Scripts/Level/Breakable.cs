using System.Collections.Generic;
using Unity.Netcode;
using UnityEngine;
using UnityEngine.AI;

namespace Porkour
{
    /// <summary>
    /// Something Heavy's Belly Slam smashes (weak crate, rotten boards...). Server calls Break(): the object
    /// hides on every PC (stays spawned, so late joiners see it broken), debris flies, and optional
    /// contents (e.g. a key) are spawned in its place. With a channel (the fuse box) breaking it turns that channel on.
    /// </summary>
    public class Breakable : NetworkBehaviour, IPuzzleChannel
    {
        public static readonly List<Breakable> All = new();

        [Tooltip("Puzzle channel turned on when smashed (0 = none). Set from NetSpawnPoint.channel.")]
        public int channel;
        [Tooltip("Networked prefab spawned when broken (e.g. a key inside a crate). Set from NetSpawnPoint.contents.")]
        public GameObject contents;
        public Color debrisColor = new(0.6f, 0.45f, 0.3f);
        public int debrisPieces = 10;

        readonly NetworkVariable<bool> broken = new();
        bool shownBroken;

        public bool IsBroken => broken.Value;
        public int Channel { get => channel; set => channel = value; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => All.Clear();

        void OnEnable() => All.Add(this);
        void OnDisable() => All.Remove(this);

        public override void OnNetworkSpawn()
        {
            broken.OnValueChanged += OnBrokenChanged;
            if (broken.Value) ShowBroken(debris: false);
        }

        public override void OnNetworkDespawn()
        {
            broken.OnValueChanged -= OnBrokenChanged;
            if (IsServer && channel != 0) PuzzleSignals.Set(channel, this, false);
        }

        /// <summary>Server: smash it.</summary>
        public void Break()
        {
            if (!IsServer || broken.Value) return;
            var rb = GetComponent<Rigidbody>();
            if (rb != null)
                foreach (var pig in PigController.All)
                    if (pig.Grabber != null && pig.Grabber.Held == rb) pig.Grabber.Drop();

            Bounds bounds = GetBounds();
            broken.Value = true;
            ShowBroken(debris: true);
            if (channel != 0) PuzzleSignals.Set(channel, this, true);

            if (contents != null)
            {
                var item = Instantiate(contents, bounds.center, Quaternion.identity);
                item.GetComponent<NetworkObject>().Spawn();
            }
        }

        void OnBrokenChanged(bool previous, bool current)
        {
            if (current) ShowBroken(debris: true);
        }

        void ShowBroken(bool debris)
        {
            if (shownBroken) return;
            shownBroken = true;
            if (debris)
            {
                var bounds = GetBounds();
                Debris.Burst(bounds, debrisColor, debrisPieces);
                Sfx.Play(Sound.Smash, bounds.center);
                if (channel != 0) Sfx.Play(Sound.Zap, bounds.center); // fuse box
            }

            foreach (var r in GetComponentsInChildren<Renderer>()) r.enabled = false;
            foreach (var c in GetComponentsInChildren<Collider>()) c.enabled = false;
            foreach (var o in GetComponentsInChildren<NavMeshObstacle>()) o.enabled = false; // Bob may walk through now
            if (IsServer && TryGetComponent(out Rigidbody rb) && !rb.isKinematic)
            {
                rb.linearVelocity = Vector3.zero;
                rb.angularVelocity = Vector3.zero;
                rb.isKinematic = true; // no colliders now - don't fall forever
            }
        }

        Bounds GetBounds()
        {
            var bounds = new Bounds(transform.position, Vector3.zero);
            foreach (var r in GetComponentsInChildren<Renderer>())
                if (r.enabled) bounds.Encapsulate(r.bounds);
            return bounds;
        }
    }
}
