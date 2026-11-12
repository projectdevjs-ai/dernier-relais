// PROLOGUE — joué une seule fois. Une capsule écrasée sur la Plaine Noire ; le porteur se réveille,
// se lève, découvre la plaine et marche vers la Station Lumen. Scène three.js autonome (son propre
// canvas), entièrement calculée à partir du temps : on peut la figer à n'importe quel instant.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Ambiance } from '../game/api';
import { icon } from '../scene3d/icons';
import {
  Actor, Loader3D, Viewport, canvasTexture, clamp01, disposeObject, easeInOut, el, hash, lerp, reducedMotion,
  setEnvIntensity, setShadows, smooth, softDiscTexture, span,
} from '../scene3d/kit';
import '../scene3d/scene3d.css';
import { Veil } from '../scene3d/veil';
import './prologue.css';

const SEEN_KEY = 'dernier-relais/prologue';

/** Vrai tant que le prologue n'a jamais été vu (ou passé) sur cet appareil. */
export function shouldPlayPrologue(): boolean {
  try { return localStorage.getItem(SEEN_KEY) !== '1'; } catch { return false; }
}
function markSeen(): void {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* stockage indisponible : le prologue rejouera */ }
}

export interface PrologueOpts {
  ambiance?: Ambiance;
  /**
   * Repères sonores, dans l'ordre : 'vent' (début), 'reveil', 'debout', 'marche', 'station' (la Station
   * Lumen apparaît), 'titre', 'fin' (toujours émis, même si le joueur passe).
   */
  onSound?: (cue: string) => void;
  /** Démo et captures : fige la séquence à cet instant, en secondes. */
  freezeAt?: number;
}

// ---------- Minutage (secondes) ----------
const T = {
  fadeIn: [0.6, 4.2], wake: 3.6, stand: 6.7, standRate: 1.3, calm: 11.5, walk: 19.2,
  cutB: 7.6, cutC: 13.4, cutD: 22.6, cutE: 30.6,
  fadeOut: [38.2, 41.2], end: 43.2, skipAt: 3,
} as const;
const WALK_SPEED = 1.28;

/** Texte en surimpression. Les répliques « iris » reprennent mot pour mot l'ancienne version du jeu. */
const LINES: { from: number; to: number; kind: 'line' | 'place' | 'title'; text: string; kicker?: string }[] = [
  { from: 1.2, to: 6.4, kind: 'line', text: 'Tu es tombé du ciel.' },
  { from: 8.4, to: 13.0, kind: 'place', kicker: 'Signal de la capsule perdu', text: 'Plaine Noire' },
  { from: 14.4, to: 18.4, kind: 'line', text: 'Dehors, les villes sont coupées les unes des autres.' },
  { from: 18.9, to: 22.3, kind: 'line', text: 'Plus de routes sûres, plus de liaisons.' },
  { from: 23.3, to: 27.6, kind: 'line', text: 'Il ne reste que des gens comme toi, qui portent.' },
  { from: 31.4, to: 36.6, kind: 'place', kicker: 'Le dernier laboratoire encore relié au réseau', text: 'Station Lumen' },
  { from: 37.6, to: 42.6, kind: 'title', text: 'Dernier Relais' },
];
const CUES: [number, string][] = [[0, 'vent'], [T.wake, 'reveil'], [T.stand + 2.5, 'debout'], [T.walk, 'marche'], [T.cutE, 'station'], [37.6, 'titre']];

// ---------- Palettes ----------
interface Pal {
  top: number; mid: number; hor: number; sun: number; fog: number; fogDensity: number;
  sunLight: number; sunPower: number; sunElev: number; hemiSky: number; hemiGround: number; hemiPower: number;
  sand: number; rock: number; stars: number; exposure: number; bloom: number; cloud: number;
}
const PALS: Record<Ambiance, Pal> = {
  // Crépuscule : vert nuit en haut, braise à l'horizon.
  'crépuscule': {
    top: 0x0a1719, mid: 0x1f3a3a, hor: 0xc9793a, sun: 0xffb060, fog: 0x5a4130, fogDensity: 0.0016,
    sunLight: 0xffa860, sunPower: 4.2, sunElev: 0.105, hemiSky: 0x3d5e63, hemiGround: 0x16100c, hemiPower: 0.85,
    sand: 0x15161a, rock: 0x23272c, stars: 1, exposure: 1.05, bloom: 0.62, cloud: 0.55,
  },
  // Clair : matin pâle, soleil blanc chaud, sable gris sombre.
  'clair': {
    top: 0x5f7f96, mid: 0xa9bcc4, hor: 0xf1d9b4, sun: 0xfff0d4, fog: 0xb9bcb6, fogDensity: 0.0014,
    sunLight: 0xffe2bd, sunPower: 4.6, sunElev: 0.2, hemiSky: 0xb9cfdc, hemiGround: 0x3b3833, hemiPower: 1.7,
    sand: 0x2b2c30, rock: 0x70767c, stars: 0, exposure: 1.0, bloom: 0.42, cloud: 0.9,
  },
};

