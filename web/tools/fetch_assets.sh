#!/usr/bin/env bash
# Builds web/public/assets from free CC0 packs + the art already in the Unity project.
# Sources (asset sites are blocked from the cloud sandbox, GitHub is not):
#   Kenney     github.com/ETdoFresh/kenney.nl (mirror of kenney.nl)
#   KayKit     github.com/KayKit-Game-Assets/*
#   Quaternius github.com/tilakpatell/tilakverse-assets (Stylized Nature MegaKit, UAL)
#   repo       ../Assets/Art (Cube Pets, Quaternius Farm Buildings FBX, Mixamo Bob FBX), ../Assets/Audio
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
  '/kenney_impactsounds/' '/kenney_rpgaudio/' '/kenney_interfacesounds/' '/particlePack_1.1/PNG (Transparent)/' \
  '/kenney_musicjingles/'
K=$CACHE/kenney
grab kenney "$K/kenney_natureKit_2.1/Models/GLTF format" 512 \
  fence_simple fence_simpleHigh fence_gate fence_planks fence_planksDouble fence_corner \
  crop_pumpkin crop_carrot crop_melon crop_turnip crops_cornStageB crops_cornStageD crops_wheatStageB \
  crops_leafsStageB crops_dirtRow crops_dirtDoubleRow log log_stack log_stackLarge stump_round \
  pot_large pot_small sign tree_oak tree_default tree_fat tree_pineRoundA rock_largeA rock_smallA \
  plant_bushLarge plant_bush campfire_logs bridge_wood
grab kenney "$K/fantasy-town-kit-1.0/Models/GLTF format" 512 cart cartHigh wheel stall stallRed lantern \
  fountainRound planks
grab kenney "$K/carkit_v1.4/Models/GLTF format" 512 tractor truck truckFlat
grab kenney "$K/kenney_platformerkit/Models/GLTF format" 512 crate barrel

# ---------------------------------------------------------------- KayKit (CC0)
KK=https://github.com/KayKit-Game-Assets
pack $KK/KayKit-Restaurant-Bits-1.0 kk-restaurant '/addons/kaykit_restaurant_bits/Assets/gltf/'
grab kaykit "$CACHE/kk-restaurant/addons/kaykit_restaurant_bits/Assets/gltf" 1024 \
  crate crate_carrots crate_potatoes crate_tomatoes crate_cheese crate_ham crate_onions crate_lettuce \
  food_ingredient_ham food_ingredient_cheese food_ingredient_tomato food_ingredient_carrot food_ingredient_steak \
  jar_A_large jar_B_medium
pack $KK/KayKit-Character-Pack-Adventures-1.0 kk-adv '/addons/kaykit_character_pack_adventures/Assets/gltf/'
grab kaykit "$CACHE/kk-adv/addons/kaykit_character_pack_adventures/Assets/gltf" 1024 \
  sword_1handed axe_1handed dagger shield_round mug_full crossbow_2handed

# ---------------------------------------------------------------- Quaternius Stylized Nature MegaKit (CC0)
pack https://github.com/tilakpatell/tilakverse-assets quaternius '/quaternius/stylized-nature-megakit/glTF/'
grab nature "$CACHE/quaternius/quaternius/stylized-nature-megakit/glTF" 512 \
  CommonTree_1 CommonTree_2 CommonTree_3 CommonTree_4 CommonTree_5 Pine_1 Pine_2 Pine_3 Birch_3 \
  Bush_Common Bush_Common_Flowers Bush_Large Fern_1 Flower_3_Group Flower_4_Group Grass_Wheat \
  Grass_Common_Tall Grass_Wispy_Tall Clover_1 Mushroom_Common Rock_Medium_1 Rock_Medium_2 Rock_Medium_3 \
  Rock_Big_1 Pebble_Round_1 Plant_1_Big

