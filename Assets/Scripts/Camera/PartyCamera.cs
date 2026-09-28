using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Shared camera (one screen for all players - that's what Remote Play Together streams).
    /// Follows the centre of all pigs at a fixed angle and zooms out as they spread apart.
    /// </summary>
    public class PartyCamera : MonoBehaviour
    {
        public float pitch = 55f;
        public float yaw;
        public float minDistance = 13f;
        public float maxDistance = 28f;
        [Tooltip("Extra distance per metre the pigs are spread apart.")]
        public float spreadZoom = 1.1f;
        public float smoothTime = 0.25f;
        public Vector3 lookOffset = new(0f, 0.5f, 0f);

        Vector3 focus, focusVelocity;
        float distance, distanceVelocity;
        bool snapped;

        void LateUpdate()
        {
            var pigs = PigController.All;
            if (pigs.Count == 0) return;

            var bounds = new Bounds(pigs[0].transform.position, Vector3.zero);
            for (int i = 1; i < pigs.Count; i++) bounds.Encapsulate(pigs[i].transform.position);

            Vector3 targetFocus = bounds.center + lookOffset;
            float spread = Mathf.Max(bounds.size.x, bounds.size.z);
            float targetDistance = Mathf.Clamp(minDistance + spread * spreadZoom, minDistance, maxDistance);

            if (!snapped)
            {
                focus = targetFocus;
                distance = targetDistance;
                snapped = true;
            }
            else
            {
                focus = Vector3.SmoothDamp(focus, targetFocus, ref focusVelocity, smoothTime);
                distance = Mathf.SmoothDamp(distance, targetDistance, ref distanceVelocity, smoothTime);
            }

            Quaternion rotation = Quaternion.Euler(pitch, yaw, 0f);
            transform.SetPositionAndRotation(focus - rotation * Vector3.forward * distance, rotation);
        }
    }
}
