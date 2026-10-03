#!/usr/bin/env python3
"""Check that GitHub Pages serves the same encrypted blob as public/data.enc.json and that it decrypts.
  tools/verify_live.py [--wait 240] [--url https://carlosperez232310.github.io/moneyman/]"""
import argparse, base64, hashlib, json, os, re, sys, time, urllib.request
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser(); ap.add_argument('--wait', type=int, default=240); ap.add_argument('--url', default='https://carlosperez232310.github.io/moneyman/')
a = ap.parse_args()
local = json.load(open(os.path.join(ROOT, 'public', 'data.enc.json')))
p = re.sub(r'[\s_]+', '-', (os.environ.get('MONEYMAN_PASSCODE') or open(os.path.join(ROOT, '.passcode')).readline()).strip().lower())
t0 = time.time()
while True:
    try:
        req = urllib.request.Request(a.url + 'data.enc.json?t=%d' % time.time(), headers={'Cache-Control': 'no-cache'})
        live = json.load(urllib.request.urlopen(req, timeout=20))
        if live.get('ct') == local['ct']: break
        msg = 'old blob still served'
    except Exception as e: msg = str(e)
    if time.time() - t0 > a.wait: sys.exit(f'live site not updated after {a.wait}s ({msg})')
    time.sleep(10)
key = hashlib.pbkdf2_hmac('sha256', p.encode(), base64.b64decode(live['kdf']['salt']), live['kdf']['iterations'], 32)
d = json.loads(AESGCM(key).decrypt(base64.b64decode(live['cipher']['iv']), base64.b64decode(live['ct']), live['cipher'].get('aad', '').encode()))
print(f"live OK after {int(time.time() - t0)}s: {a.url} serves data generated_at {d['generated_at']}")
