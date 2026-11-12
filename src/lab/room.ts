// Décor 3D de la Station Lumen : un couloir de station en TROIS POSTES côte à côte (Salle des cartes, Le Passeur,
// Quartiers), comme dans l'ancienne version, plus la chambre des quartiers derrière sa porte.
// Tout est construit ici ; src/lab/lab.ts s'occupe de la caméra, des gestes et de l'interface.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Ambiance, GameView, SkillBranch } from '../game/api';
import { Actor, type Loader3D, type Model, type Viewport, blobShadow, canvasTexture, hash, setEnvIntensity, softDiscTexture } from '../scene3d/kit';
import { CAST, type SciId } from './texts';

// ---------- Plan (mètres ; x vers la droite, z vers la caméra) ----------
/** Abscisse du centre de chaque poste, de gauche à droite : cartes, passeur, quartiers. */
export const SX = [-8.5, 0, 8.5] as const;
export const ROOM = { halfW: 13, back: -6, front: 7.5, height: 4.5 } as const;
const PAD = new THREE.Vector3(0, 0, -3.5);
const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
/** Centre de la chambre des quartiers (pièce à part, derrière la porte : on y entre par un fondu). */
export const CHAMBER = V(SX[2], 0, -26);
export const EXO_AT = V(-1.0, 0, -2.1);
export const DOOR_AT = V(SX[2] - 0.2, 0, ROOM.back + 0.12);

const SCI_AT: Record<SciId, { at: THREE.Vector3; ry: number; st: number }> = {
  iris: { at: V(SX[0] + 1.3, 0, -1.7), ry: -0.45, st: 0 },
  noe: { at: V(SX[1] + 1.5, 0, -1.9), ry: -0.5, st: 1 },
  selma: { at: V(SX[2] + 1.15, 0, -1.9), ry: -0.45, st: 2 },
};
/** Place du porteur devant chaque poste (comme dans l'ancien : il suit d'un poste à l'autre). */
export const porterSpot = (i: number): THREE.Vector3 => V(SX[i] - 1.22, 0, -0.1);
export const PAD_AT = PAD;

// ---------- Palettes ----------
interface Pal {
  bg: number; fogNear: number; fogFar: number; wall: number; floor: number; floorRough: number;
  hemiSky: number; hemiGround: number; hemi: number; window: number; windowPower: number; key: number; keyPower: number;
  exposure: number; bloom: number; env: number; backdrop: number; points: number; strips: number;
}
const PALS: Record<Ambiance, Pal> = {
  'crépuscule': {
    bg: 0x070d0d, fogNear: 22, fogFar: 62, wall: 0x24353a, floor: 0x2a3838, floorRough: 0.5,
    hemiSky: 0x5d8a92, hemiGround: 0x140f0a, hemi: 0.55, window: 0xff9a4d, windowPower: 0.7, key: 0xbfd9e2, keyPower: 0.7,
    exposure: 1.0, bloom: 0.4, env: 0.22, backdrop: 1.9, points: 1, strips: 1,
  },
  'clair': {
    bg: 0xcfd3cc, fogNear: 26, fogFar: 80, wall: 0xb9b8ab, floor: 0x767a76, floorRough: 0.38,
    hemiSky: 0xe9f1f4, hemiGround: 0x8a8272, hemi: 1.9, window: 0xfff1d6, windowPower: 0.8, key: 0xffffff, keyPower: 1.5,
    exposure: 1.0, bloom: 0.3, env: 0.55, backdrop: 1.5, points: 0.45, strips: 0.8,
  },
};
export function labLook(a: Ambiance): { exposure: number; bloom: number } { return { exposure: PALS[a].exposure, bloom: PALS[a].bloom }; }

const BRANCH_COLOR: Record<SkillBranch, number> = { scanner: 0x7fc7d9, portage: 0xe8a24a, endurance: 0x9ccf7a, 'réseau': 0xf0c75e };
const BRANCHES: SkillBranch[] = ['scanner', 'portage', 'endurance', 'réseau'];

/** Tracé simplifié de la France métropolitaine (longitude, latitude), dans le sens des aiguilles d'une montre. */
const FRANCE: [number, number][] = [
  [2.5, 51.1], [4.2, 50.0], [5.9, 49.5], [8.2, 49.0], [7.6, 47.6], [6.1, 46.3], [6.9, 46.0], [7.1, 45.1], [6.7, 44.5], [7.7, 44.1], [7.5, 43.8],
  [6.2, 43.1], [5.0, 43.35], [4.2, 43.45], [3.1, 43.1], [3.1, 42.45], [1.7, 42.5], [0.7, 42.75], [-0.5, 42.85], [-1.8, 43.4], [-1.25, 44.6],
  [-1.1, 45.55], [-1.2, 46.2], [-2.1, 46.85], [-2.3, 47.3], [-2.9, 47.55], [-4.4, 47.85], [-4.8, 48.4], [-3.5, 48.85], [-2.0, 48.65],
  [-1.5, 48.65], [-1.7, 49.65], [-1.2, 49.7], [-1.1, 49.35], [0.1, 49.5], [1.4, 50.05], [1.6, 50.9],
];
const CORSE: [number, number][] = [[9.4, 43.0], [9.55, 42.1], [9.2, 41.4], [8.6, 41.9], [8.6, 42.4], [9.3, 42.7]];
const FR_K = 0.105;
const frXZ = (lng: number, lat: number): [number, number] => [(lng - 2.4) * FR_K * 0.69, -(lat - 46.5) * FR_K];
function inFrance(lng: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = FRANCE.length - 1; i < FRANCE.length; j = i++) {
    const [xi, yi] = FRANCE[i], [xj, yj] = FRANCE[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface Sci { id: SciId; st: number; actor: Actor; head: THREE.Vector3; talkUntil: number; nextIdle: number }

/** Niveau de 0 à 1 de chaque branche de compétences. */
export function branchLevels(v: GameView): Record<SkillBranch, number> {
  const out = { scanner: 0, portage: 0, endurance: 0, 'réseau': 0 } as Record<SkillBranch, number>;
  for (const b of BRANCHES) {
    const list = v.skills.filter(s => s.branch === b);
    const max = list.reduce((s, k) => s + k.maxRank, 0);
    out[b] = max > 0 ? list.reduce((s, k) => s + k.rank, 0) / max : 0;
  }
  return out;
}

function panelTexture(): THREE.CanvasTexture {
  const t = canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = '#8f9590'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#a3a9a3'; g.fillRect(8, 8, w - 16, h * 0.56); g.fillRect(8, h * 0.6, w - 16, h * 0.37);
    g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(0, h * 0.572, w, 7); g.fillRect(0, 0, 3, h); g.fillRect(w - 3, 0, 3, h);
    for (let k = 0; k < 5; k++) { g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(40 + k * 34, h * 0.84, 18, 18); }
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(24, h * 0.1, 60, 4); g.fillRect(24, h * 0.13, 36, 4);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function floorTextures(): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  let seed = 3;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const cells: number[] = [];
  for (let i = 0; i < 16; i++) cells.push(rnd());
  const map = canvasTexture(512, 512, (g, w) => {
    g.fillStyle = '#9aa29f'; g.fillRect(0, 0, w, w);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const v = 196 + cells[y * 4 + x] * 22;
      g.fillStyle = `rgb(${v},${v + 5},${v + 4})`; g.fillRect(x * 128 + 2, y * 128 + 2, 124, 124);
      g.fillStyle = 'rgba(0,0,0,.35)';
      for (const [a, b] of [[10, 10], [112, 10], [10, 112], [112, 112]]) g.fillRect(x * 128 + a, y * 128 + b, 5, 5);
    }
  });
  const rough = canvasTexture(512, 512, (g, w) => {
    g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, w, w);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const v = 120 + cells[(y * 4 + x + 5) % 16] * 60;
      g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x * 128 + 2, y * 128 + 2, 124, 124);
    }
    // traces d'usure
    for (let k = 0; k < 260; k++) { g.fillStyle = `rgba(255,255,255,${rnd() * 0.07})`; g.fillRect(rnd() * w, rnd() * w, 2 + rnd() * 50, 1 + rnd() * 2); }
  }, false);
  for (const t of [map, rough]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(ROOM.halfW * 2 / 4, (ROOM.front - ROOM.back) / 4); t.anisotropy = 8; }
  return { map, rough };
}

