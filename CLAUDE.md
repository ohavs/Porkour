# Porkour — CLAUDE.md (living doc)

> Update this file at every milestone and **before** asking the user to `/clear` or start a new chat.
> Keep it short: status + decisions + what's next. Details belong in code.

## The game (GDD summary — evolves as we build)
- 3D physics co-op party comedy, stylized low-poly. Round = 8–10 min escaping a barn before farmer **Bob**'s BBQ.
- **Online only**: up to **4 players on 4 PCs**, each with own pig and own **third-person camera** (pure 3D). No local co-op / split-screen / Remote Play Together.
- Each round every player gets a **random pig type** (4 players ↔ 4 types; fewer players → TBD):
  - **Gassy** — light, slides fast. *Rocket Fart*: self-launch up to high shelves, or green smoke screen that blinds/slows Bob. Blast pushes objects/pigs.
  - **Jumpy** — parkour. *Wall Bounce*, grab roof beams, drop ladders/ropes for others. Weak at pushing.
  - **Heavy (Tank)** — *Belly Slam* dash: smashes crates, rotten wall boards, presses heavy floor switches. Trampoline for others; blocks doors.
  - **Armed** — *Slingshot Snout*: sucks up small items (apples, bolts, eggs, corn) and shoots them: bells, remote locks/switches, stun Bob 3 s.
- **Grill Call**: every 2–3 min bell + footsteps → 5 s to hide (hay pile, under bucket, freeze like an object). Bob grabs a pig and carries it to the yard → others have 20 s to rescue: hit Bob with objects so he drops it, or **bait** (throw a chicken/sheep into his arms).
- **Escape** = multi-step co-op puzzle (e.g. Jumpy fetches generator key from roof, Heavy breaks electric board, Gassy runs fan to clear smoke, Armed shoots gate switch).
- **Physics comedy**: grab/lift/throw each other, stack, clumsy Gang-Beasts-style movement, slipping in mud/puddles, partial ragdoll.
- **Modes**: (1) **Co-op** ← building first; physics shoving allowed but no real harm. (2) **Competitive** (later): friendly fire, more weapons, first pig out wins, shorter rounds.

