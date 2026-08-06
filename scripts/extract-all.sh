#!/usr/bin/env bash
#
# extract-all.sh — run the full GTA III extraction pipeline.
#
# Converts the game data in <game root>/ into the viewer's asset set in
# <game root>/viewer/extracted:
#
#   gta_to_gltf.py     models + textures  → *.gltf, *.png, gta3.json
#   ipl_to_scene.py    world placements   → scene.json      (needs the glTFs)
#   fonts.py           bitmap font atlases→ fonts/*.png, fonts.json
#   frontend.py        pause-menu chrome  → frontend/*.png, frontend.json
#   hud.py             in-play HUD art    → hud/*.png, hud.json
#   menu.py            main-menu art      → menu/*.png, menu.json
#   misctxd.py         mainsc/news txds   → misc/*.png, misc.json
#   paths.py           plane/train paths  → paths.json
#   scm_to_pickups.py  pickup placements  → pickups.json
#   screens.py         loading screens    → loadscreens/*.png, loadscreens.json
#   timecyc.py         time-of-day colours→ timecyc.json
#   water.py           water planes + tex → water.json, water_old.png
#
# Usage:
#   ./extract-all.sh              # everything, default paths
#   PYTHON=python3.12 ./extract-all.sh
#
# Any extra arguments are ignored; run an individual script directly if you
# need its flags (each supports --help).

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VIEWER_DIR="$(dirname -- "$SCRIPT_DIR")"
ROOT_DIR="$(dirname -- "$VIEWER_DIR")"
OUT_DIR="$VIEWER_DIR/extracted"

PY=""
for cand in python python3; do
    if command -v "$cand" >/dev/null 2>&1; then
        ver="$("$cand" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null)"
        if [[ -n "$ver" ]]; then
            major="${ver%%.*}"
            minor="${ver##*.}"
            if (( major > 3 || (major == 3 && minor >= 10) )); then
                PY="$cand"
                break
            fi
        fi
    fi
done

if [[ -z "$PY" ]]; then
    echo "Error: no Python >= 3.10 found (checked: python, python3)" >&2
    exit 1
fi

SCRIPTS=(
    gta_to_gltf.py
    ipl_to_scene.py
    fonts.py
    frontend.py
    hud.py
    menu.py
    misctxd.py
    paths.py
    scm_to_pickups.py
    screens.py
    timecyc.py
    water.py
)

echo "Python:   $("$PY" --version 2>&1)  ($PY)"
echo "Game:     $ROOT_DIR"
echo "Output:   $OUT_DIR"
echo

mkdir -p "$OUT_DIR"

start_all=$SECONDS
for script in "${SCRIPTS[@]}"; do
    echo "══════════════════════════════════════════════════════════════"
    echo "▶ $script"
    echo "══════════════════════════════════════════════════════════════"
    start=$SECONDS
    "$PY" "$SCRIPT_DIR/$script"
    echo "✔ $script done in $((SECONDS - start))s"
    echo
done

echo "All extractions complete in $((SECONDS - start_all))s → $OUT_DIR"
echo
echo "Copying loadscreen assets to public..."
mkdir -p "$VIEWER_DIR/public/loadscreens"
cp "$OUT_DIR/loadscreens/island_1.png" "$VIEWER_DIR/public/loadscreens"
cp "$OUT_DIR/loadscreens/island_2.png" "$VIEWER_DIR/public/loadscreens"
cp "$OUT_DIR/loadscreens/island_3.png" "$VIEWER_DIR/public/loadscreens"
cp "$OUT_DIR/loadscreens/loadsc0.png" "$VIEWER_DIR/public/loadscreens"
echo "✔ Loadscreen assets copied to $VIEWER_DIR/public"
echo
echo "Copying menu assets to public..."
mkdir -p "$VIEWER_DIR/public/menu"
cp "$OUT_DIR/menu/mainmenu24.png" "$VIEWER_DIR/public/menu/"
cp "$OUT_DIR/menu/gtalogo128.png" "$VIEWER_DIR/public/menu/"
echo "✔ Menu assets copied to $VIEWER_DIR/public/menu"
