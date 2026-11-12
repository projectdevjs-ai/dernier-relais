# Capture d'écran au format téléphone : python3 scripts/shot.py <url> <sortie.png> [attente_ms]
# La carte est figée le temps de la prise (CDP) : page.screenshot() se bloque quand une scène 3D tourne.
# Prologue et labo tournent en continu : ajoute « ?direct » (carte) ou « ?leger » à l'adresse pour les capturer.
import os,sys,base64
from playwright.sync_api import sync_playwright
url=sys.argv[1]; out=sys.argv[2]; wait=int(sys.argv[3]) if len(sys.argv)>3 else 9000
with sync_playwright() as p:
    px=os.environ.get('HTTPS_PROXY')
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'],proxy={'server':px,'bypass':'localhost'} if px else None)
    c=b.new_context(viewport={'width':412,'height':880},device_scale_factor=2,ignore_https_errors=True)
    pg=c.new_page(); logs=[]
    pg.on('console',lambda m: logs.append(m.type+': '+m.text[:200])); pg.on('pageerror',lambda e: logs.append('ERR '+str(e)[:300]))
    pg.goto(url); pg.wait_for_timeout(wait)
    try: pg.evaluate("window.__dr && __dr.stage.setPaused(true)")
    except Exception: pass
    pg.wait_for_timeout(300)
    cdp=c.new_cdp_session(pg); open(out,'wb').write(base64.b64decode(cdp.send('Page.captureScreenshot',{'format':'png'})['data']))
    print('\n'.join(logs[:12])); b.close()
