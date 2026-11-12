// Interface de l'histoire, posée dans le calque .dr-hud : bandeau d'objectif, messages radio,
// carton de fin de chapitre et panneau « Histoire ». Tout est en haut de l'écran : le tiers bas-centre
// (le personnage) et le coin bas-droit (le scanner) restent libres. Les couleurs viennent des variables du HUD.
import { btn, h, setText } from '../ui/dom';
import { icon } from '../ui/icons';
import { Panel } from '../ui/panel';
import { WHO, type Who } from './chapters';
import type { Story, StoryEvent } from './story';
import './story.css';

export interface StoryUiOpts {
  /** Appelé à l'affichage d'un message radio, pour dire la réplique. */
  onVoice?: (who: string, text: string) => void;
  /** Vrai tant que le joueur n'est pas sur la carte (prologue, labo) : messages et cartons attendent. */
  hold?: () => boolean;
}

const UI_KEY = 'dernier-relais/histoire-replie';

/** Icônes propres à l'histoire, même style que src/ui/icons.ts (grille 24, trait 1,8, bouts ronds). */
const SVG = {
  // Antenne qui émet : le signal à suivre.
  signal: '<path d="M12 21V11M8.5 21h7"/><circle cx="12" cy="8.6" r="1.7"/><path d="M8.2 12.2a5.2 5.2 0 0 1 0-7.2M15.8 5a5.2 5.2 0 0 1 0 7.2M5.4 14.6a9 9 0 0 1 0-12M18.6 2.6a9 9 0 0 1 0 12"/>',
  // Ondes d'une voix à la radio.
  wave: '<path d="M3.5 12h1.8M7.6 8.5v7M10.9 5.5v13M14.2 9v6M17.5 7v10M20.5 11v2"/>',
} as const;
function art(name: keyof typeof SVG, cls = ''): SVGSVGElement {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="dr-ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${SVG[name]}</svg>`;
  return t.content.firstElementChild as SVGSVGElement;
}

/** Temps de lecture d'un message, proportionnel à sa longueur. */
export function readMs(text: string): number {
  return Math.max(3800, Math.min(12000, 2000 + text.length * 55));
}
/** Espaces insécables de la typographie française, pour l'affichage seulement (les textes des voix restent tels quels). */
const typo = (t: string): string => t.replace(/ ([:;!?»])/g, '\u00a0$1').replace(/« /g, '«\u00a0');
const fmtN = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));

export class StoryUi {
  private layer: HTMLElement;
  // Objectif
  private goal: HTMLElement;
  private goalBtn: HTMLButtonElement;
  private goalText = h('span', 'st-goal-text');
  private goalCount = h('span', 'st-goal-count');
  private goalStep = h('span', 'st-goal-step');
  private folded = false;
  // Radio
  private radio: HTMLButtonElement;
  private radioBadge = h('span', 'st-radio-badge');
  private radioName = h('span', 'st-radio-name');
  private radioRole = h('span', 'st-radio-role');
  private radioText = h('p', 'st-radio-text');
  private radioTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: { who: Who; text: string }[] = [];
  private retry: ReturnType<typeof setTimeout> | null = null;
  // Carton
  private card: HTMLElement;
  private cardKicker = h('p', 'st-card-kicker');
  private cardTitle = h('h2', 'st-card-title');
  private cardText = h('p', 'st-card-text');
  private cardNext = h('p', 'st-card-next');
  private cardGo: HTMLButtonElement;
  // Journal
  private journal: Panel | null = null;
  private off: () => void;

  constructor(private root: HTMLElement, private story: Story, private opts: StoryUiOpts = {}) {
    root.classList.add('dr-has-story');
    try { this.folded = localStorage.getItem(UI_KEY) === '1'; } catch { /* stockage indisponible */ }

    // (a) Objectif : une ligne sous le HUD du haut. Un toucher la replie ; le carnet ouvre le journal.
    this.goalBtn = btn('st-goal-main', null, h('span', 'st-goal-ic', art('signal')), this.goalText, this.goalCount, this.goalStep);
    const book = btn('st-goal-book', 'Ouvrir l’histoire', icon('book'));
    this.goal = h('div', 'st-goal', this.goalBtn, book);
    this.goalBtn.addEventListener('click', () => this.fold(!this.folded));
    book.addEventListener('click', () => this.openJournal());

    // (b) Message radio : une carte qui glisse à la place de l'objectif. Un toucher la referme.
    const portrait = h('span', 'st-radio-portrait');
    portrait.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="25" r="11" fill="currentColor"/><path d="M10 64c0-14 9.5-22 22-22s22 8 22 22z" fill="currentColor"/></svg>';
    portrait.append(this.radioBadge);
    this.radio = btn('st-radio', null, portrait,
      h('span', 'st-radio-body', h('span', 'st-radio-top', this.radioName, this.radioRole, art('wave', 'st-radio-wave')), this.radioText));
    this.radio.hidden = true;
    this.radio.addEventListener('click', () => this.hideRadio());

    // (c) Carton de fin de chapitre : dans la moitié haute, voile en dégradé qui laisse voir le personnage.
    this.cardGo = btn('dr-btn dr-btn-wide st-card-go', null, 'Continuer');
    const box = h('section', 'st-card-box',
      this.cardKicker, h('span', 'st-card-rule', art('signal')), this.cardTitle, this.cardText, this.cardNext, this.cardGo);
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Fin de chapitre');
    box.tabIndex = -1;
    this.card = h('div', 'st-card', h('div', 'st-card-veil'), box);
    this.card.hidden = true;
    this.cardGo.addEventListener('click', () => this.closeCard());

    const live = h('div', 'st-live', this.radio);
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    this.layer = h('div', 'st-layer', this.goal, live, this.card);
    root.append(this.layer);

    this.off = story.on((e) => this.onStory(e));
    this.renderGoal();
    this.fold(this.folded);
  }

