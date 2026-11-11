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
  bLow: string; bHigh: string; text: string; halo: string; veil: string;
}
type Key = keyof Palette;
const KEYS: Key[] = ['land', 'urban', 'park', 'wood', 'water', 'sand', 'road', 'roadMajor', 'roadEdge', 'path', 'rail', 'bLow', 'bHigh', 'text', 'halo', 'veil'];

/** Palettes de jour. « crépuscule » est la référence historique du jeu (vert nuit + ambre). */
const DAY: Record<Ambiance, Palette> = {
  'crépuscule': {
    land: '#14201f', urban: '#172624', park: '#183227', wood: '#15301f', water: '#0e2c37', sand: '#2a2c21',
    road: '#2f4440', roadMajor: '#3b5650', roadEdge: '#0f1918', path: '#6b5a36', rail: '#5a4a2c',
    bLow: '#243b3c', bHigh: '#3a5a56', text: '#e6e1d3', halo: '#14201f', veil: '#080d0d',
  },
  clair: {
    land: '#efe8d6', urban: '#e9e1cd', park: '#cbe0a8', wood: '#b4d394', water: '#9fd6e0', sand: '#f3e4b3',
    road: '#fffdf7', roadMajor: '#ffeec6', roadEdge: '#d6ccb6', path: '#e0c998', rail: '#c2b7a3',
    bLow: '#f4ecdc', bHigh: '#dccfb6', text: '#7b705b', halo: '#efe8d6', veil: '#8d99a0',
  },
};
/** Palettes de pleine nuit. */
const NIGHT: Record<Ambiance, Palette> = {
  'crépuscule': {
    land: '#0a1113', urban: '#0c1517', park: '#0c1a16', wood: '#0a1812', water: '#07161e', sand: '#151812',
    road: '#1a282a', roadMajor: '#22363a', roadEdge: '#070c0d', path: '#3d3421', rail: '#33291a',
    bLow: '#152226', bHigh: '#203438', text: '#a9b3ae', halo: '#0a1113', veil: '#030606',
  },
  clair: {
    land: '#172030', urban: '#1a2436', park: '#16302e', wood: '#132b28', water: '#0d1a2e', sand: '#2a2c33',
    road: '#2c3b55', roadMajor: '#384b6b', roadEdge: '#101724', path: '#5a5545', rail: '#4a4a52',
    bLow: '#263450', bHigh: '#34476a', text: '#c5d0e6', halo: '#172030', veil: '#0a0f18',
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

function buildingColor(p: Palette): unknown {
  return ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 3, p.bLow, 30, p.bHigh];
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
    const paint = { ...((l as { paint?: Record<string, unknown> }).paint ?? {}), 'line-color': '#000' };
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
  // Bâtiments extrudés en 3D, reconstruits à notre façon.
  layers.push({
    id: 'building-3d', type: 'fill-extrusion', source: SOURCE, 'source-layer': 'building', minzoom: 14,
    filter: ['!', ['has', 'hide_3d']],
    paint: {
      'fill-extrusion-color': '#000', 'fill-extrusion-opacity': 1, 'fill-extrusion-vertical-gradient': true,
      'fill-extrusion-height': heightExpr('render_height'), 'fill-extrusion-base': heightExpr('render_min_height'),
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
  if (map.getLayer('building-3d')) map.setPaintProperty('building-3d', 'fill-extrusion-color', buildingColor(p));
}
