#!/usr/bin/env bash
# Real recorded sounds (no synths, no Kenney) from open-source games on GitHub, + the user's own audio.
# Every file is listed with its source + license in public/assets/sfx/CREDITS.md (written by this script).
#   VoxeLibre  github.com/VoxeLibre/VoxeLibre   mobs_mc sounds: CC0 / MIT (per LICENSE-media.md), mcl_sounds CC BY 3.0
#   0 A.D.     github.com/0ad/0ad               CC BY-SA 3.0, Wildfire Games
#   Wesnoth    github.com/wesnoth/wesnoth       GPL-2.0-or-later
#   Veloren    github.com/veloren/veloren       crickets / birdcalls by DaforLynx, CC BY 4.0
#   Animalia   github.com/ElCeejo/animalia      turkey, MIT
# Drop-in replacements: put <name>.ogg (or .mp3/.wav, converted by this script from web/sfx_user/) — see SOUNDS in src/core/sounds.ts.
# Usage: cd web && bash tools/fetch_sounds.sh        (idempotent; output is committed)
set -euo pipefail
WEB=$(cd "$(dirname "$0")/.." && pwd)
REPO=$(cd "$WEB/.." && pwd)
OUT="$WEB/public/assets/sfx"
CACHE=${PACKS_CACHE:-$WEB/.cache/packs}
mkdir -p "$OUT" "$CACHE"

pack() { # pack <git url> <dir> <sparse paths>...
  local url=$1 dir=$2; shift 2
  [ -d "$CACHE/$dir/.git" ] || git clone -q --filter=blob:none --no-checkout --depth 1 "$url" "$CACHE/$dir"
  (cd "$CACHE/$dir" && git config gc.auto 0 && git sparse-checkout set --no-cone "$@" && git checkout -q)
}

CREDITS="$OUT/CREDITS.md"
declare -A SRC=()
# snd <src> <name> [peak dB] [max secs] [license note]  — mono ogg, leading silence trimmed, peak-normalised
snd() {
  local src=$1 name=$2 peak=${3:--2} max=${4:-0} note=${5:-}
  SRC[$name]="$note"
  [ -f "$OUT/$name.ogg" ] && return 0
  local mx gain trim=""
  mx=$(ffmpeg -hide_banner -i "$src" -af volumedetect -f null - 2>&1 | grep -oE 'max_volume: [-0-9.]+' | awk '{print $2}')
  gain=$(awk -v m="$mx" -v p="$peak" 'BEGIN{print p-m}')
  [ "$max" != "0" ] && trim=",atrim=0:$max,afade=t=out:st=$(awk -v m="$max" 'BEGIN{print m-0.4}'):d=0.4"
  ffmpeg -loglevel error -y -i "$src" -ac 1 -af "silenceremove=start_periods=1:start_threshold=-50dB,volume=${gain}dB$trim" \
    -c:a libvorbis -q:a 3 "$OUT/$name.ogg"
}

# ---------------------------------------------------------------- sources
pack https://github.com/VoxeLibre/VoxeLibre VoxeLibre '/mods/ENTITIES/mobs_mc/sounds/' '/mods/ENTITIES/mobs_mc/LICENSE-media.md' \
  '/mods/CORE/mcl_sounds/sounds/' '/mods/CORE/mcl_sounds/README.txt'
A=binaries/data/mods/public/audio
pack https://github.com/0ad/0ad 0ad "/$A/actor/fauna/animal/pig_*" "/$A/actor/fauna/animal/chicken_*" "/$A/actor/fauna/animal/cattle_*" \
  "/$A/actor/singlesteps/fs_grass*" "/$A/actor/singlesteps/fs_gravel[1-4]*" "/$A/attack/impact/fleshimp_*" \
  "/$A/attack/impact/shield_wood_0*" "/$A/attack/impact/shield_metal_0[1-4]*" "/$A/attack/impact/arrow_dirt_0[1-6]*" \
  "/$A/attack/fire/c_1[1-3]*" "/$A/attack/fire/sz1[1-3]*" "/$A/ambient/dayscape/day_temperate_1*" "/$A/ambient/building/amb_farm_1*" \
  "/$A/ambient/weather/rain_1*" "/$A/ambient/weather/thunder_1*" "/$A/LICENSE.txt"
