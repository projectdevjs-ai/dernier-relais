# Parcours complet du premier lancement, vérifié par le DOM (aucune capture pendant qu'une scène 3D tourne) :
# écran de départ, prologue, Passer, labo en trois postes (cartes, Passeur, quartiers) et leurs boutons, chambre, « Partir », carte, puis second lancement.
#   python3 scripts/flow.py http://localhost:4201/ [dossier_de_captures]
# L'adresse reçoit « ?leger » : rendu 3D allégé, sinon Chrome sans carte graphique ne suit pas.
# Code de sortie 0 si tout est bon, 1 sinon. Chaque étape a un délai maximal : le script ne se bloque pas.
import base64, os, sys, time
from playwright.sync_api import sync_playwright

url = sys.argv[1].split('?')[0]
out = sys.argv[2] if len(sys.argv) > 2 else None
bad = []; errs = []; http = []

def check(name, ok, detail=''):
    print(('  ok    ' if ok else '  ÉCHEC ') + name + (f' — {detail}' if detail and not ok else ''), flush=True)
    if not ok: bad.append(name)

def wait(pg, js, ms=30000):
    """Attend qu'une expression devienne vraie ; renvoie False au bout du délai."""
    t = time.time()
    while (time.time() - t) * 1000 < ms:
        try:
            if pg.evaluate(js): return True
        except Exception: pass
        pg.wait_for_timeout(250)
    return False

def shot(pg, name):
    """Capture par CDP, seulement quand le rendu est figé. Sans dossier de sortie : rien."""
    if not out: return
    try:
        cdp = pg.context.new_cdp_session(pg)
        data = cdp.send('Page.captureScreenshot', {'format': 'png'})['data']
        with open(os.path.join(out, name), 'wb') as f: f.write(base64.b64decode(data))
        cdp.detach()
    except Exception as e: print('  capture impossible', name, str(e)[:80])

SHOWN = "(s => [...document.querySelectorAll(s)].filter(e => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > 0.05; }).length)"
MODALS = SHOWN + "('#hud .dr-modal')"
# Éléments du HUD de la carte qui ne doivent jamais se voir par-dessus le labo.
MAP_HUD = SHOWN + "('#hud .dr-top, #hud .dr-fabs, #hud .dr-sheet, #hud .st-goal, #hud .st-radio, #hud .dr-help, #hud .dr-toast, #hud .dr-near')"
STATE = "({ lab: document.body.classList.contains('dr-in-lab'), labShown: !!document.querySelector('.s3-lab') && !document.querySelector('.s3-lab').hidden, prologue: !!document.querySelector('.s3-prologue'), paused: __dr.stage.paused === true })"
# Le labo est un hall en trois postes. Bouton d'action (data-act) -> poste (rang), lieu, titres attendus du panneau ouvert.
ACTIONS = [('network', 0, 'hall', ['Ton nom de porteur', 'Réseau']), ('contracts', 0, 'hall', ['Porteur']), ('skills', 1, 'exo', ['Porteur']),
           ('journal', 2, 'hall', ['Porteur']), ('journal', 2, 'room', ['Porteur']), ('tree', 2, 'room', ['Porteur'])]
LAB_READY = "!!document.querySelector('.lab-panel .lab-btn') && document.querySelectorAll('.lab-dot').length === 3 && getComputedStyle(document.querySelector('.s3-lab .s3-veil')).opacity < 0.05"
POSTE = "document.querySelector('.s3-lab').dataset.poste"
LIEU = "document.querySelector('.s3-lab').dataset.lieu"
TITLE = "(document.querySelector('.lab-panel .lab-card-title') || {}).textContent"

def lab_goto(pg, rang, lieu):
    """Amène le labo au poste voulu (points de pagination), puis dans l'atelier ou la chambre si demandé."""
    if pg.evaluate(LIEU) == lieu and lieu != 'hall' and pg.evaluate("[...document.querySelectorAll('.lab-dot')].length") == 0: return True  # déjà dans l'atelier ou la chambre
    if pg.evaluate(LIEU) != 'hall':
        pg.evaluate("document.querySelector('.lab-panel [data-act=back]')?.click()")
        wait(pg, LIEU + " === 'hall'", 4000); pg.wait_for_timeout(500)
    pg.evaluate(f"document.querySelectorAll('.lab-dot')[{rang}].click()"); pg.wait_for_timeout(300)
    if lieu == 'exo': pg.evaluate("document.querySelector('.lab-panel [data-act=exo]').click()")
    if lieu == 'room': pg.evaluate("document.querySelector('.lab-panel [data-act=enter]').click()")
    return wait(pg, LIEU + f" === '{lieu}'", 5000)

def panel_title(pg):
    return pg.evaluate("(() => { const m = [...document.querySelectorAll('#hud .dr-modal')].find(e => !e.hidden); return m ? (m.querySelector('[role=dialog]')?.getAttribute('aria-label') || '') : null; })()")

