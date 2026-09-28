using UnityEngine;

namespace Porkour
{
    /// <summary>Pig visuals. For now: recolours the skin parts (per player / later per pig type).</summary>
    public class PigLook : MonoBehaviour
    {
        public Renderer[] skin;

        public void SetSkinColor(Color color)
        {
            if (skin == null || skin.Length == 0) return;
            var mat = new Material(skin[0].sharedMaterial);
            mat.SetColor("_BaseColor", color);
            foreach (var r in skin) r.sharedMaterial = mat;
        }
    }
}
