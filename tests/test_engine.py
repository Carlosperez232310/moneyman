#!/usr/bin/env python3
"""Unit tests for tools/mm_engine.py and the categorizer, on synthetic data (no private data needed).
Run: python3 tests/test_engine.py"""
import os, sys, datetime as dt, copy
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'tools'))
import mm_engine as E, finance_csv_to_tx as C
D = dt.date.fromisoformat
fails = []
def eq(a, b, msg):
    if (abs(a - b) > 0.005) if isinstance(a, (int, float)) and isinstance(b, (int, float)) else a != b:
        fails.append(f'{msg}: got {a!r}, want {b!r}'); print('  FAIL', msg, a, b)
n = [0]
def T(date, amount, merchant, cat, acct='2094', **kw):
    n[0] += 1; return {'id': f't{n[0]}', 'date': date, 'amount': amount, 'merchant': merchant, 'category': cat, 'account': acct, 'pending': False, **kw}

CFG = copy.deepcopy(E.DEFAULT_CONFIG)
# --- history: paychecks every Wednesday (one on a Thursday), bills, transfers
tx = []
for d, a in [('2026-10-14', 700), ('2026-10-21', 690), ('2026-10-28', 710), ('2026-11-04', 560), ('2026-11-12', 700), ('2026-11-18', 702.40)]:
    tx.append(T(d, a, 'Safeway paycheck', 'income'))
tx += [T('2026-10-03', -147.53, 'Verizon', 'bills'), T('2026-11-03', -147.65, 'Verizon', 'bills'),
       T('2026-10-19', -135.17, 'Farmers Insurance', 'bills'), T('2026-11-18', -135.17, 'Farmers Insurance', 'bills'),
       T('2026-11-02', -16.33, 'Farmers Insurance', 'bills'), T('2026-10-01', -16.33, 'Farmers Insurance', 'bills'),
       T('2026-11-15', -55.37, 'Klarna', 'bills', desc='Walmart'), T('2026-10-23', -40, 'Xfinity', 'bills'),
       T('2026-10-28', -100, 'Capital One', 'bills'), T('2026-09-25', -100, 'Capital One', 'bills'),
       T('2026-10-26', -12.99, 'Spotify', 'subs'), T('2026-10-30', -1.99, 'Google One storage', 'subs'),
       T('2026-11-18', -4.99, 'Play Books', 'subs'),
       T('2026-11-19', -110, 'To Savings ••0001', 'transfer'), T('2026-11-19', 110, 'From Checking ••2094', 'transfer', acct='0001'),
       T('2026-11-20', -300, 'ATM withdrawal', 'cash'),
       T('2026-11-19', -18.35, "McDonald's", 'food'), T('2026-11-20', -28.48, 'Fred Meyer', 'groceries'), T('2026-11-19', -9.50, 'Cinema', 'fun'),
       T('2026-11-19', -12.00, 'Marathon', 'gas'),
       T('2026-10-21', -1.99, 'Amazon Prime', 'subs'), T('2026-10-29', -14.99, 'Amazon Prime', 'subs'),
       T('2026-10-08', -43.57, 'Bi-Mart', 'shopping'), T('2026-10-10', -43.57, 'Bi-Mart', 'shopping'),
       T('2026-11-03', -147.65, 'Overdraft protection to Checking', 'transfer', acct='0001', od=True),
       T('2026-11-03', 147.65, 'Overdraft protection from Savings', 'transfer', od=True)]
ACC = [{'id': 'checking', 'kind': 'checking', 'name': 'Chk', 'mask': '2094', 'available': 412.50, 'current': 421.07},
       {'id': 'savings', 'kind': 'savings', 'name': 'Sav', 'mask': '0001', 'available': 90.40, 'current': 95.40}]
today = D('2026-11-21'); now = dt.datetime(2026, 11, 21, 9, 2)

