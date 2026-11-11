// Fiche de colis : ce que c'est, pour qui, et le bouton Ramasser ou Poser.
import type { CrateKind, GameView } from '../game/api';
import type { Ctx } from './ctx';
import { btn, condTone, delayTone, distM, fmtDelay, fmtDist, fmtInt, fmtKg, fmtPct, h, setAttr, setDisabled, setText, show } from './dom';
import { icon, type IconName } from './icons';
import { Panel } from './panel';
import { setTone } from './sheet';

const CRATE: Record<CrateKind, string> = { bois: 'Caisse en bois', alu: 'Caisse en aluminium', plastique: 'Bac plastique', carton: 'Carton' };

/** Case « icône, libellé, valeur » de la fiche. */
function cell(ic: IconName, label: string): { el: HTMLElement; val: HTMLElement } {
  const val = h('span', 'dr-cell-val');
  return { el: h('div', 'dr-cell', icon(ic), h('span', 'dr-cell-txt', h('span', 'dr-cell-label', label), val)), val };
}

export class OrderPanel {
  id: string | null = null;
  readonly panel: Panel;
  private crate = h('span', 'dr-kicker');
  private name = h('h2', 'dr-title');
  private art = h('span', 'dr-crate-art');
  private frag = h('span', 'dr-tag dr-tag-warn', icon('fragile'), 'Fragile');
  private wt = cell('weight', 'Poids');
  private cond = cell('crate', 'État');
  private delay = cell('clock', 'Délai');
  private reward = cell('star', 'Récompense');
  private dest = h('span', 'dr-dest-name');
  private destDist = h('span', 'dr-dest-dist');
  private destBtn: HTMLButtonElement;
  private act: HTMLButtonElement;
  private actIcon = h('span', 'dr-btn-ic');
  private actText = h('span', '');
  private state = '';
  private destId = '';

  constructor(parent: HTMLElement, ctx: Ctx) {
    this.panel = new Panel(parent, 'dr-panel-auto', 'Colis');
    this.panel.head.append(this.crate, this.name);
    this.destBtn = btn('dr-dest', null, icon('pin'), h('span', 'dr-dest-txt', h('span', 'dr-cell-label', 'Destinataire'), this.dest), this.destDist);
    this.destBtn.addEventListener('click', () => { if (this.destId) ctx.openShelter(this.destId); });
    this.panel.body.append(
      h('div', 'dr-order-hero', this.art, this.frag),
      h('div', 'dr-cells', this.wt.el, this.reward.el, this.delay.el, this.cond.el),
      this.destBtn);
    this.act = btn('dr-btn dr-btn-wide', null, this.actIcon, this.actText);
    this.act.addEventListener('click', () => {
      if (!this.id) return;
      const a = ctx.events.actions;
      if (ctx.run(this.state === 'porté' ? a.drop(this.id) : a.pickup(this.id)) && this.state === 'porté') this.panel.close();
    });
    this.panel.foot.append(this.act);
    this.panel.onClose = () => { this.id = null; };
  }

  open(id: string, v: GameView | null): void {
    this.id = id;
    if (v) this.render(v);
    if (this.id) this.panel.open();
  }

  render(v: GameView): void {
    if (!this.id) return;
    const o = v.orders.find((x) => x.id === this.id);
    if (!o) { this.panel.close(); this.id = null; return; } // livré, posé hors de vue ou perdu
    const carried = o.state === 'porté';
    setText(this.crate, CRATE[o.crate]);
    setText(this.name, o.name);
    if (this.art.dataset.crate !== o.crate) { this.art.dataset.crate = o.crate; this.art.replaceChildren(icon('crate')); }
    show(this.frag, o.fragile);
    setText(this.wt.val, fmtKg(o.weightKg));
    setText(this.reward.val, `${fmtInt(o.reward)} pts`);
    setText(this.delay.val, fmtDelay(o.minutesLeft)); setTone(this.delay.el, delayTone(o.minutesLeft));
    show(this.cond.el, carried);
    if (carried) { setText(this.cond.val, fmtPct(o.condition)); setTone(this.cond.el, condTone(o.condition)); }
    this.destId = o.destId;
    setText(this.dest, o.destName);
    const toDest = carried ? o.distanceM : v.player.at ? distM(v.player.at, o.destAt) : null;
    setText(this.destDist, toDest === null ? '' : fmtDist(toDest));
    setAttr(this.destBtn, 'aria-label', `Destinataire : ${o.destName}. Voir l’abri`);

    if (this.state !== o.state) {
      this.state = o.state;
      this.actIcon.replaceChildren(icon(carried ? 'drop' : 'pickup'));
      this.act.classList.toggle('dr-btn-take', !carried);
    }
    setDisabled(this.act, !carried && !o.inRange);
    setText(this.actText, carried ? 'Poser' : o.inRange ? 'Ramasser' : `Approche-toi : ${fmtDist(o.distanceM)}`);
  }
}
