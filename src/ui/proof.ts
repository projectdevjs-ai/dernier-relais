// Preuve photo : la caméra arrière du téléphone, le temps d'une photo (cadre, grille, déclencheur à maintenir).
// La photo ne quitte jamais la page : elle est rendue sous forme d'adresse « data: » à celui qui l'affiche,
// rien n'est envoyé ni enregistré. Caméra absente ou refusée : on le signale par `false`, sans message.
import { btn, h, reducedMotion } from './dom';
import { icon } from './icons';

type Media = Pick<MediaDevices, 'getUserMedia'> & Partial<Pick<MediaDevices, 'enumerateDevices'>>;
const media = (): Media | null => {
  const m = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  return m && typeof m.getUserMedia === 'function' ? m : null;
};

/** Vrai si l'appareil a (peut-être) une caméra utilisable. Ne demande aucune permission. */
export async function cameraAvailable(): Promise<boolean> {
  const m = media();
  if (!m) return false;
  if (!m.enumerateDevices) return true;
  try { return (await m.enumerateDevices()).some((d) => d.kind === 'videoinput'); } catch { return false; }
}

/** Secousses tolérées pendant la prise (m/s², hors gravité) et durée de maintien du déclencheur. */
const STILL = 1.6, HOLD_S = 1.2;

/**
 * Ouvre le viseur dans `parent` : cadre, grille des tiers, et un déclencheur à maintenir, téléphone immobile, le temps de la
 * mise au point (comme dans l'ancien jeu). Résout avec la photo, ou null si le joueur ferme ; rejette si la caméra est refusée ou absente.
 */
export class ProofCamera {
  private el: HTMLElement | null = null;
  private stream: MediaStream | null = null;
  private done: ((photo: string | null) => void) | null = null;
  private raf = 0;
  private motion = 0;
  private onMotion = (e: Event): void => {
    const a = (e as DeviceMotionEvent).acceleration;
    if (a && a.x !== null && a.y !== null && a.z !== null) this.motion = Math.hypot(a.x, a.y, a.z);
  };

  /** `place` : nom du lieu de livraison ; `what` : nom du colis. */
  async open(parent: HTMLElement, place = '', what = ''): Promise<string | null> {
    const m = media();
    if (!m) throw new Error('caméra absente');
    const stream = await m.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
    this.stream = stream;
    const video = h('video', 'dr-cam-video');
    video.autoplay = true; video.muted = true; video.playsInline = true;
    video.srcObject = stream;
    const shutter = btn('dr-cam-shutter', 'Prendre la photo : maintiens le déclencheur, téléphone immobile');
    const close = btn('dr-iconbtn dr-cam-close', 'Fermer sans photo', icon('close'));
    const frame = h('div', 'dr-cam-frame', h('i'), h('i'), h('i'), h('i'));
    const hint = h('p', 'dr-cam-hint', 'Cadre le lieu de livraison et maintiens le déclencheur');
    hint.setAttribute('role', 'status');
    const flash = h('div', 'dr-cam-flash');
    const ring = h('div', 'dr-cam-ring');
    ring.innerHTML = '<svg viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="48" r="45" pathLength="100"/></svg>';
    const top = h('div', 'dr-cam-top', h('span', 'dr-cam-kick', place ? `Preuve de livraison · ${place}` : 'Preuve de livraison'), h('strong', 'dr-cam-title', what || 'Téléphone immobile pendant la prise'));
    this.el = h('div', 'dr-cam', video, h('div', 'dr-cam-grid'), frame, top, hint, flash, ring, close, shutter);
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Photo-preuve');
    parent.append(this.el);
    void video.play().catch(() => { /* la lecture automatique suffit */ });
    window.addEventListener('devicemotion', this.onMotion);
    this.motion = 0;
    return new Promise<string | null>((resolve) => {
      this.done = resolve;
      let held = false, prog = 0, last = performance.now(), shot = false;
      const take = (): void => {
        if (shot) return;
        shot = true;
        const photo = snap(video);
        flash.classList.add('is-on');
        try { navigator.vibrate?.(30); } catch { /* pas de vibreur */ }
        hint.textContent = photo ? 'Photo prise' : 'Image indisponible';
        setTimeout(() => this.finish(photo), reducedMotion() ? 80 : 380);
      };
      // Maintien : la jauge se remplit tant que le téléphone ne bouge pas, et se vide dès qu'il bouge ou qu'on relâche.
      const step = (now: number): void => {
        if (!this.done || shot) return;
        this.raf = requestAnimationFrame(step);
        const dt = Math.min(0.1, (now - last) / 1000), still = this.motion < STILL;
        last = now;
        if (held && still) { prog += dt / HOLD_S; hint.textContent = 'Stabilisation…'; }
        else if (held) { prog = Math.max(0, prog - dt * 2); hint.textContent = 'Ne bouge pas'; }
        else { prog = Math.max(0, prog - dt * 1.5); if (prog === 0) hint.textContent = 'Cadre le lieu de livraison et maintiens le déclencheur'; }
        ring.style.setProperty('--p', Math.min(1, prog).toFixed(3));
        if (prog >= 1) take();
      };
      this.raf = requestAnimationFrame(step);
      const press = (on: boolean): void => { held = on; shutter.classList.toggle('is-held', on); };
      shutter.addEventListener('pointerdown', (e) => { press(true); try { shutter.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ } });
      shutter.addEventListener('pointerup', () => press(false));
      shutter.addEventListener('pointercancel', () => press(false));
      // Au clavier (ou avec un lecteur d'écran), un appui suffit.
      shutter.addEventListener('click', (e) => { if (e.detail === 0) take(); });
      close.addEventListener('click', () => this.finish(null));
    });
  }

  /** Ferme le viseur et éteint la caméra (appelé aussi si l'écran de note se ferme). */
  close(): void { this.finish(null); }

  private finish(photo: string | null): void {
    cancelAnimationFrame(this.raf);
    if (typeof window !== 'undefined') window.removeEventListener('devicemotion', this.onMotion);
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    this.el?.remove();
    this.el = null;
    const done = this.done;
    this.done = null;
    done?.(photo);
  }
}

/** Image réduite (480 px de large) : assez pour une vignette, légère en mémoire. */
function snap(video: HTMLVideoElement): string | null {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const w = Math.min(480, vw), c = document.createElement('canvas');
  c.width = w; c.height = Math.round((w * vh) / vw);
  const g = c.getContext('2d');
  if (!g) return null;
  g.drawImage(video, 0, 0, c.width, c.height);
  try { return c.toDataURL('image/jpeg', 0.7); } catch { return null; }
}
