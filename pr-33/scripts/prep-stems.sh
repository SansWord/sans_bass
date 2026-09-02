#!/usr/bin/env bash
#
# prep-stems.sh — split one song into instrument stems and encode them for the player.
#
#   ./scripts/prep-stems.sh "rips/03 Blitzkrieg Bop.flac"
#
# Produces:  stems/03 Blitzkrieg Bop/{vocals,guitar,bass,drums,piano,other}.m4a
#
# Requires: demucs (pip install -U demucs) and ffmpeg (brew install ffmpeg).

set -euo pipefail

MODEL="htdemucs_6s"      # 6 stems incl. guitar + piano; use htdemucs for the classic 4
DEVICE="auto"            # auto | mps | cpu
FORMAT="m4a"             # m4a (works everywhere) | wav (lossless, big) | opus (small, no old Safari)
BITRATE="160k"
SHIFTS=1                 # >1 = better separation, linearly slower
OUTROOT="stems"
KEEP_WAV=0

usage() {
  sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
  cat <<EOF

Options:
  -m MODEL     demucs model (default: $MODEL; alternatives: htdemucs, htdemucs_ft, mdx_extra)
  -d DEVICE    auto | mps | cpu     (default: $DEVICE)
  -f FORMAT    m4a | wav | opus     (default: $FORMAT)
  -b BITRATE   encoder bitrate      (default: $BITRATE)
  -s N         demucs --shifts      (default: $SHIFTS)
  -o DIR       output root          (default: $OUTROOT)
  -k           keep the intermediate lossless WAV stems
EOF
}

while getopts "m:d:f:b:s:o:kh" opt; do
  case "$opt" in
    m) MODEL="$OPTARG" ;;
    d) DEVICE="$OPTARG" ;;
    f) FORMAT="$OPTARG" ;;
    b) BITRATE="$OPTARG" ;;
    s) SHIFTS="$OPTARG" ;;
    o) OUTROOT="$OPTARG" ;;
    k) KEEP_WAV=1 ;;
    h) usage; exit 0 ;;
    *) usage; exit 1 ;;
  esac
done
shift $((OPTIND - 1))

[ $# -ge 1 ] || { usage; exit 1; }
INPUT="$1"
[ -f "$INPUT" ] || { echo "error: no such file: $INPUT" >&2; exit 1; }

command -v ffmpeg >/dev/null || { echo "error: ffmpeg not found (brew install ffmpeg)" >&2; exit 1; }
# Fall back to the venv from the README before giving up, so a forgotten
# `source .../activate` isn't a hard error.
if ! command -v demucs >/dev/null; then
  if [ -x "$HOME/.venvs/demucs/bin/demucs" ]; then
    PATH="$HOME/.venvs/demucs/bin:$PATH"
    export PATH
  else
    echo "error: demucs not found. Set it up with:" >&2
    echo "  brew install python@3.12" >&2
    echo "  /opt/homebrew/bin/python3.12 -m venv ~/.venvs/demucs" >&2
    echo "  ~/.venvs/demucs/bin/pip install -U demucs numpy soundfile" >&2
    exit 1
  fi
fi

BASE="$(basename "$INPUT")"
NAME="${BASE%.*}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Pick a device. Apple Silicon GPU (mps) is several times faster but a few
# torch ops still fall over on it, so fall back to cpu rather than failing.
#
# Probe with the interpreter that sits next to demucs, NOT a bare `python3`:
# demucs lives in a venv, so the system python3 has no torch and would make
# every machine look like a cpu-only one.
VENV_PY="$(dirname "$(command -v demucs)")/python"
[ -x "$VENV_PY" ] || VENV_PY="python3"

pick_device() {
  if [ "$DEVICE" != "auto" ]; then echo "$DEVICE"; return; fi
  if [ "$(uname -m)" = "arm64" ] && "$VENV_PY" -c \
      'import torch,sys; sys.exit(0 if torch.backends.mps.is_available() else 1)' 2>/dev/null; then
    echo mps
  else
    echo cpu
  fi
}
DEV="$(pick_device)"

echo "==> Separating \"$NAME\"  (model=$MODEL device=$DEV shifts=$SHIFTS)"
if ! demucs -n "$MODEL" -d "$DEV" --shifts "$SHIFTS" -o "$WORK" "$INPUT"; then
  if [ "$DEV" = "mps" ]; then
    echo "==> mps failed, retrying on cpu (slower)…"
    demucs -n "$MODEL" -d cpu --shifts "$SHIFTS" -o "$WORK" "$INPUT"
  else
    exit 1
  fi
fi

SRC="$WORK/$MODEL/$NAME"
[ -d "$SRC" ] || { echo "error: expected stems in $SRC" >&2; ls -R "$WORK" >&2; exit 1; }

DEST="$OUTROOT/$NAME"
mkdir -p "$DEST"

echo "==> Encoding stems to .$FORMAT"
for wav in "$SRC"/*.wav; do
  stem="$(basename "${wav%.wav}")"
  case "$FORMAT" in
    wav)  cp "$wav" "$DEST/$stem.wav" ;;
    m4a)  ffmpeg -v error -y -i "$wav" -c:a aac    -b:a "$BITRATE" "$DEST/$stem.m4a" ;;
    opus) ffmpeg -v error -y -i "$wav" -c:a libopus -b:a "$BITRATE" "$DEST/$stem.opus" ;;
    *)    echo "error: unknown format $FORMAT" >&2; exit 1 ;;
  esac
  if [ "$KEEP_WAV" = 1 ] && [ "$FORMAT" != wav ]; then cp "$wav" "$DEST/$stem.wav"; fi
  echo "    $stem"
done

echo
echo "==> Done: $DEST"
echo "    Open index.html and drag that folder onto the page."
