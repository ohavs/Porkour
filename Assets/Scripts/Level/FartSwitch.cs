using System.Collections.Generic;
using Unity.Netcode;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// The old generator that only starts on farts: a Rocket Fart blast near it (GassyAbility) starts the engine and
    /// turns its puzzle channel on for good. Running: fan spins, exhaust puffs, engine sound (every PC).
    /// </summary>
    public class FartSwitch : NetworkBehaviour, IPuzzleChannel
    {
        public static readonly List<FartSwitch> All = new();

        public int channel;
        [Tooltip("Set by the builder.")]
        public Transform fan;
        public Transform exhaust;
        public Renderer lamp;
        [Tooltip("Extra reach on top of the fart's blast radius.")]
        public float extraReach = 1.2f;

        readonly NetworkVariable<bool> running = new();

        public int Channel { get => channel; set => channel = value; }
        public bool IsRunning => running.Value;

        MaterialPropertyBlock block;
        AudioSource engine;
        float fanSpeed, nextPuff;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => All.Clear();

        void Awake() => block = new MaterialPropertyBlock();
        void OnEnable() => All.Add(this);
        void OnDisable() => All.Remove(this);

        public override void OnNetworkSpawn()
        {
            running.OnValueChanged += OnRunningChanged;
            if (running.Value) StartLoop();
        }

        public override void OnNetworkDespawn()
        {
            running.OnValueChanged -= OnRunningChanged;
            if (IsServer) PuzzleSignals.Set(channel, this, false);
        }

        /// <summary>Server: a fart went off here (called by Gassy's Rocket Fart).</summary>
        public static void Blast(Vector3 center, float radius)
        {
            foreach (var s in All)
            {
                if (!s.IsSpawned || !s.IsServer || s.running.Value) continue;
                if (Vector3.Distance(center, s.transform.position + Vector3.up * 0.6f) > radius + s.extraReach) continue;
                s.running.Value = true;
                PuzzleSignals.Set(s.channel, s, true);
            }
        }

        void OnRunningChanged(bool previous, bool current)
        {
            if (!current) return;
            Sfx.Play(Sound.Engine, transform.position, 1f, 0f);
            ThirdPersonCamera.Shake(transform.position, 0.4f);
            for (int i = 0; i < 5; i++)
                SmokeCloud.Spawn(transform.position + Random.insideUnitSphere * 0.8f + Vector3.up * 0.8f, 0.5f, 1.2f, SmokeCloud.FartColor);
            StartLoop();
        }

        void StartLoop()
        {
            if (engine != null) return;
            engine = Sfx.CreateLoop(Sound.EngineLoop, transform, 0.35f);
            engine.PlayDelayed(1.2f);
        }

        void Update()
        {
            bool on = IsSpawned && running.Value;
            fanSpeed = Mathf.MoveTowards(fanSpeed, on ? 900f : 0f, Time.deltaTime * 500f);
            if (fan != null && fanSpeed > 0f) fan.Rotate(0f, fanSpeed * Time.deltaTime, 0f, Space.Self);
            if (on && exhaust != null && Time.time >= nextPuff)
            {
                nextPuff = Time.time + 0.35f;
                SmokeCloud.SpawnMoving(exhaust.position, Vector3.up * 1.2f, 0.2f, 0.9f, new Color(0.3f, 0.3f, 0.3f, 0.5f));
            }
            if (lamp == null) return;
            lamp.GetPropertyBlock(block);
            block.SetColor(FxUtil.BaseColorId, on ? new Color(0.3f, 0.9f, 0.3f) : new Color(0.9f, 0.25f, 0.2f) * (0.6f + 0.4f * Mathf.Sin(Time.time * 4f)));
            lamp.SetPropertyBlock(block);
        }
    }
}
