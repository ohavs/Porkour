using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Text floating in the level ("TOOL SHED", "FREEDOM!"), built at runtime from the built-in font (local only).
    /// Fixed labels read correctly when looking along the object's forward; billboard labels always face the camera.
    /// </summary>
    public class WorldLabel : MonoBehaviour
    {
        [TextArea] public string text = "Label";
        public Color color = Color.white;
        public float characterSize = 0.08f;
        public bool billboard;

        TextMesh mesh;

        void Awake()
        {
            var font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            if (font == null) return;
            var go = new GameObject("Text");
            go.transform.SetParent(transform, false);
            go.AddComponent<MeshRenderer>().sharedMaterial = font.material;
            mesh = go.AddComponent<TextMesh>();
            mesh.font = font;
            mesh.fontSize = 64;
            mesh.characterSize = characterSize;
            mesh.fontStyle = FontStyle.Bold;
            mesh.anchor = TextAnchor.MiddleCenter;
            mesh.alignment = TextAlignment.Center;
            mesh.color = color;
            mesh.text = text;
        }

        /// <summary>Change the text at runtime (e.g. lamp state).</summary>
        public void Set(string newText, Color newColor)
        {
            if (mesh == null) return;
            mesh.text = newText;
            mesh.color = newColor;
        }

        void LateUpdate()
        {
            if (!billboard || mesh == null) return;
            var cam = Camera.main;
            if (cam != null) mesh.transform.rotation = Quaternion.LookRotation(mesh.transform.position - cam.transform.position);
        }
    }
}
