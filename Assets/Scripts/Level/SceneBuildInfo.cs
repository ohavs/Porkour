using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Stamp written by the editor builder (PorkourBuilder) into the scenes it generates.
    /// When the builder's version is newer, the editor rebuilds the scene automatically.
    /// </summary>
    public class SceneBuildInfo : MonoBehaviour
    {
        public int builderVersion;
    }
}
