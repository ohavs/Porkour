#!/usr/bin/env bash
# Builds web/public/assets from free CC0 packs + the art already in the Unity project.
# Sources (asset sites are blocked from the cloud sandbox, GitHub is not):
#   Kenney     github.com/ETdoFresh/kenney.nl (mirror of kenney.nl)
#   KayKit     github.com/KayKit-Game-Assets/*
#   Quaternius github.com/tilakpatell/tilakverse-assets (Stylized Nature MegaKit, UAL), github.com/trebeljahr/quaternius-showcase (animals)
#   repo       ../Assets/Art (Quaternius Farm Buildings FBX, Medieval kit)
#   KayKit hats / capes are extracted from the character GLBs with tools/extract_nodes.mjs
# Usage: cd web && bash tools/fetch_assets.sh      (idempotent; output is committed)
set -euo pipefail
WEB=$(cd "$(dirname "$0")/.." && pwd)
REPO=$(cd "$WEB/.." && pwd)
OUT="$WEB/public/assets"
CACHE=${PACKS_CACHE:-$WEB/.cache/packs}
GT="$WEB/node_modules/.bin/gltf-transform"
FBX="$WEB/node_modules/fbx2gltf/bin/Linux/FBX2glTF"
chmod +x "$FBX" 2>/dev/null || true
mkdir -p "$OUT" "$CACHE"

pack() { # pack <git url> <dir> <sparse paths>...
  local url=$1 dir=$2; shift 2
  [ -d "$CACHE/$dir/.git" ] || git clone -q --filter=blob:none --no-checkout --depth 1 "$url" "$CACHE/$dir"
  (cd "$CACHE/$dir" && git config gc.auto 0 && git sparse-checkout set --no-cone "$@" && git checkout -q)
}
# glb <src .gltf/.glb> <dest .glb> [maxTex]  — pack to GLB, shrink textures, WebP
glb() {
  local src=$1 dst=$2 tex=${3:-512}
  [ -f "$dst" ] && return 0
  mkdir -p "$(dirname "$dst")"
  "$GT" copy "$src" "$dst" >/dev/null
  if "$GT" inspect "$dst" 2>/dev/null | grep -q "image/"; then
    "$GT" resize "$dst" "$dst" --width "$tex" --height "$tex" >/dev/null
    "$GT" webp "$dst" "$dst" >/dev/null
  fi
}
grab() { # grab <dest subdir> <src dir> <tex> names...
  local d=$1 s=$2 t=$3; shift 3
  for n in "$@"; do
    if [ -f "$s/$n.glb" ]; then glb "$s/$n.glb" "$OUT/$d/$n.glb" "$t"; else glb "$s/$n.gltf" "$OUT/$d/$n.glb" "$t"; fi
  done
}

# ---------------------------------------------------------------- Kenney (CC0)
pack https://github.com/ETdoFresh/kenney.nl kenney \
  '/kenney_natureKit_2.1/Models/GLTF format/' '/fantasy-town-kit-1.0/Models/GLTF format/' \
  '/carkit_v1.4/Models/GLTF format/' '/kenney_platformerkit/Models/GLTF format/' \
  '/kenney_impactsounds/License.txt' '/particlePack_1.1/PNG (Transparent)/' '/kenney_holidaypack/Models/GLTF format/' '/kenney_holidaypack/License.txt' 
K=$CACHE/kenney
grab kenney "$K/kenney_natureKit_2.1/Models/GLTF format" 512 \
  fence_simple fence_simpleHigh fence_gate fence_planks fence_planksDouble fence_corner \
  crop_pumpkin crop_carrot crop_melon crop_turnip crops_cornStageB crops_cornStageD crops_wheatStageB \
  crops_leafsStageB crops_dirtRow crops_dirtDoubleRow log log_stack log_stackLarge stump_round \
  pot_large pot_small sign tree_oak tree_default tree_fat tree_pineRoundA rock_largeA rock_smallA \
  plant_bushLarge plant_bush campfire_logs bridge_wood
grab kenney "$K/fantasy-town-kit-1.0/Models/GLTF format" 512 cart cartHigh wheel stall stallRed lantern \
  fountainRound planks
grab kenney "$K/carkit_v1.4/Models/GLTF format" 512 tractor truck truckFlat sedan van delivery
grab kenney "$K/kenney_platformerkit/Models/GLTF format" 512 crate barrel

