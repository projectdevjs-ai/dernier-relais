// Démo de l'interface seule, sans carte ni logique : faux état de jeu, actions factices.
// Paramètres d'URL : ?ecran=abri|abri0|abri4|abri5|colis|colis2|note|noteB|competences|contrats|carnet|reglages|fiche|marche|vide|aide|toasts
// Systèmes secondaires : ?ecran=special|inconnu|perdu|fiche2|cache|rodeur|lot|lot2|front|front2|arrimage|note2|preuve|preuve2|toasts2
// Jeu en ligne (faux serveur en mémoire, vrai code réseau) : ?ecran=relais|abri|pseudo|reglages|reseau, puis &horsligne=1 (réseau coupé),
// &installe=1 (pas de bouton d'installation).
// puis &ambiance=clair et &t=9 (instant de départ du faux état : à 9, le scanner est prêt).
import type { ActionResult, Ambiance, DeliveryResult, GameActions, GameEvent, GameView, HudEvents, OrderView, RelayCrate, RelayGiveResult } from '../game/api';
import type { LngLat } from '../core/geo';
import { type MockEvents, mockView, withEvents } from '../game/mock';
import { NetClient } from '../net/client';
import { FakeServer, installGameRpcs } from '../net/fake';
import { OnlineLink } from '../net/link';
import { Network } from '../net/network';
import { FrancePanel } from './france';
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

// ----- Faux réseau : le vrai code de src/net, branché sur un serveur en mémoire -----
const server = new FakeServer();
installGameRpcs(server);
server.down = q.get('horsligne') === '1';
const dest = (id: string): Pick<RelayCrate, 'destId' | 'destName' | 'destAt'> => { const s = mockView(centre, 0).shelters.find((x) => x.id === id)!; return { destId: s.id, destName: s.name, destAt: s.at }; };
server.tables.shelters = [
  { id: 's1', level: 2, points: 4200 }, { id: 's2', level: 0, points: 250 }, { id: 's3', level: 5, points: 71000 }, { id: 's4', level: 1, points: 900 },
];
const waiting = (id: string, at: string, payload: RelayCrate, carriers: string[], min: number): Record<string, unknown> =>
  ({ id, payload, dest_shelter: payload.destId, at_shelter: at, last_shelter: at, carrier: null, carriers, state: 'waiting', created_at: new Date(Date.UTC(2026, 10, 11, 9, min)).toISOString() });
server.tables.relays = [
  waiting('r1', 's2', { name: 'Pièces de radio', crate: 'alu', weightKg: 3, fragile: true, reward: 110, ...dest('s3') }, ['u-7'], 1),
  waiting('r2', 's2', { name: 'Farine', crate: 'carton', weightKg: 8, fragile: false, reward: 85, ...dest('s1') }, ['u-4', 'u-9'], 2),
  waiting('r3', 's2', { name: 'Lampes', crate: 'plastique', weightKg: 2, fragile: false, reward: 60, ...dest('s4') }, ['u-1'], 3),
  waiting('r4', 's1', { name: 'Savon', crate: 'carton', weightKg: 2, fragile: false, reward: 50, ...dest('s3') }, ['u-5'], 4),
];
server.tables.relay_rewards = [{ id: 1, relay_id: 'r0', player: 'u-1', points: 72, hops: 3, parcel: 'Semences', created_at: '2026-11-11T08:00:00Z', claimed_at: null }];
const net = new Network(new NetClient({ create: () => server.db() }), { storage: null });

