// Nappe d'ambiance : vent, pluie, fond tonal très bas, plus les détails cadencés (pas, battement d'alerte,
// tonnerre, notes de nuit). Rien ne tourne en boucle reconnaissable : les niveaux et les filtres dérivent
// lentement sur des périodes sans rapport entre elles. Aucune minuterie : tout est recalculé et programmé
// un peu en avance à chaque appel de update(), donc tout s'arrête dès que le jeu cesse d'appeler.
import type { GameView, Weather, WeatherKind } from '../game/api';
import type { Rig } from './rig';
import { play } from './sounds';

/** Ce dont la nappe a besoin, extrait de l'état du jeu. */
export interface AmbientInput {
  weather: Weather;
  speedMps: number;
  moving: boolean;
  /** Charge portée / capacité, de 0 à 1. */
  load: number;
  /** Équilibre de la charge, de −1 à 1. */
  balance: number;
}

export function ambientInput(view: GameView): AmbientInput {
  const p = view.player;
  return {
    weather: view.weather,
    speedMps: p.speedMps,
    moving: p.moving,
    load: p.capacityKg > 0 ? Math.max(0, Math.min(1, p.carriedKg / p.capacityKg)) : 0,
    balance: p.balance,
  };
}

// Par météo : pluie (0 à 1), poids du vent, fond tonal, ouverture du filtre général (Hz).
const MOODS: Record<WeatherKind, { rain: number; wind: number; pad: number; cut: number }> = {
  clair: { rain: 0, wind: 0.5, pad: 0, cut: 6500 },
  nuages: { rain: 0, wind: 0.8, pad: 0.12, cut: 5500 },
  pluie: { rain: 0.55, wind: 0.9, pad: 0.1, cut: 6500 },
  orage: { rain: 1, wind: 1.2, pad: 0.22, cut: 7000 },
  neige: { rain: 0, wind: 0.6, pad: 0.25, cut: 1800 },
  brouillard: { rain: 0, wind: 0.45, pad: 0.35, cut: 2200 },
};
const MOOD_DEFAULT = MOODS.nuages;
/** Niveau général de la nappe : volontairement bas, bien en dessous des sons du jeu. */
const BED = 0.4;
/** Fond de l'air (ville lointaine le jour, silence feutré la nuit) : le plancher de la nappe, toujours au-dessus des pas. */
const FOND = 0.5;
const FIFTHS = [220.4, 196.2, 261.9, 174.8]; // la, sol, do, fa : la voix mobile du fond tonal
const PATTER_S = 6.1;

/** Dérive lente entre 0 et 1 : deux sinus de périodes sans rapport, jamais deux fois la même courbe à l'oreille. */
function drift(t: number, a: number, b: number, phase: number): number {
  return 0.5 + 0.3 * Math.sin(a * t + phase) + 0.2 * Math.sin(b * t + phase * 2.3);
}
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

interface Layer { sources: AudioScheduledSourceNode[]; nodes: AudioNode[]; idleSince: number | null }
interface WindLayer extends Layer { lp: BiquadFilterNode; g: GainNode; bp: BiquadFilterNode; gw: GainNode; air: BiquadFilterNode; ga: GainNode; pan: StereoPannerNode | null }
interface FondLayer extends Layer { bands: BiquadFilterNode[]; gains: GainNode[] }
interface RainLayer extends Layer { lp: BiquadFilterNode; g: GainNode; gp: GainNode }
interface PadLayer extends Layer { gains: GainNode[]; mobile: OscillatorNode }

export class Ambience {
  private bus: GainNode | null = null;
  private veil: BiquadFilterNode | null = null;
  private wind: WindLayer | null = null;
  private fond: FondLayer | null = null;
  private rain: RainLayer | null = null;
  private pad: PadLayer | null = null;
  private patter: AudioBuffer | null = null;
  private last = new WeakMap<AudioParam, number>();
  private phase: number;
  private lastUpdate = -1;
  private gap = 0.2;
  private nextStep = 0;
  private nextPulse = 0;
  private nextThunder = 0;
  private nextNote = 0;
  private nextShift = 0;
  private foot = 1;

