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
  private speTag = h('span', 'dr-tag dr-tag-gold', icon('special'), 'Colis spécial');
  private lostTxt = h('span', '');
  private lostTag = h('span', 'dr-tag dr-tag-blue', icon('heart'), this.lostTxt);
  private jamTag = h('span', 'dr-tag dr-tag-line', icon('stack'), 'Colis groupé');
  private strapTag = h('span', 'dr-tag dr-tag-good', icon('strap'), 'Bien arrimé');
  private relayTag = h('span', 'dr-tag dr-tag-blue', icon('relay'), 'Relais');
  private rule = h('p', 'dr-rule');
  private listen: HTMLButtonElement;
  private listenTxt = h('span', '');
  private listening = false;
  private look = '';
  private wt = cell('weight', 'Poids');
  private cond = cell('shield', 'État');
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
    this.panel.head.classList.add('dr-order-head');
    this.panel.head.append(this.art, this.crate, this.name);
    this.destBtn = btn('dr-dest', null, icon('pin'), h('span', 'dr-dest-txt', h('span', 'dr-cell-label', 'Destinataire'), this.dest), this.destDist);
    this.destBtn.addEventListener('click', () => { if (this.destId) ctx.openShelter(this.destId); });
    // Écouter le colis : facultatif, une seconde, sans quitter la fiche.
    this.listen = btn('dr-btn dr-btn-line dr-listen', null, icon('ear'), this.listenTxt);
    this.listen.addEventListener('click', () => {
      const id = this.id;
      if (!id || this.listening) return;
      this.listening = true;
      this.listen.classList.add('is-on');
      setText(this.listenTxt, 'Tu écoutes…');
      setTimeout(() => {
        this.listening = false;
        this.listen.classList.remove('is-on');
        // Ramassé entre-temps : il n'y a plus rien à écouter au sol.
        if (this.id === id && this.state !== 'porté') ctx.run(ctx.events.actions.inspect(id));
      }, 900);
    });
    this.panel.body.append(
      h('div', 'dr-tags', this.speTag, this.relayTag, this.lostTag, this.jamTag, this.frag, this.strapTag),
      this.rule,
      h('div', 'dr-cells', this.wt.el, this.reward.el, this.delay.el, this.cond.el),
      this.destBtn,
      this.listen);
    this.act = btn('dr-btn dr-btn-wide', null, this.actIcon, this.actText);
    this.act.addEventListener('click', () => {
      if (!this.id) return;
      const id = this.id;
      if (this.state === 'porté') { if (ctx.run(ctx.events.actions.drop(id))) this.panel.close(); return; }
      // Ramasser : la fiche se referme et la séquence de ramassage prend tout l'écran.
      this.panel.close();
      ctx.pickup(id);
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
    setText(this.crate, o.special && !o.special.known ? 'Colis scellé' : CRATE[o.crate]);
    setText(this.name, o.name);
    const sp = o.special ?? null, known = o.inspected !== false;
    const look = sp ? 'special' : o.lost || o.relay ? 'lost' : 'crate';
    if (this.look !== look) { this.look = look; this.art.dataset.look = look; this.art.replaceChildren(icon(sp ? 'special' : o.lost ? 'heart' : o.relay ? 'relay' : 'crate')); }
    show(this.frag, o.fragile && known);
    show(this.speTag, !!sp);
    show(this.lostTag, !!o.lost);
    if (o.lost) setText(this.lostTxt, `Perdu par ${o.lost.by}`);
    show(this.jamTag, !!o.jamId);
    show(this.relayTag, !!o.relay);
    show(this.strapTag, carried && (o.strap ?? 0) >= 1);
    const rule = sp ? (sp.known ? sp.rule : 'Le scanner ne reconnaît pas ce colis. Écoute-le, ou prends-le pour voir.') : o.lost ? 'Ramène-le à son abri : récompense de solidarité.'
      : o.relay ? 'Colis de relais : livre-le, ou redépose-le dans un abri plus près du but. Toute la chaîne est récompensée.' : '';
    setText(this.rule, rule); show(this.rule, rule !== '');
    setAttr(this.rule, 'data-look', look);
    setText(this.wt.val, sp && !sp.known ? '?' : fmtKg(o.weightKg));
    // Écoute : proposée tant que le contenu est inconnu et le colis au sol.
    show(this.listen, !carried && !known);
    if (!carried && !known && !this.listening) {
      setDisabled(this.listen, !o.canInspect);
      setText(this.listenTxt, o.canInspect ? 'Écouter le colis' : 'Approche-toi pour l’écouter');
    }
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
    // Un colis de relais ne se pose pas par terre : il se livre ou se redépose dans un abri.
    const held = carried && !!o.relay;
    setDisabled(this.act, held || (!carried && !o.inRange));
    setText(this.actText, held ? 'À déposer dans un abri' : carried ? 'Poser' : o.inRange ? (o.dropped ? 'Reprendre' : 'Ramasser') : `Approche-toi : ${fmtDist(o.distanceM)}`);
  }
}
