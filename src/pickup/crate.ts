// Les caisses en 3D de la séquence de ramassage : une boîte texturée tout de suite (par matière), habillée du vrai
// modèle dès qu'il est chargé ; sangles tissées, boucles à cliquet, ombre au sol. Repris de l'ancien jeu (crateMesh, dressCrate).
import * as THREE from 'three';
import type { CrateKind, SpecialKind } from '../game/api';
import { loadModel } from '../render/assets';

export interface CrateSpec { id: string; crate: CrateKind; weightKg: number; fragile: boolean; special?: SpecialKind | null }
export type Dims = [number, number, number];
export type Face = 'front' | 'right' | 'top';

/** Proportions (largeur, hauteur, profondeur) de chaque modèle, pour l'habiller sans le déformer. */
const SHAPE: Record<string, Dims> = {
  carton: [1.16, 0.84, 1.0], bois: [0.94, 0.96, 1.08], alu: [1.22, 0.94, 0.84], plastique: [1.14, 0.91, 0.95],
  cryo: [1.08, 1.06, 0.84], ruche: [1.1, 0.88, 0.99], batterie: [1.3, 0.93, 0.78], boitenoire: [1.36, 0.87, 0.8],
};
const MODEL: Record<string, string> = {
  carton: 'carton', bois: 'caisse_bois', alu: 'malle_alu', plastique: 'bac_plastique',
  cryo: 'spe_cryo', ruche: 'spe_ruche', batterie: 'spe_batterie', boitenoire: 'spe_boitenoire',
};
const lookOf = (p: CrateSpec): string => p.special ?? p.crate;

/** Taille réelle de la caisse en mètres : elle grandit avec le poids. */
export function crateDims(p: CrateSpec): Dims {
  const s = SHAPE[lookOf(p)] ?? SHAPE.carton, b = 0.34 + Math.min(20, Math.max(1, p.weightKg)) * 0.026;
  return [s[0] * b, s[1] * b, s[2] * b].map(v => Math.round(v * 100) / 100) as Dims;
}

const COLORS: Record<string, [string, string]> = {
  carton: ['#b98a4e', '#8d6535'], bois: ['#8a5a2b', '#5a3a1c'], alu: ['#aab2b5', '#6d777b'], plastique: ['#2f6fb0', '#1b406b'],
  cryo: ['#8fd0e6', '#3d7f95'], ruche: ['#d9a93a', '#8f6609'], batterie: ['#d9742f', '#7a3a12'], boitenoire: ['#d9622f', '#3a2018'],
};

