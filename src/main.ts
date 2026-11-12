// Assemblage du jeu : la logique (game), le monde (world), la scène 3D (render) et l'interface (ui).
import { type LngLat, dist } from './core/geo';
import type { Ambiance, GameView } from './game/api';
import { Game } from './game/game';
import { LocalGameStore } from './game/save';
import { OnlineLink, createOnline } from './net/index';
import { type Fix, Locator } from './player/gps';
import { Stage } from './render/stage';
import { fetchWeather } from './services/weather';
import { playPrologue, shouldPlayPrologue } from './intro/prologue';
import { Lab } from './lab/lab';
import { Story } from './story/story';
import { StoryUi } from './story/ui';
import { FrancePanel } from './ui/france';
import { Hud } from './ui/hud';
import { Sound } from './audio/audio';
import { Voice } from './audio/voice';
import { World } from './world/world';

const START: LngLat = [-1.5761, 47.1822];
const SIM_SPEED = 2.4; // m/s : marche rapide, sous le seuil de course
const pref = {
  get(k: string): string | null { try { return localStorage.getItem(`dernier-relais/${k}`); } catch { return null; } },
  set(k: string, v: string): void { try { localStorage.setItem(`dernier-relais/${k}`, v); } catch { /* stockage indisponible */ } },
};
const ambiance: Ambiance = pref.get('ambiance') === 'clair' ? 'clair' : 'crépuscule';
let currentAmbiance: Ambiance = ambiance;

// Sons, voix et vibrations : préférences mémorisées. Le navigateur n'autorise le son qu'après un premier toucher.
const prefs = {
  sound: pref.get('son') !== 'non',
  voices: pref.get('voix') !== 'non',
  haptics: pref.get('vibrations') !== 'non',
  volume: (() => { const v = Number(pref.get('volume') ?? '0.8'); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8; })(),
};
const sound = new Sound({ muted: !prefs.sound, haptics: prefs.haptics, volume: prefs.volume });
const voice = new Voice();
const applyVoice = (): void => {
  voice.muted = !prefs.sound || !prefs.voices;
  voice.volume = Math.min(1, prefs.volume * 1.1);
  if (voice.muted) voice.stop();
};
applyVoice();
addEventListener('pointerdown', () => { sound.unlock(); voice.unlock(); });

// En ligne : sauvegarde locale d'abord, copie sur le serveur quand il répond. Hors ligne, le jeu reste complet.
const localStore = new LocalGameStore();
const online = createOnline(localStore);
const game = new Game({ store: online.store });
const world = new World(() => game.setWorld(world.loaded()));
let me: LngLat | null = null;
let mode: 'gps' | 'simulé' = 'simulé';
let simTarget: LngLat | null = null;
let lastWeather: { at: LngLat; t: number } | null = null;

function place(fix: Fix): void {
  me = [fix.lng, fix.lat];
  game.setPosition(fix);
  world.moveTo(fix.lng, fix.lat).catch(() => hud.handle({ type: 'toast', text: 'Carte injoignable. Vérifie ta connexion.', tone: 'warn' }));
  // Météo réelle : au départ, puis toutes les 15 minutes ou après 5 km.
  const now = Date.now();
  if (!lastWeather || now - lastWeather.t > 15 * 60_000 || dist(lastWeather.at, me) > 5000) {
    lastWeather = { at: me, t: now };
    fetchWeather(fix.lng, fix.lat).then(w => game.setWeather(w)).catch(() => { /* le jeu garde le dernier temps connu */ });
  }
}

const locator = new Locator(place, (s, why) => {
  mode = s;
  if (s === 'gps') simTarget = null;
  if (why) hud.handle({ type: 'toast', text: `${why}. Touche la carte pour te déplacer.`, tone: 'warn' });
});

const stage = new Stage('stage', {
  onTapGround: at => { if (mode === 'simulé') simTarget = at; },
  onTapShelter: id => {
    hud.openShelter(id);
    const sh = view?.shelters.find(x => x.id === id);
    if (sh && sh.stars > 0) voice.say(sh.npc, sh.line);
  },
  onTapOrder: id => hud.openOrder(id),
  onTapCache: id => hud.openCache?.(id),
  onTapWanderer: id => hud.openWanderer?.(id),
}, { center: START, ambiance, tilt: pref.get('vue') === '2d' ? '2d' : '3d' });

// Le lien en ligne : chaîne de relais, abris collectifs, primes, nom de porteur (voir src/net/link.ts).
const hudRoot = document.getElementById('hud')!;
const link = new OnlineLink(online.net, game, {
  toast: (text, tone) => hud.handle({ type: 'toast', text, tone }),
  refresh: () => hud.refreshOnline(),
}, { shelterName: id => view?.shelters.find(s => s.id === id)?.name ?? null });

// Installation de l'application : le navigateur prévient quand elle est possible.
interface InstallPrompt extends Event { prompt(): Promise<unknown> }
let installPrompt: InstallPrompt | null = null;

