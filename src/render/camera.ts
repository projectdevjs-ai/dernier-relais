// La caméra du jeu : angle, zoom et inclinaison pilotés ICI, jamais par les gestes natifs de MapLibre.
// Pourquoi : le suivi du porteur recale la carte à chaque image (map.jumpTo), et jumpTo annule tout geste
// MapLibre en cours (pincement, rotation). Les gestes ne modifient donc que des CIBLES (cap, zoom, inclinaison) ;
// la scène applique centre + cibles lissées en un seul jumpTo par image. Le centre reste toujours le porteur.
export type TiltMode = '2d' | '3d';

export interface CameraOpts {
  bearing: number; zoom: number; pitch: number;
  minZoom: number; maxZoom: number; maxPitch: number;
  /** Toucher bref sans glisser, en pixels CSS dans l'élément. */
  onTap(x: number, y: number): void;
  /**
   * Vrai si un objet interactif (abri, colis…) est sous ce point : son toucher part alors tout de suite.
   * Sinon (toucher du sol) il attend DOUBLE_MS, le temps de savoir si c'est le début d'un double appui.
   */
  isHot?(x: number, y: number): boolean;
}

/** Degrés de cap par pixel glissé à un doigt (un travers d'écran ≈ un tiers de tour). */
const ROTATE_PER_PX = 0.3;
/** Degrés d'inclinaison par pixel glissé verticalement. */
const PITCH_PER_PX = 0.18;
/** En dessous, un mouvement est un toucher, pas un glisser (pixels). */
const TAP_SLOP = 10;
// Large : un doigt posé sans bouger puis relevé reste un toucher (et les essais automatiques sont lents).
const TAP_MS = 2000;
// Zoom à un doigt, comme Google Maps et Pokémon GO : double appui = un cran de zoom avant ; double appui en
// gardant le doigt posé au second, puis glisser = zoom continu (vers le bas : zoom avant, vers le haut : arrière).
/** Délai maximal entre le premier appui relevé et le second posé (millisecondes), et écart toléré (pixels). */
const DOUBLE_MS = 280, DOUBLE_SLOP = 40;
/** Niveaux de zoom par pixel glissé (un tiers d'écran ≈ 3 niveaux) et cran du double appui simple. */
const ZOOM_PER_PX = 1 / 95, ZOOM_STEP = 1;
/** Rotation à deux doigts ignorée tant qu'elle reste sous ce seuil : un pincement ne fait pas tourner la carte. */
const TWIST_DEAD = 4;
/** Suivi de direction : on ne tourne pas pour un écart plus petit (zone morte), ni plus vite que la vitesse plafond. */
const HEADING_DEAD = 14;
const HEADING_MAX_DPS = 55;
/** La vue 2D recule un peu pour montrer les alentours. */
const FLAT_ZOOM_OUT = 0.9;

const wrap = (d: number): number => ((d + 540) % 360 + 360) % 360 - 180;
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

export class CameraRig {
  /** Valeurs appliquées à la carte (lissées). */
  bearing: number; zoom: number; pitch: number;
  /** 0 = vue 3D, 1 = vue 2D (lissé : sert au recul et au cadrage). */
  flat = 0;
  mode: TiltMode = '3d';
  /** Vrai tant que la caméra se replace derrière le porteur ; un geste de rotation le coupe, recenter() le rétablit. */
  followHeading = true;
  private tBearing: number; private tZoom: number; private tPitch: number;
  private readonly o: CameraOpts;
  private readonly home: { zoom: number; pitch: number };
  private readonly pts = new Map<number, { x: number; y: number }>();
  /** Geste à un doigt en cours. */
  private one: { x: number; y: number; bearing: number; pitch: number; t: number; axis: '' | 'x' | 'y'; tap: boolean } | null = null;
  /** Geste à deux doigts en cours. */
  private two: { d: number; ang: number; last: number; turn: number; zoom: number; bearing: number; twisting: boolean } | null = null;
  /** Dernier toucher du sol, en attente : il part à l'échéance, sauf si un second appui en fait un double appui. */
  private wait: { x: number; y: number; t: number; timer: number } | null = null;
  /** Second appui d'un double appui, doigt encore posé : glisser = zoom. */
  private dbl: { y: number; zoom: number; moved: boolean } | null = null;
  private turning = false;
  private rate = 0;
  private dirty = true;

