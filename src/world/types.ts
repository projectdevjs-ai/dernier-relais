import type { LngLat } from '../core/geo';

/** Données brutes d'une tuile de carte, réduites à ce dont le jeu a besoin. */
export interface RawTile {
  pois: { name: string; cls: string; sub: string; at: LngLat }[];
  places: { name: string; cls: string; at: LngLat }[];
  roads: { cls: string; pts: LngLat[] }[];
}
export type ShelterKind =
  | 'mairie' | 'soin' | 'vivres' | 'savoir' | 'culte' | 'nature' | 'poste' | 'halte' | 'hameau' | 'carrefour';
export interface Shelter {
  id: string; cell: string; name: string; kind: ShelterKind; at: LngLat;
  /** vrai lieu de la carte, ou abri de secours placé par les règles */
  source: 'lieu' | 'secours';
}
export interface ParcelSpot { id: string; cell: string; at: LngLat }
export interface CellContent { id: string; shelters: Shelter[]; parcels: ParcelSpot[]; roads: number }
