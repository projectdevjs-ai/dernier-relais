import { describe, expect, it } from 'vitest';
import { type LngLat, cellAt, cellsAround, dist } from '../src/core/geo';
import { RANGE } from '../src/game/api';
import { drawContracts } from '../src/game/contracts';
import { dangerInCell, dangersFor } from '../src/game/dangers';
import { Game } from '../src/game/game';
import { LINES } from '../src/game/npc';
import { addXp } from '../src/game/progress';
import { GRADE_MULT } from '../src/game/rules';
import { type GameSave, MemoryGameStore, emptyGameSave } from '../src/game/save';
import { npcFor, unlockText } from '../src/game/shelters';
import { dayKey, weekKey } from '../src/game/time';
import type { CellContent } from '../src/world/types';
import { BASE, T0, findSpot, off, ofType, place, quietSky, rig, shelter, spot, wait, walk, world } from './game.helpers';

const DAY = 86400000;
const A = shelter('A', off(0, 0), 'École des Tilleuls'), B = shelter('B', off(300, 0), 'Pharmacie du Port');
const START = off(120, 0);
const SPOTS = [spot('p1', off(40, 20)), spot('p2', off(80, -30)), spot('p3', off(260, 30)), spot('p4', off(200, -40))];
const SMALL = world([A, B], SPOTS);
/** Un jour sans zone dangereuse dans ces cases (et, au besoin, avec un contrat du jour donné). */
function calmT(cells: CellContent[], kind?: string): number {
  for (let t = T0; t < T0 + 400 * DAY; t += DAY) {
    if (dangersFor(cells, dayKey(t)).length) continue;
    if (!quietSky(cells, t)) continue; // ni front de mauvais temps
    if (kind && !drawContracts('jour', dayKey(t)).some(c => c.kind === kind)) continue;
    return t;
  }
  throw new Error('aucun jour calme');
}
const save = (over: Partial<GameSave>, t = T0): GameSave => ({ ...emptyGameSave(dayKey(t)), ...over });
/** Monde d'un seul colis, posé aux pieds du joueur, à livrer à l'abri B. */
async function oneParcel(want: Parameters<typeof findSpot>[3], opts: { save?: Partial<GameSave>; at?: LngLat } = {}) {
  const at = opts.at ?? off(20, 0);
  const s = findSpot('u', at, [A, B], want);
  const cells = world([A, B], [s]);
  const t = calmT(cells);
  const r = await rig({ t, save: opts.save ? save(opts.save, t) : null });
  r.game.setWorld(cells);
  place(r, at);
  expect(r.game.scan()).toEqual({ ok: true });
  return { r, id: s.id, cells };
}
const plain = (o: { fragile: boolean; deadlineMin: number | null; weightKg: number }) => !o.fragile && o.deadlineMin === null && o.weightKg <= 6;

