// Lecture des tuiles vectorielles OpenFreeMap (données OpenStreetMap, gratuites, sans clé).
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import type { LngLat } from '../core/geo';
import type { RawTile } from './types';

const TILEJSON = 'https://tiles.openfreemap.org/planet';
let template: Promise<string> | null = null;
const cache = new Map<string, Promise<RawTile>>();

function tileUrl(): Promise<string> {
  template ??= fetch(TILEJSON).then(r => { if (!r.ok) throw new Error('carte indisponible'); return r.json(); })
    .then((j: { tiles: string[] }) => j.tiles[0])
    .catch(e => { template = null; throw e; });
  return template;
}

export function loadTile(z: number, x: number, y: number): Promise<RawTile> {
  const key = `${z}/${x}/${y}`;
  let p = cache.get(key);
  if (!p) {
    p = fetchTile(z, x, y).catch(e => { cache.delete(key); throw e; });
    cache.set(key, p);
  }
  return p;
}

async function fetchTile(z: number, x: number, y: number): Promise<RawTile> {
  const url = (await tileUrl()).replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  const res = await fetch(url);
  const out: RawTile = { pois: [], places: [], roads: [] };
  if (res.status === 204 || res.status === 404) return out; // tuile vide (mer)
  if (!res.ok) throw new Error(`tuile ${z}/${x}/${y} : ${res.status}`);
  const vt = new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer())));
  const each = (layer: string, fn: (props: Record<string, unknown>, geom: GeoJSON.Geometry) => void) => {
    const l = vt.layers[layer];
    if (!l) return;
    for (let i = 0; i < l.length; i++) {
      const f = l.feature(i).toGeoJSON(x, y, z);
      fn((f.properties ?? {}) as Record<string, unknown>, f.geometry);
    }
  };
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const point = (g: GeoJSON.Geometry): LngLat | null =>
    g.type === 'Point' ? (g.coordinates as LngLat) : g.type === 'MultiPoint' ? (g.coordinates[0] as LngLat) : null;
  each('poi', (p, g) => { const at = point(g); if (at) out.pois.push({ name: str(p.name), cls: str(p.class), sub: str(p.subclass), at }); });
  each('place', (p, g) => { const at = point(g); if (at) out.places.push({ name: str(p.name), cls: str(p.class), at }); });
  each('transportation', (p, g) => {
    if (p.brunnel === 'tunnel') return;
    const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const pts of lines) out.roads.push({ cls: str(p.class), pts: pts as LngLat[] });
  });
  return out;
}
