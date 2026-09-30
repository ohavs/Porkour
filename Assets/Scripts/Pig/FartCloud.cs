using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Porkour
{
    /// <summary>
    /// Green fart smoke (placeholder look: see-through spheres that puff up, drift up and fade).
    /// Spawned locally on every PC by GassyAbility.PlayEffect. Smoke screens are listed in Active so the
    /// server can later blind/slow Bob inside them; small puffs are just the rocket trail.
    /// </summary>
    public class FartCloud : MonoBehaviour
    {
        public static readonly List<FartCloud> Active = new();
        public static readonly Color SmokeColor = new(0.55f, 0.8f, 0.25f, 0.45f);

        const float GrowTime = 0.35f, RiseSpeed = 0.15f;
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");
        static Mesh sphereMesh;

        public float Radius { get; private set; }

        float lifetime, age;
        bool listed;
        Material material;
        Transform[] parts;
        Vector3[] partScales;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Active.Clear();

        public static FartCloud Spawn(Vector3 position, float radius, float lifetime, bool smokeScreen)
        {
            var cloud = new GameObject(smokeScreen ? "FartCloud" : "FartPuff").AddComponent<FartCloud>();
            cloud.transform.position = position;
            cloud.Init(radius, lifetime, smokeScreen);
            return cloud;
        }

        /// <summary>Is this point inside a smoke screen right now?</summary>
        public static bool InSmoke(Vector3 point)
        {
            foreach (var cloud in Active)
                if ((point - cloud.transform.position).sqrMagnitude <= cloud.Radius * cloud.Radius) return true;
            return false;
        }

        void Init(float radius, float life, bool smokeScreen)
        {
            Radius = radius;
            lifetime = life;
            if (smokeScreen) { Active.Add(this); listed = true; }

            material = CreateSmokeMaterial();
            int count = smokeScreen ? 7 : 2;
            parts = new Transform[count];
            partScales = new Vector3[count];
            for (int i = 0; i < count; i++)
            {
                var go = new GameObject("Puff", typeof(MeshFilter), typeof(MeshRenderer));
                go.GetComponent<MeshFilter>().sharedMesh = SphereMesh();
                var r = go.GetComponent<MeshRenderer>();
                r.sharedMaterial = material;
                r.shadowCastingMode = ShadowCastingMode.Off;
                r.receiveShadows = false;
                if (material == null) r.enabled = false;

                parts[i] = go.transform;
                parts[i].SetParent(transform, false);
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
            var color = SmokeColor;
            color.a *= Mathf.Clamp01((lifetime - age) / (lifetime * 0.4f)); // fade over the last 40%
            material.SetColor(BaseColorId, color);
        }

        void OnDestroy()
        {
            if (listed) Active.Remove(this);
            if (material != null) Destroy(material);
        }

        static Mesh SphereMesh()
        {
            if (sphereMesh == null)
            {
                var temp = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                sphereMesh = temp.GetComponent<MeshFilter>().sharedMesh;
                DestroyImmediate(temp);
            }
            return sphereMesh;
        }

        /// <summary>URP Lit switched to transparent from code (placeholder until a real smoke VFX).</summary>
        static Material CreateSmokeMaterial()
        {
            var shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null) shader = Shader.Find("Universal Render Pipeline/Unlit");
            if (shader == null) return null;

            var mat = new Material(shader);
            mat.SetFloat("_Surface", 1f);
            mat.SetFloat("_Blend", 0f);
            mat.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
            mat.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
            mat.SetFloat("_SrcBlendAlpha", (float)BlendMode.One);
            mat.SetFloat("_DstBlendAlpha", (float)BlendMode.OneMinusSrcAlpha);
            mat.SetFloat("_ZWrite", 0f);
            mat.SetFloat("_Cull", (float)CullMode.Off); // inside the cloud you see green
            mat.SetFloat("_Smoothness", 0f);
            mat.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            mat.SetOverrideTag("RenderType", "Transparent");
            mat.renderQueue = (int)RenderQueue.Transparent;
            mat.SetColor(BaseColorId, SmokeColor);
            return mat;
        }
    }
}
