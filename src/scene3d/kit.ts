// Outils communs aux deux scènes autonomes (prologue et labo) : vue WebGL avec post-traitement
// léger, chargement des modèles GLB sans cache (pour pouvoir tout libérer), acteurs animés,
// textures procédurales et petites fonctions de mise en scène.
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// ---------- Petites maths ----------
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
/** Progression 0→1 entre a et b, bornée. */
export const span = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a));
export const smooth = (k: number): number => k * k * (3 - 2 * k);
export const easeInOut = (k: number): number => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
export const easeOut = (k: number): number => 1 - (1 - k) ** 3;
/** Bruit pseudo-aléatoire stable (0 à 1) pour un entier. */
export function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---------- Vue : canvas, rendu, post-traitement ----------
export interface Look {
  exposure: number;
  bloom: number;
  bloomThreshold: number;
  bloomRadius: number;
  vignette: number;
  grain: number;
}
const DEFAULT_LOOK: Look = { exposure: 1, bloom: 0.5, bloomThreshold: 0.9, bloomRadius: 0.6, vignette: 0.35, grain: 0.03 };

/** Passe finale : courbe de tons ACES, conversion sRGB, vignette et grain discret. Une seule passe plein écran. */
const FINAL_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    toneMappingExposure: { value: 1 },
    uVignette: { value: 0.35 },
    uGrain: { value: 0.03 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    precision highp float;
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    attribute vec3 position;
    attribute vec2 uv;
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uTime;
    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>
    varying vec2 vUv;
    float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 q = vUv - 0.5;
      float v = smoothstep(0.25, 0.95, length(q * vec2(0.9, 1.0)) * 1.25);
      c.rgb *= (1.0 - uVignette * v);
      c.rgb = ACESFilmicToneMapping(c.rgb);
      c = sRGBTransferOETF(vec4(c.rgb, 1.0));
      c.rgb += (rnd(vUv * 917.0 + fract(uTime) * 31.0) - 0.5) * uGrain;
      gl_FragColor = vec4(c.rgb, 1.0);
    }`,
};

/** Vrai si l'adresse porte « ?leger » : rendu 3D allégé pour les essais automatiques. */
export function lightRender(): boolean {
  try { return new URLSearchParams(location.search).has('leger'); } catch { return false; }
}

export class Viewport {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  width = 1;
  height = 1;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private final: THREE.RawShaderMaterial | null = null;
  private look: Look = { ...DEFAULT_LOOK };
  private ro: ResizeObserver | null = null;
  private dirty = true;
  private readonly onWinResize = (): void => { this.dirty = true; };

  /** Lève une exception si WebGL est indisponible : l'appelant prévoit un repli. */
  constructor(private readonly root: HTMLElement, opts: { post?: boolean; shadows?: boolean } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 's3-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    root.appendChild(this.canvas);
    // « ?leger » (essais automatiques sans carte graphique) : image réduite, sans effets ni ombres.
    const light = lightRender();
    const post = opts.post !== false && !light;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !post, powerPreference: 'high-performance', alpha: false });
    } catch (e) {
      this.canvas.remove();
      throw e;
    }
    const r = this.renderer;
    r.setPixelRatio(light ? 0.25 : Math.min(2, window.devicePixelRatio || 1));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    if (opts.shadows && !light) { r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap; }
    if (post && r.capabilities.isWebGL2) {
      const pr = r.getPixelRatio();
      // Anticrénelage matériel sur la cible intermédiaire : 4 échantillons sur écran ordinaire, 2 sur écran dense.
      const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: pr >= 2 ? 2 : 4 });
      this.composer = new EffectComposer(r, rt);
      this.final = new THREE.RawShaderMaterial({
        uniforms: THREE.UniformsUtils.clone(FINAL_SHADER.uniforms),
        vertexShader: FINAL_SHADER.vertexShader, fragmentShader: FINAL_SHADER.fragmentShader,
        defines: { ACES_FILMIC_TONE_MAPPING: '', SRGB_TRANSFER: '' },
        depthTest: false, depthWrite: false,
      });
    }
    window.addEventListener('resize', this.onWinResize);
    if (typeof ResizeObserver === 'function') { this.ro = new ResizeObserver(this.onWinResize); this.ro.observe(root); }
    this.resize();
  }

  setLook(l: Partial<Look>): void {
    Object.assign(this.look, l);
    this.renderer.toneMappingExposure = this.look.exposure;
    if (this.bloom) { this.bloom.strength = this.look.bloom; this.bloom.threshold = this.look.bloomThreshold; this.bloom.radius = this.look.bloomRadius; }
  }

  /** Ajuste la taille au conteneur. Renvoie vrai si elle a changé. */
  resize(): boolean {
    if (!this.dirty) return false;
    this.dirty = false;
    const w = Math.max(1, this.root.clientWidth || window.innerWidth), h = Math.max(1, this.root.clientHeight || window.innerHeight);
    if (w === this.width && h === this.height) return false;
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    return true;
  }

  get aspect(): number { return this.width / this.height; }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, timeS: number): void {
    if (this.resize() || camera.aspect !== this.aspect) { camera.aspect = this.aspect; camera.updateProjectionMatrix(); }
    if (!this.composer || !this.final) { this.renderer.render(scene, camera); return; }
    if (!this.renderPass) {
      this.renderPass = new RenderPass(scene, camera);
      this.bloom = new UnrealBloomPass(new THREE.Vector2(this.width, this.height), this.look.bloom, this.look.bloomRadius, this.look.bloomThreshold);
      this.composer.addPass(this.renderPass);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new ShaderPass(this.final));
      this.composer.setSize(this.width, this.height);
    }
    this.renderPass.scene = scene; this.renderPass.camera = camera;
    const u = this.final.uniforms;
    u.toneMappingExposure.value = this.look.exposure;
    u.uVignette.value = this.look.vignette;
    u.uGrain.value = this.look.grain;
    u.uTime.value = timeS;
    this.composer.render();
  }

  dispose(): void {
    window.removeEventListener('resize', this.onWinResize);
    this.ro?.disconnect();
    this.bloom?.dispose();
    this.final?.dispose();
    this.composer?.dispose();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}

// ---------- Chargement des modèles ----------
export type Fallback = 'perso' | 'objet';
export interface Model {
  /** Modèle normalisé : à l'échelle demandée, base posée au sol (y = 0), centré en x/z. */
  root: THREE.Group;
  clips: THREE.AnimationClip[];
  /** Dimensions finales en mètres. */
  size: THREE.Vector3;
  /** Faux si la forme de remplacement a été utilisée. */
  ok: boolean;
}
export interface FitOpts {
  /** Hauteur visée en mètres. */
  height?: number;
  /** Plus grande dimension horizontale visée en mètres. Si les deux sont donnés, la plus petite échelle gagne. */
  width?: number;
  fallback?: Fallback;
}

/** Suit l'avancement d'un lot de chargements et libère tout ce qui a été chargé. */
export class Loader3D {
  private readonly gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private readonly parts: number[] = [];
  private readonly owned: THREE.Object3D[] = [];
  private dead = false;
  constructor(private readonly onProgress: (k: number) => void = () => { /* rien */ }) {}

  private report(): void {
    if (!this.parts.length) return;
    this.onProgress(this.parts.reduce((a, b) => a + b, 0) / this.parts.length);
  }

  /** Charge `models/<name>.glb` (chemin relatif : le jeu est aussi emballé en APK). Ne rejette jamais. */
  load(name: string, fit: FitOpts): Promise<Model> {
    const i = this.parts.push(0) - 1;
    return new Promise<Model>(resolve => {
      const done = (m: Model): void => {
        this.parts[i] = 1; this.report();
        if (this.dead) disposeObject(m.root); else this.owned.push(m.root);
        resolve(m);
      };
      this.gltf.load(
        `models/${name}.glb`,
        g => {
          let m: Model;
          try { m = normalise(g.scene, g.animations, fit); } catch (e) { console.warn(`[scene3d] modèle « ${name} » illisible`, e); m = placeholder(fit); }
          done(m);
        },
        ev => { if (ev.lengthComputable && ev.total > 0) { this.parts[i] = Math.min(0.95, ev.loaded / ev.total); this.report(); } },
        err => { console.warn(`[scene3d] modèle « ${name} » indisponible, forme de remplacement`, err); done(placeholder(fit)); },
      );
    });
  }

  /** Libère géométries et textures de tous les modèles chargés par ce chargeur. */
  dispose(): void {
    this.dead = true;
    for (const o of this.owned) disposeObject(o);
    this.owned.length = 0;
  }
}

const _box = new THREE.Box3();
const _v = new THREE.Vector3();

function normalise(scene: THREE.Object3D, animations: THREE.AnimationClip[], fit: FitOpts): Model {
  scene.updateMatrixWorld(true);
  scene.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if ((m as THREE.SkinnedMesh).isSkinnedMesh) m.frustumCulled = false;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) tameMaterial(mat);
  });
  _box.setFromObject(scene, true);
  if (_box.isEmpty()) return placeholder(fit);
  const size = _box.getSize(_v).clone();
  let k = Infinity;
  if (fit.height) k = Math.min(k, fit.height / Math.max(size.y, 1e-4));
  if (fit.width) k = Math.min(k, fit.width / Math.max(size.x, size.z, 1e-4));
  if (!Number.isFinite(k)) k = 1;
  const cx = (_box.min.x + _box.max.x) / 2, cz = (_box.min.z + _box.max.z) / 2;
  scene.position.set(-cx * k, -_box.min.y * k, -cz * k);
  scene.scale.multiplyScalar(k);
  const root = new THREE.Group();
  root.add(scene);
  return { root, clips: animations.map(cleanClip), size: size.multiplyScalar(k), ok: true };
}

/** Modèles générés : on borne le métal et le brillant pour rester lisible sous un éclairage simple. */
function tameMaterial(mat: THREE.Material): void {
  const s = mat as THREE.MeshStandardMaterial;
  if (!s.isMeshStandardMaterial) return;
  s.metalness = Math.min(s.metalness, 0.35);
  s.roughness = Math.max(s.roughness, 0.55);
  if (s.map) s.map.anisotropy = 4;
}

/** Garde les rotations et la translation du bassin ; retire la dérive des cycles de marche (animation sur place). */
function cleanClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const loop = /^(walk|run)$/i.test(clip.name);
  const tracks: THREE.KeyframeTrack[] = [];
  for (const t of clip.tracks) {
    if (t.name.endsWith('.quaternion')) { tracks.push(t); continue; }
    if (t.name.endsWith('.position') && /hips/i.test(t.name)) {
      const a = t.values, n = a.length / 3;
      if (loop && n > 1) {
        for (const axis of [0, 2]) {
          const drift = a[(n - 1) * 3 + axis] - a[axis];
          for (let i = 0; i < n; i++) a[i * 3 + axis] -= (drift * i) / (n - 1);
        }
      }
      tracks.push(t);
    }
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

function placeholder(fit: FitOpts): Model {
  const h = fit.height ?? (fit.width ? fit.width * 0.7 : 1);
  let geo: THREE.BufferGeometry, w: number;
  if (fit.fallback === 'perso') { w = h * 0.3; geo = new THREE.CapsuleGeometry(w / 2, h - w, 4, 10); }
  else { w = fit.width ?? h; geo = new THREE.BoxGeometry(w, h, w * 0.6); }
  geo.translate(0, h / 2, 0);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x55666a, roughness: 0.8, metalness: 0.1 }));
  const root = new THREE.Group();
  root.add(mesh);
  return { root, clips: [], size: new THREE.Vector3(w, h, w), ok: false };
}

/** Libère géométries, matériaux et textures d'un objet et de ses enfants. */
export function disposeObject(o: THREE.Object3D): void {
  o.traverse(c => {
    const m = c as THREE.Mesh;
    const geo = (m as { geometry?: THREE.BufferGeometry }).geometry;
    if (geo) geo.dispose();
    const mats = (m as { material?: THREE.Material | THREE.Material[] }).material;
    for (const mat of Array.isArray(mats) ? mats : mats ? [mats] : []) {
      for (const val of Object.values(mat as unknown as Record<string, unknown>)) {
        if (val && (val as THREE.Texture).isTexture) (val as THREE.Texture).dispose();
      }
      const un = (mat as THREE.ShaderMaterial).uniforms;
      if (un) for (const u of Object.values(un)) if (u.value && (u.value as THREE.Texture).isTexture) (u.value as THREE.Texture).dispose();
      mat.dispose();
    }
    const sk = (m as unknown as THREE.SkinnedMesh).skeleton;
    if (sk) sk.dispose();
  });
}

/** Règle l'intensité des reflets d'environnement de tous les matériaux d'un objet. */
export function setEnvIntensity(o: THREE.Object3D, k: number): void {
  o.traverse(c => {
    const mats = (c as THREE.Mesh).material;
    for (const mat of Array.isArray(mats) ? mats : mats ? [mats] : []) {
      if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) (mat as THREE.MeshStandardMaterial).envMapIntensity = k;
    }
  });
}

export function setShadows(o: THREE.Object3D, cast: boolean, receive: boolean): void {
  o.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = cast; c.receiveShadow = receive; } });
}

// ---------- Acteur animé ----------
export class Actor {
  readonly root: THREE.Group;
  readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  currentName = '';

  constructor(model: Model) {
    this.root = model.root;
    this.mixer = new THREE.AnimationMixer(model.root);
    for (const c of model.clips) this.actions.set(c.name, this.mixer.clipAction(c));
  }

  has(name: string): boolean { return this.actions.has(name); }
  duration(name: string): number { return this.actions.get(name)?.getClip().duration ?? 0; }
  /** Premier nom d'animation existant dans la liste. */
  pick(...names: string[]): string { return names.find(n => this.actions.has(n)) ?? ''; }

  /** Lance une animation en fondu enchaîné (lecture en temps réel). */
  play(name: string, fade = 0.35, once = false, timeScale = 1): void {
    const a = this.actions.get(name);
    if (!a || a === this.current) return;
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    a.clampWhenFinished = once;
    a.setEffectiveTimeScale(timeScale);
    a.setEffectiveWeight(1);
    a.fadeIn(fade).play();
    this.current?.fadeOut(fade);
    this.current = a;
    this.currentName = name;
  }

  update(dt: number): void { this.mixer.update(dt); }

  /**
   * Pose déterministe : chaque animation citée est figée à un instant donné avec un poids donné.
   * Sert au prologue, entièrement calculé à partir du temps (on peut le figer à n'importe quel instant).
   */
  pose(layers: { name: string; time: number; weight: number; loop?: boolean }[]): void {
    for (const a of this.actions.values()) { a.enabled = false; a.setEffectiveWeight(0); }
    for (const l of layers) {
      const a = this.actions.get(l.name);
      if (!a || l.weight <= 0) continue;
      const d = a.getClip().duration;
      a.enabled = true;
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.clampWhenFinished = false;
      a.paused = true;
      if (!a.isRunning() && !a.isScheduled()) a.play();
      a.play();
      a.time = l.loop ? ((l.time % d) + d) % d : Math.min(Math.max(l.time, 0), d - 1e-3);
      a.setEffectiveWeight(l.weight);
    }
    this.mixer.update(0);
  }

  dispose(): void { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root); }
}

// ---------- Textures procédurales ----------
export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Disque doux (halo, fumée, ombre de contact). */
export function softDiscTexture(size = 128, inner = 0.05, power = 1.6): THREE.CanvasTexture {
  return canvasTexture(size, size, (g, w) => {
    const id = g.createImageData(w, w);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - w / 2 + 0.5, y - w / 2 + 0.5) / (w / 2);
      const a = d <= inner ? 1 : Math.max(0, 1 - (d - inner) / (1 - inner)) ** power;
      const i = (y * w + x) * 4;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = 255; id.data[i + 3] = Math.round(a * 255);
    }
    g.putImageData(id, 0, 0);
  }, false);
}

/** Ombre de contact : un disque sombre posé au sol. */
export function blobShadow(tex: THREE.Texture, w: number, d: number, opacity = 0.55): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, opacity, depthWrite: false, fog: false, toneMapped: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.scale.set(w, d, 1);
  m.position.y = 0.012;
  m.renderOrder = 1;
  return m;
}

/** Halo additif (plan ou sprite). */
export function glowMaterial(tex: THREE.Texture, color: number, opacity: number): THREE.SpriteMaterial {
  return new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
}

// ---------- Interface commune ----------
/** Petit constructeur d'éléments DOM. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
