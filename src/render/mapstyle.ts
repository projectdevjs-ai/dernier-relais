// Restylage de la carte OpenFreeMap « liberty » : on ne garde que quelques familles de couches,
// peintes en aplats cohérents, pour obtenir un monde de jeu et non une appli GPS.
import * as THREE from 'three';
import type { LayerSpecification, Map as MlMap, StyleSpecification } from 'maplibre-gl';
import type { Ambiance } from '../game/api';

export const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const SOURCE = 'openmaptiles';

export interface Palette {
  land: string; urban: string; park: string; wood: string; water: string; sand: string;
  road: string; roadMajor: string; roadEdge: string; path: string; rail: string;
  bLow: string; bHigh: string; roofLow: string; roofHigh: string; text: string; halo: string; veil: string;
  /** Ciel : zénith, horizon, et teinte du voile atmosphérique au loin. */
  sky: string; horizon: string; haze: string;
}
type Key = keyof Palette;
const KEYS: Key[] = ['land', 'urban', 'park', 'wood', 'water', 'sand', 'road', 'roadMajor', 'roadEdge', 'path', 'rail', 'bLow', 'bHigh', 'roofLow', 'roofHigh', 'text', 'halo', 'veil', 'sky', 'horizon', 'haze'];

/** Palettes de jour. « crépuscule » : heure bleue, sol ardoise, toits froids, horizon encore chaud. */
const DAY: Record<Ambiance, Palette> = {
  'crépuscule': {
    land: '#1e2c30', urban: '#223237', park: '#22483a', wood: '#1c4030', water: '#1b5a78', sand: '#454330',
    road: '#3b5058', roadMajor: '#4d6772', roadEdge: '#6c8a92', path: '#a08548', rail: '#7a6540',
    bLow: '#3d555c', bHigh: '#6a8f98', roofLow: '#56737a', roofHigh: '#8fb4ba', text: '#f0ead8', halo: '#1e2c30', veil: '#4a5d66',
    sky: '#22325a', horizon: '#e79a6a', haze: '#5c6f8a',
  },
  clair: {
    land: '#f3ecda', urban: '#ede4cf', park: '#bfe09a', wood: '#a3d188', water: '#86cdea', sand: '#f6e3a8',
    road: '#ffffff', roadMajor: '#ffe7b0', roadEdge: '#c9b996', path: '#e6c98c', rail: '#b9ad98',
    bLow: '#fbeedb', bHigh: '#f0d9c0', roofLow: '#e9a27c', roofHigh: '#c2d0d6', text: '#7b6c52', halo: '#f3ecda', veil: '#c4cfd4',
    sky: '#8fc7ee', horizon: '#fff3da', haze: '#dcebf2',
  },
};
/** Palettes de pleine nuit : bleu profond, rues encore lisibles sous la lune. */
const NIGHT: Record<Ambiance, Palette> = {
  'crépuscule': {
    land: '#101a22', urban: '#131f28', park: '#12291f', wood: '#0f241b', water: '#0e3048', sand: '#22241c',
    road: '#25363f', roadMajor: '#30464f', roadEdge: '#45606a', path: '#5c4d2c', rail: '#473b24',
    bLow: '#22323d', bHigh: '#3a5362', roofLow: '#2e4350', roofHigh: '#4d6b7b', text: '#b9c4c4', halo: '#101a22', veil: '#1b2630',
    sky: '#070c1c', horizon: '#243a5c', haze: '#131d2e',
  },
  clair: {
    land: '#18223a', urban: '#1b2640', park: '#17363a', wood: '#143132', water: '#123660', sand: '#2c2f3c',
    road: '#30415f', roadMajor: '#3d5278', roadEdge: '#556c96', path: '#665f48', rail: '#4c4d5a',
    bLow: '#2b3b5c', bHigh: '#41587f', roofLow: '#3a4f76', roofHigh: '#5a75a0', text: '#cfd9ee', halo: '#18223a', veil: '#222d44',
    sky: '#0a1230', horizon: '#34508a', haze: '#1a2644',
  },
};

const ca = new THREE.Color(), cb = new THREE.Color(), grey = new THREE.Color();

/** Palette pour une ambiance et un état du ciel (nuit de 0 à 1, grisaille de 0 à 1). */
export function paletteFor(ambiance: Ambiance, night: number, dull: number): Palette {
  const d = DAY[ambiance], n = NIGHT[ambiance];
  const out = {} as Palette;
  for (const k of KEYS) {
    ca.set(d[k]).lerp(cb.set(n[k]), night);
    if (dull > 0) {
      // Temps couvert : on tire chaque couleur vers son gris.
      const l = ca.r * 0.3 + ca.g * 0.55 + ca.b * 0.15;
      ca.lerp(grey.setRGB(l, l, l * 1.03), dull * 0.45);
    }
    out[k] = '#' + ca.getHexString();
  }
  return out;
}

