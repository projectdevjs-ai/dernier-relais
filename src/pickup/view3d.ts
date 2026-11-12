// Le rendu de la séquence de ramassage : une scène three.js sur un canevas transparent (la caméra du téléphone ou
// un panorama 360° derrière). Sans WebGL, la scène existe quand même : elle sert aux calculs (projection, lancer de rayon)
// et la caisse est dessinée à plat sur le calque 2D.
import * as THREE from 'three';

export type PanoName = 'ville' | 'rural' | 'riviere' | 'plage' | 'friche';
export const PANOS: PanoName[] = ['ville', 'rural', 'riviere', 'plage', 'friche'];
/** Décor de secours d'un colis : toujours le même pour le même colis. */
export function panoFor(seed: string): PanoName {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PANOS[h % PANOS.length];
}

export interface ScreenPt { x: number; y: number; front: boolean }

export class View3D {
  readonly scene = new THREE.Scene();
  readonly cam = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
  /** null : pas de WebGL, la caisse est dessinée à plat. */
  renderer: THREE.WebGLRenderer | null = null;
  W = 1; H = 1;
  private pano: THREE.Mesh | null = null;
  private panoMat: THREE.MeshBasicMaterial | null = null;
  private panoTex: THREE.Texture | null = null;
  private proj = new THREE.Vector3();
  private keep = new Set<THREE.Object3D>();
  /** Appelé quand une image (panorama) vient d'arriver : la scène est à redessiner. */
  onLoad: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement, private light: boolean, flat = false) {
    if (!flat) {
      try {
        this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: !light, powerPreference: 'high-performance' });
        this.renderer.setClearColor(0x000000, 0);
      } catch { this.renderer = null; }
    }
    const hemi = new THREE.HemisphereLight(0xfff4e0, 0x3a4640, 1.5), sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(2.5, 5, 4);
    this.scene.add(hemi, sun);
    this.keep.add(hemi); this.keep.add(sun);
  }

  resize(W: number, H: number): void {
    this.W = Math.max(1, W); this.H = Math.max(1, H);
    this.cam.aspect = this.W / this.H;
    this.cam.updateProjectionMatrix();
    if (this.renderer) {
      this.renderer.setPixelRatio(this.light ? 1 : Math.min(2, window.devicePixelRatio || 1));
      this.renderer.setSize(this.W, this.H, false);
    }
  }

  /** Panorama 360° autour de la caméra. `rot` : rotation du décor, en radians. */
  setPano(name: PanoName, rot = 0): void {
    if (!this.renderer) return;
    if (!this.pano) {
      const g = new THREE.SphereGeometry(60, this.light ? 32 : 64, this.light ? 16 : 32);
      g.scale(-1, 1, 1);
      this.panoMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false, fog: false });
      this.pano = new THREE.Mesh(g, this.panoMat);
      this.pano.renderOrder = -1;
      this.pano.visible = false;
      this.scene.add(this.pano);
      this.keep.add(this.pano);
    }
    this.pano.rotation.y = -Math.PI / 2 + rot;
    if (this.pano.userData.name === name) return;
    this.pano.userData.name = name;
    const mat = this.panoMat!;
    // Chemin relatif : le jeu est aussi emballé en APK.
    new THREE.TextureLoader().load(`pano/pano_${name}_s.jpg`, t => {
      if (!this.pano || this.pano.userData.name !== name) { t.dispose(); return; }
      t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
      this.panoTex?.dispose();
      this.panoTex = t;
      mat.map = t; mat.needsUpdate = true;
      this.onLoad?.();
    }, undefined, () => { /* panorama indisponible : le fond dégradé de la couche suffit */ });
  }
  /** Le panorama ne se montre que si la caméra ne donne pas d'image. `tint` : 1 de jour, plus sombre la nuit. */
  showPano(on: boolean, tint = 1): void {
    if (!this.pano || !this.panoMat) return;
    this.pano.visible = on && !!this.panoMat.map;
    this.panoMat.color.setScalar(tint);
  }
  get panoReady(): boolean { return !!this.panoMat?.map; }

  toScreen(v: THREE.Vector3): ScreenPt {
    this.proj.copy(v).project(this.cam);
    return { x: ((this.proj.x + 1) / 2) * this.W, y: ((1 - this.proj.y) / 2) * this.H, front: this.proj.z < 1 };
  }

  render(): void { this.renderer?.render(this.scene, this.cam); }

  /** Retire tout ce qui a été ajouté pour une phase (lumières et panorama restent). */
  clear(): void {
    for (const o of [...this.scene.children]) if (!this.keep.has(o)) this.scene.remove(o);
  }

  dispose(): void {
    this.clear();
    this.pano?.geometry.dispose(); this.panoMat?.dispose(); this.panoTex?.dispose();
    this.pano = null; this.panoMat = null; this.panoTex = null;
    if (this.renderer) { this.renderer.dispose(); try { this.renderer.forceContextLoss(); } catch { /* déjà perdu */ } }
    this.renderer = null;
    void this.canvas;
  }
}
