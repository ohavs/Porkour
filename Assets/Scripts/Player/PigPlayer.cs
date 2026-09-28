using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Porkour
{
    /// <summary>
    /// One human player (lives on the Player prefab with PlayerInput).
    /// Reads its own input and drives the pig it currently possesses - kept separate from the pig
    /// so a player can switch pigs, and a pig can be grabbed/controlled by others later.
    /// </summary>
    [RequireComponent(typeof(PlayerInput))]
    public class PigPlayer : MonoBehaviour
    {
        public static readonly List<PigPlayer> All = new();

        public PigController Pig { get; private set; }
        public int Index { get; private set; }
        public string Scheme { get; private set; }
        public InputDevice Device { get; private set; }

        InputAction moveAction, jumpAction, sprintAction;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => All.Clear();

        void OnEnable() => All.Add(this);
        void OnDisable() => All.Remove(this);

        public void Init(int index, string scheme, InputDevice device)
        {
            Index = index;
            Scheme = scheme;
            Device = device;
            name = $"Player {index + 1} ({scheme})";
        }

        void Start()
        {
            // Read actions in Start: PlayerInput clones the asset per player during its OnEnable.
            var actions = GetComponent<PlayerInput>().actions;
            moveAction = actions["Move"];
            jumpAction = actions["Jump"];
            sprintAction = actions.FindAction("Sprint");
        }

        public void Possess(PigController pig)
        {
            if (Pig != null)
            {
                Pig.ClearInput();
                Pig.Owner = null;
            }
            Pig = pig;
            if (pig != null) pig.Owner = this;
        }

        void Update()
        {
            if (Pig == null || moveAction == null) return;
            Pig.SetInput(moveAction.ReadValue<Vector2>(), jumpAction.IsPressed(),
                sprintAction != null && sprintAction.IsPressed());
            if (jumpAction.WasPressedThisFrame()) Pig.PressJump();
        }
    }
}