// ---------- Terrain ----------
const LAB_AT = new THREE.Vector3(-170, 0, -420);
const CAPSULE_AT = new THREE.Vector3(3.3, 0, -9.5);
const WALK_DIR = new THREE.Vector3(LAB_AT.x, 0, LAB_AT.z).normalize();
const PORTER_YAW = Math.atan2(WALK_DIR.x, WALK_DIR.z);
const SUN_AZ = 0.2; // le soleil est à droite de la station
/** Axe du travelling de marche : entre la direction de marche et le soleil, pour garder un liseré de lumière. */
const TRACK = new THREE.Vector3(WALK_DIR.x * 0.62 + Math.sin(SUN_AZ) * 0.38, 0, WALK_DIR.z * 0.62 - Math.cos(SUN_AZ) * 0.38).normalize();

/** Hauteur du sable : plat autour de la capsule, dunes douces plus loin. */
function groundH(x: number, z: number): number {
  const a = smooth(span(Math.hypot(x, z), 14, 170));
  return a * (Math.sin(x * 0.021 + 1.3) * 2.4 + Math.sin(z * 0.017 + 0.4) * 2.0 + Math.sin((x + z) * 0.043) * 0.7)
    + (Math.sin(x * 0.31) + Math.sin(z * 0.27 + 1)) * 0.025;
}

