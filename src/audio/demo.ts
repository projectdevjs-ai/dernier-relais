// Démo et banc de mesure du son (demo-audio.html). Deux usages :
//  1. écouter : un bouton par événement, des curseurs pour la météo, la vitesse, la charge, l'équilibre ;
//  2. mesurer : chaque son est rendu hors ligne (OfflineAudioContext) à travers la chaîne complète, puis
//     on calcule durée, crête, niveau RMS, premier et dernier échantillons, valeurs invalides.
//     window.__mesures() renvoie le tout en JSON pour les essais automatiques.
import type { ContractView, DeliveryResult, GameEvent, GameView, Grade, OrderView, WeatherKind } from '../game/api';
import { type AmbientInput, Ambience } from './ambience';
import { type CueName, MAX_VOICES, Sound, type UiKind } from './audio';
import { BLIP_VARIANTS, type BlipMood, PERSONAS, blipPlan, playBlip } from './blip';
import { MUSIC, Music, type MusicScene } from './music';
import { CEILING, OUTPUT_BOOST, Rig, seeded } from './rig';
import { SOUNDS, SOUND_NAMES, type SoundName, play } from './sounds';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const sound = new Sound({ volume: 0.8 });
const etat = $('etat');

// ---------- Écoute ----------

const order = (weightKg: number): OrderView => ({
  id: 'c1', name: 'Médicaments', crate: 'alu', weightKg, fragile: false, at: [0, 0], destId: 'a1', destName: 'Mairie', destAt: [0, 0],
  state: 'révélé', condition: 1, minutesLeft: null, reward: 100, distanceM: 5, inRange: true,
});
const result = (grade: Grade, star = false, levelUp = false): DeliveryResult => ({
  orderId: 'c1', orderName: 'Médicaments', shelterId: 'a1', shelterName: 'Mairie', npc: 'mara', grade, condition: 1, onTime: true,
  points: 100, xp: 50, notes: [], starsBefore: 1, starsAfter: star ? 2 : 1, unlock: null, levelUp,
});
const contract: ContractView = { id: 'k1', period: 'jour', label: 'Trois livraisons', progress: 3, goal: 3, reward: 200, done: true, claimed: false };

const EVENTS: Array<[string, GameEvent]> = [
  ['Scan : 1 colis', { type: 'scan', found: 1 }],
  ['Scan : 3 colis', { type: 'scan', found: 3 }],
  ['Scan : rien', { type: 'scan', found: 0 }],
  ['Ramassage léger', { type: 'pickup', order: order(2) }],
  ['Ramassage lourd', { type: 'pickup', order: order(20) }],
  ['Pose', { type: 'drop', orderId: 'c1' }],
  ...(['E', 'D', 'C', 'B', 'A', 'S'] as Grade[]).map((g): [string, GameEvent] => [`Livraison ${g}`, { type: 'delivery', result: result(g) }]),
  ['Livraison A + étoile', { type: 'delivery', result: result('A', true) }],
  ['Livraison S + étoile + niveau', { type: 'delivery', result: result('S', true, true) }],
  ['Niveau', { type: 'levelUp', level: 4 }],
  ['Contrat', { type: 'contract', contract }],
  ['Danger : entrée', { type: 'danger', entered: true }],
  ['Danger : sortie', { type: 'danger', entered: false }],
  ['Message', { type: 'toast', text: 'Info', tone: 'info' }],
  ['Message : bonne nouvelle', { type: 'toast', text: 'Bien', tone: 'good' }],
  ['Message : avertissement', { type: 'toast', text: 'Attention', tone: 'warn' }],
  ['Événement inconnu', { type: 'rôdeur', near: true } as unknown as GameEvent],
];

function button(parent: HTMLElement, label: string, fn: () => void): void {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', () => { sound.unlock(); showState(); fn(); });
  parent.append(b);
}
for (const [label, e] of EVENTS) button($('evenements'), label, () => sound.handle(e));
for (const k of ['tap', 'open', 'close', 'error', 'confirm'] as UiKind[]) button($('interface'), k, () => sound.ui(k));

{
  const mood = document.createElement('select');
  for (const m of ['neutre', 'content', 'grave']) mood.append(new Option(`humeur : ${m}`, m));
  $('voix').append(mood);
  for (const who of [...Object.keys(PERSONAS).filter(k => k), 'rôdeur']) button($('voix'), who, () => sound.blip(who, mood.value as BlipMood));
  for (const c of ['chargement', 'depart', 'labo', 'passeur', 'chapitre'] as CueName[]) button($('jingles'), c, () => sound.cue(c));
  for (const m of ['labo', 'prologue', 'carte', null] as Array<MusicScene | null>) button($('musique'), m ?? 'arrêt', () => sound.music(m));
}

const state = { kind: 'nuages' as WeatherKind, wind: 15, night: false, speed: 0, load: 0.2, balance: 0, volume: 0.8, muted: false, haptics: true, background: false };

