// Chargement des modèles GLB : à la demande, mis en cache, mesurés puis normalisés
// (hauteur 1, posés au sol, centrés). Les modèles viennent d'un générateur (Meshy) :
// échelles et origines quelconques, on ne suppose donc rien.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/** Forme de remplacement si le fichier manque ou échoue. */
export type Fallback = 'perso' | 'batiment' | 'caisse';

interface Template {
  /** Modèle normalisé : hauteur 1, base au sol (y = 0), centré en x/z. */
  root: THREE.Group;
  clips: THREE.AnimationClip[];
  /** Largeur (x) et profondeur (z) pour une hauteur de 1. */
  w: number;
  d: number;
  skinned: boolean;
}

export interface Instance {
  /** À ajouter à la scène. Son échelle donne la taille en mètres. */
  root: THREE.Group;
  clips: THREE.AnimationClip[];
  /** Dimensions finales en mètres. */
  size: THREE.Vector3;
  /** Matériaux propres à cette instance (vide s'ils sont partagés avec le cache). */
  materials: THREE.MeshStandardMaterial[];
}

export interface InstanceOpts {
  /** Hauteur visée en mètres. */
  height: number;
  /** Plus grande dimension horizontale permise en mètres (réduit l'échelle si besoin). */
  maxWidth?: number;
  /** Clone les matériaux pour pouvoir les teinter sans toucher aux autres instances. */
  ownMaterials?: boolean;
}

const loader = new GLTFLoader();
const cache = new Map<string, Promise<Template>>();
const box = new THREE.Box3();
const v = new THREE.Vector3();

/** Charge (ou reprend du cache) le modèle `models/<name>.glb`. Ne rejette jamais. */
export function loadModel(name: string, fallback: Fallback): Promise<Template> {
  let p = cache.get(name);
  if (!p) {
    // Chemin relatif : le jeu est aussi emballé en APK, pas de « / » initial.
    p = loader.loadAsync(`models/${name}.glb`).then(
      gltf => normalise(gltf.scene, gltf.animations),
      err => {
        console.warn(`[render] modèle « ${name} » indisponible, forme de remplacement`, err);
        return placeholder(fallback);
      },
    );
    cache.set(name, p);
  }
  return p;
}

function normalise(scene: THREE.Object3D, animations: THREE.AnimationClip[]): Template {
  let skinned = false;
  scene.updateMatrixWorld(true);
  scene.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if ((m as THREE.SkinnedMesh).isSkinnedMesh) { skinned = true; m.frustumCulled = false; }
    m.castShadow = false; m.receiveShadow = false;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) tameMaterial(mat);
  });
  // Mesure précise (tient compte du squelette pour les personnages).
  box.setFromObject(scene, true);
  if (box.isEmpty()) return placeholder('caisse');
  const size = box.getSize(v);
  const h = Math.max(size.y, 1e-4);
  const k = 1 / h;
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  scene.position.set(-cx * k, -box.min.y * k, -cz * k);
  scene.scale.multiplyScalar(k);
  const root = new THREE.Group();
  root.add(scene);
  return { root, clips: animations.map(cleanClip), w: size.x * k, d: size.z * k, skinned };
}

/** Rend les matériaux mats : sans carte d'environnement, le métal sortirait noir. */
function tameMaterial(mat: THREE.Material): void {
  const s = mat as THREE.MeshStandardMaterial;
  if (!s.isMeshStandardMaterial) return;
  s.metalness = 0;
  s.roughness = Math.max(s.roughness, 0.85);
  s.envMapIntensity = 0;
  if (s.map) s.map.anisotropy = 4;
  capTexture(s.map); capTexture(s.normalMap); capTexture(s.emissiveMap); capTexture(s.roughnessMap); capTexture(s.metalnessMap); capTexture(s.aoMap);
}

