// Cas limites du moteur : changement de jour, sauvegardes abîmées, GPS capricieux, véhicule, sac plein, abri disparu, horloge modifiée.
import { describe, expect, it } from 'vitest';
import { type LngLat, dist } from '../src/core/geo';
import { dangersFor } from '../src/game/dangers';
import { NEWBIE, SCAN_ECHO_M, SPEED, VEHICLE } from '../src/game/rules';
import { type GameSave, MemoryGameStore, emptyGameSave, parseGameSave } from '../src/game/save';
import { dayKey } from '../src/game/time';
import type { CellContent } from '../src/world/types';
import { BASE, type Rig, T0, findSpot, off, ofType, place, quietSky, rig, shelter, spot, wait, walk, world } from './game.helpers';

const DAY = 86400000;
const A = shelter('A', off(0, 0), 'École des Tilleuls'), B = shelter('B', off(300, 0), 'Pharmacie du Port');
const plain = (o: { fragile: boolean; deadlineMin: number | null; weightKg: number; destId: string }) => !o.fragile && o.deadlineMin === null && o.weightKg <= 6 && o.destId === 'B';
function calmT(cells: CellContent[], from = T0): number {
  for (let t = from; t < from + 400 * DAY; t += DAY) if (!dangersFor(cells, dayKey(t)).length && !dangersFor(cells, dayKey(t + DAY)).length && quietSky(cells, t)) return t;
  throw new Error('aucun jour calme');
}
/** Hasard reproductible pour le bruit du GPS. */
function noise(seed: number): () => number { let a = seed; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296 * 2 - 1; }; }
const fix = (r: Rig, at: LngLat, acc: number): void => r.game.setPosition({ lng: at[0], lat: at[1], acc, source: 'gps' });
const toasts = (r: Rig): string[] => ofType(r.events, 'toast').map(e => e.text);

describe('changement de jour et de semaine en pleine partie', () => {
  it('garde les colis portés, retire les colis seulement révélés, renouvelle les contrats, et la livraison reste possible', async () => {
    const s1 = findSpot('j', off(20, 0), [A, B], plain), s2 = findSpot('k', off(60, 0), [A, B], plain);
    const cells = world([A, B], [s1, s2]);
    // Dimanche 15 novembre 2026, 23 h 58 en temps universel : minuit change le jour ET la semaine.
    const t = Date.UTC(2026, 10, 15, 23, 58, 0);
    const r = await rig({ t });
    r.game.setWorld(cells); place(r, off(20, 0));
    r.game.scan();
    expect(r.game.view().orders.map(o => o.id).sort()).toEqual([s1.id, s2.id].sort());
    expect(r.game.pickup(s1.id)).toEqual({ ok: true });
    const before = r.game.view().contracts.map(c => c.id);
    wait(r, 180);
    const v = r.game.view();
    expect(v.orders.map(o => [o.id, o.state])).toEqual([[s1.id, 'porté']]);
    const after = v.contracts.map(c => c.id);
    expect(after.filter(id => before.includes(id))).toEqual([]);
    expect(after.filter(id => id.startsWith('j:2026-11-16'))).toHaveLength(3);
    expect(after.filter(id => id.startsWith('s:2026-11-16'))).toHaveLength(2);
    walk(r, off(295, 0), 1.3, i => { if (i % 5 === 0) r.game.steady(); });
    expect(r.game.deliver('B')).toEqual({ ok: true });
    expect(ofType(r.events, 'delivery')).toHaveLength(1);
    // La sauvegarde relue le lendemain garde le sac vide et le nouveau jour.
    await r.game.flush();
    expect(r.store.peek()).toMatchObject({ day: '2026-11-16', deliveries: 1, orders: [] });
  });
  it('un colis porté la veille est encore dans le sac au rechargement du lendemain', async () => {
    const s1 = findSpot('j', off(20, 0), [A, B], plain);
    const cells = world([A, B], [s1]);
    const r = await rig({ t: calmT(cells) });
    r.game.setWorld(cells); place(r, off(20, 0)); r.game.scan(); r.game.pickup(s1.id);
    await r.game.flush();
    const next = await rig({ store: r.store, t: r.clock.t + DAY });
    next.game.setWorld(world([A, B], []));
    place(next, off(295, 0));
    expect(next.game.view().orders).toMatchObject([{ id: s1.id, state: 'porté' }]);
    expect(next.game.deliver('B')).toEqual({ ok: true });
  });
});

