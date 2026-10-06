using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.Rendering;
using UnityEngine.UI;

namespace Porkour
{
    /// <summary>
    /// Local player's on-screen hints (built from code; cartoon look = GameFonts + rounded UiShapes panels):
    /// marker over the thing you can grab, button prompt pill, throw charge bar, throw-arc preview,
    /// bottom-left: your pig type + its ability (key / cooldown / ammo), Armed's crosshair,
    /// top: round timer, Farmer Bob's Grill Call banner + announcements (pop in) + Bob's cage timer, top-left: the
    /// missions (required + bonus, steps), top-right: pigs grilled / escaped / team coins, centre: round intro (your role)
    /// and results (stars, coins, XP, level). Also picks the music mood and handles M (music on/off).
    /// </summary>
    [RequireComponent(typeof(NetPlayer))]
    public class PlayerHud : MonoBehaviour
    {
        [Tooltip("Material for the throw-arc line (set by the builder).")]
        public Material arcMaterial;
        public Color markerColor = new(1f, 0.85f, 0.2f);
        public Color chargeLowColor = new(1f, 0.9f, 0.2f);
        public Color chargeHighColor = new(1f, 0.25f, 0.15f);

        static readonly Color PanelColor = new(0.14f, 0.08f, 0.05f, 0.78f);
        static readonly Color OutlineColor = new(0.12f, 0.06f, 0.02f, 1f);
        static readonly Color Cream = new(1f, 0.96f, 0.86f);
        static readonly Color Accent = new(1f, 0.82f, 0.29f);
        const string KeyColor = "#FFD24A";

        const float BarWidth = 320f, BarHeight = 16f;
        const float CooldownWidth = 300f, CooldownHeight = 12f;
        const int ArcSteps = 60;
        const float ArcStepTime = 0.03f;

        NetPlayer player;
        Image marker, barBack, barFill, cooldownBack, cooldownFill, crosshair, typePanel, timerPanel, planPanel, statusPanel;
        readonly Image[] starImages = new Image[RoundManager.MaxStars];
        GameObject starRow;
        Text prompt, typeTitle, abilityLine, banner, message, timer, planTitle, plan, status, bigText, subText, cageText;
        GameObject promptPill, messagePill, subPanel, cagePill;
        CanvasGroup messageGroup;
        float messageStart = -10f, messageUntil, bigStart;
        string lastBig = "";
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

        void OnDestroy()
        {
            GameEvents.Announced -= OnAnnounced;
            MusicPlayer.SetMood(MusicMood.None);
        }

        void OnAnnounced(string text)
        {
            if (message == null) return;
            message.text = text;
            messageStart = Time.time;
            messageUntil = Time.time + 4f;
        }

        // ---------- building ----------

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
            var title = GameFonts.Title;
            var body = GameFonts.Body;

            marker = NewImage(root, "GrabMarker", markerColor, new Vector2(26f, 26f), UiShapes.Rounded);
            marker.rectTransform.localRotation = Quaternion.Euler(0f, 0f, 45f);
            AddOutline(marker.gameObject, 2f);

            // Throw charge bar + button prompt (bottom centre).
            barBack = UiShapes.Panel(root, "ChargeBar", PanelColor, new Vector2(BarWidth + 10f, BarHeight + 10f));
            Place(barBack.rectTransform, new Vector2(0.5f, 0f), new Vector2(0.5f, 0.5f), new Vector2(0f, 170f));
            barFill = UiShapes.Panel(barBack.transform, "Fill", chargeLowColor, new Vector2(0f, BarHeight));
            Place(barFill.rectTransform, new Vector2(0f, 0.5f), new Vector2(0f, 0.5f), new Vector2(5f, 0f));
            (promptPill, prompt) = Pill(root, "Prompt", body, 30, new Vector2(30f, 10f));
            Place((RectTransform)promptPill.transform, new Vector2(0.5f, 0f), new Vector2(0.5f, 0f), new Vector2(0f, 96f));