type Bind = [layer: string, prop: string, key: Key];

export interface GameStyle {
  glyphs: string | undefined;
  sources: StyleSpecification['sources'];
  layers: LayerSpecification[];
  binds: Bind[];
}

/** Hauteur des bâtiments de la carte : un peu tassée, pour que les abris et le porteur dominent. */
function heightExpr(prop: 'render_height' | 'render_min_height'): unknown {
  return ['*', 0.8, ['coalesce', ['get', prop], prop === 'render_height' ? 6 : 0]];
}

/** Vrai pour les bâtiments masqués au pied d'un abri (état posé par Stage.hideUnderShelters). */
const HIDDEN = ['==', ['feature-state', 'hide'], true];
const byHeight = (low: string, high: string): unknown => ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 3, low, 14, mixHex(low, high, 0.55), 34, high];
function mixHex(a: string, b: string, k: number): string { return '#' + ca.set(a).lerp(cb.set(b), k).getHexString(); }

export const BUILDING_LAYERS = ['building-3d', 'building-win', 'building-roof'];
/** Épaisseur de la dalle de toit, en mètres. */
const ROOF = 0.45;

/** Motif des fenêtres allumées (transparent ailleurs), plaqué sur les murs à la tombée du jour. */
export function windowPattern(): { width: number; height: number; data: Uint8Array } {
  const n = 64, data = new Uint8Array(n * n * 4);
  // Grille de 4 x 4 fenêtres ; tirage fixe pour un rendu identique partout.
  const lit = [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0];
  const warm = [[255, 206, 128], [255, 180, 96], [255, 226, 170], [190, 226, 240]];
  for (let k = 0; k < 16; k++) {
    if (!lit[k]) continue;
    const cx = (k % 4) * 16 + 5, cy = Math.floor(k / 4) * 16 + 4, col = warm[(k * 7) % warm.length];
    for (let y = cy; y < cy + 8; y++) for (let x = cx; x < cx + 5; x++) {
      const i = (y * n + x) * 4;
      data[i] = col[0]; data[i + 1] = col[1]; data[i + 2] = col[2]; data[i + 3] = 255;
    }
  }
  return { width: n, height: n, data };
}

/** Largeur d'une rue en pixels au zoom 20 (0 : largeur d'origine). Les liserés dépassent de chaque côté. */
function roadWidth(id: string): number {
  if (!(id.startsWith('road_') || id.startsWith('bridge_')) || id.includes('rail')) return 0;
  const edge = id.endsWith('_casing') ? 12 : 0;
  if (id.includes('path_pedestrian')) return 34;
  if (/motorway_link|_link/.test(id)) return 90 + edge;
  if (/motorway|trunk_primary/.test(id)) return 170 + edge;
  if (id.includes('secondary_tertiary')) return 150 + edge;
  if (id.includes('service_track')) return 64 + edge;
  if (id.includes('minor') || id.includes('street')) return 112 + edge;
  return 0;
}