describe('sauvegarde corrompue ou ancienne', () => {
  it('une sauvegarde illisible ou d’une autre version donne une partie neuve, sans erreur', async () => {
    for (const bad of [null, 42, 'texte', [], { version: 0 }, { version: 2, level: 9 }, { level: 5 }]) expect(parseGameSave(bad)).toBeNull();
    const r = await rig({ store: new MemoryGameStore({ version: 7 } as unknown as GameSave) });
    expect(r.game.view().player).toMatchObject({ level: 1, score: 0, deliveries: 0 });
  });
  it('des champs abîmés sont corrigés un par un, et le jeu tourne', async () => {
    const broken = {
      version: 1, level: 'neuf', xp: -50, skillPoints: NaN, score: null, deliveries: 2.7, distanceM: 'loin', stamina: 9,
      skills: { sac: 99, inconnue: 3 }, shelters: { B: { points: 'x', deliveries: -3 }, C: 12 }, discovered: 'A', visited: [1, '2/3', null],
      day: 20261111, orders: [null, 7, { id: 'o1' }, { id: 'o2', name: 'Savon', destId: 'B', at: [1, 'a'], destAt: B.at, state: 'porté' },
        { id: 'ok', name: 'Savon', destId: 'B', destName: 'Pharmacie du Port', at: off(20, 0), destAt: B.at, state: 'porté', weightKg: 'lourd', condition: 4, crate: 'or' }],
      done: {}, contracts: [3, { id: 'j:x:livrer', progress: 'beaucoup', claimed: 'oui' }], last: [1], jams: 'non', relays: [1, 2],
    };
    const r = await rig({ store: new MemoryGameStore(broken as unknown as GameSave) });
    r.game.setWorld(world([A, B], []));
    place(r, off(295, 0));
    for (let i = 0; i < 5; i++) { r.clock.t += 1000; r.game.tick(1); }
    const v = r.game.view();
    expect(v.player).toMatchObject({ level: 1, score: 0, deliveries: 2, stamina: 1, skillPoints: 0, capacityKg: 40 });
    expect(Number.isFinite(v.player.xp)).toBe(true); expect(v.player.xp).toBeGreaterThanOrEqual(0);
    expect(v.orders).toMatchObject([{ id: 'ok', state: 'porté', weightKg: 1, condition: 1, crate: 'carton' }]);
    expect(r.game.deliver('B')).toEqual({ ok: true });
    expect(Number.isFinite(r.game.view().player.score)).toBe(true);
  });
  it('une sauvegarde d’avant les systèmes secondaires (sans révision) se charge telle quelle', async () => {
    const old: Record<string, unknown> = { ...emptyGameSave(dayKey(T0)), level: 4, score: 1200, deliveries: 9, shelters: { A: { points: 320, deliveries: 4 } } };
    for (const k of ['rev', 'cachesFound', 'cachesOpened', 'met', 'jams', 'relays']) delete old[k];
    const r = await rig({ store: new MemoryGameStore(old as unknown as GameSave) });
    r.game.setWorld(world([A, B], [])); place(r, off(5, 0));
    const v = r.game.view();
    expect(v.player).toMatchObject({ level: 4, score: 1200, deliveries: 9 });
    expect(v.shelters.find(s => s.id === 'A')).toMatchObject({ stars: 1, points: 320 });
    expect(v.caches).toEqual([]); expect(v.jams!.every(j => j.state === 'proposé')).toBe(true);
  });
});

