// Les abris : bâtiment du PNJ, à peine plus haut que les immeubles voisins, posé AU BORD de la rue (jamais sur
// la chaussée) et tourné vers elle ; anneau d'étoiles au sol, PNJ devant sur le trottoir à partir d'une étoile,
// fine balise lumineuse pour le repérer de loin, faisceau bleu quand des colis portés lui sont destinés.
import * as THREE from 'three';
import type { NpcId, ShelterView } from '../game/api';
import type { LngLat } from '../core/geo';
import { disposeInstance, type Instance, setLayer, spawn } from './assets';
import type { FxKit } from './fx';
import { type Layer3D, TOP, WORLD } from './layer';
import type { Env } from './sky';
import type { Site } from '../world/site';

const BUILDING: Record<NpcId, string> = { mara: 'abri_mara', tomas: 'atelier_tomas', agathe: 'dispensaire_agathe', kenji: 'tour_kenji' };
/** Hauteur visée et emprise maximale des abris, en mètres à l'échelle de la carte. */
// Les immeubles de la carte sont tassés (voir mapstyle.ts : un immeuble de 25 m en fait 10) : à 11 m l'abri
// dépasse à peine ses voisins. Il se repère de loin par sa balise, pas par sa taille.
const SHELTER_HEIGHT = 11;
const SHELTER_WIDTH = 11.5;
const NPC_HEIGHT = 6;
const RING_RADIUS = 9.5;
/** Hauteur de la balise lumineuse (mètres) : abri allumé, abri encore éteint. */
const BEACON_LIT = 62, BEACON_OFF = 36;
/** Sans implantation transmise ni rues connues, on réessaie à ce rythme, puis on se rabat sur le point de livraison. */
const SITE_RETRY_MS = 1200, SITE_GIVE_UP_MS = 9000;

/** Implantation transmise par le jeu quand le contrat la porte (champs facultatifs de ShelterView). */
type Sited = ShelterView & { site?: LngLat; facing?: number };
/** Donne l'implantation d'un abri d'après les rues de la carte, ou null si elles ne sont pas encore chargées. */
/** `keep` : vrai lieu de la carte (il garde sa position s'il est déjà à l'écart de la rue). */
export type SiteResolver = (at: LngLat, keep: boolean) => Site | null;

interface Item {
  id: string;
  at: LngLat;
  /** Où le bâtiment est dessiné (hors chaussée) et vrai dès que cette implantation est définitive. */
  site: LngLat;
  sited: boolean;
  born: number;
  lastTry: number;
  /** Tourne bâtiment et PNJ : la façade (+z du modèle) regarde la rue. */
  yaw: THREE.Group;
  /** Balise permanente : fin trait de lumière au-dessus du toit. */
  mast: THREE.Mesh;
  group: THREE.Group;
  npcId: NpcId;
  building: Instance | null;
  shell: THREE.Group;
  npc: Instance | null;
  npcLoading: boolean;
  mixer: THREE.AnimationMixer | null;
  arcs: THREE.Mesh[];
  pips: THREE.Mesh[];
  pipRow: THREE.Group;
  beacon: THREE.Group;
  chevron: THREE.Mesh;
  pulse: THREE.Mesh;
  glow: THREE.Mesh;
  /** Point lumineux face caméra, visible la nuit sur les abris allumés. */
  halo: THREE.Group;
  /** Hauteur réelle du bâtiment affiché (pour le test de toucher et les effets). */
  height: number;
  stars: number;
  deliverable: boolean;
  inRange: boolean;
  alive: boolean;
}

const DULL = new THREE.Color(0xa3aaa7);
const WHITE = new THREE.Color(0xffffff);

export class Shelters {
  private readonly items = new Map<string, Item>();
  private readonly seen = new Set<string>();
  private env: Env | null = null;

  private readonly v = new THREE.Vector3();

