// Interjections vocales synthétisées (« hm », « huh », « ah », « ho ») : la « voix » des personnages, comme dans
// un jeu de rôle en ligne. Aucune parole, aucun fichier : une source glottale (dent de scie adoucie) passe dans
// deux ou trois filtres de formants qui dessinent la voyelle ; la hauteur glisse comme dans une vraie intonation,
// un peu de souffle se mêle au timbre, l'enveloppe est douce. Chaque personnage a sa hauteur, sa voyelle,
// son contour et sa rapidité ; deux ou trois variantes tournent pour ne pas lasser.
import type { Rig } from './rig';

export type BlipMood = 'neutre' | 'content' | 'grave';
export type VowelName = 'a' | 'o' | 'e' | 'oe' | 'm';

interface Vowel {
  /** Fréquences des trois formants pour un conduit vocal masculin (Hz). */
  f: [number, number, number];
  /** Poids de chaque formant. */
  a: [number, number, number];
  /** Pente de la source : passe-bas avant les formants (Hz). Plus bas = plus feutré. */
  tilt: number;
  /** Bouche ouverte (vraie voyelle) : le premier formant s'ouvre au début, comme une mâchoire. */
  open: boolean;
}
export const VOWELS: Record<VowelName, Vowel> = {
  a: { f: [740, 1220, 2500], a: [1, 0.5, 0.14], tilt: 1700, open: true },
  o: { f: [430, 800, 2400], a: [1, 0.42, 0.05], tilt: 1200, open: true },
  e: { f: [410, 1900, 2550], a: [1, 0.4, 0.18], tilt: 1900, open: true },
  oe: { f: [520, 1280, 2400], a: [1, 0.4, 0.09], tilt: 1500, open: true }, // « huh » : voyelle neutre
  m: { f: [270, 1050, 2250], a: [1, 0.1, 0.03], tilt: 650, open: false }, // bouche fermée : « hm »
};

/** Une syllabe : départ et durée (s), contour de hauteur (multiplicateurs de la fondamentale, répartis sur la durée). */
interface Syllable { at: number; dur: number; c: number[]; gain?: number }
export interface Persona {
  /** Fondamentale (Hz). */
  f0: number;
  vowel: VowelName;
  /** Taille du conduit vocal : 1 = homme, vers 1,16 = femme (formants plus hauts). */
  tract: number;
  syllables: Syllable[];
  /** Souffle d'attaque (le « h » de « ha », « hé », « huh »), 0 à 1. */
  h: number;
  /** Souffle mêlé à la voix, 0 à 1. */
  breath: number;
  /** Douceur de l'attaque : 0 = nette, 1 = très progressive. */
  soft: number;
  pan: number;
}

/** Les sept personnages et la voix par défaut (rôdeurs, inconnus). */
export const PERSONAS: Record<string, Persona> = {
  // Mara : femme chaleureuse, « ah » qui monte.
  mara: { f0: 212, vowel: 'a', tract: 1.15, syllables: [{ at: 0, dur: 0.34, c: [0.93, 0.97, 1.05, 1.13] }], h: 0.1, breath: 0.35, soft: 0.6, pan: -0.08 },
  // Tomas : homme bourru, « hm » grave et court.
  tomas: { f0: 98, vowel: 'm', tract: 0.96, syllables: [{ at: 0, dur: 0.22, c: [1.04, 1.0, 0.93] }], h: 0.25, breath: 0.3, soft: 0.25, pan: 0.08 },
  // Agathe : femme précise, « hm-hm » net (deux syllabes, la seconde plus haute).
  agathe: { f0: 228, vowel: 'm', tract: 1.16, syllables: [{ at: 0, dur: 0.12, c: [1.0, 0.97] }, { at: 0.16, dur: 0.16, c: [1.16, 1.2, 1.14], gain: 0.9 }], h: 0.05, breath: 0.15, soft: 0.15, pan: -0.05 },
  // Kenji : jeune homme rêveur, « oh » doux.
  kenji: { f0: 136, vowel: 'o', tract: 1.02, syllables: [{ at: 0, dur: 0.42, c: [0.98, 1.04, 1.02, 0.94] }], h: 0, breath: 0.45, soft: 1, pan: 0.06 },
  // Iris : femme posée, autorité calme, « hm » qui descend.
  iris: { f0: 188, vowel: 'm', tract: 1.13, syllables: [{ at: 0, dur: 0.36, c: [1.09, 1.04, 0.95, 0.87] }], h: 0.1, breath: 0.2, soft: 0.5, pan: 0 },
  // Noé : homme enjoué, « hé » bref.
  noe: { f0: 152, vowel: 'e', tract: 1.0, syllables: [{ at: 0, dur: 0.2, c: [1.0, 1.13, 1.07] }], h: 0.7, breath: 0.25, soft: 0.2, pan: 0.07 },
  // Selma : femme ironique et tendre, « ha » léger.
  selma: { f0: 222, vowel: 'a', tract: 1.14, syllables: [{ at: 0, dur: 0.24, c: [1.08, 1.05, 0.97] }], h: 0.9, breath: 0.6, soft: 0.4, pan: -0.07 },
  // Défaut neutre : « huh » court, à mi-hauteur.
  '': { f0: 160, vowel: 'oe', tract: 1.06, syllables: [{ at: 0, dur: 0.26, c: [0.98, 1.0, 1.05] }], h: 0.6, breath: 0.35, soft: 0.4, pan: 0 },
};

