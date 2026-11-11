// Preuve photo : la caméra arrière du téléphone, le temps d'une photo.
// La photo ne quitte jamais la page : elle est rendue sous forme d'adresse « data: » à celui qui l'affiche,
// rien n'est envoyé ni enregistré. Caméra absente ou refusée : on le signale par `false`, sans message.
import { btn, h } from './dom';
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

/** Ouvre le viseur dans `parent`. Résout avec la photo, ou null si le joueur ferme ; rejette si la caméra est refusée ou absente. */
export class ProofCamera {
  private el: HTMLElement | null = null;
  private stream: MediaStream | null = null;
  private done: ((photo: string | null) => void) | null = null;

  async open(parent: HTMLElement): Promise<string | null> {
    const m = media();
    if (!m) throw new Error('caméra absente');
    const stream = await m.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
    this.stream = stream;
    const video = h('video', 'dr-cam-video');
    video.autoplay = true; video.muted = true; video.playsInline = true;
    video.srcObject = stream;
    const shutter = btn('dr-cam-shutter', 'Prendre la photo');
    const close = btn('dr-iconbtn dr-cam-close', 'Fermer sans photo', icon('close'));
    const frame = h('div', 'dr-cam-frame', h('i'), h('i'), h('i'), h('i'));
    this.el = h('div', 'dr-cam', video, frame, h('p', 'dr-cam-hint', 'Cadre le lieu de livraison'), close, shutter);
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Photo-preuve');
    parent.append(this.el);
    void video.play().catch(() => { /* la lecture automatique suffit */ });
    return new Promise<string | null>((resolve) => {
      this.done = resolve;
      close.addEventListener('click', () => this.finish(null));
      shutter.addEventListener('click', () => this.finish(snap(video)));
    });
  }

  /** Ferme le viseur et éteint la caméra (appelé aussi si l'écran de note se ferme). */
  close(): void { this.finish(null); }

  private finish(photo: string | null): void {
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
