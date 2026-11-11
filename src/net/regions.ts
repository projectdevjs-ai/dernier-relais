// Les 13 régions métropolitaines, hors ligne et sans gros fichier de contours.
//
// regionAt() : attribution par plus proche point de référence (414 points : les 96 préfectures, des sous-préfectures
// et des points de calage ajoutés le long des frontières entre régions).
// Limite de précision : la frontière obtenue est la médiatrice entre deux points, pas la vraie limite administrative.
// Mesure faite sur 171 000 points tirés au hasard dans les vrais contours des régions (données ouvertes utilisées
// pour le contrôle seulement, non embarquées) : 97,4 % de bonnes réponses (de 95 % en Île-de-France à 100 % en
// Corse). Les erreurs sont toutes dans une bande de quelques kilomètres le long des frontières entre régions.
// Sans gravité pour le jeu : tous les joueurs calculent la même réponse (même liste), et un abri garde pour
// toujours la région que lui a donnée son premier livreur.
// Hors de France métropolitaine, la fonction renvoie quand même la région la plus proche.
//
// Carte : volontairement stylisée. La France est pavée de tuiles hexagonales (une tuile ≈ 37 km) ; chaque tuile
// prend la région de son centre selon regionAt(), donc la carte et le jeu disent toujours la même chose.
// Le contour du pays (LAND) est tracé à la main, à grands traits : il sert seulement à décider quelles tuiles existent.
import type { LngLat } from '../core/geo';

export type RegionId = 'idf' | 'cvl' | 'bfc' | 'nor' | 'hdf' | 'ges' | 'pdl' | 'bre' | 'naq' | 'occ' | 'ara' | 'pac' | 'cor';
export interface RegionInfo { id: RegionId; name: string; short: string; /** chef-lieu, pour l'ordre d'allumage des tuiles */ seat: LngLat }

export const REGIONS: readonly RegionInfo[] = [
  { id: 'hdf', name: 'Hauts-de-France', short: 'Hauts-de-Fr.', seat: [3.06, 50.63] },
  { id: 'nor', name: 'Normandie', short: 'Normandie', seat: [1.1, 49.44] },
  { id: 'idf', name: 'Île-de-France', short: 'Île-de-Fr.', seat: [2.35, 48.86] },
  { id: 'ges', name: 'Grand Est', short: 'Grand Est', seat: [7.75, 48.58] },
  { id: 'bre', name: 'Bretagne', short: 'Bretagne', seat: [-1.68, 48.11] },
  { id: 'pdl', name: 'Pays de la Loire', short: 'Pays de la Loire', seat: [-1.55, 47.22] },
  { id: 'cvl', name: 'Centre-Val de Loire', short: 'Centre-Val de L.', seat: [1.91, 47.9] },
  { id: 'bfc', name: 'Bourgogne-Franche-Comté', short: 'Bourgogne-Fr.-C.', seat: [5.04, 47.32] },
  { id: 'naq', name: 'Nouvelle-Aquitaine', short: 'Nlle-Aquitaine', seat: [-0.58, 44.84] },
  { id: 'ara', name: 'Auvergne-Rhône-Alpes', short: 'Auvergne-Rh.-A.', seat: [4.84, 45.76] },
  { id: 'occ', name: 'Occitanie', short: 'Occitanie', seat: [1.44, 43.6] },
  { id: 'pac', name: 'Provence-Alpes-Côte d’Azur', short: 'Provence-A.-C.A.', seat: [5.37, 43.3] },
  { id: 'cor', name: 'Corse', short: 'Corse', seat: [8.74, 41.92] },
];
const BY_ID = new Map<string, RegionInfo>(REGIONS.map(r => [r.id, r]));
export function regionInfo(id: string): RegionInfo | null { return BY_ID.get(id) ?? null; }
export function regionName(id: string | null | undefined): string { return (id && BY_ID.get(id)?.name) || 'Région inconnue'; }
export function isRegionId(id: unknown): id is RegionId { return typeof id === 'string' && BY_ID.has(id); }

