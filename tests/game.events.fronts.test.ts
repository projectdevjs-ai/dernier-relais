import { describe, expect, it } from 'vitest';
import { type LngLat, cellAt, dist } from '../src/core/geo';
import { dangersFor } from '../src/game/dangers';
import { type FrontPath, frontAt, frontEta, frontPath, frontSlot, frontsFor, insideFront, zoneOf, zonesOf } from '../src/game/fronts';
import { gradeDelivery } from '../src/game/grade';
import { FRONT, GRADE_BONUS, WEAR } from '../src/game/rules';
import { dayKey } from '../src/game/time';
import { T0, findSpot, off, ofType, place, rig, shelter, wait, walk, world } from './game.helpers';

const ZONE = zoneOf(cellAt(-1.5761, 47.1822).id)!;
const SLOT = FRONT.slotMs;
const paths = (n: number): FrontPath[] => {
  const out: FrontPath[] = [];
  for (let s = frontSlot(T0); out.length < n; s++) { const p = frontPath(ZONE, s); if (p) out.push(p); }
  return out;
};
/** Point du trajet, à la fraction k (0 = entrée, 1 = sortie). */
const on = (p: FrontPath, k: number): LngLat => [p.from[0] + (p.to[0] - p.from[0]) * k, p.from[1] + (p.to[1] - p.from[1]) * k];

describe('fronts : règles', () => {
  it('zones de 4 x 4 cases', () => {
    expect(zoneOf('32472/22940')).toBe('8118/5735');
    expect(zoneOf('32475/22943')).toBe('8118/5735');
    expect(zoneOf('32476/22943')).toBe('8119/5735');
    expect(zoneOf('x')).toBeNull();
    expect(zonesOf(['32472/22940', '32475/22943', '32476/22943', 'x']).sort()).toEqual(['8118/5735', '8119/5735']);
  });
  it('rares, reproductibles par zone et par heure, larges et lents', () => {
    let n = 0;
    for (let s = 0; s < 3000; s++) {
      const p = frontPath(ZONE, s);
      expect(frontPath(ZONE, s)).toEqual(p);
      if (!p) continue;
      n++;
      expect(p.radiusM).toBeGreaterThanOrEqual(FRONT.minR); expect(p.radiusM).toBeLessThanOrEqual(FRONT.maxR);
      expect(Math.abs(dist(p.from, p.to) - FRONT.travelM)).toBeLessThan(FRONT.travelM * 0.01);
      expect(p.speedMps).toBeCloseTo(FRONT.travelM / 3600);
      expect(p.speedMps).toBeLessThan(1); // plus lent qu'un marcheur : on peut le contourner ou le semer
      expect(p.endMs - p.startMs).toBe(SLOT);
    }
    expect(n / 3000).toBeGreaterThan(FRONT.chance * 0.8); expect(n / 3000).toBeLessThan(FRONT.chance * 1.2);
    expect(frontPath('pas une zone', 3)).toBeNull();
  });
  it('avance en ligne droite, grossit en arrivant, se dissipe en partant, disparaît hors de son heure', () => {
    for (const p of paths(5)) {
      expect(frontAt(p, p.startMs - 1)).toBeNull();
      expect(frontAt(p, p.endMs)).toBeNull();
      const mid = frontAt(p, p.startMs + SLOT / 2)!;
      expect(mid.radiusM).toBe(p.radiusM);
      expect(dist(mid.at, on(p, 0.5))).toBeLessThan(1);
      expect(frontAt(p, p.startMs + 1000)!.radiusM).toBeLessThan(p.radiusM * 0.02);
      expect(frontAt(p, p.startMs + FRONT.fadeS * 500)!.radiusM).toBeCloseTo(p.radiusM / 2, 0);
      expect(frontAt(p, p.endMs - FRONT.fadeS * 500)!.radiusM).toBeCloseTo(p.radiusM / 2, 0);
      const a = frontAt(p, p.startMs + 20 * 60000)!, b = frontAt(p, p.startMs + 21 * 60000)!;
      expect(dist(a.at, b.at)).toBeCloseTo(p.speedMps * 60, 0);
      expect(frontsFor([ZONE], p.startMs + SLOT / 2).map(f => f.front)).toEqual([mid]);
      expect(frontsFor([ZONE], p.startMs + SLOT / 2)[0].path).toEqual(p);
    }
  });
  it('heure d’arrivée sur un point immobile', () => {
    for (const p of paths(5)) {
      const t = p.startMs + 15 * 60000, ahead = on(p, 0.5), behind = on(p, 0.05);
      const eta = frontEta(p, t, ahead)!;
      // Le centre est à 0,25 x trajet du point ; le bord arrive un rayon plus tôt.
      expect(eta).toBeCloseTo((0.25 * FRONT.travelM - p.radiusM) / p.speedMps, -1);
      expect(insideFront(frontAt(p, t + (eta - 5) * 1000)!, ahead)).toBe(false);
      expect(insideFront(frontAt(p, t + (eta + 5) * 1000)!, ahead)).toBe(true);
      expect(frontEta(p, t, behind)).toBeNull(); // déjà passé
      expect(frontEta(p, t, on(p, 0.25))).toBe(0); // dedans
      // Loin sur le côté : il passe à côté.
      const a = (p.headingDeg * Math.PI) / 180;
      expect(frontEta(p, t, off(Math.cos(a) * 400, -Math.sin(a) * 400, ahead))).toBeNull();
      expect(frontEta(p, p.startMs - 5, ahead)).toBeNull();
    }
  });
  it('compte comme l’orage dans la note, sans se cumuler avec la pluie', () => {
    const base = { condition: 0.9, deadlineMin: null, elapsedMin: 0, night: false } as const;
    const dry = gradeDelivery({ ...base, weather: 'clair' });
    const front = gradeDelivery({ ...base, weather: 'clair', front: true });
    const storm = gradeDelivery({ ...base, weather: 'orage', front: true });
    expect(front.score).toBe(dry.score + GRADE_BONUS.wet);
    expect(front.notes).toEqual(['État 90 %', 'À travers le front']);
    expect(storm.score).toBe(front.score);
    expect(storm.notes).toEqual(['État 90 %', 'Sous l’orage']);
  });
});