pack https://github.com/wesnoth/wesnoth wesnoth '/data/core/sounds/ambient/night.ogg' '/data/core/sounds/ambient/morning.ogg' \
  '/data/core/sounds/bite-small.ogg' '/data/core/sounds/club.ogg' '/data/core/sounds/dwarf-laugh.wav' '/data/core/sounds/fanfare-short.wav' \
  '/data/core/sounds/fist.ogg' '/data/core/sounds/gold.ogg' '/data/core/sounds/groan.wav' '/data/core/sounds/human-old-*' \
  '/data/core/sounds/miss-*' '/data/core/sounds/mud-*' '/data/core/sounds/open-chest.wav' '/data/core/sounds/squishy-*' \
  '/data/core/sounds/throw-*' '/data/core/sounds/wolf-*' '/data/core/sounds/thunderstick.ogg' '/data/core/sounds/gunshot.wav' '/data/core/sounds/pincers.ogg' '/data/campaigns/The_Hammer_of_Thursagan/sounds/unlock.ogg'
pack https://github.com/ElCeejo/animalia animalia '/sounds/turkey/' '/LICENSE'
pack https://github.com/veloren/veloren veloren '/assets/voxygen/audio/sfx/ambient/crickets_*' '/assets/voxygen/audio/sfx/ambient/birdcall_0[1-5]*'

VL=$CACHE/VoxeLibre/mods/ENTITIES/mobs_mc/sounds; VS=$CACHE/VoxeLibre/mods/CORE/mcl_sounds/sounds
OA=$CACHE/0ad/$A; WS=$CACHE/wesnoth/data/core/sounds; VE=$CACHE/veloren/assets/voxygen/audio/sfx/ambient
VLc="VoxeLibre mobs_mc, CC0"; VLm="VoxeLibre (TenPlus1 mobs_animal), MIT"; VSb="VoxeLibre mcl_sounds, CC BY 3.0"
OAc="0 A.D. by Wildfire Games, CC BY-SA 3.0"; WSg="Battle for Wesnoth, GPL-2.0-or-later"; VEc="Veloren (DaforLynx), CC BY 4.0"

