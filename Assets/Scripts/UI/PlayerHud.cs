using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.Rendering;
using UnityEngine.UI;

namespace Porkour
{
    /// <summary>
    /// Local player's on-screen hints (built from code, placeholder look):
    /// marker over the thing you can grab, button prompt, throw charge bar and a throw-arc preview.
    /// </summary>
    [RequireComponent(typeof(PigPlayer))]
    public class PlayerHud : MonoBehaviour
    {
        [Tooltip("Material for the throw-arc line (set by the builder).")]
        public Material arcMaterial;
        public Color markerColor = new(1f, 0.85f, 0.2f);
        public Color chargeLowColor = new(1f, 0.9f, 0.2f);
        public Color chargeHighColor = new(1f, 0.25f, 0.15f);

        const float BarWidth = 320f, BarHeight = 18f;
        const int ArcSteps = 60;
        const float ArcStepTime = 0.03f;

        PigPlayer player;
        PlayerInput input;
        Image marker, barBack, barFill;
        Text prompt;
        LineRenderer arc;
        readonly Vector3[] arcPoints = new Vector3[ArcSteps + 1];

        void Awake()
        {
            player = GetComponent<PigPlayer>();
            input = GetComponent<PlayerInput>();
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

            var textGo = new GameObject("Prompt", typeof(RectTransform));
            textGo.transform.SetParent(root, false);
            prompt = textGo.AddComponent<Text>();
            prompt.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            prompt.fontSize = 30;
            prompt.fontStyle = FontStyle.Bold;
            prompt.alignment = TextAnchor.MiddleCenter;
            prompt.color = Color.white;
            prompt.rectTransform.sizeDelta = new Vector2(900f, 50f);
            PlaceBottom(prompt.rectTransform, 105f);
            textGo.AddComponent<Outline>().effectDistance = new Vector2(2f, -2f);

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
            var pig = player.Pig;
            var grabber = pig != null ? pig.Grabber : null;
            var cam = Camera.main;
            string grabKey = input.currentControlScheme == "Gamepad" ? "RT" : "Left Click";
            string jumpKey = input.currentControlScheme == "Gamepad" ? "A" : "Space";

            Rigidbody target = null;
            string text = "";
            bool charging = false;

            if (pig != null && pig.IsHeld)
                text = $"Mash {jumpKey} to break free!";
            else if (grabber != null && grabber.IsHolding)
            {
                charging = grabber.IsCharging;
                text = charging ? "Release to throw" : $"{grabKey}: throw  (hold = stronger)";
            }
            else if (grabber != null)
            {
                target = grabber.FindGrabTarget();
                if (target != null) text = $"{grabKey}: grab";
            }

            prompt.text = text;
            UpdateMarker(target, cam);
            UpdateChargeBar(charging ? grabber.Charge : -1f);
            UpdateArc(charging ? grabber : null, pig);
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
        void UpdateArc(PigGrabber grabber, PigController carrier)
        {
            if (arc == null) return;
            if (grabber == null) { arc.positionCount = 0; return; }

            var held = grabber.Held;
            Vector3 pos = held.position;
            Vector3 vel = grabber.PredictThrowVelocity(grabber.Charge);
            float fallMul = grabber.HeldFallGravityMultiplier;
            float drag = grabber.HeldAirDrag;
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
    }
}