describe('GPS imprécis', () => {
  it('à l’arrêt avec ±15 m de bruit pendant 10 minutes : ni marche, ni distance, ni dérive de l’équilibre, ni fatigue', async () => {
    const s1 = findSpot('g', off(20, 0), [A, B], plain);
    const cells = world([A, B], [s1]);
    const r = await rig({ t: calmT(cells) });
    r.game.setWorld(cells); fix(r, off(20, 0), 15);
    r.game.scan(); expect(r.game.pickup(s1.id)).toEqual({ ok: true });
    const here = off(100, 0), n = noise(7);
    // Le joueur va se poster plus loin (saut), puis ne bouge plus.
    r.clock.t += 60000; fix(r, here, 15);
    const stamina0 = r.game.view().player.stamina;
    let movingS = 0, maxBalance = 0;
    for (let i = 0; i < 600; i++) {
      r.clock.t += 1000;
      fix(r, off(100 + 15 * n(), 15 * n()), 15);
      r.game.tick(1);
      const p = r.game.view().player;
      if (p.moving) movingS++;
      maxBalance = Math.max(maxBalance, Math.abs(p.balance));
    }
    const p = r.game.view().player;
    expect(p.distanceKm).toBeLessThanOrEqual(0.02);
    expect(movingS).toBeLessThanOrEqual(30);
    expect(maxBalance).toBeLessThan(0.1);
    expect(p.stamina).toBeGreaterThanOrEqual(stamina0);
    expect(r.game.view().orders[0].condition).toBe(1);
    expect(toasts(r).some(t => /trop vite/.test(t))).toBe(false);
  });
  it('en marchant avec ±15 m de bruit, la distance comptée reste proche de la distance réelle', async () => {
    const r = await rig({});
    r.game.setWorld(world([A, B], []));
    fix(r, off(0, 0), 15);
    const n = noise(3);
    let movingS = 0;
    for (let i = 1; i <= 600; i++) {
      r.clock.t += 1000;
      fix(r, off(i * 1.3 + 15 * n(), 15 * n()), 15);
      r.game.tick(1);
      if (r.game.view().player.moving) movingS++;
    }
    const km = r.game.view().player.distanceKm;
    expect(km).toBeGreaterThan(0.78 * 0.75); expect(km).toBeLessThan(0.78 * 1.15);
    expect(movingS).toBeGreaterThan(500);
    expect(r.game.view().player.speedMps).toBeLessThan(SPEED.run);
  });
  it('GPS perdu 2 minutes puis retrouvé 300 m plus loin : pas de distance inventée, pas de vitesse folle, le colis et son délai continuent', async () => {
    const s1 = findSpot('t', off(20, 0), [A, B], o => !o.fragile && o.deadlineMin !== null && o.destId === 'B');
    const cells = world([A, B], [s1]);
    const r = await rig({ t: calmT(cells) });
    r.game.setWorld(cells); place(r, off(-100, 0));
    walk(r, off(20, 0));
    r.game.scan(); expect(r.game.pickup(s1.id)).toEqual({ ok: true });
    const km = r.game.view().player.distanceKm, left = r.game.view().orders[0].minutesLeft!;
    // Tunnel : l'horloge du jeu tourne (tick), mais aucune position n'arrive.
    for (let i = 0; i < 120; i++) { r.clock.t += 1000; r.game.tick(1); }
    place(r, off(20, 300));
    const p = r.game.view().player;
    expect(p.distanceKm).toBe(km);
    expect(p.speedMps).toBe(0); expect(p.moving).toBe(false);
    expect(r.game.view().orders[0]).toMatchObject({ id: s1.id, state: 'porté' });
    expect(r.game.view().orders[0].minutesLeft).toBe(left - 2);
    expect(toasts(r).some(t => /trop vite/.test(t))).toBe(false);
    // La marche reprend normalement.
    walk(r, off(20, 340));
    expect(r.game.view().player.distanceKm).toBeGreaterThan(km + 0.03);
  });
});

