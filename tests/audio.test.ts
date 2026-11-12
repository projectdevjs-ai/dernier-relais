// Essais du son avec un faux AudioContext : on ne vérifie pas ce qu'on entend (impossible ici), mais ce qui est
// programmé : sources créées, instants de départ et d'arrêt, gains, vibrations. Les mesures acoustiques
// (crête, RMS, clics) se font dans le navigateur, sur demo-audio.html.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractView, DeliveryResult, GameEvent, GameView, Grade, OrderView, WeatherKind } from '../src/game/api';
import { Ambience } from '../src/audio/ambience';
import { Audio, HAPTICS, HAPTIC_MAX_MS, MAX_VOICES, Sound, clampPattern } from '../src/audio/audio';
import { BLIP_VARIANTS, PERSONAS, VOWELS, blipPlan, personaKey, playBlip } from '../src/audio/blip';
import { MUSIC, Music } from '../src/audio/music';
import { Rig, seeded } from '../src/audio/rig';
import { SOUNDS, SOUND_NAMES, n, play } from '../src/audio/sounds';

// ---------- Faux contexte audio ----------

const finite = (...xs: number[]): void => { for (const x of xs) if (!Number.isFinite(x)) throw new TypeError(`valeur non finie : ${x}`); };
class Param {
  events: Array<{ kind: string; v: number; t: number }> = [];
  constructor(public value = 0) {}
  private push(kind: string, v: number, t: number): this { finite(v, t); if (t < 0) throw new RangeError('instant négatif'); this.events.push({ kind, v, t }); return this; }
  setValueAtTime(v: number, t: number): this { return this.push('set', v, t); }
  linearRampToValueAtTime(v: number, t: number): this { return this.push('lin', v, t); }
  // Comme le vrai : une rampe exponentielle vers 0 est interdite.
  exponentialRampToValueAtTime(v: number, t: number): this { if (v === 0) throw new RangeError('rampe exponentielle vers 0'); return this.push('exp', v, t); }
  setTargetAtTime(v: number, t: number, tau: number): this { finite(tau); return this.push('target', v, t); }
  cancelScheduledValues(t: number): this { finite(t); this.events = this.events.filter(e => e.t < t); return this; }
  /** Dernière valeur visée. */
  get goal(): number { return this.events.length ? this.events[this.events.length - 1].v : this.value; }
}
class Node {
  outs: Node[] = [];
  constructor(readonly ctx: FakeContext, readonly kind: string) {}
  connect(to: Node | Param): Node | Param { if (to instanceof Node) this.outs.push(to); return to; }
  disconnect(): void { this.outs = []; }
}
class Source extends Node {
  startAt: number | null = null;
  stopAt: number | null = null;
  loop = false;
  buffer: unknown = null;
  type = 'sine';
  onended: (() => void) | null = null;
  frequency = new Param(440);
  detune = new Param(0);
  playbackRate = new Param(1);
  start(t = 0, offset = 0): void { finite(t, offset); if (this.startAt !== null) throw new Error('source déjà démarrée'); this.startAt = t; this.ctx.sources.push(this); }
  stop(t = 0): void { finite(t); if (this.startAt === null) throw new Error('arrêt avant démarrage'); this.stopAt = t; }
}
class FakeContext {
  static made: FakeContext[] = [];
  currentTime = 0;
  sampleRate = 8000;
  state: 'running' | 'suspended' | 'closed' = 'suspended';
  destination = new Node(this, 'destination');
  sources: Source[] = [];
  gains: Array<Node & { gain: Param }> = [];
  constructor() { FakeContext.made.push(this); }
  createGain(): Node { const g = Object.assign(new Node(this, 'gain'), { gain: new Param(1) }); this.gains.push(g); return g; }
  createOscillator(): Source { return new Source(this, 'osc'); }
  createBufferSource(): Source { return new Source(this, 'buffer'); }
  createBiquadFilter(): Node { return Object.assign(new Node(this, 'filter'), { type: 'lowpass', frequency: new Param(350), Q: new Param(1), gain: undefined }); }
  createConvolver(): Node { return Object.assign(new Node(this, 'convolver'), { buffer: null, normalize: true }); }
  createDynamicsCompressor(): Node { return Object.assign(new Node(this, 'comp'), { threshold: new Param(-24), knee: new Param(30), ratio: new Param(12), attack: new Param(0.003), release: new Param(0.25) }); }
  createWaveShaper(): Node { return Object.assign(new Node(this, 'shaper'), { curve: null, oversample: 'none' }); }
  createStereoPanner(): Node { return Object.assign(new Node(this, 'pan'), { pan: new Param(0) }); }
  createBuffer(channels: number, length: number, sampleRate: number): unknown {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (c: number) => data[c] };
  }
  resume(): Promise<void> { this.state = 'running'; return Promise.resolve(); }
  suspend(): Promise<void> { this.state = 'suspended'; return Promise.resolve(); }
  /** Plus grand nombre de sources ponctuelles qui sonnent en même temps. */
  maxOverlap(): number {
    const live = this.sources.filter(s => s.stopAt !== null);
    let peak = 0;
    for (const a of live) peak = Math.max(peak, live.filter(b => b.startAt! <= a.startAt! && b.stopAt! > a.startAt!).length);
    return peak;
  }
}
const fakeRig = (): { ctx: FakeContext; rig: Rig } => {
  const ctx = new FakeContext();
  return { ctx, rig: new Rig(ctx as unknown as BaseAudioContext) };
};

// ---------- Faux état de jeu ----------

