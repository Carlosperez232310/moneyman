#!/usr/bin/env python3
"""MoneyMan accuracy engine: turns raw bank data (Finance connector / Plaid) into the numbers the app shows.

Pure functions only (no network, no private data in this file) so every rule is unit-tested in tests/test_engine.py.
Inputs:  accounts (finance_list_accounts rows or the app's account dicts), transactions (app format, see
         tools/finance_csv_to_tx.py), config (bills, goal, rules; see DEFAULT_CONFIG), today (date), now (aware datetime).
Output:  the plain data.json dict (schema 3, backward compatible with schema 2 readers).

Rules (Carlos's):
- Week runs Wednesday -> Tuesday. Weekly food+fun budget = this week's paycheck - $147 Steam Frame - $275 bills reserve,
  split 70% Food / 30% Fun. Before the paycheck posts, the budget uses the average of the last 6 real paychecks and is
  flagged as an estimate.
- Rent ~$650 cash, due the 31st (month end), funded with ~$325 cash from each of the last two Wednesday paydays.
- Bills are detected as paid from real bank transactions (merchant + amount window), and their usual posting day is
  learned from history (e.g. Verizon is due the 1st but posts on the 3rd).
- "Safe to spend" = checking available - bills that post before next payday - rent set-aside still owed - Steam
  transfer still owed this week - cushion for the next weeks' bill clusters that the $275/week reserve can't cover,
  capped by what is left of this week's food+fun budget.
"""
import calendar, datetime as dt, math, re, statistics
from collections import defaultdict

DEFAULT_CONFIG = {
    'steam_per_payday': 147, 'bills_reserve': 275, 'split': {'food': 0.7, 'fun': 0.3},
    'payday_weekday': 2,  # Wednesday (Mon=0)
    'rent': {'amount': 650, 'per_payday': 325, 'set_aside_paydays': 2},
    'goal': {'id': 'steam-frame', 'name': 'Steam Frame', 'target': 2000, 'due': '2026-12-31', 'icon': 'gamepad'},
    'bills': [  # nominal due day (what Carlos/the biller says) + match rule; posting day/amount are learned from the bank
        {'id': 'verizon', 'name': 'Verizon', 'amount': 147.65, 'due_day': 1, 'icon': 'phone', 'note': 'Phone',
         'match': {'any': ['verizon', 'vzwrlss'], 'min': 100, 'max': 220}},
        {'id': 'farmers-1st', 'name': 'Farmers (small policy)', 'amount': 16.33, 'due_day': 1, 'icon': 'shield', 'tags': ['VARIES'],
         'match': {'any': ['farmers'], 'min': 5, 'max': 60}},
        {'id': 'farmers-15th', 'name': 'Farmers (main policy)', 'amount': 135.17, 'due_day': 15, 'icon': 'shield', 'tags': ['VARIES'],
         'match': {'any': ['farmers'], 'min': 80, 'max': 250}},
        {'id': 'klarna', 'name': 'Klarna', 'amount': 55.40, 'due_day': 16, 'icon': 'card', 'tags': ['BNPL'], 'note': "Girlfriend's phone",
         'match': {'any': ['klarna'], 'min': 30, 'max': 90}},
        {'id': 'xfinity', 'name': 'Xfinity', 'amount': 40, 'due_day': 23, 'icon': 'wifi', 'note': 'Internet',
         'match': {'any': ['xfinity', 'comcast'], 'min': 20, 'max': 90}},
        {'id': 'play-books', 'name': 'Play Books', 'amount': 4.99, 'due_day': 21, 'icon': 'book', 'tags': ['SUB'],
         'match': {'any': ['play books'], 'min': 1, 'max': 15}},
        {'id': 'capital-one', 'name': 'Capital One', 'amount': 100, 'due_day': 27, 'icon': 'card', 'note': 'Card payment (min $25)',
         'match': {'any': ['capital one'], 'min': 25, 'max': 600}},
        {'id': 'spotify', 'name': 'Spotify', 'amount': 12.99, 'due_day': 26, 'icon': 'music', 'tags': ['SUB'],
         'match': {'any': ['spotify'], 'min': 5, 'max': 30}},
        {'id': 'google-one', 'name': 'Google One storage', 'amount': 1.99, 'due_day': 30, 'icon': 'cloud', 'tags': ['SUB'], 'note': 'Photo storage',
         'match': {'any': ['google one'], 'min': 1.5, 'max': 3.5}},
    ],
    'subscriptions_cancelled': [  # flag any charge after `since`
        {'name': 'Amazon Prime', 'amount': 14.99, 'icon': 'bag', 'since': '2026-10-03', 'any': ['amazon prime']},
        {'name': 'Paramount+', 'amount': 13.99, 'icon': 'tv', 'since': '2026-10-01', 'any': ['paramount']},
        {'name': 'Minecraft Realms', 'amount': 7.99, 'icon': 'gamepad', 'via': 'Microsoft', 'since': '2026-10-01', 'any': ['microsoft']},
        {'name': 'Spotify Audiobooks+', 'amount': 11.99, 'icon': 'music', 'since': '2026-10-01', 'any': ['spotify'], 'min': 13.5},
        {'name': 'DC Universe', 'amount': 12.99, 'icon': 'tv', 'via': 'Apple', 'since': '2026-10-01', 'any': ['apple']},
    ],
}