describe('déplacement en véhicule', () => {
  it('au-dessus de 6 m/s soutenus : ni distance, ni ramassage, ni livraison, avec un message clair ; à pied, tout reprend', async () => {
    const s1 = findSpot('v', off(0, 600), [A, B], plain);
    const cells = world([A, B], [s1]);
    const r = await rig({ t: calmT(cells) });
    r.game.setWorld(cells); place(r, off(0, 0));
    walk(r, off(0, 600), 12);
    const p = r.game.view().player;
    expect(p.distanceKm).toBe(0);
    expect(p.moving).toBe(false);
    expect(ofType(r.events, 'vehicle').filter(e => e.phase === 'début')).toHaveLength(1);
    expect(r.game.view().player.stamina).toBe(1);
    r.game.scan();
    expect(r.game.pickup(s1.id)).toEqual({ ok: false, why: 'Tu vas vite : confirme que tu es passager pour ramasser.' });
    wait(r, SPEED.vehicleCoolS + SPEED.idleMs / 1000 + 2);
    expect(toasts(r).some(t => /De nouveau à pied/.test(t))).toBe(true);
    expect(r.game.pickup(s1.id)).toEqual({ ok: true });
    walk(r, off(30, 600));
    expect(r.game.view().player.distanceKm).toBeGreaterThan(0.02);
  });
  it('une course à pied (4 m/s) n’est pas un véhicule', async () => {
    const r = await rig({});
    r.game.setWorld(world([A, B], [])); place(r, off(0, 0));
    walk(r, off(0, 400), 4);
    expect(r.game.view().player.distanceKm).toBeCloseTo(0.4, 1);
    expect(toasts(r).some(t => /trop vite/.test(t))).toBe(false);
  });
  it('un colis transporté en véhicule ne se livre pas en roulant et ne rapporte presque rien', async () => {
    const far = shelter('F', off(0, 650), 'Gare du Nord');
    const want = (o: { fragile: boolean; deadlineMin: number | null; weightKg: number; destId: string }) => !o.fragile && o.deadlineMin === null && o.destId === 'F';
    const s1 = findSpot('w', off(0, 30), [A, far], want);
    const cells = world([A, far], [s1]);
    const run = async (speed: number) => {
      const r = await rig({ t: calmT(cells) });
      r.game.setWorld(cells); place(r, off(0, 30));
      r.game.scan(); expect(r.game.pickup(s1.id)).toEqual({ ok: true });
      walk(r, off(0, 645), speed, i => { if (i % 5 === 0) r.game.steady(); });
      return r;
    };
    const car = await run(12), foot = await run(1.3);
    expect(car.game.deliver('F')).toEqual({ ok: false, why: 'Tu vas vite : confirme que tu es passager pour livrer.' });
    wait(car, SPEED.vehicleCoolS + SPEED.idleMs / 1000 + 2);
    expect(car.game.deliver('F')).toEqual({ ok: true });
    expect(foot.game.deliver('F')).toEqual({ ok: true });
    const c = ofType(car.events, 'delivery')[0].result, f = ofType(foot.events, 'delivery')[0].result;
    expect(c.notes).toContain('Transporté en véhicule'); expect(f.notes).not.toContain('Transporté en véhicule');
    expect(c.points).toBeLessThanOrEqual(Math.ceil(f.points * VEHICLE.mult) + 1);
    expect(car.game.view().player.distanceKm).toBe(0);
  });
  it('passager confirmé : le jeu n’est pas bridé, mais la marche ne compte pas', async () => {
    const far = shelter('F', off(0, 650), 'Gare du Nord');
    const want = (o: { fragile: boolean; deadlineMin: number | null; weightKg: number; destId: string }) => !o.fragile && o.deadlineMin === null && o.destId === 'F';
    const s1 = findSpot('w', off(0, 30), [A, far], want);
    const cells = world([A, far], [s1]);
    const r = await rig({ t: calmT(cells) });
    r.game.setWorld(cells); place(r, off(0, 30));
    expect(r.game.confirmPassenger()).toEqual({ ok: false, why: 'Tu es à pied.' });
    r.game.scan(); expect(r.game.pickup(s1.id)).toEqual({ ok: true });
    walk(r, off(0, 645), 12, i => { if (i % 5 === 0) r.game.steady(); if (!r.game.view().player.passenger) r.game.confirmPassenger(); });
    expect(ofType(r.events, 'vehicle').map(e => e.phase)).toEqual(['début']);
    expect(r.game.view().player.vehicle).toBe(true); expect(r.game.view().player.passenger).toBe(true);
    // Toujours en train de rouler : la livraison passe, sans pénalité.
    expect(r.game.deliver('F')).toEqual({ ok: true });
    expect(ofType(r.events, 'delivery')[0].result.notes).not.toContain('Transporté en véhicule');
    expect(r.game.view().player.distanceKm).toBe(0);
    // De retour à pied, la confirmation est oubliée : elle sera redemandée au prochain trajet.
    wait(r, SPEED.vehicleCoolS + SPEED.idleMs / 1000 + 2);
    expect(r.game.view().player.vehicle).toBe(false); expect(r.game.view().player.passenger).toBe(false);
    expect(ofType(r.events, 'vehicle').map(e => e.phase)).toEqual(['début', 'fin']);
  });
});

