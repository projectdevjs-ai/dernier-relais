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
  | 'jamStart' | 'jamWon' | 'jamLost' | 'inspect' | 'strap' | 'proof'
  | 'cueChargement' | 'cueDepart' | 'cueLabo' | 'cuePasseur' | 'cueChapitre';

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
  /** 'jeu' : événements et interface (niveaux comparables). 'ambiance' : détails de la nappe, volontairement plus bas. */
  family: 'jeu' | 'ambiance';
  /** v et w : variations de 0 à 1 propres à chaque son (nombre de colis, poids, charge, pluie…). */
  make(k: Kit, t: number, v: number, w: number): void;
}

/** Réglages de niveau, ajustés d'après les mesures hors ligne (demo-audio.html) pour équilibrer les sons entre eux. */
export const TRIM: Record<SoundName, number> = {
//TRIM-BEGIN
  scan: 1, scanEmpty: 1, pickup: 1, drop: 1,
  deliveryE: 1, deliveryD: 1, deliveryC: 1, deliveryB: 1, deliveryA: 1, deliveryS: 1,
  star: 1, levelUp: 1, contract: 1, dangerIn: 0.67, dangerOut: 1,
  toastInfo: 1.5, toastGood: 1.15, toastWarn: 1.1,
  uiTap: 1.3, uiOpen: 1.45, uiClose: 1.45, uiError: 1, uiConfirm: 1,
  step: 0.4, pulse: 0.5, nightNote: 0.7, thunder: 1.6,
  special: 0.9, cacheOpen: 0.95, wanderer: 1, frontNear: 0.9, frontIn: 0.9, frontOut: 0.95,
  jamStart: 0.95, jamWon: 0.9, jamLost: 1, inspect: 1.1, strap: 1.05, proof: 1.05,
  cueChargement: 1, cueDepart: 1, cueLabo: 1, cuePasseur: 1, cueChapitre: 1,
//TRIM-END
};

// ── Briques d'écriture. Un son soigné a trois couches : un transitoire (le toucher), un corps (la note, le choc)
// et une queue (réverbération, souffle). Les moments forts ajoutent une sous-basse discrète.

/** Note de carillon doux : sinus avec un peu de modulation à l'attaque, plus brillante quand `bright` monte. */
function bell(k: Kit, t: number, i: number, gain: number, dur: number, bright = 0.5, send = 0.45, pan = 0): void {
  k.tone({ f: n(i), t, dur, gain, attack: 0.005, fm: { ratio: bright > 0.9 ? 3 : 2, index: bright, decay: 0.16 }, send: send * 0.7, far: send * 0.45, pan });
}
/** Carillon large : la note, plus un double très légèrement désaccordé de l'autre côté (corps et largeur stéréo). */
function chime(k: Kit, t: number, i: number, gain: number, dur: number, bright = 0.5, send = 0.45, width = 0.35): void {
  bell(k, t, i, gain, dur, bright, send, -width * 0.6);
  k.tone({ f: n(i) * 1.0035, t: t + 0.004, dur: dur * 0.9, gain: gain * 0.42, attack: 0.02, send: send * 0.5, far: send * 0.6, pan: width });
}
/** Note feutrée : triangle filtré, pour les registres graves et les notes sobres. */
function felt(k: Kit, t: number, i: number, gain: number, dur: number, lp = 1400, send = 0.35, pan = 0): void {
  k.tone({ f: n(i), t, dur, gain, attack: 0.012, type: 'triangle', lp, send: send * 0.8, far: send * 0.3, pan });
}
/** Choc sourd : souffle grave + sinus qui tombe (prise, pose, tampon). */
function thud(k: Kit, t: number, f: number, gain: number, dur = 0.1, pan = 0): void {
  k.noise({ t, dur, gain, f: f * 2.6, type: 'lowpass', q: 0.7, attack: 0.002, send: 0.12, pan });
  k.tone({ f, to: f * 0.55, glide: dur * 0.8, t, dur: dur * 1.5, gain: gain * 0.75, attack: 0.003, pan });
}
/** Transitoire : un minuscule éclat de souffle qui donne le « toucher » d'un son. */
function tick(k: Kit, t: number, f: number, gain: number, pan = 0, q = 4): void {
  k.noise({ t, dur: 0.022, gain, f: f * (0.92 + 0.16 * k.rand()), q, attack: 0.001, send: 0.15, pan });
}
/** Sous-basse discrète des moments forts : un sinus très grave (casque, enceinte) doublé à l'octave par un triangle
 *  filtré dont les harmoniques restent audibles sur un haut-parleur de téléphone. */
function sub(k: Kit, t: number, f: number, gain: number, dur: number): void {
  k.tone({ f, to: f * 0.97, t, dur, gain, attack: 0.03, hold: dur * 0.15 });
  k.tone({ f: f * 2, t, dur: dur * 0.85, gain: gain * 0.42, attack: 0.03, type: 'triangle', lp: 520, far: 0.15 });
}
/** Voile d'air aigu : la queue brillante d'un moment heureux. */
function air(k: Kit, t: number, dur: number, gain: number, f = 5600, pan = -0.3): void {
  k.noise({ t, dur, gain, f, type: 'highpass', q: 0.5, attack: dur * 0.25, send: 0.2, far: 0.5, pan, panTo: -pan });
}

