// Rangement : emplacements (dos, bras, jambes), paliers d'exosquelette, équilibre gauche/droite, sanglage, surprises.
import { describe, expect, it } from 'vitest';
import { driftBalance, wearPerSecond } from '../src/game/carry';
import { STRAP, strapPlan, strapQualityFromState } from '../src/game/gestures';
import { BAG_KG, GESTURE } from '../src/game/rules';
import { type GameSave, SAVE_REV, emptyGameSave, parseGameSave } from '../src/game/save';
import { SKILLS, learnBlock, modsFor, skillViews } from '../src/game/skills';
import {
  EXO, type Rig as Exo, SLOTS, SLOT_IDS, SLOT_RULES, type Stowed, arrange, bestSlot, capacityKg, exoTier, isSlot, lateral, leanText, legsDrainMult, loadSwayMult, moveTo,
  sideKg, slotFull, slotOk, slotRule, specialSlotNote, stability,
} from '../src/game/slots';
import { LORE, SURPRISE, SURPRISE_NOTE, loreFor, surpriseFor } from '../src/game/surprises';
import { dayKey } from '../src/game/time';
import { T0, findSpecial, findSpot, findSurprise, off, ofType, place, rig, wait, walk, world } from './game.helpers';
import { A, B, quiet, when } from './game.events.helpers';

const item = (id: string, weightKg: number, over: Partial<Stowed> = {}): Stowed => ({ id, weightKg, fragile: false, ...over });
const T = (tier: number, backKg = BAG_KG): Exo => ({ tier, backKg });
const save = (over: Partial<GameSave>, t = T0): GameSave => ({ ...emptyGameSave(dayKey(t)), ...over });
const FULL = { 'exo-bras': 1, 'exo-jambes': 1, 'exo-gyro': 1 };
const AT = off(100, 0);

/** Monde de `n` colis posés au même endroit, déjà scannés, dans un secteur calme. */
async function bagOf(wants: ((o: { weightKg: number; fragile: boolean; deadlineMin: number | null }) => boolean)[], skills: Record<string, number> = {}, level = 8) {
  const spots = wants.map((w, i) => findSpot(`s${i}x`, AT, [A, B], o => o.deadlineMin === null && w(o)));
  const cells = world([A, B], spots);
  const t = when(x => quiet(cells, x));
  const r = await rig({ t, save: save({ level, skills }, t) });
  r.game.setWorld(cells);
  place(r, AT);
  r.game.scan();
  return { r, g: r.game, ids: spots.map(s => s.id), cells };
}

describe('emplacements : règles', () => {
  it('cinq emplacements, ceux de l’ancien jeu : dos, bras (12 kg), jambes (9 kg), gauche et droite', () => {
    expect(SLOT_IDS).toEqual(['dos', 'brasG', 'brasD', 'jambeG', 'jambeD']);
    expect(SLOT_IDS.map(k => [SLOTS[k].name, SLOTS[k].side, SLOTS[k].maxKg, SLOTS[k].tier])).toEqual([
      ['Dos', 0, null, 0], ['Bras gauche', -1, 12, 1], ['Bras droit', 1, 12, 1], ['Jambe gauche', -1, 9, 2], ['Jambe droite', 1, 9, 2],
    ]);
    expect(isSlot('brasG')).toBe(true); expect(isSlot('tête')).toBe(false); expect(isSlot(3)).toBe(false); expect(isSlot('toString')).toBe(false);
  });
  it('verrouillés tant que le palier d’exosquelette n’est pas installé', () => {
    const p = item('a', 3);
    expect(slotRule(p, 'dos', 0)).toBe('');
    expect(slotRule(p, 'brasG', 0)).toBe('Attaches de bras à installer (Noé, au labo)');
    expect(slotRule(p, 'jambeD', 1)).toBe('Attaches de jambes à installer (Noé, au labo)');
    expect(slotRule(p, 'brasD', 1)).toBe(''); expect(slotRule(p, 'jambeG', 2)).toBe('');
  });
  it('capacité par emplacement : trop lourd pour un bras ou une jambe, fragile jamais aux jambes', () => {
    expect(slotRule(item('a', 12), 'brasG', 3)).toBe('');
    expect(slotRule(item('a', 12.5), 'brasG', 3)).toBe('Trop lourd (max 12 kg ici)');
    expect(slotRule(item('a', 10), 'jambeG', 3)).toBe('Trop lourd (max 9 kg ici)');
    expect(slotRule(item('a', 2, { fragile: true }), 'jambeD', 3)).toBe('Fragile : les jambes secouent trop');
    expect(slotRule(item('a', 2, { fragile: true }), 'brasD', 3)).toBe('');
  });
  it('colis spéciaux : cellule au dos seulement, cryo et ruche jamais aux jambes', () => {
    expect(slotRule(item('b', 10, { special: 'batterie' }), 'brasG', 3)).toMatch(/^Dos uniquement/);
    expect(slotRule(item('b', 16, { special: 'batterie' }), 'dos', 3)).toBe('');
    for (const kind of ['cryo', 'ruche'] as const) {
      expect(slotRule(item('c', 8, { special: kind }), 'jambeG', 3)).toBe('Fragile : les jambes secouent trop');
      expect(slotRule(item('c', 8, { special: kind }), 'brasG', 3)).toBe('');
    }
    expect(slotRule(item('n', 6, { special: 'boitenoire' }), 'jambeD', 3)).toBe('');
    expect(specialSlotNote('batterie')).toBe('Dos uniquement.'); expect(specialSlotNote('cryo')).toBe('Jamais sur les jambes.');
    expect(specialSlotNote('boitenoire')).toMatch(/pluie/); expect(specialSlotNote(undefined)).toBe('');
  });
  it('une fixation porte un seul colis ; le dos est limité par son poids', () => {
    const bag = [item('a', 5, { slot: 'brasG' }), item('b', 12, { slot: 'dos' })];
    expect(slotFull(item('c', 2), 'brasG', bag, T(3))).toBe('Emplacement plein');
    expect(slotFull(item('c', 2), 'brasD', bag, T(3))).toBe('');
    expect(slotFull(item('c', 8), 'dos', bag, T(3))).toBe('');
    expect(slotFull(item('c', 9), 'dos', bag, T(3))).toBe('Dos trop chargé');
    expect(slotFull(bag[0], 'brasG', bag, T(3))).toBe(''); // le colis lui-même ne compte pas
    expect(slotOk(item('c', 9), 'dos', bag, T(3, 25))).toBe(true);
  });
  it('la capacité totale vient des emplacements débloqués', () => {
    expect(capacityKg(T(0))).toBe(20); expect(capacityKg(T(1))).toBe(44); expect(capacityKg(T(2))).toBe(62); expect(capacityKg(T(3))).toBe(62);
    expect(capacityKg(T(2, 40))).toBe(82);
  });
});