  constructor(private readonly rig: Rig) {
    this.phase = rig.rand() * 6.28;
  }

  /** Vrai si des nœuds de la nappe existent (donc consomment). */
  get running(): boolean { return this.bus !== null; }

  /** Met la nappe à jour et programme les détails de la demi-seconde à venir. À appeler plusieurs fois par seconde. */
  update(inp: AmbientInput): void {
    const { ctx } = this.rig, now = ctx.currentTime;
    if (this.lastUpdate >= 0 && now > this.lastUpdate) this.gap += (Math.min(1, now - this.lastUpdate) - this.gap) * 0.3;
    this.lastUpdate = now;
    // On programme un peu plus loin que l'intervalle entre deux appels, pour ne jamais laisser de trou.
    const horizon = now + Math.max(0.3, Math.min(1.3, this.gap * 2.5));

    const w = inp.weather, mood = MOODS[w.kind] ?? MOOD_DEFAULT;
    const night = w.night ? 1 : 0;
    this.ensureBus(now);
    this.set(this.veil!.frequency, mood.cut * (night ? 0.55 : 1), 1.5);
    this.set(this.bus!.gain, BED * (night ? 0.8 : 1), 0.6);

    const wind = clamp01(w.windKmh / 60), T = now, ph = this.phase;
    // Fond de l'air : le jour, la rumeur d'une ville lointaine (deux bandes médium qui respirent, une de chaque côté) ;
    // la nuit, la même matière plus grave et plus basse, feutrée. Sous la neige et le brouillard, elle s'étouffe.
    if (this.layer('fond', true, now)) {
      const l = this.fond!, muffle = mood.cut < 3000 ? 0.75 : 1;
      l.gains.forEach((g, i) => this.set(g.gain, FOND * (night ? 0.8 : 1) * (0.7 + 0.5 * drift(T, 0.043 + 0.017 * i, 0.101 + 0.029 * i, ph + 8 + 3 * i)), 2));
      l.bands.forEach((b, i) => this.set(b.frequency, (night ? 250 : 390) * (1 + 0.32 * i) * muffle * (0.9 + 0.2 * drift(T, 0.031 + 0.011 * i, 0.077, ph + 11 + i)), 3));
    }
    // Vent : niveau proportionnel au vent, avec des rafales lentes ; le filtre s'ouvre quand il forcit.
    const gust = drift(T, 0.29, 0.67, ph);
    const windLevel = (0.015 + 0.3 * wind ** 1.4) * mood.wind * (0.55 + 0.9 * gust);
    if (this.layer('wind', windLevel > 0.004, now)) {
      const l = this.wind!;
      this.set(l.g.gain, windLevel, 0.9);
      this.set(l.lp.frequency, 180 + 900 * wind * (0.4 + 0.8 * drift(T, 0.09, 0.23, ph + 1)), 1.2);
      const whistle = Math.max(0, wind - 0.45) * 0.3 * drift(T, 0.17, 0.41, ph + 2) ** 2;
      this.set(l.gw.gain, whistle, 0.8);
      this.set(l.bp.frequency, 520 + 520 * drift(T, 0.07, 0.19, ph + 3), 1.5);
      // Texture : une bande d'air plus claire qui suit ses propres rafales et se promène lentement de gauche à droite.
      this.set(l.ga.gain, windLevel * 0.5 * drift(T, 0.37, 0.83, ph + 13) ** 1.5, 0.6);
      this.set(l.air.frequency, 900 + 1500 * wind * drift(T, 0.13, 0.31, ph + 14), 1.2);
      if (l.pan) this.set(l.pan.pan, 1.2 * (drift(T, 0.11, 0.26, ph + 15) - 0.5), 1.5);
    }
    // Pluie : un fond de souffle et un grain de gouttes, deux boucles de longueurs différentes.
    if (this.layer('rain', mood.rain > 0, now)) {
      const l = this.rain!, swell = 0.8 + 0.4 * drift(T, 0.11, 0.27, ph + 4);
      this.set(l.g.gain, mood.rain * 0.085 * swell, 1.2);
      this.set(l.gp.gain, mood.rain * 0.5 * (0.75 + 0.5 * drift(T, 0.19, 0.37, ph + 5)), 1.2);
      this.set(l.lp.frequency, 4200 + 3200 * mood.rain, 1.5);
    }
    // Fond tonal : ré + une quinte mobile + un grave, chacun respire à son rythme.
    const padLevel = Math.min(0.6, mood.pad + 0.2 * night);
    if (this.layer('pad', padLevel > 0, now)) {
      const l = this.pad!;
      [0.05, 0.035, 0.05].forEach((g, i) => this.set(l.gains[i].gain, padLevel * g * (0.35 + 0.65 * drift(T, 0.05 + 0.021 * i, 0.117 + 0.03 * i, ph + 6 + i)), 2));
      if (this.nextShift === 0) this.nextShift = now + 30 + 40 * this.rig.rand();
      if (now >= this.nextShift) {
        l.mobile.frequency.setTargetAtTime(FIFTHS[Math.floor(this.rig.rand() * FIFTHS.length)], now, 2.5);
        this.nextShift = now + 30 + 40 * this.rig.rand();
      }
    }

    // Pas : cadence liée à la vitesse, un peu ralentie par la charge, jamais parfaitement régulière.
    if (inp.moving && inp.speedMps > 0.3) {
      const hz = Math.max(1.5, Math.min(3.1, 1.5 + 0.34 * inp.speedMps)) * (1 - 0.12 * inp.load);
      if (this.nextStep < now) this.nextStep = now + 0.04;
      while (this.nextStep < horizon) {
        this.foot = -this.foot;
        // Un pas à gauche, un pas à droite, jamais tout à fait au même endroit.
        play(this.rig, 'step', this.nextStep, inp.load, mood.rain, this.foot * (0.14 + 0.1 * this.rig.rand()));
        this.nextStep += (1 / hz) * (0.94 + 0.12 * this.rig.rand());
      }
    } else this.nextStep = 0;

    // Battement d'alerte : dès que la charge penche trop, de plus en plus pressé, du côté où elle penche.
    const lean = Math.abs(inp.balance);
    if (lean > 0.6) {
      const urgency = clamp01((lean - 0.6) / 0.4);
      if (this.nextPulse < now) this.nextPulse = now + 0.05;
      while (this.nextPulse < horizon) {
        play(this.rig, 'pulse', this.nextPulse, urgency, 0, Math.sign(inp.balance) * 0.45);
        this.nextPulse += 1.0 - 0.45 * urgency;
      }
    } else this.nextPulse = 0;

    // Tonnerre lointain, de temps en temps, seulement par orage.
    if (w.kind === 'orage') {
      if (this.nextThunder === 0) this.nextThunder = now + 3 + 7 * this.rig.rand();
      if (this.nextThunder < horizon) {
        play(this.rig, 'thunder', Math.max(now + 0.02, this.nextThunder), this.rig.rand() ** 1.5, 0, this.rig.rand() * 1.4 - 0.7);
        this.nextThunder = now + 14 + 26 * this.rig.rand();
      }
    } else this.nextThunder = 0;

    // Notes éparses de la nuit (pas pendant l'orage, qui occupe déjà l'espace).
    if (w.night && w.kind !== 'orage') {
      if (this.nextNote === 0) this.nextNote = now + 4 + 6 * this.rig.rand();
      if (this.nextNote < horizon) {
        const at = Math.max(now + 0.02, this.nextNote), pan = this.rig.rand() - 0.5;
        play(this.rig, 'nightNote', at, this.rig.rand(), 0, pan);
        if (this.rig.rand() < 0.35) play(this.rig, 'nightNote', at + 0.5 + 0.4 * this.rig.rand(), this.rig.rand(), 0, -pan);
        this.nextNote = now + 9 + 15 * this.rig.rand();
      }
    } else this.nextNote = 0;
  }