function slider(label: string, key: 'wind' | 'speed' | 'load' | 'balance' | 'volume', min: number, max: number, step: number, unit: string): void {
  const l = document.createElement('label'), o = document.createElement('output'), i = document.createElement('input');
  i.type = 'range'; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(state[key]);
  const show = (): void => { o.textContent = `${state[key]} ${unit}`; };
  i.addEventListener('input', () => { state[key] = Number(i.value); show(); apply(); });
  const head = document.createElement('span');
  head.append(`${label} : `, o);
  l.append(head, i); show();
  $('reglages').append(l);
}
function toggle(label: string, key: 'night' | 'muted' | 'haptics' | 'background'): void {
  const l = document.createElement('label'), i = document.createElement('input');
  l.className = 'case'; i.type = 'checkbox'; i.checked = state[key];
  i.addEventListener('change', () => { state[key] = i.checked; apply(); });
  l.append(i, label);
  $('reglages').append(l);
}
{
  const l = document.createElement('label'), s = document.createElement('select');
  for (const k of ['clair', 'nuages', 'pluie', 'orage', 'neige', 'brouillard'] as WeatherKind[]) s.append(new Option(k, k, false, k === state.kind));
  s.addEventListener('change', () => { state.kind = s.value as WeatherKind; });
  l.append('Météo', s);
  $('reglages').append(l);
}
slider('Vent', 'wind', 0, 80, 1, 'km/h');
slider('Vitesse', 'speed', 0, 4, 0.1, 'm/s');
slider('Charge', 'load', 0, 1, 0.05, '× capacité');
slider('Équilibre', 'balance', -1, 1, 0.05, '');
slider('Volume', 'volume', 0, 1, 0.05, '');
toggle('Nuit', 'night');
toggle('Son coupé', 'muted');
toggle('Vibrations', 'haptics');
toggle('Appli en arrière-plan (suspend)', 'background');

function apply(): void {
  sound.setVolume(state.volume); sound.setMuted(state.muted); sound.setHaptics(state.haptics);
  if (state.background) sound.suspend(); else sound.resume();
}
function showState(): void {
  etat.textContent = sound.ready ? `Son actif. Voix : ${sound.voices} (maximum ${MAX_VOICES}).` : 'Son indisponible sur ce navigateur.';
}
/** Faux état de jeu : seuls le joueur et la météo comptent pour la nappe. */
function fakeView(): GameView {
  return {
    player: { speedMps: state.speed, moving: state.speed > 0.3, carriedKg: state.load * 30, capacityKg: 30, balance: state.balance },
    weather: { kind: state.kind, windKmh: state.wind, tempC: 12, night: state.night, sunAltDeg: state.night ? -20 : 30 },
  } as unknown as GameView;
}
setInterval(() => { sound.ambient(fakeView()); if (sound.ready) showState(); }, 200);
addEventListener('pointerdown', () => { sound.unlock(); showState(); }, { once: true });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') sound.suspend(); else if (!state.background) sound.resume(); });

// ---------- Mesures ----------

const SR = 48000;
// Le compresseur du navigateur écrase les 150 premières millisecondes d'un contexte tout neuf :
// les sons sont donc lancés un quart de seconde après le début du rendu, comme dans un contexte déjà en route.
const WARMUP = 0.25;
const db = (x: number): number => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const r1 = (x: number): number => (Number.isFinite(x) ? Math.round(x * 10) / 10 : -999);

export interface Mesure {
  nom: string; famille: string;
  /** Durée audible : du premier au dernier échantillon au-dessus de −60 dBFS (s). */
  duree: number;
  crete: number; rms: number;
  /** Niveau RMS de la demi-seconde la plus forte (ou du son entier s'il est plus court), en dBFS. */
  rmsFort: number;
  /** Premier et dernier échantillons du rendu, en valeur absolue. */
  debut: number; fin: number;
  /** Plus grand saut entre deux échantillons voisins, rapporté à la crête. */
  saut: number;
  /** Niveau atteint 0,25 ms après le tout début du son, et 0,25 ms avant sa toute fin, rapportés à la crête (un clic donnerait près de 1). */
  attaque: number; extinction: number;
  nan: number; voix: number;
}

