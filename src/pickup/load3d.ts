// La scène 3D de l'écran de rangement, dans le langage du plateau de l'arbre de compétences : un établi vu de biais,
// la lampe d'atelier, le porteur sur son socle avec l'ossature de l'exosquelette, cinq attaches lumineuses (dos, bras,
// jambes) et les colis portés accrochés en vrais modèles. On fait tourner le porteur d'un glisser, on touche un colis
// puis une attache, ou on fait glisser le colis jusqu'à elle. Le porteur penche du côté le plus chargé.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SlotId } from '../game/api';
import { fixClips } from '../render/pose';
import { Loader3D, type Model, Viewport, canvasTexture, disposeObject, easeOut, hash, lightRender, reducedMotion, setShadows, softDiscTexture } from '../scene3d/kit';

export interface StageParcel { id: string; model: string; kg: number; slot: SlotId; special: boolean }
export interface StageSlot { id: SlotId; locked: boolean; /** le colis sélectionné peut s'y accrocher */ ok: boolean }
export interface StageState { parcels: StageParcel[]; slots: StageSlot[]; /** -1 (tout à gauche) à 1 (tout à droite) */ lean: number; sel: string | null }
export interface StageEvents {
  /** Colis touché. */
  parcel(id: string): void;
  /** Attache touchée. */
  slot(id: SlotId): void;
  /** Colis glissé jusqu'à une attache. */
  drop(id: string, slot: SlotId): void;
  /** Position à l'écran de chaque attache (pixels du conteneur), à chaque image rendue. */
  anchors(pts: Record<SlotId, { x: number; y: number }>): void;
}
export interface StageOpts { still: boolean; leger: boolean; clair: boolean; /** rotation de départ du porteur, en degrés (0 : vu de dos, de trois quarts) */ turnDeg?: number }

const SLOTS: SlotId[] = ['dos', 'brasG', 'brasD', 'jambeG', 'jambeD'];
const H = 1.72, SOCLE = 0.18, CORE_R = 0.66;
const AMBER = 0xffb760, GREEN = 0x9ccf7a, BLUE = 0x7fc7d9;
interface Pal { bg: number; wood: [string, string]; mat: string; line: string; base: number; hemi: [number, number, number]; spot: number; exposure: number; bloom: number }
const PALS: Record<'sombre' | 'clair', Pal> = {
  sombre: { bg: 0x0a100f, wood: ['#4a3423', '#2c1e14'], mat: '#1b332e', line: '230,225,211', base: 0x2c3a37, hemi: [0xa9c4ca, 0x3a2a1c, 1.15], spot: 4.2, exposure: 1.16, bloom: 0.4 },
  clair: { bg: 0xcfc6b1, wood: ['#c9a678', '#a98558'], mat: '#2e5a51', line: '240,236,224', base: 0x3d4f4b, hemi: [0xf4f1e6, 0x8a6f4d, 1.5], spot: 3.4, exposure: 1.1, bloom: 0.28 },
};

/** Place de chaque attache sur le porteur (repère du porteur : il regarde vers +z, sa gauche est en +x), si le squelette est introuvable. */
const DEFAULT_AT: Record<SlotId, [number, number, number]> = {
  dos: [0, 1.2, -0.17], brasG: [0.31, 0.98, 0], brasD: [-0.31, 0.98, 0], jambeG: [0.2, 0.58, 0.02], jambeD: [-0.2, 0.58, 0.02],
};
/** Direction dans laquelle le colis s'écarte de l'attache. */
const OUT: Record<SlotId, [number, number, number]> = { dos: [0, 0, -1], brasG: [1, 0, 0], brasD: [-1, 0, 0], jambeG: [1, 0, 0], jambeD: [-1, 0, 0] };

interface Pad { id: SlotId; at: THREE.Vector3; group: THREE.Group; ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; plate: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>; halo: THREE.Sprite; lock: THREE.Mesh; strut: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null; flash: number; locked: boolean; ok: boolean; full: boolean }
interface Item { id: string; model: string; kg: number; slot: SlotId; holder: THREE.Group; size: THREE.Vector3; from: THREE.Vector3; to: THREE.Vector3; t: number; ready: boolean; halo: THREE.Sprite; phase: number }

const _v = new THREE.Vector3(), _w = new THREE.Vector3();

