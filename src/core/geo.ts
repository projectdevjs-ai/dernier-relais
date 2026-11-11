// Géométrie du monde : la France est découpée en cases fixes (tuiles Web Mercator de niveau 16,
// environ 400 m de côté). Tout le contenu du jeu se calcule à partir de l'identifiant d'une case.

export const CELL_Z = 16;
export const DATA_Z = 14; // niveau des tuiles de données OpenFreeMap (une tuile = 16 cases)

export type LngLat = [number, number];
export interface Cell { x: number; y: number; id: string }

export function tileXY(lng: number, lat: number, z: number): [number, number] {
  const n = 2 ** z, r = (lat * Math.PI) / 180;
  return [((lng + 180) / 360) * n, ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n];
}
export function tileLngLat(x: number, y: number, z: number): LngLat {
  const n = 2 ** z;
  return [(x / n) * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI];
}
export function cellAt(lng: number, lat: number): Cell {
  const [fx, fy] = tileXY(lng, lat, CELL_Z);
  return cell(Math.floor(fx), Math.floor(fy));
}
export function cell(x: number, y: number): Cell { return { x, y, id: `${x}/${y}` }; }
export function cellBounds(c: Cell): { w: number; s: number; e: number; n: number } {
  const [w, n] = tileLngLat(c.x, c.y, CELL_Z), [e, s] = tileLngLat(c.x + 1, c.y + 1, CELL_Z);
  return { w, s, e, n };
}
export function cellCenter(c: Cell): LngLat { return tileLngLat(c.x + 0.5, c.y + 0.5, CELL_Z); }
export function inCell(c: Cell, p: LngLat): boolean {
  const [fx, fy] = tileXY(p[0], p[1], CELL_Z);
  return Math.floor(fx) === c.x && Math.floor(fy) === c.y;
}
export function cellsAround(c: Cell, r: number): Cell[] {
  const out: Cell[] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) out.push(cell(c.x + dx, c.y + dy));
  return out;
}
/** Tuile de données qui contient la case. */
export function dataTileOf(c: Cell): { z: number; x: number; y: number } {
  const s = CELL_Z - DATA_Z;
  return { z: DATA_Z, x: c.x >> s, y: c.y >> s };
}
/** Distance en mètres. */
export function dist(a: LngLat, b: LngLat): number {
  const R = 6371000, k = Math.PI / 180;
  const dLat = (b[1] - a[1]) * k, dLng = (b[0] - a[0]) * k;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * k) * Math.cos(b[1] * k) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Hasard reproductible : même graine, même résultat, sur tous les téléphones.
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function rng(seed: string): () => number {
  let a = hash(seed) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
