using UnityEngine;

namespace Porkour
{
    public enum PigType : byte { Gassy, Jumpy, Heavy, Armed }

    /// <summary>Body stats, colour and names of one pig type.</summary>
    public readonly struct PigTypeInfo
    {
        public readonly string Name, AbilityName;
        public readonly Color Color;
        /// <summary>Rigidbody mass (others can lift up to PigGrabber.maxLiftMass = 35).</summary>
        public readonly float Mass;
        /// <summary>Multipliers on PigController's run speed, jump height and ground braking (low = slides).</summary>
        public readonly float Speed, Jump, Brake;

        public PigTypeInfo(string name, string abilityName, Color color, float mass, float speed, float jump, float brake)
        {
            Name = name;
            AbilityName = abilityName;
            Color = color;
            Mass = mass;
            Speed = speed;
            Jump = jump;
            Brake = brake;
        }
    }

    /// <summary>Pig type table (tune here) + random assignment + which ability component each type uses.</summary>
    public static class PigTypes
    {
        public static readonly PigType[] All = { PigType.Gassy, PigType.Jumpy, PigType.Heavy, PigType.Armed };

        static readonly PigTypeInfo[] Infos =
        {
            new("Gassy", "Rocket Fart", new Color(0.62f, 0.86f, 0.42f), mass: 22f, speed: 1.1f, jump: 1f, brake: 0.3f),
            new("Jumpy", "Wall Bounce", new Color(0.55f, 0.78f, 1f), mass: 24f, speed: 1.05f, jump: 1.3f, brake: 1f),
            new("Heavy", "Belly Slam", new Color(0.62f, 0.52f, 0.5f), mass: 45f, speed: 0.85f, jump: 0.85f, brake: 1.2f),
            new("Armed", "Slingshot Snout", new Color(1f, 0.66f, 0.35f), mass: 30f, speed: 1f, jump: 1f, brake: 1f),
        };

        public static PigTypeInfo Info(PigType type) => Infos[(int)type];

        /// <summary>All types in random order (4 players = 4 different types).</summary>
        public static PigType[] Shuffled()
        {
            var types = (PigType[])All.Clone();
            for (int i = types.Length - 1; i > 0; i--)
            {
                int j = Random.Range(0, i + 1);
                (types[i], types[j]) = (types[j], types[i]);
            }
            return types;
        }

        /// <summary>Adds the ability component for a type (null = not built yet).</summary>
        public static PigAbility AddAbility(GameObject pig, PigType type) => type switch
        {
            PigType.Gassy => pig.AddComponent<GassyAbility>(),
            _ => null,
        };
    }
}
