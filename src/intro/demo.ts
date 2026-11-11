// Démo du prologue seul. Paramètres d'URL : ?t=<secondes> (fige la séquence à cet instant)
//   &ambiance=clair   &rejouer=1 (oublie que le prologue a été vu)
import type { Ambiance } from '../game/api';
import { playPrologue, shouldPlayPrologue } from './prologue';

const q = new URLSearchParams(location.search);
const ambiance: Ambiance = q.get('ambiance') === 'clair' ? 'clair' : 'crépuscule';
const log = document.getElementById('log')!;
if (q.has('rejouer')) { try { localStorage.removeItem('dernier-relais/prologue'); } catch { /* rien */ } }
const cues: string[] = [];
log.textContent = `à jouer : ${shouldPlayPrologue() ? 'oui' : 'non (déjà vu)'}`;
void playPrologue(document.getElementById('scene')!, {
  ambiance,
  freezeAt: q.has('t') ? Number(q.get('t')) : undefined,
  onSound: c => { cues.push(c); log.textContent = `son : ${cues.join(' · ')}`; },
}).then(() => { log.textContent = `prologue terminé (${cues.join(' · ')}) — vu : ${shouldPlayPrologue() ? 'non' : 'oui'}`; });
