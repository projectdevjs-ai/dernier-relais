// Les rôdeurs : un voyageur qui marche (animation « walk »), plus petit et plus discret que le porteur.
// Le jeu donne sa position à chaque synchronisation ; ici on la lisse image par image.
import * as THREE from 'three';
import type { WandererView } from '../game/api';
import type { LngLat } from '../core/geo';
import { disposeInstance, type Instance, setLayer, spawn } from './assets';
import type { FxKit } from './fx';
import { type Layer3D, TOP, WORLD } from './layer';

export const WANDERER_HEIGHT = 10;
const RING = 5;

interface Item {
  id: string; at: LngLat; group: THREE.Group; model: Instance | null; mixer: THREE.AnimationMixer | null;
  walk: THREE.AnimationAction | null; idle: THREE.AnimationAction | null;
  ring: THREE.Mesh; pulse: THREE.Mesh; mark: THREE.Mesh;
  target: THREE.Vector3; heading: number; targetHeading: number;
  moving: boolean; met: boolean; inRange: boolean; alive: boolean; placed: boolean;
}

export class Wanderers {
  private readonly items = new Map<string, Item>();
  private readonly seen = new Set<string>();
  constructor(private readonly scene: THREE.Scene, private readonly kit: FxKit, private readonly layer: Layer3D) {}

  get all(): IterableIterator<Item> { return this.items.values(); }
  get count(): number { return this.items.size; }

  sync(list: WandererView[]): void {
    this.seen.clear();
    for (const w of list) {
      this.seen.add(w.id);
      const it = this.items.get(w.id) ?? this.create(w);
      it.at[0] = w.at[0]; it.at[1] = w.at[1];
      this.layer.toLocal(w.at, it.target);
      it.targetHeading = Math.PI - (w.headingDeg * Math.PI) / 180;
      if (!it.placed) { it.group.position.copy(it.target); it.heading = it.targetHeading; it.placed = true; }
      if (it.moving !== w.moving) { it.moving = w.moving; this.play(it); }
      if (it.met !== w.met) { it.met = w.met; it.ring.material = w.met ? this.kit.ringOff : this.kit.ringBlue; it.mark.visible = !w.met; }
      const near = w.inRange && !w.met;
      if (it.inRange !== near) { it.inRange = near; it.pulse.visible = near; }
    }
    if (this.seen.size !== this.items.size) for (const it of [...this.items.values()]) if (!this.seen.has(it.id)) this.remove(it);
  }

  private create(w: WandererView): Item {
    const kit = this.kit, group = new THREE.Group();
    const shadow = new THREE.Mesh(kit.quad, kit.shadow);
    shadow.scale.set(WANDERER_HEIGHT * 0.9, 1, WANDERER_HEIGHT * 0.9); shadow.position.y = 0.11; shadow.renderOrder = 9;
    const ring = new THREE.Mesh(kit.thinRing, kit.ringBlue);
    ring.scale.set(RING, 1, RING); ring.position.y = 0.2; ring.renderOrder = 10;
    const pulse = new THREE.Mesh(kit.thinRing, kit.pulseBlue);
    pulse.position.y = 0.22; pulse.renderOrder = 10; pulse.visible = false;
    group.add(shadow, ring, pulse);
    group.traverse(o => o.layers.set(WORLD));
    // Petit losange bleu au-dessus de la tête tant qu'on ne lui a pas parlé.
    const mark = new THREE.Mesh(kit.diamond, kit.solidBlue);
    mark.scale.setScalar(0.9); mark.position.y = WANDERER_HEIGHT + 2.2;
    setLayer(mark, TOP);
    group.add(mark);
    this.scene.add(group);
    const it: Item = {
      id: w.id, at: [w.at[0], w.at[1]], group, model: null, mixer: null, walk: null, idle: null, ring, pulse, mark,
      target: new THREE.Vector3(), heading: 0, targetHeading: 0, moving: true, met: false, inRange: false, alive: true, placed: false,
    };
    this.items.set(w.id, it);
    void spawn('porteur_civil', 'perso', { height: WANDERER_HEIGHT }).then(inst => {
      if (!it.alive) { disposeInstance(inst); return; }
      it.model = inst;
      setLayer(inst.root, TOP);
      group.add(inst.root);
      if (inst.clips.length) {
        it.mixer = new THREE.AnimationMixer(inst.root);
        const clip = (name: string) => inst.clips.find(c => c.name.toLowerCase() === name);
        const walk = clip('walk'), idle = clip('calmv0') ?? clip('calm_0');
        if (walk) { it.walk = it.mixer.clipAction(walk); it.walk.setEffectiveTimeScale(0.8); }
        if (idle) it.idle = it.mixer.clipAction(idle);
        this.play(it, 0);
      }
    });
    return it;
  }

  private play(it: Item, fade = 0.4): void {
    const next = it.moving ? it.walk : it.idle ?? it.walk, prev = it.moving ? it.idle : it.walk;
    if (!next) return;
    // Sans animation de repos, on fige la marche pendant la halte.
    if (!it.moving && !it.idle) { next.paused = true; return; }
    next.paused = false;
    next.reset().setEffectiveWeight(1).play();
    if (prev && prev !== next) prev.crossFadeTo(next, fade, true);
  }

  private remove(it: Item): void {
    it.alive = false;
    it.mixer?.stopAllAction();
    disposeInstance(it.model);
    it.group.removeFromParent();
    this.items.delete(it.id);
  }

  reposition(): void {
    for (const it of this.items.values()) { this.layer.toLocal(it.at, it.target); it.group.position.copy(it.target); }
  }

  update(dt: number, timeS: number): void {
    if (!this.items.size) return;
    const k = 1 - Math.exp(-dt * 3.2), phase = this.kit.phase;
    for (const it of this.items.values()) {
      const p = it.group.position;
      p.x += (it.target.x - p.x) * k; p.z += (it.target.z - p.z) * k;
      let dh = it.targetHeading - it.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      it.heading += dh * (1 - Math.exp(-dt * 5));
      if (it.model) it.model.root.rotation.y = it.heading;
      it.mark.position.y = WANDERER_HEIGHT + 2.2 + Math.sin(timeS * 2.2) * 0.4;
      it.mark.rotation.y = timeS * 1.4;
      if (it.inRange) { const r = RING * (1 + phase * 1.4); it.pulse.scale.set(r, 1, r); }
      it.mixer?.update(dt);
    }
  }
}
