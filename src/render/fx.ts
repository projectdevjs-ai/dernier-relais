// Effets lumineux : matériaux et géométries partagés (halos, anneaux, faisceaux),
// onde du scanner, gerbe de réussite, zones dangereuses.
import * as THREE from 'three';
import type { DangerView } from '../game/api';
import type { Layer3D } from './layer';
import { TOP, WORLD } from './layer';
import type { Env } from './sky';

const beamVert = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const beamFrag = /* glsl */`
uniform vec3 uColor; uniform float uOpacity; uniform float uPower;
varying vec2 vUv;
void main() {
  float a = pow(1.0 - vUv.y, uPower) * uOpacity;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;
const dangerFrag = /* glsl */`
uniform vec3 uColor; uniform float uTime; uniform float uBoost;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float waves = step(0.55, fract(r * 5.0 - uTime * 0.25)) * 0.07;
  float edge = smoothstep(0.86, 0.985, r) * 0.55;
  float a = (0.13 + waves + edge) * (1.0 - smoothstep(0.985, 1.0, r)) * uBoost;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;

function radialTexture(stops: [number, string][]): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

type Tone = 'amber' | 'blue' | 'danger' | 'white';
/** Couleurs des effets : vives sur fond sombre (mode additif), plus denses sur fond clair. */
const TONES: Record<Tone, [dark: number, light: number]> = {
  amber: [0xe8a24a, 0xe07a10], blue: [0x7fc7d9, 0x1596c4], danger: [0xff5a3c, 0xd63a22], white: [0xfff1d6, 0xffffff],
};

interface Tinted { mat: THREE.Material; tone: Tone; color: THREE.Color; additive: boolean; setOpacity: (o: number) => void; dark: number; light: number }