            // Pig type panel (bottom-left).
            typePanel = UiShapes.Panel(root, "TypePanel", PanelColor, new Vector2(640f, 132f));
            Place(typePanel.rectTransform, Vector2.zero, Vector2.zero, new Vector2(20f, 20f));
            typeTitle = NewText(typePanel.transform, "PigType", title, 46, TextAnchor.MiddleLeft, new Vector2(600f, 54f), true);
            Place(typeTitle.rectTransform, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(22f, -8f));
            abilityLine = NewText(typePanel.transform, "Ability", body, 23, TextAnchor.MiddleLeft, new Vector2(600f, 32f));
            Place(abilityLine.rectTransform, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(22f, -62f));
            cooldownBack = UiShapes.Panel(typePanel.transform, "Cooldown", new Color(0f, 0f, 0f, 0.5f), new Vector2(CooldownWidth + 6f, CooldownHeight + 6f));
            Place(cooldownBack.rectTransform, Vector2.zero, Vector2.zero, new Vector2(22f, 14f));
            cooldownFill = UiShapes.Panel(cooldownBack.transform, "Fill", Color.white, new Vector2(0f, CooldownHeight));
            Place(cooldownFill.rectTransform, new Vector2(0f, 0.5f), new Vector2(0f, 0.5f), new Vector2(3f, 0f));

            // Round timer, Grill Call banner, announcements (top centre).
            timerPanel = UiShapes.Panel(root, "TimerPanel", PanelColor, new Vector2(230f, 80f));
            Place(timerPanel.rectTransform, new Vector2(0.5f, 1f), new Vector2(0.5f, 1f), new Vector2(0f, -14f));
            timer = NewText(timerPanel.transform, "Timer", title, 60, TextAnchor.MiddleCenter, new Vector2(230f, 80f), true);
            Place(timer.rectTransform, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(0f, -2f));
            banner = NewText(root, "Banner", title, 44, TextAnchor.MiddleCenter, new Vector2(1500f, 60f), true);
            Place(banner.rectTransform, new Vector2(0.5f, 1f), new Vector2(0.5f, 0.5f), new Vector2(0f, -132f));
            (messagePill, message) = Pill(root, "Message", body, 28, new Vector2(28f, 8f));
            message.color = Cream;
            Place((RectTransform)messagePill.transform, new Vector2(0.5f, 1f), new Vector2(0.5f, 0.5f), new Vector2(0f, -190f));
            messageGroup = messagePill.AddComponent<CanvasGroup>();
            (cagePill, cageText) = Pill(root, "Cage", body, 27, new Vector2(26f, 8f));
            Place((RectTransform)cagePill.transform, new Vector2(0.5f, 1f), new Vector2(0.5f, 0.5f), new Vector2(0f, -248f));
            cagePill.GetComponent<Image>().color = new Color(0.45f, 0.08f, 0.04f, 0.85f);
            cagePill.SetActive(false);

            // Escape plan (top-left), grilled / escaped (top-right).
            planPanel = UiShapes.Panel(root, "PlanPanel", PanelColor, new Vector2(860f, 330f));
            Place(planPanel.rectTransform, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(16f, -16f));
            planTitle = NewText(planPanel.transform, "PlanTitle", title, 32, TextAnchor.MiddleLeft, new Vector2(760f, 40f), true);
            planTitle.color = Accent;
            planTitle.text = "MISSIONS";
            Place(planTitle.rectTransform, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(22f, -8f));
            plan = NewText(planPanel.transform, "Plan", body, 21, TextAnchor.UpperLeft, new Vector2(820f, 270f));
            plan.horizontalOverflow = HorizontalWrapMode.Wrap;
            plan.verticalOverflow = VerticalWrapMode.Overflow;
            plan.lineSpacing = 1.05f;
            Place(plan.rectTransform, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(22f, -52f));
            statusPanel = UiShapes.Panel(root, "StatusPanel", PanelColor, new Vector2(320f, 132f));
            Place(statusPanel.rectTransform, Vector2.one, Vector2.one, new Vector2(-16f, -16f));
            status = NewText(statusPanel.transform, "Status", body, 28, TextAnchor.MiddleRight, new Vector2(290f, 124f));
            status.lineSpacing = 1.1f;
            Place(status.rectTransform, new Vector2(1f, 0.5f), new Vector2(1f, 0.5f), new Vector2(-18f, 0f));

