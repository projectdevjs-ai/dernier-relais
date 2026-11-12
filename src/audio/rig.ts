// Banc de synthèse commun : chaîne de sortie (réverbération, compresseur, plafond), compte des voix
// et deux briques de son (note et souffle). Tout fonctionne dans n'importe quel BaseAudioContext,
// donc aussi dans un OfflineAudioContext pour mesurer les sons sans les écouter.

/** Nombre maximal de voix ponctuelles simultanées (une voix = une note ou un souffle). */
export const MAX_VOICES = 16;
/** Priorité d'une voix : 0 = détail d'ambiance (pas, gouttes), 1 = interface, 2 = événement du jeu. */
export type Prio = 0 | 1 | 2;
// Plafond de voix par priorité : les détails d'ambiance ne peuvent jamais priver un jingle de ses notes.
const CAP: Record<Prio, number> = { 0: 6, 1: 12, 2: MAX_VOICES };

/** Plafond absolu de la sortie, en amplitude : 0,84 soit environ −1,5 dBFS. */
export const CEILING = 0.84;
// Compresseur « musical » : seuil bas, taux doux, attaque assez lente pour laisser passer les transitoires
// (le plafond arrondi les rattrape), relâchement court. Le compresseur des navigateurs ajoute tout seul un gain
// de rattrapage (mesuré dans Chrome avec ces réglages) : on le retire juste après pour que les niveaux restent vrais.
const COMP = { threshold: -14, knee: 8, ratio: 3, attack: 0.01, release: 0.2 };
const COMP_MAKEUP = 1.9;
/** Gain de sortie : un son seul culmine vers −7 dBFS, un passage dense est tenu par le compresseur puis arrondi par le plafond. */
export const OUTPUT_BOOST = 1.4;
// Égalisation pensée pour un haut-parleur de téléphone : coupe-bas (rien d'inutile sous 35 Hz), présence vers 2,6 kHz,
// extrême aigu adouci. Les graves restent audibles par leurs harmoniques (voir `sub` dans le catalogue).
const EQ = { hp: 35, presence: 2600, presenceDb: 2.5, air: 9500, airDb: -1.5 };
/** Deux réverbérations : « proche » (petite pièce, sons d'interface et de manipulation) et « vaste » (dehors, moments forts). */
const ROOMS = {
  near: { seconds: 0.8, pre: 0.004, early: 9, spread: 0.045, damp: 0.55, back: 0.5 },
  far: { seconds: 1.45, pre: 0.018, early: 14, spread: 0.11, damp: 0.72, back: 0.45 },
} as const;
const NOISE_S = 3.7;

/** Générateur pseudo-aléatoire reproductible (pour des mesures identiques d'un rendu à l'autre). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Room { seconds: number; pre: number; early: number; spread: number; damp: number; back: number }
/**
 * Réponse impulsionnelle générée : premières réflexions (échos discrets, différents à gauche et à droite) puis queue
 * diffuse qui monte doucement, s'éteint et s'assombrit (les aigus meurent plus vite que les médiums). Énergie normalisée à 1.
 */
