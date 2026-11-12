// La scène du jeu : UN SEUL rendu. La carte MapLibre inclinée, restylée en monde de jeu,
// et les objets three.js (porteur, abris, colis, effets) dessinés dans la carte.
import * as THREE from 'three';
import maplibregl, { type Map as MlMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { LngLat } from '../core/geo';
import type { Ambiance, CacheView, FrontView, GameView, JamView, StageApi, StageEvents, WandererView, Weather } from '../game/api';
import { CameraRig, type TiltMode } from './camera';
import { CACHE_TOP, Caches } from './caches';
import { ExploreFog } from './fog';
import { Fronts } from './fronts';
import { Celebration, Dangers, FxKit, ScanPulse } from './fx';
import { Jams } from './jams';
import { LAYER_ID, Layer3D } from './layer';
import { applyPalette, BUILDING_LAYERS, buildGameStyle, type GameStyle, paletteFor, STYLE_URL, windowPattern } from './mapstyle';
import { PARCEL_TOP, Parcels, parcelModel } from './parcels';
import { Porter } from './porter';
import { Router } from './route';
import { Shelters } from './shelters';
import { computeEnv, Sky } from './sky';
import { Trail, type TrailTone } from './trail';
import { WANDERER_HEIGHT, Wanderers } from './wanderers';

export interface StageOptions { center?: LngLat; ambiance?: Ambiance; tilt?: TiltMode }

const DEFAULT_CENTER: LngLat = [-1.5761, 47.1822];
const ZOOM = 19.4;
const PITCH = 62;
const BEARING = -18;
const MIN_ZOOM = 15, MAX_ZOOM = 20.5, MAX_PITCH = 70;
/** Le cap de marche n'est relevé qu'après cette distance parcourue (mètres) : un GPS qui hésite ne fait pas tourner la caméra. */
const COURSE_STEP_M = 5;
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
  private readonly fog: ExploreFog;
  private readonly trail: Trail;
  private readonly router: Router;
  /** Cible du fil d'Ariane. */
  private readonly guideTo: LngLat = [0, 0];
  private guideKey = '';
  private guideTone: TrailTone = 'blue';
  private guideFar = false;
  private dark = true;
  private paused = false;
  /** Dernier instant où quelque chose a bougé (porteur, carte, effet) : au-delà, le rendu ralentit. */
  private lastBusy = 0;

  private ambiance: Ambiance;
  private envKey = '';
  private style: GameStyle | null = null;
  private view: GameView | null = null;
  private ready = false;
  private follow = true;
  /** Angle, zoom et inclinaison : gestes du joueur et caméra derrière le porteur (voir camera.ts). */
  private readonly rig: CameraRig;
  /** Cap de marche lissé (degrés, 0 = nord), relevé sur le déplacement réel du porteur ; null tant qu'il n'a pas avancé. */
  private course: number | null = null;
  private readonly courseRef = new THREE.Vector3();
  private courseSet = false;
  private camBusy = false;
  private readonly pad = { top: 0, bottom: 0, left: 0, right: 0 };
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
      center, zoom: ZOOM, pitch: PITCH, bearing: BEARING,
      minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, maxPitch: MAX_PITCH,
      // Aucun geste natif de MapLibre : le suivi du porteur recale la carte à chaque image (jumpTo), ce qui
      // annulait tout pincement ou rotation en cours. Les gestes sont gérés par CameraRig.
      interactive: false,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      canvasContextAttributes: { antialias: true },
      attributionControl: false,
      fadeDuration: 150,
    });
    this.map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: '© OpenFreeMap © OpenMapTiles © OpenStreetMap' }), 'top-right');
    this.rig = new CameraRig(this.map.getCanvasContainer(), {
      bearing: BEARING, zoom: ZOOM, pitch: PITCH, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, maxPitch: MAX_PITCH,
      onTap: (x, y) => { const at = this.map.unproject([x, y]); this.onTap(x, y, [at.lng, at.lat]); },
    });
    if (opts.tilt === '2d') this.rig.setTilt('2d');
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
    this.fog = new ExploreFog(scene, this.layer);
    this.trail = new Trail(scene, this.layer);
    this.router = new Router(() => { if (this.view && !this.paused) this.refreshGuide(this.view); });

    this.map.on('load', () => this.onLoad());
    this.map.on('resize', () => this.rig.invalidate());
    this.raf = requestAnimationFrame(this.tick);
  }

  // ---------------------------------------------------------------- API publique

  sync(view: GameView): void {
    this.view = view;
    // En pause, la vue est seulement mémorisée : rien n'est recalculé ni redessiné.
    if (this.ready && !this.paused) this.apply(view);
  }

  /**
   * Met la scène en pause (un autre écran la recouvre : labo 3D, prologue) : la boucle d'animation est
   * arrêtée et la carte n'est plus redessinée. À la reprise, la dernière vue reçue est appliquée.
   */
  setPaused(on: boolean): void {
    if (on === this.paused) return;
    this.paused = on;
    cancelAnimationFrame(this.raf);
    if (on) return;
    this.last = performance.now();
    this.lastBusy = this.last;
    if (this.ready) this.refreshEnv();
    if (this.ready && this.view) this.apply(this.view);
    this.raf = requestAnimationFrame(this.tick);
    this.map.triggerRepaint();
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

  /** Vue actuelle : '2d' (carte vue de dessus) ou '3d' (inclinée). */
  get tilt(): TiltMode { return this.rig.mode; }

  /** Choisit la vue : '2d' = carte vue de dessus, porteur repéré par sa flèche de cap ; '3d' = vue inclinée. Transition douce. */
  setTilt(mode: TiltMode): void {
    this.rig.setTilt(mode);
    this.porter.setFlat(mode === '2d');
    this.lastBusy = performance.now();
  }

  /** Bascule entre la vue 2D et la vue 3D ; renvoie la vue obtenue. */
  toggleTilt(): TiltMode {
    this.setTilt(this.rig.mode === '2d' ? '3d' : '2d');
    return this.rig.mode;
  }

  recenter(): void {
    this.follow = true;
    this.holdUntil = 0;
    // Zoom et inclinaison d'origine ; la caméra se replace derrière le porteur.
    this.rig.recenter();
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
    // Calque vide : il sert seulement de repère d'ordre (aplats de la carte dessous, bâtiments dessus).
    map.addSource('veil', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer(this.layer);
    map.addLayer({ id: 'veil', type: 'fill', source: 'veil', paint: { 'fill-color': '#000', 'fill-opacity': 0.32 } }, LAYER_ID);
    this.rig.invalidate();
    if (this.rig.mode === '2d') this.porter.setFlat(true);
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
      if (!map.hasImage('fenetres')) map.addImage('fenetres', windowPattern());
      for (const l of style.layers) map.addLayer(l, BUILDING_LAYERS.includes(l.id) ? LAYER_ID : 'veil');
      this.style = style;
      this.envKey = '';
      this.refreshEnv();
    } catch (err) {
      console.warn('[render] carte indisponible, fond uni', err);
    }
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
    if (env.key === this.envKey || !this.ready || this.paused) return;
    this.envKey = env.key;
    const pal = paletteFor(env.ambiance, env.night, env.dull);
    const clair = env.ambiance === 'clair', n = env.night;
    this.dark = env.dark;
    applyPalette(this.map, this.style, pal);
    // Lumière de la carte : rasante et chaude au crépuscule, haute et franche de jour, froide la nuit.
    // Plus elle est intense, plus les façades à l'ombre se détachent des façades éclairées.
    const sunAlt = w ? w.sunAltDeg : clair ? 40 : 12;
    const polar = n > 0.5 ? 50 : Math.min(80, Math.max(35, 90 - sunAlt));
    this.map.setLight({
      anchor: 'map', position: [1.5, clair ? 215 : 250, polar],
      color: n > 0.5 ? '#c8d6ff' : clair ? '#fff7ea' : '#ffe2c2',
      intensity: (clair ? 0.42 : 0.5) * (1 - env.dull * 0.4) * (1 - n * 0.25),
    });
    this.map.setSky({ 'sky-color': pal.sky, 'horizon-color': pal.horizon, 'fog-color': pal.haze, 'sky-horizon-blend': 0.75, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.5, 'atmosphere-blend': 0 });
    // Fenêtres allumées dès que le jour baisse.
    if (this.map.getLayer('building-win')) this.map.setLayoutProperty('building-win', 'visibility', (clair ? n >= 0.5 : true) ? 'visible' : 'none');
    this.fog.applyColors(pal.veil, pal.haze, clair && n < 0.5 ? 0.76 : 0.74);
    this.sky.apply(env, w, pal);
    this.kit.applyEnv(env);
    this.shelters.applyEnv(env);
    this.porter.applyEnv(env);
    this.map.triggerRepaint();
  }

  /** Fil d'Ariane : vers l'abri du colis porté le plus urgent, sinon vers le colis révélé le plus proche. */
  private refreshGuide(view: GameView): void {
    const at = view.player.at;
    let best: GameView['orders'][number] | null = null, carried = false;
    if (at) for (const o of view.orders) {
      const c = o.state === 'porté';
      if (c && !carried) { best = o; carried = true; continue; }
      if (c !== carried || !best) { if (!best) best = o; continue; }
      if (c) {
        const a = o.minutesLeft ?? Infinity, b = best.minutesLeft ?? Infinity;
        if (a < b || (a === b && o.distanceM < best.distanceM)) best = o;
      } else if (o.distanceM < best.distanceM) best = o;
    }
    if (!best || !at) { this.trail.clear(); return; }
    const to = carried ? best.destAt : best.at;
    // La clé de cible n'est refaite que si la cible change (pas de chaîne créée à chaque synchronisation).
    if (to[0] !== this.guideTo[0] || to[1] !== this.guideTo[1] || !this.guideKey) {
      this.guideTo[0] = to[0]; this.guideTo[1] = to[1];
      this.guideKey = `${to[0].toFixed(5)},${to[1].toFixed(5)}`;
    }
    this.guideTone = carried ? 'blue' : 'amber';
    // Tout près du but, la ligne n'apporte plus rien.
    this.guideFar = best.distanceM > 14;
    this.trail.set(this.router.get(at, this.guideTo, this.guideKey, performance.now()), this.guideTo, this.guideTone);
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
        this.fog.reposition(); this.trail.reposition();
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
      // Téléportation : le cap de marche repart de zéro (le saut n'est pas une direction).
      if (snap) this.courseSet = false;
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
    this.fog.sync(view.player.at, view.visited);
    this.refreshGuide(view);
    this.map.triggerRepaint();
  }

  // ---------------------------------------------------------------- Boucle d'animation

  private readonly tick = (now: number): void => {
    if (this.paused) return;
    this.raf = requestAnimationFrame(this.tick);
    if (!this.ready || document.hidden) { this.last = now; return; }
    // Scène calme (personnages au repos seulement) : 30 images par seconde suffisent.
    const busy = this.porter.moving || this.scan.active || this.party.active || this.sky.animated || this.camBusy || this.rig.active;
    if (busy) this.lastBusy = now;
    // Rien ne bouge depuis un moment : les balises pulsent encore, mais 20 images par seconde suffisent.
    if (!busy && now - this.last < (now - this.lastBusy > 8000 ? 48 : 30)) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.timeS += dt;

    this.porter.update(dt);
    this.kit.update(this.timeS);
    this.scan.update(dt);
    this.party.update(dt);
    this.parcels.update(this.timeS, dt);
    this.dangers.update(this.timeS);
    this.caches.update(this.timeS);
    this.wanderers.update(dt, this.timeS, this.porter.pos);
    this.fog.update(this.timeS);
    this.trail.update(dt, this.timeS, this.porter.pos, this.porter.root.visible && this.guideFar, this.dark);
    this.fronts.update(dt);
    this.jams.update(this.timeS);
    this.shelters.update(dt, this.timeS, this.porter.pos, (this.map.getBearing() * Math.PI) / 180, (this.map.getPitch() * Math.PI) / 180);

    // Cap de marche : relevé sur le chemin réellement parcouru, par pas de quelques mètres, et seulement
    // quand le jeu dit que le joueur avance. À l'arrêt il ne change pas : la caméra ne fait pas la girouette.
    const pp = this.porter.pos;
    if (!this.courseSet || !this.porter.root.visible) { this.courseRef.copy(pp); this.courseSet = this.porter.root.visible; }
    else {
      const cx = pp.x - this.courseRef.x, cz = pp.z - this.courseRef.z, d2 = cx * cx + cz * cz;
      if (d2 > 80 * 80) this.courseRef.copy(pp);
      else if (d2 > COURSE_STEP_M * COURSE_STEP_M) {
        if (this.view?.player.moving) this.course = (Math.atan2(cx, -cz) * 180) / Math.PI;
        this.courseRef.copy(pp);
      }
    }
    const camChanged = this.rig.update(dt, this.holdUntil ? null : this.course);
    this.camBusy = camChanged;

    // Suivi caméra : le centre glisse vers le porteur, sans à-coup. Les gestes ne changent que l'angle et le zoom.
    let moved = false;
    const tracking = this.follow && !this.holdUntil && this.porter.root.visible;
    if (tracking) {
      if (!this.camPlaced) { this.cam.copy(this.porter.pos); this.camPlaced = true; moved = true; }
      const dx = this.porter.pos.x - this.cam.x, dz = this.porter.pos.z - this.cam.z;
      if (dx * dx + dz * dz > 0.0004) {
        const k = 1 - Math.exp(-dt * 7);
        this.cam.x += dx * k; this.cam.z += dz * k;
        moved = true;
      }
    }
    if (moved || camChanged) {
      // Un seul recalage par image : centre, cap, zoom, inclinaison et cadrage ensemble.
      const rig = this.rig, k = Math.min(1, rig.pitch / PITCH);
      // Vue inclinée : porteur dans le tiers bas. Vue de dessus : porteur au milieu de l'écran.
      this.pad.top = Math.round(this.map.getContainer().clientHeight * TOP_PADDING * k);
      const cam = { bearing: rig.bearing, zoom: rig.mapZoom, pitch: rig.pitch, padding: this.pad };
      if (tracking) this.map.jumpTo({ ...cam, center: this.layer.toLngLat(this.cam.x, this.cam.z, this.ll) });
      else this.map.jumpTo(cam);
      moved = true;
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