  /** Éteint la nappe en fondu et libère tous ses nœuds. Elle se reconstruira au prochain update(). */
  stop(): void {
    const bus = this.bus;
    if (!bus) return;
    const now = this.rig.ctx.currentTime;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setTargetAtTime(0, now, 0.06);
    for (const l of [this.fond, this.wind, this.rain, this.pad]) if (l) for (const s of l.sources) s.stop(now + 0.5);
    // Le bus se débranche tout seul quand la dernière source s'arrête ; à défaut, il ne porte plus aucun signal.
    const first = [this.fond, this.wind, this.rain, this.pad].find(l => l)?.sources[0];
    if (first) first.onended = () => bus.disconnect(); else bus.disconnect();
    this.bus = null; this.veil = null; this.fond = null; this.wind = null; this.rain = null; this.pad = null;
    this.last = new WeakMap();
    this.lastUpdate = -1;
    this.nextStep = this.nextPulse = this.nextThunder = this.nextNote = this.nextShift = 0;
  }

  private ensureBus(now: number): void {
    if (this.bus) return;
    const { ctx } = this.rig;
    this.veil = ctx.createBiquadFilter();
    this.veil.type = 'lowpass'; this.veil.frequency.value = 3000; this.veil.Q.value = 0.4;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.gain.setValueAtTime(0, now);
    this.veil.connect(this.bus); this.bus.connect(this.rig.amb);
  }

