// Valeurs d'équilibrage du jeu, regroupées ici pour être réglées sans toucher à la logique.
import type { Grade } from './api';

/** Capacité du sac sans compétence, en kg. */
export const BAG_KG = 20;
/** Recharge du scanner sans compétence, en secondes. */
export const SCAN_COOLDOWN_S = 15;
export const SCAN_COOLDOWN_MIN_S = 7;

/** Vitesses, en m/s. */
export const SPEED = {
  /** en dessous : à l'arrêt */ moving: 0.3,
  /** au-dessus : le joueur « court » */ run: 2.5,
  /** au-dessus : saut de position (lieu de test), ignoré */ teleport: 30,
  /** déplacement minimal compté, pour ne pas additionner le bruit du GPS */ stepM: 3,
  /** sans nouveau déplacement pendant ce temps, le joueur est à l'arrêt */ idleMs: 5000,
  /** au-dessus, de façon soutenue : le joueur est dans un véhicule (ni distance, ni ramassage, ni livraison) */ vehicle: 6,
  /** secondes au-dessus du seuil avant de considérer que c'est un véhicule, et secondes de marche avant de l'oublier */ vehicleS: 8, vehicleCoolS: 20,
  /** GPS muet plus longtemps que ça : on repart de la nouvelle position sans compter le trajet */ gapMs: 30000,
  /** précision GPS (m) au-delà de laquelle la position est lissée avant de compter les pas */ noisyAccM: 6,
  /** pas minimal quand le GPS est imprécis : part de la précision annoncée, plafonnée */ stepPerAcc: 0.7, stepMaxM: 25,
} as const;

/**
 * Choix de l'abri destinataire d'un colis : de préférence entre minM et maxM du colis (4 à 9 minutes de marche),
 * tiré parmi les `pick` plus proches de cette bande. Hors bande, un abri trop près est pénalisé `nearPenalty` fois plus
 * par mètre qu'un abri trop loin. Seuls les abris des cases voisines du colis (3 x 3) comptent : même résultat pour tous.
 */
export const DEST = { minM: 250, maxM: 700, pick: 3, nearPenalty: 2, /** plafond : au-delà, un abri n'est choisi que s'il n'y en a aucun en deçà */ capM: 900 } as const;
/**
 * Premières commandes d'un nouveau porteur (tant qu'il a moins de `deliveries` livraisons) : l'emplacement du colis est
 * le même que pour tout le monde, mais la commande est simplifiée : abri le plus proche à au moins minM (de préférence à moins de maxM), ni fragile, ni délai.
 */
export const NEWBIE = { deliveries: 3, minM: 90, maxM: 400 } as const;
/** Colis transporté en véhicule sur plus de `share` du trajet : les points de la livraison sont multipliés par `mult`. */
export const VEHICLE = { share: 0.3, mult: 0.25 } as const;
/** Scanner à vide (rien de révélé, sac vide) : il accroche le colis caché le plus proche jusqu'à cette distance. */
export const SCAN_ECHO_M = 900;

/** Points d'abri nécessaires pour chaque étoile. */
export const STAR_THRESHOLDS = [100, 350, 800, 1600, 3000] as const;
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
  /** charge rangée de travers : dérive constante du côté le plus lourd, par seconde, pour un déséquilibre latéral de 1 */ perLean: 0.03,
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

// ───────────────────────── Systèmes secondaires (rares par construction : 1 élément de chaque sorte, au plus, par secteur de 2 km)

/** Colis spéciaux : part des emplacements de colis concernée, et réglages de chaque sorte. */
export const SPECIAL = {
  chance: 0.015,
  /** caisson cryogénique : part d'état perdue par minute dès le premier ramassage */ cryoPerMin: 0.03,
  /** ruche : part d'état perdue par minute de course */ hiveRunPerMin: 0.3,
  /** boîte noire : part du délai normal */ blackboxDelay: 0.6, blackboxMinMin: 5,
  /** cellule instable : fatigue en plus */ batteryDrain: 1.4,
  /** multiplicateur de récompense */ pay: { batterie: 2.4, boitenoire: 3, cryo: 2.5, ruche: 2.2 },
  /** poids en kg [min, max] */ kg: { batterie: [15, 18], boitenoire: [5, 8], cryo: [6, 10], ruche: [9, 13] },
} as const;

/** Caches : chance par case et par jour, portées, récompenses. */
export const CACHE = {
  chance: 0.14, scanM: 120, openM: 25, clearM: 50,
  points: [30, 80], xp: [20, 40], skillChance: 0.1,
} as const;

/** Rôdeurs : chance par case et par tranche horaire, marche, cadeaux. */
export const WANDER = {
  chance: 0.1, slotMs: 2 * 3600_000, speed: 1.1, pauseS: 25, talkM: 25,
  staminaGift: 0.3, xpGift: 25,
} as const;

/** Fronts de mauvais temps : chance par zone (4 x 4 cases) et par heure, taille, trajet. */
export const FRONT = {
  chance: 0.2, slotMs: 3600_000, minR: 140, maxR: 200, travelM: 2400, offsetM: 300,
  /** apparition et disparition progressives, en secondes */ fadeS: 180,
  /** prévenir quand le front arrive dans moins de… secondes */ warnS: 180,
  /** secondes passées dedans, colis au dos, pour mériter le bonus de note */ creditS: 15,
} as const;

/** Embouteillages de colis : chance par abri et par tranche de 3 h. */
export const JAM = {
  chance: 0.08, slotMs: 3 * 3600_000, count: 3, maxKg: 5, ringM: 14,
  /** part de la somme des récompenses donnée en bonus */ bonusShare: 0.5,
  /** minutes : marge fixe + minutes par 100 m cumulés */ baseMin: 6, minPer100m: 2.2, minMin: 12,
} as const;

/** Colis perdus : chance par case et par jour, récompense de solidarité. */
export const LOST = { chance: 0.05, pay: 1.5, clearM: 60 } as const;

/** Gestes du ramassage. */
export const GESTURE = {
  /** inspection : portée et XP */ inspectM: 60, inspectXp: 5,
  /** arrimage : secondes laissées après le ramassage pour le déclarer (la séquence de ramassage le fait aussitôt) */ strapWindowS: 10,
  /** un arrimage parfait réduit d'autant la dérive due à ce colis */ strapEffect: 0.5, strapXp: 5,
  /** un colis bien sanglé s'abîme moins quand la charge est déséquilibrée ou que le porteur court (part retirée à qualité 1) */ strapWear: 0.3,
  /** sanglage raté ou abandonné : points perdus (l'ancien jeu retirait 3 points de réputation) */ fumblePoints: 3,
} as const;

/** Preuve photo : part des points de la livraison, minimum, et temps laissé pour la prendre. */
export const PROOF = { share: 0.1, min: 5, windowMs: 180_000 } as const;