function measure(nom: string, famille: string, buf: AudioBuffer, voix: number): Mesure {
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)), len = buf.length;
  let peak = 0, nan = 0, first = -1, last = -1, jump = 0;
  for (const d of chans) for (let i = 0; i < len; i++) {
    const x = d[i];
    if (!Number.isFinite(x)) { nan++; continue; }
    const a = Math.abs(x);
    if (a > peak) peak = a;
    if (a > 0.001) { if (first < 0 || i < first) first = i; if (i > last) last = i; }
    if (i > 0) jump = Math.max(jump, Math.abs(x - d[i - 1]));
  }
  // Puissance moyenne des canaux, puis RMS sur la partie audible et sur la demi-seconde la plus forte.
  const pow = new Float64Array(len);
  for (const d of chans) for (let i = 0; i < len; i++) pow[i] += (d[i] * d[i]) / chans.length || 0;
  let sum = 0;
  for (let i = Math.max(0, first); i <= last; i++) sum += pow[i];
  const rms = first < 0 ? 0 : Math.sqrt(sum / (last - first + 1));
  const win = Math.min(len, Math.floor(SR * 0.5), Math.max(1, last - first + 1));
  let acc = 0, best = 0;
  for (let i = 0; i < len; i++) { acc += pow[i]; if (i >= win) acc -= pow[i - win]; if (i >= win - 1) best = Math.max(best, acc); }
  // Bords du son : on cherche le premier et le dernier échantillon au-dessus d'un millième de la crête,
  // puis on regarde le quart de milliseconde qui suit (ou précède). Une enveloppe propre y est encore très basse.
  let attaque = 0, extinction = 0;
  for (const d of chans) {
    let a = 0, b = len - 1;
    while (a < len && Math.abs(d[a]) <= peak * 0.001) a++;
    while (b > 0 && Math.abs(d[b]) <= peak * 0.001) b--;
    for (let i = a; i < Math.min(len, a + 12); i++) attaque = Math.max(attaque, Math.abs(d[i]));
    for (let i = Math.max(0, b - 12); i <= b; i++) extinction = Math.max(extinction, Math.abs(d[i]));
  }
  const r2 = (x: number): number => (peak > 0 ? Math.round((x / peak) * 1000) / 1000 : 0);
  return {
    attaque: r2(attaque), extinction: r2(extinction),
    nom, famille, duree: first < 0 ? 0 : Math.round(((last - first + 1) / SR) * 100) / 100,
    crete: r1(db(peak)), rms: r1(db(rms)), rmsFort: r1(db(Math.sqrt(Math.max(0, best) / win))),
    debut: Math.max(...chans.map(d => Math.abs(d[0]))), fin: Math.max(...chans.map(d => Math.abs(d[len - 1]))),
    saut: peak > 0 ? Math.round((jump / peak) * 100) / 100 : 0, nan, voix,
  };
}

/** Rend un son seul, hors ligne, à travers la chaîne complète. */
async function renderSound(name: SoundName, v: number, w: number): Promise<Mesure> {
  const def = SOUNDS[name];
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * (WARMUP + def.dur + 0.4)), SR);
  const rig = new Rig(ctx, { rand: seeded(11) });
  play(rig, name, WARMUP, v, w);
  const voix = rig.peakVoices;
  return measure(name, def.family, await ctx.startRendering(), voix);
}

// Variantes mesurées en plus du réglage par défaut.
const VARIANTS: Array<[SoundName, string, number, number]> = [
  ['scan', 'scan (3 colis)', 1, 0], ['pickup', 'pickup (lourd)', 1, 0], ['step', 'step (chargé, mouillé)', 1, 1],
  ['pulse', 'pulse (urgent)', 1, 0], ['thunder', 'thunder (proche)', 1, 0],
  ['step', 'step (à vide)', 0, 0], ['strap', 'strap (bien serré)', 1, 0], ['cacheOpen', 'cacheOpen (point de compétence)', 1, 0],
];

interface Scene { nom: string; secondes: number; at(t: number): AmbientInput | null }
const wx = (kind: WeatherKind, windKmh: number, night = false): AmbientInput['weather'] => ({ kind, windKmh, tempC: 10, night, sunAltDeg: night ? -20 : 30 });
const still = (weather: AmbientInput['weather'], over: Partial<AmbientInput> = {}): AmbientInput => ({ weather, speedMps: 0, moving: false, load: 0.2, balance: 0, ...over });
const SCENES: Scene[] = [
  { nom: 'clair, jour, vent 8 km/h', secondes: 12, at: () => still(wx('clair', 8)) },
  { nom: 'nuages, vent 20 km/h', secondes: 12, at: () => still(wx('nuages', 20)) },
  { nom: 'nuages, vent 60 km/h', secondes: 12, at: () => still(wx('nuages', 60)) },
  { nom: 'pluie, vent 15 km/h', secondes: 12, at: () => still(wx('pluie', 15)) },
  { nom: 'orage, vent 40 km/h (avec tonnerre)', secondes: 16, at: () => still(wx('orage', 40)) },
  { nom: 'neige, vent 10 km/h', secondes: 12, at: () => still(wx('neige', 10)) },
  { nom: 'brouillard, vent 5 km/h', secondes: 12, at: () => still(wx('brouillard', 5)) },
  { nom: 'nuit claire, vent 8 km/h (avec notes)', secondes: 16, at: () => still(wx('clair', 8, true)) },
  { nom: 'marche 1,4 m/s, charge 10 %', secondes: 12, at: () => still(wx('clair', 8), { speedMps: 1.4, moving: true, load: 0.1 }) },
  { nom: 'marche 1,2 m/s, charge 95 %', secondes: 12, at: () => still(wx('clair', 8), { speedMps: 1.2, moving: true, load: 0.95 }) },
  { nom: 'course 3 m/s sous la pluie', secondes: 12, at: () => still(wx('pluie', 15), { speedMps: 3, moving: true, load: 0.3 }) },
  { nom: 'alerte équilibre 0,9', secondes: 12, at: () => still(wx('clair', 8), { balance: 0.9 }) },
  { nom: 'fondus : clair → pluie + vent 50 (4 s) → coupure (9 s)', secondes: 12, at: t => (t < 4 ? still(wx('clair', 8)) : t < 9 ? still(wx('pluie', 50)) : null) },
];