// Points de référence : « longitude,latitude » séparés par des espaces, par région.
const REF: Record<RegionId, string> = {
  // Paris, petite couronne, préfectures et bords de la région
  idf: '2.35,48.86 2.66,48.54 2.13,48.80 2.43,48.63 2.21,48.89 2.44,48.91 2.46,48.79 2.08,49.04 2.70,48.40 3.30,48.56 2.88,48.96 1.83,48.64 1.72,48.99 2.16,48.43 2.70,48.27 3.08,48.82 1.60,48.78 2.25,49.15 3.10,48.38 1.98,48.32 2.55,49.03 3.25,48.90 1.80,49.13 2.02,48.52',
  cvl: '2.40,47.08 1.49,48.45 1.69,46.81 0.69,47.39 1.33,47.59 1.91,47.90 1.37,48.74 2.25,48.17 2.73,48.00 2.07,47.22 2.63,47.69 1.07,47.79 0.24,47.17 1.00,47.13 1.06,46.63 2.51,46.72 0.82,48.32 1.33,48.07 2.84,47.33 1.99,46.58 0.45,47.63 2.94,47.02 1.75,47.36 3.02,47.83 1.60,48.26 1.28,48.20 0.93,48.10 1.45,46.45 2.95,47.60 1.01,48.69 1.98,48.27 0.59,47.01 2.82,47.46 1.82,48.42 1.01,48.44 1.56,48.70',
  bfc: '5.04,47.32 6.02,47.24 5.55,46.67 3.16,46.99 6.16,47.62 4.83,46.31 3.57,47.80 6.86,47.64 3.28,48.20 6.80,47.51 6.35,46.90 5.49,47.09 4.85,46.78 4.30,46.95 3.91,47.49 2.93,47.41 4.57,47.86 5.86,46.39 4.00,46.48 3.47,46.83 5.60,47.45 4.84,47.02 3.40,47.98 5.23,46.63 6.60,47.20 4.28,46.43 3.05,47.25 3.97,47.86 6.38,47.87 5.33,47.58 3.20,47.55 3.73,46.68 3.19,47.84 5.83,47.83 3.62,48.13 3.02,47.72 5.59,46.41 3.01,47.58 6.61,47.85 4.25,47.89 3.83,47.98 3.99,46.26 5.60,47.67',
  nor: '-0.37,49.18 1.15,49.02 -1.09,49.12 0.09,48.43 1.10,49.44 -1.62,49.64 0.11,49.49 1.08,49.92 -1.36,48.68 -0.57,48.75 0.55,48.52 1.48,49.09 0.23,49.15 1.52,49.73 0.60,48.80 -0.89,48.84 1.40,50.05 -1.55,48.55 0.75,49.62 1.75,49.28 -0.15,48.55 0.93,48.75 1.70,49.60 1.61,49.44 0.74,48.27 1.23,48.83 0.80,48.41 0.24,48.56 -1.51,48.64',
  hdf: '3.62,49.56 3.06,50.63 2.08,49.43 2.78,50.29 2.30,49.89 1.86,50.95 2.38,51.03 3.52,50.36 3.29,49.85 1.83,50.11 3.40,49.05 2.59,49.21 2.83,49.42 1.61,50.73 3.97,50.28 3.32,49.38 2.57,49.65 4.08,49.92 1.75,49.50 2.15,49.25 3.55,49.20 1.95,49.72 2.42,49.26 1.82,49.28 2.99,49.14 1.56,50.13 1.79,49.60 3.98,49.44',
  ges: '4.72,49.77 4.07,48.30 4.36,48.96 5.14,48.11 6.18,48.69 5.16,48.77 6.18,49.12 7.75,48.58 7.36,48.08 6.45,48.17 4.03,49.26 5.38,49.16 6.17,49.36 7.34,47.75 7.07,49.11 4.95,48.64 5.33,47.86 3.50,48.49 7.45,48.75 6.95,48.29 5.70,48.36 3.72,48.72 4.58,48.72 4.37,49.51 5.60,49.52 7.95,48.95 7.10,47.80 4.35,48.02 5.75,47.90 6.60,47.95 3.75,48.20 5.45,47.72 3.76,49.14 4.00,47.99 6.36,47.99 4.35,49.87 4.14,49.42',
  pdl: '-1.55,47.22 -0.55,47.47 -0.77,48.07 0.20,48.00 -1.43,46.67 -2.21,47.27 -0.88,47.06 -1.38,47.72 -1.78,46.50 -0.81,46.47 -0.62,48.30 -0.08,47.26 -0.08,47.70 0.65,48.18 -2.00,46.95 -1.18,47.37 0.43,47.75 -1.95,47.50 -1.00,46.85 -1.05,47.85 0.00,48.29 -0.21,48.43 -1.01,48.29 0.42,47.66 -1.22,46.39 0.82,48.12 0.20,48.41',
  bre: '-2.76,48.51 -4.10,48.00 -1.68,48.11 -2.76,47.66 -4.49,48.39 -3.37,47.75 -2.01,48.65 -2.08,47.65 -1.20,48.35 -3.46,48.73 -3.83,48.58 -2.97,48.07 -1.75,48.52 -1.52,47.88 -2.40,47.93 -1.18,48.01 -1.55,48.43 -1.59,48.57',
  naq: '0.16,45.65 -1.15,46.16 1.77,45.27 1.87,46.17 0.72,45.18 -0.58,44.84 -0.50,43.89 0.62,44.20 -0.37,43.30 -0.46,46.32 0.34,46.58 1.26,45.83 -1.47,43.49 -1.05,43.71 -1.17,44.66 0.48,44.85 1.53,45.16 0.17,44.50 -1.03,45.62 0.55,46.82 -0.49,46.84 2.31,45.55 0.87,46.43 -0.94,45.31 -0.63,45.75 1.22,44.89 0.71,44.41 -0.61,43.19 2.17,45.96 -0.25,44.03 0.10,47.02 -0.20,43.70 -0.87,43.10 2.05,45.20 0.67,45.90 -0.25,46.65 0.95,44.52 0.10,43.95 0.00,43.50 1.50,46.35 2.25,46.25 0.39,44.13 2.41,45.72 1.80,45.01 -0.18,43.43 0.20,44.03 2.41,45.44 -0.81,46.29 -0.05,43.29 0.99,46.54 1.19,44.72 2.16,45.14',
  occ: '1.61,42.97 2.35,43.21 2.57,44.35 4.36,43.84 1.44,43.60 0.59,43.65 3.88,43.61 1.44,44.45 3.50,44.52 0.08,43.23 2.90,42.70 2.15,43.93 1.35,44.02 4.08,44.13 3.22,43.34 3.08,44.10 2.03,44.61 0.72,43.11 2.24,43.61 3.00,43.18 2.04,42.50 4.62,44.16 0.15,43.95 1.72,44.90 2.93,44.68 3.75,44.72 -0.05,43.40 4.50,43.70 0.37,44.05 1.05,44.30 2.25,44.75 3.85,44.40 0.18,43.57 0.00,43.86 2.40,44.57 0.81,43.99 -0.17,43.72 1.39,44.74 4.65,43.99 3.23,44.85 -0.03,43.57 3.55,44.75 2.01,44.86 0.00,43.31 1.17,44.55 2.59,44.73',
  ara: '5.23,46.21 3.33,46.57 4.60,44.74 2.44,44.93 4.89,44.93 5.72,45.19 4.39,45.44 3.88,45.04 3.09,45.78 4.84,45.76 5.92,45.57 6.13,45.90 3.43,46.13 2.60,46.34 4.07,46.04 4.75,44.56 6.48,46.37 6.39,45.68 6.35,45.28 6.77,45.62 3.09,45.03 5.66,46.26 5.13,44.36 2.49,45.40 4.38,44.45 6.05,46.25 3.70,46.30 5.60,44.75 6.87,45.92 2.33,44.70 4.15,44.48 3.60,44.85 4.80,46.14 5.00,44.44 2.79,46.60 4.97,46.29 3.98,44.72 3.62,46.59 2.59,45.71 3.85,46.44 5.39,44.25 5.56,44.54 6.83,45.18 2.23,45.15 2.20,44.85 3.97,46.17 4.86,46.28 3.01,44.84 2.16,45.02',
  pac: '6.24,44.09 6.08,44.56 7.26,43.70 5.37,43.30 5.93,43.12 4.81,43.95 6.64,44.90 6.65,44.39 7.50,43.78 7.02,43.55 4.63,43.68 4.81,44.14 6.74,43.43 5.94,44.19 5.45,43.53 5.05,44.39 7.10,44.07 5.72,44.50 5.22,44.16 5.58,44.13',
  cor: '8.74,41.92 9.45,42.70 9.15,42.31 9.28,41.59 8.76,42.57',
};

