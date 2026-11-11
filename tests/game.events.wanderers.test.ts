import { describe, expect, it } from 'vitest';
import { cell, cellCenter, dist } from '../src/core/geo';
import { cacheInCell } from '../src/game/caches';
import { WANDER } from '../src/game/rules';
import { dayKey } from '../src/game/time';
import { WANDER_NAMES, wanderGift, wanderLine, wanderSlot, wandererAt, wandererInCell, wanderersFor, whereText } from '../src/game/wanderers';
import type { CellContent } from '../src/world/types';
import { findSpecial, off, ofType, place, rig, spot, wait, world } from './game.helpers';
import { A, B, HOME, quiet, when } from './game.events.helpers';

/** Trois coins de rue de la case de l'abri A. */
const MID = cellCenter(cell(Number(HOME.split('/')[0]), Number(HOME.split('/')[1])));
const SPOTS = [spot('r1', off(-40, -40, MID)), spot('r2', off(40, -30, MID)), spot('r3', off(0, 50, MID))];
const CELLS = world([A, B], SPOTS);
const home = (cells: CellContent[] = CELLS): CellContent => cells.find(c => c.id === HOME)!;
const SLOT = WANDER.slotMs;

describe('rôdeurs : règles', () => {
  it('toutes les rues de la démo sont dans la même case', () => {
    expect(home().parcels.map(p => p.id).sort()).toEqual(['r1', 'r2', 'r3']);
  });
  it('rares, reproductibles par case et par tranche horaire, jamais sans tournée possible', () => {
    let n = 0;
    for (let s = 0; s < 4000; s++) {
      const w = wandererInCell(home(), s);
      expect(wandererInCell(home(), s)).toEqual(w);
      if (!w) continue;
      n++;
      expect(WANDER_NAMES).toContain(w.name);
      expect(w.path).toHaveLength(3);
      expect(w.lapS).toBeCloseTo(w.legs.reduce((a, b) => a + b, 0) / WANDER.speed + 3 * WANDER.pauseS);
    }
    expect(n / 4000).toBeGreaterThan(WANDER.chance * 0.7); expect(n / 4000).toBeLessThan(WANDER.chance * 1.3);
    expect(25 * WANDER.chance).toBeLessThan(1.5); // un secteur de 5 x 5 cases : un rôdeur environ
    for (let s = 0; s < 400; s++) expect(wandererInCell({ ...home(), parcels: SPOTS.slice(0, 1) }, s)).toBeNull();
    expect(wanderersFor(CELLS, 5 * SLOT + 1)).toEqual(wanderersFor(CELLS, 5 * SLOT + 999));
  });
  it('avance à vitesse de marche le long de sa tournée, s’arrête à chaque point, et ne dépend que de l’heure', () => {
    const slot = Array.from({ length: 4000 }, (_, i) => i).find(s => wandererInCell(home(), s))!;
    const w = wandererInCell(home(), slot)!, t0 = slot * SLOT;
    let paused = 0, walked = 0;
    const seen = new Set<number>();
    for (let s = 0; s < Math.ceil(w.lapS) + 5; s++) {
      const a = wandererAt(w, t0 + s * 1000), b = wandererAt(w, t0 + (s + 1) * 1000);
      expect(wandererAt(w, t0 + s * 1000)).toEqual(a); // même heure, même endroit pour tous les joueurs
      const step = dist(a.at, b.at);
      expect(step).toBeLessThanOrEqual(WANDER.speed + 0.05);
      if (a.moving) walked += step; else { paused++; seen.add(w.path.findIndex(p => dist(p, a.at) < 0.5)); }
      // Toujours sur un tronçon de sa tournée.
      const onLeg = w.path.some((p, i) => { const q = w.path[(i + 1) % 3]; return Math.abs(dist(p, a.at) + dist(a.at, q) - dist(p, q)) < 0.5; });
      expect(onLeg).toBe(true);
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
    expect(paused).toBeGreaterThanOrEqual(3 * WANDER.pauseS - 3);
    expect(walked).toBeGreaterThan(w.legs.reduce((x, y) => x + y, 0) * 0.95);
    // Un tour plus tard, il est revenu au même point.
    expect(dist(wandererAt(w, t0).at, wandererAt(w, t0 + w.lapS * 1000).at)).toBeLessThan(0.01);
  });
  it('cadeau : une information s’il y a quelque chose à signaler, sinon de quoi tenir', () => {
    expect(wanderGift(0.1, { cache: true, special: true })).toBe('cache');
    expect(wanderGift(0.1, { cache: false, special: true })).toBe('colis');
    expect(wanderGift(0.5, { cache: true, special: true })).toBe('colis');
    expect(wanderGift(0.5, { cache: true, special: false })).toBe('cache');
    expect(wanderGift(0.5, { cache: false, special: false })).toBe('endurance');
    expect(wanderGift(0.7, { cache: true, special: true })).toBe('endurance');
    expect(wanderGift(0.9, { cache: true, special: true })).toBe('xp');
    expect(whereText(off(0, 0), off(0, 120))).toBe('à 100 m au nord');
    expect(whereText(off(0, 0), off(-280, -280))).toBe('à 400 m au sud-ouest');
    expect(whereText(off(0, 0), off(42, 0))).toBe('à 40 m à l’est');
    expect(wanderLine('cache', 'à 100 m au nord')).toBe('« Il y a une cache à 100 m au nord. Je te la laisse. »');
  });
});

describe('rôdeurs : en jeu', () => {
  /** Un instant calme où un rôdeur parcourt la case, avec le tirage voulu. */
  const find = (cells: CellContent[], ok: (roll: number, t: number) => boolean, allow = {}) =>
    when(t => { const w = wandererInCell(home(cells), wanderSlot(t)); return !!w && ok(w.roll, t) && quiet(cells, t, { wanderer: true, ...allow }); }, SLOT);

  it('visible sur la carte, il faut s’approcher pour lui parler, une seule fois', async () => {
    const t = find(CELLS, roll => roll >= 0.6 && roll < 0.8);
    const r = await rig({ t }), g = r.game;
    g.setWorld(CELLS);
    place(r, off(-150, -150));
    const w = g.view().wanderers![0];
    expect(g.view().wanderers).toHaveLength(1);
    expect(w).toMatchObject({ met: false, inRange: false });
    expect(w.at).toEqual(wandererAt(wandererInCell(home(), wanderSlot(t))!, t).at);
    expect(g.talk(w.id)).toEqual({ ok: false, why: `Trop loin de ${w.name}.` });
    expect(g.talk('personne')).toEqual({ ok: false, why: 'Il est déjà reparti.' });

    // Il marche : une minute plus tard il n'est plus au même endroit (ou il fait une halte, pas plus de 25 s).
    wait(r, 60);
    expect(dist(g.view().wanderers![0].at, w.at)).toBeGreaterThan(5);

    // Endurance entamée, puis rencontre.
    const pose = g.view().wanderers![0].at;
    place(r, off(5, 5, pose));
    const s = await rig({ t: r.clock.t, save: { ...(await (async () => { await g.flush(); return r.store.peek()!; })()), stamina: 0.4 } });
    s.game.setWorld(CELLS); place(s, off(5, 5, pose));
    expect(s.game.view().wanderers![0].inRange).toBe(true);
    expect(s.game.talk(w.id)).toEqual({ ok: true });
    expect(ofType(s.events, 'wanderer')).toEqual([{ type: 'wanderer', id: w.id, name: w.name, line: wanderLine('endurance'), gift: 'endurance' }]);
    expect(s.game.view().player.stamina).toBeCloseTo(0.4 + WANDER.staminaGift, 2);
    expect(s.game.view().wanderers![0].met).toBe(true);
    expect(s.game.talk(w.id)).toEqual({ ok: false, why: `${w.name} t’a déjà donné ce qu’il avait.` });
    // La rencontre est sauvegardée.
    await s.game.flush();
    const s2 = await rig({ store: s.store, t: s.clock.t });
    s2.game.setWorld(CELLS); place(s2, off(5, 5, pose));
    expect(s2.game.view().wanderers![0].met).toBe(true);
    // À la tranche horaire suivante, il est reparti.
    const s3 = await rig({ store: s.store, t: (wanderSlot(t) + 1) * SLOT + 1000 });
    s3.game.setWorld(CELLS);
    expect(s3.game.view().wanderers!.every(x => x.id !== w.id)).toBe(true);
  });

  it('peut indiquer une cache : elle apparaît sur la carte sans scanner', async () => {
    const shelters = [A.at, B.at];
    const t = find(CELLS, (roll, x) => roll < 0.35 && cacheInCell(HOME, dayKey(x), shelters) !== null, { cache: true });
    const r = await rig({ t }), g = r.game;
    g.setWorld(CELLS);
    const w = g.view().wanderers![0];
    place(r, off(3, 3, w.at));
    expect(g.view().caches).toEqual([]);
    expect(g.talk(w.id)).toEqual({ ok: true });
    const cache = cacheInCell(HOME, dayKey(t), shelters)!;
    expect(g.view().caches!.map(c => c.id)).toEqual([cache.id]);
    const e = ofType(r.events, 'wanderer')[0];
    expect(e.gift).toBe('cache');
    expect(e.line).toBe(wanderLine('cache', whereText(off(3, 3, w.at), cache.at)));
  });

  it('peut indiquer un colis spécial : il est révélé et identifié', async () => {
    const sp = findSpecial('ruche', off(-90, 60, MID), [A, B]);
    const cells = world([A, B], [...SPOTS, sp]);
    expect(home(cells).parcels).toHaveLength(4);
    const t = find(cells, roll => roll >= 0.35 && roll < 0.6);
    const r = await rig({ t }), g = r.game;
    g.setWorld(cells);
    const w = g.view().wanderers![0];
    place(r, off(3, 3, w.at));
    expect(g.view().orders).toEqual([]);
    expect(g.talk(w.id)).toEqual({ ok: true });
    expect(ofType(r.events, 'wanderer')[0].gift).toBe('colis');
    expect(g.view().orders).toHaveLength(1);
    expect(g.view().orders[0]).toMatchObject({ id: sp.id, name: 'Ruche vivante', state: 'révélé', special: { known: true } });
  });

  it('sinon il encourage : un peu d’XP', async () => {
    const t = find(CELLS, roll => roll >= 0.8);
    const r = await rig({ t });
    r.game.setWorld(CELLS);
    const w = r.game.view().wanderers![0];
    place(r, off(3, 3, w.at));
    expect(r.game.talk(w.id)).toEqual({ ok: true });
    expect(ofType(r.events, 'wanderer')[0]).toMatchObject({ gift: 'xp', line: `« Bonne route, porteur. » +${WANDER.xpGift} XP` });
    expect(r.game.view().player.xp).toBe(WANDER.xpGift);
  });
});
