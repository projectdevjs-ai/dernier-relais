// Démo du labo seul, avec un faux état de jeu. Paramètres d'URL :
//   ?poste=exo|holo|console|lit|teleporteur   place la caméra sur un poste
//   &ambiance=clair    &parle=iris|noe|selma (ouvre une bulle)    &debut=1 (porteur débutant : rien d'appris)
//   &max=1 (toutes les compétences au maximum)    &fige=1 (une image par changement : pour les captures)
//   &depart=1 (lance la séquence du Passeur)       &oubli=1 (oublie les rencontres déjà faites)
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
}, { ambiance, still: q.has('fige') });

void lab.open(view).then(() => {
  const poste = q.get('poste') as StationId | null;
  if (poste) lab.go(poste, true);
  const parle = q.get('parle') as SciId | null;
  if (parle) lab.talk(parle);
  if (q.has('depart')) (document.querySelector('.lab-go') as HTMLButtonElement).click();
  console.info('[labo] prêt');
});
Object.assign(window, { __lab: lab });