/** Boîte à outils des effets : tout ce qui est partagé entre les objets de la scène. */
export class FxKit {
  // Géométries unitaires, à mettre à l'échelle.
  readonly disc = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
  readonly ring = new THREE.RingGeometry(0.86, 1, 64).rotateX(-Math.PI / 2);
  readonly thinRing = new THREE.RingGeometry(0.955, 1, 96).rotateX(-Math.PI / 2);
  readonly quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  readonly beam = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true).translate(0, 0.5, 0);
  readonly cone = new THREE.CylinderGeometry(0.25, 1, 1, 24, 1, true).translate(0, 0.5, 0);
  readonly diamond = new THREE.OctahedronGeometry(1, 0).scale(0.62, 1, 0.62);
  /** Les cinq segments de l'anneau d'étoiles d'un abri. */
  readonly starArcs: THREE.RingGeometry[] = [];

  private readonly glowTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.55)'], [0.6, 'rgba(255,255,255,0.14)'], [1, 'rgba(255,255,255,0)']]);
  private readonly shadowTex = radialTexture([[0, 'rgba(0,0,0,1)'], [0.55, 'rgba(0,0,0,0.75)'], [1, 'rgba(0,0,0,0)']]);
  private readonly tinted: Tinted[] = [];

  readonly shadow = new THREE.MeshBasicMaterial({ map: this.shadowTex, color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false });
  readonly glowAmber = this.glow('amber', 0.4, 0.28);
  readonly glowBlue = this.glow('blue', 0.8, 0.35);
  readonly glowWarm = this.glow('white', 0.5, 0);
  /** Point lumineux des abris allumés, la nuit. */
  readonly glowLamp = this.glow('amber', 0.85, 0);
  readonly ringAmber = this.flat('amber', 0.95, 0.95);
  readonly ringBlue = this.flat('blue', 0.9, 0.9);
  readonly ringOff = new THREE.MeshBasicMaterial({ color: 0x6f7f7a, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
  /** Anneau qui s'élargit en s'effaçant (objets à portée) : son opacité suit `phase`. */
  readonly pulseAmber = this.flat('amber', 0.9, 0.9);
  readonly pulseBlue = this.flat('blue', 0.9, 0.9);
  readonly solidAmber = new THREE.MeshBasicMaterial({ color: 0xe8a24a });
  readonly solidBlue = new THREE.MeshBasicMaterial({ color: 0x7fc7d9 });
  readonly pipOff = new THREE.MeshBasicMaterial({ color: 0x4a5a56, transparent: true, opacity: 0.55, depthWrite: false });
  readonly beamAmber = this.beamMat('amber', 0.75, 0.5, 1.6);
  readonly beamBlue = this.beamMat('blue', 0.55, 0.42, 1.3);
  readonly wallDanger = this.beamMat('danger', 0.5, 0.42, 1.8);
  readonly discDanger: THREE.ShaderMaterial;

  /** Phase commune des pulsations, de 0 à 1. */
  phase = 0;
  private dark = true;

  constructor() {
    for (let i = 0; i < 5; i++) {
      const gap = 0.09, len = (Math.PI * 2) / 5 - gap;
      // Premier segment en haut de l'écran (nord), puis dans le sens horaire.
      this.starArcs.push(new THREE.RingGeometry(0.91, 1, 24, 1, Math.PI / 2 - (i + 1) * (len + gap) + gap / 2, len).rotateX(-Math.PI / 2));
    }
    this.discDanger = new THREE.ShaderMaterial({
      vertexShader: beamVert, fragmentShader: dangerFrag, transparent: true, depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color() }, uTime: { value: 0 }, uBoost: { value: 1 } },
    });
    const c = this.discDanger.uniforms.uColor.value as THREE.Color;
    this.tinted.push({ mat: this.discDanger, tone: 'danger', color: c, additive: false, setOpacity: o => { this.discDanger.uniforms.uBoost.value = o; }, dark: 1.15, light: 1.5 });
  }

  private glow(tone: Tone, dark: number, light: number): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({ map: this.glowTex, transparent: true, depthWrite: false });
    this.tinted.push({ mat: m, tone, color: m.color, additive: true, setOpacity: o => { m.opacity = o; m.visible = o > 0.01; }, dark, light });
    return m;
  }
  private flat(tone: Tone, dark: number, light: number): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.tinted.push({ mat: m, tone, color: m.color, additive: true, setOpacity: o => { m.opacity = o; }, dark, light });
    return m;
  }
  private beamMat(tone: Tone, dark: number, light: number, power: number): THREE.ShaderMaterial {
    const m = new THREE.ShaderMaterial({
      vertexShader: beamVert, fragmentShader: beamFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 1 }, uPower: { value: power } },
    });
    this.tinted.push({ mat: m, tone, color: m.uniforms.uColor.value as THREE.Color, additive: true, setOpacity: o => { m.uniforms.uOpacity.value = o; }, dark, light });
    return m;
  }

  /** Adapte couleurs et mode de fusion au fond (sombre ou clair). */
  applyEnv(env: Env): void {
    this.dark = env.dark;
    for (const t of this.tinted) {
      t.color.set(TONES[t.tone][env.dark ? 0 : 1]);
      t.setOpacity(env.dark ? t.dark : t.light);
      t.mat.blending = t.additive && env.dark ? THREE.AdditiveBlending : THREE.NormalBlending;
    }
    this.solidAmber.color.set(env.dark ? 0xffb85c : 0xf08a1a);
    this.solidBlue.color.set(env.dark ? 0x9fe2f2 : 0x19a3d1);
    this.ringOff.color.set(env.dark ? 0x6f7f7a : 0x8a8676);
    this.shadow.opacity = env.dark ? 0.5 : 0.3;
  }

  update(timeS: number): void {
    this.phase = (timeS * 0.7) % 1;
    const fade = (1 - this.phase) * (1 - this.phase) * 0.9;
    this.pulseAmber.opacity = fade;
    this.pulseBlue.opacity = fade;
    this.discDanger.uniforms.uTime.value = timeS % 400;
  }

  /** Matériau d'effet indépendant (opacité animée objet par objet). */
  ownFlat(tone: Tone): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    m.color.set(TONES[tone][this.dark ? 0 : 1]);
    m.blending = this.dark ? THREE.AdditiveBlending : THREE.NormalBlending;
    return m;
  }
  get isDark(): boolean { return this.dark; }
}

