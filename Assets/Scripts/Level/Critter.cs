using Unity.Netcode;
using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Barn animal (chicken, sheep): wanders around, runs (and hops) away from pigs that come close, gets back on its
    /// feet after being thrown. Server moves it; every PC plays its cluck/baa when it runs.
    /// Still a normal grabbable prop - and Bait for Farmer Bob.
    /// </summary>
    [RequireComponent(typeof(Rigidbody))]
    public class Critter : MonoBehaviour
    {
        public float walkSpeed = 1.2f;
        public float fleeSpeed = 3.5f;
        public float fleeRadius = 2.5f;
        [Tooltip("0 = never hops.")]
        public float hopSpeed = 2.5f;
        public float groundCheck = 0.45f;
        public Sound voice = Sound.Cluck;
        public float voiceVolume = 0.6f;

        Rigidbody rb;
        NetworkObject net;
        Bait bait;
        Vector3 home, wanderDir, lastPos;
        Quaternion homeRotation;
        float nextDecision, nextHop, nextVoice;

        void Awake()
        {
            rb = GetComponent<Rigidbody>();
            net = GetComponent<NetworkObject>();
            bait = GetComponent<Bait>();
            home = transform.position;
            homeRotation = transform.rotation;
            lastPos = transform.position;
            nextVoice = Time.time + Random.Range(3f, 10f);
        }

        bool Simulating => net != null && net.IsSpawned && net.NetworkManager != null && net.NetworkManager.IsServer;

        void FixedUpdate()
        {
            if (!Simulating || rb.isKinematic || !rb.useGravity) return; // carried by a pig / Bob
            if (rb.position.y < -10f) { GoHome(); return; }

            bool grounded = Physics.Raycast(rb.position + Vector3.up * 0.1f, Vector3.down, groundCheck, ~0, QueryTriggerInteraction.Ignore);
            if (!grounded) return;

            Vector3 dir = Vector3.zero;
            float speed = walkSpeed;
            bool fleeing = false;
            float best = fleeRadius;
            foreach (var pig in PigController.All)
            {
                Vector3 away = rb.position - pig.Body.position;
                away.y = 0f;
                if (away.magnitude >= best) continue;
                best = away.magnitude;
                dir = away.sqrMagnitude > 0.001f ? away.normalized : Random.insideUnitSphere;
                fleeing = true;
            }
            if (fleeing) speed = fleeSpeed;
            else
            {
                if (Time.time >= nextDecision)
                {
                    nextDecision = Time.time + Random.Range(1.5f, 4f);
                    Vector2 r = Random.insideUnitCircle;
                    wanderDir = Random.value < 0.35f ? Vector3.zero : new Vector3(r.x, 0f, r.y).normalized; // sometimes just stand
                }
                dir = wanderDir;
            }
            dir.y = 0f;

            Vector3 v = rb.linearVelocity;
            Vector3 flat = Vector3.MoveTowards(new Vector3(v.x, 0f, v.z), dir.normalized * speed, 12f * Time.fixedDeltaTime);
            float vy = v.y;
            if (fleeing && hopSpeed > 0f && Time.time >= nextHop)
            {
                nextHop = Time.time + Random.Range(0.4f, 0.9f);
                vy = hopSpeed;
            }
            rb.linearVelocity = new Vector3(flat.x, vy, flat.z);

            // Back on its feet, facing where it goes.
            Vector3 face = flat.sqrMagnitude > 0.05f ? flat : Vector3.ProjectOnPlane(transform.forward, Vector3.up);
            if (face.sqrMagnitude < 0.001f) face = Vector3.forward;
            rb.angularVelocity = Vector3.Lerp(rb.angularVelocity, Vector3.zero, 0.3f);
            rb.MoveRotation(Quaternion.Slerp(rb.rotation, Quaternion.LookRotation(face.normalized, Vector3.up), 0.15f));
        }

        void GoHome()
        {
            if (bait != null) { bait.ReturnHome(); return; }
            rb.linearVelocity = Vector3.zero;
            rb.angularVelocity = Vector3.zero;
            rb.position = home;
            rb.rotation = homeRotation;
            transform.SetPositionAndRotation(home, homeRotation);
        }

        void Update()
        {
            // Every PC: speed from the (synced) position.
            float dt = Time.deltaTime;
            if (dt <= 0f) return;
            Vector3 p = transform.position;
            float speed = new Vector3(p.x - lastPos.x, 0f, p.z - lastPos.z).magnitude / dt;
            lastPos = p;
            bool running = speed > 2.2f && speed < 30f; // only when it runs away - no idle chatter
            if (!running || Time.time < nextVoice) return;
            nextVoice = Time.time + Random.Range(5f, 9f);
            Sfx.Play(voice, p, voiceVolume, 0.12f);
        }
    }
}
