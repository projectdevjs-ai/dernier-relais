// Écran de rangement (« Chargement » dans l'ancien jeu) : la silhouette du porteur vue de dos, ses cinq emplacements
// (dos, bras, jambes), la répartition gauche/droite, et le déplacement d'un colis d'un emplacement à l'autre.
// On touche un colis, puis un emplacement en vert. Les fixations de bras et de jambes s'installent chez Noé, au labo.
import type { GameActions, GameView, OrderView, SlotId, SlotView } from '../game/api';
import { type Rig, SLOT_RULES, type Stowed, leanText, moveTo, slotRule, specialSlotNote } from '../game/slots';
import { btn, fmtDist, fmtKg, fmtPct, h, setText } from '../ui/dom';
import { icon } from '../ui/icons';

const CRATE: Record<string, string> = { bois: 'Caisse en bois', alu: 'Caisse en aluminium', plastique: 'Bac plastique', carton: 'Carton' };
const ORDER: SlotId[] = ['brasG', 'brasD', 'jambeG', 'jambeD', 'dos'];
const SVG = 'http://www.w3.org/2000/svg';

export interface LoadHost {
  actions: GameActions;
  ui(kind: 'tap' | 'open' | 'close' | 'error' | 'confirm'): void;
  /** Appelé à la fermeture de l'écran. */
  closed?(): void;
}

const stowed = (o: OrderView): Stowed => ({ id: o.id, weightKg: o.weightKg, fragile: o.fragile, special: o.special?.kind, slot: o.slot ?? 'dos' });

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...kids: SVGElement[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...kids);
  return el;
}

