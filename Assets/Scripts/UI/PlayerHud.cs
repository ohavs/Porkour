using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.UI;

namespace Porkour
{
    /// <summary>
    /// Local player's on-screen hints (built from code, placeholder look):
    /// marker over the thing you can grab, button prompt, throw charge bar, throw-arc preview,
    /// and bottom-left: your pig type + its ability (key / cooldown).
    /// </summary>
    [RequireComponent(typeof(NetPlayer))]
    public class PlayerHud : MonoBehaviour
    {
        [Tooltip("Material for the throw-arc line (set by the builder).")]
        public Material arcMaterial;
        public Color markerColor = new(1f, 0.85f, 0.2f);
        public Color chargeLowColor = new(1f, 0.9f, 0.2f);
        public Color chargeHighColor = new(1f, 0.25f, 0.15f);

        const float BarWidth = 320f, BarHeight = 18f;
        const float CooldownWidth = 260f, CooldownHeight = 10f;
        const int ArcSteps = 60;
        const float ArcStepTime = 0.03f;

        NetPlayer player;
        Image marker, barBack, barFill, cooldownBack, cooldownFill;
        Text prompt, typeTitle, abilityLine;
        LineRenderer arc;
        readonly Vector3[] arcPoints = new Vector3[ArcSteps + 1];

        // Added at runtime by the owning NetPlayer only; Start (not Awake) so arcMaterial is already set.
        void Start()
        {
            player = GetComponent<NetPlayer>();
            BuildUi();
        }

        void BuildUi()
        {
            var canvasGo = new GameObject("HUD", typeof(Canvas), typeof(CanvasScaler));
            canvasGo.transform.SetParent(transform, false);
            canvasGo.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = canvasGo.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1920f, 1080f);
            scaler.matchWidthOrHeight = 0.5f;
            var root = canvasGo.transform;

            marker = NewImage(root, "GrabMarker", markerColor, new Vector2(22f, 22f));
            marker.rectTransform.localRotation = Quaternion.Euler(0f, 0f, 45f);

            barBack = NewImage(root, "ChargeBar", new Color(0f, 0f, 0f, 0.6f), new Vector2(BarWidth + 6f, BarHeight + 6f));
            PlaceBottom(barBack.rectTransform, 150f);
            barFill = NewImage(barBack.transform, "Fill", chargeLowColor, new Vector2(0f, BarHeight));
            var fillRect = barFill.rectTransform;
            fillRect.anchorMin = fillRect.anchorMax = fillRect.pivot = new Vector2(0f, 0.5f);
            fillRect.anchoredPosition = new Vector2(3f, 0f);

            prompt = NewText(root, "Prompt", 30, TextAnchor.MiddleCenter, new Vector2(900f, 50f));
            PlaceBottom(prompt.rectTransform, 105f);

            // Pig type panel (bottom-left).
            typeTitle = NewText(root, "PigType", 40, TextAnchor.MiddleLeft, new Vector2(600f, 46f));
            PlaceBottomLeft(typeTitle.rectTransform, 40f, 96f);
            abilityLine = NewText(root, "Ability", 26, TextAnchor.MiddleLeft, new Vector2(600f, 32f));
            PlaceBottomLeft(abilityLine.rectTransform, 40f, 58f);
            cooldownBack = NewImage(root, "AbilityCooldown", new Color(0f, 0f, 0f, 0.6f), new Vector2(CooldownWidth + 4f, CooldownHeight + 4f));
            PlaceBottomLeft(cooldownBack.rectTransform, 40f, 32f);
            cooldownFill = NewImage(cooldownBack.transform, "Fill", Color.white, new Vector2(0f, CooldownHeight));
            var cdRect = cooldownFill.rectTransform;
            cdRect.anchorMin = cdRect.anchorMax = cdRect.pivot = new Vector2(0f, 0.5f);
            cdRect.anchoredPosition = new Vector2(2f, 0f);

            if (arcMaterial == null)
            {
                var shader = Shader.Find("Universal Render Pipeline/Unlit");
                if (shader != null)
                {
                    arcMaterial = new Material(shader);
                    arcMaterial.SetColor("_BaseColor", markerColor);
                }
            }
            if (arcMaterial != null)
            {
                arc = new GameObject("ThrowArc").AddComponent<LineRenderer>();
                arc.transform.SetParent(transform, false);
                arc.sharedMaterial = arcMaterial;
                arc.widthMultiplier = 0.07f;
                arc.numCapVertices = 4;
                arc.shadowCastingMode = ShadowCastingMode.Off;
                arc.receiveShadows = false;
                arc.positionCount = 0;
            }
        }

        void LateUpdate()
        {
            if (prompt == null) return;
            var pig = player.Pig;
            var net = pig != null ? pig.GetComponent<PigNet>() : null;
            var grabber = pig != null ? pig.Grabber : null;
            var cam = Camera.main;
            string grabKey = player.UsingGamepad ? "RT" : "Left Click";
            string jumpKey = player.UsingGamepad ? "A" : "Space";
            string abilityKey = player.UsingGamepad ? "LT" : "Right Click";

            Rigidbody target = null, held = null;
            string text = "";
            float charge = -1f;

            if (net != null && grabber != null)
            {
                held = net.Held;
                if (net.IsHeld)
                    text = net.Type == PigType.Gassy && net.Ability != null && net.AbilityCooldownLeft <= 0f
                        ? $"Mash {jumpKey} to break free!  or  {abilityKey}: fart out!"
                        : $"Mash {jumpKey} to break free!";
                else if (held != null)
                {
                    if (net.IsCharging) charge = net.Charge;
                    text = charge >= 0f ? "Release to throw" : $"{grabKey}: throw  (hold = stronger)";
                }
                else
                {
                    target = grabber.FindGrabTarget();
                    if (target != null) text = $"{grabKey}: grab";
                }
            }

            prompt.text = text;
            UpdateMarker(target, cam);
            UpdateChargeBar(charge);
            UpdateArc(charge >= 0f ? grabber : null, pig, held, charge);
            UpdateTypePanel(net, abilityKey);
        }

