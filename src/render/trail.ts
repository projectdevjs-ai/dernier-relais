// Fil d'Ariane : un ruban de chevrons lumineux posé au sol, du porteur à sa cible.
// Bleu vers la destination d'un colis porté, ambre vers un colis à ramasser.
// Les tampons sont alloués une fois ; le ruban est retaillé sur place quand le porteur avance.
import * as THREE from 'three';
import type { LngLat } from '../core/geo';
import { type Layer3D, WORLD } from './layer';

const MAX = 240;
const HALF_W = 1.25;
const vert = /* glsl */`
attribute float along; attribute float side;
varying float vAlong; varying float vSide;
void main() { vAlong = along; vSide = side; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const frag = /* glsl */`
uniform vec3 uColor; uniform float uOpacity; uniform float uTime; uniform float uTotal;
varying float vAlong; varying float vSide;
void main() {
  // Chevrons pointés vers la cible, qui avancent ; un filet continu très léger relie le tout.
  float s = abs(vSide);
  float x = fract((uTotal - vAlong - s * 1.5) / 6.5 + uTime * 0.55);
  float dash = smoothstep(0.0, 0.08, x) * (1.0 - smoothstep(0.5, 0.58, x));
  float across = 1.0 - smoothstep(0.55, 1.0, s);
  float core = (1.0 - smoothstep(0.0, 0.35, s)) * 0.22;
  float ends = smoothstep(6.0, 12.0, vAlong) * smoothstep(2.0, 9.0, uTotal - vAlong);
  float far = 1.0 - 0.55 * smoothstep(120.0, 420.0, vAlong);
  gl_FragColor = vec4(uColor, uOpacity * ends * far * max(dash * across, core));
  #include <colorspace_fragment>
}`;

export type TrailTone = 'blue' | 'amber';

export class Trail {
  private readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly pos = new Float32Array((MAX + 2) * 2 * 3);
  private readonly along = new Float32Array((MAX + 2) * 2);
  /** Tracé dans le repère local (x, z), puis le chemin réellement dessiné (porteur compris). */
  private readonly rx = new Float32Array(MAX); private readonly rz = new Float32Array(MAX);
  private readonly wx = new Float32Array(MAX + 2); private readonly wz = new Float32Array(MAX + 2);
  private n = 0;
  private src: LngLat[] | null = null;
  private readonly to: LngLat = [0, 0];
  private active = false;
  private dirty = true;
  private lastX = 0; private lastZ = 0;
  private tone: TrailTone = 'blue';
  private shown = 0;
  private readonly v = new THREE.Vector3();

  constructor(scene: THREE.Scene, private readonly layer: Layer3D) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('along', new THREE.BufferAttribute(this.along, 1).setUsage(THREE.DynamicDrawUsage));
    const side = new Float32Array((MAX + 2) * 2), index = new Uint16Array((MAX + 1) * 6);
    for (let i = 0; i < MAX + 2; i++) { side[i * 2] = -1; side[i * 2 + 1] = 1; }
    for (let i = 0; i < MAX + 1; i++) index.set([i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2], i * 6);
    g.setAttribute('side', new THREE.BufferAttribute(side, 1));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 0 }, uTime: { value: 0 }, uTotal: { value: 1 } },
    }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 12; this.mesh.layers.set(WORLD); this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Nouvelle cible. `pts` : tracé par les rues, ou null pour aller tout droit. */
  set(pts: LngLat[] | null, to: LngLat, tone: TrailTone): void {
    if (this.active && pts === this.src && to[0] === this.to[0] && to[1] === this.to[1] && tone === this.tone) return;
    this.src = pts; this.to[0] = to[0]; this.to[1] = to[1]; this.tone = tone; this.active = true;
    this.reposition();
  }
  clear(): void { this.active = false; }

  /** Recalcule le tracé local (nouvelle cible, ou changement d'ancre du repère). */
  reposition(): void {
    const pts = this.src;
    let n = 0;
    if (pts && pts.length > 1) {
      const step = Math.ceil(pts.length / (MAX - 1));
      for (let i = 0; i < pts.length; i += step) { this.layer.toLocal(pts[i], this.v); this.rx[n] = this.v.x; this.rz[n] = this.v.z; n++; }
      if ((pts.length - 1) % step) { this.layer.toLocal(pts[pts.length - 1], this.v); this.rx[n] = this.v.x; this.rz[n] = this.v.z; n++; }
    }
    // Le tracé du réseau s'arrête sur la rue : on finit toujours exactement sur la cible.
    this.layer.toLocal(this.to, this.v);
    if (n === 0 || Math.hypot(this.rx[n - 1] - this.v.x, this.rz[n - 1] - this.v.z) > 3) { this.rx[n] = this.v.x; this.rz[n] = this.v.z; n++; }
    this.n = n;
    this.dirty = true;
  }

  /** À chaque image : fondu, défilement, et retaille du ruban si le porteur a avancé. */
  update(dt: number, timeS: number, p: THREE.Vector3, visible: boolean, dark: boolean): void {
    const want = this.active && visible ? 1 : 0;
    this.shown += (want - this.shown) * (1 - Math.exp(-dt * 4));
    if (this.shown < 0.01 && !want) { this.mesh.visible = false; return; }
    const u = this.mesh.material.uniforms;
    if (this.active && (this.dirty || (p.x - this.lastX) ** 2 + (p.z - this.lastZ) ** 2 > 0.16)) this.rebuild(p);
    this.mesh.visible = true;
    u.uTime.value = timeS % 1000;
    u.uOpacity.value = this.shown * (dark ? 0.95 : 0.9);
    (u.uColor.value as THREE.Color).set(this.tone === 'blue' ? (dark ? 0x8fdcf2 : 0x1596c4) : (dark ? 0xffb85c : 0xe07a10));
    const blend = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
    if (this.mesh.material.blending !== blend) { this.mesh.material.blending = blend; this.mesh.material.needsUpdate = true; }
  }

  private rebuild(p: THREE.Vector3): void {
    this.dirty = false; this.lastX = p.x; this.lastZ = p.z;
    const { rx, rz, wx, wz, n } = this;
    // Point du tracé le plus proche du porteur : tout ce qui est derrière lui est déjà parcouru.
    let bi = 0, bt = 0, bd = Infinity;
    for (let i = 0; i + 1 < n; i++) {
      const dx = rx[i + 1] - rx[i], dz = rz[i + 1] - rz[i], len = dx * dx + dz * dz;
      const t = len > 0 ? Math.min(1, Math.max(0, ((p.x - rx[i]) * dx + (p.z - rz[i]) * dz) / len)) : 0;
      const d = (rx[i] + dx * t - p.x) ** 2 + (rz[i] + dz * t - p.z) ** 2;
      if (d < bd) { bd = d; bi = i; bt = t; }
    }
    let m = 0;
    wx[m] = p.x; wz[m] = p.z; m++;
    if (n > 1) {
      if (bd > 9 && bt < 1) { wx[m] = rx[bi] + (rx[bi + 1] - rx[bi]) * bt; wz[m] = rz[bi] + (rz[bi + 1] - rz[bi]) * bt; m++; }
      for (let i = bi + 1; i < n; i++) { wx[m] = rx[i]; wz[m] = rz[i]; m++; }
    } else if (n === 1) { wx[m] = rx[0]; wz[m] = rz[0]; m++; }
    // Ruban : deux sommets par point, écartés le long de la normale au chemin.
    let d = 0;
    for (let k = 0; k < m; k++) {
      const a = Math.max(0, k - 1), b = Math.min(m - 1, k + 1);
      let tx = wx[b] - wx[a], tz = wz[b] - wz[a];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      if (k > 0) d += Math.hypot(wx[k] - wx[k - 1], wz[k] - wz[k - 1]);
      const o = k * 6;
      this.pos[o] = wx[k] - tz * HALF_W; this.pos[o + 1] = 0.27; this.pos[o + 2] = wz[k] + tx * HALF_W;
      this.pos[o + 3] = wx[k] + tz * HALF_W; this.pos[o + 4] = 0.27; this.pos[o + 5] = wz[k] - tx * HALF_W;
      this.along[k * 2] = d; this.along[k * 2 + 1] = d;
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.along.needsUpdate = true;
    g.setDrawRange(0, Math.max(0, m - 1) * 6);
    this.mesh.material.uniforms.uTotal.value = d;
  }
}
