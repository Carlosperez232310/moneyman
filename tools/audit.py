#!/usr/bin/env python3
"""Accuracy audit: compare what the app was showing (decrypted published blob) with a fresh engine build from live bank
data. Writes a Markdown report into private/ (never commit it).
  tools/audit.py --before private/data_published_before_nov21.json --after private/data.json --out private/audit_2026-11-21.md"""
import argparse, json, statistics, sys, os, datetime as dt
from collections import Counter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mm_engine as E

ap = argparse.ArgumentParser(); ap.add_argument('--before', required=True); ap.add_argument('--after', required=True); ap.add_argument('--out', required=True)
a = ap.parse_args()
B, A = json.load(open(a.before)), json.load(open(a.after))
m = lambda v: f'${v:,.2f}'
L = []; add = L.append
tx = A['transactions']; btx = {t['id']: t for t in B['transactions']}
add(f"# MoneyMan accuracy audit — {A['generated_at'][:10]}\n")
add(f"Live bank pull: {len(tx)} transactions {min(t['date'] for t in tx)} → {max(t['date'] for t in tx)}, "
    f"{sum(1 for t in tx if t.get('pending'))} pending. Bank (Plaid) last synced {A.get('bank_synced_at') or 'unknown'} (UTC). "
    f"Published app data before this audit was generated {B['generated_at']}.\n")

add('## 1. Balances')
for acc in A['accounts']:
    ob = next((x for x in B['accounts'] if x['mask'] == acc['mask']), {})
    same = ob.get('available') == acc['available'] and ob.get('current') == acc['current']
    add(f"- {acc['name']} ••{acc['mask']}: available {m(acc['available'])}, current {m(acc['current'])} — app showed "
        f"{m(ob.get('available', 0))} / {m(ob.get('current', 0))} ({'matches' if same else 'DIFFERENT'}).")
for h in A['holds']:
    add(f"- Gap current − available on ••{h['account']}: {m(h['gap'])}; pending debits listed by the bank {m(h['pending'])} → {h['why']}.")
add("- **Bug:** the old app showed only available on Home and never explained the gap; the new Home shows available as the headline balance and the hold reason.\n")

add('## 2. Freshness')
add("- **Bug:** the app showed only when *we* published (\"Updated 9:10 AM\"), not when the bank last synced. New: \"Bank synced …\" from the Plaid connection time, and a stale banner when data is over 14 hours old.")
add("- **Bug:** the app said \"Next update around 4:14 PM PT\" but the 4:14 PM daily check-in routine is paused, so that update never comes. Schedule is now 9:02 AM / 9:02 PM PT only.")
add(f"- Pending transactions right now: {sum(1 for t in tx if t.get('pending'))}. The builder now keeps pending rows (tagged PENDING) from the newest snapshot instead of waiting a day for them to post.")
add("- **Root cause of the day lag:** every refresh, the routine hand-edited `build_data.py` (balances, week dates, paycheck, notes). Any slip left stale numbers (e.g. the paycheck stayed at the old week's value or a $590 placeholder). Now `tools/ingest_finance.py` saves the raw connector output and `build_data.py` computes everything; nothing is hand-edited.\n")

add('## 3. This week (Wed→Tue) budget math')
w, bw = A['week'], B['week']
add(f"- Week {w['start']} → {w['end']}: paycheck {m(w['paycheck'])} ({'estimate' if w['estimate'] else 'posted ' + str(w['paycheck_date'])}) − $147 Steam − $275 bills = **{m(w['budget'])}** "
    f"(one Spending budget). App had {m(bw['budget'])} ({'matches' if abs(bw['budget'] - w['budget']) < 0.01 else 'DIFFERENT'}).")
cur = next(x for x in A['weeks'] if x['current'])
add(f"- Spent: eating out {m(cur['spent']['eating_out'])} + groceries/snacks {m(cur['spent']['groceries'])} = food {m(cur['spent']['food'])} ; "
    f"fun {m(cur['spent']['fun'])} + shopping {m(cur['spent']['shopping'])} = {m(cur['spent']['fun_total'])}; gas {m(cur['spent']['gas'])} → Spending {m(cur['spent']['spending'])} (left {m(cur['left']['spending'])}).")
