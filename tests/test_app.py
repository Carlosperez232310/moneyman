"""MoneyMan Playwright suite at 390x844 and 430x932 (simulated iPhone safe areas).
Layout checks (no horizontal overflow, tap targets >= 38px, tab bar pinned to the bottom, screens fill the viewport)
+ unlock flow (wrong passcode -> friendly error, right passcode -> data renders), remember-on-device, cash quick-add,
activity filter. Screenshots (deviceScaleFactor 2) go to screenshots/.
Run: python3 -m http.server 8766 --directory public  then  python3 tests/test_app.py [base_url]"""
import os, sys, asyncio
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8766/'
OUT = os.path.join(ROOT, 'screenshots'); os.makedirs(OUT, exist_ok=True)
PASS = os.environ.get('MONEYMAN_PASSCODE') or open(os.path.join(ROOT, '.passcode')).readline().strip()
SAFE = {(390, 844): (47, 34), (430, 932): (59, 34)}
TABS = ['home', 'goals', 'week', 'bills', 'activity']
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
  res.clipped = [...document.querySelectorAll('.row .nm, .tile .v, .stat .v, .money')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim());
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
        m = await page.evaluate('({name: __MM.S.data.name, n: __MM.S.data.transactions.length, left: __MM.weekCalc().left})')
        print(f'[{tag}] unlocked: {m}')
        check(m['n'] > 10, 'transactions decrypted', tag)
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
                g0 = next((g for g in PLAIN['goals'] if g.get('featured')), PLAIN['goals'][0])
                if t == 'home': check(g0['name'] in r['text'] and 'Food & fun left' in r['text'], 'home content', tag)
                if t == 'goals': check(all(g['name'] in r['text'] for g in PLAIN['goals']), 'goals content', tag)
                if t == 'bills': check(all(b['name'] in r['text'] for b in PLAIN['bills']['upcoming'][:3]), 'bills content', tag)
            sh = await page.evaluate("document.querySelector('#main').scrollHeight")
            if sh > h + 40:  # also capture the bottom of long screens
                await page.evaluate("document.querySelector('#main').scrollTo(0, 1e5)"); await page.wait_for_timeout(500)
                await page.screenshot(path=f'{OUT}/{tag}-{t}-bottom.png')
                await page.evaluate("document.querySelector('#main').scrollTo(0, 0)")
        # activity filter
        await page.click('.fchip[data-f="income"]'); await page.wait_for_timeout(400)
        amts = await page.eval_on_selector_all('#screen .row .amt', 'els => els.map(e => e.className)')
        check(amts and all('in' in c.split() for c in amts), 'income filter shows only money in', tag)
        await page.click('.fchip[data-f="all"]')
        # cash quick-add
        await page.click('.tab[data-tab="week"]'); await page.wait_for_timeout(800)
        left0 = await page.evaluate('__MM.weekCalc().left')
        await page.click('.btn[data-action="cash"]'); await page.wait_for_selector('#cash-amt'); await page.wait_for_timeout(500)
        await page.click('.quick button[data-q="10"]'); await page.fill('#cash-note', 'Tacos')
        r = await page.evaluate(CHECK_JS)
        if r['small'] or r['overflow']: issues.append((tag, f"cash sheet: {r['small']} {r['overflow']}"))
        await page.screenshot(path=f'{OUT}/{tag}-cash-sheet.png')
        await page.click('#cash-save'); await page.wait_for_timeout(700)
        left1 = await page.evaluate('__MM.weekCalc().left')
        check(abs((left0 - left1) - 10) < 0.001, f'cash quick-add {left0} -> {left1}', tag)
        await page.screenshot(path=f'{OUT}/{tag}-week-cash.png')
        await page.click('.del[data-action="del-cash"]'); await page.wait_for_timeout(400)
        check(abs(await page.evaluate('__MM.weekCalc().left') - left0) < 0.001, 'cash delete', tag)
        # menu sheet
        await page.click('[data-action="menu"]'); await page.wait_for_timeout(600)
        r = await page.evaluate(CHECK_JS)
        if r['small']: issues.append((tag, f"menu small taps {r['small']}"))
        await page.screenshot(path=f'{OUT}/{tag}-menu.png'); await page.click('.overlay', position={'x': 20, 'y': 60}); await page.wait_for_timeout(400)
        # remember on this device -> reload skips the lock screen
        await page.reload(); await page.wait_for_selector('#app:not([hidden])', timeout=8000)
        check(not await page.is_visible('#lock'), 'remembered device skips lock', tag)
        print(f'[{tag}] reload with remembered key -> app shown')
        # lock & forget
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
