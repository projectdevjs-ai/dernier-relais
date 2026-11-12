# Vérifie qu'aucun abri n'est dessiné sur la chaussée : python3 scripts/abris.py [url] [dossier_captures]
# Pour chaque lieu (ville dense, bourg, campagne) : téléporte le joueur, attend les abris, puis pour chacun regarde
# la carte de dessus, centrée sur le bâtiment, et compte les rues DESSINÉES sous son emprise (centre + 8 points à 4,5 m).
# Une capture par lieu (vue du jeu, joueur près du premier abri) est écrite dans le dossier.
import os, sys, json, base64
from playwright.sync_api import sync_playwright
url = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4231/?direct'
out = sys.argv[2] if len(sys.argv) > 2 else '/tmp'
LIEUX = [('paris-chatelet', [2.3470, 48.8586]), ('bouguenais', [-1.6215, 47.1790]), ('beauce', [1.6820, 48.2050])]
ABRIS = """(() => [...__dr.stage.shelters.all].map(s => ({ id: s.id, at: s.at, site: s.site, sited: s.sited, visible: s.group.visible, h: +s.height.toFixed(1),
  decalM: +Math.hypot((s.site[0] - s.at[0]) * 111320 * Math.cos(s.at[1] * Math.PI / 180), (s.site[1] - s.at[1]) * 111320).toFixed(1) })))()"""
SOUS = """(site) => { const m = __dr.stage.map, k = 4.5 / 111320, kx = k / Math.cos(site[1] * Math.PI / 180);
  const routes = m.getStyle().layers.filter(l => l.type === 'line' && /^(road_|bridge_)/.test(l.id) && !/rail/.test(l.id)).map(l => l.id);
  let n = 0; for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) { const p = m.project([site[0] + dx * kx, site[1] + dy * k]); n += m.queryRenderedFeatures([p.x, p.y], { layers: routes }).length ? 1 : 0; }
  return n; }"""
with sync_playwright() as p:
    px = os.environ.get('HTTPS_PROXY')
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], proxy={'server': px, 'bypass': 'localhost'} if px else None)
    c = b.new_context(viewport={'width': 412, 'height': 880}, device_scale_factor=2, ignore_https_errors=True)
    pg = c.new_page(); pg.goto(url); pg.wait_for_function("window.__dr && __dr.stage.map.loaded()", timeout=60000); pg.wait_for_timeout(2500)
    pg.evaluate("document.querySelector('.dr-help .dr-help-skip')?.click()")
    cdp = c.new_cdp_session(pg); bilan = True
    def shot(name): open(f'{out}/c-abris-{name}.png', 'wb').write(base64.b64decode(cdp.send('Page.captureScreenshot', {'format': 'png'})['data']))
    for nom, at in LIEUX:
        pg.evaluate("at => __dr.teleport(at)", at)
        abris = []
        for _ in range(20):
            pg.wait_for_timeout(1500); abris = pg.evaluate(ABRIS)
            if abris and all(a['sited'] for a in abris): break
        print(f'\n== {nom} : {len(abris)} abri(s)')
        if abris:
            # Vue du jeu : le joueur à 28 m au sud du point de livraison du premier abri, tourné vers lui.
            a0 = abris[0]; pg.evaluate("at => __dr.teleport(at)", [a0['at'][0], a0['at'][1] - 28 / 111320]); pg.wait_for_timeout(7000)
            pg.evaluate("__dr.stage.setPaused(true)"); pg.wait_for_timeout(300); shot(nom); 
        else: pg.evaluate("__dr.stage.setPaused(true)")
        for a in abris:
            pg.evaluate("s => __dr.stage.map.jumpTo({ center: s, zoom: 19, pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 } })", a['site'])
            try: pg.wait_for_function("__dr.stage.map.loaded() && !__dr.stage.map.isMoving()", timeout=15000)
            except Exception: pass
            pg.wait_for_timeout(1200)
            n = pg.evaluate(SOUS, a['site']); ok = n == 0 and a['sited']; bilan = bilan and ok
            print(f"  {a['id']:<28} hauteur {a['h']} m, décalé de {a['decalM']} m, points de l'emprise sur une rue : {n}/9 →", 'OK' if ok else 'ÉCHEC')
            if a is abris[0]: shot(nom + '-dessus')
        pg.evaluate("__dr.stage.setPaused(false)")
    print('\nRÉSULTAT abris hors chaussée :', 'OK' if bilan else 'ÉCHEC'); b.close()