# week boundaries
eq(E.week_start(D('2026-11-18')).isoformat(), '2026-11-18', 'Wednesday starts its own week')
eq(E.week_start(D('2026-11-24')).isoformat(), '2026-11-18', 'Tuesday belongs to previous Wednesday')
eq(E.week_start(D('2026-11-25')).isoformat(), '2026-11-25', 'next Wednesday')
# paycheck on Thursday counts for the week
eq(E.week_paycheck(tx, D('2026-11-11'))['amount'], 700, 'Thursday paycheck (holiday) counts')
# estimate = mean of the last 6 paychecks before the week
w_next = E.week_summary(tx, D('2026-11-25'), CFG, D('2026-11-25'))
eq(w_next['estimate'], True, 'no paycheck yet -> estimate')
eq(w_next['paycheck'], round((700 + 690 + 710 + 560 + 700 + 702.40) / 6, 2), 'estimate = average of last 6')
# one weekly Spending budget (food + groceries + fun + shopping + gas all count)
w = E.week_summary(tx, D('2026-11-18'), CFG, today)
eq(w['budget'], 702.40 - 147 - 275, 'budget = paycheck - 147 - 275')
eq(w['budgets'], {'spending': 280.40}, 'one Spending budget = whole weekly budget (no Food/Fun split)')
eq('split' in CFG, False, 'no food/fun split in config')
eq(w['spent']['eating_out'], 18.35, 'eating out tag'); eq(w['spent']['groceries'], 28.48, 'groceries tag'); eq(w['spent']['gas'], 12, 'gas tag')
eq(w['spent']['spending'], 18.35 + 28.48 + 9.50 + 12, 'spending = eating out + groceries + fun + gas')
eq(w['left'], {'spending': round(280.40 - 68.33, 2)}, 'spending left')
for c in ('food', 'groceries', 'fun', 'shopping', 'gas'): eq(E.bucket_of(c), 'spending', f'{c} counts toward Spending')
for c in ('bills', 'subs', 'transfer', 'cash', 'income', 'fees'): eq(E.bucket_of(c), None, f'{c} is not Spending')
# bills: learned posting day + paid detection
mb = {b['id']: b for b in E.bills_for_month(CFG['bills'], today, tx)}
eq(mb['verizon']['expected_post'], '2026-11-03', 'Verizon posts the 3rd (learned)')
eq(mb['verizon'].get('paid'), True, 'Verizon paid from bank')
eq(mb['klarna'].get('paid'), True, 'Klarna matched even when bank says Walmart (merchant normalised)')
eq(mb['farmers-15th']['paid_amount'], 135.17, 'Farmers main matched by amount window')
eq(mb['farmers-1st']['paid_date'], '2026-11-02', 'Farmers small matched separately')
eq(mb['xfinity'].get('paid'), None, 'Xfinity not yet paid')
eq(mb['capital-one'].get('paid'), None, 'Capital One not yet paid in Nov')
# early payment for a bill due on the 1st counts for next month
eq(E._period_of({'due_day': 1}, D('2026-10-30')), '2026-11', 'early payment -> next month')
eq(E._period_of({'due_day': 27}, D('2026-12-02')), '2026-11', 'late payment -> previous month')
# rent
r = E.rent_status(tx, today, CFG, '2094')
eq(r['paydays'], ['2026-11-18', '2026-11-25'], 'last two Wednesdays of Nov')
eq(r['withdrawn'], 300, 'ATM cash counts toward rent'); eq(r['owed_now'], 25, '$325 - $300 still owed')
eq(r['left_to_set_aside'], 350, 'left to set aside')
eq(E.rent_status(tx, D('2026-11-10'), CFG, '2094')['owed_now'], 0, 'nothing owed before the first set-aside payday')
# safe to spend
res = E.build(ACC, tx, CFG, today, now)
eq(res['steam_owed'], 37, 'steam owed = 147 - 110 transferred this week')
cf = res['cashflow']
eq([b['id'] for b in cf['bills_before_payday']], ['xfinity'], 'only Xfinity posts before Nov 25')
week1 = cf['cushion_weeks'][0]
eq(sorted(i['id'] for i in week1['items']), sorted(['spotify', 'capital-one', 'google-one', 'farmers-1st', 'rent']), 'month-end cluster week items')
eq(cf['cushion'], round(sum(i['amount'] for i in week1['items']) - 275, 2), 'cushion = cluster - reserve')
eq(cf['safe_cashflow'], round(412.50 - 40 - 25 - 37 - cf['cushion'], 2), 'safe cashflow formula')
eq(res['safe']['amount'], min(cf['safe_cashflow'], res['safe']['budget_left']), 'safe = min(cashflow, budget left)')
eq(res['safe']['limited_by'], 'bills', 'limited by bills')
eq(res['safe']['budget_left'], res['week']['left']['spending'], 'safe uses Spending budget left')
# goal
g = res['goal']
eq(g['paydays_left'], ['2026-11-25', '2026-12-02', '2026-12-09', '2026-12-16', '2026-12-23', '2026-12-30'], 'paydays left')
eq(g['need_per_payday'], round((2000 - 95.40) / 6, 2), 'need per payday')
eq(g['eta_plan'], '2027-02-17', 'ETA at $147'); eq(g['on_track'], False, 'not on track')
eq(E.goal_projection(2000, 2000, D('2026-12-31'), today, D('2026-11-25'), 147, 110, 0)['to_go'], 0, 'funded goal')
eq(E.goal_projection(100, 2000, D('2026-12-31'), today, D('2026-11-25'), 147, 0, -5)['eta_actual'], None, 'no pace -> no ETA')
# holds
h = {x['kind']: x for x in res['holds']}
eq(h['checking']['gap'], 8.57, 'checking hold'); eq('membership' in h['savings']['why'], True, '$5 savings share explained')
# flags
eq([a['dates'] for a in res['duplicates']], [['2026-10-08', '2026-10-10']], 'Bi-Mart double charge')
prime = next(c for c in res['subscriptions']['cancelled'] if c['name'] == 'Amazon Prime')
eq([x['amount'] for x in prime['charged_after']], [1.99, 14.99], 'Prime charged after cancel')
eq(any('Overdraft' in a['title'] for a in res['alerts']), True, 'overdraft alert')
eq(res['insights']['this_week']['gas'], 12, 'insight gas this week')
eq(res['insights']['this_week']['spending'], 68.33, 'insight spending this week')
# categorizer
eq(C.category('BANK_FEES_OVERDRAFT_FEES', 'Overdraft protection to Checking', -35.99, 'Overdraft Protection Withdraw'), 'transfer', 'OD is a transfer')
eq(C.category('LOAN_PAYMENTS_BNPL', 'Klarna', -55.37, 'Walmart'), 'bills', 'BNPL is a bill')
eq(C.clean('Walmart', 'Walmart', 'LOAN_PAYMENTS_BNPL', -55.37, '2094'), 'Klarna', 'Walmart BNPL renamed Klarna')
eq(C.category('GENERAL_MERCHANDISE_CONVENIENCE_STORES', 'Marathon', -10.0), 'gas', 'round gas-station charge = gas')
eq(C.category('GENERAL_MERCHANDISE_CONVENIENCE_STORES', 'Marathon', -12.39), 'groceries', 'odd-cent gas-station = snacks')
eq(C.category('GENERAL_SERVICES_EDUCATION', 'Color Me Mine', -101.2), 'fun', 'Color Me Mine = fun')
eq(C.category('GENERAL_MERCHANDISE_ONLINE_MARKETPLACES', 'Amazon Prime refund', 14.99), 'refund', 'refund')
eq(C.clean('Point Of Sale Withdrawal FOREST GROVE 793 BMFOREST GROVE ORUS', '', 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE', -43.57, ''), 'Bi-Mart', 'Bi-Mart')
eq(C.short_desc('Withdrawal Internet Transfer to XXXXXXX0001 - Funds Transfer'), 'Internet Transfer to - Funds Transfer', 'desc strips account numbers')
print(f"\nRESULT: {len(fails)} failure(s)"); sys.exit(1 if fails else 0)