/** Transforme le style « liberty » : ne garde que les couches utiles et note quelle couleur va où. */
export function buildGameStyle(src: StyleSpecification): GameStyle {
  const layers: LayerSpecification[] = [];
  const binds: Bind[] = [];
  const fill = (l: LayerSpecification, key: Key): void => {
    const c = { ...l, paint: { 'fill-color': '#000', 'fill-antialias': true } } as LayerSpecification;
    layers.push(c); binds.push([l.id, 'fill-color', key]);
  };
  const line = (l: LayerSpecification, key: Key): void => {
    const paint: Record<string, unknown> = { ...((l as { paint?: Record<string, unknown> }).paint ?? {}), 'line-color': '#000' };
    // Rues à l'échelle du monde de jeu : leur largeur suit le sol (doublement par niveau de zoom),
    // pour rester de vraies chaussées sous les pieds du porteur, bordées d'un liseré.
    const w = roadWidth(l.id);
    if (w) paint['line-width'] = ['interpolate', ['exponential', 2], ['zoom'], 14, w / 64, 20, w];
    layers.push({ ...l, paint } as LayerSpecification); binds.push([l.id, 'line-color', key]);
  };
  for (const l of src.layers) {
    const id = l.id;
    if (l.type === 'fill') {
      if (id === 'park' || id === 'landcover_grass' || id === 'landuse_pitch' || id === 'landuse_track' || id === 'landuse_cemetery') fill(l, 'park');
      else if (id === 'landcover_wood') fill(l, 'wood');
      else if (id === 'landuse_residential' || id === 'landuse_hospital' || id === 'landuse_school' || id === 'aeroway_fill') fill(l, 'urban');
      else if (id === 'landcover_sand') fill(l, 'sand');
      else if (id === 'water') fill(l, 'water');
    } else if (l.type === 'line') {
      if (id.startsWith('tunnel_') || id.includes('hatching')) continue;
      if (id.startsWith('waterway_')) line(l, 'water');
      else if (id.startsWith('aeroway_')) line(l, 'road');
      else if (id.startsWith('road_') || id.startsWith('bridge_')) {
        if (id.endsWith('_casing')) line(l, 'roadEdge');
        else if (id.includes('rail')) line(l, 'rail');
        else if (id.includes('path_pedestrian')) line(l, 'path');
        else if (/motorway|trunk_primary|secondary_tertiary/.test(id)) line(l, 'roadMajor');
        else line(l, 'road');
      }
    } else if (l.type === 'symbol' && id.startsWith('highway-name')) {
      // Noms de rues : gardés, mais discrets.
      const layout = { ...(l.layout ?? {}), 'text-size': 11, 'text-letter-spacing': 0.08, 'text-transform': 'uppercase', 'symbol-spacing': 420 };
      layers.push({ ...l, minzoom: 15.5, layout, paint: { 'text-color': '#000', 'text-halo-color': '#000', 'text-halo-width': 1.2, 'text-opacity': 0.5 } } as LayerSpecification);
      binds.push([id, 'text-color', 'text'], [id, 'text-halo-color', 'halo']);
    }
  }
  // Bâtiments extrudés en 3D, reconstruits à notre façon : murs en dégradé vertical, fenêtres allumées
  // le soir, et une fine dalle de toit d'une autre teinte qui découpe chaque volume.
  const h = heightExpr('render_height'), base = heightExpr('render_min_height');
  // Bâtiment masqué : hauteur nulle (il ne reste qu'une dalle au sol, de la couleur du terrain).
  const wall = { 'fill-extrusion-height': ['case', HIDDEN, 0, h], 'fill-extrusion-base': base };
  const common = { type: 'fill-extrusion', source: SOURCE, 'source-layer': 'building', filter: ['!', ['has', 'hide_3d']] };
  layers.push({ ...common, id: 'building-3d', minzoom: 14, paint: { 'fill-extrusion-color': '#000', 'fill-extrusion-opacity': 1, 'fill-extrusion-vertical-gradient': true, ...wall } } as unknown as LayerSpecification);
  layers.push({ ...common, id: 'building-win', minzoom: 16.5, layout: { visibility: 'none' }, paint: { 'fill-extrusion-pattern': 'fenetres', 'fill-extrusion-opacity': 1, 'fill-extrusion-vertical-gradient': false, ...wall } } as unknown as LayerSpecification);
  layers.push({
    ...common, id: 'building-roof', minzoom: 15,
    paint: {
      'fill-extrusion-color': '#000', 'fill-extrusion-opacity': 1, 'fill-extrusion-vertical-gradient': false,
      'fill-extrusion-height': ['case', HIDDEN, 0, ['+', h, ROOF]], 'fill-extrusion-base': ['case', HIDDEN, 0, h],
    },
  } as unknown as LayerSpecification);
  const sources: StyleSpecification['sources'] = {};
  if (src.sources[SOURCE]) sources[SOURCE] = src.sources[SOURCE];
  return { glyphs: src.glyphs, sources, layers, binds };
}

/** Applique une palette aux couches de la carte. */
export function applyPalette(map: MlMap, style: GameStyle | null, p: Palette): void {
  if (map.getLayer('background')) map.setPaintProperty('background', 'background-color', p.land);
  if (map.getLayer('veil')) map.setPaintProperty('veil', 'fill-color', p.veil);
  if (!style) return;
  for (const [layer, prop, key] of style.binds) if (map.getLayer(layer)) map.setPaintProperty(layer, prop, p[key]);
  if (map.getLayer('building-3d')) map.setPaintProperty('building-3d', 'fill-extrusion-color', ['case', HIDDEN, p.urban, byHeight(p.bLow, p.bHigh)]);
  if (map.getLayer('building-roof')) map.setPaintProperty('building-roof', 'fill-extrusion-color', ['case', HIDDEN, p.urban, byHeight(p.roofLow, p.roofHigh)]);
}
