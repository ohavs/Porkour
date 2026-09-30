using System.Collections.Generic;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Smoke / dust puff (placeholder look: see-through spheres that puff up, drift up and fade).
    /// Local visual spawned on every PC (e.g. from an ability's PlayEffect). Smoke screens (Gassy's fart cloud)
    /// are listed in Active so the server can later blind/slow Bob inside them; other puffs are just visuals.
    /// </summary>
    public class SmokeCloud : MonoBehaviour
    {
        public static readonly List<SmokeCloud> Active = new();
        public static readonly Color FartColor = new(0.55f, 0.8f, 0.25f, 0.45f);
        public static readonly Color DustColor = new(0.78f, 0.7f, 0.56f, 0.55f);

        const float GrowTime = 0.35f, RiseSpeed = 0.15f;

        public float Radius { get; private set; }

        float lifetime, age;
        bool listed;
        Color color;
        Material material;
        Transform[] parts;
        Vector3[] partScales;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Active.Clear();

        public static SmokeCloud Spawn(Vector3 position, float radius, float lifetime, Color color, bool smokeScreen = false)
        {
            var cloud = new GameObject(smokeScreen ? "SmokeScreen" : "Puff").AddComponent<SmokeCloud>();
            cloud.transform.position = position;
            cloud.Init(radius, lifetime, color, smokeScreen);
            return cloud;
        }

        /// <summary>Is this point inside a smoke screen right now?</summary>
        public static bool InSmoke(Vector3 point)
        {
            foreach (var cloud in Active)
                if ((point - cloud.transform.position).sqrMagnitude <= cloud.Radius * cloud.Radius) return true;
            return false;
        }

        void Init(float radius, float life, Color tint, bool smokeScreen)
        {
            Radius = radius;
            lifetime = life;
            color = tint;
            if (smokeScreen) { Active.Add(this); listed = true; }

            material = FxUtil.NewMaterial(color, transparent: true);
            int count = smokeScreen ? 7 : radius > 0.5f ? 3 : 2;
            parts = new Transform[count];
            partScales = new Vector3[count];
            for (int i = 0; i < count; i++)
            {
                parts[i] = FxUtil.NewMeshObject("Part", PrimitiveType.Sphere, transform, material).transform;
                parts[i].localPosition = i == 0 ? Vector3.zero : Random.insideUnitSphere * (radius * 0.45f);
                partScales[i] = Vector3.one * (radius * (i == 0 ? 1.2f : Random.Range(0.6f, 1f)));
                parts[i].localScale = partScales[i] * 0.2f;
            }
        }

        void Update()
        {
            age += Time.deltaTime;
            if (age >= lifetime) { Destroy(gameObject); return; }

            float grow = 1f - Mathf.Pow(1f - Mathf.Clamp01(age / GrowTime), 3f);
            for (int i = 0; i < parts.Length; i++) parts[i].localScale = partScales[i] * Mathf.Lerp(0.2f, 1f, grow);
            transform.position += Vector3.up * (RiseSpeed * Time.deltaTime);

            if (material == null) return;
            var c = color;
            c.a *= Mathf.Clamp01((lifetime - age) / (lifetime * 0.4f)); // fade over the last 40%
            material.SetColor(FxUtil.BaseColorId, c);
        }

        void OnDestroy()
        {
            if (listed) Active.Remove(this);
            if (material != null) Destroy(material);
        }
    }
}