# ---------------------------------------------------------------- KayKit (CC0)
KK=https://github.com/KayKit-Game-Assets
pack $KK/KayKit-Restaurant-Bits-1.0 kk-restaurant '/addons/kaykit_restaurant_bits/Assets/gltf/'
grab kaykit "$CACHE/kk-restaurant/addons/kaykit_restaurant_bits/Assets/gltf" 1024 \
  crate crate_carrots crate_potatoes crate_tomatoes crate_cheese crate_ham crate_onions crate_lettuce \
  food_ingredient_ham food_ingredient_cheese food_ingredient_tomato food_ingredient_carrot food_ingredient_steak \
  jar_A_large jar_B_medium
# chain modes (farms 6 / 7): the shed's kitchen (KayKit Restaurant, CC0)
grab kaykit "$CACHE/kk-restaurant/addons/kaykit_restaurant_bits/Assets/gltf" 1024 \
  oven stove_single fridge_A kitchencounter_straight_A kitchencounter_straight_B kitchentable_A kitchentable_A_large bowl pot_A cuttingboard \
  shelf_papertowel_decorated dishrack_plates lid_A kitchencabinet chair_stool
pack $KK/KayKit-Character-Pack-Adventures-1.0 kk-adv '/addons/kaykit_character_pack_adventures/Assets/gltf/'
grab kaykit "$CACHE/kk-adv/addons/kaykit_character_pack_adventures/Assets/gltf" 1024 \
  sword_1handed axe_1handed dagger shield_round mug_full crossbow_2handed

# ---------------------------------------------------------------- KayKit hats / capes for the pig wardrobe (extracted mesh nodes)
pack $KK/KayKit-Character-Pack-Skeletons-1.0 kk-skel '/addons/kaykit_character_pack_skeletons/Characters/gltf/'
pack $KK/KayKit-Character-Pack-Adventures-1.0 kk-adv '/addons/kaykit_character_pack_adventures/Assets/gltf/' '/addons/kaykit_character_pack_adventures/Characters/gltf/'
CH="$CACHE/kk-adv/addons/kaykit_character_pack_adventures/Characters/gltf"; SK="$CACHE/kk-skel/addons/kaykit_character_pack_skeletons/Characters/gltf"
node_x() { # node_x <src.glb> <dest name> <node>...
  local src=$1 dst="$OUT/cosm/$2.glb"; shift 2
  [ -f "$dst" ] && return 0
  mkdir -p "$OUT/cosm"; node "$WEB/tools/extract_nodes.mjs" "$src" "$dst" "$@"
  "$GT" resize "$dst" "$dst" --width 256 --height 256 >/dev/null; "$GT" webp "$dst" "$dst" >/dev/null
}
node_x "$CH/Mage.glb" wizard_hat Mage_Hat;            node_x "$CH/Barbarian.glb" viking_helmet Barbarian_Hat
node_x "$CH/Knight.glb" knight_helmet Knight_Helmet;  node_x "$SK/Skeleton_Warrior.glb" skull_helmet Skeleton_Warrior_Helmet
node_x "$SK/Skeleton_Mage.glb" dark_wizard_hat Skeleton_Mage_Hat; node_x "$SK/Skeleton_Rogue.glb" hood Skeleton_Rogue_Hood
node_x "$CH/Knight.glb" cape_knight Knight_Cape;      node_x "$CH/Mage.glb" cape_mage Mage_Cape
node_x "$CH/Barbarian.glb" cape_barbarian Barbarian_Cape; node_x "$CH/Rogue.glb" cape_rogue Rogue_Cape
# ---------------------------------------------------------------- KayKit Halloween Bits: lanterns + pumpkins for the farm (CC0)
pack $KK/KayKit-Halloween-Bits-1.0 kk-halloween '/addons/kaykit_halloween_bits/Assets/gltf/'
grab kaykit "$CACHE/kk-halloween/addons/kaykit_halloween_bits/Assets/gltf" 512 \
  lantern_standing lantern_hanging post_lantern pumpkin_orange pumpkin_orange_small pumpkin_orange_jackolantern pumpkin_yellow