  /** (d) Panneau « Histoire » : chapitres et étapes, celles à venir masquées. */
  openJournal(): void {
    if (!this.journal) {
      this.journal = new Panel(this.root, 'dr-panel-tall st-journal', 'Histoire');
      this.journal.head.append(h('span', 'dr-kicker', 'Carnet du porteur'), h('h2', 'dr-title', 'Histoire'));
      this.journal.foot.setAttribute('data-empty', '1');
    }
    this.renderJournal();
    this.journal.open();
  }

  /**
   * Ferme tout de suite le message radio affiché. Ceux qui attendaient sont oubliés (démo), sauf avec
   * `keep` (retour au labo, prologue) : ils seront montrés au retour sur la carte.
   */
  dismissRadio(keep = false): void {
    if (!keep) this.pending.length = 0;
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    if (this.radioTimer) { clearTimeout(this.radioTimer); this.radioTimer = null; }
    this.radio.hidden = true;
    if (this.card.hidden) this.goal.classList.remove('is-away');
    this.space();
    if (this.pending.length) this.nextRadio();
  }
  /** Referme le panneau « Histoire » s'il est ouvert. */
  closeJournal(): void { this.journal?.close(); }

  /** Retire l'interface (changement d'écran, tests). */
  destroy(): void {
    this.off();
    if (this.radioTimer) clearTimeout(this.radioTimer);
    if (this.retry) clearTimeout(this.retry);
    this.layer.remove();
    this.journal?.el.remove();
    this.root.classList.remove('dr-has-story');
    this.root.style.removeProperty('--st-h');
  }

  // ---------- Événements de l'histoire ----------

  private onStory(e: StoryEvent): void {
    if (e.type === 'radio') {
      this.pending.push({ who: e.who, text: e.text });
      if (this.pending.length > 2) this.pending.shift(); // on ne garde que les plus récents
      this.nextRadio();
    } else if (e.type === 'chapter') {
      this.renderGoal();
      if (!e.silent) this.showCard(e.chapter, e.title, e.text, e.next);
    } else {
      this.renderGoal();
      if (e.type === 'step' && e.phase === 'début') this.goal.classList.add('is-new');
    }
    if (this.journal?.isOpen) this.renderJournal();
  }

  // ---------- Objectif ----------

  private renderGoal(): void {
    const s = this.story.state();
    setText(this.goalText, s.objective);
    setText(this.goalCount, s.m > 1 ? `${fmtN(s.n)}/${fmtN(s.m)}` : '');
    setText(this.goalStep, s.finished ? '' : `${s.step}/${s.stepCount}`);
    this.goal.classList.toggle('is-done', s.finished);
    this.goalBtn.setAttribute('aria-label', `Objectif : ${s.objective}. ${this.folded ? 'Déplier' : 'Replier'}`);
  }

  private fold(on: boolean): void {
    this.folded = on;
    this.goal.classList.toggle('is-folded', on);
    this.goal.classList.remove('is-new');
    this.goalBtn.setAttribute('aria-expanded', String(!on));
    try { localStorage.setItem(UI_KEY, on ? '1' : '0'); } catch { /* stockage indisponible */ }
    this.renderGoal();
    this.space();
  }

  /** Dit aux toasts du HUD où commencer : sous le bandeau, ou sous la carte radio quand elle est là. */
  private space(): void {
    const px = this.radio.hidden ? 44 : Math.max(44, Math.ceil(this.radio.offsetHeight) + 6);
    this.root.style.setProperty('--st-h', `${px}px`);
  }

  // ---------- Radio ----------

