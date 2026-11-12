// Textes du labo : distribution, répliques des scientifiques, libellés des postes.
// « ancien » = repris mot pour mot (ou raccourci sans changer un mot) de l'ancienne version du jeu ;
// « nouveau » = écrit pour cette version, dans le même ton.
import type { GameView } from '../game/api';

export type SciId = 'iris' | 'noe' | 'selma';

export const CAST: Record<SciId, { name: string; role: string; model: string }> = {
  iris: { name: 'Dr Iris Morel', role: 'Directrice de la Station Lumen', model: 'sci_iris' },
  noe: { name: 'Noé Kessler', role: 'Ingénieur du Passeur', model: 'sci_noe' },
  selma: { name: 'Dr Selma Okoye', role: 'Biologiste et médecin', model: 'sci_selma' },
};

/** Première rencontre (ancien). */
export const FIRST: Record<SciId, string> = {
  iris: 'Tu tiens debout. Bien. Je suis Iris Morel. Ici, c’est la Station Lumen, le dernier laboratoire encore relié au réseau.',
  noe: 'Alors c’est toi, le colis tombé du ciel. Noé. C’est moi qui fais tenir le Passeur avec du fil et de la patience.',
  selma: 'Constantes stables, pour quelqu’un qui vient de tomber du ciel. Selma Okoye, médecin, biologiste, et ce qui manque d’autre ici.',
};

/** Répliques sans condition, dites à tour de rôle (ancien). */
export const POOL: Record<SciId, string[]> = {
  iris: [
    'Chaque abri relié, c’est une ville qui respire un peu mieux.',
    'Le Passeur est calibré sur ta position. Monte quand tu veux.',
    'On a reçu un signal de l’Est cette nuit. Faible, mais vivant.',
    'Ne laisse pas la Plaine te garder. Tu as du travail.',
  ],
  noe: [
    'Si le Passeur fait un bruit de casserole, ne t’inquiète pas. Enfin… pas trop.',
    'Mon bras ? Un souvenir de la première version du Passeur.',
    'Les fixations des jambes fatiguent vite. Le dos, c’est pour le lourd.',
  ],
  selma: [
    'Bois de l’eau. Je ne plaisante pas.',
    'Les ruches que tu ramènes, ce sont mes abeilles préférées. Traite-les bien.',
    'Repose-toi entre deux tournées, ton corps n’est pas un colis.',
  ],
};

const plural = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`;
const km = (n: number): string => (n >= 10 ? Math.round(n).toString() : n.toFixed(1).replace('.', ','));

export interface Progress { linked: number; claimable: number; exoDone: boolean; exoEmpty: boolean }

export function progressOf(v: GameView): Progress {
  const ranks = v.skills.reduce((s, k) => s + k.rank, 0), max = v.skills.reduce((s, k) => s + k.maxRank, 0);
  return {
    linked: v.shelters.filter(s => s.stars > 0).length,
    claimable: v.contracts.filter(c => c.done && !c.claimed).length,
    exoDone: max > 0 && ranks >= max,
    exoEmpty: ranks === 0,
  };
}

/**
 * Répliques liées à la progression, de la plus pressante à la moins pressante. Chacune porte une clé :
 * une réplique déjà dite pendant cette visite n'est pas répétée.
 */
export function contextual(id: SciId, v: GameView): { key: string; text: string }[] {
  const p = v.player, g = progressOf(v), out: { key: string; text: string }[] = [];
  if (id === 'iris') {
    // ancien
    if (p.deliveries === 0) out.push({ key: 'depart', text: 'Le Passeur peut t’envoyer dans le monde réel, exactement là où se trouve ton signal. Tu livres, tu relies les abris, et tu reviens ici quand tu veux.' });
    // nouveau
    if (g.claimable > 0) out.push({ key: `contrat${g.claimable}`, text: `${plural(g.claimable, 'contrat rempli', 'contrats remplis')}. Passe à la console avant de repartir.` });
    if (g.linked > 0) out.push({ key: `abris${g.linked}`, text: `${plural(g.linked, 'abri relié', 'abris reliés')} autour de toi. Regarde la table : la carte se rallume.` });
    if (p.deliveries >= 25) out.push({ key: 'liv25', text: `${p.deliveries} livraisons. Les abris commencent à compter sur toi.` });
    else if (p.deliveries >= 5) out.push({ key: 'liv5', text: `${p.deliveries} livraisons. Le réseau commence à connaître ton pas.` });
  } else if (id === 'noe') {
    // nouveau
    if (p.skillPoints > 0) out.push({ key: `pts${p.skillPoints}`, text: `Tu as ${plural(p.skillPoints, 'point', 'points')} à dépenser. Passe au râtelier, je te règle ça.` });
    if (g.exoDone) out.push({ key: 'complet', text: 'Plus rien à visser. Cet exosquelette, c’est toi qui le fais tenir maintenant.' });
    // ancien
    if (g.exoEmpty) out.push({ key: 'vide', text: 'L’exosquelette est léger, mais il encaisse : dos, bras, jambes. Garde le même poids à gauche et à droite, sinon tu finis le nez dans le bitume.' });
    // nouveau
    if (p.level >= 5) out.push({ key: `niv${p.level}`, text: `Niveau ${p.level}. Il va falloir que je resserre les fixations.` });
  } else {
    // nouveau
    if (p.stamina < 0.35) out.push({ key: 'fatigue', text: 'Tu es à bout de souffle. Allonge-toi un moment avant de repartir.' });
    if (p.distanceKm >= 10) out.push({ key: 'km10', text: `${km(p.distanceKm)} kilomètres dans les jambes. Tes genoux ont le droit de se plaindre.` });
    else if (p.distanceKm >= 1) out.push({ key: 'km1', text: `${km(p.distanceKm)} kilomètres depuis ton arrivée. Le corps suit, pour l’instant.` });
    if (p.deliveries === 0) out.push({ key: 'chambre', text: 'Ta couchette est juste là. Tu y trouveras ton carnet : tout ce que tu fais dehors y est noté.' });
  }
  return out;
}

export type StationId = 'teleporteur' | 'exo' | 'holo' | 'console' | 'lit';

/** Libellés des postes. Les noms « Le Passeur », « Salle des cartes » et « Quartiers » viennent de l'ancienne version. */
export const STATION_TEXT: Record<StationId, { tag: string; kicker: string; title: string; action: string }> = {
  teleporteur: { tag: 'Le Passeur', kicker: 'Le Passeur', title: 'Partir sur le terrain', action: 'Partir' },
  exo: { tag: 'Exosquelette', kicker: 'Atelier de Noé', title: 'Exosquelette', action: 'Compétences' },
  holo: { tag: 'Réseau', kicker: 'Salle des cartes', title: 'Réseau de France', action: 'Carte du réseau' },
  console: { tag: 'Contrats', kicker: 'Console', title: 'Contrats', action: 'Voir les contrats' },
  lit: { tag: 'Carnet', kicker: 'Quartiers', title: 'Carnet du porteur', action: 'Ouvrir le carnet' },
};

export const BRANCH_LABEL = { scanner: 'Scanner', portage: 'Portage', endurance: 'Endurance', 'réseau': 'Réseau' } as const;
/** Partie de l'exosquelette que chaque branche allume. */
export const BRANCH_PART = { scanner: 'Casque', portage: 'Armature dorsale', endurance: 'Jambes', 'réseau': 'Colonne' } as const;

export function fmtKm(n: number): string { return km(n); }
export function fmtInt(n: number): string { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
export { plural };
