// Démo de l'arbre de compétences seul, avec un faux état de jeu. Paramètres d'URL :
//   ?noeud=<id>        ouvre la fiche d'un module (scan-portee, bras-long, sac, calage, sangles, foulee, souffle…)
//   &ambiance=clair    &fige=1 (une image par changement : pour les captures)    &leger=1 (rendu allégé)
//   &points=<n>        points à dépenser (2 par défaut)    &refus=1 (le jeu refuse tout apprentissage)
//   &debut=1 (rien d'appris)    &max=1 (tout au maximum)    &journal=1 (affiche les événements reçus)
import type { ActionResult, Ambiance, GameView } from '../game/api';
import { mockView } from '../game/mock';
import { SKILLS, learnBlock, skillViews } from '../game/skills';
import { SkillTree } from './tree';

const q = new URLSearchParams(location.search);
const ambiance: Ambiance = q.get('ambiance') === 'clair' ? 'clair' : 'crépuscule';
const log = document.getElementById('log')!;
const calls: string[] = [];
const say = (s: string): void => { calls.push(s); log.textContent = s; if (q.has('journal')) document.body.classList.remove('sans-log'); };

// Toutes les compétences du jeu, dans des états variés : acquis, rang partiel, disponible, verrouillé, points insuffisants.
const ranks: Record<string, number> = q.has('debut') ? {} : q.has('max')
  ? Object.fromEntries(SKILLS.map(s => [s.id, s.maxRank]))
  : { 'scan-portee': 3, 'scan-recharge': 1, 'bras-long': 1, sac: 1, calage: 1, foulee: 3, souffle: 2, 'tout-terrain': 2, carnet: 2, 'exo-bras': 1 };
let points = q.has('points') ? Math.max(0, Number(q.get('points')) || 0) : 2;

function makeView(): GameView {
  const v = mockView();
  v.player.skillPoints = points;
  v.skills = skillViews(ranks, points, v.player.level);
  return v;
}

const tree = new SkillTree(document.getElementById('scene')!, {
  learn: (id): ActionResult => {
    if (q.has('refus')) { say(`learn(${id}) refusé`); return { ok: false, why: 'Le réseau ne répond pas : réessaie dans un instant.' }; }
    const why = learnBlock(id, ranks, points, mockView().player.level);
    if (why) { say(`learn(${id}) refusé : ${why}`); return { ok: false, why }; }
    const d = SKILLS.find(s => s.id === id)!;
    ranks[id] = (ranks[id] ?? 0) + 1; points -= d.cost;
    say(`learn(${id}) accepté`);
    // Le jeu renvoie sa nouvelle vue un peu plus tard, comme dans la boucle principale.
    setTimeout(() => tree.update(makeView()), 60);
    return { ok: true };
  },
  onClose: () => { say('onClose'); if (!q.has('fige')) setTimeout(() => void tree.open(makeView()), 1200); },
  onUi: kind => { calls.push(`ui:${kind}`); },
}, { ambiance, still: q.has('fige'), leger: q.has('leger') });

tree.open(makeView()).then(() => {
  const noeud = q.get('noeud');
  if (noeud) tree.select(noeud, true);
  console.info('[arbre] prêt');
  document.body.dataset.pret = '1';
}, e => { say(`WebGL indisponible : ${String(e)}`); document.body.classList.remove('sans-log'); document.body.dataset.pret = 'repli'; });
Object.assign(window, { __tree: tree, __calls: calls });
