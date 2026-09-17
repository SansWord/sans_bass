#!/usr/bin/env bash
#
# repack-stems.sh — re-encode a lossless stems zip into a small one the browser can stream.
#
#   ./scripts/repack-stems.sh puma_song/puma_song_stems.zip puma_song/puma_taipei_smooth_stems.zip
#
# A zip of six 44.1 kHz WAV stems is ~1 MB per stem-second; the same six as AAC are ~1/30th
# of that, which is the difference between a hosted fixed-song page loading in a second and
# loading in two minutes. The player decodes .m4a and .wav identically (lib/stems.js's
# AUDIO_RE), so only the transfer size changes.
#
# Requires: ffmpeg (brew install ffmpeg) and python3.

set -euo pipefail

BITRATE="160k"           # matches scripts/prep-stems.sh's default
TITLE=""                 # rename the folder inside the zip; empty keeps whatever is there

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  cat <<EOF

Options:
  -b BITRATE   encoder bitrate  (default: $BITRATE)
  -n TITLE     rename the folder inside the zip — this is what the player shows as the
               song title, so a Demucs output folder named after the source file is worth
               replacing with the record's actual name
EOF
}

while getopts "b:n:h" opt; do
  case "$opt" in
    b) BITRATE="$OPTARG" ;;
    n) TITLE="$OPTARG" ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 1 ;;
  esac
done
shift $((OPTIND - 1))

[ $# -eq 2 ] || { usage >&2; exit 1; }
SRC="$1"
DEST="$2"

[ -f "$SRC" ] || { echo "error: no such zip: $SRC" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "error: ffmpeg not found (brew install ffmpeg)" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Python, not `unzip`/`zip`: the spec says a zip without general purpose bit 11 holds CP437
# names, and macOS's bundled Info-ZIP writes and reads them that way — which turns a
# non-ASCII song folder into mojibake in the player's title. Python's zipfile sets the bit for any
# non-ASCII name and reads it back correctly. See CLAUDE.md's ZIP filename gotcha.
python3 -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$SRC" "$WORK/in"

mkdir -p "$WORK/out"
count=0
while IFS= read -r -d '' src; do
  rel="${src#"$WORK/in/"}"
  # The player titles the song from the folder the stems sit in (app.js's commonName reads
  # the zip entry's path), so -n renames exactly that first path segment and nothing else.
  [ -n "$TITLE" ] && rel="$TITLE/${rel#*/}"
  out="$WORK/out/${rel%.*}.m4a"
  mkdir -p "$(dirname "$out")"
  echo "encoding $rel"
  # -nostdin: ffmpeg otherwise reads this loop's own stdin (the find stream feeding
  # `read`), swallowing the next path and mangling the one after it.
  ffmpeg -nostdin -v error -y -i "$src" -c:a aac -b:a "$BITRATE" "$out"
  count=$((count + 1))
done < <(find "$WORK/in" -type f \( -iname '*.wav' -o -iname '*.flac' -o -iname '*.aiff' \) -print0)

[ "$count" -gt 0 ] || { echo "error: no lossless audio found in $SRC" >&2; exit 1; }

python3 - "$WORK/out" "$DEST" <<'PY'
import os, sys, zipfile
root, dest = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED) as z:
    for folder, _, names in os.walk(root):
        for name in sorted(names):
            path = os.path.join(folder, name)
            z.write(path, os.path.relpath(path, root))
PY

echo "wrote $DEST ($count stems, $(du -h "$DEST" | cut -f1))"
