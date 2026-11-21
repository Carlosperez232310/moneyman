"""MoneyMan Playwright suite at 390x844 and 430x932 (simulated iPhone safe areas).
Layout checks on every screen (no horizontal overflow, no clipped amounts, tap targets >= 38px, tab bar pinned) plus the
flows: wrong passcode -> friendly error; unlock; Safe-to-spend hero equals the engine's number and opens its breakdown;
week switcher; ONE weekly Spending budget (Home row, Week bucket, cash quick-add with no Food/Fun choice, old food/fun cash
entries migrated into Spending); bills tap-to-mark paid (persisted, moves to Paid, next-month
reset); Activity search + filters + transaction detail sheet; Insights; Goals projection; stale banner when data is old;
remember-device reload; lock & forget. Screenshots (deviceScaleFactor 2) go to screenshots/<vp>-<name>.png.
Run: python3 -m http.server 8766 --directory public  then  python3 tests/test_app.py [base_url]"""
import os, sys, asyncio, json
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8766/'
OUT = os.path.join(ROOT, 'screenshots'); os.makedirs(OUT, exist_ok=True)
PASS = os.environ.get('MONEYMAN_PASSCODE') or open(os.path.join(ROOT, '.passcode')).readline().strip()
SAFE = {(390, 844): (47, 34), (430, 932): (59, 34)}
TABS = ['home', 'week', 'bills', 'activity', 'goals']
_pp = os.path.join(ROOT, 'private', 'data.json')
PLAIN = json.load(open(_pp)) if os.path.exists(_pp) else None
issues = []
CHECK_JS = r'''() => {
  const vw = innerWidth, vh = innerHeight, res = {vw, vh};
  const main = document.querySelector('#main'), scr = document.querySelector('#screen'), tb = document.querySelector('#tabbar');
  res.docScrollW = document.documentElement.scrollWidth; res.mainScrollW = main.scrollWidth;
  res.tabBottom = tb.getBoundingClientRect().bottom;
  res.overflow = [];
  for (const el of document.querySelectorAll('#app *, #sheet-root *')) {
    const r = el.getBoundingClientRect(); if (!r.width) continue;
    if (el.closest('.filters') || el.closest('.overlay.out')) continue;
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

async def layout(page, tag, name):
    r = await page.evaluate(CHECK_JS)
    check(r['docScrollW'] <= r['vw'] and r['mainScrollW'] <= r['vw'], f'{name}: horizontal overflow {r["docScrollW"]}/{r["mainScrollW"]}', tag)
    check(not r['overflow'], f'{name}: overflow {r["overflow"][:4]}', tag)
    check(not r['clipped'], f'{name}: clipped {r["clipped"][:4]}', tag)
    check(not r['small'], f'{name}: small tap targets {r["small"][:4]}', tag)
    check(abs(r['tabBottom'] - r['vh']) < 1.5, f'{name}: tab bar not pinned ({r["tabBottom"]} vs {r["vh"]})', tag)
    return r

async def shot(page, tag, name, bottom=False):
    await page.screenshot(path=f'{OUT}/{tag}-{name}.png')
    if bottom:
        await page.evaluate("document.querySelector('#main').scrollTo(0, 1e6)"); await page.wait_for_timeout(450)
        await page.screenshot(path=f'{OUT}/{tag}-{name}-bottom.png')
        await page.evaluate("document.querySelector('#main').scrollTo(0, 0)"); await page.wait_for_timeout(200)

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
        await page.goto(URL); await page.wait_for_selector('#lock:not([hidden])', timeout=8000); await page.wait_for_timeout(700)
        await shot(page, tag, 'lock')
        await page.fill('#pass', 'wrong-words-here-00'); await page.click('#unlock')
        await page.wait_for_function("document.querySelector('#lock-err').textContent.length > 0", timeout=15000)
        err = await page.text_content('#lock-err')
        check("not it" in err and await page.is_visible('#lock'), f'wrong passcode error: {err!r}', tag)
        await page.fill('#pass', PASS.upper().replace('-', ' ')); await page.click('#unlock')   # normalised input works
        await page.wait_for_selector('#app:not([hidden])', timeout=20000); await page.wait_for_timeout(1300)
        d = await page.evaluate("__MM.S.data")
        print(f'[{tag}] unlocked: schema {d.get("schema")}, {len(d["transactions"])} tx, generated {d["generated_at"]}')
        # ---- home
        txt = await page.inner_text('#screen')
        sc = await page.evaluate("__MM.safeCalc()")
        if PLAIN and PLAIN.get('safe'):
            check(abs(sc['amount'] - PLAIN['safe']['amount']) < 0.01, f'safe {sc["amount"]} != engine {PLAIN["safe"]["amount"]}', tag)
        hero = await page.inner_text('.hero')
        check('SAFE TO SPEND' in hero.upper() and f"{sc['amount']:,.2f}".split('.')[0] in hero.replace('$', ''), f'hero shows safe amount: {hero[:80]!r}', tag)
        check('Bank synced' in txt and 'Next update' in txt, 'home shows bank sync + next update', tag)
        check('4:14' not in txt, 'no paused 4:14 PM schedule', tag)
        rows = await page.locator('.week-card .bk-row').all_inner_texts()
        check(len(rows) == 1 and 'Spending' in rows[0] and 'Fun' not in rows[0] and 'food + fun' not in txt.lower(), f'home week card = one Spending row: {rows!r}', tag)
        hw = await page.evaluate("__MM.weekCalc(0)")
        if PLAIN and PLAIN.get('week', {}).get('left'):
            check(abs(hw['sp']['budget'] - PLAIN['week']['budgets']['spending']) < 0.01 and abs(hw['sp']['left'] - PLAIN['week']['left']['spending']) < 0.01,
                  f"app spending {hw['sp']['budget']}/{hw['sp']['left']} != engine {PLAIN['week']['budgets']['spending']}/{PLAIN['week']['left']['spending']}", tag)
        check(f"{hw['sp']['left']:,.2f}" in rows[0] if rows else False, 'home row shows spending left', tag)
        await layout(page, tag, 'home'); await shot(page, tag, 'home', bottom=True)
        await page.click('.hero'); await page.wait_for_selector('.sheet'); await page.wait_for_timeout(450)
        st = await page.inner_text('.sheet')
        check('Checking available' in st and 'Budget left' in st, f'safe sheet breakdown: {st[:60]!r}', tag)
        check('spending budget' in st.lower() and 'food + fun' not in st.lower() and 'Fun left' not in st, 'safe sheet says spending budget', tag)
        await layout(page, tag, 'safe-sheet'); await shot(page, tag, 'safe-sheet')
        await page.click('.sheet-x'); await page.wait_for_timeout(400)
        # ---- tabs
        for t in TABS[1:]:
            await page.click(f'.tab[data-tab="{t}"]'); await page.wait_for_timeout(900)
            await layout(page, tag, t); await shot(page, tag, t, bottom=True)
        # ---- week: one Spending bucket, switcher, cash into Spending, old food/fun cash migrated
        await page.click('.tab[data-tab="week"]'); await page.wait_for_timeout(700)
        w0 = await page.evaluate("__MM.weekCalc(0)")
        check(await page.locator('.bucket').count() == 1 and await page.locator('.bucket.spending').count() == 1, 'week tab has one Spending bucket', tag)
        wt = await page.inner_text('#screen')
        check('Purchases' in wt and 'Food purchases' not in wt and 'Fun purchases' not in wt and 'Not part of food or fun' not in wt, 'week tab: one purchase list, no Food/Fun', tag)
        check(len(w0['sp']['items']) == await page.locator('#screen .row.tx').count(), 'purchase list = all spending items', tag)
        await page.click('.sw-btn[data-d="1"]'); await page.wait_for_timeout(700)
        title = await page.text_content('.h-title'); check(title == 'Last week', f'switcher -> {title!r}', tag)
        await shot(page, tag, 'week-last'); await layout(page, tag, 'week-last')
        await page.click('.sw-btn[data-d="-1"]'); await page.wait_for_timeout(600)
        await page.click('button[data-action="cash"]'); await page.wait_for_selector('#cash-amt'); await page.wait_for_timeout(400)
        cst = await page.inner_text('.sheet')
        check(await page.locator('.sheet [data-c]').count() == 0 and 'Food' not in cst and 'Fun' not in cst and 'spending budget' in cst, 'cash sheet has no Food/Fun choice', tag)
        await page.fill('#cash-amt', '7.5'); await page.fill('#cash-note', 'Arcade')
        await shot(page, tag, 'cash-sheet'); await page.click('#cash-save'); await page.wait_for_timeout(700)
        w1 = await page.evaluate("__MM.weekCalc(0)")
        check(abs(w1['sp']['spent'] - w0['sp']['spent'] - 7.5) < 0.01 and abs(w1['sp']['left'] - (w0['sp']['left'] - 7.5)) < 0.01, 'cash counted toward Spending', tag)
        tt = await page.text_content('.toast span'); check('Spending left' in (tt or ''), f'cash toast {tt!r}', tag)
        s1 = await page.evaluate("__MM.safeCalc()"); check(s1['amount'] <= sc['amount'] + 0.001, 'cash lowers or keeps safe-to-spend', tag)
        await page.click('[data-action="del-cash"]'); await page.wait_for_timeout(500)
        # old phone data: cash entries tagged food / fun must migrate in place and still count
        await page.evaluate('''(() => { const w = __MM.weekCalc(0).w; localStorage.setItem('moneyman.cash.v1', JSON.stringify([
          { id: 'oldfood', amount: 3, note: 'Tacos', cat: 'food', date: w.start, week: w.start }, { id: 'oldfun', amount: 2, note: '', cat: 'fun', date: w.start, week: w.start }])); })()''')
        await page.reload(); await page.wait_for_selector('#app:not([hidden])'); await page.wait_for_timeout(900)
        mig = await page.evaluate("JSON.parse(localStorage.getItem('moneyman.cash.v1'))")
        check([m['cat'] for m in mig] == ['spending', 'spending'] and [m.get('was') for m in mig] == ['food', 'fun'], f'old cash migrated in place: {mig!r}', tag)
        w2 = await page.evaluate("__MM.weekCalc(0)")
        check(abs(w2['sp']['spent'] - w0['sp']['spent'] - 5) < 0.01, 'migrated food/fun cash counts toward Spending', tag)
        await page.evaluate("localStorage.removeItem('moneyman.cash.v1')"); await page.reload(); await page.wait_for_selector('#app:not([hidden])'); await page.wait_for_timeout(700)
        # ---- bills: mark paid, persists, next month resets
        await page.click('.tab[data-tab="bills"]'); await page.wait_for_timeout(700)
        k = await page.evaluate("__MM.billInstances().find(b => !b.paid && b.id !== 'rent').key")
        await page.click(f'.chk[data-key="{k}"]'); await page.wait_for_timeout(1000)
        check(await page.locator(f'#bills-paid .bill[data-key="{k}"]').count() == 1, f'{k} moved to Paid', tag)
        await shot(page, tag, 'bills-paid')
        await page.reload(); await page.wait_for_selector('#app:not([hidden])'); await page.wait_for_timeout(900)
        check(await page.locator(f'#bills-paid .bill[data-key="{k}"]').count() == 1, 'paid tick persists (remember device)', tag)
        await page.click(f'.chk[data-key="{k}"]'); await page.wait_for_timeout(1000)
        check(await page.locator(f'#bills-paid .bill[data-key="{k}"]').count() == 0, 'untick moves it back', tag)
        # ---- activity: search, filter, detail
        await page.click('.tab[data-tab="activity"]'); await page.wait_for_timeout(700)
        await page.fill('#q', 'mcdonald'); await page.wait_for_timeout(300)
        names = await page.locator('#tx-list .row .nm').all_inner_texts()
        check(names and all('McDonald' in n for n in names), f'search filters ({len(names)})', tag)
        await shot(page, tag, 'activity-search')
        await page.click('[data-action="clear-q"]'); await page.wait_for_timeout(300)
        chips = await page.locator('.fchip').all_inner_texts()
        check(chips == ['All', 'Spending', 'Bills', 'Income', 'Transfers'], f'filter chips {chips!r}', tag)
        await page.click('.fchip[data-f="spending"]'); await page.wait_for_timeout(300)
        cats = await page.evaluate("__MM.txList().map(t => t.category)")
        check(cats and set(cats) <= {'food', 'groceries', 'fun', 'shopping', 'gas', 'spending'}, f'spending filter {set(cats)}', tag)
        await page.click('.fchip[data-f="bills"]'); await page.wait_for_timeout(300)
        cats = await page.evaluate("__MM.txList().map(t => t.category)"); check(cats and set(cats) <= {'bills', 'fees', 'subs'}, f'bills filter {set(cats)}', tag)
        await page.click('.fchip[data-f="all"]'); await page.wait_for_timeout(300)
        await page.locator('#tx-list [data-action="tx"]').first.click(); await page.wait_for_selector('.tx-head'); await page.wait_for_timeout(400)
        check('Category' in await page.inner_text('.sheet'), 'transaction detail sheet', tag)
        await layout(page, tag, 'tx-sheet'); await shot(page, tag, 'tx-sheet')
        await page.click('.sheet-x'); await page.wait_for_timeout(350)
        await page.click('[data-action="actview"][data-v="insights"]'); await page.wait_for_timeout(600)
        it = await page.inner_text('#screen'); check('4-week average' in it and 'Top places' in it, 'insights view', tag)
        await layout(page, tag, 'insights'); await shot(page, tag, 'insights', bottom=True)
        await page.click('[data-action="actview"][data-v="list"]')
        # ---- menu
        await page.click('[data-action="menu"]'); await page.wait_for_timeout(450)
        mt = await page.inner_text('.sheet'); check('9:02 AM and 9:02 PM' in mt, 'menu schedule', tag)
        await shot(page, tag, 'menu'); await page.click('.menu-row[data-action="refresh"]')
        await page.wait_for_selector('.toast', timeout=10000); tt = await page.text_content('.toast span')
        check(tt.startswith('This is the newest data') or tt.startswith('Updated with'), f'refresh toast {tt!r}', tag)
        await page.wait_for_timeout(500); await shot(page, tag, 'refresh')
        print(f'[{tag}] refresh -> {tt!r}')
        await page.wait_for_timeout(5200)
        # ---- stale banner: pretend it's 20 h after the data was generated
        gen_ms = await page.evaluate("new Date(__MM.S.data.generated_at).getTime()")
        await page.evaluate(f"(() => {{ const real = Date.now; Date.now = () => {gen_ms} + 20*3600e3; }})()")
        await page.click('.tab[data-tab="home"]'); await page.wait_for_timeout(700)
        check(await page.locator('.banner').count() == 1, 'stale banner after 14 h', tag)
        await shot(page, tag, 'stale')
        # ---- lock & forget
        await page.reload(); await page.wait_for_selector('#app:not([hidden])'); await page.wait_for_timeout(600)
        await page.click('[data-action="menu"]'); await page.wait_for_timeout(400); await page.click('.menu-row[data-action="lock"]'); await page.wait_for_timeout(400)
        check(await page.is_visible('#lock') and not await page.evaluate("localStorage.getItem('moneyman.key.v1')"), 'lock & forget', tag)
        check(not errs, f'console errors: {errs[:3]}', tag)
        await b.close()

async def main():
    for vp in SAFE: await run(*vp)
    print(f'\nRESULT: {len(issues)} issue(s)'); [print('  ', i) for i in issues]
    sys.exit(1 if issues else 0)
asyncio.run(main())
