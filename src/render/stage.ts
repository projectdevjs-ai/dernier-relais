// La scène du jeu : UN SEUL rendu. La carte MapLibre inclinée, restylée en monde de jeu,
// et les objets three.js (porteur, abris, colis, effets) dessinés dans la carte.
import * as THREE from 'three';
import maplibregl, { type GeoJSONSource, type Map as MlMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { cellBounds, type LngLat } from '../core/geo';
import type { Ambiance, CacheView, FrontView, GameView, JamView, StageApi, StageEvents, WandererView, Weather } from '../game/api';
import { CACHE_TOP, Caches } from './caches';
import { Fronts } from './fronts';
import { Celebration, Dangers, FxKit, ScanPulse } from './fx';
import { Jams } from './jams';
import { LAYER_ID, Layer3D } from './layer';
import { applyPalette, buildGameStyle, type GameStyle, paletteFor, STYLE_URL } from './mapstyle';
import { PARCEL_TOP, Parcels, parcelModel } from './parcels';
import { Porter } from './porter';
import { Shelters } from './shelters';
import { computeEnv, Sky } from './sky';
import { WANDERER_HEIGHT, Wanderers } from './wanderers';

export interface StageOptions { center?: LngLat; ambiance?: Ambiance }

const DEFAULT_CENTER: LngLat = [-1.5761, 47.1822];
const ZOOM = 19.4;
const PITCH = 62;
/** Part de la hauteur d'écran laissée au-dessus du point suivi : place le porteur dans le tiers bas. */
const TOP_PADDING = 0.46;
/** Au-delà de cette distance à l'ancre (mètres), on recale le repère local. */
const REANCHOR_M = 4000;
// Listes vides partagées : une vue sans systèmes secondaires n'alloue rien.
const NO_CACHES: CacheView[] = [], NO_WANDERERS: WandererView[] = [], NO_FRONTS: FrontView[] = [], NO_JAMS: JamView[] = [];

export class Stage implements StageApi {
  /** La carte MapLibre (lecture seule : pour brancher des contrôles si besoin). */
  readonly map: MlMap;
  private readonly events: StageEvents;
  private readonly layer: Layer3D;
  private readonly kit = new FxKit();
  private readonly sky: Sky;
  private readonly porter: Porter;
  private readonly shelters: Shelters;
  private readonly parcels: Parcels;
  private readonly dangers: Dangers;
  private readonly caches: Caches;
  private readonly wanderers: Wanderers;
  private readonly fronts: Fronts;
  private readonly jams: Jams;
  private readonly scan: ScanPulse;
  private readonly party: Celebration;

  private ambiance: Ambiance;
  private envKey = '';
  private style: GameStyle | null = null;
  private view: GameView | null = null;
  private ready = false;
  private follow = true;
  /** Après jumpTo : on attend que le joueur arrive avant de reprendre le suivi. */
  private holdUntil = 0;
  private snapNext = true;
  private readonly cam = new THREE.Vector3();
  private camPlaced = false;
  private readonly v = new THREE.Vector3();
  private readonly ll: LngLat = [0, 0];
  private readonly sa = { x: 0, y: 0 };
  private readonly sb = { x: 0, y: 0 };
  private readonly carried: string[] = [];
  /** Temps affiché quand le joueur est dans un front : le temps réel, forcé en orage. */
  private readonly frontWx: Weather = { kind: 'orage', windKmh: 45, tempC: 10, night: false, sunAltDeg: 20 };
  private veilKey = '';
  private raf = 0;
  private last = 0;
  private timeS = 0;

  constructor(container: HTMLElement | string, events: StageEvents, opts: StageOptions = {}) {
    this.events = events;
    this.ambiance = opts.ambiance ?? 'crépuscule';
    const center = opts.center ?? DEFAULT_CENTER;
    this.layer = new Layer3D(center);
    const pal = paletteFor(this.ambiance, 0, 0);
    this.map = new maplibregl.Map({
      container,
      // Style minimal au départ : la scène 3D s'affiche même si la carte ne se charge pas.
      style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': pal.land } }] },
      center, zoom: ZOOM, pitch: PITCH, bearing: -18,
      minZoom: 15, maxZoom: 20.5, maxPitch: 70,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      canvasContextAttributes: { antialias: true },
      attributionControl: false,
      fadeDuration: 150,
    });
    this.map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: '© OpenFreeMap © OpenMapTiles © OpenStreetMap' }), 'top-right');
    // Zoom et rotation autour du joueur plutôt qu'autour des doigts.
    this.map.touchZoomRotate.enable({ around: 'center' });
    this.map.scrollZoom.enable({ around: 'center' });
    this.map.touchPitch.enable();
    // Mention des sources : repliée par défaut (un toucher l'ouvre).
    this.map.once('load', () => this.map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));

    const scene = this.layer.scene;
    this.sky = new Sky(scene);
    this.porter = new Porter(scene, this.kit);
    this.shelters = new Shelters(scene, this.kit, this.layer);
    this.parcels = new Parcels(scene, this.kit, this.layer);
    this.dangers = new Dangers(scene, this.kit, this.layer);
    this.caches = new Caches(scene, this.kit, this.layer);
    this.wanderers = new Wanderers(scene, this.kit, this.layer);
    this.fronts = new Fronts(scene, this.kit, this.layer);
    this.jams = new Jams(scene, this.kit, this.layer);
    this.scan = new ScanPulse(scene, this.kit);
    this.party = new Celebration(scene, this.kit, Math.min(window.devicePixelRatio || 1, 2));

    this.map.on('load', () => this.onLoad());
    this.map.on('resize', () => this.applyPadding());
    this.map.on('dragstart', () => { this.follow = false; });
    this.map.on('click', e => this.onTap(e.point.x, e.point.y, [e.lngLat.lng, e.lngLat.lat]));
    this.raf = requestAnimationFrame(this.tick);
  }

  // ---------------------------------------------------------------- API publique

  sync(view: GameView): void {
    this.view = view;
    if (this.ready) this.apply(view);
  }

  pulseScan(rangeM: number): void {
    if (!this.ready || !this.porter.root.visible) return;
    this.scan.start(this.porter.pos, rangeM);
  }

  celebrate(shelterId: string): void {
    const it = this.shelters.get(shelterId);
    if (it) this.party.start(it.group.position, it.height);
  }

  setAmbiance(a: Ambiance): void {
    if (a === this.ambiance) return;
    this.ambiance = a;
    this.refreshEnv();
  }

  recenter(): void {
    this.follow = true;
    this.holdUntil = 0;
    // On repart du centre actuel de la carte : la caméra glisse vers le joueur.
    const c = this.map.getCenter();
    this.layer.toLocal([c.lng, c.lat], this.cam);
  }

  jumpTo(at: LngLat): void {
    this.map.jumpTo({ center: at });
    this.layer.toLocal(at, this.cam);
    this.camPlaced = true;
    this.follow = true;
    this.snapNext = true;
    this.holdUntil = performance.now() + 4000;
  }

  /** Arrête le rendu et libère la carte. */
  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.map.remove();
  }

  // ---------------------------------------------------------------- Mise en place

  private onLoad(): void {
    const map = this.map;
    map.addSource('veil', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer(this.layer);
    map.addLayer({ id: 'veil', type: 'fill', source: 'veil', paint: { 'fill-color': '#000', 'fill-opacity': 0.32 } }, LAYER_ID);
    this.applyPadding();
    this.ready = true;
    this.refreshEnv();
    if (this.view) this.apply(this.view);
    void this.installStyle();
  }

  /** Charge le style « liberty », le transforme, puis ajoute ses couches sous la scène 3D. */
  private async installStyle(): Promise<void> {
    try {
      const res = await fetch(STYLE_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const style = buildGameStyle(await res.json() as StyleSpecification);
      const map = this.map;
      if (style.glyphs) map.setGlyphs(style.glyphs);
      for (const [id, src] of Object.entries(style.sources)) if (!map.getSource(id)) map.addSource(id, src);
      // Aplats et noms de rues sous le voile d'exploration ; bâtiments extrudés juste sous la scène 3D.
      for (const l of style.layers) map.addLayer(l, l.id === 'building-3d' ? LAYER_ID : 'veil');
      this.style = style;
      this.envKey = '';
      this.refreshEnv();
    } catch (err) {
      console.warn('[render] carte indisponible, fond uni', err);
    }
  }

  private applyPadding(): void {
    const h = this.map.getContainer().clientHeight;
    this.map.setPadding({ top: Math.round(h * TOP_PADDING), bottom: 0, left: 0, right: 0 });
  }

  /** Recalcule ciel, palette et lumières si l'ambiance ou la météo ont changé. */
  private refreshEnv(): void {
    let w = this.view?.weather ?? null;
    if (w && this.fronts.inside) {
      // Dans un front : pluie et ciel d'orage, quelle que soit la météo réelle.
      const f = this.frontWx;
      f.windKmh = Math.max(45, w.windKmh); f.tempC = w.tempC; f.night = w.night; f.sunAltDeg = w.sunAltDeg;
      w = f;
    }
    const env = computeEnv(this.ambiance, w);
    if (env.key === this.envKey || !this.ready) return;
    this.envKey = env.key;
    const pal = paletteFor(env.ambiance, env.night, env.dull);
    applyPalette(this.map, this.style, pal);
    this.map.setPaintProperty('veil', 'fill-opacity', env.dark ? 0.45 : 0.32);
    this.map.setLight({ anchor: 'viewport', position: [1.3, 215, 42], color: env.night > 0.5 ? '#d5e4e4' : env.ambiance === 'clair' ? '#fff6e6' : '#ece9da', intensity: env.ambiance === 'clair' ? 0.42 - env.night * 0.2 : 0.3 - env.night * 0.12 });
    this.map.setSky({ 'sky-color': pal.land, 'horizon-color': pal.urban, 'fog-color': pal.land, 'sky-horizon-blend': 0.7, 'horizon-fog-blend': 0.8, 'fog-ground-blend': 0.4 });
    this.sky.apply(env, w);
    this.kit.applyEnv(env);
    this.shelters.applyEnv(env);
    this.porter.applyEnv(env);
    this.map.triggerRepaint();
  }

  /** Brume d'exploration : voile léger sur les cases chargées qui n'ont pas encore été parcourues. */
  private refreshVeil(view: GameView): void {
    const key = `${view.visited.length}|${view.loadedCells.length}|${view.loadedCells[0] ?? ''}|${view.visited[view.visited.length - 1] ?? ''}`;
    if (key === this.veilKey) return;
    this.veilKey = key;
    const seen = new Set(view.visited);
    const features: GeoJSON.Feature[] = [];
    for (const id of view.loadedCells) {
      if (seen.has(id)) continue;
      const [x, y] = id.split('/').map(Number);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const b = cellBounds({ x, y, id });
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[b.w, b.s], [b.e, b.s], [b.e, b.n], [b.w, b.n], [b.w, b.s]]] } });
    }
    (this.map.getSource('veil') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  }

  // ---------------------------------------------------------------- Synchronisation

  private apply(view: GameView): void {
    this.fronts.sync(view.fronts ?? NO_FRONTS);
    this.refreshEnv();
    const at = view.player.at;
    if (at) {
      // Recalage du repère local si le joueur est parti loin de l'ancre.
      this.layer.toLocal(at, this.v);
      if (this.v.lengthSq() > REANCHOR_M * REANCHOR_M) {
        this.layer.setAnchor(at);
        this.shelters.reposition(); this.parcels.reposition(); this.dangers.reposition();
        this.caches.reposition(); this.wanderers.reposition(); this.fronts.reposition(); this.jams.reposition();
        this.layer.toLocal(at, this.v);
        this.snapNext = true;
        this.camPlaced = false;
      }
      let snap = this.snapNext;
      if (this.holdUntil) {
        // Après un saut de caméra : dès que le joueur est arrivé sur place, on reprend le suivi.
        if (this.v.distanceTo(this.cam) < 500 || performance.now() > this.holdUntil) { this.holdUntil = 0; snap = true; }
      }
      this.snapNext = false;
      this.porter.setTarget(this.v, view.player.headingDeg, view.player.moving ? view.player.speedMps : 0, snap);
    } else {
      this.porter.hide();
    }
    this.carried.length = 0;
    for (const o of view.orders) if (o.state === 'porté') this.carried.push(parcelModel(o));
    this.porter.setCarried(this.carried);
    this.shelters.sync(view.shelters);
    this.parcels.sync(view.orders);
    this.dangers.sync(view.dangers);
    this.caches.sync(view.caches ?? NO_CACHES);
    this.wanderers.sync(view.wanderers ?? NO_WANDERERS);
    this.jams.sync(view.jams ?? NO_JAMS);
    this.refreshVeil(view);
    this.map.triggerRepaint();
  }

  // ---------------------------------------------------------------- Boucle d'animation

  private readonly tick = (now: number): void => {
    this.raf = requestAnimationFrame(this.tick);
    if (!this.ready || document.hidden) { this.last = now; return; }
    // Scène calme (personnages au repos seulement) : 30 images par seconde suffisent.
    const busy = this.porter.moving || this.scan.active || this.party.active || this.sky.animated || this.map.isMoving();
    if (!busy && now - this.last < 30) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.timeS += dt;

    this.porter.update(dt);
    this.kit.update(this.timeS);
    this.scan.update(dt);
    this.party.update(dt);
    this.parcels.update(this.timeS);
    this.dangers.update(this.timeS);
    this.caches.update(this.timeS);
    this.wanderers.update(dt, this.timeS);
    this.fronts.update(dt);
    this.jams.update(this.timeS);
    this.shelters.update(dt, this.timeS, this.porter.pos, (this.map.getBearing() * Math.PI) / 180, (this.map.getPitch() * Math.PI) / 180);

    // Suivi caméra : le centre glisse vers le porteur, sans à-coup.
    let moved = false;
    if (this.follow && !this.holdUntil && this.porter.root.visible) {
      if (!this.camPlaced) { this.cam.copy(this.porter.pos); this.camPlaced = true; moved = true; }
      const dx = this.porter.pos.x - this.cam.x, dz = this.porter.pos.z - this.cam.z;
      if (dx * dx + dz * dz > 0.0004) {
        const k = 1 - Math.exp(-dt * 7);
        this.cam.x += dx * k; this.cam.z += dz * k;
        moved = true;
      }
      if (moved) this.map.jumpTo({ center: this.layer.toLngLat(this.cam.x, this.cam.z, this.ll) });
    }
    this.sky.update(this.timeS, this.porter.root.visible ? this.porter.pos : this.cam);
    if (!moved) this.map.triggerRepaint();
  };

  // ---------------------------------------------------------------- Toucher

  /** Distance (pixels) du point p au segment a-b à l'écran. */
  private static segDist(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
    const t = len > 0 ? Math.min(1, Math.max(0, ((px - a.x) * dx + (py - a.y) * dy) / len)) : 0;
    return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
  }

  /** Test de toucher par distance à l'écran, avec une zone généreuse (doigt). */
  private onTap(px: number, py: number, at: LngLat): void {
    let best = 1, kind: 'abri' | 'colis' | 'cache' | 'rôdeur' | null = null, id = '';
    for (const p of this.parcels.all) {
      const g = p.group.position;
      if (!this.layer.toScreen(g.x, 0, g.z, this.sa) || !this.layer.toScreen(g.x, PARCEL_TOP, g.z, this.sb)) continue;
      const d = Stage.segDist(px, py, this.sa, this.sb) / 38;
      if (d < best) { best = d; kind = 'colis'; id = p.id; }
    }
    for (const s of this.shelters.all) {
      const g = s.group.position;
      if (!this.layer.toScreen(g.x, 0, g.z, this.sa) || !this.layer.toScreen(g.x, s.height, g.z, this.sb)) continue;
      // Zone proportionnelle à la taille apparente du bâtiment, jamais plus petite qu'un doigt.
      const reach = Math.max(44, Math.hypot(this.sb.x - this.sa.x, this.sb.y - this.sa.y) * 0.55);
      const d = Stage.segDist(px, py, this.sa, this.sb) / reach;
      if (d < best) { best = d; kind = 'abri'; id = s.id; }
    }
    for (const c of this.caches.all) {
      const g = c.group.position;
      if (!this.layer.toScreen(g.x, 0, g.z, this.sa) || !this.layer.toScreen(g.x, CACHE_TOP, g.z, this.sb)) continue;
      const d = Stage.segDist(px, py, this.sa, this.sb) / 38;
      if (d < best) { best = d; kind = 'cache'; id = c.id; }
    }
    for (const w of this.wanderers.all) {
      const g = w.group.position;
      if (!this.layer.toScreen(g.x, 0, g.z, this.sa) || !this.layer.toScreen(g.x, WANDERER_HEIGHT, g.z, this.sb)) continue;
      const d = Stage.segDist(px, py, this.sa, this.sb) / 38;
      if (d < best) { best = d; kind = 'rôdeur'; id = w.id; }
    }
    // Cache ou rôdeur : si personne n'écoute ce toucher, il compte comme un toucher du sol.
    if (kind === 'cache' && this.events.onTapCache) this.events.onTapCache(id);
    else if (kind === 'rôdeur' && this.events.onTapWanderer) this.events.onTapWanderer(id);
    else if (kind === 'cache' || kind === 'rôdeur') this.events.onTapGround(at);
    else if (kind === 'abri') this.events.onTapShelter(id);
    else if (kind === 'colis') this.events.onTapOrder(id);
    else this.events.onTapGround(at);
  }
}