  /** Change un paramètre en fondu, seulement si la cible a bougé de façon sensible. */
  private set(p: AudioParam, value: number, tau: number): void {
    const prev = this.last.get(p);
    if (prev !== undefined && Math.abs(value - prev) <= Math.abs(prev) * 0.02 + 1e-5) return;
    this.last.set(p, value);
    p.setTargetAtTime(value, this.rig.ctx.currentTime, tau);
  }

  /** Crée la couche si elle est voulue, la détruit après 4 s de silence. Renvoie vrai si elle existe. */
  private layer(name: 'fond' | 'wind' | 'rain' | 'pad', wanted: boolean, now: number): boolean {
    let l: Layer | null = this[name];
    if (wanted) {
      if (!l) l = name === 'fond' ? (this.fond = this.makeFond(now)) : name === 'wind' ? (this.wind = this.makeWind(now)) : name === 'rain' ? (this.rain = this.makeRain(now)) : (this.pad = this.makePad(now));
      l.idleSince = null;
      return true;
    }
    if (!l) return false;
    if (l.idleSince === null) {
      l.idleSince = now;
      for (const n of l.nodes) if ('gain' in n) this.set((n as GainNode).gain, 0, 0.7);
    } else if (now - l.idleSince > 4) {
      for (const s of l.sources) { s.stop(now); }
      for (const n of l.nodes) { n.disconnect(); if ('gain' in n) this.last.delete((n as GainNode).gain); }
      this[name] = null;
    }
    return false;
  }

