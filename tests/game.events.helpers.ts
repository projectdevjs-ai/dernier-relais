// Outils des tests des systèmes secondaires : chercher un jour ou une heure où l'élément voulu existe, dans un monde calme.
import { cellAt } from '../src/core/geo';
import { cacheInCell } from '../src/game/caches';
import { dangersFor } from '../src/game/dangers';
import { jamsFor } from '../src/game/jams';
import { lostFor } from '../src/game/lost';
import { dayKey } from '../src/game/time';
import { wanderersFor } from '../src/game/wanderers';
import type { CellContent } from '../src/world/types';
import { T0, off, quietSky, shelter } from './game.helpers';

export const DAY = 86400000, HOUR = 3600000;
export const A = shelter('A', off(0, 0), 'École des Tilleuls'), B = shelter('B', off(300, 0), 'Pharmacie du Port'), C = shelter('C', off(0, 320), 'Mairie du Bourg');
export const HOME = cellAt(A.at[0], A.at[1]).id;

export interface Quiet { cache?: boolean; lost?: boolean; wanderer?: boolean; jam?: boolean }
/** Vrai si rien d'autre que ce qu'on teste ne vient troubler le monde à cet instant. */
export function quiet(cells: CellContent[], t: number, allow: Quiet = {}): boolean {
  const day = dayKey(t), shelters = cells.flatMap(c => c.shelters);
  if (dangersFor(cells, day).length || !quietSky(cells, t)) return false;
  if (!allow.cache && cells.some(c => cacheInCell(c.id, day, shelters.map(s => s.at)))) return false;
  if (!allow.lost && lostFor(cells, day).length) return false;
  if (!allow.wanderer && wanderersFor(cells, t).length) return false;
  if (!allow.jam && jamsFor(shelters, t).length) return false;
  return true;
}
/** Premier instant (par pas de `step`) qui convient. */
export function when(ok: (t: number) => boolean, step = DAY, max = 40000): number {
  for (let i = 0, t = T0; i < max; i++, t += step) if (ok(t)) return t;
  throw new Error('aucun instant ne convient');
}
