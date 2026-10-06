using UnityEngine;

namespace Porkour
{
    /// <summary>
    /// Stamp written by the editor builder (PorkourBuilder) into the scenes it generates.
    /// When the builder's version is newer, the editor rebuilds the scene automatically.
    /// Also names the level (each of Bob's farms is a level).
    /// </summary>
    public class SceneBuildInfo : MonoBehaviour
    {
        public int builderVersion;
        public int levelNumber = 1;
        public string levelName = "Bob's Farm";

        static SceneBuildInfo current;

        /// <summary>The loaded level's info (null if the scene has none).</summary>
        public static SceneBuildInfo Current => current != null ? current : current = FindAnyObjectByType<SceneBuildInfo>();
    }
}
