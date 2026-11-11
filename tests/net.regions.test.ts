// regionAt : villes connues (la plupart absentes de la liste de référence), et cohérence de la carte en tuiles.
import { describe, expect, it } from 'vitest';
import { REGIONS, franceMap, onMap, regionAt, regionName } from '../src/net/regions';

const CITIES: [string, number, number, string][] = [
  ['Paris', 2.3522, 48.8566, 'idf'], ['Les Essarts-le-Roi', 1.893, 48.7167, 'idf'], ['Fontainebleau', 2.7, 48.405, 'idf'],
  ['Lille', 3.0635, 50.6366, 'hdf'], ['Chantilly', 2.47, 49.19, 'hdf'], ['Le Touquet', 1.585, 50.52, 'hdf'],
  ['Rouen', 1.0993, 49.4432, 'nor'], ['Le Mont-Saint-Michel', -1.511, 48.636, 'nor'], ['Giverny', 1.53, 49.08, 'nor'], ['Honfleur', 0.233, 49.419, 'nor'],
  ['Strasbourg', 7.7521, 48.5734, 'ges'], ['Épernay', 3.955, 49.043, 'ges'], ['Nancy', 6.1844, 48.6921, 'ges'],
  ['Rennes', -1.6778, 48.1173, 'bre'], ['Locronan', -4.208, 48.099, 'bre'], ['Carnac', -3.078, 47.584, 'bre'],
  ['Nantes', -1.5536, 47.2184, 'pdl'], ['Bouguenais', -1.5761, 47.1822, 'pdl'], ['Pornic', -2.103, 47.115, 'pdl'], ['La Baule', -2.39, 47.286, 'pdl'],
  ['Orléans', 1.9093, 47.9029, 'cvl'], ['Beauce (Voves)', 1.6, 48.24, 'cvl'], ['Chambord', 1.517, 47.616, 'cvl'],
  ['Dijon', 5.0415, 47.322, 'bfc'], ['Vézelay', 3.746, 47.466, 'bfc'], ['Belfort', 6.863, 47.638, 'bfc'],
  ['Bordeaux', -0.5792, 44.8378, 'naq'], ['Landes', -0.7, 44.13, 'naq'], ['Biarritz', -1.559, 43.483, 'naq'], ['Limoges', 1.2611, 45.8336, 'naq'],
  ['Toulouse', 1.4442, 43.6047, 'occ'], ['Lourdes', -0.046, 43.095, 'occ'], ['Montpellier', 3.8767, 43.6108, 'occ'], ['Collioure', 3.083, 42.526, 'occ'],
  ['Lyon', 4.8357, 45.764, 'ara'], ['Chamonix', 6.869, 45.924, 'ara'], ['Clermont-Ferrand', 3.087, 45.7772, 'ara'],
  ['Marseille', 5.3744, 43.2951, 'pac'], ['Saint-Véran', 6.869, 44.7003, 'pac'], ['Aix-en-Provence', 5.4474, 43.5297, 'pac'], ['Nice', 7.262, 43.7102, 'pac'],
  ['Ajaccio', 8.7369, 41.9192, 'cor'], ['Bonifacio', 9.159, 41.387, 'cor'],
];

describe('regionAt', () => {
  it.each(CITIES)('%s', (_name, lng, lat, region) => { expect(regionAt(lng, lat)).toBe(region); });
  it('connaît les 13 régions métropolitaines et leur nom', () => {
    expect(REGIONS).toHaveLength(13);
    expect(new Set(REGIONS.map(r => r.id)).size).toBe(13);
    expect(regionName('pac')).toBe('Provence-Alpes-Côte d’Azur');
    expect(regionName('nulle-part')).toBe('Région inconnue');
    for (const r of REGIONS) expect(regionAt(r.seat[0], r.seat[1])).toBe(r.id);
  });
  it('renvoie toujours une région, même en mer ou à l’étranger', () => {
    expect(REGIONS.map(r => r.id)).toContain(regionAt(-10, 40));
    expect(REGIONS.map(r => r.id)).toContain(regionAt(13.4, 52.5));
  });
});

describe('carte en tuiles', () => {
  const map = franceMap();
  it('donne des tuiles à chaque région, en accord avec regionAt', () => {
    for (const r of REGIONS) { expect(map.byRegion[r.id].length).toBeGreaterThan(3); expect(map.borders[r.id]).toMatch(/^M/); }
    for (const t of map.tiles) expect(t.region).toBe(regionAt(t.at[0], t.at[1]));
    expect(map.tiles.length).toBeGreaterThan(300);
    expect(map.tiles.length).toBeLessThan(700);
  });
  it('allume les tuiles en partant du chef-lieu', () => {
    const idf = map.byRegion.idf[0];
    expect(Math.abs(idf.at[0] - 2.35)).toBeLessThan(0.5);
    expect(Math.abs(idf.at[1] - 48.86)).toBeLessThan(0.4);
  });
  it('le contour laisse la mer et les pays voisins hors de la carte', () => {
    expect(onMap(2.35, 48.86)).toBe(true);
    expect(onMap(9.1, 42.2)).toBe(true); // Corse
    expect(onMap(-3.5, 46.0)).toBe(false); // golfe de Gascogne
    expect(onMap(5.0, 42.6)).toBe(false); // Méditerranée
    expect(onMap(8.5, 47.4)).toBe(false); // Zurich
    expect(onMap(-0.1, 51.5)).toBe(false); // Londres
  });
});
