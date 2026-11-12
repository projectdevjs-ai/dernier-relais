// Voix françaises des personnages : fichiers mp3 générés à l'avance (scripts/voix.ts), joués à la demande.
// Si un fichier manque ou si le son est coupé, il ne se passe rien : le texte reste affiché à l'écran.
import { hash } from '../core/geo';

export class Voice {
  private known: Set<string> | null = null;
  private el: HTMLAudioElement | null = null;
  private unlocked = false;
  muted = false;
  volume = 0.9;

  constructor() {
    fetch('voix/index.json').then(r => (r.ok ? r.json() : [])).then((ids: string[]) => { this.known = new Set(ids); }).catch(() => { this.known = new Set(); });
  }
  /** À appeler au premier toucher : les navigateurs mobiles bloquent le son avant. */
  unlock(): void { this.unlocked = true; }
  /** Dit la réplique si elle a été enregistrée. Une nouvelle réplique coupe la précédente. */
  say(who: string, text: string): void {
    if (this.muted || !this.unlocked || !this.known) return;
    const id = `${who}-${hash(`${who}|${text}`).toString(36)}`;
    if (!this.known.has(id)) return;
    this.stop();
    const el = new Audio(`voix/${id}.mp3`);
    el.volume = this.volume;
    this.el = el;
    el.play().catch(() => { /* lecture refusée : on reste silencieux */ });
  }
  stop(): void { if (this.el) { this.el.pause(); this.el = null; } }
}
