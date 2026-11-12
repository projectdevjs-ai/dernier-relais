// Chaîne de relais de bout en bout : deux joueurs, le vrai moteur de jeu, le vrai code réseau, un faux serveur en mémoire.
import { describe, expect, it } from 'vitest';
import { dist } from '../src/core/geo';
import { RELAY } from '../src/game/api';
import { NetClient } from '../src/net/client';
import { FakeServer, installGameRpcs } from '../src/net/fake';
import { OnlineLink, collectiveView } from '../src/net/link';
import { Network, porterName } from '../src/net/network';
import { BASE, type Rig, findSpot, off, ofType, place, rig, shelter, walk, world } from './game.helpers';

const A = shelter('A', BASE), B = shelter('B', off(300, 0)), C = shelter('C', off(900, 0));
const SHELTERS = [A, B, C];
const SPOT = findSpot('relais', off(15, 0), SHELTERS, o => o.destId === 'C' && o.deadlineMin === null && o.weightKg <= 6);
const CELLS = world(SHELTERS, [SPOT]);

interface Player { r: Rig; server: FakeServer; net: Network; link: OnlineLink; toasts: string[]; /** Horloge du client réseau (délais de reprise). */ netClock: { t: number } }
async function player(uid: string, tables?: FakeServer['tables']): Promise<Player> {
  const server = new FakeServer();
  server.userId = uid;
  if (tables) server.tables = tables;
  installGameRpcs(server);
  const netClock = { t: 1_000_000 };
  const client = new NetClient({ create: () => server.db(), now: () => netClock.t });
  const net = new Network(client, { storage: null });
  const r = await rig();
  r.game.setWorld(CELLS);
  const toasts: string[] = [];
  const link = new OnlineLink(net, r.game, { toast: text => toasts.push(text) }, { storage: null, shelterName: id => SHELTERS.find(s => s.id === id)?.name ?? null });
  link.start();
  await client.ensure();
  return { r, server, net, link, toasts, netClock };
}
/** Le joueur scanne, ramasse le colis de l'emplacement et marche jusqu'à un abri. */
function carryTo(p: Player, to: typeof A): string {
  const g = p.r.game;
  place(p.r, SPOT.at);
  expect(g.scan()).toEqual({ ok: true });
  expect(g.pickup(SPOT.id)).toEqual({ ok: true });
  walk(p.r, to.at, 1.3, i => { if (i % 5 === 0) g.steady(); });
  return SPOT.id;
}
const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

