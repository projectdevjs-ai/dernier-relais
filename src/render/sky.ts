// Ciel et météo : éclairage three.js, voile atmosphérique, pluie et neige.
// Tout dérive de l'ambiance choisie et de view.weather.
import * as THREE from 'three';
import type { Ambiance, Weather } from '../game/api';
import { TOP, WORLD } from './layer';

/** État du ciel calculé, partagé par tous les modules de rendu. */
export interface Env {
  ambiance: Ambiance;
  /** 0 : plein jour, 1 : nuit noire. */
  night: number;
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
  const alt = w ? w.sunAltDeg : 30;
  let night = w ? 1 - smooth(-6, 8, alt) : 0;
  if (w?.night) night = Math.max(night, 0.85);
  night = Math.round(night * 10) / 10;
  const kind = w?.kind ?? 'clair';
  const rain = kind === 'pluie' ? 0.7 : kind === 'orage' ? 1 : kind === 'neige' ? 0.6 : 0;
  const fog = kind === 'brouillard' ? 1 : kind === 'orage' ? 0.35 : kind === 'pluie' || kind === 'neige' ? 0.25 : 0;
  const dull = kind === 'clair' ? 0 : kind === 'nuages' ? 0.35 : kind === 'brouillard' ? 0.8 : 0.6;
  const windKmh = Math.round((w?.windKmh ?? 0) / 10) * 10;
  const low = Math.round(smooth(25, 5, alt) * 4) / 4; // soleil bas : lumière plus chaude
  return {
    ambiance, night, rain, snow: kind === 'neige', fog, dull, windKmh,
    dark: ambiance === 'crépuscule' || night >= 0.5,
    key: `${ambiance}|${night}|${kind}|${windKmh}|${low}`,
  };
}

const quadVert = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const quadFrag = /* glsl */`
uniform vec3 uColor; uniform float uTop; uniform float uStart; uniform float uAll; uniform float uVignette;
varying vec2 vUv;
void main() {
  float far = smoothstep(uStart, 1.0, vUv.y);
  float vig = smoothstep(0.55, 1.15, length((vUv - 0.5) * vec2(1.0, 1.25)) * 1.5);
  float a = clamp(uAll + uTop * far * far + uVignette * vig, 0.0, 1.0);
  gl_FragColor = vec4(uColor, a);
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
void main() { gl_FragColor = vec4(uColor, uOpacity * vA); #include <colorspace_fragment>
}`;

const DROPS = 520;

export class Sky {
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  readonly sun = new THREE.DirectionalLight(0xffffff, 1);
  /** Lampe du porteur, allumée la nuit. Toujours présente pour ne pas recompiler les matériaux. */
  readonly lamp = new THREE.PointLight(0xffc27a, 0, 60, 1.2);
  private readonly haze: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly rain: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private raining = false;
  private readonly sunDir = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene) {
    for (const l of [this.hemi, this.sun, this.lamp]) l.layers.enableAll();
    scene.add(this.hemi, this.sun, this.sun.target, this.lamp);

    // Voile plein écran : estompe le lointain (haut de l'écran) et assombrit les bords la nuit.
    this.haze = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: quadVert, fragmentShader: quadFrag, transparent: true, depthTest: false, depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color() }, uTop: { value: 0 }, uStart: { value: 0.5 }, uAll: { value: 0 }, uVignette: { value: 0 } },
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
  }

  get animated(): boolean { return this.raining; }

  apply(env: Env, w: Weather | null): void {
    const n = env.night, clair = env.ambiance === 'clair';
    const alt = Math.max(8, w ? w.sunAltDeg : 35) * Math.PI / 180;
    // Soleil au sud-ouest : la lumière vient de la gauche de l'écran, vers la caméra.
    this.sunDir.set(-Math.cos(alt) * 0.75, Math.sin(alt) + 0.25, Math.cos(alt) * 0.65).multiplyScalar(100);
    const low = w ? smooth(25, 5, w.sunAltDeg) : 0;
    const cover = 1 - env.dull * 0.55;
    const u = this.haze.material.uniforms;
    if (clair) {
      this.hemi.color.set(0xeaf4ff).lerp(new THREE.Color(0x3b4f7a), n);
      this.hemi.groundColor.set(0xc9b79a).lerp(new THREE.Color(0x1a2233), n);
      this.hemi.intensity = THREE.MathUtils.lerp(1.9, 0.9, n);
      this.sun.color.set(0xfff4e0).lerp(new THREE.Color(0xffb36b), low * 0.7).lerp(new THREE.Color(0x8fa8ff), n);
      this.sun.intensity = THREE.MathUtils.lerp(2.6 * cover, 0.55, n);
      (u.uColor.value as THREE.Color).set(0xe6eef0).lerp(new THREE.Color(0x0b1220), n);
      u.uTop.value = 0.5 + env.fog * 0.45; u.uStart.value = 0.58 - env.fog * 0.3;
      u.uAll.value = env.fog * 0.16; u.uVignette.value = n * 0.45;
    } else {
      // Crépuscule : ambiance froide et sombre, lumière principale ambrée.
      this.hemi.color.set(0x9fc4c0).lerp(new THREE.Color(0x35507a), n);
      this.hemi.groundColor.set(0x33423a).lerp(new THREE.Color(0x141c26), n);
      this.hemi.intensity = THREE.MathUtils.lerp(1.5, 0.85, n);
      this.sun.color.set(0xffc98a).lerp(new THREE.Color(0x86a4ff), n);
      this.sun.intensity = THREE.MathUtils.lerp(2.3 * cover, 0.5, n);
      (u.uColor.value as THREE.Color).set(0x0b1413).lerp(new THREE.Color(0x04080a), n);
      u.uTop.value = 0.62 + env.fog * 0.3; u.uStart.value = 0.55 - env.fog * 0.3;
      u.uAll.value = env.fog * 0.14; u.uVignette.value = 0.3 + n * 0.3;
      if (env.fog > 0.6) (u.uColor.value as THREE.Color).set(0x1c2a2a);
    }
    this.lamp.intensity = n > 0.3 ? 260 * n : 0;

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
    if (this.raining) {
      const r = this.rain.material.uniforms;
      r.uTime.value = timeS % 1000;
      (r.uCenter.value as THREE.Vector3).copy(focus);
    }
  }
}
