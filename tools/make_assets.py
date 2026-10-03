"""Generate subsetted woff2 fonts (Inter + Sora) and the MoneyMan app icons into src/.
Requires: fonttools (pyftsubset, varLib.instancer), brotli, Pillow. Source fonts are the Google Fonts
variable TTFs installed on the box under /usr/share/fonts/truetype/sand-box/google/."""
import os, subprocess, math, tempfile
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src')
G = '/usr/share/fonts/truetype/sand-box/google'
INTER = f'{G}/Inter/Inter-VariableFont_opsz,wght.ttf'
SORA = f'{G}/Sora/Sora-VariableFont_wght.ttf'
U = 'U+0020-007E,U+00A0-00FF,U+2013-2014,U+2018-201D,U+2022,U+2026,U+2190-2193,U+2212,U+2248,U+00D7,U+2713,U+2009,U+202F'

def subset(src, out, axes):
    f = TTFont(src)
    f = instancer.instantiateVariableFont(f, axes)
    tmp = tempfile.mktemp(suffix='.ttf'); f.save(tmp)
    subprocess.run(['pyftsubset', tmp, f'--unicodes={U}', '--flavor=woff2', '--layout-features=kern,liga,calt,tnum,case,ss01,cv11',
                    f'--output-file={os.path.join(SRC, "fonts", out)}'], check=True)
    os.remove(tmp)

os.makedirs(os.path.join(SRC, 'fonts'), exist_ok=True); os.makedirs(os.path.join(SRC, 'icons'), exist_ok=True)
subset(INTER, 'inter.woff2', {'opsz': 14, 'wght': (400, 800)})
subset(SORA, 'sora.woff2', {'wght': (500, 800)})

def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
STOPS = [(62, 240, 176), (52, 200, 255), (139, 123, 255)]  # mint -> cyan -> violet
def grad(t):
    if t < .5: return lerp(STOPS[0], STOPS[1], t * 2)
    return lerp(STOPS[1], STOPS[2], (t - .5) * 2)

def icon(size, maskable=False):
    S = 1024
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32) / S
    t = np.clip((xx + yy) / 2, 0, 1)[..., None]
    a, b = np.array([7, 9, 20], np.float32), np.array([22, 20, 56], np.float32)
    arr = a + (b - a) * t
    d = np.sqrt((xx - .5) ** 2 + (yy - .5) ** 2)
    orb = np.clip(1 - d / .48, 0, 1)[..., None] ** 2.2
    arr = arr + orb * np.array([18, 70, 90], np.float32)
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGB')
    scale = 0.80 if maskable else 1.0
    R = 330 * scale; W = int(74 * scale); cx = cy = S / 2
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0)); ld = ImageDraw.Draw(layer)
    # track
    ld.ellipse([cx-R, cy-R, cx+R, cy+R], outline=(255, 255, 255, 34), width=W)
    # gradient progress arc (~78%) from top, clockwise
    start, sweep, n = -90, 282, 300
    for i in range(n):
        t = i / n
        a0 = start + sweep * t; a1 = start + sweep * (i + 1.6) / n
        ld.arc([cx-R, cy-R, cx+R, cy+R], a0, a1, fill=grad(t) + (255,), width=W)
    # rounded caps
    for ang, col in [(start, grad(0)), (start + sweep, grad(1))]:
        rr = R - W / 2; x = cx + rr * math.cos(math.radians(ang)); y = cy + rr * math.sin(math.radians(ang))
        ld.ellipse([x - W/2, y - W/2, x + W/2, y + W/2], fill=col + (255,))
    glowl = layer.filter(ImageFilter.GaussianBlur(34))
    # monogram
    f = ImageFont.truetype(SORA, int(330 * scale))
    try: f.set_variation_by_axes([800])
    except Exception: pass
    txt = 'M'; bb = ld.textbbox((0, 0), txt, font=f)
    tl = Image.new('RGBA', (S, S), (0, 0, 0, 0)); td = ImageDraw.Draw(tl)
    td.text(((S - (bb[2]-bb[0]))/2 - bb[0], (S - (bb[3]-bb[1]))/2 - bb[1] + 6), txt, font=f, fill=(246, 250, 255, 255))
    tglow = tl.filter(ImageFilter.GaussianBlur(18))
    img = img.convert('RGBA')
    img.alpha_composite(glowl); img.alpha_composite(glowl)
    img.alpha_composite(layer)
    shade = Image.new('RGBA', (S, S), (120, 230, 255, 0)); shade.putalpha(tglow.split()[3].point(lambda v: v // 3))
    img.alpha_composite(shade); img.alpha_composite(tl)
    return img.convert('RGB').resize((size, size), Image.LANCZOS)

icon(180).save(os.path.join(SRC, 'icons', 'apple-touch-icon.png'))
icon(192).save(os.path.join(SRC, 'icons', 'icon-192.png'))
icon(512).save(os.path.join(SRC, 'icons', 'icon-512.png'))
icon(512, maskable=True).save(os.path.join(SRC, 'icons', 'icon-maskable-512.png'))
icon(32).save(os.path.join(SRC, 'icons', 'favicon-32.png'))
icon(1024).save('/tmp/moneyman-icon-1024.png')
print('assets ok')