function makeImpulse(ctx: BaseAudioContext, room: Room, rand: () => number): AudioBuffer {
  const sr = ctx.sampleRate, len = Math.max(1, Math.floor(sr * room.seconds));
  const buf = ctx.createBuffer(2, len, sr), pre = Math.floor(sr * room.pre);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    // Queue diffuse : bruit clair qui s'éteint vite + bruit assourdi qui dure, sans grave inutile.
    let lp = 0, low = 0;
    const build = sr * room.spread * 0.6;
    for (let i = pre; i < len; i++) {
      const x = (i - pre) / (len - pre), w = rand() * 2 - 1;
      lp = lp * room.damp + w * (1 - room.damp);
      low = low * 0.985 + lp * 0.015;
      const fadeIn = Math.min(1, (i - pre) / build), fadeOut = Math.min(1, (len - 1 - i) / (sr * 0.04));
      d[i] = (w * 0.45 * Math.exp(-13 * x) + (lp - low) * 1.6 * Math.exp(-6.9 * x)) * fadeIn * fadeOut;
    }
    // Premières réflexions : quelques échos nets, de plus en plus faibles et de plus en plus doux.
    for (let k = 0; k < room.early; k++) {
      const at = pre + Math.floor(sr * room.spread * ((k + 0.3 + 0.6 * rand()) / room.early));
      const amp = (rand() < 0.5 ? -1 : 1) * 0.5 * (1 - 0.6 * (k / room.early)) * (0.7 + 0.6 * rand());
      const width = 2 + Math.floor(k / 3);
      for (let j = 0; j < width && at + j < len; j++) d[at + j] += (amp / width) * (1 - j / width) * 2;
    }
    let energy = 0;
    for (let i = 0; i < len; i++) energy += d[i] * d[i];
    const g = 1 / Math.sqrt(energy || 1);
    for (let i = 0; i < len; i++) d[i] *= g;
  }
  return buf;
}

/** Courbe du plafond : transparente jusqu'à 0,5, puis arrondie, jamais au-dessus de CEILING. */
function makeCeilingCurve(): Float32Array<ArrayBuffer> {
  const n = 2049, c = new Float32Array(n), knee = 0.5, room = CEILING - knee;
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 2; // l'entrée est divisée par 2 avant la courbe : elle couvre ±2
    const a = Math.abs(x);
    c[i] = Math.sign(x) * (a <= knee ? a : knee + room * Math.tanh((a - knee) / room));
  }
  return c;
}

export interface RigOptions { volume?: number; rand?: () => number }

export class Rig {
  readonly ctx: BaseAudioContext;
  /** Entrée directe des sons ponctuels. */
  readonly dry: GainNode;
  /** Départ vers la réverbération proche (petite pièce). */
  readonly wet: GainNode;
  /** Départ vers la réverbération vaste (dehors). */
  readonly far: GainNode;
  /** Entrée de la nappe d'ambiance. */
  readonly amb: GainNode;
  /** Volume général, placé après le plafond : la sortie ne dépasse jamais CEILING. */
  readonly out: GainNode;
  /** Bruit blanc partagé (souffles, pas, pluie, vent). */
  readonly noise: AudioBuffer;
  readonly rand: () => number;
  private spans: Array<{ t0: number; end: number }> = [];

  constructor(ctx: BaseAudioContext, opts: RigOptions = {}) {
    this.ctx = ctx;
    this.rand = opts.rand ?? Math.random;
    const len = Math.floor(ctx.sampleRate * NOISE_S);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = this.rand() * 2 - 1;

    const sum = ctx.createGain();
    this.dry = ctx.createGain();
    this.amb = ctx.createGain();
    this.wet = ctx.createGain();
    this.far = ctx.createGain();
    this.dry.connect(sum);
    this.amb.connect(sum);
    for (const [send, room] of [[this.wet, ROOMS.near], [this.far, ROOMS.far]] as const) {
      const conv = ctx.createConvolver(), back = ctx.createGain();
      conv.normalize = false;
      conv.buffer = makeImpulse(ctx, room, this.rand);
      back.gain.value = room.back;
      send.connect(conv); conv.connect(back); back.connect(sum);
    }

    const filter = (type: BiquadFilterType, f: number, q: number, gainDb = 0): BiquadFilterNode => {
      const b = ctx.createBiquadFilter();
      b.type = type; b.frequency.value = f; b.Q.value = q;
      if (b.gain) b.gain.value = gainDb;
      return b;
    };
    const hp = filter('highpass', EQ.hp, 0.7), presence = filter('peaking', EQ.presence, 0.8, EQ.presenceDb), air = filter('highshelf', EQ.air, 0.7, EQ.airDb);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = COMP.threshold; comp.knee.value = COMP.knee; comp.ratio.value = COMP.ratio;
    comp.attack.value = COMP.attack; comp.release.value = COMP.release;
    const pre = ctx.createGain();
    pre.gain.value = (0.5 * OUTPUT_BOOST) / COMP_MAKEUP;
    const ceil = ctx.createWaveShaper();
    ceil.curve = makeCeilingCurve();
    this.out = ctx.createGain();
    this.out.gain.value = opts.volume ?? 1;
    sum.connect(hp); hp.connect(presence); presence.connect(air); air.connect(comp);
    comp.connect(pre); pre.connect(ceil); ceil.connect(this.out); this.out.connect(ctx.destination);
  }

