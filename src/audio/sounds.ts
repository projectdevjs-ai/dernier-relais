// Catalogue des sons ponctuels. Chaque son est une petite partition écrite avec les deux briques du banc
// (note, souffle), dans une seule gamme : ré mineur pentatonique (ré, fa, sol, la, do).
// Les sons ne dépendent que du banc : on peut les jouer en direct ou les rendre hors ligne pour les mesurer.
import { type NoiseOpts, type Prio, type Rig, type ToneOpts, noise, tone } from './rig';

const D4 = 293.665;
const SCALE = [0, 3, 5, 7, 10];
/** Fréquence du degré i de la gamme, 0 = ré4, 5 = ré5, −5 = ré3… */
export function n(i: number): number {
  const oct = Math.floor(i / 5);
  return D4 * 2 ** (oct + SCALE[i - oct * 5] / 12);
}

export type SoundName =
  | 'scan' | 'scanEmpty' | 'pickup' | 'drop'
  | 'deliveryE' | 'deliveryD' | 'deliveryC' | 'deliveryB' | 'deliveryA' | 'deliveryS'
  | 'star' | 'levelUp' | 'contract' | 'dangerIn' | 'dangerOut'
  | 'toastInfo' | 'toastGood' | 'toastWarn'
  | 'uiTap' | 'uiOpen' | 'uiClose' | 'uiError' | 'uiConfirm'
  | 'step' | 'pulse' | 'nightNote' | 'thunder'
  | 'special' | 'cacheOpen' | 'wanderer' | 'frontNear' | 'frontIn' | 'frontOut'
  | 'jamStart' | 'jamWon' | 'jamLost' | 'inspect' | 'strap' | 'proof';

/** Outils d'écriture d'un son : mêmes briques que le banc, niveau et priorité déjà réglés. */
interface Kit {
  tone(o: ToneOpts): void;
  noise(o: NoiseOpts): void;
  rand(): number;
}

export interface SoundDef {
  /** Durée totale prévue, queue de réverbération comprise (secondes). */
  dur: number;
  /** Temps après lequel une autre phrase peut s'enchaîner sans se marcher dessus. */
  next: number;
  prio: Prio;
  /** Réglage de niveau, ajusté d'après les mesures hors ligne pour équilibrer les sons entre eux. */
  trim: number;
  /** 'jeu' : événements et interface (niveaux comparables). 'ambiance' : détails de la nappe, volontairement plus bas. */
  family: 'jeu' | 'ambiance';
  /** v et w : variations de 0 à 1 propres à chaque son (nombre de colis, poids, charge, pluie…). */
  make(k: Kit, t: number, v: number, w: number): void;
}

/** Note de carillon doux : sinus avec un peu de modulation à l'attaque, plus brillante quand `bright` monte. */
function bell(k: Kit, t: number, i: number, gain: number, dur: number, bright = 0.5, send = 0.45): void {
  k.tone({ f: n(i), t, dur, gain, attack: 0.005, fm: { ratio: bright > 0.9 ? 3 : 2, index: bright, decay: 0.16 }, send });
}
/** Note feutrée : triangle filtré, pour les registres graves et les notes sobres. */
function felt(k: Kit, t: number, i: number, gain: number, dur: number, lp = 1400, send = 0.35): void {
  k.tone({ f: n(i), t, dur, gain, attack: 0.012, type: 'triangle', lp, send });
}
/** Choc sourd : souffle grave + sinus qui tombe (prise, pose, tampon). */
function thud(k: Kit, t: number, f: number, gain: number, dur = 0.1): void {
  k.noise({ t, dur, gain, f: f * 2.6, type: 'lowpass', q: 0.7, attack: 0.002 });
  k.tone({ f, to: f * 0.55, glide: dur * 0.8, t, dur: dur * 1.5, gain: gain * 0.75, attack: 0.003 });
}

