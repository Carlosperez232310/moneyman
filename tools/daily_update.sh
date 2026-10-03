#!/usr/bin/env bash
# One-shot daily refresh: encrypt the plain JSON, build, publish to gh-pages, verify the live site.
#   tools/daily_update.sh /home/box/moneyman-app/private/data.json
# The plain JSON stays on the box (private/ is gitignored); only public/data.enc.json is published.
set -euo pipefail
cd "$(dirname "$0")/.."
PLAIN="${1:?usage: tools/daily_update.sh /home/box/moneyman-app/private/data.json}"
python3 tools/update_data.py "$PLAIN"
./tools/publish-pages.sh
python3 tools/verify_live.py --wait "${VERIFY_WAIT:-300}" || echo "warning: live verification did not confirm yet (Pages may still be deploying)" >&2