# ---------------------------------------------------------------- pigs
snd "$VL/mobs_pig.ogg" oink1 -2 0 "$VLm"
snd "$OA/actor/fauna/animal/pig_10.ogg" oink2 -2 0 "$OAc"
snd "$VL/mobs_mc_zombiepig_random.1.ogg" oink3 -3 0 "$VLc"
snd "$VL/mobs_mc_zombiepig_hurt.1.ogg" grunt1 -3 0 "$VLc"
snd "$VL/mobs_mc_zombiepig_hurt.3.ogg" grunt2 -3 0 "$VLc"
snd "$OA/actor/fauna/animal/pig_squeal_move.ogg" squeal1 -2 0 "$OAc"
snd "$VL/mobs_pig_angry.ogg" squeal2 -2 0 "$VLm"
snd "$VL/mobs_mc_zombiepig_hurt.2.ogg" squeal3 -2 0 "$VLc"
snd "$OA/actor/fauna/animal/pig_death.ogg" pigcry1 -2 0 "$OAc"
snd "$VL/mobs_mc_zombiepig_death.1.ogg" pigcry2 -2 0 "$VLc"
for i in 1 2 3 4; do snd "$OA/actor/singlesteps/fs_grass$i.ogg" step$i -6 0 "$OAc"; done
for i in 1 2 3 4; do snd "$OA/actor/singlesteps/fs_gravel$i.ogg" boot$i -5 0 "$OAc"; done
for i in 1 2 3; do snd "$VS/default_water_footstep.$i.ogg" mudstep$i -6 0 "$VSb"; done
for i in 1 2 3; do snd "$VS/default_grass_footstep.$i.ogg" rustle$i -6 0 "$VSb"; done
snd "$WS/mud-glob.ogg" splat1 -2 0 "$WSg"; snd "$WS/mud-fist.ogg" splat2 -2 0 "$WSg"
snd "$WS/bite-small.ogg" bite -3 0 "$WSg"
for i in 1 2 3; do snd "$WS/miss-$i.ogg" whoosh$i -4 0 "$WSg"; done
snd "$WS/throw-1.wav" throw -3 0 "$WSg"
# ---------------------------------------------------------------- hits / impacts
snd "$WS/fist.ogg" punch1 -1 0 "$WSg"; snd "$WS/club.ogg" punch2 -1 0 "$WSg"
for i in 0 1 2; do snd "$OA/attack/impact/fleshimp_1$i.ogg" body$((i + 1)) -2 0 "$OAc"; done
snd "$WS/squishy-hit.wav" slap1 -1 0 "$WSg"; snd "$WS/squishy-strike.wav" slap2 -1 0 "$WSg"
for i in 1 2 3; do snd "$OA/attack/impact/arrow_dirt_0$i.ogg" thud$i -3 0 "$OAc"; done
for i in 1 2 3 4 5 6; do snd "$OA/attack/impact/shield_wood_0$i.ogg" wood$i -3 0 "$OAc"; done
for i in 1 2 3 4; do snd "$OA/attack/impact/shield_metal_0$i.ogg" metal$i -4 0 "$OAc"; done
snd "$WS/squishy-miss.wav" squish -3 0 "$WSg"
# ---------------------------------------------------------------- Bob (gruff old man)
for i in 1 2 3 4; do snd "$WS/human-old-hit-$i.ogg" bob_oof$i -1 0 "$WSg"; done
for i in 1 2 3; do snd "$WS/human-old-die-$i.ogg" bob_down$i -1 0 "$WSg"; done
snd "$WS/dwarf-laugh.wav" bob_laugh -2 0 "$WSg"
snd "$WS/groan.wav" bob_huh -3 0 "$WSg"
# ---------------------------------------------------------------- cage / grill / misc
snd "$CACHE/wesnoth/data/campaigns/The_Hammer_of_Thursagan/sounds/unlock.ogg" unlock -3 0 "$WSg"
snd "$WS/open-chest.wav" creak -3 0 "$WSg"
snd "$OA/attack/fire/sz11.ogg" sizzle -4 0 "$OAc"
snd "$OA/attack/fire/c_11.ogg" crackle -6 0 "$OAc"
snd "$WS/fanfare-short.wav" fanfare -4 0 "$WSg"
snd "$WS/gold.ogg" coins -4 0 "$WSg"
# Bob furious: rock-salt blunderbuss; bear trap snapping shut
snd "$WS/thunderstick.ogg" shot1 -1 0 "$WSg"; snd "$WS/gunshot.wav" shot2 -1 0 "$WSg"
snd "$WS/pincers.ogg" snap -1 0 "$WSg"
# ---------------------------------------------------------------- animals
snd "$VL/mobs_mc_cow.ogg" moo1 -3 0 "$VLc"; snd "$OA/actor/fauna/animal/cattle_02.ogg" moo2 -3 0 "$OAc"
snd "$VL/mobs_mc_horse_random.1.ogg" neigh1 -3 0 "GoodListener (freesound 322454) via VoxeLibre, CC BY 3.0"
snd "$VL/mobs_mc_horse_random.2.ogg" neigh2 -3 0 "ERH (freesound 32043) via VoxeLibre, CC BY 3.0"
snd "$VL/mobs_mc_donkey_random.1.ogg" bray1 -3 0 "Garuda1982 (freesound 539505) via VoxeLibre, CC BY 3.0"
snd "$VL/mobs_mc_donkey_random.2.ogg" bray2 -3 0 "JarredGibb (freesound 233131) via VoxeLibre, CC0"
snd "$VL/mobs_sheep.ogg" baa1 -4 0 "Blender Foundation via VoxeLibre, CC BY 3.0"
snd "$VL/mobs_mc_llama.ogg" llama -4 0 "$VLm"
for i in 1 2 3; do snd "$VL/mobs_mc_chicken_buck.$i.ogg" cluck$i -5 0 "$VLc"; done
snd "$VL/mobs_mc_chicken_hurt.ogg" squawk -3 0 "$VLc"
for i in 1 2 3; do snd "$VL/mobs_mc_wolf_bark.$i.ogg" bark$i -2 0 "$VLc"; done
snd "$VL/mobs_mc_wolf_growl.ogg" growl1 -2 0 "$VLc"
for i in 1 2 3; do snd "$WS/wolf-growl-$i.ogg" growl$((i + 1)) -2 0 "$WSg"; done
for i in 1 2; do snd "$WS/wolf-hit-$i.ogg" yelp$i -2 0 "$WSg"; done
snd "$WS/wolf-die-2.ogg" howl -2 0 "$WSg"
snd "$VL/mobs_mc_cat_idle.2.ogg" meow -4 0 "$VLc"
snd "$VL/mobs_mc_animal_eat_generic.ogg" munch -4 0 "$VLc"
AN=$CACHE/animalia/sounds/turkey; ANm="Animalia by ElCeejo, MIT"
snd "$AN/animalia_turkey.ogg" gobble1 -2 0 "$ANm"; snd "$AN/animalia_turkey_hurt.ogg" gobble2 -2 0 "$ANm"
# ---------------------------------------------------------------- ambience (day / night)
snd "$WS/ambient/morning.ogg" rooster -3 0 "$WSg"
snd "$WS/ambient/night.ogg" night -6 0 "$WSg"
for i in 1 2 3; do snd "$VE/crickets_$i.ogg" cricket$i -8 0 "$VEc"; done
for i in 3 4 5; do snd "$VE/birdcall_0$i.ogg" bird$i -10 0 "$VEc"; done
snd "$OA/ambient/dayscape/day_temperate_11.ogg" amb_day -10 0 "$OAc"
snd "$OA/ambient/building/amb_farm_11.ogg" amb_farm -12 0 "$OAc"
# weather (round modifier "rain")
snd "$OA/ambient/weather/rain_11.ogg" rain -8 0 "$OAc"
snd "$OA/ambient/weather/thunder_10.ogg" thunder1 -2 0 "$OAc"; snd "$OA/ambient/weather/thunder_11.ogg" thunder2 -2 0 "$OAc"