export const SOUNDS: Record<SoundName, SoundDef> = {
  // Sonar : un ping, un anneau de souffle qui s'élargit, des échos de plus en plus lointains,
  // puis une réponse aiguë par colis trouvé (v = colis trouvés / 3, plafonné à 1).
  scan: {
    dur: 1.7, next: 0.9, prio: 2, trim: 1, family: 'jeu',
    make(k, t, v) {
      k.tone({ f: n(5), to: n(5) * 0.985, t, dur: 0.6, gain: 0.3, attack: 0.004, fm: { ratio: 2, index: 1.1, decay: 0.07 }, send: 0.5 });
      k.noise({ t, dur: 0.85, gain: 0.09, f: 500, to: 2600, q: 1.6, attack: 0.28, send: 0.4 });
      k.tone({ f: n(5), t: t + 0.22, dur: 0.4, gain: 0.1, lp: 1800, send: 0.6 });
      k.tone({ f: n(5), t: t + 0.44, dur: 0.35, gain: 0.045, lp: 1100, send: 0.7 });
      const hits = Math.max(1, Math.round(v * 3));
      for (let i = 0; i < hits; i++) bell(k, t + 0.6 + i * 0.11, 8 + i, 0.15, 0.4, 0.6, 0.5);
    },
  },
  // Rien dans la zone : le même ping, mais il retombe, les échos s'étouffent et une note creuse descend.
  scanEmpty: {
    dur: 1.6, next: 0.9, prio: 2, trim: 1, family: 'jeu',
    make(k, t) {
      k.tone({ f: n(5), to: n(5) * 0.94, t, dur: 0.55, gain: 0.28, attack: 0.004, fm: { ratio: 2, index: 0.8, decay: 0.07 }, lp: 2400, send: 0.5 });
      k.noise({ t, dur: 0.8, gain: 0.08, f: 450, to: 1300, q: 1.4, attack: 0.28, send: 0.4 });
      k.tone({ f: n(5) * 0.94, t: t + 0.24, dur: 0.35, gain: 0.07, lp: 1100, send: 0.7 });
      k.tone({ f: n(-2), to: n(-3), glide: 0.3, t: t + 0.58, dur: 0.55, gain: 0.2, attack: 0.03, type: 'triangle', lp: 900, send: 0.4 });
    },
  },
  // Prise franche : choc de la caisse (plus grave si elle est lourde, v = poids), sangle qui se serre, boucle, deux notes montantes.
  pickup: {
    dur: 1.2, next: 0.5, prio: 2, trim: 1, family: 'jeu',
    make(k, t, v) {
      thud(k, t, 170 - 50 * v, 0.42, 0.09 + 0.03 * v);
      k.noise({ t: t + 0.07, dur: 0.13, gain: 0.15, f: 900, to: 2300, q: 3, attack: 0.03 });
      k.noise({ t: t + 0.2, dur: 0.03, gain: 0.16, f: 3100, q: 6, attack: 0.001 });
      felt(k, t + 0.14, 0, 0.2, 0.24, 2200);
      bell(k, t + 0.25, 3, 0.22, 0.5, 0.5, 0.4);
    },
  },
  // Pose : deux notes qui redescendent, puis la caisse touche le sol.
  drop: {
    dur: 1.1, next: 0.5, prio: 2, trim: 1, family: 'jeu',
    make(k, t) {
      bell(k, t, 3, 0.17, 0.2, 0.3, 0.3);
      felt(k, t + 0.11, 0, 0.22, 0.42, 1500);
      thud(k, t + 0.22, 125, 0.4, 0.12);
    },
  },
  // Livraisons. E : deux notes graves qui tombent, feutrées. D : un pas qui redescend, sans conclusion.
  deliveryE: {
    dur: 1.5, next: 0.8, prio: 2, trim: 1, family: 'jeu',
    make(k, t) {
      felt(k, t, 0, 0.24, 0.5, 1100);
      felt(k, t + 0.24, -2, 0.26, 0.8, 900);
    },
  },
  deliveryD: {
    dur: 1.5, next: 0.8, prio: 2, trim: 1, family: 'jeu',
    make(k, t) {
      felt(k, t, 0, 0.24, 0.45, 1500);
      felt(k, t + 0.2, -1, 0.25, 0.8, 1300);
    },
  },
  // C : quinte ouverte montante, ni triste ni gaie.
  deliveryC: {
    dur: 1.5, next: 0.8, prio: 2, trim: 1, family: 'jeu',
    make(k, t) {
      bell(k, t, 0, 0.22, 0.4, 0.35);
      bell(k, t + 0.17, 3, 0.24, 0.8, 0.4);
    },
  },
  // B : trois notes montantes et l'octave en écho.
  deliveryB: {
    dur: 1.6, next: 0.9, prio: 2, trim: 1, family: 'jeu',
    make(k, t) {
      bell(k, t, 0, 0.2, 0.35, 0.45);
      bell(k, t + 0.13, 1, 0.2, 0.35, 0.45);
      bell(k, t + 0.26, 3, 0.23, 0.85, 0.5);
      bell(k, t + 0.4, 5, 0.1, 0.7, 0.4, 0.6);
    },
  },
  // A : couleur de fa majeur (fa, la, do, fa), timbre plus brillant, voile d'air aigu.
  deliveryA: {
    dur: 1.8, next: 1.0, prio: 2, trim: 1, family: 'jeu',
    make(k, t) {
      bell(k, t, 1, 0.19, 0.35, 0.7);
      bell(k, t + 0.11, 3, 0.19, 0.35, 0.7);
      bell(k, t + 0.22, 4, 0.2, 0.4, 0.8);
      bell(k, t + 0.33, 6, 0.24, 0.95, 0.95, 0.55);
      bell(k, t + 0.33, 4, 0.1, 0.9, 0.4, 0.5);
      k.noise({ t: t + 0.3, dur: 0.5, gain: 0.03, f: 5200, type: 'highpass', q: 0.5, attack: 0.12, send: 0.5 });
    },
  },
  // S : arpège rapide sur deux octaves, accord final ré-la-ré avec basse. Triomphal, mais fini en moins de 2 s.
  deliveryS: {
    dur: 1.95, next: 1.1, prio: 2, trim: 1, family: 'jeu',
    make(k, t) {
      [0, 3, 5, 6, 8].forEach((d, i) => bell(k, t + i * 0.075, d, 0.17, 0.3, 0.8, 0.4));
      const c = t + 0.4;
      bell(k, c, 5, 0.16, 0.95, 0.9, 0.5);
      bell(k, c, 8, 0.15, 0.95, 0.95, 0.5);
      bell(k, c + 0.02, 10, 0.12, 0.9, 0.95, 0.6);
      felt(k, c, -5, 0.22, 0.85, 900, 0.2);
      k.noise({ t: c - 0.05, dur: 0.55, gain: 0.04, f: 6000, type: 'highpass', q: 0.5, attack: 0.1, send: 0.5 });
    },
  },
  // Étoile gagnée : trois éclats très aigus, à ajouter après le jingle.
  star: {
    dur: 1.2, next: 0.45, prio: 2, trim: 1, family: 'jeu',
    make(k, t) {
      [8, 10, 13].forEach((d, i) => k.tone({ f: n(d), t: t + i * 0.085, dur: 0.45, gain: 0.13, attack: 0.003, fm: { ratio: 3.5, index: 0.8, decay: 0.1 }, send: 0.65 }));
    },
  },
  // Niveau gagné : quatre notes chaudes qui montent, puis un accord de ré mineur tenu.
  levelUp: {
    dur: 1.9, next: 1.2, prio: 2, trim: 1, family: 'jeu',
    make(k, t) {
      [0, 1, 3, 5].forEach((d, i) => bell(k, t + i * 0.1, d, 0.18, 0.4, 0.45, 0.4));
      const c = t + 0.46;
      felt(k, c, -5, 0.2, 0.95, 800, 0.2);
      bell(k, c, 3, 0.15, 1.0, 0.5, 0.5);
      bell(k, c, 5, 0.16, 1.0, 0.6, 0.5);
      bell(k, c + 0.03, 6, 0.13, 0.95, 0.7, 0.55);
      k.noise({ t: c - 0.15, dur: 0.6, gain: 0.03, f: 800, to: 4000, q: 0.8, attack: 0.2, send: 0.5 });
    },
  },
  // Contrat rempli : coup de tampon, puis sol et ré (une quinte qui valide).
  contract: {
    dur: 1.3, next: 0.7, prio: 2, trim: 1, family: 'jeu',
    make(k, t) {
      thud(k, t, 190, 0.34, 0.06);
      k.noise({ t, dur: 0.035, gain: 0.12, f: 2600, q: 2, attack: 0.001 });
      bell(k, t + 0.1, 2, 0.2, 0.28, 0.5);
      bell(k, t + 0.22, 5, 0.23, 0.7, 0.6, 0.5);
    },
  },
  // Entrée en zone dangereuse : deux graves voisins qui battent, grondement de souffle, triton sourd par-dessus.
  // Les graves sont riches en harmoniques (dents de scie filtrées) pour rester audibles sur un haut-parleur de téléphone.
  dangerIn: {
    dur: 1.8, next: 1.0, prio: 2, trim: 0.67, family: 'jeu',
    make(k, t) {
      k.tone({ f: 73.42, t, dur: 1.5, gain: 0.3, attack: 0.22, hold: 0.35, type: 'sawtooth', lp: 320, send: 0.15 });
      k.tone({ f: 77.78, t, dur: 1.5, gain: 0.26, attack: 0.25, hold: 0.35, type: 'sawtooth', lp: 280, send: 0.15 });
      k.noise({ t, dur: 1.45, gain: 0.5, f: 260, to: 110, type: 'lowpass', q: 0.8, attack: 0.3, hold: 0.2 });
      k.noise({ t: t + 0.05, dur: 1.2, gain: 0.1, f: 420, to: 300, q: 1.2, attack: 0.3, hold: 0.2 });
      k.tone({ f: n(-5), t: t + 0.08, dur: 1.2, gain: 0.07, attack: 0.3, type: 'triangle', lp: 700, send: 0.3 });
      k.tone({ f: 207.65, t: t + 0.08, dur: 1.2, gain: 0.06, attack: 0.3, type: 'triangle', lp: 700, send: 0.3 });
    },
  },
  // Sortie : un souffle qui s'ouvre (on respire), la et ré qui se posent.
  dangerOut: {
    dur: 1.6, next: 0.8, prio: 2, trim: 1, family: 'jeu',
    make(k, t) {
      k.noise({ t, dur: 0.75, gain: 0.14, f: 300, to: 1600, q: 0.8, attack: 0.08, send: 0.3 });
      k.tone({ f: n(-2), t: t + 0.05, dur: 0.5, gain: 0.2, attack: 0.03, send: 0.5 });
      k.tone({ f: n(0), t: t + 0.3, dur: 0.9, gain: 0.24, attack: 0.03, fm: { ratio: 2, index: 0.3, decay: 0.2 }, send: 0.5 });
    },
  },
  // Messages : un tic discret, deux notes montantes pour une bonne nouvelle, deux coups mats pour un avertissement.
  toastInfo: {
    dur: 0.5, next: 0.15, prio: 1, trim: 1.5, family: 'jeu',
    make(k, t) { k.tone({ f: n(8), t, dur: 0.11, gain: 0.16, attack: 0.003, lp: 3000, send: 0.25 }); },
  },
  toastGood: {
    dur: 0.7, next: 0.25, prio: 1, trim: 1.15, family: 'jeu',
    make(k, t) {
      k.tone({ f: n(5), t, dur: 0.09, gain: 0.15, attack: 0.003, send: 0.25 });
      k.tone({ f: n(8), t: t + 0.075, dur: 0.2, gain: 0.17, attack: 0.003, fm: { ratio: 2, index: 0.4, decay: 0.08 }, send: 0.3 });
    },
  },
  toastWarn: {
    dur: 0.7, next: 0.3, prio: 1, trim: 1.1, family: 'jeu',
    make(k, t) {
      for (const dt of [0, 0.13]) k.tone({ f: n(1), t: t + dt, dur: 0.11, gain: 0.22, attack: 0.004, type: 'triangle', lp: 1400, send: 0.2 });
    },
  },
  // Interface : toucher, ouverture (ça monte), fermeture (ça redescend), refus (demi-ton qui frotte), validation (quinte).
  uiTap: {
    dur: 0.25, next: 0.05, prio: 1, trim: 1.3, family: 'jeu',
    make(k, t) {
      k.noise({ t, dur: 0.02, gain: 0.2, f: 2400, q: 4, attack: 0.001 });
      k.tone({ f: n(10), t, dur: 0.045, gain: 0.09, attack: 0.002 });
    },
  },
  uiOpen: {
    dur: 0.6, next: 0.15, prio: 1, trim: 1.45, family: 'jeu',
    make(k, t) {
      k.tone({ f: n(5), to: n(8), glide: 0.09, t, dur: 0.18, gain: 0.16, attack: 0.008, send: 0.3 });
      k.noise({ t, dur: 0.11, gain: 0.04, f: 1500, to: 3200, q: 1.5, attack: 0.03 });
    },
  },
  uiClose: {
    dur: 0.6, next: 0.15, prio: 1, trim: 1.45, family: 'jeu',
    make(k, t) {
      k.tone({ f: n(8), to: n(5), glide: 0.08, t, dur: 0.16, gain: 0.16, attack: 0.006, lp: 2600, send: 0.25 });
      k.noise({ t, dur: 0.09, gain: 0.035, f: 3000, to: 1300, q: 1.5, attack: 0.01 });
    },
  },
  uiError: {
    dur: 0.7, next: 0.3, prio: 1, trim: 1, family: 'jeu',
    make(k, t) {
      k.tone({ f: n(1), t, dur: 0.12, gain: 0.22, attack: 0.004, type: 'triangle', fm: { ratio: 1.41, index: 0.7, decay: 0.1 }, lp: 1600, send: 0.15 });
      k.tone({ f: n(0) * 0.944, t: t + 0.13, dur: 0.22, gain: 0.22, attack: 0.004, type: 'triangle', fm: { ratio: 1.41, index: 0.7, decay: 0.15 }, lp: 1300, send: 0.15 });
    },
  },
  uiConfirm: {
    dur: 0.9, next: 0.3, prio: 1, trim: 1, family: 'jeu',
    make(k, t) {
      k.noise({ t, dur: 0.02, gain: 0.1, f: 2800, q: 4, attack: 0.001 });
      bell(k, t + 0.01, 5, 0.15, 0.3, 0.5, 0.35);
      bell(k, t + 0.01, 8, 0.13, 0.34, 0.5, 0.35);
    },
  },
  // Pas : appui sourd + frottement de gravier (le frottement porte le son sur un petit haut-parleur). v = charge (plus grave, plus long, sangle qui grince), w = sol mouillé.
  step: {
    dur: 0.35, next: 0.2, prio: 0, trim: 1.3, family: 'ambiance',
    make(k, t, v, w) {
      const hum = 0.85 + 0.3 * k.rand();
      k.noise({ t, dur: 0.07 + 0.05 * v, gain: (0.2 + 0.13 * v) * hum, f: (700 - 300 * v) * (0.9 + 0.2 * k.rand()), type: 'lowpass', q: 0.9, attack: 0.004, prio: 0 });
      k.noise({ t: t + 0.018, dur: 0.05, gain: 0.1 * hum, f: 1400 + 700 * k.rand(), q: 1.2, attack: 0.006, prio: 0 });
      if (v > 0.6 && k.rand() < 0.4) k.noise({ t: t + 0.06, dur: 0.09, gain: 0.05, f: 620 + 200 * k.rand(), q: 9, attack: 0.02, prio: 0 });
      if (w > 0.05) k.noise({ t: t + 0.01, dur: 0.1, gain: 0.07 * w, f: 3400, type: 'highpass', q: 0.6, attack: 0.008, prio: 0 });
    },
  },
  // Battement d'alerte d'équilibre : deux coups feutrés, comme un cœur. v = urgence.
  pulse: {
    dur: 0.5, next: 0.3, prio: 0, trim: 0.5, family: 'ambiance',
    make(k, t, v) {
      k.tone({ f: 196, to: 165, t, dur: 0.14, gain: 0.2 + 0.1 * v, attack: 0.006, type: 'triangle', lp: 800, prio: 0 });
      k.tone({ f: 185, to: 150, t: t + 0.15, dur: 0.18, gain: 0.13 + 0.08 * v, attack: 0.006, type: 'triangle', lp: 700, prio: 0 });
    },
  },
  // Note éparse de la nuit : une seule note longue, noyée de réverbération. v choisit la note.
  nightNote: {
    dur: 1.95, next: 1.0, prio: 0, trim: 0.7, family: 'ambiance',
    make(k, t, v) {
      const d = [0, 3, 4, 5, 6, 8][Math.min(5, Math.floor(v * 6))];
      k.tone({ f: n(d), t, dur: 1.3, gain: 0.1, attack: 0.04, fm: { ratio: 2, index: 0.25, decay: 0.4 }, send: 0.8, prio: 0 });
    },
  },
  // Tonnerre lointain (v = proximité) : seul son de plus de 2 s, il fait partie de l'ambiance.
  thunder: {
    dur: 3.4, next: 3.0, prio: 0, trim: 1.6, family: 'ambiance',
    make(k, t, v) {
      const p = 0.35 + 0.65 * v;
      k.noise({ t, dur: 2.6, gain: 0.5 * p, f: 300 + 500 * v, to: 80, type: 'lowpass', q: 0.6, attack: 0.05 + 0.2 * (1 - v), send: 0.3, prio: 0 });
      k.noise({ t: t + 0.45, dur: 2.4, gain: 0.35 * p, f: 260, to: 70, type: 'lowpass', q: 0.9, attack: 0.35, hold: 0.2, send: 0.3, prio: 0 });
    },
  },
  // ── Systèmes secondaires : sons discrets, dans la même gamme, plus bas que les sons principaux.
  // Colis spécial : deux notes tenues à la quinte, avec un léger battement (quelque chose d'inhabituel).
  special: {
    dur: 1.5, next: 0.7, prio: 2, trim: 0.9, family: 'jeu',
    make(k, t) {
      k.tone({ f: n(2), t, dur: 0.7, gain: 0.16, attack: 0.03, fm: { ratio: 2, index: 0.6, decay: 0.3 }, send: 0.55 });
      k.tone({ f: n(2) * 1.006, t: t + 0.02, dur: 0.7, gain: 0.1, attack: 0.05, send: 0.55 });
      bell(k, t + 0.32, 5, 0.18, 0.6, 0.7, 0.5);
    },
  },
  // Cache ouverte : loquet, couvercle, trois notes claires qui montent (v = point de compétence trouvé : une note de plus).
  cacheOpen: {
    dur: 1.5, next: 0.7, prio: 2, trim: 0.95, family: 'jeu',
    make(k, t, v) {
      k.noise({ t, dur: 0.03, gain: 0.16, f: 2600, q: 5, attack: 0.001 });
      thud(k, t + 0.06, 140, 0.26, 0.08);
      [0, 2, 3].forEach((d, i) => bell(k, t + 0.18 + i * 0.09, d + 5, 0.15, 0.4, 0.5, 0.45));
      if (v > 0.5) bell(k, t + 0.5, 10, 0.17, 0.6, 0.8, 0.55);
    },
  },
  // Rôdeur : deux notes feutrées, comme un salut.
  wanderer: {
    dur: 1.0, next: 0.5, prio: 1, trim: 1, family: 'jeu',
    make(k, t) { felt(k, t, 2, 0.2, 0.22, 1800); felt(k, t + 0.16, 4, 0.2, 0.4, 2000, 0.45); },
  },
  // Front qui approche : un souffle qui enfle et une note grave. Entrée : le souffle retombe sur le joueur. Sortie : il s'éclaircit.
  frontNear: {
    dur: 1.8, next: 0.9, prio: 2, trim: 0.9, family: 'jeu',
    make(k, t) {
      k.noise({ t, dur: 1.2, gain: 0.12, f: 250, to: 900, q: 0.8, attack: 0.6, send: 0.4 });
      k.tone({ f: n(-5), t: t + 0.2, dur: 0.9, gain: 0.18, attack: 0.2, type: 'triangle', lp: 700, send: 0.4 });
    },
  },
  frontIn: {
    dur: 1.6, next: 0.8, prio: 2, trim: 0.9, family: 'jeu',
    make(k, t) {
      k.noise({ t, dur: 0.9, gain: 0.16, f: 1400, to: 350, q: 0.8, attack: 0.05, send: 0.35 });
      k.tone({ f: n(-3), to: n(-5), glide: 0.4, t: t + 0.05, dur: 0.8, gain: 0.2, attack: 0.04, type: 'triangle', lp: 800, send: 0.4 });
    },
  },
  frontOut: {
    dur: 1.4, next: 0.7, prio: 1, trim: 0.95, family: 'jeu',
    make(k, t) {
      k.noise({ t, dur: 0.7, gain: 0.1, f: 400, to: 1800, q: 0.8, attack: 0.1, send: 0.3 });
      k.tone({ f: n(0), t: t + 0.25, dur: 0.7, gain: 0.18, attack: 0.03, fm: { ratio: 2, index: 0.3, decay: 0.2 }, send: 0.5 });
    },
  },
  // Lot pris : trois petits chocs de caisses puis une note d'élan. Réussi : arpège court. Raté : deux notes qui retombent.
  jamStart: {
    dur: 1.2, next: 0.6, prio: 2, trim: 0.95, family: 'jeu',
    make(k, t) {
      [0, 0.1, 0.2].forEach((dt, i) => thud(k, t + dt, 180 - 20 * i, 0.22, 0.06));
      bell(k, t + 0.34, 5, 0.2, 0.5, 0.5, 0.4);
    },
  },
  jamWon: {
    dur: 1.6, next: 0.9, prio: 2, trim: 0.9, family: 'jeu',
    make(k, t) { [5, 7, 8, 10].forEach((d, i) => bell(k, t + i * 0.1, d, 0.17, i === 3 ? 0.8 : 0.3, 0.6 + 0.1 * i, 0.5)); },
  },
  jamLost: {
    dur: 1.2, next: 0.6, prio: 2, trim: 1, family: 'jeu',
    make(k, t) { felt(k, t, 1, 0.22, 0.3, 1200); felt(k, t + 0.2, -2, 0.22, 0.55, 1000, 0.4); },
  },
  // Écoute d'un colis : un petit coup contre la caisse et sa résonance.
  inspect: {
    dur: 0.8, next: 0.3, prio: 1, trim: 1.1, family: 'jeu',
    make(k, t) {
      k.noise({ t, dur: 0.025, gain: 0.14, f: 1800, q: 4, attack: 0.001 });
      k.tone({ f: n(7), t: t + 0.03, dur: 0.3, gain: 0.13, attack: 0.004, lp: 2600, send: 0.5 });
    },
  },
  // Arrimage : la sangle qui file, le cliquet ; v = qualité (bien serré : une note claire en plus).
  strap: {
    dur: 0.9, next: 0.35, prio: 1, trim: 1.05, family: 'jeu',
    make(k, t, v) {
      k.noise({ t, dur: 0.14, gain: 0.13, f: 800, to: 2600, q: 3, attack: 0.03 });
      k.noise({ t: t + 0.15, dur: 0.03, gain: 0.15, f: 3200, q: 6, attack: 0.001 });
      if (v >= 0.7) bell(k, t + 0.2, 8, 0.14, 0.35, 0.5, 0.35); else felt(k, t + 0.2, 3, 0.13, 0.25, 1500);
    },
  },
  // Photo-preuve : déclic d'obturateur et une note brève.
  proof: {
    dur: 0.8, next: 0.3, prio: 1, trim: 1.05, family: 'jeu',
    make(k, t) {
      k.noise({ t, dur: 0.02, gain: 0.16, f: 4200, q: 3, attack: 0.001 });
      k.noise({ t: t + 0.06, dur: 0.03, gain: 0.13, f: 2600, q: 3, attack: 0.001 });
      bell(k, t + 0.12, 9, 0.13, 0.3, 0.4, 0.4);
    },
  },
};

export const SOUND_NAMES = Object.keys(SOUNDS) as SoundName[];

/** Programme un son à l'instant t (horloge du contexte du banc). */
export function play(rig: Rig, name: SoundName, t: number, v = 0, w = 0, pan = 0): void {
  const def = SOUNDS[name];
  const kit: Kit = {
    tone: o => { tone(rig, { prio: def.prio, ...o, gain: o.gain * def.trim, pan: o.pan ?? pan }); },
    noise: o => { noise(rig, { prio: def.prio, ...o, gain: o.gain * def.trim, pan: o.pan ?? pan }); },
    rand: rig.rand,
  };
  def.make(kit, t, Math.max(0, Math.min(1, v)), Math.max(0, Math.min(1, w)));
}