  /** Vrai si un écran plein (note de livraison, panneau, carton) occupe le joueur : le message attend. */
  private busy(): boolean {
    // L'aide de première ouverture passe d'abord : le message radio vient ensuite, pas en même temps.
    return !this.card.hidden || this.opts.hold?.() === true || !!this.root.querySelector('.dr-grade:not([hidden]), .dr-modal:not([hidden]), .dr-help:not([hidden])');
  }

  private nextRadio(): void {
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    if (!this.pending.length) return;
    if (this.busy()) { this.retry = setTimeout(() => this.nextRadio(), 700); return; }
    const m = this.pending.shift()!;
    const w = WHO[m.who];
    this.radio.style.setProperty('--who', w.color);
    setText(this.radioBadge, w.name[0]);
    setText(this.radioName, w.name);
    setText(this.radioRole, w.role);
    setText(this.radioText, typo(m.text));
    this.radio.setAttribute('aria-label', `Message radio de ${w.name} : ${m.text}. Toucher pour fermer.`);
    this.radio.hidden = false;
    this.radio.classList.remove('is-out');
    // Relance l'animation d'entrée quand un message en remplace un autre.
    this.radio.style.animation = 'none';
    void this.radio.offsetWidth;
    this.radio.style.animation = '';
    this.goal.classList.add('is-away');
    this.space();
    this.opts.onVoice?.(m.who, m.text);
    if (this.radioTimer) clearTimeout(this.radioTimer);
    this.radioTimer = setTimeout(() => this.hideRadio(), readMs(m.text));
  }

  private hideRadio(): void {
    if (this.radioTimer) { clearTimeout(this.radioTimer); this.radioTimer = null; }
    if (this.radio.hidden) return;
    this.radio.classList.add('is-out');
    setTimeout(() => {
      if (!this.radio.classList.contains('is-out')) return; // un autre message est arrivé entre-temps
      this.radio.hidden = true;
      if (this.card.hidden) this.goal.classList.remove('is-away');
      this.space();
      if (this.pending.length) this.nextRadio();
    }, 240);
  }

  // ---------- Carton de fin de chapitre ----------

  private showCard(no: number, title: string, text: string, next: string | null): void {
    setText(this.cardKicker, `Chapitre ${no} terminé`);
    setText(this.cardTitle, title);
    setText(this.cardText, typo(text));
    setText(this.cardNext, next ? `À suivre\u00a0: ${next}` : 'Fin de l’histoire, pour l’instant.');
    // Une note de livraison ou un panneau est ouvert : le carton attend son tour.
    if (this.opts.hold?.() === true || this.root.querySelector('.dr-grade:not([hidden]), .dr-modal:not([hidden])')) {
      setTimeout(() => this.showCard(no, title, text, next), 700);
      return;
    }
    this.hideRadio();
    this.card.hidden = false;
    this.goal.classList.add('is-away');
    (this.card.querySelector('.st-card-box') as HTMLElement).focus({ preventScroll: true });
  }

  private closeCard(): void {
    this.card.hidden = true;
    this.goal.classList.remove('is-away');
    if (this.pending.length) this.nextRadio();
  }

  // ---------- Journal ----------

  private renderJournal(): void {
    if (!this.journal) return;
    const out: HTMLElement[] = [];
    for (const c of this.story.journal()) {
      const sec = h('section', 'st-j-ch');
      sec.dataset.status = c.status === 'faite' ? 'done' : c.status === 'en cours' ? 'now' : 'next';
      const tag = c.status === 'faite' ? 'Terminé' : c.status === 'en cours' ? 'En cours' : 'À venir';
      sec.append(h('div', 'st-j-head',
        h('span', 'st-j-no', `Chapitre ${c.no}`), h('span', 'st-j-tag', tag),
        h('h3', 'st-j-title', c.status === 'à venir' ? 'Signal non reçu' : c.title)));
      if (c.status === 'à venir') { out.push(sec); continue; }
      const list = h('ul', 'st-j-steps');
      let hidden = 0;
      for (const s of c.steps) {
        if (s.status === 'à venir') { hidden++; continue; }
        const li = h('li', 'st-j-step', h('span', 'st-j-mark', s.status === 'faite' ? icon('check') : null), h('span', 'st-j-obj', s.objective));
        li.dataset.status = s.status === 'faite' ? 'done' : 'now';
        if (s.status === 'en cours' && s.m > 1) li.append(h('span', 'st-j-count', `${fmtN(s.n)}/${fmtN(s.m)}`));
        list.append(li);
      }
      if (hidden) {
        const li = h('li', 'st-j-step', h('span', 'st-j-mark', icon('lock')), h('span', 'st-j-obj', hidden > 1 ? `${hidden} étapes à venir` : '1 étape à venir'));
        li.dataset.status = 'next';
        list.append(li);
      }
      sec.append(list);
      if (c.ending) sec.append(h('p', 'st-j-end', typo(c.ending)));
      out.push(sec);
    }
    this.journal.body.replaceChildren(...out);
  }
}
