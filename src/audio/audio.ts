// Le son du jeu : une seule classe à brancher. Tout est synthétisé (aucun fichier son).
//   const son = new Sound();                       // rien n'est créé tant que le joueur n'a pas touché l'écran
//   addEventListener('pointerdown', () => son.unlock());
//   game.on(e => son.handle(e));                   // sons et vibrations des événements
//   son.ambient(view);                             // à chaque image de jeu : nappe, pas, alerte d'équilibre
import type { GameEvent, GameView, Grade } from '../game/api';
import { Ambience, ambientInput } from './ambience';
import { Rig } from './rig';
import { SOUNDS, type SoundName, play } from './sounds';

export { MAX_VOICES } from './rig';
export interface SoundOptions { volume?: number; muted?: boolean; haptics?: boolean }
export type UiKind = 'tap' | 'open' | 'close' | 'error' | 'confirm';

/** Durée totale maximale d'une vibration, pauses comprises (ms). */
export const HAPTIC_MAX_MS = 400;
/** Motifs de vibration : durées en ms, alternance vibration / pause. Tous distincts, tous sous 400 ms. */
export const HAPTICS = {
  scan: [18],
  pickup: [30, 40, 20],
  drop: [45],
  deliveryE: [70],
  deliveryD: [40],
  deliveryC: [25, 50, 25],
  deliveryB: [20, 40, 20, 40, 30],
  deliveryA: [15, 35, 15, 35, 15, 35, 45],
  deliveryS: [15, 30, 15, 30, 15, 30, 15, 30, 70],
  star: [60, 90],
  levelUp: [30, 50, 30, 50, 90],
  contract: [20, 40, 60],
  dangerIn: [120, 60, 120],
  dangerOut: [30],
  warn: [35],
  error: [25, 40, 25],
  confirm: [15],
} as const satisfies Record<string, readonly number[]>;

/** Coupe un motif pour que sa durée totale ne dépasse jamais HAPTIC_MAX_MS. */
export function clampPattern(pattern: readonly number[]): number[] {
  const out: number[] = [];
  let total = 0;
  for (const ms of pattern) {
    const d = Math.max(0, Math.min(ms, HAPTIC_MAX_MS - total));
    if (d <= 0) break;
    out.push(d); total += d;
  }
  if (out.length % 2 === 0) out.pop(); // un motif ne finit pas sur une pause
  return out;
}

const UI: Record<UiKind, SoundName> = { tap: 'uiTap', open: 'uiOpen', close: 'uiClose', error: 'uiError', confirm: 'uiConfirm' };
const GRADES: Record<Grade, SoundName> = { E: 'deliveryE', D: 'deliveryD', C: 'deliveryC', B: 'deliveryB', A: 'deliveryA', S: 'deliveryS' };
/** Une phrase (jingle) attend la fin de la précédente, mais jamais plus longtemps que ça : au-delà, elle est abandonnée. */
const MAX_QUEUE_S = 2.5;
/** Le même son n'est pas rejoué à moins de cet intervalle (événements en rafale dans la même image). */
const MIN_GAP_S = 0.06;

type Ctor = new () => AudioContext;

export class Sound {
  private ctx: AudioContext | null = null;
  private rig: Rig | null = null;
  private amb: Ambience | null = null;
  private unlocked = false;
  private volume: number;
  private muted: boolean;
  private haptics: boolean;
  private paused = false;
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;
  private phraseEnd = 0;
  private levelUpQuietUntil = 0;
  private lastPlayed = new Map<SoundName, number>();

  constructor(opts: SoundOptions = {}) {
    this.volume = Math.max(0, Math.min(1, opts.volume ?? 0.8));
    this.muted = opts.muted ?? false;
    this.haptics = opts.haptics ?? true;
  }

  /** À appeler dans un geste du joueur (premier toucher). Crée le contexte audio ; sans effet les fois suivantes. */
  unlock(): void {
    this.unlocked = true;
    try {
      if (!this.ctx) {
        const g = globalThis as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
        const AC = g.AudioContext ?? g.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.rig = new Rig(this.ctx, { volume: 0 });
        this.amb = new Ambience(this.rig);
      }
      this.power();
    } catch { this.ctx = null; this.rig = null; this.amb = null; /* pas de son sur cet appareil : le jeu continue */ }
  }

  /** Vrai une fois le son débloqué et le contexte créé. */
  get ready(): boolean { return this.rig !== null; }
  /** Voix ponctuelles réservées et non terminées (pour les essais). */
  get voices(): number { return this.rig?.voices ?? 0; }
  /** Plus grand nombre de voix simultanées, maintenant ou programmées (pour les essais). */
  get peakVoices(): number { return this.rig?.peakVoices ?? 0; }

