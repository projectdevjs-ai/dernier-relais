// Colis spéciaux : de rares commandes hors norme, chacune avec UNE contrainte lisible et une grosse récompense.
// Tout se décide à partir de l'identifiant de l'emplacement : mêmes colis spéciaux pour tous les joueurs.
import { hash, rng } from '../core/geo';
import type { CrateKind, SpecialKind } from './api';
import { type Order, baseReward, deadlineFor } from './orders';
import { SPECIAL } from './rules';

export interface SpecialDef { kind: SpecialKind; label: string; rule: string; crate: CrateKind; fragile: boolean }
export const SPECIALS: Record<SpecialKind, SpecialDef> = {
  cryo: { kind: 'cryo', label: 'Caisson cryogénique', rule: 'Se réchauffe : perd 3 % d’état par minute dès que tu le prends. Livre vite.', crate: 'alu', fragile: true },
  ruche: { kind: 'ruche', label: 'Ruche vivante', rule: 'Ne cours pas : chaque foulée de course l’abîme.', crate: 'bois', fragile: false },
  boitenoire: { kind: 'boitenoire', label: 'Boîte noire', rule: 'Très bien payée, mais le délai est très court.', crate: 'alu', fragile: false },
  batterie: { kind: 'batterie', label: 'Cellule instable', rule: 'Très lourde : elle remplit presque le sac et te fatigue plus vite.', crate: 'alu', fragile: false },
};
export const SPECIAL_KINDS: SpecialKind[] = ['batterie', 'boitenoire', 'cryo', 'ruche'];
/** Nom affiché tant que le colis n'a pas été écouté. */
export const UNKNOWN_SPECIAL = 'Signal inhabituel';

const round5 = (n: number): number => Math.max(5, Math.round(n / 5) * 5);

/** Sorte de colis spécial d'un emplacement, ou null (presque toujours). */
export function specialFor(spotId: string): SpecialKind | null {
  if (hash(`spécial|${spotId}`) / 4294967296 >= SPECIAL.chance) return null;
  return SPECIAL_KINDS[hash(`sorte|${spotId}`) % SPECIAL_KINDS.length];
}

/** Transforme une commande ordinaire en colis spécial. `distanceM` : du colis à son abri. */
export function makeSpecial(o: Order, kind: SpecialKind, distanceM: number): Order {
  const d = SPECIALS[kind], r = rng(`spécial|${kind}|${o.id}`);
  const [min, max] = SPECIAL.kg[kind];
  const weightKg = min + Math.floor(r() * (max - min + 1));
  const deadlineMin = kind === 'boitenoire' ? Math.max(SPECIAL.blackboxMinMin, Math.round(deadlineFor(distanceM) * SPECIAL.blackboxDelay)) : null;
  return {
    ...o, special: kind, name: d.label, rareName: null, crate: d.crate, fragile: d.fragile, weightKg, deadlineMin,
    baseReward: round5(baseReward(weightKg, distanceM, d.fragile, deadlineMin !== null) * SPECIAL.pay[kind]),
  };
}

/** Part d'état perdue par seconde à cause de la contrainte propre au colis (en plus de l'usure ordinaire). */
export function specialWearPerSecond(kind: SpecialKind | undefined, c: { everPicked: boolean; carried: boolean; running: boolean }): number {
  if (kind === 'cryo' && c.everPicked) return SPECIAL.cryoPerMin / 60;
  if (kind === 'ruche' && c.carried && c.running) return SPECIAL.hiveRunPerMin / 60;
  return 0;
}
/** Fatigue supplémentaire due aux colis portés (cellule instable). */
export function specialDrainMult(carried: { special?: SpecialKind }[]): number {
  return carried.some(o => o.special === 'batterie') ? SPECIAL.batteryDrain : 1;
}
