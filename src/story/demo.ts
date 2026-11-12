// Démo de l'histoire seule : fond neutre, calque .dr-hud, faux événements de jeu.
// Paramètres d'URL : ?etat=objectif|replie|radio|radio2|chapitre|journal|fin  puis &ambiance=clair
// Sans paramètre : déroulé automatique du chapitre 1, une étape toutes les quelques secondes.
import type { DeliveryResult, GameEvent, GameView } from '../game/api';
import { mockView } from '../game/mock';
import '../ui/hud.css';
import { h } from '../ui/dom';
import { Toasts } from '../ui/toasts';
import { Story } from './story';
import { StoryUi } from './ui';

const q = new URLSearchParams(location.search);
const etat = q.get('etat') ?? '';
const root = document.getElementById('hud')!;
if (q.get('ambiance') === 'clair') { root.dataset.ambiance = 'clair'; document.body.classList.add('clair'); }
try { localStorage.setItem('dernier-relais/histoire-replie', etat === 'replie' ? '1' : '0'); } catch { /* stockage indisponible */ }

// Faux HUD : les deux rangées du haut et le scanner, pour juger les emplacements.
const ghost = (css: string): HTMLElement => { const el = h('div', 'dr-surface'); el.style.cssText = `position:absolute;border-radius:14px;opacity:.75;${css}`; return el; };
root.append(
  ghost('top:8px;left:8px;width:158px;height:48px'), ghost('top:8px;right:8px;width:150px;height:48px'),
  ghost('top:66px;left:8px;width:160px;height:36px;border-radius:18px'), ghost('top:70px;right:8px;width:96px;height:28px;border-radius:14px'),
  ghost('right:10px;bottom:84px;width:80px;height:80px;border-radius:50%'), ghost('left:8px;right:8px;bottom:8px;height:64px;border-radius:18px'),
);
const toasts = new Toasts(root);

// Horloge factice : la démo avance le temps elle-même pour vider la file des messages.
let clock = 0;
const story = new Story({ storage: null, now: () => clock });
const ui = new StoryUi(root, story, { onVoice: (who, text) => console.info('[voix]', who, text) });

let linked = 0, stars = 1, deliveries = 0, km = 0.4;
function view(): GameView {
  const v = mockView();
  v.shelters.forEach((s, i) => { s.stars = i < linked ? stars : 0; });
  v.orders = [];
  v.player.deliveries = deliveries;
  v.player.distanceKm = km;
  v.weather = { ...v.weather, kind: 'clair', night: false };
  return v;
}
const result = (over: Partial<DeliveryResult> = {}): DeliveryResult => ({
  orderId: 'o1', orderName: 'Médicaments', shelterId: 's1', shelterName: 'Pharmacie', npc: 'agathe', grade: 'B', condition: 0.95, onTime: true,
  points: 100, xp: 40, notes: [], starsBefore: 0, starsAfter: 1, unlock: null, levelUp: false, ...over,
});
/** Laisse passer `s` secondes de temps d'histoire. */
function wait(s = 10): void { clock += s * 1000; story.observe(view()); }
function send(e: GameEvent): void { story.handle(e); story.observe(view()); }

// Les étapes du chapitre 1, une à une.
const C1: (() => void)[] = [
  () => send({ type: 'scan', found: 3 }),
  () => send({ type: 'pickup', order: { ...mockView().orders[0], id: 'o1', fragile: false } }),
  () => { linked = 1; deliveries++; send({ type: 'delivery', result: result() }); },
  () => { deliveries++; send({ type: 'delivery', result: result({ grade: 'A' }) }); },
  () => { linked = 2; deliveries++; send({ type: 'delivery', result: result({ shelterId: 's2' }) }); },
  () => { deliveries++; send({ type: 'delivery', result: result({ notes: ['Colis fragile'], condition: 0.97 }) }); },
  () => { deliveries++; send({ type: 'delivery', result: result({ notes: ['De nuit'] }) }); },
  () => { linked = 3; deliveries++; send({ type: 'delivery', result: result({ shelterId: 's3' }) }); },
];
function play(n: number): void {
  wait();
  for (let i = 0; i < n; i++) { C1[i](); wait(); wait(); }
}

if (etat === 'objectif' || etat === 'replie') {
  play(4);
  wait(60);
  ui.dismissRadio(); // seul le bandeau reste
  toasts.push('Colis ramassé : Médicaments', 'good', undefined, 60000);
} else if (etat === 'radio') {
  play(2);
  toasts.push('Abri découvert : École des Tilleuls', 'info', undefined, 60000);
} else if (etat === 'radio2') {
  play(5); // Selma, message long
} else if (etat === 'chapitre') {
  play(8);
  wait(6);
} else if (etat === 'journal') {
  linked = 3; deliveries = 14; km = 3.2;
  story.handle({ type: 'delivery', result: result({ grade: 'A', notes: ['Colis fragile', 'De nuit'], condition: 0.97 }) });
  wait(); // rattrapage silencieux du chapitre 1
  send({ type: 'inspect', order: mockView().orders[0], xp: 5 });
  wait(); wait();
  send({ type: 'cache', cacheId: 'k1', points: 50, xp: 20, skillPoint: false });
  wait(60);
  ui.dismissRadio();
  ui.openJournal();
} else if (etat === 'fin') {
  linked = 6; stars = 5; deliveries = 90; km = 31;
  for (let i = 0; i < 3; i++) story.handle({ type: 'delivery', result: result({ grade: 'S' }) });
  for (const e of [{ type: 'inspect', order: mockView().orders[0], xp: 5 }, { type: 'cache', cacheId: 'k', points: 1, xp: 1, skillPoint: false }, { type: 'strap', orderId: 'o', quality: 1, xp: 5 }, { type: 'strap', orderId: 'o', quality: 1, xp: 5 }, { type: 'strap', orderId: 'o', quality: 1, xp: 5 }] as GameEvent[]) story.handle(e);
  wait();
  ui.dismissRadio();
  ui.openJournal();
} else {
  // Déroulé en temps réel.
  let i = 0;
  setInterval(() => { clock += 200; story.observe(view()); }, 200);
  setInterval(() => { if (i < C1.length) C1[i++](); }, 11000);
}