        void UpdateTypePanel(PigNet net, string abilityKey)
        {
            bool show = net != null;
            typeTitle.enabled = abilityLine.enabled = show;
            float left = show && net.Ability != null ? net.AbilityCooldownLeft : 0f;
            cooldownBack.enabled = cooldownFill.enabled = left > 0f;
            if (!show) return;

            var info = PigTypes.Info(net.Type);
            typeTitle.text = $"{info.Name.ToUpperInvariant()} PIG";
            typeTitle.color = info.Color;
            if (net.Ability == null) abilityLine.text = $"{info.AbilityName} - coming soon";
            else if (left > 0f) abilityLine.text = $"{info.AbilityName}  {left:0.0}s";
            else abilityLine.text = string.IsNullOrEmpty(net.Ability.Hint)
                ? $"{abilityKey}: {info.AbilityName}"
                : $"{abilityKey}: {info.AbilityName}  ({net.Ability.Hint})";

            if (left <= 0f) return;
            float ready = 1f - Mathf.Clamp01(left / Mathf.Max(0.01f, net.Ability.cooldown));
            cooldownFill.rectTransform.sizeDelta = new Vector2(CooldownWidth * ready, CooldownHeight);
            cooldownFill.color = info.Color;
        }

        void UpdateMarker(Rigidbody target, Camera cam)
        {
            bool show = target != null && cam != null;
            if (show)
            {
                var bounds = new Bounds(target.worldCenterOfMass, Vector3.zero);
                foreach (var c in target.GetComponentsInChildren<Collider>()) bounds.Encapsulate(c.bounds);
                float bob = Mathf.Sin(Time.time * 6f) * 0.08f;
                Vector3 screen = cam.WorldToScreenPoint(new Vector3(bounds.center.x, bounds.max.y + 0.45f + bob, bounds.center.z));
                show = screen.z > 0f;
                if (show) marker.rectTransform.position = new Vector3(screen.x, screen.y, 0f);
            }
            marker.enabled = show;
        }

        void UpdateChargeBar(float charge)
        {
            bool show = charge >= 0f;
            barBack.enabled = barFill.enabled = show;
            if (!show) return;
            barFill.rectTransform.sizeDelta = new Vector2(BarWidth * charge, BarHeight);
            barFill.color = Color.Lerp(chargeLowColor, chargeHighColor, charge);
        }

        /// <summary>Simulate the throw (same gravity rules as the load) and draw it until it hits something.</summary>
        void UpdateArc(PigGrabber grabber, PigController carrier, Rigidbody held, float charge)
        {
            if (arc == null) return;
            if (grabber == null || held == null) { arc.positionCount = 0; return; }

            Vector3 pos = held.position;
            Vector3 vel = grabber.PredictThrowVelocity(charge, held);
            bool heldIsPig = held.TryGetComponent(out PigController heldPig);
            float fallMul = heldIsPig ? heldPig.fallGravityMultiplier : 1f;
            float drag = heldIsPig ? heldPig.airDrag : 0f;
            int count = 0;
            arcPoints[count++] = pos;
            for (int i = 0; i < ArcSteps; i++)
            {
                Vector3 g = Physics.gravity * (vel.y < 0f ? fallMul : 1f);
                vel += g * ArcStepTime;
                if (drag > 0f)
                {
                    var h = Vector3.MoveTowards(new Vector3(vel.x, 0f, vel.z), Vector3.zero, drag * ArcStepTime);
                    vel = new Vector3(h.x, vel.y, h.z);
                }
                Vector3 next = pos + vel * ArcStepTime;
                if (Physics.Linecast(pos, next, out RaycastHit hit, ~0, QueryTriggerInteraction.Ignore)
                    && hit.rigidbody != held && hit.rigidbody != carrier.Body)
                {
                    arcPoints[count++] = hit.point;
                    break;
                }
                arcPoints[count++] = next;
                pos = next;
            }
            arc.positionCount = count;
            for (int i = 0; i < count; i++) arc.SetPosition(i, arcPoints[i]);
        }

        static Text NewText(Transform parent, string name, int fontSize, TextAnchor alignment, Vector2 size)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var text = go.AddComponent<Text>();
            text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            text.fontSize = fontSize;
            text.fontStyle = FontStyle.Bold;
            text.alignment = alignment;
            text.color = Color.white;
            text.raycastTarget = false;
            text.horizontalOverflow = HorizontalWrapMode.Overflow;
            text.rectTransform.sizeDelta = size;
            go.AddComponent<Outline>().effectDistance = new Vector2(2f, -2f);
            return text;
        }

        static Image NewImage(Transform parent, string name, Color color, Vector2 size)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var img = go.AddComponent<Image>();
            img.color = color;
            img.raycastTarget = false;
            img.rectTransform.sizeDelta = size;
            return img;
        }

        static void PlaceBottom(RectTransform rect, float y)
        {
            rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 0f);
            rect.pivot = new Vector2(0.5f, 0.5f);
            rect.anchoredPosition = new Vector2(0f, y);
        }

        static void PlaceBottomLeft(RectTransform rect, float x, float y)
        {
            rect.anchorMin = rect.anchorMax = Vector2.zero;
            rect.pivot = new Vector2(0f, 0.5f);
            rect.anchoredPosition = new Vector2(x, y);
        }
    }
}
