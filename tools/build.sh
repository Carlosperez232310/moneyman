#!/usr/bin/env bash
# Build src/ -> public/ with a cache-busting version stamp. Keeps the encrypted public/data.enc.json.
set -euo pipefail
cd "$(dirname "$0")/.."
VER="${VER:-$(date +%Y%m%d%H%M%S)}"
STASH=""
if [ -f public/data.enc.json ]; then STASH=$(mktemp); cp public/data.enc.json "$STASH"; fi
rm -rf public && cp -r src public
for f in public/index.html public/sw.js public/js/app.js; do sed -i "s/__VER__/$VER/g" "$f"; done
if [ -n "$STASH" ]; then mv "$STASH" public/data.enc.json; chmod 644 public/data.enc.json; else echo "warning: no public/data.enc.json (run tools/update_data.py)" >&2; fi
echo "built public/ version $VER"