def close_panels(pg):
    for _ in range(4):
        if not pg.evaluate(MODALS): return True
        pg.evaluate("(() => { const m = [...document.querySelectorAll('#hud .dr-modal')].filter(e => !e.hidden).pop(); m?.querySelector('.dr-panel-close')?.click(); })()")
        pg.wait_for_timeout(350)
    return not pg.evaluate(MODALS)

with sync_playwright() as p:
    px = os.environ.get('HTTPS_PROXY')
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], proxy={'server': px, 'bypass': 'localhost'} if px else None)
    c = b.new_context(viewport={'width': 412, 'height': 880}, device_scale_factor=1, ignore_https_errors=True, has_touch=True)
    # Compte les demandes de position et les répliques dites, pour vérifier quand elles arrivent.
    c.add_init_script("""window.__geo = 0; window.__says = [];
      try { const g = navigator.geolocation, w = g.watchPosition.bind(g), o = g.getCurrentPosition.bind(g);
        g.watchPosition = (...a) => { window.__geo++; return w(...a); }; g.getCurrentPosition = (...a) => { window.__geo++; return o(...a); }; } catch {}
      const play = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { window.__says.push(this.src || ''); return play.call(this); };""")
    pg = c.new_page(); pg.set_default_timeout(10000)
    pg.on('pageerror', lambda e: errs.append('ERREUR ' + str(e)[:300]))
    pg.on('console', lambda m: errs.append(m.text[:200]) if m.type == 'error' and 'status of 4' not in m.text else None)
    pg.on('response', lambda r: http.append(r.status) if r.status >= 400 and 'supabase' in r.url else None)
    try:
        print('1. Premier lancement', flush=True)
        pg.goto(url + '?leger')
        check('écran de départ affiché', wait(pg, "!!document.querySelector('#splash')", 20000))
        check('carte en pause derrière l’écran de départ', pg.evaluate("__dr.stage.paused === true"))
        check('GPS pas encore demandé', pg.evaluate("window.__geo") == 0)
        shot(pg, 'flow-1-depart.png')
        pg.click('#splash')
        check('prologue lancé', wait(pg, "!!document.querySelector('.s3-prologue')", 5000))
        check('bouton Passer visible', wait(pg, "(() => { const s = document.querySelector('.pl-skip'); return !!s && !s.hidden; })()", 60000))
        check('aucun message radio pendant le prologue', pg.evaluate("(() => { const r = document.querySelector('.st-radio'); return !r || r.hidden; })()"))
        pg.click('.pl-skip')
        check('prologue terminé après Passer', wait(pg, "!document.querySelector('.s3-prologue')", 6000))
        s = pg.evaluate(STATE)
        check('labo affiché aussitôt, sans éclair de carte', s['lab'] and s['labShown'] and s['paused'], str(s))
        check('labo prêt (panneau du poste et trois points)', wait(pg, LAB_READY, 90000))
        check('première visite : arrivée à la salle des cartes', pg.evaluate(POSTE) == 'cartes' and pg.evaluate(TITLE) == 'Salle des cartes', str(pg.evaluate(TITLE)))
        said = pg.evaluate("window.__says.length"); pg.wait_for_timeout(16000)
        check('la narration du prologue s’arrête après Passer', pg.evaluate("window.__says.length") == said, f'{said} -> ' + str(pg.evaluate("window.__says.slice(-3)")))
        check('aucun élément du HUD de la carte sur le labo', pg.evaluate(MAP_HUD) == 0, str(pg.evaluate("[...document.querySelectorAll('#hud>*')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.className)")))
        check('GPS toujours pas demandé au labo', pg.evaluate("window.__geo") == 0)

        print('2. Les trois postes du labo', flush=True)
        pg.wait_for_timeout(1500)
        pg.evaluate("document.querySelector('.lab-nav.is-next').click()"); pg.wait_for_timeout(400)
        check('suivant : Le Passeur', pg.evaluate(TITLE) == 'Le Passeur', str(pg.evaluate(TITLE)))
        pg.evaluate("document.querySelector('.lab-nav.is-next').click()"); pg.wait_for_timeout(400)
        check('suivant : Quartiers', pg.evaluate(TITLE) == 'Quartiers' and pg.evaluate("document.querySelector('.lab-nav.is-next').hidden"), str(pg.evaluate(TITLE)))
        pg.evaluate("document.querySelector('.lab-nav.is-prev').click()"); pg.wait_for_timeout(400)
        check('précédent : Le Passeur', pg.evaluate(TITLE) == 'Le Passeur')
        check('« Partir » présent à chaque poste', all(pg.evaluate(f"(document.querySelectorAll('.lab-dot')[{i}].click(), !document.querySelector('.lab-go').hidden)") for i in range(3)))
        pg.evaluate("document.querySelector('.lab-panel [data-act=talk]').click()"); pg.wait_for_timeout(400)
        check('parler : la bulle du scientifique s’ouvre', pg.evaluate("!document.querySelector('.lab-bubble').hidden && document.querySelector('.lab-bubble p').textContent.length > 10"))
        for act, rang, lieu, titres in ACTIONS:
            nom = f'{act} ({["cartes", "passeur", "quartiers"][rang]}, {lieu})'
            ok = lab_goto(pg, rang, lieu) and wait(pg, f"!!document.querySelector('.lab-panel [data-act={act}]')", 4000)
            check(f'{nom} : bouton présent', ok)
            if not ok: continue
            pg.evaluate(f"document.querySelector('.lab-panel [data-act={act}]').click()"); pg.wait_for_timeout(500)
            t = panel_title(pg)
            check(f'{nom} : panneau « {t} » ouvert', t is not None and any(x in t for x in titres), str(t))
            top = pg.evaluate("(() => { const e = document.elementFromPoint(innerWidth / 2, innerHeight * 0.6); return !!e && !!e.closest('#hud .dr-modal'); })()")
            check(f'{nom} : panneau par-dessus le labo', top)
            if act == 'network' and t and 'nom' in t:
                pg.evaluate("document.querySelector('.dr-pseudo .dr-btn')?.click()"); pg.wait_for_timeout(1500)
                t2 = panel_title(pg)
                check('network : carte du réseau après le choix du nom', t2 is not None and 'nom' not in t2, str(t2))
            if act == 'skills':
                # Sans point à dépenser, « Apprendre » est refusé : le joueur doit voir pourquoi, même au labo.
                pg.evaluate("[...document.querySelectorAll('#hud .dr-modal:not([hidden]) button')].find(b => /apprendre/i.test(b.innerText) && !b.disabled)?.click()"); pg.wait_for_timeout(400)
                n = pg.evaluate(SHOWN + "('#hud .dr-toast')")
                check('skills : le refus d’une action est expliqué par un message', n >= 1 or pg.evaluate("![...document.querySelectorAll('#hud .dr-modal:not([hidden]) button')].some(b => /apprendre/i.test(b.innerText) && !b.disabled)"))
                pg.wait_for_timeout(3200)
            check(f'{nom} : panneau refermé', close_panels(pg))
            s = pg.evaluate(STATE)
            check(f'{nom} : retour au labo intact', s['lab'] and s['labShown'] and s['paused'] and pg.evaluate(MAP_HUD) == 0, str(s))
        check('chambre : pas de « Partir », retour possible', pg.evaluate(LIEU) == 'room' and pg.evaluate("document.querySelector('.lab-go').hidden"))
        lab_goto(pg, 0, 'hall')
        check('retour à la salle des cartes', pg.evaluate(TITLE) == 'Salle des cartes', str(pg.evaluate(TITLE)))

        print('3. Partir', flush=True)
        pg.evaluate("document.querySelector('.lab-go').click()")
        check('arrivée sur la carte', wait(pg, "!document.body.classList.contains('dr-in-lab')", 30000))
        s = pg.evaluate(STATE)
        check('labo caché, carte reprise', not s['labShown'] and not s['paused'], str(s))
        check('HUD complet', pg.evaluate(SHOWN + "('#hud .dr-top')") == 1 and pg.evaluate(SHOWN + "('#hud .dr-scan')") == 1 and pg.evaluate(SHOWN + "('#hud .dr-sheet')") >= 1)
        check('GPS demandé au départ seulement', wait(pg, "window.__geo >= 1", 3000))
        check('carte dessinée', wait(pg, "!!document.querySelector('#stage canvas') && document.querySelector('#stage canvas').width > 0", 5000))
        pg.wait_for_timeout(1500)
        pg.evaluate("__dr.stage.setPaused(true)"); pg.wait_for_timeout(400); shot(pg, 'flow-2-carte.png'); pg.evaluate("__dr.stage.setPaused(false)")

        print('3 bis. Téléphone couché', flush=True)
        ROT = "getComputedStyle(document.querySelector('#rotate')).display !== 'none'"
        check('pas de demande de rotation à la verticale', not pg.evaluate(ROT))
        pg.set_viewport_size({'width': 880, 'height': 412}); pg.wait_for_timeout(400)
        check('couché : le jeu demande de tourner le téléphone', pg.evaluate(ROT) and pg.evaluate("document.elementFromPoint(440, 200)?.closest('#rotate') !== null"))
        pg.set_viewport_size({'width': 412, 'height': 880}); pg.wait_for_timeout(400)
        check('remis droit : la demande disparaît', not pg.evaluate(ROT))

        print('4. Second lancement', flush=True)
        pg.goto(url + '?leger')
        check('pas d’écran de départ ni de prologue', wait(pg, "document.body.classList.contains('dr-in-lab')", 20000) and pg.evaluate("!document.querySelector('#splash') && !document.querySelector('.s3-prologue')"))
        check('labo prêt', wait(pg, LAB_READY, 90000))
        check('aucun élément du HUD de la carte sur le labo', pg.evaluate(MAP_HUD) == 0)
    except Exception as e:
        check('parcours interrompu', False, str(e)[:300])
    check('aucune erreur JavaScript', not errs, str(errs[:6]))
    check('requêtes refusées par le serveur rares', len(http) <= 4, str(http))
    b.close()
print('RÉSULTAT :', 'tout est bon' if not bad else f'{len(bad)} défaut(s) : ' + ' ; '.join(bad))
sys.exit(1 if bad else 0)
