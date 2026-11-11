// Panneau d'abri : le lieu, ses étoiles, la personne qui le tient et ce qu'on peut y livrer.
import type { GameView, NpcId, OrderView, ShelterView } from '../game/api';
import type { Ctx } from './ctx';
import { KeyedList, btn, condTone, delayTone, fmtDelay, fmtDist, fmtInt, fmtKg, fmtPct, h, setAttr, setDisabled, setText, setVar, show, type Row } from './dom';
import { icon } from './icons';
import { Panel } from './panel';
import { kindLabel, meta, setTone } from './sheet';

export const NPC: Record<NpcId, { name: string; color: string }> = {
  mara: { name: 'Mara', color: '#e58f7b' },
  tomas: { name: 'Tomas', color: '#e8b45a' },
  agathe: { name: 'Agathe', color: '#9ccf7a' },
  kenji: { name: 'Kenji', color: '#9aa6f0' },
};

/** Rangée de cinq étoiles. `set(n)` remplit les n premières. */
export function starRow(cls = ''): { el: HTMLElement; set(n: number): void; stars: SVGSVGElement[] } {
  const stars = [0, 1, 2, 3, 4].map(() => icon('star', 'dr-star'));
  const el = h('span', `dr-stars ${cls}`, ...stars);
  el.setAttribute('role', 'img');
  let cur = -1;
  return {
    el, stars,
    set(n) {
      if (n === cur) return;
      cur = n;
      stars.forEach((s, i) => s.classList.toggle('is-on', i < n));
      el.setAttribute('aria-label', `${n} étoile${n > 1 ? 's' : ''} sur 5`);
    },
  };
}

/** Portrait stylisé : buste en aplat de la couleur du PNJ, initiale en médaillon. */
function portrait(): { el: HTMLElement; set(npc: NpcId, known: boolean): void } {
  const badge = h('span', 'dr-npc-badge');
  const el = h('span', 'dr-npc-portrait');
  el.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="24" r="11" fill="currentColor"/><path d="M10 64c0-14 9.5-23 22-23s22 9 22 23z" fill="currentColor"/><path d="M21 22c1-8 6-12 12-12s10 4 11 11c-5 0-9-2-12-6-2 4-6 6-11 7z" fill="rgba(0,0,0,.28)"/></svg>';
  el.append(badge);
  let key = '';
  return {
    el,
    set(npc, known) {
      const k = `${npc}${known}`;
      if (k === key) return;
      key = k;
      el.classList.toggle('is-unknown', !known);
      setVar(el, '--npc', known ? NPC[npc].color : '');
      setText(badge, known ? NPC[npc].name[0] : '?');
    },
  };
}

export class ShelterPanel {
  id: string | null = null;
  readonly panel: Panel;
  private kind = h('span', 'dr-kicker');
  private name = h('h2', 'dr-title');
  private stars = starRow('dr-stars-lg');
  private dist = meta('route');
  private bar = h('span', 'dr-bar-fill');
  private pts = h('span', 'dr-prog-pts');
  private unlock = h('span', 'dr-prog-unlock');
  private unlockRow: HTMLElement;
  private prog: HTMLElement;
  private portrait = portrait();
  private npcName = h('span', 'dr-npc-name');
  private line = h('p', 'dr-npc-line');
  private list: KeyedList<OrderView>;
  private empty = h('p', 'dr-empty', 'Rien à livrer ici pour l’instant.');
  private secSide = h('span', 'dr-sec-side');
  private cta: HTMLButtonElement;
  private ctaText = h('span', '');

