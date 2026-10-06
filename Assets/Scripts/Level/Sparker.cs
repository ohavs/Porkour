using UnityEngine;

namespace Porkour
{
    /// <summary>Local sparks around something electric (the fuse box) until its Breakable is smashed.</summary>
    public class Sparker : MonoBehaviour
    {
        public Vector3 size = new(1f, 1f, 0.5f);

        Breakable breakable;
        float next;

        void Awake() => breakable = GetComponent<Breakable>();

        void Update()
        {
            if (Time.time < next || (breakable != null && breakable.IsSpawned && breakable.IsBroken)) return;
            next = Time.time + Random.Range(0.25f, 1f);
            Vector3 p = transform.TransformPoint(new Vector3(Random.Range(-0.5f, 0.5f) * size.x, Random.Range(-0.5f, 0.5f) * size.y, size.z * 0.5f));
            for (int i = 0; i < 3; i++)
                SmokeCloud.SpawnMoving(p, Random.insideUnitSphere * 2f + transform.forward, 0.07f, 0.3f, new Color(1f, 0.95f, 0.4f, 0.9f));
        }
    }
}