## Working with the user
- **Every reply to the user MUST be in Hebrew** — never English prose, incl. short progress updates between tool calls (only code, file paths and UI button names stay in English). This CLAUDE.md itself is written in English. User has **no Unity experience**: Claude writes all code and gives editor steps (step-by-step, detailed only where needed).
- **Save credits**: short answers, don't explain code line by line — only what matters for development/gameplay.
- **Art/audio come from free asset packs** (Unity Asset Store, Quaternius, Kenney, Mixamo…) that the user downloads. Claude does NOT model art — keep code art-agnostic (swap the pig's `Visual` child) and guide the user on finding/importing assets when needed.
- Prefer **editor automation** (menu `Porkour/...` in `Assets/Editor/PorkourBuilder.cs`) over manual editor steps.
- Claude cannot run Unity here → write carefully against the Unity 6 API; the user reports Console errors/feel.
- Git flow: Claude pushes to the session branch → user opens PR on GitHub → Merge into `main` → pulls `main` locally → works in Unity → commits & pushes to `main` **including `.meta` files** and generated prefabs/scenes/materials. Claude starts each new round from latest `main`.
- Every time the user must commit: give the exact **Summary** and **Description** text. For PRs: say exactly what (if anything) to type in title/description.
- After code changes that need a rebuild, tell the user explicitly: **stop Play mode**, then `Porkour → Rebuild Test Barn`, and wait for the success dialog.
- When a `/clear` or new chat is needed: update this file first, then tell the user.

## Tech
- Unity **6000.6.3f1**, URP (PC_RPAsset), 3D physics, **Input System only** (activeInputHandler=1).
- Installed: AI Navigation (NavMesh — for Bob), Input System, URP, Timeline, uGUI. No Cinemachine (own camera).
- **Installed by user via Package Manager**: `com.unity.netcode.gameobjects` **2.13.3** (NGO), `com.unity.multiplayer.playmode` **3.0.0** (MPPM). Code does not reference the MPPM API.
- Unity 6 API: `rb.linearVelocity` / `linearDamping` (not `velocity`/`drag`), `PhysicsMaterial` (not `PhysicMaterial`), avoid `FindObjectOfType`.
- Code: namespace `Porkour`; runtime in `Assets/Scripts/`, editor tools in `Assets/Editor/`.
- **Networking (stage 4)**: NGO, **server-authoritative host** (solo = host too; one code path). Clients send `PigInputFrame` (move/aim/held buttons + press counters) via `SubmitInputRpc` at 30 Hz; server applies to the pig. Physics, grab, abilities, Bob = **server only** (`Simulate` flag false on clients). Props/pigs: NetworkObject + NetworkTransform (no scale) + NetworkRigidbody, all **spawned at runtime** from `NetSpawnPoint`s (no in-scene NetworkObjects → no GlobalObjectIdHash issues). Scene management off. Prefabs registered via builder-made `Assets/Prefabs/PorkourNetworkPrefabs.asset`. Editor: main editor auto-Host (falls back to Client if port busy), MPPM virtual players (path contains `/Library/VP/`) auto-Client 127.0.0.1:7777. Builds: OnGUI Host/Join(IP) menu. Internet play later via Relay or Steam transport.
- Networked code rules: gameplay state lives on server; clients read replicated state (e.g. `PigNet` NetworkVariables) for HUD/visuals; local-only things (camera, HUD, input) belong to the owner NetPlayer.

## Structure
| Path | What |
|---|---|
| `Assets/Scripts/Pig/PigController.cs` | Pig body (`Simulate` false on clients). Rigidbody movement: run, sprint, jump (coyote + buffer, heavier fall, short hop only for own jumps), faces aim direction (strafe), respawn below `killHeight`. Input only via `SetInput(worldMove, aim, jump, sprint)`/`PressJump` — never reads the camera. `SetType` = type stats (speed/jump/brake/mass) + enables/adds the ability component. `Launch` + `MovementLocked` for abilities. Static `PigController.All`. |
| `Assets/Scripts/Pig/PigType.cs` | `PigType` enum + `PigTypes` table (name, ability name, colour, mass, speed/jump/brake multipliers — **tune types here**), `Shuffled()`, `AddAbility` (type → component). |
| `Assets/Scripts/Pig/PigAbility.cs` | Abstract ability base (MonoBehaviour, **added at runtime** — no prefab/rebuild needed): `SetButton` (server), cooldown/`ReadyTime`, `Hint` (HUD), `Use()` (server), `TriggerEffect(kind, pos, dir)` → PigNet RPC → `PlayEffect` on every PC. |
| `Assets/Scripts/Pig/GassyAbility.cs` | Rocket Fart: launch up 3.5 m (+ push toward move dir), works mid-air and breaks free when carried; blast pushes rigidbodies (speed = impulse/mass, capped); green smoke screen + trail. |
| `Assets/Scripts/Pig/HeavyAbility.cs` | Belly Slam: grounded = dash along aim (locks movement, breaks `Breakable`s, knocks bodies, stops at walls); airborne = belly flop down + landing shockwave. Passive trampoline: pigs falling on Heavy's back bounce 3.2 m (`OnCollisionEnter`, server). Cooldown 2.5 s. |
| `Assets/Scripts/Fx/` | Local placeholder VFX, no colliders: `SmokeCloud` (fart smoke screens in static `Active` + `InSmoke` → for Bob; dust puffs), `Debris` (smash pieces, fake floor), `FxUtil` (primitive meshes, runtime URP materials). |
| `Assets/Scripts/Level/` | Networked level parts (spawned from NetSpawnPoints): `Breakable` (server `Break()` → hidden on all PCs via NetworkVariable, debris, spawns `contents`), `PressurePlate` (on while load ≥ 40 kg incl. carried things; weight label), `Gate` (sinks into floor while its channel is on), `PuzzleSignals` + `IPuzzleChannel` (server-side channel wiring). |
| `Assets/Scripts/Pig/PigGrabber.cs` | One button: press = pick up nearest loose Rigidbody/pig in front (≤ `maxLiftMass`) onto back (velocity-follow, still collides); press again = throw toward aim, hold = charge (tap = gentle toss, full charge auto-throws). `FindGrabTarget`, `PredictThrowVelocity` for HUD. Load slows carrier. Carried pig mashes jump to escape. |
| `Assets/Scripts/Pig/PigLook.cs` | Skin renderers + `skinColor` (applied on Start) / `SetSkinColor`. |
| `Assets/Scripts/Player/NetPlayer.cs` | Player prefab (NetworkObject), one per PC. Owner: own InputActionAsset instance, camera, adds PlayerHud, sends input RPC. Server: applies input to its pig, `AssignPig`, Tab = next free pig. `pigId` NetworkVariable. |
| `Assets/Scripts/Net/NetworkGame.cs` | On NetworkManager. Auto host/join in editor, OnGUI menu in builds, spawns level objects from `spawnPoints` on server start, spawns NetPlayer per client + assigns free pig. `runInBackground`. |
| `Assets/Scripts/Net/PigNet.cs` | Pig's NetworkBehaviour: sets Simulate, syncs **type** (applied on every PC: stats, ability, skin colour = type colour), held object id, isHeld, charging/chargeStart, ability ready time (server time) → `Type/IsHeld/Held/IsCharging/Charge/AbilityCooldownLeft` for HUD on any PC. `AbilityEffectRpc` (SendTo.Everyone) plays ability visuals. |
| `Assets/Scripts/Net/NetSpawnPoint.cs` | Scene marker: prefab the server spawns at game start (pigs get shuffled types in `NetworkGame.EnsureLevelSpawned`) + `channel` (puzzle parts) + `contents` (breakables). |
| `Assets/Scripts/UI/PlayerHud.cs` | Added at runtime by the owner NetPlayer only; reads PigNet. Code-built uGUI (legacy Text, English strings — no RTL): grab-target marker, button prompt, throw charge bar, throw-arc LineRenderer (`arcMaterial` = URP Unlit, set by builder), bottom-left pig type + ability key/cooldown bar. |
| `Assets/Scripts/Camera/ThirdPersonCamera.cs` | Orbit camera (mouse / right stick), pulls in on walls, Esc unlocks cursor, click relocks. |
| `Assets/Input/PigControls.inputactions` | Map `Player`: Move / Look / Jump / Sprint / Grab / Ability / SwitchPig — **one binding per action per device** (user wants that). Schemes: `Keyboard&Mouse`, `Gamepad`. |
| `Assets/Editor/PorkourBuilder.cs` | Menu `Porkour/Rebuild Test Barn` (prefabs + scene; refuses in Play mode; shows a success/error dialog). |
| *(generated by builder)* | `Assets/Prefabs/Pig.prefab`, `Assets/Prefabs/Player.prefab`, `Assets/Prefabs/Props/{Crate,Barrel,Key,BreakableCrate,RottenBoards,PressurePlate,Gate}.prefab`, `Assets/Prefabs/PorkourNetworkPrefabs.asset`, `Assets/Scenes/TestBarn.unity`, `Assets/Art/Materials/*`, `Assets/Art/Physics/PigSlippery` |

## Controls
| | Move | Look | Jump | Sprint | Grab / Throw (hold = stronger) | Ability | Switch pig |
|---|---|---|---|---|---|---|---|
| Keyboard&Mouse | WASD / Arrows | Mouse | Space | L-Shift | LMB | RMB | Tab |
| Gamepad | L-Stick | R-Stick | A | L3 | RT | LT | Y |

## Decisions
- Online 4 PCs, third-person camera per player (user decision 2026-09-28; local co-op dropped).
- Online built early (stage 4) so every later feature is networked from day one; user tests alone via MPPM.
- Solo testing of co-op: 4 pigs in scene, Tab switches control (may become the "fewer players" solution).
- Pig faces the camera direction while moving (A/D strafe) — user found turn-toward-movement confusing. Throws aim with the camera.
- One button per action (user request): Grab = pick up / throw.
- Physics movement on a single Rigidbody (capsule along Z, rotation X/Z frozen, zero-friction material); pig turns toward move direction, movement relative to camera. Ragdoll/wobble at polish stage.
- **Player ≠ Pig**: input lives on NetPlayer, pig only receives commands (server) → Bob can grab a pig, pigs never change network ownership.
- Builder **overwrites** Pig/Player prefabs & TestBarn scene → tuned values go into code defaults, not the prefab.
- Placeholder art = Unity primitives until free asset packs are imported.
- Pig types (stage 5): types are shuffled when the server spawns the level (later: per round). Colour = type (Gassy green, Jumpy blue, Heavy grey-brown, Armed orange). Heavy weighs 45 > `maxLiftMass` 35 → others can't lift it. Ability button = RMB / LT (one button per ability).
- Abilities & type stats are applied at runtime (components added on demand) → no rebuild needed when they change. New level props DO need a rebuild.
- Puzzle wiring = numbered channels (`NetSpawnPoint.channel`), server-only `PuzzleSignals`. Pressure plate needs 40 kg: Heavy alone or any two pigs (built-in "fewer players" alternative).
- Test barn SW corner = side room: rotten boards (north) + gate (east) opened by the plate outside; breakable crate with a key inside.

## Roadmap (co-op mode first)
1. ✅ **One pig moves & jumps** in a test barn.
2. ✅ **Third-person pig** — orbit camera, mouse/gamepad look.
3. ✅ **Grab / carry / throw** — one-button grab/throw with charge bar, arc preview, Tab pig switching.
4. ✅ **Online foundation** — Netcode for GameObjects (server-authoritative), host/join, Multiplayer Play Mode so the user can test alone. Done early so later features are built networked.
5. **4 pig types + abilities** ← *in progress* — random types + stats + HUD + ability button done (5a). Abilities: ✅ Gassy Rocket Fart (5a) → ✅ Heavy Belly Slam + breakables/plate/gate (5b, awaiting test) → Jumpy Wall Bounce (5c) → Armed Slingshot Snout (5d).
6. **Farmer Bob** — Grill Call cycle, hiding (hay/bucket/freeze), grab & carry, 20 s rescue (hit/stun/bait animals). NavMesh AI (server).
7. **Barn map + escape puzzle + full loop (MVP)** — real level, 10-min timer, multi-step escape, win/lose, menu, restart.
8. **Art & polish** — import free asset packs (pig/farmer/animals/barn), animation, partial ragdoll, mud, sound, VFX, UI.
9. **Steam** — Steamworks lobbies/invites, Steam transport, build & release.
10. **Competitive mode** — friendly fire, weapons, fast rounds.

## Open questions
- Fewer than 4 players → how to compensate for missing pig types/abilities? Ideas: collectible power-ups giving a missing ability (e.g. bean can = fart jump), alternative puzzle solutions per ability, AI helper pigs, or let a player switch pig at stations. User: "need to think how to compensate".

## Status / next step
- 2026-09-28 (end of day 1): Stages 1–4 done. Online compiled & ran on user's PC (packages installed, rebuilt, "Online test barn" pushed; user: "great").
- 2026-09-30: user confirmed the MPPM 2-player test worked. Stage 5a (types, stats, ability button, HUD, Gassy Rocket Fart) merged — user: "works great".
- 2026-09-30: Stage 5b pushed (Heavy Belly Slam dash/flop, trampoline, Breakable, PressurePlate, Gate, side room) — **needs Rebuild Test Barn**; waiting for the user's test.
- **Next:** fix what the user reports on 5b, then 5c Jumpy (wall bounce/wall jump, grab roof beams, drop ladders/ropes for others).
- Lesson: prefer runtime self-healing over "rebuild required" — the user easily misses rebuild steps.

## Known issues / TODO
- Host latency only for remote clients (no client prediction yet) — revisit if movement feels laggy online.
- Template leftovers (`SampleScene`, `TutorialInfo`, `Readme.asset`) can be deleted later.
- Smoke/debris materials are made from code (URP Lit → transparent); in builds the transparent shader variant may be stripped → replace with a real smoke VFX/material asset at the art stage.
- Builder no longer sets pig colours (`NetSpawnPoint.pigColor` removed); old scenes still work (stale serialized field is ignored).