describe('sac et livraisons groupées', () => {
  it('sac plein : le colis de trop est refusé avec la raison, rien n’est perdu ; une fois un colis posé, il rentre', async () => {
    const heavy = (o: { weightKg: number; destId: string }) => o.weightKg >= 9 && o.weightKg <= 10 && o.destId === 'B';
    const spots = [0, 1, 2].map(i => findSpot(`h${i}-`, off(20 + i * 4, 0), [A, B], heavy));
    const r = await rig({});
    r.game.setWorld(world([A, B], spots)); place(r, off(24, 0));
    r.game.scan();
    const res = spots.map(s => r.game.pickup(s.id));
    expect(res[0]).toEqual({ ok: true }); expect(res[1]).toEqual({ ok: true });
    expect(res[2]).toEqual({ ok: false, why: 'Sac trop lourd : pose d’abord un colis.' });
    const v = r.game.view();
    expect(v.orders.filter(o => o.state === 'porté')).toHaveLength(2);
    expect(v.orders.filter(o => o.state === 'révélé').map(o => o.id)).toEqual([spots[2].id]);
    expect(v.player.carriedKg).toBeLessThanOrEqual(v.player.capacityKg);
    expect(r.game.drop(spots[0].id)).toEqual({ ok: true });
    expect(r.game.pickup(spots[2].id)).toEqual({ ok: true });
  });
  it('plusieurs colis pour le même abri sont livrés d’un coup, chacun avec sa note ; ceux d’un autre abri restent dans le sac', async () => {
    const light = (dest: string) => (o: { fragile: boolean; deadlineMin: number | null; weightKg: number; destId: string }) => !o.fragile && o.deadlineMin === null && o.weightKg <= 4 && o.destId === dest;
    const C = shelter('C', off(0, 400), 'Mairie');
    const all = [A, B, C];
    const sb = [findSpot('m1-', off(20, 0), all, light('B')), findSpot('m2-', off(24, 0), all, light('B')), findSpot('m3-', off(28, 0), all, light('B'))];
    const sc = findSpot('m4-', off(22, 4), all, light('C'));
    const cells = world(all, [...sb, sc]);
    const r = await rig({ t: calmT(cells) });
    r.game.setWorld(cells); place(r, off(24, 0)); r.game.scan();
    for (const s of [...sb, sc]) expect(r.game.pickup(s.id)).toEqual({ ok: true });
    walk(r, off(295, 0), 1.3, i => { if (i % 5 === 0) r.game.steady(); });
    expect(r.game.view().shelters.find(s => s.id === 'B')!.deliverable.sort()).toEqual(sb.map(s => s.id).sort());
    expect(r.game.deliver('B')).toEqual({ ok: true });
    const d = ofType(r.events, 'delivery');
    expect(d.map(e => e.result.orderId).sort()).toEqual(sb.map(s => s.id).sort());
    expect(d.map(e => e.result.starsBefore)).toEqual([0, 1, 1]);
    const v = r.game.view();
    expect(v.player.deliveries).toBe(3);
    expect(v.player.score).toBe(d.reduce((n, e) => n + e.result.points, 0));
    expect(v.orders.map(o => [o.id, o.state])).toEqual([[sc.id, 'porté']]);
    expect(r.game.deliver('B')).toEqual({ ok: false, why: 'Aucun colis pour cet abri.' });
  });
});

