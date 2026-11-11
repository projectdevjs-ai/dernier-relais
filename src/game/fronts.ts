// Fronts de mauvais temps : un grand disque de pluie et de vent qui traverse lentement une zone (4 x 4 cases).
// C'est le « danger mouvant » : on peut l'éviter, l'attendre ou le traverser. Sa position ne dépend que
// de la zone et de l'heure : tous les joueurs voient le même front au même endroit.
import { CELL_Z, type LngLat, dist, rng, tileLngLat } from '../core/geo';
import { FRONT } from './rules';

/** Zone d'une case : bloc de 4 x 4 cases, environ 1,6 km de côté. */
export function zoneOf(cellId: string): string | null {
  const m = /^(\d+)\/(\d+)$/.exec(cellId);
  return m ? `${Number(m[1]) >> 2}/${Number(m[2]) >> 2}` : null;
}
export function zonesOf(cellIds: string[]): string[] {
  const out = new Set<string>();
  for (const id of cellIds) { const z = zoneOf(id); if (z) out.add(z); }
  return [...out];
}
export const frontSlot = (ms: number): number => Math.floor(ms / FRONT.slotMs);

export interface FrontPath {
  id: string;
  /** Point d'entrée et point de sortie du centre du disque. */
  from: LngLat; to: LngLat;
  radiusM: number; headingDeg: number; speedMps: number;
  startMs: number; endMs: number;
}
export interface Front { id: string; at: LngLat; radiusM: number; headingDeg: number; speedMps: number }

const M_LAT = 110540;
const shift = (p: LngLat, eastM: number, northM: number): LngLat =>
  [p[0] + eastM / (111320 * Math.cos((p[1] * Math.PI) / 180)), p[1] + northM / M_LAT];

/** Trajet du front d'une zone pendant une heure donnée, ou null (le plus souvent). */
export function frontPath(zone: string, slot: number): FrontPath | null {
  const m = /^(\d+)\/(\d+)$/.exec(zone);
  if (!m) return null;
  const r = rng(`front|${zone}|${slot}`);
  if (r() >= FRONT.chance) return null;
  const centre = tileLngLat(Number(m[1]) * 4 + 2, Number(m[2]) * 4 + 2, CELL_Z);
  const through = shift(centre, (r() * 2 - 1) * FRONT.offsetM, (r() * 2 - 1) * FRONT.offsetM);
  const a = r() * Math.PI * 2, half = FRONT.travelM / 2;
  // Cap : 0 = vers le nord, sens horaire.
  const e = Math.sin(a), n = Math.cos(a);
  const startMs = slot * FRONT.slotMs, endMs = startMs + FRONT.slotMs;
  return {
    id: `front|${zone}|${slot}`, from: shift(through, -e * half, -n * half), to: shift(through, e * half, n * half),
    radiusM: Math.round(FRONT.minR + r() * (FRONT.maxR - FRONT.minR)), headingDeg: (a * 180) / Math.PI,
    speedMps: FRONT.travelM / (FRONT.slotMs / 1000), startMs, endMs,
  };
}

/** Le front à un instant donné : il grossit en arrivant et se dissipe en partant. null hors de son heure. */
export function frontAt(p: FrontPath, ms: number): Front | null {
  if (ms < p.startMs || ms >= p.endMs) return null;
  const k = (ms - p.startMs) / (p.endMs - p.startMs);
  const fade = Math.min(1, (ms - p.startMs) / (FRONT.fadeS * 1000), (p.endMs - ms) / (FRONT.fadeS * 1000));
  return {
    id: p.id, at: [p.from[0] + (p.to[0] - p.from[0]) * k, p.from[1] + (p.to[1] - p.from[1]) * k],
    radiusM: Math.max(1, p.radiusM * fade), headingDeg: p.headingDeg, speedMps: p.speedMps,
  };
}
export function frontsFor(zones: string[], ms: number): { path: FrontPath; front: Front }[] {
  const slot = frontSlot(ms), out: { path: FrontPath; front: Front }[] = [];
  for (const z of zones) {
    const path = frontPath(z, slot), front = path && frontAt(path, ms);
    if (path && front) out.push({ path, front });
  }
  return out;
}
export const insideFront = (f: Front, p: LngLat): boolean => dist(f.at, p) < f.radiusM;

/** Secondes avant que le front recouvre un point immobile. 0 s'il y est déjà ; null s'il passe à côté, s'éloigne ou se dissipe avant. */
export function frontEta(p: FrontPath, ms: number, point: LngLat): number | null {
  const now = frontAt(p, ms);
  if (!now) return null;
  if (insideFront(now, point)) return 0;
  // Repère plat en mètres autour du point.
  const k = 111320 * Math.cos((point[1] * Math.PI) / 180);
  const x = (now.at[0] - point[0]) * k, y = (now.at[1] - point[1]) * M_LAT;
  const a = (p.headingDeg * Math.PI) / 180, vx = Math.sin(a) * p.speedMps, vy = Math.cos(a) * p.speedMps;
  // |c + v t| = R
  const R = p.radiusM, b = x * vx + y * vy, v2 = vx * vx + vy * vy, c = x * x + y * y - R * R;
  const disc = b * b - v2 * c;
  if (disc < 0 || b >= 0) return null;
  const t = (-b - Math.sqrt(disc)) / v2;
  // Pendant sa dissipation, le front ne couvre plus tout son rayon : on ne promet rien.
  return t >= 0 && ms + t * 1000 < p.endMs - FRONT.fadeS * 1000 ? t : null;
}