describe('relais : règles du jeu', () => {
  it('refuse un abri qui ne rapproche pas, la destination elle-même, et un dépôt à distance', async () => {
    const p = await player('u-1'), g = p.r.game;
    carryTo(p, A);
    expect(g.giveToRelay(SPOT.id, 'A', true)).toEqual({ ok: false, why: 'Cet abri ne rapproche pas le colis de sa destination.' });
    expect(g.giveToRelay(SPOT.id, 'B', true)).toEqual({ ok: false, why: 'Trop loin de l’abri.' });
    walk(p.r, C.at, 1.3, i => { if (i % 5 === 0) g.steady(); });
    expect(g.giveToRelay(SPOT.id, 'C')).toEqual({ ok: false, why: 'Ce colis est attendu ici : livre-le.' });
    expect(g.giveToRelay('inconnu')).toMatchObject({ ok: false });
    expect(g.view().orders.find(o => o.id === SPOT.id)?.state).toBe('porté');
  });

  it('l’essai à blanc ne change rien ; le dépôt sort le colis du sac et verse l’avance au prorata du chemin fait', async () => {
    const p = await player('u-1'), g = p.r.game;
    carryTo(p, B);
    const before = g.view(), o = before.orders.find(x => x.id === SPOT.id)!;
    const dry = g.giveToRelay(SPOT.id, 'B', true);
    expect(dry.ok).toBe(true);
    expect(g.view().orders.some(x => x.id === SPOT.id)).toBe(true);
    expect(g.view().player.score).toBe(before.player.score);
    const progress = 1 - dist(B.at, C.at) / dist(SPOT.at, C.at);
    expect(dry.points).toBe(Math.round(o.reward * RELAY.dropShare * progress));
    expect(dry.parcel).toMatchObject({ name: o.name, destId: 'C', weightKg: o.weightKg, fragile: o.fragile });
    const done = g.giveToRelay(SPOT.id); // sans abri précisé : celui où se trouve le joueur
    expect(done).toMatchObject({ ok: true, shelterId: 'B', points: dry.points });
    const after = g.view();
    expect(after.orders.some(x => x.id === SPOT.id)).toBe(false);
    expect(after.player.score).toBe(before.player.score + dry.points!);
    expect(after.player.carriedKg).toBe(0);
    expect(ofType(p.r.events, 'toast').some(e => e.text === `Colis laissé en relais : +${dry.points} points`)).toBe(true);
    // Le colis confié ne réapparaît pas au scanner aujourd'hui.
    g.setWorld(CELLS); place(p.r, SPOT.at); p.r.clock.t += 30000; g.tick(30); g.scan();
    expect(g.view().orders.some(x => x.id === SPOT.id)).toBe(false);
  });

  it('un colis pris au relais entre dans le sac marqué « relais », ne se pose pas par terre et survit à la sauvegarde', async () => {
    const p = await player('u-1'), g = p.r.game;
    const relay = { id: 'r-9', parcel: { name: 'Lampes', crate: 'plastique' as const, weightKg: 4, fragile: false, reward: 9999, destId: 'C', destName: C.name, destAt: C.at, condition: 0.8 } };
    place(p.r, off(150, 0));
    expect(g.takeFromRelay(relay)).toEqual({ ok: false, why: 'Il faut être dans un abri pour prendre un relais.' });
    place(p.r, B.at);
    expect(g.takeFromRelay(relay, true)).toEqual({ ok: true });
    expect(g.view().orders).toEqual([]);
    expect(g.takeFromRelay(relay)).toEqual({ ok: true });
    const o = g.view().orders[0];
    // La récompense annoncée par un autre joueur est bornée.
    expect(o).toMatchObject({ id: 'relais|r-9', name: 'Lampes', state: 'porté', relay: { id: 'r-9' }, condition: 0.8, minutesLeft: null, reward: 400, destId: 'C' });
    expect(ofType(p.r.events, 'pickup')).toHaveLength(1);
    expect(g.takeFromRelay(relay)).toMatchObject({ ok: false });
    expect(g.drop(o.id)).toEqual({ ok: false, why: 'Un colis de relais se dépose dans un abri, pas par terre.' });
    expect(g.takeFromRelay({ id: 'r-10', parcel: { ...relay.parcel, weightKg: 500 } })).toEqual({ ok: false, why: 'Sac trop lourd : pose d’abord un colis.' });
    await g.flush();
    expect(p.r.store.peek()!.relays).toEqual({ 'relais|r-9': 'r-9' });
    const again = await rig({ store: p.r.store });
    again.game.setWorld(CELLS);
    expect(again.game.view().orders[0]).toMatchObject({ id: 'relais|r-9', relay: { id: 'r-9' }, state: 'porté' });
  });

  it('credit ajoute des points et de l’expérience, avec un message', async () => {
    const p = await player('u-1'), g = p.r.game;
    g.credit(0); g.credit(-5); g.credit(Number.NaN);
    expect(g.view().player.score).toBe(0);
    g.credit(120, 'Ton relais est arrivé : +120 points');
    expect(g.view().player.score).toBe(120);
    expect(g.view().player.xp + g.view().player.level).toBeGreaterThan(1);
    expect(ofType(p.r.events, 'toast').map(e => e.text)).toContain('Ton relais est arrivé : +120 points');
  });
});

