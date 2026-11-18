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
- **Pending checks (user 2026-11-13)**: the user `/clear`s and forgets. EVERY final reply of an update ends with the full
  list from "Pending user checks" below (in Hebrew), until the user reports on an item → then remove it from the list.
- **Work autonomously** — the user downloads things only when at a PC; do everything possible without them.
- **Languages: English + Spanish, full support, forever.** Every new UI string goes through `t()` (`web/src/i18n.ts`) with an
  `en` AND an `es` entry in the same change (`es` is typed `Record<Key, string>`, so a missing entry fails `tsc`).
- **GitHub: Claude handles it** (user 2026-11-12): push the session branch, open the PR (GitHub MCP), merge it when it is ready,
  watch Pages. If something is needed from the user (permissions, settings), write exact steps.
- **Sounds: real recordings only** (user: "Claude always uses the same sounds, you can hear it"). No Kenney audio, no synthesized
  placeholders. Sources = open-source games on GitHub (see Assets). Missing ones → listed in `web/sfx_user/README.md` for the user.
- **Less text on screen (user 2026-11-17)**: "too much text, every item comes with explanations". Show, don't tell:
  prompts = key/mouse icon + action icon (`game/icons.ts` `IC`, `kc()`), status = icon badges, events = icon pops over
  the actor (`hud.emote(actor, icon)`), toasts only for coins / prank done / danger / round beats (one short line +
  icon, never a subtitle). New features get an icon or a world cue, not a hint sentence.