/** La Plaine Noire derrière la baie vitrée. */
function drawBackdrop(g: CanvasRenderingContext2D, w: number, h: number, a: Ambiance): void {
  const dusk = a === 'crépuscule';
  const sky = g.createLinearGradient(0, 0, 0, h * 0.68);
  if (dusk) { sky.addColorStop(0, '#0b2024'); sky.addColorStop(0.5, '#27504c'); sky.addColorStop(0.86, '#d98a43'); sky.addColorStop(1, '#ffc57a'); }
  else { sky.addColorStop(0, '#7ea2b8'); sky.addColorStop(0.6, '#c9d8da'); sky.addColorStop(1, '#fbe9c8'); }
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  const sun = g.createRadialGradient(w * 0.6, h * 0.66, 2, w * 0.6, h * 0.66, w * 0.42);
  sun.addColorStop(0, dusk ? 'rgba(255,236,190,1)' : 'rgba(255,255,244,1)'); sun.addColorStop(0.12, dusk ? 'rgba(255,190,110,.75)' : 'rgba(255,246,220,.7)'); sun.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = sun; g.fillRect(0, 0, w, h);
  // voiles d'altitude
  for (let k = 0; k < 9; k++) {
    g.fillStyle = dusk ? `rgba(255,190,120,${0.05 + hash(k) * 0.1})` : `rgba(255,255,255,${0.1 + hash(k) * 0.16})`;
    g.beginPath(); g.ellipse(hash(k * 3) * w, h * (0.12 + hash(k * 7) * 0.4), w * (0.18 + hash(k * 5) * 0.2), 3 + hash(k * 11) * 5, -0.05, 0, Math.PI * 2); g.fill();
  }
  for (const [base, amp, col] of [[0.66, 0.16, dusk ? '#5b4435' : '#9aa6a8'], [0.68, 0.09, dusk ? '#2c2622' : '#6c7678']] as const) {
    g.fillStyle = col; g.beginPath(); g.moveTo(0, h * 0.69);
    for (let x = 0; x <= w; x += 12) g.lineTo(x, h * base - h * amp * (0.35 + 0.65 * Math.abs(Math.sin(x * 0.011 + base * 40) * 0.7 + Math.sin(x * 0.037 + amp * 90) * 0.3)));
    g.lineTo(w, h * 0.69); g.fill();
  }
  const sand = g.createLinearGradient(0, h * 0.68, 0, h);
  sand.addColorStop(0, dusk ? '#3a2616' : '#55565a'); sand.addColorStop(1, dusk ? '#0d0c0c' : '#2a2b2e');
  g.fillStyle = sand; g.fillRect(0, h * 0.68, w, h * 0.32);
  const glint = g.createLinearGradient(0, h * 0.68, 0, h);
  glint.addColorStop(0, dusk ? 'rgba(255,180,100,.8)' : 'rgba(255,250,230,.7)'); glint.addColorStop(1, 'rgba(255,180,100,0)');
  g.fillStyle = glint; g.beginPath(); g.moveTo(w * 0.57, h * 0.68); g.lineTo(w * 0.63, h * 0.68); g.lineTo(w * 0.74, h); g.lineTo(w * 0.46, h); g.fill();
}

/** Panneau des contrats au-dessus de la console. */
function drawContracts(g: CanvasRenderingContext2D, w: number, h: number, v: GameView | null): void {
  g.clearRect(0, 0, w, h);
  g.fillStyle = 'rgba(6,18,22,.86)'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(127,199,217,.85)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3);
  const font = '"Roboto Condensed", "Arial Narrow", "DejaVu Sans Condensed", sans-serif';
  g.fillStyle = '#7fc7d9'; g.font = `700 30px ${font}`; g.textBaseline = 'middle';
  g.fillText('C O N T R A T S', 28, 40);
  const rows = (v?.contracts ?? []).slice(0, 3);
  rows.forEach((c, i) => {
    const y = 96 + i * 72, k = Math.max(0, Math.min(1, c.goal > 0 ? c.progress / c.goal : 0));
    const col = c.claimed ? 'rgba(127,199,217,.45)' : c.done ? '#9ccf7a' : '#e8a24a';
    g.fillStyle = 'rgba(230,225,211,.92)'; g.font = `500 24px ${font}`;
    g.fillText(c.label.length > 26 ? `${c.label.slice(0, 25)}…` : c.label, 28, y);
    g.fillStyle = col; g.font = `700 24px ${font}`; g.textAlign = 'right';
    g.fillText(c.claimed ? 'réglé' : `${Math.min(c.progress, c.goal)}/${c.goal}`, w - 28, y); g.textAlign = 'left';
    g.fillStyle = 'rgba(127,199,217,.22)'; g.fillRect(28, y + 22, w - 56, 8);
    g.fillStyle = col; g.fillRect(28, y + 22, (w - 56) * k, 8);
  });
  if (!rows.length) { g.fillStyle = 'rgba(230,225,211,.7)'; g.font = `500 24px ${font}`; g.fillText('Aucun contrat pour le moment', 28, 110); }
}