est = A['paycheck']['estimate']; ph = A['paycheck']['history']
add(f"- **Bug:** before Wednesday's paycheck posts, the routine used a $590 placeholder. Last {len(ph[-6:])} real paychecks: "
    + ', '.join(f"{p['date'][5:]} {m(p['amount'])}" for p in ph[-6:]) + f" → average {m(est)}. New: the average is used and the week is labeled *estimate* until the real paycheck posts.")
add("- Paychecks sometimes land Thursday (Nov 12 after Veterans Day); the week logic now accepts a paycheck posted Wed–Fri.")
add('- Past weeks (new week switcher in the app):')
for x in A['weeks']:
    add(f"  - {x['start']}: paycheck {m(x['paycheck'])}{' (est)' if x['estimate'] else ''}, budget {m(x['budget'])}, spending {m(x['spent']['spending'])}/{m(x['budgets']['spending'])} (food {m(x['spent']['food'])}, fun {m(x['spent']['fun_total'])}, gas {m(x['spent']['gas'])})")
add('')

add('## 4. Bills (auto-detected from the bank)')
add('| Bill | Due (nominal) | Usually posts | Last amount | This month |')
add('|---|---|---|---|---|')
for b in A['bills']['items']:
    if b['id'] == 'rent': continue
    add(f"| {b['name']} | {b['due_day']} | {b['expected_post'][8:]} (offset {b.get('post_offset', 0):+d}d) | {m(b['amount'])} | {'paid ' + b['paid_date'] + ' ' + m(b['paid_amount']) if b.get('paid') else 'not yet'} |")
r = A['rent']
add(f"\n- Rent {r['month']}: {m(r['amount'])} cash due {r['due']}; set-aside paydays {', '.join(r['paydays'])}; withdrawn so far {m(r['withdrawn'])} "
    f"({', '.join(x['date'] + ' ' + m(x['amount']) for x in r['withdrawals']) or 'none'}); still owed from paydays so far {m(r['owed_now'])}; left to set aside {m(r['left_to_set_aside'])}.")
add("- **Fixes:** Verizon is due the 1st but posts on the 3rd (Sep 3, Oct 3, Nov 3); Farmers main is due the 15th but posts the 18th–19th; Klarna posts as \"Walmart\" (BNPL) and is now matched; Capital One was set to the 25th, now the 27th. Paid ticks now come from the bank match (one payment per bill per month), learned from real history instead of hard-coded windows.")
ld = A['bills']['load']
add(f"\n### Is the $275/week reserve right?\n- Recurring bills (learned amounts): {m(ld['monthly'])}/month = {m(ld['weekly'])}/week. Rent $650/month = $150.00/week. Total **{m(ld['weekly'] + 150)}/week** vs the $275 reserve.")
add(f"- So $275 is about right **only if it also covers rent** (it does: the $325 rent cash on the last two paydays comes out of the reserve, not on top of it). Keep $275. Gas (~{m(statistics.mean([x['spent']['gas'] for x in A['weeks'][:-1]]))}/week lately) is in neither the reserve nor the food/fun budget — worth deciding where it lives.")
add(f"- The month-end cluster is the problem, not the weekly amount: in the week of {A['cashflow']['cushion_weeks'][0]['payday']} about {m(A['cashflow']['cushion_weeks'][0]['bills_out'])} goes out (rent cash, Capital One, Spotify, Google One, Farmers) vs $275 coming in. The app now holds back a cushion ({m(A['cashflow']['cushion'])}) for that.\n")

