// Démo et banc de mesure du son (demo-audio.html). Deux usages :
//  1. écouter : un bouton par événement, des curseurs pour la météo, la vitesse, la charge, l'équilibre ;
//  2. mesurer : chaque son est rendu hors ligne (OfflineAudioContext) à travers la chaîne complète, puis
//     on calcule durée, crête, niveau RMS, premier et dernier échantillons, valeurs invalides.
//     window.__mesures() renvoie le tout en JSON pour les essais automatiques.
import type { ContractView, DeliveryResult, GameEvent, GameView, Grade, OrderView, WeatherKind } from '../game/api';
import { type AmbientInput, Ambience } from './ambience';
import { MAX_VOICES, Sound, type UiKind } from './audio';
import { CEILING, Rig, seeded } from './rig';
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
  return {
    nom, famille, duree: first < 0 ? 0 : Math.round(((last - first + 1) / SR) * 100) / 100,
    crete: r1(db(peak)), rms: r1(db(rms)), rmsFort: r1(db(Math.sqrt(Math.max(0, best) / win))),
    debut: Math.max(...chans.map(d => Math.abs(d[0]))), fin: Math.max(...chans.map(d => Math.abs(d[len - 1]))),
    saut: peak > 0 ? Math.round((jump / peak) * 100) / 100 : 0, nan, voix,
  };
}

/** Rend un son seul, hors ligne, à travers la chaîne complète. */
async function renderSound(name: SoundName, v: number, w: number): Promise<Mesure> {
  const def = SOUNDS[name];
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * (def.dur + 0.5)), SR);
  const rig = new Rig(ctx, { rand: seeded(11) });
  play(rig, name, 0, v, w);
  const voix = rig.peakVoices;
  return measure(name, def.family, await ctx.startRendering(), voix);
}

// Variantes mesurées en plus du réglage par défaut.
const VARIANTS: Array<[SoundName, string, number, number]> = [
  ['scan', 'scan (3 colis)', 1, 0], ['pickup', 'pickup (lourd)', 1, 0], ['step', 'step (chargé, mouillé)', 1, 1],
  ['pulse', 'pulse (urgent)', 1, 0], ['thunder', 'thunder (proche)', 1, 0],
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
  { nom: 'fondus : clair → orage (4 s) → coupure (9 s)', secondes: 12, at: t => (t < 4 ? still(wx('clair', 8)) : t < 9 ? still(wx('pluie', 50)) : null) },
];

export interface MesureNappe extends Mesure {
  /** Plus grand écart de niveau entre deux tranches voisines de 100 ms, en dB (un fondu propre reste petit). */
  marche: number;
  pas: number;
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
  // Niveau par tranches de 100 ms : sert à vérifier les fondus (pas de marche brutale) et à compter les pas.
  const d = buf.getChannelData(0), w = SR / 10, levels: number[] = [];
  for (let i = 0; i + w <= d.length; i += w) { let a = 0; for (let j = i; j < i + w; j++) a += d[j] * d[j]; levels.push(Math.sqrt(a / w)); }
  let marche = 0;
  for (let i = 1; i < levels.length; i++) if (levels[i] > 0.0005 && levels[i - 1] > 0.0005) marche = Math.max(marche, Math.abs(db(levels[i] / levels[i - 1])));
  return { ...m, marche: r1(marche), pas: 0 };
}

/** Tous les sons du jeu lancés au même instant : le pire cas pour le plafond et la limite de voix. */
async function renderStress(): Promise<Mesure> {
  const ctx = new OfflineAudioContext(2, SR * 3, SR), rig = new Rig(ctx, { rand: seeded(5) });
  for (let k = 0; k < 3; k++) for (const name of SOUND_NAMES) play(rig, name, 0.01 * k, 1, 1);
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
  return r1(db(peak / 0.05) * 10) / 10;
}

export interface Rapport {
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

