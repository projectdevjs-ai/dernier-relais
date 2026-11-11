// Le monde : charge les cases autour du joueur au fil de la marche. Aucun point de départ fixe.
import { type Cell, cellAt, cellsAround, dataTileOf } from '../core/geo';
import { generateCell } from './cells';
import { loadTile } from './tiles';
import type { CellContent } from './types';

export const today = () => new Date().toISOString().slice(0, 10);

export class World {
  private cells = new Map<string, CellContent>();
  private pending = new Map<string, Promise<void>>();
  private day = today();
  constructor(private onChange: () => void, private radius = 2) {}

  /** À appeler à chaque nouvelle position. */
  async moveTo(lng: number, lat: number): Promise<void> {
    if (this.day !== today()) { this.day = today(); this.cells.clear(); }
    const here = cellAt(lng, lat);
    await Promise.all(cellsAround(here, this.radius).map(c => this.ensure(c)));
    // On garde en mémoire une zone un peu plus large que la zone visible.
    const keep = new Set(cellsAround(here, this.radius + 2).map(c => c.id));
    for (const id of this.cells.keys()) if (!keep.has(id)) this.cells.delete(id);
  }
  private ensure(c: Cell): Promise<void> {
    if (this.cells.has(c.id)) return Promise.resolve();
    let p = this.pending.get(c.id);
    if (!p) {
      const t = dataTileOf(c), day = this.day;
      p = loadTile(t.z, t.x, t.y)
        .then(raw => { this.cells.set(c.id, generateCell(c, raw, day)); this.onChange(); })
        .finally(() => this.pending.delete(c.id));
      this.pending.set(c.id, p);
    }
    return p;
  }
  loaded(): CellContent[] { return [...this.cells.values()]; }
}
