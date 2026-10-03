#!/usr/bin/env python3
"""Encrypt MoneyMan plain JSON -> public/data.enc.json (AES-256-GCM, key = PBKDF2-SHA256(passcode, salt, 600k)).

  tools/update_data.py /home/box/moneyman-app/private/data.json [--out public/data.enc.json] [--rotate-salt]

Passcode: $MONEYMAN_PASSCODE or the first line of .passcode (chmod 600, gitignored).
The salt is random (16 bytes) and kept in private/kdf.json so a key remembered on Carlos's phone keeps working
across daily updates; every run uses a fresh random 12-byte IV. Use --rotate-salt after changing the passcode.
The plain JSON is validated first (schema + no full account numbers) and the output is round-trip decrypted."""
import argparse, base64, datetime, hashlib, json, os, re, secrets, sys
from zoneinfo import ZoneInfo
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ITER = 600_000
b64 = lambda b: base64.b64encode(b).decode()

def passcode():
    p = os.environ.get('MONEYMAN_PASSCODE') or open(os.path.join(ROOT, '.passcode')).readline()
    p = re.sub(r'[\s_]+', '-', p.strip().lower())   # same normalisation as the app
    if len(p) < 10: sys.exit('passcode too short')
    return p

def validate(d):
    errs = []
    for k in ('accounts', 'goals', 'week', 'bills', 'transactions'):
        if k not in d: errs.append(f'missing "{k}"')
    for a in d.get('accounts', []):
        if not re.fullmatch(r'\d{4}', str(a.get('mask', ''))): errs.append(f'account mask must be last-4 digits: {a.get("name")}')
    w = d.get('week', {})
    for k in ('start', 'end', 'budget', 'purchases'):
        if k not in w: errs.append(f'week.{k} missing')
    for g in d.get('goals', []):
        for k in ('id', 'name', 'target'):
            if k not in g: errs.append(f'goal missing {k}: {g}')
    for t in d.get('transactions', []):
        for k in ('date', 'merchant', 'amount'):
            if k not in t: errs.append(f'transaction missing {k}: {t}'); break
    # never publish full account / card numbers (6+ consecutive digits anywhere in a string value)
    def walk(x, path=''):
        if isinstance(x, dict): [walk(v, f'{path}.{k}') for k, v in x.items()]
        elif isinstance(x, list): [walk(v, f'{path}[{i}]') for i, v in enumerate(x)]
        elif isinstance(x, str) and re.search(r'\d{6,}', x) and not path.endswith(('generated_at', '.id')):
            errs.append(f'long digit run (account number?) at {path}: {x!r}')
    walk(d)
    if errs: sys.exit('invalid data:\n  ' + '\n  '.join(errs[:20]))

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('plain')
    ap.add_argument('--out', default=os.path.join(ROOT, 'public', 'data.enc.json'))
    ap.add_argument('--rotate-salt', action='store_true')
    a = ap.parse_args()
    d = json.load(open(a.plain))
    validate(d)
    if not d.get('generated_at'):
        d['generated_at'] = datetime.datetime.now(ZoneInfo('America/Los_Angeles')).isoformat(timespec='seconds')
    kdf_path = os.path.join(ROOT, 'private', 'kdf.json')
    os.makedirs(os.path.dirname(kdf_path), exist_ok=True)
    kdf = None if a.rotate_salt or not os.path.exists(kdf_path) else json.load(open(kdf_path))
    if not kdf or kdf.get('iterations') != ITER:
        kdf = {'salt': b64(secrets.token_bytes(16)), 'iterations': ITER}
        json.dump(kdf, open(kdf_path, 'w'))
    salt = base64.b64decode(kdf['salt'])
    key = hashlib.pbkdf2_hmac('sha256', passcode().encode(), salt, ITER, dklen=32)
    iv = secrets.token_bytes(12)
    pt = json.dumps(d, ensure_ascii=False, separators=(',', ':')).encode()
    ct = AESGCM(key).encrypt(iv, pt, b'moneyman-v1')
    env = {'v': 1, 'kdf': {'name': 'PBKDF2', 'hash': 'SHA-256', 'iterations': ITER, 'salt': kdf['salt']},
           'cipher': {'name': 'AES-GCM', 'iv': b64(iv), 'aad': 'moneyman-v1'}, 'ct': b64(ct)}
    assert json.loads(AESGCM(key).decrypt(iv, ct, b'moneyman-v1')) == d
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    tmp = a.out + '.tmp'; json.dump(env, open(tmp, 'w')); os.replace(tmp, a.out)
    print(f'encrypted {len(pt)} bytes -> {a.out} (generated_at {d["generated_at"]}, {len(d["transactions"])} transactions)')

if __name__ == '__main__': main()