const order: OrderView = {
  id: 'c1', name: 'Médicaments', crate: 'alu', weightKg: 6, fragile: false, at: [0, 0], destId: 'a1', destName: 'Mairie', destAt: [0, 0],
  state: 'révélé', condition: 1, minutesLeft: null, reward: 100, distanceM: 5, inRange: true,
};
const result = (grade: Grade, over: Partial<DeliveryResult> = {}): DeliveryResult => ({
  orderId: 'c1', orderName: 'Médicaments', shelterId: 'a1', shelterName: 'Mairie', npc: 'mara', grade, condition: 1, onTime: true,
  points: 100, xp: 50, notes: [], starsBefore: 1, starsAfter: 1, unlock: null, levelUp: false, ...over,
});
const contract: ContractView = { id: 'k1', period: 'jour', label: 'Trois livraisons', progress: 3, goal: 3, reward: 200, done: true, claimed: false };
const KNOWN: GameEvent[] = [
  { type: 'scan', found: 2 }, { type: 'scan', found: 0 },
  { type: 'pickup', order }, { type: 'drop', orderId: 'c1' },
  ...(['E', 'D', 'C', 'B', 'A', 'S'] as Grade[]).map((g): GameEvent => ({ type: 'delivery', result: result(g) })),
  { type: 'levelUp', level: 3 }, { type: 'contract', contract },
  { type: 'danger', entered: true }, { type: 'danger', entered: false },
  { type: 'toast', text: 'a' }, { type: 'toast', text: 'a', tone: 'info' }, { type: 'toast', text: 'a', tone: 'good' }, { type: 'toast', text: 'a', tone: 'warn' },
];
const view = (over: { kind?: WeatherKind; wind?: number; night?: boolean; speed?: number; load?: number; balance?: number } = {}): GameView => ({
  player: { speedMps: over.speed ?? 0, moving: (over.speed ?? 0) > 0.3, carriedKg: (over.load ?? 0) * 30, capacityKg: 30, balance: over.balance ?? 0 },
  weather: { kind: over.kind ?? 'clair', windKmh: over.wind ?? 10, tempC: 12, night: over.night ?? false, sunAltDeg: 30 },
} as unknown as GameView);

