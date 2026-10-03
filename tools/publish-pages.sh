#!/usr/bin/env bash
# Build and publish public/ to the gh-pages branch -> https://carlosperez232310.github.io/moneyman/
# Only the static shell + the ENCRYPTED data.enc.json are published. Refuses to publish anything that looks plain.
set -euo pipefail
cd "$(dirname "$0")/.."
./tools/build.sh
[ -f public/data.enc.json ] || { echo "missing public/data.enc.json — run tools/update_data.py first" >&2; exit 1; }
python3 - <<'PY'
import json, os, sys, re
env = json.load(open('public/data.enc.json'))
assert set(env) == {'v', 'kdf', 'cipher', 'ct'} and env['kdf']['iterations'] >= 600000 and env['cipher']['name'] == 'AES-GCM', 'data.enc.json is not an encrypted envelope'
pc = open('.passcode').readline().strip() if os.path.exists('.passcode') else None
secrets_ = []  # exact balances from the private plain JSON must never appear in shipped files
if os.path.exists('private/data.json'):
    d = json.load(open('private/data.json'))
    secrets_ = [f"{a[k]:.2f}" for a in d.get('accounts', []) for k in ('available', 'current') if isinstance(a.get(k), (int, float))]
for root, _, files in os.walk('public'):
    for f in files:
        p = os.path.join(root, f)
        if f.endswith(('.csv', '.passcode')) or f in ('data.json', 'kdf.json'): sys.exit(f'refusing to publish {p}')
        if f.endswith(('.html', '.js', '.json', '.css')):
            s = open(p, encoding='utf-8', errors='ignore').read()
            if pc and pc in s: sys.exit(f'passcode found in {p}')
            if f != 'data.enc.json' and ('"transactions"' in s or '"accounts"' in s or any(v and v in s for v in secrets_)):
                sys.exit(f'plain data found in {p}')
print('publish check ok')
PY
STAGE=$(mktemp -d /tmp/moneyman-pages.XXXX)
cp -r public/. "$STAGE/" && touch "$STAGE/.nojekyll"
cd "$STAGE"
git init -q -b gh-pages
git -c user.name="Carlos Perez" -c user.email="90338236+Carlosperez232310@users.noreply.github.com" add -A
git -c user.name="Carlos Perez" -c user.email="90338236+Carlosperez232310@users.noreply.github.com" commit -qm "Deploy MoneyMan $(date +%Y-%m-%dT%H:%M)"
git push -qf "https://github.com/Carlosperez232310/moneyman.git" gh-pages
cd / && rm -rf "$STAGE"
echo "published -> https://carlosperez232310.github.io/moneyman/"
