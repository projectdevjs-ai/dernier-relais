// Aide de première ouverture : quatre bulles très courtes, mémorisées, rejouables depuis les réglages.
import { btn, h } from './dom';
import { icon, type IconName } from './icons';

const KEY = 'dernier-relais.aide.v1';
const STEPS: { ic: IconName; title: string; text: string; point: 'scan' | 'sheet' }[] = [
  { ic: 'scan', title: 'Scanne', text: 'Le bouton rond révèle les colis autour de toi.', point: 'scan' },
  { ic: 'crate', title: 'Ramasse', text: 'Marche jusqu’à un colis. Écoute-le pour savoir s’il est fragile, puis touche Ramasser et serre la sangle.', point: 'sheet' },
  { ic: 'pin', title: 'Livre', text: 'Porte-le à son abri. Plus il arrive intact et vite, meilleure est la note.', point: 'sheet' },
  { ic: 'relay', title: 'Relaie', text: 'Trop loin ? Laisse-le en relais dans un abri sur la route : un autre porteur finira le trajet.', point: 'sheet' },
];

function seen(): boolean { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } }
function remember(): void { try { localStorage.setItem(KEY, '1'); } catch { /* stockage indisponible : tant pis */ } }

export class Help {
  private el: HTMLElement;
  private i = 0;
  constructor(parent: HTMLElement) {
    this.el = h('div', 'dr-help');
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Aide');
    parent.append(this.el);
  }
  /** Montre l'aide si elle n'a jamais été vue. */
  auto(): void { if (!seen()) this.start(); }
  start(): void { this.i = 0; this.draw(); }
  private draw(): void {
    const s = STEPS[this.i];
    if (!s) { this.el.hidden = true; remember(); return; }
    const last = this.i === STEPS.length - 1;
    const next = btn('dr-btn dr-btn-sm dr-btn-take', null, last ? 'C’est parti' : 'Suivant');
    next.addEventListener('click', () => { this.i++; this.draw(); });
    const skip = btn('dr-help-skip', null, 'Passer');
    skip.addEventListener('click', () => { this.i = STEPS.length; this.draw(); });
    const dots = h('span', 'dr-help-dots', ...STEPS.map((_, k) => h('i', k === this.i ? 'is-on' : '')));
    dots.setAttribute('aria-label', `Étape ${this.i + 1} sur ${STEPS.length}`);
    dots.setAttribute('role', 'img');
    this.el.dataset.point = s.point;
    this.el.replaceChildren(
      h('div', 'dr-help-top', h('span', 'dr-help-ic', icon(s.ic)), h('strong', 'dr-help-title', s.title), dots),
      h('p', 'dr-help-text', s.text),
      h('div', 'dr-help-acts', last ? null : skip, next));
    this.el.hidden = false;
  }
}
