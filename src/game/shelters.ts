// Abris : étoiles, déblocages et PNJ responsable.
import { hash } from '../core/geo';
import type { NpcId } from './api';
import { STAR_THRESHOLDS } from './rules';

export const NPCS: NpcId[] = ['mara', 'tomas', 'agathe', 'kenji'];
/** PNJ de l'abri : toujours le même pour un abri donné, chez tous les joueurs. */
export function npcFor(shelterId: string): NpcId { return NPCS[hash(`pnj|${shelterId}`) % NPCS.length]; }

/** Étoiles d'un abri. La première livraison donne la première étoile, quel que soit le nombre de points. */
export function starsFor(points: number, deliveries: number): number {
  let n = 0;
  while (n < STAR_THRESHOLDS.length && points >= STAR_THRESHOLDS[n]) n++;
  return Math.max(n, deliveries > 0 ? 1 : 0);
}
/** Points nécessaires pour l'étoile suivante, null à 5 étoiles. */
export function nextStarAt(stars: number): number | null {
  return stars >= STAR_THRESHOLDS.length ? null : STAR_THRESHOLDS[stars];
}

const UNLOCKS = [
  'Rencontre avec le responsable de l’abri',
  'Commandes de cet abri mieux payées (+15 %)',
  'Repos : l’endurance revient deux fois plus vite ici',
  'Scanner : portée +40 m autour de cet abri',
  'Commandes rares et titre « Pilier de l’abri »',
];
/** Ce que débloque l'étoile n (1 à 5). */
export function unlockText(star: number): string | null { return UNLOCKS[star - 1] ?? null; }
/** Ce que débloquera la prochaine étoile, null à 5 étoiles. */
export function nextUnlock(stars: number): string | null { return unlockText(stars + 1); }
