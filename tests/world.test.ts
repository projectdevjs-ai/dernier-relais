// Le monde chargé autour du joueur : après un grand saut, les cases quittées sont retirées et le jeu est prévenu.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cellAt } from '../src/core/geo';
import { World } from '../src/world/world';

afterEach(() => { vi.unstubAllGlobals(); });

describe('monde', () => {
  it('retire les cases lointaines avant de charger les nouvelles, et prévient le jeu à chaque changement', async () => {
    // Carte vide (réponse 204) : pas de réseau, des cases sans rue ni abri.
    vi.stubGlobal('fetch', async (url: string) => (String(url).endsWith('/planet')
      ? { ok: true, status: 200, json: async () => ({ tiles: ['https://exemple.invalid/{z}/{x}/{y}.pbf'] }) }
      : { ok: true, status: 204, arrayBuffer: async () => new ArrayBuffer(0) }));
    const seen: string[][] = [];
    const w: World = new World(() => seen.push(w.loaded().map(c => c.id)));
    await w.moveTo(-1.5761, 47.1822);
    const nantes = cellAt(-1.5761, 47.1822).id;
    expect(w.loaded()).toHaveLength(25);
    expect(w.loaded().map(c => c.id)).toContain(nantes);
    const before = seen.length;
    await w.moveTo(2.347, 48.8583);
    const paris = cellAt(2.347, 48.8583).id;
    expect(w.loaded()).toHaveLength(25);
    expect(w.loaded().map(c => c.id)).toContain(paris);
    expect(w.loaded().map(c => c.id)).not.toContain(nantes);
    // Dès le premier avertissement après le saut, plus aucune case de l'endroit quitté.
    expect(seen.length).toBeGreaterThan(before);
    for (const ids of seen.slice(before)) expect(ids).not.toContain(nantes);
    // Un petit déplacement garde les cases voisines déjà chargées.
    await w.moveTo(2.353, 48.8583);
    expect(w.loaded().map(c => c.id)).toContain(paris);
  });
});
