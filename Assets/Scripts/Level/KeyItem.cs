using Unity.Netcode;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// The padlock key (a normal networked prop). Floats a "KEY" label so players spot it, and goes back to where it
    /// started if it falls out of the level (server). KeySlot uses it up.
    /// </summary>
    [RequireComponent(typeof(Rigidbody))]
    public class KeyItem : MonoBehaviour
    {
        public float killHeight = -10f;

        Rigidbody rb;
        Vector3 home;
        Quaternion homeRotation;
        TextMesh label;

        void Awake()
        {
            rb = GetComponent<Rigidbody>();
            home = transform.position;
            homeRotation = transform.rotation;
            BuildLabel();
        }

        void FixedUpdate()
        {
            var nm = NetworkManager.Singleton;
            if (nm == null || !nm.IsServer || rb.position.y > killHeight) return;
            rb.linearVelocity = Vector3.zero;
            rb.angularVelocity = Vector3.zero;
            rb.position = home;
            rb.rotation = homeRotation;
            transform.SetPositionAndRotation(home, homeRotation);
        }

        void LateUpdate()
        {
            if (label == null) return;
            label.transform.position = transform.position + Vector3.up * (0.55f + Mathf.Sin(Time.time * 4f) * 0.06f);
            var cam = Camera.main;
            if (cam != null) label.transform.rotation = Quaternion.LookRotation(label.transform.position - cam.transform.position);
        }

        void BuildLabel()
        {
            var font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            if (font == null) return;
            var go = new GameObject("KeyLabel");
            go.transform.SetParent(transform, false);
            go.AddComponent<MeshRenderer>().sharedMaterial = font.material;
            label = go.AddComponent<TextMesh>();
            label.font = font;
            label.text = "KEY";
            label.fontSize = 64;
            label.characterSize = 0.04f;
            label.fontStyle = FontStyle.Bold;
            label.anchor = TextAnchor.MiddleCenter;
            label.color = new Color(1f, 0.85f, 0.2f);
        }
    }
}
