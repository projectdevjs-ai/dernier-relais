import { describe, expect, it } from 'vitest';
import { RATCHET_CENTER, proofBonus, ratchetRelease, strapBalanceMult, strapPlan, strapQualityFromState, strapXp } from '../src/game/gestures';
import { GESTURE, PROOF } from '../src/game/rules';
import { type GameSave, SAVE_REV, emptyGameSave, parseGameSave } from '../src/game/save';
import { findSpot, off, ofType, place, rig, spot, wait, walk, world } from './game.helpers';
import { A, B, quiet, when } from './game.events.helpers';

const AT = off(100, 0);
async function one(want: Parameters<typeof findSpot>[3] = o => !o.fragile && o.deadlineMin === null, from = AT) {
  const s = findSpot('g', AT, [A, B], want);
  const cells = world([A, B], [s]);
  const r = await rig({ t: when(t => quiet(cells, t)) });
  r.game.setWorld(cells);
  place(r, from);
  r.game.scan();
  return { r, g: r.game, id: s.id, cells };
}

describe('arrimage', () => {
  it('cliquet : relâché dans la zone verte c’est serré, au-delà trop serré, avant pas assez', () => {
    const c = 0.6, zone = 0.14;
    expect(ratchetRelease(0, c, zone)).toBe('none'); expect(ratchetRelease(0.03, c, zone)).toBe('none'); // un effleurement n'est pas un geste
    expect(ratchetRelease(0.3, c, zone)).toBe('under');
    expect(ratchetRelease(c - zone / 2 + 0.001, c, zone)).toBe('ok'); expect(ratchetRelease(c, c, zone)).toBe('ok'); expect(ratchetRelease(c + zone / 2 - 0.001, c, zone)).toBe('ok');
    expect(ratchetRelease(c + zone / 2 + 0.01, c, zone)).toBe('over'); expect(ratchetRelease(1, c, zone)).toBe('over');
    expect(ratchetRelease(Number.NaN, c, zone)).toBe('none'); expect(ratchetRelease(-3, c, zone)).toBe('none'); expect(ratchetRelease(7, c, zone)).toBe('over');
    // La zone verte tient toujours dans la course du cliquet, pour tous les colis.
    for (const kg of [2, 7, 14]) for (const fragile of [false, true]) {
      const z = strapPlan({ weightKg: kg, fragile, timed: false }).ratchetZone;
      expect(z).toBeGreaterThanOrEqual(0.1);
      expect(RATCHET_CENTER[0] - z / 2).toBeGreaterThan(0.4); expect(RATCHET_CENTER[1] + z / 2).toBeLessThan(0.9);
    }
    // Qualité de l'arrimage d'après l'état du colis à la fin du sanglage ; l'XP récompense un sanglage parfait.
    expect(strapQualityFromState(100)).toBe(1); expect(strapQualityFromState(80)).toBe(0.8);
    expect(strapXp(1)).toBe(GESTURE.strapXp); expect(strapXp(0.79)).toBe(0);
  });
  it('effet : chaque colis arrimé pèse moins dans le déséquilibre, à proportion de son poids', () => {
    expect(strapBalanceMult([])).toBe(1);
    expect(strapBalanceMult([{ weightKg: 5 }])).toBe(1);
    expect(strapBalanceMult([{ weightKg: 5, strap: 1 }])).toBe(1 - GESTURE.strapEffect);
    expect(strapBalanceMult([{ weightKg: 5, strap: 0.5 }])).toBe(1 - GESTURE.strapEffect / 2);
    expect(strapBalanceMult([{ weightKg: 6, strap: 1 }, { weightKg: 2 }])).toBeCloseTo(1 - GESTURE.strapEffect * 0.75);
  });
  it('en jeu : déclaré juste après le ramassage (la séquence le fait aussitôt), une seule fois', async () => {
    const { r, g, id } = await one();
    expect(g.strap(id, 1)).toEqual({ ok: false, why: 'Ce colis n’est pas dans le sac.' });
    expect(g.view().orders[0]).toMatchObject({ strap: null, strapLeftS: 0 });
    g.pickup(id);
    expect(g.view().orders[0]).toMatchObject({ strap: null, strapLeftS: GESTURE.strapWindowS });
    wait(r, 3);
    expect(g.view().orders[0].strapLeftS).toBe(GESTURE.strapWindowS - 3);
    expect(g.strap(id, 1)).toEqual({ ok: true });
    expect(ofType(r.events, 'strap')).toEqual([{ type: 'strap', orderId: id, quality: 1, xp: GESTURE.strapXp }]);
    expect(g.view().orders[0]).toMatchObject({ strap: 1, strapLeftS: 0 });
    expect(g.view().player.xp).toBe(GESTURE.strapXp);
    expect(g.strap(id, 1)).toEqual({ ok: false, why: 'Ce colis est déjà arrimé.' });
    await g.flush();
    expect(r.store.peek()!.orders[0].strap).toBe(1);
    // Posé : la sangle est défaite. Repris : nouvelle fenêtre.
    g.drop(id);
    expect(g.view().orders[0]).toMatchObject({ strap: null, strapLeftS: 0 });
    g.pickup(id);
    wait(r, GESTURE.strapWindowS + 1);
    expect(g.view().orders[0].strapLeftS).toBe(0);
    expect(g.strap(id, 1)).toEqual({ ok: false, why: 'Trop tard pour l’arrimer.' });
    // Un geste moyen compte quand même, sans XP ; les valeurs folles sont bornées.
    g.drop(id); g.pickup(id);
    expect(g.strap(id, 9)).toEqual({ ok: true });
    expect(ofType(r.events, 'strap').at(-1)).toMatchObject({ quality: 1 });
    g.drop(id); g.pickup(id);
    expect(g.strap(id, 0.4)).toEqual({ ok: true });
    expect(ofType(r.events, 'strap').at(-1)).toEqual({ type: 'strap', orderId: id, quality: 0.4, xp: 0 });
  });
  it('en jeu : un colis bien arrimé garde un équilibre plus stable sur le même trajet', async () => {
    const drift = async (strap: boolean) => {
      const { r, g, id } = await one(o => !o.fragile && o.deadlineMin === null && o.weightKg >= 8);
      g.pickup(id);
      if (strap) g.strap(id, 1);
      let worst = 0;
      walk(r, off(100, 250), 1.3, () => { worst = Math.max(worst, Math.abs(g.view().player.balance)); });
      return worst;
    };
    const loose = await drift(false), tight = await drift(true);
    expect(loose).toBeGreaterThan(0.05);
    expect(tight).toBeLessThan(loose * 0.75);
  });
});