  /** `resolve` : implantation calculée avec les rues de la carte, quand le jeu ne la transmet pas. */
  constructor(private readonly scene: THREE.Scene, private readonly kit: FxKit, private readonly layer: Layer3D, private readonly resolve: SiteResolver | null = null) {}

  get all(): IterableIterator<Item> { return this.items.values(); }
  get(id: string): Item | undefined { return this.items.get(id); }

  sync(list: ShelterView[]): void {
    this.seen.clear();
    for (const s of list) {
      this.seen.add(s.id);
      let it = this.items.get(s.id);
      if (it && it.npcId !== s.npc) { this.remove(it); it = undefined; }
      if (!it) it = this.create(s);
      if (it.at[0] !== s.at[0] || it.at[1] !== s.at[1]) { it.at = [s.at[0], s.at[1]]; it.sited = false; it.born = performance.now(); it.lastTry = 0; }
      if (!it.sited) this.place(it, s);
      const stars = Math.max(0, Math.min(5, Math.floor(s.stars))), deliverable = s.deliverable.length > 0;
      if (stars !== it.stars || deliverable !== it.deliverable || s.inRange !== it.inRange) {
        it.stars = stars; it.deliverable = deliverable; it.inRange = s.inRange;
        this.restyle(it);
      }
    }
    for (const it of [...this.items.values()]) if (!this.seen.has(it.id)) this.remove(it);
  }

  /**
   * Implantation du bâtiment : celle du jeu si la vue la porte (`site`, `facing`), sinon calculée avec les rues
   * de la carte. Tant que les rues ne sont pas chargées l'abri reste masqué (il n'apparaît pas sur la chaussée
   * pour sauter ensuite sur le côté) ; passé quelques secondes, il est posé au point de livraison.
   */
  private place(it: Item, s: Sited): void {
    const now = performance.now();
    let st: Site | null = s.site ? { site: s.site, facing: s.facing ?? 180 } : null;
    if (!st && this.resolve && now - it.lastTry > SITE_RETRY_MS) { it.lastTry = now; st = this.resolve(s.at, s.kind !== 'carrefour' && s.kind !== 'hameau'); }
    if (!st && (!this.resolve || now - it.born > SITE_GIVE_UP_MS)) st = { site: s.at, facing: 180 };
    if (!st) return;
    it.site = [st.site[0], st.site[1]]; it.sited = true;
    this.layer.toLocal(it.site, it.group.position);
    // Le modèle regarde vers +z (sud) : cap 0 = nord.
    it.yaw.rotation.y = Math.PI - (st.facing * Math.PI) / 180;
    it.group.visible = true;
  }

