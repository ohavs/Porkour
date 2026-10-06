using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.UI;

namespace Porkour
{
    /// <summary>
    /// Local player's on-screen hints (built from code, placeholder look):
    /// marker over the thing you can grab, button prompt, throw charge bar, throw-arc preview,
    /// bottom-left: your pig type + its ability (key / cooldown / ammo), Armed's crosshair,
    /// top: round timer, Farmer Bob's Grill Call banner + announcements, top-left: the escape plan checklist,
    /// top-right: pigs grilled / escaped, centre: round intro (your role) and results.
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
        Image marker, barBack, barFill, cooldownBack, cooldownFill, crosshair, planBack;
        Text prompt, typeTitle, abilityLine, banner, message, timer, plan, status, bigText, subText;
        float messageUntil;
        int lastTickSecond = -1;
        LineRenderer arc;
        readonly Vector3[] arcPoints = new Vector3[ArcSteps + 1];

        // Added at runtime by the owning NetPlayer only; Start (not Awake) so arcMaterial is already set.
        void Start()
        {
            player = GetComponent<NetPlayer>();
            BuildUi();
            GameEvents.Announced += OnAnnounced;
        }

        void OnDestroy() => GameEvents.Announced -= OnAnnounced;

        void OnAnnounced(string text)
        {
            if (message == null) return;
            message.text = text;
            messageUntil = Time.time + 4f;
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

            // Round timer, Grill Call banner + announcements (top), Armed's crosshair (centre).
            timer = NewText(root, "Timer", 54, TextAnchor.MiddleCenter, new Vector2(400f, 64f));
            PlaceTop(timer.rectTransform, -42f);
            banner = NewText(root, "Banner", 42, TextAnchor.MiddleCenter, new Vector2(1400f, 60f));
            PlaceTop(banner.rectTransform, -105f);
            message = NewText(root, "Message", 30, TextAnchor.MiddleCenter, new Vector2(1400f, 44f));
            PlaceTop(message.rectTransform, -158f);
            message.color = new Color(1f, 0.95f, 0.6f);

            // Escape plan (top-left), grilled / escaped (top-right).
            planBack = NewImage(root, "PlanBack", new Color(0f, 0f, 0f, 0.4f), new Vector2(780f, 196f));
            PlaceTopLeft(planBack.rectTransform, 16f, -16f);
            plan = NewText(root, "Plan", 21, TextAnchor.UpperLeft, new Vector2(760f, 190f));
            plan.horizontalOverflow = HorizontalWrapMode.Wrap;
            plan.verticalOverflow = VerticalWrapMode.Overflow;
            PlaceTopLeft(plan.rectTransform, 28f, -24f);
            status = NewText(root, "Status", 28, TextAnchor.UpperRight, new Vector2(500f, 90f));
            status.rectTransform.anchorMin = status.rectTransform.anchorMax = status.rectTransform.pivot = new Vector2(1f, 1f);
            status.rectTransform.anchoredPosition = new Vector2(-28f, -24f);

            // Round intro / results (centre).
            bigText = NewText(root, "Big", 72, TextAnchor.MiddleCenter, new Vector2(1600f, 90f));
            PlaceCentre(bigText.rectTransform, 170f);
            subText = NewText(root, "Sub", 30, TextAnchor.UpperCenter, new Vector2(1200f, 200f));
            subText.horizontalOverflow = HorizontalWrapMode.Wrap;
            subText.verticalOverflow = VerticalWrapMode.Overflow;
            PlaceCentre(subText.rectTransform, 20f);
            crosshair = NewImage(root, "Crosshair", new Color(1f, 1f, 1f, 0.9f), new Vector2(8f, 8f));

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
                {
                    var bob = FarmerBob.Instance;
                    text = bob != null && bob.CarriedPigId == net.NetworkObjectId
                        ? "Bob caught you! Wait for your friends to save you..."
                        : $"Mash {jumpKey} to break free!";
                    if (net.Type == PigType.Gassy && net.Ability != null && net.AbilityCooldownLeft <= 0f)
                        text += $"  or  {abilityKey}: fart out!";
                }
                else if (held != null && held.TryGetComponent(out Wearable _))
                {
                    if (net.IsCharging) charge = net.Charge;
                    string hidden = HiddenHint(pig, net);
                    text = charge >= 0f ? "Release to throw the bucket" : hidden != "" ? hidden : $"{grabKey}: take the bucket off";
                }
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
                if (text == "" && !net.IsHeld)
                {
                    var climbable = Climbable.Find(pig.transform.position);
                    if (climbable != null && pig.transform.position.y - 0.45f < climbable.Top - 0.3f)
                        text = $"Hold {jumpKey} (or walk into it): climb";
                }
                if (text == "" && !net.IsHeld) text = ContextHint(net, abilityKey);
                if (text == "" && !net.IsHeld) text = HiddenHint(pig, net);
                if (text == "" && net.IsEscaped) text = "You escaped! Wait in the truck - or go back and help your friends";
            }