export const SOUNDS: Record<SoundName, SoundDef> = {
  // Sonar, le son signature : un ping net, une onde de souffle qui s'élargit à gauche et à droite, des échos qui
  // s'éloignent, puis l'onde qui revient vers le centre avec une réponse aiguë par colis trouvé (v = colis / 3).
  scan: {
    dur: 1.9, next: 0.9, prio: 2, family: 'jeu',
    make(k, t, v) {
      tick(k, t, 3000, 0.1);
      k.tone({ f: n(5), to: n(5) * 0.985, t, dur: 0.6, gain: 0.3, attack: 0.004, fm: { ratio: 2, index: 1.1, decay: 0.07 }, send: 0.3, far: 0.3 });
      k.tone({ f: n(0), t, dur: 0.5, gain: 0.1, attack: 0.012, type: 'triangle', lp: 900, far: 0.2 });
      // L'onde part : deux souffles qui s'ouvrent en montant, l'un vers la gauche, l'autre vers la droite.
      k.noise({ t, dur: 0.8, gain: 0.075, f: 420, to: 2800, q: 1.5, attack: 0.26, far: 0.35, pan: -0.05, panTo: -0.85 });
      k.noise({ t: t + 0.02, dur: 0.8, gain: 0.075, f: 480, to: 3200, q: 1.5, attack: 0.28, far: 0.35, pan: 0.05, panTo: 0.85 });
      k.tone({ f: n(5), t: t + 0.22, dur: 0.4, gain: 0.1, lp: 1800, far: 0.5, pan: -0.4 });
      k.tone({ f: n(5), t: t + 0.44, dur: 0.35, gain: 0.05, lp: 1100, far: 0.6, pan: 0.5 });
      // L'onde revient : le souffle redescend et se referme au centre.
      k.noise({ t: t + 0.5, dur: 0.6, gain: 0.05, f: 2400, to: 700, q: 1.6, attack: 0.3, far: 0.3, pan: 0.7, panTo: 0 });
      const hits = Math.max(1, Math.round(v * 3));
      for (let i = 0; i < hits; i++) bell(k, t + 0.62 + i * 0.11, 8 + i, 0.15, 0.4, 0.6, 0.5, [0.3, -0.3, 0.1][i] ?? 0);
    },
  },
  // Rien dans la zone : le même ping, mais il retombe ; l'onde part et ne revient pas, une note creuse descend.
  scanEmpty: {
    dur: 1.8, next: 0.9, prio: 2, family: 'jeu',
    make(k, t) {
      tick(k, t, 2600, 0.08);
      k.tone({ f: n(5), to: n(5) * 0.94, t, dur: 0.55, gain: 0.28, attack: 0.004, fm: { ratio: 2, index: 0.8, decay: 0.07 }, lp: 2400, send: 0.3, far: 0.3 });
      k.noise({ t, dur: 0.8, gain: 0.07, f: 450, to: 1500, q: 1.4, attack: 0.28, far: 0.4, pan: -0.05, panTo: -0.8 });
      k.noise({ t: t + 0.02, dur: 0.8, gain: 0.07, f: 500, to: 1300, q: 1.4, attack: 0.3, far: 0.4, pan: 0.05, panTo: 0.8 });
      k.tone({ f: n(5) * 0.94, t: t + 0.24, dur: 0.35, gain: 0.07, lp: 1100, far: 0.6, pan: 0.4 });
      k.tone({ f: n(-2), to: n(-3), glide: 0.3, t: t + 0.58, dur: 0.55, gain: 0.2, attack: 0.03, type: 'triangle', lp: 900, send: 0.2, far: 0.3 });
    },
  },
  // Prise franche : choc de la caisse (plus grave si elle est lourde, v = poids), sangle qui se serre, boucle, deux notes montantes.
  pickup: {
    dur: 1.3, next: 0.5, prio: 2, family: 'jeu',
    make(k, t, v) {
      tick(k, t, 2200, 0.09);
      thud(k, t, 170 - 50 * v, 0.42, 0.09 + 0.03 * v);
      if (v > 0.4) k.tone({ f: 62, to: 50, t, dur: 0.22, gain: 0.2 * v, attack: 0.008 });
      k.noise({ t: t + 0.07, dur: 0.13, gain: 0.15, f: 900, to: 2300, q: 3, attack: 0.03, send: 0.15, pan: -0.25, panTo: 0.2 });
      tick(k, t + 0.2, 3100, 0.16, 0.15, 6);
      felt(k, t + 0.14, 0, 0.2, 0.24, 2200, 0.35, -0.1);
      chime(k, t + 0.25, 3, 0.2, 0.5, 0.5, 0.4, 0.25);
    },
  },
  // Pose : deux notes qui redescendent, puis la caisse touche le sol.
  drop: {
    dur: 1.2, next: 0.5, prio: 2, family: 'jeu',
    make(k, t) {
      bell(k, t, 3, 0.17, 0.2, 0.3, 0.3, 0.15);
      felt(k, t + 0.11, 0, 0.22, 0.42, 1500, 0.35, -0.1);
      thud(k, t + 0.22, 125, 0.4, 0.12);
      k.noise({ t: t + 0.23, dur: 0.16, gain: 0.05, f: 1200, to: 500, q: 0.8, attack: 0.01, send: 0.3 });
    },
  },
  // Livraisons. E : deux notes graves qui tombent, feutrées, un soupir. D : un pas qui redescend, sans conclusion.
  deliveryE: {
    dur: 1.6, next: 0.8, prio: 2, family: 'jeu',
    make(k, t) {
      thud(k, t, 110, 0.14, 0.08);
      felt(k, t, 0, 0.24, 0.5, 1100, 0.35, -0.12);
      felt(k, t + 0.24, -2, 0.26, 0.8, 900, 0.35, 0.1);
      k.noise({ t: t + 0.2, dur: 0.6, gain: 0.035, f: 700, to: 260, q: 0.9, attack: 0.15, far: 0.4 });
    },
  },
  deliveryD: {
    dur: 1.6, next: 0.8, prio: 2, family: 'jeu',
    make(k, t) {
      tick(k, t, 1500, 0.05);
      felt(k, t, 0, 0.24, 0.45, 1500, 0.35, -0.12);
      felt(k, t + 0.2, -1, 0.25, 0.8, 1300, 0.35, 0.1);
      k.tone({ f: n(-6), t: t + 0.2, dur: 0.6, gain: 0.07, attack: 0.05, type: 'triangle', lp: 600, far: 0.2 });
    },
  },
  // C : quinte ouverte montante, ni triste ni gaie.
  deliveryC: {
    dur: 1.6, next: 0.8, prio: 2, family: 'jeu',
    make(k, t) {
      tick(k, t, 2400, 0.06);
      bell(k, t, 0, 0.22, 0.4, 0.35, 0.45, -0.15);
      chime(k, t + 0.17, 3, 0.22, 0.8, 0.4, 0.45, 0.3);
      felt(k, t + 0.17, -5, 0.09, 0.6, 700, 0.2);
    },
  },
  // B : trois notes montantes, l'octave en écho, une basse feutrée sous la dernière.
  deliveryB: {
    dur: 1.7, next: 0.9, prio: 2, family: 'jeu',
    make(k, t) {
      tick(k, t, 2600, 0.07);
      bell(k, t, 0, 0.2, 0.35, 0.45, 0.45, -0.25);
      bell(k, t + 0.13, 1, 0.2, 0.35, 0.45, 0.45, 0);
      chime(k, t + 0.26, 3, 0.21, 0.85, 0.5, 0.45, 0.3);
      bell(k, t + 0.4, 5, 0.1, 0.7, 0.4, 0.6, 0.45);
      felt(k, t + 0.26, -5, 0.13, 0.7, 800, 0.2);
    },
  },
  // A : couleur de fa majeur (fa, la, do, fa), timbre plus brillant, basse de fa, voile d'air aigu.
  deliveryA: {
    dur: 1.9, next: 1.0, prio: 2, family: 'jeu',
    make(k, t) {
      tick(k, t, 3000, 0.08);
      bell(k, t, 1, 0.19, 0.35, 0.7, 0.45, -0.35);
      bell(k, t + 0.11, 3, 0.19, 0.35, 0.7, 0.45, -0.1);
      bell(k, t + 0.22, 4, 0.2, 0.4, 0.8, 0.45, 0.15);
      chime(k, t + 0.33, 6, 0.22, 0.95, 0.95, 0.55, 0.4);
      bell(k, t + 0.33, 4, 0.1, 0.9, 0.4, 0.5, -0.3);
      felt(k, t + 0.33, -4, 0.16, 0.8, 800, 0.2);
      air(k, t + 0.3, 0.5, 0.03, 5200);
    },
  },
  // S : arpège rapide qui traverse l'espace sur deux octaves, accord final ré-la-ré, basse, sous-basse et voile d'air.
  // Triomphal, mais fini en moins de 2 s.
  deliveryS: {
    dur: 2.0, next: 1.1, prio: 2, family: 'jeu',
    make(k, t) {
      tick(k, t, 3200, 0.09);
      [0, 3, 5, 6, 8].forEach((d, i) => bell(k, t + i * 0.075, d, 0.17, 0.3, 0.8, 0.4, -0.5 + 0.25 * i));
      const c = t + 0.4;
      thud(k, c, 95, 0.16, 0.1);
      chime(k, c, 5, 0.15, 0.95, 0.9, 0.5, 0.4);
      bell(k, c, 8, 0.15, 0.95, 0.95, 0.5, 0.25);
      bell(k, c + 0.02, 10, 0.12, 0.9, 0.95, 0.6, -0.3);
      felt(k, c, -5, 0.2, 0.85, 900, 0.2);
      sub(k, c, 73.42, 0.2, 0.8);
      air(k, c - 0.05, 0.55, 0.04, 6000);
    },
  },
  // Étoile gagnée : trois éclats très aigus qui s'ouvrent dans l'espace, une lueur grave en dessous. À ajouter après le jingle.
  star: {
    dur: 1.3, next: 0.45, prio: 2, family: 'jeu',
    make(k, t) {
      [8, 10, 13].forEach((d, i) => k.tone({ f: n(d), t: t + i * 0.085, dur: 0.45, gain: 0.13, attack: 0.003, fm: { ratio: 3.5, index: 0.8, decay: 0.1 }, send: 0.3, far: 0.4, pan: [-0.4, 0.1, 0.5][i] }));
      k.tone({ f: n(13) * 1.004, t: t + 0.18, dur: 0.5, gain: 0.05, attack: 0.03, far: 0.6, pan: -0.5 });
      air(k, t + 0.1, 0.4, 0.03, 7000, 0.3);
      sub(k, t + 0.02, 110, 0.13, 0.55);
    },
  },
  // Niveau gagné : quatre notes chaudes qui montent, puis un accord de ré mineur tenu, posé sur une sous-basse.
  levelUp: {
    dur: 2.0, next: 1.2, prio: 2, family: 'jeu',
    make(k, t) {
      tick(k, t, 2600, 0.07);
      [0, 1, 3, 5].forEach((d, i) => bell(k, t + i * 0.1, d, 0.18, 0.4, 0.45, 0.4, -0.4 + 0.27 * i));
      const c = t + 0.46;
      thud(k, c, 90, 0.14, 0.1);
      felt(k, c, -5, 0.2, 0.95, 800, 0.2);
      chime(k, c, 3, 0.14, 1.0, 0.5, 0.5, 0.35);
      bell(k, c, 5, 0.16, 1.0, 0.6, 0.5, 0.2);
      bell(k, c + 0.03, 6, 0.13, 0.95, 0.7, 0.55, -0.25);
      sub(k, c, 73.42, 0.2, 0.85);
      k.noise({ t: c - 0.15, dur: 0.6, gain: 0.03, f: 800, to: 4000, q: 0.8, attack: 0.2, far: 0.5, pan: -0.4, panTo: 0.4 });
    },
  },
  // Contrat rempli : coup de tampon, puis sol et ré (une quinte qui valide).
  contract: {
    dur: 1.4, next: 0.7, prio: 2, family: 'jeu',
    make(k, t) {
      thud(k, t, 190, 0.34, 0.06);
      tick(k, t, 2600, 0.12, 0, 2);
      k.noise({ t: t + 0.03, dur: 0.12, gain: 0.04, f: 900, q: 1, attack: 0.01, send: 0.4 });
      bell(k, t + 0.1, 2, 0.2, 0.28, 0.5, 0.45, -0.15);
      chime(k, t + 0.22, 5, 0.21, 0.7, 0.6, 0.5, 0.3);
    },
  },
  // Entrée en zone dangereuse : un choc sourd, deux graves voisins qui battent de part et d'autre, un grondement de
  // souffle qui se déplace, un triton sourd par-dessus. Les graves sont riches en harmoniques (dents de scie filtrées)
  // pour rester audibles sur un haut-parleur de téléphone ; un filet de souffle médium porte la tension.
  dangerIn: {
    dur: 1.9, next: 1.0, prio: 2, family: 'jeu',
    make(k, t) {
      thud(k, t, 82, 0.3, 0.12);
      k.tone({ f: 73.42, t, dur: 1.5, gain: 0.3, attack: 0.22, hold: 0.35, type: 'sawtooth', lp: 320, far: 0.12, pan: -0.3 });
      k.tone({ f: 77.78, t, dur: 1.5, gain: 0.26, attack: 0.25, hold: 0.35, type: 'sawtooth', lp: 280, far: 0.12, pan: 0.3 });
      k.noise({ t, dur: 1.45, gain: 0.5, f: 260, to: 110, type: 'lowpass', q: 0.8, attack: 0.3, hold: 0.2, pan: -0.35, panTo: 0.35 });
      k.noise({ t: t + 0.05, dur: 1.2, gain: 0.1, f: 420, to: 300, q: 1.2, attack: 0.3, hold: 0.2, pan: 0.3, panTo: -0.3 });
      k.noise({ t: t + 0.1, dur: 1.1, gain: 0.02, f: 2300, to: 1500, q: 3, attack: 0.4, far: 0.4 });
      k.tone({ f: n(-5), t: t + 0.08, dur: 1.2, gain: 0.07, attack: 0.3, type: 'triangle', lp: 700, far: 0.3, pan: -0.15 });
      k.tone({ f: 207.65, t: t + 0.08, dur: 1.2, gain: 0.06, attack: 0.3, type: 'triangle', lp: 700, far: 0.3, pan: 0.15 });
    },
  },
  // Sortie : un souffle qui s'ouvre et s'élargit (on respire), la et ré qui se posent.
  dangerOut: {
    dur: 1.7, next: 0.8, prio: 2, family: 'jeu',
    make(k, t) {
      k.noise({ t, dur: 0.75, gain: 0.1, f: 300, to: 1600, q: 0.8, attack: 0.08, far: 0.3, pan: -0.1, panTo: -0.7 });
      k.noise({ t, dur: 0.75, gain: 0.1, f: 330, to: 1800, q: 0.8, attack: 0.1, far: 0.3, pan: 0.1, panTo: 0.7 });
      k.tone({ f: n(-2), t: t + 0.05, dur: 0.5, gain: 0.2, attack: 0.03, send: 0.25, far: 0.25, pan: -0.15 });
      chime(k, t + 0.3, 0, 0.22, 0.9, 0.3, 0.5, 0.3);
    },
  },
  // Messages : un tic discret, deux notes montantes pour une bonne nouvelle, deux coups mats pour un avertissement.
  toastInfo: {
    dur: 0.6, next: 0.15, prio: 1, family: 'jeu',
    make(k, t) {
      tick(k, t, 3200, 0.05);
      k.tone({ f: n(8), t, dur: 0.12, gain: 0.16, attack: 0.003, lp: 3000, send: 0.3, pan: 0.1 });
      k.tone({ f: n(3), t, dur: 0.1, gain: 0.05, attack: 0.006, type: 'triangle', lp: 1500, send: 0.2, pan: -0.1 });
    },
  },
  toastGood: {
    dur: 0.8, next: 0.25, prio: 1, family: 'jeu',
    make(k, t) {
      tick(k, t, 3400, 0.04);
      k.tone({ f: n(5), t, dur: 0.09, gain: 0.15, attack: 0.003, send: 0.25, pan: -0.15 });
      k.tone({ f: n(8), t: t + 0.075, dur: 0.2, gain: 0.17, attack: 0.003, fm: { ratio: 2, index: 0.4, decay: 0.08 }, send: 0.3, far: 0.15, pan: 0.15 });
      k.tone({ f: n(3), t: t + 0.075, dur: 0.18, gain: 0.05, attack: 0.01, type: 'triangle', lp: 1500, send: 0.2 });
    },
  },
  toastWarn: {
    dur: 0.8, next: 0.3, prio: 1, family: 'jeu',
    make(k, t) {
      [0, 0.13].forEach((dt, i) => {
        k.tone({ f: n(1), t: t + dt, dur: 0.11, gain: 0.22, attack: 0.004, type: 'triangle', lp: 1400, send: 0.2, pan: i ? 0.12 : -0.12 });
        k.noise({ t: t + dt, dur: 0.04, gain: 0.07, f: 420, type: 'lowpass', q: 0.8, attack: 0.002 });
      });
    },
  },
  // Interface : toucher, ouverture (ça monte et ça s'ouvre), fermeture (ça redescend et ça se pose), refus (demi-ton qui frotte), validation (quinte).
  uiTap: {
    dur: 0.25, next: 0.05, prio: 1, family: 'jeu',
    make(k, t) {
      tick(k, t, 2400, 0.2);
      k.tone({ f: n(10), t, dur: 0.045, gain: 0.09, attack: 0.002 });
      k.tone({ f: 230, to: 170, t, dur: 0.04, gain: 0.08, attack: 0.003 });
    },
  },
  // Panneau qui s'ouvre : un petit appui grave, la note qui glisse vers le haut, un souffle qui s'écarte.
  uiOpen: {
    dur: 0.7, next: 0.15, prio: 1, family: 'jeu',
    make(k, t) {
      k.tone({ f: 190, to: 140, t, dur: 0.05, gain: 0.07, attack: 0.004 });
      k.tone({ f: n(5), to: n(8), glide: 0.09, t, dur: 0.18, gain: 0.16, attack: 0.008, send: 0.3, far: 0.1 });
      k.tone({ f: n(8) * 1.004, t: t + 0.08, dur: 0.16, gain: 0.04, attack: 0.02, far: 0.3, pan: 0.4 });
      k.noise({ t, dur: 0.14, gain: 0.045, f: 1300, to: 3400, q: 1.5, attack: 0.04, send: 0.2, pan: -0.5, panTo: 0.5 });
    },
  },
  // Panneau qui se ferme : la note redescend, le souffle se referme, un petit choc feutré pour finir.
  uiClose: {
    dur: 0.7, next: 0.15, prio: 1, family: 'jeu',
    make(k, t) {
      k.tone({ f: n(8), to: n(5), glide: 0.08, t, dur: 0.16, gain: 0.16, attack: 0.006, lp: 2600, send: 0.25 });
      k.noise({ t, dur: 0.11, gain: 0.04, f: 3000, to: 1100, q: 1.5, attack: 0.01, send: 0.15, pan: 0.5, panTo: -0.3 });
      k.tone({ f: 170, to: 120, t: t + 0.09, dur: 0.06, gain: 0.09, attack: 0.004 });
      k.noise({ t: t + 0.09, dur: 0.03, gain: 0.05, f: 500, type: 'lowpass', q: 0.7, attack: 0.002 });
    },
  },
  uiError: {
    dur: 0.8, next: 0.3, prio: 1, family: 'jeu',
    make(k, t) {
      k.noise({ t, dur: 0.03, gain: 0.06, f: 600, type: 'lowpass', q: 0.8, attack: 0.002 });
      k.tone({ f: n(1), t, dur: 0.12, gain: 0.22, attack: 0.004, type: 'triangle', fm: { ratio: 1.41, index: 0.7, decay: 0.1 }, lp: 1600, send: 0.15, pan: -0.1 });
      k.tone({ f: n(0) * 0.944, t: t + 0.13, dur: 0.22, gain: 0.22, attack: 0.004, type: 'triangle', fm: { ratio: 1.41, index: 0.7, decay: 0.15 }, lp: 1300, send: 0.15, pan: 0.1 });
    },
  },
  uiConfirm: {
    dur: 1.0, next: 0.3, prio: 1, family: 'jeu',
    make(k, t) {
      tick(k, t, 2800, 0.1);
      bell(k, t + 0.01, 5, 0.15, 0.3, 0.5, 0.35, -0.2);
      bell(k, t + 0.01, 8, 0.13, 0.34, 0.5, 0.35, 0.2);
      k.tone({ f: n(0), t: t + 0.01, dur: 0.2, gain: 0.04, attack: 0.01, type: 'triangle', lp: 1200 });
    },
  },
  // Pas : un appui feutré et grave, presque sans claquement (attaque lente, peu d'aigu), un léger froissement de sol.
  // Chaque pas diffère un peu (hauteur, timbre, appui talon-pointe). v = charge (plus grave, plus appuyé ; à vide le pas
  // est deux fois plus discret), w = sol mouillé. Le niveau reste sous celui de la nappe (mesuré dans la démo).
  step: {
    dur: 0.4, next: 0.2, prio: 0, family: 'ambiance',
    make(k, t, v, w) {
      const weight = 0.5 + 0.5 * v, hum = 0.85 + 0.3 * k.rand(), pitch = 0.88 + 0.24 * k.rand(), soft = k.rand();
      // Corps : souffle grave, attaque arrondie.
      k.noise({ t, dur: 0.09 + 0.05 * v, gain: 0.26 * weight * hum, f: (430 - 140 * v) * pitch, type: 'lowpass', q: 0.6 + 0.3 * soft, attack: 0.014, prio: 0 });
      // Appui : un sinus sourd qui tombe, plus présent quand la charge est lourde.
      k.tone({ f: (120 - 25 * v) * pitch, to: 70 * pitch, t, dur: 0.1 + 0.04 * v, gain: 0.16 * weight * hum, attack: 0.012, prio: 0 });
      // Froissement du sol (pointe du pied), un peu après, très léger.
      k.noise({ t: t + 0.03 + 0.03 * soft, dur: 0.06, gain: 0.035 * hum * (0.6 + 0.4 * weight), f: 800 + 500 * k.rand(), q: 0.9, attack: 0.012, prio: 0 });
      if (v > 0.6 && k.rand() < 0.35) k.noise({ t: t + 0.06, dur: 0.09, gain: 0.025, f: 560 + 200 * k.rand(), q: 8, attack: 0.025, prio: 0 });
      if (w > 0.05) k.noise({ t: t + 0.015, dur: 0.1, gain: 0.03 * w, f: 2800, type: 'highpass', q: 0.6, attack: 0.012, prio: 0 });
    },
  },
  // Battement d'alerte d'équilibre : deux coups feutrés, comme un cœur. v = urgence.
  pulse: {
    dur: 0.5, next: 0.3, prio: 0, family: 'ambiance',
    make(k, t, v) {
      k.tone({ f: 196, to: 165, t, dur: 0.14, gain: 0.2 + 0.1 * v, attack: 0.006, type: 'triangle', lp: 800, prio: 0 });
      k.tone({ f: 185, to: 150, t: t + 0.15, dur: 0.18, gain: 0.13 + 0.08 * v, attack: 0.006, type: 'triangle', lp: 700, prio: 0 });
    },
  },
  // Note éparse de la nuit : une note longue et son ombre à l'octave, noyées dans la grande réverbération. v choisit la note.
  nightNote: {
    dur: 2.0, next: 1.0, prio: 0, family: 'ambiance',
    make(k, t, v) {
      const d = [0, 3, 4, 5, 6, 8][Math.min(5, Math.floor(v * 6))];
      k.tone({ f: n(d), t, dur: 1.3, gain: 0.1, attack: 0.04, fm: { ratio: 2, index: 0.25, decay: 0.4 }, send: 0.3, far: 0.7, prio: 0 });
      k.tone({ f: n(d + 5) * 1.003, t: t + 0.03, dur: 1.0, gain: 0.02, attack: 0.15, far: 0.7, prio: 0 });
    },
  },
  // Tonnerre lointain (v = proximité) : seul son de plus de 2 s, il fait partie de l'ambiance. Il roule d'un côté à l'autre.
  thunder: {
    dur: 3.4, next: 3.0, prio: 0, family: 'ambiance',
    make(k, t, v) {
      const p = 0.35 + 0.65 * v;
      if (v > 0.6) k.noise({ t, dur: 0.18, gain: 0.12 * p, f: 1800, to: 600, q: 0.8, attack: 0.004, far: 0.4, prio: 0 });
      k.noise({ t, dur: 2.6, gain: 0.5 * p, f: 300 + 500 * v, to: 80, type: 'lowpass', q: 0.6, attack: 0.05 + 0.2 * (1 - v), far: 0.3, prio: 0 });
      k.noise({ t: t + 0.45, dur: 2.4, gain: 0.35 * p, f: 260, to: 70, type: 'lowpass', q: 0.9, attack: 0.35, hold: 0.2, far: 0.3, prio: 0 });
    },
  },
  // ── Systèmes secondaires : sons discrets, dans la même gamme, plus bas que les sons principaux.
  // Colis spécial : deux notes tenues à la quinte, avec un léger battement (quelque chose d'inhabituel).
  special: {
    dur: 1.6, next: 0.7, prio: 2, family: 'jeu',
    make(k, t) {
      k.tone({ f: n(2), t, dur: 0.7, gain: 0.16, attack: 0.03, fm: { ratio: 2, index: 0.6, decay: 0.3 }, send: 0.3, far: 0.3, pan: -0.3 });
      k.tone({ f: n(2) * 1.006, t: t + 0.02, dur: 0.7, gain: 0.1, attack: 0.05, send: 0.3, far: 0.3, pan: 0.3 });
      chime(k, t + 0.32, 5, 0.16, 0.6, 0.7, 0.5, 0.3);
    },
  },
  // Cache (capsule) ouverte : loquet, couvercle sur un fond grave, trois notes claires qui montent (v = point de compétence : une note de plus).
  cacheOpen: {
    dur: 1.6, next: 0.7, prio: 2, family: 'jeu',
    make(k, t, v) {
      tick(k, t, 2600, 0.16, -0.1, 5);
      thud(k, t + 0.06, 140, 0.26, 0.08);
      sub(k, t + 0.06, 82.4, 0.12, 0.45);
      k.noise({ t: t + 0.08, dur: 0.2, gain: 0.04, f: 900, to: 2600, q: 1.2, attack: 0.05, send: 0.3, pan: -0.3, panTo: 0.3 });
      [0, 2, 3].forEach((d, i) => bell(k, t + 0.18 + i * 0.09, d + 5, 0.15, 0.4, 0.5, 0.45, -0.3 + 0.3 * i));
      if (v > 0.5) chime(k, t + 0.5, 10, 0.15, 0.6, 0.8, 0.55, 0.35);
    },
  },
  // Rôdeur : deux notes feutrées, comme un salut.
  wanderer: {
    dur: 1.1, next: 0.5, prio: 1, family: 'jeu',
    make(k, t) { felt(k, t, 2, 0.2, 0.22, 1800, 0.35, -0.2); felt(k, t + 0.16, 4, 0.2, 0.4, 2000, 0.5, 0.2); },
  },
  // Front qui approche : un souffle qui enfle et traverse, une note grave. Entrée : le souffle retombe sur le joueur, avec
  // une sous-basse. Sortie : il s'éclaircit.
  frontNear: {
    dur: 1.9, next: 0.9, prio: 2, family: 'jeu',
    make(k, t) {
      k.noise({ t, dur: 1.2, gain: 0.12, f: 250, to: 900, q: 0.8, attack: 0.6, far: 0.4, pan: -0.6, panTo: 0.3 });
      k.tone({ f: n(-5), t: t + 0.2, dur: 0.9, gain: 0.18, attack: 0.2, type: 'triangle', lp: 700, far: 0.4 });
      k.tone({ f: n(-10), t: t + 0.2, dur: 0.9, gain: 0.1, attack: 0.25, type: 'sawtooth', lp: 300 });
    },
  },
  frontIn: {
    dur: 1.7, next: 0.8, prio: 2, family: 'jeu',
    make(k, t) {
      k.noise({ t, dur: 0.9, gain: 0.16, f: 1400, to: 350, q: 0.8, attack: 0.05, far: 0.35, pan: 0.5, panTo: 0 });
      k.noise({ t, dur: 0.7, gain: 0.08, f: 1800, to: 500, q: 0.8, attack: 0.07, far: 0.35, pan: -0.5, panTo: 0 });
      k.tone({ f: n(-3), to: n(-5), glide: 0.4, t: t + 0.05, dur: 0.8, gain: 0.2, attack: 0.04, type: 'triangle', lp: 800, far: 0.4 });
      sub(k, t + 0.05, 73.42, 0.16, 0.7);
    },
  },
  frontOut: {
    dur: 1.5, next: 0.7, prio: 1, family: 'jeu',
    make(k, t) {
      k.noise({ t, dur: 0.7, gain: 0.1, f: 400, to: 1800, q: 0.8, attack: 0.1, far: 0.3, pan: 0, panTo: 0.6 });
      k.tone({ f: n(0), t: t + 0.25, dur: 0.7, gain: 0.18, attack: 0.03, fm: { ratio: 2, index: 0.3, decay: 0.2 }, send: 0.25, far: 0.3 });
      k.tone({ f: n(3) * 1.003, t: t + 0.27, dur: 0.6, gain: 0.04, attack: 0.05, far: 0.4, pan: -0.35 });
    },
  },
  // Lot pris : trois petits chocs de caisses puis une note d'élan. Réussi : arpège court. Raté : deux notes qui retombent.
  jamStart: {
    dur: 1.3, next: 0.6, prio: 2, family: 'jeu',
    make(k, t) {
      [0, 0.1, 0.2].forEach((dt, i) => thud(k, t + dt, 180 - 20 * i, 0.22, 0.06, -0.3 + 0.3 * i));
      chime(k, t + 0.34, 5, 0.18, 0.5, 0.5, 0.4, 0.3);
    },
  },
  jamWon: {
    dur: 1.7, next: 0.9, prio: 2, family: 'jeu',
    make(k, t) {
      [5, 7, 8, 10].forEach((d, i) => bell(k, t + i * 0.1, d, 0.17, i === 3 ? 0.8 : 0.3, 0.6 + 0.1 * i, 0.5, -0.35 + 0.23 * i));
      felt(k, t + 0.3, 0, 0.1, 0.6, 1000, 0.2);
    },
  },
  jamLost: {
    dur: 1.3, next: 0.6, prio: 2, family: 'jeu',
    make(k, t) { felt(k, t, 1, 0.22, 0.3, 1200, 0.35, 0.15); felt(k, t + 0.2, -2, 0.22, 0.55, 1000, 0.45, -0.15); },
  },
  // Écoute d'un colis : un petit coup contre la caisse et sa résonance.
  inspect: {
    dur: 0.9, next: 0.3, prio: 1, family: 'jeu',
    make(k, t) {
      tick(k, t, 1800, 0.14);
      k.tone({ f: 260, to: 200, t, dur: 0.05, gain: 0.08, attack: 0.003 });
      k.tone({ f: n(7), t: t + 0.03, dur: 0.3, gain: 0.13, attack: 0.004, lp: 2600, send: 0.5, pan: 0.15 });
    },
  },
  // Arrimage : la sangle qui file, le cliquet qui prend cran après cran (plus de crans quand c'est bien serré), le verrou ;
  // v = qualité (bien serré : une note claire en plus).
  strap: {
    dur: 1.0, next: 0.35, prio: 1, family: 'jeu',
    make(k, t, v) {
      k.noise({ t, dur: 0.15, gain: 0.13, f: 750, to: 2700, q: 3, attack: 0.03, send: 0.15, pan: -0.35, panTo: 0.25 });
      const clicks = 3 + Math.round(2 * v);
      let at = t + 0.13;
      for (let i = 0; i < clicks; i++) {
        k.noise({ t: at, dur: 0.02, gain: 0.11 + 0.012 * i, f: (2500 + 260 * i) * (0.95 + 0.1 * k.rand()), q: 6, attack: 0.001, send: 0.12, pan: 0.1 + 0.05 * i });
        at += 0.052 - 0.006 * i;
      }
      thud(k, at, 210, 0.16, 0.05, 0.1);
      if (v >= 0.7) bell(k, at + 0.03, 8, 0.14, 0.35, 0.5, 0.35, 0.15); else felt(k, at + 0.03, 3, 0.13, 0.25, 1500, 0.35, 0.1);
    },
  },
  // Photo-preuve : déclic d'obturateur et une note brève.
  proof: {
    dur: 0.9, next: 0.3, prio: 1, family: 'jeu',
    make(k, t) {
      tick(k, t, 4200, 0.16, -0.1, 3);
      k.tone({ f: 300, to: 220, t, dur: 0.04, gain: 0.06, attack: 0.003 });
      tick(k, t + 0.06, 2600, 0.13, 0.1, 3);
      bell(k, t + 0.12, 9, 0.13, 0.3, 0.4, 0.4, 0.15);
    },
  },
  // ── Jingles de mise en scène (Sound.cue). Courts, dans la même gamme.
  // Écran de chargement : une respiration grave et trois notes lentes qui s'ouvrent.
  cueChargement: {
    dur: 2.0, next: 1.2, prio: 2, family: 'jeu',
    make(k, t) {
      felt(k, t, -5, 0.16, 1.1, 700, 0.3);
      k.noise({ t, dur: 0.9, gain: 0.03, f: 400, to: 1400, q: 0.8, attack: 0.4, far: 0.4, pan: -0.4, panTo: 0.4 });
      bell(k, t + 0.1, 0, 0.14, 0.6, 0.3, 0.5, -0.25);
      bell(k, t + 0.42, 3, 0.14, 0.6, 0.3, 0.5, 0.25);
      chime(k, t + 0.74, 5, 0.15, 0.85, 0.4, 0.55, 0.35);
    },
  },
  // Toucher de départ : un appui franc, un souffle qui s'élance, une quinte qui monte sur une sous-basse.
  cueDepart: {
    dur: 1.6, next: 0.8, prio: 2, family: 'jeu',
    make(k, t) {
      tick(k, t, 2600, 0.12);
      thud(k, t, 130, 0.3, 0.09);
      sub(k, t, 73.42, 0.18, 0.6);
      k.noise({ t: t + 0.02, dur: 0.4, gain: 0.06, f: 500, to: 3200, q: 1.2, attack: 0.15, far: 0.35, pan: -0.5, panTo: 0.5 });
      bell(k, t + 0.08, 3, 0.18, 0.4, 0.5, 0.45, -0.2);
      chime(k, t + 0.24, 5, 0.2, 0.85, 0.6, 0.5, 0.35);
    },
  },
  // Arrivée au labo : deux relais qui claquent, un bourdon d'appareil qui s'allume, trois notes feutrées et une claire.
  cueLabo: {
    dur: 1.9, next: 1.0, prio: 2, family: 'jeu',
    make(k, t) {
      tick(k, t, 1900, 0.13, -0.3, 5);
      tick(k, t + 0.09, 2500, 0.11, 0.3, 5);
      k.tone({ f: n(-10), t: t + 0.05, dur: 1.1, gain: 0.14, attack: 0.25, hold: 0.2, type: 'sawtooth', lp: 340, far: 0.15 });
      k.tone({ f: n(-7) * 1.004, t: t + 0.08, dur: 1.0, gain: 0.06, attack: 0.3, type: 'triangle', lp: 600, far: 0.2, pan: 0.3 });
      felt(k, t + 0.2, 0, 0.17, 0.3, 1600, 0.35, -0.2);
      felt(k, t + 0.36, 2, 0.17, 0.3, 1600, 0.35, 0);
      felt(k, t + 0.52, 3, 0.17, 0.4, 1800, 0.35, 0.2);
      chime(k, t + 0.7, 5, 0.16, 0.7, 0.5, 0.5, 0.3);
    },
  },
  // Passeur (téléportation) : un souffle et une note qui s'envolent d'un côté à l'autre, puis l'arrivée : un choc sourd,
  // une sous-basse et une note claire.
  cuePasseur: {
    dur: 1.9, next: 1.0, prio: 2, family: 'jeu',
    make(k, t) {
      k.noise({ t, dur: 0.6, gain: 0.1, f: 300, to: 5200, q: 1.4, attack: 0.4, far: 0.35, pan: -0.8, panTo: 0.8 });
      k.tone({ f: n(0), to: n(5), glide: 0.5, t, dur: 0.58, gain: 0.14, attack: 0.3, fm: { ratio: 2, index: 0.5, decay: 0.5 }, far: 0.4, pan: -0.6, panTo: 0.6 });
      k.tone({ f: n(3), to: n(8), glide: 0.5, t: t + 0.03, dur: 0.55, gain: 0.06, attack: 0.3, far: 0.5, pan: 0.6, panTo: -0.4 });
      const c = t + 0.6;
      thud(k, c, 100, 0.26, 0.1);
      sub(k, c, 73.42, 0.18, 0.6);
      chime(k, c + 0.02, 8, 0.17, 0.8, 0.7, 0.55, 0.35);
      air(k, c, 0.4, 0.035, 6000, 0.4);
    },
  },
  // Fin de chapitre : une cadence lente (ré, la, do) qui se pose sur l'accord ré-la-ré, avec basse et sous-basse.
  cueChapitre: {
    dur: 2.0, next: 1.4, prio: 2, family: 'jeu',
    make(k, t) {
      felt(k, t, -5, 0.16, 0.7, 800, 0.25);
      bell(k, t, 0, 0.16, 0.45, 0.4, 0.5, -0.3);
      bell(k, t + 0.2, 3, 0.16, 0.45, 0.4, 0.5, 0);
      bell(k, t + 0.4, 4, 0.16, 0.45, 0.5, 0.5, 0.3);
      const c = t + 0.64;
      felt(k, c, -5, 0.18, 0.9, 900, 0.2);
      sub(k, c, 73.42, 0.18, 0.8);
      chime(k, c, 5, 0.16, 0.95, 0.6, 0.55, 0.4);
      bell(k, c + 0.02, 8, 0.13, 0.95, 0.7, 0.55, -0.25);
      air(k, c - 0.05, 0.5, 0.03, 5600);
    },
  },
};

