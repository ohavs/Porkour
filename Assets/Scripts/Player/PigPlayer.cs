using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Porkour
{
    /// <summary>
    /// The local human player (Player prefab with PlayerInput). Reads input, drives the pig it
    /// possesses and feeds the third-person camera. Kept separate from the pig so a pig can later be
    /// grabbed by Bob, switched, or driven over the network.
    /// </summary>
    [RequireComponent(typeof(PlayerInput))]
    public class PigPlayer : MonoBehaviour
    {
        public static readonly List<PigPlayer> All = new();

        [Tooltip("Pig to control when the game starts.")]
        public PigController startPig;

        public PigController Pig { get; private set; }

        InputAction moveAction, lookAction, jumpAction, sprintAction;
        ThirdPersonCamera cam;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => All.Clear();

        void OnEnable() => All.Add(this);
        void OnDisable() => All.Remove(this);

        void Start()
        {
            // Read actions in Start: PlayerInput clones the asset per player during its OnEnable.
            var actions = GetComponent<PlayerInput>().actions;
            moveAction = actions["Move"];
            lookAction = actions["Look"];
            jumpAction = actions["Jump"];
            sprintAction = actions["Sprint"];
            if (Camera.main != null) cam = Camera.main.GetComponent<ThirdPersonCamera>();
            if (Pig == null && startPig != null) Possess(startPig);
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
            if (cam != null) cam.SetTarget(pig != null ? pig.transform : null);
        }

        void Update()
        {
            if (moveAction == null) return;
            if (cam != null)
                cam.SetLookInput(lookAction.ReadValue<Vector2>(), lookAction.activeControl?.device is Pointer);
            if (Pig == null) return;
            Pig.SetInput(moveAction.ReadValue<Vector2>(), jumpAction.IsPressed(), sprintAction.IsPressed());
            if (jumpAction.WasPressedThisFrame()) Pig.PressJump();
        }
    }
}