# ---------------------------------------------------------------- Quaternius Stylized Nature MegaKit (CC0)
pack https://github.com/tilakpatell/tilakverse-assets quaternius '/quaternius/stylized-nature-megakit/glTF/'
grab nature "$CACHE/quaternius/quaternius/stylized-nature-megakit/glTF" 512 \
  CommonTree_1 CommonTree_2 CommonTree_3 CommonTree_4 CommonTree_5 Pine_1 Pine_2 Pine_3 Birch_3 \
  Bush_Common Bush_Common_Flowers Bush_Large Fern_1 Flower_3_Group Flower_4_Group Grass_Wheat \
  Grass_Common_Tall Grass_Wispy_Tall Clover_1 Mushroom_Common Rock_Medium_1 Rock_Medium_2 Rock_Medium_3 \
  Rock_Big_1 Pebble_Round_1 Plant_1_Big

# ---------------------------------------------------------------- Quaternius Ultimate Animated Animals (CC0): skinned + 12 clips
pack https://github.com/trebeljahr/quaternius-showcase qshow \
  '/public/glb/animals_pack/' \
  '/public/glb/crops_pack/Carrot_4.glb' '/public/glb/crops_pack/Lettuce_4.glb' '/public/glb/crops_pack/Tomato_4.glb' '/public/glb/crops_pack/Beet_4.glb' '/public/glb/crops_pack/BushBerries_4.glb' '/public/glb/crops_pack/Watermelon_4.glb' '/public/glb/crops_pack/Pumpkin_4.glb' '/public/glb/crops_pack/Wheat_4.glb' '/public/glb/crops_pack/Flowers_Crop.glb' '/public/glb/crops_pack/Apple_Crop.glb' '/public/glb/crops_pack/Orange_Crop.glb' \
  '/public/glb/rpg_items_pack/Gold_Ingots.glb' '/public/glb/rpg_items_pack/Chest_Closed.glb' '/public/glb/rpg_items_pack/Crown.glb' '/public/glb/rpg_items_pack/Chalice.glb' '/public/glb/rpg_items_pack/Coin.glb' '/public/glb/rpg_items_pack/Necklace1.glb' \
  '/public/glb/medieval_village_pack/Hay.glb' '/public/glb/medieval_village_pack/Bags.glb' '/public/glb/medieval_village_pack/MarketStand_1.glb' '/public/glb/medieval_village_pack/MarketStand_2.glb' '/public/glb/survival_pack/WoodLog.glb' '/public/glb/survival_pack/BearTrap_Open.glb' '/public/glb/survival_pack/BearTrap_Closed.glb' '/public/glb/real_time_strategy_pack/Crate_Big_Stack2.glb' '/public/glb/real_time_strategy_pack/Crate_Stack2.glb' '/public/glb/real_time_strategy_pack/Crate_Stack1.glb' '/public/glb/real_time_strategy_pack/Logs.glb' \
  '/public/glb/survival_pack/Radio.glb' '/public/glb/survival_pack/Phone.glb' '/public/glb/survival_pack/GasCan.glb' '/public/glb/survival_pack/Pan.glb' '/public/glb/survival_pack/PropaneTank.glb' '/public/glb/survival_pack/FirstAidKit.glb' '/public/glb/survival_pack/Backpack.glb' '/public/glb/survival_pack/Trashcan.glb' '/public/glb/survival_pack/Shovel.glb' '/public/glb/survival_pack/Shotgun_1.glb' \
  '/public/glb/platformer_pack/Bomb.glb' '/public/glb/rpg_items_pack/Key2.glb' \
  '/public/glb/medieval_village_pack/Mill.glb' '/public/glb/medieval_village_pack/Stable.glb' '/public/glb/medieval_village_pack/Inn.glb' '/public/glb/medieval_village_pack/Sawmill.glb' '/public/glb/medieval_village_pack/Gazebo.glb' '/public/glb/medieval_village_pack/Bell_Tower.glb' '/public/glb/medieval_village_pack/Cart.glb' '/public/glb/medieval_village_pack/Bench_1.glb' '/public/glb/medieval_village_pack/Cauldron.glb' '/public/glb/nature_pack/Willow_1.glb' '/public/glb/nature_pack/Willow_2.glb' '/public/glb/nature_pack/TreeStump.glb' \
  '/public/glb/medieval_village_pack/House_1.glb' '/public/glb/medieval_village_pack/House_2.glb' '/public/glb/medieval_village_pack/Blacksmith.glb' '/public/glb/medieval_village_pack/Bench_2.glb' \
  '/public/glb/nature_pack/*_Snow*.glb' \
  '/public/glb/medieval_weapons_pack/Scythe.glb' '/public/glb/medieval_village_pack/Bag.glb' '/public/glb/medieval_village_pack/Bag_Open.glb' \
  '/public/glb/medieval_village_pack/Barrel.glb' '/public/glb/modular_dungeon_1/Bucket.glb' '/public/glb/crops_pack/Wheat_Crop.glb' '/public/glb/crops_pack/Wheat_2.glb' \
  '/public/glb/platformer_pack/Ladder_medium.glb' '/public/glb/house_interior_pack/Houseplant_1.glb'
