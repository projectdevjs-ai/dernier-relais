// Nappe musicale générative, très discrète, propre à chaque scène : un bourdon de ré qui respire et quelques
// notes lentes en ré mineur pentatonique, tirées par une marche au hasard. Rien n'est enregistré ni bouclé :
// les niveaux dérivent sur des périodes sans rapport entre elles et les notes ne reviennent jamais dans le même ordre.
// La musique ne tourne que si on l'entretient : tick() programme la seconde à venir, et stop() libère tous les nœuds.
import { type Rig, tone } from './rig';
import { n } from './sounds';

export type MusicScene = 'labo' | 'prologue' | 'carte';

interface SceneDef {
  /** Bourdon : fréquence, forme d'onde, niveau, position. */
  drone: Array<[number, OscillatorType, number, number]>;
  /** Passe-bas du bourdon (Hz). */
  lp: number;
  /** Degrés de la gamme autorisés (0 = ré4). */
  degrees: number[];
  /** Intervalle entre deux notes (s) : minimum, maximum. */
  every: [number, number];
  noteGain: number;
  /** Durée d'une note (s) et longueur de son attaque. */
  noteDur: number;
  attack: number;
  /** Chance qu'une seconde note réponde à la première. */
  answer: number;
  level: number;
}

const D2 = 73.416, D3 = 146.83, A3 = 220;
export const MUSIC: Record<MusicScene, SceneDef> = {
  // Labo : un atelier qui ronronne. Bourdon ré-la, notes médium régulières, parfois une réponse.
  labo: { drone: [[D3, 'triangle', 0.05, -0.3], [A3, 'sine', 0.035, 0.3], [D2, 'sawtooth', 0.02, 0]], lp: 500, degrees: [0, 1, 2, 3, 5, 6], every: [2.6, 5], noteGain: 0.055, noteDur: 2.6, attack: 0.06, answer: 0.35, level: 0.7 },
  // Prologue : plus sombre et plus lent. Bourdon grave, notes basses et longues.
  prologue: { drone: [[D2, 'sawtooth', 0.035, 0], [D3, 'triangle', 0.045, -0.25], [A3 * 0.5, 'sine', 0.04, 0.25]], lp: 380, degrees: [-5, -3, -2, 0, 1, 3], every: [3.8, 7], noteGain: 0.06, noteDur: 3.4, attack: 0.25, answer: 0.2, level: 0.62 },
  // Carte : presque rien, pour ne pas couvrir la nappe d'ambiance. Bourdon ténu, notes hautes et rares.
  carte: { drone: [[D3, 'sine', 0.03, -0.2], [A3, 'sine', 0.02, 0.2]], lp: 600, degrees: [3, 4, 5, 6, 8, 10], every: [5, 10], noteGain: 0.04, noteDur: 3, attack: 0.12, answer: 0.25, level: 0.55 },
};

interface Bed { bus: GainNode; oscs: OscillatorNode[]; gains: GainNode[] }

export class Music {
  private bed: Bed | null = null;
  private scene: MusicScene | null = null;
  private nextNote = 0;
  private step = 0;
  private phase: number;

  constructor(private readonly rig: Rig) { this.phase = rig.rand() * 6.28; }

  /** Scène en cours de lecture, ou null. */
  get playing(): MusicScene | null { return this.scene; }

