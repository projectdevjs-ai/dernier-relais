import { describe, expect, it } from 'vitest';
import { dist } from '../src/core/geo';
import type { SpecialKind } from '../src/game/api';
import { baseReward, deadlineFor, makeOrder } from '../src/game/orders';
import { SPECIAL, STAMINA } from '../src/game/rules';
import { parseGameSave } from '../src/game/save';
import { SPECIALS, SPECIAL_KINDS, UNKNOWN_SPECIAL, specialDrainMult, specialFor, specialWearPerSecond } from '../src/game/specials';
import { findSpecial, off, ofType, place, rig, spot, wait, walk, world } from './game.helpers';
import { A, B, quiet, when } from './game.events.helpers';

const AT = off(20, 0);
async function carry(kind: SpecialKind) {
  const s = findSpecial(kind, AT, [A, B]);
  const cells = world([A, B], [s]);
  const r = await rig({ t: when(t => quiet(cells, t)) });
  r.game.setWorld(cells);
  place(r, AT);
  r.game.scan();
  return { r, id: s.id, cells };
}

describe('colis spéciaux : règles', () => {
  it('sont rares, reproductibles, et des quatre sortes', () => {
    const kinds = new Map<string, number>();
    let n = 0;
    for (let i = 0; i < 40000; i++) {
      const k = specialFor(`17/23|2026-11-11|${i}`);
      expect(specialFor(`17/23|2026-11-11|${i}`)).toBe(k);
      if (k) { n++; kinds.set(k, (kinds.get(k) ?? 0) + 1); }
    }
    expect(n / 40000).toBeGreaterThan(SPECIAL.chance * 0.7);
    expect(n / 40000).toBeLessThan(SPECIAL.chance * 1.3);
    expect([...kinds.keys()].sort()).toEqual([...SPECIAL_KINDS].sort());
    // 75 emplacements dans un secteur de 5 x 5 cases : environ un colis spécial par secteur et par jour.
    expect(75 * SPECIAL.chance).toBeLessThan(1.5);
  });

  it('ont un poids, une contrainte et une récompense nettement supérieure', () => {
    for (const kind of SPECIAL_KINDS) {
      const s = findSpecial(kind, AT, [A, B]), o = makeOrder(s, [A, B])!;
      const d = dist(s.at, o.destAt), [min, max] = SPECIAL.kg[kind];
      expect(o).toMatchObject({ special: kind, name: SPECIALS[kind].label, rareName: null, fragile: SPECIALS[kind].fragile, state: 'caché' });
      expect(o.weightKg).toBeGreaterThanOrEqual(min); expect(o.weightKg).toBeLessThanOrEqual(max);
      expect(o.baseReward).toBeGreaterThanOrEqual(2 * baseReward(o.weightKg, d, o.fragile, o.deadlineMin !== null));
      expect(SPECIALS[kind].rule.length).toBeLessThan(90);
      expect(makeOrder(s, [A, B])).toEqual(o);
    }
    const bn = makeOrder(findSpecial('boitenoire', AT, [A, B]), [A, B])!;
    expect(bn.deadlineMin).toBe(Math.max(SPECIAL.blackboxMinMin, Math.round(deadlineFor(dist(AT, bn.destAt)) * SPECIAL.blackboxDelay)));
    expect(bn.deadlineMin!).toBeLessThan(deadlineFor(dist(AT, bn.destAt)));
    for (const k of ['cryo', 'ruche', 'batterie'] as const) expect(makeOrder(findSpecial(k, AT, [A, B]), [A, B])!.deadlineMin).toBeNull();
    // La cellule instable tient dans le sac de base, mais presque seule.
    expect(SPECIAL.kg.batterie[1]).toBeLessThanOrEqual(20); expect(SPECIAL.kg.batterie[0]).toBeGreaterThanOrEqual(15);
  });

  it('usure et fatigue propres à chaque sorte', () => {
    expect(specialWearPerSecond('cryo', { everPicked: true, carried: false, running: false }) * 60).toBeCloseTo(SPECIAL.cryoPerMin);
    expect(specialWearPerSecond('cryo', { everPicked: false, carried: false, running: false })).toBe(0);
    expect(specialWearPerSecond('ruche', { everPicked: true, carried: true, running: true }) * 60).toBeCloseTo(SPECIAL.hiveRunPerMin);
    expect(specialWearPerSecond('ruche', { everPicked: true, carried: true, running: false })).toBe(0);
    expect(specialWearPerSecond('batterie', { everPicked: true, carried: true, running: true })).toBe(0);
    expect(specialWearPerSecond(undefined, { everPicked: true, carried: true, running: true })).toBe(0);
    expect(specialDrainMult([{}, { special: 'batterie' }])).toBe(SPECIAL.batteryDrain);
    expect(specialDrainMult([{ special: 'cryo' }, {}])).toBe(1);
  });
});

