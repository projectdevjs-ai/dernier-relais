// Feuille haute réutilisable (abri, colis, porteur) : voile, en-tête avec bouton fermer, corps défilant, pied fixe.
import { btn, h, reducedMotion } from './dom';
import { drag, rubber } from './gestures';
import { icon } from './icons';

/** Son d'ouverture et de fermeture, commun à tous les panneaux (réglé par le HUD, vaut aussi pour la carte du réseau). */
let sound: ((kind: 'open' | 'close') => void) | null = null;
export function setPanelSound(fn: ((kind: 'open' | 'close') => void) | null): void { sound = fn; }

export class Panel {
  readonly el: HTMLElement;
  readonly head: HTMLElement;
  readonly body: HTMLElement;
  readonly foot: HTMLElement;
  isOpen = false;
  private openedAt = 0;
  onClose: (() => void) | null = null;
  private closeBtn: HTMLButtonElement;
  private box: HTMLElement;
  private lastFocus: Element | null = null;

  constructor(parent: HTMLElement, cls: string, label: string) {
    const scrim = h('div', 'dr-scrim');
    this.head = h('div', 'dr-panel-head');
    this.closeBtn = btn('dr-iconbtn dr-panel-close', 'Fermer', icon('close'));
    this.body = h('div', 'dr-panel-body');
    this.foot = h('div', 'dr-panel-foot');
    const top = h('div', 'dr-panel-top', this.head, this.closeBtn);
    const grab = h('i', 'dr-panel-grab');
    grab.setAttribute('aria-hidden', 'true');
    const box = h('section', `dr-panel ${cls}`, grab, top, this.body, this.foot);
    box.tabIndex = -1;
    this.box = box;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', label);
    this.el = h('div', 'dr-modal', scrim, box);
    this.el.hidden = true;
    // Ignore le clic fantôme du toucher qui vient d'ouvrir le panneau sur mobile.
    scrim.addEventListener('click', () => { if (performance.now() - this.openedAt > 400) this.close(); });
    this.closeBtn.addEventListener('click', () => this.close());
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
    parent.append(this.el);
    // Tirer vers le bas pour fermer : depuis l'en-tête à tout moment, depuis le corps quand la liste est tout en haut.
    drag(box, {
      axis: 'y',
      canStart: ({ target, dy }) => {
        if (dy < 0 || target.closest('input, .dr-cam')) return false;
        if (target.closest('.dr-panel-foot')) return false;
        const sc = target.closest('.dr-panel-body');
        return !sc || sc.scrollTop <= 0;
      },
      move: (d) => {
        box.classList.add('is-dragging');
        box.style.transform = `translateY(${d > 0 ? d : rubber(d, 24)}px)`;
        scrim.style.opacity = String(Math.max(0.25, 1 - Math.max(0, d) / 520));
      },
      end: (d, v, cancelled) => {
        box.classList.remove('is-dragging');
        scrim.style.opacity = '';
        if (!cancelled && (d > 120 || (v > 0.55 && d > 24))) this.close();
        else box.style.transform = '';
      },
    });
  }
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.openedAt = performance.now();
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
    this.el.classList.remove('is-closing');
    this.box.style.transform = '';
    this.lastFocus = document.activeElement;
    this.el.hidden = false;
    this.body.scrollTop = 0;
    this.box.focus({ preventScroll: true }); // le lecteur d'écran annonce le panneau, sans anneau de focus sur un bouton
    try { sound?.('open'); } catch { /* le son ne doit jamais gêner l'interface */ }
  }
  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    // Sortie courte vers le bas, depuis l'endroit où le doigt a lâché le panneau.
    const from = this.box.style.transform;
    if (reducedMotion()) { this.el.hidden = true; this.box.style.transform = ''; }
    else {
      this.box.style.setProperty('--from', from && from !== 'none' ? from : 'translateY(0)');
      this.el.classList.add('is-closing');
      this.hideTimer = setTimeout(() => { this.hideTimer = null; this.el.hidden = true; this.el.classList.remove('is-closing'); this.box.style.transform = ''; }, 170);
    }
    if (this.lastFocus instanceof HTMLElement && this.lastFocus.isConnected) this.lastFocus.focus({ preventScroll: true });
    try { sound?.('close'); } catch { /* voir open */ }
    this.onClose?.();
  }
}