  // Critères : crête sous −1 dBFS, aucun NaN, début et fin à zéro, moins de 2 s (hors ambiance),
  // et niveaux RMS des sons du jeu à ±6 dB de leur médiane.
  const jeu = sons.filter(m => m.famille === 'jeu'), sorted = jeu.map(m => m.rms).sort((a, b) => a - b);
  const mediane = (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2;
  const echecs: string[] = [];
  for (const m of [...sons, ...nappes, essai]) {
    if (m.crete >= -1) echecs.push(`${m.nom} : crête ${m.crete} dBFS`);
    if (m.nan) echecs.push(`${m.nom} : ${m.nan} valeurs invalides`);
    if (m.debut > 0.002 || m.fin > 0.002) echecs.push(`${m.nom} : début ${m.debut} / fin ${m.fin}`);
    if (m.voix > MAX_VOICES) echecs.push(`${m.nom} : ${m.voix} voix`);
  }
  for (const m of sons) if (m.duree > 2 && !m.nom.startsWith('thunder')) echecs.push(`${m.nom} : ${m.duree} s`);
  for (const m of jeu) if (Math.abs(m.rms - mediane) > 6) echecs.push(`${m.nom} : RMS ${m.rms} dBFS, médiane ${r1(mediane)}`);
  return {
    sons, nappes, essai, gainChaine, plafond: r1(db(CEILING)), mediane: r1(mediane),
    ecartMin: r1(sorted[0] - mediane), ecartMax: r1(sorted[sorted.length - 1] - mediane), ok: echecs.length === 0, echecs,
  };
}

function row(cells: Array<string | number>, flags: boolean[] = []): string {
  return `<tr>${cells.map((c, i) => `<td${flags[i] === undefined ? '' : flags[i] ? ' class="ok"' : ' class="ko"'}>${c}</td>`).join('')}</tr>`;
}
function show(r: Rapport): void {
  const head = '<tr><th>Son</th><th>Famille</th><th>Durée (s)</th><th>Crête (dBFS)</th><th>RMS (dBFS)</th><th>RMS 0,5 s fort</th><th>Écart médiane</th><th>|début|</th><th>|fin|</th><th>Saut / crête</th><th>NaN</th><th>Voix</th></tr>';
  const line = (m: Mesure): string => row(
    [m.nom, m.famille, m.duree, m.crete, m.rms, m.rmsFort, m.famille === 'jeu' ? r1(m.rms - r.mediane) : '', m.debut.toExponential(1), m.fin.toExponential(1), m.saut, m.nan, m.voix],
    [true, true, m.duree <= 2 || m.nom.startsWith('thunder'), m.crete < -1, true, true, m.famille !== 'jeu' || Math.abs(m.rms - r.mediane) <= 6, m.debut <= 0.002, m.fin <= 0.002, true, m.nan === 0, m.voix <= MAX_VOICES],
  );
  $('mesures').innerHTML = head + r.sons.map(line).join('') + line(r.essai);
  $('nappes').innerHTML = '<tr><th>Scène</th><th>Crête (dBFS)</th><th>RMS (dBFS)</th><th>RMS 0,5 s fort</th><th>Marche max entre tranches de 100 ms (dB)</th><th>|début|</th><th>|fin|</th><th>NaN</th><th>Voix</th></tr>'
    + r.nappes.map(m => row([m.nom, m.crete, m.rms, m.rmsFort, m.marche, m.debut.toExponential(1), m.fin.toExponential(1), m.nan, m.voix], [true, m.crete < -1, true, true, true, m.debut <= 0.002, m.fin <= 0.002, m.nan === 0, m.voix <= MAX_VOICES])).join('');
  $('resume').innerHTML = `${r.ok ? '<b style="color:var(--ok)">Tous les critères sont tenus.</b>' : `<b style="color:var(--ko)">${r.echecs.length} écart(s) :</b> ${r.echecs.join(' ; ')}`}
    <br>Plafond de sortie : ${r.plafond} dBFS. Gain de la chaîne à bas niveau : ${r.gainChaine} dB. Médiane RMS des sons du jeu : ${r.mediane} dBFS (écarts de ${r.ecartMin} à +${r.ecartMax} dB).`;
}

$('mesurer').addEventListener('click', () => { $('resume').textContent = 'Rendu en cours…'; void mesurerTout().then(show); });
Object.assign(window, { __mesures: mesurerTout, __son: sound });