  constructor(parent: HTMLElement, private ctx: Ctx) {
    this.panel = new Panel(parent, 'dr-panel-auto', 'Abri');
    this.panel.head.append(this.kind, this.name);
    this.unlockRow = h('span', 'dr-prog-row', icon('lock'), this.unlock);
    this.prog = h('div', 'dr-prog', h('div', 'dr-prog-top', h('span', 'dr-prog-label', 'Prochaine étoile'), this.pts), h('span', 'dr-bar', this.bar), this.unlockRow);
    const listEl = h('div', 'dr-list');
    this.list = new KeyedList(listEl, (o) => o.id, () => this.row());
    this.panel.body.append(
      h('div', 'dr-shel-stars', this.stars.el, this.dist.el),
      this.prog,
      h('div', 'dr-npc', this.portrait.el, h('div', 'dr-npc-txt', this.npcName, this.line)),
      h('div', 'dr-sec', h('h3', 'dr-sec-title', icon('crate'), 'À livrer ici'), this.secSide), listEl, this.empty);
    this.cta = btn('dr-btn dr-btn-go dr-btn-wide', null, icon('pin'), this.ctaText);
    this.cta.addEventListener('click', () => { if (this.id) ctx.run(ctx.events.actions.deliver(this.id)); });
    this.panel.foot.append(this.cta);
    this.panel.onClose = () => { this.id = null; };
  }

  open(id: string, v: GameView | null): void {
    this.id = id;
    if (v) this.render(v);
    if (this.id) this.panel.open();
  }

  render(v: GameView): void {
    if (!this.id) return;
    const s: ShelterView | undefined = v.shelters.find((x) => x.id === this.id);
    if (!s) { this.panel.close(); this.id = null; return; }
    const known = s.stars > 0;
    setText(this.kind, kindLabel(s.kind));
    setText(this.name, s.name);
    this.stars.set(s.stars);
    setText(this.dist.val, s.inRange ? 'Sur place' : fmtDist(s.distanceM));
    setTone(this.dist.el, s.inRange ? 'good' : '');

    if (s.nextStarAt === null) {
      setText(this.pts, `${fmtInt(s.points)} pts`);
      setVar(this.bar, '--p', '1');
      setText(this.unlock, 'Abri entièrement reconstruit');
      this.prog.classList.add('is-max');
    } else {
      this.prog.classList.remove('is-max');
      setText(this.pts, `${fmtInt(s.points)} / ${fmtInt(s.nextStarAt)}`);
      setVar(this.bar, '--p', String(Math.max(0, Math.min(1, s.points / s.nextStarAt))));
      setText(this.unlock, s.nextUnlock ?? '');
    }
    show(this.unlockRow, this.unlock.textContent !== '');

    this.portrait.set(s.npc, known);
    setText(this.npcName, known ? NPC[s.npc].name : 'Quelqu’un t’observe');
    setText(this.line, known ? s.line : 'Livre un premier colis ici pour faire connaissance.');

    const orders = s.deliverable.map((id) => v.orders.find((o) => o.id === id)).filter((o): o is OrderView => !!o);
    this.list.sync(orders);
    show(this.empty, orders.length === 0);
    setText(this.secSide, orders.length ? String(orders.length) : '');
    show(this.cta, orders.length > 0);
    setDisabled(this.cta, !s.inRange);
    setText(this.ctaText, s.inRange ? (orders.length > 1 ? `Livrer ${orders.length} colis` : 'Livrer') : `Encore ${fmtDist(s.distanceM)}`);
    setAttr(this.panel.foot, 'data-empty', orders.length ? '0' : '1');
  }

  private row(): Row<OrderView> {
    const name = h('span', 'dr-row-name');
    const frag = h('span', 'dr-row-frag', icon('fragile'));
    const w = meta('weight'), c = meta('crate'), d = meta('clock');
    const info = btn('dr-row-info', null, h('span', 'dr-row-l1', name, frag), h('span', 'dr-row-l3', w.el, c.el, d.el));
    const el = h('div', 'dr-row', info, h('span', 'dr-row-go', icon('arrow')));
    el.dataset.state = 'porte';
    let id = '';
    info.addEventListener('click', () => this.ctx.openOrder(id));
    return {
      el,
      update(o) {
        id = o.id;
        setText(name, o.name);
        show(frag, o.fragile);
        setText(w.val, fmtKg(o.weightKg));
        setText(c.val, fmtPct(o.condition)); setTone(c.el, condTone(o.condition));
        show(d.el, o.minutesLeft !== null);
        if (o.minutesLeft !== null) { setText(d.val, fmtDelay(o.minutesLeft)); setTone(d.el, delayTone(o.minutesLeft)); }
        setAttr(info, 'aria-label', `${o.name}. Voir la fiche`);
      },
    };
  }
}
