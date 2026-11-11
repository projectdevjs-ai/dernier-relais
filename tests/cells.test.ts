import { describe, expect, it } from 'vitest';
import { cell, cellAt, cellBounds, cellCenter, dist, inCell, type LngLat } from '../src/core/geo';
import { generateCell } from '../src/world/cells';
import type { RawTile } from '../src/world/types';

const c = cellAt(-1.5761, 47.1822);
const mid = cellCenter(c);
const road = (pts: LngLat[], cls = 'minor') => ({ cls, pts });
const base = (): RawTile => ({ pois: [], places: [], roads: [road([mid, [mid[0] + 0.0005, mid[1]], [mid[0] + 0.001, mid[1] + 0.0005]])] });
const block = [cell(c.x & ~1, c.y & ~1), cell((c.x & ~1) + 1, c.y & ~1), cell(c.x & ~1, (c.y & ~1) + 1), cell((c.x & ~1) + 1, (c.y & ~1) + 1)];
const allShelters = (raw: RawTile) => block.flatMap(k => generateCell(k, raw, '2026-11-11').shelters);

describe('cases', () => {
  it('une case mesure environ 400 m en France', () => {
    const b = cellBounds(c);
    const w = dist([b.w, b.s], [b.e, b.s]);
    expect(w).toBeGreaterThan(350); expect(w).toBeLessThan(450);
    expect(inCell(c, mid)).toBe(true);
  });
  it('donne le même résultat à chaque calcul', () => {
    const raw = base();
    raw.pois.push({ name: 'Mairie', cls: 'town_hall', sub: 'townhall', at: mid });
    expect(generateCell(c, raw, '2026-11-11')).toEqual(generateCell(c, raw, '2026-11-11'));
  });
  it('place un seul abri par bloc, sur un vrai lieu quand il y en a', () => {
    const raw = base();
    raw.pois.push({ name: 'Mairie', cls: 'town_hall', sub: 'townhall', at: mid }, { name: 'Boulangerie Paul', cls: 'bakery', sub: 'bakery', at: [mid[0] + 0.0004, mid[1]] });
    const s = allShelters(raw);
    expect(s).toHaveLength(1); expect(s[0].source).toBe('lieu');
  });
  it('ignore les lieux sans nom ou sans rapport', () => {
    const raw = base();
    raw.pois.push({ name: '', cls: 'bakery', sub: 'bakery', at: mid }, { name: 'Banc', cls: 'bench', sub: 'bench', at: mid });
    expect(allShelters(raw)[0].source).toBe('secours');
  });
  it('ne laisse jamais un bloc avec des rues sans abri', () => {
    const s = allShelters(base());
    expect(s).toHaveLength(1); expect(s[0].kind).toBe('carrefour');
  });
  it('ne crée rien là où il n’y a aucune rue', () => {
    const r = generateCell(c, { pois: [], places: [], roads: [] }, '2026-11-11');
    expect(r.shelters).toHaveLength(0); expect(r.parcels).toHaveLength(0);
  });
  it('pose les colis sur des rues praticables et les renouvelle chaque jour', () => {
    const raw = base();
    raw.roads.push(road([[mid[0], mid[1] + 0.001]], 'motorway'));
    const pts = raw.roads[0].pts.map(p => p.join());
    const a = generateCell(c, raw, '2026-11-11').parcels, b = generateCell(c, raw, '2026-11-12').parcels;
    expect(a.length).toBeGreaterThan(0);
    for (const p of a) expect(pts).toContain(p.at.join());
    expect(a.map(p => p.id)).not.toEqual(b.map(p => p.id));
  });
});