let vibrate: ReturnType<typeof vi.fn>;
beforeEach(() => {
  FakeContext.made = [];
  vibrate = vi.fn(() => true);
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('navigator', { vibrate });
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

/** Un son débloqué, avec son faux contexte. */
const unlocked = (opts?: ConstructorParameters<typeof Sound>[0]): { s: Sound; ctx: FakeContext } => {
  const s = new Sound(opts);
  s.unlock();
  return { s, ctx: FakeContext.made[FakeContext.made.length - 1] };
};
/** Avance l'horloge du faux contexte (les sons programmés sont alors terminés). */
const later = (ctx: FakeContext, s = 5): void => { ctx.currentTime += s; };

describe('son : avant le premier geste', () => {
  it('ne crée rien et ne lève rien tant que unlock() n\'a pas été appelé', () => {
    const s = new Sound();
    expect(() => {
      for (const e of KNOWN) s.handle(e);
      s.ambient(view({ kind: 'orage', speed: 2, balance: 0.9 }));
      for (const k of ['tap', 'open', 'close', 'error', 'confirm'] as const) s.ui(k);
      s.setVolume(0.5); s.setMuted(true); s.setMuted(false); s.setHaptics(false); s.setHaptics(true); s.suspend(); s.resume();
    }).not.toThrow();
    expect(FakeContext.made).toHaveLength(0);
    expect(vibrate.mock.calls.filter(c => c[0] !== 0)).toHaveLength(0);
    expect(s.ready).toBe(false);
  });
  it('crée le contexte au premier unlock() seulement, et le réveille', () => {
    const { s, ctx } = unlocked();
    s.unlock(); s.unlock();
    expect(FakeContext.made).toHaveLength(1);
    expect(ctx).toBe(FakeContext.made[0]);
    expect(ctx.state).toBe('running');
    expect(s.ready).toBe(true);
  });
  it('reste muet sans erreur sur un appareil sans AudioContext', () => {
    vi.stubGlobal('AudioContext', undefined);
    const s = new Sound();
    expect(() => { s.unlock(); s.handle(KNOWN[0]); s.ambient(view()); s.ui('tap'); s.setVolume(1); s.suspend(); s.resume(); }).not.toThrow();
    expect(s.ready).toBe(false);
  });
  it('exporte la même classe sous le nom Audio', () => { expect(Audio).toBe(Sound); });
});

describe('son : événements du jeu', () => {
  it('programme au moins un son pour chaque événement connu', () => {
    for (const e of KNOWN) {
      const { s, ctx } = unlocked();
      s.handle(e);
      expect(ctx.sources.length, JSON.stringify(e).slice(0, 60)).toBeGreaterThan(0);
      for (const src of ctx.sources) { expect(src.stopAt).not.toBeNull(); expect(src.stopAt!).toBeGreaterThan(src.startAt!); }
    }
  });
  it('donne un son discret à chaque événement des systèmes secondaires, plus bas que les sons principaux', () => {
    const jam = { id: 'l', shelterId: 'a1', shelterName: 'Mairie', at: [0, 0] as [number, number], state: 'en cours' as const, count: 3, delivered: 0, minutes: 12, minutesLeft: 12, bonus: 60, distanceM: 0, inRange: true };
    const EXTRA: [GameEvent, string][] = [
      [{ type: 'special', order }, 'special'],
      [{ type: 'cache', cacheId: 'k', points: 40, xp: 20, skillPoint: false }, 'cacheOpen'],
      [{ type: 'cache', cacheId: 'k', points: 40, xp: 20, skillPoint: true }, 'cacheOpen'],
      [{ type: 'wanderer', id: 'w', name: 'Lou', line: '…', gift: 'xp' }, 'wanderer'],
      [{ type: 'front', phase: 'approche', etaS: 120 }, 'frontNear'], [{ type: 'front', phase: 'entrée' }, 'frontIn'], [{ type: 'front', phase: 'sortie' }, 'frontOut'],
      [{ type: 'jam', phase: 'début', jam }, 'jamStart'], [{ type: 'jam', phase: 'réussi', jam, bonus: 60 }, 'jamWon'], [{ type: 'jam', phase: 'raté', jam }, 'jamLost'],
      [{ type: 'inspect', order, xp: 5 }, 'inspect'],
      [{ type: 'strap', orderId: 'c1', quality: 0.8, xp: 5 }, 'strap'], [{ type: 'strap', orderId: 'c1', quality: 0.1, xp: 0 }, 'strap'],
      [{ type: 'proof', orderId: 'c1', points: 12 }, 'proof'],
    ];
    for (const [e, name] of EXTRA) {
      const { s, ctx } = unlocked();
      expect(() => s.handle(e)).not.toThrow();
      expect(ctx.sources.length, name).toBeGreaterThan(0);
      for (const src of ctx.sources) { expect(src.stopAt).not.toBeNull(); expect(src.stopAt!).toBeGreaterThan(src.startAt!); }
      const def = SOUNDS[name as keyof typeof SOUNDS];
      expect(def.family).toBe('jeu');
      // Discrets : pas plus longs ni plus prioritaires qu'une livraison notée S.
      expect(def.dur).toBeLessThanOrEqual(SOUNDS.deliveryS.dur); expect(def.prio).toBeLessThanOrEqual(SOUNDS.deliveryS.prio);
    }
    // Les vibrations restent courtes.
    for (const k of ['special', 'cache', 'strap'] as const) expect(HAPTICS[k].reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(200);
  });
  it('ignore un événement inconnu', () => {
    const { s, ctx } = unlocked();
    expect(() => {
      s.handle({ type: 'rôdeur', near: true } as unknown as GameEvent);
      s.handle({ type: 'météore' } as unknown as GameEvent);
      // Événements des systèmes secondaires mal formés (champs manquants) : ignorés eux aussi.
      for (const type of ['special', 'cache', 'wanderer', 'front', 'jam', 'inspect', 'strap', 'proof']) s.handle({ type } as unknown as GameEvent);
      s.handle({ type: 'front', phase: 'inconnue' } as unknown as GameEvent);
      s.handle({ type: 'jam', phase: 'inconnue' } as unknown as GameEvent);
      s.handle({} as unknown as GameEvent);
      s.ui('inconnu' as unknown as 'tap');
    }).not.toThrow();
    expect(ctx.sources).toHaveLength(0);
    expect(vibrate).not.toHaveBeenCalled();
  });
  it('donne un jingle différent à chaque note, plus riche quand la note monte', () => {
    const voices = (['E', 'D', 'C', 'B', 'A', 'S'] as Grade[]).map(g => {
      const { ctx, rig } = fakeRig();
      play(rig, `delivery${g}`, 0);
      return { n: rig.voices, sig: ctx.sources.map(s => `${s.kind}${s.frequency.events[0]?.v.toFixed(0)}@${s.startAt!.toFixed(2)}`).join(',') };
    });
    expect(new Set(voices.map(v => v.sig)).size).toBe(6);
    expect(voices[5].n).toBeGreaterThan(voices[2].n);
    expect(voices[2].n).toBeGreaterThanOrEqual(voices[0].n);
  });
  it('ajoute une touche pour une étoile et pour un niveau, sans rejouer le niveau juste après', () => {
    const count = (r: DeliveryResult, extra: GameEvent[] = []): number => {
      const { s, ctx } = unlocked();
      s.handle({ type: 'delivery', result: r });
      for (const e of extra) s.handle(e);
      return ctx.sources.length;
    };
    const plain = count(result('B')), star = count(result('B', { starsAfter: 2 })), level = count(result('B', { levelUp: true }));
    expect(star).toBeGreaterThan(plain);
    expect(level).toBeGreaterThan(plain);
    expect(count(result('B', { levelUp: true }), [{ type: 'levelUp', level: 2 }])).toBe(level);
  });
  it('distingue le scan vide du scan réussi', () => {
    const a = unlocked(), b = unlocked();
    a.s.handle({ type: 'scan', found: 3 }); b.s.handle({ type: 'scan', found: 0 });
    expect(a.ctx.sources.length).toBeGreaterThan(b.ctx.sources.length);
  });
  it('met les phrases musicales à la suite au lieu de les empiler, et abandonne au-delà de la file', () => {
    const { s, ctx } = unlocked();
    for (let i = 0; i < 8; i++) s.handle({ type: 'delivery', result: result('C') });
    const starts = [...new Set(ctx.sources.map(x => x.startAt!.toFixed(2)))].map(Number).sort((x, y) => x - y);
    expect(starts[starts.length - 1]).toBeGreaterThan(1);
    expect(starts[starts.length - 1]).toBeLessThan(4);
  });
});

describe('son : limite de voix', () => {
  it('ne dépasse jamais MAX_VOICES voix simultanées, même en rafale', () => {
    const { s, ctx } = unlocked();
    for (let round = 0; round < 6; round++) {
      for (const e of KNOWN) s.handle(e);
      for (const k of ['tap', 'open', 'close', 'error', 'confirm'] as const) s.ui(k);
      s.ambient(view({ kind: 'orage', night: true, speed: 3, load: 1, balance: 1, wind: 60 }));
      expect(s.peakVoices).toBeLessThanOrEqual(MAX_VOICES);
      ctx.currentTime += 0.07;
    }
    expect(s.peakVoices).toBe(MAX_VOICES);
    // Dans le faux contexte : une voix = au plus 2 oscillateurs (porteuse + modulateur).
    expect(ctx.maxOverlap()).toBeLessThanOrEqual(MAX_VOICES * 2);
  });
  it('refuse d\'abord les détails d\'ambiance, puis l\'interface, et garde la place des événements', () => {
    const { rig } = fakeRig();
    let ok = 0;
    for (let i = 0; i < 40; i++) if (rig.claim(0, 1, 0)) ok++;
    expect(ok).toBe(6);
    for (let i = 0; i < 40; i++) if (rig.claim(0, 1, 1)) ok++;
    expect(ok).toBe(12);
    for (let i = 0; i < 40; i++) if (rig.claim(0, 1, 2)) ok++;
    expect(ok).toBe(MAX_VOICES);
    expect(rig.claim(1.5, 2, 0)).toBe(true); // plus tard, la place est libre
  });
  it('libère les voix une fois les sons terminés', () => {
    const { s, ctx } = unlocked();
    s.handle({ type: 'delivery', result: result('S') });
    expect(s.voices).toBeGreaterThan(0);
    later(ctx);
    expect(s.voices).toBe(0);
  });
});

describe('son : volume, coupure, veille', () => {
  it('setMuted coupe tout : sortie à zéro, plus aucun son programmé, nappe arrêtée, contexte endormi', () => {
    const { s, ctx } = unlocked();
    s.ambient(view({ kind: 'pluie', wind: 30 }));
    const loops = ctx.sources.filter(x => x.loop && x.stopAt === null);
    expect(loops.length).toBeGreaterThan(0);
    s.setMuted(true);
    const out = ctx.gains.find(g => g.outs.includes(ctx.destination))!;
    expect(out.gain.goal).toBe(0);
    for (const l of loops) expect(l.stopAt).not.toBeNull();
    const before = ctx.sources.length;
    for (const e of KNOWN) s.handle(e);
    s.ui('tap'); s.ambient(view({ kind: 'orage', speed: 2, balance: 1 }));
    expect(ctx.sources.length).toBe(before);
    vi.advanceTimersByTime(500);
    expect(ctx.state).toBe('suspended');
    s.setMuted(false);
    expect(ctx.state).toBe('running');
    expect(out.gain.goal).toBeGreaterThan(0);
    s.handle(KNOWN[0]);
    expect(ctx.sources.length).toBeGreaterThan(before);
  });
  it('démarre coupé si on le demande', () => {
    const { s, ctx } = unlocked({ muted: true });
    s.handle(KNOWN[0]); s.ambient(view({ kind: 'pluie' }));
    expect(ctx.sources).toHaveLength(0);
  });
  it('un volume nul se comporte comme une coupure, et le volume ne dépasse jamais 1', () => {
    const { s, ctx } = unlocked();
    const out = ctx.gains.find(g => g.outs.includes(ctx.destination))!;
    s.setVolume(0); s.handle(KNOWN[0]); s.ambient(view({ kind: 'pluie' }));
    expect(ctx.sources).toHaveLength(0);
    s.setVolume(7);
    expect(out.gain.goal).toBe(1);
    s.setVolume(Number.NaN);
    expect(out.gain.goal).toBe(0);
  });
  it('suspend() arrête la nappe et endort le contexte, resume() le réveille', () => {
    const { s, ctx } = unlocked();
    s.ambient(view({ kind: 'pluie' }));
    s.suspend();
    expect(ctx.sources.filter(x => x.loop && x.stopAt === null)).toHaveLength(0);
    vi.advanceTimersByTime(500);
    expect(ctx.state).toBe('suspended');
    const before = ctx.sources.length;
    s.ambient(view({ kind: 'pluie', speed: 2 })); s.handle(KNOWN[0]);
    expect(ctx.sources.length).toBe(before);
    s.resume();
    expect(ctx.state).toBe('running');
    s.ambient(view({ kind: 'pluie' }));
    expect(ctx.sources.length).toBeGreaterThan(before);
  });
  it('un aller-retour rapide en arrière-plan n\'endort pas le contexte', () => {
    const { s, ctx } = unlocked();
    s.suspend(); s.resume();
    vi.advanceTimersByTime(1000);
    expect(ctx.state).toBe('running');
  });
});

describe('son : nappe d\'ambiance', () => {
  const oneShots = (ctx: FakeContext): number => ctx.sources.filter(x => x.stopAt !== null).length;
  const run = (v: GameView, seconds = 3): FakeContext => {
    const { s, ctx } = unlocked();
    for (let t = 0; t < seconds; t += 0.2) { s.ambient(v); ctx.currentTime += 0.2; }
    return ctx;
  };
  it('n\'ajoute que des boucles par temps clair à l\'arrêt, et aucune boucle de pluie', () => {
    const ctx = run(view({ kind: 'clair', wind: 10 }));
    expect(oneShots(ctx)).toBe(0);
    expect(ctx.sources.filter(x => x.loop)).toHaveLength(3); // le vent et les deux côtés du fond de l'air
  });
  it('ajoute la pluie quand il pleut, et un fond tonal la nuit', () => {
    expect(run(view({ kind: 'pluie' })).sources.filter(x => x.kind === 'buffer' && x.loop).length).toBe(5);
    expect(run(view({ kind: 'clair' })).sources.filter(x => x.kind === 'osc')).toHaveLength(0);
    expect(run(view({ kind: 'clair', night: true })).sources.filter(x => x.kind === 'osc' && x.stopAt === null)).toHaveLength(3);
  });
  it('règle le vent sur windKmh', () => {
    const level = (wind: number): number => {
      // Même graine à chaque fois : la rafale du moment est identique, seul le vent change.
      const ctx = new FakeContext(), rig = new Rig(ctx as unknown as BaseAudioContext, { rand: seeded(3) }), amb = new Ambience(rig);
      amb.update({ weather: { kind: 'nuages', windKmh: wind, tempC: 10, night: false, sunAltDeg: 30 }, speedMps: 0, moving: false, load: 0, balance: 0 });
      // Somme des niveaux visés par toutes les couches : le fond de l'air est le même dans les trois cas, seul le vent change.
      return ctx.gains.filter(g => !g.outs.includes(rig.amb as unknown as Node)).flatMap(g => g.gain.events.filter(e => e.kind === 'target').map(e => e.v)).reduce((a, b) => a + b, 0);
    };
    const calm = level(0);
    expect(level(60) - calm).toBeGreaterThan((level(20) - calm) * 3);
    expect(level(20)).toBeGreaterThan(level(2));
    expect(calm).toBeGreaterThan(0); // sans vent, il reste le fond de l'air : la nappe n'est jamais vide
  });
  it('cadence les pas sur la vitesse, et n\'en joue pas à l\'arrêt', () => {
    const steps = (speed: number): number => {
      const ctx = run(view({ speed }), 6);
      // un pas = un souffle grave (passe-bas) : on compte les départs distincts
      return new Set(ctx.sources.filter(x => x.stopAt !== null).map(x => x.startAt!.toFixed(3))).size;
    };
    const slow = steps(1), fast = steps(3);
    expect(steps(0)).toBe(0);
    expect(slow).toBeGreaterThan(8);
    expect(fast).toBeGreaterThan(slow * 1.3);
  });
  it('ne laisse pas de trou ni de paquet dans les pas quand le jeu appelle irrégulièrement', () => {
    const { s, ctx } = unlocked();
    for (const dt of [0.2, 0.2, 0.9, 0.05, 0.4, 0.2, 0.7, 0.2, 0.2, 0.2]) { s.ambient(view({ speed: 1.4 })); ctx.currentTime += dt; }
    const starts = [...new Set(ctx.sources.filter(x => x.stopAt !== null && x.kind === 'buffer').map(x => Number(x.startAt!.toFixed(2))))].sort((a, b) => a - b);
    const mains = starts.filter((t, i) => i === 0 || t - starts[i - 1] > 0.1);
    for (let i = 1; i < mains.length; i++) expect(mains[i] - mains[i - 1]).toBeLessThan(1.2);
  });
  it('fait battre l\'alerte au-delà de 0,6 d\'équilibre seulement', () => {
    expect(oneShots(run(view({ balance: 0.5 })))).toBe(0);
    expect(oneShots(run(view({ balance: 0.7 })))).toBeGreaterThan(2);
    expect(oneShots(run(view({ balance: -0.95 })))).toBeGreaterThan(oneShots(run(view({ balance: 0.7 }))));
  });
  it('fait tonner l\'orage de temps en temps, et sème quelques notes la nuit', () => {
    expect(oneShots(run(view({ kind: 'orage' }), 60))).toBeGreaterThanOrEqual(2);
    expect(oneShots(run(view({ kind: 'pluie' }), 60))).toBe(0);
    const night = oneShots(run(view({ kind: 'clair', night: true }), 60));
    expect(night).toBeGreaterThanOrEqual(4); // une note = porteuse + modulateur
    expect(night).toBeLessThan(40);
  });
  it('détruit une couche devenue inutile après quelques secondes', () => {
    const { s, ctx } = unlocked();
    for (let i = 0; i < 5; i++) { s.ambient(view({ kind: 'pluie' })); ctx.currentTime += 0.2; }
    const rain = ctx.sources.filter(x => x.loop);
    expect(rain.filter(x => x.stopAt === null)).toHaveLength(5);
    for (let i = 0; i < 30; i++) { s.ambient(view({ kind: 'clair' })); ctx.currentTime += 0.2; }
    expect(rain.filter(x => x.stopAt === null)).toHaveLength(3);
  });
  it('accepte une météo inconnue et des valeurs aberrantes', () => {
    const { rig } = fakeRig(), amb = new Ambience(rig);
    expect(() => {
      amb.update({ weather: { kind: 'grêle' as WeatherKind, windKmh: 500, tempC: 0, night: true, sunAltDeg: 0 }, speedMps: 50, moving: true, load: 1, balance: 3 });
      amb.update({ weather: { kind: 'clair', windKmh: -5, tempC: 0, night: false, sunAltDeg: 0 }, speedMps: -1, moving: true, load: 0, balance: -3 });
      amb.stop(); amb.stop();
    }).not.toThrow();
  });
});

describe('son : catalogue', () => {
  it('chaque son se programme sans erreur dans un contexte quelconque', () => {
    for (const name of SOUND_NAMES) for (const v of [0, 0.5, 1]) {
      const { ctx, rig } = fakeRig();
      expect(() => play(rig, name, 0.1, v, v), name).not.toThrow();
      expect(ctx.sources.length, name).toBeGreaterThan(0);
      expect(rig.voices, name).toBeLessThanOrEqual(MAX_VOICES);
    }
  });
  it('aucun son ne dure plus de 2 s, sauf le tonnerre qui appartient à l\'ambiance', () => {
    for (const name of SOUND_NAMES) {
      const { ctx, rig } = fakeRig();
      play(rig, name, 0, 1, 1);
      const end = Math.max(...ctx.sources.map(s => s.stopAt!));
      if (name === 'thunder') { expect(SOUNDS[name].family).toBe('ambiance'); continue; }
      expect(SOUNDS[name].dur, name).toBeLessThanOrEqual(2);
      expect(end, name).toBeLessThan(SOUNDS[name].dur); // la durée réelle, queue de réverbération comprise, est mesurée dans le navigateur
    }
  });
  it('toutes les enveloppes partent de zéro et y reviennent', () => {
    for (const name of SOUND_NAMES) {
      const { ctx, rig } = fakeRig(), base = ctx.gains.length;
      play(rig, name, 0.1, 1, 1);
      const envs = ctx.gains.slice(base).filter(g => g.gain.events.length >= 3);
      expect(envs.length, name).toBeGreaterThan(0);
      for (const g of envs) {
        if (g.gain.events[0].kind !== 'set' || g.gain.events.some(e => e.kind === 'exp' && e.v > 1)) continue; // profondeur de modulation
        expect(g.gain.value, name).toBe(0);
        expect(g.gain.events[0].v, name).toBe(0);
        expect(g.gain.events[g.gain.events.length - 1].v, name).toBe(0);
      }
    }
  });
  it('joue dans la gamme de ré mineur pentatonique', () => {
    expect(n(0)).toBeCloseTo(293.66, 1);
    expect(n(3)).toBeCloseTo(440, 1);
    expect(n(5)).toBeCloseTo(587.33, 1);
    expect(n(-5)).toBeCloseTo(146.83, 1);
    expect(n(1) / n(0)).toBeCloseTo(2 ** (3 / 12), 5);
  });
});

describe('son : pas', () => {
  const stepGain = (v: number): number => {
    const ctx = new FakeContext(), rig = new Rig(ctx as unknown as BaseAudioContext, { rand: seeded(9) }), base = ctx.gains.length;
    play(rig, 'step', 0.1, v, 0);
    return Math.max(...ctx.gains.slice(base).flatMap(g => g.gain.events.map(e => e.v)));
  };
  it('sont plus discrets à vide que chargé, et bien plus bas que les sons du jeu', () => {
    expect(stepGain(0)).toBeLessThan(stepGain(1) * 0.85);
    expect(stepGain(1)).toBeLessThan(0.06);
  });
  it('varient d\'un pas à l\'autre et alternent gauche et droite', () => {
    const { s, ctx } = unlocked();
    for (let t = 0; t < 4; t += 0.2) { s.ambient(view({ speed: 1.4, load: 0.3 })); ctx.currentTime += 0.2; }
    const steps = ctx.sources.filter(x => x.kind === 'osc' && x.stopAt !== null);
    expect(steps.length).toBeGreaterThan(4);
    expect(new Set(steps.map(x => x.frequency.events[0].v.toFixed(1))).size).toBeGreaterThan(steps.length / 2);
    // Aucune attaque de moins de 10 ms dans un pas : pas de claquement.
    const envs = ctx.gains.filter(g => g.gain.events.length >= 3 && g.gain.events[0].kind === 'set' && g.gain.events[0].t > 0);
    for (const g of envs) expect(g.gain.events[1].t - g.gain.events[0].t).toBeGreaterThanOrEqual(0.0099);
  });
});

describe('son : interjections (blip)', () => {
  const oscs = (ctx: FakeContext): Source[] => ctx.sources.filter(x => x.kind === 'osc');
  it('ne fait rien avant unlock(), ni quand le son est coupé', () => {
    const s = new Sound();
    expect(() => s.blip('mara')).not.toThrow();
    expect(FakeContext.made).toHaveLength(0);
    const { s: m, ctx } = unlocked({ muted: true });
    m.blip('mara', 'content');
    expect(ctx.sources).toHaveLength(0);
  });
  it('donne à chaque personnage une voix à lui : hauteur, voyelle, durée entre 0,2 et 0,5 s', () => {
    const sig = new Set<string>();
    for (const who of Object.keys(PERSONAS)) for (const mood of ['neutre', 'content', 'grave'] as const) for (let v = 0; v < BLIP_VARIANTS; v++) {
      const plan = blipPlan(who, mood, v);
      expect(plan.dur, who).toBeGreaterThanOrEqual(0.2);
      expect(plan.dur, who).toBeLessThanOrEqual(0.5);
      expect(plan.f0, who).toBeGreaterThan(80); expect(plan.f0, who).toBeLessThan(300);
      if (mood === 'neutre' && v === 0) sig.add(`${plan.persona.f0}|${plan.persona.vowel}|${plan.persona.syllables.length}`);
    }
    expect(sig.size).toBe(Object.keys(PERSONAS).length);
    // Femmes plus haut que les hommes ; Tomas le plus grave ; voyelles conformes au caractère.
    expect(PERSONAS.tomas.f0).toBeLessThan(110);
    for (const f of ['mara', 'agathe', 'iris', 'selma']) for (const h of ['tomas', 'kenji', 'noe']) expect(PERSONAS[f].f0).toBeGreaterThan(PERSONAS[h].f0);
    expect([PERSONAS.mara.vowel, PERSONAS.tomas.vowel, PERSONAS.agathe.vowel, PERSONAS.kenji.vowel, PERSONAS.iris.vowel, PERSONAS.noe.vowel, PERSONAS.selma.vowel]).toEqual(['a', 'm', 'm', 'o', 'm', 'e', 'a']);
    expect(PERSONAS.agathe.syllables).toHaveLength(2);
    const ends = (who: string): number => { const c = PERSONAS[who].syllables[0].c; return c[c.length - 1] - c[0]; };
    expect(ends('mara')).toBeGreaterThan(0.1); expect(ends('iris')).toBeLessThan(-0.1);
    for (const v of Object.values(VOWELS)) expect(v.f[0]).toBeLessThan(v.f[1]);
  });
  it('prend la voix neutre pour un nom inconnu, et ignore la casse et les accents', () => {
    expect(personaKey('Noé')).toBe('noe'); expect(personaKey('MARA')).toBe('mara');
    expect(personaKey('rôdeur')).toBe(''); expect(personaKey('')).toBe(''); expect(personaKey(undefined as unknown as string)).toBe('');
    const { s, ctx } = unlocked();
    expect(() => { s.blip('un inconnu'); s.blip('rôdeur', 'humeur inconnue' as unknown as 'neutre'); }).not.toThrow();
    expect(oscs(ctx)).toHaveLength(2);
  });
  it('est une voix : source en dent de scie, trois formants, hauteur qui glisse, enveloppe de 0 à 0', () => {
    const { ctx, rig } = fakeRig(), gains = ctx.gains.length;
    const h = playBlip(rig, 'mara', 'neutre', 0, 0.5)!;
    expect(h.end).toBeGreaterThan(0.7); expect(h.end).toBeLessThan(1.05);
    const o = oscs(ctx);
    expect(o).toHaveLength(1);
    expect(o[0].type).toBe('sawtooth');
    const f = o[0].frequency.events.map(e => e.v);
    expect(f.length).toBeGreaterThanOrEqual(3);
    expect(f[f.length - 1]).toBeGreaterThan(f[0] * 1.1); // « ah » montant
    expect(ctx.sources.filter(x => x.kind === 'buffer')).toHaveLength(1); // le souffle
    for (const src of ctx.sources) { expect(src.startAt).toBe(0.5); expect(src.stopAt!).toBeGreaterThan(h.end); }
    const env = ctx.gains.slice(gains).filter(g => g.gain.events.length > 8)[0];
    expect(env.gain.value).toBe(0);
    expect(env.gain.events[0].v).toBe(0); expect(env.gain.events[env.gain.events.length - 1].v).toBe(0);
    expect(rig.voices).toBe(1);
  });
  it('infléchit le contour selon l\'humeur', () => {
    const last = (mood: 'neutre' | 'content' | 'grave'): number => {
      const ctx = new FakeContext(), rig = new Rig(ctx as unknown as BaseAudioContext, { rand: seeded(4) });
      playBlip(rig, 'iris', mood, 0, 0.1);
      const e = ctx.sources.find(x => x.kind === 'osc')!.frequency.events;
      return e[e.length - 1].v / e[0].v;
    };
    expect(last('content')).toBeGreaterThan(last('neutre'));
    expect(last('grave')).toBeLessThan(last('neutre'));
    expect(blipPlan('iris', 'content').f0).toBeGreaterThan(blipPlan('iris', 'grave').f0);
  });
  it('fait tourner deux ou trois variantes par personnage', () => {
    const { s, ctx } = unlocked();
    for (let i = 0; i < 4; i++) { s.blip('tomas'); later(ctx, 2); }
    const durs = oscs(ctx).map(o => (o.stopAt! - o.startAt!).toFixed(3));
    expect(new Set(durs.slice(0, 3)).size).toBe(BLIP_VARIANTS);
    expect(durs[3]).toBe(durs[0]);
    expect(BLIP_VARIANTS).toBeGreaterThanOrEqual(2);
  });
  it('ne superpose jamais deux interjections : la nouvelle coupe la précédente en fondu', () => {
    const { s, ctx } = unlocked();
    s.blip('kenji');
    const first = oscs(ctx)[0], planned = first.stopAt!;
    ctx.currentTime += 0.1;
    s.blip('mara');
    const second = oscs(ctx)[1];
    expect(first.stopAt!).toBeLessThan(planned);
    expect(first.stopAt!).toBeLessThanOrEqual(ctx.currentTime + 0.06);
    // Le fondu de la première (30 ms) est fini quand la seconde commence à sonner.
    expect(second.startAt!).toBeGreaterThanOrEqual(ctx.currentTime + 0.03);
    const fades = ctx.gains.filter(g => g.gain.events.length === 2 && g.gain.events[0].t === ctx.currentTime && g.gain.events[1].v === 0);
    expect(fades).toHaveLength(1);
    // Une interjection terminée n'est pas « coupée » : pas de retard pour la suivante.
    later(ctx, 3);
    s.blip('noe');
    expect(oscs(ctx)[2].startAt!).toBeLessThan(ctx.currentTime + 0.03);
  });
  it('compte pour une seule voix et respecte la limite', () => {
    const { rig } = fakeRig();
    for (let i = 0; i < 40; i++) rig.claim(0, 5, 2);
    expect(playBlip(rig, 'mara', 'neutre', 0, 0.1)).toBeNull();
  });
});

describe('son : jingles (cue)', () => {
  it('joue un jingle court et distinct pour chaque moment, à la suite des phrases en cours', () => {
    const sigs = new Set<string>();
    for (const c of ['chargement', 'depart', 'labo', 'passeur', 'chapitre'] as const) {
      const { s, ctx } = unlocked();
      s.cue(c);
      expect(ctx.sources.length, c).toBeGreaterThan(3);
      const end = Math.max(...ctx.sources.map(x => x.stopAt!));
      expect(end, c).toBeLessThanOrEqual(2.1);
      sigs.add(ctx.sources.map(x => `${x.kind}${x.startAt!.toFixed(2)}`).join(','));
      const before = Math.max(...ctx.sources.map(x => x.startAt!));
      s.cue(c);
      expect(Math.max(...ctx.sources.map(x => x.startAt!))).toBeGreaterThan(before + 0.5);
    }
    expect(sigs.size).toBe(5);
  });
  it('ignore un nom inconnu, et ne joue rien avant unlock() ni son coupé', () => {
    const s = new Sound();
    expect(() => s.cue('depart')).not.toThrow();
    expect(FakeContext.made).toHaveLength(0);
    const { s: u, ctx } = unlocked();
    expect(() => u.cue('inconnu' as unknown as 'depart')).not.toThrow();
    u.setMuted(true); u.cue('labo');
    expect(ctx.sources).toHaveLength(0);
  });
});

describe('son : musique générative (music)', () => {
  const drones = (ctx: FakeContext): Source[] => ctx.sources.filter(x => x.kind === 'osc' && x.stopAt === null);
  it('lance un bourdon et sème des notes lentes dans la gamme, sans motif répété', () => {
    const { s, ctx } = unlocked();
    s.music('labo');
    expect(drones(ctx)).toHaveLength(MUSIC.labo.drone.length);
    for (let i = 0; i < 140; i++) { ctx.currentTime += 0.45; vi.advanceTimersByTime(450); }
    const notes = ctx.sources.filter(x => x.kind === 'osc' && x.stopAt !== null && x.frequency.events.length === 1 && x.frequency.events[0].v > 250 && x.frequency.events[0].v < 1300);
    expect(notes.length).toBeGreaterThan(8);
    expect(notes.length).toBeLessThan(45); // quelques notes lentes : moins d'une toutes les 1,4 s
    const scale = MUSIC.labo.degrees.map(d => n(d));
    for (const x of notes) expect(scale.some(f => Math.abs(x.frequency.events[0].v / f - 1) < 0.001)).toBe(true);
    const gaps = notes.slice(1).map((x, i) => (x.startAt! - notes[i].startAt!).toFixed(2));
    expect(new Set(gaps).size).toBeGreaterThan(gaps.length * 0.8);
    expect(s.peakVoices).toBeLessThanOrEqual(6);
  });
  it('change de scène en fondu et s\'arrête avec null', () => {
    const { s, ctx } = unlocked();
    s.music('prologue');
    const first = drones(ctx);
    s.music('carte');
    for (const o of first) expect(o.stopAt).not.toBeNull();
    expect(drones(ctx)).toHaveLength(MUSIC.carte.drone.length);
    s.music('carte'); // même scène : rien ne redémarre
    expect(drones(ctx)).toHaveLength(MUSIC.carte.drone.length);
    s.music(null);
    expect(drones(ctx)).toHaveLength(0);
    const n0 = ctx.sources.length;
    for (let i = 0; i < 40; i++) { ctx.currentTime += 0.45; vi.advanceTimersByTime(450); }
    expect(ctx.sources.length).toBe(n0); // plus de minuterie, plus de notes
    expect(() => s.music('inconnue' as unknown as 'labo')).not.toThrow();
    expect(drones(ctx)).toHaveLength(0);
  });
  it('ne tourne jamais à volume nul ni en arrière-plan, et reprend toute seule', () => {
    const s = new Sound();
    s.music('labo'); // avant le premier geste : mémorisée, rien n'est créé
    expect(FakeContext.made).toHaveLength(0);
    s.unlock();
    const ctx = FakeContext.made[0];
    expect(drones(ctx)).toHaveLength(MUSIC.labo.drone.length);
    for (const off of [(): void => s.setMuted(true), (): void => s.suspend(), (): void => s.setVolume(0)]) {
      off();
      expect(drones(ctx)).toHaveLength(0);
      const n0 = ctx.sources.length;
      for (let i = 0; i < 20; i++) { ctx.currentTime += 0.45; vi.advanceTimersByTime(450); }
      expect(ctx.sources.length).toBe(n0);
      s.setMuted(false); s.resume(); s.setVolume(0.8);
      expect(drones(ctx)).toHaveLength(MUSIC.labo.drone.length);
    }
  });
  it('la classe Music se pilote sans minuterie (rendu hors ligne)', () => {
    const { ctx, rig } = fakeRig(), m = new Music(rig);
    expect(() => { m.tick(); m.stop(); }).not.toThrow();
    m.set('prologue');
    expect(m.playing).toBe('prologue');
    for (let i = 0; i < 60; i++) { ctx.currentTime += 0.45; m.tick(); }
    expect(ctx.sources.filter(x => x.stopAt !== null).length).toBeGreaterThan(2);
    m.set(null);
    expect(m.playing).toBeNull();
    expect(ctx.sources.filter(x => x.stopAt === null)).toHaveLength(0);
  });
});

describe('son : vibrations', () => {
  const total = (p: readonly number[]): number => p.reduce((a, b) => a + b, 0);
  it('garde tous les motifs distincts et sous 400 ms', () => {
    const all = Object.values(HAPTICS).map(p => p.join('-'));
    expect(new Set(all).size).toBe(all.length);
    for (const p of Object.values(HAPTICS)) expect(total(p)).toBeLessThanOrEqual(HAPTIC_MAX_MS);
  });
  it('coupe un motif trop long sans finir sur une pause', () => {
    const p = clampPattern([200, 100, 200, 100, 200]);
    expect(total(p)).toBeLessThanOrEqual(HAPTIC_MAX_MS);
    expect(p.length % 2).toBe(1);
    expect(clampPattern([30, 40, 20])).toEqual([30, 40, 20]);
  });
  it('vibre au ramassage, à la livraison (selon la note), au danger, à l\'étoile, jamais plus de 400 ms', () => {
    const { s } = unlocked();
    const pattern = (e: GameEvent): number[] => { vibrate.mockClear(); s.handle(e); return (vibrate.mock.calls[0]?.[0] as number[]) ?? []; };
    const seen = [
      pattern({ type: 'pickup', order }), pattern({ type: 'danger', entered: true }),
      ...(['E', 'D', 'C', 'B', 'A', 'S'] as Grade[]).map(g => pattern({ type: 'delivery', result: result(g) })),
      pattern({ type: 'delivery', result: result('S', { starsAfter: 2 }) }),
    ];
    for (const p of seen) { expect(p.length).toBeGreaterThan(0); expect(total(p)).toBeLessThanOrEqual(HAPTIC_MAX_MS); }
    expect(new Set(seen.map(p => p.join('-'))).size).toBe(seen.length);
  });
  it('se désactive avec setHaptics(false), et continue quand le son est coupé', () => {
    const { s } = unlocked();
    s.setHaptics(false); vibrate.mockClear();
    s.handle({ type: 'pickup', order }); s.ui('error');
    expect(vibrate).not.toHaveBeenCalled();
    s.setHaptics(true); s.setMuted(true);
    s.handle({ type: 'pickup', order });
    expect(vibrate).toHaveBeenCalledTimes(1);
  });
  it('ne plante pas sans vibreur', () => {
    vi.stubGlobal('navigator', {});
    const { s } = unlocked();
    expect(() => { s.handle({ type: 'pickup', order }); s.setHaptics(false); }).not.toThrow();
  });
});
