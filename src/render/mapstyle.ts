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

/**
 * Palettes de PLEIN JOUR : lumineuses dans les deux ambiances. « crépuscule » n'est plus une nuit permanente
 * (son ancienne palette ardoise était appliquée même à midi) : c'est la variante chaude et contrastée —
 * sol ocre, toits de tuile, verts profonds — sous un ciel bleu.
 */
const DAY: Record<Ambiance, Palette> = {
  'crépuscule': {
    // Monde après l'effondrement : pierre, béton patiné, eau acier et végétation poussiéreuse.
    land:'#9e9e8c',urban:'#a7a394',park:'#7f9778',wood:'#607b67',water:'#658995',sand:'#b6a78d',
    road:'#d2cbb9',roadMajor:'#c6b39b',roadEdge:'#777f79',path:'#a7a087',rail:'#727d78',
    bLow:'#b9b6ab',bHigh:'#859294',roofLow:'#8f8176',roofHigh:'#6b8189',text:'#2c3c3c',halo:'#b9b6a7',veil:'#89968f',
    sky:'#778f9a',horizon:'#c7c3b9',haze:'#a9b3b1',
  },
  clair: {
    land:'#bbbcb0',urban:'#c5bfb2',park:'#98ae8d',wood:'#769483',water:'#7fa2ad',sand:'#d1bea4',
    road:'#e4e0d3',roadMajor:'#d5c5aa',roadEdge:'#929e99',path:'#bcb6a0',rail:'#899593',
    bLow:'#d0cec4',bHigh:'#9bacb2',roofLow:'#a59b8e',roofHigh:'#859fa7',text:'#30434a',halo:'#cdd0c4',veil:'#a2b1b3',
    sky:'#95b2c0',horizon:'#dae0da',haze:'#becbc8',
  },
};
/** Fin de journée : poussière ambrée, lumière rasante et béton cuivré. */
const GOLD: Record<Ambiance, Palette> = {
  'crépuscule': {
    land:'#8d8271',urban:'#988775',park:'#7a8564',wood:'#596c54',water:'#586d79',sand:'#ae9475',
    road:'#c5aa8d',roadMajor:'#b98d69',roadEdge:'#806b5e',path:'#ab886c',rail:'#807161',
    bLow:'#af9681',bHigh:'#857f7f',roofLow:'#9d7060',roofHigh:'#6e7882',text:'#3a3734',halo:'#a59582',veil:'#8e8478',
    sky:'#586b80',horizon:'#dca77b',haze:'#bba48f',
  },
  clair: {
    land:'#b6a48a',urban:'#b8a58c',park:'#969c77',wood:'#71826d',water:'#708c9c',sand:'#c4a984',
    road:'#d9c4a7',roadMajor:'#ddb588',roadEdge:'#988270',path:'#bf9e7c',rail:'#998471',
    bLow:'#cbb3a0',bHigh:'#a2968a',roofLow:'#b58872',roofHigh:'#859099',text:'#51483c',halo:'#c2b5a3',veil:'#a8a69b',
    sky:'#8398a4',horizon:'#e4b996',haze:'#d3bdab',
  },
};
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

/** Palette pour une ambiance et un état du ciel (nuit de 0 à 1, grisaille de 0 à 1, heure dorée de 0 à 1) : fondu continu jour → doré → nuit. */
export function paletteFor(ambiance: Ambiance, night: number, dull: number, gold = 0): Palette {
  const d = DAY[ambiance], g = GOLD[ambiance], n = NIGHT[ambiance];
  const out = {} as Palette;
  for (const k of KEYS) {
    ca.set(d[k]).lerp(cb.set(g[k]), gold).lerp(cb.set(n[k]), night);
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
/** Au-dessus de TALL_FROM mètres, seule la part TALL_KEEP de la hauteur est gardée. */
const TALL_FROM = 7, TALL_KEEP = 0.22;
function heightExpr(prop: 'render_height' | 'render_min_height'): unknown {
  // Hauteur réelle réduite à 80 %, puis tassée au-dessus de 7 m (22 % du surplus) : en centre-ville (immeubles
  // de 25 m) le joueur ne se retrouve plus au fond d'un canyon qui cache le sol, les colis et le fil d'Ariane.
  const real = ['*', 0.8, ['coalesce', ['get', prop], prop === 'render_height' ? 6 : 0]];
  return ['min', real, ['+', TALL_FROM, ['*', TALL_KEEP, ['-', real, TALL_FROM]]]];
}

const byHeight = (low: string, high: string): unknown => ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 3, low, 14, mixHex(low, high, 0.55), 34, high];
function mixHex(a: string, b: string, k: number): string { return '#' + ca.set(a).lerp(cb.set(b), k).getHexString(); }

export const BUILDING_LAYERS = ['building-3d', 'building-win', 'building-roof'];
/** Épaisseur de la dalle de toit, en mètres. */
const ROOF = 0.45;

/** Motif des murs à la tombée du jour : la teinte du mur, percée de quelques fenêtres allumées. */
export function windowPattern(wall = '#33464d'): { width: number; height: number; data: Uint8Array } {
  const n = 64, data = new Uint8Array(n * n * 4);
  ca.set(wall);
  const wr = Math.round(ca.r * 255), wg = Math.round(ca.g * 255), wb = Math.round(ca.b * 255);
  for (let i = 0; i < n * n * 4; i += 4) { data[i] = wr; data[i + 1] = wg; data[i + 2] = wb; data[i + 3] = 255; }
  // Grille de 4 x 4 fenêtres ; tirage fixe pour un rendu identique partout.
  const lit = [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0];
  const warm = [[255, 206, 128], [255, 180, 96], [255, 226, 170], [190, 226, 240]];
  for (let k = 0; k < 16; k++) {
    if (!lit[k]) continue;
    const cx = (k % 4) * 16 + 5, cy = Math.floor(k / 4) * 16 + 4, col = warm[(k * 7) % warm.length];
    for (let y = cy; y < cy + 9; y++) for (let x = cx; x < cx + 6; x++) {
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
  const wall = { 'fill-extrusion-height': h, 'fill-extrusion-base': base };
  const common = { type: 'fill-extrusion', source: SOURCE, 'source-layer': 'building', filter: ['!', ['has', 'hide_3d']] };
  layers.push({ ...common, id: 'building-3d', minzoom: 14, paint: { 'fill-extrusion-color': '#000', 'fill-extrusion-opacity': 1, 'fill-extrusion-vertical-gradient': true, ...wall } } as unknown as LayerSpecification);
  layers.push({ ...common, id: 'building-win', minzoom: 16.5, layout: { visibility: 'none' }, paint: { 'fill-extrusion-pattern': 'fenetres', 'fill-extrusion-opacity': 1, 'fill-extrusion-vertical-gradient': false, ...wall } } as unknown as LayerSpecification);
  layers.push({
    ...common, id: 'building-roof', minzoom: 15,
    paint: {
      'fill-extrusion-color': '#000', 'fill-extrusion-opacity': 1, 'fill-extrusion-vertical-gradient': false,
      'fill-extrusion-height': ['+', h, ROOF], 'fill-extrusion-base': h,
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
  if (map.hasImage('fenetres')) map.updateImage('fenetres', windowPattern(mixHex(p.bLow, p.bHigh, 0.7)));
  if (map.getLayer('building-3d')) map.setPaintProperty('building-3d', 'fill-extrusion-color', byHeight(p.bLow, p.bHigh));
  if (map.getLayer('building-roof')) map.setPaintProperty('building-roof', 'fill-extrusion-color', byHeight(p.roofLow, p.roofHigh));
}
