// Décor 3D de la Station Lumen : salle, lumières, postes, scientifiques, exosquelette et hologrammes.
// Tout est construit ici ; src/lab/lab.ts s'occupe de la caméra, des gestes et de l'interface.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Ambiance, GameView, SkillBranch } from '../game/api';
import { Actor, type Loader3D, type Model, type Viewport, blobShadow, canvasTexture, hash, setEnvIntensity, softDiscTexture } from '../scene3d/kit';
import { CAST, type SciId, type StationId } from './texts';

// ---------- Plan de la salle (mètres ; x vers la droite, z vers la caméra) ----------
export const ROOM = { halfW: 4.3, back: -6.4, front: 10, height: 5.2 } as const;
const PAD = new THREE.Vector3(0, 0, -3.9);
const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

export interface StationDef {
  id: StationId;
  /** Point visé par la caméra. */
  look: THREE.Vector3;
  /** Position de la caméra, format vertical. */
  cam: THREE.Vector3;
  /** Ancre de l'étiquette flottante. */
  tag: THREE.Vector3;
  /** Boîte de toucher : centre et dimensions. */
  hit: [THREE.Vector3, THREE.Vector3];
}
const AT = { exo: V(-2.15, 0, -2.0), holo: V(2.15, 0, -1.1), console: V(-2.1, 0, 3.2), lit: V(2.1, 0, 4.0) } as const;
export const STATIONS: StationDef[] = [
  { id: 'teleporteur', look: V(0, 1.4, -3.9), cam: V(0.9, 2.8, 3.6), tag: V(0, 3.1, -3.9), hit: [V(0, 1.5, -3.9), V(3.4, 3, 1.6)] },
  { id: 'exo', look: V(-2.15, 1.05, -2.0), cam: V(-0.6, 2.7, 3.3), tag: V(-2.15, 2.6, -2.0), hit: [V(-2.15, 1.15, -2.0), V(1.7, 2.3, 1.2)] },
  { id: 'holo', look: V(2.15, 1.45, -1.1), cam: V(0.5, 3.2, 4.1), tag: V(2.15, 2.75, -1.1), hit: [V(2.15, 1.2, -1.1), V(1.8, 2.4, 1.8)] },
  { id: 'console', look: V(-2.1, 1.25, 3.2), cam: V(-0.3, 2.7, 8.2), tag: V(-2.1, 2.85, 3.2), hit: [V(-2.1, 0.9, 3.2), V(2.2, 1.9, 1.3)] },
  { id: 'lit', look: V(2.0, 0.85, 4.0), cam: V(0.3, 2.5, 8.8), tag: V(2.1, 2.1, 4.0), hit: [V(2.1, 0.9, 4.0), V(2.1, 1.8, 1.9)] },
];
/** Vue d'ensemble, format vertical : en plongée, comme une maquette, pour que toute la profondeur de la salle tienne dans la hauteur. */
export const OVERVIEW = { cam: V(0, 11.2, 14.6), look: V(0, 0.7, 0.1), fov: 42 } as const;
/** Format paysage : la caméra descend dans la salle. */
export const OVERVIEW_WIDE = { cam: V(0, 3.4, 9.6), look: V(0, 1.2, -1.5), fov: 40 } as const;

