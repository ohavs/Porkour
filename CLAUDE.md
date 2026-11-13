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
  `daynight`, `adminAction(...)`), `window.__G`, `window.__ADMIN`, `window.__wardrobe`, `__online`, `__lobby`. URL: `?hour=21.5`, `?bob=0`, `?admin=1`.
  Online tests: `cd server && npm test` (protocol); `DEBUG=1 PORT=8080 node server.js` + two Playwright contexts
  (host creates via `#tOnline` → `[data-a=create]` → `[data-a=start]` (force click), player opens `?room=CODE`). Software GL is
  very slow with 2 pages (first frame compiles shaders for a minute+): use small viewports and generous timeouts.

## Tech (`web/`)
- TypeScript + Vite 6, **three 0.170**, **Rapier 0.14** (`@dimforge/rapier3d-compat`, gravity −20, fixed 60 Hz + render
  interpolation via `Synced`), **postprocessing 6.36** (ink outline → bloom / hue / NEUTRAL tone map / vignette → SMAA). N8AO installed, unused.
- Characters are procedural (pig, Bob, all animals) in one cel-shaded style; packs only for buildings / props / hats.
- **Real physics (M4.5)**: `core/ragdoll.ts` = active ragdoll: torso = the character's own locomotion body; head + limbs =
  rigid bodies on spherical joints, **switched off while in control** (animation drives the visual, zero cost) and woken
  in the current pose when limp (`Tone`: ragdoll / carried / dragged): they collide, flop, flail with muscle tone + soft
  limits; visuals slerp each part to its physical rotation (`rel`). Pig (`pigBody.ts`: head + 4 legs), Bob (head, 2 arms,
  2 legs; knock-down = torso unlocks and falls, belly = trampoline), critters (`animalLimbs` measured from the rig).
  `core/grip.ts` = invisible hand body + spherical joint at the grabbed point + force-limited motor (lift / drag limits →
  light things dangle, heavy ones drag, snagged ones slip): pig snout / hooves (wind-up + swing throw), Bob's hands and wolf
  jaws hold pigs by the `SCRUFF`. Snapshots carry part rotations (3 numbers / part) + hand position; entity numbers ≤ 64.
- Cartoon rendering: every loaded model is `toonify`-ed (MeshToonMaterial + 3-band `RAMP`), `InkOutline` = depth-Laplacian edges;
  grass blades don't write depth (renderOrder 5) so they get no lines. Gradient sky dome (+ sun glow) + puffy toon clouds, stars,
  moon, hemisphere + key light (sun by day, moon at night; shadow map follows the player, texel-snapped). Lamps = point lights
  (never toggle `visible` on lights: it recompiles every material — set intensity). Quality switch is live (`Gfx.setQuality`).
