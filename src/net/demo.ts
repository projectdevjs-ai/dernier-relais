// Démo du panneau « Carte du réseau » seul, avec un faux réseau rempli de données d'exemple.
// Paramètres d'URL : ?ambiance=clair, ?etat=hors-ligne (réseau jamais connecté), ?onglet=porteurs, ?region=bre (région du joueur),
// ?choix=ara (région touchée), ?bas=600 (défilement), ?vivant=0 (carte figée)
import type { LeaderRow, RegionProgress } from './network';
import { REGION_GOAL, cleanPseudo } from './network';
import { REGIONS, type RegionId, isRegionId } from './regions';
import { FrancePanel, type FranceSource } from '../ui/france';
import '../ui/hud.css';

const q = new URLSearchParams(location.search);
const offline = q.get('etat') === 'hors-ligne';
const root = document.getElementById('hud')!;
root.classList.add('dr-hud');
root.dataset.ambiance = q.get('ambiance') === 'clair' ? 'clair' : 'crepuscule';
document.body.classList.toggle('clair', q.get('ambiance') === 'clair');

const ACTIVE: Record<RegionId, number> = { idf: 96, bre: 71, pdl: 58, ara: 44, occ: 31, naq: 26, hdf: 19, ges: 12, pac: 9, nor: 5, cvl: 2, bfc: 0, cor: 0 };
const AWAKE: RegionId[] = ['bfc'];
const NAMES = ['Mara', 'Le Facteur', 'Agathe44', 'Kenji', 'Tomas', 'Zoé la Rapide', 'PorteurDuSud', 'Nolwenn', 'Basile', 'Inès', 'Yann', 'Capucine'];

class DemoNet implements FranceSource {
  online = !offline;
  private name = 'Léa';
  private data = new Map<RegionId, RegionProgress>(REGIONS.map(r => {
    const a = offline ? 0 : ACTIVE[r.id], sh = offline ? 0 : Math.round(a * 1.6) + (AWAKE.includes(r.id) ? 3 : 0);
    return [r.id, { id: r.id, name: r.name, shelters: sh, activeShelters: a, points: sh * 1450, deliveries: sh * 11, progress: Math.min(1, a / REGION_GOAL) }];
  }));
  private fns = new Set<(r: RegionProgress[]) => void>();
  private me: RegionId = isRegionId(q.get('region')) ? (q.get('region') as RegionId) : 'pdl';

  onOnline(): () => void { return () => { /* la démo ne change pas d'état */ }; }
  regions(): RegionProgress[] { return REGIONS.map(r => ({ ...this.data.get(r.id)! })); }
  onRegions(fn: (r: RegionProgress[]) => void): () => void { this.fns.add(fn); return () => { this.fns.delete(fn); }; }
  myRegion(): RegionId | null { return this.me; }
  pseudo(): string { return this.name; }
  async setPseudo(name: string): Promise<boolean> { const c = cleanPseudo(name); if (c) this.name = c; return !!c; }
  async playerCount(): Promise<number | null> { return offline ? null : 1284; }
  async leaderboard(): Promise<LeaderRow[]> {
    if (offline) return [];
    const rows = NAMES.map((pseudo, i) => ({ id: `p${i}`, pseudo, level: 14 - i, score: 48200 - i * 3170 - (i % 3) * 211, deliveries: 412 - i * 29, distanceKm: 310 - i * 21, region: REGIONS[(i * 5) % 13].id as string, me: false }));
    rows.splice(4, 0, { id: 'moi', pseudo: this.name, level: 11, score: 36110, deliveries: 301, distanceKm: 228, region: this.me, me: true });
    return rows.map((r, i) => ({ ...r, rank: i + 1 }));
  }
  /** Fait vivre la carte : une région gagne un abri actif de temps en temps. */
  tick(): void {
    const r = this.data.get(REGIONS[Math.floor(Math.random() * 13)].id)!;
    r.shelters += 1; r.activeShelters += 1; r.deliveries += 7; r.points += 900; r.progress = Math.min(1, r.activeShelters / REGION_GOAL);
    for (const fn of this.fns) fn(this.regions());
  }
}

const net = new DemoNet();
const panel = new FrancePanel(root, net);
panel.open();
if (q.get('onglet') === 'porteurs') root.querySelectorAll<HTMLButtonElement>('.dr-fr-tabs .dr-tab')[1]?.click();
if (q.get('choix')) root.querySelector(`g.dr-fr-reg[data-id="${q.get('choix')}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
if (q.get('bas')) setTimeout(() => { root.querySelector('.dr-panel-body')!.scrollTop = Number(q.get('bas')); }, 300);
if (!offline && q.get('vivant') !== '0') setInterval(() => net.tick(), 4000);
