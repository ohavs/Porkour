using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// The game's fonts (Assets/Resources/Fonts): TitleFont = Luckiest Guy (big cartoon titles, timer, signs),
    /// BodyFont = Fredoka SemiBold (readable lines). Replace the .ttf files to change the look; falls back to
    /// Unity's built-in font if they're missing. Also makes 3D text (TextMesh) with a drop shadow.
    /// </summary>
    public static class GameFonts
    {
        static Font title, body, fallback;

        public static Font Title => title != null ? title : title = Load("Fonts/TitleFont");
        public static Font Body => body != null ? body : body = Load("Fonts/BodyFont");

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => title = body = fallback = null;

        static Font Load(string path)
        {
            var font = Resources.Load<Font>(path);
            if (font != null) return font;
            return fallback != null ? fallback : fallback = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        }

        /// <summary>3D text in the title font (labels, Bob's speech), with a dark shadow behind it.</summary>
        public static TextMesh CreateTextMesh(Transform parent, string name, float characterSize, Color color, bool shadow = true)
        {
            var font = Title;
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshRenderer>().sharedMaterial = font.material;
            var text = go.AddComponent<TextMesh>();
            text.font = font;
            text.fontSize = 64;
            text.characterSize = characterSize;
            text.anchor = TextAnchor.MiddleCenter;
            text.alignment = TextAlignment.Center;
            text.color = color;
            if (shadow) go.AddComponent<TextMeshShadow>();
            return text;
        }
    }
}