  constructor(private readonly el: HTMLElement, opts: CameraOpts) {
    this.o = opts;
    this.bearing = this.tBearing = opts.bearing;
    this.zoom = this.tZoom = opts.zoom;
    this.pitch = this.tPitch = opts.pitch;
    this.home = { zoom: opts.zoom, pitch: opts.pitch };
    // Le navigateur ne doit ni faire défiler ni zoomer la page : tous les gestes sont pour la carte.
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.up);
    el.addEventListener('wheel', this.wheel, { passive: false });
    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  /** Vrai pendant un geste. */
  get active(): boolean { return this.pts.size > 0; }

  setTilt(mode: TiltMode): void {
    this.mode = mode;
    this.tPitch = mode === '2d' ? 0 : this.home.pitch;
  }

  /** Retour aux réglages d'origine ; la caméra reprend le suivi de direction. */
  recenter(): void {
    this.followHeading = true;
    this.tZoom = this.home.zoom;
    this.tPitch = this.mode === '2d' ? 0 : this.home.pitch;
  }

  /** Force la prochaine mise à jour à être appliquée (taille d'écran changée). */
  invalidate(): void { this.dirty = true; }

  /**
   * À chaque image. `course` : cap de marche lissé du porteur (degrés, 0 = nord) ou null s'il n'avance pas.
   * Renvoie vrai si la caméra a changé (la carte doit être recalée).
   */
  update(dt: number, course: number | null): boolean {
    if (this.followHeading && course !== null && !this.active) {
      const diff = wrap(course - this.tBearing), a = Math.abs(diff);
      if (a > HEADING_DEAD) this.turning = true;
      if (this.turning) {
        // Vitesse angulaire : proportionnelle à l'écart, plafonnée, et qui monte progressivement (pas d'à-coup).
        const want = Math.sign(diff) * Math.min(HEADING_MAX_DPS, a * 1.6 + 3);
        this.rate += (want - this.rate) * (1 - Math.exp(-dt * 4));
        const step = this.rate * dt;
        if (a < 1 || Math.abs(step) >= a) { this.tBearing = course; this.turning = false; this.rate = 0; }
        else this.tBearing += step;
      }
    } else { this.turning = false; this.rate = 0; }

    // Lissage : vif sous le doigt, doux pour les transitions (bascule 2D / 3D, recentrage).
    const k = 1 - Math.exp(-dt * (this.active ? 22 : 7)), ks = 1 - Math.exp(-dt * 4.5);
    const db = wrap(this.tBearing - this.bearing), dz = this.tZoom - this.zoom, dp = this.tPitch - this.pitch;
    const df = (this.mode === '2d' ? 1 : 0) - this.flat;
    let changed = this.dirty;
    this.dirty = false;
    if (Math.abs(db) > 0.02) { this.bearing = wrap(this.bearing + db * k); changed = true; } else this.bearing = wrap(this.tBearing);
    if (Math.abs(dz) > 0.002) { this.zoom += dz * k; changed = true; } else this.zoom = this.tZoom;
    if (Math.abs(dp) > 0.03) { this.pitch += dp * (this.active ? k : ks); changed = true; } else this.pitch = this.tPitch;
    if (Math.abs(df) > 0.003) { this.flat += df * ks; changed = true; } else this.flat = this.mode === '2d' ? 1 : 0;
    return changed;
  }

  /** Zoom réellement appliqué à la carte (la vue 2D recule un peu). */
  get mapZoom(): number { return Math.max(this.o.minZoom, this.zoom - FLAT_ZOOM_OUT * this.flat); }

  // ---------------------------------------------------------------- Gestes

