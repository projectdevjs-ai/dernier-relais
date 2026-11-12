// Commandes : chaque emplacement de colis du monde devient une commande d'un abri.
// Tout est calculé à partir de l'identifiant de l'emplacement : mêmes commandes pour tous les joueurs.
import { type LngLat, dist, hash, rng } from '../core/geo';
import type { ParcelSpot, Shelter } from '../world/types';
import type { CrateKind, SlotId, SpecialKind, SurpriseKind } from './api';
import { DEST, NEWBIE, SHELTER_PERK } from './rules';
import { makeSpecial, specialFor } from './specials';

export interface Order {
  id: string;
  cell: string;
  name: string;
  /** Nom de la version rare, proposée quand l'abri destinataire a 5 étoiles. null : commande ordinaire. */
  rareName: string | null;
  crate: CrateKind;
  weightKg: number;
  fragile: boolean;
  at: LngLat;
  destId: string;
  destName: string;
  destAt: LngLat;
  /** Délai en minutes à partir du ramassage, null si aucun. */
  deadlineMin: number | null;
  /** Récompense avant les avantages de l'abri et la note. */
  baseReward: number;
  state: 'caché' | 'révélé' | 'porté';
  condition: number;
  /** Instant du premier ramassage (ms) : le délai court à partir de là, même si le colis est reposé. null : jamais ramassé. */
  pickedAt: number | null;
  // ── Ajouts facultatifs (systèmes secondaires) : absents sur une commande ordinaire.
  special?: SpecialKind;
  /** Colis perdu : nom du porteur qui l'a abandonné ; `net` si le colis vient d'un autre joueur. */
  lost?: { by: string; net?: boolean };
  /** Identifiant de l'embouteillage dont le colis fait partie. */
  jam?: string;
  /** Contenu connu du joueur (écouté ou déjà ramassé). */
  inspected?: boolean;
  /** Qualité de l'arrimage, 0 à 1. */
  strap?: number;
  /** A traversé un front de mauvais temps au dos du joueur. */
  front?: boolean;
  /** Distance à l'abri au moment du ramassage, en mètres. */
  legM?: number;
  /** Mètres parcourus en véhicule avec ce colis au dos. */
  rideM?: number;
  /** Emplacement du colis porté (dos par défaut). */
  slot?: SlotId;
  /** Surprise révélée à l'écoute, et vrai si l'étiquette suspecte a été trouvée. */
  surprise?: SurpriseKind;
  label?: boolean;
}

interface Item { name: string; crate: CrateKind; min: number; max: number; fragile: number }
export const ITEMS: Item[] = [
  { name: 'Médicaments', crate: 'plastique', min: 1, max: 4, fragile: 0.8 },
  { name: 'Engrais', crate: 'carton', min: 1, max: 3, fragile: 0.1 },
  { name: 'Pièces de pompe', crate: 'alu', min: 4, max: 10, fragile: 0 },
  { name: 'Filtres à eau', crate: 'plastique', min: 2, max: 6, fragile: 0.3 },
  { name: 'Outils', crate: 'bois', min: 5, max: 12, fragile: 0 },
  { name: 'Batteries', crate: 'alu', min: 4, max: 10, fragile: 0.4 },
  { name: 'Livres', crate: 'carton', min: 2, max: 8, fragile: 0 },
  { name: 'Câbles', crate: 'plastique', min: 2, max: 7, fragile: 0 },
  { name: 'Ampoules', crate: 'carton', min: 1, max: 3, fragile: 1 },
  { name: 'Conserves', crate: 'bois', min: 4, max: 10, fragile: 0 },
  { name: 'Couvertures', crate: 'carton', min: 2, max: 5, fragile: 0 },
  { name: 'Pansements', crate: 'plastique', min: 1, max: 3, fragile: 0.2 },
  { name: 'Panneaux solaires', crate: 'alu', min: 6, max: 12, fragile: 0.9 },
  { name: 'Bocaux', crate: 'bois', min: 3, max: 8, fragile: 1 },
  { name: 'Pièces de radio', crate: 'alu', min: 1, max: 4, fragile: 0.7 },
  { name: 'Farine', crate: 'carton', min: 4, max: 10, fragile: 0 },
  { name: 'Savon', crate: 'carton', min: 1, max: 4, fragile: 0 },
  { name: 'Lampes', crate: 'plastique', min: 1, max: 4, fragile: 0.6 },
];
export const RARE_NAMES = ['Vaccins', 'Émetteur radio', 'Microscope', 'Graines anciennes', 'Cartes du réseau', 'Pièces d’horloge'];
const CRATES: CrateKind[] = ['bois', 'alu', 'plastique', 'carton'];
export const ORDER = { deadlineChance: 0.35, rareChance: 0.15, itemCrateChance: 0.7 } as const;

