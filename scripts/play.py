# Partie automatique de contrôle : scanner, ramasser, livrer, avec captures à chaque étape.
import os, sys, json, base64
from playwright.sync_api import sync_playwright
url = sys.argv[1]; out = sys.argv[2]
if 'direct' not in url: url += ('&' if '?' in url else '?') + 'direct'  # sans prologue ni labo
def shot(pg, path):
    # Capture par CDP, carte figée le temps de la prise : page.screenshot() se bloque quand la scène 3D tourne.
    try:
        pg.evaluate("__dr.stage.setPaused(true)"); pg.wait_for_timeout(300)
        cdp = pg.context.new_cdp_session(pg)
        with open(path, 'wb') as f: f.write(base64.b64decode(cdp.send('Page.captureScreenshot', {'format': 'png'})['data']))
        cdp.detach()
    except Exception as e: print('capture impossible', path, str(e)[:80])
    finally: pg.evaluate("__dr.stage.setPaused(false)")
with sync_playwright() as p:
    px = os.environ.get('HTTPS_PROXY')
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], proxy={'server': px, 'bypass': 'localhost'} if px else None)
    c = b.new_context(viewport={'width': 412, 'height': 880}, device_scale_factor=2, ignore_https_errors=True)
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append('ERR ' + str(e)[:300]))
    pg.on('console', lambda m: errs.append(m.text[:200]) if m.type == 'error' and 'status of 4' not in m.text else None)
    pg.set_default_timeout(15000)
    pg.goto(url); pg.wait_for_function("window.__dr && __dr.game.view().shelters.length > 0", timeout=60000); pg.wait_for_timeout(2500)
    pg.evaluate("document.querySelector('.dr-help .dr-help-skip')?.click()")
    day = "{kind:'nuages',windKmh:10,tempC:14,night:false,sunAltDeg:35}"
    pg.evaluate(f"__dr.game.setWeather({day})")
    v = lambda: pg.evaluate("(() => { const v = __dr.game.view(); return { orders: v.orders.map(o => ({id:o.id,name:o.name,state:o.state,at:o.at,destId:o.destId,destAt:o.destAt,d:o.distanceM})), shelters: v.shelters.length, p: v.player, sc: v.scanner }; })()")
    print('avant scan', json.dumps({k: (len(x) if isinstance(x, list) else x) for k, x in v().items() if k != 'p'}, ensure_ascii=False))
    print('scan', pg.evaluate("__dr.game.scan()")); pg.wait_for_timeout(2500); shot(pg, out + '-2-scan.png')
    s = v(); print('colis révélés', len(s['orders']), [o['name'] for o in s['orders']][:5])
    if s['orders']:
        o = sorted(s['orders'], key=lambda o: o['d'])[0]
        pg.evaluate(f"__dr.teleport({json.dumps(o['at'])})"); pg.wait_for_timeout(1500)
        print('ramassage', pg.evaluate(f"__dr.game.pickup({json.dumps(o['id'])})")); pg.wait_for_timeout(3000); shot(pg, out + '-3-porte.png')
        pg.evaluate(f"__dr.teleport({json.dumps(o['destAt'])})"); pg.wait_for_timeout(6000); shot(pg, out + '-4-abri.png')
        print('livraison', pg.evaluate(f"__dr.game.deliver({json.dumps(o['destId'])})")); pg.wait_for_timeout(3500); shot(pg, out + '-5-note.png')
        pg.evaluate("[...document.querySelectorAll('.dr-grade button')].find(b => /continuer/i.test(b.innerText))?.click()")
        pg.wait_for_timeout(1500)
        pg.evaluate(f"__dr.hud.openShelter({json.dumps(o['destId'])})"); pg.wait_for_timeout(1500); shot(pg, out + '-6-panneau.png')
        f = pg.evaluate("(() => { const p = __dr.game.view().player; return {score:p.score, xp:p.xp, level:p.level, deliveries:p.deliveries}; })()"); print('après', f)
    print('erreurs', errs[:8]); b.close()
