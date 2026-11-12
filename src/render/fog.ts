// Brume d'exploration : les cases jamais parcourues sont noyées dans une nappe de brume qui ondule,
// les cases visitées restent nettes, avec une lisière douce entre les deux.
// Une petite texture (4 x 4 points par case) sert de masque ; son filtrage lisse la transition.
import * as THREE from 'three';
import { CELL_Z, cellAt, tileLngLat, type LngLat } from '../core/geo';
import { type Layer3D, WORLD } from './layer';

/** Côté de la grille de cases couverte, centrée sur le joueur. */
const N = 16;
/** Points de masque par côté de case : assez pour que la lisière suive le bord des cases, coins compris. */
const K = 4;
const T = N * K;
const vert = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const frag = /* glsl */`
uniform sampler2D uMask; uniform vec3 uColor; uniform vec3 uLight; uniform float uOpacity; uniform float uTime;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  // Coordonnées en cases : la brume dérive lentement, en deux nappes.
  vec2 c = uv * ${N}.0;
  float n1 = noise(c * 9.0 + vec2(uTime * 0.05, uTime * 0.02));
  float n2 = noise(c * 26.0 - vec2(uTime * 0.07, -uTime * 0.04));
  float m = texture2D(uMask, uv).r + (n1 - 0.5) * 0.10;
  float edge = smoothstep(0.30, 0.72, m);
  float a = edge * (0.80 + 0.20 * n1) * uOpacity;
  vec3 col = mix(uColor, uLight, n1 * 0.55 + n2 * 0.25);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

export class ExploreFog {
  private readonly data = new Uint8Array(T * T);
  private readonly tex: THREE.DataTexture;
  private readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly seen = new Set<string>();
  private key = '';
  private x0 = 0; private y0 = 0;
  private any = false;
  private readonly a = new THREE.Vector3(); private readonly b = new THREE.Vector3();

  constructor(scene: THREE.Scene, private readonly layer: Layer3D) {
    this.tex = new THREE.DataTexture(this.data, T, T, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.LinearFilter; this.tex.minFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, depthTest: false,
      uniforms: { uMask: { value: this.tex }, uColor: { value: new THREE.Color() }, uLight: { value: new THREE.Color() }, uOpacity: { value: 0.8 }, uTime: { value: 0 } },
    }));
    // Sans test de profondeur et avant les repères au sol : la brume recouvre aussi les immeubles de la carte.
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 1; this.mesh.layers.set(WORLD); this.mesh.visible = false;
    this.mesh.position.y = 0.05;
    scene.add(this.mesh);
  }

  /** Vrai si de la brume est affichée (elle ondule : la scène doit rester animée). */
  get visible(): boolean { return this.mesh.visible; }

  /** Met le masque à jour quand les cases visitées ou la case du joueur changent. */
  sync(at: LngLat | null, visited: string[]): void {
    if (!at || !visited.length) { this.mesh.visible = false; this.key = ''; return; }
    const here = cellAt(at[0], at[1]);
    const key = `${here.id}|${visited.length}|${visited[visited.length - 1]}`;
    if (key === this.key) return;
    this.key = key;
    this.seen.clear();
    for (const id of visited) this.seen.add(id);
    this.x0 = here.x - N / 2; this.y0 = here.y - N / 2;
    this.any = false;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const fog = !this.seen.has(`${this.x0 + i}/${this.y0 + j}`);
      if (fog) this.any = true;
      for (let b = 0; b < K; b++) this.data.fill(fog ? 255 : 0, (j * K + b) * T + i * K, (j * K + b) * T + i * K + K);
    }
    this.tex.needsUpdate = true;
    this.mesh.visible = this.any;
    this.reposition();
  }

  reposition(): void {
    if (!this.key) return;
    this.layer.toLocal(tileLngLat(this.x0, this.y0, CELL_Z), this.a);
    this.layer.toLocal(tileLngLat(this.x0 + N, this.y0 + N, CELL_Z), this.b);
    this.mesh.position.set((this.a.x + this.b.x) / 2, 0.05, (this.a.z + this.b.z) / 2);
    this.mesh.scale.set(Math.abs(this.b.x - this.a.x), 1, Math.abs(this.b.z - this.a.z));
  }

  applyColors(veil: string, light: string, opacity: number): void {
    const u = this.mesh.material.uniforms;
    (u.uColor.value as THREE.Color).set(veil); (u.uLight.value as THREE.Color).set(light); u.uOpacity.value = opacity;
  }

  update(timeS: number): void {
    if (this.mesh.visible) this.mesh.material.uniforms.uTime.value = timeS % 4000;
  }
}
