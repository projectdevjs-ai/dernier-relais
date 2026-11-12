// Ciel et météo : éclairage three.js, voile atmosphérique, pluie et neige.
// Tout dérive de l'ambiance choisie et de view.weather.
import * as THREE from 'three';
import type { Ambiance, Weather } from '../game/api';
import { TOP, WORLD } from './layer';
import type { Palette } from './mapstyle';

/** État du ciel calculé, partagé par tous les modules de rendu. */
export interface Env {
  ambiance: Ambiance;
  /** 0 : jour ou heure dorée, 1 : nuit noire (soleil sous -4°). */
  night: number;
  /** Heure dorée : 0 en plein jour (soleil au-dessus de 6°), 1 quand le soleil rase l'horizon. */
  gold: number;
  /** Pluie ou neige, de 0 à 1. */
  rain: number;
  snow: boolean;
  fog: number;
  /** Grisaille (temps couvert), de 0 à 1 : désature la carte. */
  dull: number;
  windKmh: number;
  /** Vrai quand le fond est sombre : les effets lumineux passent en mode additif. */
  dark: boolean;
  /** Clé de changement : rien à refaire tant qu'elle est identique. */
  key: string;
}

const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function computeEnv(ambiance: Ambiance, w: Weather | null): Env {
  // Trois états pilotés par la SEULE hauteur du soleil : jour (> 6°), heure dorée (de -4° à 6°), nuit (< -4°),
  // avec un fondu de quelques degrés autour de chaque seuil. Avant : la nuit commençait à monter dès 8° et le
  // drapeau `weather.night` (vrai dès -0,83°) forçait 85 % de nuit alors que le ciel est encore clair.
  const alt = w ? w.sunAltDeg : 30;
  const night = Math.round(smooth(-2, -6, alt) * 10) / 10;
  const gold = Math.round(smooth(8.5, 3.5, alt) * 10) / 10;
  const kind = w?.kind ?? 'clair';
  const rain = kind === 'pluie' ? 0.7 : kind === 'orage' ? 1 : kind === 'neige' ? 0.6 : 0;
  const fog = kind === 'brouillard' ? 1 : kind === 'orage' ? 0.35 : kind === 'pluie' || kind === 'neige' ? 0.25 : 0;
  const dull = kind === 'clair' ? 0 : kind === 'nuages' ? 0.35 : kind === 'brouillard' ? 0.8 : 0.6;
  const windKmh = Math.round((w?.windKmh ?? 0) / 10) * 10;
  const low = Math.round(smooth(25, 5, alt) * 4) / 4; // soleil bas : lumière plus chaude
  return {
    ambiance, night, gold, rain, snow: kind === 'neige', fog, dull, windKmh,
    dark: night >= 0.5,
    key: `${ambiance}|${night}|${gold}|${kind}|${windKmh}|${low}`,
  };
}

const quadVert = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const quadFrag = /* glsl */`
uniform vec3 uColor; uniform vec3 uHorizon; uniform vec3 uVig; uniform float uTop; uniform float uStart; uniform float uAll; uniform float uVignette;
varying vec2 vUv;
void main() {
  // Voile atmosphérique : le lointain (haut de l'écran) se fond dans la teinte de l'air,
  // puis dans la lueur de l'horizon tout en haut ; les bords s'assombrissent un peu.
  float far = smoothstep(uStart, 1.0, vUv.y);
  float glow = smoothstep(0.80, 1.0, vUv.y);
  float vig = smoothstep(0.55, 1.15, length((vUv - 0.5) * vec2(1.0, 1.25)) * 1.5) * uVignette;
  float air = clamp(uAll + uTop * far * far, 0.0, 1.0);
  vec3 c = mix(uColor, uHorizon, glow * glow);
  float a = air + vig * (1.0 - air);
  c = mix(uVig, c, air / max(a, 0.0001));
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}`;

const rainVert = /* glsl */`
attribute vec3 seed; attribute float tip;
uniform float uTime; uniform vec3 uCenter; uniform vec3 uBox; uniform vec3 uFall; uniform float uLen;
varying float vA;
void main() {
  float sp = 0.75 + 0.5 * seed.x;
  vec3 p = seed * uBox;
  p.y = mod(p.y + uFall.y * sp * uTime, uBox.y);
  p.xz = mod(p.xz + uFall.xz * sp * uTime - uCenter.xz, uBox.xz) - 0.5 * uBox.xz + uCenter.xz;
  p -= normalize(uFall) * tip * uLen * sp;
  vA = (1.0 - tip) * (0.55 + 0.45 * seed.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const rainFrag = /* glsl */`
