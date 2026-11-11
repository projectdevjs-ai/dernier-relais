// Les fronts de mauvais temps : un grand disque ardoise strié de pluie qui glisse sur la carte,
// bordé d'une paroi basse pour se lire de loin. Dessiné sous les zones dangereuses et les colis.
import * as THREE from 'three';
import type { FrontView } from '../game/api';
import type { LngLat } from '../core/geo';
import type { FxKit } from './fx';
import { type Layer3D, WORLD } from './layer';

interface Item { id: string; at: LngLat; group: THREE.Group; target: THREE.Vector3; r: number; placed: boolean }

export class Fronts {
  private readonly items = new Map<string, Item>();
  private readonly seen = new Set<string>();
  /** Vrai si le joueur est dans un front (la scène passe alors au temps d'orage). */
  inside = false;
  constructor(private readonly scene: THREE.Scene, private readonly kit: FxKit, private readonly layer: Layer3D) {}

  get count(): number { return this.items.size; }

  sync(list: FrontView[]): void {
    this.seen.clear();
    this.inside = false;
    for (const f of list) {
      this.seen.add(f.id);
      if (f.inside) this.inside = true;
      let it = this.items.get(f.id);
      if (!it) {
        const group = new THREE.Group();
        const disc = new THREE.Mesh(this.kit.disc, this.kit.discFront);
        disc.position.y = 0.18; disc.renderOrder = 4;
        const wall = new THREE.Mesh(this.kit.beam, this.kit.wallFront);
        wall.scale.set(0.99, 30, 0.99); wall.renderOrder = 4;
        group.add(disc, wall);
        group.traverse(o => o.layers.set(WORLD));
        this.scene.add(group);
        it = { id: f.id, at: [f.at[0], f.at[1]], group, target: new THREE.Vector3(), r: 0, placed: false };
        this.items.set(f.id, it);
      }
      it.at[0] = f.at[0]; it.at[1] = f.at[1];
      this.layer.toLocal(f.at, it.target);
      if (!it.placed) { it.group.position.copy(it.target); it.placed = true; }
      // Le groupe est à l'échelle du rayon (à plat) ; la paroi garde sa hauteur de 30 m.
      if (it.r !== f.radiusM) { it.r = f.radiusM; it.group.scale.set(f.radiusM, 1, f.radiusM); }
    }
    if (this.seen.size !== this.items.size) for (const [id, it] of this.items) if (!this.seen.has(id)) { it.group.removeFromParent(); this.items.delete(id); }
  }

  reposition(): void {
    for (const it of this.items.values()) { this.layer.toLocal(it.at, it.target); it.group.position.copy(it.target); }
  }

  /** Le front glisse sans à-coup entre deux positions données par le jeu. */
  update(dt: number): void {
    if (!this.items.size) return;
    const k = 1 - Math.exp(-dt * 2);
    for (const it of this.items.values()) {
      const p = it.group.position;
      p.x += (it.target.x - p.x) * k; p.z += (it.target.z - p.z) * k;
    }
  }
}
