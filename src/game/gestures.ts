// Gestes du ramassage : sanglage (boucles puis cliquet), inspection à la découverte, photo-preuve à la livraison.
import { GESTURE, PROOF } from './rules';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

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
  offPath: 12, tooTight: 11, overRatchet: 8, snapped: 11, defect: 8,
  /** classes de poids (kg) : léger en dessous de la première, lourd au-dessus de la seconde */ weights: [5, 10],
  /** écart doigt-sangle (px) au-delà duquel la sangle « trop tendue » glisse ; rayon (px) d'accroche d'une boucle ; passage minimal sous la pluie ou la fatigue */
  slackPx: 78, lockPx: 17, minCorr: 10,
} as const;
/**
 * Gestes finaux par matière (ancien jeu : aimants, nœud, câbles, cliquet), une fois les sangles passées.
 * `time` : secondes garanties pour le geste ; rayons en pixels ; `cost` : état perdu par erreur.
 */
export const FINAL = {
  cliquet: { time: 7.5 },
  /** trois attaches à glisser sur leurs repères, qui bougent avec la malle */ aimants: { time: 22, count: 3, grabPx: 36, snapPx: 37 },
  /** une corde à suivre du doigt ; lâchée trop loin, elle file jusqu'au dernier quart */ noeud: { time: 24, tolPx: 34, tolWetPx: 27, slipCost: 2, points: 90 },
  /** trois câbles à brancher dans l'ordre annoncé, chacun sur la prise de sa couleur */ cables: { time: 19, count: 3, grabPx: 36, socketPx: 44, cost: 9 },
} as const;
/**
 * Plan de sanglage d'un colis : plus il est lourd ou pressé, plus il y a de boucles et moins le passage est large
 * (formule de l'ancien jeu : classe de poids `wi` de 0 à 2, importance `ii` de 0 à 2), assouplie d'un cinquième environ.
 */
export function strapPlan(o: { weightKg: number; fragile: boolean; timed: boolean; special?: string | null }): StrapPlan {
  const wi = o.weightKg < STRAP.weights[0] ? 0 : o.weightKg < STRAP.weights[1] ? 1 : 2;
  const ii = o.special ? 2 : o.timed ? 1 : 0;
  const nodes = 3 + wi + ii, hive = o.special === 'ruche';
  return {
    nodes, corr: 29 - 2.4 * wi - 3 * ii, hold: 175 + 55 * wi + 55 * ii, lag: 0.42 - 0.06 * wi - 0.05 * ii, sway: 2 + 2 * wi + 1.6 * ii,
    time: Math.round(12.5 + nodes * 2.1),
    ratchetZone: o.weightKg > 10 ? 0.125 : o.fragile ? 0.21 : 0.175,
    harshSpeed: hive ? 650 : o.fragile ? 1100 : 2000, harshCost: hive ? 6 : o.fragile ? 8 : 4,
  };
}
/** Qualité de l'arrimage (0 à 1) d'après l'état du colis à la fin du sanglage (0 à 100). */
export function strapQualityFromState(state: number): number {
  const s = Math.min(100, Math.max(0, Number.isFinite(state) ? state : 0));
  return s >= STRAP.perfect ? 1 : Math.round(s) / 100;
}
/** Résultat du cliquet quand le joueur relâche : tension `v` (0 à 1), centre et largeur de la zone verte. */
export type RatchetResult = 'none' | 'ok' | 'over' | 'under';
export function ratchetRelease(v: number, center: number, zone: number): RatchetResult {
  const x = clamp01(v);
  // Un simple effleurement n'est pas un geste.
  if (x < 0.04) return 'none';
  if (Math.abs(x - center) <= zone / 2) return 'ok';
  return x > center ? 'over' : 'under';
}
/** Zone verte du cliquet : son centre est tiré entre ces deux bornes à chaque sanglage. */
export const RATCHET_CENTER: readonly [number, number] = [0.52, 0.72];

/** Ordre de branchement des câbles et place des prises, tirés d'un générateur (0 à 1) : deux permutations de 0..n-1. */
export function cablePlan(rnd: () => number, n: number = FINAL.cables.count): { order: number[]; sockets: number[] } {
  const shuffle = (): number[] => { const a = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  return { order: shuffle(), sockets: shuffle() };
}
/** Branchement d'un câble : la prise doit être de sa couleur, et c'est son tour. */
export function cablePlug(plug: number, socket: number, want: number): 'ok' | 'couleur' | 'ordre' {
  return socket !== plug ? 'couleur' : plug !== want ? 'ordre' : 'ok';
}
/** Tracé du nœud de portage : une boucle en huit, en fractions de l'écran autour de (0, 0). `n` segments. */
export function knotPath(n: number = FINAL.noeud.points): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2 + Math.PI / 2, d = 1 + Math.sin(t) ** 2;
    pts.push({ x: (Math.cos(t) / d) * 1.15, y: ((Math.sin(t) * Math.cos(t)) / d) * 2.1 });
  }
  return pts;
}
/** Corde lâchée : on reprend au début du quart de tracé en cours. */
export function knotCheckpoint(i: number, total: number): number { const q = Math.floor(total / 4); return q > 0 ? Math.floor(i / q) * q : 0; }