# ---------------------------------------------------------------- Quaternius Ultimate House Interior (CC0): furniture for the
# buildings' insides (world/interiors.ts) — beds, couches, chairs, tables, shelves, kitchen, bathroom, lamps, plants
INTERIOR="Bed_Single Bed_King Bed_Bunk Bookshelf Carpet_1 Carpet_Round Chair_1 Chair_2 Chair_3 Couch_Medium1 Couch_Small1 Couch_Large1 \
  Drawer_1 Drawer_3 Fireplace Houseplant_2 Houseplant_4 Houseplant_7 Kitchen_Fridge Kitchen_Oven Kitchen_Sink Kitchen_2Drawers \
  Kitchen_Cabinet1 Light_Floor1 Light_Desk Light_Stand1 NightStand_1 Shelf_1 Shelf_Small1 Stool Table_RoundLarge Table_RoundSmall \
  Trashcan_Small1 Bathroom_Toilet Bathroom_Bathtub Bathroom_WashingMachine Bathroom_ToiletPaper Bathroom_Sink Plate_1 Fork Knife Spoon"
pack https://github.com/trebeljahr/quaternius-showcase qshow-int $(for n in $INTERIOR; do echo "/public/glb/house_interior_pack/$n.glb"; done)
grab interior "$CACHE/qshow-int/public/glb/house_interior_pack" 256 $INTERIOR

for n in Cow ShibaInu Wolf Donkey Horse Horse_White Alpaca Bull Husky Stag Deer; do
  d="$OUT/animals/$n.glb"; [ -f "$d" ] && continue; mkdir -p "$OUT/animals"
  "$GT" resample "$CACHE/qshow/public/glb/animals_pack/$n.glb" "$d" >/dev/null && "$GT" prune "$d" "$d" >/dev/null
done

# loot (Quaternius RPG Items + Survival, CC0)
grab loot "$CACHE/qshow/public/glb/rpg_items_pack" 256 Gold_Ingots Chest_Closed Crown Chalice Coin Necklace1
grab loot "$CACHE/qshow/public/glb/survival_pack" 256 Radio Phone GasCan Pan PropaneTank FirstAidKit Backpack Trashcan Shovel

# chain modes (farms 6 / 7): scythe, sacks, a bucket, Bob's wheat, a ladder (Quaternius, CC0)
grab brew "$CACHE/qshow/public/glb/medieval_weapons_pack" 256 Scythe
grab brew "$CACHE/qshow/public/glb/medieval_village_pack" 256 Bag Bag_Open Barrel
grab brew "$CACHE/qshow/public/glb/modular_dungeon_1" 256 Bucket
grab brew "$CACHE/qshow/public/glb/crops_pack" 256 Wheat_Crop Wheat_2
grab brew "$CACHE/qshow/public/glb/platformer_pack" 256 Ladder_medium

# crops (Quaternius Ultimate Crops, CC0)
grab crops "$CACHE/qshow/public/glb/crops_pack" 256 Carrot_4 Lettuce_4 Tomato_4 Beet_4 BushBerries_4 Watermelon_4 Pumpkin_4 Wheat_4 Flowers_Crop Apple_Crop Orange_Crop