describe('relais : la chaîne complète entre deux joueurs', () => {
  it('dépôt, prise par un autre porteur, livraison finale, prime du premier porteur', async () => {
    const one = await player('u-1'), two = await player('u-2', one.server.tables);
    // (a) Le premier porteur laisse son colis à mi-chemin.
    carryTo(one, B);
    const given = await one.link.hud.giveRelay(SPOT.id, 'B');
    expect(given.ok).toBe(true);
    expect(one.r.game.view().orders).toEqual([]);
    expect(one.server.tables.relays).toHaveLength(1);
    expect(one.server.tables.relays[0]).toMatchObject({ state: 'waiting', at_shelter: 'B', dest_shelter: 'C', carriers: ['u-1'] });
    const scoreOne = one.r.game.view().player.score;
    expect(scoreOne).toBe(given.points);

    // Il voit son colis en attente, mais ne peut pas le reprendre lui-même.
    const mine = await one.link.hud.relaysAt('B');
    expect(mine).toHaveLength(1);
    expect(mine[0].mine).toBe(true);
    expect(await one.link.hud.takeRelay(mine[0])).toEqual({ ok: false, why: 'Tu as déjà porté ce colis : laisse-le à un autre porteur.' });

    // (b) Le second porteur le trouve dans l'abri et le prend.
    place(two.r, B.at);
    const offers = await two.link.hud.relaysAt('B');
    expect(offers).toMatchObject([{ mine: false, hops: 1, parcel: { destId: 'C' } }]);
    expect(await two.link.hud.takeRelay(offers[0])).toEqual({ ok: true });
    expect(one.server.tables.relays[0]).toMatchObject({ state: 'carried', carrier: 'u-2', carriers: ['u-1', 'u-2'] });
    const carried = two.r.game.view().orders[0];
    expect(carried).toMatchObject({ state: 'porté', relay: { id: offers[0].id }, destId: 'C' });
    expect(await two.link.hud.relaysAt('B')).toEqual([]);

    // (c) Il le livre : la livraison est notée comme une autre et déclarée au serveur.
    walk(two.r, C.at, 1.3, i => { if (i % 5 === 0) two.r.game.steady(); });
    expect(two.r.game.deliver('C')).toEqual({ ok: true });
    const res = ofType(two.r.events, 'delivery')[0].result;
    expect(res.relayId).toBe(offers[0].id);
    expect(res.notes).toContain('Colis de relais');
    await settle();
    expect(one.server.tables.relays[0].state).toBe('delivered');
    expect(two.link.pendingDeliveries()).toBe(0);
    const prime = Math.round(res.points * RELAY.chainShare);
    expect(one.server.tables.relay_rewards.map(w => [w.player, w.points])).toEqual([['u-1', prime], ['u-2', prime]]);

    // Le livreur a déjà été payé par sa note : sa propre prime n'est pas créditée une seconde fois.
    const scoreTwo = two.r.game.view().player.score;
    expect(await two.link.collect(true)).toBe(0);
    expect(two.r.game.view().player.score).toBe(scoreTwo);

    // (d) Le premier porteur touche sa prime, avec le message attendu.
    expect(await one.link.collect(true)).toBe(prime);
    expect(one.r.game.view().player.score).toBe(scoreOne + prime);
    expect(ofType(one.r.events, 'toast').map(e => e.text)).toContain(`Ton relais est arrivé : +${prime} points`);
    expect(await one.link.collect(true)).toBe(0);
  });

  it('un relais ne peut être pris que par un seul porteur', async () => {
    const one = await player('u-1'), two = await player('u-2', one.server.tables), three = await player('u-3', one.server.tables);
    carryTo(one, B);
    await one.link.hud.giveRelay(SPOT.id, 'B');
    place(two.r, B.at); place(three.r, B.at);
    const [offer] = await two.link.hud.relaysAt('B'), [same] = await three.link.hud.relaysAt('B');
    expect(await two.link.hud.takeRelay(offer)).toEqual({ ok: true });
    expect(await three.link.hud.takeRelay(same)).toEqual({ ok: false, why: 'Trop tard : un autre porteur l’a pris, ou tu portes déjà trois relais.' });
    expect(three.r.game.view().orders).toEqual([]);
  });

  it('hors ligne : rien ne casse, le colis reste dans le sac, la livraison d’un relais est déclarée au retour du réseau', async () => {
    const one = await player('u-1'), two = await player('u-2', one.server.tables);
    carryTo(one, B);
    one.server.down = true;
    expect(await one.link.hud.giveRelay(SPOT.id, 'B')).toEqual({ ok: false, why: 'Connexion perdue : le colis reste dans ton sac.' });
    expect(one.link.hud.isOnline()).toBe(false);
    expect(await one.link.hud.giveRelay(SPOT.id, 'B')).toEqual({ ok: false, why: 'Les relais demandent une connexion.' });
    expect(await one.link.hud.relaysAt('B')).toEqual([]);
    expect(await one.link.hud.shelterLevel('B')).toBeNull();
    expect(one.r.game.view().orders[0]).toMatchObject({ id: SPOT.id, state: 'porté' });
    // Le serveur revient ; le client retente après son délai de reprise.
    one.server.down = false;
    one.netClock.t += 3_600_000;
    await one.net.client.ensure();
    expect(one.link.hud.isOnline()).toBe(true);
    expect((await one.link.hud.giveRelay(SPOT.id, 'B')).ok).toBe(true);

    place(two.r, B.at);
    const [offer] = await two.link.hud.relaysAt('B');
    await two.link.hud.takeRelay(offer);
    walk(two.r, C.at, 1.3, i => { if (i % 5 === 0) two.r.game.steady(); });
    two.server.down = true;
    await two.net.client.run(db => db.from('regions').select('id'));
    expect(two.r.game.deliver('C')).toEqual({ ok: true });
    await settle();
    expect(two.link.pendingDeliveries()).toBe(1);
    expect(one.server.tables.relays[0].state).toBe('carried');
    // Retour du réseau : la livraison part, la prime du premier porteur est créée.
    two.server.down = false;
    two.netClock.t += 3_600_000;
    await two.net.client.ensure();
    await settle();
    expect(two.link.pendingDeliveries()).toBe(0);
    expect(one.server.tables.relays[0].state).toBe('delivered');
    expect(await one.link.collect(true)).toBeGreaterThan(0);
  });
});

