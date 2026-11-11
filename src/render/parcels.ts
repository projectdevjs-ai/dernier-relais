// Les colis révélés par le scanner : caisse du bon type posée au sol, agrandie,
// avec un repère lumineux ambre. Ceux qui sont à portée de ramassage pulsent.
import * as THREE from 'three';
import type { CrateKind, OrderView } from '../game/api';
import type { LngLat } from '../core/geo';
import { disposeInstance, type Instance, setLayer, spawn } from './assets';
import type { FxKit } from './fx';
import { type Layer3D, TOP, WORLD } from './layer';
import { CRATE_MODEL } from './porter';

const CRATE_HEIGHT = 4;
const CRATE_WIDTH = 5;
const RING = 5.4;
export const PARCEL_TOP = 11;

interface Item {
  id: string;
  at: LngLat;
  crate: CrateKind;
  group: THREE.Group;
  model: Instance | null;
  holder: THREE.Group;
  gem: THREE.Mesh;
  pulse: THREE.Mesh;
  ring: THREE.Mesh;
  inRange: boolean;
  alive: boolean;
  seed: number;
}

export class Parcels {
  private readonly items = new Map<string, Item>();
  private readonly seen = new Set<string>();

  constructor(private readonly scene: THREE.Scene, private readonly kit: FxKit, private readonly layer: Layer3D) {}

  get all(): IterableIterator<Item> { return this.items.values(); }
  get count(): number { return this.items.size; }

  sync(orders: OrderView[]): void {
    this.seen.clear();
    for (const o of orders) {
      if (o.state !== 'révélé') continue;
      this.seen.add(o.id);
      let it = this.items.get(o.id);
      if (it && it.crate !== o.crate) { this.remove(it); it = undefined; }
      if (!it) it = this.create(o);
      if (it.at[0] !== o.at[0] || it.at[1] !== o.at[1]) { it.at = [o.at[0], o.at[1]]; this.layer.toLocal(it.at, it.group.position); }
      if (it.inRange !== o.inRange) {
        it.inRange = o.inRange;
        it.pulse.visible = o.inRange;
        if (!o.inRange) { it.holder.scale.setScalar(1); it.ring.scale.set(RING, 1, RING); }
      }
    }
    for (const it of [...this.items.values()]) if (!this.seen.has(it.id)) this.remove(it);
  }

  private create(o: OrderView): Item {
    const kit = this.kit;
    const group = new THREE.Group();
    this.layer.toLocal(o.at, group.position);
    const shadow = new THREE.Mesh(kit.quad, kit.shadow);
    shadow.scale.set(CRATE_WIDTH * 1.9, 1, CRATE_WIDTH * 1.9); shadow.position.y = 0.1; shadow.renderOrder = 6;
    const glow = new THREE.Mesh(kit.quad, kit.glowAmber);
    glow.scale.set(RING * 4.2, 1, RING * 4.2); glow.position.y = 0.14; glow.renderOrder = 7;
    const ring = new THREE.Mesh(kit.ring, kit.ringAmber);
    ring.scale.set(RING, 1, RING); ring.position.y = 0.3; ring.renderOrder = 8;
    const pulse = new THREE.Mesh(kit.thinRing, kit.pulseAmber);
    pulse.position.y = 0.32; pulse.renderOrder = 8; pulse.visible = false;
    const holder = new THREE.Group();
    group.add(shadow, glow, ring, pulse, holder);
    group.traverse(c => c.layers.set(WORLD));
    // Repère visible par-dessus les immeubles : fin faisceau et losange flottant.
    const beam = new THREE.Mesh(kit.beam, kit.beamAmber);
    beam.scale.set(0.8, 46, 0.8);
    const gem = new THREE.Mesh(kit.diamond, kit.solidAmber);
    gem.scale.setScalar(1.5); gem.position.y = PARCEL_TOP - 1.6;
    setLayer(beam, TOP); setLayer(gem, TOP);
    group.add(beam, gem);
    this.scene.add(group);

    let seed = 0;
    for (let i = 0; i < o.id.length; i++) seed = (seed * 31 + o.id.charCodeAt(i)) % 628;
    const it: Item = { id: o.id, at: [o.at[0], o.at[1]], crate: o.crate, group, model: null, holder, gem, pulse, ring, inRange: false, alive: true, seed: seed / 100 };
    this.items.set(o.id, it);
    void spawn(CRATE_MODEL[o.crate], 'caisse', { height: CRATE_HEIGHT, maxWidth: CRATE_WIDTH }).then(inst => {
      if (!it.alive) { disposeInstance(inst); return; }
      it.model = inst;
      inst.root.rotation.y = it.seed;
      // Par-dessus les immeubles : un colis révélé doit toujours se voir.
      setLayer(inst.root, TOP);
      holder.add(inst.root);
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
    const phase = this.kit.phase;
    for (const it of this.items.values()) {
      it.gem.position.y = PARCEL_TOP - 1.6 + Math.sin(timeS * 2.4 + it.seed) * 0.6;
      it.gem.rotation.y = timeS * 1.6 + it.seed;
      if (it.inRange) {
        const beat = 1 + 0.07 * Math.sin(timeS * 6);
        it.holder.scale.setScalar(beat);
        const r = RING * (1 + phase * 1.5);
        it.pulse.scale.set(r, 1, r);
        const rr = RING * (1 + 0.06 * Math.sin(timeS * 6));
        it.ring.scale.set(rr, 1, rr);
      }
    }
  }
}