FOOD_CATS, FUN_CATS = ('food', 'groceries'), ('fun', 'shopping')
D = dt.date.fromisoformat
r2 = lambda v: round(v + 0.0, 2)


def bucket_of(cat):
    return 'food' if cat in FOOD_CATS else 'fun' if cat in FUN_CATS else None


def week_start(day, weekday=2):
    return day - dt.timedelta(days=(day.weekday() - weekday) % 7)


def last_day(y, m):
    return calendar.monthrange(y, m)[1]


def month_wednesdays(y, m, weekday=2):
    return [dt.date(y, m, d) for d in range(1, last_day(y, m) + 1) if dt.date(y, m, d).weekday() == weekday]


def text_of(t):
    return (str(t.get('merchant', '')) + ' ' + str(t.get('desc', ''))).lower()


# ---------------------------------------------------------------- paychecks & weeks
def paychecks(tx):
    return sorted([t for t in tx if t['amount'] > 0 and t.get('category') == 'income' and 'paycheck' in t['merchant'].lower()],
                  key=lambda t: t['date'])


def paycheck_estimate(tx, n=6):
    p = [t['amount'] for t in paychecks(tx)][-n:]
    return r2(sum(p) / len(p)) if p else 0.0


def week_paycheck(tx, start):
    """Paycheck for the Wed-Tue week starting `start`: posted Wed..Fri of that week (holidays shift it a day or two)."""
    lo, hi = start.isoformat(), (start + dt.timedelta(days=2)).isoformat()
    hits = [t for t in paychecks(tx) if lo <= t['date'] <= hi]
    return hits[0] if hits else None


def week_summary(tx, start, cfg, today):
    end = start + dt.timedelta(days=6)
    pc = week_paycheck(tx, start)
    est = pc is None
    pay = pc['amount'] if pc else paycheck_estimate([t for t in tx if t['date'] < start.isoformat()])
    budget = r2(pay - cfg['steam_per_payday'] - cfg['bills_reserve'])
    food_b = round(budget * cfg['split']['food']); fun_b = r2(budget - food_b)
    items = [t for t in tx if start.isoformat() <= t['date'] <= end.isoformat()]
    spend = lambda cats: r2(sum(-t['amount'] for t in items if t['category'] in cats and t['amount'] < 0)
                           - sum(t['amount'] for t in items if t['category'] in cats and t['amount'] > 0))
    w = {'start': start.isoformat(), 'end': end.isoformat(), 'paycheck': r2(pay), 'paycheck_date': pc['date'] if pc else None,
         'estimate': est, 'budget': budget, 'budgets': {'food': food_b, 'fun': fun_b},
         'spent': {'eating_out': spend(('food',)), 'groceries': spend(('groceries',)), 'fun': spend(('fun',)),
                   'shopping': spend(('shopping',)), 'gas': spend(('gas',))}}
    w['spent']['food'] = r2(w['spent']['eating_out'] + w['spent']['groceries'])
    w['spent']['fun_total'] = r2(w['spent']['fun'] + w['spent']['shopping'])
    w['left'] = {'food': r2(food_b - w['spent']['food']), 'fun': r2(fun_b - w['spent']['fun_total'])}
    w['current'] = start <= today <= end
    return w


