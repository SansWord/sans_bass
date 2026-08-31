#!/usr/bin/env bash
#
# rip-cd.sh — rip a mounted audio CD to lossless FLAC.
#
#   ./scripts/rip-cd.sh                    # auto-detect the mounted disc
#   ./scripts/rip-cd.sh "/Volumes/Audio CD" rips/ramones
#
# macOS exposes an inserted audio CD as a volume full of .aiff files, so this is
# just a lossless transcode — no extra tooling needed. For scratched discs use
# XLD instead (see README), which does AccurateRip verification and re-reads.

set -euo pipefail

VOL="${1:-}"
OUT="${2:-rips}"

if [ -z "$VOL" ]; then
  VOL="$(find /Volumes -maxdepth 1 -type d \
        -exec sh -c 'ls "$1"/*.aiff >/dev/null 2>&1' _ {} \; -print 2>/dev/null | head -1)"
fi

[ -n "$VOL" ] && [ -d "$VOL" ] || {
  echo "error: no audio CD volume found. Insert the disc, wait for it to mount," >&2
  echo "       then pass the path explicitly: ./scripts/rip-cd.sh \"/Volumes/Audio CD\"" >&2
  exit 1
}

command -v ffmpeg >/dev/null || { echo "error: ffmpeg not found (brew install ffmpeg)" >&2; exit 1; }

mkdir -p "$OUT"
echo "==> Ripping from: $VOL"
echo "==> Writing to:   $OUT"

shopt -s nullglob
count=0
for aiff in "$VOL"/*.aiff; do
  base="$(basename "${aiff%.aiff}")"
  dest="$OUT/$base.flac"
  echo "    $base"
  # -compression_level 8 keeps files small; FLAC is lossless either way.
  ffmpeg -v error -y -i "$aiff" -c:a flac -compression_level 8 "$dest"
  count=$((count + 1))
done

[ "$count" -gt 0 ] || { echo "error: no .aiff tracks found in $VOL" >&2; exit 1; }

echo
echo "==> Ripped $count track(s)."
echo "    Next: ./scripts/prep-stems.sh \"$OUT/<track>.flac\""
echo "    Then: diskutil eject \"$VOL\""
