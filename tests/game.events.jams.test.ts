import { describe, expect, it } from 'vitest';
import { dist } from '../src/core/geo';
import { jamFor, jamSlot, jamsFor } from '../src/game/jams';
import { baseReward } from '../src/game/orders';
import { JAM } from '../src/game/rules';
import { off, ofType, place, rig, shelter, wait, walk, world } from './game.helpers';
import { A, B, C, quiet, when } from './game.events.helpers';

const D = shelter('D', off(310, 300), 'Halte du Pont');
const ALL = [A, B, C, D];
const CELLS = world(ALL, []);
const SLOT = JAM.slotMs;
/** Un instant calme où l'abri A, et lui seul, est débordé. */
const T = when(t => { const j = jamsFor(ALL, t); return j.length === 1 && j[0].shelterId === 'A' && quiet(CELLS, t, { jam: true }) && quiet(CELLS, t + SLOT - 1, { jam: true }); }, SLOT);
const LOT = jamFor(A, ALL, jamSlot(T))!;

describe('embouteillages : règles', () => {
  it('rares, reproductibles par abri et par tranche de 3 h', () => {
    let n = 0;
    for (let s = 0; s < 4000; s++) {
      const j = jamFor(A, ALL, s);
      expect(jamFor(A, ALL, s)).toEqual(j);
      if (j) n++;
    }
    expect(n / 4000).toBeGreaterThan(JAM.chance * 0.7); expect(n / 4000).toBeLessThan(JAM.chance * 1.3);
    expect(6 * JAM.chance).toBeLessThan(1); // six abris environ dans un secteur de 2 km : rarement plus d'un lot
    for (let s = 0; s < 500; s++) expect(jamFor(A, [A], s)).toBeNull();
  });
  it('trois colis légers, connus, pour les abris voisins, avec un temps et un bonus proportionnés', () => {
    expect(LOT.orders).toHaveLength(JAM.count);
    expect(LOT.orders.reduce((kg, o) => kg + o.weightKg, 0)).toBeLessThanOrEqual(20);
    expect(LOT.orders.map(o => o.destId).sort()).toEqual(['B', 'C', 'D']);
    let sum = 0, far = 0;
    for (const o of LOT.orders) {
      expect(o).toMatchObject({ state: 'révélé', inspected: true, jam: LOT.id, deadlineMin: null });
      expect(o.special).toBeUndefined();
      expect(o.weightKg).toBeLessThanOrEqual(JAM.maxKg);
      expect(dist(o.at, A.at)).toBeCloseTo(JAM.ringM, 0);
      const d = dist(A.at, o.destAt);
      expect(o.baseReward).toBe(baseReward(o.weightKg, d, o.fragile, false));
      sum += o.baseReward; far += d;
    }
    expect(LOT.bonus).toBe(Math.max(5, Math.round((sum * JAM.bonusShare) / 5) * 5));
    expect(LOT.minutes).toBe(Math.max(JAM.minMin, Math.round(JAM.baseMin + (far / 100) * JAM.minPer100m)));
    // Deux abris seulement : tout part chez l'autre.
    const two = Array.from({ length: 4000 }, (_, s) => jamFor(A, [A, B], s)).find(j => j)!;
    expect(two.orders.map(o => o.destId)).toEqual(['B', 'B', 'B']);
  });
});

