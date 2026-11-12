# Porkour — CLAUDE.md (living doc)

> Update at every milestone and **before** telling the user they can `/clear`. Keep it short: status + decisions + next.

## The game (design = `GDD.md`, still evolving — user: "a very initial idea that needs developing")
Browser game, online co-op for up to 4 players: **4 equal pigs** (fart / sprint-ram / mud wallow, stand on 2 legs, grab & throw,
ragdoll) rob and wreck a farm while **farmer Bob** goes about his daily routine. Spotted → he grabs you (or slaps you) → cage → BBQ;
teammates bash him (only strong hits count) or free you. Day/night clock, wolves at night. ~10-min rounds, several farms,
missions (steal / wreck / pranks), coins + XP → shop later. Inspirations: Untitled Goose Game, Burglin' Gnomes, Hello Neighbor,
Dead by Daylight, Party Animals.

## Working with the user
- **Every reply in Hebrew** (code / paths / UI names stay English). This file is English. User has no game-dev experience.
- **Save tokens**: short answers. At the end of every stage: commit + push, update this file, and say explicitly
  whether it is safe to `/clear`.
- **Work autonomously** — the user downloads things only when at a PC; do everything possible without them.
- **Languages: English + Spanish, full support, forever.** Every new UI string goes through `t()` (`web/src/i18n.ts`) with an
  `en` AND an `es` entry in the same change (`es` is typed `Record<Key, string>`, so a missing entry fails `tsc`).
- **GitHub: Claude handles it** (user 2026-11-12): push the session branch, open the PR (GitHub MCP), merge it when it is ready,
  watch Pages. If something is needed from the user (permissions, settings), write exact steps.
- **Sounds: real recordings only** (user: "Claude always uses the same sounds, you can hear it"). No Kenney audio, no synthesized
  placeholders. Sources = open-source games on GitHub (see Assets). Missing ones → listed in `web/sfx_user/README.md` for the user.