add('## 5. Steam Frame goal')
g = A['goals'][0]['projection']
add(f"- Member Savings {m(g['saved'])} of $2,000 → {m(g['to_go'])} to go, {len(g['paydays_left'])} paydays left before {g['due']} → needs **{m(g['need_per_payday'])}/payday**. The app said \"$147 every payday\" with \"Short $1,003\" — the plan can't reach the goal on time.")
add(f"- At $147/payday the goal lands **{g['eta_plan']}**. At the $110 Carlos actually transfers each week: **{g['eta_actual']}**. Savings over the last 8 weeks only grew {m(g['net_weekly_8w'])}/week because {m(-A['savings_pulled_8w'])} was pulled back out "
    "(Oct 29 $250 + Oct 30 $200 for rent, Nov 3 $199.39 overdraft protection + $6.59, Nov 9 $115).")
add("- **Bug:** overdraft-protection transfers from savings were labeled \"Bank fee\" on the savings side ($199.39 on Nov 3), inflating \"Money out\" and the Bills filter. Now labeled *Overdraft protection* transfers and flagged.\n")

add('## 6. Categories')
moved = Counter()
for t in tx:
    o = btx.get(t['id'])
    if o and (o['category'] != t['category'] or o['merchant'] != t['merchant']):
        moved[(o['merchant'], o['category'], t['merchant'], t['category'])] += 1
for (om, oc, nm, nc), n in sorted(moved.items()):
    add(f"- {om} [{oc}] → {nm} [{nc}] ×{n}")
add("- Food is now split into eating out vs groceries/snacks; gas-station charges in round dollars are Gas, odd-cent ones are snacks.\n")

add('## 7. Subscriptions & flags')
s = A['subscriptions']
add(f"- Active: {', '.join(x['name'] + ' ' + m(x['amount']) for x in s['active'])} = {m(s['monthly_total'])}/month.")
for c in A['bills']['cancelled']:
    if c.get('charged_after'):
        add(f"- **{c['name']} charged after cancel:** " + ', '.join(f"{x['date']} {m(x['amount'])}" for x in c['charged_after']))
for al in A['alerts']:
    add(f"- Alert shown in app: **{al['title']}** — {al['text']}")
add('')

add('## 8. Safe to spend (new headline number)')
c, sf = A['cashflow'], A['safe']
add(f"- Checking available {m(c['available'])} − bills before payday {m(c['bills_before_payday_total'])} ({', '.join(b['name'] + ' ' + b['date'][5:] for b in c['bills_before_payday']) or 'none'}) − rent cash still owed {m(c['rent_owed'])} − Steam transfer still owed {m(c['steam_owed'])} − cushion for upcoming bill weeks {m(c['cushion'])} = **{m(c['safe_cashflow'])}**.")
add(f"- Food + fun budget left: {m(sf['budget_left'])}. Safe to spend = the smaller = **{m(sf['amount'])}** ({m(sf['per_day'])}/day for {sf['days_left']} days).\n")

add('## 9. For Carlos to decide')
add(f"1. **Steam Frame target/date.** {m(g['to_go'])} in 6 paydays isn't realistic. Options: move the date to ~{g['eta_plan'][:7]} and keep $147, or to ~{g['eta_actual'][:7]} at $110, or lower the target.")
add("2. **Keep the $275 reserve** (it matches bills + rent ≈ $269/wk) but stop pulling rent from savings: the Oct 29–30 $450 and Nov 3 overdraft pulls wiped most of the goal.")
gas = statistics.mean([x["spent"]["gas"] for x in A["weeks"][:-1]])
add(f"3. **Gas** (~{m(gas)}/week over the last 5 weeks) has no home in the budget. Either take it from Fun or add ~${round(gas/5)*5:.0f} to the reserve.")
add("4. **Capital One**: paying the $25 minimum instead of $100 in a month-end crunch week frees $75 (interest cost vs overdraft risk).")
add("5. **Amazon Prime**: $1.99 (Oct 21) and $14.99 (Oct 29) after cancelling — check Memberships & Subscriptions and ask for a refund.")
open(a.out, 'w').write('\n'.join(L) + '\n')
print(f'wrote {a.out} ({len(L)} lines)')