describe('embouteillages : en jeu', () => {
  async function start(t = T) {
    const r = await rig({ t }), g = r.game;
    g.setWorld(CELLS);
    place(r, off(200, 0));
    return { r, g };
  }
  it('proposé à l’abri débordé ; pris sur place ; tout livré à temps : bonus pour le joueur et pour l’abri', async () => {
    const { r, g } = await start();
    expect(g.view().jams).toHaveLength(1);
    expect(g.view().jams![0]).toMatchObject({ id: LOT.id, shelterId: 'A', shelterName: A.name, state: 'proposé', count: 3, delivered: 0, minutes: LOT.minutes, minutesLeft: null, bonus: LOT.bonus, inRange: false });
    expect(g.view().orders).toEqual([]);
    expect(g.startJam(LOT.id)).toEqual({ ok: false, why: 'Trop loin de l’abri.' });
    walk(r, off(10, 0));
    expect(g.view().jams![0].inRange).toBe(true);
    expect(g.startJam(LOT.id)).toEqual({ ok: true });
    expect(g.startJam(LOT.id)).toEqual({ ok: false, why: 'Ce lot n’est plus proposé.' });
    expect(ofType(r.events, 'jam')).toHaveLength(1);
    expect(ofType(r.events, 'jam')[0]).toMatchObject({ phase: 'début', jam: { id: LOT.id, state: 'en cours', minutesLeft: LOT.minutes } });
    const orders = g.view().orders;
    expect(orders.map(o => o.id).sort()).toEqual(LOT.orders.map(o => o.id).sort());
    expect(orders.every(o => o.state === 'révélé' && o.jamId === LOT.id && o.inspected && o.inRange && o.minutesLeft === null)).toBe(true);
    for (const o of orders) expect(g.pickup(o.id)).toEqual({ ok: true });

    const score0 = g.view().player.score;
    let gained = 0;
    for (const dest of [B, D, C]) {
      walk(r, dest.at, 1.4, i => { if (i % 5 === 0) g.steady(); });
      expect(g.deliver(dest.id)).toEqual({ ok: true });
      gained += ofType(r.events, 'delivery').at(-1)!.result.points;
      const jam = g.view().jams!.find(j => j.id === LOT.id);
      if (dest !== C) { expect(jam!.delivered).toBe(dest === B ? 1 : 2); expect(jam!.minutesLeft!).toBeGreaterThan(0); }
    }
    expect(ofType(r.events, 'jam').map(e => e.phase)).toEqual(['début', 'réussi']);
    expect(ofType(r.events, 'jam')[1]).toMatchObject({ bonus: LOT.bonus, jam: { delivered: 3, count: 3 } });
    expect(g.view().player.score).toBe(score0 + gained + LOT.bonus);
    expect(g.view().shelters.find(s => s.id === 'A')!.points).toBe(LOT.bonus);
    // Terminé : plus proposé, même après rechargement dans la même tranche.
    expect(g.view().jams).toEqual([]);
    await g.flush();
    const r2 = await rig({ store: r.store, t: r.clock.t });
    r2.game.setWorld(CELLS); place(r2, off(10, 0));
    expect(r2.game.view().jams).toEqual([]);
    expect(r2.game.startJam(LOT.id)).toEqual({ ok: false, why: 'Ce lot n’est plus proposé.' });
  });

  it('temps écoulé : pas de bonus, mais les colis restent à livrer', async () => {
    const { r, g } = await start();
    walk(r, off(10, 0));
    g.startJam(LOT.id);
    for (const o of g.view().orders) g.pickup(o.id);
    walk(r, B.at, 1.4, i => { if (i % 5 === 0) g.steady(); });
    g.deliver('B');
    // Sauvegarde et rechargement en cours de route.
    await g.flush();
    expect(r.store.peek()!.jams).toEqual([{ id: LOT.id, shelterId: 'A', shelterName: A.name, at: A.at, count: 3, delivered: 1, minutes: LOT.minutes, bonus: LOT.bonus, startedAt: expect.any(Number), state: 'en cours' }]);
    const r2 = await rig({ store: r.store, t: r.clock.t }), g2 = r2.game;
    g2.setWorld(CELLS); place(r2, B.at);
    expect(g2.view().jams![0]).toMatchObject({ state: 'en cours', delivered: 1 });
    wait(r2, LOT.minutes * 60);
    expect(ofType(r2.events, 'jam').map(e => e.phase)).toEqual(['raté']);
    expect(g2.view().jams).toEqual([]);
    const score = g2.view().player.score;
    walk(r2, D.at, 1.4, i => { if (i % 5 === 0) g2.steady(); });
    expect(g2.deliver('D')).toEqual({ ok: true });
    expect(g2.view().player.score).toBe(score + ofType(r2.events, 'delivery').at(-1)!.result.points);
    expect(ofType(r2.events, 'jam').map(e => e.phase)).toEqual(['raté']);
  });

  it('la proposition disparaît à la tranche suivante', async () => {
    const next = (jamSlot(T) + 1) * SLOT;
    const { r, g } = await start(next - 30000);
    expect(g.view().jams).toHaveLength(1);
    wait(r, 60);
    expect(g.view().jams!.filter(j => j.id === LOT.id)).toEqual([]);
    expect(g.startJam(LOT.id)).toEqual({ ok: false, why: 'Ce lot n’est plus proposé.' });
  });
});
