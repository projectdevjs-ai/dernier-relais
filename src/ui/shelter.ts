// Panneau d'abri : le lieu, ses étoiles, la personne qui le tient et ce qu'on peut y livrer.
import type { CollectiveView, GameView, NpcId, OrderView, RelayGiveResult, RelayOffer, ShelterView } from '../game/api';
import type { Ctx } from './ctx';
import { KeyedList, btn, condTone, delayTone, distM, fmtDelay, fmtDist, fmtInt, fmtKg, fmtPct, h, setAttr, setDisabled, setText, setVar, show, type Row } from './dom';
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
  // Jeu en ligne : niveau collectif et chaîne de relais. Les données arrivent à l'ouverture, jamais pendant render().
  private coll: HTMLElement;
  private collTxt = h('span', 'dr-coll-txt');
  private collPts = h('span', 'dr-coll-pts');
  private collBar = h('span', 'dr-bar-fill');
  private collective: CollectiveView | null = null;
  private relaySec: HTMLElement;
  private handoffEl = h('div', 'dr-list');
  private handoffList: KeyedList<OrderView>;
  private handoffSec: HTMLElement;
  private relaySide = h('span', 'dr-sec-side');
  private relayOff = h('p', 'dr-hint', 'Les relais demandent une connexion. Tout le reste marche hors ligne.');
  private relayHint = h('p', 'dr-hint');
  private giveList: KeyedList<{ o: OrderView; s: ShelterView }>;
  private takeList: KeyedList<{ r: RelayOffer; s: ShelterView }>;
  private giveEl = h('div', 'dr-list');
  private takeEl = h('div', 'dr-list');
  private giveCap = h('p', 'dr-relay-cap', 'Dans ton sac, pour un autre abri');
  private takeCap = h('p', 'dr-relay-cap', 'En attente d’un porteur');
  private offers: RelayOffer[] = [];
  private offersFor: string | null = null;
  private loading = false;
  private busy = false;
  private wasOnline = false;
  private seq = 0;
  /** Avance calculée par le jeu pour chaque colis qu'on peut laisser ici (recalculée quand la situation change). */
  private quotes = new Map<string, { key: string; r: RelayGiveResult }>();

  constructor(parent: HTMLElement, private ctx: Ctx) {
    this.panel = new Panel(parent, 'dr-panel-auto', 'Abri');
    this.panel.head.append(this.kind, this.name);
    this.unlockRow = h('span', 'dr-prog-row', icon('lock'), this.unlock);
    this.prog = h('div', 'dr-prog', h('div', 'dr-prog-top', h('span', 'dr-prog-label', 'Prochaine étoile'), this.pts), h('span', 'dr-bar', this.bar), this.unlockRow);
    const listEl = h('div', 'dr-list');
    this.list = new KeyedList(listEl, (o) => o.id, () => this.row());
    this.coll = h('div', 'dr-coll', icon('network'), this.collTxt, h('span', 'dr-bar', this.collBar), this.collPts);
    this.coll.hidden = true;
    this.coll.setAttribute('role', 'img');
    this.handoffList = new KeyedList(this.handoffEl, (o) => o.id, () => this.handoffRow());
    this.handoffSec = h('div', 'dr-relays', h('div', 'dr-sec', h('h3', 'dr-sec-title', icon('heart'), 'Dépôt solidaire')), h('p', 'dr-hint', 'Tout colis accepté, même hors ligne. +10 réputation, sans points ni XP. Le colis quitte définitivement ton sac.'), this.handoffEl);
    this.giveList = new KeyedList(this.giveEl, (x) => x.o.id, () => this.giveRow());
    this.takeList = new KeyedList(this.takeEl, (x) => x.r.id, () => this.takeRow());
    this.relaySec = h('div', 'dr-relays',
      h('div', 'dr-sec', h('h3', 'dr-sec-title', icon('relay'), 'Relais'), this.relaySide),
      this.relayOff, this.giveCap, this.giveEl, this.takeCap, this.takeEl, this.relayHint);
    this.relaySec.hidden = true;
    this.panel.body.append(
      h('div', 'dr-shel-stars', this.stars.el, this.dist.el),
      this.coll,
      this.prog,
      h('div', 'dr-npc', this.portrait.el, h('div', 'dr-npc-txt', this.npcName, this.line)),
      h('div', 'dr-sec', h('h3', 'dr-sec-title', icon('crate'), 'À livrer ici'), this.secSide), listEl, this.empty,
      this.handoffSec, this.relaySec);
    this.cta = btn('dr-btn dr-btn-go dr-btn-wide', null, icon('pin'), this.ctaText);
    this.cta.addEventListener('click', () => { if (this.id) ctx.run(ctx.events.actions.deliver(this.id)); });
    this.panel.foot.append(this.cta);
    this.panel.onClose = () => { this.id = null; this.seq++; };
  }

  open(id: string, v: GameView | null): void {
    if (this.id !== id) { this.collective = null; this.offers = []; this.offersFor = null; this.quotes.clear(); }
    this.id = id;
    this.loadOnline();
    if (v) this.render(v);
    if (this.id) this.panel.open();
  }

  /** Relit le niveau collectif et les relais de l'abri ouvert (ouverture, retour du réseau, dépôt, prise). */
  loadOnline(): void {
    const net = this.ctx.events.online, id = this.id;
    if (!net || !id) return;
    const seq = ++this.seq;
    this.wasOnline = net.isOnline();
    if (!this.wasOnline) { this.collective = null; this.loading = false; return; }
    this.loading = this.offersFor !== id;
    net.shelterLevel(id).then((c) => { if (seq === this.seq) this.collective = c; }).catch(() => { /* ligne masquée */ });
    net.relaysAt(id).then((list) => {
      if (seq !== this.seq) return;
      this.offers = list; this.offersFor = id; this.loading = false;
    }).catch(() => { if (seq === this.seq) this.loading = false; });
  }

  /** Niveau collectif et section Relais. Ne fait que lire ce que loadOnline() a rapporté. */
  private renderOnline(v: GameView, s: ShelterView): void {
    const net = this.ctx.events.online;
    if (!net) return;
    const online = net.isOnline();
    if (online !== this.wasOnline) this.loadOnline();

    const c = online ? this.collective : null;
    show(this.coll, !!c);
    if (c) {
      setText(this.collTxt, `Réseau : niveau ${c.level}`);
      setText(this.collPts, c.nextAt === null ? 'Niveau maximal' : `${fmtInt(c.points)} / ${fmtInt(c.nextAt)}`);
      setVar(this.collBar, '--p', c.progress.toFixed(3));
      setAttr(this.coll, 'aria-label', `Abri collectif, niveau ${c.level} sur 5. ${fmtInt(c.points)} points apportés par tous les porteurs`);
    }

    show(this.relaySec, true);
    show(this.relayOff, !online);
    show(this.giveEl, online); show(this.takeEl, online);
    if (!online) { show(this.relayHint, false); show(this.giveCap, false); show(this.takeCap, false); setText(this.relaySide, ''); return; }
    // (a) Colis portés qui vont ailleurs : on peut les confier à la chaîne ici.
    const gives = v.orders.filter((o) => o.state === 'porté' && o.destId !== s.id && !o.special && !o.jamId).map((o) => ({ o, s }));
    if (!this.ctx.events.actions.giveToRelay) gives.length = 0;
    this.giveList.sync(gives);
    show(this.giveCap, gives.length > 0);
    for (const k of this.quotes.keys()) if (!gives.some((g) => g.o.id === k)) this.quotes.delete(k);
    // (b) Colis qui attendent ici un porteur.
    const takes = this.offersFor === s.id ? this.offers.map((r) => ({ r, s })) : [];
    this.takeList.sync(takes);
    show(this.takeCap, takes.length > 0);
    setText(this.relaySide, takes.length ? `${takes.length} en attente` : '');
    const hint = this.loading ? 'Recherche des relais…' : !takes.length ? (gives.length ? 'Aucun colis en attente ici.' : 'Aucun colis en attente ici. Les colis laissés par d’autres porteurs apparaîtront là.') : '';
    setText(this.relayHint, hint); show(this.relayHint, hint !== '');
  }

  private handoffRow(): Row<OrderView> {
    const name = h('span', 'dr-row-name');
    const action = btn('dr-btn dr-btn-sm', null, 'Déposer · +10 réputation');
    const el = h('div', 'dr-relay', h('div', 'dr-relay-txt', name), action);
    let id = '';
    action.addEventListener('click', () => {
      const sid = this.id;
      if (!sid || !id) return;
      if (this.ctx.run(this.ctx.events.actions.handoff?.(id, sid) ?? { ok: false, why: 'Dépôt indisponible' })) {
        this.ctx.ui('confirm');
        this.quotes.clear();
      }
    });
    return { el, update: (o) => { id = o.id; setText(name, `${o.name} · destination ${o.destName}`); setDisabled(action, !this.ctx.events.actions.handoff); } };
  }

  private giveRow(): Row<{ o: OrderView; s: ShelterView }> {
    const name = h('span', 'dr-row-name'), dest = h('span', 'dr-row-dest'), note = h('span', 'dr-relay-note');
    const go = btn('dr-btn dr-btn-sm', null, 'Laisser en relais');
    const el = h('div', 'dr-relay', h('div', 'dr-relay-txt', h('span', 'dr-row-l1', name), h('span', 'dr-row-l2', icon('pin'), dest)), h('div', 'dr-relay-act', note, go));
    el.dataset.kind = 'give';
    let id = '', sid = '';
    go.addEventListener('click', () => {
      const net = this.ctx.events.online;
      if (!net || this.busy) return;
      this.busy = true;
      net.giveRelay(id, sid).then((r) => {
        this.busy = false;
        if (this.ctx.run(r)) { this.ctx.ui('confirm'); this.offersFor = null; this.loadOnline(); }
      }).catch(() => { this.busy = false; });
    });
    return {
      el,
      update: ({ o, s }) => {
        id = o.id; sid = s.id;
        setText(name, o.name); setText(dest, o.destName);
        // L'avance dépend de l'endroit : on ne la redemande au jeu que si quelque chose a changé.
        const key = `${s.id}|${s.inRange}`;
        let q = this.quotes.get(o.id);
        if (!q || q.key !== key) {
          q = { key, r: this.ctx.events.actions.giveToRelay?.(o.id, s.id, true) ?? { ok: false, why: '' } };
          this.quotes.set(o.id, q);
        }
        const r = q.r;
        setText(note, r.ok ? `+${fmtInt(r.points ?? 0)} pts d’avance` : s.inRange ? r.why : `Encore ${fmtDist(s.distanceM)}`);
        setAttr(note, 'data-tone', r.ok ? 'good' : '');
        setDisabled(go, !r.ok || this.busy);
        setAttr(go, 'aria-label', `Laisser ${o.name} en relais ici`);
      },
    };
  }

  private takeRow(): Row<{ r: RelayOffer; s: ShelterView }> {
    const name = h('span', 'dr-row-name'), frag = h('span', 'dr-row-frag', icon('fragile')), dest = h('span', 'dr-row-dest');
    const w = meta('weight'), far = meta('route'), pts = meta('star'), hops = meta('relay');
    const mine = h('span', 'dr-relay-note', 'Déjà porté par toi');
    const go = btn('dr-btn dr-btn-sm dr-btn-take', null, 'Prendre le relais');
    const el = h('div', 'dr-relay',
      h('div', 'dr-relay-txt', h('span', 'dr-row-l1', name, frag), h('span', 'dr-row-l2', icon('pin'), dest), h('span', 'dr-row-l3', w.el, far.el, pts.el, hops.el)),
      h('div', 'dr-relay-act', mine, go));
    el.dataset.kind = 'take';
    let offer: RelayOffer | null = null;
    go.addEventListener('click', () => {
      const net = this.ctx.events.online;
      if (!net || !offer || this.busy) return;
      this.busy = true;
      net.takeRelay(offer).then((r) => {
        this.busy = false;
        this.ctx.run(r);
        this.offersFor = null; this.loadOnline();
      }).catch(() => { this.busy = false; });
    });
    return {
      el,
      update: ({ r, s }) => {
        offer = r;
        const p = r.parcel;
        setText(name, p.name); show(frag, p.fragile);
        setText(dest, p.destName || 'Abri');
        setText(w.val, fmtKg(p.weightKg));
        setText(far.val, fmtDist(distM(s.at, p.destAt)));
        setText(pts.val, `${fmtInt(p.reward)} pts`);
        setText(hops.val, r.hops > 1 ? `${r.hops} porteurs` : '1 porteur');
        show(mine, r.mine); show(go, !r.mine);
        setDisabled(go, !s.inRange || this.busy);
        setAttr(go, 'aria-label', `Prendre le relais : ${p.name} pour ${p.destName}`);
      },
    };
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

    const wrong = v.orders.filter(o => o.state === 'porté' && o.destId !== s.id);
    this.handoffList.sync(wrong);
    show(this.handoffSec, wrong.length > 0);
    const orders = s.deliverable.map((id) => v.orders.find((o) => o.id === id)).filter((o): o is OrderView => !!o);
    this.list.sync(orders);
    show(this.empty, orders.length === 0);
    setText(this.secSide, orders.length ? String(orders.length) : '');
    show(this.cta, orders.length > 0);
    setDisabled(this.cta, !s.inRange);
    setText(this.ctaText, s.inRange ? (orders.length > 1 ? `Livrer ${orders.length} colis` : 'Livrer') : `Encore ${fmtDist(s.distanceM)}`);
    setAttr(this.panel.foot, 'data-empty', orders.length ? '0' : '1');
    this.renderOnline(v, s);
  }

  private row(): Row<OrderView> {
    const name = h('span', 'dr-row-name');
    const frag = h('span', 'dr-row-frag', icon('fragile'));
    const w = meta('weight'), c = meta('shield'), d = meta('clock');
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
