// Zones dangereuses : positions reproductibles par case et par jour, à l'écart des abris.
import { type LngLat, cell, cellBounds, dist, rng } from '../core/geo';
import type { CellContent } from '../world/types';
import { DANGER } from './rules';

export interface Danger { id: string; at: LngLat; radiusM: number }

/** Zone éventuelle d'une case. `shelters` : positions des abris connus, que la zone doit éviter. */
export function dangerInCell(cellId: string, day: string, shelters: LngLat[]): Danger | null {
  const m = /^(\d+)\/(\d+)$/.exec(cellId);
  if (!m) return null;
  const r = rng(`danger|${cellId}|${day}`);
  if (r() >= DANGER.chance) return null;
  const b = cellBounds(cell(Number(m[1]), Number(m[2])));
  for (let i = 0; i < 4; i++) {
    const at: LngLat = [b.w + (b.e - b.w) * (0.15 + 0.7 * r()), b.s + (b.n - b.s) * (0.15 + 0.7 * r())];
    const radiusM = Math.round(DANGER.minR + r() * (DANGER.maxR - DANGER.minR));
    if (shelters.every(s => dist(s, at) > radiusM + DANGER.clearM)) return { id: `zone|${cellId}|${day}`, at, radiusM };
  }
  return null;
}
export function dangersFor(cells: CellContent[], day: string): Danger[] {
  const shelters = cells.flatMap(c => c.shelters.map(s => s.at));
  const out: Danger[] = [];
  for (const c of cells) { const d = dangerInCell(c.id, day, shelters); if (d) out.push(d); }
  return out;
}
export const insideDanger = (d: Danger, p: LngLat): boolean => dist(d.at, p) < d.radiusM;
