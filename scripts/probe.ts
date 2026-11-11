// Contrôle sur données réelles : que génère le monde autour de positions variées en France ?
import { cellAt, cellsAround, dataTileOf, dist, type LngLat } from '../src/core/geo';
import { generateCell } from '../src/world/cells';
import { loadTile } from '../src/world/tiles';

const PLACES: [string, number, number][] = [
  ['Bouguenais (rue Jean Mermoz)', 47.1822, -1.5761],
  ['Paris, Châtelet', 48.8583, 2.3470],
  ['Lille, Grand-Place', 50.6366, 3.0635],
  ['Marseille, Vieux-Port', 43.2951, 5.3744],
  ['Les Essarts-le-Roi (bourg)', 48.7167, 1.8930],
  ['Village : Saint-Véran (Hautes-Alpes)', 44.7003, 6.8690],
  ['Village : Locronan (Finistère)', 48.0990, -4.2080],
  ['Campagne : Beauce, près de Voves', 48.2400, 1.6000],
  ['Forêt : Landes, près de Sabres', 44.1300, -0.7000],
  ['Littoral : Pornic', 47.1150, -2.1030],
];
const R = 2; // 5 x 5 cases, environ 2 km de côté
for (const [name, lat, lng] of PLACES) {
  const here = cellAt(lng, lat), me: LngLat = [lng, lat];
  const cells = await Promise.all(cellsAround(here, R).map(async c => {
    const t = dataTileOf(c); return generateCell(c, await loadTile(t.z, t.x, t.y), '2026-11-11');
  }));
  const sh = cells.flatMap(c => c.shelters), pa = cells.flatMap(c => c.parcels);
  const near = sh.length ? Math.round(Math.min(...sh.map(s => dist(s.at, me)))) : -1;
  const kinds: Record<string, number> = {};
  for (const s of sh) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;
  console.log(`${name.padEnd(38)} abris ${String(sh.length).padStart(2)} (lieux ${sh.filter(s => s.source === 'lieu').length}, secours ${sh.filter(s => s.source === 'secours').length})  plus proche ${String(near).padStart(4)} m  colis ${String(pa.length).padStart(2)}  cases sans rue ${cells.filter(c => !c.roads).length}/25`);
  console.log('   ', Object.entries(kinds).map(([k, n]) => `${k}:${n}`).join(' '), '|', sh.slice(0, 4).map(s => s.name).join(' · '));
}
