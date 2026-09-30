using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Local "smash" visual: small cubes fly out, fall to where the object stood, shrink and vanish.
    /// No colliders / physics (so it never pushes networked pigs); spawned on every PC by Breakable.
    /// </summary>
    public class Debris : MonoBehaviour
    {
        const float Lifetime = 1.4f;

        Material material;
        Transform[] pieces;
        Vector3[] velocities, spins, scales;
        float floorY, age;

        public static void Burst(Bounds area, Color color, int count)
        {
            var debris = new GameObject("Debris").AddComponent<Debris>();
            debris.Init(area, color, count);
        }

        void Init(Bounds area, Color color, int count)
        {
            transform.position = area.center;
            floorY = area.min.y + 0.08f;
            material = FxUtil.NewMaterial(color, transparent: false);
            pieces = new Transform[count];
            velocities = new Vector3[count];
            spins = new Vector3[count];
            scales = new Vector3[count];
            float size = Mathf.Clamp(Mathf.Min(area.size.x, area.size.y, area.size.z) * 0.35f, 0.12f, 0.35f);
            for (int i = 0; i < count; i++)
            {
                var piece = FxUtil.NewMeshObject("Piece", PrimitiveType.Cube, transform, material).transform;
                piece.position = area.center + Vector3.Scale(Random.insideUnitSphere * 0.5f, area.size);
                piece.rotation = Random.rotation;
                scales[i] = new Vector3(size * Random.Range(0.5f, 1.4f), size * Random.Range(0.3f, 0.8f), size * Random.Range(0.5f, 1.4f));
                piece.localScale = scales[i];
                Vector3 outward = piece.position - area.center;
                outward.y = 0f;
                velocities[i] = outward.normalized * Random.Range(1.5f, 4f) + Vector3.up * Random.Range(2f, 5f);
                spins[i] = Random.insideUnitSphere * 720f;
                pieces[i] = piece;
            }
        }

        void Update()
        {
            float dt = Time.deltaTime;
            age += dt;
            if (age >= Lifetime) { Destroy(gameObject); return; }
            float shrink = Mathf.Clamp01((Lifetime - age) / (Lifetime * 0.5f));
            for (int i = 0; i < pieces.Length; i++)
            {
                var p = pieces[i];
                velocities[i] += Physics.gravity * dt;
                Vector3 pos = p.position + velocities[i] * dt;
                if (pos.y < floorY) // cheap fake floor: bounce once, then slide to a stop
                {
                    pos.y = floorY;
                    velocities[i] = new Vector3(velocities[i].x * 0.5f, -velocities[i].y * 0.25f, velocities[i].z * 0.5f);
                    spins[i] *= 0.5f;
                }
                p.position = pos;
                p.Rotate(spins[i] * dt, Space.World);
                p.localScale = scales[i] * shrink;
            }
        }

        void OnDestroy()
        {
            if (material != null) Destroy(material);
        }
    }
}