const hud = new Hud(hudRoot, {
  actions: game,
  onUseGps: () => { stage.recenter(); locator.startGPS(); },
  onRecenter: () => stage.recenter(),
  // Vue 2D (de dessus) / 3D (inclinée) : le choix est mémorisé pour le prochain lancement.
  onTilt: () => { pref.set('vue', stage.toggleTilt()); },
  onAmbiance: a => { currentAmbiance = a; pref.set('ambiance', a); stage.setAmbiance(a); lab.setAmbiance(a); },
  onGoto: (at, label) => {
    simTarget = null;
    stage.jumpTo(at);
    locator.simulate(at[0], at[1]);
    stage.recenter();
    hud.handle({ type: 'toast', text: `Position simulée : ${label}.`, tone: 'info' });
  },
  onNetwork: () => france.open(),
  online: link.hud,
  pseudo: link.pseudo,
  onSound: on => { prefs.sound = on; pref.set('son', on ? 'oui' : 'non'); sound.setMuted(!on); applyVoice(); },
  onVoices: on => { prefs.voices = on; pref.set('voix', on ? 'oui' : 'non'); applyVoice(); },
  onHaptics: on => { prefs.haptics = on; pref.set('vibrations', on ? 'oui' : 'non'); sound.setHaptics(on); },
  onVolume: v => { prefs.volume = v; pref.set('volume', String(v)); sound.setVolume(v); applyVoice(); },
  onUi: kind => sound.ui(kind),
  onInstall: () => {
    const p = installPrompt;
    if (!p) return;
    installPrompt = null;
    hud.setCanInstall(false);
    void p.prompt().catch(() => { /* invite refusée ou déjà montrée */ });
  },
  onReplayIntro: () => { void runPrologue(); },
  onLab: () => { void enterLab(); },
}, { ambiance, settings: { ...prefs, canInstall: false } });

addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e as InstallPrompt; hud.setCanInstall(true); });
addEventListener('appinstalled', () => { installPrompt = null; hud.setCanInstall(false); });

const france = new FrancePanel(hudRoot, online.net);
link.start();
online.net.start();

// Histoire principale : observe le jeu, donne l'objectif en cours et les messages radio de la Station Lumen.
const story = new Story();
const storyUi = new StoryUi(hudRoot, story, { onVoice: (who, text) => voice.say(who, text), hold: () => away });

let view: GameView | null = null;
game.on(e => {
  hud.handle(e);
  sound.handle(e);
  story.handle(e);
  if (e.type === 'scan' && view) stage.pulseScan(view.scanner.rangeM);
  if (e.type === 'jam' && e.phase === 'réussi') stage.celebrate(e.jam.shelterId);
  if (e.type === 'delivery') {
    stage.celebrate(e.result.shelterId);
    const sh = view?.shelters.find(x => x.id === e.result.shelterId);
    if (sh) online.net.onDelivery(e.result, { id: sh.id, name: sh.name, at: sh.at });
    // Le responsable de l'abri réagit de vive voix, une fois le jingle de la note passé.
    const sid = e.result.shelterId;
    setTimeout(() => { const now = game.view().shelters.find(x => x.id === sid); if (now && now.stars > 0) voice.say(now.npc, now.line); }, 1900);
  }
});

// Marche simulée : le porteur avance vers le point touché, à vitesse de marche.
function stepSim(dtS: number): void {
  if (mode !== 'simulé' || !simTarget || !me) return;
  const d = dist(me, simTarget);
  if (d < 1.5) { simTarget = null; return; }
  const k = Math.min(1, (SIM_SPEED * dtS) / d);
  locator.simulate(me[0] + (simTarget[0] - me[0]) * k, me[1] + (simTarget[1] - me[1]) * k);
}

let last = performance.now();
function frame(): void {
  const now = performance.now(), dtS = Math.min(1, (now - last) / 1000);
  last = now;
  stepSim(dtS);
  game.tick(dtS);
  view = game.view();
  stage.sync(view);
  hud.render(view);
  sound.ambient(view);
  story.observe(view);
  if (inLab) lab.update(view);
}

// ---------- Station Lumen : le labo sert de menu principal, le prologue n'est joué qu'une fois ----------
let inLab = false;
let gpsStarted = false;
const lab = new Lab(document.body, {
  onDepart: () => { lab.close(); leaveLab(); },
  onSkills: () => hud.openPorter('competences'),
  onNetwork: () => hud.openNetwork(),
  onContracts: () => hud.openPorter('contrats'),
  onJournal: () => hud.openPorter('carnet'),
}, { ambiance });

/** Vrai tant que le joueur n'est pas sur la carte (écran de départ, prologue, labo) : les messages radio attendent. */
let away = true;
let prologueOn = false;
function leaveLab(): void {
  inLab = false;
  away = prologueOn;
  document.body.classList.remove('dr-in-lab');
  if (!prologueOn) stage.setPaused?.(false);
  stage.recenter();
  if (!gpsStarted) { gpsStarted = true; locator.startGPS(); }
}

