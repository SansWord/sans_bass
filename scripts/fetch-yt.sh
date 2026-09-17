#!/usr/bin/env bash
#
# fetch-yt.sh — pull the audio of one video into rips/, ready for prep-stems.sh.
#
#   ./scripts/fetch-yt.sh "https://www.youtube.com/watch?v=..."
#   ./scripts/fetch-yt.sh -n "my-demo" "https://youtu.be/..."
#
# For material that is yours to download — your own uploads, or anything you hold
# the rights to. Same call, and the same answer, as ripping a CD you own.
#
# Requires: yt-dlp (brew install yt-dlp) and ffmpeg (brew install ffmpeg).

set -euo pipefail

OUT="rips"
FORMAT="m4a"          # m4a (works everywhere) | opus (smaller, native for most YouTube audio)
NAME=""               # empty = use the video's own title
PLAYLIST=0

usage() {
  sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
  cat <<EOF

Options:
  -o DIR       output directory     (default: $OUT)
  -f FORMAT    m4a | opus           (default: $FORMAT)
  -n NAME      output basename, without extension (default: the video title)
  -A           allow a whole playlist; without it a ?list= URL fetches one video
  -h           this help
EOF
}

while getopts "o:f:n:Ah" opt; do
  case "$opt" in
    o) OUT="$OPTARG" ;;
    f) FORMAT="$OPTARG" ;;
    n) NAME="$OPTARG" ;;
    A) PLAYLIST=1 ;;
    h) usage; exit 0 ;;
    *) usage; exit 1 ;;
  esac
done
shift $((OPTIND - 1))

[ $# -ge 1 ] || { usage; exit 1; }
URL="$1"

case "$FORMAT" in
  m4a|opus) ;;
  *) echo "error: unknown format $FORMAT (want m4a or opus)" >&2; exit 1 ;;
esac

command -v yt-dlp >/dev/null || { echo "error: yt-dlp not found (brew install yt-dlp)" >&2; exit 1; }
# yt-dlp shells out to ffmpeg for the extract/transcode leg, so a missing ffmpeg
# fails only after the download — check up front instead.
command -v ffmpeg >/dev/null || { echo "error: ffmpeg not found (brew install ffmpeg)" >&2; exit 1; }

mkdir -p "$OUT"

# Filenames are not restricted to ASCII: a CJK title has to survive intact, both
# because it is the song's name and because prep-stems.sh turns it into the stem
# directory the player labels the song with.
if [ -n "$NAME" ]; then
  TEMPLATE="$OUT/$NAME.%(ext)s"
else
  TEMPLATE="$OUT/%(title)s.%(ext)s"
fi

# --no-playlist by default: a URL copied from a playlist page carries ?list=, and
# without this one song quietly becomes the whole list.
PLAYLIST_FLAG="--no-playlist"
[ "$PLAYLIST" = 1 ] && PLAYLIST_FLAG="--yes-playlist"

echo "==> Fetching audio  (format=$FORMAT)"
echo "==> Writing to:     $OUT"

yt-dlp \
  --extract-audio \
  --audio-format "$FORMAT" \
  --audio-quality 0 \
  "$PLAYLIST_FLAG" \
  --embed-metadata \
  --no-overwrites \
  --print "after_move:    %(title)s" \
  -o "$TEMPLATE" \
  "$URL"

echo
echo "==> Done. The file is in $OUT/ and stays there — rips/ is gitignored."
echo "    Next: ./scripts/prep-stems.sh \"$OUT/<track>.$FORMAT\""