# ---------------------------------------------------------------- the user's own audio (Unity Assets/Audio)
AU="$REPO/Assets/Audio"
snd "$AU/Short Fart.wav" fart_short -1 0 "User's own audio (Assets/Audio)"; snd "$AU/Deep Fart.mp3" fart_deep -1 0 "User's own audio (Assets/Audio)"
M="$WEB/public/assets/music"; mkdir -p "$M"
for t in "Theme Song" "Level Music" "Winner"; do
  f=$(echo "$t" | tr 'A-Z ' 'a-z_'); [ -f "$M/$f.ogg" ] || ffmpeg -loglevel error -y -i "$AU/$t.mp3" -c:a libvorbis -q:a 3 "$M/$f.ogg"
done

# ---------------------------------------------------------------- user drop-ins: web/sfx_user/<name>.(wav|mp3|ogg|flac) → sfx/<name>.ogg
if [ -d "$WEB/sfx_user" ]; then
  for f in "$WEB"/sfx_user/*.wav "$WEB"/sfx_user/*.mp3 "$WEB"/sfx_user/*.ogg "$WEB"/sfx_user/*.flac; do
    [ -f "$f" ] || continue
    n=$(basename "${f%.*}"); rm -f "$OUT/$n.ogg"; snd "$f" "$n" -2 0 "User-supplied (sfx_user/$(basename "$f"))"
  done
fi

# ---------------------------------------------------------------- credits
{
  echo "# Sound credits"
  echo
  echo "All sounds are real recordings taken from open-source games (no synthesized placeholders)."
  echo "Licenses: CC0 (public domain), MIT, CC BY 3.0 / 4.0 and CC BY-SA 3.0 (credit the author; share-alike files stay CC BY-SA),"
  echo "GPL-2.0-or-later (Battle for Wesnoth). Replace the GPL files before any closed-source / commercial release."
  echo
  echo "| File | Source, license |"
  echo "|---|---|"
  for k in $(printf '%s\n' "${!SRC[@]}" | sort); do echo "| $k.ogg | ${SRC[$k]} |"; done
  echo
  echo "- VoxeLibre: https://github.com/VoxeLibre/VoxeLibre (mods/ENTITIES/mobs_mc/LICENSE-media.md, mods/CORE/mcl_sounds/README.txt)"
  echo "- 0 A.D.: https://play0ad.com — © Wildfire Games, https://creativecommons.org/licenses/by-sa/3.0/"
  echo "- Battle for Wesnoth: https://www.wesnoth.org — GPL-2.0-or-later"
  echo "- Veloren: https://veloren.net — DaforLynx, https://creativecommons.org/licenses/by/4.0/"
  echo "- Animalia: https://github.com/ElCeejo/animalia — MIT, © 2022 ElCeejo"
} > "$CREDITS"
echo "sfx: $(ls "$OUT"/*.ogg | wc -l) files, $(du -sh "$OUT" | cut -f1)"
