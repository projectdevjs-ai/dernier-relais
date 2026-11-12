// Confirmation « passager » : quand le jeu détecte une vitesse de véhicule, il ne bride pas le joueur,
// il lui demande simplement de confirmer qu'il ne conduit pas.
import type { Ctx } from './ctx';
import { btn, h } from './dom';
import { icon } from './icons';
import { Panel } from './panel';

export class PassengerPrompt {
  readonly panel: Panel;
  constructor(parent: HTMLElement, private ctx: Ctx) {
    this.panel = new Panel(parent, 'dr-panel-auto dr-passenger', 'Tu vas vite');
    this.panel.head.append(h('span', 'dr-kicker', 'Sécurité'), h('h2', 'dr-title', 'Tu vas vite'));
    this.panel.body.append(
      h('p', 'dr-pseudo-txt', 'Tu te déplaces plus vite qu’un porteur à pied. Ne joue jamais en conduisant.'),
      h('p', 'dr-hint', 'Passager, tu peux continuer à scanner, ramasser et livrer. Seule la distance de marche ne compte pas en véhicule.'));
    const yes = btn('dr-btn dr-btn-take dr-btn-wide', null, icon('check'), h('span', '', 'Je suis passager'));
    yes.addEventListener('click', () => {
      const r = this.ctx.events.actions.confirmPassenger?.();
      this.ctx.ui(r && r.ok ? 'confirm' : 'tap');
      this.panel.close();
    });
    const no = btn('dr-btn dr-btn-wide', null, h('span', '', 'Je conduis : mettre en pause'));
    no.addEventListener('click', () => { this.ctx.ui('tap'); this.panel.close(); });
    this.panel.foot.append(yes, no);
  }
  open(): void { if (!this.panel.isOpen) this.panel.open(); }
  close(): void { if (this.panel.isOpen) this.panel.close(); }
}