/** Texture d'une face : matière, cerclage, bande adhésive, tampon FRAGILE. */
function faceTexture(w: number, h: number, p: CrateSpec, face: 'front' | 'side' | 'top'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = Math.max(64, Math.round(w)); c.height = Math.max(64, Math.round(h));
  const g = c.getContext('2d')!, look = lookOf(p), [a, b] = COLORS[look] ?? COLORS.carton, W = c.width, H = c.height;
  g.fillStyle = a; g.fillRect(0, 0, W, H);
  if (look === 'bois' || look === 'ruche') {
    const n = Math.max(3, Math.round(H / 46));
    for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.05)'; g.fillRect(0, (i * H) / n, W, H / n - 3); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, ((i + 1) * H) / n - 3, W, 3); }
  } else if (look === 'carton') {
    g.fillStyle = 'rgba(232,215,170,.75)'; g.fillRect(W * 0.42, 0, W * 0.16, H);
    g.fillStyle = 'rgba(0,0,0,.18)'; if (face === 'top') g.fillRect(0, H / 2 - 1.5, W, 3);
  } else {
    g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 3;
    for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo((i * W) / 5, H * 0.12); g.lineTo((i * W) / 5, H * 0.88); g.stroke(); }
  }
  g.strokeStyle = b; g.lineWidth = Math.max(6, W * 0.04); g.strokeRect(0, 0, W, H);
  if (p.fragile && face !== 'top') {
    g.save(); g.translate(W / 2, H * 0.7); g.rotate(-0.08);
    const fs = Math.max(0.6, W / 300);
    g.strokeStyle = 'rgba(190,40,30,.88)'; g.lineWidth = 3 * fs; g.strokeRect(-70 * fs, -18 * fs, 140 * fs, 36 * fs);
    g.fillStyle = 'rgba(190,40,30,.88)'; g.font = `800 ${24 * fs}px "Arial Narrow", Arial, sans-serif`; g.textAlign = 'center'; g.fillText('FRAGILE', 0, 8 * fs); g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export interface Crate {
  /** À ajouter à la scène ; origine au centre de la caisse. */
  group: THREE.Group;
  /** La boîte englobante (sert au lancer de rayon, même cachée sous le modèle). */
  box: THREE.Mesh;
  dims: Dims;
  /** Vrai dès que le modèle a remplacé la boîte. */
  dressed: boolean;
  dispose(): void;
}

/** Caisse = boîte texturée immédiate, puis modèle 3D ajusté exactement à ses dimensions. `onDress` : appelé à l'arrivée du modèle. */
export function makeCrate(p: CrateSpec, onDress?: () => void): Crate {
  const dims = crateDims(p), [W, H, D] = dims, R = 256, px = (v: number): number => (R * v) / Math.max(W, H, D);
  const front = faceTexture(px(W), px(H), p, 'front'), side = faceTexture(px(D), px(H), p, 'side'), top = faceTexture(px(W), px(D), p, 'top');
  const metal = p.crate === 'alu' && !p.special;
  const m = (t: THREE.Texture): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ map: t, roughness: metal ? 0.45 : 0.85, metalness: 0 });
  const mats = [m(side), m(side), m(top), m(top), m(front), m(side)]; // +x -x +y -y +z -z
  const geo = new THREE.BoxGeometry(W, H, D);
  const box = new THREE.Mesh(geo, mats);
  const group = new THREE.Group();
  group.add(box);
  const crate: Crate = {
    group, box, dims, dressed: false,
    dispose() { alive = false; geo.dispose(); for (const x of mats) { x.map?.dispose(); x.dispose(); } },
  };
  let alive = true;
  void loadModel(MODEL[lookOf(p)] ?? 'carton', 'caisse').then(tpl => {
    if (!alive) return;
    const model = tpl.root.clone(true);
    // Le modèle (hauteur 1, posé au sol) épouse la caisse : tourné d'un quart de tour si sa longueur n'est pas du bon côté.
    let w = tpl.w, d = tpl.d;
    const wrap = new THREE.Group();
    if ((w > d) !== (W > D)) { model.rotation.y = Math.PI / 2; [w, d] = [d, w]; }
    wrap.add(model);
    wrap.scale.set(W / Math.max(1e-6, w), H, D / Math.max(1e-6, d));
    wrap.position.y = -H / 2;
    wrap.traverse(o => { o.frustumCulled = false; });
    group.add(wrap);
    box.visible = false;
    crate.dressed = true;
    onDress?.();
  }).catch(() => { /* la boîte texturée reste */ });
  return crate;
}

