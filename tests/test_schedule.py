"""Next-update schedule + Refresh message math (America/Los_Angeles, DST-safe), evaluated in the real app code.
The browser runs in Asia/Tokyo on purpose: every result must come out in Pacific time regardless of the phone's zone.
Schedule: 9:02 AM, 4:14 PM (daily check-in) and 9:02 PM PT.
Run: python3 -m http.server 8766 --directory public  then  python3 tests/test_schedule.py [base_url]"""
import asyncio, sys
from datetime import datetime
from zoneinfo import ZoneInfo
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8766/'
PT = ZoneInfo('America/Los_Angeles')
ms = lambda s: int(datetime.fromisoformat(s).replace(tzinfo=PT).timestamp() * 1000)
# (now PT, data generated_at PT, expected next run PT, pending?, expected nextLabel)
CASES = [
    ('2026-10-08 08:33', '2026-10-07 16:19', '2026-10-08 09:02', False, 'Next update ~9:02 AM PT'),
    ('2026-10-08 09:10', '2026-10-07 21:04', '2026-10-08 09:02', True,  'Next update due now (9:02 AM PT run)'),
    ('2026-10-08 09:10', '2026-10-08 09:04', '2026-10-08 16:14', False, 'Next update ~4:14 PM PT'),
    ('2026-10-08 09:45', '2026-10-07 21:04', '2026-10-08 16:14', False, 'Next update ~4:14 PM PT'),
    ('2026-10-08 16:30', '2026-10-08 16:19', '2026-10-08 21:02', False, 'Next update ~9:02 PM PT'),
    ('2026-10-08 21:02', '2026-10-08 16:19', '2026-10-08 21:02', True,  'Next update due now (9:02 PM PT run)'),
    ('2026-10-08 21:30', '2026-10-08 21:04', '2026-10-09 09:02', False, 'Next update ~tomorrow 9:02 AM PT'),
    ('2026-10-08 23:59', '2026-10-08 21:04', '2026-10-09 09:02', False, 'Next update ~tomorrow 9:02 AM PT'),
    ('2026-10-09 00:05', '2026-10-08 21:04', '2026-10-09 09:02', False, 'Next update ~9:02 AM PT'),
    ('2026-11-01 08:00', '2026-10-31 21:03', '2026-11-01 09:02', False, 'Next update ~9:02 AM PT'),   # DST ends 2 AM Nov 1
    ('2026-03-07 22:00', '2026-03-07 21:03', '2026-03-08 09:02', False, 'Next update ~tomorrow 9:02 AM PT'),  # DST starts Mar 8
]
UTC_CHECK = {'2026-11-01 09:02': '2026-11-01T17:02:00.000Z', '2026-03-08 09:02': '2026-03-08T16:02:00.000Z', '2026-10-08 16:14': '2026-10-08T23:14:00.000Z'}

async def main():
    bad = 0
    async with async_playwright() as pw:
        b = await pw.chromium.launch(); ctx = await b.new_context(timezone_id='Asia/Tokyo'); p = await ctx.new_page()
        await p.goto(URL); await p.wait_for_function('window.__MM && __MM.nextUpdate', timeout=10000)
        for now, gen, exp, pend, lbl in CASES:
            r = await p.evaluate('([n, g]) => ({...__MM.nextUpdate(n, g), label: __MM.nextLabel(g, n)})', [ms(now), ms(gen)])
            ok = r['at'] == ms(exp) and r['pending'] == pend and r['label'] == lbl
            bad += not ok
            print(('PASS' if ok else 'FAIL'), f'now {now} data {gen} -> {r["label"]!r}' + ('' if ok else f' (want {exp} pending={pend} {lbl!r}, got at={r["at"]})'))
        for wall, iso in UTC_CHECK.items():
            d, t = wall.split(); h, m = map(int, t.split(':'))
            got = await p.evaluate('([d, h, m]) => new Date(__MM.ptEpoch(d, h, m)).toISOString()', [d, h, m])
            ok = got == iso; bad += not ok; print(('PASS' if ok else 'FAIL'), f'ptEpoch {wall} PT = {got}')
        msgs = [
            ('newestMsg', ms('2026-10-08 16:30'), ms('2026-10-08 16:19'), 'This is the newest data (from 4:19 PM PT). Next update around 9:02 PM PT.'),
            ('newestMsg', ms('2026-10-08 08:33'), ms('2026-10-07 16:19'), 'This is the newest data (from yesterday 4:19 PM PT). Next update around 9:02 AM PT.'),
            ('newestMsg', ms('2026-10-08 09:10'), ms('2026-10-07 21:04'), 'This is the newest data (from yesterday 9:04 PM PT). The 9:02 AM PT update should land in a few minutes.'),
            ('whenPT', ms('2026-10-08 09:05'), ms('2026-10-05 21:02'), 'Oct 5, 9:02 PM PT'),
        ]
        for fn, now, gen, want in msgs:
            got = await p.evaluate(f'([n, g]) => __MM.{fn}(g, n)', [now, gen])
            ok = got == want; bad += not ok; print(('PASS' if ok else 'FAIL'), f'{fn}: {got!r}' + ('' if ok else f' (want {want!r})'))
        await b.close()
    print('SCHEDULE SUITE:', 'ALL PASS' if not bad else f'{bad} FAILED'); sys.exit(1 if bad else 0)
asyncio.run(main())
