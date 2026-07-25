#!/usr/bin/env bash
# Regenerate the debug-variant launcher icons from the release ones.
#
# The debug build installs side by side with release (applicationIdSuffix
# ".debug" in app/build.gradle), so it needs an icon that is obvious at a glance
# on the launcher: same Calino mark, but white on a flat violet tile instead of
# taupe on speckled cream. Output goes to app/src/debug/res/, which shadows the
# same-named resources in app/src/main/res/ for the debug build only — the
# release icon is never touched.
#
# Run this after changing the release icon. Requires ImageMagick (`magick`).
set -euo pipefail

ANDROID_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MAIN="$ANDROID_DIR/app/src/main/res"
DBG="$ANDROID_DIR/app/src/debug/res"
BG='#6D28D9'

for d in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  src="$MAIN/mipmap-$d"
  out="$DBG/mipmap-$d"
  mkdir -p "$out"

  adaptive_size=$(magick identify -format '%wx%h' "$src/ic_launcher_background.png")
  legacy_size=$(magick identify -format '%w' "$src/ic_launcher.png")

  # Adaptive background: flat violet.
  magick -size "$adaptive_size" "xc:$BG" "$out/ic_launcher_background.png"

  # Adaptive foreground: same glyph, recolored white (alpha preserved).
  magick "$src/ic_launcher_foreground.png" \
    -fill white -colorize 100 "$out/ic_launcher_foreground.png"

  # Legacy (pre-API-26) icons: flatten background + foreground, then mask to a
  # rounded square and a circle, mirroring what the adaptive icon renders to.
  magick -size "$adaptive_size" "xc:$BG" \
    "$out/ic_launcher_foreground.png" -composite \
    -resize "${legacy_size}x${legacy_size}" "$out/_flat.png"

  r=$(( legacy_size * 22 / 100 ))
  magick -size "${legacy_size}x${legacy_size}" xc:black \
    -fill white -draw "roundrectangle 0,0,$((legacy_size-1)),$((legacy_size-1)),$r,$r" \
    "$out/_mask_sq.png"
  magick -size "${legacy_size}x${legacy_size}" xc:black \
    -fill white -draw "circle $((legacy_size/2)),$((legacy_size/2)) $((legacy_size/2)),0" \
    "$out/_mask_rd.png"

  magick "$out/_flat.png" "$out/_mask_sq.png" \
    -alpha off -compose CopyOpacity -composite "$out/ic_launcher.png"
  magick "$out/_flat.png" "$out/_mask_rd.png" \
    -alpha off -compose CopyOpacity -composite "$out/ic_launcher_round.png"

  rm "$out/_flat.png" "$out/_mask_sq.png" "$out/_mask_rd.png"
  echo "$d: adaptive $adaptive_size, legacy ${legacy_size}px"
done
