// Génération d'une case. Fonction pure : mêmes données, même résultat, pour tous les joueurs.
import { CELL_Z, type Cell, type LngLat, cell, dist, hash, inCell, rng, tileLngLat } from '../core/geo';
import type { CellContent, ParcelSpot, RawTile, Shelter, ShelterKind } from './types';

/** Type de lieu de la carte -> type d'abri. L'ordre donne la priorité quand une case a plusieurs lieux. */
const KINDS: [ShelterKind, RegExp][] = [
  ['mairie', /^(town_hall|townhall|community_centre|courthouse)$/],
  ['savoir', /^(library|school|college|university|museum|arts_centre|theatre|cinema)$/],
  ['soin', /^(pharmacy|hospital|doctors|clinic|dentist|veterinary)$/],
  ['poste', /^(post|post_office|fire_station|police)$/],
  ['culte', /^(place_of_worship)$/],
  ['vivres', /^(bakery|grocery|supermarket|convenience|butcher|greengrocer|marketplace|cafe|restaurant|bar|pub|fast_food)$/],
  ['nature', /^(park|garden|playground|pitch|stadium|sports_centre|campsite|picnic_site|attraction|viewpoint)$/],
  ['halte', /^(railway|bus|station|halt|tram_stop|bus_stop|bus_station|fuel|lodging|hotel)$/],
];
const WALKABLE = /^(primary|secondary|tertiary|minor|service|track|path|pedestrian|residential|living_street|unclassified)$/;
/** Un abri par bloc de 2 x 2 cases (environ 800 m) : assez proche à pied, assez rare pour compter. */
const blockOf = (c: Cell) => ({ x: c.x & ~1, y: c.y & ~1 });
const inBlock = (c: Cell, p: LngLat) => {
  const b = blockOf(c);
  return [cell(b.x, b.y), cell(b.x + 1, b.y), cell(b.x, b.y + 1), cell(b.x + 1, b.y + 1)].some(k => inCell(k, p));
};

function kindOf(p: { cls: string; sub: string }): [ShelterKind, number] | null {
  for (let i = 0; i < KINDS.length; i++) if (KINDS[i][1].test(p.sub) || KINDS[i][1].test(p.cls)) return [KINDS[i][0], i];
  return null;
}
const sid = (block: string, name: string, at: LngLat) => `${block}:${hash(name + at[0].toFixed(5) + at[1].toFixed(5)).toString(36)}`;

function nearestRoadPoint(roads: RawTile['roads'], target: LngLat): LngLat | null {
  let best: LngLat | null = null, bd = Infinity;
  for (const r of roads) for (const p of r.pts) { const d = dist(p, target); if (d < bd) { bd = d; best = p; } }
  return best;
}

export function generateCell(c: Cell, raw: RawTile, day: string): CellContent {
  const roads = raw.roads
    .filter(r => WALKABLE.test(r.cls))
    .map(r => ({ cls: r.cls, pts: r.pts.filter(p => inCell(c, p)) }))
    .filter(r => r.pts.length > 0);

  // 1. L'abri du bloc : un vrai lieu nommé, tiré au sort de façon reproductible parmi ceux du bloc.
  const b = blockOf(c), blockId = `${b.x}/${b.y}`;
  const cands = raw.pois
    .filter(p => p.name && inBlock(c, p.at))
    .map(p => ({ p, k: kindOf(p) }))
    .filter((x): x is { p: RawTile['pois'][number]; k: [ShelterKind, number] } => x.k !== null)
    .sort((x, y) => hash(blockId + x.p.name) - hash(blockId + y.p.name) || x.p.at[0] - y.p.at[0]);
  let pick: Shelter | null = null;
  if (cands.length) {
    const { p, k } = cands[0];
    pick = { id: sid(blockId, p.name, p.at), cell: c.id, name: p.name, kind: k[0], at: p.at, source: 'lieu' };
  } else {
    // 2. Règles de secours : un hameau nommé du bloc, sinon le point de rue le plus proche du centre du bloc.
    const place = raw.places.filter(p => p.name && inBlock(c, p.at)).sort((x, y) => hash(x.name) - hash(y.name))[0];
    if (place) pick = { id: sid(blockId, place.name, place.at), cell: c.id, name: `Relais de ${place.name}`, kind: 'hameau', at: place.at, source: 'secours' };
    else {
      const blockRoads = raw.roads.filter(r => WALKABLE.test(r.cls)).map(r => ({ cls: r.cls, pts: r.pts.filter(q => inBlock(c, q)) }));
      const at = nearestRoadPoint(blockRoads, tileLngLat(b.x + 1, b.y + 1, CELL_Z));
      if (at) pick = { id: sid(blockId, 'carrefour', at), cell: c.id, name: 'Relais du carrefour', kind: 'carrefour', at, source: 'secours' };
    }
  }
  // Chaque case du bloc fait le même calcul ; seule celle qui contient l'abri l'affiche.
  const shelters: Shelter[] = pick && inCell(c, pick.at) ? [pick] : [];

  // 3. Emplacements de colis : toujours sur une rue ou un chemin, renouvelés chaque jour.
  const parcels: ParcelSpot[] = [];
  const pts = roads.flatMap(r => r.pts);
  if (pts.length) {
    const rand = rng(`${c.id}|${day}`);
    const want = Math.min(3, pts.length);
    const used = new Set<number>();
    for (let i = 0; i < want * 4 && parcels.length < want; i++) {
      const j = Math.floor(rand() * pts.length);
      if (used.has(j) || shelters.some(s => dist(s.at, pts[j]) < 40) || parcels.some(q => dist(q.at, pts[j]) < 60)) continue;
      used.add(j);
      parcels.push({ id: `${c.id}|${day}|${j}`, cell: c.id, at: pts[j] });
    }
  }
  return { id: c.id, shelters, parcels, roads: roads.length };
}
