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

        InputAction moveAction, lookAction, jumpAction, sprintAction, grabAction, throwAction, switchAction;
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
            grabAction = actions["Grab"];
            throwAction = actions["Throw"];
            switchAction = actions["SwitchPig"];
            if (Camera.main != null) cam = Camera.main.GetComponent<ThirdPersonCamera>();
            if (Pig == null && startPig != null) Possess(startPig);
        }

        public void Possess(PigController pig)
        {
            if (Pig != null)
            {
                Pig.ClearInput();
                if (Pig.Grabber != null) Pig.Grabber.SetGrab(false);
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
            if (switchAction.WasPressedThisFrame()) SwitchToNextFreePig();
            if (Pig == null) return;
            Pig.SetInput(moveAction.ReadValue<Vector2>(), jumpAction.IsPressed(), sprintAction.IsPressed());
            if (jumpAction.WasPressedThisFrame()) Pig.PressJump();
            if (Pig.Grabber != null)
            {
                Pig.Grabber.SetGrab(grabAction.IsPressed());
                if (throwAction.WasPressedThisFrame()) Pig.Grabber.Throw();
            }
        }

        /// <summary>Take control of the next pig nobody controls (solo testing now; maybe a feature later).</summary>
        void SwitchToNextFreePig()
        {
            var pigs = PigController.All;
            if (pigs.Count == 0) return;
            int start = Pig != null ? pigs.IndexOf(Pig) : -1;
            for (int i = 1; i <= pigs.Count; i++)
            {
                var next = pigs[(start + i + pigs.Count) % pigs.Count];
                if (next.Owner == null) { Possess(next); return; }
            }
        }
    }
}