const K = Math.cos((46.5 * Math.PI) / 180); // une longitude compte moins qu'une latitude à cette hauteur
const POINTS: { x: number; y: number; id: RegionId }[] = [];
for (const r of REGIONS) for (const p of REF[r.id].split(' ')) { const [lng, lat] = p.split(',').map(Number); POINTS.push({ x: lng * K, y: lat, id: r.id }); }

/** Région administrative (identifiant court) du point donné. Renvoie toujours une région : la plus proche. */
export function regionAt(lng: number, lat: number): RegionId {
  const x = lng * K;
  let best: RegionId = 'idf', bd = Infinity;
  for (const p of POINTS) { const d = (p.x - x) ** 2 + (p.y - lat) ** 2; if (d < bd) { bd = d; best = p.id; } }
  return best;
}

// ───────────────────────── carte stylisée en tuiles

// Contour très simplifié du continent et de la Corse, [longitude, latitude], tracé à la main.
const LAND: LngLat[][] = [[
  [2.55, 51.09], [3.2, 50.76], [3.67, 50.45], [4.2, 50.28], [4.85, 50.15], [4.25, 49.96], [5.0, 49.78], [5.8, 49.55], [6.37, 49.47],
  [6.75, 49.17], [7.4, 49.17], [8.23, 48.97], [7.8, 48.5], [7.58, 47.6], [7.0, 47.45], [6.45, 46.75], [6.1, 46.4], [6.3, 46.25],
  [6.8, 46.42], [7.04, 45.92], [6.8, 45.8], [7.12, 45.3], [6.63, 45.1], [7.05, 44.67], [6.9, 44.36], [7.65, 44.17], [7.53, 43.78],
  [7.13, 43.55], [6.7, 43.2], [6.15, 43.03], [5.9, 43.07], [5.35, 43.21], [4.6, 43.37], [4.1, 43.55], [3.7, 43.4], [3.1, 43.1],
  [3.05, 42.9], [3.17, 42.43], [2.5, 42.34], [1.95, 42.37], [1.45, 42.6], [0.67, 42.72], [0.0, 42.69], [-0.75, 42.92], [-1.45, 43.03],
  [-1.78, 43.37], [-1.45, 43.65], [-1.3, 44.2], [-1.25, 44.63], [-1.07, 45.57], [-1.23, 45.7], [-1.4, 46.0], [-1.25, 46.15],
  [-1.8, 46.5], [-2.3, 47.0], [-2.55, 47.28], [-3.1, 47.5], [-3.4, 47.7], [-4.37, 47.8], [-4.73, 48.04], [-4.6, 48.25], [-4.78, 48.36],
  [-4.6, 48.6], [-3.98, 48.73], [-3.45, 48.83], [-3.0, 48.8], [-2.7, 48.55], [-2.32, 48.68], [-2.0, 48.67], [-1.5, 48.63], [-1.6, 48.84],
  [-1.8, 49.37], [-1.94, 49.72], [-1.26, 49.7], [-1.15, 49.37], [-0.3, 49.3], [0.07, 49.52], [0.2, 49.7], [1.08, 49.94], [1.55, 50.2],
  [1.58, 50.87], [1.85, 50.97],
], [
  [9.4, 43.0], [9.48, 42.65], [9.55, 42.1], [9.4, 41.6], [9.2, 41.38], [8.8, 41.55], [8.6, 41.9], [8.55, 42.35], [8.72, 42.58], [9.0, 42.65], [9.3, 42.72],
]];

