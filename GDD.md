# Porkour (browser) — GDD v2 draft (2026-11-12)

> New direction: browser game (Three.js + Rapier), equal pigs, heist on a living farm.
> The Unity project in `Assets/` stays untouched as reference; the web game lives in `web/`.

## Pitch
Up to 4 pig burglars vs one farmer. Goofy physics stealth-heist: the farm runs its own daily routine,
the pigs steal and wreck things while the farmer works. Get noticed → he chases, grabs, carries you
to the cage by his BBQ. Teammates bash him to drop you or break you out before the grill is hot.

## Pigs (all equal)
| Action | What it does |
|---|---|
| 4 legs (default) | Fast, low profile. A pig on 4 legs with nothing in its mouth is "just a farm pig" → the farmer ignores it (Goose-game "act natural"). |
| Stand up (toggle) | Walk on 2 legs: slower, wobbly, taller (seen from further) but can carry loot in front hooves, use weapons, open latches / doors, reach tables & shelves. |
| Fart (cooldown ~8 s) | Boost (hop / dash) + stink cloud: blinds / makes the farmer cough ~3 s, pushes light objects. **Loud** → draws attention. |
| Sprint (cooldown ~6 s) | ~2 s burst. At full speed = ram: the only unarmed hit that counts on the farmer. |
| Wallow (mud roll) | Roll on your back. In mud → muddy ~60 s: camouflage (seen at half range on dirt/mud), slippery (wriggle out of his grip faster). Without mud → dodge roll / "play dead" (on your back + still → he loses interest unless already chasing). |
| Grab | Pick up / drag items, grab teammates, throw. Heavy loot needs 2 pigs (co-op carry, loud & slow). |
| Ragdoll | Hard hits, falls, blasts, throws → full ragdoll, get up after ~1.5 s (mash to recover faster). |

Weapons hidden around the farm (scarce, they break): rocks (throw), sword / pitchfork / frying pan (melee),
old rifle with rock salt / corn (few shots, knocks ragdoll). Caught pigs lose their weapon (farmer confiscates).

## The farmer
- **Daily routine** (Untitled Goose Game): chores at places — feed chickens, milk the cow, water the garden,
  fix the fence, chop wood, drive the tractor, coffee on the porch, nap. Busy = narrow view cone; walking = normal.
- **Suspicion per pig** ("?" fills → "!"), never instant. Suspicious: standing on 2 legs, carrying loot / weapon,
  breaking things, inside the house / garden beds, farts and noise. Normal pig behaviour is ignored.
- **Noise** (breaking, farts, sprinting on gravel, dragging heavy loot, oinks) → he walks over to check.
- **Chase**: angry run, grab windup (dodge window), carries the pig to the cage (pig wiggles = slowly escapes).
- **Poise**: hits within ~2 s stack; only strong hits count (full-speed ram, heavy thrown objects, weapons).
  Poise broken → stagger, drops the pig; big combo → full ragdoll knockdown ~3 s.
- **Tidies up**: puts stolen items he sees back, repairs broken fences, locks doors you used.

## Capture
Cage by the BBQ, ~90 s until the grill is hot. Rescue: stand at the latch together / hit the cage hard / break it.
Grilled pig is out ~30 s, respawns at the sty; 3 grills = round lost.

## Round (~10 min)
Random farm + random modifier. Missions: **loot quota** (value carried to the hideout), 2–3 required **wreck** tasks,
2 bonus **pranks**. End: everyone back in the hideout before time runs out. Stars, coins, XP → shop (hats, gadgets).

## Difficulty without killing the fun
1. **Alert level 0–3** (farm-wide, decays when quiet, always visible: music, his face, HUD icon):
   0 routine · 1 checks noises, locks the house · 2 dog off the leash, pitchfork (longer grab), traps where he caught pigs ·
   3 furious: rock-salt shotgun (knockback, no damage), runs faster. Last 2 minutes: at least level 2.
2. **Helpers**: guard dog (sniffs pigs out, barks → farmer; distract with a bone / ball), geese / rooster alarms.
3. **He learns** (Hello Neighbor): locks used doors, repairs, puts loot back, traps hot spots.
4. **Loot weight & noise**: big loot = slow, loud, needs two pigs.
5. **Scarce weapons** that break / get confiscated.
6. **Breathing windows** (avoid frustration): coffee, nap, phone call, toilet = chances for big heists;
   with 2+ pigs caged he guards the grill instead of hunting.
7. **Modifiers**: night (flashlight), rain (mud everywhere, slippery), market day (truck + visitor), bad mood (faster).

## Farms (levels) — each: own layout, routine, mission pool
1. Bob's family farm (the current world: barn, sty, house, garage, windmill, pasture) ← first.
2. Orchard & beehives · 3. Dairy & cheese (bull!) · 4. Pumpkin farm at night · 5. Winter farm (ice).

## Inspirations
Untitled Goose Game (routine NPC, act natural, to-do list) · Burglin' Gnomes (loot to the van, weight, co-op carry) ·
Hello Neighbor / Granny (learning AI, traps) · Dead by Daylight (hook ≈ cage + team rescue) ·
Gang Beasts / Party Animals / Human Fall Flat (wobbly grab physics, ragdoll) · Goat Simulator (chaos) ·
Thief / Hitman (suspicion meter, noise, disguise ≈ mud).

## Tech
- TypeScript + Vite, Three.js (render), Rapier (physics + ragdolls).
- Online: host-authoritative (host browser simulates; others send input, get snapshots) through a tiny WebSocket relay
  with 4-letter room codes (same design as Nice Crash `server/relay.js`). Solo = offline host.
- Characters: segmented → ragdoll. Pig = Kenney Cube Pets pig (body + 4 leg nodes, stands up on its hind legs);
  farmer = skinned bones driven by ragdoll bodies when knocked down.
- Claude runs the game headless in Chromium (screenshots, bots, 4 players over a local relay) before every push.
- Hosting: Porkour is private → GitHub Pages needs it public; else Render (free, sleeps). Relay: Render free.

## Assets
- In repo: Kenney Cube Pets (GLB), Medieval Village MegaKit (glTF), Quaternius Farm Buildings (FBX → convert),
  Mixamo Bob + 8 animations (FBX → convert), fonts.
- Claude fetches (CC0, GitHub mirrors as in Nice Crash `tools/fetch_assets.sh`): Kenney (Nature, Car = tractor/truck,
  Furniture, Food, Fantasy Town, Castle, Graveyard, Platformer, particles, sounds), KayKit (Adventurers weapons,
  Restaurant, Furniture, Halloween), Quaternius (Stylized Nature MegaKit, Universal Animation Library 1+2, Furniture).
- User downloads (sites blocked for Claude): Quaternius Ultimate Crops, Fantasy Props MegaKit, Ultimate Guns;
  later extra Mixamo animations for Bob; freesound.org CC0 farts / pig sounds.

## Milestones
1. Web skeleton + Farm 1 world + one pig (4/2 legs, fart, sprint, wallow, grab/throw, ragdoll, camera) — solo in the browser.
2. Farmer: routine, suspicion, chase, carry, cage, BBQ, poise / knockdown.
3. Online 4 players (relay + room codes).
4. Loot, missions, round loop, weapons.
5. Alert levels, dog, traps, modifiers; farm 2…; shop.