# cover / hiding spots (Quaternius Medieval Village, Survival, RTS; CC0). Bear traps: Bob's traps (world/traps.ts).
Q="$CACHE/qshow/public/glb"
grab cover "$Q/medieval_village_pack" 256 Hay Bags MarketStand_1 MarketStand_2
grab cover "$Q/survival_pack" 256 WoodLog BearTrap_Open BearTrap_Closed
grab cover "$Q/real_time_strategy_pack" 256 Crate_Big_Stack2 Crate_Stack2 Crate_Stack1 Logs
# Bob furious (alert 3): rock-salt shotgun (Quaternius Survival); dog bone to distract the guard dog (KayKit Halloween) — CC0
grab loot "$Q/survival_pack" 256 Shotgun_1
grab kaykit "$CACHE/kk-halloween/addons/kaykit_halloween_bits/Assets/gltf" 512 bone_A
# shop gadgets: cherry bomb (Quaternius Platformer), skeleton key (Quaternius RPG Items), stink bomb (KayKit smokebomb) — CC0
grab loot "$Q/platformer_pack" 256 Bomb
grab loot "$Q/rpg_items_pack" 256 Key2
grab kaykit "$CACHE/kk-adv/addons/kaykit_character_pack_adventures/Assets/gltf" 1024 smokebomb
# farm 2 (orchard & beehives): Quaternius Medieval Village buildings + willows by the pond (CC0)
grab village "$Q/medieval_village_pack" 256 Mill Stable Inn Sawmill Gazebo Bell_Tower Cart Bench_1 Cauldron House_1 House_2 Blacksmith Bench_2
grab nature "$Q/nature_pack" 256 Willow_1 Willow_2 TreeStump
# farm 4 (pumpkin farm at night): KayKit Halloween Bits — yellow pumpkins, autumn pines, dead trees, the old family plot (CC0)
grab halloween "$CACHE/kk-halloween/addons/kaykit_halloween_bits/Assets/gltf" 512 \
  pumpkin_yellow_small tree_dead_large tree_dead_medium tree_dead_small \
  tree_pine_orange_large tree_pine_orange_medium tree_pine_yellow_large tree_pine_yellow_medium \
  gravestone grave_A grave_B gravemarker_A gravemarker_B fence arch_gate crypt candle_triple skull_candle bench_decorated
# farm 5 (winter farm): Kenney Holiday Kit (snowmen, sled, presents, decorated tree, snowy pines) + Quaternius snowy
# trees / rocks / bushes (Ultimate Nature) + husky (guard dog) / stag + deer (Bob's reindeer) — all CC0
grab winter "$K/kenney_holidaypack/Models/GLTF format" 512 \
  snowman snowmanFancy sled snowFort snowPatch present presentRound presentLow treeDecorated treePineSnow \
  treePineSnowRound treePineSnowed wreath lightsMulti candyCane lightpost rockFormationLarge rockFormationMedium
grab winter "$Q/nature_pack" 256 PineTree_Snow_1 PineTree_Snow_2 PineTree_Snow_3 PineTree_Snow_4 CommonTree_Snow_1 \
  CommonTree_Snow_2 BirchTree_Snow_1 CommonTree_Dead_Snow_1 Bush_Snow_1 Bush_Snow_2 Rock_Snow_1 Rock_Snow_2 Rock_Snow_3 \
  TreeStump_Snow WoodLog_Snow

# ---------------------------------------------------------------- repo art
# (Cube Pets animals were replaced by procedural round animals: src/world/animalModels.ts)
FB="$REPO/Assets/Art/Farm/Farm Buildings by Quaternius/FBX"
mkdir -p "$OUT/farm"
for b in Barn BigBarn SmallBarn OpenBarn ChickenCoop Silo Silo_House TowerWindmill Windmill WaterTower Well Fence Fence2; do
  [ -f "$OUT/farm/$b.glb" ] || "$FBX" --binary -i "$FB/$b.fbx" -o "$OUT/farm/$b" >/dev/null 2>&1
done
MK="$REPO/Assets/Art/Farm/Medieval Village MegaKit[Standard]/Medieval Village MegaKit[Standard]/glTF"
grab kit "$MK" 512 Prop_Crate Prop_Wagon Prop_Chimney Prop_WoodenFence_Single Prop_WoodenFence_Extension1

# sounds: see tools/fetch_sounds.sh (real recordings, no Kenney / synth)
P="$OUT/fx"; mkdir -p "$P"
for n in smoke_04 smoke_07 dirt_02 star_06 circle_05; do cp "$K/particlePack_1.1/PNG (Transparent)/$n.png" "$P/"; done
cp "$K/kenney_impactsounds/License.txt" "$OUT/LICENSE-kenney.txt"
echo "assets: $(du -sh "$OUT" | cut -f1)"