            // Round intro / results (centre).
            bigText = NewText(root, "Big", title, 96, TextAnchor.MiddleCenter, new Vector2(1800f, 120f), true);
            Place(bigText.rectTransform, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(0f, 225f));
            var sub = UiShapes.Panel(root, "SubPanel", PanelColor, new Vector2(1240f, 100f));
            Place(sub.rectTransform, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 1f), new Vector2(0f, 98f));
            var vertical = sub.gameObject.AddComponent<VerticalLayoutGroup>();
            vertical.padding = new RectOffset(36, 36, 20, 24);
            vertical.childControlWidth = vertical.childControlHeight = true;
            vertical.childForceExpandWidth = true;
            vertical.childForceExpandHeight = false;
            sub.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            subPanel = sub.gameObject;
            subText = NewText(sub.transform, "Sub", body, 30, TextAnchor.UpperCenter, Vector2.zero);
            subText.horizontalOverflow = HorizontalWrapMode.Wrap;
            subText.color = Cream;

            // Results stars (between the big title and the sub panel).
            starRow = new GameObject("Stars", typeof(RectTransform));
            starRow.transform.SetParent(root, false);
            Place((RectTransform)starRow.transform, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(0f, 140f));
            for (int i = 0; i < starImages.Length; i++)
            {
                starImages[i] = NewImage(starRow.transform, "Star", Color.white, new Vector2(64f, 64f), UiShapes.Star);
                starImages[i].rectTransform.anchoredPosition = new Vector2((i - (starImages.Length - 1) / 2f) * 76f, 0f);
                AddOutline(starImages[i].gameObject, 3f);
            }
            starRow.SetActive(false);

            crosshair = NewImage(root, "Crosshair", new Color(1f, 1f, 1f, 0.95f), new Vector2(12f, 12f), UiShapes.Circle);
            AddOutline(crosshair.gameObject, 1.5f);

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

        // ---------- every frame ----------