- Admin mode (user request): `` ` `` key / menu button / `?admin=1` — keep it updated with test switches for new features.
- Quality bar: "not embarrassing next to popular Steam games" — use many free technologies / assets; no "AI slop" look.
- Look (user feedback): **cartoon, not realistic**; pigs **round, fat, long**; animals must not look like Roblox (Cube Pets were
  replaced by procedural round animals); the level = **one fenced farm compound**. Standing on 2 legs must be worth it and wobbly.
- Claude CAN run the game here: `cd web && npx vite build && npx vite preview --port 4173`, then headless Chromium via Playwright
  (`--use-angle=swiftshader`, `?auto=1&q=low`; software GL ≈ 10 fps so the sim runs slower than real time — wait on
  `window.__G.time`, not wall time). Test hooks: `window.__game` (`scripted` input override, `cam`, `local`, `pigs`, `farmer`,
  `daynight`, `adminAction(...)`), `window.__G`, `window.__ADMIN`, `window.__wardrobe`. URL: `?hour=21.5`, `?bob=0`, `?admin=1`.

## Tech (`web/`)
- TypeScript + Vite 6, **three 0.170**, **Rapier 0.14** (`@dimforge/rapier3d-compat`, gravity −20, fixed 60 Hz + render
  interpolation via `Synced`), **postprocessing 6.36** (ink outline → bloom / hue / NEUTRAL tone map / vignette → SMAA). N8AO installed, unused.
- Characters are procedural (pig, Bob, all animals) in one cel-shaded style; packs only for buildings / props / hats.
- Cartoon rendering: every loaded model is `toonify`-ed (MeshToonMaterial + 3-band `RAMP`), `InkOutline` = depth-Laplacian edges;
  grass blades don't write depth (renderOrder 5) so they get no lines. Gradient sky dome (+ sun glow) + puffy toon clouds, stars,
  moon, hemisphere + key light (sun by day, moon at night; shadow map follows the player, texel-snapped). Lamps = point lights
  (never toggle `visible` on lights: it recompiles every material — set intensity). Quality switch is live (`Gfx.setQuality`).
- Planned online: host-authoritative (host browser simulates, others send `PigInput`, get snapshots) over a small WebSocket relay
  with room codes (copy the design of `ohavs/Nice-Crash-` `server/relay.js`); relay on Render free. `PigInput` already decouples input.
- Assets: `web/tools/fetch_assets.sh` (models, idempotent) + `web/tools/fetch_sounds.sh` (audio) fetch from GitHub mirrors
  (asset websites are blocked from the sandbox, GitHub is not) into `web/public/assets/` (committed). Models: Kenney
  `ETdoFresh/kenney.nl`, KayKit `KayKit-Game-Assets/*` (Restaurant, Adventurers, Skeletons, Halloween), Quaternius
  `tilakpatell/tilakverse-assets`, repo art (Quaternius Farm Buildings FBX → GLB via `fbx2gltf`, Medieval kit) via `gltf-transform`.
  KayKit hats / capes are cut out of the character GLBs by `tools/extract_nodes.mjs`. Sounds: VoxeLibre (CC0 / MIT), 0 A.D.
  (CC BY-SA 3.0), Battle for Wesnoth (GPL-2+, replace before a commercial release), Veloren crickets/birds (CC BY 4.0), user's own
  farts + music (`Assets/Audio`). Credits: `public/assets/sfx/CREDITS.md`. User drop-ins: `web/sfx_user/` → `fetch_sounds.sh`.

## Structure (`web/src`)
| Path | What |
|---|---|
| `main.ts` | Boot: settings + language, preload models / sounds (progress bar), physics, build game, title (play / wardrobe / language), Esc → menu. |
| `i18n.ts` | `t(key, vars)`, `en` + `es` dictionaries (all UI text), `setLang`, `data-i18n` DOM attributes. |
| `game/game.ts` | Game loop: fixed steps (clock, pigs, Bob, critters, wolves, physics, cage, pond cleans mud), render, camera, events → toasts, `adminAction`. |
| `game/ctx.ts` | `G` shared context (time, hour/day/night, fx, audio, pigs, farmer, wolves, noises, clouds…), `ADMIN` switches, `SECS_PER_HOUR` 25 (day = 10 min). |
| `game/hud.ts` | HUD: ability rings (+ labels), clock dial, Bob chip + ?/! marker, prompts, wobble bar, controls card (shown 16 s at start, H). |
| `game/menu.ts` | Top-right buttons (sound / controls / settings), settings menu (language, graphics, volumes, sensitivity, invert), admin panel. |
| `game/wardrobe.ts`, `game/settings.ts` | Wardrobe overlay (own preview renderer); localStorage settings (incl. outfit). |
| `pig/pig.ts` | **Pig** (tune in `PIG`): moves, jump, sprint/ram, fart, wallow, grab/drag/throw, ragdoll. **Standing**: punch (LMB, empty hooves, counts on Bob's poise), lifts 50 kg, throws ×1.35, opens latches ×2, but `wobble` builds (turning, speed, carrying, landing) → falls over; easier to knock down. |
| `pig/pigModel.ts`, `pigVisual.ts`, `cosmetics.ts` | Procedural pig + anchors (head, eyes, snout, chin, neck, back); animation (sway, punch, windmill arms); wardrobe items: 11 skins, 18 hats (7 from KayKit), 6 hair, 5 beards, 6 glasses, 6 neck, 6 back (4 KayKit capes). |
| `world/farm1.ts` | **Farm 1** layout + `CHORES` on a clock (day loop, evening flashlight patrol, night = bed). Zones: garden, lawn (mowing), house door, mower spot, pond. |
| `world/decor.ts` | Lantern posts (lamps), duck pond (washes mud), laundry line, scarecrow + crow, beehives + bees, picnic table, outhouse, mailbox, rocking chair, pumpkin patch, trough. |
| `world/daynight.ts` | Clock → sky / sun / moon / stars / fog / light palette, lamps, day birds ↔ night crickets, rooster at dawn, dusk/dawn events. |
| `world/animalModels.ts`, `animals.ts` | Procedural round animals (hen, chick, cow, dog, cat, bunny, wolf, sheep, duck) + `AnimalVisual` (walk/hop/peck/wag/flap). `Critter` (wander, flee pigs & wolves, hens roost at night, dog barks at wolves → wakes Bob), `DecorAnimal`. |
| `world/wolf.ts` | Night wolves (`WolfPack`, 21:00–04:30): slip under the fence, chase pigs, bite + drag them off the farm (mash to escape, ram / punch / fart scares them, Bob shoos them), leave at dawn. |
| `world/cage.ts` | Bob's cage + BBQ (`ADMIN.bbqTime`, default 90 s); latch (standing ×2), ram bursts the door. |
| `world/terrain.ts`, `nature.ts`, `props.ts` | Ground (splat map, `mudAt`), instanced trees/bushes/hedges, `Prop` + `PROPS`. |
| `farmer/farmer.ts` | **Bob** brain (tune in `BOB`): clock routine, suspicion, noises, chase, grab (windup/lunge) **or slap** (30 %, insult toast, taunt), carry (grip: 24 mashes, drains, shakes every 2.2 s), cage, dance (random / after caging), lawn mowing, flashlight at night, sleeps in the house (noises wake him), shoos wolves, poise → stagger / knock-down. |
| `farmer/farmerModel.ts`, `farmerVisual.ts`, `mower.ts`, `nav.ts` | Procedural Bob + tools (bucket, can, axe, mug, hammer, paper, flashlight, shirt) + poses (ride, slap, taunt, 4 dance moves, read, laundry…); ride-on mower (cuts `Grass` via a mow texture, regrows); nav grid + A*. |
| `render/` | `gfx.ts` (renderer / sky / stars / moon / lights / post, `setQuality`), `toon.ts`, `grass.ts` (wind, pushers, mowing), `fx.ts`, `textures.ts`. |
| `core/` | `physics.ts`, `input.ts`, `audio.ts` (buses sfx / ambience / music, loops), `sounds.ts` (sound manifest + OPTIONAL list), `assets.ts`, `synced.ts`, `util.ts`. |

## Controls
WASD move · mouse look · Space jump · LMB grab / hold to throw / punch (standing) · Shift sprint · Q fart · C wallow (hold = play dead) ·
E stand · F oink · H controls · M sound · P graphics · Esc menu · `` ` `` admin. Gamepad: A jump, B fart, X wallow, Y stand, RT grab, LB/L3 sprint.

## Legacy
The Unity project (`Assets/`, `ProjectSettings/`, …) is kept untouched as reference. Its art/audio is reused by the fetch scripts. Don't edit it.

## Roadmap (web)
1. ✅ **M1**: web skeleton, cartoon Farm 1, procedural pig, props, critters, HUD, Pages workflow.
2. ✅ **M2 Farmer Bob**: routine, suspicion, chase, grab, carry, cage + BBQ, rescue, poise, fart cough.
3. ✅ **M3 Living farm (2026-11-12)**: real sounds, EN/ES, HUD cleanup + settings + admin, standing rework, Bob slap / dance /
   mower / night routine, day/night + lamps, wolves, round animals, wardrobe, farm dressing.
4. **M4 Online** 4 players (relay + room codes, host-authoritative snapshots).
5. **M5** loot / missions / round loop / weapons; then alert levels, dog helper, traps, modifiers, more farms, shop.

## Status / next step
- 2026-11-12: M3 built & checked headless (see the PR). User to do: drop missing sounds (`web/sfx_user/README.md`), feedback on
  feel on a real PC (wobble, slap chance 30 %, grip 24 mashes, wolves, night length).
- Ideas noted: real oink set is from VoxeLibre/0 A.D. — the user may want more pig variety; Bob voice lines ("Hey!") need a recording.

## Known issues / TODO
- Camera clips into the boundary hedge (no collider) when a pig is held near the fence.
- Bob has no ragdoll physics (knock-down is an animation + lying capsule). Untested: guard mode (2 caged), fist (unreachable pig).
- Never tested on a real GPU: FPS with ~9 lamp lights + grass density 16/m² (high), shadows, outline thickness.
- Bob's mower parking collider is not in the nav grid (Bob can bump into it; the stuck logic copes).
