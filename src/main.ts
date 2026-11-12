// Assemblage du jeu : la logique (game), le monde (world), la scène 3D (render) et l'interface (ui).
import { type LngLat, dist } from './core/geo';
import type { Ambiance, GameView } from './game/api';
import { Game } from './game/game';
import { LocalGameStore } from './game/save';
import { createOnline } from './net/index';
import { type Fix, Locator } from './player/gps';
import { Stage } from './render/stage';
import { fetchWeather } from './services/weather';
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

// Sons et vibrations : le navigateur n'autorise le son qu'après un premier toucher.
const sound = new Sound({ muted: pref.get('son') === 'non' });
const voice = new Voice();
voice.muted = pref.get('son') === 'non';
addEventListener('pointerdown', () => { sound.unlock(); voice.unlock(); });

// En ligne : sauvegarde locale d'abord, copie sur le serveur quand il répond. Hors ligne, le jeu reste complet.
const online = createOnline(new LocalGameStore());
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
}, { center: START, ambiance });

const hud = new Hud(document.getElementById('hud')!, {
  actions: game,
  onUseGps: () => { stage.recenter(); locator.startGPS(); },
  onRecenter: () => stage.recenter(),
  onAmbiance: a => { pref.set('ambiance', a); stage.setAmbiance(a); },
  onGoto: (at, label) => {
    simTarget = null;
    stage.jumpTo(at);
    locator.simulate(at[0], at[1]);
    stage.recenter();
    hud.handle({ type: 'toast', text: `Position simulée : ${label}.`, tone: 'info' });
  },
}, { ambiance });

const france = new FrancePanel(document.getElementById('hud')!, online.net);
online.net.start();

let view: GameView | null = null;
game.on(e => {
  hud.handle(e);
  sound.handle(e);
  if (e.type === 'scan' && view) stage.pulseScan(view.scanner.rangeM);
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
}

game.load().then(() => {
  const saved = game.view().player.at ?? game.snapshot().last ?? START;
  stage.jumpTo(saved);
  locator.simulate(saved[0], saved[1]);
  locator.startGPS();
  setInterval(frame, 200);
  frame();
});
const flush = () => { void game.flush().then(() => online.store.flush()); };
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { flush(); sound.suspend(); voice.stop(); } else sound.resume();
});
addEventListener('pagehide', flush);

// Accès pour les essais automatiques (console du navigateur) : sans effet sur le jeu.
Object.assign(window, { __dr: { game, stage, hud, world, sound, france, net: online.net, teleport: (at: LngLat) => locator.simulate(at[0], at[1]) } });
