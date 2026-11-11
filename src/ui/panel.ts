// Feuille haute réutilisable (abri, colis, porteur) : voile, en-tête avec bouton fermer, corps défilant, pied fixe.
import { btn, h } from './dom';
import { icon } from './icons';

export class Panel {
  readonly el: HTMLElement;
  readonly head: HTMLElement;
  readonly body: HTMLElement;
  readonly foot: HTMLElement;
  isOpen = false;
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
    const box = h('section', `dr-panel ${cls}`, h('div', 'dr-panel-top', this.head, this.closeBtn), this.body, this.foot);
    box.tabIndex = -1;
    this.box = box;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', label);
    this.el = h('div', 'dr-modal', scrim, box);
    this.el.hidden = true;
    scrim.addEventListener('click', () => this.close());
    this.closeBtn.addEventListener('click', () => this.close());
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
    parent.append(this.el);
  }
  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.lastFocus = document.activeElement;
    this.el.hidden = false;
    this.body.scrollTop = 0;
    this.box.focus({ preventScroll: true }); // le lecteur d'écran annonce le panneau, sans anneau de focus sur un bouton
  }
  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.hidden = true;
    if (this.lastFocus instanceof HTMLElement && this.lastFocus.isConnected) this.lastFocus.focus({ preventScroll: true });
    this.onClose?.();
  }
}
