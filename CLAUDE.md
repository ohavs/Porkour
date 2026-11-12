# Porkour — CLAUDE.md (living doc)

> Update at every milestone and **before** telling the user they can `/clear`. Keep it short: status + decisions + next.

## The game (design = `GDD.md`, still evolving — user: "a very initial idea that needs developing")
Browser game, online co-op for up to 4 players: **4 equal pigs** (fart / sprint-ram / mud wallow, stand on 2 legs, grab & throw,
ragdoll) rob and wreck a farm while **farmer Bob** goes about his daily routine. Spotted → he grabs you → cage → BBQ;
teammates bash him (only strong hits count) or free you. ~10-min rounds, several farms, missions (steal / wreck / pranks),
coins + XP → shop later. Inspirations: Untitled Goose Game, Burglin' Gnomes, Hello Neighbor, Dead by Daylight, Party Animals.

## Working with the user
- **Every reply in Hebrew** (code / paths / UI names stay English). This file is English. User has no game-dev experience.
- **Save tokens**: short answers. At the end of every stage: commit + push, update this file, and say explicitly
  whether it is safe to `/clear`.
- **Work autonomously** — the user downloads things only when at a PC; do everything possible without them.
- Quality bar: "not embarrassing next to popular Steam games" — use many free technologies / assets.
- Look (user feedback 2026-11-12): **cartoon, not realistic**; pigs **round, fat, long** (Cube Pets boxy pig = "bad Roblox
  imitation" → replaced by a procedural pig); the level = **one fenced farm compound**, not open world, not too big / small.
- Git: Claude pushes to the session branch → user opens a PR and merges to `main` → GitHub Pages deploys (`.github/workflows/pages.yml`).
  Give exact PR title / text when asking for a merge.
- Claude CAN run the game here: `cd web && npx vite build && npx vite preview --port 4173`, then headless Chromium via Playwright
  (`--use-angle=swiftshader`, `?auto=1&q=low`; software GL ≈ 10 fps so the sim runs slower than real time — wait on
  `window.__G.time`, not wall time). Test hooks: `window.__game` (`scripted` input override, `cam`, `local`, `pigs`), `window.__G`.

## Tech (`web/`)
- TypeScript + Vite 6, **three 0.170**, **Rapier 0.14** (`@dimforge/rapier3d-compat`, gravity −20, fixed 60 Hz + render
  interpolation via `Synced`), **postprocessing 6.36** (ink outline → bloom / hue / NEUTRAL tone map / vignette → SMAA). N8AO installed, unused.
- Cartoon rendering: every loaded model is `toonify`-ed (MeshToonMaterial + 3-band `RAMP`), `InkOutline` = depth-Laplacian edges;
  grass blades don't write depth (renderOrder 5) so they get no lines. Gradient sky dome + puffy toon clouds, hemisphere + sun
  (shadow map follows the player, texel-snapped). `?q=low` = smaller shadows / less grass / pixel ratio 1; **P** toggles.
- Planned online: host-authoritative (host browser simulates, others send `PigInput`, get snapshots) over a small WebSocket relay
  with room codes (copy the design of `ohavs/Nice-Crash-` `server/relay.js`); relay on Render free. `PigInput` already decouples input.
- Assets: `web/tools/fetch_assets.sh` (idempotent) fetches CC0 packs from GitHub mirrors — Kenney `ETdoFresh/kenney.nl`, KayKit
  `KayKit-Game-Assets/*`, Quaternius `tilakpatell/tilakverse-assets` (asset websites are blocked from the sandbox, GitHub is not) —
  plus converts repo art (Unity `Assets/Art`: Quaternius Farm Buildings FBX → GLB via `fbx2gltf`, Cube Pets, Medieval kit, user audio)
  with `gltf-transform` (GLB, textures ≤ 512 px, WebP) into `web/public/assets/` (committed, ~13 MB).

## Structure (`web/src`)
| Path | What |
|---|---|
| `main.ts` | Boot: preload models / sounds (progress bar), physics init, build game, title → click to play (pointer lock), `?auto=1`. |
| `game/game.ts` | Game loop: fixed steps (pig `preStep` → critters → physics `step` (prop impact sounds) → `postStep`), render interpolation, camera, HUD. `PLAYER_COLORS`. Keys H help, M mute, P quality, R respawn. |
| `game/ctx.ts` | `G` shared context (time, fx, audio, terrain, `holdables`, `noises` (for the farmer later), `clouds` (fart smoke)), `Holdable` interface. |
| `game/camera.ts` | Orbit camera (mouse), pulls in on walls (ray vs STATIC), shake. `basis()` for camera-relative movement. |
| `game/hud.ts` | HTML HUD: ability rings with cooldowns (LMB / Shift / Q / C / E), grab prompt, throw charge bar, muddy status, toasts, help. |
| `pig/pig.ts` | **Pig** (all equal, tune in `PIG`): Rapier dynamic body, colliders swap: 4 legs = horizontal capsule, 2 legs = vertical capsule, ragdoll = cuboid with rotations unlocked. Move / jump (coyote, buffer, short hop) / faces camera yaw while moving (user decision), sprint (ram knocks things, wall = bonk ragdoll), fart (launch + cloud + radial blast, noise), wallow (in mud → muddy 60 s; hold = play dead), grab / drag (>26 kg) / charge-throw, carry pigs (mash jump to escape). Ragdoll on big velocity changes or fast objects; mash jump to get up. |
| `pig/pigModel.ts` | Procedural cartoon pig (pear body, head, snout, eyes, blush, floppy ears, curly tail, stubby legs) → rig. |
| `pig/pigVisual.ts` | Procedural animation: trot, stand-up hinge (`PIVOT` hind hips, front legs → arms), wallow roll, flail, ears / tail / blink, squash & stretch, mud tint, party hat (player colour). |
| `world/farm1.ts` | **Farm 1** layout (north = −z, farm x −64..64, z −110..20, fence + hedge + invisible walls, gate south): sty (start, x 24..37 z 2..14, mud, hut), big barn (walk-in), farmhouse, garage, silo, chicken pen, cow pasture, garden, orchard, corn field, windmills, well, hay shed; props, critters, trees. Buildings use trimesh colliders from their mesh. |
| `world/terrain.ts` | Ground: heightfield (flat farm, hills outside), canvas splat map (paths / dirt / mud), toon shader + patchwork fields outside the fence, trimesh collider, `mudAt`, `isBare`. |
| `world/nature.ts` | Instanced cartoon trees / bushes / hedges from smooth blobs; procedural hay bale. |
| `world/props.ts` | `Prop` (dynamic, holdable, impact sounds) + `PROPS` table (crates, veggie crates, barrels, pumpkins, melons, logs, wheel, hay, sword…). |
| `world/animals.ts` | `Critter` (Cube Pets models + their animations: wander, flee pigs, tumble when hit, small ones holdable), `decorAnimal`. |
| `render/` | `gfx.ts` renderer / sky / lights / post, `toon.ts` (RAMP, toonify, InkOutline), `grass.ts` (instanced wind blades, pushed by pigs), `fx.ts` (pooled point-sprite particles + shake), `textures.ts` (canvas textures). |
| `core/` | `physics.ts` (world, layers `L`, owners map, ignore-pair hook for held objects, static box / cylinder / trimesh, raycast), `input.ts` (keyboard / mouse / gamepad, latched presses), `audio.ts` (WebAudio, 3D one-shots, music crossfade), `assets.ts` (GLTF preload, `instance`, `fitted`), `synced.ts`, `util.ts`. |

## Controls
WASD move · mouse look · Space jump · LMB grab / hold to throw · Shift sprint · Q fart · C wallow (hold = play dead) · E stand ·
F oink (placeholder sound) · H help · M mute · P quality. Gamepad: A jump, B fart, X wallow, Y stand, RT grab, LB/L3 sprint.

## Legacy
The Unity project (`Assets/`, `ProjectSettings/`, …) is kept untouched as reference (stage 1–8 history in git). Its art is reused via
`fetch_assets.sh`. Don't edit it.

## Roadmap (web)
1. ✅ **M1 (2026-11-12)**: web skeleton, cartoon Farm 1, procedural pig with all moves + ragdoll, props, critters, HUD, Pages workflow.
2. **M2 Farmer Bob**: routine (chores at places), suspicion per pig (4 legs + empty mouth = "just a pig"), noise (`G.noises`),
   chase, grab windup, carry to the cage, BBQ timer, poise (stacked strong hits → drop / knockdown ragdoll). Bob = Mixamo FBX in the
   Unity folder → convert (fbx2gltf) + toonify; style check vs. the cartoon look.
3. **M3 Online** 4 players (relay + room codes, host-authoritative snapshots).
4. **M4** loot / missions / round loop / weapons (KayKit sword / axe, rocks, rifle pack from the user).
5. **M5** alert levels, dog, traps, modifiers, more farms, shop.

## Status / next step
- 2026-11-12: M1 built & checked in headless Chromium (screenshots: cartoon look, round pig, stand / wallow / fart / ram / throw work).
  Pushed on the session branch. **User to do**: make the repo public, Settings → Pages → Source "GitHub Actions", merge the PR →
  game at `https://ohavs.github.io/Porkour/`. Then feedback on feel → M2.
- Ideas noted: round cartoon farm animals (Cube Pets critters are still boxy), real oink / pig sounds (freesound CC0), rollable hay
  bales (cylinder collider along x), glossier mud.

## Known issues / TODO
- Never tested on a real GPU: check FPS (grass density 16/m² high), shadows, outline thickness.
- `fart_short` / `fart_deep` / music come from the user's Unity `Assets/Audio` (license as downloaded by the user).
- Bob (Mixamo) in a public repo: fine for a game, avoid redistributing raw FBX elsewhere.
