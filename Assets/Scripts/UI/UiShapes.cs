using UnityEngine;
using UnityEngine.UI;

namespace Porkour
{
    /// <summary>Rounded-rectangle / circle sprites drawn from code for HUD panels (until a UI pack is imported).</summary>
    public static class UiShapes
    {
        static Sprite rounded, circle, star;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => rounded = circle = star = null;

        /// <summary>White five-pointed star.</summary>
        public static Sprite Star => star != null ? star : star = MakeStar(128);

        static Sprite MakeStar(int size)
        {
            var tex = new Texture2D(size, size, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
            var pixels = new Color32[size * size];
            var points = new Vector2[10];
            for (int i = 0; i < 10; i++)
            {
                float angle = Mathf.PI / 2f + i * Mathf.PI / 5f;
                float r = (i % 2 == 0 ? 0.48f : 0.2f) * size;
                points[i] = new Vector2(size / 2f + Mathf.Cos(angle) * r, size / 2f + Mathf.Sin(angle) * r - size * 0.03f);
            }
            for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++)
            {
                // 4x supersampling of "inside the polygon" for a soft edge.
                int hits = 0;
                for (int s = 0; s < 4; s++)
                    if (Inside(points, new Vector2(x + 0.25f + (s % 2) * 0.5f, y + 0.25f + (s / 2) * 0.5f))) hits++;
                pixels[y * size + x] = new Color32(255, 255, 255, (byte)(hits * 63.75f));
            }
            tex.SetPixels32(pixels);
            tex.Apply();
            return Sprite.Create(tex, new Rect(0, 0, size, size), new Vector2(0.5f, 0.5f), 100f);
        }

        static bool Inside(Vector2[] poly, Vector2 p)
        {
            bool inside = false;
            for (int i = 0, j = poly.Length - 1; i < poly.Length; j = i++)
                if ((poly[i].y > p.y) != (poly[j].y > p.y) &&
                    p.x < (poly[j].x - poly[i].x) * (p.y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x)
                    inside = !inside;
            return inside;
        }

        /// <summary>White rounded rectangle, 9-sliced (use Image.Type.Sliced).</summary>
        public static Sprite Rounded => rounded != null ? rounded : rounded = Make(64, 22f, true);

        /// <summary>White disc.</summary>
        public static Sprite Circle => circle != null ? circle : circle = Make(64, 32f, false);

        static Sprite Make(int size, float radius, bool sliced)
        {
            var tex = new Texture2D(size, size, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
            var pixels = new Color32[size * size];
            float half = size / 2f;
            for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++)
            {
                // Distance outside the rounded box (negative = inside), 1-pixel soft edge.
                float px = Mathf.Abs(x + 0.5f - half) - (half - radius);
                float py = Mathf.Abs(y + 0.5f - half) - (half - radius);
                float outside = new Vector2(Mathf.Max(px, 0f), Mathf.Max(py, 0f)).magnitude + Mathf.Min(Mathf.Max(px, py), 0f) - radius;
                byte a = (byte)(Mathf.Clamp01(0.5f - outside) * 255f);
                pixels[y * size + x] = new Color32(255, 255, 255, a);
            }
            tex.SetPixels32(pixels);
            tex.Apply();
            float border = sliced ? radius : 0f;
            return Sprite.Create(tex, new Rect(0, 0, size, size), new Vector2(0.5f, 0.5f), 100f, 0, SpriteMeshType.FullRect,
                new Vector4(border, border, border, border));
        }

        /// <summary>Rounded panel image.</summary>
        public static Image Panel(Transform parent, string name, Color color, Vector2 size)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var img = go.AddComponent<Image>();
            img.sprite = Rounded;
            img.type = Image.Type.Sliced;
            img.color = color;
            img.raycastTarget = false;
            img.rectTransform.sizeDelta = size;
            return img;
        }
    }
}
