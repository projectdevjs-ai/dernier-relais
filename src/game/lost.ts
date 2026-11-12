// Colis perdus : des colis abandonnés en route par d'autres porteurs, à ramener à leur abri (récompense de solidarité).
// Hors ligne ils sont générés, une case et un jour donnant toujours le même colis ; le champ `lost.net`
// et Game.setNetworkLost permettent de les faire venir plus tard d'autres joueurs.
import { crateDef } from './crates';
import { type LngLat, cell, cellBounds, dist, hash, rng } from '../core/geo';
import type { CellContent, Shelter } from '../world/types';
import type { LostInput } from './api';
import { ITEMS, type Order, baseReward, pickDestination } from './orders';
import { LOST } from './rules';
import { WANDER_NAMES } from './wanderers';

const round5 = (n: number): number => Math.max(5, Math.round(n / 5) * 5);

/** Colis perdu éventuel d'une case. `shelters` : les abris chargés (aucun abri, aucun colis). */
export function lostInCell(cellId: string, day: string, shelters: Shelter[]): Order | null {
  const m = /^(\d+)\/(\d+)$/.exec(cellId);
  if (!m || !shelters.length) return null;
  const r = rng(`perdu|${cellId}|${day}`);
  if (r() >= LOST.chance) return null;
  const b = cellBounds(cell(Number(m[1]), Number(m[2])));
  const item = ITEMS[Math.floor(r() * ITEMS.length)];
  const weightKg = item.min + Math.floor(r() * (item.max - item.min + 1)), fragile = r() < item.fragile;
  const id = `perdu|${cellId}|${day}`;
  for (let i = 0; i < 4; i++) {
    const at: LngLat = [b.w + (b.e - b.w) * (0.12 + 0.76 * r()), b.s + (b.n - b.s) * (0.12 + 0.76 * r())];
    if (!shelters.every(s => dist(s.at, at) > LOST.clearM)) continue;
    const dest = pickDestination({ id, cell: cellId, at }, shelters)!;
    return {
      id, cell: cellId, name: item.name, rareName: null, crate: item.crate, weightKg, fragile, at,
      destId: dest.id, destName: dest.name, destAt: dest.at, deadlineMin: null,
      baseReward: round5(baseReward(weightKg, dist(at, dest.at), fragile, false) * LOST.pay),
      state: 'caché', condition: 1, pickedAt: null, lost: { by: WANDER_NAMES[hash(`porteur|${id}`) % WANDER_NAMES.length] },
    };
  }
  return null;
}
export function lostFor(cells: CellContent[], day: string): Order[] {
  const shelters = cells.flatMap(c => c.shelters);
  const out: Order[] = [];
  for (const c of cells) { const o = lostInCell(c.id, day, shelters); if (o) out.push(o); }
  return out;
}
/** Colis perdu venu du réseau : même forme qu'un colis généré, déjà visible (son propriétaire sait où il l'a laissé). */
export function lostFromNetwork(i: LostInput): Order {
  return {
    id: `réseau|${i.id}`, cell: '', name: i.name, rareName: null, crate: crateDef(i.crate).kind, weightKg: i.weightKg, fragile: i.fragile, at: [i.at[0], i.at[1]],
    destId: i.destId, destName: i.destName, destAt: [i.destAt[0], i.destAt[1]], deadlineMin: null,
    baseReward: round5(baseReward(i.weightKg, dist(i.at, i.destAt), i.fragile, false) * LOST.pay),
    state: 'révélé', condition: Math.min(1, Math.max(0, i.condition ?? 1)), pickedAt: null, lost: { by: i.by, net: true },
  };
}
