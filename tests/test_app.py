"""MoneyMan Playwright suite at 390x844 and 430x932 (simulated iPhone safe areas).
Layout checks (no horizontal overflow, tap targets >= 38px, tab bar pinned to the bottom, screens fill the viewport)
+ unlock flow (wrong passcode -> friendly error, right passcode -> data renders), remember-on-device, food/fun budgets,
cash quick-add into Food or Fun, food/fun activity filters, bill paid checkboxes (persisted, FLIP into Paid, month rollover). Screenshots (deviceScaleFactor 2) go to screenshots/.
Run: python3 -m http.server 8766 --directory public  then  python3 tests/test_app.py [base_url]"""
import os, sys, asyncio
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8766/'
OUT = os.path.join(ROOT, 'screenshots'); os.makedirs(OUT, exist_ok=True)
PASS = os.environ.get('MONEYMAN_PASSCODE') or open(os.path.join(ROOT, '.passcode')).readline().strip()
SAFE = {(390, 844): (47, 34), (430, 932): (59, 34)}
TABS = ['home', 'week', 'bills', 'activity', 'goals']
import json
_pp = os.path.join(ROOT, 'private', 'data.json')
PLAIN = json.load(open(_pp)) if os.path.exists(_pp) else None  # expected strings come from the private plain data
issues = []

CHECK_JS = r'''() => {
  const vw = innerWidth, vh = innerHeight, res = {vw, vh};
  const main = document.querySelector('#main'), scr = document.querySelector('#screen'), tb = document.querySelector('#tabbar');
  res.docScrollW = document.documentElement.scrollWidth; res.mainScrollW = main.scrollWidth;
  res.tabBottom = tb.getBoundingClientRect().bottom;
  res.overflow = [];
  for (const el of document.querySelectorAll('#app *, #sheet-root *')) {
    const r = el.getBoundingClientRect(); if (!r.width) continue;
    if (el.closest('.filters')) continue;
    if (r.right > vw + 0.5 || r.left < -0.5) res.overflow.push((el.className.baseVal ?? el.className) + ':' + (el.textContent||'').trim().slice(0,30) + ` [${Math.round(r.left)},${Math.round(r.right)}]`);
  }
  res.clipped = [...document.querySelectorAll('.tile .v, .stat .v, .money, .amt, .hero-amt')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim());
  res.small = [...document.querySelectorAll('#app button, #sheet-root button')].filter(b => { const r = b.getBoundingClientRect(); return r.width && (r.height < 38 || r.width < 38); })
    .map(b => b.className + ':' + b.textContent.trim().slice(0,20) + ` ${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`);
  const cs = getComputedStyle(main);
  res.fillsViewport = scr.offsetHeight >= main.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 1;
  res.text = scr.innerText.slice(0, 4000);
  return res;
}'''

def check(cond, msg, tag):
    if not cond: issues.append((tag, msg)); print(f'  FAIL [{tag}] {msg}')