export interface MesureNappe extends Mesure {
  /** Niveau RMS par tranche d'une demi-seconde, en dBFS : montre les fondus et l'évolution de la nappe. */
  profil: number[];
}

/** Rend une scène d'ambiance en appelant update() toutes les 200 ms de temps audio, comme le fait le jeu. */
async function renderScene(s: Scene): Promise<MesureNappe> {
  const ctx = new OfflineAudioContext(2, SR * s.secondes, SR);
  const rig = new Rig(ctx, { rand: seeded(23) }), amb = new Ambience(rig);
  let voix = 0;
  const step = (t: number): void => {
    const inp = s.at(t);
    if (inp) amb.update(inp); else amb.stop();
    voix = Math.max(voix, rig.peakVoices);
  };
  for (let k = 1; k * 0.2 < s.secondes; k++) void ctx.suspend(k * 0.2).then(() => { step(k * 0.2); void ctx.resume(); });
  step(0);
  const buf = await ctx.startRendering();
  const m = measure(s.nom, 'nappe', buf, voix);
  const d = buf.getChannelData(0), w = SR / 2, profil: number[] = [];
  for (let i = 0; i + w <= d.length; i += w) { let a = 0; for (let j = i; j < i + w; j++) a += d[j] * d[j]; profil.push(Math.round(Math.max(-99, db(Math.sqrt(a / w))))); }
  return { ...m, profil };
}

/** Tous les sons du jeu lancés au même instant : le pire cas pour le plafond et la limite de voix. */
async function renderStress(): Promise<Mesure> {
  const ctx = new OfflineAudioContext(2, SR * 3, SR), rig = new Rig(ctx, { rand: seeded(5) });
  for (let k = 0; k < 3; k++) for (const name of SOUND_NAMES) play(rig, name, WARMUP + 0.01 * k, 1, 1);
  const voix = rig.peakVoices;
  return measure('TOUS LES SONS × 3 en même temps', 'essai', await ctx.startRendering(), voix);
}

/** Gain de la chaîne de sortie pour un signal faible (doit valoir 0 dB : le rattrapage du compresseur est bien annulé). */
async function chainGain(): Promise<number> {
  const ctx = new OfflineAudioContext(2, SR, SR), rig = new Rig(ctx, { rand: seeded(1) });
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  g.gain.value = 0.05; o.frequency.value = 440;
  o.connect(g); g.connect(rig.dry); o.start(0);
  const d = (await ctx.startRendering()).getChannelData(0);
  let peak = 0;
  for (let i = SR / 2; i < SR; i++) peak = Math.max(peak, Math.abs(d[i]));
  return Math.round(db(peak / 0.05 / OUTPUT_BOOST) * 100) / 100;
}

// ---------- Interjections : niveaux, clics, fondamentale et formants mesurés par transformée de Fourier ----------