describe('abri destinataire sorti des cases chargées', () => {
  it('reste visible et livrable tant qu’un colis porté lui est destiné', async () => {
    const s1 = findSpot('f', off(20, 0), [A, B], plain);
    const cells = world([A, B], [s1]);
    const r = await rig({ t: calmT(cells) });
    r.game.setWorld(cells); place(r, off(20, 0)); r.game.scan(); r.game.pickup(s1.id);
    // Le monde ne contient plus l'abri B (case déchargée, ou lieu retiré de la carte).
    r.game.setWorld(world([A], []));
    const ghost = r.game.view().shelters.find(s => s.id === 'B')!;
    expect(ghost).toMatchObject({ name: 'Pharmacie du Port', at: B.at, deliverable: [s1.id], inRange: false });
    expect(r.game.deliver('B')).toEqual({ ok: false, why: 'Trop loin de l’abri.' });
    walk(r, off(295, 0), 1.3, i => { if (i % 5 === 0) r.game.steady(); });
    expect(r.game.view().shelters.find(s => s.id === 'B')!.inRange).toBe(true);
    expect(r.game.deliver('B')).toEqual({ ok: true });
    expect(ofType(r.events, 'delivery')[0].result).toMatchObject({ shelterId: 'B', shelterName: 'Pharmacie du Port', starsAfter: 1 });
    // Plus de colis pour lui : l'abri fantôme disparaît, et un abri inconnu reste introuvable.
    expect(r.game.view().shelters.map(s => s.id)).toEqual(['A']);
    expect(r.game.deliver('B')).toEqual({ ok: false, why: 'Abri introuvable.' });
  });
});

describe('voyage au loin', () => {
  it('un colis révélé mais jamais ramassé est oublié quand sa case n’est plus chargée ; un colis posé par le joueur reste', async () => {
    const s1 = findSpot('y', off(20, 0), [A, B], plain), s2 = findSpot('z', off(40, 0), [A, B], plain);
    const cells = world([A, B], [s1, s2]);
    const r = await rig({ t: calmT(cells) });
    r.game.setWorld(cells); place(r, off(20, 0)); r.game.scan();
    r.game.pickup(s2.id); r.game.drop(s2.id);
    expect(r.game.view().orders).toHaveLength(2);
    // Le joueur se retrouve à 300 km : le monde chargé n'a plus rien de commun.
    const far: LngLat = [2.347, 48.8583];
    const C = shelter('C', far, 'Louvre');
    r.clock.t += 3 * 3600_000;
    r.game.setWorld(world([C], []));
    place(r, far);
    expect(r.game.view().orders.map(o => o.id)).toEqual([s2.id]);
    // De retour le même jour : le colis oublié est de nouveau là, à rescanner.
    r.clock.t += 3 * 3600_000;
    r.game.setWorld(cells); place(r, off(20, 0));
    wait(r, 10); r.game.scan();
    expect(r.game.view().orders.map(o => o.id).sort()).toEqual([s1.id, s2.id].sort());
  });
});

describe('horloge du téléphone modifiée', () => {
  it('reculée en pleine partie : pas de retour au jour précédent, pas de distance ni de délai négatifs', async () => {
    const s1 = findSpot('c', off(20, 0), [A, B], o => !o.fragile && o.deadlineMin !== null && o.destId === 'B');
    const cells = world([A, B], [s1]);
    const r = await rig({ t: calmT(cells) });
    r.game.setWorld(cells); place(r, off(20, 0)); r.game.scan(); r.game.pickup(s1.id);
    const ids = r.game.view().contracts.map(c => c.id);
    r.clock.t -= 2 * DAY;
    place(r, off(21, 0)); r.game.tick(1);
    walk(r, off(60, 0));
    const v = r.game.view();
    expect(v.contracts.map(c => c.id)).toEqual(ids);
    expect(v.player.distanceKm).toBeGreaterThanOrEqual(0); expect(v.player.distanceKm).toBeLessThan(0.06);
    expect(v.orders[0].state).toBe('porté');
    expect(Number.isFinite(v.orders[0].minutesLeft!)).toBe(true);
  });
  it('avancée d’un jour puis remise à l’heure : les contrats déjà payés ne se rejouent pas au rechargement', async () => {
    const cells = world([A, B], []);
    const t = calmT(cells);
    const done = (over: Partial<GameSave>): GameSave => ({ ...emptyGameSave(dayKey(t + DAY)), savedAt: t + DAY, ...over });
    // Sauvegarde écrite « demain » (horloge avancée), relue aujourd'hui (horloge remise à l'heure).
    const ahead = await rig({ t: t + DAY });
    const tomorrow = ahead.game.view().contracts.map(c => c.id);
    const r = await rig({ t, save: done({ contracts: tomorrow.map(id => ({ id, progress: 99, claimed: true })) }) });
    r.game.setWorld(cells); place(r, BASE);
    const v = r.game.view();
    expect(v.contracts.map(c => c.id)).toEqual(tomorrow);
    expect(v.contracts.every(c => c.claimed)).toBe(true);
    expect(r.game.claim(tomorrow[0])).toEqual({ ok: false, why: 'Récompense déjà prise.' });
    // Le vrai lendemain, le jour avance normalement.
    r.clock.t = t + DAY + 60000; r.game.tick(1);
    r.clock.t = t + 2 * DAY + 60000; r.game.tick(1);
    expect(r.game.view().contracts.some(c => c.id.startsWith(`j:${dayKey(t + 2 * DAY)}`))).toBe(true);
  });
});

