using System.Collections.Generic;
using Unity.Netcode;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Heavy floor switch: on while the weight standing on it reaches requiredMass (Heavy alone = 45,
    /// or any two pigs; things a pig carries count too). Turns its puzzle channel on (e.g. opens a Gate).
    /// Shows "weight / needed" above it and turns green when pressed.
    /// </summary>
    public class PressurePlate : NetworkBehaviour, IPuzzleChannel
    {
        public int channel;
        [Tooltip("Weight needed. Pigs: Gassy 22, Jumpy 24, Armed 30, Heavy 45.")]
        public float requiredMass = 40f;
        [Tooltip("Plate size (local X/Z) and height of its top surface.")]
        public Vector2 size = new(2f, 2f);
        public float topHeight = 0.1f;
        [Tooltip("Coloured part that sinks when pressed (set by the builder).")]
        public Renderer top;
        public Color offColor = new(0.85f, 0.25f, 0.2f);
        public Color onColor = new(0.3f, 0.85f, 0.3f);

        readonly NetworkVariable<bool> pressed = new();
        readonly NetworkVariable<int> load = new();

        public int Channel { get => channel; set => channel = value; }
        public bool IsPressed => pressed.Value;

        readonly HashSet<Rigidbody> counted = new();
        MaterialPropertyBlock block;
        Vector3 topRestPosition;
        TextMesh label;

        void Awake()
        {
            if (top != null) topRestPosition = top.transform.localPosition;
            block = new MaterialPropertyBlock();
            BuildLabel();
        }

        public override void OnNetworkSpawn() => pressed.OnValueChanged += OnPressedChanged;

        public override void OnNetworkDespawn()
        {
            pressed.OnValueChanged -= OnPressedChanged;
            if (IsServer) PuzzleSignals.Set(channel, this, false);
        }

        void OnPressedChanged(bool previous, bool current) => Sfx.Play(Sound.Click, transform.position, current ? 1f : 0.6f);

        void FixedUpdate()
        {
            if (!IsSpawned || !IsServer) return;
            float mass = MeasureLoad();
            int kg = Mathf.RoundToInt(mass);
            if (load.Value != kg) load.Value = kg;
            bool on = mass >= requiredMass;
            if (pressed.Value != on)
            {
                pressed.Value = on;
                PuzzleSignals.Set(channel, this, on);
            }
        }

        float MeasureLoad()
        {
            counted.Clear();
            float total = 0f;
            Vector3 center = transform.position + transform.up * (topHeight + 0.35f);
            var halfExtents = new Vector3(size.x / 2f - 0.05f, 0.35f, size.y / 2f - 0.05f);
            foreach (var col in Physics.OverlapBox(center, halfExtents, transform.rotation, ~0, QueryTriggerInteraction.Ignore))
            {
                var rb = col.attachedRigidbody;
                if (rb == null || rb.isKinematic || !counted.Add(rb)) continue;
                total += rb.mass;
                // What a pig carries weighs on the plate too.
                if (rb.TryGetComponent(out PigController pig) && pig.Grabber != null && pig.Grabber.Held != null
                    && counted.Add(pig.Grabber.Held))
                    total += pig.Grabber.Held.mass;
            }
            return total;
        }

        void Update()
        {
            bool on = pressed.Value;
            if (top != null)
            {
                var target = topRestPosition + Vector3.down * (on ? 0.05f : 0f);
                top.transform.localPosition = Vector3.MoveTowards(top.transform.localPosition, target, Time.deltaTime * 0.5f);
                top.GetPropertyBlock(block);
                block.SetColor(FxUtil.BaseColorId, on ? onColor : offColor);
                top.SetPropertyBlock(block);
            }
            if (label != null)
            {
                label.text = $"{load.Value} / {Mathf.RoundToInt(requiredMass)}";
                label.color = on ? onColor : Color.white;
                var cam = Camera.main;
                if (cam != null) label.transform.rotation = Quaternion.LookRotation(label.transform.position - cam.transform.position);
            }
        }

        void BuildLabel()
        {
            var font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            if (font == null) return;
            var go = new GameObject("WeightLabel");
            go.transform.SetParent(transform, false);
            go.transform.localPosition = Vector3.up * 1.4f;
            var textRenderer = go.AddComponent<MeshRenderer>();
            textRenderer.sharedMaterial = font.material;
            label = go.AddComponent<TextMesh>();
            label.font = font;
            label.fontSize = 64;
            label.characterSize = 0.05f;
            label.anchor = TextAnchor.MiddleCenter;
            label.alignment = TextAlignment.Center;
        }
    }
}
