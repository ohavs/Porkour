using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Pig visuals: shows the right model for the pig type (Heavy = the big hog, others = pig), gives it the type's skin
    /// (recoloured texture made by the builder; tint if missing), sizes it per type (long pigs; Armed big, Gassy fat - every
    /// fart deflates him a bit, then he puffs back up). The old primitive pig paints its "skin" parts instead. Local, every PC.
    /// </summary>
    public class PigLook : MonoBehaviour
    {
        [Tooltip("Primitive pig only: renderers painted in the type colour.")]
        public Renderer[] skin;
        public Color skinColor = new(1f, 0.62f, 0.68f);
        [Tooltip("Models (optional, set by the builder): normal pigs / Heavy.")]
        public GameObject pigModel, hogModel;
        [Tooltip("Pig model skin per PigType (index = type; null = keep the model's own).")]
        public Material[] typeMaterials;

        [Tooltip("How fast a deflated Gassy puffs back up (share of his size per second).")]
        public float reinflateSpeed = 0.08f;

        PigType type;
        bool hasType;
        Material material, tint;
        Renderer[] pigRenderers;
        Material[][] pigOriginal;
        Vector3 pigBase = Vector3.one, hogBase = Vector3.one;
        float deflated; // 0 = full size

        /// <summary>Model size per type (width, height, length) - tune here. Every pig is stretched long.</summary>
        static Vector3 TypeScale(PigType t) => t switch
        {
            PigType.Gassy => new Vector3(1.4f, 1.12f, 1.45f), // round and gassy
            PigType.Armed => new Vector3(1.25f, 1.25f, 1.6f),
            PigType.Jumpy => new Vector3(0.95f, 0.98f, 1.3f),
            _ => new Vector3(1.05f, 1f, 1.3f),
        };

        void Awake()
        {
            if (pigModel != null)
            {
                pigBase = pigModel.transform.localScale;
                pigRenderers = pigModel.GetComponentsInChildren<Renderer>(true);
                pigOriginal = new Material[pigRenderers.Length][];
                for (int i = 0; i < pigRenderers.Length; i++) pigOriginal[i] = pigRenderers[i].sharedMaterials;
            }
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
            if (tint != null) Destroy(tint);
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
            ApplyModelSkin();
            deflated = 0f;
            ApplySize();
        }

        /// <summary>The pig model in this type's colours (the builder's recoloured skin, or a tint).</summary>
        void ApplyModelSkin()
        {
            if (pigRenderers == null) return;
            int t = (int)type;
            var skinMat = typeMaterials != null && t < typeMaterials.Length ? typeMaterials[t] : null;
            if (skinMat == null && pigOriginal.Length > 0 && pigOriginal[0].Length > 0 && pigOriginal[0][0] != null)
            {
                if (tint == null) tint = new Material(pigOriginal[0][0]);
                tint.SetColor("_BaseColor", Color.Lerp(Color.white, skinColor, 0.7f));
                skinMat = tint;
            }
            for (int i = 0; i < pigRenderers.Length; i++)
            {
                var mats = (Material[])pigOriginal[i].Clone();
                if (skinMat != null)
                    for (int m = 0; m < mats.Length; m++) mats[m] = skinMat;
                pigRenderers[i].sharedMaterials = mats;
            }
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

        /// <summary>Primitive pig: paint the skin parts.</summary>
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
