// Assemblage du jeu : la logique (game), le monde (world), la scène 3D (render) et l'interface (ui).
import { type LngLat, dist } from './core/geo';
import type { Ambiance, GameView } from './game/api';
import { Game } from './game/game';
import { LocalGameStore } from './game/save';
import { type Fix, Locator } from './player/gps';
import { Stage } from './render/stage';
import { fetchWeather } from './services/weather';
import { Hud } from './ui/hud';
import { World } from './world/world';

const START: LngLat = [-1.5761, 47.1822];
const SIM_SPEED = 2.4; // m/s : marche rapide, sous le seuil de course
const pref = {
  get(k: string): string | null { try { return localStorage.getItem(`dernier-relais/${k}`); } catch { return null; } },
  set(k: string, v: string): void { try { localStorage.setItem(`dernier-relais/${k}`, v); } catch { /* stockage indisponible */ } },
};
const ambiance: Ambiance = pref.get('ambiance') === 'clair' ? 'clair' : 'crépuscule';

const game = new Game({ store: new LocalGameStore() });
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
  onTapShelter: id => hud.openShelter(id),
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

let view: GameView | null = null;
game.on(e => {
  hud.handle(e);
  if (e.type === 'scan' && view) stage.pulseScan(view.scanner.rangeM);
  if (e.type === 'delivery') stage.celebrate(e.result.shelterId);
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
}

game.load().then(() => {
  const saved = game.view().player.at ?? game.snapshot().last ?? START;
  stage.jumpTo(saved);
  locator.simulate(saved[0], saved[1]);
  locator.startGPS();
  setInterval(frame, 200);
  frame();
});
const flush = () => { void game.flush(); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
addEventListener('pagehide', flush);
