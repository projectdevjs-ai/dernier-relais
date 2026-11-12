// La séquence de ramassage, en plein écran, reprise de l'ancien jeu :
//   1. REPÉRAGE   la caisse est quelque part autour du joueur, dans l'image de la caméra (ou un panorama 360°) ;
//                 il tourne sur lui-même (boussole) ou glisse le doigt pour la trouver et la garder dans le viseur ;
//   2. INSPECTION on tourne la caisse du doigt : défauts à colmater, étiquette suspecte, contenu à écouter ;
//   3. SANGLAGE   on relie les boucles l'une après l'autre en suivant le passage, puis vient le geste propre à la matière :
//                 cliquet à tendre (bois, coffre), attaches aimantées (malle alu, cryo), nœud (sac), câbles (cellule).
// Rien ne bloque : sans caméra, le panorama ; sans boussole, le doigt ; sans WebGL, la caisse est dessinée à plat.
import * as THREE from 'three';
import type { CrateKind, SpecialKind, UiKind } from '../game/api';
import { type StrapGesture, crateDef, gestureFor } from '../game/crates';
import { FINAL, RATCHET_CENTER, STRAP, type StrapPlan, cablePlan, cablePlug, knotCheckpoint, knotPath, ratchetRelease, strapPlan } from '../game/gestures';
import { rng } from '../core/geo';
import { loadModel } from '../render/assets';
import { btn, h, reducedMotion, setText } from '../ui/dom';
import { icon } from '../ui/icons';
import { type Buckle, type Crate, type Face, type StrapPath, blobShadow, disposeGroup, faceOf, makeBuckle, makeCrate, ribbon, strapMaterials, strapPath } from './crate';
import { Sensors, angDiff } from './sensors';
import { type PanoName, type ScreenPt, View3D, panoFor } from './view3d';

export type Phase = 'reperage' | 'inspection' | 'sanglage';
export type MsgTone = '' | 'good' | 'bad' | 'gold';

export interface SeqParcel {
  id: string; name: string; crate: CrateKind; weightKg: number; fragile: boolean;
  special?: SpecialKind | null;
  /** Libellé de la caisse : « Caisse en bois »… */
  crateLabel: string;
  /** Le colis a un délai de livraison. */
  timed: boolean;
  /** Contenu déjà écouté avant la séquence. */
  inspected: boolean;
  /** Ce qu'on sait déjà du contenu (affiché si le colis a été écouté avant). */
  known: string;
  /** Une étiquette suspecte est à trouver sur le dessus. */
  labelHidden: boolean;
  /** Cap réel du joueur vers le colis, en degrés ; null s'il est tout près. */
  bearingDeg: number | null;
  destName: string;
}
/** Ce que la séquence demande au reste du jeu. */
export interface SeqHost {
  /** Le joueur écoute le colis : renvoie ce qu'il entend. */
  listen(): { text: string; tone: MsgTone; cat?: boolean };
  /** L'étiquette suspecte a été trouvée. */
  foundLabel(): void;
  ui(kind: UiKind): void;
  buzz(pattern: number | number[]): void;
  /** Conditions du moment : pluie ou neige, nuit, fatigue. */
  conditions(): { wet: boolean; night: boolean; tired: boolean; exhausted: boolean };
}
export interface SeqOptions {
  start?: Phase;
  /** Force le panorama (sans demander la caméra). */
  pano?: PanoName;
  /** Rendu allégé. */
  light?: boolean;
  /** Sans WebGL (caisse dessinée à plat). */
  flat?: boolean;
  /** Démo : fige l'image après ce délai, en ms. */
  freezeMs?: number;
  /** Démo : état d'avancement à montrer (colis dans le viseur, boucles déjà reliées, cliquet). */
  demo?: { aim?: boolean; reached?: number; ratchet?: boolean; defects?: number; label?: boolean; listen?: boolean;
    /** Geste final à montrer : celui de la matière (`true`) ou un geste imposé ; `step` : avancement (attaches posées, câbles branchés, part du nœud). */
    final?: boolean | StrapGesture; step?: number };
}
export type SeqResult =
  | { outcome: 'strapped'; /** état du colis à la fin du sanglage, 0 à 100 */ state: number }
  | { outcome: 'quit'; phase: Phase; /** vrai si le sanglage était commencé */ strapping: boolean }
  | { outcome: 'failed'; why: string };

const D2R = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const LOCK_S = 1.1, SCAN_R = 3.2;
const STEPS: { id: Phase | 'rangement'; label: string }[] = [
  { id: 'reperage', label: 'Repérer' }, { id: 'inspection', label: 'Inspecter' }, { id: 'sanglage', label: 'Sangler' }, { id: 'rangement', label: 'Ranger' },
];

interface Pt { x: number; y: number }
interface Mark { mesh: THREE.Mesh; v: THREE.Vector3; n: THREE.Vector3; kind: 'Fissure' | 'Fuite'; fixed: boolean; vis: boolean; s: ScreenPt | null }
interface Node { v: THREE.Vector3; f: Face }

interface ScanState { phase: 'reperage'; crate: Crate; group: THREE.Group; target: number | null; manualYaw: number; manualPitch: number; lockT: number; drag: { x: number; y: number; yaw: number; pitch: number } | null }
interface InspectState {
  phase: 'inspection'; crate: Crate; pivot: THREE.Group; marks: Mark[]; tag: THREE.Mesh | null; tagFound: boolean; tagVis: boolean; tagS: ScreenPt | null;
  yaw: number; pitch: number; drag: { x: number; y: number; yaw: number; pitch: number; moved: number } | null; heard: boolean;
}
interface StrapState {
  phase: 'sanglage'; crate: Crate; pivot: THREE.Group; nodes: Node[]; buckles: Buckle[]; straps: THREE.Group; live: THREE.Group | null; livePath: StrapPath | null; donePaths: StrapPath[];
  rw: number; plan: StrapPlan; corr: number; lag: number; jitter: number; guide: ScreenPt[] | null; A: ScreenPt[];
  reached: number; drag: boolean; finger: Pt | null; tip: Pt | null; f0: Pt; a0: Pt; real: Pt | null; lock: number; lastMove: (Pt & { t: number }) | null; lastHarsh: number; spd: number;
  integrity: number; limit: number; start: number; done: boolean; shake: number; ph: number;
  mode: 'path' | 'ratchet' | 'magnet' | 'knot' | 'cables'; rt: { v: number; hold: boolean; zone: number; c: number; last: number };
  gesture: StrapGesture; wet: boolean;
  /** Attaches aimantées : repères sur la malle, attaches à glisser. */
  mg: { t: { v: THREE.Vector3; done: boolean; i: number; s: ScreenPt | null }[]; c: MagChip[]; drag: MagChip | null; marks: THREE.Mesh[] } | null;
  /** Nœud : tracé à suivre, point atteint, tolérance. */
  kn: { pts: Pt[]; i: number; tol: number; on: boolean } | null;
  /** Câbles : ordre demandé, fiches à gauche, prises à droite. */
  cb: { order: number[]; step: number; plugs: Plug[]; socks: Sock[]; drag: { pl: Plug; x: number; y: number } | null } | null;
}
interface MagChip { i: number; hx: number; hy: number; x: number; y: number; placed: boolean }
interface Sock { c: number; x: number; y: number }
interface Plug { c: number; x: number; y: number; done: boolean; to: Sock | null }
const CABLES: [string, string][] = [['#e0644f', 'rouge'], ['#f2d16b', 'jaune'], ['#7fc7d9', 'bleu']];
const KICK: Record<Exclude<StrapGesture, 'sangles'>, string> = {
  cliquet: 'Cliquet · tension juste', aimants: 'Attaches aimantées · la malle bouge', noeud: 'Nœud de portage · suis la corde', cables: 'Cellule énergie · branchement dans l’ordre',
};
type State = ScanState | InspectState | StrapState;

export class PickupSequence {
  readonly el: HTMLElement;
  private video = h('video', 'pk-cam');
  private c3 = h('canvas', 'pk-3d');
  private c2 = h('canvas', 'pk-2d');
  private kick = h('div', 'pk-kick');
  private name = h('h2', 'pk-name');
  private int = h('p', 'pk-int');
  private time = h('div', 'pk-time');
  private msg = h('p', 'pk-msg');
  private note = h('p', 'pk-note');
  private steps = h('ol', 'pk-steps');
  private bar: HTMLElement;
  private listenBtn: HTMLButtonElement; private listenTxt = h('span', '');
  private goBtn: HTMLButtonElement;
  private quitBtn: HTMLButtonElement;