function woodTexture(pal: Pal): THREE.CanvasTexture {
  const t = canvasTexture(512, 512, (g, w, h) => {
    const n = 4, pw = w / n;
    for (let i = 0; i < n; i++) {
      const grd = g.createLinearGradient(i * pw, 0, (i + 1) * pw, 0);
      grd.addColorStop(0, pal.wood[i % 2]); grd.addColorStop(1, pal.wood[(i + 1) % 2]);
      g.fillStyle = grd; g.fillRect(i * pw, 0, pw, h);
      for (let k = 0; k < 40; k++) {
        const x = i * pw + hash(i * 97 + k) * pw, a = 0.04 + hash(k * 3 + i) * 0.09;
        g.strokeStyle = hash(k + i * 11) > 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,235,200,${a * 0.6})`;
        g.lineWidth = 0.6 + hash(k * 7) * 1.6;
        g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + (hash(k * 5) - 0.5) * 14, h * 0.3, x + (hash(k * 9) - 0.5) * 14, h * 0.7, x, h); g.stroke();
      }
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(i * pw - 1, 0, 2.5, h);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1.5, 1.5);
  return t;
}
/** Le tapis de découpe : quadrillage, cercles de repérage autour du socle, « GAUCHE » et « DROITE » imprimés. */
function matTexture(pal: Pal): THREE.CanvasTexture {
  const S = 768, K = S / 3.6;
  return canvasTexture(S, S, g => {
    g.fillStyle = pal.mat; g.fillRect(0, 0, S, S);
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.55);
    grd.addColorStop(0, 'rgba(232,162,74,.22)'); grd.addColorStop(1, 'rgba(232,162,74,0)');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
    for (let i = 0; i <= 14; i++) {
      const major = i % 4 === 2, p = Math.round((i / 14) * S);
      g.fillStyle = `rgba(${pal.line},${major ? 0.16 : 0.06})`;
      g.fillRect(0, p - 1, S, major ? 2 : 1); g.fillRect(p - 1, 0, major ? 2 : 1, S);
    }
    g.strokeStyle = `rgba(${pal.line},.3)`; g.lineWidth = 2; g.setLineDash([10, 9]);
    g.beginPath(); g.arc(S / 2, S / 2, K * 0.98, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]); g.lineWidth = 1.5; g.strokeStyle = `rgba(${pal.line},.2)`;
    g.beginPath(); g.arc(S / 2, S / 2, K * 1.14, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = `rgba(${pal.line},.38)`; g.lineWidth = 3; g.strokeRect(K * 0.1, K * 0.1, S - K * 0.2, S - K * 0.2);
    g.fillStyle = `rgba(${pal.line},.5)`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 26px "Roboto Condensed", "Arial Narrow", sans-serif';
    try { (g as unknown as { letterSpacing: string }).letterSpacing = '6px'; } catch { /* navigateur ancien */ }
    g.fillText('GAUCHE', S * 0.16, S * 0.9); g.fillText('DROITE', S * 0.84, S * 0.9);
    g.fillStyle = `rgba(${pal.line},.3)`; g.font = '500 19px "Roboto Condensed", "Arial Narrow", sans-serif';
    g.fillText('STATION LUMEN · BANC DE CHARGE', S / 2, S * 0.955);
  });
}

export class LoadStage {
  private readonly vp: Viewport;
  private readonly loader = new Loader3D();
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  private readonly pivot = new THREE.Group();
  private readonly tilt = new THREE.Group();
  private readonly pads = new Map<SlotId, Pad>();
  private readonly items = new Map<string, Item>();
  private readonly disc = softDiscTexture(128, 0.02, 1.9);
  private readonly hemi: THREE.HemisphereLight;
  private readonly spot: THREE.SpotLight;
  private readonly wood: THREE.MeshStandardMaterial;
  private readonly matTop: THREE.MeshStandardMaterial;
  private readonly baseMat: THREE.MeshStandardMaterial;
  private readonly frameMat: THREE.MeshStandardMaterial;
  private mixer: THREE.AnimationMixer | null = null;
  private state: StageState = { parcels: [], slots: [], lean: 0, sel: null };
  private pal: Pal;
  private yaw: number;
  private lean = 0;
  private raf = 0; private last = 0; private t = 0; private dead = false; private dirty = 2;
  private readonly calm: boolean;
  private drag: { x: number; y: number; yaw: number; moved: number; item: Item | null; pad: Pad | null; carrying: boolean } | null = null;
  private readonly ray = new THREE.Raycaster();
  private readonly onVis = (): void => { if (document.hidden) this.stop(); else this.invalidate(); };

  /** Lève une exception si WebGL est indisponible : l'appelant garde alors l'écran 2D. */
  constructor(host: HTMLElement, private readonly opts: StageOpts, private readonly ev: StageEvents) {
    const light = opts.leger || lightRender();
    this.calm = opts.still || reducedMotion();
    this.vp = new Viewport(host, { post: !light, shadows: !light });
    const pal = this.pal = PALS[opts.clair ? 'clair' : 'sombre'];
    this.vp.setLook({ exposure: pal.exposure, bloom: pal.bloom, bloomThreshold: 0.92, bloomRadius: 0.55, vignette: 0.32, grain: opts.still ? 0 : 0.025 });
    this.yaw = Math.PI - 0.3 + ((opts.turnDeg ?? 0) * Math.PI) / 180;
    const sc = this.scene;
    sc.background = new THREE.Color(pal.bg);
    this.hemi = new THREE.HemisphereLight(pal.hemi[0], pal.hemi[1], pal.hemi[2]);
    // La lampe d'atelier : lumière chaude, seule source avec ombre.
    const spot = this.spot = new THREE.SpotLight(0xffd6a0, pal.spot, 0, 0.62, 0.85, 0);
    spot.position.set(-2.6, 6.2, 3.4); spot.target.position.set(0, 0.7, 0);
    if (!light) { spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.camera.near = 2; spot.shadow.camera.far = 14; spot.shadow.bias = -0.0012; spot.shadow.normalBias = 0.02; spot.shadow.radius = 3; }
    const fill = new THREE.PointLight(0xffc98a, 5, 6, 1.1); fill.position.set(1.5, 1.9, 2.4);
    // Appoint de face (côté caméra) : le porteur et ses colis restent lisibles quel que soit l'angle.
    const front = new THREE.DirectionalLight(0xffe6c8, 1.5); front.position.set(0.6, 2.4, 5);
    const rim = new THREE.DirectionalLight(0x9dc8d4, 0.7); rim.position.set(2.5, 3, -3.5);
    sc.add(this.hemi, spot, spot.target, fill, rim, front);

    this.wood = new THREE.MeshStandardMaterial({ map: woodTexture(pal), roughness: 0.82 });
    const table = new THREE.Mesh(new THREE.BoxGeometry(9, 0.4, 9), this.wood);
    table.position.y = -0.23; table.receiveShadow = true;
    this.matTop = new THREE.MeshStandardMaterial({ map: matTexture(pal), roughness: 0.93 });
    const edge = new THREE.MeshStandardMaterial({ color: 0x101a18, roughness: 0.9 });
    const mat = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.03, 3.6), [edge, edge, this.matTop, edge, edge, edge]);
    mat.position.y = -0.015; mat.receiveShadow = true;
    this.baseMat = new THREE.MeshStandardMaterial({ color: pal.base, roughness: 0.5, metalness: 0.45 });
    // Le socle hexagonal du cœur de l'arbre, avec son liseré ambre et son halo.
    const socle = new THREE.Mesh(new THREE.CylinderGeometry(CORE_R, CORE_R + 0.08, 0.14, 6), this.baseMat);
    socle.position.y = 0.07; socle.castShadow = true; socle.receiveShadow = true;
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(CORE_R - 0.1, CORE_R - 0.08, 0.04, 6), new THREE.MeshStandardMaterial({ color: 0x141d1b, roughness: 0.6, metalness: 0.3 }));
    plate.position.y = 0.16; plate.receiveShadow = true;
    const band = new THREE.Mesh(new THREE.TorusGeometry(CORE_R - 0.07, 0.016, 6, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc56e).multiplyScalar(2.1) }));
    band.rotation.x = -Math.PI / 2; band.rotation.z = Math.PI / 6 + Math.PI / 2; band.position.y = 0.155;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 3.3), new THREE.MeshBasicMaterial({ map: this.disc, color: AMBER, transparent: true, opacity: opts.clair ? 0.16 : 0.3, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.006;
    sc.add(table, mat, socle, plate, band, glow);
    if (!light) this.props();

    this.frameMat = new THREE.MeshStandardMaterial({ color: 0x24312f, roughness: 0.45, metalness: 0.6, emissive: BLUE, emissiveIntensity: 0.22 });
    this.pivot.position.y = SOCLE; this.pivot.rotation.y = this.yaw;
    this.pivot.add(this.tilt);
    sc.add(this.pivot);
    for (const k of SLOTS) this.pads.set(k, this.makePad(k, new THREE.Vector3(...DEFAULT_AT[k])));
    this.frame();
    this.aim();
    void this.loadPorter();

    const c = this.vp.canvas;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', this.down); c.addEventListener('pointermove', this.move);
    c.addEventListener('pointerup', this.up); c.addEventListener('pointercancel', this.cancel);
    document.addEventListener('visibilitychange', this.onVis);
    this.invalidate();
  }

  /** Quelques objets d'atelier autour du tapis (hors rendu allégé). */
  private props(): void {
    const std = (color: number, rough = 0.6, metal = 0.1): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    const put = (m: THREE.Mesh, x: number, y: number, z: number, ry = 0): THREE.Mesh => { m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; this.scene.add(m); return m; };
    const steel = std(0x8e9794, 0.5, 0.6);
    // Rouleau de sangle, cliquet de rechange, bobine, réglet.
    put(new THREE.Mesh(mergeGeometries([0, 1, 2].map(i => new THREE.TorusGeometry(0.26 - i * 0.012, 0.045, 6, 22).rotateX(Math.PI / 2).translate(0, 0.045 + i * 0.085, 0))), std(0xd9822b, 0.75)), -2.25, 0, -1.3);
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.18, 14), std(0x9aa5a2, 0.3, 0.85)), 2.2, 0.09, -1.5);
    put(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.012, 1.7), std(0xc9cfcc, 0.3, 0.8)), 2.15, 0.006, 0.6, 0.12);
    const nuts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 6), steel, 6), m4 = new THREE.Matrix4();
    ([[-2.1, 0.5], [-2.3, 0.72], [-2.05, 0.9], [2.3, -0.4], [2.05, 1.7], [-2.2, 1.9]] as [number, number][]).forEach(([x, z], i) => { m4.makeRotationY(hash(i) * 3).setPosition(x, 0.02, z); nuts.setMatrixAt(i, m4); });
    nuts.castShadow = true; nuts.receiveShadow = true; this.scene.add(nuts);
    // La lampe, au fond à gauche.
    const lampMat = std(0x2f6f7a, 0.45, 0.3);
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 0.09, 18), lampMat), -2.4, 0.045, -2.6);
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 6), steel), -2.3, 1.3, -2.55).rotation.z = -0.1;
    const head = put(new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.44, 16, 1, true), lampMat), -1.95, 2.55, -2.3);
    (head.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide; head.rotation.set(0.5, 0, -0.75);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd9a0).multiplyScalar(1.5) }));
    bulb.position.set(-1.88, 2.45, -2.25); this.scene.add(bulb);
  }

  /** Une attache : plaque, anneau lumineux, halo, cadenas (montré si elle est verrouillée). */
  private makePad(id: SlotId, at: THREE.Vector3): Pad {
    const g = new THREE.Group(), out = new THREE.Vector3(...OUT[id]);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.03, 6).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1d2927, roughness: 0.45, metalness: 0.5 }));
    plate.castShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.014, 6, 6), new THREE.MeshBasicMaterial({ color: AMBER }));
    ring.position.z = 0.012;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.disc, color: AMBER, transparent: true, opacity: 0.3, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(0.55); halo.renderOrder = 4;
    const lock = new THREE.Mesh(mergeGeometries([new THREE.BoxGeometry(0.1, 0.08, 0.04).translate(0, -0.015, 0), new THREE.TorusGeometry(0.032, 0.011, 5, 10, Math.PI).translate(0, 0.025, 0)]), new THREE.MeshStandardMaterial({ color: 0xb9b3a2, roughness: 0.45, metalness: 0.6 }));
    lock.position.z = 0.05; lock.visible = false;
    g.add(plate, ring, halo, lock);
    g.position.copy(at);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), out);
    this.tilt.add(g);
    return { id, at, group: g, ring, plate, halo, lock, strut: null, flash: 0, locked: false, ok: false, full: false };
  }

  /** L'ossature de l'exosquelette : colonne, épaules, ceinture, et une tige par attache de membre. */
  private frame(): void {
    for (const o of [...this.tilt.children]) if (o.userData.frame) { this.tilt.remove(o); (o as THREE.Mesh).geometry.dispose(); }
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material = this.frameMat): THREE.Mesh => { const m = new THREE.Mesh(geo, mat); m.userData.frame = true; m.castShadow = true; this.tilt.add(m); return m; };
    const dos = this.pads.get('dos')!.at, jg = this.pads.get('jambeG')!.at;
    const zb = dos.z - 0.005, yS = Math.min(H * 0.84, dos.y + 0.22), yH = Math.max(jg.y + 0.3, dos.y - 0.3);
    add(mergeGeometries([
      new THREE.BoxGeometry(0.07, yS - yH + 0.06, 0.04).translate(0, (yS + yH) / 2, zb),
      new THREE.BoxGeometry(0.4, 0.045, 0.04).translate(0, yS, zb),
      new THREE.BoxGeometry(0.34, 0.05, 0.04).translate(0, yH, zb),
      new THREE.BoxGeometry(0.24, 0.3, 0.03).translate(0, dos.y, zb + 0.012),
    ]));
    const tube = (a: THREE.Vector3, b: THREE.Vector3): THREE.BufferGeometry => {
      const mid = a.clone().lerp(b, 0.5); mid.x += Math.sign(b.x) * 0.05; mid.z -= 0.03;
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, mid, b]), 10, 0.017, 6);
    };
    for (const k of ['brasG', 'brasD', 'jambeG', 'jambeD'] as SlotId[]) {
      const p = this.pads.get(k)!, sx = Math.sign(p.at.x), arm = k.startsWith('bras');
      const from = new THREE.Vector3(sx * (arm ? 0.2 : 0.17), arm ? yS : yH, zb);
      p.strut = add(tube(from, p.at.clone()), new THREE.MeshStandardMaterial({ color: 0x24312f, roughness: 0.45, metalness: 0.6, emissive: BLUE, emissiveIntensity: 0.22 })) as Pad['strut'];
    }
  }

  private async loadPorter(): Promise<void> {
    const m = await this.loader.load('porteur', { height: H, fallback: 'perso' });
    if (this.dead) return;
    setShadows(m.root, !(this.opts.leger || lightRender()), false);
    this.tilt.add(m.root);
    if (m.ok && m.clips.length) {
      // Pose d'attente corrigée (pose.ts) : bras le long du corps, poignets droits.
      try {
        const idle = fixClips(m.root, m.clips).idle ?? m.clips[0];
        this.mixer = new THREE.AnimationMixer(m.root);
        this.mixer.clipAction(idle).play();
        this.mixer.setTime(0.6);
      } catch (e) { console.warn('[rangement] pose du porteur', e); }
    }
    // Les attaches se posent sur le squelette : avant-bras, cuisses, haut du dos.
    this.scene.updateMatrixWorld(true);
    const bone = (n: string): THREE.Vector3 | null => { const b = m.root.getObjectByName(n); return b ? this.tilt.worldToLocal(b.getWorldPosition(new THREE.Vector3())) : null; };
    const mid = (a: string, b: string, k: number): THREE.Vector3 | null => { const p = bone(a), q = bone(b); return p && q ? p.lerp(q, k) : null; };
    const want: Partial<Record<SlotId, THREE.Vector3 | null>> = {
      brasG: mid('LeftForeArm', 'LeftHand', 0.35), brasD: mid('RightForeArm', 'RightHand', 0.35),
      jambeG: mid('LeftUpLeg', 'LeftLeg', 0.55), jambeD: mid('RightUpLeg', 'RightLeg', 0.55), dos: bone('Spine02') ?? bone('Spine01'),
    };
    for (const k of SLOTS) {
      const p = want[k], pad = this.pads.get(k)!;
      if (!p || !Number.isFinite(p.x + p.y + p.z) || p.y < 0.2 || p.y > H) continue;
      const out = OUT[k];
      if (k === 'dos') pad.at.set(0, p.y, Math.min(-0.13, p.z - 0.13));
      else pad.at.set(Math.abs(p.x) < 0.05 ? DEFAULT_AT[k][0] : p.x + out[0] * (k.startsWith('bras') ? 0.055 : 0.085), p.y, p.z);
      pad.group.position.copy(pad.at);
    }
    this.frame();
    this.paint();
    this.layout(true);
    this.invalidate();
  }

  /** Cadre la scène : le porteur entier, vu de biais et d'un peu haut, avec de la place pour les étiquettes. */
  private aim(): void {
    const a = this.vp.aspect, d = Math.max(4.7, 4.0 / Math.max(0.5, a));
    this.cam.position.set(0, 1.12 + d * 0.3, d * 0.954);
    this.cam.lookAt(0, 1.12, 0);
    this.cam.updateMatrixWorld();
  }

  // ---------- État ----------
  set(st: StageState): void {
    const before = this.state;
    this.state = st;
    for (const s of st.slots) { const p = this.pads.get(s.id); if (p) { p.locked = s.locked; p.ok = s.ok; p.full = st.parcels.some(o => o.slot === s.id); } }
    const seen = new Set<string>();
    for (const o of st.parcels) {
      seen.add(o.id);
      let it = this.items.get(o.id);
      if (it && it.model !== o.model) { this.removeItem(it); it = undefined; }
      if (!it) { it = this.addItem(o); }
      else if (it.slot !== o.slot) {
        it.slot = o.slot;
        const pad = this.pads.get(o.slot);
        if (pad && before.parcels.length) pad.flash = 1;
        if (!this.calm) { it.from.copy(it.holder.position); it.t = 0; } else it.t = 1;
      }
    }
    for (const it of [...this.items.values()]) if (!seen.has(it.id)) this.removeItem(it);
    this.layout(this.calm);
    this.paint();
    this.invalidate();
  }

  private addItem(o: StageParcel): Item {
    const holder = new THREE.Group(), s = 0.2 + Math.min(12, Math.max(1, o.kg)) * 0.013;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.disc, color: 0xffd28a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(s * 2.6); halo.renderOrder = 5;
    holder.add(halo);
    this.tilt.add(holder);
    const it: Item = { id: o.id, model: o.model, kg: o.kg, slot: o.slot, holder, size: new THREE.Vector3(s, s, s), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, ready: false, halo, phase: hash(this.items.size + 7) * 6.28 };
    this.items.set(o.id, it);
    void this.loader.load(o.model, { height: s * 1.15, width: s * 1.35, fallback: 'objet' }).then((m: Model) => {
      if (this.dead || this.items.get(o.id) !== it) return;
      setShadows(m.root, !(this.opts.leger || lightRender()), false);
      m.root.position.y = -m.size.y / 2;
      it.size.copy(m.size); it.ready = true;
      holder.add(m.root);
      this.layout(true);
      this.invalidate();
    });
    return it;
  }
  private removeItem(it: Item): void { this.tilt.remove(it.holder); it.halo.material.dispose(); this.items.delete(it.id); }

  /** Place visée de chaque colis : empilés dans le dos, un par attache de membre. `snap` : sans animation. */
  private layout(snap: boolean): void {
    const stack = new Map<SlotId, number>();
    for (const o of this.state.parcels) {
      const it = this.items.get(o.id), pad = this.pads.get(o.slot);
      if (!it || !pad) continue;
      const out = OUT[o.slot], n = stack.get(o.slot) ?? 0, to = it.to;
      if (o.slot === 'dos') {
        // Pile dans le dos, du bas des reins vers le haut ; au-delà de quatre, les suivants se serrent derrière.
        const base = pad.at.y - 0.3;
        to.set(n > 0 ? (hash(n * 91 + 3) - 0.5) * 0.04 : 0, base + n + it.size.y / 2, pad.at.z - 0.03 - it.size.z / 2);
        stack.set('dos', n + it.size.y + 0.012);
        if (to.y > H + 0.35) { to.y = base + 0.2 + hash(n * 13) * 0.5; to.z -= it.size.z * 0.9; }
      } else {
        to.copy(pad.at).addScaledVector(_v.set(out[0], out[1], out[2]), 0.03 + it.size.x / 2);
        stack.set(o.slot, n + 1);
      }
      if (snap || it.t >= 1) { it.t = 1; if (!this.drag?.carrying || this.drag.item !== it) it.holder.position.copy(to); }
    }
  }

  /** Couleurs des attaches selon leur état. */
  private paint(): void {
    const pulse = this.calm ? 0.6 : 0.5 + 0.5 * Math.sin(this.t * 3.2), sel = this.state.sel;
    for (const p of this.pads.values()) {
      const f = p.flash, ring = p.ring.material, halo = p.halo.material;
      p.lock.visible = p.locked;
      if (p.locked) { ring.color.setRGB(0.09, 0.11, 0.105); halo.opacity = 0; p.plate.material.color.setHex(0x151c1b); }
      else if (p.ok) { ring.color.setHex(GREEN).multiplyScalar(1.5 + 1.1 * pulse); halo.color.setHex(GREEN); halo.opacity = 0.35 + 0.3 * pulse; p.plate.material.color.setHex(0x1f3324); }
      else { ring.color.setHex(AMBER).multiplyScalar((p.full ? 1.75 : 1.05) + f * 2); halo.color.setHex(AMBER); halo.opacity = (sel ? 0.1 : p.full ? 0.3 : 0.2) + f * 0.6; p.plate.material.color.setHex(0x1d2927); }
      p.ring.scale.setScalar(1 + (p.ok ? 0.12 * pulse : 0) + f * 0.5);
      p.halo.scale.setScalar(0.55 + f * 0.5 + (p.ok ? 0.1 * pulse : 0));
      if (p.strut) { p.strut.material.emissiveIntensity = p.locked ? 0 : 0.3 + f; p.strut.material.color.setHex(p.locked ? 0x121817 : 0x24312f); }
    }
    for (const it of this.items.values()) {
      const on = it.id === sel;
      it.halo.material.opacity = on ? 0.2 + 0.1 * pulse : 0;
    }
  }

  // ---------- Boucle ----------
  private invalidate(): void { this.dirty = Math.max(this.dirty, 2); if (!this.raf && !this.dead && !document.hidden) this.raf = requestAnimationFrame(this.loop); }
  private stop(): void { cancelAnimationFrame(this.raf); this.raf = 0; }
  private readonly loop = (now: number): void => {
    this.raf = 0;
    if (this.dead) return;
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016;
    this.last = now;
    let busy = false;
    if (!this.calm) { this.t += dt; this.mixer?.update(dt * 0.6); }
    // Le porteur penche du côté le plus chargé (sa gauche est en +x).
    const want = Math.max(-1, Math.min(1, this.state.lean)) * 0.13;
    if (this.calm) this.lean = want; else if (Math.abs(want - this.lean) > 1e-4) { this.lean += (want - this.lean) * (1 - Math.exp(-dt * 5)); busy = true; }
    this.tilt.rotation.z = this.lean;
    this.tilt.position.x = -this.lean * 0.35;
    this.pivot.rotation.y = this.yaw;
    for (const it of this.items.values()) {
      if (this.drag?.carrying && this.drag.item === it) continue;
      if (it.t < 1) {
        it.t = Math.min(1, it.t + dt / 0.5); busy = true;
        const k = easeOut(it.t);
        it.holder.position.lerpVectors(it.from, it.to, k);
        it.holder.position.y += Math.sin(Math.PI * it.t) * 0.22;
        it.holder.scale.setScalar(1 + 0.18 * Math.sin(Math.PI * it.t));
      } else {
        it.holder.scale.setScalar(1);
        const bob = !this.calm && it.id === this.state.sel ? Math.sin(this.t * 3 + it.phase) * 0.012 : 0;
        it.holder.position.copy(it.to); it.holder.position.y += bob;
      }
    }
    for (const p of this.pads.values()) if (p.flash > 0) { p.flash = Math.max(0, p.flash - dt * 1.8); busy = true; }
    this.paint();
    if (this.vp.resize()) { this.cam.aspect = this.vp.aspect; this.cam.updateProjectionMatrix(); this.aim(); }
    else if (this.cam.aspect !== this.vp.aspect) { this.cam.aspect = this.vp.aspect; this.cam.updateProjectionMatrix(); this.aim(); }
    this.vp.render(this.scene, this.cam, this.opts.still ? 0 : this.t);
    this.report();
    if (this.dirty > 0) this.dirty--;
    if (busy || this.dirty > 0 || this.drag || !this.calm) this.raf = requestAnimationFrame(this.loop);
  };

  private screen(local: THREE.Vector3): { x: number; y: number } {
    _w.copy(local); this.tilt.localToWorld(_w).project(this.cam);
    return { x: (_w.x * 0.5 + 0.5) * this.vp.width, y: (-_w.y * 0.5 + 0.5) * this.vp.height };
  }
  private report(): void {
    this.scene.updateMatrixWorld();
    const out = {} as Record<SlotId, { x: number; y: number }>;
    for (const p of this.pads.values()) out[p.id] = this.screen(p.at);
    this.ev.anchors(out);
  }

  // ---------- Gestes ----------
  private pt(e: PointerEvent): { x: number; y: number } { const b = this.vp.canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; }
  private hitItem(q: { x: number; y: number }): Item | null {
    let best: Item | null = null, bd = 1e9;
    for (const it of this.items.values()) {
      const s = this.screen(it.holder.position), d = Math.hypot(q.x - s.x, q.y - s.y);
      // Zone tactile : au moins 22 px de rayon (44 px de large), davantage pour un gros colis.
      const edge = this.screen(_v.copy(it.holder.position).add(new THREE.Vector3(0, it.size.y / 2, 0))), r = Math.max(24, Math.abs(edge.y - s.y) * 1.25);
      if (d < r && d < bd) { best = it; bd = d; }
    }
    return best;
  }
  private hitPad(q: { x: number; y: number }, r: number, only?: (p: Pad) => boolean): Pad | null {
    let best: Pad | null = null, bd = r;
    for (const p of this.pads.values()) { if (only && !only(p)) continue; const s = this.screen(p.at), d = Math.hypot(q.x - s.x, q.y - s.y); if (d < bd) { best = p; bd = d; } }
    return best;
  }
  private readonly down = (e: PointerEvent): void => {
    const q = this.pt(e);
    try { this.vp.canvas.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    const item = this.hitItem(q);
    this.drag = { x: q.x, y: q.y, yaw: this.yaw, moved: 0, item, pad: item ? null : this.hitPad(q, 30), carrying: false };
    this.invalidate();
  };
  private readonly move = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d) return;
    const q = this.pt(e);
    d.moved = Math.max(d.moved, Math.hypot(q.x - d.x, q.y - d.y));
    if (d.item) {
      if (d.moved > 10) {
        // Le colis suit le doigt, sur un plan face à la caméra.
        d.carrying = true;
        const it = d.item, wp = this.tilt.localToWorld(it.to.clone()), n = this.cam.getWorldDirection(new THREE.Vector3());
        this.ray.setFromCamera(new THREE.Vector2((q.x / this.vp.width) * 2 - 1, -(q.y / this.vp.height) * 2 + 1), this.cam);
        const hit = this.ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, wp), new THREE.Vector3());
        if (hit) { it.holder.position.copy(this.tilt.worldToLocal(hit)); it.holder.scale.setScalar(1.12); it.t = 1; }
      }
    } else if (d.moved > 6) this.yaw = d.yaw + (q.x - d.x) * 0.011;
    this.invalidate();
  };
  private readonly up = (e: PointerEvent): void => {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const q = this.pt(e);
    if (d.item) {
      const it = d.item;
      if (d.carrying) {
        const pad = this.hitPad(q, 72, p => !p.locked && p.id !== it.slot);
        // Retour à sa place en douceur ; si l'attache accepte le colis, l'état suivant le fera repartir de là.
        it.from.copy(it.holder.position); it.t = this.calm ? 1 : 0;
        if (pad) this.ev.drop(it.id, pad.id);
      } else this.ev.parcel(it.id);
    } else if (d.moved <= 10 && d.pad) this.ev.slot(d.pad.id);
    this.invalidate();
  };
  private readonly cancel = (): void => {
    const d = this.drag;
    this.drag = null;
    if (d?.item && d.carrying) { d.item.from.copy(d.item.holder.position); d.item.t = this.calm ? 1 : 0; }
    this.invalidate();
  };

  setAmbiance(clair: boolean): void {
    const pal = PALS[clair ? 'clair' : 'sombre'];
    if (pal === this.pal) return;
    this.pal = pal;
    (this.scene.background as THREE.Color).setHex(pal.bg);
    this.hemi.color.setHex(pal.hemi[0]); this.hemi.groundColor.setHex(pal.hemi[1]); this.hemi.intensity = pal.hemi[2];
    this.spot.intensity = pal.spot;
    this.wood.map?.dispose(); this.wood.map = woodTexture(pal);
    this.matTop.map?.dispose(); this.matTop.map = matTexture(pal);
    this.baseMat.color.setHex(pal.base);
    this.vp.setLook({ exposure: pal.exposure, bloom: pal.bloom });
    this.invalidate();
  }

  /** Arrête le rendu et libère tout (modèles, textures, contexte WebGL). */
  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    this.stop();
    document.removeEventListener('visibilitychange', this.onVis);
    const c = this.vp.canvas;
    c.removeEventListener('pointerdown', this.down); c.removeEventListener('pointermove', this.move);
    c.removeEventListener('pointerup', this.up); c.removeEventListener('pointercancel', this.cancel);
    this.mixer?.stopAllAction();
    this.items.clear();
    disposeObject(this.scene);
    this.spot.shadow.map?.dispose();
    this.disc.dispose();
    this.loader.dispose();
    this.vp.dispose();
  }
}