  private pair(): { d: number; ang: number } {
    const [a, b] = [...this.pts.values()];
    return { d: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), ang: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI };
  }

  private startOne(x: number, y: number, tap: boolean): void {
    this.one = { x, y, bearing: this.tBearing, pitch: this.tPitch, t: performance.now(), axis: '', tap };
  }

  private readonly down = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { this.el.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    if (this.pts.size === 1) {
      const w = this.wait;
      if (w && performance.now() - w.t < DOUBLE_MS && Math.hypot(e.clientX - w.x, e.clientY - w.y) < DOUBLE_SLOP) {
        // Second appui : le toucher du sol en attente est annulé, le geste devient un zoom.
        clearTimeout(w.timer); this.wait = null; this.one = null;
        this.dbl = { y: e.clientY, zoom: this.tZoom, moved: false };
      } else this.startOne(e.clientX, e.clientY, true);
    } else if (this.pts.size === 2) {
      const p = this.pair();
      this.one = null; this.dbl = null;
      this.two = { d: p.d, ang: p.ang, last: p.ang, turn: 0, zoom: this.tZoom, bearing: this.tBearing, twisting: false };
    }
  };

  private readonly move = (e: PointerEvent): void => {
    const pt = this.pts.get(e.pointerId);
    if (!pt) return;
    pt.x = e.clientX; pt.y = e.clientY;
    const g2 = this.two;
    if (this.pts.size >= 2 && g2) {
      const p = this.pair();
      this.tZoom = clamp(g2.zoom + Math.log2(p.d / g2.d), this.o.minZoom, this.o.maxZoom);
      // Angle cumulé, déroulé (pas de saut à ±180°).
      g2.turn += wrap(p.ang - g2.last); g2.last = p.ang;
      if (!g2.twisting && Math.abs(g2.turn) > TWIST_DEAD) { g2.twisting = true; g2.bearing += g2.turn; }
      // Doigts tournés dans le sens horaire : la carte tourne avec eux (le cap diminue).
      if (g2.twisting) { this.tBearing = g2.bearing - g2.turn; this.followHeading = false; }
      return;
    }
    const z = this.dbl;
    if (z && this.pts.size === 1) {
      const dy = e.clientY - z.y;
      if (!z.moved && Math.abs(dy) < TAP_SLOP) return;
      // Glisser vers le bas : zoom avant ; vers le haut : zoom arrière. Le point de départ ne saute pas.
      if (!z.moved) { z.moved = true; z.y = e.clientY; return; }
      this.tZoom = clamp(z.zoom + dy * ZOOM_PER_PX, this.o.minZoom, this.o.maxZoom);
      return;
    }
    const g = this.one;
    if (!g || this.pts.size !== 1) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.axis) {
      if (Math.hypot(dx, dy) < TAP_SLOP) return;
      // Le geste est verrouillé sur son axe dominant : tourner OU incliner, jamais les deux par accident.
      g.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      g.tap = false; g.x = e.clientX; g.y = e.clientY;
      return;
    }
    if (g.axis === 'x') { this.tBearing = g.bearing + dx * ROTATE_PER_PX; this.followHeading = false; }
    else if (this.mode === '3d') this.tPitch = clamp(g.pitch - dy * PITCH_PER_PX, 0, this.o.maxPitch);
  };

  private readonly up = (e: PointerEvent): void => {
    if (!this.pts.delete(e.pointerId)) return;
    const g = this.one;
    if (this.pts.size === 0) {
      this.one = null; this.two = null;
      const z = this.dbl;
      this.dbl = null;
      if (z) {
        // Double appui sans glisser : un cran de zoom avant, animé par le lissage de la caméra.
        if (!z.moved && e.type === 'pointerup') this.tZoom = clamp(this.tZoom + ZOOM_STEP, this.o.minZoom, this.o.maxZoom);
      } else if (g && g.tap && e.type === 'pointerup' && performance.now() - g.t < TAP_MS) {
        const r = this.el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        if (this.wait) { clearTimeout(this.wait.timer); this.wait = null; }
        // Objet interactif : réaction immédiate. Sol : court délai, pour ne pas partir en marche sur un double appui.
        if (!this.o.isHot || this.o.isHot(x, y)) this.o.onTap(x, y);
        else this.wait = { x: e.clientX, y: e.clientY, t: performance.now(), timer: window.setTimeout(() => { this.wait = null; this.o.onTap(x, y); }, DOUBLE_MS) };
      }
    } else if (this.pts.size === 1) {
      // Un doigt reste posé après un geste à deux doigts : il reprend la main, sans compter comme un toucher.
      this.two = null;
      const [a] = [...this.pts.values()];
      this.startOne(a.x, a.y, false);
    }
  };

  private readonly wheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.tZoom = clamp(this.tZoom - e.deltaY * 0.0025, this.o.minZoom, this.o.maxZoom);
  };
}
