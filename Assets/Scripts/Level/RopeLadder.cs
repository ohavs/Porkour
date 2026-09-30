using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Jumpy's rope ladder hanging down from a ledge. Created locally on every PC (via the ability's
    /// PlayEffect) from the same top point / direction / length; the Climbable only matters on the server.
    /// Placeholder look: two ropes + rungs. Disappears after its lifetime.
    /// </summary>
    [RequireComponent(typeof(Climbable))]
    public class RopeLadder : MonoBehaviour
    {
        static readonly Color RopeColor = new(0.72f, 0.58f, 0.36f);
        const float RungSpacing = 0.35f, HalfSpread = 0.25f;

        Material material;
        float dieTime;

        /// <summary>top = ledge edge point (on the ledge surface), outward = away from the ledge.</summary>
        public static RopeLadder Create(Vector3 top, Vector3 outward, float length, float lifetime)
        {
            outward.y = 0f;
            outward = outward.sqrMagnitude > 0.001f ? outward.normalized : Vector3.forward;
            var go = new GameObject("RopeLadder");
            go.transform.SetPositionAndRotation(top + Vector3.down * length, Quaternion.LookRotation(outward, Vector3.up));
            go.AddComponent<Climbable>().height = length;
            var rope = go.AddComponent<RopeLadder>();
            rope.Build(length);
            rope.dieTime = Time.time + lifetime;
            return rope;
        }

        void Build(float length)
        {
            material = FxUtil.NewMaterial(RopeColor, transparent: false);
            // Unity's cylinder is 2 high along Y, radius 0.5.
            foreach (float x in new[] { -HalfSpread, HalfSpread })
            {
                var side = FxUtil.NewMeshObject("Rope", PrimitiveType.Cylinder, transform, material).transform;
                side.localPosition = new Vector3(x, length / 2f, 0f);
                side.localScale = new Vector3(0.05f, length / 2f, 0.05f);
            }
            for (float y = RungSpacing; y < length - 0.05f; y += RungSpacing)
            {
                var rung = FxUtil.NewMeshObject("Rung", PrimitiveType.Cylinder, transform, material).transform;
                rung.localPosition = new Vector3(0f, y, 0f);
                rung.localRotation = Quaternion.Euler(0f, 0f, 90f);
                rung.localScale = new Vector3(0.04f, HalfSpread + 0.03f, 0.04f);
            }
            var hook = FxUtil.NewMeshObject("Hook", PrimitiveType.Cube, transform, material).transform;
            hook.localPosition = new Vector3(0f, length + 0.03f, -0.2f);
            hook.localScale = new Vector3(0.7f, 0.06f, 0.45f);
        }

        void Update()
        {
            if (Time.time >= dieTime) Destroy(gameObject);
        }

        void OnDestroy()
        {
            if (material != null) Destroy(material);
        }
    }
}