  private create(s: ShelterView): Item {
    const kit = this.kit;
    const group = new THREE.Group();
    this.layer.toLocal(s.at, group.position);
    group.visible = false;

    // Socle sombre et anneau d'étoiles en cinq segments.
    const shadow = new THREE.Mesh(kit.quad, kit.shadow);
    shadow.scale.set(RING_RADIUS * 2.1, 1, RING_RADIUS * 2.1); shadow.position.y = 0.1; shadow.renderOrder = 2;
    group.add(shadow);
    const glow = new THREE.Mesh(kit.quad, kit.glowAmber);
    glow.scale.set(RING_RADIUS * 3.2, 1, RING_RADIUS * 3.2); glow.position.y = 0.14; glow.renderOrder = 3;
    group.add(glow);
    const arcs: THREE.Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const arc = new THREE.Mesh(kit.starArcs[i], kit.ringOff);
      arc.scale.set(RING_RADIUS, 1, RING_RADIUS); arc.position.y = 0.3; arc.renderOrder = 4;
      arcs.push(arc); group.add(arc);
    }
    // Rangée de cinq losanges au-dessus du toit : les étoiles, lisibles de loin.
    const pipRow = new THREE.Group();
    const pips: THREE.Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const pip = new THREE.Mesh(kit.diamond, kit.pipOff);
      pip.scale.setScalar(0.8); pip.position.x = (i - 2) * 1.6;
      pips.push(pip); pipRow.add(pip);
    }
    pipRow.position.y = SHELTER_HEIGHT + 2;
    group.add(pipRow);
    // Balise de livraison : faisceau bleu, anneau au sol et chevron qui flotte.
    const beacon = new THREE.Group();
    const beam = new THREE.Mesh(kit.beam, kit.beamBlue);
    beam.scale.set(0.7, 120, 0.7);
    const base = new THREE.Mesh(kit.thinRing, kit.ringBlue);
    base.scale.set(RING_RADIUS + 2, 1, RING_RADIUS + 2); base.position.y = 0.34;
    const pulse = new THREE.Mesh(kit.thinRing, kit.pulseBlue);
    pulse.position.y = 0.36;
    const chevron = new THREE.Mesh(kit.diamond, kit.solidBlue);
    chevron.scale.set(1.5, 1.9, 1.5);
    beacon.add(beam, base, pulse, chevron);
    beacon.visible = false;
    group.add(beacon);

    // Balise permanente : c'est elle, et non la taille du bâtiment, qui signale l'abri de loin.
    const mast = new THREE.Mesh(kit.beam, kit.beamAmber);
    mast.scale.set(0.4, BEACON_OFF, 0.4); mast.position.y = SHELTER_HEIGHT * 0.9;
    group.add(mast);

    const halo = new THREE.Group();
    const card = new THREE.Mesh(kit.quad, kit.glowLamp);
    card.scale.set(22, 1, 22);
    halo.add(card);
    halo.rotation.order = 'YXZ';
    halo.position.y = SHELTER_HEIGHT * 0.6;
    halo.visible = false;
    group.add(halo);

    const yaw = new THREE.Group(), shell = new THREE.Group();
    yaw.add(shell); group.add(yaw);
    group.traverse(o => o.layers.set(WORLD));
    setLayer(halo, TOP); setLayer(mast, TOP);
    setLayer(pipRow, TOP); setLayer(beam, TOP); setLayer(chevron, TOP);
    this.scene.add(group);

    const it: Item = {
      id: s.id, at: [s.at[0], s.at[1]], site: [s.at[0], s.at[1]], sited: false, born: performance.now(), lastTry: 0, yaw, mast,
      group, npcId: s.npc, shell, building: null, npc: null, npcLoading: false, mixer: null,
      arcs, pips, pipRow, beacon, chevron, pulse, glow, halo, height: SHELTER_HEIGHT, stars: -1, deliverable: false, inRange: false, alive: true,
    };
    this.items.set(s.id, it);
    void spawn(BUILDING[s.npc], 'batiment', { height: SHELTER_HEIGHT, maxWidth: SHELTER_WIDTH, ownMaterials: true }).then(inst => {
      if (!it.alive) { disposeInstance(inst); return; }
      it.building = inst; it.height = inst.size.y;
      // Dessiné par-dessus la carte (calque TOP) : les immeubles de la carte qui chevauchent son emprise
      // ne le traversent plus, et l'abri reste lisible de partout, comme le porteur.
      setLayer(inst.root, TOP);
      shell.add(inst.root);
      it.pipRow.position.y = it.height + 2;
      it.halo.position.y = it.height * 0.6;
      it.mast.position.y = it.height * 0.9;
      if (it.npc) this.seat(it);
      this.restyle(it);
    });
    return it;
  }

  /** Met l'aspect de l'abri en accord avec ses étoiles et ses livraisons en attente. */
  private restyle(it: Item): void {
    const kit = this.kit, lit = it.stars > 0, night = this.env?.night ?? 0;
    for (let i = 0; i < 5; i++) {
      it.arcs[i].material = i < it.stars ? kit.ringAmber : kit.ringOff;
      it.pips[i].material = i < it.stars ? kit.solidAmber : kit.pipOff;
      it.pips[i].scale.setScalar(i < it.stars ? 1.5 : 1);
    }
    it.glow.visible = lit;
    it.halo.visible = lit && night > 0.3;
    it.beacon.visible = it.deliverable;
    // Balise : haute et vive sur un abri allumé, plus courte tant qu'il est éteint ; le faisceau bleu la remplace.
    it.mast.visible = !it.deliverable;
    it.mast.scale.y = lit ? BEACON_LIT : BEACON_OFF;
    if (it.building) {
      for (const m of it.building.materials) {
        // À zéro étoile : éteint et terne. Sinon la texture s'auto-éclaire un peu, davantage la nuit.
        m.color.copy(lit ? WHITE : DULL);
        m.emissive.set(lit ? 0xffd9a0 : 0x000000);
        m.emissiveMap = lit ? m.map : null;
        m.emissiveIntensity = lit ? 0.12 + night * 0.5 : 0;
        m.needsUpdate = true;
      }
    }
    if (lit && !it.npc && !it.npcLoading) {
      it.npcLoading = true;
      void spawn(it.npcId, 'perso', { height: NPC_HEIGHT }).then(inst => {
        it.npcLoading = false;
        if (!it.alive || it.npc) { disposeInstance(inst); return; }
        it.npc = inst;
        setLayer(inst.root, TOP);
        this.seat(it);
        inst.root.visible = it.stars > 0;
        it.yaw.add(inst.root);
        const idle = inst.clips.find(c => c.name.toLowerCase() === 'idle') ?? inst.clips[0];
        if (idle) { it.mixer = new THREE.AnimationMixer(inst.root); it.mixer.clipAction(idle).play(); }
      });
    }
    if (it.npc) it.npc.root.visible = lit;
  }

  /** Le PNJ se tient devant la façade, côté rue, sur le trottoir (jamais plus loin que l'anneau). */
  private seat(it: Item): void {
    const b = it.building;
    it.npc?.root.position.set(b ? b.size.x * 0.24 : 2, 0, b ? Math.min(RING_RADIUS - 2, b.size.z / 2 + 2.2) : RING_RADIUS - 3);
  }

  private remove(it: Item): void {
    it.alive = false;
    it.mixer?.stopAllAction();
    disposeInstance(it.building); disposeInstance(it.npc);
    it.group.removeFromParent();
    this.items.delete(it.id);
  }

  applyEnv(env: Env): void {
    this.env = env;
    for (const it of this.items.values()) this.restyle(it);
  }

  reposition(): void { for (const it of this.items.values()) this.layer.toLocal(it.site, it.group.position); }

  /** À chaque image : PNJ animés et tournés vers le joueur, balises qui flottent, losanges face caméra. */
  update(dt: number, timeS: number, player: THREE.Vector3, bearingRad: number, pitchRad: number): void {
    const phase = this.kit.phase;
    for (const it of this.items.values()) {
      if (!it.group.visible) continue;
      it.pipRow.rotation.y = -bearingRad;
      // Halo au sol : il respire lentement, comme un feu de camp vu de loin.
      if (it.glow.visible) { const g = RING_RADIUS * (3.4 + 0.22 * Math.sin(timeS * 0.9 + it.group.position.x)); it.glow.scale.set(g, 1, g); }
      if (it.halo.visible) it.halo.rotation.set(pitchRad, -bearingRad, 0);
      if (it.npc && it.npc.root.visible) {
        it.mixer?.update(dt);
        // Il suit le joueur du regard (son repère est tourné avec la façade).
        const p = this.v.copy(it.npc.root.position).applyAxisAngle(THREE.Object3D.DEFAULT_UP, it.yaw.rotation.y).add(it.group.position);
        it.npc.root.rotation.y = Math.atan2(player.x - p.x, player.z - p.z) - it.yaw.rotation.y;
      }
      if (it.deliverable) {
        it.chevron.position.y = it.height + 6 + Math.sin(timeS * 2.2) * 0.8;
        it.chevron.rotation.y = timeS * 1.4;
        const r = RING_RADIUS + 2 + phase * (it.inRange ? 8 : 5);
        it.pulse.scale.set(r, 1, r);
      }
    }
  }
}
