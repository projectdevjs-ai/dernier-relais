// Voile plein écran des scènes autonomes : fondus d'entrée et de sortie, écran de chargement sobre.
import { el } from './kit';

export class Veil {
  readonly el: HTMLDivElement;
  private readonly box: HTMLDivElement;
  private readonly fill: HTMLSpanElement;

  constructor(root: HTMLElement, kicker: string, name: string) {
    this.el = el('div', 's3-veil is-on is-cut');
    this.box = el('div', 's3-load');
    this.box.setAttribute('role', 'status');
    this.box.append(el('span', 's3-load-kicker', kicker), el('span', 's3-load-name', name));
    const bar = el('span', 's3-load-bar');
    this.fill = el('span', 's3-load-fill');
    bar.appendChild(this.fill);
    this.box.appendChild(bar);
    this.box.hidden = true;
    this.el.appendChild(this.box);
    root.appendChild(this.el);
  }

  /** Avancement du chargement, de 0 à 1. */
  progress(k: number): void { this.fill.style.transform = `scaleX(${Math.max(0, Math.min(1, k)).toFixed(3)})`; }
  loader(on: boolean): void { this.box.hidden = !on; }

  /** Couvre l'écran. cut : sans transition. */
  cover(cut = false): void {
    this.el.classList.toggle('is-cut', cut);
    this.el.classList.add('is-on');
  }

  /** Découvre l'écran en fondu. */
  lift(): void {
    void this.el.offsetWidth; // la transition part bien de l'état couvert
    this.el.classList.remove('is-cut');
    this.el.classList.remove('is-on');
  }
}
