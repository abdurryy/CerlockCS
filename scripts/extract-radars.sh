#!/usr/bin/env bash
# Exports radar images and overview files from your own CS2 install into the
# CerlockCS map folder. Useful offline, for brand new maps, or if you do not
# want the server to download them.
#
# Needs Source2Viewer-CLI:
#   https://github.com/ValveResourceFormat/ValveResourceFormat/releases
#
# Usage: scripts/extract-radars.sh "<path to Counter-Strike Global Offensive>" [output dir]
set -euo pipefail

cs2="${1:?usage: extract-radars.sh <cs2 folder> [output dir]}"
out="${2:-$HOME/.cerlock/maps}"
cli="${S2V_CLI:-Source2Viewer-CLI}"
vpk="$cs2/game/csgo/pak01_dir.vpk"

if [ ! -f "$vpk" ]; then
  echo "could not find $vpk" >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "exporting radar images..."
"$cli" -i "$vpk" -o "$tmp" --vpk_filepath "panorama/images/overheadmaps/" -d >/dev/null
echo "exporting overview files..."
"$cli" -i "$vpk" -o "$tmp" --vpk_filepath "resource/overviews/" >/dev/null

mkdir -p "$out"
find "$tmp" -name '*_radar_psd.png' -exec cp {} "$out" \;
find "$tmp" -path '*resource/overviews/*.txt' -exec cp {} "$out" \;
echo "done, $(ls "$out" | wc -l | tr -d ' ') files in $out"