const round5 = (n: number): number => Math.max(5, Math.round(n / 5) * 5);

const cellXY = (id: string): [number, number] | null => {
  const m = /^(-?\d+)\/(-?\d+)$/.exec(id);
  return m ? [Number(m[1]), Number(m[2])] : null;
};
/** Abris des cases voisines du colis (3 x 3 cases autour de la sienne). Tous les abris si la case est inconnue. */
export function sheltersNear(spot: ParcelSpot, shelters: Shelter[]): Shelter[] {
  const c = cellXY(spot.cell);
  if (!c) return shelters;
  return shelters.filter(s => { const k = cellXY(s.cell); return k !== null && Math.abs(k[0] - c[0]) <= 1 && Math.abs(k[1] - c[1]) <= 1; });
}
/** Écart d'une distance à la bande visée (0 dedans). Trop près coûte plus cher que trop loin. */
export const destPenalty = (d: number): number => (d < DEST.minM ? (DEST.minM - d) * DEST.nearPenalty : d > DEST.maxM ? d - DEST.maxM : 0);

/**
 * Abri destinataire : un abri à distance de marche raisonnable du colis (DEST.minM à DEST.maxM), tiré de façon
 * reproductible parmi les 3 plus proches de cette bande. Sans abri dans la bande : celui qui s'en écarte le moins
 * (un abri à 150 m vaut mieux qu'un abri à 1,3 km). Seuls les abris des cases voisines du colis sont regardés,
 * pour que le résultat ne dépende pas de l'endroit où se tient le joueur ; s'il n'y en a aucun, tous les abris chargés.
 */
export function pickDestination(spot: ParcelSpot, shelters: Shelter[]): Shelter | null {
  if (!shelters.length) return null;
  let pool = sheltersNear(spot, shelters);
  if (!pool.length) pool = shelters;
  const sorted = pool
    .map(s => ({ s, d: dist(s.at, spot.at) }))
    .sort((a, b) => a.d - b.d || (a.s.id < b.s.id ? -1 : 1));
  if (sorted.length === 1) return sorted[0].s;
  const band = sorted.filter(x => destPenalty(x.d) === 0).slice(0, DEST.pick);
  if (band.length) return band[hash(`dest|${spot.id}`) % band.length].s;
  // Plafond : un abri au-delà de DEST.capM n'est retenu que s'il n'y a rien en deçà.
  const within = sorted.filter(x => x.d <= DEST.capM), list = within.length ? within : sorted;
  let best = list[0];
  for (const x of list) if (destPenalty(x.d) < destPenalty(best.d)) best = x;
  return best.s;
}

/**
 * Simplifie une commande pour un nouveau porteur : abri le plus proche à courte distance, ni fragile, ni délai.
 * Les colis spéciaux, perdus ou de lot ne changent pas. Renvoie vrai si la commande a été modifiée.
 */