/** Ce que la démo retient de la chaîne de relais : colis confiés (sortis du sac) et colis pris. */
const given = new Set<string>(), taken: OrderView[] = [];
const listeners = new Set<(e: GameEvent) => void>();
const emit = (e: GameEvent): void => { hud.handle(e); for (const fn of listeners) fn(e); };
const demoGame = {
  on(fn: (e: GameEvent) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  giveToRelay(orderId: string, shelterId?: string, dryRun = false): RelayGiveResult {
    const v = view(), o = v.orders.find((x) => x.id === orderId && x.state === 'porté'), s = v.shelters.find((x) => x.id === shelterId);
    if (!o || !s) return { ok: false, why: 'Ce colis n’est pas dans le sac.' };
    if (!s.inRange) return { ok: false, why: 'Trop loin de l’abri.' };
    const points = Math.round(o.reward * 0.4 * 0.55);
    if (!dryRun) { given.add(o.id); emit({ type: 'toast', text: `Colis laissé en relais : +${points} points`, tone: 'good' }); }
    return { ok: true, shelterId: s.id, points, parcel: { name: o.name, crate: o.crate, weightKg: o.weightKg, fragile: o.fragile, reward: o.reward, destId: o.destId, destName: o.destName, destAt: o.destAt, condition: o.condition } };
  },
  takeFromRelay(relay: { id: string; parcel: RelayCrate }, dryRun = false): ActionResult {
    const p = relay.parcel;
    if (view().player.carriedKg + p.weightKg > view().player.capacityKg) return { ok: false, why: 'Sac trop lourd : pose d’abord un colis.' };
    if (dryRun) return ok;
    const order: OrderView = { id: `relais|${relay.id}`, name: p.name, crate: p.crate, weightKg: p.weightKg, fragile: p.fragile, at: centre, destId: p.destId, destName: p.destName, destAt: p.destAt, state: 'porté', condition: p.condition ?? 1, minutesLeft: null, reward: p.reward, distanceM: 320, inRange: false, inspected: true, relay: { id: relay.id } };
    taken.push(order);
    emit({ type: 'pickup', order });
    return ok;
  },
  credit(points: number, reason?: string): void { log('crédit', points); if (reason) emit({ type: 'toast', text: reason, tone: 'good' }); },
};
actions.giveToRelay = demoGame.giveToRelay;
actions.takeFromRelay = demoGame.takeFromRelay;
const link = new OnlineLink(net, demoGame, { toast: (text, tone) => hud.handle({ type: 'toast', text, tone }), refresh: () => hud.refreshOnline() },
  { storage: null, shelterName: (id) => view().shelters.find((s) => s.id === id)?.name ?? null });
let france: FrancePanel | null = null;

const events: HudEvents = {
  actions,
  onUseGps: () => log('GPS'),
  onRecenter: () => log('recentrer'),
  onAmbiance: (a) => { log('ambiance', a); document.body.classList.toggle('clair', a === 'clair'); },
  onGoto: (at, label) => log('aller à', label, at),
  onNetwork: () => { log('réseau'); france?.open(); },
  online: link.hud,
  pseudo: link.pseudo,
  onSound: (on) => log('son', on),
  onVoices: (on) => log('voix', on),
  onHaptics: (on) => log('vibrations', on),
  onVolume: (v) => log('volume', v),
  onReplayIntro: () => log('prologue'),
  onLab: () => log('labo'),
  onInstall: () => { log('installer'); hud.setCanInstall(false); },
  onUi: (kind) => log('son d’interface', kind),
};

/** Le faux état, avec quelques variantes selon l'écran demandé. */
function view(): GameView {
  const v = mockView(centre, t);
  if (ecran === 'marche') { // rien à livrer sur place : la fiche montre le colis porté le plus urgent
    for (const s of v.shelters) s.inRange = false;
    v.shelters[1].distanceM = 140; v.orders[2].distanceM = 140;
    v.player.balance = 0.72; v.weather.night = true;
  }
  const x = EXTRAS[ecran];
  if (x) {
    withEvents(v, x, t);
    for (const o of v.orders) {
      if (known.has(o.id)) { o.inspected = true; o.canInspect = false; if (o.special) { o.special = { ...o.special, known: true }; o.name = o.special.label; } }
      if (strapped.has(o.id)) { o.strap = 1; o.strapLeftS = 0; }
    }
    if (ecran === 'arrimage' || ecran === 'cache' || ecran === 'rodeur' || ecran === 'lot') for (const s of v.shelters) if (!(ecran === 'lot' && s.id === 's2')) s.inRange = false;
  }
  if (ecran === 'vide') { v.orders = []; v.shelters = []; v.player.carriedKg = 0; v.player.mode = 'gps'; v.weather.kind = 'clair'; v.player.stamina = 0.18; }
  // Chaîne de relais : les colis confiés ont quitté le sac, les colis pris y sont entrés.
  if (given.size) { v.orders = v.orders.filter((o) => !given.has(o.id)); for (const s of v.shelters) s.deliverable = s.deliverable.filter((id) => !given.has(id)); }
  for (const o of taken) { v.orders.unshift(o); v.shelters.find((s) => s.id === o.destId)?.deliverable.push(o.id); }
  if (given.size || taken.length) v.player.carriedKg = v.orders.filter((o) => o.state === 'porté').reduce((kg, o) => kg + o.weightKg, 0);
  return v;
}

/** Éléments ajoutés au faux état pour chaque écran des systèmes secondaires. */
const EXTRAS: Record<string, MockEvents> = {
  special: { special: 'ruche' }, inconnu: { special: 'inconnu' }, perdu: { lost: true },
  fiche2: { special: 'cryo', lost: true, carriedSpecial: 'boitenoire' },
  cache: { cache: 'proche', front: true }, rodeur: { wanderer: 'proche' }, lot: { jam: 'proche' }, lot2: { jam: 'en cours', front: 'dedans' },
  front: { front: true }, front2: { front: 'dedans' }, arrimage: { strap: true }, toasts2: {},
};

// ?ecran=preuve : fausse caméra (un dessin animé dans un canvas), pour montrer le viseur sans téléphone.
if (ecran === 'preuve' || ecran === 'preuve2') {
  const c = document.createElement('canvas'); c.width = 480; c.height = 640;
  const g = c.getContext('2d')!;
  const draw = (): void => {
    g.fillStyle = '#6f8fa6'; g.fillRect(0, 0, 480, 640);
    g.fillStyle = '#c9b48a'; g.fillRect(90, 220, 300, 420);
    g.fillStyle = '#5a4630'; g.fillRect(200, 430, 80, 210);
    g.fillStyle = '#e8a24a'; g.fillRect(120, 270, 70, 60); g.fillRect(290, 270, 70, 60);
    g.fillStyle = '#3d5a45'; g.fillRect(0, 600, 480, 40);
    requestAnimationFrame(draw);
  };
  draw();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: async () => c.captureStream(15),
    enumerateDevices: async () => [{ kind: 'videoinput' }],
  } });
}