# ---------------------------------------------------------------- bills
def _period_of(bill, d):
    """Month a payment belongs to: early payments for bills due on the 1st-5th count for next month; late payments
    (first days of a month) for bills due the 25th+ count for the previous month."""
    y, m = d.year, d.month
    if bill['due_day'] <= 5 and d.day >= 24:
        y, m = (y + (m == 12), m % 12 + 1)
    elif bill['due_day'] >= 25 and d.day <= 5:
        y, m = (y - (m == 1), (m - 2) % 12 + 1)
    return f'{y}-{m:02d}'


def bill_matches(bill, tx):
    mt = bill.get('match') or {}
    keys = mt.get('any') or [bill['name'].lower()]
    out = []
    for t in tx:
        if t['amount'] >= 0 or t.get('category') in ('transfer',):
            continue
        a = -t['amount']
        if any(k in text_of(t) for k in keys) and mt.get('min', 0) <= a <= mt.get('max', 1e9):
            out.append(t)
    return sorted(out, key=lambda t: t['date'])


def learn_bill(bill, tx):
    """Usual posting day + last amount, from real history. Returns a copy with post_day/amount_last/history/paid map."""
    b = dict(bill)
    hist, used = {}, set()
    for t in bill_matches(bill, tx):
        per = _period_of(bill, D(t['date']))
        if per in hist:
            continue  # one payment per month per bill
        hist[per] = {'date': t['date'], 'amount': r2(-t['amount']), 'id': t.get('id')}
    days = []
    for per, h in hist.items():
        y, m = map(int, per.split('-')); d = D(h['date'])
        delta = (d - dt.date(y, m, min(bill['due_day'], last_day(y, m)))).days
        if abs(delta) <= 12:
            days.append(delta)
    b['post_offset'] = int(round(statistics.median(days))) if days else 0
    b['history'] = [dict(period=k, **v) for k, v in sorted(hist.items())]
    if hist:
        b['amount_last'] = hist[max(hist)]['amount']
    return b


def bill_instance(b, y, m):
    """Expected posting date of bill `b` for month y-m (nominal due day + learned offset)."""
    due = dt.date(y, m, min(b['due_day'], last_day(y, m)))
    return due, due + dt.timedelta(days=b.get('post_offset', 0))


def bills_for_month(bills, today, tx):
    """This month's checklist with paid state from the bank."""
    y, m = today.year, today.month; per = f'{y}-{m:02d}'
    out = []
    for b in bills:
        lb = learn_bill(b, tx)
        due, post = bill_instance(lb, y, m)
        h = next((x for x in lb['history'] if x['period'] == per), None)
        item = {k: v for k, v in lb.items() if k not in ('history', 'match')}
        item.update(match={'merchant': (b.get('match') or {}).get('any', [b['name'].lower()])[0],
                           'min': (b.get('match') or {}).get('min', 0), 'max': (b.get('match') or {}).get('max', 1e9)},
                    date=due.isoformat(), expected_post=post.isoformat(), period=per,
                    amount=lb.get('amount_last', b['amount']), approx=('VARIES' in b.get('tags', [])) or 'amount_last' not in lb,
                    history=[{'period': x['period'], 'date': x['date'], 'amount': x['amount']} for x in lb['history']][-4:])
        if h:
            item.update(paid=True, paid_date=h['date'], paid_amount=h['amount'], paid_period=per)
        out.append(item)
    return out


def monthly_bill_load(bills, tx):
    """Average monthly cost of the recurring bills (learned amounts) -> dict with weekly equivalents."""
    tot = sum(learn_bill(b, tx).get('amount_last', b['amount']) for b in bills)
    return {'monthly': r2(tot), 'weekly': r2(tot * 12 / 52)}


