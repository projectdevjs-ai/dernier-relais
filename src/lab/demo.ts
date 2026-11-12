// Démo du labo seul, avec un faux état de jeu. Paramètres d'URL :
//   ?station=cartes|passeur|chambre   va à ce poste    &exo=1 (atelier de l'exosquelette)    &chambre=1 (entre dans les quartiers)    &chats=2 (chats clandestins ; aucun par défaut)    &repos=1 (avec chambre=1 : porteur allongé)
//   &ambiance=clair    &parle=iris|noe|selma (ouvre une bulle)    &debut=1 (porteur débutant : rien d'appris)
//   &max=1 (toutes les compétences au maximum)    &fige=1 (une image par changement : pour les captures)
//   &depart=1 (lance la séquence du Passeur ; &depart=0.75 la fige à cette fraction)       &oubli=1 (oublie les rencontres déjà faites)
import type { Ambiance } from '../game/api';
import { mockView } from '../game/mock';
import { Lab } from './lab';
import type { SciId, StationId } from './texts';

const q = new URLSearchParams(location.search);
const ambiance: Ambiance = q.get('ambiance') === 'clair' ? 'clair' : 'crépuscule';
const log = document.getElementById('log')!;
const say = (s: string): void => { log.textContent = s; document.body.classList.remove('sans-log'); };
if (q.has('oubli')) { try { localStorage.removeItem('dernier-relais/labo-rencontres'); } catch { /* rien */ } }

const view = mockView();
if (q.has('debut')) {
  for (const s of view.skills) s.rank = 0;
  for (const s of view.shelters) s.stars = 0;
  Object.assign(view.player, { level: 1, xp: 0, skillPoints: 0, deliveries: 0, distanceKm: 0, score: 0 });
  for (const c of view.contracts) { c.progress = 0; c.done = false; }
}
if (q.has('max')) for (const s of view.skills) s.rank = s.maxRank;

const lab = new Lab(document.getElementById('scene')!, {
  onDepart: () => { say('onDepart : retour à la carte'); lab.close(); setTimeout(() => void lab.open(view), 1200); },
  onSkills: () => say('onSkills : panneau Compétences'),
  onNetwork: () => say('onNetwork : carte du réseau'),
  onContracts: () => say('onContracts : contrats'),
  onJournal: () => say('onJournal : carnet'),
  onVoice: (who, text) => console.info(`[voix] ${who} : ${text}`),
  onSkillTree: () => say('onSkillTree : arbre de compétences'),
  onRest: () => say('onRest : repos'),
}, { ambiance, still: q.has('fige'), holdDepartAt: q.get('depart') && q.get('depart') !== '1' ? Number(q.get('depart')) : undefined });

void lab.open(view).then(() => {
  const station = q.get('station') as StationId | null;
  if (station) lab.go(station, true);
  if (q.has('chats')) lab.setCats(Number(q.get('chats')) || 1);
  if (q.has('exo')) lab.openExo(true);
  if (q.has('chambre')) lab.enterRoom(true);
  if (q.has('repos')) lab.restPose();
  const parle = q.get('parle') as SciId | null;
  if (parle) lab.talk(parle);
  if (q.has('depart')) (document.querySelector('.lab-go') as HTMLButtonElement).click();
  console.info('[labo] prêt');
});
Object.assign(window, { __lab: lab, __log: log });
