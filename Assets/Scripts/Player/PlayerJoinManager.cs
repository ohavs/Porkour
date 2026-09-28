using UnityEngine;
using UnityEngine.InputSystem;

namespace Porkour
{
    /// <summary>
    /// Players join by pressing jump: Space = keyboard left (WASD), Right Ctrl / Num0 = keyboard right
    /// (arrows), A / Start = a gamepad. Each join spawns a Player + a pig at the next spawn point.
    /// Also draws a temporary dev HUD (join hint + P1/P2 labels over pigs).
    /// </summary>
    public class PlayerJoinManager : MonoBehaviour
    {
        public GameObject playerPrefab;
        public PigController pigPrefab;
        public Transform[] spawnPoints;
        [Range(1, 4)] public int maxPlayers = 4;
        public Color[] playerColors =
        {
            new(1f, 0.62f, 0.68f),   // pink
            new(0.85f, 0.6f, 0.42f),  // tan
            new(0.5f, 0.5f, 0.55f),   // grey
            new(1f, 0.92f, 0.82f),    // cream
        };

        InputAction joinAction;
        bool hasPendingJoin;
        string pendingScheme;
        InputDevice pendingDevice;
        GUIStyle hudStyle, labelStyle;

        void OnEnable()
        {
            joinAction = new InputAction("Join", InputActionType.Button);
            joinAction.AddBinding("<Keyboard>/space");
            joinAction.AddBinding("<Keyboard>/rightCtrl");
            joinAction.AddBinding("<Keyboard>/numpad0");
            joinAction.AddBinding("<Gamepad>/buttonSouth");
            joinAction.AddBinding("<Gamepad>/start");
            joinAction.performed += OnJoinPressed;
            joinAction.Enable();
        }

        void OnDisable()
        {
            joinAction.performed -= OnJoinPressed;
            joinAction.Dispose();
        }

        void OnJoinPressed(InputAction.CallbackContext ctx)
        {
            var device = ctx.control.device;
            string scheme = device switch
            {
                Keyboard => ctx.control.name == "space" ? "KeyboardLeft" : "KeyboardRight",
                Gamepad => "Gamepad",
                _ => null,
            };
            if (scheme == null) return;

            // Spawn in Update, not inside the input callback.
            hasPendingJoin = true;
            pendingScheme = scheme;
            pendingDevice = device;
        }

        void Update()
        {
            if (!hasPendingJoin) return;
            hasPendingJoin = false;
            if (PigPlayer.All.Count >= maxPlayers || IsTaken(pendingScheme, pendingDevice)) return;
            Join(pendingScheme, pendingDevice);
        }

        static bool IsTaken(string scheme, InputDevice device)
        {
            foreach (var p in PigPlayer.All)
                if (p.Scheme == scheme && p.Device == device) return true;
            return false;
        }

        void Join(string scheme, InputDevice device)
        {
            int index = PigPlayer.All.Count;
            var input = PlayerInput.Instantiate(playerPrefab, playerIndex: index, controlScheme: scheme, pairWithDevice: device);
            var player = input.GetComponent<PigPlayer>();
            player.Init(index, scheme, device);

            Transform spawn = spawnPoints != null && spawnPoints.Length > 0 ? spawnPoints[index % spawnPoints.Length] : transform;
            var pig = Instantiate(pigPrefab, spawn.position, spawn.rotation);
            pig.name = $"Pig P{index + 1}";
            if (pig.TryGetComponent(out PigLook look)) look.SetSkinColor(playerColors[index % playerColors.Length]);
            player.Possess(pig);
        }

        void OnGUI()
        {
            hudStyle ??= new GUIStyle(GUI.skin.label) { fontSize = 20, fontStyle = FontStyle.Bold };
            labelStyle ??= new GUIStyle(hudStyle) { alignment = TextAnchor.MiddleCenter };

            if (PigPlayer.All.Count < maxPlayers)
                GUI.Label(new Rect(16, 12, 900, 30),
                    $"Join: Space (WASD)  |  Right Ctrl (Arrows)  |  A / Start (Gamepad)      Players {PigPlayer.All.Count}/{maxPlayers}",
                    hudStyle);

            var cam = Camera.main;
            if (cam == null) return;
            foreach (var p in PigPlayer.All)
            {
                if (p.Pig == null) continue;
                Vector3 screen = cam.WorldToScreenPoint(p.Pig.transform.position + Vector3.up * 1.1f);
                if (screen.z < 0f) continue;
                GUI.Label(new Rect(screen.x - 40, Screen.height - screen.y - 15, 80, 30), $"P{p.Index + 1}", labelStyle);
            }
        }
    }
}
