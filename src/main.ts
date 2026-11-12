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
import { SkillTree } from './tree/tree';
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
// Ambiance : « auto » (par défaut, y compris pour qui n'a jamais touché au réglage) suit le soleil du lieu ; sinon le choix du joueur.
type AmbianceMode = 'auto' | Ambiance;
const savedMode = pref.get('ambiance-mode');
let ambianceMode: AmbianceMode = savedMode === 'clair' || savedMode === 'crépuscule' ? savedMode : 'auto';
/** Avant la première météo, « auto » se fie à l'heure du téléphone. */
const byClock = (): Ambiance => { const hr = new Date().getHours(); return hr >= 7 && hr < 19 ? 'clair' : 'crépuscule'; };
const ambiance: Ambiance = ambianceMode === 'auto' ? byClock() : ambianceMode;
let currentAmbiance: Ambiance = ambiance;
/** Applique une ambiance partout (carte, interface et histoire, labo, atelier), seulement si elle change. */
function applyAmbiance(a: Ambiance): void {
  if (a === currentAmbiance) return;
  currentAmbiance = a;
  stage.setAmbiance(a); hud.setAmbiance(a); lab.setAmbiance(a); skillTree.setAmbiance(a);
}
/** En « auto » : clair quand le soleil est levé, crépuscule sinon. Appelée à chaque rendu, sans effet tant que rien ne change. */
let weatherSeen = false;
let weatherSig: string | null = null;
function autoAmbiance(v: GameView): void {
  if (ambianceMode !== 'auto') return;
  // Une météo différente de celle du tout premier rendu vaut météo reçue (essais, sauvegarde relue).
  if (!weatherSeen) {
    const w0 = v.weather as GameView['weather'] & { sunAltDeg?: number };
    const sig = `${w0.sunAltDeg}|${w0.night}|${w0.tempC}|${w0.kind}`;
    if (weatherSig === null) weatherSig = sig; else if (sig !== weatherSig) weatherSeen = true;
  }
  if (!weatherSeen) { applyAmbiance(byClock()); return; } // hors ligne ou météo pas encore reçue : l'heure du téléphone
  const w = v.weather as GameView['weather'] & { sunAltDeg?: number };
  const day = typeof w.sunAltDeg === 'number' && Number.isFinite(w.sunAltDeg) ? w.sunAltDeg > 6 : !w.night;
  applyAmbiance(day ? 'clair' : 'crépuscule');
}

// Sons, voix et vibrations : préférences mémorisées. Le navigateur n'autorise le son qu'après un premier toucher.
const prefs = {
  sound: pref.get('son') !== 'non',
  voices: pref.get('voix') !== 'non',
  haptics: pref.get('vibrations') !== 'non',
  volume: (() => { const v = Number(pref.get('volume') ?? '0.8'); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8; })(),
};
const sound = new Sound({ muted: !prefs.sound, haptics: prefs.haptics, volume: prefs.volume });
const voice = new Voice();
/** Interjection courte propre à chaque personnage (« huh » de MMORPG), à la place des voix de synthèse. */
const blip = (who: string): void => { try { (sound as Sound & { blip?: (who: string) => void }).blip?.(who); } catch { /* le son ne doit jamais gêner le jeu */ } };
const applyVoice = (): void => {
  // La voix ne sert plus qu'au narrateur du prologue : les personnages ont un petit son vocal (sound.blip).
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
    fetchWeather(fix.lng, fix.lat).then(w => { game.setWeather(w); weatherSeen = true; }).catch(() => { /* le jeu garde le dernier temps connu */ });
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
    if (sh && sh.stars > 0) blip(sh.npc);
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
  onSkills: () => { void openSkills(); },
  onTilt: () => { pref.set('vue', stage.toggleTilt()); },
  onAmbiance: a => { ambianceMode = a; pref.set('ambiance-mode', a); applyAmbiance(a); },
  // Choix à trois positions des réglages : « auto » reprend aussitôt l'ambiance du moment.
  onAmbianceMode: m => {
    ambianceMode = m; pref.set('ambiance-mode', m);
    if (m !== 'auto') applyAmbiance(m);
    else if (view) autoAmbiance(view); else applyAmbiance(byClock());
  },
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
  // Ramassage : réglage « Ramassage rapide » mémorisé ; la carte se met en veille sous la séquence en caméra.
  onQuickPickup: on => pref.set('ramassage-rapide', on ? 'oui' : 'non'),
  onOverlay: open => { if (!inLab && !prologueOn) stage.setPaused?.(open); },
}, { ambiance, ambianceMode, settings: { ...prefs, canInstall: false, quickPickup: pref.get('ramassage-rapide') === 'oui' }, tilted: pref.get('vue') !== '2d' });

addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e as InstallPrompt; hud.setCanInstall(true); });
addEventListener('appinstalled', () => { installPrompt = null; hud.setCanInstall(false); });

const france = new FrancePanel(hudRoot, online.net);
link.start();
online.net.start();

// Histoire principale : observe le jeu, donne l'objectif en cours et les messages radio de la Station Lumen.
const story = new Story();
const storyUi = new StoryUi(hudRoot, story, { onVoice: who => blip(who), hold: () => away });

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
    setTimeout(() => { const now = game.view().shelters.find(x => x.id === sid); if (now && now.stars > 0) blip(now.npc); }, 1900);
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
  autoAmbiance(view);
  stage.sync(view);
  hud.render(view);
  sound.ambient(view);
  story.observe(view);
  if (inLab) lab.update(view);
  if (skillTree.isOpen) skillTree.update(view);
}

// ---------- Station Lumen : le labo sert de menu principal, le prologue n'est joué qu'une fois ----------
let inLab = false;
let gpsStarted = false;
const lab = new Lab(document.body, {
  onDepart: () => { lab.close(); leaveLab(); },
  onSkills: () => { void openSkills(); },
  onSkillTree: () => { void openSkills(); },
  onNetwork: () => hud.openNetwork(),
  onContracts: () => hud.openPorter('contrats'),
  onJournal: () => hud.openPorter('carnet'),
  // Les scientifiques ne parlent plus en voix de synthèse : une interjection courte, propre à chacun.
  onVoice: who => blip(who),
  onRest: () => game.rest(),
}, { ambiance });

// ---------- Arbre de compétences : écran 3D à part entière (repli : la liste du panneau Porteur) ----------
const skillTree = new SkillTree(document.body, {
  learn: id => game.learn(id),
  onUi: kind => sound.ui(kind),
}, { ambiance, leger: new URLSearchParams(location.search).has('leger') });
async function openSkills(): Promise<void> {
  hud.closeAll();
  try { await skillTree.open(view ?? game.view()); }
  catch { skillTree.close(); hud.openPorter('competences'); }
}

/** Vrai tant que le joueur n'est pas sur la carte (écran de départ, prologue, labo) : les messages radio attendent. */
let away = true;
let prologueOn = false;
/** La carte n'est visible (et dessinée) qu'une fois le labo quitté : jamais derrière le chargement, le prologue ou le labo. */
function showMap(on: boolean): void {
  document.body.classList.toggle('dr-map-on', on);
  stage.setPaused?.(!on);
}
function leaveLab(): void {
  inLab = false;
  away = prologueOn;
  document.body.classList.remove('dr-in-lab');
  if (!prologueOn) showMap(true);
  stage.recenter();
  if (!gpsStarted) { gpsStarted = true; locator.startGPS(); }
}

function closeEverything(): void { hud.closeAll(); france.close(); storyUi.closeJournal(); skillTree.close(); }

async function enterLab(): Promise<void> {
  closeEverything();
  if (inLab || prologueOn) return; // déjà au labo : il suffit de refermer le panneau
  inLab = true;
  away = true;
  simTarget = null;
  storyUi.dismissRadio(true);
  voice.stop();
  showMap(false);
  document.body.classList.add('dr-in-lab');
  try { await lab.open(view ?? game.view()); }
  catch { lab.close(); leaveLab(); }
}

/** Narration du prologue : la seule voix du jeu. Table « instant (s) → texte », calée sur les textes à l'écran
 *  (src/intro/prologue.ts) ; les textes sont ceux de scripts/voix-extra.json, entrées "who": "narrateur". */
const NARRATION: [number, string][] = [
  [1.2, 'Tu es tombé du ciel.'],
  [8.4, 'Plaine Noire'],
  [31.4, 'Station Lumen'],
  [37.6, 'Dernier Relais'],
];

