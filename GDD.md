# Porkour (browser) — GDD v2 draft (2026-11-12)

> New direction: browser game (Three.js + Rapier), equal pigs, heist on a living farm.
> The Unity project in `Assets/` stays untouched as reference; the web game lives in `web/`.

## Pitch
Up to 4 pig burglars vs one farmer. Goofy physics stealth-heist: the farm runs its own daily routine,
the pigs steal and wreck things while the farmer works. Get noticed → he chases, grabs, carries you
to the cage by his BBQ. Teammates bash him to drop you or break you out before the grill is hot.

## Look
Cartoon (cel shading + ink outlines, saturated colours, puffy clouds). Pigs = round, fat, long cartoon pigs (procedural model),
party hat in the player colour. Each level = one fenced farm compound (not open world), patchwork farmland around it.

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

## Session 20 additions (2026-11-19)
- **Bob's coffee break** (breathing window #4): he reads the paper on his porch rocker (blind to the front) and sips
  from his real mug on the side table; spike it (hot sauce from the grill / a muddy hoof) → spit-take, fire breath, runs
  to dunk his head, then hunts. Steal the mug → he searches the porch.
- **Land mines**: a few random ones each round (blinking light, a beep close by); step on one → sky-high; a pig lands as
  bacon for a few seconds; lure Bob onto one (prank).
- **Pig HP + gulag**: rock salt / mines / bangs / the bull hurt; HP comes back slowly. 0 HP → the gulag cabin: turn the
  big wheel / sack potatoes, then back to the sty.
- **Emote wheel**: hold B, 6 dances; the lounge (cannabis mode): a couch / armchair / beanbags you sit on facing the
  camera, smoke, eat, dance seated, pass the joint (G), an old TV. Very drunk: Q = throw up (blasts you backward).
- Next: furniture and things to do inside every building; full controller support.

## Active hands (2026-11-18, user: "not mini-games — the pig physically takes the filter, the paper, puts the filter on the paper, pours the stuff in and rolls it; like Burglin' Gnomes / Grr Grr Gnomes: the hands reach out, the thing sticks to them, you move it and it snaps where it goes — everywhere in the game")
- **Aim**: what you hold goes where your crosshair is (within reach); it stays upright and faces where you face.
  **Mouse wheel** = reach further (arms stretch when standing, the neck stretches on four legs), back = normal.
  **R** = tip what you hold (pour). RMB takes what the crosshair is on (a thing, a machine part, a dispenser).
- **Snap points**: a ghost shows where the thing you hold goes (paper → the rolling mat, filter → the paper's end,
  tray → the oven, coin → the payphone slot, bucket → under the pump…); close by the magnet pulls it in, click.
- **Pouring**: containers tipped over an opening pour a stream into it (weed bag → paper / bong bowl / pot, watering
  can → plants / bong, flour → bowl, pot of magic butter → bowl, bowl of dough → tray, bucket / malt → kettle).
- **Machine parts** you take with your hoof and move: crank wheels (grinder, mill, cider press), stirring spoons /
  paddle, levers (pump, oven door, kettle spigot, barrel tap, catapult release), sliders (outhouse bolt, phone plug,
  rolling a paper). Lock-picking stays a mini-game (user: fine for doors).

## Chain modes (2026-11-18: user "modes where the missions are very specific")
Built on Bob's family farm (his garden = the crop field, the greenhouse = the shed with a kitchen + machines, a pump by
the field, a balance log over the duck pond). Overcooked-style co-op production chain made of real actions with the
hooves (see Active hands), then challenges that are hard to do high / drunk. Points for everything made fill the
round's quota line.
- **Cannabis farm (farm 6)**: water the plants (tip the watering can over them; fill it under the pump — pump the
  handle — or dip it in the pond; too much water = puddle, growth stalls; Bob waters them too) · tip the seed bag over
  an empty mound · harvest ripe ones (sickle = 3 buds, a headbutt = 2) → toss them into the **wheelbarrow** (a real
  one: hold it by the handles, it rolls on its wheel and steers round it — look / A·D to turn; stand up and hold R =
  lift the handles high, it tips and the load slides out) → dump it on the **grate** beside the grinder (or drop buds
  on it): a belt carries them up into the hopper → turn the grinder's crank (too fast for too long jams, loud) → the bag under the chute fills (4 pinches) → **joint**:
  a paper from the booklet onto the mat, a filter onto its end, tip the bag over it (not too little / much), take the
  edge and push it away to roll, click = lick it shut → light it (strike the lighter, flame to its tip — a friend can
  hold the flame, or lay it in the ashtray) → click = puff · **bong**: pour water in the top, tip a pinch into the
  bowl, light the bowl, snout on the mouthpiece — the chamber fills, pull away in time (too long = coughing fit Bob
  hears) · **cookies**: butter into the pot, tip weed in, stir with the spoon (stop and it burns: smoke alarm) → tip
  the pot over the bowl + pour flour, stir → tip the bowl of dough over a tray → pull the oven door down, tray in, shut
  it → golden (late = burnt + alarm) → cookies kick in late.