/** Transformée de Fourier rapide (longueur puissance de 2), en place. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
      const c = Math.cos(ang * k), s = Math.sin(ang * k), a = i + k, b = a + len / 2;
      const xr = re[b] * c - im[b] * s, xi = re[b] * s + im[b] * c;
      re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
    }
  }
}
/** Fondamentale d'une tranche par autocorrélation (Hz), ou 0 si la tranche n'est pas voisée. */
function pitch(x: Float32Array, from: number, size: number): number {
  const lo = Math.floor(SR / 420), hi = Math.floor(SR / 60);
  let e = 0;
  for (let i = from; i < from + size; i++) e += x[i] * x[i];
  if (e / size < 1e-7) return 0;
  let best = 0, lag = 0;
  for (let l = lo; l <= hi; l++) {
    let a = 0, b = 0;
    for (let i = from; i < from + size - l; i++) { a += x[i] * x[i + l]; b += x[i + l] * x[i + l]; }
    const c = a / Math.sqrt(e * b || 1) ;
    if (c > best * 1.04) { best = c; lag = l; } // préfère le plus petit décalage : évite l'erreur d'octave
  }
  return best > 0.5 ? Math.round((SR / lag) * 10) / 10 : 0;
}
export interface MesureBlip extends Mesure {
  /** Ce que vise la synthèse. */
  viseF0: number; viseFormants: number[]; viseDuree: number; syllabes: number;
  /** Fondamentale mesurée au début, au milieu et à la fin de la partie voisée (Hz) : le contour. */
  f0: number[];
  /** Pour chaque formant visé : la bosse du spectre moyen la plus proche (Hz), ou 0 si aucune bosse nette à ±25 %. */
  formants: number[];
  /** Durée voisée mesurée (au-dessus de −40 dB sous la crête), en s. */
  voise: number;
}
async function renderBlip(who: string, mood: BlipMood, variant: number): Promise<MesureBlip> {
  const plan = blipPlan(who, mood, variant);
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * (WARMUP + 1.3)), SR), rig = new Rig(ctx, { rand: seeded(31 + variant) });
  playBlip(rig, who, mood, variant, WARMUP);
  const buf = await ctx.startRendering(), m = measure(`${who || 'défaut'} · ${mood} · ${variant + 1}`, 'voix', buf, rig.peakVoices);
  const L = buf.getChannelData(0), R = buf.getChannelData(1), x = new Float32Array(buf.length);
  let peak = 0;
  for (let i = 0; i < x.length; i++) { x[i] = (L[i] + R[i]) / 2; peak = Math.max(peak, Math.abs(x[i])); }
  // Partie voisée : là où l'enveloppe (10 ms) dépasse un dixième de la crête.
  const hop = 480, on: number[] = [];
  for (let i = 0; i + hop <= x.length; i += hop) { let a = 0; for (let j = i; j < i + hop; j++) a = Math.max(a, Math.abs(x[j])); if (a > peak * 0.1) on.push(i); }
  const a = on[0] ?? 0, b = (on[on.length - 1] ?? 0) + hop, win = 1536;
  const at = (q: number): number => pitch(x, Math.max(0, Math.min(x.length - win, Math.round(a + (b - a) * q - win / 2))), win);
  const f0 = [at(0.2), at(0.5), at(0.8)];
  // Spectre moyen de la partie voisée (fenêtres de Hann de 4096 points), relevé de 6 dB par octave, lissé sur une
  // largeur d'environ une fondamentale pour gommer les harmoniques : il reste les bosses des formants.
  const N = 4096, spec = new Float64Array(N / 2);
  for (let s0 = Math.max(0, a - N / 4); s0 < b - N / 4 && s0 + N <= x.length; s0 += 512) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[s0 + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    fft(re, im);
    for (let k = 0; k < N / 2; k++) spec[k] += re[k] * re[k] + im[k] * im[k];
  }
  const binHz = SR / N, half = Math.max(2, Math.round((plan.f0 * 0.65) / binHz)), smooth = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) {
    let acc = 0, cnt = 0;
    for (let j = Math.max(1, k - half); j <= Math.min(N / 2 - 1, k + half); j++) { acc += spec[j] * (j * binHz) ** 2; cnt++; }
    smooth[k] = acc / cnt;
  }
  const formants = plan.formants.map(target => {
    const lo = Math.round((target * 0.75) / binHz), hi = Math.round((target * 1.25) / binHz);
    let best = 0, bk = 0;
    for (let k = lo + 1; k < hi; k++) if (smooth[k] >= smooth[k - 1] && smooth[k] >= smooth[k + 1] && smooth[k] > best) { best = smooth[k]; bk = k; }
    return Math.round(bk * binHz);
  });
  return { ...m, syllabes: plan.persona.syllables.length, viseF0: r1(plan.f0), viseFormants: plan.formants.map(Math.round), viseDuree: Math.round(plan.dur * 100) / 100, f0, formants, voise: Math.round(((b - a) / SR) * 100) / 100 };
}
/** Une interjection coupée par la suivante, comme le fait Sound.blip : il ne doit y avoir ni clic ni superposition. */
async function renderBlipCut(): Promise<Mesure> {
  const ctx = new OfflineAudioContext(2, SR * 2, SR), rig = new Rig(ctx, { rand: seeded(7) });
  const first = playBlip(rig, 'kenji', 'neutre', 0, WARMUP);
  void ctx.suspend(WARMUP + 0.15).then(() => { first?.cut(ctx.currentTime); playBlip(rig, 'mara', 'neutre', 0, ctx.currentTime + 0.04); void ctx.resume(); });
  return measure('kenji coupé par mara (après 150 ms)', 'voix', await ctx.startRendering(), rig.peakVoices);
}

// ---------- Musique générative ----------

