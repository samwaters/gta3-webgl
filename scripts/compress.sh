#!/usr/bin/env bash
#
# compress.sh — bundle the extracted assets into a single archive.
#
# Packs everything under <game root>/viewer/extracted into
# <game root>/viewer/public/assets.bin, so the viewer ships one file
# instead of thousands of loose glTFs, .bins and textures.
#
# Paths inside the archive are relative to extracted/ — i.e. it unpacks to
# 3d8ball.gltf, textures/…, scene.json — with no wrapping directory.
#
# The archive is a gzipped tar, but is deliberately NOT named .tar.gz: static
# servers (Vite's sirv, nginx, S3) see a .gz suffix and serve the file with
# Content-Encoding: gzip, which makes the browser silently decompress it before
# the app can. That breaks an explicit DecompressionStream in the loader
# ("incorrect header check") and makes Content-Length disagree with the bytes
# actually received. An opaque extension keeps the wire bytes == the disk bytes.
#
# Usage:
#   ./compress.sh              # default level 9 (smallest)
#   LEVEL=6 ./compress.sh      # faster, slightly larger
#
# Run extract-all.sh first to populate extracted/.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VIEWER_DIR="$(dirname -- "$SCRIPT_DIR")"
SRC_DIR="$VIEWER_DIR/extracted"
OUT_DIR="$VIEWER_DIR/public"
OUT_FILE="$OUT_DIR/assets.bin"

LEVEL="${LEVEL:-9}"

if [[ ! -d "$SRC_DIR" ]]; then
    echo "Error: nothing to compress — $SRC_DIR does not exist." >&2
    echo "       Run ./extract-all.sh first." >&2
    exit 1
fi

file_count=$(find "$SRC_DIR" -type f ! -name '.DS_Store' | wc -l | tr -d ' ')
if [[ "$file_count" -eq 0 ]]; then
    echo "Error: $SRC_DIR is empty — run ./extract-all.sh first." >&2
    exit 1
fi

echo "Source:   $SRC_DIR  ($file_count files, $(du -sh "$SRC_DIR" | cut -f1))"
echo "Archive:  $OUT_FILE  (gzip -$LEVEL)"
echo

mkdir -p "$OUT_DIR"

# Write to a temp file first so an interrupted run can't leave a truncated
# archive sitting in public/ where the app would try to fetch it.
tmp="$OUT_FILE.partial"
trap 'rm -f "$tmp"' EXIT

# COPYFILE_DISABLE stops macOS bsdtar writing ._* AppleDouble entries.
# -C means the archive holds paths relative to extracted/, not the full tree.
# Piping through gzip (rather than tar -z) keeps the level configurable on
# both bsdtar and GNU tar.
start=$SECONDS
COPYFILE_DISABLE=1 tar -c --exclude '.DS_Store' -C "$SRC_DIR" . \
    | gzip -"$LEVEL" > "$tmp"

mv "$tmp" "$OUT_FILE"
trap - EXIT

echo "Done in $((SECONDS - start))s"
echo "  $file_count files  →  $(du -h "$OUT_FILE" | cut -f1)  $OUT_FILE"
