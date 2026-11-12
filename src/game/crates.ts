// Les matières et formes de colis, reprises de l'ancien jeu (KIND, KIND_SHAPE, WEIGHTS, GEST) : chacune a son modèle 3D,
// ses proportions, son poids typique, sa tenue à la pluie et aux chocs, et son geste d'arrimage final.
// Une matière inconnue (sauvegarde ou réseau plus récents) retombe toujours sur le carton.
import type { CrateKind, SpecialKind } from './api';

/** Geste final après le passage des sangles. `sangles` : la dernière boucle verrouille tout, sans geste de plus. */
export type StrapGesture = 'cliquet' | 'aimants' | 'noeud' | 'cables' | 'sangles';

export interface CrateDef {
  kind: CrateKind;
  /** « Caisse en bois »… */
  label: string;
  /** Fichier public/models/<model>.glb. */
  model: string;
  /** Proportions (largeur, hauteur, profondeur) : le modèle n'est jamais déformé. */
  shape: [number, number, number];
  /** Poids typique, en kg. */
  kg: [number, number];
  /** Protection du contenu : part des marchandises fragiles qui le restent dans cette matière (1 : aucune protection). */
  fragility: number;
  /** Sensibilité à la pluie et à la neige (usure multipliée d'autant). */
  wet: number;
  gesture: StrapGesture;
  /** Couleur des sangles propres à la matière. */
  strap: number;
}

export const CRATE_DEFS: Record<CrateKind, CrateDef> = {
  carton: { kind: 'carton', label: 'Carton', model: 'carton', shape: [1.16, 0.84, 1.0], kg: [1, 8], fragility: 1, wet: 1.5, gesture: 'sangles', strap: 0xd9822b },
  bois: { kind: 'bois', label: 'Caisse en bois', model: 'caisse_bois', shape: [0.94, 0.96, 1.08], kg: [4, 12], fragility: 1, wet: 1, gesture: 'cliquet', strap: 0xd9822b },
  alu: { kind: 'alu', label: 'Malle en aluminium', model: 'malle_alu', shape: [1.22, 0.94, 0.84], kg: [3, 12], fragility: 0.85, wet: 0.5, gesture: 'aimants', strap: 0x3f8a94 },
  plastique: { kind: 'plastique', label: 'Bac plastique', model: 'bac_plastique', shape: [1.14, 0.91, 0.95], kg: [1, 7], fragility: 1, wet: 0.6, gesture: 'sangles', strap: 0xd6b23c },
  sac: { kind: 'sac', label: 'Sac étanche', model: 'colis_sac', shape: [1.25, 0.7, 0.75], kg: [1, 7], fragility: 1, wet: 0.3, gesture: 'noeud', strap: 0xb9a47a },
  fut: { kind: 'fut', label: 'Fût scellé', model: 'colis_fut', shape: [0.8, 1.25, 0.8], kg: [5, 12], fragility: 0.9, wet: 0.4, gesture: 'sangles', strap: 0xc24a3a },
  coffre: { kind: 'coffre', label: 'Coffre militaire', model: 'colis_coffre', shape: [1.45, 0.7, 0.85], kg: [7, 12], fragility: 0.6, wet: 0.4, gesture: 'cliquet', strap: 0x6f7a52 },
};
export const CRATE_KINDS = Object.keys(CRATE_DEFS) as CrateKind[];
export const isCrateKind = (v: unknown): v is CrateKind => typeof v === 'string' && Object.prototype.hasOwnProperty.call(CRATE_DEFS, v);
/** Définition d'une matière ; une matière inconnue retombe sur le carton, sans erreur. */
export const crateDef = (kind: string | null | undefined): CrateDef => (isCrateKind(kind) ? CRATE_DEFS[kind] : CRATE_DEFS.carton);
export const crateLabel = (kind: string | null | undefined): string => crateDef(kind).label;
export const crateModel = (kind: string | null | undefined): string => crateDef(kind).model;

/** Geste final d'un colis : celui de sa matière, ou celui du colis spécial (ancien jeu : cryo aimanté, cellule à brancher). */
const SPECIAL_GESTURE: Record<SpecialKind, StrapGesture> = { cryo: 'aimants', batterie: 'cables', ruche: 'sangles', boitenoire: 'sangles' };
export function gestureFor(crate: string | null | undefined, special?: SpecialKind | null): StrapGesture {
  return special ? SPECIAL_GESTURE[special] ?? 'sangles' : crateDef(crate).gesture;
}
export const GESTURE_NAME: Record<StrapGesture, string> = { cliquet: 'Cliquet', aimants: 'Attaches aimantées', noeud: 'Nœud de portage', cables: 'Câbles', sangles: 'Sangles seules' };
