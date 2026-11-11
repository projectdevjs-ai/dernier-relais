// La fiche du bas, unique. Repliée : une ligne, « la prochaine chose à faire ».
// Dépliée : le sac et les colis repérés à proximité.
import type { GameView, OrderView, ShelterView } from '../game/api';
import type { Ctx } from './ctx';
import { KeyedList, btn, condTone, delayTone, fmtDelay, fmtDist, fmtKg, fmtPct, h, setAttr, setDisabled, setText, show, type Row } from './dom';
import { icon, type IconName } from './icons';

const KIND_LABEL: Record<string, string> = {
  mairie: 'Mairie', soin: 'Lieu de soin', vivres: 'Vivres', savoir: 'Lieu de savoir', culte: 'Lieu de culte',
  nature: 'Refuge nature', poste: 'Poste', halte: 'Halte', hameau: 'Hameau', carrefour: 'Carrefour',
};
export function kindLabel(kind: string): string { return KIND_LABEL[kind] ?? 'Abri'; }

/** Petite mesure « icône + valeur » réutilisée dans les lignes de colis. */
export function meta(ic: IconName, cls = ''): { el: HTMLElement; val: HTMLElement } {
  const val = h('span', 'dr-meta-val');
  return { el: h('span', `dr-meta ${cls}`, icon(ic), val), val };
}
export function setTone(el: HTMLElement, tone: string): void { setAttr(el, 'data-tone', tone); }

type Next =
  | { kind: 'carry'; o: OrderView }
  | { kind: 'reveal'; o: OrderView }
  | { kind: 'shelter'; s: ShelterView }
  | { kind: 'scan' };

/** Colis porté le plus urgent : délai le plus court d'abord, puis le plus proche. */
function urgency(a: OrderView, b: OrderView): number {
  const ma = a.minutesLeft ?? Infinity, mb = b.minutesLeft ?? Infinity;
  return ma !== mb ? ma - mb : a.distanceM - b.distanceM;
}

export class Sheet {
  readonly el: HTMLElement;
  expanded = false;
  private cta: HTMLButtonElement; private ctaName: HTMLElement; private ctaCount: HTMLElement;
  private next: HTMLButtonElement; private nextIcon: HTMLElement; private nextTitle: HTMLElement; private nextSub: HTMLElement;
  private nextDist: HTMLElement; private nextDelay: HTMLElement;
  private toggle: HTMLButtonElement;
  private more: HTMLElement;
  private bagLoad: HTMLElement; private bagEmpty: HTMLElement; private nearEmpty: HTMLElement;
  private bag: KeyedList<OrderView>; private near: KeyedList<OrderView>;
  private target: Next = { kind: 'scan' };
  private deliverId: string | null = null;
  private iconKind = '';
  private last: GameView | null = null;

