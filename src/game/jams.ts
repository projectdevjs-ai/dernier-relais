// Embouteillages de colis : de temps en temps un abri déborde et confie un lot de colis légers,
// à livrer tous dans un temps donné pour toucher un bonus. Reproductible par abri et par tranche de 3 h.
import { type LngLat, dist, rng } from '../core/geo';
import type { Shelter } from '../world/types';
import { ITEMS, type Order, baseReward } from './orders';
import { JAM } from './rules';

export interface Jam {
  id: string; shelterId: string; shelterName: string; at: LngLat;
  /** Les colis du lot, prêts à être remis (état « révélé », contenu connu). */
  orders: Order[];
  minutes: number; bonus: number;
}
export const jamSlot = (ms: number): number => Math.floor(ms / JAM.slotMs);
const round5 = (n: number): number => Math.max(5, Math.round(n / 5) * 5);

/** Lot éventuel d'un abri pendant une tranche horaire. `shelters` : les abris chargés (il en faut au moins un autre). */
export function jamFor(s: Shelter, shelters: Shelter[], slot: number): Jam | null {
  const r = rng(`embouteillage|${s.id}|${slot}`);
  if (r() >= JAM.chance) return null;
  // Destinataires : les abris les plus proches, chacun le sien tant qu'il y en a assez.
  const others = shelters.filter(o => o.id !== s.id)
    .map(o => ({ o, d: dist(o.at, s.at) })).sort((a, b) => a.d - b.d || (a.o.id < b.o.id ? -1 : 1)).slice(0, JAM.count);
  if (!others.length) return null;
  const id = `lot|${s.id}|${slot}`, orders: Order[] = [];
  const light = ITEMS.filter(i => i.min <= JAM.maxKg);
  let total = 0, far = 0;
  for (let i = 0; i < JAM.count; i++) {
    const dest = others[i % others.length], item = light[Math.floor(r() * light.length)];
    const weightKg = item.min + Math.floor(r() * (Math.min(item.max, JAM.maxKg) - item.min + 1));
    const fragile = r() < item.fragile;
    // Les colis attendent en arc de cercle devant l'abri.
    const a = (i / JAM.count) * Math.PI * 2 + r() * 0.6;
    const at: LngLat = [s.at[0] + (Math.sin(a) * JAM.ringM) / (111320 * Math.cos((s.at[1] * Math.PI) / 180)), s.at[1] + (Math.cos(a) * JAM.ringM) / 110540];
    const reward = baseReward(weightKg, dest.d, fragile, false);
    total += reward; far += dest.d;
    orders.push({
      id: `${id}|${i}`, cell: s.cell, name: item.name, rareName: null, crate: item.crate, weightKg, fragile, at,
      destId: dest.o.id, destName: dest.o.name, destAt: dest.o.at, deadlineMin: null, baseReward: reward,
      state: 'révélé', condition: 1, pickedAt: null, jam: id, inspected: true,
    });
  }
  return {
    id, shelterId: s.id, shelterName: s.name, at: s.at, orders,
    minutes: Math.max(JAM.minMin, Math.round(JAM.baseMin + (far / 100) * JAM.minPer100m)), bonus: round5(total * JAM.bonusShare),
  };
}
export function jamsFor(shelters: Shelter[], ms: number): Jam[] {
  const slot = jamSlot(ms), out: Jam[] = [];
  for (const s of shelters) { const j = jamFor(s, shelters, slot); if (j) out.push(j); }
  return out;
}
/** Minutes restantes d'un lot pris à l'instant `startedAt`. */
export const jamMinutesLeft = (minutes: number, startedAt: number, nowMs: number): number => Math.ceil(minutes - (nowMs - startedAt) / 60000);
