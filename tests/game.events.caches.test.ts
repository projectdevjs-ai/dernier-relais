import { describe, expect, it } from 'vitest';
import { type LngLat, cell, cellBounds, dist } from '../src/core/geo';
import { cacheInCell, cachesFor } from '../src/game/caches';
import { CACHE } from '../src/game/rules';
import { dayKey } from '../src/game/time';
import { off, ofType, place, rig, wait, walk, world } from './game.helpers';
import { A, B, DAY, HOME, quiet, when } from './game.events.helpers';

const CELLS = world([A, B], []);
const SHELTERS = [A.at, B.at];
/** Un jour calme où la case de l'abri A contient une cache. */
const T = when(t => quiet(CELLS, t, { cache: true }) && cacheInCell(HOME, dayKey(t), SHELTERS) !== null);
const CACHE_OF_DAY = cacheInCell(HOME, dayKey(T), SHELTERS)!;
/** Point à `m` mètres de la cache, vers l'ouest. */
const near = (m: number): LngLat => off(-m, 0, CACHE_OF_DAY.at);

describe('caches : règles', () => {
  it('une par case au plus, reproductible par case et par jour, à l’écart des abris', () => {
    let n = 0;
    for (let x = 0; x < 60; x++) for (let y = 0; y < 60; y++) {
      const id = `${32000 + x}/${22000 + y}`, c = cacheInCell(id, '2026-11-11', SHELTERS);
      expect(cacheInCell(id, '2026-11-11', SHELTERS)).toEqual(c);
      if (!c) continue;
      n++;
      const b = cellBounds(cell(32000 + x, 22000 + y));
      expect(c.at[0]).toBeGreaterThan(b.w); expect(c.at[0]).toBeLessThan(b.e);
      expect(c.at[1]).toBeGreaterThan(b.s); expect(c.at[1]).toBeLessThan(b.n);
      expect(c.points).toBeGreaterThanOrEqual(CACHE.points[0]); expect(c.points).toBeLessThanOrEqual(CACHE.points[1]);
      expect(c.points % 5).toBe(0);
      expect(c.xp).toBeGreaterThanOrEqual(CACHE.xp[0]); expect(c.xp).toBeLessThanOrEqual(CACHE.xp[1]);
    }
    expect(n / 3600).toBeGreaterThan(CACHE.chance * 0.7); expect(n / 3600).toBeLessThan(CACHE.chance * 1.3);
    // Un secteur de 5 x 5 cases : une ou deux caches, invisibles tant qu'on n'a pas scanné à côté.
    expect(25 * CACHE.chance).toBeLessThan(2);
    expect(cacheInCell('pas une case', '2026-11-11', [])).toBeNull();
  });
  it('change d’un jour à l’autre et reste à plus de 50 m des abris', () => {
    const days = Array.from({ length: 400 }, (_, i) => dayKey(T + i * DAY));
    const found = days.map(d => cacheInCell(HOME, d, SHELTERS)).filter(c => c !== null);
    expect(found.length).toBeGreaterThan(10);
    expect(new Set(found.map(c => c.at.join())).size).toBe(found.length);
    for (const c of found) for (const s of SHELTERS) expect(dist(c.at, s)).toBeGreaterThan(CACHE.clearM);
    expect(cachesFor(CELLS, dayKey(T)).map(c => c.id)).toEqual([CACHE_OF_DAY.id]);
  });
});

describe('caches : en jeu', () => {
  it('invisible de loin, repérée au scanner à courte portée, ouverte sur place, une fois par jour', async () => {
    const r = await rig({ t: T }), g = r.game;
    g.setWorld(CELLS);
    place(r, near(CACHE.scanM + 30));
    expect(g.view().caches).toEqual([]);
    g.scan();
    expect(g.view().caches).toEqual([]);
    expect(ofType(r.events, 'scan')).toEqual([{ type: 'scan', found: 0 }]);

    wait(r, 10);
    walk(r, near(CACHE.scanM - 10));
    g.scan();
    expect(ofType(r.events, 'scan').at(-1)).toEqual({ type: 'scan', found: 0, caches: 1 });
    expect(g.view().caches).toHaveLength(1);
    expect(g.view().caches![0]).toMatchObject({ id: CACHE_OF_DAY.id, at: CACHE_OF_DAY.at, inRange: false });
    expect(g.openCache(CACHE_OF_DAY.id)).toEqual({ ok: false, why: 'Trop loin de la cache.' });
    expect(g.openCache('inconnue')).toEqual({ ok: false, why: 'Cache introuvable.' });

    walk(r, near(CACHE.openM - 5));
    expect(g.view().caches![0].inRange).toBe(true);
    const before = g.view().player;
    expect(g.openCache(CACHE_OF_DAY.id)).toEqual({ ok: true });
    expect(ofType(r.events, 'cache')).toEqual([{ type: 'cache', cacheId: CACHE_OF_DAY.id, points: CACHE_OF_DAY.points, xp: CACHE_OF_DAY.xp, skillPoint: CACHE_OF_DAY.skillPoint }]);
    const after = g.view().player;
    expect(after.score).toBe(before.score + CACHE_OF_DAY.points);
    expect(after.xp + (after.level - before.level) * 1000).toBeGreaterThan(before.xp);
    expect(g.view().caches).toEqual([]);
    expect(g.openCache(CACHE_OF_DAY.id)).toEqual({ ok: false, why: 'Cache introuvable.' });
    // Un nouveau balayage ne la retrouve pas.
    wait(r, 10); g.scan();
    expect(ofType(r.events, 'scan').at(-1)).toEqual({ type: 'scan', found: 0 });

    // Rechargée le même jour : toujours ouverte.
    await g.flush();
    const r2 = await rig({ store: r.store, t: r.clock.t });
    r2.game.setWorld(CELLS); place(r2, near(10)); r2.game.scan();
    expect(r2.game.view().caches).toEqual([]);
  });

  it('une cache repérée mais pas ouverte survit au rechargement, pas au changement de jour', async () => {
    const r = await rig({ t: T });
    r.game.setWorld(CELLS); place(r, near(40)); r.game.scan();
    expect(r.game.view().caches).toHaveLength(1);
    await r.game.flush();
    expect(r.store.peek()!.cachesFound).toEqual([CACHE_OF_DAY.id]);
    const r2 = await rig({ store: r.store, t: T + 60000 });
    r2.game.setWorld(CELLS); place(r2, near(40));
    expect(r2.game.view().caches).toHaveLength(1);
    const r3 = await rig({ store: r.store, t: T + DAY });
    r3.game.setWorld(CELLS); place(r3, near(40));
    expect(r3.game.view().caches).toEqual([]);
  });

  it('certaines caches donnent un point de compétence', async () => {
    const t = when(x => quiet(CELLS, x, { cache: true }) && cacheInCell(HOME, dayKey(x), SHELTERS)?.skillPoint === true);
    const c = cacheInCell(HOME, dayKey(t), SHELTERS)!;
    const r = await rig({ t });
    r.game.setWorld(CELLS); place(r, off(-10, 0, c.at)); r.game.scan();
    const before = r.game.view().player.skillPoints;
    expect(r.game.openCache(c.id)).toEqual({ ok: true });
    expect(r.game.view().player.skillPoints).toBeGreaterThanOrEqual(before + 1);
    expect(ofType(r.events, 'cache')[0].skillPoint).toBe(true);
  });
});