const EXO_H = 2.25;

export interface LabScene {
  scene: THREE.Scene;
  porter: Actor;
  /** Groupe du porteur (position, orientation). */
  porterG: THREE.Group;
  scis: Sci[];
  /** Boîtes invisibles pour le toucher : userData = { kind: 'sci' | 'exo' | 'porte', id, st }. */
  hits: THREE.Object3D[];
  setAmbiance(a: Ambiance): void;
  /** Met à jour ce qui dépend de l'état du jeu (exosquelette, carte, contrats). */
  sync(v: GameView): void;
  /** Ce qui est dessiné : un booléen par poste, et la chambre. Le reste ne coûte rien. */
  show(stations: boolean[], chamber: boolean): void;
  /** Animation continue. depart : 0 au repos, 0→1 pendant la montée en charge du Passeur. */
  tick(t: number, dt: number, depart: number): void;
  /** Assied le porteur au bord du lit (chambre). */
  seatPorter(): void;
  /** Lampe de la chambre : 1 allumée, 0 en veilleuse. */
  lamp(k: number): void;
  /** Chats clandestins installés dans la chambre (0 à 3). */
  setCats(n: number, onReady?: () => void): void;
  dispose(): void;
}

export async function buildLab(vp: Viewport, loader: Loader3D, ambiance: Ambiance): Promise<LabScene> {
  const scene = new THREE.Scene();
  let pal = PALS[ambiance];
  scene.background = new THREE.Color(pal.bg);
  scene.fog = new THREE.Fog(pal.bg, pal.fogNear, pal.fogFar);
  const pm = new THREE.PMREMGenerator(vp.renderer);
  const roomEnv = new RoomEnvironment();
  const env = pm.fromScene(roomEnv, 0.04);
  roomEnv.dispose();
  pm.dispose();
  scene.environment = env.texture;
  scene.environmentIntensity = pal.env;

  const disc = softDiscTexture(128, 0.02, 1.8);
  const shadowTex = softDiscTexture(128, 0.25, 1.5);
  const ramp = canvasTexture(8, 128, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, false);
  // Groupes : la coque du couloir, un groupe par poste, la chambre.
  const shell = new THREE.Group(), chamber = new THREE.Group();
  const G = [new THREE.Group(), new THREE.Group(), new THREE.Group()];
  chamber.position.copy(CHAMBER);
  chamber.visible = false;
  scene.add(shell, ...G, chamber);
  const glowMat = (color: number, opacity: number, map: THREE.Texture | null = null): THREE.MeshBasicMaterial =>
    new THREE.MeshBasicMaterial({ color, map, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
  const box = (to: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    to.add(m);
    return m;
  };

  // ---------- Lumières : une ambiance par poste (cyan aux cartes, bleu clair au Passeur, ambre aux quartiers) ----------
  const hemi = new THREE.HemisphereLight(pal.hemiSky, pal.hemiGround, pal.hemi);
  const win = new THREE.DirectionalLight(pal.window, pal.windowPower);
  win.position.set(1.5, 3.2, -10); win.target.position.set(0, 0.8, 2);
  const key = new THREE.DirectionalLight(pal.key, pal.keyPower);
  key.position.set(-4, 8, 9); key.target.position.set(0, 1, -1);
  scene.add(hemi, win, win.target, key, key.target);
  const points: { l: THREE.PointLight; base: number }[] = [];
  const point = (color: number, power: number, dist: number, x: number, y: number, z: number): THREE.PointLight => {
    const l = new THREE.PointLight(color, power * pal.points, dist, 1.6);
    l.position.set(x, y, z);
    scene.add(l);
    points.push({ l, base: power });
    return l;
  };
  point(0x7fc7d9, 30, 14, SX[0], 3.5, -2.4);
  point(0x7fc7d9, 3, 5.5, SX[0] - 0.2, 2.4, -1.6);    // table holographique
  point(0x9fe6f7, 22, 14, SX[1] + 0.6, 3.6, -0.6);
  const padLight = point(0x8fe3f5, 5, 9, 0, 1.7, PAD.z + 0.9);
  point(0xffc690, 30, 14, SX[2], 3.5, -2.4);
  point(0xb6ffad, 3, 4.5, SX[2] + 1.9, 1.7, -4.0);  // hydroponie
  const lampBase = 9;
  const lampL = point(0xffb070, lampBase, 12, CHAMBER.x - 2.0, 2.4, CHAMBER.z + 0.9);

  // ---------- Coque du couloir ----------
  const W = ROOM.halfW, H = ROOM.height, depth = ROOM.front - ROOM.back, zMid = (ROOM.front + ROOM.back) / 2;
  const ft = floorTextures();
  const floorMat = new THREE.MeshStandardMaterial({ color: pal.floor, map: ft.map, roughnessMap: ft.rough, roughness: Math.min(1, pal.floorRough * 2.1), metalness: 0.35 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, depth), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.z = zMid;
  shell.add(floor);
  const pt = panelTexture();
  const wallMat = new THREE.MeshStandardMaterial({ color: pal.wall, map: pt, roughness: 0.72, metalness: 0.25 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0c1212, roughness: 0.7, metalness: 0.4 });
  const sideMat = wallMat.clone();
  sideMat.map = pt.clone(); sideMat.map.repeat.set(depth / 2.2, 1);
  const WIN_W = 6.6, WIN_Y0 = 0.85, WIN_Y1 = 3.85;
  const sidePanel = W - WIN_W / 2;
  const backMat = wallMat.clone();
  backMat.map = pt.clone(); backMat.map.repeat.set(Math.round(sidePanel / 1.6), 1);
  const wallMats = [wallMat, sideMat, backMat];
  for (const sx of [-1, 1]) box(shell, 0.3, H, depth, sideMat, sx * (W + 0.15), H / 2, zMid);
  // mur du fond : panneaux de part et d'autre de la fenêtre panoramique sur la Plaine Noire (derrière le Passeur)
  for (const sx of [-1, 1]) box(shell, sidePanel, H, 0.3, backMat, sx * (WIN_W / 2 + sidePanel / 2), H / 2, ROOM.back - 0.15);
  box(shell, WIN_W, WIN_Y0, 0.3, darkMat, 0, WIN_Y0 / 2, ROOM.back - 0.15);
  box(shell, WIN_W, H - WIN_Y1, 0.3, darkMat, 0, (H + WIN_Y1) / 2, ROOM.back - 0.15);
  for (const x of [-WIN_W / 2, -WIN_W / 6, WIN_W / 6, WIN_W / 2]) box(shell, 0.1, WIN_Y1 - WIN_Y0, 0.18, darkMat, x, (WIN_Y0 + WIN_Y1) / 2, ROOM.back - 0.05);
  const backdropTex = canvasTexture(1024, 512, (g, w, h) => drawBackdrop(g, w, h, ambiance));
  const backdropMat = new THREE.MeshBasicMaterial({ map: backdropTex, fog: false });
  backdropMat.color.setScalar(pal.backdrop);
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(WIN_W + 2.4, (WIN_W + 2.4) / 2), backdropMat);
  backdrop.position.set(0, (WIN_Y0 + WIN_Y1) / 2 + 0.25, ROOM.back - 0.9);
  shell.add(backdrop);
  // plafond, ses rampes de lumière, et les portiques qui séparent les trois postes
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, depth), darkMat);
  ceil.rotation.x = Math.PI / 2; ceil.position.set(0, H, zMid);
  shell.add(ceil);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xe6f3f7 });
  const stripC = new THREE.MeshBasicMaterial({ color: 0x7fc7d9 }), stripA = new THREE.MeshBasicMaterial({ color: 0xe8a24a });
  const setStrips = (): void => {
    stripC.color.set(0x7fc7d9).multiplyScalar(1.5 * pal.strips); stripA.color.set(0xe8a24a).multiplyScalar(1.4 * pal.strips);
    lampMat.color.set(0xe6f3f7).multiplyScalar(1.25 * pal.strips);
  };
  setStrips();
  for (const sx of SX) for (const dx of [-1.6, 1.6]) box(shell, 1.9, 0.06, 0.36, lampMat, sx + dx, H - 0.04, -1.4);
  for (const x of [-(SX[2] / 2), SX[2] / 2]) {
    box(shell, 0.55, H, 0.7, darkMat, x, H / 2, ROOM.back + 0.35);
    box(shell, 0.55, 0.45, depth, darkMat, x, H - 0.22, zMid);
    box(shell, 0.06, H - 0.6, 0.06, stripC, x, H / 2 - 0.1, ROOM.back + 0.72);
  }
  // bandeaux : cyan en hauteur, ambre au ras du sol, le long du mur du fond
  for (const sx of [-1, 1]) {
    box(shell, sidePanel, 0.05, 0.05, stripC, sx * (WIN_W / 2 + sidePanel / 2), 3.95, ROOM.back + 0.03);
    box(shell, sidePanel, 0.04, 0.05, stripA, sx * (WIN_W / 2 + sidePanel / 2), 0.16, ROOM.back + 0.03);
  }
  // reflet de la baie sur le sol
  const spillMat = glowMat(pal.window, 0.1, ramp);
  const spill = new THREE.Mesh(new THREE.PlaneGeometry(WIN_W * 0.9, 9), spillMat);
  spill.rotation.x = -Math.PI / 2; spill.position.set(0.2, 0.014, ROOM.back + 4.5);
  shell.add(spill);
  // ligne ambre en pointillés au sol, d'un poste à l'autre (comme sur le sol de l'ancien hall)
  const guide = canvasTexture(256, 64, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#fff'; for (let x = 0; x < w; x += 64) g.fillRect(x + 8, h / 2 - 5, 40, 10); }, false);
  guide.wrapS = THREE.RepeatWrapping; guide.repeat.set(20, 1);
  const guideMesh = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, 0.5), new THREE.MeshBasicMaterial({ map: guide, color: 0xe8a24a, transparent: true, opacity: 0.5, depthWrite: false }));
  guideMesh.rotation.x = -Math.PI / 2; guideMesh.position.set(0, 0.016, 2.3);
  shell.add(guideMesh);
  // poussière en suspension
  const ND = 260, dp = new Float32Array(ND * 3);
  for (let i = 0; i < ND; i++) { dp[i * 3] = (hash(i * 1.3) - 0.5) * W * 2; dp[i * 3 + 1] = 0.2 + hash(i * 2.7) * (H - 0.5); dp[i * 3 + 2] = ROOM.back + hash(i * 4.1) * 10; }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dust = new THREE.Points(dg, new THREE.PointsMaterial({ map: disc, color: 0xffe3c0, size: 0.045, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
  shell.add(dust);

  // ---------- Modèles ----------
  const sciIds: SciId[] = ['iris', 'noe', 'selma'];
  const [tele, exoM, holoM, consoleM, litM, racks, caisses, hydro, med, bench, porterM, ...sciM] = await Promise.all([
    loader.load('teleporteur', { height: 3.1 }), loader.load('exo_rack', { height: EXO_H }), loader.load('holo_table', { height: 1.5 }),
    loader.load('lab_console', { height: 1.35 }), loader.load('lit_repos', { width: 2.6 }), loader.load('lab_racks', { height: 2.3 }),
    loader.load('lab_caisses', { height: 1.1 }), loader.load('hydroponie', { height: 1.85 }), loader.load('med_bay', { height: 1.9 }),
    loader.load('workbench', { height: 1.25 }),
    loader.load('porteur_civil', { height: 1.78, fallback: 'perso' }),
    ...sciIds.map(id => loader.load(CAST[id].model, { height: id === 'noe' ? 1.8 : 1.7, fallback: 'perso' })),
  ]);
  const models: Model[] = [tele, exoM, holoM, consoleM, litM, racks, caisses, hydro, med, bench, porterM, ...sciM];
  const copy = (m: Model): Model => ({ ...m, root: m.root.clone(true) as THREE.Group });
  const place = (to: THREE.Object3D, m: Model, x: number, z: number, ry: number, shadow = 0.6): THREE.Group => {
    const g = new THREE.Group();
    g.add(m.root);
    g.position.set(x, 0, z); g.rotation.y = ry;
    g.add(blobShadow(shadowTex, m.size.x * 1.35, m.size.z * 1.6, shadow));
    to.add(g);
    return g;
  };
  // Poste 1 — Salle des cartes : table holographique, console des contrats, baies de calcul
  const HOLO = V(SX[0] - 0.25, 0, -2.3), CONSOLE = V(SX[0] - 1.75, 0, -4.1);
  place(G[0], holoM, HOLO.x, HOLO.z, -0.3);
  place(G[0], consoleM, CONSOLE.x, CONSOLE.z, 0.45);
  place(G[0], racks, SX[0] + 1.9, -5.15, -0.1);
  place(G[0], caisses, SX[0] + 3.0, -1.2, 0.5);
  // Poste 2 — Le Passeur : téléporteur, râtelier de l'exosquelette, établi de Noé
  place(G[1], tele, PAD.x, PAD.z, 0, 0.5);
  const exoG = place(G[1], exoM, EXO_AT.x, EXO_AT.z, 0.45);
  place(G[1], bench, 3.0, -4.9, -0.15);
  // Poste 3 — Quartiers : baie médicale, hydroponie, porte de la chambre
  place(G[2], med, SX[2] + 3.3, -2.6, -0.9);
  place(G[2], hydro, SX[2] + 1.95, -4.9, -0.15);
  place(G[2], copy(racks), SX[2] - 2.6, -5.15, 0.1);
  place(G[2], copy(caisses), SX[2] - 3.1, -1.6, 0.4);
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x1b2225, metalness: 0.6, roughness: 0.4 });
  box(G[2], 1.9, 3.0, 0.14, doorMat, DOOR_AT.x, 1.5, DOOR_AT.z);
  box(G[2], 0.05, 3.0, 0.16, darkMat, DOOR_AT.x, 1.5, DOOR_AT.z + 0.01);
  box(G[2], 2.0, 0.05, 0.05, stripA, DOOR_AT.x, 3.06, DOOR_AT.z + 0.08);
  for (const dx of [-1, 1]) box(G[2], 0.05, 3.0, 0.05, stripA, DOOR_AT.x + dx * 1.0, 1.5, DOOR_AT.z + 0.08);
  const doorTex = canvasTexture(256, 64, (g, w) => {
    g.fillStyle = '#e8a24a'; g.font = '700 34px "Roboto Condensed", "Arial Narrow", "DejaVu Sans Condensed", sans-serif'; g.textAlign = 'center';
    g.fillText('Q U A R T I E R S', w / 2, 44, w - 8);
  });
  const doorLabel = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ map: doorTex, transparent: true, fog: false }));
  doorLabel.position.set(DOOR_AT.x, 3.36, DOOR_AT.z + 0.1);
  G[2].add(doorLabel);
  const doorGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: disc, color: 0xffc690, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  doorGlow.position.set(DOOR_AT.x, 1.5, DOOR_AT.z + 0.3); doorGlow.scale.set(3, 4.2, 1);
  G[2].add(doorGlow);

  // Le Passeur : disque au sol, colonne de lumière, halo dans l'anneau
  const padDisc = new THREE.Mesh(new THREE.CircleGeometry(1.25, 48), glowMat(0x7fc7d9, 0.3, disc));
  padDisc.rotation.x = -Math.PI / 2; padDisc.position.set(PAD.x, 0.03, PAD.z + 0.5); padDisc.scale.set(1.6, 1.6, 1);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, H, 28, 1, true), glowMat(0x9fe6f7, 0, ramp));
  column.position.set(PAD.x, H / 2, PAD.z + 0.5); column.rotation.x = Math.PI;
  const ringGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: disc, color: 0x8fe3f5, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  ringGlow.position.set(PAD.x, 1.6, PAD.z + 0.1); ringGlow.scale.setScalar(3.8);
  G[1].add(padDisc, column, ringGlow);

  // ---------- Exosquelette : l'arbre de compétences rendu visible ----------
  // Chaque zone du modèle appartient à une branche. Une zone sans compétence reste un fantôme sombre
  // parcouru de lignes ; elle se matérialise puis s'illumine à mesure que la branche progresse.
  const exoU = { uLv: { value: new THREE.Vector4(0, 0, 0, 0) }, uT: { value: 0 }, uToRack: { value: new THREE.Matrix4() }, uPulse: { value: 0 } };
  exoG.updateMatrixWorld(true);
  const invRack = new THREE.Matrix4().copy(exoG.matrixWorld).invert();
  exoM.root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    exoU.uToRack.value.multiplyMatrices(invRack, m.matrixWorld);
    const mat = m.material as THREE.MeshStandardMaterial;
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, exoU);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 uToRack;\nvarying vec3 vRack;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRack = (uToRack * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec4 uLv; uniform float uT; uniform float uPulse; varying vec3 vRack;
          void exoZone(out float lv, out vec3 tint) {
            float y = vRack.y / ${EXO_H.toFixed(2)};
            if (y > 0.8) { lv = uLv.x; tint = vec3(0.5, 0.78, 0.85); }
            else if (y < 0.36) { lv = uLv.z; tint = vec3(0.61, 0.81, 0.48); }
            else if (abs(vRack.x) > 0.2) { lv = uLv.y; tint = vec3(0.91, 0.64, 0.29); }
            else { lv = uLv.w; tint = vec3(0.94, 0.78, 0.37); }
          }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float exoLv; vec3 exoTint; exoZone(exoLv, exoTint);
          float exoOn = step(0.001, exoLv);
          diffuseColor.rgb = mix(vec3(0.01, 0.026, 0.032), diffuseColor.rgb * mix(vec3(1.0), exoTint * 1.4, 0.25) * (0.42 + 0.3 * exoLv), exoOn);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float exoScan = pow(0.5 + 0.5 * sin(vRack.y * 46.0 - uT * 1.6), 10.0);
          totalEmissiveRadiance += (1.0 - exoOn) * vec3(0.08, 0.36, 0.46) * (0.08 + 0.8 * exoScan);
          totalEmissiveRadiance += exoOn * exoTint * (0.015 + 0.05 * exoLv) * (1.0 + 0.25 * sin(uT * 2.0 + vRack.y * 3.0)) + exoOn * exoTint * uPulse;`);
    };
    mat.customProgramCacheKey = () => 'exo-zones';
  });
  // Un témoin lumineux par branche, à l'endroit de sa zone
  const nodeAt: Record<SkillBranch, [number, number, number]> = { scanner: [0, 2.12, 0.3], portage: [0.62, 1.55, 0.25], endurance: [-0.5, 0.5, 0.35], 'réseau': [0, 1.25, 0.32] };
  const exoNodes = BRANCHES.map(b => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: disc, color: BRANCH_COLOR[b], transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false }));
    s.position.set(...nodeAt[b]);
    exoG.add(s);
    return s;
  });

  // ---------- Table holographique : la France et le réseau ----------
  const holo = new THREE.Group();
  G[0].add(holo);
  holo.position.set(HOLO.x, 2.02, HOLO.z);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x7fc7d9, transparent: true, opacity: 0.95, fog: false });
  lineMat.color.multiplyScalar(1.7);
  const map3d = new THREE.Group();
  map3d.rotation.x = 0.95;
  map3d.scale.setScalar(1.25);
  holo.add(map3d);
  for (const poly of [FRANCE, CORSE]) {
    const pts = poly.map(([lng, lat]) => { const [x, z] = frXZ(lng, lat); return new THREE.Vector3(x, 0, z); });
    map3d.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
  }
  // semis de points à l'intérieur du pays : les abris encore silencieux
  const dots: number[] = [];
  for (let lat = 42.6; lat < 51; lat += 0.62) for (let lng = -4.6; lng < 8.2; lng += 0.9) {
    if (inFrance(lng, lat)) { const [x, z] = frXZ(lng, lat); dots.push(x, 0, z); }
  }
  const dotsGeo = new THREE.BufferGeometry();
  dotsGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(dots), 3));
  map3d.add(new THREE.Points(dotsGeo, new THREE.PointsMaterial({ map: disc, color: 0x7fc7d9, size: 0.035, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.012, 0.3, 8), glowMat(0xffb35c, 0.95));
  beacon.geometry.translate(0, 0.15, 0);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), glowMat(0xffb35c, 0.8));
  ring.rotation.x = -Math.PI / 2;
  const linkGeo = new THREE.BufferGeometry();
  const links = new THREE.LineSegments(linkGeo, new THREE.LineBasicMaterial({ color: 0xffb35c, transparent: true, opacity: 0.9, fog: false }));
  const nodesGeo = new THREE.BufferGeometry();
  const nodes = new THREE.Points(nodesGeo, new THREE.PointsMaterial({ map: disc, color: 0xffc27a, size: 0.075, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  map3d.add(beacon, ring, links, nodes);
  const holoCone = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.12, 1.15, 28, 1, true), glowMat(0x7fc7d9, 0.07, ramp));
  holoCone.position.set(HOLO.x, 1.42, HOLO.z);
  G[0].add(holoCone);

  // ---------- Console : panneau des contrats ----------
  const contractTex = canvasTexture(512, 320, (g, w, h) => drawContracts(g, w, h, null));
  const contractMat = new THREE.MeshBasicMaterial({ map: contractTex, transparent: true, opacity: 0.96, depthWrite: false, fog: false, side: THREE.DoubleSide });
  contractMat.color.setScalar(1.25);
  const contractPanel = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.94), contractMat);
  contractPanel.position.set(CONSOLE.x + 0.05, 2.25, CONSOLE.z + 0.1); contractPanel.rotation.y = 0.3; contractPanel.rotation.x = -0.05;
  G[0].add(contractPanel);

  // ---------- Chambre des quartiers (ancien : plancher, tapis, lit, miroir sur pied, petite fenêtre, lampe chaude) ----------
  const plank = canvasTexture(512, 512, (g, w) => {
    for (let i = 0; i < 8; i++) {
      const v = 120 + hash(i * 3.1) * 40;
      g.fillStyle = `rgb(${v + 30},${v},${v - 28})`; g.fillRect(0, i * 64, w, 63);
      g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(0, i * 64 + 63, w, 1);
      for (let k = 0; k < 30; k++) { g.fillStyle = `rgba(0,0,0,${hash(i * 40 + k) * 0.1})`; g.fillRect(hash(k * 7 + i) * w, i * 64 + hash(k * 13 + i) * 60, 40 + hash(k) * 90, 1.5); }
    }
  });
  plank.wrapS = plank.wrapT = THREE.RepeatWrapping; plank.repeat.set(2, 2);
  const cFloor = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshStandardMaterial({ map: plank, color: 0x8a7462, roughness: 0.8 }));
  cFloor.rotation.x = -Math.PI / 2;
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.3, 40), new THREE.MeshStandardMaterial({ color: 0x7a4e33, roughness: 1 }));
  rug.rotation.x = -Math.PI / 2; rug.position.set(0.3, 0.01, 0.3);
  const cwTex = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#8d9496'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 64) { g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x, 0, 2, h); }
    g.fillStyle = 'rgba(232,162,74,.75)'; g.fillRect(0, h * 0.82, w, 3);
  });
  cwTex.wrapS = THREE.RepeatWrapping; cwTex.repeat.set(3, 1);
  const cwMat = new THREE.MeshStandardMaterial({ map: cwTex, color: 0x59605f, roughness: 0.85 });
  for (const [x, z, ry] of [[0, -3.5, 0], [-3.5, 0, Math.PI / 2], [3.5, 0, -Math.PI / 2]] as const) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.6), cwMat);
    m.position.set(x, 1.8, z); m.rotation.y = ry;
    chamber.add(m);
  }
  const cCeil = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), darkMat);
  cCeil.rotation.x = Math.PI / 2; cCeil.position.y = 3.6;
  const cWin = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), backdropMat);
  cWin.position.set(1.5, 2.0, -3.48);
  box(chamber, 2.36, 0.08, 0.1, darkMat, 1.5, 2.59, -3.46); box(chamber, 2.36, 0.08, 0.1, darkMat, 1.5, 1.41, -3.46);
  for (const dx of [-1.14, 1.14]) box(chamber, 0.08, 1.26, 0.1, darkMat, 1.5 + dx, 2.0, -3.46);
  const mirror = new THREE.Group();
  mirror.position.set(2.4, 0, -1.6); mirror.rotation.y = -0.7;
  box(mirror, 0.8, 1.9, 0.06, new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.6 }), 0, 1.05, 0);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 1.74), new THREE.MeshStandardMaterial({ color: 0x9fb6c0, metalness: 1, roughness: 0.08 }));
  glass.position.set(0, 1.05, 0.035);
  mirror.add(glass);
  chamber.add(cFloor, rug, cCeil, cWin, mirror);
  const BED = V(-1.1, 0, -2.2);
  const bedG = place(chamber, litM, BED.x, BED.z, 0, 0.5);
  place(chamber, copy(caisses), 2.7, 0.9, -0.5);
  const lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: disc, color: 0xffc690, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  lampGlow.position.set(-2.6, 2.3, -1.4); lampGlow.scale.setScalar(2.2);
  chamber.add(lampGlow);
  box(chamber, 0.16, 0.16, 0.16, new THREE.MeshBasicMaterial({ color: 0xffd9a8 }), -2.6, 2.3, -1.4);
  box(chamber, 0.03, 1.3, 0.03, darkMat, -2.6, 2.95, -1.4);

  // ---------- Personnages ----------
  const porter = new Actor(porterM);
  const pg = new THREE.Group();
  scene.add(pg);
  pg.add(porterM.root, blobShadow(shadowTex, 0.9, 0.9, 0.6));
  pg.position.copy(porterSpot(1)); pg.rotation.y = 0.55;
  porter.play(porter.pick('calm_0', 'calmv0', 'idle'), 0);
  const scis: Sci[] = sciIds.map((id, i) => {
    const m = sciM[i], actor = new Actor(m), g = new THREE.Group();
    G[SCI_AT[id].st].add(g);
    g.add(m.root, blobShadow(shadowTex, 0.9, 0.9, 0.6));
    g.position.copy(SCI_AT[id].at); g.rotation.y = SCI_AT[id].ry;
    actor.play(actor.pick('calm_0', 'calmv0'), 0);
    actor.mixer.update(i * 0.7); // désynchronise les respirations
    return { id, st: SCI_AT[id].st, actor, head: SCI_AT[id].at.clone().setY(m.size.y + 0.12), talkUntil: 0, nextIdle: 6 + i * 4 };
  });

  // ---------- Boîtes de toucher ----------
  const hits: THREE.Object3D[] = [];
  const hitMat = new THREE.MeshBasicMaterial();
  const hitGeo = new THREE.BoxGeometry(1, 1, 1);
  const hit = (kind: 'sci' | 'exo' | 'porte', id: string, st: number, c: THREE.Vector3, s: THREE.Vector3): void => {
    const m = new THREE.Mesh(hitGeo, hitMat);
    m.position.copy(c); m.scale.copy(s); m.visible = false; m.userData = { kind, id, st };
    m.updateMatrixWorld(true);
    scene.add(m); hits.push(m);
  };
  for (const id of sciIds) hit('sci', id, SCI_AT[id].st, SCI_AT[id].at.clone().setY(0.9), V(0.8, 1.8, 0.8));
  hit('exo', 'exo', 1, EXO_AT.clone().setY(1.15), V(1.5, 2.3, 1.2));
  hit('porte', 'porte', 2, DOOR_AT.clone().setY(1.6), V(2, 3.2, 0.6));

  for (const m of models) setEnvIntensity(m.root, 1);

  const setAmbiance = (a: Ambiance): void => {
    pal = PALS[a];
    (scene.background as THREE.Color).set(pal.bg);
    const fog = scene.fog as THREE.Fog;
    fog.color.set(pal.bg); fog.near = pal.fogNear; fog.far = pal.fogFar;
    scene.environmentIntensity = pal.env;
    hemi.color.set(pal.hemiSky); hemi.groundColor.set(pal.hemiGround); hemi.intensity = pal.hemi;
    win.color.set(pal.window); win.intensity = pal.windowPower;
    key.color.set(pal.key); key.intensity = pal.keyPower;
    for (const p of points) p.l.intensity = p.base * pal.points;
    for (const m of wallMats) m.color.set(pal.wall);
    floorMat.color.set(pal.floor); floorMat.roughness = Math.min(1, pal.floorRough * 2.1);
    darkMat.color.set(a === 'clair' ? 0x4a5252 : 0x0c1212);
    spillMat.color.set(pal.window);
    setStrips();
    const g = (backdropTex.image as HTMLCanvasElement).getContext('2d');
    if (g) { drawBackdrop(g, 1024, 512, a); backdropTex.needsUpdate = true; }
    backdropMat.color.setScalar(pal.backdrop);
    // sur fond clair, l'hologramme passe en bleu soutenu pour rester lisible
    if (a === 'clair') lineMat.color.set(0x0b6781); else lineMat.color.set(0x7fc7d9).multiplyScalar(1.7);
  };
  setAmbiance(ambiance);

  let levels = new THREE.Vector4(), sig = '';
  const sync = (v: GameView): void => {
    const lv = branchLevels(v);
    levels = new THREE.Vector4(lv.scanner, lv.portage, lv.endurance, lv['réseau']);
    exoU.uLv.value.copy(levels);
    // Signature de ce qui est dessiné : on ne redessine que si elle change.
    const at = v.player.at;
    const s = `${v.contracts.map(c => `${c.id}:${c.progress}:${c.done}:${c.claimed}`).join('|')}#${at ? `${at[0].toFixed(2)},${at[1].toFixed(2)}` : '-'}#${v.shelters.map(h => `${h.id}${h.stars > 0 ? 1 : 0}`).join('')}`;
    if (s === sig) return;
    sig = s;
    const g = (contractTex.image as HTMLCanvasElement).getContext('2d');
    if (g) { drawContracts(g, 512, 320, v); contractTex.needsUpdate = true; }
    // Carte : la balise du porteur et les abris autour de lui (écartés pour rester lisibles).
    const here = at && at[0] > -5.5 && at[0] < 9.8 && at[1] > 41 && at[1] < 51.5 ? frXZ(at[0], at[1]) : null;
    beacon.visible = ring.visible = links.visible = nodes.visible = !!here;
    if (here && at) {
      beacon.position.set(here[0], 0, here[1]); ring.position.set(here[0], 0.002, here[1]);
      const np: number[] = [], lp: number[] = [];
      v.shelters.slice(0, 10).forEach((h, i) => {
        if (h.stars <= 0) return;
        const a = Math.atan2(h.at[1] - at[1], (h.at[0] - at[0]) * 0.69) + i * 0.4, r = 0.075 + (i % 3) * 0.035;
        const x = here[0] + Math.cos(a) * r, z = here[1] - Math.sin(a) * r;
        np.push(x, 0.02, z); lp.push(here[0], 0.02, here[1], x, 0.02, z);
      });
      nodesGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(np), 3));
      linkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lp), 3));
    }
  };

  const shown = [true, true, true];
  let chamberOn = false;
  const show = (stations: boolean[], ch: boolean): void => {
    for (let i = 0; i < 3; i++) { shown[i] = !!stations[i]; G[i].visible = shown[i]; }
    chamberOn = ch;
    chamber.visible = ch;
    shell.visible = stations.some(Boolean);
  };

  // Assise : le dessus du matelas est cherché par un rayon, comme dans l'ancien.
  let seatTop = -1;
  const seatPorter = (): void => {
    if (seatTop < 0) {
      bedG.updateMatrixWorld(true);
      const was = chamber.visible;
      chamber.visible = true;
      const rc = new THREE.Raycaster(V(CHAMBER.x + BED.x, 1.25, CHAMBER.z + BED.z + litM.size.z * 0.2), V(0, -1, 0));
      const h = rc.intersectObject(litM.root, true).find(x => x.point.y < 1.15);
      chamber.visible = was;
      seatTop = h ? h.point.y : 0.5;
    }
    const sit = porter.pick('Chair_Sit_Idle_M');
    if (sit) {
      porter.play(sit, 0);
      pg.position.set(CHAMBER.x + BED.x + 0.15, Math.max(0, seatTop - 0.47), CHAMBER.z + BED.z + litM.size.z * 0.5 - 0.22);
      pg.rotation.y = 0.15;
    } else {
      pg.position.set(CHAMBER.x + 0.5, 0, CHAMBER.z + 0.2); pg.rotation.y = 0.3;
    }
    porter.update(0);
  };
  const lamp = (k: number): void => {
    const i = points.find(p => p.l === lampL);
    if (i) { i.base = lampBase * (0.25 + 0.75 * k); lampL.intensity = i.base * Math.max(0.8, pal.points); }
    lampGlow.material.opacity = 0.12 + 0.28 * k;
  };
  lamp(1);

  // Chats clandestins (ancien : jusqu'à trois, sur le tapis ; ici resserrés pour tenir dans le cadre vertical).
  const catSpots: [number, number, number][] = [[0.2, -0.85, -0.6], [-0.75, -0.4, 0.7], [0.3, -0.15, 2.4]];
  const cats: THREE.Object3D[] = [];
  let catModel: Promise<Model> | null = null, catWant = 0, gone = false;
  const setCats = (n: number, onReady?: () => void): void => {
    catWant = Math.max(0, Math.min(3, Math.floor(n)));
    cats.forEach((c, i) => { c.visible = i < catWant; });
    if (catWant <= cats.length) return;
    catModel ??= loader.load('chat_clandestin', { width: 0.42 });
    void catModel.then(m => {
      if (gone || !m.ok) return;
      while (cats.length < catWant) {
        const i = cats.length, g = place(chamber, i === 0 ? m : copy(m), catSpots[i][0], catSpots[i][1], catSpots[i][2], 0.5);
        setEnvIntensity(g, 1);
        cats.push(g);
      }
      cats.forEach((c, i) => { c.visible = i < catWant; });
      onReady?.();
    });
  };

  const dpos = dg.attributes.position as THREE.BufferAttribute;
  const tick = (t: number, dt: number, depart: number): void => {
    porter.update(dt);
    for (const s of scis) {
      if (!shown[s.st]) continue;
      s.actor.update(dt);
      // Au repos, un geste de temps en temps ; après une réplique, retour au calme.
      if (s.talkUntil && t > s.talkUntil) { s.talkUntil = 0; s.actor.play(s.actor.pick('calm_0', 'calmv0'), 0.6); s.nextIdle = t + 8 + hash(t) * 8; }
      else if (!s.talkUntil && t > s.nextIdle) {
        const cur = s.actor.currentName, next = cur === 'calm_0' ? s.actor.pick(hash(t * 3) > 0.5 ? 'calmv2' : 'calmv3', 'calm_0') : s.actor.pick('calm_0', 'calmv0');
        s.actor.play(next, 0.8);
        s.nextIdle = t + (next === 'calm_0' ? 9 + hash(t) * 9 : Math.max(3, s.actor.duration(next) - 0.8));
      }
    }
    if (chamberOn) return;
    if (shown[1]) {
      exoU.uT.value = t;
      exoNodes.forEach((n, i) => {
        const lv = levels.getComponent(i);
        n.material.opacity = lv > 0 ? 0.25 + lv * 0.35 + Math.sin(t * 2 + i) * 0.06 : 0.1 + Math.max(0, Math.sin(t * 1.4 + i * 1.7)) * 0.12;
        n.scale.setScalar(lv > 0 ? 0.3 + lv * 0.3 : 0.16);
      });
      // Le Passeur respire ; au départ, la colonne monte en charge.
      const breathe = 0.5 + 0.5 * Math.sin(t * 1.3);
      (padDisc.material as THREE.MeshBasicMaterial).opacity = 0.22 + breathe * 0.1 + depart * 0.5;
      (column.material as THREE.MeshBasicMaterial).opacity = depart * 0.75;
      column.scale.set(1 - depart * 0.35, 1, 1 - depart * 0.35);
      ringGlow.material.opacity = 0.2 + breathe * 0.08 + depart * 0.6;
      padLight.intensity = (5 + breathe * 1 + depart * 30) * pal.points;
    }
    if (shown[0]) {
      map3d.rotation.y = Math.sin(t * 0.25) * 0.35;
      holo.position.y = 2.02 + Math.sin(t * 0.9) * 0.02;
      const rs = 0.03 + ((t * 0.5) % 1) * 0.16;
      ring.scale.setScalar(rs); (ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - ((t * 0.5) % 1));
      lineMat.opacity = 0.85 + Math.sin(t * 3.1) * 0.08;
      contractPanel.position.y = 2.25 + Math.sin(t * 0.8 + 1) * 0.015;
    }
    if (shown[2]) doorGlow.material.opacity = 0.2 + Math.sin(t * 0.9) * 0.05;
    if (dt > 0) {
      for (let i = 0; i < dpos.count; i++) {
        let y = dpos.getY(i) + dt * (0.02 + hash(i) * 0.03);
        if (y > H - 0.2) y = 0.2;
        dpos.setY(i, y);
        dpos.setX(i, dpos.getX(i) + Math.sin(t * 0.3 + i) * dt * 0.02);
      }
      dpos.needsUpdate = true;
    }
    dust.material.opacity = 0.4 + Math.sin(t * 0.5) * 0.08;
  };

  const dispose = (): void => {
    gone = true;
    porter.dispose();
    for (const s of scis) s.actor.dispose();
    scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = (m as { material?: THREE.Material | THREE.Material[] }).material;
      for (const mat of Array.isArray(mats) ? mats : mats ? [mats] : []) {
        const tex = (mat as THREE.MeshBasicMaterial).map;
        if (tex) tex.dispose();
        const r = (mat as THREE.MeshStandardMaterial).roughnessMap;
        if (r) r.dispose();
        mat.dispose();
      }
    });
    for (const t of [disc, shadowTex, ramp, pt]) t.dispose();
    env.dispose();
    scene.environment = null;
  };

  return { scene, porter, porterG: pg, scis, hits, setAmbiance, sync, show, tick, seatPorter, lamp, setCats, dispose };
}