  private view: View3D | null = null;
  private sensors = new Sensors();
  private stream: MediaStream | null = null;
  private st: State | null = null;
  private p: SeqParcel | null = null;
  private host: SeqHost | null = null;
  private opts: SeqOptions = {};
  private done: ((r: SeqResult) => void) | null = null;
  private raf = 0; private last = 0; private frozen = false; private t0 = 0;
  private W = 1; private H = 1; private dpr = 1;
  private reduce = false;
  private ink = { ink: '#f3efe2', halo: 'rgba(8,14,13,.6)', ok: '#9ccf7a', warn: '#e8a24a', bad: '#e0644f', gold: '#f2d16b', blue: '#7fc7d9', dark: '#14201f' };
  private mats = strapMaterials();
  private msgText = ''; private msgTone: MsgTone = '';
  private timers: ReturnType<typeof setTimeout>[] = [];
  private night = false;
  private defectsLeft = 0;
  private onResize = (): void => this.size();

  constructor(parent: HTMLElement) {
    this.video.autoplay = true; this.video.muted = true; this.video.playsInline = true;
    this.video.setAttribute('aria-hidden', 'true');
    this.listenBtn = btn('pk-chip pk-listen', null, icon('ear'), this.listenTxt);
    this.goBtn = btn('pk-chip pk-go', null, h('span', '', 'Sangler'), icon('arrow'));
    this.bar = h('div', 'pk-bar', this.listenBtn, this.goBtn);
    this.quitBtn = btn('pk-chip pk-quit', 'Abandonner le ramassage', icon('close'), h('span', '', 'Abandonner'));
    for (const s of STEPS) this.steps.append(h('li', 'pk-step', h('i', ''), h('span', '', s.label)));
    this.steps.setAttribute('aria-hidden', 'true');
    this.msg.setAttribute('role', 'status'); this.msg.setAttribute('aria-live', 'polite');
    this.el = h('div', 'pk-layer', this.video, this.c3, this.c2,
      h('div', 'pk-hud', h('div', 'pk-hud-row', h('div', 'pk-hud-txt', this.kick, this.name, this.int), this.time), this.steps),
      this.note, this.bar, this.quitBtn, this.msg);
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-label', 'Ramassage du colis');
    this.el.tabIndex = -1;
    parent.append(this.el);

    this.quitBtn.addEventListener('click', () => this.quit());
    this.listenBtn.addEventListener('click', () => this.listen());
    this.goBtn.addEventListener('click', () => this.insGo());
    this.el.addEventListener('keydown', e => { if (e.key === 'Escape') this.quit(); });
    this.c2.addEventListener('pointerdown', e => this.down(e));
    this.c2.addEventListener('pointermove', e => this.move(e));
    this.c2.addEventListener('pointerup', e => this.up(e, true));
    this.c2.addEventListener('pointercancel', e => this.up(e, false));
  }

  get isOpen(): boolean { return !this.el.hidden; }

  /** Ouvre la séquence. À appeler pendant un toucher du joueur (permissions de la caméra et des capteurs). */
  run(p: SeqParcel, host: SeqHost, opts: SeqOptions = {}): Promise<SeqResult> {
    if (this.done) this.finish({ outcome: 'quit', phase: this.st?.phase ?? 'reperage', strapping: false });
    this.p = p; this.host = host; this.opts = opts;
    this.reduce = reducedMotion();
    this.frozen = false;
    this.el.hidden = false;
    this.readInk();
    this.sensors.start();
    // Un canevas neuf à chaque ouverture : le contexte WebGL du précédent a été rendu au téléphone à la fermeture.
    const fresh = h('canvas', 'pk-3d');
    this.c3.replaceWith(fresh);
    this.c3 = fresh;
    this.view = new View3D(this.c3, opts.light === true, opts.flat === true);
    this.view.onLoad = () => { if (this.frozen) this.frame(performance.now(), true); };
    this.el.classList.toggle('is-flat', !this.view.renderer);
    this.size();
    window.addEventListener('resize', this.onResize);
    this.night = host.conditions().night;
    this.note.hidden = true;
    if (!opts.pano) void this.openCam(); else this.video.hidden = true;
    setText(this.name, p.name);
    this.t0 = performance.now(); this.last = this.t0;
    const start = opts.start ?? 'reperage';
    if (start === 'reperage') this.startScan(); else if (start === 'inspection') this.startInspect(); else this.startStrap();
    this.el.focus({ preventScroll: true });
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(t => this.loop(t));
    return new Promise<SeqResult>(resolve => { this.done = resolve; });
  }

  /** Essais automatiques : termine la séquence comme un sanglage réussi, avec l'état donné (0 à 100). */
  complete(state = 100): void { this.finish({ outcome: 'strapped', state }); }
  /** Ferme la couche (appelé aussi quand le jeu change d'écran) : compte comme un abandon. */
  close(): void { if (this.done) this.quit(); }

  // ───────────────────────── caméra, taille, couleurs

