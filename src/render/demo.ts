// Démo du rendu seul : un faux état de jeu, le joueur avance lentement, le scanner pulse.
// Paramètres d'URL : ?ambiance=clair  &nuit=1  &meteo=clair|nuages|pluie|orage|neige|brouillard
//                    &arret=1 (joueur immobile)  &fete=1 (gerbe sur un abri)  &brume=1 (cases non visitées)
import { cellAt, cellsAround, type LngLat } from '../core/geo';
import type { Ambiance, WeatherKind } from '../game/api';
import { mockView } from '../game/mock';
import { Stage } from './stage';

const q = new URLSearchParams(location.search);
const ambiance: Ambiance = q.get('ambiance') === 'clair' ? 'clair' : 'crépuscule';
const centre: LngLat = [-1.5761, 47.1822];
const log = document.getElementById('log')!;
const say = (s: string): void => { log.textContent = s; };

const stage = new Stage('stage', {
  onTapGround: at => say(`sol ${at[0].toFixed(5)}, ${at[1].toFixed(5)}`),
  onTapShelter: id => { say(`abri ${id}`); stage.celebrate(id); },
  onTapOrder: id => say(`colis ${id}`),
}, { center: centre, ambiance });

const start = performance.now();
const still = q.has('arret');
function push(): void {
  const t = (performance.now() - start) / 1000;
  const view = mockView(centre, t);
  // ?abri=s3 : le joueur se promène au pied de cet abri.
  const near = view.shelters.find(s => s.id === q.get('abri'));
  const base: LngLat = near ? [near.at[0] + 35 / 75000, near.at[1] + 10 / 111000] : centre;
  // Le joueur fait lentement le tour d'un pâté de maisons (cercle de 40 m, 1,3 m/s).
  const a = still ? 0.6 : 0.6 + (t * 1.3) / 40;
  view.player.at = [base[0] + (Math.sin(a) * 40 - 45) / 75000, base[1] + (Math.cos(a) * 40 - 75) / 111000];
  view.player.headingDeg = q.has('cap') ? Number(q.get('cap')) : still ? 150 : ((a * 180) / Math.PI + 90) % 360;
  view.player.speedMps = still ? 0 : q.has('course') ? 3.4 : 1.3;
  view.player.moving = !still;
  const meteo = q.get('meteo') as WeatherKind | null;
  if (meteo) view.weather.kind = meteo;
  if (q.has('nuit')) { view.weather.night = true; view.weather.sunAltDeg = -20; }
  if (q.has('brume')) {
    const here = cellAt(view.player.at[0], view.player.at[1]);
    view.loadedCells = cellsAround(here, 2).map(c => c.id);
    view.visited = [here.id];
  }
  stage.sync(view);
}
push();
setInterval(push, 500);
setInterval(() => stage.pulseScan(160), 6000);
setTimeout(() => stage.pulseScan(160), 2500);
if (q.has('fete')) setInterval(() => stage.celebrate('s1'), 3000);
if (q.has('ambiance2')) setTimeout(() => stage.setAmbiance('clair'), 6000);
window.addEventListener('keydown', e => { if (e.key === 'r') stage.recenter(); });
(window as unknown as { stage: Stage }).stage = stage;
