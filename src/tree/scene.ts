// La scène 3D de l'arbre de compétences : un plan de travail d'atelier vu de biais, un tapis de
// découpe, le cœur (l'exosquelette sur son socle) et douze modules hexagonaux reliés par des câbles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Ambiance, SkillBranch } from '../game/api';
import { type Loader3D, canvasTexture, disposeObject, easeOut, hash, setShadows, softDiscTexture } from '../scene3d/kit';
import { BRANCH_ICON, drawIcon } from './icons';

export const BRANCHES: SkillBranch[] = ['scanner', 'portage', 'endurance', 'réseau'];
/** Couleurs de branche de l'ancienne version (Scanner, Arrimage, Corps, Réseau). */
export const BRANCH_HEX: Record<SkillBranch, string> = { scanner: '#7fc7d9', portage: '#e8a24a', endurance: '#9ccf7a', 'réseau': '#c49bf0' };
export const BRANCH_NAME: Record<SkillBranch, string> = { scanner: 'Scanner', portage: 'Portage', endurance: 'Endurance', 'réseau': 'Réseau' };
/** Centre de la zone de chaque branche sur le plateau (teinte du tapis) et place de son nom imprimé. */
const ZONE: Record<SkillBranch, { at: [number, number]; label: [number, number] }> = {
  scanner: { at: [-1.2, -2.4], label: [-1.77, -2.5] }, portage: { at: [0.7, -2.6], label: [1.77, -2.5] },
  endurance: { at: [-1.2, 1.9], label: [-1.77, 1.85] }, 'réseau': { at: [1.2, 1.9], label: [1.77, 1.85] },
};

/**
 * Place de chaque module sur le plateau (x vers la droite, z vers le joueur) : trois colonnes. La colonne du centre
 * est décalée d'une demi-rangée : chaque module a sous lui la place de son étiquette (nom, état, effet).
 * À gauche le scanner (au fond) et l'endurance (devant) ; à droite l'exosquelette et le réseau ; au centre, le sac.
 */
const LAYOUT: Record<string, [number, number]> = {
  'scan-recharge': [-1.2, -0.9], 'scan-portee': [-1.2, -2.5], 'bras-long': [-1.2, -4.1],
  'exo-bras': [1.2, -0.9], 'exo-jambes': [1.2, -2.5], 'exo-gyro': [1.2, -4.1],
  sac: [0, -1.75], calage: [-0.45, -3.35], sangles: [0.45, -4.3],
  souffle: [-1.2, 0.66], foulee: [-1.2, 1.9], 'tout-terrain': [-1.2, 3.14],
  carnet: [1.2, 0.66], relais: [1.2, 1.9], reputation: [1.2, 3.14],
};
/** Étendue du plateau à cadrer (modules, étiquettes et noms de branche). */
export const EXTENT = { x: 1.68, zFar: -4.8, zNear: 3.95 };
/** Places de secours pour une compétence que le plan ne connaît pas encore. */
const SPARE: [number, number][] = [[0, 1.6], [0, 2.85], [0, 4.1], [0, -4.6], [-1.2, 4.38], [1.2, 4.38], [-1.2, -4.38], [1.2, -4.38]];
export const MAT_W = 3.9, MAT_D = 10.0;
const NODE_R = 0.34, BASE_H = 0.1, CAP_H = 0.07, CORE_R = 0.62;

export interface NodeInput { id: string; branch: SkillBranch; rank: number; maxRank: number; available: boolean; locked: boolean; parent: string | null }

interface NodeObj {
  id: string; branch: SkillBranch; i: number; x: number; z: number; color: THREE.Color; phase: number;
  rank: number; shown: number; maxRank: number; available: boolean; locked: boolean; parent: string | null;
  cap: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  icon: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  halo: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  outline: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  duct: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  wire: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  fill: number; dashed: boolean;
  /** Segments de l'anneau de rang : [maillage instancié, premier indice]. */
  ring: [THREE.InstancedMesh, number];
  powerT: number; flash: number;
}

