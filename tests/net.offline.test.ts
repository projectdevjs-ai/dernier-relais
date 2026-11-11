// Bascule hors ligne : le client et le réseau ne lèvent jamais d'erreur et reprennent quand le serveur revient.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeliveryResult } from '../src/game/api';
import { NetClient, isOutage } from '../src/net/client';
import { FakeServer } from '../src/net/fake';
import { Network, cleanPseudo } from '../src/net/network';

const delivery = (points: number): DeliveryResult => ({
  orderId: 'o1', orderName: 'Médicaments', shelterId: 's1', shelterName: 'Mairie', npc: 'mara', grade: 'A', condition: 1, onTime: true,
  points, xp: 10, notes: [], starsBefore: 0, starsAfter: 0, unlock: null, levelUp: false,
});
const NANTES = { id: 's1', name: 'Mairie de Bouguenais', at: [-1.62, 47.18] as [number, number] };
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
const setup = () => {
  const server = new FakeServer();
  server.tables.regions.push({ id: 'pdl', shelters: 4, active_shelters: 2, points: 1800, deliveries: 9 });
  let total = 0;
  server.rpcs.deliver_to_shelter = a => { total += Number(a.p_points); return { ok: true, level: total >= 600 ? 1 : 0, level_before: 0, points: total, deliveries: 1, region: a.p_region }; };
  const client = new NetClient({ create: () => server.db(), retryMs: 20_000 });
  const storage = memory();
  const net = new Network(client, { storage });
  return { server, client, net, storage };
};

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
afterEach(() => { vi.useRealTimers(); });

describe('NetClient', () => {
  it('se connecte anonymement une seule fois et passe en ligne', async () => {
    const { server, client } = setup();
    const seen: boolean[] = [];
    client.onOnline(v => seen.push(v));
    expect(client.online).toBe(false);
    expect(await client.ensure()).not.toBeNull();
    await client.ensure();
    expect(client.online).toBe(true);
    expect(client.userId).toBe('u-1');
    expect(server.count('signin')).toBe(1);
    expect(seen).toEqual([true]);
  });
  it('connexion anonyme désactivée : hors ligne, puis nouvelles tentatives de plus en plus espacées', async () => {
    const { server, client } = setup();
    server.anonymous = false;
    expect(await client.ensure()).toBeNull();
    expect(await client.ensure()).toBeNull(); // pas de nouvel essai avant le délai
    expect(server.count('signin')).toBe(1);
    vi.advanceTimersByTime(20_001);
    expect(await client.ensure()).toBeNull();
    expect(server.count('signin')).toBe(2);
    vi.advanceTimersByTime(20_001); // le délai a doublé : toujours pas d'essai
    await client.ensure();
    expect(server.count('signin')).toBe(2);
    server.anonymous = true;
    vi.advanceTimersByTime(20_001);
    expect(await client.ensure()).not.toBeNull();
    expect(client.online).toBe(true);
  });
  it('tables absentes : hors ligne sans erreur', async () => {
    const { server, client } = setup();
    server.schema = false;
    expect(await client.ensure()).toBeNull();
    expect(client.online).toBe(false);
    expect(await client.run(db => db.from('players').select('id'))).toBeNull();
  });
  it('une panne en cours de route fait basculer hors ligne et prévient les abonnés', async () => {
    const { server, client } = setup();
    const seen: boolean[] = [];
    client.onOnline(v => seen.push(v));
    await client.ensure();
    server.down = true;
    expect(await client.run(db => db.from('regions').select('id'))).toBeNull();
    expect(client.online).toBe(false);
    expect(seen).toEqual([true, false]);
  });
  it('start() reprend tout seul quand le serveur revient', async () => {
    const { server, client } = setup();
    server.down = true;
    client.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(client.online).toBe(false);
    server.down = false;
    await vi.advanceTimersByTimeAsync(20_100);
    expect(client.online).toBe(true);
    client.stop();
  });
  it('distingue une panne d’une simple requête refusée', () => {
    expect(isOutage(new TypeError('fetch failed'))).toBe(true);
    expect(isOutage({ code: 'PGRST205', message: 'table absente' })).toBe(true);
    expect(isOutage({ code: '23514', message: 'violates check constraint' })).toBe(false);
    expect(isOutage(null)).toBe(false);
  });
});