# ---------------------------------------------------------------- repo art
CP="$REPO/Assets/Art/Animals/kenney_cube-pets_1.0/Models/GLB format"
for a in pig hog cow chick dog cat bunny; do glb "$CP/animal-$a.glb" "$OUT/pets/$a.glb" 256; done
FB="$REPO/Assets/Art/Farm/Farm Buildings by Quaternius/FBX"
mkdir -p "$OUT/farm"
for b in Barn BigBarn SmallBarn OpenBarn ChickenCoop Silo Silo_House TowerWindmill Windmill WaterTower Well Fence Fence2; do
  [ -f "$OUT/farm/$b.glb" ] || "$FBX" --binary -i "$FB/$b.fbx" -o "$OUT/farm/$b" >/dev/null 2>&1
done
MK="$REPO/Assets/Art/Farm/Medieval Village MegaKit[Standard]/Medieval Village MegaKit[Standard]/glTF"
grab kit "$MK" 512 Prop_Crate Prop_Wagon Prop_Chimney Prop_WoodenFence_Single Prop_WoodenFence_Extension1

# ---------------------------------------------------------------- sounds (ogg)
S="$OUT/sfx"; mkdir -p "$S"
snd() { [ -f "$S/$2.ogg" ] || ffmpeg -loglevel error -y -i "$1" -ac 1 -c:a libvorbis -q:a 4 "$S/$2.ogg"; }
A=$K/kenney_impactsounds/Audio
snd "$A/impactPunch_heavy_000.ogg" punch; snd "$A/impactPunch_medium_001.ogg" punch2
snd "$A/impactSoft_heavy_001.ogg" thud; snd "$A/impactSoft_medium_002.ogg" thud2
snd "$A/impactWood_heavy_000.ogg" wood; snd "$A/impactWood_medium_002.ogg" wood2
snd "$A/impactPlank_medium_000.ogg" plank; snd "$A/impactMetal_medium_000.ogg" metal
snd "$A/footstep_grass_000.ogg" step1; snd "$A/footstep_grass_001.ogg" step2
snd "$A/footstep_grass_002.ogg" step3; snd "$A/footstep_grass_003.ogg" step4
snd "$K/kenney_rpgaudio/Audio/cloth1.ogg" cloth; snd "$K/kenney_rpgaudio/Audio/handleSmallLeather.ogg" grab
snd "$K/kenney_rpgaudio/Audio/footstep05.ogg" mudstep
snd "$K/kenney_rpgaudio/Audio/metalLatch.ogg" latch; snd "$K/kenney_rpgaudio/Audio/metalClick.ogg" click
snd "$K/kenney_rpgaudio/Audio/chop.ogg" chop
J="$K/kenney_musicjingles/Audio"   # stings for the farmer (picked by pitch contour)
snd "$J/Hit jingles/jingles_HIT03.ogg" jingle_alert; snd "$J/Pizzicato jingles/jingles_PIZZI01.ogg" jingle_caught
snd "$J/Sax jingles/jingles_SAX01.ogg" jingle_grilled; snd "$J/Pizzicato jingles/jingles_PIZZI10.ogg" jingle_free
snd "$J/Sax jingles/jingles_SAX04.ogg" jingle_knock
snd "$K/kenney_interfacesounds/Audio/drop_002.ogg" throw; snd "$K/kenney_interfacesounds/Audio/pluck_001.ogg" pop
snd "$K/kenney_interfacesounds/Audio/error_004.ogg" denied
AU="$REPO/Assets/Audio"
snd "$AU/Short Fart.wav" fart_short; snd "$AU/Deep Fart.mp3" fart_deep
M="$OUT/music"; mkdir -p "$M"
for t in "Theme Song" "Level Music" "Winner"; do
  f=$(echo "$t" | tr 'A-Z ' 'a-z_'); [ -f "$M/$f.ogg" ] || ffmpeg -loglevel error -y -i "$AU/$t.mp3" -c:a libvorbis -q:a 3 "$M/$f.ogg"
done
P="$OUT/fx"; mkdir -p "$P"
for n in smoke_04 smoke_07 dirt_02 star_06 circle_05; do cp "$K/particlePack_1.1/PNG (Transparent)/$n.png" "$P/"; done
cp "$K/kenney_impactsounds/License.txt" "$OUT/LICENSE-kenney.txt"
echo "assets: $(du -sh "$OUT" | cut -f1)"