# ---------------------------------------------------------------- rent
def rent_status(tx, today, cfg, checking_mask=None):
    """Rent for the month whose set-aside paydays are current. Cash withdrawals (ATM) from the first set-aside Wednesday
    through month end count toward the set-aside."""
    rc = cfg['rent']; y, m = today.year, today.month
    weds = month_wednesdays(y, m, cfg['payday_weekday'])[-rc['set_aside_paydays']:]
    due = dt.date(y, m, last_day(y, m))
    cash = [t for t in tx if t.get('category') == 'cash' and t['amount'] < 0 and weds[0].isoformat() <= t['date'] <= due.isoformat()
            and (checking_mask is None or t.get('account') in (None, '', checking_mask))]
    withdrawn = r2(sum(-t['amount'] for t in cash))
    reached = [w for w in weds if w <= today]
    should = rc['per_payday'] * len(reached)
    owed_now = r2(max(0.0, min(rc['amount'], should) - withdrawn)) if today <= due else 0.0
    return {'month': f'{y}-{m:02d}', 'due': due.isoformat(), 'amount': rc['amount'], 'paydays': [w.isoformat() for w in weds],
            'per_payday': rc['per_payday'], 'withdrawn': withdrawn, 'should_have': should, 'owed_now': owed_now,
            'left_to_set_aside': r2(max(0.0, rc['amount'] - withdrawn)),
            'withdrawals': [{'date': t['date'], 'amount': r2(-t['amount'])} for t in cash]}


# ---------------------------------------------------------------- savings & goal
def savings_series(tx, balance_now, mask, since):
    """Daily end-of-day savings balance reconstructed backwards from today's balance."""
    s = sorted([t for t in tx if t.get('account') == mask], key=lambda t: t['date'])
    by = defaultdict(float)
    for t in s:
        by[t['date']] += t['amount']
    out, bal = [], balance_now
    days = sorted(by, reverse=True)
    start = D(since); cur = None
    pts = {}
    for d in days:
        pts[d] = bal; bal -= by[d]
    start_bal = bal
    series, b = [], start_bal
    d = start
    end = max([D(x) for x in days] + [start])
    while d <= end:
        iso = d.isoformat()
        if iso in pts:
            b = pts[iso]
        series.append((iso, r2(b))); d += dt.timedelta(days=1)
    return series


def goal_projection(saved, target, due, today, next_payday, plan_per, actual_per, net_weekly):
    togo = r2(max(0.0, target - saved))
    paydays_left = []
    if next_payday:
        d = next_payday
        while d <= due:
            paydays_left.append(d.isoformat()); d += dt.timedelta(days=7)
    need = r2(togo / len(paydays_left)) if paydays_left else togo

    def eta(per):
        if togo <= 0: return today.isoformat()
        if not per or per <= 0 or not next_payday: return None
        k = math.ceil(togo / per - 1e-9)
        return (next_payday + dt.timedelta(days=7 * (k - 1))).isoformat()
    return {'saved': r2(saved), 'target': target, 'to_go': togo, 'due': due.isoformat(), 'paydays_left': paydays_left,
            'need_per_payday': need, 'plan_per_payday': plan_per, 'eta_plan': eta(plan_per),
            'actual_per_payday': actual_per, 'eta_actual': eta(actual_per), 'net_weekly_8w': net_weekly,
            'eta_net': eta(net_weekly), 'on_track': bool(paydays_left) and need <= plan_per + 0.005}


