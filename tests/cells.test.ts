import { describe, expect, it } from 'vitest';
import { cell, cellAt, cellBounds, cellCenter, dist, inCell, type LngLat } from '../src/core/geo';
import { cellPaths, generateCell, PATHS } from '../src/world/cells';
import { shelterSite } from '../src/world/site';
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
  it('expose les rues praticables de la case : coupées aux bords, allégées, bornées, reproductibles', () => {
    const b = cellBounds(c), lat = mid[1];
    // Une rue dense qui traverse toute la case et en sort des deux côtés (un point tous les 2 m environ).
    const long: LngLat[] = Array.from({ length: 400 }, (_, i) => [b.w - 0.001 + (i / 399) * (b.e - b.w + 0.002), lat] as LngLat);
    const raw: RawTile = { pois: [], places: [], roads: [
      road(long), road([[mid[0], lat + 0.0005], [mid[0] + 0.00005, lat + 0.0005]]), // trop courte
      road([[mid[0], lat - 0.0005], [mid[0] + 0.001, lat - 0.0005]], 'motorway'),   // pas praticable
      ...Array.from({ length: 12 }, (_, k) => road([[mid[0] - 0.001, lat + 0.0001 * (k + 2)], [mid[0] + 0.001, lat + 0.0001 * (k + 2)]])),
    ] };
    const paths = cellPaths(c, raw.roads);
    expect(paths).toEqual(cellPaths(c, raw.roads));
    expect(generateCell(c, raw, '2026-11-11').paths).toEqual(paths);
    expect(paths).toHaveLength(PATHS.max);
    for (const p of paths) {
      expect(p.length).toBeGreaterThanOrEqual(2); expect(p.length).toBeLessThanOrEqual(PATHS.maxPoints);
      for (const q of p) expect(inCell(c, q)).toBe(true);
    }
    // La plus longue d'abord : la traversée, d'environ la largeur de la case.
    const len = (p: LngLat[]) => p.slice(1).reduce((a, q, i) => a + dist(p[i], q), 0);
    expect(len(paths[0])).toBeGreaterThan(330);
    expect(Math.abs(paths[0][0][1] - lat)).toBeLessThan(1e-9);
  });
  it('ne pose jamais le bâtiment d’un abri sur la chaussée : implantation décalée, façade vers la rue', () => {
    // Distance d'un point au tracé le plus proche (mètres), par échantillonnage fin des segments.
    const toRoads = (p: LngLat, roads: LngLat[][]) => Math.min(...roads.flatMap(r => r.slice(1).flatMap((b, i) =>
      Array.from({ length: 41 }, (_, k) => dist(p, [r[i][0] + (b[0] - r[i][0]) * k / 40, r[i][1] + (b[1] - r[i][1]) * k / 40])))));
    // Abri de secours posé sur un point de rue (carrefour de deux rues en croix).
    const raw = base();
    raw.roads.push(road([[mid[0], mid[1] - 0.001], mid, [mid[0], mid[1] + 0.001]]), road([[mid[0] - 0.001, mid[1]], mid]));
    const s = allShelters(raw)[0];
    const roads = raw.roads.map(r => r.pts);
    expect(s.kind).toBe('carrefour');
    expect(toRoads(s.at, roads)).toBeLessThan(0.5);
    expect(s.site).toBeDefined();
    expect(toRoads(s.site!, roads)).toBeGreaterThan(9);
    expect(dist(s.at, s.site!)).toBeLessThan(30);
    expect(allShelters(raw)[0]).toEqual(s);
    // Rue seule, est-ouest : recul de 15 m, perpendiculaire, façade plein nord ou plein sud.
    const rue: LngLat[][] = [[[mid[0] - 0.002, mid[1]], [mid[0] + 0.002, mid[1]]]];
    const a = shelterSite(mid, rue)!;
    expect(Math.abs(dist(mid, a.site) - 15)).toBeLessThan(0.5);
    expect(Math.abs(a.site[0] - mid[0])).toBeLessThan(1e-6);
    expect(a.facing % 180).toBeCloseTo(0, 0);
    // Une seconde rue parallèle à 20 m au nord : l'abri part du côté sud, façade au nord.
    const b = shelterSite(mid, [...rue, [[mid[0] - 0.002, mid[1] + 20 / 111320], [mid[0] + 0.002, mid[1] + 20 / 111320]]])!;
    expect(b.site[1]).toBeLessThan(mid[1]); expect(b.facing).toBeCloseTo(0, 0);
    // Vrai lieu : à 30 m de la rue il ne bouge pas, à 3 m (ou 10 m : il mordrait sur la chaussée dessinée) il est reculé.
    const loin: LngLat = [mid[0], mid[1] + 30 / 111320], pres: LngLat = [mid[0], mid[1] + 3 / 111320];
    expect(shelterSite(loin, rue, true)!.site).toEqual(loin);
    expect(shelterSite(loin, rue, true)!.facing).toBeCloseTo(180, 0);
    expect(toRoads(shelterSite(pres, rue, true)!.site, rue)).toBeGreaterThan(11);
    expect(toRoads(shelterSite([mid[0], mid[1] + 10 / 111320], rue, true)!.site, rue)).toBeGreaterThan(11);
    expect(shelterSite(mid, [])).toBeNull();
  });
});