describe('boucle complète', () => {
  it('scanner, ramasser, livrer : points, étoile, XP, contrat, sauvegarde et rechargement', async () => {
    const t = calmT(SMALL, 'livrer');
    const r = await rig({ t });
    const g = r.game;
    g.setWorld(SMALL);
    place(r, START);

    // Les colis sont invisibles tant qu'ils n'ont pas été scannés.
    expect(g.view().orders).toEqual([]);
    expect(g.view().shelters.map(s => s.line)).toEqual(['…', '…']);
    expect(g.scan()).toEqual({ ok: true });
    expect(ofType(r.events, 'scan')).toEqual([{ type: 'scan', found: 4 }]);
    const found = g.view().orders;
    expect(found.map(o => o.id).sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(found.every(o => o.state === 'révélé' && o.condition === 1)).toBe(true);
    // Jamais l'abri le plus proche du colis.
    expect(Object.fromEntries(found.map(o => [o.id, o.destId]))).toEqual({ p1: 'B', p2: 'B', p3: 'A', p4: 'A' });

    let score = 0, prog = { level: 1, xp: 0 }, levels = 0;
    for (const id of ['p1', 'p2', 'p3', 'p4']) {
      const o = g.view().orders.find(x => x.id === id)!;
      expect(g.pickup(id)).toEqual(o.inRange ? { ok: true } : { ok: false, why: 'Trop loin du colis.' });
      if (!o.inRange) { walk(r, o.at); expect(g.pickup(id)).toEqual({ ok: true }); }
      const carried = g.view().orders[0];
      expect(carried).toMatchObject({ id, state: 'porté', inRange: false });
      expect(g.view().player.carriedKg).toBe(o.weightKg);
      expect(g.deliver(o.destId)).toEqual({ ok: false, why: 'Trop loin de l’abri.' });
      walk(r, o.destAt, 1.3, i => { if (i % 5 === 0) g.steady(); });
      const sh = g.view().shelters.find(s => s.id === o.destId)!;
      expect(sh).toMatchObject({ inRange: true, deliverable: [id] });
      const reward = g.view().orders[0].reward;
      expect(g.deliver(o.destId)).toEqual({ ok: true });
      const res = ofType(r.events, 'delivery').at(-1)!.result;
      expect(res).toMatchObject({ orderId: id, orderName: o.name, shelterId: o.destId, shelterName: sh.name, npc: npcFor(o.destId), condition: 1, grade: 'S', starsBefore: sh.stars });
      expect(res.points).toBe(Math.round(reward * GRADE_MULT[res.grade]));
      expect(res.notes[0]).toBe('État 100 %');
      expect(res.xp).toBe(Math.round(15 + res.points * 0.5));
      score += res.points;
      const p = addXp(prog, res.xp);
      expect(res.levelUp).toBe(p.gained > 0);
      prog = p; levels += p.gained;
    }

    const v = g.view();
    expect(v.orders).toEqual([]);
    expect(v.player).toMatchObject({ score, deliveries: 4, level: prog.level, xp: prog.xp, skillPoints: levels, carriedKg: 0 });
    expect(levels).toBeGreaterThanOrEqual(1);
    expect(ofType(r.events, 'levelUp').map(e => e.level)).toEqual(Array.from({ length: levels }, (_, i) => i + 2));
    expect(v.player.distanceKm).toBeGreaterThan(0.5); expect(v.player.distanceKm).toBeLessThan(1.6);

    // Étoiles : la première livraison donne la première étoile et dévoile le PNJ.
    const first = ofType(r.events, 'delivery')[0].result;
    expect(first).toMatchObject({ starsBefore: 0, shelterId: 'B' });
    expect(first.starsAfter).toBeGreaterThanOrEqual(1);
    expect(first.unlock).toContain(unlockText(1)!);
    for (const s of v.shelters) {
      expect(s.stars).toBeGreaterThanOrEqual(1);
      expect(s.points).toBeGreaterThan(0);
      expect(s.line).not.toBe('…');
      expect(Object.values(LINES[s.npc]).flat()).toContain(s.line);
    }
    expect(v.shelters.reduce((n, s) => n + s.points, 0)).toBe(score);

    // Contrat du jour « Livrer N colis » : suivi tout seul, puis récompense.
    const c = v.contracts.find(x => x.label.startsWith('Livrer') && x.period === 'jour' && /^Livrer \d colis$/.test(x.label))!;
    expect(c).toMatchObject({ progress: c.goal, done: true, claimed: false });
    expect(ofType(r.events, 'contract').map(e => e.contract.id)).toContain(c.id);
    expect(g.claim(c.id)).toEqual({ ok: true });
    expect(g.claim(c.id)).toEqual({ ok: false, why: 'Récompense déjà prise.' });
    expect(g.view().player.score).toBe(score + c.reward);
    expect(g.view().contracts.find(x => x.id === c.id)!.claimed).toBe(true);
    expect(v.visited).toContain(cellAt(START[0], START[1]).id);

    // Sauvegarde puis rechargement dans une partie neuve.
    await g.flush();
    const r2 = await rig({ store: r.store, t: r.clock.t });
    r2.game.setWorld(SMALL);
    const a = g.view(), b = r2.game.view();
    expect({ ...b.player, at: null, headingDeg: 0, speedMps: 0, moving: false, mode: 'gps', balance: 0, stamina: 0 })
      .toEqual({ ...a.player, at: null, headingDeg: 0, speedMps: 0, moving: false, mode: 'gps', balance: 0, stamina: 0 });
    expect(b.player.stamina).toBeCloseTo(a.player.stamina, 5);
    expect(b.contracts).toEqual(a.contracts);
    expect(b.skills).toEqual(a.skills);
    expect([...b.visited].sort()).toEqual([...a.visited].sort());
    expect(b.shelters.map(s => [s.id, s.stars, s.points]).sort()).toEqual(a.shelters.map(s => [s.id, s.stars, s.points]).sort());
    // Un colis livré aujourd'hui ne réapparaît pas.
    place(r2, START);
    expect(r2.game.scan()).toEqual({ ok: true });
    expect(ofType(r2.events, 'scan')).toEqual([{ type: 'scan', found: 0 }]);
    expect(r2.game.view().orders).toEqual([]);
  });

  it('donne les mêmes commandes à deux joueurs', async () => {
    const r1 = await rig(), r2 = await rig();
    for (const r of [r1, r2]) { r.game.setWorld(SMALL); place(r, START); r.game.scan(); }
    expect(r1.game.view().orders).toEqual(r2.game.view().orders);
    expect(r1.game.view().dangers).toEqual(r2.game.view().dangers);
    expect(r1.game.view().contracts).toEqual(r2.game.view().contracts);
  });
});

describe('scanner', () => {
  it('ne révèle que les colis à portée et se recharge en 8 s', async () => {
    const r = await rig();
    r.game.setWorld(SMALL);
    expect(r.game.scan()).toEqual({ ok: false, why: 'Position inconnue.' });
    place(r, off(-100, 0)); // p1 à 141 m, p2 à 182 m
    expect(r.game.view().scanner).toEqual({ ready: true, cooldownLeftS: 0, cooldownS: 8, rangeM: RANGE.scan });
    r.game.scan();
    expect(r.game.view().orders.map(o => o.id)).toEqual(['p1']);
    expect(r.game.scan()).toEqual({ ok: false, why: 'Le scanner se recharge.' });
    r.game.tick(7.5);
    expect(r.game.view().scanner).toMatchObject({ ready: false, cooldownLeftS: 0.5 });
    r.game.tick(0.5);
    expect(r.game.view().scanner.ready).toBe(true);
    // Les colis révélés le restent, même loin et après un rechargement du monde.
    place(r, off(-900, 0));
    r.game.setWorld(SMALL);
    expect(r.game.scan()).toEqual({ ok: true });
    expect(ofType(r.events, 'scan').map(e => e.found)).toEqual([1, 0]);
    expect(r.game.view().orders.map(o => o.id)).toEqual(['p1']);
  });
  it('porte plus loin et se recharge plus vite avec les compétences', async () => {
    const r = await rig({ save: save({ skills: { 'scan-portee': 2, 'scan-recharge': 3 } }) });
    r.game.setWorld(SMALL);
    place(r, off(-100, 0));
    expect(r.game.view().scanner).toMatchObject({ rangeM: 240, cooldownS: 5 });
    r.game.scan();
    expect(r.game.view().orders.map(o => o.id)).toEqual(['p1', 'p2']);
    r.game.tick(5);
    expect(r.game.view().scanner.ready).toBe(true);
  });
  it('porte 40 m plus loin autour d’un abri à 4 étoiles', async () => {
    const r = await rig({ save: save({ shelters: { B: { points: 1000, deliveries: 9 } } }) });
    r.game.setWorld(SMALL);
    place(r, off(300, 20));
    expect(r.game.view().scanner.rangeM).toBe(200);
    place(r, off(-100, 0));
    expect(r.game.view().scanner.rangeM).toBe(160);
  });
});

describe('ramassage et sac', () => {
  it('refuse hors de portée, les colis inconnus et ceux déjà portés', async () => {
    const r = await rig();
    r.game.setWorld(SMALL);
    place(r, START);
    expect(r.game.pickup('p1')).toEqual({ ok: false, why: 'Colis introuvable.' }); // pas encore scanné
    r.game.scan();
    expect(r.game.pickup('rien')).toEqual({ ok: false, why: 'Colis introuvable.' });
    expect(r.game.pickup('p1')).toEqual({ ok: false, why: 'Trop loin du colis.' });
    place(r, off(40 + 25, 20));
    expect(r.game.view().orders.find(o => o.id === 'p1')!.inRange).toBe(true);
    expect(r.game.pickup('p1')).toEqual({ ok: true });
    expect(ofType(r.events, 'pickup')[0].order).toMatchObject({ id: 'p1', state: 'porté' });
    expect(r.game.pickup('p1')).toEqual({ ok: false, why: 'Ce colis est déjà dans le sac.' });
  });
  it('limite le poids à 20 kg, davantage avec la compétence', async () => {
    const at = off(20, 0);
    const heavy = [0, 1, 2].map(i => findSpot('h', at, [A, B], o => o.weightKg >= 8, i));
    const r = await rig({ save: save({ skillPoints: 1 }) });
    r.game.setWorld(world([A, B], heavy));
    place(r, at);
    r.game.scan();
    const kg = Object.fromEntries(r.game.view().orders.map(o => [o.id, o.weightKg]));
    expect(r.game.view().player.capacityKg).toBe(20);
    expect(r.game.pickup(heavy[0].id).ok).toBe(true);
    expect(r.game.pickup(heavy[1].id).ok).toBe(true);
    expect(r.game.pickup(heavy[2].id)).toEqual({ ok: false, why: 'Sac trop lourd : pose d’abord un colis.' });
    expect(r.game.view().player.carriedKg).toBe(kg[heavy[0].id] + kg[heavy[1].id]);
    expect(r.game.learn('sac')).toEqual({ ok: true });
    expect(r.game.view().player.capacityKg).toBe(25);
    expect(r.game.pickup(heavy[2].id).ok).toBe(kg[heavy[0].id] + kg[heavy[1].id] + kg[heavy[2].id] <= 25);
  });
  it('repose un colis à l’endroit du joueur, sans le dupliquer ni relancer son délai', async () => {
    const { r, id, cells } = await oneParcel(o => o.deadlineMin !== null && o.deadlineMin >= 8);
    const deadline = r.game.view().orders[0].minutesLeft!;
    expect(r.game.drop(id)).toEqual({ ok: false, why: 'Ce colis n’est pas dans le sac.' });
    r.game.pickup(id);
    walk(r, off(20, 120));
    const here = r.game.view().player.at!;
    expect(r.game.drop(id)).toEqual({ ok: true });
    expect(ofType(r.events, 'drop')).toEqual([{ type: 'drop', orderId: id }]);
    r.game.setWorld(cells);
    const v = r.game.view();
    expect(v.orders).toHaveLength(1);
    expect(v.orders[0]).toMatchObject({ id, state: 'révélé', at: here, distanceM: 0, inRange: true });
    expect(v.player.carriedKg).toBe(0);
    wait(r, 60);
    expect(r.game.pickup(id)).toEqual({ ok: true });
    const left = r.game.view().orders[0].minutesLeft!;
    expect(left).toBeLessThan(deadline - 1);
    expect(left).toBeGreaterThan(deadline - 5);
  });
});

describe('déplacement', () => {
  it('déduit vitesse, cap et distance des positions successives', async () => {
    const r = await rig();
    place(r, BASE);
    expect(r.game.view().player).toMatchObject({ at: BASE, speedMps: 0, moving: false, mode: 'gps', distanceKm: 0 });
    walk(r, off(200, 0));
    let p = r.game.view().player;
    expect(p.speedMps).toBeGreaterThan(1.1); expect(p.speedMps).toBeLessThan(1.5);
    expect(p.moving).toBe(true);
    expect(p.headingDeg).toBeGreaterThan(85); expect(p.headingDeg).toBeLessThan(95);
    expect(p.distanceKm).toBeGreaterThan(0.18); expect(p.distanceKm).toBeLessThanOrEqual(0.21);
    walk(r, off(200, -100));
    p = r.game.view().player;
    expect(p.headingDeg).toBeGreaterThan(175); expect(p.headingDeg).toBeLessThan(185);
    wait(r, 7);
    expect(r.game.view().player).toMatchObject({ speedMps: 0, moving: false });
  });
  it('ignore les sauts de position : ni distance, ni vitesse', async () => {
    const r = await rig();
    place(r, BASE);
    r.clock.t += 1000;
    place(r, off(5000, 0));
    expect(r.game.view().player).toMatchObject({ distanceKm: 0, speedMps: 0, moving: false });
    r.game.setPosition({ lng: Number.NaN, lat: 0, acc: null, source: 'simulé' });
    expect(r.game.view().player.at).toEqual(off(5000, 0));
    walk(r, off(5100, 0));
    const p = r.game.view().player;
    expect(p.distanceKm).toBeGreaterThan(0.09); expect(p.distanceKm).toBeLessThanOrEqual(0.11);
    r.game.setPosition({ lng: BASE[0], lat: BASE[1], acc: null, source: 'simulé' });
    expect(r.game.view().player).toMatchObject({ mode: 'simulé', speedMps: 0 });
    expect(r.game.view().player.distanceKm).toBe(p.distanceKm);
  });
  it('ne compte pas le tremblement du GPS à l’arrêt', async () => {
    const r = await rig();
    place(r, BASE);
    for (let i = 0; i < 120; i++) { r.clock.t += 1000; place(r, off(i % 2 ? 1.5 : -1, i % 3 ? 1 : -1)); r.game.tick(1); }
    expect(r.game.view().player).toMatchObject({ distanceKm: 0, moving: false });
  });
  it('retient les cases parcourues (brume d’exploration)', async () => {
    const r = await rig();
    place(r, BASE);
    walk(r, off(900, 0), 20);
    const visited = r.game.view().visited;
    expect(visited.length).toBeGreaterThanOrEqual(3);
    expect(new Set(visited).size).toBe(visited.length);
    expect(visited).toContain(cellAt(BASE[0], BASE[1]).id);
    await r.game.flush();
    expect((await rig({ store: r.store, t: r.clock.t })).game.view().visited).toEqual(visited);
  });
});

describe('portage', () => {
  it('abîme lentement les colis sous la pluie, plus vite les fragiles', async () => {
    const at = off(20, 0);
    const solid = findSpot('s', at, [A, B], o => !o.fragile && o.crate === 'bois'), fragile = findSpot('f', at, [A, B], o => o.fragile && o.crate === 'bois');
    const cells = world([A, B], [solid, fragile]);
    const r = await rig({ t: calmT(cells) });
    r.game.setWorld(cells); place(r, at); r.game.scan();
    r.game.pickup(solid.id); r.game.pickup(fragile.id);
    wait(r, 300);
    expect(r.game.view().orders.every(o => o.condition === 1)).toBe(true);
    r.game.setWeather({ kind: 'pluie', windKmh: 10, tempC: 8, night: false, sunAltDeg: 20 });
    expect(r.game.view().weather.kind).toBe('pluie');
    wait(r, 600);
    const c = Object.fromEntries(r.game.view().orders.map(o => [o.id, o.condition]));
    expect(c[solid.id]).toBeCloseTo(0.96, 3);
    expect(c[fragile.id]).toBeCloseTo(0.92, 3);
  });
  it('reste léger : ignorer l’équilibre coûte un peu d’état, s’en occuper n’en coûte pas', async () => {
    const at = off(20, 0);
    const load = [findSpot('a', at, [A, B], o => o.weightKg === 12 && !o.fragile), findSpot('b', at, [A, B], o => o.weightKg >= 7 && o.weightKg <= 8 && !o.fragile)];
    const cells = world([A, B], load);
    const run = async (care: boolean) => {
      const r = await rig({ t: calmT(cells) });
      r.game.setWorld(cells); place(r, at); r.game.scan();
      for (const s of load) expect(r.game.pickup(s.id).ok).toBe(true);
      let maxTilt = 0;
      // Le joueur soigneux recentre la charge dès qu'il la voit pencher.
      walk(r, off(20, 1170), 1.3, () => { const b = Math.abs(r.game.view().player.balance); maxTilt = Math.max(maxTilt, b); if (care && b > 0.4) r.game.steady(); });
      return { r, maxTilt, worst: Math.min(...r.game.view().orders.map(o => o.condition)) };
    };
    const lazy = await run(false), careful = await run(true);
    expect(lazy.maxTilt).toBeGreaterThan(0.6); expect(lazy.maxTilt).toBeLessThanOrEqual(1);
    expect(lazy.worst).toBeLessThan(1);
    expect(lazy.worst).toBeGreaterThan(0.85); // 15 minutes sans jamais recentrer : la note reste correcte
    expect(careful.maxTilt).toBeLessThan(0.6);
    expect(careful.worst).toBe(1);
    // L'endurance est tombée à 0 en route : rien n'est bloqué pour autant.
    expect(lazy.r.game.view().player.stamina).toBe(0);
    expect(lazy.r.game.drop(load[0].id)).toEqual({ ok: true });
    expect(lazy.r.game.pickup(load[0].id)).toEqual({ ok: true });
    lazy.r.game.steady();
    expect(lazy.r.game.view().player.balance).toBe(0);
  });
  it('abîme un colis fragile quand le joueur court, pas un colis solide', async () => {
    const at = off(20, 0);
    const solid = findSpot('s', at, [A, B], o => !o.fragile && o.weightKg <= 4), fragile = findSpot('f', at, [A, B], o => o.fragile && o.weightKg <= 4);
    const cells = world([A, B], [solid, fragile]);
    const r = await rig({ t: calmT(cells) });
    r.game.setWorld(cells); place(r, at); r.game.scan();
    r.game.pickup(solid.id); r.game.pickup(fragile.id);
    walk(r, off(20, 600), 4);
    expect(r.game.view().player.speedMps).toBeGreaterThan(2.5);
    const c = Object.fromEntries(r.game.view().orders.map(o => [o.id, o.condition]));
    expect(c[solid.id]).toBe(1);
    expect(c[fragile.id]).toBeLessThan(0.97); expect(c[fragile.id]).toBeGreaterThan(0.9);
  });
  it('fait baisser l’endurance en marchant chargé, et remonter à l’arrêt', async () => {
    const { r, id } = await oneParcel(o => o.weightKg >= 10 && !o.fragile);
    walk(r, off(20, 150));
    const empty = 1 - r.game.view().player.stamina;
    expect(empty).toBeGreaterThan(0);
    walk(r, off(20, 0));
    r.game.pickup(id);
    const before = r.game.view().player.stamina;
    walk(r, off(20, 150));
    const loaded = before - r.game.view().player.stamina;
    expect(loaded).toBeGreaterThan(empty * 1.8);
    const tired = r.game.view().player.stamina;
    wait(r, 12);
    expect(r.game.view().player.stamina).toBeGreaterThan(tired + 0.1);
    wait(r, 120);
    expect(r.game.view().player.stamina).toBe(1);
  });
  it('rend l’endurance plus vite dans un abri, et encore plus à 3 étoiles', async () => {
    const gain = async (at: LngLat) => {
      const r = await rig({ save: save({ stamina: 0.1, shelters: { B: { points: 600, deliveries: 6 } } }) });
      r.game.setWorld(SMALL); place(r, at);
      wait(r, 5);
      return r.game.view().player.stamina - 0.1;
    };
    const outside = await gain(START), inA = await gain(off(5, 5)), inB = await gain(off(305, 5));
    expect(outside).toBeCloseTo(0.1, 5); expect(inA).toBeCloseTo(0.2, 5); expect(inB).toBeCloseTo(0.4, 5);
  });
});

describe('livraison', () => {
  it('refuse sans abri, trop loin, ou sans colis pour cet abri', async () => {
    const { r, id } = await oneParcel(plain);
    expect(r.game.deliver('nulle-part')).toEqual({ ok: false, why: 'Abri introuvable.' });
    expect(r.game.deliver('A')).toEqual({ ok: false, why: 'Aucun colis pour cet abri.' });
    r.game.pickup(id);
    expect(r.game.deliver('A')).toEqual({ ok: false, why: 'Aucun colis pour cet abri.' });
    expect(r.game.deliver('B')).toEqual({ ok: false, why: 'Trop loin de l’abri.' });
    expect(ofType(r.events, 'delivery')).toEqual([]);
  });
  it('livre d’un coup tous les colis destinés à l’abri, un résultat par colis', async () => {
    const at = off(20, 0);
    const spots = [0, 1, 2].map(i => findSpot('m', at, [A, B], plain, i));
    const cells = world([A, B], spots);
    const r = await rig({ t: calmT(cells) });
    r.game.setWorld(cells); place(r, at); r.game.scan();
    for (const s of spots) expect(r.game.pickup(s.id).ok).toBe(true);
    expect(r.game.view().orders.every(o => o.state === 'porté' && o.destId === 'B')).toBe(true);
    walk(r, off(290, 0), 1.3, i => { if (i % 5 === 0) r.game.steady(); });
    expect(r.game.view().shelters[0]).toMatchObject({ id: 'B', inRange: true });
    expect(r.game.view().shelters[0].deliverable.sort()).toEqual(spots.map(s => s.id).sort());
    expect(r.game.deliver('B')).toEqual({ ok: true });
    const res = ofType(r.events, 'delivery').map(e => e.result);
    expect(res.map(x => x.orderId).sort()).toEqual(spots.map(s => s.id).sort());
    expect(res[0].starsBefore).toBe(0);
    expect(res[1].starsBefore).toBe(res[0].starsAfter);
    const v = r.game.view();
    expect(v.orders).toEqual([]);
    expect(v.player.deliveries).toBe(3);
    expect(v.player.score).toBe(res.reduce((n, x) => n + x.points, 0));
    expect(v.shelters[0].points).toBe(v.player.score);
  });
  it('note le retard : délai compté depuis le ramassage, alerte, note plus basse', async () => {
    const { r, id } = await oneParcel(o => o.deadlineMin !== null && !o.fragile, { save: { shelters: { B: { points: 20, deliveries: 1 } } } });
    const deadline = r.game.view().orders[0].minutesLeft!;
    expect(deadline).toBeGreaterThanOrEqual(8);
    wait(r, 120);
    expect(r.game.view().orders[0].minutesLeft).toBe(deadline); // pas encore ramassé : le délai n'a pas démarré
    r.game.pickup(id);
    wait(r, 60);
    expect(r.game.view().orders[0].minutesLeft).toBe(deadline - 1);
    expect(LINES[npcFor('B')].attente).toContain(r.game.view().shelters.find(s => s.id === 'B')!.line);
    wait(r, deadline * 60 + 180);
    expect(r.game.view().orders[0].minutesLeft).toBe(-4);
    expect(ofType(r.events, 'toast').filter(e => e.text.startsWith('Délai dépassé')).map(e => e.tone)).toEqual(['warn']);
    expect(LINES[npcFor('B')].retard).toContain(r.game.view().shelters.find(s => s.id === 'B')!.line);
    walk(r, off(295, 0), 1.3, i => { if (i % 5 === 0) r.game.steady(); });
    r.game.deliver('B');
    const res = ofType(r.events, 'delivery')[0].result;
    expect(res.onTime).toBe(false);
    expect(res.condition).toBe(1);
    expect(res.notes.some(n => /^En retard de \d+ min$/.test(n))).toBe(true);
    expect(['B', 'C', 'D']).toContain(res.grade);
    expect(LINES[npcFor('B')].retard).toContain(r.game.view().shelters.find(s => s.id === 'B')!.line);
  });
  it('récompense une livraison dans les temps, sous la pluie et de nuit', async () => {
    const { r, id } = await oneParcel(o => o.deadlineMin !== null && !o.fragile && o.crate === 'alu');
    r.game.setWeather({ kind: 'pluie', windKmh: 0, tempC: 6, night: true, sunAltDeg: -20 });
    r.game.pickup(id);
    walk(r, off(295, 0), 1.3, i => { if (i % 5 === 0) r.game.steady(); });
    r.game.deliver('B');
    const res = ofType(r.events, 'delivery')[0].result;
    expect(res.onTime).toBe(true);
    expect(res.condition).toBeLessThan(1); expect(res.condition).toBeGreaterThan(0.98);
    expect(res.notes).toEqual([`État ${Math.round(res.condition * 100)} %`, 'Dans les temps', 'Sous la pluie', 'De nuit']);
    expect(res.grade).toBe('S');
  });
  it('fait réagir le PNJ à un colis abîmé', async () => {
    const s = findSpot('x', off(20, 0), [A, B], plain);
    const o = { id: s.id, cell: s.cell, name: 'Outils', rareName: null, crate: 'bois' as const, weightKg: 5, fragile: false, at: s.at, destId: 'B', destName: B.name, destAt: B.at, deadlineMin: null, baseReward: 60, state: 'porté' as const, condition: 0.3, pickedAt: T0 };
    const r = await rig({ save: save({ orders: [o], shelters: { B: { points: 20, deliveries: 1 } } }) });
    r.game.setWorld(world([A, B], [s]));
    place(r, off(295, 0));
    const lines = LINES[npcFor('B')];
    expect(lines.abîmé).toContain(r.game.view().shelters[0].line);
    r.game.deliver('B');
    const res = ofType(r.events, 'delivery')[0].result;
    expect(res).toMatchObject({ grade: 'E', condition: 0.3, points: 30, starsBefore: 1, starsAfter: 1, unlock: null });
    expect(lines.abîmé).toContain(r.game.view().shelters[0].line);
    wait(r, 130);
    expect(lines.accueil).toContain(r.game.view().shelters[0].line);
  });
});

describe('étoiles des abris', () => {
  it('gagne une étoile au seuil et annonce ce qu’elle débloque', async () => {
    const { r, id } = await oneParcel(plain, { save: { shelters: { B: { points: 290, deliveries: 3 } } } });
    const before = r.game.view().shelters.find(s => s.id === 'B')!;
    expect(before).toMatchObject({ stars: 1, points: 290, nextStarAt: 300, nextUnlock: unlockText(2) });
    const reward1 = r.game.view().orders[0].reward;
    r.game.pickup(id);
    walk(r, off(295, 0), 1.3, i => { if (i % 5 === 0) r.game.steady(); });
    r.game.deliver('B');
    const res = ofType(r.events, 'delivery')[0].result;
    expect(res).toMatchObject({ starsBefore: 1, starsAfter: 2, unlock: 'Commandes de cet abri mieux payées (+15 %)' });
    const after = r.game.view().shelters.find(s => s.id === 'B')!;
    expect(after).toMatchObject({ stars: 2, nextStarAt: 600, nextUnlock: unlockText(3) });
    expect(LINES[after.npc].étoile).toContain(after.line);
    expect(reward1).toBeGreaterThan(0);
  });
  it('paie mieux les commandes d’un abri à 2 étoiles', async () => {
    const one = await oneParcel(plain, { save: { shelters: { B: { points: 100, deliveries: 2 } } } });
    const two = await oneParcel(plain, { save: { shelters: { B: { points: 300, deliveries: 4 } } } });
    const r1 = one.r.game.view().orders[0].reward, r2 = two.r.game.view().orders[0].reward;
    expect(r2).toBeGreaterThan(r1);
    expect(r2 / r1).toBeGreaterThan(1.05); expect(r2 / r1).toBeLessThan(1.25);
  });
  it('propose des commandes rares à 5 étoiles, et n’a plus d’étoile à gagner', async () => {
    const rare = (o: { rareName: string | null; fragile: boolean; deadlineMin: number | null }) => o.rareName !== null && !o.fragile && o.deadlineMin === null;
    const four = await oneParcel(rare, { save: { shelters: { B: { points: 1400, deliveries: 12 } } } });
    const five = await oneParcel(rare, { save: { shelters: { B: { points: 1500, deliveries: 12 } } } });
    const o4 = four.r.game.view().orders[0], o5 = five.r.game.view().orders[0];
    expect(o5.name).not.toBe(o4.name);
    expect(o5.reward).toBeGreaterThan(o4.reward * 1.8);
    const sh = five.r.game.view().shelters.find(s => s.id === 'B')!;
    expect(sh).toMatchObject({ stars: 5, nextStarAt: null, nextUnlock: null });
    expect(LINES[sh.npc].cinq).toContain(sh.line);
    five.r.game.pickup(five.id);
    walk(five.r, off(295, 0), 1.3, i => { if (i % 5 === 0) five.r.game.steady(); });
    five.r.game.deliver('B');
    expect(ofType(five.r.events, 'delivery')[0].result).toMatchObject({ orderName: o5.name, starsBefore: 5, starsAfter: 5, unlock: null, points: o5.reward * 2 });
  });
  it('annonce la découverte d’un abri une seule fois', async () => {
    const r = await rig();
    r.game.setWorld(SMALL);
    place(r, off(100, 0));
    expect(ofType(r.events, 'toast')).toEqual([]);
    place(r, off(10, 0)); place(r, off(100, 0)); place(r, off(12, 0));
    expect(ofType(r.events, 'toast').map(e => e.text)).toEqual(['Abri découvert : École des Tilleuls']);
    expect(r.game.snapshot().discovered).toEqual(['A']);
  });
});

describe('compétences', () => {
  it('s’achètent avec les points gagnés, selon les prérequis, et se sauvegardent', async () => {
    const r = await rig({ save: save({ skillPoints: 3, level: 4 }) });
    expect(r.game.learn('rien')).toEqual({ ok: false, why: 'Compétence inconnue.' });
    expect(r.game.learn('sangles').ok).toBe(false);
    expect(r.game.view().skills).toHaveLength(12);
    expect(r.game.view().skills.find(s => s.id === 'calage')!.available).toBe(false);
    expect(r.game.learn('sac')).toEqual({ ok: true });
    expect(r.game.view().skills.find(s => s.id === 'sac')).toMatchObject({ rank: 1, available: true });
    expect(r.game.view().skills.find(s => s.id === 'calage')!.available).toBe(true);
    expect(r.game.learn('relais')).toEqual({ ok: true }); // coûte 2 points
    expect(r.game.view().player.skillPoints).toBe(0);
    expect(r.game.learn('sac')).toEqual({ ok: false, why: 'Pas assez de points de compétence.' });
    expect(r.game.view().skills.every(s => !s.available)).toBe(true);
    await r.game.flush();
    const r2 = await rig({ store: r.store });
    expect(r2.game.view().player).toMatchObject({ skillPoints: 0, capacityKg: 25, level: 4 });
    expect(r2.game.view().skills.find(s => s.id === 'relais')!.rank).toBe(1);
  });
  it('« Voix du réseau » et « Carnet de route » augmentent points et XP', async () => {
    const base = await oneParcel(plain), boosted = await oneParcel(plain, { save: { skills: { relais: 3, carnet: 3 } } });
    const res = [base, boosted].map(x => {
      x.r.game.pickup(x.id);
      walk(x.r, off(295, 0), 1.3, i => { if (i % 5 === 0) x.r.game.steady(); });
      x.r.game.deliver('B');
      return ofType(x.r.events, 'delivery')[0].result;
    });
    expect(res[1].points).toBe(Math.round(res[0].points * 1.3));
    expect(res[1].xp).toBe(Math.round((15 + res[1].points * 0.5) * 1.3));
  });
});

describe('contrats', () => {
  it('refuse une récompense non gagnée ou inconnue', async () => {
    const r = await rig();
    const c = r.game.view().contracts;
    expect(c.filter(x => x.period === 'jour')).toHaveLength(3);
    expect(c.filter(x => x.period === 'semaine')).toHaveLength(2);
    expect(c.every(x => x.progress === 0 && !x.done && !x.claimed)).toBe(true);
    expect(r.game.claim(c[0].id)).toEqual({ ok: false, why: 'Contrat pas encore rempli.' });
    expect(r.game.claim('rien')).toEqual({ ok: false, why: 'Contrat introuvable.' });
  });
  it('suit la marche et la découverte d’abris, puis donne points et XP', async () => {
    // Un jour dont les contrats comprennent « Marcher 1 km ».
    let t = T0;
    while (!drawContracts('jour', dayKey(t)).some(c => c.kind === 'marcher' && c.goal === 1)) t += DAY;
    const r = await rig({ t });
    place(r, BASE);
    walk(r, off(0, 650), 2);
    const id = r.game.view().contracts.find(c => c.label === 'Marcher 1 km')!.id;
    expect(r.game.view().contracts.find(c => c.id === id)).toMatchObject({ progress: 0.6, goal: 1, done: false });
    expect(ofType(r.events, 'contract')).toEqual([]);
    walk(r, off(0, 1200), 2);
    const c = r.game.view().contracts.find(x => x.id === id)!;
    expect(c).toMatchObject({ progress: 1, done: true });
    expect(ofType(r.events, 'contract').filter(e => e.contract.id === id)).toHaveLength(1);
    expect(r.game.claim(id)).toEqual({ ok: true });
    expect(r.game.view().player).toMatchObject({ score: c.reward, xp: Math.round(c.reward / 2), level: 1 });
    expect(ofType(r.events, 'toast').at(-1)).toMatchObject({ tone: 'good', text: `Contrat rempli : +${c.reward} points` });
  });
  it('compte les abris découverts', async () => {
    let t = T0;
    while (!drawContracts('jour', dayKey(t)).some(c => c.kind === 'abris')) t += DAY;
    const r = await rig({ t });
    r.game.setWorld(SMALL);
    place(r, off(5, 0)); place(r, off(150, 0)); place(r, off(5, 0)); place(r, off(300, 5));
    const c = r.game.view().contracts.find(x => x.label.startsWith('Découvrir') && x.period === 'jour')!;
    expect(c.progress).toBe(Math.min(2, c.goal));
  });
  it('repart de zéro au changement de jour, et de semaine', async () => {
    let t = T0;
    while (!drawContracts('jour', dayKey(t)).some(c => c.kind === 'marcher') || !drawContracts('semaine', weekKey(t)).some(c => c.kind === 'marcher') || new Date(t).getUTCDay() !== 2) t += DAY;
    const r = await rig({ t });
    place(r, BASE);
    walk(r, off(0, 400), 2);
    const before = r.game.view().contracts;
    const dayWalk = before.find(c => c.period === 'jour' && c.label.startsWith('Marcher'))!, weekWalk = before.find(c => c.period === 'semaine' && c.label.startsWith('Marcher'))!;
    expect(dayWalk.progress).toBeGreaterThan(0); expect(weekWalk.progress).toBeGreaterThan(0);
    await r.game.flush();
    // Le lendemain : contrats du jour neufs, contrats de la semaine conservés.
    r.clock.t += DAY; r.game.tick(1);
    const next = r.game.view().contracts;
    expect(next.filter(c => c.period === 'jour').map(c => c.id)).toEqual(drawContracts('jour', dayKey(r.clock.t)).map(c => c.id));
    expect(next.filter(c => c.period === 'jour').every(c => c.progress === 0 && !c.claimed)).toBe(true);
    expect(next.find(c => c.id === weekWalk.id)).toEqual(weekWalk);
    // Même chose en rouvrant le jeu le lendemain.
    const r2 = await rig({ store: new MemoryGameStore(r.store.peek()), t });
    expect(r2.game.view().contracts).toEqual(before);
    const r3 = await rig({ store: r.store, t: t + DAY });
    expect(r3.game.view().contracts).toEqual(next);
    // La semaine suivante : tout est neuf.
    r.clock.t += 7 * DAY; r.game.tick(1);
    const later = r.game.view().contracts;
    expect(later.map(c => c.id)).toEqual([...drawContracts('jour', dayKey(r.clock.t)), ...drawContracts('semaine', weekKey(r.clock.t))].map(c => c.id));
    expect(later.every(c => c.progress === 0)).toBe(true);
    expect(later.some(c => c.id === weekWalk.id)).toBe(false);
  });
});

describe('zones dangereuses', () => {
  it('préviennent à l’entrée et à la sortie, et abîment les colis portés', async () => {
    const home = cellAt(BASE[0], BASE[1]);
    const zoneCell = cellsAround(home, 4).map(c => c.id).find(id => dangerInCell(id, dayKey(T0), []))!;
    const zone = dangerInCell(zoneCell, dayKey(T0), [])!;
    const S1 = shelter('S1', off(-260, 0, zone.at)), S2 = shelter('S2', off(-260, 200, zone.at));
    const edge = off(-(zone.radiusM + 20), 0, zone.at);
    const s = findSpot('z', edge, [S1, S2], o => !o.fragile && o.weightKg <= 5);
    const r = await rig();
    r.game.setWorld(world([S1, S2], [s], [zoneCell]));
    place(r, edge);
    const z = r.game.view().dangers.find(d => d.id === zone.id)!;
    expect(z).toEqual({ ...zone, inside: false });
    for (const sh of [S1, S2]) expect(dist(sh.at, z.at)).toBeGreaterThan(z.radiusM + 60);
    r.game.scan(); expect(r.game.pickup(s.id).ok).toBe(true);
    expect(ofType(r.events, 'danger')).toEqual([]);
    walk(r, zone.at);
    expect(ofType(r.events, 'danger')).toEqual([{ type: 'danger', entered: true }]);
    expect(r.game.view().dangers.find(d => d.id === zone.id)!.inside).toBe(true);
    const c0 = r.game.view().orders[0].condition;
    wait(r, 60);
    expect(c0 - r.game.view().orders[0].condition).toBeCloseTo(0.03, 3);
    walk(r, off(zone.radiusM + 30, 0, zone.at));
    expect(ofType(r.events, 'danger')).toEqual([{ type: 'danger', entered: true }, { type: 'danger', entered: false }]);
    expect(r.game.view().dangers.every(d => !d.inside)).toBe(true);
    const c1 = r.game.view().orders[0].condition;
    wait(r, 60);
    expect(r.game.view().orders[0].condition).toBe(c1);
  });
});

describe('vue', () => {
  it('met les colis portés d’abord, trie par distance, et garde les distances à jour', async () => {
    const r = await rig();
    r.game.setWorld(SMALL);
    place(r, off(180, -20));
    r.game.scan();
    expect(r.game.pickup('p4').ok).toBe(true);
    let v = r.game.view();
    expect(v.orders.map(o => o.state)).toEqual(['porté', 'révélé', 'révélé', 'révélé']);
    expect(v.orders[0]).toMatchObject({ id: 'p4', destId: 'A', destName: 'École des Tilleuls', destAt: A.at });
    expect(v.orders[0].distanceM).toBeCloseTo(dist(off(180, -20), A.at), 3); // colis porté : distance à l'abri destinataire
    const rest = v.orders.slice(1).map(o => o.distanceM);
    expect(rest).toEqual([...rest].sort((a, b) => a - b));
    expect(v.orders[1].distanceM).toBeCloseTo(dist(off(180, -20), v.orders[1].at), 3);
    expect(v.shelters.map(s => s.id)).toEqual(['B', 'A']);
    expect(v.shelters[0]).toMatchObject({ kind: 'mairie', at: B.at, stars: 0, points: 0, nextStarAt: 100, nextUnlock: unlockText(1), inRange: false, deliverable: [], line: '…' });
    expect(v.shelters[1].deliverable).toEqual(['p4']);
    expect(v.loadedCells.sort()).toEqual(SMALL.map(c => c.id).sort());
    place(r, off(30, 0));
    v = r.game.view();
    expect(v.shelters.map(s => s.id)).toEqual(['A', 'B']);
    expect(v.shelters[0]).toMatchObject({ inRange: true });
    expect(v.shelters[0].distanceM).toBeCloseTo(30, 0);
    expect(v.player).toMatchObject({ level: 1, xp: 0, xpNext: 100, stamina: 1, capacityKg: 20, balance: 0 });
  });
  it('fonctionne avant toute position et sans monde', async () => {
    const r = await rig();
    const v = r.game.view();
    expect(v).toMatchObject({ orders: [], shelters: [], dangers: [], visited: [], loadedCells: [] });
    expect(v.player.at).toBeNull();
    expect(v.weather).toMatchObject({ kind: 'clair', night: false });
    r.game.tick(1); r.game.tick(0); r.game.steady();
    r.game.setWorld(SMALL);
    expect(r.game.view().shelters).toHaveLength(2);
    expect(r.game.view().shelters.every(s => !s.inRange)).toBe(true);
  });
  it('reste peu coûteuse', async () => {
    const r = await rig();
    const spots = Array.from({ length: 75 }, (_, i) => spot(`q${i}`, off((i % 10) * 12, Math.floor(i / 10) * 12)));
    r.game.setWorld(world([A, B], spots));
    place(r, off(50, 40));
    r.game.scan();
    expect(r.game.view().orders).toHaveLength(75);
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) r.game.view();
    expect((performance.now() - t0) / 200).toBeLessThan(5); // millisecondes par appel, marge large pour une machine chargée
    expect(r.game.view().skills).toBe(r.game.view().skills);
    expect(r.game.view().contracts).toBe(r.game.view().contracts);
  });
});