async function renderMusic(scene: MusicScene, secondes = 40): Promise<MesureNappe> {
  const ctx = new OfflineAudioContext(2, SR * secondes, SR), rig = new Rig(ctx, { rand: seeded(41) }), mus = new Music(rig);
  let voix = 0;
  for (let k = 1; k * 0.45 < secondes; k++) void ctx.suspend(k * 0.45).then(() => { if (k * 0.45 > secondes - 5) mus.set(null); else mus.tick(); voix = Math.max(voix, rig.peakVoices); void ctx.resume(); });
  mus.set(scene);
  const buf = await ctx.startRendering(), m = measure(`musique : ${scene} (${MUSIC[scene].degrees.length} degrés, arrêt à ${secondes - 5} s)`, 'nappe', buf, voix);
  const d = buf.getChannelData(0), w = SR * 2, profil: number[] = [];
  for (let i = 0; i + w <= d.length; i += w) { let a = 0; for (let j = i; j < i + w; j++) a += d[j] * d[j]; profil.push(Math.round(Math.max(-99, db(Math.sqrt(a / w))))); }
  return { ...m, nom: m.nom.replace('fondus', ''), profil };
}

// ---------- Pas : niveau par rapport à la nappe ----------

export interface MesurePas {
  nom: string;
  /** Niveau RMS de la nappe seule, joueur à l'arrêt, dans sa demi-seconde la plus faible (dBFS). */
  nappe: number;
  /** Les pas seuls (même marche, nappe débranchée) : crête, RMS de la tranche de 50 ms la plus forte, RMS moyen (dBFS). */
  pasCrete: number; pasFort: number; pasMoyen: number;
  /** pasFort − nappe : négatif = le pas le plus fort reste sous la nappe. */
  marge: number;
}
async function renderSteps(nom: string, inp: AmbientInput): Promise<MesurePas> {
  // Deux rendus : la nappe seule (joueur à l'arrêt), puis les pas seuls (même marche, entrée de la nappe débranchée,
  // de jour pour qu'aucune note de nuit ne s'y mêle : les pas ne dépendent pas de l'heure).
  const secondes = 12, one = async (pasSeuls: boolean): Promise<AudioBuffer> => {
    const ctx = new OfflineAudioContext(2, SR * secondes, SR), rig = new Rig(ctx, { rand: seeded(23) }), amb = new Ambience(rig);
    if (pasSeuls) rig.amb.disconnect();
    const go = (): void => amb.update(pasSeuls ? { ...inp, moving: true, weather: { ...inp.weather, night: false } } : { ...inp, moving: false, speedMps: 0 });
    for (let k = 1; k * 0.2 < secondes; k++) void ctx.suspend(k * 0.2).then(() => { go(); void ctx.resume(); });
    go();
    return ctx.startRendering();
  };
  const power = (b: AudioBuffer): Float64Array => {
    const L = b.getChannelData(0), R = b.getChannelData(1), p = new Float64Array(b.length);
    for (let i = 0; i < p.length; i++) p[i] = (L[i] * L[i] + R[i] * R[i]) / 2;
    return p;
  };
  /** RMS de la tranche la plus forte (ou la plus faible) de `w` échantillons, après 4 s d'établissement. */
  const slide = (p: Float64Array, w: number, pick: (a: number, b: number) => number, start: number): number => {
    let acc = 0, out = start;
    for (let i = SR * 4; i < p.length; i++) { acc += p[i]; if (i >= SR * 4 + w) acc -= p[i - w]; if (i >= SR * 4 + w - 1) out = pick(out, acc / w); }
    return Math.sqrt(Math.max(0, out));
  };
  const calme = power(await one(false)), pasBuf = await one(true), pas = power(pasBuf);
  let peak = 0, sum = 0;
  for (let c = 0; c < 2; c++) { const d = pasBuf.getChannelData(c); for (let i = SR * 4; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i])); }
  for (let i = SR * 4; i < pas.length; i++) sum += pas[i];
  // La nappe est prise à son plus bas (demi-seconde la plus faible) : la comparaison est la plus sévère possible.
  const nappe = r1(db(slide(calme, SR / 2, Math.min, Infinity))), pasFort = r1(db(slide(pas, Math.floor(SR * 0.05), Math.max, 0)));
  return { nom, nappe, pasCrete: r1(db(peak)), pasFort, pasMoyen: r1(db(Math.sqrt(sum / (pas.length - SR * 4)))), marge: r1(pasFort - nappe) };
}
const PAS: Array<[string, AmbientInput]> = [
  ['jour clair, sans vent, à vide', still(wx('clair', 0), { speedMps: 1.4, load: 0 })],
  ['jour clair, vent 8 km/h, charge 30 %', still(wx('clair', 8), { speedMps: 1.4, load: 0.3 })],
  ['jour clair, sans vent, charge 100 %', still(wx('clair', 0), { speedMps: 1.2, load: 1 })],
  ['nuit claire, sans vent, charge 100 %', still(wx('clair', 0, true), { speedMps: 1.2, load: 1 })],
  ['brouillard, sans vent, charge 100 %', still(wx('brouillard', 0), { speedMps: 1.2, load: 1 })],
  ['neige, nuit, sans vent, charge 100 %', still(wx('neige', 0, true), { speedMps: 1.2, load: 1 })],
  ['pluie, vent 15 km/h, course, charge 100 %', still(wx('pluie', 15), { speedMps: 3, load: 1 })],
];