/** Silhouette du porteur, de dos : le bras gauche est à gauche de l'écran, comme la jauge d'équilibre. */
const PLATES: Record<SlotId, { x: number; y: number; w: number; h: number; r: number }> = {
  dos: { x: 49, y: 56, w: 42, h: 58, r: 8 },
  brasG: { x: 14, y: 84, w: 20, h: 30, r: 6 }, brasD: { x: 106, y: 84, w: 20, h: 30, r: 6 },
  jambeG: { x: 38, y: 150, w: 22, h: 32, r: 6 }, jambeD: { x: 80, y: 150, w: 22, h: 32, r: 6 },
};
function silhouette(): { el: SVGSVGElement; plates: Map<SlotId, SVGGElement> } {
  const body = svg('g', { class: 'pk-body' },
    svg('circle', { cx: 70, cy: 26, r: 15 }),
    svg('path', { d: 'M63 40h14v8H63z' }),
    svg('path', { d: 'M44 50c8-4 44-4 52 0l6 10-6 66H44l-6-66z' }),
    svg('path', { d: 'M40 56c-8 2-12 8-14 18l-6 46c-1 6 9 8 11 2l9-44zM100 56c8 2 12 8 14 18l6 46c1 6-9 8-11 2l-9-44z' }),
    svg('path', { d: 'M45 128h22l-2 86c0 7-13 7-14 0zM73 128h22l-6 86c-1 7-14 7-14 0z' }));
  // L'ossature de l'exosquelette : colonne, épaules, tiges des membres.
  const frame = svg('path', { class: 'pk-frame', d: 'M70 44v84M46 54h48M30 62l-6 54M110 62l6 54M50 132l-2 76M90 132l2 76M52 128h36' });
  const joints = svg('g', { class: 'pk-joints' }, ...[[46, 54], [94, 54], [52, 128], [88, 128], [70, 44]].map(([cx, cy]) => svg('circle', { cx, cy, r: 3.2 })));
  const plates = new Map<SlotId, SVGGElement>();
  const g = svg('g', {});
  for (const k of ORDER) {
    const p = PLATES[k];
    const plate = svg('g', { class: 'pk-plate', 'data-slot': k },
      svg('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: p.r }),
      // Cadenas : montré seulement si l'emplacement est verrouillé.
      svg('path', { class: 'pk-plate-lock', d: `M${p.x + p.w / 2 - 4} ${p.y + p.h / 2 - 1}h8v7h-8zM${p.x + p.w / 2 - 2.5} ${p.y + p.h / 2 - 1}v-2.5a2.5 2.5 0 0 1 5 0v2.5` }),
      // Colis accroché : une caisse.
      svg('path', { class: 'pk-plate-box', d: `M${p.x + 4} ${p.y + p.h / 2 - 5}h${p.w - 8}v${Math.min(p.h - 12, 16)}h-${p.w - 8}zM${p.x + 4} ${p.y + p.h / 2}h${p.w - 8}` }));
    plates.set(k, plate);
    g.append(plate);
  }
  const el = svg('svg', { class: 'pk-sil', viewBox: '0 0 140 224', 'aria-hidden': 'true', focusable: 'false' }, body, frame, joints, g);
  return { el, plates };
}

export class LoadScreen {
  readonly el: HTMLElement;
  private view: GameView | null = null;
  private sel: string | null = null;
  private key = '';
  /** Colis qui vient d'être ramassé : l'écran s'ouvre sur lui. */
  private fresh: string | null = null;
  private kicker = h('div', 'pk-load-kick');
  private kg = h('strong', '');
  private cap = h('span', '');
  private left = h('span', 'pk-bal-side');
  private right = h('span', 'pk-bal-side');
  private dot = h('i', '');
  private bal = h('p', 'pk-bal-txt');
  private grid = h('div', 'pk-grid');
  private slots = new Map<SlotId, HTMLElement>();
  private sil = silhouette();
  private detail = h('div', 'pk-det');
  private hint = h('p', 'pk-load-hint');
  private msg = h('p', 'pk-load-msg');
  private auto: HTMLButtonElement;
  private ok: HTMLButtonElement;
  private foot!: HTMLElement;
  private exo = h('p', 'pk-load-exo');
  private msgTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFocus: Element | null = null;
  /** Ouverture demandée sans état du jeu : l'écran se montre au premier état reçu. */
  private pending = false;

  constructor(parent: HTMLElement, private host: LoadHost) {
    const back = btn('dr-iconbtn pk-load-back', 'Fermer le chargement', icon('close'));
    back.addEventListener('click', () => this.close());
    const head = h('header', 'pk-load-head', h('div', 'pk-load-ttl', this.kicker, h('h2', 'dr-title', 'Chargement')), h('div', 'pk-load-kg', this.kg, this.cap), back);
    const bar = h('div', 'pk-bal-bar', this.dot);
    bar.setAttribute('role', 'img');
    const balance = h('div', 'pk-bal', this.left, bar, this.right);
    for (const k of ORDER) {
      const el = h('div', `pk-slot pk-slot-${k}`);
      el.dataset.slot = k;
      el.addEventListener('click', e => { if (!(e.target as Element).closest('.pk-item')) this.tapSlot(k); });
      el.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); this.tapSlot(k); } });
      this.slots.set(k, el);
    }
    this.grid.append(this.slots.get('brasG')!, h('div', 'pk-sil-wrap', this.sil.el), this.slots.get('brasD')!, this.slots.get('jambeG')!, this.slots.get('jambeD')!, this.slots.get('dos')!);
    this.auto = btn('dr-btn dr-btn-wide dr-btn-line', null, icon('relay'), h('span', '', 'Rangement automatique'));
    this.auto.addEventListener('click', () => {
      const r = this.host.actions.autoStow?.() ?? { ok: false as const, why: 'Rangement automatique indisponible.' };
      if (r.ok) { this.sel = null; this.host.ui('confirm'); this.say('Rangement automatique · charge rééquilibrée', 'good'); } else { this.host.ui('error'); this.say(r.why, 'bad'); }
      this.refresh();
    });
    this.ok = btn('dr-btn dr-btn-wide dr-btn-take', null, icon('check'), h('span', '', 'C’est rangé'));
    this.ok.addEventListener('click', () => this.close());
    this.msg.setAttribute('role', 'status'); this.msg.setAttribute('aria-live', 'polite');
    this.msg.hidden = true;
    const help = h('p', 'pk-load-help', 'Dos : charges lourdes et fragiles. Bras : 12 kg max, la charge tangue plus. Jambes : 9 kg max, fatiguent davantage. Garde le même poids à gauche et à droite.');
    this.foot = h('div', 'pk-load-foot', this.ok);
    const box = h('div', 'pk-load-box', head, balance, this.bal, this.grid, this.msg, this.detail, this.hint, this.auto, this.exo, help);
    this.el = h('section', 'pk-load', box, this.foot);
    this.el.hidden = true;
    this.el.tabIndex = -1;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-label', 'Chargement du porteur');
    this.el.lang = 'fr';
    this.el.addEventListener('keydown', e => { if (e.key === 'Escape') this.close(); });
    parent.append(this.el);
  }

  get isOpen(): boolean { return !this.el.hidden || this.pending; }

  /** `fresh` : colis qui vient d'être ramassé (sélectionné d'entrée, avec le bouton « C'est rangé »). */
  open(v: GameView | null, fresh: string | null = null): void {
    this.fresh = fresh;
    this.sel = fresh;
    this.key = '';
    this.say('', '');
    this.lastFocus = document.activeElement;
    this.pending = true;
    if (v) this.render(v);
  }
  private reveal(): void {
    this.pending = false;
    this.el.hidden = false;
    this.el.scrollTop = 0;
    this.el.focus({ preventScroll: true });
    this.host.ui('open');
  }
  close(): void {
    if (this.el.hidden && !this.pending) return;
    this.pending = false;
    this.el.hidden = true;
    this.sel = null; this.fresh = null;
    if (this.lastFocus instanceof HTMLElement && this.lastFocus.isConnected) this.lastFocus.focus({ preventScroll: true });
    this.host.ui('close');
    this.host.closed?.();
  }

  /** À rappeler avec l'état le plus récent du jeu. Ne reconstruit l'écran que si quelque chose a changé. */
  render(v: GameView): void {
    this.view = v;
    // Colis tout juste ramassé : on attend que l'état du jeu le montre dans le sac.
    if (this.pending && (!this.fresh || v.orders.some(o => o.id === this.fresh && o.state === 'porté'))) this.reveal();
    if (this.el.hidden) return;
    const bag = v.orders.filter(o => o.state === 'porté');
    if (this.sel && !bag.some(o => o.id === this.sel)) this.sel = null;
    const key = JSON.stringify([this.sel, this.fresh, v.player.exoTier, v.player.capacityKg, bag.map(o => [o.id, o.slot, Math.round(o.condition * 100), o.minutesLeft, Math.round(o.distanceM / 10)])]);
    if (key === this.key) return;
    this.key = key;
    this.draw(v, bag);
  }
  private refresh(): void { this.key = ''; }

  private say(text: string, tone: '' | 'good' | 'bad'): void {
    if (this.msgTimer) clearTimeout(this.msgTimer);
    setText(this.msg, text);
    this.msg.dataset.tone = tone;
    this.msg.hidden = text === '';
    if (text) this.msgTimer = setTimeout(() => { this.msg.hidden = true; }, 3500);
  }

  private rig(v: GameView): Rig {
    return { tier: v.player.exoTier ?? 0, backKg: v.player.slots?.find(s => s.id === 'dos')?.maxKg ?? v.player.capacityKg };
  }

  private draw(v: GameView, bag: OrderView[]): void {
    const p = v.player, rig = this.rig(v), list = bag.map(stowed);
    const slots: SlotView[] = p.slots ?? [{ id: 'dos', name: 'Dos', side: 0, unlocked: true, maxKg: p.capacityKg, kg: p.carriedKg, orders: bag.map(o => o.id) }];
    const sel = bag.find(o => o.id === this.sel) ?? null, selS = sel ? stowed(sel) : null;
    const open = slots.filter(s => s.unlocked).length;
    setText(this.kicker, `${p.exo?.[p.exoTier ?? 0]?.name ?? 'Harnais dorsal'} · ${bag.length} colis`);
    setText(this.kg, fmtKg(p.carriedKg).replace(' kg', ''));
    setText(this.cap, ` / ${fmtKg(p.capacityKg)}`);

    // Répartition gauche / droite
    const sides = p.sides ?? { leftKg: 0, rightKg: 0, armsKg: 0, legsKg: 0 }, lat = p.lean ?? 0, lean = leanText(lat);
    setText(this.left, `Gauche ${fmtKg(sides.leftKg)}`);
    setText(this.right, `Droite ${fmtKg(sides.rightKg)}`);
    this.dot.style.setProperty('--x', String(Math.max(-1, Math.min(1, lat))));
    this.dot.parentElement!.dataset.tone = lean.tone;
    this.dot.parentElement!.setAttribute('aria-label', `Équilibre de la charge : ${lean.text}`);
    setText(this.bal, lean.text + (sides.legsKg ? ` · jambes chargées : fatigue +${Math.round((sides.legsKg / SLOT_RULES.legsFatigueKg) * 100)} %` : '') + (sides.armsKg ? ' · bras chargés : la charge tangue plus' : ''));
    this.bal.dataset.tone = lean.tone;

    // Emplacements
    for (const k of ORDER) {
      const s = slots.find(x => x.id === k), el = this.slots.get(k)!, plate = this.sil.plates.get(k)!;
      const items = bag.filter(o => (o.slot ?? 'dos') === k), locked = !s || !s.unlocked;
      let ok = false, why = '';
      if (selS && !locked && (sel!.slot ?? 'dos') !== k) {
        const m = moveTo(selS, k, list, rig);
        ok = m.ok; why = m.ok ? '' : m.why;
      }
      el.className = `pk-slot pk-slot-${k}${locked ? ' is-locked' : ''}${ok ? ' is-ok' : ''}${why ? ' is-no' : ''}`;
      plate.setAttribute('class', `pk-plate${locked ? ' is-locked' : ''}${items.length ? ' is-full' : ''}${ok ? ' is-ok' : ''}${sel && (sel.slot ?? 'dos') === k ? ' is-sel' : ''}`);
      const name = s?.name ?? k, head = h('div', 'pk-slot-head', h('span', 'pk-slot-name', name));
      if (locked) {
        head.append(h('small', '', icon('lock'), 'verrouillé'));
        el.replaceChildren(head, h('p', 'pk-slot-empty', s?.lockedWhy ?? (k.startsWith('bras') ? 'Attaches de bras à installer chez Noé, au labo' : 'Attaches de jambes à installer chez Noé, au labo')));
        el.removeAttribute('role'); el.removeAttribute('tabindex'); el.removeAttribute('aria-label');
        continue;
      }
      head.append(h('small', '', k === 'dos' ? `${fmtKg(s!.kg)} / ${fmtKg(s!.maxKg)}` : `${items.length}/1 · ${s!.maxKg} kg max`));
      const kids: HTMLElement[] = [head];
      if (items.length) kids.push(h('div', 'pk-items', ...items.map(o => this.item(o))));
      else kids.push(h('p', 'pk-slot-empty', 'Libre'));
      if (why) kids.push(h('p', 'pk-slot-why', why));
      else if (ok) kids.push(h('p', 'pk-slot-go', 'Toucher pour accrocher ici'));
      el.replaceChildren(...kids);
      if (ok) { el.setAttribute('role', 'button'); el.tabIndex = 0; el.setAttribute('aria-label', `Accrocher ${sel!.name} : ${name}`); }
      else { el.removeAttribute('role'); el.removeAttribute('tabindex'); el.removeAttribute('aria-label'); }
    }

    // Colis sélectionné
    if (sel) {
      const sp = sel.special, slotName = slots.find(s => s.id === (sel.slot ?? 'dos'))?.name ?? 'Dos';
      const cancel = btn('dr-btn dr-btn-sm dr-btn-line', null, 'Annuler');
      cancel.addEventListener('click', () => { this.sel = null; this.refresh(); if (this.view) this.render(this.view); });
      const drop = btn('dr-btn dr-btn-sm dr-btn-line', null, icon('drop'), h('span', '', 'Déposer au sol ici'));
      drop.disabled = !!sel.relay;
      drop.addEventListener('click', () => {
        const r = this.host.actions.drop(sel.id);
        if (r.ok) { this.sel = null; this.say(`${sel.name} posé au sol · reprends-le quand tu veux`, ''); } else { this.host.ui('error'); this.say(r.why, 'bad'); }
        this.refresh();
      });
      const note = sp?.known ? [sp.rule, specialSlotNote(sp.kind)].filter(Boolean).join(' ') : '';
      this.detail.replaceChildren(
        h('div', 'pk-det-row', h('div', '', h('div', 'pk-det-kick', `${this.fresh === sel.id ? 'Accroché · ' : ''}${slotName} · ${sp ? 'Colis spécial' : CRATE[sel.crate] ?? ''}`), h('strong', 'pk-det-name', sel.name)), cancel),
        h('p', 'pk-det-txt', `${fmtKg(sel.weightKg)} · état ${fmtPct(sel.condition)} · pour ${sel.destName}, à ${fmtDist(sel.distanceM)}${sel.fragile ? ' · fragile' : ''}${(sel.strap ?? 0) >= 1 ? ' · bien arrimé' : ''}`),
        note ? h('p', 'pk-det-spe', note) : '',
        h('p', 'pk-det-how', open > 1 ? 'Touche un emplacement en vert pour l’y accrocher' : 'Un seul emplacement pour l’instant : les fixations de bras et de jambes s’installent chez Noé, au labo'),
        h('div', 'pk-det-acts', drop) as HTMLElement);
      this.detail.dataset.look = sp ? 'special' : '';
    }
    this.detail.hidden = !sel;
    this.hint.hidden = !!sel;
    setText(this.hint, bag.length ? 'Touche un colis pour le déplacer ou le déposer' : 'Aucun colis accroché');
    // Prochain palier à installer
    const next = p.exo?.find(e => !e.installed);
    this.exo.hidden = !next;
    if (next) setText(this.exo, `Prochain palier chez Noé : ${next.name} (niveau ${next.level}). ${next.desc}`);
    this.auto.disabled = bag.length === 0;
    this.foot.hidden = !this.fresh;
    this.el.classList.toggle('has-foot', !!this.fresh);
  }

  private item(o: OrderView): HTMLButtonElement {
    const sp = !!o.special;
    const b = btn(`pk-item${o.id === this.sel ? ' is-on' : ''}${sp ? ' is-special' : ''}`, null,
      h('b', '', o.name),
      h('span', '', `${fmtKg(o.weightKg)} · ${fmtPct(o.condition)}${o.minutesLeft !== null ? ` · ${Math.max(0, Math.round(o.minutesLeft))} min` : ''}`));
    if (o.minutesLeft !== null && o.minutesLeft < 5) b.classList.add('is-late');
    b.setAttribute('aria-pressed', String(o.id === this.sel));
    b.setAttribute('aria-label', `${o.name}, ${fmtKg(o.weightKg)}${o.fragile ? ', fragile' : ''}. ${o.id === this.sel ? 'Sélectionné' : 'Sélectionner pour le déplacer'}`);
    b.addEventListener('click', () => {
      this.sel = this.sel === o.id ? null : o.id;
      this.host.ui('tap');
      this.refresh();
      if (this.view) this.render(this.view);
    });
    return b;
  }

  private tapSlot(k: SlotId): void {
    const v = this.view, sel = v?.orders.find(o => o.id === this.sel && o.state === 'porté');
    if (!v || !sel || (sel.slot ?? 'dos') === k) return;
    const r = this.host.actions.stow?.(sel.id, k) ?? { ok: false as const, why: slotRule(stowed(sel), k, this.rig(v).tier) || 'Emplacement indisponible' };
    if (r.ok) { this.sel = null; if (this.fresh === sel.id) this.fresh = sel.id; this.host.ui('confirm'); this.say(`${sel.name} accroché · ${v.player.slots?.find(s => s.id === k)?.name ?? k}`, 'good'); }
    else { this.host.ui('error'); this.say(r.why, 'bad'); }
    this.refresh();
  }
}