const SCI_AT: Record<SciId, { at: THREE.Vector3; ry: number }> = {
  noe: { at: V(-0.95, 0, -1.3), ry: 0.5 },
  iris: { at: V(0.95, 0, -0.5), ry: 0.6 },
  selma: { at: V(0.95, 0, 3.3), ry: 0.35 },
};
export const PORTER_AT = V(-0.5, 0, 1.3);
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
    hemiSky: 0x5d8a92, hemiGround: 0x140f0a, hemi: 0.5, window: 0xff9a4d, windowPower: 1.25, key: 0xbfd9e2, keyPower: 0.7,
    exposure: 1.0, bloom: 0.4, env: 0.22, backdrop: 1.9, points: 1, strips: 1,
  },
  'clair': {
    bg: 0xcfd3cc, fogNear: 26, fogFar: 80, wall: 0xb9b8ab, floor: 0x767a76, floorRough: 0.38,
    hemiSky: 0xe9f1f4, hemiGround: 0x8a8272, hemi: 1.9, window: 0xfff1d6, windowPower: 2.4, key: 0xffffff, keyPower: 1.5,
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

export interface Sci { id: SciId; actor: Actor; head: THREE.Vector3; talkUntil: number; nextIdle: number }

export interface LabScene {
  scene: THREE.Scene;
  porter: Actor;
  scis: Sci[];
  /** Boîtes invisibles pour le toucher : userData = { kind: 'poste' | 'sci', id }. */
  hits: THREE.Object3D[];
  setAmbiance(a: Ambiance): void;
  /** Met à jour ce qui dépend de l'état du jeu (exosquelette, carte, contrats). */
  sync(v: GameView): void;
  /** Animation continue. depart : 0 au repos, 0→1 pendant la montée en charge du Passeur. */
  tick(t: number, dt: number, depart: number): void;
  dispose(): void;
}

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
  const add = <T extends THREE.Object3D>(o: T): T => { scene.add(o); return o; };
  const glowMat = (color: number, opacity: number, map: THREE.Texture | null = null): THREE.MeshBasicMaterial =>
    new THREE.MeshBasicMaterial({ color, map, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return add(m);
  };

  // ---------- Lumières ----------
  const hemi = add(new THREE.HemisphereLight(pal.hemiSky, pal.hemiGround, pal.hemi));
  const win = add(new THREE.DirectionalLight(pal.window, pal.windowPower));
  win.position.set(1.5, 3.2, -10); win.target.position.set(0, 0.8, 2); scene.add(win.target);
  const key = add(new THREE.DirectionalLight(pal.key, pal.keyPower));
  key.position.set(-4, 8, 9); key.target.position.set(0, 1, -1); scene.add(key.target);
  const points: { l: THREE.PointLight; base: number }[] = [];
  const point = (color: number, power: number, dist: number, x: number, y: number, z: number): THREE.PointLight => {
    const l = add(new THREE.PointLight(color, power * pal.points, dist, 1.6));
    l.position.set(x, y, z);
    points.push({ l, base: power });
    return l;
  };
  const padLight = point(0x8fe3f5, 5, 9, 0, 1.7, -3.0);
  point(0xffa448, 4, 6, -1.8, 1.6, 3.4);     // console
  point(0x7fc7d9, 3, 5.5, 2.0, 2.4, -0.5);   // table holographique
  point(0xffc690, 2.5, 4.5, 2.2, 1.3, 3.2);  // couchette
  point(0xffe2b8, 2.6, 6, -2.0, 3.0, -1.0);  // râtelier
  point(0xb6ffad, 2.5, 4.5, 3.2, 1.5, 1.3);  // hydroponie

  // ---------- Salle ----------
  const W = ROOM.halfW, depth = ROOM.front - ROOM.back, zMid = (ROOM.front + ROOM.back) / 2;
  const ft = floorTextures();
  const floorMat = new THREE.MeshStandardMaterial({ color: pal.floor, map: ft.map, roughnessMap: ft.rough, roughness: pal.floorRough * 1.6, metalness: 0.35 });
  const floor = add(new THREE.Mesh(new THREE.PlaneGeometry(W * 2, depth), floorMat));
  floor.rotation.x = -Math.PI / 2; floor.position.z = zMid;
  const pt = panelTexture();
  const wallMat = new THREE.MeshStandardMaterial({ color: pal.wall, map: pt, roughness: 0.72, metalness: 0.25 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0c1212, roughness: 0.7, metalness: 0.4 });
  const sideMat = wallMat.clone();
  sideMat.map = pt.clone(); sideMat.map.repeat.set(depth / 2.2, 1);
  const backMat = wallMat.clone();
  backMat.map = pt.clone(); backMat.map.repeat.set(1, 1);
  const wallMats = [wallMat, sideMat, backMat];
  for (const sx of [-1, 1]) box(0.3, ROOM.height, depth, sideMat, sx * (W + 0.15), ROOM.height / 2, zMid);
  // mur du fond autour de la baie (5,2 m de large, de 0,9 à 4,1 m)
  const WIN_W = 5.2, WIN_Y0 = 0.9, WIN_Y1 = 4.15;
  const sidePanel = (W * 2 - WIN_W) / 2;
  for (const sx of [-1, 1]) box(sidePanel, ROOM.height, 0.3, backMat, sx * (WIN_W / 2 + sidePanel / 2), ROOM.height / 2, ROOM.back - 0.15);
  box(WIN_W, WIN_Y0, 0.3, darkMat, 0, WIN_Y0 / 2, ROOM.back - 0.15);
  box(WIN_W, ROOM.height - WIN_Y1, 0.3, darkMat, 0, (ROOM.height + WIN_Y1) / 2, ROOM.back - 0.15);
  for (const x of [-WIN_W / 2, -WIN_W / 6, WIN_W / 6, WIN_W / 2]) box(0.09, WIN_Y1 - WIN_Y0, 0.16, darkMat, x, (WIN_Y0 + WIN_Y1) / 2, ROOM.back - 0.05);
  const backdropTex = canvasTexture(1024, 512, (g, w, h) => drawBackdrop(g, w, h, ambiance));
  const backdropMat = new THREE.MeshBasicMaterial({ map: backdropTex, fog: false });
  backdropMat.color.setScalar(pal.backdrop);
  const backdrop = add(new THREE.Mesh(new THREE.PlaneGeometry(WIN_W + 1.6, (WIN_W + 1.6) / 2), backdropMat));
  backdrop.position.set(0, (WIN_Y0 + WIN_Y1) / 2 + 0.1, ROOM.back - 0.9);
  // reflet de la baie sur le sol : une nappe de lumière qui s'étire vers la caméra
  const spillMat = glowMat(pal.window, 0.1, ramp);
  const spill = add(new THREE.Mesh(new THREE.PlaneGeometry(WIN_W * 0.95, 9), spillMat));
  spill.rotation.x = -Math.PI / 2; spill.position.set(0.2, 0.014, ROOM.back + 4.5);
  // bandeaux lumineux : cyan en hauteur, ambre au ras du sol
  const stripC = new THREE.MeshBasicMaterial({ color: 0x7fc7d9 }), stripA = new THREE.MeshBasicMaterial({ color: 0xe8a24a });
  stripC.color.multiplyScalar(1.5 * pal.strips); stripA.color.multiplyScalar(1.4 * pal.strips);
  for (const sx of [-1, 1]) {
    box(0.04, 0.05, depth, stripC, sx * (W - 0.02), 3.9, zMid);
    box(0.04, 0.04, depth, stripA, sx * (W - 0.02), 0.16, zMid);
    for (let z = ROOM.back + 1.6; z < 6; z += 2.6) box(0.05, 2.3, 0.07, stripC, sx * (W - 0.02), 2.6, z);
  }
  // ligne ambre au sol, qui mène au Passeur
  const guide = canvasTexture(64, 256, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#fff'; for (let y = 0; y < h; y += 64) g.fillRect(w / 2 - 5, y + 8, 10, 40); }, false);
  guide.wrapT = THREE.RepeatWrapping; guide.repeat.set(1, 8);
  const guideMesh = add(new THREE.Mesh(new THREE.PlaneGeometry(0.5, 11), new THREE.MeshBasicMaterial({ map: guide, color: 0xe8a24a, transparent: true, opacity: 0.55, depthWrite: false })));
  guideMesh.rotation.x = -Math.PI / 2; guideMesh.position.set(0, 0.016, 3.2);
  // rampes d'éclairage sur le mur du fond, avec leurs cônes de lumière
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff1dc });
  lampMat.color.multiplyScalar(2.2);
  const cones: THREE.Mesh[] = [];
  for (const x of [-3.45, 3.45]) {
    box(1.1, 0.05, 0.16, lampMat, x, 4.6, ROOM.back + 0.12);
    const c = add(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.7, 4.4, 24, 1, true), glowMat(0xffe6c2, 0.07, ramp)));
    c.position.set(x, 4.6 - 2.2, ROOM.back + 0.5);
    cones.push(c);
  }
  // poussière en suspension
  const ND = 220, dp = new Float32Array(ND * 3);
  for (let i = 0; i < ND; i++) { dp[i * 3] = (hash(i * 1.3) - 0.5) * W * 2; dp[i * 3 + 1] = 0.2 + hash(i * 2.7) * 4.6; dp[i * 3 + 2] = ROOM.back + hash(i * 4.1) * 13; }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dust = add(new THREE.Points(dg, new THREE.PointsMaterial({ map: disc, color: 0xffe3c0, size: 0.045, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending })));

  // ---------- Modèles ----------
  const sciIds: SciId[] = ['iris', 'noe', 'selma'];
  const [tele, exoM, holoM, consoleM, litM, racks, caisses, hydro, porterM, ...sciM] = await Promise.all([
    loader.load('teleporteur', { height: 2.75 }), loader.load('exo_rack', { height: EXO_H }), loader.load('holo_table', { height: 1.5 }),
    loader.load('lab_console', { height: 1.35 }), loader.load('lit_repos', { height: 1.75 }), loader.load('lab_racks', { height: 2.3 }),
    loader.load('lab_caisses', { height: 1.2 }), loader.load('hydroponie', { height: 1.75 }),
    loader.load('porteur_civil', { height: 1.78, fallback: 'perso' }),
    ...sciIds.map(id => loader.load(CAST[id].model, { height: id === 'noe' ? 1.8 : 1.7, fallback: 'perso' })),
  ]);
  const models: Model[] = [tele, exoM, holoM, consoleM, litM, racks, caisses, hydro, porterM, ...sciM];
  const place = (m: Model, x: number, z: number, ry: number, shadow = 0.6): THREE.Group => {
    const g = new THREE.Group();
    g.add(m.root);
    g.position.set(x, 0, z); g.rotation.y = ry;
    const s = blobShadow(shadowTex, m.size.x * 1.35, m.size.z * 1.6, shadow);
    g.add(s);
    return add(g);
  };
  place(tele, PAD.x, PAD.z, 0, 0.5);
  const exoG = place(exoM, AT.exo.x, AT.exo.z, 0.5);
  place(holoM, AT.holo.x, AT.holo.z, -0.5);
  place(consoleM, AT.console.x, AT.console.z, 0.7);
  place(litM, AT.lit.x, AT.lit.z, -0.7);
  place(racks, -3.0, -5.3, 0.2);
  // un second jeu de baies, de l'autre côté : même géométrie, même matériau
  const racks2 = place({ ...racks, root: racks.root.clone(true) as THREE.Group }, 3.0, -5.3, -0.2);
  void racks2;
  place(caisses, -3.3, 5.6, 0.5);
  place(hydro, 3.55, 1.3, -Math.PI / 2);

  // Le Passeur : disque au sol, colonne de lumière, halo dans l'anneau
  const padDisc = add(new THREE.Mesh(new THREE.CircleGeometry(1.25, 48), glowMat(0x7fc7d9, 0.3, disc)));
  padDisc.rotation.x = -Math.PI / 2; padDisc.position.set(PAD.x, 0.03, PAD.z + 0.5); padDisc.scale.set(1.6, 1.6, 1);
  const column = add(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 5, 28, 1, true), glowMat(0x9fe6f7, 0, ramp)));
  column.position.set(PAD.x, 2.5, PAD.z + 0.5); column.rotation.x = Math.PI;
  const ringGlow = add(new THREE.Sprite(new THREE.SpriteMaterial({ map: disc, color: 0x8fe3f5, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
  ringGlow.position.set(PAD.x, 1.45, PAD.z + 0.1); ringGlow.scale.setScalar(3.4);

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
          diffuseColor.rgb = mix(vec3(0.01, 0.026, 0.032), diffuseColor.rgb * mix(vec3(1.0), exoTint * 1.5, 0.3) * (0.5 + 0.5 * exoLv), exoOn);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float exoScan = pow(0.5 + 0.5 * sin(vRack.y * 46.0 - uT * 1.6), 10.0);
          totalEmissiveRadiance += (1.0 - exoOn) * vec3(0.08, 0.36, 0.46) * (0.08 + 0.8 * exoScan);
          totalEmissiveRadiance += exoOn * exoTint * (0.03 + 0.14 * exoLv) * (1.0 + 0.25 * sin(uT * 2.0 + vRack.y * 3.0)) + exoOn * exoTint * uPulse;`);
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
  const holo = add(new THREE.Group());
  holo.position.set(AT.holo.x, 2.02, AT.holo.z);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x7fc7d9, transparent: true, opacity: 0.95, fog: false });
  lineMat.color.multiplyScalar(1.7);
  const map3d = new THREE.Group();
  map3d.rotation.x = 0.62;
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
  const holoCone = add(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.12, 1.15, 28, 1, true), glowMat(0x7fc7d9, 0.07, ramp)));
  holoCone.position.set(AT.holo.x, 1.42, AT.holo.z);

  // ---------- Console : panneau des contrats ----------
  const contractTex = canvasTexture(512, 320, (g, w, h) => drawContracts(g, w, h, null));
  const contractMat = new THREE.MeshBasicMaterial({ map: contractTex, transparent: true, opacity: 0.96, depthWrite: false, fog: false, side: THREE.DoubleSide });
  contractMat.color.setScalar(1.25);
  const contractPanel = add(new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.94), contractMat));
  contractPanel.position.set(AT.console.x - 0.1, 2.1, AT.console.z - 0.15); contractPanel.rotation.y = 0.7; contractPanel.rotation.x = -0.08;
  // lampe de la couchette
  const litGlow = add(new THREE.Sprite(new THREE.SpriteMaterial({ map: disc, color: 0xffc690, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
  litGlow.position.set(AT.lit.x - 0.1, 1.25, AT.lit.z + 0.1); litGlow.scale.setScalar(1.5);

  // ---------- Personnages ----------
  const porter = new Actor(porterM);
  const pg = add(new THREE.Group());
  pg.add(porterM.root, blobShadow(shadowTex, 0.9, 0.9, 0.6));
  pg.position.copy(PORTER_AT); pg.rotation.y = 0.3;
  porter.play(porter.pick('calm_0', 'calmv0', 'idle'), 0);
  const scis: Sci[] = sciIds.map((id, i) => {
    const m = sciM[i], actor = new Actor(m), g = add(new THREE.Group());
    g.add(m.root, blobShadow(shadowTex, 0.9, 0.9, 0.6));
    g.position.copy(SCI_AT[id].at); g.rotation.y = SCI_AT[id].ry;
    actor.play(actor.pick('calm_0', 'calmv0'), 0);
    actor.mixer.update(i * 0.7); // désynchronise les respirations
    return { id, actor, head: SCI_AT[id].at.clone().setY(m.size.y + 0.12), talkUntil: 0, nextIdle: 6 + i * 4 };
  });

  // ---------- Boîtes de toucher ----------
  const hits: THREE.Object3D[] = [];
  const hitMat = new THREE.MeshBasicMaterial();
  const hitGeo = new THREE.BoxGeometry(1, 1, 1);
  const hit = (kind: 'poste' | 'sci', id: string, c: THREE.Vector3, s: THREE.Vector3): void => {
    const m = new THREE.Mesh(hitGeo, hitMat);
    m.position.copy(c); m.scale.copy(s); m.visible = false; m.userData = { kind, id };
    m.updateMatrixWorld(true);
    scene.add(m); hits.push(m);
  };
  for (const s of STATIONS) hit('poste', s.id, s.hit[0], s.hit[1]);
  for (const id of sciIds) hit('sci', id, SCI_AT[id].at.clone().setY(0.9), V(0.7, 1.8, 0.7));

  const applyEnv = (): void => { for (const m of models) setEnvIntensity(m.root, 1); };
  applyEnv();

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
    floorMat.color.set(pal.floor); floorMat.roughness = pal.floorRough * 1.6;
    spillMat.color.set(pal.window);
    stripC.color.set(0x7fc7d9).multiplyScalar(1.5 * pal.strips); stripA.color.set(0xe8a24a).multiplyScalar(1.4 * pal.strips);
    const g = (backdropTex.image as HTMLCanvasElement).getContext('2d');
    if (g) { drawBackdrop(g, 1024, 512, a); backdropTex.needsUpdate = true; }
    backdropMat.color.setScalar(pal.backdrop);
  };

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

  const dpos = dg.attributes.position as THREE.BufferAttribute;
  const tick = (t: number, dt: number, depart: number): void => {
    porter.update(dt);
    for (const s of scis) {
      s.actor.update(dt);
      // Au repos, un geste de temps en temps ; après une réplique, retour au calme.
      if (s.talkUntil && t > s.talkUntil) { s.talkUntil = 0; s.actor.play(s.actor.pick('calm_0', 'calmv0'), 0.6); s.nextIdle = t + 8 + hash(t) * 8; }
      else if (!s.talkUntil && t > s.nextIdle) {
        const cur = s.actor.currentName, next = cur === 'calm_0' ? s.actor.pick(hash(t * 3) > 0.5 ? 'calmv2' : 'calmv3', 'calm_0') : s.actor.pick('calm_0', 'calmv0');
        s.actor.play(next, 0.8);
        s.nextIdle = t + (next === 'calm_0' ? 9 + hash(t) * 9 : Math.max(3, s.actor.duration(next) - 0.8));
      }
    }
    exoU.uT.value = t;
    exoNodes.forEach((n, i) => {
      const lv = levels.getComponent(i);
      n.material.opacity = lv > 0 ? 0.35 + lv * 0.5 + Math.sin(t * 2 + i) * 0.08 : 0.1 + Math.max(0, Math.sin(t * 1.4 + i * 1.7)) * 0.12;
      n.scale.setScalar(lv > 0 ? 0.3 + lv * 0.3 : 0.16);
    });
    map3d.rotation.y = Math.sin(t * 0.25) * 0.35;
    holo.position.y = 2.02 + Math.sin(t * 0.9) * 0.02;
    const rs = 0.03 + ((t * 0.5) % 1) * 0.16;
    ring.scale.setScalar(rs); (ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - ((t * 0.5) % 1));
    lineMat.opacity = 0.85 + Math.sin(t * 3.1) * 0.08;
    contractPanel.position.y = 2.05 + Math.sin(t * 0.8 + 1) * 0.015;
    // Le Passeur respire ; au départ, la colonne monte en charge.
    const breathe = 0.5 + 0.5 * Math.sin(t * 1.3);
    (padDisc.material as THREE.MeshBasicMaterial).opacity = 0.22 + breathe * 0.1 + depart * 0.5;
    (column.material as THREE.MeshBasicMaterial).opacity = depart * 0.75;
    column.scale.set(1 - depart * 0.35, 1, 1 - depart * 0.35);
    ringGlow.material.opacity = 0.2 + breathe * 0.08 + depart * 0.6;
    padLight.intensity = (5 + breathe * 1 + depart * 30) * pal.points;
    for (let i = 0; i < dpos.count; i++) {
      let y = dpos.getY(i) + dt * (0.02 + hash(i) * 0.03);
      if (y > 4.9) y = 0.2;
      dpos.setY(i, y);
      dpos.setX(i, dpos.getX(i) + Math.sin(t * 0.3 + i) * dt * 0.02);
    }
    dpos.needsUpdate = true;
    dust.material.opacity = 0.4 + Math.sin(t * 0.5) * 0.08;
    for (const c of cones) (c.material as THREE.MeshBasicMaterial).opacity = 0.06 + Math.sin(t * 0.7 + c.position.x) * 0.012;
  };

  const dispose = (): void => {
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
    env.dispose();
    scene.environment = null;
  };

  return { scene, porter, scis, hits, setAmbiance, sync, tick, dispose };
}