export interface Rapport {
  blips: MesureBlip[]; coupe: Mesure; musiques: MesureNappe[]; pas: MesurePas[];
  sons: Mesure[]; nappes: MesureNappe[]; essai: Mesure; gainChaine: number;
  plafond: number; mediane: number; ecartMin: number; ecartMax: number; ok: boolean; echecs: string[];
}

async function mesurerTout(): Promise<Rapport> {
  const sons: Mesure[] = [];
  for (const name of SOUND_NAMES) sons.push(await renderSound(name, name === 'scan' ? 1 / 3 : 0.3, 0));
  for (const [name, label, v, w] of VARIANTS) sons.push({ ...(await renderSound(name, v, w)), nom: label });
  const nappes: MesureNappe[] = [];
  for (const s of SCENES) nappes.push(await renderScene(s));
  const essai = await renderStress(), gainChaine = await chainGain();
  const blips: MesureBlip[] = [];
  for (const who of Object.keys(PERSONAS)) for (let v = 0; v < BLIP_VARIANTS; v++) blips.push(await renderBlip(who, 'neutre', v));
  for (const who of ['mara', 'tomas']) for (const mood of ['content', 'grave'] as BlipMood[]) blips.push(await renderBlip(who, mood, 0));
  const coupe = await renderBlipCut();
  const musiques: MesureNappe[] = [];
  for (const sc of Object.keys(MUSIC) as MusicScene[]) musiques.push(await renderMusic(sc));
  const pas: MesurePas[] = [];
  for (const [nom, inp] of PAS) pas.push(await renderSteps(nom, inp));

  // Critères : crête sous −1 dBFS, aucun NaN, début et fin à zéro, moins de 2 s (hors ambiance),
  // et niveaux RMS des sons du jeu à ±6 dB de leur médiane.
  const jeu = sons.filter(m => m.famille === 'jeu'), sorted = jeu.map(m => m.rms).sort((a, b) => a - b);
  const mediane = (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2;
  const echecs: string[] = [];
  for (const m of blips) {
    if (m.viseDuree < 0.2 || m.viseDuree > 0.5) echecs.push(`${m.nom} : durée visée ${m.viseDuree} s`);
    // Une seule syllabe : la hauteur se lit au milieu. Deux syllabes (« hm-hm ») : sur la première.
    const f = m.syllabes > 1 ? m.f0[0] : m.f0[1];
    if (!(Math.abs(f / m.viseF0 - 1) < 0.15)) echecs.push(`${m.nom} : fondamentale ${f} Hz, visée ${m.viseF0}`);
    if (!m.formants[0]) echecs.push(`${m.nom} : premier formant introuvable`);
  }
  for (const p of pas) if (p.marge > 0) echecs.push(`pas (${p.nom}) : ${p.marge} dB au-dessus de la nappe`);
  for (const m of [...sons, ...nappes, essai, ...blips, coupe, ...musiques]) {
    if (m.crete >= -1) echecs.push(`${m.nom} : crête ${m.crete} dBFS`);
    if (m.nan) echecs.push(`${m.nom} : ${m.nan} valeurs invalides`);
    // Une nappe est coupée par la fin du rendu : seule la scène des fondus, qui s'éteint d'elle-même, doit finir à zéro.
    const cut = m.famille === 'nappe' && !m.nom.startsWith('fondus') && !m.nom.startsWith('musique');
    if (m.debut > 0.002 || (!cut && m.fin > 0.002)) echecs.push(`${m.nom} : début ${m.debut} / fin ${m.fin}`);
    if (m.famille !== 'nappe' && (m.attaque > 0.35 || m.extinction > 0.05)) echecs.push(`${m.nom} : attaque ${m.attaque} / extinction ${m.extinction}`);
    if (m.voix > MAX_VOICES) echecs.push(`${m.nom} : ${m.voix} voix`);
  }
  for (const m of sons) if (m.duree > 2 && !m.nom.startsWith('thunder')) echecs.push(`${m.nom} : ${m.duree} s`);
  for (const m of jeu) if (Math.abs(m.rms - mediane) > 6) echecs.push(`${m.nom} : RMS ${m.rms} dBFS, médiane ${r1(mediane)}`);
  return {
    blips, coupe, musiques, pas,
    sons, nappes, essai, gainChaine, plafond: r1(db(CEILING)), mediane: r1(mediane),
    ecartMin: r1(sorted[0] - mediane), ecartMax: r1(sorted[sorted.length - 1] - mediane), ok: echecs.length === 0, echecs,
  };
}

function row(cells: Array<string | number>, flags: boolean[] = []): string {
  return `<tr>${cells.map((c, i) => `<td${flags[i] === undefined ? '' : flags[i] ? ' class="ok"' : ' class="ko"'}>${c}</td>`).join('')}</tr>`;
}
function show(r: Rapport): void {
  const head = '<tr><th>Son</th><th>Famille</th><th>Durée (s)</th><th>Crête (dBFS)</th><th>RMS (dBFS)</th><th>RMS 0,5 s fort</th><th>Écart médiane</th><th>|début|</th><th>|fin|</th><th>Attaque</th><th>Extinction</th><th>Saut / crête</th><th>NaN</th><th>Voix</th></tr>';
  const line = (m: Mesure): string => row(
    [m.nom, m.famille, m.duree, m.crete, m.rms, m.rmsFort, m.famille === 'jeu' ? r1(m.rms - r.mediane) : '', m.debut.toExponential(1), m.fin.toExponential(1), m.attaque, m.extinction, m.saut, m.nan, m.voix],
    [true, true, m.duree <= 2 || m.nom.startsWith('thunder'), m.crete < -1, true, true, m.famille !== 'jeu' || Math.abs(m.rms - r.mediane) <= 6, m.debut <= 0.002, m.fin <= 0.002, m.attaque <= 0.35, m.extinction <= 0.05, true, m.nan === 0, m.voix <= MAX_VOICES],
  );
  $('mesures').innerHTML = head + r.sons.map(line).join('') + line(r.essai);
  $('nappes').innerHTML = '<tr><th>Scène</th><th>Crête (dBFS)</th><th>RMS (dBFS)</th><th>RMS 0,5 s fort</th><th>|début|</th><th>|fin|</th><th>NaN</th><th>Voix</th><th>Niveau par demi-seconde (dBFS)</th></tr>'
    + r.nappes.map(m => row([m.nom, m.crete, m.rms, m.rmsFort, m.debut.toExponential(1), m.fin.toExponential(1), m.nan, m.voix, m.profil.join(' ')], [true, m.crete < -1, true, true, m.debut <= 0.002])).join('');
  $('tvoix').innerHTML = '<tr><th>Interjection</th><th>Durée visée (s)</th><th>Voisé mesuré (s)</th><th>Crête (dBFS)</th><th>RMS (dBFS)</th><th>Attaque</th><th>Extinction</th><th>F0 visée (Hz)</th><th>F0 début · milieu · fin</th><th>Formants visés</th><th>Formants mesurés</th><th>NaN</th></tr>'
    + [...r.blips, { ...r.coupe, viseDuree: '', voise: '', viseF0: '', f0: [], viseFormants: [], formants: [] }].map(m => row([m.nom, m.viseDuree, m.voise, m.crete, m.rms, m.attaque, m.extinction, m.viseF0, m.f0.join(' · '), m.viseFormants.join(' · '), m.formants.join(' · '), m.nan], [true, true, true, m.crete < -1, true, m.attaque <= 0.35, m.extinction <= 0.05])).join('');
  $('tpas').innerHTML = '<tr><th>Scène de marche</th><th>Nappe seule, RMS (dBFS)</th><th>Pas : crête</th><th>Pas : 50 ms les plus forts</th><th>Pas : RMS moyen</th><th>Marge (pas − nappe)</th></tr>'
    + r.pas.map(p => row([p.nom, p.nappe, p.pasCrete, p.pasFort, p.pasMoyen, p.marge], [true, true, true, true, true, p.marge <= 0])).join('');
  $('tmusique').innerHTML = '<tr><th>Scène</th><th>Crête (dBFS)</th><th>RMS (dBFS)</th><th>|fin|</th><th>NaN</th><th>Voix</th><th>Niveau par tranche de 2 s (dBFS)</th></tr>'
    + r.musiques.map(m => row([m.nom, m.crete, m.rms, m.fin.toExponential(1), m.nan, m.voix, m.profil.join(' ')], [true, m.crete < -1, true, m.fin <= 0.002])).join('');
  $('resume').innerHTML = `${r.ok ? '<b style="color:var(--ok)">Tous les critères sont tenus.</b>' : `<b style="color:var(--ko)">${r.echecs.length} écart(s) :</b> ${r.echecs.join(' ; ')}`}
    <br>Plafond de sortie : ${r.plafond} dBFS. Gain de la chaîne à bas niveau : ${r.gainChaine} dB. Médiane RMS des sons du jeu : ${r.mediane} dBFS (écarts de ${r.ecartMin} à +${r.ecartMax} dB).`;
}

$('mesurer').addEventListener('click', () => { $('resume').textContent = 'Rendu en cours…'; void mesurerTout().then(show); });
Object.assign(window, { __mesures: mesurerTout, __son: sound });