  /** Réserve une voix sur [t0, end]. Refuse (false) si trop de voix se chevauchent déjà à ce moment-là. */
  claim(t0: number, end: number, prio: Prio): boolean {
    const now = this.ctx.currentTime;
    this.spans = this.spans.filter(s => s.end > now);
    let overlap = 0;
    for (const s of this.spans) if (s.t0 < end && s.end > t0) overlap++;
    if (overlap >= CAP[prio]) return false;
    this.spans.push({ t0, end });
    return true;
  }

  /** Voix réservées et pas encore terminées (jouées ou programmées). */
  get voices(): number {
    const now = this.ctx.currentTime;
    return this.spans.reduce((n, s) => n + (s.end > now ? 1 : 0), 0);
  }

  /** Plus grand nombre de voix qui se chevauchent, maintenant ou plus tard. */
  get peakVoices(): number {
    const now = this.ctx.currentTime;
    const live = this.spans.filter(s => s.end > now);
    let peak = 0;
    for (const a of live) {
      let n = 0;
      for (const b of live) if (b.t0 <= a.t0 && b.end > a.t0) n++;
      peak = Math.max(peak, n);
    }
    return peak;
  }

  /**
   * Branche une voix sur la sortie directe, avec panoramique et départs de réverbération facultatifs.
   * `move` : le son glisse de `pan` à `move.to` entre `move.t` et `move.t + move.dur` (léger mouvement dans l'espace).
   */
  route(node: AudioNode, send: number, pan: number, far = 0, move?: { to: number; t: number; dur: number }): void {
    let n = node;
    if ((pan || move) && typeof this.ctx.createStereoPanner === 'function') {
      const p = this.ctx.createStereoPanner(), lim = (x: number): number => Math.max(-1, Math.min(1, x));
      p.pan.value = lim(pan);
      if (move) { p.pan.setValueAtTime(lim(pan), move.t); p.pan.linearRampToValueAtTime(lim(move.to), move.t + move.dur); }
      n.connect(p); n = p;
    }
    n.connect(this.dry);
    for (const [level, bus] of [[send, this.wet], [far, this.far]] as const) {
      if (!(level > 0)) continue;
      const s = this.ctx.createGain();
      s.gain.value = level;
      n.connect(s); s.connect(bus);
    }
  }
}

/** Enveloppe sans clic : part de 0, monte en `attack`, tient `hold`, s'éteint à −60 dB en `dur`, finit à 0. */
function shape(g: AudioParam, t: number, attack: number, hold: number, dur: number, peak: number): void {
  // Valeur de repos à 0 : sans elle, le gain vaut 1 jusqu'à l'instant t et laisse passer un échantillon de trop (clic).
  g.value = 0;
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(peak, t + attack);
  if (hold > 0) g.setValueAtTime(peak, t + attack + hold);
  g.exponentialRampToValueAtTime(Math.max(peak * 0.001, 1e-6), t + dur);
  g.linearRampToValueAtTime(0, t + dur + TAIL);
}
const TAIL = 0.012;