            prompt.text = text;
            UpdateMarker(target, cam);
            UpdateChargeBar(charge);
            UpdateArc(charge >= 0f ? grabber : null, pig, held, charge);
            UpdateTypePanel(net, abilityKey);
            UpdateBobBanner(net);
            UpdateRound(net, abilityKey);
            crosshair.enabled = net != null && net.Type == PigType.Armed && !net.IsHeld;
            message.enabled = Time.time < messageUntil;
        }

        /// <summary>"Press X here" hints next to the things only your pig type can do.</summary>
        string ContextHint(PigNet net, string abilityKey)
        {
            Vector3 p = net.transform.position;
            if (net.Type == PigType.Gassy)
                foreach (var gen in FartSwitch.All)
                    if (gen.IsSpawned && !gen.IsRunning && Vector3.Distance(p, gen.transform.position) < 3.5f)
                        return $"{abilityKey}: fart into the generator!";
            if (net.Type == PigType.Heavy)
                foreach (var box in Breakable.All)
                    if (box.channel != 0 && box.IsSpawned && !box.IsBroken && Vector3.Distance(p, box.transform.position) < 4f)
                        return $"{abilityKey}: Belly Slam the fuse box!";
            return "";
        }

        void UpdateRound(PigNet net, string abilityKey)
        {
            var round = RoundManager.Instance;
            bool show = round != null && round.IsSpawned;
            timer.enabled = plan.enabled = planBack.enabled = status.enabled = show;
            bigText.enabled = subText.enabled = false;
            if (!show) return;

            // Timer (+ ticking in the last 10 seconds).
            float left = round.RoundTimeLeft;
            timer.text = FormatClock(left);
            timer.color = round.Phase == RoundPhase.Intro ? new Color(1f, 1f, 1f, 0.5f)
                : left <= 10f ? Color.Lerp(Color.white, new Color(1f, 0.2f, 0.1f), Mathf.PingPong(Time.time * 2f, 1f))
                : left <= 60f ? new Color(1f, 0.35f, 0.2f) : Color.white;
            int second = Mathf.CeilToInt(left);
            if (round.Phase == RoundPhase.Playing && left <= 10f && second != lastTickSecond && second > 0)
                Sfx.PlayUi(Sound.Tick, 0.7f);
            lastTickSecond = second;

            // Escape plan checklist.
            var sb = new System.Text.StringBuilder("<b>ESCAPE PLAN</b>  <size=18>(lamps over the exit)</size>\n");
            for (int i = 0; i < RoundManager.Objectives.Length; i++)
            {
                var o = RoundManager.Objectives[i];
                round.ObjectiveProgress(i, out int done, out int total);
                string box = done == total ? "<color=#66ff66>[X]</color>" : total > 1 ? $"<color=#ffd040>[{done}/{total}]</color>" : "[  ]";
                string line = done == total ? $"<color=#99cc99>{o.Name}</color>" : $"<b>{o.Name}</b>: {o.Hint}";
                sb.Append(box).Append(' ').Append(line).Append('\n');
            }
            sb.Append(round.AllObjectivesDone ? "<color=#66ff66><b>EXIT OPEN - everyone into the getaway truck!</b></color>"
                : "<color=#aaaaaa>Then: everyone into the getaway truck outside</color>");
            plan.text = sb.ToString();

            status.text = $"<color=#ff7755>GRILLED  {round.Grills} / {round.maxGrills}</color>\n" +
                          $"<color=#77ff77>ESCAPED  {round.EscapedCount} / {Mathf.Max(1, round.PlayerCount)}</color>";

            // Centre: intro (your role) / results.
            switch (round.Phase)
            {
                case RoundPhase.Intro when net != null:
                {
                    var info = PigTypes.Info(net.Type);
                    bigText.enabled = subText.enabled = true;
                    bigText.text = $"YOU ARE THE {info.Name.ToUpperInvariant()} PIG";
                    bigText.color = info.Color;
                    subText.text = RoleText(net.Type, abilityKey) +
                                   $"\n\n<color=#ffd040>Escape the barn before Bob's BBQ!  Starting in {Mathf.CeilToInt(round.PhaseTimeLeft)}</color>";
                    break;
                }
                case RoundPhase.Won:
                    bigText.enabled = subText.enabled = true;
                    bigText.text = "YOU ESCAPED!";
                    bigText.color = new Color(0.45f, 1f, 0.45f);
                    subText.text = $"Time {FormatClock(round.FinishTime)}   |   Pigs grilled {round.Grills}\n\nNext round in {Mathf.CeilToInt(round.PhaseTimeLeft)}";
                    break;
                case RoundPhase.Lost:
                    bigText.enabled = subText.enabled = true;
                    bigText.text = "BBQ TIME...";
                    bigText.color = new Color(1f, 0.4f, 0.25f);
                    subText.text = (round.Reason == LoseReason.Grilled
                                       ? $"Bob grilled {round.maxGrills} pigs."
                                       : "Time's up - Bob lit the BBQ.") +
                                   $"\n\nNext round in {Mathf.CeilToInt(round.PhaseTimeLeft)}";
                    break;
            }
        }

        static string RoleText(PigType type, string abilityKey) => type switch
        {
            PigType.Gassy => $"{abilityKey}: Rocket Fart - blast up to the hayloft and fart into the GENERATOR to start the gate motor. " +
                             "Your green smoke blinds Bob!",
            PigType.Jumpy => "Jump at walls to wall-bounce and grab ledges: get onto the ROOF BEAMS, grab the KEY and throw it down. " +
                             $"{abilityKey} at an edge: drop a rope ladder for your friends!",
            PigType.Heavy => $"{abilityKey}: Belly Slam - smash the rotten boards of the TOOL SHED, then the FUSE BOX that powers the electric fence. " +
                             "Friends can bounce high off your back!",
            PigType.Armed => $"Hold {abilityKey} to suck up apples & corn, tap to shoot. Hit the 3 BULLSEYES (walls, up high). " +
                             "Your shots stun Bob!",
            _ => "",
        };

        static string FormatClock(float seconds)
        {
            int s = Mathf.Max(0, Mathf.CeilToInt(seconds));
            return $"{s / 60}:{s % 60:00}";
        }

        /// <summary>While Bob is in the barn: tell the player when he can't see them.</summary>
        string HiddenHint(PigController pig, PigNet net)
        {
            var bob = FarmerBob.Instance;
            if (bob == null || bob.State == BobState.Away || bob.State == BobState.Leaving || net.IsEscaped) return "";
            Vector3 p = pig.transform.position;
            if (HideSpot.IsHidden(p)) return "Hidden in the hay";
            var held = net.Held;
            if (held != null && held.TryGetComponent(out Wearable _))
                return player.IdleTime >= 0.4f ? "Hidden under the bucket - don't move!" : "A walking bucket... Bob may notice up close";
            if (SmokeCloud.InSmoke(p)) return "Hidden in the smoke";
            if (player.IdleTime >= bob.freezeTime) return "Frozen - Bob won't notice you unless he's very close";
            return "";
        }

        void UpdateBobBanner(PigNet net)
        {
            var bob = FarmerBob.Instance;
            var round = RoundManager.Instance;
            string text = "";
            var color = new Color(1f, 0.35f, 0.2f);
            int size = 42;
            bool playing = round == null || !round.IsSpawned || round.IsPlaying;
            if (bob != null && bob.IsSpawned && playing)
            {
                ulong me = net != null ? net.NetworkObjectId : ulong.MaxValue;
                int left = Mathf.CeilToInt(bob.StateTimeLeft);
                switch (bob.State)
                {
                    case BobState.Away:
                        text = $"Next Grill Call in {FormatTime(bob.NextCallIn)}";
                        color = new Color(1f, 1f, 1f, 0.85f);
                        size = 26;
                        break;
                    case BobState.Coming:
                        text = left > 0 ? $"GRILL CALL! HIDE!  {left}" : "GRILL CALL! Bob is here!";
                        break;
                    case BobState.Searching:
                        text = bob.FinalHunt ? "FINAL HUNT - Bob won't leave!" : $"Bob is searching the barn...  {left}";
                        color = new Color(1f, 0.65f, 0.2f);
                        break;
                    case BobState.Investigating:
                        text = "Bob is checking a noise...";
                        color = new Color(1f, 0.85f, 0.2f);
                        break;
                    case BobState.Chasing:
                        text = bob.TargetPigId == me ? "BOB SEES YOU! RUN!" : "Bob is chasing a pig!";
                        break;
                    case BobState.Carrying:
                        text = bob.CarriedPigId == me ? $"Bob caught you!  {left}" : $"RESCUE! Hit Bob or throw a chicken at him!  {left}";
                        break;
                    case BobState.Stunned:
                        text = "Bob is stunned!";
                        color = new Color(1f, 0.9f, 0.2f);
                        break;
                    case BobState.Leaving:
                        text = "Bob is going back to his grill";
                        color = new Color(1f, 1f, 1f, 0.85f);
                        size = 30;
                        break;
                }
            }
            banner.text = text;
            banner.color = color;
            banner.fontSize = size;
        }

        static string FormatTime(float seconds)
        {
            int s = Mathf.CeilToInt(seconds);
            return s >= 60 ? $"{s / 60}:{s % 60:00}" : $"{s}s";
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
            string charges = net.AbilityCharges >= 0 ? $"   Ammo {net.AbilityCharges}/{net.Ability.MaxCharges}" : "";
            if (net.Ability == null) abilityLine.text = $"{info.AbilityName} - coming soon";
            else if (left > 0f && net.Ability.cooldown >= 1.5f) abilityLine.text = $"{info.AbilityName}  {FormatTime(left)}{charges}";
            else abilityLine.text = (string.IsNullOrEmpty(net.Ability.Hint)
                ? $"{abilityKey}: {info.AbilityName}"
                : $"{abilityKey}: {info.AbilityName}  ({net.Ability.Hint})") + charges;

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

        static void PlaceTop(RectTransform rect, float y)
        {
            rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 1f);
            rect.pivot = new Vector2(0.5f, 0.5f);
            rect.anchoredPosition = new Vector2(0f, y);
        }

        static void PlaceCentre(RectTransform rect, float y)
        {
            rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 0.5f);
            rect.pivot = new Vector2(0.5f, 0.5f);
            rect.anchoredPosition = new Vector2(0f, y);
        }

        static void PlaceTopLeft(RectTransform rect, float x, float y)
        {
            rect.anchorMin = rect.anchorMax = rect.pivot = new Vector2(0f, 1f);
            rect.anchoredPosition = new Vector2(x, y);
        }

        static void PlaceBottomLeft(RectTransform rect, float x, float y)
        {
            rect.anchorMin = rect.anchorMax = Vector2.zero;
            rect.pivot = new Vector2(0f, 0.5f);
            rect.anchoredPosition = new Vector2(x, y);
        }
    }
}