- **Online (M4, `web/src/net/` + `server/`)**: host-authoritative like Human: Fall Flat / Gang Beasts — the host's browser runs
  the whole sim; players send `PigInput` (~30 Hz, latched presses) and get binary snapshots 30 Hz (`sync.ts`: per-entity
  delta vs last sent, field bitmasks, keyframe on join / gap / path switch), rendered ~70–300 ms in the past with
  interpolation (adaptive to jitter). Every synced class has `netState(n, s)` / `netApply(n, s)` (+ `netPose`); entity order
  = `entities()` (pigs, Bob, cage, critters, props); wolves by `netId`. Host records sounds / fx / shakes / `G.events` made
  inside fixed steps (`G.rec`, `installRecorders`) and players replay them; `G.shakeFor(pig, amt)` for per-player shakes;
  `G.mute` drops local side effects while applying. Transport (`online.ts`): WebRTC data channel host↔player (P2P,
  STUN only) with fallback through the server relay. Server `server/server.js` (Node, `ws` + `jose`): Google ID-token
  verification or guest, rooms (4-letter code, public list, quick play, kick, chat, outfit/name), relay; `render.yaml`
  (Render free). Lobby UI `lobby.ts`; Google Identity Services in `auth.ts`; addresses in `config.ts` (`BUILT_IN_SERVER`,
  `BUILT_IN_GOOGLE_CLIENT_ID` (set; origin https://ohavs.github.io), see `server/README.md`). Online never pauses; the host keeps
  simulating in a hidden tab (worker ticks). Leaving = reload to `?lobby=1`. Invite link `?room=CODE`.
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
| `main.ts` | Boot: settings + language, preload models / sounds (progress bar), physics, build game, title (play / online / wardrobe / language), Esc → menu. |
| `net/` | `online.ts` (server link, rooms, WebRTC P2P + relay), `sync.ts` (NetHost / NetClient snapshots + inputs), `codec.ts`, `refs.ts` (who-holds-what ids), `lobby.ts` (UI), `auth.ts` (Google / guest), `config.ts`. |
| `i18n.ts` | `t(key, vars)`, `en` + `es` dictionaries (all UI text), `setLang`, `data-i18n` DOM attributes. |
| `game/game.ts` | Game loop: fixed steps (clock, pigs, Bob, critters, wolves, physics, cage, pond cleans mud), render, camera, events → toasts, `adminAction`. |
| `game/ctx.ts` | `G` shared context (time, hour/day/night, fx, audio, pigs, farmer, wolves, noises, clouds…), `ADMIN` switches, `SECS_PER_HOUR` 25 (day = 10 min). |
| `game/hud.ts` | HUD: ability rings (+ labels), clock dial, Bob chip + ?/! marker, prompts, wobble bar, controls card (shown 16 s at start, H). |
| `game/menu.ts` | Top-right buttons (sound / controls / settings), settings menu (language, graphics, volumes, sensitivity, invert), admin panel. |
| `game/wardrobe.ts`, `game/settings.ts` | Wardrobe overlay (own preview renderer); localStorage settings (incl. outfit). |
| `core/ragdoll.ts`, `core/grip.ts`, `pig/pigBody.ts` | Active ragdoll parts (generic), grip hand + joint, pig part layout (`CENTER` per shape, `SCRUFF`). |
| `pig/pig.ts` | **Pig** (tune in `PIG`, grip targets in `GRIP`): moves, jump, sprint/ram, fart, wallow, grab/drag/throw, ragdoll. **Standing**: punch (LMB, empty hooves, counts on Bob's poise), lifts 50 kg, throws ×1.35, opens latches ×2, but `wobble` builds (turning, speed, carrying, landing) → falls over; easier to knock down. |
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
4. ✅ **M4 Online (2026-11-12)** 4 players: server (Google / guest, rooms, relay), lobby, P2P + relay, host snapshots.
   Google Client ID is set (config.ts + server.js). OAuth consent: publish with name + email + home page + privacy link,
   never a logo (a logo triggers Google verification). Server live on Render: `wss://porkour-server.onrender.com` (auto-deploys from main; the sandbox proxy blocks
   onrender.com, so it can't be reached from here).
5. 🟡 **M4.5 Real physics (2026-11-13)**: ✅ pigs (parts, joint grab, swing throw, pig grabs pig by the scruff), ✅ Bob
   (ragdoll knock-down, carries pigs dangling from his hands, real shakes), ✅ animals (limp head + legs when tumbling / held),
   ✅ wolves drag pigs by a jaw joint. Left: wolves' own ragdoll, Bob stagger as physics, **client-side prediction** of your
   own pig online (next).
6. **M5** loot / missions / round loop / weapons; then alert levels, dog helper, traps, modifiers, more farms, shop.

## Status / next step
- 2026-11-12: M3 built & checked headless (see the PR). User to do: drop missing sounds (`web/sfx_user/README.md`), feedback on
  feel on a real PC (wobble, slap chance 30 %, grip 24 mashes, wolves, night length).
- 2026-11-12: M4 online built & tested locally (2 headless browsers: lobby, chat, P2P, start, late join, movement).
  2026-11-13: Google client id + Render server set; privacy page `web/public/privacy.html` (for the consent screen).
  ✅ User confirmed: 2 people joined the same lobby online. **Next: M4.5 real physics** (start with pigs: multi-body pig +
  joint grab + real throw), then client-side prediction. Ask the user how actual online play felt (lag) when convenient.
  User feedback: don't base designs on Nice-Crash (a few-prompts game) — take inspiration from real games.
- 2026-11-13: M4.5 physics built & checked headless (pigs / Bob / wolf / hen, online part sync). Admin → Physics buttons:
  knock me over, bring a crate / pig, Bob carries me, knock Bob down. Ask the user how grabbing / throwing / ragdolls feel.
  **Next: client-side prediction** (own pig rendered from local input, reconciled with host snapshots), then M5.
- Ideas noted: real oink set is from VoxeLibre/0 A.D. — the user may want more pig variety; Bob voice lines ("Hey!") need a recording.

## Known issues / TODO
- Camera clips into the boundary hedge (no collider) when a pig is held near the fence.
- Untested: guard mode (2 caged), fist (unreachable pig). Bob's HUD marker sits low while he lies ragdolled (pos = torso).
- Sim cost +20–35 % vs before M4.5 (grip hands / joints); parts cost nothing while in control.
- Never tested on a real GPU: FPS with ~9 lamp lights + grass density 16/m² (high), shadows, outline thickness.
- Bob's mower parking collider is not in the nav grid (Bob can bump into it; the stuck logic copes).
