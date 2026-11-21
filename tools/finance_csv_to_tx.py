#!/usr/bin/env python3
"""Convert bank transactions CSV (Finance connector `finance_query_account_transactions` CSV, or the compact
id,date,acct,amount,name,merchant,cat,pending format) into MoneyMan `transactions` JSON (stdout).

  tools/finance_csv_to_tx.py tx.csv [more.csv ...] --acct <account_id_or_code>=<last4> ... [--label <last4>=Savings] [--since 2026-09-01]

Merchant names are cleaned, card/account numbers are reduced to last-4, and each row gets a MoneyMan category:
food, groceries, fun, subs, shopping, gas, bills, income, refund, transfer, cash, fees, other
(app weekly buckets: Food = food + groceries, Fun = fun + shopping).
Output is sorted newest first and de-duplicated by id. Never commit the CSV inputs."""
import csv, json, sys, re, argparse, hashlib

LABELS = {}  # last4 -> friendly account label, filled from --label
SUBS = ('google one', 'spotify', 'play books', 'paramount', 'apple', 'microsoft', 'youtube', 'amazon prime', 'netflix', 'hulu', 'disney')
GROCERS = ('safeway', 'fred meyer', 'winco', 'kroger', 'albertsons', 'trader joe', 'grocery outlet', 'costco', 'whole foods', 'qfc')
DIGITAL = ('google', 'steam', 'xbox', 'playstation', 'nintendo', 'epic games', 'roblox', 'itunes', 'fandango', 'cinema', 'theater', 'regal', 'amc')

FUN_MERCHANTS = ('color me mine', 'superhive', 'crossroads gaming', 'movies on tv', 'cinema', 'blizzard', 'roblox')
GAS_STATIONS = ('marathon', 'chevron', 'shell', 'arco', 'space age', 'pacific pride', '76 ')

def category(cat, merchant, amount, raw=''):
    """MoneyMan categories. Weekly buckets in the app: Food = food + groceries; Fun = fun + shopping."""
    c = (cat or '').upper(); m = merchant.lower(); r = (raw or '').upper()
    if r.startswith('OVERDRAFT PROTECTION'): return 'transfer'          # savings -> checking auto-transfer, not a fee
    if c.startswith('INCOME'): return 'income'
    if c == 'LOAN_PAYMENTS_BNPL' or m == 'klarna': return 'bills'       # Klarna sometimes posts as "Walmart"
    if amount > 0 and not c.startswith('TRANSFER'): return 'refund'
    if any(g in m for g in GAS_STATIONS):                                # gas-station rounds ($10/$20/$25) = fuel, odd cents = snacks
        return 'gas' if (c.startswith('TRANSPORTATION_GAS') or abs(amount - round(amount)) < 0.005) else 'groceries'
    if any(f in m for f in FUN_MERCHANTS): return 'fun'
    if c == 'TRANSFER_OUT_WITHDRAWAL': return 'cash'
    if c.startswith('TRANSFER'): return 'transfer'
    if c.startswith('BANK_FEES'): return 'fees'
    if any(s in m for s in SUBS): return 'subs'
    if c.startswith(('RENT_AND_UTILITIES', 'LOAN_PAYMENTS', 'GENERAL_SERVICES_INSURANCE')): return 'bills'
    if c.startswith('TRANSPORTATION_GAS'): return 'gas'
    if c == 'FOOD_AND_DRINK_GROCERIES' or any(g in m for g in GROCERS): return 'groceries'
    if c == 'GENERAL_MERCHANDISE_CONVENIENCE_STORES': return 'groceries'      # convenience-store snacks/food
    if c.startswith('FOOD_AND_DRINK') or 'doordash' in m: return 'food'
    if c.startswith('ENTERTAINMENT') or any(g in m for g in DIGITAL): return 'fun'
    if c.startswith('GENERAL_MERCHANDISE'): return 'shopping'                # other discretionary -> Fun bucket
    return 'other' if amount < 0 else 'income'