- **View**: the modes start in **first person** (hooves on screen, they reach for what you hold / work); V (gamepad
  View, the 👁 button) switches to third person and back any time; knocked over / carried = third person for a moment.
- **Wheat & beer (farm 7)**: scythe the wheat → sheaves on the threshing floor → JUMP on them (a drum beats: stomps on
  the beat count double; all pigs together = fast) → grain sack → tip it into the mill's hopper, crank → malt sack →
  kettle over the fire pit: 2 water (bucket from the pump), tip the malt in, throw logs on the fire, stir with the
  paddle → drop 2 hops in (shake the hop poles) → boils → roll the barrel under the spigot (bung up), pull the lever
  → ferments ~30 s → hold a mug under the tap, pull its lever (a full mug foams over) → drink (burps are loud).
- **Buzzed**: high = colours shift / breathe, controls lag + drift, worse balance, giggly oinks; drunk = double vision,
  camera rolls, the pig lists to one side, left/right swap for a moment now and then. Cookies kick in after ~10 s.
- **Challenges** (one required, more as bonus): walk the log over the pond on two legs (counter-steer: it leans
  left → press right; falls = splash) · catch visions only buzzed pigs see (rainbow doughnuts / pink elephants) ·
  munchies (eat 5 things high) · hug Bob · lie back and watch the clouds · (beer) dance on the beer-garden table,
  serenade Bob with 6 oinks.
- **Bob (open question, user: "not sure Bob should chase in this mode")**: Claude's pick = **chill Bob** (default
  in these modes): still there, still the threat, but laid-back — sees / hears less, slower in a chase, suspicion
  builds slower; smoke, coughing fits, burps, the smoke alarm and the threshing drum are what bring him over. Keeps the
  game's identity (stealth vs Bob) while the chain is the main game. Admin → Bob: "Chill Bob" off = full Bob,
  "Farmer Bob" off = no Bob (pure co-op party). Decide after playing.
- Store note: drug / alcohol content affects age ratings (PEGI 16–18 / ESRB M) — plan a "family" toggle or keep
  these modes clearly separate if that matters later.

## Inspirations
Untitled Goose Game (routine NPC, act natural, to-do list) · Burglin' Gnomes (loot to the van, weight, co-op carry) ·
Hello Neighbor / Granny (learning AI, traps) · Dead by Daylight (hook ≈ cage + team rescue) ·
Gang Beasts / Party Animals / Human Fall Flat (wobbly grab physics, ragdoll) · Goat Simulator (chaos) ·
Thief / Hitman (suspicion meter, noise, disguise ≈ mud).

## Tech
- TypeScript + Vite, Three.js (render), Rapier (physics + ragdolls).
- Online: host-authoritative (host browser simulates; others send input, get snapshots) through a tiny WebSocket relay
  with 4-letter room codes, public room list, quick play, invite links, Google sign-in or guest; players connect
  peer-to-peer (WebRTC) to the host when possible, else through the server. Solo = offline host.
- Characters: segmented → ragdoll. Pig = Kenney Cube Pets pig (body + 4 leg nodes, stands up on its hind legs);
  farmer = skinned bones driven by ragdoll bodies when knocked down.
- Claude runs the game headless in Chromium (screenshots, bots, 4 players over a local relay) before every push.
- Hosting: Porkour is private → GitHub Pages needs it public; else Render (free, sleeps). Relay: Render free.

## Assets
- In repo: Kenney Cube Pets (GLB), Medieval Village MegaKit (glTF), Quaternius Farm Buildings (FBX → convert),
  Mixamo Bob + 8 animations (FBX → convert), fonts.
- Claude fetches (CC0, GitHub mirrors, `web/tools/fetch_assets.sh`): Kenney (Nature, Car = tractor/truck,
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