        void LateUpdate()
        {
            if (prompt == null) return;
            var pig = player.Pig;
            var net = pig != null ? pig.GetComponent<PigNet>() : null;
            var grabber = pig != null ? pig.Grabber : null;
            var cam = Camera.main;
            string grabKey = K(player.UsingGamepad ? "RT" : "Left Click");
            string jumpKey = K(player.UsingGamepad ? "A" : "Space");
            string abilityKey = K(player.UsingGamepad ? "LT" : "Right Click");

            Rigidbody target = null, held = null;
            string text = "";
            float charge = -1f;

            if (net != null && grabber != null)
            {
                held = net.Held;
                if (net.IsHeld)
                {
                    var bob = FarmerBob.Instance;
                    var cage = PigCage.Instance;
                    bool caged = cage != null && cage.IsSpawned && cage.TimeLeft(net.NetworkObjectId) >= 0f;
                    text = caged ? "You're in Bob's cage... your friends must open it!"
                        : bob != null && bob.CarriedPigId == net.NetworkObjectId
                        ? "Bob caught you! Wait for your friends to save you..."
                        : $"Mash {jumpKey} to break free!";
                    if (!caged && net.Type == PigType.Gassy && net.Ability != null && net.AbilityCooldownLeft <= 0f)
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
            if (promptPill.activeSelf != (text != "")) promptPill.SetActive(text != "");
            UpdateMarker(target, cam);
            UpdateChargeBar(charge);
            UpdateArc(charge >= 0f ? grabber : null, pig, held, charge);
            UpdateTypePanel(net, abilityKey);
            UpdateBobBanner(net);
            UpdateCage(net);
            UpdateRound(net, abilityKey);
            UpdateMessage();
            UpdateMusic();
            crosshair.enabled = net != null && net.Type == PigType.Armed && !net.IsHeld;
        }

        static string K(string key) => $"<color={KeyColor}>{key}</color>";

        /// <summary>Announcements pop in, then fade out.</summary>
        void UpdateMessage()
        {
            bool show = Time.time < messageUntil;
            if (messagePill.activeSelf != show) messagePill.SetActive(show);
            if (!show) return;
            messagePill.transform.localScale = Vector3.one * Pop(Time.time - messageStart);
            messageGroup.alpha = Mathf.Clamp01((messageUntil - Time.time) / 0.5f);
        }

        /// <summary>Wobbly scale for things that just appeared (1 = rest).</summary>
        static float Pop(float t) => t < 0f ? 1f : 1f + 0.3f * Mathf.Exp(-7f * t) * Mathf.Cos(18f * t);

        /// <summary>Music mood from the game state; M = music on/off.</summary>
        void UpdateMusic()
        {
            if (Keyboard.current != null && Keyboard.current.mKey.wasPressedThisFrame)
            {
                MusicPlayer.Muted = !MusicPlayer.Muted;
                OnAnnounced(MusicPlayer.Muted ? "Music off (M)" : "Music on (M)");
            }
            var round = RoundManager.Instance;
            var bob = FarmerBob.Instance;
            MusicMood mood;
            if (round != null && round.IsSpawned && round.IsOver) mood = MusicMood.None; // win/lose jingles play instead
            else if (round != null && round.IsSpawned && round.Phase == RoundPhase.Intro) mood = MusicMood.Theme;
            else if (bob == null || !bob.IsSpawned || bob.State is BobState.Away or BobState.Leaving) mood = MusicMood.Calm;
            else if (bob.FinalHunt) mood = MusicMood.FinalHunt;
            else if (bob.State is BobState.Chasing or BobState.Carrying) mood = MusicMood.Chase;
            else mood = MusicMood.Danger;
            MusicPlayer.SetMood(mood);
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
                        return box.channel == ChannelIds.Sabotage ? $"{abilityKey}: Belly Slam Bob's gas bottle!" : $"{abilityKey}: Belly Slam the fuse box!";
            var cage = PigCage.Instance;
            if (cage != null && cage.IsSpawned && cage.Count > 0)
            {
                if (Vector3.Distance(p, cage.DoorPoint) < cage.unlockRadius + 0.3f) return "Stay at the door - opening the cage...";
                if (net.Type == PigType.Heavy && Vector3.Distance(p, cage.transform.position) < 5f) return $"{abilityKey}: Belly Slam the cage open!";
            }
            return "";
        }

        /// <summary>Bob's cage: who's inside and how long until the grill is hot.</summary>
        void UpdateCage(PigNet net)
        {
            var cage = PigCage.Instance;
            float left = 0f;
            bool show = cage != null && cage.IsSpawned && cage.Soonest(out _, out left);
            if (cagePill.activeSelf != show) cagePill.SetActive(show);
            if (!show) return;
            float mine = net != null ? cage.TimeLeft(net.NetworkObjectId) : -1f;
            string clock = FormatClock(mine >= 0f ? mine : left);
            string opening = cage.UnlockProgress > 0f ? $"   <color=#8CFF7A>OPENING {Mathf.RoundToInt(cage.UnlockProgress * 100f)}%</color>" : "";
            cageText.text = mine >= 0f
                ? $"YOU'RE IN BOB'S CAGE! Grill hot in <color={KeyColor}>{clock}</color>{opening}"
                : $"{cage.Count} pig{(cage.Count > 1 ? "s" : "")} in Bob's CAGE (behind the barn)! Grill hot in <color={KeyColor}>{clock}</color>{opening}";
            float pulse = (mine >= 0f ? mine : left) < 20f ? 1f + 0.05f * Mathf.Sin(Time.time * 10f) : 1f;
            cagePill.transform.localScale = Vector3.one * pulse;
        }

        void UpdateRound(PigNet net, string abilityKey)
        {
            var round = RoundManager.Instance;
            bool show = round != null && round.IsSpawned;
            timerPanel.gameObject.SetActive(show);
            planPanel.gameObject.SetActive(show);
            statusPanel.gameObject.SetActive(show);
            string big = "";
            if (!show)
            {
                ShowCentre(big, "", Color.white);
                return;
            }

            // Timer (+ ticking in the last 10 seconds).
            float left = round.RoundTimeLeft;
            timer.text = FormatClock(left);
            timer.color = round.Phase == RoundPhase.Intro ? new Color(1f, 1f, 1f, 0.5f)
                : left <= 10f ? Color.Lerp(Color.white, new Color(1f, 0.25f, 0.1f), Mathf.PingPong(Time.time * 2f, 1f))
                : left <= 60f ? new Color(1f, 0.4f, 0.2f) : Color.white;
            int second = Mathf.CeilToInt(left);
            if (round.Phase == RoundPhase.Playing && left <= 10f && second != lastTickSecond && second > 0)
            {
                Sfx.PlayUi(Sound.Tick, 0.7f);
                timerPanel.transform.localScale = Vector3.one * 1.15f;
            }
            timerPanel.transform.localScale = Vector3.MoveTowards(timerPanel.transform.localScale, Vector3.one, Time.deltaTime);
            lastTickSecond = second;

            plan.text = MissionList(round);
            status.text = $"<color=#FF8A66>GRILLED  {round.Grills} / {round.maxGrills}</color>\n" +
                          $"<color=#8CFF7A>ESCAPED  {round.EscapedCount} / {Mathf.Max(1, round.PlayerCount)}</color>\n" +
                          $"<color={KeyColor}>COINS  {round.Coins}</color>";

            // Centre: intro (your role) / results.
            string sub = "";
            Color color = Color.white;
            switch (round.Phase)
            {
                case RoundPhase.Intro when net != null:
                {
                    var info = PigTypes.Info(net.Type);
                    big = $"YOU ARE THE {info.Name.ToUpperInvariant()} PIG!";
                    color = info.Color;
                    var level = SceneBuildInfo.Current;
                    string farm = level != null ? $"<color=#B9A58A>FARM {level.levelNumber}: {level.levelName.ToUpperInvariant()}</color>\n" : "";
                    sub = farm + RoleText(net.Type, abilityKey) +
                          "\n<color=#D8C6A8>Caught pigs end up in Bob's CAGE behind the barn (go through the PIG FLAP) - free them before the grill is hot! Grab coins for the shop.</color>" +
                          $"\n\n<color={KeyColor}>Break out, steal Bob's truck, get off his farm!  Starting in {Mathf.CeilToInt(round.PhaseTimeLeft)}</color>";
                    break;
                }
                case RoundPhase.Won:
                    big = "YOU ESCAPED!";
                    color = new Color(0.5f, 1f, 0.45f);
                    sub = $"Time {FormatClock(round.FinishTime)}   |   Pigs grilled {round.Grills}   |   Rescued {round.Rescues}" +
                          (round.LootCoins > 0 ? $"   |   Loot <color={KeyColor}>{round.LootCoins}</color>" : "") +
                          $"\n<color=#B9A58A>Stars: escaped, nobody grilled, under {FormatClock(round.starTime)}, both bonus missions</color>" +
                          Payout() + $"\n\nNext round in {Mathf.CeilToInt(round.PhaseTimeLeft)}";
                    break;
                case RoundPhase.Lost:
                    big = "BBQ TIME...";
                    color = new Color(1f, 0.45f, 0.25f);
                    sub = (round.Reason == LoseReason.Grilled ? $"Bob grilled {round.maxGrills} pigs." : "Time's up - Bob lit the BBQ.") +
                          " <color=#B9A58A>(you keep half of the coins)</color>" +
                          Payout() + $"\n\nNext round in {Mathf.CeilToInt(round.PhaseTimeLeft)}";
                    break;
            }
            ShowCentre(big, sub, color);
            UpdateStars(round);
        }

        /// <summary>Missions panel: required ones first, steps of an unfinished multi-step mission, bonus missions, what's next.</summary>
        static string MissionList(RoundManager round)
        {
            var sb = new System.Text.StringBuilder();
            for (int m = 0; m < RoundManager.Missions.Length; m++)
            {
                var mission = RoundManager.Missions[m];
                bool done = round.MissionDone(m);
                int steps = mission.Steps.Length, stepsDone = round.MissionStepsDone(m);
                string box = done ? "<color=#7CFF6B>[X]</color>" : steps > 1 ? $"<color=#FFD24A>[{stepsDone}/{steps}]</color>" : "[  ]";
                string tag = mission.Required ? "" : $"<color=#C9A0FF>BONUS +{mission.Coins}</color> ";
                if (done) sb.Append(box).Append(' ').Append(tag).Append($"<color=#A9C99A>{mission.Name}</color>\n");
                else if (steps == 1)
                    sb.Append(box).Append(' ').Append(tag).Append($"<color=#FFE9B0>{mission.Name}</color>: {RoundManager.Objectives[mission.Steps[0]].Hint}\n");
                else
                {
                    sb.Append(box).Append(' ').Append(tag).Append($"<color=#FFE9B0>{mission.Name}</color>\n");
                    foreach (int step in mission.Steps)
                    {
                        var o = RoundManager.Objectives[step];
                        round.ObjectiveProgress(step, out int d, out int total);
                        string mark = d == total ? "<color=#7CFF6B>v</color>" : total > 1 ? $"<color=#FFD24A>{d}/{total}</color>" : "-";
                        sb.Append("      ").Append(mark).Append(' ')
                          .Append(d == total ? $"<color=#A9C99A>{o.Name}</color>" : $"{o.Name}: <color=#D8C6A8>{o.Hint}</color>").Append('\n');
                    }
                }
            }
            sb.Append(round.RequiredDone ? "<color=#7CFF6B>ALL SET - everyone jump into the truck!</color>"
                : round.CanEscape ? "<color=#FFD24A>Truck ready, gate open - finish the barn missions, then into the truck!</color>"
                : "<color=#B9A58A>Then: everyone into the getaway truck</color>");
            return sb.ToString();
        }

        /// <summary>This PC's reward line for the results screen (coins + XP saved by PlayerProgress).</summary>
        static string Payout() =>
            $"\n<color={KeyColor}>+{PlayerProgress.LastCoins} coins   +{PlayerProgress.LastXp} XP</color>   " +
            $"<color=#B9A58A>(you have {PlayerProgress.Coins} coins - level {PlayerProgress.Level} - the shop opens soon!)</color>";

        void UpdateStars(RoundManager round)
        {
            bool show = round.Phase == RoundPhase.Won;
            if (starRow.activeSelf != show) starRow.SetActive(show);
            if (!show) return;
            float t = Time.time - bigStart;
            for (int i = 0; i < starImages.Length; i++)
            {
                bool earned = i < round.Stars;
                starImages[i].color = earned ? Accent : new Color(0.25f, 0.2f, 0.15f, 0.8f);
                float appear = t - 0.4f - i * 0.25f; // pop in one after another
                starImages[i].transform.localScale = Vector3.one * (appear < 0f ? 0f : earned ? Pop(appear) : 1f);
            }
        }

        void ShowCentre(string big, string sub, Color color)
        {
            if (big != lastBig)
            {
                lastBig = big;
                bigStart = Time.time;
            }
            bool show = big != "";
            bigText.enabled = show;
            if (subPanel.activeSelf != show) subPanel.SetActive(show);
            if (!show) return;
            bigText.text = big;
            bigText.color = color;
            bigText.transform.localScale = Vector3.one * Pop(Time.time - bigStart);
            subText.text = sub;
        }

        static string RoleText(PigType type, string abilityKey) => type switch
        {
            PigType.Gassy => $"{abilityKey}: Rocket Fart - blast up to the hayloft and fart into the GENERATOR to start the gate motor. " +
                             "Your green smoke blinds Bob! (every fart makes you a bit slimmer)",
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
            var spot = HideSpot.Find(p);
            if (spot != null) return spot.hint;
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
            var color = new Color(1f, 0.38f, 0.22f);
            int size = 44;
            bool pulse = false;
            bool playing = round == null || !round.IsSpawned || round.IsPlaying;
            if (bob != null && bob.IsSpawned && playing)
            {
                ulong me = net != null ? net.NetworkObjectId : ulong.MaxValue;
                int left = Mathf.CeilToInt(bob.StateTimeLeft);
                switch (bob.State)
                {
                    case BobState.Away:
                        text = $"Next Grill Call in {FormatTime(bob.NextCallIn)}";
                        color = new Color(1f, 0.96f, 0.86f, 0.9f);
                        size = 28;
                        break;
                    case BobState.Coming:
                        text = left > 0 ? $"GRILL CALL! HIDE!  {left}" : "GRILL CALL! Bob is here!";
                        pulse = true;
                        break;
                    case BobState.Searching:
                        text = bob.FinalHunt ? "FINAL HUNT - Bob won't leave!" : $"Bob is searching the barn...  {left}";
                        color = new Color(1f, 0.66f, 0.22f);
                        pulse = bob.FinalHunt;
                        break;
                    case BobState.Investigating:
                        text = "Bob is checking a noise...";
                        color = Accent;
                        break;
                    case BobState.Chasing:
                        bool mine = bob.TargetPigId == me;
                        text = mine ? "BOB SEES YOU! RUN!" : "Bob is chasing a pig!";
                        pulse = mine;
                        break;
                    case BobState.Carrying:
                        string countdown = left > 0 ? $"  {left}" : "";
                        text = bob.CarriedPigId == me ? $"Bob caught you!{countdown}" : $"RESCUE! Hit Bob or throw a chicken at him!{countdown}";
                        pulse = true;
                        break;
                    case BobState.Stunned:
                        text = "Bob is stunned!";
                        color = Accent;
                        break;
                    case BobState.Leaving:
                        text = "Bob is going back to his grill";
                        color = new Color(1f, 0.96f, 0.86f, 0.9f);
                        size = 32;
                        break;
                }
            }
            banner.text = text;
            banner.color = color;
            banner.fontSize = size;
            banner.transform.localScale = Vector3.one * (pulse ? 1f + 0.06f * Mathf.Sin(Time.time * 10f) : 1f);
        }

        static string FormatTime(float seconds)
        {
            int s = Mathf.CeilToInt(seconds);
            return s >= 60 ? $"{s / 60}:{s % 60:00}" : $"{s}s";
        }

        void UpdateTypePanel(PigNet net, string abilityKey)
        {
            bool show = net != null;
            if (typePanel.gameObject.activeSelf != show) typePanel.gameObject.SetActive(show);
            if (!show) return;
            float left = net.Ability != null ? net.AbilityCooldownLeft : 0f;
            cooldownBack.enabled = cooldownFill.enabled = left > 0f;

            var info = PigTypes.Info(net.Type);
            typeTitle.text = $"{info.Name.ToUpperInvariant()} PIG";
            typeTitle.color = info.Color;
            typePanel.color = Color.Lerp(PanelColor, new Color(info.Color.r * 0.35f, info.Color.g * 0.35f, info.Color.b * 0.35f, 0.82f), 0.5f);
            string charges = net.AbilityCharges >= 0 ? $"   <color={KeyColor}>Ammo {net.AbilityCharges}/{net.Ability.MaxCharges}</color>" : "";
            if (net.Ability == null) abilityLine.text = $"{info.AbilityName} - coming soon";
            else if (left > 0f && net.Ability.cooldown >= 1.5f) abilityLine.text = $"{info.AbilityName}  {FormatTime(left)}{charges}";
            else abilityLine.text = (string.IsNullOrEmpty(net.Ability.Hint)
                ? $"{abilityKey}: {info.AbilityName}"
                : $"{abilityKey}: {info.AbilityName}  <color=#D8C6A8>({net.Ability.Hint})</color>") + charges;

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
            if (barBack.gameObject.activeSelf != show) barBack.gameObject.SetActive(show);
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

        // ---------- helpers ----------

        static Text NewText(Transform parent, string name, Font font, int fontSize, TextAnchor alignment, Vector2 size, bool title = false)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var text = go.AddComponent<Text>();
            text.font = font;
            text.fontSize = fontSize;
            text.alignment = alignment;
            text.color = Color.white;
            text.raycastTarget = false;
            text.supportRichText = true;
            text.horizontalOverflow = HorizontalWrapMode.Overflow;
            text.rectTransform.sizeDelta = size;
            var outline = go.AddComponent<Outline>(); // outline first, then the drop shadow copies it
            outline.effectColor = OutlineColor;
            outline.effectDistance = title ? new Vector2(3f, -3f) : new Vector2(2f, -2f);
            if (title)
            {
                var shadow = go.AddComponent<Shadow>();
                shadow.effectColor = new Color(0f, 0f, 0f, 0.45f);
                shadow.effectDistance = new Vector2(0f, -5f);
            }
            return text;
        }

        /// <summary>Rounded panel that grows to fit its one line of text.</summary>
        static (GameObject panel, Text text) Pill(Transform parent, string name, Font font, int fontSize, Vector2 padding)
        {
            var panel = UiShapes.Panel(parent, name, PanelColor, Vector2.zero);
            var layout = panel.gameObject.AddComponent<HorizontalLayoutGroup>();
            layout.padding = new RectOffset((int)padding.x, (int)padding.x, (int)padding.y, (int)padding.y);
            layout.childAlignment = TextAnchor.MiddleCenter;
            layout.childControlWidth = layout.childControlHeight = true;
            layout.childForceExpandWidth = layout.childForceExpandHeight = false;
            var fitter = panel.gameObject.AddComponent<ContentSizeFitter>();
            fitter.horizontalFit = fitter.verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            var text = NewText(panel.transform, "Text", font, fontSize, TextAnchor.MiddleCenter, Vector2.zero);
            return (panel.gameObject, text);
        }

        static Image NewImage(Transform parent, string name, Color color, Vector2 size, Sprite sprite = null)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var img = go.AddComponent<Image>();
            img.sprite = sprite;
            img.color = color;
            img.raycastTarget = false;
            img.rectTransform.sizeDelta = size;
            return img;
        }

        static void AddOutline(GameObject go, float distance)
        {
            var outline = go.AddComponent<Outline>();
            outline.effectColor = OutlineColor;
            outline.effectDistance = new Vector2(distance, -distance);
        }

        static void Place(RectTransform rect, Vector2 anchor, Vector2 pivot, Vector2 position)
        {
            rect.anchorMin = rect.anchorMax = anchor;
            rect.pivot = pivot;
            rect.anchoredPosition = position;
        }
    }
}
