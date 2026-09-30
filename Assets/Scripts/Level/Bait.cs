using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Something Farmer Bob wants more than a pig (chicken). Throw it into him and he drops the pig, takes the bait
    /// and leaves. When he's done with it, it comes back home (server).
    /// </summary>
    [RequireComponent(typeof(Rigidbody))]
    public class Bait : MonoBehaviour
    {
        public string displayName = "chicken";

        Vector3 home;
        Quaternion homeRotation;
        Rigidbody rb;

        public Rigidbody Body => rb;

        void Awake()
        {
            rb = GetComponent<Rigidbody>();
            home = transform.position;
            homeRotation = transform.rotation;
        }

        /// <summary>Server: back to where it started.</summary>
        public void ReturnHome()
        {
            rb.useGravity = true;
            rb.linearVelocity = Vector3.zero;
            rb.angularVelocity = Vector3.zero;
            rb.position = home;
            rb.rotation = homeRotation;
            transform.SetPositionAndRotation(home, homeRotation);
        }
    }
}