describe('nouveau porteur et campagne', () => {
  it('les premières commandes sont simplifiées jusqu’à la troisième livraison, puis redeviennent ordinaires', async () => {
    const C = shelter('C', off(0, 400), 'Mairie'), all = [A, B, C];
    const hard = (o: { fragile: boolean; deadlineMin: number | null; destId: string }) => o.fragile && o.deadlineMin !== null && o.destId === 'C';
    const s1 = findSpot('n', off(150, 0), all, hard);
    const cells = world(all, [s1]);
    const t = calmT(cells);
    const fresh = await rig({ t, newcomer: true });
    fresh.game.setWorld(cells); place(fresh, off(150, 0)); fresh.game.scan();
    const easy = fresh.game.view().orders[0];
    expect(easy).toMatchObject({ id: s1.id, fragile: false, minutesLeft: null });
    expect(['A', 'B']).toContain(easy.destId);
    expect(dist(easy.at, easy.destAt)).toBeGreaterThanOrEqual(NEWBIE.minM); expect(dist(easy.at, easy.destAt)).toBeLessThanOrEqual(NEWBIE.maxM);
    const seasoned = await rig({ t, newcomer: true, save: { ...emptyGameSave(dayKey(t)), deliveries: NEWBIE.deliveries } });
    seasoned.game.setWorld(cells); place(seasoned, off(150, 0)); seasoned.game.scan();
    expect(seasoned.game.view().orders[0]).toMatchObject({ id: s1.id, fragile: true, destId: 'C' });
    expect(seasoned.game.view().orders[0].minutesLeft).not.toBeNull();
    // Même emplacement pour les deux joueurs : seul le contenu de la commande change.
    expect(easy.at).toEqual(seasoned.game.view().orders[0].at);
  });
  it('scanner à vide en rase campagne : le colis caché le plus proche est signalé, jamais plus loin que la portée d’écho', async () => {
    const any = () => true;
    const near = findSpot('e1-', off(0, 420), [A, B], any), far = findSpot('e2-', off(0, 700), [A, B], any), out = spot('e3', off(0, SCAN_ECHO_M + 300));
    const r = await rig({});
    r.game.setWorld(world([A, B], [near, far, out])); place(r, BASE);
    expect(r.game.scan()).toEqual({ ok: true });
    expect(ofType(r.events, 'scan')[0]).toMatchObject({ found: 1 });
    expect(r.game.view().orders.map(o => o.id)).toEqual([near.id]);
    expect(toasts(r).some(t => /^Signal lointain : un colis à 400 m/.test(t))).toBe(true);
    // Un colis est déjà connu : le scan suivant ne va pas en chercher un autre au loin.
    wait(r, 10); r.game.scan();
    expect(r.game.view().orders.map(o => o.id)).toEqual([near.id]);
    // Rien du tout à portée d'écho : le scan reste vide, sans erreur.
    const empty = await rig({});
    empty.game.setWorld(world([A, B], [out])); place(empty, BASE);
    expect(empty.game.scan()).toEqual({ ok: true });
    expect(ofType(empty.events, 'scan')[0]).toMatchObject({ found: 0 });
  });
});
