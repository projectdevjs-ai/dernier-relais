// Gestes du ramassage : sanglage (boucles puis cliquet), inspection à la découverte, photo-preuve à la livraison.
import { GESTURE, PROOF } from './rules';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/**
 * Qualité d'un arrimage d'après l'endroit où le joueur lâche la sangle (0 = pas tirée, 1 = tirée à fond).
 * Dans la zone « bien serré » : 1. Avant : proportionnel. Au-delà : trop serré, la moitié seulement.
 */
export function strapQuality(release: number): number {
  const x = clamp01(release), [lo, hi] = GESTURE.strapGood;
  if (x > hi) return 0.5;
  if (x >= lo) return 1;
  return Math.round((x / lo) * 0.8 * 100) / 100;
}
/** Multiplicateur de dérive de l'équilibre : chaque colis bien arrimé pèse moins dans le déséquilibre. */
export function strapBalanceMult(carried: { weightKg: number; strap?: number }[]): number {
  let kg = 0, held = 0;
  for (const o of carried) { kg += o.weightKg; held += o.weightKg * clamp01(o.strap ?? 0); }
  return kg > 0 ? 1 - GESTURE.strapEffect * (held / kg) : 1;
}
/** Un arrimage réussi donne un peu d'XP. */
export const strapXp = (quality: number): number => (quality >= 1 ? GESTURE.strapXp : 0);
/** Points offerts pour la photo-preuve d'une livraison. */
export const proofBonus = (points: number): number => Math.max(PROOF.min, Math.round(points * PROOF.share));

// ───────────────────────── Sanglage en 3D (séquence de ramassage), réglages repris de l'ancien jeu

/** Difficulté du sanglage d'un colis. */
export interface StrapPlan {
  /** Nombre de boucles à relier. */
  nodes: number;
  /** Demi-largeur du passage à suivre, en pixels. */
  corr: number;
  /** Temps de maintien sur une boucle pour verrouiller le cliquet, en ms. */
  hold: number;
  /** Souplesse de la sangle (part du retard rattrapée par image). */
  lag: number;
  /** Balancement de la caisse. */
  sway: number;
  /** Temps accordé, en secondes. */
  time: number;
  /** Largeur de la zone verte du cliquet final (0 à 1). */
  ratchetZone: number;
  /** Vitesse du doigt (px/s) au-delà de laquelle le geste est trop brusque, et état perdu à chaque fois. */
  harshSpeed: number; harshCost: number;
}
export const STRAP = {
  /** en dessous de cet état, le colis est refusé */ refuse: 35,
  /** état à partir duquel le sanglage est « parfait » */ perfect: 95,
  /** pertes d'état : sangle sortie du passage, sangle trop tendue, cliquet trop serré, sangle qui cède, défaut non réparé */
  offPath: 15, tooTight: 14, overRatchet: 10, snapped: 14, defect: 10,
  /** classes de poids (kg) : léger en dessous de la première, lourd au-dessus de la seconde */ weights: [5, 10],
} as const;
/**
 * Plan de sanglage d'un colis : plus il est lourd ou pressé, plus il y a de boucles et moins le passage est large
 * (formule de l'ancien jeu : classe de poids `wi` de 0 à 2, importance `ii` de 0 à 2).
 */
export function strapPlan(o: { weightKg: number; fragile: boolean; timed: boolean; special?: string | null }): StrapPlan {
  const wi = o.weightKg < STRAP.weights[0] ? 0 : o.weightKg < STRAP.weights[1] ? 1 : 2;
  const ii = o.special ? 2 : o.timed ? 1 : 0;
  const nodes = 3 + wi + ii, hive = o.special === 'ruche';
  return {
    nodes, corr: 24 - 2 * wi - 2.5 * ii, hold: 220 + 70 * wi + 70 * ii, lag: 0.42 - 0.06 * wi - 0.05 * ii, sway: 2.5 + 2.5 * wi + 2 * ii,
    time: Math.round(10 + nodes * 1.7),
    ratchetZone: o.weightKg > 10 ? 0.1 : o.fragile ? 0.17 : 0.14,
    harshSpeed: hive ? 520 : o.fragile ? 900 : 1600, harshCost: hive ? 8 : o.fragile ? 10 : 5,
  };
}
/** Qualité de l'arrimage (0 à 1) d'après l'état du colis à la fin du sanglage (0 à 100). */
export function strapQualityFromState(state: number): number {
  const s = Math.min(100, Math.max(0, Number.isFinite(state) ? state : 0));
  return s >= STRAP.perfect ? 1 : Math.round(s) / 100;
}