  /** Son et vibration d'un événement du jeu. Les événements inconnus sont ignorés. */
  handle(e: GameEvent): void {
    if (!this.unlocked) return;
    try {
      switch (e.type) {
        case 'scan':
          if (e.found > 0) { this.play('scan', Math.min(3, e.found) / 3); this.buzz(HAPTICS.scan); }
          else this.play('scanEmpty');
          break;
        case 'pickup':
          this.play('pickup', Math.min(1, e.order.weightKg / 20));
          this.buzz(HAPTICS.pickup);
          break;
        case 'drop': this.play('drop'); this.buzz(HAPTICS.drop); break;
        case 'delivery': {
          const r = e.result, name = GRADES[r.grade] ?? 'deliveryC', star = r.starsAfter > r.starsBefore;
          const t = this.phrase(name);
          if (t !== null) {
            if (star) { play(this.rig!, 'star', this.phraseEnd - 0.15); this.phraseEnd += SOUNDS.star.next; }
            if (r.levelUp) {
              play(this.rig!, 'levelUp', this.phraseEnd + 0.05); this.phraseEnd += 0.05 + SOUNDS.levelUp.next;
              // Le jeu envoie aussi un événement levelUp juste après : il ne doit pas rejouer la montée de niveau.
              this.levelUpQuietUntil = this.rig!.ctx.currentTime + 1.5;
            }
          }
          this.buzz(star ? [...HAPTICS[name as keyof typeof HAPTICS], 70, ...HAPTICS.star] : HAPTICS[name as keyof typeof HAPTICS]);
          break;
        }
        case 'levelUp':
          if (this.rig && this.rig.ctx.currentTime < this.levelUpQuietUntil) break;
          this.phrase('levelUp'); this.buzz(HAPTICS.levelUp);
          break;
        case 'contract': this.phrase('contract'); this.buzz(HAPTICS.contract); break;
        case 'danger':
          this.play(e.entered ? 'dangerIn' : 'dangerOut');
          this.buzz(e.entered ? HAPTICS.dangerIn : HAPTICS.dangerOut);
          break;
        case 'toast':
          this.play(e.tone === 'good' ? 'toastGood' : e.tone === 'warn' ? 'toastWarn' : 'toastInfo');
          if (e.tone === 'warn') this.buzz(HAPTICS.warn);
          break;
        default: break; // le contrat s'enrichira (caches, rôdeurs, fronts…) : rien à faire tant que le son n'est pas écrit
      }
    } catch { /* un son raté ne doit jamais interrompre le jeu */ }
  }

  /** Nappe d'ambiance, pas et alerte d'équilibre. À appeler régulièrement (au moins deux fois par seconde). */
  ambient(view: GameView): void {
    if (!this.audible()) return;
    try { this.wake(); this.amb!.update(ambientInput(view)); } catch { /* voir handle */ }
  }

  /** Sons de l'interface. */
  ui(kind: UiKind): void {
    if (!this.unlocked) return;
    const name = UI[kind];
    if (!name) return;
    try {
      this.play(name);
      if (kind === 'error') this.buzz(HAPTICS.error);
      if (kind === 'confirm') this.buzz(HAPTICS.confirm);
    } catch { /* voir handle */ }
  }

  /** Volume général de 0 à 1. À 0, la nappe est détruite et le contexte audio mis en veille. */
  setVolume(v: number): void { this.volume = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)); this.power(); }
  /** Coupe ou rétablit tout le son (les vibrations se règlent à part, avec setHaptics). */
  setMuted(m: boolean): void { this.muted = m; this.power(); }
  setHaptics(h: boolean): void {
    this.haptics = h;
    if (!h) try { navigator.vibrate?.(0); } catch { /* pas de vibreur */ }
  }
  /** L'appli passe en arrière-plan : fondu, nappe détruite, contexte audio mis en veille. */
  suspend(): void { this.paused = true; this.power(); }
  /** L'appli revient au premier plan. */
  resume(): void { this.paused = false; this.power(); }

  private audible(): boolean { return this.rig !== null && !this.muted && !this.paused && this.volume > 0; }

  /** Applique volume, coupure et veille, toujours en fondu. */
  private power(): void {
    const rig = this.rig, ctx = this.ctx;
    if (!rig || !ctx) return;
    if (this.sleepTimer !== null) { clearTimeout(this.sleepTimer); this.sleepTimer = null; }
    const now = ctx.currentTime, on = this.audible();
    rig.out.gain.cancelScheduledValues(now);
    // Curseur au carré : la progression du volume paraît régulière à l'oreille.
    rig.out.gain.setTargetAtTime(on ? this.volume * this.volume : 0, now, on ? 0.05 : 0.03);
    if (on) { this.wake(); return; }
    this.amb?.stop();
    this.phraseEnd = 0;
    // Le contexte s'endort une fois le fondu terminé : plus aucun calcul audio tant que le son est coupé.
    this.sleepTimer = setTimeout(() => { this.sleepTimer = null; if (!this.audible()) void ctx.suspend().catch(() => { /* déjà fermé */ }); }, 300);
  }

  /** Réveille le contexte s'il dort (veille volontaire, ou coupure imposée par le téléphone : appel, écran éteint). */
  private wake(): void {
    const ctx = this.ctx;
    if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => { /* le prochain geste réessaiera */ });
  }

  /** Joue un son tout de suite. */
  private play(name: SoundName, v = 0, w = 0): void {
    if (!this.audible()) return;
    const rig = this.rig!, now = rig.ctx.currentTime, prev = this.lastPlayed.get(name);
    if (prev !== undefined && now - prev < MIN_GAP_S && now >= prev) return;
    this.lastPlayed.set(name, now);
    this.wake();
    play(rig, name, now + 0.012, v, w);
  }

  /** Joue une phrase musicale à la suite de la précédente. Renvoie son instant de départ, ou null si elle est abandonnée. */
  private phrase(name: SoundName): number | null {
    if (!this.audible()) return null;
    const rig = this.rig!, now = rig.ctx.currentTime, t = Math.max(now + 0.012, this.phraseEnd);
    if (t - now > MAX_QUEUE_S) return null;
    this.wake();
    play(rig, name, t);
    this.phraseEnd = t + SOUNDS[name].next;
    return t;
  }

  private buzz(pattern: readonly number[]): void {
    if (!this.haptics || !this.unlocked) return;
    try { if (typeof navigator !== 'undefined') navigator.vibrate?.(clampPattern(pattern)); } catch { /* pas de vibreur */ }
  }
}

/** Autre nom de la même classe. `Sound` évite de masquer le constructeur `Audio` du navigateur. */
export { Sound as Audio };