# ---------------------------------------------------------------- safe to spend
def cashflow(available, bills, rent, steam_owed, today, next_payday, cfg, weeks_ahead=5):
    """Money that must stay in checking: bills posting before next payday, rent/steam still owed this week, and a cushion
    for future weeks where the bills + rent set-asides due that week exceed the $275 reserve coming in."""
    np_ = next_payday
    def occurrences(b, lo, hi):
        out = []
        for y, m in {(lo.year, lo.month), (hi.year, hi.month), ((lo + dt.timedelta(days=20)).year, (lo + dt.timedelta(days=20)).month)}:
            due, post = bill_instance(b, y, m)
            per = f'{y}-{m:02d}'
            paid = any(h['period'] == per for h in b.get('history', []))
            if lo <= post < hi and not paid:
                out.append({'id': b['id'], 'name': b['name'], 'date': post.isoformat(), 'due': due.isoformat(), 'icon': b.get('icon', 'bills'),
                            'amount': r2(b.get('amount_last', b['amount']))})
        return out
    before = sorted([o for b in bills for o in occurrences(b, today, np_)], key=lambda o: o['date'])
    due_before = r2(sum(o['amount'] for o in before))
    weeks, cum, worst = [], 0.0, 0.0
    for k in range(weeks_ahead):
        lo = np_ + dt.timedelta(days=7 * k); hi = lo + dt.timedelta(days=7)
        items = sorted([o for b in bills for o in occurrences(b, lo, hi)], key=lambda o: o['date'])
        weds = month_wednesdays(lo.year, lo.month, cfg['payday_weekday'])[-cfg['rent']['set_aside_paydays']:]
        if lo in weds:
            items.append({'id': 'rent', 'name': 'Rent cash set-aside', 'date': lo.isoformat(), 'icon': 'home', 'amount': cfg['rent']['per_payday']})
        out = r2(sum(i['amount'] for i in items))
        cum = r2(cum + cfg['bills_reserve'] - out); worst = min(worst, cum)
        weeks.append({'payday': lo.isoformat(), 'reserve_in': cfg['bills_reserve'], 'bills_out': out, 'net': r2(cfg['bills_reserve'] - out),
                      'running': cum, 'items': items})
    cushion = r2(-worst)
    safe = r2(available - due_before - rent['owed_now'] - steam_owed - cushion)
    return {'available': r2(available), 'bills_before_payday': before, 'bills_before_payday_total': due_before,
            'rent_owed': rent['owed_now'], 'steam_owed': r2(steam_owed), 'cushion': cushion, 'cushion_weeks': weeks,
            'safe_cashflow': safe}


# ---------------------------------------------------------------- insights & flags
def subscriptions(tx, bills, cancelled, today):
    active = [{'name': b['name'], 'amount': r2(learn_bill(b, tx).get('amount_last', b['amount'])), 'icon': b.get('icon', 'subs'),
               'day': b['due_day']} for b in bills if 'SUB' in b.get('tags', [])]
    flags = []
    for c in cancelled:
        hits = [t for t in tx if t['amount'] < 0 and t['date'] > c['since'] and any(k in text_of(t) for k in c['any'])
                and -t['amount'] >= c.get('min', 0)]
        c2 = {k: v for k, v in c.items() if k not in ('any', 'min')}
        c2['charged_after'] = [{'date': t['date'], 'amount': r2(-t['amount']), 'id': t.get('id')} for t in sorted(hits, key=lambda t: t['date'])]
        flags.append(c2)
    return {'active': active, 'monthly_total': r2(sum(a['amount'] for a in active)), 'cancelled': flags}


def possible_duplicates(tx, days=3, min_amount=10):
    s = sorted([t for t in tx if t['amount'] < 0 and t.get('category') not in ('transfer', 'cash', 'income')], key=lambda t: t['date'])
    out = []
    for i, a in enumerate(s):
        for b in s[i + 1:]:
            if (D(b['date']) - D(a['date'])).days > days: break
            if a['merchant'] == b['merchant'] and abs(a['amount'] - b['amount']) < 0.005 and -a['amount'] >= min_amount \
               and a['category'] not in FOOD_CATS:
                out.append({'merchant': a['merchant'], 'amount': r2(-a['amount']), 'dates': [a['date'], b['date']], 'ids': [a.get('id'), b.get('id')]})
    return out