export function easeOrder(o: Order, shelters: Shelter[]): boolean {
  if (o.special || o.lost || o.jam) return false;
  let dest: Shelter | null = null, bd = Infinity;
  for (const s of shelters) {
    const d = dist(s.at, o.at);
    if (d >= NEWBIE.minM && (d < bd || (d === bd && dest !== null && s.id < dest.id))) { dest = s; bd = d; }
  }
  const cur = dist(o.at, o.destAt);
  const changed = (dest !== null && bd < cur) || o.fragile || o.deadlineMin !== null;
  if (dest && bd < cur) { o.destId = dest.id; o.destName = dest.name; o.destAt = dest.at; }
  o.fragile = false; o.deadlineMin = null;
  if (changed) o.baseReward = baseReward(o.weightKg, dist(o.at, o.destAt), false, false);
  return changed;
}

export function baseReward(weightKg: number, distanceM: number, fragile: boolean, deadline: boolean): number {
  return round5(20 + 4 * weightKg + 0.06 * distanceM + (fragile ? 25 : 0) + (deadline ? 15 : 0));
}
/** Délai laissé pour une distance donnée : marche tranquille, avec de la marge. */
export function deadlineFor(distanceM: number): number { return Math.max(8, Math.round((distanceM / 60) * 1.6 + 5)); }

/** Commande d'un emplacement. null si aucun abri n'est chargé. */
export function makeOrder(spot: ParcelSpot, shelters: Shelter[]): Order | null {
  const dest = pickDestination(spot, shelters);
  if (!dest) return null;
  // Les tirages se font toujours dans le même ordre, pour rester reproductibles.
  const r = rng(`commande|${spot.id}`);
  const item = ITEMS[Math.floor(r() * ITEMS.length)];
  const weightKg = item.min + Math.floor(r() * (item.max - item.min + 1));
  const fragile = r() < item.fragile;
  const ownCrate = r() < ORDER.itemCrateChance, otherCrate = CRATES[Math.floor(r() * CRATES.length)];
  const timed = r() < ORDER.deadlineChance;
  const rare = r() < ORDER.rareChance, rareName = RARE_NAMES[Math.floor(r() * RARE_NAMES.length)];
  const d = dist(spot.at, dest.at);
  const o: Order = {
    id: spot.id, cell: spot.cell, name: item.name, rareName: rare ? rareName : null,
    crate: ownCrate ? item.crate : otherCrate, weightKg, fragile, at: spot.at,
    destId: dest.id, destName: dest.name, destAt: dest.at,
    deadlineMin: timed ? deadlineFor(d) : null,
    baseReward: baseReward(weightKg, d, fragile, timed),
    state: 'caché', condition: 1, pickedAt: null,
  };
  const special = specialFor(spot.id);
  return special ? makeSpecial(o, special, d) : o;
}

/** Vrai si la commande est proposée en version rare (abri destinataire à 5 étoiles). */
export const isRare = (o: Order, destStars: number): boolean => o.rareName !== null && destStars >= 5;
export const orderName = (o: Order, destStars: number): string => (isRare(o, destStars) ? o.rareName! : o.name);
/** Récompense affichée : base, avantage « mieux payé » (2 étoiles) et commande rare (5 étoiles). */
export function orderReward(o: Order, destStars: number): number {
  let r = o.baseReward;
  if (destStars >= 2) r *= SHELTER_PERK.payMult;
  if (isRare(o, destStars)) r *= SHELTER_PERK.rareMult;
  return round5(r);
}
/** Minutes restantes avant la fin du délai (délai entier tant que le colis n'est pas ramassé). */
export function minutesLeft(o: Order, nowMs: number): number | null {
  if (o.deadlineMin === null) return null;
  if (o.pickedAt === null) return o.deadlineMin;
  return Math.ceil(o.deadlineMin - (nowMs - o.pickedAt) / 60000);
}
export const elapsedMin = (o: Order, nowMs: number): number => (o.pickedAt === null ? 0 : (nowMs - o.pickedAt) / 60000);