interface Pal { bg: number; wood: [string, string]; mat: string; matLine: string; base: number; hemi: [number, number, number]; spot: number; exposure: number; bloom: number; capOff: number }
const PALS: Record<Ambiance, Pal> = {
  'crépuscule': { bg: 0x0a100f, wood: ['#4a3423', '#2c1e14'], mat: '#1b332e', matLine: '230,225,211', base: 0x2c3a37, hemi: [0x9dbcc4, 0x2a1d12, 0.55], spot: 2.5, exposure: 1.02, bloom: 0.45, capOff: 0x1d2927 },
  clair: { bg: 0xcfc6b1, wood: ['#c9a678', '#a98558'], mat: '#2e5a51', matLine: '240,236,224', base: 0x3d4f4b, hemi: [0xf4f1e6, 0x8a6f4d, 1.2], spot: 2.6, exposure: 1.08, bloom: 0.35, capOff: 0x22302d },
};
export function treeLook(a: Ambiance): { exposure: number; bloom: number } { return { exposure: PALS[a].exposure, bloom: PALS[a].bloom }; }

const FONT = '"Roboto Condensed", "sans-serif-condensed", "Arial Narrow", "DejaVu Sans Condensed", sans-serif';
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function woodTexture(pal: Pal): THREE.CanvasTexture {
  const t = canvasTexture(512, 512, (g, w, h) => {
    const n = 4, pw = w / n;
    for (let i = 0; i < n; i++) {
      const grd = g.createLinearGradient(i * pw, 0, (i + 1) * pw, 0);
      grd.addColorStop(0, pal.wood[i % 2]); grd.addColorStop(1, pal.wood[(i + 1) % 2]);
      g.fillStyle = grd; g.fillRect(i * pw, 0, pw, h);
      for (let k = 0; k < 46; k++) {
        const x = i * pw + hash(i * 97 + k) * pw, a = 0.04 + hash(k * 3 + i) * 0.09;
        g.strokeStyle = hash(k + i * 11) > 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,235,200,${a * 0.6})`;
        g.lineWidth = 0.6 + hash(k * 7) * 1.6;
        g.beginPath(); g.moveTo(x, 0);
        g.bezierCurveTo(x + (hash(k * 5) - 0.5) * 14, h * 0.3, x + (hash(k * 9) - 0.5) * 14, h * 0.7, x, h); g.stroke();
      }
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(i * pw - 1, 0, 2.5, h);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1.6, 2.2);
  return t;
}

/** Le tapis de découpe : quadrillage, quartiers teintés par branche, noms des branches imprimés. */
function matTexture(pal: Pal): THREE.CanvasTexture {
  const K = 152, W = Math.round(MAT_W * K), H = Math.round(MAT_D * K);
  return canvasTexture(W, H, (g) => {
    const X = (x: number): number => (x + MAT_W / 2) * K, Z = (z: number): number => (z + MAT_D / 2) * K;
    g.fillStyle = pal.mat; g.fillRect(0, 0, W, H);
    for (const b of BRANCHES) {
      const cx = X(ZONE[b].at[0]), cz = Z(ZONE[b].at[1]);
      const grd = g.createRadialGradient(cx, cz, 0, cx, cz, K * 2.3);
      grd.addColorStop(0, `${BRANCH_HEX[b]}36`); grd.addColorStop(1, `${BRANCH_HEX[b]}00`);
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
    }
    for (let i = -Math.floor(MAT_D / 0.5); i <= MAT_D / 0.5; i++) {
      const major = i % 4 === 0;
      g.fillStyle = `rgba(${pal.matLine},${major ? 0.16 : 0.06})`;
      g.fillRect(0, Math.round(Z(i * 0.25)) - 1, W, major ? 2 : 1);
      if (Math.abs(i * 0.25) <= MAT_W / 2) g.fillRect(Math.round(X(i * 0.25)) - 1, 0, major ? 2 : 1, H);
    }
    // Repères autour du cœur.
    g.strokeStyle = `rgba(${pal.matLine},.3)`; g.lineWidth = 2;
    g.setLineDash([10, 9]); g.beginPath(); g.arc(X(0), Z(0), K * 0.98, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]); g.lineWidth = 1.5; g.strokeStyle = `rgba(${pal.matLine},.2)`;
    g.beginPath(); g.arc(X(0), Z(0), K * 1.12, 0, Math.PI * 2); g.stroke();
    // Cadre et croix de repérage.
    g.strokeStyle = `rgba(${pal.matLine},.38)`; g.lineWidth = 3;
    g.strokeRect(K * 0.11, K * 0.11, W - K * 0.22, H - K * 0.22);
    g.lineWidth = 2;
    for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = X(cx * (MAT_W / 2 - 0.3)), z = Z(cz * (MAT_D / 2 - 0.3));
      g.beginPath(); g.moveTo(x - 12, z); g.lineTo(x + 12, z); g.moveTo(x, z - 12); g.lineTo(x, z + 12); g.stroke();
    }
    // Cartouche du plan, dans la partie libre devant le cœur.
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = `rgba(${pal.matLine},.5)`; g.font = `700 30px ${FONT}`;
    try { (g as unknown as { letterSpacing: string }).letterSpacing = '6px'; } catch { /* navigateur ancien */ }
    g.fillText('STATION LUMEN', X(0), Z(2.25));
    g.fillStyle = `rgba(${pal.matLine},.3)`; g.font = `500 21px ${FONT}`;
    g.fillText('SCHÉMA DES MODULES', X(0), Z(2.5));
    g.strokeStyle = `rgba(${pal.matLine},.3)`; g.lineWidth = 2;
    g.strokeRect(X(-0.68), Z(1.98), K * 1.36, K * 0.74);
    for (let i = 0; i <= 12; i++) g.fillRect(X(-0.6 + i * 0.1), Z(2.92), 2, i % 4 === 0 ? 16 : 9);
    // Noms des branches, imprimés le long des bords du tapis (lus depuis l'extérieur vers le cœur).
    g.textBaseline = 'middle'; g.textAlign = 'center';
    for (const b of BRANCHES) {
      const [lx, lz] = ZONE[b].label, left = lx < 0;
      g.save();
      g.translate(X(lx), Z(lz)); g.rotate(left ? -Math.PI / 2 : Math.PI / 2);
      g.fillStyle = BRANCH_HEX[b]; g.globalAlpha = 0.92;
      g.font = `700 40px ${FONT}`;
      try { (g as unknown as { letterSpacing: string }).letterSpacing = '7px'; } catch { /* navigateur ancien */ }
      const w = g.measureText(BRANCH_NAME[b].toUpperCase()).width;
      g.fillText(BRANCH_NAME[b].toUpperCase(), 0, 2);
      g.globalAlpha = 0.5;
      g.fillRect(-w / 2 - 150, -2, 130, 4); g.fillRect(w / 2 + 20, -2, 130, 4);
      g.restore();
    }
  });
}

function iconTexture(name: Parameters<typeof drawIcon>[1]): THREE.CanvasTexture {
  return canvasTexture(128, 128, (g, w) => drawIcon(g, name, w, 2.3), false);
}

export class TreeScene {
  readonly scene = new THREE.Scene();
  readonly nodes = new Map<string, NodeObj>();
  /** Vrai s'il existe une animation de repos (pulsation, courant dans les câbles). */
  ambient = false;
  private readonly group = new THREE.Group();
  private readonly hemi: THREE.HemisphereLight;
  private readonly spot: THREE.SpotLight;
  private readonly wood: THREE.MeshStandardMaterial;
  private readonly matTop: THREE.MeshStandardMaterial;
  private readonly baseMat: THREE.MeshStandardMaterial;
  private readonly disc = softDiscTexture(128, 0.02, 1.9);
  private readonly dashTex: THREE.CanvasTexture;
  private readonly flowTex: THREE.CanvasTexture;
  private readonly icons = new Map<string, THREE.CanvasTexture>();
  private readonly rings = new Map<number, { mesh: THREE.InstancedMesh; used: number }>();
  private locks: THREE.InstancedMesh | null = null;
  private coreGlow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
  private selected: string | null = null;
  private pal: Pal;
  private built = false;

  constructor(private ambiance: Ambiance, private readonly light: boolean) {
    const pal = this.pal = PALS[ambiance];
    const sc = this.scene;
    sc.background = new THREE.Color(pal.bg);
    sc.add(this.group);
    this.hemi = new THREE.HemisphereLight(pal.hemi[0], pal.hemi[1], pal.hemi[2]);
    sc.add(this.hemi);
    // La lampe d'atelier : seule lumière avec ombre.
    const spot = this.spot = new THREE.SpotLight(0xffd6a0, pal.spot, 0, 0.7, 0.85, 0);
    spot.position.set(-3.2, 8.5, -4.2);
    spot.target.position.set(0.15, 0, 0.5);
    if (!light) {
      spot.castShadow = true;
      spot.shadow.mapSize.set(1024, 1024);
      spot.shadow.camera.near = 3; spot.shadow.camera.far = 18;
      spot.shadow.bias = -0.0012; spot.shadow.normalBias = 0.02; spot.shadow.radius = 3;
    }
    sc.add(spot, spot.target);
    // Petit appoint chaud sur le cœur (sans ombre).
    const fillLight = new THREE.PointLight(0xffc98a, 2.2, 3.2, 1.2);
    fillLight.position.set(0.3, 1.5, 1.3);
    sc.add(fillLight);

    this.wood = new THREE.MeshStandardMaterial({ map: woodTexture(pal), roughness: 0.82, metalness: 0 });
    const table = new THREE.Mesh(new THREE.BoxGeometry(9, 0.4, 13), this.wood);
    table.position.y = -0.2 - 0.03; table.receiveShadow = true;
    this.matTop = new THREE.MeshStandardMaterial({ map: matTexture(pal), roughness: 0.93, metalness: 0 });
    const edge = new THREE.MeshStandardMaterial({ color: 0x101a18, roughness: 0.9 });
    const mat = new THREE.Mesh(new THREE.BoxGeometry(MAT_W, 0.03, MAT_D), [edge, edge, this.matTop, edge, edge, edge]);
    mat.position.y = -0.015; mat.receiveShadow = true;
    this.group.add(table, mat);

    this.baseMat = new THREE.MeshStandardMaterial({ color: pal.base, roughness: 0.5, metalness: 0.45 });
    this.dashTex = canvasTexture(16, 4, (g) => { g.clearRect(0, 0, 16, 4); g.fillStyle = '#fff'; g.fillRect(0, 0, 8, 4); }, false);
    this.dashTex.wrapS = THREE.RepeatWrapping; this.dashTex.magFilter = this.dashTex.minFilter = THREE.NearestFilter; this.dashTex.generateMipmaps = false;
    this.flowTex = canvasTexture(64, 4, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, w, 0);
      grd.addColorStop(0, '#7a7a7a'); grd.addColorStop(0.7, '#8a8a8a'); grd.addColorStop(0.88, '#ffffff'); grd.addColorStop(1, '#7a7a7a');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
    }, false);
    this.flowTex.wrapS = THREE.RepeatWrapping;
    for (const b of BRANCHES) this.icons.set(b, iconTexture(BRANCH_ICON[b]));
    this.buildCore();
    if (!light) this.buildProps();
  }

  // ---------- Le cœur ----------
  private buildCore(): void {
    const g = this.group;
    const socle = new THREE.Mesh(new THREE.CylinderGeometry(CORE_R, CORE_R + 0.08, 0.14, 6), this.baseMat);
    socle.position.y = 0.07; socle.castShadow = true; socle.receiveShadow = true;
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(CORE_R - 0.1, CORE_R - 0.08, 0.04, 6), new THREE.MeshStandardMaterial({ color: 0x141d1b, roughness: 0.6, metalness: 0.3 }));
    plate.position.y = 0.16; plate.receiveShadow = true;
    const band = new THREE.Mesh(new THREE.TorusGeometry(CORE_R - 0.07, 0.016, 6, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc56e).multiplyScalar(2.1) }));
    band.rotation.x = -Math.PI / 2; band.rotation.z = Math.PI / 6 + Math.PI / 2; band.position.y = 0.155;
    const glow = this.coreGlow = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 3.1), new THREE.MeshBasicMaterial({ map: this.disc, color: 0xffb760, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.006;
    g.add(socle, plate, band, glow);
  }

  /** Charge l'exosquelette du cœur. Ne rejette jamais (forme de remplacement si le modèle manque). */
  async loadCore(loader: Loader3D): Promise<void> {
    const m = await loader.load('exo_rack', { height: 1.12, width: 0.95 });
    setShadows(m.root, !this.light, false);
    m.root.position.y = 0.18;
    m.root.rotation.y = 0.35;
    this.group.add(m.root);
  }

  // ---------- Détails d'atelier ----------
  private buildProps(): void {
    const g = this.group;
    const std = (color: number, rough = 0.6, metal = 0.1): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    const put = (m: THREE.Mesh, x: number, y: number, z: number, ry = 0): THREE.Mesh => { m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
    // Tournevis.
    const steel = std(0x8e9794, 0.5, 0.6), amber = std(0xd9822b, 0.5), dark = std(0x1c2423, 0.7);
    const driver = (x: number, z: number, ry: number, mat: THREE.Material): void => {
      const geo = mergeGeometries([
        new THREE.CylinderGeometry(0.075, 0.06, 0.55, 8).rotateZ(Math.PI / 2).translate(-0.28, 0, 0),
        new THREE.CylinderGeometry(0.085, 0.085, 0.06, 8).rotateZ(Math.PI / 2).translate(0.02, 0, 0),
      ]);
      const shaft = new THREE.CylinderGeometry(0.022, 0.022, 0.75, 6).rotateZ(Math.PI / 2).translate(0.42, 0, 0);
      const h = put(new THREE.Mesh(geo, mat), x, 0.085, z, ry);
      const s = new THREE.Mesh(shaft, steel); s.castShadow = true; h.add(s);
    };
    driver(2.42, -1.55, 1.25, amber);
    driver(-2.5, 2.05, -1.75, std(0x3f8a94, 0.5));
    // Écrous et vis éparpillés (instanciés).
    const nut = new THREE.CylinderGeometry(0.075, 0.075, 0.045, 6);
    const nuts = new THREE.InstancedMesh(nut, steel, 9);
    const spots: [number, number][] = [[2.25, 0.4], [2.5, 0.62], [2.34, 0.9], [-2.3, -0.5], [-2.52, -0.2], [2.6, 3.1], [-2.28, 3.6], [2.3, -3.3], [-2.45, -2.4]];
    spots.forEach(([x, z], i) => { _m.compose(_p.set(x, 0.022, z), _q.setFromAxisAngle(UP, hash(i) * 3), _s.set(1, 1, 1)); nuts.setMatrixAt(i, _m); });
    nuts.castShadow = true; nuts.receiveShadow = true; g.add(nuts);
    // Rouleau de câble.
    const coil = mergeGeometries([0, 1, 2].map(i => new THREE.TorusGeometry(0.36 - i * 0.012, 0.04, 6, 22).rotateX(Math.PI / 2).translate(0, 0.04 + i * 0.075, 0)));
    put(new THREE.Mesh(coil, dark), -2.55, 0, 0.75);
    put(new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 6, 20).rotateX(Math.PI / 2), std(0xc24a3a, 0.6)), 2.55, 0.035, 1.85);
    // Bobine d'étain, réglet, feuille de notes.
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.2, 14), std(0x9aa5a2, 0.3, 0.85)), -2.4, 0.1, -1.6);
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.03, 14), amber), -2.4, 0.215, -1.6);
    put(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 2.3), std(0xc9cfcc, 0.3, 0.8)), 2.2, 0.006, -3.0, 0.06);
    const paper = put(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.006, 1.6), std(0xd9d2bd, 0.95)), 2.75, 0.003, 3.3, -0.22);
    paper.castShadow = false;
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6).rotateZ(Math.PI / 2), std(0xd6b23c, 0.5)), 2.6, 0.04, 3.15, 0.5);
    // La lampe d'atelier, au fond à gauche.
    const lampMat = std(0x2f6f7a, 0.45, 0.3);
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 0.1, 18), lampMat), -2.75, 0.05, -4.35);
    const arm = put(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.4, 6), steel), -2.6, 1.2, -4.3);
    arm.rotation.z = -0.13;
    const head = put(new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.5, 16, 1, true), lampMat), -2.2, 2.35, -4.0);
    (head.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    head.rotation.set(0.5, 0, -0.75);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd9a0).multiplyScalar(1.5) }));
    bulb.position.set(-2.12, 2.24, -3.94); g.add(bulb);
  }

  // ---------- Les modules ----------
  /** Construit les modules à la première vue, puis ne fait que les mettre à jour. */
  setNodes(list: NodeInput[], immediate: boolean): void {
    if (!this.built) { this.build(list); this.built = true; immediate = true; }
    for (const s of list) {
      const n = this.nodes.get(s.id);
      if (!n) continue;
      n.rank = s.rank; n.available = s.available; n.locked = s.locked;
      if (immediate || n.powerT < 0) { n.shown = s.rank; if (immediate) { n.powerT = -1; n.flash = 0; } }
      if (n.powerT < 0) n.fill = n.shown > 0 ? 1 : 0;
      this.refresh(n);
    }
    this.ambient = [...this.nodes.values()].some(n => n.available || n.shown > 0);
    this.paintAll(0);
  }

  private place(list: NodeInput[]): Map<string, [number, number]> {
    const out = new Map<string, [number, number]>();
    let spare = 0;
    for (const s of list) out.set(s.id, LAYOUT[s.id] ?? SPARE[spare++ % SPARE.length]);
    return out;
  }

  private build(list: NodeInput[]): void {
    const g = this.group, at = this.place(list), N = list.length;
    const baseGeo = new THREE.CylinderGeometry(NODE_R, NODE_R + 0.045, BASE_H, 6);
    const bases = new THREE.InstancedMesh(baseGeo, this.baseMat, N);
    bases.castShadow = true; bases.receiveShadow = true;
    const capGeo = new THREE.CylinderGeometry(0.235, 0.265, CAP_H, 6);
    const iconGeo = new THREE.PlaneGeometry(0.3, 0.3).rotateX(-Math.PI / 2);
    const haloGeo = new THREE.PlaneGeometry(1.7, 1.7).rotateX(-Math.PI / 2);
    const outGeo = new THREE.RingGeometry(0.44, 0.475, 6, 1).rotateX(-Math.PI / 2).rotateY(Math.PI / 6 + Math.PI / 2);
    // Anneaux de rang : un maillage instancié par nombre de rangs (2, 3, 4…).
    const perMax = new Map<number, number>();
    for (const s of list) perMax.set(s.maxRank, (perMax.get(s.maxRank) ?? 0) + s.maxRank);
    for (const [max, count] of perMax) {
      const gap = max > 1 ? 0.3 : 0;
      const geo = new THREE.TorusGeometry(0.305, 0.021, 5, Math.max(4, Math.round(22 / max)), (Math.PI * 2) / max - gap).rotateZ(gap / 2).rotateX(-Math.PI / 2);
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), count);
      mesh.frustumCulled = false;
      this.rings.set(max, { mesh, used: 0 });
      g.add(mesh);
    }
    // Cadenas : corps et anse fusionnés, un par module (réduit à zéro quand il est ouvert).
    const lockGeo = mergeGeometries([
      new THREE.BoxGeometry(0.13, 0.1, 0.05).translate(0, 0.05, 0),
      new THREE.TorusGeometry(0.04, 0.013, 5, 10, Math.PI).translate(0, 0.1, 0),
    ]);
    const locks = this.locks = new THREE.InstancedMesh(lockGeo, new THREE.MeshStandardMaterial({ color: 0xb9b3a2, roughness: 0.45, metalness: 0.6 }), N);
    locks.castShadow = true; locks.frustumCulled = false;
    g.add(bases, locks);

    list.forEach((s, i) => {
      const [x, z] = at.get(s.id) ?? [0, 0];
      const color = new THREE.Color(BRANCH_HEX[s.branch]);
      _m.compose(_p.set(x, BASE_H / 2, z), _q.identity(), _s.set(1, 1, 1));
      bases.setMatrixAt(i, _m);
      const cap = new THREE.Mesh(capGeo, new THREE.MeshStandardMaterial({ color: this.pal.capOff, emissive: color, emissiveIntensity: 0, roughness: 0.42, metalness: 0.25 }));
      cap.position.set(x, BASE_H + CAP_H / 2, z); cap.castShadow = true;
      const icon = new THREE.Mesh(iconGeo, new THREE.MeshBasicMaterial({ map: this.icons.get(s.branch) ?? null, transparent: true, depthWrite: false }));
      icon.position.set(x, BASE_H + CAP_H + 0.004, z); icon.renderOrder = 3;
      const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ map: this.disc, color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.position.set(x, 0.008 + i * 0.0004, z); halo.renderOrder = 1;
      const outline = new THREE.Mesh(outGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
      outline.position.set(x, 0.012, z); outline.renderOrder = 2;

      // Le câble : du parent (ou du cœur) jusqu'au module.
      const par = s.parent ? at.get(s.parent) : null;
      const a = new THREE.Vector3(par ? par[0] : 0, 0, par ? par[1] : 0), b = new THREE.Vector3(x, 0, z);
      const dir = b.clone().sub(a).normalize(), side = new THREE.Vector3(-dir.z, 0, dir.x);
      a.addScaledVector(dir, par ? NODE_R + 0.03 : CORE_R + 0.05); b.addScaledVector(dir, -(NODE_R + 0.03));
      const len = a.distanceTo(b), bow = (hash(i * 13 + 5) - 0.5) * 0.22;
      const curve = new THREE.CatmullRomCurve3([a, a.clone().lerp(b, 0.5).addScaledVector(side, bow), b]);
      const seg = 22;
      const ductGeo = new THREE.TubeGeometry(curve, seg, 0.042, 6).translate(0, 0.04, 0);
      const uv = ductGeo.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * Math.max(2, Math.round(len / 0.2)));
      const duct = new THREE.Mesh(ductGeo, new THREE.MeshStandardMaterial({ color: 0x141b1a, roughness: 0.7, metalness: 0.2, emissive: color, emissiveIntensity: 0 }));
      duct.castShadow = true;
      const wireGeo = new THREE.TubeGeometry(curve, seg, 0.024, 5).translate(0, 0.074, 0);
      const wuv = wireGeo.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < wuv.count; k++) wuv.setX(k, wuv.getX(k) * (len / 0.9));
      const wire = new THREE.Mesh(wireGeo, new THREE.MeshBasicMaterial({ color, map: this.flowTex }));
      // Embouts de raccord aux deux bouts du câble.
      const plugGeo = mergeGeometries([a, b].map(p => new THREE.CylinderGeometry(0.06, 0.06, 0.09, 6).rotateZ(Math.PI / 2).rotateY(-Math.atan2(dir.z, dir.x)).translate(p.x, 0.045, p.z)));
      const plug = new THREE.Mesh(plugGeo, this.baseMat); plug.castShadow = true;
      g.add(cap, icon, halo, outline, duct, wire, plug);

      const r = this.rings.get(s.maxRank)!, first = r.used;
      for (let k = 0; k < s.maxRank; k++) {
        // Premier segment en haut de l'écran (vers le fond), puis dans le sens des aiguilles d'une montre.
        _m.compose(_p.set(x, BASE_H + 0.012, z), _q.setFromAxisAngle(UP, Math.PI / 2 - (k + 1) * ((Math.PI * 2) / s.maxRank)), _s.set(1, 1, 1));
        r.mesh.setMatrixAt(first + k, _m);
      }
      r.used += s.maxRank;
      this.nodes.set(s.id, {
        id: s.id, branch: s.branch, i, x, z, color, phase: hash(i + 3) * 6.28,
        rank: s.rank, shown: s.rank, maxRank: s.maxRank, available: s.available, locked: s.locked, parent: s.parent,
        cap, icon, halo, outline, duct, wire, fill: s.rank > 0 ? 1 : 0, dashed: false,
        ring: [r.mesh, first], powerT: -1, flash: 0,
      });
    });
    bases.instanceMatrix.needsUpdate = true;
  }

  /** Ce qui ne change qu'avec l'état : anneau de rang, cadenas, pointillé du câble. */
  private refresh(n: NodeObj): void {
    const [mesh, first] = n.ring;
    for (let k = 0; k < n.maxRank; k++) {
      if (k < n.shown) _c.copy(n.color).multiplyScalar(1.15);
      else if (n.locked) _c.setRGB(0.05, 0.07, 0.065);
      else _c.copy(n.color).multiplyScalar(0.16).addScalar(0.035);
      mesh.setColorAt(first + k, _c);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (this.locks) {
      const k = n.locked ? 1 : 0;
      _m.compose(_p.set(n.x + 0.3, BASE_H * 0.2, n.z + 0.3), _q.setFromAxisAngle(UP, 0.5), _s.set(k, k, k));
      this.locks.setMatrixAt(n.i, _m);
      this.locks.instanceMatrix.needsUpdate = true;
    }
    if (n.dashed !== n.locked) {
      n.dashed = n.locked;
      const m = n.duct.material;
      m.map = n.locked ? this.dashTex : null;
      m.alphaTest = n.locked ? 0.5 : 0;
      m.needsUpdate = true;
      n.duct.castShadow = !n.locked;
    }
  }

  setSelected(id: string | null): void { this.selected = id; }

  /** Lance la mise sous tension d'un module (son câble se remplit, puis le module s'allume). */
  power(id: string, instant: boolean): void {
    const n = this.nodes.get(id);
    if (!n) return;
    if (instant) { n.powerT = -1; return; }
    n.powerT = 0;
  }

  /** Fait avancer les animations. Renvoie vrai tant qu'une mise sous tension est en cours. */
  tick(t: number, dt: number): boolean {
    let busy = false;
    const DUR = 1.25, HIT = 0.42;
    for (const n of this.nodes.values()) {
      if (n.powerT < 0) continue;
      busy = true;
      const before = n.powerT / DUR;
      n.powerT += dt;
      const p = n.powerT / DUR;
      if (n.shown === 0 && p < HIT) n.fill = easeOut(p / HIT);
      if (before < HIT && p >= HIT) { n.shown = n.rank; n.fill = n.shown > 0 ? 1 : 0; n.flash = 1; this.refresh(n); }
      if (p >= HIT) n.flash = Math.max(0, 1 - (p - HIT) / (1 - HIT));
      if (p >= 1) { n.powerT = -1; n.flash = 0; n.shown = n.rank; n.fill = n.shown > 0 ? 1 : 0; this.refresh(n); }
    }
    this.flowTex.offset.x -= dt * 0.55;
    this.paintAll(t);
    return busy;
  }

  private paintAll(t: number): void {
    for (const n of this.nodes.values()) this.paint(n, t);
    if (this.coreGlow) this.coreGlow.material.opacity = (this.ambiance === 'clair' ? 0.16 : 0.3) + 0.04 * Math.sin(t * 1.3);
  }

  private paint(n: NodeObj, t: number): void {
    const full = n.shown >= n.maxRank, part = n.shown > 0 && !full, sel = this.selected === n.id;
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.7 + n.phase), f = n.flash, clair = this.ambiance === 'clair';
    const cap = n.cap.material, ic = n.icon.material;
    if (full) { cap.color.copy(n.color).multiplyScalar(0.72); cap.emissiveIntensity = 0.3 + f * 1.6; ic.color.setRGB(0.03, 0.07, 0.065); ic.opacity = 0.95; }
    else if (part) { cap.color.set(this.pal.capOff).lerp(n.color, 0.2); cap.emissiveIntensity = 0.1 + f * 1.4; ic.color.copy(n.color).multiplyScalar(1.75); ic.opacity = 1; }
    else if (n.locked) { cap.color.set(this.pal.capOff).multiplyScalar(0.8); cap.emissiveIntensity = 0; ic.color.setRGB(0.3, 0.36, 0.34); ic.opacity = 0.75; }
    else { cap.color.set(this.pal.capOff).lerp(n.color, 0.08); cap.emissiveIntensity = (n.available ? 0.05 + 0.1 * pulse : 0.02) + f; ic.color.copy(n.color).multiplyScalar(n.available ? 1.05 + 0.55 * pulse : 0.8); ic.opacity = 1; }
    const s = 1 + 0.22 * Math.sin(Math.min(1, f * 1.4) * Math.PI) * f;
    n.cap.scale.set(s, 1 + f * 0.6, s); n.icon.scale.setScalar(s); n.icon.position.y = BASE_H + CAP_H * (1 + f * 0.6) + 0.004;
    // Halo posé sur le tapis.
    const k = clair ? 0.6 : 1;
    n.halo.material.opacity = Math.min(1, k * (full ? 0.22 : part ? 0.15 : n.available ? 0.12 + 0.2 * pulse : 0) + f * 0.7);
    n.halo.scale.setScalar(1 + f * 0.9);
    // Contour : disponible (pulse) ou sélectionné (fixe, clair).
    const o = n.outline;
    o.visible = n.available || sel;
    if (sel) { o.material.color.setRGB(2.2, 2.0, 1.55); o.material.opacity = 1; o.scale.setScalar(1.16); }
    else { o.material.color.copy(n.color).multiplyScalar(0.95 + 0.5 * pulse); o.material.opacity = 0.55 + 0.45 * pulse; o.scale.setScalar(1 + 0.07 * pulse); }
    // Câble : gaine sombre, fil lumineux quand le lien est acquis.
    const lit = n.fill > 0.001;
    n.wire.visible = lit;
    if (lit) {
      n.wire.geometry.setDrawRange(0, Math.max(1, Math.round(22 * n.fill)) * 30);
      n.wire.material.color.copy(n.color).multiplyScalar(1.7 + f * 2);
    }
    n.duct.material.emissiveIntensity = n.locked ? 0 : lit ? 0.12 : 0.05;
    n.duct.material.color.setHex(n.locked ? 0x39443f : 0x141b1a);
  }

  setAmbiance(a: Ambiance): void {
    if (a === this.ambiance) return;
    this.ambiance = a;
    const pal = this.pal = PALS[a];
    (this.scene.background as THREE.Color).setHex(pal.bg);
    this.hemi.color.setHex(pal.hemi[0]); this.hemi.groundColor.setHex(pal.hemi[1]); this.hemi.intensity = pal.hemi[2];
    this.spot.intensity = pal.spot;
    this.wood.map?.dispose(); this.wood.map = woodTexture(pal);
    this.matTop.map?.dispose(); this.matTop.map = matTexture(pal);
    this.baseMat.color.setHex(pal.base);
    this.paintAll(0);
  }

  dispose(): void {
    disposeObject(this.scene);
    this.spot.shadow.map?.dispose();
    this.disc.dispose(); this.dashTex.dispose(); this.flowTex.dispose();
    for (const t of this.icons.values()) t.dispose();
    this.nodes.clear();
  }
}
