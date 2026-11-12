// Choix du nom de porteur : petite feuille avec un champ, proposée à la première ouverture de la carte du réseau
// et depuis les réglages. Un nom généré est déjà en place : le joueur peut le garder tel quel.
import type { Ctx } from './ctx';
import { btn, h, setDisabled, setText } from './dom';
import { icon } from './icons';
import { Panel } from './panel';

export class PseudoPrompt {
  readonly panel: Panel;
  private input = h('input', 'dr-input');
  private msg = h('p', 'dr-hint dr-pseudo-msg');
  private ok: HTMLButtonElement;
  private after: (() => void) | null = null;

  constructor(parent: HTMLElement, private ctx: Ctx) {
    this.panel = new Panel(parent, 'dr-panel-auto dr-pseudo', 'Ton nom de porteur');
    this.panel.head.append(h('span', 'dr-kicker', 'Réseau des porteurs'), h('h2', 'dr-title', 'Ton nom de porteur'));
    this.input.type = 'text';
    this.input.maxLength = 20;
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.enterKeyHint = 'done';
    this.input.setAttribute('aria-label', 'Ton nom de porteur');
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') void this.save(); e.stopPropagation(); });
    this.msg.setAttribute('role', 'status');
    this.panel.body.append(
      h('p', 'dr-pseudo-txt', 'C’est le nom que les autres porteurs verront au classement du réseau.'),
      h('label', 'dr-field', h('span', 'dr-field-ic', icon('user')), this.input),
      this.msg);
    this.ok = btn('dr-btn dr-btn-take dr-btn-wide', null, icon('check'), h('span', '', 'Valider'));
    this.ok.addEventListener('click', () => void this.save());
    this.panel.foot.append(this.ok);
    this.panel.onClose = () => { const fn = this.after; this.after = null; fn?.(); };
  }

  /** `after` est appelé à la fermeture, que le nom ait été validé ou non. */
  open(after?: () => void): void {
    const p = this.ctx.events.pseudo;
    if (!p) { after?.(); return; }
    this.after = after ?? null;
    this.input.value = p.get();
    this.msg.classList.remove('is-bad');
    setText(this.msg, 'De 2 à 20 caractères. Tu pourras le changer dans les réglages.');
    this.panel.open();
  }

  private async save(): Promise<void> {
    const p = this.ctx.events.pseudo;
    if (!p || this.ok.disabled) return;
    setDisabled(this.ok, true);
    let ok = false;
    try { ok = await p.set(this.input.value); } catch { ok = false; }
    setDisabled(this.ok, false);
    if (!ok) {
      this.msg.classList.add('is-bad');
      setText(this.msg, 'Choisis un nom de 2 à 20 caractères.');
      this.ctx.ui('error');
      return;
    }
    this.ctx.ui('confirm');
    this.ctx.toast(`Bienvenue, ${p.get()}`, 'good');
    this.input.blur();
    this.panel.close();
  }
}