describe('inspection', () => {
  it('écouter un colis proche dit ce qu’il contient, une fois, pour un peu d’XP', async () => {
    const { r, g, id } = await one(o => o.fragile, off(100 + GESTURE.inspectM + 30, 0));
    expect(g.view().orders[0]).toMatchObject({ id, inspected: false, canInspect: false, inRange: false });
    expect(g.inspect(id)).toEqual({ ok: false, why: 'Trop loin pour l’écouter.' });
    walk(r, off(100 + GESTURE.inspectM - 10, 0));
    expect(g.view().orders[0]).toMatchObject({ inspected: false, canInspect: true, inRange: false });
    expect(g.inspect(id)).toEqual({ ok: true });
    const e = ofType(r.events, 'inspect');
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ xp: GESTURE.inspectXp, order: { id, inspected: true, fragile: true, canInspect: false } });
    expect(g.view().player.xp).toBe(GESTURE.inspectXp);
    expect(g.inspect(id)).toEqual({ ok: false, why: 'Tu sais déjà ce qu’il contient.' });
    expect(g.inspect('rien')).toEqual({ ok: false, why: 'Colis introuvable.' });
    await g.flush();
    expect(r.store.peek()!.orders[0].inspected).toBe(true);
  });
  it('ramasser sans écouter reste possible : le contenu est alors connu, sans bonus', async () => {
    const { g, id } = await one();
    g.pickup(id);
    expect(g.view().orders[0]).toMatchObject({ inspected: true, canInspect: false });
    expect(g.view().player.xp).toBe(0);
    expect(g.inspect(id)).toEqual({ ok: false, why: 'Colis introuvable.' });
  });
});

