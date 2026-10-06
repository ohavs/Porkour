using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Turns a model part (windmill blades) around its own centre, whatever the model's pivot: the axis is the part's
    /// thinnest side. Local look only, every PC. Finds the part by name (e.g. "Blade").
    /// </summary>
    public class Spinner : MonoBehaviour
    {
        public string partName = "Blade";
        public float degreesPerSecond = 40f;

        Transform part;
        Vector3 axisLocal, centerLocal;

        void Start()
        {
            foreach (var r in GetComponentsInChildren<Renderer>())
                if (r.name.IndexOf(partName, System.StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    part = r.transform;
                    var b = r.bounds;
                    Vector3 axis = b.size.x < b.size.z ? (b.size.x < b.size.y ? Vector3.right : Vector3.up)
                        : b.size.z < b.size.y ? Vector3.forward : Vector3.up;
                    // Remember centre and axis in the parent's space, so moving the windmill keeps them right.
                    var parent = part.parent;
                    centerLocal = parent != null ? parent.InverseTransformPoint(b.center) : b.center;
                    axisLocal = parent != null ? parent.InverseTransformDirection(axis) : axis;
                    break;
                }
            if (part == null) enabled = false;
        }

        void Update()
        {
            var parent = part.parent;
            Vector3 center = parent != null ? parent.TransformPoint(centerLocal) : centerLocal;
            Vector3 axis = parent != null ? parent.TransformDirection(axisLocal) : axisLocal;
            part.RotateAround(center, axis, degreesPerSecond * Time.deltaTime);
        }
    }
}
