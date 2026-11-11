// Sauvegarde en ligne : fusion des deux sauvegardes, envoi espacé, aucune perte quand le réseau échoue.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type GameSave, MemoryGameStore, emptyGameSave } from '../src/game/save';
import { NetClient } from '../src/net/client';
import { CloudGameStore } from '../src/net/cloudstore';
import { FakeServer } from '../src/net/fake';

const save = (savedAt: number, score: number): GameSave => ({ ...emptyGameSave('2026-11-11'), savedAt, score });
const setup = (local: GameSave | null, cloud: GameSave | null) => {
  const server = new FakeServer();
  if (cloud) server.tables.saves.push({ id: server.userId, data: cloud, saved_at: cloud.savedAt });
  const mem = new MemoryGameStore(local);
  const client = new NetClient({ create: () => server.db() });
  const seen: number[] = [];
  const store = new CloudGameStore(mem, client, { onSave: s => seen.push(s.score) });
  return { server, mem, client, store, seen };
};

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
afterEach(() => { vi.useRealTimers(); });

describe('CloudGameStore : lecture', () => {
  it('prend la sauvegarde en ligne quand elle est plus récente, et la recopie sur le téléphone', async () => {
    const { store, mem } = setup(save(100, 10), save(200, 99));
    expect((await store.load())?.score).toBe(99);
    expect(mem.peek()?.score).toBe(99);
  });
  it('garde la sauvegarde locale quand elle est plus récente', async () => {
    const { store, mem } = setup(save(300, 42), save(200, 99));
    expect((await store.load())?.score).toBe(42);
    expect(mem.writes).toBe(0);
  });
  it('prend la seule qui existe', async () => {
    expect((await setup(null, save(5, 7)).store.load())?.score).toBe(7);
    expect((await setup(save(5, 8), null).store.load())?.score).toBe(8);
    expect(await setup(null, null).store.load()).toBeNull();
  });
  it('ignore une sauvegarde en ligne illisible', async () => {
    const s = setup(save(100, 10), null);
    s.server.tables.saves.push({ id: s.server.userId, data: { version: 99, savedAt: 999 }, saved_at: 999 });
    expect((await s.store.load())?.score).toBe(10);
  });
  it('hors ligne : rend la sauvegarde locale sans erreur', async () => {
    const s = setup(save(100, 10), save(200, 99));
    s.server.down = true;
    expect((await s.store.load())?.score).toBe(10);
    expect(s.client.online).toBe(false);
  });
  it('tables absentes ou connexion anonyme désactivée : comme avant, en local', async () => {
    const a = setup(save(100, 10), null); a.server.schema = false;
    expect((await a.store.load())?.score).toBe(10);
    const b = setup(save(100, 11), null); b.server.anonymous = false;
    expect((await b.store.load())?.score).toBe(11);
    await b.store.save(save(150, 12));
    expect(b.mem.peek()?.score).toBe(12);
  });
  it('n’attend pas un serveur trop lent pour lancer le jeu', async () => {
    const s = setup(save(100, 10), save(200, 99));
    const slow = new NetClient({ create: () => new Promise(() => { /* ne répond jamais */ }) });
    const store = new CloudGameStore(s.mem, slow, { loadTimeoutMs: 3000 });
    const p = store.load();
    await vi.advanceTimersByTimeAsync(3100);
    expect((await p)?.score).toBe(10);
  });
});

describe('CloudGameStore : écriture', () => {
  it('écrit en local tout de suite et en ligne au plus une fois toutes les 20 s', async () => {
    const { store, mem, server, seen } = setup(null, null);
    await store.load();
    await store.save(save(1_000_000, 1));
    await vi.advanceTimersByTimeAsync(0);
    expect(mem.peek()?.score).toBe(1);
    expect(server.count('upsert saves')).toBe(1);
    for (let i = 2; i <= 6; i++) { vi.advanceTimersByTime(2000); await store.save(save(Date.now(), i)); }
    expect(mem.peek()?.score).toBe(6);
    expect(mem.writes).toBe(6);
    expect(server.count('upsert saves')).toBe(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(server.count('upsert saves')).toBe(2);
    expect((server.tables.saves[0].data as GameSave).score).toBe(6);
    expect(store.dirty).toBe(false);
    expect(seen).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('flush() envoie à la demande, sans attendre les 20 s', async () => {
    const { store, server } = setup(null, null);
    await store.load();
    await store.save(save(1_000_000, 1));
    await vi.advanceTimersByTimeAsync(0);
    await store.save(save(1_000_500, 2));
    expect(await store.flush()).toBe(true);
    expect((server.tables.saves[0].data as GameSave).score).toBe(2);
  });
  it('réseau coupé : la progression locale est intacte et part en ligne au retour du réseau', async () => {
    const { store, mem, server, client } = setup(save(10, 1), null);
    await store.load();
    server.down = true;
    await store.save(save(Date.now(), 50));
    await vi.advanceTimersByTimeAsync(0);
    expect(mem.peek()?.score).toBe(50);
    expect(client.online).toBe(false);
    expect(store.dirty).toBe(true);
    expect(await store.flush()).toBe(false);
    server.down = false;
    await vi.advanceTimersByTimeAsync(10 * 60_000); // passé le délai avant nouvelle tentative
    await store.save(save(Date.now(), 60));
    await vi.advanceTimersByTimeAsync(0);
    expect(client.online).toBe(true);
    expect((server.tables.saves[0].data as GameSave).score).toBe(60);
  });
  it('n’écrase jamais une sauvegarde en ligne plus récente', async () => {
    const { store, server } = setup(null, null);
    server.down = true;
    await store.load(); // la sauvegarde en ligne n'a pas pu être lue
    server.down = false;
    server.tables.saves.push({ id: server.userId, data: save(9_000_000, 999), saved_at: 9_000_000 });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await store.save(save(Date.now(), 5));
    await vi.advanceTimersByTimeAsync(0);
    expect((server.tables.saves[0].data as GameSave).score).toBe(999);
    expect(server.count('upsert saves')).toBe(0);
  });
});
