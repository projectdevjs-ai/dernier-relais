// Fil conducteur de l'histoire. Ce module OBSERVE le jeu (événements et vue du contrat) : il n'appelle jamais le moteur.
// Il tient des compteurs cumulés, fait avancer les étapes de src/story/chapters.ts et émet des messages radio,
// au plus un toutes les 8 secondes. Rien ici ne bloque le jeu : si le stockage manque ou si des événements
// arrivent dans le désordre, l'histoire continue.
import type { GameEvent, GameView } from '../game/api';
import { AFTER, CHAPTERS, STATS, type Chapter, type Cond, type Radio, type Stat, type Step, type Who } from './chapters';

export type StoryEvent =
  /** Message radio à afficher (et à dire). */
  | { type: 'radio'; who: Who; text: string }
  /** Une étape commence ou se termine. `silent` : rattrapage d'une étape déjà remplie, sans message. */
  | { type: 'step'; phase: 'début' | 'fin'; chapter: number; step: number; id: string; objective: string; silent: boolean }
  /** Un chapitre vient de se terminer. `chapter` : numéro à partir de 1. `silent` : rattrapage, pas de carton. */
  | { type: 'chapter'; chapter: number; title: string; text: string; next: string | null; silent: boolean }
  /** Le compteur de l'étape en cours a bougé. */
  | { type: 'progress'; n: number; m: number };

export interface StoryState {
  /** Numéro du chapitre en cours, à partir de 1. */
  chapter: number;
  chapterTitle: string;
  chapterCount: number;
  /** Numéro de l'étape en cours dans le chapitre, à partir de 1, et nombre d'étapes du chapitre. */
  step: number;
  stepCount: number;
  stepId: string | null;
  /** Objectif en une ligne. */
  objective: string;
  /** Progression de l'objectif : n sur m (m vaut 1 pour les objectifs sans compteur). */
  n: number;
  m: number;
  /** Toute l'histoire écrite est terminée. */
  finished: boolean;
}

export type StepStatus = 'faite' | 'en cours' | 'à venir';
export interface JournalChapter {
  no: number; title: string; intent: string; status: StepStatus;
  /** Phrase de fin, seulement quand le chapitre est terminé. */
  ending: string | null;
  steps: { id: string; objective: string; status: StepStatus; n: number; m: number }[];
}

export interface StoryOpts {
  /** Stockage de la progression. Par défaut localStorage ; null : rien n'est mémorisé. */
  storage?: Storage | null;
  /** Horloge en millisecondes (tests). */
  now?: () => number;
}

export const STORY_KEY = 'dernier-relais/histoire';
/** Écart minimal entre deux messages radio. */
export const RADIO_GAP_MS = 8000;
/** Un message de fin d'étape encore en file après ce délai est abandonné. */
export const STALE_MS = 45000;
/** Le carton de fin de chapitre attend que le dernier message ait été lu. */
export const CARD_GAP_MS = 5000;
/** Premier message : laisse au joueur le temps d'arriver. */
const FIRST_DELAY_MS = 1500;
/** État à partir duquel un colis fragile compte comme « en bon état ». */
const INTACT = 0.9;
const ROUGH_NOTE = /nuit|pluie|orage|neige|brouillard|front/i;

type Stats = Record<Stat, number>;
type Queued =
  | { kind: 'radio'; ev: StoryEvent; stepId: string; role: 'start' | 'done'; at: number }
  | { kind: 'card'; ev: StoryEvent };

const zero = (): Stats => Object.fromEntries(STATS.map(k => [k, 0])) as Stats;
const met = (c: Cond | undefined, s: Stats): boolean => !!c && s[c.stat] >= c.goal;

function defaultStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export class Story {
  private storage: Storage | null;
  private now: () => number;
  private stats = zero();
  /** Position : indice du chapitre et de l'étape. ci === CHAPTERS.length : histoire terminée. */
  private ci = 0;
  private si = 0;
  private listeners = new Set<(s: StoryEvent) => void>();
  private queue: Queued[] = [];
  private lastRadioAt: number;
  /** L'étape en cours a été annoncée (son message de départ est parti en file). */
  private announced = false;
  /** Identifiants des colis fragiles vus dans le sac. */
  private fragile = new Set<string>();
  private rough = false;
  private inFront = false;
  private lastN = -1;
  private dirty = false;
  private needSave = false;

  constructor(opts: StoryOpts = {}) {
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.now = opts.now ?? (() => Date.now());
    this.lastRadioAt = this.now() - RADIO_GAP_MS + FIRST_DELAY_MS;
    this.load();
  }

  /** S'abonne aux événements de l'histoire. Renvoie la fonction de désabonnement. */
  on(fn: (s: StoryEvent) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Événement du jeu. L'ordre d'arrivée n'a pas d'importance : chaque événement ne fait qu'augmenter des compteurs. */
  handle(e: GameEvent): void {
    const s = this.stats;
    switch (e.type) {
      case 'scan': s.scans++; break;
      case 'pickup':
        s.ramassages++;
        if (e.order.fragile) this.fragile.add(e.order.id);
        break;
      case 'delivery': {
        const r = e.result;
        s.livraisons++;
        if (r.grade === 'A' || r.grade === 'S') s.notesA++;
        if (r.grade === 'S') s.notesS++;
        const frag = this.fragile.delete(r.orderId) || r.notes.some(n => /fragile/i.test(n));
        if (frag && r.condition >= INTACT) s.fragiles++;
        if (this.rough || this.inFront || r.notes.some(n => ROUGH_NOTE.test(n))) s.rudes++;
        if (r.special) s.speciaux++;
        if (r.lostBy) s.perdus++;
        if (r.starsAfter > 0) s.relies = Math.max(s.relies, 1);
        if (r.starsAfter >= 3) s.abris3 = Math.max(s.abris3, 1);
        if (r.starsAfter >= 5) s.abris5 = Math.max(s.abris5, 1);
        break;
      }
      case 'inspect': s.ecoutes++; break;
      case 'strap': s.arrimages++; break;
      case 'cache': s.caches++; break;
      case 'wanderer': s.rencontres++; break;
      case 'front':
        if (e.phase === 'entrée') this.inFront = true;
        else if (e.phase === 'sortie') { this.inFront = false; s.fronts++; }
        break;
      case 'jam': if (e.phase === 'réussi') s.lots++; break;
      case 'proof': s.preuves++; break;
      case 'drop': this.fragile.delete(e.orderId); break;
      default: return; // toast, levelUp, contract, danger, special : rien à compter
    }
    this.infer();
    this.dirty = true;
    this.needSave = true;
    this.advance();
    this.drain();
    this.flush();
  }

  /** Vue du jeu, cinq fois par seconde : quelques comparaisons, aucune allocation notable. */
  observe(view: GameView): void {
    const s = this.stats, p = view.player;
    let linked = 0, three = 0, five = 0;
    for (const sh of view.shelters) {
      if (sh.stars > 0) linked++;
      if (sh.stars >= 3) three++;
      if (sh.stars >= 5) five++;
    }
    this.raise('relies', linked);
    this.raise('abris3', three);
    this.raise('abris5', five);
    this.raise('livraisons', p.deliveries);
    // La distance bouge sans cesse : on ne la retient qu'au dixième de kilomètre.
    const km = Math.floor(p.distanceKm * 10) / 10;
    this.raise('km', km);
    let carried = false;
    for (const o of view.orders) {
      if (o.state !== 'porté') continue;
      carried = true;
      if (o.fragile) this.fragile.add(o.id);
    }
    if (carried) this.raise('ramassages', 1);
    if (view.orders.length > 0) this.raise('scans', 1);
    const w = view.weather;
    this.rough = w.night || w.kind === 'pluie' || w.kind === 'orage' || w.kind === 'neige' || w.kind === 'brouillard';
    if (view.fronts) {
      let inside = false;
      for (const f of view.fronts) if (f.inside) inside = true;
      this.inFront = inside;
    }
    if (this.dirty) { this.infer(); this.advance(); }
    this.drain();
    this.flush();
  }

  state(): StoryState {
    const ch = CHAPTERS[this.ci];
    if (!ch) {
      const last = CHAPTERS[CHAPTERS.length - 1];
      return {
        chapter: CHAPTERS.length, chapterTitle: last.title, chapterCount: CHAPTERS.length,
        step: last.steps.length, stepCount: last.steps.length, stepId: null, objective: AFTER, n: 1, m: 1, finished: true,
      };
    }
    const st = ch.steps[this.si];
    return {
      chapter: this.ci + 1, chapterTitle: ch.title, chapterCount: CHAPTERS.length,
      step: this.si + 1, stepCount: ch.steps.length, stepId: st.id, objective: st.objective,
      n: this.count(st), m: st.cond.goal, finished: false,
    };
  }

  /** Contenu du panneau « Histoire ». Les étapes à venir sont listées, l'interface choisit de les masquer. */
  journal(): JournalChapter[] {
    return CHAPTERS.map((c, i) => {
      const status: StepStatus = i < this.ci ? 'faite' : i === this.ci ? 'en cours' : 'à venir';
      return {
        no: i + 1, title: c.title, intent: c.intent, status, ending: status === 'faite' ? c.ending : null,
        steps: c.steps.map((st, j) => {
          const ss: StepStatus = i < this.ci || (i === this.ci && j < this.si) ? 'faite' : i === this.ci && j === this.si ? 'en cours' : 'à venir';
          return { id: st.id, objective: st.objective, status: ss, n: ss === 'faite' ? st.cond.goal : this.count(st), m: st.cond.goal };
        }),
      };
    });
  }

  /** Efface la progression (réglages, démo, tests). */
  reset(): void {
    this.stats = zero();
    this.ci = 0; this.si = 0;
    this.queue = [];
    this.announced = false;
    this.fragile.clear();
    this.lastN = -1;
    this.dirty = true;
    this.needSave = true;
    this.flush();
  }

  // ---------- Compteurs ----------

  private raise(k: Stat, v: number): void {
    if (v > this.stats[k]) {
      this.stats[k] = v;
      this.dirty = true;
      this.needSave = true;
    }
  }

  /** Ce qu'on peut déduire sans l'avoir vu : qui a livré a forcément scanné et ramassé. */
  private infer(): void {
    const s = this.stats;
    if (s.livraisons > 0 || s.relies > 0) {
      if (s.ramassages < 1) s.ramassages = 1;
      if (s.livraisons < 1) s.livraisons = 1;
    }
    if (s.ramassages > 0 && s.scans < 1) s.scans = 1;
    if (s.notesS > s.notesA) s.notesA = s.notesS;
  }

  private count(st: Step): number {
    return Math.min(this.stats[st.cond.stat], st.cond.goal);
  }

  // ---------- Progression ----------

  private current(): { ch: Chapter; st: Step } | null {
    const ch = CHAPTERS[this.ci];
    return ch ? { ch, st: ch.steps[this.si] } : null;
  }

  /**
   * Fait avancer l'histoire tant que l'étape en cours est remplie. Seule une étape déjà annoncée au joueur
   * a droit à son message de fin ; les étapes remplies d'avance sont passées en silence.
   */
  private advance(): void {
    this.dirty = false;
    for (let guard = 0; guard < 200; guard++) {
      const cur = this.current();
      if (!cur) return;
      const { ch, st } = cur;
      if (!met(st.cond, this.stats) && !met(st.orElse, this.stats)) {
        if (!this.announced) {
          this.announced = true;
          this.lastN = this.count(st);
          this.emit({ type: 'step', phase: 'début', chapter: this.ci + 1, step: this.si + 1, id: st.id, objective: st.objective, silent: false });
          this.radio(st.start, st.id, 'start');
        } else {
          const n = this.count(st);
          if (n !== this.lastN) { this.lastN = n; this.emit({ type: 'progress', n, m: st.cond.goal }); }
        }
        return;
      }
      const silent = !this.announced;
      this.emit({ type: 'step', phase: 'fin', chapter: this.ci + 1, step: this.si + 1, id: st.id, objective: st.objective, silent });
      if (!silent) this.radio(st.done, st.id, 'done');
      this.announced = false;
      this.needSave = true;
      if (this.si + 1 < ch.steps.length) { this.si++; continue; }
      // Fin de chapitre.
      const next = CHAPTERS[this.ci + 1]?.title ?? null;
      const ev: StoryEvent = { type: 'chapter', chapter: this.ci + 1, title: ch.title, text: ch.ending, next, silent };
      this.ci++; this.si = 0;
      if (silent) this.emit(ev); else this.queue.push({ kind: 'card', ev });
    }
  }

  // ---------- File des messages ----------

  private radio(r: Radio, stepId: string, role: 'start' | 'done'): void {
    this.queue.push({ kind: 'radio', ev: { type: 'radio', who: r.who, text: r.text }, stepId, role, at: this.now() });
  }

  /** Vrai si le message n'a plus de raison d'être dit. */
  private stale(q: Queued, t: number): boolean {
    if (q.kind !== 'radio') return false;
    if (q.role === 'start') return this.current()?.st.id !== q.stepId; // l'étape est déjà passée
    return t - q.at > STALE_MS;
  }

  /** Sort au plus un élément de la file, si le délai depuis le dernier message est écoulé. */
  private drain(): void {
    if (!this.queue.length) return;
    const t = this.now();
    while (this.queue.length && this.stale(this.queue[0], t)) this.queue.shift();
    const head = this.queue[0];
    if (!head) return;
    if (t - this.lastRadioAt < (head.kind === 'card' ? CARD_GAP_MS : RADIO_GAP_MS)) return;
    this.queue.shift();
    if (head.kind === 'radio') this.lastRadioAt = t;
    this.emit(head.ev);
  }

  private emit(e: StoryEvent): void {
    for (const fn of this.listeners) {
      try { fn(e); } catch { /* un écouteur en panne ne doit pas arrêter l'histoire */ }
    }
  }

  // ---------- Mémoire ----------

  private load(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORY_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as { v?: number; c?: unknown; s?: unknown; stats?: Record<string, unknown> };
      if (d.v !== 1) return;
      for (const k of STATS) {
        const n = d.stats?.[k];
        if (typeof n === 'number' && Number.isFinite(n) && n > 0) this.stats[k] = n;
      }
      const c = typeof d.c === 'number' ? Math.max(0, Math.min(CHAPTERS.length, Math.floor(d.c))) : 0;
      const maxS = (CHAPTERS[c]?.steps.length ?? 1) - 1;
      this.ci = c;
      this.si = typeof d.s === 'number' ? Math.max(0, Math.min(maxS, Math.floor(d.s))) : 0;
      this.dirty = true;
    } catch { /* sauvegarde illisible : on repart du début, les compteurs se rattrapent par la vue */ }
  }

  private flush(): void {
    if (!this.needSave) return;
    this.needSave = false;
    if (!this.storage) return;
    try { this.storage.setItem(STORY_KEY, JSON.stringify({ v: 1, c: this.ci, s: this.si, stats: this.stats })); } catch { /* stockage plein ou interdit */ }
  }
}