/** Onde du scanner : trois anneaux qui s'étendent au sol depuis le joueur. */
export class ScanPulse {
  private readonly group = new THREE.Group();
  private readonly rings: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly fill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private t = -1; private range = 0;
  private static readonly DURATION = 1.9;

  constructor(scene: THREE.Scene, private readonly kit: FxKit) {
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(kit.thinRing, kit.ownFlat('amber'));
      m.renderOrder = 20; this.rings.push(m); this.group.add(m);
    }
    this.fill = new THREE.Mesh(kit.disc, kit.ownFlat('amber'));
    this.fill.renderOrder = 19; this.group.add(this.fill);
    this.group.visible = false; this.group.position.y = 0.35;
    scene.add(this.group);
  }
  get active(): boolean { return this.t >= 0; }

  start(at: THREE.Vector3, rangeM: number): void {
    this.t = 0; this.range = rangeM;
    this.group.position.set(at.x, 0.35, at.z);
    this.group.visible = true;
    const add = this.kit.isDark;
    for (const m of [...this.rings, this.fill]) {
      m.material.color.set(add ? 0xe8a24a : 0xe07a10);
      m.material.blending = add ? THREE.AdditiveBlending : THREE.NormalBlending;
    }
  }

  update(dt: number): void {
    if (this.t < 0) return;
    this.t += dt;
    const k = this.t / ScanPulse.DURATION;
    if (k >= 1.25) { this.t = -1; this.group.visible = false; return; }
    for (let i = 0; i < 3; i++) {
      const p = Math.min(1, Math.max(0, k - i * 0.12));
      const e = 1 - (1 - p) ** 3;
      const r = Math.max(0.01, e * this.range);
      this.rings[i].scale.set(r, 1, r);
      this.rings[i].material.opacity = (i === 0 ? 0.9 : 0.5) * (1 - p) ** 0.8;
      this.rings[i].visible = p > 0;
    }
    const p = Math.min(1, k), r = Math.max(0.01, (1 - (1 - p) ** 3) * this.range);
    this.fill.scale.set(r, 1, r);
    this.fill.material.opacity = 0.1 * (1 - p);
  }
}

const SPARKS = 48;

/** Gerbe de lumière sur un abri (livraison, étoile gagnée). */
export class Celebration {
  private readonly group = new THREE.Group();
  private readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly column: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly pos = new Float32Array(SPARKS * 3);
  private readonly vel = new Float32Array(SPARKS * 3);
  private t = -1; private h = 30;
  private static readonly DURATION = 2.2;