  private async openCam(): Promise<void> {
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    this.video.hidden = true;
    try {
      if (!md || typeof md.getUserMedia !== 'function') throw new Error('caméra absente');
      const stream = await md.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      if (!this.done) { stream.getTracks().forEach(t => t.stop()); return; } // fermé entre-temps
      this.stream = stream;
      this.video.srcObject = stream;
      this.video.hidden = false;
      void this.video.play().catch(() => { /* la lecture automatique suffit */ });
    } catch {
      this.video.hidden = true;
      if (this.done) this.flash('Caméra indisponible ici : décor 360°');
    }
  }
  private closeCam(): void {
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    this.video.srcObject = null;
    this.video.hidden = true;
  }
  /** Petit message d'information en haut, qui s'efface seul. */
  private flash(text: string): void {
    setText(this.note, text);
    this.note.hidden = false;
    this.timers.push(setTimeout(() => { this.note.hidden = true; }, 3200));
  }
  private size(): void {
    const r = this.el.getBoundingClientRect();
    this.W = Math.max(1, Math.round(r.width || window.innerWidth)); this.H = Math.max(1, Math.round(r.height || window.innerHeight));
    this.dpr = this.opts.light ? 1 : Math.min(2, window.devicePixelRatio || 1);
    this.c2.width = Math.round(this.W * this.dpr); this.c2.height = Math.round(this.H * this.dpr);
    this.view?.resize(this.W, this.H);
    if (this.frozen) this.frame(performance.now(), true);
  }
  private readInk(): void {
    const cs = getComputedStyle(this.el), v = (n: string, d: string): string => cs.getPropertyValue(n).trim() || d;
    this.ink = { ink: v('--pk-ink', this.ink.ink), halo: v('--pk-halo', this.ink.halo), ok: v('--pk-ok', this.ink.ok), warn: v('--pk-warn', this.ink.warn), bad: v('--pk-bad', this.ink.bad), gold: v('--pk-gold', this.ink.gold), blue: v('--pk-blue', this.ink.blue), dark: v('--pk-dark', this.ink.dark) };
  }
  private setPhase(ph: Phase): void {
    const i = STEPS.findIndex(s => s.id === ph);
    Array.from(this.steps.children).forEach((c, k) => { c.classList.toggle('is-done', k < i); c.classList.toggle('is-on', k === i); });
    this.el.dataset.phase = ph;
    this.bar.hidden = ph !== 'inspection';
  }
  private say(text: string, tone: MsgTone = ''): void { this.msgText = text; this.msgTone = tone; }
  private showMsg(): void {
    setText(this.msg, this.msgText);
    if (this.msg.dataset.tone !== this.msgTone) this.msg.dataset.tone = this.msgTone;
    this.msg.hidden = this.msgText === '';
  }
  private pano(rot = 0): void {
    if (this.p && this.view) this.view.setPano(this.opts.pano ?? panoFor(this.p.id), rot);
  }
  private backdrop(): void {
    const noCam = this.video.hidden === true || this.video.videoWidth === 0;
    this.view?.showPano(noCam, this.night ? 0.42 : 1);
    this.el.classList.toggle('is-bare', noCam && !(this.view?.panoReady));
  }
  private clearScene(): void {
    const s = this.st;
    if (s) {
      if (s.phase === 'sanglage') { for (const b of s.buckles) b.dispose(); disposeGroup(s.straps); for (const m of s.mg?.marks ?? []) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } }
      if (s.phase === 'inspection') for (const m of s.marks) { m.mesh.geometry.dispose(); (m.mesh.material as THREE.Material).dispose(); }
      s.crate.dispose();
    }
    this.view?.clear();
  }

  // ───────────────────────── boucle

  private loop(now: number): void {
    if (!this.done || this.frozen) return;
    this.raf = requestAnimationFrame(t => this.loop(t));
    try { this.frame(now, false); } catch (e) { console.warn('[ramassage]', e); }
    if (this.opts.freezeMs && now - this.t0 > this.opts.freezeMs) this.frozen = true;
  }
  private frame(now: number, still: boolean): void {
    const dt = still ? 0 : Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const s = this.st;
    if (!s || !this.view) return;
    this.backdrop();
    if (s.phase === 'reperage') this.drawScan(s, now, dt);
    else if (s.phase === 'inspection') this.drawInspect(s, now);
    else this.drawStrap(s, now, dt);
    this.showMsg();
  }
  private ctx(): CanvasRenderingContext2D {
    const c = this.c2.getContext('2d')!;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.W, this.H);
    c.lineCap = 'round'; c.lineJoin = 'round';
    return c;
  }
  /** Trait lisible sur n'importe quelle image : un halo sombre sous la couleur. */
  private stroke(c: CanvasRenderingContext2D, color: string, width: number): void {
    c.save(); c.strokeStyle = this.ink.halo; c.lineWidth = width + 3; c.stroke(); c.restore();
    c.strokeStyle = color; c.lineWidth = width; c.stroke();
  }
  private label(c: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
    c.font = '600 12px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const w = c.measureText(text).width + 16, bx = clamp(x - w / 2, 8, this.W - w - 8);
    c.fillStyle = this.ink.halo; c.beginPath(); c.roundRect(bx, y - 12, w, 24, 12); c.fill();
    c.fillStyle = color; c.fillText(text, bx + w / 2, y + 0.5);
  }
  /** Nuit : l'écran s'assombrit autour de la lampe frontale. */
  private nightVeil(c: CanvasRenderingContext2D, at: Pt): void {
    if (!this.night) return;
    const g = c.createRadialGradient(at.x, at.y, 60, at.x, at.y, Math.max(this.W, this.H) * 0.75);
    g.addColorStop(0, 'rgba(4,8,12,0)'); g.addColorStop(1, 'rgba(4,8,12,.72)');
    c.fillStyle = g; c.fillRect(0, 0, this.W, this.H);
  }
  /** Sans WebGL : la caisse en fil de fer plein, faces visibles ombrées. */
  private drawFlat(c: CanvasRenderingContext2D, crate: Crate, paths: StrapPath[]): void {
    const v = this.view!;
    if (v.renderer) return;
    const [W, H, D] = crate.dims, g = crate.group;
    g.updateWorldMatrix(true, false);
    const camPos = new THREE.Vector3(); v.cam.getWorldPosition(camPos);
    const faces: { n: [number, number, number]; q: [number, number, number][]; shade: number }[] = [
      { n: [0, 0, 1], q: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], shade: 0.82 }, { n: [0, 0, -1], q: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]], shade: 0.6 },
      { n: [1, 0, 0], q: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]], shade: 0.66 }, { n: [-1, 0, 0], q: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]], shade: 0.66 },
      { n: [0, 1, 0], q: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]], shade: 1 }, { n: [0, -1, 0], q: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]], shade: 0.5 },
    ];
    for (const f of faces) {
      const center = g.localToWorld(new THREE.Vector3(f.n[0] * W / 2, f.n[1] * H / 2, f.n[2] * D / 2));
      const n = new THREE.Vector3(...f.n).transformDirection(g.matrixWorld);
      if (n.dot(camPos.clone().sub(center)) <= 0) continue;
      const pts = f.q.map(q => v.toScreen(g.localToWorld(new THREE.Vector3(q[0] * W / 2, q[1] * H / 2, q[2] * D / 2))));
      if (pts.some(p => !p.front)) continue;
      c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath();
      c.fillStyle = `rgba(${Math.round(185 * f.shade)},${Math.round(138 * f.shade)},${Math.round(78 * f.shade)},.96)`; c.fill();
      c.strokeStyle = 'rgba(40,26,10,.9)'; c.lineWidth = 2; c.stroke();
    }
    for (const path of paths) {
      c.beginPath();
      path.pts.forEach((p, i) => { const s = v.toScreen(g.localToWorld(p.clone())); if (i) c.lineTo(s.x, s.y); else c.moveTo(s.x, s.y); });
      this.stroke(c, '#d9822b', 7);
    }
  }

  // ───────────────────────── 1. repérage

  private startScan(): void {
    const p = this.p!, v = this.view!;
    this.clearScene();
    this.pano();
    const crate = makeCrate(p, () => { if (this.frozen) this.frame(performance.now(), true); });
    const [cw, ch, cd] = crate.dims, g = new THREE.Group();
    crate.group.position.y = ch / 2;
    g.add(crate.group);
    const sh = blobShadow(cw * 2.2, cd * 2.2); sh.position.y = 0.01; g.add(sh);
    v.scene.add(g);
    const r = Math.random;
    const manualYaw = r() * 360;
    this.st = { phase: 'reperage', crate, group: g, target: null, manualYaw, manualPitch: -18, lockT: 0, drag: null };
    if (this.opts.demo?.aim) { this.placeCrate(this.st, (manualYaw + 2.5) % 360); this.st.lockT = LOCK_S * 0.55; }
    this.setPhase('reperage');
    setText(this.kick, 'Repérage · balaie autour de toi');
    setText(this.int, `${p.crateLabel} · pour ${p.destName}`);
    setText(this.time, '');
    this.say('');
  }
  private placeCrate(s: ScanState, target: number): void {
    s.target = target;
    s.group.position.set(Math.sin(target * D2R) * SCAN_R, -1.45, -Math.cos(target * D2R) * SCAN_R);
    s.group.rotation.y = -target * D2R + (Math.random() - 0.5) * 1.2;
  }
  private drawScan(s: ScanState, now: number, dt: number): void {
    const v = this.view!, { W, H } = this, sen = this.sensors, live = sen.live;
    const yaw = live ? sen.heading! : s.manualYaw, pitch = live && sen.tilt !== null ? clamp(sen.tilt - 90, -80, 30) : s.manualPitch;
    // La caisse est posée une fois le repère connu : au vrai cap du colis avec une boussole, sinon ailleurs autour du joueur.
    if (s.target === null) {
      const real = live && sen.absolute && this.p!.bearingDeg !== null;
      this.placeCrate(s, real ? this.p!.bearingDeg! : (yaw + 70 + Math.random() * 220) % 360);
    }
    v.cam.position.set(0, 0, 0);
    v.cam.rotation.set(pitch * D2R, -yaw * D2R, 0, 'YXZ');
    v.cam.updateMatrixWorld();
    if (!this.reduce) s.crate.group.rotation.y = Math.sin(now / 1400) * 0.05;
    v.render();
    const p3 = new THREE.Vector3(); s.crate.group.getWorldPosition(p3);
    const sp = v.toScreen(p3), diff = angDiff(s.target!, yaw), cx = W / 2, cy = H * 0.55;
    const onScreen = sp.front && sp.x > 0 && sp.x < W && sp.y > 0 && sp.y < H, ok = sp.front && Math.hypot(sp.x - cx, sp.y - cy) < 70;
    s.lockT = ok ? s.lockT + dt : Math.max(0, s.lockT - dt * 2);
    const c = this.ctx(), I = this.ink;
    this.drawFlat(c, s.crate, []);
    this.nightVeil(c, { x: cx, y: cy });
    // Repère sur la caisse quand elle est à l'écran mais pas encore dans le viseur.
    if (onScreen && !ok) {
      const k = 34, q = 12;
      c.beginPath();
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { c.moveTo(sp.x + dx * k, sp.y + dy * (k - q)); c.lineTo(sp.x + dx * k, sp.y + dy * k); c.lineTo(sp.x + dx * (k - q), sp.y + dy * k); }
      this.stroke(c, I.warn, 2);
      this.label(c, this.p!.name, sp.x, sp.y - k - 18, I.ink);
    }
    // Viseur
    c.beginPath(); c.arc(cx, cy, 26, 0, Math.PI * 2);
    c.moveTo(cx - 38, cy); c.lineTo(cx - 30, cy); c.moveTo(cx + 30, cy); c.lineTo(cx + 38, cy); c.moveTo(cx, cy - 38); c.lineTo(cx, cy - 30); c.moveTo(cx, cy + 30); c.lineTo(cx, cy + 38);
    this.stroke(c, ok ? I.ok : I.ink, 1.5);
    if (s.lockT > 0) { c.beginPath(); c.arc(cx, cy, 32, -Math.PI / 2, -Math.PI / 2 + Math.min(1, s.lockT / LOCK_S) * Math.PI * 2); this.stroke(c, I.ok, 4); }
    // Guide directionnel : chevrons du côté où tourner.
    if (!onScreen) {
      const right = diff > 0, pulse = this.reduce ? 0 : Math.sin(now / 220) * 5, dir = right ? 1 : -1;
      for (let i = 0; i < 3; i++) {
        const ax = (right ? W - 58 : 58) + dir * (i * 14 + pulse);
        c.globalAlpha = 0.45 + i * 0.25;
        c.beginPath(); c.moveTo(ax - dir * 8, H / 2 - 16); c.lineTo(ax + dir * 8, H / 2); c.lineTo(ax - dir * 8, H / 2 + 16);
        this.stroke(c, I.warn, 4);
      }
      c.globalAlpha = 1;
      this.label(c, `${Math.round(Math.abs(diff))}°`, right ? W - 44 : 44, H / 2 + 38, I.warn);
    }
    let msg: string;
    if (ok) msg = 'Garde le colis dans le viseur';
    else if (!live) msg = 'Glisse le doigt pour tourner et viser';
    else if (Math.abs(diff) > 30) msg = `Tourne-toi ${diff > 0 ? 'vers la droite' : 'vers la gauche'}`;
    else if (sp.front && sp.y > cy + 60) msg = 'Baisse le téléphone vers le sol';
    else if (sp.front && sp.y < cy - 60) msg = 'Relève un peu le téléphone';
    else msg = 'Centre le colis dans le viseur';
    this.say(msg, ok ? 'good' : '');
    setText(this.time, `${Math.round((yaw + 360) % 360)}°`);
    if (s.lockT >= LOCK_S && !this.frozen && !this.opts.demo?.aim) {
      this.host!.ui('confirm'); this.host!.buzz(40);
      this.startInspect();
    }
  }

  // ───────────────────────── 2. inspection

  /** Place la caisse en gros plan devant la caméra ; renvoie son pivot. */
  private closeUp(crate: Crate, lift: number, margin: number): THREE.Group {
    const v = this.view!, [dw, dh, dd] = crate.dims;
    v.cam.position.set(0, 0, 0); v.cam.rotation.set(0, 0, 0, 'YXZ'); v.cam.updateMatrixWorld();
    const vfov = v.cam.fov * D2R, hfov = 2 * Math.atan(Math.tan(vfov / 2) * v.cam.aspect), r = 0.5 * Math.hypot(dw, dh, dd);
    const pivot = new THREE.Group();
    pivot.add(crate.group);
    pivot.position.set(0, -r * lift, (-r / Math.sin(Math.min(vfov, hfov) / 2)) * margin);
    v.scene.add(pivot);
    return pivot;
  }
  private startInspect(): void {
    const p = this.p!, demo = this.opts.demo;
    this.clearScene();
    const rnd = rng(`inspection|${p.id}`), R = (a: number, b: number): number => a + (b - a) * rnd();
    this.pano(R(-0.5, 0.5));
    const crate = makeCrate(p, () => { if (this.frozen) this.frame(performance.now(), true); });
    const [dw, dh, dd] = crate.dims, pivot = this.closeUp(crate, -0.28, 1.14);
    // Défauts : fissures ou fuites sur des faces visibles ou cachées (il faut tourner le colis).
    const n = demo?.defects ?? (rnd() < 0.3 ? (rnd() < 0.3 ? 2 : 1) : 0);
    const faces: [number, number, number][] = [[0, 0, 1], [1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, 0, -1]], marks: Mark[] = [];
    for (let i = 0; i < n; i++) {
      const f = faces[demo?.defects ? i % 2 : Math.floor(rnd() * faces.length)];
      const v = new THREE.Vector3(f[0] * dw / 2 + (f[0] ? 0 : R(-dw * 0.3, dw * 0.3)), f[1] * dh / 2 + (f[1] ? 0 : R(-dh * 0.3, dh * 0.3)), f[2] * dd / 2 + (f[2] ? 0 : R(-dd * 0.3, dd * 0.3)));
      const nv = new THREE.Vector3(...f);
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(Math.min(dw, dh, dd) * 0.13, 20), new THREE.MeshBasicMaterial({ color: 0xe0644f, transparent: true, opacity: 0.85 }));
      mesh.position.copy(v).addScaledVector(nv, 0.004);
      mesh.lookAt(v.clone().add(nv));
      crate.group.add(mesh);
      marks.push({ mesh, v, n: nv, kind: rnd() < 0.5 ? 'Fissure' : 'Fuite', fixed: false, vis: false, s: null });
    }
    let tag: THREE.Mesh | null = null;
    if (p.labelHidden || demo?.label) {
      tag = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(dw, dd) * 0.32, Math.min(dw, dd) * 0.2), new THREE.MeshBasicMaterial({ color: 0xf2d16b }));
      tag.position.set(R(-dw * 0.2, dw * 0.2), dh / 2 + 0.004, R(-dd * 0.2, dd * 0.2));
      tag.rotation.x = -Math.PI / 2;
      crate.group.add(tag);
    }
    this.st = { phase: 'inspection', crate, pivot, marks, tag, tagFound: false, tagVis: false, tagS: null, yaw: -0.6, pitch: 0.35, drag: null, heard: p.inspected };
    this.setPhase('inspection');
    setText(this.name, `${p.name} · ${fmt(p.weightKg)} kg`);
    setText(this.kick, 'Inspection · défauts, étiquette, contenu');
    setText(this.time, '');
    this.listenBtn.disabled = p.inspected;
    setText(this.listenTxt, p.inspected ? 'Écouté' : 'Écouter');
    this.listenBtn.setAttribute('aria-label', p.inspected ? 'Contenu déjà écouté' : 'Écouter le colis (ou secoue le téléphone)');
    this.say(p.inspected && p.known ? p.known : 'Tourne le colis du doigt pour l’inspecter');
    if (demo?.listen) this.listen();
  }
  private drawInspect(s: InspectState, now: number): void {
    const v = this.view!, I = this.ink;
    s.pivot.rotation.set(s.pitch, s.yaw, 0);
    s.pivot.updateMatrixWorld(true);
    if (!this.reduce) for (const k of s.marks) if (!k.fixed) (k.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.35 * Math.sin(now / 180);
    v.render();
    const c = this.ctx(), g = s.crate.group;
    this.drawFlat(c, s.crate, []);
    this.nightVeil(c, { x: this.W / 2, y: this.H / 2 });
    const cam = new THREE.Vector3(); v.cam.getWorldPosition(cam);
    for (const k of s.marks) {
      if (k.fixed) continue;
      const w = g.localToWorld(k.v.clone()), n = k.n.clone().transformDirection(g.matrixWorld);
      k.vis = n.dot(cam.clone().sub(w)) > 0;
      if (!k.vis) continue;
      const sp = v.toScreen(w); k.s = sp;
      c.beginPath(); c.arc(sp.x, sp.y, 20 + (this.reduce ? 0 : 3 * Math.sin(now / 150)), 0, Math.PI * 2); this.stroke(c, I.bad, 2);
      this.label(c, `${k.kind} · toucher pour réparer`, sp.x, sp.y - 38, I.ink);
    }
    if (s.tag && !s.tagFound) {
      const w = g.localToWorld(s.tag.position.clone()), n = new THREE.Vector3(0, 1, 0).transformDirection(g.matrixWorld);
      s.tagVis = n.dot(cam.clone().sub(w)) > 0;
      if (s.tagVis) {
        const sp = v.toScreen(w); s.tagS = sp;
        c.beginPath(); c.arc(sp.x, sp.y, 22, 0, Math.PI * 2); this.stroke(c, I.gold, 2);
        this.label(c, 'Étiquette bizarre · toucher', sp.x, sp.y - 38, I.gold);
      }
    }
    const left = s.marks.filter(k => !k.fixed).length;
    setText(this.int, (left ? `${left} défaut${left > 1 ? 's' : ''} à réparer` : 'Aucun défaut visible') + (s.heard ? ' · contenu écouté' : ''));
    // Secouer le téléphone, c'est écouter.
    if (!s.heard && this.sensors.motion > 7) this.listen();
  }
  private listen(): void {
    const s = this.st;
    if (!s || s.phase !== 'inspection' || s.heard || !this.host) return;
    s.heard = true;
    this.listenBtn.disabled = true;
    setText(this.listenTxt, 'Écouté');
    this.listenBtn.setAttribute('aria-label', 'Contenu écouté');
    this.host.buzz([30, 40, 30]);
    const r = this.host.listen();
    this.say(r.text, r.tone);
    if (r.cat) {
      const crate = s.crate, [dw, dh, dd] = crate.dims;
      void loadModel('chat_clandestin', 'caisse').then(tpl => {
        if (this.st !== s) return;
        const m = tpl.root.clone(true), k = Math.max(0.2, Math.min(dw, dd) * 0.7) / Math.max(1, tpl.w, tpl.d);
        m.scale.setScalar(k); m.position.set(0, dh / 2, 0);
        crate.group.add(m);
        if (this.frozen) this.frame(performance.now(), true);
      }).catch(() => { /* le miaulement suffit */ });
    }
  }
  private insGo(): void {
    const s = this.st;
    if (!s || s.phase !== 'inspection') return;
    this.defectsLeft = s.marks.filter(k => !k.fixed).length;
    this.host?.ui('tap');
    this.startStrap();
  }

  // ───────────────────────── 3. sanglage

  private startStrap(): void {
    const p = this.p!, host = this.host!, demo = this.opts.demo;
    this.clearScene();
    const rnd = rng(`sanglage|${p.id}|${demo ? 0 : Math.floor(performance.now())}`), R = (a: number, b: number): number => a + (b - a) * rnd();
    this.pano(R(-0.5, 0.5));
    const crate = makeCrate(p, () => { if (this.frozen) this.frame(performance.now(), true); });
    const [dw, dh, dd] = crate.dims, pivot = this.closeUp(crate, -0.2, 1.1);
    const size = clamp(Math.hypot(dw, dh, dd) / 0.9, 0.55, 1.7), plan = strapPlan({ weightKg: p.weightKg, fragile: p.fragile, timed: p.timed, special: p.special });
    // Boucles réparties sur les trois faces visibles (avant, côté droit, dessus), au prorata de leur surface.
    const faces: [Face, number][] = [['front', dw * dh], ['right', dd * dh], ['top', dw * dd]], tot = faces.reduce((a, f) => a + f[1], 0);
    const pickFace = (): Face => { let q = rnd() * tot; for (const f of faces) { if ((q -= f[1]) <= 0) return f[0]; } return 'front'; };
    const pt = (f: Face): THREE.Vector3 => f === 'front' ? new THREE.Vector3(R(-dw * 0.38, dw * 0.38), R(-dh * 0.36, dh * 0.36), dd / 2)
      : f === 'right' ? new THREE.Vector3(dw / 2, R(-dh * 0.36, dh * 0.36), R(-dd * 0.36, dd * 0.36)) : new THREE.Vector3(R(-dw * 0.38, dw * 0.38), dh / 2, R(-dd * 0.36, dd * 0.36));
    const nodes: Node[] = [];
    let tries = 0, minD = Math.hypot(dw, dh, dd) * 0.26;
    while (nodes.length < plan.nodes && tries < 3000) {
      tries++;
      if (tries % 500 === 0) minD *= 0.85;
      const f = pickFace(), v = pt(f);
      if (nodes.every(o => o.v.distanceTo(v) > minD)) nodes.push({ v, f });
    }
    const straps = new THREE.Group();
    crate.group.add(straps);
    const buckles = nodes.map(n => { const b = makeBuckle(n.f, size); b.group.position.copy(n.v); crate.group.add(b.group); return b; });
    // Conditions : pluie = sangle glissante, fatigue = mains tremblantes, nuit = lampe frontale.
    const cond = host.conditions();
    const corr = Math.max(STRAP.minCorr, plan.corr - (cond.wet ? 3 : 0) - (cond.tired ? 2 : 0));
    // Sangles à la couleur de la matière.
    this.mats.fixed.dispose(); this.mats.live.dispose();
    this.mats = strapMaterials(p.special ? undefined : crateDef(p.crate).strap);
    const forced = demo?.final && demo.final !== true ? demo.final : demo?.ratchet ? 'cliquet' : null;
    const lag = Math.max(0.08, plan.lag - (cond.wet ? 0.04 : 0) - (cond.tired ? 0.03 : 0));
    const now = performance.now();
    const s: StrapState = {
      phase: 'sanglage', crate, pivot, nodes, buckles, straps, live: null, livePath: null, donePaths: [], rw: 0.034 * size, plan, corr, lag,
      jitter: cond.exhausted ? 4 : cond.tired ? 2 : 0, guide: null, A: [], reached: 0, drag: false, finger: null, tip: null, f0: { x: 0, y: 0 }, a0: { x: 0, y: 0 }, real: null,
      lock: 0, lastMove: null, lastHarsh: 0, spd: 0, integrity: 100 - STRAP.defect * this.defectsLeft, limit: plan.time, start: now, done: false, shake: 0, ph: R(0, 9),
      mode: 'path', rt: { v: 0, hold: false, zone: plan.ratchetZone, c: R(RATCHET_CENTER[0], RATCHET_CENTER[1]), last: 0 },
      gesture: forced ?? gestureFor(p.crate, p.special), wet: cond.wet, mg: null, kn: null, cb: null,
    };
    this.defectsLeft = 0;
    this.st = s;
    this.setPhase('sanglage');
    setText(this.name, `${p.name} · ${fmt(p.weightKg)} kg`);
    const conds = [cond.wet && 'sangles glissantes', cond.tired && 'mains tremblantes', cond.night && 'de nuit'].filter(Boolean);
    setText(this.kick, p.special === 'ruche' ? 'Arrimage · ruche vivante' : conds.length ? `Arrimage 3D · ${conds.join(', ')}`
      : p.fragile ? 'Arrimage 3D · fragile, aucun geste brusque' : 'Arrimage 3D · les sangles passent d’une face à l’autre');
    this.say(p.special === 'ruche' ? 'Ruche : gestes très lents, les abeilles s’agitent' : 'Pose le doigt où tu veux : la sangle part de la boucle 1');
    this.updateAnchors(s, now);
    // Démo : boucles déjà reliées, ou cliquet en cours.
    if (demo?.reached || demo?.ratchet || demo?.final) {
      const fin = !!(demo.ratchet || demo.final), upTo = fin ? nodes.length : Math.min(nodes.length - 1, demo.reached ?? 0);
      for (let i = 1; i < upTo; i++) this.fixStrap(s, i);
      s.reached = upTo;
      if (fin) {
        if (s.gesture === 'sangles') { this.say('Sangles seules : la dernière boucle verrouille tout', 'good'); s.guide = null; }
        else this.enterFinal(s);
        const k = demo.step ?? 1;
        if (s.mode === 'ratchet') { s.rt.v = s.rt.c - 0.12; s.rt.hold = true; }
        if (s.mg) for (let i = 0; i < Math.min(k, s.mg.c.length - 1); i++) this.placeMagnet(s, s.mg.c[i]);
        if (s.kn) { s.kn.i = Math.round((s.kn.pts.length - 1) * Math.min(0.9, 0.42 * k)); s.kn.on = true; }
        if (s.cb) for (let i = 0; i < Math.min(k, 2); i++) { const pl = s.cb.plugs.find(q => q.c === s.cb!.order[i])!; pl.done = true; pl.to = s.cb.socks.find(q => q.c === pl.c)!; s.cb.step = i + 1; }
      }
      else {
        this.updateAnchors(s, now);
        const a = s.A[upTo - 1], b = s.A[upTo], G = s.guide;
        if (a && b && G) {
          const mid = G.length > 2 ? { x: G[0].x + (G[1].x - G[0].x) * 0.8, y: G[0].y + (G[1].y - G[0].y) * 0.8 } : { x: a.x + (b.x - a.x) * 0.55, y: a.y + (b.y - a.y) * 0.55 };
          s.tip = mid; s.finger = { ...mid }; s.drag = true; s.a0 = { ...mid }; s.f0 = { ...mid };
          this.liveTo(s, mid);
          this.say(`Glisse vers la boucle ${upTo + 1} et maintiens`);
        }
      }
    }
  }
  /** La charge bouge : rotation et glissement de la caisse, boucles reprojetées à chaque image. */
  private updateAnchors(s: StrapState, now: number): void {
    const v = this.view!, t = this.reduce || this.opts.demo ? s.ph : now / 1000 + s.ph, a = s.plan.sway / 1000, pv = s.pivot;
    pv.rotation.set(0.42 + a * 2.5 * Math.sin(t * 2.3 + 1), -0.62 + a * 6 * Math.sin(t * 1.7) + a * 2.5 * Math.sin(t * 4.1), a * 2 * Math.sin(t * 1.1 + 2));
    pv.position.x = a * 3 * Math.sin(t * 1.3);
    if (s.shake > 0 && !this.reduce) { pv.position.x += Math.sin(now / 18) * 0.02 * s.shake; s.shake = Math.max(0, s.shake - 0.05); }
    pv.updateMatrixWorld(true); v.cam.updateMatrixWorld();
    const g = s.crate.group;
    s.A = s.nodes.map(n => v.toScreen(g.localToWorld(n.v.clone())));
    if (s.reached >= 1 && s.reached < s.nodes.length && !s.done) {
      const na = s.nodes[s.reached - 1], nb = s.nodes[s.reached];
      s.guide = strapPath(na.v, na.f, nb.v, nb.f, s.crate.dims).pts.map(q => v.toScreen(g.localToWorld(q.clone())));
    } else s.guide = null;
  }
  private setLive(s: StrapState, path: StrapPath | null): void {
    if (s.live) { disposeGroup(s.live); s.live = null; }
    s.livePath = path;
    if (path) { s.live = ribbon(path, s.rw, this.mats.live); s.straps.add(s.live); }
  }
  /** L'extrémité de la sangle est posée sur la surface réelle de la caisse, sous le point de l'écran. */
  private liveTo(s: StrapState, at: Pt): void {
    const v = this.view!, na = s.nodes[s.reached - 1];
    if (!na) return;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((at.x / this.W) * 2 - 1, -(at.y / this.H) * 2 + 1), v.cam);
    const hit = ray.intersectObject(s.crate.box, false)[0], f = hit?.face ? faceOf(hit.face.normal) : null;
    if (hit && f) this.setLive(s, strapPath(na.v, na.f, s.crate.group.worldToLocal(hit.point.clone()), f, s.crate.dims));
  }
  private fixStrap(s: StrapState, i: number): void {
    const na = s.nodes[i - 1], nb = s.nodes[i], path = strapPath(na.v, na.f, nb.v, nb.f, s.crate.dims);
    s.straps.add(ribbon(path, s.rw, this.mats.fixed));
    s.donePaths.push(path);
  }
  private hurt(s: StrapState, n: number, msg: string): void {
    s.integrity = Math.max(0, s.integrity - n);
    this.say(msg, 'bad');
    s.shake = 1;
    this.host!.buzz(80);
    if (s.integrity < STRAP.refuse && !s.done) this.finishStrap(s, false, 'Colis trop endommagé, refusé');
  }
  private dropStrap(s: StrapState, n: number, msg: string): void {
    this.host!.ui('error');
    s.drag = false; s.finger = null; s.tip = null; s.real = null; s.lock = 0;
    this.setLive(s, null);
    this.hurt(s, n, msg);
  }
  private stepStrap(s: StrapState, dt: number): void {
    if (!s.drag || s.done || !s.finger || !s.tip || !s.guide) return;
    const b = s.A[s.reached], k = 1 - Math.pow(1 - s.lag, dt * 60), tip = s.tip;
    tip.x += (s.finger.x - tip.x) * k; tip.y += (s.finger.y - tip.y) * k;
    if (s.jitter && !this.reduce) { tip.x += (Math.random() * 2 - 1) * s.jitter; tip.y += (Math.random() * 2 - 1) * s.jitter; }
    if (Math.hypot(s.finger.x - tip.x, s.finger.y - tip.y) > STRAP.slackPx) { this.dropStrap(s, STRAP.tooTight, 'Sangle trop tendue, elle a glissé'); return; }
    const G = s.guide;
    let dmin = 1e9;
    for (let i = 0; i < G.length - 1; i++) dmin = Math.min(dmin, segDist(tip.x, tip.y, G[i], G[i + 1]));
    if (dmin > s.corr) { this.dropStrap(s, STRAP.offPath, `Sangle sortie du passage : reprends à la boucle ${s.reached}`); return; }
    this.liveTo(s, tip);
    if (Math.hypot(tip.x - b.x, tip.y - b.y) < STRAP.lockPx) {
      const before = s.lock;
      s.lock += dt * 1000;
      if (Math.floor(s.lock / 110) > Math.floor(before / 110)) this.host!.ui('tap');
      if (s.lock >= s.plan.hold) {
        this.setLive(s, null);
        this.fixStrap(s, s.reached);
        this.host!.ui('confirm'); this.host!.buzz([20, 30, 20]);
        s.reached++; s.lock = 0;
        s.tip = { x: b.x, y: b.y }; s.a0 = { x: b.x, y: b.y }; s.f0 = { ...(s.real ?? s.f0) }; s.finger = { ...s.a0 };
        if (s.reached >= s.nodes.length) { if (s.gesture === 'sangles') this.finishStrap(s, true); else this.enterFinal(s); return; }
        this.say(`Cliquet verrouillé · boucle ${s.reached + 1} ensuite`, 'good');
      }
    } else s.lock = Math.max(0, s.lock - dt * 2000);
  }
  /** Toutes les boucles sont reliées : il reste le geste propre à la matière (cliquet, aimants, nœud, câbles). */
  private enterFinal(s: StrapState): void {
    const g = s.gesture, { W, H } = this, [dw, dh, dd] = s.crate.dims;
    if (g === 'sangles') return;
    s.mode = g === 'cliquet' ? 'ratchet' : g === 'aimants' ? 'magnet' : g === 'noeud' ? 'knot' : 'cables';
    s.drag = false; s.finger = null; s.tip = null; s.guide = null;
    this.setLive(s, null);
    // Le temps accordé : six secondes de plus comme dans l'ancien jeu, et au moins la durée du geste.
    s.limit = Math.max(s.limit + 6, (performance.now() - s.start) / 1000 + FINAL[g].time);
    setText(this.kick, KICK[g]);
    this.host?.ui('confirm');
    if (g === 'cliquet') this.say('Maintiens pour tendre le cliquet, relâche dans la zone verte');
    if (g === 'aimants') {
      const L = [new THREE.Vector3(-dw * 0.3, dh * 0.25, dd / 2), new THREE.Vector3(dw * 0.3, -dh * 0.25, dd / 2), new THREE.Vector3(0, dh / 2, dd * 0.1)];
      const y = Math.max(H * 0.72, H - 170), gap = Math.min(84, W * 0.24);
      s.mg = { t: L.map((v, i) => ({ v, done: false, i, s: null })), c: L.map((_, i) => ({ i, hx: W / 2 + (i - 1) * gap, hy: y, x: W / 2 + (i - 1) * gap, y, placed: false })), drag: null, marks: [] };
      this.say('Fais glisser chaque attache aimantée sur son repère');
    }
    if (g === 'noeud') {
      const cx = W / 2, cy = H * 0.52, rx = Math.min(W * 0.34, 170), ry = Math.min(H * 0.18, 120);
      s.kn = { pts: knotPath().map(q => ({ x: cx + rx * q.x, y: cy + ry * q.y })), i: 0, tol: s.wet ? FINAL.noeud.tolWetPx : FINAL.noeud.tolPx, on: false };
      this.say('Pose le doigt sur le point de départ et suis la corde');
    }
    if (g === 'cables') {
      const plan = cablePlan(this.opts.demo ? rng(`câbles|${this.p!.id}`) : Math.random), dy = Math.min(86, H * 0.105), y0 = Math.max(H * 0.34, 250);
      const socks: Sock[] = plan.sockets.map((c, i) => ({ c, x: W * 0.8, y: y0 + i * dy }));
      s.cb = { order: plan.order, step: 0, plugs: [0, 1, 2].map(i => ({ c: i, x: W * 0.2, y: y0 + i * dy, done: false, to: null })), socks, drag: null };
      this.say(`Branche les câbles dans l’ordre : ${plan.order.map(i => CABLES[i][1]).join(', ')}`);
    }
  }
  private placeMagnet(s: StrapState, k: MagChip): void {
    const M = s.mg!, T = M.t[k.i];
    k.placed = true; T.done = true;
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.03), new THREE.MeshStandardMaterial({ color: 0x3b4043, metalness: 0.6, roughness: 0.3, emissive: 0x16323a }));
    m.position.copy(T.v);
    if (k.i === 2) m.rotation.x = Math.PI / 2;
    s.crate.group.add(m); M.marks.push(m);
  }
  private finishStrap(s: StrapState, ok: boolean, why?: string): void {
    s.done = true; s.drag = false; s.rt.hold = false;
    if (ok) {
      this.host!.buzz(40);
      this.say(`Colis arrimé · état ${Math.round(s.integrity)} %`, 'good');
      this.timers.push(setTimeout(() => this.finish({ outcome: 'strapped', state: s.integrity }), this.reduce ? 500 : 1100));
    } else {
      const text = why ?? 'Temps écoulé, le colis a glissé';
      this.say(text, 'bad');
      this.host!.ui('error');
      this.timers.push(setTimeout(() => this.finish({ outcome: 'failed', why: text }), 1500));
    }
  }
  private drawStrap(s: StrapState, now: number, dt: number): void {
    const v = this.view!, I = this.ink, c0 = s.mode;
    this.updateAnchors(s, now);
    if (c0 === 'path') this.stepStrap(s, dt);
    if (this.st !== s) return;
    const nextI = s.drag ? s.reached : Math.max(0, s.reached - 1), pulse = this.reduce ? 0.6 : 0.5 + 0.5 * Math.sin(now / 170);
    s.buckles.forEach((b, i) => {
      if (s.mode === 'path' && i === nextI && !s.done) b.ring.emissive.setRGB(0.45 * pulse, 0.25 * pulse, 0.02);
      else if (i < s.reached) b.ring.emissive.setRGB(0.25, 0.1, 0); else b.ring.emissive.setRGB(0, 0, 0);
    });
    v.render();
    const c = this.ctx();
    this.drawFlat(c, s.crate, s.livePath ? [...s.donePaths, s.livePath] : s.donePaths);
    this.nightVeil(c, s.tip ?? s.A[Math.max(0, s.reached - 1)] ?? { x: this.W / 2, y: this.H / 2 });
    const left = Math.max(0, s.limit - (now - s.start) / 1000);
    if (!s.done && left <= 0 && !this.frozen && !this.opts.demo) this.finishStrap(s, false);
    setText(this.time, left.toFixed(1).replace('.', ','));
    this.time.classList.toggle('is-low', left < 3);
    setText(this.int, `État du colis ${Math.round(s.integrity)} % · refusé sous ${STRAP.refuse} %`);
    if (s.mode === 'ratchet') { this.drawRatchet(c, s, dt); return; }
    if (s.mode !== 'path') { this.drawFinal(c, s, now); return; }
    if (s.guide) {
      const G = s.guide;
      c.beginPath(); G.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)));
      c.strokeStyle = 'rgba(243,239,226,.2)'; c.lineWidth = s.corr * 2; c.stroke();
      c.setLineDash([5, 7]); this.stroke(c, I.ink, 1.5); c.setLineDash([]);
    }
    if (s.tip) {
      const t = s.tip;
      c.beginPath(); c.arc(t.x, t.y, 9, 0, Math.PI * 2);
      c.moveTo(t.x - 15, t.y); c.lineTo(t.x - 11, t.y); c.moveTo(t.x + 11, t.y); c.lineTo(t.x + 15, t.y); c.moveTo(t.x, t.y - 15); c.lineTo(t.x, t.y - 11); c.moveTo(t.x, t.y + 11); c.lineTo(t.x, t.y + 15);
      this.stroke(c, I.ink, 2);
    }
    s.A.forEach((o, i) => {
      const next = i === nextI && !s.done, done = i < s.reached && !next;
      c.fillStyle = next ? I.ink : done ? '#d9822b' : I.halo;
      c.beginPath(); c.arc(o.x + 16, o.y - 16, 10, 0, Math.PI * 2); c.fill();
      c.fillStyle = next || done ? I.dark : I.ink; c.font = '700 12px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(i + 1), o.x + 16, o.y - 15.5);
      if (next) { c.beginPath(); c.arc(o.x, o.y, 18 + pulse * 3, 0, Math.PI * 2); this.stroke(c, I.ink, 1.5); }
      if (s.drag && i === s.reached && s.lock > 0) { c.beginPath(); c.arc(o.x, o.y, 22, -Math.PI / 2, -Math.PI / 2 + (s.lock / s.plan.hold) * Math.PI * 2); this.stroke(c, I.ok, 4); }
    });
  }
  private drawRatchet(c: CanvasRenderingContext2D, s: StrapState, dt: number): void {
    const R = s.rt, I = this.ink, { W, H } = this, heavy = this.p!.weightKg > 10;
    if (R.hold && !s.done && !this.frozen) {
      R.v = Math.min(1, R.v + dt * (heavy ? 0.4 : 0.5));
      if (Math.floor(R.v * 24) > R.last) { R.last = Math.floor(R.v * 24); this.host!.ui('tap'); }
      if (R.v >= 1) { R.hold = false; R.v = 0; this.hurt(s, STRAP.snapped, 'La sangle a cédé : trop de tension'); }
    } else if (!R.hold) R.last = 0;
    const cx = W / 2, cy = Math.max(H * 0.66, H - 262), r = Math.min(82, W * 0.23), a0 = Math.PI * 0.8, a1 = Math.PI * 2.2, ang = (x: number): number => a0 + (a1 - a0) * x;
    c.fillStyle = this.ink.halo; c.beginPath(); c.arc(cx, cy, r + 22, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(243,239,226,.22)'; c.lineWidth = 16; c.beginPath(); c.arc(cx, cy, r, a0, a1); c.stroke();
    c.strokeStyle = I.ok; c.beginPath(); c.arc(cx, cy, r, ang(R.c - R.zone / 2), ang(R.c + R.zone / 2)); c.stroke();
    c.strokeStyle = R.v > R.c + R.zone / 2 ? I.bad : I.warn; c.lineWidth = 6; c.beginPath(); c.arc(cx, cy, r, a0, ang(R.v)); c.stroke();
    const na = ang(R.v);
    c.strokeStyle = I.ink; c.lineWidth = 3; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(na) * (r - 6), cy + Math.sin(na) * (r - 6)); c.stroke();
    c.fillStyle = I.ink; c.beginPath(); c.arc(cx, cy, 5, 0, Math.PI * 2); c.fill();
    c.font = '700 14px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(s.done ? 'Verrouillé' : R.hold ? 'Tension…' : 'Maintiens l’écran', cx, cy + r * 0.62);
  }

  /** Aimants, nœud, câbles : dessinés sur le calque 2D, par-dessus le colis sanglé. */
  private drawFinal(c: CanvasRenderingContext2D, s: StrapState, now: number): void {
    const I = this.ink, { W } = this, v = this.view!, wob = this.reduce ? 0 : Math.sin(now / 160);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    if (s.mg) {
      for (const T of s.mg.t) {
        if (T.done) continue;
        const q = v.toScreen(s.crate.group.localToWorld(T.v.clone())); T.s = q;
        c.fillStyle = this.ink.halo; c.beginPath(); c.arc(q.x, q.y, 15, 0, Math.PI * 2); c.fill();
        c.setLineDash([4, 4]); c.beginPath(); c.arc(q.x, q.y, 19 + 3 * wob, 0, Math.PI * 2); this.stroke(c, I.blue, 2); c.setLineDash([]);
        c.fillStyle = I.blue; c.font = '700 14px system-ui, sans-serif'; c.fillText(String(T.i + 1), q.x, q.y + 0.5);
      }
      for (const k of s.mg.c) {
        if (k.placed) continue;
        c.fillStyle = '#2f3539'; c.beginPath(); c.roundRect(k.x - 28, k.y - 22, 56, 44, 9); c.fill(); this.stroke(c, I.warn, 2);
        c.fillStyle = I.warn; c.font = '700 14px system-ui, sans-serif'; c.fillText(`U ${k.i + 1}`, k.x, k.y + 0.5);
      }
    }
    if (s.kn) {
      const K = s.kn, P = K.pts;
      c.beginPath(); P.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)));
      c.strokeStyle = 'rgba(243,239,226,.22)'; c.lineWidth = K.tol * 1.6; c.stroke();
      c.setLineDash([6, 8]); this.stroke(c, I.ink, 1.5); c.setLineDash([]);
      if (K.i > 0) { c.beginPath(); for (let i = 0; i <= K.i; i++) { if (i) c.lineTo(P[i].x, P[i].y); else c.moveTo(P[i].x, P[i].y); } this.stroke(c, '#c9a36a', 9); }
      const q = P[K.i];
      c.beginPath(); c.arc(q.x, q.y, 10 + 3 * wob, 0, Math.PI * 2); c.fillStyle = I.ink; c.fill(); this.stroke(c, I.warn, 2);
      this.label(c, `${Math.round((K.i / (P.length - 1)) * 100)} %`, W / 2, Math.min(...P.map(o => o.y)) - 26, I.warn);
    }
    if (s.cb) {
      const C = s.cb, wire = (x0: number, y0: number, x1: number, y1: number, col: string): void => { c.beginPath(); c.moveTo(x0, y0); c.bezierCurveTo(W / 2, y0, W / 2, y1, x1, y1); this.stroke(c, col, 7); };
      for (const p of C.plugs) if (p.done && p.to) wire(p.x, p.y, p.to.x, p.to.y, CABLES[p.c][0]);
      if (C.drag) wire(C.drag.pl.x, C.drag.pl.y, C.drag.x, C.drag.y, CABLES[C.drag.pl.c][0]);
      c.font = '800 14px system-ui, sans-serif';
      for (const q of C.socks) {
        c.fillStyle = this.ink.halo; c.beginPath(); c.arc(q.x, q.y, 22, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc(q.x, q.y, 19, 0, Math.PI * 2); this.stroke(c, CABLES[q.c][0], 4);
        c.fillStyle = CABLES[q.c][0]; c.fillText(CABLES[q.c][1][0].toUpperCase(), q.x, q.y + 0.5);
      }
      for (const p of C.plugs) {
        c.beginPath(); c.arc(p.x, p.y, 18, 0, Math.PI * 2); c.fillStyle = CABLES[p.c][0]; c.fill(); this.stroke(c, p.done ? I.ok : I.dark, 2);
        c.fillStyle = I.dark; c.fillText(CABLES[p.c][1][0].toUpperCase(), p.x, p.y + 0.5);
      }
      // L'ordre demandé, rappelé au-dessus : fait en vert, à faire dans la couleur du câble.
      const y = C.plugs[0].y - 52, gap = Math.min(92, W * 0.25);
      C.order.forEach((o, i) => this.label(c, `${i + 1}. ${CABLES[o][1]}`, W / 2 + (i - 1) * gap, y, i < C.step ? I.ok : CABLES[o][0]));
    }
  }
  private finalDown(s: StrapState, q: Pt): void {
    if (s.mg) { const k = s.mg.c.find(o => !o.placed && Math.hypot(q.x - o.x, q.y - o.y) < FINAL.aimants.grabPx); if (k) { s.mg.drag = k; this.host!.ui('tap'); } }
    if (s.kn) { const K = s.kn, p = K.pts[K.i]; if (Math.hypot(q.x - p.x, q.y - p.y) < K.tol * 1.4) K.on = true; else this.say('Repars du point lumineux'); }
    if (s.cb) { const pl = s.cb.plugs.find(o => !o.done && Math.hypot(q.x - o.x, q.y - o.y) < FINAL.cables.grabPx); if (pl) { s.cb.drag = { pl, x: q.x, y: q.y }; this.host!.ui('tap'); } }
  }
  private finalMove(s: StrapState, q: Pt): void {
    if (s.mg?.drag) { s.mg.drag.x = q.x; s.mg.drag.y = q.y; }
    if (s.cb?.drag) { s.cb.drag.x = q.x; s.cb.drag.y = q.y; }
    const K = s.kn;
    if (!K || !K.on) return;
    let adv = false;
    for (let n = 0; n < 6 && K.i < K.pts.length - 1; n++) { const nx = K.pts[K.i + 1]; if (Math.hypot(q.x - nx.x, q.y - nx.y) < K.tol) { K.i++; adv = true; } else break; }
    if (adv && K.i % 6 === 0) this.host!.ui('tap');
    const p = K.pts[K.i];
    if (Math.hypot(q.x - p.x, q.y - p.y) > K.tol * 2.2) {
      K.on = false; K.i = knotCheckpoint(K.i, K.pts.length);
      this.host!.ui('error');
      this.hurt(s, FINAL.noeud.slipCost, 'La corde a filé : reprends au repère');
      return;
    }
    if (K.i >= K.pts.length - 1) { K.on = false; this.host!.ui('confirm'); this.host!.buzz([20, 40, 60]); this.finishStrap(s, true); }
  }
  private finalUp(s: StrapState): void {
    if (s.kn) s.kn.on = false;
    const M = s.mg;
    if (M?.drag) {
      const k = M.drag, T = M.t[k.i];
      M.drag = null;
      if (T.s && Math.hypot(k.x - T.s.x, k.y - T.s.y) < FINAL.aimants.snapPx) {
        this.placeMagnet(s, k);
        this.host!.ui('confirm'); this.host!.buzz(30);
        const left = M.c.filter(o => !o.placed).length;
        if (!left) this.finishStrap(s, true); else this.say(`Attache verrouillée · ${left} restante${left > 1 ? 's' : ''}`, 'good');
      } else { k.x = k.hx; k.y = k.hy; this.say('À côté : vise le repère qui bouge avec la malle', 'bad'); this.host!.ui('error'); }
    }
    const C = s.cb;
    if (C?.drag) {
      const d = C.drag;
      C.drag = null;
      const so = C.socks.find(o => Math.hypot(d.x - o.x, d.y - o.y) < FINAL.cables.socketPx);
      if (!so) return;
      const want = C.order[C.step], res = cablePlug(d.pl.c, so.c, want);
      if (res !== 'ok') { this.host!.ui('error'); this.host!.buzz([60, 30, 60]); this.hurt(s, FINAL.cables.cost, res === 'couleur' ? 'Court-circuit : mauvaise couleur' : 'Étincelle : mauvais ordre'); return; }
      d.pl.done = true; d.pl.to = so; C.step++;
      this.host!.ui('confirm');
      if (C.step >= C.order.length) this.finishStrap(s, true);
      else this.say(`Câble ${CABLES[want][1]} branché · suivant : ${CABLES[C.order[C.step]][1]}`, 'good');
    }
  }

  // ───────────────────────── gestes

  private at(e: PointerEvent): Pt { const b = this.c2.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; }
  private down(e: PointerEvent): void {
    const s = this.st;
    if (!s || this.frozen && !this.opts.demo) return;
    if (this.frozen) { this.frozen = false; this.opts.freezeMs = 0; this.last = performance.now(); this.raf = requestAnimationFrame(t => this.loop(t)); } // démo figée : un toucher la réveille
    const q = this.at(e);
    try { this.c2.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    if (s.phase === 'reperage') { s.drag = { x: q.x, y: q.y, yaw: s.manualYaw, pitch: s.manualPitch }; return; }
    if (s.phase === 'inspection') { s.drag = { x: q.x, y: q.y, yaw: s.yaw, pitch: s.pitch, moved: 0 }; return; }
    if (s.done) return;
    if (s.mode === 'ratchet') { s.rt.hold = true; return; }
    if (s.mode !== 'path') { this.finalDown(s, q); return; }
    const n = s.A[s.reached ? s.reached - 1 : 0];
    if (!n) return;
    // Pavé tactile : la sangle repart de là où elle était (ou de la boucle) et suit le mouvement relatif du doigt.
    const from = s.tip ? { ...s.tip } : { x: n.x, y: n.y };
    s.drag = true; s.f0 = { ...q }; s.a0 = from; s.finger = { ...from }; s.tip = { ...from }; s.lastMove = { ...q, t: performance.now() };
    if (s.reached === 0) s.reached = 1;
    this.say(`Glisse vers la boucle ${s.reached + 1} et maintiens`);
  }
  private move(e: PointerEvent): void {
    const s = this.st;
    if (!s) return;
    const q = this.at(e), now = performance.now();
    if (s.phase === 'reperage') {
      if (s.drag && !this.sensors.live) { s.manualYaw = (s.drag.yaw - (q.x - s.drag.x) * 0.2 + 360) % 360; s.manualPitch = clamp(s.drag.pitch + (q.y - s.drag.y) * 0.15, -70, 20); }
      return;
    }
    if (s.phase === 'inspection') {
      const d = s.drag;
      if (!d) return;
      d.moved = Math.max(d.moved, Math.hypot(q.x - d.x, q.y - d.y));
      s.yaw = d.yaw + (q.x - d.x) * 0.011; s.pitch = clamp(d.pitch + (q.y - d.y) * 0.009, -1.2, 1.3);
      return;
    }
    if (s.mode !== 'path' && s.mode !== 'ratchet' && !s.done) { this.finalMove(s, q); return; }
    if (s.mode !== 'path' || !s.drag || s.done || !s.lastMove) return;
    const dtm = Math.max(1, now - s.lastMove.t), spd = (Math.hypot(q.x - s.lastMove.x, q.y - s.lastMove.y) / dtm) * 1000;
    if (spd > s.plan.harshSpeed && now - s.lastHarsh > 450) {
      s.lastHarsh = now;
      this.hurt(s, s.plan.harshCost, this.p!.special === 'ruche' ? 'Trop vite : les abeilles s’affolent' : this.p!.fragile ? 'Trop brusque, le contenu a bougé' : 'Geste trop sec');
      if (this.st !== s || s.done) return;
    }
    s.spd = spd; s.lastMove = { ...q, t: now }; s.real = q;
    s.finger = { x: s.a0.x + (q.x - s.f0.x), y: s.a0.y + (q.y - s.f0.y) };
  }
  private up(e: PointerEvent, real: boolean): void {
    const s = this.st;
    if (!s) return;
    if (s.phase === 'reperage') { s.drag = null; return; }
    if (s.phase === 'inspection') {
      const d = s.drag; s.drag = null;
      if (!d || !real || d.moved > 10) return;
      const q = this.at(e);
      for (const k of s.marks) {
        if (k.fixed || !k.vis || !k.s || Math.hypot(q.x - k.s.x, q.y - k.s.y) >= 30) continue;
        k.fixed = true;
        const m = k.mesh.material as THREE.MeshBasicMaterial;
        m.color.set(0x8a8f92); m.opacity = 1; k.mesh.scale.set(1.3, 0.7, 1);
        this.host!.ui('confirm');
        this.say(`${k.kind} colmatée à l’adhésif`, 'good');
        return;
      }
      if (s.tag && !s.tagFound && s.tagVis && s.tagS && Math.hypot(q.x - s.tagS.x, q.y - s.tagS.y) < 34) {
        s.tagFound = true;
        (s.tag.material as THREE.MeshBasicMaterial).color.set(0x9ccf7a);
        this.host!.foundLabel(); this.host!.ui('confirm');
        this.say('Mauvaise étiquette : la vraie adresse est dessous (bonus +60 %)', 'gold');
      }
      return;
    }
    if (s.done) return;
    if (s.mode === 'ratchet') {
      const R = s.rt;
      if (!R.hold) return;
      R.hold = false;
      const res = ratchetRelease(R.v, R.c, R.zone);
      if (res === 'none') return;
      if (res === 'ok') { this.host!.ui('confirm'); this.host!.buzz([20, 40, 60]); this.finishStrap(s, true); }
      else if (res === 'over') { R.v = 0; this.hurt(s, STRAP.overRatchet, 'Trop serré : le colis a souffert'); }
      else { R.v = 0; this.say('Pas assez tendu : recommence', 'bad'); this.host!.ui('error'); }
      return;
    }
    if (s.mode !== 'path') { this.finalUp(s); return; }
    if (s.drag) { s.drag = false; s.finger = null; s.lock = 0; this.say('Sangle tenue · repose le doigt pour continuer'); }
  }

  // ───────────────────────── fin

  private quit(): void {
    const s = this.st;
    this.finish({ outcome: 'quit', phase: s?.phase ?? 'reperage', strapping: !!s && s.phase === 'sanglage' && !s.done });
  }
  private finish(r: SeqResult): void {
    const done = this.done;
    if (!done) return;
    this.done = null;
    cancelAnimationFrame(this.raf);
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    window.removeEventListener('resize', this.onResize);
    this.sensors.stop();
    this.closeCam();
    this.clearScene();
    this.st = null;
    this.view?.dispose();
    this.view = null;
    this.c2.getContext('2d')?.clearRect(0, 0, this.c2.width, this.c2.height);
    this.el.hidden = true;
    done(r);
  }
}

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const fmt = (kg: number): string => nf.format(kg);
function segDist(px: number, py: number, a: Pt, b: Pt): number {
  const vx = b.x - a.x, vy = b.y - a.y, l = vx * vx + vy * vy;
  const t = l ? clamp(((px - a.x) * vx + (py - a.y) * vy) / l, 0, 1) : 0;
  return Math.hypot(px - (a.x + vx * t), py - (a.y + vy * t));
}
