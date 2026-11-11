// Valeurs d'équilibrage du jeu, regroupées ici pour être réglées sans toucher à la logique.
import type { Grade } from './api';

/** Capacité du sac sans compétence, en kg. */
export const BAG_KG = 20;
/** Recharge du scanner sans compétence, en secondes. */
export const SCAN_COOLDOWN_S = 8;
export const SCAN_COOLDOWN_MIN_S = 3;

/** Vitesses, en m/s. */
export const SPEED = {
  /** en dessous : à l'arrêt */ moving: 0.3,
  /** au-dessus : le joueur « court » */ run: 2.5,
  /** au-dessus : saut de position (lieu de test), ignoré */ teleport: 30,
  /** déplacement minimal compté, pour ne pas additionner le bruit du GPS */ stepM: 3,
  /** sans nouveau déplacement pendant ce temps, le joueur est à l'arrêt */ idleMs: 5000,
} as const;

/** Points d'abri nécessaires pour chaque étoile. */
export const STAR_THRESHOLDS = [100, 300, 600, 1000, 1500] as const;
export const GRADE_MULT: Record<Grade, number> = { E: 0.5, D: 0.75, C: 1, B: 1.25, A: 1.5, S: 2 };
/** Score minimal (sur 100) de chaque note. */
export const GRADE_MIN: [Grade, number][] = [['S', 97], ['A', 88], ['B', 76], ['C', 62], ['D', 45], ['E', -Infinity]];
export const GRADE_BONUS = { onTime: 3, wet: 6, night: 4, lateBase: 15, lateMaxExtra: 25 } as const;

/** Avantages donnés par les étoiles d'un abri. */
export const SHELTER_PERK = {
  /** 2 étoiles : commandes pour cet abri mieux payées */ payMult: 1.15,
  /** 3 étoiles : l'endurance revient plus vite à cet abri */ restMult: 2,
  /** 4 étoiles : portée du scanner autour de l'abri */ scanBonusM: 40, scanAroundM: 300,
  /** 5 étoiles : commandes rares */ rareMult: 2,
} as const;

/** Usure des colis portés, en part d'état perdue par minute. */
export const WEAR = {
  rain: 0.004, storm: 0.008, snow: 0.005,
  danger: 0.03, unbalanced: 0.01, running: 0.02,
  /** multiplicateur pour un colis fragile (pluie, déséquilibre) */ fragile: 2, fragileUnbalanced: 1.5,
  /** multiplicateur d'usure quand l'endurance est à 0 */ exhausted: 1.3,
  /** sensibilité de chaque caisse à la pluie et à la neige */
  crateWet: { bois: 1, alu: 0.5, plastique: 0.6, carton: 1.5 },
} as const;

export const BALANCE = {
  /** au-delà (en valeur absolue), la charge est déséquilibrée */ limit: 0.6,
  /** secondes de déséquilibre tolérées avant que les colis s'abîment */ graceS: 6,
  /** dérive par seconde : base, part de la charge, part du vent */ base: 0.01, perLoad: 0.06, perWind: 0.035, windFullKmh: 60,
  /** le porteur se rattrape un peu tout seul, par seconde */ restore: 0.02,
  /** retour au calme à l'arrêt, par seconde */ settle: 0.15,
} as const;

export const STAMINA = {
  /** baisse par seconde en marchant, sac vide */ drain: 0.0006,
  /** baisse supplémentaire par seconde, sac plein */ drainLoad: 0.0022,
  runMult: 1.8,
  /** remontée par seconde à l'arrêt */ rest: 0.02,
  /** multiplicateur de remontée dans un abri */ shelterMult: 2,
} as const;

export const XP = { perDelivery: 15, perPoint: 0.5, contractShare: 0.5 } as const;
/** XP nécessaire pour passer du niveau donné au suivant. */
export const xpNeeded = (level: number): number => 100 + 60 * (level - 1) + 15 * (level - 1) ** 2;

export const DANGER = { chance: 0.22, minR: 50, maxR: 90, clearM: 60 } as const;
/** Un colis fragile est « intact » à partir de cet état. */
export const INTACT = 0.95;
/** En dessous de cet état, le PNJ remarque que le colis est abîmé. */
export const DAMAGED = 0.6;
/** Écart minimal entre deux sauvegardes automatiques. */
export const SAVE_EVERY_MS = 2000;
