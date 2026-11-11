import { afterEach, describe, expect, it, vi } from 'vitest';
import { type GameSave, LocalGameStore, MemoryGameStore, SAVE_KEY, emptyGameSave, parseGameSave } from '../src/game/save';

const sample = (): GameSave => ({
  ...emptyGameSave('2026-11-11'), savedAt: 123, level: 3, xp: 40, skillPoints: 2, score: 900, deliveries: 7, distanceM: 4321.5, stamina: 0.4,
  skills: { sac: 2 }, shelters: { A: { points: 320, deliveries: 4 } }, discovered: ['A'], visited: ['1/2', '1/3'],
  orders: [{ id: 'o1', cell: '1/2', name: 'Outils', rareName: null, crate: 'bois', weightKg: 9, fragile: false, at: [1, 2], destId: 'A', destName: 'Abri A', destAt: [1.1, 2.1], deadlineMin: 12, baseReward: 80, state: 'porté', condition: 0.9, pickedAt: 1000 }],
  done: ['o0'], contracts: [{ id: 'j:2026-11-11:livrer', progress: 1, claimed: false }], last: [1, 2],
});

function fakeStorage() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('sauvegarde', () => {
  it('se relit à l’identique', () => {
    const s = sample();
    expect(parseGameSave(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(emptyGameSave().version).toBe(1);
  });
  it('refuse ce qui n’est pas une sauvegarde de cette version', () => {
    for (const bad of [null, undefined, 3, 'x', [], {}, { version: 2 }, { ...sample(), version: 0 }]) expect(parseGameSave(bad)).toBeNull();
  });
  it('corrige les valeurs douteuses au lieu de planter', () => {
    const s = parseGameSave({
      version: 1, level: -4, xp: 'beaucoup', stamina: 7, score: Number.NaN, skills: { sac: 2.7, x: 'y' }, shelters: { A: 3, B: { points: -5 } },
      visited: ['1/2', 5, null], discovered: 'non', orders: [{ id: 'o1' }, 4, { ...sample().orders[0], condition: 9, crate: 'verre', state: 'révélé', pickedAt: null }, { ...sample().orders[0], state: 'caché' }],
      contracts: [{ id: 5 }, { id: 'c', progress: -1, claimed: 'oui' }], last: [1, 'x'],
    })!;
    expect(s).toMatchObject({ level: 1, xp: 0, stamina: 1, score: 0, skills: { sac: 2, x: 0 }, shelters: { B: { points: 0, deliveries: 0 } }, visited: ['1/2'], discovered: [], last: null, day: '' });
    expect(s.orders).toHaveLength(1);
    expect(s.orders[0]).toMatchObject({ condition: 1, crate: 'carton', state: 'révélé', pickedAt: null });
    expect(s.contracts).toEqual([{ id: 'c', progress: 0, claimed: false }]);
  });
});

describe('stockage en mémoire', () => {
  it('rend ce qu’on lui a confié et compte les écritures', async () => {
    const m = new MemoryGameStore();
    expect(await m.load()).toBeNull(); expect(m.peek()).toBeNull();
    const s = sample();
    await m.save(s);
    s.score = 0; // la sauvegarde ne doit pas dépendre de l'objet d'origine
    expect((await m.load())!.score).toBe(900);
    expect(m.writes).toBe(1);
    expect(await new MemoryGameStore(sample()).load()).toEqual(sample());
  });
});

describe('stockage du téléphone', () => {
  it('écrit et relit sous la clé « dernier-relais/jeu »', async () => {
    const ls = fakeStorage();
    vi.stubGlobal('localStorage', ls);
    const store = new LocalGameStore();
    expect(await store.load()).toBeNull();
    await store.save(sample());
    expect(SAVE_KEY).toBe('dernier-relais/jeu');
    expect([...ls.data.keys()]).toEqual(['dernier-relais/jeu']);
    expect(await store.load()).toEqual(sample());
  });
  it('ignore une sauvegarde illisible', async () => {
    const ls = fakeStorage();
    vi.stubGlobal('localStorage', ls);
    ls.data.set(SAVE_KEY, '{pas du json');
    expect(await new LocalGameStore().load()).toBeNull();
    ls.data.set(SAVE_KEY, JSON.stringify({ version: 99 }));
    expect(await new LocalGameStore().load()).toBeNull();
  });
  it('ne plante jamais quand le stockage est absent ou refuse', async () => {
    const store = new LocalGameStore();
    expect(await store.load()).toBeNull(); // pas de localStorage sous Node
    await expect(store.save(sample())).resolves.toBeUndefined();
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('interdit'); }, setItem: () => { throw new Error('plein'); } });
    expect(await store.load()).toBeNull();
    await expect(store.save(sample())).resolves.toBeUndefined();
  });
});