  constructor(parent: HTMLElement, private ctx: Ctx) {
    // Ligne repliée
    this.ctaName = h('span', 'dr-cta-name');
    this.ctaCount = h('span', 'dr-cta-count');
    this.cta = btn('dr-btn dr-btn-go dr-sheet-cta', null, icon('pin'), h('span', 'dr-cta-text', h('span', 'dr-cta-verb', 'Livrer'), this.ctaName), this.ctaCount);
    this.cta.hidden = true;
    this.cta.addEventListener('click', () => { if (this.deliverId) ctx.run(ctx.events.actions.deliver(this.deliverId)); });

    this.nextIcon = h('span', 'dr-next-ic');
    this.nextTitle = h('span', 'dr-next-title');
    this.nextSub = h('span', 'dr-next-sub');
    this.nextDist = h('span', 'dr-next-dist');
    this.nextDelay = h('span', 'dr-next-delay');
    this.next = btn('dr-next', null, this.nextIcon, h('span', 'dr-next-txt', this.nextTitle, this.nextSub), h('span', 'dr-next-num', this.nextDist, this.nextDelay));
    this.next.addEventListener('click', () => {
      const t = this.target;
      if (t.kind === 'carry' || t.kind === 'reveal') ctx.openOrder(t.o.id);
      else if (t.kind === 'shelter') ctx.openShelter(t.s.id);
      else this.setExpanded(!this.expanded);
    });

    this.toggle = btn('dr-iconbtn dr-sheet-toggle', 'Ouvrir le sac', icon('up'));
    this.toggle.setAttribute('aria-expanded', 'false');
    this.toggle.addEventListener('click', () => this.setExpanded(!this.expanded));

    // Partie dépliée
    this.bagLoad = h('span', 'dr-sec-side');
    this.bagEmpty = h('p', 'dr-empty', 'Ton sac est vide.');
    this.nearEmpty = h('p', 'dr-empty', 'Aucun colis repéré. Lance le scanner.');
    const bagList = h('div', 'dr-list'), nearList = h('div', 'dr-list');
    this.bag = new KeyedList(bagList, (o) => o.id, (o) => this.row(o));
    this.near = new KeyedList(nearList, (o) => o.id, (o) => this.row(o));
    this.more = h('div', 'dr-sheet-more',
      h('div', 'dr-sec', h('h3', 'dr-sec-title', icon('bag'), 'Sac'), this.bagLoad), bagList, this.bagEmpty,
      h('div', 'dr-sec', h('h3', 'dr-sec-title', icon('scan'), 'Repérés près de toi')), nearList, this.nearEmpty);
    this.more.hidden = true;

    this.el = h('section', 'dr-sheet', h('div', 'dr-sheet-bar', this.cta, this.next, this.toggle), this.more);
    this.el.setAttribute('aria-label', 'Prochaine étape et sac');
    parent.append(this.el);
  }

  setExpanded(on: boolean): void {
    this.expanded = on;
    this.more.hidden = !on;
    this.el.classList.toggle('is-open', on);
    this.el.parentElement?.classList.toggle('dr-sheet-open', on);
    this.toggle.setAttribute('aria-expanded', String(on));
    this.toggle.setAttribute('aria-label', on ? 'Replier le sac' : 'Ouvrir le sac');
    if (on && this.last) this.render(this.last);
  }

  render(v: GameView): void {
    this.last = v;
    const carried = v.orders.filter((o) => o.state === 'porté').sort(urgency);
    const revealed = v.orders.filter((o) => o.state === 'révélé').sort((a, b) => a.distanceM - b.distanceM);

    // Livraison possible tout de suite : le gros bouton passe devant tout le reste.
    const here = v.shelters.filter((s) => s.inRange && s.deliverable.length > 0).sort((a, b) => a.distanceM - b.distanceM)[0];
    this.deliverId = here ? here.id : null;
    show(this.cta, !!here);
    show(this.next, !here);
    if (here) {
      setText(this.ctaName, `à ${here.name}`);
      setText(this.ctaCount, String(here.deliverable.length));
      setAttr(this.cta, 'aria-label', `Livrer ${here.deliverable.length} colis à ${here.name}`);
    } else {
      const nearestShelter = [...v.shelters].sort((a, b) => a.distanceM - b.distanceM)[0];
      const t: Next = carried[0] ? { kind: 'carry', o: carried[0] } : revealed[0] ? { kind: 'reveal', o: revealed[0] }
        : nearestShelter ? { kind: 'shelter', s: nearestShelter } : { kind: 'scan' };
      this.target = t;
      if (this.iconKind !== t.kind) {
        this.iconKind = t.kind;
        const ic: IconName = t.kind === 'carry' ? 'pin' : t.kind === 'reveal' ? 'crate' : t.kind === 'shelter' ? 'shelter' : 'scan';
        this.nextIcon.replaceChildren(icon(ic));
        setAttr(this.next, 'data-kind', t.kind);
      }
      if (t.kind === 'carry') {
        setText(this.nextTitle, t.o.destName); setText(this.nextSub, `Livre : ${t.o.name}`);
        setText(this.nextDist, fmtDist(t.o.distanceM));
        setText(this.nextDelay, t.o.minutesLeft === null ? '' : fmtDelay(t.o.minutesLeft));
        setTone(this.nextDelay, delayTone(t.o.minutesLeft));
      } else if (t.kind === 'reveal') {
        setText(this.nextTitle, t.o.name); setText(this.nextSub, t.o.inRange ? 'À portée : ramasse-le' : 'Colis à ramasser');
        setText(this.nextDist, fmtDist(t.o.distanceM)); setText(this.nextDelay, '');
      } else if (t.kind === 'shelter') {
        setText(this.nextTitle, t.s.name); setText(this.nextSub, 'Abri le plus proche');
        setText(this.nextDist, fmtDist(t.s.distanceM)); setText(this.nextDelay, '');
      } else {
        setText(this.nextTitle, 'Scanne pour trouver des colis'); setText(this.nextSub, '');
        setText(this.nextDist, ''); setText(this.nextDelay, '');
      }
      show(this.nextSub, this.nextSub.textContent !== '');
      show(this.nextDelay, this.nextDelay.textContent !== '');
    }

    if (!this.expanded) return;
    setText(this.bagLoad, `${fmtKg(v.player.carriedKg)} sur ${fmtKg(v.player.capacityKg)}`);
    this.bag.sync(carried);
    this.near.sync(revealed.slice(0, 6));
    show(this.bagEmpty, carried.length === 0);
    show(this.nearEmpty, revealed.length === 0);
  }

