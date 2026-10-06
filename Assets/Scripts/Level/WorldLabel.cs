using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Text floating in the level, built at runtime in the game's title font (local only). Fixed labels read correctly when
    /// looking along the object's forward; billboard labels always face the camera. Shown only when the camera is near
    /// (showDistance) so the screen isn't full of text.
    /// </summary>
    public class WorldLabel : MonoBehaviour
    {
        [TextArea] public string text = "Label";
        public Color color = Color.white;
        public float characterSize = 0.08f;
        public bool billboard;
        [Tooltip("Visible only within this distance of the camera (0 = always).")]
        public float showDistance = 14f;

        TextMesh mesh;

        void Awake()
        {
            mesh = GameFonts.CreateTextMesh(transform, "Text", characterSize, color);
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
            var cam = Camera.main;
            if (mesh == null || cam == null) return;
            bool show = showDistance <= 0f || (cam.transform.position - transform.position).sqrMagnitude < showDistance * showDistance;
            if (mesh.gameObject.activeSelf != show) mesh.gameObject.SetActive(show);
            if (show && billboard) mesh.transform.rotation = Quaternion.LookRotation(mesh.transform.position - cam.transform.position);
        }
    }
}
