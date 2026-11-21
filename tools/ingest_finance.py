#!/usr/bin/env python3
"""Save raw Finance-connector results into private/ so private/build_data.py can build everything automatically.

  tools/ingest_finance.py --accounts <file> [--connections <file>] --tx <file> [<file> ...]

Each <file> is a saved connector result (e.g. a CallDynamicTool write_to_file output, or plain JSON / CSV). The JSON
object is found inside the file even when wrapped in other text; if the file says "Full text: <path>" that file is read.
Writes (never commit these):
  private/accounts.json  {"fetched_at", "bank_synced_at", "accounts": [{id, account_id, name, mask, kind, available, current}]}
  private/tx_latest.csv  all transaction rows (de-duplicated by id), the newest snapshot build_data.py reads first."""
import argparse, csv, datetime, io, json, os, re, sys
from zoneinfo import ZoneInfo
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRIV = os.path.join(ROOT, 'private')


def load(path):
    s = open(path, encoding='utf-8', errors='ignore').read()
    m = re.search(r'Full text: (\S+?)\.?\s', s + ' ')
    if m and os.path.exists(m.group(1).rstrip('.')):
        s = open(m.group(1).rstrip('.'), encoding='utf-8', errors='ignore').read()
    if s.lstrip().startswith('id,'):
        return {'csv': s}
    for start in [i for i, ch in enumerate(s) if ch == '{']:
        try:
            return json.JSONDecoder().raw_decode(s[start:])[0]
        except Exception:
            continue
    sys.exit(f'no JSON found in {path}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--accounts', required=True); ap.add_argument('--connections'); ap.add_argument('--tx', nargs='+', required=True)
    a = ap.parse_args()
    acc = load(a.accounts).get('accounts', [])
    out = []
    for x in acc:
        if x.get('class', 'cash') != 'cash': continue
        kind = 'savings' if 'saving' in (x.get('subtype') or x.get('name', '')).lower() else 'checking'
        out.append({'id': kind, 'account_id': x['id'], 'name': x.get('name') or x.get('official_name'), 'mask': str(x.get('mask', ''))[-4:],
                    'kind': kind, 'available': round(float(x.get('available_balance') or x.get('current_balance') or 0), 2),
                    'current': round(float(x.get('current_balance') or 0), 2)})
    synced = None
    if a.connections:
        cs = load(a.connections).get('connections', [])
        if cs: synced = max(c.get('updated_at') or '' for c in cs) or None
    now = datetime.datetime.now(ZoneInfo('America/Los_Angeles')).isoformat(timespec='seconds')
    json.dump({'fetched_at': now, 'bank_synced_at': synced, 'accounts': out}, open(os.path.join(PRIV, 'accounts.json'), 'w'), indent=1)
    rows, hdr, seen = [], None, set()
    for f in a.tx:
        d = load(f); r = list(csv.reader(io.StringIO(d.get('csv', ''))))
        if not r: continue
        hdr = hdr or r[0]
        for row in r[1:]:
            if row and row[0] not in seen: seen.add(row[0]); rows.append(row)
    if not hdr: sys.exit('no transactions found')
    w = csv.writer(open(os.path.join(PRIV, 'tx_latest.csv'), 'w', newline='')); w.writerow(hdr); w.writerows(rows)
    print(f'saved {len(out)} accounts (bank synced {synced}) and {len(rows)} transactions '
          f'({min(x[2] for x in rows)} .. {max(x[2] for x in rows)}, {sum(1 for x in rows if x[9] == "true")} pending)')


if __name__ == '__main__': main()