describe('abri collectif et nom de porteur', () => {
  it('niveau, seuil suivant et avancement', async () => {
    expect(collectiveView(0, 300)).toEqual({ level: 0, points: 300, nextAt: 600, progress: 0.5 });
    expect(collectiveView(2, 6500)).toEqual({ level: 2, points: 6500, nextAt: 10000, progress: 0.5 });
    expect(collectiveView(5, 90000)).toEqual({ level: 5, points: 90000, nextAt: null, progress: 1 });
    const p = await player('u-1');
    p.server.tables.shelters.push({ id: 'A', level: 1, points: 1800 });
    expect(await p.link.hud.shelterLevel('A')).toEqual({ level: 1, points: 1800, nextAt: 3000, progress: 0.5 });
  });

  it('annonce la montée de niveau d’un abri collectif', async () => {
    const p = await player('u-1');
    p.server.tables.shelters.push({ id: 'B', name: B.name, points: 590, level: 0, deliveries: 3 });
    p.net.onDelivery({ orderId: 'o', orderName: 'Savon', shelterId: 'B', shelterName: B.name, npc: 'mara', grade: 'A', condition: 1, onTime: true, points: 40, xp: 5, notes: [], starsBefore: 1, starsAfter: 1, unlock: null, levelUp: false }, B);
    await settle();
    expect(p.toasts).toEqual([`${B.name} passe au niveau 1 du réseau`]);
  });

  it('propose un nom de porteur généré, stable, et retient le choix du joueur', async () => {
    expect(porterName(0)).toBe('Porteur Lynx-10');
    for (let i = 0; i < 500; i++) expect(porterName(i * 7919)).toMatch(/^Porteur [A-Za-zéè]+-\d\d$/);
    const p = await player('u-1');
    const auto = p.link.pseudo.get();
    expect(auto).toMatch(/^Porteur [A-Za-zéè]+-\d\d$/);
    expect(auto.length).toBeLessThanOrEqual(20);
    expect(p.link.pseudo.get()).toBe(auto);
    expect(p.link.pseudo.chosen()).toBe(false);
    expect(await p.link.pseudo.set('x')).toBe(false);
    expect(await p.link.pseudo.set('Léa du Relais')).toBe(true);
    expect(p.link.pseudo.chosen()).toBe(true);
    expect(p.link.pseudo.get()).toBe('Léa du Relais');
  });
});
