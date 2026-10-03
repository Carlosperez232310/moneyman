"""Service-worker checks: (1) data.enc.json is network-first (a new blob on the server shows up on the next load,
never a stale cached copy); (2) offline launch renders the cached shell + last data for a remembered device;
(3) manifest/installability basics. Run with the local server on :8766 (or pass a base URL; the freshness test
only runs locally because it rewrites public/data.enc.json and restores it)."""
import asyncio, json, os, shutil, subprocess, sys, tempfile
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8766/'
LOCAL = 'localhost' in URL
PASS = os.environ.get('MONEYMAN_PASSCODE') or open(os.path.join(ROOT, '.passcode')).readline().strip()
ok = True
def check(c, m):
    global ok
    print(('PASS ' if c else 'FAIL ') + m); ok &= bool(c)

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(); ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        p = await ctx.new_page(); await p.goto(URL)
        await p.wait_for_selector('#lock:not([hidden])', timeout=10000)
        await p.fill('#pass', PASS); await p.click('#unlock'); await p.wait_for_selector('#app:not([hidden])', timeout=15000)
        await p.evaluate("navigator.serviceWorker.ready.then(()=>1)"); await p.wait_for_timeout(1200)
        await p.reload(); await p.wait_for_selector('#app:not([hidden])', timeout=10000); await p.wait_for_timeout(800)
        ctl = await p.evaluate("!!navigator.serviceWorker.controller"); check(ctl, 'service worker controls the page')
        man = await p.evaluate("fetch('manifest.json').then(r=>r.json())")
        check(man['display'] == 'standalone' and man['name'] == 'MoneyMan' and any(i['sizes'] == '512x512' for i in man['icons']), f"manifest {man['display']} {[i['sizes'] for i in man['icons']]}")
        check(await p.evaluate("!!document.querySelector('link[rel=apple-touch-icon]')"), 'apple-touch-icon link')
        gen0 = await p.evaluate("__MM.S.data.generated_at")
        if LOCAL:  # freshness: publish a new blob and make sure the next load shows it
            src = os.path.join(ROOT, 'public', 'data.enc.json'); bak = tempfile.mktemp(); shutil.copy(src, bak)
            plain = json.load(open(os.path.join(ROOT, 'private', 'data.json'))); plain['generated_at'] = '2026-10-02T21:01:00-07:00'
            tmp = tempfile.mktemp(suffix='.json'); json.dump(plain, open(tmp, 'w'))
            subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'update_data.py'), tmp], check=True, capture_output=True); os.remove(tmp)
            try:
                await p.reload(); await p.wait_for_selector('#app:not([hidden])', timeout=10000); await p.wait_for_timeout(600)
                gen1 = await p.evaluate("__MM.S.data.generated_at"); lbl = await p.text_content('#updated')
                check(gen1 != gen0 and '9:01 PM PT' in lbl, f'network-first data: {gen0} -> {gen1} ({lbl.strip()})')
            finally:
                shutil.copy(bak, src); os.remove(bak)
            await p.reload(); await p.wait_for_selector('#app:not([hidden])'); await p.wait_for_timeout(600)
        await ctx.set_offline(True); await p.reload(); await p.wait_for_timeout(1500)
        vis = await p.is_visible('#app'); title = await p.evaluate("document.querySelector('.h-title')?.textContent")
        fonts = await p.evaluate("document.fonts.check('600 16px Inter') && document.fonts.check('700 20px Sora')")
        check(vis and title and 'Carlos' in title, f'offline render: {title!r}')
        check(fonts, 'fonts available offline')
        await p.click('.tab[data-tab="bills"]'); await p.wait_for_timeout(500)
        check('Rent' in await p.inner_text('#screen'), 'offline data (bills) renders')
        await b.close()
    print('OFFLINE SUITE:', 'ALL PASS' if ok else 'FAILED'); sys.exit(0 if ok else 1)
asyncio.run(main())
