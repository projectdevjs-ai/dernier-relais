// Le porteur : modèle animé (idle / walk / run avec fondu), déplacement lissé,
// colis empilés sur le dos. Dessiné par-dessus les bâtiments pour rester toujours visible.
import * as THREE from 'three';
import type { CrateKind } from '../game/api';
import { disposeInstance, type Instance, setLayer, spawn } from './assets';
import type { FxKit } from './fx';
import { TOP, WORLD } from './layer';
import type { Env } from './sky';

/** Taille « jeu » du porteur en mètres à l'échelle de la carte (plus grand que nature pour se lire à l'écran). */
export const PORTER_HEIGHT = 12;
/** Taille réelle du modèle, pour raisonner en mètres « humains » à l'intérieur du groupe. */
const HUMAN = 1.75;
const MAX_STACK = 4;

export const CRATE_MODEL: Record<CrateKind, string> = { bois: 'caisse_bois', alu: 'malle_alu', plastique: 'bac_plastique', carton: 'carton' };

type Anim = 'idle' | 'walk' | 'run';

export class Porter {
  /** Position et cap dans le repère local de la scène. */
  readonly root = new THREE.Group();
  /** Position lissée (lecture seule pour les autres modules). */
  readonly pos = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private heading = 0; private targetHeading = 0;
  private placed = false;
  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions: Partial<Record<Anim, THREE.AnimationAction>> = {};
  private anim: Anim | null = null;
  private wanted: Anim = 'idle';
  /** Groupe à l'échelle humaine (1 unité = 1 m du modèle), agrandi d'un bloc. */
  private readonly body = new THREE.Group();
  private readonly stack = new THREE.Group();
  private readonly crates: Instance[] = [];
  private stackKey = '';
  private stackToken = 0;
  private readonly marker: THREE.Mesh;
  private readonly lampPool: THREE.Mesh;
  moving = false;

  constructor(scene: THREE.Scene, kit: FxKit) {
    this.body.scale.setScalar(PORTER_HEIGHT / HUMAN);
    this.root.add(this.body);
    this.body.add(this.stack);
    // Au sol : ombre douce, anneau de position, halo de lampe la nuit.
    const shadow = new THREE.Mesh(kit.quad, kit.shadow);
    shadow.scale.set(PORTER_HEIGHT * 0.95, 1, PORTER_HEIGHT * 0.95); shadow.position.y = 0.12; shadow.renderOrder = 10;
    this.marker = new THREE.Mesh(kit.thinRing, kit.ringAmber);
    this.marker.scale.set(PORTER_HEIGHT * 0.62, 1, PORTER_HEIGHT * 0.62); this.marker.position.y = 0.2; this.marker.renderOrder = 11;
    this.lampPool = new THREE.Mesh(kit.quad, kit.glowWarm);
    this.lampPool.scale.set(70, 1, 70); this.lampPool.position.y = 0.16; this.lampPool.renderOrder = 9;
    for (const m of [shadow, this.marker, this.lampPool]) { m.layers.set(WORLD); this.root.add(m); }
    this.root.visible = false;
    scene.add(this.root);
    void this.load();
  }

  private async load(): Promise<void> {
    const inst = await spawn('porteur', 'perso', { height: HUMAN });
    setLayer(inst.root, TOP);
    this.body.add(inst.root);
    if (inst.clips.length) {
      this.mixer = new THREE.AnimationMixer(inst.root);
      for (const name of ['idle', 'walk', 'run'] as const) {
        const clip = inst.clips.find(c => c.name.toLowerCase() === name);
        if (clip) this.actions[name] = this.mixer.clipAction(clip);
      }
      // Pas géants : on ralentit un peu la marche pour limiter le glissement des pieds.
      this.actions.walk?.setEffectiveTimeScale(0.85);
      this.play(this.wanted, 0);
    }
    // Les colis suivent le haut du dos pour osciller avec la marche.
    const spine = inst.root.getObjectByName('Spine02') ?? inst.root.getObjectByName('Spine01');
    if (spine) { this.root.updateMatrixWorld(true); spine.attach(this.stack); }
  }

  private play(name: Anim, fade = 0.35): void {
    const next = this.actions[name] ?? this.actions.idle ?? this.actions.walk;
    const prev = this.anim ? this.actions[this.anim] : undefined;
    this.anim = name;
    if (!next || next === prev) return;
    next.reset().setEffectiveWeight(1).play();
    if (prev) prev.crossFadeTo(next, fade, true);
  }

  /** Nouvelle position visée (appelé à chaque sync). `snap` : téléportation sans glissement. */
  setTarget(local: THREE.Vector3, headingDeg: number, speedMps: number, snap: boolean): void {
    this.target.copy(local);
    // Le modèle regarde vers +z (sud) : cap 0 = nord.
    this.targetHeading = Math.PI - (headingDeg * Math.PI) / 180;
    if (!this.placed || snap || this.pos.distanceToSquared(local) > 200 * 200) {
      this.pos.copy(local); this.heading = this.targetHeading; this.placed = true;
    }
    this.root.visible = true;
    this.wanted = speedMps < 0.3 ? 'idle' : speedMps < 2.6 ? 'walk' : 'run';
    if (this.mixer && this.wanted !== this.anim) this.play(this.wanted);
  }

  hide(): void { this.root.visible = false; this.placed = false; }

  /** Colis portés : modèles (caisse du bon type ou colis spécial) empilés dans le dos (4 visibles au plus). */
  setCarried(kinds: string[]): void {
    const shown = kinds.slice(0, MAX_STACK);
    const key = shown.join(',');
    if (key === this.stackKey) return;
    this.stackKey = key;
    const token = ++this.stackToken;
    void Promise.all(shown.map(k => spawn(k, 'caisse', { height: 0.46, maxWidth: 0.58 }))).then(list => {
      if (token !== this.stackToken) { list.forEach(disposeInstance); return; }
      for (const c of this.crates) disposeInstance(c);
      this.crates.length = 0;
      let y = 0.82;
      list.forEach((inst, i) => {
        setLayer(inst.root, TOP);
        // Dans le dos (z négatif), légèrement désaxées pour un empilement vivant.
        inst.root.position.set(i % 2 ? 0.025 : -0.02, y, -0.36);
        inst.root.rotation.y = (i % 2 ? 0.14 : -0.1) + i * 0.05;
        y += inst.size.y + 0.015;
        this.stack.add(inst.root);
        this.crates.push(inst);
      });
    });
  }

  applyEnv(env: Env): void {
    this.lampPool.visible = env.night > 0.3;
  }

  /** À chaque image. Renvoie vrai si le porteur a bougé (la caméra doit suivre). */
  update(dt: number): boolean {
    if (!this.placed) return false;
    const k = 1 - Math.exp(-dt * 3.2);
    const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z;
    this.moving = dx * dx + dz * dz > 0.0004;
    if (this.moving) { this.pos.x += dx * k; this.pos.z += dz * k; }
    let dh = this.targetHeading - this.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const turning = Math.abs(dh) > 0.002;
    if (turning) this.heading += dh * (1 - Math.exp(-dt * 6));
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;
    this.mixer?.update(dt);
    return this.moving || turning;
  }
}
