// Outils communs aux tests du jeu : petit monde, horloge, marche simulée.
import { type LngLat, cellAt, dist } from '../src/core/geo';
import type { GameEvent } from '../src/game/api';
import { frontPath, frontSlot, zonesOf } from '../src/game/fronts';
import { Game } from '../src/game/game';
import { type Order, makeOrder } from '../src/game/orders';
import { type GameSave, MemoryGameStore } from '../src/game/save';
import type { CellContent, ParcelSpot, Shelter } from '../src/world/types';

export const BASE: LngLat = [-1.5761, 47.1822];
/** Point décalé de dx mètres vers l'est et dy mètres vers le nord. */
export const off = (dx: number, dy: number, from: LngLat = BASE): LngLat =>
  [from[0] + dx / (111320 * Math.cos((from[1] * Math.PI) / 180)), from[1] + dy / 110540];

export const shelter = (id: string, at: LngLat, name = `Abri ${id}`): Shelter =>
  ({ id, cell: cellAt(at[0], at[1]).id, name, kind: 'mairie', at, source: 'lieu' });
export const spot = (id: string, at: LngLat): ParcelSpot => ({ id, cell: cellAt(at[0], at[1]).id, at });

/** Range abris et emplacements dans leurs cases. */
export function world(shelters: Shelter[], spots: ParcelSpot[], extraCells: string[] = []): CellContent[] {
  const cells = new Map<string, CellContent>();
  const get = (id: string) => { let c = cells.get(id); if (!c) { c = { id, shelters: [], parcels: [], roads: 1 }; cells.set(id, c); } return c; };
  for (const id of extraCells) get(id);
  for (const s of shelters) get(s.cell).shelters.push(s);
  for (const p of spots) get(p.cell).parcels.push(p);
  return [...cells.values()];
}

/** Cherche un identifiant d'emplacement dont la commande a les propriétés voulues. */
export function findSpot(prefix: string, at: LngLat, shelters: Shelter[], want: (o: Order) => boolean, skip = 0): ParcelSpot {
  for (let i = 0; i < 5000; i++) {
    const s = spot(`${prefix}${i}`, at), o = makeOrder(s, shelters);
    // Les colis spéciaux (rares) ont leurs propres tests : voir findSpecial.
    if (o && !o.special && want(o) && skip-- <= 0) return s;
  }
  throw new Error('aucun emplacement ne convient');
}
/** Emplacement dont la commande est un colis spécial de la sorte voulue. */
export function findSpecial(kind: NonNullable<Order['special']>, at: LngLat, shelters: Shelter[], want: (o: Order) => boolean = () => true): ParcelSpot {
  for (let i = 0; i < 200000; i++) {
    const s = spot(`sp${i}`, at), o = makeOrder(s, shelters);
    if (o && o.special === kind && want(o)) return s;
  }
  throw new Error('aucun colis spécial ne convient');
}
/** Vrai si aucun front de mauvais temps ne traverse ces cases dans les heures qui suivent. */
export function quietSky(cells: CellContent[], t: number, hours = 6): boolean {
  const zones = zonesOf(cells.map(c => c.id));
  for (let h = 0; h < hours; h++) if (zones.some(z => frontPath(z, frontSlot(t) + h) !== null)) return false;
  return true;
}

export interface Rig { game: Game; store: MemoryGameStore; clock: { t: number }; events: GameEvent[] }
/** Mercredi 11 novembre 2026, 10 h en temps universel. */
export const T0 = Date.UTC(2026, 10, 11, 10, 0, 0);
/** `newcomer` : garde les premières commandes simplifiées du nouveau porteur (désactivées par défaut dans les tests). */
export async function rig(opts: { save?: GameSave | null; t?: number; store?: MemoryGameStore; newcomer?: boolean } = {}): Promise<Rig> {
  const clock = { t: opts.t ?? T0 };
  const store = opts.store ?? new MemoryGameStore(opts.save ?? null);
  const game = new Game({ store, now: () => clock.t, easeNewcomers: opts.newcomer === true });
  const events: GameEvent[] = [];
  game.on(e => events.push(e));
  await game.load();
  return { game, store, clock, events };
}
export const place = (r: Rig, at: LngLat): void => r.game.setPosition({ lng: at[0], lat: at[1], acc: 5, source: 'gps' });
/** Laisse passer du temps sans bouger. */
export function wait(r: Rig, seconds: number): void {
  for (let i = 0; i < seconds; i++) { r.clock.t += 1000; r.game.tick(1); }
}
/** Marche jusqu'à un point, une position par seconde. `each` est appelé à chaque seconde. */
export function walk(r: Rig, to: LngLat, speed = 1.3, each?: (i: number) => void): void {
  const from = r.game.view().player.at;
  if (!from) throw new Error('position de départ inconnue');
  const n = Math.max(1, Math.ceil(dist(from, to) / speed));
  for (let i = 1; i <= n; i++) {
    r.clock.t += 1000;
    place(r, [from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n]);
    r.game.tick(1);
    each?.(i);
  }
}
export const ofType = <T extends GameEvent['type']>(events: GameEvent[], type: T): Extract<GameEvent, { type: T }>[] =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