/** Côté maximal des textures des modèles, en pixels : au-delà, elles sont réduites une fois chargées. */
const MAX_TEXTURE = 1024;
const capped = new WeakSet<THREE.Texture>();
/** Réduit une texture trop grande (mémoire vidéo des téléphones) ; sans effet sur les autres. */
function capTexture(t: THREE.Texture | null): void {
  if (!t || capped.has(t)) return;
  capped.add(t);
  const img = t.image as (CanvasImageSource & { width: number; height: number; close?: () => void }) | undefined;
  if (!img || !(img.width > MAX_TEXTURE || img.height > MAX_TEXTURE) || typeof document === 'undefined') return;
  const k = MAX_TEXTURE / Math.max(img.width, img.height);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
  const g = c.getContext('2d');
  if (!g) return;
  g.drawImage(img, 0, 0, c.width, c.height);
  img.close?.();
  t.image = c;
  t.needsUpdate = true;
}

/** Allège les animations : on garde les rotations, et la translation du bassin sans sa dérive. */
function cleanClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const t of clip.tracks) {
    if (t.name.endsWith('.quaternion')) { tracks.push(t); continue; }
    if (t.name.endsWith('.position') && /hips/i.test(t.name)) {
      // Animation « sur place » : on retire toute avancée linéaire entre la première et la dernière image.
      const a = t.values, n = a.length / 3;
      if (n > 1) {
        for (const axis of [0, 2]) {
          const first = a[axis], drift = a[(n - 1) * 3 + axis] - first;
          for (let i = 0; i < n; i++) a[i * 3 + axis] -= (drift * i) / (n - 1);
        }
      }
      tracks.push(t);
    }
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

const PLACEHOLDER_COLORS: Record<Fallback, number> = { perso: 0xe8a24a, batiment: 0x8a9a94, caisse: 0xb98a4e };

function placeholder(kind: Fallback): Template {
  let geo: THREE.BufferGeometry, w = 1, d = 1;
  if (kind === 'perso') { geo = new THREE.CapsuleGeometry(0.16, 0.68, 4, 10); w = d = 0.32; }
  else if (kind === 'batiment') { geo = new THREE.CylinderGeometry(0.28, 0.42, 1, 6); w = d = 0.84; }
  else { geo = new THREE.BoxGeometry(1.2, 1, 1.2); w = d = 1.2; }
  geo.translate(0, 0.5, 0);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: PLACEHOLDER_COLORS[kind], roughness: 0.9, flatShading: true }));
  const root = new THREE.Group();
  root.add(mesh);
  return { root, clips: [], w, d, skinned: false };
}

/** Crée une copie utilisable d'un modèle chargé, à la taille demandée. */
export function instantiate(tpl: Template, opts: InstanceOpts): Instance {
  const root = (tpl.skinned ? cloneSkinned(tpl.root) : tpl.root.clone(true)) as THREE.Group;
  let k = opts.height;
  const widest = Math.max(tpl.w, tpl.d);
  if (opts.maxWidth && widest * k > opts.maxWidth) k = opts.maxWidth / widest;
  root.scale.setScalar(k);
  const materials: THREE.MeshStandardMaterial[] = [];
  if (opts.ownMaterials) {
    const done = new Map<THREE.Material, THREE.Material>();
    root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      let c = done.get(m.material);
      if (!c) {
        c = m.material.clone();
        done.set(m.material, c);
        if ((c as THREE.MeshStandardMaterial).isMeshStandardMaterial) materials.push(c as THREE.MeshStandardMaterial);
      }
      m.material = c;
    });
  }
  return { root, clips: tpl.clips, size: new THREE.Vector3(tpl.w * k, k, tpl.d * k), materials };
}

/** Charge puis instancie. */
export async function spawn(name: string, fallback: Fallback, opts: InstanceOpts): Promise<Instance> {
  return instantiate(await loadModel(name, fallback), opts);
}

/** Place tous les maillages d'un objet sur un calque de rendu (0 : monde, 1 : par-dessus). */
export function setLayer(o: THREE.Object3D, layer: number): void {
  o.traverse(c => c.layers.set(layer));
}

/** Libère les matériaux propres d'une instance (la géométrie et les textures restent dans le cache). */
export function disposeInstance(inst: Instance | null): void {
  if (!inst) return;
  for (const m of inst.materials) m.dispose();
  inst.root.removeFromParent();
}
