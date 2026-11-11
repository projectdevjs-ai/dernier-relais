// Systèmes secondaires dans le HUD, en deux endroits seulement pour ne pas l'encombrer :
//  - une rangée de pastilles sous la barre du haut (front de mauvais temps, colis groupés), visible seulement s'il y a lieu ;
//  - UNE action de proximité au-dessus de la fiche (ouvrir la cache, parler au rôdeur, prendre le lot, serrer la sangle).
// Tout y est facultatif : rien ne bloque la marche.
import type { CacheView, FrontView, GameView, JamView, OrderView, WandererView } from '../game/api';
import { strapQuality } from '../game/gestures';
import { GESTURE } from '../game/rules';
import type { Ctx } from './ctx';
import { btn, fmtDist, fmtInt, h, setAttr, setText, setVar, show } from './dom';
import { icon, type IconName } from './icons';

/** Au-delà, un front ou un abri débordé ne mérite pas une pastille : la carte suffit. */
const NEAR_M = 400;

function minutes(s: number): string {
  return s < 60 ? 'moins d’1 min' : `${Math.round(s / 60)} min`;
}

/** Pastilles du haut. */
export class EventsBar {
  readonly el: HTMLElement;
  private front: HTMLElement; private frontTxt = h('span', '');
  private jam: HTMLButtonElement; private jamTxt = h('span', '');
  private jamShelter = '';

  constructor(private root: HTMLElement, ctx: Ctx) {
    this.front = h('div', 'dr-chip dr-evt dr-evt-front', icon('front'), this.frontTxt);
    this.front.setAttribute('role', 'status');
    this.jam = btn('dr-chip dr-evt dr-evt-jam', null, icon('stack'), this.jamTxt);
    this.jam.addEventListener('click', () => { if (this.jamShelter) ctx.openShelter(this.jamShelter); });
    this.front.hidden = this.jam.hidden = true;
    this.el = h('div', 'dr-top-row dr-events', this.front, this.jam);
    this.el.hidden = true;
  }

  render(v: GameView): void {
    // Front : le plus menaçant d'abord (dedans, puis celui qui arrive, puis le plus proche).
    let f: FrontView | null = null;
    for (const x of v.fronts ?? []) {
      if (!x.inside && x.etaS === null && x.distanceM > NEAR_M) continue;
      if (!f || (x.inside && !f.inside) || (!f.inside && (x.etaS ?? Infinity) < (f.etaS ?? Infinity))) f = x;
    }
    show(this.front, !!f);
    if (f) {
      setText(this.frontTxt, f.inside ? 'Dans le front' : f.etaS !== null ? `Front dans ${minutes(f.etaS)}` : `Front à ${fmtDist(f.distanceM)}`);
      setAttr(this.front, 'data-tone', f.inside ? 'bad' : f.etaS !== null && f.etaS < 180 ? 'warn' : '');
    }

    // Colis groupés : le lot en cours, sinon l'abri débordé le plus proche.
    let j: JamView | null = null;
    for (const x of v.jams ?? []) {
      if (x.state === 'en cours') { j = x; break; }
      if (x.distanceM <= NEAR_M && (!j || x.distanceM < j.distanceM)) j = x;
    }
    show(this.jam, !!j);
    if (j) {
      this.jamShelter = j.shelterId;
      const left = j.minutesLeft ?? j.minutes;
      setText(this.jamTxt, j.state === 'en cours' ? `Lot ${j.delivered}/${j.count} · ${Math.max(0, left)} min` : `Abri débordé · ${fmtDist(j.distanceM)}`);
      setAttr(this.jam, 'data-tone', j.state === 'en cours' && left <= 3 ? 'warn' : '');
      setAttr(this.jam, 'aria-label', j.state === 'en cours'
        ? `Colis groupés : ${j.delivered} sur ${j.count} livrés, ${Math.max(0, left)} minutes restantes. Voir l’abri`
        : `${j.shelterName} est débordé, à ${fmtDist(j.distanceM)}. Voir l’abri`);
    }
    const any = !!f || !!j;
    show(this.el, any);
    this.root.classList.toggle('dr-has-events', any);
  }
}

type Near =
  | { kind: 'strap'; o: OrderView }
  | { kind: 'cache'; c: CacheView }
  | { kind: 'wanderer'; w: WandererView }
  | { kind: 'jam'; j: JamView };

/** L'action de proximité : une seule à la fois, la plus pressée d'abord. */
export class NearAction {
  readonly el: HTMLElement;
  private act: HTMLButtonElement; private actIcon = h('span', 'dr-near-ic'); private actTitle = h('span', 'dr-near-title'); private actSub = h('span', 'dr-near-sub');
  private strap: HTMLElement; private strapName = h('span', 'dr-strap-name'); private track: HTMLElement; private knob = h('span', 'dr-strap-knob'); private timer = h('span', 'dr-strap-time');
  private target: Near | null = null;
  private key = '';
  private dragging = false;
  private pos = 0;
  /** Colis dont le geste vient d'être fait : on n'attend pas la vue suivante pour retirer la sangle. */
  private strapped = '';

