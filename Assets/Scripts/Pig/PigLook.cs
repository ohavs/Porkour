using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Pig visuals: shows the right model for the pig type (Heavy = the big hog, others = pig) and paints the type colour
    /// on the "skin" parts (the saddle cloth on the models; the whole body on the old primitive pig).
    /// </summary>
    public class PigLook : MonoBehaviour
    {
        [Tooltip("Renderers painted in the type colour (set by the builder).")]
        public Renderer[] skin;
        public Color skinColor = new(1f, 0.62f, 0.68f);
        [Tooltip("Models (optional, set by the builder): normal pigs / Heavy.")]
        public GameObject pigModel, hogModel;

        PigType type;
        bool hasType;
        Material material;

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
