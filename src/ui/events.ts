// Systèmes secondaires dans le HUD, en deux endroits seulement pour ne pas l'encombrer :
//  - une rangée de pastilles sous la barre du haut (front de mauvais temps, colis groupés), visible seulement s'il y a lieu ;
//  - UNE action de proximité au-dessus de la fiche (ramasser le colis à portée, ouvrir la cache, parler au rôdeur, prendre le lot).
// Tout y est facultatif : rien ne bloque la marche.
import type { CacheView, FrontView, GameView, JamView, OrderView, WandererView } from '../game/api';
import type { Ctx } from './ctx';
import { btn, fmtDist, fmtInt, fmtKg, h, setAttr, setText, show } from './dom';
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
  | { kind: 'pickup'; o: OrderView }
  | { kind: 'cache'; c: CacheView }
  | { kind: 'wanderer'; w: WandererView }
  | { kind: 'jam'; j: JamView };

/** L'action de proximité : une seule à la fois, la plus pressée d'abord. */
export class NearAction {
  readonly el: HTMLElement;
  private act: HTMLButtonElement; private actIcon = h('span', 'dr-near-ic'); private actTitle = h('span', 'dr-near-title'); private actSub = h('span', 'dr-near-sub');
  private target: Near | null = null;
  private key = '';
  constructor(parent: HTMLElement, private ctx: Ctx) {
    this.act = btn('dr-near-btn', null, this.actIcon, h('span', 'dr-near-txt', this.actTitle, this.actSub), icon('arrow', 'dr-near-go'));
    this.act.addEventListener('click', () => this.fire());

    this.el = h('div', 'dr-near', this.act);
    this.el.hidden = true;
    parent.append(this.el);
  }

  render(v: GameView): void {
    const t = this.pick(v);
    this.target = t;
    show(this.el, !!t);
    if (!t) { this.key = ''; return; }
    const id = t.kind === 'pickup' ? t.o.id : t.kind === 'cache' ? t.c.id : t.kind === 'wanderer' ? t.w.id : t.j.id, k = `${t.kind}|${id}`;
    if (k === this.key) return;
    this.key = k;
    const ic: IconName = t.kind === 'pickup' ? 'pickup' : t.kind === 'cache' ? 'cache' : t.kind === 'wanderer' ? 'walker' : 'stack';
    this.actIcon.replaceChildren(icon(ic));
    setAttr(this.el, 'data-kind', t.kind);
    if (t.kind === 'pickup') { setText(this.actTitle, t.o.dropped ? 'Reprendre' : 'Ramasser'); setText(this.actSub, `${t.o.name} · ${t.o.special && !t.o.special.known ? 'colis scellé' : fmtKg(t.o.weightKg)} à portée`); }
    else if (t.kind === 'cache') { setText(this.actTitle, 'Ouvrir la cache'); setText(this.actSub, 'Quelqu’un a laissé ça pour toi'); }
    else if (t.kind === 'wanderer') { setText(this.actTitle, `Parler à ${t.w.name}`); setText(this.actSub, 'Un voyageur de passage'); }
    else { setText(this.actTitle, 'Prendre le lot'); setText(this.actSub, `${t.j.count} colis en ${t.j.minutes} min : bonus +${fmtInt(t.j.bonus)} pts`); }
  }

  private pick(v: GameView): Near | null {
    // Le colis à portée le plus proche : c'est l'activité principale, elle passe devant le reste.
    let o: OrderView | null = null;
    for (const x of v.orders) if (x.state === 'révélé' && x.inRange && (!o || x.distanceM < o.distanceM)) o = x;
    if (o) return { kind: 'pickup', o };
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
    if (t.kind === 'pickup') this.ctx.pickup(t.o.id);
    else if (t.kind === 'cache') this.ctx.run(a.openCache(t.c.id));
    else if (t.kind === 'wanderer') this.ctx.run(a.talk(t.w.id));
    else if (t.kind === 'jam') this.ctx.run(a.startJam(t.j.id));
  }
}
