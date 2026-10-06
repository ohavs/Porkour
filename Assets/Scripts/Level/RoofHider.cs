using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Roof that disappears for you while your camera or your pig is inside the building (so you can see the pigs) and
    /// is there when you look at the building from outside. Local, renderers only (the roof has no colliders).
    /// </summary>
    public class RoofHider : MonoBehaviour
    {
        [Tooltip("Inside volume, local to this object.")]
        public Vector3 center;
        public Vector3 size = new(40f, 14f, 30f);

        Renderer[] renderers;
        bool hidden;

        void Start() => renderers = GetComponentsInChildren<Renderer>();

        void LateUpdate()
        {
            var cam = Camera.main;
            if (cam == null || renderers == null) return;
            var me = NetPlayer.Local != null ? NetPlayer.Local.Pig : null;
            bool inside = Inside(cam.transform.position) || (me != null && Inside(me.transform.position));
            if (inside == hidden) return;
            hidden = inside;
            foreach (var r in renderers)
                if (r != null) r.enabled = !inside;
        }

        bool Inside(Vector3 point)
        {
            Vector3 local = transform.InverseTransformPoint(point) - center;
            return Mathf.Abs(local.x) <= size.x / 2f && Mathf.Abs(local.y) <= size.y / 2f && Mathf.Abs(local.z) <= size.z / 2f;
        }
    }
}