/** Ombre douce sous la caisse. */
let shadowTex: THREE.CanvasTexture | null = null;
export function blobShadow(w: number, d: number): THREE.Mesh {
  if (!shadowTex) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!, r = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    r.addColorStop(0, 'rgba(0,0,0,.55)'); r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    shadowTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

// ───────────────────────── sangles et boucles

export const FACES: Record<Face, THREE.Vector3> = { front: new THREE.Vector3(0, 0, 1), right: new THREE.Vector3(1, 0, 0), top: new THREE.Vector3(0, 1, 0) };
export function faceOf(n: THREE.Vector3): Face | null { return n.z > 0.9 ? 'front' : n.x > 0.9 ? 'right' : n.y > 0.9 ? 'top' : null; }
export interface StrapPath { pts: THREE.Vector3[]; fs: Face[] }
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Chemin d'une sangle entre deux points de la caisse : d'une face à l'autre par l'arête commune, comme une vraie sangle. */
export function strapPath(a: THREE.Vector3, fa: Face, b: THREE.Vector3, fb: Face, d: Dims): StrapPath {
  if (fa === fb) return { pts: [a, b], fs: [fa] };
  const [W, H, D] = d, m = (u: number, v: number, l: number): number => clamp((u + v) / 2, -l * 0.45, l * 0.45), k = [fa, fb].sort().join('-');
  const e = k === 'front-right' ? new THREE.Vector3(W / 2, m(a.y, b.y, H), D / 2) : k === 'front-top' ? new THREE.Vector3(m(a.x, b.x, W), H / 2, D / 2) : new THREE.Vector3(W / 2, H / 2, m(a.z, b.z, D));
  return { pts: [a, e, b], fs: [fa, fb] };
}

/** Sangle tissée : sergé, bords surpiqués (texture générée une fois, teintée par la couleur de la sangle). */
let webTex: THREE.CanvasTexture | null = null;
function webbing(): THREE.CanvasTexture {
  if (webTex) return webTex;
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#cfcfcf'; g.fillRect(0, 0, 128, 64);
  for (let y = 0; y < 64; y += 2) for (let x = 0; x < 128; x += 4) {
    const o = (y / 2) % 4;
    g.fillStyle = `rgba(0,0,0,${0.18 + 0.08 * ((x * 7 + y * 13) % 10) / 10})`; g.fillRect((x + o) % 128, y, 2, 1);
    g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect((x + o + 2) % 128, y + 1, 2, 1);
  }
  g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, 128, 4); g.fillRect(0, 60, 128, 4);
  g.fillStyle = 'rgba(255,255,255,.35)'; for (let x = 0; x < 128; x += 8) { g.fillRect(x, 7, 4, 1.4); g.fillRect(x, 55.6, 4, 1.4); }
  webTex = new THREE.CanvasTexture(c);
  webTex.wrapS = THREE.RepeatWrapping; webTex.anisotropy = 8; webTex.colorSpace = THREE.SRGBColorSpace;
  return webTex;
}
export function strapMaterials(): { fixed: THREE.MeshStandardMaterial; live: THREE.MeshStandardMaterial } {
  const t = webbing();
  return {
    fixed: new THREE.MeshStandardMaterial({ color: 0xd9822b, roughness: 0.82, map: t }),
    live: new THREE.MeshStandardMaterial({ color: 0xf0a050, roughness: 0.6, emissive: 0x3a1c00, map: t }),
  };
}
/** Ruban posé à plat sur les faces, le long du chemin. */
export function ribbon(path: StrapPath, rw: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < path.pts.length - 1; i++) {
    const p0 = path.pts[i], p1 = path.pts[i + 1], n = FACES[path.fs[i]], X = p1.clone().sub(p0), len = X.length();
    if (len < 1e-4) continue;
    X.normalize();
    const Y = new THREE.Vector3().crossVectors(n, X).normalize(), geo = new THREE.BoxGeometry(len + rw * 0.5, rw, rw * 0.16), uv = geo.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setX(k, (uv.getX(k) * (len + rw * 0.5)) / rw * 0.5);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, n));
    mesh.position.copy(p0).add(p1).multiplyScalar(0.5).addScaledVector(n, rw * 0.07);
    g.add(mesh);
  }
  return g;
}
export function disposeGroup(g: THREE.Object3D): void { g.traverse(o => { (o as THREE.Mesh).geometry?.dispose(); }); g.removeFromParent(); }

export interface Buckle { group: THREE.Group; ring: THREE.MeshStandardMaterial; dispose(): void }
/** Boucle : plaque et anneau tout de suite, remplacés par le cliquet 3D dès qu'il est chargé. */
export function makeBuckle(face: Face, s: number): Buckle {
  const g = new THREE.Group();
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x3b4043, metalness: 0.2, roughness: 0.5 });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xc9ccce, metalness: 0.2, roughness: 0.35, emissive: 0x000000 });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05 * s, 0.05 * s, 0.006 * s), plateMat);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.017 * s, 0.005 * s, 8, 20), ringMat);
  ring.position.z = 0.007 * s;
  g.add(plate, ring);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), FACES[face]);
  let alive = true;
  void loadModel('cliquet', 'caisse').then(tpl => {
    if (!alive || tpl.w > 1.19 && tpl.d > 1.19) return; // forme de remplacement : on garde la plaque
    const m = tpl.root.clone(true), k = (0.075 * s) / Math.max(tpl.w, tpl.d, 1);
    m.scale.setScalar(k);
    m.rotation.x = Math.PI / 2;
    // Le modèle est posé sur sa base : une fois couché sur la face, on le recentre et on le pose dessus.
    m.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(m), c = b.getCenter(new THREE.Vector3());
    m.position.set(-c.x, -c.y, -c.z + (b.max.z - b.min.z) / 2);
    g.add(m);
    plate.visible = false;
    ring.position.z = 0.02 * s;
  }).catch(() => { /* la plaque reste */ });
  return { group: g, ring: ringMat, dispose() { alive = false; plateMat.dispose(); ringMat.dispose(); plate.geometry.dispose(); ring.geometry.dispose(); } };
}
