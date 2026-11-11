// Les caches repérées : un petit coffre au sol, anneau doré et halo flottant.
// Plus discrètes qu'un colis (faisceau court, pas de losange) : ce sont des trouvailles, pas des objectifs.
import * as THREE from 'three';
import type { CacheView } from '../game/api';
import type { LngLat } from '../core/geo';
import { disposeInstance, type Instance, setLayer, spawn } from './assets';
import type { FxKit } from './fx';
import { type Layer3D, TOP, WORLD } from './layer';

const HEIGHT = 3.6;
const RING = 4.2;
export const CACHE_TOP = 9;

interface Item { id: string; at: LngLat; group: THREE.Group; model: Instance | null; halo: THREE.Mesh; pulse: THREE.Mesh; inRange: boolean; alive: boolean; seed: number }

export class Caches {
  private readonly items = new Map<string, Item>();
  private readonly seen = new Set<string>();
  constructor(private readonly scene: THREE.Scene, private readonly kit: FxKit, private readonly layer: Layer3D) {}

  get all(): IterableIterator<Item> { return this.items.values(); }
  get count(): number { return this.items.size; }

  sync(list: CacheView[]): void {
    this.seen.clear();
    for (const c of list) {
      this.seen.add(c.id);
      const it = this.items.get(c.id) ?? this.create(c);
      if (it.inRange !== c.inRange) { it.inRange = c.inRange; it.pulse.visible = c.inRange; }
    }
    if (this.seen.size !== this.items.size) for (const it of [...this.items.values()]) if (!this.seen.has(it.id)) this.remove(it);
  }

  private create(c: CacheView): Item {
    const kit = this.kit, group = new THREE.Group();
    this.layer.toLocal(c.at, group.position);
    const shadow = new THREE.Mesh(kit.quad, kit.shadow);
    shadow.scale.set(RING * 2, 1, RING * 2); shadow.position.y = 0.1; shadow.renderOrder = 6;
    const glow = new THREE.Mesh(kit.quad, kit.glowGold);
    glow.scale.set(RING * 4, 1, RING * 4); glow.position.y = 0.14; glow.renderOrder = 7;
    const ring = new THREE.Mesh(kit.thinRing, kit.ringGold);
    ring.scale.set(RING, 1, RING); ring.position.y = 0.3; ring.renderOrder = 8;
    const pulse = new THREE.Mesh(kit.thinRing, kit.pulseGold);
    pulse.position.y = 0.32; pulse.renderOrder = 8; pulse.visible = false;
    group.add(shadow, glow, ring, pulse);
    group.traverse(o => o.layers.set(WORLD));
    const beam = new THREE.Mesh(kit.beam, kit.beamGold);
    beam.scale.set(0.6, 24, 0.6);
    const halo = new THREE.Mesh(kit.ring, kit.ringGold);
    halo.scale.set(1.9, 1, 1.9); halo.position.y = CACHE_TOP - 1.5;
    setLayer(beam, TOP); setLayer(halo, TOP);
    group.add(beam, halo);
    this.scene.add(group);
    let seed = 0;
    for (let i = 0; i < c.id.length; i++) seed = (seed * 31 + c.id.charCodeAt(i)) % 628;
    const it: Item = { id: c.id, at: [c.at[0], c.at[1]], group, model: null, halo, pulse, inRange: false, alive: true, seed: seed / 100 };
    this.items.set(c.id, it);
    void spawn('cache', 'caisse', { height: HEIGHT, maxWidth: 5 }).then(inst => {
      if (!it.alive) { disposeInstance(inst); return; }
      it.model = inst;
      inst.root.rotation.y = it.seed;
      setLayer(inst.root, TOP);
      group.add(inst.root);
    });
    return it;
  }

  private remove(it: Item): void {
    it.alive = false;
    disposeInstance(it.model);
    it.group.removeFromParent();
    this.items.delete(it.id);
  }

  reposition(): void { for (const it of this.items.values()) this.layer.toLocal(it.at, it.group.position); }

  update(timeS: number): void {
    if (!this.items.size) return;
    const phase = this.kit.phase;
    for (const it of this.items.values()) {
      it.halo.position.y = CACHE_TOP - 1.5 + Math.sin(timeS * 2 + it.seed) * 0.5;
      if (it.inRange) { const r = RING * (1 + phase * 1.6); it.pulse.scale.set(r, 1, r); }
    }
  }
}