uniform vec3 uColor; uniform float uOpacity; varying float vA;
void main() {
  gl_FragColor = vec4(uColor, uOpacity * vA);
  #include <colorspace_fragment>
}`;

const moteVert = /* glsl */`
attribute vec3 seed;
uniform float uTime; uniform vec3 uCenter; uniform vec3 uBox; uniform float uSize;
varying float vA;
void main() {
  // Poussières en suspension : lente montée, léger balancement, bouclées dans une boîte autour du joueur.
  vec3 p = seed * uBox;
  float sp = 0.4 + seed.z * 0.8;
  p.y = mod(p.y + uTime * sp * 0.9, uBox.y);
  p.x += sin(uTime * 0.35 * sp + seed.y * 40.0) * 2.5;
  p.z += cos(uTime * 0.28 * sp + seed.x * 40.0) * 2.5;
  p.xz = mod(p.xz - uCenter.xz, uBox.xz) - 0.5 * uBox.xz + uCenter.xz;
  float k = p.y / uBox.y;
  vA = smoothstep(0.0, 0.15, k) * (1.0 - smoothstep(0.7, 1.0, k)) * (0.45 + 0.55 * sin(uTime * (0.8 + seed.x) + seed.y * 30.0) * 0.5 + 0.275);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * (0.6 + seed.y * 0.9);
}`;
const moteFrag = /* glsl */`
uniform vec3 uColor; uniform float uOpacity; varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  gl_FragColor = vec4(uColor, uOpacity * vA * (1.0 - smoothstep(0.2, 1.0, d)));
  #include <colorspace_fragment>
}`;

const DROPS = 520;
const MOTES = 140;
const tc = new THREE.Color();

export class Sky {
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  readonly sun = new THREE.DirectionalLight(0xffffff, 1);
  /** Lampe du porteur, allumée la nuit. Toujours présente pour ne pas recompiler les matériaux. */
  readonly lamp = new THREE.PointLight(0xffc27a, 0, 60, 1.2);
  private readonly haze: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly rain: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly motes: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private raining = false;
  private readonly sunDir = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene) {
    for (const l of [this.hemi, this.sun, this.lamp]) l.layers.enableAll();
    scene.add(this.hemi, this.sun, this.sun.target, this.lamp);

    // Voile plein écran : estompe le lointain (haut de l'écran) et assombrit les bords la nuit.
    this.haze = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: quadVert, fragmentShader: quadFrag, transparent: true, depthTest: false, depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uVig: { value: new THREE.Color() }, uTop: { value: 0 }, uStart: { value: 0.5 }, uAll: { value: 0 }, uVignette: { value: 0 } },
    }));
    this.haze.frustumCulled = false; this.haze.renderOrder = 900; this.haze.layers.set(WORLD);
    scene.add(this.haze);

    // Pluie : segments dont la chute est calculée dans le shader (aucun calcul par image côté JS).
    const seed = new Float32Array(DROPS * 6), tip = new Float32Array(DROPS * 2);
    for (let i = 0; i < DROPS; i++) {
      const a = Math.random(), b = Math.random(), c = Math.random();
      seed.set([a, b, c, a, b, c], i * 6);
      tip[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DROPS * 6), 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
    g.setAttribute('tip', new THREE.BufferAttribute(tip, 1));
    this.rain = new THREE.LineSegments(g, new THREE.ShaderMaterial({
      vertexShader: rainVert, fragmentShader: rainFrag, transparent: true, depthTest: false, depthWrite: false,
      uniforms: {
        uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(150, 70, 150) },
        uFall: { value: new THREE.Vector3(0, -1, 0) }, uLen: { value: 3 }, uColor: { value: new THREE.Color() }, uOpacity: { value: 0.4 },
      },
    }));
    this.rain.frustumCulled = false; this.rain.renderOrder = 950; this.rain.layers.set(TOP); this.rain.visible = false;
    scene.add(this.rain);

    // Poussières d'ambiance : quelques points lumineux qui dérivent autour du porteur.
    const ms = new Float32Array(MOTES * 3);
    for (let i = 0; i < ms.length; i++) ms[i] = Math.random();
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
    mg.setAttribute('seed', new THREE.BufferAttribute(ms, 3));
    this.motes = new THREE.Points(mg, new THREE.ShaderMaterial({
      vertexShader: moteVert, fragmentShader: moteFrag, transparent: true, depthWrite: false,
      uniforms: {
        uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(120, 30, 120) },
        uSize: { value: 5 * Math.min(window.devicePixelRatio || 1, 2) }, uColor: { value: new THREE.Color() }, uOpacity: { value: 0.5 },
      },
    }));
    this.motes.frustumCulled = false; this.motes.renderOrder = 890; this.motes.layers.set(WORLD);
    scene.add(this.motes);
  }

  get animated(): boolean { return this.raining; }

  apply(env: Env, w: Weather | null, pal: Palette): void {
    const n = env.night, clair = env.ambiance === 'clair';
    // Soleil jamais sous 9° pour l'éclairage : à l'heure dorée il rase, la nuit il fait office de lune.
    const alt = Math.max(9, w ? w.sunAltDeg : 35) * Math.PI / 180;
    // Soleil au sud-ouest : la lumière vient de la gauche de l'écran, vers la caméra.
    this.sunDir.set(-Math.cos(alt) * 0.75, Math.sin(alt) + 0.25, Math.cos(alt) * 0.65).multiplyScalar(100);
    const low = w ? smooth(25, 5, w.sunAltDeg) : 0;
    const cover = 1 - env.dull * 0.55;
    const u = this.haze.material.uniforms;
    const g = env.gold, L = THREE.MathUtils.lerp;
    // Jour : ciel clair, soleil franc, ombres douces (beaucoup de lumière d'ambiance). « crépuscule » = même jour,
    // un peu plus chaud et contrasté. Heure dorée : soleil orange et rasant. Nuit : bleu sombre, lune froide.
    this.hemi.color.set(clair ? 0xeaf4ff : 0xf2f1e6).lerp(tc.set(0xffdcb4), g).lerp(tc.set(clair ? 0x3b4f7a : 0x35507a), n);
    this.hemi.groundColor.set(clair ? 0xc9b79a : 0xbfa57e).lerp(tc.set(0xa67c58), g).lerp(tc.set(clair ? 0x1a2233 : 0x141c26), n);
    this.hemi.intensity = L(L(clair ? 1.9 : 1.75, 1.5, g), 1.2, n);
    this.sun.color.set(clair ? 0xfff4e0 : 0xffecc8).lerp(tc.set(0xffb36b), low * 0.6).lerp(tc.set(0xff9a4a), g * 0.8).lerp(tc.set(0x8fa8ff), n);
    this.sun.intensity = L(L((clair ? 2.6 : 2.9) * cover, 3.0 * cover, g), 0.55, n);
    u.uTop.value = 0.6 + env.fog * 0.35; u.uStart.value = 0.58 - env.fog * 0.3;
    u.uAll.value = env.fog * 0.15;
    // Bords assombris : jamais de jour, à peine à l'heure dorée, franchement la nuit.
    u.uVignette.value = g * (1 - n) * 0.1 + n * (clair ? 0.4 : 0.46);
    // Le voile prend la teinte de l'air de la palette ; par temps bouché il perd sa lueur d'horizon.
    const air = (u.uColor.value as THREE.Color).set(pal.haze);
    (u.uHorizon.value as THREE.Color).set(pal.horizon).lerp(air, Math.max(env.dull, n * 0.3));
    (u.uVig.value as THREE.Color).set(pal.sky).multiplyScalar(0.28);
    this.lamp.intensity = n > 0.3 ? 45 * n : 0;
    const m = this.motes.material.uniforms;
    this.motes.visible = env.rain === 0;
    (m.uColor.value as THREE.Color).set(env.dark ? 0xffd69a : 0xffffff);
    m.uOpacity.value = env.dark ? 0.75 : 0.55;
    this.motes.material.blending = env.dark ? THREE.AdditiveBlending : THREE.NormalBlending;

    this.raining = env.rain > 0;
    this.rain.visible = this.raining;
    if (this.raining) {
      const r = this.rain.material.uniforms, wind = Math.min(env.windKmh, 60) / 60;
      const speed = env.snow ? 7 : 55;
      (r.uFall.value as THREE.Vector3).set(wind * speed * 0.45, -speed, wind * speed * 0.2);
      r.uLen.value = env.snow ? 0.35 : 3.2;
      r.uOpacity.value = (env.snow ? 0.9 : 0.42) * (0.6 + env.rain * 0.4);
      (r.uColor.value as THREE.Color).set(env.dark ? (env.snow ? 0xe8f0f0 : 0xb8d8dc) : (env.snow ? 0xffffff : 0x6f8c98));
    }
  }

  /** À chaque image : la pluie et la lampe suivent le joueur. */
  update(timeS: number, focus: THREE.Vector3): void {
    this.lamp.position.set(focus.x, 14, focus.z + 4);
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).add(this.sunDir);
    if (this.motes.visible) {
      const m = this.motes.material.uniforms;
      m.uTime.value = timeS % 2000;
      (m.uCenter.value as THREE.Vector3).copy(focus);
    }
    if (this.raining) {
      const r = this.rain.material.uniforms;
      r.uTime.value = timeS % 1000;
      (r.uCenter.value as THREE.Vector3).copy(focus);
    }
  }
}
