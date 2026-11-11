// Commandes : chaque emplacement de colis du monde devient une commande d'un abri.
// Tout est calculé à partir de l'identifiant de l'emplacement : mêmes commandes pour tous les joueurs.
import { type LngLat, dist, hash, rng } from '../core/geo';
import type { ParcelSpot, Shelter } from '../world/types';
import type { CrateKind } from './api';
import { SHELTER_PERK } from './rules';

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
}

interface Item { name: string; crate: CrateKind; min: number; max: number; fragile: number }
export const ITEMS: Item[] = [
  { name: 'Médicaments', crate: 'plastique', min: 1, max: 4, fragile: 0.8 },
  { name: 'Semences', crate: 'carton', min: 1, max: 3, fragile: 0.1 },
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

/** Abri destinataire : jamais le plus proche du colis quand il y en a d'autres ; choix reproductible parmi les 3 suivants. */
export function pickDestination(spot: ParcelSpot, shelters: Shelter[]): Shelter | null {
  if (!shelters.length) return null;
  const sorted = shelters
    .map(s => ({ s, d: dist(s.at, spot.at) }))
    .sort((a, b) => a.d - b.d || (a.s.id < b.s.id ? -1 : 1));
  if (sorted.length === 1) return sorted[0].s;
  const cands = sorted.slice(1, 4);
  return cands[hash(`dest|${spot.id}`) % cands.length].s;
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
  return {
    id: spot.id, cell: spot.cell, name: item.name, rareName: rare ? rareName : null,
    crate: ownCrate ? item.crate : otherCrate, weightKg, fragile, at: spot.at,
    destId: dest.id, destName: dest.name, destAt: dest.at,
    deadlineMin: timed ? deadlineFor(d) : null,
    baseReward: baseReward(weightKg, d, fragile, timed),
    state: 'caché', condition: 1, pickedAt: null,
  };
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