  constructor(scene: THREE.Scene, private readonly kit: FxKit, pixelRatio: number) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffc46b, size: 5 * pixelRatio, sizeAttenuation: false, transparent: true, depthWrite: false, depthTest: false }));
    this.points.frustumCulled = false;
    this.column = new THREE.Mesh(kit.beam, kit.beamAmber.clone());
    this.ring = new THREE.Mesh(kit.ring, kit.ownFlat('amber'));
    this.ring.position.y = 0.5;
    this.group.add(this.points, this.column, this.ring);
    this.group.traverse(o => o.layers.set(TOP));
    this.group.visible = false;
    scene.add(this.group);
  }
  get active(): boolean { return this.t >= 0; }

  start(at: THREE.Vector3, height: number): void {
    this.t = 0; this.h = height;
    this.group.position.set(at.x, 0, at.z);
    this.group.visible = true;
    const dark = this.kit.isDark;
    for (let i = 0; i < SPARKS; i++) {
      const a = Math.random() * Math.PI * 2, s = 5 + Math.random() * 13;
      this.pos[i * 3] = 0; this.pos[i * 3 + 1] = height * (0.5 + Math.random() * 0.5); this.pos[i * 3 + 2] = 0;
      this.vel[i * 3] = Math.cos(a) * s; this.vel[i * 3 + 1] = 12 + Math.random() * 22; this.vel[i * 3 + 2] = Math.sin(a) * s;
    }
    this.points.material.color.set(dark ? 0xffc46b : 0xf08a1a);
    this.points.material.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
    const cm = this.column.material, src = this.kit.beamAmber;
    (cm.uniforms.uColor.value as THREE.Color).copy(src.uniforms.uColor.value as THREE.Color);
    cm.blending = src.blending;
    this.ring.material.color.set(dark ? 0xe8a24a : 0xe07a10);
    this.ring.material.blending = cm.blending;
  }

  update(dt: number): void {
    if (this.t < 0) return;
    this.t += dt;
    const k = this.t / Celebration.DURATION;
    if (k >= 1) { this.t = -1; this.group.visible = false; return; }
    for (let i = 0; i < SPARKS; i++) {
      this.vel[i * 3 + 1] -= 24 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] = Math.max(0.5, this.pos[i * 3 + 1] + this.vel[i * 3 + 1] * dt);
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.material.opacity = 1 - k * k;
    const w = 7 * (1 - k) + 1.5;
    this.column.scale.set(w, this.h * 3.2, w);
    this.column.material.uniforms.uOpacity.value = (1 - k) * 1.1;
    const r = 8 + (1 - (1 - k) ** 3) * this.h * 1.3;
    this.ring.scale.set(r, 1, r);
    this.ring.material.opacity = 0.9 * (1 - k);
  }
}

interface DangerItem { group: THREE.Group; r: number; at: [number, number] }

/** Zones dangereuses : disque translucide au sol, bord net, paroi basse qui s'estompe. */
export class Dangers {
  private readonly items = new Map<string, DangerItem>();
  private readonly seen = new Set<string>();
  private anyInside = false;
  constructor(private readonly scene: THREE.Scene, private readonly kit: FxKit, private readonly layer: Layer3D) {}

  get count(): number { return this.items.size; }

  sync(list: DangerView[]): void {
    this.seen.clear();
    this.anyInside = false;
    for (const d of list) {
      this.seen.add(d.id);
      if (d.inside) this.anyInside = true;
      let it = this.items.get(d.id);
      if (!it || it.r !== d.radiusM) {
        if (it) it.group.removeFromParent();
        const group = new THREE.Group();
        const disc = new THREE.Mesh(this.kit.disc, this.kit.discDanger);
        disc.scale.set(d.radiusM, 1, d.radiusM); disc.position.y = 0.25; disc.renderOrder = 5;
        const wall = new THREE.Mesh(this.kit.beam, this.kit.wallDanger);
        wall.scale.set(d.radiusM * 0.985, 16, d.radiusM * 0.985); wall.renderOrder = 6;
        group.add(disc, wall);
        group.traverse(o => o.layers.set(WORLD));
        this.scene.add(group);
        it = { group, r: d.radiusM, at: [d.at[0], d.at[1]] };
        this.items.set(d.id, it);
      }
      it.at[0] = d.at[0]; it.at[1] = d.at[1];
      this.layer.toLocal(d.at, it.group.position);
    }
    for (const [id, it] of this.items) if (!this.seen.has(id)) { it.group.removeFromParent(); this.items.delete(id); }
  }

  /** Le joueur est dans une zone : elle bat plus fort. */
  update(timeS: number): void {
    if (!this.items.size) return;
    const base = this.kit.isDark ? 1.15 : 1.5;
    this.kit.discDanger.uniforms.uBoost.value = this.anyInside ? base * (1.25 + 0.35 * Math.sin(timeS * 5)) : base;
  }

  reposition(): void { for (const it of this.items.values()) this.layer.toLocal(it.at, it.group.position); }
}
