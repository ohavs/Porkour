using Unity.Netcode;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// A quest item (a normal networked prop): the padlock key, the truck keys, Bob's pie, loot... Floats a label so
    /// players spot it, and goes back to where it started if it falls out of the level (server). A KeySlot with the same
    /// keyId uses it up; the pie (bonus mission) and loot (coins) only count while they're in the truck.
    /// </summary>
    [RequireComponent(typeof(Rigidbody))]
    public class KeyItem : MonoBehaviour
    {
        [Tooltip("Which KeySlot takes it (\"gate\", \"truck\"...). Empty = no slot (bonus item).")]
        public string keyId = "gate";
        public string labelText = "KEY";
        public Color labelColor = new(1f, 0.85f, 0.2f);
        [Tooltip("Bob's pie: the 'Pie heist' bonus mission is done while it's in the truck.")]
        public bool bonus;
        [Tooltip("Loot: coins for the team if it's in the truck when the pigs escape.")]
        public int coins;
        public float killHeight = -10f;

        public static readonly System.Collections.Generic.List<KeyItem> All = new();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => All.Clear();

        void OnEnable() => All.Add(this);
        void OnDisable() => All.Remove(this);

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
            var cam = Camera.main;
            bool show = cam != null && (cam.transform.position - transform.position).sqrMagnitude < 16f * 16f; // only up close
            if (label.gameObject.activeSelf != show) label.gameObject.SetActive(show);
            if (!show) return;
            label.transform.position = transform.position + Vector3.up * (0.55f + Mathf.Sin(Time.time * 4f) * 0.06f);
            label.transform.rotation = Quaternion.LookRotation(label.transform.position - cam.transform.position);
        }

        void BuildLabel()
        {
            label = GameFonts.CreateTextMesh(transform, "KeyLabel", 0.04f, labelColor);
            label.text = labelText;
        }
    }
}
