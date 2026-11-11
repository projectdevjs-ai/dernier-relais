import './ui/style.css';
import { cellAt, dist, type LngLat } from './core/geo';
import { LocalStore, type Save, emptySave } from './core/store';
import { Locator } from './player/gps';
import { MapView } from './ui/map';
import { World } from './world/world';

// Lieux de test pour vérifier que le monde se génère partout : ville, village, campagne, forêt, littoral.
const TEST_PLACES: [string, number, number][] = [
  ['Bouguenais', 47.1822, -1.5761], ['Paris, Châtelet', 48.8583, 2.347], ['Lille, Grand-Place', 50.6366, 3.0635],
  ['Marseille, Vieux-Port', 43.2951, 5.3744], ['Les Essarts-le-Roi', 48.7167, 1.893], ['Village : Saint-Véran', 44.7003, 6.869],
  ['Village : Locronan', 48.099, -4.208], ['Campagne : Beauce', 48.24, 1.6], ['Forêt : Landes', 44.13, -0.7], ['Littoral : Pornic', 47.115, -2.103],
];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const say = (t: string, warn = false) => { $('msg').textContent = t; $('msg').classList.toggle('warn', warn); };

const store = new LocalStore();
let save: Save = emptySave();
let me: LngLat | null = null;

const world = new World(() => render());
const view = new MapView('map', [TEST_PLACES[0][2], TEST_PLACES[0][1]], p => locator.simulate(p[0], p[1]));
const locator = new Locator(
  f => {
    me = [f.lng, f.lat];
    const here = cellAt(f.lng, f.lat);
    if (!save.visited.includes(here.id)) save.visited.push(here.id);
    save.last = me;
    void store.save(save);
    render();
    world.moveTo(f.lng, f.lat).then(render, () => say('Carte injoignable. Vérifie ta connexion, puis déplace-toi pour réessayer.', true));
  },
  (s, why) => {
    const el = $('mode');
    el.textContent = s === 'gps' ? 'GPS réel' : 'Position simulée';
    el.className = `pill ${s === 'gps' ? 'gps' : 'sim'}`;
    if (why) say(`${why}. Touche la carte pour te déplacer en mode simulé.`, true);
  },
);

function render(): void {
  const cells = world.loaded(), shelters = cells.flatMap(c => c.shelters);
  view.update(cells, me ? cellAt(me[0], me[1]) : null, me);
  $('nShel').textContent = String(shelters.length);
  $('nParc').textContent = String(cells.reduce((n, c) => n + c.parcels.length, 0));
  $('nVis').textContent = String(save.visited.length);
  $('near').textContent = me && shelters.length ? `${Math.round(Math.min(...shelters.map(s => dist(s.at, me!))))} m` : '–';
}

const goto = $<HTMLSelectElement>('goto');
TEST_PLACES.forEach(([name], i) => goto.add(new Option(name, String(i))));
goto.addEventListener('change', () => {
  const p = TEST_PLACES[Number(goto.value)];
  if (!goto.value || !p) return;
  view.follow = true;
  view.map.jumpTo({ center: [p[2], p[1]] });
  locator.simulate(p[2], p[1]);
  say(`Position simulée : ${p[0]}.`);
});
$('gps').addEventListener('click', () => { view.follow = true; say('Recherche du signal GPS…'); locator.startGPS(); });

store.load().then(s => {
  save = s;
  const start = s.last ?? [TEST_PLACES[0][2], TEST_PLACES[0][1]];
  view.map.jumpTo({ center: start });
  locator.simulate(start[0], start[1]);
  locator.startGPS();
});