export const SOUND_NAMES = Object.keys(SOUNDS) as SoundName[];

/** Programme un son à l'instant t (horloge du contexte du banc). Chaque exécution diffère très légèrement
 *  (niveau, accord, position) : un même son n'est jamais exactement identique deux fois. */
export function play(rig: Rig, name: SoundName, t: number, v = 0, w = 0, pan = 0): void {
  const def = SOUNDS[name], trim = TRIM[name], r = rig.rand;
  const place = (p: number | undefined): number => (p ?? 0) + pan + (r() - 0.5) * 0.06;
  const kit: Kit = {
    tone: o => {
      tone(rig, {
        prio: def.prio, ...o, gain: o.gain * trim * (0.96 + 0.08 * r()), pan: place(o.pan),
        panTo: o.panTo === undefined ? undefined : o.panTo + pan,
        // ±3 centièmes de ton sur les notes ; les graves des chocs varient un peu plus.
        f: o.f * 2 ** (((r() - 0.5) * 6) / 1200),
      });
    },
    noise: o => {
      noise(rig, { prio: def.prio, ...o, gain: o.gain * trim * (0.94 + 0.12 * r()), f: o.f * (0.97 + 0.06 * r()), pan: place(o.pan), panTo: o.panTo === undefined ? undefined : o.panTo + pan });
    },
    rand: r,
  };
  def.make(kit, t, Math.max(0, Math.min(1, v)), Math.max(0, Math.min(1, w)));
}
