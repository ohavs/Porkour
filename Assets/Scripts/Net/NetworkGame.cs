using System.Collections;
using System.Collections.Generic;
using Unity.AI.Navigation;
using Unity.Netcode;
using Unity.Netcode.Transports.UTP;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Starts/joins a game and runs the server side of the session:
    /// spawns the round manager and the level's networked objects (pigs get random, different types), a NetPlayer per
    /// connected PC, and gives each a free pig. RestartRound respawns the whole level for a fresh round.
    /// In the editor it starts automatically: main editor = Host, Multiplayer Play Mode virtual players = Client
    /// (and if the port is already taken it falls back to Client). In builds it shows a Host / Join menu.
    /// </summary>
    [RequireComponent(typeof(NetworkManager))]
    public class NetworkGame : MonoBehaviour
    {
        [Tooltip("Spawned once per connected PC. All networked prefabs are registered in the NetworkManager's prefab list (set by the builder).")]
        public GameObject playerPrefab;
        [Tooltip("RoundManager prefab, spawned once when the server starts (set by the builder).")]
        public GameObject roundPrefab;
        public NetSpawnPoint[] spawnPoints;
        [Tooltip("Baked on the server when a game starts (Farmer Bob walks on it). Set by the builder.")]
        public NavMeshSurface navMesh;
        public ushort port = 7777;
        public bool autoStartInEditor = true;

        NetworkManager nm;
        UnityTransport transport;
        string address = "127.0.0.1";
        string status = "";
        bool levelSpawned;
        GUIStyle bigStyle, statusStyle;

        static bool IsVirtualPlayer => Application.dataPath.Replace('\\', '/').Contains("/Library/VP/");

        void Awake()
        {
            Application.runInBackground = true; // the host must keep simulating while its window is unfocused
            nm = GetComponent<NetworkManager>();
            transport = GetComponent<UnityTransport>();
        }

        void Start()
        {
            nm.OnServerStarted += OnServerStarted;
            nm.OnServerStopped += OnServerStopped;
            nm.OnClientConnectedCallback += OnClientConnected;
            nm.OnClientDisconnectCallback += OnClientDisconnected;

#if UNITY_EDITOR
            if (autoStartInEditor)
            {
                if (IsVirtualPlayer) StartClient();
                else StartHostOrJoin();
            }
#endif
        }

        void OnDestroy()
        {
            if (nm == null) return;
            nm.OnServerStarted -= OnServerStarted;
            nm.OnServerStopped -= OnServerStopped;
            nm.OnClientConnectedCallback -= OnClientConnected;
            nm.OnClientDisconnectCallback -= OnClientDisconnected;
        }

        // ---------- start ----------

        public void StartHostOrJoin()
        {
            transport.SetConnectionData("127.0.0.1", port, "0.0.0.0");
            if (nm.StartHost()) { status = "Host"; return; }
            StartCoroutine(JoinAfterShutdown()); // port busy → someone on this PC already hosts
        }

        IEnumerator JoinAfterShutdown()
        {
            nm.Shutdown();
            while (nm.ShutdownInProgress) yield return null;
            StartClient();
        }

        public void StartHost()
        {
            transport.SetConnectionData("127.0.0.1", port, "0.0.0.0");
            status = nm.StartHost() ? "Host" : "Could not host (port busy?)";
        }

        public void StartClient()
        {
            transport.SetConnectionData(address, port);
            status = nm.StartClient() ? $"Joining {address}..." : "Could not start client";
        }

        // ---------- server ----------

        void OnServerStarted() => EnsureLevelSpawned();

        void OnServerStopped(bool wasHost) => levelSpawned = false;

        void EnsureLevelSpawned()
        {
            if (levelSpawned || !nm.IsServer) return;
            levelSpawned = true;
            if (navMesh != null) navMesh.BuildNavMesh(); // only static level geometry (children of the surface)
            if (roundPrefab != null && RoundManager.Instance == null)
                Instantiate(roundPrefab).GetComponent<NetworkObject>().Spawn();
            SpawnLevelObjects();
            if (RoundManager.Instance != null) RoundManager.Instance.BeginRound();
        }

        /// <summary>Server: new round - despawn everything except players and the round manager, spawn the level again,
        /// give every player a pig (types are shuffled again).</summary>
        public void RestartRound()
        {
            if (!nm.IsServer) return;
            foreach (var player in NetPlayer.All) player.AssignPig(null);
            var old = new List<NetworkObject>();
            foreach (var obj in nm.SpawnManager.SpawnedObjectsList)
                if (!obj.IsPlayerObject && obj.GetComponent<RoundManager>() == null) old.Add(obj);
            foreach (var obj in old)
                if (obj != null && obj.IsSpawned) obj.Despawn(true);
            PuzzleSignals.Clear();
            SpawnLevelObjects();
            foreach (var player in NetPlayer.All) player.AssignPig(NetPlayer.FindFreePig());
            if (RoundManager.Instance != null) RoundManager.Instance.BeginRound();
        }

        void SpawnLevelObjects()
        {
            var types = PigTypes.Shuffled();
            int pigCount = 0;
            foreach (var point in spawnPoints)
            {
                if (point == null || point.prefab == null) continue;
                var go = Instantiate(point.prefab, point.transform.position, point.transform.rotation);
                if (go.TryGetComponent(out PigNet pigNet)) pigNet.initialType = types[pigCount++ % types.Length];
                if (go.TryGetComponent(out Breakable breakable)) breakable.contents = point.contents;
                foreach (var part in go.GetComponents<IPuzzleChannel>()) part.Channel = point.channel;
                go.GetComponent<NetworkObject>().Spawn();
            }
        }

        void OnClientConnected(ulong clientId)
        {
            if (nm.IsServer)
            {
                EnsureLevelSpawned();
                var player = Instantiate(playerPrefab).GetComponent<NetPlayer>();
                player.GetComponent<NetworkObject>().SpawnAsPlayerObject(clientId);
                player.AssignPig(NetPlayer.FindFreePig());
            }
            if (clientId == nm.LocalClientId) status = nm.IsHost ? "Host" : "Client";
        }

        void OnClientDisconnected(ulong clientId)
        {
            if (!nm.IsServer && clientId == nm.LocalClientId) status = "Disconnected";
        }

        // ---------- temporary menu / status (real UI later) ----------

        void OnGUI()
        {
            bigStyle ??= new GUIStyle(GUI.skin.button) { fontSize = 22 };
            statusStyle ??= new GUIStyle(GUI.skin.label) { alignment = TextAnchor.LowerRight };
            bool running = nm.IsServer || nm.IsClient;

            if (running) // bottom-right, out of the HUD's way
            {
                string players = nm.IsServer ? $"  |  players {nm.ConnectedClientsIds.Count}/4" : "";
                string debug = nm.IsHost ? "  |  G: Grill Call now  |  R: restart round" : "";
                GUI.Label(new Rect(Screen.width - 912, Screen.height - 30, 900, 24), $"{status}{players}  |  Tab / Y: switch pig{debug}", statusStyle);
                return;
            }

            var area = new Rect(Screen.width / 2f - 170, Screen.height / 2f - 110, 340, 220);
            GUILayout.BeginArea(area, GUI.skin.box);
            GUILayout.Label("PORKOUR");
            if (GUILayout.Button("Host", bigStyle, GUILayout.Height(44))) StartHost();
            GUILayout.Space(8);
            GUILayout.Label("Host IP:");
            address = GUILayout.TextField(address);
            if (GUILayout.Button("Join", bigStyle, GUILayout.Height(44))) StartClient();
            if (!string.IsNullOrEmpty(status)) GUILayout.Label(status);
            GUILayout.EndArea();
        }
    }
}
