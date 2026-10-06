using UnityEngine;

namespace Porkour
{
    /// <summary>Dark copy of a TextMesh, a little behind and below it, so 3D text reads on any background.</summary>
    [RequireComponent(typeof(TextMesh))]
    public class TextMeshShadow : MonoBehaviour
    {
        public Color shadowColor = new(0.12f, 0.07f, 0.04f, 0.85f);

        TextMesh source, shadow;

        void Start()
        {
            source = GetComponent<TextMesh>();
            var go = new GameObject("Shadow");
            go.transform.SetParent(transform, false);
            float offset = source.characterSize * 0.9f;
            go.transform.localPosition = new Vector3(offset, -offset, offset); // +z = away from the viewer
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = source.font != null ? source.font.material : null;
            r.sortingOrder = GetComponent<MeshRenderer>().sortingOrder - 1; // drawn before the text
            shadow = go.AddComponent<TextMesh>();
            shadow.font = source.font;
            shadow.fontSize = source.fontSize;
            shadow.characterSize = source.characterSize;
            shadow.anchor = source.anchor;
            shadow.alignment = source.alignment;
            shadow.fontStyle = source.fontStyle;
        }

        void LateUpdate()
        {
            if (shadow == null) return;
            shadow.text = source.text;
            shadow.characterSize = source.characterSize;
            var c = shadowColor;
            c.a *= source.color.a;
            shadow.color = c;
        }
    }
}
