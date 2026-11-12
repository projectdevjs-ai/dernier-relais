// Les colis révélés par le scanner : caisse du bon type posée au sol, agrandie,
// avec un repère lumineux ambre. Ceux qui sont à portée de ramassage pulsent.
// Colis spéciaux : repère doré à double losange, et leur propre modèle une fois identifiés.
// Colis perdus : repère bleu (la couleur du réseau).
import * as THREE from 'three';
import type { OrderView } from '../game/api';
import type { LngLat } from '../core/geo';
import { disposeInstance, type Instance, setLayer, spawn } from './assets';
import type { FxKit } from './fx';
import { type Layer3D, TOP, WORLD } from './layer';
import { CRATE_MODEL } from './porter';

const CRATE_HEIGHT = 4;
const CRATE_WIDTH = 5;
const RING = 5.4;
export const PARCEL_TOP = 11;

/** Modèle d'un colis : celui du colis spécial une fois identifié, sinon sa caisse. */
export function parcelModel(o: OrderView): string {
  return o.special?.known ? `spe_${o.special.kind}` : CRATE_MODEL[o.crate] ?? 'carton';
}
/** Apparence d'un colis au sol : change quand il est identifié. */
const lookOf = (o: OrderView): string => `${parcelModel(o)}|${o.special ? 'or' : o.lost ? 'bleu' : 'ambre'}`;

interface Item {
  id: string;
  at: LngLat;
  look: string;
  group: THREE.Group;
  model: Instance | null;
  holder: THREE.Group;
  gem: THREE.Mesh;
  /** Second losange des colis spéciaux. */
  gem2: THREE.Mesh | null;
  pulse: THREE.Mesh;
  ring: THREE.Mesh;
  inRange: boolean;
  alive: boolean;
  seed: number;
  /** Apparition (0 à 1) ; repart vers 0 quand le colis disparaît, puis il est retiré. */
  show: number;
  dying: boolean;
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
      if (it && it.look !== lookOf(o)) { this.remove(it); it = undefined; }
      if (it) it.dying = false;
      if (!it) it = this.create(o);
      if (it.at[0] !== o.at[0] || it.at[1] !== o.at[1]) { it.at = [o.at[0], o.at[1]]; this.layer.toLocal(it.at, it.group.position); }
      if (it.inRange !== o.inRange) {
        it.inRange = o.inRange;
        it.pulse.visible = o.inRange;
        if (!o.inRange) { it.holder.scale.setScalar(1); it.ring.scale.set(RING, 1, RING); }
      }
    }
    // Disparition en fondu : le colis rétrécit, puis est retiré par update().
    for (const it of this.items.values()) if (!this.seen.has(it.id)) it.dying = true;
  }

  private create(o: OrderView): Item {
    const kit = this.kit;
    const group = new THREE.Group();
    this.layer.toLocal(o.at, group.position);
    const shadow = new THREE.Mesh(kit.quad, kit.shadow);
    shadow.scale.set(CRATE_WIDTH * 1.9, 1, CRATE_WIDTH * 1.9); shadow.position.y = 0.1; shadow.renderOrder = 6;
    const gold = !!o.special, blue = !gold && !!o.lost;
    const glow = new THREE.Mesh(kit.quad, gold ? kit.glowGold : blue ? kit.glowBlue : kit.glowAmber);
    glow.scale.set(RING * 4.2, 1, RING * 4.2); glow.position.y = 0.14; glow.renderOrder = 7;
    const ring = new THREE.Mesh(kit.ring, gold ? kit.ringGold : blue ? kit.ringBlue : kit.ringAmber);
    ring.scale.set(RING, 1, RING); ring.position.y = 0.3; ring.renderOrder = 8;
    const pulse = new THREE.Mesh(kit.thinRing, gold ? kit.pulseGold : blue ? kit.pulseBlue : kit.pulseAmber);
    pulse.position.y = 0.32; pulse.renderOrder = 8; pulse.visible = false;
    const holder = new THREE.Group();
    group.add(shadow, glow, ring, pulse, holder);
    group.traverse(c => c.layers.set(WORLD));
    // Repère visible par-dessus les immeubles : fin faisceau et losange flottant.
    const beam = new THREE.Mesh(kit.beam, gold ? kit.beamGold : blue ? kit.beamBlue : kit.beamAmber);
    beam.scale.set(gold ? 0.95 : 0.8, gold ? 54 : 46, gold ? 0.95 : 0.8);
    const gem = new THREE.Mesh(kit.diamond, gold ? kit.solidGold : blue ? kit.solidBlue : kit.solidAmber);
    gem.scale.setScalar(1.5); gem.position.y = PARCEL_TOP - 1.6;
    setLayer(beam, TOP); setLayer(gem, TOP);
    group.add(beam, gem);
    let gem2: THREE.Mesh | null = null;
    if (gold) {
      gem2 = new THREE.Mesh(kit.diamond, kit.solidGold);
      gem2.scale.setScalar(0.8); gem2.position.y = PARCEL_TOP + 1.7;
      setLayer(gem2, TOP);
      group.add(gem2);
    }
    this.scene.add(group);

    let seed = 0;
    for (let i = 0; i < o.id.length; i++) seed = (seed * 31 + o.id.charCodeAt(i)) % 628;
    const it: Item = { id: o.id, at: [o.at[0], o.at[1]], look: lookOf(o), group, model: null, holder, gem, gem2, pulse, ring, inRange: false, alive: true, seed: seed / 100, show: 0, dying: false };
    group.scale.setScalar(0.001);
    this.items.set(o.id, it);
    void spawn(parcelModel(o), 'caisse', { height: o.special?.known ? CRATE_HEIGHT * 1.25 : CRATE_HEIGHT, maxWidth: CRATE_WIDTH * 1.1 }).then(inst => {
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

  update(timeS: number, dt: number): void {
    const phase = this.kit.phase;
    for (const it of this.items.values()) {
      if (it.dying || it.show < 1) {
        it.show = Math.min(1, Math.max(0, it.show + (it.dying ? -dt * 3.5 : dt * 2.6)));
        if (it.dying && it.show <= 0) { this.remove(it); continue; }
        // Léger dépassement à l'apparition, comme un objet qui se pose.
        const e = 1 - (1 - it.show) ** 3;
        it.group.scale.setScalar(Math.max(0.001, e * (1 + 0.12 * Math.sin(it.show * Math.PI))));
      }
      it.gem.position.y = PARCEL_TOP - 1.6 + Math.sin(timeS * 2.4 + it.seed) * 0.6;
      it.gem.rotation.y = timeS * 1.6 + it.seed;
      if (it.gem2) { it.gem2.position.y = PARCEL_TOP + 1.7 + Math.sin(timeS * 2.4 + it.seed + 1.2) * 0.6; it.gem2.rotation.y = -timeS * 2.2; }
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
