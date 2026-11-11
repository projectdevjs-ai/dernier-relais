// Gestes rapides, toujours facultatifs : arrimage au ramassage, inspection à la découverte, photo-preuve à la livraison.
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