function inRing(ring: LngLat[], lng: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Vrai si le point est sur la carte stylisée (contour à grands traits : ne pas s'en servir pour le jeu). */
export function onMap(lng: number, lat: number): boolean { return LAND.some(r => inRing(r, lng, lat)); }

export interface MapTile { col: number; row: number; region: RegionId; /** centre, en unités de carte */ x: number; y: number; at: LngLat }
export interface FranceMap {
  width: number; height: number;
  /** Rayon d'une tuile (centre → sommet), en unités de carte. */
  r: number;
  tiles: MapTile[];
  /** Pour chaque région : ses tuiles, de la plus proche du chef-lieu à la plus lointaine (ordre d'allumage). */
  byRegion: Record<RegionId, MapTile[]>;
  /** Pour chaque région : tracé SVG (attribut d) de sa frontière, en segments. */
  borders: Record<RegionId, string>;
  /** Centre visuel de chaque région (moyenne de ses tuiles). */
  centers: Record<RegionId, { x: number; y: number }>;
}

const W0 = -5.2, N0 = 51.25, E0 = 9.75, S0 = 41.25;
const STEP_LAT = 0.29; // écart entre deux rangées de tuiles, en degrés (≈ 32 km) ; tuile ≈ 37 km de large

/** Sommets d'une tuile hexagonale (pointe en haut), rayon r. */
export function hexPoints(x: number, y: number, r: number): [number, number][] {
  const w = (Math.sqrt(3) / 2) * r;
  return [[x, y - r], [x + w, y - r / 2], [x + w, y + r / 2], [x, y + r], [x - w, y + r / 2], [x - w, y - r / 2]];
}

let cached: FranceMap | null = null;
/** Construit (une seule fois) la carte en tuiles. */
export function franceMap(): FranceMap {
  if (cached) return cached;
  const unit = 100; // unités de carte par degré de latitude
  const r = (STEP_LAT * unit) / 1.5, w = Math.sqrt(3) * r;
  const rows = Math.ceil(((N0 - S0) * unit) / (1.5 * r)), cols = Math.ceil(((E0 - W0) * K * unit) / w);
  const tiles: MapTile[] = [];
  const key = (c: number, rw: number) => `${c}/${rw}`;
  const grid = new Map<string, MapTile>();
  for (let row = 0; row <= rows; row++) for (let col = 0; col <= cols; col++) {
    const x = col * w + (row % 2 ? w / 2 : 0) + w / 2, y = row * 1.5 * r + r;
    const lng = W0 + x / (K * unit), lat = N0 - y / unit;
    if (!onMap(lng, lat)) continue;
    const t: MapTile = { col, row, region: regionAt(lng, lat), x, y, at: [lng, lat] };
    tiles.push(t); grid.set(key(col, row), t);
  }
  const byRegion = {} as Record<RegionId, MapTile[]>, borders = {} as Record<RegionId, string>, centers = {} as Record<RegionId, { x: number; y: number }>;
  for (const reg of REGIONS) {
    const mine = tiles.filter(t => t.region === reg.id);
    const sx = reg.seat[0] * K, sy = reg.seat[1];
    mine.sort((a, b) => ((a.at[0] * K - sx) ** 2 + (a.at[1] - sy) ** 2) - ((b.at[0] * K - sx) ** 2 + (b.at[1] - sy) ** 2));
    byRegion[reg.id] = mine;
    centers[reg.id] = mine.length
      ? { x: mine.reduce((s, t) => s + t.x, 0) / mine.length, y: mine.reduce((s, t) => s + t.y, 0) / mine.length }
      : { x: 0, y: 0 };
    // Frontière : chaque côté de tuile dont le voisin n'est pas de la même région.
    let d = '';
    for (const t of mine) {
      const p = hexPoints(t.x, t.y, r), odd = t.row % 2;
      // voisins dans l'ordre des côtés : NE, E, SE, SO, O, NO
      const nb: [number, number][] = [[t.col + odd, t.row - 1], [t.col + 1, t.row], [t.col + odd, t.row + 1], [t.col + odd - 1, t.row + 1], [t.col - 1, t.row], [t.col + odd - 1, t.row - 1]];
      for (let i = 0; i < 6; i++) {
        if (grid.get(key(nb[i][0], nb[i][1]))?.region === reg.id) continue;
        const a = p[i], b = p[(i + 1) % 6];
        d += `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
      }
    }
    borders[reg.id] = d;
  }
  cached = { width: (cols + 1.5) * w, height: (rows + 1) * 1.5 * r + r, r, tiles, byRegion, borders, centers };
  return cached;
}