describe('colis spéciaux : en jeu', () => {
  it('le scanner montre un « signal inhabituel » ; le ramassage dit ce que c’est et annonce la contrainte', async () => {
    const { r, id } = await carry('ruche');
    const o = r.game.view().orders[0];
    expect(o).toMatchObject({ id, name: UNKNOWN_SPECIAL, state: 'révélé', inspected: false });
    expect(o.special).toMatchObject({ kind: 'ruche', known: false });
    expect(r.game.pickup(id)).toEqual({ ok: true });
    expect(r.game.view().orders[0]).toMatchObject({ name: 'Ruche vivante', inspected: true, special: { kind: 'ruche', label: 'Ruche vivante', rule: SPECIALS.ruche.rule, known: true } });
    expect(ofType(r.events, 'special').map(e => e.order.name)).toEqual(['Ruche vivante']);
    // Reposé puis repris : plus d'annonce.
    r.game.drop(id); r.game.pickup(id);
    expect(ofType(r.events, 'special')).toHaveLength(1);
  });

  it('caisson cryogénique : l’état baisse avec le temps dès le ramassage, même posé au sol', async () => {
    const { r, id } = await carry('cryo');
    wait(r, 120);
    expect(r.game.view().orders[0].condition).toBe(1); // pas encore pris : il reste au froid
    r.game.pickup(id);
    wait(r, 60);
    expect(r.game.view().orders[0].condition).toBeCloseTo(1 - SPECIAL.cryoPerMin, 3);
    r.game.drop(id);
    wait(r, 60);
    expect(r.game.view().orders[0].condition).toBeCloseTo(1 - 2 * SPECIAL.cryoPerMin, 3);
  });

  it('ruche : marcher ne l’abîme pas, courir si', async () => {
    const { r, id } = await carry('ruche');
    r.game.pickup(id);
    walk(r, off(120, 0), 1.3, i => { if (i % 5 === 0) r.game.steady(); });
    expect(r.game.view().orders[0].condition).toBe(1);
    walk(r, off(260, 0), 3.5, i => { if (i % 5 === 0) r.game.steady(); });
    const c = r.game.view().orders[0].condition;
    expect(c).toBeLessThan(0.9); expect(c).toBeGreaterThan(0.6);
  });

  it('cellule instable : fatigue plus vite qu’un colis ordinaire du même poids', async () => {
    const { r, id } = await carry('batterie');
    r.game.pickup(id);
    const kg = r.game.view().player.carriedKg;
    expect(kg).toBeGreaterThanOrEqual(15);
    expect(r.game.view().player.carriedKg / r.game.view().player.capacityKg).toBeGreaterThanOrEqual(0.75);
    walk(r, off(60, 0), 1.3); // hors de l'abri A, où l'on se repose
    const before = r.game.view().player.stamina;
    walk(r, off(200, 0), 1.3);
    const lost = before - r.game.view().player.stamina;
    // Même trajet, même charge, sans la contrainte : 0,0006 + 0,0022 x charge par seconde.
    const seconds = Math.ceil(dist(off(60, 0), off(200, 0)) / 1.3), plain = (STAMINA.drain + STAMINA.drainLoad * (kg / 20)) * seconds;
    expect(lost / plain).toBeCloseTo(SPECIAL.batteryDrain, 1);
  });

  it('boîte noire : délai court, et la livraison porte la mention « colis spécial » avec une grosse récompense', async () => {
    const { r, id } = await carry('boitenoire');
    r.game.pickup(id);
    const o = r.game.view().orders[0];
    expect(o.minutesLeft).not.toBeNull();
    expect(o.minutesLeft!).toBeLessThan(deadlineFor(dist(AT, o.destAt)));
    walk(r, o.destAt, 1.3, i => { if (i % 5 === 0) r.game.steady(); });
    expect(r.game.deliver(o.destId)).toEqual({ ok: true });
    const res = ofType(r.events, 'delivery')[0].result;
    expect(res).toMatchObject({ special: 'boitenoire', orderName: 'Boîte noire', onTime: true });
    expect(res.notes).toContain('Colis spécial');
    expect(res.points).toBeGreaterThanOrEqual(2 * baseReward(o.weightKg, dist(AT, o.destAt), false, true));
  });

  it('se sauvegarde et se recharge avec sa sorte et son état connu', async () => {
    const { r, id, cells } = await carry('cryo');
    r.game.pickup(id);
    await r.game.flush();
    expect(r.store.peek()!.orders[0]).toMatchObject({ id, special: 'cryo', inspected: true, state: 'porté' });
    const r2 = await rig({ store: r.store, t: r.clock.t });
    r2.game.setWorld(cells);
    place(r2, AT);
    expect(r2.game.view().orders[0]).toMatchObject({ id, name: 'Caisson cryogénique', special: { kind: 'cryo', known: true } });
    // Une valeur inconnue dans la sauvegarde est ignorée.
    const raw = JSON.parse(JSON.stringify(r.store.peek()));
    raw.orders[0].special = 'licorne';
    expect(parseGameSave(raw)!.orders[0].special).toBeUndefined();
  });

  it('une commande ordinaire ne porte aucun champ spécial', async () => {
    const s = spot('p1', AT), cells = world([A, B], [s]);
    const r = await rig({ t: when(t => quiet(cells, t)) });
    r.game.setWorld(cells); place(r, AT); r.game.scan();
    expect(r.game.view().orders[0]).toMatchObject({ special: null, lost: null, jamId: null });
  });
});
