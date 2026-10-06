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
- **Builder changes → bump `PorkourBuilder.BuildVersion`.** After compiling, the editor compares it with the `SceneBuildInfo.builderVersion` stamp in `Barn.unity` and rebuilds automatically (dialog "The barn was updated automatically"). Tell the user to expect that dialog (and to commit the generated files afterwards); the manual menu `Porkour → Rebuild Barn` still exists as a fallback (stop Play mode first). The user once missed a manual rebuild (5b side room didn't appear) — never rely on it.
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
| `Assets/Scripts/Pig/PigController.cs` | Pig body (`Simulate` false on clients). Rigidbody movement: run, sprint, jump (coyote + buffer, heavier fall, short hop only for own jumps), faces aim direction (strafe), respawn below `killHeight`. Input only via `SetInput(worldMove, aim, jump, sprint)`/`PressJump` — never reads the camera. `SetType` = type stats (speed/jump/brake/mass) + enables/adds the ability component. `Launch` + `MovementLocked` for abilities, `GetCapsule`, `TryJump` → `Ability.TryAirJump()` when airborne, `StillTime` (Bob's "frozen" check). `HeldBy` is an `IPigCarrier` (PigGrabber or FarmerBob; `EscapePresses` int.MaxValue = can't mash free). **Climbing**: inside a `Climbable` zone + pushing toward it or holding jump → climb up, hop over the edge at the top (any pig). Static `PigController.All`. |
| `Assets/Scripts/Pig/PigType.cs` | `PigType` enum + `PigTypes` table (name, ability name, colour, mass, speed/jump/brake multipliers — **tune types here**), `Shuffled()`, `AddAbility` (type → component). |
| `Assets/Scripts/Pig/PigAbility.cs` | Abstract ability base (MonoBehaviour, **added at runtime** — no prefab/rebuild needed): `SetButton` (server; `PressedWhileUnavailable` hook), cooldown/`ReadyTime`/`StartCooldown`, `Hint` + `Charges`/`MaxCharges` (HUD), `Use()` (server), `TriggerEffect(kind, pos, dir)` → PigNet RPC → `PlayEffect` on every PC. |
| `Assets/Scripts/Pig/GassyAbility.cs` | Rocket Fart: launch up 3.5 m (+ push toward move dir), works mid-air and breaks free when carried; blast pushes rigidbodies (speed = impulse/mass, capped); green smoke screen + trail. |
| `Assets/Scripts/Pig/HeavyAbility.cs` | Belly Slam: grounded = dash along aim (locks movement, breaks `Breakable`s, knocks bodies, stops at walls); airborne = belly flop down + landing shockwave. Passive trampoline: pigs falling on Heavy's back bounce 3.2 m (`OnCollisionEnter`, server). Cooldown 2.5 s. |
| `Assets/Scripts/Pig/JumpyAbility.cs` | Passive **wall bounce** (jump in air at a wall; not the same wall twice in a row → corners/chimneys) + **ledge grab** (airborne, pushing into a ledge ≤ 1.1 m above centre → boosted up onto it). Ability **Rope Ladder**: at an edge (looking at it) drop a rope any pig can climb (20 s; 90 s cooldown from the drop; press again = pull up). Rope = local `RopeLadder` on every PC via FxRopeDrop (direction encodes outward × length). |
| `Assets/Scripts/Pig/ArmedAbility.cs` | Slingshot Snout: hold = suck `Ammo` in a 35° cone (4.5 m) into a 6-slot magazine (despawns them); tap = shoot the last one along the crosshair (ray from camera pivot = pig + 1 m up, ballistic compensation), re-spawning it as a projectile. `Charges` = ammo → HUD. |
| `Assets/Scripts/Bob/FarmerBob.cs` | **Farmer Bob** (server AI on a runtime-baked NavMesh, `Instance`; announcements → `GameEvents`, speech lines over his head via `Say`). Acts only while `RoundManager.IsPlaying` (first call 45 s after start, then every 95–135 s). States Away → Coming (5 s warning) → Searching (30 s) / Investigating (bell, last-seen spot) / Chasing → Carrying (20 s rescue window) → grilled (pig `Respawn`, `RoundManager.OnPigGrilled`) / Stunned (3 s) → Leaving. Ignores pigs nobody plays (`Owner == null`, "Zzz") and escaped pigs. Sees pigs in a 70° cone ≤ 14 m with line of sight (what a pig carries/wears doesn't block); not in HideSpots/smoke/still under a bucket (moving bucket: ≤ 4 m); "frozen" pigs (StillTime ≥ 1 s) only ≤ 3 m. Unreachable pig (loft/beams/crates: partial path or ≥ 1.8 m above) → throws corn (knocks pigs off), gives up after 3 throws (ignores it 10 s). `StartFinalHunt` (last minute): searches non-stop. Stun = hard hit (≥ 7 m/s objects; flying pigs / Heavy dash ≥ 8). `Bait` hit → drops pig, takes it, leaves. Opens barn door (channel 99). Host debug **G** = Grill Call now. |
| `Assets/Scripts/Game/RoundManager.cs` | **Round loop** (NetworkObject spawned once by NetworkGame, survives restarts): Intro 8 s (HUD shows your role) → Playing 10 min → Won/Lost → 10 s results → `NetworkGame.RestartRound`. `Objectives` table (escape plan, channel lists) + synced `channelBits`. Win = every player-controlled pig in the `EscapeZone` (sets `PigController.Escaped`). Lose = time up or `maxGrills` (3) grilled. Final hunt at 60 s left. Host debug **R** = restart. `GameEvents` = local announcement event for the HUD. |
| `Assets/Scripts/Fx/` | Local placeholder VFX, no colliders: `SmokeCloud` (fart smoke screens in static `Active` + `InSmoke` → for Bob; dust puffs), `Debris` (smash pieces, fake floor), `FxUtil` (primitive meshes, runtime URP materials). **`Sfx`**: ~35 sounds synthesized from code at startup (`Sound` enum, pooled 3D/2D AudioSources, `CreateLoop`); a file `Assets/Resources/Sfx/<SoundName>.wav` overrides one. Only call it from code that runs on every PC (PlayEffect, RPCs, NetworkVariable OnValueChanged). **`ProceduralAnimator`** (Pig/Farmer/Critter): walk bob/sway, limb swing (children of `Visual` by name: `Leg`, `ArmL/R`, `BootL/R`, `Tail`), squash & stretch, jump/land sounds, Bob's footsteps; pig label (Zzz = unplayed, P2, FREE!). `ThirdPersonCamera.Shake(pos, strength)`. |
| `Assets/Scripts/Level/` | Networked level parts (spawned from NetSpawnPoints): `Breakable` (server `Break()` → hidden on all PCs, debris, spawns `contents`; with a channel = fuse box), `PressurePlate` (on while load ≥ 40 kg incl. carried things), `Gate` (moves by `openOffset` while its channel is on, or while ALL `requiredChannels` are on = exit gate; synced `IsOpen`; used for doors, fence, lift), `PuzzleSignals` + `ChannelIds` (channel numbers) + `IPuzzleChannel`, `SceneBuildInfo`, `Climbable`, `RopeLadder`, `Ammo` (Apple/Corn/Egg/Bolt; `Fire(ignoreColliders, v, knockPigs)`, `BallisticVelocity`), `ShootTarget` (hard hit toggles; `latch` = stays on), `Bell`, `HideSpot`, `Bait` (chicken/sheep), **new:** `KeyItem` + `KeySlot` (padlock), `FartSwitch` (generator started by Gassy's blast), `Zapper` (electric fence zaps pigs while its Gate is closed), `Sparker` (fuse box sparks), `Wearable` (bucket: worn over the pig = hiding), `Critter` (chickens/sheep wander, flee pigs, get up), `EscapeZone` (truck bed), `ObjectiveLamp` (exit lamps), `WorldLabel` (runtime TextMesh signs), `CameraPassThrough` (camera ignores beams/posts/ceiling). |
| `Assets/Scripts/Pig/PigGrabber.cs` | One button: press = pick up nearest loose Rigidbody/pig in front (≤ `maxLiftMass`) onto back (velocity-follow, still collides; `Wearable`s go over the pig instead); press again = throw toward aim, hold = charge (tap = gentle toss, full charge auto-throws). `FindGrabTarget`, `PredictThrowVelocity` for HUD. Load slows carrier. Carried pig mashes jump to escape. |
| `Assets/Scripts/Pig/PigLook.cs` | Skin renderers + `skinColor` (applied on Start) / `SetSkinColor`. |
| `Assets/Scripts/Player/NetPlayer.cs` | Player prefab (NetworkObject), one per PC (`Local` = this PC's). Owner: own InputActionAsset instance, camera, adds PlayerHud, sends input RPC. Server: applies input to its pig, `AssignPig`, Tab = next free pig (`FindFreePig` skips despawned pigs). `pigId` NetworkVariable. |
| `Assets/Scripts/Net/NetworkGame.cs` | On NetworkManager. Auto host/join in editor, OnGUI menu in builds (status line bottom-right), bakes `navMesh` once, spawns `roundPrefab` once, spawns level objects from `spawnPoints`, NetPlayer per client + free pig. **`RestartRound`**: despawn everything except players + round manager, `PuzzleSignals.Clear`, respawn (types reshuffled), reassign pigs, `BeginRound`. `runInBackground`. |
| `Assets/Scripts/Net/PigNet.cs` | Pig's NetworkBehaviour: sets Simulate, syncs **type** (applied on every PC: stats, ability, skin colour = type colour), held object id (grab/throw sounds), isHeld, escaped, charging/chargeStart, ability ready time, ability charges → `Type/IsHeld/IsEscaped/Held/IsCharging/Charge/AbilityCooldownLeft` for HUD on any PC. `AbilityEffectRpc` (SendTo.Everyone) plays ability visuals. |
| `Assets/Scripts/Net/NetSpawnPoint.cs` | Scene marker: prefab the server spawns at game start (pigs get shuffled types in `NetworkGame.EnsureLevelSpawned`) + `channel` (puzzle parts) + `contents` (breakables). |
| `Assets/Scripts/UI/PlayerHud.cs` | Added at runtime by the owner NetPlayer only; reads PigNet/RoundManager. Code-built uGUI (legacy Text, rich text, English — no RTL): grab-target marker, button prompt (+ context hints: bucket, fuse box, generator, escaped), throw charge bar + arc, bottom-left pig type + ability, Armed crosshair, top: round timer (ticks last 10 s), Grill Call banner, announcements; top-left escape-plan checklist; top-right grilled/escaped; centre: intro role text / results. |
| `Assets/Scripts/Camera/ThirdPersonCamera.cs` | Orbit camera (mouse / right stick), pulls in on walls, Esc unlocks cursor, click relocks. |
| `Assets/Input/PigControls.inputactions` | Map `Player`: Move / Look / Jump / Sprint / Grab / Ability / SwitchPig — **one binding per action per device** (user wants that). Schemes: `Keyboard&Mouse`, `Gamepad`. |
| `Assets/Editor/PorkourBuilder.cs` | Menu `Porkour/Rebuild Barn` (prefabs + scene; refuses in Play mode). **Auto-rebuild** after compile when `BuildVersion` (now **4**) > scene stamp (skipped in Play mode and in MPPM virtual players). `BuildLevel` = the barn geometry (see "Barn map"). Deletes the old `TestBarn.unity`, `Props/Gate.prefab`, `Props/Key.prefab`. |
| *(generated by builder)* | `Assets/Prefabs/{Pig,Player,Round,FarmerBob}.prefab`, `Assets/Prefabs/Props/{Crate,Barrel,GateKey,BreakableCrate,RottenBoards,PressurePlate,Lift,BarnDoor,ExitGate,ElectricFence,FuseBox,Generator,Padlock,ShootTarget,Bell,Chicken,Sheep,Bucket,Apple,Corn,Egg,Bolt}.prefab`, `Assets/Prefabs/PorkourNetworkPrefabs.asset`, `Assets/Scenes/Barn.unity`, `Assets/Art/Materials/*`, `Assets/Art/Physics/PigSlippery` |

## Controls
| | Move | Look | Jump | Sprint | Grab / Throw (hold = stronger) | Ability | Switch pig |
|---|---|---|---|---|---|---|---|
| Keyboard&Mouse | WASD / Arrows | Mouse | Space | L-Shift | LMB | RMB | Tab |
| Gamepad | L-Stick | R-Stick | A | L3 | RT | LT | Y |

## Barn map (builder `BuildLevel`, 2026-10-06)
- Barn x −20..20, z −15..15, walls + invisible ceiling 8.5 m. South: Bob's door (ch 99) → yard + grill. South-east: pig pen (start, low fence, gap NW).
- **Escape plan = 4 locks** (HUD checklist + 4 lamps over the exit): 1 Padlock (ch 11): key on the north roof beam far west (beams 5.5 m, 1.6 wide) → bring to the padlock post. 2 Electric fence (ch 12) in the exit passage: smash the fuse box in the tool shed (west, rotten boards) — Heavy only. 3 Generator (ch 13) on the hayloft: Gassy's fart blast starts it. 4 Three latching bullseyes (ch 21–23) high on N/S/W walls — Armed. Exit gate needs 11+13+21–23; then the getaway truck in the meadow (EscapeZone = truck bed).
- Getting up: hayloft (east, 3.2 m) via lift (plate ch 2, 40 kg), crate stacks, Jumpy ledge grab, Gassy rocket, ropes. Beams from the loft / west shelf (3.2 m). Hiding: 5 haystacks, 3 buckets, smoke. Bait: 3 chickens, 1 sheep. Bell under the south beam.

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
- Jumpy: GDD "Wall Bounce" = passive on the jump button; the ability button = Rope Ladder (co-op: Jumpy gets up high, others climb). "Grab roof beams" not built yet (needs beams in a real level — stage 7).
- Short-lived ability objects (rope) are created locally on every PC from an RPC, not as NetworkObjects (no rebuild, no prefab); late joiners won't see them — acceptable.
- Rope ladder: 20 s, 90 s cooldown (user request 2026-09-30).
- Armed: one button — hold = suck, tap = shoot (user wants one button per action). Shots are real networked ammo objects (reusable, eggs splat).
- Bob v1 (stage 6 started): hiding = haystacks (HideSpot), fart smoke, freezing (stand still ≥ 1 s → only seen ≤ 3 m). Rescue = any hard hit (thrown object, flying pig, Heavy slam, Armed shot) or bait (chicken). Grilled pig just respawns for now (lose condition in stage 7). Bell = lure. No audio yet → the "bell + footsteps" warning is the HUD banner.
- Round rules (2026-10-06, stage 7 MVP): 10-min round, types reshuffled each round, win = every **player-controlled** pig in the truck (solo test: your pig is enough), lose = time up or 3 pigs grilled; results 10 s → automatic new round (level respawned). Last minute = Bob's final hunt.
- Bob ignores pigs nobody plays (Zzz) — solo testers Tab between pigs safely; this may become the "fewer players" answer. Each puzzle has a main pig type but alternatives exist (crates, ropes, trampoline, throws).
- High places aren't free safety: Bob throws corn at pigs he can't reach.
- Sounds: procedural placeholders now (`Sfx`), real files later via `Assets/Resources/Sfx/`. Animation: procedural (`ProceduralAnimator`) until real rigs.
- The test barn was replaced by the real barn (`Barn.unity`); old side room / tall pillar are gone.

## Roadmap (co-op mode first)
1. ✅ **One pig moves & jumps** in a test barn.
2. ✅ **Third-person pig** — orbit camera, mouse/gamepad look.
3. ✅ **Grab / carry / throw** — one-button grab/throw with charge bar, arc preview, Tab pig switching.
4. ✅ **Online foundation** — Netcode for GameObjects (server-authoritative), host/join, Multiplayer Play Mode so the user can test alone. Done early so later features are built networked.
5. **4 pig types + abilities** ← *in progress* — random types + stats + HUD + ability button done (5a). Abilities: ✅ Gassy Rocket Fart (5a) → ✅ Heavy Belly Slam + breakables/plate/gate (5b) → ✅ Jumpy wall bounce / ledge grab / rope ladder (5c) → ✅ Armed Slingshot Snout (5d). **Stage 5 done.**
6. ✅ **Farmer Bob** — Grill Call cycle, hiding (hay/smoke/freeze/bucket), grab & carry, 20 s rescue (hit/stun/chicken or sheep bait), bell lure, corn throwing, final hunt, placeholder sounds + procedural animation. TODO later: difficulty tuning from playtests.
7. **Barn map + escape puzzle + full loop (MVP)** ← *built 2026-10-06, waiting for the user's test* — real barn, 4-lock escape, 10-min timer, win/lose, results, auto-restart. Still missing: main menu / lobby (OnGUI host/join only).
8. **Art & polish** — import free asset packs (pig/farmer/animals/barn), animation, partial ragdoll, mud, sound, VFX, UI.
9. **Steam** — Steamworks lobbies/invites, Steam transport, build & release.
10. **Competitive mode** — friendly fire, weapons, fast rounds.

## Open questions
- Fewer than 4 players → how to compensate for missing pig types/abilities? Ideas: collectible power-ups giving a missing ability (e.g. bean can = fart jump), alternative puzzle solutions per ability, AI helper pigs, or let a player switch pig at stations. User: "need to think how to compensate".

## Asset plan (user asked "when do we import assets?")
- Answer given: right after this update is tested → next update = **Art pass 1**. Downloads suggested: Quaternius *LowPoly Animated Farm Animals* (pig, sheep… animated, CC0), Quaternius *LowPoly Farm Buildings* (CC0), a farmer from **Mixamo** (+ walk/run/carry animations). Chicken model TBD. Plan: user drops them into `Assets/Art/Models/...`, Claude swaps the `Visual` children (keep colliders/physics), uses their Animator instead of `ProceduralAnimator` where rigs exist.

## Status / next step
- 2026-09-28 (end of day 1): Stages 1–4 done. Online compiled & ran on user's PC (packages installed, rebuilt, "Online test barn" pushed; user: "great").
- 2026-09-30: user confirmed the MPPM 2-player test worked. Stage 5a (types, stats, ability button, HUD, Gassy Rocket Fart) merged — user: "works great".
- 2026-09-30: Stage 5b merged (Heavy Belly Slam dash/flop, trampoline, Breakable, PressurePlate, Gate, side room). Manual rebuild was skipped once → added builder auto-rebuild (BuildVersion 2); it worked, user pushed "Test barn with side room" — all "works great".
- 2026-09-30: Stage 5c merged — user: "works great"; asked rope 20 s + 90 s cooldown, and bigger updates ("more work per round").
- 2026-09-30 (end of day 2): Big update merged (rope tweak, Armed 5d, Farmer Bob v1, yard/door/haystacks/bell/target/chickens/ammo; BuildVersion 3 auto-rebuild worked). User: "works well". One Console error (DestroyImmediate inside a physics callback, from FxUtil.PrimitiveMesh) → fixed (deferred Destroy + prewarm); fix pushed on the session branch.
- 2026-10-06: user: everything works; asked for the biggest update yet ("start feeling gameplay") + when assets start. Built (BuildVersion 4, new scene `Barn.unity`): RoundManager loop, real barn + 4-lock escape + getaway truck, bucket hiding, sheep, wandering critters, Bob corn throwing / final hunt / speech / footsteps, procedural sounds + animation, camera shake, new HUD (timer, checklist, intro roles, results).
- **Next session:** ask how the round felt (was the escape solvable? too long/short? Bob too hard/easy? any Console errors? did the auto-rebuild dialog appear and Barn.unity open?). Tune. Then **Art pass 1** (see Asset plan) — ask which packs the user downloaded and where they put them.
- Lesson: prefer runtime self-healing over "rebuild required" — the user easily misses rebuild steps (now automated via BuildVersion).
- Lesson: never `DestroyImmediate` at runtime — effects can be created inside physics callbacks (OnCollisionEnter → RPC → PlayEffect).

## Known issues / TODO
- Host latency only for remote clients (no client prediction yet) — revisit if movement feels laggy online.
- Template leftovers (`SampleScene`, `TutorialInfo`, `Readme.asset`) can be deleted later.
- Untested in Unity (written blind 2026-10-06): lift carrying pigs smoothly, Jumpy reaching the beams from the loft/shelf, bucket hovering over the pig, Bob's partial-path detection on the loft. Watch the user's report.
- Held object destroyed without `Drop()` → `PigGrabber.FixedUpdate` touches a destroyed Rigidbody (pre-existing; KeySlot/Breakable drop first).
- Smoke/debris materials are made from code (URP Lit → transparent); in builds the transparent shader variant may be stripped → replace with a real smoke VFX/material asset at the art stage.
- Builder no longer sets pig colours (`NetSpawnPoint.pigColor` removed); old scenes still work (stale serialized field is ignored).