/** Nombre de variantes par personnage, tirées à tour de rôle. */
export const BLIP_VARIANTS = 3;
// Variantes : hauteur, durée, pente du contour (fin plus haute ou plus basse).
const VARIANTS = [{ f: 1, d: 1, slope: 0 }, { f: 1.045, d: 0.9, slope: 0.035 }, { f: 0.965, d: 1.12, slope: -0.03 }];
// Humeur : content = un peu plus haut, plus clair, la fin remonte ; grave = plus bas, plus sombre, plus lent, la fin retombe.
const MOODS: Record<BlipMood, { f: number; d: number; slope: number; tilt: number }> = {
  neutre: { f: 1, d: 1, slope: 0, tilt: 1 },
  content: { f: 1.06, d: 0.95, slope: 0.08, tilt: 1.2 },
  grave: { f: 0.93, d: 1.12, slope: -0.08, tilt: 0.82 },
};
/** Niveau général des interjections, réglé d'après les mesures : discret, du niveau d'un son d'interface. */
const LEVEL = 0.5;

/** Nom de personnage normalisé : minuscules, sans accent (« Noé » → « noe »). */
export function personaKey(who: string): string {
  const k = String(who ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  return k in PERSONAS ? k : '';
}

/** Ce que vise la synthèse pour un personnage, une humeur et une variante (sert aussi aux mesures). */
export function blipPlan(who: string, mood: BlipMood = 'neutre', variant = 0): { persona: Persona; f0: number; dur: number; formants: number[]; slope: number; tilt: number } {
  const persona = PERSONAS[personaKey(who)], m = MOODS[mood] ?? MOODS.neutre, v = VARIANTS[((variant % BLIP_VARIANTS) + BLIP_VARIANTS) % BLIP_VARIANTS];
  const last = persona.syllables[persona.syllables.length - 1], scale = m.d * v.d;
  return {
    persona, f0: persona.f0 * m.f * v.f, dur: Math.max(0.2, Math.min(0.5, (last.at + last.dur) * scale)), slope: m.slope + v.slope, tilt: m.tilt,
    formants: VOWELS[persona.vowel].f.map(f => f * persona.tract),
  };
}

export interface BlipHandle {
  /** Instant de fin (horloge du contexte). */
  end: number;
  /** Coupe l'interjection en fondu court (une nouvelle interjection remplace la précédente). */
  cut(now: number): void;
}

/** Enveloppe douce d'une syllabe : montée arrondie, tenue, extinction en pente, toujours de 0 à 0. */
function swell(g: AudioParam, t: number, dur: number, peak: number, soft: number): void {
  const N = 14, rise = 0.12 + 0.2 * soft;
  g.setValueAtTime(0, t);
  for (let i = 1; i <= N; i++) {
    const x = i / N;
    const up = x < rise ? 0.5 - 0.5 * Math.cos((Math.PI * x) / rise) : 1;
    const down = x > 0.45 ? 0.5 + 0.5 * Math.cos((Math.PI * (x - 0.45)) / 0.55) : 1;
    g.linearRampToValueAtTime(i === N ? 0 : peak * up * down ** 1.3, t + dur * x);
  }
}

/** Programme une interjection à l'instant t. Renvoie de quoi la couper, ou null si aucune voix n'est libre. */
export function playBlip(rig: Rig, who: string, mood: BlipMood, variant: number, t: number): BlipHandle | null {
  const { ctx } = rig, plan = blipPlan(who, mood, variant), p = plan.persona, vowel = VOWELS[p.vowel];
  const last = p.syllables[p.syllables.length - 1], scale = plan.dur / (last.at + last.dur);
  const lead = p.h > 0 ? 0.035 : 0; // le souffle du « h » précède la voix
  const end = t + lead + plan.dur + 0.03;
  if (!rig.claim(t, end, 1)) return null;
  const r = rig.rand, f0 = plan.f0 * (0.985 + 0.03 * r());

  // Source glottale : dent de scie adoucie par un passe-bas (la pente naturelle d'une voix).
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = f0;
  const tilt = ctx.createBiquadFilter();
  tilt.type = 'lowpass'; tilt.frequency.value = vowel.tilt * plan.tilt * (0.7 + 0.3 * p.tract); tilt.Q.value = 0.5;
  const voiced = ctx.createGain();
  voiced.gain.value = 0;
  osc.connect(tilt); tilt.connect(voiced);
  // Souffle : bruit filtré, qui passe par les mêmes formants (il prend la couleur de la voyelle).
  const air = ctx.createBufferSource();
  air.buffer = rig.noise; air.loop = true;
  const airBand = ctx.createBiquadFilter();
  airBand.type = 'bandpass'; airBand.frequency.value = 1700 * p.tract; airBand.Q.value = 0.5;
  const breath = ctx.createGain();
  breath.gain.value = 0;
  air.connect(airBand); airBand.connect(breath);

  // Conduit vocal : formants en parallèle, plus un peu de poitrine (le grave de la voix).
  const mouth = ctx.createGain();
  mouth.gain.value = LEVEL;
  const f1 = vowel.f[0] * p.tract;
  vowel.f.forEach((f, i) => {
    const bp = ctx.createBiquadFilter(), g = ctx.createGain(), target = f * p.tract * (0.98 + 0.04 * r());
    bp.type = 'bandpass'; bp.Q.value = [5.5, 7, 8][i];
    bp.frequency.value = target;
    if (i === 0 && vowel.open) {
      // La bouche s'ouvre : le premier formant part plus bas et rejoint sa place.
      bp.frequency.setValueAtTime(target * 0.8, t + lead);
      bp.frequency.linearRampToValueAtTime(target, t + lead + Math.min(0.09, plan.dur * 0.35));
    }
    g.gain.value = vowel.a[i] * [2.2, 2.6, 3][i];
    voiced.connect(bp); breath.connect(bp); bp.connect(g); g.connect(mouth);
  });
  const chest = ctx.createBiquadFilter(), chestGain = ctx.createGain();
  chest.type = 'lowpass'; chest.frequency.value = Math.min(f1, f0 * 2.2); chest.Q.value = 0.5;
  chestGain.gain.value = vowel.open ? 0.3 : 0.55;
  voiced.connect(chest); chest.connect(chestGain); chestGain.connect(mouth);

  // Syllabes : hauteur qui glisse d'un point du contour au suivant, enveloppe douce, souffle d'attaque.
  p.syllables.forEach((s, k) => {
    const at = t + lead + s.at * scale, dur = s.dur * scale, n = s.c.length;
    s.c.forEach((c, i) => {
      const x = n > 1 ? i / (n - 1) : 0;
      const f = f0 * (c + plan.slope * (x - 0.3)) * (0.996 + 0.008 * r());
      if (i === 0) osc.frequency.setValueAtTime(f, at); else osc.frequency.linearRampToValueAtTime(f, at + dur * x);
    });
    swell(voiced.gain, at, dur, s.gain ?? 1, p.soft);
    // Souffle : un « h » bref avant la voix (première syllabe), puis un filet d'air sous la voix.
    const onset = k === 0 ? p.h : 0;
    breath.gain.setValueAtTime(0, at - (k === 0 ? lead : 0));
    if (onset > 0) breath.gain.linearRampToValueAtTime(0.5 * onset, at - lead * 0.2);
    breath.gain.linearRampToValueAtTime(0.1 * p.breath, at + dur * 0.25);
    breath.gain.linearRampToValueAtTime(0.06 * p.breath, at + dur * 0.7);
    breath.gain.linearRampToValueAtTime(0, at + dur);
  });

  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 70; hp.Q.value = 0.5;
  const master = ctx.createGain();
  mouth.connect(hp); hp.connect(master);
  // Une pointe de réverbération proche : la voix est là, dans la pièce, pas dans une cathédrale.
  rig.route(master, 0.16, p.pan, 0.04);
  osc.start(t); osc.stop(end + 0.05);
  air.start(t, r() * 3); air.stop(end + 0.05);

  return {
    end,
    cut(now: number): void {
      if (now >= end) return;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(1, now);
      master.gain.linearRampToValueAtTime(0, now + 0.03);
      osc.stop(now + 0.05); air.stop(now + 0.05);
    },
  };
}
