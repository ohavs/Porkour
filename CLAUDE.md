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
- Unity 6 API: `rb.linearVelocity` / `linearDamping` (not `velocity`/`drag`), `PhysicsMaterial` (not `PhysicMaterial`), avoid `FindObjectOfType`.
- Code: namespace `Porkour`; runtime in `Assets/Scripts/`, editor tools in `Assets/Editor/`.
- **Networking plan (proposed, not installed yet)**: Netcode for GameObjects; test 4 players on one PC with **Multiplayer Play Mode**; online play via Unity Relay/Sessions (join code) first, Steam lobbies/invites + Steam transport at the Steam stage.

## Structure
| Path | What |
|---|---|
| `Assets/Scripts/Pig/PigController.cs` | Pig body. Rigidbody movement: camera-relative run, sprint, jump (coyote + buffer, heavier fall, short hop on release), respawn below `killHeight`. Input via `SetInput`/`PressJump` from its `Owner`. Static `PigController.All`. |
| `Assets/Scripts/Pig/PigLook.cs` | Skin renderers + `SetSkinColor`. |
| `Assets/Scripts/Player/PigPlayer.cs` | Local human player (Player prefab w/ PlayerInput). Reads input → drives possessed pig + feeds camera look. `Possess(pig)`, `startPig`. |
| `Assets/Scripts/Camera/ThirdPersonCamera.cs` | Orbit camera (mouse / right stick), pulls in on walls, Esc unlocks cursor, click relocks. |
| `Assets/Input/PigControls.inputactions` | Map `Player`: Move / Look / Jump / Sprint. Schemes: `Keyboard&Mouse`, `Gamepad`. |
| `Assets/Editor/PorkourBuilder.cs` | Menu `Porkour/Rebuild Test Barn` (prefabs + scene; refuses in Play mode; shows a success/error dialog). |
| *(generated by builder)* | `Assets/Prefabs/Pig.prefab`, `Assets/Prefabs/Player.prefab`, `Assets/Scenes/TestBarn.unity`, `Assets/Art/Materials/*`, `Assets/Art/Physics/PigSlippery` |

## Controls
| | Move | Look | Jump | Sprint |
|---|---|---|---|---|
| Keyboard&Mouse | WASD / Arrows | Mouse | Space | L-Shift |
| Gamepad | L-Stick | R-Stick | A (South) | L3 / LB |

## Decisions
- Online 4 PCs, third-person camera per player (user decision 2026-09-28; local co-op dropped).
- Physics movement on a single Rigidbody (capsule along Z, rotation X/Z frozen, zero-friction material); pig turns toward move direction, movement relative to camera. Ragdoll/wobble at polish stage.
- **Player ≠ Pig**: input lives on Player (PigPlayer), pig only receives commands → Bob can grab a pig, network ownership stays simple.
- Builder **overwrites** Pig/Player prefabs & TestBarn scene → tuned values go into code defaults, not the prefab.
- Placeholder art = Unity primitives until free asset packs are imported.

## Roadmap (co-op mode first)
1. ✅ **One pig moves & jumps** in a test barn.
2. **Third-person pig** ← *current* — orbit camera, mouse/gamepad look, single local player.
3. **Online foundation** — Netcode for GameObjects, host/join, each client own pig + camera, Multiplayer Play Mode to test 4 pigs on one PC.
4. **Physics interaction core** (networked) — grab / carry / throw pigs & objects, stacking, pushing.
5. **4 pig types + abilities** — Gassy / Jumpy / Heavy / Armed, random assignment per round.
6. **Farmer Bob** — Grill Call cycle, hiding (hay/bucket/freeze), grab & carry, 20 s rescue (hit/stun/bait animals). NavMesh AI (server).
7. **Escape puzzle + full loop (MVP)** — 10-min timer, multi-step escape, win/lose, menu, lobby, restart.
8. **Art & polish** — import free asset packs (pig/farmer/animals/barn), animation, partial ragdoll, mud, sound, VFX, UI.
9. **Steam** — Steamworks lobbies/invites, Steam transport, build & release.
10. **Competitive mode**.

## Open questions
- Fewer than 4 players → how to compensate for missing pig types/abilities? Ideas: collectible power-ups giving a missing ability (e.g. bean can = fart jump), alternative puzzle solutions per ability, AI helper pigs, or let a player switch pig at stations. User: "need to think how to compensate".
- Networking stack confirmation (proposal above).

## Status / next step
- 2026-09-28: Stage 1 approved. Local join (old stage 2) built then dropped after pivot to online.
- Stage 2 (third-person) merged to main but **never rebuilt** on user's PC (scene still stage-1: pig without Player → can't move; Play mode was on during "build"). Builder now has one menu `Porkour/Rebuild Test Barn` with play-mode guard + dialogs. **Next:** user stops Play, rebuilds, tests camera/feel. Then stage 3 (online).

## Known issues / TODO
- Third-person scripts not yet compiled in Unity — expect possible first-run fixes.
- Template leftovers (`SampleScene`, `TutorialInfo`, `Readme.asset`) can be deleted later.