  /** Lance la nappe d'une scène (en fondu ; l'ancienne s'éteint en même temps) ou arrête tout (`null`). */
  set(scene: MusicScene | null): void {
    if (scene === this.scene) return;
    this.stop(1.2);
    if (!scene || !MUSIC[scene]) return;
    const { ctx } = this.rig, now = ctx.currentTime, def = MUSIC[scene];
    const bus = ctx.createGain(), lp = ctx.createBiquadFilter();
    bus.gain.value = 0;
    bus.gain.setValueAtTime(0, now);
    bus.gain.setTargetAtTime(def.level, now, 1.2);
    lp.type = 'lowpass'; lp.frequency.value = def.lp; lp.Q.value = 0.4;
    lp.connect(bus); bus.connect(this.rig.amb);
    // Un peu du bourdon part dans la grande réverbération : il flotte au lieu de sortir du haut-parleur.
    const send = ctx.createGain();
    send.gain.value = 0.35;
    bus.connect(send); send.connect(this.rig.far);
    const oscs: OscillatorNode[] = [], gains: GainNode[] = [];
    for (const [f, type, , pan] of def.drone) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = f * (1 + (this.rig.rand() - 0.5) * 0.003);
      g.gain.value = 0;
      g.gain.setValueAtTime(0, now);
      o.connect(g);
      if (pan && typeof ctx.createStereoPanner === 'function') { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(lp); } else g.connect(lp);
      o.start(now);
      oscs.push(o); gains.push(g);
    }
    this.bed = { bus, oscs, gains };
    this.scene = scene;
    this.step = Math.floor(this.rig.rand() * def.degrees.length);
    this.nextNote = now + 1.2 + 1.5 * this.rig.rand();
    this.tick();
  }

  /** Fait respirer le bourdon et programme les notes de la seconde à venir. À appeler environ deux fois par seconde. */
  tick(): void {
    const bed = this.bed, scene = this.scene;
    if (!bed || !scene) return;
    const def = MUSIC[scene], { ctx } = this.rig, now = ctx.currentTime, r = this.rig.rand;
    def.drone.forEach(([, , level], i) => {
      const breath = 0.45 + 0.35 * Math.sin((0.071 + 0.023 * i) * now + this.phase + i * 2.1) + 0.2 * Math.sin((0.173 + 0.041 * i) * now + this.phase * 1.7 + i);
      bed.gains[i].gain.setTargetAtTime(level * breath, now, 1.5);
    });
    const horizon = now + 1.3;
    while (this.nextNote < horizon) {
      const at = Math.max(now + 0.02, this.nextNote);
      // Marche au hasard sur la gamme : de petits pas, rarement un saut ; un silence de temps en temps.
      const move = [-2, -1, -1, 1, 1, 2][Math.floor(r() * 6)];
      this.step = Math.max(0, Math.min(def.degrees.length - 1, this.step + move));
      if (r() > 0.15) {
        const pan = (r() - 0.5) * 0.9, d = def.degrees[this.step];
        this.note(def, d, at, 1, pan);
        if (r() < def.answer) this.note(def, def.degrees[Math.min(def.degrees.length - 1, this.step + 2)], at + 0.7 + 0.6 * r(), 0.6, -pan);
      }
      this.nextNote = at + def.every[0] + (def.every[1] - def.every[0]) * r();
    }
  }

  private note(def: SceneDef, degree: number, t: number, level: number, pan: number): void {
    const r = this.rig.rand, dur = def.noteDur * (0.85 + 0.3 * r());
    tone(this.rig, {
      f: n(degree), t, dur, gain: def.noteGain * level * def.level * (0.8 + 0.4 * r()), attack: def.attack * (0.8 + 0.6 * r()), hold: dur * 0.1,
      fm: { ratio: 2, index: 0.2 + 0.2 * r(), decay: 0.5 }, lp: 2200, send: 0.2, far: 0.7, pan, panTo: pan * 0.4, prio: 0,
    });
  }

  /** Éteint la nappe en fondu et libère ses nœuds. Les notes déjà parties finissent de sonner. */
  stop(fade = 0.4): void {
    const bed = this.bed;
    this.bed = null; this.scene = null; this.nextNote = 0;
    if (!bed) return;
    const now = this.rig.ctx.currentTime;
    bed.bus.gain.cancelScheduledValues(now);
    bed.bus.gain.setTargetAtTime(0, now, fade / 4);
    for (const o of bed.oscs) o.stop(now + fade * 1.5);
    bed.oscs[0].onended = () => bed.bus.disconnect();
  }
}