def spending_insights(tx, today, weeks):
    m0 = today.replace(day=1).isoformat(); t = today.isoformat()
    month = [x for x in tx if m0 <= x['date'] <= t and x['amount'] < 0]
    by = defaultdict(lambda: [0.0, 0])
    for x in month:
        if x['category'] in ('transfer', 'cash', 'income', 'bills', 'subs', 'fees'): continue
        by[x['merchant']][0] += -x['amount']; by[x['merchant']][1] += 1
    top = sorted(({'merchant': k, 'amount': r2(v[0]), 'count': v[1]} for k, v in by.items()), key=lambda x: -x['amount'])[:6]
    cat = lambda c: r2(sum(-x['amount'] for x in month if x['category'] == c))
    cur = next((w for w in weeks if w['current']), None)
    past = [w for w in weeks if not w['current']][-4:]
    avg = lambda key: r2(sum(w['spent'][key] for w in past) / len(past)) if past else 0.0
    fast_food = ('mcdonald', 'taco bell', 'jack in the box', 'chick-fil-a', "carl's", 'little caesar', 'burger')
    ff = [x for x in month if x['category'] == 'food' and any(k in x['merchant'].lower() for k in fast_food)]
    return {'month': today.strftime('%Y-%m'), 'top_merchants': top, 'eating_out_month': cat('food'), 'eating_out_count': sum(1 for x in month if x['category'] == 'food'),
            'groceries_month': cat('groceries'), 'gas_month': cat('gas'), 'fun_month': r2(cat('fun') + cat('shopping')),
            'fast_food_month': r2(sum(-x['amount'] for x in ff)), 'fast_food_count': len(ff),
            'this_week': {k: (cur['spent'][k] if cur else 0) for k in ('food', 'eating_out', 'groceries', 'fun_total', 'gas')},
            'avg_4w': {k: avg(k) for k in ('food', 'eating_out', 'groceries', 'fun_total', 'gas')}}