describe('emplacements : répartition et équilibre', () => {
  const bag = [item('a', 10, { slot: 'dos' }), item('b', 6, { slot: 'brasG' }), item('c', 4, { slot: 'jambeD' }), item('d', 2, { slot: 'brasD' })];
  it('poids à gauche, à droite, aux bras et aux jambes', () => {
    expect(sideKg(bag)).toEqual({ left: 6, right: 6, legs: 4, arms: 8, total: 22 });
    expect(sideKg([item('x', 5)])).toEqual({ left: 0, right: 0, legs: 0, arms: 0, total: 5 }); // sans emplacement : au dos
  });
  it('déséquilibre latéral : (droite − gauche) / max(15 kg, charge), comme dans l’ancien jeu', () => {
    expect(lateral(bag)).toBe(0);
    expect(lateral([item('a', 6, { slot: 'brasD' })])).toBeCloseTo(6 / 15);
    expect(lateral([item('a', 6, { slot: 'brasG' }), item('b', 24)])).toBeCloseTo(-6 / 30);
    expect(lateral([])).toBe(0);
    expect(leanText(0.05)).toEqual({ text: 'Équilibré', tone: 'good' });
    expect(leanText(-0.2)).toEqual({ text: 'Penche à gauche', tone: 'warn' });
    expect(leanText(0.4)).toEqual({ text: 'Penche à droite', tone: 'bad' });
  });
  it('stabilité : bras, jambes, charge de travers et sac presque plein la dégradent', () => {
    const rig3 = T(2);
    expect(stability([], rig3)).toBe(1);
    expect(stability([item('a', 10)], rig3)).toBe(1);
    expect(stability([item('a', 12, { slot: 'brasG' }), item('b', 12, { slot: 'brasD' })], rig3)).toBeCloseTo(1 - 24 / SLOT_RULES.armsKg);
    expect(stability([item('a', 9, { slot: 'jambeG' }), item('b', 9, { slot: 'jambeD' })], rig3)).toBeCloseTo(1 - 18 / SLOT_RULES.legsKg);
    expect(stability([item('a', 12, { slot: 'brasD' })], rig3)).toBeCloseTo(1 - (12 / 15) * 0.8 - 12 / 60);
    expect(stability([item('a', 20)], T(0))).toBeCloseTo(1 - 0.3 * 0.6);
    expect(stability([item('a', 12, { slot: 'brasD' }), item('b', 9, { slot: 'jambeD' })], rig3)).toBeGreaterThanOrEqual(0.1);
  });
  it('dérive : une charge instable tangue plus ; les stabilisateurs gyroscopiques retirent 20 %', () => {
    expect(loadSwayMult([], T(0))).toBe(1);
    expect(loadSwayMult([item('a', 10)], T(2))).toBe(1);
    const arms = [item('a', 12, { slot: 'brasG' }), item('b', 12, { slot: 'brasD' })];
    expect(loadSwayMult(arms, T(2))).toBeCloseTo(1.55 / (0.55 + 0.6));
    expect(loadSwayMult(arms, T(3))).toBeCloseTo((1.55 / 1.15) * 0.8);
    expect(loadSwayMult([item('a', 10)], T(3))).toBeCloseTo(0.8);
  });
  it('fatigue : +100 % pour 35 kg aux jambes', () => {
    expect(legsDrainMult([item('a', 10)])).toBe(1);
    expect(legsDrainMult([item('a', 9, { slot: 'jambeG' }), item('b', 5, { slot: 'jambeD' })])).toBeCloseTo(1 + 14 / 35);
  });
  it('l’équilibre dérive du côté le plus lourd', () => {
    const run = (lean: number): number => { let b = 0; for (let t = 0; t < 60; t++) b = driftBalance(b, 1, t, { moving: true, loadFrac: 0.3, windKmh: 0, mult: 1, lean }); return b; };
    expect(run(1)).toBeGreaterThan(run(0) + 0.5);
    expect(run(-1)).toBeLessThan(run(0) - 0.5);
    expect(driftBalance(0.4, 1, 0, { moving: false, loadFrac: 0.3, windKmh: 0, mult: 1, lean: 1 })).toBeLessThan(0.4); // à l'arrêt, la charge se calme
  });
});

