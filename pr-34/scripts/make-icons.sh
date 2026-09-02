#!/usr/bin/env bash
# make-icons.sh — regenerate the PNG icons from icons/icon.svg
#
# This is NOT a build step. The PNGs it writes are committed to the repo; the script exists
# so a colour or geometry change in icon.svg can be re-rasterised without hand-editing a
# binary. Nothing in the site, the tests, or CI ever runs it.
#
# Needs librsvg:  brew install librsvg
#
# --background-color is load-bearing, not tidiness. rsvg-convert leaves the canvas
# transparent wherever the SVG does not paint, and iOS composites a transparent
# home-screen icon onto black — so the flag, not the <rect> inside the SVG, is what
# guarantees an opaque tile even if the artwork later gains a margin.

set -euo pipefail
cd "$(dirname "$0")/.."

command -v rsvg-convert >/dev/null || {
  echo "rsvg-convert not found — brew install librsvg" >&2
  exit 1
}

render() {   # render <size> <outfile>
  rsvg-convert --background-color='#0d0d10' -w "$1" -h "$1" icons/icon.svg -o "$2"
  echo "==> $2  (${1}x${1})"
}

render 32  icons/favicon-32.png
render 180 icons/apple-touch-icon.png