describe('preuve photo', () => {
  it('bonus : un dixième des points, cinq au moins', () => {
    expect(proofBonus(264)).toBe(26); expect(proofBonus(20)).toBe(PROOF.min); expect(proofBonus(0)).toBe(PROOF.min);
  });
  it('proposée à chaque livraison, une fois, pendant trois minutes', async () => {
    const { r, g, id } = await one();
    g.pickup(id);
    walk(r, B.at, 1.3, i => { if (i % 5 === 0) g.steady(); });
    expect(g.proof(id)).toEqual({ ok: false, why: 'Trop tard pour la photo.' }); // pas encore livré
    g.deliver('B');
    const res = ofType(r.events, 'delivery')[0].result;
    expect(res.proofBonus).toBe(proofBonus(res.points));
    const score = g.view().player.score, pts = g.view().shelters.find(s => s.id === 'B')!.points;
    expect(g.proof(id)).toEqual({ ok: true });
    expect(ofType(r.events, 'proof')).toEqual([{ type: 'proof', orderId: id, points: res.proofBonus }]);
    expect(g.view().player.score).toBe(score + res.proofBonus!);
    expect(g.view().shelters.find(s => s.id === 'B')!.points).toBe(pts + res.proofBonus!);
    expect(g.proof(id)).toEqual({ ok: false, why: 'Trop tard pour la photo.' });
  });
  it('sans photo, rien ne change ; après trois minutes, l’offre est passée', async () => {
    const { r, g, id } = await one();
    g.pickup(id);
    walk(r, B.at, 1.3, i => { if (i % 5 === 0) g.steady(); });
    g.deliver('B');
    const score = g.view().player.score;
    wait(r, PROOF.windowMs / 1000 + 1);
    expect(g.proof(id)).toEqual({ ok: false, why: 'Trop tard pour la photo.' });
    expect(g.view().player.score).toBe(score);
    expect(ofType(r.events, 'proof')).toEqual([]);
  });
});

describe('sauvegarde : révision 2', () => {
  it('une sauvegarde d’avant les systèmes secondaires se charge telle quelle', async () => {
    const old: Record<string, unknown> = { ...emptyGameSave('2026-11-11'), level: 3, score: 900, deliveries: 7, shelters: { A: { points: 320, deliveries: 4 } } };
    for (const k of ['rev', 'cachesFound', 'cachesOpened', 'met', 'jams']) delete old[k];
    old.orders = [{ id: 'o1', cell: '1/2', name: 'Outils', rareName: null, crate: 'bois', weightKg: 9, fragile: false, at: AT, destId: 'A', destName: 'Abri A', destAt: A.at, deadlineMin: null, baseReward: 80, state: 'porté', condition: 0.9, pickedAt: 1000 }];
    const s = parseGameSave(JSON.parse(JSON.stringify(old)))!;
    expect(s).toMatchObject({ version: 1, rev: SAVE_REV, level: 3, score: 900, cachesFound: [], cachesOpened: [], met: [], jams: [] });
    expect(Object.keys(s.orders[0]).sort()).toEqual(Object.keys((old.orders as object[])[0]).sort());
    const cells = world([A, B], [spot('p1', off(50, 0))]);
    const r = await rig({ save: s as GameSave, t: Date.UTC(2026, 10, 11, 10) });
    r.game.setWorld(cells); place(r, AT);
    expect(r.game.view().player).toMatchObject({ level: 3, score: 900, deliveries: 7 });
    expect(r.game.view().orders[0]).toMatchObject({ id: 'o1', state: 'porté', special: null, strap: null });
    expect(r.game.view()).toMatchObject({ caches: [], jams: [] });
  });
  it('les champs douteux de la révision 2 sont corrigés', () => {
    const s = parseGameSave({ ...emptyGameSave('2026-11-11'), cachesFound: ['a', 3], met: 'non', jams: [{ id: 'j' }, 4, { id: 'j2', shelterId: 'A', at: [1, 2], count: 3.7, delivered: -1, state: 'bizarre' }],
      orders: [{ id: 'o', name: 'x', destId: 'A', at: [1, 2], destAt: [1, 2], state: 'révélé', strap: 7, lost: { by: 4 }, jam: 3, inspected: 'oui', front: 1 }] })!;
    expect(s.cachesFound).toEqual(['a']); expect(s.met).toEqual([]);
    expect(s.jams).toEqual([{ id: 'j2', shelterId: 'A', shelterName: '', at: [1, 2], count: 3, delivered: 0, minutes: 10, bonus: 0, startedAt: 0, state: 'en cours' }]);
    expect(s.orders[0]).toMatchObject({ strap: 1 });
    for (const k of ['lost', 'jam', 'inspected', 'front', 'special'] as const) expect(s.orders[0][k]).toBeUndefined();
  });
});
