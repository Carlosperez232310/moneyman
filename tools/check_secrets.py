#!/usr/bin/env python3
"""Fail if any git-tracked/staged file contains the passcode, exact account balances from private/data.json,
or plain data files. Run before every commit/push: tools/check_secrets.py"""
import json, os, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
files = subprocess.run(['git', 'ls-files', '--cached', '--others', '--exclude-standard'], capture_output=True, text=True, check=True).stdout.split()
needles = []
if os.path.exists('.passcode'):
    pc = open('.passcode').readline().strip(); needles += [pc, pc.replace('-', ' ')]
if os.path.exists('private/data.json'):
    d = json.load(open('private/data.json'))
    needles += [f"{a[k]:.2f}" for a in d.get('accounts', []) for k in ('available', 'current') if isinstance(a.get(k), (int, float))]
    pc_ = d.get('paycheck', {}).get('last_amount'); needles += [f"{pc_:.2f}"] if pc_ else []
bad = []
for f in files:
    if f.endswith('.csv') or f.startswith(('private/', 'public/')) or f in ('.passcode', 'data.json'): bad.append(f'{f}: forbidden file'); continue
    try: s = open(f, encoding='utf-8', errors='ignore').read()
    except (IsADirectoryError, FileNotFoundError): continue
    for n in needles:
        if n and n in s: bad.append(f'{f}: contains secret/plain value'); break
if bad: sys.exit('SECRET CHECK FAILED:\n  ' + '\n  '.join(bad))
print(f'secret check ok ({len(files)} files)')
