// Itinéraire piéton pour le fil d'Ariane : appel à un serveur OSRM public (gratuit, sans clé),
// avec cache, limitation stricte et repli en ligne droite (le résultat vaut alors null).
// Serveur piéton : celui de la communauté OpenStreetMap allemande (profil « foot » réel). Le serveur de
// démonstration router.project-osrm.org ne sert qu'un profil voiture : il n'est gardé qu'en secours,
// et son tracé est refusé s'il fait un détour de conducteur.
import { dist, type LngLat } from '../core/geo';

const SERVERS = [
  'https://routing.openstreetmap.de/routed-foot/route/v1/foot/',
  'https://router.project-osrm.org/route/v1/foot/',
];
/** Pas plus d'un appel toutes les 20 secondes. */
const MIN_GAP_MS = 20_000;
/** Nouvel appel seulement si le joueur s'est éloigné d'autant du point de départ du dernier calcul… */
const MOVE_M = 40;
/** …et qu'il a quitté le tracé connu d'au moins cette distance. */
const OFF_ROUTE_M = 25;
const TIMEOUT_MS = 6000;
const CACHE_MAX = 24;

/** Distance (mètres) du point p au segment a-b, en approximation plane locale. */
function segDist(p: LngLat, a: LngLat, b: LngLat): number {
  const k = Math.cos((p[1] * Math.PI) / 180) * 111320, ky = 110540;
  const ax = (a[0] - p[0]) * k, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * k, by = (b[1] - p[1]) * ky;
  const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  const t = len > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len)) : 0;
  return Math.hypot(ax + dx * t, ay + dy * t);
}
/** Distance du point au tracé. */
export function offRoute(p: LngLat, pts: LngLat[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) { const d = segDist(p, pts[i], pts[i + 1]); if (d < best) best = d; }
  return pts.length === 1 ? dist(p, pts[0]) : best;
}

export class Router {
  private readonly cache = new Map<string, LngLat[] | null>();
  private lastCallMs = -Infinity;
  private lastFrom: LngLat | null = null;
  private lastKey = '';
  private busy = false;
  /** Tracé en cours pour la cible `key` (null : ligne droite). */
  private current: LngLat[] | null = null;
  private currentKey = '';

  /** `onChange` est appelé quand un tracé arrive du réseau. */
  constructor(private readonly onChange: () => void, private readonly fetcher: typeof fetch = (...a) => fetch(...a)) {}

  /**
   * Tracé connu vers la cible (ou null : tracer tout droit). Lance au besoin un calcul en arrière-plan,
   * dans les limites fixées. `key` identifie la cible (elle change quand la destination change).
   */
  get(from: LngLat, to: LngLat, key: string, nowMs: number): LngLat[] | null {
    if (key !== this.currentKey) { this.currentKey = key; this.current = null; }
    const changed = key !== this.lastKey;
    const moved = !this.lastFrom || dist(from, this.lastFrom) > MOVE_M;
    const lost = !this.current || offRoute(from, this.current) > OFF_ROUTE_M;
    if ((changed || (moved && lost)) && !this.busy) {
      const ck = `${from[0].toFixed(4)},${from[1].toFixed(4)}>${key}`;
      if (this.cache.has(ck)) {
        this.current = this.cache.get(ck) ?? null;
        this.lastKey = key; this.lastFrom = [from[0], from[1]];
      } else if (nowMs - this.lastCallMs >= MIN_GAP_MS && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
        this.lastCallMs = nowMs; this.lastKey = key; this.lastFrom = [from[0], from[1]];
        void this.load([from[0], from[1]], [to[0], to[1]], key, ck);
      }
    }
    return this.current;
  }

  private async load(from: LngLat, to: LngLat, key: string, ck: string): Promise<void> {
    this.busy = true;
    let pts: LngLat[] | null = null;
    try {
      // Un seul serveur par appel : le secours n'est essayé que si le premier ne répond pas.
      for (const base of SERVERS) {
        pts = await this.ask(base, from, to);
        if (pts) break;
      }
    } finally { this.busy = false; }
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(ck, pts);
    if (key === this.currentKey) { this.current = pts; this.onChange(); }
  }

  private async ask(base: string, from: LngLat, to: LngLat): Promise<LngLat[] | null> {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const f = (p: LngLat): string => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
      const res = await this.fetcher(`${base}${f(from)};${f(to)}?overview=full&geometries=geojson`, { signal: ctl.signal });
      if (!res.ok) return null;
      const j = await res.json() as { code?: string; routes?: { distance: number; geometry: { coordinates: LngLat[] } }[] };
      const r = j.code === 'Ok' ? j.routes?.[0] : undefined;
      const pts = r?.geometry?.coordinates;
      if (!r || !pts || pts.length < 2) return null;
      // Détour de conducteur (sens uniques, voies rapides) : mieux vaut une ligne droite.
      if (r.distance > dist(from, to) * 2.5 + 150) return null;
      return pts.map(p => [p[0], p[1]] as LngLat);
    } catch { return null; } finally { clearTimeout(timer); }
  }
}