describe('emplacements : rangement conseillé', () => {
  it('lourd, fragile ou spécial : au dos d’abord ; léger : aux bras, côté le plus léger', () => {
    expect(bestSlot(item('a', 10), [], T(2))).toBe('dos');
    expect(bestSlot(item('a', 3, { fragile: true }), [], T(2))).toBe('dos');
    expect(bestSlot(item('a', 6, { special: 'boitenoire' }), [], T(2))).toBe('dos');
    expect(bestSlot(item('a', 3), [], T(2))).toBe('brasG');
    expect(bestSlot(item('b', 3), [item('a', 3, { slot: 'brasG' })], T(2))).toBe('brasD');
    expect(bestSlot(item('c', 3), [item('a', 3, { slot: 'brasG' }), item('b', 4, { slot: 'brasD' })], T(2))).toBe('dos');
    expect(bestSlot(item('a', 3), [], T(0))).toBe('dos');
  });
  it('dos plein : le colis part sur une fixation libre, sinon nulle part', () => {
    const full = [item('a', 12), item('b', 8)];
    expect(bestSlot(item('c', 5), full, T(0))).toBeNull();
    expect(bestSlot(item('c', 5), full, T(1))).toBe('brasG');
    expect(bestSlot(item('c', 14), full, T(2))).toBeNull(); // trop lourd pour un membre
    expect(bestSlot(item('c', 5, { fragile: true }), [...full, item('d', 2, { slot: 'brasG' }), item('e', 2, { slot: 'brasD' })], T(2))).toBeNull(); // fragile : pas aux jambes
  });
  it('rangement automatique : tout est placé, charge rééquilibrée, contraintes respectées', () => {
    const bag = [item('a', 3, { slot: 'brasD' }), item('b', 4, { slot: 'jambeD' }), item('c', 11), item('d', 16, { special: 'batterie' }), item('e', 2, { fragile: true })];
    const rig3 = T(2, 30), out = arrange(bag, rig3);
    expect([...out.keys()].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    const placed = bag.map(b => ({ ...b, slot: out.get(b.id)! }));
    expect(out.get('d')).toBe('dos');
    for (const p of placed) expect(slotRule(p, p.slot, rig3.tier)).toBe('');
    for (const k of ['brasG', 'brasD', 'jambeG', 'jambeD'] as const) expect(placed.filter(p => p.slot === k).length).toBeLessThanOrEqual(1);
    expect(Math.abs(lateral(placed))).toBeLessThan(Math.abs(lateral(bag)));
  });
  it('déplacer : libre si la place existe, échange avec l’occupant d’une fixation, sinon refus motivé', () => {
    const a = item('a', 3, { slot: 'brasG' }), b = item('b', 5, { slot: 'brasD' }), c = item('c', 14, { slot: 'dos' }), bag = [a, b, c];
    expect(moveTo(a, 'brasG', bag, T(2))).toEqual({ ok: true, moves: [] });
    expect(moveTo(a, 'jambeG', bag, T(2))).toEqual({ ok: true, moves: [['a', 'jambeG']] });
    expect(moveTo(a, 'brasD', bag, T(2))).toEqual({ ok: true, moves: [['b', 'brasG'], ['a', 'brasD']] });
    expect(moveTo(c, 'brasD', bag, T(2))).toEqual({ ok: false, why: 'Trop lourd (max 12 kg ici)' });
    expect(moveTo(a, 'jambeG', bag, T(1))).toEqual({ ok: false, why: 'Attaches de jambes à installer (Noé, au labo)' });
    // Échange impossible : l'occupant ne tiendrait pas à la place libérée.
    const heavy = item('h', 11, { slot: 'brasG' }), leg = item('l', 4, { slot: 'jambeG' });
    expect(moveTo(leg, 'brasG', [heavy, leg], T(2))).toEqual({ ok: false, why: 'Emplacement plein' });
    expect(moveTo(item('z', 9, { slot: 'brasD' }), 'dos', [item('y', 15, { slot: 'dos' }), item('z', 9, { slot: 'brasD' })], T(2))).toEqual({ ok: false, why: 'Dos trop chargé' });
  });
});

describe('paliers d’exosquelette', () => {
  it('reprennent les quatre paliers de l’ancien jeu : noms, descriptions, niveaux', () => {
    expect(EXO.map(e => [e.name, e.level])).toEqual([['Harnais dorsal', 1], ['Attaches de bras', 2], ['Attaches de jambes', 4], ['Stabilisateurs gyroscopiques', 7]]);
    expect(EXO[1].desc).toBe('Deux fixations aux bras (12 kg chacune). La charge tangue un peu plus.');
    expect(EXO[2].desc).toBe('Deux fixations aux cuisses (9 kg chacune). Fatiguent davantage.');
    expect(EXO[3].desc).toBe('La charge dérive 20 % moins, rafales comprises.');
  });
  it('sont des compétences de la branche portage, installées dans l’ordre', () => {
    const exo = SKILLS.filter(s => s.exoTier);
    expect(exo.map(s => [s.id, s.name, s.cost, s.needsLevel, s.needs?.id])).toEqual([
      ['exo-bras', 'Attaches de bras', 1, 2, undefined], ['exo-jambes', 'Attaches de jambes', 2, 4, 'exo-bras'], ['exo-gyro', 'Stabilisateurs gyroscopiques', 3, 7, 'exo-jambes'],
    ]);
    for (const s of exo) { expect(s.branch).toBe('portage'); expect(s.desc).toMatch(/^Noé l’installe au labo\. /); }
    expect(exoTier({})).toBe(0); expect(exoTier({ 'exo-bras': 1 })).toBe(1); expect(exoTier({ 'exo-bras': 1, 'exo-jambes': 1 })).toBe(2); expect(exoTier(FULL)).toBe(3);
    expect(exoTier({ 'exo-jambes': 1, 'exo-gyro': 1 })).toBe(0); // sauvegarde incohérente : rien sans le palier précédent
    expect(modsFor({}).exoTier).toBe(0); expect(modsFor(FULL).exoTier).toBe(3); expect(modsFor(FULL).capacityKg).toBe(BAG_KG);
  });
  it('demandent un niveau de porteur, puis des points de compétence', () => {
    expect(learnBlock('exo-bras', {}, 5, 1)).toBe('Noé l’installera quand tu seras niveau 2.');
    expect(learnBlock('exo-bras', {}, 0, 2)).toBe('Pas assez de points de compétence.');
    expect(learnBlock('exo-bras', {}, 1, 2)).toBeNull();
    expect(learnBlock('exo-jambes', {}, 5, 9)).toBe('Il faut d’abord « Attaches de bras » au rang 1.');
    expect(learnBlock('exo-jambes', { 'exo-bras': 1 }, 5, 3)).toBe('Noé l’installera quand tu seras niveau 4.');
    expect(learnBlock('exo-gyro', { 'exo-bras': 1, 'exo-jambes': 1 }, 3, 7)).toBeNull();
    expect(learnBlock('exo-bras', { 'exo-bras': 1 }, 5, 9)).toBe('Rang maximal déjà atteint.');
    expect(learnBlock('sac', {}, 1, 1)).toBeNull(); // les autres compétences n'ont pas de condition de niveau
    const v = skillViews({}, 3, 1).find(s => s.id === 'exo-bras')!;
    expect(v).toMatchObject({ available: false, needsLevel: 2, exoTier: 1, maxRank: 1 });
    expect(skillViews({}, 3, 2).find(s => s.id === 'exo-bras')!.available).toBe(true);
  });
  it('en jeu : installer les attaches débloque les emplacements et augmente la capacité', async () => {
    const r = await rig({ save: save({ level: 4, skillPoints: 3 }) });
    const p0 = r.game.view().player;
    expect(p0).toMatchObject({ exoTier: 0, capacityKg: 20 });
    expect(p0.slots!.map(s => [s.id, s.unlocked, s.maxKg])).toEqual([['dos', true, 20], ['brasG', false, 12], ['brasD', false, 12], ['jambeG', false, 9], ['jambeD', false, 9]]);
    expect(p0.slots![1].lockedWhy).toBe('Attaches de bras à installer chez Noé, au labo');
    expect(p0.slots![3].lockedWhy).toBe('Attaches de jambes à installer chez Noé, au labo');
    expect(p0.exo!.map(e => e.installed)).toEqual([true, false, false, false]);
    expect(r.game.learn('exo-jambes').ok).toBe(false);
    expect(r.game.learn('exo-bras')).toEqual({ ok: true });
    expect(r.game.view().player).toMatchObject({ exoTier: 1, capacityKg: 44, skillPoints: 2 });
    expect(r.game.learn('exo-jambes')).toEqual({ ok: true });
    expect(r.game.view().player).toMatchObject({ exoTier: 2, capacityKg: 62, skillPoints: 0 });
    expect(r.game.view().player.slots!.every(s => s.unlocked)).toBe(true);
    expect(r.game.learn('exo-gyro')).toEqual({ ok: false, why: 'Noé l’installera quand tu seras niveau 7.' });
    await r.game.flush();
    const r2 = await rig({ store: r.store });
    expect(r2.game.view().player).toMatchObject({ exoTier: 2, capacityKg: 62 });
  });
});

describe('rangement en jeu', () => {
  it('chaque colis ramassé reçoit un emplacement ; sans attaches, tout va au dos', async () => {
    const { r, g, ids } = await bagOf([o => o.weightKg <= 4 && !o.fragile, o => o.weightKg >= 10]);
    expect(g.view().orders.every(o => o.slot === null)).toBe(true);
    expect(g.canPickup!(ids[0])).toEqual({ ok: true });
    expect(g.pickup(ids[0])).toEqual({ ok: true });
    expect(g.pickup(ids[1])).toEqual({ ok: true });
    expect(ofType(r.events, 'pickup').map(e => e.order.slot)).toEqual(['dos', 'dos']);
    expect(g.stow!(ids[0], 'brasG')).toEqual({ ok: false, why: 'Attaches de bras à installer (Noé, au labo).' });
    expect(g.pickup(ids[0], 'dos')).toEqual({ ok: false, why: 'Ce colis est déjà dans le sac.' });
  });
  it('avec les attaches : léger aux bras, lourd au dos ; on déplace, on échange, on range d’office', async () => {
    const { r, g, ids } = await bagOf([o => o.weightKg <= 4 && !o.fragile, o => o.weightKg >= 10, o => o.weightKg <= 4 && !o.fragile, o => o.fragile && o.weightKg <= 4], { 'exo-bras': 1, 'exo-jambes': 1 });
    const [light, heavy, light2, glass] = ids;
    g.pickup(light); g.pickup(heavy); g.pickup(light2); g.pickup(glass);
    const slot = (id: string) => g.view().orders.find(o => o.id === id)!.slot;
    expect([slot(light), slot(heavy), slot(light2), slot(glass)]).toEqual(['brasG', 'dos', 'brasD', 'dos']);
    const pv = g.view().player;
    expect(pv.slots!.find(s => s.id === 'dos')!.orders.sort()).toEqual([heavy, glass].sort());
    expect(pv.sides!.armsKg).toBe(pv.sides!.leftKg + pv.sides!.rightKg);
    // Déplacer vers une jambe libre, puis échanger deux fixations.
    expect(g.stow!(light, 'jambeG')).toEqual({ ok: true });
    expect(slot(light)).toBe('jambeG');
    expect(ofType(r.events, 'stow').at(-1)).toEqual({ type: 'stow', orderId: light, slot: 'jambeG' });
    expect(g.stow!(light, 'brasD')).toEqual({ ok: true });
    expect([slot(light), slot(light2)]).toEqual(['brasD', 'jambeG']);
    expect(g.stow!(glass, 'jambeD')).toEqual({ ok: false, why: 'Fragile : les jambes secouent trop.' });
    expect(g.stow!(heavy, 'brasG')).toEqual({ ok: g.view().orders.find(o => o.id === heavy)!.weightKg <= 12 });
    expect(g.stow!('rien', 'dos')).toEqual({ ok: false, why: 'Ce colis n’est pas dans le sac.' });
    expect(g.stow!(light, 'tête' as never)).toEqual({ ok: false, why: 'Emplacement inconnu.' });
    expect(g.autoStow!()).toEqual({ ok: true });
    const slots = g.view().orders.map(o => o.slot);
    expect(slots.filter(s => s === 'brasG').length).toBeLessThanOrEqual(1);
    expect(slot(glass)).not.toMatch(/jambe/);
  });
  it('emplacement choisi au ramassage, refusé s’il ne convient pas', async () => {
    const { g, ids } = await bagOf([o => o.weightKg <= 4 && !o.fragile, o => o.weightKg <= 4 && !o.fragile], { 'exo-bras': 1 });
    expect(g.pickup(ids[0], 'jambeG')).toEqual({ ok: false, why: 'Attaches de jambes à installer (Noé, au labo).' });
    expect(g.pickup(ids[0], 'brasD')).toEqual({ ok: true });
    expect(g.pickup(ids[1], 'brasD')).toEqual({ ok: false, why: 'Emplacement plein.' });
    expect(g.pickup(ids[1])).toEqual({ ok: true });
    expect(g.view().orders.find(o => o.id === ids[1])!.slot).toBe('brasG');
  });
  it('le dos plein ne bloque plus quand une fixation est libre', async () => {
    const { g, ids } = await bagOf([o => o.weightKg >= 10, o => o.weightKg >= 8 && o.weightKg <= 10, o => o.weightKg >= 5 && o.weightKg <= 9 && !o.fragile], { 'exo-bras': 1 });
    expect(g.pickup(ids[0]).ok).toBe(true);
    expect(g.pickup(ids[1]).ok).toBe(true);
    const kg = g.view().player.carriedKg;
    expect(g.pickup(ids[2]).ok).toBe(true);
    const o = g.view().orders.find(x => x.id === ids[2])!;
    expect(kg + o.weightKg > 20 ? o.slot !== 'dos' : true).toBe(true);
    expect(g.view().player.carriedKg).toBeLessThanOrEqual(g.view().player.capacityKg);
  });
  it('posé : l’emplacement est libéré ; l’emplacement se sauvegarde et se relit', async () => {
    const { r, g, ids } = await bagOf([o => o.weightKg <= 4 && !o.fragile, o => o.weightKg <= 4 && !o.fragile], { 'exo-bras': 1, 'exo-jambes': 1 });
    g.pickup(ids[0]); g.pickup(ids[1]);
    g.stow!(ids[1], 'jambeD');
    await g.flush();
    const saved = r.store.peek()!;
    expect(saved.rev).toBe(SAVE_REV);
    expect(Object.fromEntries(saved.orders.map(o => [o.id, o.slot]))).toEqual({ [ids[0]]: 'brasG', [ids[1]]: 'jambeD' });
    const r2 = await rig({ store: r.store, t: r.clock.t });
    expect(Object.fromEntries(r2.game.view().orders.map(o => [o.id, o.slot]))).toEqual({ [ids[0]]: 'brasG', [ids[1]]: 'jambeD' });
    expect(r2.game.view().player.sides).toMatchObject({ armsKg: saved.orders[0].weightKg, legsKg: saved.orders[1].weightKg });
    g.drop(ids[1]);
    expect(g.view().orders.find(o => o.id === ids[1])!.slot).toBeNull();
    await g.flush();
    expect(r.store.peek()!.orders.find(o => o.id === ids[1])!.slot).toBeUndefined();
  });
  it('sauvegarde : emplacement douteux ignoré, colis sans emplacement au dos', async () => {
    const base = { id: 'o', name: 'Outils', destId: 'A', destName: 'Abri A', at: AT, destAt: A.at, weightKg: 4 };
    const s = parseGameSave({ ...emptyGameSave('2026-11-11'), orders: [
      { ...base, id: 'a', state: 'porté', slot: 'brasG' }, { ...base, id: 'b', state: 'porté', slot: 'tête' }, { ...base, id: 'c', state: 'porté' },
      { ...base, id: 'd', state: 'révélé', slot: 'dos', surprise: 'chat', label: true }, { ...base, id: 'e', state: 'révélé', surprise: 'licorne', label: 'oui' },
    ] })!;
    expect(s.orders.map(o => o.slot)).toEqual(['brasG', undefined, undefined, undefined, undefined]);
    expect(s.orders.map(o => o.surprise)).toEqual([undefined, undefined, undefined, 'chat', undefined]);
    expect(s.orders.map(o => o.label)).toEqual([undefined, undefined, undefined, true, undefined]);
    const r = await rig({ save: s as GameSave });
    expect(r.game.view().orders.filter(o => o.state === 'porté').map(o => o.slot)).toEqual(['brasG', 'dos', 'dos']);
    expect(r.game.view().player.slots!.find(x => x.id === 'dos')!.orders.sort()).toEqual(['b', 'c']);
  });
  it('charge de travers : l’équilibre dérive du côté lourd, et se calme une fois rangée des deux côtés', async () => {
    const worst = async (arrange: boolean) => {
      const { r, g, ids } = await bagOf([o => o.weightKg >= 7 && o.weightKg <= 9 && !o.fragile, o => o.weightKg >= 7 && o.weightKg <= 9 && !o.fragile], { 'exo-bras': 1 });
      g.pickup(ids[0], arrange ? 'brasG' : 'brasD'); g.pickup(ids[1], arrange ? 'brasD' : 'dos');
      let sum = 0, n = 0;
      walk(r, off(100, 200), 1.3, () => { sum += g.view().player.balance; n++; });
      return { mean: sum / n, lean: g.view().player.lean! };
    };
    const skew = await worst(false), even = await worst(true);
    expect(skew.lean).toBeGreaterThan(0.3);
    expect(Math.abs(even.lean)).toBeLessThan(0.15);
    expect(skew.mean).toBeGreaterThan(even.mean + 0.2);
  });
  it('jambes chargées : la marche fatigue davantage', async () => {
    const tired = async (legs: boolean) => {
      const { r, g, ids } = await bagOf([o => o.weightKg >= 7 && o.weightKg <= 9 && !o.fragile], FULL);
      g.pickup(ids[0], legs ? 'jambeG' : 'dos');
      walk(r, off(100, 300), 1.3, i => { if (i % 5 === 0) g.steady(); });
      return 1 - g.view().player.stamina;
    };
    const back = await tired(false), legs = await tired(true);
    expect(legs).toBeGreaterThan(back * 1.15);
  });
  it('boîte noire : protégée de la pluie sur le dos, pas sur un bras', () => {
    const rain = { weather: 'pluie' as const, inDanger: false, unbalanced: false, running: false, exhausted: false, wearMult: 1, dangerMult: 1 };
    const box = { fragile: false, crate: 'alu' as const };
    expect(wearPerSecond(box, rain)).toBeGreaterThan(0);
    expect(wearPerSecond(box, { ...rain, sheltered: true })).toBe(0);
    expect(wearPerSecond(box, { ...rain, sheltered: true, inDanger: true })).toBeGreaterThan(0); // seule la pluie est arrêtée
  });
  it('boîte noire en jeu : au dos sous la pluie elle ne s’abîme pas, au bras si', async () => {
    const lost = async (slot: 'dos' | 'brasG') => {
      const s = findSpecial('boitenoire', AT, [A, B]);
      const cells = world([A, B], [s]);
      const t = when(x => quiet(cells, x));
      const r = await rig({ t, save: save({ level: 8, skills: { 'exo-bras': 1 } }, t) });
      r.game.setWorld(cells); place(r, AT); r.game.scan();
      r.game.setWeather({ kind: 'pluie', windKmh: 0, tempC: 10, night: false, sunAltDeg: 20 });
      expect(r.game.pickup(s.id, slot)).toEqual({ ok: true });
      wait(r, 600);
      return 1 - r.game.view().orders[0].condition;
    };
    expect(await lost('dos')).toBe(0);
    expect(await lost('brasG')).toBeGreaterThan(0.01);
  });
});

describe('sanglage', () => {
  it('nombre de boucles selon le colis : 3 pour un colis simple, jusqu’à 7', () => {
    const plain = strapPlan({ weightKg: 3, fragile: false, timed: false });
    expect(plain).toMatchObject({ nodes: 3, corr: 24, hold: 220, time: 15, harshSpeed: 1600, harshCost: 5, ratchetZone: 0.14 });
    expect(plain.lag).toBeCloseTo(0.42); expect(plain.sway).toBeCloseTo(2.5);
    expect(strapPlan({ weightKg: 7, fragile: true, timed: false })).toMatchObject({ nodes: 4, harshSpeed: 900, harshCost: 10, ratchetZone: 0.17 });
    expect(strapPlan({ weightKg: 12, fragile: false, timed: true })).toMatchObject({ nodes: 6, corr: 17.5, hold: 430, time: 20, ratchetZone: 0.1 });
    expect(strapPlan({ weightKg: 16, fragile: false, timed: false, special: 'batterie' }).nodes).toBe(7);
    expect(strapPlan({ weightKg: 11, fragile: false, timed: false, special: 'ruche' })).toMatchObject({ harshSpeed: 520, harshCost: 8 });
    for (const kg of [1, 5, 10, 18]) for (const timed of [false, true]) {
      const p = strapPlan({ weightKg: kg, fragile: false, timed });
      expect(p.time).toBeGreaterThanOrEqual(15); expect(p.time).toBeLessThanOrEqual(22); expect(p.corr).toBeGreaterThanOrEqual(15); expect(p.lag).toBeGreaterThan(0.2);
    }
  });
  it('qualité : parfaite à partir de 95 % d’état, sinon l’état lui-même', () => {
    expect(strapQualityFromState(100)).toBe(1); expect(strapQualityFromState(STRAP.perfect)).toBe(1);
    expect(strapQualityFromState(90)).toBe(0.9); expect(strapQualityFromState(36)).toBe(0.36);
    expect(strapQualityFromState(-5)).toBe(0); expect(strapQualityFromState(250)).toBe(1); expect(strapQualityFromState(Number.NaN)).toBe(0);
    expect(STRAP.refuse).toBe(35);
  });
  it('un colis bien sanglé s’abîme moins quand la charge est déséquilibrée', () => {
    const c = { weather: 'clair' as const, inDanger: false, unbalanced: true, running: true, exhausted: false, wearMult: 1, dangerMult: 1 };
    const glass = { fragile: true, crate: 'carton' as const };
    expect(wearPerSecond(glass, { ...c, strap: 1 })).toBeCloseTo(wearPerSecond(glass, c) * (1 - GESTURE.strapWear));
    expect(wearPerSecond(glass, { ...c, strap: 0.5 })).toBeGreaterThan(wearPerSecond(glass, { ...c, strap: 1 }));
  });
  it('sanglage raté ou abandonné : 3 points perdus, le colis reste au sol', async () => {
    const { r, g, ids } = await bagOf([o => !o.fragile]);
    expect(g.fumble!(ids[0])).toEqual({ ok: true });
    expect(ofType(r.events, 'fumble')).toEqual([{ type: 'fumble', orderId: ids[0], points: 0 }]); // rien à perdre à 0 point
    expect(g.view().orders[0].state).toBe('révélé');
    const r2 = await rig({ save: save({ score: 50 }), t: r.clock.t });
    r2.game.setWorld(world([A, B], [findSpot('s0x', AT, [A, B], o => o.deadlineMin === null && !o.fragile)]));
    place(r2, AT); r2.game.scan();
    const id = r2.game.view().orders[0].id;
    expect(r2.game.fumble!(id)).toEqual({ ok: true });
    expect(r2.game.view().player.score).toBe(50 - GESTURE.fumblePoints);
    expect(ofType(r2.events, 'fumble').at(-1)).toMatchObject({ points: GESTURE.fumblePoints });
    r2.game.pickup(id);
    expect(r2.game.fumble!(id)).toEqual({ ok: false, why: 'Colis introuvable.' }); // déjà dans le sac : rien à rater
  });
});

describe('surprises', () => {
  it('un colis sur trois en cache une, toujours la même pour le même colis', () => {
    const n = 4000, count: Record<string, number> = { chat: 0, bonus: 0, lore: 0, label: 0, rien: 0 };
    for (let i = 0; i < n; i++) count[surpriseFor(`colis-${i}`) ?? 'rien']++;
    expect(count.chat / n).toBeGreaterThan(0.03); expect(count.chat / n).toBeLessThan(0.07);
    expect(count.bonus / n).toBeGreaterThan(0.08); expect(count.lore / n).toBeGreaterThan(0.08); expect(count.label / n).toBeGreaterThan(0.04);
    expect(count.rien / n).toBeGreaterThan(0.62); expect(count.rien / n).toBeLessThan(0.72);
    expect(surpriseFor('colis-7')).toBe(surpriseFor('colis-7'));
    expect(SURPRISE.mult).toEqual({ chat: 1.15, bonus: 1.3, lore: 1, label: 1.6 });
    expect(LORE).toHaveLength(8); expect(loreFor('x').text).toBe(LORE[loreFor('x').index]);
  });
  async function deliver(kind: 'chat' | 'bonus' | 'lore' | 'label' | null, act: (g: Awaited<ReturnType<typeof rig>>['game'], id: string) => void = () => {}) {
    const want = (o: { fragile: boolean; deadlineMin: number | null }) => !o.fragile && o.deadlineMin === null;
    const s = kind ? findSurprise(kind, AT, [A, B], want) : findSpot('n', AT, [A, B], want);
    const cells = world([A, B], [s]);
    const t = when(x => quiet(cells, x));
    const r = await rig({ t });
    r.game.setWorld(cells); place(r, AT); r.game.scan();
    const before = r.game.view().orders[0];
    act(r.game, s.id);
    const heard = r.game.view().orders[0];
    r.game.pickup(s.id);
    const dest = before.destId === 'A' ? A : B;
    walk(r, dest.at, 1.3, i => { if (i % 5 === 0) r.game.steady(); });
    r.game.deliver(dest.id);
    return { before, heard, res: ofType(r.events, 'delivery')[0].result, reward: before.reward };
  }
  it('écouter révèle la surprise ; elle compte à la livraison même sans l’avoir écoutée', async () => {
    const plain = await deliver(null);
    expect(plain.before).toMatchObject({ surprise: null, labelHidden: false });
    expect(plain.res.surprise).toBeUndefined();
    const heard = await deliver('bonus', (g, id) => { g.inspect(id); });
    expect(heard.before.surprise).toBeNull();
    expect(heard.heard.surprise).toBe('bonus');
    expect(heard.res).toMatchObject({ surprise: 'bonus' });
    expect(heard.res.notes).toContain(SURPRISE_NOTE.bonus);
    const silent = await deliver('chat');
    expect(silent.heard.surprise).toBeNull();
    expect(silent.res.surprise).toBe('chat');
    expect(silent.res.notes).toContain('Chat clandestin');
    // Le multiplicateur s'applique aux points de la livraison.
    const base = (x: typeof heard) => x.res.points / (x.reward * (x.res.grade === 'S' ? 2 : x.res.grade === 'A' ? 1.5 : x.res.grade === 'B' ? 1.25 : 1));
    expect(base(heard)).toBeCloseTo(1.3, 1); expect(base(silent)).toBeCloseTo(1.15, 1);
  });
  it('message scellé : remis avec la livraison', async () => {
    const x = await deliver('lore');
    expect(x.res.surprise).toBe('lore');
    expect(x.res.lore).toMatchObject({ total: LORE.length });
    expect(LORE).toContain(x.res.lore!.text);
    expect(x.res.notes).toContain('Message scellé');
  });
  it('mauvaise étiquette : ne compte que si le joueur l’a trouvée pendant l’inspection', async () => {
    const missed = await deliver('label', (g, id) => { g.inspect(id); });
    expect(missed.before.labelHidden).toBe(true);
    expect(missed.heard.surprise).toBeNull(); // l'étiquette ne s'entend pas
    expect(missed.res.surprise).toBeUndefined();
    const found = await deliver('label', (g, id) => { expect(g.foundLabel!(id)).toEqual({ ok: true }); expect(g.foundLabel!(id)).toEqual({ ok: false, why: 'Rien de plus sur ce colis.' }); });
    expect(found.heard).toMatchObject({ surprise: 'label', labelHidden: false });
    expect(found.res).toMatchObject({ surprise: 'label' });
    expect(found.res.notes).toContain('Vraie adresse retrouvée');
    expect(found.res.points).toBeGreaterThan(missed.res.points * 1.4);
  });
  it('jamais dans un colis spécial', async () => {
    const s = findSpecial('ruche', AT, [A, B]);
    const r = await rig();
    r.game.setWorld(world([A, B], [s])); place(r, AT); r.game.scan();
    r.game.inspect(s.id);
    expect(r.game.view().orders[0]).toMatchObject({ surprise: null, labelHidden: false });
    expect(r.game.foundLabel!(s.id).ok).toBe(false);
  });
});
