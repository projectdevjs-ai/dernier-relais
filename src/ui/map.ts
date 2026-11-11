// Affichage de test : la carte des rues, les cases, les abris et les emplacements de colis.
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { type Cell, cellBounds, type LngLat } from '../core/geo';
import type { CellContent } from '../world/types';

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
const pt = (at: LngLat, properties: Record<string, unknown> = {}): GeoJSON.Feature => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: at } });

export class MapView {
  readonly map: maplibregl.Map;
  private ready = false;
  private last: { cells: CellContent[]; here: Cell | null; me: LngLat | null } = { cells: [], here: null, me: null };
  follow = true;

  constructor(el: string, start: LngLat, onTap: (p: LngLat) => void) {
    this.map = new maplibregl.Map({ container: el, style: 'https://tiles.openfreemap.org/styles/liberty', center: start, zoom: 14.8, pitch: 40, minZoom: 12, maxZoom: 19 });
    this.map.setPadding({ top: 60, bottom: 250, left: 0, right: 0 });
    this.map.on('load', () => {
      const src = (id: string) => this.map.addSource(id, { type: 'geojson', data: fc([]) });
      ['grid', 'parcels', 'shelters', 'me'].forEach(src);
      const css = getComputedStyle(document.documentElement), v = (n: string) => css.getPropertyValue(n).trim();
      this.map.addLayer({ id: 'grid', type: 'line', source: 'grid', paint: { 'line-color': v('--bg'), 'line-opacity': ['case', ['get', 'here'], 0.9, 0.3], 'line-width': ['case', ['get', 'here'], 2, 1] } });
      this.map.addLayer({ id: 'parcels', type: 'circle', source: 'parcels', paint: { 'circle-radius': 5, 'circle-color': v('--parcel'), 'circle-stroke-color': v('--bg'), 'circle-stroke-width': 1.5 } });
      this.map.addLayer({ id: 'shelters', type: 'circle', source: 'shelters', paint: { 'circle-radius': 11, 'circle-color': v('--shelter'), 'circle-stroke-color': v('--bg'), 'circle-stroke-width': 2, 'circle-opacity': ['case', ['==', ['get', 'source'], 'lieu'], 1, 0.6] } });
      this.map.addLayer({ id: 'shelter-names', type: 'symbol', source: 'shelters', layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, 1.4], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': v('--fg'), 'text-halo-color': v('--bg'), 'text-halo-width': 1.5 } });
      this.map.addLayer({ id: 'me', type: 'circle', source: 'me', paint: { 'circle-radius': 8, 'circle-color': v('--me'), 'circle-stroke-color': v('--bg'), 'circle-stroke-width': 3 } });
      this.ready = true;
      this.draw();
    });
    this.map.on('click', e => onTap([e.lngLat.lng, e.lngLat.lat]));
    this.map.on('dragstart', () => { this.follow = false; });
  }
  update(cells: CellContent[], here: Cell | null, me: LngLat | null): void { this.last = { cells, here, me }; this.draw(); }
  private set(id: string, f: GeoJSON.Feature[]): void { (this.map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(fc(f)); }
  private draw(): void {
    if (!this.ready) return;
    const { cells, here, me } = this.last;
    this.set('grid', cells.map(c => {
      const [x, y] = c.id.split('/').map(Number), b = cellBounds({ x, y, id: c.id });
      return { type: 'Feature', properties: { here: c.id === here?.id }, geometry: { type: 'LineString', coordinates: [[b.w, b.s], [b.e, b.s], [b.e, b.n], [b.w, b.n], [b.w, b.s]] } };
    }));
    this.set('parcels', cells.flatMap(c => c.parcels.map(p => pt(p.at))));
    this.set('shelters', cells.flatMap(c => c.shelters.map(s => pt(s.at, { name: s.name, source: s.source }))));
    this.set('me', me ? [pt(me)] : []);
    if (me && this.follow) this.map.easeTo({ center: me, duration: 600 });
  }
}
