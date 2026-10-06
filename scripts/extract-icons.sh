#!/usr/bin/env bash
# Exports the weapon and equipment icons from your own CS2 install into the
# CerlockCS icon folder. Useful offline or if you do not want the server to
# download them. Killfeed and HUD icons are still downloaded.
#
# Needs Source2Viewer-CLI:
#   https://github.com/ValveResourceFormat/ValveResourceFormat/releases
#
# Usage: scripts/extract-icons.sh "<path to Counter-Strike Global Offensive>" [output dir]
set -euo pipefail

cs2="${1:?usage: extract-icons.sh <cs2 folder> [output dir]}"
out="${2:-$HOME/.cerlock/icons}"
cli="${S2V_CLI:-Source2Viewer-CLI}"
vpk="$cs2/game/csgo/pak01_dir.vpk"

if [ ! -f "$vpk" ]; then
  echo "could not find $vpk" >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "exporting equipment icons..."
"$cli" -i "$vpk" -o "$tmp" --vpk_filepath "panorama/images/icons/equipment/" -d >/dev/null

mkdir -p "$out/weapon"
find "$tmp" -path '*icons/equipment/*.svg' -exec cp {} "$out/weapon" \;
echo "done, $(ls "$out/weapon" | wc -l | tr -d ' ') icons in $out/weapon"