describe('fronts : en jeu', () => {
  /** Un front qui passe sur un quartier sans zone dangereuse : abri A au milieu de son trajet, abri B à 300 m. */
  function scene() {
    for (let s = frontSlot(T0); s < frontSlot(T0) + 5000; s++) {
      const p = frontPath(ZONE, s);
      if (!p) continue;
      const mid = on(p, 0.5), A = shelter('A', mid, 'Abri du milieu'), B = shelter('B', off(300, 0, mid), 'Abri voisin');
      const at = off(20, 0, mid);
      if (zonesOf([A.cell, B.cell, cellAt(at[0], at[1]).id]).length !== 1) continue;
      const sp = findSpot('f', at, [A, B], o => !o.fragile && o.deadlineMin === null && o.weightKg <= 6 && o.crate === 'bois');
      const cells = world([A, B], [sp]);
      if (dangersFor(cells, dayKey(p.startMs)).length) continue;
      return { p, A, B, at, sp, cells };
    }
    throw new Error('aucun front utilisable');
  }

  it('visible de loin, annoncé, puis entrée, usure comme sous l’orage, sortie, et bonus de note', async () => {
    const { p, B, at, sp, cells } = scene();
    // 12 minutes après son apparition : le bord est encore à plusieurs minutes de l'abri A.
    const r = await rig({ t: p.startMs + 12 * 60000 }), g = r.game;
    g.setWorld(cells);
    place(r, at);
    g.setWeather({ kind: 'clair', windKmh: 0, tempC: 15, night: false, sunAltDeg: 40 });
    wait(r, 1);
    const f = g.view().fronts![0];
    expect(g.view().fronts).toHaveLength(1);
    expect(f).toMatchObject({ id: p.id, radiusM: p.radiusM, inside: false, speedMps: p.speedMps });
    expect(f.distanceM).toBeGreaterThan(300);
    expect(f.etaS!).toBeGreaterThan(FRONT.warnS);
    expect(ofType(r.events, 'front')).toEqual([]);
    g.scan(); g.pickup(sp.id);

    // On l'attend sur place.
    const eta = Math.round(f.etaS!);
    wait(r, eta - FRONT.warnS + 5);
    const warn = ofType(r.events, 'front');
    expect(warn).toHaveLength(1);
    expect(warn[0].phase).toBe('approche');
    expect(warn[0].etaS!).toBeGreaterThan(FRONT.warnS - 10); expect(warn[0].etaS!).toBeLessThanOrEqual(FRONT.warnS);
    expect(g.view().orders[0].condition).toBe(1);
    wait(r, FRONT.warnS);
    expect(ofType(r.events, 'front').map(e => e.phase)).toEqual(['approche', 'entrée']);
    expect(g.view().fronts![0]).toMatchObject({ inside: true, distanceM: 0, etaS: 0 });

    // Dedans : le colis en bois s'use au rythme de l'orage, par temps clair.
    const c0 = g.view().orders[0].condition;
    wait(r, 60);
    expect(c0 - g.view().orders[0].condition).toBeCloseTo(WEAR.storm, 4);

    // Il passe : environ deux rayons à sa vitesse.
    wait(r, Math.ceil((2 * p.radiusM) / p.speedMps));
    expect(ofType(r.events, 'front').map(e => e.phase)).toEqual(['approche', 'entrée', 'sortie']);
    const c1 = g.view().orders[0].condition;
    wait(r, 60);
    expect(g.view().orders[0].condition).toBe(c1);
    expect(g.view().fronts![0].etaS).toBeNull();

    walk(r, B.at, 1.3, i => { if (i % 5 === 0) g.steady(); });
    g.deliver('B');
    const res = ofType(r.events, 'delivery')[0].result;
    expect(res.notes).toEqual([`État ${Math.round(res.condition * 100)} %`, 'À travers le front']);
    // Une heure après, plus rien.
    wait(r, 3600);
    expect(g.view().fronts!.every(x => x.id !== p.id)).toBe(true);
  });

  it('on peut l’éviter : à côté de son trajet, ni alerte, ni usure, ni bonus', async () => {
    const { p, A, sp, cells } = scene();
    const a = (p.headingDeg * Math.PI) / 180;
    const aside = off(Math.cos(a) * (p.radiusM + 60), -Math.sin(a) * (p.radiusM + 60), A.at);
    const r = await rig({ t: p.startMs + 12 * 60000 }), g = r.game;
    g.setWorld(cells);
    place(r, sp.at); g.scan(); g.pickup(sp.id);
    place(r, aside);
    wait(r, 40 * 60);
    expect(ofType(r.events, 'front')).toEqual([]);
    expect(g.view().orders[0].condition).toBe(1);
    await g.flush();
    expect(r.store.peek()!.orders[0].front).toBeUndefined();
  });

  it('un colis qui l’a traversé garde son bonus après rechargement', async () => {
    const { p, at, sp, cells } = scene();
    const r = await rig({ t: p.startMs + 30 * 60000 }), g = r.game; // le front est sur l'abri A
    g.setWorld(cells); place(r, at); g.scan(); g.pickup(sp.id);
    wait(r, FRONT.creditS - 3);
    await g.flush();
    expect(r.store.peek()!.orders[0].front).toBeUndefined();
    wait(r, 5);
    await g.flush();
    expect(r.store.peek()!.orders[0].front).toBe(true);
  });
});