/** Prologue, avec le narrateur calé sur les textes à l'écran. */
async function runPrologue(): Promise<void> {
  if (prologueOn) return;
  prologueOn = true;
  away = true;
  closeEverything();
  storyUi.dismissRadio(true);
  voice.stop();
  showMap(false); // « Revoir le prologue » depuis la carte : la carte s'efface avant le film
  // Revu depuis le labo : le labo se met en veille pendant le film, puis revient.
  const fromLab = inLab;
  if (fromLab) lab.close();
  // La narration part quand la première image est là (repère « vent »), pas pendant le chargement.
  let timers: ReturnType<typeof setTimeout>[] = [];
  let over = false;
  try {
    await playPrologue(document.body, {
      ambiance: currentAmbiance,
      onSound: cue => {
        if (cue === 'vent' && !over) timers = NARRATION.map(([t, text]) => setTimeout(() => { if (!over) voice.say('narrateur', text); }, t * 1000));
      },
    });
  } catch { /* prologue impossible : on continue sans lui */ }
  over = true;
  timers.forEach(clearTimeout);
  voice.stop();
  prologueOn = false;
  if (fromLab) {
    try { await lab.open(view ?? game.view()); } catch { lab.close(); leaveLab(); }
  } else if (!inLab) { away = false; showMap(true); }
}

// ---------- Écran de chargement (inscrit en dur dans index.html) puis écran de départ ----------
const bootEl = document.getElementById('boot');
const bootT0 = performance.now();
const BOOT_MIN_MS = 2500;
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, Math.max(0, ms)));
/** Le chargement dure au moins 2,5 s : assez pour lire l'emblème, jamais un éclair. */
const bootMin = (): Promise<void> => sleep(BOOT_MIN_MS - (performance.now() - bootT0));
function bootOut(): void {
  if (!bootEl || bootEl.classList.contains('out')) return;
  bootEl.classList.add('out');
  setTimeout(() => bootEl.remove(), 800);
}

/** Écran de départ du tout premier lancement : un toucher est nécessaire pour que le son soit autorisé. */
function splash(): Promise<void> {
  return new Promise(done => {
    const el = document.getElementById('splash');
    if (!bootEl || !el) { done(); return; }
    bootEl.classList.add('ready');
    el.hidden = false;
    el.addEventListener('click', () => { sound.unlock(); voice.unlock(); sound.ui('confirm'); el.hidden = true; done(); }, { once: true });
    try { el.focus({ preventScroll: true }); } catch { /* sans focus, le toucher marche quand même */ }
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
  if (new URLSearchParams(location.search).has('direct')) { away = false; gpsStarted = true; showMap(true); bootOut(); locator.startGPS(); return; }
  // La carte ne se dessine pas (et reste invisible) derrière le chargement, l'écran de départ, le prologue et le labo.
  showMap(false);
  await bootMin();
  if (shouldPlayPrologue()) {
    await splash();
    // Le film charge sous l'écran de départ, qui ne s'efface qu'une fois le prologue lancé.
    setTimeout(bootOut, 500);
    await runPrologue();
    await enterLab();
  } else {
    // Lancements suivants : fondu vers le labo dès qu'il est prêt (ou au bout de quelques secondes s'il tarde).
    const opened = enterLab();
    await Promise.race([opened, sleep(6000)]);
    bootOut();
    await opened;
  }
}).catch(() => bootOut());
const flush = () => { void game.flush().then(() => online.store.flush()); };
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { flush(); sound.suspend(); voice.stop(); } else sound.resume();
});
addEventListener('pagehide', flush);

// Accès pour les essais automatiques (console du navigateur) : sans effet sur le jeu.
Object.assign(window, { __dr: { game, stage, hud, world, sound, france, story, storyUi, lab, skillTree, net: online.net, teleport: (at: LngLat) => locator.simulate(at[0], at[1]) } });

// Version web : cache des fichiers lourds pour les lancements suivants (inutile dans l'APK, où tout est déjà sur le téléphone).
if ('serviceWorker' in navigator && location.protocol === 'https:' && !('Capacitor' in window)) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* sans cache, le jeu marche quand même */ });
}
