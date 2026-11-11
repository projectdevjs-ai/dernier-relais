// Abri débordé : trois petits losanges ambre tournent au-dessus du bâtiment tant que le lot est proposé,
// et un anneau bat au sol. Rien d'autre : le détail est dans l'interface.
import * as THREE from 'three';
import type { JamView } from '../game/api';
import type { LngLat } from '../core/geo';
import type { FxKit } from './fx';
import { type Layer3D, TOP, WORLD } from './layer';

const ORBIT_Y = 38;
const ORBIT_R = 7;
const BASE_R = 27;

interface Item { id: string; at: LngLat; group: THREE.Group; gems: THREE.Mesh[]; pulse: THREE.Mesh }

export class Jams {
  private readonly items = new Map<string, Item>();
  private readonly seen = new Set<string>();
  constructor(private readonly scene: THREE.Scene, private readonly kit: FxKit, private readonly layer: Layer3D) {}

  get count(): number { return this.items.size; }

  sync(list: JamView[]): void {
    this.seen.clear();
    for (const j of list) {
      if (j.state !== 'proposé') continue;
      this.seen.add(j.id);
      if (this.items.has(j.id)) continue;
      const group = new THREE.Group();
      this.layer.toLocal(j.at, group.position);
      const pulse = new THREE.Mesh(this.kit.thinRing, this.kit.pulseAmber);
      pulse.position.y = 0.34; pulse.renderOrder = 8; pulse.layers.set(WORLD);
      group.add(pulse);
      const gems: THREE.Mesh[] = [];
      for (let i = 0; i < j.count; i++) {
        const g = new THREE.Mesh(this.kit.diamond, this.kit.solidAmber);
        g.scale.setScalar(1.25); g.layers.set(TOP);
        gems.push(g); group.add(g);
      }
      this.scene.add(group);
      this.items.set(j.id, { id: j.id, at: [j.at[0], j.at[1]], group, gems, pulse });
    }
    if (this.seen.size !== this.items.size) for (const [id, it] of this.items) if (!this.seen.has(id)) { it.group.removeFromParent(); this.items.delete(id); }
  }

  reposition(): void { for (const it of this.items.values()) this.layer.toLocal(it.at, it.group.position); }

  update(timeS: number): void {
    if (!this.items.size) return;
    const r = BASE_R * (1 + this.kit.phase * 0.35);
    for (const it of this.items.values()) {
      it.pulse.scale.set(r, 1, r);
      for (let i = 0; i < it.gems.length; i++) {
        const a = timeS * 0.9 + (i / it.gems.length) * Math.PI * 2;
        it.gems[i].position.set(Math.cos(a) * ORBIT_R, ORBIT_Y + Math.sin(timeS * 2 + i) * 0.5, Math.sin(a) * ORBIT_R);
        it.gems[i].rotation.y = timeS * 1.5 + i;
      }
    }
  }
}