  constructor(parent: HTMLElement, private ctx: Ctx) {
    this.act = btn('dr-near-btn', null, this.actIcon, h('span', 'dr-near-txt', this.actTitle, this.actSub), icon('arrow', 'dr-near-go'));
    this.act.addEventListener('click', () => this.fire());

    // Arrimage : on tire la boucle vers la droite et on lâche dans la zone verte.
    const [lo, hi] = GESTURE.strapGood;
    const zone = h('span', 'dr-strap-zone');
    setVar(zone, '--lo', String(lo)); setVar(zone, '--hi', String(hi));
    this.knob.append(icon('strap'));
    this.track = h('div', 'dr-strap-track', zone, this.knob);
    this.track.setAttribute('role', 'slider');
    this.track.setAttribute('aria-label', 'Serrer la sangle : glisse vers la droite et lâche dans la zone verte');
    this.track.setAttribute('aria-valuemin', '0'); this.track.setAttribute('aria-valuemax', '100');
    this.track.tabIndex = 0;
    this.strap = h('div', 'dr-strap', h('div', 'dr-strap-top', icon('strap'), h('span', 'dr-strap-label', 'Serre la sangle'), this.strapName, this.timer), this.track);
    this.track.addEventListener('pointerdown', (e) => { this.dragging = true; this.track.setPointerCapture(e.pointerId); this.move(e); });
    this.track.addEventListener('pointermove', (e) => { if (this.dragging) this.move(e); });
    const end = (): void => { if (this.dragging) { this.dragging = false; this.release(); } };
    this.track.addEventListener('pointerup', end);
    this.track.addEventListener('pointercancel', () => { this.dragging = false; this.setPos(0); });
    // Au clavier : flèches pour tirer, Entrée pour lâcher.
    this.track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') this.setPos(this.pos + 0.1);
      else if (e.key === 'ArrowLeft') this.setPos(this.pos - 0.1);
      else if (e.key === 'Enter' || e.key === ' ') this.release();
      else return;
      e.preventDefault();
    });

    this.el = h('div', 'dr-near', this.act, this.strap);
    this.el.hidden = true;
    parent.append(this.el);
  }

  render(v: GameView): void {
    const t = this.pick(v);
    this.target = t;
    show(this.el, !!t);
    if (!t) { this.key = ''; return; }
    show(this.strap, t.kind === 'strap');
    show(this.act, t.kind !== 'strap');
    if (t.kind === 'strap') {
      const k = `strap|${t.o.id}`;
      if (k !== this.key) { this.key = k; this.setPos(0); setText(this.strapName, t.o.name); }
      setVar(this.timer, '--p', Math.min(1, (t.o.strapLeftS ?? 0) / GESTURE.strapWindowS).toFixed(2));
      return;
    }
    const id = t.kind === 'cache' ? t.c.id : t.kind === 'wanderer' ? t.w.id : t.j.id, k = `${t.kind}|${id}`;
    if (k === this.key) return;
    this.key = k;
    const ic: IconName = t.kind === 'cache' ? 'cache' : t.kind === 'wanderer' ? 'walker' : 'stack';
    this.actIcon.replaceChildren(icon(ic));
    setAttr(this.el, 'data-kind', t.kind);
    if (t.kind === 'cache') { setText(this.actTitle, 'Ouvrir la cache'); setText(this.actSub, 'Quelqu’un a laissé ça pour toi'); }
    else if (t.kind === 'wanderer') { setText(this.actTitle, `Parler à ${t.w.name}`); setText(this.actSub, 'Un voyageur de passage'); }
    else { setText(this.actTitle, `Prendre les ${t.j.count} colis groupés`); setText(this.actSub, `${t.j.minutes} min pour tout livrer · bonus +${fmtInt(t.j.bonus)} pts`); }
  }

  private pick(v: GameView): Near | null {
    let o: OrderView | null = null;
    for (const x of v.orders) if ((x.strapLeftS ?? 0) > 0 && x.id !== this.strapped && (!o || (x.strapLeftS ?? 0) > (o.strapLeftS ?? 0))) o = x;
    if (o) return { kind: 'strap', o };
    const c = (v.caches ?? []).find((x) => x.inRange);
    if (c) return { kind: 'cache', c };
    const w = (v.wanderers ?? []).find((x) => x.inRange && !x.met);
    if (w) return { kind: 'wanderer', w };
    const j = (v.jams ?? []).find((x) => x.state === 'proposé' && x.inRange);
    return j ? { kind: 'jam', j } : null;
  }

  private fire(): void {
    const t = this.target, a = this.ctx.events.actions;
    if (!t) return;
    if (t.kind === 'cache') this.ctx.run(a.openCache(t.c.id));
    else if (t.kind === 'wanderer') this.ctx.run(a.talk(t.w.id));
    else if (t.kind === 'jam') this.ctx.run(a.startJam(t.j.id));
  }

  private move(e: PointerEvent): void {
    const r = this.track.getBoundingClientRect(), pad = 22;
    this.setPos((e.clientX - r.left - pad) / Math.max(1, r.width - 2 * pad));
  }
  private setPos(p: number): void {
    this.pos = Math.min(1, Math.max(0, p));
    setVar(this.knob, '--x', this.pos.toFixed(3));
    const [lo, hi] = GESTURE.strapGood;
    this.track.classList.toggle('is-good', this.pos >= lo && this.pos <= hi);
    this.track.classList.toggle('is-over', this.pos > hi);
    setAttr(this.track, 'aria-valuenow', String(Math.round(this.pos * 100)));
  }
  private release(): void {
    const t = this.target;
    // Un simple effleurement n'est pas un geste : la sangle revient.
    if (!t || t.kind !== 'strap' || this.pos < 0.08) { this.setPos(0); return; }
    if (this.ctx.run(this.ctx.events.actions.strap(t.o.id, strapQuality(this.pos)))) { this.strapped = t.o.id; this.el.hidden = true; }
    this.setPos(0);
  }
}
