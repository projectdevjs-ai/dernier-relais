// Démo de l'interface seule, sans carte ni logique : faux état de jeu, actions factices.
// Paramètres d'URL : ?ecran=abri|abri0|abri4|abri5|colis|colis2|note|noteB|competences|contrats|carnet|reglages|fiche|marche|vide|aide|toasts
// puis &ambiance=clair et &t=9 (instant de départ du faux état : à 9, le scanner est prêt).
import type { ActionResult, Ambiance, DeliveryResult, GameActions, GameView, HudEvents } from '../game/api';
import type { LngLat } from '../core/geo';
import { mockView } from '../game/mock';
import { Hud } from './hud';

const q = new URLSearchParams(location.search);
const ecran = q.get('ecran') ?? '';
const ambiance: Ambiance = q.get('ambiance') === 'clair' ? 'clair' : 'crépuscule';
document.body.classList.toggle('clair', ambiance === 'clair');

// L'aide de première ouverture ne s'affiche que sur ?ecran=aide, pour ne pas gêner les autres captures.
try {
  if (ecran === 'aide') localStorage.removeItem('dernier-relais.aide.v1');
  else localStorage.setItem('dernier-relais.aide.v1', '1');
} catch { /* stockage indisponible */ }

const centre: LngLat = [-1.5761, 47.1822];
const log = (...a: unknown[]): void => console.info('[démo]', ...a);
const ok: ActionResult = { ok: true };
let t = Number(q.get('t') ?? 0) || 0; // &t=9 : scanner prêt

const result = (over: Partial<DeliveryResult>): DeliveryResult => ({
  orderId: 'o3', orderName: 'Médicaments', shelterId: 's2', shelterName: 'Pharmacie des Couëts', npc: 'agathe',
  grade: 'S', condition: 0.96, onTime: true, points: 264, xp: 80,
  notes: ['État 96 %', 'Dans les temps', 'Sous la pluie', 'Colis fragile'],
  starsBefore: 0, starsAfter: 1, unlock: 'Rencontre avec Agathe, qui tient l’abri', levelUp: true, ...over,
});

const actions: GameActions = {
  scan() { log('scan'); t = Math.floor(t / 12) * 12; setTimeout(() => hud.handle({ type: 'scan', found: 3 }), 300); return ok; },
  pickup(id) {
    log('pickup', id);
    if (id === 'o1') return { ok: false, why: 'Trop loin pour ramasser ce colis' };
    const order = view().orders.find((o) => o.id === id);
    if (order) hud.handle({ type: 'pickup', order });
    return ok;
  },
  drop(id) { log('drop', id); hud.handle({ type: 'drop', orderId: id }); return ok; },
  deliver(id) { log('deliver', id); hud.handle({ type: 'delivery', result: result({ shelterId: id }) }); return ok; },
  steady() { log('steady'); },
  learn(id) { log('learn', id); return id === 'souffle' ? { ok: false, why: 'Apprends d’abord une compétence d’endurance de base' } : ok; },
  claim(id) { log('claim', id); const contract = view().contracts.find((c) => c.id === id); if (contract) hud.handle({ type: 'contract', contract: { ...contract, claimed: true } }); return ok; },  openCache(id) { log('openCache', id); hud.handle({ type: 'cache', cacheId: id, points: 55, xp: 30, skillPoint: true }); return ok; },
  talk(id) { log('talk', id); hud.handle({ type: 'wanderer', id, name: 'Lina', line: '« Il y a une cache à 120 m au nord-est. Je te la laisse. »', gift: 'cache' }); return ok; },
  startJam(id) { log('startJam', id); const jam = view().jams?.find((j) => j.id === id); if (jam) hud.handle({ type: 'jam', phase: 'début', jam: { ...jam, state: 'en cours', minutesLeft: jam.minutes } }); return ok; },
  inspect(id) { log('inspect', id); known.add(id); const order = view().orders.find((o) => o.id === id); if (order) hud.handle({ type: 'inspect', order, xp: 5 }); return ok; },
  strap(id, quality) { log('strap', id, quality); strapped.add(id); hud.handle({ type: 'strap', orderId: id, quality, xp: quality >= 1 ? 5 : 0 }); return ok; },
  proof(id) { log('proof', id); hud.handle({ type: 'proof', orderId: id, points: 26 }); return ok; },
};
/** Colis écoutés et colis arrimés pendant la démo. */
const known = new Set<string>(), strapped = new Set<string>();
const events: HudEvents = {
  actions,
  onUseGps: () => log('GPS'),
  onRecenter: () => log('recentrer'),
  onAmbiance: (a) => { log('ambiance', a); document.body.classList.toggle('clair', a === 'clair'); },
  onGoto: (at, label) => log('aller à', label, at),
};

/** Le faux état, avec quelques variantes selon l'écran demandé. */
function view(): GameView {
  const v = mockView(centre, t);
  if (ecran === 'marche') { // rien à livrer sur place : la fiche montre le colis porté le plus urgent
    for (const s of v.shelters) s.inRange = false;
    v.shelters[1].distanceM = 140; v.orders[2].distanceM = 140;
    v.player.balance = 0.72; v.weather.night = true;
  }
  if (ecran === 'vide') { v.orders = []; v.shelters = []; v.player.carriedKg = 0; v.player.mode = 'gps'; v.weather.kind = 'clair'; v.player.stamina = 0.18; }
  return v;
}

const hud = new Hud(document.getElementById('hud')!, events, { ambiance });
hud.render(view());
setInterval(() => { t += 0.5; hud.render(view()); }, 500);

switch (ecran) {
  case 'abri': hud.openShelter('s1'); break;
  case 'abri0': hud.openShelter('s2'); break;
  case 'abri5': hud.openShelter('s3'); break;
  case 'abri4': hud.openShelter('s4'); break;
  case 'colis': hud.openOrder('o1'); break;
  case 'colis2': hud.openOrder('o3'); break;
  case 'note':
    hud.handle({ type: 'delivery', result: result({}) });
    hud.handle({ type: 'delivery', result: result({ orderId: 'o4', orderName: 'Outils', shelterName: 'Mairie annexe', npc: 'kenji', grade: 'C', points: 95, xp: 30, notes: ['État 97 %', 'En retard de 3 min'], starsBefore: 1, starsAfter: 1, unlock: null, levelUp: false, onTime: false }) });
    break;
  case 'noteB':
    hud.handle({ type: 'delivery', result: result({ grade: 'B', points: 168, xp: 55, notes: ['État 81 %', 'Dans les temps'], starsBefore: 2, starsAfter: 2, unlock: null, levelUp: false, npc: 'mara', shelterName: 'École maternelle Le Corbusier', orderName: 'Pièces de pompe' }) });
    break;
  case 'competences': hud.openPorter('competences'); break;
  case 'contrats': hud.openPorter('contrats'); break;
  case 'carnet': hud.openPorter('carnet'); break;
  case 'reglages': hud.openPorter('reglages'); break;
  case 'fiche': hud.setSheetExpanded(true); break;
  case 'toasts':
    setTimeout(() => {
      hud.handle({ type: 'scan', found: 3 });
      hud.handle({ type: 'toast', text: 'Trop loin pour ramasser ce colis', tone: 'warn' });
      hud.handle({ type: 'levelUp', level: 5 });
    }, 1200);
    break;
}
