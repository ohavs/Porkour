using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Something a pig wears instead of carrying it on its back (the big bucket): picking it up puts it over the pig.
    /// A pig under a bucket that stands still is invisible to Farmer Bob; a walking bucket is only noticed up close.
    /// Grab again = take it off (throw). See PigGrabber / FarmerBob.CanSee.
    /// </summary>
    public class Wearable : MonoBehaviour
    {
        [Tooltip("Where it sits, relative to the wearing pig (pig's local space).")]
        public Vector3 wornOffset = new(0f, 0.2f, 0.1f);
        [Tooltip("Standing still this long under it = hidden.")]
        public float hideStillTime = 0.4f;
        [Tooltip("A moving bucket is noticed this close.")]
        public float movingSpotRange = 4f;
    }
}
