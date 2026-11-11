// Couche personnalisée MapLibre : la scène three.js est dessinée DANS la carte,
// avec le même contexte WebGL et la matrice de projection de MapLibre 5.
// Repère local de la scène : mètres autour d'une ancre, x = est, y = haut, z = sud.
import * as THREE from 'three';
import maplibregl, { type CustomLayerInterface, type CustomRenderMethodInput, type Map as MlMap } from 'maplibre-gl';
import type { LngLat } from '../core/geo';

export const LAYER_ID = 'stage-3d';
/** Calque du monde (testé contre les bâtiments de la carte). */
export const WORLD = 0;
/** Calque dessiné par-dessus tout (porteur, balises) : jamais caché par un immeuble. */
export const TOP = 1;

export class Layer3D implements CustomLayerInterface {
  readonly id = LAYER_ID;
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.Camera();
  private renderer: THREE.WebGLRenderer | null = null;
  private map: MlMap | null = null;
  /** Passage du repère local (mètres) aux coordonnées Mercator de la carte. */
  private readonly local = new THREE.Matrix4();
  private readonly tmp = new THREE.Matrix4();
  private readonly v4 = new THREE.Vector4();
  private ax = 0; private ay = 0; private s = 1;
  private vw = 0; private vh = 0;
  anchor: LngLat = [0, 0];

  constructor(anchor: LngLat) { this.setAnchor(anchor); }

  /** Change l'origine du repère local (à refaire si le joueur s'éloigne de plusieurs kilomètres). */
  setAnchor(at: LngLat): void {
    this.anchor = [at[0], at[1]];
    const mc = maplibregl.MercatorCoordinate.fromLngLat({ lng: at[0], lat: at[1] }, 0);
    this.ax = mc.x; this.ay = mc.y; this.s = mc.meterInMercatorCoordinateUnits();
    // x est -> x Mercator ; z sud -> y Mercator ; y haut -> altitude.
    this.local.makeTranslation(this.ax, this.ay, 0)
      .multiply(this.tmp.makeScale(this.s, -this.s, this.s))
      .multiply(this.tmp.makeRotationX(Math.PI / 2));
  }

  /** Position géographique -> repère local (y laissé à 0). */
  toLocal(at: LngLat, out: THREE.Vector3): THREE.Vector3 {
    const x = (at[0] + 180) / 360;
    const y = (1 - Math.asinh(Math.tan((at[1] * Math.PI) / 180)) / Math.PI) / 2;
    return out.set((x - this.ax) / this.s, 0, (y - this.ay) / this.s);
  }

  /** Repère local -> position géographique. */
  toLngLat(x: number, z: number, out: LngLat): LngLat {
    const mx = this.ax + x * this.s, my = this.ay + z * this.s;
    out[0] = mx * 360 - 180;
    out[1] = (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI;
    return out;
  }

  /** Projette un point local à l'écran (pixels CSS). Renvoie false s'il est derrière la caméra. */
  toScreen(x: number, y: number, z: number, out: { x: number; y: number }): boolean {
    if (!this.map) return false;
    const v = this.v4.set(x, y, z, 1).applyMatrix4(this.camera.projectionMatrix);
    if (v.w <= 1e-6) return false;
    const c = this.map.getContainer();
    out.x = (v.x / v.w * 0.5 + 0.5) * c.clientWidth;
    out.y = (0.5 - v.y / v.w * 0.5) * c.clientHeight;
    return true;
  }

  onAdd(map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true });
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = false;
  }

  onRemove(): void {
    this.renderer?.dispose();
    this.renderer = null;
    this.map = null;
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput): void {
    const r = this.renderer, map = this.map;
    if (!r || !map) return;
    const canvas = map.getCanvas();
    if (canvas.width !== this.vw || canvas.height !== this.vh) {
      this.vw = canvas.width; this.vh = canvas.height;
      r.setViewport(0, 0, this.vw, this.vh);
    }
    const cam = this.camera;
    cam.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix as unknown as number[]).multiply(this.local);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    r.resetState();
    cam.layers.set(WORLD);
    r.render(this.scene, cam);
    // Second passage sans la profondeur de la carte : le porteur et les balises restent visibles.
    r.clearDepth();
    cam.layers.set(TOP);
    r.render(this.scene, cam);
    r.resetState();
  }
}