const hud = new Hud(document.getElementById('hud')!, events, { ambiance, settings: { sound: true, voices: true, haptics: false, volume: 0.7, canInstall: q.get('installe') !== '1' } });
france = new FrancePanel(document.getElementById('hud')!, net);
link.start();
net.start();
hud.render(view());
setInterval(() => { t += 0.5; hud.render(view()); }, 500);

switch (ecran) {
  case 'abri': hud.openShelter('s1'); break;
  case 'relais': hud.openShelter('s2'); setTimeout(() => { document.querySelector('.dr-modal:not([hidden]) .dr-panel-body')!.scrollTop = Number(q.get('bas') ?? 400); }, 1500); break;
  case 'pseudo': case 'reseau': setTimeout(() => hud.openNetwork(), 800); break;
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
  case 'reglages': hud.openPorter('reglages'); if (q.get('bas')) setTimeout(() => { document.querySelector('.dr-modal:not([hidden]) .dr-panel-body')!.scrollTop = Number(q.get('bas')); }, 600); break;
  case 'fiche': hud.setSheetExpanded(true); break;
  case 'special': case 'inconnu': hud.openOrder('o2'); break;
  case 'perdu': hud.openOrder('o1'); break;
  case 'fiche2': hud.setSheetExpanded(true); break;
  case 'note2':
    hud.handle({ type: 'delivery', result: result({ orderName: 'Ruche vivante', special: 'ruche', grade: 'A', points: 465, xp: 250, notes: ['État 93 %', 'À travers le front', 'Colis spécial'], starsBefore: 2, starsAfter: 2, unlock: null, levelUp: false, npc: 'mara', shelterName: 'École maternelle Le Corbusier', proofBonus: 47 }) });
    break;
  case 'preuve': case 'preuve2':
    hud.handle({ type: 'delivery', result: result({ grade: 'A', points: 264, proofBonus: 26, starsBefore: 2, starsAfter: 2, unlock: null, levelUp: false }) });
    // Sans doigt pour toucher : la démo ouvre le viseur, puis (preuve2) déclenche.
    setTimeout(() => document.querySelector<HTMLButtonElement>('.dr-proof-btn')?.click(), 1500);
    if (ecran === 'preuve2') setTimeout(() => document.querySelector<HTMLButtonElement>('.dr-cam-shutter')?.click(), 2600);
    break;
  case 'toasts2':
    setTimeout(() => {
      hud.handle({ type: 'scan', found: 0, caches: 1 });
      hud.handle({ type: 'wanderer', id: 'w1', name: 'Lina', line: '« Il y a une cache à 100 m au nord-est. Je te la laisse. »', gift: 'cache' });
      hud.handle({ type: 'front', phase: 'approche', etaS: 170 });
    }, 1200);
    break;
  case 'toasts':
    setTimeout(() => {
      hud.handle({ type: 'scan', found: 3 });
      hud.handle({ type: 'toast', text: 'Trop loin pour ramasser ce colis', tone: 'warn' });
      hud.handle({ type: 'levelUp', level: 5 });
    }, 1200);
    break;
}
