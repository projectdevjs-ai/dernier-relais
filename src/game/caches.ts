// Caches : de petites réserves cachées dans le décor, une au plus par case, renouvelées chaque jour.
// Positions et contenus reproductibles : mêmes caches pour tous les joueurs au même endroit le même jour.
import { type LngLat, cell, cellBounds, dist, rng } from '../core/geo';
import type { CellContent } from '../world/types';
import { CACHE } from './rules';

export interface Cache { id: string; cell: string; at: LngLat; points: number; xp: number; skillPoint: boolean }

const round5 = (n: number): number => Math.round(n / 5) * 5;
const span = (r: number, [min, max]: readonly [number, number]): number => min + r * (max - min);

/** Cache éventuelle d'une case. `shelters` : positions des abris connus, dont la cache reste à l'écart. */
export function cacheInCell(cellId: string, day: string, shelters: LngLat[]): Cache | null {
  const m = /^(\d+)\/(\d+)$/.exec(cellId);
  if (!m) return null;
  const r = rng(`cache|${cellId}|${day}`);
  if (r() >= CACHE.chance) return null;
  const b = cellBounds(cell(Number(m[1]), Number(m[2])));
  // Les tirages se font toujours dans le même ordre : le contenu ne dépend pas de la position retenue.
  const points = round5(span(r(), CACHE.points)), xp = Math.round(span(r(), CACHE.xp)), skillPoint = r() < CACHE.skillChance;
  for (let i = 0; i < 4; i++) {
    const at: LngLat = [b.w + (b.e - b.w) * (0.12 + 0.76 * r()), b.s + (b.n - b.s) * (0.12 + 0.76 * r())];
    if (shelters.every(s => dist(s, at) > CACHE.clearM)) return { id: `cache|${cellId}|${day}`, cell: cellId, at, points, xp, skillPoint };
  }
  return null;
}
export function cachesFor(cells: CellContent[], day: string): Cache[] {
  const shelters = cells.flatMap(c => c.shelters.map(s => s.at));
  const out: Cache[] = [];
  for (const c of cells) { const k = cacheInCell(c.id, day, shelters); if (k) out.push(k); }
  return out;
}
