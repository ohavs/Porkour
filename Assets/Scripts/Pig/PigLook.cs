using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Pig visuals: shows the right model for the pig type (Heavy = the big hog, others = pig), sizes it per type (Armed big,
    /// Gassy fat - every fart deflates him a bit, then he puffs back up) and paints the type colour on the "skin" parts
    /// (the saddle cloth on the models; the whole body on the old primitive pig). Local, every PC.
    /// </summary>
    public class PigLook : MonoBehaviour
    {
        [Tooltip("Renderers painted in the type colour (set by the builder).")]
        public Renderer[] skin;
        public Color skinColor = new(1f, 0.62f, 0.68f);
        [Tooltip("Models (optional, set by the builder): normal pigs / Heavy.")]
        public GameObject pigModel, hogModel;

        [Tooltip("How fast a deflated Gassy puffs back up (share of his size per second).")]
        public float reinflateSpeed = 0.08f;

        PigType type;
        bool hasType;
        Material material;
        Vector3 pigBase = Vector3.one, hogBase = Vector3.one;
        float deflated; // 0 = full size

        /// <summary>Model size per type (width, height, length) - tune here.</summary>
        static Vector3 TypeScale(PigType t) => t switch
        {
            PigType.Gassy => new Vector3(1.4f, 1.12f, 1.15f), // round and gassy
            PigType.Armed => new Vector3(1.25f, 1.25f, 1.25f),
            PigType.Jumpy => new Vector3(0.95f, 0.98f, 0.95f),
            _ => Vector3.one,
        };

        void Awake()
        {
            if (pigModel != null) pigBase = pigModel.transform.localScale;
            if (hogModel != null) hogBase = hogModel.transform.localScale;
        }

        void Start()
        {
            SetSkinColor(skinColor);
            if (hasType) ShowModel();
        }

        void OnDestroy()
        {
            if (material != null) Destroy(material);
        }

        /// <summary>Every PC, whenever the pig's type is set.</summary>
        public void ApplyType(PigType newType, Color color)
        {
            type = newType;
            hasType = true;
            skinColor = color;
            SetSkinColor(color);
            ShowModel();
        }

        void ShowModel()
        {
            bool heavy = type == PigType.Heavy && hogModel != null;
            if (hogModel != null && hogModel.activeSelf != heavy) hogModel.SetActive(heavy);
            if (pigModel != null && pigModel.activeSelf == heavy) pigModel.SetActive(!heavy);
            deflated = 0f;
            ApplySize();
        }

        /// <summary>Every PC: Gassy just farted - a bit of him is gone (he puffs back up over a few seconds).</summary>
        public void Deflate(float amount = 0.2f) => deflated = Mathf.Min(0.45f, deflated + amount);

        void LateUpdate()
        {
            if (deflated <= 0f) return;
            deflated = Mathf.Max(0f, deflated - reinflateSpeed * Time.deltaTime);
            ApplySize();
        }

        void ApplySize()
        {
            if (!hasType) return;
            Vector3 size = TypeScale(type);
            // Deflating = mostly thinner, a little shorter (the model's feet stay on the ground: its pivot is at the feet).
            size = Vector3.Scale(size, new Vector3(1f - deflated, 1f - deflated * 0.35f, 1f - deflated * 0.25f));
            if (pigModel != null) pigModel.transform.localScale = Vector3.Scale(pigBase, size);
            if (hogModel != null) hogModel.transform.localScale = Vector3.Scale(hogBase, size);
        }

        public void SetSkinColor(Color color)
        {
            if (skin == null || skin.Length == 0 || skin[0] == null) return;
            if (material == null) material = new Material(skin[0].sharedMaterial);
            material.SetColor("_BaseColor", color);
            foreach (var r in skin)
                if (r != null) r.sharedMaterial = material;
        }
    }
}
