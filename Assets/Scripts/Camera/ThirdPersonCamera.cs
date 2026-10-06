using UnityEngine;
using UnityEngine.InputSystem;

namespace Porkour
{
    /// <summary>
    /// Orbit camera behind the local player's pig (target set by the local NetPlayer). Mouse / right stick rotates it,
    /// it pulls in when a wall is between it and the pig (not for CameraPassThrough beams/posts).
    /// Esc frees the cursor, click locks it again. Shake(...) for slams, zaps and other big moments.
    /// </summary>
    public class ThirdPersonCamera : MonoBehaviour
    {
        static ThirdPersonCamera instance;

        public Transform target;
        public Vector3 pivotOffset = new(0f, 1f, 0f);
        public float distance = 5f;
        public float minPitch = -25f;
        public float maxPitch = 70f;
        [Tooltip("Degrees per mouse pixel.")]
        public float mouseSensitivity = 0.12f;
        [Tooltip("Degrees per second at full stick.")]
        public float stickSpeed = 200f;
        public bool invertY;
        public float collisionRadius = 0.25f;
        public LayerMask collisionLayers = ~0;

        float yaw, pitch = 20f, trauma;
        Vector2 lookInput;
        bool lookFromMouse;
        bool hadTarget;

        void Awake() => instance = this;

        /// <summary>Shake the local camera; strength fades with distance from the camera's pig (0..1 ≈ small..big).</summary>
        public static void Shake(Vector3 at, float strength, float range = 14f)
        {
            if (instance == null || instance.target == null) return;
            float falloff = 1f - Mathf.Clamp01(Vector3.Distance(at, instance.target.position) / range);
            instance.trauma = Mathf.Clamp01(instance.trauma + strength * falloff);
        }

        /// <summary>Called every frame by the local NetPlayer.</summary>
        public void SetLookInput(Vector2 look, bool fromMouse)
        {
            lookInput = look;
            lookFromMouse = fromMouse;
        }

        public void SetTarget(Transform newTarget)
        {
            bool first = target == null;
            target = newTarget;
            if (target == null) { LockCursor(false); return; }
            if (first) yaw = target.eulerAngles.y;
            LockCursor(true);
        }

        void LateUpdate()
        {
            if (target == null) // menu / pig gone: give the cursor back once
            {
                if (hadTarget) LockCursor(false);
                hadTarget = false;
                return;
            }
            hadTarget = true;
            UpdateCursorLock();

            Vector2 delta = lookFromMouse ? lookInput * mouseSensitivity : lookInput * (stickSpeed * Time.deltaTime);
            if (Cursor.lockState != CursorLockMode.Locked && lookFromMouse) delta = Vector2.zero;
            yaw += delta.x;
            pitch = Mathf.Clamp(pitch + (invertY ? delta.y : -delta.y), minPitch, maxPitch);

            Quaternion rotation = Quaternion.Euler(pitch, yaw, 0f);
            Vector3 pivot = target.position + pivotOffset;
            Vector3 back = rotation * Vector3.back;
            float dist = distance;

            // Pull in on static geometry only (ignore pigs and other physics objects).
            foreach (var hit in Physics.SphereCastAll(pivot, collisionRadius, back, distance, collisionLayers, QueryTriggerInteraction.Ignore))
                if (hit.rigidbody == null && hit.distance > 0f && hit.distance < dist
                    && hit.collider.GetComponent<CameraPassThrough>() == null) dist = hit.distance;

            // Shake: random wobble that fades out quickly.
            trauma = Mathf.MoveTowards(trauma, 0f, Time.deltaTime * 1.6f);
            float shake = trauma * trauma;
            float time = Time.time * 25f;
            Quaternion wobble = Quaternion.Euler((Mathf.PerlinNoise(time, 0f) - 0.5f) * 6f * shake,
                (Mathf.PerlinNoise(0f, time) - 0.5f) * 6f * shake, (Mathf.PerlinNoise(time, time) - 0.5f) * 8f * shake);

            transform.SetPositionAndRotation(pivot + back * dist, rotation * wobble);
        }

        static void UpdateCursorLock()
        {
            if (Keyboard.current != null && Keyboard.current.escapeKey.wasPressedThisFrame) LockCursor(false);
            else if (Mouse.current != null && Mouse.current.leftButton.wasPressedThisFrame) LockCursor(true);
        }

        static void LockCursor(bool locked)
        {
            Cursor.lockState = locked ? CursorLockMode.Locked : CursorLockMode.None;
            Cursor.visible = !locked;
        }
    }
}
