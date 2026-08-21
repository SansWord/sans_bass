#!/usr/bin/env bash
# serve.sh — serve the project over http://localhost:8777
#
# Needed for anything that fetches: in-browser separation, and folder drag-and-drop.
# The player itself still works fine opened straight from disk.
#
# ThreadingHTTPServer, not `python3 -m http.server`: the default is single-threaded and
# wedges on files this size — browser fetch hangs forever while curl returns instantly.

set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${1:-8777}"
echo "==> http://localhost:$PORT   (Ctrl-C to stop)"
exec python3 -c "
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import sys
ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), SimpleHTTPRequestHandler).serve_forever()
" "$PORT"
