# Capture d'écran au format téléphone : python3 scripts/shot.py <url> <sortie.png> [attente_ms]
import os,sys
from playwright.sync_api import sync_playwright
url=sys.argv[1]; out=sys.argv[2]; wait=int(sys.argv[3]) if len(sys.argv)>3 else 9000
with sync_playwright() as p:
    px=os.environ.get('HTTPS_PROXY')
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'],proxy={'server':px,'bypass':'localhost'} if px else None)
    c=b.new_context(viewport={'width':412,'height':880},device_scale_factor=2,ignore_https_errors=True)
    pg=c.new_page(); logs=[]
    pg.on('console',lambda m: logs.append(m.type+': '+m.text[:200])); pg.on('pageerror',lambda e: logs.append('ERR '+str(e)[:300]))
    pg.goto(url); pg.wait_for_timeout(wait)
    pg.screenshot(path=out)
    print('\n'.join(logs[:12])); b.close()
