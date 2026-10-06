using UnityEngine;

namespace Porkour
{
    /// <summary>Lamp over the exit: red until its escape objective (RoundManager.Objectives index) is done, then green.</summary>
    public class ObjectiveLamp : MonoBehaviour
    {
        public int objective;
        public Renderer lamp;

        MaterialPropertyBlock block;

        void Awake() => block = new MaterialPropertyBlock();

        void Update()
        {
            if (lamp == null) return;
            var round = RoundManager.Instance;
            bool done = round != null && round.IsSpawned && round.ObjectiveDone(objective);
            lamp.GetPropertyBlock(block);
            block.SetColor(FxUtil.BaseColorId, done ? new Color(0.3f, 1f, 0.3f) : new Color(0.9f, 0.2f, 0.15f) * (0.7f + 0.3f * Mathf.Sin(Time.time * 3f + objective)));
            lamp.SetPropertyBlock(block);
        }
    }
}