describe('événements', () => {
  it('permet de se désabonner et survit à un abonné qui plante', async () => {
    const r = await rig();
    let n = 0;
    r.game.on(() => { throw new Error('affichage cassé'); });
    const stop = r.game.on(() => { n++; });
    r.game.setWorld(SMALL); place(r, START);
    expect(r.game.scan()).toEqual({ ok: true });
    expect(n).toBe(1);
    stop();
    r.game.tick(8); r.game.scan();
    expect(n).toBe(1);
    expect(ofType(r.events, 'scan')).toHaveLength(2);
  });
});

describe('jour et sauvegarde', () => {
  it('au changement de jour, garde les colis portés et oublie les autres', async () => {
    const r = await rig();
    r.game.setWorld(SMALL); place(r, off(180, -20)); r.game.scan();
    r.game.pickup('p4');
    await r.game.flush();
    expect(r.store.peek()!.orders.map(o => [o.id, o.state]).sort()).toEqual([['p1', 'révélé'], ['p2', 'révélé'], ['p3', 'révélé'], ['p4', 'porté']]);
    // Rouvrir le jeu le lendemain.
    const r2 = await rig({ store: new MemoryGameStore(r.store.peek()), t: T0 + DAY });
    expect(r2.game.view().orders.map(o => [o.id, o.state])).toEqual([['p4', 'porté']]);
    // Laisser le jeu ouvert jusqu'au lendemain : le monde renvoie de nouveaux emplacements.
    r.clock.t = T0 + DAY; r.game.tick(1);
    expect(r.game.view().orders.map(o => [o.id, o.state])).toEqual([['p4', 'porté']]);
    r.game.setWorld(world([A, B], [spot('n1', off(210, -20))]));
    wait(r, 8); r.game.scan();
    expect(r.game.view().orders.map(o => o.id)).toEqual(['p4', 'n1']);
  });
  it('ne fait pas réapparaître un colis ramassé ou livré le même jour', async () => {
    const { r, id, cells } = await oneParcel(plain);
    r.game.pickup(id);
    r.game.setWorld(cells);
    expect(r.game.view().orders).toHaveLength(1);
    walk(r, off(295, 0));
    r.game.deliver('B');
    r.game.setWorld(cells);
    place(r, off(20, 0)); wait(r, 8);
    r.game.scan();
    expect(r.game.view().orders).toEqual([]);
    expect(r.game.snapshot().done).toEqual([id]);
  });
  it('écrit à chaque événement important, et sinon pas plus d’une fois toutes les 2 s', async () => {
    const r = await rig();
    r.game.setWorld(SMALL);
    place(r, off(120, 300));
    await r.game.flush();
    const w0 = r.store.writes;
    walk(r, off(120, 90), 1.3); // 162 s de marche, sans événement important
    await r.game.flush();
    const auto = r.store.writes - w0;
    expect(auto).toBeGreaterThan(20); expect(auto).toBeLessThanOrEqual(162 / 2 + 1);
    // À l'arrêt, endurance pleine : plus rien à écrire.
    wait(r, 120);
    await r.game.flush();
    const w1 = r.store.writes;
    wait(r, 30);
    await Promise.resolve();
    expect(r.store.writes).toBe(w1);
    // Un événement important est écrit tout de suite.
    r.game.scan();
    await new Promise(res => setTimeout(res, 0));
    expect(r.store.writes).toBe(w1 + 1);
    expect(r.store.peek()!.orders.length).toBeGreaterThan(0);
  });
  it('continue sans sauvegarde quand le stockage est en panne', async () => {
    const broken = { load: async () => { throw new Error('panne'); }, save: async () => { throw new Error('panne'); } };
    const g = new Game({ store: broken });
    await g.load();
    g.setWorld(SMALL);
    g.setPosition({ lng: START[0], lat: START[1], acc: 5, source: 'gps' });
    expect(g.scan()).toEqual({ ok: true });
    await expect(g.flush()).resolves.toBeUndefined();
    expect(g.view().orders).toHaveLength(4);
  });
});