export interface ToneOpts {
  /** Fréquence en Hz. */
  f: number;
  /** Instant de départ (horloge du contexte). */
  t: number;
  /** Durée jusqu'à l'extinction, attaque comprise. */
  dur: number;
  gain: number;
  attack?: number;
  hold?: number;
  type?: OscillatorType;
  /** Fréquence d'arrivée d'un glissé, atteinte en `glide` secondes (toute la durée par défaut). */
  to?: number;
  glide?: number;
  /** Légère modulation de fréquence : `ratio` = modulateur / porteuse, `index` = profondeur, qui retombe en `decay` s. */
  fm?: { ratio: number; index: number; decay?: number };
  /** Passe-bas en Hz. */
  lp?: number;
  /** Départ vers la réverbération proche, 0 à 1. */
  send?: number;
  /** Départ vers la réverbération vaste, 0 à 1. */
  far?: number;
  pan?: number;
  /** Position d'arrivée : le son glisse de `pan` à `panTo` pendant sa durée. */
  panTo?: number;
  prio?: Prio;
}

/** Une note : oscillateur doux, enveloppe, filtre et modulation facultatifs. Renvoie false si la voix est refusée. */
export function tone(rig: Rig, o: ToneOpts): boolean {
  const { ctx } = rig;
  const attack = Math.min(o.attack ?? 0.006, o.dur * 0.5);
  const end = o.t + o.dur + TAIL;
  if (!rig.claim(o.t, end, o.prio ?? 2)) return false;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f, o.t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, o.t + (o.glide ?? o.dur));
  if (o.fm) {
    const mod = ctx.createOscillator(), depth = ctx.createGain(), dev = o.fm.index * o.f;
    mod.frequency.value = o.f * o.fm.ratio;
    depth.gain.setValueAtTime(dev, o.t);
    depth.gain.exponentialRampToValueAtTime(Math.max(dev * 0.05, 0.01), o.t + (o.fm.decay ?? o.dur * 0.5));
    mod.connect(depth); depth.connect(osc.frequency);
    mod.start(o.t); mod.stop(end + 0.02);
  }
  let head: AudioNode = osc;
  if (o.lp) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = o.lp; lp.Q.value = 0.5;
    head.connect(lp); head = lp;
  }
  const env = ctx.createGain();
  shape(env.gain, o.t, attack, o.hold ?? 0, o.dur, o.gain);
  head.connect(env);
  rig.route(env, o.send ?? 0, o.pan ?? 0, o.far ?? 0, o.panTo === undefined ? undefined : { to: o.panTo, t: o.t, dur: o.dur });
  osc.start(o.t); osc.stop(end + 0.02);
  return true;
}

export interface NoiseOpts {
  t: number;
  dur: number;
  gain: number;
  /** Fréquence du filtre en Hz, et arrivée facultative d'un balayage. */
  f: number;
  to?: number;
  type?: BiquadFilterType;
  q?: number;
  attack?: number;
  hold?: number;
  send?: number;
  far?: number;
  pan?: number;
  panTo?: number;
  prio?: Prio;
}

/** Un souffle : bruit blanc filtré avec enveloppe (chocs, frottements, vagues). */
export function noise(rig: Rig, o: NoiseOpts): boolean {
  const { ctx } = rig;
  const attack = Math.min(o.attack ?? 0.003, o.dur * 0.5);
  const end = o.t + o.dur + TAIL;
  if (!rig.claim(o.t, end, o.prio ?? 2)) return false;
  const src = ctx.createBufferSource();
  src.buffer = rig.noise; src.loop = true;
  const fl = ctx.createBiquadFilter();
  fl.type = o.type ?? 'bandpass';
  fl.frequency.setValueAtTime(o.f, o.t);
  if (o.to) fl.frequency.exponentialRampToValueAtTime(o.to, o.t + o.dur);
  fl.Q.value = o.q ?? 1;
  const env = ctx.createGain();
  shape(env.gain, o.t, attack, o.hold ?? 0, o.dur, o.gain);
  src.connect(fl); fl.connect(env);
  rig.route(env, o.send ?? 0, o.pan ?? 0, o.far ?? 0, o.panTo === undefined ? undefined : { to: o.panTo, t: o.t, dur: o.dur });
  src.start(o.t, rig.rand() * (NOISE_S - 0.1)); src.stop(end + 0.02);
  return true;
}
