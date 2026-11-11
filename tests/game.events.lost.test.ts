import { describe, expect, it } from 'vitest';
import { cell, cellBounds, dist } from '../src/core/geo';
import type { LostInput } from '../src/game/api';
import { lostFor, lostFromNetwork, lostInCell } from '../src/game/lost';
import { baseReward } from '../src/game/orders';
import { GRADE_MULT, LOST } from '../src/game/rules';
import { dayKey } from '../src/game/time';
import { WANDER_NAMES } from '../src/game/wanderers';
import { off, ofType, place, rig, walk, world } from './game.helpers';
import { A, B, DAY, HOME, quiet, when } from './game.events.helpers';

const CELLS = world([A, B], []);
const T = when(t => quiet(CELLS, t, { lost: true }) && lostInCell(HOME, dayKey(t), [A, B]) !== null);
const LOST_ONE = lostInCell(HOME, dayKey(T), [A, B])!;

describe('colis perdus : règles', () => {
  it('rares, reproductibles par case et par jour, mieux payés, jamais sans abri', () => {
    let n = 0;
    for (let x = 0; x < 60; x++) for (let y = 0; y < 60; y++) {
      const id = `${32000 + x}/${22000 + y}`, o = lostInCell(id, '2026-11-11', [A, B]);
      expect(lostInCell(id, '2026-11-11', [A, B])).toEqual(o);
      if (!o) continue;
      n++;
      const b = cellBounds(cell(32000 + x, 22000 + y));
      expect(o.at[0]).toBeGreaterThan(b.w); expect(o.at[0]).toBeLessThan(b.e);
      expect(o).toMatchObject({ state: 'caché', condition: 1, deadlineMin: null, rareName: null, pickedAt: null });
      expect(WANDER_NAMES).toContain(o.lost!.by);
      expect(['A', 'B']).toContain(o.destId);
      expect(o.baseReward).toBe(Math.max(5, Math.round((baseReward(o.weightKg, dist(o.at, o.destAt), o.fragile, false) * LOST.pay) / 5) * 5));
    }
    expect(n / 3600).toBeGreaterThan(LOST.chance * 0.7); expect(n / 3600).toBeLessThan(LOST.chance * 1.3);
    expect(25 * LOST.chance).toBeLessThan(1.5);
    expect(lostInCell(HOME, dayKey(T), [])).toBeNull();
    expect(lostInCell(HOME, dayKey(T + DAY), [A, B])?.at).not.toEqual(LOST_ONE.at);
    expect(lostFor(CELLS, dayKey(T)).map(o => o.id)).toEqual([LOST_ONE.id]);
    for (const s of [A, B]) expect(dist(LOST_ONE.at, s.at)).toBeGreaterThan(LOST.clearM);
  });
});

describe('colis perdus : en jeu', () => {
  it('révélé par le scanner, ramené à son abri : récompense de solidarité et mention du porteur', async () => {
    const r = await rig({ t: T }), g = r.game;
    g.setWorld(CELLS);
    place(r, off(-20, 0, LOST_ONE.at));
    expect(g.view().orders).toEqual([]);
    g.scan();
    const o = g.view().orders[0];
    expect(o).toMatchObject({ id: LOST_ONE.id, name: LOST_ONE.name, state: 'révélé', lost: { by: LOST_ONE.lost!.by }, minutesLeft: null, reward: LOST_ONE.baseReward, special: null });
    expect(g.pickup(o.id)).toEqual({ ok: true });
    walk(r, o.destAt, 1.3, i => { if (i % 5 === 0) g.steady(); });
    expect(g.deliver(o.destId)).toEqual({ ok: true });
    const res = ofType(r.events, 'delivery')[0].result;
    expect(res).toMatchObject({ lostBy: LOST_ONE.lost!.by, orderName: LOST_ONE.name });
    expect(res.notes).toContain(`Colis de ${LOST_ONE.lost!.by} retrouvé`);
    expect(res.points).toBe(Math.round(LOST_ONE.baseReward * GRADE_MULT[res.grade]));
    // Livré : il ne réapparaît pas aujourd'hui.
    g.setWorld(CELLS); place(r, off(-20, 0, LOST_ONE.at)); r.clock.t += 20000; g.tick(20); g.scan();
    expect(g.view().orders).toEqual([]);
  });

  it('prévu pour le réseau : les colis abandonnés par d’autres joueurs apparaissent, puis disparaissent s’ils sont repris ailleurs', async () => {
    const t = when(x => quiet(CELLS, x));
    const r = await rig({ t }), g = r.game;
    g.setWorld(CELLS);
    place(r, off(100, 0));
    const input: LostInput = { id: 'abc', at: off(110, 10), name: 'Livres', crate: 'carton', weightKg: 4, fragile: false, destId: 'B', destName: B.name, destAt: B.at, by: 'Camille', condition: 0.8 };
    const other: LostInput = { ...input, id: 'def', at: off(150, -20), name: 'Savon', by: 'Idriss' };
    expect(lostFromNetwork(input)).toMatchObject({ id: 'réseau|abc', state: 'révélé', condition: 0.8, lost: { by: 'Camille', net: true } });
    g.setNetworkLost([input, other]);
    expect(g.view().orders.map(o => [o.id, o.lost!.by, o.state])).toEqual([['réseau|abc', 'Camille', 'révélé'], ['réseau|def', 'Idriss', 'révélé']]);
    expect(g.pickup('réseau|abc')).toEqual({ ok: true });
    // Un autre joueur a repris « def » ; « abc » est dans notre sac et y reste.
    g.setNetworkLost([]);
    expect(g.view().orders.map(o => o.id)).toEqual(['réseau|abc']);
    await g.flush();
    expect(r.store.peek()!.orders[0]).toMatchObject({ id: 'réseau|abc', lost: { by: 'Camille', net: true }, state: 'porté' });
    walk(r, B.at, 1.3, i => { if (i % 5 === 0) g.steady(); });
    g.deliver('B');
    expect(ofType(r.events, 'delivery')[0].result).toMatchObject({ lostBy: 'Camille' });
    // Déjà livré : une liste en retard ne le fait pas revenir.
    g.setNetworkLost([input]);
    expect(g.view().orders).toEqual([]);
  });
});