  private loop(buffer: AudioBuffer, now: number, rate: number): AudioBufferSourceNode {
    const src = this.rig.ctx.createBufferSource();
    src.buffer = buffer; src.loop = true; src.playbackRate.value = rate;
    src.start(now, this.rig.rand() * (buffer.duration - 0.1));
    return src;
  }
  private silentGain(now: number): GainNode {
    const g = this.rig.ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, now);
    return g;
  }

  private panner(pan: number): StereoPannerNode | null {
    const { ctx } = this.rig;
    if (typeof ctx.createStereoPanner !== 'function') return null;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    return p;
  }

  private makeFond(now: number): FondLayer {
    const { ctx } = this.rig, sources: AudioScheduledSourceNode[] = [], bands: BiquadFilterNode[] = [], gains: GainNode[] = [];
    // Deux lectures du même bruit à des vitesses différentes, une de chaque côté : une matière large, sans motif.
    [0.61, 0.47].forEach((rate, i) => {
      const src = this.loop(this.rig.noise, now, rate), bp = ctx.createBiquadFilter(), g = this.silentGain(now), p = this.panner(i ? 0.55 : -0.55);
      bp.type = 'bandpass'; bp.frequency.value = 390 * (1 + 0.32 * i); bp.Q.value = 0.8;
      src.connect(bp); bp.connect(g);
      if (p) { g.connect(p); p.connect(this.veil!); } else g.connect(this.veil!);
      sources.push(src); bands.push(bp); gains.push(g);
    });
    return { sources, nodes: gains, idleSince: null, bands, gains };
  }

  private makeWind(now: number): WindLayer {
    const { ctx } = this.rig, src = this.loop(this.rig.noise, now, 0.83);
    const lp = ctx.createBiquadFilter(), bp = ctx.createBiquadFilter(), air = ctx.createBiquadFilter();
    const g = this.silentGain(now), gw = this.silentGain(now), ga = this.silentGain(now), pan = this.panner(0);
    lp.type = 'lowpass'; lp.frequency.value = 300; lp.Q.value = 0.6;
    bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 7;
    air.type = 'bandpass'; air.frequency.value = 1200; air.Q.value = 1.1;
    src.connect(lp); lp.connect(g); g.connect(this.veil!);
    src.connect(bp); bp.connect(gw); gw.connect(this.veil!);
    src.connect(air); air.connect(ga);
    if (pan) { ga.connect(pan); pan.connect(this.veil!); } else ga.connect(this.veil!);
    return { sources: [src], nodes: [g, gw, ga], idleSince: null, lp, g, bp, gw, air, ga, pan };
  }

  private makeRain(now: number): RainLayer {
    const { ctx } = this.rig;
    this.patter ??= makePatter(ctx, this.rig.rand);
    const bed = this.loop(this.rig.noise, now, 1.07), drops = this.loop(this.patter, now, 1);
    const hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), g = this.silentGain(now), gp = this.silentGain(now);
    hp.type = 'highpass'; hp.frequency.value = 600; hp.Q.value = 0.5;
    lp.type = 'lowpass'; lp.frequency.value = 5000; lp.Q.value = 0.4;
    bed.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.veil!);
    drops.connect(gp); gp.connect(this.veil!);
    return { sources: [bed, drops], nodes: [g, gp], idleSince: null, lp, g, gp };
  }

  private makePad(now: number): PadLayer {
    const { ctx } = this.rig;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.4;
    lp.connect(this.veil!);
    const specs: Array<[number, OscillatorType]> = [[146.83, 'sine'], [FIFTHS[0], 'sine'], [73.42, 'triangle']];
    const oscs: OscillatorNode[] = [], gains: GainNode[] = [];
    for (const [f, type] of specs) {
      const o = ctx.createOscillator(), g = this.silentGain(now);
      o.type = type; o.frequency.value = f;
      o.connect(g); g.connect(lp); o.start(now);
      oscs.push(o); gains.push(g);
    }
    return { sources: oscs, nodes: gains, idleSince: null, gains, mobile: oscs[1] };
  }
}

/** Grain de pluie, en stéréo : des centaines de gouttes brèves placées au hasard dans l'espace, fines et aiguës pour la
 *  plupart, quelques-unes plus lourdes et plus graves (sur une bâche, une tôle). Bouclable sans couture. */
function makePatter(ctx: BaseAudioContext, rand: () => number): AudioBuffer {
  const sr = ctx.sampleRate, len = Math.floor(sr * PATTER_S), buf = ctx.createBuffer(2, len, sr);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const drops = Math.floor(PATTER_S * 60);
  for (let k = 0; k < drops; k++) {
    const heavy = rand() < 0.12;
    const at = Math.floor(rand() * len), f = heavy ? 500 + 700 * rand() : 1500 + 3800 * rand();
    const tau = sr * (heavy ? 0.006 + 0.01 * rand() : 0.002 + 0.006 * rand()), amp = (heavy ? 0.12 : 0.04) + 0.3 * rand() ** 3;
    const n = Math.floor(tau * 6), ph = rand() * 6.28, pan = rand(), gl = Math.cos(pan * 1.5708), gr = Math.sin(pan * 1.5708);
    for (let i = 0; i < n; i++) {
      const rise = Math.min(1, i / (sr * 0.0006));
      const x = amp * rise * Math.exp(-i / tau) * Math.sin(ph + (6.2832 * f * (1 - (heavy ? 0.15 * i / n : 0)) * i) / sr);
      L[(at + i) % len] += x * gl * 1.3; R[(at + i) % len] += x * gr * 1.3;
    }
  }
  return buf;
}