/** Carte de normales du sable : rides de vent irrégulières et grain, raccordable. */
function sandNormalMap(size = 512): THREE.CanvasTexture {
  const waves: [number, number, number, number][] = [[2, 23, 1, 0.3], [4, 27, 0.8, 1.9], [-3, 31, 0.6, 4.1], [5, 19, 0.7, 2.6], [1, 37, 0.35, 5.2], [9, 4, 0.5, 0.8]];
  const H = new Float32Array(size * size);
  let seed = 7;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const warp = Math.sin(Math.PI * 2 * (3 * u + v)) * 0.9 + Math.sin(Math.PI * 2 * (u - 2 * v) + 1.7) * 0.6;
    let h = 0;
    for (const [kx, ky, a, ph] of waves) h += a * Math.sin(Math.PI * 2 * (kx * u + ky * v) + ph + warp);
    H[y * size + x] = h * 0.55 + (rnd() - 0.5) * 0.55;
  }
  return canvasTexture(size, size, (g, w) => {
    const id = g.createImageData(w, w);
    const at = (x: number, y: number): number => H[((y + w) % w) * w + ((x + w) % w)];
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5, dy = (at(x, y + 1) - at(x, y - 1)) * 0.5;
      const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
      id.data[i] = (-dx / l * 0.5 + 0.5) * 255; id.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255; id.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; id.data[i + 3] = 255;
    }
    g.putImageData(id, 0, 0);
  }, false);
}

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FRAG = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHor; uniform vec3 uSunCol; uniform vec3 uSun;
  uniform float uStars; uniform float uCloud; uniform float uTime;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
  void main() {
    vec3 d = normalize(vDir);
    float h = max(d.y, 0.0);
    float s = max(dot(d, uSun), 0.0);
    // L'horizon ne rougeoie vraiment que du côté du soleil.
    vec3 c = mix(uHor * mix(0.42, 1.0, s * s), uMid, smoothstep(0.0, 0.17, h));
    c = mix(c, uTop, smoothstep(0.12, 0.75, h));
    float band = exp(-h * 7.0);
    // Halo du soleil : large nappe sur l'horizon, couronne, disque.
    c += uSunCol * (pow(s, 12.0) * 0.5 * band + pow(s, 64.0) * 0.4 + pow(s, 500.0) * 1.5 + smoothstep(0.99955, 0.9998, s) * 8.0);
    // Voiles d'altitude étirés par le vent, éclairés par en dessous.
    vec2 p = d.xz / (d.y + 0.11);
    float cl = smoothstep(0.5, 0.82, fbm(vec2(p.x * 0.55 + uTime * 0.004, p.y * 2.3))) * smoothstep(0.02, 0.2, d.y) * (1.0 - smoothstep(0.45, 0.9, d.y));
    c = mix(c, mix(uMid * 0.55, uSunCol * 1.25, pow(s, 3.0) * 0.85 + 0.08), cl * uCloud);
    // Quelques étoiles tout en haut.
    vec2 g = floor(d.xz / (abs(d.y) + 0.35) * 90.0);
    float st = step(0.9965, h21(g)) * smoothstep(0.3, 0.75, d.y) * uStars;
    c += vec3(0.75, 0.85, 1.0) * st * (0.6 + 0.6 * h21(g + 3.0));
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

interface World {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  porter: Actor;
  sun: THREE.DirectionalLight;
  ember: THREE.PointLight;
  smoke: THREE.Sprite[];
  sparks: THREE.Points;
  dust: THREE.Points;
  beam: THREE.Mesh[];
  sky: THREE.ShaderMaterial;
  pal: Pal;
  env: THREE.WebGLRenderTarget;
}

async function buildWorld(vp: Viewport, loader: Loader3D, pal: Pal): Promise<World> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 4000);
  const lin = (hex: number): THREE.Color => new THREE.Color(hex);
  scene.fog = new THREE.FogExp2(pal.fog, pal.fogDensity);

  // --- Ciel ---
  const az = SUN_AZ;
  const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(pal.sunElev), Math.sin(pal.sunElev), -Math.cos(az) * Math.cos(pal.sunElev)).normalize();
  const sky = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
    uniforms: {
      uTop: { value: lin(pal.top) }, uMid: { value: lin(pal.mid) }, uHor: { value: lin(pal.hor) }, uSunCol: { value: lin(pal.sun) },
      uSun: { value: sunDir }, uStars: { value: pal.stars }, uCloud: { value: pal.cloud }, uTime: { value: 0 },
    },
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3200, 48, 24), sky);
  // Reflets d'environnement tirés du ciel lui-même : le sable noir accroche l'horizon.
  const pm = new THREE.PMREMGenerator(vp.renderer);
  const envScene = new THREE.Scene();
  envScene.add(dome);
  const env = pm.fromScene(envScene, 0, 1, 4000);
  pm.dispose();
  scene.add(dome);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.4;

  // --- Lumières ---
  scene.add(new THREE.HemisphereLight(pal.hemiSky, pal.hemiGround, pal.hemiPower));
  const sun = new THREE.DirectionalLight(pal.sunLight, pal.sunPower);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 220;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
  sun.userData.dir = sunDir;
  scene.add(sun, sun.target);
  // Débouchage froid depuis le côté caméra : le porteur ne reste pas une silhouette bouchée.
  const fill = new THREE.DirectionalLight(pal.hemiSky, pal.hemiPower * 0.8);
  fill.position.set(-0.5, 0.7, 1);
  scene.add(fill);

  // --- Sable ---
  const N = 150, R = 1700;
  const geo = new THREE.PlaneGeometry(2, 2, N, N);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute, uv = geo.attributes.uv as THREE.BufferAttribute;
  const warp = (u: number): number => Math.sign(u) * (Math.abs(u) * 0.1 + Math.abs(u) ** 3 * 0.9) * R;
  for (let i = 0; i < pos.count; i++) {
    const x = warp(pos.getX(i)), z = warp(pos.getZ(i));
    pos.setXYZ(i, x, groundH(x, z), z);
    uv.setXY(i, x / 7, z / 7);
  }
  geo.computeVertexNormals();
  const nrm = sandNormalMap();
  nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;
  nrm.anisotropy = 8;
  const sand = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: pal.sand, roughness: 0.56, metalness: 0, normalMap: nrm, normalScale: new THREE.Vector2(0.9, 0.9) }));
  sand.receiveShadow = true;
  scene.add(sand);

  // --- Montagnes : trois crêtes en couronne, de plus en plus noyées dans la brume ---
  const ridges: THREE.BufferGeometry[] = [];
  for (const [rad, base, amp, seed] of [[760, 30, 120, 1], [1120, 70, 230, 2], [1560, 120, 380, 3]] as const) {
    const SEG = 240, pts: number[] = [];
    const crest = (i: number): [number, number, number, number, number, number] => {
      const a = (i / SEG) * Math.PI * 2;
      let h = 0;
      for (const [f, w] of [[5, 0.45], [11, 0.3], [23, 0.17], [47, 0.08]] as const) h += w * (1 - Math.abs(Math.sin(a * f * 0.5 + seed * 2.1 + f))) ** 1.6;
      h = base + amp * h * (0.94 + hash(i * 3.7 + seed * 91) * 0.12);
      const rr = rad + Math.sin(a * 9 + seed) * 40, foot = rr - h * 1.5 - 60;
      return [Math.sin(a) * rr, h, Math.cos(a) * rr, Math.sin(a) * foot, -14, Math.cos(a) * foot];
    };
    for (let i = 0; i < SEG; i++) {
      const p = crest(i), q = crest((i + 1) % SEG);
      pts.push(p[3], p[4], p[5], q[3], q[4], q[5], p[0], p[1], p[2], q[3], q[4], q[5], q[0], q[1], q[2], p[0], p[1], p[2]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    ridges.push(g);
  }
  const range = mergeGeometries(ridges);
  for (const g of ridges) g.dispose();
  if (range) {
    range.computeVertexNormals();
    scene.add(new THREE.Mesh(range, new THREE.MeshStandardMaterial({ color: pal.rock, roughness: 1, envMapIntensity: 0, side: THREE.DoubleSide })));
  }

  // --- Modèles ---
  const [porterM, capsuleM, labM, r1, r2, r3] = await Promise.all([
    loader.load('porteur_intro', { height: 1.8, fallback: 'perso' }),
    loader.load('capsule_crash', { width: 4.8 }),
    loader.load('labo_ext', { width: 104 }),
    loader.load('rocher_1', { width: 1 }), loader.load('rocher_2', { height: 1 }), loader.load('rocher_3', { width: 1 }),
  ]);

  // Porteur
  setShadows(porterM.root, true, false);
  setEnvIntensity(porterM.root, 0.35);
  const porter = new Actor(porterM);
  porter.root.rotation.y = PORTER_YAW;
  scene.add(porter.root);

  // Capsule : plantée de biais dans le sable, braises à l'intérieur
  const capsule = new THREE.Group();
  capsule.add(capsuleM.root);
  capsuleM.root.rotation.set(0.1, 0, -0.16);
  capsuleM.root.position.y = -0.42;
  capsule.position.copy(CAPSULE_AT);
  capsule.rotation.y = 2.75;
  setShadows(capsule, true, true);
  setEnvIntensity(capsule, 0.5);
  scene.add(capsule);
  const ember = new THREE.PointLight(0xff7a2e, 30, 16, 2);
  ember.position.set(CAPSULE_AT.x - 1.1, 0.7, CAPSULE_AT.z + 1.2);
  scene.add(ember);
  // Sillon laissé par la capsule : un bourrelet de sable sombre derrière elle
  const scar = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 26), new THREE.MeshBasicMaterial({ map: softDiscTexture(64, 0, 1.3), color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false }));
  scar.rotation.x = -Math.PI / 2;
  scar.rotation.z = -capsule.rotation.y + Math.PI / 2;
  scar.position.set(CAPSULE_AT.x + Math.sin(capsule.rotation.y + Math.PI / 2) * 11, 0.03, CAPSULE_AT.z + Math.cos(capsule.rotation.y + Math.PI / 2) * 11);
  scene.add(scar);

  // Station Lumen au loin, son faisceau
  const lab = new THREE.Group();
  lab.add(labM.root);
  lab.position.set(LAB_AT.x, groundH(LAB_AT.x, LAB_AT.z) - 1.5, LAB_AT.z);
  setEnvIntensity(lab, 0.2);
  scene.add(lab);
  const beam: THREE.Mesh[] = [];
  for (const [rad, op] of [[1.5, 0.75], [5.5, 0.12]] as const) {
    const b = new THREE.Mesh(
      new THREE.CylinderGeometry(rad, rad, 1500, 14, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x7fc7d9, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide }),
    );
    b.position.set(0, 750 + labM.size.y * 0.9, 0);
    b.userData.op = op;
    lab.add(b); beam.push(b);
  }
  const disc = softDiscTexture(128, 0.02, 2.2);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: disc, color: 0x7fc7d9, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  halo.scale.setScalar(120);
  halo.position.set(0, labM.size.y * 0.95, 0);
  lab.add(halo);

  // Rochers semés (aucun sur le chemin du porteur)
  const rocks = [r1, r2, r3];
  for (let i = 0; i < 54; i++) {
    const src = rocks[i % 3], big = hash(i * 13) > 0.8 && i > 14;
    const sz = big ? 7 + hash(i) * 12 : 0.5 + hash(i * 5) * 2.6;
    const a = hash(i * 17) * Math.PI * 2, d = i < 12 ? 7 + i * 3 : (big ? 110 : 30) + hash(i * 29) ** 0.8 * 420;
    const x = Math.sin(a) * d, z = Math.cos(a) * d;
    // distance au trajet (droite passant par l'origine, direction WALK_DIR)
    const side = Math.abs(x * WALK_DIR.z - z * WALK_DIR.x);
    if (Math.hypot(x - 1.5, z - 7) < 8 || (side < 3 + sz && z < 6) || Math.hypot(x - CAPSULE_AT.x, z - CAPSULE_AT.z) < 4 + sz || Math.hypot(x, z) < 3.5) continue;
    const r = src.root.clone(true);
    r.scale.setScalar(sz);
    r.position.set(x, groundH(x, z) - sz * 0.1, z);
    r.rotation.y = hash(i * 5) * 6.28;
    setShadows(r, d < 40, false);
    scene.add(r);
  }
  for (const r of rocks) setEnvIntensity(r.root, 0.3);

  // --- Fumée de la capsule ---
  const smoke: THREE.Sprite[] = [];
  const puff = softDiscTexture(128, 0, 1.4);
  for (let i = 0; i < 26; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: 0x6a5a4c, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    s.userData.seed = hash(i * 9.3);
    smoke.push(s); scene.add(s);
  }
  // --- Escarbilles ---
  const NS = 48, sp = new Float32Array(NS * 3);
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const sparks = new THREE.Points(sg, new THREE.PointsMaterial({ map: disc, color: 0xffa040, size: 0.11, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  // --- Sable soulevé par le vent, au ras du sol ---
  const ND = 700, dp = new Float32Array(ND * 3);
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dust = new THREE.Points(dg, new THREE.PointsMaterial({ map: disc, color: pal.sun, size: 0.05, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  dust.frustumCulled = false;
  scene.add(dust);

  return { scene, camera, porter, sun, ember, smoke, sparks, dust, beam, sky, pal, env };
}

const _p = new THREE.Vector3(), _l = new THREE.Vector3();
const SMOKE_HOT = new THREE.Color(0xb8551c), SMOKE_WARM = new THREE.Color(0x1c1612), SMOKE_COLD = new THREE.Color(0x232a2e);

/** Met toute la scène dans l'état de l'instant t (secondes). */
function applyTime(w: World, t: number, aspect: number, still: boolean): void {
  // --- Porteur : animation ---
  const p = w.porter;
  const wake = p.pick('Wake_Up_and_Look_Up'), stand = p.pick('Stand_Up1'), calm = p.pick('calm_0', 'calmv0', 'idle'), walk = p.pick('walk');
  const kStand = smooth(span(t, T.stand, T.stand + 0.7)), kCalm = smooth(span(t, T.calm, T.calm + 1.1)), kWalk = smooth(span(t, T.walk, T.walk + 0.8));
  p.pose([
    { name: wake, time: t - T.wake, weight: (1 - kStand) },
    { name: stand, time: 0.5 + (t - T.stand) * T.standRate, weight: kStand * (1 - kCalm) },
    { name: calm, time: t, weight: kCalm * (1 - kWalk), loop: true },
    { name: walk, time: (t - T.walk) * 1.02, weight: kWalk, loop: true },
  ]);
  // --- Porteur : déplacement ---
  const tau = Math.max(0, t - T.walk - 0.25);
  const s = WALK_SPEED * (tau - 0.5 * (1 - Math.exp(-tau / 0.5)));
  const px = WALK_DIR.x * s, pz = WALK_DIR.z * s, py = groundH(px, pz);
  p.root.position.set(px, py, pz);

  // --- Caméra ---
  const portrait = aspect < 1;
  const cam = w.camera;
  let fov = 50;
  if (t < T.cutB) {
    // A. Réveil : derrière la tête du porteur, la capsule fume à contre-jour.
    const k = easeInOut(span(t, 0, T.cutB));
    _p.set(lerp(0.8, 1.05, k), lerp(0.5, 0.74, k), lerp(5.2, 4.6, k));
    _l.set(lerp(0.45, 0.65, k), lerp(1.9, 1.7, k), -8);
    fov = portrait ? 58 : 36;
  } else if (t < T.cutC) {
    // B. Il se lève : de trois quarts face, éclairé par le soleil rasant.
    const k = span(t, T.cutB, T.cutC), e = easeInOut(k);
    _p.set(lerp(-2.3, -1.9, e), lerp(0.5, 0.72, e), lerp(-3.3, -3.7, e));
    _l.set(-0.1, lerp(0.95, 1.45, smooth(span(t, T.stand + 1.2, T.stand + 4.6))), 0.4);
    fov = portrait ? 52 : 34;
  } else if (t < T.cutD) {
    // C. Découverte : la caméra s'élève derrière lui, la station et son faisceau au bout de la plaine.
    const e = easeInOut(span(t, T.cutC, T.cutD));
    _p.set(lerp(1.3, 2.2, e), lerp(1.5, 3.1, e), lerp(3.7, 6.6, e));
    _l.set(LAB_AT.x * 0.2, lerp(-9, -4, e), LAB_AT.z * 0.2);
    fov = portrait ? 56 : 36;
  } else if (t < T.cutE) {
    // D. Marche : travelling bas, derrière lui, ombre longue et sable qui brille.
    const e = span(t, T.cutD, T.cutE);
    const back = lerp(3.5, 4.4, e);
    _p.set(px - TRACK.x * back, py + lerp(0.34, 0.52, e), pz - TRACK.z * back);
    _l.set(px + TRACK.x * 3, py + lerp(1.2, 1.4, e), pz + TRACK.z * 3);
    fov = portrait ? 56 : 36;
  } else {
    // E. Plan large : une silhouette minuscule vers la Station Lumen.
    const e = easeInOut(span(t, T.cutE, T.end));
    // La caméra recule le long du trajet, un peu à droite : le porteur reste en bas du cadre.
    const along = lerp(-6, -17, e), side = lerp(2.4, 4.2, e);
    _p.set(WALK_DIR.x * along - WALK_DIR.z * side, lerp(5.5, 12, e), WALK_DIR.z * along + WALK_DIR.x * side);
    _l.set(LAB_AT.x * 0.55, lerp(14, 20, e), LAB_AT.z * 0.55);
    fov = portrait ? 50 : 32;
  }
  if (!still) {
    // Caméra à l'épaule, à peine : deux sinus lents désaccordés.
    _p.x += Math.sin(t * 0.83) * 0.025 + Math.sin(t * 1.9 + 1) * 0.008;
    _p.y += Math.sin(t * 1.07 + 2) * 0.018;
    _l.x += Math.sin(t * 0.61 + 4) * 0.05;
    _l.y += Math.sin(t * 0.47) * 0.04;
  }
  cam.position.copy(_p);
  cam.lookAt(_l);
  if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }

  // --- Soleil : la carte d'ombres suit le porteur ---
  const dir = w.sun.userData.dir as THREE.Vector3;
  w.sun.target.position.set(px + 1.5, 0, pz - 3);
  w.sun.position.copy(w.sun.target.position).addScaledVector(dir, 110);

  // --- Capsule : braises, fumée couchée par le vent, escarbilles ---
  w.ember.intensity = 26 + Math.sin(t * 9.1) * 5 + Math.sin(t * 23.7) * 4 + Math.sin(t * 3.3) * 6;
  const sx = CAPSULE_AT.x - 0.6, sz = CAPSULE_AT.z + 0.4;
  for (let i = 0; i < w.smoke.length; i++) {
    const sp = w.smoke[i], seed = sp.userData.seed as number;
    const k = (t * 0.055 + i / w.smoke.length) % 1;
    const y = 1.3 + k * 15, drift = k * k * 13;
    sp.position.set(sx + drift * 0.9 + Math.sin(k * 9 + seed * 6) * (0.3 + k * 1.3), y, sz + drift * 0.25 + Math.cos(k * 7 + seed * 9) * (0.3 + k));
    sp.scale.setScalar(1.3 + k * 8.5);
    const m = sp.material;
    m.opacity = Math.min(1, k * 9) * (1 - k) ** 1.2 * 0.8;
    // Rougie par les braises à la base, puis grise et froide en montant.
    m.color.copy(SMOKE_HOT).lerp(SMOKE_WARM, smooth(span(k, 0, 0.16))).lerp(SMOKE_COLD, smooth(span(k, 0.2, 0.9)));
    m.rotation = seed * 6.28 + k * 1.4;
  }
  const spos = w.sparks.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < spos.count; i++) {
    const k = (t * (0.16 + hash(i) * 0.14) + hash(i * 3.1)) % 1;
    spos.setXYZ(i, sx - 0.4 + (hash(i * 7) - 0.5) * 1.4 + k * k * 3.2 + Math.sin(k * 12 + i) * 0.25, 0.5 + k * (2.4 + hash(i * 11) * 3.6), sz + 0.6 + (hash(i * 5) - 0.5) * 1.4 + Math.cos(k * 10 + i) * 0.25);
  }
  spos.needsUpdate = true;
  (w.sparks.material as THREE.PointsMaterial).opacity = 0.8 + Math.sin(t * 13) * 0.15;
  // --- Sable soulevé : un volume qui suit la caméra, balayé par le vent ---
  const dpos = w.dust.geometry.attributes.position as THREE.BufferAttribute;
  const bx = 34, bz = 34, cx = Math.round(cam.position.x / 4) * 4, cz = Math.round(cam.position.z / 4) * 4 - 10;
  for (let i = 0; i < dpos.count; i++) {
    const hx = hash(i * 1.7), hy = hash(i * 2.9), hz = hash(i * 4.3);
    const x = ((hx * bx + t * (2.2 + hy * 2.6)) % bx) - bx / 2, z = ((hz * bz + t * 0.7) % bz) - bz / 2;
    const y = 0.04 + hy * hy * 1.9 + Math.sin(t * 1.3 + i) * 0.05;
    dpos.setXYZ(i, cx + x, groundH(cx + x, cz + z) + y, cz + z);
  }
  dpos.needsUpdate = true;
  // --- Faisceau de la station : respiration lente ---
  for (const b of w.beam) (b.material as THREE.MeshBasicMaterial).opacity = (b.userData.op as number) * (0.8 + Math.sin(t * 1.7) * 0.12 + Math.sin(t * 5.3) * 0.05);
  w.sky.uniforms.uTime.value = t;
}

/**
 * Joue le prologue dans `root` (canvas plein écran au-dessus du jeu), puis nettoie tout.
 * La promesse est résolue à la fin de la séquence ou dès que le joueur passe. Ne rejette jamais.
 */
export function playPrologue(root: HTMLElement, opts: PrologueOpts = {}): Promise<void> {
  const ambiance: Ambiance = opts.ambiance ?? 'crépuscule';
  const pal = PALS[ambiance];
  const still = reducedMotion();
  const frozen = typeof opts.freezeAt === 'number' && Number.isFinite(opts.freezeAt);

  return new Promise<void>(resolve => {
    const host = el('div', 's3 s3-prologue');
    host.dataset.ambiance = ambiance;
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', 'Prologue');
    root.appendChild(host);

    let vp: Viewport;
    try { vp = new Viewport(host, { post: true, shadows: true }); } catch (e) {
      // Pas de WebGL : on ne bloque pas le joueur, il arrive directement au labo.
      console.warn('[prologue] WebGL indisponible, prologue ignoré', e);
      host.remove(); markSeen(); opts.onSound?.('fin'); resolve();
      return;
    }
    vp.setLook({ exposure: pal.exposure, bloom: pal.bloom, bloomThreshold: 1.0, bloomRadius: 0.75, vignette: 0.55, grain: 0.035 });

    // --- Texte en surimpression ---
    const fade = el('div', 'pl-fade');
    const layer = el('div', 'pl-layer');
    const nodes = LINES.map(l => {
      const n = el('div', `pl-${l.kind}`);
      if (l.kicker) n.append(el('span', 'pl-kicker', l.kicker));
      if (l.kind === 'line') n.append(el('p', '', l.text)); else n.append(el('span', 'pl-name', l.text));
      n.style.opacity = '0';
      layer.appendChild(n);
      return n;
    });
    const skip = el('button', 'pl-skip');
    skip.type = 'button';
    skip.append(el('span', '', 'Passer'), icon('passer'));
    skip.hidden = true;
    host.append(el('div', 'pl-shade'), fade, layer, skip);
    const veil = new Veil(host, 'Dernier Relais', 'Prologue');
    veil.loader(true);

    const loader = new Loader3D(k => veil.progress(k));
    let world: World | null = null;
    let raf = 0, done = false, t = frozen ? (opts.freezeAt as number) : 0, last = 0, cue = 0, leaving = -1;

    const finish = (): void => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      skip.removeEventListener('click', onSkip);
      document.removeEventListener('keydown', onKey);
      markSeen();
      if (world) {
        world.porter.dispose();
        disposeObject(world.scene);
        world.env.dispose();
        world.scene.environment = null;
      }
      loader.dispose();
      vp.dispose();
      host.remove();
      opts.onSound?.('fin');
      resolve();
    };
    // Passer : court fondu au noir, puis fin.
    const onSkip = (): void => {
      if (frozen) { finish(); return; }
      if (leaving < 0) { leaving = performance.now(); skip.disabled = true; }
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !skip.hidden) onSkip(); };
    skip.addEventListener('click', onSkip);
    document.addEventListener('keydown', onKey);

    const overlay = (): void => {
      let f = 1 - smooth(span(t, T.fadeIn[0], T.fadeIn[1])) + smooth(span(t, T.fadeOut[0], T.fadeOut[1]));
      if (leaving >= 0) f = Math.max(f, clamp01((performance.now() - leaving) / 450));
      fade.style.opacity = clamp01(f).toFixed(3);
      for (let i = 0; i < LINES.length; i++) {
        const l = LINES[i], n = nodes[i];
        const o = leaving >= 0 ? 0 : smooth(span(t, l.from, l.from + 1.1)) * (1 - smooth(span(t, l.to - 0.9, l.to)));
        n.style.opacity = o.toFixed(3);
        // Les titres se resserrent très lentement, les lignes montent d'un souffle.
        if (!still && o > 0) {
          const k = span(t, l.from, l.to);
          n.style.transform = l.kind === 'line' ? `translateY(${((1 - smooth(span(t, l.from, l.from + 1.4))) * 10).toFixed(1)}px)` : `scale(${(1.045 - k * 0.045).toFixed(4)})`;
        }
      }
      if (!frozen && skip.hidden && t >= T.skipAt) skip.hidden = false;
    };

    const frame = (now: number): void => {
      if (done || !world) return;
      raf = requestAnimationFrame(frame);
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      if (!frozen) t += dt;
      while (cue < CUES.length && t >= CUES[cue][0]) opts.onSound?.(CUES[cue++][1]);
      applyTime(world, t, vp.aspect, still || frozen);
      overlay();
      vp.render(world.scene, world.camera, t);
      if ((leaving >= 0 && now - leaving > 520) || (!frozen && t >= T.end)) finish();
    };

    buildWorld(vp, loader, pal).then(w => {
      if (done) { disposeObject(w.scene); w.env.dispose(); return; }
      world = w;
      // Première image calculée avant de lever le voile (compilation des matériaux comprise).
      applyTime(w, t, vp.aspect, true);
      overlay();
      vp.render(w.scene, w.camera, t);
      veil.loader(false);
      veil.lift();
      // Figé (démo, captures) : une seule image, pas de boucle de rendu.
      if (frozen) { skip.hidden = t < T.skipAt; host.dataset.pret = '1'; console.info('[prologue] image figée prête'); return; }
      raf = requestAnimationFrame(frame);
    }).catch(e => { console.warn('[prologue] échec, prologue ignoré', e); finish(); });
  });
}
