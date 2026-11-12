# Parcours complet du premier lancement : écran de départ, prologue, labo, départ sur la carte.
import os, sys
from playwright.sync_api import sync_playwright
url = sys.argv[1]; out = sys.argv[2]
with sync_playwright() as p:
    px = os.environ.get('HTTPS_PROXY')
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], proxy={'server': px, 'bypass': 'localhost'} if px else None)
    c = b.new_context(viewport={'width': 412, 'height': 880}, device_scale_factor=1, ignore_https_errors=True)
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append('ERR ' + str(e)[:300]))
    pg.on('console', lambda m: errs.append(m.text[:200]) if m.type == 'error' and '404' not in m.text and '422' not in m.text else None)
    pg.goto(url); pg.wait_for_timeout(6000); pg.screenshot(path=out + '-1-depart.png', timeout=150000)
    pg.click('#splash'); pg.wait_for_timeout(9000); print('prologue affiché', pg.locator('.s3-prologue').count())
    try: pg.get_by_text('Passer').first.click(timeout=8000)
    except Exception as e: print('passer introuvable', str(e)[:80])
    pg.wait_for_timeout(20000); print('labo affiché', pg.locator('.s3-lab').count())
    print('au labo', pg.evaluate("document.body.classList.contains('dr-in-lab')"))
    try: pg.get_by_text('Partir').first.click(timeout=8000)
    except Exception as e: print('partir introuvable', str(e)[:80])
    pg.wait_for_timeout(9000); pg.screenshot(path=out + '-4-carte.png', timeout=150000)
    print('au labo après départ', pg.evaluate("document.body.classList.contains('dr-in-lab')"))
    print('erreurs', errs[:8]); b.close()