async def run(w, h):
    tag = f'{w}x{h}'; sat, sab = SAFE[(w, h)]
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        ctx = await b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, is_mobile=True, has_touch=True,
            user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
        await ctx.add_init_script(f"""document.addEventListener('DOMContentLoaded',()=>{{const s=document.createElement('style');s.textContent=':root{{--sat:{sat}px!important;--sab:{sab}px!important}}';document.head.appendChild(s);}});
          try{{localStorage.setItem('moneyman.tip.v1','1')}}catch(e){{}}""")
        page = await ctx.new_page()
        errs = []; page.on('pageerror', lambda e: errs.append(str(e))); page.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        await page.goto(URL); await page.wait_for_selector('#lock:not([hidden])', timeout=8000); await page.wait_for_timeout(900)
        await page.screenshot(path=f'{OUT}/{tag}-lock.png')
        # wrong passcode -> friendly error
        await page.fill('#pass', 'wrong-words-here-00'); await page.click('#unlock')
        await page.wait_for_function("document.querySelector('#lock-err').textContent.length > 0", timeout=15000)
        err = await page.text_content('#lock-err'); await page.wait_for_timeout(300)
        await page.screenshot(path=f'{OUT}/{tag}-lock-error.png')
        check("not it" in err and await page.is_visible('#lock') and not await page.is_visible('#app'), f'wrong passcode error: {err!r}', tag)
        print(f'[{tag}] wrong passcode -> {err!r}')
        # right passcode (typed with spaces + caps to check normalisation) -> app
        await page.fill('#pass', PASS.replace('-', ' ').upper()); await page.click('#unlock')
        await page.wait_for_selector('#app:not([hidden])', timeout=15000); await page.wait_for_timeout(1500)
        m = await page.evaluate('(() => { const w = __MM.weekCalc(); return {name: __MM.S.data.name, n: __MM.S.data.transactions.length, food: [w.food.budget, w.food.left], fun: [w.fun.budget, w.fun.left]}; })()')
        print(f'[{tag}] unlocked: {m}')
        check(m['n'] > 10, 'transactions decrypted', tag)
        if PLAIN:
            wk = PLAIN['week']
            check(m['food'][0] == wk['budgets']['food'] and abs(m['fun'][0] - wk['budgets']['fun']) < 0.001, f"food/fun budgets {m['food'][0]}/{m['fun'][0]}", tag)
            cur = next(x for x in PLAIN['weeks'] if x['current'])
            check(abs(m['food'][1] - cur['left']['food']) < 0.01 and abs(m['fun'][1] - cur['left']['fun']) < 0.01, f"app week math = engine ({m['food'][1]}, {m['fun'][1]})", tag)
            sav = next(a for a in PLAIN['accounts'] if a['kind'] == 'savings')['current']
            g = await page.evaluate("__MM.goalOf()")
            check(abs(g['saved'] - sav) < 0.001, f"featured goal saved = savings balance ({g['saved']})", tag)
            sc = await page.evaluate("__MM.safeCalc()")
            check(abs(sc['amount'] - PLAIN['safe']['amount']) < 0.01, f"safe to spend {sc['amount']} = engine {PLAIN['safe']['amount']}", tag)
        for t in TABS:
            if t != 'home': await page.click(f'.tab[data-tab="{t}"]')
            await page.wait_for_timeout(1500)
            r = await page.evaluate(CHECK_JS)
            await page.screenshot(path=f'{OUT}/{tag}-{t}.png')
            prob = []
            if r['docScrollW'] > w or r['mainScrollW'] > w: prob.append(f"h-scroll {r['docScrollW']}/{r['mainScrollW']}")
            if r['overflow']: prob.append('overflow ' + '; '.join(r['overflow'][:5]))
            if r['clipped']: prob.append('clipped ' + ', '.join(r['clipped'][:5]))
            if r['small']: prob.append('small taps ' + '; '.join(r['small'][:6]))
            if abs(r['tabBottom'] - h) > 1: prob.append(f"tabbar bottom {r['tabBottom']}")
            if not r['fillsViewport']: prob.append('screen does not fill viewport')
            print(f'[{tag}] {t}: ' + ('OK' if not prob else 'ISSUES: ' + ' | '.join(prob)))
            for p in prob: issues.append((tag, f'{t}: {p}'))
            if PLAIN:
                T = r['text'].upper()
                g0 = next((g for g in PLAIN['goals'] if g.get('featured')), PLAIN['goals'][0])
                if t == 'home': check('SAFE TO SPEND' in T and 'FOOD' in T and 'FUN' in T and g0['name'].upper() in T, 'home content', tag)
                if t == 'week': check('FOOD · LEFT' in T and 'FUN · LEFT' in T and 'FUN PURCHASES' in T and 'EATING OUT' in T, 'week content', tag)
                if t == 'goals': check(all(g['name'].upper() in T for g in PLAIN['goals']) and 'NEEDED' in T, 'goals content', tag)
                if t == 'bills': check(all(b['name'].upper() in T for b in PLAIN['bills']['items'][:3]) and 'PAID' in T and 'RENT' in T, 'bills content', tag)
            sh = await page.evaluate("document.querySelector('#main').scrollHeight")
            if sh > h + 40:
                await page.evaluate("document.querySelector('#main').scrollTo(0, 1e5)"); await page.wait_for_timeout(500)
                await page.screenshot(path=f'{OUT}/{tag}-{t}-bottom.png')
                await page.evaluate("document.querySelector('#main').scrollTo(0, 0)")
        # activity: filters, search, transaction detail, insights
        await page.click('.tab[data-tab="activity"]'); await page.wait_for_timeout(600)
        for f, allowed in [('food', {'food', 'cash'}), ('groceries', {'groceries'}), ('fun', {'fun', 'shopping', 'cash'}), ('income', {'income', 'refund'})]:
            await page.click(f'.fchip[data-f="{f}"]'); await page.wait_for_timeout(300)
            cats = await page.eval_on_selector_all('#screen .list .row .ico', 'els => els.map(e => [...e.classList].filter(c => c !== "ico")[0])')
            check(cats and set(cats) <= allowed, f'{f} filter shows only {allowed}: {sorted(set(cats))}', tag)
        await page.click('.fchip[data-f="all"]'); await page.wait_for_timeout(300)
        await page.fill('#q', 'mcdonald'); await page.wait_for_timeout(400)
        names = await page.eval_on_selector_all('#tx-list .row .nm', 'els => els.map(e => e.textContent)')
        check(names and all("mcdonald" in n.lower() for n in names), f'search mcdonald -> {len(names)} rows', tag)
        await page.screenshot(path=f'{OUT}/{tag}-activity-search.png')
        await page.click('#tx-list .row'); await page.wait_for_selector('.sheet .tx-head', timeout=3000); await page.wait_for_timeout(500)
        txt = await page.inner_text('.sheet'); check('Category' in txt and 'Account' in txt, f'transaction detail sheet', tag)
        await page.screenshot(path=f'{OUT}/{tag}-tx-detail.png'); await page.click('.sheet-x'); await page.wait_for_timeout(400)
        await page.click('[data-action="clear-q"]'); await page.wait_for_timeout(300)
        await page.click('.seg2 button[data-v="insights"]'); await page.wait_for_timeout(700)
        it = (await page.inner_text('#screen')).upper(); check('4-WEEK AVERAGE' in it and 'TOP PLACES' in it, 'insights view', tag)
        await page.screenshot(path=f'{OUT}/{tag}-insights.png')
        r = await page.evaluate(CHECK_JS)
        if r['overflow'] or r['small']: issues.append((tag, f"insights layout {r['overflow']} {r['small']}"))
        await page.evaluate("document.querySelector('#main').scrollTo(0, 1e5)"); await page.wait_for_timeout(400)
        await page.screenshot(path=f'{OUT}/{tag}-insights-bottom.png'); await page.evaluate("document.querySelector('#main').scrollTo(0, 0)")
        await page.click('.seg2 button[data-v="list"]')
        # week switcher
        await page.click('.tab[data-tab="week"]'); await page.wait_for_timeout(600)
        await page.click('.sw-btn[data-d="1"]'); await page.wait_for_timeout(700)
        lw = await page.inner_text('.h-title'); check(lw.strip().lower() == 'last week', f'week switcher -> {lw!r}', tag)
        await page.screenshot(path=f'{OUT}/{tag}-week-last.png')
        await page.click('.sw-btn[data-d="-1"]'); await page.wait_for_timeout(500)
        # cash quick-add into Fun (Food untouched)
        w0 = await page.evaluate('(() => { const w = __MM.weekCalc(); return [w.food.left, w.fun.left]; })()')
        await page.click('.btn[data-action="cash"]'); await page.wait_for_selector('#cash-amt'); await page.wait_for_timeout(500)
        await page.click('.seg button[data-c="fun"]'); await page.click('.quick button[data-q="10"]'); await page.fill('#cash-note', 'Arcade')
        r = await page.evaluate(CHECK_JS)
        if r['small'] or r['overflow']: issues.append((tag, f"cash sheet: {r['small']} {r['overflow']}"))
        await page.screenshot(path=f'{OUT}/{tag}-cash-sheet.png')
        await page.click('#cash-save'); await page.wait_for_timeout(700)
        w1 = await page.evaluate('(() => { const w = __MM.weekCalc(); return [w.food.left, w.fun.left]; })()')
        check(abs(w0[0] - w1[0]) < 0.001 and abs((w0[1] - w1[1]) - 10) < 0.001, f'cash into Fun {w0} -> {w1}', tag)
        await page.click('[data-action="del-cash"]'); await page.wait_for_timeout(400)
        w2 = await page.evaluate('(() => { const w = __MM.weekCalc(); return [w.food.left, w.fun.left]; })()')
        check(w2 == w0, 'cash entry removed', tag)
        # home: safe-to-spend breakdown sheet, account sheet, alerts dismiss, stale banner
        await page.click('.tab[data-tab="home"]'); await page.wait_for_timeout(700)
        await page.click('.hero'); await page.wait_for_selector('.sheet .calc', timeout=3000); await page.wait_for_timeout(500)
        st = await page.inner_text('.sheet'); check('Checking available' in st and 'Budget left' in st, 'safe-to-spend breakdown', tag)
        await page.screenshot(path=f'{OUT}/{tag}-safe-sheet.png'); await page.click('.sheet-x'); await page.wait_for_timeout(400)
        await page.click('[data-action="acct"][data-k="checking"]'); await page.wait_for_selector('.sheet .calc'); await page.wait_for_timeout(300)
        check('Available to spend' in await page.inner_text('.sheet'), 'checking sheet', tag); await page.click('.sheet-x'); await page.wait_for_timeout(400)
        if await page.locator('.alert').count():
            await page.click('.alert .x'); await page.wait_for_timeout(600)
            n1 = await page.evaluate('Object.keys(JSON.parse(localStorage.getItem("moneyman.dismiss.v1") || "{}")).length')
            check(n1 == 1, f'alert dismissed + remembered ({n1})', tag)
            await page.evaluate("localStorage.removeItem('moneyman.dismiss.v1')"); await page.evaluate('__MM.render(false)')
        await page.evaluate("__MM.S.data._gen = __MM.S.data.generated_at; __MM.S.data.generated_at = new Date(Date.now() - 20*3600e3).toISOString(); __MM.render(false)")
        check(await page.locator('.banner').count() == 1, 'stale banner when data > 14 h old', tag)
        await page.evaluate("document.querySelector('#main').scrollTo(0, 0)"); await page.wait_for_timeout(900)
        await page.screenshot(path=f'{OUT}/{tag}-stale.png')
        await page.evaluate("__MM.S.data.generated_at = __MM.S.data._gen; __MM.render(false)")
        check(await page.locator('.banner').count() == 0, 'no stale banner on fresh data', tag)
        # bills: auto-paid from bank data, tap to check -> moves to Paid, persists, unchecks back
        await page.click('.tab[data-tab="bills"]'); await page.wait_for_timeout(900)
        inst = await page.evaluate('__MM.billInstances().map(b => ({key: b.key, paid: b.paid, auto: !!b.auto, name: b.name, id: b.id}))')
        per = (await page.evaluate('__MM.todayISO()'))[:7]
        check(all(i['key'].endswith(':' + per) for i in inst), 'bill keys are id:YYYY-MM', tag)
        for a_ in [i for i in inst if i['auto']]: check(await page.locator(f'#bills-paid .bill[data-key="{a_["key"]}"]').count() == 1, f'auto-paid {a_["key"]} in Paid', tag)
        target = next(i for i in inst if not i['paid'] and i['id'] != 'rent')
        await page.click(f'.chk[data-key="{target["key"]}"]'); await page.wait_for_timeout(1300)
        check(await page.locator(f'#bills-paid .bill[data-key="{target["key"]}"]').count() == 1, f'checked {target["key"]} moved to Paid', tag)
        stored = await page.evaluate("JSON.parse(localStorage.getItem('moneyman.paid.v1') || '{}')")
        check(stored.get(target['key']) is True, f'paid persisted in localStorage {stored}', tag)
        await page.evaluate("document.querySelector('#bills-paid').scrollIntoView({block: 'center'})"); await page.wait_for_timeout(500)
        await page.screenshot(path=f'{OUT}/{tag}-bills-paid.png')
        r = await page.evaluate(CHECK_JS)
        if r['small'] or r['overflow'] or r['clipped']: issues.append((tag, f"bills-paid layout {r['small']} {r['overflow']} {r['clipped']}"))
        await page.click('[data-action="toggle-cancelled"]'); await page.wait_for_timeout(400)
        check('Paramount' in await page.inner_text('#screen') or not (PLAIN and PLAIN['bills'].get('cancelled')), 'cancelled list expands', tag)
        await page.evaluate("document.querySelector('#main').scrollTo(0, 1e5)"); await page.wait_for_timeout(300)
        await page.screenshot(path=f'{OUT}/{tag}-bills-cancelled.png')
        await page.click('[data-action="toggle-cancelled"]'); await page.wait_for_timeout(300)
        await page.reload(); await page.wait_for_selector('#app:not([hidden])'); await page.click('.tab[data-tab="bills"]'); await page.wait_for_timeout(700)
        check(await page.locator(f'#bills-paid .bill[data-key="{target["key"]}"]').count() == 1, 'paid state survives reload', tag)
        await page.click(f'.chk[data-key="{target["key"]}"]'); await page.wait_for_timeout(1300)
        check(await page.locator(f'#bills-up .bill[data-key="{target["key"]}"], #bills-later .bill[data-key="{target["key"]}"]').count() == 1, 'unchecking moves it back to upcoming', tag)
        y, mo = map(int, per.split('-')); ny, nm = (y + (mo == 12), mo % 12 + 1); nxt = f'{ny}-{nm:02d}'
        await page.click(f'.chk[data-key="{target["key"]}"]'); await page.wait_for_timeout(900)
        await page.goto(URL + f'?today={nxt}-02&tab=bills'); await page.wait_for_selector('#app:not([hidden])'); await page.wait_for_timeout(900)
        inst2 = await page.evaluate('__MM.billInstances().map(b => ({key: b.key, paid: b.paid, date: b.date}))')
        check(all(i['key'].endswith(':' + nxt) and not i['paid'] for i in inst2), f'{nxt}: every bill back to upcoming', tag)
        await page.goto(URL); await page.wait_for_selector('#app:not([hidden])')
        await page.evaluate("localStorage.removeItem('moneyman.paid.v1')")
        # menu sheet
        await page.click('[data-action="menu"]'); await page.wait_for_timeout(600)
        r = await page.evaluate(CHECK_JS)
        if r['small']: issues.append((tag, f"menu small taps {r['small']}"))
        menu_txt = await page.inner_text('.sheet')
        check('Next update ' in menu_txt and 'up to a day' in menu_txt and 'Check for newer data' in menu_txt and '4:14' not in menu_txt, f'menu schedule note: {menu_txt!r}', tag)
        await page.screenshot(path=f'{OUT}/{tag}-menu.png'); await page.click('.sheet-x'); await page.wait_for_timeout(400)
        await page.click('.tab[data-tab="home"]'); await page.wait_for_timeout(600)
        home_note = await page.text_content('.sched-note') or ''
        check('Next update ' in home_note and 'PT' in home_note and ('Bank synced' in home_note or not (PLAIN and PLAIN.get('bank_synced_at'))), f'home sync line: {home_note!r}', tag)
        # pull-to-refresh gesture -> honest refresh message
        await page.evaluate("""(() => { const m = document.querySelector('#main'); m.scrollTop = 0;
          const T = y => new Touch({identifier: 1, target: m, clientX: 200, clientY: y});
          m.dispatchEvent(new TouchEvent('touchstart', {touches: [T(150)], changedTouches: [T(150)], bubbles: true}));
          m.dispatchEvent(new TouchEvent('touchmove', {touches: [T(200)], changedTouches: [T(200)], bubbles: true, cancelable: true}));
          m.dispatchEvent(new TouchEvent('touchmove', {touches: [T(320)], changedTouches: [T(320)], bubbles: true, cancelable: true}));
          m.dispatchEvent(new TouchEvent('touchend', {touches: [], changedTouches: [T(320)], bubbles: true})); })()""")
        await page.wait_for_selector('.toast', timeout=10000); await page.wait_for_timeout(500)
        tmsg = await page.text_content('.toast span')
        check(tmsg.startswith('This is the newest data (from ') and ('Next update around ' in tmsg or 'should land in a few minutes' in tmsg), f'pull-to-refresh toast: {tmsg!r}', tag)
        print(f'[{tag}] refresh -> {tmsg!r}')
        await page.screenshot(path=f'{OUT}/{tag}-refresh.png'); await page.wait_for_timeout(5600)
        await page.reload(); await page.wait_for_selector('#app:not([hidden])', timeout=8000)
        check(not await page.is_visible('#lock'), 'remembered device skips lock', tag)
        await page.click('[data-action="menu"]'); await page.wait_for_timeout(500); await page.click('[data-action="lock"]'); await page.wait_for_timeout(400)
        check(await page.is_visible('#lock') and await page.evaluate("localStorage.getItem('moneyman.key.v1')") is None, 'lock & forget', tag)
        check(not errs, f'console errors: {errs}', tag)
        await b.close()

async def main():
    for vp in [(390, 844), (430, 932)]: await run(*vp)
    print('\nRESULT:', 'ALL PASS' if not issues else f'{len(issues)} issue(s)')
    for i in issues: print('  ', i)
    sys.exit(1 if issues else 0)
asyncio.run(main())
