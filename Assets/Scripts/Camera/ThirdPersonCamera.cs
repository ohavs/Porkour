using UnityEngine;
using UnityEngine.InputSystem;

namespace Porkour
{
    /// <summary>
    /// Orbit camera behind the local player's pig. Mouse / right stick rotates it,
    /// it pulls in when a wall is between it and the pig. Esc frees the cursor, click locks it again.
    /// </summary>
    public class ThirdPersonCamera : MonoBehaviour
    {
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

        float yaw, pitch = 20f;
        Vector2 lookInput;
        bool lookFromMouse;

        /// <summary>Called every frame by the local PigPlayer.</summary>
        public void SetLookInput(Vector2 look, bool fromMouse)
        {
            lookInput = look;
            lookFromMouse = fromMouse;
        }

        public void SetTarget(Transform newTarget)
        {
            target = newTarget;
            if (target != null) yaw = target.eulerAngles.y;
        }

        void Start() => LockCursor(true);

        void LateUpdate()
        {
            UpdateCursorLock();
            if (target == null) return;

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
                if (hit.rigidbody == null && hit.distance > 0f && hit.distance < dist) dist = hit.distance;

            transform.SetPositionAndRotation(pivot + back * dist, rotation);
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