  /** Ligne de colis : la zone de gauche ouvre la fiche, le bouton de droite agit. */
  private row(first: OrderView): Row<OrderView> {
    const { ctx } = this;
    const id = first.id;
    const name = h('span', 'dr-row-name');
    const dest = h('span', 'dr-row-dest');
    const frag = h('span', 'dr-row-frag', icon('fragile'));
    frag.title = 'Fragile';
    const w = meta('weight'), c = meta('shield'), d = meta('clock'), far = meta('route');
    const info = btn('dr-row-info', null,
      h('span', 'dr-row-l1', name, frag),
      h('span', 'dr-row-l2', icon('pin'), dest),
      h('span', 'dr-row-l3', w.el, c.el, d.el, far.el));
    const actLabel = h('span', '');
    const act = btn('dr-btn dr-btn-sm', null, actLabel);
    const el = h('div', 'dr-row', info, act);
    let state = '';
    info.addEventListener('click', () => ctx.openOrder(id));
    act.addEventListener('click', () => {
      ctx.run(state === 'porté' ? ctx.events.actions.drop(id) : ctx.events.actions.pickup(id));
    });
    return {
      el,
      update(o) {
        if (state !== o.state) {
          state = o.state;
          setText(actLabel, o.state === 'porté' ? 'Poser' : 'Ramasser');
          act.classList.toggle('dr-btn-take', o.state === 'révélé');
          setAttr(el, 'data-state', o.state === 'porté' ? 'porte' : 'revele');
        }
        setText(name, o.name);
        setText(dest, o.destName);
        show(frag, o.fragile);
        setText(w.val, fmtKg(o.weightKg));
        const carried = o.state === 'porté';
        show(c.el, carried);
        if (carried) { setText(c.val, fmtPct(o.condition)); setTone(c.el, condTone(o.condition)); }
        show(far.el, !carried); // dans le sac, la distance est déjà sur la ligne repliée et la fiche
        if (!carried) setText(far.val, fmtDist(o.distanceM));
        show(d.el, o.minutesLeft !== null);
        if (o.minutesLeft !== null) { setText(d.val, fmtDelay(o.minutesLeft)); setTone(d.el, delayTone(o.minutesLeft)); }
        setDisabled(act, !carried && !o.inRange);
        setAttr(info, 'aria-label', `${o.name}, pour ${o.destName}. Voir la fiche`);
        setAttr(act, 'aria-label', `${carried ? 'Poser' : 'Ramasser'} ${o.name}`);
      },
    };
  }
}
