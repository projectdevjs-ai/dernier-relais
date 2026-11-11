// Messages courts en haut de l'écran. Trois au plus, chacun disparaît seul.
import { h } from './dom';
import { icon, type IconName } from './icons';
import type { Tone } from './ctx';

const ICON: Record<Tone, IconName> = { info: 'info', good: 'check', warn: 'warn' };

export class Toasts {
  private host: HTMLElement;
  constructor(parent: HTMLElement) {
    this.host = h('div', 'dr-toasts');
    this.host.setAttribute('role', 'status');
    this.host.setAttribute('aria-live', 'polite');
    parent.append(this.host);
  }
  /** `ms` : durée d'affichage (les phrases longues restent un peu plus). */
  push(text: string, tone: Tone = 'info', ic?: IconName, ms = 2800): void {
    // Un message identique encore affiché n'est pas répété.
    for (const c of Array.from(this.host.children)) if (c.textContent === text) return;
    const el = h('div', `dr-toast dr-toast-${tone}`, icon(ic ?? ICON[tone]), h('span', '', text));
    this.host.append(el);
    while (this.host.children.length > 3) this.host.firstElementChild?.remove();
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 220);
    }, ms);
  }
}