describe('Network hors ligne', () => {
  it('aucune méthode ne lève d’erreur et tout renvoie une valeur neutre', async () => {
    const { server, net } = setup();
    server.down = true;
    net.start();
    net.onDelivery(delivery(120), NANTES);
    net.setPlayer({ level: 2, score: 300, deliveries: 3, distanceKm: 1.2 }, NANTES.at);
    expect(await net.shelterLevels(['s1', 's2'])).toEqual(new Map());
    expect(net.regions()).toHaveLength(13);
    expect(await net.leaderboard()).toEqual([]);
    expect(await net.playerCount()).toBeNull();
    expect(await net.relaysAt('s1')).toEqual([]);
    expect(await net.carriedRelays()).toEqual([]);
    expect(await net.dropRelay('s1', 'r1')).toBeNull();
    expect(await net.takeRelay('r1')).toBeNull();
    expect(await net.deliverRelay('r1', 100)).toBe(false);
    expect(await net.pendingRewards()).toEqual([]);
    expect(await net.claimRewards()).toBe(0);
    expect(await net.setPseudo('Léa')).toBe(true); // accepté en local, envoyé plus tard
    expect(await net.setPseudo('x')).toBe(false);
    expect(net.online).toBe(false);
    expect(net.myRegion()).toBe('pdl');
    net.client.stop();
  });
  it('les livraisons attendent dans une file locale et partent au retour du réseau', async () => {
    const { server, net, storage, client } = setup();
    server.down = true;
    net.start();
    net.onDelivery(delivery(200), NANTES);
    net.onDelivery(delivery(450), NANTES);
    await vi.advanceTimersByTimeAsync(10);
    expect(net.pendingDeliveries()).toBe(2);
    // La file survit à un redémarrage du jeu.
    expect(new Network(new NetClient({ create: () => server.db() }), { storage }).pendingDeliveries()).toBe(2);
    const events: number[] = [];
    net.onCollective(e => events.push(e.level));
    server.down = false;
    await vi.advanceTimersByTimeAsync(20_100);
    expect(client.online).toBe(true);
    expect(net.pendingDeliveries()).toBe(0);
    expect(server.count('rpc deliver_to_shelter')).toBe(2);
    expect(events).toEqual([0, 1]);
    expect((await net.shelterLevels(['s1'])).get('s1')).toEqual({ level: 1, points: 650 });
    expect(server.tables.players[0]).toMatchObject({ id: 'u-1', region: 'pdl' });
    client.stop();
  });
  it('limite de fréquence : la livraison reste en file et repart plus tard', async () => {
    const { server, net, client } = setup();
    let refuse = true;
    server.rpcs.deliver_to_shelter = () => (refuse ? { ok: false, reason: 'rate' } : { ok: true, level: 0, level_before: 0, points: 10 });
    net.start();
    net.onDelivery(delivery(100), NANTES);
    await vi.advanceTimersByTimeAsync(10);
    expect(net.pendingDeliveries()).toBe(1);
    expect(client.online).toBe(true);
    refuse = false;
    await vi.advanceTimersByTimeAsync(2 * 60_000 + 10);
    expect(net.pendingDeliveries()).toBe(0);
    client.stop();
  });
  it('en ligne : régions, abonnés prévenus et dernier état gardé pour le hors-ligne', async () => {
    const { server, net, storage, client } = setup();
    const seen: number[] = [];
    const off = net.onRegions(r => seen.push(r.find(x => x.id === 'pdl')!.activeShelters));
    net.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(seen.at(-1)).toBe(2);
    expect(net.regions().find(r => r.id === 'pdl')).toMatchObject({ shelters: 4, deliveries: 9, points: 1800 });
    off();
    client.stop();
    server.down = true;
    const later = new Network(new NetClient({ create: () => server.db() }), { storage });
    expect(later.regions().find(r => r.id === 'pdl')!.activeShelters).toBe(2);
  });
  it('nettoie les pseudos', () => {
    expect(cleanPseudo('  Léa   la  porteuse ')).toBe('Léa la porteuse');
    expect(cleanPseudo('a')).toBeNull();
    expect(cleanPseudo('x'.repeat(21))).toBeNull();
    expect(cleanPseudo('<b>Zoé</b>')).toBe('bZoé/b');
  });
});
