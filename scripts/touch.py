# Essai tactile de la caméra (émulation téléphone, gestes par CDP) : python3 scripts/touch.py [url]
# Vérifie : pincement (zoom), rotation à deux doigts et glisser à un doigt (cap), tenue 3 s plus tard pendant que
# « sync » continue, zoom à un doigt (double appui, double appui + glisser) tenu pendant la marche, suivi du centre quand le joueur avance, caméra derrière le porteur, bascule 2D / 3D, toucher du sol.
import os, sys, json, math
from playwright.sync_api import sync_playwright
url = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4212/?direct'
W, H = 412, 880
STATE = """(() => { const m = __dr.stage.map, c = m.getCenter(), p = __dr.game.view().player.at, pad = m.getPadding();
  const d = p ? Math.hypot((c.lng - p[0]) * 75000, (c.lat - p[1]) * 111000) : -1;
  return { zoom: +m.getZoom().toFixed(3), cap: +m.getBearing().toFixed(1), pitch: +m.getPitch().toFixed(1), ecartCentreJoueurM: +d.toFixed(1), joueur: p && p.map(x => +x.toFixed(6)), padTop: pad.top }; })()"""
with sync_playwright() as p:
    px = os.environ.get('HTTPS_PROXY')
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], proxy={'server': px, 'bypass': 'localhost'} if px else None)
    c = b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=1, has_touch=True, is_mobile=True, ignore_https_errors=True)
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append('ERR ' + str(e)[:300]))
    pg.goto(url); pg.wait_for_function("window.__dr && __dr.stage.map.loaded()", timeout=60000); pg.wait_for_timeout(3000)
    pg.evaluate("document.querySelector('.dr-help .dr-help-skip')?.click()"); pg.wait_for_timeout(400)
    cdp = c.new_cdp_session(pg)
    st = lambda: pg.evaluate(STATE)
    # `ts` (secondes) : heure portée par l'événement ; sans elle, l'heure réelle de l'envoi.
    def touch(kind, pts, ts=None):
        ev = {'type': kind, 'touchPoints': [{'x': x, 'y': y, 'id': i, 'radiusX': 8, 'radiusY': 8, 'force': 1} for i, (x, y) in enumerate(pts)]}
        if ts is not None: ev['timestamp'] = ts
        cdp.send('Input.dispatchTouchEvent', ev)
    def gesture(frames, pause=16):
        touch('touchStart', frames[0])
        for f in frames[1:]: pg.wait_for_timeout(pause); touch('touchMove', f)
        pg.wait_for_timeout(pause); touch('touchEnd', [])
    cx, cy = W / 2, H * 0.42
    def pinch(r0, r1, n=24): return [[(cx - (r0 + (r1 - r0) * i / n), cy), (cx + (r0 + (r1 - r0) * i / n), cy)] for i in range(n + 1)]
    def twist(deg, r=90, n=24):
        out = []
        for i in range(n + 1):
            a = math.radians(deg * i / n); out.append([(cx - r * math.cos(a), cy - r * math.sin(a)), (cx + r * math.cos(a), cy + r * math.sin(a))])
        return out
    def swipe(dx, dy, n=20): return [[(cx - dx / 2 + dx * i / n, cy - dy / 2 + dy * i / n)] for i in range(n + 1)]
    show = lambda name, v: print(f'{name:<34}', json.dumps(v, ensure_ascii=False))
    def diff(a, b): return {'dZoom': round(b['zoom'] - a['zoom'], 3), 'dCap': round((b['cap'] - a['cap'] + 540) % 360 - 180, 1), 'dPitch': round(b['pitch'] - a['pitch'], 1)}
    # Qui reçoit les touchers ? (un calque DOM au-dessus de la carte les intercepterait)
    print('éléments sous les doigts :', pg.evaluate(f"[[{cx-90},{cy}],[{cx+90},{cy}],[{cx},{cy}]].map(([x,y]) => {{ const e = document.elementFromPoint(x,y); return e.tagName + '.' + e.className; }})"))
    print('touch-action :', pg.evaluate("[document.body, document.getElementById('stage'), document.querySelector('#stage canvas'), document.querySelector('.maplibregl-canvas-container')].map(e => e && getComputedStyle(e).touchAction)"))

    def serie(titre, r0=60, r1=150):
        print('\n== ' + titre)
        a = st(); show('départ', a)
        gesture(pinch(r0, r1)); pg.wait_for_timeout(700); z = st(); show("après pincement", {**diff(a, z), 'écart': z['ecartCentreJoueurM']})
        gesture(twist(50)); pg.wait_for_timeout(700); r = st(); show('après rotation 2 doigts (50°)', {**diff(z, r), 'écart': r['ecartCentreJoueurM']})
        gesture(swipe(160, 0)); pg.wait_for_timeout(700); s = st(); show('après glisser 1 doigt horizontal', {**diff(r, s), 'écart': s['ecartCentreJoueurM']})
        pg.wait_for_timeout(3000); e = st(); show('3 s plus tard (total depuis départ)', {**diff(a, e), 'écart': e['ecartCentreJoueurM']})
        return a, z, r, s, e

    r1 = serie('JOUEUR IMMOBILE')
    # Marche : la position avance de 1,4 m/s vers le nord-est, comme un GPS (5 positions par seconde).
    pg.evaluate("""(() => { const p = __dr.game.view().player.at.slice(); let t = performance.now();
      window.__marche = setInterval(() => { const n = performance.now(), d = (n - t) / 1000 * 1.4 * Math.SQRT1_2; t = n; p[0] += d / 75000; p[1] += d / 111000; __dr.teleport(p); }, 200); })()""")
    pg.evaluate("__dr.stage.recenter()")  # le suivi du joueur est rétabli avant la série en marche
    pg.wait_for_timeout(2500)
    j0 = st()['joueur']
    r2 = serie("JOUEUR EN MARCHE (nord-est, 1,4 m/s)", 150, 60)
    j1 = st(); print('déplacement du joueur pendant la série (m) :', round(math.hypot((j1['joueur'][0] - j0[0]) * 75000, (j1['joueur'][1] - j0[1]) * 111000), 1), '| écart centre-joueur :', j1['ecartCentreJoueurM'])
    ok = lambda r: abs(r[1]['zoom'] - r[0]['zoom']) > 0.3 and abs((r[2]['cap'] - r[1]['cap'] + 540) % 360 - 180) > 15 and abs(r[4]['zoom'] - r[2]['zoom']) < 0.05 and abs((r[4]['cap'] - r[3]['cap'] + 540) % 360 - 180) < 3
    print('\nRÉSULTAT gestes immobile :', 'OK' if ok(r1) else 'ÉCHEC', '| gestes en marche :', 'OK' if ok(r2) else 'ÉCHEC', '| centre suit le joueur :', 'OK' if j1['ecartCentreJoueurM'] < 6 else 'ÉCHEC')

    # Zoom à un doigt, joueur EN MARCHE : double appui = +1 cran ; double appui puis glisser (doigt posé) = zoom continu.
    print('\n== ZOOM À UN DOIGT (en marche)')
    gx, gy = cx + 60, cy - 80
    # Les heures des événements sont fixées par le script (appui 40 ms, 90 ms entre les deux appuis) : la machine
    # d'essai est lente (rendu logiciel), l'heure réelle d'envoi ne dirait rien du geste simulé.
    import time
    def tap(x, y, t0=None):
        t0 = t0 or time.time(); touch('touchStart', [(x, y)], t0); touch('touchEnd', [], t0 + 0.04); return t0 + 0.04
    def double_tap(x, y): tap(x, y, tap(x, y) + 0.09)
    def double_drag(dy, n=16):
        t = tap(gx, gy) + 0.09; touch('touchStart', [(gx, gy)], t)
        for i in range(1, n + 1): touch('touchMove', [(gx, gy + dy * i / n)], t + 0.016 * i)
        touch('touchEnd', [], t + 0.016 * n + 0.03)
    pg.evaluate("__dr.stage.recenter()"); pg.wait_for_timeout(1800); z0 = st(); show('départ (recentré)', z0)
    double_tap(gx, gy); pg.wait_for_timeout(1500); z1 = st(); show('double appui', diff(z0, z1))
    double_drag(-220); pg.wait_for_timeout(900); z2 = st(); show('double appui + glisser HAUT 220 px', diff(z1, z2))
    pg.wait_for_timeout(3000); z3 = st(); show('3 s de marche plus tard', {**diff(z2, z3), 'écart': z3['ecartCentreJoueurM']})
    double_drag(140); pg.wait_for_timeout(900); z4 = st(); show('double appui + glisser BAS 140 px', diff(z3, z4))
    pg.wait_for_timeout(3000); z5 = st(); show('3 s de marche plus tard', {**diff(z4, z5), 'écart': z5['ecartCentreJoueurM']})
    okz = 0.7 < z1['zoom'] - z0['zoom'] < 1.2 and z2['zoom'] - z1['zoom'] < -1.5 and abs(z3['zoom'] - z2['zoom']) < 0.05 and z4['zoom'] - z3['zoom'] > 1 and abs(z5['zoom'] - z4['zoom']) < 0.05 and abs(z5['cap'] - z0['cap']) < 25
    print('RÉSULTAT zoom à un doigt :', 'OK' if okz else 'ÉCHEC', '(double appui +1 cran, haut = arrière, bas = avant, tenu pendant la marche)')

    if pg.evaluate("typeof __dr.stage.toggleTilt === 'function'"):
        print('\n== SUITE (nouvelle caméra)')
        pg.evaluate("__dr.stage.recenter()"); pg.wait_for_timeout(6000); s = st(); show('recentrer, puis 6 s de marche NE', s)
        d = abs((s['cap'] - 45 + 540) % 360 - 180); print('caméra derrière le porteur (cap carte ≈ 45°) :', 'OK' if d < 15 else 'ÉCHEC', f'(écart {d:.1f}°)')
        clearInterval = pg.evaluate("clearInterval(window.__marche)"); pg.wait_for_timeout(4000); s2 = st(); show("à l'arrêt 4 s (pas de girouette)", s2)
        print('bascule →', pg.evaluate("__dr.stage.toggleTilt()")); pg.wait_for_timeout(1800); show('vue 2D', st())
        if len(sys.argv) > 2:
            pg.evaluate("__dr.stage.setPaused(true)"); pg.wait_for_timeout(300)
            import base64; open(sys.argv[2], 'wb').write(base64.b64decode(cdp.send('Page.captureScreenshot', {'format': 'png'})['data'])); pg.evaluate("__dr.stage.setPaused(false)")
        print('bascule →', pg.evaluate("__dr.stage.toggleTilt()")); pg.wait_for_timeout(1800); show('vue 3D', st())
        gesture(swipe(0, 120)); pg.wait_for_timeout(700); show('glisser vertical (inclinaison)', st())
        # Toucher du sol : en mode simulé, le porteur doit se mettre en route vers le point touché.
        a = st(); gesture([[(cx + 60, cy - 80)], [(cx + 60, cy - 80)]], 60); pg.wait_for_timeout(2500); e = st()
        print('toucher du sol → le joueur a avancé de (m) :', round(math.hypot((e['joueur'][0] - a['joueur'][0]) * 75000, (e['joueur'][1] - a['joueur'][1]) * 111000), 1))
        # Double appui sur le sol, joueur arrêté : il zoome et ne doit PAS envoyer le porteur en marche.
        pg.wait_for_timeout(6000); a = st(); double_tap(cx - 70, cy - 60); pg.wait_for_timeout(2500); e = st()
        d = math.hypot((e['joueur'][0] - a['joueur'][0]) * 75000, (e['joueur'][1] - a['joueur'][1]) * 111000)
        print('double appui sur le sol → dZoom', round(e['zoom'] - a['zoom'], 2), '| joueur déplacé de (m) :', round(d, 1), '→', 'OK' if d < 1.5 and e['zoom'] - a['zoom'] > 0.5 else 'ÉCHEC')
    print('erreurs', errs[:6]); b.close()