function closeEverything(): void { hud.closeAll(); france.close(); storyUi.closeJournal(); }

async function enterLab(): Promise<void> {
  closeEverything();
  if (inLab || prologueOn) return; // déjà au labo : il suffit de refermer le panneau
  inLab = true;
  away = true;
  simTarget = null;
  storyUi.dismissRadio(true);
  voice.stop();
  document.body.classList.add('dr-in-lab');
  stage.setPaused?.(true);
  try { await lab.open(view ?? game.view()); }
  catch { lab.close(); leaveLab(); }
}

/** Prologue, avec la narration en voix française calée sur les textes à l'écran. */
async function runPrologue(): Promise<void> {
  if (prologueOn) return;
  prologueOn = true;
  away = true;
  closeEverything();
  storyUi.dismissRadio(true);
  voice.stop();
  // Revu depuis le labo : le labo se met en veille pendant le film, puis revient.
  const fromLab = inLab;
  if (fromLab) lab.close();
  const lines: [number, string, string][] = [
    [1.2, 'narrateur', 'Tu es tombé du ciel.'],
    [14.4, 'iris', 'Dehors, les villes sont coupées les unes des autres.'],
    [18.9, 'iris', 'Plus de routes sûres, plus de liaisons.'],
    [23.3, 'iris', 'Il ne reste que des gens comme toi, qui portent.'],
  ];
  // La narration part quand la première image est là (repère « vent »), pas pendant le chargement.
  let timers: ReturnType<typeof setTimeout>[] = [];
  let over = false;
  stage.setPaused?.(true);
  try {
    await playPrologue(document.body, {
      ambiance: currentAmbiance,
      onSound: cue => {
        if (cue === 'vent' && !over) timers = lines.map(([t, who, text]) => setTimeout(() => { if (!over) voice.say(who, text); }, t * 1000));
      },
    });
  } catch { /* prologue impossible : on continue sans lui */ }
  over = true;
  timers.forEach(clearTimeout);
  voice.stop();
  prologueOn = false;
  if (fromLab) {
    try { await lab.open(view ?? game.view()); } catch { lab.close(); leaveLab(); }
  } else if (!inLab) { away = false; stage.setPaused?.(false); }
}

/** Écran de départ du tout premier lancement : un toucher est nécessaire pour que le son soit autorisé. */
function splash(): Promise<void> {
  return new Promise(done => {
    const el = document.createElement('button');
    el.id = 'splash';
    el.type = 'button';
    el.innerHTML = '<span class="k">Station Lumen</span><strong>Dernier Relais</strong><span class="go">Toucher pour commencer</span>';
    el.addEventListener('click', () => { sound.unlock(); voice.unlock(); el.classList.add('out'); setTimeout(() => { el.remove(); done(); }, 450); }, { once: true });
    document.body.append(el);
  });
}

game.load().then(async () => {
  // Dernière position connue : relue dans la sauvegarde du téléphone (le jeu ne la rend pas tant qu'il n'a pas reçu de position).
  let lastAt: LngLat | null = null;
  try {
    const l = (await localStore.load())?.last;
    if (Array.isArray(l) && l.length === 2 && Number.isFinite(l[0]) && Number.isFinite(l[1])) lastAt = [l[0], l[1]];
  } catch { /* stockage indisponible : départ au point par défaut */ }
  const saved = game.view().player.at ?? game.snapshot().last ?? lastAt ?? START;
  stage.jumpTo(saved);
  locator.simulate(saved[0], saved[1]);
  setInterval(frame, 200);
  frame();
  // Essais automatiques : « ?direct » saute le prologue et le labo.
  if (new URLSearchParams(location.search).has('direct')) { away = false; gpsStarted = true; locator.startGPS(); return; }
  // La carte ne se dessine pas derrière l'écran de départ, le prologue et le labo.
  stage.setPaused?.(true);
  if (shouldPlayPrologue()) { await splash(); await runPrologue(); }
  await enterLab();
});
const flush = () => { void game.flush().then(() => online.store.flush()); };
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { flush(); sound.suspend(); voice.stop(); } else sound.resume();
});
addEventListener('pagehide', flush);

// Accès pour les essais automatiques (console du navigateur) : sans effet sur le jeu.
Object.assign(window, { __dr: { game, stage, hud, world, sound, france, story, storyUi, lab, net: online.net, teleport: (at: LngLat) => locator.simulate(at[0], at[1]) } });

// Version web : cache des fichiers lourds pour les lancements suivants (inutile dans l'APK, où tout est déjà sur le téléphone).
if ('serviceWorker' in navigator && location.protocol === 'https:' && !('Capacitor' in window)) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* sans cache, le jeu marche quand même */ });
}