- **Owner account (user 2026-11-18)**: the user's Google account (only its e-mail's SHA-256 is in the code: `OWNER_HASH` in
  `net/auth.ts` + `OWNER_HASHES` in server.js — the repo is public, never write the e-mail) = all coins + level 99
  (`ownerPerks`), and the admin panel's 👑 tab: players online (server op `users`) → give coins / levels (`gift`) or the
  admin mode (`grant`, kept in that browser's localStorage). **Admin mode = the owner + whoever the owner granted it to**
  (`canAdmin()`; localhost test builds too).
- **Game-like design (user 2026-11-18)**: "get rid of the basic look" — wood cards (brown gradient, ink border, gold inner
  line, drop shadow), chunky cream buttons that press down, icon tiles with one or two words (full sentence in the
  tooltip). Use it for every new screen.
- **Every held / used thing shows what it does (user 2026-11-18)**: a prompt for its action (LMB use, R pour, the place it
  goes `HANDS.destIcon`), and every mission line shows how to do its next step as icons (`Round.mHow`, chains:
  `Chain.stepIcons`).
- **Story vs Modes (user 2026-11-18)**: story = stages 1–5 (farm 1..5, unlocked by winning the one before
  `SETTINGS.story`, harder each stage: `STAGE` quota × / Bob wary from stage 4); the chain farms (cannabis, beer) are
  separate "Modes" in the farm picker. **Saves (user 2026-11-18)**: 5 story save slots at the host (solo too:
  `game/saves.ts`, in settings): 💾 chip above the farm card → saves card (load / new game / start over / delete; each
  slot shows its stages, stars, who played, date); a won stage goes into the save in use; results "Next stage ▶" (in a
  room: the whole room reloads onto it); the room shows the host's save label to the players (server `room.save`).
- Admin mode (user request): `` ` `` key / menu button / `?admin=1` — keep it updated with test switches for new features.
  **Tabs (s17, user: "simplify it")**: Me (powers: fly, ghost = Bob / dog / animals / wolves / traps ignore me (`ignored(p)` in
  ctx.ts), teleports) · Players (per pig: jail = sky cell `world/jail.ts`, freeze, launch, knock, bring, go to, ghost) · Bob ·
  World · Farm (this farm's / mode's buttons) · Items. New test switches go into the matching tab. Host / solo only.
  **First person** (admin → Me, or `?fp=1`; user wants to try it, maybe for real later): camera in the pig's head
  (`CamRig.updateFP`), my pig hidden, `game/fpHands.ts` = FPS-style pink arms + hooves (camera children, drawn on top):
  trot on four legs, T-rex standing, jab on a punch, both forward when holding, back on a wind-up, hoof to mouth eating.
- Quality bar: "not embarrassing next to popular Steam games" — use many free technologies / assets; no "AI slop" look.
- Look (user feedback): **cartoon, not realistic**; pigs **round, fat, long**; animals must not look like Roblox; the level =
  **one fenced farm compound**. Standing on 2 legs must be worth it and wobbly. **Animals + characters as goofy / ragdolly as
  possible** (user 2026-11-13): big heads, googly eyes, floppy ragdolls. Buildings / props may be colourful and from any pack.
- Claude CAN run the game here: `cd web && npx vite build && npx vite preview --port 4173`, then headless Chromium via Playwright
  (`--use-angle=swiftshader`, `?auto=1&q=low`; software GL ≈ 10 fps so the sim runs slower than real time — wait on
  `window.__G.time`, not wall time). Test hooks: `window.__game` (`scripted` input override, `cam`, `local`, `pigs`, `farmer`,
  `daynight`, `adminAction(...)`, `mode` 'lobby' | 'play', `stage`), `window.__G`, `window.__ADMIN`, `window.__wardrobe`, `__online`, `__lobby`, `__lobbyUI`.
  URL: `?auto=1` (skips the lobby: straight into a round), `?hour=21.5`, `?bob=0`, `?admin=1`.
  Online tests: `cd server && npm test` (protocol); `DEBUG=1 PORT=8080 node server.js` + two Playwright contexts
  (host: `#tOnline` → `[data-a=create]` (force) → wait `__lobby.inRoom`; player opens `?room=CODE`; host clicks `#lPlay` = start). Software GL is
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
  `G.mute` drops local side effects while applying. **Client-side prediction** (`ADMIN.predict`): the player's own pig
  is simulated on their machine (`Pig.predictStep`: move / jump / sprint / fart launch / stance / wallow; `Game.predict`
  steps the client world where every other body is kinematic, placed from snapshots) and its pose rides along with the
  inputs; the host's copy follows it (`Pig.follow`, capped catch-up). Anything that pushes the pig on the host (knock,
  ram, respawn, ragdoll, carried, divergence > 3 m) → `hostTakes()` window (netState flag 64): the player stops predicting,
  shows the host's pig, then resumes from the latest snapshot. What I hold is drawn relative to my predicted pig (`carryAlong`).
  Transport (`online.ts`): WebRTC data channel host↔player (P2P,
  STUN only) with fallback through the server relay. Server `server/server.js` (Node, `ws` + `jose`): Google ID-token
  verification or guest, rooms (4-letter code, public list, quick play, kick, chat, outfit/name), relay; `render.yaml`
  (Render free). Lobby UI `lobby.ts`; Google Identity Services in `auth.ts`; addresses in `config.ts` (`BUILT_IN_SERVER`,
  `BUILT_IN_GOOGLE_CLIENT_ID` (set; origin https://ohavs.github.io), see `server/README.md`). Online never pauses; the host keeps
  simulating in a hidden tab (worker ticks). Leaving = reload to `?lobby=1`. Invite link `?room=CODE`.
- **Performance (2026-11-13)** — scale by *kinds*, not copies; keep it this way when adding content:
  static models MUST be placed through farm helpers (`building` / `decor` / `fence`, or push to `out.statics`) →
  `instanceStatic` turns every repeated part into chunked (36 m) InstancedMeshes; procedural models MUST call
  `rigidSkin(root, keepMeshes, keepMats)` once built (`render/batch.ts`): all meshes → one SkinnedMesh per material
  whose bones are the existing pivots (animation code unchanged); plain toon colours share a vertex-colour material;
  meshes moved/swapped by code → `keep`, materials recoloured live (pig skin, Bob face, cloud) → `keepMats`; hidden
  subtrees (Bob's tools) and named meshes stay separate. Result: 3,368 → ~620 meshes, ~3,100 → ~650 draw calls / frame,
  same look (checked side by side). Graphics options `render/quality.ts` (`SETTINGS.preset` auto/low/medium/high/ultra/custom +
  `SETTINGS.gfx`): auto = from the GPU name; resolution + dynamic resolution (drops to 55 % below ~50 fps, steps back up),
  shadows 0–4, grass level (built once at 16/m², shows a fraction), lamp-light pool (2/4/6/all nearest lamps, the last
  one fades), small-detail distance (instanced chunks of things < 0.5 m), outline / bloom / FXAA|SMAA, HD-screen pixel
  ratio, FPS cap. Post = 1 effect pass (outline + bloom + colour + tone + vignette) + AA pass. Slow at min resolution
  for 8 s → tip toast.
- Assets: `web/tools/fetch_assets.sh` (models, idempotent) + `web/tools/fetch_sounds.sh` (audio) fetch from GitHub mirrors
  (asset websites are blocked from the sandbox, GitHub is not) into `web/public/assets/` (committed). Models: Kenney
  `ETdoFresh/kenney.nl`, KayKit `KayKit-Game-Assets/*` (Restaurant, Adventurers, Skeletons, Halloween), Quaternius
  `tilakpatell/tilakverse-assets` + `trebeljahr/quaternius-showcase` (GLBs: animals, RPG items, Survival, Ultimate Crops, house
  interior, weapons, buildings… — check it first for new content; `chibifire-stages/quaternius-stage` has every pack as .usda), repo art (Quaternius Farm Buildings FBX → GLB via `fbx2gltf`, Medieval kit) via `gltf-transform`.
  KayKit hats / capes are cut out of the character GLBs by `tools/extract_nodes.mjs`. Sounds: VoxeLibre (CC0 / MIT; rustle = mcl_sounds grass, CC BY 3.0), 0 A.D.
  (CC BY-SA 3.0), horse / donkey / sheep (VoxeLibre, CC BY 3.0 / CC0), Battle for Wesnoth (GPL-2+, replace before a commercial release), Veloren crickets/birds (CC BY 4.0), Minetest Game tnt fuse / bang (CC0), user's own
  farts + music (`Assets/Audio`), CDDA CC-Sounds + AntumMT sounds (phone, clock, glass; CC0 / CC BY), **Bob's voice = Hedgewars "HillBilly"
  voice pack (GNU FDL 1.2)**: `bob_hey` / `bob_grr` / `bob_insult` / `bob_win` / `bob_bye` / `bob_oops` / `bob_hello` / `bob_cough` + grunts / laugh;
  `Farmer.voice()` plays one spoken line at a time (`LINES`, `lineUntil`; angry lines fall back to a grunt). Credits: `public/assets/sfx/CREDITS.md`. User drop-ins: `web/sfx_user/` → `fetch_sounds.sh`.

## Structure (`web/src`)
| Path | What |
|---|---|
| `main.ts` | Boot: settings + language, preload models / sounds (progress bar), physics, build game, `game.enterLobby()` + `LobbyUI`, PLAY → `game.startPlay()`, Esc → menu. |
| `game/lobbyStage.ts`, `game/lobbyUI.ts` | **Lobby (s13, "Fortnite style, but the pig moves")**: `LobbyStage` = a farmyard diorama at z 760 (far from every farm; sky + clouds ride with the camera), fixed camera, invisible walls on the screen edges (rebuilt on resize; online every machine uses 16:9 walls), throwables (beach ball, apples, eggs, pie, crate, 2 cans, cigarettes: lobby copies with value 0, respawn). `Game.mode` 'lobby' (clock frozen at 16:24, `G.lobby`: idle pigs face the camera, holding / clicking = face the pointer, W = away from the camera, mouse not locked: `Input.free` + `mouseX/Y`) / 'play'. `LobbyUI`: top bar (Play / Wardrobe / Shop = wardrobe's gadget tab / Online, wallet, sound, full screen, settings), party (left), controls as icons, farm card + PLAY. Online: joining a waiting room = `goOnline` right away, the party plays on the stage, party panel = room (code, seats, chat, leave = reload); host's PLAY = start for all. |
| `game/saves.ts` | Story saves: `SLOTS` 5, `saves()` / `slot()` / `storyWon()` (unlocks), `newGame` / `loadGame` / `deleteSave`, `recordStage(stage, won, stars, names)` (Round, host / solo), `saveLabel()` ("💾 2 · ★★☆☆☆"). Old `SETTINGS.story` moves into save 1. UI in `lobbyUI.ts` (`#lSave` chip, `#saves` card, Esc closes). |
| `game/fullscreen.ts` | Full screen toggle (+ Keyboard Lock on Esc so Esc opens the menu). Buttons: HUD top-right, lobby top bar, settings. |
| `world/outhouse.ts` | **Bob's outhouse (s14)** — one per farm (decor kit `outhouse()` → `FarmBuild.loos`, `G.loos`, synced entity after the gates). Bob's toilet breaks (`LOO`): first ~70–120 s into the round, then every 150–210 s, taken between two chores (`nextChore`, not at night / market) → state `loo` (walks over) → `inLoo` (hidden like sleep, sees nothing ~18 s; a noise ≤14 m / a knock on the hut = he comes out within 5 s and looks there). Pigs: grab the **bolt**'s handle (outside, door side; a `slider` handle, s18) and slide it across (LMB = headbutt = a knock) → he bangs (hut jolts, noise) then bursts the door off after 20 s and searches angrily (prank `looLock`). **Rocking** (`rock` 0..1: ram 0.62, headbutt / punch 0.3 × strength, thrown things by momentum) → at 1 it **tips** (kinematic body turns about a bottom edge, snapped to the hut's 4 sides): with Bob inside = prank `looTip` — door up / sideways: he's flung out (knock-down), onto its door: stuck banging 10 s, then heaves it back up. Bob fixes a tipped hut / missing door when he sees it (`G.jobs`, `bob.fixLoo`). Admin → "Outhouse & safe". |
| `world/phone.ts`, `world/heavyLoot.ts` | **Bob's phone (s15)** = breathing window #2, one synced entity per farm (decor kit `phone(x, z, yaw, jx, jz)` + `payphone(x, z, yaw)` → `FarmBuild.phones`, `G.phones`). Old crank wall phone on a post by the porch: real calls (`PHONE.first` 110–160 s, then every 170–230 s, when `Farmer.phoneFree()`) ring (2 bursts / 3 s, ≤30 s) → Bob state `phone` (hurries over) → `onPhone` (16–24 s facing the box, view `phone` = narrow 12 m, glances over his shoulder every 6–10 s, hears only noises ≤9 m, `onPhoneHand` puts the receiver at his ear; coiled cord). Its wire runs to a **jack** on a stake: grab the plug (a `slider` handle, s18) and yank it out → mid-call = line dead (static) → he rattles the hook 2.4 s, then searches from the jack (prank `hangUp`); he plugs it back when he sees it (`G.jobs`). **Payphone** by the road gate: take a coin from the cup (dispenser), drop it in the slot (socket) → after 1.6 s Bob's phone rings (prank call) → he answers "Hello?" for 7 s; the caller takes the handset off its hook (a handle: it rides at the snout, its cord yanks it back past 3.6 m) and presses F = oink down the line (`phoneoink`) → furious (prank `prankCall`); 2 prank calls within 150 s = `wise`: the next prank ring sends him to the payphone. Payphone cooldown 40 s. **Heavy loot (s15)**: Bob's old TV (`tv`, 85 kg, 220 → 30 once the screen cracks: `PropDef.screen` 5.2 m/s or a punch, `Prop.crack()` / `broken`, synced) + the grandfather clock (`clock`, 110 kg, tall: topples when dragged hard (clang + noise); `HeavyLoot`: hands show `G.hour`, pendulum, ticking loop, BONG on every full hour (3 on 6 / 12) = noise 22 m wherever it is). Missions `hangUp` (bonus), `prankCall`, `tvSteal`, `clockSteal` (bonus) added per farm in `Round.start`. Admin → "Phone, TV & clock". |
| `world/hammock.ts` | **Bob's siesta (s16)** = breathing window #3, farms 1–3 (decor kit `hammock(x, z, yaw)` → `FarmBuild.hammock`, `G.hammock`, synced entity after the phones). Once a round by day after `NAP.hour` 12.5–13.5 (between two chores) Bob walks over (`toHammock`) and naps ~28 s (`hammock`: body off, lies in the bed via `bobPose` + anim `hammock`, straw hat over his face, Zzz): blind, a noise ≤8 m wakes him after a groggy 1.2 s, noises made by shoving the hammock itself don't (`pushT`). Swing physics (`swing`/`omega`, k 9, damp 0.35): a ram on a post +3.6 rad/s, hits (`G.hittables`) +2.4 × strength (headbutt 0.6, punch 1) → past 1.05 rad he's flung out (`Farmer.hammockFlipped` = knock-down, then `afterStun` = angry search; prank `hammockFlip`): one ram, 2 punches or ~4–5 headbutts timed with the swing; swinging > 0.7 rad for 3 s rouses him. A muddy pig RMB at his head (`G.uses`, icon mud) = `Farmer.mudFace` → `mudMarks` 1–3 (mud spectacles, pig snout, whiskers on `FarmerVisual.setMud`; synced in Bob's numbers; 20 % he stirs and gets up 3 s later; prank `mudFace`). Admin → "Siesta (hammock)". |
| `world/snacks.ts` | **Snacks (s13)**: 3 cigarette packs (5 each) + 8 food cans scattered per farm (seeded, walkable, not water / stash). Grab + LMB click = eat / light up (`Pig.useSnack`; the grip brings the can to the mouth, `MOUTH`). Boosts (`Pig.boostUntil`, synced): beans = fart cd ×0.3 + launch ×1.3 + bigger cloud, spinach = punches / whacks / rams / throws / lift stronger + Popeye arms, energy = speed ×1.3 + sprint cd ×0.35, dog food = guard dog ignores you. Cigarette 14 s: a puff every 3.2 s (hoof to mouth, ember glows, smoke out of the snout), wobble ×0.5, bees ignore you, Bob finds a smoking pig suspicious (0.5), 35 % coughing fit (noise) at the end. HUD: LMB + eat / cig prompt, badges with seconds. |
| `net/` | `online.ts` (server link, rooms, WebRTC P2P + relay), `sync.ts` (NetHost / NetClient snapshots + inputs), `codec.ts`, `refs.ts` (who-holds-what ids), `lobby.ts` (UI), `auth.ts` (Google / guest), `config.ts`. |
| `i18n.ts`, `i18nX.ts` | `t(key, vars)`, `en` + `es` dictionaries (all UI text), `setLang`, `data-i18n` DOM attributes. New strings (s17+) go in `i18nX.ts` (`EN_X` / `ES_X`, spread into both). |
| `world/hands.ts` | **Active hands (s18, user: "like Burglin' Gnomes: the thing sticks to the hooves, you move it, it snaps where it goes — real actions, not mini-games, everywhere")**. `HANDS` singleton (`init` in game.ts, `stepHost` after the physics step, `render` every frame, `reset` on a new round). **Aim**: the client sends the crosshair as `PigInput.ax/ay/az` (offset from the pig, 3 × i8 of 2 cm) + `reach` (mouse wheel 0..1, u8) + `tilt` (R, held bit); `aimGoal` clamps it into the reach sphere (`REACH.four` snout / `REACH.two` hooves, + `REACH.ext` × wheel; `loose` for handles = may be pulled toward the pig). Light props (≤ liftMax) are gripped **at their middle** (`Pig.grab` → `MIDDLE`) and follow the aim, `Grip.orient` keeps them upright facing the pig's yaw, tilted by `tiltK` (R). `target(p)` = the crosshair's pick (holdables / handles / dispensers within `REACH.pick`; docked things count as 0.15 m further; on something out of reach → `far` = HUD wheel icon; nothing under the crosshair → the old `findGrabTarget`). **Sockets** (`socket({p, q, on: body-follow, r, accepts, dock, bin, onSnap, onOut, anyYaw, ghost})`: `magnet` pulls the hand goal + orientation in (returns the pull k; k > 0.3 = `ghostly`: the item passes through static colliders so it slides in), snaps at `REACH.snap` (bins: r × 0.6) → `dock` (kinematic there, follows `on`; taking it out = `undock`, `outOf` stops it being pulled straight back) or `onSnap` (the socket uses it up); `bin` sockets also catch dropped / thrown things. A ghost of the held thing shows the nearest socket that takes it. **Pouring**: `PropDef.pour {stuff, rate, spout, color, size, sound}` or `Prop.pourNow()` (pot / bowl contents); tipped (`flow` = up.y < 0.35) → `left` drains into the receiver under the spout (`receiver({at, r, accepts, fill})`), stream fx on every browser from the synced rotation + `left`; `pourMagnet` slides the spout over the nearest opening; `emit` = machine spouts (pump, spigot, tap). **Handles** (virtual holds: `Pig.handle`, synced as an id in the pig's numbers): `crank` (knob circles an axis; `turn(dθ)`), `lever` (hinge with limits), `slider` (a → b, `ratchet`); `frame()` = follows a body (the barrel's tap, the pot's spoon, a trap's jaw); the pig's visual hand = the knob. **Dispensers** (`dispenser({at, r, icon, ready, take})`: RMB = a fresh thing straight into the hooves: papers, filters, coins, butter). `Pig.touch(at)` = a short reach animation for RMB "uses" (hug Bob, latch, mud smear). Kitchen pieces are squashed to real sizes (KayKit's are 2-tile blocks). |
| `world/chain.ts` | **Chain modes (s17, physical since s18)** framework: `Chain` (G.chain) = `spot`s (HUD: what a work place still needs, as icons), pools of item props (`pool` / `spawn(kind, at, yaw, kick, left)` / `consume` / `serve` / `swap(prop, kind)` keeps socket / holder), `fillable(props, item, stuff, max)` (cans / buckets / mugs fill from streams), `Pump` (shared hand pump: lever + spout + the stone a can is parked on), clicks with an item = `selfUse` (eat, puff, lick, strike the lighter, sickle, dip a can in the pond), shared challenges (hug Bob = RMB next to him buzzed → `Farmer.hugged`, cloud gazing = play dead 6 s buzzed, munchies = LMB with `PropDef.food` while high), `Visions` (synced entity: 5 floating hallucinations only buzzed browsers draw, buzzed pigs catch), `Beams` + `buildBeam` (log over the pond: `Pig.beamStep` = sideways inverted pendulum, counter-steer A/D, also predicted online), `buildShed` (open-front pavilion; its roof hides while my pig is inside). Pig buzz (`buzzKind` 1 high / 2 drunk, `addBuzz(kind, amount, secs, delay)`, `buzzMove` lag + drift + drunk left/right swaps, worse balance; synced) → `render/buzz.ts` post pass + camera roll / FOV breathing. Missions in `Round.start` (chain branch), `made` events fill the quota line (`m.quotaMade`). `ADMIN.chill` = laid-back Bob (default on in chain modes); Bob finds a pig in his shed (0.6) or a buzzed one (0.35) suspicious. |
| `world/weed.ts`, `world/brew.ts`, `world/chainProps.ts` | **Farm 6 cannabis / farm 7 wheat & beer** (built by `buildFarm1(scene, 'weed' / 'beer')`: garden = field, greenhouse = shed, pump, beam; ids farm6 / farm7, not in 'random'), all with the hooves (s18): Weed: 15 plants (tip the can / seed bag over them; Bob waters them on his garden round), sickle / hits harvest → buds → wheelbarrow cargo → grinder (buds into the hopper bin, crank on the front; > `WEED.jam` rad/s for 1.2 s = jammed) → bag docked under the chute fills (4) → rolling table: papers + filters dispensers, paper → mat socket, filter → its end socket, pour weed (fill 0.6–2; 0.85–1.3 = best), roll slider (ratchet) → joint in the hooves (`sealed` after a lick click; lit by a lighter flame ≤ 0.3 m from its tip; ashtray socket) · bong (water + weed receivers, flame at the bowl = lit 10 s, snout ≤ 0.5 m from the mouthpiece = chamber fills, pull away = the hit, > 1.1 = coughing fit) · stove: pot docked on the burner (butter bin on it, weed receiver, spoon crank 6 turns; 1.5 s without stirring = burning, 9 s = smoke alarm) → magic in the pot (`pourNow`) → bowl on the counter (magic + flour receivers, spoon 5 turns) → dough → tip it over a tray (`swap` → trayRaw) → oven door lever (falls open past halfway, springs shut), hollow oven collider, tray socket inside (door open), bakes with the door shut (golden at 22 s → cookies, 34 s burnt, alarm). Brew: 24 wheat patches (scythe / hits) → sheaves → threshing floor (a sheaf dropped on it = a straw pile there; landed jumps on the floor thresh the piles, 6 points each; drum beat = double) → grain sacks (pour into the mill's hopper) → mill crank → malt sack docked under the chute → kettle (water / malt receivers, log bin = fire, paddle crank 6 turns, hops bin ×2, boils 12 s) → spigot lever → wort stream into the barrel's bung (cork up) → ferments 30 s → the tap lever (on the barrel) → beer stream into mugs (`fillable`, 3 sips each; mugs stay, refill) · beer-garden table dance, serenade Bob. Models: KayKit Restaurant kitchen, Quaternius Scythe / Bag / Barrel / Bucket / Cauldron; plants + wheat procedural (baked vertex colours). Sounds: VoxeLibre drink / pour / fill / flint / fire / hiss / ding / drum. |
| `game/game.ts` | Game loop: fixed steps (clock, pigs, Bob, critters, wolves, physics, cage, pond cleans mud), render, camera, events → toasts, `adminAction`. |
| `game/ctx.ts` | `G` shared context (time, hour/day/night, fx, audio, pigs, farmer, wolves, noises, clouds…), `ADMIN` switches, `SECS_PER_HOUR` 25 (day = 10 min). |
| `game/hud.ts`, `game/icons.ts` | HUD (icon-first, s12): ability rings, clock dial, Bob chip (state icon, words in its tooltip) + ?/! marker, prompts = icon pairs, status badges, `emote()` pops over actors, wobble bar, controls card (first game only, then H). `IC` = shared 24×24 cartoon SVG icons. |
| `game/menu.ts` | Top-right buttons (sound / controls / settings), settings menu (language, graphics, volumes, sensitivity, invert), admin panel. |
| `game/wardrobe.ts`, `game/settings.ts` | Wardrobe **& shop** overlay (own preview renderer, item thumbnails; locked items show price / level, click = try on, bar below = buy; Gadgets tab); localStorage settings (incl. outfit, coins, xp, owned, gadgets, loadout). |
| `game/shop.ts`, `world/gadgets.ts` | **Shop (s8)**: prices + level gates per wardrobe item (`P`, the rest free; the outfit worn before the shop is kept = `initShop`), level from XP (`xpForLevel` = 150·n(n−1)), gadgets bought one at a time, ONE `loadout` per round, used up at round start. Online: the gadget rides in the outfit message (`outfitMsg` → `g`), host reads `pig.gadget`, `Round.given` (synced string) says who got what → each browser consumes its own. **Gadgets**: cherry bomb (lights when thrown / hit, 2.5 s fuse, bang = noise 34 m, Bob ≤3.6 m staggers + drops a pig, animals / dog scatter (`Cloud.kind` 'bang'), pigs / props blown, chain), stink bomb (bursts on a hard landing → 9 s cloud, Bob coughs every 3 s inside), bone (dog), lucky horseshoe (+25 % coins, local), skeleton key (easier lock-picks, local `Game.keyed`). Props = pool of 4 per kind (pooled `Prop`s, hidden until handed out next to the pig). |
| `core/ragdoll.ts`, `core/grip.ts`, `pig/pigBody.ts` | Active ragdoll parts (generic), grip hand + joint, pig part layout (`CENTER` per shape, `SCRUFF`). |
| `pig/pig.ts` | **Pig** (tune in `PIG`, grip targets in `GRIP`): moves, jump, sprint/ram, fart, wallow, grab/drag/throw, ragdoll. **Standing**: punch (LMB, empty hooves, counts on Bob's poise), lifts 50 kg, throws ×1.35, opens latches ×2, but `wobble` builds (turning, speed, carrying, landing) → falls over; easier to knock down. |
| `pig/pigModel.ts`, `pigVisual.ts`, `cosmetics.ts` | Procedural pig + anchors (head, eyes, snout, chin, neck, back); **arms (s13)**: front legs = shoulder → elbow → cloven-hoof hand (2 toes), `ARM` lengths, each segment in its own group (stretch without shear); standing = two-bone IK (`solveArm`, rubber-hose stretch ≤1.9×): T-rex idle, one hoof on each side of what it holds (the held thing's real position), punch extends the right arm, windmill, hand to mouth to eat / smoke; four legs = trot with knee fold. Cigarette mesh rides the right hoof (standing, hooves free) or the mouth corner. Animation (sway, punch, windmill arms); wardrobe items: 11 skins, 18 hats (7 from KayKit), 6 hair, 5 beards, 6 glasses, 6 neck, 6 back (4 KayKit capes). |
| `world/farms.ts`, `world/farmKit.ts` | **Farms = levels (s9)**: `FARM_IDS` farm1 / farm2, `farmId()` = `?farm=` → `SETTINGS.farm` ('random' = new pick each load). A farm is built once per page load: switching = reload (`reloadOnFarm`; title pills, admin → Farm). Online: the room carries the host's farm (`create` / `quick` send `farm`); a player whose page built another farm reloads with `?farm=X&room=CODE`. `farmKit(scene, t, out, bounds, seed)` = shared helpers (`building` / `decor` / `fence` / `pen` / `prop` / `critter` / `outerFence` / `hedgeRing` / `surroundings` / `scatter` / `finish`). `FarmBuild.places` = named spots the logic needs (pond, well, coop / sheep pen / pasture rects, stash, road gate, dog patrol, admin teleports `tp`); `missions` = pranks this farm can roll, `featured` = its own ones (one of the 2 required each round). Decor / cover pieces are reusable too (`decorKit`, `coverKit`, `sunflowers(c, rect)`). |
| `world/farm1.ts` | **Farm 1** layout + `CHORES` on a clock (day loop, evening flashlight patrol, night = bed). Zones: garden, lawn (mowing), house door, mower spot, pond. |
| `world/farm2.ts`, `world/orchard.ts`, `world/bees.ts` | **Farm 2 — orchard & beehives (s9)** (Quaternius Medieval Village buildings: Inn = farmhouse, Mill, Stable, Sawmill = cider house, Gazebo = honey stand; `FARM2_MODELS` preloaded only on farm 2). **Orchard** (synced entity): 63 apple trees as instanced tree + fruit meshes; headbutt / punch / whack (`G.hittables`), sprint-ram (`onRam` on the trunk collider's owner) or a hard throw (`onImpact` in the step callback) shakes a tree → wiggle + rustle + noise 12 m, 2–3 apples drop (pool of 30 `apple` props, 4 per tree, fruit mesh hidden when empty), one golden-apple tree. **Cider press**: apples dropped in its tub wait there (`loaded`); grab the turning bar (crank, slow) and walk it round: an apple per half turn; the 6th pressed → a jug of cider (loot). **Bees** (synced entity): 6 hives; a hit / ram / throw → a swarm (≤3) chases the nearest pig or Bob at 5.3 m/s (> walk, < sprint), stings every 1 s (hop + squeal, drops what you hold; Bob: `stung()` = stagger, drops a pig), loses muddy pigs / pigs in the pond, a fart / stink cloud scatters it, sleeps at night; buzz = Veloren `bees_1.ogg` (GPL-3). Pranks: shake 5 trees, 3 apples on Bob, fill the press (6), lead bees to Bob, steal the prize honey pot / the golden apple. |
| `world/farm3.ts`, `world/dairy.ts` | **Farm 3 — dairy & cheese + the bull (s10)** (`FARM3_MODELS`: Quaternius Medieval Village House_1/2, Blacksmith = creamery; Quaternius `Bull` GLB + brass nose ring). **Cheese hill** = `Terrain.hill(x, z, r, h, flat)` (flat top: 4 cheese wheels on edge + the prize cheese; a push sends a wheel rolling down). Props: `milkChurn`, `cheeseWheel` / `prizeCheese` (shape `'wheel'` = round cylinder along x, rolls), `redRag`. **Dairy** (synced entity; `CritterBrain` of the bull via `Critter.brain`): bull notices a pig in his paddock (15 m) / anyone holding the red rag (26 m) / a rag on the ground / Bob once loose → `notice` → `paw` (1.4 s, dust + steam) → `charge` (9.2 m/s, turns 0.95 rad/s: dodge sideways) runs over pigs (ragdoll), props, cows (tip), closed gates (smash → loose), Bob (`Farmer.bullHit` = flung + down, then 35 s calm) → `rest`; slows on a fence = `dazed`. A pig ram / hit = `provoked`. Churns knocked over (tilt) spill → milk puddles (8, 75 s); Bob walking in one `slip()`s (down), pigs sprinting / standing slip. Cows: ram / any hit = `Critter.tip` (6.5 s on her side). Rolling cheese into Bob = `cheesed` (stagger / down with the prize). Pranks: bullBob, bullOut, cowTip (3), cheeseBob, prizeCheese, spillMilk (3), milkSlip. Sounds: 0 A.D. cattle (bull, played low), Wesnoth tusker charge, Animalia cow hurt, VoxeLibre milk + splash (CC0). |
| `world/farm5.ts`, `world/winter.ts` | **Farm 5 — winter farm (s12)** (`FARM5_MODELS`: Kenney Holiday Kit in `assets/winter` — decorated tree, candy canes, sled, snow forts; Quaternius snowy trees / rocks (`PALETTE` `SNOWY` brightens their snow); husky (`HUSKY` swapped into `GLB_ANIMALS.dog`), reindeer = Quaternius Stag + Deer (`rename` maps their unnamed materials)). `Terrain.snow` (snow texture, shovelled paths = dirt, snowy fields), `snowyForest()` (snow caps on every blob tree / bush / hedge), `DayNight.winter` (pale sky, snow bounce light, `SnowFx` flakes, 0 A.D. wind + gusts instead of birds), Bob's bobble hat + scarf (`BOB_STYLE.winter`). **Winter** (synced entity): rinks on `Terrain.flatten` spots (`G.iceAt`: pig accel ×0.1, Bob ×0.14 and `slip('ice')` when > 3.1 m/s), the ice-fishing hole (props sink = prank, pigs pop out, `Farmer.dunked()`), **hoofprints** (instanced ovals, fade 55 s; every browser makes its own) → `G.clues`: Bob sees a fresh trail (< 30 s) → walks to its end (`bob.tracks`, not into the sty), snowball piles restock smashed snowballs, rolling snowballs grow on fresh snow (r 0.42 → 1.25, `setRadius`/`setMass`, ≥ 0.75 bowls Bob over), Bob's prize snowman (static until hit / rammed / thrown at → 3 rolling ball props; Bob rebuilds it as a `G.jobs` job). Wallow on snow = white `muddy` coat (camo ×0.5 on snow). Pranks: snowballBob (4), bigSnowball, snowmanDown, bobIce (slip or dunk), iceHole (3), bigPresent. |
| `world/farm4.ts`, `world/pumpkins.ts` | **Farm 4 — pumpkin night (s11)** (`FARM4_MODELS`: KayKit Halloween Bits in `assets/halloween` — autumn pines, dead trees, graves, crypt, iron fence; Quaternius House_1 = farmhouse). Played at NIGHT: `FarmBuild.clock` (start 19:30, `G.secsPerHour` 62 → the round ends just before dawn), `darkNight` 0.5 (`DayNight.darkNight`), `wolfHours` [0, 4], `noMods` ['market']. **Jack-o'-lanterns** (`Pumpkins`, synced entity: lit string + catapult): 23 carved pumpkins = switchable lights (`DayNight.addLight` → `Lamp.k`), glowing faces (the atlas' dark face triangles, one InstancedMesh) + additive ground pools; `G.litAt(x, z)` = in a lit pool (r 4.4, + porch / lane lamps `fixedLit`) → at night Bob sees that pig with `VIEW.lit` (wide, 24 m) instead of only his flashlight beam. Snuff = headbutt / punch / whack (`G.hittables`), ram (`onRam`), thrown thing (`onImpact`), fart / bang cloud nearby. Bob relights one he sees dark ≥ 4 s (**generic farm jobs**: `G.jobs` sources → `BobJob` → state `job`, fix pose; `Farmer.looksAt`, `jobNow`). **Catapult** (`Catapult`): anything ≤ 60 kg in the basket (props, critters, pigs) flies when the frame is hit or the red release lever is pulled back (`release` lever handle, s18); ram the side = turn ±0.32 rad; aim assist onto Bob within ±0.62 rad / 10–46 m (lead); shots tracked in flight → `Farmer.catapulted()` (stagger, `catapultBob`). Props: `patchPumpkin(Y)` (fragile 8 m/s), `giantPumpkin` (140 kg ball r 1.0, `PropDef.r` / `damp`, roll it home; Bob doesn't tidy props > 60 kg), `candyJar`. Corn maze (`maze()` DFS + loops, soft cover walls, trophy in the middle), old family plot. Pranks: lanternsOut (6), catapultBob, pigLaunch, giantPumpkin, pumpkinSmash (5). Bob dozes on the porch (view `nap` also at night, flashlight off). |
| `world/cover.ts`, `world/hideouts.ts` | **Hiding (2026-11-13)**: `G.cover` = soft cover (bushes / corn / wheat: no collider, pigs walk in; Bob's sight ray through it is blocked, a pig inside is found only ≤1.7 m, or ≤5 m if moving; standing pigs poke their head over wheat / small bushes — `sightPoint`). Fast moves inside rustle (sound + leaves + `G.noise`). `hideouts.ts` places big bush clusters (`Forest` 'bigBush'), the east wheat field, a 2nd corn patch, climbable straw-bale stacks, log piles / crate stacks / sacks / fallen logs / farm stands (Quaternius CC0, `assets/cover`). Rail fences are `SEE_THROUGH` for Bob. |
| `world/decor.ts` | Lantern posts (lamps), duck pond (washes mud), laundry line, scarecrow + crow, beehives + bees, picnic table, outhouse, mailbox, rocking chair, pumpkin patch, trough. |
| `world/daynight.ts` | Clock → sky / sun / moon / stars / fog / light palette, lamps, day birds ↔ night crickets, rooster at dawn, dusk/dawn events. |
| `world/animalGlb.ts`, `render/googly.ts` | Pack animals (Quaternius Ultimate Animated Animals: cow, dog = Shiba, wolf, 2 horses, donkey, alpaca): one vertex-coloured SkinnedMesh each, mixer clips, neck + upper legs = ragdoll parts, goofy (`GLB_ANIMALS`: head scale, eye size, recolours). Googly eyes for every animal = 2 InstancedMeshes (pupils slide with gravity / inertia). |
| `game/markers.ts`, `game/lockpick.ts` | **Markers** (2026-11-13 s4): bobbing arrows over loot (gold, value ≥ 25, bigger ≥ 60) and over what an open prank is about (pink), seen through walls, one `Points` draw call; waypoints (where the thing you hold goes) live in `round.ts` (`targetFor` / `wherePos`). **Lock-pick**: the cage latch is a pin-tumbler timing puzzle on the player's screen (RMB at the latch; LMB / Space when the pin hits the gold band; a slip = loud clank + `G.noise`); result → input press `pickP` / `pickFailP`, host opens (`Cage.canPick` / `pickOpts`: inside = 6 pins, standing = wider band). |
| `world/landmarks.ts`, `world/funProps.ts` | Big places (s4): hedge maze NE (colliders, trophy on a plinth), sunflower field N (soft cover 2.4 m), junkyard SW (Kenney car kit sedan / van / delivery / truck + tyre stacks), greenhouse W (glass = `SEE_THROUGH`, 8 flower pots). Procedural prank props: egg, gnome, Bob's undies, pie, flower pot. Breakables: `PropDef.fragile` (m/s) → `Prop.smash()` (hidden like banked, `smashed` event). |
| `game/round.ts` | **M5 round**: stash pit in the sty (loot dropped there is banked: `Prop.value`, hidden, synced), quota (400 + 200 / extra player; solo = you only), 2 required + 2 bonus pranks from a pool, escape phase (all pigs to the stash), timer (`ADMIN.roundMins`, 10), 3 grills = busted, results (stars, coins → `SETTINGS.coins/xp`), `Game.restartRound()` resets the farm. Synced as an entity (`entities()` after the cage). |
| `world/animalModels.ts`, `animals.ts` | Procedural round animals (hen, chick, cow, dog, cat, bunny, wolf, sheep, duck) + `AnimalVisual` (walk/hop/peck/wag/flap). `Critter` (wander, flee pigs & wolves, hens roost at night, dog barks at wolves → wakes Bob), `DecorAnimal`. **Alarm birds** (`BIRD`, s6): rooster (coop) crows at a pig holding / standing / sprinting ≤9 m (any ≤3.5 m) → `G.noise` 34 m at the pig, every 10 s; 3 turkeys (garden, ×1.4 scale, fan tail pops up with `excite`) gobble at a pig ≤6 m and charge 4.3 m/s for 6 s, peck = shove + you drop what you hold; fart scares them, asleep at night; Animalia turkey sounds (MIT). **Guard dog** (`dogBrain`, `DOG`): alert 2+ = off the leash (patrols the farm), sniffs pigs (11 m open / 4 m in a bush, rail fences don't block), stands next to the pig barking, `Farmer.tipOff` every 3 s, gives up after 12 s; a fart scares it off; a **bone** prop a pig moved / carries → fetch + chew 14 s (take it → it follows you). |
| `game/modifiers.ts` | **Round modifiers** (2026-11-13 s6): one per round (`rollMod`, weights; admin forces one / `ADMIN.mod`), `G.mod`, synced in the round's strings: **rain** (grey sky, `render/rain.ts` streaks, 0 A.D. rain loop + thunder + lightning flash in `daynight.applyWeather`, Bob sight ×0.75 / hearing ×0.7, wallow anywhere = mud), **fog** (fog 3–62 m, sight ×0.6, ink lines fade with the fog: `InkOutline.setFade`), **grumpy** (alert floor 1, heat ×1.4, slap 55 %, no dancing, loot ×1.25, storm cloud over Bob), **market** (Bob walks to the south gate 9:00, state `away` like sleep until 13:00, the dog guards meanwhile, `tipOff` while away → he searches there when back; quota +150). |
| `world/traps.ts` | **Bear traps** (pool of 4, one synced entity after the round): a `Carrier` (code 20+i) — snaps a pig by a hind leg (grip joint), mash Space (10, muddy 6) or a teammate grabs the top jaw (`jaw` lever handle, s18) and pulls it up (≥ 1.1 rad); things thrown on it set it off; sprung traps vanish after 20 s; `G.traps`. |
| `world/gates.ts` | **Pen gates** (s7: sty, chickens, pasture, garden, sheep; defs from `pen(..., gateId)` in farm1): real hinged leaf (dynamic body + revolute joint; limits / motor per mode; Bob's capsule doesn't collide with it). `shut` = latched (RMB / LMB at the latch) · `locked` = Bob's padlock (lock-pick puzzle, 2 weapon whacks, or ram) · `free` = swings (pen animals amble out: `Critter.pen` → `Gate.wander`; once out they graze outside till the round ends) · `broken` = rammed off its hinges (leaf tumbles, `gateBroken`). Bob opens gates he walks through and shuts them behind him (padlocked at alert 1+); `gate` state: sees one left open / smashed → closes / hammers it (6 s, busy view); alert 1+ padlocks a latched one every 18 s. Sty is never padlocked. One synced entity per gate (body + state). |
| `world/wolf.ts` | Night wolves (`WolfPack`, 21:00–04:30): slip under the fence, chase pigs, bite + drag them off the farm (mash to escape, ram / punch / fart scares them, Bob shoos them), leave at dawn. |
| `world/cage.ts` | Bob's cage + BBQ (`ADMIN.bbqTime`, default 90 s); latch (standing ×2), ram bursts the door. |
| `world/terrain.ts`, `nature.ts`, `props.ts` | Ground (splat map, `mudAt`), instanced trees/bushes/hedges, `Prop` + `PROPS`. |
| `farmer/farmer.ts` | **Bob** brain (tune in `BOB`): clock routine, suspicion (only un-piggy acts he SEES raise it; drains slowly out of sight), noises, chase → lost you → **hunt** (`search` state: checks where he lost you + nearby hiding spots, looks around, recognises you ≤9 m, gives up when suspicion < 0.3), **tidy** (puts stolen loot he sees lying around back home), **alert level** (`ALERT`: heat 0–100 from alarms / hits / pranks / escapes, drains when quiet; 1 wary = hears / sees / hunts more, 2 = pitchfork reach + guard dog + bear traps at hot spots (`setTrap`) + patrols all night, 3 = rock-salt shotgun `aim`→`shoot` cone knock-back + runs faster; round floor 2 in the last 2 min; HUD meter under his chip, red face, music rate), chase, grab (windup/lunge) **or slap** (30 %, insult toast, taunt), carry (grip: 24 mashes, drains, shakes every 2.2 s), cage, dance (random / after caging), lawn mowing, flashlight at night, sleeps in the house (noises wake him), shoos wolves, poise → stagger / knock-down. |
| `farmer/farmerModel.ts`, `farmerVisual.ts`, `mower.ts`, `nav.ts` | Procedural Bob + tools (bucket, can, axe, mug, hammer, paper, flashlight, shirt) + poses (ride, slap, taunt, 4 dance moves, read, laundry…); ride-on mower (cuts `Grass` via a mow texture, regrows); nav grid + A*. |
| `render/` | `gfx.ts` (renderer / sky / stars / moon / lights / post, `apply(opts)`, dynamic resolution), `quality.ts` (presets, GPU detect), `batch.ts` (`instanceStatic`, `rigidSkin`, `cullDetail`), `toon.ts`, `grass.ts` (wind, pushers, mowing, `setLevel`), `fx.ts`, `textures.ts`. |
| `core/` | `physics.ts`, `input.ts`, `audio.ts` (buses sfx / ambience / music, loops), `sounds.ts` (sound manifest + OPTIONAL list), `assets.ts`, `synced.ts`, `util.ts`. |

## Controls
WASD move · mouse look · Space jump · **RMB grab / drop** (user 2026-11-13) · **LMB click = hit** (punch standing, headbutt on four legs,
weapon whack, bash with what you hold) · **LMB hold = wind up + throw** what you hold · Shift sprint · Q fart · C wallow (hold = play dead) ·
E stand · F oink · H controls · M sound · P next graphics preset · Esc menu / **closes any open overlay** · `` ` `` admin.
**LMB click with a snack = eat it / light a cigarette.** **R hold = tip what you hold (pour)**, **mouse wheel = reach further / back** (s18). The crosshair aims your hooves (what you hold goes there; RMB takes what it's on: things, machine parts — cranks, levers, the bolt, the plug —, dispensers). RMB at a latch = open it (no grab there). Lobby: WASD on the screen, the pointer aims (grab / hit / throw toward it).
Gamepad: A jump, B fart, X wallow, Y stand, LT grab, RT hit / throw, LB/L3 sprint, RB tip (pour), R3 oink, D-pad up / down reach. Input `Button`s
`grab` (RMB) + `attack` (LMB) + `tilt` (R); `PigInput` has `attack*` + `pickP` / `pickFailP` (12 press bits on the wire) + the aim / reach bytes.

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
   ✅ wolves drag pigs by a jaw joint, ✅ client-side prediction of your own pig online. Left (later): wolves' own ragdoll,
   Bob stagger as physics, grabs predicted on the player's side (held things still answer at host speed).
6. 🟡 **M5 (2026-11-13)**: ✅ loot + stash + missions + round loop + results (coins saved). Left: weapons, Bob tidies loot back,
   more pranks; then alert levels, dog helper, traps, modifiers, more farms, shop (coins are already saved).
   2026-11-13 (session 3): ✅ hiding spots + Bob hunt/search, ✅ Bob tidies loot back, ✅ weapons (pan / shovel / sword / axe:
   click = whack, poise 50–60, break after 3–4 hits on Bob), ✅ pranks: sheep out, hay bale in pond, lose Bob,
   whack Bob, hen in pond. Session 4: ✅ markers / waypoints, lock-pick puzzle, landmarks, 8 more pranks, breakables.
   Session 5: ✅ alert levels 0–3, guard dog + bone, bear traps, pitchfork, rock-salt shotgun.
   Session 6: ✅ round modifiers (rain / fog / grumpy Bob / market day), ✅ alarm birds (rooster + turkeys).
   Session 7: ✅ pen gates (latch / padlock / ram), Bob shuts + padlocks + repairs them, animals walk out of open pens,
   pranks "let 2 big animals out of the pasture" + "ram down a gate", 2 prize pumpkins in the garden.
   Session 8: ✅ shop (wardrobe prices + level gates, player level from XP, gadgets: cherry bomb, stink bomb, bone,
   lucky horseshoe, skeleton key).
   Session 9: ✅ farms as levels (farm kit + registry + picker, online room farm), ✅ **farm 2: orchard & beehives**
   (shakeable trees, apples, cider press, angry bee swarms, golden apple, honey, 6 new pranks).
   Session 10: ✅ **farm 3: dairy & cheese + the bull** (charging bull + red rag, cow tipping, spilled milk slips,
   rolling cheese wheels off cheese hill, prize cheese, 7 new pranks).
   Session 11: ✅ **farm 4: pumpkin night** (whole round at night, jack-o'-lanterns = light Bob sees you in, snuff them,
   Bob relights; catapult for pumpkins / hens / pigs; giant prize pumpkin to roll home; corn maze; 5 new pranks).
   Session 12: ✅ **farm 5: winter** (ice + fishing hole, footprints Bob follows, snowballs, growing snowballs,
   prize snowman, snow coat, reindeer, husky), ✅ **HUD text pass** (icons instead of sentences, see "Less text").
   Session 13: ✅ **Fortnite-style lobby** (movable pig on a stage, party, online room on the stage), ✅ **pig arms**
   (elbows, hoof hands, IK), ✅ **snacks** (food cans with boosts, cigarettes), ✅ coloured mission arrows (one per
   mission, next step only), ✅ Bob dances next to pigs, ✅ full screen, ✅ simpler settings.
   Session 14: ✅ **Bob's outhouse** (toilet breaks = breathing window on every farm; bolt him in, tip it over with him
   inside; 2 pranks), ✅ **heavy loot: Bob's safe** (two pigs drag it together, or one pig on spinach; bonus prank).
   Session 15: ✅ **Bob's phone** (calls = breathing window; unplug the jack mid-call; prank-call him from the payphone
   and oink), ✅ **more heavy loot**: old TV (screen cracks if dropped / hit) + grandfather clock (bongs every hour).
   Session 16: ✅ **Bob speaks** (hillbilly voice lines: chase, anger, insults, "Yessir" on a catch, "Bye bye" at the cage,
   "Hello?" on the phone, his cough), ✅ **Bob's siesta** (hammock nap: flip him out, paint his face with mud).
   Session 17: ✅ **admin rework** (tabs, fly, ghost, jail / freeze / launch players), ✅ **chain modes**: farm 6 cannabis
   farm + farm 7 wheat & beer (production chains with station mini-games, high / drunk effects, balance log, visions,
   challenges), Bob "chill" by default there (user still deciding whether Bob chases in these modes).
   Next: user feedback on the modes; the early-access entry code (waiting for the user's choice of option, see Status);
   ideas: Bob's coffee break / newspaper on the porch, more heavy loot, a snoring recording.

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
  2026-11-13: client-side prediction built & checked headless (2 browsers, 150 ms fake lag: own pig answers in 2 frames,
  host copy within 0.1–0.4 m, knock → host takes over → resumes). **Next: M5** (loot / missions / round loop). Ask the user
  how online feels now (admin → "Move my pig right away" switches prediction off to compare).
- 2026-11-13: **performance pass** (batching above + graphics settings menu with presets / advanced options). User
  wants lots more buildings / props later → that's why the batching is automatic. **Art direction (user)**: environment
  from ready-made packs (any close style is fine); animals, Bob, mower and other code-built models look "not invested" —
  replace later, not all at once. Options given: CC0 rigged+animated packs (Quaternius / KayKit / Kenney via GitHub
  mirrors), an AI text/image-to-3D API (Meshy / Tripo: user makes an account, key via `request_credential`, never chat),
  or Blender (`bpy`) modelling in the sandbox with rendered previews. **Decided (user 2026-11-13)**: CC0 packs for the
  environment + animals (Claude does it alone, via GitHub mirrors); **Tripo API** (text/image → 3D, auto-rig, preset
  animations; new API users reportedly get starter credits) for Bob + pigs. User creates the key in the Tripo Console →
  next session call `request_credential` (host = Tripo's API host from its docs; Bearer). Keep physics: new models must
  be split / skinned onto the SAME pivots (pig: head + 4 legs, Bob: head, arms, legs) that `ragdoll.ts` / `grip.ts` drive.
  Users asked: batching does NOT touch physics (only how the GPU draws; verified knock / Bob knock-down after it).
- 2026-11-13 (session 2): **goofy pack animals** (Quaternius, big heads, googly eyes — also on hens / sheep / ducks…), real
  horse / donkey / sheep sounds, **M5 round loop** (tested solo + 2 browsers), garden = Quaternius Ultimate Crops (their corn was
  too thin → kept Kenney corn). Tripo: user will sign up later → then `request_credential` (Tripo API host, Bearer) and make
  Bob + pigs **goofy** (big heads / googly-friendly), split onto the same physics pivots. Ask the user: round length (10 min),
  quota (400 solo), are the pranks fun, should Bob put loot back.
- 2026-11-13 (session 3): user asked to fill the farm (not bigger) with places to hide + slow suspicion decay out of sight
  + only stealing / standing etc. raise suspicion → done (see `cover.ts` / `hideouts.ts` / Bob hunt). Kenney nature-kit colours
  fixed per model (`PALETTE` in `core/assets.ts`: teal corn → green, white wheat → gold, peach rocks → grey). Admin →
  Hiding: "Show when Bob sees me", "Bob: lose me + search", teleport into a bush / the wheat. Checked headless (sight tests,
  hunt, tidy, weapons, 2-browser online). Ask the user: is hiding fun, is the farm too full / still too open, hunt length (~16 s).
- 2026-11-13 (session 4, user feedback): Esc closes every overlay (menu, admin, wardrobe, lobby, lock-pick, controls card;
  "click to keep playing" hint when the mouse can't be re-locked); RMB / LMB controls; lock-pick puzzle; loot + prank arrows
  + "where to" waypoints; Bob stuck at night FIXED (a scared wolf fled to the fence 1 m away, came straight back, Bob
  shoo→fist→shoo forever: scared wolves now slip out and despawn, Bob ignores a wolf he shooed for 15 s; wolf bodies are
  freed on despawn); **standing rework** (`BAL` in pig.ts: inverted-pendulum lean, saturating self-righting, stumble steps
  toward the lean, falls past 0.62 rad; the visual leans around the feet exactly as the physics says — the old sway used
  `sin(t × changing freq)` = jumpy phase = the "laggy" look); landmarks + 8 new pranks (smash pots, smash melons, eggs on
  Bob, gnome in the pond, undies down the well, steal the pie, muddy porch, maze trophy) with counted progress; language
  pills with flags on the title; wardrobe item thumbnails (offscreen renderer, cached, freed on close).
  **Crash report (user: the game closed mid-play several times)**: JS heap / bodies stable over a full simulated day/night
  (~104 MB); added WebGL context-loss handling (note + reload) and a 5 s heartbeat in localStorage — after an unexpected
  end the admin panel shows the last numbers ("Last session ended unexpectedly"). Ask the user for that screenshot.
- 2026-11-13 (session 5, user away from the PC: "continue to the next stages"): **alert levels** (meter: Bob's face + 3 pips
  + name, toasts), **pitchfork** (lvl 2, longer grab), **rock-salt shotgun** (lvl 3; Quaternius Survival `Shotgun_1`; Wesnoth
  thunderstick / gunshot = `shot`), **guard dog** + **bones** (KayKit `bone_A`, 4 on the farm), **bear traps** (Wesnoth
  pincers = `snap`), HUD "trap right here" warning, admin → "Bob alert level" (0–3, trap in front of me, dog sniffs me, bring
  a bone). Checked headless solo (each feature) + 2 browsers online (level, trap catch / escape, gun visible on the player).
  Ask the user: is level 3 too harsh (gun every 5.5 s), heat speed (calm after ~1.5 min), dog too clingy, traps visible enough.
- 2026-11-13 (session 6, "continue"): round modifiers + alarm birds (see `modifiers.ts`, `BIRD` in animals.ts). Admin → "Round
  modifier (now)" (+ "Random next round"), "Alarm birds" (rooster spots me, turkeys charge me, teleport to the garden).
  Checked headless solo (each modifier, Bob leaves / returns + searches the dog's spot, pecks, crow → Bob investigates) and
  2 browsers online. Sounds: 0 A.D. rain / thunder (CC BY-SA 3.0), Animalia turkey (MIT). No goose recording found → turkeys.
- 2026-11-17 (session 7, "continue"): pen gates (see `gates.ts`). Admin → "Gates" (padlock / latch / open all, smash the
  nearest, Bob deals with the nearest, teleport to the chicken gate). Checked headless solo (latch, pick, weapon whacks, ram,
  Bob repair + padlock, Bob opens/shuts the chicken gate on his chore, cows / sheep / hens walk out) and 2 browsers online
  (player's RMB / lock-pick act on the host, padlock + smashed leaf visible on the player). Local online tests need
  `&server=ws://localhost:8080` (the built-in Render address wins otherwise).
- 2026-11-17 (session 8, "continue"): **shop + gadgets** (see `shop.ts` / `gadgets.ts`). Admin → "Shop" (+1000 coins,
  +1 level, reset shop, cherry / stink bomb / bone in front of me). Sounds: Minetest Game tnt fuse + bang (CC0). Models:
  Quaternius Platformer `Bomb`, RPG `Key2`, KayKit `smokebomb`. Checked headless: shop UI (try-on, buy, level lock,
  gadgets tab, wallet on the title), handout + count used up + next round, bang → Bob staggers / drops the pig, stink →
  cough, 2 browsers online (player's gadget handed out by the host, counted on the player, bang / cloud seen).
  Also fixed: hidden props (stash, gadgets) left an invisible collider on online players' machines.
  Also fixed: an online player in seat 2–4 saw a random outfit on their own pig (`goOnline` now dresses it).
- 2026-11-17 (session 9, "continue"): **farms as levels + farm 2 (orchard & beehives)** (see `farms.ts` / `farmKit.ts` /
  `farm2.ts` / `orchard.ts` / `bees.ts`). Farm 1 now builds through the same kit (same layout, same RNG order). Title: farm
  pills (Bob's family farm / Orchard & beehives / Random — **default is Random**). Admin → "Orchard & bees" (shake the
  nearest tree, angry bees after me, 6 apples in front of me), "Farm" (reload on the other farm), teleports come from
  `places.tp`. Server: `quick` creates the room on the asker's farm (deploys with the merge). Checked headless: farm 2
  layout shots, headbutt / ram / admin shake → apples, press → cider after 6, swarm chases + stings, muddy pig ignored →
  Bob stung (stagger), apple splat on Bob counts; farm 1 unchanged; 2 browsers online (player on farm 1 reloads into the
  host's farm-2 room; shaken tree + swarm seen on the player).
- 2026-11-17 (session 10, "continue"): **farm 3 — dairy & cheese + the bull** (see `farm3.ts` / `dairy.ts`). Title pill
  "Dairy & the bull". Admin → "Dairy & bull" (bull charges me, let the bull out, red rag / cheese wheel in front of me, tip
  the nearest cow, spill milk). Also fixed: farm 2's chore names showed raw keys in Bob's HUD chip.
- 2026-11-17 (session 11, "continue"): **farm 4 — pumpkin night** (see `farm4.ts` / `pumpkins.ts`). Title pill "Pumpkin
  night". Admin → "Pumpkin farm" (snuff nearest / all, all on, Bob relights the nearest, into the catapult basket, fire,
  aim at Bob, pumpkin / giant pumpkin in front of me), teleports patch / giant / catapult / maze / graves. Checked headless:
  headbutt + fart snuff, Bob walks over and relights, Bob sees a pig in a lit pool but not in the dark (same spot), pig
  launched 34–38 m, pumpkin shot staggers Bob (prank ticks), giant pumpkin rolls (push 7.5 m / 3 s, ram ~10 m) and banks
  250, night routine soak (patrol / prize / wolves after midnight), 2 browsers online (player reloads into farm 4, clock /
  lanterns / catapult in sync, player's headbutt snuffs on the host).
- 2026-11-17 (session 12, "continue" + user: "too much text on screen"): **farm 5 — winter** (see `farm5.ts` /
  `winter.ts`). Title pill "Winter farm". Admin → "Winter farm" (knock the snowman over, Bob rebuilds it, snowball /
  giant snowball in front of me, Bob slips on the ice, snow coat on me), teleports rink / hole / snowman / tree / sled /
  paddock / woodshed. Checked headless: ice slide (4.8 m/s → slides ~3 m), snow coat, Bob slips on ice, snowball splat
  counts, giant snowball knocks Bob down, snowman down → Bob walks over and rebuilds, crate sinks in the hole, pig dunked,
  hoofprints, Bob follows a fresh trail to its end, snowball grows 0.42 → 0.74 rolling ~11 m; 2 browsers online
  (snowman / snowball size / dunk synced, the player sees its own prints). **HUD text pass** (see "Less text"): checked
  shots of near-item / holding / status / Bob chip / event pops. Sounds: 0 A.D. wind + snow steps (CC BY-SA 3.0),
  VoxeLibre ice crack / ice steps (CC BY 3.0).
- 2026-11-17 (session 13, user list): Bob dances at a pig next to him (25 % once per pig per 20 s, 12 % in a chase,
  4.5 s, then the chase goes on; admin "Bob: dance when I come close"); full screen (button + settings, Keyboard Lock
  Esc); settings = language / graphics / sound / music / mouse / full screen + "More options"; mission colours
  (`MISSION_COLORS`, list arrows, world arrows, waypoints) and `Round.missionMarks()` (one arrow per mission: the
  nearest thing → where it goes once someone holds it; pen animals = their gate; Bob pranks over Bob); pig arms;
  snacks (admin → Snacks); the lobby. Also fixed: the camera could spin on the first mouse move after the pointer lock.
  Checked headless: lobby (walls, grab / throw, PLAY → round), 2 browsers online (room on the stage, moves synced,
  host START → both in the round), eating / spinach / smoking shots, Bob near-pig dance.
- 2026-11-18 (session 14, "continue"): **Bob's outhouse** (see `outhouse.ts`) + **heavy loot: Bob's safe** (procedural
  `makeSafe`, 150 kg, 300 coins, `PropDef.coop`): a second pig can grab heavy loot another pig holds (`Prop.helper`;
  release hands it to the other), lift / drag forces add up through the two grips, pigs holding it are on a leash
  (`Pig.leash` = the distance at the grab; past it +0.6 m they slow to a crawl — positions, not speeds, so it works
  for a predicted online player too), alone it won't budge → after 1 s of pulling the pig lets go + `two` icon
  ("bring a friend"); spinach (`Pig.dragMax` ×1.6) lets one pig drag it at ≤1.4 m/s (two pigs ≈2 m/s). Scrapes = low metal clank + noise 13 m. Bonus prank `safeSteal`.
  Missions `looLock` / `looTip` / `safeSteal` are added per farm automatically (`Round.start`: outhouse / safe exist).
  Checked headless: Bob walks over + goes in (hidden), bolt → bangs → bursts the door off → angry search (prank ticks),
  tipped backward → flung out (knock-down, prank ticks), onto its door → stuck, heaves it up, comes out; solo ram + 4
  headbutts tips it with him inside; safe alone / two pigs (≈2 m/s) / spinach (≤1.4 m/s); 2 browsers online (outhouse
  state + hidden Bob on the player, host pig + player pig drag the safe together ≈1.7 m/s, the player sees it held).
  Test hook fix: a scripted press now lasts one frame on an online player too.
- 2026-11-18 (session 15, "continue"): **Bob's phone** + **TV / grandfather clock** (see `phone.ts` / `heavyLoot.ts`).
  `G.uses` = RMB spots that aren't grabs (jack, payphone; HUD prompt icon from `icon(p)`). `BobJob.then` = what Bob does
  after a job (cut off: walk to the jack, plug it back in, then search there). Sounds (real recordings): `ring` (AntumMT
  doorbell_03, electric bell), `phonetalk` / `phonevoice` (CDDA CC-Sounds old man rambling / radio chatter, the latter
  telephone-filtered by `phone()` in fetch_sounds.sh), `phoneoink` (filtered oink), `static`, `coin`, `clunk`, `tick`
  (AntumMT clock), `bong` (VoxeLibre bell stroke), `glass`. Checked headless: real call → Bob hurries over, talks facing
  the box (receiver at his ear), jack pulled → static → hook rattle → he plugs it back (3 s) → searches; prank call:
  coin → ring → "Hello?" → oink → furious, 2nd one → `wise` → he walks to the payphone; TV dropped from 2 m → cracks
  (220 → 30, white cracks, dark screen); clock strike = noise 22 m; phones / TV / clock placed on all 5 farms;
  a spinach pig drags the clock ≈1.3 m/s (it topples) / the TV ≈1.2 m/s (no crack); 2 browsers online (player sees
  Bob on the phone, the player's RMB unplugs the jack on the host; the player's coin → prank ring → oink prompt → the
  player's F makes Bob furious; a cracked TV shows cracked on the player).
- 2026-11-18 (session 16, "continue"): **Bob's voice** (Hedgewars HillBilly pack, GNU FDL 1.2; the Wesnoth old-man grunts
  were replaced except the "huh" groan; no speech-to-text here, lines were picked by their Hedgewars event names) +
  **Bob's siesta** (`hammock.ts`). Checked headless: Bob walks over and naps (lying in the striped hammock), 2 mud
  smears from a muddy pig → marks on his face (seen on him once up), a sprint-ram into a post flips him out (down,
  prank ticks), 5 headbutts timed with the swing flip him too, voice throttle (1 line, then grunts).
  2 browsers online: the player sees Bob napping, the player's RMB mud smear lands (marks synced), the flip shows.
- 2026-11-18 (session 17, user list): admin tabs + powers + jail; chain modes (see `chain.ts` / `weed.ts` / `brew.ts`,
  GDD "Chain modes"). Bob in the modes = **chill Bob** (Claude's pick, user wanted to discuss it; admin → Bob: "Chill Bob"
  off = full Bob, "Farmer Bob" off = none). **Early-access entry code (user asked)**: options given (code screen only /
  server-checked codes on Render as an env var / real lock: itch.io restricted page or Cloudflare Access + private repo);
  Claude recommended server-checked personal codes now (+ a real lock before a public early access). Waiting for the user's
  choice — then build it. The repo is public (anyone can read the code).
  Checked headless: cannabis chain (harvest → grinder → table → joint → high, log fall), beer chain (scythe → stomp → grain
  → mill → kettle → barrel → tap → drunk, table dance), 2 browsers online (station state synced, player's act applied on the
  host, buzz synced), first person (arms per pose). PR #47 merged. Screenshot page for the pending checks (Hebrew):
  https://claude.ai/artifact/PbUifXakfmhnc7YtchB6xX (rebuild: scratchpad `gallery.cjs` per farm + `mkgal.py`; republish).
- 2026-11-18 (session 18, user: "not mini-games: physically take the filter, the paper, pour, roll — like Burglin' Gnomes,
  everywhere"; + mouse wheel reach): **active hands** (`world/hands.ts`, GDD "Active hands"): aim, light things gripped at
  their middle (upright, R tips = pours), magnet sockets + ghosts, pour streams + pour magnet, handles (crank / lever /
  slider), dispensers, reach extension (rubber arms standing / stretchy neck on four legs); the mini-game module is gone.
  Cannabis + beer chains rebuilt on it; phone plug / payphone coin + handset, outhouse bolt, bear-trap jaw, cider-press
  bar, catapult release lever + a real basket collider, touch animations (latch, mud smear, hug). Online: the crosshair /
  reach / tilt ride the input; no player clone on rejoin (tab id: the server swaps a tab's old connection out); the host
  switches the room's farm (the room waits for the host's reload); bigger room code; a frame error no longer freezes the
  game. Owner mode + gifts + admin grants; admin panel redesigned (game style); story stages + modes; pause menu "back to
  the lobby"; mission how-to icons; game-style panels / buttons.
  Checked headless: the whole joint chain (paper → mat → filter → pour → roll → lick → ashtray → lighter → puffs), bong
  (pour water, pinch, light, inhale, cough when held too long), grinder crank, pot → stir → magic butter → bowl → stir →
  dough → tray → oven door → bake → cookies, mill crank, pump + bucket on the stone, kettle water / malt / paddle, spigot,
  catapult basket, farm switch in a room (2 browsers), ghost connection replaced (server test), admin panel look.
  Not fully run end-to-end: the beer chain after the paddle (hops → boil → barrel → tap → mug: each piece runs).
  Online hands (2 browsers): the player grabs the grinder crank and turns it (host + player crank in sync, buds → bag),
  takes the bag out of its socket. **Story saves** (user: "the host keeps the progress, Load / New game, ~5 saves"):
  checked headless (old progress → save 1, new game in slot 3, win → stage stored + names + stars, Next stage →
  farm 2, load save 1 → farm 3, delete, Esc).
- Ideas noted: real oink set is from VoxeLibre/0 A.D. — the user may want more pig variety; Bob voice lines ("Hey!") need a recording.

## Pending user checks (repeat in every final reply until the user answers; remove answered items)
Screenshots for most of these: https://claude.ai/artifact/PbUifXakfmhnc7YtchB6xX
- **Active hands (s18)**: does holding things at the crosshair feel good? R = tip / pour, mouse wheel = reach further —
  natural? Snapping into place (the ghost shows where) clear? Cranks / stirring (circle the mouse), levers (oven door,
  pump, taps), sliders (outhouse bolt, phone plug, rolling the paper) — fun or fiddly?
- **Cannabis / beer chains with the hooves** (no mini-games now): is each step clear with the arrow + the mission line's
  icons + the "where it goes" prompt? Too long / too fiddly?
- **Online**: the rejoin "clone" is gone? The host changing the farm inside the room (everyone reloads, back in the room)?
  The bigger room code readable?
- **Owner**: coins / level on your account (sign in with Google)? Giving coins / admin to a friend (admin 👑 tab)?
- **Saves** (💾 above the farm card): 5 slots, load / new game / delete; the host's save is shown to the room; "Next
  stage ▶" after a win. Is it clear? Should players' progress count too (now only the host's save)?
- **Story mode**: stages 1–5 unlocking in order, harder each stage (quota, Bob wary from stage 4) — right pace?
- New admin panel + game-style menus: better? What else still looks "basic"?
- **Entry code (early access)**: which option (code screen / server-checked codes / real lock), one shared code or one per
  tester, and the code itself (set it in Render, not in the chat).
- **Cannabis farm + wheat & beer (new modes)**: fun? Each step a real game (water / harvest / wheelbarrow / grinder crank /
  rolling / lighter / bong hold / stove stir / oven timing; wheat scythe / stomp to the drum / mill / kettle / barrel /
  tap)? Too long for 10 min? Is "chill Bob" right, or full Bob / no Bob (admin → Bob tab)? The log walk: too hard / easy?
  Screen effects too strong?
- New admin panel (tabs): simpler? Fly / ghost / jail work for you (online: as host)?
- **First person** (admin → Me → "First person"): how does it feel? Worth making a real option?
- Bob's new voice (hillbilly lines: "Come on then!", "Yessir!", "Bye bye!", insults): does it fit Bob? Too chatty?
- Bob's siesta (hammock, once a round after lunch): fun? Flipping him out (one ram, or ~4 headbutts timed with the swing)
  too easy / hard? Mud face-paint (wallow, then RMB at his head while he sleeps) fun / visible enough?
- Bob's phone: does a call give a good breathing window (~every 3–4 min, 16–24 s, he glances back now and then)?
  Unplugging the jack mid-call fun? Prank call from the payphone + oink (F) fun? Is "after 2 prank calls he comes to the
  payphone" fair?
- New heavy loot: the TV (screen cracks if dropped / hit → worth 30) and the grandfather clock (BONG every game hour =
  Bob hears it): fun or annoying? Too heavy / too light?
- Bob's outhouse: fun? Breaks often enough (~every 3 min, ~18 s inside)? Bolting him in / tipping it over (a ram + a
  few headbutts, or 2 rams) too easy / hard? Does the knock-and-run (he comes out within 5 s) feel fair?
- Bob's safe (heavy loot, 300 coins): dragging it with a friend fun? Alone with spinach (slow crawl) OK?
- New lobby: fun to move / throw there? Camera distance OK (pig size)? Is the party / PLAY layout clear?
- Pig arms: do eating / smoking / punching / holding read now? Are the stretchy arms OK (rubber-hose) or too odd?
- Snacks: boosts strong enough / too strong (30 s)? How many cans / packs on the farm (8 + 3)?
- Bob's random dance next to a pig: too often / too rare (25 %)?
- Mission arrows in colours: clear which arrow is which mission?
- Settings: simple enough now? Full screen works on your PC (Esc opens the menu, hold Esc to leave)?
- New icon HUD (less text): is it clear without the words? Anything still too wordy (the mission list?) or now unclear?
- Farm 5 (winter): ice too slippery / not enough? Does Bob following footprints feel fair (walk on shovelled paths to
  leave none)? Growing snowballs fun? Snowman rebuild time OK?
- Missing sounds: `web/sfx_user/README.md` (drop files, Claude converts). Tripo API key when ready (→ `request_credential`).
- After a crash: screenshot of admin → "Last session ended unexpectedly".
- Feel on a real PC: wobble when standing, slap chance 30 %, grip 24 mashes, wolves, night length, online lag
  (admin → "Move my pig right away" off = compare).
- Round: length 10 min, quota 400 solo, are the pranks fun, Bob putting loot back.
- Hiding: fun? farm too full / too open? hunt length (~16 s).
- Alert: level 3 too harsh (gun every 5.5 s)? heat speed (calm after ~1.5 min), dog too clingy, traps visible enough.
- Modifiers: is rain / fog too dark or too light, grumpy Bob too hard, market day (Bob away 9–13 ≈ 100 s) too long / short,
  how often (30 % normal days)?
- Alarm birds: rooster too strict (crows every 10 s), turkeys too annoying (3 of them, drop loot on a peck)?
- Shop: are prices / level gates fair (crown 2000 + level 10, a win ≈ 500 coins)? Gadgets fun? Cherry bomb too strong
  (Bob drops a pig he carries)?
- Gates: is padlocking too much (Bob locks one every 18 s when wary)? repair time 6 s, 2 weapon hits per padlock, do
  animals walk out too fast / slow?
- Farm 3 (dairy & bull): is the bull fair (9.2 m/s charge, you dodge sideways or sprint)? Cow tipping / milk slips fun?
  Does rolling cheese off the hill work for you?
- Farm 4 (pumpkin night): too dark / too bright? Is snuffing lanterns + staying in the dark fun? Catapult: fun to aim
  (ram it to turn), too easy to hit Bob? Giant pumpkin too easy / too hard to roll home (≈70 m)? Round 19:30 → 05:00 OK?
- Farm 2 (orchard & beehives): fun? Bees too fast / too slow (5.3 m/s, you outrun them only by sprinting)? Random farm
  as the default OK, or should the title remember one farm?

## Known issues / TODO
- Hands: four-legged pigs can't reach counter tops / the kettle without the wheel (by design: stand up or stretch); a
  carried thing can catch on furniture (lift it); the pot / bowl / mug fills are simple discs; the wheelbarrow is still
  a dragged box. The beer chain's last steps weren't run end to end in one test.
- Online hands: held things still move at host speed for a player (no client prediction of the grip).
- Chain modes: no online 2-browser test of every station yet (the act code was checked); the shed is a static model (Bob's
  nav grid may route through its walls); the wheelbarrow is a dragged box (no wheel physics); stations don't show their contents except the pot / bowl / bong water / oven ring.
- Siesta: no hammock on farm 4 (night round) or farm 5 (winter); Bob's straw hat covers his face while he naps (the mud
  marks show once he's up); Bob's mumbled phone chatter is a different (recorded) voice than his hillbilly lines.
- Phone: a pig can stand at the jack while Bob is on the phone without him noticing if it's out of his narrow cone (by
  design); the payphone has no booth to hide in; Bob always knows where a prank call came from after the 2nd one.
  The tall clock topples as soon as it's dragged (then it's dragged lying down, silent: it ticks / swings only upright).
- Outhouse: a tipped hut isn't in Bob's nav grid (baked upright; he may bump into it); Bob fixes it only when he passes
  by and sees it. Online: two pigs dragging side by side can bump (the player's predicted pig shoves the host's) →
  they pull at an angle, slower — stand on different sides of the safe. In one online test run the helper pig let go
  once with low strain (cause not found: maybe a follow bump → ragdoll); later runs held fine.
- Farm 5: Bob's nav grid ignores the ice (he walks onto it, slides, can slip mid-chase — intended); prints are flat decals
  (float a little on slopes); the sled is a plain prop (no riding); snowball piles restock even if a pig is standing on them.
- Unused i18n keys from the old wordy HUD (p.*, s.*, hint subtitles) are still in `i18n.ts` (harmless; clean up later).
- Headless SwiftShader sometimes captures a blank-sky frame right after a teleport (capture timing, not a game bug).
- Farm 4: Bob walks through the corn maze (not in his nav grid); lanterns can't be picked up (static); the catapult's
  arm has no collider (things in the basket sit on the ground); Bob doesn't miss his giant pumpkin once it's gone.
- Farm 3: the bull doesn't path around obstacles (straight charges, by design) and grazes outside once loose until the
  round ends; Bob doesn't lead him back. Milk puddles are flat decals (they float a bit on slopes).
- Farm 2: Bob only hears a shaken tree (noise), he doesn't notice empty trees / pressed apples; fruit on a tree shows
  all-or-nothing (hidden only when it's empty); the honey table is the picnic-table piece. Bees don't fly around obstacles.
- Lock-pick / round progress online still only covered by the session-5 smoke test (lobby → start → snapshots fine).
- Gates: Bob walking right along a fence next to a gap may open / shut that gate as he passes (harmless). Hens flee a pig
  standing in the doorway (they won't walk out past you — herd them from behind).
- Guard dog walks straight lines (no nav grid): it can get stuck on buildings when a pig is behind one. The cause of the user's crashes isn't confirmed (likely GPU / driver: watch the admin crash note).
- Camera clips into the boundary hedge (no collider) when a pig is held near the fence.
- Your own pig is invisible inside a big bush (only the HUD says "Hidden"); maybe an outline / x-ray later.
- Bob walks through bushes / corn (not in his nav grid) — fine for a cartoon, he "pokes" into them while searching.
- A caged pig's noises keep Bob investigating near the cage (pre-existing loop, acts like guarding).
- Untested: guard mode (2 caged), fist (unreachable pig). Bob's HUD marker sits low while he lies ragdolled (pos = torso).
- Sim cost +20–35 % vs before M4.5 (grip hands / joints); parts cost nothing while in control (bodies + joints off).
- Prediction: the player's pig collides with others where the snapshot shows them (~100 ms in the past); own jump / fart
  sounds come from the host (late); my-side ram / grab / punch effects still wait for the host.
- Never tested on a real GPU: real FPS per preset, whether "auto" picks well (GPU-name heuristic), dynamic-resolution feel.
- Bob's mower parking collider is not in the nav grid (Bob can bump into it; the stuck logic copes).
- Round: Bob ignores the stash (doesn't take loot back yet); "pumpkin on the well" counts on the well's roof too; solo extra
  pigs in the sty are idle and don't count. Hens / chicks / ducks / cats / bunnies / sheep are still procedural (no CC0 pack in
  the same style found) — googly eyes make them match.
