using UnityEngine;

namespace Porkour
{
    /// <summary>The getaway truck coming to life once its KeySlot (ignition) takes the keys: exhaust smoke, headlights, engine (local).</summary>
    [RequireComponent(typeof(KeySlot))]
    public class IgnitionFx : MonoBehaviour
    {
        [Tooltip("Set by the builder.")]
        public Transform exhaust;
        public Light[] headlights = new Light[0];

        KeySlot slot;
        AudioSource engine;
        bool running;
        float nextPuff;

        void Awake() => slot = GetComponent<KeySlot>();

        void Update()
        {
            bool on = slot.IsSpawned && slot.IsUnlocked;
            if (on != running)
            {
                running = on;
                foreach (var light in headlights)
                    if (light != null) light.enabled = on;
                if (on)
                {
                    Sfx.Play(Sound.Engine, transform.position, 1f, 0f);
                    ThirdPersonCamera.Shake(transform.position, 0.3f, 8f);
                    if (engine == null) engine = Sfx.CreateLoop(Sound.EngineLoop, transform, 0.4f);
                    engine.PlayDelayed(1f);
                }
            }
            if (!on || exhaust == null || Time.time < nextPuff) return;
            nextPuff = Time.time + 0.3f;
            SmokeCloud.SpawnMoving(exhaust.position, -exhaust.forward * 1.5f + Vector3.up * 0.4f, 0.22f, 0.9f, new Color(0.35f, 0.35f, 0.35f, 0.5f));
        }
    }
}