# ---------------------------------------------------------------- top level
def build(accounts, tx, cfg, today, now, connection=None, cash_flow_extra=None):
    chk = next(a for a in accounts if a['kind'] == 'checking'); sav = next(a for a in accounts if a['kind'] == 'savings')
    tx = sorted(tx, key=lambda t: (t['date'], t.get('id', '')), reverse=True)
    ws = week_start(today, cfg['payday_weekday'])
    weeks = [week_summary(tx, ws - dt.timedelta(days=7 * k), cfg, today) for k in range(5, -1, -1)]
    cur = weeks[-1]
    pcs = paychecks(tx)
    next_pd = ws + dt.timedelta(days=7)
    bills = [learn_bill(b, tx) for b in cfg['bills']]
    month_bills = bills_for_month(cfg['bills'], today, tx)
    rent = rent_status(tx, today, cfg, chk.get('mask'))
    to_sav = [t for t in tx if t['date'] >= ws.isoformat() and t.get('account') == chk.get('mask') and t.get('category') == 'transfer'
              and t['amount'] < 0 and sav['mask'] in t['merchant']]
    steam_done = r2(sum(-t['amount'] for t in to_sav))
    steam_owed = r2(max(0.0, cfg['steam_per_payday'] - steam_done)) if (cur['paycheck_date'] or today > ws) else 0.0
    if cur['estimate']:
        steam_owed = 0.0  # no paycheck yet this week -> nothing to move yet
    cf = cashflow(chk['available'], bills, rent, steam_owed, today, next_pd, cfg)
    budget_left = r2(cur['left']['food'] + cur['left']['fun'])
    safe = r2(max(0.0, min(cf['safe_cashflow'], max(0.0, budget_left))))
    days_left = (D(cur['end']) - today).days + 1
    # savings pace
    since = (today - dt.timedelta(days=56)).isoformat()
    series = savings_series(tx, sav['current'], sav['mask'], min(t['date'] for t in tx) if tx else today.isoformat())
    bal_8w = next((b for d, b in series if d >= since), series[0][1] if series else sav['current'])
    net_weekly = r2((sav['current'] - bal_8w) / 8)
    deposits = [t for t in tx if t.get('account') == chk.get('mask') and t['amount'] < 0 and t.get('category') == 'transfer'
                and sav['mask'] in t['merchant'] and t['date'] >= since]
    actual_per = r2(sum(-t['amount'] for t in deposits) / 8)
    g = cfg['goal']
    proj = goal_projection(sav['current'], g['target'], D(g['due']), today, next_pd, cfg['steam_per_payday'], actual_per, net_weekly)
    pulled = r2(sum(t['amount'] for t in tx if t.get('account') == sav['mask'] and t['amount'] < 0 and t['date'] >= since))
    # holds
    pend = lambda mask: r2(sum(-t['amount'] for t in tx if t.get('pending') and t.get('account') == mask and t['amount'] < 0))
    holds = []
    for a in (chk, sav):
        gap = r2(a['current'] - a['available'])
        if gap > 0.004:
            p = pend(a['mask'])
            why = ('pending purchases' if p >= gap - 0.01 else
                   'likely your $5 membership share (it always stays in savings)' if a['kind'] == 'savings' and abs(gap - 5) < 0.01 else
                   'a card authorization the bank hasn\'t posted yet (no pending purchase listed)')
            holds.append({'account': a['mask'], 'kind': a['kind'], 'gap': gap, 'pending': p, 'why': why})
    subs = subscriptions(tx, cfg['bills'], cfg['subscriptions_cancelled'], today)
    dups = possible_duplicates(tx)
    ins = spending_insights(tx, today, weeks)
    load = monthly_bill_load(cfg['bills'], tx)
    alerts = []
    for c in subs['cancelled']:
        if c['charged_after']:
            tot = r2(sum(x['amount'] for x in c['charged_after']))
            alerts.append({'id': f"cancelled-{c['name'].lower().replace(' ', '-')}", 'tone': 'red', 'icon': c.get('icon', 'subs'),
                           'title': f"{c['name']} charged after you cancelled",
                           'text': ', '.join(f"${x['amount']:.2f} on {D(x['date']).strftime('%b %-d')}" for x in c['charged_after']) + f" (${tot:.2f} total). Check your Amazon account and ask for a refund." if 'amazon' in c['name'].lower()
                           else ', '.join(f"${x['amount']:.2f} on {D(x['date']).strftime('%b %-d')}" for x in c['charged_after']) + '.'})
    for d in dups:
        alerts.append({'id': f"dup-{d['ids'][0]}", 'tone': 'amber', 'icon': 'alert', 'title': f"Possible double charge: {d['merchant']}",
                       'text': f"${d['amount']:.2f} on {D(d['dates'][0]).strftime('%b %-d')} and again {D(d['dates'][1]).strftime('%b %-d')}. If you only bought once, ask the store or OnPoint."})
    if cf['cushion'] > 0:
        wk = min(cf['cushion_weeks'], key=lambda w: w['running'])
        alerts.append({'id': f"cushion-{wk['payday']}", 'tone': 'amber', 'icon': 'calendar', 'title': f"Big bill week starting {D(wk['payday']).strftime('%b %-d')}",
                       'text': f"${wk['bills_out']:.0f} of bills and rent cash land that week but the reserve adds ${cfg['bills_reserve']}. Keep ${cf['cushion']:.0f} in checking for it."})
    for h in holds:
        if h['kind'] == 'checking':
            alerts.append({'id': f"hold-{h['gap']}", 'tone': 'info', 'icon': 'clock', 'title': f"${h['gap']:.2f} on hold in checking",
                           'text': f"Current balance is ${h['gap']:.2f} more than available: {h['why']}. Available is what you can spend."})
    od = [t for t in tx if t.get('od') and t.get('account') == chk.get('mask') and t['date'] >= (today - dt.timedelta(days=45)).isoformat()]
    if od:
        alerts.append({'id': f"od-{od[0]['date']}", 'tone': 'amber', 'icon': 'transfer', 'title': 'Overdraft protection pulled from savings',
                       'text': f"{len(od)} automatic transfers (${sum(t['amount'] for t in od):.2f}) from Member Savings on {D(od[0]['date']).strftime('%b %-d')} kept checking from going negative. That money came out of Steam Frame savings."})
    return {
        'week': cur, 'weeks': weeks, 'next_payday': next_pd.isoformat(), 'paycheck_estimate': paycheck_estimate(tx),
        'paychecks': [{'date': t['date'], 'amount': t['amount']} for t in pcs][-12:],
        'month_bills': month_bills, 'bill_load': load, 'rent': rent, 'steam_done': steam_done, 'steam_owed': steam_owed,
        'cashflow': cf, 'safe': {'amount': safe, 'cashflow': cf['safe_cashflow'], 'budget_left': budget_left, 'days_left': days_left,
                                 'per_day': r2(safe / days_left) if days_left > 0 else 0.0, 'limited_by': 'bills' if cf['safe_cashflow'] < budget_left else 'budget'},
        'goal': proj, 'savings_pulled_8w': pulled, 'savings_series': series[-84:], 'holds': holds, 'subscriptions': subs,
        'duplicates': dups, 'insights': ins, 'alerts': alerts,
    }