def clean(name, merchant, cat, amount, last4):
    n = (name or '').strip(); m = (merchant or '').strip(); c = (cat or '').upper()
    if 'DOORDASH' in n.upper(): return 'DoorDash'
    if c.startswith('INCOME_SALARY') and m: return f'{m} paycheck'
    if n.startswith('ATM Withdrawal'): return 'ATM withdrawal'
    if n.startswith('ATM Deposit'): return 'ATM deposit'
    if n == 'Credit Interest': return 'Interest'
    if n.startswith('Overdraft - Item Paid'): return 'Overdraft fee'
    if n.startswith('Overdraft Protection'):
        return 'Overdraft protection to Checking' if amount < 0 else 'Overdraft protection from Savings'
    if c == 'LOAN_PAYMENTS_BNPL' and (m.lower() in ('walmart', 'klarna', '')): return 'Klarna'
    if 'BMFOREST' in n.upper() or 'BI-MART' in n.upper(): return 'Bi-Mart'
    if 'SUPERHIVE' in n.upper(): return 'Superhive'
    if 'CROSSROADS GAMI' in n.upper(): return 'Crossroads Gaming'
    if m.lower().startswith('movies on tv'): return 'Movies On TV'
    if m == 'Amazon' and amount > 0 and 'PRIME' in n.upper(): return 'Amazon Prime refund'
    if 'AMAZON PRIME' in n.upper() and amount > 0: return 'Amazon Prime refund'
    t = re.search(r'Transfer (to|from) X+(\d{4})', n)
    if t:
        other = t.group(2); lbl = LABELS.get(other, 'account')
        return f"{'To' if t.group(1) == 'to' else 'From'} {lbl} ••{other}"
    if 'CAPITAL ONE' in n.upper(): return 'Capital One'
    # Google One photo storage: card descriptor G1SK…, or a $1.99 Google charge -> monthly SUB bill, not Fun
    if 'G1SK' in n.upper() or ('google' in (m + ' ' + n).lower() and abs(amount) == 1.99): return 'Google One storage'
    if m: return m
    n = re.sub(r'^(Point Of Sale Withdrawal|External Withdrawal|Withdrawal|Deposit)\s+', '', n)
    n = re.sub(r'\d{5,}', '', n)
    return n.strip().title()[:40] or 'Transaction'

def short_desc(raw):
    """Bank description without account/card numbers (kept for matching + the detail sheet)."""
    s = re.sub(r'X{2,}\d{4}', '', raw or ''); s = re.sub(r'\d{5,}', '', s); s = re.sub(r'\s{2,}', ' ', s)
    s = re.sub(r'^(Point Of Sale Withdrawal|External Withdrawal|Withdrawal|Deposit)\s+', '', s.strip())
    return s.strip()[:60]

def convert(paths, amap, since=''):
    out = {}
    for path in paths:
        for r in csv.DictReader(open(path, newline='')):
            acct = r.get('account_id') or r.get('acct') or ''
            cat = r.get('cat') or ''
            if not cat and r.get('category'):
                try: cat = json.loads(r['category']).get('detailed', '')
                except Exception: cat = ''
            merchant = r.get('merchant_name', r.get('merchant', '')) or ''
            amt = round(float(r['amount']), 2)
            if r['date'] < since: continue
            last4 = amap.get(acct, acct[-4:] if acct.isdigit() else '')
            name = clean(r.get('name', ''), merchant, cat, amt, last4)
            tid = hashlib.sha1(r['id'].encode()).hexdigest()[:10]
            raw = r.get('name', '') or ''
            row = {'id': tid, 'date': r['date'], 'merchant': name, 'amount': amt,
                   'category': category(cat, name, amt, raw), 'account': last4,
                   'pending': str(r.get('pending', 'false')).lower() == 'true', 'desc': short_desc(raw)}
            if raw.upper().startswith('OVERDRAFT PROTECTION'): row['od'] = True
            out[tid] = row
    return sorted(out.values(), key=lambda x: (x['date'], x['id']), reverse=True)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('csv', nargs='+')
    ap.add_argument('--acct', action='append', default=[], help='map account id/code to last4, e.g. CHK=1234')
    ap.add_argument('--since', default='')
    ap.add_argument('--label', action='append', default=[], help='friendly name for a last4 in transfer text, e.g. 1234=Savings')
    a = ap.parse_args()
    LABELS.update(dict(x.split('=', 1) for x in a.label))
    json.dump(convert(a.csv, dict(x.split('=', 1) for x in a.acct), a.since), sys.stdout, indent=1, ensure_ascii=False)

if __name__ == '__main__': main()
